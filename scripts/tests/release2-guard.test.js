// scripts/tests/release2-guard.test.js
// The kill switch that keeps step-3 endpoints away from production.
//
// The failure this prevents is structural, not a mistake anyone makes:
// Netlify serves every file in netlify/functions/ as a live URL on every
// deploy, and deploy previews of the PRODUCTION site run against PRODUCTION
// Supabase with the production service-role key. Both sites build this PR. So
// pushing an endpoint puts a service-role URL in front of production unless
// something refuses — and "deployed dark" only means no client calls it.
import test from "node:test";
import assert from "node:assert/strict";

import {
  release2Allowed,
  projectRefFromUrl,
  gate,
  originOk,
  contentTypeOk,
  safeEqual,
  mintToken,
  hashToken,
  setHostCookie,
  readCookie,
  PRODUCTION_REF,
} from "../../netlify/lib/release2.js";

const STAGING_REF = "lboajqihpsfrokqvjgnl";
const PROD_URL = `https://${PRODUCTION_REF}.supabase.co`;
const STAGING_URL = `https://${STAGING_REF}.supabase.co`;

const ev = (over = {}) => ({
  httpMethod: "POST",
  headers: { "content-type": "application/json" },
  ...over,
});

test("projectRefFromUrl", () => {
  assert.equal(projectRefFromUrl(PROD_URL), PRODUCTION_REF);
  assert.equal(projectRefFromUrl(`${STAGING_URL}/rest/v1`), STAGING_REF);
  assert.equal(projectRefFromUrl("https://evil.example.com"), "");
  assert.equal(projectRefFromUrl(undefined), "");
});

test("THE HAZARD: production project is refused even WITH the flag set", () => {
  // This is the condition that does not depend on remembering anything.
  const r = release2Allowed({ RELEASE2_ENABLED: "true", SUPABASE_URL: PROD_URL });
  assert.equal(r.ok, false);
  assert.equal(r.status, 404);
  assert.match(r.reason, /refuse to run against the production project/);
  assert.match(r.reason, /not configurable by an environment variable/);
});

test("production preview shape — flag absent AND production URL — refused", () => {
  const r = release2Allowed({ SUPABASE_URL: PROD_URL });
  assert.equal(r.ok, false);
  assert.equal(r.status, 404);
});

test("staging project WITHOUT the flag is refused (fail-closed)", () => {
  const r = release2Allowed({ SUPABASE_URL: STAGING_URL });
  assert.equal(r.ok, false);
  assert.equal(r.status, 404);
  assert.match(r.reason, /not enabled on this deployment/);
});

test("flag must be exactly 'true'", () => {
  for (const v of ["TRUE", "1", "yes", "true ", " true", "", "false"]) {
    const r = release2Allowed({ RELEASE2_ENABLED: v, SUPABASE_URL: STAGING_URL });
    // " true" and "true " trim to "true" and are accepted; the rest are not.
    const expected = v.trim() === "true";
    assert.equal(r.ok, expected, `flag ${JSON.stringify(v)}`);
  }
});

test("missing SUPABASE_URL is 503, not a silent pass", () => {
  const r = release2Allowed({ RELEASE2_ENABLED: "true" });
  assert.equal(r.ok, false);
  assert.equal(r.status, 503);
});

test("staging project WITH the flag is allowed", () => {
  const r = release2Allowed({ RELEASE2_ENABLED: "true", SUPABASE_URL: STAGING_URL });
  assert.equal(r.ok, true);
  assert.match(r.reason, new RegExp(STAGING_REF));
});

test("a disabled deployment answers 404, indistinguishable from absent", () => {
  // So probing cannot map which deployments carry Release 2 code.
  const res = gate(ev(), { env: { SUPABASE_URL: PROD_URL } });
  assert.equal(res.statusCode, 404);
  assert.equal(JSON.parse(res.body).error, "Not Found");
  assert.doesNotMatch(res.body, /production/i, "the refusal must not explain itself to the caller");
  assert.doesNotMatch(res.body, /RELEASE2/i);
});

test("gate: method, origin and content-type, in that order", () => {
  const env = { RELEASE2_ENABLED: "true", SUPABASE_URL: STAGING_URL, URL: "https://site.example" };
  assert.equal(gate(ev({ httpMethod: "GET" }), { env }).statusCode, 405);
  assert.equal(
    gate(ev({ headers: { "content-type": "application/json", origin: "https://evil.example" } }), { env })
      .statusCode,
    403
  );
  assert.equal(
    gate(ev({ headers: { "content-type": "application/x-www-form-urlencoded" } }), { env }).statusCode,
    415
  );
  assert.equal(gate(ev(), { env }), null, "a good request passes the gate");
});

test("credential-installing endpoints: the form-POST shape is blocked", () => {
  // enroll-redeem and upload-capability-create respond with Set-Cookie and
  // require no cookie, so a cross-site form POST would plant the attacker's
  // credential in the victim's browser. A JSON requirement forces a preflight
  // that the origin allowlist then fails.
  assert.equal(contentTypeOk(ev({ headers: { "content-type": "text/plain" } })), false);
  assert.equal(contentTypeOk(ev({ headers: { "content-type": "multipart/form-data" } })), false);
  assert.equal(contentTypeOk(ev({ headers: { "content-type": "application/json; charset=utf-8" } })), true);
});

test("origin: same-site allowed, listed allowed, anything else refused", () => {
  const env = {
    URL: "https://site.example",
    RELEASE2_ALLOWED_ORIGINS: "https://a.example, https://b.example",
  };
  assert.equal(originOk(ev({ headers: { origin: "https://site.example" } }), env), true);
  assert.equal(originOk(ev({ headers: { origin: "https://a.example" } }), env), true);
  assert.equal(originOk(ev({ headers: { origin: "https://evil.example" } }), env), false);
  assert.equal(originOk(ev({ headers: {} }), env), true, "no Origin: not the CSRF shape");
});

test("tokens: minted once, only the hash is storable, and the hash is not reversible", () => {
  const t = mintToken();
  assert.match(t, /^[A-Za-z0-9_-]{43}$/, "32 bytes base64url");
  const h = hashToken(t);
  assert.equal(h.length, 32);
  assert.notEqual(h.toString("hex"), Buffer.from(t).toString("hex"));
  assert.deepEqual(hashToken(t), h, "stable");
  assert.notDeepEqual(hashToken(mintToken()), h, "distinct per token");
});

test("safeEqual: length mismatch and empty are false, never throws", () => {
  assert.equal(safeEqual("abc", "abc"), true);
  assert.equal(safeEqual("abc", "abd"), false);
  assert.equal(safeEqual("abc", "ab"), false);
  assert.equal(safeEqual("", ""), false, "empty must not compare equal");
  assert.equal(safeEqual(undefined, undefined), false);
  assert.equal(safeEqual(Buffer.from("xy"), Buffer.from("xy")), true);
});

test("cookies are host-only by construction", () => {
  const c = setHostCookie("__Host-pc_device", "abc", 43200);
  for (const bit of ["HttpOnly", "Secure", "SameSite=Strict", "Path=/", "Max-Age=43200"]) {
    assert.match(c, new RegExp(bit.replace(/[/=]/g, "\\$&")));
  }
  assert.doesNotMatch(c, /Domain=/, "__Host- forbids Domain");
  assert.throws(() => setHostCookie("pc_device", "x", 1), /__Host- prefix/);
});

test("readCookie picks the right cookie out of several", () => {
  const e = ev({ headers: { cookie: "a=1; __Host-pc_staff=tok.en; b=2" } });
  assert.equal(readCookie(e, "__Host-pc_staff"), "tok.en");
  assert.equal(readCookie(e, "missing"), "");
  assert.equal(readCookie(ev(), "__Host-pc_staff"), "");
});
