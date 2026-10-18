// Try to install + launch the IWA (dev-mode proxy) in headless Chrome via CDP, then dump console.
import { spawn } from "node:child_process";
import { readdirSync, rmSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const base = new URL(".chrome/", import.meta.url).pathname;
const profile = mkdtempSync(join(base, "iwa-"));
const chrome = spawn("google-chrome", ["--headless=new", "--remote-debugging-port=9335", `--user-data-dir=${profile}`, "--no-first-run",
  "--enable-features=IsolatedWebApps,IsolatedWebAppDevMode", "--enable-unsafe-swiftshader", "about:blank"],
  { stdio: "ignore", env: { ...process.env, TMPDIR: base } });
chrome.on("exit", () => {  // remove the profile and Chrome's singleton-socket dir
  rmSync(profile, { recursive: true, force: true });
  for (const n of readdirSync(base)) if (n.startsWith("com.google.Chrome.")) rmSync(join(base, n), { recursive: true, force: true });
});
let ver; for (let i = 0; i < 150 && !ver; i++) { await sleep(200); try { ver = await (await fetch("http://127.0.0.1:9335/json/version")).json(); } catch {} }
const conn = (url) => { const ws = new WebSocket(url); let id = 0; const p = new Map(); const ev = [];
  ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && p.has(m.id)) { p.get(m.id)(m); p.delete(m.id); } else ev.push(m); });
  return { ready: new Promise((r) => ws.addEventListener("open", r)), ev, ws,
    send: (method, params = {}, sessionId) => new Promise((r) => { const i = ++id; p.set(i, r); ws.send(JSON.stringify({ id: i, method, params, sessionId })); }) }; };
const b = conn(ver.webSocketDebuggerUrl); await b.ready;
const inst = await b.send("PWA.install", { manifestId: "isolated-app://dummy/", installUrlOrBundleUrl: "http://127.0.0.1:8080/" });
console.log("install:", JSON.stringify(inst.error ?? inst.result));
const targets = await b.send("Target.getTargets"); console.log("targets:", targets.result.targetInfos.map((t) => t.type + " " + t.url).join(" | "));
b.ws.close(); chrome.kill();
