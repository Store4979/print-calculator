// ============================================================
//  SPECIALTY / SIGNS365 TRADE-PRINT TAB — v2 schema
//
//  Data: src/data/signs365Pricing.json (real Signs365 catalog).
//  Admin overrides live under localStorage.signs365Pricing and
//  deep-merge on top. Old v1 overrides (catalog rewrite) are
//  discarded automatically.
//
//  Pricing engine:
//    1. Resolve the active variant (sides), pick the right tier
//       table, then locate the active tier by tier-break basis
//       (totalSqFt | sheets | quantity).
//    2. Compute per-piece base by pricingModel (perSqFt /
//       perSheet / perSqInch / perPiece). perSheet derives sheets
//       needed from piecesPerSheet; perSqInch optionally rolls
//       up to sheets for shipping.
//    3. Apply min-price floor per piece (when minPrice is set —
//       can be a number or a per-variant {single,double} map).
//    4. Apply option costs in order: per-sq-ft and per-linear-ft
//       add-ons, flat per-piece add-ons, then per-each add-ons +
//       setup fees (one-time), then percent multipliers (rush,
//       contour) applied LAST and multiplicatively.
//    5. Compute shipping by rule kind (totalSqFt / sheetBands /
//       perItem / perSqIn / perSheet). Markup is applied to the
//       print cost only; shipping passes through at cost.
//
//  jsPDF is loaded via CDN — don't import it as a module.
// ============================================================

import { useEffect, useMemo, useRef, useState } from "react";
import signs365PricingDefaults from "../data/signs365Pricing.json";
import { generateTradeOrderPDF } from "../utils/tradeOrderPDF.js";

const LS_KEY = "signs365Pricing";

// ── Deep merge with undefined-passthrough ──────────────
const isPlainObject = (v) => v && typeof v === "object" && !Array.isArray(v);
const deepMerge = (base, override) => {
  if (!isPlainObject(base) || !isPlainObject(override)) return override ?? base;
  const out = { ...base };
  for (const [k, v] of Object.entries(override)) {
    if (v === undefined) continue;
    if (isPlainObject(v) && isPlainObject(base[k])) out[k] = deepMerge(base[k], v);
    else out[k] = v;
  }
  return out;
};

// ── Load pricing (with v1 override migration / drop) ───
// v1 stored a totally different shape under the same key. If the
// stored override doesn't claim _version "2.0" or higher, drop it
// so the v2 catalog isn't corrupted. (Prompt explicitly OKs this.)
const loadPricing = () => {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const overrides = JSON.parse(raw);
      const v = String(overrides?._version || "");
      if (v && v.startsWith("2")) {
        return deepMerge(signs365PricingDefaults, overrides);
      }
      // Legacy override — discard.
      try { localStorage.removeItem(LS_KEY); } catch {}
    }
  } catch {}
  return signs365PricingDefaults;
};

// ── Helpers ──────────────────────────────────────────
const fmtMoney = (n) => `$${(Number(n) || 0).toFixed(2)}`;
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const resolveSizes = (pricing, product) => {
  if (Array.isArray(product.sizes)) return product.sizes;
  if (product.sizesRef) return pricing._sharedSizes?.[product.sizesRef] || [];
  return [];
};

const defaultOptionsFor = (product) => {
  const out = {};
  for (const opt of product?.options || []) {
    if (opt.type === "checkbox" || opt.type === "setupFee" || opt.type === "perLinearFt" || opt.type === "perSqFtAddon" || opt.type === "percentMultiplier") {
      out[opt.key] = !!opt.default;
    } else if (opt.type === "select" || opt.type === "tierVariant") {
      out[opt.key] = opt.default ?? opt.choices?.[0]?.value ?? "";
    } else if (opt.type === "perEachAddon") {
      out[opt.key] = Number(opt.default) || 0;
    }
  }
  return out;
};

// Pick a tier table off a product. When a tierVariant option is
// active, product.tiers is keyed by the variant value; otherwise
// it's a plain array.
const tierTableFor = (product, options) => {
  if (Array.isArray(product.tiers)) return product.tiers;
  if (isPlainObject(product.tiers)) {
    const variantOpt = (product.options || []).find((o) => o.type === "tierVariant");
    const v = variantOpt ? options?.[variantOpt.key] : null;
    if (v && product.tiers[v]) return product.tiers[v];
    // fall back to the first variant's tier table
    const firstKey = Object.keys(product.tiers)[0];
    return product.tiers[firstKey] || [];
  }
  return [];
};

const findTier = (table, value) => {
  if (!Array.isArray(table) || !table.length) return null;
  return table.find((t) =>
    value >= (t.minQty || 0) && (t.maxQty == null || value <= t.maxQty)
  ) || table[table.length - 1];
};

const findMarkupTier = (markup, postDiscountCost) => {
  const tiers = markup?.tiers || [];
  return tiers.find((t) => t.maxCost == null || postDiscountCost <= Number(t.maxCost))
       || tiers[tiers.length - 1]
       || { multiplier: 1, label: "—" };
};

// piece "fits" a sheet band (rigid_sheet / acrylic_sheet). Bands
// are expressed in min/max width+height — we sort the piece's
// dimensions so 24×36 and 36×24 both qualify for the same band.
const fitsBand = (pieceW, pieceH, band) => {
  if (!pieceW || !pieceH) return false;
  const sw = Math.min(pieceW, pieceH);
  const lh = Math.max(pieceW, pieceH);
  const minW = Number(band.minWidth)  || 0;
  const maxW = Number(band.maxWidth)  || Infinity;
  const minH = Number(band.minHeight) || 0;
  const maxH = Number(band.maxHeight) || Infinity;
  return sw >= minW && sw <= maxW && lh >= minH && lh <= maxH;
};

const pickBand = (rule, pieceW, pieceH) => {
  const bands = rule?.sizeBands || [];
  return bands.find((b) => fitsBand(pieceW, pieceH, b)) || bands[bands.length - 1];
};

// Walk a sheetBand-style tier list to pick the active row by sheets.
const pickSheetBandTier = (band, sheets) => {
  const tiers = band?.tiers || [];
  for (const t of tiers) {
    const min = Number(t.minSheets) || 0;
    const max = t.maxSheets == null ? Infinity : Number(t.maxSheets);
    if (sheets >= min && sheets <= max) return t;
    // perSheets tier matches when sheets > 0 and we haven't hit a higher freight tier yet
    if (t.perSheets && sheets > 0 && (!min || sheets >= min) && (!t.maxSheets || sheets <= t.maxSheets)) {
      // see below — let the cost calc multiply
      return t;
    }
  }
  return tiers[tiers.length - 1];
};

// ── Signs365 96"×48" sheet-stock cap (rigid signs + magnets) ──
// Signs365 sources rigid sheet at 96"×48" max. A piece "fits" if you
// can rotate it onto the long axis: min(w,h) ≤ 48 AND max(w,h) ≤ 96.
const SIZE_CAPPED_CATEGORIES = new Set(["rigidSigns", "magnets"]);
const SIZE_CAP_LONG = 96;
const SIZE_CAP_SHORT = 48;

const isSizeCappedCategory = (categoryKey) => SIZE_CAPPED_CATEGORIES.has(categoryKey);

const isOverSizeCap = (w, h) => {
  if (!(w > 0) || !(h > 0)) return false;
  const short = Math.min(w, h);
  const long  = Math.max(w, h);
  return short > SIZE_CAP_SHORT || long > SIZE_CAP_LONG;
};

// Pure panel-split helper. Returns the layout that covers w × h with
// the fewest 96×48-or-smaller rectangular panels; ties broken by
// least wasted area. Each panel is the design-area chunk rounded up
// to nearest 0.25" (slightly oversized to avoid underprint at seams).
const computePanelSplit = (w, h) => {
  if (!(w > 0) || !(h > 0)) return null;

  const ceilQuarter = (n) => Math.ceil(n * 4) / 4;

  const layoutOf = (panelsAlongLong, panelsAlongShort, longDim, shortDim) => {
    if (panelsAlongLong < 1 || panelsAlongShort < 1) return null;
    const panelLong  = ceilQuarter(longDim  / panelsAlongLong);
    const panelShort = ceilQuarter(shortDim / panelsAlongShort);
    const total = panelsAlongLong * panelsAlongShort;
    const totalArea = (panelLong * panelsAlongLong) * (panelShort * panelsAlongShort);
    const designArea = longDim * shortDim;
    return { total, panelLong, panelShort, panelsAlongLong, panelsAlongShort,
             waste: Math.max(0, totalArea - designArea) };
  };

  const longDim  = Math.max(w, h);
  const shortDim = Math.min(w, h);

  // Orientation A: long side runs along the 96" panel axis.
  const a = layoutOf(
    Math.ceil(longDim  / SIZE_CAP_LONG),
    Math.ceil(shortDim / SIZE_CAP_SHORT),
    longDim, shortDim
  );
  // Orientation B: long side runs along the 48" panel axis.
  const b = layoutOf(
    Math.ceil(longDim  / SIZE_CAP_SHORT),
    Math.ceil(shortDim / SIZE_CAP_LONG),
    longDim, shortDim
  );

  const candidates = [a, b].filter(Boolean);
  if (!candidates.length) return null;

  candidates.sort((x, y) => x.total - y.total || x.waste - y.waste);
  const pick = candidates[0];

  // Map back to W×H labels (longest dim first in display).
  const wIsLong = w >= h;
  return {
    totalPanels: pick.total,
    panelsW: wIsLong ? pick.panelsAlongLong : pick.panelsAlongShort,
    panelsH: wIsLong ? pick.panelsAlongShort : pick.panelsAlongLong,
    panelW:  wIsLong ? pick.panelLong       : pick.panelShort,
    panelH:  wIsLong ? pick.panelShort      : pick.panelLong,
    extreme: longDim > 200 || shortDim > 200,
  };
};

// ── Shipping ─────────────────────────────────────────
function computeShipping({ pricing, product, dim, quantity, sheetsNeeded, totalSqIn, totalSqFt, pieceW, pieceH }) {
  const ruleKey = product.shippingRule;
  const rule = pricing.shippingRules?.[ruleKey];
  const warnings = [];
  if (!rule) return { cost: 0, label: "No shipping rule", warnings };

  // Oversize freight triggers (any dimension ≥ N) — short-circuit.
  for (const trigger of rule.freightTriggers || []) {
    if (trigger.kind === "anyDimensionGte") {
      if ((pieceW && pieceW >= trigger.value) || (pieceH && pieceH >= trigger.value)) {
        warnings.push(trigger.label || `Oversize: ${trigger.value}\"+ → freight`);
        return { cost: Number(trigger.cost) || 199, label: trigger.label || "Freight (oversize)", freight: true, warnings };
      }
    }
  }

  if (rule.kind === "totalSqFt") {
    const tiers = rule.tiers || [];
    const t = tiers.find((tt) => tt.maxSqFt == null || totalSqFt <= Number(tt.maxSqFt))
           || tiers[tiers.length - 1];
    if (t?.freight) warnings.push(t.label || "Freight shipping required");
    return { cost: Number(t?.cost) || 0, label: t?.label || "—", freight: !!t?.freight, warnings };
  }

  if (rule.kind === "perItem") {
    const tiers = rule.tiers || [];
    let chosen = null;
    for (const t of tiers) {
      const min = Number(t.minItems) || 0;
      const max = t.maxItems == null ? Infinity : Number(t.maxItems);
      if (quantity >= min && quantity <= max) { chosen = t; break; }
      if (t.perItems && quantity > 0 && quantity <= max) { chosen = t; break; }
    }
    if (!chosen) chosen = tiers[tiers.length - 1];
    if (chosen?.freight) warnings.push(chosen.label || "Freight required");
    let cost = Number(chosen?.cost) || 0;
    if (chosen?.perItems) {
      // "$10 per 10 magnets" — each 10-pack (or fraction) costs $cost
      const groups = Math.max(1, Math.ceil(quantity / Number(chosen.perItems)));
      cost = groups * Number(chosen.cost);
    } else if (chosen?.perItem) {
      // "$10 per stand" — multiplied by qty
      cost = quantity * Number(chosen.cost);
    }
    return { cost, label: chosen?.label || "—", freight: !!chosen?.freight, warnings };
  }

  if (rule.kind === "perSheet") {
    // $X per N sheets. sheets here can be sheetsNeeded (perSheet products)
    // or simply quantity for per-set products.
    const tiers = rule.tiers || [];
    const sheets = sheetsNeeded ?? quantity;
    let chosen = null;
    for (const t of tiers) {
      const min = Number(t.minSheets) || 0;
      const max = t.maxSheets == null ? Infinity : Number(t.maxSheets);
      if (t.perSheets) { chosen = t; }
      else if (sheets >= min && sheets <= max) { chosen = t; break; }
    }
    if (!chosen) chosen = tiers[tiers.length - 1];
    if (chosen?.freight) warnings.push(chosen.label || "Freight required");
    let cost = Number(chosen?.cost) || 0;
    if (chosen?.perSheets) {
      const groups = Math.max(1, Math.ceil(sheets / Number(chosen.perSheets)));
      cost = groups * Number(chosen.cost);
    }
    return { cost, label: chosen?.label || "—", freight: !!chosen?.freight, warnings };
  }

  if (rule.kind === "perSqIn") {
    const tiers = rule.tiers || [];
    let chosen = null;
    for (const t of tiers) {
      const min = Number(t.minSqIn) || 0;
      const max = t.maxSqIn == null ? Infinity : Number(t.maxSqIn);
      if (totalSqIn >= min && totalSqIn <= max) { chosen = t; break; }
      if (t.perSqIn && totalSqIn > 0 && (!t.maxSqIn || totalSqIn <= t.maxSqIn)) { chosen = t; break; }
    }
    if (!chosen) chosen = tiers[tiers.length - 1];
    if (chosen?.freight) warnings.push(chosen.label || "Freight required");
    let cost = Number(chosen?.cost) || 0;
    if (chosen?.perSqIn) {
      const groups = Math.max(1, Math.ceil(totalSqIn / Number(chosen.perSqIn)));
      cost = groups * Number(chosen.cost);
    }
    return { cost, label: chosen?.label || "—", freight: !!chosen?.freight, warnings };
  }

  if (rule.kind === "sheetBands") {
    // For perSqInch products that ship as sheets, derive sheets from total sq in.
    let sheets = sheetsNeeded;
    const sheetSqIn = Number(product.sheetSqIn || rule.sheetSqIn || 4608);
    if (sheets == null && totalSqIn) sheets = Math.max(1, Math.ceil(totalSqIn / sheetSqIn));
    if (!sheets) sheets = 1;
    const band = pickBand(rule, pieceW, pieceH);
    if (!band) return { cost: 199, label: "Freight (no matching band)", freight: true, warnings: ["No band match — freight"] };
    let chosen = null;
    for (const t of band.tiers || []) {
      const min = Number(t.minSheets) || 0;
      const max = t.maxSheets == null ? Infinity : Number(t.maxSheets);
      if (t.perSheets) { chosen = t; continue; }
      if (sheets >= min && sheets <= max) { chosen = t; break; }
    }
    // If no flat tier matched but we found a perSheets one earlier, use it for low counts.
    if (!chosen) {
      const perSheetTier = (band.tiers || []).find((tt) => tt.perSheets);
      const freightTier  = (band.tiers || []).find((tt) => tt.freight);
      if (freightTier && sheets >= Number(freightTier.minSheets || 0)) chosen = freightTier;
      else chosen = perSheetTier || (band.tiers || [])[(band.tiers || []).length - 1];
    }
    if (chosen?.freight) warnings.push(`${band.name}: ${chosen.label || "freight"}`);
    let cost = Number(chosen?.cost) || 0;
    if (chosen?.perSheets) {
      const groups = Math.max(1, Math.ceil(sheets / Number(chosen.perSheets)));
      cost = groups * Number(chosen.cost);
    }
    return { cost, label: `${band.name} · ${chosen?.label || ""}`.trim(), freight: !!chosen?.freight, warnings };
  }

  return { cost: 0, label: "(unknown rule kind)", warnings: [`Unknown shipping rule kind: ${rule.kind}`] };
}

// ── Pricing engine ───────────────────────────────────
function computePrice({ pricing, product, width, height, selectedSizeKey, quantity, options }) {
  if (!product || !quantity || quantity < 1) return null;

  const variantOpt   = (product.options || []).find((o) => o.type === "tierVariant");
  const variantValue = variantOpt ? options[variantOpt.key] : null;
  const sizes        = resolveSizes(pricing, product);

  // ── Size + dimension snapshot ──
  let dim = null, pieceW = 0, pieceH = 0, pieceSqFt = 0, pieceSqIn = 0, piecesPerSheet = 1;
  if (product.sizeMode === "preset") {
    const s = sizes.find((x) => x.key === selectedSizeKey);
    if (!s) return null;
    pieceW = Number(s.width)  || 0;
    pieceH = Number(s.height) || 0;
    pieceSqFt = (pieceW * pieceH) / 144;
    pieceSqIn = pieceW * pieceH;
    piecesPerSheet = Number(s.piecesPerSheet) || 1;
    dim = { kind: "preset", sizeKey: s.key, sizeLabel: s.label, width: pieceW, height: pieceH, sqFt: pieceSqFt, sqIn: pieceSqIn, piecesPerSheet, baseCost: s.baseCost };
  } else if (product.sizeMode === "custom") {
    pieceW = Number(width)  || 0;
    pieceH = Number(height) || 0;
    if (pieceW <= 0 || pieceH <= 0) return null;
    pieceSqFt = (pieceW * pieceH) / 144;
    pieceSqIn = pieceW * pieceH;
    dim = { kind: "custom", width: pieceW, height: pieceH, sqFt: pieceSqFt, sqIn: pieceSqIn };
  } else if (product.sizeMode === "none") {
    dim = { kind: "none" };
  }

  // ── Tier lookup ──
  const totalSqFt    = pieceSqFt * quantity;
  const totalSqIn    = pieceSqIn * quantity;
  const sheetsNeeded = Math.max(1, Math.ceil(quantity / piecesPerSheet));
  const tierTable    = tierTableFor(product, options);
  let tierBreakValue = quantity;
  if (product.tierBreakBy === "totalSqFt") tierBreakValue = totalSqFt;
  else if (product.tierBreakBy === "sheets") tierBreakValue = sheetsNeeded;
  const activeTier = findTier(tierTable, tierBreakValue);
  if (!activeTier) return null;

  // ── Per-piece base by pricing model ──
  // perPieceBase is for display + min-price comparison only.
  // basePrintCost is the authoritative pre-options total — for
  // perSheet products this is `tier.cost × sheetsNeeded`, NOT
  // `(tier.cost / piecesPerSheet) × quantity`, because the
  // customer always pays for whole sheets.
  let perPieceBase = 0;
  let basePrintCost = 0;
  if (product.pricingModel === "perSqFt") {
    perPieceBase  = pieceSqFt * Number(activeTier.cost);
    basePrintCost = perPieceBase * quantity;
  } else if (product.pricingModel === "perSheet") {
    perPieceBase  = (Number(activeTier.cost) || 0) / piecesPerSheet;
    basePrintCost = Number(activeTier.cost) * sheetsNeeded;
  } else if (product.pricingModel === "perSqInch") {
    perPieceBase  = pieceSqIn * Number(activeTier.cost);
    basePrintCost = perPieceBase * quantity;
  } else if (product.pricingModel === "perPiece") {
    if (dim?.baseCost != null) perPieceBase = Number(dim.baseCost);
    else                        perPieceBase = Number(activeTier.cost);
    basePrintCost = perPieceBase * quantity;
  }

  // ── Min-price floor (per-piece) ──
  // Applies to non-perSheet products. perSheet products charge
  // by-the-sheet so a per-piece floor would double-count.
  let minApplied = false;
  let minPrice = 0;
  if (typeof product.minPrice === "number") minPrice = product.minPrice;
  else if (isPlainObject(product.minPrice) && variantValue != null) minPrice = Number(product.minPrice[variantValue]) || 0;
  if (minPrice > 0 && perPieceBase < minPrice && product.pricingModel !== "perSheet") {
    minApplied = true;
    perPieceBase  = minPrice;
    basePrintCost = minPrice * quantity;
  }

  // ── Options ──
  let perPieceAddons    = 0;
  let perEachOrderTotal = 0;
  let setupFees         = 0;
  const percentMultipliers = [];
  const appliedOptions     = [];

  for (const opt of product.options || []) {
    if (opt.type === "tierVariant") continue;
    const v = options[opt.key];

    if (opt.type === "checkbox") {
      if (v) {
        if (typeof opt.cost === "number" && opt.cost) perPieceAddons += opt.cost;
        if (typeof opt.costMultiplier === "number" && opt.costMultiplier !== 1)
          percentMultipliers.push({ key: opt.key, label: opt.label, mult: opt.costMultiplier });
        appliedOptions.push({ key: opt.key, label: opt.label, value: "Yes" });
      }
    } else if (opt.type === "setupFee") {
      if (v) {
        setupFees += Number(opt.setupFee) || 0;
        appliedOptions.push({ key: opt.key, label: opt.label, value: `Yes (+${fmtMoney(opt.setupFee)} setup)` });
      }
    } else if (opt.type === "select") {
      const choice = (opt.choices || []).find((c) => c.value === v);
      if (choice) {
        if (typeof choice.cost === "number" && choice.cost) perPieceAddons += choice.cost;
        if (typeof choice.costPerSqFt === "number" && choice.costPerSqFt) perPieceAddons += pieceSqFt * choice.costPerSqFt;
        if (typeof choice.costPerLinearFt === "number" && choice.costPerLinearFt && pieceW) perPieceAddons += (pieceW / 12) * choice.costPerLinearFt;
        if (typeof choice.costMultiplier === "number" && choice.costMultiplier !== 1)
          percentMultipliers.push({ key: opt.key, label: opt.label, mult: choice.costMultiplier });
        appliedOptions.push({ key: opt.key, label: opt.label, value: choice.label });
      }
    } else if (opt.type === "perLinearFt") {
      if (v) {
        if (pieceW) perPieceAddons += (pieceW / 12) * (Number(opt.costPerLinearFt) || 0);
        if (opt.setupFee) setupFees += Number(opt.setupFee) || 0;
        appliedOptions.push({
          key: opt.key, label: opt.label,
          value: `Yes (${fmtMoney(opt.costPerLinearFt)}/lin ft${opt.setupFee ? ` + ${fmtMoney(opt.setupFee)} setup` : ""})`,
        });
      }
    } else if (opt.type === "perSqFtAddon") {
      if (v) {
        perPieceAddons += pieceSqFt * (Number(opt.costPerSqFt) || 0);
        appliedOptions.push({ key: opt.key, label: opt.label, value: `Yes (+${fmtMoney(opt.costPerSqFt)}/sq ft)` });
      }
    } else if (opt.type === "perEachAddon") {
      const count = Number(v) || 0;
      if (count > 0) {
        perEachOrderTotal += count * (Number(opt.costPerEach) || 0);
        if (opt.setupFee) setupFees += Number(opt.setupFee) || 0;
        appliedOptions.push({
          key: opt.key, label: opt.label,
          value: `${count} (${fmtMoney(opt.costPerEach)} ea${opt.setupFee ? ` + ${fmtMoney(opt.setupFee)} setup` : ""})`,
        });
      }
    } else if (opt.type === "percentMultiplier") {
      if (v) {
        percentMultipliers.push({ key: opt.key, label: opt.label, mult: Number(opt.multiplier) || 1 });
        appliedOptions.push({ key: opt.key, label: opt.label, value: `Yes (×${opt.multiplier})` });
      }
    }
  }

  // basePrintCost already covers the per-sheet / per-piece-base
  // multiplied across the order. Per-piece add-ons (lamination $/sqft,
  // pole pocket per banner, flat $ per piece) get multiplied by piece
  // quantity. perEach add-ons (stakes, grommets) and setup fees are
  // one-time. Percent multipliers (rush, contour) come last.
  const perPiece = perPieceAddons; // pre-multiply across pieces
  const addonsAcrossPieces = perPiece * quantity;
  let printCost = basePrintCost + addonsAcrossPieces + perEachOrderTotal + setupFees;
  for (const pm of percentMultipliers) printCost *= pm.mult;

  // ── Shipping ──
  const shipping = computeShipping({
    pricing, product, dim, quantity, sheetsNeeded, totalSqIn, totalSqFt, pieceW, pieceH,
  });

  // ── Markup tier (print only) ──
  const markupTier  = findMarkupTier(pricing.markup, printCost);
  const customerPrintPrice = printCost * (Number(markupTier.multiplier) || 1);
  const totalCost     = printCost + shipping.cost;
  const customerTotal = customerPrintPrice + shipping.cost;
  const margin        = customerPrintPrice - printCost;
  const marginPct     = customerPrintPrice > 0 ? (margin / customerPrintPrice) * 100 : 0;

  const warnings = [...(shipping.warnings || [])];
  if (minApplied) warnings.push(`Minimum price of ${fmtMoney(minPrice)} per piece applied`);

  return {
    printCost,
    shippingCost: shipping.cost,
    shippingLabel: shipping.label,
    shippingFreight: !!shipping.freight,
    setupFees,
    totalCost,
    customerPrintPrice,
    customerTotal,
    margin, marginPct,
    activeTier,
    activeMarkupTier: markupTier,
    appliedOptions,
    percentMultipliers,
    perPieceCost: perPieceBase + perPieceAddons,
    sheetsNeeded,
    totalSqFt, totalSqIn,
    dim,
    variantValue,
    warnings,
  };
}

// ── Component ────────────────────────────────────────
export default function SpecialtyTab({ CardHeader, PriceBar, PriceDelta, onSnapshotChange, currentEmployee, onCompleteSale }) {
  const [pricing, setPricing] = useState(loadPricing);

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

  const [customerName,  setCustomerName]  = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [staffInitials, setStaffInitials] = useState("");
  const [orderNotes,    setOrderNotes]    = useState("");
  const [generating,    setGenerating]    = useState(false);
  const [showPanelSplit, setShowPanelSplit] = useState(false);

  const cat = pricing.categories?.[selectedCategory];
  const product = cat?.products?.[selectedProduct];

  // Pending prefill ref. The TrainingDrawer (or any future caller)
  // dispatches a "specialtyApplyScenario" CustomEvent and we stash the
  // detail here. The category/product reset effects below consume the
  // ref instead of clearing, so a scenario's sizeKey / width / height /
  // options actually survive the cascade.
  const pendingPrefillRef = useRef(null);

  // Reset propagation when category changes — but if we have a pending
  // prefill targeting the new category, walk straight to the product.
  useEffect(() => {
    const pending = pendingPrefillRef.current;
    if (pending && pending.category === selectedCategory) {
      setSelectedProduct(pending.product || "");
      return;
    }
    setSelectedProduct("");
    setSelectedSizeKey("");
    setSelectedOptions({});
    setWidth(""); setHeight("");
  }, [selectedCategory]);

  // Same idea on product change: prefill takes precedence over the
  // default reset behaviour.
  useEffect(() => {
    const pending = pendingPrefillRef.current;
    if (pending && pending.product === selectedProduct) {
      pendingPrefillRef.current = null;
      setSelectedSizeKey(pending.sizeKey || "");
      setWidth(pending.width  != null ? String(pending.width)  : "");
      setHeight(pending.height != null ? String(pending.height) : "");
      if (pending.quantity != null) setQuantity(Math.max(1, Number(pending.quantity) || 1));
      setSelectedOptions({ ...defaultOptionsFor(product), ...(pending.options || {}) });
      return;
    }
    setSelectedSizeKey("");
    setWidth(""); setHeight("");
    setSelectedOptions(defaultOptionsFor(product));
  }, [selectedProduct, product]);

  // External-prefill listener (TrainingDrawer scenarios). Picks up
  // wherever in the cascade we are: different category → set
  // category and let the reset effects walk the rest; same category
  // / different product → skip straight to product; everything same
  // → apply size + options inline.
  useEffect(() => {
    const onApply = (e) => {
      const cfg = e?.detail;
      if (!cfg || typeof cfg !== "object") return;
      pendingPrefillRef.current = cfg;
      if (cfg.category && cfg.category !== selectedCategory) {
        setSelectedCategory(cfg.category);
      } else if (cfg.product && cfg.product !== selectedProduct) {
        setSelectedProduct(cfg.product);
      } else {
        // Same category AND product — apply directly, no cascade needed.
        pendingPrefillRef.current = null;
        if (cfg.sizeKey) setSelectedSizeKey(cfg.sizeKey);
        if (cfg.width  != null) setWidth(String(cfg.width));
        if (cfg.height != null) setHeight(String(cfg.height));
        if (cfg.quantity != null) setQuantity(Math.max(1, Number(cfg.quantity) || 1));
        if (product) setSelectedOptions((prev) => ({ ...prev, ...(cfg.options || {}) }));
      }
    };
    window.addEventListener("specialtyApplyScenario", onApply);
    return () => window.removeEventListener("specialtyApplyScenario", onApply);
  }, [selectedCategory, selectedProduct, product]);

  const variantOption = useMemo(
    () => (product?.options || []).find((o) => o.type === "tierVariant"),
    [product]
  );

  const result = useMemo(
    () => computePrice({ pricing, product, width, height, selectedSizeKey, quantity, options: selectedOptions }),
    [pricing, product, width, height, selectedSizeKey, quantity, selectedOptions]
  );

  // Display-only price deltas for toggle-like options: computePrice is pure,
  // so the exact customer-total impact of enabling an option — through every
  // tier/markup boundary — is just a second call with that option flipped on.
  // Enum (select/tierVariant) and quantity-like (perEachAddon) options are
  // skipped. Memoized with the same deps as `result` so typing dimensions
  // recomputes once per keystroke, not per option render.
  const TOGGLE_OPTION_TYPES = ["checkbox", "setupFee", "perLinearFt", "perSqFtAddon", "percentMultiplier"];
  const optionDeltas = useMemo(() => {
    if (!result || !product || !(quantity > 0)) return {};
    const out = {};
    for (const opt of product.options || []) {
      if (!TOGGLE_OPTION_TYPES.includes(opt.type)) continue;
      if (selectedOptions[opt.key]) continue; // unchecked options only
      const flipped = computePrice({
        pricing, product, width, height, selectedSizeKey, quantity,
        options: { ...selectedOptions, [opt.key]: true },
      });
      if (flipped) out[opt.key] = flipped.customerTotal - result.customerTotal;
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, pricing, product, width, height, selectedSizeKey, quantity, selectedOptions]);

  // Report a sale snapshot up to App so the shared Complete Sale pipeline
  // can log this order. Markup applies to the print cost only; shipping is a
  // separate non-upsell line that passes through at cost.
  useEffect(() => {
    if (typeof onSnapshotChange !== "function") return;
    if (!result || !(result.customerTotal > 0)) { onSnapshotChange(null); return; }
    const lineItems = [{
      kind: "specialty",
      productLabel: product?.label || selectedProduct,
      category: selectedCategory,
      dimensions: (result.dim?.width && result.dim?.height) ? `${result.dim.width}×${result.dim.height} in` : null,
      quantity,
      lineTotal: round2(result.customerPrintPrice),
      upsell: false,
    }];
    if (result.shippingCost > 0) {
      lineItems.push({ kind: "specialty_shipping", lineTotal: round2(result.shippingCost), upsell: false });
    }
    onSnapshotChange({
      serviceType: "specialty",
      total: round2(result.customerTotal),
      baseSubtotal: round2(result.customerTotal),
      upsellSubtotal: 0,
      lineItems,
    });
  }, [result, product, selectedProduct, selectedCategory, quantity, onSnapshotChange]);

  // Clear the reported snapshot when this tab unmounts.
  useEffect(() => () => {
    if (typeof onSnapshotChange === "function") onSnapshotChange(null);
  }, [onSnapshotChange]);

  const completeSaleEnabled = !!currentEmployee && !!result && result.customerTotal > 0;

  const sizes = useMemo(() => (product ? resolveSizes(pricing, product) : []), [pricing, product]);
  const showCustomDims = product?.sizeMode === "custom";

  // Soft cap: rigid sheet stock + magnets are 96×48 max at Signs365.
  // Pull dims from result.dim (works for both preset and custom modes).
  const sizeCap = useMemo(() => {
    if (!product || !isSizeCappedCategory(selectedCategory)) return null;
    const w = result?.dim?.width;
    const h = result?.dim?.height;
    if (!isOverSizeCap(w, h)) return null;
    return { w, h, split: computePanelSplit(w, h) };
  }, [product, selectedCategory, result]);

  // Auto-collapse the panel-split detail when warning state changes.
  useEffect(() => {
    if (!sizeCap) setShowPanelSplit(false);
  }, [sizeCap]);

  const handleReset = () => {
    setSelectedCategory("");
    setSelectedProduct("");
    setSelectedSizeKey("");
    setSelectedOptions({});
    setWidth(""); setHeight("");
    setQuantity(1);
    setCustomerName(""); setCustomerPhone(""); setCustomerEmail("");
    setOrderNotes("");
  };

  const handleGeneratePdf = async () => {
    if (generating || !result) return;
    setGenerating(true);
    try {
      const orderData = {
        category: cat ? { key: selectedCategory, label: cat.label } : null,
        product:  product ? { key: selectedProduct, label: product.label, pricingModel: product.pricingModel } : null,
        dimensions: result.dim,
        quantity,
        quantityUnit: product?.quantityUnit || "pieces",
        sheetsNeeded: result.sheetsNeeded,
        options:    selectedOptions,
        optionMeta: (product?.options || []).reduce((acc, opt) => { acc[opt.key] = opt; return acc; }, {}),
        appliedOptions: result.appliedOptions,
        pricing: result,
        customer:      { name: customerName.trim(), phone: customerPhone.trim(), email: customerEmail.trim() },
        staffInitials: staffInitials.trim(),
        notes:         orderNotes.trim(),
      };
      await generateTradeOrderPDF(orderData);
    } catch (e) {
      console.error("trade order PDF failed:", e);
      alert("Couldn't generate the trade order PDF: " + (e?.message || String(e)));
    } finally {
      setGenerating(false);
    }
  };

  const canGenerate = !!result && !generating;

  // ── Render ──
  return (
    <>
      <div className="pc-card" data-tour="specialty-setup-card">
        <CardHeader
          step="1"
          stepClass="step-num-purple"
          title="Specialty / Trade Print (Signs365)"
          hint="Pick a category, then a product"
        />
        <div className="pc-card-body">
          <div className="grid-2" style={{ marginBottom: 16 }}>
            <div data-tour="specialty-category">
              <label className="field-label">Category</label>
              <div className="pc-select-wrap">
                <select className="pc-select" value={selectedCategory} onChange={(e) => setSelectedCategory(e.target.value)}>
                  <option value="">— Choose a category —</option>
                  {Object.entries(pricing.categories || {}).map(([key, c]) => (
                    <option key={key} value={key}>{c.label}</option>
                  ))}
                </select>
              </div>
              {cat?.description && <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>{cat.description}</div>}
            </div>
            <div data-tour="specialty-product">
              <label className="field-label">Product</label>
              <div className="pc-select-wrap">
                <select className="pc-select" value={selectedProduct} onChange={(e) => setSelectedProduct(e.target.value)} disabled={!cat}>
                  <option value="">{cat ? "— Choose a product —" : "(pick category first)"}</option>
                  {cat && Object.entries(cat.products || {}).map(([key, p]) => (
                    <option key={key} value={key}>{p.label}</option>
                  ))}
                </select>
              </div>
              {product && (
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
                  {product.pricingModel === "perSqFt"   && "Priced per sq ft"}
                  {product.pricingModel === "perSheet"  && (product.quantityUnit === "sets" ? "Priced per set" : "Priced per printer sheet")}
                  {product.pricingModel === "perSqInch" && `Priced per sq in${product.minPrice ? ` (min ${fmtMoney(typeof product.minPrice === "number" ? product.minPrice : Object.values(product.minPrice)[0])})` : ""}`}
                  {product.pricingModel === "perPiece"  && "Flat per piece"}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {product && (
        <div className="pc-card">
          <CardHeader
            step="2"
            stepClass="step-num-purple"
            title="Size, sides & quantity"
            hint={product.sizeMode === "preset" ? "Pick from Signs365's stock sizes" : "Custom dimensions in inches"}
          />
          <div className="pc-card-body">
            {variantOption && (
              <div style={{ marginBottom: 14 }}>
                <label className="field-label">{variantOption.label}</label>
                <div className="chip-group">
                  {variantOption.choices.map((c) => (
                    <button
                      key={c.value}
                      type="button"
                      className={`pc-chip pc-chip-purple ${selectedOptions[variantOption.key] === c.value ? "selected" : ""}`}
                      onClick={() => setSelectedOptions((prev) => ({ ...prev, [variantOption.key]: c.value }))}
                    >{c.label}</button>
                  ))}
                </div>
              </div>
            )}

            {product.sizeMode === "preset" && (
              <div className="grid-2" style={{ marginBottom: 12 }}>
                <div data-tour="specialty-size-preset">
                  <label className="field-label">Size</label>
                  <div className="pc-select-wrap">
                    <select className="pc-select" value={selectedSizeKey} onChange={(e) => setSelectedSizeKey(e.target.value)}>
                      <option value="">— Choose a size —</option>
                      {sizes.map((s) => (
                        <option key={s.key} value={s.key}>
                          {s.label}{s.piecesPerSheet ? ` (${s.piecesPerSheet}/sheet)` : ""}{s.baseCost != null ? ` — ${fmtMoney(s.baseCost)}` : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div data-tour="specialty-quantity">
                  <label className="field-label">{product.quantityUnit === "sets" ? "Sets" : product.pricingModel === "perSheet" ? "Pieces" : "Quantity"}</label>
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

            {showCustomDims && (
              <div className="grid-3" style={{ marginBottom: 12 }}>
                <div data-tour="specialty-width">
                  <label className="field-label">Width (in)</label>
                  <input className="pc-input" type="number" inputMode="decimal" min="1" step="0.5" value={width} onChange={(e) => setWidth(e.target.value)} />
                </div>
                <div data-tour="specialty-height">
                  <label className="field-label">Height (in)</label>
                  <input className="pc-input" type="number" inputMode="decimal" min="1" step="0.5" value={height} onChange={(e) => setHeight(e.target.value)} />
                </div>
                <div data-tour="specialty-quantity">
                  <label className="field-label">Quantity</label>
                  <input className="pc-input" type="number" inputMode="numeric" min="1" step="1" value={quantity} onChange={(e) => setQuantity(Math.max(1, Number(e.target.value) || 1))} />
                </div>
              </div>
            )}

            {product.sizeMode === "none" && (
              <div className="grid-2" style={{ marginBottom: 12 }}>
                <div data-tour="specialty-quantity">
                  <label className="field-label">Quantity</label>
                  <input className="pc-input" type="number" inputMode="numeric" min="1" step="1" value={quantity} onChange={(e) => setQuantity(Math.max(1, Number(e.target.value) || 1))} />
                </div>
              </div>
            )}

            {sizeCap && (
              <div data-tour="specialty-size-warning" className="callout callout-warn specialty-size-warning" style={{ marginTop: 14 }}>
                <span className="callout-icon">⚠</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>
                    Size exceeds Signs365 maximum
                  </div>
                  <div style={{ fontSize: 12, lineHeight: 1.5 }}>
                    Signs365 prints rigid signs and magnets up to <strong>96″ × 48″</strong> max.
                    Your design is <strong>{sizeCap.w}″ × {sizeCap.h}″</strong>.
                    {sizeCap.split && (
                      <> We suggest splitting into <strong>{sizeCap.split.totalPanels} panels</strong> of approximately <strong>{sizeCap.split.panelW}″ × {sizeCap.split.panelH}″</strong> each.</>
                    )}
                  </div>
                  {sizeCap.split?.extreme && (
                    <div style={{ fontSize: 12, marginTop: 6, color: "var(--text-muted)" }}>
                      This is a large multi-panel job — consider whether the customer would prefer a fabric or vinyl banner (no rigid-sheet limit).
                    </div>
                  )}
                  {sizeCap.split && (
                    <button
                      type="button"
                      data-tour="specialty-panel-split-button"
                      className="pc-btn pc-btn-secondary pc-btn-xs"
                      style={{ marginTop: 8 }}
                      onClick={() => setShowPanelSplit((v) => !v)}
                    >
                      {showPanelSplit ? "Hide panel split" : "Show panel split"}
                    </button>
                  )}
                  {showPanelSplit && sizeCap.split && (
                    <div data-tour="specialty-panel-split-result" className="specialty-panel-split">
                      <div className="specialty-panel-split-header">Suggested layout</div>
                      <div className="specialty-panel-split-grid">
                        <div><span style={{ color: "var(--text-muted)" }}>Panels across:</span> <strong>{sizeCap.split.panelsW}</strong></div>
                        <div><span style={{ color: "var(--text-muted)" }}>Panels down:</span> <strong>{sizeCap.split.panelsH}</strong></div>
                        <div><span style={{ color: "var(--text-muted)" }}>Total panels:</span> <strong>{sizeCap.split.totalPanels}</strong></div>
                        <div><span style={{ color: "var(--text-muted)" }}>Each panel:</span> <strong>{sizeCap.split.panelW}″ × {sizeCap.split.panelH}″</strong></div>
                      </div>
                      <div className="specialty-panel-split-note">
                        Quote each panel as its own line item against the {sizeCap.split.panelW}″ × {sizeCap.split.panelH}″ piece size.
                        Most customers don't notice the seam from a few feet away — confirm placement with the customer before ordering.
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {result?.dim && (result.dim.kind === "preset" || result.dim.kind === "custom") && (
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
                {result.dim.width}" × {result.dim.height}" · {result.dim.sqFt.toFixed(2)} sq ft per piece · total {result.totalSqFt.toFixed(2)} sq ft
                {product.pricingModel === "perSheet" && ` · ${result.sheetsNeeded} sheet${result.sheetsNeeded === 1 ? "" : "s"} needed`}
              </div>
            )}
            {result?.activeTier && (
              <div className="specialty-tier-hint" style={{ marginTop: 6 }}>
                Active tier: <strong>{result.activeTier.label}</strong> ({fmtMoney(result.activeTier.cost)}{product.pricingModel === "perSqFt" ? "/sq ft" : product.pricingModel === "perSheet" ? "/sheet" : product.pricingModel === "perSqInch" ? "/sq in" : "/piece"})
              </div>
            )}
          </div>
        </div>
      )}

      {product && (product.options || []).filter((o) => o.type !== "tierVariant").length > 0 && (
        <div className="pc-card">
          <CardHeader
            step="3"
            stepClass="step-num-purple"
            title="Options"
            hint="Per-product upgrades and add-ons"
          />
          <div className="pc-card-body specialty-options">
            {(product.options || []).filter((o) => o.type !== "tierVariant").map((opt) => (
              <SpecialtyOption
                key={opt.key}
                opt={opt}
                value={selectedOptions[opt.key]}
                onChange={(v) => setSelectedOptions((prev) => ({ ...prev, [opt.key]: v }))}
                delta={PriceDelta && optionDeltas[opt.key] != null
                  ? <PriceDelta value={optionDeltas[opt.key]} />
                  : null}
              />
            ))}
          </div>
        </div>
      )}

      {product && (
        <div className="pc-card">
          <CardHeader
            step="4"
            stepClass="step-num-purple"
            title="Customer & order info"
            hint="Optional — printed on the trade-order PDF"
          />
          <div className="pc-card-body">
            <div className="grid-3" style={{ marginBottom: 12 }}>
              <div>
                <label className="field-label">Customer name</label>
                <input className="pc-input" type="text" value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Walk-in OK" />
              </div>
              <div>
                <label className="field-label">Phone</label>
                <input className="pc-input" type="tel" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} />
              </div>
              <div>
                <label className="field-label">Email</label>
                <input className="pc-input" type="email" value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} />
              </div>
            </div>
            <div className="grid-2" style={{ marginBottom: 12 }}>
              <div>
                <label className="field-label">Staff initials</label>
                <input className="pc-input" type="text" maxLength={6} value={staffInitials} onChange={(e) => setStaffInitials(e.target.value)} placeholder="e.g. JL" style={{ textTransform: "uppercase" }} />
              </div>
              <div>
                <label className="field-label">Order notes (optional)</label>
                <input className="pc-input" type="text" value={orderNotes} onChange={(e) => setOrderNotes(e.target.value)} placeholder="anything to flag for Signs365" />
              </div>
            </div>
          </div>
        </div>
      )}

      {result?.warnings?.length > 0 && (
        <div className="callout callout-warn" style={{ marginBottom: 14 }}>
          <span className="callout-icon">⚠</span>
          {result.warnings.map((w, i) => (
            <div key={i} style={{ fontSize: 12 }}>{w}</div>
          ))}
        </div>
      )}

      {/* Reset has no PriceBar equivalent — lives in the tab body above the bar. */}
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
        <button type="button" className="pc-btn pc-btn-ghost pc-btn-sm" onClick={handleReset}>Reset</button>
      </div>

      <PriceBar
        dataTour="specialty-price-bar"
        completeSaleTour="specialty-complete-sale"
        accentClass="price-bar-purple"
        totalClass="is-total-purple"
        metrics={[
          { label:"Customer total",         value: result ? fmtMoney(result.customerTotal) : "—", big:true },
          { label:"Print (after markup)",   value: result ? fmtMoney(result.customerPrintPrice) : "—" },
          { label:"Shipping (passthrough)", value: result ? fmtMoney(result.shippingCost) : "—" },
          { label:"Margin",                 value: result ? `${fmtMoney(result.margin)} (${result.marginPct.toFixed(1)}%)` : "—" },
        ]}
        onDownload={handleGeneratePdf}
        downloadLabel={generating ? "Generating…" : "⬇ Trade Order PDF"}
        downloadDisabled={!canGenerate}
        onCompleteSale={onCompleteSale}
        completeSaleEnabled={completeSaleEnabled}
        completeSaleHint={completeSaleEnabled ? "Log this as a completed sale" : "Sign in with your PIN first"}
      />
    </>
  );
}

// ── Single option renderer ────────────────────────────
function SpecialtyOption({ opt, value, onChange, delta = null }) {
  if (opt.type === "checkbox" || opt.type === "setupFee" || opt.type === "perLinearFt" || opt.type === "perSqFtAddon" || opt.type === "percentMultiplier") {
    const tag =
      opt.type === "setupFee"          ? `+${fmtMoney(opt.setupFee)} setup` :
      opt.type === "perLinearFt"       ? `${fmtMoney(opt.costPerLinearFt)}/lin ft${opt.setupFee ? ` + ${fmtMoney(opt.setupFee)} setup` : ""}` :
      opt.type === "perSqFtAddon"      ? `+${fmtMoney(opt.costPerSqFt)}/sq ft` :
      opt.type === "percentMultiplier" ? `×${opt.multiplier}` :
      opt.cost ? `+${fmtMoney(opt.cost)}` : "free";
    return (
      <label className="specialty-opt specialty-opt-row">
        <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />
        <span className="specialty-opt-label">{opt.label}</span>
        {tag !== "free" && <span className="specialty-opt-cost">{tag}</span>}
        {delta}
      </label>
    );
  }

  if (opt.type === "select") {
    return (
      <div className="specialty-opt">
        <label className="field-label">{opt.label}</label>
        <div className="pc-select-wrap">
          <select className="pc-select" value={value || ""} onChange={(e) => onChange(e.target.value)}>
            {(opt.choices || []).map((c) => {
              const tag =
                c.cost          ? ` (+${fmtMoney(c.cost)})` :
                c.costPerSqFt   ? ` (+${fmtMoney(c.costPerSqFt)}/sq ft)` :
                c.costPerLinearFt ? ` (+${fmtMoney(c.costPerLinearFt)}/lin ft)` :
                c.costMultiplier && c.costMultiplier !== 1 ? ` (×${c.costMultiplier})` : "";
              return <option key={c.value} value={c.value}>{c.label}{tag}</option>;
            })}
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
        <span className="specialty-opt-cost">
          {fmtMoney(opt.costPerEach)} ea{opt.setupFee ? ` + ${fmtMoney(opt.setupFee)} setup` : ""}
        </span>
      </div>
    );
  }

  return null;
}
