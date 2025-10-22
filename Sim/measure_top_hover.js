#!/usr/bin/env node
'use strict';

const { SimGame } = require('./sim');

function fmt(n) { return typeof n === 'number' ? n.toFixed(2) : String(n); }

async function main() {
  const args = process.argv.slice(2);
  const getArg = (name, def) => {
    const i = args.findIndex(a => a.startsWith(`--${name}=`));
    if (i >= 0) return args[i].split('=')[1];
    const j = args.indexOf(`--${name}`);
    if (j >= 0) return args[j+1];
    return def;
  };

  const seed = Number(getArg('seed', 1234));
  const width = Number(getArg('width', 800));
  const height = Number(getArg('height', 600));
  const trials = Number(getArg('trials', 5));
  const preboostVy = Number(getArg('vy', 0)); // if 0, we'll jump from ledge
  const framesPerTrial = Number(getArg('frames', 180));

  const sim = new SimGame();
  sim.init({ world: { width, height, clampPlayer: true }, seed });

  const half = sim.yrm / 2;
  const eps = 1e-6;

  const metrics = {
    totalFrames: 0,
    topClampFrames: 0,
    topClampUpwardVyFrames: 0,
    maxTopClampStreak: 0,
    streaks: []
  };

  const countIfTopClamp = () => {
    const atTopClamp = (sim.player.y <= half + eps);
    if (atTopClamp) {
      currStreak++;
      metrics.topClampFrames++;
      if (sim.player.vy < 0) metrics.topClampUpwardVyFrames++;
    } else if (currStreak > 0) {
      metrics.maxTopClampStreak = Math.max(metrics.maxTopClampStreak, currStreak);
      metrics.streaks.push(currStreak);
      currStreak = 0;
    }
  };

  let currStreak = 0;

  for (let t = 0; t < trials; t++) {
    // Reset to a deterministic start each trial
    sim.init({ world: { width, height, clampPlayer: true }, seed: seed + t });

    // Move player near the top so we can test clamp behavior reliably
    sim.player.x = width / 2;
    sim.player.y = half + sim.yrm; // just below the top by 1 body height
    sim.player.vx = 0;
    sim.player.vy = 0;
    sim.falling = false; // allow jump if desired

    // Either jump using policy (W) or pre-boost vy directly
    if (preboostVy !== 0) {
      sim.player.vy = preboostVy; // e.g., -6*velChange is typical jump
      sim.falling = true; // treat as airborne
    } else {
      // Simulate a jump from a grounded state: hold W for 1 frame
      sim.keysDown.add('w');
      sim.physicsStep(); // apply the jump
      sim.keysDown.delete('w');
    }

    // Now run frames and measure
    for (let f = 0; f < framesPerTrial; f++) {
      sim.physicsStep();
      metrics.totalFrames++;
      countIfTopClamp();
    }
  }

  // Flush last streak if needed
  if (currStreak > 0) {
    metrics.maxTopClampStreak = Math.max(metrics.maxTopClampStreak, currStreak);
    metrics.streaks.push(currStreak);
  }

  const pct = (part, whole) => (whole > 0 ? (100 * part / whole) : 0);

  console.log('Top-boundary hover measurement');
  console.log(`- world: ${width}x${height}, yrm=${fmt(sim.yrm)}, velChange=${fmt(sim.velChange)}`);
  console.log(`- trials=${trials}, framesPerTrial=${framesPerTrial}, seedBase=${seed}`);
  console.log(`- topClampFrames=${metrics.topClampFrames} (${fmt(pct(metrics.topClampFrames, metrics.totalFrames))}%)`);
  console.log(`- topClampUpwardVyFrames=${metrics.topClampUpwardVyFrames} (${fmt(pct(metrics.topClampUpwardVyFrames, metrics.totalFrames))}%)`);
  console.log(`- maxTopClampStreak=${metrics.maxTopClampStreak} frames`);
  if (metrics.streaks.length) {
    const avg = metrics.streaks.reduce((a,b)=>a+b,0) / metrics.streaks.length;
    console.log(`- streaks: count=${metrics.streaks.length}, avg=${fmt(avg)}, min=${Math.min(...metrics.streaks)}, max=${Math.max(...metrics.streaks)}`);
  } else {
    console.log(`- streaks: none observed`);
  }
}

main().catch(err => {
  console.error('measure_top_hover failed:', err);
  process.exit(1);
});
