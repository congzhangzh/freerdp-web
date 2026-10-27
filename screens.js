// The remote desktop across several screens (the toolbar's "All screens"): the geometry, shared by
// the page (app.js) and the window on each other screen (screen.js). A layout is a list of
// screens in the browser's screen coordinates, CSS pixels as window.getScreenDetails() reports
// them. The remote desktop is the bounding box of the screens in use, and the page's canvas
// spans it: each screen shows its own part, so a window dragged from one screen to the next
// moves on, as on a local desktop that spans them (mstsc's /span).
(function (root) {
  "use strict";
  // "1920x1080+0+0,1280x1024+1920+0": W x H + left + top per screen, for tests and by hand. In a
  // URL's query a + reads as a space, so a space is a + here.
  function parse(spec) {
    if (!spec) return null;
    const screens = [];
    for (const part of String(spec).split(",")) {
      const m = /^(\d+)x(\d+)([+-]\d+)([+-]\d+)$/.exec(part.trim().replace(/ /g, "+"));
      if (!m || +m[1] < 1 || +m[2] < 1) return null;
      screens.push({ width: +m[1], height: +m[2], left: +m[3], top: +m[4], label: "Screen " + (screens.length + 1) });
    }
    return screens;
  }
  function box(screens) {
    const left = Math.min(...screens.map((s) => s.left)), top = Math.min(...screens.map((s) => s.top));
    const right = Math.max(...screens.map((s) => s.left + s.width)), bottom = Math.max(...screens.map((s) => s.top + s.height));
    return { left, top, width: right - left, height: bottom - top };
  }
  // the canvas in the page's window, which is full screen on screen `cur`: CSS left, top and size
  const place = (cur, b) => ({ left: b.left - cur.left, top: b.top - cur.top, width: b.width, height: b.height });
  // screen s's part of a canvas of cw x ch pixels that spans box b
  function slice(s, b, cw, ch) {
    const kx = cw / b.width, ky = ch / b.height;
    const sx = Math.round((s.left - b.left) * kx), sy = Math.round((s.top - b.top) * ky);
    return { sx, sy, sw: Math.min(cw - sx, Math.round(s.width * kx)), sh: Math.min(ch - sy, Math.round(s.height * ky)) };
  }
  // a part of sw x sh in a view of vw x vh: as large as it fits, centred (bars where the window
  // is not full screen yet)
  function fit(sw, sh, vw, vh) {
    const k = Math.min(vw / sw, vh / sh), w = sw * k, h = sh * k;
    return { x: (vw - w) / 2, y: (vh - h) / 2, w, h };
  }
  // a point in that view as a fraction of the screen, kept inside it (a bar is its nearest edge)
  const inside = (v) => Math.min(Math.max(v, 0), 0.9999);
  const fraction = (x, y, area) => ({ fx: inside((x - area.x) / area.w), fy: inside((y - area.y) / area.h) });
  // that point on the page's canvas, in client coordinates (rect: its getBoundingClientRect())
  const toCanvas = (f, s, b, rect) => ({
    x: rect.left + (s.left - b.left + f.fx * s.width) * rect.width / b.width,
    y: rect.top + (s.top - b.top + f.fy * s.height) * rect.height / b.height,
  });
  const api = { parse, box, place, slice, fit, fraction, toCanvas };
  root.FreeRDPScreens = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
