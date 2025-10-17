// Test harness for AI Demo mode
// Simulates browser environment and canvas for code.js

const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');
const Canvas = require('canvas');

describe('AI Demo Harness', () => {
    let window, document, codejs, canvas, ctx;
    beforeAll(() => {
        // Simulate browser environment
        window = (new JSDOM('<!DOCTYPE html><canvas id="maincanvas"></canvas>')).window;
        document = window.document;
        global.window = window;
        global.document = document;
        // Use node-canvas for canvas
        canvas = Canvas.createCanvas(800, 600);
        ctx = canvas.getContext('2d');
        document.getElementById = (id) => id === 'maincanvas' ? canvas : null;
        window.innerWidth = 800;
        window.innerHeight = 600;
        // Simulate AI Demo mode
        window.RL_TRAINING = false;
        // Mock TensorFlow.js for code.js
        window.tf = {
            loadLayersModel: async () => ({
                predict: () => ({
                    array: async () => [[0, 0, 0, 0, 1]], // Always choose 'shoot'
                })
            }),
            tensor: (arr) => arr,
        };
        // Mock requestAnimationFrame for game loop
        global.requestAnimationFrame = window.requestAnimationFrame = (cb) => setTimeout(cb, 0);
        // Load code.js
        codejs = require('../../code.js');
    });

    test('Player robot fires lasers in AI Demo mode', async () => {
        // Wait for game state to initialize
        let maxWait = 100;
        let yourRobot = window.yourRobot || codejs.yourRobot;
        while (!yourRobot && maxWait-- > 0) {
            await new Promise(res => setTimeout(res, 10));
            yourRobot = window.yourRobot || codejs.yourRobot;
        }
        expect(yourRobot).toBeDefined();
        // Simulate AI choosing shoot action
        yourRobot.health = 1;
        if (window.yrCanShoot !== undefined) {
            window.yrCanShoot = true;
        } else {
            codejs.yrCanShoot = true;
        }
        // Simulate AI step that should fire laser
        if (typeof window.aiStep === 'function') {
            await window.aiStep();
        } else if (typeof codejs.aiStep === 'function') {
            await codejs.aiStep();
        }
        // Check if player lasers array has at least one laser
        expect(yourRobot.lasers.length).toBeGreaterThan(0);
    });
});
