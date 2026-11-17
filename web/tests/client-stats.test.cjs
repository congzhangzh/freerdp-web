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
  assert.deepStrictEqual(d, { pictures: 6, failed: 3, noPicture: 1, perSecond: 2, keyFrames: 2, avgMs: 4, maxMs: 9, lastPictureS: 0.5, hardware: false, fallbacks: 1, chroma: null });
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

// FreeRDP#14076 trimmed (the integration after next15): the client stops publishing
// RDPGFX_CODECID_<codec>_KEY_FRAMES, _HARDWARE and _FALLBACKS. Missing is not 0: Info shows no key
// count and no fallbacks then, and hardware stays unknown (the page asks WebCodecs itself)
const TRIMMED = /_(KEY_FRAMES|HARDWARE|FALLBACKS)$/;
test("trimmed names: no key frames, hardware or fallbacks: null, never a 0 that looks measured", () => {
  const names = fixture("avon").filter((n) => !TRIMMED.test(n));
  assert.ok(names.length < fixture("avon").length && names.includes("RDPGFX_CODECID_AV1_PICTURES"));
  const now = reading(names, { RDPGFX_CODECID_AV1_PICTURES: 12, RDPGFX_CODECID_AV1_FAILED: 1, RDPGFX_CODECID_AV1_DECODE_NS_SUM: 26e6 });
  assert.strictEqual(S.hasDecoders(now), true);
  const [d] = S.decoders(now, null, 1, S.FRDP_2);
  assert.deepStrictEqual([d.id, d.pictures, d.failed, d.avgMs], ["AV2", 12, 1, 2]);
  assert.deepStrictEqual([d.keyFrames, d.hardware, d.fallbacks], [null, null, null]);
  // a client that still has them: a measured 0 stays 0
  const full = S.decoders(reading(fixture("avon"), { RDPGFX_CODECID_AV1_PICTURES: 12 }), null, 1, S.FRDP_2)[0];
  assert.deepStrictEqual([full.keyFrames, full.hardware, full.fallbacks], [0, null, 0]);
});

test("RDP's own bytes: both names or none; a rate per second, none across a new connection", () => {
  assert.strictEqual(S.rdpBytes({}, null, 1), null);
  assert.strictEqual(S.rdpBytes({ NETWORK_BYTES_RECEIVED: 10 }, null, 1), null);
  const a = { NETWORK_BYTES_RECEIVED: 1000, NETWORK_BYTES_SENT: 200 }, b = { NETWORK_BYTES_RECEIVED: 3000, NETWORK_BYTES_SENT: 600 };
  assert.deepStrictEqual(S.rdpBytes(a, null, 1), { rx: 1000, tx: 200, rxPerSecond: null, txPerSecond: null });
  assert.deepStrictEqual(S.rdpBytes(b, a, 2), { rx: 3000, tx: 600, rxPerSecond: 1000, txPerSecond: 200 });
  assert.deepStrictEqual(S.rdpBytes(a, b, 2), { rx: 1000, tx: 200, rxPerSecond: null, txPerSecond: null });
});

test("the caps version: FreeRDP's GFX_CAPS_VERSION when the client has it, else undefined (the page asks the web client)", () => {
  assert.strictEqual(S.capsVersion({}), undefined);
  assert.strictEqual(S.capsVersion(null), undefined);
  assert.strictEqual(S.capsVersion({ GFX_CAPS_VERSION: 0 }), 0);
  assert.strictEqual(S.capsVersion({ GFX_CAPS_VERSION: S.FRDP_2 }), S.FRDP_2);
  assert.strictEqual(S.av1Slot(S.capsVersion({ GFX_CAPS_VERSION: S.FRDP_2 }) ?? 0x00010000), "AV2");
  assert.strictEqual(S.av1Slot(S.capsVersion({}) ?? 0x00010000), "AV1");
});

test("server (batch B): 0 is not known yet, so nothing shows before the capability exchange", () => {
  const s = S.server({ RDP_VERSION: 0, SERVER_RDP_VERSION: 0, SERVER_OS_MAJOR_TYPE: 0, SERVER_OS_MINOR_TYPE: 0, GFX_CAPS_VERSION: 0, RDPGFX_SURFACES: 0,
    RDPGFX_SURFACE1_CODECID: 0, RDPGFX_SURFACE1_WIDTH: 0, RDPGFX_SURFACE1_HEIGHT: 0 });   // all 0: an empty slot
  assert.equal(s.rdpVersion, null); assert.equal(s.rdpVersionServer, null); assert.equal(s.osMajor, null); assert.equal(s.capsVersion, null);
  assert.equal(s.host, null); assert.equal(s.certificate, null); assert.deepEqual(s.surfaceList, []); assert.equal(s.moreSurfaces, 0);
});
test("server (batch B): the values, the surfaces in their slots (an empty slot left out), the rest counted, the strings", () => {
  const s = S.server({ RDP_VERSION: 0x80011, SERVER_RDP_VERSION: 0x80011, SERVER_OS_MAJOR_TYPE: 4, SERVER_OS_MINOR_TYPE: 7, GFX_CAPS_VERSION: 0x20000,
    GFX_CAPS_FLAGS: 0, RDPGFX_SURFACES: 6,
    RDPGFX_SURFACE1_CODECID: 0x0011, RDPGFX_SURFACE1_WIDTH: 1280, RDPGFX_SURFACE1_HEIGHT: 720,
    RDPGFX_SURFACE2_CODECID: 0, RDPGFX_SURFACE2_WIDTH: 640, RDPGFX_SURFACE2_HEIGHT: 480,
    RDPGFX_SURFACE3_CODECID: 4294967295, RDPGFX_SURFACE3_WIDTH: 800, RDPGFX_SURFACE3_HEIGHT: 600,
    RDPGFX_SURFACE4_CODECID: 0, RDPGFX_SURFACE4_WIDTH: 0, RDPGFX_SURFACE4_HEIGHT: 0, SERVER_PORT: 3390 },
    { SERVER_HOSTNAME: "127.0.0.1", SERVER_CERT_CN: "desktop.example" });
  assert.equal(s.rdpVersion, 0x80011); assert.equal(s.osMajor, 4); assert.equal(s.osMinor, 7); assert.equal(s.capsFlags, 0); assert.equal(s.surfaces, 6);
  // codec 0 is RDPGFX_CODECID_UNCOMPRESSED, a real one; UINT32_MAX is "no picture yet"; WIDTH 0 is an empty slot
  assert.deepEqual(s.surfaceList, [{ slot: 1, width: 1280, height: 720, codecId: 0x11 }, { slot: 2, width: 640, height: 480, codecId: 0 },
    { slot: 3, width: 800, height: 600, codecId: null }]);
  assert.equal(s.moreSurfaces, 2);
  assert.equal(s.host, "127.0.0.1"); assert.equal(s.port, 3390); assert.equal(s.certificate, "desktop.example");
});
test("strings: a client without the string side has none; one with it gives name -> string", () => {
  assert.deepEqual(S.strings({}), {});
  const vals = [["SERVER_HOSTNAME", "gw"], ["SERVER_CERT_CN", null]];
  const m = { _freerdp_web_info_count: () => 2, ccall: (fn, r, t, [i]) => (fn === "freerdp_web_info_name" ? vals[i][0] : vals[i][1]) };
  assert.deepEqual(S.strings(m), { SERVER_HOSTNAME: "gw", SERVER_CERT_CN: "" });
});

test("chroma (RDPGFX_CODECID_AV1_CHROMA): 420/422/444 as the overlay writes them, 0 or anything else is none", () => {
  assert.equal(S.chromaName(420), "4:2:0"); assert.equal(S.chromaName(422), "4:2:2"); assert.equal(S.chromaName(444), "4:4:4");
  assert.equal(S.chromaName(0), null); assert.equal(S.chromaName(undefined), null); assert.equal(S.chromaName(411), null);
});
test("chroma: after the codec's name in the decoder results, AV2's too, never after AV1/AV2", () => {
  const base = { RDPGFX_CODECID_AV1_PICTURES: 5, RDPGFX_CODECID_AV1_FAILED: 0, RDPGFX_CODECID_AV1_NO_PICTURE: 0, RDPGFX_CODECID_AV1_CHROMA: 444 };
  assert.equal(S.decoders(base, null, 1, 0x10000)[0].label, "AV1 4:4:4");
  assert.equal(S.decoders(base, null, 1, S.FRDP_2)[0].label, "AV2 4:4:4");
  assert.equal(S.decoders(base, null, 1, 0)[0].label, "AV1/AV2");
  assert.equal(S.decoders({ ...base, RDPGFX_CODECID_AV1_CHROMA: 0 }, null, 1, 0x10000)[0].label, "AV1");
});
