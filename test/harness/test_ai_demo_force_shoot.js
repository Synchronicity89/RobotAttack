// Test: Force AI to choose 'shoot' and verify player laser creation
const { JSDOM } = require('jsdom');
const Canvas = require('canvas');

describe('AI Demo - Force Shoot Action', () => {
    let window, document, codejs, canvas, ctx;
    beforeAll(() => {
        window = (new JSDOM('<!DOCTYPE html><canvas id="maincanvas"></canvas>')).window;
        document = window.document;
        global.window = window;
        global.document = document;
        canvas = Canvas.createCanvas(800, 600);
        ctx = canvas.getContext('2d');
        document.getElementById = (id) => id === 'maincanvas' ? canvas : null;
        window.innerWidth = 800;
        window.innerHeight = 600;
        window.RL_TRAINING = false;
        // Mock TensorFlow.js to always choose 'shoot'
        window.tf = {
            loadLayersModel: async () => ({
                predict: () => ({
                    array: async () => [[0, 0, 0, 0, 1]], // Always choose 'shoot'
                })
            }),
            tensor: (arr) => arr,
        };
        global.requestAnimationFrame = window.requestAnimationFrame = (cb) => setTimeout(cb, 0);
        codejs = require('../../code.js');
    });

    test('Player robot fires laser when AI chooses shoot', async () => {
        let maxWait = 100;
        let yourRobot = window.yourRobot || codejs.yourRobot;
        while (!yourRobot && maxWait-- > 0) {
            await new Promise(res => setTimeout(res, 10));
            yourRobot = window.yourRobot || codejs.yourRobot;
        }
        expect(yourRobot).toBeDefined();
        yourRobot.health = 1;
        if (window.yrCanShoot !== undefined) {
            window.yrCanShoot = true;
        } else {
            codejs.yrCanShoot = true;
        }
        // Call aiStep to force shoot
        if (typeof window.aiStep === 'function') {
            await window.aiStep();
        } else if (typeof codejs.aiStep === 'function') {
            await codejs.aiStep();
        }
        // Check if player lasers array has at least one laser
        expect(yourRobot.lasers.length).toBeGreaterThan(0);
        // Check that the laser is marked as 'yours' (player laser)
        expect(yourRobot.lasers[0].yours).toBe(true);
    });
});
