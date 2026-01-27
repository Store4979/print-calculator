/* sw.js — safe cache strategy (fixes Response body already used) */
const CACHE = "print-app-shell-v1";
const CORE = ["/", "/index.html", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(CORE).catch(() => {});
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => (k === CACHE ? null : caches.delete(k))));
    self.clients.claim();
  })());
});

// Network-first for navigations so index.html updates after deploys
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Never cache-bust sw itself here
  if (url.pathname === "/sw.js") return;

  if (req.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        // clone immediately before body is consumed anywhere else
        const copy = fresh.clone();
        const cache = await caches.open(CACHE);
        await cache.put("/index.html", copy);
        return fresh;
      } catch (e) {
        const cached = await caches.match("/index.html");
        return cached || Response.error();
      }
    })());
    return;
  }

  // Stale-while-revalidate for other requests
  event.respondWith((async () => {
    const cached = await caches.match(req);
    const fetchPromise = fetch(req).then((res) => {
      try {
        if (res && res.ok) caches.open(CACHE).then(cache => cache.put(req, res.clone()));
      } catch {}
      return res;
    }).catch(() => cached);
    return cached || fetchPromise;
  })());
});
