// Security contract for the service worker. These tests dispatch events at
// the REAL fetch listener in public/sw.js and assert on what actually lands
// in the cache — not on helper predicates the listener might never consult.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadSW, mkReq, mkRes, ORIGIN, SB, SW_SOURCE } from "./sw-harness.mjs";

const CACHE = "print-app-v15";
const ASSETS = ["/assets/index-ftBg9V1i.js", "/assets/index-BYRfnAj8.css"];
const nav = (url, o = {}) => mkReq(url, { ...o, mode: "navigate" });

// ── P1 regression: the navigation branch used to run before the sensitivity
// gate, storing any navigated body under /index.html. ──────────────────────

test("P1: navigating to /pricing.json neither intercepts nor poisons the shell", async () => {
  const sw = await loadSW({ assets: ASSETS, fetchImpl: async () => mkRes({ contentType: "application/json", body: "PRICING" }) });
  const { intercepted } = await sw.dispatchFetch(nav(ORIGIN + "/pricing.json"));
  await sw.settle();
  assert.equal(intercepted, false, "must hand off to the browser entirely");
  assert.equal(sw.caches.keysOf(CACHE).includes("/index.html"), false, "shell must not be written");
  assert.deepEqual(sw.caches.keysOf(CACHE), [], "nothing cached at all");
});

test("P1: navigating to a Netlify function does not poison the shell", async () => {
  const sw = await loadSW({ assets: ASSETS, fetchImpl: async () => mkRes({ body: "FN OUTPUT" }) });
  const { intercepted } = await sw.dispatchFetch(nav(ORIGIN + "/.netlify/functions/get-download-url"));
  await sw.settle();
  assert.equal(intercepted, false);
  assert.deepEqual(sw.caches.keysOf(CACHE), []);
});

test("P1: /uploads-evil is not treated as the upload shell (exact routes, not startsWith)", async () => {
  const sw = await loadSW({ assets: ASSETS, fetchImpl: async () => mkRes({ body: "EVIL" }) });
  const { intercepted } = await sw.dispatchFetch(nav(ORIGIN + "/uploads-evil"));
  await sw.settle();
  assert.equal(intercepted, false, "unknown route must not be intercepted");
  assert.equal(sw.caches.keysOf(CACHE).includes("/upload.html"), false);
});

test("P1: a tokenised navigation is refused before the shell is touched", async () => {
  const sw = await loadSW({ assets: ASSETS, fetchImpl: async () => mkRes() });
  const { intercepted } = await sw.dispatchFetch(nav(ORIGIN + "/?access_token=secret"));
  await sw.settle();
  assert.equal(intercepted, false);
  assert.deepEqual(sw.caches.keysOf(CACHE), []);
});

test("legitimate navigations DO cache, under the exact mapped shell", async () => {
  for (const [path, shell] of [["/", "/index.html"], ["/index.html", "/index.html"], ["/upload", "/upload.html"], ["/upload.html", "/upload.html"]]) {
    const sw = await loadSW({ assets: ASSETS, fetchImpl: async () => mkRes({ body: "SHELL " + path }) });
    const { intercepted } = await sw.dispatchFetch(nav(ORIGIN + path));
    await sw.settle();
    assert.equal(intercepted, true, path);
    assert.deepEqual(sw.caches.keysOf(CACHE), [shell], `${path} -> ${shell}`);
  }
});

test("a navigation response is validated before it becomes the shell", async () => {
  const cases = [
    ["non-HTML content-type", { contentType: "application/json" }],
    ["a redirect", { redirected: true }],
    ["an opaque/cross-origin response", { type: "opaque" }],
    ["a 404", { ok: false, status: 404 }],
    ["a 500", { ok: false, status: 500 }],
  ];
  for (const [label, res] of cases) {
    const sw = await loadSW({ assets: ASSETS, fetchImpl: async () => mkRes(res) });
    await sw.dispatchFetch(nav(ORIGIN + "/"));
    await sw.settle();
    assert.deepEqual(sw.caches.keysOf(CACHE), [], `${label} must not be stored as the shell`);
  }
});

test("offline navigation falls back to the cached shell only", async () => {
  const sw = await loadSW({ assets: ASSETS, fetchImpl: async () => { throw new Error("offline"); } });
  sw.caches.seed(CACHE, "/index.html", { body: "CACHED SHELL" });
  const { intercepted, response } = await sw.dispatchFetch(nav(ORIGIN + "/"));
  assert.equal(intercepted, true);
  assert.equal(response.body, "CACHED SHELL");
});

// ── Sensitive traffic is never touched, in any mode ─────────────────────────

test("NEVER caches Supabase REST, Storage, signed URLs, auth or realtime", async () => {
  for (const u of [
    `${SB}/rest/v1/orders?select=*`,
    `${SB}/rest/v1/pending_jobs?select=*`,
    `${SB}/storage/v1/object/sign/customer-uploads/2026-09-10/abc-resume.pdf`,
    `${SB}/storage/v1/object/customer-uploads/2026-09-10/abc-resume.pdf?token=eyJhbGciOi`,
    `${SB}/auth/v1/token?grant_type=password`,
    `${SB}/realtime/v1/websocket`,
  ]) {
    const sw = await loadSW({ assets: ASSETS, fetchImpl: async () => mkRes({ body: "SENSITIVE" }) });
    const { intercepted } = await sw.dispatchFetch(mkReq(u));
    await sw.settle();
    assert.equal(intercepted, false, u);
    assert.deepEqual(sw.caches.keysOf(CACHE), [], u);
  }
});

test("never caches non-GET, credentialed, or no-store requests", async () => {
  const cases = [
    ["POST", { method: "POST" }],
    ["Authorization header", { headers: { authorization: "Bearer t" } }],
    ["cache: no-store", { cache: "no-store" }],
    ["cache: reload", { cache: "reload" }],
  ];
  for (const [label, o] of cases) {
    const sw = await loadSW({ assets: ASSETS, fetchImpl: async () => mkRes() });
    const { intercepted } = await sw.dispatchFetch(mkReq(ORIGIN + ASSETS[0], o));
    await sw.settle();
    assert.equal(intercepted, false, label);
  }
});

// ── P5: the allowlist is enumerated, not a pattern ──────────────────────────

test("P5: only ENUMERATED build assets are cacheable", async () => {
  const sw = await loadSW({ assets: ASSETS, fetchImpl: async () => mkRes({ contentType: "application/javascript" }) });
  const hit = await sw.dispatchFetch(mkReq(ORIGIN + ASSETS[0]));
  assert.equal(hit.intercepted, true, "an enumerated asset is served");

  // Same directory, same extension, NOT in the manifest.
  const miss = await sw.dispatchFetch(mkReq(ORIGIN + "/assets/not-in-manifest.js"));
  await sw.settle();
  assert.equal(miss.intercepted, false, "a pattern would have matched this; an enumeration does not");
  assert.equal(sw.caches.keysOf(CACHE).includes(ORIGIN + "/assets/not-in-manifest.js"), false);
});

test("P5: an arbitrary same-origin static file is no longer cacheable", async () => {
  const sw = await loadSW({ assets: ASSETS, fetchImpl: async () => mkRes() });
  for (const u of ["/random.png", "/vendor/thing.css", "/deep/nested/x.woff2", "/pricing.json"]) {
    const { intercepted } = await sw.dispatchFetch(mkReq(ORIGIN + u));
    assert.equal(intercepted, false, u);
  }
});

test("P5: cross-origin is refused except exact pinned URLs, query included", async () => {
  const sw = await loadSW({ assets: ASSETS, fetchImpl: async () => mkRes({ contentType: "application/javascript" }) });
  const pinned = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
  assert.equal((await sw.dispatchFetch(mkReq(pinned))).intercepted, true, "exact pin");
  for (const u of [
    pinned + "?v=2",                                                             // query makes it a different URL
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.0/pdf.min.js",            // unpinned version
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/../../evil.js",      // traversal
    "https://evil.example/x.js",
  ]) assert.equal((await sw.dispatchFetch(mkReq(u))).intercepted, false, u);
});

// ── P5: cache deletion is scoped to this app's family ───────────────────────

test("P5: activate() purges only OUR old caches, never a neighbour's", async () => {
  const sw = await loadSW({ assets: ASSETS });
  sw.caches.seed("print-app-v14", "/index.html", { body: "STALE CUSTOMER FILE" });
  sw.caches.seed("print-app-v13", "/x", { body: "older" });
  sw.caches.seed("some-other-app-v1", "/keep", { body: "not ours" });
  sw.caches.seed(CACHE, "/index.html", { body: "current" });
  await sw.dispatchActivate();
  const remaining = await sw.caches.keys();
  assert.equal(remaining.includes("print-app-v14"), false, "the pre-audit cache is purged");
  assert.equal(remaining.includes("print-app-v13"), false);
  assert.equal(remaining.includes("some-other-app-v1"), true, "another app's cache is untouched");
  assert.equal(remaining.includes(CACHE), true);
});

test("the cache name is bumped past the pre-audit cache", () => {
  assert.match(SW_SOURCE, /const CACHE = CACHE_PREFIX \+ "v15"/);
  assert.equal(SW_SOURCE.includes('"print-app-v14"'), false);
});

test("the rev 1 false invariant is gone from the CODE (comments may cite it)", () => {
  // Strip comments first: the header deliberately quotes the old bug when
  // explaining it, and that prose must not satisfy or fail this check.
  const code = SW_SOURCE
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
  assert.equal(/Only the shell is ever stored/.test(code), false);
  assert.equal(/startsWith\(\s*["']\/upload/.test(code), false, "exact route map, not a prefix");
  assert.match(code, /SHELL_ROUTES\s*=\s*new Map/, "routes are an exact map");
  assert.match(code, /SHELL_ROUTES\.get\(url\.pathname\)/, "and the listener uses it");
});

// ── Build integration: the marker is actually filled in at deploy time ──────

test("the deploy step enumerates real hashed assets into dist/sw.js", () => {
  const dist = fileURLToPath(new URL("../../dist/sw.js", import.meta.url));
  if (!existsSync(dist)) return; // build not run in this environment
  const built = readFileSync(dist, "utf8");
  assert.equal(built.includes("/*__BUILD_ASSETS__*/"), false, "marker must be replaced");
  assert.match(built, /const BUILD_ASSETS = \[[\s\S]*?"\/assets\/[^"]+\.js"/, "real hashed assets present");
});

test("yarn test gates the Netlify deploy", () => {
  const toml = readFileSync(fileURLToPath(new URL("../../netlify.toml", import.meta.url)), "utf8");
  const cmd = toml.match(/^\s*command = "(.+)"$/m)[1];
  assert.match(cmd, /yarn test/, "no test had ever gated a deploy before this");
  assert.ok(cmd.indexOf("yarn test") < cmd.indexOf("yarn build"), "tests run before the build");
  assert.match(cmd, /inject-sw-manifest/);
});
