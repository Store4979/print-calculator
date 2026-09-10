// Security: the service worker must never store an API response or a
// customer file. It runs as a classic script, so the test evaluates the
// real public/sw.js in a stubbed worker scope and drives its allowlist.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const SRC = readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8");

const load = () => {
  const listeners = {};
  const ctx = vm.createContext({
    self: {
      addEventListener: (k, fn) => { listeners[k] = fn; },
      location: { origin: "https://printcalculator2.netlify.app" },
      skipWaiting: () => {},
      clients: { claim: async () => {} },
    },
    caches: { open: async () => ({ add: async () => {}, put: async () => {} }), keys: async () => [], delete: async () => true, match: async () => undefined },
    fetch: async () => ({ ok: true, clone: () => ({}) }),
    Response: class { constructor(b, i) { Object.assign(this, i); } static error() { return { error: true }; } },
    URL, console,
  });
  // Reach into the script's lexical scope without altering the shipped file.
  vm.runInContext(SRC + "\n;globalThis.__t = { isCacheableRequest, CACHE, CDN_ALLOW, CORE };", ctx);
  return { ...ctx.__t, listeners };
};

const req = (url, o = {}) => [
  { method: o.method || "GET", cache: o.cache || "default", headers: { has: (h) => !!(o.headers || {})[h] } },
  new URL(url),
];

const ORIGIN = "https://printcalculator2.netlify.app";
const SB = "https://gmxyisjjaxtpycsmmzef.supabase.co";

test("caches the app shell and Vite build output", () => {
  const { isCacheableRequest: c } = load();
  for (const u of ["/", "/index.html", "/upload.html", "/assets/index-abc123.js", "/assets/index-abc123.css", "/icon-192.png"])
    assert.equal(c(...req(ORIGIN + u)), true, u);
});

test("NEVER caches a Supabase API, Storage or signed-URL response", () => {
  const { isCacheableRequest: c } = load();
  for (const u of [
    `${SB}/rest/v1/orders?select=*`,
    `${SB}/rest/v1/pending_jobs?select=*`,
    `${SB}/storage/v1/object/sign/customer-uploads/2026-09-10/abc-resume.pdf`,
    `${SB}/storage/v1/object/customer-uploads/2026-09-10/abc-resume.pdf?token=eyJhbGciOi`,
    `${SB}/auth/v1/token?grant_type=password`,
    `${SB}/realtime/v1/websocket`,
  ]) assert.equal(c(...req(u)), false, u);
});

test("NEVER caches a Netlify function response", () => {
  const { isCacheableRequest: c } = load();
  for (const u of ["/.netlify/functions/get-download-url", "/.netlify/functions/register-job", "/.netlify/functions/send-print-job"])
    assert.equal(c(...req(ORIGIN + u)), false, u);
});

test("never caches non-GET, credentialed, no-store, or tokenised requests", () => {
  const { isCacheableRequest: c } = load();
  assert.equal(c(...req(ORIGIN + "/assets/x.js", { method: "POST" })), false);
  assert.equal(c(...req(ORIGIN + "/assets/x.js", { headers: { authorization: "Bearer t" } })), false);
  assert.equal(c(...req(ORIGIN + "/pricing.json", { cache: "no-store" })), false);
  assert.equal(c(...req(ORIGIN + "/pricing.json")), false, "store config is never cached");
  assert.equal(c(...req(ORIGIN + "/assets/x.js?token=secret")), false, "query strings are refused");
});

test("cross-origin is refused except the exact pinned library URLs", () => {
  const { isCacheableRequest: c, CDN_ALLOW } = load();
  for (const u of CDN_ALLOW) assert.equal(c(...req(u)), true, u);
  assert.equal(c(...req("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.0/pdf.min.js")), false, "unpinned version");
  assert.equal(c(...req("https://evil.example/x.js")), false);
});

test("the cache name is bumped so activate() purges the pre-audit cache", () => {
  const { CACHE } = load();
  assert.notEqual(CACHE, "print-app-v14", "v14 may hold cached customer file responses");
  assert.match(CACHE, /^print-app-v\d+$/);
});

test("a CLEAR_CACHES message handler exists for sign-out", () => {
  const { listeners } = load();
  assert.ok(listeners.message, "sign-out must be able to purge caches");
  assert.match(SRC, /CLEAR_CACHES/);
});
