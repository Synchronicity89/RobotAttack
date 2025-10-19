const path = require('path');
const fs = require('fs');
const express = require('express');

const app = express();
const root = path.resolve(__dirname, '..');
const dataDir = path.join(root, 'data');
const configDir = path.join(root, 'config');
const logsDir = path.join(root, 'logs');

const HUMAN_PORT = process.env.PORT || 3000;
const AIDEMO_PORT = process.env.AIDEMO_PORT || 3001;

if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

app.use(express.json());

// Simple append logger with naive rotation at ~1MB
function appendLog(file, line) {
  try {
    const fp = path.join(logsDir, file);
    try {
      const st = fs.existsSync(fp) ? fs.statSync(fp) : null;
      if (st && st.size > 1_000_000) {
        const rotated = fp.replace(/\.log$/, `.1.log`);
        try { fs.renameSync(fp, rotated); } catch {}
      }
    } catch {}
    fs.appendFileSync(fp, `${new Date().toISOString()} ${line}\n`);
  } catch {}
}
appendLog('human-server.log', `START human-server port=${HUMAN_PORT} aidemoPort=${AIDEMO_PORT}`);

// Server config for Control Panel to build AI Demo URL
app.get('/server-config.json', (_req, res) => {
  res.json({
    humanPort: Number(HUMAN_PORT),
    aiDemoPort: Number(AIDEMO_PORT),
    aiDemoUrl: `http://localhost:${AIDEMO_PORT}/AIDemo/index.html`
  });
});

// Strict static: serve only Human implementation pages/assets
function send(p, res) { res.sendFile(path.join(root, p)); }
app.get('/', (_req, res) => send('control-panel.html', res));
app.get('/control-panel.html', (_req, res) => send('control-panel.html', res));
app.get('/index.html', (_req, res) => send('index.html', res));
app.get('/code.js', (_req, res) => send('code.js', res));
app.get('/humanLib.js', (_req, res) => send('humanLib.js', res));

// Human world and telemetry
app.get('/world.json', (_req, res) => {
  const p = path.join(configDir, 'world.json');
  if (fs.existsSync(p)) {
    res.type('application/json').send(fs.readFileSync(p, 'utf8'));
  } else {
    res.json({
      impl: "human",
      clampPlayer: true,
      enemyBoundaryMode: "original",
      crosshairStart: { x: 200, y: 200 }
    });
  }
});

app.post('/telemetry', (req, res) => {
  const p = path.join(dataDir, 'human-telemetry.json');
  let arr = [];
  if (fs.existsSync(p)) {
    try { arr = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { arr = []; }
  }
  arr.push({ ...req.body, timestamp: new Date().toISOString() });
  fs.writeFileSync(p, JSON.stringify(arr, null, 2));
  appendLog('human-server.log', `TELEMETRY ${JSON.stringify(req.body)}`);
  res.json({ ok: true });
});

// Allow reading telemetry JSON from Control Panel
app.get('/data/human-telemetry.json', (_req, res) => {
  const p = path.join(dataDir, 'human-telemetry.json');
  if (fs.existsSync(p)) res.type('application/json').send(fs.readFileSync(p, 'utf8'));
  else res.type('application/json').send('[]');
});

// Save Human recording (posted by the Human game at end-of-game)
app.post('/recordings/save', (req, res) => {
  try {
    const recDir = path.join(dataDir, 'recordings');
    if (!fs.existsSync(recDir)) fs.mkdirSync(recDir, { recursive: true });

    const body = req.body || {};
    const runId = String(body.runId || Date.now());
    const fname = `${runId}.json`;
    const outPath = path.join(recDir, fname);

    fs.writeFileSync(outPath, JSON.stringify(body, null, 2));
    appendLog('human-server.log', `RECORDING_SAVED ${outPath}`);
    console.log(`[human-server] Saved recording to ${outPath}`);
    res.json({ ok: true, runId, path: `/data/recordings/${fname}` });
  } catch (e) {
    appendLog('human-server.log', `RECORDING_SAVE_ERROR ${e && e.message}`);
    console.error('[human-server] recordings/save failed', e);
    res.status(500).json({ ok: false, error: 'failed_to_save_recording' });
  }
});

// Optional: list recordings from Human server (convenience)
app.get('/recordings', (_req, res) => {
  const recDir = path.join(dataDir, 'recordings');
  const files = fs.existsSync(recDir)
    ? fs.readdirSync(recDir).filter(f => f.endsWith('.json'))
    : [];
  res.json({ files });
});

// NEW: latest recording helper (returns AI Demo-usable path)
app.get('/recordings/latest', (_req, res) => {
  try {
    const recDir = path.join(dataDir, 'recordings');
    if (!fs.existsSync(recDir)) return res.json({ path: null });
    const files = fs.readdirSync(recDir).filter(f => f.endsWith('.json'));
    if (files.length === 0) return res.json({ path: null });
    // Pick newest by mtime
    let newest = null;
    let newestTime = -1;
    for (const f of files) {
      const fp = path.join(recDir, f);
      const st = fs.statSync(fp);
      if (st.mtimeMs > newestTime) { newestTime = st.mtimeMs; newest = f; }
    }
    if (!newest) return res.json({ path: null });
    // AI Demo serves from /data/recordings
    res.json({ path: `/data/recordings/${newest}`, file: newest, mtimeMs: newestTime });
  } catch (e) {
    res.json({ path: null });
  }
});

// Client-side logs (from code.js safe logger)
app.post('/client-log', (req, res) => {
  appendLog('human-client.log', `CLIENT ${JSON.stringify(req.body || {})}`);
  res.json({ ok: true });
});

// Fallback 404 for anything else (ensures isolation)
app.use((_req, res) => res.status(404).send('Not Found'));

app.listen(HUMAN_PORT, () => {
  appendLog('human-server.log', `LISTEN http://localhost:${HUMAN_PORT}/`);
  console.log(`Human server running: http://localhost:${HUMAN_PORT}/`);
  console.log(`Control Panel:       http://localhost:${HUMAN_PORT}/control-panel.html`);
  console.log(`AI Demo expected at: http://localhost:${AIDEMO_PORT}/AIDemo/index.html`);
});
