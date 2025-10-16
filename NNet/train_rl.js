// RL Training Loop for RobotAttack
// Uses TensorFlow.js for policy network and training

const tf = require('@tensorflow/tfjs-node');
const { runSimulation, simulateMouseMove } = require('../Sim/simulate');
const game = require('../code.js');

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

// --- RL Training Loop ---
async function train(numEpisodes = 1000) {
    const inputSize = 6;
    const actionSize = actions.length;
    const policyNet = createPolicyNetwork(inputSize, actionSize);
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
        game.robots.forEach(r => {
            r.health = 1;
            r.x = Math.random() * game.mcw;
            r.y = game.mch;
            r.lasers = [];
            r.idCounter = 0;
        });
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
    console.log('Training complete. Model saved to NNet/policy_model');
}

if (require.main === module) {
    train();
}
