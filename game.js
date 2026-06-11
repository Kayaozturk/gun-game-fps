const SKINS = [
    '#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6',
    '#1abc9c', '#e67e22', '#e91e63', '#00bcd4', '#8bc34a'
];

let selectedSkin = SKINS[0];
let myID = null;
let myData = null;
let players = {};
let otherMeshes = {};
let socket = null;
let scene, camera, renderer;
let moveForward = false, moveBack = false, moveLeft = false, moveRight = false;
let canJump = false;
let velocity = new THREE.Vector3();
let direction = new THREE.Vector3();
let prevTime = performance.now();
let isLocked = false;
let currentWeapon = 'ar';
let weapons = {};
let ammo = 30;
let glockAmmo = 15;
let isReloading = false;
let lastShot = 0;
let health = 100;
let alive = true;
let isShooting = false;
let currentMapName = "islands1";
// Setup skin picker
const skinPicker = document.getElementById('skinPicker');
SKINS.forEach((color, i) => {
    const div = document.createElement('div');
    div.className = 'skinOption' + (i === 0 ? ' selected' : '');
    div.style.background = color;
    div.addEventListener('click', () => {
        document.querySelectorAll('.skinOption').forEach(d => d.classList.remove('selected'));
        div.classList.add('selected');
        selectedSkin = color;
    });
    skinPicker.appendChild(div);
});

document.getElementById('joinBtn').addEventListener('click', () => {
    const username = document.getElementById('usernameInput').value.trim();
    if(!username){
        document.getElementById('lobbyError').textContent = 'Please enter a username!';
        return;
    }
    currentWeapon = document.getElementById('weaponSelect').value;
    startGame(username);
});

function startGame(username){
    document.getElementById('lobby').style.display = 'none';
    document.getElementById('gameContainer').style.display = 'block';

    initThree();
    socket = io();

    socket.on('joined', (data) => {
        myID = data.id;
        players = data.players;
        weapons = data.weapons;
        ammo = weapons[currentWeapon].ammo;
           createGunModel(currentWeapon); // add this line
        updateAmmoDisplay();
        buildMap(data.map);
        Object.keys(data.players).forEach(id => {
            if(id !== myID){
                addOtherPlayer(data.players[id]);
            }
        });
    });

    socket.on('serverFull', () => {
        alert('Server is full! Max 10 players.');
        location.reload();
    });

    socket.on('playerJoined', (player) => {
        players[player.id] = player;
        addOtherPlayer(player);
    });

    socket.on('playerMoved', (data) => {
        if(otherMeshes[data.id]){
            otherMeshes[data.id].position.set(data.x, data.y, data.z);
            otherMeshes[data.id].rotation.y = data.rotY;
        }
    });

    socket.on('playerLeft', (id) => {
        if(otherMeshes[id]){
            scene.remove(otherMeshes[id]);
            delete otherMeshes[id];
        }
        delete players[id];
        updateScoreboard();
    });

    socket.on('playerHit', (data) => {
        if(data.id === myID){
            health = data.health;
            updateHealthBar();
        }
    });

    socket.on('playerDied', (data) => {
        if(data.id === myID){
            alive = false;
            document.getElementById('deathScreen').style.display = 'block';
            document.getElementById('killedByText').textContent = 'Killed by ' + data.killedBy + ' with ' + data.weapon;
            let t = 3;
            document.getElementById('respawnTimer').textContent = t;
            let interval = setInterval(() => {
                t--;
                document.getElementById('respawnTimer').textContent = t;
                if(t <= 0) clearInterval(interval);
            }, 1000);
        }
        if(otherMeshes[data.id]){
            otherMeshes[data.id].visible = false;
        }
    });

    socket.on('respawn', (pos) => {
        alive = true;
        health = 100;
        ammo = weapons[currentWeapon].ammo;
        glockAmmo = weapons['glock'].ammo;
        updateHealthBar();
        updateAmmoDisplay();
        camera.position.set(pos.x, pos.y, pos.z);
        document.getElementById('deathScreen').style.display = 'none';
    });

    socket.on('playerShot', (data) => {
        showBulletTrail(data.origin, data.direction);
    });

    socket.on('killFeed', (data) => {
        addKillFeed(data.killer, data.victim, data.weapon);
    });

    socket.on('playerSwitchedWeapon', (data) => {
        // could update other player mesh here
    });

    socket.emit('join', {
        username: username,
        skin: selectedSkin,
        weapon: currentWeapon
    });

    setupControls();
    animate();
}

function initThree(){
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87ceeb);
    scene.fog = new THREE.Fog(0x87ceeb, 50, 200);

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 5, 0);

    renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('gameCanvas'), antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;

    // Lighting
    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambient);
    const sun = new THREE.DirectionalLight(0xffffff, 1);
    sun.position.set(50, 100, 50);
    sun.castShadow = true;
    scene.add(sun);

    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });
}

function buildMap(mapName){
    currentmapname = mapName;
    // Clear existing map
    scene.children = scene.children.filter(c => c.isLight);

    // Always build floating islands
    const islandData = getIslandData(mapName);
    
    islandData.forEach(island => {
        // Island platform
        const geo = new THREE.CylinderGeometry(island.radius, island.radius * 0.8, 3, 8);
        const mat = new THREE.MeshLambertMaterial({ color: island.color });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(island.x, island.y, island.z);
        mesh.receiveShadow = true;
        mesh.castShadow = true;
        scene.add(mesh);

        // Grass on top
        const grassGeo = new THREE.CylinderGeometry(island.radius, island.radius, 0.5, 8);
        const grassMat = new THREE.MeshLambertMaterial({ color: 0x4caf50 });
        const grassMesh = new THREE.Mesh(grassGeo, grassMat);
        grassMesh.position.set(island.x, island.y + 1.5, island.z);
        scene.add(grassMesh);

        // Some trees/rocks on islands
        if(Math.random() > 0.5){
            addTreeAt(island.x + Math.random() * 3 - 1.5, island.y + 1.8, island.z + Math.random() * 3 - 1.5);
        }
    });

    // Add clouds
    for(let i = 0; i < 20; i++){
        addCloud(
            Math.random() * 200 - 100,
            Math.random() * 30 + 40,
            Math.random() * 200 - 100
        );
    }

    // Ambient lighting re-add
    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambient);
    const sun = new THREE.DirectionalLight(0xffffff, 1);
    sun.position.set(50, 100, 50);
    scene.add(sun);
}

function getIslandData(mapName){
    const maps = {
        islands1: [
            {x:0, y:0, z:0, radius:40, color:0x8B6914},
        ],
        islands2: [
            {x:0, y:0, z:0, radius:40, color:0x8B6914},
        ],
        islands3: [
            {x:0, y:0, z:0, radius:40, color:0x8B6914},
        ]
    };
    return maps[mapName] || maps['islands1'];
}

function addTreeAt(x, y, z){
    const trunkGeo = new THREE.CylinderGeometry(0.2, 0.3, 2, 6);
    const trunkMat = new THREE.MeshLambertMaterial({ color: 0x8B4513 });
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.position.set(x, y + 1, z);
    scene.add(trunk);

    const leavesGeo = new THREE.ConeGeometry(1.5, 3, 6);
    const leavesMat = new THREE.MeshLambertMaterial({ color: 0x228B22 });
    const leaves = new THREE.Mesh(leavesGeo, leavesMat);
    leaves.position.set(x, y + 3.5, z);
    scene.add(leaves);
}

function addCloud(x, y, z){
    const cloudGeo = new THREE.SphereGeometry(3, 6, 6);
    const cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const cloud = new THREE.Mesh(cloudGeo, cloudMat);
    cloud.position.set(x, y, z);
    cloud.scale.set(1, 0.5, 1);
    scene.add(cloud);
}

function addOtherPlayer(playerData){
    const group = new THREE.Group();

    // Bean body
    const bodyGeo = new THREE.SphereGeometry(0.6, 12, 12);
    const bodyMat = new THREE.MeshLambertMaterial({ color: playerData.skin });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.scale.y = 1.5;
    body.position.y = 0.5;
    group.add(body);

    // Bean head
    const headGeo = new THREE.SphereGeometry(0.45, 12, 12);
    const headMat = new THREE.MeshLambertMaterial({ color: playerData.skin });
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.y = 1.6;
    group.add(head);

    // Smiley eyes
    const eyeGeo = new THREE.SphereGeometry(0.06, 6, 6);
    const eyeMat = new THREE.MeshLambertMaterial({ color: 0x000000 });
    const leftEye = new THREE.Mesh(eyeGeo, eyeMat);
    leftEye.position.set(-0.15, 1.7, 0.4);
    group.add(leftEye);
    const rightEye = new THREE.Mesh(eyeGeo, eyeMat);
    rightEye.position.set(0.15, 1.7, 0.4);
    group.add(rightEye);

    // Username label (simple box above head)
    group.position.set(playerData.x, playerData.y, playerData.z);
    scene.add(group);
    otherMeshes[playerData.id] = group;
}

function showBulletTrail(origin, direction){
    if(!origin || !direction) return;
    const points = [
        new THREE.Vector3(origin.x, origin.y, origin.z),
        new THREE.Vector3(origin.x + direction.x * 50, origin.y + direction.y * 50, origin.z + direction.z * 50)
    ];
    const geo = new THREE.BufferGeometry().setFromPoints(points);
    const mat = new THREE.LineBasicMaterial({ color: 0xffff00, transparent: true, opacity: 0.8 });
    const line = new THREE.Line(geo, mat);
    scene.add(line);
    setTimeout(() => scene.remove(line), 100);
}

function setupControls(){
    const canvas = document.getElementById('gameCanvas');
    
    // Pointer lock
    canvas.addEventListener('click', () => {
        if(!isLocked && alive) canvas.requestPointerLock();
    });

    document.addEventListener('pointerlockchange', () => {
        isLocked = document.pointerLockElement === canvas;
    });

    let yaw = 0;
    let pitch = 0;

    document.addEventListener('mousemove', (e) => {
        if(!isLocked || !alive) return;
        yaw -= e.movementX * 0.002;
        pitch -= e.movementY * 0.002;
        pitch = Math.max(-Math.PI/2 + 0.01, Math.min(Math.PI/2 - 0.01, pitch));
        camera.rotation.order = 'YXZ';
        camera.rotation.y = yaw;
        camera.rotation.x = pitch;
    });

    document.addEventListener('keydown', (e) => {
        switch(e.code){
            case 'KeyW': moveForward = true; break;
            case 'KeyS': moveBack = true; break;
            case 'KeyA': moveLeft = true; break;
            case 'KeyD': moveRight = true; break;
            case 'Space': 
                if(canJump){ velocity.y += 8; canJump = false; }
                break;
            case 'KeyR': reload(); break;
            case 'Digit1': switchWeapon(currentWeapon); break;
            case 'Digit2': switchWeapon('glock'); break;
        }
    });

    document.addEventListener('keyup', (e) => {
        switch(e.code){
            case 'KeyW': moveForward = false; break;
            case 'KeyS': moveBack = false; break;
            case 'KeyA': moveLeft = false; break;
            case 'KeyD': moveRight = false; break;
        }
    });

    document.addEventListener('mousedown', (e) => {
        if(e.button === 0 && isLocked && alive){
            isShooting = true;
            shoot();
        }
    });

    document.addEventListener('mouseup', (e) => {
        if(e.button === 0) isShooting = false;
    });
}

function shoot(){
    if(!alive || isReloading) return;
    const now = Date.now();
    const weaponData = weapons[currentWeapon];
    if(!weaponData) return;
    if(now - lastShot < weaponData.fireRate) return;

    let currentAmmo = currentWeapon === 'glock' ? glockAmmo : ammo;
    if(currentAmmo <= 0){
        reload();
        return;
    }

    lastShot = now;
    if(currentWeapon === 'glock') glockAmmo--;
    else if(weaponData.ammo !== Infinity) ammo--;
    updateAmmoDisplay();

    // Raycast for hit detection
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);

    const targets = Object.values(otherMeshes);
    const intersects = raycaster.intersectObjects(targets, true);

    let hitID = null;
    let headshot = false;

    if(intersects.length > 0){
        const hitObj = intersects[0].object;
        Object.keys(otherMeshes).forEach(id => {
            if(otherMeshes[id].getObjectById(hitObj.id) !== undefined || otherMeshes[id] === hitObj.parent){
                hitID = id;
                // Simple headshot detection - if hit point is above certain height
                if(intersects[0].point.y > otherMeshes[id].position.y + 1.4){
                    headshot = true;
                }
            }
        });
    }

    socket.emit('shoot', {
        hit: hitID,
        headshot: headshot,
        weapon: currentWeapon,
        origin: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
        direction: { 
            x: -Math.sin(camera.rotation.y),
            y: Math.sin(camera.rotation.x),
            z: -Math.cos(camera.rotation.y)
        }
    });

    // Burst fire
    if(currentWeapon === 'burst'){
        setTimeout(() => { if(alive && ammo > 0){ ammo--; updateAmmoDisplay(); } }, 100);
        setTimeout(() => { if(alive && ammo > 0){ ammo--; updateAmmoDisplay(); } }, 200);
    }

    // Auto fire
    if(weaponData.auto && isShooting){
        setTimeout(() => { if(isShooting) shoot(); }, weaponData.fireRate);
    }
}

function reload(){
    if(isReloading) return;
    const weaponData = weapons[currentWeapon];
    if(!weaponData || weaponData.ammo === Infinity) return;
    isReloading = true;
    document.getElementById('reloadIndicator').style.display = 'block';
    setTimeout(() => {
        ammo = weaponData.maxAmmo;
        isReloading = false;
        document.getElementById('reloadIndicator').style.display = 'none';
        updateAmmoDisplay();
    }, weaponData.reloadTime);
}

function switchWeapon(weapon){
    currentWeapon = weapon;
    document.getElementById('currentWeapon').textContent = weapon.toUpperCase();
    updateAmmoDisplay();
    createGunModel(weapon);
    socket.emit('switchWeapon', { weapon: weapon });
}

function updateHealthBar(){
    const bar = document.getElementById('healthBarInner');
    bar.style.width = Math.max(0, health) + 'px';
    bar.style.background = health > 50 ? '#e94560' : health > 25 ? 'orange' : 'red';
}

function updateAmmoDisplay(){
    let displayAmmo;
    if(currentWeapon === 'spellbook'){
        displayAmmo = '∞/∞';
    } else if(currentWeapon === 'glock'){
        displayAmmo = glockAmmo + '/' + (weapons['glock'] ? weapons['glock'].maxAmmo : 15);
    } else {
        displayAmmo = ammo + '/' + (weapons[currentWeapon] ? weapons[currentWeapon].maxAmmo : '?');
    }
    document.getElementById('ammoCount').textContent = displayAmmo;
    document.getElementById('currentWeapon').textContent = currentWeapon.toUpperCase();
}

function addKillFeed(killer, victim, weapon){
    const feed = document.getElementById('killFeed');
    const item = document.createElement('div');
    item.className = 'killFeedItem';
    item.textContent = `${killer} killed ${victim} with ${weapon}`;
    feed.appendChild(item);
    setTimeout(() => item.remove(), 3000);
}

function updateScoreboard(){
    const sb = document.getElementById('scoreboard');
    let html = '<b>Scoreboard</b><br>';
    Object.values(players).forEach(p => {
        html += `${p.username}: ${p.kills}K / ${p.deaths}D<br>`;
    });
    sb.innerHTML = html;
}

function animate(){
    requestAnimationFrame(animate);

    const time = performance.now();
    const delta = Math.min((time - prevTime) / 1000, 0.1);
    prevTime = time;

    if(isLocked && alive){
        // Gravity
        velocity.y -= 20 * delta;

        // Get movement direction based on camera facing
        const forward = new THREE.Vector3(-Math.sin(camera.rotation.y), 0, -Math.cos(camera.rotation.y));
        const right = new THREE.Vector3(Math.cos(camera.rotation.y), 0, -Math.sin(camera.rotation.y));

        const speed = 8;
        const moveVec = new THREE.Vector3();

        if(moveForward) moveVec.add(forward);
        if(moveBack) moveVec.sub(forward);
        if(moveRight) moveVec.add(right);
        if(moveLeft) moveVec.sub(right);

        if(moveVec.length() > 0){
            moveVec.normalize().multiplyScalar(speed * delta);
        }

        camera.position.x += moveVec.x;
        camera.position.z += moveVec.z;
        camera.position.y += velocity.y * delta;

        // Void death
      if(camera.position.y < -60){
    // Fell off map, go back to lobby
    document.getElementById('gameContainer').style.display = 'none';
    document.getElementById('lobby').style.display = 'flex';
    if(socket) socket.disconnect();
    camera.position.set(0, 5, 0);
    velocity.y = 0;
    isLocked = false;
    document.exitPointerLock();
}
        // Island collision
        canJump = false;
        const islandData = getIslandData(currentMapName || 'islands1');
        islandData.forEach(island => {
            const dx = camera.position.x - island.x;
            const dz = camera.position.z - island.z;
            const dist = Math.sqrt(dx*dx + dz*dz);
            const islandTop = island.y + 1.8;
            if(dist < island.radius && camera.position.y <= islandTop + 2 && velocity.y <= 0){
                camera.position.y = islandTop + 1.8;
                velocity.y = 0;
                canJump = true;
            }
        });

        // Send position
        if(socket){
            socket.emit('move', {
                x: camera.position.x,
                y: camera.position.y,
                z: camera.position.z,
                rotY: camera.rotation.y
            });
        }

        updateScoreboard();
    }

    renderer.render(scene, camera);
}

function createGunModel(weaponName){
    // Remove old gun
    if(camera.getObjectByName('gunModel')){
        camera.remove(camera.getObjectByName('gunModel'));
    }

    const group = new THREE.Group();
    group.name = 'gunModel';

    let color = 0x333333;
    if(weaponName === 'spellbook') color = 0x8B0000;
    if(weaponName === 'rpg') color = 0x556B2F;
    if(weaponName === 'sniper') color = 0x222222;

    if(weaponName === 'spellbook'){
        // Book shape
        const bookGeo = new THREE.BoxGeometry(0.15, 0.2, 0.05);
        const bookMat = new THREE.MeshLambertMaterial({ color: 0x8B0000 });
        const book = new THREE.Mesh(bookGeo, bookMat);
        group.add(book);
        // Glowing orb on top
        const orbGeo = new THREE.SphereGeometry(0.04, 8, 8);
        const orbMat = new THREE.MeshLambertMaterial({ color: 0xff4400, emissive: 0xff2200 });
        const orb = new THREE.Mesh(orbGeo, orbMat);
        orb.position.set(0, 0.15, 0);
        group.add(orb);
    } else if(weaponName === 'rpg'){
        // Tube shape
        const tubeGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.4, 8);
        const tubeMat = new THREE.MeshLambertMaterial({ color: 0x556B2F });
        const tube = new THREE.Mesh(tubeGeo, tubeMat);
        tube.rotation.z = Math.PI / 2;
        group.add(tube);
    } else {
        // Generic gun shape - barrel
        const barrelGeo = new THREE.BoxGeometry(0.04, 0.04, 0.3);
        const barrelMat = new THREE.MeshLambertMaterial({ color: color });
        const barrel = new THREE.Mesh(barrelGeo, barrelMat);
        barrel.position.z = -0.1;
        group.add(barrel);
        // Body
        const bodyGeo = new THREE.BoxGeometry(0.06, 0.08, 0.15);
        const bodyMat = new THREE.MeshLambertMaterial({ color: color });
        const body = new THREE.Mesh(bodyGeo, bodyMat);
        body.position.set(0, -0.03, 0.05);
        group.add(body);
        // Handle
        const handleGeo = new THREE.BoxGeometry(0.05, 0.1, 0.05);
        const handleMat = new THREE.MeshLambertMaterial({ color: 0x222222 });
        const handle = new THREE.Mesh(handleGeo, handleMat);
        handle.position.set(0, -0.09, 0.08);
        group.add(handle);
        // Make sniper longer
        if(weaponName === 'sniper'){
            barrel.scale.z = 2;
            barrel.position.z = -0.2;
        }
        // Make smg shorter
        if(weaponName === 'smg'){
            barrel.scale.z = 0.7;
        }
    }

    // Position in bottom right of view
    group.position.set(0.15, -0.15, -0.3);
    camera.add(group);
    scene.add(camera);
}