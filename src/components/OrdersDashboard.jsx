// ============================================================
//  ORDERS DASHBOARD
//  Admin-only view rendered inside the Admin panel — the owner/staff
//  shared-truth screen for what was quoted, sold, and by whom.
//  Two sub-tabs: Orders (default) and Employees.
//  Replaced the former incentive dashboard in Phase D1: that layer is gone;
//  order history, line-item detail, and employee management stay.
// ============================================================

import { Fragment, useEffect, useMemo, useState } from "react";
import {
  listEmployees, createEmployee, setEmployeeActive,
  fetchOrders, isSupabaseConfigured,
} from "../lib/supabase.js";

// ── Date helpers ────────────────────────────────────────────
const pad = (n) => String(n).padStart(2, "0");
const toDateInputValue = (d) => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const startOfMonth = (d = new Date()) => new Date(d.getFullYear(), d.getMonth(), 1);
const endOfMonth   = (d = new Date()) => new Date(d.getFullYear(), d.getMonth()+1, 0, 23, 59, 59, 999);
const fmtMoney = (n) => `$${(Number(n)||0).toFixed(2)}`;
const fmtTs = (iso) => { try { return new Date(iso).toLocaleString(); } catch { return iso; } };

// Plain-language names for the service_type values the tabs write.
const SERVICE_LABELS = {
  sheets: "Sheets & Photos",
  large_format: "Large Format",
  blueprints: "Blueprints",
  specialty: "Specialty",
  booklet: "Booklet",
  data_merge: "Data Merge",
};
const serviceLabel = (t) => SERVICE_LABELS[t] || t || "—";

// One line per line item, in customer language. Mirrors the shapes
// buildSaleSnapshot() and the child tabs produce.
const describeLineItem = (li) => {
  switch (li.kind) {
    case "sheet_line":         return `Job ${li.jobNumber}: ${li.quantity}× ${li.printSize} on ${li.paperLabel}`;
    case "lf_media":           return `${li.width}×${li.height} ${li.paperLabel}${li.quantity ? ` ×${li.quantity}` : ""}`;
    case "lf_addon":           return `${li.name}${li.count ? ` ×${li.count}` : ""}`;
    case "blueprint":          return `${li.label} blueprints ×${li.quantity}`;
    case "specialty":          return `${li.productLabel || "Specialty"}${li.dimensions ? ` (${li.dimensions})` : ""}${li.quantity ? ` ×${li.quantity}` : ""}`;
    case "specialty_shipping": return "Shipping";
    case "booklet":            return `Booklet: ${li.pages ?? "?"}pg × ${li.copies ?? 1} on ${li.stock || "stock"}${li.duplex ? " (duplex)" : ""}`;
    case "data_merge":         return `Data Merge: ${li.records ?? 0} records on ${li.paperLabel || li.paper || "stock"} ${li.sheetKey || ""}`.trim();
    default:                   return li.description || li.label || li.name || "Item";
  }
};

// ── Aggregation ─────────────────────────────────────────────
// Period keys for the volume/revenue rollup. Week = Monday-start ISO date.
const periodKey = (iso, mode) => {
  const d = new Date(iso);
  if (mode === "month") return `${d.getFullYear()}-${pad(d.getMonth()+1)}`;
  if (mode === "week") {
    const m = new Date(d); const day = (m.getDay() + 6) % 7; // Mon=0
    m.setDate(m.getDate() - day);
    return `wk of ${toDateInputValue(m)}`;
  }
  return toDateInputValue(d);
};

const rollup = (orders, mode) => {
  const map = new Map();
  for (const o of orders) {
    const k = periodKey(o.created_at, mode);
    const cur = map.get(k) || { period: k, count: 0, revenue: 0 };
    cur.count += 1;
    cur.revenue += Number(o.total) || 0;
    map.set(k, cur);
  }
  return [...map.values()].sort((a, b) => (a.period < b.period ? 1 : -1));
};

const topServices = (orders) => {
  const map = new Map();
  for (const o of orders) {
    const k = o.service_type || "—";
    const cur = map.get(k) || { service: k, count: 0, revenue: 0 };
    cur.count += 1;
    cur.revenue += Number(o.total) || 0;
    map.set(k, cur);
  }
  return [...map.values()].sort((a, b) => b.count - a.count || b.revenue - a.revenue);
};

// ── CSV ────────────────────────────────────────────────────
const csvCell = (v) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const buildCsv = (orders, fromIso, toIso) => {
  const header = ["Date", "Service", "Recorded by", "Subtotal", "Total", "Notes"];
  const lines = [header.map(csvCell).join(",")];
  for (const o of orders) {
    lines.push([
      fmtTs(o.created_at),
      serviceLabel(o.service_type),
      o.employee_name,
      (Number(o.base_subtotal) || 0).toFixed(2),
      (Number(o.total) || 0).toFixed(2),
      o.notes || "",
    ].map(csvCell).join(","));
  }
  lines.unshift(`# Orders ${fromIso} to ${toIso}`);
  return lines.join("\n");
};

const downloadCsv = (filename, csv) => {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url  = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
};

// ── Component ──────────────────────────────────────────────
export default function OrdersDashboard() {
  const [tab, setTab] = useState("orders");

  if (!isSupabaseConfigured) {
    return (
      <div className="callout callout-warn" style={{ marginBottom: 14 }}>
        ⚠ Supabase isn't configured. Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code>.
      </div>
    );
  }

  return (
    <div className="orders-dashboard">
      <div className="cd-tabs">
        {[
          { id: "orders",    label: "Orders" },
          { id: "employees", label: "Employees" },
        ].map(t => (
          <button
            key={t.id}
            type="button"
            className={`cd-tab ${tab === t.id ? "is-active" : ""}`}
            onClick={() => setTab(t.id)}
          >{t.label}</button>
        ))}
      </div>

      {tab === "orders"    && <OrdersView />}
      {tab === "employees" && <EmployeesView />}
    </div>
  );
}

// ── Orders ─────────────────────────────────────────────────
function OrdersView() {
  const today = new Date();
  const [from, setFrom] = useState(toDateInputValue(startOfMonth(today)));
  const [to,   setTo]   = useState(toDateInputValue(endOfMonth(today)));
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState("");
  const [expandedId, setExpandedId] = useState(null);
  const [groupBy, setGroupBy] = useState("day"); // "day" | "week" | "month"

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const fromIso = new Date(from + "T00:00:00").toISOString();
      const toIso   = new Date(to   + "T23:59:59.999").toISOString();
      setOrders(await fetchOrders({ from: fromIso, to: toIso, limit: 5000 }));
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const summary = useMemo(() => {
    const count = orders.length;
    const revenue = orders.reduce((s, o) => s + (Number(o.total) || 0), 0);
    const services = topServices(orders);
    return { count, revenue, avg: count ? revenue / count : 0, top: services[0] || null, services };
  }, [orders]);

  const periods = useMemo(() => rollup(orders, groupBy), [orders, groupBy]);

  const handleExportCsv = () => {
    if (!orders.length) return;
    downloadCsv(`orders_${from}_to_${to}.csv`, buildCsv(orders, from, to));
  };

  const presetThisMonth = () => {
    const d = new Date();
    setFrom(toDateInputValue(startOfMonth(d)));
    setTo(toDateInputValue(endOfMonth(d)));
  };
  const presetLastMonth = () => {
    const d = new Date();
    const last = new Date(d.getFullYear(), d.getMonth() - 1, 1);
    setFrom(toDateInputValue(startOfMonth(last)));
    setTo(toDateInputValue(endOfMonth(last)));
  };
  const presetLast30 = () => {
    const d = new Date();
    const start = new Date(d); start.setDate(d.getDate() - 30);
    setFrom(toDateInputValue(start));
    setTo(toDateInputValue(d));
  };

  return (
    <div>
      <div className="cd-controls">
        <div className="cd-date-range">
          <label className="field-label" style={{ marginBottom: 0 }}>From</label>
          <input className="pc-input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <label className="field-label" style={{ marginBottom: 0 }}>To</label>
          <input className="pc-input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          <button type="button" className="pc-btn pc-btn-secondary pc-btn-xs" onClick={presetThisMonth}>This month</button>
          <button type="button" className="pc-btn pc-btn-secondary pc-btn-xs" onClick={presetLastMonth}>Last month</button>
          <button type="button" className="pc-btn pc-btn-secondary pc-btn-xs" onClick={presetLast30}>Last 30 days</button>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" className="pc-btn pc-btn-primary pc-btn-sm" onClick={load} disabled={loading}>
            {loading ? "Loading…" : "Refresh"}
          </button>
          <button type="button" className="pc-btn pc-btn-secondary pc-btn-sm" onClick={handleExportCsv} disabled={!orders.length}>
            ⬇ Export CSV
          </button>
        </div>
      </div>

      {error && (
        <div className="callout callout-warn" style={{ marginBottom: 10, fontSize: 12 }}>
          ⚠ {error}
        </div>
      )}

      {!loading && !error && orders.length === 0 && (
        <div className="cd-empty">No orders saved in this date range.</div>
      )}

      {orders.length > 0 && (
        <>
          {/* Summary strip — owner visibility, not incentive framing */}
          <div className="cd-totals">
            <span><strong>{summary.count}</strong> order{summary.count === 1 ? "" : "s"}</span>
            <span>Revenue <strong>{fmtMoney(summary.revenue)}</strong></span>
            <span>Average order <strong>{fmtMoney(summary.avg)}</strong></span>
            {summary.top && <span>Top service <strong>{serviceLabel(summary.top.service)}</strong> ({summary.top.count})</span>}
          </div>

          {/* Volume + revenue by period */}
          <div className="cd-table-wrap" style={{ marginBottom: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <span className="field-label" style={{ marginBottom: 0 }}>Orders by</span>
              {["day", "week", "month"].map(m => (
                <button
                  key={m}
                  type="button"
                  className={`pc-btn pc-btn-secondary pc-btn-xs ${groupBy === m ? "is-active" : ""}`}
                  aria-pressed={groupBy === m}
                  onClick={() => setGroupBy(m)}
                >{m[0].toUpperCase() + m.slice(1)}</button>
              ))}
            </div>
            <table className="cd-table">
              <thead>
                <tr>
                  <th>{groupBy === "month" ? "Month" : groupBy === "week" ? "Week" : "Day"}</th>
                  <th style={{ textAlign: "right" }}>Orders</th>
                  <th style={{ textAlign: "right" }}>Revenue</th>
                </tr>
              </thead>
              <tbody>
                {periods.map(p => (
                  <tr key={p.period}>
                    <td>{p.period}</td>
                    <td style={{ textAlign: "right" }}>{p.count}</td>
                    <td style={{ textAlign: "right" }}>{fmtMoney(p.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Top services by count */}
          <div className="cd-table-wrap" style={{ marginBottom: 14 }}>
            <table className="cd-table">
              <thead>
                <tr>
                  <th>Service</th>
                  <th style={{ textAlign: "right" }}>Orders</th>
                  <th style={{ textAlign: "right" }}>Revenue</th>
                </tr>
              </thead>
              <tbody>
                {summary.services.map(s => (
                  <tr key={s.service}>
                    <td>{serviceLabel(s.service)}</td>
                    <td style={{ textAlign: "right" }}>{s.count}</td>
                    <td style={{ textAlign: "right" }}>{fmtMoney(s.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Order list — click a row for its line items */}
          <div className="cd-table-wrap">
            <table className="cd-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Service</th>
                  <th>Recorded by</th>
                  <th style={{ textAlign: "right" }}>Total</th>
                  <th>Notes</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => {
                  const open = expandedId === o.id;
                  const items = Array.isArray(o.line_items) ? o.line_items : [];
                  return (
                    <Fragment key={o.id}>
                      <tr
                        className={`cd-row ${open ? "is-open" : ""}`}
                        onClick={() => setExpandedId(open ? null : o.id)}
                      >
                        <td>{fmtTs(o.created_at)}</td>
                        <td>{serviceLabel(o.service_type)}</td>
                        <td>{o.employee_name}</td>
                        <td style={{ textAlign: "right", fontWeight: 700 }}>{fmtMoney(o.total)}</td>
                        <td style={{ color: "var(--text-muted)", fontSize: 11 }}>{o.notes || ""}</td>
                        <td style={{ textAlign: "right", color: "var(--text-muted)" }}>{open ? "▾" : "▸"}</td>
                      </tr>
                      {open && (
                        <tr className="cd-detail-row">
                          <td colSpan={6}>
                            <div className="cd-emp-detail">
                              <table className="cd-detail-table">
                                <thead>
                                  <tr>
                                    <th>Line item</th>
                                    <th style={{ textAlign: "right" }}>Amount</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {items.map((li, i) => (
                                    <tr key={i}>
                                      <td>{describeLineItem(li)}</td>
                                      <td style={{ textAlign: "right" }}>{fmtMoney(li.lineTotal)}</td>
                                    </tr>
                                  ))}
                                  {items.length === 0 && (
                                    <tr><td colSpan={2} style={{ color: "var(--text-muted)" }}>No line-item detail on this order.</td></tr>
                                  )}
                                  <tr>
                                    <td style={{ fontWeight: 600 }}>Subtotal</td>
                                    <td style={{ textAlign: "right", fontWeight: 600 }}>{fmtMoney(o.base_subtotal)}</td>
                                  </tr>
                                </tbody>
                              </table>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// ── Employees ──────────────────────────────────────────────
// Unchanged in substance from before D1: employee records stay because
// "who recorded this order" is core history, and the PIN is the sign-in
// (and kiosk-exit) credential.
function EmployeesView() {
  const [list, setList]       = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState("");
  const [name, setName]       = useState("");
  const [pin, setPin]         = useState("");
  const [adding, setAdding]   = useState(false);

  const refresh = async () => {
    setLoading(true);
    setError("");
    try {
      const rows = await listEmployees({ includeInactive: true });
      setList(rows);
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, []);

  const handleAdd = async (e) => {
    e?.preventDefault?.();
    if (adding) return;
    setAdding(true);
    setError("");
    try {
      await createEmployee({ name, pin });
      setName(""); setPin("");
      await refresh();
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setAdding(false);
    }
  };

  const toggleActive = async (emp) => {
    setError("");
    try {
      await setEmployeeActive(emp.id, !emp.active);
      await refresh();
    } catch (err) {
      setError(err?.message || String(err));
    }
  };

  return (
    <div>
      <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 10 }}>
        Each employee gets a 4-digit PIN to sign in and record orders. Deactivating preserves their order history.
      </p>

      {error && <div className="callout callout-warn" style={{ marginBottom: 10, fontSize: 12 }}>⚠ {error}</div>}

      {loading && list.length === 0 && (
        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Loading employees…</div>
      )}

      {!loading && list.length === 0 && (
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 10 }}>
          No employees yet. Add one below.
        </div>
      )}

      {list.length > 0 && (
        <div className="admin-emp-list">
          {list.map((emp) => (
            <div key={emp.id} className={`admin-emp-row ${emp.active ? "" : "is-inactive"}`}>
              <div className="admin-emp-name">{emp.name}</div>
              <div className="admin-emp-pin">PIN {emp.pin}</div>
              <div className="admin-emp-status">{emp.active ? "Active" : "Inactive"}</div>
              <button className="pc-btn pc-btn-secondary pc-btn-xs" onClick={() => toggleActive(emp)} type="button">
                {emp.active ? "Deactivate" : "Reactivate"}
              </button>
              <span style={{ fontSize: 10, color: "var(--text-muted)" }}>
                {emp.created_at ? new Date(emp.created_at).toLocaleDateString() : ""}
              </span>
            </div>
          ))}
        </div>
      )}

      <form className="admin-emp-add-row" onSubmit={handleAdd}>
        <div style={{ flex: "1 1 180px" }}>
          <label className="field-label">Name</label>
          <input
            className="admin-input"
            type="text"
            placeholder="e.g. Jamie Lee"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={adding}
            style={{ width: "100%" }}
          />
        </div>
        <div>
          <label className="field-label">4-digit PIN</label>
          <input
            className="admin-input"
            type="text"
            inputMode="numeric"
            pattern="\d{4}"
            placeholder="1234"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
            disabled={adding}
            maxLength={4}
            style={{ width: 80, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
          />
        </div>
        <button
          type="submit"
          className="pc-btn pc-btn-primary pc-btn-xs"
          disabled={adding || !name.trim() || pin.length !== 4}
        >
          {adding ? "Adding…" : "+ Add Employee"}
        </button>
      </form>
    </div>
  );
}
