# RobotAttack

## Purpose
This repository is inspired by DeepMind's approach to Atari games, where AI agents train by playing repeatedly until they surpass human performance. The goal here is to enable AI to learn and master a simple HTML canvas game (`code.js` and `index.html` in the root) by simulating gameplay and training neural networks.

## Directory Structure
- Current (this commit)
  - Root: Contains the human-playable HTML canvas game (`index.html`, `code.js`).

- Planned (may not exist in this commit; to be added in future work)
  - `Sim/`: Headless simulation used for RL training. Implements the same essential game logic as the human version, but in separate code (no reuse of `code.js`).
  - `NNet/`: Neural network and AI code for training and inference.
  - `AIDemo/`: Standalone demo where an AI controls the game using the same essential game logic as the human version (no code reuse).

## Prerequisites
- Node.js: >= 18.x LTS (TBD exact tested version)
- npm: >= 9.x (or yarn >= 1.22) (TBD)
- Browser: Latest Chrome/Chromium or Firefox recommended
- OS: Linux/macOS/Windows (dev container: Ubuntu 22.04 LTS)
- Optional for training: NVIDIA GPU + CUDA/cuDNN (TBD exact versions)

## Quick Start
- Human game: Open index.html in a browser (file:// or via a simple static server). In this dev container, you can run a local server (TBD) or open manually on the host.
- Tests and servers: TBD until Sim/, AIDemo/, and servers are added.
- Seeds: If a seed is supported (future), pass via CLI flag or query param (?seed=1234) (TBD).

## Project Roadmap (high-level)
- Phase 1: Add Sim/ with headless game logic, Jest setup, seeded RNG, and parity tests.
- Phase 2: Add AIDemo/ with its web server and telemetry writing.
- Phase 3: Add NNet/ with training loop (CPU/GPU), reward shaping, and evaluation.
- Phase 4: Harden parity tests, performance, and documentation (schemas finalized).

## Glossary / Definitions
- Canvas and canvas size: In the simulation/RL implementation, there is no HTML canvas. Interpret “canvas size” as world dimensions (width, height) used consistently by all implementations.

## Structure and Rules
- Human implementation (Root): The mouse controls where the player robot shoots via mousemove events. The player robot continuously fires when the mouse moves; if the mouse is not moved, it does not fire. A crosshair cursor will be added after this commit. The player wins if all attacking robots are destroyed first; otherwise, the player loses.
- No sharing of code between implementations: The three implementations must not share runtime/game-logic code. They may share non-executable artifacts such as test specifications, schemas, and configuration files used for verification.

## Essential Game Logic Invariants (current human implementation)
- World/canvas
  - Width = window.innerWidth, Height = window.innerHeight
  - mcm = min(width, height), yrm = mcm/20 (player/enemy square size)
  - velChange = canvasHeight/324
- Player (YourRobot)
  - Starts at middle ledge; health = 1; atBottom = false
  - Movement: A => velX = -3*velChange; D => velX = +3*velChange; W => jump (velY = -6*velChange) only if not falling; S => drop (velY = +3*velChange) only if not falling and not at bottom; F => velX = 0
  - Gravity: if falling => velY += velChange/4; else velY = 0 and velX *= 0.95
  - Self-heal: if health < 1 - 1/3600 then health += 1/3600 per frame
  - Bottom hazard: if y > canvasHeight - 1.5*yrm then health -= 1/180 per frame
- Shooting (player)
  - Cooldown: can shoot at most once every 10 physics frames
  - Trigger: only on mousemove; shot originates from player toward the event’s (x,y)
  - Laser: color blue; speed 10 px/frame; removed if outside canvas
- Enemies (Robot)
  - Spawn: 12 robots at start; health = 1; speed = 3*velChange
  - Motion target: orbits around player toward distance tarD ∈ [mcm/8, mcm/2]
  - Health decay: -1/1200 per frame; removed if health < 0
  - On hit (their laser on player): player health -= 0.05; robot heals +0.2 (capped at 1)
  - Shooting schedule: robot fires based on per-robot periods/offsets (st.d, st.v)
  - Enemy lasers: color yellow; advance at robot speed (3*velChange); removed if outside canvas
  - Note: a laserSpeed property exists but is unused (current behavior is canonical)
- Collisions
  - Player lasers vs enemies: check against the single “nearest-to-origin” robot’s AABB (size ≈ yrm); if hit => that robot health -= 0.2
    - Note: nearest-to-origin selection (not nearest-to-laser) is a current behavior and used as canonical for parity
  - Enemy lasers vs player: AABB hit if within player square (yrm/2 half-extent)
- Ledges
  - 18 ledges, random positions, sorted by y ascending; landing when player bottom is near ledge y within ±(velY+1) and horizontally within ledge width plus player half-size
- Rendering (human)
  - Background fill; ledges; lasers; robots; player; HUD bar at bottom

## Software Design & Development Plan
1. Game Simulation
   - Examine and refactor (with functional equivalence) `code.js` and any inline logic so that tests can verify equivalence among: the human implementation (Root), the simulation (Sim), and the AI Demo (AIDemo). Prefer moving inline script into `code.js` if needed to enable testing. Use TDD with Jest; avoid Mocha.
   - Implement a headless simulation harness in `Sim/` without reusing code from the Root. The simulation may accelerate or step time to run as fast as possible, but event ordering and outcomes must match the human implementation under identical seeds and step counts.

2. AI Integration
   - Develop models in `NNet/` to control the player robot.
   - Interface the AI with the simulation harness for training and evaluation.

3. Training Loop
   - Automate repeated gameplay, collecting state, actions, and rewards.
   - Use RL or suitable algorithms to improve performance. Prefer TensorFlow with GPU if available; otherwise, utilize all logical CPUs for parallel training when possible.

4. Evaluation & Benchmarking
   - Compare AI performance against baselines (random or scripted agents).
   - Visualize progress. The AI Demo should reflect learned behavior while tests confirm its game logic matches the essential logic.

5. Extensibility
   - Design for easy modification of rules, models, and parameters.

6. GUI Design
   - Provide two simple Node web servers: one for the human game (`index.html`), one for the AI Demo. Each server records measured client rendering info (e.g., canvas/world dimensions) into a JSON file for verification.
   - Canonical source of truth: The human game server’s recorded dimensions are canonical. The AI Demo should accept expected dimensions as input and fail fast on mismatch, while also writing its measured dimensions for comparison.
   - The simulation consumes the same world dimensions (not a DOM canvas) and should validate against the canonical dimensions.

7. No Sharing of Code Between the Three Implementations
   - Each implementation maintains its own JavaScript files in its directory (Root, `Sim/`, `AIDemo/`). Do not import/export runtime or game-logic modules across implementations.
   - Code duplication is acceptable: identical-looking code and variable names may appear in multiple implementations if they serve the same purpose.
   - Changes in one implementation must not affect the others; tests enforce behavioral parity, not code reuse.
   - When editing JavaScript, be explicit about which implementation the change belongs to and keep files scoped to that implementation’s directory.
   - Sharing non-executable artifacts is allowed (e.g., test specs/fixtures, JSON schemas/configuration, build/test tooling).

8. Testing
   - Use Jest. For the human implementation, use jsdom shims as needed; for the simulation, run purely in Node.
   - Ensure essential game logic parity across all three implementations. Account for differences in input sources: human (keyboard/mouse), simulation and AI Demo (programmatic).
   - Determinism: Use seeded RNG so that, under identical seeds and starting conditions, the human and AI Demo produce identical results at the same step rate, and the simulation produces identical sequences when advanced equivalently (even if it runs faster overall).
   - Include tests that validate identical results across implementations given the same seed and initial conditions.

9. Reward Shaping (high-level)
   - During training, accumulate a negative time penalty per step. At the end of an episode, scale this penalty by the fraction of remaining non-player robots to reduce or eliminate penalties when the player destroys all enemies.

10. Requirements or Assumptions
   - The AI Demo is intended to run on the same screen as the human game, so captured dimensions are applicable. Running elsewhere is possible with additional work.

## Getting Started
1. Open `index.html` in a browser to play the game manually.
2. Planned components (`Sim/`, `NNet/`, `AIDemo/`) may not be present yet. They will be added in future commits alongside their servers, tests, and documentation.

## Contributing
Pull requests and issues are welcome. Please see the development plan above for guidance on where to contribute.

## World/Canvas Schema (canonical; consumed by all)
- Purpose: unify world dimensions across implementations; the human server is canonical
- Suggested path: ./config/world.json (TBD)
- Fields (TBD unless marked):
  - width: number
  - height: number
  - dpr: number (devicePixelRatio) (TBD source)
  - seed: number | string (TBD)
  - impl: "human" | "aidemo" | "sim"
  - timestamp: ISO-8601 string
- Example:
  ```json
  {
    "width": 1920,
    "height": 1080,
    "dpr": 1,
    "seed": 1234,
    "impl": "human",
    "timestamp": "2025-01-01T00:00:00.000Z"
  }
  ```

## Telemetry JSON Schema (for verification)
- Purpose: each web server writes a telemetry JSON capturing measured client info
- Suggested paths (TBD): ./data/human-telemetry.json, ./data/aidemo-telemetry.json
- Fields:
  - measuredWidth, measuredHeight: number
  - clientWidth, clientHeight: number (CSS layout size) (TBD)
  - dpr: number
  - impl: string
  - userAgent: string (optional)
  - seed: number | string (optional)
  - timestamp: ISO-8601 string
- Example:
  ```json
  {
    "measuredWidth": 1920,
    "measuredHeight": 1080,
    "clientWidth": 1920,
    "clientHeight": 1080,
    "dpr": 1,
    "impl": "human",
    "userAgent": "Mozilla/5.0 ...",
    "seed": 1234,
    "timestamp": "2025-01-01T00:00:00.000Z"
  }
  ```

## Determinism and RNG Seeding Policy
- All implementations must accept a seed and use a deterministic PRNG
- Default seed: 1337 (TBD)
- Seed ingress: CLI flag (sim), server arg/env var (human, aidemo), or query param (?seed=1337) (TBD)
- PRNG: a small, fast deterministic function (e.g., mulberry32, xorshift) or a library (TBD)
- Tests use fixed seeds; parity requires identical sequences/events across implementations

## Input Abstraction
- Human: real keyboard/mouse events
- Sim/AIDemo: programmatic events via an input queue with timestamps (frame indices)
- Common event shape (suggested):
  - type: "keydown" | "keyup" | "mousemove" | "action"
  - payload: { key?: "w"|"a"|"s"|"d"|"f", x?: number, y?: number }
  - frame: integer frame index
- Parity: given identical event timelines and seeds, outcomes must match

## Simulation Stepping Contract
- API (suggested):
  - init({ world, seed }): initialize with world dims and RNG seed
  - reset(initialState?): return canonical initial state
  - step(action, frames=1): advance N frames, returns { state, reward, done, info }
- Time: frames are the unit; accelerated mode processes many frames per call while preserving event ordering

## Physics and Collision Details (current human implementation)
- Sizes: yrm = min(width,height)/20; player/enemy squares drawn with side yrm
- Gravity: g = velChange/4 where velChange = canvasHeight/324
- Jump velocity: -6*velChange; horizontal speed: ±3*velChange
- Friction when grounded: velX *= 0.95
- Player laser speed: 10 px/frame; enemy laser speed: 3*velChange (current behavior)
- Collision model: axis-aligned bounding boxes as described in invariants
- Edge conditions: objects removed when outside [0,width]x[0,height]

## Termination Conditions
- Loss: player health <= 0 (physics/drawing loops stop)
- Win: intended when all enemies destroyed (robots.length === 0), but not currently implemented as a termination; loop continues (TBD to formalize and signal “win”)
- Episode end (sim): must emit done=true on loss or win (TBD to align human/aidemo)

## Testing
- Framework: Jest (no Mocha)
- Environments: jsdom for human; Node for sim; browser or jsdom for AIDemo as needed
- Test types:
  - Unit tests for physics, collision, cooldowns, RNG determinism
  - Golden-state snapshots at fixed frames for each implementation
  - Cross-implementation parity tests with identical seeds and event timelines
  - Schema validation tests for world.json and telemetry JSON
- How to run: npm test (TBD scripts)
- CI: TBD

## Reward Shaping (high-level)
- During training, accumulate a negative time penalty per step. At the end of an episode, scale this penalty by the fraction of remaining non-player robots to reduce or eliminate penalties when the player destroys all enemies.

### Reward example (proposed)
- Parameters: step penalty λ = 0.001; initialEnemies = 12
- Accumulated steps S = 5000; timePenalty = -λ*S = -5.0
- If remainingEnemies = 0 (win): scaledPenalty = 0; baseReward = +1; final = +1
- If remainingEnemies = 3: scaledPenalty = timePenalty * (remainingEnemies/initialEnemies) = -5.0 * (3/12) = -1.25; baseReward = -1 on loss or +1 on win; example final (loss) = -2.25
- Exact constants TBD; intent: no time penalty if all enemies are destroyed
