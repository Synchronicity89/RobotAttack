'use strict';

// Local, standalone seeded PRNG matching HumanLib.mulberry32 (no runtime sharing)
function mulberry32(a) {
  a = a >>> 0;
  return function() {
    let t = a += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Tiny FNV-1a 32-bit hash for digests
function fnv1a32(str) {
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return ('00000000' + h.toString(16)).slice(-8);
}

class SimGame {
  constructor() {
    this.rand = Math.random;
    this.world = { width: 0, height: 0, dpr: 1, clampPlayer: true };
    this.level = 1; // level conditioning for RL; Human adds features by level
    this.frame = 0;
    this.timer = 0;
    this.yrm = 0;
    this.velChange = 0;
    this.keysDown = new Set();
    this.inputByFrame = new Map();
    this.falling = true;

    this.player = {
      x: 0, y: 0, vx: 0, vy: 0, atBottom: false, health: 1, idCounter: 0
    };

    // Robots and lasers intentionally omitted in this first increment; add later
    this.robots = [];
    this.lasers = [];
    // Robots not simulated yet; avoid false "win" due to empty array
    this._hasRobots = false;

  // Ledges (seeded, like Human/AI Demo)
    this.ledgeCount = 18;
    this.ledges = [];
    this.ledgeOrder = [];

    // Player laser state (cooldown + store)
    this.playerLasers = [];
    this.playerLaserId = 0;
    this.yrCanShoot = true;

    // Fallback support: if a recording lacks the frame-0 mousemove that the
    // Human code records, emit one initial shot toward crosshairStart.
    this._initialShotChecked = false;

    // Level 2: Mothership boss with missiles
    this.mothership = null;
  }

  // Seeded helper like Human/AI Demo
  randBetween(min, max, precision) {
    const v = this.rand() * (max - min) + min;
    return Math.floor(v / precision) * precision;
  }

  // Simple Robot with seeded shooting schedule and enemy lasers
  makeRobot(id, mcw, mch, mcm) {
    return {
      id,
      health: 1,
      x: this.rand() * mcw,
      y: mch,
      speed: this.velChange * 3,
      tarD: this.randBetween(mcm / 8, mcm / 2, 1),
      lasers: [], // {id,x,y,angle}
      idCounter: 0,
      shootTimes: (() => {
        const arr = [];
        for (let i = 0; i < this.randBetween(1, 3, 1); i++) {
          const d = this.randBetween(120, 360, 1);
          const v = this.randBetween(0, d, 1);
          arr.push({ d, v });
        }
        return arr;
      })(),
      // Mirror Human constructor RNG tap for laserSpeed (even if unused)
      laserSpeed: this.randBetween(2, 11, 1)
    };
  }

  generateLedges(mcw, mch) {
    this.ledges = [];
    for (let i = 0; i < this.ledgeCount; i++) {
      const base = {
        id: 0,
        y: this.randBetween(0.1, 0.9, 0.01),
        x: this.randBetween(0.1, 0.9, 0.01),
        w: this.randBetween(1/16, 1/4, 0.01)
      };
      // Level 2+: moving ledges (sinusoidal in Y)
      if (this.level >= 2) {
        base.baseY = base.y;
        base.amp = this.randBetween(0.05, 0.25, 0.01);
        base.omega = this.randBetween(0.002, 0.01, 0.001);
        base.phase = this.rand() * Math.PI * 2;
      }
      this.ledges.push(base);
    }
    this.ledgeOrder = [];
    const pool = this.ledges.slice();
    while (pool.length > 0) {
      let highest = { item: 0, y: 1 };
      for (let i = 0; i < pool.length; i++) {
        if (pool[i].y < highest.y) { highest.item = i; highest.y = pool[i].y; }
      }
      pool[highest.item].id = this.ledgeOrder.length;
      this.ledgeOrder.push(pool[highest.item]);
      pool.splice(highest.item, 1);
    }
  }

  init({ world, seed, level }) {
    const w = world || {};
    this.world.width = Number(w.width) || (globalThis.innerWidth || 1024);
    this.world.height = Number(w.height) || (globalThis.innerHeight || 768);
    this.world.dpr = Number(w.dpr) || 1;
    this.world.clampPlayer = (w.clampPlayer === undefined) ? true : !!w.clampPlayer;
  // Level/mode: prefer explicit args, then world, fallback defaults
    const lv = (level != null) ? Number(level) : (w.level != null ? Number(w.level) : 1);
    this.level = Number.isFinite(lv) && lv >= 1 ? Math.floor(lv) : 1;
  const modeStr = (w.mode || 'diagnostic');
  this.mode = (String(modeStr).toLowerCase() === 'realistic') ? 'realistic' : 'diagnostic';

    const mcw = this.world.width, mch = this.world.height;
    const mcm = Math.min(mcw, mch);
    this.yrm = mcm / 20;
    this.velChange = mch / 324;

    // Seed RNG locally
    const sd = Number(seed);
    if (Number.isFinite(sd)) this.rand = mulberry32(sd);

    // Generate ledges deterministically and start on the middle ledge (like Human)
    this.generateLedges(mcw, mch);
    const mid = Math.ceil(this.ledgeCount / 2);
    const startLedge = this.ledgeOrder[Math.min(Math.max(mid, 0), this.ledgeOrder.length - 1)];
    if (startLedge) {
      this.player.x = startLedge.x * mcw;
      this.player.y = startLedge.y * mch - this.yrm / 2;
    } else {
      // Fallback mid-screen if ledges missing
      this.player.x = mcw / 2;
      this.player.y = mch / 2;
    }

    this.frame = 0;
    this.timer = 0;
    this.keysDown.clear();
    this.inputByFrame.clear();
    this.falling = true;

    // Seed-deterministic robots (12)
    this.robots = [];
    for (let i = 0; i < 12; i++) {
      this.robots.push(this.makeRobot(i, mcw, mch, mcm));
    }
    this._hasRobots = this.robots.length > 0;

    // Level 2: create mothership
    if (this.level >= 2) {
      const w = Math.max(mcm/10, (mcm/20)*6);
      const h = Math.max(mcm/14, (mcm/20)*4);
      this.mothership = {
        health: 10,
        w, h,
        x: mcw/2,
        y: mch*0.2,
        velX: Math.max(this.velChange * 0.5, 0.5),
        missiles: [], // {id,x,y,angle,speed,r}
        idCounter: 0,
        firePeriod: 180
      };
    } else {
      this.mothership = null;
    }

    // Reset initial-shot check on new init
    this._initialShotChecked = false;
  }

  // Queue inputs from recording: [{ frame, type, payload }]
  queueInputs(inputs) {
    (inputs || []).forEach(ev => {
      const f = Number(ev.frame) || 0;
      if (!this.inputByFrame.has(f)) this.inputByFrame.set(f, []);
      this.inputByFrame.get(f).push({ type: ev.type, payload: ev.payload || {} });
    });
  }

  applyInputsForFrame(f) {
    const list = this.inputByFrame.get(f);
    if (!list) return;
    for (const ev of list) {
      if (ev.type === 'keydown') {
        const k = (ev.payload.key || '').toLowerCase();
        if (k) this.keysDown.add(k);
      } else if (ev.type === 'keyup') {
        const k = (ev.payload.key || '').toLowerCase();
        if (k) this.keysDown.delete(k);
      } else if (ev.type === 'mousemove') {
        // Fire a player laser when off cooldown (matches Human/AIDemo trigger)
        if (this.yrCanShoot) {
          const x = Number(ev.payload.x);
          const y = Number(ev.payload.y);
          if (Number.isFinite(x) && Number.isFinite(y)) {
            const angle = Math.atan2(y - this.player.y, x - this.player.x);
            this.playerLasers.push({
              id: this.playerLaserId++,
              x: this.player.x,
              y: this.player.y,
              angle
            });
            this.yrCanShoot = false;
          }
        }
      }
    }
  }

  physicsStep() {
    const mcw = this.world.width, mch = this.world.height;
    const held = (k) => this.keysDown.has(k);

    // Horizontal input policy: A/D conflict cancels, F brakes
    if (held('a') && held('d')) {
      this.player.vx = 0;
    } else if (held('a')) {
      this.player.vx = -3 * this.velChange;
    } else if (held('d')) {
      this.player.vx = 3 * this.velChange;
    }
    if (held('f')) this.player.vx = 0;

    // Vertical gating: W/S only when not falling (simple ground check here)
    if (!this.falling && held('w')) this.player.vy = -6 * this.velChange;
    if (!this.falling && !this.player.atBottom && held('s')) this.player.vy = 3 * this.velChange;

    // Integrate
    this.player.x += this.player.vx;
    this.player.y += this.player.vy;

    // Level 2+: update ledge vertical motion before collision
    if (this.level >= 2) {
      for (const L of this.ledgeOrder) {
        if (L.amp && L.omega) {
          const yRaw = L.baseY + L.amp * Math.sin((this.timer + (L.phase || 0)) * L.omega);
          L.y = yRaw;
        }
      }
    }

    // Sticky ledges (match Human/AI Demo conditions)
    let fallingNow = true;
    for (const ledge of this.ledgeOrder) {
      if (this.player.y + this.yrm/2 > ledge.y*mch - this.player.vy - 1) {
        if (this.player.y + this.yrm/2 < ledge.y*mch + this.player.vy + 1) {
          if (this.player.x > (ledge.x - ledge.w/2) * mcw - this.yrm/2) {
            if (this.player.x < (ledge.x + ledge.w/2) * mcw + this.yrm/2) {
              fallingNow = false;
              this.player.atBottom = false;
              this.player.y = ledge.y * mch - this.yrm/2;
              this.player.vy = 0;
            }
          }
        }
      }
    }

    // Floor snap
    if (this.player.y + this.yrm / 2 > mch - this.player.vy - 1) {
      if (this.player.y + this.yrm / 2 < mch + this.player.vy + 1) {
        fallingNow = false;
        this.player.atBottom = true;
        this.player.y = mch - this.yrm / 2;
        this.player.vy = 0;
      }
    } else if (fallingNow) {
      this.player.atBottom = false;
    }

    // Gravity/friction
    if (fallingNow) {
      // Match Human gravity (velChange/4)
      this.player.vy += this.velChange / 4;
    } else {
      if (!held('f')) this.player.vx *= 0.95;
      else this.player.vx = 0;
    }

    this.falling = fallingNow;

    // Clamp inside arena
    if (this.world.clampPlayer !== false) {
      const half = this.yrm / 2;
      this.player.x = Math.max(half, Math.min(mcw - half, this.player.x));
      this.player.y = Math.max(half, Math.min(mch - half, this.player.y));
    }

    // Environment and regen
    if (this.player.y > mch - this.yrm * 1.5) this.player.health -= 1 / 180;
    if (this.player.health < 1 - 1 / 3600) this.player.health += 1 / 3600;

    // Player lasers: advance, cull, and damage nearest-to-origin robot (canonical policy)
    if (this.robots.length > 0) {
      // Find nearest-to-origin robot index
      let nearestIdx = -1, nearestVal = Infinity;
      for (let i = 0; i < this.robots.length; i++) {
        const r = this.robots[i];
        const d2 = r.x * r.x + r.y * r.y;
        if (d2 < nearestVal) { nearestVal = d2; nearestIdx = i; }
      }
      const hitRobot = (nearestIdx >= 0) ? this.robots[nearestIdx] : null;

      for (let i = this.playerLasers.length - 1; i >= 0; i--) {
        const L = this.playerLasers[i];
        // Advance
        L.x += Math.cos(L.angle) * 10;
        L.y += Math.sin(L.angle) * 10;
        // Cull offscreen
        if (L.x < 0 || L.x > mcw || L.y < 0 || L.y > mch) {
          this.playerLasers.splice(i, 1);
          continue;
        }
        // Hit test vs nearest-to-origin robot AABB (~ yrm)
        if (hitRobot) {
          if (L.x > hitRobot.x - this.yrm && L.x < hitRobot.x + this.yrm &&
              L.y > hitRobot.y - this.yrm && L.y < hitRobot.y + this.yrm) {
            this.playerLasers.splice(i, 1);
            hitRobot.health -= 0.2;
            continue;
          }
        }
        // Level 2+: also hit test vs mothership AABB
        if (this.mothership && this.mothership.health > 0) {
          const ms = this.mothership;
          if (L.x > ms.x - ms.w/2 && L.x < ms.x + ms.w/2 &&
              L.y > ms.y - ms.h/2 && L.y < ms.y + ms.h/2) {
            this.playerLasers.splice(i, 1);
            ms.health -= 0.2;
            continue;
          }
        }
      }
    } else {
      // No robots: still advance and cull lasers offscreen
      for (let i = this.playerLasers.length - 1; i >= 0; i--) {
        const L = this.playerLasers[i];
        L.x += Math.cos(L.angle) * 10;
        L.y += Math.sin(L.angle) * 10;
        // Level 2+: also test vs mothership
        let removed = false;
        if (this.mothership && this.mothership.health > 0) {
          const ms = this.mothership;
          if (L.x > ms.x - ms.w/2 && L.x < ms.x + ms.w/2 &&
              L.y > ms.y - ms.h/2 && L.y < ms.y + ms.h/2) {
            this.playerLasers.splice(i, 1);
            ms.health -= 0.2;
            removed = true;
          }
        }
        if (!removed && (L.x < 0 || L.x > mcw || L.y < 0 || L.y > mch)) {
          this.playerLasers.splice(i, 1);
        }
      }
    }

    // Update robots: orbit motion (with optional boundary mode), scheduled shooting, lasers advance and player hit
    for (let i = this.robots.length - 1; i >= 0; i--) {
      const rb = this.robots[i];
      // Orbit update (compute proposed new position relative to player)
      const angle = Math.atan2(rb.y - this.player.y, rb.x - this.player.x);
      const dx = rb.x - this.player.x, dy = rb.y - this.player.y;
      const distance = Math.hypot(dx, dy) || 1e-6;
      let newA = angle + rb.speed / distance;
      const newD = distance + (rb.tarD - distance) / (100 / this.velChange);
      let nx = this.player.x + Math.cos(newA) * newD;
      let ny = this.player.y + Math.sin(newA) * newD;

      // Apply enemy boundary behavior to mirror Human code.js
      const mode = (this.world && typeof this.world.enemyBoundaryMode === 'string')
        ? this.world.enemyBoundaryMode : 'original';
      const half = this.yrm / 2;
      if (mode === 'splat') {
        // clamp inside arena
        nx = Math.max(half, Math.min(mcw - half, nx));
        ny = Math.max(half, Math.min(mch - half, ny));
      } else if (mode === 'bounce') {
        // reflect direction against walls and recompute forward
        let a = newA;
        // check X bounds first
        if (nx < half || nx > mcw - half) {
          a = Math.PI - a; // horizontal reflection
        }
        // apply reflection on X
        nx = this.player.x + Math.cos(a) * newD;
        // then check Y bounds
        if (ny < half || ny > mch - half) {
          a = -a; // vertical reflection
        }
        newA = a;
        nx = this.player.x + Math.cos(newA) * newD;
        ny = this.player.y + Math.sin(newA) * newD;
        // keep inside after reflection
        nx = Math.max(half, Math.min(mcw - half, nx));
        ny = Math.max(half, Math.min(mch - half, ny));
      }
      rb.x = nx;
      rb.y = ny;

      // Fire on schedule
      for (const st of rb.shootTimes) {
        if (this.timer % st.d === st.v) {
          const ang = Math.atan2(this.player.y - rb.y, this.player.x - rb.x);
          rb.lasers.push({ id: rb.idCounter++, x: rb.x, y: rb.y, angle: ang });
        }
      }

      // Enemy lasers: advance, hit test, cull
      for (let j = rb.lasers.length - 1; j >= 0; j--) {
        const EL = rb.lasers[j];
        EL.x += Math.cos(EL.angle) * rb.speed;
        EL.y += Math.sin(EL.angle) * rb.speed;
        // AABB hit vs player (yrm/2 half-extent)
        if (EL.x > this.player.x - this.yrm / 2 && EL.x < this.player.x + this.yrm / 2 &&
            EL.y > this.player.y - this.yrm / 2 && EL.y < this.player.y + this.yrm / 2) {
          rb.lasers.splice(j, 1);
          this.player.health -= 0.05;
          rb.health = Math.min(1, rb.health + 0.2);
          continue;
        }
        if (EL.x < 0 || EL.x > mcw || EL.y < 0 || EL.y > mch) rb.lasers.splice(j, 1);
      }

      // Health decay and removal (parity with Human/AIDemo)
      rb.health -= 1 / 1200;
      if (rb.health < 0) this.robots.splice(i, 1);
    }

    // Level 2: update mothership and missiles vs player
    if (this.mothership && this.mothership.health > 0) {
      const ms = this.mothership;
      // Horizontal drift with edge bounce
      ms.x += ms.velX;
      if (ms.x < ms.w/2 || ms.x > mcw - ms.w/2) ms.velX *= -1;
      // Fire on schedule
      if (this.timer % ms.firePeriod === 0) {
        const ang = Math.atan2(this.player.y - ms.y, this.player.x - ms.x);
        ms.missiles.push({ id: ms.idCounter++, x: ms.x, y: ms.y, angle: ang, speed: Math.max(this.velChange*2, 2), r: Math.max(this.yrm/6, 4) });
      }
      // Advance missiles and check collisions
      for (let i = ms.missiles.length - 1; i >= 0; i--) {
        const m = ms.missiles[i];
        m.x += Math.cos(m.angle) * m.speed;
        m.y += Math.sin(m.angle) * m.speed;
        if (m.x > this.player.x - this.yrm/2 && m.x < this.player.x + this.yrm/2 &&
            m.y > this.player.y - this.yrm/2 && m.y < this.player.y + this.yrm/2) {
          ms.missiles.splice(i, 1);
          this.player.health -= 0.05; // reduced to 25% damage
          continue;
        }
        if (m.x < 0 || m.x > mcw || m.y < 0 || m.y > mch) ms.missiles.splice(i, 1);
      }
    }

    // Timers and cooldown
    this.timer++;
    if (this.timer % 10 === 0) this.yrCanShoot = true;
  }

  // Advance N frames; returns { done, outcome, frame }
  step(frames = 1) {
    let done = false;
    let outcome = null;
    for (let i = 0; i < frames; i++) {
      // Fallback initial shot at frame 0 if no recorded mousemove
      if (!this._initialShotChecked && this.frame === 0) {
        this._initialShotChecked = true;
        const list = this.inputByFrame.get(0) || [];
        const hasFrame0Move = list.some(ev => ev && ev.type === 'mousemove');
        if (!hasFrame0Move && this.yrCanShoot) {
          const cs = (this.world && this.world.crosshairStart) ? this.world.crosshairStart : { x: 200, y: 200 };
          const angle = Math.atan2(cs.y - this.player.y, cs.x - this.player.x);
          this.playerLasers.push({ id: this.playerLaserId++, x: this.player.x, y: this.player.y, angle });
          this.yrCanShoot = false;
        }
      }
      // Apply frame-indexed inputs first
      this.applyInputsForFrame(this.frame);
      // Physics
      this.physicsStep();
      this.frame++;

      // Terminal checks:
      // - Win only makes sense if enemies are actually simulated
      const enemiesPresent = this._hasRobots || (this.mothership != null);
      const msDeadOrAbsent = (!this.mothership || this.mothership.health <= 0);
      const robotsCleared = (this.robots.length === 0);
      const noEnemies = enemiesPresent && robotsCleared && msDeadOrAbsent;
      const playerDead = this.player.health <= 0;
      if (noEnemies || playerDead) {
        const gameDrawn = noEnemies && playerDead;
        outcome = noEnemies ? 'win' : 'loss';
        if (gameDrawn) outcome = 'win';
        done = true;
        break;
      }
    }
    return { done, outcome, frame: this.frame };
  }

  // Stable summary for parity/validation: count, digest, nearestToOriginId
  getRobotsSummary() {
    const robots = this.robots || [];
    const count = robots.length;

    // nearest-to-origin by x^2 + y^2 (matches Human/AI Demo targeting policy)
    let nearestToOriginId = null;
    let best = Infinity;
    for (const r of robots) {
      const d2 = r.x * r.x + r.y * r.y;
      if (d2 < best) { best = d2; nearestToOriginId = r.id; }
    }

    // Build sorted tuples (id asc) with rounded components
    const tuples = robots
      .slice()
      .sort((a, b) => a.id - b.id)
      .map(r => [r.id, Math.round(r.x), Math.round(r.y), Math.round(r.health * 1000)]);
    const body = tuples.map(t => t.join(':')).join('|');
    const digest = 'fnv:' + fnv1a32(body);

    return { count, digest, nearestToOriginId };
  }

  // Lightweight digest to compare snapshots across implementations
  digest() {
    const p = this.player;
    const snap = [
      'p',
      Math.round(p.x), Math.round(p.y),
      Math.round(p.vx * 1000), Math.round(p.vy * 1000),
      Math.round(p.health * 1000),
      'r', this.robots.length,
      'f', this.frame
    ].join(',');
    return 'fnv:' + fnv1a32(snap);
  }

  getState() {
    return {
      frame: this.frame,
      timer: this.timer,
      level: this.level,
      mode: this.mode || 'diagnostic',
      player: { ...this.player },
      robotsCount: this.robots.length,
      digest: this.digest()
    };
  }
}

module.exports = { SimGame };
