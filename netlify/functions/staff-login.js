// netlify/functions/staff-login.js — PIN → opaque server-owned staff session.
//
// This IS the rate-limited server endpoint Phase S1 called for. It verifies the
// PIN with service_role reading `employees` directly, NOT through
// verify_employee_pin: that RPC is anon-executable, which is the exact surface
// S1 exists to remove, and building S1's replacement on top of it would keep it
// alive. The RPC makes no check this endpoint is not already making itself.
//
// A device cookie is REQUIRED. Enrollment proves which store's counter, never
// who — so a device token alone gets you as far as this endpoint and no
// further (Part 3.1 rule 2).
import { gate, json, authFailed, mintToken, hashToken, mintCsrfSecret, setHostCookie } from "../lib/release2.js";
import {
  COOKIE, LIMITS, recordAttempt, findEmployeeByPinDirect, serviceClient,
  resolveDevice, csrfToken, csrfOk,
} from "../lib/release2-auth.js";

let _factory = null;
export const __setClientFactory = (fn) => { _factory = fn; };

const SESSION_ABSOLUTE_MS = 12 * 60 * 60 * 1000;
const SESSION_IDLE_MS = 60 * 60 * 1000;

export const handler = async (event) => {
  const blocked = gate(event, { method: "POST" });
  if (blocked) return blocked;

  let sb;
  try {
    sb = serviceClient(process.env, _factory);
  } catch (e) {
    console.error("[staff-login]", e.message);
    return json(500, { ok: false, error: "Server Error" });
  }

  // 1. Device first. No enrollment, no login — and the 401 is identical to a
  //    bad PIN, so a caller cannot learn whether a device token was valid.
  const device = await resolveDevice(sb, event);
  if (!device) return authFailed();

  // F-6. CSRF, checked AFTER the credential is resolved — the expected value
  // lives on the enrollment row, so there is nothing to compare against before
  // it is loaded. csrfOk existed and was never called; a helper that is never
  // invoked protects nothing, and its presence made the gap harder to see.
  if (!csrfOk(event, device.csrfSecret)) {
    console.warn("[staff-login] csrf rejected for enrollment", device.enrollmentId);
    return authFailed();
  }

  let body = {};
  try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { ok: false, error: "Invalid JSON" }); }
  const pin = String(body?.pin ?? "");

  // 2. Budgets. F-2. ORDER MATTERS, and getting it wrong was a denial-of-service.
  //
  // The previous version charged BOTH budgets unconditionally. So a single
  // locked-out device could keep sending requests: each one was refused at the
  // device level but still spent one unit of the SHARED store budget, and after
  // 30 of them a SECOND device's CORRECT PIN was refused. One attacker with one
  // device could lock out the whole shop — the exact failure the store budget
  // was scoped to avoid.
  //
  // So the device decision is made FIRST, and a request refused there does NOT
  // touch the shared budget. Rejected traffic stays observable in the logs and
  // in the device's own counter; it simply stops being able to spend someone
  // else's allowance.
  let byDevice;
  try {
    byDevice = await recordAttempt(sb, "pin", `enr:${device.enrollmentId}`, LIMITS.pinPerEnrollment);
  } catch (e) {
    // A limiter that cannot run must not let the attempt through — that would
    // make the bound disappear exactly when the database is under stress.
    console.error("[staff-login] limiter unavailable:", e.message);
    return json(503, { ok: false, error: "Service Unavailable" });
  }
  if (!byDevice.allowed) {
    console.warn(`[staff-login] device locked enr=${device.enrollmentId} attempts=${byDevice.attempts}`);
    return json(429, { ok: false, error: "Too Many Attempts" });
  }

  // Only an ADMITTED attempt spends the shared store allowance.
  let byStore;
  try {
    byStore = await recordAttempt(sb, "pin", `store:${device.storeId}`, LIMITS.pinPerStore);
  } catch (e) {
    console.error("[staff-login] limiter unavailable:", e.message);
    return json(503, { ok: false, error: "Service Unavailable" });
  }
  if (!byStore.allowed) {
    console.warn(`[staff-login] store locked store=${device.storeId} attempts=${byStore.attempts}`);
    return json(429, { ok: false, error: "Too Many Attempts" });
  }

  // 3. Verify. Store-scoped and active-only, matching the RPC exactly.
  if (!/^\d{4}$/.test(pin)) return authFailed();
  let employee;
  try {
    employee = await findEmployeeByPinDirect(sb, device.storeId, pin);
  } catch (e) {
    console.error("[staff-login]", e.message);
    return json(500, { ok: false, error: "Server Error" });
  }
  if (!employee) return authFailed();

  // F-4. ROTATION IS ATOMIC, and this handler no longer performs it.
  //
  // The previous version revoked prior sessions and then inserted the new one
  // as TWO statements. Two concurrent sign-ins on one device could interleave
  // so both revokes ran before both inserts, leaving TWO live sessions —
  // rotation defeated, and either employee attributable for the other's work.
  // Checking the UPDATE's error would not have helped: nothing errored. Only
  // serialization fixes an interleaving.
  //
  // release2_create_staff_session takes a row lock on the enrollment, so
  // concurrent sign-ins queue instead of interleaving, and it returns only
  // after the commit that makes the new session the only live one. It also
  // re-checks the enrollment and the employee/store/active triple rather than
  // trusting what this handler passes.
  const token = mintToken();
  const csrf = mintCsrfSecret();
  const now = Date.now();
  const { data: created, error: rotErr } = await sb.rpc("release2_create_staff_session", {
    p_enrollment: device.enrollmentId,
    p_employee: employee.id,
    p_token_hash: `\\x${hashToken(token).toString("hex")}`,
    p_csrf_secret: `\\x${csrf.toString("hex")}`,
    p_absolute: new Date(now + SESSION_ABSOLUTE_MS).toISOString(),
    p_idle: new Date(now + SESSION_IDLE_MS).toISOString(),
  });
  if (rotErr) {
    console.error("[staff-login] rotation failed:", rotErr.code, rotErr.message);
    return authFailed();
  }
  const session = Array.isArray(created) ? created[0] : created;
  if (!session?.session_id) {
    console.error("[staff-login] rotation returned no session");
    return json(500, { ok: false, error: "Server Error" });
  }

  return json(
    200,
    {
      ok: true,
      // The employee's own details, and the role that governs margin
      // visibility. NO token, NO session id, NO key material.
      // The role comes from the ROTATION FUNCTION, which re-read it from the
      // employees row under the enrollment's store — not from the lookup above
      // and not from anything the caller sent.
      employee: { id: employee.id, name: employee.name, role: session.employee_role },
      csrf: csrfToken(csrf),
      expiresAt: new Date(now + SESSION_ABSOLUTE_MS).toISOString(),
    },
    { "set-cookie": setHostCookie(COOKIE.staff, token, SESSION_ABSOLUTE_MS / 1000) }
  );
};
