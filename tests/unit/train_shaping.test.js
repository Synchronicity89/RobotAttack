const { computeAimHint, computeCosSim, computePunishNearAim, computeRewardAimMs, classifyOutcome } = require('../../NNet/train_utils');

function makeSim(player, ms, world={ width: 1000, height: 800 }) {
  return {
    world,
    player: { x: player.x, y: player.y },
    mothership: ms ? { x: ms.x, y: ms.y, health: ms.health ?? 10 } : null
  };
}

function makeAction(dx, dy) {
  return { aim: { dx, dy } };
}

describe('Training shaping toward mothership and away from player', () => {
  test('computeAimHint returns unit vector toward mothership when present', () => {
    const sim = makeSim({x: 100, y: 100}, {x: 200, y: 100});
    const hint = computeAimHint(sim);
    expect(hint.w).toBe(1);
    // Toward +x
    expect(hint.tx).toBeGreaterThan(0.9);
    expect(Math.abs(hint.ty)).toBeLessThan(1e-6);
  });

  test('cosine similarity increases when aiming toward mothership', () => {
    const sim = makeSim({x: 0, y: 0}, {x: 10, y: 0}); // MS to the right
    const toward = makeAction(5, 0);
    const away = makeAction(-5, 0);
    expect(computeCosSim(toward, sim)).toBeGreaterThan(0.9);
    expect(computeCosSim(away, sim)).toBeLessThan(-0.9);
  });

  test('punish-near-aim penalizes tiny aim steps near player', () => {
    const sim = makeSim({x: 0, y: 0}, {x: 100, y: 0}, {width: 1000, height: 800});
    const tiny = makeAction(1, 1);
    const big = makeAction(200, 0);
    const w = 0.1, radius = 0.05; // 5% of diag ~ 62.4 px; tiny inside, big outside
    const pTiny = computePunishNearAim(tiny, sim, w, radius);
    const pBig = computePunishNearAim(big, sim, w, radius);
    expect(pTiny).toBeLessThan(0); // penalized
    expect(pBig).toBe(0);          // no penalty when far
  });

  test('reward-aim-ms gives positive reward for aiming toward mothership', () => {
    const sim = makeSim({x: 0, y: 0}, {x: 100, y: 0}, {width: 1000, height: 800});
    const toward = makeAction(100, 0);
    const orth = makeAction(0, 100);
    const away = makeAction(-100, 0);
    const w = 0.2, minStep = 0.01;
    const rToward = computeRewardAimMs(toward, sim, w, minStep);
    const rOrth = computeRewardAimMs(orth, sim, w, minStep);
    const rAway = computeRewardAimMs(away, sim, w, minStep);
    expect(rToward).toBeGreaterThan(0);
    expect(Math.abs(rOrth)).toBeLessThan(rToward);
    expect(rAway).toBeLessThan(0);
  });

  test('combined shaping prefers toward-ms vs near-self tiny aim', () => {
    const sim = makeSim({x: 0, y: 0}, {x: 100, y: 0}, {width: 1000, height: 800});
    const toward = makeAction(60, 0); // moderate step
    const tinyNear = makeAction(1, 1); // inside radius
    const reward = 0.12, minStep = 0.02;
    const punish = 0.08, radius = 0.05;
    const towardScore = computeRewardAimMs(toward, sim, reward, minStep) + computePunishNearAim(toward, sim, punish, radius);
    const nearScore = computeRewardAimMs(tinyNear, sim, reward, minStep) + computePunishNearAim(tinyNear, sim, punish, radius);
    expect(towardScore).toBeGreaterThan(nearScore);
  });

  test('classifyOutcome distinguishes timeout from loss', () => {
    expect(classifyOutcome({ done: false, noEnemies: false, playerDead: false })).toBe('timeout');
    expect(classifyOutcome({ done: true, noEnemies: false, playerDead: false })).toBe('loss');
    expect(classifyOutcome({ done: true, noEnemies: true, playerDead: false })).toBe('win');
  });
});
