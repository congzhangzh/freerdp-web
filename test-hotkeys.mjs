import { connectTestSession } from "./test-connect.mjs";
// FreeRDP's hotkeys as the Keyboard page sets them, against the CI xrdp session: the page writes
// sdl-freerdp.json into the runtime's file system before main(), and FreeRDP takes it.
//   1. the recommended set: Right Shift + D (a capital D typed with the right hand) keeps the
//      session; Right Alt + Right Shift + D disconnects, and FreeRDP logs that modifier set
//   2. the first session with a set shows it once (a notice under the toolbar)
//   3. the control: Right Shift alone chosen, the same Right Shift + D disconnects
//   PAGE=<the page's URL> (default http://127.0.0.1:8080/index.html), xrdp behind 127.0.0.1:6081
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const base = new URL(".chrome/", import.meta.url).pathname; mkdirSync(base, { recursive: true });
const profile = mkdtempSync(join(base, "hks-"));
const chrome = spawn(process.env.CHROME || "google-chrome", ["--headless=new", "--remote-debugging-port=9347", `--user-data-dir=${profile}`, "--no-first-run",
  "--window-size=1280,900", "--enable-unsafe-swiftshader", "about:blank"], { stdio: "ignore", env: { ...process.env, TMPDIR: base } });
chrome.on("exit", () => { rmSync(profile, { recursive: true, force: true });
  for (const n of readdirSync(base)) if (n.startsWith("com.google.Chrome.")) rmSync(join(base, n), { recursive: true, force: true }); });
let t; for (let i = 0; i < 150 && !t; i++) { await sleep(200); try { t = (await (await fetch("http://127.0.0.1:9347/json")).json()).find((x) => x.type === "page"); } catch {} }
const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const p = new Map(); const logs = [];
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && p.has(m.id)) { p.get(m.id)(m.result); p.delete(m.id); }
  if (m.method === "Runtime.consoleAPICalled") logs.push(m.params.args.map((a) => a.value).join(" ")); });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; p.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true })).result?.value;
let failed = 0;
const check = (name, ok, detail = "") => { if (!ok) failed++; console.log(ok ? "PASS" : "FAIL", name, detail ? ` (${detail})` : "");
  if (!ok) console.log("  last lines:\n  " + logs.slice(-8).join("\n  ")); };
// CDP modifiers: Alt 1, Shift 8; location 2 = the right-hand key
const key = (type, k, code, vk, modifiers, extra = {}) => send("Input.dispatchKeyEvent", { type, key: k, code, windowsVirtualKeyCode: vk, modifiers, ...extra });
async function chord(withAlt, letter = "D") {
  for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: 600, y: 500, button: "left", clickCount: 1 });
  if (withAlt) await key("rawKeyDown", "Alt", "AltRight", 18, 1, { location: 2 });
  const mods = (withAlt ? 1 : 0) | 8;
  await key("rawKeyDown", "Shift", "ShiftRight", 16, mods, { location: 2 });
  const code = "Key" + letter, vk = letter.charCodeAt(0);
  await key("keyDown", letter, code, vk, mods, withAlt ? {} : { text: letter });
  await key("keyUp", letter, code, vk, mods);
  // held a moment, as a hand does: FreeRDP reads the modifiers when its loop gets to the key
  // (SDL_GetModState, not the event's own mod), and a busy loop gets there later
  await sleep(300);
  await key("keyUp", "Shift", "ShiftRight", 16, withAlt ? 1 : 0, { location: 2 });
  if (withAlt) await key("keyUp", "Alt", "AltRight", 18, 0, { location: 2 });
}
// ready: FreeRDP answers the grab hotkey (harmless), so its keys reach the client from now on
async function ready(withAlt) {
  for (let i = 0; i < 15; i++) {
    const before = logs.filter((l) => /pressed, toggling grab state/.test(l)).length;
    await chord(withAlt, "G"); await sleep(1500);
    if (logs.filter((l) => /pressed, toggling grab state/.test(l)).length > before) {
      await chord(withAlt, "G"); await sleep(500);   // the grab back off
      return true;
    }
  }
  return false;
}
const disconnected = () => logs.some((l) => /pressed, disconnecting RDP session/.test(l));
await send("Runtime.enable");
await send("Page.navigate", { url: (process.env.PAGE || "http://127.0.0.1:8080/index.html") + "?v=127.0.0.1:6081&u=test&extra=/gfx&fs=0" });
check("the form shows the hotkeys", /Right Alt \+ Right Shift \+ D disconnect/.test(await (async () => { await sleep(1500); return ev("hotkeyHint.textContent"); })()),
  await ev("hotkeyHint.textContent"));
await connectTestSession(send).catch((e) => { chrome.kill(); throw e; });
await sleep(1500);
check("the first session tells the hotkeys once", await ev("!hotkeyToast.hidden && /Right Alt \\+ Right Shift/.test(hotkeyToast.textContent)"), await ev("hotkeyToast.textContent"));
const written = logs.find((l) => l.startsWith("[page] hotkeys: ")) || "";
check("the page wrote sdl-freerdp.json before main()", /"SDL_KeyModMask":\["KMOD_RALT","KMOD_RSHIFT"\]/.test(written), written);
check("connected, and FreeRDP answers its grab hotkey", await ready(true) && await ev("document.body.classList.contains('session')"), await ev("status.textContent"));
await chord(false); await sleep(3000);
check("Right Shift + D (a capital D) keeps the session", !disconnected() && await ev("document.body.classList.contains('session')"));
await chord(true); await sleep(3000);
const line = logs.find((l) => /pressed, disconnecting RDP session/.test(l)) || "";
check("Right Alt + Right Shift + D disconnects, with FreeRDP's own log of that set", /KMOD_RALT/.test(line) && /KMOD_RSHIFT/.test(line), line);
// 3. the control: with Right Shift alone chosen (FreeRDP's own default), the same Right Shift + D
//    disconnects, so the keys do reach the client and a changed choice is the one it uses
logs.length = 0;
await send("Page.navigate", { url: (process.env.PAGE || "http://127.0.0.1:8080/index.html") + "?v=127.0.0.1:6081&u=test&extra=/gfx&fs=0" });
await sleep(1500);
await ev(`FreeRDPKeyboard.setHotkeys({ modifier: "rshift", keys: FreeRDPKeyboard.DEFAULT_HOTKEYS.keys })`);
await connectTestSession(send).catch((e) => { chrome.kill(); throw e; });
await sleep(1500);
check("a changed choice is told again", await ev("!hotkeyToast.hidden && hotkeyToast.textContent.startsWith(\"FreeRDP's hotkeys: Right Shift + Enter\")"), await ev("hotkeyToast.textContent"));
check("control: FreeRDP answers Right Shift + G", await ready(false));
await chord(false); await sleep(3000);
const control = logs.find((l) => /pressed, disconnecting RDP session/.test(l)) || "";
check("control: with Right Shift alone, Right Shift + D disconnects", /<KMOD_RSHIFT>\+<SDL_SCANCODE_D>/.test(control), control);
ws.close(); chrome.kill();
process.exit(failed ? 1 : 0);
