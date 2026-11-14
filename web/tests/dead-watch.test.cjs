// The dead-connection watchdog (web/dead-watch.js) on traces of real kinds of server.
const test = require("node:test");
const assert = require("node:assert");
const W = require("../dead-watch.js");

// a trace, one sample a second for `seconds`: talk(t) says whether the server sent something in
// second t; drawn(t) whether that was graphics; typed(t) whether the user gave input then.
// Returns the second of the first "dead" verdict, or null.
function run(seconds, { talk, drawn = () => false, typed = () => false }) {
  const w = W.create();
  let messages = 0, lastMessage = 0, paints = 0, input = -1e9;
  for (let t = 1; t <= seconds; t++) {
    const now = t * 1000;
    if (typed(t)) input = now;
    if (talk(t)) { messages++; lastMessage = now; if (drawn(t)) paints++; }
    if (w.tick({ now, messages, lastMessage, paints, input })) return t;
  }
  return null;
}
const every = (n) => (t) => t % n === 0;
const until = (end, f) => (t) => t <= end && f(t);

test("shadow server, idle: a round trip request every 2 s keeps it alive for good", () => {
  assert.strictEqual(run(300, { talk: every(2) }), null);
});

test("shadow server: the connection dies at 60 s, seen dead 10 s after its last message", () => {
  assert.strictEqual(run(120, { talk: until(60, every(2)) }), 70);
});

test("xrdp, idle: it says nothing, and is never cut", () => {
  assert.strictEqual(run(600, { talk: () => false }), null);
});

test("xrdp: a busy minute (graphics and typing), then idle for ten: never cut", () => {
  const busy = (t) => t <= 60;
  assert.strictEqual(run(660, { talk: busy, drawn: busy, typed: busy }), null);
});

test("shadow server, idle with its sound stream (20 messages a second): alive, and dead 10 s after the link dies", () => {
  assert.strictEqual(run(300, { talk: () => true }), null);
  assert.strictEqual(run(200, { talk: (t) => t <= 100 }), 110);
});

test("the cost: xrdp playing sound on a still screen, then the sound stops: cut 10 s later", () => {
  // the page cannot tell this from a dead link (no message either way); FreeRDP then reconnects
  const playing = (t) => t <= 90;
  assert.strictEqual(run(400, { talk: playing }), 100);
});

test("pointer updates answer the mouse: input explains them, never cut", () => {
  const moving = (t) => t <= 40 && t % 3 !== 0;
  assert.strictEqual(run(400, { talk: moving, typed: moving }), null);
});

test("a slow heartbeat (every 30 s): dead only after three of its intervals, not after 10 s", () => {
  const dead = run(400, { talk: until(150, every(30)) });
  assert.strictEqual(dead, 150 + 90);
});

test("typing for a minute between the heartbeats does not stretch the pace", () => {
  // heartbeat every 2 s; seconds 20-80 busy (graphics + input), then the line dies at 100
  const busy = (t) => t >= 20 && t <= 80;
  const dead = run(200, { talk: (t) => t <= 100 && (every(2)(t) || busy(t)), drawn: busy, typed: busy });
  assert.strictEqual(dead, 110);
});

test("a client without the codec counters never arms it", () => {
  const w = W.create();
  let r = null;
  for (let t = 1; t <= 100; t++) r = r || w.tick({ now: t * 1000, messages: t <= 30 ? Math.floor(t / 2) : 15, lastMessage: Math.min(t, 30) * 1000, paints: null, input: -1e9 });
  assert.strictEqual(r, null);
  assert.strictEqual(w.armed, false);
});
