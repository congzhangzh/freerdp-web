// Session settings -> FreeRDP command line options. The settings panel offers a few plain
// choices; this file owns what they mean. Options typed into Extra options win over the
// generated ones of the same kind, so a hand-written /gfx:... never meets a generated /gfx.
(function (root) {
  "use strict";
  const DEFAULTS = Object.freeze({ audio: true, mic: false, clipboard: true, codec: "auto", strategy: "recommended", scale: "auto" });
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
  const CODECS = { auto: "/gfx", "av1-420": "/gfx:AV1:i420", "av1-444": "/gfx:AV1:i444" };
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
    if (!(s.codec in CODECS)) s.codec = DEFAULTS.codec;
    if (!(s.strategy in STRATEGIES)) s.strategy = DEFAULTS.strategy;
    s.scale = String(s.scale); if (!SCALES.includes(s.scale)) s.scale = DEFAULTS.scale;
    s.audio = s.audio !== false; s.mic = s.mic === true; s.clipboard = s.clipboard !== false;
    return s;
  }
  // [kind, option] pairs for the settings, before Extra options are applied
  function generated(settings) {
    const s = normalize(settings);
    return [
      ["video", CODECS[s.codec]],
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
  function resolve(settings, extra) {
    const taken = new Set(overridden(extra));
    return [...generated(settings).filter(([k]) => !taken.has(k)).map(([, o]) => o), ...words(extra)];
  }
  const isDefault = (settings) => { const s = normalize(settings); return Object.keys(DEFAULTS).every((k) => s[k] === DEFAULTS[k]); };
  const api = { DEFAULTS, SCALES, normalize, generated, overridden, resolve, isDefault };
  root.FreeRDPOptions = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
