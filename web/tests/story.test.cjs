// The story has one article per language (web/story.html), written by hand, so nothing but this
// test stops a chapter from being added to one language and forgotten in the others. The list of
// pages that link to it is here too: the header is copied into each page.
const test = require("node:test");
const assert = require("node:assert");
const { readFileSync, readdirSync } = require("node:fs");
const { join } = require("node:path");

const web = join(__dirname, "..");
const read = (f) => readFileSync(join(web, f), "utf8");
const story = read("story.html");
const articles = [...story.matchAll(/<article\b([^>]*)>([\s\S]*?)<\/article>/g)]
  .map(([, attrs, body]) => ({ attrs, body, lang: attrs.match(/data-i18n-only="([^"]*)"/)?.[1] }));
const count = (s, re) => (s.match(re) || []).length;

test("one article for each language, and only English shows before i18n.js runs", () => {
  assert.deepStrictEqual(articles.map(a => a.lang), ["en", "zh", "ja", "fr"]);
  assert.deepStrictEqual(articles.map(a => a.attrs.match(/\blang="([^"]*)"/)[1]), ["en", "zh-Hans", "ja", "fr"]);
  assert.deepStrictEqual(articles.map(a => /\bhidden\b/.test(a.attrs)), [false, true, true, true]);
});

test("the four have the same shape: chapters, paragraphs, list items, links", () => {
  const shape = a => ({ h1: count(a.body, /<h1>/g), h2: count(a.body, /<h2>/g), p: count(a.body, /<p\b/g),
    li: count(a.body, /<li\b/g), a: count(a.body, /<a /g) });
  const en = shape(articles[0]);
  assert.ok(en.h2 >= 9, `${en.h2} chapters`);
  for (const a of articles) assert.deepStrictEqual(shape(a), en, a.lang);
});

test("every link goes to the same place in every language", () => {
  const links = a => [...a.body.matchAll(/<a href="([^"]*)"/g)].map(m => m[1]);
  assert.ok(links(articles[0]).length >= 8);
  for (const a of articles) assert.deepStrictEqual(links(a), links(articles[0]), a.lang);
});

test("each language has one replaceable What is still open, as the last chapter", () => {
  for (const a of articles) {
    assert.strictEqual(count(a.body, /<section class="story-open">/g), 1, a.lang);
    const open = a.body.indexOf('<section class="story-open">');
    assert.strictEqual(count(a.body.slice(open), /<h2>/g), 1, a.lang);
  }
});

test("the numbers are the same in every language", () => {
  const figures = s => [...s.replace(/<[^>]*>/g, "").matchAll(/\d+(?:[.,]\d+)?/g)].map(m => m[0].replace(",", "."));
  const facts = ["2022", "2023", "2017", "22", "2.34", "2.85", "1.86", "12", "28", "16", "80"];
  for (const a of articles) {
    const have = figures(a.body);
    for (const f of facts) assert.ok(have.includes(f), `${a.lang}: ${f}`);
  }
});

test("the slogan is the page's own in every language", () => {
  const I = require("../i18n.js");
  const line = { zh: I.ZH, ja: I.JA, fr: I.FR };
  for (const a of articles.slice(1))
    assert.ok(a.body.includes(`<em>${line[a.lang]["mascot.here"]}`.replace(/\s$/, "")) && a.body.includes(`${line[a.lang]["mascot.one"]}</em>`), a.lang);
  assert.ok(articles[0].body.includes(`<em>${I.ZH["mascot.alt"]}</em>`));
  for (const a of articles) assert.ok(a.body.includes("蛮蛮"), a.lang);
});

test("every page with the header links to the story, right after the release notes", () => {
  const pages = readdirSync(web).filter(f => f.endsWith(".html") && /<nav\b/.test(read(f)));
  assert.ok(pages.length >= 8, pages.join());
  for (const f of pages)
    assert.match(read(f), /<a href="release-notes\.html"[^>]*>Release notes<\/a>\s*<a href="story\.html"[^>]*data-i18n="nav\.story">Story<\/a>/, f);
  assert.match(story, /<a href="story\.html" aria-current="page"/);
});
