import { connectTestSession } from "./test-connect.mjs";
// All screens against a Wayland desktop through xrdp's wlup module (./start-wlup-xrdp.sh):
// GNOME (Mutter backend) or KDE Plasma (KWin backend). The page connects with one monitor and
// sends the screens' layout over the display channel when All screens -> Separate screens is
// chosen, mid-session. The desktop must then have a monitor per screen, side by side, with
// this window's screen as its primary one (GNOME's top bar, Plasma's panel), here the
// right-hand one; also after a Reconnect, and one again once the second window closes.
//   node test-screens-wlup.mjs [out dir]     PAGE, GATEWAY (127.0.0.1:6091), DESKTOP (gnome|kde),
//                                            CONTAINER (xrdp-wlup-web), ENGINE (docker; or podman),
//                                            PASSWORD (tester's, wlup-test-pw)
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const out = process.argv[2] || "out";
mkdirSync(out, { recursive: true });
const C = process.env.CONTAINER || "xrdp-wlup-web", GATEWAY = process.env.GATEWAY || "127.0.0.1:6091";
const DESKTOP = process.env.DESKTOP || "gnome";
const ENGINE = process.env.ENGINE || "docker", PASSWORD = process.env.PASSWORD || "wlup-test-pw";
const W = 640, H = 480;   // each screen, CSS pixels; this window's screen is the right one
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Chrome's own temporary files in a short directory of their own: under a deep one (a CI
// runner's workspace) its socket path passes the 108 bytes a Unix socket allows
const base = mkdtempSync(join(tmpdir(), "wlup-"));
const profile = join(base, "profile");
const chrome = spawn("google-chrome", ["--headless=new", "--remote-debugging-port=9348", `--user-data-dir=${profile}`, "--no-first-run",
  `--window-size=${W},${H}`, "--enable-unsafe-swiftshader", "about:blank"], { stdio: "ignore", env: { ...process.env, TMPDIR: base } });
// ends the test: Chrome first, then its temporary directory, then node (an exit handler alone
// would not run: node is gone before Chrome)
const quit = async (code) => {
  if (chrome.exitCode === null && chrome.signalCode === null) await new Promise((r) => { chrome.once("exit", r); chrome.kill(); setTimeout(r, 5000); });
  rmSync(base, { recursive: true, force: true });
  process.exit(code);
};
// also when the test is stopped (timeout(1) sends SIGTERM) or throws
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => quit(1));
process.on("uncaughtException", (e) => { console.error(e); quit(1); });
const targets = async () => (await (await fetch("http://127.0.0.1:9348/json")).json()).filter((x) => x.type === "page");
async function cdp(url) {
  const ws = new WebSocket(url); await new Promise((r) => ws.addEventListener("open", r));
  let id = 0; const p = new Map();
  ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && p.has(m.id)) { p.get(m.id)(m.result); p.delete(m.id); } });
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; p.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true, userGesture: true, awaitPromise: true })).result.value;
  return { send, ev };
}
let t; for (let i = 0; i < 150 && !t; i++) { await sleep(200); try { t = (await targets())[0]; } catch {} }
const main = await cdp(t.webSocketDebuggerUrl);
await main.send("Runtime.enable");
await main.send("Emulation.setFocusEmulationEnabled", { enabled: true });
await main.send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
const url = new URL(process.env.PAGE || "http://127.0.0.1:8080/index.html");
for (const [k, v] of Object.entries({ v: GATEWAY, u: "tester", extra: "/gfx", fs: "1", screens: `${W}x${H}+${W}+0,${W}x${H}+0+0` })) url.searchParams.set(k, v);
await main.send("Page.navigate", { url: url.href });
await connectTestSession(main.send, { password: PASSWORD }).catch(async (e) => { console.error(e); await quit(1); });
const pageLog = () => main.ev("document.getElementById('log').textContent");
const connected = async (n) => { for (let i = 0; i < 180; i++) { if (((await pageLog()).match(/Loading Dynamic Virtual Channel disp/g) || []).length >= n) break; await sleep(500); } await sleep(3000); };
// the desktop's monitors, left to right: name@x,y, * for the primary one
const inSession = (cmd) => execFileSync(ENGINE, ["exec", C, "su", "tester", "-c", "export XDG_RUNTIME_DIR=/run/user/1000 " +
  "DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus WAYLAND_DISPLAY=$(cd /run/user/1000 && ls wayland-? | head -1); " + cmd],
  { stdio: ["ignore", "pipe", "ignore"] }).toString();
const byX = (a, b) => +a.split("@")[1].split(",")[0] - +b.split("@")[1].split(",")[0];
// every output kscreen-doctor listed last time, enabled or not: a FAIL's detail on KDE shows them,
// so a KWin that lists the outputs differently can be read from the log
let kdeOutputs = "";
const monitors = () => {
  try {
    if (DESKTOP === "kde") {
      // KWin's enabled outputs; the primary one has the lowest priority (a lone output has 0,
      // ordered ones count from 1). Qt may warn about the locale first. KWin 6.8 leaves out
      // "enabled" for xrdp's output: on unless it says false, when it is connected with a size
      kdeOutputs = "none, kscreen-doctor gave no answer";
      const s = inSession("kscreen-doctor -j"), all = JSON.parse(s.slice(s.indexOf("{"))).outputs, outs = all.filter((o) => o.enabled === true || (o.enabled === undefined && o.connected && o.size));
      kdeOutputs = JSON.stringify(all.map(({ name, enabled, connected, pos, size, priority }) => ({ name, enabled, connected, pos, size, priority })));
      const first = Math.min(...outs.map((o) => o.priority));
      return outs.map((o) => `${o.name}@${o.pos.x},${o.pos.y}${o.priority === first ? "*" : ""}`).sort(byX).join(" ");
    }
    const s = inSession("gdbus call --session --dest org.gnome.Mutter.DisplayConfig --object-path /org/gnome/Mutter/DisplayConfig " +
      "--method org.gnome.Mutter.DisplayConfig.GetCurrentState");
    // GNOME's logical monitors: (x, y, scale, transform, primary, [(connector, ...)], ...); GVariant names the type in the first only
    return [...s.matchAll(/\((-?\d+), (-?\d+), [\d.]+, (?:uint32 )?\d+, (true|false), \[\('([^']+)'/g)]
      .map((m) => `${m[4]}@${m[1]},${m[2]}${m[3] === "true" ? "*" : ""}`).sort(byX).join(" ");
  } catch { return ""; }
};
const until = async (re, ms = 30000) => { let m; for (let t0 = Date.now(); Date.now() - t0 < ms; await sleep(1000)) { m = monitors(); if (re.test(m)) break; } return m; };
const results = {};
const check = (name, ok, detail = "") => { results[name] = ok; console.log(ok ? "PASS" : "FAIL", name, detail); };
const ONE = /^[^@ ]+@0,0\*$/, TWO = new RegExp(`^[^@ ]+@0,0 [^@ ]+@${W},0\\*$`);
const why = (re, m) => re.test(m) || DESKTOP !== "kde" ? m : `${m} | kscreen-doctor's outputs: ${kdeOutputs}`;

await connected(1);
let m = await until(ONE);
check(`connected: ${DESKTOP} has one monitor`, ONE.test(m), why(ONE, m));
// a window of the session from before All screens: a maximized terminal, dark
execFileSync(ENGINE, ["exec", "-d", C, "su", "tester", "-c", "export XDG_RUNTIME_DIR=/run/user/1000 " +
  "WAYLAND_DISPLAY=$(cd /run/user/1000 && ls wayland-? | head -1); foot --maximized"]);
// the colour at the middle of each screen's part of the canvas (canvas pixels): this window's
// screen is the right half, the other one the left half
const middles = () => main.ev(`(() => {
  const c = canvas, o = new OffscreenCanvas(c.width, c.height), g = o.getContext("2d");
  g.drawImage(c, 0, 0);
  const at = (x, y) => Array.from(g.getImageData(x, y, 1, 1).data.slice(0, 3));
  return { mine: at(c.width * 3 / 4 | 0, c.height / 2 | 0), other: at(c.width / 4 | 0, c.height / 2 | 0) };
})()`);
const dark = (p) => p && Math.max(...p) < 60;
// wait for it (slow right after login): the middle of the one screen's canvas turns dark; without
// it the check below could not tell "no window" from "the window moved"
let shown = false;
for (let i = 0; i < 60 && !shown; i++) { await sleep(500); shown = dark(await main.ev(`(() => {
  const o = new OffscreenCanvas(canvas.width, canvas.height), g = o.getContext("2d");
  g.drawImage(canvas, 0, 0); return Array.from(g.getImageData(canvas.width / 2 | 0, canvas.height / 2 | 0, 1, 1).data.slice(0, 3));
})()`)); }
await main.ev("tbScreens.click()");
await main.ev("screensMenu.querySelector('[data-mode=separate]').click()");
m = await until(TWO);
check(`Separate screens: a ${DESKTOP} monitor per screen, this window's (right) one primary`, TWO.test(m), why(TWO, m));
// the windows that were there stay on this window's screen, the primary; the other screen is new
await sleep(3000);
const mid = await middles();
// On GNOME this fails about 1 run in 5, a Mutter race (the release kit's notes): a window can
// follow the other monitor when GNOME rearranges them, however long it has been open
check("the session's windows stay on this window's screen", shown && dark(mid?.mine) && !dark(mid?.other),
  shown ? JSON.stringify(mid) : "foot never showed before Separate screens (30 s)");
let popup; for (let i = 0; i < 25 && !popup; i++) { popup = (await targets()).find((x) => x.url.includes("screen.html")); if (!popup) await sleep(200); }
if (popup) {
  const second = await cdp(popup.webSocketDebuggerUrl);
  await second.send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await sleep(4000);
  writeFileSync(join(out, `${DESKTOP}-main.png`), Buffer.from((await main.send("Page.captureScreenshot", { format: "png" })).data, "base64"));
  writeFileSync(join(out, `${DESKTOP}-second.png`), Buffer.from((await second.send("Page.captureScreenshot", { format: "png" })).data, "base64"));
}
await main.ev("tbReconnect.click()");
await connected(2);
m = await until(TWO);
check("after Reconnect: still a monitor per screen", TWO.test(m), why(TWO, m));
if (popup) await (await cdp(popup.webSocketDebuggerUrl)).ev("window.close()").catch(() => {});
m = await until(ONE);
check("the second window closed: one monitor again", ONE.test(m), why(ONE, m));
writeFileSync(join(out, `${DESKTOP}-xrdp.log`), execFileSync(ENGINE, ["exec", C, "grep", "wlup/", "/var/log/xrdp.log"]).toString());
writeFileSync(join(out, `${DESKTOP}-page.log`), await pageLog());
const failed = Object.entries(results).filter(([, ok]) => !ok).map(([n]) => n);
console.log(failed.length ? "FAILED: " + failed.join("; ") : "all passed");
await quit(failed.length ? 1 : 0);
