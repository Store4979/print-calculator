/* sw.js — simple app-shell cache with safe updates */
const CACHE = "print-app-v13";
const CORE = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll(CORE);
      self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => (k === CACHE ? null : caches.delete(k))));
      self.clients.claim();
    })()
  );
});

// Network-first for navigations so new index.html is picked up after deploy
self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Always bypass cache for the service worker itself
  if (new URL(req.url).pathname === "/sw.js") return;

  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          const cache = await caches.open(CACHE);
          cache.put("/index.html", fresh.clone());
          return fresh;
        } catch (e) {
          const cached = await caches.match("/index.html");
          return cached || Response.error();
        }
      })()
    );
    return;
  }

  // Stale-while-revalidate for static assets
  event.respondWith(
    (async () => {
      const cached = await caches.match(req);
      const fetchPromise = fetch(req)
        .then((res) => {
          if (res && res.ok) {
            caches.open(CACHE).then((cache) => cache.put(req, res.clone()));
          }
          return res;
        })
        .catch(() => cached);

      return cached || fetchPromise;
    })()
  );
});
