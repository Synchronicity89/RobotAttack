# RobotAttack

## Purpose
This repository is inspired by DeepMind's approach to Atari games, where AI agents train themselves by playing games repeatedly until they surpass human performance. Here, the goal is to enable AI to learn and master a simple HTML canvas game (`code.js` and `index.html` in the root) by simulating gameplay and training neural networks.

## Structure
- **Root**: Contains the HTML canvas game (`code.js`, `index.html`).  The mouse pointer controls where the player robot shoots, upon the callback of the "on mouse move event", and the player robot cannot stop shooting unless they don't move the mouse at all.  The game shall have a cross hair pointer in commits after this one. The player robot wins if all the other robots attacking it die first, and loses otherwise.  This will be called the Human player implementation of the game logic.
- **Sim/**: Intended for simulation code. The game logic from `code.js` is duplicated into a simulation, without reusing code.js directly, but as a separate gameLogic.js.
In future commits, tests will make sure that the essential game logic of code.js in the root is the same as Sim/gameLogic.js
- **NNet/**: Contains neural network and AI code for training and inference.  It will use Reinforcement Learning (RL) to learn the best policy for playing the game and winning.  When training, a separate time penalty will be summed up to added (subtractively because it will be negative) to the reward.  At the end of the game, the time penalty will be recalculated by dividing the number of non-player robots that are remaining by the summed up time penalty.  This way there will be no time penalty if the player robot kills all the non-player robots!
- **AIDemo/**: Contains separate code to run an AI Demo.  It will allow the AI to control a cross hairs pointer much like a player playing the game.

## Glossary/Definitions:
1. **canvas and canvas size**
   In the Simulation/RL Implementation, there is no HTML canvas object per se, so interpret canvas size as game world dimensions, and canvas as whatever object or even conceptual framework has those properties.

## Software Design & Development Plan
1. **Game Simulation**
   - Examine and refactor (with functional equivalence) `code.js` logic and the script in the index.html so that the game logic equivalance between the original game in the root, the simulation used for RL Training, and the AI Demo, can be tested and make tests fail if there is any difference.  Use a TDD approach, making sure tests fail before implementing code.  If needed push all script out of the HTML page into code.js so that tests can made.  Avoid using Mocha, but instead use Jest and simple shims inside the tests to verify game logic is effectively the same.
   - Implement a simulation harness in `Sim/` to allow rapid, automated gameplay, not reusing any code from the root.  Make sure the tests fail if the game logic is not effectively the same.  The simulation/RL Training might use another object or class to represent the world dimensions of the game.  The game logic has to be exactly the same in terms of relative times of things that happen in the game, but for the sake of rapid training, time can be accelerated or simulated so that training occurs as fast as possible.
2. **AI Integration**
   - Develop neural network models in `NNet/` to control the player robot.
   - Interface the AI with the simulation harness for training and evaluation.
3. **Training Loop**
   - Automate repeated gameplay sessions, collecting state, actions, and rewards.
   - Use reinforcement learning or other suitable algorithms to improve AI performance.  If possible node tensorflow GPU is used for training, if GPU is not available then use all logical CPUs of the computer for training in parallel.
4. **Evaluation & Benchmarking**
   - Compare AI performance against baseline (random or scripted agents).
   - Visualize results and progress.  Make the AI Demo show how well the AI has learned to play the game but make sure the testing confirms that the game logic inside the demo is the same essential game logic.
5. **Extensibility**
   - Design code for easy modification of game rules, AI models, and simulation parameters.
6. **GUI Design**
   - Make two separate simple node web servers that serve the index.html and the AI Demo separately.collect data on the canvas size, the size of the client area where the game is played and any other data that is best obtained this way.  The web servers will write to two different JSON files to allow tests to make sure that the same canvas size, etc is used for all three: the index.html in the root, the simulation/RL Training implementation of the game logic, and the AI Demo implementation of the game logic.  When each of the GUI implementations are run in the browser, the web server will supply it the agreed upon canvas sizes.  The source of truth for canvas size will come from running the web server for index.html. The reason that not only the web server for the human implementation will write JSON is for testing and verification purposes.  It will allow testing and verification (if needed with a human in the loop to complete the verification) to make absolutely certain that the human implementation was the source of truth for canvas sizes and anything else that might change how the game is played.  The simulation/RL Training canvas size will also have to be verified, and that might mean writing a JSON file or perhaps it could simply crash if the canvas size doesn't match the expected size.  The expected size should be a mandatory input when running both the simulation/RL Training and the AI Demo.  
7. **No Sharing of Code Between the Three Implementations**
   - The three implementations of the game logic will not share any code between them.  The testing library will assure that the game logic is the same between them.
8. **Testing**
   - Testing will make sure the essential game logic is the same between the three implmentations, but also test to make sure that subtle difference between the human inputs and the simulated/RL training inputs and AI Demo inputs (WASD keys, mouse movements) are taken account of properly.  Testing will make sure that when the human implementation in the root is run, a human provides the inputs with keyboard and mouse. However when the other two implementations are run this input will come programmatically.  The code must be very clearly and neatly designed to handle that difference in a testable way.  There should be several tests that verify that the three implementations can have identical results amonnst each other under identical starting conditions.  Perhaps use seeding of random number generators, or the like.  The Human and AI Demo implementation will run at the same speed from identical starting conditions and same seeding of random number generators, but the Simulation/RL Training will run as fast as possible with parallel processing as well, but get the same results.
9. **Requirements or Assumptions**
   - The AI Demo is intended to be run on the same screen of the same computer as the Human game was run on, so canvas size can be captured and is applicable.  Running it otherwise would take extra work, but could be possible.

## Getting Started
1. Open `index.html` in a browser to play the game manually.
2. Explore the `Sim/` folder for simulation code and the `NNet/` folder for AI models.
3. Follow the development plan to contribute to simulation and AI training.

## Contributing
Pull requests and issues are welcome. Please see the development plan above for guidance on where to contribute.
