// ============================================================
//  STORE CONFIG — pure reconstruction (no imports, no side effects)
//
//  Given the raw rows from the six Phase A config tables, rebuild the
//  exact `pricing.json`-shaped object + a storeProfile. This is the
//  inverse of the seed migration. Kept import-free so it can be
//  unit-tested in plain Node without pulling in the Supabase client
//  or Vite's import.meta.env.
// ============================================================

export const asNum = (v) => (typeof v === "number" ? v : Number(v));
const isNum = (v) => typeof v === "number" && Number.isFinite(v);

export function assembleConfig({ store, paperTypes = [], sheetPrices = [], discounts = [], addons = [], settings = [] }) {
  const sheetPapers = paperTypes.filter((r) => r.kind === "sheet");
  const lfPapers    = paperTypes.filter((r) => r.kind === "large_format");

  const paperTypesOut = sheetPapers.map((r) => ({ key: r.key, label: r.label }));
  const lfPaperTypes  = lfPapers.map((r) => ({ key: r.key, label: r.label }));

  const sheetKeysForPaper = {};
  const sheetMarkupPerPaper = {};
  sheetPapers.forEach((r) => {
    sheetKeysForPaper[r.key] = Array.isArray(r.sheet_keys) ? r.sheet_keys : [];
    if (r.markup_percent != null) sheetMarkupPerPaper[r.key] = asNum(r.markup_percent);
  });

  const lfMarkupPerPaper = {};
  lfPapers.forEach((r) => {
    if (r.markup_percent != null) lfMarkupPerPaper[r.key] = asNum(r.markup_percent);
  });

  const paperById = {};
  paperTypes.forEach((r) => { paperById[r.id] = r; });

  const sheetPricing = {};
  const lfPricing = {};
  const skuMap = {};
  sheetPrices.forEach((row) => {
    const paper = paperById[row.paper_type_id];
    if (!paper) return;
    const entry = {
      baseCostColor: asNum(row.base_cost_color),
      baseCostBW:    asNum(row.base_cost_bw),
      priceColor:    asNum(row.price_color),
      priceBW:       asNum(row.price_bw),
    };
    if (paper.kind === "sheet") {
      if (!sheetPricing[paper.key]) sheetPricing[paper.key] = {};
      sheetPricing[paper.key][row.sheet_key] = entry;
      if (row.sku) skuMap[`${paper.key}:${row.sheet_key}`] = String(row.sku);
    } else {
      lfPricing[paper.key] = entry;
    }
  });

  const sheetQtyDiscounts = discounts
    .filter((d) => d.kind === "sheet")
    .sort((a, b) => a.min_qty - b.min_qty)
    .map((d) => ({ minSheets: d.min_qty, discountPercent: asNum(d.discount_percent) }));
  // LF discounts are keyed on square footage in the app (minSqFt), unlike
  // sheet discounts (minSheets). The `discounts.min_qty` column carries the
  // threshold generically; map it back to the field the LF calc reads.
  const lfQtyDiscounts = discounts
    .filter((d) => d.kind === "large_format")
    .sort((a, b) => a.min_qty - b.min_qty)
    .map((d) => ({ minSqFt: d.min_qty, discountPercent: asNum(d.discount_percent) }));

  // addons → lfAddonPricing map (key -> price), preserving every key
  const lfAddonPricing = {};
  addons.forEach((a) => { lfAddonPricing[a.key] = asNum(a.price); });

  const settingsMap = {};
  settings.forEach((s) => { settingsMap[s.key] = s.value; });

  const pricing = {
    paperTypes: paperTypesOut,
    lfPaperTypes,
    sheetKeysForPaper,
    sheetPricing,
    lfPricing,
    skuMap,
    sheetQtyDiscounts,
    lfQtyDiscounts,
    sheetMarkupPerPaper,
    lfMarkupPerPaper,
    lfAddonPricing,
  };
  if (isNum(settingsMap.back_side_factor)) pricing.backSideFactor = settingsMap.back_side_factor;
  if (isNum(settingsMap.preview_margin))   pricing.previewMargin  = settingsMap.preview_margin;
  if (isNum(settingsMap.preview_spacing))  pricing.previewSpacing = settingsMap.preview_spacing;
  if (settingsMap.blueprint_pricing && typeof settingsMap.blueprint_pricing === "object")
    pricing.blueprintPricing = settingsMap.blueprint_pricing;

  const storeProfile = store && {
    id:       store.id,
    slug:     store.slug,
    name:     store.name,
    address:  store.address,
    phone:    store.phone,
    email:    store.email,
    logo:     store.logo_url,
    colors:   store.colors || {},
    timezone: store.timezone,
  };

  return { pricing, storeProfile };
}
