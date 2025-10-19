const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

function baseHtml() {
  return `
<!DOCTYPE html>
<html>
  <body>
    <canvas id="maincanvas" width="800" height="600"></canvas>
  </body>
</html>`;
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

function loadGame(dom) {
  dom.window.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 16);
  const proto = dom.window.HTMLCanvasElement.prototype;
  if (!proto.__patched) {
    proto.getContext = function(kind) {
      if (kind === '2d') return makeCtxMock();
      return null;
    };
    proto.__patched = true;
  }
  const lib = fs.readFileSync(path.join(__dirname, '../..', 'humanLib.js'), 'utf8');
  dom.window.eval(lib);
  const code = fs.readFileSync(path.join(__dirname, '../..', 'code.js'), 'utf8');
  dom.window.eval(code);
  dom.window.dispatchEvent(new dom.window.Event('load'));
}

describe('Human game loops', () => {
  test('physics/draw loops advance and robots move', async () => {
    const dom = new JSDOM(baseHtml(), { runScripts: 'outside-only', url: 'http://localhost/' });
    loadGame(dom);

    // Snapshot initial positions
    const initial = () => (dom.window.robots || []).map(r => ({ x: r.x, y: r.y }));
    const before = initial();

    // Allow several frames
    await new Promise(r => setTimeout(r, 400));

    const after = (dom.window.robots || []).map(r => ({ x: r.x, y: r.y }));
    expect(Array.isArray(after)).toBe(true);
    expect(after.length).toBeGreaterThan(0);

    // Assert at least one robot changed position
    const anyChanged = after.some((p, i) => {
      const q = before[i] || { x: NaN, y: NaN };
      return p.x !== q.x || p.y !== q.y;
    });
    expect(anyChanged).toBe(true);
  });
});
