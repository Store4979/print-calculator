// netlify/functions/enroll-list.js — an OWNER lists the devices paired to a
// store, including revoked ones with their reason. This is the audit view.
//
// OWNER ONLY (Part 4). Tenant-scoped: the store is the caller's own owner
// membership — named with ?storeId= when the owner has several — and every
// query below is filtered by that resolved store id, never by anything else
// the caller sent.
//
// NEVER RETURNED: device_token_hash, csrf_secret, created_by / revoked_by user
// ids, session ids, employee ids. The selects name their columns; there is no
// select("*") in this file and the tests assert a fake row carrying hash and
// secret fields does not reach the body.
//
// liveSessions is a count, so the owner can see which tablet someone is
// signed in on without the response carrying a session.
import { gate, json, authFailed } from "../lib/release2.js";
import { serviceClient, resolveOwnerUser } from "../lib/release2-auth.js";

let _factory = null;
let _authFactory = null;
export const __setClientFactory = (fn) => { _factory = fn; };
export const __setAuthClientFactory = (fn) => { _authFactory = fn; };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const handler = async (event) => {
  // GET, no body — the Origin allowlist still applies (this response would
  // let a cross-site page enumerate a store's devices).
  const blocked = gate(event, { method: "GET", requireJson: false });
  if (blocked) return blocked;

  const user = await resolveOwnerUser(event, _authFactory);
  if (!user) return authFailed();

  let sb;
  try { sb = serviceClient(process.env, _factory); }
  catch (e) { console.error("[enroll-list]", e.message); return json(500, { ok: false, error: "Server Error" }); }

  const wanted = event?.queryStringParameters?.storeId ? String(event.queryStringParameters.storeId) : null;
  if (wanted && !UUID.test(wanted)) return json(400, { ok: false, error: "storeId must be a uuid" });

  // OWNER memberships only, same shape as enroll-ticket-create.
  let q = sb.from("memberships").select("store_id, role").eq("user_id", user.id).eq("role", "owner");
  if (wanted) q = q.eq("store_id", wanted);
  const { data: memberships, error: mErr } = await q;
  if (mErr) { console.error("[enroll-list]", mErr.message); return json(500, { ok: false, error: "Server Error" }); }
  if (!memberships || memberships.length === 0) return authFailed();
  if (!wanted && memberships.length > 1) {
    return json(400, { ok: false, error: "storeId required: caller owns multiple stores" });
  }
  const storeId = memberships[0].store_id;

  const { data: devices, error: dErr } = await sb
    .from("device_enrollments")
    .select("id, label, created_at, last_seen_at, revoked_at, revoked_reason")
    .eq("store_id", storeId);
  if (dErr) { console.error("[enroll-list]", dErr.message); return json(500, { ok: false, error: "Server Error" }); }

  const { data: live, error: sErr } = await sb
    .from("staff_sessions")
    .select("enrollment_id")
    .eq("store_id", storeId)
    .is("revoked_at", null);
  if (sErr) { console.error("[enroll-list]", sErr.message); return json(500, { ok: false, error: "Server Error" }); }

  const liveByEnrollment = new Map();
  for (const s of live || []) liveByEnrollment.set(s.enrollment_id, (liveByEnrollment.get(s.enrollment_id) || 0) + 1);

  const out = (devices || [])
    .map((d) => ({
      id: d.id,
      label: d.label,
      createdAt: d.created_at,
      lastSeenAt: d.last_seen_at ?? null,
      revokedAt: d.revoked_at ?? null,
      revokedReason: d.revoked_reason ?? null,
      liveSessions: liveByEnrollment.get(d.id) || 0,
    }))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

  return json(200, { ok: true, storeId, devices: out });
};
