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
  resolveDevice, csrfToken,
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

  let body = {};
  try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { ok: false, error: "Invalid JSON" }); }
  const pin = String(body?.pin ?? "");

  // 2. Charge BOTH budgets before the PIN is examined, so failures count.
  //    Per enrollment is the guessing bound; per store catches the same
  //    attacker spreading guesses across several enrolled devices.
  let byDevice, byStore;
  try {
    byDevice = await recordAttempt(sb, "pin", `enr:${device.enrollmentId}`, LIMITS.pinPerEnrollment);
    byStore = await recordAttempt(sb, "pin", `store:${device.storeId}`, LIMITS.pinPerStore);
  } catch (e) {
    // A limiter that cannot run must not let the attempt through — that would
    // make the bound disappear exactly when the database is under stress.
    console.error("[staff-login] limiter unavailable:", e.message);
    return json(503, { ok: false, error: "Service Unavailable" });
  }
  if (!byDevice.allowed || !byStore.allowed) {
    console.warn(
      `[staff-login] locked out enr=${device.enrollmentId} ` +
        `device=${byDevice.attempts} store=${byStore.attempts}`
    );
    // 429 rather than 401: being told you are rate-limited reveals nothing a
    // caller could not measure anyway, and hiding it invites hammering.
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

  // 4. ROTATE. Always a new session, and the previous ones on this enrollment
  //    are revoked. Without this the next employee inherits the previous
  //    session's identity and their work is attributed to the wrong person —
  //    which shows up in the store's own order history, not just in a threat
  //    model.
  await sb
    .from("staff_sessions")
    .update({ revoked_at: new Date().toISOString(), revoked_reason: "rotated: new sign-in on this device" })
    .eq("enrollment_id", device.enrollmentId)
    .is("revoked_at", null);

  const token = mintToken();
  const csrf = mintCsrfSecret();
  const now = Date.now();
  const { data: created, error: insErr } = await sb
    .from("staff_sessions")
    .insert({
      enrollment_id: device.enrollmentId,
      store_id: device.storeId,
      employee_id: employee.id,
      employee_role: employee.role === "manager" ? "manager" : "staff",
      token_hash: `\\x${hashToken(token).toString("hex")}`,
      csrf_secret: `\\x${csrf.toString("hex")}`,
      absolute_expires_at: new Date(now + SESSION_ABSOLUTE_MS).toISOString(),
      idle_expires_at: new Date(now + SESSION_IDLE_MS).toISOString(),
    })
    .select("id")
    .limit(1);
  if (insErr) {
    console.error("[staff-login] session insert failed:", insErr.message);
    return json(500, { ok: false, error: "Server Error" });
  }

  return json(
    200,
    {
      ok: true,
      // The employee's own details, and the role that governs margin
      // visibility. NO token, NO session id, NO key material.
      employee: { id: employee.id, name: employee.name, role: employee.role },
      csrf: csrfToken(csrf),
      expiresAt: new Date(now + SESSION_ABSOLUTE_MS).toISOString(),
    },
    { "set-cookie": setHostCookie(COOKIE.staff, token, SESSION_ABSOLUTE_MS / 1000) }
  );
};
