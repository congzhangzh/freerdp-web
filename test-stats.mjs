// FreeRDP's own counters in a real session: log in over the gateway, open Info the way a person
// does (the toolbar's Info button), and print what it says and every counter that is not 0. The
// counters are only worth showing if real sessions move them, which a page test without a server
// can't tell: there, every value is 0.
//
//   PAGE=http://localhost:8080/index.html GATEWAY=127.0.0.1:6081 node test-stats.mjs [seconds]
//
// Fails when: no session starts, the client has no counters, no graphics or bytes are counted,
// or AV1 or H.264 arrived and no decoder counted it (then Info must show its results too). A
// server that sends neither has no decoder row, which is right: an older xrdp sends Planar and
// Progressive. With FreeRDP's counters the page's own AV1 rows are gone, so never two times for one
// picture. EXTRA replaces the session's FreeRDP options (default /gfx:AV2:off, see below), e.g. /gfx:AV2:off,AV1:i444.
// AV2 is off by default: FreeRDP signals it under AV1's codec id (RDPGFX_CAPVERSION_FRDP_2), and
// up to 20261111 its frames had no decoder verdict under AV1's name (2026-11-10, 116 commands, 0
// decoder results). From 20261113 (RDPGFX_CODECID_* names) AV2's verdict is AV1's counters under
// FRDP_2, and Info labels it AV2: EXTRA=/gfx tests AV2, and is checked to say "AV2 results" then.
// Either set of decoder names is read. Round trip, bandwidth and sound are printed and not failed on: only some servers
// measure, and a silent desktop plays nothing. USER_NAME and PASSWORD pick the login
// (test / test, the CI container's). CHROME=<binary> picks another Chrome or Chromium.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { connectTestSession } from "./test-connect.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PAGE = process.env.PAGE || "http://localhost:8080/index.html", GATEWAY = process.env.GATEWAY || "127.0.0.1:6081";
const seconds = Number(process.argv[2]) || 8, port = 9347;
const base = new URL(".chrome/", import.meta.url).pathname;
mkdirSync(base, { recursive: true });
const profile = mkdtempSync(join(base, "st-"));
const chrome = spawn(process.env.CHROME || "google-chrome", ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
  "--no-first-run", "--window-size=1280,900", "--enable-unsafe-swiftshader", "about:blank"], { stdio: "ignore", env: { ...process.env, TMPDIR: base } });
chrome.on("exit", () => { rmSync(profile, { recursive: true, force: true });
  for (const n of readdirSync(base)) if (n.startsWith("com.google.Chrome.")) rmSync(join(base, n), { recursive: true, force: true }); });
let fails = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  (" + detail + ")" : ""}`); if (!ok) fails++; };
const done = (code) => { chrome.kill(); process.exit(code); };
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => done(1));

let target;
for (let i = 0; i < 150 && !target; i++) { await sleep(200); try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page"); } catch {} }
if (!target) { console.error("Chrome did not start"); done(1); }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const pending = new Map(), logs = [];
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result ?? m.error); pending.delete(m.id); }
  if (m.method === "Runtime.consoleAPICalled") logs.push(m.params.args.map((a) => a.value).join(" "));
});
const ev = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true, userGesture: true, awaitPromise: true }))?.result?.value;
const reading = () => ev("(() => { const s = clientStats(); return s ? JSON.stringify(s) : null; })()").then((s) => (s ? JSON.parse(s) : null));
const nonZero = (s) => Object.fromEntries(Object.entries(s).filter(([, v]) => v));

await send("Runtime.enable");
await send("Page.navigate", { url: `${PAGE}?v=${GATEWAY}&u=${process.env.USER_NAME || "test"}&extra=${encodeURIComponent(process.env.EXTRA || "/gfx:AV2:off")}&fs=0` });
await connectTestSession(send, { password: process.env.PASSWORD || "test" }).catch((e) => { console.error(e, "\n" + logs.slice(-20).join("\n")); done(1); });
let session = false;
for (let i = 0; i < 60 && !session; i++) { await sleep(500); session = await ev("document.body.classList.contains('session') && !!document.getElementById('canvas').width"); }
check("a session started", session);
if (!session) { console.log(logs.slice(-25).join("\n")); done(1); }

await sleep(3000);
const first = await reading();
check("the client has FreeRDP's counters", !!first, first ? Object.keys(first).length + " names" : "");
if (!first) done(1);
await ev("document.getElementById('tbInfo').click(), true");
await sleep(seconds * 1000);
const second = await reading();
const info = await ev("document.getElementById('infoTable').innerText");
console.log("\n--- Info ---\n" + info + "\n--- counters that are not 0 ---\n" + JSON.stringify(nonZero(second), null, 1) + "\n");
const sum = (re) => Object.entries(second).filter(([k]) => re.test(k)).reduce((n, [, v]) => n + v, 0);
const commands = sum(/^RDPGFX_CMDID_WIRETOSURFACE_/), video = sum(/^RDPGFX_CODECID_(AV1|AVC)[^_]*$/);
// the video decoders' attempts, by either name set (RDPGFX_CODECID_* from 20261113, RDPGFX_DECODER_* before)
const tries = sum(/^RDPGFX_(CODECID|DECODER)_(AV1|AV2|AVC[^_]*)_(PICTURES|FAILED|NO_PICTURE)$/);
// the GFX caps version the server confirmed (codec-stats.js [1]): FRDP_2 = AV2
const caps = await ev("(() => { const r = codecReading(); return r ? r[1] : null; })()");
check("the server's graphics were counted", commands > 0, `${commands} surface commands`);
if (video) {
  check("the decoder counted what arrived", tries > 0, `${video} commands, ${tries} decoder results`);
  check("Info shows that decoder's results", / results\s+pictures: \d+/.test(info || ""));
  // AV2's pictures are AV1's counters under FRDP_2: Info must call them AV2's (new names), never AV1's
  if (caps === 0x00020000) check("AV2: Info names the decoder AV2", /AV2 results\s+pictures: [1-9]/.test(info || "") && !/AV1 results/.test(info || ""), "caps FRDP_2");
  else console.log(`INFO  confirmed caps version ${caps === null ? "unknown" : "0x" + caps.toString(16)}`);
} else console.log("SKIP  no AV1 or H.264 from this server: no decoder to check");
// not "grew": an idle desktop sends nothing between two readings
check("Info has FreeRDP's counters instead of the page's own AV1 rows", !/AV1 frames|AV1 decode\b/.test(info || ""));
check("the network was counted", second.NETWORK_BYTES_RECEIVED > 0 && second.NETWORK_BYTES_RECEIVED >= first.NETWORK_BYTES_RECEIVED, `${first.NETWORK_BYTES_RECEIVED} -> ${second.NETWORK_BYTES_RECEIVED} bytes`);
// RDP's own bytes in Info (20261114.1), beside the WebSocket's: a rate and this connection's total
const rdpIn = /Network in \(RDP\)\s+(\d+ kbit\/s|–), ([\d.]+) MB total/.exec(info || ""), rdpOut = /Network out \(RDP\)\s+(\d+ kbit\/s|–), ([\d.]+) MB total/.exec(info || "");
check("Info shows RDP's own bytes, in and out", !!rdpIn && !!rdpOut && +rdpIn[2] > 0, rdpIn && rdpOut ? `in ${rdpIn[1]}, ${rdpIn[2]} MB; out ${rdpOut[1]}, ${rdpOut[2]} MB` : "no rows");
console.log(`${fails ? "FAILED" : "PASSED"}`);
done(fails ? 1 : 0);
