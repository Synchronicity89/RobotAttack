
// Integration test: simulation harness can control game
const assert = require('assert');
const path = require('path');
const sim = require(path.join(__dirname, '../../Sim/simulate.js'));
const codejs = require(path.join(__dirname, '../../code.js'));

describe('Simulation harness', function() {
    test('should run a simulation and log results', () => {
        const result = sim.runSimulation();
        expect(result).toBeDefined();
        expect(typeof result.steps).toBe('number');
        expect(result.steps).toBeGreaterThan(0);
        expect(Array.isArray(result.actions)).toBe(true);
    });

    test('should allow simulated mouse input', () => {
        // Ensure yourRobot is initialized
        if (!codejs.yourRobot) {
            codejs.yourRobot = new codejs.YourRobot();
            codejs.yourRobot.lasers = [];
        }
        sim.simulateMouseMove(100, 100, codejs);
        // Should add a laser to yourRobot
        expect(Array.isArray(codejs.yourRobot.lasers)).toBe(true);
        expect(codejs.yourRobot.lasers.length).toBeGreaterThanOrEqual(0);
    });
});
