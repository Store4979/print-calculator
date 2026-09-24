// netlify/functions/staff-session-revoke-all.js — kiosk entry: revoke EVERY
// staff session on this enrollment, server-side.
//
// WHY THE DEVICE CREDENTIAL: kiosk entry must work when no staff session is
// live or resolvable — the point of entering kiosk is that whoever is signed
// in stops being signed in — and Part 3.1 derives the store from the
// enrollment row, never from a session or a request body. A device token is
// the right class here; a staff token is not required and is not consulted.
//
// SCOPE, STATED PLAINLY: this revokes STAFF SESSIONS ONLY. An owner's Supabase
// Auth session persisted by supabase-js in localStorage (release-2-plan.md
// Part 3.1) is a different credential class that this endpoint neither sees
// nor touches. Removing it from a customer-accessible tab is the CLIENT's job
// at kiosk entry (step 4: supabase.auth.signOut() + clear auth storage). A
// 200 from here does NOT mean the tab is customer-safe; it means no staff
// session on this device is live.
//
// ONE FILTERED UPDATE. Every row for the resolved enrollment with
// `revoked_at is null` is revoked with reason 'kiosk entry'. The filter is on
// the RESOLVED enrollment id — nothing from the body is read, so there is no
// parameter to point at another device's sessions. Zero rows affected is
// success: there was nothing live.
//
// THE COUNT IS RETURNED so the client can report "kiosk confirmed" only after
// a successful round trip. Offline kiosk entry must not lie (Part 3.1): a
// local flag that flips while the server-side sessions stay live is the
// failure this response shape exists to prevent — the client keeps kiosk as
// NOT confirmed until it has this 200 in hand.
//
// It clears the caller's own __Host-pc_staff cookie so the tab that entered
// kiosk drops its staff credential too. It does NOT revoke the enrollment,
// does NOT touch the device cookie, and does NOT return the device csrf — the
// caller already holds it (it just used it).
//
// CLIENT CONTRACT FOR A 401: same as staff-logout — uniform refusal, so "no
// device cookie", "revoked enrollment" and "wrong CSRF" are indistinguishable,
// and the recovery is the same: bootstrap; if that is 401 too, the device must
// be re-enrolled, and kiosk entry cannot be confirmed until it is.
import { gate, json, authFailed, clearHostCookie } from "../lib/release2.js";
import { COOKIE, serviceClient, resolveDevice, csrfOk } from "../lib/release2-auth.js";

let _factory = null;
export const __setClientFactory = (fn) => { _factory = fn; };

export const handler = async (event) => {
  const blocked = gate(event, { method: "POST" });
  if (blocked) return blocked;

  let sb;
  try {
    sb = serviceClient(process.env, _factory);
  } catch (e) {
    console.error("[staff-session-revoke-all]", e.message);
    return json(500, { ok: false, error: "Server Error" });
  }

  // 1. Device enrollment. No staff resolution — see the header.
  const device = await resolveDevice(sb, event);
  if (!device) return authFailed();

  // 2. CSRF against the ENROLLMENT's secret, after resolution (F-6 shape).
  if (!csrfOk(event, device.csrfSecret)) {
    console.warn("[staff-session-revoke-all] csrf rejected for enrollment", device.enrollmentId);
    return authFailed();
  }

  // 3. Revoke every live session on THIS enrollment.
  const { data, error } = await sb
    .from("staff_sessions")
    .update({ revoked_at: new Date().toISOString(), revoked_reason: "kiosk entry" })
    .eq("enrollment_id", device.enrollmentId)
    .is("revoked_at", null)
    .select("id");
  if (error) {
    console.error("[staff-session-revoke-all] revoke failed:", error.message);
    return json(500, { ok: false, error: "Server Error" });
  }
  const revoked = Array.isArray(data) ? data.length : 0;

  return json(200, { ok: true, revoked }, { "set-cookie": clearHostCookie(COOKIE.staff) });
};
