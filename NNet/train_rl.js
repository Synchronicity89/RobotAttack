'use strict';

/*
RL Training harness for RobotAttack using the headless Sim (Sim/sim.js).

Goals:
- Early training: high activity (frequent key presses and crosshair moves).
- As training improves: reduced unnecessary activity when it helps win.
- Use available hardware: prefer GPU backend if present; count logical CPUs.

Usage:
  node NNet/train_rl.js --episodes=20 --max-steps=1500 --seed=1337 
  node NNet/train_rl.js --episodes=50 --save-dir=./NNet/policy_model

Notes:
- This is a starting point (REINFORCE). It collects simple trajectories and updates the policy.
- Exploration/noise anneals over episodes, yielding visible behavior changes in AI Demo.
*/

const path = require('path');
const fs = require('fs');
const os = require('os');
const { SimGame } = require('../Sim/sim.js');
const TU = require('./train_utils');
const { detectHardware } = require('./hardware');

function parseArgs() {
  const argv = process.argv.slice(2);
  const out = Object.create(null);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const [k, v] = a.includes('=') ? a.split('=') : [a, null];
    const key = k.replace(/^--/, '');
    out[key] = v != null ? v : true;
  }
  return out;
}

const args = parseArgs();
const EPISODES = Number(args.episodes || 10);
// Default horizon set a bit higher to allow Level 2 robots to decay below 0
const MAX_STEPS = Number(args['max-steps'] || 1800);
const GAMMA = Number(args.gamma || 0.99);
const SAVE_DIR = String(args['save-dir'] || path.join(__dirname, 'policy_model'));
const SEED = args.seed != null ? Number(args.seed) : null;
const LEVEL_ARG = (args.level || '1'); // '1' | '2' | 'all'
const MODE = String(args.mode || 'diagnostic').toLowerCase() === 'realistic' ? 'realistic' : 'diagnostic';
// Observation precision config (quantize to ~two decimal digits by default)
const OBS_DIGITS = Number(args['obs-digits'] != null ? args['obs-digits'] : 2);
const OBS_BITS = Number(args['obs-bits'] != null ? args['obs-bits'] : NaN);
function quantizeFloat(val) {
  // Prefer decimal digits if provided, else approximate from bits
  const digits = Number.isFinite(OBS_DIGITS) ? Math.max(0, Math.floor(OBS_DIGITS)) : 2;
  const k = Math.pow(10, digits);
  return Math.round(val * k) / k;
}
// Versioning for training compatibility: Major.Minor.Revision (bump minor on input schema changes)
const TRAINING_VERSION = { major: 1, minor: 1, revision: 0 };
const TRAINING_VERSION_STR = `${TRAINING_VERSION.major}.${TRAINING_VERSION.minor}.${TRAINING_VERSION.revision}`;
// Diagnostics logging controls
const LOG_SHAPING = (args['log-shaping'] == null) ? true : String(args['log-shaping']).toLowerCase() !== 'false';

// Hardware and TF backend selection (backend finalized inside main())
const hw = detectHardware();
const tf = hw.tf;
// Hint the WASM backend to use more threads (if supported) before backend init
if (process.env.TFJS_NUM_THREADS == null && Number.isFinite(hw.logicalCPUs)) {
  const threads = Math.max(1, Math.min(hw.logicalCPUs, 32));
  process.env.TFJS_NUM_THREADS = String(threads);
}

// Build policy network
function buildPolicy(inputSize) {
  const model = tf.sequential();
  model.add(tf.layers.dense({ units: 64, activation: 'relu', inputShape: [inputSize] }));
  model.add(tf.layers.dense({ units: 64, activation: 'relu' }));
  // Outputs:
  //  - 5 key logits (A,D,W,S,F) independent Bernoulli
  //  - 2 means for aim delta (dx, dy) in [-1,1] via tanh
  // We fix std for Gaussian of aim deltas, annealed externally.
  model.add(tf.layers.dense({ units: 7, activation: 'linear' }));
  model.compile({ optimizer: tf.train.adam(1e-3), loss: 'meanSquaredError' }); // compile to allocate optimizer; we do custom grads
  return model;
}

// Try to load an existing model if training_meta.json exists and Major.Minor match
async function tryLoadExistingModel(tf, dir) {
  try {
    const metaPath = path.join(dir, 'training_meta.json');
    const modelJsonPath = path.join(dir, 'model.json');
    const weightsPath = path.join(dir, 'weights.bin');
    if (!fs.existsSync(metaPath) || !fs.existsSync(modelJsonPath) || !fs.existsSync(weightsPath)) return null;
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    const v = meta && meta.version;
    if (!v || v.major !== TRAINING_VERSION.major || v.minor !== TRAINING_VERSION.minor) return null;
    const mjson = JSON.parse(fs.readFileSync(modelJsonPath, 'utf8'));
    const wspec = (mjson.weightsManifest && mjson.weightsManifest[0] && mjson.weightsManifest[0].weights) || [];
    const wdata = fs.readFileSync(weightsPath);
    const handler = tf.io.fromMemory(mjson.modelTopology, wspec, wdata);
    const loaded = await tf.loadLayersModel(handler);
    console.log(`[train_rl] Loaded existing compatible model (v${v.major}.${v.minor}.${v.revision || 0}) from ${path.resolve(dir)}`);
    return loaded;
  } catch (e) {
    console.warn('[train_rl] Failed to load existing model:', e.message);
    return null;
  }
}

// Observation builder
function makeObservation(sim) {
  const mcw = sim.world.width, mch = sim.world.height;
  const p = sim.player;
  const robots = sim.robots || [];
  // nearest robot relative vector
  let ndx = 0, ndy = 0, nd = 1, rc = robots.length;
  if (rc > 0) {
    let best = Infinity, bx = 0, by = 0;
    for (const r of robots) {
      const dx = r.x - p.x, dy = r.y - p.y;
      const d2 = dx*dx + dy*dy;
      if (d2 < best) { best = d2; bx = dx; by = dy; }
    }
    const d = Math.sqrt(best) || 1;
    ndx = quantizeFloat(bx / Math.max(1, mcw));
    ndy = quantizeFloat(by / Math.max(1, mch));
    nd = quantizeFloat(d / Math.max(1, Math.hypot(mcw, mch)));
  }
  const robotsCountNorm = quantizeFloat(rc / 12);

  // Mothership features
  let msPresent = 0, msDx = 0, msDy = 0, msHealth = 0;
  if (sim.mothership && sim.mothership.health > 0) {
    msPresent = 1;
    msDx = quantizeFloat((sim.mothership.x - p.x) / Math.max(1, mcw));
    msDy = quantizeFloat((sim.mothership.y - p.y) / Math.max(1, mch));
    msHealth = quantizeFloat(Math.max(0, Math.min(1, sim.mothership.health / 10)));
  }

  // Ledge perception: nearest below/above distances and moving-ledges presence
  let belowDist = 0, aboveDist = 0, movingPresent = 0;
  if (sim.ledgeOrder && sim.ledgeOrder.length) {
    let bestBelow = Infinity, bestAbove = Infinity;
    for (const L of sim.ledgeOrder) {
      if (L && typeof L.amp === 'number' && L.amp > 0) movingPresent = 1;
      const ypx = L.y * mch;
      if (ypx >= p.y) {
        const d = ypx - p.y; if (d < bestBelow) bestBelow = d;
      } else {
        const d = p.y - ypx; if (d < bestAbove) bestAbove = d;
      }
    }
    belowDist = quantizeFloat(bestBelow < Infinity ? bestBelow / Math.max(1, mch) : 0);
    aboveDist = quantizeFloat(bestAbove < Infinity ? bestAbove / Math.max(1, mch) : 0);
  }

  // Projectiles (enemy lasers + missiles): nearest-to-player and counts
  let nearestPDx = 0, nearestPDy = 0, nearestPSpeed = 0, isMissile = 0;
  let lasersCount = 0, missilesCount = 0;
  // Collect lasers from robots
  for (const rb of robots) lasersCount += (rb.lasers ? rb.lasers.length : 0);
  // Missiles
  if (sim.mothership && Array.isArray(sim.mothership.missiles)) missilesCount = sim.mothership.missiles.length;
  // Find nearest projectile
  let bestP = Infinity, bestObj = null, bestType = 'laser';
  for (const rb of robots) {
    for (const L of (rb.lasers || [])) {
      const dx = L.x - p.x, dy = L.y - p.y; const d2 = dx*dx + dy*dy;
      if (d2 < bestP) { bestP = d2; bestObj = { dx, dy, speed: rb.speed }; bestType = 'laser'; }
    }
  }
  if (sim.mothership) {
    for (const m of (sim.mothership.missiles || [])) {
      const dx = m.x - p.x, dy = m.y - p.y; const d2 = dx*dx + dy*dy;
      if (d2 < bestP) { bestP = d2; bestObj = { dx, dy, speed: m.speed }; bestType = 'missile'; }
    }
  }
  if (bestObj) {
    nearestPDx = quantizeFloat(bestObj.dx / Math.max(1, mcw));
    nearestPDy = quantizeFloat(bestObj.dy / Math.max(1, mch));
    // Normalize speed against a rough scale: velChange * 10 (~player laser speed is fixed 10)
    const scale = Math.max(1, mch / 324 * 10);
    nearestPSpeed = quantizeFloat(bestObj.speed / scale);
    isMissile = (bestType === 'missile') ? 1 : 0;
  }
  const lasersCountNorm = quantizeFloat(Math.min(1, lasersCount / 20));
  const missilesCountNorm = quantizeFloat(Math.min(1, missilesCount / 10));
  // Level conditioning (one-hot up to 3 levels; clamp >3 to index 2)
  const lv = Math.max(1, Math.floor(sim.level || 1));
  const oneHot = [0,0,0];
  oneHot[Math.min(2, lv-1)] = 1;

  const base = [
    quantizeFloat(p.x / Math.max(1, mcw)),
    quantizeFloat(p.y / Math.max(1, mch)),
    quantizeFloat(p.vx / Math.max(1, mch/20)),
    quantizeFloat(p.vy / Math.max(1, mch/20)),
    quantizeFloat(Math.max(0, Math.min(1, p.health))),
    robotsCountNorm,
    sim.yrCanShoot ? 1 : 0,
    ndx, ndy, nd,
    msPresent, msDx, msDy, msHealth,
    belowDist, aboveDist, movingPresent,
    nearestPDx, nearestPDy, nearestPSpeed, isMissile,
    lasersCountNorm, missilesCountNorm
  ];
  return base.concat(oneHot);
}

// Action sampling from policy outputs and exploration noise
function sampleAction(tf, outTensor, episodeIdx, totalEpisodes) {
  const arr = outTensor.dataSync(); // [7]
  const keyLogits = arr.slice(0, 5);
  const aimMeans = arr.slice(5, 7).map(v => Math.tanh(v));

  // Exploration schedules: early episodes -> high activity/noise; later episodes -> calmer
  const t = Math.max(0, Math.min(1, episodeIdx / Math.max(1, totalEpisodes - 1)));
  const pressBias = 0.6 * (1 - t) + 0.2; // 0.8 -> 0.2
  const aimStd = 0.6 * (1 - t) + 0.1; // 0.7 -> 0.1
  const aimStepPx = 40 * (1 - t) + 8; // pixel step amplitude per frame

  // Independent Bernoulli for keys with bias
  const keys = ['a','d','w','s','f'];
  const pressed = new Set();
  const keyProbs = [];
  for (let i = 0; i < 5; i++) {
    const logit = keyLogits[i] + Math.log(pressBias/(1-pressBias));
    const prob = 1 / (1 + Math.exp(-logit));
    keyProbs.push(prob);
    if (Math.random() < prob) pressed.add(keys[i]);
  }

  // Gaussian for aim delta
  function randn() {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  }
  const dx = aimMeans[0] + aimStd * randn();
  const dy = aimMeans[1] + aimStd * randn();

  return { pressed, keyProbs, aim: { dx: dx * aimStepPx, dy: dy * aimStepPx }, aimStd, pressBias };
}

// Apply action to Sim by scheduling events at the current frame
function applyAction(sim, action) {
  const f = sim.frame;
  // Key diffs vs current keysDown
  const target = action.pressed;
  const current = sim.keysDown;
  const allKeys = new Set([...target, ...current]);
  for (const k of allKeys) {
    const inTarget = target.has(k);
    const inCurrent = current.has(k);
    if (inTarget && !inCurrent) {
      // schedule keydown now
      if (!sim.inputByFrame.has(f)) sim.inputByFrame.set(f, []);
      sim.inputByFrame.get(f).push({ type: 'keydown', payload: { key: k } });
    } else if (!inTarget && inCurrent) {
      if (!sim.inputByFrame.has(f)) sim.inputByFrame.set(f, []);
      sim.inputByFrame.get(f).push({ type: 'keyup', payload: { key: k } });
    }
  }

  // Aim: accumulate a virtual cursor relative to its previous position (not the player)
  // This mirrors how a human moves the mouse and lets the crosshair travel across the field.
  // Initialize cursor to crosshairStart or screen center on first use.
  if (!sim.trainCursor) {
    const cs = (sim.world && sim.world.crosshairStart) ? sim.world.crosshairStart : { x: 200, y: 200 };
    sim.trainCursor = { x: Math.max(0, Math.min(sim.world.width, cs.x)), y: Math.max(0, Math.min(sim.world.height, cs.y)) };
  }
  const nx = sim.trainCursor.x + (action.aim.dx || 0);
  const ny = sim.trainCursor.y + (action.aim.dy || 0);
  // Clamp to world bounds
  sim.trainCursor.x = Math.max(0, Math.min(sim.world.width, nx));
  sim.trainCursor.y = Math.max(0, Math.min(sim.world.height, ny));
  if (!sim.inputByFrame.has(f)) sim.inputByFrame.set(f, []);
  sim.inputByFrame.get(f).push({ type: 'mousemove', payload: { x: sim.trainCursor.x, y: sim.trainCursor.y } });
}

// Reward shaping
function computeReward(prev, sim) {
  let r = -0.001; // step penalty
  // Damage taken since last step
  const dHealth = sim.player.health - prev.player.health;
  if (dHealth < 0) r += dHealth * 0.5; // negative when taking damage
  // Robots destroyed
  const dRobots = prev.robotsCount - sim.robots.length;
  if (dRobots > 0) r += dRobots * 1.0;
  return r;
}

// (Removed) Auxiliary hint loss toward mothership: intentionally disabled to avoid biasing training

// Experimental punishment when crosshair target is too close to the player (discourage self-aiming)
// Enable with --punish-near-aim (boolean or numeric weight). Optional radius via --punish-near-aim-radius
const PUNISH_NEAR_AIM = (function() {
  if (!('punish-near-aim' in args)) return 0;
  if (args['punish-near-aim'] === true) return 0.05; // default weight when used as a switch
  const v = Number(args['punish-near-aim']);
  return Number.isFinite(v) ? v : 0.05;
})();
const PUNISH_NEAR_AIM_RADIUS = (function() {
  if (!('punish-near-aim-radius' in args)) return 0.05; // 5% of screen diagonal
  if (args['punish-near-aim-radius'] === true) return 0.05;
  const v = Number(args['punish-near-aim-radius']);
  return Number.isFinite(v) ? v : 0.05;
})();

// Reward shaping: encourage aiming toward the mothership direction
// Enable with --reward-aim-ms=<weight> (e.g., 0.1). Optional min step via --reward-aim-ms-minstep (fraction of diag)
const REWARD_AIM_MS = (function(){
  if (!('reward-aim-ms' in args)) return 0;
  const v = Number(args['reward-aim-ms']);
  return Number.isFinite(v) ? v : 0;
})();
const REWARD_AIM_MS_MINSTEP = (function(){
  if (!('reward-aim-ms-minstep' in args)) return 0.01; // at least 1% of diagonal to count fully
  const v = Number(args['reward-aim-ms-minstep']);
  return Number.isFinite(v) ? v : 0.01;
})();

async function main() {
  // Finalize backend selection before any tf ops
  if (hw.tfpkg === '@tensorflow/tfjs' && hw.canUseWasm) {
    try { await tf.setBackend('wasm'); await tf.ready(); } catch {}
  } else {
    if (tf.ready) { try { await tf.ready(); } catch {} }
  }
  console.log(`[train_rl] Using ${hw.tfpkg} backend=${tf.getBackend && tf.getBackend()} gpu=${hw.gpu} logicalCPUs=${hw.logicalCPUs} wasmThreads=${process.env.TFJS_NUM_THREADS || 'auto'} mode=${MODE}`);
  // Ensure save dir exists
  fs.mkdirSync(SAVE_DIR, { recursive: true });

  // Enforce Realistic mode constraints (cannot start training at level>1 or use 'all')
  if (MODE === 'realistic') {
    if (!(LEVEL_ARG === '1' || LEVEL_ARG === 1)) {
      console.error('[train_rl] Refusing to start: mode=realistic prohibits starting at level > 1. Use --level=1 or switch to --mode=diagnostic.');
      process.exit(2);
    }
  }

  // World defaults
  const world = { width: 1024, height: 768, dpr: 1, clampPlayer: true, crosshairStart: { x: 200, y: 200 } };

  const dummySim = new SimGame();
  dummySim.init({ world, seed: SEED != null ? SEED : 1234, level: 1 });
  const inputSize = makeObservation(dummySim).length;
  let policy = buildPolicy(inputSize);
  // Default behavior: if a compatible model exists, resume training from it
  const maybeLoaded = await tryLoadExistingModel(tf, SAVE_DIR);
  if (maybeLoaded) policy = maybeLoaded;

  const optimizer = tf.train.adam(1e-3);

  // Per-level metrics
  const stats = new Map(); // level -> { ep:0, wins:0, losses:0, steps:0, returnSum:0 }
  function addStats(level, win, steps, epReturn) {
    const k = String(level);
    if (!stats.has(k)) stats.set(k, { ep:0, wins:0, losses:0, steps:0, returnSum:0 });
    const s = stats.get(k);
    s.ep++; s.steps += steps; s.returnSum += epReturn; if (win) s.wins++; else s.losses++;
  }

  function pickLevel(epIndex) {
    if (LEVEL_ARG === '1' || LEVEL_ARG === 1) return 1;
    if (LEVEL_ARG === '2' || LEVEL_ARG === 2) return 2;
    // 'all' curriculum: ramp Level 2 probability from 0.1 -> 0.6 across episodes
    const t = Math.max(0, Math.min(1, epIndex / Math.max(1, EPISODES - 1)));
    const p2 = 0.1 + 0.5 * t;
    return (Math.random() < p2) ? 2 : 1;
  }

  // Record run metadata (sidecar) for traceability
  try {
    const meta = {
      version: { ...TRAINING_VERSION, string: TRAINING_VERSION_STR },
      mode: MODE,
      levelArg: String(LEVEL_ARG),
      episodes: EPISODES,
      maxSteps: MAX_STEPS,
      gamma: GAMMA,
      saveDir: path.resolve(SAVE_DIR),
      seed: SEED,
      hw: { backend: tf.getBackend && tf.getBackend(), gpu: hw.gpu, logicalCPUs: hw.logicalCPUs, wasmThreads: process.env.TFJS_NUM_THREADS || 'auto' },
      startedAt: new Date().toISOString()
    };
    fs.writeFileSync(path.join(SAVE_DIR, 'training_run.json'), JSON.stringify(meta, null, 2));
  } catch {}

  for (let ep = 0; ep < EPISODES; ep++) {
    const sim = new SimGame();
    const seed = SEED != null ? SEED + ep : Math.floor(Math.random() * 1e9);
    const level = pickLevel(ep);
    if (MODE === 'realistic' && level !== 1) {
      // Safety: if curriculum or external changes try to pick >1 in realistic, clamp to 1
      // (We enforce at entry, but keep this guard in case pickLevel changes in future.)
      if (level !== 1) {
        console.warn('[train_rl] mode=realistic forcing level=1');
      }
    }
    sim.init({ world: { ...world, level }, seed, level });

  const obsBuf = [];
  const actBuf = [];
  const logpBuf = [];
  const rewBuf = [];

  let done = false;
    let steps = 0;
    let prevSnap = sim.getState();
  // Shaping diagnostics accumulators
  let sumCosSim = 0, countCos = 0;
  let sumPunish = 0, countPunish = 0;
  let sumRewardMs = 0, countRewardMs = 0;

    while (!done && steps < MAX_STEPS) {
      const obs = makeObservation(sim);
  const out = tf.tidy(() => policy.predict(tf.tensor2d([obs])));
      const action = sampleAction(tf, out, ep, EPISODES);
      out.dispose();

      // Logprob for keys (independent Bernoulli) and aim (Gaussian)
      // For simplicity, we compute an approximate logprob using current sampled values.
      let logp = 0;
      for (let i = 0; i < 5; i++) {
        const prob = action.keyProbs[i];
        const taken = action.pressed.has(['a','d','w','s','f'][i]) ? 1 : 0;
        const p = Math.max(1e-6, Math.min(1 - 1e-6, prob));
        logp += taken ? Math.log(p) : Math.log(1 - p);
      }
      const sigma = action.aimStd;
      const twoVar = 2 * sigma * sigma + 1e-6;
      const norm = -Math.log(Math.sqrt(2 * Math.PI) * sigma) * 2;
      logp += norm - (action.aim.dx*action.aim.dx + action.aim.dy*action.aim.dy) / twoVar;

      // Apply
      applyAction(sim, action);
      const { done: d } = sim.step(1);
      done = d;

      let reward = computeReward(prevSnap, sim);
      // Apply experimental punishment when aiming too close to the player
      if (PUNISH_NEAR_AIM > 0) {
        const p = TU.computePunishNearAim(action, sim, PUNISH_NEAR_AIM, PUNISH_NEAR_AIM_RADIUS);
        reward += p;
        if (p < 0) { sumPunish += -p; countPunish++; }
      }
      // Reward alignment of aim direction toward the mothership when present
      if (REWARD_AIM_MS > 0) {
        const r = TU.computeRewardAimMs(action, sim, REWARD_AIM_MS, REWARD_AIM_MS_MINSTEP);
        reward += r;
        if (r !== 0) { sumRewardMs += Math.abs(r); countRewardMs++; }
      }
      // Cosine similarity toward mothership for diagnostics
      const cs = TU.computeCosSim(action, sim);
      if (cs !== 0) { sumCosSim += cs; countCos++; }
      prevSnap = sim.getState();

      obsBuf.push(obs);
      actBuf.push(action);
      logpBuf.push(logp);
      rewBuf.push(reward);
      steps++;
    }

    // Terminal bonus/penalty
    let win = false;
    if (done) {
      const noEnemies = (sim.robots.length === 0);
      const playerDead = (sim.player.health <= 0);
      if (noEnemies) rewBuf[rewBuf.length - 1] += 10;
      if (playerDead) rewBuf[rewBuf.length - 1] -= 10;
      win = !!noEnemies && !playerDead;
    }

    // Compute discounted returns
    const G = new Array(rewBuf.length);
    let g = 0;
    for (let t = rewBuf.length - 1; t >= 0; t--) {
      g = rewBuf[t] + GAMMA * g;
      G[t] = g;
    }
    // Normalize returns for variance reduction
    const meanG = G.reduce((a,b)=>a+b,0) / Math.max(1, G.length);
    const stdG = Math.sqrt(G.reduce((a,b)=>a+(b-meanG)*(b-meanG),0) / Math.max(1, G.length)) || 1;
    for (let i = 0; i < G.length; i++) G[i] = (G[i] - meanG) / stdG;

    // Supervised-style update weighted by returns (stabilizes without explicit logprob graph)
    await optimizer.minimize(() => {
      const X = tf.tensor2d(obsBuf); // [T, input]
      const logits = policy.apply(X); // [T,7]
      const T = obsBuf.length;

      // Split logits: keys (5), aim (2)
      const keysLogits = logits.slice([0,0],[T,5]);
      const aimLogits = logits.slice([0,5],[T,2]);

      // Build targets
      const keyTargetsArr = actBuf.map(a => {
        const set = a.pressed; const keys = ['a','d','w','s','f'];
        return keys.map(k => set.has(k) ? 1 : 0);
      });
      const keyTargets = tf.tensor2d(keyTargetsArr); // [T,5]

      // Normalize aim deltas to [-1,1] using per-step amplitude used during sampling
      const aimTargetsArr = actBuf.map(a => {
        const amp = Math.max(1, Math.abs(a.aim.dx) + Math.abs(a.aim.dy)) / Math.max(1, (40 * (1 - (0)) + 8));
        // We don't know exact amp schedule here; instead, directly scale to [-1,1] by clipping reasonable range
        const sx = Math.max(-1, Math.min(1, a.aim.dx / 40));
        const sy = Math.max(-1, Math.min(1, a.aim.dy / 40));
        return [sx, sy];
      });
      const aimTargets = tf.tensor2d(aimTargetsArr); // [T,2]

      // Weights from normalized returns
      const w = tf.tensor1d(G.map(v => Math.abs(v) + 1e-3)); // [T]
      const wKeys = w.reshape([T,1]);

      // Losses
  const zero = tf.scalar(0);
  const keyMax = tf.maximum(keysLogits, zero);
  const keyBCE = keyMax.sub(keysLogits.mul(keyTargets)).add(tf.log(tf.exp(keysLogits.neg().abs()).add(1))); // [T,5]
  const keyLoss = keyBCE.mul(wKeys).mean();
      const aimMean = tf.tanh(aimLogits);
      const aimLossPer = aimMean.sub(aimTargets).square(); // [T,2]
      const aimLoss = aimLossPer.mul(wKeys).mean();

  const total = keyLoss.add(aimLoss.mul(0.1));

      X.dispose();
      keyTargets.dispose();
      aimTargets.dispose();
      w.dispose();
      wKeys.dispose();

      return total;
    });

  // Logging
    const epReturn = rewBuf.reduce((a,b)=>a+b,0);
    addStats(sim.level, win, steps, epReturn);
  // Determine outcome label for logging (treat timeout distinctly)
  const sEnd = sim.getState();
  const noEnemies = (sEnd.robotsCount === 0) && (!sim.mothership || sim.mothership.health <= 0);
  const playerDead = (sim.player.health <= 0);
  const outcomeTag = TU.classifyOutcome({ done, noEnemies, playerDead });
  console.log(`[train_rl] ep=${ep+1}/${EPISODES} level=${sim.level} steps=${steps} return=${epReturn.toFixed(3)} outcome=${outcomeTag}`);
    if (LOG_SHAPING) {
      const avgCos = countCos ? (sumCosSim / countCos) : 0;
      const avgPunish = countPunish ? (sumPunish / countPunish) : 0;
      const avgRewardMs = countRewardMs ? (sumRewardMs / countRewardMs) : 0;
      const nearFrac = steps ? (countPunish / steps) : 0;
      console.log(`[train_rl] shaping ep=${ep+1} cosSimAvg=${avgCos.toFixed(3)} msSteps=${countCos}/${steps} punishAvg=${avgPunish.toFixed(4)} nearFrac=${nearFrac.toFixed(2)} rewardMsAvg=${avgRewardMs.toFixed(4)}`);
    }

    // Periodic aggregated stats
    if ((ep+1) % Math.max(1, Math.floor(EPISODES/5)) === 0 || ep === EPISODES - 1) {
      for (const [k, s] of stats.entries()) {
        const avgRet = s.returnSum / Math.max(1, s.ep);
        const winRate = s.wins / Math.max(1, s.ep);
        console.log(`[train_rl] agg level=${k} episodes=${s.ep} winRate=${winRate.toFixed(2)} avgReturn=${avgRet.toFixed(2)} avgSteps=${(s.steps/Math.max(1,s.ep)).toFixed(1)}`);
      }
    }

    // Save checkpoint occasionally and at end
    if ((ep + 1) % Math.max(1, Math.floor(EPISODES/5)) === 0 || ep === EPISODES - 1) {
      await saveModel(policy, SAVE_DIR);
    }
  }

  console.log('[train_rl] Training complete.');
}

async function saveModel(model, dir) {
  const outDir = path.resolve(dir);
  fs.mkdirSync(outDir, { recursive: true });
  const handler = tf.io.withSaveHandler(async (artifacts) => {
    const wbin = path.join(outDir, 'weights.bin');
    const mjson = path.join(outDir, 'model.json');
    const weightData = Buffer.from(artifacts.weightData || new ArrayBuffer(0));
    fs.writeFileSync(wbin, weightData);
    const manifest = [{
      paths: ['weights.bin'],
      weights: (artifacts.weightSpecs || [])
    }];
    const payload = {
      modelTopology: artifacts.modelTopology,
      weightsManifest: manifest,
      format: 'layers-model',
      generatedBy: 'tfjs-layers',
      convertedBy: null,
      trainingConfig: artifacts.trainingConfig || undefined
    };
    fs.writeFileSync(mjson, JSON.stringify(payload, null, 2));
    // Persist training meta for compatibility checks
    try {
      const meta = {
        version: { ...TRAINING_VERSION, string: TRAINING_VERSION_STR },
        mode: MODE,
        levelArg: String(LEVEL_ARG),
        updatedAt: new Date().toISOString()
      };
      fs.writeFileSync(path.join(outDir, 'training_meta.json'), JSON.stringify(meta, null, 2));
    } catch {}
    console.log(`[train_rl] Saved model to ${outDir}`);
    return {
      modelArtifactsInfo: {
        dateSaved: new Date(),
        modelTopologyType: artifacts.modelTopology ? 'JSON' : 'GraphDef',
        modelTopologyBytes: artifacts.modelTopology ? JSON.stringify(artifacts.modelTopology).length : 0,
        weightSpecsBytes: JSON.stringify(artifacts.weightSpecs || []).length,
        weightDataBytes: weightData.length
      }
    };
  });
  await model.save(handler);
}

main().catch(err => {
  console.error('[train_rl] Error:', err);
  process.exit(1);
});
