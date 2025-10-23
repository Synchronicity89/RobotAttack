(function () {
    const canvas = document.getElementById('aidemo');
    const ctx = canvas.getContext('2d');
    const bannerEl = document.getElementById('banner');
    const levelSelectEl = document.getElementById('levelSelect');

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

    // Read level from URL (?level=1|2); default to 1
    function getSelectedLevel() {
        const sp = new URLSearchParams(window.location.search);
        const lv = sp.get('level');
        const n = Number(lv);
        if (lv === '2' || n === 2) return 2;
        return 1;
    }

    function updateLevelSelectorUI(level) {
        if (!levelSelectEl) return;
        levelSelectEl.value = String(level);
        levelSelectEl.onchange = () => {
            const sp = new URLSearchParams(window.location.search);
            sp.set('level', levelSelectEl.value);
            // Preserve existing rec/seed params
            const url = `${window.location.pathname}?${sp.toString()}`;
            window.location.replace(url);
        };
    }

    function getMode() {
        const sp = new URLSearchParams(window.location.search);
        const m = String(sp.get('mode') || 'diagnostic').toLowerCase();
        return (m === 'realistic') ? 'realistic' : 'diagnostic';
    }

    function enforceModeOrBlock(level, recordingMeta) {
        const mode = state.mode || 'diagnostic';
        if (mode !== 'realistic') return true;
        // Realistic: must start at Level 1; deny starting at >1 or replaying a >1 recording as the first level
        const requestedLevel = Math.max(1, Math.floor(level || 1));
        const recLevel = recordingMeta && (Number(recordingMeta.level) || Number(recordingMeta?.world?.level));
        const firstLevel = Number.isFinite(recLevel) ? Math.max(1, Math.floor(recLevel)) : requestedLevel;
        if (firstLevel > 1) {
            // Block
            drawFrame();
            const mcw = canvas.width, mch = canvas.height; const mcm = Math.min(mcw, mch);
            ctx.save();
            ctx.fillStyle = 'rgba(0,0,0,0.6)';
            ctx.fillRect(0,0,mcw,mch);
            ctx.fillStyle = '#ff8080';
            ctx.font = `bold ${Math.floor(mcm/14)}px sans-serif`;
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText('Realistic mode prohibits skipping to Level ' + firstLevel, mcw/2, mch/2 - mcm/16);
            ctx.font = `normal ${Math.floor(mcm/24)}px sans-serif`;
            ctx.fillText('Remove ?level>1 (or pick Level 1) or switch to ?mode=diagnostic', mcw/2, mch/2 + mcm/16);
            ctx.restore();
            setBanner('Blocked: Realistic mode forbids skipping levels');
            return false;
        }
        return true;
    }

    // Seedable RNG and helpers for ledges
    let rand = Math.random;
    // Policy sampling knobs (URL-overridable):
    //   ?ai_explore=0..1, ?ai_step=px, ?ai_min_step=px, ?ai_jerk_prob=0..1
    (function initPolicyKnobs(){
        try {
            const sp = new URLSearchParams(window.location.search);
            const EXP = parseFloat(sp.get('ai_explore'));
            const STEP = parseFloat(sp.get('ai_step'));
            const MINSTEP = parseFloat(sp.get('ai_min_step'));
            const JERK = parseFloat(sp.get('ai_jerk_prob'));
            window.__policyKnobs = {
                explore: (Number.isFinite(EXP) ? Math.max(0, Math.min(1, EXP)) : 0.6),
                stepPx: (Number.isFinite(STEP) && STEP > 0 ? STEP : 40),
                minStepPx: (Number.isFinite(MINSTEP) && MINSTEP >= 0 ? MINSTEP : 12),
                jerkProb: (Number.isFinite(JERK) ? Math.max(0, Math.min(1, JERK)) : 0.35)
            };
        } catch {
            window.__policyKnobs = { explore: 0.6, stepPx: 40, minStepPx: 12, jerkProb: 0.35 };
        }
    })();
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
            // Level 2+: motion params (sinusoid). Defaults keep Level 1 static.
            this.baseY = this.y;
            this.amp = 0;
            this.omega = 0;
            this.phase = rand() * Math.PI * 2;
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
        robots: [], // added: demo robots for visuals
        mothership: null
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

    // Level 2: Mothership and missiles (AI Demo)
    class Mothership {
        constructor(mcw, mch, mcm, velChange) {
            this.health = 10;
            this.w = Math.max(mcm/10, (mcm/20)*6);
            this.h = Math.max(mcm/14, (mcm/20)*4);
            this.x = mcw/2;
            this.y = mch*0.2;
            this.velX = Math.max(velChange * 0.5, 0.5);
            this.missiles = [];
            this.idCounter = 0;
            this.firePeriod = 180;
        }
        update(player, mcw, mch, velChange) {
            this.x += this.velX;
            if (this.x < this.w/2 || this.x > mcw - this.w/2) this.velX *= -1;
            if (state.timer % this.firePeriod === 0) {
                const ang = Math.atan2(player.y - this.y, player.x - this.x);
                this.missiles.push({ id: this.idCounter++, x: this.x, y: this.y, angle: ang, speed: Math.max(velChange*2, 2), r: Math.max(state.yrm/6, 4) });
            }
            for (let i = this.missiles.length - 1; i >= 0; i--) {
                const m = this.missiles[i];
                m.x += Math.cos(m.angle) * m.speed;
                m.y += Math.sin(m.angle) * m.speed;
                if (m.x < 0 || m.x > mcw || m.y < 0 || m.y > mch) this.missiles.splice(i, 1);
            }
        }
        draw(ctx) {
            ctx.fillStyle = 'rgba(179,26,179,1)';
            ctx.fillRect(this.x - this.w/2, this.y - this.h/2, this.w, this.h);
            // Health bar
            ctx.fillStyle = 'rgba(230,51,230,1)';
            const hw = this.w * (Math.max(this.health, 0) / 10);
            ctx.fillRect(this.x - this.w/2, this.y - this.h/2 - Math.max(2, state.yrm/8), hw, Math.max(2, state.yrm/8));
            // Missiles
            ctx.fillStyle = 'rgba(255,77,26,1)';
            for (const m of this.missiles) {
                ctx.beginPath(); ctx.arc(m.x, m.y, m.r, 0, Math.PI*2); ctx.fill();
            }
        }
    }

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
        // Level 2+: update ledge vertical motion before collision
        if ((state.level || 1) >= 2) {
            for (const L of ledgeOrder) {
                if (L.amp && L.omega) {
                    const yRaw = L.baseY + L.amp * Math.sin((state.timer + L.phase) * L.omega);
                    L.y = yRaw;
                }
            }
        }
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

        // Level 2+: player lasers can also hit mothership
        if (state.mothership && state.mothership.health > 0) {
            const ms = state.mothership;
            for (let i = state.lasers.length - 1; i >= 0; i--) {
                const L = state.lasers[i];
                if (L.x > ms.x - ms.w/2 && L.x < ms.x + ms.w/2 &&
                    L.y > ms.y - ms.h/2 && L.y < ms.y + ms.h/2) {
                    state.lasers.splice(i, 1);
                    ms.health -= 0.2;
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

        // Level 2: update mothership and handle missile collisions vs player
        if (state.mothership && state.mothership.health > 0) {
            state.mothership.update(state.player, mcw, mch, state.velChange);
            for (let i = state.mothership.missiles.length - 1; i >= 0; i--) {
                const m = state.mothership.missiles[i];
                if (m.x > state.player.x - state.yrm/2 && m.x < state.player.x + state.yrm/2 &&
                    m.y > state.player.y - state.yrm/2 && m.y < state.player.y + state.yrm/2) {
                    state.mothership.missiles.splice(i, 1);
                    state.player.health -= 0.05; // reduced to 25% damage
                }
            }
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

        // Lava (bottom hazard) visual overlay: draw over ledge blocks like Human HUD tint
        // Matches damage threshold at y > mch - 1.5*yrm; solid red tint akin to Human HUD bar
        {
            const lavaHeight = Math.max(0, Math.min(mch, state.yrm * 1.5));
            if (lavaHeight > 0) {
                const gy = mch - lavaHeight;
                // Use a semi-transparent red similar to Human's HUD bar (0.7, 0, 0, 0.7)
                ctx.fillStyle = 'rgba(179,0,0,0.7)';
                ctx.fillRect(0, gy, mcw, lavaHeight);
            }
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

        // Level 2: mothership (draw after robots to layer above)
        if (state.mothership && state.mothership.health > 0) {
            state.mothership.draw(ctx);
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
    let policyModel = null;
    let policyMode = 'heuristic'; // 'heuristic' | 'policy'

    async function tryLoadPolicyModel() {
        // Try to load a saved policy model from the server. Prefer per-level, then all-levels, then default.
        const lv = Math.max(1, Math.floor(state.level || 1));
        const candidates = [
            `/NNet/policy_model/level-${lv}/model.json`,
            '/NNet/policy_model/all-levels/model.json',
            '/NNet/policy_model/model.json'
        ];
        let modelUrl = null;
        for (const url of candidates) {
            try {
                const r = await fetch(url, { cache: 'no-store' });
                if (r.ok) { modelUrl = url; break; }
            } catch { /* try next */ }
        }
        if (!modelUrl) return false;
        // Ensure tfjs is loaded
        if (typeof window.tf === 'undefined') {
            await new Promise((resolve, reject) => {
                const s = document.createElement('script');
                s.src = 'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.20.0/dist/tf.min.js';
                s.onload = resolve; s.onerror = reject; document.head.appendChild(s);
            }).catch(() => {});
        }
        if (typeof window.tf === 'undefined') return false;
        try {
            policyModel = await window.tf.loadLayersModel(modelUrl);
            return true;
        } catch {
            policyModel = null; return false;
        }
    }

    // Observation precision config: default ~2 decimal digits
    function getObsDigits() {
        const sp = new URLSearchParams(window.location.search);
        const d = Number(sp.get('obsDigits'));
        return Number.isFinite(d) ? Math.max(0, Math.floor(d)) : 2;
    }
    function qf(val) {
        const k = Math.pow(10, getObsDigits());
        return Math.round(val * k) / k;
    }

    function makeObservation() {
        const mcw = canvas.width, mch = canvas.height;
        const p = state.player;
        // nearest robot vector
        let ndx = 0, ndy = 0, nd = 1, rc = state.robots.length;
        if (rc > 0) {
            let best = Infinity, bx = 0, by = 0;
            for (const r of state.robots) {
                const dx = r.x - p.x, dy = r.y - p.y;
                const d2 = dx*dx + dy*dy;
                if (d2 < best) { best = d2; bx = dx; by = dy; }
            }
            const d = Math.sqrt(best) || 1;
            ndx = qf(bx / Math.max(1, mcw));
            ndy = qf(by / Math.max(1, mch));
            nd = qf(d / Math.max(1, Math.hypot(mcw, mch)));
        }
        const robotsCountNorm = qf(rc / 12);

        // Mothership features
        let msPresent = 0, msDx = 0, msDy = 0, msHealth = 0;
        if (state.mothership && state.mothership.health > 0) {
            msPresent = 1;
            msDx = qf((state.mothership.x - p.x) / Math.max(1, mcw));
            msDy = qf((state.mothership.y - p.y) / Math.max(1, mch));
            msHealth = qf(Math.max(0, Math.min(1, state.mothership.health / 10)));
        }

        // Ledge perception
        let belowDist = 0, aboveDist = 0, movingPresent = 0;
        if (ledgeOrder && ledgeOrder.length) {
            let bestBelow = Infinity, bestAbove = Infinity;
            for (const L of ledgeOrder) {
                if (L && typeof L.amp === 'number' && L.amp > 0) movingPresent = 1;
                const ypx = L.y * mch;
                if (ypx >= p.y) { const d = ypx - p.y; if (d < bestBelow) bestBelow = d; }
                else { const d = p.y - ypx; if (d < bestAbove) bestAbove = d; }
            }
            belowDist = qf(bestBelow < Infinity ? bestBelow / Math.max(1, mch) : 0);
            aboveDist = qf(bestAbove < Infinity ? bestAbove / Math.max(1, mch) : 0);
        }

        // Projectiles
        let nearestPDx = 0, nearestPDy = 0, nearestPSpeed = 0, isMissile = 0;
        let lasersCount = 0, missilesCount = 0;
        for (const rb of state.robots) lasersCount += (rb.lasers ? rb.lasers.length : 0);
        if (state.mothership && Array.isArray(state.mothership.missiles)) missilesCount = state.mothership.missiles.length;
        let bestP = Infinity, bestObj = null, bestType = 'laser';
        for (const rb of state.robots) {
            for (const L of (rb.lasers || [])) {
                const dx = L.x - p.x, dy = L.y - p.y; const d2 = dx*dx + dy*dy;
                if (d2 < bestP) { bestP = d2; bestObj = { dx, dy, speed: rb.speed }; bestType = 'laser'; }
            }
        }
        if (state.mothership) {
            for (const m of (state.mothership.missiles || [])) {
                const dx = m.x - p.x, dy = m.y - p.y; const d2 = dx*dx + dy*dy;
                if (d2 < bestP) { bestP = d2; bestObj = { dx, dy, speed: m.speed }; bestType = 'missile'; }
            }
        }
        if (bestObj) {
            nearestPDx = qf(bestObj.dx / Math.max(1, mcw));
            nearestPDy = qf(bestObj.dy / Math.max(1, mch));
            const scale = Math.max(1, mch / 324 * 10);
            nearestPSpeed = qf(bestObj.speed / scale);
            isMissile = (bestType === 'missile') ? 1 : 0;
        }
        const lasersCountNorm = qf(Math.min(1, lasersCount / 20));
        const missilesCountNorm = qf(Math.min(1, missilesCount / 10));

        const base = [
            qf(p.x / Math.max(1, mcw)),
            qf(p.y / Math.max(1, mch)),
            qf(p.vx / Math.max(1, mch/20)),
            qf(p.vy / Math.max(1, mch/20)),
            qf(Math.max(0, Math.min(1, p.health))),
            robotsCountNorm,
            state.yrCanShoot ? 1 : 0,
            ndx, ndy, nd,
            msPresent, msDx, msDy, msHealth,
            belowDist, aboveDist, movingPresent,
            nearestPDx, nearestPDy, nearestPSpeed, isMissile,
            lasersCountNorm, missilesCountNorm
        ];
        // Append level one-hot like trainer: [L1, L2, L3+]
        const lv = Math.max(1, Math.floor(state.level || 1));
        const oneHot = [0,0,0];
        oneHot[Math.min(2, lv-1)] = 1;
        return base.concat(oneHot);
    }

    function applyAIAction(action) {
        const f = state.frame;
        // Key diffs vs current keysDown
        const target = action.pressed;
        const current = state.keysDown;
        const allKeys = new Set([...target, ...current]);
        for (const k of allKeys) {
            const inTarget = target.has(k);
            const inCurrent = current.has(k);
            if (inTarget && !inCurrent) applyEvent({ type: 'keydown', payload: { key: k } });
            else if (!inTarget && inCurrent) applyEvent({ type: 'keyup', payload: { key: k } });
        }
        // Aim: move crosshair by delta relative to its current position (not the player)
        const mcw = canvas.width, mch = canvas.height;
        const px = Math.max(0, Math.min(mcw, state.crosshair.x + (action.aim.dx || 0)));
        const py = Math.max(0, Math.min(mch, state.crosshair.y + (action.aim.dy || 0)));
        applyEvent({ type: 'mousemove', payload: { x: px, y: py } });
    }

    function sampleFromPolicy(outArr) {
        // outArr: [7] from model; returns pressed keys and aim deltas
        const knobs = (typeof window !== 'undefined' && window.__policyKnobs) ? window.__policyKnobs : { explore: 0.6, stepPx: 40, minStepPx: 12, jerkProb: 0.35 };
        const keyLogits = outArr.slice(0,5);
        const aimMeans = outArr.slice(5,7).map(v => Math.tanh(v));
        const keys = ['a','d','w','s','f'];
        const pressed = new Set();
        for (let i = 0; i < 5; i++) {
            const prob = 1 / (1 + Math.exp(-keyLogits[i]));
            const p = Math.min(1, Math.max(0, prob * (1 - knobs.explore) + 0.5*knobs.explore));
            if (Math.random() < p) pressed.add(keys[i]);
        }
        // Aim sampling: high noise + larger steps + min magnitude + optional jerks
        const step = knobs.stepPx;
        const noiseAmp = knobs.explore * step;
        let dx = (aimMeans[0] * step) + ((Math.random()*2 - 1) * noiseAmp);
        let dy = (aimMeans[1] * step) + ((Math.random()*2 - 1) * noiseAmp);
        if (knobs.jerkProb > 0 && Math.random() < knobs.jerkProb) {
            const th = Math.random() * Math.PI * 2;
            const jm = knobs.minStepPx + Math.random() * Math.max(0, step - knobs.minStepPx);
            dx += Math.cos(th) * jm;
            dy += Math.sin(th) * jm;
        }
        const mag = Math.hypot(dx, dy);
        if (mag < knobs.minStepPx) {
            if (mag < 1e-6) {
                const th = Math.random() * Math.PI * 2;
                dx = Math.cos(th) * knobs.minStepPx;
                dy = Math.sin(th) * knobs.minStepPx;
            } else {
                const s = knobs.minStepPx / mag;
                dx *= s; dy *= s;
            }
        }
        return { pressed, aim: { dx, dy } };
    }

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
    const noEnemies = (state.robots.length === 0) && (!state.mothership || state.mothership.health <= 0);
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
                    mode: state.mode || 'diagnostic',
                    level: state.level || 1,
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
        const noEnemies = (state.robots.length === 0) && (!state.mothership || state.mothership.health <= 0);
        const playerDead = (state.player.health <= 0);
        if (noEnemies || playerDead || state.frame >= stopFrame) {
            postTelemetryAndStop();
            return;
        }

        requestAnimationFrame(loop);
    }

    // Minimal AI to move the crosshair and trigger shots when no recording is provided
    function stepAI() {
        if (policyMode === 'policy' && policyModel && window.tf) {
            const obs = makeObservation();
            // Align observation length to model's expected input size by padding/truncating
            let inSize = null;
            try { const shape = policyModel.inputs && policyModel.inputs[0] && policyModel.inputs[0].shape; inSize = (shape && shape[1]) || null; } catch {}
            let obsAligned = obs;
            if (Number.isFinite(inSize) && inSize > 0) {
                if (obs.length < inSize) {
                    const pad = new Array(inSize - obs.length).fill(0);
                    obsAligned = obs.concat(pad);
                } else if (obs.length > inSize) {
                    obsAligned = obs.slice(0, inSize);
                }
            }
            const out = window.tf.tidy(() => policyModel.predict(window.tf.tensor2d([obsAligned])));
            const arr = out.dataSync();
            out.dispose();
            const action = sampleFromPolicy(Array.from(arr), 0.05);
            applyAIAction(action);
        } else {
            // Heuristic fallback:
            // - If mothership is present, aim at its center.
            // - Else, aim at nearest robot.
            const mcw = canvas.width, mch = canvas.height;
            let tx = mcw / 2, ty = mch / 2;
            if (state.mothership && state.mothership.health > 0) {
                tx = state.mothership.x; ty = state.mothership.y;
            } else if (state.robots.length > 0) {
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
            const alpha = 0.35;
            const newX = state.crosshair.x + (tx - state.crosshair.x) * alpha;
            const newY = state.crosshair.y + (ty - state.crosshair.y) * alpha;
            applyEvent({ type: 'mousemove', payload: { x: newX, y: newY } });
        }
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
    // Initialize mode and level from URL and sync selector UI
    state.mode = getMode();
    state.level = getSelectedLevel();
        updateLevelSelectorUI(state.level);
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

        // Enforce mode rules before world build
        if (!enforceModeOrBlock(state.level, recording)) {
            // Stop early due to contradiction
            return;
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
                if ((state.level || 1) >= 2) {
                    ledges[highest.item].baseY = ledges[highest.item].y;
                    ledges[highest.item].amp = randomBetween(0.05, 0.25, 0.01);
                    ledges[highest.item].omega = randomBetween(0.002, 0.01, 0.001);
                }
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

        // Level 2: create mothership
        if ((state.level || 1) >= 2) {
            const mcw = canvas.width, mch = canvas.height, mcm = Math.min(mcw, mch);
            state.mothership = new Mothership(mcw, mch, mcm, state.velChange);
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

        // Enable AI when no recording is provided
        aiEnabled = !recording;

        // If AI is enabled, try loading a trained policy model in the background
        if (aiEnabled) {
            tryLoadPolicyModel().then((ok) => {
                if (ok) { policyMode = 'policy'; setBanner(`AI Demo (Policy L${state.level})`); }
            });
        }

        // If AI is enabled (no recording), perform the canonical initial shot toward crosshairStart
        if (aiEnabled && state.yrCanShoot) {
            applyEvent({ type: 'mousemove', payload: { x: state.crosshair.x, y: state.crosshair.y } });
        }

        loop();
    }

    boot();
})();
