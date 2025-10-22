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
- Human implementation (Root): The mouse controls where the player robot shoots via mousemove events. The player fires one initial shot at frame 0 toward the canonical crosshairStart (200,200), then continues to fire on mousemove subject to cooldown. A crosshair cursor is rendered and follows the mouse in the Human game. The player wins if all attacking robots are destroyed first; otherwise, the player loses.
- No sharing of code between implementations: The three implementations must not share runtime/game-logic code. They may share non-executable artifacts such as test specifications, schemas, and configuration files used for verification.

### AI Demo crosshair behavior and input policy (minor fix)
- Crosshair control in AI Demo is programmatic:
  - When AI is enabled, the AI moves the crosshair each frame according to its policy, and shots are triggered by that policy subject to the same cooldown rules.
  - When replaying a recorded Human session (AI disabled), the crosshair is driven by the replayed input timeline; positions/events are taken from the recording so replays are deterministic.
- User input in the AI Demo page is non-interactive for gameplay:
  - The browser will still show the user's normal mouse pointer, but mouse moves/clicks in the AI Demo UI do not control the crosshair and do not fire shots.
  - This prevents accidental interference during AI control or deterministic replays and improves parity with recorded sessions.
-
Notes:
- This change does not affect the Human game: the Human implementation continues to use the user's mouse position for aiming and mousemove-triggered shots.
- The Control Panel continues to link to AI Demo replays on port 3001; behavior is unchanged aside from the clarified input policy above.

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

## Training (experimental)
- Kick off a quick RL training session that uses the headless Sim and saves a model under `NNet/policy_model/`:
  - npm run train:rl
- Hardware acceleration:
  - The trainer auto-detects available backends. On Windows, if `@tensorflow/tfjs-node` or `@tensorflow/tfjs-node-gpu` is installed and your environment is set up (CUDA/cuDNN for GPU), the run will use the native TensorFlow backend. Otherwise, it falls back to pure JS (`@tensorflow/tfjs`), which is slower but portable.
  - The script logs detected logical CPUs and whether a GPU backend is active.
- Tuning activity vs. skill:
  - Early episodes favor higher key press rates and larger crosshair movements; as episodes progress, exploration noise is annealed so a better policy can exhibit calmer inputs.

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

### RNG tap alignment checklist
- Ledge generation: 18 draws in identical order/precision.
- Robot spawn X and tarD: per-robot, fixed order.
- Robot shooting schedules: number of schedules per robot, then (d, v) per schedule.
- Any future randomness (e.g., laser speed multipliers) added in a consistent, documented order.

## Recording and Replay
- Recording file (suggested path): ./data/recordings/<runId>.json
- Contents:
  - world: the world.json used
  - seed: the run seed
  - inputs: ordered list of { frame, type, payload }
  - outcome, gameDrawn, frames, durationMs
- Replay:
  - AI Demo loads a recording, disables AI control, replays inputs deterministically using the same world and seed.
  - The AI Demo prefers the live terminal state (win/loss) for end-of-game signage; recorded outcome remains for validation.
  - Validation (planned): AI Demo computes periodic digests and compares to those recorded during Human play to detect divergence (see “Replay Determinism & Parity Plan”).

### Validation snapshots (planned; appended into the recording)
- Purpose: detect divergence early without altering replay (“no cheating”).
- Shape (example, every 30 frames):
  ```json
  {
    "validation": [
      {
        "frame": 0,
        "player": { "x": 512, "y": 384, "vx": 0, "vy": 0, "health": 1 },
        "robotsSummary": {
          "count": 12,
          "digest": "sha1:1f2a...e9",
          "sample": [[0,512,700,1000],[1,120,680,1000]]
        },
        "rngTapCount": 42
      }
    ]
  }
  ```
- Notes:
  - digest: stable hash over a sorted list of tuples (id, round(x), round(y), round(health*1000)).
  - rngTapCount: optional cumulative PRNG taps so far (for early drift detection).
  - AI Demo recomputes and logs mismatches only; it does not mutate state.

## Simulation Stepping Contract
- Loop and timing model (canonical):
  - Fixed-timestep physics; single loop per frame (physics -> render); possibly multiple physics steps per render to catch up
  - API (suggested):
    - init({ world, seed }): initialize with world dims and RNG seed
    - reset(initialState?): return canonical initial state
    - step(action, frames=1): advance N frames, returns { state, reward, done, info }
- Time: frames are the unit; accelerated mode processes many frames per call while preserving event ordering

### Input and stepping order (explicit)
- For each frame N:
  - Apply all inputs whose frame === N to the input abstraction.
  - Run one physics step.
  - Draw/render (if applicable).

### Deterministic world handshake
- Sim and AI Demo accept width/height/dpr from world.json (or the recording’s world snapshot).
- Fail fast (log/throw) when dimensions/device scale differ from canonical values.

### Tolerances (for parity assertions)
- Positions: ±2 px per axis
- Velocities: ±1e-3
- Health: ±1e-3
- Counts (robots/lasers): exact counts; digest-based match for positions/health.

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

### Cross-implementation parity (planned, incremental)
- Add tests that load a recorded session with validation digests and assert that AI Demo matches Human digests for the first N checkpoints (e.g., every 30 frames for 300 frames).
- Verify RNG tap counts (if included) are monotonically increasing and within expected ranges at each checkpoint.

### Sim/ parity tests (planned)
- Sim vs Human (via recording):
  - Load world/seed and input timeline from a short recording (win and loss fixtures).
  - Step Sim for recording.frames frames, applying inputs by frame index.
  - Compare Sim digests to recording validation for the first K checkpoints within tolerances.
- Sim vs AI Demo:
  - Run the same recording through AI Demo replay in jsdom and expose frame snapshots.
  - Compare Sim digests to AI Demo digests at matching frames within tolerances.

### Schema validation (planned)
- Validate world.json, recording.json (including validation snapshots when present), and telemetry JSON using Ajv in tests.
- Record a version field in recording.json and bump on breaking changes.

## Schemas and Versioning (planned)
- world.json
  - { width, height, dpr, seed, impl, enemyBoundaryMode, clampPlayer, crosshairStart, timestamp, schemaVersion }
- recording.json
  - { version, runId, world, seed, inputs[], outcome, gameDrawn, frames, durationMs, validation? }
  - version: semantic version for the recording format; bump on incompatible changes.
- telemetry JSON
  - { impl, frames, outcome, gameDrawn, measuredWidth, measuredHeight, timestamp, ... }
- Tests validate these schemas before parity checks.

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
