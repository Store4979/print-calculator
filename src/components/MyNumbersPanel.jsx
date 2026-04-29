// ============================================================
//  MY NUMBERS
//  Read-only commission summary for the currently signed-in
//  employee. Today / this week / this month + progress toward
//  the monthly bonus threshold + their last 10 transactions.
// ============================================================

import { useEffect, useMemo, useState } from "react";
import { fetchTransactions, fetchCommissionSettings, isSupabaseConfigured } from "../lib/supabase.js";

const fmtMoney = (n) => `$${(Number(n) || 0).toFixed(2)}`;
const fmtDateTime = (iso) => {
  if (!iso) return "";
  try { return new Date(iso).toLocaleString(); } catch { return String(iso); }
};

const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const startOfWeek = (d) => {
  // Sunday-based week. setDate handles month rollover.
  const start = startOfDay(d);
  start.setDate(d.getDate() - d.getDay());
  return start;
};
const startOfMonth = (d) => new Date(d.getFullYear(), d.getMonth(), 1);

const summarize = (txs, sinceDate) => {
  const since = sinceDate.getTime();
  const filtered = txs.filter((t) => {
    const ts = new Date(t.created_at).getTime();
    return Number.isFinite(ts) && ts >= since;
  });
  return {
    count: filtered.length,
    total: filtered.reduce((s, t) => s + (Number(t.total) || 0), 0),
    commission: filtered.reduce((s, t) => s + (Number(t.total_commission) || 0), 0),
  };
};

export default function MyNumbersPanel({ employee, onClose }) {
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState("");
  const [transactions, setTransactions] = useState([]);
  const [settings, setSettings] = useState(null);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setError("Database isn't configured.");
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true); setError("");
      try {
        // Pull this calendar month's transactions for the bonus
        // calculation, plus a small extra window so "this week" is
        // accurate when we're early in the month.
        const monthStart = startOfMonth(new Date());
        const lookback = new Date(monthStart);
        lookback.setDate(monthStart.getDate() - 14);
        const [tx, s] = await Promise.all([
          fetchTransactions({
            from: lookback.toISOString(),
            employeeId: employee.id,
            limit: 500,
          }),
          fetchCommissionSettings(),
        ]);
        if (cancelled) return;
        setTransactions(tx);
        setSettings(s);
      } catch (e) {
        if (!cancelled) setError(e?.message || String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [employee.id]);

  const stats = useMemo(() => {
    const now = new Date();
    return {
      today: summarize(transactions, startOfDay(now)),
      week:  summarize(transactions, startOfWeek(now)),
      month: summarize(transactions, startOfMonth(now)),
    };
  }, [transactions]);

  const recent = useMemo(() => {
    return [...transactions]
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 10);
  }, [transactions]);

  const monthTotal = stats.month.total;
  const threshold  = Number(settings?.monthly_bonus_threshold) || 0;
  const bonusAmt   = Number(settings?.monthly_bonus_amount)    || 0;
  const progress   = threshold > 0 ? Math.min(1, monthTotal / threshold) : 0;
  const hitBonus   = threshold > 0 && monthTotal >= threshold;
  const remainingToBonus = Math.max(0, threshold - monthTotal);

  return (
    <div className="my-numbers-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="my-numbers-panel" onClick={(e) => e.stopPropagation()}>
        <div className="my-numbers-header">
          <div>
            <div className="my-numbers-eyebrow">My Numbers</div>
            <div className="my-numbers-title">Hi, {employee.name}</div>
          </div>
          <button type="button" className="my-numbers-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        {loading && <div className="my-numbers-state">Loading your numbers…</div>}
        {error && !loading && <div className="my-numbers-state my-numbers-state-error">⚠ {error}</div>}

        {!loading && !error && (
          <>
            <div className="my-numbers-tiles">
              <StatTile label="Today" stat={stats.today} />
              <StatTile label="This week" stat={stats.week} />
              <StatTile label="This month" stat={stats.month} highlight />
            </div>

            {threshold > 0 && (
              <div className={`my-numbers-bonus ${hitBonus ? "is-hit" : ""}`}>
                <div className="my-numbers-bonus-row">
                  <span className="my-numbers-bonus-label">Monthly bonus</span>
                  <span className="my-numbers-bonus-amount">
                    {hitBonus ? `+${fmtMoney(bonusAmt)} earned` : `${fmtMoney(remainingToBonus)} to go`}
                  </span>
                </div>
                <div className="my-numbers-progress" aria-hidden="true">
                  <div className="my-numbers-progress-fill" style={{ width: `${(progress * 100).toFixed(1)}%` }} />
                </div>
                <div className="my-numbers-bonus-foot">
                  {fmtMoney(monthTotal)} of {fmtMoney(threshold)} this month
                </div>
              </div>
            )}

            <div className="my-numbers-section">
              <div className="my-numbers-section-title">Last {recent.length} transaction{recent.length === 1 ? "" : "s"}</div>
              {recent.length === 0 ? (
                <div className="my-numbers-state" style={{ padding: "16px 0" }}>
                  No completed sales yet — make some money!
                </div>
              ) : (
                <ul className="my-numbers-tx-list">
                  {recent.map((tx) => (
                    <li key={tx.id} className="my-numbers-tx-row">
                      <div>
                        <div className="my-numbers-tx-when">{fmtDateTime(tx.created_at)}</div>
                        <div className="my-numbers-tx-meta">{tx.service_type}</div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div className="my-numbers-tx-total">{fmtMoney(tx.total)}</div>
                        <div className="my-numbers-tx-commission">+{fmtMoney(tx.total_commission)} comm.</div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function StatTile({ label, stat, highlight = false }) {
  return (
    <div className={`my-numbers-tile ${highlight ? "is-highlight" : ""}`}>
      <div className="my-numbers-tile-label">{label}</div>
      <div className="my-numbers-tile-value">{fmtMoney(stat.commission)}</div>
      <div className="my-numbers-tile-meta">
        {stat.count} sale{stat.count === 1 ? "" : "s"} · {fmtMoney(stat.total)} sold
      </div>
    </div>
  );
}
