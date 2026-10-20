import { connectTestSession } from "./test-connect.mjs";
// Clipboard text test against the CI xrdp: local -> remote and remote -> local.
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const base = new URL(".chrome/", import.meta.url).pathname;
const profile = mkdtempSync(join(base, "clip-"));
const chrome = spawn("google-chrome", ["--headless=new", "--remote-debugging-port=9341", `--user-data-dir=${profile}`, "--no-first-run",
  "--window-size=1280,900", "--enable-unsafe-swiftshader", "about:blank"], { stdio: "ignore", env: { ...process.env, TMPDIR: base } });
chrome.on("exit", () => { rmSync(profile, { recursive: true, force: true });
  for (const n of readdirSync(base)) if (n.startsWith("com.google.Chrome.")) rmSync(join(base, n), { recursive: true, force: true }); });
let v; for (let i = 0; i < 150 && !v; i++) { await sleep(200); try { v = await (await fetch("http://127.0.0.1:9341/json/version")).json(); } catch {} }
const conn = (url) => { const ws = new WebSocket(url); let id = 0; const p = new Map(); const logs = [];
  ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && p.has(m.id)) { p.get(m.id)(m.result ?? m.error); p.delete(m.id); }
    if (m.method === "Runtime.consoleAPICalled") logs.push(m.params.args.map((a) => a.value).join(" ")); });
  return { ws, logs, ready: new Promise((r) => ws.addEventListener("open", r)),
    send: (method, params = {}) => new Promise((r) => { const i = ++id; p.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); }) }; };
const b = conn(v.webSocketDebuggerUrl); await b.ready;
console.log("grant:", JSON.stringify(await b.send("Browser.grantPermissions", { origin: "http://127.0.0.1:8080", permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"] })));
const t = (await (await fetch("http://127.0.0.1:9341/json")).json()).find((x) => x.type === "page");
const pg = conn(t.webSocketDebuggerUrl); await pg.ready;
await pg.send("Runtime.enable"); await pg.send("Page.enable");
await pg.send("Emulation.setFocusEmulationEnabled", { enabled: true });
const ev = async (expression) => (await pg.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true, userGesture: true })).result?.value;
await pg.send("Page.navigate", { url: (process.env.PAGE || "http://127.0.0.1:8080/index.html") + "?v=127.0.0.1:6081&u=test&extra=/gfx&fs=0" });
await connectTestSession(pg.send).catch(e => { chrome.kill(); throw e; });
await sleep(15000);
const xclip = (args, input) => execFileSync("docker", ["exec", "-i", "grd-wasm-xrdp-ci", "sh", "-c",
  `export DISPLAY=$(ls /tmp/.X11-unix | sed 's/X/:/' | tail -1) XAUTHORITY=/home/test/.Xauthority; su test -c 'DISPLAY='$DISPLAY' XAUTHORITY=/home/test/.Xauthority xclip ${args}'`], { input }).toString();
// local -> remote
await ev("navigator.clipboard.writeText('from-browser-123 äöü 中文')");
await sleep(4000);
let remote = ""; try { remote = xclip("-o -selection clipboard"); } catch (e) { remote = "ERR " + e.message.split("\n")[0]; }
console.log("local -> remote:", JSON.stringify(remote));
// remote -> local
xclip("-i -selection clipboard", "from-remote-456 日本語");
await sleep(4000);
console.log("remote -> local:", JSON.stringify(await ev("navigator.clipboard.readText().catch(e => 'ERR ' + e.message)")));
// images, local -> remote: 64x32, left half red, right half green
await ev(`(async () => { const c = new OffscreenCanvas(64, 32), g = c.getContext("2d");
  g.fillStyle = "#ff0000"; g.fillRect(0, 0, 32, 32); g.fillStyle = "#00ff00"; g.fillRect(32, 0, 32, 32);
  await navigator.clipboard.write([new ClipboardItem({ "image/png": await c.convertToBlob({ type: "image/png" }) })]); return "ok"; })()`);
await sleep(5000);
let targets = ""; try { targets = xclip("-o -selection clipboard -t TARGETS").replace(/\n/g, " "); } catch (e) { targets = "ERR"; }
console.log("local -> remote image, remote TARGETS:", targets.trim());
for (const t of ["image/png", "image/bmp"]) {
  try {
    const bytes = execFileSync("docker", ["exec", "grd-wasm-xrdp-ci", "sh", "-c",
      `export DISPLAY=$(ls /tmp/.X11-unix | sed 's/X/:/' | tail -1); su test -c "DISPLAY=$DISPLAY XAUTHORITY=/home/test/.Xauthority xclip -o -selection clipboard -t ${t}"`]);
    let dims = "";
    if (t === "image/png" && bytes.length > 24) dims = `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`;
    if (t === "image/bmp" && bytes.length > 26) dims = `${bytes.readInt32LE(18)}x${Math.abs(bytes.readInt32LE(22))}`;
    console.log(`   ${t}: ${bytes.length} bytes ${dims}`);
  } catch (e) { console.log(`   ${t}: not available`); }
}
// images, remote -> local: a 40x20 blue PNG made here
const zlib = await import("node:zlib");
const W = 40, H = 20, raw = Buffer.alloc((W * 3 + 1) * H);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) raw[y * (W * 3 + 1) + 1 + x * 3 + 2] = 255;
const crc = (b) => { let c = ~0; for (const v of b) { c ^= v; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
const chunk = (type, data) => { const t = Buffer.from(type), l = Buffer.alloc(4), cr = Buffer.alloc(4); l.writeUInt32BE(data.length); cr.writeUInt32BE(crc(Buffer.concat([t, data]))); return Buffer.concat([l, t, data, cr]); };
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
// xrdp only converts image/bmp: offer a 40x20 blue 24 bit BMP
const bmp = Buffer.alloc(54 + 40 * 20 * 3);
bmp.write("BM", 0); bmp.writeUInt32LE(bmp.length, 2); bmp.writeUInt32LE(54, 10); bmp.writeUInt32LE(40, 14);
bmp.writeInt32LE(40, 18); bmp.writeInt32LE(20, 22); bmp.writeUInt16LE(1, 26); bmp.writeUInt16LE(24, 28);
for (let i = 54; i < bmp.length; i += 3) bmp[i] = 255;   // BGR: blue
void png;
xclip("-i -selection clipboard -t image/bmp", bmp);
await sleep(5000);
console.log("remote -> local image:", await ev(`(async () => { try { const items = await navigator.clipboard.read();
  for (const it of items) { const t = it.types.find((x) => x.startsWith("image/")); if (!t) continue;
    const b = await createImageBitmap(await it.getType(t)); const c = new OffscreenCanvas(b.width, b.height), g = c.getContext("2d"); g.drawImage(b, 0, 0);
    const px = g.getImageData(5, 5, 1, 1).data; return t + " " + b.width + "x" + b.height + " pixel(5,5)=" + Array.from(px).join(","); }
  return "no image, types: " + items.map((i) => i.types.join("+")).join(" | "); } catch (e) { return "ERR " + e.message; } })()`));
console.log(pg.logs.filter((l) => /clipboard|cliprdr/i.test(l)).slice(-8).join("\n"));
b.ws.close(); pg.ws.close(); chrome.kill();
