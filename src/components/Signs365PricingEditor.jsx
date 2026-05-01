// ============================================================
//  SIGNS365 PRICING EDITOR (admin) — v2 schema
//
//  Edits a partial overrides tree on top of the v2 JSON. Storage
//  matches SpecialtyTab: localStorage.signs365Pricing, plus the
//  "signs365PricingUpdated" event so the open Specialty tab
//  refreshes in the same browser tab.
//
//  Editable surfaces:
//    • Markup tier multipliers + max-cost cutoffs
//    • Per-product tier costs (handles single-list and sided
//      {single,double} tier tables)
//    • Per-product min prices (number or per-variant map)
//    • Per-product option costs: flat $, multipliers,
//      $/sq ft, $/lin ft, $/each, setup fees
//    • Shipping rule costs (every kind: totalSqFt, perItem,
//      perSqIn, perSheet, sheetBands)
//
//  Adding / removing tiers, products, or sizes isn't supported
//  here — that requires editing src/data/signs365Pricing.json.
//  Any cleared input reverts to the JSON default via deepMerge.
// ============================================================

import { Fragment } from "react";
import signs365Defaults from "../data/signs365Pricing.json";

// ── Path helpers ─────────────────────────────────────
const isPlainObject = (v) => v && typeof v === "object" && !Array.isArray(v);
const getAtPath = (obj, path) => path.reduce((acc, k) => (acc == null ? acc : acc[k]), obj);
const setAtPath = (obj, path, value) => {
  if (path.length === 0) return value;
  const [head, ...rest] = path;
  if (Array.isArray(obj)) {
    const next = obj.slice();
    next[head] = setAtPath(obj[head], rest, value);
    return next;
  }
  return { ...(obj || {}), [head]: setAtPath((obj || {})[head], rest, value) };
};
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

// ── Component ────────────────────────────────────────
export default function Signs365PricingEditor({ overrides, setOverrides }) {
  // Drop legacy v1 overrides quietly so the editor doesn't render
  // garbage from a previous schema. SpecialtyTab does the same.
  const cleanOverrides =
    overrides && String(overrides._version || "").startsWith("2") ? overrides
    : overrides && Object.keys(overrides).length === 0 ? overrides
    : {};

  const merged = deepMerge(signs365Defaults, cleanOverrides);

  // Numeric input bound to a path. Empty string clears the override
  // at that path so the JSON default takes back over.
  const NumInput = ({ path, step = 0.01, min = 0, width = 90, allowNull = false, placeholder }) => {
    const v = getAtPath(merged, path);
    const isOver = getAtPath(overrides, path) !== undefined;
    return (
      <input
        className="admin-input"
        type="number"
        step={step}
        min={min}
        placeholder={placeholder}
        value={v == null ? "" : v}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === "") {
            setOverrides((prev) => setAtPath(
              prev || { _version: "2.0" }, path, allowNull ? null : undefined
            ));
          } else {
            const n = Number(raw);
            if (Number.isFinite(n)) {
              setOverrides((prev) => setAtPath(prev || { _version: "2.0" }, path, n));
            }
          }
        }}
        style={{
          width,
          fontWeight: isOver ? 600 : 400,
          color: isOver ? "var(--purple)" : undefined,
        }}
        title={isOver ? "Customized — clear to revert to default" : "Default"}
      />
    );
  };

  const resetAll = () => {
    if (!window.confirm("Clear all Signs365 overrides and revert to JSON defaults?")) return;
    setOverrides({});
  };

  const overrideKeys = Object.keys(cleanOverrides).filter((k) => k !== "_version");

  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>Signs365 Pricing (v2)</div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
            {overrideKeys.length === 0 ? "Using JSON defaults" : "Customized — purple values diverge from defaults"}
          </span>
          <button
            type="button"
            className="pc-btn pc-btn-secondary pc-btn-xs"
            onClick={resetAll}
            disabled={overrideKeys.length === 0}
          >Reset to defaults</button>
        </div>
      </div>

      <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 10 }}>
        Source of truth is <code>signs365Pricing.json</code>. Edits here override individual values; clearing a field reverts to the JSON default. Adding categories, products, or new tiers requires editing the JSON.
      </p>

      {/* ── Markup tiers ── */}
      <details className="admin-details" open>
        <summary>Markup tiers ({merged.markup.tiers.length})</summary>
        <div className="admin-details-body">
          <table className="admin-mini-table">
            <thead><tr><th>Label</th><th>Max cost ($)</th><th>Multiplier (×)</th></tr></thead>
            <tbody>
              {merged.markup.tiers.map((t, i) => (
                <tr key={i}>
                  <td style={{ color: "var(--text-muted)" }}>{t.label}</td>
                  <td>
                    <input
                      className="admin-input"
                      type="number"
                      step="1"
                      min="0"
                      value={t.maxCost == null ? "" : t.maxCost}
                      placeholder="(no cap)"
                      onChange={(e) => {
                        const raw = e.target.value;
                        const path = ["markup", "tiers", i, "maxCost"];
                        if (raw === "") setOverrides((prev) => setAtPath(prev || { _version: "2.0" }, path, null));
                        else {
                          const n = Number(raw);
                          if (Number.isFinite(n)) setOverrides((prev) => setAtPath(prev || { _version: "2.0" }, path, n));
                        }
                      }}
                      style={{ width: 90 }}
                    />
                  </td>
                  <td><NumInput path={["markup", "tiers", i, "multiplier"]} step={0.05} min={1} width={70} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      {/* ── Categories → products ── */}
      {Object.entries(merged.categories || {}).map(([catKey, cat]) => {
        const productCount = Object.keys(cat.products || {}).length;
        return (
          <details key={catKey} className="admin-details">
            <summary>{cat.label} ({productCount})</summary>
            <div className="admin-details-body">
              {Object.entries(cat.products || {}).map(([prodKey, prod]) => (
                <ProductEditor
                  key={prodKey}
                  catKey={catKey}
                  prodKey={prodKey}
                  product={prod}
                  NumInput={NumInput}
                  setOverrides={setOverrides}
                  cleanOverrides={cleanOverrides}
                />
              ))}
            </div>
          </details>
        );
      })}

      {/* ── Shipping rules ── */}
      <details className="admin-details">
        <summary>Shipping rules ({Object.keys(merged.shippingRules || {}).length})</summary>
        <div className="admin-details-body">
          {Object.entries(merged.shippingRules || {}).map(([ruleKey, rule]) => (
            <ShippingRuleEditor key={ruleKey} ruleKey={ruleKey} rule={rule} NumInput={NumInput} />
          ))}
        </div>
      </details>
    </div>
  );
}

// ── Product editor ───────────────────────────────────
function ProductEditor({ catKey, prodKey, product, NumInput }) {
  const basePath = ["categories", catKey, "products", prodKey];
  const tierVariantOpt = (product.options || []).find((o) => o.type === "tierVariant");

  return (
    <div className="admin-product-block">
      <div className="admin-product-header">
        <span className="admin-product-label">{product.label}</span>
        <span className="admin-product-key">{prodKey} · {product.pricingModel}</span>
      </div>

      {/* Tiers — array or {single,double} keyed map */}
      {Array.isArray(product.tiers) && product.tiers.length > 0 && (
        <TierTable basePath={[...basePath, "tiers"]} tiers={product.tiers} NumInput={NumInput} />
      )}
      {!Array.isArray(product.tiers) && product.tiers && tierVariantOpt && (
        tierVariantOpt.choices.map((c) => (
          <Fragment key={c.value}>
            <div className="admin-options-title" style={{ marginTop: 8 }}>
              Tiers — {c.label}
            </div>
            <TierTable
              basePath={[...basePath, "tiers", c.value]}
              tiers={product.tiers[c.value] || []}
              NumInput={NumInput}
            />
          </Fragment>
        ))
      )}

      {/* Min price */}
      {product.minPrice != null && (
        <div className="admin-mini-row" style={{ marginTop: 6 }}>
          <span className="admin-option-name">Minimum price (per piece)</span>
          {typeof product.minPrice === "number" ? (
            <NumInput path={[...basePath, "minPrice"]} step={0.01} />
          ) : (
            Object.keys(product.minPrice).map((variantKey) => (
              <Fragment key={variantKey}>
                <label>{variantKey}</label>
                <NumInput path={[...basePath, "minPrice", variantKey]} step={0.01} />
              </Fragment>
            ))
          )}
        </div>
      )}

      {/* Per-size base costs (when sizes are inline on the product, e.g. Vehicle Magnet) */}
      {Array.isArray(product.sizes) && product.sizes.length > 0 && (
        <Fragment>
          <div className="admin-options-title" style={{ marginTop: 8 }}>Per-size cost</div>
          <table className="admin-mini-table">
            <thead><tr><th>Size</th><th>Base cost ($)</th><th>Per sq in ($, custom)</th></tr></thead>
            <tbody>
              {product.sizes.map((s, i) => (
                <tr key={s.key}>
                  <td style={{ color: "var(--text-muted)" }}>{s.label}</td>
                  <td>{s.baseCost != null ? <NumInput path={[...basePath, "sizes", i, "baseCost"]} step={0.5} /> : "—"}</td>
                  <td>{s.perSqInCost != null || s.perSqFtCost != null
                    ? <NumInput path={[...basePath, "sizes", i, s.perSqInCost != null ? "perSqInCost" : "perSqFtCost"]} step={0.05} />
                    : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Fragment>
      )}

      {/* Options */}
      {(product.options || []).length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div className="admin-options-title">Options</div>
          {product.options.map((opt, i) => (
            <OptionEditor
              key={opt.key}
              basePath={[...basePath, "options", i]}
              opt={opt}
              NumInput={NumInput}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Tier table (used for both flat-array and per-variant tiers) ──
function TierTable({ basePath, tiers, NumInput }) {
  return (
    <table className="admin-mini-table">
      <thead><tr><th>Tier</th><th>Cost ($)</th></tr></thead>
      <tbody>
        {tiers.map((t, i) => (
          <tr key={i}>
            <td style={{ color: "var(--text-muted)" }}>{t.label}</td>
            <td><NumInput path={[...basePath, i, "cost"]} step={0.05} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── Option editor ────────────────────────────────────
function OptionEditor({ basePath, opt, NumInput }) {
  if (opt.type === "tierVariant") {
    return null; // tierVariant has no editable cost — it's a tier selector
  }

  if (opt.type === "checkbox") {
    return (
      <div className="admin-mini-row admin-option-row">
        <span className="admin-option-name">{opt.label}</span>
        <span className="admin-option-tag">checkbox</span>
        {Object.prototype.hasOwnProperty.call(opt, "cost") && (<>
          <label>$</label><NumInput path={[...basePath, "cost"]} step={0.25} />
        </>)}
        {Object.prototype.hasOwnProperty.call(opt, "costMultiplier") && (<>
          <label>×</label><NumInput path={[...basePath, "costMultiplier"]} step={0.05} min={0.1} />
        </>)}
      </div>
    );
  }

  if (opt.type === "setupFee") {
    return (
      <div className="admin-mini-row admin-option-row">
        <span className="admin-option-name">{opt.label}</span>
        <span className="admin-option-tag">setup fee</span>
        <label>$ once</label>
        <NumInput path={[...basePath, "setupFee"]} step={1} />
      </div>
    );
  }

  if (opt.type === "perLinearFt") {
    return (
      <div className="admin-mini-row admin-option-row">
        <span className="admin-option-name">{opt.label}</span>
        <span className="admin-option-tag">per lin ft</span>
        <label>$/lin ft</label>
        <NumInput path={[...basePath, "costPerLinearFt"]} step={0.25} />
        <label>$ setup</label>
        <NumInput path={[...basePath, "setupFee"]} step={1} />
      </div>
    );
  }

  if (opt.type === "perSqFtAddon") {
    return (
      <div className="admin-mini-row admin-option-row">
        <span className="admin-option-name">{opt.label}</span>
        <span className="admin-option-tag">per sq ft</span>
        <label>$/sq ft</label>
        <NumInput path={[...basePath, "costPerSqFt"]} step={0.05} />
      </div>
    );
  }

  if (opt.type === "perEachAddon") {
    return (
      <div className="admin-mini-row admin-option-row">
        <span className="admin-option-name">{opt.label}</span>
        <span className="admin-option-tag">per each</span>
        <label>$ each</label>
        <NumInput path={[...basePath, "costPerEach"]} step={0.25} />
        <label>$ setup</label>
        <NumInput path={[...basePath, "setupFee"]} step={1} />
      </div>
    );
  }

  if (opt.type === "percentMultiplier") {
    return (
      <div className="admin-mini-row admin-option-row">
        <span className="admin-option-name">{opt.label}</span>
        <span className="admin-option-tag">% multiplier</span>
        <label>×</label>
        <NumInput path={[...basePath, "multiplier"]} step={0.05} min={0.1} />
      </div>
    );
  }

  if (opt.type === "select") {
    return (
      <div className="admin-option-row" style={{ marginBottom: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
          <span className="admin-option-name">{opt.label}</span>
          <span className="admin-option-tag">select</span>
        </div>
        <table className="admin-mini-table">
          <thead><tr><th>Choice</th><th>$ flat</th><th>$/sq ft</th><th>$/lin ft</th><th>×</th></tr></thead>
          <tbody>
            {(opt.choices || []).map((c, i) => (
              <tr key={c.value}>
                <td style={{ color: "var(--text-muted)" }}>{c.label}</td>
                <td>{Object.prototype.hasOwnProperty.call(c, "cost")
                  ? <NumInput path={[...basePath, "choices", i, "cost"]} step={0.25} />
                  : <span style={{ color: "var(--text-subtle, #94a3b8)" }}>—</span>}</td>
                <td>{Object.prototype.hasOwnProperty.call(c, "costPerSqFt")
                  ? <NumInput path={[...basePath, "choices", i, "costPerSqFt"]} step={0.05} />
                  : <span style={{ color: "var(--text-subtle, #94a3b8)" }}>—</span>}</td>
                <td>{Object.prototype.hasOwnProperty.call(c, "costPerLinearFt")
                  ? <NumInput path={[...basePath, "choices", i, "costPerLinearFt"]} step={0.25} />
                  : <span style={{ color: "var(--text-subtle, #94a3b8)" }}>—</span>}</td>
                <td>{Object.prototype.hasOwnProperty.call(c, "costMultiplier")
                  ? <NumInput path={[...basePath, "choices", i, "costMultiplier"]} step={0.05} min={0.1} />
                  : <span style={{ color: "var(--text-subtle, #94a3b8)" }}>—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return null;
}

// ── Shipping rule editor ─────────────────────────────
function ShippingRuleEditor({ ruleKey, rule, NumInput }) {
  const basePath = ["shippingRules", ruleKey];
  return (
    <details className="admin-details" style={{ marginLeft: 8 }}>
      <summary><code>{ruleKey}</code> — {rule.kind}</summary>
      <div className="admin-details-body">
        {rule.description && <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6 }}>{rule.description}</div>}

        {Array.isArray(rule.tiers) && (
          <table className="admin-mini-table">
            <thead><tr><th>Tier</th><th>Cost ($)</th></tr></thead>
            <tbody>
              {rule.tiers.map((t, i) => (
                <tr key={i}>
                  <td style={{ color: "var(--text-muted)" }}>{t.label || `Tier ${i + 1}`}</td>
                  <td><NumInput path={[...basePath, "tiers", i, "cost"]} step={1} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {Array.isArray(rule.freightTriggers) && rule.freightTriggers.length > 0 && (
          <Fragment>
            <div className="admin-options-title" style={{ marginTop: 6 }}>Freight triggers</div>
            <table className="admin-mini-table">
              <thead><tr><th>Trigger</th><th>Cost ($)</th></tr></thead>
              <tbody>
                {rule.freightTriggers.map((t, i) => (
                  <tr key={i}>
                    <td style={{ color: "var(--text-muted)" }}>{t.label || `${t.kind} ${t.value}`}</td>
                    <td><NumInput path={[...basePath, "freightTriggers", i, "cost"]} step={1} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Fragment>
        )}

        {Array.isArray(rule.sizeBands) && rule.sizeBands.map((band, bi) => (
          <Fragment key={bi}>
            <div className="admin-options-title" style={{ marginTop: 6 }}>Band: {band.name}</div>
            <table className="admin-mini-table">
              <thead><tr><th>Tier</th><th>Cost ($)</th></tr></thead>
              <tbody>
                {(band.tiers || []).map((t, ti) => (
                  <tr key={ti}>
                    <td style={{ color: "var(--text-muted)" }}>{t.label || `Tier ${ti + 1}`}</td>
                    <td><NumInput path={[...basePath, "sizeBands", bi, "tiers", ti, "cost"]} step={1} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Fragment>
        ))}
      </div>
    </details>
  );
}
