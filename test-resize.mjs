import { connectTestSession } from "./test-connect.mjs";
// Window resize test: shrink the viewport during a session, check canvas CSS box vs backing
// size (aspect), and what resolution the server ends up with.
import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const base = new URL(".chrome/", import.meta.url).pathname;
const profile = mkdtempSync(join(base, "rs-"));
const chrome = spawn("google-chrome", ["--headless=new", "--remote-debugging-port=9342", `--user-data-dir=${profile}`, "--no-first-run",
  "--window-size=1280,900", "--enable-unsafe-swiftshader", "about:blank"], { stdio: "ignore", env: { ...process.env, TMPDIR: base } });
chrome.on("exit", () => { rmSync(profile, { recursive: true, force: true });
  for (const n of readdirSync(base)) if (n.startsWith("com.google.Chrome.")) rmSync(join(base, n), { recursive: true, force: true }); });
let t; for (let i = 0; i < 150 && !t; i++) { await sleep(200); try { t = (await (await fetch("http://127.0.0.1:9342/json")).json()).find((x) => x.type === "page"); } catch {} }
const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const p = new Map();
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && p.has(m.id)) { p.get(m.id)(m.result); p.delete(m.id); } });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; p.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const state = async (label) => console.log(label, (await send("Runtime.evaluate", { returnByValue: true, expression:
  "(() => { const c = canvas, r = c.getBoundingClientRect(); return JSON.stringify({ viewport: [innerWidth, innerHeight], cssBox: [r.width|0, r.height|0], backing: [c.width, c.height], cssAspect: (r.width/r.height).toFixed(3), backingAspect: (c.width/c.height).toFixed(3) }); })()" })).result.value);
await send("Page.navigate", { url: (process.env.PAGE || "http://127.0.0.1:8080/index.html") + "?v=127.0.0.1:6081&u=test&extra=/gfx&fs=0" });
await connectTestSession(send).catch(e => { chrome.kill(); throw e; });
await sleep(15000); await state("start:      ");
for (const [w, h] of [[900, 600], [600, 700], [500, 400]]) {
  await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  await sleep(4000); await state(`${w}x${h}:`.padEnd(12));
}
writeFileSync(process.argv[2] || "out/resize.png", Buffer.from((await send("Page.captureScreenshot", { format: "png" })).data, "base64"));
ws.close(); chrome.kill();
