'use strict';

const fs = require('fs');
const path = require('path');
const { SimGame } = require('./sim');

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

// Simple file logger (dated + latest)
const LOG_DIR = path.join(process.cwd(), 'logs');
const TS = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19).replace('T', '_');
const DATED_LOG = path.join(LOG_DIR, `sim-run-${TS}.log`);
const LATEST_LOG = path.join(LOG_DIR, 'sim-run-latest.log');
fs.mkdirSync(LOG_DIR, { recursive: true });
let __firstWrite = true;
function out(line) {
  console.log(line);
  try {
    if (__firstWrite) {
      fs.writeFileSync(DATED_LOG, '');
      fs.writeFileSync(LATEST_LOG, '');
      __firstWrite = false;
    }
    fs.appendFileSync(DATED_LOG, line + '\n');
    fs.appendFileSync(LATEST_LOG, line + '\n');
  } catch {}
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

(function explainFlags(){
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(`Usage: node Sim/run-sim.js --rec=./data/recordings/file.json [options]\n\n` +
      `Options:\n` +
      `  --latest                 Use the latest recorded file (via data/recordings/.latest)\n` +
      `  --assert                 Exit with code 1 if any validation mismatch occurs (or none present)\n` +
      `  --assert-up-to=N        Only require exact match for validation frames <= N (still logs later)\n` +
      `  --no-require-validation Don’t fail when --assert is set but recording has no validation\n` +
      `  --dump-on-mismatch      Log detailed robot tuples at the first mismatch frame\n` +
      `  --env.SIM_EXTRA=N       Extra frames beyond recording.frames (default 1200)\n`);
    process.exit(0);
  }
})();

(async function main() {
  try {
    const recPath = resolveRecordingPath(process.argv.slice(2));
    const rec = readJson(recPath);

    const world = Object.assign({}, rec.world || {});
    const seed = rec.seed;
    const inputs = Array.isArray(rec.inputs) ? rec.inputs : [];
    const framesBudget = Number(rec.frames) || (inputs.length ? Math.max(...inputs.map(e => e.frame)) + 10 : 600);

    // Optional validation map
    const validation = Array.isArray(rec.validation) ? rec.validation : null;
    const expectByFrame = new Map();
    if (validation) {
      for (const v of validation) {
        if (v && typeof v.frame === 'number') expectByFrame.set(v.frame, v);
      }
    }

  const sim = new SimGame();
    sim.init({ world, seed });
    sim.queueInputs(inputs);

    const checkpointEvery = 60;
    let nextCheckpoint = checkpointEvery;

    const extra = Number(process.env.SIM_EXTRA || 1200);
    const hardCap = framesBudget + extra;

    // Header
    out(`sim-run start recPath=${recPath}`);
    out(`world=${JSON.stringify(world)} seed=${seed}`);
    out(`framesBudget=${framesBudget} extra=${extra} hardCap=${hardCap}`);
    out(`validation=${validation ? 'present' : 'absent'}`);

    // Parity counters
    let checks = 0, matches = 0;
    let firstMismatch = null;

    // CLI flags
    const argv = process.argv.slice(2);
    const assertMode = argv.includes('--assert');
    const noRequireValidation = argv.includes('--no-require-validation');
    const dumpOnMismatch = argv.includes('--dump-on-mismatch');
    let assertUpTo = null;
    for (const a of argv) {
      if (a.startsWith('--assert-up-to=')) {
        const v = Number(a.split('=')[1]);
        if (Number.isFinite(v)) assertUpTo = v;
      }
    }

    function dumpRobotsDetail() {
      try {
        const robots = sim.robots.slice().sort((a,b)=>a.id-b.id);
        const tuples = robots.map(r => ({
          id: r.id,
          x: Math.round(r.x),
          y: Math.round(r.y),
          h: Math.round(r.health*1000)
        }));
        out(`robots.detail tuples=${JSON.stringify(tuples)}`);
      } catch {}
    }

    while (sim.frame < hardCap) {
      const { done, outcome } = sim.step(1);

      const shouldReport = (sim.frame >= nextCheckpoint || done);
      if (shouldReport) {
        const s = sim.getState();
        out(`frame=${s.frame} digest=${s.digest} player=(${Math.round(s.player.x)},${Math.round(s.player.y)}) health=${s.player.health.toFixed(3)} robots=${s.robotsCount}`);

        const exp = expectByFrame.get(s.frame);
        if (exp && exp.robotsSummary) {
          const got = sim.getRobotsSummary();
          checks++;
          const ok =
            got.count === Number(exp.robotsSummary.count) &&
            got.digest === String(exp.robotsSummary.digest) &&
            (got.nearestToOriginId === exp.robotsSummary.nearestToOriginId);
          if (ok) {
            matches++;
          } else if (!firstMismatch) {
            firstMismatch = { frame: s.frame, expected: exp.robotsSummary, actual: got };
            out(`validation-mismatch frame=${s.frame} exp=${JSON.stringify(exp.robotsSummary)} got=${JSON.stringify(got)}`);
            if (dumpOnMismatch) dumpRobotsDetail();
          }
        }

        nextCheckpoint += checkpointEvery;
      }

      if (done) {
        out(`terminal outcome=${outcome} at frame=${sim.frame}`);
        break;
      }
    }

    if (sim.frame >= hardCap) {
      const s = sim.getState();
      out(`stopped at cap frame=${sim.frame} robots=${s.robotsCount}`);
    }

    if (validation) {
      out(`validation summary: checks=${checks} matches=${matches}` + (firstMismatch ? ` firstMismatch.frame=${firstMismatch.frame}` : ' all-matched'));
    } else {
      out('validation summary: none-present-in-recording');
    }

    // Assert mode exit conditions for CI
    if (assertMode) {
      if (!validation && !noRequireValidation) {
        out('assert: failing due to missing validation in recording (use --no-require-validation to ignore)');
        process.exit(2);
      }
      if (validation) {
        if (assertUpTo != null) {
          if (firstMismatch && firstMismatch.frame <= assertUpTo) {
            out(`assert: mismatch at frame=${firstMismatch.frame} within assert-up-to=${assertUpTo}`);
            process.exit(1);
          }
        } else {
          if (checks > 0 && matches < checks) {
            out('assert: one or more validation frames mismatched');
            process.exit(1);
          }
        }
      }
    }

    out(`sim-run end recPath=${recPath} datedLog=${DATED_LOG} latestLog=${LATEST_LOG}`);
  } catch (e) {
    console.error('sim:run failed:', e.message);
    try {
      fs.appendFileSync(LATEST_LOG, `sim:run failed: ${e.message}\n`);
    } catch {}
    process.exit(1);
  }
})();
