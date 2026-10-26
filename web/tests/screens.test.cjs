const {test} = require("node:test");
const assert = require("node:assert/strict");
const S = require("../screens.js");
test("a layout by hand: W x H + left + top per screen, anything else is none", () => {
  assert.deepEqual(S.parse("1920x1080+0+0,1280x1024+1920-56"), [
    {width: 1920, height: 1080, left: 0, top: 0, label: "Screen 1"},
    {width: 1280, height: 1024, left: 1920, top: -56, label: "Screen 2"}]);
  assert.deepEqual(S.parse("640x480 0 0,640x480 640 0"), S.parse("640x480+0+0,640x480+640+0"));   // from a URL's query
  for (const bad of ["", null, "1920x1080", "0x1080+0+0", "1920x1080+0+0,junk"]) assert.equal(S.parse(bad), null);
});
test("the desktop is the bounding box; the canvas starts left of and above this window's screen", () => {
  const [a, b] = S.parse("1920x1080+0+0,1280x1024-1280+200");
  const box = S.box([a, b]);
  assert.deepEqual(box, {left: -1280, top: 0, width: 3200, height: 1224});
  assert.deepEqual(S.place(a, box), {left: -1280, top: 0, width: 3200, height: 1224});
  assert.deepEqual(S.place(b, box), {left: 0, top: -200, width: 3200, height: 1224});
});
test("each screen gets its part of the canvas, in canvas pixels (a scale of 2 here)", () => {
  const [a, b] = S.parse("1920x1080+0+0,1280x1024+1920+0"), box = S.box([a, b]);
  assert.deepEqual(S.slice(a, box, 6400, 2160), {sx: 0, sy: 0, sw: 3840, sh: 2160});
  assert.deepEqual(S.slice(b, box, 6400, 2160), {sx: 3840, sy: 0, sw: 2560, sh: 2048});
  // a canvas a pixel short (sizes are rounded to even numbers): the part stays inside it
  const c = S.slice(b, box, 6398, 2160);
  assert.ok(c.sx + c.sw <= 6398);
});
test("a point in a screen's window lands on the same point of the canvas", () => {
  const [a, b] = S.parse("1920x1080+0+0,1280x1024+1920+0"), box = S.box([a, b]);
  const area = S.fit(1280, 1024, 1280, 1024);
  const rect = {left: 0, top: 0, width: 3200, height: 1080};   // this window's canvas, CSS pixels
  assert.deepEqual(S.toCanvas(S.fraction(640, 512, area), b, box, rect), {x: 2560, y: 512});
  assert.deepEqual(S.toCanvas(S.fraction(0, 0, area), b, box, rect), {x: 1920, y: 0});
  // not full screen yet: bars left and right; a point on a bar is the nearest edge
  const small = S.fit(1280, 1024, 1000, 600);
  assert.ok(Math.abs(small.w / small.h - 1.25) < 1e-9 && small.y === 0 && small.x > 0);
  assert.equal(S.toCanvas(S.fraction(0, 300, small), b, box, rect).x, 1920);
  assert.ok(S.toCanvas(S.fraction(999, 300, small), b, box, rect).x < 3200);
});
