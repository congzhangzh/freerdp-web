// FreeRDP's counters as Info reads them (web/client-stats.js), from a pretend client.
const test = require("node:test");
const assert = require("node:assert");
const S = require("../client-stats.js");

// a client with these names, in this order; its values can change between readings
function client(names, values = {}) {
  return { values,
    _freerdp_web_stats_count: () => names.length,
    _freerdp_web_stats_value(i) { return this.values[names[i]] ?? 0; },
    ccall: (fn, type, types, [i]) => { assert.strictEqual(fn, "freerdp_web_stats_name"); return names[i]; } };
}

test("a client without the list, or without ccall, has none", () => {
  assert.strictEqual(S.index({}), null);
  assert.strictEqual(S.index(undefined), null);
  assert.strictEqual(S.index({ _freerdp_web_stats_count: () => 1, _freerdp_web_stats_value: () => 0 }), null);
  assert.strictEqual(S.index(client([])), null);
});

test("names are looked up, unused slots skipped, and the first of a repeated name kept", () => {
  const m = client(["RDPGFX_CODECID_UNKNOWN", "AUDIO_WAVES", "RDPGFX_CODECID_UNKNOWN_BYTES", "RDPGFX_CODECID_UNKNOWN", "FREERDP_CLIENT_STATS_UNUSED", "NETWORK_RTT_AVERAGE_MS", "AUDIO_WAVES"]);
  assert.deepStrictEqual([...S.index(m)], [["AUDIO_WAVES", 1], ["NETWORK_RTT_AVERAGE_MS", 5]]);
});

test("the same name is read wherever a client keeps it", () => {
  const values = { AUDIO_WAVES: 7 };
  for (const names of [["AUDIO_WAVES", "X"], ["X", "Y", "AUDIO_WAVES"]]) {
    const m = client(names, values);
    assert.strictEqual(S.read(m, S.index(m)).AUDIO_WAVES, 7);
  }
});

test("a rate is per second, and null without an earlier reading or for a counter that went down", () => {
  assert.strictEqual(S.rate({ A: 30 }, { A: 10 }, "A", 2), 10);
  assert.strictEqual(S.rate({ A: 30 }, null, "A", 2), null);
  assert.strictEqual(S.rate({ A: 30 }, { B: 1 }, "A", 2), null);
  assert.strictEqual(S.rate({}, { A: 1 }, "A", 2), null);
  assert.strictEqual(S.rate({ A: 3 }, { A: 500 }, "A", 2), null);   // a new channel after a reconnect
  assert.strictEqual(S.rate({ A: 3 }, { A: 1 }, "A", 0), null);
});

test("network: a client without the names is null; the server's 0 is 'not measured', kept as 0", () => {
  assert.strictEqual(S.network({}), null);
  assert.strictEqual(S.network(null), null);
  assert.deepStrictEqual(S.network({ NETWORK_RTT_AVERAGE_MS: 0, NETWORK_RTT_BASE_MS: 0, NETWORK_BANDWIDTH_KBPS: 0 }), { rtt: 0, rttBase: 0, kbps: 0 });
  assert.deepStrictEqual(S.network({ NETWORK_RTT_AVERAGE_MS: 12, NETWORK_RTT_BASE_MS: 9, NETWORK_BANDWIDTH_KBPS: 5000 }), { rtt: 12, rttBase: 9, kbps: 5000 });
});

test("audio: nothing before the first wave; overruns and undecodable waves are both dropped", () => {
  assert.strictEqual(S.audio({ AUDIO_WAVES: 0 }), null);
  assert.strictEqual(S.audio({}), null);
  assert.deepStrictEqual(S.audio({ AUDIO_WAVES: 150, AUDIO_WAVES_OVERRUN: 2, AUDIO_WAVES_UNDECODABLE: 1, AUDIO_DELAY_MS: 40 }, { AUDIO_WAVES: 100 }, 1),
    { waves: 150, perSecond: 50, dropped: 3, delayMs: 40 });
});

test("a decoder: the average covers every attempt, the failed ones too", () => {
  const k = (s) => `RDPGFX_DECODER_AV1_${s}`;
  const d = S.decoder({ [k("PICTURES")]: 6, [k("FAILED")]: 3, [k("NO_PICTURE")]: 1, [k("KEY_FRAMES")]: 2, [k("DECODE_NS_SUM")]: 40e6, [k("DECODE_NS_MAX")]: 9e6,
    [k("LAST_PICTURE_AGE_NS")]: 5e8, [k("HARDWARE")]: 1, [k("FALLBACKS")]: 1 }, { [k("PICTURES")]: 2 }, 2, "AV1");
  assert.deepStrictEqual(d, { pictures: 6, failed: 3, noPicture: 1, perSecond: 2, keyFrames: 2, avgMs: 4, maxMs: 9, lastPictureS: 0.5, hardware: false, fallbacks: 1 });
});

test("a decoder that only fails still shows: that is when the row matters", () => {
  const d = S.decoder({ RDPGFX_DECODER_AV1_FAILED: 4 }, null, 1, "AV1");
  assert.strictEqual(d.failed, 4);
  assert.strictEqual(d.pictures, 0);
  assert.strictEqual(d.perSecond, null);
});

test("hardware: 2 is yes, 1 is no, and 0 is unknown, not no", () => {
  const hw = (v) => S.decoder({ RDPGFX_DECODER_AV1_PICTURES: 1, RDPGFX_DECODER_AV1_HARDWARE: v }, null, 1, "AV1").hardware;
  assert.strictEqual(hw(2), true);
  assert.strictEqual(hw(1), false);
  assert.strictEqual(hw(0), null);
});

test("only the decoders that worked are listed", () => {
  assert.deepStrictEqual(S.decoders({ RDPGFX_DECODER_AV1_PICTURES: 0 }, null, 1), []);
  assert.deepStrictEqual(S.decoders({ RDPGFX_DECODER_AV1_PICTURES: 0, RDPGFX_DECODER_AVC420_PICTURES: 1 }, null, 1).map(d => [d.id, d.label]), [["AVC420", "H.264 4:2:0"]]);
});

// The two sets of decoder names (client-stats.js): FreeRDP from 20261113 names them by GFX codec
// ID, RDPGFX_CODECID_<codec>_<stat> (fixtures: the names probed from release-20261113.1's built
// library, AV on and AV off); FreeRDP up to 20261111 had RDPGFX_DECODER_<decoder>_<stat>, written
// out here from release-20261111.4's RDPGFX_STATS_DECODER_NAMES (rdpgfx_main.c), AV2 among them.
const fs = require("node:fs"), path = require("node:path");
const fixture = (v) => fs.readFileSync(path.join(__dirname, "fixtures", `rdpgfx-names-20261113-${v}.txt`), "utf8").split("\n").filter((l) => l && !l.startsWith("#"));
const STATS = ["PICTURES", "FAILED", "NO_PICTURE", "KEY_FRAMES", "DECODE_NS_SUM", "DECODE_NS_MAX", "LAST_PICTURE_AGE_NS", "HARDWARE", "FALLBACKS"];
const OLD = ["AV1", "AVC420", "AVC444", "AVC444v2", "AV2"].flatMap((d) => STATS.map((s) => `RDPGFX_DECODER_${d}_${s}`));
// a reading of a client with these names: every name 0 but those in values
const reading = (names, values = {}) => { const m = client(names, values); return S.read(m, S.index(m)); };

test("the fixtures are the 206 names the brief and the probe give", () => {
  for (const v of ["avon", "avoff"]) assert.strictEqual(fixture(v).length, 206, v);
  assert.ok(fixture("avon").includes("RDPGFX_CODECID_AV1_PICTURES"));
  assert.ok(!fixture("avoff").includes("RDPGFX_CODECID_AV1_PICTURES"));
});

test("new names: every RDPGFX_CODECID_UNKNOWN* is left out, the rest kept once", () => {
  for (const v of ["avon", "avoff"]) {
    const names = S.index(client(fixture(v)));
    assert.ok(![...names.keys()].some((n) => n.startsWith("RDPGFX_CODECID_UNKNOWN")), v);
    assert.strictEqual(names.size, new Set(fixture(v).filter((n) => !n.startsWith("RDPGFX_CODECID_UNKNOWN"))).size, v);
  }
});

test("a session's counters are 0: no decoder has worked, but the client has them", () => {
  for (const names of [fixture("avon"), fixture("avoff"), OLD]) {
    const now = reading(names);
    assert.deepStrictEqual(S.decoders(now, null, 1, 0), []);
    assert.strictEqual(S.hasDecoders(now), true);
  }
  assert.strictEqual(S.hasDecoders({ AUDIO_WAVES: 1 }), false);
  assert.strictEqual(S.hasDecoders(null), false);
});

test("new names: AV1's counters are AV2's when the server confirmed FRDP_2", () => {
  const now = reading(fixture("avon"), { RDPGFX_CODECID_AV1_PICTURES: 30, RDPGFX_CODECID_AV1_DECODE_NS_SUM: 60e6, RDPGFX_CODECID_AVC420_PICTURES: 2 });
  const label = (caps) => S.decoders(now, null, 1, caps).map((d) => [d.id, d.label, d.pictures]);
  assert.deepStrictEqual(label(S.FRDP_2), [["AV2", "AV2", 30], ["AVC420", "H.264 4:2:0", 2]]);
  assert.deepStrictEqual(label(0x00010000), [["AV1", "AV1", 30], ["AVC420", "H.264 4:2:0", 2]]);   // FRDP_1
  assert.deepStrictEqual(label(0x000a0701), [["AV1", "AV1", 30], ["AVC420", "H.264 4:2:0", 2]]);   // 10.7: no AV2 there
  // a client without the caps version, or before the confirm: the page can't tell, and says so
  assert.deepStrictEqual(label(undefined), [["AV1", "AV1/AV2", 30], ["AVC420", "H.264 4:2:0", 2]]);
  assert.deepStrictEqual(label(0), [["AV1", "AV1/AV2", 30], ["AVC420", "H.264 4:2:0", 2]]);
  assert.strictEqual(S.decoders(now, null, 1, S.FRDP_2)[0].avgMs, 2);
});

test("new names, AV off: AV1's slot is UNKNOWN, so only H.264 is there", () => {
  const now = reading(fixture("avoff"), { RDPGFX_CODECID_AVC444v2_PICTURES: 5, RDPGFX_CODECID_UNKNOWN_PICTURES: 9 });
  assert.deepStrictEqual(S.decoders(now, null, 1, S.FRDP_2).map((d) => [d.id, d.pictures]), [["AVC444v2", 5]]);
});

test("old names: AV1 and AV2 each have their own, whatever the caps version", () => {
  const now = reading(OLD, { RDPGFX_DECODER_AV1_PICTURES: 3, RDPGFX_DECODER_AV2_PICTURES: 7, RDPGFX_DECODER_AV2_HARDWARE: 1 });
  for (const caps of [undefined, 0, S.FRDP_2])
    assert.deepStrictEqual(S.decoders(now, null, 1, caps).map((d) => [d.id, d.label, d.pictures, d.hardware]), [["AV1", "AV1", 3, null], ["AV2", "AV2", 7, false]]);
});

test("the new names win when a client has both", () => {
  const now = { RDPGFX_CODECID_AV1_PICTURES: 4, RDPGFX_DECODER_AV1_PICTURES: 99 };
  assert.strictEqual(S.decoder(now, null, 1, "AV1").pictures, 4);
});

test("a rate from the new names, and none across a reconnect", () => {
  const k = "RDPGFX_CODECID_AVC420_PICTURES";
  assert.strictEqual(S.decoders({ [k]: 50 }, { [k]: 20 }, 2, 0)[0].perSecond, 15);
  assert.strictEqual(S.decoders({ [k]: 5 }, { [k]: 20 }, 2, 0)[0].perSecond, null);
});
