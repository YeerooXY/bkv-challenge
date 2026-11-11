"""Serve the BKV Challenge app and its key-protected arrivals API on one port. Standard library only.

  set BKK_API_KEY=your_key_here          (without it the app still runs; live arrivals report "unavailable")
  python backend/server.py               -> http://127.0.0.1:8000

  --host / --port           where to listen (default 127.0.0.1:8000)
  ALLOWED_ORIGINS           comma separated origins allowed to call /v1 from another site, for example
                            https://yeerooxy.github.io (static Pages and the Capacitor app need this when they use a hosted copy)
  --api-only                serve /v1 only, for a hosted copy behind the static site

The key is read from the environment and goes only to futar.bkk.hu. It is never sent to a browser or written to a log.
"""
import argparse
import json
import os
import sys
import threading
import time
import urllib.parse
from collections import defaultdict, deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from futar import ApiError, Transit, redact  # noqa: E402

ROOT = Path(__file__).parents[1].resolve()
STATIC_FILES = {"index.html", "sw.js", "manifest.webmanifest"}
STATIC_DIRS = ("css/", "js/", "data/", "icons/")
TYPES = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
         ".webmanifest": "application/manifest+json", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml"}
CLIENT_LIMIT, WINDOW = 60, 60  # requests per client per minute on /v1


class App:
    def __init__(self, transit, origins=(), api_only=False):
        self.transit, self.origins, self.api_only = transit, set(origins), api_only
        self.hits, self.lock = defaultdict(deque), threading.Lock()

    def limited(self, ip):
        now = time.time()
        with self.lock:
            q = self.hits[ip]
            while q and now - q[0] > WINDOW:
                q.popleft()
            if len(q) >= CLIENT_LIMIT:
                return max(1, int(WINDOW - (now - q[0])))
            q.append(now)
            if len(self.hits) > 2000:
                self.hits = defaultdict(deque, {k: v for k, v in self.hits.items() if v and now - v[-1] <= WINDOW})
        return 0

    def static_file(self, path):
        rel = urllib.parse.unquote(path.split("?")[0]).lstrip("/") or "index.html"
        if "\\" in rel or "\0" in rel or ".." in rel.split("/") or not (rel in STATIC_FILES or rel.startswith(STATIC_DIRS)):
            return None
        f = (ROOT / rel).resolve()
        return f if f.is_file() and ROOT in f.parents else None


class Handler(BaseHTTPRequestHandler):
    server_version = "bkv-adapter"
    app = None  # set by main()

    def log_message(self, fmt, *args):
        sys.stderr.write("%s %s\n" % (self.address_string(), redact(urllib.parse.urlsplit(self.path).path, self.app.transit.key)))

    def _send(self, status, body, ctype, extra=()):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        origin = self.headers.get("Origin")
        if origin and origin in self.app.origins:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        for k, v in extra:
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _json(self, status, obj, extra=()):
        self._send(status, json.dumps(obj, ensure_ascii=False).encode(), "application/json; charset=utf-8", [("Cache-Control", "no-store"), *extra])

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        parts = urllib.parse.urlsplit(self.path)
        if parts.path.startswith("/v1/"):
            return self.api(parts)
        if self.app.api_only:
            return self._json(404, {"error": "not-found"})
        f = self.app.static_file(self.path)
        if not f:
            return self._json(404, {"error": "not-found"})
        cache = "no-cache" if f.name in ("sw.js", "index.html") else "public, max-age=300"
        self._send(200, f.read_bytes(), TYPES.get(f.suffix.lower(), "application/octet-stream"), [("Cache-Control", cache)])

    def api(self, parts):
        wait = self.app.limited(self.client_address[0])
        if wait:
            return self._json(429, {"error": "rate-limited"}, [("Retry-After", str(wait))])
        t = self.app.transit
        try:
            try:
                q = urllib.parse.parse_qs(parts.query, max_num_fields=20)
            except ValueError:
                raise ApiError(400, "too-many-parameters")
            if parts.path == "/v1/health":
                return self._json(200, {"schemaVersion": 1, "live": bool(t.key)})
            if parts.path == "/v1/arrivals":
                at = (q.get("at") or [None])[0]
                if at is not None and not (at.isascii() and at.isdigit() and len(at) <= 11):
                    raise ApiError(400, "bad-time")
                return self._json(200, t.arrivals(q.get("stopId", []), int(at) if at is not None else None))
            if parts.path == "/v1/trip":
                return self._json(200, t.trip((q.get("tripId") or [""])[0], (q.get("serviceDate") or [""])[0]))
            return self._json(404, {"error": "not-found"})
        except ApiError as e:
            extra = [("Retry-After", str(e.retry_after))] if e.retry_after else []
            self._json(e.status, {"schemaVersion": 1, "state": "unavailable", "reason": e.reason}, extra)
        except Exception as e:  # never leak details or the key
            sys.stderr.write("error: %s\n" % redact(repr(e), t.key))
            self._json(500, {"schemaVersion": 1, "state": "unavailable", "reason": "internal"})


def make_server(host, port, transit, origins=(), api_only=False):
    Handler.app = App(transit, origins, api_only)
    return ThreadingHTTPServer((host, port), Handler)


def main():
    for s in (sys.stdout, sys.stderr):
        try:
            s.reconfigure(encoding="utf-8")
        except (AttributeError, ValueError):
            pass
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--api-only", action="store_true")
    a = ap.parse_args()
    key = os.environ.get("BKK_API_KEY", "").strip()
    origins = [o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "").split(",") if o.strip()]
    srv = make_server(a.host, a.port, Transit(key), origins, a.api_only)
    print(f"Listening on http://{a.host}:{a.port}")
    print("Live arrivals: on" if key else "BKK_API_KEY is not set. Live arrivals are unavailable; the app and manual logging still work.")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
