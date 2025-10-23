#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

function pad(n) { return n.toString().padStart(2, '0'); }
function timestamp() {
  const d = new Date();
  const y = d.getFullYear();
  const m = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const h = pad(d.getHours());
  const min = pad(d.getMinutes());
  const s = pad(d.getSeconds());
  return `${y}-${m}-${day}_${h}-${min}-${s}`;
}

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }

async function main() {
  const root = process.cwd();
  const logsDir = path.join(root, 'logs');
  ensureDir(logsDir);
  const ts = timestamp();
  const logPathTs = path.join(logsDir, `test-integration-${ts}.log`);
  const logPathLatest = path.join(logsDir, 'test-integration-latest.log');

  const outTs = fs.createWriteStream(logPathTs, { flags: 'w' });
  const outLatest = fs.createWriteStream(logPathLatest, { flags: 'w' });

  const jestBin = path.join(root, 'node_modules', 'jest', 'bin', 'jest.js');
  const child = spawn(process.execPath, [jestBin, 'tests/integration', '--runInBand'], { stdio: ['inherit', 'pipe', 'pipe'] });

  function tee(stream) {
    stream.on('data', (chunk) => {
      process.stdout.write(chunk);
      outTs.write(chunk);
      outLatest.write(chunk);
    });
  }
  function teeErr(stream) {
    stream.on('data', (chunk) => {
      process.stderr.write(chunk);
      outTs.write(chunk);
      outLatest.write(chunk);
    });
  }

  tee(child.stdout);
  teeErr(child.stderr);

  child.on('close', (code) => {
    outTs.end();
    outLatest.end();
    process.exit(code);
  });
}

main().catch((err) => { console.error(err); process.exit(1); });
