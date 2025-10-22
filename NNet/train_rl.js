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
const MAX_STEPS = Number(args['max-steps'] || 1200);
const GAMMA = Number(args.gamma || 0.99);
const SAVE_DIR = String(args['save-dir'] || path.join(__dirname, 'policy_model'));
const SEED = args.seed != null ? Number(args.seed) : null;

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
    ndx = bx / Math.max(1, mcw);
    ndy = by / Math.max(1, mch);
    nd = d / Math.max(1, Math.hypot(mcw, mch));
  }
  const obs = [
    p.x / Math.max(1, mcw),
    p.y / Math.max(1, mch),
    p.vx / Math.max(1, mch/20),
    p.vy / Math.max(1, mch/20),
    Math.max(0, Math.min(1, p.health)),
    rc / 12,
    sim.yrCanShoot ? 1 : 0,
    ndx, ndy, nd
  ];
  return obs;
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

  // Aim: move crosshair by delta relative to player position (absolute coords in mousemove)
  const px = sim.player.x + action.aim.dx;
  const py = sim.player.y + action.aim.dy;
  if (!sim.inputByFrame.has(f)) sim.inputByFrame.set(f, []);
  sim.inputByFrame.get(f).push({ type: 'mousemove', payload: { x: px, y: py } });
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

async function main() {
  // Finalize backend selection before any tf ops
  if (hw.tfpkg === '@tensorflow/tfjs' && hw.canUseWasm) {
    try { await tf.setBackend('wasm'); await tf.ready(); } catch {}
  } else {
    if (tf.ready) { try { await tf.ready(); } catch {} }
  }
  console.log(`[train_rl] Using ${hw.tfpkg} backend=${tf.getBackend && tf.getBackend()} gpu=${hw.gpu} logicalCPUs=${hw.logicalCPUs} wasmThreads=${process.env.TFJS_NUM_THREADS || 'auto'}`);
  // Ensure save dir exists
  fs.mkdirSync(SAVE_DIR, { recursive: true });

  // World defaults
  const world = { width: 1024, height: 768, dpr: 1, clampPlayer: true, crosshairStart: { x: 200, y: 200 } };

  const dummySim = new SimGame();
  dummySim.init({ world, seed: SEED != null ? SEED : 1234 });
  const inputSize = makeObservation(dummySim).length;
  const policy = buildPolicy(inputSize);

  const optimizer = tf.train.adam(1e-3);

  for (let ep = 0; ep < EPISODES; ep++) {
    const sim = new SimGame();
    const seed = SEED != null ? SEED + ep : Math.floor(Math.random() * 1e9);
    sim.init({ world, seed });

    const obsBuf = [];
    const actBuf = [];
    const logpBuf = [];
    const rewBuf = [];

    let done = false;
    let steps = 0;
    let prevSnap = sim.getState();

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

      const reward = computeReward(prevSnap, sim);
      prevSnap = sim.getState();

      obsBuf.push(obs);
      actBuf.push(action);
      logpBuf.push(logp);
      rewBuf.push(reward);
      steps++;
    }

    // Terminal bonus/penalty
    if (done) {
      const noEnemies = (sim.robots.length === 0);
      const playerDead = (sim.player.health <= 0);
      if (noEnemies) rewBuf[rewBuf.length - 1] += 10;
      if (playerDead) rewBuf[rewBuf.length - 1] -= 10;
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
    const epReturn = rewBuf.reduce((a,b)=>a+b,0).toFixed(3);
    console.log(`[train_rl] ep=${ep+1}/${EPISODES} steps=${steps} return=${epReturn}`);

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
