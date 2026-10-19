const {test} = require("node:test");
const assert = require("node:assert/strict");
const {webcrypto} = require("node:crypto");
globalThis.crypto ??= webcrypto;
const {Vault, connectionArgs} = require("../vault.js");
function authenticator({enabled=true, output=true, uv=true, secret=42, wrongId=false, get}={}) {
  const id = new Uint8Array([1,2,3]), authData = new Uint8Array(37); authData[32] = uv ? 5 : 1;
  return {
    async create(options) {
      assert.equal(options.publicKey.authenticatorSelection.userVerification, "required");
      assert.equal(options.publicKey.authenticatorSelection.residentKey, "required");
      return {rawId:id, getClientExtensionResults:() => ({prf:{enabled}})};
    },
    async get(options) {
      assert.equal(options.publicKey.userVerification, "required");
      assert.equal(options.publicKey.extensions.prf.eval.first.length,32);
      if (get) await get(options);
      return {rawId:wrongId ? new Uint8Array([4]) : id, response:{authenticatorData:authData},
        getClientExtensionResults:() => output ? {prf:{results:{first:new Uint8Array(32).fill(secret)}}} : {}};
    }
  };
}
function memoryStore() {
  let value;
  return async (operation, next, expected) => {
    if (operation === "get") return structuredClone(value);
    assert.equal(value?.revision ?? null, expected, "revision conflict");
    value = structuredClone(next);
  };
}
const host = (name="alpha", password="synthetic-secret-one") => ({host:name+".local:3389",
  username:name+"-user", password, label:name+" label", extra:"/gfx:AV1:i444", direct:true});
async function fixture() {
  const store=memoryStore(), vault=new Vault(store,authenticator()); await vault.create();
  return {store,vault};
}
test("multi-host encrypted roundtrip hides passwords and metadata; lock requires reauthentication", async () => {
  const {store,vault}=await fixture(), a=await vault.save(host()), b=await vault.save(host("beta","second-secret"));
  const record=await store("get"), serialized=JSON.stringify(record);
  for (const value of ["alpha.local", "alpha-user", "alpha label", "synthetic-secret-one", "beta.local", "second-secret"])
    assert.ok(!serialized.includes(value), value+" leaked");
  assert.notEqual(record.wrappedKey.iv,record.payload.iv);
  assert.equal(vault.list().length,2); assert.ok(!("password" in vault.list()[0]));
  let copy; vault.use(b,h=>{copy=h; assert.equal(h.password,"second-secret");}); assert.equal(copy.password,"");
  vault.lock(); assert.equal(vault.unlocked,false); assert.throws(()=>vault.list()); assert.throws(()=>vault.use(a,()=>{}));
  await vault.unlock(); vault.use(a,h=>assert.equal(h.password,"synthetic-secret-one"));
});
test("update, keep password, and delete persist encrypted and preserve another host", async () => {
  const {store,vault}=await fixture(), a=await vault.save(host()), b=await vault.save(host("beta","second-secret"));
  const before=await store("get");
  await vault.save({...host("changed",""),id:a},true);
  const after=await store("get"); assert.notEqual(before.payload.iv,after.payload.iv);
  vault.lock(); await vault.unlock(); vault.use(a,h=>{assert.equal(h.host,"changed.local:3389");assert.equal(h.password,"synthetic-secret-one");});
  await vault.save({...host("changed","replacement"),id:a}); await vault.remove(b);
  vault.lock(); await vault.unlock(); assert.equal(vault.list().length,1); vault.use(a,h=>assert.equal(h.password,"replacement"));
});
test("wrong PRF secret and encrypted box tampering fail closed", async () => {
  const {store,vault}=await fixture(); await vault.save(host()); const record=await store("get");
  await assert.rejects(new Vault(store,authenticator({secret:43})).unlock(),{name:"OperationError"});
  for (const box of ["wrappedKey","payload"]) for (const field of ["iv","ciphertext"]) {
    const copy=structuredClone(record), bytes=Uint8Array.from(atob(copy[box][field]),c=>c.charCodeAt(0));
    bytes[0]^=1; copy[box][field]=btoa(String.fromCharCode(...bytes));
    const broken=new Vault(async()=>copy,authenticator());
    await assert.rejects(broken.unlock(),{name:"OperationError"}); assert.equal(broken.unlocked,false);
  }
});
test("missing PRF, missing UV and mismatched credentials never persist a vault", async () => {
  for (const options of [{enabled:false},{output:false},{uv:false},{wrongId:true}]) {
    const store=memoryStore(), vault=new Vault(store,authenticator(options));
    await assert.rejects(vault.create()); assert.equal(await store("get"),undefined); assert.equal(vault.unlocked,false);
  }
});
test("locking cancels late authenticator results and rejects overlapping operations", async () => {
  const {store,vault}=await fixture(); await vault.save(host()); vault.lock();
  let release, entered; const started=new Promise(r=>entered=r), gate=new Promise(r=>release=r);
  vault.credentials=authenticator({get:async()=>{entered();await gate;}});
  const pending=vault.unlock(); await started;
  await assert.rejects(vault.unlock(),/in progress/); vault.lock(); release();
  await assert.rejects(pending,{name:"AbortError"}); assert.equal(vault.unlocked,false);
  assert.throws(()=>vault.list());
});
test("lock during encryption cannot resurrect plaintext state", async () => {
  const {vault}=await fixture(); const pending=vault.save(host()); vault.lock();
  await assert.rejects(pending,{name:"AbortError"}); assert.equal(vault.unlocked,false);
});
test("two tabs detect stale writes instead of overwriting saved hosts", async () => {
  const {store,vault}=await fixture(), other=new Vault(store,authenticator()); await other.unlock();
  await vault.save(host()); await assert.rejects(other.save(host("beta")),/revision conflict/);
  other.lock(); await other.unlock(); assert.equal(other.list()[0].host,"alpha.local:3389");
});
test("selected host builds exact WASM argv including its password; extra options cannot override identity", async () => {
  const {vault}=await fixture(), a=await vault.save(host()), b=await vault.save(host("beta","second-secret"));
  const args=vault.use(b,h=>connectionArgs(h,"1920x1080"));
  assert.ok(args.includes("/v:beta.local:3389")); assert.ok(args.includes("/u:beta-user")); assert.ok(args.includes("/p:second-secret"));
  assert.ok(!args.includes("/p:synthetic-secret-one")); assert.ok(args.includes("/sound"));
  for (const extra of ["/p:leak", "/v:evil", "/u:other", "/gp:leak", "/args-from:file", "/from-stdin", "/gateway:p:leak", "/proxy:user:secret@host", "/pth:hash", "/endpointfedauth:token", "/tls:secrets-file:out", "/print-reconnect-cookie"])
    assert.throws(()=>connectionArgs({...host(),extra},"800x600"));
  assert.throws(()=>vault.use(a,async()=>{}),/synchronous/);
});
test("the screen's scale goes to the server at connect above 100 %, clamped to 500; Extra options win", () => {
  const scale=(s,extra="")=>connectionArgs({...host(),extra},"3024x1964",s).filter(a=>/^\/scale/.test(a));
  assert.deepEqual(scale(undefined),[]); assert.deepEqual(scale(100),[]); assert.deepEqual(scale(90),[]);
  assert.deepEqual(scale(200),["/scale-desktop:200"]); assert.deepEqual(scale(149.6),["/scale-desktop:150"]);
  assert.deepEqual(scale(600),["/scale-desktop:500"]);
  assert.deepEqual(scale(200,"/scale-desktop:125"),["/scale-desktop:125"]); assert.deepEqual(scale(200,"/scale:140"),["/scale:140"]);
});
