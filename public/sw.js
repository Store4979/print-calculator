/* sw.js — app-shell cache, allowlist-only (security-hardened 2026-09-10)
 *
 * WHY THIS IS AN ALLOWLIST AND NOT A DENYLIST
 * The previous version cached *any* response with res.ok, from any origin,
 * and served it back from caches.match(req) before revalidating. On a
 * shared counter iPad that is a data-leak primitive:
 *   - a Supabase signed URL for customer A's uploaded file returns 200 and
 *     was cached; the signed URL expires in 15 minutes but the CACHED COPY
 *     does not expire at all,
 *   - Supabase REST GETs (orders, pending_jobs, settings) returned 200 and
 *     were cached, so signing out and handing the iPad to the next staffer
 *     left the previous session's data served from cache,
 *   - the cache is keyed on the request URL only, so nothing about it is
 *     scoped to a store, an employee, or a session.
 *
 * The rule now: cache ONLY immutable, non-user-specific, same-origin build
 * output plus two exactly-pinned CDN libraries. Everything else — every API
 * call, every file response, every cross-origin request that is not on the
 * pin list — goes straight to the network and is never written to a cache.
 *
 * Bump CACHE on any change to this file. activate() deletes every cache
 * whose key !== CACHE, so a bump is also the migration: old caches (including
 * print-app-v14, which may hold customer file responses) are purged on the
 * next activation. That purge is the reason this bump is not optional.
 */
const CACHE = "print-app-v15";

const CORE = [
  "/",
  "/index.html",
  "/upload.html",
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
];

// Exactly-pinned, versioned, immutable third-party libraries. Version-locked
// URLs, so a cached copy can never drift from what index.html asks for.
// Anything not on this list is never cached cross-origin.
const CDN_ALLOW = new Set([
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js",
]);

// Same-origin paths that are safe to cache: Vite build output and static
// icons. NOT pricing.json (store config, fetched with cache:"no-store"),
// NOT /.netlify/functions/* (API), NOT anything else.
const STATIC_EXT = /\.(?:js|css|woff2?|ttf|otf|png|jpe?g|gif|svg|webp|ico)$/i;

const isCacheableRequest = (req, url) => {
  if (req.method !== "GET") return false;
  // Respect an explicit no-store/reload from the app (pricing.json uses it).
  if (req.cache === "no-store" || req.cache === "reload") return false;
  // Never cache a request that carries credentials of any kind.
  if (req.headers.has("authorization")) return false;

  if (url.origin === self.location.origin) {
    if (url.pathname.startsWith("/.netlify/")) return false;   // API
    if (url.pathname === "/pricing.json") return false;         // store config
    if (url.search) return false;                               // no tokenised URLs
    if (CORE.includes(url.pathname)) return true;
    if (url.pathname.startsWith("/assets/")) return true;       // Vite output
    return STATIC_EXT.test(url.pathname);
  }

  // Cross-origin: the pin list only. Supabase (REST, Storage, Realtime,
  // signed URLs) is deliberately absent and must stay absent.
  return CDN_ALLOW.has(url.origin + url.pathname);
};

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Individually, so one 404 can't abort the whole install.
    await Promise.all(CORE.map((u) => cache.add(u).catch(() => {})));
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => (k === CACHE ? null : caches.delete(k))));
    await self.clients.claim();
  })());
});

// Sign-out hook: the app posts { type: "CLEAR_CACHES" } when an admin signs
// out or staff switch users, so nothing survives a handover. Caches only
// hold build output now, but this stays as a belt-and-braces guarantee and
// as the thing the logout test asserts.
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "CLEAR_CACHES") {
    event.waitUntil((async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      const cache = await caches.open(CACHE);
      await Promise.all(CORE.map((u) => cache.add(u).catch(() => {})));
      event.source && event.source.postMessage({ type: "CACHES_CLEARED" });
    })());
  }
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  let url;
  try { url = new URL(req.url); } catch { return; }

  // The service worker itself is always network.
  if (url.origin === self.location.origin && url.pathname === "/sw.js") return;

  // Navigations: network-first so a deploy is picked up immediately, with the
  // cached shell as the offline fallback. Only the shell is ever stored.
  if (req.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        if (fresh && fresh.ok) {
          const shell = url.pathname.startsWith("/upload") ? "/upload.html" : "/index.html";
          const clone = fresh.clone();
          caches.open(CACHE).then((c) => c.put(shell, clone)).catch(() => {});
        }
        return fresh;
      } catch {
        const shell = url.pathname.startsWith("/upload") ? "/upload.html" : "/index.html";
        return (await caches.match(shell)) || Response.error();
      }
    })());
    return;
  }

  // Anything not on the allowlist: do not intercept at all. No cache read,
  // no cache write. This is the branch every API call and every customer
  // file response takes.
  if (!isCacheableRequest(req, url)) return;

  // Allowlisted static asset: cache-first, revalidate in the background.
  event.respondWith((async () => {
    const cached = await caches.match(req, { cacheName: CACHE });
    const network = fetch(req)
      .then((res) => {
        if (res && res.ok && res.type !== "opaque") {
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put(req, clone)).catch(() => {});
        }
        return res;
      })
      .catch(() => null);
    if (cached) return cached;
    return (await network) || new Response("", { status: 504, statusText: "Gateway Timeout" });
  })());
});
