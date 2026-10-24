import { connectTestSession } from "./test-connect.mjs";
// Reconnecting without a passkey prompt or a typed password, against the CI xrdp session:
//   1. a dropped network: the gateway (this script's own websockify) is stopped for 3 s; FreeRDP
//      tries at once (+auto-reconnect) and fails, the client ends, and the page starts new
//      clients (2 s, 4 s…) until one gets through; xrdp logs the user in again
//   2. Reconnect on the toolbar while the session runs: its sockets are closed and FreeRDP
//      reconnects within the same client, or the page starts a new one
// No reload, no passkey prompt, no typed password: the password stays in the page's memory.
// Needs a modular client (createFreeRDP, -sMODULARIZE).
// WebAuthn needs a domain, so the page is opened on localhost, not 127.0.0.1.
//   PAGE=http://localhost:8181/index.html node test-reconnect.mjs
// The published page (https) reaching this machine's loopback gateway needs Chrome's Local
// Network Access check off: CHROME_FLAGS=--disable-features=LocalNetworkAccessChecks.
// DUMP=1 prints the page's uncaught exceptions with their stacks.
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const base = new URL(".chrome/", import.meta.url).pathname;
mkdirSync(base, { recursive: true });
const profile = mkdtempSync(join(base, "rc-"));
if (execFileSync("ss", ["-ltn"]).toString().includes("127.0.0.1:9346 ")) { console.error("port 9346 is taken: another test Chrome still runs"); process.exit(2); }
const chrome = spawn("google-chrome", ["--headless=new", "--remote-debugging-port=9346", `--user-data-dir=${profile}`, "--no-first-run",
  "--window-size=1280,900", "--enable-unsafe-swiftshader",
  ...(process.env.CHROME_FLAGS ? process.env.CHROME_FLAGS.split(" ") : []), "about:blank"], { stdio: "ignore", env: { ...process.env, TMPDIR: base } });
chrome.on("exit", () => { rmSync(profile, { recursive: true, force: true });
  for (const n of readdirSync(base)) if (n.startsWith("com.google.Chrome.")) rmSync(join(base, n), { recursive: true, force: true }); });
// the gateway: 6082 -> the CI xrdp session; stopping it drops the session's connection
const GATEWAY = 6082;
let gateway = null;
const startGateway = async () => {
  gateway = spawn("uvx", ["websockify", `127.0.0.1:${GATEWAY}`, "127.0.0.1:13390"], { stdio: "ignore", detached: true });
  for (let i = 0; i < 50; i++) { await sleep(200); if (execFileSync("ss", ["-ltn"]).toString().includes(`127.0.0.1:${GATEWAY} `)) return; }
  throw new Error("the test gateway did not start");
};
// websockify serves each connection from a process its forkserver starts, outside the group:
// kill every process with a socket on the gateway's port too
const stopGateway = () => {
  try { process.kill(-gateway.pid, "SIGKILL"); } catch {}
  gateway = null;
  const ss = execFileSync("ss", ["-tlnp"]).toString() + execFileSync("ss", ["-tnp"]).toString();
  for (const line of ss.split("\n")) if (line.includes(`127.0.0.1:${GATEWAY} `) && !/chrome/.test(line))
    for (const m of line.matchAll(/pid=(\d+)/g)) try { process.kill(+m[1], "SIGKILL"); } catch {}
};
const done = (code) => { stopGateway(); chrome.kill(); process.exit(code); };
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => done(1));   // e.g. timeout(1): no Chrome left behind
let t; for (let i = 0; i < 150 && !t; i++) { await sleep(200); try { t = (await (await fetch("http://127.0.0.1:9346/json")).json()).find((x) => x.type === "page"); } catch {} }
const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const p = new Map(); let logs = [];
const ceremonies = [];
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && p.has(m.id)) { p.get(m.id)(m.result ?? m.error); p.delete(m.id); }
  if (m.method === "Runtime.consoleAPICalled") logs.push((process.env.DUMP ? new Date().toISOString().slice(14, 23) + " " : "") + m.params.args.map((a) => a.value).join(" "));
  if (m.method === "WebAuthn.credentialAdded" || m.method === "WebAuthn.credentialAsserted") ceremonies.push(m.method.slice(9));
  if (m.method === "Runtime.exceptionThrown" && process.env.DUMP) { const d = m.params.exceptionDetails;
    console.log("EXCEPTION", d.exception?.description?.split("\n").slice(0, 14).join("\n") || d.text); } });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; p.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
// a page that stops answering (a hung main thread) ends the test with its last log lines
const ev = async (expression) => {
  let timer;
  const hung = new Promise((r) => { timer = setTimeout(r, 20000, "hung"); });
  const r = await Promise.race([send("Runtime.evaluate", { expression, returnByValue: true, userGesture: true, awaitPromise: true }), hung]);
  clearTimeout(timer);
  if (r === "hung") { console.log("FAIL the page stopped answering; its last log lines:\n" + logs.slice(-25).join("\n")); done(1); }
  return r.result?.value;
};
const results = {};
// xrdp's own record of logins: the count of "logged in" lines for the test user
const logins = () => execFileSync("docker", ["exec", "grd-wasm-xrdp-ci", "sh", "-c",
  "grep -c 'login status for test : logged in' /var/log/xrdp-sesman.log || true"]).toString().trim() | 0;
const check = (name, ok) => { results[name] = !!ok; console.log(ok ? "PASS" : "FAIL", name); };
const url = (process.env.PAGE || "http://localhost:8080/index.html") + `?v=127.0.0.1:${GATEWAY}&u=test&extra=/gfx&fs=0`;
const state = () => ev("JSON.stringify({ session: document.body.classList.contains('session'), status: document.getElementById('status').textContent," +
  " bar: document.getElementById('endBar')?.hidden === false, endText: document.getElementById('endText')?.textContent })").then(JSON.parse);
const seen = [];   // what the end bar said, and how each client ended, in order
const watch = async () => {
  const s = await state(), exits = logs.filter((l) => /\[page\] (exit code|reconnect)/.test(l)).map((l) => l.replace(/^.*\[page\] /, ""));
  for (const v of [s.bar ? "bar: " + s.endText : "", ...exits]) if (v && !seen.includes(v)) seen.push(v);
};
const waitFor = async (what, test, ms) => {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(500)) { await watch(); if (await test()) return true; }
  console.log("timed out waiting for", what); return false;
};

await send("Runtime.enable");
await send("WebAuthn.enable", { enableUI: false });
await send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", ctap2Version: "ctap2_1", transport: "internal",
  hasResidentKey: true, hasUserVerification: true, isUserVerified: true, hasPrf: true, automaticPresenceSimulation: true } });
await startGateway();

// 1. a dropped network
await send("Page.navigate", { url });
let before = logins();
await connectTestSession(send).catch((e) => { console.error(e, "\n" + logs.slice(-30).join("\n")); done(1); });
await waitFor("the first login", () => logins() > before, 30000);
await sleep(3000);
let s = await state(); console.log("connected:", JSON.stringify(s));
check("connected with a typed password", s.session && logins() === before + 1);
before = logins(); logs = [];
stopGateway(); console.log("gateway stopped");
if (process.env.DUMP) { await sleep(500); console.log(execFileSync("sh", ["-c", `ss -tnp | grep -E ':${GATEWAY}\\b' || echo no-sockets`]).toString()); }
await sleep(3000);
await startGateway(); console.log("gateway started again");
const back = await waitFor("FreeRDP's reconnect", () => logins() > before, 60000);
await sleep(3000);
s = await state();
const tried = logs.filter((l) => /Attempting reconnect|Network disconnect/i.test(l));
console.log("after the drop:", JSON.stringify(s), "|", tried.slice(0, 3).join(" | "));
if (process.env.DUMP) console.log(logs.slice(-40).join("\n"), "\nconnLog:", await ev("JSON.stringify([connLog.length, connLog.filter((l) => /Network|ERRCONNECT|exit/.test(l)).slice(0, 5)])"));
console.log("seen:", seen.join(" → "));
check("the session comes back after the network drops (FreeRDP's retry, then the page's)", back && tried.length > 0);
check("the session goes on in the same page, no prompt", s.session && !/exited/.test(s.status) && ceremonies.length === 0);

// 2. Reconnect on the toolbar: a new client in this page, the password from memory
before = logins(); logs = []; seen.length = 0;
await ev("document.getElementById('tbReconnect').click(), 1");
const again = await waitFor("the Reconnect login", () => logins() > before, 60000);
await sleep(3000);
s = await state();
console.log("after Reconnect:", JSON.stringify(s), "| ceremonies:", ceremonies.length);
console.log("seen:", seen.join(" → "), "| FreeRDP's own:", logs.filter((l) => /client_auto_reconnect/.test(l)).length);
if (process.env.DUMP) { const i = logs.findIndex((l) => /Attempting reconnect/.test(l)); console.log(logs.slice(Math.max(0, i - 4), i + 16).join("\n")); }
check("Reconnect logs in again without a reload, a passkey or a typed password", again && s.session && ceremonies.length === 0);
check("the page was not reloaded (the same page log)", logs.some((l) => /\[page\] reconnect/.test(l)) && !logs.some((l) => /\[page\] FreeRDP Web /.test(l)));
// "table index is out of bounds" / "function signature mismatch" from a timer callback
// (emscripten_set_timeout → dynCall_vi) also happens in about half of first sessions, with the
// previous release too and without any reconnect: reported, not counted against Reconnect
const known = /table index is out of bounds|function signature mismatch/;
for (const l of logs.filter((l) => known.test(l)).slice(0, 2)) console.log("NOTE the known timer-callback error:", l.replace(/^.*\[page\] /, ""));
const errors = logs.filter((l) => /abort|program has already exited|RuntimeError/i.test(l) && !known.test(l));
check("no runtime error from the second client", !errors.length);
if (errors.length) { const i = logs.findIndex((l) => /RuntimeError|abort/i.test(l)); console.log(logs.slice(Math.max(0, i - 8), i + 4).join("\n")); }

ws.close(); done(Object.values(results).every(Boolean) ? 0 : 1);
