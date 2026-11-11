const CACHE = "bkv-challenge-v19";
const ASSETS = ["./", "index.html", "css/app.css", "js/ride-core.js", "js/minimap.js", "js/app.js", "js/nearby.js", "data/catalog.json", "data/stops.json", "data/timetable.json", "data/api.json", "manifest.webmanifest", "icons/icon.svg", "icons/icon-192.png", "icons/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

// Only this site's own static files are handled here. The arrivals API (/v1/), map tiles, the catalog on another origin
// and everything else go straight to the network: live data must never come from a cache or fall back to index.html.
const SCOPE = new URL(self.registration.scope).pathname;
function isStatic(url) {
  if (url.origin !== self.location.origin || !url.pathname.startsWith(SCOPE)) return false;
  const rel = url.pathname.slice(SCOPE.length);
  return rel === "" || rel === "index.html" || rel === "manifest.webmanifest" || /^(css|js|data|icons)\//.test(rel);
}

// Network first so updates arrive when online; the cache keeps it working offline.
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (!isStatic(url)) return;
  e.respondWith(
    fetch(e.request)
      .then((r) => {
        if (r.ok && r.type === "basic") { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
        return r;
      })
      .catch(() => caches.match(e.request).then((m) => m || (e.request.mode === "navigate" ? caches.match("index.html") : Response.error())))
  );
});
