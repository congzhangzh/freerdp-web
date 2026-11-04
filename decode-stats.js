// Video frames the browser decodes, counted by the page itself, for Info's "AV1 frames" and
// "H.264 frames" rows. FreeRDP's WebCodecs glue (libfreerdp/codec/av1_webcodecs.js,
// h264_webcodecs.js) makes a VideoDecoder per surface on this page's main thread, sends it one
// chunk and waits for its picture before the next. So the page wraps the VideoDecoder class
// before the client starts, and every decoder FreeRDP makes reports here, whatever the server
// (xrdp, the Windows or the macOS host) and whatever the colour (4:2:0 or 4:4:4).
//
// Why the page counts and not FreeRDP: the counters used to be FreeRDP's (Module.freerdpAv1.stats,
// a commit of the old wasm-vault integration that the release FreeRDP no longer carries since
// 2026-10-27), so Info said "0 total" while pictures arrived. Counting here needs no FreeRDP patch.
//
// What is counted, per codec family (the configure() codec string's first four letters: "av01",
// "avc1"): chunks sent (and key chunks, and their bytes), pictures out, and the time from
// decode() to the picture. dav1d (the software fallback inside the client) is not a
// VideoDecoder and is not counted: Info then says so.
(function (root) {
  "use strict";
  const blank = () => ({ chunks: 0, frames: 0, keyFrames: 0, bytes: 0, decodeMs: 0 });
  // a VideoDecoder class that counts into stats[family]; V is the browser's own class
  function counting(V, stats, now = () => performance.now()) {
    const state = new WeakMap();
    return class VideoDecoder extends V {
      constructor(init) {
        const s = { family: null, sent: [] };
        super({ ...init, output: (frame) => {
          const c = s.family && stats[s.family];
          if (c) { c.frames++; const t0 = s.sent.shift(); if (t0 !== undefined) c.decodeMs += now() - t0; }
          return init.output(frame);
        } });
        state.set(this, s);
      }
      configure(config) {
        const s = state.get(this);
        if (s) { s.family = String(config?.codec ?? "").slice(0, 4) || null; s.sent.length = 0; if (s.family) stats[s.family] ||= blank(); }
        return super.configure(config);
      }
      decode(chunk) {
        const s = state.get(this), c = s?.family && stats[s.family];
        if (c) { c.chunks++; c.bytes += chunk?.byteLength ?? 0; if (chunk?.type === "key") c.keyFrames++; s.sent.push(now()); }
        return super.decode(chunk);
      }
      // a reset or a flush drops what was in flight: its start times go with it
      reset() { const s = state.get(this); if (s) s.sent.length = 0; return super.reset(); }
    };
  }
  const api = { counting, blank };
  if (typeof module !== "undefined" && module.exports) { module.exports = api; return; }
  root.freerdpDecodeStats = {};
  if (typeof root.VideoDecoder === "function") root.VideoDecoder = counting(root.VideoDecoder, root.freerdpDecodeStats);
})(typeof window !== "undefined" ? window : globalThis);
