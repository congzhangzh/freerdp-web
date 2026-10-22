// The splash: on a first visit, the demo videos (a minute or so each) before the client, with
// Skip; the header's "Demo" shows it again. Only where the site has them: the Pages build puts
// the videos and demo/demo.json next to the page (see media.json); without them nothing shows.
//
// Each demo has an address to share: index.html#intro opens the first, index.html#<id> that
// one, where <id> is the video's file name without its extension (demo-xrdp-kde.mp4 →
// #demo-xrdp-kde) unless demo.json gives an "id". While the splash is open the address bar
// follows the tab; closing it drops the anchor, so a reload gives the client.
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const KEY = "freerdp-web-splash", SOUND_KEY = "freerdp-web-splash-sound";
  let videos = [], current = 0, opener = null;
  // the demos' sound is part of the show: on, unless the viewer turned it off once
  let wantSound = true;
  try { wantSound = localStorage.getItem(SOUND_KEY) !== "off"; } catch (e) {}
  let expectMuted = null;   // what this script last set, to tell the viewer's own changes apart
  const idOf = (v) => v.id || v.src.replace(/^.*\//, "").replace(/\.[^.]*$/, "");
  const indexOf = (hash) => {
    const id = decodeURIComponent(hash.replace(/^#/, ""));
    return id === "intro" ? 0 : videos.findIndex((v) => idOf(v) === id);
  };
  const setHash = (hash) => history.replaceState(history.state, "", location.pathname + location.search + hash);
  function setMuted(muted) {
    const video = $("splashVideo");
    expectMuted = muted; video.muted = muted;
    // the browser kept the sound off (no click yet on this site): the button turns it on
    $("splashSound").hidden = !(muted && wantSound);
  }
  function play() {
    const video = $("splashVideo");
    setMuted(!wantSound);
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    video.play().catch((e) => {
      // browsers start a video with sound only after a click on the site; until then, muted
      if (e.name !== "NotAllowedError" || video.muted) return;
      setMuted(true);
      video.play().catch(() => {});
    });
  }
  function choose(i) {
    current = i;
    const v = videos[i], video = $("splashVideo");
    document.querySelectorAll("#splashTabs [role=tab]").forEach((t, j) => t.setAttribute("aria-selected", String(j === i)));
    video.poster = v.poster; video.src = v.src;
    $("splashCaption").textContent = v.caption;
    setHash("#" + idOf(v));
    play();
  }
  function open(i = current) {
    if ($("splash").hidden) opener = document.activeElement;
    $("splash").hidden = false;
    choose(i);
    $("splashSkip").focus();
  }
  function close() {
    const video = $("splashVideo");
    video.pause(); video.removeAttribute("src"); video.load();   // stop downloading
    $("splash").hidden = true;
    setHash("");
    try { localStorage.setItem(KEY, "seen"); } catch (e) {}
    (opener && opener.focus ? opener : $("user")).focus();
  }
  function soundOn() {
    wantSound = true;
    setMuted(false);
    $("splashVideo").play().catch(() => {});
  }
  $("splashSkip").onclick = close;
  $("splashStart").onclick = close;
  $("splashSound").onclick = soundOn;
  // the first click or key in the splash is the gesture the browser waited for (not one on the
  // video: its own speaker button would turn the sound straight off again)
  for (const type of ["pointerdown", "keydown"]) {
    $("splash").addEventListener(type, (e) => {
      if (e.target !== $("splashVideo") && wantSound && $("splashVideo").muted && !$("splash").hidden) soundOn();
    });
  }
  // the video's own speaker button: the viewer's choice, kept for the next visit
  $("splashVideo").addEventListener("volumechange", () => {
    const muted = $("splashVideo").muted;
    if (muted === expectMuted) return;
    expectMuted = muted; wantSound = !muted;
    $("splashSound").hidden = true;
    try { localStorage.setItem(SOUND_KEY, muted ? "off" : "on"); } catch (e) {}
  });
  $("splash").addEventListener("click", (e) => { if (e.target === $("splash")) close(); });
  $("splash").addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); close(); } });
  $("demoOpen").onclick = () => open();
  // connecting closes it (the remote desktop takes the window)
  $("connectForm").addEventListener("submit", () => { if (!$("splash").hidden) close(); });
  // a demo's address typed or followed while the page is open
  addEventListener("hashchange", () => { const i = indexOf(location.hash); if (videos.length && i >= 0) open(i); });
  fetch("demo/demo.json").then((r) => (r.ok ? r.json() : null)).then((d) => {
    if (!d || !Array.isArray(d.videos) || !d.videos.length) return;
    videos = d.videos;
    const tabs = $("splashTabs");
    // links, so a demo's address can be copied or opened in a new tab; a plain click stays here
    tabs.replaceChildren(...videos.map((v, i) => {
      const a = document.createElement("a");
      a.className = "button"; a.href = "#" + idOf(v); a.setAttribute("role", "tab"); a.textContent = v.title;
      a.onclick = (e) => {
        if (e.button || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
        e.preventDefault(); choose(i);
      };
      return a;
    }));
    $("demoOpen").hidden = false;
    let seen = false;
    try { seen = localStorage.getItem(KEY) === "seen"; } catch (e) {}
    // index.html#intro (the help pages' ▶ Intro) or a demo's address opens it as well
    const asked = indexOf(location.hash);
    if (asked >= 0) open(asked);
    else if (!seen && !new URLSearchParams(location.search).has("autoconnect")) open(0);
  }).catch(() => {});
})();
