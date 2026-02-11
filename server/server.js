const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);
const path = require('path');

app.use(express.static(path.join(__dirname, '../client')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/index.html'));
});

// Room State
const rooms = {};

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // Create Room
    socket.on('createRoom', (data) => {
        const { mode, hostName } = data;
        const code = generateRoomCode();
        const config = getModeConfig(mode);

        rooms[code] = {
            id: code,
            players: [],
            config: config,
            status: 'waiting', // waiting, playing, ended
            hostId: socket.id,
            score: { left: 0, right: 0 },
            timer: 120, // 2 minutes in seconds
            lastGoalTime: 0,
            mvpStats: {} // Track goals per player
        };

        // Add Host as first player (Auto Team A)
        const player = {
            id: socket.id,
            username: hostName || "Host",
            side: 'left',
            color: '#fff', // Placeholder
            ready: false,
            goals: 0
        };
        rooms[code].players.push(player);
        rooms[code].mvpStats[socket.id] = 0;

        socket.join(code);
        socket.emit('roomCreated', { code, hostId: socket.id });
        io.to(code).emit('lobbyUpdate', rooms[code]);
    });

    // Join Room
    socket.on('joinRoom', (data) => {
        const { code, name } = data;
        const room = rooms[code];

        if (!room) {
            socket.emit('error', 'Room not found. Please check the code.');
            return;
        }
        if (room.status !== 'waiting') {
            socket.emit('error', 'Game already started');
            return;
        }

        // Auto-assign side
        const leftCount = room.players.filter(p => p.side === 'left').length;
        const rightCount = room.players.filter(p => p.side === 'right').length;
        const side = leftCount <= rightCount ? 'left' : 'right';

        const player = {
            id: socket.id,
            username: name,
            side: side,
            ready: false,
            goals: 0
        };

        room.players.push(player);
        room.mvpStats[socket.id] = 0;
        socket.join(code);

        socket.emit('roomJoined', { code, playerId: socket.id, hostId: room.hostId });
        io.to(code).emit('lobbyUpdate', room);
    });

    // Toggle Ready
    socket.on('toggleReady', (code) => {
        const room = rooms[code];
        if (!room || room.status !== 'waiting') return;

        const player = room.players.find(p => p.id === socket.id);
        if (player) {
            player.ready = !player.ready;
            io.to(code).emit('lobbyUpdate', room);
        }
    });

    // Switch Team
    socket.on('switchTeam', (data) => {
        const { room: code, team } = data;
        const room = rooms[code];
        if (!room || room.status !== 'waiting') return;

        const player = room.players.find(p => p.id === socket.id);
        if (!player) return;

        // Check limits based on mode?
        // Config.maxPerTeam?
        const maxPerTeam = room.config.maxPerTeam;
        const targetTeamCount = room.players.filter(p => p.side === team && p.id !== socket.id).length;

        if (targetTeamCount < maxPerTeam) {
            player.side = team;
            // Reset ready status on team switch to avoid confusion
            player.ready = false;
            io.to(code).emit('lobbyUpdate', room);
        }
    });

    // Start Game
    socket.on('startGame', (code) => {
        const room = rooms[code];
        if (!room || room.hostId !== socket.id) return;

        // Validate player counts (min 1 per side?)
        const leftCount = room.players.filter(p => p.side === 'left').length;
        const rightCount = room.players.filter(p => p.side === 'right').length;

        if (leftCount < 1 || rightCount < 1) {
            socket.emit('error', 'Need at least 1 player per team');
            return;
        }

        // Check if all players are ready
        const allReady = room.players.every(p => p.ready);
        if (!allReady) {
            socket.emit('error', 'All players must be ready to start!');
            return;
        }

        room.status = 'playing';
        room.timer = 120; // Reset timer to 2 minutes
        room.score = { left: 0, right: 0 }; // Reset score
        room.mvpStats = {}; // Reset MVP stats
        room.lastTouchId = null; // Reset last touch
        io.to(code).emit('gameStart', {
            config: room.config,
            players: room.players
        });

        // Start Timer
        startRoomTimer(code);
    });

    function startRoomTimer(code) {
        const room = rooms[code];
        if (!room) return;

        const interval = setInterval(() => {
            if (!rooms[code] || rooms[code].status !== 'playing') {
                clearInterval(interval);
                return;
            }

            room.timer--;
            io.to(code).emit('timerUpdate', room.timer);

            if (room.timer <= 0) {
                endGame(code); // Time limit reached
                clearInterval(interval);
            }
        }, 1000);
    }

    function endGame(code, winCondition = false) {
        const room = rooms[code];
        if (!room) return;

        room.status = 'ended';

        let winner = 'Draw';
        if (room.score.left > room.score.right) winner = 'Team A';
        if (room.score.right > room.score.left) winner = 'Team B';

        // Calculate MVP
        let mvpId = null;
        let maxGoals = -1;
        for (const [pid, goals] of Object.entries(room.mvpStats)) {
            if (goals > maxGoals) {
                maxGoals = goals;
                mvpId = pid;
            }
        }
        const mvpPlayer = room.players.find(p => p.id === mvpId);
        const mvpName = mvpPlayer ? mvpPlayer.username : "None";

        io.to(code).emit('gameOver', {
            winner,
            score: room.score,
            mvp: { name: mvpName, goals: maxGoals }
        });
    }

    // Gameplay Events
    socket.on('playerMove', (data) => {
        // Broadcast to room
        for (const roomID of socket.rooms) {
            if (roomID !== socket.id && rooms[roomID]) {
                socket.to(roomID).emit('opponentMove', data);
            }
        }
    });

    socket.on('puckMove', (data) => {
        for (const roomID of socket.rooms) {
            if (roomID !== socket.id && rooms[roomID]) {
                socket.to(roomID).emit('puckUpdate', data);
            }
        }
    });

    socket.on('clientPuckHit', (data) => {
        // Relay client's hit verification to Host (and others for visual smoothness)
        // Also could use this to track "Last Touched By" for MVP
        for (const roomID of socket.rooms) {
            if (roomID !== socket.id && rooms[roomID]) {
                socket.to(roomID).emit('clientPuckHit', data);

                // Track last touch for MVP (simplify: if client says they hit it, believe them for now)
                const room = rooms[roomID];
                if (room) {
                    // We need to know WHO hit it. `data` currently only has x, y, vx, vy.
                    // Ideally, we should pass player ID or infer from socket.
                    // But for now, let's assume the sender is the one who hit it.
                    room.lastTouchId = socket.id;
                }
            }
        }
    });

    socket.on('goalScored', (team) => {
        // Find room and update score
        // Debounce: Ignore if goal scored less than 3 seconds ago
        for (const roomID of socket.rooms) {
            if (roomID !== socket.id && rooms[roomID]) {
                const room = rooms[roomID];
                const now = Date.now();

                // Initialize lastGoalTime if missing
                if (!room.lastGoalTime) room.lastGoalTime = 0;

                if (now - room.lastGoalTime < 3000) {
                    // Ignore duplicate/spam goals
                    return;
                }

                room.lastGoalTime = now;

                if (team === 'left') room.score.left++;
                else room.score.right++;

                // MVP Credit
                if (room.lastTouchId && room.mvpStats[room.lastTouchId] !== undefined) {
                    // Only credit if they scored for their OWN team? 
                    // Or just credit the last touch? 
                    // Let's credit last touch for simplicity, assummed to be the scorer.
                    // Realistically we should check if `lastTouchId` belongs to `team`.
                    const scorer = room.players.find(p => p.id === room.lastTouchId);
                    if (scorer && scorer.side === team) {
                        room.mvpStats[room.lastTouchId]++;
                    }
                }

                io.to(roomID).emit('scoreUpdate', room.score);

                // Check win condition (e.g., first to 7)
                if (room.score.left >= 7 || room.score.right >= 7) {
                    endGame(roomID, true);
                }
            }
        }
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        // Cleanup
        for (const code in rooms) {
            const room = rooms[code];
            const index = room.players.findIndex(p => p.id === socket.id);
            if (index !== -1) {
                room.players.splice(index, 1);
                io.to(code).emit('lobbyUpdate', room);

                // If Host left, assign new host? or close room?
                if (socket.id === room.hostId) {
                    if (room.players.length > 0) {
                        room.hostId = room.players[0].id; // New host
                        io.to(code).emit('lobbyUpdate', room); // Triggers host control check
                    } else {
                        delete rooms[code];
                    }
                }
                break;
            }
        }
    });
});

// Utils
function generateRoomCode() {
    return Math.random().toString(36).substring(2, 6).toUpperCase();
}

function getModeConfig(mode) {
    const width = 1200;
    const height = 600;
    let goalWidth = 200;
    let maxPerTeam = 1;

    switch (mode) {
        case '1v1': maxPerTeam = 1; goalWidth = 180; break;
        case '2v2': maxPerTeam = 2; goalWidth = 220; break;
        case '3v3': maxPerTeam = 3; goalWidth = 250; break;
        case '4v4': maxPerTeam = 4; goalWidth = 280; break;
    }

    return { width, height, goalWidth, maxPerTeam };
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
