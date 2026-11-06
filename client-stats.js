// Info's rows from FreeRDP's own counters: network, sound and each video decoder. They live in
// FreeRDP's libraries for every client to read (client/common/client_stats.c, FreeRDP discussion
// #14051); the page only shows them. A client exports them as a flat list of names and values:
//   Module._freerdp_web_stats_count()      how many
//   Module._freerdp_web_stats_value(i)     a double, exact to 2^53
//   Module.ccall("freerdp_web_stats_name", "string", ["number"], [i])
// There is no layout version and an index means nothing from one client to the next, so the names
// are looked up once per client and nothing here knows an index. The list may still change: it is
// not in an upstream release yet.
//
// A name a client doesn't have is "not available", which is not 0: every reader here gives null
// for it, and its row hides. These values need care (the same words are in client_stats.c):
//  - NETWORK_PACKETS_* count slow-path PDUs only, so they are not shown as packets.
//  - NETWORK_BANDWIDTH_KBPS and NETWORK_RTT_* are the server's measurements: 0 until it makes
//    them, and some servers never do.
//  - RDPGFX_FRAMES_DECODED counts frames the server ended, not pictures, and is not used here.
//  - a decoder's *_DECODE_NS_SUM adds up every attempt, also the failed ones: its mean is per
//    attempt, not per picture.
//  - a decoder's *_HARDWARE is 0 unknown, 1 no, 2 yes.
//  - after FreeRDP's own reconnect the graphics counters start again from 0: a counter that went
//    down is a new channel, so its rate is null, never negative. Sound spans the reconnect.
//  - every value is 0 before the session attaches and after it ends, so this is for a live session.
(function (root) {
  "use strict";
  const NOT_STATS = new Set(["RDPGFX_CODECID_UNKNOWN", "RDPGFX_CODECID_UNKNOWN_BYTES", "FREERDP_CLIENT_STATS_UNUSED"]);   // unused slots
  // AV2 has codec rows in the list but no decoder rows
  const DECODERS = [["AV1", "AV1"], ["AVC420", "H.264 4:2:0"], ["AVC444", "H.264 4:4:4"], ["AVC444v2", "H.264 4:4:4 v2"]];

  // name -> index for this client; null for a client without the list
  function index(m) {
    if (typeof m?._freerdp_web_stats_count !== "function" || typeof m._freerdp_web_stats_value !== "function"
      || typeof m.ccall !== "function") return null;
    const names = new Map(), n = Number(m._freerdp_web_stats_count());
    for (let i = 0; i < n; i++) {
      const name = m.ccall("freerdp_web_stats_name", "string", ["number"], [i]);
      if (name && !NOT_STATS.has(name) && !names.has(name)) names.set(name, i);
    }
    return names.size ? names : null;
  }
  // one reading: { name: value }, the names of this client only
  function read(m, names) {
    const now = {};
    for (const [name, i] of names) now[name] = m._freerdp_web_stats_value(i);
    return now;
  }
  // per second since the reading dt seconds earlier; null without one, or for a counter that went
  // down (see above)
  function rate(now, prev, name, dt) {
    const a = now?.[name], b = prev?.[name];
    return a === undefined || b === undefined || a < b || !(dt > 0) ? null : (a - b) / dt;
  }

  // the server's measurements: null for a client without them, 0 for "not measured"
  function network(now) {
    if (now?.NETWORK_RTT_AVERAGE_MS === undefined) return null;
    return { rtt: now.NETWORK_RTT_AVERAGE_MS, rttBase: now.NETWORK_RTT_BASE_MS ?? 0, kbps: now.NETWORK_BANDWIDTH_KBPS ?? 0 };
  }
  // sound from the server (rdpsnd; the microphone is not counted); null until the first wave
  function audio(now, prev, dt) {
    if (!now?.AUDIO_WAVES) return null;
    return { waves: now.AUDIO_WAVES, perSecond: rate(now, prev, "AUDIO_WAVES", dt),
      dropped: (now.AUDIO_WAVES_OVERRUN ?? 0) + (now.AUDIO_WAVES_UNDECODABLE ?? 0), delayMs: now.AUDIO_DELAY_MS ?? 0 };
  }
  // one decoder (its id in DECODERS); null for a client without it, or before its first attempt
  function decoder(now, prev, dt, id) {
    const key = (s) => `RDPGFX_DECODER_${id}_${s}`;
    const get = (s) => now?.[key(s)] ?? 0;
    const pictures = get("PICTURES"), failed = get("FAILED"), noPicture = get("NO_PICTURE");
    const tries = pictures + failed + noPicture;
    if (!tries) return null;
    const hardware = get("HARDWARE");
    return { pictures, failed, noPicture, perSecond: rate(now, prev, key("PICTURES"), dt), keyFrames: get("KEY_FRAMES"),
      avgMs: get("DECODE_NS_SUM") / tries / 1e6, maxMs: get("DECODE_NS_MAX") / 1e6,
      lastPictureS: get("LAST_PICTURE_AGE_NS") / 1e9, hardware: hardware === 2 ? true : hardware === 1 ? false : null,
      fallbacks: get("FALLBACKS") };
  }
  // every decoder that has worked, as { id, label, ...decoder }
  const decoders = (now, prev, dt) => DECODERS.flatMap(([id, label]) => {
    const d = decoder(now, prev, dt, id);
    return d ? [{ id, label, ...d }] : [];
  });

  const api = { index, read, rate, network, audio, decoder, decoders };
  if (typeof module !== "undefined" && module.exports) { module.exports = api; return; }
  root.freerdpClientStats = api;
})(typeof window !== "undefined" ? window : globalThis);
