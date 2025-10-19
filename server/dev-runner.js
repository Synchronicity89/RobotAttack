const { spawn } = require('child_process');
const path = require('path');

const HUMAN_PORT = process.env.HUMAN_PORT || '3000';
const AIDEMO_PORT = process.env.AIDEMO_PORT || '3001';

let procs = [];

function startServers() {
  const envHuman = { ...process.env, PORT: HUMAN_PORT, AIDEMO_PORT };
  const envAIDemo = { ...process.env, PORT: AIDEMO_PORT };

  const human = spawn('node', [path.join(__dirname, 'human-server.js')], {
    stdio: 'inherit',
    env: envHuman
  });
  const aidemo = spawn('node', [path.join(__dirname, 'aidemo-server.js')], {
    stdio: 'inherit',
    env: envAIDemo
  });

  procs = [human, aidemo];

  human.on('exit', (code) => {
    console.log(`Human server exited with code ${code}`);
  });
  aidemo.on('exit', (code) => {
    console.log(`AI Demo server exited with code ${code}`);
  });

  console.log(`Dev runner started. Human: http://localhost:${HUMAN_PORT}/, AI Demo: http://localhost:${AIDEMO_PORT}/AIDemo/index.html`);
  console.log('Press r + Enter to restart both servers, or Ctrl-C to quit.');
}

function stopServers(signal = 'SIGINT') {
  procs.forEach(p => {
    if (p && !p.killed) {
      try { p.kill(signal); } catch {}
    }
  });
  procs = [];
}

process.on('SIGINT', () => {
  stopServers('SIGINT');
  process.exit(0);
});
process.on('SIGTERM', () => {
  stopServers('SIGTERM');
  process.exit(0);
});

if (process.stdin.isTTY) {
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (data) => {
    const cmd = String(data).trim().toLowerCase();
    if (cmd === 'r') {
      console.log('Restarting both servers...');
      stopServers('SIGTERM');
      setTimeout(startServers, 300);
    }
  });
}

startServers();
