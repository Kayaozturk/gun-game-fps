const express = require('express');
const http = require('http');
const socketio = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketio(server);

app.use(express.static(path.join(__dirname)));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});
app.use((req, res, next) => {
    res.setHeader("Content-Security-Policy", "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:;");
    next();
});
const PORT = process.env.PORT || 3000;

const WEAPONS = {
    ar: { damage: 20, ammo: 30, maxAmmo: 30, reloadTime: 2000, fireRate: 100, auto: true },
    burst: { damage: 13, ammo: 30, maxAmmo: 30, reloadTime: 2000, fireRate: 400, auto: false },
    smg: { damage: 8, ammo: 40, maxAmmo: 40, reloadTime: 1500, fireRate: 80, auto: true },
    deagle: { damage: 40, ammo: 7, maxAmmo: 7, reloadTime: 1800, fireRate: 500, auto: false },
    sniper: { damage: 50, ammo: 5, maxAmmo: 5, reloadTime: 3000, fireRate: 1000, auto: false },
    rpg: { damage: 50, ammo: 3, maxAmmo: 3, reloadTime: 3500, fireRate: 1000, auto: false },
    spellbook: { damage: 35, ammo: Infinity, maxAmmo: Infinity, fireRate: 500, auto: false },
    glock: { damage: 15, ammo: 15, maxAmmo: 15, reloadTime: 1500, fireRate: 300, auto: false }
};

const MAPS = ['islands1', 'islands2', 'islands3'];

let players = {};
let currentMap = MAPS[Math.floor(Math.random() * MAPS.length)];

const SPAWN_POINTS = [
    {x: 0, y: 5, z: 0},
    {x: 10, y: 5, z: 10},
    {x: -10, y: 5, z: 10},
    {x: 10, y: 5, z: -10},
    {x: -10, y: 5, z: -10},
    {x: 20, y: 5, z: 0},
    {x: -20, y: 5, z: 0},
    {x: 0, y: 5, z: 20},
    {x: 0, y: 5, z: -20},
    {x: 15, y: 5, z: 15}
];

function getSpawnPoint(){
    return SPAWN_POINTS[Math.floor(Math.random() * SPAWN_POINTS.length)];
}

io.on('connection', (socket) => {
    console.log('Player connected:', socket.id);

    socket.on('join', (data) => {
        if(Object.keys(players).length >= 10){
            socket.emit('serverFull');
            return;
        }
        let spawn = getSpawnPoint();
        players[socket.id] = {
            id: socket.id,
            username: data.username,
            skin: data.skin,
            weapon: data.weapon,
            x: spawn.x,
            y: spawn.y,
            z: spawn.z,
            rotY: 0,
            health: 100,
            kills: 0,
            deaths: 0,
            ammo: WEAPONS[data.weapon].ammo,
            glockAmmo: WEAPONS['glock'].ammo,
            alive: true
        };
        socket.emit('joined', { 
            id: socket.id, 
            map: currentMap,
            players: players,
            weapons: WEAPONS
        });
        socket.broadcast.emit('playerJoined', players[socket.id]);
    });

    socket.on('move', (data) => {
        if(players[socket.id]){
            players[socket.id].x = data.x;
            players[socket.id].y = data.y;
            players[socket.id].z = data.z;
            players[socket.id].rotY = data.rotY;
            socket.broadcast.emit('playerMoved', {
                id: socket.id,
                x: data.x,
                y: data.y,
                z: data.z,
                rotY: data.rotY
            });
        }
    });

    socket.on('shoot', (data) => {
        if(!players[socket.id] || !players[socket.id].alive) return;
        if(data.hit && players[data.hit]){
            let weapon = data.weapon;
            let damage = WEAPONS[weapon].damage;
            if(data.headshot) damage *= 2;
            players[data.hit].health -= damage;
            io.emit('playerHit', {
                id: data.hit,
                health: players[data.hit].health,
                damage: damage,
                headshot: data.headshot
            });
            if(players[data.hit].health <= 0){
                players[data.hit].alive = false;
                players[data.hit].deaths++;
                players[socket.id].kills++;
                io.emit('playerDied', {
                    id: data.hit,
                    killedBy: players[socket.id].username,
                    weapon: weapon
                });
                io.emit('killFeed', {
                    killer: players[socket.id].username,
                    victim: players[data.hit].username,
                    weapon: weapon
                });
                // respawn after 3 seconds
                setTimeout(() => {
                    if(players[data.hit]){
                        let spawn = getSpawnPoint();
                        players[data.hit].health = 100;
                        players[data.hit].alive = true;
                        players[data.hit].x = spawn.x;
                        players[data.hit].y = spawn.y;
                        players[data.hit].z = spawn.z;
                        players[data.hit].ammo = WEAPONS[players[data.hit].weapon].ammo;
                        players[data.hit].glockAmmo = WEAPONS['glock'].ammo;
                        io.to(data.hit).emit('respawn', spawn);
                        socket.broadcast.emit('playerMoved', {
                            id: data.hit,
                            x: spawn.x,
                            y: spawn.y,
                            z: spawn.z,
                            rotY: 0
                        });
                    }
                }, 3000);
            }
        }
        socket.broadcast.emit('playerShot', {
            id: socket.id,
            weapon: data.weapon,
            origin: data.origin,
            direction: data.direction
        });
    });

    socket.on('switchWeapon', (data) => {
        if(players[socket.id]){
            players[socket.id].weapon = data.weapon;
            socket.broadcast.emit('playerSwitchedWeapon', {
                id: socket.id,
                weapon: data.weapon
            });
        }
    });

    socket.on('disconnect', () => {
        console.log('Player disconnected:', socket.id);
        socket.broadcast.emit('playerLeft', socket.id);
        delete players[socket.id];
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
});