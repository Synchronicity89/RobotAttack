const path = require('path');
const fs = require('fs');
const express = require('express');

const app = express();
const root = path.resolve(__dirname, '..');
const dataDir = path.join(root, 'data');
const configDir = path.join(root, 'config');

const HUMAN_PORT = process.env.PORT || 3000;
const AIDEMO_PORT = process.env.AIDEMO_PORT || 3001;

if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });

app.use(express.json());

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
  res.json({ ok: true });
});

// Allow reading telemetry JSON from Control Panel
app.get('/data/human-telemetry.json', (_req, res) => {
  const p = path.join(dataDir, 'human-telemetry.json');
  if (fs.existsSync(p)) res.type('application/json').send(fs.readFileSync(p, 'utf8'));
  else res.type('application/json').send('[]');
});

// Fallback 404 for anything else (ensures isolation)
app.use((_req, res) => res.status(404).send('Not Found'));

app.listen(HUMAN_PORT, () => {
  console.log(`Human server running: http://localhost:${HUMAN_PORT}/`);
  console.log(`Control Panel:       http://localhost:${HUMAN_PORT}/control-panel.html`);
  console.log(`AI Demo expected at: http://localhost:${AIDEMO_PORT}/AIDemo/index.html`);
});
