// Direct TCP for Isolated Web Apps.
//
// Emscripten's socket layer (src/lib/libsockfs.js) "connects" a TCP socket by
// calling `new WebSocket("ws://host:port", ["binary"])` and then only uses:
// binaryType, url, readyState + the instance constants CONNECTING/OPEN/CLOSING/
// CLOSED, onopen/onmessage/onclose/onerror, send(ArrayBuffer) and close().
// This class offers exactly that surface on top of the Direct Sockets API
// (TCPSocket), so FreeRDP connects straight to the RDP server: no gateway.
// It is installed only when the page runs as an IWA and direct mode is chosen.
"use strict";

class DirectTcpWebSocket {
  static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;

  constructor(url) {
    Object.assign(this, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
    this.url = url;
    this.readyState = this.CONNECTING;
    this.binaryType = "arraybuffer";
    this.protocol = "binary";
    this.bufferedAmount = 0;
    this.onopen = this.onmessage = this.onclose = this.onerror = null;
    const m = /^wss?:\/\/\[?([^\]\/]+?)\]?:(\d+)/.exec(url);
    if (!m) throw new SyntaxError("bad socket url " + url);
    this._open(m[1], Number(m[2]));
  }

  async _open(host, port) {
    try {
      this._socket = new TCPSocket(host, port, { noDelay: true });
      const { readable, writable } = await this._socket.opened;
      this._writer = writable.getWriter();
      this.readyState = this.OPEN;
      this.onopen?.({ type: "open" });
      const reader = readable.getReader();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        // copy into a plain ArrayBuffer, which is what SOCKFS expects in event.data
        window.freerdpNet.rx += value.byteLength;
        this.onmessage?.({ data: value.slice().buffer });
      }
    } catch (e) {
      const msg = `[tcp-shim] ${host}:${port}: ${e?.name ?? "Error"}: ${e?.message ?? e}`;
      console.error(msg, e);
      if (typeof log === "function") log(msg);   // also show it in the page's Log box
      this.onerror?.({ type: "error", error: e });
    }
    this._finish();
  }

  send(data) {
    if (this.readyState !== this.OPEN) return;
    const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    window.freerdpNet.tx += bytes.byteLength;
    this._writer.write(bytes.slice()).catch((e) => { console.error("[tcp-shim] write", e); this.close(); });
  }

  close() {
    if (this.readyState >= this.CLOSING) return;
    this.readyState = this.CLOSING;
    this._socket?.close().catch(() => {});
  }

  _finish() {
    if (this.readyState === this.CLOSED) return;
    this.readyState = this.CLOSED;
    this.onclose?.({ type: "close", code: 1000 });
  }
}

// byte counters for the connection info overlay (both transports add to them)
window.freerdpNet = { rx: 0, tx: 0 };

// True when Direct Sockets are usable here (only inside an Isolated Web App).
window.directSocketsAvailable = typeof TCPSocket === "function";
window.useDirectTcp = () => { window.WebSocket = DirectTcpWebSocket; };
