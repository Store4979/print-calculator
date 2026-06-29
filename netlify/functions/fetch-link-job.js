// netlify/functions/fetch-link-job.js
// Turn a Google Docs / Drive link into a stored PDF + a queue row. Locked
// to Google hosts so this can't be abused as a general SSRF proxy.
import { createClient } from "@supabase/supabase-js";

const BUCKET = "customer-uploads";
const SB_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Lazy client (trim guards against pasted whitespace) — see start-upload.js.
let _supabase = null;
const getSupabase = () => (_supabase ||= createClient(String(SB_URL).trim(), String(SB_KEY).trim(), { auth: { persistSession: false } }));

const bad = (code, error) => ({ statusCode: code, body: JSON.stringify({ ok: false, error }) });
const ok  = (obj)         => ({ statusCode: 200,  body: JSON.stringify({ ok: true, ...obj }) });

// Map a supported Google URL to a direct export/download URL + filename.
// Returns null for any unsupported host (caller refuses politely).
function normalize(u) {
  let m;
  if ((m = u.match(/docs\.google\.com\/document\/d\/([\w-]+)/)))
    return { url: `https://docs.google.com/document/d/${m[1]}/export?format=pdf`, name: `google-doc-${m[1]}.pdf` };
  if ((m = u.match(/docs\.google\.com\/spreadsheets\/d\/([\w-]+)/)))
    return { url: `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=pdf`, name: `google-sheet-${m[1]}.pdf` };
  if ((m = u.match(/docs\.google\.com\/presentation\/d\/([\w-]+)/)))
    return { url: `https://docs.google.com/presentation/d/${m[1]}/export/pdf`, name: `google-slides-${m[1]}.pdf` };
  if ((m = u.match(/drive\.google\.com\/file\/d\/([\w-]+)/)))
    return { url: `https://drive.google.com/uc?export=download&id=${m[1]}`, name: `drive-${m[1]}.pdf` };
  return null;
}

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

  const { customerName, notes = "", url } = body;
  if (!customerName || !url) return bad(400, "customerName and url required");

  const target = normalize(url);
  if (!target) return bad(400, "Only Google Docs and Google Drive links are supported. For anything else, please upload the file directly.");

  let resp;
  try {
    resp = await fetch(target.url, { redirect: "follow" });
  } catch {
    return bad(400, "Couldn't reach that link. Please upload the file directly.");
  }
  const ct = resp.headers.get("content-type") || "";
  if (!resp.ok || /text\/html/i.test(ct))
    return bad(400, "That link isn't publicly viewable. Set sharing to 'Anyone with the link', or download it as a PDF and upload the file instead.");

  const buf = Buffer.from(await resp.arrayBuffer());
  if (buf.byteLength > 50 * 1024 * 1024) return bad(400, "File is too large (over 50 MB).");

  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Detroit" }).format(new Date());
  const path = `${date}/${crypto.randomUUID()}-${target.name}`;

  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, buf, { contentType: ct || "application/pdf", upsert: false });
  if (upErr) return bad(500, upErr.message);

  const { count } = await supabase
    .from("pending_jobs")
    .select("id", { count: "exact", head: true })
    .eq("job_date", date);
  const queue_number = (count || 0) + 1;

  const { data, error } = await supabase
    .from("pending_jobs")
    .insert({
      customer_name: customerName.trim().slice(0, 40),
      notes: String(notes || "").slice(0, 500),
      source: "link",
      files: [{ name: target.name, path, type: ct || "application/pdf", page_count: null }],
      job_date: date,
      queue_number,
    })
    .select()
    .single();
  if (error) return bad(500, error.message);

  return ok({ job: data });
};
