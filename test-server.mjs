// The "Get a server" page (web/server.html), without any server: headless Chrome answers the
// page's requests itself (DevTools Fetch interception) from web/, and install.json, which the
// release kit writes next to the page, from test-server-install.json, or not at all, or broken.
//
//   node test-server.mjs [out dir]
//
// Checks: a card per distribution, grouped by family, each command with a Copy button that
// copies it; the start command; the clients table; the link to all files; no sideways scrolling
// at phone width; without install.json, or with a broken one, only the link to the kit's latest
// release; every page's header links to it, before "Install as app". Screenshots go to the out
// dir (default out/). CHROME=<binary> picks another Chrome or Chromium.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";

const web = new URL("web/", import.meta.url).pathname;
const sample = new URL("test-server-install.json", import.meta.url).pathname;
const out = resolve(process.argv[2] || new URL("out/", import.meta.url).pathname);
mkdirSync(out, { recursive: true });
// short path: Chrome's singleton socket must fit the 107-char Unix socket limit
const base = new URL(".chrome/", import.meta.url).pathname;
mkdirSync(base, { recursive: true });
const profile = mkdtempSync(join(base, "server-"));
const port = 9400 + Math.floor(Math.random() * 500);
const chrome = spawn(process.env.CHROME || "google-chrome", ["--headless=new", `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`, "--no-first-run", "about:blank"], { stdio: "ignore", env: { ...process.env, TMPDIR: base } });
chrome.on("exit", () => {   // remove the profile and Chrome's singleton-socket dir
  rmSync(profile, { recursive: true, force: true });
  for (const n of readdirSync(base)) if (n.startsWith("com.google.Chrome.")) rmSync(join(base, n), { recursive: true, force: true });
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
for (let i = 0; i < 150 && !target; i++) {
  await sleep(200);
  try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page"); } catch {}
}
if (!target) { console.error("Chrome did not start"); chrome.kill(); process.exit(1); }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const pending = new Map(); const logs = [];
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
// port 1 has no server: every request is answered here
const ORIGIN = "http://localhost:1";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".json": "application/json" };
let installJson = null;   // what install.json is: a file, a string, or null (404)
function serve(m) {
  const path = decodeURIComponent(new URL(m.params.request.url).pathname).replace(/\/$/, "/index.html");
  let body = null, type = TYPES[extname(path)] || "application/octet-stream";
  if (path === "/install.json") body = installJson === null ? null : Buffer.from(existsSync(installJson) ? readFileSync(installJson) : installJson);
  else if (!path.includes("..") && existsSync(join(web, path))) body = readFileSync(join(web, path));
  if (!body) return send("Fetch.fulfillRequest", { requestId: m.params.requestId, responseCode: 404, body: "" });
  send("Fetch.fulfillRequest", { requestId: m.params.requestId, responseCode: 200, body: body.toString("base64"),
    responseHeaders: [{ name: "Content-Type", value: type }] });
}
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result ?? m.error); pending.delete(m.id); }
  if (m.method === "Fetch.requestPaused") serve(m);
  if (m.method === "Runtime.consoleAPICalled") logs.push(m.params.args.map((a) => a.value ?? a.description).join(" "));
  if (m.method === "Runtime.exceptionThrown") logs.push("EXCEPTION " + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
});
const ev = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true, userGesture: true }))?.result?.value;
async function screenshot(name) {
  const r = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  writeFileSync(join(out, name), Buffer.from(r.data, "base64"));
}
let fails = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  (" + detail + ")" : ""}`); if (!ok) fails++; };
const open = async (json) => {
  installJson = json;
  await send("Page.navigate", { url: `${ORIGIN}/server.html` });
  for (let i = 0; i < 25 && await ev("document.readyState") !== "complete"; i++) await sleep(200);
  await sleep(500);   // install.json's fetch
};

await send("Fetch.enable", { patterns: [{ urlPattern: ORIGIN + "/*" }] });
await send("Runtime.enable"); await send("Page.enable");
const want = JSON.parse(readFileSync(sample, "utf8"));

// with the kit's install.json, at phone width
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await open(sample);
const cards = await ev("[...document.querySelectorAll('#kit .distro')].map((c) => c.querySelector('h4').textContent)");
check("a card per distribution with a name and a command", JSON.stringify(cards) === JSON.stringify(["Debian 13", "Ubuntu 26.04", "Fedora 45", "Fedora 44"]), JSON.stringify(cards));
check("grouped by family, with a link to each", JSON.stringify(await ev("[...document.querySelectorAll('#kit h3')].map((h) => h.id + ':' + h.textContent)"))
  === JSON.stringify(["server-debian:Debian", "server-ubuntu:Ubuntu", "server-fedora:Fedora"])
  && JSON.stringify(await ev("[...document.querySelectorAll('#kit .families a')].map((a) => a.hash)")) === JSON.stringify(["#server-debian", "#server-ubuntu", "#server-fedora"]));
const first = await ev("document.querySelector('#kit .distro')?.innerText") || "";
check("a card shows its sessions and its more commands", first.includes("Sessions: " + want.server[0].sessions)
  && first.includes(want.server[0].more[0].what + ":"), first.split("\n").slice(0, 3).join(" | "));
const pres = await ev("[...document.querySelectorAll('#kit .copyable')].map((c) => [c.querySelector('pre').textContent, !!c.querySelector('button[data-copy]')])");
const commands = [want.server[0].command, want.server[0].more[0].command, want.server[1].command, want.server[2].command, want.server[3].command, want.start];
check("every command, the more ones and the start one, has a Copy button", JSON.stringify(pres) === JSON.stringify(commands.map((c) => [c, true])),
  `${pres.length} commands`);
// what the button hands the clipboard (the system clipboard stays untouched)
await ev("window.__copied = null; navigator.clipboard.writeText = async (t) => { window.__copied = t; }; true");
await ev("document.querySelectorAll('#kit .copyable button')[3].click(), true"); await sleep(300);
const copied = String(await ev("window.__copied"));
check("Copy copies the command exactly", copied === want.server[2].command && await ev("document.querySelectorAll('#kit .copyable button')[3].textContent") === "Copied", copied.slice(0, 60));
const clients = await ev("[...document.querySelectorAll('#clients tr')].slice(1).map((r) => [r.cells[0].textContent, r.cells[1].textContent, r.querySelector('a').href])");
check("the clients table: platform and file link, a link that is not https left out",
  JSON.stringify(clients) === JSON.stringify(want.clients.slice(0, 2).map((c) => [c.platform, c.file, c.url])), JSON.stringify(clients.map((c) => c[0])));
check("the link to all files and checksums", await ev(`[...document.querySelectorAll('#kit a')].some((a) => a.href === ${JSON.stringify(want.url)} && a.textContent === ${JSON.stringify(want.url)})`)
  && (await ev("document.getElementById('kit').innerText")).includes("All files and checksums: " + want.url));
check("the fallback line is gone", await ev("!document.getElementById('kitFallback')"));
const w = await ev("document.documentElement.scrollWidth");
check("server.html with install.json fits 390 px", w <= 390, `${w} px`);
check("the long commands wrap inside their box", await ev("[...document.querySelectorAll('#kit pre')].every((p) => p.scrollWidth <= p.clientWidth + 1)"));
await screenshot("server-phone.png");
await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
await sleep(300); await screenshot("server-wide.png");

// without install.json (a local build), and with one that is not JSON or has nothing usable
const LATEST = "https://github.com/congzhangzh/rdp-release-kit/releases/latest";
for (const [label, json] of [["without install.json", null], ["with a broken install.json", "{ not json"], ["with an install.json without distributions", '{"server": []}']]) {
  await open(json);
  check(`${label}: only the link to the kit's latest release`, await ev(`!!document.querySelector('#kitFallback a[href="${LATEST}"]')`)
    && await ev("document.querySelectorAll('#kit .distro, #kit pre, #clients').length") === 0);
}
await screenshot("server-fallback.png");
check("no page errors", !logs.some((l) => l.startsWith("EXCEPTION")), logs.filter((l) => l.startsWith("EXCEPTION")).join("; "));

// every page with the header links to Get a server, right before Install as app
for (const page of readdirSync(web).filter((f) => f.endsWith(".html"))) {
  const html = readFileSync(join(web, page), "utf8");
  if (!html.includes('<nav aria-label="Help">')) continue;
  check(`${page}: Get a server in the header, before Install as app`,
    /<a href="server.html"( aria-current="page")?>Get a server<\/a>\s*<a href="install.html"/.test(html));
}

writeFileSync(join(out, "server.log"), logs.join("\n") + "\n");
ws.close(); chrome.kill();
console.log(`${fails ? "FAILED" : "PASSED"}: screenshots and log in ${out}`);
process.exit(fails ? 1 : 0);
