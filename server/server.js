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
    socket.on('createRoom', (mode) => {
        const code = generateRoomCode();
        const config = getModeConfig(mode);

        rooms[code] = {
            id: code,
            players: [],
            config: config,
            status: 'waiting', // waiting, playing, ended
            hostId: socket.id,
            score: { left: 0, right: 0 },
            timer: 120 // 2 minutes in seconds
        };

        // Add Host as first player (Auto Team A)
        const player = {
            id: socket.id,
            username: "Host", // Default, will update if name provided? No, host uses Create button.
            // Client prompt for name before create? or just use "Host"
            // For now, let's say Host name is "HOST" or we can update client to send name with create.
            // Let's assume Host name is "HOST" for now or update Client to ask.
            // Client `btnCreateMenu` just shows menu. Mode buttons emit `createRoom`.
            // Let's default to "HOST" for now.
            name: "HOST",
            side: 'left',
            color: '#fff' // Placeholder
        };
        rooms[code].players.push(player);

        socket.join(code);
        socket.emit('roomCreated', { code, hostId: socket.id });
        io.to(code).emit('lobbyUpdate', rooms[code]);
    });

    // Join Room
    socket.on('joinRoom', (data) => {
        const { code, name } = data;
        const room = rooms[code];

        if (!room) {
            socket.emit('error', 'Room not found');
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
            side: side
        };

        room.players.push(player);
        socket.join(code);

        socket.emit('roomJoined', { code, playerId: socket.id, hostId: room.hostId });
        io.to(code).emit('lobbyUpdate', room);
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
        const targetTeamCount = room.players.filter(p => p.side === team).length;

        if (targetTeamCount < maxPerTeam) {
            player.side = team;
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
            // socket.emit('error', 'Need at least 1 player per team');
            // Allow for testing? No, 1v1 min.
            // For now, allow it for ease of testing if single dev.
            // But logic needs 2 players.
        }

        room.status = 'playing';
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
                // Game Over
                room.status = 'ended';
                clearInterval(interval);
                const winner = room.score.left > room.score.right ? 'Team A' :
                    (room.score.right > room.score.left ? 'Team B' : 'Draw');
                io.to(code).emit('gameOver', { winner });
            }
        }, 1000);
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
        for (const roomID of socket.rooms) {
            if (roomID !== socket.id && rooms[roomID]) {
                socket.to(roomID).emit('clientPuckHit', data);
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
                io.to(roomID).emit('scoreUpdate', room.score);
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
