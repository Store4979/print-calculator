// netlify/lib/release2-auth.js — identity resolution and the PIN path.
import { createClient } from "@supabase/supabase-js";
import { hashToken, safeEqual, readCookie } from "./release2.js";

export const COOKIE = Object.freeze({
  device: "__Host-pc_device",
  staff: "__Host-pc_staff",
  upload: "__Host-pc_upload",
});

// ── Abuse budgets ───────────────────────────────────────────────────────────
// TWO LEVELS, both charged on EVERY attempt including failures.
//
// Per ENROLLMENT is the real guessing bound: an attacker must come through a
// device and cannot rotate it. Per STORE is a wider backstop that catches the
// same attacker spreading guesses across several enrolled devices — without it,
// N devices multiply the budget by N.
//
// Neither is per EMPLOYEE, and that is not a simplification: a failed PIN guess
// resolves no employee (the RPC and the direct read both take only a store and
// a PIN), so at the moment the failure must be charged there is no employee to
// charge it to.
//
// The store bound is deliberately much looser than the device bound so that one
// device tripping its own limit does not take the shop down with it.
export const LIMITS = Object.freeze({
  pinPerEnrollment: { windowSecs: 900, maxAttempts: 5, lockSecs: 300 },
  pinPerStore: { windowSecs: 900, maxAttempts: 30, lockSecs: 300 },
  ticket: { windowSecs: 900, maxAttempts: 10, lockSecs: 900 },
});

export async function recordAttempt(sb, scope, subject, limit) {
  const { data, error } = await sb.rpc("release2_record_attempt", {
    p_scope: scope,
    p_subject: String(subject),
    p_window_secs: limit.windowSecs,
    p_max_attempts: limit.maxAttempts,
    p_lock_secs: limit.lockSecs,
  });
  if (error) throw new Error(`limiter failed: ${error.message}`);
  const row = Array.isArray(data) ? data[0] : data;
  return { allowed: row?.allowed !== false, attempts: row?.attempts ?? 0, lockedUntil: row?.locked_until ?? null };
}

// ── PIN lookup ──────────────────────────────────────────────────────────────
// DIRECT READ with service_role, NOT via verify_employee_pin.
//
// staff-login IS the rate-limited server endpoint Phase S1 called for, and the
// attempt counter above is its limiter. Routing it through the anon-executable
// RPC would build S1's replacement on top of the very thing S1 exists to
// remove, and the RPC offers no check this endpoint is not already making.
//
// DRIFT HAZARD, and the reason PIN_LOOKUP is a frozen descriptor rather than
// an inline query: two PIN paths coexist until step 4 migrates the clients. If
// one changes and the other does not, staff sign-in diverges depending on which
// path a device happens to use. This descriptor mirrors verify_employee_pin's
// body exactly —
//
//   select e.id, e.name, e.active, e.role
//     from public.employees e
//    where e.store_id = p_store_id
//      and e.pin      = p_pin
//      and e.active
//    limit 1;
//
// — and scripts/tests/release2-pin-parity.test.js pins it against that text, so
// changing either side without the other fails the suite.
export const PIN_LOOKUP = Object.freeze({
  table: "employees",
  columns: "id, name, active, role",
  eq: Object.freeze(["store_id", "pin", "active"]),
  activeValue: true,
  limit: 1,
});

export async function findEmployeeByPinDirect(sb, storeId, pin) {
  const { data, error } = await sb
    .from(PIN_LOOKUP.table)
    .select(PIN_LOOKUP.columns)
    .eq("store_id", storeId)
    .eq("pin", String(pin))
    .eq("active", PIN_LOOKUP.activeValue)
    .limit(PIN_LOOKUP.limit);
  if (error) throw new Error(`pin lookup failed: ${error.message}`);
  return (data && data[0]) || null;
}

// ── Service client ──────────────────────────────────────────────────────────
export function serviceClient(env = process.env, factory = null) {
  if (factory) return factory();
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase env not configured");
  return createClient(String(url).trim(), String(key).trim(), { auth: { persistSession: false } });
}

// ── Resolvers ───────────────────────────────────────────────────────────────
// Each returns null on ANY failure. Callers turn null into one uniform 401, so
// unknown / expired / revoked / wrong-kind are indistinguishable from outside.

/** Device enrollment only. Proves WHICH STORE'S COUNTER, never WHO. */
export async function resolveDevice(sb, event) {
  const token = readCookie(event, COOKIE.device);
  if (!token) return null;
  const { data } = await sb
    .from("device_enrollments")
    .select("id, store_id, org_id, csrf_secret, revoked_at")
    .eq("device_token_hash", `\\x${hashToken(token).toString("hex")}`)
    .limit(1);
  const row = data && data[0];
  if (!row || row.revoked_at) return null;
  return { enrollmentId: row.id, storeId: row.store_id, orgId: row.org_id, csrfSecret: row.csrf_secret };
}

/**
 * Staff session. `interactive` decides WHICH clock advances: passive calls
 * (queue polling, csrf-bootstrap) must not hold a session open, or the idle
 * limit never fires on a counter tab left open all day.
 */
export async function resolveStaff(sb, event, { interactive } = {}) {
  if (typeof interactive !== "boolean") {
    // Not a default — a handler that forgets to declare its kind would
    // silently pick one, and the wrong pick is invisible until the idle limit
    // quietly stops working.
    throw new Error("resolveStaff requires an explicit { interactive } — see Part 2.3a");
  }
  const token = readCookie(event, COOKIE.staff);
  if (!token) return null;
  const now = new Date().toISOString();
  const { data } = await sb
    .from("staff_sessions")
    .select("id, enrollment_id, store_id, employee_id, employee_role, csrf_secret, revoked_at, absolute_expires_at, idle_expires_at")
    .eq("token_hash", `\\x${hashToken(token).toString("hex")}`)
    .limit(1);
  const row = data && data[0];
  if (!row) return null;
  if (row.revoked_at) return null;
  if (row.absolute_expires_at <= now || row.idle_expires_at <= now) return null;

  // The store is read from the ENROLLMENT, never taken from the session row.
  // The session's store_id is a denormalised convenience for indexing; if the
  // two ever disagree that is a schema bug or tampering, and both deserve a
  // loud failure rather than a silent pick.
  const { data: enr } = await sb
    .from("device_enrollments")
    .select("id, store_id, revoked_at")
    .eq("id", row.enrollment_id)
    .limit(1);
  const e = enr && enr[0];
  if (!e || e.revoked_at) return null;
  if (e.store_id !== row.store_id) {
    console.error("[release2] session/enrollment store mismatch", row.id);
    return null;
  }

  const patch = { last_used_at: now };
  if (interactive) {
    patch.last_active_at = now;
    patch.idle_expires_at = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  }
  await sb.from("staff_sessions").update(patch).eq("id", row.id);

  return {
    sessionId: row.id,
    enrollmentId: row.enrollment_id,
    storeId: e.store_id,
    employeeId: row.employee_id,
    role: row.employee_role,
    csrfSecret: row.csrf_secret,
  };
}

/** CSRF: resolve the credential FIRST, then compare its bound secret. */
export function csrfOk(event, secretFromRow) {
  const presented = event?.headers?.["x-pc-csrf"] || event?.headers?.["X-PC-CSRF"] || "";
  if (!presented || !secretFromRow) return false;
  const expected = Buffer.isBuffer(secretFromRow)
    ? secretFromRow
    : Buffer.from(String(secretFromRow).replace(/^\\x/, ""), "hex");
  return safeEqual(Buffer.from(String(presented), "base64url"), expected);
}

export const csrfToken = (secret) => {
  const buf = Buffer.isBuffer(secret)
    ? secret
    : Buffer.from(String(secret).replace(/^\\x/, ""), "hex");
  return buf.toString("base64url");
};
