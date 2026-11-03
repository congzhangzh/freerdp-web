const {test} = require("node:test");
const assert = require("node:assert/strict");
const D = require("../decode-stats.js");

// a stand-in for the browser's VideoDecoder: decode() hands each chunk's picture to output() later
class FakeDecoder {
  constructor(init) { this.init = init; this.queue = []; }
  configure(config) { this.config = config; }
  decode(chunk) { this.queue.push(chunk); }
  reset() { this.queue = []; }
  emit() { const c = this.queue.shift(); if (c) this.init.output({chunk: c}); }
}

test("counts each codec family's chunks, key chunks, bytes, pictures and decode time", () => {
  const stats = {}; let clock = 0;
  const V = D.counting(FakeDecoder, stats, () => clock);
  const seen = [];
  const av1 = new V({output: (f) => seen.push(f), error() {}});
  av1.configure({codec: "av01.1.13M.08"});              // 4:4:4, the macOS and Windows hosts
  av1.decode({type: "key", byteLength: 1000}); clock = 5; av1.emit();
  av1.decode({type: "delta", byteLength: 200}); clock = 8; av1.emit();
  const h264 = new V({output: () => {}, error() {}});
  h264.configure({codec: "avc1.640028"});
  h264.decode({type: "key", byteLength: 50}); clock = 10; h264.emit();
  assert.deepEqual(stats.av01, {chunks: 2, frames: 2, keyFrames: 1, bytes: 1200, decodeMs: 8});
  assert.deepEqual(stats.avc1, {chunks: 1, frames: 1, keyFrames: 1, bytes: 50, decodeMs: 2});
  assert.equal(seen.length, 2, "FreeRDP's own output callback still gets every picture");
});

test("a new decoder of the same family adds to its counts; a reset forgets the chunks in flight", () => {
  const stats = {}; let clock = 0;
  const V = D.counting(FakeDecoder, stats, () => clock);
  const a = new V({output() {}, error() {}}); a.configure({codec: "av01.0.13M.08"});
  a.decode({type: "key", byteLength: 10}); a.reset();        // dropped: no picture, no time
  const b = new V({output() {}, error() {}}); b.configure({codec: "av01.1.13M.08"});
  clock = 100; b.decode({type: "key", byteLength: 10}); clock = 103; b.emit();
  assert.deepEqual(stats.av01, {chunks: 2, frames: 1, keyFrames: 2, bytes: 20, decodeMs: 3});
});

test("a decoder that is never configured counts nothing and still decodes", () => {
  const stats = {};
  const V = D.counting(FakeDecoder, stats);
  const d = new V({output() {}, error() {}});
  d.decode({type: "key", byteLength: 10});
  assert.deepEqual(stats, {});
  assert.equal(d.queue.length, 1);
});
