const path = require('path');
const fs = require('fs');
const express = require('express');

const app = express();
const root = path.resolve(__dirname, '..');
const dataDir = path.join(root, 'data');
const configDir = path.join(root, 'config');
const aidemoDir = path.join(root, 'AIDemo');

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
      impl: "aidemo",
      clampPlayer: true,
      enemyBoundaryMode: "original",
      crosshairStart: { x: 200, y: 200 }
    });
  }
});

// List available recordings for convenience
app.get('/recordings', (_req, res) => {
  const recDir = path.join(dataDir, 'recordings');
  const files = fs.existsSync(recDir)
    ? fs.readdirSync(recDir).filter(f => f.endsWith('.json'))
    : [];
  res.json({ files });
});

const port = process.env.PORT || 3001;
app.listen(port, () => {
  console.log(`AI Demo server running: http://localhost:${port}/`);
  console.log(`Launch AI Demo:         http://localhost:${port}/AIDemo/index.html`);
});
