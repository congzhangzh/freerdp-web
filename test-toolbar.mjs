import { connectTestSession } from "./test-connect.mjs";
// Toolbar test with real mouse events: Full screen -> remote resize -> top edge reveal -> Window.
import { spawn } from "node:child_process";
import { readdirSync, rmSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const out = process.argv[2] || "."; const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const base = new URL(".chrome/", import.meta.url).pathname;
const profile = mkdtempSync(join(base, "tb-"));
const chrome = spawn("google-chrome", ["--headless=new", "--remote-debugging-port=9338", `--user-data-dir=${profile}`,
  "--no-first-run", "--window-size=1280,900", "--enable-unsafe-swiftshader", "about:blank"], { stdio: "ignore", env: { ...process.env, TMPDIR: base } });
chrome.on("exit", () => {  // remove the profile and Chrome's singleton-socket dir
  rmSync(profile, { recursive: true, force: true });
  for (const n of readdirSync(base)) if (n.startsWith("com.google.Chrome.")) rmSync(join(base, n), { recursive: true, force: true });
});
let t; for (let i = 0; i < 150 && !t; i++) { await sleep(200); try { t = (await (await fetch("http://127.0.0.1:9338/json")).json()).find((x) => x.type === "page"); } catch {} }
const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const p = new Map(); const logs = [];
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && p.has(m.id)) { p.get(m.id)(m.result); p.delete(m.id); }
  if (m.method === "Runtime.consoleAPICalled") logs.push(m.params.args.map((a) => a.value).join(" ")); });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; p.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expression, awaitPromise = false) => (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise, userGesture: true })).result.value;
const click = async (sel) => { const r = JSON.parse(await ev(`JSON.stringify(document.querySelector('${sel}').getBoundingClientRect())`));
  const x = r.x + r.width / 2, y = r.y + r.height / 2;
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 }); };
const state = async (label) => console.log(label, await ev("JSON.stringify({fs: !!document.fullscreenElement, cls: document.body.className, canvas: [canvas.width, canvas.height], btn: tbFs.textContent, tbOpacity: getComputedStyle(toolbar).opacity})"));
await send("Runtime.enable"); await send("Page.enable");
await send("Page.navigate", { url: (process.env.PAGE || "http://127.0.0.1:8080/index.html") + "?v=127.0.0.1:6081&u=test&extra=/gfx&fs=0" });
await connectTestSession(send).catch(e => { chrome.kill(); throw e; });
await sleep(15000); await state("connected:");
await click("#tbFs"); await sleep(6000); await state("after Full screen click:");
writeFileSync(join(out, "tb-fs.png"), Buffer.from((await send("Page.captureScreenshot", { format: "png" })).data, "base64"));
const move = (x, y) => send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
// the corners of the top edge are the remote desktop's: no toolbar there
await move(795, 1); await sleep(700); await state("mouse in the top right corner (hidden):");
await move(5, 1); await sleep(700); await state("mouse in the top left corner (hidden):");
// above the toolbar it comes back after a short rest, and hides once the mouse moves away
await move(400, 1); await sleep(100); await state("mouse above the toolbar, 100 ms (still hidden):");
await sleep(400); await state("mouse above the toolbar, 500 ms (shown):");
console.log("grip shown while hidden:", await ev("getComputedStyle(tbGrip).display"));
await move(400, 400); await sleep(1000); await state("mouse moved away (hidden):");
console.log("grip shown while hidden:", await ev("getComputedStyle(tbGrip).display"));
await move(400, 1); await sleep(500);
await click("#tbFs"); await sleep(6000); await state("after Window click:");
// pinned toolbar must stay visible in full screen; SDL-style canvas requests must be ignored
await click("#tbPin"); await click("#tbFs"); await sleep(4000); await state("pinned + full screen:");
await click("#tbFs"); await sleep(1500);
console.log("canvas.requestFullscreen():", await ev("canvas.requestFullscreen().then(() => 'resolved, fullscreen=' + !!document.fullscreenElement)", true));
await click("#tbPin");
console.log(logs.filter((l) => /\[page\]/.test(l)).join("\n"));
ws.close(); chrome.kill();
