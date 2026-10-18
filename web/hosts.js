// The saved hosts: each one a name, an address (a gateway, or with Direct TCP the RDP server
// itself), a user, its session settings and advanced options. Never a password: those stay
// with the browser's password manager or, for a host that asks for it, in the passkey vault
// (vault.js, keyed by the host's id). Kept in localStorage; exported and imported as a file,
// with the vault's passwords only when asked to, encrypted with a passphrase when asked to.
(function (root) {
  "use strict";
  const Options = root.FreeRDPOptions || require("./options.js");
  const Vault = root.FreeRDPVault || require("./vault.js");
  const KEY = "freerdp-web-hosts", OLD_KEY = "freerdp-web-settings";
  const FORMAT = "freerdp-web-hosts", PBKDF2_ITERATIONS = 600000;
  const OLD_DEFAULT_EXTRA = "/gfx:AV1:i444";
  // the gateway's default before 0.4.1; a host still on it moves to the new one (state version 2)
  const OLD_DEFAULT_GATEWAY = "127.0.0.1:6080", DEFAULT_GATEWAY = "127.0.0.1:3390";
  const VERSION = 2;
  const enc = new TextEncoder(), dec = new TextDecoder();
  const b64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
  const unb64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
  const str = (v, d = "") => (typeof v === "string" ? v : d);

  function blank(name = "My server") {
    return { id: crypto.randomUUID(), name, host: DEFAULT_GATEWAY, directHost: "", direct: false, user: "",
      session: { ...Options.DEFAULTS }, extra: "", fullscreen: false, vault: false, vaultSaved: false };
  }
  // a host from storage or a file: known fields only, of the right types; no password
  function clean(h) {
    if (!h || typeof h !== "object") throw new Error("Not a host entry.");
    const extra = str(h.extra);
    Vault.validateOptions(extra);   // credential options never live in Extra options
    return { id: str(h.id) || crypto.randomUUID(), name: str(h.name).trim() || str(h.host) || "Host",
      host: str(h.host), directHost: str(h.directHost), direct: h.direct === true, user: str(h.user),
      session: Options.normalize(h.session), extra, fullscreen: h.fullscreen === true,
      vault: h.vault === true, vaultSaved: h.vaultSaved === true };
  }
  // settings from before the host list become its first host
  function migrate(old) {
    const h = blank();
    if (old && typeof old === "object") {
      h.host = str(old.host, h.host); h.directHost = str(old.directHost); h.user = str(old.user);
      if (h.host === OLD_DEFAULT_GATEWAY) h.host = DEFAULT_GATEWAY;
      h.direct = old.direct === true; h.fullscreen = old.fullscreen === true;
      h.session = Options.normalize(old.session);
      const extra = str(old.extra).trim();
      if (extra === OLD_DEFAULT_EXTRA && !old.session) h.session.codec = "av1-444";
      else { try { Vault.validateOptions(extra); h.extra = extra; } catch (e) { /* dropped */ } }
    }
    return { selected: h.id, hosts: [h] };
  }
  function load(storage) {
    let state = null;
    try { state = JSON.parse(storage.getItem(KEY) || "null"); } catch (e) {}
    if (state && Array.isArray(state.hosts)) {
      const hosts = [];
      for (const h of state.hosts) { try { hosts.push(clean(h)); } catch (e) { /* skip a broken entry */ } }
      if (!(state.version >= 2)) for (const h of hosts) if (h.host === OLD_DEFAULT_GATEWAY) h.host = DEFAULT_GATEWAY;
      if (hosts.length) return { selected: hosts.some((h) => h.id === state.selected) ? state.selected : hosts[0].id, hosts };
    }
    let old = null;
    try { old = JSON.parse(storage.getItem(OLD_KEY) || "null"); } catch (e) {}
    return migrate(old);
  }
  function save(storage, state) {
    try { storage.setItem(KEY, JSON.stringify({ version: VERSION, selected: state.selected, hosts: state.hosts.map(clean) })); return true; }
    catch (e) { return false; }
  }
  // a name not used yet: "Office", "Office 2", ...
  function uniqueName(state, name) {
    const taken = new Set(state.hosts.map((h) => h.name));
    if (!taken.has(name)) return name;
    for (let i = 2; ; i++) if (!taken.has(`${name} ${i}`)) return `${name} ${i}`;
  }

  // ---- export and import
  async function passphraseKey(passphrase, salt) {
    const material = await crypto.subtle.importKey("raw", enc.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations: PBKDF2_ITERATIONS },
      material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  }
  // passwords: a Map of host id -> password, or null; passphrase: a string to encrypt, or ""
  async function exportText(state, { passwords = null, passphrase = "" } = {}) {
    const hosts = state.hosts.map((h) => {
      const { id, vaultSaved, ...rest } = clean(h);
      const pw = passwords?.get(h.id);
      return pw ? { ...rest, password: pw } : rest;
    });
    const plain = { format: FORMAT, version: 1, hosts };
    if (!passphrase) return JSON.stringify(plain, null, 2);
    const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    const data = enc.encode(JSON.stringify(plain));
    try {
      const sealed = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(FORMAT) },
        await passphraseKey(passphrase, salt), data);
      return JSON.stringify({ format: FORMAT, version: 1, encrypted: {
        kdf: "PBKDF2-SHA-256", iterations: PBKDF2_ITERATIONS, salt: b64(salt), iv: b64(iv), ciphertext: b64(sealed) } }, null, 2);
    } finally { data.fill(0); }
  }
  class NeedPassphrase extends Error {}
  // the hosts of a file, each with its password if the file has one; fresh ids
  async function importText(text, passphrase = "") {
    let file;
    try { file = JSON.parse(text); } catch (e) { throw new Error("This is not a hosts file (not JSON)."); }
    if (!file || file.format !== FORMAT || file.version !== 1) throw new Error("This is not a FreeRDP Web hosts file.");
    if (file.encrypted) {
      if (!passphrase) throw new NeedPassphrase("This file is encrypted: enter its passphrase.");
      const e = file.encrypted;
      if (e.kdf !== "PBKDF2-SHA-256" || !(e.iterations >= 100000)) throw new Error("Unknown encryption in this file.");
      let data;
      try {
        const key = await passphraseKey(passphrase, unb64(e.salt));
        data = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(e.iv),
          additionalData: enc.encode(FORMAT) }, key, unb64(e.ciphertext)));
      } catch (err) { throw new Error("Wrong passphrase, or the file is damaged."); }
      try { file = JSON.parse(dec.decode(data)); } finally { data.fill(0); }
    }
    if (!Array.isArray(file.hosts)) throw new Error("This hosts file has no hosts.");
    return file.hosts.map((h) => {
      const host = clean({ ...h, id: "", vaultSaved: false });
      return typeof h.password === "string" && h.password ? { host, password: h.password } : { host, password: "" };
    });
  }

  const api = { KEY, OLD_KEY, FORMAT, blank, clean, migrate, load, save, uniqueName, exportText, importText, NeedPassphrase };
  root.FreeRDPHosts = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
