// Trusted Types for Isolated Web Apps.
//
// IWAs enforce `require-trusted-types-for 'script'`, so string URLs passed to
// dangerous sinks are rejected unless a policy approves them. Emscripten starts
// its pthread workers with `new Worker("sdl-freerdp.js")`, which is such a sink,
// so without this the runtime never initialises ("Loading..." forever).
// The browser calls the policy named "default" for every plain string; this one
// only approves our own same-origin worker script and rejects everything else.
"use strict";
if (window.trustedTypes && !trustedTypes.defaultPolicy) {
  trustedTypes.createPolicy("default", {
    createScriptURL(url) {
      const u = new URL(url, location.href);
      if (u.origin === location.origin && u.pathname.endsWith("/sdl-freerdp.js")) return u.href;
      throw new TypeError("Trusted Types: blocked script URL " + url);
    },
  });
}
