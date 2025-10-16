// RL Training Loop for RobotAttack
// Uses TensorFlow.js for policy network and training

const tf = require('@tensorflow/tfjs-node');
const { runSimulation, simulateMouseMove } = require('../Sim/simulate');
const game = require('../code.js');
const fs = require('fs');
const path = require('path');

// --- Policy Network Design ---
// Input: Game state vector
// Output: Action probabilities (W, A, S, D, Shoot)
function createPolicyNetwork(inputSize, actionSize) {
    const model = tf.sequential();
    model.add(tf.layers.dense({ units: 64, activation: 'relu', inputShape: [inputSize] }));
    model.add(tf.layers.dense({ units: 64, activation: 'relu' }));
    model.add(tf.layers.dense({ units: actionSize, activation: 'softmax' }));
    return model;
}

// --- State Extraction ---
function getState(game) {
    // Example: [yourRobot.x, yourRobot.y, yourRobot.health, nearestRobot.x, nearestRobot.y, nearestRobot.health]
    let nearest = game.defaultRobot;
    game.robots.forEach(robot => {
        if (robot.x**2 + robot.y**2 < nearest.x**2 + nearest.y**2) {
            nearest = robot;
        }
    });
    return [
        game.yourRobot.x / game.mcw,
        game.yourRobot.y / game.mch,
        game.yourRobot.health,
        nearest.x / game.mcw,
        nearest.y / game.mch,
        nearest.health
    ];
}

// --- Action Mapping ---
const actions = ['w', 'a', 's', 'd', 'shoot'];
function takeAction(actionIdx, game) {
    const action = actions[actionIdx];
    if (action === 'shoot') {
        let nearest = game.defaultRobot;
        game.robots.forEach(robot => {
            if (robot.x**2 + robot.y**2 < nearest.x**2 + nearest.y**2) {
                nearest = robot;
            }
        });
        simulateMouseMove(nearest.x, nearest.y, game);
    } else {
        // Simulate key press
        if (!game.keysDown.includes(action.toUpperCase())) {
            game.keysDown.push(action.toUpperCase());
        }
    }
}

// --- Reward Function ---
function getReward(game, prevRobotCount) {
    // +1 for killing a robot, -1 for dying, small negative for each step
    let reward = 0;
    if (game.robots.length < prevRobotCount) reward += 1;
    if (game.yourRobot.health <= 0) reward -= 1;
    reward -= 0.01; // time penalty
    return reward;
}

// --- Model Management ---
async function getLatestModelDir(baseDir = 'NNet', prefix = 'policy_model_') {
    const fs = require('fs');
    const path = require('path');
    const dirs = fs.readdirSync(baseDir)
        .filter(f => f.startsWith(prefix) && fs.statSync(path.join(baseDir, f)).isDirectory())
        .sort((a, b) => {
            // Sort by index number
            const ai = parseInt(a.replace(prefix, ''));
            const bi = parseInt(b.replace(prefix, ''));
            return bi - ai;
        });
    if (dirs.length > 0) {
        return path.join(baseDir, dirs[0], 'model.json');
    }
    return null;
}

// --- RL Training Loop ---
async function train(numEpisodes = 1000) {
    const inputSize = 6;
    const actionSize = actions.length;
    let policyNet;
    // Try to load latest model
    const latestModelPath = await getLatestModelDir('NNet', 'policy_model_');
    if (latestModelPath && fs.existsSync(latestModelPath)) {
        console.log(`Loading existing model from ${latestModelPath}`);
        policyNet = await tf.loadLayersModel('file://' + latestModelPath);
    } else {
        policyNet = createPolicyNetwork(inputSize, actionSize);
    }
    const optimizer = tf.train.adam(0.001);

    for (let episode = 0; episode < numEpisodes; episode++) {
        // Reset game state
        game.yourRobot.health = 1;
        game.yourRobot.x = game.ledgeOrder[Math.ceil(game.ledgeOrder.length/2)].x * game.mcw;
        game.yourRobot.y = game.ledgeOrder[Math.ceil(game.ledgeOrder.length/2)].y * game.mch - game.yrm/2;
        game.yourRobot.velX = 0;
        game.yourRobot.velY = 0;
        game.yourRobot.lasers = [];
        game.yourRobot.idCounter = 0;
        game.yourRobot.atBottom = false;
        // Properly re-initialize robots array
        game.robots.length = 0;
        for (let i = 0; i < 12; i++) {
            let robot = new game.Robot(i);
            game.robots.push(robot);
        }
        game.timer = 0;
        let done = false;
        let prevRobotCount = game.robots.length;
        let totalReward = 0;
        let states = [];
        let actionsTaken = [];
        let rewards = [];
        let steps = 0;

        while (!done && steps < 2000) {
            const state = getState(game);
            const stateTensor = tf.tensor([state]);
            const actionProbs = policyNet.predict(stateTensor).dataSync();
            const actionIdx = tf.multinomial(tf.tensor(actionProbs), 1).dataSync()[0];
            takeAction(actionIdx, game);
            game.physicsLoop();
            const reward = getReward(game, prevRobotCount);
            prevRobotCount = game.robots.length;
            totalReward += reward;
            states.push(state);
            actionsTaken.push(actionIdx);
            rewards.push(reward);
            steps++;
            if (game.yourRobot.health <= 0 || game.robots.length === 0) done = true;
        }

        // Policy Gradient Update (REINFORCE)
        const returns = [];
        let G = 0;
        for (let t = rewards.length - 1; t >= 0; t--) {
            G = rewards[t] + 0.99 * G;
            returns[t] = G;
        }
        returns.reverse();

        await optimizer.minimize(() => {
            const stateBatch = tf.tensor(states);
            const actionBatch = tf.tensor1d(actionsTaken, 'int32');
            const returnBatch = tf.tensor1d(returns);
            const logits = policyNet.predict(stateBatch); // Use predict instead of apply
            // logits shape: [batch, actionSize]
            const actionMasks = tf.oneHot(actionBatch, actionSize); // [batch, actionSize]
            const selectedProbs = tf.sum(tf.mul(logits, actionMasks), 1); // [batch]
            const logProbs = tf.log(selectedProbs.add(1e-8)); // add epsilon for numerical stability
            const loss = tf.neg(tf.mean(tf.mul(logProbs, returnBatch)));
            return loss;
        });

        console.log(`Episode ${episode + 1}: Total Reward = ${totalReward}, Steps = ${steps}, Robots Remaining = ${game.robots.length}`);
    }
    await policyNet.save('file://NNet/policy_model');
    // Rotate history
    const newModelDir = rotateModelHistory('NNet/policy_model', 5);
    fs.renameSync('NNet/policy_model', newModelDir);
    console.log(`Training complete. Model saved to ${newModelDir}`);
}

function rotateModelHistory(modelDir = 'NNet/policy_model', maxHistory = 5) {
    const baseDir = path.dirname(modelDir);
    const files = fs.readdirSync(baseDir)
        .filter(f => f.startsWith('policy_model_') && fs.statSync(path.join(baseDir, f)).isDirectory())
        .sort();
    // Remove oldest if exceeding maxHistory
    while (files.length >= maxHistory) {
        const oldest = files.shift();
        fs.rmSync(path.join(baseDir, oldest), { recursive: true, force: true });
    }
    // Find next available index
    let idx = 1;
    while (fs.existsSync(path.join(baseDir, `policy_model_${idx}`))) idx++;
    return path.join(baseDir, `policy_model_${idx}`);
}

if (require.main === module) {
    // Parse command-line argument for episodes
    const args = process.argv.slice(2);
    let numEpisodes = 1000;
    args.forEach(arg => {
        if (arg.startsWith('--episodes=')) {
            numEpisodes = parseInt(arg.split('=')[1], 10);
        }
    });
    train(numEpisodes);
}
