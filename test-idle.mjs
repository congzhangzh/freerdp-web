// A server that is silent when idle is never taken for a dead one (#369): log in, touch nothing
// for IDLE seconds (default 180) and check the page did not close the connection. xrdp at rest
// sends nothing at all (no heartbeat, no round trip requests), and the page's watchdog
// (dead-watch.js) must only act on a server it has heard talking unprompted.
//
//   PAGE=http://localhost:8080/index.html GATEWAY=127.0.0.1:6081 node test-idle.mjs [out dir]
//
// Prints how many messages the server sent in each 10 s of the idle time. Fails when no session
// starts, the page says it closed a dead connection, its socket closed or another was opened, or
// the Reconnecting bar shows. USER_NAME and PASSWORD pick the login (test / test), EXTRA the
// session's FreeRDP options, CHROME another Chrome or Chromium.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { connectTestSession } from "./test-connect.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PAGE = process.env.PAGE || "http://localhost:8080/index.html", GATEWAY = process.env.GATEWAY || "127.0.0.1:6081";
const IDLE = Number(process.env.IDLE) || 180, port = 9348;
const base = new URL(".chrome/", import.meta.url).pathname;
mkdirSync(base, { recursive: true });
const profile = mkdtempSync(join(base, "idle-"));
const chrome = spawn(process.env.CHROME || "google-chrome", ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
  "--no-first-run", "--window-size=1280,900", "--enable-unsafe-swiftshader", "about:blank"], { stdio: "ignore", env: { ...process.env, TMPDIR: base } });
chrome.on("exit", () => { rmSync(profile, { recursive: true, force: true });
  for (const n of readdirSync(base)) if (n.startsWith("com.google.Chrome.")) rmSync(join(base, n), { recursive: true, force: true }); });
let fails = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  (" + detail + ")" : ""}`); if (!ok) fails++; };
const done = (code) => { chrome.kill(); process.exit(code); };
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => done(1));

let target;
for (let i = 0; i < 150 && !target; i++) { await sleep(200); try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page"); } catch {} }
if (!target) { console.error("Chrome did not start"); done(1); }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const pending = new Map(), logs = [];
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result ?? m.error); pending.delete(m.id); }
  if (m.method === "Runtime.consoleAPICalled") logs.push(m.params.args.map((a) => a.value).join(" "));
});
const ev = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true, userGesture: true, awaitPromise: true }))?.result?.value;

await send("Runtime.enable");
await send("Page.navigate", { url: `${PAGE}?v=${GATEWAY}&u=${process.env.USER_NAME || "test"}&extra=${encodeURIComponent(process.env.EXTRA || "/gfx:AV2:off")}&fs=0` });
await connectTestSession(send, { password: process.env.PASSWORD || "test" }).catch((e) => { console.error(e, "\n" + logs.slice(-20).join("\n")); done(1); });
let session = false;
for (let i = 0; i < 60 && !session; i++) { await sleep(500); session = await ev("document.body.classList.contains('session') && !!document.getElementById('canvas').width"); }
check("a session started", session);
if (!session) { console.log(logs.slice(-25).join("\n")); done(1); }

// the client's sockets as the page tracks them (app.js trackSockets): one, open
const state = () => ev(`window.__idleFirst ??= [...sockets][0]; JSON.stringify({ n: sockets.size, same: sockets.has(window.__idleFirst), open: [...sockets].filter((s) => s.readyState === 1).length,
  messages: [...sockets].reduce((n, s) => n + (s.messages || 0), 0), bar: !document.getElementById("endBar").hidden,
  dead: document.getElementById("log").textContent.split("\\n").filter((l) => /no message from the server/.test(l)) })`).then(JSON.parse);
await sleep(5000);   // the login's own traffic settles
const first = await state();
console.log("INFO  at the start of the idle time", JSON.stringify(first));
const per10 = [];
let last = first.messages;
for (let t = 0; t < IDLE; t += 10) {
  await sleep(10000);
  const s = await state();
  per10.push(s.messages - last); last = s.messages;
}
const end = await state();
console.log(`INFO  the server's messages in each 10 s of ${IDLE} s with no input: ${per10.join(" ")}`);
check(`the page did not call the idle connection dead in ${IDLE} s`, end.dead.length === 0, end.dead.join(" | "));
check("…its socket is still the one it logged in with, open", first.n === 1 && end.n === 1 && end.same && end.open === 1, `${first.n} -> ${end.n} socket(s), the same: ${end.same}, ${end.open} open`);
check("…and no Reconnecting bar", !end.bar);
console.log(`${fails ? "FAILED" : "PASSED"}`);
done(fails ? 1 : 0);
