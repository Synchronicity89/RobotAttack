(function () {
  const canvas = document.getElementById('aidemo');
  const ctx = canvas.getContext('2d');

  const bc = [102/255, 77/255, 51/255]; // background color
  let world = {
    width: null,
    height: null,
    clampPlayer: true,
    crosshairStart: { x: 200, y: 200 }
  };

  // Fetch world.json (optional) and the recording (?rec=...)
  async function loadConfig() {
    try {
      const r = await fetch('/world.json', { cache: 'no-store' });
      if (r.ok) world = { ...world, ...(await r.json()) };
    } catch {}
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
    lasers: [] // { x,y, angle, id }
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

    // Gravity-ish and floor clamp
    state.player.vy += state.velChange / 8;
    if (world.clampPlayer !== false) {
      const half = state.yrm / 2;
      state.player.x = Math.max(half, Math.min(mcw - half, state.player.x));
      state.player.y = Math.max(half, Math.min(mch - half, state.player.y));
    }

    // Advance lasers and cull
    for (let i = state.lasers.length - 1; i >= 0; i--) {
      const L = state.lasers[i];
      L.x += Math.cos(L.angle) * 10;
      L.y += Math.sin(L.angle) * 10;
      if (L.x < 0 || L.x > mcw || L.y < 0 || L.y > mch) state.lasers.splice(i, 1);
    }

    // Cooldown
    state.timer++;
    if (state.timer % 10 === 0) state.yrCanShoot = true;
    state.frame++;
  }

  function drawFrame() {
    const mcw = canvas.width, mch = canvas.height;
    // Background
    ctx.fillStyle = `rgba(${Math.floor(bc[0]*255)}, ${Math.floor(bc[1]*255)}, ${Math.floor(bc[2]*255)}, 1)`;
    ctx.fillRect(0, 0, mcw, mch);

    // Lasers
    ctx.lineWidth = 5;
    for (const L of state.lasers) {
      ctx.strokeStyle = '#00f';
      ctx.beginPath();
      ctx.moveTo(L.x - Math.cos(L.angle)*10, L.y - Math.sin(L.angle)*10);
      ctx.lineTo(L.x + Math.cos(L.angle)*10, L.y + Math.sin(L.angle)*10);
      ctx.stroke();
    }

    // Player
    ctx.fillStyle = 'rgba(128,128,128,1)';
    ctx.fillRect(state.player.x - state.yrm/2, state.player.y - state.yrm/2, state.yrm, state.yrm);
    ctx.strokeStyle = 'rgba(0,0,255,1)';
    ctx.strokeRect(state.player.x - state.yrm/4, state.player.y - state.yrm/4, state.yrm/2, state.yrm/2);
  }

  let recording = null;
  function stepReplay() {
    if (!recording) return;
    // Apply any events scheduled for this frame
    const frame = state.frame;
    for (const ev of recording.inputs || []) {
      if (ev.frame === frame) applyEvent(ev);
    }
  }

  function loop(ts) {
    // process replay events, then physics and draw
    stepReplay();
    stepPhysics();
    drawFrame();
    requestAnimationFrame(loop);
  }

  async function boot() {
    await loadConfig();
    initFromWorld();
    recording = await loadRecording();
    // If recording defines crosshairStart or seed/world dims, we already used world for dims and start not required here
    requestAnimationFrame(loop);
  }

  boot();
})();
