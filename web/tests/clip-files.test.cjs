const {test} = require("node:test");
const assert = require("node:assert/strict");
const {execFileSync} = require("node:child_process");
const {mkdtempSync, writeFileSync, readFileSync} = require("node:fs");
const {tmpdir} = require("node:os");
const {join} = require("node:path");
const C = require("../clip-files.js");

const big = 5 * 2 ** 32 + 7;
const sample = [
  {path: "report.pdf", size: 1234, dir: false},
  {path: "名前 #1", size: 0, dir: true},
  {path: "名前 #1/空.bin", size: 0, dir: false},
  {path: "名前 #1/big.iso", size: big, dir: false},
];

test("a list: a count, then 592 bytes each, folders marked, \\ between them, sizes past 4 GiB", () => {
  const b = C.buildList(sample);
  assert.equal(b.length, 4 + 4 * 592);
  const v = new DataView(b.buffer);
  assert.equal(v.getUint32(0, true), 4);
  assert.equal(v.getUint32(4 + 592 + 36, true), 0x10);
  assert.equal(v.getUint32(4 + 3 * 592 + 64, true), 5);
  assert.equal(v.getUint32(4 + 3 * 592 + 68, true), 7);
  assert.equal(new TextDecoder("utf-16le").decode(b.subarray(4 + 3 * 592 + 72, 4 + 3 * 592 + 72 + 2 * 12)), "名前 #1\\big.is");
});
test("a list reads back as it was written, with the totals", () => {
  const l = C.parseList(C.buildList(sample));
  assert.deepEqual(l.entries.map((e) => [e.index, e.path, e.size, e.dir]),
    sample.map((e, i) => [i, e.path, e.size, e.dir]));
  assert.equal(l.files, 3); assert.equal(l.size, 1234 + big);
});
test("a name of 260 characters doesn't fit, one of 259 does", () => {
  assert.equal(C.parseList(C.buildList([{path: "a".repeat(259), size: 1}])).entries[0].path.length, 259);
  assert.throws(() => C.buildList([{path: "a".repeat(260), size: 1}]), (e) => e.tooLong === "a".repeat(260));
});
test("a server's list is refused when a name would leave the folder, or it isn't a list", () => {
  for (const bad of ["..\\x", "a\\..\\x", "../x", "\\x", "/x", "a\\\\b", ".", "a\\.\\b", "a\nb"])
    assert.equal(C.parseList(C.buildList([{path: bad, size: 1}])), null, JSON.stringify(bad));
  assert.equal(C.cleanPath("C:\\x"), "C:/x");           // a name, not a drive: the save rejects it
  assert.equal(C.parseList(null), null);
  assert.equal(C.parseList(new Uint8Array(3)), null);
  assert.equal(C.parseList(new Uint8Array(4)), null);                   // no files
  assert.equal(C.parseList(new Uint8Array(4 + 592 - 1).fill(1, 0, 1)), null);   // the wrong length
  const empty = C.buildList([{path: "x", size: 1}]); empty.fill(0, 4 + 72);
  assert.equal(C.parseList(empty), null);
});
test("a size no number here holds exactly is refused", () => {
  const b = C.buildList([{path: "x", size: 1}]);
  new DataView(b.buffer).setUint32(4 + 64, 0xffffffff, true);
  assert.equal(C.parseList(b), null);
});

const file = (name, size) => ({isFile: true, file: (ok) => ok({name, size})});
const folder = (name, pieces) => ({isDirectory: true, name, createReader() {
  let i = 0; return {readEntries: (ok) => ok(pieces[i++] ?? [])};
}});
const item = (entry) => ({kind: "file", webkitGetAsEntry: () => entry});
test("what was dropped: a folder before its files, in pieces, an empty folder too", async () => {
  const got = await C.fromItems([
    item(file("top.txt", 3)), {kind: "string"},
    item(folder("d", [[file("a", 1)], [folder("sub", [[file("b", 2)]]), folder("empty", [])]])),
  ]);
  assert.deepEqual(got.map((e) => [e.path, e.size, e.dir]),
    [["top.txt", 3, false], ["d", 0, true], ["d/a", 1, false], ["d/sub", 0, true], ["d/sub/b", 2, false], ["d/empty", 0, true]]);
});
test("a browser without entries still gives its files, and so does the file chooser", async () => {
  const f = {name: "x", size: 9};
  const got = await C.fromItems([{kind: "file", getAsFile: () => f}]);
  assert.deepEqual(got.map((e) => [e.path, e.dir]), [["x", false]]); assert.equal(got[0].file, f);
  assert.deepEqual(C.fromFiles([f]), [{path: "x", size: 9, dir: false, file: f}]);
});
test("a free name beside what is there", () => {
  const has = (...n) => (x) => n.includes(x);
  assert.equal(C.freeName("a.txt", has()), "a.txt");
  assert.equal(C.freeName("a.txt", has("a.txt")), "a (1).txt");
  assert.equal(C.freeName("a.tar.gz", has("a.tar.gz", "a.tar (1).gz")), "a.tar (2).gz");
  assert.equal(C.freeName("folder", has("folder")), "folder (1)");
  assert.equal(C.freeName(".bashrc", has(".bashrc")), ".bashrc (1)");
});
test("sizes for people", () => {
  assert.equal(C.sizeText(0), "0 B"); assert.equal(C.sizeText(1023), "1023 B");
  assert.equal(C.sizeText(1536), "1.5 KB"); assert.equal(C.sizeText(200 * 2 ** 20), "200 MB");
  assert.equal(C.sizeText(3 * 2 ** 30), "3.0 GB");
});
test("a ZIP that unzip reads: names, folders, contents, in pieces", () => {
  const data = new TextEncoder().encode("hello, world\n");
  assert.equal(C.crc32(C.crc32(0, data.subarray(0, 5)), data.subarray(5)), C.crc32(0, data));
  assert.equal(C.crc32(0, new TextEncoder().encode("123456789")), 0xcbf43926);
  const parts = [], central = [];
  let at = 0;
  const add = (path, bytes, dir) => {
    const e = C.zipEntry(path, C.crc32(0, bytes), bytes.length, at, dir);
    parts.push(e.local, bytes); central.push(e.central); at += e.local.length + bytes.length;
  };
  add("名前/", new Uint8Array(0), false); add("名前/a.txt", data, false); add("d", new Uint8Array(0), true);
  const size = central.reduce((n, c) => n + c.length, 0);
  const zip = Buffer.concat([...parts, ...central, C.zipEnd(central.length, size, at)]);
  const dir = mkdtempSync(join(tmpdir(), "clip-files-"));
  writeFileSync(join(dir, "t.zip"), zip);
  const py = `import zipfile,sys\nz=zipfile.ZipFile(sys.argv[1])\nassert z.testzip() is None\nprint("\\n".join(z.namelist()))\nprint(z.read("名前/a.txt").decode(),end="")`;
  assert.equal(execFileSync("python3", ["-c", py, join(dir, "t.zip")], {encoding: "utf8"}), "名前/\n名前/a.txt\nd/\nhello, world\n");
  assert.ok(readFileSync(join(dir, "t.zip")).length === zip.length);
});
