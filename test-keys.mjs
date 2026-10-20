import { connectTestSession } from "./test-connect.mjs";
// Keyboard fidelity test: types characters like a physical US keyboard (real codes, Shift held for
// capitals/symbols) into `cat > /tmp/keys.txt` in the CI xrdp session, then compares the file.
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
const TEXT = process.argv[2] || "Ab9 xyZ 0123456789 !@#$%^&*() -_=+[]{};:'\",.<>/?\\|`~";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const base = new URL(".chrome/", import.meta.url).pathname;
const profile = mkdtempSync(join(base, "keys-"));
const chrome = spawn("google-chrome", ["--headless=new", "--remote-debugging-port=9340", `--user-data-dir=${profile}`, "--no-first-run",
  "--window-size=1280,900", "--enable-unsafe-swiftshader", "about:blank"], { stdio: "ignore", env: { ...process.env, TMPDIR: base } });
chrome.on("exit", () => { rmSync(profile, { recursive: true, force: true });
  for (const n of readdirSync(base)) if (n.startsWith("com.google.Chrome.")) rmSync(join(base, n), { recursive: true, force: true }); });
let t; for (let i = 0; i < 150 && !t; i++) { await sleep(200); try { t = (await (await fetch("http://127.0.0.1:9340/json")).json()).find((x) => x.type === "page"); } catch {} }
const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const p = new Map();
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && p.has(m.id)) { p.get(m.id)(m.result); p.delete(m.id); } if (m.method === "Runtime.consoleAPICalled") logs.push(m.params.args.map((a) => a.value ?? a.description).join(" ")); });
const logs = [];
const send = (method, params = {}) => new Promise((r) => { const i = ++id; p.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });

// US layout: character -> [code, virtual key, shift]
const shifted = { "!": "Digit1", "@": "Digit2", "#": "Digit3", "$": "Digit4", "%": "Digit5", "^": "Digit6", "&": "Digit7", "*": "Digit8", "(": "Digit9", ")": "Digit0",
  "_": "Minus", "+": "Equal", "{": "BracketLeft", "}": "BracketRight", ":": "Semicolon", '"': "Quote", "<": "Comma", ">": "Period", "?": "Slash", "|": "Backslash", "~": "Backquote" };
const plain = { "-": ["Minus", 189], "=": ["Equal", 187], "[": ["BracketLeft", 219], "]": ["BracketRight", 221], ";": ["Semicolon", 186], "'": ["Quote", 222],
  ",": ["Comma", 188], ".": ["Period", 190], "/": ["Slash", 191], "\\": ["Backslash", 220], "`": ["Backquote", 192], " ": ["Space", 32] };
const vkOf = { Minus: 189, Equal: 187, BracketLeft: 219, BracketRight: 221, Semicolon: 186, Quote: 222, Comma: 188, Period: 190, Slash: 191, Backslash: 220, Backquote: 192 };
function keyFor(ch) {
  if (/[a-z]/.test(ch)) return ["Key" + ch.toUpperCase(), ch.toUpperCase().charCodeAt(0), false];
  if (/[A-Z]/.test(ch)) return ["Key" + ch, ch.charCodeAt(0), true];
  if (/[0-9]/.test(ch)) return ["Digit" + ch, ch.charCodeAt(0), false];
  if (shifted[ch]) { const c = shifted[ch]; return [c, c.startsWith("Digit") ? c.charCodeAt(5) : vkOf[c], true]; }
  if (plain[ch]) return [plain[ch][0], plain[ch][1], false];
  throw new Error("no mapping for " + ch);
}
const press = async (key, code, vk, text, modifiers = 0) => {
  await send("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: vk, text, modifiers });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: vk, modifiers }); };
const typeChar = async (ch) => {
  const [code, vk, shift] = keyFor(ch);
  if (shift) await send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Shift", code: "ShiftLeft", windowsVirtualKeyCode: 16, modifiers: 8 });
  await press(ch, code, vk, ch, shift ? 8 : 0);
  if (shift) await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Shift", code: "ShiftLeft", windowsVirtualKeyCode: 16 });
  await sleep(30);
};
const typeLine = async (s) => { for (const ch of s) await typeChar(ch); await press("Enter", "Enter", 13, "\r"); };

await send("Runtime.enable");
await send("Page.navigate", { url: (process.env.PAGE || "http://127.0.0.1:8080/index.html") + "?v=127.0.0.1:6081&u=test&extra=/gfx&fs=0" });
await connectTestSession(send).catch(e => { chrome.kill(); throw e; });
await sleep(15000);
for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: 300, y: 300, button: "left", clickCount: 1 });
await sleep(400);
if (process.env.RSHIFT_D) {   // Right Shift + D must NOT disconnect (SDL hotkeys are off)
  await send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Shift", code: "ShiftRight", windowsVirtualKeyCode: 16, modifiers: 8 });
  await press("D", "KeyD", 68, "D", 8);
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Shift", code: "ShiftRight", windowsVirtualKeyCode: 16 });
  await press("Backspace", "Backspace", 8, "\b"); await sleep(2000);
}
let stress = null;
if (process.env.CLIP_STRESS) {   // change the browser clipboard every 300 ms while typing
  console.log("grant:", JSON.stringify(await send("Browser.grantPermissions", { origin: "http://127.0.0.1:8080", permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"] })));
  await send("Emulation.setFocusEmulationEnabled", { enabled: true });
  let n = 0;
  stress = setInterval(() => { if (n++ < 40) send("Runtime.evaluate", { expression: `navigator.clipboard.writeText("stress-${n}-" + "x".repeat(2000)).catch(() => {})`, userGesture: true }); }, 300);
}
await typeLine("cat > /tmp/keys.txt");
await sleep(500);
for (let r = 0; r < (process.env.CLIP_STRESS ? 6 : 1); r++) await typeLine(TEXT);
if (stress) clearInterval(stress);
await sleep(300);
// Ctrl+D ends cat
await send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Control", code: "ControlLeft", windowsVirtualKeyCode: 17, modifiers: 2 });
await press("d", "KeyD", 68, "\x04", 2);
await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Control", code: "ControlLeft", windowsVirtualKeyCode: 17 });
await sleep(1500);
if (process.env.CLIP_STRESS) {
  await sleep(3000);
  const r = await send("Runtime.evaluate", { expression: "navigator.clipboard.readText().then(t => t.slice(0, 24), e => 'ERR ' + e.message)", awaitPromise: true, returnByValue: true, userGesture: true });
  console.log("browser clipboard at end:", JSON.stringify(r.result?.value));
  console.log("CLIPLOG\n" + logs.filter((l) => /clip|cliprdr/i.test(l)).slice(-25).join("\n"));
}
ws.close(); chrome.kill();
const all = execFileSync("docker", ["exec", "grd-wasm-xrdp-ci", "sh", "-c", "cat /tmp/keys.txt 2>/dev/null"]).toString().split("\n").filter(Boolean);
if (process.env.CLIP_STRESS) console.log("lines received:", all.length, "all identical:", all.every((l) => l === TEXT));
const got = all[0] ?? "";
console.log("typed   :", JSON.stringify(TEXT));
console.log("received:", JSON.stringify(got));
const diff = [...TEXT].map((c, i) => (got[i] === c ? "." : "^")).join("");
console.log("match   :", got === TEXT ? "EXACT" : "DIFFERENT"); if (got !== TEXT) console.log("          " + diff);
