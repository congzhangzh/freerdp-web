// The page with the real client, without any server: headless Chrome answers the page's
// requests itself (DevTools Fetch interception) from web/ and from a directory with a built
// client, with the COOP/COEP headers the client's threads need. Nothing listens anywhere;
// the connection attempt goes to a port where nothing listens and is expected to fail.
//
//   node test-page.mjs <dir with sdl-freerdp.js and sdl-freerdp.wasm> [out dir]
//
// e.g. the release kit's local build: node test-page.mjs ../rdp-release-kit/dist/wasm/web
// Checks: the client starts; the hosts (new, select, export encrypted, import); the session
// settings reach the client's command line, with the password masked in the log; the passkey
// vault switch; the mstsc shortcuts; no sideways scrolling at phone width. Screenshots go to the out dir (default out/). CHROME=<binary>
// picks another Chrome or Chromium.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";

const [runtimeArg, outArg] = process.argv.slice(2);
const runtimeDir = runtimeArg && resolve(runtimeArg);
if (!runtimeDir || !existsSync(join(runtimeDir, "sdl-freerdp.wasm"))) {
  console.error("usage: node test-page.mjs <dir with sdl-freerdp.js and sdl-freerdp.wasm> [out dir]"); process.exit(2);
}
const web = new URL("web/", import.meta.url).pathname;
const out = resolve(outArg || new URL("out/", import.meta.url).pathname);
mkdirSync(out, { recursive: true });
// short path: Chrome's singleton socket must fit the 107-char Unix socket limit
const base = new URL(".chrome/", import.meta.url).pathname;
mkdirSync(base, { recursive: true });
const profile = mkdtempSync(join(base, "page-"));
const port = 9400 + Math.floor(Math.random() * 500);
const chrome = spawn(process.env.CHROME || "google-chrome", ["--headless=new", `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`, "--no-first-run", "--enable-unsafe-swiftshader", "about:blank"],
  { stdio: "ignore", env: { ...process.env, TMPDIR: base } });
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
// localhost is a secure context, so the page can be cross-origin isolated; port 1 has no server:
// every request is answered here, the page's files first, then the client's
const ORIGIN = "http://localhost:1";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".wasm": "application/wasm", ".css": "text/css",
  ".png": "image/png", ".webmanifest": "application/manifest+json", ".md": "text/plain" };
function serve(m) {
  const path = decodeURIComponent(new URL(m.params.request.url).pathname).replace(/\/$/, "/index.html");
  const file = path.includes("..") ? null : [join(web, path), join(runtimeDir, path)].find((f) => existsSync(f));
  if (!file) return send("Fetch.fulfillRequest", { requestId: m.params.requestId, responseCode: 404, body: "" });
  send("Fetch.fulfillRequest", { requestId: m.params.requestId, responseCode: 200, body: readFileSync(file).toString("base64"),
    responseHeaders: [{ name: "Content-Type", value: TYPES[extname(file)] || "application/octet-stream" },
      { name: "Cross-Origin-Opener-Policy", value: "same-origin" }, { name: "Cross-Origin-Embedder-Policy", value: "require-corp" }] });
}
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result ?? m.error); pending.delete(m.id); }
  if (m.method === "Fetch.requestPaused") serve(m);
  if (m.method === "Runtime.consoleAPICalled") logs.push(m.params.args.map((a) => a.value ?? a.description).join(" "));
  if (m.method === "Runtime.exceptionThrown") logs.push("EXCEPTION " + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
});
const ev = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true, userGesture: true }))?.result?.value;
const key = (type, k, code, vk, modifiers) => send("Input.dispatchKeyEvent", { type, key: k, code, windowsVirtualKeyCode: vk, modifiers });
async function screenshot(name) {
  const r = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  writeFileSync(join(out, name), Buffer.from(r.data, "base64"));
}
let fails = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  (" + detail + ")" : ""}`); if (!ok) fails++; };

await send("Fetch.enable", { patterns: [{ urlPattern: ORIGIN + "/*" }] });
// the headers above already isolate the page; keep its isolation service worker out, since
// requests a service worker makes are not this page's to intercept
await send("Network.enable"); await send("Network.setBypassServiceWorker", { bypass: true });
await send("Runtime.enable"); await send("Page.enable");

// phone width first: the form must not scroll sideways
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
for (const page of ["index.html", "safety.html", "keyboard.html", "install.html", "release-notes.html"]) {
  await send("Page.navigate", { url: `${ORIGIN}/${page}` }); await sleep(1000);
  const w = await ev("document.documentElement.scrollWidth");
  check(`${page} fits 390 px`, w <= 390, `${w} px`);
}
await screenshot("page-phone.png");
await send("Emulation.clearDeviceMetricsOverride");
await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });

await send("Page.navigate", { url: `${ORIGIN}/index.html` });
let ready = false;
for (let i = 0; i < 120 && !ready; i++) { await sleep(500); ready = await ev("document.getElementById('status')?.textContent === 'ready'"); }
// the splash: with demo media (the Pages build adds demo/), on a first visit, closed by Skip
// and not shown again; without media, never
const hasDemo = existsSync(join(runtimeDir, "demo", "demo.json"));
const splashShown = () => ev("!document.getElementById('splash').hidden");
if (hasDemo) {
  for (let i = 0; i < 20 && !await splashShown(); i++) await sleep(200);
  check("the splash shows the demo on a first visit", await splashShown()
    && await ev("document.querySelectorAll('#splashTabs [role=tab]').length") >= 2);
  await screenshot("page-splash.png");
  await ev("document.getElementById('splashSkip').click(), true");
  check("Skip closes it, and the Demo link stays", !await splashShown() && await ev("!document.getElementById('demoOpen').hidden"));
  // each demo has an address: #intro the first, #<id> that one; the address bar follows the tabs
  const tabs = await ev("[...document.querySelectorAll('#splashTabs [role=tab]')].map(a => a.hash)");
  const selected = () => ev("[...document.querySelectorAll('#splashTabs [role=tab]')].findIndex(a => a.getAttribute('aria-selected') === 'true')");
  await ev(`location.hash = ${JSON.stringify(tabs[1])}, true`); await sleep(300);
  check(`${tabs[1]} opens that demo`, await splashShown() && await selected() === 1 && await ev("location.hash") === tabs[1]);
  await ev("document.querySelectorAll('#splashTabs [role=tab]')[2].click(), true"); await sleep(300);
  check("a tab puts its demo's address in the address bar, with sound",
    await selected() === 2 && await ev("location.hash") === tabs[2] && await ev("!document.getElementById('splashVideo').muted"),
    `${await ev("location.hash")}, muted ${await ev("document.getElementById('splashVideo').muted")}`);
  await ev("document.getElementById('splashSkip').click(), true");
  check("closing drops the address", !await splashShown() && await ev("location.hash") === "");
  await ev("location.hash = '#intro', true"); await sleep(300);
  check("#intro opens the first demo", await splashShown() && await selected() === 0 && await ev("location.hash") === tabs[0]);
  check("the demo's link is shown under it, as the address bar has it",
    await ev("document.getElementById('splashLink').href === location.href && document.getElementById('splashLink').textContent.endsWith(location.hash)"));
  // a demo's file name (its address before media.json's anchors) leads to it, under its lasting address
  const file = await ev("fetch('demo/demo.json').then(r => r.json()).then(d => d.videos[2].src.replace(/^.*\\//, '').replace(/\\.[^.]*$/, ''))");
  await ev(`location.hash = '#${file}', true`); await sleep(300);
  check(`#${file} leads to that demo, at ${tabs[2]}`, await selected() === 2 && await ev("location.hash") === tabs[2]);
  await ev("document.getElementById('splashSkip').click(), true");
  await ev("location.hash = '#no-such-demo', true"); await sleep(300);
  check("an anchor no demo has opens the first", await splashShown() && await selected() === 0 && await ev("location.hash") === tabs[0]);
  await ev("document.getElementById('splashSkip').click(), true");
} else {
  await sleep(500);
  check("no splash without demo media", !await splashShown() && await ev("document.getElementById('demoOpen').hidden"));
}
check("the client starts", ready && await ev("crossOriginIsolated"),
  ready ? "" : `status "${await ev("document.getElementById('status').textContent")}", isolated ${await ev("crossOriginIsolated")}; ${logs.slice(-3).join(" | ")}`);
check("the session settings start as recommended", await ev("document.getElementById('sessionSummary').textContent") === "recommended");

// the hosts: one at first; a new one gets its own settings; the form follows the selection
const hosts = () => ev("[...document.querySelectorAll('#hostList .host')].map(b => b.querySelector('b').textContent + (b.getAttribute('aria-checked') === 'true' ? '*' : ''))");
check("one host at first, selected", JSON.stringify(await hosts()) === JSON.stringify(["My server*"]));
const type = (id, value) => ev(`(() => { const e = document.getElementById('${id}'); e.value = ${JSON.stringify(value)};
  e.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
await type("user", "synthetic-user");
await ev("document.getElementById('hostNew').click(), true");
await type("hostName", "Lab"); await type("host", "127.0.0.1:13390"); await type("user", "lab-user");
check("New host: a second host, selected, named as typed", JSON.stringify(await hosts()) === JSON.stringify(["My server", "Lab*"]));
check("the SSH line: local port from the gateway, websockify on the server's 3390",
  await ev("document.getElementById('sshCmd').textContent") === "ssh -tt -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -o ExitOnForwardFailure=yes -L 127.0.0.1:13390:127.0.0.1:3390 lab-user@server websockify 127.0.0.1:3390 127.0.0.1:3389");
await ev("document.querySelector('#hostList .host').click(), true");
check("selecting a host shows its own settings", await ev("document.getElementById('user').value") === "synthetic-user"
  && await ev("document.getElementById('host').value") === "127.0.0.1:3390");

// the passkey vault is a per-host choice, off by default
const vaultShown = () => ev("!document.getElementById('vaultPanel').hidden");
check("the vault is off by default", !await vaultShown());
await ev("document.getElementById('vaultKeep').click(), true"); await sleep(200);
check("keeping this host's password in the vault shows the vault", await vaultShown());
await ev("document.getElementById('vaultKeep').click(), true"); await sleep(200);
check("turning it off hides it and keeps the user", !await vaultShown() && await ev("document.getElementById('user').value") === "synthetic-user");

// export, encrypted with a passphrase, then import the file
await send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: out });
const exported = join(out, "freerdp-web-hosts.encrypted.json");
rmSync(exported, { force: true });
await ev(`(() => { document.getElementById('hostExport').click(); document.getElementById('exportEncrypt').click();
  document.getElementById('exportPassphrase').value = 'synthetic passphrase';
  document.querySelector('#exportDialog button[value=ok]').click(); return true; })()`);
for (let i = 0; i < 40 && !existsSync(exported); i++) await sleep(250);
const file = existsSync(exported) ? readFileSync(exported, "utf8") : "";
check("export, encrypted: a file without readable hosts", file.includes('"encrypted"') && !file.includes("127.0.0.1") && !file.includes("lab-user"));
const doc = await send("DOM.getDocument", {});
const input = await send("DOM.querySelector", { nodeId: doc.root.nodeId, selector: "#hostImportFile" });
await send("DOM.setFileInputFiles", { nodeId: input.nodeId, files: [exported] });
for (let i = 0; i < 40 && !await ev("document.getElementById('importDialog').open"); i++) await sleep(100);
await ev(`(() => { document.getElementById('importPassphrase').value = 'synthetic passphrase';
  document.querySelector('#importDialog button[value=ok]').click(); return true; })()`);
for (let i = 0; i < 80 && (await hosts()).length < 4; i++) await sleep(250);   // PBKDF2 takes a moment
check("import with the passphrase adds the hosts, renamed", JSON.stringify((await hosts()).map((h) => h.replace("*", "")))
  === JSON.stringify(["My server", "Lab", "My server 2", "Lab 2"]));
await screenshot("page-hosts.png");
await ev("document.querySelector('#hostList .host').click(), true");

// the passkey vault, with a virtual passkey (PRF): a host's password saved encrypted, the
// IndexedDB record without it, and after a reload Connect unlocks the vault and gives the
// client exactly that password (read from the client's argv by this test, synthetic)
await send("WebAuthn.enable", { enableUI: false });
const { authenticatorId } = await send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", ctap2Version: "ctap2_1", transport: "internal",
  hasResidentKey: true, hasUserVerification: true, hasPrf: true, isUserVerified: true, automaticPresenceSimulation: true } });
const vaultText = () => ev("document.getElementById('vaultStatus').textContent");
const waitFor = async (expr, ms = 15000) => { for (let t = 0; t < ms && !await ev(expr); t += 200) await sleep(200); return ev(expr); };
await ev("document.querySelectorAll('#hostList .host')[1].click(), true");   // "Lab"
await ev("document.getElementById('vaultKeep').click(), true");
await waitFor("!document.getElementById('vaultCreate').hidden");
await ev("document.getElementById('vaultCreate').click(), true");
await waitFor("!document.getElementById('vaultSave').hidden && !document.getElementById('vaultSave').disabled");
await ev("document.getElementById('pass').value = 'vault-synthetic-pw', true");
await ev("document.getElementById('vaultSave').click(), true");
check("vault: a host's password saved with a passkey", await waitFor("document.getElementById('vaultStatus').textContent.startsWith('Saved in the vault')"), await vaultText());
const record = await ev(`new Promise((done) => { const r = indexedDB.open('freerdp-credential-vault', 1);
  r.onsuccess = () => { const g = r.result.transaction('vault').objectStore('vault').get('default'); g.onsuccess = () => done(JSON.stringify(g.result)); }; })`);
check("vault: IndexedDB holds no password, user or address", !/vault-synthetic-pw|lab-user|13390/.test(record) && record.includes("ciphertext"));
await send("Page.reload");
for (let i = 0; i < 120 && !await ev("document.getElementById('status')?.textContent === 'ready'"); i++) await sleep(500);
await ev("document.querySelectorAll('#hostList .host')[1].click(), true");
check("vault: after a reload the host says its password is saved", (await vaultText()).startsWith("Saved. Connect asks"));
await ev("window.__argv = null; window.__callMain = Module.callMain; Module.callMain = (a) => { window.__argv = a.slice(); return window.__callMain(a); }; true");
await ev("document.getElementById('go').click(), true");
// a person moves the mouse: with the virtual passkey, the headless page's tasks wait for input
await sleep(1000);
await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 20, y: 20 });
await waitFor("window.__argv !== null");
check("vault: Connect unlocks it and the client gets the saved password",
  await ev("window.__argv?.includes('/p:vault-synthetic-pw') && window.__argv.includes('/u:lab-user')"),
  await ev("window.__argv ? '' : 'status: ' + document.getElementById('status').textContent"));
await ev("window.__argv = null; true");
await send("Page.reload");   // callMain runs once per page: a fresh page for the checks below
for (let i = 0; i < 120 && !await ev("document.getElementById('status')?.textContent === 'ready'"); i++) await sleep(500);
// the vault's passkey is gone (removed from the system, or kept on another device): Delete the
// vault, clicked twice, starts over without it; the host stays, its saved password goes
await send("WebAuthn.clearCredentials", { authenticatorId });
await ev("document.querySelectorAll('#hostList .host')[1].click(), true");
await ev("document.getElementById('vaultDelete').click(), true"); await sleep(300);
const armed = await ev("document.getElementById('vaultDelete').textContent + ' | ' + document.getElementById('hostStatus').textContent");
await ev("document.getElementById('vaultDelete').click(), true");
await waitFor("!document.getElementById('vaultCreate').hidden");
const gone = await ev(`new Promise((done) => { const r = indexedDB.open('freerdp-credential-vault', 1);
  r.onsuccess = () => { const g = r.result.transaction('vault').objectStore('vault').get('default'); g.onsuccess = () => done(g.result === undefined); }; })`);
check("vault: Delete the vault asks twice, then deletes it without its passkey", /click again/.test(armed) && /1 saved password/.test(armed)
  && gone && !await ev("FreeRDPHostsUI.current().vaultSaved"), armed);
await ev("document.getElementById('vaultCreate').click(), true");
check("vault: a new passkey creates a new vault after that", await waitFor("!document.getElementById('vaultSave').hidden && !document.getElementById('vaultSave').disabled"),
  await vaultText());
await ev("document.getElementById('vaultLock').click(), document.querySelector('#hostList .host').click(), true");
logs.length = 0;

// session settings as a user clicks them; the mstsc shortcuts; a gateway port with no server
await ev(`(() => { for (const s of ['input[name=codec][value="av1-420"]', 'input[name=strategy][value="bandwidth"]',
  '#optClipboard', 'input[name=keys][value="mstsc"]', '#sessionPanel > summary']) document.querySelector(s).click();
  document.getElementById('host').value = '127.0.0.1:1'; document.getElementById('user').value = 'synthetic-user';
  document.getElementById('pass').value = 'synthetic-password';
  return true; })()`);
const expected = "/gfx:AV1:i420 /sound -clipboard /network:broadband-low +compression /compression-level:2";
check("the settings preview", await ev("document.getElementById('preview').textContent") === expected);
await screenshot("page-settings.png");
await ev("document.getElementById('go').click(), true");
await sleep(4000);
const cmd = logs.find((l) => l.startsWith("[page] sdl-freerdp ")) || "";
check("the client gets the settings", cmd.endsWith(expected), cmd.slice(19));
check("the password is masked in the log", cmd.includes("/p:***") && !logs.some((l) => l.includes("synthetic-password")));
check("the password field is cleared", await ev("document.getElementById('pass').value") === "");
check("the client tried to connect", logs.some((l) => /ERRCONNECT_|tcp-shim|WebSocket/.test(l)));
await ev("document.getElementById('canvas').focus(), true");
await key("rawKeyDown", "Control", "ControlLeft", 17, 2); await key("rawKeyDown", "Alt", "AltLeft", 18, 3);
await key("rawKeyDown", "End", "End", 35, 3); await key("keyUp", "End", "End", 35, 3);
await key("keyUp", "Alt", "AltLeft", 18, 2); await key("keyUp", "Control", "ControlLeft", 17, 0);
await sleep(300);
check("mstsc: Ctrl + Alt + End sends Ctrl + Alt + Delete", logs.includes("[page] Ctrl + Alt + End: sent Ctrl + Alt + Delete"));
// a host's link: ?v=<address> selects the saved host with it, or adds one; Copy link gives it
// a host not selected now, with an address no other host has (the checks above changed some)
const pick = await ev(`(() => {
  const all = [...document.querySelectorAll('#hostList .host')].map((b, i) => ({ i, on: b.getAttribute('aria-checked') === 'true',
    where: b.querySelector('span').textContent.split(' @ ').pop() }));
  return all.find((h) => !h.on && all.filter((o) => o.where === h.where).length === 1);
})()`);
await send("Page.navigate", { url: `${ORIGIN}/index.html?v=${pick.where}` }); await sleep(1500);
check(`a link with a saved host's address selects that host (${pick.where})`,
  (await hosts())[pick.i].endsWith("*") && await ev("location.search") === "", `${JSON.stringify(await hosts())}, ${await ev("location.search")}`);
await send("Page.navigate", { url: `${ORIGIN}/index.html?v=192.0.2.7:3390` }); await sleep(1500);
const linked = await hosts();
check("a link with a new address adds a host for it", linked.length === 5 && linked[4] === "192.0.2.7:3390*"
  && await ev("document.getElementById('host').value") === "192.0.2.7:3390", JSON.stringify(linked));
await ev("document.getElementById('hostLink').click(), true"); await sleep(300);
check("Copy link gives the host's link", (await ev("document.getElementById('hostStatus').textContent")).includes("/index.html?v=192.0.2.7:3390"),
  await ev("document.getElementById('hostStatus').textContent"));
check("no page errors", !logs.some((l) => l.startsWith("EXCEPTION")), logs.filter((l) => l.startsWith("EXCEPTION")).join("; "));

writeFileSync(join(out, "page.log"), logs.join("\n") + "\n");
ws.close(); chrome.kill();
console.log(`${fails ? "FAILED" : "PASSED"}: screenshots and log in ${out}`);
process.exit(fails ? 1 : 0);
