const path = require('path');
const fs = require('fs');
const express = require('express');

const app = express();
const root = path.resolve(__dirname, '..');
const dataDir = path.join(root, 'data');
const configDir = path.join(root, 'config');
const aidemoDir = path.join(root, 'AIDemo');
const logsDir = path.join(root, 'logs');

const PORT = process.env.PORT || 3001;

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
appendLog('aidemo-server.log', `START aidemo-server port=${PORT}`);

// Strict static: only AI Demo pages and assets
app.use('/AIDemo', express.static(aidemoDir));

// Expose shared helper if referenced by AIDemo
app.get('/humanLib.js', (_req, res) => res.sendFile(path.join(root, 'humanLib.js')));

// World for AI Demo
app.get('/world.json', (_req, res) => {
  const p = path.join(configDir, 'world.json');
  if (fs.existsSync(p)) {
    res.type('application/json').send(fs.readFileSync(p, 'utf8'));
  } else {
    res.json({
      impl: "aidemo",
      clampPlayer: true,
      enemyBoundaryMode: "original",
      crosshairStart: { x: 200, y: 200 }
    });
  }
});

// List recordings and serve them
app.get('/recordings', (_req, res) => {
  const recDir = path.join(dataDir, 'recordings');
  const files = fs.existsSync(recDir)
    ? fs.readdirSync(recDir).filter(f => f.endsWith('.json'))
    : [];
  res.json({ files });
});
app.use('/data/recordings', express.static(path.join(dataDir, 'recordings')));

// AI Demo telemetry (append-only JSON array)
app.post('/aidemo-telemetry', (req, res) => {
  try {
    const p = path.join(dataDir, 'aidemo-telemetry.json');
    let arr = [];
    if (fs.existsSync(p)) {
      try { arr = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { arr = []; }
    }
    arr.push({ ...(req.body || {}), timestamp: new Date().toISOString() });
    fs.writeFileSync(p, JSON.stringify(arr, null, 2));
    appendLog('aidemo-server.log', `TELEMETRY ${JSON.stringify(req.body)}`);
    res.json({ ok: true });
  } catch (e) {
    appendLog('aidemo-server.log', `TELEMETRY_ERROR ${e && e.message}`);
    res.status(500).json({ ok: false });
  }
});
app.get('/data/aidemo-telemetry.json', (_req, res) => {
  const p = path.join(dataDir, 'aidemo-telemetry.json');
  if (fs.existsSync(p)) res.type('application/json').send(fs.readFileSync(p, 'utf8'));
  else res.type('application/json').send('[]');
});

// Client-side logs (from AIDemo safe logger)
app.post('/client-log', (req, res) => {
  appendLog('aidemo-client.log', `CLIENT ${JSON.stringify(req.body || {})}`);
  res.json({ ok: true });
});

// Fallback 404 for isolation
app.use((_req, res) => res.status(404).send('Not Found'));

app.listen(PORT, () => {
  appendLog('aidemo-server.log', `LISTEN http://localhost:${PORT}/AIDemo/index.html`);
  console.log(`AI Demo server running: http://localhost:${PORT}/AIDemo/index.html`);
});
