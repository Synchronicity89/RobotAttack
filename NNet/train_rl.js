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
        // Simulate mouse at center of screen for shooting
        let centerX = game.mcw / 2;
        let centerY = game.mch / 2;
        simulateMouseMove(centerX, centerY, game);
    } else {
        // Simulate key press
        if (!game.keysDown.includes(action.toUpperCase())) {
            game.keysDown.push(action.toUpperCase());
        }
    }
}

// --- Reward Function ---
function getReward(game, prevRobotCount) {
    // +2 for killing a robot, -1 for dying, small negative for each step
    let reward = 0;
    let killedRobot = game.robots.length < prevRobotCount;
    if (killedRobot) reward += 2;
    if (game.yourRobot.health <= 0) reward -= 1;
    // If all robots are killed, reduce time penalty by three quarters
    let timePenalty = 0.01;
    if (game.robots.length === 0 && killedRobot) {
        timePenalty *= 0.25;
    }
    reward -= timePenalty;
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
        let timePenalties = [];
        let steps = 0;

        while (!done && steps < 2000) {
            const state = getState(game);
            const stateTensor = tf.tensor([state]);
            const actionProbs = policyNet.predict(stateTensor).dataSync();
            const actionIdx = tf.multinomial(tf.tensor(actionProbs), 1).dataSync()[0];
            takeAction(actionIdx, game);
            game.physicsLoop();
            const prevReward = getReward(game, prevRobotCount);
            // Extract time penalty from reward function
            let killedRobot = game.robots.length < prevRobotCount;
            let timePenalty = 0.01;
            if (game.robots.length === 0 && killedRobot) {
                timePenalty *= 0.25;
            }
            // If reward was negative due to time penalty, track it
            timePenalties.push(-timePenalty);
            prevRobotCount = game.robots.length;
            totalReward += prevReward;
            states.push(state);
            actionsTaken.push(actionIdx);
            rewards.push(prevReward);
            steps++;
            if (game.yourRobot.health <= 0 || game.robots.length === 0) done = true;
        }

        // Retroactively reimburse 3/4 of time penalty if player wins
        if (game.robots.length === 0 && game.yourRobot.health > 0) {
            // Only reimburse if player won
            let totalTimePenalty = timePenalties.reduce((a, b) => a + b, 0);
            let reimbursement = totalTimePenalty * 0.75;
            rewards[rewards.length - 1] += reimbursement;
            totalReward += reimbursement;
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
    // Rotate and bump all policy_model folders before saving
    bumpPolicyModelFolders('NNet');
    await policyNet.save('file://NNet/policy_model');
    console.log(`Training complete. Model saved to NNet/policy_model`);
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

function bumpPolicyModelFolders(baseDir) {
    const prefix = 'policy_model';
    const fs = require('fs');
    const path = require('path');
    // Find all folders matching policy_model and policy_model_N
    let dirs = fs.readdirSync(baseDir)
        .filter(f => f === prefix || (f.startsWith(prefix + '_') && fs.statSync(path.join(baseDir, f)).isDirectory()));
    // Sort policy_model_N folders by descending N
    let numbered = dirs.filter(f => f.startsWith(prefix + '_'))
        .map(f => parseInt(f.split('_')[1]))
        .filter(n => !isNaN(n))
        .sort((a, b) => b - a);
    // Use temporary names to avoid overwriting
    numbered.forEach(n => {
        const oldName = `${prefix}_${n}`;
        const tmpName = `${prefix}_tmp_${n+1}`;
        fs.renameSync(path.join(baseDir, oldName), path.join(baseDir, tmpName));
    });
    // Rename policy_model to temporary name
    if (dirs.includes(prefix) && fs.statSync(path.join(baseDir, prefix)).isDirectory()) {
        fs.renameSync(path.join(baseDir, prefix), path.join(baseDir, `${prefix}_tmp_1`));
    }
    // Now rename all temporary names to final names
    numbered.forEach(n => {
        const tmpName = `${prefix}_tmp_${n+1}`;
        const finalName = `${prefix}_${n+1}`;
        if (fs.existsSync(path.join(baseDir, tmpName))) {
            fs.renameSync(path.join(baseDir, tmpName), path.join(baseDir, finalName));
        }
    });
    const tmpName = `${prefix}_tmp_1`;
    const finalName = `${prefix}_1`;
    if (fs.existsSync(path.join(baseDir, tmpName))) {
        fs.renameSync(path.join(baseDir, tmpName), path.join(baseDir, finalName));
    }
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
