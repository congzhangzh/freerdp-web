// WebAuthn releases a local encryption key; this is not a server login verifier.
(function (root) {
  "use strict";
  const enc = new TextEncoder(), dec = new TextDecoder();
  const random = n => crypto.getRandomValues(new Uint8Array(n));
  const encode = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes)));
  const decode = value => Uint8Array.from(atob(value), c => c.charCodeAt(0));
  const aborted = () => new DOMException("Vault operation cancelled or locked.", "AbortError");
  const aad = purpose => enc.encode("freerdp-vault:v1:" + purpose);
  async function wrappingKey(prf, salt) {
    const material = await crypto.subtle.importKey("raw", prf, "HKDF", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({name:"HKDF", hash:"SHA-256", salt,
      info:aad("wrap")}, material, {name:"AES-GCM", length:256}, false, ["encrypt", "decrypt"]);
  }
  async function seal(key, bytes, purpose) {
    const iv = random(12);
    return {iv:encode(iv), ciphertext:encode(await crypto.subtle.encrypt(
      {name:"AES-GCM", iv, additionalData:aad(purpose)}, key, bytes))};
  }
  async function open(key, box, purpose) {
    return new Uint8Array(await crypto.subtle.decrypt({name:"AES-GCM", iv:decode(box.iv),
      additionalData:aad(purpose)}, key, decode(box.ciphertext)));
  }
  async function evaluate(credentials, id, salt, signal) {
    const assertion = await credentials.get({signal, publicKey:{challenge:random(32),
      allowCredentials:[{type:"public-key", id:decode(id)}], userVerification:"required",
      timeout:60000, extensions:{prf:{eval:{first:salt}}}}});
    if (!assertion || encode(assertion.rawId) !== id) throw new Error("A different passkey was returned.");
    const flags = new Uint8Array(assertion.response.authenticatorData);
    if (flags.length < 37 || !(flags[32] & 4)) throw new Error("User verification was not confirmed.");
    const output = assertion.getClientExtensionResults().prf?.results?.first;
    if (!output || output.byteLength !== 32) throw new Error("This browser or passkey does not support PRF. No password was saved.");
    return new Uint8Array(output);
  }
  function validateOptions(extra) {
    if (typeof extra !== "string" || extra.split(/\s+/).some(arg =>
      /^[/+-](?:v|u|p|d|password|from-stdin|args-from|password-is-pin|gateway|g|gu|gp|gd|gat|pth|pass-the-hash|proxy|endpointfedauth|assistance|smartcard-logon|reconnect-cookie|print-reconnect-cookie|tls-secrets-file)(?::|$)/i.test(arg) || /^[/+-]tls:.*secrets/i.test(arg)))
      throw new Error("Use the host, user and password fields. Credential and secret-export options are not supported in Extra options.");
    return extra;
  }
  function validateHost(value) {
    if (!value || typeof value.host !== "string" || !value.host.trim() ||
        typeof value.username !== "string" || typeof value.password !== "string" ||
        typeof value.extra !== "string" || typeof value.direct !== "boolean") throw new Error("Invalid host entry.");
    // Connection identity belongs to these fields, never to free-form options.
    validateOptions(value.extra);
    return {id:value.id || crypto.randomUUID(), label:String(value.label || value.host).trim(),
      host:value.host.trim(), username:value.username, password:value.password,
      extra:value.extra, direct:value.direct};
  }
  function validatePayload(payload) {
    if (!payload || !Array.isArray(payload.hosts)) throw new Error("Invalid vault contents.");
    const hosts = payload.hosts.map(validateHost);
    if (new Set(hosts.map(h => h.id)).size !== hosts.length) throw new Error("Duplicate host identifiers.");
    return {hosts};
  }
  function vaultStore() {
    let database;
    const db = () => database ??= new Promise((resolve, reject) => {
      const request = indexedDB.open("freerdp-credential-vault", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("vault");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return async (operation, value, expectedRevision) => {
      const database = await db();
      return new Promise((resolve, reject) => {
        const tx = database.transaction("vault", operation === "get" ? "readonly" : "readwrite");
        const store = tx.objectStore("vault"), request = store.get("default");
        let result, conflict = false;
        request.onsuccess = () => {
          result = request.result;
          if (operation === "get") return;
          // Atomic compare-and-swap: another tab must not silently lose its edits.
          if ((result?.revision ?? null) !== expectedRevision) { conflict = true; tx.abort(); return; }
          store.put(value, "default");
        };
        tx.oncomplete = () => resolve(operation === "get" ? result : undefined);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(conflict ? new Error("Vault changed in another tab. Lock and unlock to reload it.") : tx.error || aborted());
      });
    };
  }
  class Vault {
    #key = null; #payload = null; #record = null; #epoch = 0; #busy = false; #controller = null;
    constructor(store = vaultStore(), credentials = navigator.credentials) { this.store = store; this.credentials = credentials; }
    get unlocked() { return !!this.#key; }
    get busy() { return this.#busy; }
    async exists() { return !!(await this.store("get")); }
    lock() {
      this.#epoch++; this.#controller?.abort(); this.#key = null;
      // Strings cannot be reliably overwritten in JavaScript; drop all retained references.
      if (this.#payload) for (const h of this.#payload.hosts) h.password = "";
      this.#payload = this.#record = null;
    }
    async #operation(action) {
      if (this.#busy) throw new Error("Another vault operation is in progress.");
      this.#busy = true; const epoch = this.#epoch;
      const controller = this.#controller = new AbortController();
      const check = () => { if (this.#epoch !== epoch || controller.signal.aborted) throw aborted(); };
      try { return await action(check, controller.signal); }
      finally { this.#busy = false; this.#controller = null; }
    }
    async create() {
      return this.#operation(async (check, signal) => {
        if (await this.store("get")) throw new Error("A vault already exists. Unlock it to save more hosts.");
        check();
        const credential = await this.credentials.create({signal, publicKey:{challenge:random(32),
          rp:{name:"FreeRDP Local Vault"}, user:{id:random(32), name:"freerdp-local-vault", displayName:"FreeRDP Local Vault"},
          pubKeyCredParams:[{type:"public-key", alg:-7}, {type:"public-key", alg:-257}],
          authenticatorSelection:{residentKey:"required", userVerification:"required"},
          attestation:"none", timeout:60000, extensions:{prf:{}}}});
        check();
        if (!credential?.getClientExtensionResults().prf?.enabled)
          throw new Error("Passkey did not enable PRF. No vault was saved; remove the unused passkey in system settings if needed.");
        const credentialId = encode(credential.rawId), salt = random(32);
        const prf = await evaluate(this.credentials, credentialId, salt, signal);
        const raw = random(32); let plaintext;
        try {
          check(); const kek = await wrappingKey(prf, salt);
          const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
          plaintext = enc.encode(JSON.stringify({hosts:[]}));
          const record = {version:1, revision:crypto.randomUUID(), credentialId, salt:encode(salt),
            wrappedKey:await seal(kek, raw, "key"), payload:await seal(key, plaintext, "hosts")};
          check(); await this.store("put", record, null); check();
          this.#key = key; this.#record = record; this.#payload = {hosts:[]};
        } finally { prf.fill(0); raw.fill(0); plaintext?.fill(0); }
      });
    }
    async unlock() {
      return this.#operation(async (check, signal) => {
        const record = await this.store("get"); check();
        if (!record || record.version !== 1) throw new Error("No supported vault was found.");
        const salt = decode(record.salt), prf = await evaluate(this.credentials, record.credentialId, salt, signal);
        let raw, plaintext;
        try {
          check(); const kek = await wrappingKey(prf, salt);
          raw = await open(kek, record.wrappedKey, "key");
          const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
          plaintext = await open(key, record.payload, "hosts");
          const payload = validatePayload(JSON.parse(dec.decode(plaintext))); check();
          this.#key = key; this.#record = record; this.#payload = payload;
        } finally { prf.fill(0); raw?.fill(0); plaintext?.fill(0); }
      });
    }
    #require() { if (!this.unlocked) throw new Error("Unlock the vault first."); }
    list() { this.#require(); return this.#payload.hosts.map(({password, ...metadata}) => ({...metadata})); }
    async #mutate(change) {
      return this.#operation(async check => {
        this.#require(); const payload = structuredClone(this.#payload);
        let plaintext, committed = false;
        try {
          const result = change(payload); plaintext = enc.encode(JSON.stringify(payload));
          const record = {...this.#record, revision:crypto.randomUUID(), payload:await seal(this.#key, plaintext, "hosts")};
          check(); await this.store("put", record, this.#record.revision); check();
          for (const h of this.#payload.hosts) h.password = "";
          this.#record = record; this.#payload = payload; committed = true; return result;
        } finally { plaintext?.fill(0); if (!committed) for (const h of payload.hosts) h.password = ""; }
      });
    }
    async save(value, keepPassword = false) {
      return this.#mutate(payload => {
        const index = payload.hosts.findIndex(h => h.id === value.id);
        if (keepPassword && index < 0) throw new Error("The saved host no longer exists.");
        const host = validateHost({...value, password:keepPassword ? payload.hosts[index].password : value.password});
        if (index < 0) payload.hosts.push(host); else payload.hosts[index] = host;
        return host.id;
      });
    }
    async remove(id) { return this.#mutate(payload => { payload.hosts = payload.hosts.filter(h => h.id !== id); }); }
    // Callback must be synchronous; the connection bridge waits for WASM before reading.
    use(id, consume) {
      this.#require(); if (this.busy) throw new Error("Wait for the vault operation to finish.");
      const source = this.#payload.hosts.find(h => h.id === id);
      if (!source) throw new Error("Select a saved host.");
      const host = {...source};
      try { const result = consume(host); if (result?.then) throw new Error("Credential consumer must be synchronous."); return result; }
      finally { host.password = ""; }
    }
  }
  // scale: the screen's scale in percent (devicePixelRatio × 100). Above 100 it goes to the server at
  // connect (/scale-desktop), not only with the first display layout, so a scale-aware server
  // starts at the right size; FreeRDP then keeps that scale for the session's later layouts
  function connectionArgs(host, size, scale = 100) {
    const value = validateHost(host);
    const args = ["/v:" + value.host, "/u:" + value.username, "/p:" + value.password,
      "/cert:ignore", "/size:" + size, "/dynamic-resolution", ...value.extra.split(/\s+/).filter(Boolean)];
    if (!args.some(a => /^[/+-](sound|audio-mode)/.test(a))) args.push("/sound");
    const percent = Math.min(500, Math.round(scale));
    if (percent > 100 && !args.some(a => /^[/+-]scale(?:-desktop)?(?::|$)/i.test(a))) args.push("/scale-desktop:" + percent);
    return args;
  }
  const api = {Vault, vaultStore, connectionArgs, validateOptions};
  root.FreeRDPVault = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
