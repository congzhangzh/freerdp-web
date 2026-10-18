// The theme: System (the default), Light or Dark, remembered in this browser. Loaded in the
// head of every page, so the chosen theme applies before the first paint; the header's
// select (id "theme") changes it. A script file, not inline: the installed app forbids those.
(function () {
  "use strict";
  const KEY = "freerdp-web-theme";
  const valid = (t) => (t === "light" || t === "dark" ? t : "system");
  let theme = "system";
  try { theme = valid(localStorage.getItem(KEY)); } catch (e) {}
  const apply = (t) => {
    if (t === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", t);
  };
  apply(theme);
  document.addEventListener("DOMContentLoaded", () => {
    const select = document.getElementById("theme");
    if (!select) return;
    select.value = theme;
    select.addEventListener("change", () => {
      theme = valid(select.value); apply(theme);
      try { localStorage.setItem(KEY, theme); } catch (e) {}
    });
  });
  // another tab changed it
  window.addEventListener("storage", (e) => {
    if (e.key !== KEY) return;
    theme = valid(e.newValue); apply(theme);
    const select = document.getElementById("theme");
    if (select) select.value = theme;
  });
})();
