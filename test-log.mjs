// The Log: it follows new lines, it can be paused, and what you select in it stays selected.
// Real mouse and key events in headless Chrome; the page's requests are answered here, as in
// test-page.mjs, and no server is needed. The session's look is set by hand (body.session): the
// keys go by focus, and a real session's canvas is the same element.
//
//   node test-log.mjs <dir with sdl-freerdp.js and sdl-freerdp.wasm>
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { extname, join, resolve } from "node:path";

const runtimeDir = process.argv[2] && resolve(process.argv[2]);
if (!runtimeDir || !existsSync(join(runtimeDir, "sdl-freerdp.wasm"))) {
  console.error("usage: node test-log.mjs <dir with sdl-freerdp.js and sdl-freerdp.wasm>"); process.exit(2);
}
const web = new URL("web/", import.meta.url).pathname;
const base = new URL(".chrome/", import.meta.url).pathname;
mkdirSync(base, { recursive: true });
const profile = mkdtempSync(join(base, "log-"));
const port = 9900 + Math.floor(Math.random() * 90);
const chrome = spawn(process.env.CHROME || "google-chrome", ["--headless=new", `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`, "--no-first-run", "--enable-unsafe-swiftshader", "--window-size=1280,900", "about:blank"],
  { stdio: "ignore", env: { ...process.env, TMPDIR: base } });
chrome.on("exit", () => {
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
let id = 0; const pending = new Map();
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ORIGIN = "http://localhost:1";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".wasm": "application/wasm", ".css": "text/css",
  ".png": "image/png", ".webmanifest": "application/manifest+json" };
function serve(m) {
  const path = decodeURIComponent(new URL(m.params.request.url).pathname).replace(/\/$/, "/index.html");
  const file = path.includes("..") ? null : [join(web, path), join(runtimeDir, path)].find((f) => existsSync(f));
  if (!file) return send("Fetch.fulfillRequest", { requestId: m.params.requestId, responseCode: 404, body: "" });
  send("Fetch.fulfillRequest", { requestId: m.params.requestId, responseCode: 200, body: readFileSync(file).toString("base64"),
    responseHeaders: [{ name: "Content-Type", value: TYPES[extname(file)] || "application/octet-stream" },
      { name: "Cross-Origin-Opener-Policy", value: "same-origin" }, { name: "Cross-Origin-Embedder-Policy", value: "require-corp" }] });
}
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result ?? m.error); pending.delete(m.id); }
  if (m.method === "Fetch.requestPaused") serve(m);
});
const ev = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true, userGesture: true }))?.result?.value;
const click = async (selector) => {
  const r = await ev(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.scrollIntoView({ block: "nearest" });
    const r = el.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2;
    if (!el.contains(document.elementFromPoint(x, y))) throw new Error("not reachable: " + ${JSON.stringify(selector)}); return { x, y }; })()`);
  if (!r) { console.error("cannot click " + selector); chrome.kill(); process.exit(1); }
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", ...r });
  for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, ...r, button: "left", clickCount: 1 });
  await sleep(50);
};
// a real key with Ctrl held; `commands` is what the browser itself does with it unless the page prevents it
async function ctrl(k, command) {
  const key = { key: k, code: "Key" + k.toUpperCase(), windowsVirtualKeyCode: k.toUpperCase().charCodeAt(0), modifiers: 2 };
  await send("Input.dispatchKeyEvent", { type: "keyDown", ...key, commands: [command] });
  await send("Input.dispatchKeyEvent", { type: "keyUp", ...key });
  await sleep(50);
}
let fails = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  (" + detail + ")" : ""}`); if (!ok) fails++; };
const logEl = "document.getElementById('log')";
const atBottom = () => ev(`(() => { const l = ${logEl}; return l.scrollHeight - l.scrollTop - l.clientHeight < 4; })()`);
const selected = () => ev("getSelection().toString()");
const lines = (n, tag) => ev(`(() => { for (let i = 0; i < ${n}; i++) log("[test] ${tag} " + i); return true; })()`);
const autoScroll = () => ev("document.getElementById('logFollow').checked");
const unseen = () => ev("document.getElementById('logNew')?.textContent ?? ''");

await send("Fetch.enable", { patterns: [{ urlPattern: ORIGIN + "/*" }] });
await send("Network.enable"); await send("Network.setBypassServiceWorker", { bypass: true });
await send("Runtime.enable"); await send("Page.enable");
await send("Browser.grantPermissions", { origin: ORIGIN, permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"] });
const seeded = await send("Page.addScriptToEvaluateOnNewDocument", { source: `try { localStorage.setItem("freerdp-web-lastlog", JSON.stringify({ state: "running", time: 0, lines: ["saved line"] })); } catch (e) {}` });
await send("Page.navigate", { url: ORIGIN + "/index.html" });
for (let i = 0; i < 100 && !await ev("typeof log === 'function' && document.readyState === 'complete'"); i++) await sleep(100);
await ev("document.getElementById('splash').hidden = true; document.getElementById('logPanel').open = true");
await sleep(100);

// following, ticked by default
check("Auto-scroll is ticked at first", await autoScroll());
check("it is a check box with a label", await ev("document.getElementById('logFollow').type === 'checkbox' && document.getElementById('logFollow').labels[0].textContent.trim() === 'Auto-scroll'"));
await lines(300, "first");
check("new lines follow: the end of the log is in view", await atBottom());
await ev(`${logEl}.scrollTop = 0`); await sleep(50);
const top = await ev(`${logEl}.scrollTop`);
await lines(3, "while reading"); await sleep(50);
check("scrolled up: new lines leave the view where it is", top === 0 && await ev(`${logEl}.scrollTop`) === 0);
check("scrolled up: it says how many lines came", /\b3\b/.test(await unseen()), await unseen());
check("scrolled up: Auto-scroll is unticked", !await autoScroll(), `ticked: ${await autoScroll()}`);
await click("#logFollow"); await sleep(50);
check("ticked again: back at the end", await atBottom());
await lines(1, "after resume"); await sleep(50);
check("ticked again: following again", await atBottom() && await autoScroll() && await unseen() === "");

// Auto-scroll unticked by hand, at the end of the log
await click("#logFollow"); await sleep(50);
check("unticked: Auto-scroll is unticked", !await autoScroll(), `ticked: ${await autoScroll()}`);
const paused = await ev(`${logEl}.scrollTop`);
await lines(40, "paused"); await sleep(50);
check("unticked: new lines leave the view where it is", await ev(`${logEl}.scrollTop`) === paused);
check("unticked: the lines are kept, not dropped", await ev(`${logEl}.textContent.includes('paused 39')`));
await ev(`${logEl}.scrollTop = ${logEl}.scrollHeight`); await sleep(50);
await lines(1, "still paused"); await sleep(50);
check("unticked: scrolling to the end does not undo it", !await atBottom() && !await autoScroll());
await click("#logFollow"); await sleep(50);

// the keys
await click("#log");
check("a click in the log gives it the keys", await ev("document.activeElement.id") === "log", await ev("document.activeElement.tagName"));
await ctrl("a", "selectAll");
const all = await ev(`${logEl}.textContent`);
// a selection's text drops the newline at its very end
check("Ctrl + A selects the log, nothing else", await selected() === all.trimEnd(), `${(await selected()).length} of ${all.length} characters`);
check("a selection pauses the log", !await autoScroll(), `ticked: ${await autoScroll()}`);
await lines(5, "while selected"); await sleep(50);
check("new lines leave the selection alone", await selected() === all, `${(await selected()).length} of ${all.length} characters`);
await ctrl("c", "copy");
const copied = await ev("navigator.clipboard.readText()");
check("Ctrl + C copies the selection", copied.replace(/\r/g, "") === all, `${copied.length} characters`);
await click("#logFollow"); await sleep(50);
check("ticking clears the selection and follows", await selected() === "" && await atBottom());

// a drag with the mouse, as when you pick a few lines
await ev(`getSelection().removeAllRanges(); ${logEl}.scrollTop = 0`); await sleep(50);
const box = await ev(`(() => { ${logEl}.scrollIntoView({ block: "nearest" }); const r = ${logEl}.getBoundingClientRect(); return { x: r.x + 12, y: r.y + 14, w: r.width, h: r.height }; })()`);
await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: box.x, y: box.y });
await send("Input.dispatchMouseEvent", { type: "mousePressed", x: box.x, y: box.y, button: "left", clickCount: 1 });
await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: box.x + 200, y: box.y + 45, button: "left", buttons: 1 });
await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: box.x + 200, y: box.y + 45, button: "left", clickCount: 1 });
await sleep(50);
const picked = await selected();
check("a drag selects a few lines", picked.includes("\n") && picked.length < 400, `${picked.length} characters`);
await lines(5, "while dragged"); await sleep(50);
check("new lines leave a dragged selection alone", picked !== "" && await selected() === picked, `${(await selected()).length} of ${picked.length} characters`);
await ev("getSelection().removeAllRanges()");
await click("#logFollow"); await sleep(50);

// the Copy button
await ev("navigator.clipboard.writeText('old')");
await click("#logCopy"); await sleep(100);
check("Copy takes the whole log, with no selecting", await ev("navigator.clipboard.readText()") === await ev(`${logEl}.textContent`));

// the keys of a session stay the remote desktop's: on the canvas, the log takes none of them
await ev("document.body.classList.add('session'); getSelection().removeAllRanges(); globalThis.onCanvas = 0; " +
  "document.getElementById('canvas').addEventListener('keydown', (e) => { onCanvas++; e.preventDefault(); }); document.getElementById('canvas').focus()");
await ctrl("a", "selectAll");
check("in a session, Ctrl + A on the remote desktop reaches the canvas, not the log",
  await ev("onCanvas") === 1 && await ev("document.activeElement.id") === "canvas" && await selected() === "");
await ev("document.body.classList.remove('session')");

// closed and opened again: the newest lines, unless paused
await ev("document.getElementById('logPanel').open = false");
await lines(50, "closed"); await sleep(50);
await ev("document.getElementById('logPanel').open = true"); await sleep(100);
check("opened again: the end of the log is in view", await atBottom());

// a saved log from a crash opens in the Last session tab
const before = await ev(`${logEl}.textContent`);
await ev("document.getElementById('lastlog').hidden = false"); await click("#lastlogShow"); await sleep(100);
check("Show: the saved log opens in its own tab", await ev("document.getElementById('logLast').textContent.startsWith('FreeRDP Web: last session ended unexpectedly')") && await ev(`${logEl}.hidden`));
check("Show: this page's log is left as it was", await ev(`${logEl}.textContent`) === before);
await click("#logLastTab"); await sleep(50);
check("the tab goes back to this page's log, still following", !await ev(`${logEl}.hidden`) && await atBottom() && await autoScroll());

// a flood, as when something goes wrong: lines every millisecond while you scroll up with the wheel
await ev(`getSelection().removeAllRanges(); ${logEl}.scrollTop = ${logEl}.scrollHeight; globalThis.flood = setInterval(() => { for (let i = 0; i < 20; i++) log("[test] flood " + performance.now()); }, 1); true`);
await sleep(300);
check("a flood: it follows until you touch it", await atBottom() && await autoScroll());
const wheelAt = await ev(`(() => { ${logEl}.scrollIntoView({ block: "nearest" }); const r = ${logEl}.getBoundingClientRect(); return { x: r.x + 100, y: r.y + 60 }; })()`);
for (let i = 0; i < 400; i++) {
  await send("Input.dispatchMouseEvent", { type: "mouseWheel", ...wheelAt, deltaX: 0, deltaY: -2000 });
  if (!await autoScroll() && await ev(`${logEl}.scrollTop`) === 0) break;
  await sleep(20);
}
check("a flood: the wheel stops it and reaches the first line", !await autoScroll() && await ev(`${logEl}.scrollTop`) === 0, `scrollTop ${await ev(`${logEl}.scrollTop`)}, of ${await ev(`${logEl}.scrollHeight`)}`);
await sleep(1000);
check("a flood: a second later the view is still at the first line", await ev(`${logEl}.scrollTop`) === 0, `scrollTop ${await ev(`${logEl}.scrollTop`)}, of ${await ev(`${logEl}.scrollHeight`)}`);
check("a flood: the lines kept coming below", parseInt((await unseen()).replace(/\D/g, "")) > 100, await unseen());
await ev("clearInterval(flood)");
await click("#logFollow"); await sleep(50);

// a flood with the box unticked first, then the top
await ev(`globalThis.flood = setInterval(() => { for (let i = 0; i < 20; i++) log("[test] flood " + performance.now()); }, 1); true`);
await sleep(200); await click("#logFollow");
await ev(`${logEl}.scrollTop = 0`); await sleep(1000);
check("a flood: unticked, then the top, stays at the top", await ev(`${logEl}.scrollTop`) === 0 && !await autoScroll());
check("a flood: unticking leaves the keys in the log", await ev("document.activeElement.id") === "log");
await ev("clearInterval(flood)");

// a session you ended yourself: no alarm and no hint, but its log is one tab away. The page can't
// tell a hand Disconnect from a stuck session you gave up on, so a clean end keeps its log too
await ev(`localStorage.setItem("freerdp-web-lastlog", JSON.stringify({ state: "clean", time: 1700000000000, lines: ["[test] the session before", "[test] its last line"] }))`);
await send("Page.removeScriptToEvaluateOnNewDocument", { identifier: seeded.identifier });
await send("Page.navigate", { url: ORIGIN + "/index.html" });
await sleep(300);
for (let i = 0; i < 100 && !await ev("typeof log === 'function' && document.readyState === 'complete'"); i++) await sleep(100);
await ev("document.getElementById('splash').hidden = true"); await sleep(100);
check("a clean end: no alarm on the next page", await ev("document.getElementById('lastlog').hidden"));
check("a clean end: nothing mixed into this page's log", !await ev(`${logEl}.textContent.includes('[test] its last line')`));
check("a clean end: nothing on the page says so, the Log stays closed", !await ev("document.getElementById('logPanel').open"));
await ev("document.getElementById('logPanel').open = true"); await sleep(100);
await click("#logLastTab"); await sleep(50);
check("a clean end: the Last session tab holds it", await ev("document.getElementById('logLast').textContent.includes('[test] its last line')"));
await click("#logLast");
await ctrl("a", "selectAll");
const last = await ev("document.getElementById('logLast').textContent");
check("a clean end: Ctrl + A selects that tab alone", await selected() === last.trimEnd(), `${(await selected()).length} of ${last.length} characters`);
await ev("getSelection().removeAllRanges()");
await click("#logCopy"); await sleep(100);
check("a clean end: Copy all takes the tab you see", await ev("navigator.clipboard.readText()") === last);

console.log(fails ? `${fails} check(s) failed` : "all checks passed");
chrome.kill();
process.exit(fails ? 1 : 0);
