// ============================================================
//  COMMISSION DASHBOARD
//  Admin-only view rendered inside the Admin panel.
//  Three sub-tabs: Reports (default), Employees, Settings.
// ============================================================

import { Fragment, useEffect, useMemo, useState } from "react";
import {
  listEmployees, createEmployee, setEmployeeActive,
  fetchCommissionSettings, saveCommissionSettings,
  fetchTransactions, isSupabaseConfigured,
} from "../lib/supabase.js";

// ── Date helpers ────────────────────────────────────────────
const pad = (n) => String(n).padStart(2, "0");
const toDateInputValue = (d) => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const startOfMonth = (d = new Date()) => new Date(d.getFullYear(), d.getMonth(), 1);
const endOfMonth   = (d = new Date()) => new Date(d.getFullYear(), d.getMonth()+1, 0, 23, 59, 59, 999);
const fmtMoney = (n) => `$${(Number(n)||0).toFixed(2)}`;

// ── Aggregation ─────────────────────────────────────────────
// Group transactions by employee, then split each employee's rows
// into calendar months so we can apply the monthly_bonus_threshold
// independently per month — picking a wider range correctly sums
// bonuses month-by-month.
const buildReport = (transactions, settings) => {
  const threshold = Number(settings?.monthly_bonus_threshold) || 0;
  const bonusAmt  = Number(settings?.monthly_bonus_amount)    || 0;

  const byEmp = new Map();
  for (const tx of transactions) {
    const id = tx.employee_id;
    if (!byEmp.has(id)) {
      byEmp.set(id, {
        employeeId: id,
        employeeName: tx.employee_name,
        count: 0,
        total: 0,
        baseCommission: 0,
        upsellCommission: 0,
        monthBuckets: new Map(), // "YYYY-MM" -> total sales
        transactions: [],
      });
    }
    const e = byEmp.get(id);
    e.count            += 1;
    e.total            += Number(tx.total)             || 0;
    e.baseCommission   += Number(tx.base_commission)   || 0;
    e.upsellCommission += Number(tx.upsell_commission) || 0;
    e.transactions.push(tx);
    const ts = new Date(tx.created_at);
    const key = `${ts.getFullYear()}-${pad(ts.getMonth()+1)}`;
    e.monthBuckets.set(key, (e.monthBuckets.get(key) || 0) + (Number(tx.total) || 0));
  }

  const rows = [];
  for (const e of byEmp.values()) {
    let bonus = 0;
    const bonusMonths = [];
    for (const [month, monthTotal] of e.monthBuckets) {
      if (threshold > 0 && monthTotal >= threshold) {
        bonus += bonusAmt;
        bonusMonths.push({ month, monthTotal, bonus: bonusAmt });
      }
    }
    rows.push({
      employeeId: e.employeeId,
      employeeName: e.employeeName,
      count: e.count,
      total: e.total,
      baseCommission: e.baseCommission,
      upsellCommission: e.upsellCommission,
      bonus,
      bonusMonths,
      totalOwed: e.baseCommission + e.upsellCommission + bonus,
      transactions: e.transactions.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)),
    });
  }
  rows.sort((a, b) => b.totalOwed - a.totalOwed);
  return rows;
};

// ── CSV ────────────────────────────────────────────────────
const csvCell = (v) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const buildCsv = (report, fromIso, toIso) => {
  const header = [
    "Employee", "# Sales", "Total Sales",
    "Base Commission", "Upsell Commission", "Monthly Bonus", "Total Owed",
  ];
  const lines = [header.map(csvCell).join(",")];
  for (const r of report) {
    lines.push([
      r.employeeName,
      r.count,
      r.total.toFixed(2),
      r.baseCommission.toFixed(2),
      r.upsellCommission.toFixed(2),
      r.bonus.toFixed(2),
      r.totalOwed.toFixed(2),
    ].map(csvCell).join(","));
  }
  lines.unshift(`# Commission report ${fromIso} to ${toIso}`);
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
export default function CommissionDashboard() {
  const [tab, setTab] = useState("reports");

  if (!isSupabaseConfigured) {
    return (
      <div className="callout callout-warn" style={{ marginBottom: 14 }}>
        ⚠ Supabase isn't configured. Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code>.
      </div>
    );
  }

  return (
    <div className="commission-dashboard">
      <div className="cd-tabs">
        {[
          { id: "reports",   label: "Reports" },
          { id: "employees", label: "Employees" },
          { id: "settings",  label: "Commission Settings" },
        ].map(t => (
          <button
            key={t.id}
            type="button"
            className={`cd-tab ${tab === t.id ? "is-active" : ""}`}
            onClick={() => setTab(t.id)}
          >{t.label}</button>
        ))}
      </div>

      {tab === "reports"   && <ReportsView />}
      {tab === "employees" && <EmployeesView />}
      {tab === "settings"  && <SettingsView />}
    </div>
  );
}

// ── Reports ────────────────────────────────────────────────
function ReportsView() {
  const today = new Date();
  const [from, setFrom] = useState(toDateInputValue(startOfMonth(today)));
  const [to,   setTo]   = useState(toDateInputValue(endOfMonth(today)));
  const [transactions, setTransactions] = useState([]);
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState("");
  const [expandedId, setExpandedId] = useState(null);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const fromIso = new Date(from + "T00:00:00").toISOString();
      const toIso   = new Date(to   + "T23:59:59.999").toISOString();
      const [tx, s] = await Promise.all([
        fetchTransactions({ from: fromIso, to: toIso, limit: 5000 }),
        fetchCommissionSettings(),
      ]);
      setTransactions(tx);
      setSettings(s);
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const report = useMemo(() => settings ? buildReport(transactions, settings) : [], [transactions, settings]);

  const totals = useMemo(() => {
    return report.reduce((acc, r) => {
      acc.count += r.count;
      acc.total += r.total;
      acc.baseCommission   += r.baseCommission;
      acc.upsellCommission += r.upsellCommission;
      acc.bonus     += r.bonus;
      acc.totalOwed += r.totalOwed;
      return acc;
    }, { count: 0, total: 0, baseCommission: 0, upsellCommission: 0, bonus: 0, totalOwed: 0 });
  }, [report]);

  const handleExportCsv = () => {
    if (!report.length) return;
    const csv = buildCsv(report, from, to);
    downloadCsv(`commission_${from}_to_${to}.csv`, csv);
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
          <button type="button" className="pc-btn pc-btn-secondary pc-btn-sm" onClick={handleExportCsv} disabled={!report.length}>
            ⬇ Export CSV
          </button>
        </div>
      </div>

      {error && (
        <div className="callout callout-warn" style={{ marginBottom: 10, fontSize: 12 }}>
          ⚠ {error}
        </div>
      )}

      {!loading && !error && transactions.length === 0 && (
        <div className="cd-empty">No completed sales in this date range.</div>
      )}

      {transactions.length > 0 && (
        <>
          <div className="cd-totals">
            <span><strong>{report.length}</strong> employees</span>
            <span><strong>{totals.count}</strong> sales</span>
            <span>Total sales <strong>{fmtMoney(totals.total)}</strong></span>
            <span>Total owed <strong>{fmtMoney(totals.totalOwed)}</strong></span>
          </div>

          <div className="cd-table-wrap">
            <table className="cd-table">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th style={{ textAlign: "right" }}># Sales</th>
                  <th style={{ textAlign: "right" }}>Total Sales</th>
                  <th style={{ textAlign: "right" }}>Base ({settings ? (settings.base_rate*100).toFixed(2) : "—"}%)</th>
                  <th style={{ textAlign: "right" }}>Upsell ({settings ? (settings.upsell_rate*100).toFixed(2) : "—"}%)</th>
                  <th style={{ textAlign: "right" }}>Bonus</th>
                  <th style={{ textAlign: "right" }}>Owed</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {report.map((r) => {
                  const open = expandedId === r.employeeId;
                  return (
                    <Fragment key={r.employeeId}>
                      <tr
                        className={`cd-row ${open ? "is-open" : ""}`}
                        onClick={() => setExpandedId(open ? null : r.employeeId)}
                      >
                        <td>{r.employeeName}</td>
                        <td style={{ textAlign: "right" }}>{r.count}</td>
                        <td style={{ textAlign: "right" }}>{fmtMoney(r.total)}</td>
                        <td style={{ textAlign: "right" }}>{fmtMoney(r.baseCommission)}</td>
                        <td style={{ textAlign: "right" }}>{fmtMoney(r.upsellCommission)}</td>
                        <td style={{ textAlign: "right" }}>
                          {r.bonus > 0
                            ? <span className="cd-bonus-pill" title={r.bonusMonths.map(b => `${b.month}: ${fmtMoney(b.monthTotal)}`).join("\n")}>{fmtMoney(r.bonus)}</span>
                            : <span style={{ color: "var(--text-subtle)" }}>—</span>}
                        </td>
                        <td style={{ textAlign: "right", fontWeight: 700 }}>{fmtMoney(r.totalOwed)}</td>
                        <td style={{ textAlign: "right", color: "var(--text-muted)" }}>{open ? "▾" : "▸"}</td>
                      </tr>
                      {open && (
                        <tr className="cd-detail-row">
                          <td colSpan={8}>
                            <EmployeeTransactionList rows={r.transactions} bonusMonths={r.bonusMonths} />
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

function EmployeeTransactionList({ rows, bonusMonths }) {
  const fmtTs = (iso) => {
    try { return new Date(iso).toLocaleString(); } catch { return iso; }
  };
  return (
    <div className="cd-emp-detail">
      {bonusMonths && bonusMonths.length > 0 && (
        <div className="cd-bonus-line">
          Monthly bonus: {bonusMonths.map(b => `${b.month} (${fmtMoney(b.monthTotal)} → ${fmtMoney(b.bonus)})`).join(" · ")}
        </div>
      )}
      <table className="cd-detail-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Service</th>
            <th style={{ textAlign: "right" }}>Total</th>
            <th style={{ textAlign: "right" }}>Base</th>
            <th style={{ textAlign: "right" }}>Upsell</th>
            <th style={{ textAlign: "right" }}>Commission</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(tx => (
            <tr key={tx.id}>
              <td>{fmtTs(tx.created_at)}</td>
              <td>{tx.service_type}</td>
              <td style={{ textAlign: "right" }}>{fmtMoney(tx.total)}</td>
              <td style={{ textAlign: "right" }}>{fmtMoney(tx.base_subtotal)}</td>
              <td style={{ textAlign: "right" }}>{fmtMoney(tx.upsell_subtotal)}</td>
              <td style={{ textAlign: "right", fontWeight: 600 }}>{fmtMoney(tx.total_commission)}</td>
              <td style={{ color: "var(--text-muted)", fontSize: 11 }}>{tx.notes || ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Employees ──────────────────────────────────────────────
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
        Each employee gets a 4-digit PIN for sign-in. Deactivating preserves historical commission records.
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

// ── Commission settings ───────────────────────────────────
function SettingsView() {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading]   = useState(false);
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState("");
  const [savedAt, setSavedAt]   = useState("");

  const load = async () => {
    setLoading(true); setError("");
    try { setSettings(await fetchCommissionSettings()); }
    catch (e) { setError(e?.message || String(e)); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const update = (patch) => setSettings((s) => ({ ...(s || {}), ...patch }));

  const save = async (e) => {
    e?.preventDefault?.();
    if (saving || !settings) return;
    setSaving(true); setError("");
    try {
      const next = await saveCommissionSettings({
        base_rate: Number(settings.base_rate),
        upsell_rate: Number(settings.upsell_rate),
        monthly_bonus_threshold: Number(settings.monthly_bonus_threshold),
        monthly_bonus_amount: Number(settings.monthly_bonus_amount),
      });
      setSettings(next);
      setSavedAt(new Date().toLocaleTimeString());
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setSaving(false);
    }
  };

  if (loading || !settings) {
    return <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Loading commission settings…</div>;
  }

  // Display rates as percentages so admins don't have to think in 0.02.
  const baseRatePct   = (Number(settings.base_rate)   || 0) * 100;
  const upsellRatePct = (Number(settings.upsell_rate) || 0) * 100;

  return (
    <form onSubmit={save}>
      <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12 }}>
        These rates apply to every sale logged from now on. Changing them does NOT retroactively recompute past transactions.
      </p>

      {error && <div className="callout callout-warn" style={{ marginBottom: 10, fontSize: 12 }}>⚠ {error}</div>}

      <div className="grid-2" style={{ maxWidth: 540 }}>
        <div>
          <label className="field-label">Base commission rate (%)</label>
          <input
            className="pc-input"
            type="number"
            step="0.01"
            min="0"
            max="100"
            value={baseRatePct}
            onChange={(e) => update({ base_rate: (Number(e.target.value) || 0) / 100 })}
          />
        </div>
        <div>
          <label className="field-label">Upsell commission rate (%)</label>
          <input
            className="pc-input"
            type="number"
            step="0.01"
            min="0"
            max="100"
            value={upsellRatePct}
            onChange={(e) => update({ upsell_rate: (Number(e.target.value) || 0) / 100 })}
          />
        </div>
        <div>
          <label className="field-label">Monthly bonus threshold ($)</label>
          <input
            className="pc-input"
            type="number"
            step="50"
            min="0"
            value={settings.monthly_bonus_threshold}
            onChange={(e) => update({ monthly_bonus_threshold: Number(e.target.value) || 0 })}
          />
        </div>
        <div>
          <label className="field-label">Monthly bonus amount ($)</label>
          <input
            className="pc-input"
            type="number"
            step="5"
            min="0"
            value={settings.monthly_bonus_amount}
            onChange={(e) => update({ monthly_bonus_amount: Number(e.target.value) || 0 })}
          />
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 14 }}>
        <button type="submit" className="pc-btn pc-btn-primary pc-btn-sm" disabled={saving}>
          {saving ? "Saving…" : "Save settings"}
        </button>
        {savedAt && <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Saved at {savedAt}</span>}
      </div>
    </form>
  );
}
