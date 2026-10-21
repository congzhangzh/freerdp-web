// The splash: on a first visit, the demo videos (a minute or so each) before the client, with
// Skip; the header's "Demo" shows it again. Only where the site has them: the Pages build puts
// the videos and demo/demo.json next to the page (see media.json); without them nothing shows.
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const KEY = "freerdp-web-splash";
  let videos = [], current = 0, opener = null;
  function choose(i) {
    current = i;
    const v = videos[i], video = $("splashVideo");
    document.querySelectorAll("#splashTabs [role=tab]").forEach((t, j) => t.setAttribute("aria-selected", String(j === i)));
    video.poster = v.poster; video.src = v.src;
    $("splashCaption").textContent = v.caption;
    // muted: browsers only start a video with sound after a click; its speaker button unmutes
    video.muted = true;
    if (!matchMedia("(prefers-reduced-motion: reduce)").matches) video.play().catch(() => {});
  }
  function open() {
    opener = document.activeElement;
    $("splash").hidden = false;
    choose(current);
    $("splashSkip").focus();
  }
  function close() {
    const video = $("splashVideo");
    video.pause(); video.removeAttribute("src"); video.load();   // stop downloading
    $("splash").hidden = true;
    try { localStorage.setItem(KEY, "seen"); } catch (e) {}
    (opener && opener.focus ? opener : $("user")).focus();
  }
  $("splashSkip").onclick = close;
  $("splashStart").onclick = close;
  $("splash").addEventListener("click", (e) => { if (e.target === $("splash")) close(); });
  $("splash").addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); close(); } });
  $("demoOpen").onclick = open;
  // connecting closes it (the remote desktop takes the window)
  $("connectForm").addEventListener("submit", () => { if (!$("splash").hidden) close(); });
  fetch("demo/demo.json").then((r) => (r.ok ? r.json() : null)).then((d) => {
    if (!d || !Array.isArray(d.videos) || !d.videos.length) return;
    videos = d.videos;
    const tabs = $("splashTabs");
    tabs.replaceChildren(...videos.map((v, i) => {
      const b = document.createElement("button");
      b.type = "button"; b.setAttribute("role", "tab"); b.textContent = v.title;
      b.onclick = () => choose(i);
      return b;
    }));
    $("demoOpen").hidden = false;
    let seen = false;
    try { seen = localStorage.getItem(KEY) === "seen"; } catch (e) {}
    // index.html#intro (the help pages' ▶ Intro) opens it as well
    const asked = location.hash === "#intro";
    if (asked) history.replaceState(null, "", location.pathname + location.search);
    if (asked || (!seen && !new URLSearchParams(location.search).has("autoconnect"))) open();
  }).catch(() => {});
})();
