# Copilot instructions for RobotAttack (master branch)

Purpose: Make AI coding agents immediately productive in this repo by encoding the current architecture, workflows, and non-obvious project conventions for the master branch.

## Big picture
- Three implementations by design (no runtime code sharing):
  - Human (root): `index.html`, `code.js`, served by `server/human-server.js` and launched via `server/dev-runner.js` (npm start).
  - AI Demo (`AIDemo/`): separate server and pages (replay-only; AI disabled). Served by `server/aidemo-server.js`. Control Panel links to it on port 3001.
  - Simulation (`Sim/`): headless implementation for RL/parity (separate logic, no imports from root). Entrypoints: `Sim/sim.js`, `Sim/run-sim.js`.
- Control Panel UI (`control-panel.html`) runs on the Human server (port 3000) and launches: (a) Human game, (b) AI Demo replays, (c) telemetry/recordings views.
- No code sharing between implementations: duplicate logic is acceptable; parity is enforced by tests/recordings, not shared source.

## Canonical Human game traits (root `code.js`)
- Fixed-timestep loop: single loop with accumulator; order is physics then render.
- Seeded PRNG: `?seed=...` enables deterministic RNG via `HumanLib.mulberry32` when present; otherwise falls back to Math.random.
- World config: best-effort GET `/world.json`; defaults include `crosshairStart: {x:200,y:200}`, `clampPlayer: true`, and `enemyBoundaryMode` (original | bounce | splat).
- Initial shot: frame 0 fires once toward `crosshairStart` (200,200 by default). Cooldown: one shot per 10 physics frames thereafter, only on mousemove.
- Input policy: keys stored in a Set. A/D cancel when both held; W jump only when grounded; S drop only when grounded and not at bottom; F brakes horizontal velocity (ground/air).
- Player/enemy sizes and motion: `yrm = min(width,height)/20`, `velChange = canvasHeight/324`. Enemies (12) orbit player, decay health, and shoot on per-robot schedules.
- Collisions (current canonical): player lasers check against the single “nearest-to-origin” enemy AABB. Enemy lasers hit player AABB. Arrays are mutated safely (iterate backwards).
- End-state: renders full-screen “Win” (all robots dead) or “Loss” (player HP <= 0). If both on same frame, treat as Win and set gameDrawn.
- Telemetry/recording (best-effort):
  - POST `/telemetry` on end with outcome, frames, measured dimensions.
  - If `?record=1`, record inputs and validation snapshots, POST to `/recordings/save`.

## Servers, ports, and Control Panel
- `npm start` runs `server/dev-runner.js` to launch both servers:
  - Human server: http://localhost:3000/ serves `index.html`, `control-panel.html`, `/world.json`, `/telemetry`, `/recordings/save`, `/server-config.json`.
  - AI Demo server: http://localhost:3001/AIDemo/index.html serves recordings and telemetry for replays; Control Panel builds links using this port.
- Control Panel helpers (in `control-panel.html`): opens Human game (optionally with `?seed=`), enables recording (`?record=1`), lists AI Demo recordings, and deep-links to replays.

## Tests and environments
- Jest config: jsdom via `jest.config.js` with setup file `tests/setup/jest.polyfills.js`.
- Test focus (integration-first): jsdom-based checks for fixed-timestep loop, input policy, seeded RNG, deterministic initial shot, signage, and safe array mutation.
- Scripts (`package.json`):
  - `npm test` runs Jest and tees logs to `./logs`. Note: scripts use POSIX utilities (`sh`, `tee`, `date`, `mkdir -p`). On Windows, run tests from Git Bash or use the VS Code Jest extension.
  - `npm run test:integration` limits to `tests/integration`.
  - Simulation helpers: `npm run sim:run`, `sim:run:latest`, `sim:log`, `sim:tail`.

## Conventions and do/don’t
- Don’t import root `code.js` into `Sim/` or `AIDemo/`. Each implementation keeps its own JS files and can look similar but must be independent.
- Keep seeded RNG taps stable and documented: ledges (18 draws), per-robot spawn and schedules, any optional laser multipliers, etc.
- Preserve canonical policies when editing `code.js`:
  - Single loop with accumulator; physics before render.
  - Initial shot at frame 0 toward `crosshairStart`.
  - Input conflict rules exactly as above; use Set for keys.
  - Safe array removal (iterate backward or collect-and-remove).
- Telemetry endpoints should be best-effort (don’t crash gameplay if fetch fails). Client errors are mirrored via `/client-log`.

## Typical workflows
- Run both servers and Control Panel: `npm start`, open http://localhost:3000/.
- Launch Human game manually: open `index.html` (served) or via Control Panel; pass `?seed=1234` for determinism.
- Record a session: from Control Panel, “Record New Human Session” (appends `?record=1`). Find latest path via `/recordings/latest` and replay on AI Demo.
- Add a gameplay fix in Human:
  - Physics rules go in `stepPhysics()`; drawing in `drawFrame()`.
  - If changing laser collision semantics, update both detection and tests, and document in README under “Proposed Fixes”.
- Add server endpoints: place in the appropriate server (`server/human-server.js` or `server/aidemo-server.js`); keep each server isolated to its implementation.

## Pointers to key files
- Human: `code.js`, `index.html`, `control-panel.html`.
- Servers: `server/dev-runner.js`, `server/human-server.js`, `server/aidemo-server.js`.
- Sim (headless): `Sim/run-sim.js`, `Sim/sim.js`.
- Config/data: `config/`, `data/` (telemetry, recordings).
- Tests: `tests/` (integration, setup). Jest is configured to look under `tests/**/*.test.js`.

If any of the above appears out of sync with the code at HEAD, prefer the code. Please flag discrepancies in a PR and update this file in the same change.