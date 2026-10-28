// Keyboard shortcut profiles and FreeRDP's own hotkeys, shared by the client page and
// keyboard.html. FreeRDP's hotkeys (a modifier set + Enter, D, G) are part of the client; the
// page picks their modifiers and keys, and app.js writes them to the client's sdl-freerdp.json
// before it starts. The mstsc profile adds the shortcuts of Windows' Remote Desktop Connection
// on top of them.
(function (root) {
  "use strict";
  const KEY = "freerdp-web-keyboard", HOTKEYS_KEY = "freerdp-web-hotkeys";
  // the names in the visitor's language (i18n.js, "i18n" below); English without it (node's tests)
  const t = (key, text, vars) => root.FreeRDPi18n?.t(key, text, vars) ?? text;
  // FreeRDP's mask needs every modifier in it held, on that side. Right Shift alone is FreeRDP's
  // default, and typing a capital D with the right hand then disconnects. Right Alt is on every
  // keyboard (Right Option on a Mac; MacBooks have no Right Ctrl), so it joins Right Shift by default.
  const MODIFIERS = {
    "ralt-rshift": { name: "Right Alt + Right Shift", i18n: "kb.modRaltRshift", sdl: ["KMOD_RALT", "KMOD_RSHIFT"], codes: ["AltRight", "ShiftRight"] },
    "rctrl-rshift": { name: "Right Ctrl + Right Shift", i18n: "kb.modRctrlRshift", sdl: ["KMOD_RCTRL", "KMOD_RSHIFT"], codes: ["ControlRight", "ShiftRight"] },
    "rshift": { name: "Right Shift (FreeRDP's own default)", i18n: "kb.modRshift", sdl: ["KMOD_RSHIFT"], codes: ["ShiftRight"] },
    "off": { name: "Off: no hotkeys", i18n: "kb.modOff", sdl: ["KMOD_NONE"], codes: null },
  };
  const ACTIONS = {
    fullscreen: { name: "Full screen on or off", i18n: "kb.actFullscreen", pref: "SDL_Fullscreen", key: "Enter" },
    disconnect: { name: "Disconnect", i18n: "tb.quit", pref: "SDL_Disconnect", key: "KeyD" },
    grab: { name: "Keyboard grab on or off", i18n: "kb.actGrab", pref: "SDL_Grab", key: "KeyG" },
  };
  // the keys a hotkey can use: KeyboardEvent.code -> [label, FreeRDP's SDL scancode name]
  const KEYS = {};
  for (const c of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") KEYS["Key" + c] = [c, "SDL_SCANCODE_" + c];
  for (const c of "0123456789") KEYS["Digit" + c] = [c, "SDL_SCANCODE_" + c];
  for (let n = 1; n <= 12; n++) KEYS["F" + n] = ["F" + n, "SDL_SCANCODE_F" + n];
  for (const [code, label, sdl] of [["Enter", "Enter", "RETURN"], ["Space", "Space", "SPACE"], ["Backspace", "Backspace", "BACKSPACE"],
    ["Delete", "Delete", "DELETE"], ["Insert", "Insert", "INSERT"], ["Home", "Home", "HOME"], ["End", "End", "END"],
    ["PageUp", "Page Up", "PAGEUP"], ["PageDown", "Page Down", "PAGEDOWN"], ["Pause", "Pause", "PAUSE"]])
    KEYS[code] = [label, "SDL_SCANCODE_" + sdl];
  const DEFAULT_HOTKEYS = { modifier: "ralt-rshift", keys: Object.fromEntries(Object.entries(ACTIONS).map(([a, v]) => [a, v.key])) };

  const valid = (p) => (p in PROFILES ? p : "freerdp");
  function get() { try { return valid(localStorage.getItem(KEY)); } catch (e) { return "freerdp"; } }
  function set(p) { try { localStorage.setItem(KEY, valid(p)); return true; } catch (e) { return false; } }
  // a stored value, or the defaults for anything missing or not allowed; two actions never share a key
  function cleanHotkeys(h) {
    const out = { modifier: h?.modifier in MODIFIERS ? h.modifier : DEFAULT_HOTKEYS.modifier, keys: {} };
    for (const a in ACTIONS) {
      const k = h?.keys?.[a];
      out.keys[a] = k in KEYS && !Object.values(out.keys).includes(k) ? k : DEFAULT_HOTKEYS.keys[a];
    }
    if (new Set(Object.values(out.keys)).size !== Object.keys(ACTIONS).length) out.keys = { ...DEFAULT_HOTKEYS.keys };
    return out;
  }
  function getHotkeys() { try { return cleanHotkeys(JSON.parse(localStorage.getItem(HOTKEYS_KEY))); } catch (e) { return cleanHotkeys(null); } }
  function setHotkeys(h) {
    const keys = Object.values(h?.keys || {});
    if (new Set(keys).size !== keys.length) throw new Error("Two actions cannot share a key.");
    try { localStorage.setItem(HOTKEYS_KEY, JSON.stringify(cleanHotkeys(h))); return true; } catch (e) { return false; }
  }
  // the client's sdl-freerdp.json (FreeRDP's SdlPref): an unknown key name would fall back to
  // FreeRDP's default, so only names from KEYS are written
  function sdlPrefs(h = getHotkeys()) {
    const prefs = { SDL_KeyModMask: MODIFIERS[h.modifier].sdl };
    for (const a in ACTIONS) prefs[ACTIONS[a].pref] = KEYS[h.keys[a]][1];
    return prefs;
  }
  // the action whose hotkey this keydown completes, or null; held: the codes down right now
  function hotkey(h, e, held) {
    const codes = MODIFIERS[h.modifier].codes;
    if (!codes || !codes.every((c) => held.has(c))) return null;
    return Object.keys(ACTIONS).find((a) => h.keys[a] === e.code) || null;
  }
  const named = (v) => t(v.i18n, v.name);
  const hotkeyText = (h, a) => MODIFIERS[h.modifier].codes
    ? named(MODIFIERS[h.modifier]).replace(/ \(.*\)$|（.*）$/, "") + " + " + KEYS[h.keys[a]][0] : t("kb.off", "off");
  const PROFILES = {
    freerdp: { name: "FreeRDP" },
    mstsc: {
      name: "mstsc (Windows Remote Desktop)",
      keys: [
        ["Ctrl + Alt + Break", { name: "Full screen on or off (Ctrl + Alt + Pause on keyboards without Break)", i18n: "kb.mstscFullscreen" }],
        ["Ctrl + Alt + Home", { name: "Show the connection bar", i18n: "kb.mstscBar" }],
        ["Ctrl + Alt + End", { name: "Sends Ctrl + Alt + Delete to the remote desktop", i18n: "kb.mstscCad" }],
      ],
    },
  };
  // the shortcuts of a profile: FreeRDP's hotkeys as set, and the profile's own
  function shortcuts(p, h = getHotkeys()) {
    const own = MODIFIERS[h.modifier].codes ? Object.keys(ACTIONS).map((a) => [hotkeyText(h, a), named(ACTIONS[a])]) : [];
    return [...(PROFILES[valid(p)].keys || []).map(([keys, what]) => [keys, named(what)]), ...own];
  }
  // The mstsc action for a keydown, or null. Break arrives as code "Pause" (key "Cancel" with Ctrl).
  function action(profile, e) {
    if (valid(profile) !== "mstsc" || !e.ctrlKey || !e.altKey || e.repeat) return null;
    if (e.code === "Pause" || e.key === "Cancel" || e.key === "Pause") return "fullscreen";
    if (e.code === "Home") return "toolbar";
    if (e.code === "End") return "ctrl-alt-del";
    return null;
  }
  const api = { KEY, HOTKEYS_KEY, PROFILES, MODIFIERS, ACTIONS, KEYS, DEFAULT_HOTKEYS, get, set,
    getHotkeys, setHotkeys, cleanHotkeys, sdlPrefs, hotkey, hotkeyText, shortcuts, action };
  root.FreeRDPKeyboard = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;

  // keyboard.html: the profile chooser, FreeRDP's hotkeys and the list of shortcuts
  if (typeof document === "undefined" || !document.getElementById("keyboardProfile")) return;
  const $ = (id) => document.getElementById(id);
  const select = $("keyboardProfile");
  const option = (value, text) => Object.assign(document.createElement("option"), { value, textContent: text });
  for (const [m, v] of Object.entries(MODIFIERS)) $("hotkeyModifier").append(option(m, named(v)));
  for (const a in ACTIONS) {
    const label = document.createElement("label"), span = document.createElement("span"), keys = document.createElement("select");
    label.className = "field"; span.textContent = named(ACTIONS[a]); span.dataset.action = a; keys.id = "hotkey-" + a;
    for (const [code, [text]] of Object.entries(KEYS)) keys.append(option(code, text));
    label.append(span, keys); $("hotkeyKeys").append(label);
  }
  function render() {
    const p = get(), h = getHotkeys();
    select.value = p;
    $("hotkeyModifier").value = h.modifier;
    for (const a in ACTIONS) { $("hotkey-" + a).value = h.keys[a]; $("hotkey-" + a).disabled = !MODIFIERS[h.modifier].codes; }
    const list = $("keyList");
    list.replaceChildren();
    for (const [keys, what] of shortcuts(p, h)) {
      const row = document.createElement("div"), dt = document.createElement("dt"), dd = document.createElement("dd");
      dt.textContent = keys; dd.textContent = what; row.append(dt, dd); list.append(row);
    }
  }
  const saved = (ok) => ok ? t("kb.saved", "Saved. It applies to the next session.") : t("kb.notSaved", "This browser does not allow saving it.");
  select.addEventListener("change", () => { $("profileStatus").textContent = saved(set(select.value)); render(); });
  function changeHotkeys() {
    const h = { modifier: $("hotkeyModifier").value, keys: {} };
    for (const a in ACTIONS) h.keys[a] = $("hotkey-" + a).value;
    try { $("hotkeyStatus").textContent = saved(setHotkeys(h)); }
    catch (e) { $("hotkeyStatus").textContent = /share a key/.test(e.message) ? t("kb.shareKey", e.message) : e.message; }
    render();
  }
  $("hotkeyModifier").addEventListener("change", changeHotkeys);
  $("hotkeyKeys").addEventListener("change", changeHotkeys);
  $("resetProfile").addEventListener("click", () => { set("freerdp"); render();
    $("profileStatus").textContent = t("kb.backProfile", "Back to FreeRDP, the default."); });
  $("resetHotkeys").addEventListener("click", () => { setHotkeys(DEFAULT_HOTKEYS); render();
    $("hotkeyStatus").textContent = t("kb.backHotkeys", "Back to the recommended hotkeys."); });
  window.addEventListener("storage", (e) => { if (e.key === KEY || e.key === HOTKEYS_KEY || e.key === null) render(); });
  // a new language: the names built here, then the list (the status lines keep theirs)
  root.FreeRDPi18n?.onChange(() => {
    for (const o of $("hotkeyModifier").options) o.textContent = named(MODIFIERS[o.value]);
    for (const span of $("hotkeyKeys").querySelectorAll("span[data-action]")) span.textContent = named(ACTIONS[span.dataset.action]);
    render();
  });
  render();
})(globalThis);
