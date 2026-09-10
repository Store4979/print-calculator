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
