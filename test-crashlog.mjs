import { connectTestSession } from "./test-connect.mjs";
// Crash-log capture: (1) a renderer crash during a session -> the next start shows the notice;
// (2) Disconnect button -> no notice; (3) FreeRDP's Right Shift + D -> no notice.
import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const base = new URL(".chrome/", import.meta.url).pathname;
const profile = mkdtempSync(join(base, "cl-"));
const chrome = spawn("google-chrome", ["--headless=new", "--remote-debugging-port=9344", `--user-data-dir=${profile}`, "--no-first-run",
  "--window-size=1280,900", "--enable-unsafe-swiftshader", "about:blank"], { stdio: "ignore", env: { ...process.env, TMPDIR: base } });
chrome.on("exit", () => { rmSync(profile, { recursive: true, force: true });
  for (const n of readdirSync(base)) if (n.startsWith("com.google.Chrome.")) rmSync(join(base, n), { recursive: true, force: true }); });
const URL_ = "http://127.0.0.1:8080/index.html?v=127.0.0.1:6081&u=test&extra=/gfx&fs=0";
let browser;   // the browser-level DevTools connection creates the tabs
async function cdp(url) {
  const ws = new WebSocket(url); await new Promise((r, e) => { ws.addEventListener("open", r); ws.addEventListener("error", e); });
  let id = 0; const p = new Map();
  ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && p.has(m.id)) { p.get(m.id)(m.result); p.delete(m.id); } });
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; p.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  return { send, close: () => ws.close() };
}
async function tab() {
  if (!browser) {
    let v; for (let i = 0; i < 150 && !v; i++) { await sleep(200); try { v = await (await fetch("http://127.0.0.1:9344/json/version")).json(); } catch {} }
    browser = await cdp(v.webSocketDebuggerUrl);
  }
  const { targetId } = await browser.send("Target.createTarget", { url: "about:blank" });
  return cdp(`ws://127.0.0.1:9344/devtools/page/${targetId}`);
}
const notice = async (t) => (await t.send("Runtime.evaluate", { returnByValue: true,
  expression: "JSON.stringify({shown: !document.getElementById('lastlog').hidden, text: document.getElementById('lastlogText').textContent.slice(0, 110)})" })).result.value;
const restart = async () => { const t = await tab(); await t.send("Page.navigate", { url: "http://127.0.0.1:8080/index.html" }); await sleep(4000); return t; };

// (1) renderer crash during a session
let t = await tab(); await t.send("Page.navigate", { url: URL_ }); await connectTestSession(t.send).catch(e => { chrome.kill(); throw e; }); await sleep(14000);
await t.send("Page.crash").catch(() => {}); t.close(); await sleep(1500);
t = await restart(); console.log("(1) after renderer crash:", await notice(t));
await t.send("Runtime.evaluate", { expression: "document.getElementById('lastlogDismiss').click()" }); t.close();

// (2) Disconnect button
t = await tab(); await t.send("Page.navigate", { url: URL_ }); await connectTestSession(t.send).catch(e => { chrome.kill(); throw e; }); await sleep(14000);
await t.send("Runtime.evaluate", { expression: "document.getElementById('tbQuit').click()" }); await sleep(4000);
console.log("(2) after Disconnect:      ", await notice(t)); t.close();

// (3) Right Shift + D (FreeRDP hotkey)
t = await tab(); await t.send("Page.navigate", { url: URL_ }); await connectTestSession(t.send).catch(e => { chrome.kill(); throw e; }); await sleep(14000);
for (const type of ["mousePressed", "mouseReleased"]) await t.send("Input.dispatchMouseEvent", { type, x: 600, y: 500, button: "left", clickCount: 1 });
await t.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Shift", code: "ShiftRight", windowsVirtualKeyCode: 16, modifiers: 8 });
await t.send("Input.dispatchKeyEvent", { type: "keyDown", key: "D", code: "KeyD", windowsVirtualKeyCode: 68, modifiers: 8 });
await t.send("Input.dispatchKeyEvent", { type: "keyUp", key: "D", code: "KeyD", windowsVirtualKeyCode: 68, modifiers: 8 });
await t.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Shift", code: "ShiftRight", windowsVirtualKeyCode: 16 });
await sleep(4000); t.close();
t = await restart(); console.log("(3) after Right Shift + D: ", await notice(t)); t.close();
chrome.kill();
