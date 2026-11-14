// The tests' Connect (test-connect.mjs connectTestSession) gets the page into full screen: it clicks
// with Input.dispatchMouseEvent, a click that carries the browser's user activation, which the
// page's full screen request at Connect needs (test-fs-probe.mjs says why). No server: the
// connection goes to a port where nothing listens; full screen comes before it.
//
//   node test-fs-click.mjs <site dir>        e.g. dist/site (./site.sh makes one)
//
// Fails when Connect was not clicked for real, the page is not in full screen after it, or the page
// logged a refusal before it started the client. CHROME=<binary> for another Chrome.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { connectTestSession } from "./test-connect.mjs";

const site = resolve(process.argv[2] || "dist/site"), port = 8249, cdp = 9355;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  (" + detail + ")" : ""}`); if (!ok) fails++; };
if (await fetch(`http://127.0.0.1:${port}/`).then(() => true, () => false)) { console.log(`FAIL  port ${port} is in use`); process.exit(1); }
const server = spawn("python3", [new URL("serve.py", import.meta.url).pathname, String(port), site], { stdio: "ignore" });
const dir = mkdtempSync(join(tmpdir(), "fsc-"));
const chrome = spawn(process.env.CHROME || "google-chrome", ["--headless=new", `--remote-debugging-port=${cdp}`, `--user-data-dir=${dir}/p`, "--no-first-run",
  "--window-size=640,480", "--enable-unsafe-swiftshader", "about:blank"], { stdio: "ignore", env: { ...process.env, TMPDIR: dir } });
const done = (code) => { chrome.kill(); server.kill(); setTimeout(() => { rmSync(dir, { recursive: true, force: true }); process.exit(code); }, 500); };

let version;
for (let i = 0; i < 100 && !version; i++) { await sleep(200); try { version = await (await fetch(`http://127.0.0.1:${cdp}/json/version`)).json(); } catch {} }
if (!version) { console.log("FAIL  Chrome did not start"); done(1); }
console.log("browser:", version.Browser);
const target = (await (await fetch(`http://127.0.0.1:${cdp}/json`)).json()).find((t) => t.type === "page");
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const pend = new Map(), sent = [];
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (pend.has(m.id)) { pend.get(m.id)(m.result ?? m.error); pend.delete(m.id); } });
const send = (method, params = {}) => { sent.push(method); return new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); }); };
const ev = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true }))?.result?.value;

for (let i = 0; i < 50; i++) { await sleep(100); if (await fetch(`http://127.0.0.1:${port}/index.html`).then(() => true, () => false)) break; }
await send("Emulation.setDeviceMetricsOverride", { width: 640, height: 480, deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url: `http://127.0.0.1:${port}/index.html?v=127.0.0.1:9&u=test&fs=1` });
await connectTestSession(send).catch((e) => { console.log("FAIL  connect:", e.message); done(1); });
let fs = false;
for (let i = 0; i < 50 && !fs; i++) { await sleep(100); fs = await ev("!!document.fullscreenElement"); }
// the page's lines up to the client's start: a refusal later (its retry, with no click) is not Connect's
const pageLog = async () => (await ev("document.getElementById('log').textContent")).split("\n");
let log = await pageLog();
for (let i = 0; i < 50 && !log.some((l) => /^\[page\] sdl-freerdp /.test(l)); i++) { await sleep(100); log = await pageLog(); }
const start = log.findIndex((l) => /^\[page\] sdl-freerdp /.test(l)), before = log.slice(0, start < 0 ? log.length : start);
check("Connect is clicked for real (Input.dispatchMouseEvent)", sent.filter((m) => m === "Input.dispatchMouseEvent").length === 3);
check("the page is in full screen after Connect", fs);
check("…and refused nothing before it started the client", !before.some((l) => /full screen refused/.test(l)), before.filter((l) => /full screen/.test(l)).join(" | "));
console.log("INFO ", (log[start] || "the client did not start").slice(0, 120));
console.log(fails ? "FAILED" : "PASSED");
done(fails ? 1 : 0);
