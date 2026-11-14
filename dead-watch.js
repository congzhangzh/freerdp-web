// A connection that died without closing (a hung ssh tunnel, a network that changed: no FIN, #369)
// is noticed by nobody: a WebSocket has no keepalive, FreeRDP no read watchdog. This watchdog says
// when a server that keeps talking has stopped: app.js reads the samples once a second and closes
// the socket on a "dead" verdict; FreeRDP then reconnects by itself.
//
// Some servers talk when nothing happens (FreeRDP's shadow server asks for a round trip every 2 s,
// shadow_autodetect.c, and streams its sound, silence too, about 20 messages a second; Windows can
// send Heartbeat PDUs); others are silent when idle (xrdp: no heartbeat, no round trip requests; not one message in 180 s
// at rest, test-idle.mjs).
// A dead link brings no message at all, so the rule is: once the server has been heard talking
// with nothing on the screen changing and no input from here (its heartbeat, round trips or
// sound), silence for deadMs, or three times its own pace if that is slower, is a dead connection.
// Graphics and input do not arm it: they answer what happens, and a server that only answers
// (xrdp at rest) must never be cut. Sound does arm it, and that has a cost: xrdp playing sound
// arms it too, and when the sound stops on a still screen the page cannot tell that from a dead
// link: 10 s later it reconnects (FreeRDP's own reconnect, a few seconds). The RDP stream is
// encrypted: a message arriving, and when, is all the page sees of it.
(function (root) {
  "use strict";
  const DEAD_MS = 10000, ARM = 3, KEEP = 8, INPUT_MS = 1500;

  // one watch per socket. tick(sample) once a second, sample: { now, messages (received so far),
  // lastMessage (its time), paints (graphics commands so far, null: unknown), input (the last
  // local input's time) }. Returns null, or
  // { silentMs, paceMs, limitMs } when the connection is dead.
  function create({ deadMs = DEAD_MS, arm = ARM } = {}) {
    let prev = null;
    const quiet = [];   // the seconds the server talked unexplained
    return {
      get armed() { return quiet.length >= arm; },
      get quiet() { return quiet.slice(); },
      tick(s) {
        if (prev && s.messages > prev.messages && s.paints !== null && s.paints === prev.paints
          && s.now - s.input > INPUT_MS) {
          quiet.push(s.now); if (quiet.length > KEEP) quiet.shift();
        }
        prev = s;
        if (quiet.length < arm) return null;
        // its pace: the median gap (a minute of typing in between is one long gap, not its pace)
        const gaps = quiet.slice(1).map((t, i) => t - quiet[i]).sort((a, b) => a - b);
        const paceMs = gaps[gaps.length >> 1], limitMs = Math.max(deadMs, 3 * paceMs), silentMs = s.now - s.lastMessage;
        return silentMs >= limitMs ? { silentMs, paceMs, limitMs } : null;
      },
    };
  }

  const api = { DEAD_MS, create };
  if (typeof module !== "undefined" && module.exports) { module.exports = api; return; }
  root.freerdpDeadWatch = api;
})(typeof window !== "undefined" ? window : globalThis);
