// Legacy regression tests inject synthetic credentials through CDP, never through URLs.
export async function connectTestSession(send, {password="test", timeout=60000}={}) {
  const deadline=Date.now()+timeout;
  const bounded=async promise=>{
    const remaining=deadline-Date.now();
    if(remaining<=0)throw new Error("WASM readiness timed out before test connection.");
    let timer;
    try {return await Promise.race([promise,new Promise((_,reject)=>{
      timer=setTimeout(()=>reject(new Error("CDP response timed out while preparing test connection.")),Math.min(remaining,5000));
    })]);} finally {clearTimeout(timer);}
  };
  while(Date.now()<deadline){
    const response=await bounded(send("Runtime.evaluate",{returnByValue:true,
      expression:"document.getElementById('status')?.textContent === 'ready' && !document.getElementById('go')?.disabled"}));
    if(response?.result?.value===true){
      // Connect with a real mouse click (Input.dispatchMouseEvent): the browser's own user
      // activation, which the page's full screen request at Connect needs. A click made by
      // Runtime.evaluate with userGesture got full screen up to Chrome 156; on Chrome 157 (kit
      // round 43542667639) the page logged "full screen refused: not granted" and every All
      // screens test measured the windowed page, 602 x 456 instead of 640 x 480.
      const at=await bounded(send("Runtime.evaluate",{returnByValue:true,
        expression:`(() => { document.getElementById('pass').value = ${JSON.stringify(password)}; const b = document.getElementById('go'); b.scrollIntoView({ block: "center" });
          const r = b.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2, hit: document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === b }); })()`}));
      if(at?.exceptionDetails || typeof at?.result?.value!=="string")
        throw new Error("Could not inject synthetic password through CDP.");
      const {x,y,hit}=JSON.parse(at.result.value);
      if(hit){
        for(const type of ["mouseMoved","mousePressed","mouseReleased"])
          await bounded(send("Input.dispatchMouseEvent",{type,x,y,button:type==="mouseMoved"?"none":"left",clickCount:1}));
        return;
      }
      // something covers the button (a dialog): the old way, a click by script
      const started=await bounded(send("Runtime.evaluate",{returnByValue:true,userGesture:true,
        expression:"(() => { document.getElementById('go').click(); return true; })()"}));
      if(started?.exceptionDetails || started?.result?.value!==true)
        throw new Error("Could not click Connect through CDP.");
      return;
    }
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw new Error("WASM did not become ready within the test connection deadline.");
}

// A real click on a page element (Input.dispatchMouseEvent at its centre), for what needs the
// browser's user activation: Chrome 157 refuses full screen to a click made by Runtime.evaluate
// (#371), so the toolbar's Full screen is clicked this way. In full screen the toolbar is hidden
// until the mouse rests at the top edge (app.js showToolbar: y <= 4 for 300 ms): it does that
// first. Resolves to whether the element itself got the click.
export async function clickForReal(send, selector) {
  const ev = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true }))?.result?.value;
  const mouse = async (x, y, types = ["mouseMoved", "mousePressed", "mouseReleased"]) => {
    for (const type of types) await send("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" ? "none" : "left", clickCount: 1 }); };
  const reveal = await ev(`(() => { if (!document.body.classList.contains("tbhide") || !document.getElementById("toolbar")?.contains(document.querySelector(${JSON.stringify(selector)}))) return null;
    const r = document.getElementById("toolbar").getBoundingClientRect(); return JSON.stringify({ x: (r.left + r.right) / 2, y: 2 }); })()`);
  if (reveal) { const { x, y } = JSON.parse(reveal); await mouse(x, y, ["mouseMoved"]); await new Promise((r) => setTimeout(r, 700)); }
  const at = await ev(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null;
    const r = e.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
    if (!e.contains(document.elementFromPoint(x, y))) return null;
    window.__clickedForReal = false; e.addEventListener("click", () => { window.__clickedForReal = true; }, { once: true, capture: true });
    return JSON.stringify({ x, y }); })()`);
  if (!at) return false;
  const { x, y } = JSON.parse(at);
  await mouse(x, y);
  return (await ev("window.__clickedForReal")) === true;
}
