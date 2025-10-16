// Simulation harness for RobotAttack game
// This file allows running the game logic from code.js in a Node.js environment for AI training

// Shim for canvas and context
class CanvasShim {
    constructor(width, height) {
        this.width = width;
        this.height = height;
        this._ctx = new ContextShim();
    }
    getContext(type) {
        return this._ctx;
    }
}

class ContextShim {
    constructor() {
        // Store draw calls for analysis
        this.calls = [];
    }
    fillRect(x, y, w, h) {
        this.calls.push({type: 'fillRect', x, y, w, h});
    }
    strokeRect(x, y, w, h) {
        this.calls.push({type: 'strokeRect', x, y, w, h});
    }
    beginPath() {}
    moveTo(x, y) {}
    lineTo(x, y) {}
    stroke() {}
    // ...add more as needed
}

// Shim for requestAnimationFrame
function requestAnimationFrameShim(fn) {
    setTimeout(fn, 0); // Immediate for simulation
}

// Shim for document and events
const keysDown = [];
function addKey(key) {
    if (!keysDown.includes(key)) keysDown.push(key);
}
function removeKey(key) {
    const idx = keysDown.indexOf(key);
    if (idx !== -1) keysDown.splice(idx, 1);
}

// Simulate mouse movement for shooting
function simulateMouseMove(x, y, game) {
    // game should be the imported code.js module
    if (game.yrCanShoot) {
        let laser = new game.Laser(game.yourRobot.idCounter, game.yourRobot, true, x, y);
        game.yourRobot.lasers.push(laser);
        game.yourRobot.idCounter++;
        game.yrCanShoot = false;
    }
}

// Export shims for use in code.js
module.exports = {
    CanvasShim,
    ContextShim,
    requestAnimationFrameShim,
    keysDown,
    addKey,
    removeKey,
    simulateMouseMove
};

// Example usage:
// const { CanvasShim, requestAnimationFrameShim } = require('./simulate');
// let mcan = new CanvasShim(800, 600);
// let mctx = mcan.getContext('2d');
// ...inject into code.js logic

const fs = require('fs');
const path = require('path');

// Import game logic
const game = require('../code.js');

// Run a single simulation
function runSimulation() {
    // Reset game state
    game.yourRobot.health = 1;
    game.yourRobot.x = game.ledgeOrder[Math.ceil(game.ledgeOrder.length/2)].x * game.mcw;
    game.yourRobot.y = game.ledgeOrder[Math.ceil(game.ledgeOrder.length/2)].y * game.mch - game.yrm/2;
    game.yourRobot.velX = 0;
    game.yourRobot.velY = 0;
    game.yourRobot.lasers = [];
    game.yourRobot.idCounter = 0;
    game.yourRobot.atBottom = false;
    game.robots.forEach(r => {
        r.health = 1;
        r.x = Math.random() * game.mcw;
        r.y = game.mch;
        r.lasers = [];
        r.idCounter = 0;
    });
    game.timer = 0;
    let steps = 0;
    let actions = [];
    let survived = true;

    // Simulate until defeat or max steps
    while (game.yourRobot.health > 0 && steps < 2000) {
        // Example: shoot at nearest robot
        let nearest = game.defaultRobot;
        game.robots.forEach(robot => {
            if (robot.x**2 + robot.y**2 < nearest.x**2 + nearest.y**2) {
                nearest = robot;
            }
        });
        if (nearest !== game.defaultRobot) {
            simulateMouseMove(nearest.x, nearest.y, game);
            actions.push({step: steps, action: 'shoot', target: {x: nearest.x, y: nearest.y}});
        }
        // Advance physics
        game.physicsLoop();
        steps++;
    }
    if (game.yourRobot.health <= 0) survived = false;

    // Collect results
    const result = {
        timestamp: new Date().toISOString(),
        survived,
        steps,
        actions,
        finalHealth: game.yourRobot.health,
        robotsRemaining: game.robots.length
    };
    return result;
}

// Log results to JSON file
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
