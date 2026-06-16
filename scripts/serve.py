import functools, http.server, socketserver
DIR = "/Users/nfalzon/Documents/Claude/personal-dashboard"
Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=DIR)
with socketserver.TCPServer(("127.0.0.1", 4178), Handler) as httpd:
    print("serving", DIR, "on 4178")
    httpd.serve_forever()
