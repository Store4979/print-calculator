// scripts/tests/release2-endpoints.test.js — slice 2 handler contracts.
//
// These assert the properties that are invisible in a happy-path run: that a
// disabled deployment is indistinguishable from an absent one, that failures
// are uniform, and that no response ever carries key material.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { stripComments } from "./source-util.mjs";
import { withRepoDeployContext, validContext } from "./deploy-context-fixture.mjs";

// EVERY source read here is comment-stripped. Three times an assertion in
// this suite matched text that merely QUOTED the thing it was asserting
// about — the old signature in a doesNotMatch, the sw.js startsWith comment,
// and enroll-list's header quoting select("*") while forbidding it. A source
// assertion is about code, so the string it runs against must be code only.
const read = (p) => stripComments(readFileSync(new URL(p, import.meta.url), "utf8"));
const LOGIN = read("../../netlify/functions/staff-login.js");
const REDEEM = read("../../netlify/functions/enroll-redeem.js");
const TICKET = read("../../netlify/functions/enroll-ticket-create.js");
const BOOT = read("../../netlify/functions/csrf-bootstrap.js");
const AUTH = read("../../netlify/lib/release2-auth.js");

const LOGOUT_SRC = read("../../netlify/functions/staff-logout.js");
const REVOKE_ALL_SRC = read("../../netlify/functions/staff-session-revoke-all.js");
const REVOKE_SRC = read("../../netlify/functions/enroll-revoke.js");
const LIST_SRC = read("../../netlify/functions/enroll-list.js");
const ALL = { LOGIN, REDEEM, TICKET, BOOT, LOGOUT: LOGOUT_SRC, REVOKE_ALL: REVOKE_ALL_SRC, REVOKE: REVOKE_SRC, LIST: LIST_SRC };

test("every slice-2 handler passes through gate() before doing anything", () => {
  for (const [name, src] of Object.entries(ALL)) {
    assert.match(src, /const blocked = gate\(event/, `${name} must call gate() first`);
    assert.match(src, /if \(blocked\) return blocked;/, `${name} must honour gate()'s refusal`);
  }
});

test("no handler returns a token, session id or key material on failure", () => {
  for (const [name, src] of Object.entries(ALL)) {
    // Failure paths must go through the shared uniform helpers.
    assert.match(src, /authFailed\(\)|json\(4\d\d/, `${name} has no refusal path`);
    assert.doesNotMatch(src, /error:\s*e\.message/, `${name} leaks an internal message to the caller`);
  }
});

test("staff-login charges BOTH budget levels, before the PIN is examined", () => {
  const enrIdx = LOGIN.indexOf("pinPerEnrollment");
  const storeIdx = LOGIN.indexOf("pinPerStore");
  // Anchor to the CALL, not the identifier: the import on line 14 mentions it
  // long before the call site, so indexOf() on the bare name compares against
  // the wrong position and the test fails on correct code. Same shape as
  // matching a comment that quotes the thing you are asserting about.
  const verifyIdx = LOGIN.indexOf("await findEmployeeByPinDirect(");
  assert.ok(enrIdx > 0, "per-enrollment budget missing");
  assert.ok(storeIdx > 0, "per-store budget missing — k devices would give 5k guesses");
  assert.ok(enrIdx < verifyIdx && storeIdx < verifyIdx,
    "budgets must be charged BEFORE the PIN is checked, or failures go uncounted");
});

test("staff-login fails closed when the limiter itself is unavailable", () => {
  assert.match(LOGIN, /limiter unavailable[\s\S]{0,200}503/,
    "a limiter that cannot run must not let the attempt through");
});

test("staff-login rotates sessions on every sign-in", () => {
  // UPDATED for F-4: rotation moved OUT of the handler into the serialized
  // function, so asserting on the handler's own revoke would now pin the
  // vulnerable shape. The property is unchanged — every sign-in rotates — but
  // the thing that guarantees it is the row lock, not two statements here.
  assert.match(LOGIN, /\.rpc\("release2_create_staff_session"/);
  assert.match(LOGIN, /p_enrollment: device\.enrollmentId/);
});

test("enroll-redeem does the burn and the insert in ONE call, not two", () => {
  assert.match(REDEEM, /\.rpc\("redeem_enrollment_ticket"/,
    "atomicity lives in the function; two round trips reintroduce the window");
  assert.doesNotMatch(REDEEM, /from\("enrollment_tickets"\)[\s\S]{0,200}\.update\(/,
    "the handler must not burn the ticket itself");
  assert.doesNotMatch(REDEEM, /from\("device_enrollments"\)[\s\S]{0,200}\.insert\(/,
    "the handler must not insert the enrollment itself");
});

test("enroll-redeem answers replay, expiry and revocation identically", () => {
  assert.match(REDEEM, /28000/);
  assert.match(REDEEM, /return authFailed\(\)/);
});

test("enroll-ticket-create is OWNER only", () => {
  assert.match(TICKET, /\.eq\("role", "owner"\)/,
    "a manager must not be able to mint a pairing ticket");
  assert.doesNotMatch(TICKET, /\["owner",\s*"manager"\]|owner','manager'/);
});

test("enroll-ticket-create refuses to guess a store when the owner has several", () => {
  assert.match(TICKET, /storeId required: caller owns multiple stores/);
});

test("csrf-bootstrap is GET, passive, and does NOT rotate", () => {
  assert.match(BOOT, /method: "GET"/);
  assert.match(BOOT, /interactive: false/, "bootstrap must not advance the idle clock");
  assert.doesNotMatch(BOOT, /mintCsrfSecret|csrf_secret:/,
    "rotating here would break every other tab holding the previous token");
});

test("resolveStaff refuses to default the interactive flag", () => {
  assert.match(AUTH, /requires an explicit \{ interactive \}/,
    "a default would let a handler silently pick a clock");
});

test("the store is read from the enrollment, never trusted from the session row", () => {
  assert.match(AUTH, /session\/enrollment store mismatch/);
  assert.match(AUTH, /storeId: e\.store_id/, "must return the ENROLLMENT's store");
});

// ── REVIEW ROUND: seven executed findings ───────────────────────────────────

test("F-2: a device refused at its own budget does NOT spend the shared store budget", () => {
  // The DoS this fixes: one locked-out device sending 30 requests spent 30
  // units of the shared store allowance and locked out a SECOND device's
  // CORRECT PIN. The device decision must therefore be made, and returned on,
  // before the store budget is touched.
  const devIdx = LOGIN.indexOf("pinPerEnrollment");
  const devRefuse = LOGIN.indexOf("if (!byDevice.allowed)");
  const storeIdx = LOGIN.indexOf("pinPerStore");
  assert.ok(devIdx > 0 && devRefuse > devIdx, "device budget must be evaluated first");
  assert.ok(devRefuse < storeIdx,
    "the device refusal must return BEFORE the shared store budget is charged");
});

test("F-4: staff-login does not rotate by hand; it calls the serialized function", () => {
  assert.match(LOGIN, /\.rpc\("release2_create_staff_session"/);
  assert.doesNotMatch(LOGIN, /from\("staff_sessions"\)[\s\S]{0,120}\.update\(/,
    "a hand-rolled revoke cannot be serialized against a concurrent insert");
  assert.doesNotMatch(LOGIN, /from\("staff_sessions"\)[\s\S]{0,120}\.insert\(/);
});

test("F-6: csrfOk is actually invoked, after the credential is resolved", () => {
  const resolveIdx = LOGIN.indexOf("await resolveDevice(");
  const csrfIdx = LOGIN.indexOf("csrfOk(event,");
  assert.ok(csrfIdx > 0, "csrfOk existed and was never called — it protected nothing");
  assert.ok(csrfIdx > resolveIdx,
    "the expected secret lives on the resolved row, so resolution must come first");
});

test("F-7: enroll-redeem bounds by SOURCE, not only by ticket hash", () => {
  assert.match(REDEEM, /ticketSource/,
    "per-ticket accounting cannot bound a caller who changes the ticket");
  const srcIdx = REDEEM.indexOf("LIMITS.ticketSource");
  const tktIdx = REDEEM.indexOf('`tkt:${ticketHash');
  assert.ok(srcIdx > 0, "source bound missing");
  assert.ok(tktIdx > 0, "per-ticket bound missing");
  assert.ok(srcIdx < tktIdx, "the source bound must be charged first");
});

test("F-5: a malformed limiter answer throws rather than reading as permission", async () => {
  const { recordAttempt } = await import("../../netlify/lib/release2-auth.js");
  const lim = { windowSecs: 900, maxAttempts: 5, lockSecs: 300 };
  const mk = (data) => ({ rpc: async () => ({ data, error: null }) });

  for (const [label, data] of [
    ["no rows", []],
    ["two rows", [{ allowed: true, attempts: 1 }, { allowed: true, attempts: 1 }]],
    ["null", null],
    ["undefined allowed", [{ attempts: 1 }]],
    ["string allowed", [{ allowed: "true", attempts: 1 }]],
    ["null allowed", [{ allowed: null, attempts: 1 }]],
    ["non-integer attempts", [{ allowed: true, attempts: "1" }]],
  ]) {
    await assert.rejects(
      () => recordAttempt(mk(data), "pin", "s", lim),
      /limiter/,
      `malformed shape "${label}" must throw, never resolve to allowed`
    );
  }

  // The one well-formed shape resolves.
  const ok = await recordAttempt(mk([{ allowed: false, attempts: 6, locked_until: null }]), "pin", "s", lim);
  assert.equal(ok.allowed, false);
  assert.equal(ok.attempts, 6);
});

test("F-5: every limiter caller turns a throw into 503, never into permission", () => {
  for (const [name, src] of [["LOGIN", LOGIN], ["REDEEM", REDEEM]]) {
    assert.match(src, /limiter unavailable[\s\S]{0,220}503/, `${name} must fail closed`);
  }
});

// ── SLICE 3: staff-logout ───────────────────────────────────────────────────
// Source-string assertions first, then behavioural ones against a fake client.
// CALIBRATION, stated plainly: the source assertions pin the SHAPE of the
// handler and nothing more — the 42702 rotation bug passed every one of the
// 154 tests above, because a function that compiles and a function that runs
// are different things. The acceptance evidence for this endpoint is the
// staging sequence 3g/3h/3i (scripts/manual/staging-probes.md) with a live
// session, plus `revoked_reason = 'logout'` read back from staff_sessions.
const LOGOUT = LOGOUT_SRC;

test("staff-logout passes through gate() and refuses uniformly", () => {
  assert.match(LOGOUT, /const blocked = gate\(event, \{ method: "POST" \}\)/);
  assert.match(LOGOUT, /if \(blocked\) return blocked;/);
  assert.match(LOGOUT, /return authFailed\(\)/);
  assert.doesNotMatch(LOGOUT, /error:\s*e\.message/);
});

test("staff-logout resolves a STAFF credential, interactively, and never falls back to the device", () => {
  assert.match(LOGOUT, /resolveStaff\(sb, event, \{ interactive: true \}\)/,
    "a logout is an act by a person; it must not be mistaken for a passive poll");
  assert.doesNotMatch(LOGOUT, /resolveDevice\(/,
    "a device token has nothing to log out of and must get the uniform 401");
});

test("staff-logout checks CSRF AFTER resolution and BEFORE the revoke (F-6 shape)", () => {
  const resolveIdx = LOGOUT.indexOf("await resolveStaff(");
  const csrfIdx = LOGOUT.indexOf("csrfOk(event, staff.csrfSecret)");
  const revokeIdx = LOGOUT.indexOf('.from("staff_sessions")');
  assert.ok(resolveIdx > 0 && csrfIdx > resolveIdx, "the expected secret lives on the resolved row");
  assert.ok(revokeIdx > csrfIdx, "a forged request must revoke nothing");
});

test("staff-logout revokes server-side, the resolved row only, never a body-supplied id", () => {
  assert.match(LOGOUT, /\.update\(\{ revoked_at: new Date\(\)\.toISOString\(\), revoked_reason: "logout" \}\)/);
  assert.match(LOGOUT, /\.eq\("id", staff\.sessionId\)/);
  assert.match(LOGOUT, /\.is\("revoked_at", null\)/, "a concurrent revoke must not be overwritten");
  assert.doesNotMatch(LOGOUT, /JSON\.parse\(event\.body/, "nothing in the body is trusted");
  assert.doesNotMatch(LOGOUT, /\.rpc\(/, "one statement on one row needs no function");
});

test("clearHostCookie keeps the __Host- attribute set and expires the cookie", async () => {
  const { clearHostCookie, setHostCookie } = await import("../../netlify/lib/release2.js");
  const c = clearHostCookie("__Host-pc_staff");
  assert.match(c, /^__Host-pc_staff=; /);
  for (const attr of ["HttpOnly", "Secure", "SameSite=Strict", "Path=/", "Max-Age=0"]) {
    assert.ok(c.includes(attr), `missing ${attr}`);
  }
  assert.doesNotMatch(c, /Domain=/, "__Host- forbids a Domain attribute");
  assert.throws(() => clearHostCookie("pc_staff"), /__Host-/);
  // Same attribute set as the setter, so the browser matches the same cookie.
  const set = setHostCookie("__Host-pc_staff", "x", 10).split("; ").slice(1, -1);
  const clr = c.split("; ").slice(1, -1);
  assert.deepEqual(clr, set);
});

// Fake PostgREST client: enough of the builder surface for resolveStaff and
// the logout UPDATE. Each from() records the chain; awaiting it resolves via
// the per-table answer function so a test can script row state and count
// mutations.
function fakeClient(answers) {
  const calls = [];
  const builder = (table) => {
    const ops = [];
    const b = {
      select: (c) => (ops.push(["select", c]), b),
      update: (p) => (ops.push(["update", p]), b),
      eq: (k, v) => (ops.push(["eq", k, v]), b),
      is: (k, v) => (ops.push(["is", k, v]), b),
      limit: (n) => (ops.push(["limit", n]), b),
      then: (resolve, reject) => {
        calls.push({ table, ops });
        try { resolve(answers(table, ops)); } catch (e) { reject(e); }
      },
    };
    return b;
  };
  const rpc = async (name, args) => {
    const ops = [["rpc", args]];
    calls.push({ table: "rpc:" + name, ops });
    return answers("rpc:" + name, ops) ?? { data: null, error: null };
  };
  return { client: { from: builder, rpc }, calls };
}

const HEX32 = "\\x" + "ab".repeat(32);
const B64 = Buffer.from("ab".repeat(32), "hex").toString("base64url");
const DEV_HEX = "\\x" + "cd".repeat(32);
const DEV_B64 = Buffer.from("cd".repeat(32), "hex").toString("base64url");
const future = new Date(Date.now() + 3600e3).toISOString();

function logoutEvent({ csrf = B64, cookie = "__Host-pc_staff=tok" } = {}) {
  return {
    httpMethod: "POST",
    headers: { "content-type": "application/json", cookie, ...(csrf ? { "x-pc-csrf": csrf } : {}) },
    body: "{}",
  };
}

function scriptedRows({ revoked = null, enrRevoked = null } = {}) {
  const session = { id: "s1", enrollment_id: "e1", store_id: "st1", employee_id: "emp1", employee_role: "staff",
    csrf_secret: HEX32, revoked_at: revoked, absolute_expires_at: future, idle_expires_at: future };
  const enr = { id: "e1", store_id: "st1", revoked_at: enrRevoked, csrf_secret: DEV_HEX };
  return (table, ops) => {
    const kind = ops[0][0];
    if (table === "staff_sessions" && kind === "select") return { data: [session], error: null };
    if (table === "staff_sessions" && kind === "update") {
      const isNull = ops.some(([o, k]) => o === "is" && k === "revoked_at");
      // Mirror the DB: the filtered UPDATE affects the row only while unrevoked.
      const affected = isNull && session.revoked_at === null ? [{ id: "s1" }] : [];
      if (affected.length) session.revoked_at = new Date().toISOString();
      return { data: affected, error: null };
    }
    if (table === "device_enrollments") return { data: [enr], error: null };
    return { data: null, error: null };
  };
}

// These tests drive the REAL handlers, so they pass through the REAL gate —
// which since stage 0 also requires a verified deployment context read from a
// bundled file. There is deliberately no environment switch for that reader
// (netlify/lib/deploy-context.js), so the fixture writes the file the reader
// looks for and restores whatever was there.
async function withEnv(fn) {
  const saved = { ...process.env };
  process.env.RELEASE2_ENABLED = "true";
  process.env.SUPABASE_URL = "https://lboajqihpsfrokqvjgnl.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test";
  delete process.env.URL; delete process.env.DEPLOY_PRIME_URL;
  try {
    return await withRepoDeployContext(validContext({ context: "production" }), fn);
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
}

test("staff-logout: happy path revokes the row, clears the cookie, returns the DEVICE csrf and no key material", async () => {
  await withEnv(async () => {
    const mod = await import("../../netlify/functions/staff-logout.js");
    const { client, calls } = fakeClient(scriptedRows());
    mod.__setClientFactory(() => client);
    const res = await mod.handler(logoutEvent());
    assert.equal(res.statusCode, 200, res.body);
    const body = JSON.parse(res.body);
    assert.equal(body.ok, true);
    assert.equal(body.kind, "device");
    assert.equal(body.csrf, DEV_B64, "must hand back the ENROLLMENT's token, not the session's");
    assert.notEqual(body.csrf, B64);
    assert.doesNotMatch(res.body, /tok|"s1"|"e1"|\\\\x|[0-9a-f]{64}/, "no token, id or hex secret in the body");
    const sc = res.headers["set-cookie"];
    assert.match(sc, /^__Host-pc_staff=; /);
    assert.match(sc, /Max-Age=0/);
    // resolveStaff({ interactive: true }) also UPDATEs the row to advance the
    // idle clock; only the update carrying the logout reason is the revoke.
    const upd = calls.filter((c) => c.table === "staff_sessions" && c.ops[0][0] === "update" && c.ops[0][1]?.revoked_reason === "logout");
    assert.equal(upd.length, 1, "exactly one revoke");
    assert.deepEqual(upd[0].ops.find(([o]) => o === "eq"), ["eq", "id", "s1"]);
  });
});

test("staff-logout: wrong or missing CSRF is 401 and revokes NOTHING", async () => {
  await withEnv(async () => {
    const mod = await import("../../netlify/functions/staff-logout.js");
    for (const csrf of ["AAAA", DEV_B64, null]) {
      const { client, calls } = fakeClient(scriptedRows());
      mod.__setClientFactory(() => client);
      const res = await mod.handler(logoutEvent({ csrf }));
      assert.equal(res.statusCode, 401, `csrf=${csrf}`);
      assert.equal(res.body, JSON.stringify({ ok: false, error: "Unauthorized" }));
      assert.equal(res.headers["set-cookie"], undefined, "a refusal must not touch the cookie");
      const upd = calls.filter((c) => c.table === "staff_sessions" && c.ops[0][0] === "update" && c.ops[0][1]?.revoked_reason === "logout");
      assert.equal(upd.length, 0, `csrf=${csrf}: a forged request revoked a session`);
    }
  });
});

test("staff-logout: reuse after logout is the uniform 401 (row 15), and no cookie or device token is issued", async () => {
  await withEnv(async () => {
    const mod = await import("../../netlify/functions/staff-logout.js");
    const rows = scriptedRows();
    const { client } = fakeClient(rows);
    mod.__setClientFactory(() => client);
    const first = await mod.handler(logoutEvent());
    assert.equal(first.statusCode, 200);
    const second = await mod.handler(logoutEvent());
    assert.equal(second.statusCode, 401, "the same token must not resolve after revocation");
    assert.equal(second.body, JSON.stringify({ ok: false, error: "Unauthorized" }));
    assert.equal(second.headers["set-cookie"], undefined);
  });
});

test("staff-logout: no cookie, or a device cookie alone, is 401", async () => {
  await withEnv(async () => {
    const mod = await import("../../netlify/functions/staff-logout.js");
    for (const cookie of ["", "__Host-pc_device=devtok"]) {
      const { client, calls } = fakeClient(scriptedRows());
      mod.__setClientFactory(() => client);
      const res = await mod.handler(logoutEvent({ cookie }));
      assert.equal(res.statusCode, 401, `cookie="${cookie}"`);
      assert.equal(calls.filter((c) => c.ops[0][0] === "update").length, 0);
    }
  });
});

test("staff-logout: losing the race to another revocation is still success", async () => {
  await withEnv(async () => {
    const mod = await import("../../netlify/functions/staff-logout.js");
    // resolveStaff sees a live row; by the time the UPDATE runs, revoked_at is
    // set (kiosk entry / device revoke / a second tab) so it affects 0 rows.
    const base = scriptedRows();
    const answers = (table, ops) => {
      if (table === "staff_sessions" && ops[0][0] === "update") return { data: [], error: null };
      return base(table, ops);
    };
    const { client } = fakeClient(answers);
    mod.__setClientFactory(() => client);
    const res = await mod.handler(logoutEvent());
    assert.equal(res.statusCode, 200);
    assert.equal(JSON.parse(res.body).kind, "device");
    assert.match(res.headers["set-cookie"], /Max-Age=0/);
  });
});

test("staff-logout: a failed UPDATE is 500, not a silent 200 with a cleared cookie", async () => {
  await withEnv(async () => {
    const mod = await import("../../netlify/functions/staff-logout.js");
    const base = scriptedRows();
    const answers = (table, ops) =>
      table === "staff_sessions" && ops[0][0] === "update"
        ? { data: null, error: { message: "boom" } }
        : base(table, ops);
    const { client } = fakeClient(answers);
    mod.__setClientFactory(() => client);
    const res = await mod.handler(logoutEvent());
    assert.equal(res.statusCode, 500);
    assert.equal(res.headers["set-cookie"], undefined,
      "clearing the cookie while the row stays live would make a copied token the only live credential");
    assert.doesNotMatch(res.body, /boom/);
  });
});

test("staff-logout: the gate applies — wrong method, foreign origin, form content-type", async () => {
  await withEnv(async () => {
    const mod = await import("../../netlify/functions/staff-logout.js");
    const { client, calls } = fakeClient(scriptedRows());
    mod.__setClientFactory(() => client);
    const ev = logoutEvent();
    assert.equal((await mod.handler({ ...ev, httpMethod: "GET" })).statusCode, 405);
    assert.equal((await mod.handler({ ...ev, headers: { ...ev.headers, origin: "https://evil.example.com" } })).statusCode, 403);
    assert.equal((await mod.handler({ ...ev, headers: { ...ev.headers, "content-type": "application/x-www-form-urlencoded" } })).statusCode, 415);
    assert.equal(calls.length, 0, "a gated request must not reach the database at all");
  });
});

// ── SLICE 3: staff-session-revoke-all (kiosk entry) ─────────────────────────
// Same calibration as staff-logout: source assertions pin shape, the fake
// client pins behaviour, and the acceptance evidence is the staging probe
// (3k/3l in scripts/manual/staging-probes.md) with every row on the
// enrollment read back as revoked_reason='kiosk entry'.
const REVOKE_ALL = REVOKE_ALL_SRC;

test("revoke-all passes through gate() and refuses uniformly", () => {
  assert.match(REVOKE_ALL, /const blocked = gate\(event, \{ method: "POST" \}\)/);
  assert.match(REVOKE_ALL, /if \(blocked\) return blocked;/);
  assert.match(REVOKE_ALL, /return authFailed\(\)/);
  assert.doesNotMatch(REVOKE_ALL, /error:\s*e\.message/);
});

test("revoke-all resolves the DEVICE credential and never consults a staff session", () => {
  assert.match(REVOKE_ALL, /await resolveDevice\(sb, event\)/,
    "kiosk entry must work when no staff session is live or resolvable");
  assert.doesNotMatch(REVOKE_ALL, /resolveStaff\(/);
});

test("revoke-all checks CSRF against the ENROLLMENT secret, after resolution, before the revoke", () => {
  const resolveIdx = REVOKE_ALL.indexOf("await resolveDevice(");
  const csrfIdx = REVOKE_ALL.indexOf("csrfOk(event, device.csrfSecret)");
  const revokeIdx = REVOKE_ALL.indexOf('.from("staff_sessions")');
  assert.ok(resolveIdx > 0 && csrfIdx > resolveIdx);
  assert.ok(revokeIdx > csrfIdx, "a forged request must revoke nothing");
});

test("revoke-all is ONE filtered UPDATE on the resolved enrollment, reading nothing from the body", () => {
  assert.match(REVOKE_ALL, /\.update\(\{ revoked_at: new Date\(\)\.toISOString\(\), revoked_reason: "kiosk entry" \}\)/);
  assert.match(REVOKE_ALL, /\.eq\("enrollment_id", device\.enrollmentId\)/,
    "the filter must be the RESOLVED enrollment, so no parameter can name another device");
  assert.match(REVOKE_ALL, /\.is\("revoked_at", null\)/, "earlier revocations keep their own reason");
  assert.doesNotMatch(REVOKE_ALL, /JSON\.parse\(event\.body/);
  assert.doesNotMatch(REVOKE_ALL, /\.rpc\(/);
  assert.doesNotMatch(REVOKE_ALL, /from\("device_enrollments"\)[\s\S]{0,200}\.update\(/,
    "kiosk entry must not revoke the enrollment itself");
});

// (A test that asserted the handler's SCOPE comment was removed here: it
// matched comment text, which the comment-stripping read now discards, and
// a comment is not a guarantee. The scope — staff sessions only, the owner
// Auth session is step-4 client work — is stated in staging-probes.md and
// enforced by the "resolves the DEVICE credential" and "ONE filtered UPDATE"
// tests above, which pin what the code actually touches.)

// Fake rows for a device with two live sessions and one already-revoked one.
function deviceRows({ enrRevoked = null, live = 2 } = {}) {
  const enr = { id: "e1", store_id: "st1", org_id: "o1", csrf_secret: DEV_HEX, revoked_at: enrRevoked };
  const sessions = [
    { id: "old", enrollment_id: "e1", revoked_at: "2026-01-01T00:00:00Z", revoked_reason: "logout" },
    ...Array.from({ length: live }, (_, i) => ({ id: `live${i}`, enrollment_id: "e1", revoked_at: null, revoked_reason: null })),
    { id: "other", enrollment_id: "e2", revoked_at: null, revoked_reason: null },
  ];
  const answers = (table, ops) => {
    const kind = ops[0][0];
    if (table === "device_enrollments" && kind === "select") return { data: [enr], error: null };
    if (table === "staff_sessions" && kind === "update") {
      const patch = ops[0][1];
      const eqEnr = ops.find(([o, k]) => o === "eq" && k === "enrollment_id")?.[2];
      const isNull = ops.some(([o, k, v]) => o === "is" && k === "revoked_at" && v === null);
      const hit = sessions.filter((s) => s.enrollment_id === eqEnr && (!isNull || s.revoked_at === null));
      for (const s of hit) Object.assign(s, patch);
      return { data: hit.map((s) => ({ id: s.id })), error: null };
    }
    return { data: null, error: null };
  };
  return { answers, sessions };
}

function revokeEvent({ csrf = DEV_B64, cookie = "__Host-pc_device=devtok; __Host-pc_staff=tok" } = {}) {
  return {
    httpMethod: "POST",
    headers: { "content-type": "application/json", cookie, ...(csrf ? { "x-pc-csrf": csrf } : {}) },
    body: "{}",
  };
}

test("revoke-all: revokes every LIVE session on THIS enrollment only, returns the count, clears the staff cookie", async () => {
  await withEnv(async () => {
    const mod = await import("../../netlify/functions/staff-session-revoke-all.js");
    const { answers, sessions } = deviceRows();
    const { client } = fakeClient(answers);
    mod.__setClientFactory(() => client);
    const res = await mod.handler(revokeEvent());
    assert.equal(res.statusCode, 200, res.body);
    const body = JSON.parse(res.body);
    assert.deepEqual(body, { ok: true, revoked: 2 });
    assert.match(res.headers["set-cookie"], /^__Host-pc_staff=; .*Max-Age=0/);
    assert.equal(sessions.find((s) => s.id === "old").revoked_reason, "logout", "an earlier revocation keeps its reason");
    assert.equal(sessions.find((s) => s.id === "other").revoked_at, null, "another enrollment's session is untouched");
    for (const id of ["live0", "live1"]) assert.equal(sessions.find((s) => s.id === id).revoked_reason, "kiosk entry");
    assert.doesNotMatch(res.body, /csrf|tok|e1|[0-9a-f]{64}/, "no token, id or secret in the body");
  });
});

test("revoke-all: wrong or missing CSRF is 401 and revokes NOTHING", async () => {
  await withEnv(async () => {
    const mod = await import("../../netlify/functions/staff-session-revoke-all.js");
    for (const csrf of ["AAAA", B64, null]) {
      const { answers, sessions } = deviceRows();
      const { client } = fakeClient(answers);
      mod.__setClientFactory(() => client);
      const res = await mod.handler(revokeEvent({ csrf }));
      assert.equal(res.statusCode, 401, `csrf=${csrf}`);
      assert.equal(res.headers["set-cookie"], undefined);
      assert.equal(sessions.filter((s) => s.revoked_reason === "kiosk entry").length, 0, `csrf=${csrf}`);
    }
  });
});

test("revoke-all: no device cookie, or a staff cookie alone, is 401", async () => {
  await withEnv(async () => {
    const mod = await import("../../netlify/functions/staff-session-revoke-all.js");
    for (const cookie of ["", "__Host-pc_staff=tok"]) {
      const { answers, sessions } = deviceRows();
      const { client } = fakeClient(answers);
      mod.__setClientFactory(() => client);
      const res = await mod.handler(revokeEvent({ cookie }));
      assert.equal(res.statusCode, 401, `cookie="${cookie}"`);
      assert.equal(sessions.filter((s) => s.revoked_reason === "kiosk entry").length, 0);
    }
  });
});

test("revoke-all: a revoked enrollment is 401", async () => {
  await withEnv(async () => {
    const mod = await import("../../netlify/functions/staff-session-revoke-all.js");
    const { answers, sessions } = deviceRows({ enrRevoked: "2026-01-01T00:00:00Z" });
    const { client } = fakeClient(answers);
    mod.__setClientFactory(() => client);
    const res = await mod.handler(revokeEvent());
    assert.equal(res.statusCode, 401);
    assert.equal(sessions.filter((s) => s.revoked_reason === "kiosk entry").length, 0);
  });
});

test("revoke-all: nothing live is still success with revoked: 0", async () => {
  await withEnv(async () => {
    const mod = await import("../../netlify/functions/staff-session-revoke-all.js");
    const { answers } = deviceRows({ live: 0 });
    const { client } = fakeClient(answers);
    mod.__setClientFactory(() => client);
    const res = await mod.handler(revokeEvent());
    assert.equal(res.statusCode, 200);
    assert.deepEqual(JSON.parse(res.body), { ok: true, revoked: 0 });
    assert.match(res.headers["set-cookie"], /Max-Age=0/);
  });
});

test("revoke-all: a failed UPDATE is 500 with no cookie change — the client must not confirm kiosk", async () => {
  await withEnv(async () => {
    const mod = await import("../../netlify/functions/staff-session-revoke-all.js");
    const base = deviceRows().answers;
    const answers = (table, ops) =>
      table === "staff_sessions" && ops[0][0] === "update"
        ? { data: null, error: { message: "boom" } }
        : base(table, ops);
    const { client } = fakeClient(answers);
    mod.__setClientFactory(() => client);
    const res = await mod.handler(revokeEvent());
    assert.equal(res.statusCode, 500);
    assert.equal(res.headers["set-cookie"], undefined);
    assert.doesNotMatch(res.body, /boom|revoked/);
  });
});

test("revoke-all: the gate applies — wrong method, foreign origin, form content-type", async () => {
  await withEnv(async () => {
    const mod = await import("../../netlify/functions/staff-session-revoke-all.js");
    const { answers } = deviceRows();
    const { client, calls } = fakeClient(answers);
    mod.__setClientFactory(() => client);
    const ev = revokeEvent();
    assert.equal((await mod.handler({ ...ev, httpMethod: "GET" })).statusCode, 405);
    assert.equal((await mod.handler({ ...ev, headers: { ...ev.headers, origin: "https://evil.example.com" } })).statusCode, 403);
    assert.equal((await mod.handler({ ...ev, headers: { ...ev.headers, "content-type": "application/x-www-form-urlencoded" } })).statusCode, 415);
    assert.equal(calls.length, 0);
  });
});

// ── SLICE 3: enroll-revoke and enroll-list ──────────────────────────────────
// Calibration as before: shape assertions plus fake-client behaviour; the
// acceptance evidence is probes 5a–5e on staging with revoked_by and the
// cascade reason read back.
const REVOKE = REVOKE_SRC;
const LIST = LIST_SRC;

// p_owner IS TRUSTED BY THE FUNCTION, so the handler is the whole boundary.
// Pin the property: the owner id comes from getUser() and from nowhere else.
test("enroll-revoke: p_owner derives ONLY from resolveOwnerUser() (getUser), never from body, query or headers", () => {
  assert.match(REVOKE, /const user = await resolveOwnerUser\(event, _authFactory\)/);
  assert.match(REVOKE, /p_owner: user\.id/, "the RPC must be handed the validated user's id");
  assert.equal((REVOKE.match(/p_owner:/g) || []).length, 1, "exactly one place sets p_owner");
  assert.doesNotMatch(REVOKE, /body\??\.\s*(owner|user|ownerId|userId|createdBy|revokedBy)/i, "no owner id from the body");
  assert.doesNotMatch(REVOKE, /queryStringParameters/, "no owner id from the query string");
  assert.doesNotMatch(REVOKE, /headers\??\.?\[?["']?x-(owner|user)/i, "no owner id from a custom header");
  assert.doesNotMatch(REVOKE, /jwt\.decode|jsonwebtoken|atob\(/, "no self-parsed JWT — getUser() validates against Supabase");
  assert.match(AUTH, /export async function resolveOwnerUser\(event, authFactory = null/);
  assert.match(AUTH, /asUser\.auth\.getUser\(\)/);
});

test("enroll-revoke: gate, owner JWT before anything else, one RPC, 42501 -> uniform 401, no store from the body", () => {
  assert.match(REVOKE, /const blocked = gate\(event, \{ method: "POST" \}\)/);
  assert.match(REVOKE, /if \(blocked\) return blocked;/);
  const userIdx = REVOKE.indexOf("await resolveOwnerUser(");
  const rpcIdx = REVOKE.indexOf('.rpc("release2_revoke_enrollment"');
  assert.ok(userIdx > 0 && rpcIdx > userIdx);
  assert.equal((REVOKE.match(/\.rpc\(/g) || []).length, 1, "one RPC; the cascade lives in the function");
  assert.match(REVOKE, /error\.code === "42501"\) return authFailed\(\)/);
  assert.doesNotMatch(REVOKE, /body\??\.\s*storeId/, "the store is resolved from the enrollment inside the function");
  assert.doesNotMatch(REVOKE, /resolveDevice\(|resolveStaff\(/, "cookies are not consulted — self-revocation must not be refused");
  assert.doesNotMatch(REVOKE, /error:\s*(e|error)\.message/);
});

test("enroll-revoke: the reason is bounded before the call", () => {
  assert.match(REVOKE, /auditReason\(body\?\.reason\)/);
  assert.match(REVOKE, /reason === false\) return json\(400/);
  assert.match(AUTH, /export function auditReason\(value, max = 200\)/);
});

test("auditReason: 200 printable chars max, controls refused, blank -> null", async () => {
  const { auditReason } = await import("../../netlify/lib/release2-auth.js");
  assert.equal(auditReason(undefined), null);
  assert.equal(auditReason(""), null);
  assert.equal(auditReason("   "), null);
  assert.equal(auditReason(" shared tablet "), "shared tablet");
  assert.equal(auditReason("a".repeat(200)), "a".repeat(200));
  assert.equal(auditReason("a".repeat(201)), false);
  assert.equal(auditReason("ok\nnot"), false);
  assert.equal(auditReason("tab\there"), false);
  assert.equal(auditReason(42), false);
  assert.equal(auditReason({ a: 1 }), false);
});

const OWNER = { id: "11111111-1111-4111-8111-111111111111", email: "owner-t1@example.invalid" };
const ENR = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ST1 = "5ee41000-0000-4000-8000-0000000000a1";
const authOk = () => ({ auth: { getUser: async () => ({ data: { user: OWNER }, error: null }) } });
const authBad = () => ({ auth: { getUser: async () => ({ data: { user: null }, error: { message: "bad" } }) } });

function revokeEvt({ body = { enrollmentId: ENR }, auth = "Bearer x", cookie = "", extra = {} } = {}) {
  return {
    httpMethod: "POST",
    headers: { "content-type": "application/json", ...(auth ? { authorization: auth } : {}), ...(cookie ? { cookie } : {}), ...extra },
    body: typeof body === "string" ? body : JSON.stringify(body),
  };
}

test("enroll-revoke: happy path calls the function with the getUser id and returns the count; self-revocation is 200", async () => {
  await withEnv(async () => {
    process.env.VITE_SUPABASE_ANON_KEY = "anon";
    const mod = await import("../../netlify/functions/enroll-revoke.js");
    const { client, calls } = fakeClient((table, ops) =>
      table === "rpc:release2_revoke_enrollment"
        ? { data: [{ o_enrollment_id: ENR, o_store_id: ST1, o_sessions_revoked: 1 }], error: null }
        : { data: null, error: null });
    mod.__setClientFactory(() => client);
    mod.__setAuthClientFactory(authOk);
    // The request carries the revoked device's OWN cookies and a body/header
    // that try to name a different owner. Neither reaches the function.
    const res = await mod.handler(revokeEvt({
      body: { enrollmentId: ENR, reason: " shared tablet ", ownerId: "22222222-2222-4222-8222-222222222222", userId: "evil" },
      cookie: "__Host-pc_device=devtok; __Host-pc_staff=tok",
      extra: { "x-owner-id": "22222222-2222-4222-8222-222222222222" },
    }));
    assert.equal(res.statusCode, 200, res.body);
    assert.deepEqual(JSON.parse(res.body), { ok: true, enrollmentId: ENR, storeId: ST1, sessionsRevoked: 1 });
    const rpc = calls.find((c) => c.table === "rpc:release2_revoke_enrollment");
    assert.ok(rpc, "function not called");
    assert.deepEqual(rpc.ops[0][1], { p_enrollment: ENR, p_owner: OWNER.id, p_reason: "shared tablet" });
    assert.equal(res.headers["set-cookie"], undefined, "revocation is server-side; cookies are not touched here");
  });
});

test("enroll-revoke: 42501 from the function is the uniform 401; other errors are 500 without detail", async () => {
  await withEnv(async () => {
    process.env.VITE_SUPABASE_ANON_KEY = "anon";
    const mod = await import("../../netlify/functions/enroll-revoke.js");
    mod.__setAuthClientFactory(authOk);
    for (const [code, status] of [["42501", 401], ["XX000", 500]]) {
      const { client } = fakeClient((table) =>
        table === "rpc:release2_revoke_enrollment" ? { data: null, error: { code, message: "secret detail" } } : { data: null, error: null });
      mod.__setClientFactory(() => client);
      const res = await mod.handler(revokeEvt());
      assert.equal(res.statusCode, status, code);
      assert.doesNotMatch(res.body, /secret detail/);
      if (status === 401) assert.equal(res.body, JSON.stringify({ ok: false, error: "Unauthorized" }));
    }
  });
});

test("enroll-revoke: no / bad JWT is 401 before the function is reached; bad id or reason is 400", async () => {
  await withEnv(async () => {
    process.env.VITE_SUPABASE_ANON_KEY = "anon";
    const mod = await import("../../netlify/functions/enroll-revoke.js");
    const { client, calls } = fakeClient(() => ({ data: null, error: null }));
    mod.__setClientFactory(() => client);
    mod.__setAuthClientFactory(authBad);
    assert.equal((await mod.handler(revokeEvt())).statusCode, 401);
    assert.equal((await mod.handler(revokeEvt({ auth: "" }))).statusCode, 401);
    mod.__setAuthClientFactory(authOk);
    assert.equal((await mod.handler(revokeEvt({ body: {} }))).statusCode, 400);
    assert.equal((await mod.handler(revokeEvt({ body: { enrollmentId: "nope" } }))).statusCode, 400);
    assert.equal((await mod.handler(revokeEvt({ body: { enrollmentId: ENR, reason: "x".repeat(201) } }))).statusCode, 400);
    assert.equal((await mod.handler(revokeEvt({ body: { enrollmentId: ENR, reason: "a\nb" } }))).statusCode, 400);
    assert.equal((await mod.handler(revokeEvt({ body: "{not json" }))).statusCode, 400);
    assert.equal(calls.filter((c) => c.table.startsWith("rpc:")).length, 0, "nothing above may reach the function");
  });
});

// ── enroll-list ──
test("enroll-list: GET, owner JWT, owner memberships only, tenant-scoped, no select(*)", () => {
  assert.match(LIST, /gate\(event, \{ method: "GET", requireJson: false \}\)/);
  assert.match(LIST, /const user = await resolveOwnerUser\(event, _authFactory\)/);
  assert.match(LIST, /\.eq\("user_id", user\.id\)\.eq\("role", "owner"\)/);
  assert.match(LIST, /storeId required: caller owns multiple stores/);
  assert.doesNotMatch(LIST, /\.select\("\*"\)|\.select\(\)/, "columns must be named");
  assert.doesNotMatch(LIST, /device_token_hash|csrf_secret|created_by|revoked_by|token_hash/, "no secret or user-id column is even selected");
  const devSel = LIST.indexOf('.from("device_enrollments")');
  assert.ok(devSel > 0 && LIST.indexOf('.eq("store_id", storeId)', devSel) > devSel, "devices filtered by the RESOLVED store");
});

function listEvt({ storeId = null, auth = "Bearer x" } = {}) {
  return {
    httpMethod: "GET",
    headers: { ...(auth ? { authorization: auth } : {}) },
    queryStringParameters: storeId ? { storeId } : {},
    body: "",
  };
}

test("enroll-list: returns the owner's devices with live counts and reasons, and NOTHING secret, even if the row carried it", async () => {
  await withEnv(async () => {
    process.env.VITE_SUPABASE_ANON_KEY = "anon";
    const mod = await import("../../netlify/functions/enroll-list.js");
    const { client } = fakeClient((table, ops) => {
      if (table === "memberships") return { data: [{ store_id: ST1, role: "owner" }], error: null };
      if (table === "device_enrollments") return { data: [
        { id: "d1", label: "Counter A", created_at: "2026-09-16T10:00:00Z", last_seen_at: null, revoked_at: null, revoked_reason: null,
          device_token_hash: "\\xdeadbeef", csrf_secret: "\\xcafebabe", created_by: OWNER.id },
        { id: "d2", label: "Counter B", created_at: "2026-09-16T11:00:00Z", last_seen_at: "2026-09-16T12:00:00Z", revoked_at: "2026-09-16T13:00:00Z", revoked_reason: "shared tablet",
          device_token_hash: "\\xdeadbeef", csrf_secret: "\\xcafebabe", created_by: OWNER.id, revoked_by: OWNER.id },
      ], error: null };
      if (table === "staff_sessions") return { data: [{ enrollment_id: "d1" }, { enrollment_id: "d1" }], error: null };
      return { data: null, error: null };
    });
    mod.__setClientFactory(() => client);
    mod.__setAuthClientFactory(authOk);
    const res = await mod.handler(listEvt());
    assert.equal(res.statusCode, 200, res.body);
    const body = JSON.parse(res.body);
    assert.equal(body.storeId, ST1);
    assert.deepEqual(body.devices, [
      { id: "d2", label: "Counter B", createdAt: "2026-09-16T11:00:00Z", lastSeenAt: "2026-09-16T12:00:00Z", revokedAt: "2026-09-16T13:00:00Z", revokedReason: "shared tablet", liveSessions: 0 },
      { id: "d1", label: "Counter A", createdAt: "2026-09-16T10:00:00Z", lastSeenAt: null, revokedAt: null, revokedReason: null, liveSessions: 2 },
    ]);
    assert.doesNotMatch(res.body, /deadbeef|cafebabe|\\\\x|1111-4111|created_by|revoked_by|token|secret/i, "a secret-bearing row must not leak");
  });
});

test("enroll-list: manager-only membership, or a storeId the caller does not own, is 401; several stores without storeId is 400", async () => {
  await withEnv(async () => {
    process.env.VITE_SUPABASE_ANON_KEY = "anon";
    const mod = await import("../../netlify/functions/enroll-list.js");
    mod.__setAuthClientFactory(authOk);
    const ST2 = "5ee41000-0000-4000-8000-0000000000a2";
    // The fake mirrors PostgREST: the role filter and the optional store filter narrow the rows.
    const mk = (rows) => fakeClient((table, ops) => {
      if (table !== "memberships") return { data: [], error: null };
      const role = ops.find(([o, k]) => o === "eq" && k === "role")?.[2];
      const st = ops.find(([o, k]) => o === "eq" && k === "store_id")?.[2];
      return { data: rows.filter((r) => r.role === role && (!st || r.store_id === st)), error: null };
    }).client;
    mod.__setClientFactory(() => mk([{ store_id: ST1, role: "manager" }]));
    assert.equal((await mod.handler(listEvt())).statusCode, 401, "manager");
    mod.__setClientFactory(() => mk([{ store_id: ST1, role: "owner" }]));
    assert.equal((await mod.handler(listEvt({ storeId: ST2 }))).statusCode, 401, "wrong store");
    assert.equal((await mod.handler(listEvt({ storeId: "nope" }))).statusCode, 400, "malformed store");
    mod.__setClientFactory(() => mk([{ store_id: ST1, role: "owner" }, { store_id: ST2, role: "owner" }]));
    assert.equal((await mod.handler(listEvt())).statusCode, 400, "ambiguous");
    assert.equal((await mod.handler(listEvt({ storeId: ST2 }))).statusCode, 200, "named store");
    mod.__setAuthClientFactory(authBad);
    assert.equal((await mod.handler(listEvt())).statusCode, 401, "bad jwt");
  });
});

test("enroll-list / enroll-revoke: the gate applies", async () => {
  await withEnv(async () => {
    process.env.VITE_SUPABASE_ANON_KEY = "anon";
    const list = await import("../../netlify/functions/enroll-list.js");
    const rev = await import("../../netlify/functions/enroll-revoke.js");
    const { client, calls } = fakeClient(() => ({ data: null, error: null }));
    list.__setClientFactory(() => client); rev.__setClientFactory(() => client);
    list.__setAuthClientFactory(authOk); rev.__setAuthClientFactory(authOk);
    assert.equal((await list.handler({ ...listEvt(), httpMethod: "POST" })).statusCode, 405);
    assert.equal((await list.handler({ ...listEvt(), headers: { authorization: "Bearer x", origin: "https://evil.example.com" } })).statusCode, 403);
    const r = revokeEvt();
    assert.equal((await rev.handler({ ...r, httpMethod: "GET" })).statusCode, 405);
    assert.equal((await rev.handler({ ...r, headers: { ...r.headers, origin: "https://evil.example.com" } })).statusCode, 403);
    assert.equal((await rev.handler({ ...r, headers: { ...r.headers, "content-type": "text/plain" } })).statusCode, 415);
    assert.equal(calls.length, 0);
  });
});
