// The page with the real client, without any server: headless Chrome answers the page's
// requests itself (DevTools Fetch interception) from web/ and from a directory with a built
// client, with the COOP/COEP headers the client's threads need. Nothing listens anywhere;
// the connection attempt goes to a port where nothing listens and is expected to fail.
//
//   node test-page.mjs <dir with sdl-freerdp.js and sdl-freerdp.wasm> [out dir]
//
// e.g. the release kit's local build: node test-page.mjs ../rdp-release-kit/dist/wasm/web
// Checks: the client starts; the session settings reach the client's command line, with the
// password masked in the log; the passkey vault switch; the mstsc shortcuts; no sideways
// scrolling at phone width. Screenshots go to the out dir (default out/). CHROME=<binary>
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
for (const page of ["index.html", "safety.html", "keyboard.html", "install.html"]) {
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
check("the client starts", ready && await ev("crossOriginIsolated"),
  ready ? "" : `status "${await ev("document.getElementById('status').textContent")}", isolated ${await ev("crossOriginIsolated")}; ${logs.slice(-3).join(" | ")}`);
check("the session settings start as recommended", await ev("document.getElementById('sessionSummary').textContent") === "recommended");

// the vault is off by default; turning it on shows it, off hides it and keeps what was typed
const vaultShown = () => ev("!document.getElementById('vaultPanel').hidden");
await ev("document.getElementById('user').value = 'synthetic-user', true");
check("the vault is off by default", !await vaultShown());
await ev("document.getElementById('vaultEnable').click(), true"); await sleep(300);
check("turning the vault on shows it", await vaultShown());
await ev("document.getElementById('vaultEnable').click(), true"); await sleep(300);
check("turning it off hides it and keeps the user", !await vaultShown() && await ev("document.getElementById('user').value") === "synthetic-user");

// session settings as a user clicks them; the mstsc shortcuts; a gateway port with no server
await ev(`(() => { for (const s of ['input[name=codec][value="av1-420"]', 'input[name=strategy][value="bandwidth"]',
  '#optClipboard', 'input[name=keys][value="mstsc"]', '#sessionPanel > summary']) document.querySelector(s).click();
  document.getElementById('host').value = '127.0.0.1:1'; document.getElementById('pass').value = 'synthetic-password';
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
check("no page errors", !logs.some((l) => l.startsWith("EXCEPTION")), logs.filter((l) => l.startsWith("EXCEPTION")).join("; "));

writeFileSync(join(out, "page.log"), logs.join("\n") + "\n");
ws.close(); chrome.kill();
console.log(`${fails ? "FAILED" : "PASSED"}: screenshots and log in ${out}`);
process.exit(fails ? 1 : 0);
