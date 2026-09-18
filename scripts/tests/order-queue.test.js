// Phase E — ORDER_COLUMNS 9 -> 11. The three queued-row shapes that must
// drain against the post-E-03 schema (proven server-side in
// supabase/rehearsals/phase_e_03_rehearsal.sql; this is the client half).
import { test } from "node:test";
import assert from "node:assert/strict";
import { ORDER_COLUMNS, toOrderRow } from "../../src/lib/orderQueue.js";

const base = { employee_id: "e", employee_name: "Ryan", total: 4.54, base_subtotal: 4.54, line_items: [], service_type: "sheets", notes: "x" };

test("whitelist is exactly the 11 columns public.orders accepts", () => {
  assert.deepEqual([...ORDER_COLUMNS], [
    "employee_id", "employee_name", "total", "base_subtotal", "line_items", "service_type", "notes",
    "org_id", "store_id", "cost_subtotal", "margin_pct",
  ]);
});

test("pre-D1 queued row (11 legacy keys) drains as 7 keys", () => {
  const row = { ...base, upsell_subtotal: 0, base_commission: 0.09, upsell_commission: 0, total_commission: 0.09, upsellFlags: {}, _queuedAt: "t" };
  const { _queuedAt, ...payload } = row;
  assert.deepEqual(Object.keys(toOrderRow(payload)), ["employee_id", "employee_name", "total", "base_subtotal", "line_items", "service_type", "notes"]);
});

test("current queued row (9 keys) drains as 9 keys", () => {
  const row = { ...base, org_id: "o", store_id: "s" };
  assert.equal(Object.keys(toOrderRow(row)).length, 9);
  assert.equal("cost_subtotal" in toOrderRow(row), false);
});

test("Phase E row (11 keys) drains as 11 keys, values intact, and null cost survives", () => {
  const row = { ...base, org_id: "o", store_id: "s", cost_subtotal: 0.57, margin_pct: 87.44 };
  const out = toOrderRow(row);
  assert.equal(Object.keys(out).length, 11);
  assert.equal(out.cost_subtotal, 0.57);
  assert.equal(out.margin_pct, 87.44);
  const nulls = toOrderRow({ ...row, cost_subtotal: null, margin_pct: null });
  assert.equal(nulls.cost_subtotal, null);   // explicit NULL, not stripped
});

// ── 2026-09-17: the drain lost orders ───────────────────────────────────────
// Behavioural tests on a fake localStorage. Each property below is paired
// with the mutant that must FAIL it, so the scenario is shown to detect the
// defect before the fix is credited with surviving it.
import {
  enqueuePendingOrder, drainPendingOrders, loadPendingOrders, saveOrderWithFallback,
} from "../../src/lib/orderQueue.js";

class FakeStorage {
  constructor() { this.map = new Map(); this.failSet = false; this.silentNoop = false; this.writes = 0; }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) {
    this.writes++;
    if (this.failSet) throw new Error("QuotaExceededError");
    if (this.silentNoop) return;                 // a setItem that does nothing
    this.map.set(k, String(v));
  }
  removeItem(k) { this.map.delete(k); }
  clear() { this.map.clear(); }
}
const fresh = () => { const st = new FakeStorage(); globalThis.localStorage = st; return st; };
const KEY = "pendingTransactions";
const order = (n) => ({ ...base, total: n, line_items: [{ n }] });
const deferred = () => { let resolve, reject; const p = new Promise((a, b) => { resolve = a; reject = b; }); return { p, resolve, reject }; };
const tick = () => new Promise((r) => setTimeout(r, 0));

// THE MUTANT: the shipped drain, verbatim from main before this fix.
// Snapshot, await, write the snapshot's remainder back over the whole key.
const drainWithSnapshotOverwrite = async (insertFn) => {
  const queued = loadPendingOrders();
  if (!queued.length) return { flushed: 0, remaining: 0 };
  const remaining = [];
  let flushed = 0;
  for (const row of queued) {
    const { _queuedAt, ...payload } = row;
    try { await insertFn(toOrderRow(payload)); flushed++; }
    catch { remaining.push(row); }
  }
  localStorage.setItem(KEY, JSON.stringify(remaining));
  return { flushed, remaining: remaining.length };
};

// The flaky-connection sequence: A queued; connection returns; a drain
// starts and awaits A's insert; B fails and queues DURING that await.
async function enqueueDuringDrain(drain) {
  const st = fresh();
  st.setItem(KEY, JSON.stringify([{ ...order(1), _queuedAt: "2026-09-17T00:00:00.000Z" }]));   // A, legacy shape
  const gate = deferred();
  const inserted = [];
  const insertFn = async (row) => { inserted.push(row.total); await gate.p; };
  const running = drain(insertFn);
  await tick();                                            // drain is now awaiting A
  const r = await enqueuePendingOrder(order(2));          // B queues mid-drain
  assert.equal(r.stored, true);
  gate.resolve();
  await running;
  return { inserted, queue: loadPendingOrders() };
}

test("MUTANT (shipped drain) loses an order enqueued during its awaits: the scenario detects the defect", async () => {
  const { inserted, queue } = await enqueueDuringDrain(drainWithSnapshotOverwrite);
  assert.deepEqual(inserted, [1]);
  assert.equal(queue.length, 0, "the snapshot overwrite erased B: this is the bug");
});

test("FIX: an order enqueued during an in-flight drain survives the drain", async () => {
  const { inserted, queue } = await enqueueDuringDrain(drainPendingOrders);
  assert.deepEqual(inserted, [1], "A drained");
  assert.equal(queue.length, 1, "B is still queued");
  assert.equal(queue[0].total, 2);
  assert.ok(queue[0]._id, "B carries its own id");
});

test("two identical orders queued in the same millisecond are two entries, two inserts, two dequeues", async () => {
  fresh();
  const a = await enqueuePendingOrder(order(5));
  const b = await enqueuePendingOrder(order(5));
  assert.notEqual(a.id, b.id);
  const inserted = [];
  await drainPendingOrders(async (row) => { inserted.push(row.total); });
  assert.deepEqual(inserted, [5, 5]);
  assert.equal(loadPendingOrders().length, 0);
});

test("a legacy entry with no _id is given one and persisted BEFORE any insert; a crash mid-drain reuses it", async () => {
  const st = fresh();
  st.setItem(KEY, JSON.stringify([{ ...order(7), _queuedAt: "2026-09-17T00:00:00.000Z" }]));
  let seenId = null;
  await drainPendingOrders(async () => {
    seenId = loadPendingOrders()[0]._id;                   // read while the insert is in flight
    assert.ok(seenId, "id assigned and stored before the insert ran");
    throw new Error("network");                            // insert fails; entry stays
  });
  const after = loadPendingOrders();
  assert.equal(after.length, 1);
  assert.equal(after[0]._id, seenId, "the same identity survives for the retry");
});

test("a failed insert leaves the entry; a successful one dequeues exactly that entry (per-entry merge, not a final snapshot)", async () => {
  fresh();
  const a = await enqueuePendingOrder(order(1));
  const b = await enqueuePendingOrder(order(2));
  const c = await enqueuePendingOrder(order(3));
  await drainPendingOrders(async (row) => { if (row.total === 2) throw new Error("boom"); });
  const left = loadPendingOrders().map((e) => e._id);
  assert.deepEqual(left, [b.id]);
  assert.ok(!left.includes(a.id) && !left.includes(c.id));
});

test("only one drain is in flight per tab; concurrent callers share it and no entry inserts twice", async () => {
  fresh();
  await enqueuePendingOrder(order(1));
  await enqueuePendingOrder(order(2));
  const gate = deferred();
  const inserted = [];
  const insertFn = async (row) => { inserted.push(row.total); await gate.p; };
  const d1 = drainPendingOrders(insertFn);
  const d2 = drainPendingOrders(insertFn);
  assert.equal(d1, d2, "second caller gets the same in-flight promise");
  gate.resolve();
  await Promise.all([d1, d2]);
  assert.deepEqual(inserted.sort(), [1, 2]);
  assert.equal(loadPendingOrders().length, 0);
});

test("a persist that throws is reported: stored:false, queue unchanged, and saveOrderWithFallback says queued:false", async () => {
  const st = fresh();
  st.failSet = true;
  const r = await enqueuePendingOrder(order(9));
  assert.equal(r.stored, false);
  assert.equal(loadPendingOrders().length, 0);
  const res = await saveOrderWithFallback(order(9), async () => { throw new Error("offline"); });
  assert.equal(res.ok, false);
  assert.equal(res.queued, false, "must not claim the order is safe when nothing was stored");
});

test("a persist that silently does nothing is also reported: the write must read back", async () => {
  const st = fresh();
  st.silentNoop = true;
  const r = await enqueuePendingOrder(order(9));
  assert.equal(r.stored, false);
  const res = await saveOrderWithFallback(order(9), async () => { throw new Error("offline"); });
  assert.equal(res.queued, false);
});

test("MUTANT: a write that swallows its error reports success for a row that is not there", () => {
  // The shipped writePendingOrders: try { setItem } catch {} with no return
  // value, so enqueue always reported success. Reproduced to show the
  // scenario catches it.
  const st = fresh();
  st.failSet = true;
  const swallowed = (arr) => { try { localStorage.setItem(KEY, JSON.stringify(arr)); } catch {} return true; };
  assert.equal(swallowed([order(1)]), true, "the old code claimed success");
  assert.equal(loadPendingOrders().length, 0, "while nothing was stored");
});

test("saveOrderWithFallback: a successful insert kicks a background drain that cannot erase a concurrent enqueue", async () => {
  fresh();
  await enqueuePendingOrder(order(1));                     // queued earlier
  const gate = deferred();
  let calls = 0;
  const insertFn = async (row) => {
    calls++;
    if (calls === 1) return { id: "saved-now" };           // the live save succeeds
    await gate.p;                                          // the drain's insert of order 1 is slow
  };
  const res = await saveOrderWithFallback(order(2), insertFn);
  assert.equal(res.ok, true);
  await tick();                                            // background drain is awaiting order 1
  const r3 = await enqueuePendingOrder(order(3));          // a third order fails and queues meanwhile
  assert.equal(r3.stored, true);
  gate.resolve();
  await drainPendingOrders(insertFn);                      // joins the in-flight drain
  const left = loadPendingOrders().map((e) => e.total);
  assert.deepEqual(left, [3], "order 3 survived the background drain; order 1 drained");
});
