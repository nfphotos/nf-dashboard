"""Local preview server. Serves the repo root, wherever it happens to live.

Sends no-store on everything: the default handler lets the browser cache
assets/js/app.js heuristically, which meant edits kept not showing up during
development and looked like broken code rather than a stale copy.
"""
import functools, http.server, pathlib, socketserver

DIR = str(pathlib.Path(__file__).resolve().parents[1])


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        super().end_headers()


Handler = functools.partial(NoCacheHandler, directory=DIR)
with socketserver.TCPServer(("127.0.0.1", 4178), Handler) as httpd:
    print("serving", DIR, "on 4178 (no-store)")
    httpd.serve_forever()
