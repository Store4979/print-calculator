// netlify/functions/cleanup-stale-jobs.js
// Scheduled hourly. Deletes abandoned uploads (queue rows + their bucket
// files) older than 24h so the private bucket doesn't accumulate files
// nobody picked up. Requires Netlify Scheduled Functions to be enabled.
import { createClient } from "@supabase/supabase-js";

const BUCKET = "customer-uploads";
const SB_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const config = { schedule: "@hourly" };

export const handler = async () => {
  // Build the client lazily so a missing env var is a clean no-op, not an
  // import-time crash (see start-upload.js).
  if (!SB_KEY || !SB_URL) {
    return { statusCode: 500, body: "Supabase env not configured" };
  }
  const supabase = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: stale } = await supabase
    .from("pending_jobs")
    .select("id, files")
    .lt("created_at", cutoff);

  for (const row of stale || []) {
    const paths = (row.files || []).map((f) => f.path).filter(Boolean);
    if (paths.length) await supabase.storage.from(BUCKET).remove(paths);
    await supabase.from("pending_jobs").delete().eq("id", row.id);
  }

  return { statusCode: 200, body: `cleaned ${stale?.length || 0}` };
};
