// The https site and a gateway at ws://127.0.0.1 (the SSH tunnel's): an https page may not open a
// plain ws:// socket (mixed content). Chrome, Edge and Firefox make an exception for the loopback;
// Safari (WebKit, also every browser on iPhone and iPad) does not, and blocks the socket with only a
// console line, while FreeRDP logs "Connection refused" (聪哥 on a MacBook, 2026-11-15). The page
// must say what happened. Served over https here (a self-signed certificate made with openssl);
// the gateway is a WebSocket server that accepts and then stays silent (no RDP server is needed).
//
//   node test-mixed.mjs <site dir>          e.g. dist/site (./site.sh makes one)
//
// BROWSERS="webkit firefox" (the default) picks Playwright's browsers; PLAYWRIGHT=<its package dir>
// when it is not installed here. WebKit needs libraries a newer Linux may lack: run it in
// Playwright's image (test-webkit.mjs has the docker line). Checks, per browser:
//  - WebKit: no socket reaches the gateway, the end bar says Safari blocked it (no Reconnect), and
//    the Log says so before FreeRDP's own lines
//  - Firefox: the socket reaches the gateway, and the page says nothing about mixed content
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const site = resolve(process.argv[2] || "dist/site"), port = 8265, wsPort = 8266;
const require = createRequire(import.meta.url);
const pw = require(process.env.PLAYWRIGHT || "playwright");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  (" + detail + ")" : ""}`); if (!ok) fails++; };

const dir = mkdtempSync(join(tmpdir(), "mixed-"));
execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", `${dir}/key.pem`, "-out", `${dir}/cert.pem`, "-days", "2",
  "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1,DNS:localhost"], { stdio: "ignore" });
let reached = 0;
const gateway = net.createServer((c) => {
  c.once("data", (h) => {
    reached++;
    const key = /Sec-WebSocket-Key: (.+)\r\n/i.exec(h.toString())?.[1].trim();
    c.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${createHash("sha1").update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64")}\r\nSec-WebSocket-Protocol: binary\r\n\r\n`);
  });
  c.on("error", () => {});
});
await new Promise((r) => gateway.listen(wsPort, "127.0.0.1", r));
if (await fetch(`http://127.0.0.1:${port}/`).then(() => true, () => false)) { console.log(`FAIL  port ${port} is in use`); process.exit(1); }
const server = spawn("python3", [new URL("serve.py", import.meta.url).pathname, String(port), site], { stdio: "ignore",
  env: { ...process.env, TLS_CERT: `${dir}/cert.pem`, TLS_KEY: `${dir}/key.pem` } });
const cleanup = () => { server.kill(); gateway.close(); rmSync(dir, { recursive: true, force: true }); };
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { cleanup(); process.exit(1); });
await sleep(1000);

for (const which of (process.env.BROWSERS || "webkit firefox").split(/\s+/).filter(Boolean)) {
  const browser = await pw[which].launch();
  console.log(`browser: ${which} ${browser.version()}`);
  const page = await (await browser.newContext({ ignoreHTTPSErrors: true })).newPage();
  const consoleLines = []; page.on("console", (m) => consoleLines.push(m.text()));
  await page.goto(`https://127.0.0.1:${port}/index.html?v=127.0.0.1:${wsPort}&u=test&fs=0`);
  for (let i = 0; i < 60 && await page.evaluate(() => document.getElementById("status")?.textContent) !== "ready"; i++) await sleep(500);
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
  } else {
    check(`${which}: the gateway's socket reaches the gateway from the https page`, reached > 0, `${reached} socket(s)`);
    check("…and the page says nothing about mixed content", said < 0 && !/Safari does not let/.test(bar?.text || ""), said >= 0 ? log[said] : "");
  }
  await browser.close();
}
cleanup();
console.log(fails ? "FAILED" : "PASSED");
process.exit(fails ? 1 : 0);
