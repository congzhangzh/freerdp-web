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
//
// A decoder's counters have two sets of names, and either may come (the page works with both):
//  - FreeRDP from 20261113 (#14076): RDPGFX_CODECID_<codec>_<stat>, one set per GFX codec ID.
//    AV2 has no ID of its own: it is counted under AV1's, RDPGFX_CODECID_AV1_*, when the server
//    confirmed RDPGFX_CAPVERSION_FRDP_2. So the page tells them apart by the caps version: the
//    list's GFX_CAPS_VERSION when the client has it (capsVersion), else the web client's own
//    Module._freerdp_web_codec_stats() ([1], codec-stats.js); without either the label is
//    "AV1/AV2", never a guess. Unused IDs (and AV1's in a build without AV1)
//    are named RDPGFX_CODECID_UNKNOWN*, and are left out.
//  - FreeRDP up to 20261111: RDPGFX_DECODER_<decoder>_<stat>, with a set of AV2's own.
// Both have the same <stat> suffixes.
(function (root) {
  "use strict";
  // unused slots: every RDPGFX_CODECID_UNKNOWN* (an ID with no codec, and their counters)
  const notStat = (name) => name === "FREERDP_CLIENT_STATS_UNUSED" || /^RDPGFX_CODECID_UNKNOWN(_|$)/.test(name);
  const FRDP_2 = 0x00020000;   // RDPGFX_CAPVERSION_FRDP_2
  const DECODERS = [["AV1", "AV1"], ["AV2", "AV2"], ["AVC420", "H.264 4:2:0"], ["AVC444", "H.264 4:4:4"], ["AVC444v2", "H.264 4:4:4 v2"]];
  // a decoder's counter names: the new ones when the client has them, else the old ones
  const PREFIXES = ["RDPGFX_CODECID_", "RDPGFX_DECODER_"];
  const prefix = (now, id) => PREFIXES.find((p) => ["PICTURES", "FAILED", "NO_PICTURE"].some((s) => now?.[`${p}${id}_${s}`] !== undefined)) ?? null;
  // does this client count a decoder's pictures (either names)? Then the page's own AV1 rows go
  const hasDecoders = (now) => prefix(now, "AV1") !== null || prefix(now, "AVC420") !== null;

  // name -> index for this client; null for a client without the list
  function index(m) {
    if (typeof m?._freerdp_web_stats_count !== "function" || typeof m._freerdp_web_stats_value !== "function"
      || typeof m.ccall !== "function") return null;
    const names = new Map(), n = Number(m._freerdp_web_stats_count());
    for (let i = 0; i < n; i++) {
      const name = m.ccall("freerdp_web_stats_name", "string", ["number"], [i]);
      if (name && !notStat(name) && !names.has(name)) names.set(name, i);
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
  // RDP's own bytes, as FreeRDP's transport reads and writes them above TLS (transport.c: rdp->inBytes,
  // rdp->outBytes): no TLS records, no WebSocket frames, which the page's own Network rows count.
  // null for a client without them; a rate is null after a counter went down (a new connection)
  function rdpBytes(now, prev, dt) {
    if (now?.NETWORK_BYTES_RECEIVED === undefined || now?.NETWORK_BYTES_SENT === undefined) return null;
    return { rx: now.NETWORK_BYTES_RECEIVED, tx: now.NETWORK_BYTES_SENT,
      rxPerSecond: rate(now, prev, "NETWORK_BYTES_RECEIVED", dt), txPerSecond: rate(now, prev, "NETWORK_BYTES_SENT", dt) };
  }
  // the GFX caps version the server confirmed (RdpgfxClientContext::CapsVersion, upstream
  // aa9940f24), from the list's GFX_CAPS_VERSION when the client has it (0 before the confirm);
  // undefined for a client without it, which then leaves the web client's own reading to the page
  // (codec-stats.js [1])
  const capsVersion = (now) => now?.GFX_CAPS_VERSION;
  // sound from the server (rdpsnd; the microphone is not counted); null until the first wave
  function audio(now, prev, dt) {
    if (!now?.AUDIO_WAVES) return null;
    return { waves: now.AUDIO_WAVES, perSecond: rate(now, prev, "AUDIO_WAVES", dt),
      dropped: (now.AUDIO_WAVES_OVERRUN ?? 0) + (now.AUDIO_WAVES_UNDECODABLE ?? 0), delayMs: now.AUDIO_DELAY_MS ?? 0 };
  }
  // one decoder's counters, by the name part between the prefix and the stat (AV1, AVC420 ...);
  // null for a client without it, or before its first attempt
  function decoder(now, prev, dt, id) {
    const p = prefix(now, id);
    if (!p) return null;
    const key = (s) => `${p}${id}_${s}`;
    const get = (s) => now?.[key(s)] ?? 0;
    // the ones FreeRDP stopped publishing (FreeRDP#14076, trimmed): null when absent, never a 0
    // that looks measured
    const opt = (s) => now?.[key(s)] ?? null;
    const pictures = get("PICTURES"), failed = get("FAILED"), noPicture = get("NO_PICTURE");
    const tries = pictures + failed + noPicture;
    if (!tries) return null;
    const hardware = opt("HARDWARE");
    return { pictures, failed, noPicture, perSecond: rate(now, prev, key("PICTURES"), dt), keyFrames: opt("KEY_FRAMES"),
      avgMs: get("DECODE_NS_SUM") / tries / 1e6, maxMs: get("DECODE_NS_MAX") / 1e6,
      lastPictureS: get("LAST_PICTURE_AGE_NS") / 1e9, hardware: hardware === 2 ? true : hardware === 1 ? false : null,
      fallbacks: opt("FALLBACKS") };
  }
  // what the counters under AV1's codec ID are: "AV2" when the server confirmed FRDP_2, "AV1" for
  // any other caps version, null when the page can't know (caps: 0 before the confirm, or
  // undefined for a client without Module._freerdp_web_codec_stats)
  const av1Slot = (caps) => (!caps ? null : caps === FRDP_2 ? "AV2" : "AV1");

  // every decoder that has worked, as { id, label, ...decoder }. caps: the confirmed GFX caps
  // version (codec-stats.js [1]); with the new names it says whether AV1's counters are AV2's
  function decoders(now, prev, dt, caps) {
    return DECODERS.flatMap(([id, label]) => {
      const d = decoder(now, prev, dt, id);
      if (!d) return [];
      if (id === "AV1" && prefix(now, id) === PREFIXES[0]) {
        const slot = av1Slot(caps);
        return [{ id: slot ?? "AV1", label: slot ?? "AV1/AV2", ...d }];
      }
      return [{ id, label, ...d }];
    });
  }

  const api = { FRDP_2, index, read, rate, network, rdpBytes, capsVersion, audio, decoder, decoders, hasDecoders, av1Slot };
  if (typeof module !== "undefined" && module.exports) { module.exports = api; return; }
  root.freerdpClientStats = api;
})(typeof window !== "undefined" ? window : globalThis);
