// TEST ONLY: a fake Direct Sockets TCPSocket for normal pages, implemented over a WebSocket
// to websockify, so tcp-shim.js (the IWA code path) can be exercised in headless Chrome.
(() => {
  const RealWS = window.WebSocket;
  window.TCPSocket = class {
    constructor(host, port) {
      const ws = new RealWS(`ws://${host}:${port}`, ["binary"]);
      ws.binaryType = "arraybuffer";
      let rctl;
      const readable = new ReadableStream({ start(c) { rctl = c; } });
      ws.onmessage = (e) => rctl.enqueue(new Uint8Array(e.data));
      ws.onclose = () => { try { rctl.close(); } catch {} };
      const writable = new WritableStream({ write(chunk) { ws.send(chunk); } });
      this.opened = new Promise((res, rej) => { ws.onopen = () => res({ readable, writable }); ws.onerror = rej; });
      this.close = async () => ws.close();
      window.__fakeTcp = (window.__fakeTcp || 0) + 1;
    }
  };
})();
