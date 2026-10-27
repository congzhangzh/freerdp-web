import { connectTestSession } from "./test-connect.mjs";
// Mouse and keyboard capture against the CI xrdp session: the toolbar's Capture locks the
// pointer; relative mouse moves move the page's cursor and the remote pointer the same way
// (XQueryPointer in the session, test-keymap.py); Ctrl + Alt + X does not release, a Ctrl + Alt
// tap does; in full screen a click on the remote desktop captures again. Disconnect by FreeRDP's
// hotkey gives the mouse and the keys back by itself.
//   node test-capture.mjs [out dir]     PAGE, GATEWAY (127.0.0.1:6081), XRDP (grd-wasm-xrdp-ci)
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const out = process.argv[2] || "out";
mkdirSync(out, { recursive: true });
const XRDP = process.env.XRDP || "grd-wasm-xrdp-ci", GATEWAY = process.env.GATEWAY || "127.0.0.1:6081";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const base = new URL(".chrome/", import.meta.url).pathname;
const profile = mkdtempSync(join(base, "cap-"));
const chrome = spawn("google-chrome", ["--headless=new", "--remote-debugging-port=9344", `--user-data-dir=${profile}`, "--no-first-run",
  "--window-size=1280,900", "--enable-unsafe-swiftshader", "about:blank"], { stdio: "ignore", env: { ...process.env, TMPDIR: base } });
chrome.on("exit", () => { rmSync(profile, { recursive: true, force: true });
  for (const n of readdirSync(base)) if (n.startsWith("com.google.Chrome.")) rmSync(join(base, n), { recursive: true, force: true }); });
let t; for (let i = 0; i < 150 && !t; i++) { await sleep(200); try { t = (await (await fetch("http://127.0.0.1:9344/json")).json()).find((x) => x.type === "page"); } catch {} }
const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const p = new Map(); const logs = [];
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && p.has(m.id)) { p.get(m.id)(m.result); p.delete(m.id); }
  if (m.method === "Runtime.consoleAPICalled") logs.push(m.params.args.map((a) => a.value).join(" ")); });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; p.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true, userGesture: true })).result.value;
const key = (type, key, code, vk, modifiers = 0) => send("Input.dispatchKeyEvent", { type, key, code, windowsVirtualKeyCode: vk, modifiers });
let mouse = { x: 300, y: 300 };
const move = async (x, y) => { mouse = { x, y }; await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y }); };
const click = async (x, y) => { await move(x, y);
  for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 }); };
execFileSync("docker", ["cp", new URL("test-keymap.py", import.meta.url).pathname, XRDP + ":/tmp/keymap.py"]);
const remote = () => {
  const displays = execFileSync("docker", ["exec", XRDP, "ls", "/tmp/.X11-unix"]).toString().split(/\s+/).filter(Boolean);
  const d = ":" + displays.map((n) => +n.slice(1)).sort((a, b) => b - a)[0];
  const o = execFileSync("docker", ["exec", "-u", "test", "-e", "XAUTHORITY=/home/test/.Xauthority", XRDP, "python3", "/tmp/keymap.py", d, "--pointer"]).toString();
  return /pointer: (\d+) (\d+)/.exec(o).slice(1).map(Number);
};
const page = async () => JSON.parse(await ev(`JSON.stringify({ locked: document.pointerLockElement === canvas,
  captured: document.body.classList.contains("captured"), cursor: [Math.round(cap.x), Math.round(cap.y)], drawn: !vcursor.hidden,
  backing: [canvas.width, canvas.height], css: [canvas.clientWidth, canvas.clientHeight] })`));
const results = {};
const check = (name, ok) => { results[name] = ok; console.log(ok ? "PASS" : "FAIL", name); };

await send("Runtime.enable");
await send("Emulation.setFocusEmulationEnabled", { enabled: true });
await send("Page.navigate", { url: (process.env.PAGE || "http://127.0.0.1:8080/index.html") + "?v=" + GATEWAY + "&u=test&extra=/gfx&fs=0" });
await connectTestSession(send).catch(e => { chrome.kill(); throw e; });
await sleep(15000);
await click(300, 300); await sleep(300);

// Capture from the toolbar
const tb = JSON.parse(await ev("JSON.stringify(tbCapture.getBoundingClientRect())"));
await click(tb.x + tb.width / 2, tb.y + tb.height / 2); await sleep(500);
let s = await page(); console.log("after Capture:", JSON.stringify(s));
check("Capture locks the pointer", s.locked && s.captured && s.drawn);
const scale = s.backing[0] / s.css[0];   // remote pixels per CSS pixel
const start = s.cursor, r0 = remote(); console.log("page cursor", start, "remote pointer", r0);
// relative moves: Chrome derives movementX/Y from consecutive positions
for (let i = 0; i < 10; i++) await move(mouse.x + 12, mouse.y + 7);
await sleep(600);
s = await page(); const r1 = remote(); console.log("after +120, +70: page cursor", s.cursor, "remote pointer", r1);
check("the page cursor moved by the relative motion", s.cursor[0] - start[0] === 120 && s.cursor[1] - start[1] === 70);
check("the remote pointer is at the page cursor", Math.abs(r1[0] - s.cursor[0] * scale) <= 2 && Math.abs(r1[1] - s.cursor[1] * scale) <= 2);
for (let i = 0; i < 20; i++) await move(mouse.x - 200, mouse.y - 200);
await sleep(400); s = await page();
check("the page cursor stops at the remote desktop's edge", s.cursor[0] === 0 && s.cursor[1] === 0);
writeFileSync(join(out, "capture.png"), Buffer.from((await send("Page.captureScreenshot", { format: "png" })).data, "base64"));

// Ctrl + Alt + X does not release; a Ctrl + Alt tap does
await key("rawKeyDown", "Control", "ControlLeft", 17, 2); await key("rawKeyDown", "Alt", "AltLeft", 18, 3);
await key("rawKeyDown", "x", "KeyX", 88, 3); await key("keyUp", "x", "KeyX", 88, 3);
await key("keyUp", "Alt", "AltLeft", 18, 2); await key("keyUp", "Control", "ControlLeft", 17); await sleep(300);
check("Ctrl + Alt + X keeps the capture", (await page()).locked);
// AltGr as Windows reports it: Ctrl + right Alt
await key("rawKeyDown", "Control", "ControlLeft", 17, 2); await key("rawKeyDown", "AltGraph", "AltRight", 18, 3);
await key("keyUp", "AltGraph", "AltRight", 18, 2); await key("keyUp", "Control", "ControlLeft", 17); await sleep(300);
check("Ctrl + right Alt (AltGr) keeps the capture", (await page()).locked);
await key("rawKeyDown", "Control", "ControlLeft", 17, 2); await key("rawKeyDown", "Alt", "AltLeft", 18, 3);
await key("keyUp", "Alt", "AltLeft", 18, 2); await key("keyUp", "Control", "ControlLeft", 17); await sleep(500);
s = await page(); console.log("after Ctrl + Alt:", JSON.stringify(s));
check("a Ctrl + Alt tap releases", !s.locked && !s.captured && !s.drawn);

// full screen: a click on the remote desktop captures
await ev("tbFs.click(), 1"); await sleep(3000);
await click(400, 300); await sleep(500);
s = await page(); console.log("full screen, after a click:", JSON.stringify(s));
check("in full screen a click captures", s.locked && s.captured);
check("the grip is hidden while captured", (await ev("getComputedStyle(tbGrip).display")) === "none");
await key("rawKeyDown", "Control", "ControlLeft", 17, 2); await key("rawKeyDown", "Alt", "AltLeft", 18, 3);
await key("keyUp", "Alt", "AltLeft", 18, 2); await key("keyUp", "Control", "ControlLeft", 17); await sleep(500);
s = await page();
check("Ctrl + Alt releases in full screen, which stays", !s.locked && !s.captured && (await ev("!!document.fullscreenElement")));

// captured again, then FreeRDP's Disconnect hotkey (Right Alt + Right Shift + D, the default):
// a session ended on purpose; the mouse and the keys come back without a Ctrl + Alt
await click(400, 300); await sleep(500);
s = await page();
check("captured again before Disconnect", s.locked && s.captured);
const chord = async () => {
  await send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Alt", code: "AltRight", windowsVirtualKeyCode: 18, modifiers: 1, location: 2 });
  await send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Shift", code: "ShiftRight", windowsVirtualKeyCode: 16, modifiers: 9, location: 2 });
  await send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "D", code: "KeyD", windowsVirtualKeyCode: 68, modifiers: 9 });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "D", code: "KeyD", windowsVirtualKeyCode: 68, modifiers: 9 });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Shift", code: "ShiftRight", windowsVirtualKeyCode: 16, modifiers: 1, location: 2 });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Alt", code: "AltRight", windowsVirtualKeyCode: 18, location: 2 });
};
// FreeRDP sees the chord on its next event loop, which a busy machine can delay; press it again
// if it has not been seen after 10 s
const disconnecting = () => logs.some((l) => /pressed, disconnecting RDP session/.test(l));
for (let n = 0; n < 3 && !disconnecting(); n++) { await chord(); for (let i = 0; i < 20 && !disconnecting(); i++) await sleep(500); }
check("Disconnect by the hotkey disconnects", disconnecting());
const t0 = Date.now(); for (let i = 0; i < 10; i++) { const q = await page(); if (!q.locked && !q.captured && !q.drawn) break; await sleep(500); }
s = await page(); console.log(`after Disconnect (${Date.now() - t0} ms):`, JSON.stringify(s));
check("and the mouse and the keys are released by themselves", !s.locked && !s.captured && !s.drawn);
let exited = false; for (let i = 0; i < 60 && !exited; i++) { await sleep(500); exited = logs.some((l) => /\[page\] exit code/.test(l)); }
console.log(exited ? "the client exited after Disconnect" : "NOTE the client had not exited 30 s after Disconnect");

console.log(logs.filter((l) => /\[page\].*(captur|releas|lock|exit|session)|disconnecting|ERRINFO|ERRCONNECT/i.test(l)).join("\n"));
ws.close(); chrome.kill();
process.exit(Object.values(results).every(Boolean) ? 0 : 1);
