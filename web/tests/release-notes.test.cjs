// Every release needs three things in step (docs/hosting.md, step 1): the manifest's version,
// CHANGELOG.md for developers and release-notes.html for users. The notes once fell nine
// versions behind, unnoticed, because nothing compared them.
const test = require("node:test");
const assert = require("node:assert");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const root = join(__dirname, "..", "..");
const read = (...p) => readFileSync(join(root, ...p), "utf8");

const manifest = JSON.parse(read("web", ".well-known", "manifest.webmanifest")).version;
const changelog = [...read("CHANGELOG.md").matchAll(/^## (\d{8}\.\d+)$/gm)].map(m => m[1]);
const notes = [...read("web", "release-notes.html").matchAll(/<h2>(\d{8}\.\d+) /g)].map(m => m[1]);

// the last version from before these notes had an entry for each release
const before = changelog.indexOf("20261021.2");

test("the manifest, the changelog and the notes start with the same version", () => {
  assert.strictEqual(changelog[0], manifest);
  assert.strictEqual(notes[0], manifest);
});

test("every version since 20261021.3 has an entry in the notes", () => {
  assert.ok(before > 0);
  assert.deepStrictEqual(changelog.slice(0, before).filter(v => !notes.includes(v)), []);
});
