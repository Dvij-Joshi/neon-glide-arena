const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const socket = io();

// Game Configuration (Dynamic)
let goalWidth = 200;

const TEAM_A_COLORS = ['#8B0000', '#FFC0CB', '#008000']; // Dark Red, Pink, Green
const TEAM_B_COLORS = ['#FF0000', '#6699CC', '#FFFF00']; // Red, Blue, Yellow

class Puck {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        this.radius = 15;
        this.vx = 0;
        this.vy = 0;
        this.friction = 0.99;
        this.maxSpeed = 15;
    }

    update(width, height) {
        this.x += this.vx;
        this.y += this.vy;
        this.vx *= this.friction;
        this.vy *= this.friction;

        // Top/Bottom Wall Collision (Bounce)
        if (this.y - this.radius < 0) {
            this.y = this.radius;
            this.vy *= -1;
        }
        if (this.y + this.radius > height) {
            this.y = height - this.radius;
            this.vy *= -1;
        }

        // Goals or Left/Right walls
        // Left Wall (x=0)
        if (this.x - this.radius < 0) {
            if (this.y > height / 2 - goalWidth / 2 && this.y < height / 2 + goalWidth / 2) {
                return 2; // Goal for Right Team (scored in left goal)
            } else {
                this.x = this.radius;
                this.vx *= -1;
            }
        }
        // Right Wall (x=width)
        if (this.x + this.radius > width) {
            if (this.y > height / 2 - goalWidth / 2 && this.y < height / 2 + goalWidth / 2) {
                return 1; // Goal for Left Team (scored in right goal)
            } else {
                this.x = width - this.radius;
                this.vx *= -1;
            }
        }
        return 0; // No goal
    }

    draw(ctx) {
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fillStyle = '#000'; // Puck is black in sketch
        ctx.strokeStyle = '#fff'; // White outline for visibility on dark/neon? Or just black?
        // Sketch: Black puck. Background is white in sketch but dark in my theme.
        // If theme is dark, black puck is invisible.
        // I will keep it White for now to match the Neon theme, OR make it Black with White Glow.
        ctx.fillStyle = '#000';
        ctx.shadowBlur = 10;
        ctx.shadowColor = '#fff';
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.closePath();
    }
}

class Paddle {
    constructor(id, x, y, side, color) {
        this.id = id;
        this.x = x;
        this.y = y;
        this.side = side; // 'left' or 'right'
        this.radius = 25;
        this.color = color;
    }

    update(targetX, targetY, width, height) {
        this.x = targetX;
        this.y = targetY;

        // Constrain to Arena
        if (this.y - this.radius < 0) this.y = this.radius;
        if (this.y + this.radius > height) this.y = height - this.radius;

        // Constrain to Half
        if (this.side === 'left') {
            if (this.x - this.radius < 0) this.x = this.radius;
            if (this.x + this.radius > width / 2) this.x = width / 2 - this.radius;
        } else {
            if (this.x - this.radius < width / 2) this.x = width / 2 + this.radius;
            if (this.x + this.radius > width) this.x = width - this.radius;
        }
    }

    draw(ctx) {
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fillStyle = this.color;
        ctx.shadowBlur = 20;
        ctx.shadowColor = this.color;
        ctx.fill();
        ctx.lineWidth = 0; // No outline needed if solid color
        ctx.closePath();
    }
}

// Global State
let paddles = {}; // map socketId -> Paddle
let puck = new Puck(600, 300); // Default cente
let mySide = null;
let gameActive = false;
let isHost = false;

// Input
let mouseX = 0;
let mouseY = 0;

canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    mouseX = (e.clientX - rect.left) * scaleX;
    mouseY = (e.clientY - rect.top) * scaleY;
});


function resetPuck() {
    puck.x = canvas.width / 2;
    puck.y = canvas.height / 2;
    puck.vx = 0;
    puck.vy = 0;
}

function checkCollision(paddle, puck) {
    const dx = puck.x - paddle.x;
    const dy = puck.y - paddle.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const minDistance = paddle.radius + puck.radius;

    if (distance < minDistance) {
        const angle = Math.atan2(dy, dx);
        const overlap = minDistance - distance;
        puck.x += Math.cos(angle) * overlap;
        puck.y += Math.sin(angle) * overlap;

        const speed = Math.sqrt(puck.vx * puck.vx + puck.vy * puck.vy);
        const newSpeed = Math.min(speed + 10, puck.maxSpeed);

        puck.vx = Math.cos(angle) * newSpeed;
        puck.vy = Math.sin(angle) * newSpeed;
        return true;
    }
    return false;
}

// Socket UI
const joinBtn = document.getElementById('join-btn');
const usernameInput = document.getElementById('username');
const lobbyUI = document.getElementById('lobby-ui');
const playerList = document.getElementById('player-list');
const waitingMsg = document.getElementById('waiting-msg');
// Scoreboard Elements
const p1ScoreEl = document.getElementById('p1-score'); // Team A (Left)
const p2ScoreEl = document.getElementById('p2-score'); // Team B (Right)

const practiceBtn = document.getElementById('practice-btn');

joinBtn.addEventListener('click', () => {
    const username = usernameInput.value;
    if (username) {
        socket.emit('joinGame', username);
        joinBtn.disabled = true;
        joinBtn.innerText = "JOINING...";
        usernameInput.disabled = true;
        practiceBtn.disabled = true;
    }
});

practiceBtn.addEventListener('click', () => {
    const username = usernameInput.value || "Guest";
    socket.emit('joinPractice', username);
    joinBtn.disabled = true;
    practiceBtn.disabled = true;
    practiceBtn.innerText = "STARTING...";
    usernameInput.disabled = true;
});

// Networking
socket.on('gameJoined', (data) => {
    mySide = data.side;
    console.log("Joined as " + mySide);
    waitingMsg.style.display = 'block';
});

socket.on('playerUpdate', (players) => {
    // Update Lobby List
    playerList.innerHTML = '';
    players.forEach(p => {
        const li = document.createElement('li');
        li.textContent = `${p.username} [${p.side.toUpperCase()}]`;
        if (p.id === socket.id) li.style.color = '#0ff';
        playerList.appendChild(li);
    });
});

socket.on('gameStart', (data) => {
    console.log("Game Starting with config:", data.config);
    gameActive = true;

    // Hide Lobby
    lobbyUI.style.display = 'none';
    // Scoreboard is always visible in sidebar now

    // Resize Board
    canvas.width = data.config.width;
    canvas.height = data.config.height;
    goalWidth = data.config.goalWidth;

    // Initialize Paddles
    paddles = {};
    const players = data.players;

    const leftPlayers = players.filter(p => p.side === 'left');
    const rightPlayers = players.filter(p => p.side === 'right');

    players.forEach(p => {
        let x, y, color;
        if (p.side === 'left') {
            const index = leftPlayers.findIndex(lp => lp.id === p.id);
            color = TEAM_A_COLORS[index % TEAM_A_COLORS.length];
            // Position: 1st=Goalie, others forward
            if (index === 0) {
                x = 100; y = canvas.height / 2;
            } else {
                x = 300; y = (canvas.height / (leftPlayers.length)) * index; // Simple vertical distribution
            }
        } else {
            const index = rightPlayers.findIndex(rp => rp.id === p.id);
            color = TEAM_B_COLORS[index % TEAM_B_COLORS.length];
            if (index === 0) {
                x = canvas.width - 100; y = canvas.height / 2;
            } else {
                x = canvas.width - 300; y = (canvas.height / (rightPlayers.length)) * index;
            }
        }
        paddles[p.id] = new Paddle(p.id, x, y, p.side, color);
    });

    if (players[0].id === socket.id) {
        isHost = true;
    } else {
        isHost = false;
    }

    resetPuck();
});

socket.on('scoreUpdate', (scores) => {
    p1ScoreEl.innerText = scores.left;
    p2ScoreEl.innerText = scores.right;
});

socket.on('opponentMove', (data) => {
    if (paddles[data.id]) {
        paddles[data.id].x = data.x;
        paddles[data.id].y = data.y;
    }
});

socket.on('puckUpdate', (data) => {
    if (!isHost) {
        puck.x = data.x;
        puck.y = data.y;
        puck.vx = data.vx;
        puck.vy = data.vy;
    }
});

function render() {
    const width = canvas.width;
    const height = canvas.height;

    // Clear
    ctx.fillStyle = '#fff'; // White background as per sketch?
    // User said "keep the theme as it is". History says "NeonGlide".
    // Does the diagram show a white board? Yes.
    // Does "keep the theme as it is" apply to the BOARD or the UI?
    // "impliement this Structure in the arena, and keep the theme as it is"
    // Maybe keep the dark background of the webpage, but the ARENA should look like the sketch?
    // Or keep the neon arena?
    // If I make the arena white, I lose the neon effect.
    // I will stick to the previous Dark/Neon theme for the Arena Surface to be safe, relying on the "Keep the theme" instruction.
    // The sketch structure (Players, Horizontal) is what matters.
    ctx.fillStyle = '#020202';
    ctx.fillRect(0, 0, width, height);

    // Grid
    drawGrid(width, height);

    // Board Outline
    ctx.strokeStyle = '#0ff';
    ctx.lineWidth = 5;
    ctx.shadowBlur = 15;
    ctx.shadowColor = '#0ff';
    ctx.strokeRect(0, 0, width, height);

    // Goals (Left and Right)
    ctx.fillStyle = '#f00';
    ctx.shadowColor = '#f00';
    // Left Goal
    ctx.fillRect(0, height / 2 - goalWidth / 2, 5, goalWidth);
    // Right Goal
    ctx.fillRect(width - 5, height / 2 - goalWidth / 2, 5, goalWidth);

    // Center Line (Vertical)
    ctx.beginPath();
    ctx.moveTo(width / 2, 0);
    ctx.lineTo(width / 2, height);
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 2;
    ctx.shadowBlur = 0;
    ctx.stroke();

    // Center Circle and Dot
    ctx.beginPath();
    ctx.arc(width / 2, height / 2, 50, 0, Math.PI * 2);
    ctx.strokeStyle = '#333';
    ctx.stroke();
    ctx.closePath();

    ctx.beginPath();
    ctx.arc(width / 2, height / 2, 10, 0, Math.PI * 2);
    ctx.fillStyle = '#333';
    ctx.fill();
    ctx.closePath();


    if (gameActive) {
        // Update My Paddle
        const myPaddle = paddles[socket.id];
        if (myPaddle) {
            myPaddle.update(mouseX, mouseY, width, height);
            socket.emit('playerMove', { id: socket.id, x: myPaddle.x, y: myPaddle.y });
        }

        // Draw All Paddles
        for (const id in paddles) {
            paddles[id].draw(ctx);
        }

        // Update Puck (Host only)
        if (isHost) {
            const goal = puck.update(width, height);
            if (goal !== 0) {
                resetPuck();
                socket.emit('goalScored', goal === 1 ? 'left' : 'right');
                createParticles(width / 2, height / 2, 50, '#fff'); // Explosion at center
            }

            // Check collisions with ALL paddles
            for (const id in paddles) {
                if (checkCollision(paddles[id], puck)) {
                    createParticles(puck.x, puck.y, 10, paddles[id].color);
                }
            }

            socket.emit('puckMove', { x: puck.x, y: puck.y, vx: puck.vx, vy: puck.vy });
        }

        // Draw Particles
        updateParticles();

        // Draw Puck
        puck.draw(ctx);
    }

    requestAnimationFrame(render);
}

// Particles
let particles = [];
class Particle {
    constructor(x, y, color) {
        this.x = x;
        this.y = y;
        this.color = color;
        this.radius = Math.random() * 3 + 1;
        this.vx = (Math.random() - 0.5) * 5;
        this.vy = (Math.random() - 0.5) * 5;
        this.alpha = 1;
    }
    update() {
        this.x += this.vx;
        this.y += this.vy;
        this.alpha -= 0.02;
    }
    draw(ctx) {
        ctx.save();
        ctx.globalAlpha = this.alpha;
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
}

function createParticles(x, y, count, color) {
    for (let i = 0; i < count; i++) {
        particles.push(new Particle(x, y, color));
    }
}

function updateParticles() {
    for (let i = particles.length - 1; i >= 0; i--) {
        particles[i].update();
        particles[i].draw(ctx);
        if (particles[i].alpha <= 0) {
            particles.splice(i, 1);
        }
    }
}

function drawGrid(w, h) {
    ctx.strokeStyle = 'rgba(0, 255, 255, 0.1)';
    ctx.lineWidth = 1;
    ctx.shadowBlur = 0;
    const gridSize = 50;
    for (let x = 0; x <= w; x += gridSize) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }
    for (let y = 0; y <= h; y += gridSize) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }
}

render();
