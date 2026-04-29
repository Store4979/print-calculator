// ============================================================
//  SPECIALTY / SIGNS365 TRADE-PRINT TAB
//
//  Phase 3: full UI + live pricing math.
//  - Loads pricing from src/data/signs365Pricing.json and deep-
//    merges admin overrides from localStorage.signs365Pricing
//    on top (Phase 5 fills that in via the admin panel).
//  - All pricing math runs inside the component so it always sees
//    the current state and the latest admin overrides.
//  - "Generate Trade Order PDF" is wired as a stub here and will
//    be filled in by Phase 4 (src/utils/tradeOrderPDF.js).
// ============================================================

import { useEffect, useMemo, useState } from "react";
import signs365PricingDefaults from "../data/signs365Pricing.json";

const LS_KEY = "signs365Pricing";

// Recursive merge: arrays overwrite (so admin can replace a sizes
// list cleanly), plain objects merge key-by-key, scalars overwrite.
const isPlainObject = (v) => v && typeof v === "object" && !Array.isArray(v);
const deepMerge = (base, override) => {
  if (!isPlainObject(base) || !isPlainObject(override)) return override ?? base;
  const out = { ...base };
  for (const [k, v] of Object.entries(override)) {
    if (isPlainObject(v) && isPlainObject(base[k])) out[k] = deepMerge(base[k], v);
    else out[k] = v;
  }
  return out;
};

const loadPricing = () => {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return deepMerge(signs365PricingDefaults, JSON.parse(raw));
  } catch {}
  return signs365PricingDefaults;
};

const fmtMoney = (n) => `$${(Number(n) || 0).toFixed(2)}`;

// Default option values for a freshly selected product.
const defaultOptionsFor = (product) => {
  if (!product) return {};
  const out = {};
  for (const [k, opt] of Object.entries(product.options || {})) {
    if (opt.type === "checkbox")     out[k] = !!opt.default;
    else if (opt.type === "select")  out[k] = opt.choices?.[0]?.value || "";
    else if (opt.type === "perEachAddon") out[k] = 0;
  }
  return out;
};

// ── Pricing math ──────────────────────────────────────────
// Returns null when inputs aren't ready (no product, no size, etc.).
// All math is local — no React calls — so it's easy to reason about.
function computePrice({ product, width, height, selectedSizeKey, quantity, selectedOptions, pricing }) {
  if (!product || !quantity || quantity < 1) return null;

  // 1) Base cost per piece + dimension snapshot for display / PDF.
  let perPieceCost = 0;
  let dimensions = null;

  if (product.pricingModel === "perSqFt") {
    const w = Number(width) || 0;
    const h = Number(height) || 0;
    if (w <= 0 || h <= 0) return null;
    const rawSqFt   = (w * h) / 144;
    const minSqFt   = Number(product.minSqFt) || 0;
    const billedSqFt = Math.max(rawSqFt, minSqFt);
    perPieceCost = billedSqFt * (Number(product.baseCostPerSqFt) || 0);
    dimensions = {
      kind: "perSqFt",
      width: w, height: h,
      sqFt: rawSqFt,
      billedSqFt,
      minApplied: rawSqFt < minSqFt,
      minSqFt,
    };
  } else if (product.pricingModel === "perPiece") {
    const size = (product.sizes || []).find((s) => s.key === selectedSizeKey);
    if (!size) return null;
    if (size.baseCost == null && size.perSqFtCost) {
      // Custom-size path inside a perPiece product (e.g. 30mil magnet "custom").
      const w = Number(width) || 0;
      const h = Number(height) || 0;
      if (w <= 0 || h <= 0) return null;
      const sqFt = (w * h) / 144;
      perPieceCost = sqFt * Number(size.perSqFtCost);
      dimensions = {
        kind: "perPieceCustom",
        width: w, height: h,
        sqFt,
        sizeKey: size.key,
        sizeLabel: size.label,
      };
    } else {
      perPieceCost = Number(size.baseCost) || 0;
      dimensions = {
        kind: "perPiece",
        sizeKey: size.key,
        sizeLabel: size.label,
      };
    }
  } else {
    return null;
  }

  // 2) Apply option costs / multipliers.
  let multiplier = 1;
  let perPieceFlatAddons = 0;
  let perSqFtAddons      = 0;
  let perLinearFtAddons  = 0;
  let totalPerEachAddons = 0; // summed once for the whole order, not per piece

  for (const [k, opt] of Object.entries(product.options || {})) {
    const v = selectedOptions[k];
    if (opt.type === "checkbox") {
      if (v) {
        if (typeof opt.cost === "number")           perPieceFlatAddons += opt.cost;
        if (typeof opt.costMultiplier === "number") multiplier *= opt.costMultiplier;
      }
    } else if (opt.type === "select") {
      const choice = (opt.choices || []).find((c) => c.value === v);
      if (choice) {
        if (typeof choice.cost === "number")            perPieceFlatAddons += choice.cost;
        if (typeof choice.costMultiplier === "number")  multiplier *= choice.costMultiplier;
        if (typeof choice.costPerSqFt === "number")     perSqFtAddons    += choice.costPerSqFt;
        if (typeof choice.costPerLinearFt === "number") perLinearFtAddons += choice.costPerLinearFt;
      }
    } else if (opt.type === "perEachAddon") {
      const count = Number(v) || 0;
      totalPerEachAddons += count * (Number(opt.costPerEach) || 0);
    }
  }

  let perPieceWithAddons = perPieceCost * multiplier;

  // Per-sq-ft option costs (e.g. lamination): use billed sq ft when
  // we have it, else raw sq ft for the perPieceCustom path.
  const sqFtForAddons = dimensions?.billedSqFt ?? dimensions?.sqFt ?? 0;
  if (perSqFtAddons > 0 && sqFtForAddons > 0) {
    perPieceWithAddons += sqFtForAddons * perSqFtAddons;
  }

  // Per-linear-ft option costs (e.g. pole pocket). We bill against
  // banner WIDTH in feet — pole pockets run along the top edge (or
  // top + bottom; the rate already encodes that).
  if (perLinearFtAddons > 0 && dimensions?.width) {
    const linearFt = dimensions.width / 12;
    perPieceWithAddons += linearFt * perLinearFtAddons;
  }

  perPieceWithAddons += perPieceFlatAddons;

  // 3) Total base cost across all pieces + the once-per-order addons.
  const baseCost = perPieceWithAddons * quantity + totalPerEachAddons;

  // 4) Quantity discount tier.
  const qtyTier = (pricing.quantityDiscounts || []).find((d) =>
    quantity >= (d.minQty || 0) && (d.maxQty == null || quantity <= d.maxQty)
  );
  const qtyDiscountPct = Number(qtyTier?.discount) || 0;
  const postDiscountCost = baseCost * (1 - qtyDiscountPct);

  // 5) Markup tier (post-discount cost determines the bracket).
  const markupTier = (pricing.markup?.tiers || []).find((t) =>
    t.maxCost == null || postDiscountCost <= Number(t.maxCost)
  );
  const markupMultiplier = Number(markupTier?.multiplier) || 1;
  const customerPrice = postDiscountCost * markupMultiplier;
  const margin        = customerPrice - postDiscountCost;
  const marginPct     = customerPrice > 0 ? (margin / customerPrice) * 100 : 0;

  return {
    perPieceCost: perPieceWithAddons,
    baseCost,
    postDiscountCost,
    customerPrice,
    margin,
    marginPct,
    appliedTier: markupTier,
    appliedDiscount: qtyTier,
    markupMultiplier,
    qtyDiscountPct,
    dimensions,
    options: { perPieceFlatAddons, perSqFtAddons, perLinearFtAddons, totalPerEachAddons, multiplier },
  };
}

// ── Component ────────────────────────────────────────────
export default function SpecialtyTab({ CardHeader }) {
  const [pricing, setPricing] = useState(loadPricing);

  // Pick up admin edits from another tab / window. Phase 5's editor
  // dispatches a CustomEvent so the same tab also updates.
  useEffect(() => {
    const refresh = () => setPricing(loadPricing());
    const onStorage = (e) => { if (e.key === LS_KEY) refresh(); };
    window.addEventListener("storage", onStorage);
    window.addEventListener("signs365PricingUpdated", refresh);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("signs365PricingUpdated", refresh);
    };
  }, []);

  const [selectedCategory, setSelectedCategory] = useState("");
  const [selectedProduct,  setSelectedProduct]  = useState("");
  const [width,   setWidth]   = useState("");
  const [height,  setHeight]  = useState("");
  const [selectedSizeKey, setSelectedSizeKey] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [selectedOptions, setSelectedOptions] = useState({});

  const cat = pricing.categories?.[selectedCategory];
  const product = cat?.products?.[selectedProduct];

  // Reset downstream state when the category or product changes.
  useEffect(() => {
    setSelectedProduct("");
    setSelectedSizeKey("");
    setSelectedOptions({});
    setWidth(""); setHeight("");
  }, [selectedCategory]);

  useEffect(() => {
    setSelectedSizeKey("");
    setWidth(""); setHeight("");
    setSelectedOptions(defaultOptionsFor(product));
  }, [selectedProduct, product]);

  const priceResult = useMemo(
    () => computePrice({ product, width, height, selectedSizeKey, quantity, selectedOptions, pricing }),
    [product, width, height, selectedSizeKey, quantity, selectedOptions, pricing]
  );

  const isPerPieceCustomSelected = useMemo(() => {
    if (!product || product.pricingModel !== "perPiece") return false;
    const size = (product.sizes || []).find((s) => s.key === selectedSizeKey);
    return !!size && size.baseCost == null && !!size.perSqFtCost;
  }, [product, selectedSizeKey]);

  const handleReset = () => {
    setSelectedCategory("");
    setSelectedProduct("");
    setSelectedSizeKey("");
    setSelectedOptions({});
    setWidth(""); setHeight("");
    setQuantity(1);
  };

  const handleGeneratePdf = () => {
    // Phase 4 fills this in. The orderData shape is captured here so
    // Phase 4's helper has a clear contract:
    const orderData = {
      category:    cat ? { key: selectedCategory, label: cat.label } : null,
      product:     product ? { key: selectedProduct, label: product.label, pricingModel: product.pricingModel } : null,
      dimensions:  priceResult?.dimensions || null,
      quantity,
      options:     selectedOptions,
      optionMeta:  product?.options || {},
      pricing:     priceResult,
    };
    if (typeof window !== "undefined") window.__lastSpecialtyOrder = orderData;
    alert("PDF generation lands in Phase 4 — order spec captured.");
  };

  const canGenerate = !!priceResult;

  // ── Render ──
  return (
    <>
      <div className="pc-card">
        <CardHeader
          step="1"
          stepClass="step-num-purple"
          title="Specialty / Trade Print (Signs365)"
          hint="Pick a category, then a product"
        />
        <div className="pc-card-body">
          <div className="grid-2" style={{ marginBottom: 16 }}>
            <div>
              <label className="field-label">Category</label>
              <div className="pc-select-wrap">
                <select
                  className="pc-select"
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value)}
                >
                  <option value="">— Choose a category —</option>
                  {Object.entries(pricing.categories || {}).map(([key, c]) => (
                    <option key={key} value={key}>{c.label}</option>
                  ))}
                </select>
              </div>
              {cat?.description && (
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>{cat.description}</div>
              )}
            </div>
            <div>
              <label className="field-label">Product</label>
              <div className="pc-select-wrap">
                <select
                  className="pc-select"
                  value={selectedProduct}
                  onChange={(e) => setSelectedProduct(e.target.value)}
                  disabled={!cat}
                >
                  <option value="">{cat ? "— Choose a product —" : "(pick category first)"}</option>
                  {cat && Object.entries(cat.products || {}).map(([key, p]) => (
                    <option key={key} value={key}>{p.label}</option>
                  ))}
                </select>
              </div>
              {product && (
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
                  {product.pricingModel === "perSqFt"
                    ? `Priced per sq ft — minimum ${product.minSqFt || 0} sq ft`
                    : "Priced per piece"}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Step 2 — Size + quantity (only meaningful once a product is selected) */}
      {product && (
        <div className="pc-card">
          <CardHeader
            step="2"
            stepClass="step-num-purple"
            title="Size & quantity"
            hint={product.pricingModel === "perSqFt"
              ? "Enter the finished print dimensions in inches"
              : "Pick a stock size or use a custom one"}
          />
          <div className="pc-card-body">
            {product.pricingModel === "perSqFt" && (
              <div className="grid-3" style={{ marginBottom: 12 }}>
                <div>
                  <label className="field-label">Width (in)</label>
                  <input
                    className="pc-input"
                    type="number"
                    inputMode="decimal"
                    min="1"
                    step="0.5"
                    value={width}
                    onChange={(e) => setWidth(e.target.value)}
                  />
                </div>
                <div>
                  <label className="field-label">Height (in)</label>
                  <input
                    className="pc-input"
                    type="number"
                    inputMode="decimal"
                    min="1"
                    step="0.5"
                    value={height}
                    onChange={(e) => setHeight(e.target.value)}
                  />
                </div>
                <div>
                  <label className="field-label">Quantity</label>
                  <input
                    className="pc-input"
                    type="number"
                    inputMode="numeric"
                    min="1"
                    step="1"
                    value={quantity}
                    onChange={(e) => setQuantity(Math.max(1, Number(e.target.value) || 1))}
                  />
                </div>
              </div>
            )}

            {product.pricingModel === "perPiece" && (
              <>
                <div className="grid-2" style={{ marginBottom: 12 }}>
                  <div>
                    <label className="field-label">Stock size</label>
                    <div className="pc-select-wrap">
                      <select
                        className="pc-select"
                        value={selectedSizeKey}
                        onChange={(e) => setSelectedSizeKey(e.target.value)}
                      >
                        <option value="">— Choose a size —</option>
                        {(product.sizes || []).map((s) => (
                          <option key={s.key} value={s.key}>{s.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="field-label">Quantity</label>
                    <input
                      className="pc-input"
                      type="number"
                      inputMode="numeric"
                      min="1"
                      step="1"
                      value={quantity}
                      onChange={(e) => setQuantity(Math.max(1, Number(e.target.value) || 1))}
                    />
                  </div>
                </div>
                {isPerPieceCustomSelected && (
                  <div className="grid-2" style={{ marginBottom: 4 }}>
                    <div>
                      <label className="field-label">Custom width (in)</label>
                      <input
                        className="pc-input"
                        type="number"
                        inputMode="decimal"
                        min="1"
                        step="0.5"
                        value={width}
                        onChange={(e) => setWidth(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="field-label">Custom height (in)</label>
                      <input
                        className="pc-input"
                        type="number"
                        inputMode="decimal"
                        min="1"
                        step="0.5"
                        value={height}
                        onChange={(e) => setHeight(e.target.value)}
                      />
                    </div>
                  </div>
                )}
              </>
            )}

            {priceResult?.dimensions?.kind === "perSqFt" && (
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
                {priceResult.dimensions.sqFt.toFixed(2)} sq ft
                {priceResult.dimensions.minApplied && (
                  <span style={{ color: "var(--amber)" }}>
                    {" · "}Below minimum — billing the {priceResult.dimensions.minSqFt} sq ft minimum
                  </span>
                )}
              </div>
            )}
            {priceResult?.dimensions?.kind === "perPieceCustom" && (
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
                Custom · {priceResult.dimensions.sqFt.toFixed(2)} sq ft per piece
              </div>
            )}
          </div>
        </div>
      )}

      {/* Step 3 — Options */}
      {product && Object.keys(product.options || {}).length > 0 && (
        <div className="pc-card">
          <CardHeader
            step="3"
            stepClass="step-num-purple"
            title="Options"
            hint="Per-product upgrades and add-ons"
          />
          <div className="pc-card-body specialty-options">
            {Object.entries(product.options).map(([key, opt]) => (
              <SpecialtyOption
                key={key}
                optKey={key}
                opt={opt}
                value={selectedOptions[key]}
                onChange={(v) => setSelectedOptions((prev) => ({ ...prev, [key]: v }))}
              />
            ))}
          </div>
        </div>
      )}

      {/* Sticky price + actions */}
      <div className="price-bar price-bar-purple">
        <div className="price-metrics">
          <div className="price-metric">
            <div className="price-metric-label">Customer price</div>
            <div className="price-metric-val is-total-purple">
              {priceResult ? fmtMoney(priceResult.customerPrice) : "—"}
            </div>
          </div>
          <div className="price-metric">
            <div className="price-metric-label">Per piece</div>
            <div className="price-metric-val">
              {priceResult ? fmtMoney(priceResult.customerPrice / Math.max(1, quantity)) : "—"}
            </div>
          </div>
          <div className="price-metric">
            <div className="price-metric-label">Quantity discount</div>
            <div className="price-metric-val">
              {priceResult?.qtyDiscountPct
                ? `${(priceResult.qtyDiscountPct * 100).toFixed(0)}% off`
                : "—"}
            </div>
          </div>
          <div className="price-metric">
            <div className="price-metric-label">Margin</div>
            <div className="price-metric-val">
              {priceResult
                ? `${fmtMoney(priceResult.margin)} (${priceResult.marginPct.toFixed(1)}%)`
                : "—"}
            </div>
          </div>
        </div>
        <div className="price-bar-actions">
          <button
            type="button"
            className="pc-btn pc-btn-secondary"
            onClick={handleReset}
            title="Clear all fields"
          >
            Reset
          </button>
          <button
            type="button"
            className="pc-btn pc-btn-purple"
            onClick={handleGeneratePdf}
            disabled={!canGenerate}
            title={canGenerate ? "Generate the trade-order PDF" : "Pick a category, product, size, and quantity first"}
          >
            ⬇ Generate Trade Order PDF
          </button>
        </div>
      </div>
    </>
  );
}

// ── Single option renderer ────────────────────────────────
function SpecialtyOption({ optKey, opt, value, onChange }) {
  if (opt.type === "checkbox") {
    return (
      <label className="specialty-opt specialty-opt-row">
        <input
          type="checkbox"
          checked={!!value}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="specialty-opt-label">{opt.label}</span>
        {opt.cost > 0 && <span className="specialty-opt-cost">+{fmtMoney(opt.cost)}</span>}
        {opt.costMultiplier && opt.costMultiplier !== 1 && (
          <span className="specialty-opt-cost">×{opt.costMultiplier.toFixed(2)}</span>
        )}
      </label>
    );
  }
  if (opt.type === "select") {
    return (
      <div className="specialty-opt">
        <label className="field-label">{opt.label}</label>
        <div className="pc-select-wrap">
          <select
            className="pc-select"
            value={value || ""}
            onChange={(e) => onChange(e.target.value)}
          >
            {(opt.choices || []).map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
                {c.cost ? ` (+${fmtMoney(c.cost)})` : ""}
                {c.costMultiplier && c.costMultiplier !== 1 ? ` (×${c.costMultiplier})` : ""}
                {c.costPerSqFt ? ` (+${fmtMoney(c.costPerSqFt)}/sqft)` : ""}
                {c.costPerLinearFt ? ` (+${fmtMoney(c.costPerLinearFt)}/lin ft)` : ""}
              </option>
            ))}
          </select>
        </div>
      </div>
    );
  }
  if (opt.type === "perEachAddon") {
    return (
      <div className="specialty-opt specialty-opt-row">
        <label className="specialty-opt-label">{opt.label}</label>
        <input
          className="pc-input specialty-opt-num"
          type="number"
          inputMode="numeric"
          min="0"
          step="1"
          value={value || 0}
          onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))}
        />
        <span className="specialty-opt-cost">+{fmtMoney(opt.costPerEach)} ea</span>
      </div>
    );
  }
  return null;
}
