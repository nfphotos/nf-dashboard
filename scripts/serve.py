"""Local preview server. Serves the repo root, wherever it happens to live."""
import functools, http.server, pathlib, socketserver

DIR = str(pathlib.Path(__file__).resolve().parents[1])
Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=DIR)
with socketserver.TCPServer(("127.0.0.1", 4178), Handler) as httpd:
    print("serving", DIR, "on 4178")
    httpd.serve_forever()
