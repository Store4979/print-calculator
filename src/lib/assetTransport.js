// src/lib/assetTransport.js — THE reviewed transport for static assets: the
// bundled store logo (order PDFs, trade-order PDFs) and the bundled
// pricing.json fallback. Review of d01b74a, N1.
//
// WHY IT EXISTS: the logo used to be fetched from whatever the store profile's
// logo_url held, and the inventory saw only "ensureLogoPdfDataUrl:fetch:dynamic".
// A value in a database row is not a destination policy. Here the policy runs
// BEFORE any request, and the only requests this module can make go to two
// fixed, same-origin, bundled paths.
//
// WHAT IS ENFORCED, AND WHERE:
//  - The two fetch sites below take only the constants BUNDLED_LOGO and
//    BUNDLED_PRICING, with a literal options object: method "GET",
//    credentials "omit", redirect "error". The inventory scanner rejects any
//    other URL shape, any other option, a missing option or a body
//    (scripts/tests/inventory-check.mjs, the asset-transport rule; mutants in
//    release2-inventory.mutation.test.js).
//  - logoSourcePolicy() decides what a store-profile logo value may be:
//    exactly the bundled logo path, or a base64 data:image URL of PNG, JPEG,
//    WebP or SVG. Everything else is refused: other paths, other origins,
//    protocol-relative URLs, any other data: type, and every
//    /.netlify/functions/ route. A data URL is used as-is, with no request. A
//    refused value is never requested; the bundled logo is used instead
//    (scripts/tests/asset-transport.test.js).
//  - The code needs no remote logos: nothing in the app writes a logo URL
//    (publishStoreConfig writes back the value it loaded, which defaults to
//    the bundled path). So no remote origin is allowed.
//
// A redirect makes fetch() reject (redirect "error"), and the caller then
// has no logo. credentials "omit" means no cookie or HTTP auth goes with
// either request.

const BUNDLED_LOGO = "/ups-logo.png";
const BUNDLED_PRICING = "/pricing.json";
export { BUNDLED_LOGO, BUNDLED_PRICING };

const IMAGE_TYPE = /^image\/(png|jpeg|webp|svg\+xml)$/;
const DATA_IMAGE = /^data:image\/(png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/]+={0,2}$/;

/** What a store-profile logo value may be. Never throws; never requests. */
export function logoSourcePolicy(value) {
  if (value === BUNDLED_LOGO) return { ok: true, kind: "bundled", reason: null };
  if (typeof value !== "string" || value === "") return { ok: false, kind: null, reason: "not a non-empty string" };
  if (/\/\.netlify\/functions(\/|$)/i.test(decodeSafe(value))) {
    return { ok: false, kind: null, reason: "a Netlify function route is never an asset" };
  }
  if (DATA_IMAGE.test(value)) return { ok: true, kind: "data", reason: null };
  return { ok: false, kind: null, reason: "only the bundled logo or a base64 data:image (png, jpeg, webp, svg+xml) is allowed" };
}

function decodeSafe(s) {
  try { return decodeURIComponent(s); } catch { return s; }
}

async function blobToDataUrl(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${blob.type};base64,${btoa(bin)}`;
}

async function fetchBundledLogo() {
  return fetch(BUNDLED_LOGO, { method: "GET", credentials: "omit", redirect: "error", cache: "no-store" });
}

async function fetchBundledPricing() {
  return fetch(BUNDLED_PRICING, { method: "GET", credentials: "omit", redirect: "error", cache: "no-store" });
}

/**
 * The logo as a data: URL for jsPDF, or null. `value` is the store profile's
 * logo. A data:image value is returned unchanged with no request. The bundled
 * path, or any refused value, loads the bundled logo.
 */
export async function loadLogoDataUrl(value = BUNDLED_LOGO) {
  const policy = logoSourcePolicy(value);
  if (policy.kind === "data") return value;
  if (!policy.ok) console.warn("[assets] store logo refused before any request:", policy.reason);
  try {
    const res = await fetchBundledLogo();
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!IMAGE_TYPE.test(blob.type)) return null;
    return await blobToDataUrl(blob);
  } catch {
    return null;
  }
}

/** The bundled pricing.json, parsed. Throws on a non-2xx or unparseable body. */
export async function loadBundledPricing() {
  const res = await fetchBundledPricing();
  if (!res.ok) throw new Error(`pricing.json: HTTP ${res.status}`);
  return res.json();
}
