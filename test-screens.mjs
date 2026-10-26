import { connectTestSession } from "./test-connect.mjs";
// All screens: two screens set by hand (?screens=, no Window Management API in headless Chrome),
// this window on the first. Checks that the remote desktop grows to span both, that the second
// screen's window shows its part of it, that its mouse and keys reach the server at the right
// place, and that closing it brings the desktop back to one screen. MODE=separate (Session
// settings' default) gives the server a monitor per screen, MODE=span one as wide as both.
//   node test-screens.mjs [out dir]     PAGE, GATEWAY (127.0.0.1:6081), XRDP (grd-wasm-xrdp-ci), MODE
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const out = process.argv[2] || "out";
mkdirSync(out, { recursive: true });
const XRDP = process.env.XRDP || "grd-wasm-xrdp-ci", GATEWAY = process.env.GATEWAY || "127.0.0.1:6081";
const MODE = process.env.MODE || "separate";
const W = 640, H = 480;   // each screen, CSS pixels; the second one is right of the first
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const base = new URL(".chrome/", import.meta.url).pathname;
mkdirSync(base, { recursive: true });
const profile = mkdtempSync(join(base, "scr-"));
const chrome = spawn("google-chrome", ["--headless=new", "--remote-debugging-port=9347", `--user-data-dir=${profile}`, "--no-first-run",
  `--window-size=${W},${H}`, "--enable-unsafe-swiftshader", "about:blank"], { stdio: "ignore", env: { ...process.env, TMPDIR: base } });
chrome.on("exit", () => { rmSync(profile, { recursive: true, force: true });
  for (const n of readdirSync(base)) if (n.startsWith("com.google.Chrome.")) rmSync(join(base, n), { recursive: true, force: true }); });
const targets = async () => (await (await fetch("http://127.0.0.1:9347/json")).json()).filter((x) => x.type === "page");
async function cdp(url) {
  const ws = new WebSocket(url); await new Promise((r) => ws.addEventListener("open", r));
  let id = 0; const p = new Map();
  ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && p.has(m.id)) { p.get(m.id)(m.result); p.delete(m.id); } });
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; p.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true, userGesture: true, awaitPromise: true })).result.value;
  return { ws, send, ev };
}
let t; for (let i = 0; i < 150 && !t; i++) { await sleep(200); try { t = (await targets())[0]; } catch {} }
const main = await cdp(t.webSocketDebuggerUrl);
const display = () => ":" + execFileSync("docker", ["exec", XRDP, "ls", "/tmp/.X11-unix"]).toString().split(/\s+/).filter(Boolean)
  .map((n) => +n.slice(1)).sort((a, b) => b - a)[0];
const remote = (arg) => {
  const d = display();
  return execFileSync("docker", ["exec", "-u", "test", "-e", "XAUTHORITY=/home/test/.Xauthority", XRDP, "python3", "/tmp/keymap.py", d, arg]).toString();
};
execFileSync("docker", ["cp", new URL("test-keymap.py", import.meta.url).pathname, XRDP + ":/tmp/keymap.py"]);
const remoteSize = () => /screen: (\d+) x (\d+)/.exec(remote("--size")).slice(1).map(Number);
// the session's monitors (RandR), as the window manager sees them: "640x480+0+0" each
const remoteMonitors = () => [...execFileSync("docker", ["exec", "-u", "test", "-e", "XAUTHORITY=/home/test/.Xauthority", "-e", "DISPLAY=" + display(), XRDP,
  "xrandr", "--listmonitors"]).toString().matchAll(/(\d+)\/\d+x(\d+)\/\d+([+-]\d+)([+-]\d+)/g)].map((m) => `${m[1]}x${m[2]}${m[3]}${m[4]}`).sort();
const remotePointer = () => /pointer: (\d+) (\d+)/.exec(remote("--pointer")).slice(1).map(Number);
const results = {};
const check = (name, ok, detail = "") => { results[name] = ok; console.log(ok ? "PASS" : "FAIL", name, detail); };
const settle = async (want, ms = 20000) => { let s; for (let t0 = Date.now(); Date.now() - t0 < ms; await sleep(500)) { s = remoteSize(); if (s[0] === want[0] && s[1] === want[1]) break; } return s; };

await main.send("Runtime.enable");
await main.send("Emulation.setFocusEmulationEnabled", { enabled: true });
await main.send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
const page = process.env.PAGE || "http://127.0.0.1:8080/index.html";
const url = new URL(page);   // PAGE may carry its own query, e.g. ?engine=asyncify
for (const [k, v] of Object.entries({ v: GATEWAY, u: "test", extra: "/gfx /log-filters:com.freerdp.channels.disp.client:DEBUG", fs: "1", screens: `${W}x${H}+0+0,${W}x${H}+${W}+0` })) url.searchParams.set(k, v);
await main.send("Page.navigate", { url: url.href });
await connectTestSession(main.send).catch((e) => { chrome.kill(); throw e; });
console.log("client build:", await main.ev("window.freerdpEngine"));
// connected: the display channel is up (the X session's size may be left from an earlier run)
const pageLog = () => main.ev("document.getElementById('log').textContent");
const connected = async (n = 1) => { for (let i = 0; i < 120; i++) { if (((await pageLog()).match(/Loading Dynamic Virtual Channel disp/g) || []).length >= n) break; await sleep(250); } await sleep(2000); };
await connected();
let size = await settle([W, H]);
check("one screen first", size[0] === W && size[1] === H, size.join(" x "));
check("the toolbar offers All screens", await main.ev("!tbScreens.hidden && tbScreens.textContent === 'All screens'"));

await main.ev(`document.querySelector('input[name=screens][value=${MODE}]').checked = true`);
await main.ev("tbScreens.click()");
let popup; for (let i = 0; i < 50 && !popup; i++) { await sleep(200); popup = (await targets()).find((x) => x.url.includes("screen.html")); }
check("a window opens for the second screen", !!popup, popup?.url ?? "");
if (!popup) { chrome.kill(); process.exit(1); }
size = await settle([2 * W, H]);
check("the remote desktop spans both screens", size[0] === 2 * W && size[1] === H, size.join(" x "));
let mons = []; for (let i = 0; i < 20; i++) { mons = remoteMonitors(); if (mons.length === (MODE === "separate" ? 2 : 1)) break; await sleep(500); }
check(MODE === "separate" ? "the server has a monitor for each screen" : "the server has one monitor as wide as both",
  JSON.stringify(mons) === JSON.stringify(MODE === "separate" ? [`${W}x${H}+0+0`, `${W}x${H}+${W}+0`] : [`${2 * W}x${H}+0+0`]), JSON.stringify(mons));
check("the canvas spans both, from this window's left edge",
  await main.ev(`(() => { const r = canvas.getBoundingClientRect(); return r.left === 0 && r.width === ${2 * W} && canvas.width === ${2 * W}; })()`));
// something to see on the second screen only: an xterm on the right half of the remote desktop
execFileSync("docker", ["exec", "-d", "-u", "test", "-e", "DISPLAY=" + display(), XRDP, "xterm", "-geometry", `30x8+${W + 60}+40`, "-e", "sleep", "120"]);
check("Info names both screens", await main.ev("(tbInfo.click(), /^2, (a monitor each|one wide desktop); the desktop spans 1280 × 480/.test([...infoTable.rows].find((r) => r.cells[0].textContent === 'Screens')?.cells[1].textContent))"));

const second = await cdp(popup.webSocketDebuggerUrl);
await second.send("Runtime.enable");
await second.send("Emulation.setFocusEmulationEnabled", { enabled: true });
await second.send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
await sleep(1500);
await sleep(2000);
// its picture is the right half of the canvas, pixel by pixel, and not the left half
const same = await second.ev(`(async () => {
  const src = opener.canvas, mine = document.getElementById("view");   // readable: it keeps its drawing buffer
  const grab = (c, x) => { const o = new OffscreenCanvas(${W}, ${H}); o.getContext("2d").drawImage(c, x, 0, ${W}, ${H}, 0, 0, ${W}, ${H});
    return o.getContext("2d").getImageData(0, 0, ${W}, ${H}).data; };
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const share = (a, b) => { let d = 0; for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 24) d++; return +(d / (a.length / 4)).toFixed(4); };
  const right = grab(src, ${W}), left = grab(src, 0), b = grab(mine, 0);
  return { right: share(right, b), left: share(left, b) };
})()`);
check("the second window shows the right half of the remote desktop", same && same.right < 0.01 && same.left > 0.03, JSON.stringify(same));
writeFileSync(join(out, "screens-main.png"), Buffer.from((await main.send("Page.captureScreenshot", { format: "png" })).data, "base64"));
writeFileSync(join(out, "screens-second.png"), Buffer.from((await second.send("Page.captureScreenshot", { format: "png" })).data, "base64"));

// the mouse: the first click fills the screen and stays local; moves land on the right half
await second.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 100, y: 100 });
for (const type of ["mousePressed", "mouseReleased"]) await second.send("Input.dispatchMouseEvent", { type, x: 100, y: 100, button: "left", clickCount: 1 });
await sleep(500);
for (let i = 0; i <= 10; i++) await second.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 100 + i * 20, y: 100 + i * 10 });
await sleep(800);
let at = remotePointer();
check("a mouse move on the second screen moves the remote pointer there", Math.abs(at[0] - (W + 300)) <= 2 && Math.abs(at[1] - 200) <= 2, at.join(", "));
// a key: held down on the remote side while held here
await second.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Shift", code: "ShiftLeft", windowsVirtualKeyCode: 16, modifiers: 8 });
await sleep(600);
const held = remote("--size");
await second.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Shift", code: "ShiftLeft", windowsVirtualKeyCode: 16 });
await sleep(600);
check("a key pressed on the second screen reaches the server", /Shift_L/.test(held) && !/Shift_L/.test(remote("--size")), held.split("\n")[0]);

// Reconnect while on both screens: the client starts from the settings of its first connect, so
// it has to send the screens' layout again, also when the canvas keeps its size. xrdp 0.10.6.1
// and older drop a layout with the same bounding box (one 1280 x 480 monitor -> two 640 x 480);
// devel since 5376e6de applies it.
if (MODE === "separate") {
  const before = ((await pageLog()).match(/NumMonitors=2/g) || []).length;
  await main.ev("tbReconnect.click()");
  await connected(2);
  let sent = 0; for (let i = 0; i < 20 && sent <= before; i++) { sent = ((await pageLog()).match(/NumMonitors=2/g) || []).length; await sleep(500); }
  check("after Reconnect the client sends a monitor for each screen again", sent > before, `${sent - before} layout(s) of 2`);
  const old = /xrdp 0\.(\d+)\.(\d+)/.exec(execFileSync("docker", ["exec", XRDP, "xrdp", "--version"]).toString());
  const fixed = !old || +old[1] > 10 || (+old[1] === 10 && +old[2] > 6);
  for (let i = 0; i < 20; i++) { mons = remoteMonitors(); if (mons.length === 2) break; await sleep(500); }
  if (fixed) check("and the server has them", mons.length === 2, JSON.stringify(mons));
  else console.log(`NOTE xrdp 0.${old[1]}.${old[2]} keeps ${JSON.stringify(mons)} after Reconnect (fixed in devel, 5376e6de)`);
}

// closing the second window: one screen again
await second.ev("window.close()").catch(() => {});
size = await settle([W, H]);
check("closing it brings the desktop back to one screen", size[0] === W && size[1] === H, size.join(" x "));
for (let i = 0; i < 20 && remoteMonitors().length !== 1; i++) await sleep(500);
check("and to one monitor", JSON.stringify(remoteMonitors()) === JSON.stringify([`${W}x${H}+0+0`]), JSON.stringify(remoteMonitors()));
check("the toolbar offers All screens again", await main.ev("tbScreens.textContent === 'All screens' && !document.body.classList.contains('multi')"));

try { execFileSync("docker", ["exec", "-u", "test", XRDP, "sh", "-c", "kill $(pidof xterm)"]); } catch { /* gone already */ }
writeFileSync(join(out, "screens-page.log"), String(await main.ev("document.getElementById('log').textContent")));
main.ws.close(); chrome.kill();
const failed = Object.entries(results).filter(([, ok]) => !ok).map(([n]) => n);
console.log(failed.length ? `FAILED: ${failed.join("; ")}` : "all passed");
process.exit(failed.length ? 1 : 0);
