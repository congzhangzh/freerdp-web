// A connection that dies without closing (#369: a hung ssh tunnel, no FIN), against a gateway that
// is a few lines here: a WebSocket server that sends a small message every 2 s, as FreeRDP's shadow
// server's round trip requests do, and then hangs (it neither sends nor reads, and keeps the TCP
// connection), or one that says nothing at all, as xrdp when idle. No RDP server: the page is put
// in its session state by hand, and its own socket wrapper and watchdog (app.js, dead-watch.js) are
// what is tested, with the real client's counters (nothing is drawn: no new graphics).
//
//   node test-deadnet.mjs <site dir>        e.g. dist/site (./site.sh makes one)
//
// Needs Playwright (PLAYWRIGHT=<its package dir> when it is not installed here); Chrome
// (CHROME=<binary>; else /usr/bin/google-chrome, else Playwright's own Chromium). Checks:
//  - close() on a hung connection: the close event comes at once, not after the browser's 60 s
//  - a server that talked every 2 s and hung: the page closes it within 15 s by itself, says so in
//    the Log, and shows "Reconnecting…" instead of a picture that looks alive
//  - a server that never talks: not cut in 30 s
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import { resolve } from "node:path";

const site = resolve(process.argv[2] || "dist/site"), port = 8195, wsPort = 8196;
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT || "playwright");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  (" + detail + ")" : ""}`); if (!ok) fails++; };

// the gateway: /beat talks every 2 s until /hang; /quiet never talks
const conns = new Map();
const gateway = net.createServer((c) => {
  c.once("data", (head) => {
    const h = head.toString(), key = /Sec-WebSocket-Key: (.+)\r\n/i.exec(h)?.[1].trim(), path = /^GET (\S+)/.exec(h)?.[1] || "/";
    const accept = createHash("sha1").update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
    c.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\nSec-WebSocket-Protocol: binary\r\n\r\n`);
    const k = { c, beat: 0 }; conns.set(path, k);
    if (path === "/beat") k.beat = setInterval(() => c.write(Buffer.from([0x82, 4, 1, 2, 3, 4])), 2000);
  });
  c.on("error", () => {});
});
const hang = (path) => { const k = conns.get(path); clearInterval(k.beat); k.c.pause(); };   // no FIN, nothing read
await new Promise((r) => gateway.listen(wsPort, "127.0.0.1", r));

// a server left on the port (an earlier run that was killed) would serve its own site, not this one
if (await fetch(`http://127.0.0.1:${port}/`).then(() => true, () => false)) { console.log(`FAIL  port ${port} is in use: stop what serves it first`); process.exit(1); }
const server = spawn("python3", [new URL("serve.py", import.meta.url).pathname, String(port), site], { stdio: "ignore" });
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(signal, () => { server.kill(); process.exit(1); });
process.on("exit", () => server.kill());
for (let i = 0; i < 50; i++) { await sleep(100); try { await fetch(`http://127.0.0.1:${port}/index.html`); break; } catch {} }

const browser = await chromium.launch({ executablePath: process.env.CHROME || (existsSync("/usr/bin/google-chrome") ? "/usr/bin/google-chrome" : undefined) });
const page = await (await browser.newContext()).newPage();
await page.goto(`http://127.0.0.1:${port}/index.html`);
// (the page's CSP has no unsafe-eval, which waitForFunction needs: poll instead)
for (let i = 0; i < 60 && await page.evaluate(() => document.getElementById("status")?.textContent) !== "ready"; i++) await sleep(500);
// the session state the socket code looks at; the client's sockets as it opens them
const open = (path) => page.evaluate(([p, u]) => new Promise((done, fail) => {
  setTimeout(() => fail(new Error("the test socket did not open in 5 s")), 5000);
  crash.running = true; trackSockets();
  const ws = new WebSocket(u + p, ["binary"]); ws.binaryType = "arraybuffer";
  window.__ws ??= {}; const r = window.__ws[p] = { closed: null };
  ws.onclose = () => { r.closed = Date.now(); };
  ws.onopen = () => done(true); ws.onerror = () => fail(new Error("the test socket failed"));
}), [path, `ws://127.0.0.1:${wsPort}`]);
const closedAt = (path) => page.evaluate((p) => window.__ws[p].closed, path);

console.log("page:", await page.evaluate(() => document.getElementById("status")?.textContent));
// close() on a hung connection
await open("/close");
hang("/close");
const t0 = await page.evaluate(() => { const ws = [...sockets].pop(); const t = Date.now(); ws.close(); return t; });
let closed = null;
for (let i = 0; i < 50 && !closed; i++) { await sleep(100); closed = await closedAt("/close"); }
check("close() on a hung connection: the close event at once", closed !== null && closed - t0 < 1000, closed ? `${closed - t0} ms` : "none in 5 s");

// the watchdog: a server that talked every 2 s, then hung
await page.evaluate(() => { for (const s of sockets) sockets.delete(s); });
await open("/beat");
await sleep(12000);   // its pace is learnt: three of its messages with nothing else going on
const hungAt = Date.now(); hang("/beat");
let cut = null;
for (let i = 0; i < 30 && !cut; i++) { await sleep(1000); cut = await closedAt("/beat"); }
const ui = await page.evaluate(() => ({ bar: !document.getElementById("endBar").hidden, text: document.getElementById("endText").textContent,
  log: document.getElementById("log").textContent.split("\n").filter((l) => /no message from the server/.test(l)) }));
check("a hung server that talked every 2 s: the page closes it by itself", cut !== null && cut - hungAt < 15000, cut ? `${Math.round((cut - hungAt) / 1000)} s after it hung` : "not in 30 s");
check("…says why in the Log", ui.log.length === 1, ui.log.join(" | "));
check("…and shows Reconnecting, not a picture that looks alive", ui.bar && /Reconnecting/.test(ui.text), JSON.stringify({ bar: ui.bar, text: ui.text }));

// a server that never talks (xrdp when idle) is not cut
await page.evaluate(() => { for (const s of sockets) sockets.delete(s); document.getElementById("endBar").hidden = true; });
await open("/quiet");
await sleep(30000);
check("a server that never talks: not cut in 30 s", (await closedAt("/quiet")) === null);

await browser.close(); server.kill(); gateway.close();
for (const k of conns.values()) k.c.destroy();
console.log(fails ? "FAILED" : "PASSED");
process.exit(fails ? 1 : 0);
