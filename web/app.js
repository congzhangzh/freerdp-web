// Settings live in localStorage; the password never does.
const KEY = "freerdp-web-settings";
const $ = (id) => document.getElementById(id);
const logEl = $("log");
const info = { started: 0, decoder: "–", transport: "–", server: "–" };
// Crash capture: the last log lines are kept and, while a session runs, saved to localStorage
// every few seconds. A clean end (Disconnect, Right Shift + D) marks them "clean"; anything else
// (wasm abort, connection lost, tab crash or reload) leaves "running" or "crashed", and the next
// start offers the log. Only the page log is kept: it never contains the password (/p:***) or
// clipboard content.
const CRASH_KEY = "freerdp-web-lastlog", CRASH_LINES = 300;
const crash = { lines: [], running: false, userEnded: false, timer: 0 };
function crashStore(state, reason) {
  try {
    localStorage.setItem(CRASH_KEY, JSON.stringify({ state, reason: reason || "", time: Date.now(), lines: crash.lines }));
  } catch (e) {}
}
let sessionPassword = "";
const log = (s) => {
  s = String(s);
  if (sessionPassword) s = s.split(sessionPassword).join("***");
  s = s.replace(/([/+-](?:p|gp|password):)(?:"[^"\n]*"|'[^'\n]*'|[^\s]*)/gi, "$1***");
  crash.lines.push(s); if (crash.lines.length > CRASH_LINES) crash.lines.shift();
  if (/pressed, disconnecting RDP session/.test(s)) crash.userEnded = true;   // FreeRDP's Right Shift + D
  logEl.textContent += s + "\n"; logEl.scrollTop = logEl.scrollHeight; console.log(s);
  const m = /AV1 decoder: ([^,\n]+)/.exec(s);
  if (m) info.decoder = m[1].trim();
  if (/WebCodecs AV1 decode failed|using dav1d/.test(s)) info.decoder = "dav1d (fallback)";
  if (/The connection failed|ERRCONNECT_|tcp-shim\]/.test(s)) document.querySelector("details").open = true;
};
const status = (s) => { $("status").textContent = s; };

function loadSettings() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem(KEY) || "{}"); } catch (e) {}
  const q = new URLSearchParams(location.search);   // URL overrides, for testing
  // gateway (WebSocket) and direct (TCP) targets are different addresses: keep them apart
  const direct = window.directSocketsAvailable;
  $("host").value = q.get("v") || (direct ? s.directHost : s.host) || (direct ? "" : "127.0.0.1:6080");
  $("host").placeholder = direct ? "rdp-server:3389" : "127.0.0.1:6080";
  const dl = $("recentHosts");
  for (const h of (direct ? s.directHostRecent : s.hostRecent) || []) dl.appendChild(new Option(h));
  $("user").value = q.get("u") || s.user || "";
  let extra = q.get("extra") ?? s.extra ?? "/gfx:AV1:i444";
  try { FreeRDPVault.validateOptions(extra); }
  catch (e) {
    extra = "/gfx:AV1:i444"; q.delete("extra"); delete s.extra;
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (ignored) {}
    log("[page] ignored credential or secret-export options in saved settings or URL");
  }
  $("extra").value = extra;
  $("fs").checked = q.has("fs") ? q.get("fs") === "1" : !!s.fullscreen;
  // Do not accept passwords in URLs: history, referrers and access logs retain them.
  q.delete("p");
  if (q.toString() !== new URLSearchParams(location.search).toString())
    history.replaceState(null, "", location.pathname + (q.size ? "?" + q : "") + location.hash);
  return q.get("autoconnect") === "1";
}
function saveSettings() {
  FreeRDPVault.validateOptions($("extra").value);
  let s = {};
  try { s = JSON.parse(localStorage.getItem(KEY) || "{}"); } catch (e) {}
  const key = $("direct").checked ? "directHost" : "host";
  s[key] = $("host").value;
  const recentKey = key + "Recent";
  s[recentKey] = [s[key], ...(s[recentKey] || []).filter((h) => h !== s[key])].filter(Boolean).slice(0, 8);
  s.user = $("user").value; s.extra = $("extra").value; s.fullscreen = $("fs").checked;
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) {}
}

const autoconnect = loadSettings();
$("canvas").addEventListener("contextmenu", (e) => e.preventDefault());
$("canvas").addEventListener("mousedown", () => $("canvas").focus());
if (window.directSocketsAvailable) { $("direct").checked = true; $("hostLabel").firstChild.textContent = "RDP server (host:port)"; }
else { $("direct").disabled = true; $("directLabel").title = "Direct TCP needs the page to run as an Isolated Web App"; }
let runtimeReady = false, runtimeFailed = false, connectStarted = false;
let resolveRuntime;
const runtime = new Promise(resolve => { resolveRuntime = resolve; });
var Module = {
  canvas: $("canvas"),
  // SDL listens for keys on the whole window and calls preventDefault(), which blocks typing in
  // the page's own input boxes. SDL reads hints from the environment: limit it to the canvas.
  preRun: [() => { Module.ENV.SDL_EMSCRIPTEN_KEYBOARD_ELEMENT = "#canvas"; }],
  print: (t) => log(t),
  printErr: (t) => log(t),
  onRuntimeInitialized() {
    runtimeReady = true; resolveRuntime(true);
    $("go").disabled = false; $("go").textContent = "Connect"; status("ready");
    if (autoconnect) connect();
  },
  onExit(code) {
    status("exited: " + code); log("[page] exit code " + code); window.__freerdpExit = code;
    if (code !== 0) document.querySelector("details").open = true;   // show the reason
    // exit code 0 also follows a lost connection: look at the log, not only at the code
    const lost = crash.lines.some((l) => /ERRCONNECT_|Network disconnect|\[tcp-shim\].*(Error|abort)/i.test(l));
    crashEnd(!crash.userEnded && (code !== 0 || lost), code !== 0 ? "exit code " + code : lost ? "connection lost" : "");
  },
  onAbort(what) { runtimeFailed = true; resolveRuntime(false); FreeRDPVaultUI.lock(); log("[page] aborted: " + what); crashEnd(true, "wasm abort: " + what); },
};
function crashEnd(unexpected, reason) {
  clearInterval(crash.timer); crash.running = false;
  crashStore(unexpected ? "crashed" : "clean", reason);
}
window.addEventListener("error", (e) => { if (crash.running) log("[page] error: " + (e.message || e.error)); });
window.addEventListener("unhandledrejection", (e) => { if (crash.running) log("[page] unhandled rejection: " + (e.reason?.message || e.reason)); });
// a tab closed or reloaded during a session (also what a renderer crash looks like next time)
window.addEventListener("pagehide", () => { if (crash.running) crashStore(crash.userEnded ? "clean" : "running"); });

// Full screen is requested from a user gesture (Connect click or Right Shift + Enter).
// The canvas is sized by CSS, so SDL follows it and /dynamic-resolution resizes the remote
// desktop. Keyboard Lock sends Esc / Windows keys to the remote side (hold Esc to leave).
const realExitFullscreen = document.exitFullscreen.bind(document);
// SDL3 also requests full screen on its canvas when it (re)creates its window, e.g. after the
// GRD handover redirect; Emscripten defers such a request to the next click or key press, so the
// page appeared to go full screen by itself. The page owns full screen: ignore canvas requests.
for (const name of ["requestFullscreen", "webkitRequestFullscreen"]) {
  if (HTMLCanvasElement.prototype[name] || Element.prototype[name])
    HTMLCanvasElement.prototype[name] = function () { return Promise.resolve(); };   // the page did it already
}
async function enterFullscreen() {
  try {
    await document.documentElement.requestFullscreen({ navigationUI: "hide" });
  } catch (e) {
    log("[page] full screen refused: " + e.message);
    return false;
  }
  document.body.classList.add("fs");
  try { await navigator.keyboard?.lock?.(); } catch (e) { log("[page] keyboard lock unavailable: " + e.message); }
  $("canvas").focus();
  return true;
}
function toggleFullscreen() {
  if (document.fullscreenElement) { navigator.keyboard?.unlock?.(); realExitFullscreen(); }
  else enterFullscreen();
}
document.addEventListener("fullscreenchange", () => {
  if (!document.fullscreenElement) { document.body.classList.remove("fs"); log("[page] left full screen"); }
});
// FreeRDP's own hotkeys stay active (Right Shift + Enter full screen, + D disconnect, ...).
// Browsers only allow full screen *during* a key or click event, but FreeRDP handles the hotkey
// later in its main loop, so Emscripten would defer SDL's request to the user's next input. The
// page therefore performs the browser part of FreeRDP's Right Shift + Enter in the key event
// itself, without swallowing the key (SDL still sees it); SDL's late request is then ignored.
let rightShift = false;
window.addEventListener("keyup", (e) => { if (e.code === "ShiftRight") rightShift = false; }, true);
window.addEventListener("keydown", (e) => {
  if (e.code === "ShiftRight") rightShift = true;
  if (e.key === "Enter" && rightShift && document.body.classList.contains("session")) toggleFullscreen();
}, true);

// Clipboard (text and images). SDL3 has no browser clipboard driver, so the page bridges it:
//  - remote -> local: FreeRDP hands over text (freerdpClipboardWrite) and CF_DIB images
//    (freerdpClipboardWriteImage). A DIB is a BMP file without its 14 byte file header: add the
//    header, let the browser decode it, re-encode as PNG (the only image type browsers write)
//    and write text and image of the same copy together as one ClipboardItem. Writing needs
//    document focus, so a failed write is retried on the next focus.
//  - local -> remote: on focus and every 1.5 s while focused, read the browser clipboard; if it
//    changed, offer its text and image (converted to a 32 bit bottom-up CF_DIB) to the server.
//    What we wrote ourselves is not offered back, so nothing ping-pongs.
const clip = { lastSig: null, pending: null, out: null, outTimer: 0, warned: false };
async function dibToPng(dib) {
  const h = new DataView(dib.buffer, dib.byteOffset, dib.byteLength);
  const biSize = h.getUint32(0, true), bits = h.getUint16(14, true), compression = h.getUint32(16, true);
  const colors = bits <= 8 ? (h.getUint32(32, true) || 1 << bits) : 0;
  const masks = compression === 3 && biSize === 40 ? 12 : 0;            // BI_BITFIELDS
  const file = new Uint8Array(14 + dib.byteLength), v = new DataView(file.buffer);
  file[0] = 0x42; file[1] = 0x4d; v.setUint32(2, file.length, true); v.setUint32(10, 14 + biSize + masks + colors * 4, true);
  file.set(dib, 14);
  const bmp = await createImageBitmap(new Blob([file], { type: "image/bmp" }));
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  c.getContext("2d").drawImage(bmp, 0, 0);
  return c.convertToBlob({ type: "image/png" });
}
async function blobToDib(blob) {
  const bmp = await createImageBitmap(blob);
  const w = bmp.width, h = bmp.height, c = new OffscreenCanvas(w, h), g = c.getContext("2d");
  g.drawImage(bmp, 0, 0);
  const rgba = g.getImageData(0, 0, w, h).data;
  const dib = new Uint8Array(40 + w * h * 4), v = new DataView(dib.buffer);
  v.setUint32(0, 40, true); v.setInt32(4, w, true); v.setInt32(8, h, true);   // positive height: bottom-up
  v.setUint16(12, 1, true); v.setUint16(14, 32, true); v.setUint32(16, 0, true); v.setUint32(20, w * h * 4, true);
  for (let y = 0; y < h; y++) {
    const src = (h - 1 - y) * w * 4, dst = 40 + y * w * 4;
    for (let x = 0; x < w * 4; x += 4) {
      dib[dst + x] = rgba[src + x + 2]; dib[dst + x + 1] = rgba[src + x + 1];
      dib[dst + x + 2] = rgba[src + x]; dib[dst + x + 3] = rgba[src + x + 3];
    }
  }
  return dib;
}
async function signature(text, blob) {
  const parts = [text || ""];
  if (blob) parts.push(Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()))).join(","));
  return parts.join("|");
}
async function writeOut() {
  const o = clip.out; clip.out = null;
  if (!o) return;
  const data = {};
  if (o.text) data["text/plain"] = new Blob([o.text], { type: "text/plain" });
  if (o.png) data["image/png"] = o.png;
  clip.lastSig = await signature(o.text, o.png);
  try { await navigator.clipboard.write([new ClipboardItem(data)]); clip.pending = null; }
  catch (e) { clip.pending = o; }
}
const queueOut = (part) => {   // text and image of one copy arrive separately: write them together
  clip.out = Object.assign(clip.out || {}, part);
  clearTimeout(clip.outTimer); clip.outTimer = setTimeout(writeOut, 200);
};
Module.freerdpClipboardWrite = (text) => queueOut({ text });
// The server's image arrives as a CF_DIB, or as PNG when the server offers PNG only (e.g. GNOME
// Remote Desktop for a PNG-only source); a PNG needs no conversion.
Module.freerdpClipboardWriteImage = (bytes, isPng) =>
  (isPng ? Promise.resolve(new Blob([bytes], { type: "image/png" })) : dibToPng(bytes)).then((png) => queueOut({ png }),
    (e) => log("[page] clipboard image from server not decodable: " + e.message));
async function syncClipboard() {
  if (!document.body.classList.contains("session") || !document.hasFocus()) return;
  if (clip.pending) { clip.out = clip.pending; clip.pending = null; await writeOut(); return; }
  let text = "", png = null;
  try {
    for (const item of await navigator.clipboard.read()) {
      if (item.types.includes("text/plain")) text = await (await item.getType("text/plain")).text();
      const img = item.types.find((t) => t.startsWith("image/"));
      if (img) png = await item.getType(img);
    }
  } catch (e) {
    try { text = await navigator.clipboard.readText(); }            // e.g. only text permission
    catch (e2) { if (!clip.warned) { clip.warned = true; log("[page] clipboard read not allowed: " + e2.message); } return; }
  }
  if (!text && !png) return;
  const sig = await signature(text, png);
  if (sig === clip.lastSig) return;
  let ptr = 0, len = 0;
  if (png) {
    try { const dib = await blobToDib(png); len = dib.length; ptr = Module._malloc(len); HEAPU8.set(dib, ptr); }
    catch (e) { log("[page] clipboard image not decodable: " + e.message); }
  }
  const ok = Module.ccall("freerdp_web_clipboard_offer", "number", ["string", "number", "number"], [text || null, ptr, len]);
  if (ptr) Module._free(ptr);
  if (ok) clip.lastSig = sig;
}
window.addEventListener("focus", syncClipboard);
setInterval(syncClipboard, 1500);

// Session toolbar. A button click is always a valid user gesture for full screen.
const toolbar = $("toolbar");
const backToCanvas = () => setTimeout(() => $("canvas").focus(), 0);
$("tbFs").onclick = () => { toggleFullscreen(); backToCanvas(); };
$("tbLog").onclick = () => { const d = document.querySelector("details"); d.open = !d.open; backToCanvas(); };
$("tbQuit").onclick = () => { crash.userEnded = true; if (crash.running) crashEnd(false, ""); location.reload(); };
// 📌 keeps the toolbar visible in full screen (remembered across sessions)
const setPinned = (on) => { document.body.classList.toggle("tbpinned", on); $("tbPin").classList.toggle("on", on);
  $("tbPin").title = on ? "Unpin toolbar (auto-hide in full screen)" : "Pin toolbar (always visible)";
  try { localStorage.setItem("freerdp-web-tbpinned", on ? "1" : "0"); } catch (e) {} };
let pinned0 = false; try { pinned0 = localStorage.getItem("freerdp-web-tbpinned") === "1"; } catch (e) {}
setPinned(pinned0);
$("tbPin").onclick = () => { setPinned(!document.body.classList.contains("tbpinned")); backToCanvas(); };
$("tbInfo").onclick = () => { $("info").hidden = !$("info").hidden; updateInfo(); backToCanvas(); };
let last = { t: performance.now(), rx: 0, tx: 0, frames: 0, ms: 0 };
let version = "?";
fetch(".well-known/manifest.webmanifest").then((r) => r.json()).then((m) => { version = m.version; }).catch(() => {});
function updateInfo() {
  if ($("info").hidden) return;
  const now = performance.now(), dt = (now - last.t) / 1000 || 1;
  const net = window.freerdpNet || { rx: 0, tx: 0 };
  const av1 = Module.freerdpAv1?.stats || { frames: 0, keyFrames: 0, bytes: 0, decodeMs: 0 };
  const fps = (av1.frames - last.frames) / dt;
  const dms = av1.frames > last.frames ? (av1.decodeMs - last.ms) / (av1.frames - last.frames) : 0;
  const kbit = (b) => (b * 8 / 1000 / dt).toFixed(0) + " kbit/s";
  const mb = (b) => (b / 1e6).toFixed(1) + " MB";
  const dur = info.started ? Math.floor((Date.now() - info.started) / 1000) : 0;
  const rows = [
    ["Server", info.server], ["Transport", info.transport],
    ["Resolution", `${$("canvas").width} × ${$("canvas").height}`],
    ["Canvas", (() => { const c = $("canvas"), b = c.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
      const bw = Math.round(b.width * dpr), bh = Math.round(b.height * dpr);
      const same = Math.abs(bw - c.width) <= 2 && Math.abs(bh - c.height) <= 2;
      return same ? `${bw} × ${bh} on screen, matches` :
        `⚠ ${bw} × ${bh} on screen, aspect ${(bw / bh).toFixed(2)} vs picture ${(c.width / c.height).toFixed(2)}`; })()],
    ["Video codecs", (() => {
      const f = Module._freerdp_web_codec_stats?.(); if (!f) return "–";
      const now = Array.from(HEAPU32.subarray(f >> 2, (f >> 2) + 32));
      const prev = last.codecs || now.map(() => 0);
      const names = { 0: "Uncompressed", 1: "AV1", 3: "RemoteFX", 8: "ClearCodec", 9: "Progressive", 10: "Planar",
                      11: "AVC420", 12: "Alpha", 14: "AVC444", 15: "AVC444v2" };
      last.codecsNext = now;
      const parts = [];
      for (let i = 0; i < 16; i++) if (now[i]) {
        const rate = (now[i] - prev[i]) / dt, kb = (now[16 + i] - prev[16 + i]) * 8 / 1000 / dt;
        parts.push(`${names[i] ?? "codec " + i} ${rate.toFixed(0)}/s ${kb.toFixed(0)} kbit/s`);
      }
      return parts.join(" · ") || "no updates yet"; })()],
    ["AV1 decoder", info.decoder],
    ["Audio codec", (() => {
      const a = Module._freerdp_web_audio_format?.(); if (!a) return "–";
      const [tag, rate, ch] = HEAPU32.subarray(a >> 2, (a >> 2) + 3);
      if (!tag) return "no audio yet";
      const name = { 0x0001: "PCM", 0x704F: "Opus", 0xA106: "AAC", 0x0002: "ADPCM", 0x0011: "IMA ADPCM" }[tag] ?? "0x" + tag.toString(16);
      return `${name}, ${rate / 1000} kHz, ${ch === 2 ? "stereo" : ch === 1 ? "mono" : ch + " ch"}`; })()],
    ["AV1 frames", `${fps.toFixed(1)} /s, ${av1.frames} total (${av1.keyFrames} key)`],
    ["AV1 decode", av1.frames ? `${dms.toFixed(1)} ms/frame (avg ${(av1.decodeMs / av1.frames).toFixed(1)})` : "–"],
    ["Audio", (() => { const c = Module.freerdpAudioContext, a = Module.freerdpAudio;
      if (!c) return "–";
      const q = a ? Math.max(0, Math.round((a.next - c.currentTime) * 1000)) : 0;
      return `${c.state}, ${a ? q + " ms queued" : "no data yet"}`; })()],
    ["Network in", `${kbit(net.rx - last.rx)}, ${mb(net.rx)} total`],
    ["Network out", `${kbit(net.tx - last.tx)}, ${mb(net.tx)} total`],
    ["Session", `${Math.floor(dur / 60)}:${String(dur % 60).padStart(2, "0")}`],
    ["Client", `FreeRDP Web ${version}`],
  ];
  const tbl = $("infoTable"); tbl.textContent = "";
  for (const [k, v] of rows) { const tr = tbl.insertRow(); tr.insertCell().textContent = k; tr.insertCell().textContent = v; }
  last = { t: now, rx: net.rx, tx: net.tx, frames: av1.frames, ms: av1.decodeMs, codecs: last.codecsNext };
}
setInterval(updateInfo, 1000);
document.addEventListener("fullscreenchange", () => {
  $("tbFs").textContent = document.fullscreenElement ? "Window" : "Full screen";
  document.body.classList.toggle("tbhide", !!document.fullscreenElement);
  // The browser fires "resize" before "fullscreenchange", i.e. while the old CSS still applies,
  // so SDL measured the canvas too early. Tell it again once the new layout is in place; SDL's
  // handler reads the current sizes, not the event, so a synthetic event is enough.
  requestAnimationFrame(() => { placeToolbar(); window.dispatchEvent(new Event("resize")); });
});
// in full screen: reveal the toolbar when the mouse touches the top edge, hide it again after a while
let tbTimer = 0;
window.addEventListener("mousemove", (e) => {
  if (!document.body.classList.contains("fs")) return;
  if (e.clientY <= 4 || toolbar.contains(e.target)) {
    document.body.classList.remove("tbhide");
    clearTimeout(tbTimer);
    tbTimer = setTimeout(() => { if (document.body.classList.contains("fs") && !toolbar.matches(":hover")) document.body.classList.add("tbhide"); }, 2500);
  }
}, true);
// in a window: keep the toolbar at the top of the canvas
const placeToolbar = () => document.documentElement.style.setProperty("--tbtop", Math.max(0, $("canvas").getBoundingClientRect().top) + "px");
window.addEventListener("resize", placeToolbar); window.addEventListener("scroll", placeToolbar);

// the canvas height is "viewport minus header": keep --hdr in sync with the header's height
const syncHeader = () => document.documentElement.style.setProperty("--hdr", document.querySelector("header").offsetHeight + "px");   // 0 when hidden
window.addEventListener("resize", syncHeader); syncHeader();

async function connect() {
  if (connectStarted || runtimeFailed) return;
  try { FreeRDPVaultUI.check(); } catch (e) { status(e.message); return; }
  const selectedId = FreeRDPVaultUI.selected;
  const checkSelection = () => {
    if (FreeRDPVaultUI.selected !== selectedId) throw new Error("Selected host changed. Connect again to use the current selection.");
    FreeRDPVaultUI.check();
  };
  connectStarted = true;
  let handedToWasm = false;
  try {
  if (!runtimeReady) status("waiting for runtime…");
  // Audio: browsers only start an AudioContext from a user gesture, so create it here, before
  // any await; FreeRDP's Web Audio backend (rdpsnd "emscripten") plays through it.
  try {
    Module.freerdpAudioContext ??= new AudioContext({ latencyHint: "interactive" });
    Module.freerdpAudioContext.resume().catch(() => {});
  } catch (e) { log("[page] no Web Audio: " + e.message); }
  if (!selectedId) saveSettings();
  if (!await runtime) throw new Error("WebAssembly runtime unavailable.");
  checkSelection();
  if ($("fs").checked) await enterFullscreen();
  // SDL3 applies FreeRDP's windowed state with document.exitFullscreen(); the page owns full
  // screen, so ignore programmatic exits (toggleFullscreen and holding Esc still work).
  document.exitFullscreen = () => Promise.resolve();   // likewise for SDL leaving full screen
  // switch to the session layout first (header hidden), let it settle, then measure: the first
  // picture then has exactly the canvas aspect ratio; /dynamic-resolution follows later resizes
  document.body.classList.add("session"); syncHeader();
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const r = $("canvas").getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  const even = (v) => Math.max(2, Math.round(v * dpr / 2) * 2);
  const size = `${even(r.width)}x${even(r.height)}`;
  checkSelection();
  FreeRDPVaultUI.use(host => {
    if (host.direct && !window.directSocketsAvailable) throw new Error("This saved host needs Direct TCP. Install and open the isolated app.");
    const args = FreeRDPVault.connectionArgs(host, size);
    if (host.direct) {
      window.useDirectTcp(); log("[page] direct TCP via Direct Sockets (IWA), no gateway");
    } else {
      const Base = window.WebSocket;
      window.WebSocket = class extends Base {
        send(d) { window.freerdpNet.tx += d.byteLength ?? d.length ?? 0; super.send(d); }
        set onmessage(fn) { super.onmessage = e => { window.freerdpNet.rx += e.data.byteLength ?? 0; fn(e); }; }
        get onmessage() { return super.onmessage; }
      };
    }
    sessionPassword = host.password;
    info.started = Date.now(); info.server = host.host;
    info.transport = host.direct ? "direct TCP (IWA)" : "WebSocket gateway";
    $("go").disabled = true; status("connecting…");
    log("[page] sdl-freerdp " + args.map(a => a.startsWith("/p:") ? "/p:***" : a).join(" "));
    $("pass").value = "";
    placeToolbar(); document.querySelector("details").open = false; $("canvas").focus();
    crash.running = true; crash.userEnded = false; crashStore("running");
    crash.timer = setInterval(() => crashStore("running"), 5000);
    // callMain is one-shot. FreeRDP copies argv into its runtime settings; JS drops its copies.
    handedToWasm = true;
    try { Module.callMain(args); }
    catch (e) { if (e !== "unwind") log("[page] " + e); }
    finally { args.fill(""); sessionPassword = ""; FreeRDPVaultUI.lock(); }
  });
  } catch (e) {
    status(e.message); document.body.classList.remove("session"); syncHeader();
    if (!handedToWasm) { connectStarted = false; $("go").disabled = !runtimeReady; }
  }

}

// The last session ended unexpectedly: offer its log (copy, or show it in the log panel).
(() => {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(CRASH_KEY) || "null"); } catch (e) {}
  if (!saved || saved.state === "clean" || !saved.lines?.length) return;
  const when = new Date(saved.time).toLocaleString();
  const why = saved.reason || (saved.state === "running" ? "the page was closed, reloaded or crashed during the session" : "unknown");
  $("lastlogText").textContent = `The last session ended unexpectedly (${why}, ${when}). Its log is saved in this browser.`;
  $("lastlog").hidden = false;
  const text = `FreeRDP Web: last session ended unexpectedly (${why}, ${when})\n` + saved.lines.join("\n");
  const show = () => { logEl.textContent = text + "\n\n--- current page ---\n" + logEl.textContent; document.querySelector("details").open = true; };
  $("lastlogCopy").onclick = () => navigator.clipboard.writeText(text).then(
    () => { $("lastlogCopy").textContent = "Copied"; }, () => { show(); $("lastlogCopy").textContent = "Shown below"; });
  $("lastlogShow").onclick = show;
  $("lastlogDismiss").onclick = () => { try { localStorage.removeItem(CRASH_KEY); } catch (e) {} $("lastlog").hidden = true; };
})();
$("go").onclick = connect;

// Input diagnostics, OFF by default because keys typed into the remote side can be passwords.
// Enable with ?debugkeys=1; even then only the physical key position is logged, never the
// character, and only for the first few events.
const debugKeys = new URLSearchParams(location.search).get("debugkeys") === "1";
let keyLogs = 0, mouseLogs = 0;
if (debugKeys) {
  window.addEventListener("keydown", (e) => {
    if (!$("go").disabled || keyLogs >= 8) return;
    keyLogs++;
    const named = e.key.length > 1 ? e.key : "(character)";   // "Shift", "Enter", "Process"...
    log(`[input] keydown ${named} keyCode=${e.keyCode} composing=${e.isComposing} target=${e.target.tagName}${e.target.id ? "#" + e.target.id : ""}`);
  }, true);
  window.addEventListener("mousedown", (e) => {
    if (!$("go").disabled || mouseLogs >= 3) return;
    mouseLogs++;
    log(`[input] mousedown button=${e.button} at ${e.clientX},${e.clientY} target=${e.target.tagName}${e.target.id ? "#" + e.target.id : ""}`);
  }, true);
}
fetch(".well-known/manifest.webmanifest").then((r) => r.json()).then((m) => log(`[page] FreeRDP Web ${m.version}`)).catch(() => {});
if (!crossOriginIsolated) log("[page] warning: not cross-origin isolated, threads will not work (serve with COOP/COEP)");
