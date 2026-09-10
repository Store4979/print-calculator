// ============================================================
//  COST & MARGIN ENGINE — Phase E
//  Pure functions, no React, no Supabase, no DOM. Everything the app
//  knows about cost, margin, margin health, pricing modes and the
//  cost-increase model lives here so it can be unit-tested in plain
//  Node (scripts/tests) and so every surface derives the same numbers.
//
//  Vocabulary
//    paperCost   media cost per sheet (per sq ft for large format)
//    clickColor  color click charge per printed side
//    clickBW     B&W click charge per printed side
//    baseCostColor = paperCost + clickColor     (the fields the price
//    baseCostBW    = paperCost + clickBW         book has always carried)
//
//  Visibility
//    Margin is staff-only. Two independent gates, neither reads label
//    text: (1) call sites include margin metrics only when
//    canSeeMarginFor() is true, which is false whenever kiosk mode is
//    on; (2) every margin metric carries staffOnly:true and
//    visibleMetrics() strips those on any kiosk surface.
// ============================================================

export const DEFAULT_THRESHOLDS = Object.freeze({ healthy: 75, thin: 50 });
export const DEFAULT_LABOR      = Object.freeze({ enabled: false, setupPerJob: 0, perUnit: 0 });
export const PRICING_MODES      = Object.freeze(["cost_up", "market_down"]);
export const HEALTH_LABELS      = Object.freeze({ healthy: "Healthy", thin: "Thin", underwater: "Underwater" });

// Keys margin math adds to a snapshot line item. They must never collide
// with the keys customer-facing code falls back to when describing a line
// (kioskQuoteSummary reads description/label/name) — tested.
export const MARGIN_LINE_KEYS      = Object.freeze(["lineCost", "lineMarginPct", "laborUnits"]);
export const CUSTOMER_FALLBACK_KEYS = Object.freeze(["description", "label", "name"]);

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const isNumLike = (v) => v !== null && v !== undefined && v !== "" && Number.isFinite(Number(v));
export const r4 = (n) => Math.round(num(n) * 10000) / 10000;
export const r2 = (n) => Math.round(num(n) * 100) / 100;

// ── Visibility ─────────────────────────────────────────────
export const isAdminRole = (role) => role === "owner" || role === "manager";

// The single source of truth for "may this person see margin".
// kioskMode wins over everything: a manager's PIN on the kiosk sees nothing.
export const canSeeMarginFor = ({ kioskMode = false, employeeRole = null, authRole = null } = {}) =>
  !kioskMode && (employeeRole === "manager" || isAdminRole(authRole));

// "Material margin" until labor is part of cost — 87.5% on paper is not profit.
export const marginLabelFor = (laborEnabled) => (laborEnabled ? "Margin" : "Material margin");

// Gate 2: strip staff-only metrics on a kiosk surface. Flag-based, never
// label-based.
export const visibleMetrics = (metrics = [], { kiosk = false } = {}) =>
  kiosk ? metrics.filter((m) => !(m && m.staffOnly)) : metrics.slice();

// ── Cost decomposition ─────────────────────────────────────
// A price-book entry may carry an explicit split (paperCost/clickColor/
// clickBW). When it does not, use the lossless default the E-02 backfill
// used: paper = base B&W cost, B&W click 0, color click = the premium.
export const decomposeEntry = (e = {}) => {
  const bcC = num(e.baseCostColor), bcB = num(e.baseCostBW);
  if (isNumLike(e.paperCost)) {
    return { paperCost: r4(e.paperCost), clickColor: r4(e.clickColor), clickBW: r4(e.clickBW), explicit: true };
  }
  return { paperCost: r4(bcB), clickColor: r4(bcC - bcB), clickBW: 0, explicit: false };
};

export const deriveBaseCosts = ({ paperCost, clickColor, clickBW }) => ({
  baseCostColor: r4(num(paperCost) + num(clickColor)),
  baseCostBW:    r4(num(paperCost) + num(clickBW)),
});

// Entry with an updated split and its derived base costs kept in sync.
export const withSplit = (entry = {}, patch = {}) => {
  const split = { ...decomposeEntry(entry), ...patch };
  const { paperCost, clickColor, clickBW } = split;
  return { ...entry, paperCost: r4(paperCost), clickColor: r4(clickColor), clickBW: r4(clickBW), ...deriveBaseCosts(split) };
};

// Per-sheet material cost for a sheet job.
export const sheetCostPerSheet = (entry, { frontColorMode = "color", showBack = false, backColorMode = "color" } = {}) => {
  const d = decomposeEntry(entry);
  const click = (mode) => (mode === "color" ? d.clickColor : d.clickBW);
  return r4(d.paperCost + click(frontColorMode) + (showBack ? click(backColorMode) : 0));
};

// Large format: media cost per sq ft. No click charge.
export const lfCostPerSqFt = (entry = {}) =>
  r4(isNumLike(entry.paperCost) ? entry.paperCost : entry.baseCostColor);

// True when a sheet entry's B&W click is unset (0) — every B&W side is then
// costed as paper only and duplex B&W cost is understated.
export const bwClickUnset = (entry = {}) => decomposeEntry(entry).clickBW === 0;

// ── Margin ─────────────────────────────────────────────────
export const computeMargin = ({ price, cost }) => {
  const p = num(price), c = num(cost);
  return {
    price: r2(p),
    cost: r2(c),
    marginAmt: r2(p - c),
    marginPct: p > 0 ? Math.round(((p - c) / p) * 10000) / 100 : null,
  };
};

export const marginHealth = (pct, t = DEFAULT_THRESHOLDS) => {
  if (pct === null || pct === undefined || !Number.isFinite(Number(pct))) return null;
  if (pct >= num(t.healthy)) return "healthy";
  if (pct >= num(t.thin))    return "thin";
  return "underwater";
};

export const fmtMarginValue = ({ marginAmt, marginPct }) =>
  marginPct === null || marginPct === undefined ? "—" : `$${num(marginAmt).toFixed(2)} (${num(marginPct).toFixed(1)}%)`;

// A PriceBar metric. staffOnly is what gate 2 keys on.
export const marginMetric = ({ label, price, cost, thresholds = DEFAULT_THRESHOLDS }) => {
  const m = computeMargin({ price, cost });
  return { label, value: fmtMarginValue(m), staffOnly: true, health: marginHealth(m.marginPct, thresholds), marginPct: m.marginPct };
};

// ── Labor (per store, default OFF) ─────────────────────────
export const laborFor = (labor = DEFAULT_LABOR, units = 0) => {
  if (!labor || !labor.enabled) return 0;
  return r2(num(labor.setupPerJob) + num(labor.perUnit) * num(units));
};

// Total cost of a quote: material + labor (labor only when enabled).
export const quoteCost = ({ material, labor = DEFAULT_LABOR, units = 0 }) => r2(num(material) + laborFor(labor, units));

// ── Snapshot ───────────────────────────────────────────────
// Lines carry lineCost (material) and laborUnits. Labor is added once per
// order. Returns costSubtotal/marginPct = null when any line lacks cost, so
// history and unknown-cost tabs stamp NULL rather than a misleading zero.
export const finalizeSnapshotMargin = (snapshot, { labor = DEFAULT_LABOR } = {}) => {
  if (!snapshot) return snapshot;
  const lines = snapshot.lineItems || [];
  const haveCost = lines.length > 0 && lines.every((li) => isNumLike(li.lineCost));
  if (!haveCost) return { ...snapshot, costSubtotal: null, marginPct: null };
  const units    = lines.reduce((s, li) => s + num(li.laborUnits), 0);
  const material = lines.reduce((s, li) => s + num(li.lineCost), 0);
  const costSubtotal = quoteCost({ material, labor, units });
  const { marginPct } = computeMargin({ price: snapshot.total, cost: costSubtotal });
  const lineItems = lines.map((li) => ({
    ...li,
    lineMarginPct: computeMargin({ price: li.lineTotal, cost: li.lineCost }).marginPct,
  }));
  return { ...snapshot, lineItems, costSubtotal, marginPct };
};

// ── Pricing modes ──────────────────────────────────────────
export const solveMarkupFromPrice = (price, cost) =>
  num(cost) > 0 ? Math.round((num(price) / num(cost) - 1) * 10000) / 100 : null;

export const priceFromMarkup = (cost, markup) => r4(num(cost) * (1 + num(markup) / 100));

// Cells whose price would change if this paper switched to cost-up with
// `markup`. Empty when the cost-up identity already holds (the normal case).
export const costUpDeltas = ({ sizes = {}, markup = 0 }) => {
  const out = [];
  Object.entries(sizes).forEach(([sizeKey, entry]) => {
    const e = entry || {};
    [["color", "baseCostColor", "priceColor"], ["bw", "baseCostBW", "priceBW"]].forEach(([mode, costKey, priceKey]) => {
      const from = r4(e[priceKey]);
      const to   = priceFromMarkup(e[costKey], markup);
      if (Math.abs(from - to) > 0.00005) out.push({ sizeKey, colorMode: mode, from, to, delta: r4(to - from) });
    });
  });
  return out;
};

// Re-derive every price of a paper from its costs and markup (cost-up).
export const repriceFromMarkup = (sizes = {}, markup = 0) => {
  const out = {};
  Object.entries(sizes).forEach(([sk, entry]) => {
    const e = entry || {};
    out[sk] = { ...e, priceColor: priceFromMarkup(e.baseCostColor, markup), priceBW: priceFromMarkup(e.baseCostBW, markup) };
  });
  return out;
};

// ── Cost-increase modeling (F6) ────────────────────────────
// "Paper went up X%": raise paperCost on the selected papers, keep clicks.
// cost_up papers hold their markup (price rises, margin held);
// market_down papers hold their price (margin absorbs it).
const cellRow = ({ kind, paper, sizeKey, colorMode, mode, oldEntry, newEntry, markup }) => {
  const costKey = colorMode === "color" ? "baseCostColor" : "baseCostBW";
  const priceKey = colorMode === "color" ? "priceColor" : "priceBW";
  const oldCost = r4(oldEntry[costKey]), newCost = r4(newEntry[costKey]);
  const oldPrice = r4(oldEntry[priceKey]);
  const newPrice = mode === "cost_up" ? priceFromMarkup(newCost, markup) : oldPrice;
  return {
    kind, paper, sizeKey, colorMode, mode, oldCost, newCost, oldPrice, newPrice,
    oldMarginPct: computeMargin({ price: oldPrice, cost: oldCost }).marginPct,
    newMarginPct: computeMargin({ price: newPrice, cost: newCost }).marginPct,
  };
};

export const previewCostIncrease = ({
  sheetPricing = {}, lfPricing = {}, markups = {}, lfMarkups = {},
  modes = {}, lfModes = {}, percent = 0, paperKeys = [], lfPaperKeys = [],
}) => {
  const f = 1 + num(percent) / 100;
  const rows = [];
  const nextSheet = {};
  const nextLf = {};
  paperKeys.forEach((pk) => {
    const sizes = sheetPricing[pk] || {};
    nextSheet[pk] = {};
    const mode = modes[pk] === "market_down" ? "market_down" : "cost_up";
    Object.entries(sizes).forEach(([sk, entry]) => {
      const d = decomposeEntry(entry);
      const bumped = withSplit(entry, { paperCost: r4(d.paperCost * f) });
      const priced = mode === "cost_up"
        ? { ...bumped, priceColor: priceFromMarkup(bumped.baseCostColor, markups[pk]), priceBW: priceFromMarkup(bumped.baseCostBW, markups[pk]) }
        : bumped;
      nextSheet[pk][sk] = priced;
      ["color", "bw"].forEach((cm) => {
        if (cm === "bw" && !(num(entry?.priceBW) > 0)) return;
        rows.push(cellRow({ kind: "sheet", paper: pk, sizeKey: sk, colorMode: cm, mode, oldEntry: entry || {}, newEntry: priced, markup: markups[pk] }));
      });
    });
  });
  lfPaperKeys.forEach((pk) => {
    const entry = lfPricing[pk] || {};
    const mode = lfModes[pk] === "market_down" ? "market_down" : "cost_up";
    const oldCost = lfCostPerSqFt(entry);
    const newCost = r4(oldCost * f);
    const bumped = { ...entry, paperCost: newCost, clickColor: 0, clickBW: 0, baseCostColor: newCost, baseCostBW: 0 };
    const priced = mode === "cost_up" ? { ...bumped, priceColor: priceFromMarkup(newCost, lfMarkups[pk]) } : bumped;
    nextLf[pk] = priced;
    rows.push(cellRow({ kind: "lf", paper: pk, sizeKey: null, colorMode: "color", mode, oldEntry: { ...entry, baseCostColor: oldCost }, newEntry: priced, markup: lfMarkups[pk] }));
  });
  return { rows, apply: { sheetPricing: nextSheet, lfPricing: nextLf } };
};
