const {test} = require("node:test");
const assert = require("node:assert/strict");
const {readFileSync} = require("node:fs");
const {join} = require("node:path");
const vm = require("node:vm");
const {connectionArgs,validateOptions} = require("../vault.js");
function fixture({search="", extra="", direct=true}={}) {
  const elements=new Map(), storage=new Map(), calls=[], classes=new Set();
  const classList={add:k=>classes.add(k),remove:k=>classes.delete(k),contains:k=>classes.has(k),toggle:(k,on)=>on?classes.add(k):classes.delete(k)};
  const element=id=>{
    if(!elements.has(id)) elements.set(id,{value:"",checked:false,disabled:false,textContent:"",hidden:true,
      firstChild:{textContent:""},classList,addEventListener(){},appendChild(){},focus(){},
      getBoundingClientRect:()=>({top:0,width:1024,height:600}),offsetHeight:64,style:{setProperty(){}},
      matches:()=>false,contains:()=>false});
    return elements.get(id);
  };
  element("pass");
  const context={console:{log(){}},URLSearchParams,URL,performance,Promise,TextEncoder,TextDecoder,
    setInterval:()=>1,clearInterval(){},setTimeout:()=>1,clearTimeout(){},
    requestAnimationFrame:fn=>queueMicrotask(fn), HTMLCanvasElement:function(){},Element:function(){},
    location:{search,pathname:"/",hash:""},history:{replaceState(a,b,url){context.cleanURL=url;}},
    navigator:{keyboard:{}},crossOriginIsolated:true,Option:function(){},
    localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
    fetch:()=>Promise.reject(new Error("offline test")),
    document:{getElementById:element,querySelector:element,exitFullscreen:()=>Promise.resolve(),
      addEventListener(){},body:{classList},documentElement:element("root")},
    AudioContext:function(){this.resume=()=>Promise.resolve();},
    FreeRDPVault:{connectionArgs,validateOptions},
    WebSocket:class{},directSocketsAvailable:direct,addEventListener(){},useDirectTcp(){context.usedDirect=true;},
  };
  context.window=context;
  const selected={host:"selected.local:3389",username:"selected-user",password:"bridge-secret",extra:extra||"/gfx:AV1:i444",direct};
  let locked=false;
  context.FreeRDPVaultUI={selected:"saved-id",check(){validateOptions(selected.extra);},
    use(callback){if(locked)throw new Error("Vault locked");return callback({...selected});},lock(){locked=true;context.FreeRDPVaultUI.selected="";element("pass").value="";}};
  vm.createContext(context);vm.runInContext(readFileSync(join(__dirname,"../app.js"),"utf8"),context);
  context.Module.callMain=args=>{calls.push([...args]);context.Module.print("runtime /p:bridge-secret");context.Module.print("runtime mentions bridge-secret");};
  return {context,elements,storage,calls,selected,get locked(){return locked;}};
}
test("connect waits for ready runtime, passes selected host directly, masks logs, clears password and runs once",async()=>{
  const f=fixture();f.elements.get("host").value="wrong-form-host";f.elements.get("pass").value="wrong-form-password";
  const pending=f.context.connect();await Promise.resolve();assert.equal(f.calls.length,0);
  f.context.Module.onRuntimeInitialized();await pending;
  assert.equal(f.calls.length,1);assert.ok(f.calls[0].includes("/v:selected.local:3389"));
  assert.ok(f.calls[0].includes("/u:selected-user"));assert.ok(f.calls[0].includes("/p:bridge-secret"));
  assert.equal(f.context.usedDirect,true);assert.equal(f.locked,true);assert.equal(f.elements.get("pass").value,"");
  for(const value of f.storage.values())assert.ok(!value.includes("bridge-secret"));
  assert.ok(!f.elements.get("log").textContent.includes("bridge-secret"));
  await f.context.connect();assert.equal(f.calls.length,1);
});
test("runtime abort releases waiting connection without exposing selected credentials",async()=>{
  const f=fixture(),pending=f.context.connect();f.context.Module.onAbort("synthetic failure");await pending;
  assert.equal(f.calls.length,0);assert.equal(f.locked,true);
});
test("lock before ready runtime cancels selected-host connection",async()=>{
  const f=fixture(),pending=f.context.connect();f.context.FreeRDPVaultUI.lock();f.context.Module.onRuntimeInitialized();await pending;
  assert.equal(f.calls.length,0);assert.match(f.elements.get("status").textContent,/Selected host changed/);
});
test("password URL and credential-bearing extra URL options are removed, ignored and never persisted",()=>{
  const f=fixture({search:"?p=url-secret&extra=%2Fp%3Aextra-secret&u=user"});
  assert.equal(f.elements.get("pass").value,"");assert.equal(f.elements.get("extra").value,"/gfx:AV1:i444");
  assert.equal(f.context.cleanURL,"/?u=user");
  for(const value of f.storage.values()){assert.ok(!value.includes("url-secret"));assert.ok(!value.includes("extra-secret"));}
});
test("manual credential extra options are rejected before saveSettings",async()=>{
  const f=fixture();f.context.FreeRDPVaultUI.selected="";f.elements.get("extra").value="/p:extra-secret";
  f.context.FreeRDPVaultUI.check=()=>validateOptions(f.elements.get("extra").value);
  await f.context.connect();assert.equal(f.calls.length,0);assert.equal(f.storage.has("freerdp-web-settings"),false);
});

test("switching the selected host during runtime wait aborts without consuming the new host",async()=>{
  const f=fixture(),pending=f.context.connect();
  f.context.FreeRDPVaultUI.selected="other-saved-id";f.selected.password="other-secret";
  f.context.Module.onRuntimeInitialized();await pending;
  assert.equal(f.calls.length,0);assert.match(f.elements.get("status").textContent,/Selected host changed/);
});
test("clearing saved selection cannot fall back to a manual connection during runtime wait",async()=>{
  const f=fixture(),pending=f.context.connect();f.context.FreeRDPVaultUI.selected="";
  f.elements.get("host").value="manual.local:3389";f.elements.get("pass").value="manual-secret";
  f.context.Module.onRuntimeInitialized();await pending;assert.equal(f.calls.length,0);
});
