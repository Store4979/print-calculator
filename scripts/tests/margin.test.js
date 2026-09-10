// Phase E — cost & margin engine. Run with `yarn test` (node --test, no deps).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canSeeMarginFor, marginLabelFor, decomposeEntry, withSplit, sheetCostPerSheet, lfCostPerSqFt,
  computeMargin, marginHealth, solveMarkupFromPrice, priceFromMarkup, costUpDeltas, repriceFromMarkup,
  laborFor, finalizeSnapshotMargin, previewCostIncrease, bwClickUnset, DEFAULT_THRESHOLDS,
} from "../../src/lib/margin.js";

// Real production entry (28lb 8.5x11, cloud + pricing.json agree).
const E28 = { baseCostColor: 0.063, baseCostBW: 0.0269, priceColor: 0.504, priceBW: 0.2152 };

test("decomposition default is lossless and matches the E-02 backfill", () => {
  const d = decomposeEntry(E28);
  assert.deepEqual(d, { paperCost: 0.0269, clickColor: 0.0361, clickBW: 0, explicit: false });
  assert.equal(bwClickUnset(E28), true);
  const e2 = withSplit(E28, { clickBW: 0.009 });         // owner enters the true B&W click
  assert.equal(e2.paperCost, 0.0269);                      // paper cost unchanged until edited
  assert.equal(e2.baseCostBW, 0.0359);                     // derived base cost moves with it
  assert.equal(bwClickUnset(e2), false);
});

test("per-sheet cost: simplex color, simplex bw, duplex color, duplex bw", () => {
  assert.equal(sheetCostPerSheet(E28, { frontColorMode: "color" }), 0.063);
  assert.equal(sheetCostPerSheet(E28, { frontColorMode: "bw" }), 0.0269);
  assert.equal(sheetCostPerSheet(E28, { frontColorMode: "color", showBack: true, backColorMode: "color" }), 0.0991);
  // B&W back costs nothing while clickBW is 0 — the consequence the editor callout names.
  assert.equal(sheetCostPerSheet(E28, { frontColorMode: "bw", showBack: true, backColorMode: "bw" }), 0.0269);
});

test("margin is computed on the POST-discount price; three hand-calculated jobs", () => {
  // 28lb 8.5x11 color simplex, price 0.504, cost 0.063 per sheet.
  const job = (sheets, factor) => computeMargin({ price: 0.504 * sheets * factor, cost: 0.063 * sheets });
  let m = job(25, 1);      assert.equal(m.price, 12.6);   assert.equal(m.cost, 1.58);  assert.equal(m.marginPct, 87.5);
  m = job(300, 0.8);       assert.equal(m.price, 120.96); assert.equal(m.cost, 18.9);  assert.equal(m.marginPct, 84.38);
  m = job(700, 0.6);       assert.equal(m.price, 211.68); assert.equal(m.cost, 44.1);  assert.equal(m.marginPct, 79.17);
  // Underwater and zero-price cases.
  assert.equal(computeMargin({ price: 10, cost: 11.25 }).marginPct, -12.5);
  assert.equal(computeMargin({ price: 0, cost: 1 }).marginPct, null);
});

test("health thresholds (owner defaults 75/50), editable", () => {
  assert.equal(marginHealth(87.5), "healthy");
  assert.equal(marginHealth(74.99), "thin");
  assert.equal(marginHealth(49.99), "underwater");
  assert.equal(marginHealth(null), null);
  assert.equal(marginHealth(60, { healthy: 60, thin: 30 }), "healthy");
  assert.deepEqual(DEFAULT_THRESHOLDS, { healthy: 75, thin: 50 });
});

test("dual pricing modes round-trip: market-down solves markup, cost-up reprices", () => {
  assert.equal(solveMarkupFromPrice(0.504, 0.063), 700);
  assert.equal(priceFromMarkup(0.063, 700), 0.504);
  assert.equal(priceFromMarkup(0.0269, 700), 0.2152);
  // Identity holds on the real paper -> switching back to cost-up changes nothing.
  assert.deepEqual(costUpDeltas({ sizes: { "8.5x11": E28 }, markup: 700 }), []);
  // A market-down price the owner typed -> the switchback lists exactly that cell and the delta.
  const edited = { "8.5x11": { ...E28, priceColor: 0.55 } };
  assert.deepEqual(costUpDeltas({ sizes: edited, markup: 700 }), [
    { sizeKey: "8.5x11", colorMode: "color", from: 0.55, to: 0.504, delta: -0.046 },
  ]);
  assert.equal(repriceFromMarkup(edited, 700)["8.5x11"].priceColor, 0.504);
  assert.equal(solveMarkupFromPrice(1, 0), null);
});

test("labor is absent when disabled, participates when enabled; label follows the toggle", () => {
  assert.equal(laborFor({ enabled: false, setupPerJob: 5, perUnit: 0.1 }, 100), 0);
  assert.equal(laborFor({ enabled: true, setupPerJob: 5, perUnit: 0.1 }, 100), 15);
  assert.equal(marginLabelFor(false), "Material margin");
  assert.equal(marginLabelFor(true), "Margin");
});

test("snapshot stamping: cost_subtotal/margin_pct from the same line values; NULL when a line lacks cost", () => {
  const snap = { total: 12.6, lineItems: [{ kind: "sheet_line", lineTotal: 12.6, lineCost: 1.575, laborUnits: 25 }] };
  const out = finalizeSnapshotMargin(snap);
  assert.equal(out.costSubtotal, 1.58);
  assert.equal(out.marginPct, 87.46);
  assert.equal(out.lineItems[0].lineMarginPct, 87.5);
  const withLabor = finalizeSnapshotMargin(snap, { labor: { enabled: true, setupPerJob: 2, perUnit: 0.05 } });
  assert.equal(withLabor.costSubtotal, 4.83);            // 1.575 + 2 + 1.25 -> 4.825 -> 4.83
  const unknown = finalizeSnapshotMargin({ total: 5, lineItems: [{ kind: "specialty", lineTotal: 5 }] });
  assert.equal(unknown.costSubtotal, null);
  assert.equal(unknown.marginPct, null);
});

test("cost-increase model: cost-up holds margin and raises price; market-down holds price and absorbs margin", () => {
  const sheetPricing = { "28lb": { "8.5x11": E28 } };
  const up = previewCostIncrease({ sheetPricing, markups: { "28lb": 700 }, modes: { "28lb": "cost_up" }, percent: 10, paperKeys: ["28lb"] });
  const c = up.rows.find((r) => r.colorMode === "color");
  assert.equal(c.newCost, 0.0657);                        // paper 0.0269*1.1=0.02959 + click 0.0361
  assert.equal(c.newPrice, 0.5256);                       // 0.0657 * 8
  assert.equal(c.oldMarginPct, c.newMarginPct);           // margin held
  const down = previewCostIncrease({ sheetPricing, markups: { "28lb": 700 }, modes: { "28lb": "market_down" }, percent: 10, paperKeys: ["28lb"] });
  const d = down.rows.find((r) => r.colorMode === "color");
  assert.equal(d.newPrice, d.oldPrice);                   // price held
  assert.ok(d.newMarginPct < d.oldMarginPct);             // margin absorbs it
  assert.equal(down.apply.sheetPricing["28lb"]["8.5x11"].baseCostColor, 0.0657);
  // LF: media-only cost.
  const lf = previewCostIncrease({ lfPricing: { hp: { baseCostColor: 0.74, baseCostBW: 0, priceColor: 6.66, priceBW: 0 } }, lfMarkups: { hp: 800 }, percent: 5, lfPaperKeys: ["hp"] });
  assert.equal(lfCostPerSqFt(lf.apply.lfPricing.hp), 0.777);
  assert.equal(lf.rows[0].newPrice, 6.993);
});
