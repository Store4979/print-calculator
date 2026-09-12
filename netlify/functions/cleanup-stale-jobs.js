// netlify/functions/cleanup-stale-jobs.js
// Deletes abandoned uploads (queue rows + their bucket files) older than 24h
// so the private bucket doesn't accumulate files nobody picked up.
//
// ── ROW 41 FINDING, 2026-09-12: THIS WAS AN UNAUTHENTICATED DESTRUCTIVE URL ──
// The previous handler was `export const handler = async () => {…}` — it did
// not receive the event, so there was nothing to check a method, a caller or a
// header against. ANY request of ANY shape ran the deletion loop with the
// service-role key.
//
// The plan and two review rounds all assumed this was unreachable because
// Netlify documents scheduled functions as not HTTP-invocable. **Measured on
// this deployment, it returns 200 over plain HTTP.** The documentation
// described a behaviour this deployment does not have, and an assumption that
// survived two reviews was simply false.
//
// Blast radius when it was live: nothing older than 24h existed in staging or
// production at the time, so the probe deleted nothing. The exposure was
// UNLOADED, NOT ABSENT — it arms the moment a QR upload sits in the queue past
// 24h, which is the normal case for an abandoned job.
//
// ── WHY THIS REQUIRES A SECRET RATHER THAN DETECTING THE SCHEDULER ──────────
// Netlify's scheduled invocation carries no signature. Its distinguishing
// feature is a POST body of {"next_run": "<ISO>"} — which any caller can send.
// So there is NO reliable way to tell a scheduled run from a forged one on
// this platform, and writing a check that pretends otherwise would repeat the
// exact mistake that produced this finding: trusting an undocumented platform
// signal.
//
// Therefore: deny by default, require a shared secret, and FAIL IN THE
// DIRECTION OF NOT DELETING. A cleanup that pauses leaves customer files in a
// private bucket longer than intended, which is a real but bounded privacy
// cost. An unauthenticated delete endpoint is unbounded. Between the two, the
// pause is correct.
//
// CONSEQUENCE, STATED PLAINLY: the Netlify scheduler cannot send the secret,
// so the hourly schedule will now FAIL CLOSED (401) instead of running. That
// is intended, and it is visible rather than silent. Cleanup must be driven by
// a caller that can authenticate — see "Re-arming the schedule" below.
import { createClient } from "@supabase/supabase-js";
import { timingSafeEqual } from "node:crypto";

const BUCKET = "customer-uploads";
// Read at CALL time, not module scope: module-scope reads bake in whatever the
// environment was at import, which makes the guard untestable and hides a
// missing variable behind a stale value.
const sbUrl = () => process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const sbKey = () => process.env.SUPABASE_SERVICE_ROLE_KEY;
const MAX_BATCH = 500;

// Injectable client factory, matching send-print-job.js's __setTransportFactory
// pattern: the destructive path must be exercisable in tests without a live
// Supabase, and without the test reaching into module internals.
let _clientFactory = null;
export const __setClientFactory = (fn) => { _clientFactory = fn; };

const res = (statusCode, obj) => ({
  statusCode,
  headers: { "content-type": "application/json", "cache-control": "no-store" },
  body: JSON.stringify(obj),
});

/** Constant-time. False on length mismatch, on empty, and on anything odd. */
function secretOk(presented, expected) {
  const a = Buffer.from(String(presented ?? ""), "utf8");
  const b = Buffer.from(String(expected ?? ""), "utf8");
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export const config = { schedule: "@hourly" };

export const handler = async (event) => {
  // 1. Method. The old handler accepted anything, including GET — a
  //    destructive action reachable by a URL a browser could be made to visit.
  if (event?.httpMethod !== "POST") {
    return res(405, { ok: false, error: "Method Not Allowed" });
  }

  // 2. Caller. No secret configured means REFUSE, never "allow because
  //    unconfigured" — the failure mode that makes a guard decorative.
  const expected = String(process.env.CLEANUP_SECRET || "").trim();
  if (!expected) {
    console.error("[cleanup] CLEANUP_SECRET is not set; refusing to run.");
    return res(503, { ok: false, error: "Service Unavailable" });
  }
  const presented =
    event?.headers?.["x-cleanup-key"] || event?.headers?.["X-Cleanup-Key"] || "";
  if (!secretOk(presented, expected)) {
    console.warn("[cleanup] rejected: bad or missing x-cleanup-key");
    // 401 with no detail. A caller learns nothing about why.
    return res(401, { ok: false, error: "Unauthorized" });
  }

  if (!sbKey() || !sbUrl()) return res(500, { ok: false, error: "Supabase env not configured" });
  let supabase;
  try {
    supabase = _clientFactory
      ? _clientFactory()
      : createClient(String(sbUrl()).trim(), String(sbKey()).trim(), { auth: { persistSession: false } });
  } catch (e) {
    return res(500, { ok: false, error: "Supabase init failed: " + (e?.message || String(e)) });
  }

  // 3. Dry run is available to authenticated callers, so the sweep can be
  //    inspected before it deletes. It is NOT the default: leaving cleanup
  //    silently disabled would trade one privacy problem for another.
  let body = {};
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return res(400, { ok: false, error: "Invalid JSON" });
  }
  const dryRun = body?.dryRun === true;

  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: stale, error: selErr } = await supabase
    .from("pending_jobs")
    .select("id, files, created_at")
    .lt("created_at", cutoff)
    .limit(MAX_BATCH);
  if (selErr) return res(500, { ok: false, error: selErr.message });

  const rows = stale || [];
  if (dryRun) {
    return res(200, {
      ok: true,
      dryRun: true,
      wouldDelete: rows.length,
      wouldRemoveObjects: rows.reduce(
        (n, r) => n + (r.files || []).filter((f) => f?.path).length,
        0
      ),
      cutoff,
    });
  }

  let deleted = 0;
  let objects = 0;
  for (const row of rows) {
    const paths = (row.files || []).map((f) => f.path).filter(Boolean);
    if (paths.length) {
      const { error } = await supabase.storage.from(BUCKET).remove(paths);
      if (error) {
        // Do not delete the row whose files failed to go — that would orphan
        // the objects with nothing left pointing at them.
        console.error("[cleanup] storage remove failed for", row.id, error.message);
        continue;
      }
      objects += paths.length;
    }
    const { error: delErr } = await supabase.from("pending_jobs").delete().eq("id", row.id);
    if (delErr) {
      console.error("[cleanup] row delete failed for", row.id, delErr.message);
      continue;
    }
    deleted += 1;
  }

  console.log(`[cleanup] deleted ${deleted} rows, ${objects} objects, cutoff ${cutoff}`);
  return res(200, { ok: true, deleted, objects, cutoff, batchCapped: rows.length === MAX_BATCH });
};

// ── RE-ARMING THE SCHEDULE ──────────────────────────────────────────────────
// The `config.schedule` export above is deliberately kept so the intent stays
// visible in code, but the scheduled invocation will now receive 401 because
// Netlify cannot attach the secret. Cleanup therefore does NOT run on a timer
// until a caller that can authenticate drives it. Options, in order of
// preference:
//
//   1. Supabase pg_cron + pg_net: schedule an hourly POST to this URL with the
//      x-cleanup-key header, with the secret held in the database. Keeps the
//      schedule server-side and authenticated. Testable on staging first.
//   2. A GitHub Actions scheduled workflow holding the secret in repo secrets.
//   3. Manual invocation by the owner when the queue needs sweeping.
//
// Until one is in place, abandoned uploads persist past 24h. That is a known,
// bounded cost recorded here rather than left to be discovered — and it is the
// safer side of the trade, because the alternative was a delete endpoint
// anyone could call.
