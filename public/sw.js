/* sw.js — app-shell cache, allowlist-only (rev 2, 2026-09-10)
 *
 * WHY AN ALLOWLIST
 * The pre-audit worker cached any response with res.ok, from any origin, and
 * served it back before revalidating. On a shared counter iPad that is a leak
 * primitive: Supabase signed-URL file responses and REST reads were written to
 * the cache, and a cached copy does not expire when the signature does.
 *
 * WHAT REV 1 GOT WRONG (found in review, fixed here)
 *  1. The navigation branch ran BEFORE the sensitivity check, so a navigation
 *     to ANY same-origin path — /pricing.json, a function URL — had its body
 *     stored under /index.html. That is cache poisoning of the app shell, and
 *     the "only the shell is ever stored" comment asserted an invariant the
 *     code did not hold. Sensitivity is now the FIRST gate, applied to every
 *     request regardless of mode, and shell routes are an exact map.
 *  2. The CLEAR_CACHES reply went to event.source (the Window), while the
 *     caller listened on a transferred MessagePort. The reply never arrived,
 *     so clearAppCaches() always timed out. It now replies on event.ports[0].
 *  3. The asset allowlist was a path prefix plus an extension regex. It is now
 *     an enumerated list: CORE plus the exact build outputs injected at deploy
 *     time by scripts/inject-sw-manifest.mjs, plus exact pinned CDN URLs
 *     including their query string.
 *  4. Cache deletion walked every cache on the origin. It is now scoped to
 *     this app's own CACHE_PREFIX family.
 *
 * Bump CACHE on any change here. activate() deletes every cache in our family
 * whose key !== CACHE, so the bump is also the migration that purges the
 * pre-audit print-app-v14 and anything it holds.
 */
const CACHE_PREFIX = "print-app-";
const CACHE = CACHE_PREFIX + "v15";
const isOurCache = (key) => key.startsWith(CACHE_PREFIX);

// Static, hand-maintained shell files. Everything else cacheable is injected.
const CORE = [
  "/index.html",
  "/upload.html",
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
];

// Replaced at deploy time with the exact hashed Vite outputs, e.g.
// ["/assets/index-C1s9xa2f.js", "/assets/index-8bd0e1.css"].
// If the injection step does not run, this stays empty: the shell still works
// and nothing extra is cached. Degraded, never unsafe.
const BUILD_ASSETS = [/*__BUILD_ASSETS__*/];

// Exact URLs, query string included. A version bump or an added query makes it
// a different, non-allowlisted URL — which is the point.
const CDN_ALLOW = new Set([
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js",
]);

// Exact navigation routes and the shell each one is allowed to store under.
// startsWith("/upload") would also match /uploads-anything; this does not.
const SHELL_ROUTES = new Map([
  ["/", "/index.html"],
  ["/index.html", "/index.html"],
  ["/upload", "/upload.html"],
  ["/upload.html", "/upload.html"],
]);

const fullUrl = (url) => url.origin + url.pathname + url.search;

/* GATE 1 — sensitivity. Applied to EVERY request before anything else,
 * navigations included. True means: do not touch this at all. */
const isSensitiveRequest = (req, url) => {
  if (req.method !== "GET") return true;
  if (req.cache === "no-store" || req.cache === "reload") return true;
  if (req.headers && req.headers.has && req.headers.has("authorization")) return true;

  if (url.origin === self.location.origin) {
    if (url.pathname.startsWith("/.netlify/")) return true;  // functions
    if (url.pathname === "/pricing.json") return true;       // store config
    if (url.search) return true;                             // tokenised URLs
    return false;
  }
  // Cross-origin is sensitive unless it is an exactly pinned library URL.
  // Supabase (REST, Storage, Realtime, signed URLs) can never match.
  return !CDN_ALLOW.has(fullUrl(url));
};

/* GATE 2 — is this an enumerated cacheable asset? */
const isCacheableAsset = (url) => {
  if (url.origin === self.location.origin) {
    return CORE.includes(url.pathname) || BUILD_ASSETS.includes(url.pathname);
  }
  return CDN_ALLOW.has(fullUrl(url));
};

/* Only a same-origin, non-redirected, 200 HTML document may be stored as a
 * shell. Without this, an edge rewrite or an error page becomes the shell. */
const isStorableShell = (res) =>
  !!res && res.ok && res.status === 200 && res.type === "basic" && !res.redirected &&
  /text\/html/i.test(res.headers.get("content-type") || "");

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Individually: one 404 must not abort the whole install.
    await Promise.all([...CORE, ...BUILD_ASSETS].map((u) => cache.add(u).catch(() => {})));
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => isOurCache(k) && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

/* Sign-out / counter handover. The caller (src/lib/swCache.js) transfers a
 * MessagePort and listens on its twin, so the acknowledgement MUST go to
 * event.ports[0]. Replying to event.source posts to the page's global
 * serviceWorker.onmessage instead, which nobody is listening on — that was
 * the rev 1 bug, and it made clearAppCaches() a silent no-op. */
self.addEventListener("message", (event) => {
  if (!event.data || event.data.type !== "CLEAR_CACHES") return;
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(isOurCache).map((k) => caches.delete(k)));
    const cache = await caches.open(CACHE);
    await Promise.all([...CORE, ...BUILD_ASSETS].map((u) => cache.add(u).catch(() => {})));
    const reply = { type: "CACHES_CLEARED" };
    const port = event.ports && event.ports[0];
    if (port) port.postMessage(reply);
    else if (event.source) event.source.postMessage(reply);
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  let url;
  try { url = new URL(req.url); } catch { return; }

  // The worker script itself is always network.
  if (url.origin === self.location.origin && url.pathname === "/sw.js") return;

  // GATE 1 first, for every mode. A sensitive request is never read from
  // cache, never written to cache, and never intercepted.
  if (isSensitiveRequest(req, url)) return;

  if (req.mode === "navigate") {
    const shell = SHELL_ROUTES.get(url.pathname);
    if (!shell) return;                       // unknown route: hands off
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        if (isStorableShell(fresh)) {
          const clone = fresh.clone();
          caches.open(CACHE).then((c) => c.put(shell, clone)).catch(() => {});
        }
        return fresh;
      } catch {
        return (await caches.match(shell, { cacheName: CACHE })) || Response.error();
      }
    })());
    return;
  }

  if (!isCacheableAsset(url)) return;

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
