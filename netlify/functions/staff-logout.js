// netlify/functions/staff-logout.js — revoke THIS staff session and return the
// tab to device state.
//
// WHY THIS EXISTS (probe 3f-i, slice 2): after a reload the only token a tab
// can recover is the STAFF one (csrf-bootstrap returns the token of the
// highest-ranking credential it resolves), and staff-login compares against
// the DEVICE secret. So a refreshed counter tab holding a live session could
// not switch employee. Logout is the moment the tab legitimately returns to
// device state, so it hands the device token back in the same response.
//
// IT REVOKES SERVER-SIDE. Clearing the cookie is not the revocation — a copied
// token would still resolve. The session row is marked revoked, and every
// later use of that token gets the uniform 401 (Part 8 row 15).
//
// IT IS A MUTATION ON A COOKIE SESSION, so it gets the same treatment as
// login: gate() (kill switch, POST, Origin allowlist, JSON), then the
// credential is resolved, THEN the CSRF header is compared against that row's
// secret. A cross-site page cannot log the counter out.
//
// IT DOES ONE UPDATE, not a SQL function. Rotation needed a function because
// two statements had to be serialized; this is one statement on one row,
// filtered on `revoked_at is null`. Zero rows affected means a concurrent
// revoke (kiosk entry, device revoke, a second logout) won the race, and that
// is still success: the caller's session is not live either way.
//
// CLIENT CONTRACT FOR A 401: treat it as "already in device state — bootstrap
// again", NOT as an error. Refusals are uniform by design, so a tab cannot
// tell already-logged-out from wrong-CSRF from expired, and the correct
// recovery is the same for all three: call csrf-bootstrap, use whatever token
// class it returns. A logout that "fails" has left nothing live that the
// caller could have used.
//
// IT DOES NOT touch other sessions on the enrollment (that is
// staff-session-revoke-all, the kiosk-entry endpoint), does not clear the
// device cookie, and does not rotate the device csrf — a second tab on the
// same enrollment still holds that token legitimately.
import { gate, json, authFailed, clearHostCookie } from "../lib/release2.js";
import { COOKIE, serviceClient, resolveStaff, csrfOk, csrfToken } from "../lib/release2-auth.js";

let _factory = null;
export const __setClientFactory = (fn) => { _factory = fn; };

export const handler = async (event) => {
  const blocked = gate(event, { method: "POST" });
  if (blocked) return blocked;

  let sb;
  try {
    sb = serviceClient(process.env, _factory);
  } catch (e) {
    console.error("[staff-logout]", e.message);
    return json(500, { ok: false, error: "Server Error" });
  }

  // 1. Staff session only. A device token alone has nothing to log out of and
  //    gets the same 401 as no cookie at all. Interactive: a logout is an act
  //    by a person, not a poll.
  const staff = await resolveStaff(sb, event, { interactive: true });
  if (!staff) return authFailed();

  // 2. CSRF, after resolution, against THIS session's secret (F-6 shape).
  //    Refused here, nothing below runs — a forged request revokes nothing.
  if (!csrfOk(event, staff.csrfSecret)) {
    console.warn("[staff-logout] csrf rejected for session", staff.sessionId);
    return authFailed();
  }

  // 3. Revoke the row the COOKIE resolved to. Nothing from the body is read;
  //    there is no "session id" parameter to point at someone else's row.
  const { data, error } = await sb
    .from("staff_sessions")
    .update({ revoked_at: new Date().toISOString(), revoked_reason: "logout" })
    .eq("id", staff.sessionId)
    .is("revoked_at", null)
    .select("id");
  if (error) {
    console.error("[staff-logout] revoke failed:", error.message);
    return json(500, { ok: false, error: "Server Error" });
  }
  if (!Array.isArray(data) || data.length === 0) {
    // Lost a race with another revocation. The session is not live; proceed.
    console.warn("[staff-logout] session already revoked", staff.sessionId);
  }

  // 4. Back to device state. The device token is what staff-login checks, so
  //    the next employee can sign in without a bootstrap round trip. Omitted
  //    if the enrollment has no usable secret — the client's bootstrap will
  //    then answer 401 and the tab knows it must be re-enrolled.
  const body = { ok: true, kind: "device" };
  if (staff.deviceCsrfSecret) body.csrf = csrfToken(staff.deviceCsrfSecret);

  return json(200, body, { "set-cookie": clearHostCookie(COOKIE.staff) });
};
