
# RobotAttack

## Purpose
This repository is inspired by DeepMind's approach to Atari games, where AI agents train themselves by playing games repeatedly until they surpass human performance. Here, the goal is to enable AI to learn and master a simple HTML canvas game (`code.js` and `index.html` in the root) by simulating gameplay and training neural networks.

## Structure
- **Root**: Contains the HTML canvas game (`code.js`, `index.html`).
- **Sim/**: Intended for simulation code. The game logic from `code.js` can be adapted to run in a simulation harness using shims and stubs, allowing the AI to train much faster than in a browser.
- **NNet/**: Contains neural network and AI code for training and inference.

## Requirements
- **Screen Size Consistency**: Both RL training and the AI demo must be run on the same computer to ensure the screen size is identical. The game uses the browser window size for the demo and the same size for RL training (set via environment variables or defaults to 800x600).
- **Mode Awareness**: `code.js` uses a `mode` variable to distinguish between RL training (`mode = 'train'`) and AI demo (`mode = 'demo'`). This controls certain behaviors, such as simulated mouse position and input handling.
- **Simulated Mouse Position**: During RL training, simulated mouse movements for shooting start at the center of the screen.

## Software Design & Development Plan
1. **Game Simulation**
   - Refactor or wrap `code.js` logic to run in a non-browser environment (Node.js or similar) using shims/stubs for canvas and event handling.
   - Implement a simulation harness in `Sim/` to allow rapid, automated gameplay.
2. **AI Integration**
   - Develop neural network models in `NNet/` to control the player robot.
   - Interface the AI with the simulation harness for training and evaluation.
3. **Training Loop**
   - Automate repeated gameplay sessions, collecting state, actions, and rewards.
   - Use reinforcement learning or other suitable algorithms to improve AI performance.
4. **Evaluation & Benchmarking**
   - Compare AI performance against baseline (random or scripted agents).
   - Visualize results and progress.
5. **Extensibility**
   - Design code for easy modification of game rules, AI models, and simulation parameters.

## Getting Started
1. Open `index.html` in a browser to play the game manually.
2. Explore the `Sim/` folder for simulation code and the `NNet/` folder for AI models.
3. For RL training, ensure you run the training and the AI demo on the same computer for consistent screen size.
4. The `mode` variable in `code.js` will automatically detect whether it is running in RL training or AI demo mode.

## Contributing
Pull requests and issues are welcome. Please see the development plan above for guidance on where to contribute.
