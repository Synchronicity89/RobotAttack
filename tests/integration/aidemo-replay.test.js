const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

function baseHtml() {
  const html = fs.readFileSync(path.join(__dirname, '../../AIDemo/index.html'), 'utf8');
  return html;
}

function makeCtxMock() {
  const noop = () => {};
  return {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    save: noop,
    restore: noop,
    fillRect: noop,
    strokeRect: noop,
    beginPath: noop,
    moveTo: noop,
    lineTo: noop,
    stroke: noop,
    fillText: noop
  };
}

describe('AI Demo replay', () => {
  test('replays inputs and advances state', async () => {
    // Do not auto-load external scripts; we will inject manually
    const dom = new JSDOM(baseHtml(), {
      runScripts: 'outside-only',
      resources: 'usable',
      url: 'http://localhost/AIDemo/index.html?rec=http://localhost/mock-recording.json'
    });

    // Patch canvas 2D and rAF
    const proto = dom.window.HTMLCanvasElement.prototype;
    if (!proto.__patched) {
      proto.getContext = function(kind) {
        if (kind === '2d') return makeCtxMock();
        return null;
      };
      proto.__patched = true;
    }
    dom.window.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 16);

    // Mock fetch for world.json and the recording BEFORE loading scripts
    const sampleRecording = {
      world: { crosshairStart: { x: 200, y: 200 } },
      seed: 42,
      inputs: [
        { frame: 0, type: 'mousemove', payload: { x: 200, y: 200 } },
        { frame: 2, type: 'keydown', payload: { key: 'd' } },
        { frame: 20, type: 'keyup', payload: { key: 'd' } }
      ]
    };
    dom.window.fetch = async (url) => {
      const u = String(url);
      if (u.endsWith('/world.json')) {
        return { ok: true, json: async () => ({ impl: 'aidemo', clampPlayer: true }) };
      }
      if (u.endsWith('/mock-recording.json')) {
        return { ok: true, json: async () => sampleRecording };
      }
      return { ok: false, json: async () => ({}) };
    };

    // Inject scripts manually (prevent network)
    const humanLibSrc = fs.readFileSync(path.join(__dirname, '../../humanLib.js'), 'utf8');
    dom.window.eval(humanLibSrc);
    const aidemoSrc = fs.readFileSync(path.join(__dirname, '../../AIDemo/aidemo.js'), 'utf8');
    dom.window.eval(aidemoSrc);

    // Allow boot + a few frames
    await new Promise(r => setTimeout(r, 300));

    const st = dom.window.demoState;
    expect(st).toBeDefined();
    const startX = st.player.x;

    // Let replay run some more frames with 'd' held then released
    await new Promise(r => setTimeout(r, 500));
    const endX = st.player.x;
    expect(endX).toBeGreaterThan(startX);

    // Shooting should have occurred from initial mousemove
    expect(st.lasers.length).toBeGreaterThanOrEqual(1);
  });
});
