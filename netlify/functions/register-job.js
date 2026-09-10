// netlify/functions/register-job.js
// Create the pending_jobs queue row after the customer's files are uploaded
// to the private bucket. Service-role only — the anon key can read this
// table but never write it.
import { createClient } from "@supabase/supabase-js";

const SB_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Lazy client (trim guards against pasted whitespace) — see start-upload.js.
let _supabase = null;
const getSupabase = () => (_supabase ||= createClient(String(SB_URL).trim(), String(SB_KEY).trim(), { auth: { persistSession: false } }));

const bad = (code, error) => ({ statusCode: code, body: JSON.stringify({ ok: false, error }) });
const ok  = (obj)         => ({ statusCode: 200,  body: JSON.stringify({ ok: true, ...obj }) });

// Bundle marker. This repo has hit Netlify function dedup before (a bundle
// digest that didn't change, so an updated function silently kept serving the
// old code — see the [functions] included_files note in netlify.toml). The
// queue retry is unreachable until the unique constraint exists, so it cannot
// be proven from behaviour before the constraint is applied. Probe the deploy
// instead:
//     curl -s https://printcalculator2.netlify.app/.netlify/functions/register-job
// A GET performs no work and touches no database; it just reports which
// algorithm the LIVE bundle contains. Confirm this says max+1 with a retry
// budget BEFORE applying the B2 constraint.
const QUEUE_ALGO = "max(queue_number)+1 per (store_id, job_date)";
const RETRY_BUDGET = 5;

export const handler = async (event) => {
  if (event.httpMethod === "GET") {
    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        fn: "register-job",
        queueAlgo: QUEUE_ALGO,
        retryBudget: RETRY_BUDGET,
        retriesOn: "23505",
        storeScoped: true,
      }),
    };
  }
  if (event.httpMethod !== "POST") return bad(405, "Method Not Allowed");
  if (!SB_KEY) return bad(500, "Service role key not configured");
  if (!SB_URL) return bad(500, "Supabase URL not configured");
  let supabase;
  try { supabase = getSupabase(); }
  catch (e) { return bad(500, "Supabase init failed (check SUPABASE_URL value): " + (e?.message || String(e))); }

  let body = {};
  try { body = JSON.parse(event.body || "{}"); }
  catch { return bad(400, "Invalid JSON"); }

  const { customerName, notes = "", source = "upload", files = [], storeSlug } = body;
  if (!customerName || !Array.isArray(files) || files.length === 0)
    return bad(400, "customerName and at least one file required");

  // Resolve the tenant server-side. Queue numbering and the uniqueness
  // constraint are both per-store; without this, one store's uploads
  // renumber another's queue. Full caller validation (proving the requester
  // is entitled to this store) is Phase B section 5 — this resolves and
  // stamps, which is what the numbering correctness depends on.
  const slug = String(storeSlug || process.env.STORE_SLUG || "store4979").trim();
  const { data: store, error: storeErr } = await supabase
    .from("stores").select("id, org_id").eq("slug", slug).maybeSingle();
  if (storeErr) return bad(500, "Store lookup failed: " + storeErr.message);
  if (!store)   return bad(400, "Unknown store: " + slug);

  const job_date = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Detroit" }).format(new Date());

  // Queue position: max(queue_number)+1 for THIS store on THIS day.
  //
  // Deliberately not count(*), which was the previous approach and is wrong
  // once rows can disappear: complete-job DELETEs a row on pickup, so the
  // count drops and the next customer is handed a number already used that
  // day. Silently duplicated before; with the unique constraint it would be a
  // hard 23505. max+1 never reissues a number while the earlier job is live.
  //
  // Two writers can still read the same max concurrently, so the unique
  // constraint is the real arbiter and this retries on violation. Bounded at
  // 5: each retry re-reads the max, so it converges in one or two rounds
  // under any realistic counter load. If it ever proves flaky, the fix is a
  // txn-scoped advisory lock on hash(store_id, job_date) — NOT a higher
  // retry count, which just lengthens the window without removing the race.
  const MAX_ATTEMPTS = RETRY_BUDGET;   // single source of truth with the GET probe
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const { data: top, error: topErr } = await supabase
      .from("pending_jobs")
      .select("queue_number")
      .eq("store_id", store.id)
      .eq("job_date", job_date)
      .order("queue_number", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (topErr) return bad(500, topErr.message);

    const queue_number = (top?.queue_number || 0) + 1;

    const { data, error } = await supabase
      .from("pending_jobs")
      .insert({
        customer_name: customerName.trim().slice(0, 40),
        notes: String(notes || "").slice(0, 500),
        source,
        files,
        job_date,
        queue_number,
        store_id: store.id,
        org_id: store.org_id,
      })
      .select()
      .single();

    if (!error) return ok({ job: data });

    // 23505 = unique_violation: another upload took this number between our
    // read and our insert. Re-read and try again rather than failing the
    // customer, whose files are already in the bucket at this point.
    if (error.code === "23505") { lastError = error; continue; }
    return bad(500, error.message);
  }

  // Exhausted retries. The files uploaded fine; only the queue row failed.
  return bad(
    409,
    "The queue is busy right now — please ask the counter to add you. " +
    "(" + (lastError?.message || "queue number collision") + ")"
  );
};
