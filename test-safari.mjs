// The page in real Safari (macOS), through Safari's own WebDriver (safaridriver; no packages): what
// Playwright's WebKit on Linux only approximates. Three ways to the gateway (聪哥, 2026-11-15):
//  A. the page at http://127.0.0.1 (as a gateway that serves the page itself, websockify --web), a
//     plain ws:// gateway: Safari connects
//  B. the page over https (as the site), a plain ws://127.0.0.1 gateway: Safari blocks it (mixed
//     content) and the page says so, without retrying
//  C. the page over https, a wss:// gateway (one with a certificate, as freerdp.congzhang.li's): Safari
//     connects
// The gateways are WebSocket servers here that accept and then stay silent (no RDP server is needed).
//
//   TLS_CERT=<cert.pem> TLS_KEY=<key.pem> node test-safari.mjs <site dir>      e.g. dist/site
//
// B and C need a certificate this Mac trusts for 127.0.0.1 (CI adds one to the System keychain);
// without TLS_CERT they are skipped. Needs `safaridriver --enable` once (sudo). Safari allows one
// WebDriver session at a time.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer as createHttpsServer } from "node:https";
import net from "node:net";
import { resolve } from "node:path";

const site = resolve(process.argv[2] || "dist/site");
const HTTP = 8280, HTTPS = 8281, WS = 8282, WSS = 8283, WD = 4445;
const { TLS_CERT, TLS_KEY } = process.env;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  (" + detail + ")" : ""}`); if (!ok) fails++; };

// the gateways: count the sockets that reach them
const reached = { ws: 0, wss: 0 };
const accept = (key) => `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${
  createHash("sha1").update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64")}\r\nSec-WebSocket-Protocol: binary\r\n\r\n`;
const ws = net.createServer((c) => {
  c.once("data", (h) => { reached.ws++; c.write(accept(/Sec-WebSocket-Key: (.+)\r\n/i.exec(h.toString())?.[1].trim())); });
  c.on("error", () => {});
});
await new Promise((r) => ws.listen(WS, "127.0.0.1", r));
let wss = null;
if (TLS_CERT) {
  wss = createHttpsServer({ key: readFileSync(TLS_KEY), cert: readFileSync(TLS_CERT) });
  wss.on("upgrade", (q, c) => { reached.wss++; c.write(accept(q.headers["sec-websocket-key"])); c.on("error", () => {}); });
  await new Promise((r) => wss.listen(WSS, "127.0.0.1", r));
}
const serve = new URL("serve.py", import.meta.url).pathname;
// the plain http one without TLS_CERT: serve.py serves https whenever it is set
const plainEnv = { ...process.env }; delete plainEnv.TLS_CERT; delete plainEnv.TLS_KEY;
const servers = [spawn("python3", [serve, String(HTTP), site], { stdio: ["ignore", "ignore", "pipe"], env: plainEnv })];
const serverLog = []; servers[0].stderr.on("data", (d) => serverLog.push(...d.toString().split("\n").filter(Boolean)));
servers[0].on("exit", (code, signal) => console.log(`INFO  the page server (serve.py ${HTTP}) exited: code ${code}, signal ${signal}; its last lines: ${serverLog.slice(-8).join(" | ")}`));
servers[0].on("error", (e) => console.log(`INFO  the page server did not start: ${e.message}`));
if (TLS_CERT) servers.push(spawn("python3", [serve, String(HTTPS), site], { stdio: "ignore", env: { ...process.env, TLS_CERT, TLS_KEY } }));
const driver = spawn("safaridriver", ["-p", String(WD)], { stdio: "inherit" });
let sid = null;
const done = async (code) => {
  if (sid) await fetch(`http://127.0.0.1:${WD}/session/${sid}`, { method: "DELETE" }).catch(() => {});
  driver.kill(); for (const s of servers) s.kill(); ws.close(); wss?.close();
  console.log(code ? "FAILED" : "PASSED"); process.exit(code);
};

// WebDriver, by hand
const wd = async (method, path, body) => {
  const r = await fetch(`http://127.0.0.1:${WD}${path}`, { method, headers: { "content-type": "application/json" }, body: body && JSON.stringify(body) });
  const j = await r.json();
  if (j.value?.error) throw new Error(`${path}: ${j.value.error}: ${j.value.message}`);
  return j.value;
};
const ELEMENT = "element-6066-11e4-a52e-4f735466cecf";
const js = (script, ...args) => wd("POST", `/session/${sid}/execute/sync`, { script, args });
const el = async (css) => (await wd("POST", `/session/${sid}/element`, { using: "css selector", value: css }))[ELEMENT];
const click = async (css) => wd("POST", `/session/${sid}/element/${await el(css)}/click`, {});
const type = async (css, text) => { const e = await el(css); await wd("POST", `/session/${sid}/element/${e}/clear`, {}); await wd("POST", `/session/${sid}/element/${e}/value`, { text }); };
const status = () => js("return document.getElementById('status') ? document.getElementById('status').textContent : null");
async function open(url) {
  let s = null;
  for (let attempt = 0; attempt < 2 && s !== "ready"; attempt++) {
    await wd("POST", `/session/${sid}/url`, { url });
    for (let i = 0; i < 90 && s !== "ready"; i++) { await sleep(500); s = await status().catch(() => null); }
  }
  if (s !== "ready") {
    console.log(`INFO  ${url}: status ${s}, title "${await js("return document.title").catch((e) => e.message)}", at ${await js("return location.href").catch(() => "?")}`);
    console.log(`INFO  the same address from node now: ${await fetch(url).then((r) => r.status + " " + r.headers.get("content-type"), (e) => e.message)}`);
    console.log(`INFO  the page server's last requests: ${serverLog.slice(-6).join(" | ") || "none"}`);
  }
  return s;
}
async function connect(pass = "test") { await type("#pass", pass); await click("#go"); }
const waitFor = async (test, ms) => { for (let t = 0; t < ms && !(await test()); t += 500) await sleep(500); return test(); };

// the page's servers first: Safari shows its own error page for an address nothing answers yet
const up = (url) => fetch(url).then((r) => r.ok, () => false);
let httpUp = false;
for (let i = 0; i < 100 && !(httpUp = await up(`http://127.0.0.1:${HTTP}/index.html`)); i++) await sleep(200);
console.log(`INFO  the page server answers at http://127.0.0.1:${HTTP}: ${httpUp}`);
if (!httpUp) { console.log(`FAIL  the page server never answered; its lines: ${serverLog.slice(-8).join(" | ") || "none"}`); await done(1); }
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";   // only this check of our own https server
for (let i = 0; TLS_CERT && i < 100 && !(await up(`https://127.0.0.1:${HTTPS}/index.html`)); i++) await sleep(200);
for (let i = 0; i < 50; i++) { await sleep(200); if (await up(`http://127.0.0.1:${WD}/status`)) break; }
try {
  sid = (await wd("POST", "/session", { capabilities: { alwaysMatch: { browserName: "safari" } } })).sessionId;
  console.log("browser:", await js("return navigator.userAgent"));

  // A: the page at http://127.0.0.1, a plain ws:// gateway
  let a = await open(`http://127.0.0.1:${HTTP}/index.html?v=127.0.0.1:${WS}&u=test&fs=0`);
  if (a !== "ready") {   // the same page by name: does Safari treat the address differently?
    const byName = await open(`http://localhost:${HTTP}/index.html?v=127.0.0.1:${WS}&u=test&fs=0`);
    console.log(`INFO  by name, http://localhost:${HTTP}: status ${byName}`);
    if (byName === "ready") a = byName;
  }
  const env = await js("const l = document.getElementById('log'); return JSON.stringify({ isolated: self.crossOriginIsolated, sab: typeof SharedArrayBuffer, version: ((l && l.textContent.match(/FreeRDP Web \\S+/)) || [''])[0] })");
  check("A: the page loads in Safari from http://127.0.0.1, cross-origin isolated", a === "ready" && JSON.parse(env).isolated, `status ${a}, ${env}`);
  reached.ws = 0;
  await connect();
  check("…and reaches the ws:// gateway at 127.0.0.1", await waitFor(() => reached.ws > 0, 20000), `${reached.ws} socket(s)`);

  if (!TLS_CERT) console.log("SKIP  B and C: no TLS_CERT (a certificate this Mac trusts for 127.0.0.1)");
  else {
    // B: the page over https, a plain ws:// gateway: blocked, and said
    const b = await open(`https://127.0.0.1:${HTTPS}/index.html?v=127.0.0.1:${WS}&u=test&fs=0`);
    check("B: the page loads in Safari over https (the certificate is trusted)", b === "ready", `status ${b}`);
    if (b === "ready") {
      reached.ws = 0;
      await connect();
      const bar = async () => JSON.parse(await js("return JSON.stringify({ shown: !document.getElementById('endBar').hidden, text: document.getElementById('endText').textContent })"));
      await waitFor(async () => (await bar()).shown, 20000);
      const end = await bar();
      check("…Safari blocks the https page's ws://127.0.0.1 socket (it never reaches the gateway)", reached.ws === 0, `${reached.ws} socket(s)`);
      check("…and the page says Safari blocked it", end.shown && /Safari does not let this https page reach the gateway/.test(end.text), JSON.stringify(end).slice(0, 160));

      // C: the same https page, a wss:// gateway
      await open(`https://127.0.0.1:${HTTPS}/index.html?u=test&fs=0`);
      await type("#host", `wss://127.0.0.1:${WSS}`);
      reached.wss = 0;
      await connect();
      check(`C: from the https page Safari reaches a wss:// gateway (wss://127.0.0.1:${WSS})`, await waitFor(() => reached.wss > 0, 20000), `${reached.wss} socket(s)`);
    }
  }
} catch (e) { console.log("FAIL  " + e.message); fails++; }
await done(fails ? 1 : 0);
