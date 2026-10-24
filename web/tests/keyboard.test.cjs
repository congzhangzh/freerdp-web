const {test} = require("node:test");
const assert = require("node:assert/strict");
const store = new Map();
globalThis.localStorage = {getItem:k => store.has(k) ? store.get(k) : null, setItem:(k,v) => store.set(k,String(v)), removeItem:k => store.delete(k)};
const K = require("../keyboard.js");
const held = (...codes) => new Set(codes);
test("the recommended hotkeys need Right Alt with Right Shift, so a capital D typed with Right Shift is no hotkey", () => {
  store.clear(); const h = K.getHotkeys();
  assert.deepEqual(h, K.DEFAULT_HOTKEYS);
  assert.deepEqual(K.sdlPrefs(h), {SDL_KeyModMask:["KMOD_RALT","KMOD_RSHIFT"], SDL_Fullscreen:"SDL_SCANCODE_RETURN",
    SDL_Disconnect:"SDL_SCANCODE_D", SDL_Grab:"SDL_SCANCODE_G"});
  assert.equal(K.hotkey(h, {code:"KeyD"}, held("ShiftRight","KeyD")), null);
  assert.equal(K.hotkey(h, {code:"KeyD"}, held("AltRight","ShiftRight","KeyD")), "disconnect");
  assert.equal(K.hotkey(h, {code:"Enter"}, held("AltRight","ShiftRight","Enter")), "fullscreen");
  assert.equal(K.hotkeyText(h, "disconnect"), "Right Alt + Right Shift + D");
});
test("chosen hotkeys are saved and written as FreeRDP's names; Off turns them all off", () => {
  store.clear();
  assert.ok(K.setHotkeys({modifier:"rctrl-rshift", keys:{fullscreen:"F11", disconnect:"End", grab:"KeyG"}}));
  const h = K.getHotkeys();
  assert.deepEqual(K.sdlPrefs(h), {SDL_KeyModMask:["KMOD_RCTRL","KMOD_RSHIFT"], SDL_Fullscreen:"SDL_SCANCODE_F11",
    SDL_Disconnect:"SDL_SCANCODE_END", SDL_Grab:"SDL_SCANCODE_G"});
  assert.equal(K.hotkey(h, {code:"End"}, held("ControlRight","ShiftRight","End")), "disconnect");
  K.setHotkeys({...h, modifier:"off"});
  assert.deepEqual(K.sdlPrefs(K.getHotkeys()).SDL_KeyModMask, ["KMOD_NONE"]);
  assert.equal(K.hotkey(K.getHotkeys(), {code:"End"}, held("ControlRight","ShiftRight","End")), null);
  assert.equal(K.hotkeyText(K.getHotkeys(), "disconnect"), "off");
  assert.deepEqual(K.shortcuts("freerdp"), []);
});
test("two actions never share a key; unknown values fall back to the recommended ones", () => {
  store.clear();
  assert.throws(() => K.setHotkeys({modifier:"rshift", keys:{fullscreen:"KeyD", disconnect:"KeyD", grab:"KeyG"}}), /share a key/);
  store.set(K.HOTKEYS_KEY, JSON.stringify({modifier:"meta", keys:{fullscreen:"KeyQ", disconnect:"KeyQ", grab:"Escape"}}));
  const h = K.getHotkeys();
  assert.equal(h.modifier, "ralt-rshift"); assert.equal(h.keys.fullscreen, "KeyQ");
  assert.equal(new Set(Object.values(h.keys)).size, 3);
  for (const v of Object.values(K.sdlPrefs(h)).flat()) assert.match(v, /^(KMOD|SDL_SCANCODE)_[A-Z0-9]+$/);
  store.set(K.HOTKEYS_KEY, "not json"); assert.deepEqual(K.getHotkeys(), K.DEFAULT_HOTKEYS);
});
test("the mstsc profile lists its own shortcuts and FreeRDP's hotkeys as set", () => {
  store.clear(); const list = K.shortcuts("mstsc").map(([k]) => k);
  assert.ok(list.includes("Ctrl + Alt + End")); assert.ok(list.includes("Right Alt + Right Shift + Enter"));
});
