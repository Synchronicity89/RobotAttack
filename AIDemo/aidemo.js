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
    }

    function applyEvent(ev) {
        const t = ev.type;
        const p = ev.payload || {};
        if (t === 'keydown') {
            if (p.key) state.keysDown.add(String(p.key).toLowerCase());
        } else if (t === 'keyup') {
            if (p.key) state.keysDown.delete(String(p.key).toLowerCase());
        } else if (t === 'mousemove') {
            if (state.yrCanShoot) {
                const angle = Math.atan2(p.y - state.player.y, p.x - state.player.x);
                state.lasers.push({ x: state.player.x, y: state.player.y, angle, id: state.player.idCounter++ });
                state.yrCanShoot = false;
            }
        }
    }

    // Simple Robot (visual + orbit motion only; no enemy lasers yet)
    class Robot {
        constructor(id, mcw, mch, mcm, velChange) {
            this.id = id;
            this.health = 1;
            this.x = rand() * mcw;
            this.y = mch;
            this.speed = velChange * 3;
            this.tarD = randomBetween(mcm / 8, mcm / 2, 1);
        }
        update(player, velChange) {
            const angle = Math.atan2(this.y - player.y, this.x - player.x);
            const dx = this.x - player.x, dy = this.y - player.y;
            const distance = Math.hypot(dx, dy) || 1e-6;
            const newA = angle + this.speed / distance;
            const newD = distance + (this.tarD - distance) / (100 / velChange);
            this.x = player.x + Math.cos(newA) * newD;
            this.y = player.y + Math.sin(newA) * newD;
            // slow health decay (future removal hook)
            this.health -= 1 / 1200;
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
        }
    }

    function stepPhysics() {
        const mcw = canvas.width, mch = canvas.height;
        const held = (k) => state.keysDown.has(k);
        // Horizontal
        if (held('a') && held('d')) state.player.vx = 0;
        else if (held('a')) state.player.vx = -3 * state.velChange;
        else if (held('d')) state.player.vx = 3 * state.velChange;
        else state.player.vx *= 0.95;

        // Vertical jump/drop simplified (no ledges in replay)
        if (held('w')) state.player.vy = -6 * state.velChange;
        if (held('s')) state.player.vy = 3 * state.velChange;

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

        // Gravity/friction depending on falling
        if (falling) {
            state.player.vy += state.velChange / 8;
        } else {
            // friction already applied above when no A/D held; ensure brake behavior stays simple in demo
            if (!(held('a') || held('d'))) state.player.vx *= 0.95;
        }

        // Clamp player inside arena
        if (world.clampPlayer !== false) {
            const half = state.yrm / 2;
            state.player.x = Math.max(half, Math.min(mcw - half, state.player.x));
            state.player.y = Math.max(half, Math.min(mch - half, state.player.y));
        }

        // Advance/cull lasers
        for (let i = state.lasers.length - 1; i >= 0; i--) {
            const L = state.lasers[i];
            L.x += Math.cos(L.angle) * 10;
            L.y += Math.sin(L.angle) * 10;
            if (L.x < 0 || L.x > mcw || L.y < 0 || L.y > mch) state.lasers.splice(i, 1);
        }

        // Update robots (orbit around player)
        for (let i = state.robots.length - 1; i >= 0; i--) {
            const rb = state.robots[i];
            rb.update(state.player, state.velChange);
            if (rb.health < 0) state.robots.splice(i, 1); // optional cleanup
        }

        state.timer++;
        if (state.timer % 10 === 0) state.yrCanShoot = true;
        state.frame++;
    }

    function drawFrame() {
        const mcw = canvas.width, mch = canvas.height;
        // Background
        ctx.fillStyle = `rgba(${Math.floor(bc[0] * 255)}, ${Math.floor(bc[1] * 255)}, ${Math.floor(bc[2] * 255)}, 1)`;
        ctx.fillRect(0, 0, mcw, mch);

        // Ledges behind everything
        for (const ledge of ledgeOrder) {
            ledge.drawSelf(ctx, mcw, mch);
        }

        // Lasers
        ctx.lineWidth = 5;
        for (const L of state.lasers) {
            ctx.strokeStyle = '#00f';
            ctx.beginPath();
            ctx.moveTo(L.x - Math.cos(L.angle) * 10, L.y - Math.sin(L.angle) * 10);
            ctx.lineTo(L.x + Math.cos(L.angle) * 10, L.y + Math.sin(L.angle) * 10);
            ctx.stroke();
        }

        // Robots
        for (const rb of state.robots) {
            rb.draw(ctx, state.yrm);
        }

        // Player
        ctx.fillStyle = 'rgba(128,128,128,1)';
        ctx.fillRect(state.player.x - state.yrm / 2, state.player.y - state.yrm / 2, state.yrm, state.yrm);
        ctx.strokeStyle = 'rgba(0,0,255,1)';
        ctx.strokeRect(state.player.x - state.yrm / 4, state.player.y - state.yrm / 4, state.yrm / 2, state.yrm / 2);
    }

    let recording = null;
    let stopFrame = Infinity;
    let finished = false;

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
        // Best-effort telemetry; ignore failures in tests/manual
        try {
            fetch('/aidemo-telemetry', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    impl: 'aidemo',
                    frames: state.frame,
                    measuredWidth: canvas.width,
                    measuredHeight: canvas.height,
                    outcome: 'replay',
                    gameDrawn: false
                })
            }).catch(() => { });
        } catch { }
        // Draw an end banner
        setBanner((new URLSearchParams(window.location.search)).get('rec')
            ? 'Replay End'
            : 'AI Demo Idle');
    }

    function loop() {
        if (finished) return;
        // process replay events, then physics and draw
        stepReplay();
        stepPhysics();
        drawFrame();
        if (state.frame >= stopFrame) {
            postTelemetryAndStop();
            return;
        }
        requestAnimationFrame(loop);
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

        loop();
    }

    boot();
})();
