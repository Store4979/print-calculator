// netlify/functions/start-upload.js
// Mint a short-lived signed upload URL for ONE customer file. The bucket
// is private; this token is the only thing that authorizes the upload, so
// no anon storage policy is needed. Service-role only — never client-side.
import { createClient } from "@supabase/supabase-js";

const BUCKET = "customer-uploads";
const SB_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Lazily construct the client AFTER the env guard. createClient() throws
// synchronously when the key/url is falsy, so building it at module scope
// turns a missing env var into an opaque 502 (crash on import) instead of
// the clean 500 below.
// Trim the env values — a pasted trailing space/newline makes createClient
// throw "Invalid URL", which would otherwise surface as an opaque 502.
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

  const { fileName } = body;
  if (!fileName) return bad(400, "fileName required");

  const safe = String(fileName).replace(/[^\w.\-]+/g, "_").slice(-80);
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Detroit" }).format(new Date());
  const path = `${date}/${crypto.randomUUID()}-${safe}`;

  const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(path);
  if (error) return bad(500, error.message);

  return ok({ path: data.path, token: data.token });
};
