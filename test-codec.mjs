// Runs FreeRDP codec unit tests in headless Chrome (real WebCodecs), e.g. the AV1 round trip.
// Needs: python3 serve.py 8083 dist-test   Usage: node test-codec.mjs [TestName...]
import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
const tests = process.argv.slice(2).length ? process.argv.slice(2) : ["TestFreeRDPCodecAV1"];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const base = new URL(".chrome/", import.meta.url).pathname;
const profile = mkdtempSync(join(base, "codec-"));
const chrome = spawn("google-chrome", ["--headless=new", "--remote-debugging-port=9339", `--user-data-dir=${profile}`,
  "--no-first-run", "--enable-unsafe-swiftshader", "about:blank"], { stdio: "ignore", env: { ...process.env, TMPDIR: base } });
chrome.on("exit", () => {
  rmSync(profile, { recursive: true, force: true });
  for (const n of readdirSync(base)) if (n.startsWith("com.google.Chrome.")) rmSync(join(base, n), { recursive: true, force: true });
});
let t; for (let i = 0; i < 150 && !t; i++) { await sleep(200); try { t = (await (await fetch("http://127.0.0.1:9339/json")).json()).find((x) => x.type === "page"); } catch {} }
const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const p = new Map(); let logs = [];
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && p.has(m.id)) { p.get(m.id)(m.result); p.delete(m.id); }
  if (m.method === "Runtime.consoleAPICalled") logs.push(m.params.args.map((a) => a.value ?? a.description).join(" "));
  if (m.method === "Runtime.exceptionThrown") logs.push("[exception] " + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text)); });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; p.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await send("Runtime.enable");
let failed = 0;
for (const test of tests) {
  logs = [];
  await send("Page.navigate", { url: `http://127.0.0.1:8083/index.html?test=${test}` });
  let done; const t0 = Date.now();
  while (done === undefined && Date.now() - t0 < 180000) { await sleep(250);
    done = (await send("Runtime.evaluate", { expression: "window.__done", returnByValue: true })).result?.value; }
  const skipped = logs.some((l) => /skipping/i.test(l));
  console.log(`${test.padEnd(30)} ${done === 0 && !skipped ? "PASS" : skipped ? "SKIPPED" : "FAIL (" + done + ")"}  ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  for (const l of logs.filter((l) => /webcodecs|AV1 decoder|colour|error|exception|skipping/i.test(l)).slice(0, 12)) console.log("    " + l);
  if (!(done === 0 && !skipped)) failed++;
}
ws.close(); chrome.kill();
process.exitCode = failed ? 1 : 0;
