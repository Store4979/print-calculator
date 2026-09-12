// netlify/lib/release2.js — shared core for the Release 2 endpoints.
//
// ── WHY A KILL SWITCH EXISTS BEFORE ANY ENDPOINT DOES ──────────────────────
// Release 2 step 3 deploys the new endpoints "dark", meaning no client calls
// them. Dark does NOT mean unreachable: Netlify serves every file in
// netlify/functions/ as a live URL on every deploy, including deploy previews.
//
// And deploy previews of the PRODUCTION site run against PRODUCTION Supabase
// with the production service-role key (docs/security/release-2-plan.md, and
// it is why staging exists at all). Both sites now build this PR. So merely
// pushing an endpoint would put a service-role-backed URL in front of
// production — which violates "production stays untouched for the whole of
// Release 2" without anyone doing anything wrong.
//
// TWO INDEPENDENT CONDITIONS, both required, fail-closed:
//
//   1. RELEASE2_ENABLED must be exactly "true". Absent or anything else →
//      refuse. Staging sets it; production and its previews do not. A flag
//      alone is not enough, because a flag can be set by mistake.
//   2. The project the function would actually talk to must NOT be the
//      production ref. This does not depend on remembering anything: even
//      with the flag set, an endpoint pointed at production refuses.
//
// Condition 2 is the one that matters. Condition 1 is what keeps the surface
// closed everywhere it has not been deliberately opened.
//
// This whole module is removed, not merely flipped, when Release 2 reaches
// production for real — at which point the endpoints are the supported path
// and a staging-only guard would be a lie. Until then it is load-bearing.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const PRODUCTION_REF = "gmxyisjjaxtpycsmmzef";

/** https://<ref>.supabase.co → <ref>; "" when unparseable. */
export function projectRefFromUrl(url) {
  const m = /^https:\/\/([a-z0-9]+)\.supabase\.(co|in)(\/|$)/i.exec(String(url || "").trim());
  return m ? m[1].toLowerCase() : "";
}

/**
 * Is this deployment allowed to run Release 2 endpoints at all?
 * Returns { ok, status, reason } — never throws, so a handler cannot
 * accidentally treat an error as permission.
 */
export function release2Allowed(env = process.env) {
  const flag = String(env.RELEASE2_ENABLED || "").trim();
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL || "";
  const ref = projectRefFromUrl(url);

  // Order matters for the message, not for the outcome: both must pass.
  if (ref === PRODUCTION_REF) {
    return {
      ok: false,
      status: 404,
      reason:
        "Release 2 endpoints refuse to run against the production project. " +
        "This is not configurable by an environment variable.",
    };
  }
  if (!ref) {
    return { ok: false, status: 503, reason: "SUPABASE_URL is missing or not a Supabase project URL." };
  }
  if (flag !== "true") {
    return {
      ok: false,
      status: 404,
      reason: "Release 2 endpoints are not enabled on this deployment (RELEASE2_ENABLED !== 'true').",
    };
  }
  return { ok: true, status: 200, reason: `enabled for project ${ref}` };
}

// ── Responses ───────────────────────────────────────────────────────────────
// 404 rather than 403 for a disabled deployment: a disabled endpoint should be
// indistinguishable from one that does not exist, so probing cannot map which
// deployments have Release 2 code on them.
export const json = (statusCode, obj, extraHeaders = {}) => ({
  statusCode,
  headers: { "content-type": "application/json", "cache-control": "no-store", ...extraHeaders },
  body: JSON.stringify(obj),
});
export const notFound = () => json(404, { ok: false, error: "Not Found" });

/** Uniform auth failure. Same status, same body, whatever actually went wrong. */
export const authFailed = () => json(401, { ok: false, error: "Unauthorized" });

// ── Tokens ──────────────────────────────────────────────────────────────────
// The token is returned to the caller ONCE and never stored. Only sha256 of it
// is persisted, so a dump of these tables authenticates as nobody.
export const mintToken = () => randomBytes(32).toString("base64url");
export const hashToken = (token) => createHash("sha256").update(String(token), "utf8").digest();
export const mintCsrfSecret = () => randomBytes(32);

/** Constant-time compare of two Buffers/strings. False on any length mismatch. */
export function safeEqual(a, b) {
  const ba = Buffer.isBuffer(a) ? a : Buffer.from(String(a ?? ""), "utf8");
  const bb = Buffer.isBuffer(b) ? b : Buffer.from(String(b ?? ""), "utf8");
  if (ba.length !== bb.length || ba.length === 0) return false;
  return timingSafeEqual(ba, bb);
}

// ── Origin / content-type discipline ────────────────────────────────────────
// Applies to EVERY mutating endpoint, and specifically to the two that install
// a credential via Set-Cookie (enroll-redeem, upload-capability-create). Those
// require no cookie of their own, so a cross-site POST reaches them — and the
// response would plant the attacker's credential in the victim's browser.
// "No cookie in, no CSRF" only ever applied to the credential going IN.
export function allowedOrigins(env = process.env) {
  const raw = String(env.RELEASE2_ALLOWED_ORIGINS || "").trim();
  return raw ? raw.split(",").map((s) => s.trim()).filter(Boolean) : [];
}

export function originOk(event, env = process.env) {
  const list = allowedOrigins(env);
  const origin = event?.headers?.origin || event?.headers?.Origin || "";
  const site = String(env.URL || env.DEPLOY_PRIME_URL || "").trim();
  // No Origin header at all: not a browser form post, so not the CSRF shape
  // this guards. Still requires JSON below.
  if (!origin) return true;
  if (site && origin === site) return true;
  return list.includes(origin);
}

/** JSON content type required and enforced — blocks the form-POST shape. */
export function contentTypeOk(event) {
  const ct = String(event?.headers?.["content-type"] || event?.headers?.["Content-Type"] || "");
  return /^application\/json\b/i.test(ct.trim());
}

/**
 * One gate for every Release 2 endpoint. Call it first, return its response if
 * it produces one. Never returns a reason to the caller — reasons are logged.
 */
export function gate(event, { method = "POST", requireJson = true, env = process.env } = {}) {
  const allowed = release2Allowed(env);
  if (!allowed.ok) {
    console.warn("[release2] refused:", allowed.reason);
    return allowed.status === 503
      ? json(503, { ok: false, error: "Service Unavailable" })
      : notFound();
  }
  if (event?.httpMethod !== method) return json(405, { ok: false, error: "Method Not Allowed" });
  if (!originOk(event, env)) {
    console.warn("[release2] origin rejected:", event?.headers?.origin);
    return json(403, { ok: false, error: "Forbidden" });
  }
  if (requireJson && !contentTypeOk(event)) {
    return json(415, { ok: false, error: "Unsupported Media Type" });
  }
  return null;
}

/** Host-only cookie. __Host- requires Secure, Path=/ and NO Domain. */
export function setHostCookie(name, value, maxAgeSeconds) {
  if (!/^__Host-/.test(name)) throw new Error("Release 2 cookies must use the __Host- prefix");
  return [
    `${name}=${value}`,
    "HttpOnly",
    "Secure",
    "SameSite=Strict",
    "Path=/",
    `Max-Age=${Math.floor(maxAgeSeconds)}`,
  ].join("; ");
}

export function readCookie(event, name) {
  const raw = String(event?.headers?.cookie || event?.headers?.Cookie || "");
  for (const part of raw.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return rest.join("=");
  }
  return "";
}
