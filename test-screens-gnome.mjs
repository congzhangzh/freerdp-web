import { connectTestSession } from "./test-connect.mjs";
// All screens against GNOME through xrdp's wlup Mutter backend (./start-gnome-xrdp.sh): the
// page connects with one monitor and sends the screens' layout over the display channel when
// All screens -> Separate screens is chosen, mid-session. GNOME must then have a monitor per
// screen, side by side, with this window's screen as its primary one (the top bar), here the
// right-hand one; also after a Reconnect, and one again once the second window closes.
//   node test-screens-gnome.mjs [out dir]     PAGE, GATEWAY (127.0.0.1:6091), CONTAINER (xrdp-gnome-web)
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const out = process.argv[2] || "out";
mkdirSync(out, { recursive: true });
const C = process.env.CONTAINER || "xrdp-gnome-web", GATEWAY = process.env.GATEWAY || "127.0.0.1:6091";
const W = 640, H = 480;   // each screen, CSS pixels; this window's screen is the right one
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const base = new URL(".chrome/", import.meta.url).pathname;
mkdirSync(base, { recursive: true });
const profile = mkdtempSync(join(base, "gnome-"));
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
// GNOME's logical monitors: connector@x,y, * for the primary one
const monitors = () => {
  try {
    const s = execFileSync("docker", ["exec", C, "su", "tester", "-c", "DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus gdbus call --session " +
      "--dest org.gnome.Mutter.DisplayConfig --object-path /org/gnome/Mutter/DisplayConfig --method org.gnome.Mutter.DisplayConfig.GetCurrentState"]).toString();
    // logical monitors: (x, y, scale, transform, primary, [(connector, ...)], ...); GVariant names the type in the first only
    return [...s.matchAll(/\((-?\d+), (-?\d+), [\d.]+, (?:uint32 )?\d+, (true|false), \[\('([^']+)'/g)]
      .map((m) => `${m[4]}@${m[1]},${m[2]}${m[3] === "true" ? "*" : ""}`).sort((a, b) => +a.split("@")[1].split(",")[0] - +b.split("@")[1].split(",")[0]).join(" ");
  } catch { return ""; }
};
const until = async (re, ms = 30000) => { let m; for (let t0 = Date.now(); Date.now() - t0 < ms; await sleep(1000)) { m = monitors(); if (re.test(m)) break; } return m; };
const results = {};
const check = (name, ok, detail = "") => { results[name] = ok; console.log(ok ? "PASS" : "FAIL", name, detail); };
const ONE = /^Meta-\d+@0,0\*$/, TWO = new RegExp(`^Meta-\\d+@0,0 Meta-\\d+@${W},0\\*$`);

await connected(1);
let m = await until(ONE);
check("connected: GNOME has one monitor", ONE.test(m), m);
await main.ev("tbScreens.click()");
await main.ev("screensMenu.querySelector('[data-mode=separate]').click()");
m = await until(TWO);
check("Separate screens: a GNOME monitor per screen, this window's (right) one primary", TWO.test(m), m);
let popup; for (let i = 0; i < 25 && !popup; i++) { popup = (await targets()).find((x) => x.url.includes("screen.html")); if (!popup) await sleep(200); }
if (popup) {
  const second = await cdp(popup.webSocketDebuggerUrl);
  await second.send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await sleep(4000);
  writeFileSync(join(out, "gnome-main.png"), Buffer.from((await main.send("Page.captureScreenshot", { format: "png" })).data, "base64"));
  writeFileSync(join(out, "gnome-second.png"), Buffer.from((await second.send("Page.captureScreenshot", { format: "png" })).data, "base64"));
}
await main.ev("tbReconnect.click()");
await connected(2);
m = await until(TWO);
check("after Reconnect: still a monitor per screen", TWO.test(m), m);
if (popup) await (await cdp(popup.webSocketDebuggerUrl)).ev("window.close()").catch(() => {});
m = await until(ONE);
check("the second window closed: one monitor again", ONE.test(m), m);
writeFileSync(join(out, "gnome-xrdp.log"), execFileSync("docker", ["exec", C, "grep", "wlup/mutter", "/var/log/xrdp.log"]).toString());
writeFileSync(join(out, "gnome-page.log"), await pageLog());
const failed = Object.entries(results).filter(([, ok]) => !ok).map(([n]) => n);
console.log(failed.length ? "FAILED: " + failed.join("; ") : "all passed");
chrome.kill();
process.exit(failed.length ? 1 : 0);
