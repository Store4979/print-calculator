// netlify/functions/complete-job.js
// Picked up → delete the customer's files from the bucket and remove the
// queue row. Service-role only.
import { createClient } from "@supabase/supabase-js";

const BUCKET = "customer-uploads";
const SB_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Lazy client (trim guards against pasted whitespace) — see start-upload.js.
let _supabase = null;
const getSupabase = () => (_supabase ||= createClient(String(SB_URL).trim(), String(SB_KEY).trim(), { auth: { persistSession: false } }));

const bad = (code, error) => ({ statusCode: code, body: JSON.stringify({ ok: false, error }) });
const ok  = (obj)         => ({ statusCode: 200,  body: JSON.stringify({ ok: true, ...obj }) });

export const handler = async (event) => {
  if (event.httpMethod !== "POST") return bad(405, "Method Not Allowed");
  if (!SB_KEY) return bad(500, "Service role key not configured");
  if (!SB_URL) return bad(500, "Supabase URL not configured");
  let supabase;
  try { supabase = getSupabase(); }
  catch (e) { return bad(500, "Supabase init failed (check SUPABASE_URL value): " + (e?.message || String(e))); }

  let body = {};
  try { body = JSON.parse(event.body || "{}"); }
  catch { return bad(400, "Invalid JSON"); }

  const { id } = body;
  if (!id) return bad(400, "id required");

  const { data: row, error: e1 } = await supabase
    .from("pending_jobs").select("files").eq("id", id).single();
  if (e1) return bad(404, "Job not found");

  const paths = (row.files || []).map((f) => f.path).filter(Boolean);
  if (paths.length) await supabase.storage.from(BUCKET).remove(paths);

  const { error: e2 } = await supabase.from("pending_jobs").delete().eq("id", id);
  if (e2) return bad(500, e2.message);

  return ok({ deleted: id });
};
