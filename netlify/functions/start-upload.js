// netlify/functions/start-upload.js
// Mint a short-lived signed upload URL for ONE customer file. The bucket
// is private; this token is the only thing that authorizes the upload, so
// no anon storage policy is needed. Service-role only — never client-side.
import { createClient } from "@supabase/supabase-js";

const BUCKET = "customer-uploads";
const supabase = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const bad = (code, error) => ({ statusCode: code, body: JSON.stringify({ ok: false, error }) });
const ok  = (obj)         => ({ statusCode: 200,  body: JSON.stringify({ ok: true, ...obj }) });

export const handler = async (event) => {
  if (event.httpMethod !== "POST") return bad(405, "Method Not Allowed");
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return bad(500, "Service role key not configured");

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
