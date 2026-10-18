import { connectTestSession } from "./test-connect.mjs";
// UI test: page inputs editable during a session, remote typing, Right Shift + Enter full screen
// with dynamic resolution. Uses the CI xrdp (websockify 6081). Usage: node test-ui.mjs <outdir>
import { spawn } from "node:child_process";
import { readdirSync, rmSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const out = process.argv[2] || ".";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const base = new URL(".chrome/", import.meta.url).pathname;
const profile = mkdtempSync(join(base, "ui-"));
const chrome = spawn("google-chrome", ["--headless=new", "--remote-debugging-port=9336", `--user-data-dir=${profile}`,
  "--no-first-run", "--window-size=1280,900", "--enable-unsafe-swiftshader", "about:blank"], { stdio: "ignore", env: { ...process.env, TMPDIR: base } });
chrome.on("exit", () => {  // remove the profile and Chrome's singleton-socket dir
  rmSync(profile, { recursive: true, force: true });
  for (const n of readdirSync(base)) if (n.startsWith("com.google.Chrome.")) rmSync(join(base, n), { recursive: true, force: true });
});
let t; for (let i = 0; i < 150 && !t; i++) { await sleep(200); try { t = (await (await fetch("http://127.0.0.1:9336/json")).json()).find((x) => x.type === "page"); } catch {} }
const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const p = new Map(); const logs = [];
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && p.has(m.id)) { p.get(m.id)(m.result); p.delete(m.id); }
  if (m.method === "Runtime.consoleAPICalled") logs.push(m.params.args.map((a) => a.value).join(" ")); });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; p.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true, userGesture: true })).result.value;
const key = async (k, code, text, vk) => { await send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, text, windowsVirtualKeyCode: vk });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk }); };
const typeText = async (s) => { for (const ch of s) await key(ch, /[a-z]/i.test(ch) ? "Key" + ch.toUpperCase() : ch === " " ? "Space" : "", ch); };
const shot = async (name) => writeFileSync(join(out, name), Buffer.from((await send("Page.captureScreenshot", { format: "png" })).data, "base64"));

await send("Runtime.enable"); await send("Page.enable");
await send("Page.navigate", { url: "http://127.0.0.1:8080/index.html?v=127.0.0.1:6081&u=test&extra=/gfx&fs=0" });
await connectTestSession(send).catch(e => { chrome.kill(); throw e; });
await sleep(16000);
console.log("canvas before:", await ev("JSON.stringify([canvas.width, canvas.height, canvas.getBoundingClientRect().width|0, canvas.getBoundingClientRect().height|0])"));
// 1) remote typing
await send("Input.dispatchMouseEvent", { type: "mousePressed", x: 300, y: 300, button: "left", clickCount: 1 });
await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: 300, y: 300, button: "left", clickCount: 1 });
await sleep(400); await typeText("echo remote ok"); await key("Enter", "Enter", "\r", 13); await sleep(2500);
await shot("ui-1-remote.png");
// 2) page input box during the session
await ev("document.getElementById('extra').focus()"); await typeText("abc"); await sleep(300);
console.log("extra field after typing abc:", JSON.stringify(await ev("document.getElementById('extra').value")));
// 3) Right Shift + Enter -> full screen, dynamic resolution
await ev("canvas.focus()");
await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Shift", code: "ShiftRight", windowsVirtualKeyCode: 16, modifiers: 8 });
await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, modifiers: 8 });
await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, modifiers: 8 });
await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Shift", code: "ShiftRight", windowsVirtualKeyCode: 16 });
await sleep(6000);
console.log("after RShift+Enter:", await ev("JSON.stringify({fullscreen: !!document.fullscreenElement, body: document.body.className, canvas: [canvas.width, canvas.height], screen: [screen.width, screen.height]})"));
await shot("ui-3-fullscreen.png");
console.log(logs.filter((l) => /\[page\]|\[input\]|error|ERROR/.test(l)).slice(-12).join("\n"));
ws.close(); chrome.kill();
