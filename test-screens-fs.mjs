import { connectTestSession } from "./test-connect.mjs";
// 聪哥's drops (2026-11-05, 2026-11-10): two screens (separate monitors), switching Window / Full
// screen a few times, then the toolbar's Reconnect. On his Mac (device pixel ratio 2, Remote scale
// 200 %) the picture stopped updating after such switches, and a Reconnect then ended in a wasm
// abort instead of FreeRDP's own reconnect. This drives the same steps against the CI xrdp
// session and checks after each one that the picture still updates (a clock ticks on the remote
// desktop, so the client's codec counters must move) and that the client has not aborted.
//   node test-screens-fs.mjs [out dir]   PAGE, GATEWAY (127.0.0.1:6081), XRDP (grd-wasm-xrdp-ci),
//                                        ENGINE (docker), ROUNDS (Window / Full screen switches, 4),
//                                        EXTRA (FreeRDP options; default his: AVC420, sound, mic, 200 %),
//                                        SCREENS (2; 1 for the same steps on one screen)
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const out = process.argv[2] || "out";
mkdirSync(out, { recursive: true });
const XRDP = process.env.XRDP || "grd-wasm-xrdp-ci", GATEWAY = process.env.GATEWAY || "127.0.0.1:6081";
const ENGINE = process.env.ENGINE || "docker", ROUNDS = +(process.env.ROUNDS || 4), SCREENS = +(process.env.SCREENS || 2);
// SERVER=shadow: FreeRDP's shadow server through sesman (a headless GNOME, user tester) in the
// container CT (fsdrop-shadow), password PASSWORD; the clock is a foot window in that GNOME
const SERVER = process.env.SERVER || "xrdp", CT = process.env.CT || "fsdrop-shadow";
const USER = SERVER === "shadow" ? "tester" : "test";
const EXTRA = process.env.EXTRA ?? "/gfx:AV2:off,AV1:off,AVC420 /sound /microphone /scale-desktop:200";
// FreeRDP keeps only the last /log-filters: add the disp channel's filter to one in EXTRA
const withFilter = (extra, f) => /\/log-filters:/.test(extra) ? extra.replace(/\/log-filters:(\S+)/, (_, x) => `/log-filters:${x},${f}`) : `${extra} /log-filters:${f}`;
const W = 800, H = 500;   // each screen, CSS pixels; the second one is right of the first
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const within = (p, ms) => Promise.race([p.catch(() => {}), sleep(ms)]);
const base = mkdtempSync(join(tmpdir(), "sfs-"));
const chrome = spawn("google-chrome", ["--headless=new", "--remote-debugging-port=9349", `--user-data-dir=${join(base, "profile")}`, "--no-first-run",
  `--window-size=${W},${H}`, "--enable-unsafe-swiftshader", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "about:blank"],
  { stdio: "ignore", env: { ...process.env, TMPDIR: base } });
const quit = async (code) => {
  if (chrome.exitCode === null && chrome.signalCode === null) await new Promise((r) => { chrome.once("exit", r); chrome.kill(); setTimeout(r, 5000); });
  rmSync(base, { recursive: true, force: true });
  process.exit(code);
};
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => quit(1));
process.on("uncaughtException", (e) => { console.error(e); quit(1); });
const targets = async () => (await (await fetch("http://127.0.0.1:9349/json")).json()).filter((x) => x.type === "page");
const consoleLines = [], workers = []; let wid = 0;
async function cdp(url, keep) {
  const ws = new WebSocket(url); await new Promise((r) => ws.addEventListener("open", r));
  let id = 0; const p = new Map();
  ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && p.has(m.id)) { p.get(m.id)(m.result); p.delete(m.id); }
    if (keep && m.method === "Runtime.consoleAPICalled") consoleLines.push(m.params.args.map((a) => a.value ?? a.description).join(" "));
    if (keep && m.method === "Runtime.exceptionThrown") consoleLines.push((m.sessionId ? "WORKER " : "") + "EXCEPTION " + (m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text)
      + (m.params.exceptionDetails?.stackTrace ? "\n  " + m.params.exceptionDetails.stackTrace.callFrames.map((f) => `${f.functionName || "?"} ${f.url.split("/").pop()}:${f.lineNumber}`).join("\n  ") : ""));
    // the client's threads are workers: attach to each (flat sessions) so an abort in one is
    // seen with its own stack, not only as "Aborted(undefined)" on the page
    if (keep && m.method === "Target.attachedToTarget") {
      const sid = m.params.sessionId; workers.push(m.params.targetInfo.type + " " + m.params.targetInfo.url.split("/").pop());
      for (const method of ["Runtime.enable", "Runtime.runIfWaitingForDebugger"]) ws.send(JSON.stringify({ id: 900000 + (++wid), method, sessionId: sid }));
    } });
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; p.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true, userGesture: true, awaitPromise: true }))?.result?.value;
  return { ws, send, ev };
}
let t; for (let i = 0; i < 150 && !t; i++) { await sleep(200); try { t = (await targets())[0]; } catch {} }
const main = await cdp(t.webSocketDebuggerUrl, true);
const display = () => ":" + execFileSync(ENGINE, ["exec", XRDP, "ls", "/tmp/.X11-unix"]).toString().split(/\s+/).filter(Boolean)
  .map((n) => +n.slice(1)).sort((a, b) => b - a)[0];
const results = {};
const check = (name, ok, detail = "") => { results[name] = ok; console.log(ok ? "PASS" : "FAIL", name, detail); };
const pageLog = () => main.ev("document.getElementById('log').textContent");
const aborted = async () => /\[page\] aborted|Aborted\(/.test(await pageLog()) || consoleLines.some((l) => /Aborted\(/.test(l));
// the picture updates: the client's codec counters move while the remote clock ticks
const reading = () => main.ev("(() => { try { return JSON.stringify(codecReading()); } catch (e) { return null; } })()").then((s) => (s ? JSON.parse(s) : null));
const painting = async (ms = 4000) => {
  const a = await reading(); await sleep(ms); const b = await reading();
  if (!a || !b) return { ok: false, why: "no codec counters (" + (a ? "after" : "before") + ")" };
  const nothing = await main.ev(`window.freerdpCodecStats.paintedNothing(${JSON.stringify(a)}, ${JSON.stringify(b)})`);
  return { ok: nothing === false, why: nothing === false ? "paints arrive" : "no paint in " + ms / 1000 + " s" };
};
const metrics = (w, h) => main.send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 2, mobile: false });

await main.send("Runtime.enable");
await main.send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
await main.send("Emulation.setFocusEmulationEnabled", { enabled: true });
await metrics(W, H);
const url = new URL(process.env.PAGE || "http://127.0.0.1:8080/index.html");
for (const [k, v] of Object.entries({ v: GATEWAY, u: USER, fs: "0", extra: withFilter(EXTRA, "com.freerdp.channels.disp.client:DEBUG"),
  ...(SCREENS === 2 ? { screens: `${W}x${H}+0+0,${W}x${H}+${W}+0` } : {}) })) url.searchParams.set(k, v);
await main.send("Page.navigate", { url: url.href });
await connectTestSession(main.send, process.env.PASSWORD ? { password: process.env.PASSWORD } : {}).catch(async (e) => { console.error(e); await quit(1); });
console.log("client build:", await main.ev("window.freerdpEngine"));
for (let i = 0; i < 120 && !/Loading Dynamic Virtual Channel disp/.test(await pageLog()); i++) await sleep(250);
await sleep(3000);
console.log((await pageLog()).split("\n").find((l) => /sdl-freerdp /.test(l)));
// a clock on the remote desktop, so there is always something new to paint
const TICK = "while :; do date +%T.%N; sleep 0.2; done";
if (SERVER === "shadow") {
  // the headless GNOME may still be starting: wait for its Wayland socket
  const uid = execFileSync("podman", ["exec", CT, "id", "-u", "tester"]).toString().trim();
  for (let i = 0; i < 60; i++) { try { execFileSync("podman", ["exec", CT, "test", "-S", `/run/user/${uid}/wayland-0`]); break; } catch { await sleep(1000); } }
  execFileSync("podman", ["exec", "-d", "-u", "tester", "-e", `XDG_RUNTIME_DIR=/run/user/${uid}`, "-e", "WAYLAND_DISPLAY=wayland-0", CT, "foot", "sh", "-c", TICK]);
} else execFileSync(ENGINE, ["exec", "-d", "-u", "test", "-e", "DISPLAY=" + display(), XRDP, "xterm", "-geometry", "40x4+40+40", "-e", "sh", "-c", TICK]);
await sleep(2000);
// a headless GNOME takes a minute or more to start on the first connection: wait for the picture
let p = { ok: false, why: "never painted" };
for (let t0 = Date.now(); !p.ok && Date.now() - t0 < 120000; ) p = await painting(3000);
check("connected: the picture updates", p.ok, p.why);

let second = null;
if (SCREENS === 2) {
  await main.ev("tbScreens.click()");
  await main.ev("screensMenu.querySelector('[data-mode=separate]').click()");
  let popup; for (let i = 0; i < 50 && !popup; i++) { await sleep(200); popup = (await targets()).find((x) => x.url.includes("screen.html")); }
  check("a window opens for the second screen", !!popup);
  if (!popup) await quit(1);
  second = await cdp(popup.webSocketDebuggerUrl, false);
  await second.send("Runtime.enable");
  await second.send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 2, mobile: false });
  await sleep(5000);
  p = await painting();
  check("two screens: the picture updates", p.ok, p.why);
}

// REAL=1 (the default with two screens): what real screens do (Window Management API, no
// ?screens=): leaving full screen turns All screens off (onFullscreenChange: screensOff(), the
// second window closes, one monitor at the window's size), and All screens again opens it, two
// monitors. Here ?screens= skips that line, so the test calls screensOff() at the same moment.
const openSecond = async () => {
  await main.ev("tbScreens.click()");
  await main.ev("screensMenu.querySelector('[data-mode=separate]').click()");
  let popup; for (let i = 0; i < 50 && !popup; i++) { await sleep(200); popup = (await targets()).find((x) => x.url.includes("screen.html")); }
  if (popup) { second = await cdp(popup.webSocketDebuggerUrl, false); await second.send("Runtime.enable");
    await second.send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 2, mobile: false }); }
  return !!popup;
};
if (SCREENS === 2 && process.env.REAL !== "0") {
  for (let r = 1; r <= ROUNDS; r++) {
    // leave full screen if in it (round 1 starts windowed with two screens): one screen again
    if (await main.ev("!!document.fullscreenElement")) await main.ev("tbFs.click(), 1");
    await main.ev("screensOff(), 1");
    for (let i = 19; i >= 0; i--) { await sleep(40); await metrics(W + 10 * i, H + 8 * i); }
    await sleep(3000);
    let ab = await aborted();
    p = ab ? { ok: false, why: "aborted" } : await painting();
    check(`round ${r}: window, one screen: the picture updates`, p.ok, p.why + ", canvas " + (await main.ev("canvas.width + 'x' + canvas.height")));
    if (ab) break;
    // full screen, the window growing to the screen over ~0.8 s as on macOS, then All screens
    await main.ev("tbFs.click(), 1");
    for (let i = 1; i <= 20; i++) { await sleep(40); await metrics(W + 10 * i, H + 8 * i); }
    await sleep(2000);
    const opened = await openSecond();
    await sleep(4000);
    ab = await aborted();
    p = ab ? { ok: false, why: "aborted" } : opened ? await painting() : { ok: false, why: "no second window" };
    check(`round ${r}: full screen, two screens: the picture updates`, p.ok, p.why + ", canvas " + (await main.ev("canvas.width + 'x' + canvas.height")));
    if (ab) break;
  }
} else
// Window <-> Full screen, the window growing to the screen over ~0.8 s as on macOS
for (let r = 1; r <= ROUNDS; r++) {
  const toFull = !(await main.ev("!!document.fullscreenElement"));
  await main.ev("tbFs.click(), 1");
  if (toFull) for (let i = 1; i <= 20; i++) { await sleep(40); await metrics(W + 10 * i, H + 8 * i); }
  else for (let i = 19; i >= 0; i--) { await sleep(40); await metrics(W + 10 * i, H + 8 * i); }
  await sleep(3000);
  const ab = await aborted();
  p = ab ? { ok: false, why: "aborted" } : await painting();
  check(`switch ${r} (${toFull ? "to full screen" : "to window"}): the picture updates`, p.ok, p.why + ", canvas " + (await main.ev("canvas.width + 'x' + canvas.height")));
  if (ab) break;
}

// Reconnect on the toolbar while the session runs: FreeRDP's own reconnect, no abort.
// RECONNECTS=<n> presses it n times; with the microphone capturing (a page without a CSP, as
// GitHub Pages serves it: the worklet comes from a blob: URL) and the mouse moving while the
// sockets close, so the main thread writes to a closing connection (聪哥's abort, 2026-11-10)
const mic = () => main.ev("JSON.stringify(Object.entries(Module.freerdpAudin || {}).filter(([k, v]) => v && typeof v === 'object' && 'ctx' in v).map(([k, v]) => v.ctx ? v.ctx.state : 'starting'))");
console.log("microphone captures:", await mic());
const RECONNECTS = +(process.env.RECONNECTS || 1);
for (let k = 1; k <= RECONNECTS && !(await aborted()); k++) {
  let moving = process.env.MOUSE !== "0";   // MOUSE=0: no input while the sockets close
  (async () => { for (let i = 0; moving; i++) { await main.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 100 + (i % 50) * 4, y: 120 + (i % 30) * 3 }); await sleep(15); } })();
  await sleep(300);
  await main.ev("tbReconnect.click(), 1");
  await sleep(3000); moving = false;
  await sleep(12000);
  const ab = await aborted();
  check(`Reconnect ${k}: no wasm abort`, !ab);
  if (ab) break;
  p = await painting(5000);
  check(`Reconnect ${k}: the picture updates again`, p.ok, p.why + ", microphone " + (await mic()));
}

try { if (SERVER === "shadow") execFileSync("podman", ["exec", CT, "pkill", "-x", "foot"]); else execFileSync(ENGINE, ["exec", "-u", "test", XRDP, "sh", "-c", "kill $(pidof xterm)"]); } catch { /* gone already */ }
writeFileSync(join(out, "screens-fs-page.log"), String(await pageLog()));
writeFileSync(join(out, "screens-fs-console.log"), consoleLines.join("\n") + "\n--- workers attached: " + workers.length + "\n" + workers.join("\n"));
writeFileSync(join(out, "screens-fs-main.png"), Buffer.from((await main.send("Page.captureScreenshot", { format: "png" }))?.data ?? "", "base64"));
if (second) await within(second.ev("window.close()"), 5000);
main.ws.close();
const failed = Object.entries(results).filter(([, ok]) => !ok).map(([n]) => n);
console.log(failed.length ? `FAILED: ${failed.join("; ")}` : "all passed");
await quit(failed.length ? 1 : 0);
