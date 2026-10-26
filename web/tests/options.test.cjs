const {test} = require("node:test");
const assert = require("node:assert/strict");
const O = require("../options.js");
const K = require("../keyboard.js");
test("recommended settings: gfx with every codec, sound, clipboard, nothing else", () => {
  assert.deepEqual(O.resolve(O.DEFAULTS, ""), ["/gfx", "/sound", "+clipboard"]);
  assert.ok(O.isDefault({}));
});
test("codec choices map to the AV1 profiles", () => {
  assert.equal(O.resolve({codec: "av1-420"}, "")[0], "/gfx:AV1:i420");
  assert.equal(O.resolve({codec: "av1-444"}, "")[0], "/gfx:AV1:i444");
  assert.equal(O.resolve({codec: "bogus"}, "")[0], "/gfx");
});
test("the two priorities are opposite and never mixed", () => {
  const bw = O.resolve({strategy: "bandwidth"}, ""), sv = O.resolve({strategy: "server"}, "");
  assert.ok(bw.includes("/network:broadband-low") && bw.includes("+compression") && bw.includes("/compression-level:2"));
  assert.ok(sv.includes("/network:lan") && sv.includes("-compression"));
  assert.ok(!sv.some((a) => /broadband|compression-level|\+compression/.test(a)));
});
test("remote scale: automatic adds nothing, a number is sent as /scale-desktop, extra options win", () => {
  assert.ok(!O.resolve({scale: "auto"}, "").some((a) => /scale/.test(a)));
  assert.ok(O.resolve({scale: "100"}, "").includes("/scale-desktop:100"));
  assert.ok(O.resolve({scale: 150}, "").includes("/scale-desktop:150"));
  assert.ok(!O.resolve({scale: "300"}, "").some((a) => /scale/.test(a)));   // not offered: automatic
  assert.deepEqual(O.resolve({scale: "200"}, "/scale:140").filter((a) => /scale/.test(a)), ["/scale:140"]);
  assert.ok(!O.isDefault({scale: "100"}));
});
test("microphone: off by default, /microphone when on, extra options win", () => {
  assert.ok(!O.resolve({}, "").some((a) => /microphone/.test(a)));
  assert.ok(O.resolve({mic: true}, "").includes("/microphone"));
  assert.ok(!O.resolve({mic: "yes"}, "").includes("/microphone"));   // only a real true turns it on
  assert.deepEqual(O.resolve({mic: true}, "/microphone:format:1").filter((a) => /microphone/.test(a)), ["/microphone:format:1"]);
  assert.deepEqual(O.overridden("/mic"), ["mic"]);
  assert.ok(!O.isDefault({mic: true}));
});
test("off switches", () => {
  const a = O.resolve({audio: false, clipboard: false}, "");
  assert.ok(a.includes("/audio-mode:2") && a.includes("-clipboard") && !a.includes("/sound"));
});
test("extra options win over generated options of the same kind, and come last", () => {
  const a = O.resolve({codec: "av1-444", strategy: "server"}, "/gfx:AV1:i420 /compression-level:1 /bpp:16");
  assert.deepEqual(a, ["/sound", "+clipboard", "/network:lan", "/gfx:AV1:i420", "/compression-level:1", "/bpp:16"]);
  assert.deepEqual(O.overridden("-sound +clipboard:off /network:auto"), ["audio", "clipboard", "network"]);
  assert.deepEqual(O.overridden("/gfx-h264 /soundx"), []);   // other options that only start the same
});
test("keyboard: mstsc keys only in the mstsc profile, only with Ctrl + Alt", () => {
  const ev = (code, mods = {ctrlKey: true, altKey: true}) => ({code, key: code, ...mods});
  assert.equal(K.action("freerdp", ev("Home")), null);
  assert.equal(K.action("mstsc", ev("Pause")), "fullscreen");
  assert.equal(K.action("mstsc", {code: "Pause", key: "Cancel", ctrlKey: true, altKey: true}), "fullscreen");
  assert.equal(K.action("mstsc", ev("Home")), "toolbar");
  assert.equal(K.action("mstsc", ev("End")), "ctrl-alt-del");
  assert.equal(K.action("mstsc", ev("End", {ctrlKey: true})), null);
  assert.equal(K.action("mstsc", {...ev("End"), repeat: true}), null);
});

test("all screens: separate monitors by default, one wide desktop on request, no FreeRDP option", () => {
  assert.equal(O.normalize({}).screens, "separate");
  assert.equal(O.normalize({ screens: "span" }).screens, "span");
  assert.equal(O.normalize({ screens: "mirror" }).screens, "separate");   // not offered
  assert.deepEqual(O.resolve({ screens: "span" }, ""), O.resolve(O.DEFAULTS, ""));
});
