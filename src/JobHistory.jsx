// ============================================================
//  JOB HISTORY VIEWER
//  Modal that lists past print jobs from Supabase. Filterable
//  by free-text (customer / file names) and date range, sorted
//  by created_at desc.
// ============================================================

import { useState, useEffect, useMemo } from "react";
import { fetchPrintJobs, isSupabaseConfigured } from "./supabase.js";

const fmtDate = (iso) => {
  if (!iso) return "";
  try { return new Date(iso).toLocaleString(); } catch { return String(iso); }
};

const fmtMoney = (n) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return `$${v.toFixed(2)}`;
};

const JOB_TYPE_LABEL = {
  "sheets":       "Sheets / Photos",
  "large-format": "Large Format",
  "blueprints":   "Blueprints",
  "booklet":      "Booklet",
  "datamerge":    "Data Merge",
};

export default function JobHistory({ onClose }) {
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState("");
  const [jobs, setJobs]       = useState([]);
  const [search, setSearch]   = useState("");
  const [fromDate, setFrom]   = useState("");
  const [toDate, setTo]       = useState("");
  const [expanded, setExpanded] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!isSupabaseConfigured) {
        setError("Supabase isn't configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.");
        setLoading(false);
        return;
      }
      try {
        const rows = await fetchPrintJobs({ limit: 500 });
        if (!cancelled) setJobs(rows);
      } catch (e) {
        if (!cancelled) setError(e?.message || String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const fromTs = fromDate ? new Date(fromDate + "T00:00:00").getTime() : -Infinity;
    const toTs   = toDate   ? new Date(toDate   + "T23:59:59").getTime() : Infinity;
    return jobs.filter((j) => {
      const ts = j.created_at ? new Date(j.created_at).getTime() : 0;
      if (ts < fromTs || ts > toTs) return false;
      if (!q) return true;
      const haystack = [
        j.customer_name, j.customer_email, j.customer_phone, j.notes,
        j.paper_type, j.sku, j.job_type, j.sheet_size, j.print_size,
        ...(Array.isArray(j.file_names) ? j.file_names : []),
      ].filter(Boolean).join(" ").toLowerCase();
      return haystack.includes(q);
    });
  }, [jobs, search, fromDate, toDate]);

  return (
    <div className="jh-modal-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="jh-modal" onClick={e => e.stopPropagation()}>
        <div className="jh-header">
          <div>
            <div className="jh-title">📋 Job History</div>
            <div className="jh-subtitle">{filtered.length} of {jobs.length} jobs</div>
          </div>
          <button className="jh-close" type="button" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="jh-controls">
          <input
            className="pc-input"
            type="search"
            placeholder="Search customer, files, SKU, paper…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <div className="jh-date-range">
            <label className="field-label">From</label>
            <input className="pc-input" type="date" value={fromDate} onChange={e => setFrom(e.target.value)} />
            <label className="field-label">To</label>
            <input className="pc-input" type="date" value={toDate} onChange={e => setTo(e.target.value)} />
            {(fromDate || toDate) && (
              <button className="pc-btn pc-btn-secondary pc-btn-xs" type="button"
                onClick={() => { setFrom(""); setTo(""); }}>Clear</button>
            )}
          </div>
        </div>

        <div className="jh-body">
          {loading && <div className="jh-state">Loading jobs…</div>}
          {error && !loading && <div className="jh-state jh-state-error">⚠ {error}</div>}
          {!loading && !error && filtered.length === 0 && (
            <div className="jh-state">No jobs match your filters.</div>
          )}

          {!loading && !error && filtered.length > 0 && (
            <div className="jh-table-wrap">
              <table className="jh-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Type</th>
                    <th>Paper</th>
                    <th>Size</th>
                    <th style={{ textAlign:"right" }}>Qty</th>
                    <th style={{ textAlign:"right" }}>Total</th>
                    <th>Customer</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(j => {
                    const isOpen = expanded === j.id;
                    return (
                      <>
                        <tr key={j.id}
                            className={isOpen ? "jh-row jh-row-open" : "jh-row"}
                            onClick={() => setExpanded(isOpen ? null : j.id)}>
                          <td>{fmtDate(j.created_at)}</td>
                          <td>{JOB_TYPE_LABEL[j.job_type] || j.job_type}</td>
                          <td>{j.paper_type || "—"}</td>
                          <td>{j.print_size || j.sheet_size || "—"}</td>
                          <td style={{ textAlign:"right" }}>{j.quantity ?? "—"}</td>
                          <td style={{ textAlign:"right", fontWeight:600 }}>{fmtMoney(j.total_price)}</td>
                          <td>{j.customer_name || <span style={{ color:"var(--text-subtle)" }}>—</span>}</td>
                          <td style={{ textAlign:"right" }}>
                            <span className="jh-chev" aria-hidden="true">{isOpen ? "▾" : "▸"}</span>
                          </td>
                        </tr>
                        {isOpen && (
                          <tr key={j.id + "-d"} className="jh-detail-row">
                            <td colSpan={8}>
                              <JobDetail job={j} />
                            </td>
                          </tr>
                        )}
                      </>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function JobDetail({ job }) {
  const fields = [
    ["Job ID", job.id],
    ["Created", fmtDate(job.created_at)],
    ["Job type", JOB_TYPE_LABEL[job.job_type] || job.job_type],
    ["Paper", job.paper_type],
    ["Paper key", job.paper_key],
    ["Sheet size", job.sheet_size],
    ["SKU", job.sku],
    ["Print size", job.print_size],
    ["Orientation", job.orientation],
    ["Color mode", job.color_mode],
    ["Quantity", job.quantity],
    ["Sheets needed", job.sheets_needed],
    ["Sides", job.sides],
    ["Per sheet", fmtMoney(job.per_sheet_price)],
    ["Discount %", job.discount_percent != null ? `${job.discount_percent}%` : null],
    ["Total", fmtMoney(job.total_price)],
    ["Customer", job.customer_name],
    ["Email", job.customer_email],
    ["Phone", job.customer_phone],
    ["Notes", job.notes],
  ].filter(([, v]) => v !== null && v !== undefined && v !== "");

  return (
    <div className="jh-detail">
      <div className="jh-detail-grid">
        {fields.map(([k, v]) => (
          <div key={k} className="jh-detail-cell">
            <div className="jh-detail-label">{k}</div>
            <div className="jh-detail-value">{String(v)}</div>
          </div>
        ))}
      </div>

      {Array.isArray(job.file_names) && job.file_names.length > 0 && (
        <div className="jh-detail-section">
          <div className="jh-detail-label">Files</div>
          <ul className="jh-file-list">
            {job.file_names.map((f, i) => <li key={i}>{f}</li>)}
          </ul>
        </div>
      )}

      {job.addons && Object.keys(job.addons).length > 0 && (
        <div className="jh-detail-section">
          <div className="jh-detail-label">Add-ons</div>
          <pre className="jh-json">{JSON.stringify(job.addons, null, 2)}</pre>
        </div>
      )}

      {job.job_details && (
        <details className="jh-detail-section">
          <summary className="jh-detail-label" style={{ cursor:"pointer" }}>Full job snapshot</summary>
          <pre className="jh-json">{JSON.stringify(job.job_details, null, 2)}</pre>
        </details>
      )}
    </div>
  );
}
