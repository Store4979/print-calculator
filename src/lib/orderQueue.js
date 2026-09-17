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
//
//  2026-09-17 — the drain LOST orders. The previous drainPendingOrders
//  loaded the queue, awaited each insert, then wrote the whole key back
//  from the snapshot it had loaded BEFORE the awaits. Anything enqueued
//  during those awaits was erased. And the drain runs unawaited in the
//  background — on mount, on every "online" event, and after every
//  successful save — so on a flaky connection (the only time orders
//  queue) the sequence was: drop, order A fails and queues, connection
//  returns, "online" starts a drain that snapshots [A], order B fails and
//  queues during the awaits, the drain writes [] over [A, B]. B gone, and
//  staff had been told it was queued. writePendingOrders also swallowed
//  its own error, so a failed localStorage write still reported
//  queued:true.
//
//  What holds now, and the test that proves each
//  (scripts/tests/order-queue.test.js):
//   - every entry carries its own random `_id` (two identical orders in
//     the same millisecond are two entries, two inserts, two dequeues);
//   - a dequeue is a MERGE: re-read the stored queue and remove that one
//     `_id`; the snapshot is never written back;
//   - at most one drain is in flight per tab; concurrent callers share it;
//   - a persist that does not read back is reported (`stored: false`),
//     and saveOrderWithFallback then returns `queued: false` — it never
//     says an order is safe when nothing was stored.
//  Cross-tab: the read-modify-writes run under the Web Locks API where
//  the browser has it (every counter device does). Where it is absent
//  they are serialised only within the tab — the exposure the old code
//  had, not widened. That is best-effort and is said so here rather than
//  promised.
// ============================================================

// Kept verbatim on purpose: renaming the key would orphan any orders a
// counter queued offline before this deploy.
const PENDING_KEY = "pendingTransactions";
const LOCK_NAME = "pc-order-queue";

// The columns public.orders accepts (D1-b removed four, Phase E added two).
// Rows queued by the pre-D1 client still carry the four dropped incentive columns;
// inserting them verbatim would fail on an unknown column and the row
// would be stuck in localStorage forever. Everything else is stripped.
export const ORDER_COLUMNS = Object.freeze([
  "employee_id", "employee_name", "total", "base_subtotal",
  "line_items", "service_type", "notes", "org_id", "store_id",
  // Phase E (migration 20260909232836): the cost/margin the order was
  // quoted at. Nullable server-side; a row queued by a pre-Phase-E client
  // simply lacks them and lands with NULLs.
  "cost_subtotal", "margin_pct",
]);

export const toOrderRow = (row) => {
  const out = {};
  for (const k of ORDER_COLUMNS) if (row?.[k] !== undefined) out[k] = row[k];
  return out;
};

const newId = () => {
  try { if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID(); } catch {}
  return `q_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
};

// Serialise a read-modify-write across tabs when the browser offers Web
// Locks; otherwise run it inline (single-tab serialisation only).
const withQueueLock = async (fn) => {
  const locks = globalThis.navigator?.locks;
  if (locks?.request) return locks.request(LOCK_NAME, { mode: "exclusive" }, () => fn());
  return fn();
};

export const loadPendingOrders = () => {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
};

// Returns true only if the value was written AND reads back identically.
// A localStorage that throws (quota, private mode) or silently no-ops
// must not be reported as a successful persist.
const writePendingOrders = (arr) => {
  let serialized;
  try { serialized = JSON.stringify(arr); } catch { return false; }
  try {
    localStorage.setItem(PENDING_KEY, serialized);
    return localStorage.getItem(PENDING_KEY) === serialized;
  } catch { return false; }
};

// Enqueue one order. Resolves { stored, count, id }. `stored: false` means
// the row is NOT in localStorage and the caller must not claim it is.
export const enqueuePendingOrder = (row) => withQueueLock(() => {
  const queued = loadPendingOrders();
  const id = newId();
  queued.push({ ...row, _id: id, _queuedAt: new Date().toISOString() });
  const stored = writePendingOrders(queued);
  return { stored, count: stored ? queued.length : queued.length - 1, id };
});

export const clearPendingOrders = () => withQueueLock(() => writePendingOrders([]));

// Remove exactly one entry by id from the CURRENT stored queue. A merge,
// never a snapshot write: anything enqueued since the caller last looked
// is preserved.
const dequeueById = (id) => withQueueLock(() => {
  const current = loadPendingOrders();
  const idx = current.findIndex((e) => e?._id === id);
  if (idx < 0) return true;              // already gone — nothing to do
  current.splice(idx, 1);
  return writePendingOrders(current);
});

// Legacy entries (queued before this fix) have no _id. Give each one its
// own, and persist BEFORE any insert so a retry after a crash reuses the
// same identities rather than minting new ones.
const assignMissingIds = () => withQueueLock(() => {
  const current = loadPendingOrders();
  let changed = false;
  for (const e of current) {
    if (e && typeof e === "object" && !e._id) { e._id = newId(); changed = true; }
  }
  return changed ? writePendingOrders(current) : true;
});

let _drainInFlight = null;

// Try to flush queued orders. `insertFn` accepts a single row and resolves
// on success / rejects on failure. Returns counts of flushed and remaining,
// plus `persisted: false` if a dequeue could not be written (the order IS
// in the database; the entry stayed in the queue and may re-insert — a
// duplicate is recoverable from history, a lost order is not).
export const drainPendingOrders = (insertFn) => {
  if (_drainInFlight) return _drainInFlight;
  _drainInFlight = (async () => {
    let flushed = 0;
    let persisted = true;
    if (!(await assignMissingIds())) {
      return { flushed: 0, remaining: loadPendingOrders().length, persisted: false };
    }
    // Iterate over the ids present at the start; entries added during the
    // drain are left for the next one, and are never overwritten.
    const ids = loadPendingOrders().map((e) => e?._id).filter(Boolean);
    for (const id of ids) {
      const entry = loadPendingOrders().find((e) => e?._id === id);
      if (!entry) continue;              // dequeued by another tab meanwhile
      const { _id, _queuedAt, ...payload } = entry;
      try {
        await insertFn(toOrderRow(payload));
      } catch {
        continue;                         // stays queued
      }
      flushed++;
      if (!(await dequeueById(id))) persisted = false;
    }
    return { flushed, remaining: loadPendingOrders().length, persisted };
  })().finally(() => { _drainInFlight = null; });
  return _drainInFlight;
};

// Save an order with offline fallback. Returns
//   { ok: true, data }                        on a successful insert
//   { ok: false, queued: true }               insert failed, row is stored
//   { ok: false, queued: false, error }       insert failed AND the row could
//                                             not be stored — the caller must
//                                             tell staff the order is NOT safe
// Never throws; the caller decides which message to show.
export const saveOrderWithFallback = async (row, insertFn) => {
  try {
    const data = await insertFn(toOrderRow(row));
    // Opportunistically drain anything queued before this call. Safe to
    // leave unawaited now: each dequeue is a merge and only one drain runs.
    drainPendingOrders(insertFn).catch(() => {});
    return { ok: true, data };
  } catch (err) {
    const { stored } = await enqueuePendingOrder(row);
    return { ok: false, queued: stored, error: err };
  }
};
