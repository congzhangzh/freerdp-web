// Fill the window (聪哥, 2026-11-16): the page's own full screen, where the page's real one is fragile
// (Firefox and Safari have no Keyboard Lock, so Esc ends it and never reaches the remote side;
// Claude Code needs Esc) or missing (an iPhone). No server: the page is put in its session state by
// hand, as the session's own layout needs nothing more.
//
//   node test-fill.mjs <site dir>        e.g. dist/site (./site.sh makes one)
//
// BROWSERS="chromium firefox webkit iphone" (the default); PLAYWRIGHT=<its package dir> when it is
// not installed here; WebKit needs Playwright's image on a newer Linux (test-webkit.mjs has the line).
// Checks, per browser:
//  - freerdpWeb.setFill(true): the remote desktop takes exactly the viewport, the toolbar hides at
//    the top edge, the "freerdpfillchange" event says so, and setFill(false) gives the window back
//  - Esc reaches the remote side (a keydown on the canvas, where SDL listens), and the page stays
//  - the toolbar's Full screen picks fill where page full screen has no Keyboard Lock (Firefox,
//    WebKit), and the real one where it has (Chromium)
//  - with a mouse the round toolbar button is hidden; on the iPhone it shows, a tap shows the
//    toolbar and the next hides it, a drag moves it, and its taps never reach the remote side
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const site = resolve(process.argv[2] || "dist/site"), port = 8268;
const require = createRequire(import.meta.url);
const pw = require(process.env.PLAYWRIGHT || "playwright");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  (" + detail + ")" : ""}`); if (!ok) fails++; };

if (await fetch(`http://127.0.0.1:${port}/`).then(() => true, () => false)) { console.log(`FAIL  port ${port} is in use`); process.exit(1); }
const server = spawn("python3", [new URL("serve.py", import.meta.url).pathname, String(port), site], { stdio: "ignore" });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { server.kill(); process.exit(1); });
for (let i = 0; i < 50 && !(await fetch(`http://127.0.0.1:${port}/index.html`).then(() => true, () => false)); i++) await sleep(100);

async function ready(page, url) {
  await page.goto(url);
  for (let i = 0; i < 60 && await page.evaluate(() => document.getElementById("status")?.textContent).catch(() => "") !== "ready"; i++) await sleep(500);
  // the session's layout, by hand (no server), and a record of what reaches the remote side's canvas
  await page.evaluate(() => {
    document.body.classList.add("session");
    window.__fill = [], window.__keys = [], window.__canvasPointers = 0;
    window.addEventListener("freerdpfillchange", (e) => window.__fill.push(e.detail.fill));
    const c = document.getElementById("canvas");
    c.addEventListener("keydown", (e) => window.__keys.push(e.key));
    for (const t of ["pointerdown", "mousedown", "touchstart"]) c.addEventListener(t, () => window.__canvasPointers++);
  });
}
const geometry = (page) => page.evaluate(() => { const r = document.getElementById("canvas").getBoundingClientRect();
  return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), vw: innerWidth, vh: innerHeight,
    fill: document.body.classList.contains("fill"), hidden: document.body.classList.contains("tbhide"), fs: !!document.fullscreenElement,
    fab: getComputedStyle(document.getElementById("tbFab")).display }; });
const fills = (g) => g.fill && g.x === 0 && g.y === 0 && Math.abs(g.w - g.vw) <= 1 && Math.abs(g.h - g.vh) <= 1;

for (const which of (process.env.BROWSERS || "chromium firefox webkit iphone").split(/\s+/).filter(Boolean)) {
  const phone = which === "iphone", type = phone ? "webkit" : which;
  const browser = await pw[type].launch();
  console.log(`browser: ${which} ${browser.version()}`);
  const ctx = await browser.newContext(phone ? { ...pw.devices["iPhone 14"] } : { viewport: { width: 1000, height: 700 } });
  const page = await ctx.newPage();
  if (!phone) {
    await ready(page, `http://127.0.0.1:${port}/index.html`);
    await page.evaluate(() => freerdpWeb.setFill(true)); await sleep(300);
    const g = await geometry(page);
    check(`${which}: setFill(true): the remote desktop takes exactly the viewport, the toolbar hides`, fills(g) && g.hidden && !g.fs, JSON.stringify(g));
    check(`${which}: …and says so ("freerdpfillchange", freerdpWeb.fill)`, JSON.stringify(await page.evaluate(() => [window.__fill, freerdpWeb.fill])) === "[[true],true]");
    await page.evaluate(() => document.getElementById("canvas").focus());
    await page.keyboard.press("Escape"); await sleep(200);
    const afterEsc = await geometry(page), keys = await page.evaluate(() => window.__keys);
    check(`${which}: Esc reaches the remote side (the canvas), and the page stays filled`, keys.includes("Escape") && fills(afterEsc), JSON.stringify({ keys, fill: afterEsc.fill }));
    check(`${which}: with a mouse the round toolbar button stays hidden`, g.fab === "none", g.fab);
    await page.evaluate(() => freerdpWeb.setFill(false)); await sleep(300);
    const back = await geometry(page);
    check(`${which}: setFill(false) gives the window back`, !back.fill && back.y > 0, JSON.stringify(back));
    // the toolbar's Full screen: fill without Keyboard Lock, the real one with it
    const lock = await page.evaluate(() => !!navigator.keyboard?.lock);
    await page.click("#tbFs"); await sleep(800);
    const viaButton = await geometry(page);
    check(`${which}: the toolbar's Full screen is ${lock ? "the real one (Keyboard Lock here)" : "fill the window (no Keyboard Lock here)"}`,
      lock ? viaButton.fs && !viaButton.fill : viaButton.fill && !viaButton.fs, JSON.stringify({ lock, fill: viaButton.fill, fs: viaButton.fs }));
  } else {
    await ready(page, `http://127.0.0.1:${port}/index.html?fill=1`);
    await sleep(300);
    const g = await geometry(page);
    check("iphone: ?fill=1 fills the screen (no page full screen on an iPhone)", fills(g), JSON.stringify(g));
    check("iphone: the round toolbar button shows", g.fab === "block", g.fab);
    const box = await page.locator("#tbFab").boundingBox();
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2); await sleep(400);
    const shown = !(await page.evaluate(() => document.body.classList.contains("tbhide")));
    await sleep(3000);   // no mouse leaves it: it stays until the next tap
    const stays = !(await page.evaluate(() => document.body.classList.contains("tbhide")));
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2); await sleep(400);
    const hiddenAgain = await page.evaluate(() => document.body.classList.contains("tbhide"));
    check("iphone: a tap shows the toolbar, it stays, and the next tap hides it", shown && stays && hiddenAgain, JSON.stringify({ shown, stays, hiddenAgain }));
    // a drag moves it (pointer events, as a finger's)
    await page.mouse.move(box.x + 22, box.y + 22); await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(box.x + 22 - i * 15, box.y + 22 - i * 20);
    await page.mouse.up(); await sleep(200);
    const moved = await page.locator("#tbFab").boundingBox();
    check("iphone: a drag moves the button", moved.x < box.x - 100 && moved.y < box.y - 150, JSON.stringify({ from: [Math.round(box.x), Math.round(box.y)], to: [Math.round(moved.x), Math.round(moved.y)] }));
    check("iphone: the button's taps and drags never reach the remote side", (await page.evaluate(() => window.__canvasPointers)) === 0, String(await page.evaluate(() => window.__canvasPointers)));
  }
  await browser.close();
}
server.kill();
console.log(fails ? "FAILED" : "PASSED");
process.exit(fails ? 1 : 0);
