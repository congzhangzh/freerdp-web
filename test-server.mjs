// The pages "Get a server" (web/server.html) and "Get a client" (web/client.html), without any
// server: headless Chrome answers the page's requests itself (DevTools Fetch interception) from
// web/, and install.json, which the release kit writes next to the page, from
// test-server-install.json, or not at all, or broken.
//
//   node test-server.mjs [out dir]
//
// Checks: tabs for each system, Notes and each family of distributions, one of each shown, a link
// to any section opening its tabs; a card per distribution, each command with a Copy button that
// copies it; the start command; the Linux host; the session manager only when install.json has it;
// no client on it; the link to all files; no sideways scrolling at phone width in any tab; without install.json, or with a broken one, only the link to the kit's latest
// release. Get a client: the two ways in the browser, uvx, the offline pack, pip, freerdp-tk, its
// videos, the same fallback. Every page's header links to both, Get a client right after Get a server, and none
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
    caption: "The Start menu, Notepad, typing." }],
  mac: [{ title: "FreeRDP shadow server + macOS, AV1", src: "demo/mac-host.mp4", poster: "demo/mac-host.jpg",
    caption: "Apps open and close." }] });
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
  // a page can only be loaded afresh from another one: the same address with a new # is no load
  await send("Page.navigate", { url: "about:blank" });
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
const cards = await ev("[...document.querySelectorAll('#kit [data-tab=family] .distro')].map((c) => c.querySelector('h5').textContent)");
check("a card per distribution with a name and a command", JSON.stringify(cards) === JSON.stringify(["Debian 13", "Ubuntu 26.04", "Fedora 45", "Fedora 44"]), JSON.stringify(cards));
const tabsOf = (group) => ev(`[...document.querySelectorAll('.tabs[data-group=${group}] a')].map((a) => a.hash)`);
const shown = (group) => ev(`[...document.querySelectorAll('[data-tab=${group}]')].filter((p) => !p.hidden).map((p) => p.id)`);
const current = (group) => ev(`[...document.querySelectorAll('.tabs[data-group=${group}] a[aria-current]')].map((a) => a.hash)`);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
check("a tab per system, then Notes, and a tab per family of distributions",
  same(await tabsOf("system"), ["#linux", "#windows", "#macos", "#notes"]) && same(await tabsOf("family"), ["#server-debian", "#server-ubuntu", "#server-fedora"]));
check("Linux and its first family show at first, and only they", same(await shown("system"), ["linux"]) && same(await shown("family"), ["server-debian"])
  && same(await current("system"), ["#linux"]) && same(await current("family"), ["#server-debian"]));
check("under Linux: the shadow server, xrdp, the desktop's own server",
  same(await ev("[...document.querySelectorAll('#linux h3')].map((h) => h.id)"), ["linux-shadow", "xrdp", "linux-own"]));
check("the safety line is above the tabs, with its link, and Then connect is gone",
  await ev("!!document.querySelector('main > p a[href=\"safety.html\"]') && document.querySelector('main > p a[href=\"safety.html\"]').compareDocumentPosition(document.querySelector('.tabs')) === Node.DOCUMENT_POSITION_FOLLOWING")
  && await ev("![...document.querySelectorAll('main h2')].some((h) => h.textContent === 'Then connect')"));
// a click on a tab: it shows, its address can be copied, and the page does not move
await ev("window.scrollTo(0, 120); document.querySelector('.tabs[data-group=system] a[href=\"#windows\"]').click(), true"); await sleep(100);
check("a click on a tab shows it alone and puts it in the address, without moving the page",
  same(await shown("system"), ["windows"]) && same(await current("system"), ["#windows"]) && await ev("location.hash") === "#windows" && await ev("scrollY") === 120, String(await ev("scrollY")));
await ev("document.querySelector('.tabs[data-group=system] a[href=\"#linux\"]').click(); document.querySelector('.tabs[data-group=family] a[href=\"#server-fedora\"]').click(), true"); await sleep(100);
check("a click on a distribution leaves the system's tab alone", same(await shown("system"), ["linux"]) && same(await shown("family"), ["server-fedora"]));
// the page's language draws it again: what the reader chose stays
await ev("(() => { const s = document.getElementById('lang'); s.value = 'zh'; s.dispatchEvent(new Event('change')); return true; })()"); await sleep(300);
check("a change of language keeps the tabs", same(await shown("system"), ["linux"]) && same(await shown("family"), ["server-fedora"]) && same(await current("family"), ["#server-fedora"]));
await ev("(() => { const s = document.getElementById('lang'); s.value = 'en'; s.dispatchEvent(new Event('change')); localStorage.removeItem('freerdp-web-lang'); return true; })()"); await sleep(300);
// links to a section from before the tabs, and from outside the page
for (const [hash, system, family] of [["#windows", "windows", null], ["#macos", "macos", null], ["#av2", "notes", null], ["#notes", "notes", null], ["#server-fedora", "linux", "server-fedora"],
  ["#server-ubuntu", "linux", "server-ubuntu"], ["#xrdp", "linux", "server-debian"], ["#linux-shadow", "linux", "server-debian"], ["#no-such-section", "linux", "server-debian"]]) {
  await open(sample, "server.html" + hash);
  check(`a link to ${hash} opens its tabs`, same(await shown("system"), [system]) && (!family || same(await shown("family"), [family])), JSON.stringify(await shown("system")));
}
await ev("location.hash = '#windows', true"); await sleep(200);
check("a link followed inside the page opens its tab too", same(await shown("system"), ["windows"]));
await open(sample);
const first = await ev("document.querySelector('#kit [data-tab=family] .distro')?.innerText") || "";
check("a card shows its sessions, a line per kind, and its more commands",
  first.replace(/\n+/g, "\n").includes("Wayland: GNOME, KDE Plasma, sway\nXorg: the default session") && first.includes(want.server[0].more[0].what + ":"),
  first.split("\n").slice(0, 3).join(" | "));
const old = await ev("document.querySelectorAll('#kit [data-tab=family] .distro')[1]?.textContent") || "";
check("an older install.json's sessions stay one line", old.includes("Sessions: " + want.server[1].sessions), old.split("\n").slice(0, 2).join(" | "));
const pres = await ev("[...document.querySelectorAll('#kit .copyable')].map((c) => [c.querySelector('pre').textContent, !!c.querySelector('button[data-copy]')])");
const usable = want.linux.filter((l) => l.url.startsWith("https:"));
const commands = [...usable.map((l) => l.command), want.linux[0].kickstart, want.linux[0].remove,
  want.server[0].command, want.server[0].more[0].command, want.server[1].command, want.server[2].command, want.server[3].command, want.start,
  want.windows.command, want.windows.remove,
  want.mac[0].command, want.mac[1].command, "launchctl kickstart -k gui/$(id -u)/org.freerdp.shadow", want.mac[0].remove,
  ...(want.av2 ? [want.av2.command] : [])];
check("every command, the more ones and the start one, has a Copy button", JSON.stringify(pres) === JSON.stringify(commands.map((c) => [c, true])),
  `${pres.length} commands`);
// what the button hands the clipboard (the system clipboard stays untouched)
await ev("window.__copied = null; navigator.clipboard.writeText = async (t) => { window.__copied = t; }; true");
const copyAt = usable.length + 2 + 3;   // the Fedora 45 card's: after the Linux host's commands, and Debian's two and Ubuntu's
await ev(`document.querySelectorAll('#kit .copyable button')[${copyAt}].click(), true`); await sleep(300);
const copied = String(await ev("window.__copied"));
check("Copy copies the command exactly", copied === want.server[2].command && await ev(`document.querySelectorAll('#kit .copyable button')[${copyAt}].textContent`) === "Copied", copied.slice(0, 60));
check("the link to all files and checksums", await ev(`[...document.querySelectorAll('#kit a')].some((a) => a.href === ${JSON.stringify(want.url)} && a.textContent === ${JSON.stringify(want.url)})`)
  && (await ev("document.getElementById('notes').textContent")).includes("All files and checksums: " + want.url));
check("the fallback line is gone", await ev("!document.getElementById('kitFallback')"));
// AV2 (install.json's av2) is in Notes, in the page's own words: AV2 is on, and the line puts AV1 first
if (want.av2) check("AV2: in Notes, not under xrdp, says it is on, with its line and a Copy button",
  await ev(`(() => { const h = document.querySelector('#notes h3#av2'); const c = h?.nextElementSibling?.nextElementSibling;
    return !!c && c.matches('.copyable') && c.querySelector('pre').textContent === ${JSON.stringify(want.av2.command)} && h.nextElementSibling.textContent.startsWith('AV2 is on'); })()`) === true
  && await ev("!document.querySelector('#linux #av2')"));
check("the Linux host: a card per processor (a link that is not https left out), its archives linked, its restart and removal",
  same(await ev("[...document.querySelectorAll('#linux-shadow ~ .distros section[aria-label^=Linux] h5')].map((h) => h.textContent)"), usable.map((l) => l.platform))
  && await ev(`${JSON.stringify(usable.map((l) => l.url))}.every((u) => [...document.querySelectorAll('#linux a')].some((a) => a.href === u))`));
check("no session manager without its field", await ev("!document.getElementById('session-manager')"));
check("Windows: its tab has its own Remote Desktop and the shadow server, the archive linked",
  await ev("document.querySelectorAll('#windows h3').length") === 2 && await ev(`[...document.querySelectorAll('#windows a')].some((a) => a.href === ${JSON.stringify(want.windows.url)})`));
check("the Windows host's video in its tab, the Mac host's in its own",
  await ev("document.querySelector('#windows video')?.getAttribute('src')") === "demo/windows-host.mp4" && await ev("document.querySelector('#macos video')?.getAttribute('src')") === "demo/mac-host.mp4"
  && await ev("document.querySelectorAll('#kit video').length") === 2);
check("macOS: a card per processor (a link that is not https left out), both archives linked",
  same(await ev("[...document.querySelectorAll('#macos section.distro h5')].map((h) => h.textContent)"), ["Apple Silicon", "Intel"])
  && await ev(`${JSON.stringify(want.mac.slice(0, 2).map((m) => m.url))}.every((u) => [...document.querySelectorAll('#macos a')].some((a) => a.href === u))`));
check("no client, no freerdp-tk: they are on Get a client", await ev("document.querySelectorAll('#clients, #freerdp-tk').length") === 0);
// every tab at phone width: what is hidden has no width to measure
for (const id of ["linux", "windows", "macos", "notes", "server-ubuntu", "server-fedora"]) {
  await ev(`document.querySelector('.tabs a[href="#${id}"]').click(), true`); await sleep(100);
  const width = await ev("document.documentElement.scrollWidth");
  check(`server.html's ${id} fits 390 px, its long commands inside their box`, width <= 390
    && await ev("[...document.querySelectorAll('#kit pre')].filter((p) => p.offsetParent).every((p) => p.scrollWidth <= p.clientWidth + 1)"), `${width} px`);
}
await ev("document.querySelector('.tabs a[href=\"#linux\"]').click(), true");
// the session manager: its section only when the kit writes the field, which it does once a host confirms it
const withSesman = { ...want, sesman: { command: "sudo systemctl enable --now freerdp-shadow-sesman.service", headless: "sudo groupadd -f freerdp-headless", remove: "sudo rm -r /opt/freerdp-host" } };
await open(JSON.stringify(withSesman));
check("the session manager: its section, its commands and its warning, with the field",
  same(await ev("[...document.querySelectorAll('#session-manager ~ .copyable pre')].map((p) => p.textContent).slice(0, 3)"), [withSesman.sesman.command, withSesman.sesman.headless, withSesman.sesman.remove])
  && /before any password/.test(await ev("document.querySelector('#linux .warn')?.textContent") || "") && /WebSocket gateway/.test(await ev("document.querySelector('#linux .warn')?.textContent") || ""));
const noLinux = { ...withSesman }; delete noLinux.linux;
await open(JSON.stringify(noLinux));
check("an older install.json without the Linux host: no shadow section and no session manager, xrdp still there",
  await ev("!document.getElementById('linux-shadow') && !document.getElementById('session-manager') && !document.querySelector('a[href=\"#linux-shadow\"]')")
  && await ev("!!document.querySelector('#xrdp') && !!document.querySelector('#linux-own')"));
await open(sample);
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
check("client.html: the browser's two ways, the native client's three, then freerdp-tk",
  same(await ev("[...document.querySelectorAll('main h2, main h3')].map((h) => h.id)"), ["browser", "page", "app", "native-clients", "uvx", "offline", "pip", "freerdp-tk"])
  && await ev("!!document.querySelector('#app ~ p a[href=\"install.html\"]')"));
const clients = await ev("[...document.querySelectorAll('#clients tr')].slice(1).map((r) => [r.cells[0].textContent, r.cells[1].textContent, r.querySelector('a').href])");
check("the clients table: platform and file link, a link that is not https left out",
  JSON.stringify(clients) === JSON.stringify(want.clients.slice(0, 2).map((c) => [c.platform, c.file, c.url])), JSON.stringify(clients.map((c) => c[0])));
check("uvx and pip each with their line and a Copy button, around the offline pack's table", await ev("document.querySelector('#clients + h3')?.id") === "pip"
  && same(await ev("[...document.querySelectorAll('#native .copyable')].map((c) => [c.querySelector('pre').textContent, !!c.querySelector('button[data-copy]')])"),
    [["uvx freerdp-tk", true], ["pip install freerdp-tk", true]]));
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
