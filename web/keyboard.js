// Keyboard shortcut profiles, shared by the client page and keyboard.html. FreeRDP's own
// hotkeys (Right Shift + Enter, + D, ...) are part of the client and always work; the mstsc
// profile adds the shortcuts of Windows' Remote Desktop Connection on top of them.
(function (root) {
  "use strict";
  const KEY = "freerdp-web-keyboard";
  const PROFILES = {
    freerdp: {
      name: "FreeRDP",
      keys: [
        ["Right Shift + Enter", "Full screen on or off"],
        ["Right Shift + D", "Disconnect"],
        ["Right Shift + G", "Keyboard grab on or off"],
      ],
    },
    mstsc: {
      name: "mstsc (Windows Remote Desktop)",
      keys: [
        ["Ctrl + Alt + Break", "Full screen on or off (Ctrl + Alt + Pause on keyboards without Break)"],
        ["Ctrl + Alt + Home", "Show the connection bar"],
        ["Ctrl + Alt + End", "Sends Ctrl + Alt + Delete to the remote desktop"],
        ["Right Shift + Enter, + D, + G", "FreeRDP's hotkeys keep working"],
      ],
    },
  };
  const valid = (p) => (p in PROFILES ? p : "freerdp");
  function get() { try { return valid(localStorage.getItem(KEY)); } catch (e) { return "freerdp"; } }
  function set(p) { try { localStorage.setItem(KEY, valid(p)); return true; } catch (e) { return false; } }
  // The mstsc action for a keydown, or null. Break arrives as code "Pause" (key "Cancel" with Ctrl).
  function action(profile, e) {
    if (valid(profile) !== "mstsc" || !e.ctrlKey || !e.altKey || e.repeat) return null;
    if (e.code === "Pause" || e.key === "Cancel" || e.key === "Pause") return "fullscreen";
    if (e.code === "Home") return "toolbar";
    if (e.code === "End") return "ctrl-alt-del";
    return null;
  }
  const api = { KEY, PROFILES, get, set, action };
  root.FreeRDPKeyboard = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;

  // keyboard.html: the profile chooser and the list of shortcuts
  if (typeof document === "undefined" || !document.getElementById("keyboardProfile")) return;
  const select = document.getElementById("keyboardProfile");
  function render() {
    const p = get();
    select.value = p;
    const list = document.getElementById("keyList");
    list.replaceChildren();
    for (const [keys, what] of PROFILES[p].keys) {
      const row = document.createElement("div"), dt = document.createElement("dt"), dd = document.createElement("dd");
      dt.textContent = keys; dd.textContent = what; row.append(dt, dd); list.append(row);
    }
  }
  select.addEventListener("change", () => {
    document.getElementById("profileStatus").textContent = set(select.value)
      ? "Saved. It applies to the next session." : "This browser does not allow saving it.";
    render();
  });
  document.getElementById("resetProfile").addEventListener("click", () => { set("freerdp"); render();
    document.getElementById("profileStatus").textContent = "Back to FreeRDP, the default."; });
  window.addEventListener("storage", (e) => { if (e.key === KEY || e.key === null) render(); });
  render();
})(globalThis);
