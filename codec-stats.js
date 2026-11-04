// Info's "Video codecs" row: what the server sent, per RDP graphics (RDPGFX) codec, from the
// client's own counters. FreeRDP's SDL3 client counts them in its web build only
// (client/SDL/SDL3/sdl_channels.cpp, wrapping gdi's GFX callbacks) and exports
// Module._freerdp_web_codec_stats(): the address of 37 uint32 in the client's memory, layout 2:
//   [0]       the layout's version, 2 (any other: a layout this page doesn't know, the row hides)
//   [1]       the GFX caps version the server confirmed in this session (0 before; set again on
//             each connect): FRDP_1 = AV1, FRDP_2 = AV2
//   [2..17]   surface commands per codec id (codecId & 15)
//   [18..33]  their bytes
//   [34..36]  SolidFill, SurfaceToSurface, CacheToSurface PDUs: paints that carry no codec (a
//             server that paints mostly from its caches shows small codec counts and big ones here)
// Everything but [1] counts for the page's life, across reconnects. The counters are uint32 and
// may wrap, so rates come from unsigned deltas.
//
// The client is built as a module, so its HEAPU32 is not the page's: only Module.HEAPU8 is
// exported (and renewed when the memory grows), and the counters are read through its buffer.
(function (root) {
  "use strict";
  const LAYOUT = 2, SLOTS = 37;
  const FRDP_2 = 0x00020000;   // RDPGFX_CAPVERSION_FRDP_2
  const NAMES = { 0: "Uncompressed", 3: "RemoteFX", 8: "ClearCodec", 9: "Progressive", 10: "Planar",
    11: "H.264 4:2:0 (AVC420)", 12: "Alpha", 14: "H.264 4:4:4 (AVC444)", 15: "H.264 4:4:4 (AVC444v2)" };
  const PAINTS = [[34, "SolidFill"], [35, "SurfaceToSurface"], [36, "CacheToSurface"]];

  // a copy of the counters at ptr in the client's memory (heap: its Module.HEAPU8); null without
  // them or for a layout this page doesn't know
  function read(heap, ptr) {
    if (!heap?.buffer || !ptr || ptr % 4) return null;
    if (heap.byteOffset + ptr + SLOTS * 4 > heap.buffer.byteLength) return null;
    const a = Array.from(new Uint32Array(heap.buffer, heap.byteOffset + ptr, SLOTS));
    return a[0] === LAYOUT ? a : null;
  }

  // a codec id's name: AV2 has id 2 in the FreeRDP the release kit builds; a FreeRDP that gives it
  // AV1's id 1 tells them apart by the caps version the server confirmed. AV1's chroma ("4:4:4")
  // comes from its stream (app.js).
  function name(id, caps, av1Chroma) {
    if (id === 2 || (id === 1 && caps === FRDP_2)) return "AV2";
    if (id === 1) return av1Chroma ? `AV1 ${av1Chroma}` : "AV1";
    return NAMES[id] ?? "codec " + id;
  }

  // "AV1 4:4:4 30/s 2400 kbit/s · CacheToSurface 4/s", every codec and paint the session has seen;
  // "" before the first. prev: the reading dt seconds earlier (none: rates 0)
  function describe(now, prev, dt, av1Chroma) {
    const d = (i) => (prev ? (now[i] - prev[i]) >>> 0 : 0);
    const per = (n) => (n / (dt || 1)).toFixed(0);
    const parts = [];
    for (let id = 0; id < 16; id++)
      if (now[2 + id]) parts.push(`${name(id, now[1], av1Chroma)} ${per(d(2 + id))}/s ${per(d(18 + id) * 8 / 1000)} kbit/s`);
    for (const [i, label] of PAINTS) if (now[i]) parts.push(`${label} ${per(d(i))}/s`);
    return parts.join(" · ");
  }

  const api = { LAYOUT, SLOTS, FRDP_2, read, name, describe };
  if (typeof module !== "undefined" && module.exports) { module.exports = api; return; }
  root.freerdpCodecStats = api;
})(typeof window !== "undefined" ? window : globalThis);
