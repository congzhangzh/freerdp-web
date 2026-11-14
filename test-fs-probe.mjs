// Does a click in headless Chrome let the page go full screen? The page asks at Connect (app.js
// enterFullscreen), and the tests click Connect through the DevTools protocol (test-connect.mjs).
// On Chrome 157 (2026-11, the runner image ubuntu24/20261111.370) a click made by Runtime.evaluate
// with userGesture no longer let the page go full screen (asked after awaits, at Connect): the page logged "full
// screen refused: not granted", stayed windowed and every All screens test measured 602 x 456
// instead of 640 x 480 (kit round 43542667639). A real click (Input.dispatchMouseEvent) does carry it.
// Self-contained (node >= 22, no packages, no client): a page whose button asks for full screen, in
// headless Chrome as the tests start it (--headless=new, 640 x 480), clicked by script, for real and not
// at all, the request made at once or after an await.
//
//   node test-fs-probe.mjs [chrome binary, default google-chrome]
//
// Fails when the real click is refused, or a request with no click at all is granted (then this
// test says nothing). The script click's answer is printed: refused on 157, granted on 156.
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = process.argv[2] || "google-chrome", PORT = 8247, CDP = 9353;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const html = `<!doctype html><meta charset="utf-8"><title>fs probe</title>
<button id="go" style="position:absolute;left:100px;top:100px;width:200px;height:60px">Connect</button>
<script>window.result = null;
document.getElementById("go").addEventListener("click", async () => {
  // ?delay=<ms>: ask after an await, as the page does at Connect (audio, the passkey, the runtime)
  const delay = Number(new URLSearchParams(location.search).get("delay")) || 0;
  if (delay) await new Promise((r) => setTimeout(r, delay));
  const active = navigator.userActivation ? navigator.userActivation.isActive : "?";
  document.documentElement.requestFullscreen({ navigationUI: "hide" })
    .then(() => { window.result = "granted (activation " + active + ")"; document.exitFullscreen(); },
          (e) => { window.result = "refused " + e.name + ": " + e.message + " (activation " + active + ")"; });
});</script>`;
const server = createServer((q, s) => { s.writeHead(200, { "content-type": "text/html" }); s.end(html); }).listen(PORT, "127.0.0.1");
const dir = mkdtempSync(join(tmpdir(), "fsp-"));
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${CDP}`, `--user-data-dir=${dir}/p`, "--no-first-run",
  "--window-size=640,480", "--enable-unsafe-swiftshader", "about:blank"], { stdio: "ignore", env: { ...process.env, TMPDIR: dir } });
const done = (code) => { chrome.kill(); server.close(); setTimeout(() => { rmSync(dir, { recursive: true, force: true }); process.exit(code); }, 500); };

let version;
for (let i = 0; i < 100 && !version; i++) { await sleep(200); try { version = await (await fetch(`http://127.0.0.1:${CDP}/json/version`)).json(); } catch {} }
if (!version) { console.log("Chrome did not start"); done(1); }
console.log("browser:", version.Browser);
const browserWs = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((r) => browserWs.addEventListener("open", r));
let id = 0; const pend = new Map();
browserWs.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
const send = (method, params = {}, sessionId) => new Promise((r) => { const i = ++id; pend.set(i, r); browserWs.send(JSON.stringify({ id: i, method, params, sessionId })); });

async function attempt(name, { grant = null, real = false, none = false, delay = 0 }) {
  const { result: { targetId } } = await send("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId } } = await send("Target.attachToTarget", { targetId, flatten: true });
  const s = (m, p) => send(m, p, sessionId);
  await s("Emulation.setDeviceMetricsOverride", { width: 640, height: 480, deviceScaleFactor: 1, mobile: false });
  let granted = "";
  if (grant) { const g = await send("Browser.setPermission", { permission: { name: grant, ...(grant === "fullscreen" && { allowWithoutGesture: true }) }, setting: "granted", origin: `http://127.0.0.1:${PORT}` }); granted = g.error ? ` [setPermission ${grant}: ${g.error.message}]` : ` [setPermission ${grant}: ok]`; }
  await s("Page.navigate", { url: `http://127.0.0.1:${PORT}/?delay=${delay}` }); await sleep(800);
  if (real) for (const type of ["mouseMoved", "mousePressed", "mouseReleased"])
    await s("Input.dispatchMouseEvent", { type, x: 200, y: 130, button: type === "mouseMoved" ? "none" : "left", clickCount: 1 });
  else await s("Runtime.evaluate", { expression: "document.getElementById('go').click()", userGesture: !none });
  let r = null;
  for (let i = 0; i < 30 && !r; i++) { await sleep(100); r = (await s("Runtime.evaluate", { expression: "window.result", returnByValue: true })).result?.result?.value; }
  console.log(`      ${name.padEnd(52)} ${r ?? "no answer in 3 s"}${granted}`);
  await send("Target.closeTarget", { targetId });
  return r ?? "";
}
const old = await attempt("the click by script (Runtime.evaluate, userGesture)", {});
const real = await attempt("a real click (Input.dispatchMouseEvent)", { real: true });
const oldLate = await attempt("the click by script, asked 300 ms later", { delay: 300 });
const realLate = await attempt("a real click, asked 300 ms later", { real: true, delay: 300 });
const none = await attempt("no click at all (the control)", { none: true });
let fails = 0;
const check = (name, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); if (!ok) fails++; };
check("a real click gets full screen", /^granted/.test(real));
check("…also when asked after an await, as the page asks at Connect", /^granted/.test(realLate));
check("no click at all does not (else this test says nothing)", /^refused/.test(none));
for (const [what, r] of [["at once", old], ["300 ms later", oldLate]]) console.log(`INFO  the click by script, ${what}: ${/^granted/.test(r) ? "granted" : "refused"}`);
console.log(fails ? "FAILED" : "PASSED");
done(fails ? 1 : 0);
