// CanvasShim for Node.js simulation
class CanvasShim {
    constructor(width, height) {
        this.width = width;
        this.height = height;
    }
    getContext(type) {
        // Return a minimal context with stubbed methods
        return {
            fillRect: () => {},
            strokeRect: () => {},
            beginPath: () => {},
            moveTo: () => {},
            lineTo: () => {},
            stroke: () => {},
            save: () => {},
            restore: () => {},
            font: '',
            textBaseline: '',
            textAlign: '',
            fillStyle: '',
            strokeStyle: '',
            lineWidth: 0,
            fillText: () => {},
            strokeText: () => {},
        };
    }
}

function requestAnimationFrameShim(cb) {
    return setTimeout(cb, 16);
}

let keysDown = [];
function simulateMouseMove(x, y, game) {
    // Simulate shooting at (x, y)
    if (game.yourRobot) {
        game.yourRobot.lasers.push({x, y});
    }
}

module.exports = {
    CanvasShim,
    requestAnimationFrameShim,
    keysDown,
    simulateMouseMove
};
