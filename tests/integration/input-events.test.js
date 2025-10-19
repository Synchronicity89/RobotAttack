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

describe('Human game input responsiveness', () => {
  test('keydown D moves player to the right', async () => {
    const dom = new JSDOM(baseHtml(), { runScripts: 'outside-only', url: 'http://localhost/' });
    loadGame(dom);

    await new Promise(r => setTimeout(r, 80)); // init settle
    const startX = dom.window.yourRobot.x;

    dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'd' }));
    await new Promise(r => setTimeout(r, 300)); // allow motion

    const endX = dom.window.yourRobot.x;
    expect(endX).toBeGreaterThan(startX);
  });

  test('mousemove fires a player laser when off cooldown', async () => {
    const dom = new JSDOM(baseHtml(), { runScripts: 'outside-only', url: 'http://localhost/' });
    loadGame(dom);

    await new Promise(r => setTimeout(r, 80)); // init settle
    const before = dom.window.yourRobot.lasers.length;

    const canvas = dom.window.document.getElementById('maincanvas');
    const mev = new dom.window.MouseEvent('mousemove', { clientX: 200, clientY: 200, bubbles: true });
    canvas.dispatchEvent(mev);

    await new Promise(r => setTimeout(r, 60));
    const after = dom.window.yourRobot.lasers.length;

    expect(after).toBeGreaterThanOrEqual(before + 1);
  });
});
