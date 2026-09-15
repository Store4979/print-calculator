// scripts/tests/release2-endpoints.test.js — slice 2 handler contracts.
//
// These assert the properties that are invisible in a happy-path run: that a
// disabled deployment is indistinguishable from an absent one, that failures
// are uniform, and that no response ever carries key material.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const LOGIN = read("../../netlify/functions/staff-login.js");
const REDEEM = read("../../netlify/functions/enroll-redeem.js");
const TICKET = read("../../netlify/functions/enroll-ticket-create.js");
const BOOT = read("../../netlify/functions/csrf-bootstrap.js");
const AUTH = read("../../netlify/lib/release2-auth.js");

const ALL = { LOGIN, REDEEM, TICKET, BOOT };

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
