// scripts/tests/asset-transport.test.js — src/lib/assetTransport.js at RUNTIME
// (review of d01b74a, N1). The inventory scanner proves the transport's two
// fetch sites are GET / credentials omit / redirect error on fixed bundled
// paths; this test proves the logo policy runs BEFORE any request: a store
// logo_url naming a function route, another origin, another path or a
// non-image data: URL is never requested, a data:image is used with no request
// at all, and a redirect or a non-image body yields no logo rather than a
// second request.
import test from "node:test";
import assert from "node:assert/strict";
import {
  logoSourcePolicy, loadLogoDataUrl, loadBundledPricing, BUNDLED_LOGO, BUNDLED_PRICING,
} from "../../src/lib/assetTransport.js";

const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
const EXPECTED_INIT = { method: "GET", credentials: "omit", redirect: "error", cache: "no-store" };

/** Replace global fetch for one test; record every call. */
async function withFetch(impl, fn) {
  const saved = globalThis.fetch;
  const savedWarn = console.warn;
  const calls = [];
  globalThis.fetch = async (url, init) => { calls.push({ url, init }); return impl(url, init); };
  console.warn = () => {};
  try { return await fn(calls); } finally { globalThis.fetch = saved; console.warn = savedWarn; }
}
const pngResponse = () => ({ ok: true, status: 200, blob: async () => new Blob([PNG], { type: "image/png" }) });

test("AT-1 the policy: only the bundled logo or a base64 data:image of png/jpeg/webp/svg", () => {
  assert.deepEqual(logoSourcePolicy(BUNDLED_LOGO), { ok: true, kind: "bundled", reason: null });
  for (const t of ["png", "jpeg", "webp", "svg+xml"]) assert.equal(logoSourcePolicy(`data:image/${t};base64,AAAA`).kind, "data", t);
  const refused = [
    "/.netlify/functions/register-job", "/.NETLIFY/functions/complete-job", "/%2Enetlify/functions/x",
    "%2F.netlify%2Ffunctions%2Fsend-print-job", "https://printcalculator2.netlify.app/.netlify/functions/start-upload",
    "https://evil.example/logo.png", "//evil.example/logo.png", "/ups-logo.png?x=1", "/other.png", "ups-logo.png",
    "data:text/html;base64,PGgxPg==", "data:image/png,rawnotbase64", "data:image/gif;base64,AAAA",
    "javascript:alert(1)", "", null, undefined, 42,
  ];
  for (const v of refused) assert.equal(logoSourcePolicy(v).ok, false, JSON.stringify(v));
  assert.match(logoSourcePolicy("/.netlify/functions/register-job").reason, /Netlify function route/);
  assert.match(logoSourcePolicy("%2F.netlify%2Ffunctions%2Fx").reason, /Netlify function route/, "decoded before the check");
});

test("AT-2 an admin logo_url pointing at a function route is NEVER requested: the one request is the bundled logo, GET/omit/error", async () => {
  for (const hostile of ["/.netlify/functions/register-job", "https://printcalculator2.netlify.app/.netlify/functions/complete-job", "https://evil.example/x.png"]) {
    await withFetch(pngResponse, async (calls) => {
      const out = await loadLogoDataUrl(hostile);
      assert.equal(calls.length, 1, `exactly one request for ${hostile}`);
      assert.equal(calls[0].url, BUNDLED_LOGO, "and it is the bundled logo, not the stored value");
      assert.deepEqual(calls[0].init, EXPECTED_INIT);
      assert.match(out, /^data:image\/png;base64,/);
    });
  }
});

test("AT-3 a data:image logo is used as-is with NO request", async () => {
  await withFetch(pngResponse, async (calls) => {
    const v = "data:image/png;base64,iVBORw0KGgo=";
    assert.equal(await loadLogoDataUrl(v), v);
    assert.equal(calls.length, 0);
  });
});

test("AT-4 a redirect (fetch rejects under redirect:error) or a non-image body yields no logo and no second request", async () => {
  await withFetch(() => { throw new TypeError("Failed to fetch: redirect mode is error"); }, async (calls) => {
    assert.equal(await loadLogoDataUrl(BUNDLED_LOGO), null);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].init.redirect, "error");
  });
  await withFetch(() => ({ ok: true, status: 200, blob: async () => new Blob(["<html>"], { type: "text/html" }) }), async (calls) => {
    assert.equal(await loadLogoDataUrl(BUNDLED_LOGO), null, "an HTML body (a SPA fallback) is not a logo");
    assert.equal(calls.length, 1);
  });
  await withFetch(() => ({ ok: false, status: 404, blob: async () => new Blob([]) }), async (calls) => {
    assert.equal(await loadLogoDataUrl(BUNDLED_LOGO), null);
    assert.equal(calls.length, 1);
  });
});

test("AT-5 pricing: one GET/omit/error request to the bundled path; a non-2xx throws", async () => {
  await withFetch(() => ({ ok: true, status: 200, json: async () => ({ paperTypes: [] }) }), async (calls) => {
    assert.deepEqual(await loadBundledPricing(), { paperTypes: [] });
    assert.deepEqual(calls, [{ url: BUNDLED_PRICING, init: EXPECTED_INIT }]);
  });
  await withFetch(() => ({ ok: false, status: 500 }), async () => {
    await assert.rejects(loadBundledPricing(), /HTTP 500/);
  });
});
