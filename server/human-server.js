const path = require('path');
const fs = require('fs');
const express = require('express');

const app = express();
const root = path.resolve(__dirname, '..');
const dataDir = path.join(root, 'data');
const configDir = path.join(root, 'config');

if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });

app.use(express.json());
app.use(express.static(root));

app.get('/', (_req, res) => {
  res.sendFile(path.join(root, 'control-panel.html'));
});

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

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Human server running: http://localhost:${port}/`);
  console.log(`Control Panel:       http://localhost:${port}/control-panel.html`);
  console.log(`Note: Integration tests run without the server using jsdom.`);
});
