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
