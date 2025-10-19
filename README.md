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
- Install and start both servers:
  - npm install
  - npm start
- Human Control Panel:
  - http://localhost:3000/ (Human server)
  - From the Control Panel, launch the Human Game (index.html), and open AI Demo replays (served from the AI Demo server).
- AI Demo (direct URL, optional):
  - http://localhost:3001/AIDemo/index.html
- Seeds: When supported, pass a seed via query param (?seed=1234) or Control Panel input.
- Run tests:
  - npm run test:integration

## Project Roadmap (high-level)
- Phase 1: Finish Human game implementation + Human web server + Control Panel
  - Implement the canonical fixes: single fixed-timestep loop (physics -> render), continuous collision detection for lasers so shots reliably hit targets, win/loss signage with draw handling, seeded PRNG support, input conflict policy, DPI-correct mouse mapping, ledge snap, clamp player, configurable enemy boundary modes, and safe collection updates (no in-loop splicing).
  - Deliver the Human web server and Control Panel page to launch the game, start/stop recording, and manage replays/parity checks (TBD).
  - Adopt world.json and human-telemetry.json as specified; write canonical telemetry on session end.

- Phase 1 status (this commit)
  - Completed:
    - Human web server and Control Panel implemented
    - Single fixed-timestep loop (physics -> render)
    - Seeded PRNG (query param ?seed=...) wired into all randomness (including ledges, robot spawn x, tarD, shooting schedules)
    - Crosshair and initial shot toward (200,200)
    - DPI-safe mouse mapping, input conflict policy, clamp player, ledge snap
    - Win/Loss signage and draw handling; telemetry POST on game end
    - enemyBoundaryMode implemented; default kept as "original" for better gameplay (bounce/splat available but not default)
    - Safe collection updates for lasers/robots; jsdom integration tests passing
  - Deferred to later phase:
    - Optional CCD for enemy lasers (player lasers can remain legacy until parity tests require CCD)
    - Recording/Replay UI and parity checks in Control Panel

- Phase 2: Add AIDemo/ with its web server, telemetry, and replay capability
  - Build AIDemo server and UI; load recordings from the Control Panel and replay deterministically with AI disabled.
  - Ensure AIDemo consumes the canonical world.json and writes aidemo-telemetry.json.
  - Update the README with any new canonical info discovered while finishing the Human implementation (e.g., finalized parameters, schemas, or policies).

- Phase 3: Add Sim/ with headless game logic, Jest setup, seeded RNG, and parity tests
  - Implement a headless simulation (no code sharing) with step() API and seeded PRNG.
  - Create Jest tests for determinism and cross-implementation parity (against Human/AIDemo recordings and golden snapshots).
  - CI and scripts to run parity tests locally (TBD).

- Phase 4: Add NNet/ with training loop and evaluation (optional continuation)
  - Implement training (CPU/GPU), reward shaping, episode management, and evaluation baselines.

- Phase 5: Hardening and documentation (optional continuation)
  - Harden parity tests and performance; finalize schemas; expand docs and Control Panel workflows.

## Glossary / Definitions
- Canvas and canvas size: In the simulation/RL implementation, there is no HTML canvas. Interpret “canvas size” as world dimensions (width, height) used consistently by all implementations.

## Structure and Rules
- Human implementation (Root): The mouse controls where the player robot shoots via mousemove events. The player fires one initial shot at frame 0 toward the canonical crosshairStart (200,200), then continues to fire on mousemove subject to cooldown. A crosshair cursor will be added after this commit. The player wins if all attacking robots are destroyed first; otherwise, the player loses.
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
  - Initial shot: at frame 0, fire once toward crosshairStart (canonical: 200,200).
  - Cooldown: can shoot at most once every 10 physics frames thereafter.
  - Trigger (subsequent): on mousemove; shot originates from player toward the event’s (x,y), mapped to canvas coordinates.
  - Laser: color blue; speed 10 px/frame; removed if outside canvas
  - Crosshair initial position: (200, 200) canvas pixels at frame 0; all implementations must use this exact initial aim point since shooting starts immediately.
- Enemies (Robot)
  - Spawn: 12 robots at start; health = 1; speed = 3*velChange
  - Motion target: orbits around player toward distance tarD ∈ [mcm/8, mcm/2]
  - Health decay: -1/1200 per frame; removed if health < 0
  - On hit (their laser on player): player health -= 0.05; robot heals +0.2 (capped at 1)
  - Shooting schedule: robot fires based on per-robot periods/offsets (st.d, st.v)
  - Enemy lasers: color yellow; advance at robot speed (3*velChange); removed if outside canvas
  - Note: a laserSpeed property exists but is currently unused; per the Proposed Fixes it will govern enemy laser travel.
- Collisions
  - Player lasers vs enemies: check against the single “nearest-to-origin” robot’s AABB (size ≈ yrm); if hit => that robot health -= 0.2
    - Note: nearest-to-origin selection (not nearest-to-laser) is a current behavior and used as canonical for parity
  - Enemy lasers vs player: AABB hit if within player square (yrm/2 half-extent)
- Ledges
  - 18 ledges, random positions, sorted by y ascending; landing when player bottom is near ledge y within ±(velY+1) and horizontally within ledge width plus player half-size
- Rendering (human)
  - Background fill; ledges; lasers; robots; player; HUD bar at bottom

## Canonical Human Implementation: Proposed Fixes for Determinism and Parity
The following changes will be applied to the human implementation (canonical) to preserve gameplay feel while improving determinism and parity. Other implementations will target this behavior.

- Win/Loss signaling and draw handling
  - On game end, render a full-screen message:
    - Green “Win” if all enemies are destroyed (robots.length === 0).
    - Red “Loss” if player health <= 0.
    - If both occur on the same frame, treat as Win but set gameDrawn = true in captured data.
  - Capture outcome in telemetry (see schema).

- Player laser hit-test anomaly
  - Change to line-segment vs AABB collision for the laser’s travel between frames.
  - On multiple hits in the same step, apply damage to the nearest intersection along the laser path and remove the laser.
  - Question: Should player lasers ever pierce multiple enemies? Proposal: No (single-hit), for determinism.

- Enemy laser speed vs unused laserSpeed
  - Use laserSpeed as a multiplier on robot.speed for enemy laser travel: enemyLaserStep = laserSpeedMultiplier * robot.speed.
  - Default multiplier = 1 (preserves current feel). Allowed range (TBD, e.g., 0.5–3). Seeded randomness can vary multiplier per robot.

- Nondeterministic randomness
  - Introduce a deterministic PRNG (e.g., mulberry32/xorshift) seeded per run.
  - Default behavior: fresh seed per human play for variety; tests/replays: fixed seed.
  - Recording and replay:
    - Record initial seed, world config, and input timeline to a JSON file.
    - The AI Demo can replay this recording exactly with AI disabled.
    - Provide a Control Panel page (served by the human server) to start/stop recording, launch AI Demo replays, and run parity checks. Details TBD.

- Dual rAF loops and order sensitivity
  - Use a single game loop with a fixed-timestep accumulator:
    - Physics: advance in fixed frames (e.g., 60 FPS equivalent), possibly multiple steps per render.
    - Render: after physics steps, draw current state.
  - Order is always physics then render.

- In-loop array mutation
  - Avoid splicing while iterating. Either:
    - Iterate backwards with index loops; or
    - Collect removals and batch-remove post-iteration.
  - This applies to lasers and robots.

- Input conflict handling (canonical policy)
  - Horizontal (A/D): if both pressed, cancel out (net 0). Otherwise apply ±3*velChange.
  - Vertical (W/S): W applies jump impulse only when grounded; S initiates drop only when grounded and not at bottom.
  - Brake (F): overrides horizontal motion; sets velX = 0 while held, both on ground and mid-air. Other horizontal inputs are ignored while F is held.
  - Multiple inputs can co-exist per-axis as above.

- Mouse coordinates and DPI/layout coupling
  - Map mouse to canvas coordinates using getBoundingClientRect and devicePixelRatio.
  - Optionally support Pointer Lock for consistent relative aiming (TBD, off by default).

- Frame-rate dependence
  - Adopt fixed-timestep physics decoupled from render. Game speed is independent of monitor refresh rate.

- Ledge collision tolerance and hovering
  - On grounding, snap player.y to ledge top exactly and reset velY = 0.
  - Use a small positional epsilon to avoid hover/stick jitter. Swept vertical collision preferred (TBD).

- Mid-air braking
  - Support F mid-air brake (horizontal only), as above. Documented in invariants.

- Laser tunneling risk
  - Use continuous collision detection (segment vs AABB) for both player and enemy lasers to prevent tunneling.

- Robots unconstrained by arena bounds
  - Clamp the player to the screen at all times.
  - Add configurable enemy boundary behavior (see world schema):
    - original: current behavior; enemies may go offscreen.
    - bounce: reflect off edges with damping (not perfectly elastic).
    - splat: stop component velocity against the wall; cannot leave screen.

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
   - Initial exploration policy (training-time, canonical default):
     - Inputs: start with high activity in W/A/S/D keypresses to induce movement; use F sparingly (low probability) so braking is rare early on.
     - Aiming/shooting: apply crosshair movement noise to invoke frequent mousemove-triggered shots.
     - Annealing: gradually reduce input rates and crosshair jitter as training progresses (e.g., linear or exponential schedule) so the learned policy sculpts behavior down to efficient actions.
     - Parity note: this policy is for training and demos only; parity tests still use deterministic, scripted inputs.
   - Suggested training config (TBD file path, e.g., ./config/training.json):
     - keysPerSecond: { "w": <num>, "a": <num>, "s": <num>, "d": <num>, "f": <num small> }
     - keyHoldFramesMean/Std: number/number
     - crosshairJitterPx: number (amplitude of position jitter)
     - crosshairJitterHz: number (updates per second)
     - explorationAnneal: { "type": "linear|exp", "start": <num>, "end": <num>, "steps": <num> }

4. Evaluation & Benchmarking
   - Compare AI performance against baselines (random or scripted agents).
   - Visualize progress. The AI Demo should reflect learned behavior while tests confirm its game logic matches the essential logic.

5. Extensibility
   - Design for easy modification of rules, models, and parameters.

6. GUI Design
   - Control Panel (human server): A simple page to
     - Start/stop recording a human play session.
     - Launch AI Demo replays of recorded sessions.
     - Compare telemetry/parity summaries (TBD).
   - Provide two simple Node web servers: one for the human game (`index.html`), one for the AI Demo. Each server records measured client rendering info (e.g., canvas/world dimensions) into a JSON file for verification.
   - Canonical source of truth: The human game server’s recorded dimensions are canonical. The AI Demo should accept expected dimensions as input and fail fast on mismatch, while also writing its measured dimensions for comparison.
   - The simulation consumes the same world dimensions (not a DOM canvas) and should validate against the canonical dimensions.
   - Server isolation
     - Each implementation serves only its own pages and assets:
       - Human server: serves the Human game (index.html, code.js, control-panel.html) and its endpoints (/world.json, /telemetry).
       - AI Demo server: serves the AI Demo (AIDemo/index.html, AIDemo/aidemo.js) and its endpoints (/world.json, /recordings).
     - No server may serve the other implementation’s HTML/JS directly.
   - Ports and coordination
     - Defaults:
       - Human server (HUMAN_PORT): 3000
       - AI Demo server (AIDEMO_PORT): 3001
     - The Control Panel builds the AI Demo URL using AIDEMO_PORT (e.g., http://localhost:3001/AIDemo/index.html). The Human server is configured with this port so the Control Panel can construct the link.
   - Single command orchestration
     - npm start launches both servers and keeps them running together. Stopping the npm start process stops both servers.
     - Optional controls (TBD): special keypress handling to restart both servers without exiting (e.g., press r), and clean shutdown (Ctrl-C).
   - World/telemetry
     - Each server reads/writes only its own world/telemetry JSON as defined in this README. The Control Panel only links to AI Demo; it does not proxy or host AI Demo content.

## No Sharing of Code Between the Three Implementations
   - Each implementation maintains its own JavaScript files in its directory (Root, `Sim/`, `AIDemo/`). Do not import/export runtime or game-logic modules across implementations.
   - Code duplication is acceptable: identical-looking code and variable names may appear in multiple implementations if they serve the same purpose.
   - Changes in one implementation must not affect the others; tests enforce behavioral parity, not code reuse.
   - When editing JavaScript, be explicit about which implementation the change belongs to and keep files scoped to that implementation’s directory.
   - Sharing non-executable artifacts is allowed (e.g., test specs/fixtures, JSON schemas/configuration, build/test tooling).

## Getting Started
1. npm install
2. npm start
   - Human Control Panel: http://localhost:3000/
   - AI Demo (direct): http://localhost:3001/AIDemo/index.html
3. From the Control Panel you can:
   - Launch the Human Game using the canonical world configuration.
   - Start/stop recording a human play session (TBD).
   - Launch AI Demo replays of a selected recording via the AI Demo server.
4. Tests
   - npm run test:integration

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
  - enemyBoundaryMode: "original" | "bounce" | "splat"
  - clampPlayer: boolean
  - crosshairStart: { x: number, y: number } (canonical default: { "x": 200, "y": 200 })
  - timestamp: ISO-8601 string
- Example:
  ```json
  {
    "width": 1920,
    "height": 1080,
    "dpr": 1,
    "seed": 1234,
    "impl": "human",
    "enemyBoundaryMode": "original",
    "clampPlayer": true,
    "crosshairStart": { "x": 200, "y": 200 },
    "timestamp": "2025-01-01T00:00:00.000Z"
  }
  ```

## Telemetry JSON Schema (for verification)
- Purpose: each web server writes a telemetry JSON capturing measured client info and results
- Suggested paths (TBD): ./data/human-telemetry.json, ./data/aidemo-telemetry.json
- Fields:
  - runId: string (unique per session; e.g., UUID)
  - measuredWidth, measuredHeight: number
  - clientWidth, clientHeight: number (CSS layout size) (TBD)
  - dpr: number
  - impl: string
  - userAgent: string (optional)
  - seed: number | string (optional)
  - outcome: "win" | "loss"
  - gameDrawn: boolean
  - frames: integer total physics frames
  - durationMs: number (wall-clock)
  - timestamp: ISO-8601 string
- Example:
  ```json
  {
    "runId": "2f1c1c3e-5c4b-4b7e-ae6b-7da8b3b1b5af",
    "measuredWidth": 1920,
    "measuredHeight": 1080,
    "clientWidth": 1920,
    "clientHeight": 1080,
    "dpr": 1,
    "impl": "human",
    "userAgent": "Mozilla/5.0 ...",
    "seed": 1337,
    "outcome": "win",
    "gameDrawn": false,
    "frames": 4821,
    "durationMs": 81234,
    "timestamp": "2025-01-01T00:00:00.000Z"
  }
  ```

## Determinism and RNG Seeding Policy
- PRNG: deterministic (mulberry32/xorshift; TBD exact function)
- Default seed: fresh per human session; tests/replays: fixed seed
- Seed ingress: CLI flag (sim), env var/server arg or query param (?seed=1337) for human/aidemo (TBD)
- Recording includes the exact seed used

## Input Abstraction
- Conflict resolution (canonical):
  - A+D => cancel; W only when grounded; S only when grounded and not at bottom; F overrides horizontal inputs and zeroes velX while held
- Human: real keyboard/mouse events
- Sim/AIDemo: programmatic events via an input queue with timestamps (frame indices)
- Crosshair default: until the first mousemove event, aim uses world.crosshairStart (canonical: 200,200). The frame-0 initial shot also uses this point.
- Training-time default exploration (for Sim/NNet and AI Demo showcases):
  - Generate frequent W/A/S/D key events; generate fewer F events; apply crosshair jitter to trigger shots.
  - Exploration rates and annealing sourced from training config (see Training Loop).
- Common event shape (suggested):
  - type: "keydown" | "keyup" | "mousemove" | "action"
  - payload: { key?: "w"|"a"|"s"|"d"|"f", x?: number, y?: number }
  - frame: integer frame index
- Parity: given identical event timelines and seeds, outcomes must match

## Simulation Stepping Contract
- Loop and timing model (canonical):
  - Fixed-timestep physics; single loop per frame (physics -> render); possibly multiple physics steps per render to catch up
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
- Collision detection policy:
  - Lasers use continuous collision detection (segment vs AABB)
  - Player grounding snaps to ledge top with epsilon to avoid jitter
- Edge conditions:
  - Lasers are removed when outside [0,width]x[0,height].
  - Robots follow the configured enemyBoundaryMode; they are not culled offscreen in "original" mode.

## Termination Conditions
- Canonical signaling:
  - Win: “Win” in green; Loss: “Loss” in red; simultaneous death and all-enemies-destroyed is treated as Win with gameDrawn = true.
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

## Recording and Replay
- Recording file (suggested path): ./data/recordings/<runId>.json
- Contents:
  - world: the world.json used
  - seed: the run seed
  - inputs: ordered list of { frame, type, payload }
  - outcome, gameDrawn, frames, durationMs
- Replay:
  - AI Demo loads a recording, disables AI control, replays inputs deterministically using the same world and seed
  - Used to demonstrate parity and reassure manual testers
  - Control Panel (human server):
    - Buttons for “Start Recording,” “Stop Recording,” “Replay in AI Demo,” with file selector
    - Optional “Parity Check” runs both human and sim with the same seed and input timeline and compares snapshots (TBD)

## Phase 1 next steps (recommended order)
1. Implement seed ingress (query param ?seed=..., or read world.json) and PRNG wiring.
2. Switch to a single fixed-timestep loop (physics -> render); keep the game speed stable.
3. Add explicit player clamp and ledge snap (verify behavior matches README).
4. Honor enemyBoundaryMode from world.json (original/bounce/splat) with a default of original.
5. Replace in-loop splicing with safe removals (robots/lasers) consistently.
6. Add win signage and draw handling; post telemetry to /telemetry on end-of-game.
7. Verify DPI-safe mouse mapping in code (use getBoundingClientRect + canvas scale).
8. Optional: add CCD for player/enemy lasers if included in Phase 1 scope; otherwise move to Phase 2.

## Logging (per implementation)
- Location: ./logs/ (ignored by git)
  - Human server: logs/human-server.log
  - Human client (browser): logs/human-client.log (sent via POST /client-log)
  - AI Demo server: logs/aidemo-server.log
  - AI Demo client (browser): logs/aidemo-client.log (sent via POST /client-log)
- Server logging
  - Appends key events (startup, listen, telemetry received, recording saved/errors).
  - Simple rotation: if a log exceeds ~1 MB, it is moved to .1.log and a fresh file continues.
- Client logging
  - The Human game and AI Demo attach window.onerror and unhandledrejection handlers, and mirror console.error.
  - Logs are POSTed best-effort to each implementation’s /client-log endpoint and appended to the corresponding client log file.
  - If fetch is unavailable (tests/offline), logging silently no-ops.
- Telemetry files (JSON arrays)
  - Human: ./data/human-telemetry.json
  - AI Demo: ./data/aidemo-telemetry.json
- Recordings
  - Saved by Human server at ./data/recordings/<runId>.json when the Human game runs with ?record=1 and ends (Win/Loss).
  - AI Demo lists files from /recordings and serves them from /data/recordings.

How to inspect logs
- Tail Human server log: tail -f logs/human-server.log
- Tail Human client log: tail -f logs/human-client.log
- Tail AI Demo server log: tail -f logs/aidemo-server.log
- Tail AI Demo client log: tail -f logs/aidemo-client.log
