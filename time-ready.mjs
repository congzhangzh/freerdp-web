// Time from navigation to "ready" (Connect button enabled) in headless Chrome.
import { spawn } from "node:child_process";
import { readdirSync, rmSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
const url = process.argv[2]; const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const base = new URL(".chrome/", import.meta.url).pathname;
const profile = mkdtempSync(join(base, "t-"));
const chrome = spawn("google-chrome", ["--headless=new", "--remote-debugging-port=9337", `--user-data-dir=${profile}`, "--no-first-run", "about:blank"], { stdio: "ignore", env: { ...process.env, TMPDIR: base } });
chrome.on("exit", () => {  // remove the profile and Chrome's singleton-socket dir
  rmSync(profile, { recursive: true, force: true });
  for (const n of readdirSync(base)) if (n.startsWith("com.google.Chrome.")) rmSync(join(base, n), { recursive: true, force: true });
});
let t; for (let i = 0; i < 150 && !t; i++) { await sleep(200); try { t = (await (await fetch("http://127.0.0.1:9337/json")).json()).find((x) => x.type === "page"); } catch {} }
const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const p = new Map(); ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && p.has(m.id)) { p.get(m.id)(m.result); p.delete(m.id); } });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; p.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
for (const run of [1, 2]) {
  const t0 = Date.now(); await send("Page.navigate", { url: url + (url.includes("?") ? "&" : "?") + "r=" + run });
  let ready = false; while (!ready && Date.now() - t0 < 60000) { await sleep(100);
    ready = (await send("Runtime.evaluate", { expression: "document.getElementById('status')?.textContent === 'ready'", returnByValue: true })).result?.value; }
  console.log(`run ${run}: ready after ${((Date.now() - t0) / 1000).toFixed(2)} s`);
}
ws.close(); chrome.kill();
