// Session settings -> FreeRDP command line options. The settings panel offers a few plain
// choices; this file owns what they mean. Options typed into Extra options win over the
// generated ones of the same kind, so a hand-written /gfx:... never meets a generated /gfx.
(function (root) {
  "use strict";
  const DEFAULTS = Object.freeze({ audio: true, mic: false, clipboard: true, codec: "auto", strategy: "recommended", scale: "auto", screens: "separate" });
  // the Custom list a fresh page starts from (Least data's), kept apart from DEFAULTS: it matters
  // only while Video is Custom
  // what each kind of option looks like on the command line (FreeRDP accepts / + -)
  const KINDS = {
    video: /^[/+-]gfx(?::|$)/i,
    audio: /^[/+-](?:sound|audio-mode)(?::|$)/i,
    mic: /^[/+-](?:microphone|mic)(?::|$)/i,
    clipboard: /^[/+-]clipboard(?::|$)/i,
    network: /^[/+-]network(?::|$)/i,
    compression: /^[/+-](?:compression|compression-level|z)(?::|$)/i,
    scale: /^[/+-]scale(?:-desktop)?(?::|$)/i,
  };
  // The remote desktop's scale. "auto" leaves it to the page, which sends the screen's own scale
  // (vault.js connectionArgs); a number is sent as it is, at connect and with every later display
  // layout (FreeRDP keeps a /scale-desktop for the whole session), so the server keeps it.
  const SCALES = ["auto", "100", "125", "150", "200"];
  // All screens (app.js): each screen a monitor of its own on the server, or one desktop as wide
  // as all of them (mstsc's /multimon and /span). The page's own choice: no FreeRDP option.
  const SCREENS = ["separate", "span"];
  // Video. The client can only tell the server which codecs it takes, not in what order: the server
  // confirms one capability set, the best it knows of those offered (FreeRDP's shadow server: AV2's
  // FRDP_2, then AV1's FRDP_1, then 10.x, where it takes H.264 before RemoteFX). So a list in the
  // page's order works by leaving out what the server would take before something the list puts
  // first: offered() keeps a codec only if the server ranks it below every codec kept above it.
  // "auto" sends a bare /gfx, as before: FreeRDP's own defaults. Planar, ClearCodec and
  // uncompressed bitmaps are part of every capability set: always there, never in the list.
  const VIDEO = [   // rank: how the server chooses, best first
    { id: "av2", rank: 5, chroma: true }, { id: "av1", rank: 4, chroma: true }, { id: "h264", rank: 3, chroma: true },
    { id: "progressive", rank: 2 }, { id: "rfx", rank: 1 },
  ];
  const RANK = Object.fromEntries(VIDEO.map((v) => [v.id, v.rank]));
  const row = (id, on = true, i444 = true) => ({ id, on, i444 });
  // Least data: every codec, 4:4:4 where there is one; the server takes the newest it has.
  // Least CPU here: what the browser decodes in hardware, one stream (4:2:0); AV1 first when this
  // browser has a hardware AV1 decoder; AV2 last and off (software only, in this page).
  const PRESETS = {
    bandwidth: () => [row("av2"), row("av1"), row("h264"), row("progressive"), row("rfx")],
    cpu: (env) => env?.av1Hardware
      ? [row("av1", true, false), row("h264", true, false), row("progressive"), row("rfx"), row("av2", false)]
      : [row("h264", true, false), row("progressive"), row("rfx"), row("av1", false, false), row("av2", false)],
  };
  // what earlier versions stored: an AV1 profile, AV2 on by FreeRDP's default (the same /gfx as then)
  const LEGACY = {
    "av1-444": [row("av2"), row("av1"), row("h264", false), row("progressive", false), row("rfx", false)],
    "av1-420": [row("av2"), row("av1", true, false), row("h264", false), row("progressive", false), row("rfx", false)],
  };
  const CODECS = ["auto", "bandwidth", "cpu", "custom"];
  // a list as stored: every codec once, in the order given, then the missing ones (off)
  function codecList(list) {
    const seen = new Set(), out = [];
    for (const r of Array.isArray(list) ? list : [])
      if (r && Object.hasOwn(RANK, r.id) && !seen.has(r.id)) { seen.add(r.id); out.push(row(r.id, r.on === true, r.i444 !== false)); }
    for (const v of VIDEO) if (!seen.has(v.id)) out.push(row(v.id, false));
    return out;
  }
  // the list a choice stands for (env: what this browser decodes in hardware)
  const listOf = (s, env) => s.codec === "custom" ? s.codecs : PRESETS[s.codec]?.(env) ?? null;
  // which rows are offered; a skipped one names the first codec above it that the server would
  // have passed over for it
  function offered(list) {
    const kept = [];
    return list.map((r) => {
      if (!r.on) return { ...r, offered: false };
      const before = kept.find((id) => RANK[id] < RANK[r.id]);
      if (before) return { ...r, offered: false, before };
      kept.push(r.id);
      return { ...r, offered: true };
    });
  }
  // the /gfx option for a list: AV1 and AV2 are on unless turned off; H.264, RemoteFX and its
  // progressive form are on only when named (FreeRDP turns off the ones a /gfx:… does not name)
  function gfx(list) {
    const on = Object.fromEntries(offered(list).filter((r) => r.offered).map((r) => [r.id, r]));
    const parts = [];
    for (const [id, name] of [["av2", "AV2"], ["av1", "AV1"]]) parts.push(on[id] ? `${name}:${on[id].i444 ? "i444" : "i420"}` : `${name}:off`);
    if (on.h264) parts.push(...(on.h264.i444 ? ["AVC444", "AVC420"] : ["AVC420"]));
    if (on.progressive) parts.push("progressive");
    if (on.rfx) parts.push("RFX");
    return "/gfx:" + parts.join(",");
  }
  // Save bandwidth: tell the server the link is slow (it drops wallpaper, themes and
  // animations) and offer the strongest bulk compression. Reduce server load: a LAN link and
  // no bulk compression, so the server compresses nothing beyond the video codec.
  const STRATEGIES = {
    recommended: [],
    bandwidth: [["network", "/network:broadband-low"], ["compression", "+compression"], ["compression", "/compression-level:2"]],
    server: [["network", "/network:lan"], ["compression", "-compression"]],
  };
  function normalize(s) {
    s = { ...DEFAULTS, ...(s || {}) };
    if (s.codec in LEGACY) { s.codecs = LEGACY[s.codec]; s.codec = "custom"; }
    if (!CODECS.includes(s.codec)) s.codec = DEFAULTS.codec;
    s.codecs = codecList(s.codecs ?? PRESETS.bandwidth());
    if (!(s.strategy in STRATEGIES)) s.strategy = DEFAULTS.strategy;
    s.scale = String(s.scale); if (!SCALES.includes(s.scale)) s.scale = DEFAULTS.scale;
    if (!SCREENS.includes(s.screens)) s.screens = DEFAULTS.screens;
    s.audio = s.audio !== false; s.mic = s.mic === true; s.clipboard = s.clipboard !== false;
    return s;
  }
  // [kind, option] pairs for the settings, before Extra options are applied
  function generated(settings, env) {
    const s = normalize(settings), list = listOf(s, env);
    return [
      ["video", list ? gfx(list) : "/gfx"],
      ["audio", s.audio ? "/sound" : "/audio-mode:2"],   // 2: the server plays nothing
      ...(s.mic ? [["mic", "/microphone"]] : []),        // off: the browser never asks for it
      ["clipboard", s.clipboard ? "+clipboard" : "-clipboard"],
      ...STRATEGIES[s.strategy],
      ...(s.scale === "auto" ? [] : [["scale", "/scale-desktop:" + s.scale]]),
    ];
  }
  const words = (extra) => String(extra || "").split(/\s+/).filter(Boolean);
  // the kinds of setting that Extra options take over
  function overridden(extra) {
    const w = words(extra);
    return Object.keys(KINDS).filter((k) => w.some((a) => KINDS[k].test(a)));
  }
  // the options for a session: generated ones the Extra options do not override, then Extra options
  function resolve(settings, extra, env) {
    const taken = new Set(overridden(extra));
    return [...generated(settings, env).filter(([k]) => !taken.has(k)).map(([, o]) => o), ...words(extra)];
  }
  const isDefault = (settings) => { const s = normalize(settings); return Object.keys(DEFAULTS).every((k) => s[k] === DEFAULTS[k]); };
  const api = { DEFAULTS, SCALES, SCREENS, VIDEO, PRESETS, normalize, codecList, listOf, offered, gfx, generated, overridden, resolve, isDefault };
  root.FreeRDPOptions = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
