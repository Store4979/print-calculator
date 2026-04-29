// ============================================================
//  COMMISSION MATH + OFFLINE TRANSACTION QUEUE
//  Pure helpers — no React imports, no Supabase imports. The
//  caller hands us a save function so this module stays free of
//  side-effecty dependencies and is easy to unit-test.
// ============================================================

// Apply commission_settings to a (base, upsell) split.
// Returns numbers rounded to cents — every column on the
// transactions table is numeric(10,2).
export const computeCommission = (
  baseSubtotal,
  upsellSubtotal,
  settings = {}
) => {
  const baseRate   = Number(settings.base_rate   ?? 0.02);
  const upsellRate = Number(settings.upsell_rate ?? 0.08);
  const round = (n) => Math.round((Number(n) || 0) * 100) / 100;
  const base   = round(baseSubtotal);
  const upsell = round(upsellSubtotal);
  const baseCommission   = round(base   * baseRate);
  const upsellCommission = round(upsell * upsellRate);
  const totalCommission  = round(baseCommission + upsellCommission);
  return {
    base_subtotal:     base,
    upsell_subtotal:   upsell,
    base_commission:   baseCommission,
    upsell_commission: upsellCommission,
    total_commission:  totalCommission,
    total:             round(base + upsell),
  };
};

// ── Offline queue ─────────────────────────────────────────
// Transactions that fail to insert (network, RLS hiccup, etc.)
// are stashed in localStorage so the sale isn't lost. The next
// successful trip through saveTransactionWithFallback drains
// the queue.

const PENDING_KEY = "pendingTransactions";

export const loadPendingTransactions = () => {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
};

const writePendingTransactions = (arr) => {
  try { localStorage.setItem(PENDING_KEY, JSON.stringify(arr)); } catch {}
};

export const enqueuePendingTransaction = (row) => {
  const queued = loadPendingTransactions();
  queued.push({ ...row, _queuedAt: new Date().toISOString() });
  writePendingTransactions(queued);
  return queued.length;
};

export const clearPendingTransactions = () => writePendingTransactions([]);

// Try to flush queued transactions. `insertFn` accepts a single row
// and resolves on success / rejects on failure. Returns counts of
// what flushed and what's still pending.
export const drainPendingTransactions = async (insertFn) => {
  const queued = loadPendingTransactions();
  if (!queued.length) return { flushed: 0, remaining: 0 };
  const remaining = [];
  let flushed = 0;
  for (const row of queued) {
    const { _queuedAt, ...payload } = row;
    try {
      await insertFn(payload);
      flushed++;
    } catch {
      remaining.push(row);
    }
  }
  writePendingTransactions(remaining);
  return { flushed, remaining: remaining.length };
};

// Insert a transaction with offline fallback. Returns
//   { ok: true, data }                 on a successful insert
//   { ok: false, queued: true }        when the insert fails and the row was queued
// Never throws; the caller decides which UX message to show.
export const saveTransactionWithFallback = async (row, insertFn) => {
  try {
    const data = await insertFn(row);
    // Opportunistically drain anything queued before this call.
    drainPendingTransactions(insertFn).catch(() => {});
    return { ok: true, data };
  } catch (err) {
    enqueuePendingTransaction(row);
    return { ok: false, queued: true, error: err };
  }
};
