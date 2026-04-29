// ============================================================
//  SIGNS365 PRICING EDITOR (admin-only)
//
//  Lives inside the existing Admin panel. Edits a partial overrides
//  tree on top of src/data/signs365Pricing.json. Storage:
//    • localStorage.signs365Pricing  (only fields that diverge from
//      defaults; clearing a field reverts to the JSON default via
//      SpecialtyTab's deepMerge)
//    • included in the existing pricing.json export under
//      "signs365Pricing"
//
//  Layout: collapsible (<details>) blocks so the editor doesn't
//  swamp the rest of the admin panel. Defaults closed; the user
//  opens the bits they need.
// ============================================================

import { Fragment } from "react";
import signs365Defaults from "../data/signs365Pricing.json";

// ── Path helpers ─────────────────────────────────────────
const isPlainObject = (v) => v && typeof v === "object" && !Array.isArray(v);

const getAtPath = (obj, path) => path.reduce((acc, k) => (acc == null ? acc : acc[k]), obj);

const setAtPath = (obj, path, value) => {
  if (path.length === 0) return value;
  const [head, ...rest] = path;
  const isArr = Array.isArray(obj);
  if (isArr) {
    const next = obj.slice();
    next[head] = setAtPath(obj[head], rest, value);
    return next;
  }
  return { ...(obj || {}), [head]: setAtPath((obj || {})[head], rest, value) };
};

// Same merge SpecialtyTab uses, kept in sync so the admin sees the
// effective merged value while editing.
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

// ── Component ────────────────────────────────────────────
export default function Signs365PricingEditor({ overrides, setOverrides }) {
  const merged = deepMerge(signs365Defaults, overrides || {});

  // Numeric input wired to a path. Empty string clears the override
  // (path's value goes back to the JSON default).
  const NumInput = ({ path, step = 0.01, min = 0, width = 80 }) => {
    const v = getAtPath(merged, path);
    const isOverridden = getAtPath(overrides, path) !== undefined;
    return (
      <input
        className="admin-input"
        type="number"
        step={step}
        min={min}
        value={v == null ? "" : v}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === "") {
            setOverrides((prev) => setAtPath(prev || {}, path, undefined));
          } else {
            const n = Number(raw);
            if (Number.isFinite(n)) {
              setOverrides((prev) => setAtPath(prev || {}, path, n));
            }
          }
        }}
        style={{
          width,
          fontWeight: isOverridden ? 600 : 400,
          color: isOverridden ? "var(--purple)" : undefined,
        }}
        title={isOverridden ? "Customized — clear to revert to default" : "Default"}
      />
    );
  };

  const resetAll = () => {
    if (!window.confirm("Clear all Signs365 overrides and revert to JSON defaults?")) return;
    setOverrides({});
  };

  const overrideKeys = overrides ? Object.keys(overrides) : [];

  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>Signs365 Pricing</div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
            {overrideKeys.length === 0
              ? "Using JSON defaults"
              : "Customized — purple values diverge from defaults"}
          </span>
          <button
            type="button"
            className="pc-btn pc-btn-secondary pc-btn-xs"
            onClick={resetAll}
            disabled={overrideKeys.length === 0}
          >
            Reset to defaults
          </button>
        </div>
      </div>

      <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 10 }}>
        Verify each placeholder cost against current Signs365 pricing before going
        live. Editing values here saves to localStorage; clearing a field reverts
        to the value baked into <code>signs365Pricing.json</code>.
      </p>

      {/* ── Markup tiers ── */}
      <details className="admin-details" open>
        <summary>Markup tiers ({merged.markup.tiers.length})</summary>
        <div className="admin-details-body">
          <p style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 8 }}>
            Tiers are evaluated by post-discount cost, in order. Leave <em>Max cost</em>
            empty on the last tier to make it the catch-all.
          </p>
          <table className="admin-mini-table">
            <thead>
              <tr>
                <th>Label</th>
                <th>Max cost ($)</th>
                <th>Multiplier (×)</th>
              </tr>
            </thead>
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
                        if (raw === "") setOverrides((prev) => setAtPath(prev || {}, path, null));
                        else {
                          const n = Number(raw);
                          if (Number.isFinite(n)) setOverrides((prev) => setAtPath(prev || {}, path, n));
                        }
                      }}
                      style={{ width: 90 }}
                    />
                  </td>
                  <td>
                    <NumInput path={["markup", "tiers", i, "multiplier"]} step={0.05} min={1} width={70} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      {/* ── Quantity discounts ── */}
      <details className="admin-details" open>
        <summary>Quantity discount tiers ({merged.quantityDiscounts.length})</summary>
        <div className="admin-details-body">
          <p style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 8 }}>
            <em>Discount</em> is a fraction (0.05 = 5% off).
          </p>
          <table className="admin-mini-table">
            <thead>
              <tr>
                <th>Label</th>
                <th>Min qty</th>
                <th>Max qty</th>
                <th>Discount</th>
              </tr>
            </thead>
            <tbody>
              {merged.quantityDiscounts.map((q, i) => (
                <tr key={i}>
                  <td style={{ color: "var(--text-muted)" }}>{q.label}</td>
                  <td><NumInput path={["quantityDiscounts", i, "minQty"]} step={1} width={70} /></td>
                  <td>
                    <input
                      className="admin-input"
                      type="number"
                      step="1"
                      min="0"
                      value={q.maxQty == null ? "" : q.maxQty}
                      placeholder="(no cap)"
                      onChange={(e) => {
                        const raw = e.target.value;
                        const path = ["quantityDiscounts", i, "maxQty"];
                        if (raw === "") setOverrides((prev) => setAtPath(prev || {}, path, null));
                        else {
                          const n = Number(raw);
                          if (Number.isFinite(n)) setOverrides((prev) => setAtPath(prev || {}, path, n));
                        }
                      }}
                      style={{ width: 70 }}
                    />
                  </td>
                  <td><NumInput path={["quantityDiscounts", i, "discount"]} step={0.01} min={0} width={70} /></td>
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
                />
              ))}
            </div>
          </details>
        );
      })}
    </div>
  );
}

// ── Per-product editor ───────────────────────────────────
function ProductEditor({ catKey, prodKey, product, NumInput }) {
  const basePath = ["categories", catKey, "products", prodKey];
  return (
    <div className="admin-product-block">
      <div className="admin-product-header">
        <span className="admin-product-label">{product.label}</span>
        <span className="admin-product-key">{prodKey}</span>
      </div>

      {product.pricingModel === "perSqFt" && (
        <div className="admin-mini-row">
          <label>Cost per sq ft ($)</label>
          <NumInput path={[...basePath, "baseCostPerSqFt"]} step={0.05} />
          <label>Min sq ft</label>
          <NumInput path={[...basePath, "minSqFt"]} step={1} />
        </div>
      )}

      {product.pricingModel === "perPiece" && Array.isArray(product.sizes) && (
        <table className="admin-mini-table">
          <thead>
            <tr>
              <th>Size</th>
              <th>Base cost ($)</th>
              <th>Per-sq-ft cost ($, custom)</th>
            </tr>
          </thead>
          <tbody>
            {product.sizes.map((s, i) => (
              <tr key={s.key}>
                <td style={{ color: "var(--text-muted)" }}>{s.label}</td>
                <td>
                  <NumInput
                    path={[...basePath, "sizes", i, "baseCost"]}
                    step={0.5}
                  />
                </td>
                <td>
                  {s.perSqFtCost != null && (
                    <NumInput
                      path={[...basePath, "sizes", i, "perSqFtCost"]}
                      step={0.25}
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Options: only show numeric cost-bearing fields. Display fields
          (color names, choice labels) stay as-is in the JSON. */}
      {Object.entries(product.options || {}).length > 0 && (
        <div style={{ marginTop: 6 }}>
          <div className="admin-options-title">Options</div>
          {Object.entries(product.options).map(([optKey, opt]) => (
            <OptionEditor
              key={optKey}
              basePath={[...basePath, "options", optKey]}
              optKey={optKey}
              opt={opt}
              NumInput={NumInput}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Option editor ─────────────────────────────────────────
function OptionEditor({ basePath, opt, NumInput }) {
  if (opt.type === "checkbox") {
    return (
      <div className="admin-mini-row admin-option-row">
        <span className="admin-option-name">{opt.label}</span>
        <span className="admin-option-tag">checkbox</span>
        {Object.prototype.hasOwnProperty.call(opt, "cost") && (
          <Fragment>
            <label>Flat $</label>
            <NumInput path={[...basePath, "cost"]} step={0.25} />
          </Fragment>
        )}
        {Object.prototype.hasOwnProperty.call(opt, "costMultiplier") && (
          <Fragment>
            <label>×</label>
            <NumInput path={[...basePath, "costMultiplier"]} step={0.05} min={0.1} />
          </Fragment>
        )}
      </div>
    );
  }

  if (opt.type === "select") {
    return (
      <div className="admin-option-row">
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="admin-option-name">{opt.label}</span>
          <span className="admin-option-tag">select</span>
        </div>
        <table className="admin-mini-table">
          <thead>
            <tr>
              <th>Choice</th>
              <th>Flat $</th>
              <th>$/sqft</th>
              <th>$/lin ft</th>
              <th>×</th>
            </tr>
          </thead>
          <tbody>
            {(opt.choices || []).map((c, i) => (
              <tr key={c.value}>
                <td style={{ color: "var(--text-muted)" }}>{c.label}</td>
                <td>
                  {Object.prototype.hasOwnProperty.call(c, "cost")
                    ? <NumInput path={[...basePath, "choices", i, "cost"]} step={0.25} />
                    : <span style={{ color: "var(--text-subtle, #94a3b8)" }}>—</span>}
                </td>
                <td>
                  {Object.prototype.hasOwnProperty.call(c, "costPerSqFt")
                    ? <NumInput path={[...basePath, "choices", i, "costPerSqFt"]} step={0.05} />
                    : <span style={{ color: "var(--text-subtle, #94a3b8)" }}>—</span>}
                </td>
                <td>
                  {Object.prototype.hasOwnProperty.call(c, "costPerLinearFt")
                    ? <NumInput path={[...basePath, "choices", i, "costPerLinearFt"]} step={0.25} />
                    : <span style={{ color: "var(--text-subtle, #94a3b8)" }}>—</span>}
                </td>
                <td>
                  {Object.prototype.hasOwnProperty.call(c, "costMultiplier")
                    ? <NumInput path={[...basePath, "choices", i, "costMultiplier"]} step={0.05} min={0.1} />
                    : <span style={{ color: "var(--text-subtle, #94a3b8)" }}>—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (opt.type === "perEachAddon") {
    return (
      <div className="admin-mini-row admin-option-row">
        <span className="admin-option-name">{opt.label}</span>
        <span className="admin-option-tag">per-each</span>
        <label>$ each</label>
        <NumInput path={[...basePath, "costPerEach"]} step={0.25} />
      </div>
    );
  }

  return null;
}
