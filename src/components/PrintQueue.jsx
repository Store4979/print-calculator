// ============================================================
//  STAFF PRINT QUEUE  (App.jsx tab: "queue")
//  Live list of customer self-serve uploads. Subscribes to the
//  pending_jobs table via the anon key (SELECT-only). File access is
//  always through server-minted signed URLs — staff never hold a
//  durable link. Actions: Open/Print, Send to Calculator, Picked Up.
// ============================================================
import { useEffect, useMemo, useState } from "react";
import { supabase, isSupabaseConfigured } from "../lib/supabase.js";

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

const minutesWaiting = (createdAt) => {
  if (!createdAt) return "";
  const ms = Date.now() - new Date(createdAt).getTime();
  const m = Math.max(0, Math.floor(ms / 60000));
  if (m < 1) return "just now";
  if (m < 60) return `waiting ${m}m`;
  const h = Math.floor(m / 60);
  return `waiting ${h}h ${m % 60}m`;
};

const fileIcon = (type = "") =>
  type === "application/pdf" ? "📄" : type.startsWith("image/") ? "🖼️" : "📑";

export default function PrintQueue({ onSendToCalculator }) {
  const [jobs, setJobs]     = useState([]);
  const [loading, setLoad]  = useState(true);
  const [error, setError]   = useState("");
  const [busyId, setBusyId] = useState(null);   // job id currently acting
  const [tick, setTick]     = useState(0);       // re-render for "waiting Xm"
  const [showQr, setShowQr] = useState(false);
  const [qrUrl, setQrUrl]   = useState("");

  const uploadUrl = (typeof window !== "undefined" ? window.location.origin : "") + "/upload";

  // Initial fetch + realtime subscription.
  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) {
      setError("Sales database isn't configured.");
      setLoad(false);
      return;
    }
    let cancelled = false;

    (async () => {
      const { data, error } = await supabase
        .from("pending_jobs").select("*").order("queue_number", { ascending: true });
      if (cancelled) return;
      if (error) setError(error.message);
      else setJobs(data || []);
      setLoad(false);
    })();

    const ch = supabase
      .channel("pending_jobs")
      .on("postgres_changes", { event: "*", schema: "public", table: "pending_jobs" }, (payload) => {
        setJobs((prev) => {
          if (payload.eventType === "INSERT") {
            if (prev.some((j) => j.id === payload.new.id)) return prev;
            return [...prev, payload.new].sort((a, b) => a.queue_number - b.queue_number);
          }
          if (payload.eventType === "UPDATE") {
            return prev.map((j) => (j.id === payload.new.id ? payload.new : j))
              .sort((a, b) => a.queue_number - b.queue_number);
          }
          if (payload.eventType === "DELETE") {
            return prev.filter((j) => j.id !== payload.old.id);
          }
          return prev;
        });
      })
      .subscribe();

    return () => { cancelled = true; supabase.removeChannel(ch); };
  }, []);

  // Keep "waiting Xm" fresh.
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30000);
    return () => clearInterval(t);
  }, []);

  // Today's jobs only, sorted by queue position.
  const todayJobs = useMemo(() => {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Detroit" }).format(new Date());
    return jobs
      .filter((j) => !j.job_date || j.job_date === today)
      .sort((a, b) => a.queue_number - b.queue_number);
  }, [jobs, tick]);

  const openFiles = async (job) => {
    setBusyId(job.id);
    setError("");
    try {
      const paths = (job.files || []).map((f) => f.path).filter(Boolean);
      const { urls } = await callFn("get-download-url", { paths });
      for (const u of urls) {
        if (u.url) window.open(u.url, "_blank", "noopener");
      }
      if (!urls.some((u) => u.url)) setError("Couldn't open the file(s). They may have been cleaned up.");
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusyId(null);
    }
  };

  const sendToCalculator = async (job) => {
    setBusyId(job.id);
    setError("");
    try {
      const first = (job.files || [])[0];
      if (!first?.path) throw new Error("No file on this job.");
      const { urls } = await callFn("get-download-url", { paths: [first.path] });
      const signed = urls[0]?.url;
      if (!signed) throw new Error("Couldn't fetch the file.");
      const resp = await fetch(signed);
      const blob = await resp.blob();
      const file = new File([blob], first.name || "file", { type: first.type || blob.type });
      onSendToCalculator?.(file);
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusyId(null);
    }
  };

  const pickedUp = async (job) => {
    if (!window.confirm(`Mark #${job.queue_number} (${job.customer_name}) picked up? This deletes the file.`)) return;
    setBusyId(job.id);
    setError("");
    try {
      await callFn("complete-job", { id: job.id });
      // Realtime DELETE will drop the card; remove optimistically too.
      setJobs((prev) => prev.filter((j) => j.id !== job.id));
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusyId(null);
    }
  };

  const openQr = async () => {
    setShowQr(true);
    try {
      const QRCode = (await import("qrcode")).default;
      // 520 = exactly 2x the 260px display size -> clean integer downscale.
      const dataUrl = await QRCode.toDataURL(uploadUrl, { width: 520, margin: 2 });
      setQrUrl(dataUrl);
    } catch {
      setQrUrl("");
    }
  };

  const printQr = () => {
    if (!qrUrl) return;
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(
      `<html><head><title>Scan to send a file</title></head>
       <body style="text-align:center;font-family:Arial,sans-serif;padding:40px;">
       <h2>Send us your file to print</h2>
       <img src="${qrUrl}" style="width:380px;height:380px;" />
       <p style="font-size:18px;font-weight:bold;">${uploadUrl}</p>
       <p>The UPS Store #4979</p>
       <script>window.onload=function(){window.print();}</script>
       </body></html>`
    );
    w.document.close();
  };

  return (
    <div className="pc-card">
      <div className="pc-card-header">
        <div className="pc-card-header-left">
          <div className="step-num" style={{ background: "var(--teal)" }}>📥</div>
          <div>
            <div className="pc-card-title">Print Queue</div>
            <div className="pc-card-hint">Customer files sent from their phones</div>
          </div>
        </div>
        <button className="pc-btn pc-btn-secondary pc-btn-sm" onClick={openQr}>
          🔳 Counter QR
        </button>
      </div>

      <div className="pc-card-body">
        {error && (
          <div className="callout callout-warn" style={{ marginBottom: 12 }}>
            <span className="callout-icon">⚠</span>
            <div style={{ fontSize: 13 }}>{error}</div>
          </div>
        )}

        {loading && <div style={{ color: "var(--text-muted)", padding: "20px 0" }}>Loading queue…</div>}

        {!loading && todayJobs.length === 0 && (
          <div style={{ textAlign: "center", color: "var(--text-muted)", padding: "32px 0" }}>
            <div style={{ fontSize: 32 }}>🗂️</div>
            <div style={{ marginTop: 8 }}>No files waiting.</div>
            <div style={{ fontSize: 12, marginTop: 4 }}>Tap “Counter QR” to print the sign for the counter.</div>
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {todayJobs.map((job) => {
            const busy = busyId === job.id;
            return (
              <div key={job.id} className="queue-card">
                <div className="queue-card-head">
                  <span className="queue-num">#{job.queue_number}</span>
                  <span className="queue-name">{job.customer_name}</span>
                  <span className="queue-wait">{minutesWaiting(job.created_at)}</span>
                  {job.source === "link" && <span className="queue-tag">link</span>}
                </div>

                {job.notes && <div className="queue-notes">“{job.notes}”</div>}

                <div className="queue-files">
                  {(job.files || []).map((f, i) => (
                    <span key={i} className="queue-file-chip" title={f.name}>
                      {fileIcon(f.type)} {f.name}
                      {f.page_count ? ` · ${f.page_count}p` : ""}
                    </span>
                  ))}
                </div>

                <div className="queue-actions">
                  <button className="pc-btn pc-btn-secondary pc-btn-sm" disabled={busy} onClick={() => openFiles(job)}>
                    🖨 Open / Print
                  </button>
                  <button className="pc-btn pc-btn-secondary pc-btn-sm" disabled={busy} onClick={() => sendToCalculator(job)}>
                    ➡ Send to Calculator
                  </button>
                  <button className="pc-btn pc-btn-complete-sale pc-btn-sm" disabled={busy} onClick={() => pickedUp(job)}>
                    ✓ Picked Up — Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {showQr && (
        <div className="pc-dialog-backdrop" role="dialog" aria-modal="true" onClick={() => setShowQr(false)}>
          <div className="pc-dialog" onClick={(e) => e.stopPropagation()} style={{ textAlign: "center" }}>
            <div className="pc-dialog-title">Scan to send a file</div>
            <div className="pc-dialog-sub">Customers scan this to upload from their phone.</div>
            {qrUrl
              ? <img src={qrUrl} alt="Upload QR code" style={{ width: 260, height: 260, margin: "8px auto", display: "block", background: "#fff", padding: 10, borderRadius: 8, imageRendering: "pixelated" }} />
              : <div style={{ padding: 40, color: "var(--text-muted)" }}>Generating…</div>}
            <div style={{ fontWeight: 700, wordBreak: "break-all", marginTop: 4 }}>{uploadUrl}</div>
            <div className="pc-dialog-actions" style={{ marginTop: 14 }}>
              <button className="pc-btn pc-btn-secondary" onClick={() => setShowQr(false)}>Close</button>
              <button className="pc-btn pc-btn-primary" onClick={printQr} disabled={!qrUrl}>Print sign</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
