// The https site and a gateway at ws://127.0.0.1 (the SSH tunnel's): an https page may not open a
// plain ws:// socket (mixed content). Chrome, Edge and Firefox make an exception for the loopback;
// Safari (WebKit, also every browser on iPhone and iPad) does not, and blocks the socket with only a
// console line, while FreeRDP logs "Connection refused" (聪哥 on a MacBook, 2026-11-15). The page
// must say what happened. And Connect with an empty password asks for it first (a server that
// wants one hangs up with "ERRINFO_RPC_INITIATED_DISCONNECT", 聪哥 in Firefox). Served over https here (a self-signed certificate made with openssl);
// the gateway is a WebSocket server that accepts and then stays silent (no RDP server is needed).
//
//   node test-mixed.mjs <site dir>          e.g. dist/site (./site.sh makes one)
//
// BROWSERS="webkit firefox" (the default) picks Playwright's browsers; PLAYWRIGHT=<its package dir>
// when it is not installed here. WebKit needs libraries a newer Linux may lack: run it in
// Playwright's image (test-webkit.mjs has the docker line). Checks, per browser:
//  - WebKit: no socket reaches the gateway, the end bar says Safari blocked it (no Reconnect), and
//    the Log says so before FreeRDP's own lines; its button opens the page from the gateway itself
//    (served over http on the gateway's port, as websockify --web does), where Safari connects
//  - Firefox: the socket reaches the gateway, and the page says nothing about mixed content
//  - both: a gateway written wss://host:port (one with a certificate) is reached over wss://; at an
//    IP address the vault says a passkey needs a site name; a page that is not cross-origin
//    isolated (no headers, no service worker) says so
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer as createHttpsServer } from "node:https";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import { tmpdir } from "node:os";
import { extname, join, normalize, resolve } from "node:path";

const site = resolve(process.argv[2] || "dist/site"), port = 8265, wsPort = 8266, wssPort = 8267;
const require = createRequire(import.meta.url);
const pw = require(process.env.PLAYWRIGHT || "playwright");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  (" + detail + ")" : ""}`); if (!ok) fails++; };

const dir = mkdtempSync(join(tmpdir(), "mixed-"));
execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", `${dir}/key.pem`, "-out", `${dir}/cert.pem`, "-days", "2",
  "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1,DNS:localhost"], { stdio: "ignore" });
let reached = 0;
// the gateway also serves the site over plain http on its port, as websockify --web does (no
// COOP/COEP headers either: the page's coi-serviceworker makes it cross-origin isolated)
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm", ".css": "text/css",
  ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon" };
const serveFile = (c, head) => {
  const path = decodeURIComponent((/^GET (\S+)/.exec(head)?.[1] || "/").split("?")[0]).replace(/\/$/, "/index.html");
  const file = join(site, normalize(path).replace(/^(\.\.[/\\])+/, ""));
  let body = null; try { body = readFileSync(file); } catch {}
  c.end(body ? Buffer.concat([Buffer.from(`HTTP/1.1 200 OK\r\nContent-Type: ${TYPES[extname(file)] || "application/octet-stream"}\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n`), body])
    : "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
};
const gateway = net.createServer((c) => {
  c.once("data", (h) => {
    if (!/^Upgrade: websocket/im.test(h.toString())) return serveFile(c, h.toString());
    reached++;
    const key = /Sec-WebSocket-Key: (.+)\r\n/i.exec(h.toString())?.[1].trim();
    c.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${createHash("sha1").update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64")}\r\nSec-WebSocket-Protocol: binary\r\n\r\n`);
  });
  c.on("error", () => {});
});
await new Promise((r) => gateway.listen(wsPort, "127.0.0.1", r));
// localhost may resolve to ::1 first: the gateway answers there too (the button opens localhost)
const gateway6 = net.createServer((c) => gateway.emit("connection", c));
await new Promise((r) => { gateway6.once("error", () => r()); gateway6.listen(wsPort, "::1", r); });
// a gateway with a certificate (wss://), as freerdp.congzhang.li's will be: the page's address says wss://
let reachedTls = 0;
const tlsGateway = createHttpsServer({ key: readFileSync(`${dir}/key.pem`), cert: readFileSync(`${dir}/cert.pem`) });
tlsGateway.on("upgrade", (q, c) => {
  reachedTls++;
  c.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${createHash("sha1").update(q.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64")}\r\nSec-WebSocket-Protocol: binary\r\n\r\n`);
  c.on("error", () => {});
});
await new Promise((r) => tlsGateway.listen(wssPort, "127.0.0.1", r));
if (await fetch(`http://127.0.0.1:${port}/`).then(() => true, () => false)) { console.log(`FAIL  port ${port} is in use`); process.exit(1); }
const server = spawn("python3", [new URL("serve.py", import.meta.url).pathname, String(port), site], { stdio: "ignore",
  env: { ...process.env, TLS_CERT: `${dir}/cert.pem`, TLS_KEY: `${dir}/key.pem` } });
const cleanup = () => { server.kill(); gateway.close(); gateway6.close(); tlsGateway.close(); rmSync(dir, { recursive: true, force: true }); };
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { cleanup(); process.exit(1); });
await sleep(1000);

for (const which of (process.env.BROWSERS || "webkit firefox").split(/\s+/).filter(Boolean)) {
  const browser = await pw[which].launch();
  console.log(`browser: ${which} ${browser.version()}`);
  const page = await (await browser.newContext({ ignoreHTTPSErrors: true })).newPage();
  const consoleLines = []; page.on("console", (m) => consoleLines.push(m.text()));
  await page.goto(`https://127.0.0.1:${port}/index.html?v=127.0.0.1:${wsPort}&u=test&fs=0`);
  for (let i = 0; i < 60 && await page.evaluate(() => document.getElementById("status")?.textContent) !== "ready"; i++) await sleep(500);
  // Connect with the password field empty: the page asks for it, and nothing starts
  reached = 0;
  await page.fill("#pass", "");
  await page.click("#go"); await sleep(1500);
  const asked = await page.evaluate(() => ({ status: document.getElementById("status").textContent, focus: document.activeElement?.id,
    started: document.getElementById("log").textContent.includes("[page] sdl-freerdp ") }));
  check(`${which}: Connect with no password asks for it first, and starts nothing`, /Enter the password first/.test(asked.status) && asked.focus === "pass" && !asked.started && reached === 0,
    JSON.stringify({ ...asked, sockets: reached }));
  reached = 0;
  await page.fill("#pass", "test");
  await page.click("#go");
  let bar = null;
  for (let i = 0; i < 30; i++) {
    await sleep(500);
    bar = await page.evaluate(() => ({ shown: !document.getElementById("endBar").hidden, text: document.getElementById("endText").textContent,
      reconnect: !document.getElementById("endReconnect").hidden }));
    if (bar.shown || (which !== "webkit" && reached)) break;
  }
  const log = (await page.evaluate(() => document.getElementById("log").textContent)).split("\n");
  const said = log.findIndex((l) => /\[page\] this browser does not let an https page open ws:\/\//.test(l));
  const refused = log.findIndex((l) => /Connection refused|ERRCONNECT_CONNECT_FAILED/.test(l));
  if (which === "webkit") {
    check("WebKit: the gateway's socket is blocked from the https page (it never reaches the gateway)", reached === 0,
      `${reached} socket(s); browser console: ${consoleLines.filter((l) => /\[blocked\]|requested insecure content/i.test(l)).slice(0, 1).join("") || "nothing blocked"}`);
    check("…the end bar says Safari blocked it, with the gateway's address", bar?.shown && new RegExp(`Safari does not let this https page reach the gateway at 127\\.0\\.0\\.1:${wsPort}`).test(bar.text), JSON.stringify(bar));
    check("…and offers no Reconnect (it would be blocked again)", bar?.shown && !bar.reconnect);
    check("…and the Log says so before FreeRDP's own lines", said >= 0 && (refused < 0 || said < refused), said >= 0 ? log[said].slice(0, 100) : "no line");
    // Safari's way in (聪哥, 2026-11-15): the same page from the gateway itself, over http
    const local = await page.evaluate(() => { const a = document.getElementById("endLocal"); return { shown: !a.hidden, href: a.href }; });
    const want = `http://localhost:${wsPort}/index.html?`;   // a name: passkeys take no IP address
    check("…and offers the page from the gateway itself, with the gateway and the settings", local.shown && local.href.startsWith(want) &&
      new URL(local.href).searchParams.get("v") === `127.0.0.1:${wsPort}` && new URL(local.href).searchParams.get("u") === "test", JSON.stringify(local));
    if (local.shown) {
      await page.click("#endLocal");
      for (let i = 0; i < 80 && await page.evaluate(() => location.protocol === "http:" && document.getElementById("status")?.textContent === "ready").catch(() => false) !== true; i++) await sleep(500);
      const there = await page.evaluate(() => ({ url: location.href, isolated: crossOriginIsolated, status: document.getElementById("status")?.textContent }));
      reached = 0; consoleLines.length = 0;
      await page.fill("#pass", "test"); await page.click("#go");
      for (let i = 0; i < 30 && !reached; i++) await sleep(500);
      check("…where Safari reaches the gateway (http://localhost, the page cross-origin isolated)", there.isolated && reached > 0 &&
        !consoleLines.some((l) => /\[blocked\]|requested insecure content/i.test(l)), JSON.stringify({ ...there, sockets: reached }));
    }
  } else {
    check(`${which}: the gateway's socket reaches the gateway from the https page`, reached > 0, `${reached} socket(s)`);
    check("…and the page says nothing about mixed content", said < 0 && !/Safari does not let/.test(bar?.text || ""), said >= 0 ? log[said] : "");
  }
  // the gateway at wss://: no mixed content in any browser, WebKit included
  await page.goto(`https://127.0.0.1:${port}/index.html?v=${encodeURIComponent(`wss://127.0.0.1:${wssPort}`)}&u=test&fs=0`);
  for (let i = 0; i < 60 && await page.evaluate(() => document.getElementById("status")?.textContent) !== "ready"; i++) await sleep(500);
  await page.fill("#host", `wss://127.0.0.1:${wssPort}`);   // typed, as a person does (the saved host wins over ?v=)
  reachedTls = 0; consoleLines.length = 0;
  await page.fill("#pass", "test"); await page.click("#go");
  for (let i = 0; i < 30 && !reachedTls; i++) await sleep(500);
  const cmd = (await page.evaluate(() => document.getElementById("log").textContent)).split("\n").find((l) => l.startsWith("[page] sdl-freerdp ")) || "";
  check(`${which}: a gateway written wss://127.0.0.1:${wssPort} is reached over wss:// from the https page`, reachedTls > 0 &&
    !consoleLines.some((l) => /\[blocked\]|requested insecure content/i.test(l)), `${reachedTls} socket(s)`);
  check("…and FreeRDP gets host:port, no scheme", cmd.includes(` /v:127.0.0.1:${wssPort} `), cmd.slice(0, 60));
  // the vault at an IP address: a passkey takes no IP for its site, so the vault says where it works
  await page.goto(`http://127.0.0.1:${wsPort}/index.html?v=127.0.0.1:${wsPort}&u=test&fs=0`);
  for (let i = 0; i < 60 && await page.evaluate(() => document.getElementById("status")?.textContent).catch(() => "") !== "ready"; i++) await sleep(500);
  await page.check("#vaultKeep").catch(() => {});
  await sleep(500);
  const vaultText = await page.evaluate(() => document.getElementById("vaultStatus")?.textContent || "");
  check(`${which}: at http://127.0.0.1 the vault says a passkey needs a site name, and where it works`,
    /belongs to a site name/.test(vaultText) && vaultText.includes(`http://localhost:${wsPort}/`), vaultText.slice(0, 120));
  // a first visit where the client fails before coi-serviceworker's reload (the kit's desktop WebKit,
  // 2026-11-15): the worker's registration held back 4 s, so the race is lost every time. The page
  // that stays must get to Connect, cross-origin isolated, never stopping at "Could not start"
  const slowCtx = await browser.newContext();
  await slowCtx.addInitScript(() => {
    const sw = navigator.serviceWorker; if (!sw) return;
    const register = sw.register.bind(sw);
    sw.register = (...a) => new Promise((ok, no) => setTimeout(() => register(...a).then(ok, no), 4000));
  });
  const slow = await slowCtx.newPage();
  await slow.goto(`http://localhost:${wsPort}/index.html`);
  let first = null, seen = [];
  for (let i = 0; i < 60; i++) {
    first = await slow.evaluate(() => ({ text: document.getElementById("go")?.textContent, isolated: self.crossOriginIsolated,
      status: document.getElementById("status")?.textContent })).catch(() => null);
    if (first && !seen.includes(first.text)) seen.push(first.text);
    if (first && first.text !== "Loading…" && first.text !== undefined) break;
    await sleep(500);
  }
  check(`${which}: a first visit whose client fails before the service worker's reload still gets to Connect`, first?.text === "Connect" && first.isolated,
    JSON.stringify({ ...first, seen }).slice(0, 200));
  await slowCtx.close();
  // a first visit whose reload, once asked for, navigates late (desktop Safari holds it until the new
  // worker is ready: the kit's site gate, 2026-11-15): coi-serviceworker's own hook (window.coi.doReload)
  // navigates 12 s after it asks. The page must not say "Could not start" on the page about to go
  const lateCtx = await browser.newContext();
  await lateCtx.addInitScript(() => { window.coi = { doReload: () => setTimeout(() => location.reload(), 12000) }; });
  const late = await lateCtx.newPage();
  await late.goto(`http://localhost:${wsPort}/index.html`);
  let lateGo = null; const lateSeen = [];
  for (let i = 0; i < 80; i++) {
    lateGo = await late.evaluate(() => ({ text: document.getElementById("go")?.textContent, isolated: self.crossOriginIsolated,
      status: document.getElementById("status")?.textContent })).catch(() => null);
    if (lateGo && !lateSeen.includes(lateGo.text)) lateSeen.push(lateGo.text);
    if (lateGo && lateGo.text !== "Loading…" && lateGo.text !== undefined) break;
    await sleep(500);
  }
  check(`${which}: a first visit whose reload navigates late still gets to Connect`, lateGo?.text === "Connect" && lateGo.isolated,
    JSON.stringify({ ...lateGo, seen: lateSeen }).slice(0, 200));
  await lateCtx.close();
  // not cross-origin isolated (no COOP/COEP from the server, no service worker: an app's built-in browser)
  const bare = await (await browser.newContext({ serviceWorkers: "block" })).newPage();
  await bare.goto(`http://localhost:${wsPort}/index.html`);
  let bareStatus = "";
  for (let i = 0; i < 60 && !/did not start|ready/.test(bareStatus); i++) { await sleep(500); bareStatus = await bare.evaluate(() => document.getElementById("status")?.textContent || "").catch(() => ""); }
  const isolated = await bare.evaluate(() => crossOriginIsolated);
  check(`${which}: a page that is not cross-origin isolated says so, not a cryptic error`, !isolated && /not cross-origin isolated/.test(bareStatus), `isolated ${isolated}: ${bareStatus.slice(0, 110)}`);
  await browser.close();
}
cleanup();
console.log(fails ? "FAILED" : "PASSED");
process.exit(fails ? 1 : 0);
