// Headless Chrome test driver (Chrome DevTools Protocol, no dependencies).
// Usage: node drive-chrome.mjs <url> <seconds> <screenshot.png>
import { spawn } from "node:child_process";
import { readdirSync, rmSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [url, secs = "20", shot = "shot.png"] = process.argv.slice(2);
// short path: Chrome's singleton socket must fit the 107-char Unix socket limit
const base = new URL(".chrome/", import.meta.url).pathname;
const profile = mkdtempSync(join(base, "p-"));
const chrome = spawn("google-chrome", ["--headless=new", "--remote-debugging-port=9333", `--user-data-dir=${profile}`,
  "--no-first-run", "--window-size=1280,900", "--enable-unsafe-swiftshader", "about:blank"], { stdio: "ignore", env: { ...process.env, TMPDIR: base } });
chrome.on("exit", () => {  // remove the profile and Chrome's singleton-socket dir
  rmSync(profile, { recursive: true, force: true });
  for (const n of readdirSync(base)) if (n.startsWith("com.google.Chrome.")) rmSync(join(base, n), { recursive: true, force: true });
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
for (let i = 0; i < 150 && !target; i++) {
  await sleep(200);
  try { target = (await (await fetch("http://127.0.0.1:9333/json")).json()).find((t) => t.type === "page"); } catch {}
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const pending = new Map();
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result ?? m.error); pending.delete(m.id); }
  if (m.method === "Runtime.consoleAPICalled") console.log("[console]", m.params.args.map((a) => a.value ?? a.description).join(" "));
  if (m.method === "Runtime.exceptionThrown") console.log("[exception]", m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
});
await send("Runtime.enable");
await send("Page.enable");
if (process.env.INJECT) await send("Page.addScriptToEvaluateOnNewDocument", { source: (await import("node:fs")).readFileSync(process.env.INJECT, "utf8") });
await send("Page.navigate", { url });
// optional: CLICK_CONNECT=1 presses Connect as a real user gesture (needed for full screen)
if (process.env.CLICK_CONNECT) {
  await sleep(4000);
  await send("Runtime.evaluate", { expression: "document.getElementById('go').click()", userGesture: true });
}
await sleep(Number(secs) * 1000);
// optional: CLICK_INFO=1 opens the connection info overlay before the screenshot
if (process.env.CLICK_INFO) { await send("Runtime.evaluate", { expression: "document.getElementById('tbInfo').click()", userGesture: true }); await sleep(2500); }
// optional input test: TYPE="text" clicks at CLICK_X,CLICK_Y (page px) and types text + Enter
if (process.env.TYPE) {
  const x = Number(process.env.CLICK_X || 300), y = Number(process.env.CLICK_Y || 300);
  for (const type of ["mousePressed", "mouseReleased"])
    await send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
  await sleep(500);
  for (const ch of process.env.TYPE) {
    const code = /[a-z]/i.test(ch) ? "Key" + ch.toUpperCase() : ch === " " ? "Space" : ch === "-" ? "Minus" : "";
    await send("Input.dispatchKeyEvent", { type: "keyDown", key: ch, code, text: ch });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: ch, code });
    await sleep(40);
  }
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", text: "\r", windowsVirtualKeyCode: 13 });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await sleep(3000);
}
const r = await send("Page.captureScreenshot", { format: "png" });
writeFileSync(shot, Buffer.from(r.data, "base64"));
const state = await send("Runtime.evaluate", { expression: "JSON.stringify({isolated: crossOriginIsolated, status: document.getElementById('status').textContent, exit: window.__freerdpExit ?? null, canvas: [document.getElementById('canvas').width, document.getElementById('canvas').height], fullscreen: !!document.fullscreenElement, screen: [screen.width, screen.height, devicePixelRatio], bodyClass: document.body.className, fakeTcp: window.__fakeTcp ?? 0, direct: document.getElementById('direct').checked})", returnByValue: true });
console.log("[state]", state.result?.value);
ws.close(); chrome.kill();
