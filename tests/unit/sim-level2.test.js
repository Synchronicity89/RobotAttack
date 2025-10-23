const { SimGame } = require('../../Sim/sim');

describe('Sim Level 2 mechanics', () => {
  test('creates mothership and fires missiles on schedule', () => {
    const sim = new SimGame();
    sim.init({ world: { width: 800, height: 600, level: 2 }, seed: 1234, level: 2 });
    expect(sim.mothership).toBeTruthy();
    expect(sim.mothership.health).toBeGreaterThan(0);
    // At timer 0, mothership should fire immediately (timer % firePeriod === 0)
    expect(sim.mothership.missiles.length).toBe(0);
    const { done } = sim.step(1);
    expect(done).toBe(false);
    expect(sim.mothership.missiles.length).toBeGreaterThanOrEqual(1);
  });

  test('moving ledges update y over time', () => {
    const sim = new SimGame();
    sim.init({ world: { width: 800, height: 600, level: 2 }, seed: 42, level: 2 });
    const ys0 = sim.ledgeOrder.slice(0, 5).map(L => ({ baseY: L.baseY, y: L.y, amp: L.amp, omega: L.omega }));
    // Step several frames to allow motion
    sim.step(60);
    const ys1 = sim.ledgeOrder.slice(0, 5).map(L => ({ baseY: L.baseY, y: L.y }));
    // At least one ledge with non-zero amp/omega should have y != baseY
    const moved = ys0.some((l, i) => (l.amp && l.omega) && (Math.abs(ys1[i].y - l.baseY) > 0));
    expect(moved).toBe(true);
  });
});
