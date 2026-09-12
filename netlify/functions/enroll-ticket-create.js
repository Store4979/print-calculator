// netlify/functions/enroll-ticket-create.js — an OWNER mints a single-use
// pairing ticket. Returned once, stored only as sha256.
//
// OWNER ONLY, not owner-or-manager. Part 4's matrix puts enrollment management
// in the owner row and explicitly withholds it from a PIN manager AND from an
// Auth manager: a manager credential is a counter credential, and pairing a new
// device to the store is an ownership act.
//
// The store is NOT taken on trust from the body. A caller may name one — an
// owner of several stores has to — but the name is then checked against that
// user's own memberships. What makes this safe is the check, not the absence of
// a parameter.
import { gate, json, authFailed, mintToken, hashToken } from "../lib/release2.js";
import { serviceClient } from "../lib/release2-auth.js";
import { createClient } from "@supabase/supabase-js";

let _factory = null;
let _authFactory = null;
export const __setClientFactory = (fn) => { _factory = fn; };
export const __setAuthClientFactory = (fn) => { _authFactory = fn; };

const TICKET_TTL_MS = 15 * 60 * 1000;

/** Validate the caller's Supabase access token. Null on any failure. */
async function resolveOwnerUser(event) {
  const raw = event?.headers?.authorization || event?.headers?.Authorization || "";
  const m = /^Bearer\s+(.+)$/i.exec(String(raw).trim());
  if (!m) return null;
  const token = m[1];
  try {
    const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const anon = process.env.VITE_SUPABASE_ANON_KEY;
    if (!url || !anon) return null;
    // The anon key plus the caller's token: getUser() validates signature and
    // expiry against Supabase rather than us parsing a JWT ourselves.
    const asUser = _authFactory
      ? _authFactory(token)
      : createClient(String(url).trim(), String(anon).trim(), {
          auth: { persistSession: false },
          global: { headers: { Authorization: `Bearer ${token}` } },
        });
    const { data, error } = await asUser.auth.getUser();
    if (error || !data?.user?.id) return null;
    return data.user;
  } catch {
    return null;
  }
}

export const handler = async (event) => {
  const blocked = gate(event, { method: "POST" });
  if (blocked) return blocked;

  const user = await resolveOwnerUser(event);
  if (!user) return authFailed();

  let sb;
  try { sb = serviceClient(process.env, _factory); }
  catch (e) { console.error("[enroll-ticket-create]", e.message); return json(500, { ok: false, error: "Server Error" }); }

  let body = {};
  try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { ok: false, error: "Invalid JSON" }); }
  const wantedStore = body?.storeId ? String(body.storeId) : null;

  // OWNER memberships only. A manager row here must not produce a ticket.
  let q = sb.from("memberships").select("store_id, role").eq("user_id", user.id).eq("role", "owner");
  if (wantedStore) q = q.eq("store_id", wantedStore);
  const { data: memberships, error: mErr } = await q;
  if (mErr) { console.error("[enroll-ticket-create]", mErr.message); return json(500, { ok: false, error: "Server Error" }); }
  if (!memberships || memberships.length === 0) return authFailed();
  if (!wantedStore && memberships.length > 1) {
    // Ambiguous rather than guessable: picking one silently would pair a device
    // to a store the owner did not name.
    return json(400, { ok: false, error: "storeId required: caller owns multiple stores" });
  }
  const storeId = memberships[0].store_id;

  const ticket = mintToken();
  const { data: created, error: insErr } = await sb
    .from("enrollment_tickets")
    .insert({
      store_id: storeId,
      ticket_hash: `\\x${hashToken(ticket).toString("hex")}`,
      created_by: user.id,
      expires_at: new Date(Date.now() + TICKET_TTL_MS).toISOString(),
    })
    .select("id, expires_at")
    .limit(1);
  if (insErr) { console.error("[enroll-ticket-create]", insErr.message); return json(500, { ok: false, error: "Server Error" }); }

  const row = created && created[0];
  return json(200, {
    ok: true,
    // Returned ONCE. Only sha256(ticket) was stored, so this cannot be shown
    // again — the owner must redeem it or mint another.
    ticket,
    ticketId: row?.id,
    storeId,
    expiresAt: row?.expires_at,
  });
};
