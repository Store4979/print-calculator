// ============================================================
//  OFFLINE ORDER QUEUE
//  Pure helpers — no React, no Supabase imports. The caller hands
//  us an insert function so this module stays side-effect free.
//
//  Relocated from the former incentive module in Phase D1. This is order-recording
//  resilience, not incentive code, so it outlived the decommission:
//  an order that fails to save (network, RLS hiccup) is stashed in
//  localStorage so it is never lost, and drained on the next
//  successful save or manual retry.
// ============================================================

// Kept verbatim on purpose: renaming the key would orphan any orders a
// counter queued offline before this deploy.
const PENDING_KEY = "pendingTransactions";

// The columns public.orders accepts after migration D1-b. Rows queued by
// the pre-D1 client still carry the four dropped incentive columns;
// inserting them verbatim would fail on an unknown column and the row
// would be stuck in localStorage forever. Everything else is stripped.
export const ORDER_COLUMNS = Object.freeze([
  "employee_id", "employee_name", "total", "base_subtotal",
  "line_items", "service_type", "notes", "org_id", "store_id",
]);

export const toOrderRow = (row) => {
  const out = {};
  for (const k of ORDER_COLUMNS) if (row?.[k] !== undefined) out[k] = row[k];
  return out;
};

export const loadPendingOrders = () => {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
};

const writePendingOrders = (arr) => {
  try { localStorage.setItem(PENDING_KEY, JSON.stringify(arr)); } catch {}
};

export const enqueuePendingOrder = (row) => {
  const queued = loadPendingOrders();
  queued.push({ ...row, _queuedAt: new Date().toISOString() });
  writePendingOrders(queued);
  return queued.length;
};

export const clearPendingOrders = () => writePendingOrders([]);

// Try to flush queued orders. `insertFn` accepts a single row and resolves
// on success / rejects on failure. Returns counts of flushed and remaining.
export const drainPendingOrders = async (insertFn) => {
  const queued = loadPendingOrders();
  if (!queued.length) return { flushed: 0, remaining: 0 };
  const remaining = [];
  let flushed = 0;
  for (const row of queued) {
    const { _queuedAt, ...payload } = row;
    try {
      await insertFn(toOrderRow(payload));
      flushed++;
    } catch {
      remaining.push(row);
    }
  }
  writePendingOrders(remaining);
  return { flushed, remaining: remaining.length };
};

// Save an order with offline fallback. Returns
//   { ok: true, data }            on a successful insert
//   { ok: false, queued: true }   when the insert fails and the row was queued
// Never throws; the caller decides which message to show.
export const saveOrderWithFallback = async (row, insertFn) => {
  try {
    const data = await insertFn(toOrderRow(row));
    // Opportunistically drain anything queued before this call.
    drainPendingOrders(insertFn).catch(() => {});
    return { ok: true, data };
  } catch (err) {
    enqueuePendingOrder(row);
    return { ok: false, queued: true, error: err };
  }
};
