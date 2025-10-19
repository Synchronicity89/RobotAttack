(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.HumanLib = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  function mulberry32(a) {
    return function() {
      let t = a += 0x6D2B79F5;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function segmentIntersectsAABB(x0, y0, x1, y1, minX, minY, maxX, maxY) {
    const dx = x1 - x0, dy = y1 - y0;
    let t0 = 0, t1 = 1;
    function clip(p, q) {
      if (p === 0) return q >= 0;
      const r = q / p;
      if (p < 0) {
        if (r > t1) return false;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return false;
        if (r < t1) t1 = r;
      }
      return true;
    }
    if (!clip(-dx, x0 - minX)) return { hit: false };
    if (!clip( dx, maxX - x0)) return { hit: false };
    if (!clip(-dy, y0 - minY)) return { hit: false };
    if (!clip( dy, maxY - y0)) return { hit: false };
    return { hit: t0 <= t1, tEnter: t0, tExit: t1 };
  }

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  function resolveInputs(keysDown, falling, atBottom, velChange) {
    const held = (k) => keysDown.has(k);
    let velX = 0;
    const left = held('a'), right = held('d'), brake = held('f');
    if (left && right) velX = 0;
    else if (left) velX = -3 * velChange;
    else if (right) velX = 3 * velChange;
    if (brake) velX = 0;
    const jump = held('w') && !falling;
    const drop = held('s') && !falling && !atBottom;
    return { velX, jump, drop, brake };
  }

  function mapMouseToCanvas(evt, canvas) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (evt.clientX - rect.left) * scaleX,
      y: (evt.clientY - rect.top) * scaleY
    };
  }

  function uuidv4() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  return { mulberry32, segmentIntersectsAABB, clamp, resolveInputs, mapMouseToCanvas, uuidv4 };
}));
