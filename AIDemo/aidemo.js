(function () {
    const canvas = document.getElementById('aidemo');
    const ctx = canvas.getContext('2d');
    const bannerEl = document.getElementById('banner');

    const bc = [102 / 255, 77 / 255, 51 / 255]; // background color
    let world = {
        width: null,
        height: null,
        clampPlayer: true,
        crosshairStart: { x: 200, y: 200 }
    };

    function setBanner(text) {
        if (bannerEl) bannerEl.textContent = text;
    }

    // Seedable RNG and helpers for ledges
    let rand = Math.random;
    function randomBetween(min, max, precision) {
        return Math.floor((rand() * (max - min) + min) / precision) * precision;
    }
    function colorString(r, g, b, a) {
        return `rgba(${Math.floor(r * 255)},${Math.floor(g * 255)},${Math.floor(b * 255)},${Math.max(0, Math.min(1, a))})`;
    }
    function colorMix(r1, g1, b1, a1, r2, g2, b2, a2) {
        const r = r1 * a1 + r2 * a2;
        const g = g1 * a1 + g2 * a2;
        const b = b1 * a1 + b2 * a2;
        const a = a1 + a2;
        return colorString(r, g, b, a);
    }
    class Ledge {
        constructor() {
            this.id = 0;
            this.y = randomBetween(0.1, 0.9, 0.01);
            this.x = randomBetween(0.1, 0.9, 0.01);
            this.w = randomBetween(1 / 16, 1 / 4, 0.01);
        }
        drawSelf(ctx, cw, ch) {
            // Shade based on id to create depth
            const a = (this.id / (18 - 1)) / 2 + 0.25; // 0.25..0.75
            const shade = (1 - a); // darken base color
            const r = Math.floor((bc[0] * 255) * shade);
            const g = Math.floor((bc[1] * 255) * shade);
            const b = Math.floor((bc[2] * 255) * shade);
            ctx.fillStyle = `rgba(${r},${g},${b},1)`;
            ctx.fillRect((this.x - this.w / 2) * cw, this.y * ch, this.w * cw, ch);
        }
    }
    let ledgeOrder = []; // filled on boot

    // Fetch world.json (optional) and the recording (?rec=...)
    async function loadConfig() {
        try {
            const r = await fetch('/world.json', { cache: 'no-store' });
            if (r.ok) world = { ...world, ...(await r.json()) };
        } catch { }
    }

    async function loadRecording() {
        const sp = new URLSearchParams(window.location.search);
        const recUrl = sp.get('rec');
        if (!recUrl) return null;
        const r = await fetch(recUrl, { cache: 'no-store' });
        if (!r.ok) return null;
        return await r.json();
    }

    // Resize canvas to world or window
    function applyCanvasSize() {
        canvas.width = world.width || window.innerWidth;
        canvas.height = world.height || window.innerHeight;
    }

    // Minimal replayable game state (separate from Human code)
    const state = {
        frame: 0,
        timer: 0,
        yrm: 0,
        velChange: 0,
        yrCanShoot: true,
        crosshair: { x: 200, y: 200 }, // gameplay target
        crosshairVisual: { x: 200, y: 200 }, // smoothed visual-only crosshair
        keysDown: new Set(),
        player: {
            x: 0, y: 0, vx: 0, vy: 0, atBottom: false, health: 1, idCounter: 0
        },
        lasers: [],
        robots: [] // added: demo robots for visuals
    };
    // expose for tests
    if (typeof window !== 'undefined') window.demoState = state;

    function initFromWorld() {
        applyCanvasSize();
        const mcw = canvas.width, mch = canvas.height;
        const mcm = Math.min(mcw, mch);
        state.yrm = mcm / 20;
        state.velChange = mch / 324;
        // Start player mid-screen-ish (replay doesn't simulate ledges/robots)
        state.player.x = mcw / 2;
        state.player.y = mch / 2;
        // Initialize crosshair position from world or fallback
        const cs = (world && world.crosshairStart) ? world.crosshairStart : { x: 200, y: 200 };
        state.crosshair.x = Math.max(0, Math.min(mcw, Number(cs.x) || 200));
        state.crosshair.y = Math.max(0, Math.min(mch, Number(cs.y) || 200));
        state.crosshairVisual.x = state.crosshair.x;
        state.crosshairVisual.y = state.crosshair.y;
    }

    function applyEvent(ev) {
        const t = ev.type;
        const p = ev.payload || {};
        if (t === 'keydown') {
            if (p.key) state.keysDown.add(String(p.key).toLowerCase());
        } else if (t === 'keyup') {
            if (p.key) state.keysDown.delete(String(p.key).toLowerCase());
        } else if (t === 'mousemove') {
            // Update crosshair and, if off cooldown, fire toward it
            const cx = Number(p.x);
            const cy = Number(p.y);
            if (Number.isFinite(cx) && Number.isFinite(cy)) {
                state.crosshair.x = cx;
                state.crosshair.y = cy;
            }
            if (state.yrCanShoot) {
                const angle = Math.atan2(state.crosshair.y - state.player.y, state.crosshair.x - state.player.x);
                state.lasers.push({ x: state.player.x, y: state.player.y, angle, id: state.player.idCounter++ });
                state.yrCanShoot = false;
            }
        }
    }

    // Simple Robot (visual + orbit motion + seeded shooting schedule; enemy lasers)
    class Robot {
        constructor(id, mcw, mch, mcm, velChange) {
            this.id = id;
            this.health = 1;
            this.x = rand() * mcw;
            this.y = mch;
            this.speed = velChange * 3;
            this.tarD = randomBetween(mcm / 8, mcm / 2, 1);
            // Enemy lasers and schedule (seeded)
            this.lasers = []; // {id,x,y,angle}
            this.idCounter = 0;
            this.shootTimes = [];
            for (let i = 0; i < randomBetween(1, 3, 1); i++) {
                const info = { d: 0, v: 0 };
                info.d = randomBetween(120, 360, 1);
                info.v = randomBetween(0, info.d, 1);
                this.shootTimes.push(info);
            }
        }
        update(player, velChange) {
            const angle = Math.atan2(this.y - player.y, this.x - player.x);
            const dx = this.x - player.x, dy = this.y - player.y;
            const distance = Math.hypot(dx, dy) || 1e-6;
            const newA = angle + this.speed / distance;
            const newD = distance + (this.tarD - distance) / (100 / velChange);
            this.x = player.x + Math.cos(newA) * newD;
            this.y = player.y + Math.sin(newA) * newD;
            // Fire on schedule
            for (const st of this.shootTimes) {
                if (state.timer % st.d === st.v) this.shoot(player.x, player.y);
            }
            // health decay (removal handled by caller)
            this.health -= 1 / 1200;
        }
        shoot(tarX, tarY) {
            const angle = Math.atan2(tarY - this.y, tarX - this.x);
            this.lasers.push({ id: this.idCounter++, x: this.x, y: this.y, angle });
        }
        draw(ctx, yrm) {
            // body
            ctx.fillStyle = 'rgba(128,128,128,1)';
            ctx.fillRect(this.x - yrm / 2, this.y - yrm / 2, yrm, yrm);
            // outline (health-tinted)
            const h = Math.max(0, Math.min(1, this.health));
            ctx.strokeStyle = `rgba(${Math.floor(255 * h)},${Math.floor(255 * h)},0,1)`;
            ctx.lineWidth = Math.max(1, Math.floor(yrm / 8));
            ctx.strokeRect(this.x - yrm / 4, this.y - yrm / 4, yrm / 2, yrm / 2);
            // enemy lasers
            ctx.lineWidth = 5;
            ctx.strokeStyle = '#ffff00';
            for (const L of this.lasers) {
                ctx.beginPath();
                ctx.moveTo(L.x - Math.cos(L.angle) * 10, L.y - Math.sin(L.angle) * 10);
                ctx.lineTo(L.x + Math.cos(L.angle) * 10, L.y + Math.sin(L.angle) * 10);
                ctx.stroke();
            }
        }
    }

    let demoFalling = true;

    function stepPhysics() {
        const mcw = canvas.width, mch = canvas.height;
        const held = (k) => state.keysDown.has(k);

        // Horizontal input (A/D) with conflict cancel; F brakes horizontal
        if (held('a') && held('d')) {
            state.player.vx = 0;
        } else if (held('a')) {
            state.player.vx = -3 * state.velChange;
        } else if (held('d')) {
            state.player.vx = 3 * state.velChange;
        }
        if (held('f')) state.player.vx = 0;

        // Vertical input gated by previous-frame falling/atBottom
        if (!demoFalling && held('w')) state.player.vy = -6 * state.velChange;
        if (!demoFalling && !state.player.atBottom && held('s')) state.player.vy = 3 * state.velChange;

        // Integrate
        state.player.x += state.player.vx;
        state.player.y += state.player.vy;

        // Sticky ledges and ground snap (match Human logic shape)
        let falling = true;
        for (const ledge of ledgeOrder) {
            if (state.player.y + state.yrm / 2 > ledge.y * mch - state.player.vy - 1) {
                if (state.player.y + state.yrm / 2 < ledge.y * mch + state.player.vy + 1) {
                    if (state.player.x > (ledge.x - ledge.w / 2) * mcw - state.yrm / 2) {
                        if (state.player.x < (ledge.x + ledge.w / 2) * mcw + state.yrm / 2) {
                            falling = false;
                            state.player.atBottom = false;
                            state.player.y = ledge.y * mch - state.yrm / 2;
                            state.player.vy = 0;
                        }
                    }
                }
            }
        }
        // Floor snap
        if (state.player.y + state.yrm / 2 > mch - state.player.vy - 1) {
            if (state.player.y + state.yrm / 2 < mch + state.player.vy + 1) {
                falling = false;
                state.player.atBottom = true;
                state.player.y = mch - state.yrm / 2;
                state.player.vy = 0;
            }
        }

        // Gravity/friction depending on falling; F overrides friction like Human
        if (falling) {
            state.player.vy += state.velChange / 8;
        } else {
            if (!held('f')) state.player.vx *= 0.95;
            else state.player.vx = 0;
        }

        // Update persistent falling for next frame's input gating
        demoFalling = falling;

        // Clamp player inside arena
        if (world.clampPlayer !== false) {
            const half = state.yrm / 2;
            state.player.x = Math.max(half, Math.min(mcw - half, state.player.x));
            state.player.y = Math.max(half, Math.min(mch - half, state.player.y));
        }

        // Advance/cull player lasers
        for (let i = state.lasers.length - 1; i >= 0; i--) {
            const L = state.lasers[i];
            L.x += Math.cos(L.angle) * 10;
            L.y += Math.sin(L.angle) * 10;
            if (L.x < 0 || L.x > mcw || L.y < 0 || L.y > mch) state.lasers.splice(i, 1);
        }

        // Player lasers vs enemies (nearest-to-origin AABB policy)
        if (state.robots.length > 0) {
            // find nearest by origin (x^2 + y^2), not nearest to laser
            let nearestIdx = -1, nearestVal = Infinity;
            for (let i = 0; i < state.robots.length; i++) {
                const r = state.robots[i];
                const d2 = r.x * r.x + r.y * r.y;
                if (d2 < nearestVal) { nearestVal = d2; nearestIdx = i; }
            }
            if (nearestIdx >= 0) {
                const nr = state.robots[nearestIdx];
                for (let i = state.lasers.length - 1; i >= 0; i--) {
                    const L = state.lasers[i];
                    if (L.x > nr.x - state.yrm && L.x < nr.x + state.yrm &&
                        L.y > nr.y - state.yrm && L.y < nr.y + state.yrm) {
                        state.lasers.splice(i, 1);
                        nr.health -= 0.2;
                    }
                }
            }
        }

        // Update robots (orbit + shooting + decay/remove)
        for (let i = state.robots.length - 1; i >= 0; i--) {
            const rb = state.robots[i];
            rb.update(state.player, state.velChange);
            // Advance/cull enemy lasers and check hit on player
            for (let j = rb.lasers.length - 1; j >= 0; j--) {
                const L = rb.lasers[j];
                L.x += Math.cos(L.angle) * rb.speed;
                L.y += Math.sin(L.angle) * rb.speed;
                // AABB hit vs player (yrm/2 half-extent)
                if (L.x > state.player.x - state.yrm / 2 && L.x < state.player.x + state.yrm / 2 &&
                    L.y > state.player.y - state.yrm / 2 && L.y < state.player.y + state.yrm / 2) {
                    rb.lasers.splice(j, 1);
                    // On hit: player health -= 0.05; robot heals +0.2 (cap 1)
                    state.player.health -= 0.05;
                    rb.health = Math.min(1, rb.health + 0.2);
                    continue;
                }
                // cull outside canvas
                if (L.x < 0 || L.x > mcw || L.y < 0 || L.y > mch) rb.lasers.splice(j, 1);
            }
            if (rb.health < 0) state.robots.splice(i, 1);
        }

        // Environment and regen (mirror Human)
        if (state.player.y > mch - state.yrm * 1.5) state.player.health -= 1 / 180;
        if (state.player.health < 1 - 1 / 3600) state.player.health += 1 / 3600;

        state.timer++;
        if (state.timer % 10 === 0) state.yrCanShoot = true;
        state.frame++;
    }

    function drawFrame() {
        const mcw = canvas.width, mch = canvas.height;
        ctx.fillStyle = `rgba(${Math.floor(bc[0] * 255)}, ${Math.floor(bc[1] * 255)}, ${Math.floor(bc[2] * 255)}, 1)`;
        ctx.fillRect(0, 0, mcw, mch);

        // Ledges behind everything
        for (const ledge of ledgeOrder) {
            ledge.drawSelf(ctx, mcw, mch);
        }

        // Player lasers
        ctx.lineWidth = 5;
        for (const L of state.lasers) {
            ctx.strokeStyle = '#00f';
            ctx.beginPath();
            ctx.moveTo(L.x - Math.cos(L.angle) * 10, L.y - Math.sin(L.angle) * 10);
            ctx.lineTo(L.x + Math.cos(L.angle) * 10, L.y + Math.sin(L.angle) * 10);
            ctx.stroke();
        }

        // Robots (also draws enemy lasers)
        for (const rb of state.robots) {
            rb.draw(ctx, state.yrm);
        }

        // Player
        ctx.fillStyle = 'rgba(128,128,128,1)';
        ctx.fillRect(state.player.x - state.yrm / 2, state.player.y - state.yrm / 2, state.yrm, state.yrm);
        ctx.strokeStyle = 'rgba(0,0,255,1)';
        ctx.strokeRect(state.player.x - state.yrm / 4, state.player.y - state.yrm / 4, state.yrm / 2, state.yrm / 2);

        // Crosshair overlay
        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.lineWidth = Math.max(1, Math.floor(state.yrm / 16));
        const cs = 10; // half-size of crosshair arms
        ctx.beginPath();
        ctx.moveTo(state.crosshairVisual.x - cs, state.crosshairVisual.y);
        ctx.lineTo(state.crosshairVisual.x + cs, state.crosshairVisual.y);
        ctx.moveTo(state.crosshairVisual.x, state.crosshairVisual.y - cs);
        ctx.lineTo(state.crosshairVisual.x, state.crosshairVisual.y + cs);
        ctx.stroke();
        ctx.restore();
    }

    // Draw end-of-game signage (Win/Loss)
    function drawEndOverlay(outcome) {
        const mcw = canvas.width, mch = canvas.height;
        const mcm = Math.min(mcw, mch);
        ctx.save();
        ctx.font = `bold ${Math.floor(mcm / 8)}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const isWin = (String(outcome || '').toLowerCase() === 'win');
        ctx.fillStyle = isWin ? '#00ff00' : '#ff0000';
        ctx.fillText(isWin ? 'Win' : 'Loss', mcw / 2, mch / 2);
        ctx.restore();
    }

    let recording = null;
    let stopFrame = Infinity;
    let finished = false;
    let endOutcome = null;
    let endDrawn = false;
    let aiEnabled = false;

    function stepReplay() {
        if (!recording) return;
        // Apply any events scheduled for this frame
        const frame = state.frame;
        for (const ev of recording.inputs || []) {
            if (ev.frame === frame) applyEvent(ev);
        }
    }

    function postTelemetryAndStop() {
        if (finished) return;
        finished = true;

        // Compute outcome from current state (prefer real-time over recording)
        const noEnemies = (state.robots.length === 0);
        const playerDead = (state.player.health <= 0);
        const drawn = noEnemies && playerDead;
        const computedOutcome = noEnemies ? 'win' : (playerDead ? 'loss' : 'replay');
        const isTerminal = (computedOutcome === 'win' || computedOutcome === 'loss');

        try {
            fetch('/aidemo-telemetry', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    impl: 'aidemo',
                    frames: state.frame,
                    measuredWidth: canvas.width,
                    measuredHeight: canvas.height,
                    outcome: computedOutcome,
                    gameDrawn: drawn
                })
            }).catch(() => { });
        } catch { }

        // Final draw + signage if terminal
        drawFrame();
        if (isTerminal) {
            const mcw = canvas.width, mch = canvas.height;
            const mcm = Math.min(mcw, mch);
            ctx.save();
            ctx.font = `bold ${Math.floor(mcm / 8)}px sans-serif`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillStyle = (computedOutcome === 'win') ? '#00ff00' : '#ff0000';
            ctx.fillText((computedOutcome === 'win') ? 'Win' : 'Loss', mcw / 2, mch / 2);
            ctx.restore();
            setBanner(computedOutcome === 'win' ? 'Win' : 'Loss');
        } else {
            setBanner((new URLSearchParams(window.location.search)).get('rec') ? 'Replay End' : 'AI Demo Idle');
        }
    }

    function loop() {
        if (finished) return;
        stepReplay();
        if (aiEnabled) stepAI();
        stepCrosshairVisual();
        stepPhysics();
        drawFrame();

        // Early stop if real-time outcome reached; else use stopFrame upper bound
        const noEnemies = (state.robots.length === 0);
        const playerDead = (state.player.health <= 0);
        if (noEnemies || playerDead || state.frame >= stopFrame) {
            postTelemetryAndStop();
            return;
        }

        requestAnimationFrame(loop);
    }

    // Minimal AI to move the crosshair and trigger shots when no recording is provided
    function stepAI() {
        const mcw = canvas.width, mch = canvas.height;
        // Target the nearest robot to the player; if none, aim at center
        let tx = mcw / 2, ty = mch / 2;
        if (state.robots.length > 0) {
            let bestIdx = -1, bestD2 = Infinity;
            for (let i = 0; i < state.robots.length; i++) {
                const r = state.robots[i];
                const dx = r.x - state.player.x;
                const dy = r.y - state.player.y;
                const d2 = dx * dx + dy * dy;
                if (d2 < bestD2) { bestD2 = d2; bestIdx = i; }
            }
            if (bestIdx >= 0) { tx = state.robots[bestIdx].x; ty = state.robots[bestIdx].y; }
        }
        // Ease crosshair toward target
        const alpha = 0.35;
        const newX = state.crosshair.x + (tx - state.crosshair.x) * alpha;
        const newY = state.crosshair.y + (ty - state.crosshair.y) * alpha;
        // Synthesize a mousemove event to reuse shooting logic
        applyEvent({ type: 'mousemove', payload: { x: newX, y: newY } });
    }

    // Visual-only smoothing for crosshair to improve perceived realism without affecting gameplay
    function stepCrosshairVisual() {
        const alpha = 0.25; // visual easing factor per frame
        const tx = state.crosshair.x;
        const ty = state.crosshair.y;
        const vx = state.crosshairVisual.x + (tx - state.crosshairVisual.x) * alpha;
        const vy = state.crosshairVisual.y + (ty - state.crosshairVisual.y) * alpha;
        // Snap when close to avoid lingering sub-pixel drift
        if (Math.abs(vx - tx) < 0.1) state.crosshairVisual.x = tx; else state.crosshairVisual.x = vx;
        if (Math.abs(vy - ty) < 0.1) state.crosshairVisual.y = ty; else state.crosshairVisual.y = vy;
    }

    async function boot() {
        await loadConfig();
        initFromWorld();

        const sp = new URLSearchParams(window.location.search);
        const recUrl = sp.get('rec');
        if (recUrl) {
            setBanner(`AI Demo Replay: ${recUrl}`);
        } else {
            setBanner('AI Demo: No recording provided (?rec=/data/recordings/your-file.json)');
        }

        recording = await loadRecording();

        // Seed RNG deterministically for ledges (and robots)
        const seedParam = (new URLSearchParams(window.location.search)).get('seed');
        const seed = seedParam != null ? Number(seedParam)
            : (recording && typeof recording.seed === 'number') ? recording.seed
                : null;
        if (seed != null && typeof HumanLib !== 'undefined' && typeof HumanLib.mulberry32 === 'function') {
            rand = HumanLib.mulberry32(Number(seed));
        }

        // Build ledges deterministically
        {
            const ledges = [];
            for (let i = 0; i < 18; i++) ledges.push(new Ledge());
            ledgeOrder = [];
            while (ledges.length > 0) {
                let highest = { item: 0, y: 1 };
                for (let i = 0; i < ledges.length; i++) {
                    if (ledges[i].y < highest.y) { highest.item = i; highest.y = ledges[i].y; }
                }
                ledges[highest.item].id = ledgeOrder.length;
                ledgeOrder.push(ledges[highest.item]);
                ledges.splice(highest.item, 1);
            }
        }

        // Create robots deterministically
        {
            state.robots = [];
            const mcw = canvas.width, mch = canvas.height;
            const mcm = Math.min(mcw, mch);
            for (let i = 0; i < 12; i++) {
                state.robots.push(new Robot(i, mcw, mch, mcm, state.velChange));
            }
        }

        // Compute a conservative stop frame: prefer recording.frames; else last input + margin
        if (recording) {
            const framesField = Number(recording.frames);
            const lastInputFrame = (recording.inputs && recording.inputs.length > 0)
                ? Math.max(...recording.inputs.map((e) => e.frame))
                : 0;
            stopFrame = Math.min(
                framesField > 0 ? framesField : Infinity,
                lastInputFrame + 10,
                5000 // safeguard
            );
        }

        // Enable AI control of crosshair when no recording is provided
        aiEnabled = !recording;

        // If AI is enabled (no recording), perform the canonical initial shot toward crosshairStart
        if (aiEnabled && state.yrCanShoot) {
            applyEvent({ type: 'mousemove', payload: { x: state.crosshair.x, y: state.crosshair.y } });
        }

        loop();
    }

    boot();
})();
