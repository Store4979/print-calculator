// netlify/functions/register-job.js
// Create the pending_jobs queue row after the customer's files are uploaded
// to the private bucket. Service-role only — the anon key can read this
// table but never write it.
import { createClient } from "@supabase/supabase-js";

const SB_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Lazy client — see start-upload.js for why this must not run at import.
let _supabase = null;
const getSupabase = () => (_supabase ||= createClient(SB_URL, SB_KEY, { auth: { persistSession: false } }));

const bad = (code, error) => ({ statusCode: code, body: JSON.stringify({ ok: false, error }) });
const ok  = (obj)         => ({ statusCode: 200,  body: JSON.stringify({ ok: true, ...obj }) });

export const handler = async (event) => {
  if (event.httpMethod !== "POST") return bad(405, "Method Not Allowed");
  if (!SB_KEY) return bad(500, "Service role key not configured");
  if (!SB_URL) return bad(500, "Supabase URL not configured");
  const supabase = getSupabase();

  let body = {};
  try { body = JSON.parse(event.body || "{}"); }
  catch { return bad(400, "Invalid JSON"); }

  const { customerName, notes = "", source = "upload", files = [] } = body;
  if (!customerName || !Array.isArray(files) || files.length === 0)
    return bad(400, "customerName and at least one file required");

  const job_date = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Detroit" }).format(new Date());

  // Per-day queue position. Best-effort count — a rare race could collide,
  // which is acceptable for an in-store walk-up queue.
  const { count } = await supabase
    .from("pending_jobs")
    .select("id", { count: "exact", head: true })
    .eq("job_date", job_date);
  const queue_number = (count || 0) + 1;

  const { data, error } = await supabase
    .from("pending_jobs")
    .insert({
      customer_name: customerName.trim().slice(0, 40),
      notes: String(notes || "").slice(0, 500),
      source,
      files,
      job_date,
      queue_number,
    })
    .select()
    .single();
  if (error) return bad(500, error.message);

  return ok({ job: data });
};
