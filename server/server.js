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

const rooms = {};

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('joinGame', (username) => {
        let roomID = null;

        // Find existing non-full room
        for (const id in rooms) {
            if (rooms[id].players.length < 6) { // Up to 6 players for 3v3
                roomID = id;
                break;
            }
        }

        if (!roomID) {
            roomID = Math.random().toString(36).substring(2, 7);
            rooms[roomID] = {
                id: roomID,
                players: [],
                status: 'waiting',
                score: { left: 0, right: 0 } // Score for Left/Right teams
            };
        }

        const room = rooms[roomID];
        const playerCount = room.players.length;
        // Sides: Even -> Left (Team A), Odd -> Right (Team B)
        const side = (playerCount % 2 === 0) ? 'left' : 'right';

        const player = {
            id: socket.id,
            username: username,
            side: side,
            index: playerCount
        };

        room.players.push(player);
        socket.join(roomID);

        // Notify client
        socket.emit('gameJoined', { room: roomID, side: player.side, index: player.index });
        io.to(roomID).emit('playerUpdate', room.players);

        // Check if we should start (for testing, start on 2, but allow more to join?)
        // Let's start when 2 players join, and dynamically scale if more join?
        // Or wait for 2v2?
        // Let's Auto-start at 2, but update config if 3rd or 4th joins?
        // For simplicity: Start at 2. If others join, restart/resize?
        // Better: Wait for "Start" button from host.
        // For prototype: Start at 2. If 3rd joins, RE-START with new size.

        // Auto-start or update if enough players
        if (room.players.length >= 2) {
            room.status = 'playing';

            // Dynamic Board Config (Horizontal)
            const width = 1200; // Wider for horizontal play
            const height = 600;
            const goalWidth = 200; // Size of goal on side walls

            io.to(roomID).emit('gameStart', {
                config: { width, height, goalWidth },
                players: room.players
            });
        }
    });

    socket.on('playerMove', (data) => {
        // Broadcast movement to opponent in the same room
        // Optimization: Don't broadcast to sender
        if (socket.rooms.size > 1) { // socket.rooms is a Set, contains socket.id and roomID
            socket.rooms.forEach(roomID => {
                if (roomID !== socket.id) {
                    socket.to(roomID).emit('opponentMove', data);
                }
            });
        }
    });

    socket.on('puckMove', (data) => {
        if (socket.rooms.size > 1) {
            socket.rooms.forEach(roomID => {
                if (roomID !== socket.id) {
                    socket.to(roomID).emit('puckUpdate', data);
                }
            });
        }
    });

    socket.on('joinPractice', (username) => {
        const roomID = Math.random().toString(36).substring(2, 7);
        rooms[roomID] = {
            id: roomID,
            players: [],
            status: 'playing', // Start immediately
            score: { left: 0, right: 0 }
        };

        const room = rooms[roomID];
        const player = {
            id: socket.id,
            username: username,
            side: 'left', // Player starts on Left
            index: 0
        };

        // Add dummy opponent?
        const bot = {
            id: 'bot',
            username: 'CPU',
            side: 'right', // Bot on Right
            index: 1
        };

        room.players.push(player);
        room.players.push(bot);
        socket.join(roomID);

        // Notify client
        socket.emit('gameJoined', { room: roomID, side: player.side, index: player.index });
        socket.emit('gameStart', {
            config: { width: 1200, height: 600, goalWidth: 200 },
            players: room.players
        });
    });

    socket.on('goalScored', (team) => {
        // team: 'left' or 'right'
        // Find room
        if (socket.rooms.size > 1) {
            socket.rooms.forEach(roomID => {
                const room = rooms[roomID];
                if (room) {
                    if (team === 'left') room.score.left++;
                    else room.score.right++;

                    io.to(roomID).emit('scoreUpdate', room.score);
                }
            });
        }
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        // Remove player from room (simplified)
        for (const id in rooms) {
            const room = rooms[id];
            const index = room.players.findIndex(p => p.id === socket.id);
            if (index !== -1) {
                room.players.splice(index, 1);
                io.to(id).emit('playerDisconnected');
                if (room.players.length === 0) {
                    delete rooms[id];
                }
                break;
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
