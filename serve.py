#!/usr/bin/env python3
"""Development server for the FreeRDP web client (local testing only, binds 127.0.0.1).

Usage: python3 serve.py [port] [dir]   (default 8080 and ./dist)
- COOP/COEP headers, which pthreads (SharedArrayBuffer) need.
- HTTP/1.1 keep-alive, so the many worker-script requests reuse connections.
- Serves a precompressed <file>.gz with Content-Encoding: gzip when the browser accepts it.
- Caching: HTML is always revalidated; js/wasm are cached for a day, and the page loads them
  with ?v=<version> (set by deploy-web.sh) so a new deployment is never served stale.
- IWA_CSP=1 adds the Content-Security-Policy Chrome enforces on Isolated Web Apps.
"""
import functools, http.server, os, sys

IWA_CSP = ("base-uri 'none'; default-src 'self'; object-src 'none'; frame-src 'self' https: blob: data:; "
           "connect-src 'self' https: wss: blob: data:; script-src 'self' 'wasm-unsafe-eval'; "
           "img-src 'self' https: blob: data:; media-src 'self' https: blob: data:; font-src 'self' blob: data:; "
           "style-src 'self' 'unsafe-inline'; require-trusted-types-for 'script'; frame-ancestors 'self';")

WEB_CSP = IWA_CSP.replace("connect-src 'self' https: wss: blob: data:;",
                          "connect-src 'self' https: wss: ws: blob: data:;")

class Handler(http.server.SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      ".wasm": "application/wasm", ".webmanifest": "application/manifest+json"}

    def send_head(self):
        path = self.translate_path(self.path)
        self._gz = (os.path.isfile(path + ".gz") and "gzip" in self.headers.get("Accept-Encoding", "")
                    and os.path.getmtime(path + ".gz") >= os.path.getmtime(path))
        if not self._gz:
            return super().send_head()
        f = open(path + ".gz", "rb")
        fs = os.fstat(f.fileno())
        self.send_response(200)
        self.send_header("Content-Type", self.guess_type(path))
        self.send_header("Content-Encoding", "gzip")
        self.send_header("Content-Length", str(fs.st_size))
        self.send_header("Last-Modified", self.date_time_string(fs.st_mtime))
        self.end_headers()
        return f

    def end_headers(self):
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        self.send_header("Vary", "Accept-Encoding")
        if self.path.split("?")[0].endswith((".js", ".wasm")) and "v=" in self.path:
            self.send_header("Cache-Control", "public, max-age=86400")
        else:
            self.send_header("Cache-Control", "no-cache")
        self.send_header("Content-Security-Policy", IWA_CSP if os.environ.get("IWA_CSP") else WEB_CSP)
        super().end_headers()

port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
here = os.path.dirname(os.path.abspath(__file__))
root = os.path.join(here, sys.argv[2] if len(sys.argv) > 2 else "dist")
http.server.ThreadingHTTPServer(("127.0.0.1", port), functools.partial(Handler, directory=root)).serve_forever()
