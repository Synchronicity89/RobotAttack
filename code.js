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
// Use a Set for robust key handling
let keysDown = new Set();
let ledgeCount = 18;
let bc = [102/255, 77/255, 51/255];
let yrm = mcm/20;
let velChange = mch/324;

// Level selection via query param (?level=2 enables new mechanics)
let level = 1;
try {
    const __lp = new URLSearchParams(window.location.search);
    const lv = Number(__lp.get('level'));
    if (Number.isFinite(lv) && lv >= 1) level = Math.floor(lv);
} catch {}

// Phase 1: end-of-game state and world config defaults
let gameOver = false;
let outcome = null;   // "win" | "loss"
let gameDrawn = false;
const defaultWorld = { crosshairStart: { x: 200, y: 200 }, clampPlayer: true };
let world = { ...defaultWorld };
// Best-effort load of world.json; ignore errors when not served
(async () => {
  try { const r = await fetch('/world.json', { cache: 'no-store' }); if (r.ok) world = { ...defaultWorld, ...(await r.json()) }; } catch {}
})();

// Seeded RNG via ?seed= query param using HumanLib.mulberry32 if available
let rand = Math.random;
try {
  const sp = new URLSearchParams(window.location.search);
  if (sp.has('seed') && typeof HumanLib !== 'undefined' && HumanLib.mulberry32) {
    rand = HumanLib.mulberry32(Number(sp.get('seed')));
  }
} catch {}

// Recording (gated via ?record=1)
const __sp = new URLSearchParams(window.location.search);
const recordEnabled = ['1','true'].includes((__sp.get('record') || '').toLowerCase());
const runId = (typeof HumanLib !== 'undefined' && typeof HumanLib.uuidv4 === 'function')
  ? HumanLib.uuidv4() : `run-${Date.now()}`;
const startMs = performance.now();
const recording = {
  runId,
  world: { width: 0, height: 0, crosshairStart: (typeof world !== 'undefined' && world && world.crosshairStart) ? world.crosshairStart : { x: 200, y: 200 } },
  seed: __sp.has('seed') ? Number(__sp.get('seed')) : null,
  inputs: [],
  outcome: null,
  gameDrawn: false,
  frames: 0,
  durationMs: 0
};
// Persist actual canvas world into the recording for parity
try {
  recording.world.width = mcw;
  recording.world.height = mch;
  recording.world.dpr = (typeof window !== 'undefined' && window.devicePixelRatio) ? window.devicePixelRatio : 1;
} catch {}

function randomBetween(min, max, precision){
    // Use seeded RNG
    return Math.floor((rand()*(max-min)+min)/precision)*precision;
}

class Ledge{
    constructor(){
        this.id = 0;
        this.y = randomBetween(0.1, 0.9, 0.01);
        this.x = randomBetween(0.1, 0.9, 0.01);
        this.w = randomBetween(1/16, 1/4, 0.01);
        // Level 2+: motion params (sinusoid). Default 0 keeps Level 1 unchanged.
        this.baseY = this.y;
        this.amp = (level >= 2) ? randomBetween(0.05, 0.25, 0.01) : 0;
        this.omega = (level >= 2) ? randomBetween(0.002, 0.01, 0.001) : 0;
        this.phase = rand() * Math.PI * 2;
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
        this.x = rand()*mcw; // seed-aware spawn x for determinism
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
        mctx.fillStyle = colorString(0.5, 0.5, 0, 1);
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
        let newA = angle+this.speed/Math.max(distance, 1e-6);
        let newD = distance+(this.tarD-distance)/(100/velChange);

        // compute proposed new position
        let nx = yourRobot.x+Math.cos(newA)*newD;
        let ny = yourRobot.y+Math.sin(newA)*newD;

        // Apply enemy boundary behavior
        const half = yrm/2;
        const mode = (world && world.enemyBoundaryMode) ? String(world.enemyBoundaryMode) : 'original';
        if (mode === 'splat') {
            // clamp inside arena
            nx = Math.max(half, Math.min(mcw - half, nx));
            ny = Math.max(half, Math.min(mch - half, ny));
        } else if (mode === 'bounce') {
            // reflect direction at walls and recompute position
            let a = newA;
            if (nx < half || nx > mcw - half) {
                a = Math.PI - a; // horizontal reflection
            }
            nx = yourRobot.x + Math.cos(a) * newD;
            if (ny < half || ny > mch - half) {
                a = -a; // vertical reflection
            }
            newA = a;
            nx = yourRobot.x + Math.cos(newA) * newD;
            ny = yourRobot.y + Math.sin(newA) * newD;
            // keep inside after reflection
            nx = Math.max(half, Math.min(mcw - half, nx));
            ny = Math.max(half, Math.min(mch - half, ny));
        }
        // assign
        this.x = nx;
        this.y = ny;

        // Shooting schedule
        this.shootTimes.forEach((st)=>{
            if (timer%st.d == st.v) {
                this.shoot();
            }
        });

        // Safe enemy laser updates: iterate backwards and splice
        for (let i = this.lasers.length - 1; i >= 0; i--) {
            const laser = this.lasers[i];
            laser.x += Math.cos(laser.angle)*this.speed;
            laser.y += Math.sin(laser.angle)*this.speed;
            if (laser.x > mcw || laser.y > mch || laser.x < 0 || laser.y < 0) {
                this.lasers.splice(i, 1);
            }
        }
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
    // Use seeded RNG
    return Math.floor((rand()*(max-min)+min)/precision)*precision;
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
// Level 2 mothership (optional)
let mothership = null;
// Instantiate after classes are defined; defer via setTimeout to avoid TDZ
if (level >= 2) {
    setTimeout(() => {
        try { if (!mothership) mothership = new Mothership(); } catch {}
    }, 0);
}
// Expose for tests (jsdom doesn't bind top-level let to window)
if (typeof window !== "undefined") {
    window.yourRobot = yourRobot;
    window.robots = robots;
    // Optional: dims if needed by tests
    window.mcw = mcw;
    window.mch = mch;
    // Lightweight debug stats for boundary clamp behavior
    window.__debugStats = {
        topClampFrames: 0,
        topClampUpwardVyFrames: 0,
        maxTopClampStreak: 0,
        _currTopClampStreak: 0
    };
}
// Initial shot at frame 0 toward canonical crosshairStart
{
    const cs = (world && world.crosshairStart) ? world.crosshairStart : { x: 200, y: 200 };
    const initLaser = new Laser(yourRobot.idCounter, yourRobot, true, cs.x, cs.y);
    yourRobot.lasers.push(initLaser);
    yourRobot.idCounter++;
    if (recordEnabled) {
      // Record the initial aim/shot event at frame 0
      recording.inputs.push({ frame: 0, type: 'mousemove', payload: { x: cs.x, y: cs.y } });
    }
}

let defaultRobot = new Robot(-1);
defaultRobot.x = mcm*-2;
defaultRobot.y = mcm*-2;

// Phase 1: single fixed-timestep loop
const FPS = 60;
const STEP_MS = 1000 / FPS;
let lastTs = performance.now();
let acc = 0;

function gameLoop(ts){
    acc += ts - lastTs;
    lastTs = ts;
    while (acc >= STEP_MS) {
        stepPhysics();
        acc -= STEP_MS;
    }
    drawFrame();
    if (!gameOver) requestAnimationFrame(gameLoop);
}

// Draw without scheduling
function drawFrame(){
    mctx.fillStyle = colorString(...bc, 1);
    mctx.fillRect(0, 0, mcw, mch);
    ledgeOrder.forEach((ledge)=> ledge.drawSelf(mctx, mcw, mch));
    robots.forEach((robot)=> robot.lasers.forEach((laser)=> laser.drawSelf()));
    yourRobot.lasers.forEach((laser)=> laser.drawSelf());
    if (mothership && mothership.health > 0) mothership.missiles.forEach((m)=> m.draw());
    robots.forEach((robot)=> robot.drawSelf());
    yourRobot.drawSelf();
    if (mothership && mothership.health > 0) mothership.draw();

    // HUD bar
    mctx.fillStyle = colorString(0.7, 0, 0, 0.7);
    mctx.fillRect(0, mch*0.95, mcw, mch*0.05);

    // End-of-game signage
    if (gameOver) {
        mctx.save();
        mctx.font = `bold ${Math.floor(mcm/8)}px sans-serif`;
        mctx.textAlign = "center";
        mctx.textBaseline = "middle";
        mctx.fillStyle = (outcome === "win") ? "#00ff00" : "#ff0000";
        mctx.fillText((outcome === "win") ? "Win" : "Loss", mcw/2, mch/2);
        // Small prompt to advance on win
        if (outcome === "win") {
            mctx.font = `${Math.floor(mcm/28)}px sans-serif`;
            mctx.fillStyle = "#ffffff";
            mctx.fillText("Press any key to play the next level", mcw/2, mch/2 + mcm/10);
        }
        mctx.restore();
    }
}

// One physics step; no scheduling
let falling = true;
function stepPhysics(){
    // Resolve inputs from Set
    const held = (k) => keysDown.has(k);
    if (held('a') && held('d')) {
        yourRobot.velX = 0;
    } else if (held('a')) {
        yourRobot.velX = velChange * -3;
    } else if (held('d')) {
        yourRobot.velX = velChange * 3;
    }
    if (!falling && held('w')) yourRobot.velY = velChange * -6;
    if (!falling && !yourRobot.atBottom && held('s')) yourRobot.velY = velChange * 3;
    if (held('f')) yourRobot.velX = 0;

    // Integrate
    yourRobot.x += yourRobot.velX;
    yourRobot.y += yourRobot.velY;

    // Update moving ledges (Level 2+): smooth vertical motion before collision checks
    if (level >= 2) {
        for (let i = 0; i < ledgeOrder.length; i++) {
            const L = ledgeOrder[i];
            if (L.amp && L.omega) {
                const yRaw = L.baseY + L.amp * Math.sin((timer + L.phase) * L.omega);
                L.y = yRaw;
            }
        }
    }

    // Grounding and ledges with snap
    falling = true;
    ledgeOrder.forEach((ledge)=>{
        if (yourRobot.y+yrm/2 > ledge.y*mch-yourRobot.velY-1) {
            if (yourRobot.y+yrm/2 < ledge.y*mch+yourRobot.velY+1) {
                if (yourRobot.x > (ledge.x-ledge.w/2)*mcw-yrm/2) {
                    if (yourRobot.x < (ledge.x+ledge.w/2)*mcw+yrm/2) {
                        falling = false;
                        yourRobot.atBottom = false;
                        yourRobot.y = ledge.y*mch - yrm/2;
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
            yourRobot.y = mch - yrm/2;
            yourRobot.velY = 0;
        }
    }
    if (falling) {
        yourRobot.velY += velChange/4;
    } else {
        if (!held('f')) yourRobot.velX *= 0.95;
        else yourRobot.velX = 0;
    }

    // Clamp player within screen if configured
    if (!world || world.clampPlayer !== false) {
        const half = yrm/2;
        yourRobot.x = Math.max(half, Math.min(mcw-half, yourRobot.x));
        yourRobot.y = Math.max(half, Math.min(mch-half, yourRobot.y));
        // Debug-only measurement: count frames clamped at the top boundary
        try {
            const ds = (typeof window !== 'undefined') ? window.__debugStats : null;
            if (ds) {
                const atTopClamp = (yourRobot.y <= half + 1e-6);
                if (atTopClamp) {
                    ds.topClampFrames++;
                    if (yourRobot.velY < 0) ds.topClampUpwardVyFrames++;
                    ds._currTopClampStreak++;
                } else if (ds._currTopClampStreak > 0) {
                    ds.maxTopClampStreak = Math.max(ds.maxTopClampStreak, ds._currTopClampStreak);
                    ds._currTopClampStreak = 0;
                }
            }
        } catch {}
    }

    // Player lasers: advance and safe-remove (backward)
    for (let i = yourRobot.lasers.length - 1; i >= 0; i--) {
        const laser = yourRobot.lasers[i];
        laser.x += Math.cos(laser.angle)*10;
        laser.y += Math.sin(laser.angle)*10;
        if (laser.x > mcw || laser.y > mch || laser.x < 0 || laser.y < 0) {
            yourRobot.lasers.splice(i, 1);
            continue;
        }
        // Damage nearest-to-origin robot (canonical legacy logic retained)
        if (robots.length > 0) {
            let nearestRobot = defaultRobot;
            robots.forEach((robot)=>{
                if (robot.x**2+robot.y**2 < nearestRobot.x**2+nearestRobot.y**2) {
                    nearestRobot = robot;
                }
            });
            if (laser.x > nearestRobot.x-yrm && laser.x < nearestRobot.x+yrm &&
                laser.y > nearestRobot.y-yrm && laser.y < nearestRobot.y+yrm) {
                yourRobot.lasers.splice(i, 1);
                nearestRobot.health -= 0.2;
                continue;
            }
        }
        // Level 2: also allow damaging the mothership AABB
        if (mothership && mothership.health > 0) {
            const msHalfW = mothership.w/2, msHalfH = mothership.h/2;
            if (laser.x > mothership.x - msHalfW && laser.x < mothership.x + msHalfW &&
                laser.y > mothership.y - msHalfH && laser.y < mothership.y + msHalfH) {
                yourRobot.lasers.splice(i, 1);
                mothership.health -= 0.2;
                continue;
            }
        }
    }

    // Enemy robots update and lasers; safe-remove enemy lasers
    robots.forEach((robot)=> robot.updatePhysics());
    robots.forEach((robot)=>{
        for (let i = robot.lasers.length - 1; i >= 0; i--) {
            const laser = robot.lasers[i];
            if (laser.x > yourRobot.x-yrm/2 && laser.x < yourRobot.x+yrm/2 &&
                laser.y > yourRobot.y-yrm/2 && laser.y < yourRobot.y+yrm/2) {
                robot.lasers.splice(i, 1);
                yourRobot.health -= 0.05;
                robot.health = Math.min(1, robot.health + 0.2);
            }
        }
        robot.health -= 1/1200;
        if (robot.health < 0) robot.remove();
    });

    // Level 2: mothership update and missile vs player collision
    if (mothership && mothership.health > 0) {
        mothership.update();
        for (let i = mothership.missiles.length - 1; i >= 0; i--) {
            const m = mothership.missiles[i];
            if (m.x > yourRobot.x-yrm/2 && m.x < yourRobot.x+yrm/2 &&
                m.y > yourRobot.y-yrm/2 && m.y < yourRobot.y+yrm/2) {
                mothership.missiles.splice(i, 1);
                yourRobot.health -= 0.2; // missiles hit harder
            }
        }
    }

    // Environment and regen
    if (yourRobot.y > mch-yrm*1.5) yourRobot.health -= 1/180;
    if (yourRobot.health < 1-1/3600) yourRobot.health += 1/3600;

    // Timers/cooldown
    timer++;
    if (timer % 10 === 0) yrCanShoot = true;

    // Validation snapshot (when recording is enabled)
    try {
        if (recordEnabled && recording) {
            if (!Array.isArray(recording.validation)) recording.validation = [];
            // Append every 60 frames (adjust cadence later if needed)
            if (timer % 60 === 0) {
                recording.validation.push({
                    frame: timer,
                    player: {
                        x: yourRobot ? yourRobot.x : 0,
                        y: yourRobot ? yourRobot.y : 0,
                        vx: yourRobot ? yourRobot.velX : 0,
                        vy: yourRobot ? yourRobot.velY : 0,
                        health: yourRobot ? yourRobot.health : 1
                    },
                    robotsSummary: __getRobotsSummaryForValidation()
                });
            }
        }
    } catch {}

    // End-of-game detection and telemetry (best effort)
    const noEnemies = (robots.length === 0) && (!mothership || mothership.health <= 0);
    const playerDead = yourRobot.health <= 0;
    if (noEnemies || playerDead) {
        gameDrawn = (noEnemies && playerDead);
        outcome = noEnemies ? "win" : "loss";
        if (gameDrawn) outcome = "win";
        gameOver = true;
        try {
            fetch('/telemetry', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    impl: "human",
                    outcome, gameDrawn,
                    frames: timer,
                    measuredWidth: mcw, measuredHeight: mch,
                    seed: (new URLSearchParams(window.location.search)).get('seed') || null
                })
            }).catch(()=>{});
        } catch {}
        // Save recording if enabled
        if (recordEnabled) {
          recording.outcome = outcome;
          recording.gameDrawn = gameDrawn;
          recording.frames = timer;
          recording.durationMs = Math.round(performance.now() - startMs);
          try {
            fetch('/recordings/save', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(recording)
            })
            .then(r => r.ok ? r.json() : null)
            .catch(()=>{});
          } catch {}
        }
    }
}

// Start the single game loop
requestAnimationFrame(gameLoop);

// Update key handlers to use Set
function keyDownEvent(event){
    // On win, advance to next level on any key press
    if (gameOver && outcome === 'win') {
        try {
            const url = new URL(window.location.href);
            const cur = Number(url.searchParams.get('level')) || 1;
            url.searchParams.set('level', String(cur + 1));
            // Preserve other params (e.g., seed, record)
            window.location.href = url.toString();
            return;
        } catch {
            // fallback: simple hash reload
            window.location.reload();
            return;
        }
    }

    keysDown.add((event.key || '').toLowerCase());
    if (recordEnabled) {
      recording.inputs.push({ frame: timer, type: 'keydown', payload: { key: (event.key || '').toLowerCase() } });
    }
}
document.removeEventListener("keydown", keyDownEvent);
document.addEventListener("keydown", keyDownEvent);

function keyUpEvent(event){
    keysDown.delete((event.key || '').toLowerCase());
    if (recordEnabled) {
      recording.inputs.push({ frame: timer, type: 'keyup', payload: { key: (event.key || '').toLowerCase() } });
    }
}
document.removeEventListener("keyup", keyUpEvent);
document.addEventListener("keyup", keyUpEvent);

// Mouse mapping using HumanLib.mapMouseToCanvas; fire only when off cooldown
function mcanMousemove(event){
    if (yrCanShoot && !gameOver) {
        let pt = { x: event.clientX ?? event.x, y: event.clientY ?? event.y };
        try {
            if (typeof HumanLib !== "undefined" && typeof HumanLib.mapMouseToCanvas === 'function') {
                const mapped = HumanLib.mapMouseToCanvas(event, mcan);
                if (mapped && Number.isFinite(mapped.x) && Number.isFinite(mapped.y)) pt = mapped;
            }
        } catch {}
        let laser = new Laser(yourRobot.idCounter, yourRobot, true, pt.x, pt.y);
        yourRobot.lasers.push(laser);
        yourRobot.idCounter ++;
        yrCanShoot = false;
        if (recordEnabled) {
          recording.inputs.push({ frame: timer, type: 'mousemove', payload: { x: pt.x, y: pt.y } });
        }
    }
}
mcan.removeEventListener("mousemove", mcanMousemove);
mcan.addEventListener("mousemove", mcanMousemove);
// Expose handler for tests that call it directly
if (typeof window !== "undefined") {
    window.mcanMousemove = mcanMousemove;
}

// Safe client logger (no-ops if fetch is unavailable)
function clientLog(level, msg, data) {
  try {
    if (typeof fetch !== 'function') return;
    fetch('/client-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ level, msg, data, ts: new Date().toISOString() })
    }).catch(() => {});
  } catch {}
}
// Capture errors and unhandled rejections
window.addEventListener('error', (e) => clientLog('error', e.message, { stack: e.error && e.error.stack }));
window.addEventListener('unhandledrejection', (e) => clientLog('error', 'unhandledrejection', { reason: String(e.reason) }));
// Mirror console.error
const __origConsoleError = console.error.bind(console);
console.error = function(...args) {
  clientLog('error', 'console.error', { args });
  __origConsoleError(...args);
};

// Lightweight hash for validation digests (independent of other implementations)
function __fnv1a32(str){
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return ('00000000' + h.toString(16)).slice(-8);
}

// Build a stable robots summary: count, digest over sorted tuples, and nearest-to-origin id
function __getRobotsSummaryForValidation(){
  try {
    const list = Array.isArray(robots) ? robots : [];
    const count = list.length;
    // nearest-to-origin by x^2 + y^2 (canonical targeting policy)
    let nearestToOriginId = null;
    let best = Infinity;
    for (const r of list) {
      const d2 = r.x*r.x + r.y*r.y;
      if (d2 < best) { best = d2; nearestToOriginId = r.id; }
    }
    // Sorted tuples: (id, round(x), round(y), round(health*1000))
    const body = list.slice()
      .sort((a,b)=>a.id-b.id)
      .map(r => [r.id, Math.round(r.x), Math.round(r.y), Math.round(r.health*1000)].join(':'))
      .join('|');
    const digest = 'fnv:' + __fnv1a32(body);
    return { count, digest, nearestToOriginId };
  } catch {
    return { count: 0, digest: 'fnv:00000000', nearestToOriginId: null };
  }
}

// Level 2: Mothership and heavy missiles
class Mothership {
    constructor() {
        this.health = 10;
        this.w = Math.max(yrm*3, mcm/10);
        this.h = Math.max(yrm*2, mcm/14);
        this.x = mcw/2;
        this.y = mch*0.2;
        this.velX = Math.max(velChange * 0.5, 0.5);
        this.missiles = [];
        this.idCounter = 0;
        this.firePeriod = 180; // frames between shots
    }
    update() {
        // Drift horizontally and bounce off edges
        this.x += this.velX;
        if (this.x < this.w/2 || this.x > mcw - this.w/2) this.velX *= -1;
        // Fire toward player on a schedule
        if (timer % this.firePeriod === 0) {
            const ang = Math.atan2(yourRobot.y - this.y, yourRobot.x - this.x);
            this.missiles.push(new Missile(this.idCounter++, this.x, this.y, ang));
        }
        // Advance missiles; offscreen cull handled in step loop
        for (let i = this.missiles.length - 1; i >= 0; i--) {
            this.missiles[i].step();
            const m = this.missiles[i];
            if (m.x < 0 || m.x > mcw || m.y < 0 || m.y > mch) this.missiles.splice(i, 1);
        }
    }
    draw() {
        // Body and health bar
        mctx.fillStyle = colorString(0.7, 0.1, 0.7, 1);
        mctx.fillRect(this.x - this.w/2, this.y - this.h/2, this.w, this.h);
        mctx.fillStyle = colorString(0.9, 0.2, 0.9, 1);
        const hw = this.w * (Math.max(this.health, 0) / 10);
        mctx.fillRect(this.x - this.w/2, this.y - this.h/2 - yrm/4, hw, Math.max(yrm/8, 4));
        // Missiles
        this.missiles.forEach(m => m.draw());
    }
}

class Missile {
    constructor(id, x, y, angle) {
        this.id = id;
        this.x = x; this.y = y; this.angle = angle;
        this.speed = Math.max(velChange * 2, 2);
        this.r = Math.max(yrm/6, 4);
    }
    step() {
        this.x += Math.cos(this.angle) * this.speed;
        this.y += Math.sin(this.angle) * this.speed;
    }
    draw() {
        mctx.fillStyle = colorString(1, 0.3, 0.1, 1);
        mctx.beginPath();
        mctx.arc(this.x, this.y, this.r, 0, Math.PI*2);
        mctx.fill();
    }
}