// RobotAttack Game & AI Logic
// Handles both browser and simulation environments

// Environment detection
const isBrowser = typeof window !== 'undefined' && typeof document !== 'undefined';
let mcan, mctx, mcw, mch, mcm;
let mode = 'demo'; // 'demo' for browser AI demo, 'train' for RL training
if (isBrowser) {
    mcan = document.getElementById("maincanvas");
    mctx = mcan.getContext("2d");
    mcan.width = window.innerWidth;
    mcan.height = window.innerHeight;
    mcw = mcan.width;
    mch = mcan.height;
    mcm = mcw > mch ? mch : mcw;
    mode = window.RL_TRAINING ? 'train' : 'demo';
} else {
    // Simulation environment (Node.js)
    const { CanvasShim, requestAnimationFrameShim, keysDown: simKeysDown } = require('./Sim/simulate_shim');
    // Try to get screen size from environment variable if set
    let envWidth = process.env.ROBOTATTACK_SCREEN_WIDTH ? parseInt(process.env.ROBOTATTACK_SCREEN_WIDTH) : 800;
    let envHeight = process.env.ROBOTATTACK_SCREEN_HEIGHT ? parseInt(process.env.ROBOTATTACK_SCREEN_HEIGHT) : 600;
    mcan = new CanvasShim(envWidth, envHeight);
    mctx = mcan.getContext('2d');
    mcw = mcan.width;
    mch = mcan.height;
    mcm = mcw > mch ? mch : mcw;
    global.requestAnimationFrame = requestAnimationFrameShim;
    mode = process.env.RL_TRAINING ? 'train' : 'demo';
}
let timer = 0;
let yrCanShoot = true;
let keysDown = isBrowser ? [] : [];
let ledgeCount = 18;
let bc = [102/255, 77/255, 51/255];
let yrm = mcm/20;
let velChange = mch/324;

// Simulated mouse pointer (AI controlled)
let simMouseX, simMouseY;
function clampSimMouse() {
    simMouseX = Math.max(0, Math.min(mcw, simMouseX));
    simMouseY = Math.max(0, Math.min(mch, simMouseY));
}
// Initialize simulated mouse pointer in center
simMouseX = mcw / 2;
simMouseY = mch / 2;

// Game classes (Ledge, YourRobot, Robot, Laser)
class Ledge {
    constructor() {
        this.id = 0;
        this.y = randomBetween(0.1, 0.9, 0.01);
        this.x = randomBetween(0.1, 0.9, 0.01);
        this.w = randomBetween(1/16, 1/4, 0.01);
    }
    drawSelf(ctx, cw, ch) {
        let a = (this.id/(ledgeCount-1))/2+0.25;
        ctx.fillStyle = colorMix(...bc, 1-a, 0, 0, 0, a);
        ctx.fillRect((this.x-this.w/2)*cw, this.y*ch, this.w*cw, ch);
    }
}
class YourRobot {
    constructor() {
        this.health = 1;
        this.x = ledgeOrder[Math.ceil(ledgeCount/2)].x*mcw;
        this.y = ledgeOrder[Math.ceil(ledgeCount/2)].y*mch-yrm/2;
        this.velX = 0;
        this.velY = 0;
        this.lasers = [];
        this.idCounter = 0;
        this.atBottom = false;
    }
    drawSelf() {
        mctx.fillStyle = colorString(0.5, 0.5, 0.5, 1);
        mctx.fillRect(this.x-yrm/2, this.y-yrm/2, yrm, yrm);
        mctx.strokeStyle = colorString(0, 0, this.health, 1);
        mctx.lineWidth = yrm/8;
        mctx.strokeRect(this.x-yrm/4, this.y-yrm/4, yrm/2, yrm/2);
    }
}
class Robot {
    constructor(id) {
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
    shoot() {
        let laser = new Laser(this.idCounter, this, false, yourRobot.x, yourRobot.y);
        this.lasers.push(laser);
        this.idCounter ++;
    }
    drawSelf() {
        mctx.fillStyle = colorString(0.5, 0.5, 0.5, 1);
        mctx.fillRect(this.x-yrm/2, this.y-yrm/2, yrm, yrm);
        mctx.strokeStyle = colorString(this.health, this.health, 0, 1);
        mctx.lineWidth = yrm/8;
        mctx.strokeRect(this.x-yrm/4, this.y-yrm/4, yrm/2, yrm/2);
    }
    remove() {
        for (let i=0; i<robots.length; i++) {
            if (robots[i].id == this.id) {
                robots.splice(i, 1);
            }
        }
    }
    updatePhysics() {
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
            if (laser.x > mcw) laser.remove();
            if (laser.y > mch) laser.remove();
            if (laser.x < 0) laser.remove();
            if (laser.y < 0) laser.remove();
        });
    }
}
class Laser {
    constructor(id, robot, yours, tarX, tarY) {
        this.id = id;
        this.yours = yours;
        this.robot = robot;
        this.tarX = tarX;
        this.tarY = tarY;
        this.x = robot.x;
        this.y = robot.y;
        this.angle = Math.atan2(tarY-this.y, tarX-this.x);
    }
    drawSelf() {
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
    remove() {
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

// Game state setup
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
let defaultRobot = new Robot(-1);
defaultRobot.x = mcm*-2;
defaultRobot.y = mcm*-2;

// AI Policy (browser only)
let policyModel = null;
async function loadPolicyModel() {
    if (isBrowser && !policyModel) {
        policyModel = await window.tf.loadLayersModel('NNet/policy_model/model.json');
    }
}
function getStateForAI() {
    let nearest = defaultRobot;
    robots.forEach(robot => {
        if (robot.x**2 + robot.y**2 < nearest.x**2 + nearest.y**2) {
            nearest = robot;
        }
    });
    return [
        yourRobot.x / mcw,
        yourRobot.y / mch,
        yourRobot.health,
        nearest.x / mcw,
        nearest.y / mch,
        nearest.health
    ];
}
function aiStep() {
    if (!isBrowser || !policyModel || yourRobot.health <= 0) return;
    // Always shoot at the simulated mouse pointer if possible
    if (yrCanShoot) {
        clampSimMouse();
        let laser = new Laser(yourRobot.idCounter, yourRobot, true, simMouseX, simMouseY);
        yourRobot.lasers.push(laser);
        yourRobot.idCounter ++;
        yrCanShoot = false;
    }
    // Optionally, AI can move the mouse pointer here (expand RL action space)
}

// Main game loop
function drawingLoop() {
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
    // Draw simulated mouse pointer as red crosshair
    mctx.save();
    mctx.strokeStyle = "#ff0000";
    mctx.lineWidth = 3;
    mctx.beginPath();
    mctx.arc(simMouseX, simMouseY, 18, 0, 2 * Math.PI);
    mctx.moveTo(simMouseX - 12, simMouseY);
    mctx.lineTo(simMouseX + 12, simMouseY);
    mctx.moveTo(simMouseX, simMouseY - 12);
    mctx.lineTo(simMouseX, simMouseY + 12);
    mctx.stroke();
    mctx.restore();
    robots.forEach((robot)=>{
        robot.drawSelf();
    });
    yourRobot.drawSelf();
    // Draw lava
    mctx.fillStyle = colorString(0.7, 0, 0, 0.7);
    mctx.fillRect(0, mch*0.95, mcw, mch*0.05);
    // Draw blue 'A' indicator in browser
    if (isBrowser) {
        mctx.save();
        mctx.font = 'bold 40px Arial';
        mctx.textBaseline = 'bottom';
        mctx.textAlign = 'left';
        mctx.fillStyle = '#0074D9';
        mctx.strokeStyle = '#fff';
        mctx.lineWidth = 4;
        mctx.strokeText('A', 16, mch-24);
        mctx.fillText('A', 16, mch-24);
        mctx.restore();
    }
    if (yourRobot.health > 0) {
        requestAnimationFrame(drawingLoop);
    } else {
        yourRobot.health = 0;
        yourRobot.drawSelf();
    }
}

// Expose game state on window for test harnesses
if (isBrowser && typeof window !== 'undefined') {
    window.yourRobot = yourRobot;
    window.yrCanShoot = yrCanShoot;
    window.robots = robots;
    window.defaultRobot = defaultRobot;
    window.keysDown = keysDown;
    window.timer = timer;
    window.ledgeOrder = ledgeOrder;
    window.ledges = ledges;
    window.velChange = velChange;
    window.yrm = yrm;
    window.mcw = mcw;
    window.mch = mch;
    window.mcm = mcm;
    window.mcan = mcan;
    window.mctx = mctx;
}

let falling = true;
function physicsLoop() {
    yourRobot.x += yourRobot.velX;
    yourRobot.y += yourRobot.velY;
    // Clamp player robot position to stay within screen bounds
    if (yourRobot.x < yrm/2) yourRobot.x = yrm/2;
    if (yourRobot.x > mcw-yrm/2) yourRobot.x = mcw-yrm/2;
    if (yourRobot.y < yrm/2) yourRobot.y = yrm/2;
    if (yourRobot.y > mch-yrm/2) yourRobot.y = mch-yrm/2;
    falling = true;
    ledgeOrder.forEach((ledge)=>{
        if (yourRobot.y+yrm/2 > ledge.y*mch-yourRobot.velY-1) {
            if (yourRobot.y+yrm/2 < ledge.y*mch+yourRobot.velY+1) {
                if (yourRobot.x > (ledge.x-ledge.w/2)*mcw-yrm/2) {
                    if (yourRobot.x < (ledge.x+ledge.w/2)*mcw+yrm/2) {
                        falling = false;
                        yourRobot.atBottom = false;
                    }
                }
            }
        }
    });
    if (yourRobot.y+yrm/2 > mch-yourRobot.velY-1) {
        if (yourRobot.y+yrm/2 < mch+yourRobot.velY+1) {
            falling = false;
            yourRobot.atBottom = true;
        }
    }
    if (falling) {
        yourRobot.velY += velChange/4;
    } else {
        yourRobot.velY = 0;
        yourRobot.velX *= 0.95;
    }
    yourRobot.lasers.forEach((laser)=>{
        laser.x += Math.cos(laser.angle)*10;
        laser.y += Math.sin(laser.angle)*10;
        if (laser.x > mcw) laser.remove();
        if (laser.y > mch) laser.remove();
        if (laser.x < 0) laser.remove();
        if (laser.y < 0) laser.remove();
    });
    robots.forEach((robot)=>{
        robot.updatePhysics();
    });
    timer ++;
    if (timer%10 == 0) {
        yrCanShoot = true;
    }
    if (robots.length > 0) {
        yourRobot.lasers.forEach((laser)=>{
            let nearestRobot = defaultRobot;
            robots.forEach((robot)=>{
                if (robot.x**2+robot.y**2 < nearestRobot.x**2+nearestRobot.y**2) {
                    nearestRobot = robot;
                }
            });
            if (laser.x > nearestRobot.x-yrm) {
                if (laser.x < nearestRobot.x+yrm) {
                    if (laser.y > nearestRobot.y-yrm) {
                        if (laser.y < nearestRobot.y+yrm) {
                            laser.remove();
                            nearestRobot.health -= 0.2;
                        }
                    }
                }
            }
        });
    }
    robots.forEach((robot)=>{
        robot.lasers.forEach((laser)=>{
            if (laser.x > yourRobot.x-yrm/2) {
                if (laser.x < yourRobot.x+yrm/2) {
                    if (laser.y > yourRobot.y-yrm/2) {
                        if (laser.y < yourRobot.y+yrm/2) {
                            laser.remove();
                            yourRobot.health -= 0.05;
                            robot.health += 0.2;
                            if (robot.health > 1) robot.health = 1;
                        }
                    }
                }
            }
        });
        robot.health -= 1/1200;
        if (robot.health < 0) robot.remove();
    });
    if (yourRobot.y > mch-yrm*1.5) {
        yourRobot.health -= 1/180;
    }
    if (yourRobot.health < 1-1/3600) {
        yourRobot.health += 1/3600;
    }
    keysDown.forEach((keyDown)=>{
        if (keyDown.toLowerCase() == "a") {
            yourRobot.velX = velChange*-3;
        }
        if (keyDown.toLowerCase() == "d") {
            yourRobot.velX = velChange*3;
        }
        if (keyDown.toLowerCase() == "w") {
            if (!falling) {
                yourRobot.velY = velChange*-6;
            }
        }
        if (keyDown.toLowerCase() == "s") {
            if (!falling) {
                if (!yourRobot.atBottom) {
                    yourRobot.velY = velChange*3;
                }
            }
        }
        if (keyDown.toLowerCase() == "f") {
            yourRobot.velX = 0;
        }
    });
    if (isBrowser) aiStep();
    if (yourRobot.health > 0) {
        requestAnimationFrame(physicsLoop);
    }
}

// Browser: disable mouse input
if (isBrowser) {
    // No mouse event listeners
    if (window && typeof window.addEventListener === 'function') {
        window.addEventListener('DOMContentLoaded', async () => {
            await loadPolicyModel();
            physicsLoop();
            drawingLoop();
            window.aiDemoStarted = true;
            window.aiIndicatorDrawn = true;
        });
    } else {
        // Immediate initialization for test harnesses or environments without DOMContentLoaded
        (async () => {
            await loadPolicyModel();
            physicsLoop();
            drawingLoop();
            if (window) {
                window.aiDemoStarted = true;
                window.aiIndicatorDrawn = true;
            }
        })();
    }
}

// ...existing code...

// Export for simulation (must be after all definitions)
if (!isBrowser && typeof module !== 'undefined' && module.exports) {
    module.exports = {
        Ledge,
        YourRobot,
        Robot,
        Laser,
        randomBetween,
        colorString,
        getDiagonal,
        colorMix,
        physicsLoop,
        drawingLoop,
        ledgeOrder,
        ledges,
        get yourRobot() { return yourRobot; },
        set yourRobot(val) { yourRobot = val; },
        get robots() { return robots; },
        set robots(val) { robots = val; },
        get defaultRobot() { return defaultRobot; },
        set defaultRobot(val) { defaultRobot = val; },
        get keysDown() { return keysDown; },
        set keysDown(val) { keysDown = val; },
        get timer() { return timer; },
        set timer(val) { timer = val; },
        get yrCanShoot() { return yrCanShoot; },
        set yrCanShoot(val) { yrCanShoot = val; },
        velChange,
        yrm,
        mcw,
        mch,
        mcm,
        mcan,
        mctx,
        mode
    };
}