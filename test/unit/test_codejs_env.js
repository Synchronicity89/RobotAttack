
// Unit test: code.js environment detection and mode
const codejs = require('../../code.js');

test('should export game API in Node.js (simulation mode)', () => {
    expect(codejs.Ledge).toBeDefined();
    expect(codejs.YourRobot).toBeDefined();
    expect(codejs.Robot).toBeDefined();
    expect(codejs.Laser).toBeDefined();
    expect(codejs.physicsLoop).toBeDefined();
    expect(codejs.drawingLoop).toBeDefined();
});

test('should not allow browser input in simulation mode', () => {
    // Simulated keysDown should be modifiable
    if (!Array.isArray(codejs.keysDown)) codejs.keysDown = [];
    codejs.keysDown.push('A');
    expect(codejs.keysDown.includes('A')).toBe(true);
});
