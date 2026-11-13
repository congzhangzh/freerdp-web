// The browser's clipboard, read only where the browser allows it silently (#368). Chrome and Edge
// have a clipboard-read permission: once given, the page reads on focus and every 1.5 s. Firefox
// and Safari have none: each navigator.clipboard.read() shows the browser's own "Paste" button
// for the user to click, so a page that reads on its own shows that button all the time. There the
// page reads nothing by itself and takes the clipboard from the user's paste (Ctrl or Cmd + V on
// the session) instead.
//
//   node test-clipboard.mjs <site dir>        e.g. dist/site (./site.sh makes one)
//
// Needs Playwright (PLAYWRIGHT=<its package dir> when it is not installed here) with its Firefox,
// and Chrome (CHROME=<binary>; else /usr/bin/google-chrome, else Playwright's own Chromium). No
// server: the page is put in its session state by hand (the body's "session" class, focus), which
// is all the clipboard code looks at; the client is not started.
// Checks, in each browser:
//  - Firefox: no read at all in 5 s, and a paste (Ctrl + V pressed on the canvas, the text put on
//    the clipboard first) offers its text to the client before the client sees the V.
//  - Chrome with clipboard-read granted: it still reads on its own (today's behaviour).
//  - Firefox: full screen in and out (not the clipboard's, but this test has the Firefox).
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const site = resolve(process.argv[2] || "dist/site"), port = 8191;
const require = createRequire(import.meta.url);
const { firefox, chromium } = require(process.env.PLAYWRIGHT || "playwright");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  (" + detail + ")" : ""}`); if (!ok) fails++; };

const server = spawn("python3", [new URL("serve.py", import.meta.url).pathname, String(port), site], { stdio: "ignore" });
for (let i = 0; i < 50; i++) { await sleep(100); try { await fetch(`http://127.0.0.1:${port}/index.html`); break; } catch {} }

// before the page's own scripts: count every clipboard read;
// stand in for the client: the clipboard offer and the keys SDL would see, in order
const init = () => {
  window.__clip = { reads: [], events: [] };
  const c = navigator.clipboard;
  for (const fn of ["read", "readText"]) if (c?.[fn]) {
    const real = c[fn].bind(c);
    c[fn] = (...a) => { window.__clip.reads.push(fn); return real(...a); };
  }
};
const fakeSession = () => {
  document.body.classList.add("session");
  window.Module ??= {};
  Module.ccall = (fn, ret, types, args) => { if (fn === "freerdp_web_clipboard_offer") window.__clip.events.push("offer:" + args[0]); return 1; };
  for (const t of ["keydown", "keyup"]) document.getElementById("canvas").addEventListener(t, (e) => window.__clip.events.push(`${t}:${e.code}`));
  const c = document.getElementById("canvas"); c.tabIndex = 0; c.focus();
  return document.hasFocus();
};

async function run(name, browserType, opts, ctxOpts, body) {
  let browser;
  try { browser = await browserType.launch(opts); }
  catch (e) { check(`${name}: starts`, false, e.message.split("\n")[0]); return; }
  try {
    const ctx = await browser.newContext(ctxOpts);
    const page = await ctx.newPage();
    const logs = [];
    page.on("console", (m) => logs.push(m.text()));
    page.on("pageerror", (e) => logs.push("pageerror: " + e.message));
    page.logs = logs;
    await page.addInitScript(init);
    await page.goto(`http://127.0.0.1:${port}/index.html`);
    await page.waitForFunction(() => typeof window.syncClipboard === "function" || document.readyState === "complete");
    await sleep(1500);   // the page's own start (and its permission query) settles first
    const focused = await page.evaluate(fakeSession);
    if (!focused) console.log(`NOTE  ${name}: the page has no focus (headless): ${focused}`);
    await body(page);
  } finally { await browser.close(); }
}

await run("Firefox", firefox, {}, {}, async (page) => {
  await sleep(5000);
  const reads = await page.evaluate(() => window.__clip.reads);
  // every read() there is a "Paste" button for the user; a paste brings its own data, so none at all
  // (navigator.userActivation would not tell: Playwright runs evaluate() as a user gesture)
  check("Firefox: the page never reads the clipboard by itself", reads.length === 0, `${reads.length} reads in 5 s`);
  // a real paste: text on the browser's clipboard, then Ctrl + V pressed on the canvas (Firefox
  // empties the clipboardData of a paste event a page makes itself, so it must be the browser's)
  await page.evaluate(() => navigator.clipboard.writeText("from the browser"));
  await page.evaluate(() => { window.__clip.events.length = 0; document.getElementById("canvas").focus(); });
  await page.keyboard.press("Control+KeyV");
  await sleep(600);
  const ev = (await page.evaluate(() => window.__clip.events)).filter((e) => !/Control/.test(e));
  const offer = ev.indexOf("offer:from the browser"), down = ev.indexOf("keydown:KeyV"), up = ev.indexOf("keyup:KeyV");
  const ok = offer >= 0 && down > offer && up > down;
  check("Firefox: a paste offers its text before the client sees Ctrl + V", ok, ev.join(", "));
  if (!ok || process.env.VERBOSE) console.log(page.logs.filter((l) => /clipboard|paste|error/i.test(l)).slice(-10).join("\n"));
});

// full screen in Firefox, the page's own way in and out (#368 changed how it leaves full screen)
await run("Firefox full screen", firefox, {}, {}, async (page) => {
  const fs = await page.evaluate(async () => { toggleFullscreen(); await new Promise((r) => setTimeout(r, 1000)); const inside = !!document.fullscreenElement;
    toggleFullscreen(); await new Promise((r) => setTimeout(r, 1000)); return { in: inside, out: !document.fullscreenElement }; });
  check("Firefox: full screen, in and out", fs.in && fs.out, JSON.stringify(fs));
});

await run("Chrome", chromium, { executablePath: process.env.CHROME || (existsSync("/usr/bin/google-chrome") ? "/usr/bin/google-chrome" : undefined) }, { permissions: ["clipboard-read", "clipboard-write"] }, async (page) => {
  await sleep(5000);
  const reads = await page.evaluate(() => window.__clip.reads);
  check("Chrome with the permission: it still reads on its own", reads.length >= 2, `${reads.length} reads in 5 s`);
});

server.kill();
console.log(fails ? "FAILED" : "PASSED");
process.exit(fails ? 1 : 0);
