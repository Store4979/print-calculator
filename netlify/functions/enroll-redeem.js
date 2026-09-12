// netlify/functions/enroll-redeem.js — redeem a pairing ticket into a device
// enrollment, and install the device credential.
//
// ── ROW 52: ATOMICITY IS THE WHOLE POINT ───────────────────────────────────
// The ticket burn and the enrollment INSERT are ONE transaction. This handler
// does not perform them; it calls redeem_enrollment_ticket(), whose plpgsql
// body IS the transaction, so there is no window between the two statements in
// which a crash can leave:
//
//   - ticket consumed, no enrollment  → owner holds a dead ticket and cannot
//     tell whether a device was paired
//   - enrollment created, ticket live → the SAME ticket pairs a SECOND device,
//     which is single-use lost
//
// Doing it as two round trips from here would reintroduce exactly that window,
// which is why the logic is in the database and this file is thin.
//
// ── CREDENTIAL-INSTALLING ENDPOINT ─────────────────────────────────────────
// This responds with Set-Cookie and requires no cookie of its own, so a
// cross-site POST reaches it and the response would plant the ATTACKER'S device
// credential in a victim's browser — the victim's counter would then be
// enrolled to a store the attacker controls. "No cookie in, no CSRF" only ever
// applied to the credential going IN. gate() therefore enforces an Origin
// allowlist and a required JSON content type, which together block the
// form-POST shape that needs no preflight.
import { gate, json, authFailed, mintToken, hashToken, mintCsrfSecret, setHostCookie } from "../lib/release2.js";
import { COOKIE, LIMITS, recordAttempt, serviceClient, csrfToken } from "../lib/release2-auth.js";

let _factory = null;
export const __setClientFactory = (fn) => { _factory = fn; };

const DEVICE_COOKIE_MAX_AGE = 400 * 24 * 60 * 60; // browsers cap at ~400 days

export const handler = async (event) => {
  const blocked = gate(event, { method: "POST" });
  if (blocked) return blocked;

  let sb;
  try {
    sb = serviceClient(process.env, _factory);
  } catch (e) {
    console.error("[enroll-redeem]", e.message);
    return json(500, { ok: false, error: "Server Error" });
  }

  let body = {};
  try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { ok: false, error: "Invalid JSON" }); }
  const ticket = String(body?.ticket ?? "");
  const label = String(body?.label ?? "").trim().slice(0, 120);
  if (!ticket || !label) return authFailed();

  // Rate-limited on a PREFIX of the ticket hash, not the ticket itself: the
  // subject is stored in a table, and storing anything derived from a live
  // credential at full strength would defeat the point of only keeping hashes.
  // A prefix is enough to group attempts without being a lookup key.
  const ticketHash = hashToken(ticket);
  const subject = `ticket:${ticketHash.toString("hex").slice(0, 16)}`;
  try {
    const budget = await recordAttempt(sb, "ticket", subject, LIMITS.ticket);
    if (!budget.allowed) return json(429, { ok: false, error: "Too Many Attempts" });
  } catch (e) {
    console.error("[enroll-redeem] limiter unavailable:", e.message);
    return json(503, { ok: false, error: "Service Unavailable" });
  }

  const token = mintToken();
  const csrf = mintCsrfSecret();

  // ONE call. Either the ticket is burned AND the enrollment exists, or
  // neither happened. No credential is minted into the response before the
  // commit, because the function returns only after committing.
  const { data, error } = await sb.rpc("redeem_enrollment_ticket", {
    p_ticket_hash: `\\x${ticketHash.toString("hex")}`,
    p_token_hash: `\\x${hashToken(token).toString("hex")}`,
    p_csrf_secret: `\\x${csrf.toString("hex")}`,
    p_label: label,
  });

  if (error) {
    // 28000 is the deliberate single answer for replay, expiry AND revocation —
    // a caller must not be able to tell which, or a probe could enumerate live
    // tickets. Anything else is a real fault and is logged, not explained.
    if (!/28000/.test(error.code || "") && !/not redeemable/i.test(error.message || "")) {
      console.error("[enroll-redeem] unexpected:", error.code, error.message);
    }
    return authFailed();
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.enrollment_id) {
    console.error("[enroll-redeem] rpc returned no enrollment");
    return authFailed();
  }

  return json(
    200,
    {
      ok: true,
      // The device token is returned ONCE, here, and never again — only its
      // sha256 was stored. The enrollment id is safe to return: it is not a
      // credential and the owner needs it to manage the device.
      enrollmentId: row.enrollment_id,
      csrf: csrfToken(csrf),
    },
    { "set-cookie": setHostCookie(COOKIE.device, token, DEVICE_COOKIE_MAX_AGE) }
  );
};
