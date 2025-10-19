let mcan = document.getElementById("maincanvas");
let mctx = mcan.getContext("2d");
mcan.width = window.innerWidth;
mcan.height = window.innerHeight;
let mcw = mcan.width;
let mch = mcan.height;
let mcm = 0;
if (mcw > mch) {
    mcm = mch;
} else {
    mcm = mcw;
}
let timer = 0;
let yrCanShoot = true;
// Replace array with a Set for robust key handling
let keysDown = new Set();
let ledgeCount = 18;
let bc = [102/255, 77/255, 51/255];
let yrm = mcm/20;
let velChange = mch/324;

// Add end-of-game state (used by drawingLoop/startGame)
let gameOver = false;
let outcome = null;     // "win" | "loss"
let gameDrawn = false;

// Expose canvas dims for tests
if (typeof window !== "undefined") {
    window.mcw = mcw;
    window.mch = mch;
}

class Ledge{
    constructor(){
        this.id = 0;
        this.y = randomBetween(0.1, 0.9, 0.01);
        this.x = randomBetween(0.1, 0.9, 0.01);
        this.w = randomBetween(1/16, 1/4, 0.01);
    }
    drawSelf(ctx, cw, ch){
        let a = (this.id/(ledgeCount-1))/2+0.25;
        ctx.fillStyle = colorMix(...bc, 1-a, 0, 0, 0, a);
        ctx.fillRect((this.x-this.w/2)*cw, this.y*ch, this.w*cw, ch);
    }
}

class YourRobot{
    constructor(){
        this.health = 1;
        this.x = ledgeOrder[Math.ceil(ledgeCount/2)].x*mcw;
        this.y = ledgeOrder[Math.ceil(ledgeCount/2)].y*mch-yrm/2;
        this.velX = 0;
        this.velY = 0;
        this.lasers = [];
        this.idCounter = 0;
        this.atBottom = false;
    }
    drawSelf(){
        mctx.fillStyle = colorString(0.5, 0.5, 0.5, 1);
        mctx.fillRect(this.x-yrm/2, this.y-yrm/2, yrm, yrm);
        mctx.strokeStyle = colorString(0, 0, this.health, 1);
        mctx.lineWidth = yrm/8;
        mctx.strokeRect(this.x-yrm/4, this.y-yrm/4, yrm/2, yrm/2);
    }
}

class Robot{
    constructor(id){
        this.health = 1;
        this.id = id;
        this.x = Math.random()*mcw;
        this.y = mch;
        this.speed = velChange*3;
        this.lasers = [];
        this.idCounter = 0;
        this.tarD = randomBetween(mcm/8, mcm/2, 1);
        this.shootTimes = [];
        for (let i=0; i<randomBetween(1, 3, 1); i++) {
            let info = {d: 0, v: 0};
            info.d = randomBetween(120, 360, 1);
            info.v = randomBetween(0, info.d, 1);
            this.shootTimes.push(info);
        }
        this.laserSpeed = randomBetween(2, 11, 1);
    }
    shoot(){
        let laser = new Laser(this.idCounter, this, false, yourRobot.x, yourRobot.y);
        this.lasers.push(laser);
        this.idCounter ++;
    }
    drawSelf(){
        mctx.fillStyle = colorString(0.5, 0.5, 0.5, 1);
        mctx.fillRect(this.x-yrm/2, this.y-yrm/2, yrm, yrm);
        mctx.strokeStyle = colorString(this.health, this.health, 0, 1);
        mctx.lineWidth = yrm/8;
        mctx.strokeRect(this.x-yrm/4, this.y-yrm/4, yrm/2, yrm/2);
    }
    remove(){
        for (let i=0; i<robots.length; i++) {
            if (robots[i].id == this.id) {
                robots.splice(i, 1);
            }
        }
    }
    updatePhysics(){
        let angle = Math.atan2(this.y-yourRobot.y, this.x-yourRobot.x);
        let distance = getDiagonal(this.x-yourRobot.x, this.y-yourRobot.y);
        let newA = angle+this.speed/distance;
        let newD = distance+(this.tarD-distance)/(100/velChange);
        this.x = yourRobot.x+Math.cos(newA)*newD;
        this.y = yourRobot.y+Math.sin(newA)*newD;

        this.shootTimes.forEach((st)=>{
            if (timer%st.d == st.v) {
                this.shoot();
            }
        });

        this.lasers.forEach((laser)=>{
            laser.x += Math.cos(laser.angle)*this.speed;
            laser.y += Math.sin(laser.angle)*this.speed;
            if (laser.x > mcw) {
                laser.remove();
            }
            if (laser.y > mch) {
                laser.remove();
            }
            if (laser.x < 0) {
                laser.remove();
            }
            if (laser.y < 0) {
                laser.remove();
            }
        });
    }
}

class Laser{
    constructor(id, robot, yours, tarX, tarY){
        this.id = id;
        this.yours = yours;
        this.robot = robot;
        this.tarX = tarX;
        this.tarY = tarY;
        this.x = robot.x;
        this.y = robot.y;
        this.angle = Math.atan2(tarY-this.y, tarX-this.x);
    }
    drawSelf(){
        if (this.yours) {
            mctx.strokeStyle = "#0000ff";
        } else {
            mctx.strokeStyle = "#ffff00";
        }
        mctx.lineWidth = 5;
        mctx.beginPath();
        mctx.moveTo(this.x-Math.cos(this.angle)*10, this.y-Math.sin(this.angle)*10);
        mctx.lineTo(this.x+Math.cos(this.angle)*10, this.y+Math.sin(this.angle)*10);
        mctx.stroke();
    }
    remove(){
        for (let i=0; i<this.robot.lasers.length; i++) {
            if (this.robot.lasers[i].id == this.id) {
                this.robot.lasers.splice(i, 1);
            }
        }
    }
}

function randomBetween(min, max, precision){
    return Math.floor((Math.random()*(max-min)+min)/precision)*precision;
}

function colorString(r, g, b, a){
    r = Math.floor(r*255)*256*256*256;
    g = Math.floor(g*255)*256*256;
    b = Math.floor(b*255)*256;
    a = Math.floor(a*255);
    return "#"+(r+g+b+a).toString(16).padStart(8, "0");
}

function getDiagonal(a, b){
    return(Math.sqrt(a**2+b**2));
}

function colorMix(r1, g1, b1, a1, r2, g2, b2, a2){
    let r = r1*a1+r2*a2;
    let g = g1*a1+g2*a2;
    let b = b1*a1+b2*a2;
    let a = a1+a2;
    return colorString(r, g, b, a);
}

let ledges = [];
for (let i=0; i<ledgeCount; i++) {
    let ledge = new Ledge();
    ledges.push(ledge);
}
let ledgeOrder = [];
while (ledges.length > 0) {
    let highest = {item: 0, y: 1};
    for (let i=0; i<ledges.length; i++) {
        if (ledges[i].y < highest.y) {
            highest.item = i;
            highest.y = ledges[i].y;
        }
    }
    ledges[highest.item].id = ledgeOrder.length;
    ledgeOrder.push(ledges[highest.item]);
    ledges.splice(highest.item, 1);
}

let yourRobot = new YourRobot();
let robots = [];
for (let i=0; i<12; i++) {
    let robot = new Robot(robots.length);
    robots.push(robot);
}

// Expose globals for integration tests
if (typeof window !== "undefined") {
    window.yourRobot = undefined;
    window.robots = undefined;
    window.timer = 0;
    window.mcw = mcw;
    window.mch = mch;
}

// Expose after creation
if (typeof window !== "undefined") {
    window.yourRobot = yourRobot;
    window.robots = robots;
}

let defaultRobot = new Robot(-1);
defaultRobot.x = mcm*-2;
defaultRobot.y = mcm*-2;

function drawingLoop(){
    mctx.fillStyle = colorString(...bc, 1);
    mctx.fillRect(0, 0, mcw, mch);
    ledgeOrder.forEach((ledge)=>{
        ledge.drawSelf(mctx, mcw, mch);
    });
    robots.forEach((robot)=>{
        robot.lasers.forEach((laser)=>{
            laser.drawSelf();
        });
    });
    yourRobot.lasers.forEach((laser)=>{
        laser.drawSelf();
    });
    robots.forEach((robot)=>{
        robot.drawSelf();
    });
    yourRobot.drawSelf();
    mctx.fillStyle = colorString(0.7, 0, 0, 0.7);
    mctx.fillRect(0, mch*0.95, mcw, mch*0.05);

    // End-of-game signage (uses outcome)
    if (gameOver) {
        mctx.save();
        mctx.font = `${Math.floor(mcm/8)}px sans-serif`;
        mctx.textAlign = "center";
        mctx.textBaseline = "middle";
        mctx.fillStyle = (outcome === "win") ? "#00ff00" : "#ff0000";
        mctx.fillText((outcome === "win") ? "Win" : "Loss", mcw/2, mch/2);
        mctx.restore();
    }

    if (!gameOver && yourRobot.health > 0) {
        requestAnimationFrame(drawingLoop);
    } else if (!gameOver) {
        yourRobot.health = 0;
        yourRobot.drawSelf();
    }
}

let falling = true;
function physicsLoop(){
    // Resolve inputs using canonical policy (HumanLib if available)
    let resolved = { velX: 0, jump: false, drop: false, brake: false };
    if (typeof HumanLib !== "undefined" && HumanLib.resolveInputs) {
        resolved = HumanLib.resolveInputs(keysDown, falling, yourRobot.atBottom, velChange);
    } else {
        // Fallback to original simple behavior if HumanLib not present
        if (keysDown.has("a")) resolved.velX = velChange*-3;
        if (keysDown.has("d")) resolved.velX = velChange*3;
        if (keysDown.has("w") && !falling) resolved.jump = true;
        if (keysDown.has("s") && !falling && !yourRobot.atBottom) resolved.drop = true;
        if (keysDown.has("f")) resolved.brake = true;
    }

    // Apply resolved inputs
    yourRobot.velX = resolved.velX;
    if (resolved.jump) yourRobot.velY = velChange * -6;
    if (resolved.drop) yourRobot.velY = velChange * 3;

    // Integrate position
    yourRobot.x += yourRobot.velX;
    yourRobot.y += yourRobot.velY;

    // Grounding and ledge collisions (snap to surface)
    falling = true;
    ledgeOrder.forEach((ledge)=>{
        if (yourRobot.y+yrm/2 > ledge.y*mch-yourRobot.velY-1) {
            if (yourRobot.y+yrm/2 < ledge.y*mch+yourRobot.velY+1) {
                if (yourRobot.x > (ledge.x-ledge.w/2)*mcw-yrm/2) {
                    if (yourRobot.x < (ledge.x+ledge.w/2)*mcw+yrm/2) {
                        falling = false;
                        yourRobot.atBottom = false;
                        yourRobot.y = ledge.y*mch - yrm/2; // snap
                        yourRobot.velY = 0;
                    }
                }
            }
        }
    });
    if (yourRobot.y+yrm/2 > mch-yourRobot.velY-1) {
        if (yourRobot.y+yrm/2 < mch+yourRobot.velY+1) {
            falling = false;
            yourRobot.atBottom = true;
            yourRobot.y = mch - yrm/2; // snap
            yourRobot.velY = 0;
        }
    }
    if (falling) {
        yourRobot.velY += velChange/4;
    } else {
        if (resolved.brake) yourRobot.velX = 0;
        else yourRobot.velX *= 0.95;
    }

    // Clamp player to screen
    yourRobot.x = Math.max(yrm/2, Math.min(mcw-yrm/2, yourRobot.x));
    yourRobot.y = Math.max(yrm/2, Math.min(mch-yrm/2, yourRobot.y));

    // Player lasers: continuous collision detection against enemy AABBs, safe backward iteration
    for (let i = yourRobot.lasers.length - 1; i >= 0; i--) {
        const laser = yourRobot.lasers[i];
        const x0 = laser.x, y0 = laser.y;
        const x1 = laser.x + Math.cos(laser.angle)*10;
        const y1 = laser.y + Math.sin(laser.angle)*10;

        // Find nearest intersection
        let bestIdx = -1, bestT = Infinity;
        for (let r = 0; r < robots.length; r++) {
            const rb = robots[r];
            const minX = rb.x - yrm/2, maxX = rb.x + yrm/2;
            const minY = rb.y - yrm/2, maxY = rb.y + yrm/2;
            const hit = (typeof HumanLib !== "undefined" && HumanLib.segmentIntersectsAABB)
                ? HumanLib.segmentIntersectsAABB(x0, y0, x1, y1, minX, minY, maxX, maxY)
                : { hit: (x1 > minX && x1 < maxX && y1 > minY && y1 < maxY), tEnter: 1 };
            if (hit.hit && hit.tEnter < bestT) {
                bestT = hit.tEnter;
                bestIdx = r;
            }
        }

        // Advance and cull
        laser.x = x1;
        laser.y = y1;
        if (laser.x > mcw || laser.y > mch || laser.x < 0 || laser.y < 0) {
            yourRobot.lasers.splice(i, 1);
            continue;
        }

        // Apply damage to nearest intersected robot and remove laser
        if (bestIdx >= 0) {
            yourRobot.lasers.splice(i, 1);
            robots[bestIdx].health -= 0.2;
        }
    }

    // Enemy robots update and their lasers
    robots.forEach((robot)=>{
        robot.updatePhysics();
    });

    timer ++;
    if (typeof window !== "undefined") window.timer = timer;
    if (timer%10 == 0) {
        yrCanShoot = true;
    }

    // Enemy laser collisions and decay
    robots.forEach((robot)=>{
        for (let i = robot.lasers.length - 1; i >= 0; i--) {
            const laser = robot.lasers[i];
            if (laser.x > yourRobot.x-yrm/2 && laser.x < yourRobot.x+yrm/2 &&
                laser.y > yourRobot.y-yrm/2 && laser.y < yourRobot.y+yrm/2) {
                robot.lasers.splice(i, 1);
                yourRobot.health -= 0.2;
            } else {
                // Optional: add decay over time/distance
                let decay = Math.floor(timer/100);
                if (decay > 0) {
                    laser.x -= Math.cos(laser.angle)*decay;
                    laser.y -= Math.sin(laser.angle)*decay;
                }
            }
        }
    });

    // Check for game over conditions
    if (yourRobot.health <= 0) {
        gameOver = true;
        outcome = "loss";
    }
    if (robots.every(robot => robot.health <= 0)) {
        gameOver = true;
        outcome = "win";
    }

    if (!gameOver && yourRobot.health > 0) {
        requestAnimationFrame(physicsLoop);
    }
}

// Replace immediate starts with a safe starter to avoid race conditions
function startGame() {
    try {
        // Kick off loops only once
        if (typeof startGame.started !== 'boolean' || !startGame.started) {
            startGame.started = true;
            physicsLoop();
            drawingLoop();
        }
    } catch (e) {
        console.error('Failed to start game loops:', e);
    }
}
window.addEventListener('load', startGame);

// Remove or comment the original immediate calls to prevent double-start
// physicsLoop();
// drawingLoop();

// Key handlers now operate on Set and lower-case
function keyDownEvent(event){
    keysDown.add((event.key || '').toLowerCase());
}
document.removeEventListener("keydown", keyDownEvent);
document.addEventListener("keydown", keyDownEvent);

function keyUpEvent(event){
    keysDown.delete((event.key || '').toLowerCase());
}
document.removeEventListener("keyup", keyUpEvent);
document.addEventListener("keyup", keyUpEvent);

// DPI/layout-aware mouse mapping; expose handler for tests
function mcanMousemove(event){
    if (yrCanShoot) {
        const rect = (typeof mcan.getBoundingClientRect === 'function')
            ? mcan.getBoundingClientRect()
            : { left: 0, top: 0, width: mcan.width, height: mcan.height };
        const cx = (event.clientX != null ? event.clientX : event.x) - rect.left;
        const cy = (event.clientY != null ? event.clientY : event.y) - rect.top;
        const x = cx * (mcan.width / (rect.width || mcan.width));
        const y = cy * (mcan.height / (rect.height || mcan.height));
        let laser = new Laser(yourRobot.idCounter, yourRobot, true, x, y);
        yourRobot.lasers.push(laser);
        yourRobot.idCounter ++;
        yrCanShoot = false;
    }
}
if (typeof window !== "undefined") window.mcanMousemove = mcanMousemove;
mcan.removeEventListener("mousemove", mcanMousemove);
mcan.addEventListener("mousemove", mcanMousemove);