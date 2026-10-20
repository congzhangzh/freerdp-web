import { connectTestSession } from "./test-connect.mjs";
// Stuck keys after Cmd + Tab (macOS) and the Cmd + letter keyup quirk, against the CI xrdp
// session: which keys does the remote X server hold down after each scenario?
//   A  Cmd down, the window loses focus (macOS took Cmd + Tab), focus comes back
//   B  Cmd + C where the browser never sends C's keyup (macOS does that while Cmd is held)
//   C  Cmd tapped alone: the remote side gets Super down + up (Start menu / Activities)
// The remote key map is read with XQueryKeymap (test-keymap.py, run in the container).
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const base = new URL(".chrome/", import.meta.url).pathname;
const profile = mkdtempSync(join(base, "meta-"));
const chrome = spawn("google-chrome", ["--headless=new", "--remote-debugging-port=9341", `--user-data-dir=${profile}`, "--no-first-run",
  "--window-size=1280,900", "--enable-unsafe-swiftshader", "about:blank"], { stdio: "ignore", env: { ...process.env, TMPDIR: base } });
chrome.on("exit", () => { rmSync(profile, { recursive: true, force: true });
  for (const n of readdirSync(base)) if (n.startsWith("com.google.Chrome.")) rmSync(join(base, n), { recursive: true, force: true }); });
let t; for (let i = 0; i < 150 && !t; i++) { await sleep(200); try { t = (await (await fetch("http://127.0.0.1:9341/json")).json()).find((x) => x.type === "page"); } catch {} }
const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const p = new Map(); const logs = [];
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && p.has(m.id)) { p.get(m.id)(m.result); p.delete(m.id); }
  if (m.method === "Runtime.consoleAPICalled") logs.push(m.params.args.map((a) => a.value).join(" ")); });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; p.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true, userGesture: true })).result.value;
const key = (type, key, code, vk, modifiers = 0) => send("Input.dispatchKeyEvent", { type, key, code, windowsVirtualKeyCode: vk, modifiers });
const META = 4;
// the X display of the newest session; keymap.py prints the keys held down
execFileSync("docker", ["cp", new URL("test-keymap.py", import.meta.url).pathname, "grd-wasm-xrdp-ci:/tmp/keymap.py"]);
const held = () => {
  const displays = execFileSync("docker", ["exec", "grd-wasm-xrdp-ci", "ls", "/tmp/.X11-unix"]).toString().split(/\s+/).filter(Boolean);
  const d = ":" + displays.map((n) => +n.slice(1)).sort((a, b) => b - a)[0];
  return execFileSync("docker", ["exec", "-u", "test", "-e", "XAUTHORITY=/home/test/.Xauthority", "grd-wasm-xrdp-ci", "python3", "/tmp/keymap.py", d]).toString().trim();
};
const report = async (label) => { await sleep(700); const h = held(); console.log(label.padEnd(44), h); return h; };

await send("Runtime.enable");
await send("Page.navigate", { url: (process.env.PAGE || "http://127.0.0.1:8080/index.html") + "?v=127.0.0.1:6081&u=test&extra=/gfx&fs=0" });
await connectTestSession(send).catch(e => { chrome.kill(); throw e; });
await sleep(15000);
for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: 300, y: 300, button: "left", clickCount: 1 });
await report("after connect:");

// A: Cmd down, then macOS takes the Tab: the page only sees Cmd down and a blur
await key("rawKeyDown", "Meta", "MetaLeft", 91, META);
const a1 = await report("A  Cmd held (the page saw only its keydown):");
await ev("window.dispatchEvent(new FocusEvent('blur')), document.dispatchEvent(new Event('visibilitychange')), 1");
const a2 = await report("A  after the window lost focus:");
await ev("window.dispatchEvent(new FocusEvent('focus')), 1");
await key("keyUp", "Meta", "MetaLeft", 91);   // released after coming back, as on a Mac
const a3 = await report("A  focus back, Cmd keyup without keydown:");

// B: Cmd + C, the browser drops C's keyup
await key("rawKeyDown", "Meta", "MetaLeft", 91, META);
await key("rawKeyDown", "c", "KeyC", 67, META);
const b1 = await report("B  Cmd + C held:");
await key("keyUp", "Meta", "MetaLeft", 91);
const b2 = await report("B  Cmd up, C's keyup never came:");

// C: Cmd tapped alone
await key("rawKeyDown", "Meta", "MetaLeft", 91, META); await sleep(50);
await key("keyUp", "Meta", "MetaLeft", 91);
const c1 = await report("C  Cmd tapped alone:");

// B typed a "c" at the shell prompt: clear the line (Ctrl + U) for the next test
await key("rawKeyDown", "Control", "ControlLeft", 17, 2); await key("rawKeyDown", "u", "KeyU", 85, 2);
await key("keyUp", "u", "KeyU", 85, 2); await key("keyUp", "Control", "ControlLeft", 17); await sleep(300);
console.log(logs.filter((l) => /\[page\].*(key|Cmd|Meta)/i.test(l)).join("\n"));
ws.close(); chrome.kill();
const none = (h) => h === "down: []";
const results = { "A: nothing held while Cmd is held alone": process.env.BEFORE ? true : none(a1),
  "A: nothing held after the blur": none(a2), "A: nothing held after focus": none(a3),
  "B: Cmd + C reached the remote side": /Super/.test(b1) && /'c'/.test(b1), "B: nothing held after Cmd up": none(b2),
  "C: nothing held after the tap": none(c1) };
for (const [k, v] of Object.entries(results)) console.log(v ? "PASS" : "FAIL", k);
process.exit(Object.values(results).every(Boolean) ? 0 : 1);
