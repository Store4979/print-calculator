// Phase E — the margin-leak guard. Two independent gates and every
// customer-facing path. A customer seeing the store's margin is the worst
// failure of this feature; these tests are the contract.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { canSeeMarginFor, visibleMetrics, marginMetric, MARGIN_LINE_KEYS, CUSTOMER_FALLBACK_KEYS } from "../../src/lib/margin.js";

const src = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

test("gate 1: canSeeMargin is false whenever kiosk mode is on, regardless of role", () => {
  for (const employeeRole of [null, "staff", "manager"])
    for (const authRole of [null, "staff", "manager", "owner"])
      assert.equal(canSeeMarginFor({ kioskMode: true, employeeRole, authRole }), false, `${employeeRole}/${authRole}`);
});

test("gate 1: outside kiosk, manager PIN or owner/manager admin sees margin; staff PIN alone does not", () => {
  assert.equal(canSeeMarginFor({ kioskMode: false, employeeRole: "manager" }), true);
  assert.equal(canSeeMarginFor({ kioskMode: false, employeeRole: "staff" }), false);
  assert.equal(canSeeMarginFor({ kioskMode: false, employeeRole: null }), false);
  assert.equal(canSeeMarginFor({ kioskMode: false, employeeRole: "staff", authRole: "owner" }), true);
  assert.equal(canSeeMarginFor({ kioskMode: false, employeeRole: "staff", authRole: "manager" }), true);
  assert.equal(canSeeMarginFor({ kioskMode: false, employeeRole: "staff", authRole: "staff" }), false);
  // A stale localStorage employee from before Phase E has no role -> staff.
  assert.equal(canSeeMarginFor({ kioskMode: false, employeeRole: undefined }), false);
});

test("gate 2: visibleMetrics strips every staffOnly metric on a kiosk surface, by flag, whatever the label says", () => {
  const metrics = [
    { label: "Estimated total", value: "$12.60", big: true },
    marginMetric({ label: "Material margin", price: 12.6, cost: 1.58 }),
    { label: "Profit", value: "$11.02", staffOnly: true },       // a label the old regex would have missed
    { label: "GP", value: "87%", staffOnly: true },
    { label: "Sheets needed", value: 25 },
  ];
  const kiosk = visibleMetrics(metrics, { kiosk: true });
  assert.deepEqual(kiosk.map((m) => m.label), ["Estimated total", "Sheets needed"]);
  assert.equal(kiosk.some((m) => m.staffOnly), false);
  // Staff surface keeps everything.
  assert.equal(visibleMetrics(metrics, { kiosk: false }).length, 5);
  // Every margin metric is flagged.
  assert.equal(marginMetric({ label: "x", price: 1, cost: 0.5 }).staffOnly, true);
});

test("no label-text matching guards any surface", () => {
  const app = src("src/App.jsx");
  assert.equal(/\/margin\|markup\/i/.test(app), false, "the old label regex must be gone");
  assert.equal(/\.test\(\s*m\.label\s*\)/.test(app), false, "no regex against metric labels");
  assert.ok(app.includes("visibleMetrics("), "PriceBar/kiosk shim use the flag-based filter");
});

test("PriceBar's kiosk branch filters by flag before rendering", () => {
  const app = src("src/App.jsx");
  const start = app.indexOf("function PriceBar(");
  const body = app.slice(start, app.indexOf("\nfunction ", start + 10));
  assert.ok(start > 0);
  assert.ok(/if \(kioskAction\) \{[\s\S]*?visibleMetrics\(metrics, \{ kiosk: true \}\)/.test(body), "kiosk branch renders visibleMetrics(metrics, {kiosk:true})");
});

test("margin line-item keys never collide with the customer fallback keys", () => {
  for (const k of MARGIN_LINE_KEYS) assert.equal(CUSTOMER_FALLBACK_KEYS.includes(k), false, k);
  const app = src("src/App.jsx");
  // kioskQuoteSummary still only reads description/label/name for unknown kinds.
  assert.ok(app.includes('return li.description || li.label || li.name || "item";'));
});

test("email payload path carries no cost or margin", () => {
  const app = src("src/App.jsx");
  const i = app.indexOf("details: { jobType, user:{ name, email, phone }");
  assert.ok(i > 0, "sendOrderEmail details literal found");
  const details = app.slice(i, app.indexOf("jobPdfBase64, orderSheetPdfBase64", i));
  assert.equal(/cost|margin/i.test(details), false, details);
  // Identifiers only — the email HTML legitimately uses CSS `margin:`.
  const fn = src("netlify/functions/send-print-job.js");
  assert.equal(/margin_pct|cost_subtotal|marginPct|lineMarginPct|lineCost|costSubtotal|paperCost|clickColor|clickBW|baseCost/.test(fn), false);
});

test("order-sheet PDF totals carry no cost or margin", () => {
  const app = src("src/App.jsx");
  const arrays = [...app.matchAll(/const totals = \[[\s\S]*?\];/g)].map((m) => m[0]);
  assert.ok(arrays.length >= 3, "found the PDF totals arrays");
  for (const a of arrays) assert.equal(/margin|lineCost|costSubtotal|baseCost|paperCost|click/i.test(a), false, a);
  // addOrderSheetPage renders `totals` verbatim; nothing else feeds it.
  assert.equal(/addOrderSheetPage\([^)]*margin/i.test(app), false);
});

test("customer submit sheet and upload page render no margin", () => {
  const app = src("src/App.jsx");
  const i = app.indexOf("function KioskSubmitSheet(");
  const body = app.slice(i, app.indexOf("\nfunction ", i + 10));
  assert.ok(i > 0);
  // Identifiers only — inline styles use marginTop etc.
  const LEAK = /marginPct|lineMarginPct|lineCost|costSubtotal|margin_pct|cost_subtotal|marginMetric|canSeeMargin|marginLabel/;
  assert.equal(LEAK.test(body), false);
  // The submit sheet reads only snapshot.total, and the kiosk path builds the RAW snapshot.
  assert.ok(app.includes("const snapshot = buildSaleSnapshotRaw();"));
  const upload = src("src/UploadApp.jsx");
  assert.equal(LEAK.test(upload), false);
  assert.equal(/\$\{?\s*[a-zA-Z]*(price|total)/i.test(upload), false, "upload page renders no price");
});
