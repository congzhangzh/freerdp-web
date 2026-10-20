import { connectTestSession } from "./test-connect.mjs";
// "Full screen" checked at Connect, on a screen that grows the way macOS animates into full screen
// (device pixel ratio 2): the window is small when the page enters full screen and reaches the
// screen's size only ~0.8 s later. Which size and scale does the server end up with, at once and
// after a Window / Full screen round trip? The display layouts FreeRDP sends are in its log
// (the disp channel at DEBUG); the X screen size comes from the CI xrdp session (test-keymap.py).
// GNOME=<gateway> GNOME_PASS=<password> runs it against gnome-remote-desktop instead (user
// tester in the release kit's GNOME container, its websockify at <gateway>); the size and the
// scale then come from Mutter's DisplayConfig.
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const base = new URL(".chrome/", import.meta.url).pathname;
const profile = mkdtempSync(join(base, "fsc-"));
const chrome = spawn("google-chrome", ["--headless=new", "--remote-debugging-port=9343", `--user-data-dir=${profile}`, "--no-first-run",
  "--window-size=1600,1000", "--enable-unsafe-swiftshader", "about:blank"], { stdio: "ignore", env: { ...process.env, TMPDIR: base } });
chrome.on("exit", () => { rmSync(profile, { recursive: true, force: true });
  for (const n of readdirSync(base)) if (n.startsWith("com.google.Chrome.")) rmSync(join(base, n), { recursive: true, force: true }); });
let t; for (let i = 0; i < 150 && !t; i++) { await sleep(200); try { t = (await (await fetch("http://127.0.0.1:9343/json")).json()).find((x) => x.type === "page"); } catch {} }
const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const p = new Map(); const logs = [];
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && p.has(m.id)) { p.get(m.id)(m.result); p.delete(m.id); }
  if (m.method === "Runtime.consoleAPICalled") logs.push(m.params.args.map((a) => a.value).join(" ")); });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; p.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true, userGesture: true })).result.value;
const metrics = (width, height) => send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 2, mobile: false });
if (!process.env.GNOME) execFileSync("docker", ["cp", new URL("test-keymap.py", import.meta.url).pathname, "grd-wasm-xrdp-ci:/tmp/keymap.py"]);
const GNOME = process.env.GNOME, GNOME_CT = process.env.GNOME_CT || "kit-gnome-probe";
const gnomeScreen = () => {
  const bus = execFileSync("docker", ["exec", "-u", "tester", GNOME_CT, "sh", "-c", "for p in /proc/[0-9]*; do grep -q gnome-shell $p/cmdline 2>/dev/null && tr '\\0' '\\n' < $p/environ 2>/dev/null | grep ^DBUS_SESSION_BUS_ADDRESS= ; done | head -1"]).toString().trim();
  const out = execFileSync("docker", ["exec", "-u", "tester", "-e", bus, GNOME_CT, "gdbus", "call", "--session", "-d", "org.gnome.Mutter.DisplayConfig",
    "-o", "/org/gnome/Mutter/DisplayConfig", "-m", "org.gnome.Mutter.DisplayConfig.GetCurrentState"]).toString();
  const mode = /\('[^']*', (\d+), (\d+), [\d.]+, [\d.]+, \[[^\]]*\], \{[^}]*'is-current': <true>/.exec(out);
  const logical = /\[\((-?\d+), (-?\d+), ([\d.]+), uint32/.exec(out);
  return `GNOME: mode ${mode ? mode[1] + "x" + mode[2] : "?"}, scale ${logical ? logical[3] : "?"}`;
};
const screen = () => {
  if (GNOME) return gnomeScreen();
  const displays = execFileSync("docker", ["exec", "grd-wasm-xrdp-ci", "ls", "/tmp/.X11-unix"]).toString().split(/\s+/).filter(Boolean);
  const d = ":" + displays.map((n) => +n.slice(1)).sort((a, b) => b - a)[0];
  return execFileSync("docker", ["exec", "-u", "test", "-e", "XAUTHORITY=/home/test/.Xauthority", "grd-wasm-xrdp-ci", "python3", "/tmp/keymap.py", d, "--size"]).toString().split("\n")[1];
};
const layouts = () => logs.filter((l) => /W\/H=|DesktopScaleFactor=/.test(l)).map((l) => l.replace(/^.*layout_pdu\]: \s*/, "").replace(/Orientation: \S+ /, ""));
let seen = 0;
const report = async (label) => {
  const l = layouts(); console.log(label, "|", screen(), "| canvas", await ev("canvas.width + 'x' + canvas.height"));
  for (const x of l.slice(seen)) console.log("   layout", x);
  seen = l.length;
};

await send("Runtime.enable");
await metrics(1280, 760);   // the window before full screen, in CSS pixels
await send("Page.navigate", { url: (process.env.PAGE || "http://127.0.0.1:8080/index.html") +
  `?v=${GNOME || "127.0.0.1:6081"}&u=${GNOME ? "tester" : "test"}&fs=1&extra=` + encodeURIComponent("/gfx -clipboard /log-filters:com.freerdp.channels.disp.client:DEBUG") });
// SCALE=<percent>: the Remote scale setting chosen before Connect (default Automatic)
if (process.env.SCALE) {
  while (!(await ev(`!!document.querySelector('input[name=scale][value="${process.env.SCALE}"]')`))) await sleep(100);
  await ev(`document.querySelector('input[name=scale][value="${process.env.SCALE}"]').click(), 1`);
}
const connecting = connectTestSession(send, GNOME ? { password: process.env.GNOME_PASS } : {});
// macOS: from the full-screen request the window grows to the screen (1440 x 900 CSS,
// 2880 x 1800 device pixels) over ~0.8 s, a step every 40 ms
(async () => {
  while (!(await ev("!!document.fullscreenElement"))) await sleep(10);
  for (let i = 1; i <= 20; i++) { await sleep(40); await metrics(1280 + 8 * i, 760 + 7 * i); }
})();
await connecting.catch(e => { chrome.kill(); throw e; });
await sleep(15000);
console.log(logs.find((l) => /sdl-freerdp /.test(l))?.replace(/^.*sdl-freerdp /, "args: "));
await report("connected:");
await ev("tbFs.click(), 1"); await sleep(4000); await report("Window:");
await ev("tbFs.click(), 1"); await sleep(4000); await report("Full screen again:");
ws.close(); chrome.kill();
