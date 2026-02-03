/* sw.js — simple app-shell cache with safe updates (production hardened) */
const CACHE = "print-app-v14";
const CORE = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(CORE);
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => (k === CACHE ? null : caches.delete(k))));
    self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Always bypass cache for the service worker itself
  if (url.pathname === "/sw.js") return;

  // Network-first for navigations so new index.html is picked up after deploy
  if (req.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        try {
          const cache = await caches.open(CACHE);
          await cache.put("/index.html", fresh.clone());
        } catch {
          // Ignore cache write errors
        }
        return fresh;
      } catch {
        const cached = await caches.match("/index.html");
        return cached || Response.error();
      }
    })());
    return;
  }

  // Stale-while-revalidate for static assets
  event.respondWith((async () => {
    const cached = await caches.match(req);

    const fetchPromise = fetch(req)
      .then((res) => {
        if (res && res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, clone)).catch(() => {});
        }
        return res;
      })
      .catch(() => null);

    // Always resolve to a valid Response.
    if (cached) return cached;
    const net = await fetchPromise;
    return net || new Response('', { status: 504, statusText: 'Gateway Timeout' });
  })());
});
