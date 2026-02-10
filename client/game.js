const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const socket = io();

// UI Elements
const menuOverlay = document.getElementById('menu-overlay');
const mainMenu = document.getElementById('main-menu');
const createGameMenu = document.getElementById('create-game-menu');
const joinGameMenu = document.getElementById('join-game-menu');
const lobbyUI = document.getElementById('lobby-ui');
const gameUI = document.getElementById('game-ui');

// Buttons & Inputs
const btnCreateMenu = document.getElementById('btn-create-menu');
const btnJoinMenu = document.getElementById('btn-join-menu');
const btnBackMain = document.getElementById('btn-back-main');
const btnBackMain2 = document.getElementById('btn-back-main-2');
const btnJoinAction = document.getElementById('btn-join-action');
const joinCodeInput = document.getElementById('join-code-input');
const joinNameInput = document.getElementById('join-name-input');
const btnStartGame = document.getElementById('btn-start-game');
const hostControls = document.getElementById('host-controls');
const waitingMsg = document.getElementById('waiting-msg');

// Lobby Elements
const lobbyRoomCode = document.getElementById('lobby-room-code');
const listTeamLeft = document.getElementById('list-team-left');
const listTeamRight = document.getElementById('list-team-right');
const btnJoinLeft = document.querySelector('button[data-team="left"]');
const btnJoinRight = document.querySelector('button[data-team="right"]');

// Game Elements
const timerDisplay = document.getElementById('timer-display');
const p1ScoreEl = document.getElementById('p1-score');
const p2ScoreEl = document.getElementById('p2-score');
const teamAPlayersList = document.getElementById('team-a-players');
const teamBPlayersList = document.getElementById('team-b-players');


// Game State
let goalWidth = 200;
const TEAM_A_COLORS = ['#8B0000', '#FFC0CB', '#008000', '#ff00ff'];
const TEAM_B_COLORS = ['#FF0000', '#6699CC', '#FFFF00', '#00ffff'];
let paddles = {};
let puck = { x: 0, y: 0, radius: 15, vx: 0, vy: 0, lastHitTime: 0 };
let mySide = null;
let gameActive = false;
let isHost = false;
let currentRoomCode = null;

// --- Network Configuration ---
const NETWORK_TICK_RATE = 30; // ms between updates (approx 33Hz)
let lastNetworkUpdate = 0;

// Interpolation Setup
const INTERPOLATION_FACTOR = 0.3; // Correct 30% per frame

// --- Event Listeners ---

// Navigation
btnCreateMenu.addEventListener('click', () => {
    mainMenu.style.display = 'none';
    createGameMenu.style.display = 'flex';
});

btnJoinMenu.addEventListener('click', () => {
    mainMenu.style.display = 'none';
    joinGameMenu.style.display = 'flex';
});

[btnBackMain, btnBackMain2].forEach(btn => {
    btn.addEventListener('click', () => {
        createGameMenu.style.display = 'none';
        joinGameMenu.style.display = 'none';
        mainMenu.style.display = 'flex';
    });
});

// Mode Selection (Host)
document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const mode = btn.dataset.mode; // '1v1', '2v2', etc.
        socket.emit('createRoom', mode);
    });
});

// Join Game
btnJoinAction.addEventListener('click', () => {
    const code = joinCodeInput.value.toUpperCase();
    const name = joinNameInput.value || "Player";
    if (code.length === 4) {
        socket.emit('joinRoom', { code, name });
    } else {
        alert("Please enter a valid 4-character code.");
    }
});

// Team Selection
btnJoinLeft.addEventListener('click', () => {
    socket.emit('switchTeam', { room: currentRoomCode, team: 'left' });
});
btnJoinRight.addEventListener('click', () => {
    socket.emit('switchTeam', { room: currentRoomCode, team: 'right' });
});

// Start Game
btnStartGame.addEventListener('click', () => {
    socket.emit('startGame', currentRoomCode);
});

// --- Socket Handling ---

socket.on('roomCreated', (data) => {
    // data: { code, hostId }
    currentRoomCode = data.code;
    isHost = true;
    showLobby();
});

socket.on('roomJoined', (data) => {
    // data: { code, playerId }
    currentRoomCode = data.code;
    isHost = (data.playerId === data.hostId); // Check if I am host (re-join case?)
    showLobby();
});

socket.on('lobbyUpdate', (room) => {
    // room: { players: [], config: {}, ... }
    updateLobbyUI(room);
});

socket.on('gameStart', (data) => {
    // data: { config: { width, height, goalWidth }, players: [] }
    gameActive = true;
    menuOverlay.style.display = 'none'; // Hide all menus
    gameUI.style.display = 'flex';      // Show Game UI

    // Config
    canvas.width = data.config.width;
    canvas.height = data.config.height;
    goalWidth = data.config.goalWidth;

    // Initialize Objects
    initGameObjects(data.players);
    if (players[0].id === socket.id) isHost = true; // Re-confirm host

    requestAnimationFrame(render);
});

socket.on('timerUpdate', (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    timerDisplay.innerText = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
});

socket.on('puckUpdate', (data) => {
    // Sync puck from server (Host authority)
    const now = Date.now();
    if (!isHost && (now - puck.lastHitTime > 200)) {
        // Snap for now, or simple smoothing could be added
        // To reduce jitter, maybe only update if diff is significant?
        const dx = data.x - puck.x;
        const dy = data.y - puck.y;
        if (Math.sqrt(dx * dx + dy * dy) > 10) { // Only update if noticeable diff
            puck.x = data.x;
            puck.y = data.y;
        }
        puck.vx = data.vx;
        puck.vy = data.vy;
    }
});

socket.on('clientPuckHit', (data) => {
    puck.x = data.x;
    puck.y = data.y;
    puck.vx = data.vx;
    puck.vy = data.vy;
    puck.lastHitTime = Date.now();
});

socket.on('opponentMove', (data) => {
    if (paddles[data.id]) {
        // Set target for interpolation
        paddles[data.id].targetX = data.x;
        paddles[data.id].targetY = data.y;
    }
});

socket.on('scoreUpdate', (scores) => {
    p1ScoreEl.innerText = scores.left;
    p2ScoreEl.innerText = scores.right;
});

socket.on('gameOver', (result) => {
    alert("GAME OVER! Winner: " + result.winner);
    location.reload(); // Simple reset for now
});


// --- Helper Functions ---

function showLobby() {
    createGameMenu.style.display = 'none';
    joinGameMenu.style.display = 'none';
    lobbyUI.style.display = 'flex';
    lobbyRoomCode.innerText = `CODE: ${currentRoomCode}`;
}

function updateLobbyUI(room) {
    listTeamLeft.innerHTML = '';
    listTeamRight.innerHTML = '';

    const leftPlayers = room.players.filter(p => p.side === 'left');
    const rightPlayers = room.players.filter(p => p.side === 'right');

    leftPlayers.forEach(p => addPlayerToLobbyList(listTeamLeft, p));
    rightPlayers.forEach(p => addPlayerToLobbyList(listTeamRight, p));

    // Host Controls
    if (room.hostId === socket.id) {
        hostControls.style.display = 'block';
        waitingMsg.style.display = 'none';
    } else {
        hostControls.style.display = 'none';
        waitingMsg.style.display = 'block';
    }
}

function addPlayerToLobbyList(list, player) {
    const li = document.createElement('li');
    li.className = 'lobby-player-item';
    li.innerText = player.username;
    if (player.id === socket.id) {
        li.classList.add('lobby-player-me');
        li.innerText += " (YOU)";
        mySide = player.side;
    }
    list.appendChild(li);
}

// --- Game Logic ---

class PuckClass { // Only used by Host (legacy reference in case needed)
    constructor() {
        this.x = 0; this.y = 0; this.vx = 0; this.vy = 0;
        this.radius = 15;
        this.maxSpeed = 15;
        this.friction = 0.99;
    }
    update(w, h) {
        this.x += this.vx; this.y += this.vy;
        this.vx *= this.friction; this.vy *= this.friction;

        // Bounce Top/Bottom
        if (this.y - this.radius < 0) { this.y = this.radius; this.vy *= -1; }
        if (this.y + this.radius > h) { this.y = h - this.radius; this.vy *= -1; }

        // Goals
        if (this.x - this.radius < 0) {
            if (this.y > h / 2 - goalWidth / 2 && this.y < h / 2 + goalWidth / 2) return 2; // Right Scores
            else { this.x = this.radius; this.vx *= -1; }
        }
        if (this.x + this.radius > w) {
            if (this.y > h / 2 - goalWidth / 2 && this.y < h / 2 + goalWidth / 2) return 1; // Left Scores
            else { this.x = w - this.radius; this.vx *= -1; }
        }
        return 0;
    }
}
// Note: We use the global 'puck' object now, not PuckClass instance directly in loop, but keeping logic consistent.

class Paddle {
    constructor(id, x, y, side, color) {
        this.id = id; this.x = x; this.y = y; this.side = side; this.color = color;
        this.radius = 25;
        this.targetX = x;
        this.targetY = y;
    }
    draw(ctx) {
        // Interpolation
        if (this.id !== socket.id) {
            this.x += (this.targetX - this.x) * INTERPOLATION_FACTOR;
            this.y += (this.targetY - this.y) * INTERPOLATION_FACTOR;
        }

        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fillStyle = this.color;
        ctx.shadowBlur = 15;
        ctx.shadowColor = this.color;
        ctx.fill();
        ctx.closePath();
    }
}

let players = [];

function initGameObjects(playerData) {
    players = playerData;
    paddles = {};

    // Sort players to assign consistent colors/positions
    const leftP = players.filter(p => p.side === 'left');
    const rightP = players.filter(p => p.side === 'right');

    players.forEach(p => {
        let x, y, color;
        if (p.side === 'left') {
            const idx = leftP.findIndex(x => x.id === p.id);
            color = TEAM_A_COLORS[idx % TEAM_A_COLORS.length];
            // Formation: Goalie (0), Defenders/Attackers
            if (idx === 0) { x = 100; y = canvas.height / 2; }
            else { x = 300; y = (canvas.height / (leftP.length)) * idx + 50; }
        } else {
            const idx = rightP.findIndex(x => x.id === p.id);
            color = TEAM_B_COLORS[idx % TEAM_B_COLORS.length];
            if (idx === 0) { x = canvas.width - 100; y = canvas.height / 2; }
            else { x = canvas.width - 300; y = (canvas.height / (rightP.length)) * idx + 50; }
        }
        paddles[p.id] = new Paddle(p.id, x, y, p.side, color);
    });

    // Populate Sidebar Player Lists
    updateSidebarList(teamAPlayersList, leftP, TEAM_A_COLORS);
    updateSidebarList(teamBPlayersList, rightP, TEAM_B_COLORS);

    // Initial Puck Pos
    puck.x = canvas.width / 2;
    puck.y = canvas.height / 2;
}

function updateSidebarList(container, teamPlayers, colors) {
    container.innerHTML = '';
    teamPlayers.forEach((p, i) => {
        const div = document.createElement('div');
        div.className = 'player-dot';
        div.style.backgroundColor = colors[i % colors.length];
        div.title = p.username; // Tooltip
        container.appendChild(div);
    });
}


// Input
let mouseX = 0, mouseY = 0;
canvas.addEventListener('mousemove', e => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    mouseX = (e.clientX - rect.left) * scaleX;
    mouseY = (e.clientY - rect.top) * scaleY;
});

function render() {
    if (!gameActive) return;

    const w = canvas.width;
    const h = canvas.height;

    // Draw
    ctx.fillStyle = '#020202';
    ctx.fillRect(0, 0, w, h);
    drawGrid(w, h);

    ctx.strokeStyle = '#0ff'; ctx.lineWidth = 5; ctx.shadowBlur = 15; ctx.shadowColor = '#0ff';
    ctx.strokeRect(0, 0, w, h);

    ctx.fillStyle = '#f00'; ctx.shadowColor = '#f00';
    ctx.fillRect(0, h / 2 - goalWidth / 2, 5, goalWidth);
    ctx.fillRect(w - 5, h / 2 - goalWidth / 2, 5, goalWidth);

    ctx.strokeStyle = '#333'; ctx.lineWidth = 2; ctx.shadowBlur = 0;
    ctx.beginPath(); ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, h); ctx.stroke();
    ctx.beginPath(); ctx.arc(w / 2, h / 2, 50, 0, Math.PI * 2); ctx.stroke();


    // Logic
    // 1. My Movement
    if (paddles[socket.id]) {
        let p = paddles[socket.id];
        p.x = mouseX; p.y = mouseY;
        if (p.side === 'left') {
            if (p.x > w / 2 - p.radius) p.x = w / 2 - p.radius;
        } else {
            if (p.x < w / 2 + p.radius) p.x = w / 2 + p.radius;
        }

        // NETWORK THROTTLING
        const now = Date.now();
        if (now - lastNetworkUpdate > NETWORK_TICK_RATE) {
            socket.emit('playerMove', { id: socket.id, x: p.x, y: p.y });
            lastNetworkUpdate = now;
        }

        // CLIENT-SIDE HIT PREDICTION
        // Check collision with MY paddle immediately
        if (checkCollision(p, puck)) {
            // Collision happened locally!
            puck.lastHitTime = Date.now();
            createParticles(puck.x, puck.y, 10, p.color);
            // Inform everyone
            socket.emit('clientPuckHit', { x: puck.x, y: puck.y, vx: puck.vx, vy: puck.vy });
        }
    }

    // 2. Host Logic (Physics for everything else)
    if (isHost) {
        // Friction / Movement
        puck.x += puck.vx; puck.y += puck.vy;
        puck.vx *= 0.985; puck.vy *= 0.985; // Heavier friction

        // SPEED CLAMP
        const speed = Math.sqrt(puck.vx * puck.vx + puck.vy * puck.vy);
        const MAX_SPEED = 15;
        if (speed > MAX_SPEED) {
            const ratio = MAX_SPEED / speed;
            puck.vx *= ratio;
            puck.vy *= ratio;
        }

        // Walls
        if (puck.y - puck.radius < 0) { puck.y = puck.radius; puck.vy *= -0.8; }
        if (puck.y + puck.radius > h) { puck.y = h - puck.radius; puck.vy *= -0.8; }

        // Goals
        let goal = 0;
        if (puck.x - puck.radius < 0) {
            if (puck.y > h / 2 - goalWidth / 2 && puck.y < h / 2 + goalWidth / 2) goal = 2;
            else { puck.x = puck.radius; puck.vx *= -1; }
        }
        if (puck.x + puck.radius > w) {
            if (puck.y > h / 2 - goalWidth / 2 && puck.y < h / 2 + goalWidth / 2) goal = 1;
            else { puck.x = w - puck.radius; puck.vx *= -1; }
        }

        if (goal !== 0) {
            socket.emit('goalScored', goal === 1 ? 'left' : 'right');
            puck.x = w / 2; puck.y = h / 2; puck.vx = 0; puck.vy = 0;
        }

        // Host Collisions (with other players)
        for (let id in paddles) {
            if (id !== socket.id) { // We already checked ours above
                if (checkCollision(paddles[id], puck)) {
                    createParticles(puck.x, puck.y, 10, paddles[id].color);
                    // Broadcast update immediately to keep others in sync
                    socket.emit('puckMove', { x: puck.x, y: puck.y, vx: puck.vx, vy: puck.vy });
                }
            }
        }

        // Periodic Sync
        socket.emit('puckMove', { x: puck.x, y: puck.y, vx: puck.vx, vy: puck.vy });
    } else {
        // Client Logic: Visual update + GOAL CLAIMING
        // Only simulate physics if not recently hit (avoid fighting server)
        if (Date.now() - puck.lastHitTime > 200) {
            puck.x += puck.vx; puck.y += puck.vy;
            puck.vx *= 0.985; puck.vy *= 0.985; // Match Host physics

            // Speed Clamp (Local visual)
            const speed = Math.sqrt(puck.vx * puck.vx + puck.vy * puck.vy);
            const MAX_SPEED = 15;
            if (speed > MAX_SPEED) {
                const ratio = MAX_SPEED / speed;
                puck.vx *= ratio;
                puck.vy *= ratio;
            }

            // Wall bounce (visual)
            if (puck.y - puck.radius < 0) { puck.y = puck.radius; puck.vy *= -0.8; }
            if (puck.y + puck.radius > h) { puck.y = h - puck.radius; puck.vy *= -0.8; }

            // GOAL CLAIMING for Guests
            let goal = 0;
            if (puck.x - puck.radius < 0) {
                if (puck.y > h / 2 - goalWidth / 2 && puck.y < h / 2 + goalWidth / 2) goal = 2;
                else { puck.x = puck.radius; puck.vx *= -1; }
            }
            if (puck.x + puck.radius > w) {
                if (puck.y > h / 2 - goalWidth / 2 && puck.y < h / 2 + goalWidth / 2) goal = 1;
                else { puck.x = w - puck.radius; puck.vx *= -1; }
            }

            if (goal !== 0) {
                // We saw a goal! Tell the server.
                // The server will handle debouncing if multiple people claim it.
                socket.emit('goalScored', goal === 1 ? 'left' : 'right');

                // Reset locally to avoid spamming (server will correct us soon anyway)
                puck.x = w / 2; puck.y = h / 2; puck.vx = 0; puck.vy = 0;
            }
        }
    }

    // Draw Paddles
    for (let id in paddles) paddles[id].draw(ctx);

    // Draw Particles
    updateParticles();

    // Draw Puck
    ctx.beginPath();
    ctx.arc(puck.x, puck.y, 15, 0, Math.PI * 2);
    ctx.fillStyle = '#fff'; ctx.shadowBlur = 10; ctx.shadowColor = '#fff';
    ctx.fill();

    requestAnimationFrame(render);
}

function checkCollision(paddle, puck) {
    const dx = puck.x - paddle.x;
    const dy = puck.y - paddle.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const minDist = paddle.radius + puck.radius;

    if (dist < minDist) {
        const angle = Math.atan2(dy, dx);
        const force = 12; // Reduced from 15 for heavier feel

        // Push out
        const overlap = minDist - dist;
        puck.x += Math.cos(angle) * overlap;
        puck.y += Math.sin(angle) * overlap;

        puck.vx = Math.cos(angle) * force;
        puck.vy = Math.sin(angle) * force;
        return true;
    }
    return false;
}

// Particles (unchanged)
let particles = [];
class Particle {
    constructor(x, y, color) {
        this.x = x; this.y = y; this.color = color;
        this.radius = Math.random() * 3 + 1;
        this.vx = (Math.random() - 0.5) * 5; this.vy = (Math.random() - 0.5) * 5;
        this.alpha = 1;
    }
    update() { this.x += this.vx; this.y += this.vy; this.alpha -= 0.02; }
    draw(ctx) {
        ctx.save(); ctx.globalAlpha = this.alpha; ctx.fillStyle = this.color;
        ctx.beginPath(); ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    }
}
function createParticles(x, y, count, color) { for (let i = 0; i < count; i++) particles.push(new Particle(x, y, color)); }
function updateParticles() { for (let i = particles.length - 1; i >= 0; i--) { particles[i].update(); particles[i].draw(ctx); if (particles[i].alpha <= 0) particles.splice(i, 1); } }
function drawGrid(w, h) {
    ctx.strokeStyle = 'rgba(0, 255, 255, 0.1)'; ctx.lineWidth = 1; ctx.shadowBlur = 0;
    const gridSize = 50;
    for (let x = 0; x <= w; x += gridSize) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
    for (let y = 0; y <= h; y += gridSize) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
}
render();
