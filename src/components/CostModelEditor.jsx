// ============================================================
//  COST & MARGIN EDITOR — Phase E (admin panel)
//  Replaces the flat Sheet Pricing / Large Format Pricing tables.
//  Edits flow into the same App.jsx state the old tables wrote
//  (pricing / lfPricing / markups / paperTypes), so Export, Import and
//  Publish to Cloud are unchanged. All math is src/lib/margin.js.
//
//  Editing rules
//   - Click edits are CALIBRATION: they re-derive paper cost so the base
//     costs (and therefore every price) stay exactly where they were.
//   - Paper-cost edits MOVE the base costs. Cost-up papers re-price from
//     markup; market-down papers hold price and margin absorbs it.
//   - Mode switch to cost-up re-derives prices and lists, cell by cell,
//     what would change before doing it.
// ============================================================
import { useMemo, useState } from "react";
import {
  decomposeEntry, withSplit, bwClickUnset, solveMarkupFromPrice, priceFromMarkup,
  costUpDeltas, repriceFromMarkup, previewCostIncrease, computeMargin, marginHealth,
  HEALTH_LABELS, lfCostPerSqFt, marginLabelFor, r4, DEFAULT_LABOR, DEFAULT_THRESHOLDS,
} from "../lib/margin.js";

// ── Module-scope helpers (no component state) ──
const TH  = { padding: "6px 8px", textAlign: "right", fontWeight: 600, color: "var(--text-muted)", fontSize: 11, whiteSpace: "nowrap" };
const THL = { ...TH, textAlign: "left" };
const TD  = { padding: "4px 8px", textAlign: "right", whiteSpace: "nowrap", fontSize: 12 };
const TDL = { ...TD, textAlign: "left" };
const fmt4 = (n) => `$${(Number(n) || 0).toFixed(4)}`;
const fmtPct = (p) => (p === null || p === undefined ? "—" : `${Number(p).toFixed(1)}%`);
const modeOf = (pt) => (pt?.pricingMode === "market_down" ? "market_down" : "cost_up");

function Health({ pct, thresholds }) {
  const h = marginHealth(pct, thresholds);
  return h ? <span className={`margin-dot is-${h}`} title={HEALTH_LABELS[h]} aria-label={HEALTH_LABELS[h]} /> : null;
}

function Num({ value, onChange, step = "0.0001", width = 74, disabled = false, flag = false, title }) {
  return (
    <input
      className={`admin-input ${flag ? "is-flagged" : ""}`}
      type="number" step={step} style={{ width }} value={value} disabled={disabled} title={title}
      onChange={(e) => onChange(+e.target.value || 0)}
    />
  );
}

function Ro({ children, title }) {
  return <span className="cme-ro" title={title}>{children}</span>;
}

export default function CostModelEditor({
  paperTypes, setPaperTypes, sheetKeysForPaper,
  pricing, setPricing, markupPerPaper, setMarkupPerPaper,
  lfPaperTypes, setLfPaperTypes, lfPricing, setLfPricing, lfMarkupPerPaper, setLfMarkupPerPaper,
  labor = DEFAULT_LABOR, setLabor, marginThresholds = DEFAULT_THRESHOLDS, setMarginThresholds,
}) {
  const [bulkClickBW, setBulkClickBW] = useState("");
  const [incPct, setIncPct] = useState(10);
  const [incSel, setIncSel] = useState(null);         // null = all
  const [incPreview, setIncPreview] = useState(null);
  const label = marginLabelFor(labor.enabled);

  // ── B&W click audit ──
  const sheetCells = useMemo(() => {
    const all = [];
    (paperTypes || []).forEach((pt) => (sheetKeysForPaper[pt.key] || []).forEach((sk) => {
      const e = (pricing[pt.key] || {})[sk];
      if (e) all.push({ pk: pt.key, sk, e });
    }));
    return all;
  }, [paperTypes, sheetKeysForPaper, pricing]);
  const unsetBW = sheetCells.filter((c) => bwClickUnset(c.e));

  // ── Entry writers ──
  const writeEntry = (pk, sk, fn) => setPricing((prev) => {
    const n = { ...prev, [pk]: { ...(prev[pk] || {}) } };
    n[pk][sk] = fn(n[pk][sk] || {});
    return n;
  });

  // Calibration: hold base costs, re-derive paper from the edited click,
  // then the other click from its base cost.
  const setClick = (pk, sk, which, v) => writeEntry(pk, sk, (e) => {
    const d = decomposeEntry(e);
    const bcC = r4(e.baseCostColor ?? d.paperCost + d.clickColor);
    const bcB = r4(e.baseCostBW ?? d.paperCost + d.clickBW);
    const paperCost = which === "clickBW" ? r4(bcB - v) : r4(bcC - v);
    const clickBW    = which === "clickBW" ? r4(v) : r4(bcB - paperCost);
    const clickColor = which === "clickBW" ? r4(bcC - paperCost) : r4(v);
    return { ...e, paperCost, clickColor, clickBW, baseCostColor: bcC, baseCostBW: bcB };
  });

  const applyBulkClickBW = () => {
    const v = +bulkClickBW;
    if (!(v > 0)) return;
    if (!window.confirm(`Set the B&W click to $${v.toFixed(4)} per side on all ${sheetCells.length} sheet prices? Paper cost re-derives on each row; no sell price changes.`)) return;
    sheetCells.forEach((c) => setClick(c.pk, c.sk, "clickBW", v));
    setBulkClickBW("");
  };

  // Paper cost moves base costs; cost-up re-prices.
  const setPaperCost = (pk, sk, v) => {
    const mode = modeOf((paperTypes || []).find((p) => p.key === pk));
    const mk = markupPerPaper[pk] || 0;
    writeEntry(pk, sk, (e) => {
      const n = withSplit(e, { paperCost: r4(v) });
      return mode === "cost_up"
        ? { ...n, priceColor: priceFromMarkup(n.baseCostColor, mk), priceBW: priceFromMarkup(n.baseCostBW, mk) }
        : n;
    });
  };

  const setMarkup = (pk, v) => {
    setMarkupPerPaper((prev) => ({ ...prev, [pk]: v }));
    setPricing((prev) => ({ ...prev, [pk]: repriceFromMarkup(prev[pk] || {}, v) }));
  };

  // Market-down: prices are the input; the paper's stored markup becomes the
  // implied markup of its first size in color (export compatibility only).
  const setPrice = (pk, sk, which, v) => {
    writeEntry(pk, sk, (e) => ({ ...e, [which]: r4(v) }));
    const firstSk = (sheetKeysForPaper[pk] || [])[0];
    if (sk === firstSk && which === "priceColor") {
      const e = (pricing[pk] || {})[sk] || {};
      const implied = solveMarkupFromPrice(v, e.baseCostColor);
      if (implied !== null) setMarkupPerPaper((prev) => ({ ...prev, [pk]: implied }));
    }
  };

  const setMode = (pk, mode) => {
    const pt = (paperTypes || []).find((p) => p.key === pk);
    if (mode === "cost_up") {
      const mk = markupPerPaper[pk] || 0;
      const deltas = costUpDeltas({ sizes: pricing[pk] || {}, markup: mk });
      if (deltas.length) {
        const list = deltas.map((d) =>
          `  ${d.sizeKey} ${d.colorMode === "color" ? "color" : "B&W"}: $${d.from.toFixed(4)} → $${d.to.toFixed(4)} (${d.delta >= 0 ? "+" : "−"}$${Math.abs(d.delta).toFixed(4)})`).join("\n");
        if (!window.confirm(`Switching ${pt?.label || pk} to cost-up re-derives every sell price from cost × (1 + ${mk}%).\n\nThese cells change:\n${list}\n\nContinue?`)) return;
        setPricing((prev) => ({ ...prev, [pk]: repriceFromMarkup(prev[pk] || {}, mk) }));
      }
    }
    setPaperTypes((prev) => prev.map((p) => (p.key === pk ? { ...p, pricingMode: mode } : p)));
  };

  // ── Large format ──
  const setLfCost = (pk, v) => {
    const mode = modeOf((lfPaperTypes || []).find((p) => p.key === pk));
    const mk = lfMarkupPerPaper[pk] || 0;
    setLfPricing((prev) => {
      const e = prev[pk] || {};
      const n = { ...e, paperCost: r4(v), clickColor: 0, clickBW: 0, baseCostColor: r4(v), baseCostBW: 0 };
      return { ...prev, [pk]: mode === "cost_up" ? { ...n, priceColor: priceFromMarkup(r4(v), mk) } : n };
    });
  };
  const setLfMarkup = (pk, v) => {
    setLfMarkupPerPaper((prev) => ({ ...prev, [pk]: v }));
    setLfPricing((prev) => {
      const e = prev[pk] || {};
      return { ...prev, [pk]: { ...e, priceColor: priceFromMarkup(lfCostPerSqFt(e), v) } };
    });
  };
  const setLfPrice = (pk, which, v) => {
    setLfPricing((prev) => ({ ...prev, [pk]: { ...(prev[pk] || {}), [which]: r4(v) } }));
    if (which === "priceColor") {
      const implied = solveMarkupFromPrice(v, lfCostPerSqFt(lfPricing[pk] || {}));
      if (implied !== null) setLfMarkupPerPaper((prev) => ({ ...prev, [pk]: implied }));
    }
  };
  const setLfMode = (pk, mode) => {
    const pt = (lfPaperTypes || []).find((p) => p.key === pk);
    if (mode === "cost_up") {
      const e = lfPricing[pk] || {};
      const mk = lfMarkupPerPaper[pk] || 0;
      const to = priceFromMarkup(lfCostPerSqFt(e), mk), from = r4(e.priceColor);
      if (Math.abs(to - from) > 0.00005) {
        if (!window.confirm(`Switching ${pt?.label || pk} to cost-up re-derives its color $/sq ft from cost × (1 + ${mk}%).\n\n  color: $${from.toFixed(4)} → $${to.toFixed(4)} (${to - from >= 0 ? "+" : "−"}$${Math.abs(to - from).toFixed(4)})\n\nContinue?`)) return;
        setLfPricing((prev) => ({ ...prev, [pk]: { ...(prev[pk] || {}), priceColor: to } }));
      }
    }
    setLfPaperTypes((prev) => prev.map((p) => (p.key === pk ? { ...p, pricingMode: mode } : p)));
  };

  // ── Cost-increase modeling ──
  const allKeys = useMemo(() => ({
    sheet: (paperTypes || []).map((p) => p.key),
    lf: (lfPaperTypes || []).map((p) => p.key),
  }), [paperTypes, lfPaperTypes]);
  const selected = incSel || { sheet: allKeys.sheet, lf: allKeys.lf };
  const toggleSel = (kind, key) => setIncSel((prev) => {
    const cur = prev || { sheet: allKeys.sheet, lf: allKeys.lf };
    const set = new Set(cur[kind]);
    set.has(key) ? set.delete(key) : set.add(key);
    return { ...cur, [kind]: [...set] };
  });
  const modes = useMemo(() => Object.fromEntries((paperTypes || []).map((p) => [p.key, modeOf(p)])), [paperTypes]);
  const lfModes = useMemo(() => Object.fromEntries((lfPaperTypes || []).map((p) => [p.key, modeOf(p)])), [lfPaperTypes]);
  const runPreview = () => setIncPreview(previewCostIncrease({
    sheetPricing: pricing, lfPricing, markups: markupPerPaper, lfMarkups: lfMarkupPerPaper,
    modes, lfModes, percent: incPct, paperKeys: selected.sheet, lfPaperKeys: selected.lf,
  }));
  const applyPreview = () => {
    if (!incPreview) return;
    if (!window.confirm(`Apply the ${incPct}% paper-cost increase to ${incPreview.rows.length} price cells? Publish to Cloud is still a separate step.`)) return;
    setPricing((prev) => ({ ...prev, ...incPreview.apply.sheetPricing }));
    setLfPricing((prev) => ({ ...prev, ...incPreview.apply.lfPricing }));
    setIncPreview(null);
  };

  const cellMargin = (price, cost) => computeMargin({ price, cost }).marginPct;

  return (
    <div className="cme">
      {/* ── B&W click callout — impossible to miss, names the consequence ── */}
      {unsetBW.length > 0 && (
        <div className="callout callout-danger cme-callout" role="alert">
          <span className="callout-icon">⚠</span>
          <div>
            <div className="cme-callout-title">B&W click charge is not set — duplex B&W jobs are under-costed</div>
            <div>
              {unsetBW.length} of {sheetCells.length} sheet prices carry a B&W click of <strong>$0.0000</strong>. Every B&W side is
              costed as paper only: a B&W back side costs <strong>$0.00</strong>, and a duplex B&W job shows the same cost as
              single-sided. {label} on those jobs reads <strong>higher than it really is</strong>. Enter the Ricoh B&W click
              per side to fix it — paper cost re-derives on each row and <strong>no sell price changes</strong>.
            </div>
            <div className="cme-callout-action">
              <label className="field-label" style={{ marginBottom: 0 }}>B&W click per side $</label>
              <input className="admin-input" type="number" step="0.0001" min="0" style={{ width: 90 }} placeholder="0.0000"
                value={bulkClickBW} onChange={(e) => setBulkClickBW(e.target.value)} />
              <button type="button" className="pc-btn pc-btn-primary pc-btn-xs" onClick={applyBulkClickBW} disabled={!(+bulkClickBW > 0)}>
                Apply to all {sheetCells.length} sheet rows
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Sheet price book ── */}
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Sheet Pricing — cost, mode and {label.toLowerCase()} (per sheet)</div>
      <p className="cme-hint">
        <strong>Cost-up</strong>: enter costs and markup, sell prices derive. <strong>Market-down</strong>: enter the sell price you want, markup and {label.toLowerCase()} derive.
        Click edits re-split cost without moving any price; paper-cost edits move cost (and price, in cost-up).
      </p>
      <div style={{ overflowX: "auto" }}>
        <table className="cme-table" style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "var(--surface-3)" }}>
              <th style={THL}>Paper / sheet</th>
              <th style={TH}>Paper cost</th>
              <th style={TH}>Click color</th>
              <th style={TH}>Click B&W</th>
              <th style={TH}>Cost color</th>
              <th style={TH}>Cost B&W</th>
              <th style={TH}>Markup %</th>
              <th style={TH}>Sell color</th>
              <th style={TH}>Sell B&W</th>
              <th style={TH}>{label} color</th>
              <th style={TH}>{label} B&W</th>
            </tr>
          </thead>
          <tbody>
            {(paperTypes || []).map((pt) => {
              const mode = modeOf(pt);
              const mk = markupPerPaper[pt.key] || 0;
              const sizes = sheetKeysForPaper[pt.key] || [];
              return [
                <tr key={`${pt.key}-hdr`} className="cme-paper-row">
                  <td style={TDL} colSpan={11}>
                    <span style={{ fontWeight: 600 }}>{pt.label}</span>
                    <span className="cme-mode">
                      <label>Mode</label>
                      <select className="admin-input" value={mode} onChange={(e) => setMode(pt.key, e.target.value)}>
                        <option value="cost_up">Cost-up (markup → price)</option>
                        <option value="market_down">Market-down (price → markup)</option>
                      </select>
                      <label>Markup %</label>
                      {mode === "cost_up"
                        ? <Num value={mk} step="1" width={64} onChange={(v) => setMarkup(pt.key, v)} />
                        : <Ro title="Implied from the first size's color price">{mk} (implied)</Ro>}
                    </span>
                  </td>
                </tr>,
                ...sizes.map((sk) => {
                  const raw = (pricing[pt.key] || {})[sk] || {};
                  const d = decomposeEntry(raw);
                  const e = { ...raw, ...d, ...{ baseCostColor: r4(raw.baseCostColor ?? d.paperCost + d.clickColor), baseCostBW: r4(raw.baseCostBW ?? d.paperCost + d.clickBW) } };
                  const mC = cellMargin(e.priceColor, e.baseCostColor);
                  const mB = (Number(e.priceBW) > 0) ? cellMargin(e.priceBW, e.baseCostBW) : null;
                  const impliedC = solveMarkupFromPrice(e.priceColor, e.baseCostColor);
                  const impliedB = solveMarkupFromPrice(e.priceBW, e.baseCostBW);
                  return (
                    <tr key={`${pt.key}-${sk}`} style={{ borderTop: "1px solid var(--border)" }}>
                      <td style={TDL}><span style={{ color: "var(--text-muted)", fontSize: 11 }}>{pt.label}</span> · <strong>{sk}</strong></td>
                      <td style={TD}><Num value={e.paperCost} onChange={(v) => setPaperCost(pt.key, sk, v)} /></td>
                      <td style={TD}><Num value={e.clickColor} onChange={(v) => setClick(pt.key, sk, "clickColor", v)} /></td>
                      <td style={TD}><Num value={e.clickBW} flag={d.clickBW === 0} title={d.clickBW === 0 ? "Unset — B&W sides are costed as paper only" : undefined} onChange={(v) => setClick(pt.key, sk, "clickBW", v)} /></td>
                      <td style={TD}><Ro title="paper cost + click color">{fmt4(e.baseCostColor)}</Ro></td>
                      <td style={TD}><Ro title="paper cost + click B&W">{fmt4(e.baseCostBW)}</Ro></td>
                      <td style={TD}>
                        {mode === "cost_up"
                          ? <Ro>{mk}%</Ro>
                          : <Ro title="Implied per cell: price ÷ cost − 1">{impliedC === null ? "—" : `${impliedC}%`} / {impliedB === null ? "—" : `${impliedB}%`}</Ro>}
                      </td>
                      <td style={TD}>
                        {mode === "market_down"
                          ? <Num value={e.priceColor} onChange={(v) => setPrice(pt.key, sk, "priceColor", v)} />
                          : <Ro title="cost color × (1 + markup)">{fmt4(e.priceColor)}</Ro>}
                      </td>
                      <td style={TD}>
                        {mode === "market_down"
                          ? <Num value={e.priceBW} onChange={(v) => setPrice(pt.key, sk, "priceBW", v)} />
                          : <Ro title="cost B&W × (1 + markup)">{fmt4(e.priceBW)}</Ro>}
                      </td>
                      <td style={TD}><Health pct={mC} thresholds={marginThresholds} /> {fmtPct(mC)}</td>
                      <td style={TD}><Health pct={mB} thresholds={marginThresholds} /> {fmtPct(mB)}</td>
                    </tr>
                  );
                }),
              ];
            })}
          </tbody>
        </table>
      </div>

      {/* ── Large format ── */}
      <div style={{ fontSize: 13, fontWeight: 600, margin: "18px 0 4px" }}>Large Format Pricing — media cost, mode and {label.toLowerCase()} (per sq ft)</div>
      <p className="cme-hint">Large format has no click charge: cost is media only. Add-on costs (grommets, foam core) are not modeled yet and count as $0 cost.</p>
      <div style={{ overflowX: "auto" }}>
        <table className="cme-table" style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "var(--surface-3)" }}>
              <th style={THL}>Media</th>
              <th style={THL}>Mode</th>
              <th style={TH}>Media cost $/sqft</th>
              <th style={TH}>Markup %</th>
              <th style={TH}>Color $/sqft</th>
              <th style={TH}>B&W $/sqft</th>
              <th style={TH}>{label} (color)</th>
            </tr>
          </thead>
          <tbody>
            {(lfPaperTypes || []).map((pt) => {
              const mode = modeOf(pt);
              const e = lfPricing[pt.key] || {};
              const cost = lfCostPerSqFt(e);
              const mk = lfMarkupPerPaper[pt.key] || 0;
              const m = cellMargin(e.priceColor, cost);
              return (
                <tr key={pt.key} style={{ borderTop: "1px solid var(--border)" }}>
                  <td style={TDL}><strong>{pt.label}</strong></td>
                  <td style={TDL}>
                    <select className="admin-input" value={mode} onChange={(ev) => setLfMode(pt.key, ev.target.value)}>
                      <option value="cost_up">Cost-up</option>
                      <option value="market_down">Market-down</option>
                    </select>
                  </td>
                  <td style={TD}><Num value={cost} width={80} onChange={(v) => setLfCost(pt.key, v)} /></td>
                  <td style={TD}>
                    {mode === "cost_up"
                      ? <Num value={mk} step="1" width={64} onChange={(v) => setLfMarkup(pt.key, v)} />
                      : <Ro title="Implied: price ÷ cost − 1">{solveMarkupFromPrice(e.priceColor, cost) ?? "—"}% (implied)</Ro>}
                  </td>
                  <td style={TD}>
                    {mode === "market_down"
                      ? <Num value={e.priceColor ?? 0} width={80} onChange={(v) => setLfPrice(pt.key, "priceColor", v)} />
                      : <Ro title="media cost × (1 + markup)">{fmt4(e.priceColor)}</Ro>}
                  </td>
                  <td style={TD}><Num value={e.priceBW ?? 0} width={80} onChange={(v) => setLfPrice(pt.key, "priceBW", v)} /></td>
                  <td style={TD}><Health pct={m} thresholds={marginThresholds} /> {fmtPct(m)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── Labor ── */}
      <div style={{ fontSize: 13, fontWeight: 600, margin: "18px 0 4px" }}>Labor (optional)</div>
      <p className="cme-hint">
        Off by default. When on, a setup cost per order and a per-unit cost (per sheet, print or record) join material cost, and the
        metric is labeled <strong>Margin</strong> instead of <strong>Material margin</strong> everywhere it appears.
      </p>
      <div className="cme-inline">
        <label className="cme-check">
          <input type="checkbox" checked={!!labor.enabled} onChange={(e) => setLabor({ ...labor, enabled: e.target.checked })} />
          Include labor in cost
        </label>
        {labor.enabled && (
          <>
            <label className="field-label" style={{ marginBottom: 0 }}>Setup per order $</label>
            <Num value={labor.setupPerJob} step="0.25" width={80} onChange={(v) => setLabor({ ...labor, setupPerJob: v })} />
            <label className="field-label" style={{ marginBottom: 0 }}>Per unit $</label>
            <Num value={labor.perUnit} step="0.01" width={80} onChange={(v) => setLabor({ ...labor, perUnit: v })} />
          </>
        )}
      </div>

      {/* ── Thresholds ── */}
      <div style={{ fontSize: 13, fontWeight: 600, margin: "18px 0 4px" }}>Margin health thresholds</div>
      <p className="cme-hint">
        <span className="margin-dot is-healthy" /> Healthy at or above the first number, <span className="margin-dot is-thin" /> thin between, <span className="margin-dot is-underwater" /> underwater below the second.
        Informational only. <strong>These were set against material margin</strong>; once labor is enabled the numbers will read lower and the thresholds may need different values.
      </p>
      <div className="cme-inline">
        <label className="field-label" style={{ marginBottom: 0 }}>Healthy ≥ %</label>
        <Num value={marginThresholds.healthy} step="1" width={64} onChange={(v) => setMarginThresholds({ ...marginThresholds, healthy: v })} />
        <label className="field-label" style={{ marginBottom: 0 }}>Thin ≥ %</label>
        <Num value={marginThresholds.thin} step="1" width={64} onChange={(v) => setMarginThresholds({ ...marginThresholds, thin: v })} />
        <button type="button" className="pc-btn pc-btn-secondary pc-btn-xs" onClick={() => setMarginThresholds({ ...DEFAULT_THRESHOLDS })}>Reset (75 / 50)</button>
      </div>

      {/* ── Cost-increase modeling ── */}
      <div style={{ fontSize: 13, fontWeight: 600, margin: "18px 0 4px" }}>Model a paper cost increase</div>
      <p className="cme-hint">
        "Paper went up X%." Raises the paper (media) cost on the selected papers; click charges stay. Cost-up papers hold their {label.toLowerCase()} and raise price;
        market-down papers hold price and absorb it. Preview first, then apply or discard. Apply changes this device's price book only — Publish to Cloud is still a separate step.
      </p>
      <div className="cme-inline">
        <label className="field-label" style={{ marginBottom: 0 }}>Increase %</label>
        <Num value={incPct} step="0.5" width={70} onChange={(v) => { setIncPct(v); setIncPreview(null); }} />
        <button type="button" className="pc-btn pc-btn-secondary pc-btn-xs" onClick={runPreview} disabled={!(selected.sheet.length + selected.lf.length)}>Preview</button>
        {incPreview && <button type="button" className="pc-btn pc-btn-primary pc-btn-xs" onClick={applyPreview}>Apply to price book</button>}
        {incPreview && <button type="button" className="pc-btn pc-btn-secondary pc-btn-xs" onClick={() => setIncPreview(null)}>Discard</button>}
      </div>
      <div className="cme-checks">
        {(paperTypes || []).map((p) => (
          <label key={`s-${p.key}`} className="cme-check">
            <input type="checkbox" checked={selected.sheet.includes(p.key)} onChange={() => { toggleSel("sheet", p.key); setIncPreview(null); }} /> {p.label}
          </label>
        ))}
        {(lfPaperTypes || []).map((p) => (
          <label key={`l-${p.key}`} className="cme-check">
            <input type="checkbox" checked={selected.lf.includes(p.key)} onChange={() => { toggleSel("lf", p.key); setIncPreview(null); }} /> {p.label} (LF)
          </label>
        ))}
      </div>
      {incPreview && (
        <div style={{ overflowX: "auto", marginTop: 8 }}>
          <table className="cme-table" style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "var(--surface-3)" }}>
                <th style={THL}>Cell</th><th style={THL}>Mode</th>
                <th style={TH}>Cost now</th><th style={TH}>Cost after</th>
                <th style={TH}>Price now</th><th style={TH}>Price after</th>
                <th style={TH}>{label} now</th><th style={TH}>{label} after</th>
              </tr>
            </thead>
            <tbody>
              {incPreview.rows.map((r, i) => (
                <tr key={i} style={{ borderTop: "1px solid var(--border)" }}>
                  <td style={TDL}>{r.paper}{r.sizeKey ? ` · ${r.sizeKey}` : " (LF)"} · {r.colorMode === "color" ? "color" : "B&W"}</td>
                  <td style={TDL}>{r.mode === "cost_up" ? "cost-up" : "market-down"}</td>
                  <td style={TD}>{fmt4(r.oldCost)}</td><td style={TD}><strong>{fmt4(r.newCost)}</strong></td>
                  <td style={TD}>{fmt4(r.oldPrice)}</td><td style={TD}><strong>{fmt4(r.newPrice)}</strong></td>
                  <td style={TD}><Health pct={r.oldMarginPct} thresholds={marginThresholds} /> {fmtPct(r.oldMarginPct)}</td>
                  <td style={TD}><Health pct={r.newMarginPct} thresholds={marginThresholds} /> <strong>{fmtPct(r.newMarginPct)}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
