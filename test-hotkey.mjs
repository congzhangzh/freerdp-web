import { connectTestSession } from "./test-connect.mjs";
// FreeRDP's own hotkey: Right Alt + Right Shift + Enter toggles full screen (page honours SDL's request).
import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const base = new URL(".chrome/", import.meta.url).pathname;
const profile = mkdtempSync(join(base, "hk-"));
const chrome = spawn("google-chrome", ["--headless=new", "--remote-debugging-port=9343", `--user-data-dir=${profile}`, "--no-first-run",
  "--window-size=1280,900", "--enable-unsafe-swiftshader", "about:blank"], { stdio: "ignore", env: { ...process.env, TMPDIR: base } });
chrome.on("exit", () => { rmSync(profile, { recursive: true, force: true });
  for (const n of readdirSync(base)) if (n.startsWith("com.google.Chrome.")) rmSync(join(base, n), { recursive: true, force: true }); });
let t; for (let i = 0; i < 150 && !t; i++) { await sleep(200); try { t = (await (await fetch("http://127.0.0.1:9343/json")).json()).find((x) => x.type === "page"); } catch {} }
const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const p = new Map(); const logs = [];
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && p.has(m.id)) { p.get(m.id)(m.result); p.delete(m.id); }
  if (m.method === "Runtime.consoleAPICalled") logs.push(m.params.args.map((a) => a.value).join(" ")); });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; p.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const state = async (l) => console.log(l, (await send("Runtime.evaluate", { returnByValue: true, expression: "JSON.stringify({fs: !!document.fullscreenElement, canvas: [canvas.width, canvas.height]})" })).result.value);
const hotkey = async () => {
  for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: 600, y: 500, button: "left", clickCount: 1 });
  await send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Alt", code: "AltRight", windowsVirtualKeyCode: 18, modifiers: 1, location: 2 });
  await send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Shift", code: "ShiftRight", windowsVirtualKeyCode: 16, modifiers: 9 });
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r", modifiers: 9 });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, modifiers: 9 });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Shift", code: "ShiftRight", windowsVirtualKeyCode: 16 });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Alt", code: "AltRight", windowsVirtualKeyCode: 18, location: 2 });
};
await send("Runtime.enable");
await send("Page.navigate", { url: (process.env.PAGE || "http://127.0.0.1:8080/index.html") + "?v=127.0.0.1:6081&u=test&extra=/gfx&fs=0" });
await connectTestSession(send).catch(e => { chrome.kill(); throw e; });
await sleep(15000); await state("connected:      ");
await hotkey(); await sleep(5000); await state("after hotkey 1: ");
await hotkey(); await sleep(5000); await state("after hotkey 2: ");
console.log(logs.filter((l) => /\[page\]/.test(l)).slice(-5).join("\n"));
ws.close(); chrome.kill();
