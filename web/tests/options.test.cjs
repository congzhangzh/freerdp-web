const {test} = require("node:test");
const assert = require("node:assert/strict");
const O = require("../options.js");
const K = require("../keyboard.js");
test("recommended settings: gfx with every codec, sound, clipboard, nothing else", () => {
  assert.deepEqual(O.resolve(O.DEFAULTS, ""), ["/gfx", "/sound", "+clipboard"]);
  assert.ok(O.isDefault({}));
});
test("video: Automatic is a bare /gfx; the presets name every codec", () => {
  assert.equal(O.resolve({codec: "auto"}, "")[0], "/gfx");
  assert.equal(O.resolve({codec: "bogus"}, "")[0], "/gfx");
  assert.equal(O.resolve({codec: "bandwidth"}, "")[0], "/gfx:AV2:i444,AV1:i444,AVC444,AVC420,progressive,RFX");
  // least CPU: H.264 4:2:0 (one stream), no AV2; AV1 4:2:0 first only with a hardware AV1 decoder
  assert.equal(O.resolve({codec: "cpu"}, "")[0], "/gfx:AV2:off,AV1:off,AVC420,progressive,RFX");
  assert.equal(O.resolve({codec: "cpu"}, "", {av1Hardware: true})[0], "/gfx:AV2:off,AV1:i420,AVC420,progressive,RFX");
});
test("video: the old AV1 choices become a Custom list that sends what they did (AV2 was on by default)", () => {
  for (const [old, av1] of [["av1-444", "i444"], ["av1-420", "i420"]]) {
    const s = O.normalize({codec: old});
    assert.equal(s.codec, "custom");
    assert.equal(O.resolve(s, "")[0], `/gfx:AV2:i444,AV1:${av1}`);
  }
});
test("video: a custom order is kept by leaving out what the server would take first", () => {
  const list = O.codecList([{id: "h264", on: true}, {id: "av2", on: true}, {id: "av1", on: true, i444: false}, {id: "rfx", on: true}]);
  assert.deepEqual(list.map((r) => r.id), ["h264", "av2", "av1", "rfx", "progressive"]);   // the missing one comes last, off
  const rows = O.offered(list);
  assert.deepEqual(rows.map((r) => [r.id, r.offered, r.before ?? null]),
    [["h264", true, null], ["av2", false, "h264"], ["av1", false, "h264"], ["rfx", true, null], ["progressive", false, null]]);
  assert.equal(O.gfx(list), "/gfx:AV2:off,AV1:off,AVC444,AVC420,RFX");
  // in the server's own order everything on is offered
  assert.ok(O.offered(O.PRESETS.bandwidth()).every((r) => r.offered));
  // nothing on: only the basic codecs (planar, ClearCodec) remain
  assert.equal(O.gfx(O.codecList([])), "/gfx:AV2:off,AV1:off");
  // a skipped codec names the first one above it that it would beat
  assert.equal(O.offered(O.codecList([{id: "av1", on: true}, {id: "h264", on: true}, {id: "av2", on: true}]))[2].before, "av1");
});
test("video: a stored list is cleaned, and Custom is the only choice that uses it", () => {
  const list = O.codecList([{id: "av1", on: true}, {id: "av1", on: false}, {id: "bogus", on: true}, null, {id: "rfx", on: "yes"}]);
  assert.deepEqual(list.map((r) => [r.id, r.on]), [["av1", true], ["rfx", false], ["av2", false], ["h264", false], ["progressive", false]]);
  assert.equal(O.resolve({codec: "custom", codecs: [{id: "rfx", on: true}]}, "")[0], "/gfx:AV2:off,AV1:off,RFX");
  assert.equal(O.resolve({codec: "auto", codecs: [{id: "rfx", on: true}]}, "")[0], "/gfx");
  assert.ok(O.isDefault({codecs: [{id: "rfx", on: true}]}));   // the list is not a change while Video is Automatic
  assert.deepEqual(O.resolve({codec: "bandwidth"}, "/gfx:AV1:i420").filter((a) => /gfx/.test(a)), ["/gfx:AV1:i420"]);   // extra options win
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
