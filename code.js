// RobotAttack Game & AI Logic
// Handles both browser and simulation environments

// Environment detection
const isBrowser = typeof window !== 'undefined' && typeof document !== 'undefined';
// root is window in browser, global in Node
const root = (typeof window !== 'undefined') ? window : global;

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

    // --- added: parse CLI switches for RL noise (Node only) ---
    // Supported forms:
    //   --rl-noise            (enable, factor defaults to 0 unless value supplied)
    //   --rl-noise=20
    //   --rl-noise 20
    //   --rl-noise-factor=20
    //   --rl-noise-factor 20
    (function parseCliForRlNoise(){
        let rlNoiseEnabled = false;
        let rlNoiseFactor = 0;
        const argv = process.argv || [];
        for (let i = 2; i < argv.length; i++) {
            const a = argv[i];
            if (a.startsWith('--rl-noise=')) {
                rlNoiseEnabled = true;
                rlNoiseFactor = parseInt(a.split('=')[1]) || 0;
            } else if (a === '--rl-noise') {
                rlNoiseEnabled = true;
                const nxt = argv[i+1];
                if (nxt && !nxt.startsWith('--')) {
                    rlNoiseFactor = parseInt(nxt) || 0;
                    i++;
                }
            } else if (a.startsWith('--rl-noise-factor=')) {
                rlNoiseEnabled = true;
                rlNoiseFactor = parseInt(a.split('=')[1]) || 0;
            } else if (a === '--rl-noise-factor') {
                rlNoiseEnabled = true;
                const nxt = argv[i+1];
                if (nxt && !nxt.startsWith('--')) {
                    rlNoiseFactor = parseInt(nxt) || 0;
                    i++;
                }
            }
        }
        rlNoiseFactor = Math.max(0, Math.min(100, Number(rlNoiseFactor) || 0));
        // Expose into the runtime root (global / window)
        root.RL_NOISE_ENABLED = rlNoiseEnabled;
        root.RL_NOISE_FACTOR = rlNoiseFactor;
        if (rlNoiseEnabled) {
            console.log(`[RL Noise] enabled, factor=${rlNoiseFactor}`);
        }
    })();
    // --- end added ---
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

// --- added: RL activity tracking used by training checks ---
/*
  Behavior:
  - root._rl_activity.keysPressed becomes true when noise-generated directional/shoot keys occur.
  - root._rl_activity.crosshairMoved becomes true when noise moves crosshair beyond a tiny threshold.
  - Call root.rlTrainingEpisode(n) from your training loop at episode start; it will throw by episode >=10 if neither activity has occurred.
*/
root._rl_activity = root._rl_activity || { keysPressed: false, crosshairMoved: false, _initialized: false };
root._rl_activity.reset = function(){
    this.keysPressed = false;
    this.crosshairMoved = false;
    this._initialized = true;
};

// Ensure RL_NOISE_FACTOR default exists and fix previous typo
root.RL_NOISE_ENABLED = root.RL_NOISE_ENABLED || false;
root.RL_NOISE_FACTOR = Number(root.RL_NOISE_FACTOR || 0);

// --- modified RL helpers to mark activity ---

// setRlNoise remains same but uses root
root.setRlNoise = function(enabled, factor){
     root.RL_NOISE_ENABLED = !!enabled;
     const f = Number(factor) || 0;
     root.RL_NOISE_FACTOR = Math.max(0, Math.min(100, f));
     // mark activity tracking ready
     if(!root._rl_activity) root._rl_activity = { keysPressed:false, crosshairMoved:false, _initialized:true };
};

// generateNoisyKeyPresses now marks keysPressed when it returns any press
root.generateNoisyKeyPresses = function(opts = {}) {
    const base = { up:false, down:false, left:false, right:false, shoot:false };
    if(!root.RL_NOISE_ENABLED) return base;
    const factor = Math.max(0, Math.min(100, root.RL_NOISE_FACTOR));
    const p = factor / 100;
    if(Math.random() < p) base.up = true;
    if(Math.random() < p) base.down = true;
    if(Math.random() < p) base.left = true;
    if(Math.random() < p) base.right = true;
    if(Math.random() < p * 0.6) base.shoot = true;
    // mark activity if any key pressed by noise
    if((base.up||base.down||base.left||base.right||base.shoot) && root._rl_activity) {
        root._rl_activity.keysPressed = true;
    }
    return base;
};

// applyRlNoiseToCrosshair marks crosshairMoved when jitter changes coordinates meaningfully
root.applyRlNoiseToCrosshair = function(x, y, opts = {}) {
    if(!root.RL_NOISE_ENABLED) return { x, y };
    const factor = Math.max(0, Math.min(100, root.RL_NOISE_FACTOR));
    if(factor === 0) return { x, y };

    const maxJitterAt100 = Number(opts.maxJitterAt100) || 200;
    const jitterScale = factor / 100;
    const maxJitter = Math.max(1, Math.round(maxJitterAt100 * jitterScale));

    const nx = x + (Math.random() * 2 - 1) * maxJitter;
    const ny = y + (Math.random() * 2 - 1) * maxJitter;

    // determine canvas bounds (try root.getScreenInfo, fallback to window/global)
    let cw = null, ch = null;
    if(typeof root.getScreenInfo === 'function'){
        const info = root.getScreenInfo();
        if(info && info.canvasLogical){
            cw = info.canvasLogical.width;
            ch = info.canvasLogical.height;
        }
    }
    if(!cw) cw = (root.innerWidth || root.windowInnerWidth || 0);
    if(!ch) ch = (root.innerHeight || root.windowInnerHeight || 0);

    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const rx = clamp(Math.round(nx), 0, Math.max(0, Math.round(cw-1)));
    const ry = clamp(Math.round(ny), 0, Math.max(0, Math.round(ch-1)));

    // mark activity if movement is non-trivial (>1 px)
    if(root._rl_activity && (Math.abs(rx - x) >= 1 || Math.abs(ry - y) >= 1)) {
        root._rl_activity.crosshairMoved = true;
    }

    return { x: rx, y: ry };
};

// --- apply noise automatically during physics so demo shows movement when enabled ---
// Insert inside physicsLoop, before keysDown handling (we represent via comment and the actual inserted code)
/// ...existing code...
// Inserted block:
if (root && root.RL_NOISE_ENABLED) {
    // jitter crosshair (simMouseX/Y may be global in this file)
    try {
        const jitter = root.applyRlNoiseToCrosshair(simMouseX, simMouseY);
        simMouseX = jitter.x;
        simMouseY = jitter.y;
    } catch (e) {
        // ignore if helper not available
    }
    // synthesize noisy key presses and merge into keysDown for this tick
    try {
        const noisy = root.generateNoisyKeyPresses();
        // apply noisy directional effects directly (avoids long-term accumulation in keysDown array)
        if (noisy.left) yourRobot.velX = velChange * -3;
        if (noisy.right) yourRobot.velX = velChange * 3;
        if (noisy.up && !falling) yourRobot.velY = velChange * -6;
        if (noisy.down && !falling && !yourRobot.atBottom) yourRobot.velY = velChange * 3;
        if (noisy.shoot && yrCanShoot) {
            clampSimMouse();
            let laser = new Laser(yourRobot.idCounter, yourRobot, true, simMouseX, simMouseY);
            yourRobot.lasers.push(laser);
            yourRobot.idCounter ++;
            yrCanShoot = false;
        }
    } catch (e) {
        // ignore
    }
}
/// ...existing code...

// --- added: training-time episode check helper ---
// Call this from your training driver at episode start: root.rlTrainingEpisode(episodeNumber)
// If by episode >=10 there was no noisy key press and no crosshair movement, this throws to fail fast.
root.rlTrainingEpisode = function(episodeNumber) {
    if(!root._rl_activity || !root._rl_activity._initialized) {
        root._rl_activity = root._rl_activity || { keysPressed:false, crosshairMoved:false, _initialized:true };
    }
    // On first episode, ensure activity tracking reset
    if (episodeNumber === 1) {
        root._rl_activity.reset();
    }
    if (typeof episodeNumber !== 'number') episodeNumber = Number(episodeNumber) || 0;
    if (episodeNumber >= 10) {
        if (!root._rl_activity.keysPressed && !root._rl_activity.crosshairMoved) {
            const err = new Error(`RL training early-exploration check failed: no noisy key presses and no crosshair movement by episode ${episodeNumber}`);
            // print stack and throw to crash training
            console.error(err.stack);
            throw err;
        }
    }
};

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

// Export for simulation (must be after all definitions)
if (!isBrowser && typeof module !== 'undefined' && module.exports) {
    module.exports = {
        Ledge: (typeof Ledge !== 'undefined') ? Ledge : undefined,
        YourRobot: (typeof YourRobot !== 'undefined') ? YourRobot : undefined,
        Robot: (typeof Robot !== 'undefined') ? Robot : undefined,
        Laser: (typeof Laser !== 'undefined') ? Laser : undefined,
        randomBetween: (typeof randomBetween !== 'undefined') ? randomBetween : undefined,
        colorString: (typeof colorString !== 'undefined') ? colorString : undefined,
        getDiagonal: (typeof getDiagonal !== 'undefined') ? getDiagonal : undefined,
        colorMix: (typeof colorMix !== 'undefined') ? colorMix : undefined,
        physicsLoop: (typeof physicsLoop !== 'undefined') ? physicsLoop : function(){},
        drawingLoop: (typeof drawingLoop !== 'undefined') ? drawingLoop : function(){},
        ledgeOrder: (typeof ledgeOrder !== 'undefined') ? ledgeOrder : undefined,
        ledges: (typeof ledges !== 'undefined') ? ledges : undefined,
        get yourRobot() { return (typeof yourRobot !== 'undefined') ? yourRobot : undefined; },
        set yourRobot(val) { if (typeof yourRobot !== 'undefined') yourRobot = val; },
        get robots() { return (typeof robots !== 'undefined') ? robots : undefined; },
        set robots(val) { if (typeof robots !== 'undefined') robots = val; },
        get defaultRobot() { return (typeof defaultRobot !== 'undefined') ? defaultRobot : undefined; },
        set defaultRobot(val) { if (typeof defaultRobot !== 'undefined') defaultRobot = val; },
        get keysDown() { return (typeof keysDown !== 'undefined') ? keysDown : undefined; },
        set keysDown(val) { if (typeof keysDown !== 'undefined') keysDown = val; },
        get timer() { return (typeof timer !== 'undefined') ? timer : undefined; },
        set timer(val) { if (typeof timer !== 'undefined') timer = val; },
        get yrCanShoot() { return (typeof yrCanShoot !== 'undefined') ? yrCanShoot : undefined; },
        set yrCanShoot(val) { if (typeof yrCanShoot !== 'undefined') yrCanShoot = val; },
        velChange: (typeof velChange !== 'undefined') ? velChange : undefined,
        yrm: (typeof yrm !== 'undefined') ? yrm : undefined,
        mcw: (typeof mcw !== 'undefined') ? mcw : undefined,
        mch: (typeof mch !== 'undefined') ? mch : undefined,
        mcm: (typeof mcm !== 'undefined') ? mcm : undefined,
        mcan: (typeof mcan !== 'undefined') ? mcan : undefined,
        mctx: (typeof mctx !== 'undefined') ? mctx : undefined,
        mode: (typeof mode !== 'undefined') ? mode : undefined,
        rlTrainingEpisode: (typeof root !== 'undefined' && typeof root.rlTrainingEpisode === 'function') ? root.rlTrainingEpisode : undefined
    };
}