// ============================================================
//  SPECIALTY TAB — Signs365 trade-printing front end
//  Phase 2 stub: renders a placeholder so the new tab is visible
//  and links the pricing JSON. Phase 3 replaces this body with
//  the real category/product/size/options UI + live pricing.
// ============================================================

import signs365Pricing from "../data/signs365Pricing.json";

export default function SpecialtyTab({ CardHeader }) {
  const categoryEntries = Object.entries(signs365Pricing.categories || {});

  return (
    <div className="pc-card">
      <CardHeader
        step="🪧"
        stepClass="step-num-purple"
        title="Specialty / Trade Print (Signs365)"
        hint="Coming online in the next phase"
      />
      <div className="pc-card-body">
        <div className="callout callout-info" style={{ marginBottom: 14 }}>
          <span className="callout-icon">ℹ</span>
          The full Signs365 builder is coming in Phase 3. Pricing data is
          loaded and ready ({categoryEntries.length} categories,{" "}
          {categoryEntries.reduce(
            (n, [, c]) => n + Object.keys(c.products || {}).length,
            0
          )}{" "}
          products). Verify the placeholder costs in the admin panel before
          going live.
        </div>

        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>
          Categories ready
        </div>
        <div className="specialty-cat-grid">
          {categoryEntries.map(([key, c]) => (
            <div key={key} className="specialty-cat-card">
              <div className="specialty-cat-label">{c.label}</div>
              <div className="specialty-cat-desc">{c.description}</div>
              <div className="specialty-cat-count">
                {Object.keys(c.products || {}).length} product
                {Object.keys(c.products || {}).length === 1 ? "" : "s"}
              </div>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 16, fontSize: 12, color: "var(--text-muted)" }}>
          Markup tiers: {signs365Pricing.markup.tiers.map((t) => t.label).join(" · ")}
        </div>
        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
          Quantity breaks: {signs365Pricing.quantityDiscounts.map((q) => q.label).join(" · ")}
        </div>
      </div>
    </div>
  );
}
