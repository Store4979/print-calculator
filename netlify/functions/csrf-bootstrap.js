// netlify/functions/csrf-bootstrap.js — hand back the CSRF token bound to the
// caller's existing credential.
//
// WHY THIS EXISTS: the CSRF token is held in memory, so it is GONE after a
// reload while the HttpOnly cookie survives. Without this, a refreshed counter
// tab has a live session and cannot mutate anything — the counter would break
// on F5.
//
// IT DOES NOT ROTATE. An earlier revision rotated on issue, which was wrong
// twice over: the token lives on the shared credential row, so tab B's reload
// would invalidate the value tab A is holding and A's next save would fail with
// a perfectly valid session; and "read-only GET" and "rotates on issue" cannot
// both be true. Rotation belongs to the credential lifecycle — staff-login,
// logout, revocation, re-enrolment.
//
// IT IS PASSIVE. It must not advance the idle clock, or a tab that merely
// reloads (or an auto-refreshing display) would hold a session open forever and
// the idle limit would never fire.
//
// THE TOKEN IT RETURNS IS THE DEFENCE. Anything that can read this response can
// forge every state-changing request for that credential, so this endpoint gets
// the same Origin discipline as a mutation — it is not "harmless because it
// only returns a token".
import { gate, json, authFailed } from "../lib/release2.js";
import { serviceClient, resolveStaff, resolveDevice, csrfToken } from "../lib/release2-auth.js";

let _factory = null;
export const __setClientFactory = (fn) => { _factory = fn; };

export const handler = async (event) => {
  // GET, and no JSON body to require — but the Origin allowlist still applies.
  const blocked = gate(event, { method: "GET", requireJson: false });
  if (blocked) return blocked;

  let sb;
  try { sb = serviceClient(process.env, _factory); }
  catch (e) { console.error("[csrf-bootstrap]", e.message); return json(500, { ok: false, error: "Server Error" }); }

  // Staff first, then device. Explicitly passive: this call must never count
  // as activity.
  const staff = await resolveStaff(sb, event, { interactive: false });
  if (staff) {
    return json(200, { ok: true, kind: "staff", csrf: csrfToken(staff.csrfSecret) });
  }
  const device = await resolveDevice(sb, event);
  if (device) {
    return json(200, { ok: true, kind: "device", csrf: csrfToken(device.csrfSecret) });
  }
  // No session content is returned in either branch — only the token — and an
  // unresolvable caller gets the same uniform 401 as everywhere else.
  return authFailed();
};
