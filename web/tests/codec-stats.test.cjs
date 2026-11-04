const {test} = require("node:test");
const assert = require("node:assert/strict");
const C = require("../codec-stats.js");

// the client's memory as the page sees it: Module.HEAPU8 over the module's buffer, the counters at ptr
function memory(values, ptr = 64) {
  const heap = new Uint8Array(4096), u32 = new Uint32Array(heap.buffer, ptr, C.SLOTS);
  values.forEach((v, i) => { u32[i] = v; });
  return {heap, ptr, u32};
}
const slots = (set = {}) => { const a = new Array(C.SLOTS).fill(0); a[0] = C.LAYOUT; for (const [i, v] of Object.entries(set)) a[+i] = v; return a; };
// slot of a codec's count and bytes
const n = (id) => 2 + id, b = (id) => 18 + id;

test("read: the 37 counters of layout 2, copied from the client's memory", () => {
  const {heap, ptr, u32} = memory(slots({[n(9)]: 5}));
  const a = C.read(heap, ptr);
  assert.equal(a.length, 37); assert.equal(a[0], 2); assert.equal(a[n(9)], 5);
  u32[n(9)] = 6;   // a copy: the client counting on does not change a reading
  assert.equal(a[n(9)], 5);
});
test("read: nothing for another layout, no address, a misaligned one or one past the memory", () => {
  const {heap, ptr} = memory(slots());
  assert.equal(C.read(memory([1, ...slots().slice(1)]).heap, ptr), null);   // layout 1
  assert.equal(C.read(memory([0]).heap, ptr), null);                         // nothing written there
  assert.equal(C.read(heap, 0), null);
  assert.equal(C.read(heap, ptr + 2), null);
  assert.equal(C.read(heap, 4096 - 8), null);
  assert.equal(C.read(undefined, ptr), null);
});
test("describe: a rate and kbit/s per codec the session has seen, from the last reading", () => {
  const prev = slots({[n(1)]: 100, [b(1)]: 1_000_000, [n(9)]: 4, [b(9)]: 4000});
  const now = slots({[n(1)]: 130, [b(1)]: 1_300_000, [n(9)]: 4, [b(9)]: 4000, [n(11)]: 2, [b(11)]: 5000});
  assert.equal(C.describe(now, prev, 1, "4:4:4"),
    "AV1 4:4:4 30/s 2400 kbit/s · Progressive 0/s 0 kbit/s · H.264 4:2:0 (AVC420) 2/s 40 kbit/s");
  // over two seconds: half the rate
  assert.equal(C.describe(now, prev, 2, "4:4:4").split(" · ")[0], "AV1 4:4:4 15/s 1200 kbit/s");
  // the first reading: no rate yet
  assert.equal(C.describe(now, null, 1).split(" · ")[0], "AV1 0/s 0 kbit/s");
  // before any update
  assert.equal(C.describe(slots(), null, 1), "");
});
test("describe: a counter that wrapped past 2^32 still gives the right rate", () => {
  const prev = slots({[n(1)]: 10, [b(1)]: 0xFFFFFF00}), now = slots({[n(1)]: 20, [b(1)]: 0x00000100});
  assert.equal(C.describe(now, prev, 1), "AV1 10/s 4 kbit/s");   // 0x200 bytes = 4.096 kbit
});
test("AV1 or AV2: AV2's own id 2, or id 1 when the server confirmed FRDP_2", () => {
  assert.equal(C.name(2, 0), "AV2");
  assert.equal(C.name(1, C.FRDP_2), "AV2");
  assert.equal(C.name(1, 0x00010000, "4:2:0"), "AV1 4:2:0");   // FRDP_1
  assert.equal(C.name(1, 0), "AV1");
  assert.equal(C.name(14, 0), "H.264 4:4:4 (AVC444)");
  assert.equal(C.name(7, 0), "codec 7");
  assert.match(C.describe(slots({1: C.FRDP_2, [n(1)]: 3}), null, 1), /^AV2 /);
});
test("the paints that carry no codec: SolidFill, SurfaceToSurface, CacheToSurface", () => {
  const prev = slots({34: 1, 36: 10}), now = slots({34: 3, 35: 1, 36: 40});
  assert.equal(C.describe(now, prev, 1), "SolidFill 2/s · SurfaceToSurface 1/s · CacheToSurface 30/s");
});
