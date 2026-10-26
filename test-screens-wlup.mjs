import { connectTestSession } from "./test-connect.mjs";
// All screens against a Wayland desktop through xrdp's wlup module (./start-wlup-xrdp.sh):
// GNOME (Mutter backend) or KDE Plasma (KWin backend). The page connects with one monitor and
// sends the screens' layout over the display channel when All screens -> Separate screens is
// chosen, mid-session. The desktop must then have a monitor per screen, side by side, with
// this window's screen as its primary one (GNOME's top bar, Plasma's panel), here the
// right-hand one; also after a Reconnect, and one again once the second window closes.
//   node test-screens-wlup.mjs [out dir]     PAGE, GATEWAY (127.0.0.1:6091), DESKTOP (gnome|kde),
//                                            CONTAINER (xrdp-wlup-web)
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const out = process.argv[2] || "out";
mkdirSync(out, { recursive: true });
const C = process.env.CONTAINER || "xrdp-wlup-web", GATEWAY = process.env.GATEWAY || "127.0.0.1:6091";
const DESKTOP = process.env.DESKTOP || "gnome";
const W = 640, H = 480;   // each screen, CSS pixels; this window's screen is the right one
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const base = new URL(".chrome/", import.meta.url).pathname;
mkdirSync(base, { recursive: true });
const profile = mkdtempSync(join(base, "wlup-"));
const chrome = spawn("google-chrome", ["--headless=new", "--remote-debugging-port=9348", `--user-data-dir=${profile}`, "--no-first-run",
  `--window-size=${W},${H}`, "--enable-unsafe-swiftshader", "about:blank"], { stdio: "ignore", env: { ...process.env, TMPDIR: base } });
chrome.on("exit", () => { rmSync(profile, { recursive: true, force: true });
  for (const n of readdirSync(base)) if (n.startsWith("com.google.Chrome.")) rmSync(join(base, n), { recursive: true, force: true }); });
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
await connectTestSession(main.send, { password: "wlup-test-pw" }).catch((e) => { chrome.kill(); throw e; });
const pageLog = () => main.ev("document.getElementById('log').textContent");
const connected = async (n) => { for (let i = 0; i < 180; i++) { if (((await pageLog()).match(/Loading Dynamic Virtual Channel disp/g) || []).length >= n) break; await sleep(500); } await sleep(3000); };
// the desktop's monitors, left to right: name@x,y, * for the primary one
const inSession = (cmd) => execFileSync("docker", ["exec", C, "su", "tester", "-c", "export XDG_RUNTIME_DIR=/run/user/1000 " +
  "DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus WAYLAND_DISPLAY=$(cd /run/user/1000 && ls wayland-? | head -1); " + cmd],
  { stdio: ["ignore", "pipe", "ignore"] }).toString();
const byX = (a, b) => +a.split("@")[1].split(",")[0] - +b.split("@")[1].split(",")[0];
const monitors = () => {
  try {
    if (DESKTOP === "kde") {
      // KWin's enabled outputs; the primary one has the lowest priority (a lone output has 0,
      // ordered ones count from 1). Qt may warn about the locale first
      const s = inSession("kscreen-doctor -j"), outs = JSON.parse(s.slice(s.indexOf("{"))).outputs.filter((o) => o.enabled);
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

await connected(1);
let m = await until(ONE);
check(`connected: ${DESKTOP} has one monitor`, ONE.test(m), m);
await main.ev("tbScreens.click()");
await main.ev("screensMenu.querySelector('[data-mode=separate]').click()");
m = await until(TWO);
check(`Separate screens: a ${DESKTOP} monitor per screen, this window's (right) one primary`, TWO.test(m), m);
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
check("after Reconnect: still a monitor per screen", TWO.test(m), m);
if (popup) await (await cdp(popup.webSocketDebuggerUrl)).ev("window.close()").catch(() => {});
m = await until(ONE);
check("the second window closed: one monitor again", ONE.test(m), m);
writeFileSync(join(out, `${DESKTOP}-xrdp.log`), execFileSync("docker", ["exec", C, "grep", "wlup/", "/var/log/xrdp.log"]).toString());
writeFileSync(join(out, `${DESKTOP}-page.log`), await pageLog());
const failed = Object.entries(results).filter(([, ok]) => !ok).map(([n]) => n);
console.log(failed.length ? "FAILED: " + failed.join("; ") : "all passed");
chrome.kill();
process.exit(failed.length ? 1 : 0);
