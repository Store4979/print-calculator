// ============================================================
//  CUSTOMER SELF-SERVE UPLOAD PAGE  (entry: /upload)
//  Mobile-first. Customer picks a file/photo (or pastes a Google
//  Docs/Drive link), enters a first name, and lands in the live
//  staff Print Queue. Files go to a PRIVATE bucket via short-lived
//  signed upload tokens minted by Netlify functions; this page only
//  ever uses the public anon key.
// ============================================================
import { useState } from "react";
import { supabase, isSupabaseConfigured } from "./lib/supabase.js";

const BUCKET = "customer-uploads";
const MAX_BYTES = 50 * 1024 * 1024; // 50 MB per file

// File <input> accept list — images, PDFs, and the common Office types.
const ACCEPT = [
  "image/*",
  ".heic", ".heif",
  "application/pdf", ".pdf",
  ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
].join(",");

// ── Module-scope helpers (no component state) ──
const FN = (name) => `/.netlify/functions/${name}`;

async function callFn(name, payload) {
  const res = await fetch(FN(name), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload || {}),
  });
  let json = {};
  try { json = await res.json(); } catch { /* non-JSON */ }
  if (!res.ok || !json.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json;
}

const isHeic = (file) =>
  /\.(heic|heif)$/i.test(file.name || "") || /heic|heif/i.test(file.type || "");

const isPdf = (file) =>
  file.type === "application/pdf" || /\.pdf$/i.test(file.name || "");

const isImage = (file) =>
  (file.type || "").startsWith("image/") && !isHeic(file);

const fmtBytes = (n) => {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
};

// Count PDF pages with the CDN-global pdf.js (same approach as the main app).
async function countPdfPages(file) {
  try {
    if (!window.pdfjsLib) return null;
    const buf = await file.arrayBuffer();
    const doc = await window.pdfjsLib.getDocument({ data: buf }).promise;
    return doc.numPages || null;
  } catch {
    return null;
  }
}

// Convert an iPhone HEIC/HEIF to JPEG. heic2any is dynamically imported so
// it only loads for the handful of customers who actually bring a HEIC.
async function convertHeic(file) {
  const heic2any = (await import("heic2any")).default;
  const blob = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.92 });
  const out = Array.isArray(blob) ? blob[0] : blob;
  const name = (file.name || "photo").replace(/\.(heic|heif)$/i, "") + ".jpg";
  return new File([out], name, { type: "image/jpeg" });
}

// Prepare a picked file for upload: convert HEIC, count pages, size-guard.
// Returns { file, name, type, page_count } or throws a friendly error.
async function prepareFile(rawFile, onStatus) {
  let file = rawFile;

  if (isHeic(file)) {
    onStatus?.("Converting iPhone photo…");
    file = await convertHeic(file);
  }

  if (file.size > MAX_BYTES) {
    throw new Error(`"${file.name}" is too large (${fmtBytes(file.size)}). Max is 50 MB.`);
  }

  let page_count = null;
  if (isPdf(file)) {
    onStatus?.("Reading PDF…");
    page_count = await countPdfPages(file);
  } else if (isImage(file)) {
    page_count = 1;
  } // Office docs stay page_count = null

  return { file, name: file.name, type: file.type || "application/octet-stream", page_count };
}

export default function UploadApp() {
  const [name, setName]       = useState("");
  const [picked, setPicked]   = useState([]);   // [{ file, name, type, page_count }]
  const [link, setLink]       = useState("");
  const [notes, setNotes]     = useState("");
  const [busy, setBusy]       = useState(false);
  const [status, setStatus]   = useState("");    // progress line while sending
  const [error, setError]     = useState("");
  const [done, setDone]       = useState(null);  // { name, queueNumber }

  const handlePick = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = ""; // allow re-picking the same file
    if (!files.length) return;
    setError("");
    setBusy(true);
    try {
      const prepared = [];
      for (const f of files) {
        prepared.push(await prepareFile(f, setStatus));
      }
      setPicked((prev) => [...prev, ...prepared]);
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
      setStatus("");
    }
  };

  const removePicked = (idx) => setPicked((prev) => prev.filter((_, i) => i !== idx));

  const canSend = !busy && name.trim() && (picked.length > 0 || link.trim());

  const reset = () => {
    setPicked([]); setLink(""); setNotes(""); setError(""); setDone(null); setStatus("");
  };

  const handleSend = async () => {
    if (!canSend) return;
    setError("");
    setBusy(true);
    try {
      if (!isSupabaseConfigured || !supabase) {
        throw new Error("Uploads aren't configured right now. Please ask the counter staff for help.");
      }

      // Link path takes precedence when a link is entered.
      if (link.trim()) {
        setStatus("Importing your link…");
        const { job } = await callFn("fetch-link-job", {
          customerName: name, notes, url: link.trim(),
        });
        setDone({ name: job.customer_name, queueNumber: job.queue_number });
        return;
      }

      // File path: upload each picked file to its own signed URL, then register.
      const fileRecords = [];
      for (let i = 0; i < picked.length; i++) {
        const item = picked[i];
        setStatus(`Uploading file ${i + 1} of ${picked.length}…`);
        const { path, token } = await callFn("start-upload", {
          fileName: item.name, fileType: item.type,
        });
        const { error: upErr } = await supabase.storage
          .from(BUCKET)
          .uploadToSignedUrl(path, token, item.file);
        if (upErr) throw new Error(upErr.message || "Upload failed. Please try again.");
        fileRecords.push({ name: item.name, path, type: item.type, page_count: item.page_count });
      }

      setStatus("Adding you to the queue…");
      const { job } = await callFn("register-job", {
        customerName: name, notes, source: "upload", files: fileRecords,
      });
      setDone({ name: job.customer_name, queueNumber: job.queue_number });
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
      setStatus("");
    }
  };

  // ── Success screen ──
  if (done) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center px-5 py-10 text-center">
        <div className="w-full max-w-md bg-white rounded-2xl shadow-lg p-8">
          <div className="text-5xl mb-3">✅</div>
          <h1 className="text-2xl font-extrabold text-slate-900">
            You're in the queue, {done.name}!
          </h1>
          <p className="mt-3 text-lg text-slate-700">
            You're <span className="font-extrabold text-teal-700">#{done.queueNumber}</span>.
          </p>
          <p className="mt-1 text-slate-500">Show this number at the counter.</p>
          <button
            onClick={reset}
            className="mt-8 w-full rounded-xl bg-slate-100 text-slate-700 font-semibold py-3 active:scale-[0.99]"
          >
            Send another file
          </button>
        </div>
        <p className="mt-6 text-xs text-slate-400">The UPS Store #4979 · 4352 Bay Road, Saginaw</p>
      </div>
    );
  }

  // ── Upload form ──
  return (
    <div className="min-h-screen bg-slate-50 px-5 py-8">
      <div className="w-full max-w-md mx-auto">
        <header className="text-center mb-6">
          <div className="text-2xl font-extrabold text-slate-900">The UPS Store #4979</div>
          <div className="text-slate-500 mt-1">Send us your file to print</div>
        </header>

        <div className="bg-white rounded-2xl shadow-sm p-5 space-y-5">
          {/* First name */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">Your first name</label>
            <input
              type="text"
              inputMode="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Alex"
              maxLength={40}
              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-base focus:border-teal-500 focus:outline-none"
            />
          </div>

          {/* File picker */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">Choose file or photo</label>
            <label className="block w-full cursor-pointer rounded-xl border-2 border-dashed border-teal-400 bg-teal-50 text-teal-800 font-semibold text-center py-6 active:scale-[0.99]">
              📎 Tap to choose a file or photo
              <input type="file" accept={ACCEPT} multiple className="hidden" onChange={handlePick} disabled={busy} />
            </label>
            <p className="text-xs text-slate-400 mt-1">Photos, PDFs, Word/Excel/PowerPoint — multiple OK.</p>

            {picked.length > 0 && (
              <ul className="mt-3 space-y-2">
                {picked.map((it, i) => (
                  <li key={i} className="flex items-center gap-3 rounded-lg bg-slate-50 border border-slate-200 px-3 py-2">
                    <span className="text-lg">{isPdf(it.file) ? "📄" : (it.file.type || "").startsWith("image/") ? "🖼️" : "📑"}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-slate-800 truncate">{it.name}</div>
                      <div className="text-xs text-slate-400">
                        {fmtBytes(it.file.size)}
                        {it.page_count ? ` · ${it.page_count} page${it.page_count === 1 ? "" : "s"}` : ""}
                      </div>
                    </div>
                    <button onClick={() => removePicked(i)} className="text-slate-400 text-xl leading-none px-1" aria-label="Remove">×</button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Google link */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">…or paste a Google Docs / Drive link</label>
            <input
              type="url"
              inputMode="url"
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder="https://docs.google.com/…"
              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-base focus:border-teal-500 focus:outline-none"
            />
            <p className="text-xs text-slate-400 mt-1">Set sharing to “Anyone with the link.”</p>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">Notes (optional)</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. double-sided, 2 copies, color"
              maxLength={500}
              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-base focus:border-teal-500 focus:outline-none"
            />
          </div>

          {error && (
            <div className="rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3">
              {error}
            </div>
          )}

          <button
            onClick={handleSend}
            disabled={!canSend}
            className="w-full rounded-xl bg-teal-600 text-white font-extrabold text-lg py-4 disabled:bg-slate-300 disabled:text-slate-500 active:scale-[0.99]"
          >
            {busy ? (status || "Sending…") : "Send to the Print Counter"}
          </button>
        </div>

        <p className="mt-6 text-center text-xs text-slate-400">
          4352 Bay Road, Saginaw MI · 989.790.9701
        </p>
      </div>
    </div>
  );
}
