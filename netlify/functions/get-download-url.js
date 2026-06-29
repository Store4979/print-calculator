// netlify/functions/get-download-url.js
// Mint short-lived (15 min) signed download URLs so staff can open/print
// customer files. The bucket is private, so a stored path is useless
// without one of these server-minted URLs.
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

  const { paths } = body;
  if (!Array.isArray(paths) || paths.length === 0) return bad(400, "paths required");

  const urls = [];
  for (const p of paths) {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(p, 900); // 15 min
    urls.push({ path: p, url: error ? null : data.signedUrl });
  }

  return ok({ urls });
};
