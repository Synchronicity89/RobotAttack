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
