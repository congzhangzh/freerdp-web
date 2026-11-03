const {test} = require("node:test");
const assert = require("node:assert/strict");
const {readdirSync, readFileSync} = require("node:fs");
const {join} = require("node:path");
const I = require("../i18n.js");
const web = join(__dirname, "..");
const files = (ext) => readdirSync(web).filter((f) => f.endsWith(ext)).map((f) => [f, readFileSync(join(web, f), "utf8")]);

test("the language: a saved choice wins; Auto takes the browser's first of the four, of any region", () => {
  assert.equal(I.pick("en", ["zh-CN"]), "en");
  assert.equal(I.pick("zh", ["en-US"]), "zh");
  assert.equal(I.pick("ja", ["fr-FR"]), "ja");
  assert.equal(I.pick("fr", ["ja-JP"]), "fr");
  for (const l of ["zh-CN", "zh-TW", "zh-HK", "zh", "zh-Hans", "ZH-cn"]) assert.equal(I.pick("auto", [l]), "zh", l);
  for (const l of ["ja", "ja-JP", "JA-jp"]) assert.equal(I.pick("auto", [l]), "ja", l);
  for (const l of ["fr", "fr-FR", "fr-CA", "fr-BE", "FR-ch"]) assert.equal(I.pick("auto", [l]), "fr", l);
  assert.equal(I.pick("auto", ["en-US"]), "en");
  assert.equal(I.pick("auto", ["de-DE", "fr-FR", "zh-CN", "en"]), "fr");   // the first of the four that is there
  assert.equal(I.pick("auto", ["ja", "en-GB", "zh-CN"]), "ja");
  assert.equal(I.pick("auto", ["en-GB", "ja"]), "en");
  for (const l of [["de"], ["ko-KR"], ["zhx-ab"], ["jav"], ["fry"], [], undefined]) assert.equal(I.pick("auto", l), "en", JSON.stringify(l));
  assert.equal(I.pick("de", ["ja"]), "ja");   // a choice that is no language of the page is Auto
});
test("t(): the Chinese in Chinese, its vars filled; the English given otherwise, also for a key the table lacks", () => {
  assert.equal(I.translate("zh", "nav.server", "Get a server"), "获取服务器");
  assert.equal(I.translate("en", "nav.server", "Get a server"), "Get a server");
  assert.equal(I.translate("zh", "no.such.key", "Fallback"), "Fallback");
  assert.equal(I.translate("zh", "hosts.deleted", "“Lab” deleted.", {name: "Lab"}), "“Lab”已删除。");
  assert.equal(I.translate("en", "hosts.deleted", "“Lab” deleted.", {name: "Lab"}), "“Lab” deleted.");
  // node has no localStorage and the English of the browser it mimics: English until set
  assert.equal(I.t("nav.server", "Get a server"), I.lang === "zh" ? "获取服务器" : "Get a server");
  I.set("zh"); assert.equal(I.t("nav.server", "Get a server"), "获取服务器");
  I.set("ja"); assert.equal(I.t("nav.server", "Get a server"), I.JA["nav.server"]);
  I.set("fr"); assert.equal(I.t("nav.server", "Get a server"), I.FR["nav.server"]);
  I.set("en"); assert.equal(I.t("nav.server", "Get a server"), "Get a server");
});
test("Japanese and French: the same keys as Chinese, each with the same placeholders", () => {
  const ph = (v) => [...v.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join();
  for (const [name, table] of [["JA", I.JA], ["FR", I.FR]]) {
    assert.deepEqual(Object.keys(table).filter((k) => !Object.hasOwn(I.ZH, k)), [], name + ": keys Chinese lacks");
    assert.deepEqual(Object.keys(I.ZH).filter((k) => !Object.hasOwn(table, k)), [], name + ": keys missing");
    for (const k of Object.keys(I.ZH)) assert.equal(ph(table[k]), ph(I.ZH[k]), `${name} ${k}`);
  }
  assert.equal(I.translate("ja", "punct.period", "."), "。");
  assert.equal(I.translate("fr", "punct.period", "."), ".");
});
test("every page's language menu: Auto, then the four, each in its own words", () => {
  for (const [f, s] of files(".html")) {
    const m = s.match(/<select id="lang"[^>]*>([\s\S]*?)<\/select>/);
    if (!m) continue;
    assert.deepEqual([...m[1].matchAll(/<option value="(\w+)"/g)].map((o) => o[1]), ["auto", "en", "zh", "ja", "fr"], f);
  }
});
test("every placeholder of a Chinese line is one its caller fills", () => {
  const call = /\b(?:t\(\s*"([^"]+)",\s*(?:`[^`]*`|"[^"]*"|[^,`"]+)|(?:say|status|screensSay)\((?:`[^`]*`|"[^"]*"|[^,`"]+),\s*"([^"]+)"),\s*\{([^}]*)\}\s*\)/g;
  for (const [f, s] of files(".js")) for (const m of s.matchAll(call)) {
    m[1] ??= m[2]; m[2] = m[3];
    if (!Object.hasOwn(I.ZH, m[1])) continue;
    const given = new Set(m[2].split(",").map((v) => v.split(":")[0].trim()));
    for (const [, name] of I.ZH[m[1]].matchAll(/\{(\w+)\}/g)) assert.ok(given.has(name), `${f}: ${m[1]} needs {${name}}`);
  }
});

// the keys the pages use: data-i18n and data-i18n-attr in the HTML; t("key", …) and i18n: "key" in
// the scripts, and keys a script picks among (a string that is a key of the table, as is)
const spaces = new Set(Object.keys(I.ZH).map((k) => k.split(".")[0]));
function used() {
  const marked = new Set(), named = new Set();
  for (const [, s] of files(".html")) {
    for (const m of s.matchAll(/\sdata-i18n="([^"]*)"/g)) marked.add(m[1]);
    for (const m of s.matchAll(/\sdata-i18n-attr="([^"]*)"/g)) for (const pair of m[1].split(",")) marked.add(pair.split(":")[1]);
  }
  for (const [f, s] of files(".js")) {
    if (f === "i18n.js") continue;
    for (const m of s.matchAll(/\bt\(\s*"([^"]+)"/g)) marked.add(m[1]);
    for (const m of s.matchAll(/\bi18n:\s*"([^"]+)"/g)) marked.add(m[1]);
    for (const m of s.matchAll(/\b(?:say|status|screensSay)\((?:`[^`]*`|"[^"]*"|[^,`"]+),\s*"([^"]+)"/g)) marked.add(m[1]);
    // a key picked in an expression: a string of the table's namespaces (nav., hosts., …)
    for (const m of s.matchAll(/"([a-z]+)\.(\w+)"/g)) if (spaces.has(m[1])) marked.add(m[1] + "." + m[2]);
    for (const m of s.matchAll(/"([\w.]+)"/g)) named.add(m[1]);
  }
  return {marked, named};
}
test("every key the pages and scripts use has its Chinese", () => {
  const {marked} = used();
  const missing = [...marked].filter((k) => !Object.hasOwn(I.ZH, k));
  assert.deepEqual(missing, []);
  assert.ok(marked.size > 300, `${marked.size} keys`);
});
test("no Chinese line that nothing uses", () => {
  const {marked, named} = used();
  assert.deepEqual(Object.keys(I.ZH).filter((k) => !marked.has(k) && !named.has(k)), []);
});
test("no markup, and no empty line, in the tables: the page sets text only (Trusted Types)", () => {
  for (const [k, v] of [I.ZH, I.JA, I.FR].flatMap((t) => Object.entries(t))) {
    assert.ok(typeof v === "string" && v.length, k);
    assert.ok(!/<[a-z/]/i.test(v) || k === "safety.checkMode" || k === "safety.runUser", `${k}: ${v}`);
  }
});
test("a marked element holds text only, so translating it never drops a child", () => {
  for (const [f, s] of files(".html"))
    for (const m of s.matchAll(/<(\w+)\b[^>]*\sdata-i18n="[^"]*"[^>]*>([\s\S]*?)<\/\1>/g))
      assert.ok(!/<[a-z]/i.test(m[2]), `${f}: <${m[1]}> with ${m[2].slice(0, 60)}`);
});
test("the kit's words in demo.json: the entry's i18n.<lang> where the kit wrote one, else its English", () => {
  const v = {title: "FreeRDP Web on a macOS host, AV1", caption: "In a browser on a Mac.",
    i18n: {zh: {title: "FreeRDP Web 连接 macOS 主机，AV1", caption: "在 Mac 上的浏览器里。"}, ja: {caption: "Mac のブラウザーで。"}, fr: {title: "  ", caption: 7}}};
  assert.equal(I.kit(v, "title", "zh"), "FreeRDP Web 连接 macOS 主机，AV1");
  assert.equal(I.kit(v, "caption", "zh"), "在 Mac 上的浏览器里。");
  // a field the kit left out (a name that stays English), a blank one or one that isn't text: English
  assert.equal(I.kit(v, "title", "ja"), "FreeRDP Web on a macOS host, AV1");
  assert.equal(I.kit(v, "caption", "ja"), "Mac のブラウザーで。");
  assert.equal(I.kit(v, "title", "fr"), "FreeRDP Web on a macOS host, AV1");
  assert.equal(I.kit(v, "caption", "fr"), "In a browser on a Mac.");
  // English, and an entry from an older kit with no i18n at all
  assert.equal(I.kit(v, "caption", "en"), "In a browser on a Mac.");
  assert.equal(I.kit({title: "older"}, "title", "zh"), "older");
  assert.equal(I.kit(null, "title", "zh"), undefined);
  // without a language given: the page's own
  assert.equal(I.kit(v, "title"), I.kit(v, "title", I.lang));
});
