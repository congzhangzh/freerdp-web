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
      const started=await bounded(send("Runtime.evaluate",{returnByValue:true,userGesture:true,
        expression:`(() => { document.getElementById('pass').value = ${JSON.stringify(password)}; document.getElementById('go').click(); return true; })()`}));
      if(started?.exceptionDetails || started?.result?.value!==true)
        throw new Error("Could not inject synthetic password and click Connect through CDP.");
      return;
    }
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw new Error("WASM did not become ready within the test connection deadline.");
}
