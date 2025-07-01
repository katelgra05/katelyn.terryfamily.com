const WebSocket = require('ws');
const http = require('http');

// Create HTTP server
const server = http.createServer();

// Create WebSocket server
const wss = new WebSocket.Server({ server });

// Game state
const gameState = {
    players: new Map(),
    bullets: new Map(),
    food: new Map(),
    powerUps: new Map(),
    worldSize: 5000,
    nextId: 1
};

// Game constants
const FOOD_COUNT = 100;
const POWER_UP_TYPES = [
    { name: 'Speed Boost', icon: '⚡', duration: 5000, color: '#ffd700' },
    { name: 'Size Increase', icon: '📈', duration: 8000, color: '#ff6b6b' },
    { name: 'Rapid Fire', icon: '🔥', duration: 6000, color: '#ff4500' },
    { name: 'Shield', icon: '🛡️', duration: 4000, color: '#00bfff' }
];

// Add at the top:
const TEAM_COLORS = { red: '#ff4444', blue: '#448aff' };
let duelQueue = [];
let duelRooms = new Map(); // roomId -> [playerId1, playerId2]
let teamAssignment = { red: 0, blue: 0 };

// Generate initial food
function generateFood() {
    for (let i = 0; i < FOOD_COUNT; i++) {
        const food = {
            id: gameState.nextId++,
            x: Math.random() * gameState.worldSize,
            y: Math.random() * gameState.worldSize,
            size: 3 + Math.random() * 2,
            color: getRandomColor()
        };
        gameState.food.set(food.id, food);
    }
}

// Generate power-ups periodically
function generatePowerUps() {
    setInterval(() => {
        if (gameState.powerUps.size < 5) {
            const type = POWER_UP_TYPES[Math.floor(Math.random() * POWER_UP_TYPES.length)];
            const powerUp = {
                id: gameState.nextId++,
                x: Math.random() * gameState.worldSize,
                y: Math.random() * gameState.worldSize,
                type: type.name,
                icon: type.icon,
                color: type.color,
                duration: type.duration
            };
            gameState.powerUps.set(powerUp.id, powerUp);
            
            // Broadcast power-up creation
            broadcast({
                type: 'powerUpCreated',
                powerUp: powerUp
            });
        }
    }, 3000);
}

// Get random color
function getRandomColor() {
    const colors = ['#ff6b6b', '#4ecdc4', '#45b7d1', '#96ceb4', '#feca57', '#ff9ff3', '#54a0ff', '#5f27cd'];
    return colors[Math.floor(Math.random() * colors.length)];
}

// Helper: get visible players for a given player
function getVisiblePlayers(forPlayer) {
    if (!forPlayer) return [];
    if (forPlayer.mode === 'ffa') {
        return Array.from(gameState.players.values()).filter(p => p.mode === 'ffa');
    } else if (forPlayer.mode === 'teams') {
        return Array.from(gameState.players.values()).filter(p => p.mode === 'teams' && p.team === forPlayer.team);
    } else if (forPlayer.mode === 'duel') {
        return Array.from(gameState.players.values()).filter(p => p.mode === 'duel' && p.room === forPlayer.room);
    }
    return [];
}

// Helper: get visible bullets for a given player
function getVisibleBullets(forPlayer) {
    if (!forPlayer) return [];
    if (forPlayer.mode === 'ffa') {
        return Array.from(gameState.bullets.values()).filter(b => {
            const owner = gameState.players.get(b.owner);
            return owner && owner.mode === 'ffa';
        });
    } else if (forPlayer.mode === 'teams') {
        return Array.from(gameState.bullets.values()).filter(b => {
            const owner = gameState.players.get(b.owner);
            return owner && owner.mode === 'teams' && owner.team === forPlayer.team;
        });
    } else if (forPlayer.mode === 'duel') {
        return Array.from(gameState.bullets.values()).filter(b => {
            const owner = gameState.players.get(b.owner);
            return owner && owner.mode === 'duel' && owner.room === forPlayer.room;
        });
    }
    return [];
}

// Helper: get visible food/powerups (for now, all modes see all)
function getVisibleFood(forPlayer) {
    return Array.from(gameState.food.values());
}
function getVisiblePowerUps(forPlayer) {
    return Array.from(gameState.powerUps.values());
}

// Update sendGameState to only send relevant players/bullets
function sendGameState(client, forPlayer) {
    const state = {
        type: 'gameState',
        data: {
            players: getVisiblePlayers(forPlayer),
            bullets: getVisibleBullets(forPlayer),
            food: getVisibleFood(forPlayer),
            powerUps: getVisiblePowerUps(forPlayer)
        }
    };
    client.send(JSON.stringify(state));
}

// Update broadcast to optionally filter by player
function broadcast(message, filterFn) {
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            if (!filterFn || filterFn(client)) {
                client.send(JSON.stringify(message));
            }
        }
    });
}

// Update game logic
function updateGame() {
    // Update bullets
    for (const [bulletId, bullet] of gameState.bullets) {
        bullet.x += bullet.vx;
        bullet.y += bullet.vy;
        bullet.life--;

        // Remove bullets that are out of bounds or expired
        if (bullet.life <= 0 || 
            bullet.x < 0 || bullet.x > gameState.worldSize ||
            bullet.y < 0 || bullet.y > gameState.worldSize) {
            gameState.bullets.delete(bulletId);
            broadcast({
                type: 'bulletRemoved',
                bulletId: bulletId
            });
        }
    }

    // Check bullet collisions
    for (const [bulletId, bullet] of gameState.bullets) {
        const owner = gameState.players.get(bullet.owner);
        if (!owner) continue;
        for (const [playerId, player] of gameState.players) {
            if (playerId === bullet.owner) continue;
            // Only interact if in same mode/team/room
            if (owner.mode !== player.mode) continue;
            if (owner.mode === 'teams' && owner.team !== player.team) continue;
            if (owner.mode === 'duel' && owner.room !== player.room) continue;
            const dist = Math.hypot(player.x - bullet.x, player.y - bullet.y);
            if (dist < player.size + bullet.size) {
                // Hit!
                player.health -= 20;
                gameState.bullets.delete(bulletId);
                broadcast({ type: 'bulletRemoved', bulletId: bulletId });
                if (player.health <= 0) {
                    const killer = gameState.players.get(bullet.owner);
                    if (killer) {
                        killer.score += 100;
                        killer.kills++;
                    }
                    // Broadcast kill event
                    broadcast({
                        type: 'playerKilled',
                        victimName: player.name,
                        killerName: killer ? killer.name : 'Unknown',
                        victimId: playerId
                    });
                    // TEAMS: allow respawn, keep team assignment
                    if (player.mode === 'teams') {
                        player.x = Math.random() * gameState.worldSize;
                        player.y = Math.random() * gameState.worldSize;
                        player.health = player.maxHealth;
                        player.powerUps.clear();
                        player.score = 0;
                        player.kills = 0;
                        broadcast({ type: 'playerUpdate', player });
                    } else if (player.mode === 'duel') {
                        // DUEL: end duel for both players, send duelResult, remove from room
                        const roomId = player.room;
                        if (roomId && duelRooms.has(roomId)) {
                            const ids = duelRooms.get(roomId);
                            for (const id of ids) {
                                const p = gameState.players.get(id);
                                if (p) {
                                    // Send duelResult to both
                                    const ws = p.ws;
                                    if (ws && ws.readyState === WebSocket.OPEN) {
                                        ws.send(JSON.stringify({
                                            type: 'duelResult',
                                            yourName: p.name,
                                            yourScore: p.score,
                                            survivedMs: Date.now() - (p.joinedAt || Date.now()),
                                            winner: (id !== playerId)
                                        }));
                                    }
                                    // Remove from game
                                    gameState.players.delete(id);
                                    broadcast({ type: 'playerLeft', playerId: id });
                                }
                            }
                            duelRooms.delete(roomId);
                        }
                    } else {
                        // FFA: remove player
                        gameState.players.delete(playerId);
                        broadcast({ type: 'playerLeft', playerId });
                    }
                } else {
                    broadcast({ type: 'playerUpdate', player });
                }
                break;
            }
        }
    }

    // Check food collisions
    for (const [foodId, food] of gameState.food) {
        for (const [playerId, player] of gameState.players) {
            const dist = Math.hypot(player.x - food.x, player.y - food.y);
            if (dist < player.size + food.size) {
                // Eat food
                player.size = Math.min(100, player.size + 0.5);
                player.score += 10;
                
                // Remove food
                gameState.food.delete(foodId);
                broadcast({
                    type: 'foodRemoved',
                    foodId: foodId
                });
                
                // Update player
                broadcast({
                    type: 'playerUpdate',
                    player: player
                });
                
                // Update player stats
                broadcast({
                    type: 'playerStats',
                    playerId: playerId,
                    stats: {
                        score: player.score,
                        kills: player.kills
                    }
                });
                break;
            }
        }
    }

    // Check power-up collisions
    for (const [powerUpId, powerUp] of gameState.powerUps) {
        for (const [playerId, player] of gameState.players) {
            const dist = Math.hypot(player.x - powerUp.x, player.y - powerUp.y);
            if (dist < player.size + 15) {
                // Collect power-up
                if (!player.powerUps) player.powerUps = new Map();
                player.powerUps.set(powerUp.type, {
                    duration: powerUp.duration,
                    startTime: Date.now()
                });
                
                player.score += 50;
                
                // Remove power-up
                gameState.powerUps.delete(powerUpId);
                broadcast({
                    type: 'powerUpRemoved',
                    powerUpId: powerUpId
                });
                
                // Update player
                broadcast({
                    type: 'playerUpdate',
                    player: player
                });
                
                // Update player stats
                broadcast({
                    type: 'playerStats',
                    playerId: playerId,
                    stats: {
                        score: player.score,
                        kills: player.kills
                    }
                });
                break;
            }
        }
    }

    // Regenerate food if needed
    if (gameState.food.size < FOOD_COUNT / 2) {
        const food = {
            id: gameState.nextId++,
            x: Math.random() * gameState.worldSize,
            y: Math.random() * gameState.worldSize,
            size: 3 + Math.random() * 2,
            color: getRandomColor()
        };
        gameState.food.set(food.id, food);
        
        broadcast({
            type: 'foodCreated',
            food: food
        });
    }

    // Update power-up timers
    for (const [playerId, player] of gameState.players) {
        if (player.powerUps) {
            for (const [type, powerUp] of player.powerUps) {
                powerUp.duration -= 16; // Assuming 60fps
                if (powerUp.duration <= 0) {
                    player.powerUps.delete(type);
                    broadcast({
                        type: 'playerUpdate',
                        player: player
                    });
                }
            }
        }
    }

    // Broadcast player count
    broadcast({
        type: 'playerCount',
        count: gameState.players.size
    });
}

// WebSocket connection handler
wss.on('connection', (ws) => {
    console.log('New client connected');
    
    // Send initial game state
    sendGameState(ws, null);
    
    // Handle messages from client
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            
            switch (data.type) {
                case 'join': {
                    const mode = data.mode || 'ffa';
                    let color = data.playerColor || getRandomColor();
                    let team = null;
                    let room = null;
                    let assignedColor = color;

                    if (mode === 'teams') {
                        // Assign to the team with fewer players, never rearrange
                        if (teamAssignment.red <= teamAssignment.blue) {
                            team = 'red';
                            assignedColor = TEAM_COLORS.red;
                            teamAssignment.red++;
                        } else {
                            team = 'blue';
                            assignedColor = TEAM_COLORS.blue;
                            teamAssignment.blue++;
                        }
                    } else if (mode === 'duel') {
                        // Add to duel queue, pair if possible
                        duelQueue.push(gameState.nextId);
                        if (duelQueue.length >= 2) {
                            const p1 = duelQueue.shift();
                            const p2 = duelQueue.shift();
                            const roomId = 'duel_' + Date.now() + '_' + Math.floor(Math.random()*10000);
                            duelRooms.set(roomId, [p1, p2]);
                            // Assign room to both players after creation
                        }
                    }
                    // Create new player
                    const player = {
                        id: gameState.nextId++,
                        x: Math.random() * gameState.worldSize,
                        y: Math.random() * gameState.worldSize,
                        vx: 0,
                        vy: 0,
                        size: 20,
                        color: assignedColor,
                        name: data.playerName,
                        health: 100,
                        maxHealth: 100,
                        powerUps: new Map(),
                        score: 0,
                        kills: 0,
                        lastShot: 0,
                        shotCooldown: 200,
                        mode,
                        team,
                        room
                    };
                    gameState.players.set(player.id, player);
                    // If duel, assign room to both players
                    if (mode === 'duel') {
                        for (const [roomId, ids] of duelRooms.entries()) {
                            if (ids.includes(player.id)) {
                                player.room = roomId;
                                // Assign to the other player too if already created
                                for (const id of ids) {
                                    const p = gameState.players.get(id);
                                    if (p) p.room = roomId;
                                }
                            }
                        }
                    }
                    // Send player their ID and info
                    ws.send(JSON.stringify({
                        type: 'playerJoined',
                        player: player
                    }));
                    // Broadcast to other players (only those in same mode/room/team as needed)
                    broadcast({
                        type: 'playerJoined',
                        player: player
                    });
                    console.log(`Player ${data.playerName} joined mode=${mode} team=${team} room=${player.room||''}`);
                    break;
                }
                    
                case 'move':
                    // Find player by WebSocket connection
                    for (const [playerId, player] of gameState.players) {
                        if (player.ws === ws) {
                            player.vx = data.vx;
                            player.vy = data.vy;
                            
                            // Apply movement
                            player.x += player.vx;
                            player.y += player.vy;
                            
                            // Keep player in bounds
                            player.x = Math.max(player.size, Math.min(gameState.worldSize - player.size, player.x));
                            player.y = Math.max(player.size, Math.min(gameState.worldSize - player.size, player.y));
                            
                            // Regenerate health
                            player.health = Math.min(player.maxHealth, player.health + 0.02);
                            
                            // Broadcast player update
                            broadcast({
                                type: 'playerUpdate',
                                player: player
                            });
                            break;
                        }
                    }
                    break;
                    
                case 'shoot':
                    // Find player by WebSocket connection
                    for (const [playerId, player] of gameState.players) {
                        if (player.ws === ws) {
                            const now = Date.now();
                            if (now - player.lastShot < player.shotCooldown) break;
                            
                            // Apply power-up effects
                            let shotCooldown = 200;
                            if (player.powerUps && player.powerUps.has('Rapid Fire')) {
                                shotCooldown = 100;
                            }
                            
                            if (now - player.lastShot >= shotCooldown) {
                                const bullet = {
                                    id: gameState.nextId++,
                                    x: player.x,
                                    y: player.y,
                                    vx: Math.cos(data.angle) * 15,
                                    vy: Math.sin(data.angle) * 15,
                                    size: 4,
                                    color: player.color,
                                    owner: playerId,
                                    life: 100
                                };
                                
                                gameState.bullets.set(bullet.id, bullet);
                                player.lastShot = now;
                                
                                // Broadcast bullet creation
                                broadcast({
                                    type: 'bulletCreated',
                                    bullet: bullet
                                });
                            }
                            break;
                        }
                    }
                    break;
                    
                case 'respawn':
                    // Find player by WebSocket connection
                    for (const [playerId, player] of gameState.players) {
                        if (player.ws === ws) {
                            // Reset player
                            player.x = Math.random() * gameState.worldSize;
                            player.y = Math.random() * gameState.worldSize;
                            player.health = player.maxHealth;
                            player.powerUps.clear();
                            player.score = 0;
                            player.kills = 0;
                            
                            // Broadcast player update
                            broadcast({
                                type: 'playerUpdate',
                                player: player
                            });
                            break;
                        }
                    }
                    break;
            }
        } catch (error) {
            console.error('Error handling message:', error);
        }
    });
    
    // Handle client disconnect
    ws.on('close', () => {
        console.log('Client disconnected');
        for (const [playerId, player] of gameState.players) {
            if (player.ws === ws) {
                // Clean up team assignment
                if (player.mode === 'teams' && player.team) {
                    teamAssignment[player.team] = Math.max(0, teamAssignment[player.team] - 1);
                }
                // Clean up duel room
                if (player.mode === 'duel' && player.room && duelRooms.has(player.room)) {
                    const ids = duelRooms.get(player.room);
                    for (const id of ids) {
                        if (id !== playerId) {
                            const p = gameState.players.get(id);
                            if (p) {
                                // Inform the other player duel ended
                                const ws2 = p.ws;
                                if (ws2 && ws2.readyState === WebSocket.OPEN) {
                                    ws2.send(JSON.stringify({
                                        type: 'duelResult',
                                        yourName: p.name,
                                        yourScore: p.score,
                                        survivedMs: Date.now() - (p.joinedAt || Date.now()),
                                        winner: false
                                    }));
                                }
                                gameState.players.delete(id);
                                broadcast({ type: 'playerLeft', playerId: id });
                            }
                        }
                    }
                    duelRooms.delete(player.room);
                }
                gameState.players.delete(playerId);
                broadcast({ type: 'playerLeft', playerId });
                console.log(`Player ${player.name} left`);
                break;
            }
        }
    });
    
    // Store WebSocket reference in player object
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            if (data.type === 'join') {
                // Find the player we just created and store the WebSocket reference
                for (const [playerId, player] of gameState.players) {
                    if (player.name === data.playerName && !player.ws) {
                        player.ws = ws;
                        break;
                    }
                }
            }
        } catch (error) {
            console.error('Error storing WebSocket reference:', error);
        }
    });
});

// Start game loop
setInterval(updateGame, 16); // ~60fps

// Generate initial food
generateFood();

// Start power-up generation
generatePowerUps();

// Start server
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
    console.log(`IO Game Server running on port ${PORT}`);
    console.log(`Connect to: ws://localhost:${PORT}`);
});

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('\nShutting down server...');
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
}); 