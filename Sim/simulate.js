// Simulation harness for RobotAttack game
// This file allows running the game logic from code.js in a Node.js environment for AI training

const { CanvasShim, requestAnimationFrameShim, keysDown, simulateMouseMove } = require('./simulate_shim');
const game = require('../code.js');

// Run a single simulation
function runSimulation() {
    // Re-initialize game state
    const codejs = require('../code.js');
    codejs.keysDown = [];
    codejs.yourRobot = new codejs.YourRobot();
    codejs.robots = [];
    for (let i = 0; i < 12; i++) {
        let robot = new codejs.Robot(i);
        codejs.robots.push(robot);
    }
    codejs.timer = 0;
    codejs.yrCanShoot = true;

    // Reset robot positions
    codejs.yourRobot.x = codejs.ledgeOrder[Math.ceil(codejs.ledgeOrder.length/2)].x * codejs.mcw;
    codejs.yourRobot.y = codejs.ledgeOrder[Math.ceil(codejs.ledgeOrder.length/2)].y * codejs.mch - codejs.yrm/2;
    codejs.yourRobot.velX = 0;
    codejs.yourRobot.velY = 0;
    codejs.yourRobot.lasers = [];
    codejs.yourRobot.idCounter = 0;
    codejs.yourRobot.atBottom = false;

    let steps = 0;
    let actions = [];
    let survived = true;

    // Simulate until defeat or max steps
    while (codejs.yourRobot.health > 0 && steps < 2000) {
        // Example: shoot at nearest robot
        let nearest = codejs.defaultRobot;
        codejs.robots.forEach(robot => {
            if (robot.x**2 + robot.y**2 < nearest.x**2 + nearest.y**2) {
                nearest = robot;
            }
        });
        if (nearest !== codejs.defaultRobot) {
            simulateMouseMove(nearest.x, nearest.y, codejs);
            actions.push({step: steps, action: 'shoot', target: {x: nearest.x, y: nearest.y}});
        }
        // Advance physics
        codejs.physicsLoop();
        steps++;
    }
    if (codejs.yourRobot.health <= 0) survived = false;

    // Collect results
    const result = {
        timestamp: new Date().toISOString(),
        survived,
        steps,
        actions,
        finalHealth: codejs.yourRobot.health,
        robotsRemaining: codejs.robots.length
    };
    return result;
}

// Log results to JSON file
const fs = require('fs');
const path = require('path');
function logResult(result) {
    const resultsPath = path.join(__dirname, 'results.json');
    let results = [];
    if (fs.existsSync(resultsPath)) {
        results = JSON.parse(fs.readFileSync(resultsPath));
    }
    results.push(result);
    fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2));
}

// Run and log a simulation
if (require.main === module) {
    const result = runSimulation();
    logResult(result);
    console.log('Simulation complete. Result logged to Sim/results.json');
}

module.exports = {
    runSimulation,
    simulateMouseMove,
};
