// The page in WebKit, as iPhone's Safari and the desktop's (#368: on an iPhone it said "Loading…"
// for good, because app.js used an API iPhone's Safari lacks, document.exitFullscreen).
//
//   node test-webkit.mjs <site dir | page URL>       e.g. dist/site (./site.sh makes one)
//
// Needs Playwright's WebKit (PLAYWRIGHT=<its package dir> when it is not installed here). It needs
// libraries a newer Linux may not have: then run it in Playwright's own image, e.g.
//   docker run --rm --network host -v "$PWD":/w -v <dir with node_modules/playwright>:/pw -w /w \
//     -e PLAYWRIGHT=/pw/node_modules/playwright mcr.microsoft.com/playwright:v1.50.1-noble \
//     node test-webkit.mjs dist/site
// Playwright's iPhone profile is WebKit with iPhone's screen, touch and the same missing full screen
// API; it is not iOS: its memory limits (the client asks for a 1 GiB shared maximum) only a phone shows.
// Checks, as iPhone and as desktop Safari:
//  - the page gets ready (Connect) with no page error; full screen works on the desktop and is
//    refused on the iPhone, not an error
//  - a client that cannot start (?engine=jspi: WebKit has no JSPI) says so on the button, never
//    "Loading…" for good
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const arg = process.argv[2] || "dist/site", port = 8193;
const require = createRequire(import.meta.url);
const { webkit, devices } = require(process.env.PLAYWRIGHT || "playwright");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  (" + detail + ")" : ""}`); if (!ok) fails++; };

let server = null, base = arg;
if (!/^https?:/.test(arg)) {
  server = spawn("python3", [new URL("serve.py", import.meta.url).pathname, String(port), resolve(arg)], { stdio: "ignore" });
  base = `http://127.0.0.1:${port}/index.html`;
  for (let i = 0; i < 50; i++) { await sleep(100); try { await fetch(base); break; } catch {} }
}
const url = (q) => base + (q ? (base.includes("?") ? "&" : "?") + q : "");
const button = (page) => page.evaluate(() => ({ text: document.getElementById("go")?.textContent, disabled: document.getElementById("go")?.disabled,
  status: document.getElementById("status")?.textContent }));
// the button's text, once it is no longer "Loading…" (or after 25 s)
async function settled(page) {
  for (let i = 0; i < 50; i++) { const b = await button(page); if (!/Loading/.test(b.text)) return b; await sleep(500); }
  return button(page);
}

const browser = await webkit.launch();
for (const [name, profile] of [["iPhone", devices["iPhone 14"]], ["desktop Safari", {}]]) {
  const ctx = await browser.newContext(profile);
  const page = await ctx.newPage(), errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(url(""));
  const b = await settled(page);
  check(`${name}: the page gets ready`, b.text === "Connect" && !b.disabled, JSON.stringify(b));
  check(`${name}: no page error`, !errors.length, errors.join("; "));
  if (name !== "iPhone") {   // full screen in and out, the page's own way (the toolbar's, the hotkey's)
    const fs = await page.evaluate(async () => { toggleFullscreen(); await new Promise((r) => setTimeout(r, 1000)); const inside = !!document.fullscreenElement;
    toggleFullscreen(); await new Promise((r) => setTimeout(r, 1000)); return { in: inside, out: !document.fullscreenElement }; });
    check(`${name}: full screen, in and out`, fs.in && fs.out, JSON.stringify(fs));
  } else {
    const fs = await page.evaluate(() => { try { toggleFullscreen(); return "no error"; } catch (e) { return e.message; } });
    await sleep(300);
    check("iPhone: full screen is refused, not an error", fs === "no error" && !errors.length, fs);
  }
  // a client that cannot start here
  const p2 = await ctx.newPage();
  await p2.goto(url("engine=jspi"));
  const f = await settled(p2);
  check(`${name}: a client that cannot start says so`, f.text === "Could not start" && f.disabled && /did not start/.test(f.status || ""), JSON.stringify(f));
  await ctx.close();
}
await browser.close();
server?.kill();
console.log(fails ? "FAILED" : "PASSED");
process.exit(fails ? 1 : 0);
