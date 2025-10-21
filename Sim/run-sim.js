'use strict';

const fs = require('fs');
const path = require('path');
const { SimGame } = require('./sim');

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function resolveRecordingPath(args) {
  const argRec = args.find(a => a.startsWith('--rec='));
  if (argRec) {
    const p = argRec.slice('--rec='.length);
    return path.isAbsolute(p) ? p : path.join(process.cwd(), p);
  }
  if (args.includes('--latest')) {
    const latestMarker = path.join(process.cwd(), 'data', 'recordings', '.latest');
    if (fs.existsSync(latestMarker)) {
      const fname = (fs.readFileSync(latestMarker, 'utf8') || '').trim();
      const p = path.join(process.cwd(), 'data', 'recordings', fname);
      if (fs.existsSync(p)) return p;
    }
  }
  throw new Error('Recording path not provided. Use --rec=<path> or --latest with .latest present.');
}

(async function main() {
  try {
    const recPath = resolveRecordingPath(process.argv.slice(2));
    const rec = readJson(recPath);

    const world = Object.assign({}, rec.world || {});
    const seed = rec.seed;
    const inputs = Array.isArray(rec.inputs) ? rec.inputs : [];
    const framesBudget = Number(rec.frames) || (inputs.length ? Math.max(...inputs.map(e => e.frame)) + 10 : 600);

    const sim = new SimGame();
    sim.init({ world, seed });
    sim.queueInputs(inputs);

    const checkpointEvery = 60; // frames
    let nextCheckpoint = checkpointEvery;

    // Allow extra frames beyond the recorded budget to reach a terminal state
    const extra = Number(process.env.SIM_EXTRA || 1200);
    const hardCap = framesBudget + extra;

    while (sim.frame < hardCap) {
      const { done, outcome } = sim.step(1);
      if (sim.frame >= nextCheckpoint || done) {
        const s = sim.getState();
        // Print a compact checkpoint line
        console.log(
          `frame=${s.frame} digest=${s.digest} player=(${Math.round(s.player.x)},${Math.round(s.player.y)}) health=${s.player.health.toFixed(3)} robots=${s.robotsCount}`
        );
        nextCheckpoint += checkpointEvery;
      }
      if (done) {
        console.log(`terminal outcome=${outcome} at frame=${sim.frame}`);
        break;
      }
    }

    if (sim.frame >= hardCap) {
      const s = sim.getState();
      console.log(`stopped at cap frame=${sim.frame} robots=${s.robotsCount}`);
    }
  } catch (e) {
    console.error('sim:run failed:', e.message);
    process.exit(1);
  }
})();
