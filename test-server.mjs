// The pages "Get a server" (web/server.html) and "Get a client" (web/client.html), without any
// server: headless Chrome answers the page's requests itself (DevTools Fetch interception) from
// web/, and install.json, which the release kit writes next to the page, from
// test-server-install.json, or not at all, or broken.
//
//   node test-server.mjs [out dir]
//
// Checks: a card per distribution, grouped by family, each command with a Copy button that
// copies it; the start command; no client on it; the link to all files; no sideways scrolling
// at phone width; without install.json, or with a broken one, only the link to the kit's latest
// release. Get a client: the clients table, freerdp-tk and its uvx line, its videos, the same
// fallback. Every page's header links to both, Get a client right after Get a server, and none
// to "Install as app" any more. Screenshots go to the out
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
// demo/demo.json as the kit publishes it, with freerdp-tk's videos (their files are not needed:
// a video loads nothing before it is played)
const demoJson = JSON.stringify({ videos: [{ title: "the splash's", src: "demo/xrdp-gnome.mp4" }], clients: [
  { title: "xrdp + GNOME Wayland, AV1, freerdp-tk release", src: "demo/freerdp-tk-release.mp4", poster: "demo/freerdp-tk-release.jpg",
    caption: "Unpacked from the release, saved, connected." },
  { title: "xrdp + GNOME Wayland, H.264, freerdp-tk uvx", src: "demo/freerdp-tk-uvx.mp4", poster: "demo/freerdp-tk-uvx.jpg" }],
  windows: [{ title: "FreeRDP Web on a Windows host, AV1", src: "demo/windows-host.mp4", poster: "demo/windows-host.jpg",
    caption: "The Start menu, Notepad, typing." }] });
function serve(m) {
  const path = decodeURIComponent(new URL(m.params.request.url).pathname).replace(/\/$/, "/index.html");
  let body = null, type = TYPES[extname(path)] || "application/octet-stream";
  if (path === "/install.json") body = installJson === null ? null : Buffer.from(existsSync(installJson) ? readFileSync(installJson) : installJson);
  else if (path === "/demo/demo.json") body = Buffer.from(demoJson);
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
const open = async (json, page = "server.html") => {
  installJson = json;
  await send("Page.navigate", { url: `${ORIGIN}/${page}` });
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
check("grouped by family, with a link to each", JSON.stringify(await ev("[...document.querySelectorAll('#kit h3[id^=server-]')].map((h) => h.id + ':' + h.textContent)"))
  === JSON.stringify(["server-debian:Debian", "server-ubuntu:Ubuntu", "server-fedora:Fedora"])
  && JSON.stringify(await ev("[...document.querySelectorAll('#kit .families a')].map((a) => a.hash)")) === JSON.stringify(["#server-debian", "#server-ubuntu", "#server-fedora", "#windows"]));
const first = await ev("document.querySelector('#kit .distro')?.innerText") || "";
check("a card shows its sessions, a line per kind, and its more commands",
  first.replace(/\n+/g, "\n").includes("Wayland: GNOME, KDE Plasma, sway\nXorg: the default session") && first.includes(want.server[0].more[0].what + ":"),
  first.split("\n").slice(0, 3).join(" | "));
const old = await ev("document.querySelectorAll('#kit .distro')[1]?.innerText") || "";
check("an older install.json's sessions stay one line", old.includes("Sessions: " + want.server[1].sessions), old.split("\n").slice(0, 2).join(" | "));
const pres = await ev("[...document.querySelectorAll('#kit .copyable')].map((c) => [c.querySelector('pre').textContent, !!c.querySelector('button[data-copy]')])");
const commands = [want.server[0].command, want.server[0].more[0].command, want.server[1].command, want.server[2].command, want.server[3].command, want.start,
  want.windows.command, want.windows.remove];
check("every command, the more ones and the start one, has a Copy button", JSON.stringify(pres) === JSON.stringify(commands.map((c) => [c, true])),
  `${pres.length} commands`);
// what the button hands the clipboard (the system clipboard stays untouched)
await ev("window.__copied = null; navigator.clipboard.writeText = async (t) => { window.__copied = t; }; true");
await ev("document.querySelectorAll('#kit .copyable button')[3].click(), true"); await sleep(300);
const copied = String(await ev("window.__copied"));
check("Copy copies the command exactly", copied === want.server[2].command && await ev("document.querySelectorAll('#kit .copyable button')[3].textContent") === "Copied", copied.slice(0, 60));
check("the link to all files and checksums", await ev(`[...document.querySelectorAll('#kit a')].some((a) => a.href === ${JSON.stringify(want.url)} && a.textContent === ${JSON.stringify(want.url)})`)
  && (await ev("document.getElementById('kit').innerText")).includes("All files and checksums: " + want.url));
check("the fallback line is gone", await ev("!document.getElementById('kitFallback')"));
check("Windows: its own section after Start it, a link to it among the distributions, the archive linked",
  await ev("document.querySelector('#kit h2#windows')?.previousElementSibling?.matches('.copyable')") === true
  && await ev("[...document.querySelectorAll('#kit .families a')].some((a) => a.hash === '#windows')")
  && await ev(`[...document.querySelectorAll('#kit a')].some((a) => a.href === ${JSON.stringify(want.windows.url)})`));
check("the Windows host's video in its section, only that one",
  JSON.stringify(await ev("[...document.querySelectorAll('#kit video')].map((v) => v.getAttribute('src'))")) === JSON.stringify(["demo/windows-host.mp4"])
  && await ev("document.querySelector('#kit video').compareDocumentPosition(document.getElementById('windows')) === Node.DOCUMENT_POSITION_PRECEDING"));
check("no client, no freerdp-tk: they are on Get a client", await ev("document.querySelectorAll('#clients, #freerdp-tk').length") === 0
  && await ev("!!document.querySelector('main a[href=\"client.html\"]:not(nav a)')"));
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

// Get a client: the native clients, freerdp-tk, its videos
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await open(sample, "client.html");
check("client.html: the three ways, in order", JSON.stringify(await ev("[...document.querySelectorAll('main h2')].map((h) => h.id)")) === JSON.stringify(["browser", "app", "native-clients"])
  && await ev("!!document.querySelector('#app ~ p a[href=\"install.html\"]')"));
const clients = await ev("[...document.querySelectorAll('#clients tr')].slice(1).map((r) => [r.cells[0].textContent, r.cells[1].textContent, r.querySelector('a').href])");
check("the clients table: platform and file link, a link that is not https left out",
  JSON.stringify(clients) === JSON.stringify(want.clients.slice(0, 2).map((c) => [c.platform, c.file, c.url])), JSON.stringify(clients.map((c) => c[0])));
check("freerdp-tk after the clients, with its uvx line and a Copy button", await ev("document.querySelector('#clients + h3')?.id") === "freerdp-tk"
  && JSON.stringify(await ev("[...document.querySelectorAll('#native .copyable')].map((c) => [c.querySelector('pre').textContent, !!c.querySelector('button[data-copy]')])"))
  === JSON.stringify([["uvx freerdp-tk", true]]));
const clips = await ev("[...document.querySelectorAll('#native figure.clip')].map((f) => [f.querySelector('b').textContent, f.querySelector('video').getAttribute('src'), f.querySelector('video').getAttribute('poster'), f.querySelector('video').preload])");
check("demo.json's freerdp-tk videos, each with its title and poster, loading nothing before play",
  JSON.stringify(clips) === JSON.stringify(JSON.parse(demoJson).clients.map((c) => [c.title, c.src, c.poster, "none"])), JSON.stringify(clips.map((c) => c[0])));
check("client.html: the link to all files, the fallback line gone", (await ev("document.getElementById('native').innerText")).includes("All files and checksums: " + want.url)
  && await ev("!document.getElementById('nativeFallback')"));
const cw = await ev("document.documentElement.scrollWidth");
check("client.html with install.json fits 390 px", cw <= 390, `${cw} px`);
await screenshot("client-phone.png");
await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
await sleep(300); await screenshot("client-wide.png");
for (const [label, json] of [["without install.json", null], ["with an install.json without clients", JSON.stringify({ ...want, clients: [] })]]) {
  await open(json, "client.html");
  check(`client.html ${label}: only the link to the kit's latest release`, await ev(`!!document.querySelector('#nativeFallback a[href="${LATEST}"]')`)
    && await ev("document.querySelectorAll('#native table, #native pre, #native video').length") === 0);
}
await screenshot("client-fallback.png");
check("no page errors on client.html", !logs.some((l) => l.startsWith("EXCEPTION")), logs.filter((l) => l.startsWith("EXCEPTION")).join("; "));

// every page with the header links to Get a server, then Get a client; Install as app is no
// longer in it (its page stays, linked from Get a client and the form's Direct TCP)
for (const page of readdirSync(web).filter((f) => f.endsWith(".html"))) {
  const html = readFileSync(join(web, page), "utf8");
  if (!html.includes('<nav aria-label="Help"')) continue;
  const nav = html.slice(html.indexOf('<nav aria-label="Help"'), html.indexOf("</nav>"));
  check(`${page}: Get a server, then Get a client in the header, no Install as app`,
    /<a href="server.html"( aria-current="page")? data-i18n="nav.server">Get a server<\/a>\s*<a href="client.html"( aria-current="page")? data-i18n="nav.client">Get a client<\/a>/.test(nav)
    && !nav.includes("install.html"));
}

writeFileSync(join(out, "server.log"), logs.join("\n") + "\n");
ws.close(); chrome.kill();
console.log(`${fails ? "FAILED" : "PASSED"}: screenshots and log in ${out}`);
process.exit(fails ? 1 : 0);
