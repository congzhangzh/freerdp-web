// The page in English and in Chinese (web/i18n.js), without any server: headless Chrome answers
// the page's requests itself (DevTools Fetch interception) from web/, and install.json from
// test-server-install.json. Two browsers, one that asks for Chinese (--lang=zh-CN, Accept-Language
// and navigator.languages zh-CN) and one for English (en-US).
//
//   node test-i18n.mjs [out dir]
//
// Checks, in Chinese: index.html and server.html say it in Chinese, with <html lang="zh-Hans">,
// the slogan's Chinese line first; the Language select switches to English and back at once, and
// English after the switch reads as a page loaded in English; a saved choice wins over the
// browser; no sideways scrolling at 390 px on any page. In English: every marked element and
// attribute is exactly as the HTML has it, <html lang="en">. Screenshots go to the out dir
// (default out/). CHROME=<binary> picks another Chrome or Chromium.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";

const web = new URL("web/", import.meta.url).pathname;
const sample = new URL("test-server-install.json", import.meta.url).pathname;
const out = resolve(process.argv[2] || new URL("out/", import.meta.url).pathname);
mkdirSync(out, { recursive: true });
// short path: Chrome's singleton socket must fit the 107-char Unix socket limit
const base = new URL(".chrome/", import.meta.url).pathname;
mkdirSync(base, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const logs = [];
let fails = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  (" + detail + ")" : ""}`); if (!ok) fails++; };
// port 1 has no server: every request is answered here, with the headers the client's threads need
const ORIGIN = "http://localhost:1";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".json": "application/json",
  ".webmanifest": "application/manifest+json", ".webp": "image/webp", ".mp4": "video/mp4" };
const PAGES = ["index.html", "safety.html", "keyboard.html", "server.html", "client.html", "install.html", "release-notes.html"];

// a headless Chrome that asks for these languages; its page, driven over DevTools
async function browser(lang) {
  const profile = mkdtempSync(join(base, "i18n-"));
  const port = 9400 + Math.floor(Math.random() * 500);
  const chrome = spawn(process.env.CHROME || "google-chrome", ["--headless=new", `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`, "--no-first-run", `--lang=${lang}`, `--accept-lang=${lang},${lang.split("-")[0]}`, "about:blank"],
    { stdio: "ignore", env: { ...process.env, TMPDIR: base, LANGUAGE: lang.replace("-", "_") } });
  chrome.on("exit", () => {   // remove the profile and Chrome's singleton-socket dir
    rmSync(profile, { recursive: true, force: true });
    for (const n of readdirSync(base)) if (n.startsWith("com.google.Chrome.")) rmSync(join(base, n), { recursive: true, force: true });
  });
  let target;
  for (let i = 0; i < 150 && !target; i++) {
    await sleep(200);
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page"); } catch {}
  }
  if (!target) { console.error("Chrome did not start"); chrome.kill(); process.exit(1); }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r));
  let id = 0; const pending = new Map();
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const b = { installJson: sample };
  function serve(m) {
    const path = decodeURIComponent(new URL(m.params.request.url).pathname).replace(/\/$/, "/index.html");
    let body = null;
    if (path === "/install.json") body = b.installJson && readFileSync(b.installJson);
    else if (!path.includes("..") && existsSync(join(web, path))) body = readFileSync(join(web, path));
    if (!body) return send("Fetch.fulfillRequest", { requestId: m.params.requestId, responseCode: 404, body: "" });
    send("Fetch.fulfillRequest", { requestId: m.params.requestId, responseCode: 200, body: body.toString("base64"),
      responseHeaders: [{ name: "Content-Type", value: TYPES[extname(path)] || "application/octet-stream" },
        { name: "Cross-Origin-Opener-Policy", value: "same-origin" }, { name: "Cross-Origin-Embedder-Policy", value: "require-corp" }] });
  }
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result ?? m.error); pending.delete(m.id); }
    if (m.method === "Fetch.requestPaused") serve(m);
    if (m.method === "Runtime.consoleAPICalled") logs.push(`[${lang}] ` + m.params.args.map((a) => a.value ?? a.description).join(" "));
    if (m.method === "Runtime.exceptionThrown") logs.push(`[${lang}] EXCEPTION ` + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
  });
  await send("Fetch.enable", { patterns: [{ urlPattern: ORIGIN + "/*" }] });
  // the headers above isolate the page; its isolation service worker stays out of the way
  await send("Network.enable"); await send("Network.setBypassServiceWorker", { bypass: true });
  await send("Runtime.enable"); await send("Page.enable");
  b.ev = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true, userGesture: true }))?.result?.value;
  b.width = (width) => send("Emulation.setDeviceMetricsOverride", width > 600
    ? { width, height: 900, deviceScaleFactor: 1, mobile: false } : { width, height: 844, deviceScaleFactor: 1, mobile: true });
  b.open = async (page, json = sample) => {
    b.installJson = json;
    await send("Page.navigate", { url: `${ORIGIN}/${page}` });
    for (let i = 0; i < 25 && await b.ev("document.readyState") !== "complete"; i++) await sleep(200);
    await sleep(600);   // install.json's fetch, the client's (not here), the splash's demo.json
  };
  b.screenshot = async (name) => {
    const r = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
    writeFileSync(join(out, name), Buffer.from(r.data, "base64"));
  };
  b.close = () => { ws.close(); chrome.kill(); };
  return b;
}
const text = (selector) => `document.querySelector(${JSON.stringify(selector)})?.textContent.trim()`;
const han = /[一-鿿]/;
// every marked element and attribute as the HTML file has it (English is the HTML, untouched)
const asWritten = `(async () => {
  const doc = new DOMParser().parseFromString(await (await fetch(location.pathname)).text(), "text/html");
  const mine = [...document.querySelectorAll("[data-i18n], [data-i18n-attr]")], theirs = [...doc.querySelectorAll("[data-i18n], [data-i18n-attr]")];
  if (mine.length !== theirs.length) return "count " + mine.length + " vs " + theirs.length;
  for (let i = 0; i < mine.length; i++) {
    if (mine[i].dataset.i18n && mine[i].textContent !== theirs[i].textContent) return mine[i].dataset.i18n + ": " + mine[i].textContent;
    for (const pair of (mine[i].dataset.i18nAttr || "").split(",")) {
      const name = pair.split(":")[0];
      if (mine[i].getAttribute(name) !== theirs[i].getAttribute(name)) return pair + ": " + mine[i].getAttribute(name);
    }
  }
  return "same";
})()`;

// ---- English: the pages as written
const en = await browser("en-US");
await en.width(1280);
check("en: the browser asks for English", /^en/.test(await en.ev("navigator.languages[0]")), await en.ev("navigator.languages.join()"));
const english = {};
for (const page of PAGES) {
  await en.open(page, null);   // server.html: its own line, not the cards that replace it
  const same = await en.ev(asWritten);
  check(`en: ${page} is as written, <html lang="en">`, same === "same" && await en.ev("document.documentElement.lang") === "en", same);
  english[page] = await en.ev("document.body.innerText");
}
await en.open("index.html");
check("en: the form and the settings in English", await en.ev(text("#hostLabel")) === "Gateway" && await en.ev(text("#sessionSummary")) === "recommended"
  && await en.ev(text("#codecHint")) === "The server picks from every codec the client offers (AV1 4:4:4 included).");
check("en: the Language select shows Auto, before Theme", await en.ev("document.getElementById('lang').value") === "auto"
  && await en.ev("document.getElementById('lang').closest('label').nextElementSibling.querySelector('#theme') !== null"));
en.close();

// ---- Chinese: what a browser that asks for zh-CN shows
const zh = await browser("zh-CN");
check("zh: the browser asks for Chinese", /^zh/.test(await zh.ev("navigator.languages[0]")), await zh.ev("navigator.languages.join()"));
await zh.width(1280);
await zh.open("index.html");
check('zh: index.html is <html lang="zh-Hans">', await zh.ev("document.documentElement.lang") === "zh-Hans");
check("zh: the header in Chinese", await zh.ev(text('nav a[href="server.html"]')) === "获取服务器" && await zh.ev(text('nav a[href="safety.html"]')) === "安全与隧道"
  && await zh.ev("document.getElementById('lang').getAttribute('aria-label')") === "语言");
check("zh: the tagline, the safety notice and the form in Chinese",
  han.test(await zh.ev(text(".tagline"))) && han.test(await zh.ev(text("#route p"))) && await zh.ev(text("#hostLabel")) === "网关"
  && await zh.ev(text("label.field span")) === "名称" && await zh.ev(text("#sessionPanel > summary span")) === "会话设置",
  await zh.ev(text(".tagline")));
check("zh: the settings' summary and hints in Chinese", await zh.ev(text("#sessionSummary")) === "推荐" && han.test(await zh.ev(text("#codecHint")))
  && han.test(await zh.ev(text("#hotkeyHint"))), `${await zh.ev(text("#sessionSummary"))} / ${await zh.ev(text("#hotkeyHint"))}`);
check("zh: the toolbar and About in Chinese", await zh.ev(text("#tbFs")) === "全屏" && await zh.ev(text("#tbQuit")) === "断开连接"
  && await zh.ev(text("#aboutPanel summary")) === "关于本客户端"
  && await zh.ev("[...document.querySelectorAll('#aboutTable tr')].map((r) => r.cells[0].textContent).includes('版本')"));
check("zh: the slogan's Chinese line first, the English one smaller and marked English",
  await zh.ev(text(".mascot-slogan span")) === "你在这里，也在云端：" && await zh.ev(text(".mascot-slogan .alt")) === "You here, you in the cloud: one desktop."
  && await zh.ev("document.querySelector('.mascot-slogan .alt').lang") === "en");
// what stays English: the commands, the options sent to FreeRDP, the product names
check("zh: the SSH line and the options preview stay as they are", /^ssh -tt .* websockify 127\.0\.0\.1:3390 127\.0\.0\.1:3389$/.test(await zh.ev(text("#sshCmd")))
  && !han.test(await zh.ev(text("#preview"))));
await zh.screenshot("i18n-index-wide.png");

// the Language select: English at once (as a page loaded in English), Chinese again
await zh.ev("(() => { const s = document.getElementById('lang'); s.value = 'en'; s.dispatchEvent(new Event('change')); return true; })()"); await sleep(300);
const switched = await zh.ev("document.body.innerText");
const diff = switched.split("\n").filter((l, i) => l !== english["index.html"].split("\n")[i]);
check("zh → English: <html lang=\"en\">, saved, and the page reads as one loaded in English",
  await zh.ev("document.documentElement.lang") === "en" && await zh.ev("localStorage.getItem('freerdp-web-lang')") === "en" && !diff.length,
  diff.slice(0, 3).join(" | "));
check("zh → English: every marked element as written", await zh.ev(asWritten) === "same");
await zh.ev("(() => { const s = document.getElementById('lang'); s.value = 'zh'; s.dispatchEvent(new Event('change')); return true; })()"); await sleep(300);
check("English → 中文: Chinese again", await zh.ev("document.documentElement.lang") === "zh-Hans" && await zh.ev(text("#hostLabel")) === "网关"
  && await zh.ev(text("#sessionSummary")) === "推荐");
await zh.ev("(() => { const s = document.getElementById('lang'); s.value = 'en'; s.dispatchEvent(new Event('change')); return true; })()");
await zh.open("index.html");
check("a saved choice wins over the browser's language: English after a reload", await zh.ev("document.documentElement.lang") === "en"
  && await zh.ev(text('nav a[href="server.html"]')) === "Get a server");
await zh.ev("localStorage.setItem('freerdp-web-lang', 'auto'), true");

// server.html: the page's words in Chinese, install.json's as written
await zh.open("server.html");
const kit = await zh.ev("document.getElementById('kit').innerText") || "";
check("zh: server.html is <html lang=\"zh-Hans\"> with a Chinese title", await zh.ev("document.documentElement.lang") === "zh-Hans"
  && await zh.ev("document.title") === "获取服务器 · FreeRDP Web" && await zh.ev(text("h1")) === "获取服务器");
check("zh: the cards' headings and labels in Chinese, the sessions and commands as install.json has them",
  ["安装 xrdp", "启动服务", "全部文件及校验和："].every((s) => kit.includes(s)) && kit.includes("Wayland: GNOME, KDE Plasma, sway")
  && await zh.ev("[...document.querySelectorAll('#kit .copyable button')].every((b) => b.textContent === '复制')"), kit.split("\n").slice(0, 4).join(" | "));
await zh.screenshot("i18n-server-wide.png");
await zh.ev("(() => { const s = document.getElementById('lang'); s.value = 'en'; s.dispatchEvent(new Event('change')); return true; })()"); await sleep(300);
const kitEn = await zh.ev("document.getElementById('kit').innerText") || "";
check("server.html, switched to English: the cards in English", kitEn.includes("Install xrdp") && kitEn.includes("All files and checksums: ") && !han.test(kitEn));
await zh.ev("localStorage.setItem('freerdp-web-lang', 'auto'), true");
await zh.open("server.html", null);
check("zh: without install.json, the one line to the kit's latest release in Chinese", await zh.ev(text("#kitFallback a")) === "发布工具包的最新版本");

// client.html: the three ways and the clients' labels in Chinese, the uvx command as it is
await zh.open("client.html");
const native = await zh.ev("document.getElementById('native').innerText") || "";
check("zh: client.html with a Chinese title, its three ways in Chinese", await zh.ev("document.title") === "获取客户端 · FreeRDP Web"
  && JSON.stringify(await zh.ev("[...document.querySelectorAll('main h2')].map((h) => h.textContent)")) === JSON.stringify(["1. 在浏览器里", "2. 作为 Chrome 应用", "3. 原生客户端"]));
check("zh: the clients' labels in Chinese, the uvx command as it is", ["平台", "文件", "freerdp-tk：连接窗口", "全部文件及校验和："].every((s) => native.includes(s))
  && native.includes("uvx freerdp-tk"), native.split("\n").slice(0, 3).join(" | "));

// every page at phone width, in Chinese
await zh.width(390);
for (const page of PAGES) {
  await zh.open(page);
  const w = await zh.ev("document.documentElement.scrollWidth");
  check(`zh: ${page} in Chinese fits 390 px`, w <= 390 && await zh.ev("document.documentElement.lang") === "zh-Hans", `${w} px`);
  if (page === "index.html") await zh.screenshot("i18n-index-phone.png");
  if (page === "server.html") await zh.screenshot("i18n-server-phone.png");
}
check("zh: release-notes.html says, in Chinese, that its entries are English", await zh.ev("!document.querySelector('[data-i18n=\"notes.english\"]').hidden"));
zh.close();

check("no page errors", !logs.some((l) => l.includes("EXCEPTION")), logs.filter((l) => l.includes("EXCEPTION")).join("; "));
writeFileSync(join(out, "i18n.log"), logs.join("\n") + "\n");
console.log(`${fails ? "FAILED" : "PASSED"}: screenshots and log in ${out}`);
process.exit(fails ? 1 : 0);
