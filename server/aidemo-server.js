const path = require('path');
const fs = require('fs');
const express = require('express');

const app = express();
const root = path.resolve(__dirname, '..');
const dataDir = path.join(root, 'data');
const configDir = path.join(root, 'config');
const aidemoDir = path.join(root, 'AIDemo');

const PORT = process.env.PORT || 3001;

if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });

app.use(express.json());

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

// Fallback 404 for isolation
app.use((_req, res) => res.status(404).send('Not Found'));

app.listen(PORT, () => {
  console.log(`AI Demo server running: http://localhost:${PORT}/AIDemo/index.html`);
});
