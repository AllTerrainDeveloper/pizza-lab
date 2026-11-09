"""Static dev server for site/ that disables caching (so ES modules always reload)."""
import functools
import http.server
import sys


class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


port = int(sys.argv[1]) if len(sys.argv) > 1 else 5173
handler = functools.partial(NoCache, directory="site")
http.server.ThreadingHTTPServer(("127.0.0.1", port), handler).serve_forever()
