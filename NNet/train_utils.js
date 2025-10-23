'use strict';

// Compute a unit vector toward the mothership from player if present
function computeAimHint(sim) {
  if (sim && sim.mothership && sim.mothership.health > 0) {
    const dx = sim.mothership.x - sim.player.x;
    const dy = sim.mothership.y - sim.player.y;
    const d = Math.hypot(dx, dy) || 1;
    return { tx: Math.max(-1, Math.min(1, dx / d)), ty: Math.max(-1, Math.min(1, dy / d)), w: 1 };
  }
  return { tx: 0, ty: 0, w: 0 };
}

// Cosine similarity between action aim and MS direction, using only current state/action
function computeCosSim(action, sim) {
  if (!action || !action.aim) return 0;
  if (!(sim && sim.mothership && sim.mothership.health > 0)) return 0;
  const ax = action.aim.dx, ay = action.aim.dy;
  const aNorm = Math.hypot(ax, ay);
  if (aNorm <= 1e-6) return 0;
  const mx = sim.mothership.x - sim.player.x;
  const my = sim.mothership.y - sim.player.y;
  const mNorm = Math.hypot(mx, my) || 1;
  const ux = mx / mNorm, uy = my / mNorm;
  return (ax * ux + ay * uy) / aNorm;
}

// Negative reward when aim is too close to player (small step magnitude)
function computePunishNearAim(action, sim, weight = 0.05, radiusFrac = 0.05) {
  if (!action || !action.aim || weight <= 0 || radiusFrac <= 0) return 0;
  const mcw = sim.world.width, mch = sim.world.height;
  const diag = Math.max(1, Math.hypot(mcw, mch));
  const dx = action.aim.dx, dy = action.aim.dy;
  const distNorm = Math.hypot(dx, dy) / diag;
  if (distNorm >= radiusFrac) return 0;
  const frac = 1 - (distNorm / Math.max(1e-6, radiusFrac));
  return -weight * frac;
}

// Positive reward toward mothership direction, scaled by step size up to a minimum threshold
function computeRewardAimMs(action, sim, weight = 0.1, minStepFrac = 0.01) {
  if (!action || !action.aim || weight <= 0) return 0;
  if (!(sim && sim.mothership && sim.mothership.health > 0)) return 0;
  const mcw = sim.world.width, mch = sim.world.height;
  const diag = Math.max(1, Math.hypot(mcw, mch));
  const ax = action.aim.dx, ay = action.aim.dy;
  const aNorm = Math.hypot(ax, ay);
  if (aNorm <= 1e-6) return 0;
  const mx = sim.mothership.x - sim.player.x;
  const my = sim.mothership.y - sim.player.y;
  const mNorm = Math.hypot(mx, my) || 1;
  const ux = mx / mNorm, uy = my / mNorm;
  const cosSim = (ax * ux + ay * uy) / aNorm;
  const stepFrac = Math.min(1, (aNorm / diag) / Math.max(1e-6, minStepFrac));
  return weight * cosSim * stepFrac;
}

module.exports = {
  computeAimHint,
  computeCosSim,
  computePunishNearAim,
  computeRewardAimMs,
  classifyOutcome
};

// Classify episode outcome label for logging
// done=true => 'win' if noEnemies && !playerDead else 'loss'
// done=false => 'timeout'
function classifyOutcome({ done, noEnemies, playerDead }) {
  if (done) {
    const drawn = !!(noEnemies && playerDead); // treat as win elsewhere if needed
    return noEnemies ? 'win' : 'loss';
  }
  return 'timeout';
}
