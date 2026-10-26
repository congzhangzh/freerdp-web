const {test} = require("node:test");
const assert = require("node:assert/strict");
const {readFileSync} = require("node:fs");
const {join} = require("node:path");
const vm = require("node:vm");
const {connectionArgs,validateOptions} = require("../vault.js");
const FreeRDPOptions = require("../options.js");
const FreeRDPKeyboard = require("../keyboard.js");
const FreeRDPScreens = require("../screens.js");
function fixture({search="", extra="", direct=true}={}) {
  const elements=new Map(), storage=new Map(), calls=[], classes=new Set();
  const classList={add:k=>classes.add(k),remove:k=>classes.delete(k),contains:k=>classes.has(k),toggle:(k,on)=>on?classes.add(k):classes.delete(k)};
  const element=id=>{
    if(!elements.has(id)) elements.set(id,{value:"",checked:false,disabled:false,textContent:"",hidden:true,
      firstChild:{textContent:""},classList,addEventListener(){},appendChild(){},focus(){},
      getBoundingClientRect:()=>({top:0,width:1024,height:600}),offsetHeight:64,style:{setProperty(){}},
      matches:()=>false,contains:()=>false,replaceChildren(){},dispatchEvent(){},parentElement:{textContent:id}});
    return elements.get(id);
  };
  element("pass");
  const context={console:{log(){}},URLSearchParams,URL,performance,Promise,TextEncoder,TextDecoder,
    setInterval:()=>1,clearInterval(){},setTimeout:()=>1,clearTimeout(){},
    requestAnimationFrame:fn=>queueMicrotask(fn), MutationObserver:class{observe(){}}, HTMLCanvasElement:function(){},Element:function(){},
    location:{search,pathname:"/",hash:""},history:{replaceState(a,b,url){context.cleanURL=url;}},
    navigator:{keyboard:{}},crossOriginIsolated:true,Option:function(){},
    localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
    fetch:()=>Promise.reject(new Error("offline test")),
    document:{getElementById:element,querySelector:element,querySelectorAll:()=>[],exitFullscreen:()=>Promise.resolve(),
      addEventListener(){},body:{classList},documentElement:element("root")},
    AudioContext:function(){this.resume=()=>Promise.resolve();},
    FreeRDPVault:{connectionArgs,validateOptions},FreeRDPOptions,FreeRDPKeyboard,FreeRDPScreens,screen:{},
    WebSocket:class{},directSocketsAvailable:direct,addEventListener(){},useDirectTcp(){context.usedDirect=true;},
  };
  context.window=context;
  const selected={host:"selected.local:3389",username:"selected-user",password:"bridge-secret",extra:extra||"/gfx:AV1:i444",direct};
  let locked=false;
  const current={id:"saved-id",name:"Saved",host:"",directHost:"",direct,user:"",extra:"",fullscreen:false,
    session:{...FreeRDPOptions.DEFAULTS},vault:true,vaultSaved:true};
  context.FreeRDPHostsUI={selected:"saved-id",current:()=>current,update:()=>true,onSelect(){},prepare:async()=>{},
    check(){validateOptions(selected.extra);},
    use(password,callback){if(locked)throw new Error("Vault locked");return callback({...selected,...(password!==null?{password}:{})});},lock(){locked=true;context.FreeRDPHostsUI.selected="";element("pass").value="";}};
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
  const f=fixture(),pending=f.context.connect();f.context.FreeRDPHostsUI.lock();f.context.Module.onRuntimeInitialized();await pending;
  assert.equal(f.calls.length,0);assert.match(f.elements.get("status").textContent,/Selected host changed/);
});
test("password URL and credential-bearing extra URL options are removed, ignored and never persisted",()=>{
  const f=fixture({search:"?p=url-secret&extra=%2Fp%3Aextra-secret&u=user"});
  assert.equal(f.elements.get("pass").value,"");assert.equal(f.elements.get("extra").value,"");
  assert.equal(f.context.cleanURL,"/?u=user");
  for(const value of f.storage.values()){assert.ok(!value.includes("url-secret"));assert.ok(!value.includes("extra-secret"));}
});
test("manual credential extra options are rejected before saveSettings",async()=>{
  const f=fixture();f.context.FreeRDPHostsUI.selected="";f.elements.get("extra").value="/p:extra-secret";
  f.context.FreeRDPHostsUI.check=()=>validateOptions(f.elements.get("extra").value);
  await f.context.connect();assert.equal(f.calls.length,0);
  for(const value of f.storage.values())assert.ok(!value.includes("extra-secret"));
});

test("switching the selected host during runtime wait aborts without consuming the new host",async()=>{
  const f=fixture(),pending=f.context.connect();
  f.context.FreeRDPHostsUI.selected="other-saved-id";f.selected.password="other-secret";
  f.context.Module.onRuntimeInitialized();await pending;
  assert.equal(f.calls.length,0);assert.match(f.elements.get("status").textContent,/Selected host changed/);
});
test("clearing saved selection cannot fall back to a manual connection during runtime wait",async()=>{
  const f=fixture(),pending=f.context.connect();f.context.FreeRDPHostsUI.selected="";
  f.elements.get("host").value="manual.local:3389";f.elements.get("pass").value="manual-secret";
  f.context.Module.onRuntimeInitialized();await pending;assert.equal(f.calls.length,0);
});

// the codec, sound and clipboard choices of the session settings reach the client; extra options win
async function connectWith(f){const pending=f.context.connect();f.context.Module.onRuntimeInitialized();await pending;return f.calls[0];}
test("session settings are generated for a saved host, its extra options win over the same kind",async()=>{
  const f=fixture({extra:"/gfx:AV1:i420 /bpp:16"});
  f.elements.get("optAudio").checked=false;f.elements.get("optClipboard").checked=false;
  f.context.document.querySelector=sel=>{const m=/name=(\w+)\]:checked/.exec(sel);return m?{value:{codec:"av1-444",strategy:"bandwidth"}[m[1]]}:{parentElement:{textContent:""}};};
  const args=await connectWith(f);
  assert.ok(args.includes("/gfx:AV1:i420"));assert.ok(!args.includes("/gfx:AV1:i444"));
  assert.ok(args.includes("/audio-mode:2"));assert.ok(!args.includes("/sound"));
  assert.ok(args.includes("-clipboard"));assert.ok(args.includes("/network:broadband-low"));assert.ok(args.includes("/bpp:16"));
});
