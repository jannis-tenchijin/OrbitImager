"""Local dev server for Orbit Imager.

Same as `python3 -m http.server`, but sends `Cache-Control: no-store` so the browser never
mixes freshly edited ES modules with stale cached ones (a real failure mode: one module
updated, its importer served from cache).

Usage: python3 serve.py [port]   (default 8000)
"""

import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class NoCacheHandler(SimpleHTTPRequestHandler):
    """Static file handler that disables browser caching."""

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    root = Path(__file__).resolve().parent  # always serve the repo root
    handler = partial(NoCacheHandler, directory=str(root))
    with ThreadingHTTPServer(("", port), handler) as httpd:
        print(f"Serving {root} at http://localhost:{port}/ (no-cache)")
        httpd.serve_forever()


if __name__ == "__main__":
    main()
