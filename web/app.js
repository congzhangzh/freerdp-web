// Hosts and settings live in localStorage (hosts.js); the password never does.
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
  if (/The connection failed|ERRCONNECT_|tcp-shim\]/.test(s)) $("logPanel").open = true;
};
const status = (s) => { $("status").textContent = s; };

// ---- the selected host (hosts-ui.js) fills the form; the form's edits go back into it
const HostsUI = window.FreeRDPHostsUI;
// the address field holds a gateway (WebSocket) or, with Direct TCP, the RDP server itself:
// different addresses, kept apart in the host
function showTarget(h) {
  const direct = $("direct").checked;
  $("hostLabel").textContent = direct ? "RDP server" : "Gateway";
  $("host").placeholder = direct ? "rdp-server:3389" : "127.0.0.1:3390";
  $("host").value = direct ? h.directHost : h.host;
}
function showHost(h) {
  $("hostName").value = h.name;
  $("direct").checked = !!window.directSocketsAvailable && h.direct;
  showTarget(h);
  $("user").value = h.user;
  $("pass").value = "";
  $("extra").value = h.extra;
  $("fs").checked = h.fullscreen;
  showSession(h.session);
  updateRoute();
}
// what the form says, into the selected host (passwords never)
function storeFields() {
  const direct = $("direct").checked;
  return HostsUI.update({ name: $("hostName").value.trim() || "Host", [direct ? "directHost" : "host"]: $("host").value.trim(),
    direct, user: $("user").value, extra: $("extra").value, fullscreen: $("fs").checked, session: readSession() });
}
for (const id of ["hostName", "host", "user", "extra"]) $(id).addEventListener("input", storeFields);
$("fs").addEventListener("change", storeFields);
HostsUI.onSelect((h, vaultOnly) => { if (vaultOnly) updateSummary(); else showHost(h); });
const uiPrefs = (() => { try { return JSON.parse(localStorage.getItem("freerdp-web-ui") || "{}"); } catch (e) { return {}; } })();
const saveUiPrefs = () => { try { localStorage.setItem("freerdp-web-ui", JSON.stringify(uiPrefs)); } catch (e) {} };
function loadSettings() {
  showHost(HostsUI.current());
  const q = new URLSearchParams(location.search);   // URL overrides, for testing: the form only
  if (q.get("v")) $("host").value = q.get("v");
  if (q.get("u")) $("user").value = q.get("u");
  if (q.has("extra")) {
    try { $("extra").value = FreeRDPVault.validateOptions(q.get("extra")); }
    catch (e) { q.delete("extra"); log("[page] ignored credential or secret-export options in the URL"); }
  }
  if (q.has("fs")) $("fs").checked = q.get("fs") === "1";
  updateSessionText(); updateRoute();
  $("advancedPanel").open = !!uiPrefs.advancedOpen;
  // Do not accept passwords in URLs: history, referrers and access logs retain them.
  q.delete("p");
  if (q.toString() !== new URLSearchParams(location.search).toString())
    history.replaceState(null, "", location.pathname + (q.size ? "?" + q : "") + location.hash);
  return q.get("autoconnect") === "1";
}

// ---- Session settings: a few plain choices; options.js turns them into FreeRDP options
const radio = (name) => document.querySelector(`input[name=${name}]:checked`)?.value;
const setRadio = (name, value) => { const r = document.querySelector(`input[name=${name}][value="${value}"]`); if (r) r.checked = true; };
function readSession() {
  return FreeRDPOptions.normalize({ audio: $("optAudio").checked, clipboard: $("optClipboard").checked,
    codec: radio("codec"), strategy: radio("strategy") });
}
function showSession(session) {
  const s = FreeRDPOptions.normalize(session);
  $("optAudio").checked = s.audio; $("optClipboard").checked = s.clipboard;
  setRadio("codec", s.codec); setRadio("strategy", s.strategy);
  setRadio("keys", FreeRDPKeyboard.get());
  updateSessionText();
}
const CODEC_HINTS = {
  auto: "The server picks from every codec the client offers (AV1 4:4:4 included).",
  "av1-420": "AV1 with half-resolution colour: less data, slightly soft coloured text.",
  "av1-444": "AV1 with full colour: sharp text in every colour, more data.",
};
const STRATEGY_HINTS = {
  recommended: "The client and the server choose.",
  bandwidth: "For slow links: the server sends less (no wallpaper or animations) and compresses more, which costs it more CPU.",
  server: "For a busy server: it compresses less and sends more data instead.",
};
const KIND_NAMES = { video: "Video", audio: "Sound", clipboard: "Clipboard", network: "Priority", compression: "Priority" };
function updateSessionText() {
  const s = readSession(), extra = $("extra").value;
  $("codecHint").textContent = CODEC_HINTS[s.codec];
  $("strategyHint").textContent = STRATEGY_HINTS[s.strategy];
  // Extra options of the same kind win: say which settings they override
  const over = [...new Set(FreeRDPOptions.overridden(extra).map((k) => KIND_NAMES[k]))];
  const changed = !FreeRDPOptions.isDefault(s);
  $("customNote").hidden = !over.length && !changed;
  $("customText").textContent = over.length ? `Extra options set ${over.join(", ")}: they win over the choice here. `
    : "Changed from the recommended settings. ";
  const label = (name, value) => document.querySelector(`input[name=${name}][value="${value}"]`).parentElement.textContent.trim();
  $("sessionSummary").textContent = over.length ? "custom" : !changed ? "recommended" :
    [s.codec !== "auto" && label("codec", s.codec), s.strategy !== "recommended" && label("strategy", s.strategy),
     !s.audio && "no sound", !s.clipboard && "no clipboard"].filter(Boolean).join(", ");
  $("preview").textContent = FreeRDPOptions.resolve(s, extra).join(" ");
  updateSummary();
}
// the advanced choices in effect, shown under Connect even while Advanced is closed
function updateSummary() {
  const parts = [];
  if ($("direct").checked) parts.push("Direct TCP (installed app), no gateway");
  const h = HostsUI.current();
  if (h.vault) parts.push(h.vaultSaved ? "Password from the passkey vault" : "Passkey vault on, no password saved yet");
  if ($("extra").value.trim()) parts.push("Extra options: " + $("extra").value.trim());
  $("summary").textContent = parts.join(" · ");
}
document.querySelectorAll("#sessionPanel input").forEach((el) => el.addEventListener("change", () => {
  if (el.name === "keys") FreeRDPKeyboard.set(el.value);
  else if (el.id !== "fs") HostsUI.update({ session: readSession() });
  updateSessionText();
}));
$("restoreDefaults").onclick = () => {
  HostsUI.update({ session: { ...FreeRDPOptions.DEFAULTS } });
  showSession(FreeRDPOptions.DEFAULTS);
  if (FreeRDPOptions.overridden($("extra").value).length) $("advancedPanel").open = true;   // what still overrides
};
$("extra").addEventListener("input", updateSessionText);
$("extra").addEventListener("change", updateSessionText);
$("advancedPanel").addEventListener("toggle", () => { uiPrefs.advancedOpen = $("advancedPanel").open; saveUiPrefs(); });
window.addEventListener("storage", (e) => { if (e.key === FreeRDPKeyboard.KEY) setRadio("keys", FreeRDPKeyboard.get()); });

// ---- the one-line SSH command of the safety notice: the local end follows the gateway's
// port; on the server, websockify stays on 3390, next to RDP on 3389
function updateRoute() {
  const m = /^(?:127\.0\.0\.1|localhost|\[::1\]):(\d{1,5})$/.exec($("host").value.trim());
  const port = m ? m[1] : "3390";
  $("hopGateway").textContent = $("direct").checked ? "none (direct TCP)" : $("host").value.trim() || "127.0.0.1:3390";
  $("sshCmd").textContent = `ssh -tt -L 127.0.0.1:${port}:127.0.0.1:3390 ${$("user").value.trim() || "user"}@server websockify 127.0.0.1:3390 127.0.0.1:3389`;
}
$("host").addEventListener("input", updateRoute); $("user").addEventListener("input", updateRoute);
$("copyCmd").onclick = () => navigator.clipboard.writeText($("sshCmd").textContent).then(
  () => { $("copyCmd").textContent = "Copied"; setTimeout(() => { $("copyCmd").textContent = "Copy"; }, 1500); },
  () => { getSelection().selectAllChildren($("sshCmd")); $("copyCmd").textContent = "Press Ctrl+C"; });

// ---- Advanced: direct TCP and the passkey vault
if (window.directSocketsAvailable) $("directHint").textContent = "This installed app can open TCP itself: enter the RDP server, usually host:3389.";
else {
  $("direct").disabled = true;
  // DOM calls, not innerHTML: the installed app enforces Trusted Types and would refuse a string
  const how = Object.assign(document.createElement("a"), { href: "install.html", textContent: "How to install it" });
  $("directHint").replaceChildren("Only in the installed app (Isolated Web App). ", how, ".");
}
$("direct").addEventListener("change", () => {
  storeFields(); showTarget(HostsUI.current());
  updateRoute(); updateSummary();
});

const autoconnect = loadSettings();
updateRoute();
$("canvas").addEventListener("contextmenu", (e) => e.preventDefault());
$("canvas").addEventListener("mousedown", () => $("canvas").focus());
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
    if (code !== 0) $("logPanel").open = true;   // show the reason
    // exit code 0 also follows a lost connection: look at the log, not only at the code
    const lost = crash.lines.some((l) => /ERRCONNECT_|Network disconnect|\[tcp-shim\].*(Error|abort)/i.test(l));
    crashEnd(!crash.userEnded && (code !== 0 || lost), code !== 0 ? "exit code " + code : lost ? "connection lost" : "");
  },
  onAbort(what) { runtimeFailed = true; resolveRuntime(false); HostsUI.lock(); log("[page] aborted: " + what); crashEnd(true, "wasm abort: " + what); },
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
// The page's full screen is not SDL's: SDL 3.2 marks its window full screen on this event and
// from then on ignores resizes, so when the window grows after the event (macOS animates into
// full screen) the remote desktop keeps the old size. Stop the event at the window, before
// SDL's listener on the document; the page handles it here (onFullscreenChange, below).
for (const type of ["fullscreenchange", "webkitfullscreenchange"])
  window.addEventListener(type, (e) => { e.stopImmediatePropagation(); if (type === "fullscreenchange") onFullscreenChange(); }, true);
function onFullscreenChange() {
  if (!document.fullscreenElement) { document.body.classList.remove("fs"); log("[page] left full screen"); }
  $("tbFs").textContent = document.fullscreenElement ? "Window" : "Full screen";
  document.body.classList.toggle("tbhide", !!document.fullscreenElement);
  // The browser fires "resize" before or after "fullscreenchange" (macOS: after), so measure
  // again once the new layout is in place; SDL's handler reads the current sizes, not the event.
  requestAnimationFrame(() => { placeToolbar(); window.dispatchEvent(new Event("resize")); });
}
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
// The mstsc shortcut profile (keyboard.js), on top of FreeRDP's hotkeys. Only while the remote
// desktop has focus; the page takes these keys, so the remote side does not see them. The
// keyup of a taken key is dropped as well.
const takenKeys = new Set();
window.addEventListener("keyup", (e) => {
  if (takenKeys.delete(e.code)) { e.preventDefault(); e.stopImmediatePropagation(); }
}, true);
window.addEventListener("keydown", (e) => {
  if (!document.body.classList.contains("session") || e.target !== $("canvas")) return;
  const act = FreeRDPKeyboard.action(FreeRDPKeyboard.get(), e);
  if (!act) return;
  e.preventDefault(); e.stopImmediatePropagation(); takenKeys.add(e.code);
  if (act === "fullscreen") toggleFullscreen();
  else if (act === "toolbar") showToolbar();
  else if (act === "ctrl-alt-del") {
    // Ctrl and Alt are already down on the remote side: add Delete. SDL reads the key's code.
    for (const type of ["keydown", "keyup"])
      $("canvas").dispatchEvent(new KeyboardEvent(type, { code: "Delete", key: "Delete", ctrlKey: true, altKey: true, bubbles: true }));
    log("[page] Ctrl + Alt + End: sent Ctrl + Alt + Delete");
  }
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
const queueOut = (part) => {
  if (!clipboardOn) return;   // text and image of one copy arrive separately: write them together
  clip.out = Object.assign(clip.out || {}, part);
  clearTimeout(clip.outTimer); clip.outTimer = setTimeout(writeOut, 200);
};
Module.freerdpClipboardWrite = (text) => queueOut({ text });
// The server's image arrives as a CF_DIB, or as PNG when the server offers PNG only (e.g. GNOME
// Remote Desktop for a PNG-only source); a PNG needs no conversion.
Module.freerdpClipboardWriteImage = (bytes, isPng) =>
  (isPng ? Promise.resolve(new Blob([bytes], { type: "image/png" })) : dibToPng(bytes)).then((png) => queueOut({ png }),
    (e) => log("[page] clipboard image from server not decodable: " + e.message));
let clipboardOn = true;   // Session settings: off means -clipboard, and the page bridge stays quiet
async function syncClipboard() {
  if (!clipboardOn || !document.body.classList.contains("session") || !document.hasFocus()) return;
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
$("tbLog").onclick = () => { const d = $("logPanel"); d.open = !d.open; backToCanvas(); };
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
// In full screen the toolbar hides. It comes back when the mouse rests TB_DWELL ms at the top
// edge right above it (a grip marks the spot), not anywhere along the edge: the corners belong
// to the remote desktop (a maximized window's close button, menus). It hides again once the
// mouse moves away from it; shown from the keyboard (Ctrl + Alt + Home), after 2.5 s.
const TB_ZONE = 40, TB_DWELL = 300, TB_AWAY = 60;
let tbTimer = 0, tbAway = 0, tbDwell = 0, pointer = null;
const nearToolbar = (x, y) => { const r = toolbar.getBoundingClientRect();
  return x >= r.left - TB_AWAY && x <= r.right + TB_AWAY && y <= r.bottom + TB_AWAY; };
function hideToolbar() {
  clearTimeout(tbTimer); clearTimeout(tbAway); tbTimer = tbAway = 0;
  if (!document.body.classList.contains("fs") || (pointer && nearToolbar(pointer.x, pointer.y))) return;
  document.body.classList.add("tbhide");
}
function showToolbar(timeout = 2500) {
  document.body.classList.remove("tbhide");
  clearTimeout(tbTimer); tbTimer = timeout ? setTimeout(hideToolbar, timeout) : 0;
}
window.addEventListener("mousemove", (e) => {
  if (!document.body.classList.contains("fs") || document.pointerLockElement) return;
  pointer = { x: e.clientX, y: e.clientY };
  if (!document.body.classList.contains("tbhide")) {
    if (nearToolbar(e.clientX, e.clientY)) { clearTimeout(tbTimer); clearTimeout(tbAway); tbTimer = tbAway = 0; }
    else if (!tbAway) tbAway = setTimeout(hideToolbar, 600);
    return;
  }
  const r = toolbar.getBoundingClientRect();
  if (e.clientY <= 4 && Math.abs(e.clientX - (r.left + r.right) / 2) <= r.width / 2 + TB_ZONE) {
    if (!tbDwell) tbDwell = setTimeout(() => { tbDwell = 0; showToolbar(0); }, TB_DWELL);
  } else { clearTimeout(tbDwell); tbDwell = 0; }
}, true);
// in a window: keep the toolbar at the top of the canvas
const placeToolbar = () => document.documentElement.style.setProperty("--tbtop", Math.max(0, $("canvas").getBoundingClientRect().top) + "px");
window.addEventListener("resize", placeToolbar); window.addEventListener("scroll", placeToolbar);

// the canvas height is "viewport minus header": keep --hdr in sync with the header's height
const syncHeader = () => document.documentElement.style.setProperty("--hdr", document.querySelector("header").offsetHeight + "px");   // 0 when hidden
window.addEventListener("resize", syncHeader); syncHeader();

async function connect() {
  if (connectStarted || runtimeFailed) return;
  try { HostsUI.check(); } catch (e) { status(e.message); return; }
  if (!storeFields()) { status("Fix the host's settings first."); return; }
  const selectedId = HostsUI.selected;
  const checkSelection = () => {
    if (HostsUI.selected !== selectedId) throw new Error("Selected host changed. Connect again to use the current selection.");
    HostsUI.check();
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
  await HostsUI.prepare();   // the vault's passkey, if this host's password is there
  checkSelection();
  if (!await runtime) throw new Error("WebAssembly runtime unavailable.");
  checkSelection();
  if ($("fs").checked) await enterFullscreen();
  // SDL3 applies FreeRDP's windowed state with document.exitFullscreen(); the page owns full
  // screen, so ignore programmatic exits (toggleFullscreen and holding Esc still work).
  document.exitFullscreen = () => Promise.resolve();   // likewise for SDL leaving full screen
  // switch to the session layout first (header hidden), let it settle, then measure: the first
  // picture then has exactly the canvas aspect ratio; /dynamic-resolution follows later resizes
  document.body.classList.add("session"); syncHeader();
  // two frames, or 200 ms: a hidden tab, or one that lost focus to a passkey prompt, may get no
  // frames for a while (the measurement below forces the layout either way)
  await Promise.race([new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
    new Promise((r) => setTimeout(r, 200))]);
  const r = $("canvas").getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  const even = (v) => Math.max(2, Math.round(v * dpr / 2) * 2);
  const size = `${even(r.width)}x${even(r.height)}`, scale = Math.round(dpr * 100);
  checkSelection();
  HostsUI.use(host => {
    if (host.direct && !window.directSocketsAvailable) throw new Error("This saved host needs Direct TCP. Install and open the isolated app.");
    const session = readSession();
    const resolved = { ...host, extra: FreeRDPOptions.resolve(session, host.extra).join(" ") };
    let args;
    try { args = FreeRDPVault.connectionArgs(resolved, size, scale); } finally { resolved.password = ""; }
    clipboardOn = !args.some((a) => /^-clipboard$|^[/+]clipboard:(?:off|false)$/i.test(a));
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
    placeToolbar(); $("logPanel").open = false; $("canvas").focus();
    crash.running = true; crash.userEnded = false; crashStore("running");
    crash.timer = setInterval(() => crashStore("running"), 5000);
    // callMain is one-shot. FreeRDP copies argv into its runtime settings; JS drops its copies.
    handedToWasm = true;
    try { Module.callMain(args); }
    catch (e) { if (e !== "unwind") log("[page] " + e); }
    finally { args.fill(""); sessionPassword = ""; HostsUI.lock(); }
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
  const show = () => { logEl.textContent = text + "\n\n--- current page ---\n" + logEl.textContent; $("logPanel").open = true; };
  $("lastlogCopy").onclick = () => navigator.clipboard.writeText(text).then(
    () => { $("lastlogCopy").textContent = "Copied"; }, () => { show(); $("lastlogCopy").textContent = "Shown below"; });
  $("lastlogShow").onclick = show;
  $("lastlogDismiss").onclick = () => { try { localStorage.removeItem(CRASH_KEY); } catch (e) {} $("lastlog").hidden = true; };
})();
// a submitted form is what tells the browser's password manager to offer saving the password
$("connectForm").addEventListener("submit", (e) => { e.preventDefault(); connect(); });

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
