// netlify/functions/enroll-revoke.js — an OWNER revokes a device enrollment.
// Every live session on it dies with it (Part 5: revoking a device revokes
// every session on it).
//
// OWNER ONLY, like enroll-ticket-create: enrollment management is an
// ownership act and is withheld from a PIN manager and an Auth manager alike.
//
// THIS HANDLER IS THE ENTIRE AUTHORIZATION BOUNDARY. The SQL function it calls
// trusts p_owner — service_role cannot use auth.uid(), so the database cannot
// re-check who is asking. p_owner is therefore taken from resolveOwnerUser()
// (the validated Bearer token) and from NOTHING ELSE: not the body, not a
// query string, not another header. scripts/tests/release2-endpoints.test.js
// asserts this on the source and on the fake client.
//
// The STORE is not taken from anywhere. The body names an ENROLLMENT; the
// function resolves that row's store and requires the caller to hold an owner
// membership for it. Unknown, wrong-store and non-owner all come back as one
// 42501, before any write and before the idempotent already-revoked branch —
// so a caller cannot learn whether another tenant's device exists or whether
// it is live. The handler maps that 42501 to the uniform 401.
//
// REVOKING THE REQUESTING DEVICE IS ALLOWED and returns 200. Nothing here
// resolves the device or staff cookie, so the tablet an owner is holding can
// revoke itself; its cookies simply stop resolving on the next request.
//
// The optional reason is bounded (200 printable chars) BEFORE the call, so a
// bad reason is a 400 here rather than a 22023 from the function — it is audit
// data that enroll-list returns, not free text.
import { gate, json, authFailed } from "../lib/release2.js";
import { serviceClient, resolveOwnerUser, auditReason } from "../lib/release2-auth.js";

let _factory = null;
let _authFactory = null;
export const __setClientFactory = (fn) => { _factory = fn; };
export const __setAuthClientFactory = (fn) => { _authFactory = fn; };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const handler = async (event) => {
  const blocked = gate(event, { method: "POST" });
  if (blocked) return blocked;

  const user = await resolveOwnerUser(event, _authFactory);
  if (!user) return authFailed();

  let sb;
  try { sb = serviceClient(process.env, _factory); }
  catch (e) { console.error("[enroll-revoke]", e.message); return json(500, { ok: false, error: "Server Error" }); }

  let body = {};
  try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { ok: false, error: "Invalid JSON" }); }
  const enrollmentId = String(body?.enrollmentId ?? "");
  if (!UUID.test(enrollmentId)) return json(400, { ok: false, error: "enrollmentId required" });
  const reason = auditReason(body?.reason);
  if (reason === false) return json(400, { ok: false, error: "reason must be at most 200 printable characters" });

  const { data, error } = await sb.rpc("release2_revoke_enrollment", {
    p_enrollment: enrollmentId,
    p_owner: user.id,
    p_reason: reason,
  });
  if (error) {
    if (error.code === "42501") return authFailed();
    console.error("[enroll-revoke] revoke failed:", error.code, error.message);
    return json(500, { ok: false, error: "Server Error" });
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.o_enrollment_id) {
    console.error("[enroll-revoke] function returned no row");
    return json(500, { ok: false, error: "Server Error" });
  }

  return json(200, {
    ok: true,
    enrollmentId: row.o_enrollment_id,
    storeId: row.o_store_id,
    sessionsRevoked: row.o_sessions_revoked,
  });
};
