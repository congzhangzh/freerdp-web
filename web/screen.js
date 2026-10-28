// One more screen of the session (the toolbar's "All screens", app.js): this window shows its
// screen's part of the remote desktop, copied from the page's canvas whenever its capture stream
// says SDL drew a new frame (app.js, "All screens", has why), and hands the
// mouse and the keys back to the page, which gives them to SDL as if they had happened on its
// canvas there. It closes itself when the page no longer shows the desktop on this screen.
"use strict";
(() => {
  const n = Number(location.hash.slice(1));
  const view = document.getElementById("view"), g = view.getContext("2d", { alpha: false });
  const vcursor = document.getElementById("vcursor");
  const page = () => { try { return window.opener?.freerdpScreens ?? null; } catch (e) { return null; } };
  const video = document.createElement("video");
  video.muted = true; video.playsInline = true;
  let area = null, cursor = "", entered = false, stream = null, fresh = false, drawn = "";
  const onFrame = () => { fresh = true; video.requestVideoFrameCallback(onFrame); };
  const perFrame = "requestVideoFrameCallback" in video;
  function frame() {
    const v = page()?.view(n);
    if (!v) { window.close(); return; }
    document.title = "FreeRDP Web: " + v.label;
    if (v.stream !== stream) {
      stream = video.srcObject = v.stream;
      video.play().catch(() => {});
      if (perFrame) video.requestVideoFrameCallback(onFrame);
    }
    const dpr = window.devicePixelRatio || 1, w = Math.round(innerWidth * dpr), h = Math.round(innerHeight * dpr);
    if (view.width !== w || view.height !== h) { view.width = w; view.height = h; }
    // drawn on a new frame of the stream, or when the size or the part changed
    const what = [w, h, v.sx, v.sy, v.sw, v.sh].join(), src = v.readable ? v.canvas : video.readyState >= 2 ? video : null;
    if (src && v.sw > 0 && v.sh > 0 && (fresh || what !== drawn || !perFrame)) {
      const a = FreeRDPScreens.fit(v.sw, v.sh, w, h);
      g.drawImage(src, v.sx, v.sy, v.sw, v.sh, a.x, a.y, a.w, a.h);
      area = { x: a.x / dpr, y: a.y / dpr, w: a.w / dpr, h: a.h / dpr };   // CSS pixels, as the mouse
      fresh = false; drawn = what;
    }
    if (v.cursor !== cursor) view.style.cursor = cursor = v.cursor;   // the remote pointer's image
    // under the page's capture the mouse belongs to the page, which draws the cursor itself:
    // here too, while it is on this screen
    const l = v.locked, inside = l && area && l.x >= v.sx && l.x < v.sx + v.sw && l.y >= v.sy && l.y < v.sy + v.sh;
    if (inside) {
      if (vcursor.getAttribute("src") !== l.src) vcursor.src = l.src;
      vcursor.style.transform = `translate(${area.x + (l.x - v.sx) * area.w / v.sw - l.hotX}px, ${area.y + (l.y - v.sy) * area.h / v.sh - l.hotY}px)`;
    }
    vcursor.hidden = !inside;
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // The first click fills the screen (browsers allow full screen only from a click or a key);
  // it does not reach the remote side. In full screen Keyboard Lock sends Esc and the Windows key
  // there too; holding Esc leaves.
  const hint = document.getElementById("hint");
  const t = (key, text, vars) => globalThis.FreeRDPi18n?.t(key, text, vars) ?? text;   // i18n.js
  async function fill() {
    try { await document.documentElement.requestFullscreen({ navigationUI: "hide" }); }
    catch (e) { hint.textContent = t("screen.refused", "Full screen refused: " + e.message, { why: e.message }); return; }
    try { await navigator.keyboard?.lock?.(); } catch (e) { /* the keys the browser keeps stay local */ }
  }
  document.addEventListener("fullscreenchange", () => { hint.hidden = !!document.fullscreenElement; });
  const mods = (e) => ({ ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: e.altKey, metaKey: e.metaKey });
  const at = (e) => FreeRDPScreens.fraction(e.clientX, e.clientY, area);
  const swallowed = new Set();   // the buttons whose press went full screen: their release too
  for (const type of ["mousemove", "mousedown", "mouseup"])
    view.addEventListener(type, (e) => {
      e.preventDefault();
      if (!area) return;
      if (type === "mousedown" && !document.fullscreenElement) { swallowed.add(e.button); fill(); return; }
      if (type === "mouseup" && swallowed.delete(e.button)) return;
      // SDL takes the mouse as having entered the canvas at the first move of each visit
      if (!entered) { entered = true; page()?.input(n, "mouseenter", { ...at(e), buttons: e.buttons }); }
      page()?.input(n, type, { ...at(e), button: e.button, buttons: e.buttons, ...mods(e) });
    });
  view.addEventListener("mouseleave", () => { entered = false; });
  view.addEventListener("wheel", (e) => {
    e.preventDefault();
    if (area) page()?.input(n, "wheel", { ...at(e), deltaX: e.deltaX, deltaY: e.deltaY, deltaMode: e.deltaMode, ...mods(e) });
  }, { passive: false });
  view.addEventListener("contextmenu", (e) => e.preventDefault());
  for (const type of ["keydown", "keyup"])
    window.addEventListener(type, (e) => {
      e.preventDefault();
      page()?.input(n, type, { key: e.key, code: e.code, location: e.location, repeat: e.repeat, ...mods(e) });
    });
  // the page's window lost the focus to this one: SDL would stop taking keys
  window.addEventListener("focus", () => page()?.focus(n));
})();
