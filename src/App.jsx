import React, { useState, useEffect, useRef, useMemo } from "react";

// ---------- MOBILE-FRIENDLY INPUTS & PDF COMPRESSION HELPERS ----------

// Smart numeric input: easier editing on phones/tablets (no iOS "stuck at 1" behavior)
const SmartNumberInput = ({
  label,
  value,
  onValue,
  min = 0,
  max = Infinity,
  step = "any",
  placeholder = "",
  suffix = ""
}) => {
  const [raw, setRaw] = useState(value === null || value === undefined ? "" : String(value));

  useEffect(() => {
    // Keep raw in sync when value changes externally
    const next = value === null || value === undefined ? "" : String(value);
    if (next !== raw) setRaw(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const clamp = (n) => Math.max(min, Math.min(max, n));

  const commit = (text) => {
    const t = String(text ?? "").trim();
    if (t === "") {
      // Don't force a value while the user is editing; finalize on blur
      return;
    }
    const n = parseFloat(t);
    if (!Number.isFinite(n)) return;
    onValue(clamp(n));
  };

  return (
    <label className="block">
      {label ? (
        <div className="text-xs font-medium text-slate-600 mb-1">{label}</div>
      ) : null}
      <div className="relative">
        <input
          type="text"
          inputMode="decimal"
          pattern="[0-9]*[.,]?[0-9]*"
          value={raw}
          placeholder={placeholder}
          onChange={(e) => {
            const v = e.target.value.replace(/,/g, ".");
            setRaw(v);
            commit(v);
          }}
          onFocus={(e) => {
            // Select all so it's easy to overwrite on mobile
            requestAnimationFrame(() => e.target.select());
          }}
          onBlur={() => {
            const t = raw.trim();
            if (t === "") {
              setRaw(String(min));
              onValue(min);
              return;
            }
            const n = parseFloat(t);
            if (!Number.isFinite(n)) {
              setRaw(String(min));
              onValue(min);
              return;
            }
            const c = clamp(n);
            // Normalize display (avoid trailing ".")
            setRaw(String(c));
            onValue(c);
          }}
          className="w-28 sm:w-24 border rounded-md px-3 py-2 text-base sm:text-sm pr-10 input-glow"
          style={{ WebkitTextSizeAdjust: "100%" }}
        />
        {suffix ? (
          <div className="absolute inset-y-0 right-8 flex items-center text-xs text-slate-500 pointer-events-none">
            {suffix}
          </div>
        ) : null}
        <button
          type="button"
          className="absolute inset-y-0 right-1 my-1 px-2 rounded-md text-slate-500 hover:bg-slate-100 active:bg-slate-200 button-press"
          onClick={() => {
            setRaw("");
            // Don't force min immediately; user can type
          }}
          aria-label="Clear"
          title="Clear"
        >
          ×
        </button>
      </div>
    </label>
  );
};

// Downscale and compress canvases before embedding into PDFs for email (keeps payload under limits)
const canvasToCompressedJpeg = (canvas, { maxDim = 1400, quality = 0.72 } = {}) => {
  try {
    const w = canvas.width;
    const h = canvas.height;
    if (!w || !h) return canvas.toDataURL("image/jpeg", quality);

    const scale = Math.min(1, maxDim / Math.max(w, h));
    if (scale >= 1) {
      return canvas.toDataURL("image/jpeg", quality);
    }
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(w * scale));
    c.height = Math.max(1, Math.round(h * scale));
    const ctx = c.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(canvas, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", quality);
  } catch (e) {
    console.warn("canvasToCompressedJpeg failed:", e);
    return canvas.toDataURL("image/jpeg", 0.7);
  }
};
      // jsPDF is provided via the UMD script tag in index.html (window.jspdf.jsPDF).
      // Guard here so the app fails gracefully if the script is blocked.
      const jsPDF = window?.jspdf?.jsPDF;
      if (!jsPDF) {
        throw new Error(
          "jsPDF failed to load. Ensure the jsPDF UMD script is included before the app bundle (window.jspdf.jsPDF)."
        );
      }

      const UPS_STORE = {
        name: 'The UPS Store',
        address: '4352 Bay Road, Saginaw MI 48603',
        phone: '989.790.9701',
        email: 'store4979@theupsstore.com'
      };

      const UPS_LOGO_DATA_URL = (window.UPS_LOGO_DATA_URL || "");

      const getUpsLogoAbsUrl = () => UPS_LOGO_DATA_URL;
      // For jsPDF we need a DATA URL (base64). Loaded once at runtime.
      let UPS_LOGO_PDF_DATA_URL = UPS_LOGO_DATA_URL;


      
      // Ensure the logo is available as a base64 DATA URL for jsPDF.
      async function ensureLogoPdfDataUrl() {
        // Logo is embedded as a data URL for reliable mobile PDF/print rendering.
        // No network fetch required (critical for iOS/PWA PDF generation).
        UPS_LOGO_PDF_DATA_URL = UPS_LOGO_DATA_URL;
        return UPS_LOGO_PDF_DATA_URL;
      }

// ---------- CONSTANTS ----------

      const DPI = 300;
      const MARGIN_IN = 0.1;
      const SPACING_IN = 0.05;
      const BLEED_IN = 0.125;

      const PRESET_SHEETS = {
        "8.5x11": [8.5, 11],
        "11x17": [11, 17],
        "12x18": [12, 18],
        custom: null
      };

      const DEFAULT_PAPER_TYPES = [
        { key: "28lb", label: "28 LB Paper" },
        { key: "20lb", label: "20 LB Paper" },
        { key: "80c", label: "80 LB Cardstock Cover" },
        { key: "110c", label: "110 LB Cardstock Cover" },
        { key: "80t", label: "80 LB Text Gloss" },
        { key: "100t", label: "100 LB Text Gloss" },
        { key: "14pt", label: "14PT Gloss" },
        { key: "18pt", label: "18PT Gloss" }
      ];

      // Which sheet sizes each paper type supports
      const DEFAULT_SHEET_KEYS_FOR_PAPER = {
        "28lb": ["8.5x11", "11x17"],
        "20lb": ["8.5x11", "11x17"],
        "80c": ["8.5x11", "11x17"],
        "110c": ["8.5x11", "11x17"],
        "80t": ["8.5x11", "11x17"],
        "100t": ["8.5x11", "11x17"],
        "14pt": ["12x18"],
        "18pt": ["12x18"]
      };

      // Paper barcodes (used on the Print Order Sheet)
      // Key format: "<Paper Label>|<Sheet Size>" where Sheet Size uses x (e.g. 8.5x11)
      const PAPER_BARCODE_MAP = {
        "14PT Gloss|12x18": "113072",
        "18PT Gloss|12x18": "39307",
        "80 LB Text Gloss|8.5x11": "113784",
        "80 LB Text Gloss|11x17": "113782",
        "100 LB Text Gloss|8.5x11": "113031",
        "100 LB Text Gloss|11x17": "113028",
        "80 LB Cardstock Cover|8.5x11": "36448",
        "80 LB Cardstock Cover|11x17": "36404",
        "110 LB Cardstock Cover|8.5x11": "36452",
        "110 LB Cardstock Cover|11x17": "36401",
        "28 LB Paper|8.5x11": "113659",
        "28 LB Paper|11x17": "113045",
        "20 LB Paper|8.5x11": "110779",
        "20 LB Paper|11x17": "110781"
      };

      const normalizeSheetKey = (w, h) => {
        const nw = Number(w);
        const nh = Number(h);
        if (!isFinite(nw) || !isFinite(nh)) return '';
        return `${nw}x${nh}`;
      };

      const getPaperBarcode = (paperLabel, sheetW, sheetH) => {
        const key = `${String(paperLabel || '').trim()}|${normalizeSheetKey(sheetW, sheetH)}`;
        return PAPER_BARCODE_MAP[key] || null;
      };

      const makeBarcodeDataURL = (value) => {
        try {
          if (!value) return null;
          if (!window.JsBarcode) return null;
          const canvas = document.createElement('canvas');
          // A bit wider for readability; jsPDF will scale it down.
          canvas.width = 900;
          canvas.height = 180;
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);

          window.JsBarcode(canvas, String(value), {
            format: 'CODE128',
            displayValue: true,
            background: '#ffffff',
            lineColor: '#111827',
            margin: 8,
            height: 80,
            fontSize: 22,
            textMargin: 6
          });
          return canvas.toDataURL('image/png', 1.0);
        } catch (e) {
          console.warn('Barcode render failed:', e);
          return null;
        }
      };

      // Large-format paper types: keys MUST match pricing.json
      const DEFAULT_LF_PAPER_TYPES = [
        { key: "hp_super_matte", label: "HP Super Heavyweight Plus Matte Paper" },
        { key: "hp_gloss_photo", label: "HP Universal Instant-dry Gloss Photo Paper" },
        { key: "plain_20lb", label: "20lb Plain Bond Paper" },
        { key: "lexjet_46_bond", label: "LexJet #46 Bright White Bond Paper" },
        { key: "lexjet_thrifty_banner", label: "LexJet TOUGHcoat ThriftyBanner" },
        { key: "lexjet_polypro", label: "LexJet TOUGHcoat Matte Polypropylene v2" },
        { key: "fredrix_canvas", label: "Fredrix 777VWR Vivid Matte Canvas" },
        { key: "hp_adhesive_polypro", label: "HP Everyday Adhesive Matte Polypropylene" },
        { key: "hp_translucent_bond", label: "HP Translucent Bond Paper" }
      ];

      // Blueprint (large format - fixed sizes, 20lb plain bond only)
      const BLUEPRINT_SIZES = [
        { key: "11x17", w: 11, h: 17, label: "11×17" },
        { key: "12x18", w: 12, h: 18, label: "12×18" },
        { key: "17x22", w: 17, h: 22, label: "17×22" },
        { key: "18x24", w: 18, h: 24, label: "18×24" },
        { key: "22x34", w: 22, h: 34, label: "22×34" },
        { key: "24x36", w: 24, h: 36, label: "24×36" },
        { key: "30x42", w: 30, h: 42, label: "30×42" },
        { key: "34x44", w: 34, h: 44, label: "34×44" },
        { key: "36x48", w: 36, h: 48, label: "36×48" }
      ];

      // Defaults based on the uploaded blueprint pricing sheet:
      // - price is configured as "price per sq ft" (PSF)
      // - quantity tiers are per SIZE (sheet count), editable in Admin
      const buildInitialBlueprintPricing = () => {
        const psfDefaults = [1.13, 0.56, 0.48, 0.41];
        const sizeTierMax = {
          "11x17": [50, 150, 400, null],
          "12x18": [50, 150, 400, null],
          "17x22": [33, 100, 266, null],
          "18x24": [33, 100, 266, null],
          "22x34": [16, 50, 133, null],
          "24x36": [16, 50, 133, null],
          "30x42": [11, 33, 88, null],
          "34x44": [9, 27, 72, null],
          "36x48": [8, 25, 66, null]
        };

        const bp = {};
        BLUEPRINT_SIZES.forEach((s) => {
          const maxes = sizeTierMax[s.key] || [50, 150, 400, null];
          bp[s.key] = {
            tiers: [
              { maxQty: maxes[0], psf: psfDefaults[0] },
              { maxQty: maxes[1], psf: psfDefaults[1] },
              { maxQty: maxes[2], psf: psfDefaults[2] },
              { maxQty: maxes[3], psf: psfDefaults[3] }
            ]
          };
        });
        return bp;
      };

      // localStorage keys
      const LS_PRICING_KEY = "printcalc_sheet_pricing_v1";
      const LS_LF_PRICING_KEY = "printcalc_lf_pricing_v1";
      const LS_QTY_DISCOUNTS_KEY = "printcalc_qty_discounts_v1";
      const LS_LF_QTY_DISCOUNTS_KEY = "printcalc_lf_qty_discounts_v1";
      const LS_BACK_FACTOR_KEY = "printcalc_back_factor_v1";
      const LS_LF_ADDONS_KEY = "printcalc_lf_addons_v1";
      const LS_MARKUP_PER_PAPER_KEY = "printcalc_markup_per_paper_v1";
      const LS_LF_MARKUP_PER_PAPER_KEY = "printcalc_lf_markup_per_paper_v1";
      const LS_BP_PRICING_KEY = "printcalc_blueprint_pricing_v1";
const LS_PAPER_TYPES_KEY = "printcalc_paper_types_v1";
const LS_SHEET_KEYS_FOR_PAPER_KEY = "printcalc_sheet_keys_for_paper_v1";
const LS_LF_PAPER_TYPES_KEY = "printcalc_lf_paper_types_v1";

      // ---------- HELPERS ----------

      const inchesToPx = (inches) => Math.round(inches * DPI);
      // Mobile/tablet canvases can fail with very large pixel dimensions.
      // Use a smaller DPI + clamp for large-format/blueprint PREVIEWS.
      const PREVIEW_DPI = 60;
      const clampCanvasPx = (wPx, hPx, maxDim = 3000) => {
        const hardMax = 4096; // common iOS max canvas dimension
        const maxAllowed = Math.min(maxDim, hardMax);
        const scale = Math.min(1, maxAllowed / Math.max(1, wPx, hPx));
        return { w: Math.max(1, Math.floor(wPx * scale)), h: Math.max(1, Math.floor(hPx * scale)), scale };
      };
      const inchesToPreviewPx = (inches) => Math.round(inches * PREVIEW_DPI);

const safeParseJson = (raw, fallback) => {
  try {
    const v = JSON.parse(raw);
    return v ?? fallback;
  } catch {
    return fallback;
  }
};

const sanitizeKey = (s) =>
  String(s || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "") || "paper";

const uniqueKey = (base, existingKeys) => {
  let k = sanitizeKey(base);
  if (!existingKeys.has(k)) return k;
  let i = 2;
  while (existingKeys.has(`${k}_${i}`)) i++;
  return `${k}_${i}`;
};

const loadPaperTypes = () => {
  const raw = window.localStorage.getItem(LS_PAPER_TYPES_KEY);
  const loaded = raw ? safeParseJson(raw, null) : null;
  if (Array.isArray(loaded) && loaded.length) return loaded;
  return DEFAULT_PAPER_TYPES;
};

const loadSheetKeysForPaper = (paperTypes) => {
  const raw = window.localStorage.getItem(LS_SHEET_KEYS_FOR_PAPER_KEY);
  const loaded = raw ? safeParseJson(raw, null) : null;
  if (loaded && typeof loaded === "object") return loaded;
  // default mapping based on the bundled defaults
  const map = {};
  (paperTypes || DEFAULT_PAPER_TYPES).forEach((pt) => {
    map[pt.key] = DEFAULT_SHEET_KEYS_FOR_PAPER[pt.key] || ["8.5x11"];
  });
  return map;
};

const loadLfPaperTypes = () => {
  const raw = window.localStorage.getItem(LS_LF_PAPER_TYPES_KEY);
  const loaded = raw ? safeParseJson(raw, null) : null;
  if (Array.isArray(loaded) && loaded.length) return loaded;
  return DEFAULT_LF_PAPER_TYPES;
};

      // Sheet pricing internal shape: baseCostColor/baseCostBW + priceColor/priceBW
const buildInitialPricingFrom = (paperTypes, sheetKeysForPaper) => {
  const pricing = {};
  (paperTypes || []).forEach((pt) => {
    pricing[pt.key] = {};
    (sheetKeysForPaper?.[pt.key] || []).forEach((sheetKey) => {
      pricing[pt.key][sheetKey] = {
        baseCostColor: 0,
        baseCostBW: 0,
        priceColor: 0,
        priceBW: 0
      };
    });
  });
  return pricing;
};

const buildInitialPricing = () =>
  buildInitialPricingFrom(DEFAULT_PAPER_TYPES, DEFAULT_SHEET_KEYS_FOR_PAPER);

      const buildInitialLfPricingFrom = (lfPaperTypes) => {
  const lf = {};
  (lfPaperTypes || []).forEach((pt) => {
    lf[pt.key] = {
      baseCostColor: 0, // per sq ft
      baseCostBW: 0, // per sq ft
      priceColor: 0,
      priceBW: 0
    };
  });
  return lf;
};

const buildInitialLfPricing = () =>
  buildInitialLfPricingFrom(DEFAULT_LF_PAPER_TYPES);

      // normalizeEntry: support old shapes and pricing.json shape
      const normalizeEntry = (entry = {}) => {
        const paperCost = Number(entry.paperCost) || 0;
        const colorClickCost = Number(entry.colorClickCost) || 0;
        const bwClickCost = Number(entry.bwClickCost) || 0;

        const fromOldColor = paperCost + colorClickCost;
        const fromOldBW = paperCost + bwClickCost;

        const baseCostColor =
          entry.baseCostColor != null
            ? Number(entry.baseCostColor) || 0
            : fromOldColor;
        const baseCostBW =
          entry.baseCostBW != null ? Number(entry.baseCostBW) || 0 : fromOldBW;

        return {
          baseCostColor,
          baseCostBW,
          priceColor: Number(entry.priceColor) || 0,
          priceBW: Number(entry.priceBW) || 0
        };
      };

      // Simple helper: how many prints per sheet (no bleed here; used for sheet count)
      const computePrintsPerSheet = (sheetWIn, sheetHIn, printWIn, printHIn) => {
        if (printWIn <= 0 || printHIn <= 0) return 1;

        const margin = MARGIN_IN;
        const spacing = SPACING_IN;

        const innerW = sheetWIn - 2 * margin;
        const innerH = sheetHIn - 2 * margin;
        if (innerW <= 0 || innerH <= 0) return 1;

        const cols = Math.max(
          1,
          Math.floor((innerW + spacing) / (printWIn + spacing))
        );
        const rows = Math.max(
          1,
          Math.floor((innerH + spacing) / (printHIn + spacing))
        );
        return cols * rows || 1;
      };


// Returns grid fit details (cols/rows/count) for a given orientation
const computeGridFit = (sheetWIn, sheetHIn, printWIn, printHIn) => {
  if (printWIn <= 0 || printHIn <= 0) return { cols: 1, rows: 1, count: 1 };

  const margin = MARGIN_IN;
  const spacing = SPACING_IN;

  const innerW = sheetWIn - 2 * margin;
  const innerH = sheetHIn - 2 * margin;
  if (innerW <= 0 || innerH <= 0) return { cols: 1, rows: 1, count: 1 };

  const cols = Math.max(
    1,
    Math.floor((innerW + spacing) / (printWIn + spacing))
  );
  const rows = Math.max(
    1,
    Math.floor((innerH + spacing) / (printHIn + spacing))
  );
  return { cols, rows, count: Math.max(1, cols * rows) };
};

// Best-fit imposition: considers rotating the SHEET and/or rotating the PRINT to maximize prints/sheet
// Example: 5x7 on 8.5x11 -> portrait fits 1, landscape fits 2
const computeBestImposition = (sheetWIn, sheetHIn, printWIn, printHIn) => {
  const sheetOpts = [
    { w: sheetWIn, h: sheetHIn, sheetOrientation: "portrait" },
    { w: sheetHIn, h: sheetWIn, sheetOrientation: "landscape" }
  ];

  const printOpts = [
    { w: printWIn, h: printHIn, printRotated: false },
    { w: printHIn, h: printWIn, printRotated: true }
  ];

  let best = null;

  sheetOpts.forEach((so) => {
    printOpts.forEach((po) => {
      const fit = computeGridFit(so.w, so.h, po.w, po.h);
      const candidate = {
        ...fit,
        sheetOrientation: so.sheetOrientation,
        printRotated: po.printRotated
      };

      if (!best) {
        best = candidate;
        return;
      }

      // Prefer higher count. If tie: prefer not rotating the print. If still tie: prefer portrait sheet.
      if (candidate.count > best.count) best = candidate;
      else if (candidate.count === best.count) {
        if (best.printRotated && !candidate.printRotated) best = candidate;
        else if (candidate.printRotated === best.printRotated) {
          if (best.sheetOrientation === "landscape" && candidate.sheetOrientation === "portrait")
            best = candidate;
        }
      }
    });
  });

  return best || { cols: 1, rows: 1, count: 1, sheetOrientation: "portrait", printRotated: false };
};


      // ---------- MAIN APP ----------

      
      // Mobile numeric accessory bar (improves number entry on phones)
      function MobileNumberBar({ open, onDone, onClear, onNudge }) {
        if (!open) return null;
        return (
          <div className="fixed inset-x-0 bottom-0 z-[9999] sm:hidden">
            <div className="mx-auto max-w-md px-3 pb-3">
              <div className="rounded-2xl border border-white/10 bg-slate-950/80 backdrop-blur shadow-xl">
                <div className="flex items-center justify-between gap-2 p-2">
                  <div className="flex items-center gap-2">
                    <button
                      className="h-11 px-4 rounded-xl bg-white/10 text-white font-medium active:scale-[0.98]"
                      onClick={() => onNudge(-1)}
                      type="button"
                    >
                      −
                    </button>
                    <button
                      className="h-11 px-4 rounded-xl bg-white/10 text-white font-medium active:scale-[0.98]"
                      onClick={() => onNudge(+1)}
                      type="button"
                    >
                      +
                    </button>
                    <button
                      className="h-11 px-4 rounded-xl bg-white/10 text-white font-medium active:scale-[0.98]"
                      onClick={onClear}
                      type="button"
                    >
                      Clear
                    </button>
                  </div>
                  <button
                    className="h-11 px-5 rounded-xl bg-indigo-500/90 text-white font-semibold shadow active:scale-[0.98]"
                    onClick={onDone}
                    type="button"
                  >
                    Done
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      }

function PriceCalculatorApp() {
        const [viewMode, setViewMode] = useState("tool"); // 'tool' | 'quote'
        const [layoutPage, setLayoutPage] = useState(() => {
          try { return localStorage.getItem("layoutPage") || "paper"; } catch (e) { return "paper"; }
        });
        useEffect(() => {
          try { localStorage.setItem("layoutPage", layoutPage); } catch (e) {}
        }, [layoutPage]);

        // Mobile: make numeric entry easier (auto-select + accessory bar with Done/Clear/±)
        const [numBarOpen, setNumBarOpen] = useState(false);
        const lastNumericRef = useRef(null);

        useEffect(() => {
          const isMobile = () => window.matchMedia && window.matchMedia("(max-width: 640px)").matches;

          const onFocusIn = (ev) => {
            const el = ev.target;
            if (!(el instanceof HTMLElement)) return;

            const isNumeric =
              el.matches?.('input[type="number"]') ||
              (el.matches?.('input') && (el.getAttribute("inputmode") === "decimal" || el.getAttribute("inputmode") === "numeric"));

            if (!isNumeric) return;

            // Ensure mobile keypad + easier overwrite
            try {
              el.setAttribute("inputmode", "decimal");
              el.setAttribute("enterkeyhint", "done");
              requestAnimationFrame(() => {
                try { el.select?.(); } catch (e) {}
              });
            } catch (e) {}

            lastNumericRef.current = el;
            if (isMobile()) setNumBarOpen(true);
          };

          const onFocusOut = (ev) => {
            const el = ev.target;
            if (lastNumericRef.current === el) {
              setTimeout(() => setNumBarOpen(false), 120);
            }
          };

          document.addEventListener("focusin", onFocusIn);
          document.addEventListener("focusout", onFocusOut);
          return () => {
            document.removeEventListener("focusin", onFocusIn);
            document.removeEventListener("focusout", onFocusOut);
          };
        }, []);

        const blurActive = () => {
          const el = document.activeElement;
          if (el && typeof el.blur === "function") el.blur();
          setNumBarOpen(false);
        };

        const clearActive = () => {
          const el = lastNumericRef.current;
          if (!el) return;
          el.value = "";
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
          requestAnimationFrame(() => {
            try { el.focus(); } catch (e) {}
          });
        };

        const nudgeActive = (delta) => {
          const el = lastNumericRef.current;
          if (!el) return;
          const stepAttr = el.getAttribute("step");
          const step = stepAttr ? Number(stepAttr) : 1;
          const cur = Number(String(el.value || "").replace(",", "."));
          const base = Number.isFinite(cur) ? cur : 0;
          const stepSafe = Number.isFinite(step) ? step : 1;
          const next = base + delta * stepSafe;

          // Preserve decimals based on step
          let out = String(next);
          if (String(stepSafe).includes(".")) {
            const dec = (String(stepSafe).split(".")[1] || "").length;
            out = next.toFixed(Math.min(4, dec || 2));
          } else {
            out = String(Math.round(next));
          }

          el.value = out;
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
          requestAnimationFrame(() => {
            try { el.select?.(); } catch (e) {}
          });
        };

        const [sheetKey, setSheetKey] = useState("8.5x11");
        const [customSize, setCustomSize] = useState({ w: 8.5, h: 11 });
        const [orientation, setOrientation] = useState("portrait");


const [logoReady, setLogoReady] = useState(false);

useEffect(() => {
  (async () => {
    try {
      const res = await fetch(UPS_LOGO_DATA_URL, { cache: "no-store" });
      const blob = await res.blob();
      const dataUrl = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = reject;
        r.readAsDataURL(blob);
      });
      // Ensure PNG/JPG data URL for jsPDF addImage
      if (typeof dataUrl === "string" && dataUrl.startsWith("data:image")) {
        UPS_LOGO_PDF_DATA_URL = dataUrl;
        setLogoReady(true);
      }
    } catch (e) {
      console.warn("Could not load logo for PDF embedding:", e);
      setLogoReady(false);
    }
  })();
}, []);

        const [prints, setPrints] = useState({
          width: 5,
          height: 7,
          quantity: 2
        });

        // Sheet images
        const [frontImage, setFrontImage] = useState(null); // legacy single upload (still supported)
        const [frontFiles, setFrontFiles] = useState([]);   // multi-upload: [{id, file, name, rotation, qty}]
        const [copiesPerFile, setCopiesPerFile] = useState(1); // default qty for NEW uploads (and optional apply-all)
        const [autoQtyFromFiles, setAutoQtyFromFiles] = useState(true);
        const [selectedFrontId, setSelectedFrontId] = useState(null);
        const [frontPreviewPage, setFrontPreviewPage] = useState(0);

        const [backImage, setBackImage] = useState(null);
        const [frontRotation, setFrontRotation] = useState(0);
        const [backRotation, setBackRotation] = useState(0);
        const [showBack, setShowBack] = useState(false);

        const [showGuides, setShowGuides] = useState(true);
        const [showBleed, setShowBleed] = useState(false);
        const [showCutLines, setShowCutLines] = useState(true);

        // Preview UX (UI-only)
        const [frontZoom, setFrontZoom] = useState(1);
        const [backZoom, setBackZoom] = useState(1);
        const [toolsOpen, setToolsOpen] = useState(true);
        const ZOOM_MIN = 0.6, ZOOM_MAX = 2.5;
        const clampZoom = (v) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Number(v) || 1));

        const [previewSide, setPreviewSide] = useState(() => {
          try { return localStorage.getItem("previewSide") || "front"; } catch (e) { return "front"; }
        });
        useEffect(() => { try { localStorage.setItem("previewSide", previewSide); } catch (e) {} }, [previewSide]);

        const [paperTypes, setPaperTypes] = useState(loadPaperTypes);
const [sheetKeysForPaper, setSheetKeysForPaper] = useState(() =>
  loadSheetKeysForPaper(loadPaperTypes())
);

const [paperKey, setPaperKey] = useState(() => {
  const pts = loadPaperTypes();
  return (pts && pts[0] ? pts[0].key : DEFAULT_PAPER_TYPES[0].key);
});
        const [frontColorMode, setFrontColorMode] = useState("color"); // 'color' | 'bw'
        const [backColorMode, setBackColorMode] = useState("bw");

        // Pricing state
        const [pricing, setPricing] = useState(() =>
  buildInitialPricingFrom(
    loadPaperTypes(),
    loadSheetKeysForPaper(loadPaperTypes())
  )
);
const [lfPricing, setLfPricing] = useState(() =>
  buildInitialLfPricingFrom(loadLfPaperTypes())
);

        const [markupPerPaper, setMarkupPerPaper] = useState(() => {
  const init = {};
  const pts = loadPaperTypes();
  (pts || []).forEach((pt) => (init[pt.key] = 0));
  return init;
});
        const [lfMarkupPerPaper, setLfMarkupPerPaper] = useState(() => {
  const init = {};
  const pts = loadLfPaperTypes();
  (pts || []).forEach((pt) => (init[pt.key] = 0));
  return init;
});

        const [quantityDiscounts, setQuantityDiscounts] = useState([
          { minSheets: 0, discountPercent: 0 }
        ]);
        const [lfQuantityDiscounts, setLfQuantityDiscounts] = useState([
          { minSqFt: 0, discountPercent: 0 }
        ]);

        const [backSideFactor, setBackSideFactor] = useState(0.5);

        const [lfAddonPricing, setLfAddonPricing] = useState({
          grommets: 0,
          foamCore: 0,
          coroSign: 0
        });

        // Blueprint state (large format - fixed sizes, 20lb plain bond only)
        const [bpPricing, setBpPricing] = useState(
          buildInitialBlueprintPricing
        );
        const [bpSizeKey, setBpSizeKey] = useState("24x36");
        const [bpQty, setBpQty] = useState(1);
        const [bpMaintainProp, setBpMaintainProp] = useState(true);
        const [bpImage, setBpImage] = useState(null);
        const [bpRotation, setBpRotation] = useState(0);

        // Admin toggles
        const [isAdmin, setIsAdmin] = useState(false);
        const [showAdmin, setShowAdmin] = useState(false);

        // Bottom tab indicator (mobile)
        const tabbarRef = useRef(null);
        const dragFrontIdRef = useRef(null);
        const dragOverFrontIdRef = useRef(null);
        const [tabIndicator, setTabIndicator] = useState({ left: 8, width: 88 });
        const activeTabKey = showAdmin ? "admin" : viewMode; // tool | quote | admin

        const updateTabIndicator = () => {
          try {
            const wrap = tabbarRef.current;
            if (!wrap) return;
            const btn = wrap.querySelector(`[data-tab="${activeTabKey}"]`);
            if (!btn) return;
            const rWrap = wrap.getBoundingClientRect();
            const rBtn = btn.getBoundingClientRect();
            setTabIndicator({
              left: Math.round(rBtn.left - rWrap.left) + 8,
              width: Math.round(rBtn.width) - 16
            });
          } catch (e) {}
        };

        useEffect(() => { updateTabIndicator(); }, [activeTabKey]);
        useEffect(() => {
          const onR = () => updateTabIndicator();
          window.addEventListener("resize", onR);
          return () => window.removeEventListener("resize", onR);
        }, []);

        

        // ---- UI persistence (mobile-friendly: remembers last view + quote inputs) ----
        const LS_UI_KEY = "printcalc_ui_v1";

        useEffect(() => {
          try {
            const raw = localStorage.getItem(LS_UI_KEY);
            if (!raw) return;
            const ui = JSON.parse(raw);

            if (ui?.viewMode === "tool" || ui?.viewMode === "quote") {
              setViewMode(ui.viewMode);
            }

            // Quote preferences
            if (typeof ui?.quotePaperKey === "string") setQuotePaperKey(ui.quotePaperKey);
if (ui?.quoteFrontColorMode === "color" || ui?.quoteFrontColorMode === "bw") {
              setQuoteFrontColorMode(ui.quoteFrontColorMode);
            }
            if (ui?.quoteBackColorMode === "color" || ui?.quoteBackColorMode === "bw") {
              setQuoteBackColorMode(ui.quoteBackColorMode);
            }
            if (Number.isFinite(ui?.quoteQty)) setQuoteQty(ui.quoteQty);

            // Don't persist admin auth (security). Only remember whether admin panel was open *while* admin is authenticated.
          } catch (e) {
            // ignore
          }
        }, []);

        useEffect(() => {
          try {
            const ui = {
              viewMode,
              quotePaperKey,
quoteFrontColorMode,
              quoteBackColorMode,
              quoteQty,
            };
            localStorage.setItem(LS_UI_KEY, JSON.stringify(ui));
          } catch (e) {
            // ignore
          }
        }, [viewMode, quotePaperKey, quoteFrontColorMode, quoteBackColorMode, quoteQty]);

// Admin: add/remove paper types
        const [newPaperLabel, setNewPaperLabel] = useState("");
        const [newPaperKey, setNewPaperKey] = useState("");
        const [newPaperSheets, setNewPaperSheets] = useState({
          "8.5x11": true,
          "11x17": true,
          "12x18": false
        });
        const [newLfLabel, setNewLfLabel] = useState("");
        const [newLfKey, setNewLfKey] = useState("");


        // Quick quote state
        const [quoteWidth, setQuoteWidth] = useState(5);
        const [quoteHeight, setQuoteHeight] = useState(7);
        const [quoteQty, setQuoteQty] = useState(500);
        const [quoteBackEnabled, setQuoteBackEnabled] = useState(false);
        const [quoteBackColorMode, setQuoteBackColorMode] = useState("bw");
        const [quoteFrontColorMode, setQuoteFrontColorMode] =
          useState("color");
        const [quoteDocPages, setQuoteDocPages] = useState(0);
        const [quoteDocDuplex, setQuoteDocDuplex] = useState(true);

        // Quick Quote filters
        const [quotePaperKey, setQuotePaperKey] = useState(() => paperKey);
        const [quoteShowAllPapers, setQuoteShowAllPapers] = useState(false);

        // Large-format state (simple version)
        const [lfWidth, setLfWidth] = useState(24); // in
        const [lfHeight, setLfHeight] = useState(36); // in
        const [lfPaperTypes, setLfPaperTypes] = useState(loadLfPaperTypes);
const [lfPaperKey, setLfPaperKey] = useState(() => {
  const pts = loadLfPaperTypes();
  return (pts && pts[0] ? pts[0].key : DEFAULT_LF_PAPER_TYPES[0].key);
});
        const [lfColorMode, setLfColorMode] = useState("color");
        const [lfMaintainProp, setLfMaintainProp] = useState(true);
        const [lfImage, setLfImage] = useState(null);
        const [lfRotation, setLfRotation] = useState(0);
        const [lfGrommets, setLfGrommets] = useState(false);
        const [lfFoamCore, setLfFoamCore] = useState(false);
        const [lfCoroSign, setLfCoroSign] = useState(false);

        // Canvases
        const frontRef = useRef(null);
        const frontPlacementsRef = useRef([]);
        const backRef = useRef(null);
        const lfRef = useRef(null);
        const bpRef = useRef(null);
        // If enabled, automatically set Quantity = sum(per-file qty)
        useEffect(() => {
          if (!autoQtyFromFiles) return;
          const total = (frontFiles || []).reduce((sum, it) => {
            const q = Math.max(0, Number(it?.qty) || 0);
            return sum + q;
          }, 0);
          if (!total) return;
          setPrints((p) => ({ ...p, quantity: Math.max(1, total) }));
        }, [frontFiles, autoQtyFromFiles]);

// -------- LOAD FROM localStorage + pricing.json --------

        useEffect(() => {
          (async () => {
            try {
              // 1) localStorage first
              const lsPricing = window.localStorage.getItem(LS_PRICING_KEY);
              const lsLfPricing = window.localStorage.getItem(
                LS_LF_PRICING_KEY
              );
              const lsQty = window.localStorage.getItem(LS_QTY_DISCOUNTS_KEY);
              const lsLfQty = window.localStorage.getItem(
                LS_LF_QTY_DISCOUNTS_KEY
              );
              const lsBack = window.localStorage.getItem(LS_BACK_FACTOR_KEY);
              const lsLfAddons = window.localStorage.getItem(
                LS_LF_ADDONS_KEY
              );
              const lsMarkup = window.localStorage.getItem(
                LS_MARKUP_PER_PAPER_KEY
              );
              const lsLfMarkup = window.localStorage.getItem(
                LS_LF_MARKUP_PER_PAPER_KEY
              );
              const lsBp = window.localStorage.getItem(
                LS_BP_PRICING_KEY
              );

if (lsPricing) {
  const parsed = JSON.parse(lsPricing);
  setPricing(parsed);

  // If pricing has paper keys not in our list, merge them in
  const existing = new Set((paperTypes || []).map((p) => p.key));
  const extras = Object.keys(parsed || {})
    .filter((k) => !existing.has(k))
    .map((k) => ({ key: k, label: k }));
  if (extras.length) {
    const merged = [...(paperTypes || []), ...extras];
    setPaperTypes(merged);
    window.localStorage.setItem(
      LS_PAPER_TYPES_KEY,
      JSON.stringify(merged)
    );
  }

  // infer sizes per paper if missing
  setSheetKeysForPaper((prev) => {
    const next = { ...(prev || {}) };
    Object.keys(parsed || {}).forEach((pk) => {
      if (!next[pk] || next[pk].length === 0) {
        next[pk] = Object.keys(parsed[pk] || {});
      }
    });
    window.localStorage.setItem(
      LS_SHEET_KEYS_FOR_PAPER_KEY,
      JSON.stringify(next)
    );
    return next;
  });
}

if (lsLfPricing) {
  const parsedLf = JSON.parse(lsLfPricing);
  setLfPricing(parsedLf);

  const existing = new Set((lfPaperTypes || []).map((p) => p.key));
  const extras = Object.keys(parsedLf || {})
    .filter((k) => !existing.has(k))
    .map((k) => ({ key: k, label: k }));
  if (extras.length) {
    const merged = [...(lfPaperTypes || []), ...extras];
    setLfPaperTypes(merged);
    window.localStorage.setItem(
      LS_LF_PAPER_TYPES_KEY,
      JSON.stringify(merged)
    );
  }
}
              if (lsQty) setQuantityDiscounts(JSON.parse(lsQty));
              if (lsLfQty) setLfQuantityDiscounts(JSON.parse(lsLfQty));
              if (lsBack) setBackSideFactor(parseFloat(lsBack) || 0.5);
              if (lsLfAddons) setLfAddonPricing(JSON.parse(lsLfAddons));
              if (lsMarkup)
                setMarkupPerPaper((prev) => ({
                  ...prev,
                  ...JSON.parse(lsMarkup)
                }));
              if (lsLfMarkup)
                setLfMarkupPerPaper((prev) => ({
                  ...prev,
                  ...JSON.parse(lsLfMarkup)
                }));
              if (lsBp) setBpPricing(JSON.parse(lsBp));

              // 2) pricing.json from site root
              const resp = await fetch("pricing.json", {
                cache: "no-store"
              });
              if (resp.ok) {
                const json = await resp.json();

// Optional paper type lists (so you can add/remove types)
if (Array.isArray(json.paperTypes) && json.paperTypes.length) {
  setPaperTypes(json.paperTypes);
  window.localStorage.setItem(
    LS_PAPER_TYPES_KEY,
    JSON.stringify(json.paperTypes)
  );
} else if (json.sheetPricing && typeof json.sheetPricing === "object") {
  // If pricing has paper keys not in our list, merge them in
  const existing = new Set((paperTypes || []).map((p) => p.key));
  const extras = Object.keys(json.sheetPricing)
    .filter((k) => !existing.has(k))
    .map((k) => ({ key: k, label: k }));
  if (extras.length) {
    const merged = [...(paperTypes || []), ...extras];
    setPaperTypes(merged);
    window.localStorage.setItem(
      LS_PAPER_TYPES_KEY,
      JSON.stringify(merged)
    );
  }
}

if (json.sheetKeysForPaper && typeof json.sheetKeysForPaper === "object") {
  setSheetKeysForPaper(json.sheetKeysForPaper);
  window.localStorage.setItem(
    LS_SHEET_KEYS_FOR_PAPER_KEY,
    JSON.stringify(json.sheetKeysForPaper)
  );
} else if (json.sheetPricing && typeof json.sheetPricing === "object") {
  // infer size keys per paper from sheetPricing
  const inferred = {};
  Object.keys(json.sheetPricing).forEach((pk) => {
    inferred[pk] = Object.keys(json.sheetPricing[pk] || {});
  });
  setSheetKeysForPaper((prev) => {
    const next = { ...(prev || {}) };
    Object.keys(inferred).forEach((pk) => {
      if (!next[pk] || next[pk].length === 0) next[pk] = inferred[pk];
    });
    window.localStorage.setItem(
      LS_SHEET_KEYS_FOR_PAPER_KEY,
      JSON.stringify(next)
    );
    return next;
  });
}

if (Array.isArray(json.lfPaperTypes) && json.lfPaperTypes.length) {
  setLfPaperTypes(json.lfPaperTypes);
  window.localStorage.setItem(
    LS_LF_PAPER_TYPES_KEY,
    JSON.stringify(json.lfPaperTypes)
  );
} else if (json.lfPricing && typeof json.lfPricing === "object") {
  const existing = new Set((lfPaperTypes || []).map((p) => p.key));
  const extras = Object.keys(json.lfPricing)
    .filter((k) => !existing.has(k))
    .map((k) => ({ key: k, label: k }));
  if (extras.length) {
    const merged = [...(lfPaperTypes || []), ...extras];
    setLfPaperTypes(merged);
    window.localStorage.setItem(
      LS_LF_PAPER_TYPES_KEY,
      JSON.stringify(merged)
    );
  }
}

                // Sheet pricing
                if (json.sheetPricing) {
                  setPricing(json.sheetPricing);
                  window.localStorage.setItem(
                    LS_PRICING_KEY,
                    JSON.stringify(json.sheetPricing)
                  );
                }

                // Large format pricing
                if (json.lfPricing) {
                  const mergedLf = buildInitialLfPricingFrom(
                    Array.isArray(json.lfPaperTypes) && json.lfPaperTypes.length
                      ? json.lfPaperTypes
                      : lfPaperTypes
                  );
                  for (const k in json.lfPricing) {
                    if (mergedLf[k]) {
                      mergedLf[k] = { ...mergedLf[k], ...json.lfPricing[k] };
                    } else {
                      mergedLf[k] = json.lfPricing[k];
                    }
                  }
                  setLfPricing(mergedLf);
                  window.localStorage.setItem(
                    LS_LF_PRICING_KEY,
                    JSON.stringify(mergedLf)
                  );
                }

                // Sheet quantity discounts
                if (json.quantityDiscounts) {
                  setQuantityDiscounts(json.quantityDiscounts);
                  window.localStorage.setItem(
                    LS_QTY_DISCOUNTS_KEY,
                    JSON.stringify(json.quantityDiscounts)
                  );
                } else if (json.sheetQtyDiscounts) {
                  const mapped = json.sheetQtyDiscounts.map((t) => ({
                    minSheets:
                      t.minSheets != null ? t.minSheets : t.minQty || 0,
                    discountPercent: Number(t.discountPercent) || 0
                  }));
                  setQuantityDiscounts(mapped);
                  window.localStorage.setItem(
                    LS_QTY_DISCOUNTS_KEY,
                    JSON.stringify(mapped)
                  );
                }

                // LF quantity discounts
                if (json.lfQuantityDiscounts) {
                  setLfQuantityDiscounts(json.lfQuantityDiscounts);
                  window.localStorage.setItem(
                    LS_LF_QTY_DISCOUNTS_KEY,
                    JSON.stringify(json.lfQuantityDiscounts)
                  );
                } else if (json.lfQtyDiscounts) {
                  const mappedLf = json.lfQtyDiscounts.map((t) => ({
                    minSqFt:
                      t.minSqFt != null ? t.minSqFt : t.minQty || 0,
                    discountPercent: Number(t.discountPercent) || 0
                  }));
                  setLfQuantityDiscounts(mappedLf);
                  window.localStorage.setItem(
                    LS_LF_QTY_DISCOUNTS_KEY,
                    JSON.stringify(mappedLf)
                  );
                }

                // Per-paper markup
                if (json.sheetMarkupPerPaper) {
                  setMarkupPerPaper((prev) => ({
                    ...prev,
                    ...json.sheetMarkupPerPaper
                  }));
                  window.localStorage.setItem(
                    LS_MARKUP_PER_PAPER_KEY,
                    JSON.stringify({
                      ...markupPerPaper,
                      ...json.sheetMarkupPerPaper
                    })
                  );
                }
                if (json.lfMarkupPerPaper) {
                  setLfMarkupPerPaper((prev) => ({
                    ...prev,
                    ...json.lfMarkupPerPaper
                  }));
                  window.localStorage.setItem(
                    LS_LF_MARKUP_PER_PAPER_KEY,
                    JSON.stringify({
                      ...lfMarkupPerPaper,
                      ...json.lfMarkupPerPaper
                    })
                  );
                }

                if (typeof json.backSideFactor === "number") {
                  setBackSideFactor(json.backSideFactor);
                  window.localStorage.setItem(
                    LS_BACK_FACTOR_KEY,
                    String(json.backSideFactor)
                  );
                }

                if (json.lfAddonPricing) {
                  setLfAddonPricing(json.lfAddonPricing);
                  window.localStorage.setItem(
                    LS_LF_ADDONS_KEY,
                    JSON.stringify(json.lfAddonPricing)
                  );
                }

                // Blueprint pricing (large format - fixed sizes)
                if (json.blueprintPricing) {
                  setBpPricing(json.blueprintPricing);
                  window.localStorage.setItem(
                    LS_BP_PRICING_KEY,
                    JSON.stringify(json.blueprintPricing)
                  );
                }
              }
            } catch (err) {
              console.error("Error loading pricing.json/localStorage", err);
            }
          })();
        }, []);

        // Autosave key states
        useEffect(() => {
          window.localStorage.setItem(
            LS_PRICING_KEY,
            JSON.stringify(pricing)
          );
        }, [pricing]);

        useEffect(() => {
          window.localStorage.setItem(
            LS_LF_PRICING_KEY,
            JSON.stringify(lfPricing)
          );
        }, [lfPricing]);

        useEffect(() => {
          window.localStorage.setItem(
            LS_QTY_DISCOUNTS_KEY,
            JSON.stringify(quantityDiscounts)
          );
        }, [quantityDiscounts]);

        useEffect(() => {
          window.localStorage.setItem(
            LS_LF_QTY_DISCOUNTS_KEY,
            JSON.stringify(lfQuantityDiscounts)
          );
        }, [lfQuantityDiscounts]);

        useEffect(() => {
          window.localStorage.setItem(
            LS_BACK_FACTOR_KEY,
            String(backSideFactor)
          );
        }, [backSideFactor]);

        useEffect(() => {
          window.localStorage.setItem(
            LS_LF_ADDONS_KEY,
            JSON.stringify(lfAddonPricing)
          );
        }, [lfAddonPricing]);

        useEffect(() => {
          window.localStorage.setItem(
            LS_MARKUP_PER_PAPER_KEY,
            JSON.stringify(markupPerPaper)
          );
        }, [markupPerPaper]);

        useEffect(() => {
          window.localStorage.setItem(
            LS_LF_MARKUP_PER_PAPER_KEY,
            JSON.stringify(lfMarkupPerPaper)
          );
        }, [lfMarkupPerPaper]);

useEffect(() => {
  window.localStorage.setItem(
    LS_PAPER_TYPES_KEY,
    JSON.stringify(paperTypes)
  );
}, [paperTypes]);

useEffect(() => {
  window.localStorage.setItem(
    LS_SHEET_KEYS_FOR_PAPER_KEY,
    JSON.stringify(sheetKeysForPaper)
  );
}, [sheetKeysForPaper]);

useEffect(() => {
  window.localStorage.setItem(
    LS_LF_PAPER_TYPES_KEY,
    JSON.stringify(lfPaperTypes)
  );
}, [lfPaperTypes]);


// Keep markup maps in sync when paper types are added/removed
useEffect(() => {
  setMarkupPerPaper((prev) => {
    const next = { ...(prev || {}) };
    (paperTypes || []).forEach((pt) => {
      if (next[pt.key] == null) next[pt.key] = 0;
    });
    Object.keys(next).forEach((k) => {
      if (!(paperTypes || []).some((p) => p.key === k)) delete next[k];
    });
    return next;
  });
}, [paperTypes]);

useEffect(() => {
  setLfMarkupPerPaper((prev) => {
    const next = { ...(prev || {}) };
    (lfPaperTypes || []).forEach((pt) => {
      if (next[pt.key] == null) next[pt.key] = 0;
    });
    Object.keys(next).forEach((k) => {
      if (!(lfPaperTypes || []).some((p) => p.key === k)) delete next[k];
    });
    return next;
  });
}, [lfPaperTypes]);

        useEffect(() => {
          window.localStorage.setItem(
            LS_BP_PRICING_KEY,
            JSON.stringify(bpPricing)
          );
        }, [bpPricing]);

        // -------- SHEET GEOMETRY --------

        const getSheetInches = () => {
          if (sheetKey === "custom") {
            const w = Math.max(0.1, Number(customSize.w) || 0);
            const h = Math.max(0.1, Number(customSize.h) || 0);
            return [w, h];
          }
          return PRESET_SHEETS[sheetKey];
        };

        const [sheetWIn, sheetHIn] = getSheetInches();
        const orientedWIn =
          orientation === "portrait" ? sheetWIn : sheetHIn;
        const orientedHIn =
          orientation === "portrait" ? sheetHIn : sheetWIn;

        // How many prints per sheet based on print size (no bleed here — for sheet count)
        const printsPerSheet = computePrintsPerSheet(
          orientedWIn,
          orientedHIn,
          prints.width,
          prints.height
        );
        // Effective print quantity (supports per-file quantities when multi-file upload is used)
        const effectivePrintQty = (frontFiles && frontFiles.length)
          ? (frontFiles || []).reduce((sum, it) => sum + Math.max(0, Number(it?.qty) || 0), 0)
          : Math.max(0, Number(prints.quantity) || 0);

        const sheetsNeeded = Math.max(
          1,
          Math.ceil(effectivePrintQty / Math.max(1, printsPerSheet))
        );
        // --- Multi-file preview paging (front) ---
        // When multi-files are used, each file can have its own rotation.
        // Rotation should rotate the *print box* on the sheet (swap W/H) and therefore affects how many fit per sheet.
        // We compute total pages via a simple greedy pack (row-by-row) that supports mixed rotations.
        const frontTotalPrints = effectivePrintQty;

        const frontTotalPages = useMemo(() => {
          if (!(frontFiles && frontFiles.length)) return 1;

          const bleedIn = showBleed ? BLEED_IN : 0;
          const targetWIn = Math.max(0.1, Number(prints.width) || 0) + bleedIn * 2;
          const targetHIn = Math.max(0.1, Number(prints.height) || 0) + bleedIn * 2;
          const innerWIn = orientedWIn - 2 * MARGIN_IN;
          const innerHIn = orientedHIn - 2 * MARGIN_IN;
          if (innerWIn <= 0 || innerHIn <= 0) return 1;

          const placeDims = () => [targetWIn, targetHIn];

          let pageCount = 1;
          let x = 0;
          let y = 0;
          let rowH = 0;

          const newRow = () => {
            y = y + rowH + SPACING_IN;
            x = 0;
            rowH = 0;
          };

          const newPage = () => {
            pageCount += 1;
            x = 0;
            y = 0;
            rowH = 0;
          };

          for (const it of (frontFiles || [])) {
            const q = Math.max(0, Number(it?.qty) || 0);
            const [w, h] = placeDims(it?.rotation);
            for (let i = 0; i < q; i++) {
              const wNeed = w + (x > 0 ? SPACING_IN : 0);
              if (x > 0 && x + wNeed > innerWIn) {
                newRow();
              }
              if (y + h > innerHIn) {
                newPage();
              }
              rowH = Math.max(rowH, h);
              x = x + wNeed;
            }
          }

          return Math.max(1, pageCount);
        }, [frontFiles, prints.width, prints.height, orientedWIn, orientedHIn, showBleed]);

        const frontSlotInfo = useMemo(() => {
          const bleedIn = showBleed ? BLEED_IN : 0;
          const targetWIn = Math.max(0.1, Number(prints.width) || 0) + bleedIn * 2;
          const targetHIn = Math.max(0.1, Number(prints.height) || 0) + bleedIn * 2;
          return computeGridFit(orientedWIn, orientedHIn, targetWIn, targetHIn);
        }, [orientedWIn, orientedHIn, prints.width, prints.height, showBleed]);

        // Clamp page index when totals change
        useEffect(() => {
          setFrontPreviewPage((p) => {
            const maxP = Math.max(0, frontTotalPages - 1);
            if (p < 0) return 0;
            if (p > maxP) return maxP;
            return p;
          });
        }, [frontTotalPages]);

        // Reset to page 1 when layout inputs change significantly
        useEffect(() => {
          setFrontPreviewPage(0);
        }, [sheetKey, orientation, customSize?.w, customSize?.h, prints.width, prints.height, showBleed, frontFiles.length]);

        const currentPaper =
          paperTypes.find((pt) => pt.key === paperKey) || paperTypes[0];
        const comboAllowed = (sheetKeysForPaper[paperKey] || []).includes(
          sheetKey
        );

        const selectedPricingRaw =
          (pricing[paperKey] || {})[sheetKey] || {};
        const selectedPricing = normalizeEntry(selectedPricingRaw);
        const baseColorCost = selectedPricing.baseCostColor;
        const baseBWCost = selectedPricing.baseCostBW;

        const effectiveFrontPerSheet =
          frontColorMode === "color"
            ? selectedPricing.priceColor
            : selectedPricing.priceBW;

        const effectiveBackPerSheet =
          showBack && backSideFactor > 0
            ? (backColorMode === "color"
                ? selectedPricing.priceColor
                : selectedPricing.priceBW) * backSideFactor
            : 0;

        const perSheetTotal = effectiveFrontPerSheet + effectiveBackPerSheet;

        // Apply quantity discount
        const getSheetDiscountFactor = (sheetCount) => {
          let best = 0;
          quantityDiscounts.forEach((t) => {
            if (sheetCount >= (t.minSheets || 0)) {
              best = Math.max(best, Number(t.discountPercent) || 0);
            }
          });
          return 1 - best / 100;
        };

        const discountFactor = getSheetDiscountFactor(sheetsNeeded);
        const totalPrice = perSheetTotal * sheetsNeeded * discountFactor;

        // -------- DRAW FRONT/BACK CANVAS --------
        const drawSheet = (canvas, imageInput, rotationDeg, pageIndex = 0, placementsRef = null) => {
          return new Promise((resolve) => {
            if (!canvas) return resolve();
            const ctx = canvas.getContext("2d");

            const wPx = inchesToPx(orientedWIn);
            const hPx = inchesToPx(orientedHIn);
            canvas.width = wPx;
            canvas.height = hPx;

            ctx.fillStyle = "#ffffff";
            ctx.fillRect(0, 0, wPx, hPx);

            // Normalize inputs:
            // - Array input: either [{id,file,name,rotation,qty}] or File[]
            // - Single input: File
            let items = [];
            if (Array.isArray(imageInput)) {
              items = (imageInput || []).filter(Boolean).map((it, idx) => {
                if (it && it.file) {
                  return {
                    id: String(it.id ?? `f_${idx}`),
                    file: it.file,
                    name: it.name ?? it.file?.name ?? `File ${idx + 1}`,
                    rotation: Number(it.rotation) || 0,
                    qty: Math.max(0, Number(it.qty) || 0)
                  };
                }
                return {
                  id: `legacy_${idx}`,
                  file: it,
                  name: it?.name ?? `File ${idx + 1}`,
                  rotation: 0,
                  qty: 0
                };
              });
            } else if (imageInput) {
              items = [{
                id: "single",
                file: imageInput,
                name: imageInput?.name ?? "Image",
                rotation: 0,
                qty: Math.max(0, Number(prints.quantity) || 0)
              }];
            }

            if (!items.length) {
              if (placementsRef) placementsRef.current = [];
              return resolve();
            }

            const marginPx = inchesToPx(MARGIN_IN);
            const spacingPx = inchesToPx(SPACING_IN);
            const bleedPx = showBleed ? inchesToPx(BLEED_IN) : 0;

            const baseTargetWPx = inchesToPx(prints.width) + bleedPx * 2;
            const baseTargetHPx = inchesToPx(prints.height) + bleedPx * 2;

            const innerW = wPx - 2 * marginPx;
            const innerH = hPx - 2 * marginPx;
            if (innerW <= 0 || innerH <= 0) {
              if (placementsRef) placementsRef.current = [];
              return resolve();
            }

            const totalPrintsFromItems = (items || []).reduce((s, it) => s + Math.max(0, Number(it.qty) || 0), 0);
            const totalPrints = totalPrintsFromItems > 0 ? totalPrintsFromItems : Math.max(0, Number(prints.quantity) || 0);
            if (!totalPrints) {
              if (placementsRef) placementsRef.current = [];
              return resolve();
            }

            const loadImage = (file) =>
              new Promise((resolveImg) => {
                try {
                  const img = new Image();
                  const url = URL.createObjectURL(file);
                  img.onload = () => resolveImg({ img, url });
                  img.onerror = () => {
                    try { URL.revokeObjectURL(url); } catch {}
                    resolveImg(null);
                  };
                  img.src = url;
                } catch {
                  resolveImg(null);
                }
              });

            Promise.all(items.map((it) => loadImage(it.file))).then((loaded) => {
              const loadedMap = new Map();
              (loaded || []).forEach((res, idx) => {
                if (!res) return;
                loadedMap.set(items[idx].id, { ...res, item: items[idx] });
              });

              if (!loadedMap.size) {
                if (placementsRef) placementsRef.current = [];
                return resolve();
              }

              const normRot = (deg) => {
                const r = ((Number(deg) || 0) % 360 + 360) % 360;
                return r;
              };
              const isSwap = (deg) => {
                const r = normRot(deg);
                return r === 90 || r === 270;
              };

              // Build a "virtual" sequence of print instances in order (A... then B..., based on per-file qty).
              const sequence = [];
              if (totalPrintsFromItems > 0) {
                for (const it of items) {
                  const q = Math.max(0, Number(it.qty) || 0);
                  for (let i = 0; i < q; i++) sequence.push(it);
                }
              } else {
                // Fallback: repeat items round-robin using prints.quantity
                for (let i = 0; i < totalPrints; i++) sequence.push(items[i % items.length]);
              }

              // Pack placements row-by-row. Rotation does NOT affect placement size; it only rotates the artwork inside the fixed target box.
              // We only keep placements for the requested pageIndex, but we still simulate pagination.
              let page = 0;
              let x = 0;
              let y = 0;
              let rowH = 0;

              const pagePlacements = [];

              const pushPlacement = (it, x0, y0, boxW, boxH) => {
                pagePlacements.push({ x: x0, y: y0, w: boxW, h: boxH, fileId: it.id });
              };

              const newRow = () => {
                y = y + rowH + spacingPx;
                x = 0;
                rowH = 0;
              };
              const newPage = () => {
                page += 1;
                x = 0;
                y = 0;
                rowH = 0;
              };

              for (let i = 0; i < sequence.length; i++) {
                const it = sequence[i];
                const boxW = baseTargetWPx;
                const boxH = baseTargetHPx;

                const wNeed = boxW + (x > 0 ? spacingPx : 0);
                if (x > 0 && x + wNeed > innerW) {
                  newRow();
                }
                if (y + boxH > innerH) {
                  newPage();
                }

                // stop once we've passed the requested page and have already collected it
                if (page > pageIndex) break;

                if (page === pageIndex) {
                  const pxX = marginPx + x + (x > 0 ? spacingPx : 0);
                  const pxY = marginPx + y;
                  pushPlacement(it, pxX, pxY, boxW, boxH);
                }

                rowH = Math.max(rowH, boxH);
                x = x + wNeed;
              }

              // Center the used area within the inner box (nice look)
              if (pagePlacements.length) {
                let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                for (const p of pagePlacements) {
                  minX = Math.min(minX, p.x);
                  minY = Math.min(minY, p.y);
                  maxX = Math.max(maxX, p.x + p.w);
                  maxY = Math.max(maxY, p.y + p.h);
                }
                const usedW = maxX - minX;
                const usedH = maxY - minY;
                const desiredMinX = marginPx + (innerW - usedW) / 2;
                const desiredMinY = marginPx + (innerH - usedH) / 2;
                const dx = desiredMinX - minX;
                const dy = desiredMinY - minY;
                for (const p of pagePlacements) {
                  p.x += dx;
                  p.y += dy;
                }
              }

              // Draw
              for (const p of pagePlacements) {
                const loadedObj = loadedMap.get(p.fileId);
                const chosen = loadedObj?.img;
                const it = loadedObj?.item;
                if (!chosen || !it) continue;

                if (showCutLines) {
                  ctx.save();
                  ctx.strokeStyle = "#000";
                  ctx.lineWidth = 1;
                  ctx.strokeRect(p.x, p.y, p.w, p.h);
                  ctx.restore();
                }

                const contentW = p.w - bleedPx * 2;
                const contentH = p.h - bleedPx * 2;

                ctx.save();
                ctx.translate(p.x + p.w / 2, p.y + p.h / 2);

                // Clip to the *unrotated* target box so rotating an image never changes the box position or layout.
                ctx.beginPath();
                ctx.rect(-contentW / 2, -contentH / 2, contentW, contentH);
                ctx.clip();

                // Rotate only the artwork for this file (box stays fixed).
                const rad = (((Number(rotationDeg) || 0) + (Number(it.rotation) || 0)) * Math.PI) / 180;
                ctx.rotate(rad);

                // If this file is rotated, allow stretching to exactly fill the target size (as requested).
                let drawW, drawH;
                const perFileRot = normRot(it.rotation);
                if (perFileRot !== 0) {
                  // Keep the target box fixed. For 90°/270° rotations, swap draw dimensions so the rotated artwork still fills the box.
                  const swapDims = perFileRot === 90 || perFileRot === 270;
                  drawW = swapDims ? contentH : contentW;
                  drawH = swapDims ? contentW : contentH;
                } else {
                  // cover fit (preserve aspect)
                  drawW = contentW;
                  drawH = (chosen.height / chosen.width) * contentW;
                  if (drawH < contentH) {
                    drawH = contentH;
                    drawW = (chosen.width / chosen.height) * contentH;
                  }
                }

                ctx.drawImage(chosen, -drawW / 2, -drawH / 2, drawW, drawH);
                ctx.restore();
              }

              if (placementsRef) placementsRef.current = pagePlacements;

              // Cleanup URLs
              for (const v of loadedMap.values()) {
                try { URL.revokeObjectURL(v.url); } catch {}
              }

              resolve({ placements: pagePlacements });
            });
          });
        };



        useEffect(() => {
          drawSheet(frontRef.current, (frontFiles?.length ? frontFiles : frontImage), frontRotation, frontPreviewPage, frontPlacementsRef);
        }, [
          frontFiles,
          copiesPerFile,
          frontImage,
          frontRotation,
          frontPreviewPage,
          sheetKey,
          orientation,
          customSize,
          prints,
          showBleed,
          showCutLines,
          showGuides
        ]);

        useEffect(() => {
          if (showBack) {
            drawSheet(backRef.current, backImage, backRotation, 0, null);
          }
        }, [
          backImage,
          backRotation,
          sheetKey,
          orientation,
          customSize,
          prints,
          showBleed,
          showCutLines,
          showGuides,
          showBack
        ]);

        // -------- LARGE FORMAT PREVIEW --------

        const lfAreaSqFt = (lfWidth * lfHeight) / 144;

        const lfSelectedPricing = normalizeEntry(
          lfPricing[lfPaperKey] || {}
        );
        const lfBase =
          lfColorMode === "color"
            ? lfSelectedPricing.priceColor
            : lfSelectedPricing.priceBW;
        const lfSubtotal = lfBase * lfAreaSqFt;

        const lfAddonTotal =
          (lfGrommets ? lfAddonPricing.grommets || 0 : 0) +
          (lfFoamCore ? lfAddonPricing.foamCore || 0 : 0) +
          (lfCoroSign ? lfAddonPricing.coroSign || 0 : 0);

        const lfTotal = lfSubtotal + lfAddonTotal;

        const getLfDiscountFactor = (sqFt) => {
          let best = 0;
          lfQuantityDiscounts.forEach((t) => {
            if (sqFt >= (t.minSqFt || 0)) {
              best = Math.max(best, Number(t.discountPercent) || 0);
            }
          });
          return 1 - best / 100;
        };

        const lfTotalWithDiscount = lfTotal * getLfDiscountFactor(lfAreaSqFt);

        // -------- BLUEPRINT (PRESET LARGE FORMAT SIZES) --------

        const getBlueprintSize = (key) =>
          BLUEPRINT_SIZES.find((s) => s.key === key) || BLUEPRINT_SIZES[0];

        const bpSize = getBlueprintSize(bpSizeKey);
        const bpWidth = bpSize.w;
        const bpHeight = bpSize.h;

        const bpAreaPerSheetSqFt = (bpWidth * bpHeight) / 144;
        const bpTotalSqFt = bpAreaPerSheetSqFt * Math.max(0, bpQty || 0);

        const getBlueprintTier = (sizeKey, qty) => {
          const cfg = (bpPricing || {})[sizeKey] || {};
          const tiers = Array.isArray(cfg.tiers) ? cfg.tiers : [];
          const q = Math.max(0, Number(qty) || 0);

          // pick first tier whose maxQty is null (open-ended) or >= qty
          for (const t of tiers) {
            const maxQ = t.maxQty == null ? null : Number(t.maxQty);
            if (maxQ == null || q <= maxQ) {
              return {
                maxQty: maxQ,
                psf: Number(t.psf) || 0
              };
            }
          }
          // fallback: last tier
          const last = tiers[tiers.length - 1] || { maxQty: null, psf: 0 };
          return { maxQty: last.maxQty == null ? null : Number(last.maxQty), psf: Number(last.psf) || 0 };
        };

        const bpTier = getBlueprintTier(bpSizeKey, bpQty);
        const bpPsf = bpTier.psf;

        const bpPerSheet = bpPsf * bpAreaPerSheetSqFt;
        const bpTotal = bpPerSheet * Math.max(0, Number(bpQty) || 0);

        const drawBlueprint = (canvas, imgFile) => {
          if (!canvas) return;
          const ctx = canvas.getContext("2d");

          const baseWPx = inchesToPreviewPx(bpWidth);

          const baseHPx = inchesToPreviewPx(bpHeight);
          const { w: wPx, h: hPx } = clampCanvasPx(baseWPx, baseHPx, 3200);

          canvas.width = wPx;
          canvas.height = hPx;

          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, wPx, hPx);

          if (!imgFile) return;

          const img = new Image();
          img.onload = () => {
            ctx.save();
            ctx.translate(wPx / 2, hPx / 2);
            const rad = (bpRotation * Math.PI) / 180;
            ctx.rotate(rad);

            let drawW = wPx;
            let drawH = (img.height / img.width) * wPx;
            if (bpMaintainProp) {
              if (drawH > hPx) {
                drawH = hPx;
                drawW = (img.width / img.height) * hPx;
              }
            } else {
              drawW = wPx;
              drawH = hPx;
            }

            ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
            ctx.restore();
          };
          img.src = URL.createObjectURL(imgFile);
        };

        useEffect(() => {
          drawBlueprint(bpRef.current, bpImage);
        }, [bpImage, bpSizeKey, bpMaintainProp, bpRotation]);

        const drawLargeFormat = (canvas, imgFile) => {
          if (!canvas) return;
          const ctx = canvas.getContext("2d");

          const baseWPx = inchesToPreviewPx(lfWidth);

          const baseHPx = inchesToPreviewPx(lfHeight);
          const { w: wPx, h: hPx } = clampCanvasPx(baseWPx, baseHPx, 3200);

          canvas.width = wPx;
          canvas.height = hPx;

          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, wPx, hPx);

          if (!imgFile) return;

          const img = new Image();
          img.onload = () => {
            ctx.save();
            ctx.translate(wPx / 2, hPx / 2);
            const rad = (lfRotation * Math.PI) / 180;
            ctx.rotate(rad);

            let drawW = wPx;
            let drawH = (img.height / img.width) * wPx;
            if (lfMaintainProp) {
              if (drawH > hPx) {
                drawH = hPx;
                drawW = (img.width / img.height) * hPx;
              }
            } else {
              // stretch to fit
              drawW = wPx;
              drawH = hPx;
            }

            ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
            ctx.restore();
          };
          img.src = URL.createObjectURL(imgFile);
        };

        useEffect(() => {
          drawLargeFormat(lfRef.current, lfImage);
        }, [lfImage, lfWidth, lfHeight, lfMaintainProp, lfRotation]);

        

const addOrderSheetPage = (doc, payload) => {
  // Always render on a Letter portrait page
  const pageW = 8.5;
  const pageH = 11;

  // Background
  doc.setFillColor(255, 255, 255);
  doc.rect(0, 0, pageW, pageH, 'F');

  // Logo (kept proportional for Letter 8.5×11)
  const logoSize = 1.6; // inches
  const logoX = (pageW - logoSize) / 2;
  const logoY = 0.45;

  try {
    if (UPS_LOGO_PDF_DATA_URL) {
      doc.addImage(UPS_LOGO_PDF_DATA_URL, 'PNG', logoX, logoY, logoSize, logoSize);
    }
  } catch (e) {
    // If image fails, continue without blocking the PDF
    console.warn('Logo addImage failed:', e);
  }

  // Header
  doc.setTextColor(20, 30, 55);
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text('Print Order Sheet', pageW / 2, 3.1, { align: 'center' });

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(60, 70, 95);
  doc.text(`${UPS_STORE.name}`, pageW / 2, 3.35, { align: 'center' });
  doc.text(`${UPS_STORE.address}  •  ${UPS_STORE.phone}  •  ${UPS_STORE.email}`, pageW / 2, 3.52, { align: 'center' });

  // Divider
  doc.setDrawColor(200, 210, 230);
  doc.setLineWidth(0.02);
  doc.line(0.6, 3.75, 7.9, 3.75);

  // Job summary
  let y = 4.15;
  const lh = 0.26;

  const writePair = (label, value) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(20, 30, 55);
    doc.text(label, 0.75, y);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    doc.setTextColor(30, 40, 65);
    const text = (value == null || value === '') ? '—' : String(value);
    doc.text(text, 3.1, y);
    y += lh;
  };

  const now = new Date();
  writePair('Job type:', payload.jobType || 'Print');
  writePair('Created:', now.toLocaleString());

  // details list (paper, size, qty, orientation...)
  (payload.details || []).forEach((d) => {
    writePair(d.label, d.value);
  });

  // Optional totals
  if (payload.totals && payload.totals.length) {
    y += 0.08;
    doc.setDrawColor(220, 230, 245);
    doc.line(0.75, y, 7.75, y);
    y += 0.22;
    payload.totals.forEach((t) => {
      writePair(t.label, t.value);
    });
  }

  // Optional paper barcode (only for configured paper+sheet combinations)
  if (payload.barcodeValue) {
    const code = String(payload.barcodeValue);
    const dataUrl = makeBarcodeDataURL(code);

    y += 0.20;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(20, 30, 55);
    doc.text('Paper Barcode', 0.75, y);
    y += 0.10;

    if (dataUrl) {
      // Full-width barcode block
      doc.addImage(dataUrl, 'PNG', 0.75, y + 0.05, 2.0, 1.0);
      y += 1.15;
    } else {
      // Fallback: show the numeric code if barcode rendering fails
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(11);
      doc.setTextColor(30, 40, 65);
      doc.text(code, 0.95, y + 0.35);
      y += 0.60;
    }
  }

  // Files list
  if (payload.files && payload.files.length) {
    y += 0.18;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(20, 30, 55);
    doc.text('Files', 0.75, y);
    y += 0.18;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(45, 55, 80);

    const maxLines = 18;
    const lines = payload.files.slice(0, maxLines);
    lines.forEach((line) => {
      const wrapped = doc.splitTextToSize(line, 7.0);
      wrapped.forEach((w) => {
        if (y > 10.2) return;
        doc.text(w, 0.95, y);
        y += 0.20;
      });
    });

    if (payload.files.length > maxLines) {
      doc.setTextColor(100, 110, 130);
      doc.text(`…and ${payload.files.length - maxLines} more`, 0.95, y);
      y += 0.20;
    }
  }

  // Footer
  doc.setDrawColor(200, 210, 230);
  doc.line(0.6, 10.55, 7.9, 10.55);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(80, 90, 115);
  doc.text('Bring this order sheet with your print preview, or email it with your files.', 0.75, 10.85);
};

        // -------- PDF EXPORTS --------

const downloadSheetPDF = async () => {
  if (!frontRef.current) return;
  // Make sure logo is embedded in PDFs even on slow mobile connections
  await ensureLogoPdfDataUrl();

  
const savePdf = (doc, filename) => {
  try {
    // Prefer blob download (keeps the app page visible on iOS more reliably than doc.save()).
    const blob = doc.output("blob");
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  } catch (e) {
    // Fallback
    try { doc.save(filename); } catch {}
  }
};

// --- Order sheet (letter) + then the actual preview pages ---
  const orderDoc = new jsPDF({ orientation: 'portrait', unit: 'in', format: 'letter' });

  const currentPaper = paperTypes.find((p) => p.key === paperKey) || { label: paperKey };
  const isCustom = sheetKey === 'custom';
  const sheetW = isCustom ? customSize.w : (PRESET_SHEETS[sheetKey] ? PRESET_SHEETS[sheetKey][0] : 8.5);
  const sheetH = isCustom ? customSize.h : (PRESET_SHEETS[sheetKey] ? PRESET_SHEETS[sheetKey][1] : 11);

  const totalPrintQty = (frontFiles && frontFiles.length)
    ? frontFiles.reduce((sum, f) => sum + (Number(f.qty) || 0), 0)
    : (Number(prints.quantity) || 0);

  const details = [
    { label: 'Paper selected:', value: currentPaper.label },
    { label: 'Base sheet size:', value: `${sheetW}×${sheetH} in${isCustom ? ' (custom)' : ''}` },
    { label: 'Sheet orientation:', value: orientation },
    { label: 'Target size:', value: `${Number(prints.width) || 0}×${Number(prints.height) || 0} in` },
    { label: 'Prints per sheet:', value: `${Math.max(1, printsPerSheet)} (grid: ${frontSlotInfo?.cols || 0}×${frontSlotInfo?.rows || 0})` },
    { label: 'Total prints:', value: totalPrintQty },
    { label: `Sheets needed (${sheetW}×${sheetH}):`, value: sheetsNeeded },
  ];

  const subtotal = (Number(perSheetTotal) || 0) * (Number(sheetsNeeded) || 0);
  const discPct = Math.max(0, (1 - (Number(discountFactor) || 1)) * 100);
  const discAmt = Math.max(0, subtotal - (Number(totalPrice) || 0));

  const totals = [
    { label: 'Per-sheet cost:', value: `$${Number(perSheetTotal || 0).toFixed(2)}` },
    { label: 'Subtotal:', value: `$${Number(subtotal || 0).toFixed(2)}` },
    ...(discPct > 0.0001 ? [{ label: `Qty discount (${discPct.toFixed(1)}%):`, value: `-$${Number(discAmt || 0).toFixed(2)}` }] : []),
    { label: 'Estimated total:', value: `$${Number(totalPrice || 0).toFixed(2)}` },
  ];

  const files = (frontFiles && frontFiles.length)
    ? frontFiles.map((f, i) => {
        const rot = (Number(f.rotation) || 0) % 360;
        return `${i + 1}. ${f.name || 'file'}  —  qty: ${Number(f.qty) || 0}${rot ? `  •  rotate: ${rot}°` : ''}`;
      })
    : (frontImage ? [frontImage.name || 'uploaded image'] : []);

  const barcodeValue = getPaperBarcode(currentPaper.label, sheetW, sheetH);

  addOrderSheetPage(orderDoc, {
    jobType: 'Sheets / Photos',
    details,
    totals,
    files,
    barcodeValue
  });

  // Now append the preview pages (can be multi-page)
  const isLandscape = (Number(orientedWIn) || 0) >= (Number(orientedHIn) || 0);
  const pdfW = orientedWIn;
  const pdfH = orientedHIn;

  // Export rule:
  // - Always include the order sheet.
  // - Include ONE preview sheet for single-design jobs (even if it requires many sheets).
  // - If multiple different files are uploaded, include as many preview pages as needed
  //   to show EACH uploaded file at least once.
  let exportPages = 1;
  let exportInput = (frontFiles?.length ? frontFiles : frontImage);

  if (frontFiles?.length) {
    // Decide how many preview pages to include and what to render on them.
    // Rules:
    //  - Always include the order sheet.
    //  - For a single-design job (one uploaded file), export ONE preview page, but it should be FULLY populated
    //    according to that file's quantity (so it matches the on-screen preview).
    //  - For multiple different files, export enough pages to show each file at least once.

    const nonZero = (frontFiles || []).filter((f) => (Number(f?.qty) || 0) > 0);
    const workingList = nonZero.length ? nonZero : (frontFiles || []).filter(Boolean);

    const bleedIn = showBleed ? BLEED_IN : 0;
    const targetWIn = Math.max(0.1, Number(prints.width) || 0) + bleedIn * 2;
    const targetHIn = Math.max(0.1, Number(prints.height) || 0) + bleedIn * 2;
    const cap = Math.max(1, (computeGridFit(orientedWIn, orientedHIn, targetWIn, targetHIn)?.count) || 1);

    if (workingList.length <= 1) {
      // Single file: keep its real qty so page 1 matches the UI preview (e.g., 2-up shows both copies).
      exportInput = workingList.length ? workingList : (frontFiles || []).slice(0, 1);
      exportPages = 1;
    } else {
      // Multi-file: generate a sample list where each file appears once, and paginate only if needed.
      const baseList = workingList.map((f) => ({ ...f, qty: 1 }));
      exportInput = baseList;
      exportPages = Math.max(1, Math.ceil(baseList.length / cap));
    }
  }

  // Pre-render back (same for all sheets) once, if used
  let backData = null;
  if (showBack && backImage) {
    const backCanvas = document.createElement('canvas');
    await drawSheet(backCanvas, backImage, backRotation, 0, null);
    backData = backCanvas.toDataURL('image/png', 1.0);
  }

  for (let p = 0; p < exportPages; p++) {
    const c = document.createElement('canvas');
    await drawSheet(c, exportInput, frontRotation, p, null);
    const data = c.toDataURL('image/png', 1.0);

    // Add a new page with the actual output size/orientation
    orderDoc.addPage([pdfW, pdfH], isLandscape ? 'landscape' : 'portrait');
    orderDoc.addImage(data, 'PNG', 0, 0, pdfW, pdfH);

    if (backData) {
      orderDoc.addPage([pdfW, pdfH], isLandscape ? 'landscape' : 'portrait');
      orderDoc.addImage(backData, 'PNG', 0, 0, pdfW, pdfH);
    }
  }

  savePdf(orderDoc, 'print_preview_with_order_sheet.pdf');
};

const downloadLfPDF = () => {
  if (!lfRef.current) return;

  const orderDoc = new jsPDF({ orientation: 'portrait', unit: 'in', format: 'letter' });
  const lfPaper = lfPaperTypes.find((p) => p.key === lfPaperKey) || { label: lfPaperKey };

  const details = [
    { label: 'Paper selected:', value: lfPaper.label },
    { label: 'Size:', value: `${lfWidth}×${lfHeight} in` },
    { label: 'Orientation:', value: (lfWidth >= lfHeight ? 'landscape' : 'portrait') },
    { label: 'Color mode:', value: lfColorMode === 'bw' ? 'B/W' : 'Color' },
    { label: 'Add-ons:', value: [lfGrommets ? 'Grommets' : null, lfFoamCore ? 'Foam Core' : null, lfCoroSign ? 'Coro Sign' : null].filter(Boolean).join(', ') || 'None' },
  ];

  const totals = [
    { label: 'Estimated total:', value: `$${Number(lfTotalWithDiscount || 0).toFixed(2)}` }
  ];

  addOrderSheetPage(orderDoc, {
    jobType: 'Large Format',
    details,
    totals,
    files: lfImage ? [lfImage.name || 'uploaded image'] : []
  });

  // Append the actual print page
  const pdfW = lfWidth;
  const pdfH = lfHeight;
  const orient = pdfW >= pdfH ? 'landscape' : 'portrait';

  orderDoc.addPage([pdfW, pdfH], orient);
  const data = lfRef.current.toDataURL('image/png', 1.0);
  orderDoc.addImage(data, 'PNG', 0, 0, pdfW, pdfH);
  savePdf(orderDoc, 'large_format_with_order_sheet.pdf');
};

const downloadBlueprintPDF = () => {
  if (!bpRef.current) return;

  const orderDoc = new jsPDF({ orientation: 'portrait', unit: 'in', format: 'letter' });
  const sizeObj = BLUEPRINT_SIZES.find((s) => s.key === bpSizeKey) || { label: bpSizeKey };

  const details = [
    { label: 'Paper selected:', value: '20lb plain bond' },
    { label: 'Blueprint size:', value: sizeObj.label },
    { label: 'Quantity (sheets):', value: bpQty },
    { label: 'Orientation:', value: (bpWidth >= bpHeight ? 'landscape' : 'portrait') },
  ];

  const totals = [
    { label: 'Estimated total:', value: `$${Number(bpTotal || 0).toFixed(2)}` }
  ];

  addOrderSheetPage(orderDoc, {
    jobType: 'Blueprints',
    details,
    totals,
    files: bpImage ? [bpImage.name || 'uploaded image'] : []
  });

  const pdfW = bpWidth;
  const pdfH = bpHeight;
  const orient = pdfW >= pdfH ? 'landscape' : 'portrait';

  orderDoc.addPage([pdfW, pdfH], orient);
  const data = bpRef.current.toDataURL('image/png', 1.0);
  orderDoc.addImage(data, 'PNG', 0, 0, pdfW, pdfH);
  savePdf(orderDoc, 'blueprint_with_order_sheet.pdf');
};

        // -------- EMAIL ORDER (Netlify Function) --------

        const sendOrderEmail = async (jobType, jobPdfBlob, orderSheetBlob) => {
          try {
            const blobToB64 = (blob) => new Promise((resolve, reject) => {
              const r = new FileReader();
              r.onloadend = () => resolve(r.result);
              r.onerror = reject;
              r.readAsDataURL(blob);
            });

            const prefix = "data:application/pdf;base64,";

            const jobB64Full = await blobToB64(jobPdfBlob);
            const jobPdfBase64 = jobB64Full.startsWith(prefix) ? jobB64Full.slice(prefix.length) : jobB64Full;

            let orderSheetPdfBase64 = null;
            if (orderSheetBlob) {
              const sheetB64Full = await blobToB64(orderSheetBlob);
              orderSheetPdfBase64 = sheetB64Full.startsWith(prefix) ? sheetB64Full.slice(prefix.length) : sheetB64Full;
            }

            console.log("jobPdfBase64 length (client):", jobPdfBase64.length);
            if (orderSheetPdfBase64) console.log("orderSheetPdfBase64 length (client):", orderSheetPdfBase64.length);

            // Safety: Netlify body size limit ~10MB => ~7.5MB raw => ~10MB base64
            const MAX_LEN = 10 * 1024 * 1024;
            if (jobPdfBase64.length > MAX_LEN) {
              alert(
                "The generated PDF is too large to send automatically. Please download it and email manually."
              );
              return false;
            }

            const name = window.prompt("Your name (for the order)?") || "";
            const email =
              window.prompt("Your email (for confirmation)?") || "";
            const phone =
              window.prompt("Your phone number (optional)?") || "";

            const details = {
              jobType,
              sheet: {
                sheetKey,
                orientation,
                prints,
                paperKey,
                frontColorMode,
                backColorMode,
                showBack,
                sheetsNeeded,
                totalPrice: totalPrice.toFixed(2)
              },
              largeFormat: {
                width: lfWidth,
                height: lfHeight,
                paperKey: lfPaperKey,
                colorMode: lfColorMode,
                addons: {
                  grommets: lfGrommets,
                  foamCore: lfFoamCore,
                  coroSign: lfCoroSign
                },
                lfTotal: lfTotalWithDiscount.toFixed(2)
              },
              blueprints: {
                size: bpSizeKey,
                width: bpWidth,
                height: bpHeight,
                qty: bpQty,
                paperKey: "plain_20lb",
                colorMode: "bw",
                psf: Number(bpPsf || 0).toFixed(4),
                areaPerSheetSqFt: bpAreaPerSheetSqFt.toFixed(3),
                totalSqFt: bpTotalSqFt.toFixed(3),
                total: bpTotal.toFixed(2)
              },
              user: { name, email, phone }
            };

            // ---- Build a normalized order object so the email is clean and only includes what was selected ----
const orderId = `JOB-${Date.now()}`;

const paperItems = [];
const largeFormatItems = [];
const blueprintItems = [];

if (jobType === "sheets") {
  const unit = Number(sheetsNeeded || 0) > 0
    ? (Number(totalPrice || 0) / Number(sheetsNeeded || 1))
    : Number(totalPrice || 0);

  paperItems.push({
    name: "Paper Printing",
    sku: paperKey || "",
    specs: `${sheetKey} • ${paperKey} • ${frontColorMode.toUpperCase()}${showBack ? " / " + backColorMode.toUpperCase() : ""}`,
    qty: Number(sheetsNeeded || 0),
    unitPrice: Number(unit || 0),
    total: Number(totalPrice || 0)
  });
}

if (jobType === "large-format") {
  const addons = [
    lfGrommets ? "Grommets" : null,
    lfFoamCore ? "Foam Core" : null,
    lfCoroSign ? "Coro Sign" : null
  ].filter(Boolean);

  largeFormatItems.push({
    name: "Large Format",
    sku: lfPaperKey || "",
    specs: `${Number(lfWidth) || 0}" × ${Number(lfHeight) || 0}" • ${lfPaperKey} • ${lfColorMode.toUpperCase()}${addons.length ? " • " + addons.join(", ") : ""}`,
    qty: 1,
    unitPrice: Number(lfTotalWithDiscount || 0),
    total: Number(lfTotalWithDiscount || 0)
  });
}

if (jobType === "blueprints") {
  const sizeObj = (BLUEPRINT_SIZES || []).find(s => s.key === bpSizeKey) || { label: bpSizeKey };

  blueprintItems.push({
    name: "Blueprints",
    sku: "plain_20lb",
    specs: `${sizeObj.label} • ${Number(bpWidth) || 0}" × ${Number(bpHeight) || 0}" • B/W`,
    qty: Number(bpQty || 0),
    unitPrice: Number(bpQty || 0) > 0
      ? (Number(bpTotal || 0) / Number(bpQty || 1))
      : Number(bpTotal || 0),
    total: Number(bpTotal || 0)
  });
}

const subtotal =
  (paperItems.reduce((s, i) => s + (Number(i.total) || 0), 0)) +
  (largeFormatItems.reduce((s, i) => s + (Number(i.total) || 0), 0)) +
  (blueprintItems.reduce((s, i) => s + (Number(i.total) || 0), 0));

const order = {
  orderId,
  customerName: name || "Walk-In",
  phone,
  email,
  dueDate: "ASAP",
  fulfillment: "Pickup",
  notes: "",
  subtotal: Number(subtotal || 0),
  discountPct: 0,
  discountAmt: 0,
  total: Number(subtotal || 0),
  paperItems,
  largeFormatItems,
  blueprintItems
};

const payload = {
  subject: `Print Order – ${order.customerName} – ${orderId}`,
  to: "store4979@theupsstore.com",
  deepLinkUrl: `${window.location.origin}${window.location.pathname}?job=${encodeURIComponent(orderId)}`,
  order,
  // Backwards-compatibility (safe to keep):
  jobType,
  details,
  jobPdfBase64,
  orderSheetPdfBase64
};

            const resp = await fetch(
              "/.netlify/functions/send-print-job",
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json"
                },
                body: JSON.stringify(payload)
              }
            );

            if (!resp.ok) {
              console.error("Server error:", resp.status);
              alert(
                "Could not send order automatically. Please download the PDF and email it to store4979@theupsstore.com."
              );
              return false;
            }
            alert(
              "Order sent! We'll receive your job details by email shortly."
            );
            return true;
          } catch (err) {
            console.error("sendOrderEmail error:", err);
            alert(
              "Could not send order automatically. Please download the PDF and email it to store4979@theupsstore.com."
            );
            return false;
          }
        };

        const orderSheetJob = async () => {
          if (!frontRef.current) {
            alert("Please upload a front image first.");
            return;
          }
          const pdfW = orientedWIn;
          const pdfH = orientedHIn;

          const doc = new jsPDF({
            orientation,
            unit: "in",
            format: [pdfW, pdfH]
          });

          const frontData = canvasToCompressedJpeg(frontRef.current, { maxDim: 1600, quality: 0.75 });
          doc.addImage(frontData, "JPEG", 0, 0, pdfW, pdfH);

          if (showBack && backRef.current && backImage) {
            doc.addPage([pdfW, pdfH], orientation);
            const backData = canvasToCompressedJpeg(backRef.current, { maxDim: 1600, quality: 0.75 });
            doc.addImage(backData, "JPEG", 0, 0, pdfW, pdfH);
          }

          const jobBlob = doc.output("blob");
          // Build a Letter-size order sheet PDF (separate attachment)
          await ensureLogoPdfDataUrl();
          const orderDoc = new jsPDF({ orientation: "portrait", unit: "in", format: "letter" });

          const currentPaper = paperTypes.find((p) => p.key === paperKey) || { label: paperKey };
          const isCustom = sheetKey === "custom";
          const sheetW = isCustom ? customSize.w : (PRESET_SHEETS[sheetKey] ? PRESET_SHEETS[sheetKey][0] : 8.5);
          const sheetH = isCustom ? customSize.h : (PRESET_SHEETS[sheetKey] ? PRESET_SHEETS[sheetKey][1] : 11);

          const details = [
            { label: "Paper selected:", value: currentPaper.label },
            { label: "Base sheet size:", value: `${sheetW}×${sheetH} in${isCustom ? " (custom)" : ""}` },
            { label: "Sheet orientation:", value: orientation },
            { label: "Target size:", value: `${Number(prints.width) || 0}×${Number(prints.height) || 0} in` },
            { label: "Prints per sheet:", value: `${Math.max(1, printsPerSheet)} (grid: ${frontSlotInfo?.cols || 0}×${frontSlotInfo?.rows || 0})` },
            { label: "Total prints:", value: totalPrintQty },
            { label: `Sheets needed (${sheetW}×${sheetH}):`, value: sheetsNeeded },
            { label: "Sides:", value: showBack ? "Front + Back" : "Single-sided" },
            { label: "Color:", value: showBack ? `${frontColorMode.toUpperCase()} / ${backColorMode.toUpperCase()}` : frontColorMode.toUpperCase() },
          ];

          const totals = [
            { label: "Discounted / sheet:", value: `$${((Number(totalPrice||0) / Math.max(1, sheetsNeeded)) || Number(perSheetTotal||0)).toFixed(2)}` },
            { label: "Subtotal:", value: `$${Number(subtotal || 0).toFixed(2)}` },
            ...(discPct > 0.0001 ? [{ label: `Qty discount (${discPct.toFixed(1)}%):`, value: `-$${Number(discAmt || 0).toFixed(2)}` }] : []),
            { label: "Estimated total:", value: `$${Number(totalPrice || 0).toFixed(2)}` },
          ];

          addOrderSheetPage(orderDoc, {
            jobType: "Paper Printing",
            details,
            totals,
            files: frontImage ? [frontImage.name || "front image"] : []
          });

          const orderSheetBlob = orderDoc.output("blob");
          await sendOrderEmail("sheets", jobBlob, orderSheetBlob);
        };

        const orderLargeFormatJob = async () => {
          if (!lfRef.current) {
            alert("Please upload a large-format image first.");
            return;
          }
          const pdfW = lfWidth;
          const pdfH = lfHeight;

          const doc = new jsPDF({
            orientation: pdfW >= pdfH ? "landscape" : "portrait",
            unit: "in",
            format: [pdfW, pdfH]
          });

          const data = canvasToCompressedJpeg(lfRef.current, { maxDim: 1800, quality: 0.72 });
          doc.addImage(data, "JPEG", 0, 0, pdfW, pdfH);
          const jobBlob = doc.output("blob");
          // Build a Letter-size order sheet PDF (separate attachment)
          await ensureLogoPdfDataUrl();
          const orderDoc = new jsPDF({ orientation: "portrait", unit: "in", format: "letter" });

          const lfPaper = lfPaperTypes.find((p) => p.key === lfPaperKey) || { label: lfPaperKey };
          const details = [
            { label: "Paper selected:", value: lfPaper.label },
            { label: "Size:", value: `${lfWidth}×${lfHeight} in` },
            { label: "Orientation:", value: lfWidth >= lfHeight ? "landscape" : "portrait" },
            { label: "Color:", value: lfColorMode === "bw" ? "B/W" : "Color" },
            { label: "Add-ons:", value: [lfGrommets ? "Grommets" : null, lfFoamCore ? "Foam Core" : null, lfCoroSign ? "Coro Sign" : null].filter(Boolean).join(", ") || "None" },
          ];
          const totals = [
            { label: "Estimated total:", value: `$${Number(lfTotalWithDiscount || 0).toFixed(2)}` }
          ];
          addOrderSheetPage(orderDoc, {
            jobType: "Large Format",
            details,
            totals,
            files: lfImage ? [lfImage.name || "uploaded image"] : []
          });
          const orderSheetBlob = orderDoc.output("blob");
          await sendOrderEmail("large-format", jobBlob, orderSheetBlob);
        };



        const orderBlueprintJob = async () => {
          if (!bpRef.current) {
            alert("Please upload a blueprint image first.");
            return;
          }
          const pdfW = bpWidth;
          const pdfH = bpHeight;

          const doc = new jsPDF({
            orientation: pdfW >= pdfH ? "landscape" : "portrait",
            unit: "in",
            format: [pdfW, pdfH]
          });

          const data = canvasToCompressedJpeg(bpRef.current, { maxDim: 1800, quality: 0.72 });
          doc.addImage(data, "JPEG", 0, 0, pdfW, pdfH);
          const jobBlob = doc.output("blob");
          // Build a Letter-size order sheet PDF (separate attachment)
          await ensureLogoPdfDataUrl();
          const orderDoc = new jsPDF({ orientation: "portrait", unit: "in", format: "letter" });

          const details = [
            { label: "Size:", value: `${bpWidth}×${bpHeight} in` },
            { label: "Quantity:", value: bpQty },
            { label: "Scale:", value: bpScale || "100%" },
            { label: "Copies:", value: bpCopies || 1 },
            { label: "Folds:", value: bpFold ? "Yes" : "No" },
          ];
          const totals = [
            { label: "Estimated total:", value: `$${Number(bpTotal || 0).toFixed(2)}` }
          ];
          addOrderSheetPage(orderDoc, {
            jobType: "Blueprints",
            details,
            totals,
            files: bpFile ? [bpFile.name || "uploaded file"] : []
          });
          const orderSheetBlob = orderDoc.output("blob");
          await sendOrderEmail("blueprints", jobBlob, orderSheetBlob);
        };

        // -------- ADMIN ACTIONS --------

        const handleAdminClick = () => {
          if (!isAdmin) {
            const pwd = window.prompt("Enter admin password");
            if (pwd === "store4979") {
              setIsAdmin(true);
              setShowAdmin(true);
            } else {
              alert("Incorrect password");
            }
          } else {
            setShowAdmin((v) => !v);
          }
        };

        const applyMarkupForPaper = (pk) => {
          const m = parseFloat(markupPerPaper[pk]) || 0;
          const factor = 1 + m / 100;
          setPricing((prev) => {
            const next = { ...prev };
            const group = prev[pk] || {};
            next[pk] = {};
            for (const sk in group) {
              const normalized = normalizeEntry(group[sk]);
              const baseColor = normalized.baseCostColor;
              const baseBW = normalized.baseCostBW;
              next[pk][sk] = {
                ...normalized,
                priceColor: parseFloat((baseColor * factor).toFixed(4)),
                priceBW: parseFloat((baseBW * factor).toFixed(4))
              };
            }
            return next;
          });
        };

        const applyMarkupForAllPapers = () => {
          setPricing((prev) => {
            const next = {};
            for (const pk in prev) {
              const m = parseFloat(markupPerPaper[pk]) || 0;
              const factor = 1 + m / 100;
              const group = prev[pk] || {};
              next[pk] = {};
              for (const sk in group) {
                const normalized = normalizeEntry(group[sk]);
                const baseColor = normalized.baseCostColor;
                const baseBW = normalized.baseCostBW;
                next[pk][sk] = {
                  ...normalized,
                  priceColor: parseFloat((baseColor * factor).toFixed(4)),
                  priceBW: parseFloat((baseBW * factor).toFixed(4))
                };
              }
            }
            return next;
          });
        };

        const applyLfMarkupForPaper = (pk) => {
          const m = parseFloat(lfMarkupPerPaper[pk]) || 0;
          const factor = 1 + m / 100;
          setLfPricing((prev) => {
            const next = { ...prev };
            const entry = normalizeEntry(prev[pk] || {});
            const baseColor = entry.baseCostColor;
            const baseBW = entry.baseCostBW;
            next[pk] = {
              ...entry,
              priceColor: parseFloat((baseColor * factor).toFixed(4)),
              priceBW: parseFloat((baseBW * factor).toFixed(4))
            };
            return next;
          });
        };

        const applyLfMarkupForAll = () => {
          setLfPricing((prev) => {
            const next = {};
            for (const pk in prev) {
              const m = parseFloat(lfMarkupPerPaper[pk]) || 0;
              const factor = 1 + m / 100;
              const entry = normalizeEntry(prev[pk] || {});
              const baseColor = entry.baseCostColor;
              const baseBW = entry.baseCostBW;
              next[pk] = {
                ...entry,
                priceColor: parseFloat((baseColor * factor).toFixed(4)),
                priceBW: parseFloat((baseBW * factor).toFixed(4))
              };
            }
            return next;
          });
        };


const getPresetSheetKeys = () =>
  Object.keys(PRESET_SHEETS).filter((k) => k !== "custom");

const handleAddPaperType = () => {
  const label = (newPaperLabel || "").trim() || "New Paper Type";
  const baseKey = (newPaperKey || "").trim() || label;
  const existing = new Set((paperTypes || []).map((p) => p.key));
  const key = uniqueKey(baseKey, existing);

  const chosenSheets = getPresetSheetKeys().filter(
    (sk) => !!newPaperSheets[sk]
  );
  const sheets =
    chosenSheets.length > 0 ? chosenSheets : ["8.5x11"];

  const nextPaperTypes = [...(paperTypes || []), { key, label }];
  setPaperTypes(nextPaperTypes);

  setSheetKeysForPaper((prev) => ({
    ...(prev || {}),
    [key]: sheets
  }));

  setPricing((prev) => {
    const next = { ...(prev || {}) };
    next[key] = {};
    sheets.forEach((sk) => {
      next[key][sk] = {
        baseCostColor: 0,
        baseCostBW: 0,
        priceColor: 0,
        priceBW: 0
      };
    });
    return next;
  });

  setMarkupPerPaper((prev) => ({ ...(prev || {}), [key]: 0 }));

  setPaperKey(key);
  setQuotePaperKey(key);

  setNewPaperLabel("");
  setNewPaperKey("");
};

const handleRemovePaperType = (key) => {
  if (!key) return;
  if ((paperTypes || []).length <= 1) {
    alert("You must keep at least one paper type.");
    return;
  }
  if (
    !confirm(
      `Remove paper type "${key}"? This will delete its pricing entries.`
    )
  )
    return;

  const nextPaperTypes = (paperTypes || []).filter(
    (p) => p.key !== key
  );
  setPaperTypes(nextPaperTypes);

  setSheetKeysForPaper((prev) => {
    const next = { ...(prev || {}) };
    delete next[key];
    return next;
  });

  setPricing((prev) => {
    const next = { ...(prev || {}) };
    delete next[key];
    return next;
  });

  setMarkupPerPaper((prev) => {
    const next = { ...(prev || {}) };
    delete next[key];
    return next;
  });

  if (paperKey === key) setPaperKey(nextPaperTypes[0].key);
  if (quotePaperKey === key) setQuotePaperKey(nextPaperTypes[0].key);
};

const handleUpdatePaperLabel = (key, label) => {
  const next = (paperTypes || []).map((p) =>
    p.key === key ? { ...p, label } : p
  );
  setPaperTypes(next);
};

const handleTogglePaperSheet = (paperKeyToEdit, sheetKeyToToggle) => {
  setSheetKeysForPaper((prev) => {
    const next = { ...(prev || {}) };
    const current = new Set(next[paperKeyToEdit] || []);
    if (current.has(sheetKeyToToggle)) current.delete(sheetKeyToToggle);
    else current.add(sheetKeyToToggle);

    const arr = Array.from(current);
    // must keep at least one size
    if (arr.length === 0) return prev;

    next[paperKeyToEdit] = arr;

    // also ensure pricing has matching entries
    setPricing((pPrev) => {
      const pNext = { ...(pPrev || {}) };
      if (!pNext[paperKeyToEdit]) pNext[paperKeyToEdit] = {};
      // add new
      arr.forEach((sk) => {
        if (!pNext[paperKeyToEdit][sk]) {
          pNext[paperKeyToEdit][sk] = {
            baseCostColor: 0,
            baseCostBW: 0,
            priceColor: 0,
            priceBW: 0
          };
        }
      });
      // remove old
      Object.keys(pNext[paperKeyToEdit]).forEach((sk) => {
        if (!currentHas(arr, sk)) delete pNext[paperKeyToEdit][sk];
      });
      return pNext;
    });

    return next;
  });
};

const currentHas = (arr, v) => arr.includes(v);

const handleAddLfPaperType = () => {
  const label =
    (newLfLabel || "").trim() || "New LF Paper Type";
  const baseKey = (newLfKey || "").trim() || label;
  const existing = new Set((lfPaperTypes || []).map((p) => p.key));
  const key = uniqueKey(baseKey, existing);

  const nextLfPaperTypes = [...(lfPaperTypes || []), { key, label }];
  setLfPaperTypes(nextLfPaperTypes);

  setLfPricing((prev) => ({
    ...(prev || {}),
    [key]: { baseCostColor: 0, baseCostBW: 0, priceColor: 0, priceBW: 0 }
  }));

  setLfMarkupPerPaper((prev) => ({ ...(prev || {}), [key]: 0 }));

  setLfPaperKey(key);

  setNewLfLabel("");
  setNewLfKey("");
};

const handleRemoveLfPaperType = (key) => {
  if (!key) return;
  if ((lfPaperTypes || []).length <= 1) {
    alert("You must keep at least one large format paper type.");
    return;
  }
  if (
    !confirm(
      `Remove large format paper type "${key}"? This will delete its pricing entries.`
    )
  )
    return;

  const nextLfPaperTypes = (lfPaperTypes || []).filter(
    (p) => p.key !== key
  );
  setLfPaperTypes(nextLfPaperTypes);

  setLfPricing((prev) => {
    const next = { ...(prev || {}) };
    delete next[key];
    return next;
  });

  setLfMarkupPerPaper((prev) => {
    const next = { ...(prev || {}) };
    delete next[key];
    return next;
  });

  if (lfPaperKey === key) setLfPaperKey(nextLfPaperTypes[0].key);
};

const handleUpdateLfPaperLabel = (key, label) => {
  const next = (lfPaperTypes || []).map((p) =>
    p.key === key ? { ...p, label } : p
  );
  setLfPaperTypes(next);
};

        const exportPricingJson = () => {
          const data = {
            paperTypes,
            sheetKeysForPaper,
            lfPaperTypes,
            sheetPricing: pricing,
            lfPricing,
            blueprintPricing: bpPricing,
            sheetQtyDiscounts: quantityDiscounts,
            lfQtyDiscounts: lfQuantityDiscounts,
            sheetMarkupPerPaper: markupPerPaper,
            lfMarkupPerPaper,
            backSideFactor,
            lfAddonPricing
          };
          const blob = new Blob([JSON.stringify(data, null, 2)], {
            type: "application/json"
          });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = "pricing.json";
          document.body.appendChild(a);
          a.click();
          a.remove();
          URL.revokeObjectURL(url);
        };

        const importPricingJson = (file) => {
          const reader = new FileReader();
          reader.onload = (e) => {
            try {
              const json = JSON.parse(e.target.result);

// Optional paper type lists (so you can add/remove types)
if (Array.isArray(json.paperTypes) && json.paperTypes.length) {
  setPaperTypes(json.paperTypes);
  window.localStorage.setItem(
    LS_PAPER_TYPES_KEY,
    JSON.stringify(json.paperTypes)
  );
}
if (json.sheetKeysForPaper && typeof json.sheetKeysForPaper === "object") {
  setSheetKeysForPaper(json.sheetKeysForPaper);
  window.localStorage.setItem(
    LS_SHEET_KEYS_FOR_PAPER_KEY,
    JSON.stringify(json.sheetKeysForPaper)
  );
}
if (Array.isArray(json.lfPaperTypes) && json.lfPaperTypes.length) {
  setLfPaperTypes(json.lfPaperTypes);
  window.localStorage.setItem(
    LS_LF_PAPER_TYPES_KEY,
    JSON.stringify(json.lfPaperTypes)
  );
}

              if (json.sheetPricing) setPricing(json.sheetPricing);
              if (json.lfPricing) setLfPricing(json.lfPricing);
              if (json.blueprintPricing) setBpPricing(json.blueprintPricing);
              if (json.sheetQtyDiscounts)
                setQuantityDiscounts(json.sheetQtyDiscounts);
              if (json.lfQtyDiscounts)
                setLfQuantityDiscounts(json.lfQtyDiscounts);

              if (json.sheetMarkupPerPaper)
                setMarkupPerPaper((prev) => ({
                  ...prev,
                  ...json.sheetMarkupPerPaper
                }));
              if (json.lfMarkupPerPaper)
                setLfMarkupPerPaper((prev) => ({
                  ...prev,
                  ...json.lfMarkupPerPaper
                }));

              if (typeof json.backSideFactor === "number")
                setBackSideFactor(json.backSideFactor);
              if (json.lfAddonPricing) setLfAddonPricing(json.lfAddonPricing);

              alert("Pricing JSON imported.");
            } catch (err) {
              alert("Could not parse pricing JSON.");
            }
          };
          reader.readAsText(file);
        };

        // -------- QUICK QUOTE CALCULATIONS --------

        const computeQuickQuoteRows = () => {
          const rows = [];

          // When "Show all paper types" is OFF, only calculate for the selected paper.
          // Sizes should also be limited to what that paper supports.
          const sizes = quoteShowAllPapers
            ? Array.from(
                new Set(
                  paperTypes.flatMap((pt) =>
                    Object.keys(PRESET_SHEETS)
                      .filter((k) => k !== "custom")
                      .filter((sk) =>
                        (sheetKeysForPaper[pt.key] || []).includes(sk)
                      )
                  )
                )
              )
            : sheetKeysForPaper[quotePaperKey] || [];

          const paperKeys = quoteShowAllPapers
            ? paperTypes.map((pt) => pt.key)
            : [quotePaperKey];

          sizes.forEach((sk) => {
                        const [sW, sH] = PRESET_SHEETS[sk];
            const bestFit = computeBestImposition(sW, sH, quoteWidth, quoteHeight);

            paperKeys.forEach((paperKey) => {
              const pt = paperTypes.find((p) => p.key === paperKey);
              if (!pt) return;
              if (!(sheetKeysForPaper[paperKey] || []).includes(sk)) return;

              const entry = normalizeEntry((pricing[paperKey] || {})[sk] || {});
              if (!entry.priceColor && !entry.priceBW) return;

              const perSheet =
                quoteFrontColorMode === "color" ? entry.priceColor : entry.priceBW;

              const perSheetBack =
                quoteBackEnabled && backSideFactor > 0
                  ? (quoteBackColorMode === "color"
                      ? entry.priceColor
                      : entry.priceBW) * backSideFactor
                  : 0;

                            const printsPer = (bestFit && bestFit.count) ? bestFit.count : 1;
              const sheets = Math.ceil((quoteQty || 0) / printsPer);

              const discFactor = getSheetDiscountFactor(sheets);
              const total = (perSheet + perSheetBack) * sheets * discFactor;

                            rows.push({
                paperLabel: pt.label,
                paperKey,
                sheetKey: sk,
                perSheetFront: perSheet,
                perSheetBack,
                printsPer,
                sheets,
                total,
                layout: bestFit
              });
            });
          });

          return rows.sort((a, b) => a.total - b.total);
        };

        


        const openQuotePrintWindow = (title, innerHtml) => {
          const now = new Date();
          const w = window.open("", "_blank", "width=900,height=700");
          if (!w) return;
          w.document.write(`
<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${title}</title>
<style>
    :root{
  --bg:#FFFFFF;
  --panel:#FFFFFF;
  --panel2:#FFFFFF;
  --card:#FFFFFF;
  --text:#000000;
  --muted:rgba(0,0,0,.62);
  --line:rgba(0,0,0,.12);
  --accent:#008198;
  --accent2:#FFD100;
  --danger:#d32f2f;
  --ok:#008198;
  --shadow: 0 12px 32px rgba(0,0,0,.14);
  --radius:18px;
  --radius2:14px;
  --font: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, "Apple Color Emoji","Segoe UI Emoji";
}


    html, body { height: 100%; }
    html, body { height: 100%; }
body{
  margin:0;
  font-family:var(--font);
  color:var(--text);
  background: var(--bg) !important;
}

    /* --- Tailwind utility overrides (theme swap) --- */
    .bg-slate-50{ background: #f8fafc !important; }
    .bg-slate-50\/60{ background: rgba(248,250,252,.6) !important; }
    .bg-slate-100{ background: #f1f5f9 !important; }
    .bg-gray-100{ background: #f1f5f9 !important; }
    .bg-white{
  background: #ffffff !important;
  border: 1px solid var(--line) !important;
}


    .text-slate-400, .text-slate-500, .text-slate-600, .text-slate-700{ color: var(--muted) !important; }
    .text-slate-800, .text-slate-900{ color: var(--text) !important; }

    .border-slate-100, .border-slate-200, .border-slate-300, .border-gray-100, .border{ border-color: var(--line) !important; }
    .border-dashed{ border-style: dashed !important; }

    .shadow-sm{ box-shadow: var(--shadow) !important; }
    .rounded-2xl{ border-radius: var(--radius) !important; }
    .rounded-xl{ border-radius: var(--radius2) !important; }
    .rounded-md{ border-radius: 12px !important; }
    .rounded-full{ border-radius: 999px !important; }

    /* Inputs / selects */
input, select, textarea{
  background: #ffffff !important;
  border-color: rgba(0,0,0,.18) !important;
  color: var(--text) !important;
  outline: none !important;
}
input::placeholder, textarea::placeholder{ color: rgba(0,0,0,.45) !important; }
input:disabled, select:disabled, textarea:disabled{ opacity: .60 !important; }


    /* Buttons */
    .bg-blue-600{
  background: var(--accent) !important;
  border-color: transparent !important;
}

    .hover\:bg-blue-700:hover{ filter: brightness(0.92); }
    .bg-emerald-600{
  background: var(--accent2) !important;
  border-color: transparent !important;
  color: #000000 !important;
}

    .hover\:bg-emerald-700:hover{ filter: brightness(0.93); }
    .bg-slate-800{ background: #000000 !important; }
    .text-white{ color: #ffffff !important; }
.bg-slate-800.text-white{ color: #ffffff !important; }

    .bg-slate-800:hover{ filter: brightness(1.10); }

    /* “Selected pill” buttons in the UI */
    .bg-blue-50{ background: rgba(255,209,0,.22) !important; }
    .border-blue-400{ border-color: rgba(255,209,0,.75) !important; }
    .text-blue-700{ color: #000000 !important; }

    /* Recommendation / best row highlight */
    .bg-emerald-50\/60{ background: rgba(0,129,152,.10) !important; }
    .border-emerald-200{ border-color: rgba(0,129,152,.30) !important; }
    .text-emerald-900{ color: var(--text) !important; }

    /* Table */
    table{ color: var(--text) !important; }
    thead{ color: rgba(0,0,0,.62) !important; }
    tbody tr{ border-color: rgba(0,0,0,.08) !important; }

    /* Canvas blocks */
    canvas{ background: #ffffff !important; border-color: rgba(0,0,0,.14) !important; max-width:100%; height:auto; }

    /* Small code blocks */
    code{
      background: rgba(255,209,0,.18) !important;
      border: 1px solid rgba(0,0,0,.10);
      padding: 2px 6px;
      border-radius: 10px;
    }

    /* Improve overall spacing on small screens */
    @media (max-width: 640px){
      #root{ padding-top: 18px !important; }
    }
  
      /* ---- Mobile polish additions ---- */
      .no-scrollbar::-webkit-scrollbar { display: none; }
      .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }

      .table-wrap{
        overflow-x:auto;
        -webkit-overflow-scrolling: touch;
      }

      @media (max-width: 768px){
        .mobile-sticky-top{
          position: sticky;
          top: 0;
          z-index: 30;
          backdrop-filter: blur(12px);
          background: rgba(255,255,255,0.85);
          border-bottom: 1px solid rgba(15,23,42,0.08);
        }
        input, select, textarea { font-size: 16px; }
        input[type="number"], input[type="text"], input[type="tel"]{
          font-size:18px !important;
          min-height:50px;
          padding:12px 14px !important;
        }
        button{ min-height:44px; }

      }

    </style>
</head>
<body>
  <div class="head">
    <div class="headRow">
      <img class="logo" src="${UPS_LOGO_DATA_URL}" alt="The UPS Store" style="width:1.6in;height:auto;max-height:1.6in;"/>
      <div>
        <div class="storeName">${UPS_STORE.name}</div>
        <div class="storeLine">${UPS_STORE.address}</div>
        <div class="storeLine">Phone: ${UPS_STORE.phone} · Email: ${UPS_STORE.email}</div>
      </div>
    </div>
    <div class="rule"></div>
  </div>
  <p class="meta muted">Date: ${now.toLocaleString()}</p>
  ${innerHtml}
  <button class="noPrint" onclick="window.print()" style="padding:10px 14px;border:0;border-radius:10px;background:#0f172a;color:white;font-weight:700;cursor:pointer">Print</button>
</body>
</html>`);
          w.document.close();
          w.focus();
          setTimeout(() => w.print(), 250);
        };

        const printLargeFormatQuote = () => {
          const pt = (lfPaperTypes || []).find((p) => p.key === lfPaperKey) || { label: lfPaperKey };
          const areaSqFt = (Number(lfWidth) || 0) * (Number(lfHeight) || 0) / 144;
          const entry = normalizeEntry(lfPricing[lfPaperKey] || {});
          const basePerSqFt = (lfColorMode === 'color') ? (Number(entry.priceColor) || 0) : (Number(entry.priceBW) || 0);
          const base = basePerSqFt * areaSqFt;
          const addons =
            (lfGrommets ? (lfAddonPricing.grommets || 0) : 0) +
            (lfFoamCore ? (lfAddonPricing.foamCore || 0) : 0) +
            (lfCoroSign ? (lfAddonPricing.coroSign || 0) : 0);
          const subtotal = base + addons;
          const discFactor = getLfDiscountFactor(areaSqFt);
          const discPct = Math.max(0, Math.round((1 - discFactor) * 100));
          const total = subtotal * discFactor;

          const addonsList = [
            lfGrommets ? 'Grommets' : null,
            lfFoamCore ? 'Foam Core Mount' : null,
            lfCoroSign ? 'Coro Sign' : null
          ].filter(Boolean);

          openQuotePrintWindow('Large Format Quote', `
            <h1>Customer Quote</h1>
            <div class="box">
              <div style="font-weight:800;margin-bottom:8px">Large Format Printing</div>
              <table>
                <tbody>
                  <tr><th>Paper</th><td>${pt.label}</td></tr>
                  <tr><th>Size</th><td>${Number(lfWidth)||0}" × ${Number(lfHeight)||0}"</td></tr>
                  <tr><th>Area</th><td>${areaSqFt.toFixed(2)} sq ft</td></tr>
                  <tr><th>Color</th><td>${(lfColorMode || 'color').toUpperCase()}</td></tr>
                  <tr><th>Add-ons</th><td>${addonsList.length ? addonsList.join(', ') : 'None'}</td></tr>
                </tbody>
              </table>
            </div>

            <div class="box">
              <div style="font-weight:800;margin-bottom:8px">Estimate</div>
              <table>
                <tbody>
                  <tr><th>Base rate</th><td class="right">$${basePerSqFt.toFixed(2)} / sq ft</td></tr>
                  <tr><th>Base (rate × area)</th><td class="right">$${base.toFixed(2)}</td></tr>
                  <tr><th>Add-ons</th><td class="right">$${addons.toFixed(2)}</td></tr>
                  <tr><th>Subtotal</th><td class="right">$${subtotal.toFixed(2)}</td></tr>
                  <tr><th>Quantity discount</th><td class="right">${discPct ? discPct + '%' : '0%'}</td></tr>
                  <tr><th><b>Estimated total</b></th><td class="right"><b>$${total.toFixed(2)}</b></td></tr>
                </tbody>
              </table>
            </div>
          `);
        };

        const printBlueprintQuote = () => {
          const size = (BLUEPRINT_SIZES || []).find((s) => s.key === bpSizeKey) || BLUEPRINT_SIZES[0];
          const qty = Math.max(0, Number(bpQty) || 0);
          const areaPerSqFt = (Number(size.w) * Number(size.h)) / 144;
          const tier = getBlueprintTier(bpSizeKey, qty);
          const psf = Number(tier.psf) || 0;
          const perSheet = psf * areaPerSqFt;
          const total = perSheet * qty;

          openQuotePrintWindow('Blueprint Quote', `
            <h1>Customer Quote</h1>
            <div class="box">
              <div style="font-weight:800;margin-bottom:8px">Blueprint Printing</div>
              <table>
                <tbody>
                  <tr><th>Paper</th><td>20 LB Plain Bond</td></tr>
                  <tr><th>Size</th><td>${size.label}</td></tr>
                  <tr><th>Quantity</th><td>${qty}</td></tr>
                  <tr><th>Area / sheet</th><td>${areaPerSqFt.toFixed(2)} sq ft</td></tr>
                </tbody>
              </table>
            </div>

            <div class="box">
              <div style="font-weight:800;margin-bottom:8px">Estimate</div>
              <table>
                <tbody>
                  <tr><th>Rate</th><td class="right">$${psf.toFixed(2)} / sq ft</td></tr>
                  <tr><th>Per sheet</th><td class="right">$${perSheet.toFixed(2)}</td></tr>
                  <tr><th><b>Estimated total</b></th><td class="right"><b>$${total.toFixed(2)}</b></td></tr>
                </tbody>
              </table>
              <div class="muted" style="font-size:11px;margin-top:8px">Pricing tiers are editable in Admin per size (PSF + quantity breaks).</div>
            </div>
          `);
        };

        const printQuickQuote = () => {
          const rows = computeQuickQuoteRows();
          if (!rows.length) {
            alert("Nothing to print yet. Enter your quote details first.");
            return;
          }

          const paperLabel = (key) =>
            (paperTypes.find((p) => p.key === key) || {}).label || key;

          const now = new Date();
          const headerTitle = "Print Quote";
          const selectedPaperText = quoteShowAllPapers
            ? "All paper types"
            : paperLabel(quotePaperKey);

          const tableHeaders = quoteShowAllPapers
            ? ["Paper", "Sheet", "Prints/Sheet", "Sheets", "Front/Back per Sheet", "Discounted / Sheet", "Total"]
            : ["Sheet", "Prints/Sheet", "Sheets", "Front/Back per Sheet", "Discounted / Sheet", "Total"];

          const rowHtml = rows
            .map((r) => {
              const cols = [];
              if (quoteShowAllPapers) cols.push(`<td>${r.paperLabel}</td>`);
              cols.push(
                `<td>${r.sheetKey}</td>`,
                `<td style="text-align:right">${r.printsPer}${r.layout ? `<div class='muted' style='font-size:11px;line-height:1.2;margin-top:2px'>${r.layout.cols}×${r.layout.rows} · sheet ${r.layout.sheetOrientation}${r.layout.printRotated ? ' · print rotated' : ''}</div>` : ''}</td>`,
                `<td style="text-align:right">${r.sheets}</td>`,
                `<td style="text-align:right">$${r.perSheetFront.toFixed(4)} / $${r.perSheetBack.toFixed(4)}</td>`,
                (() => {
                  const df = getSheetDiscountFactor(r.sheets);
                  const per = (r.perSheetFront + r.perSheetBack) * df;
                  const pct = Math.max(0, Math.round((1 - df) * 100));
                  return `<td style="text-align:right">$${per.toFixed(4)}${pct ? `<div class="muted" style="font-size:11px;margin-top:2px">(${pct}% off)</div>` : ""}</td>`;
                })(),
                `<td style="text-align:right"><b>$${r.total.toFixed(2)}</b></td>`
              );
              return `<tr>${cols.join("")}</tr>`;
            })
            .join("");

          const best = rows.slice().sort((a, b) => a.total - b.total)[0];

          const w = window.open("", "_blank", "width=900,height=700");
          if (!w) return;

          w.document.write(`
<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${headerTitle}</title>
<style>
    :root{
  --bg:#FFFFFF;
  --panel:#FFFFFF;
  --panel2:#FFFFFF;
  --card:#FFFFFF;
  --text:#000000;
  --muted:rgba(0,0,0,.62);
  --line:rgba(0,0,0,.12);
  --accent:#008198;
  --accent2:#FFD100;
  --danger:#d32f2f;
  --ok:#008198;
  --shadow: 0 12px 32px rgba(0,0,0,.14);
  --radius:18px;
  --radius2:14px;
  --font: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, "Apple Color Emoji","Segoe UI Emoji";
}


    html, body { height: 100%; }
    html, body { height: 100%; }
body{
  margin:0;
  font-family:var(--font);
  color:var(--text);
  background: var(--bg) !important;
}

    /* --- Tailwind utility overrides (theme swap) --- */
    .bg-slate-50{ background: #f8fafc !important; }
    .bg-slate-50\/60{ background: rgba(248,250,252,.6) !important; }
    .bg-slate-100{ background: #f1f5f9 !important; }
    .bg-gray-100{ background: #f1f5f9 !important; }
    .bg-white{
  background: #ffffff !important;
  border: 1px solid var(--line) !important;
}


    .text-slate-400, .text-slate-500, .text-slate-600, .text-slate-700{ color: var(--muted) !important; }
    .text-slate-800, .text-slate-900{ color: var(--text) !important; }

    .border-slate-100, .border-slate-200, .border-slate-300, .border-gray-100, .border{ border-color: var(--line) !important; }
    .border-dashed{ border-style: dashed !important; }

    .shadow-sm{ box-shadow: var(--shadow) !important; }
    .rounded-2xl{ border-radius: var(--radius) !important; }
    .rounded-xl{ border-radius: var(--radius2) !important; }
    .rounded-md{ border-radius: 12px !important; }
    .rounded-full{ border-radius: 999px !important; }

    /* Inputs / selects */
input, select, textarea{
  background: #ffffff !important;
  border-color: rgba(0,0,0,.18) !important;
  color: var(--text) !important;
  outline: none !important;
}
input::placeholder, textarea::placeholder{ color: rgba(0,0,0,.45) !important; }
input:disabled, select:disabled, textarea:disabled{ opacity: .60 !important; }


    /* Buttons */
    .bg-blue-600{
  background: var(--accent) !important;
  border-color: transparent !important;
}

    .hover\:bg-blue-700:hover{ filter: brightness(0.92); }
    .bg-emerald-600{
  background: var(--accent2) !important;
  border-color: transparent !important;
  color: #000000 !important;
}

    .hover\:bg-emerald-700:hover{ filter: brightness(0.93); }
    .bg-slate-800{ background: #000000 !important; }
    .text-white{ color: #ffffff !important; }
.bg-slate-800.text-white{ color: #ffffff !important; }

    .bg-slate-800:hover{ filter: brightness(1.10); }

    /* “Selected pill” buttons in the UI */
    .bg-blue-50{ background: rgba(255,209,0,.22) !important; }
    .border-blue-400{ border-color: rgba(255,209,0,.75) !important; }
    .text-blue-700{ color: #000000 !important; }

    /* Recommendation / best row highlight */
    .bg-emerald-50\/60{ background: rgba(0,129,152,.10) !important; }
    .border-emerald-200{ border-color: rgba(0,129,152,.30) !important; }
    .text-emerald-900{ color: var(--text) !important; }

    /* Table */
    table{ color: var(--text) !important; }
    thead{ color: rgba(0,0,0,.62) !important; }
    tbody tr{ border-color: rgba(0,0,0,.08) !important; }

    /* Canvas blocks */
    canvas{ background: #ffffff !important; border-color: rgba(0,0,0,.14) !important; max-width:100%; height:auto; }

    /* Small code blocks */
    code{
      background: rgba(255,209,0,.18) !important;
      border: 1px solid rgba(0,0,0,.10);
      padding: 2px 6px;
      border-radius: 10px;
    }

    /* Improve overall spacing on small screens */
    @media (max-width: 640px){
      #root{ padding-top: 18px !important; }
    }
  
      /* ---- Mobile polish additions ---- */
      .no-scrollbar::-webkit-scrollbar { display: none; }
      .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }

      .table-wrap{
        overflow-x:auto;
        -webkit-overflow-scrolling: touch;
      }

      @media (max-width: 768px){
        .mobile-sticky-top{
          position: sticky;
          top: 0;
          z-index: 30;
          backdrop-filter: blur(12px);
          background: rgba(255,255,255,0.85);
          border-bottom: 1px solid rgba(15,23,42,0.08);
        }
        input, select, textarea { font-size: 16px; }
        input[type="number"], input[type="text"], input[type="tel"]{
          font-size:18px !important;
          min-height:50px;
          padding:12px 14px !important;
        }
        button{ min-height:44px; }

      }

    </style>
</head>
<body>
  <div class="head">
    <div class="headRow">
      <img class="logo" src="${UPS_LOGO_DATA_URL}" alt="The UPS Store" style="width:1.6in;height:auto;max-height:1.6in;"/>
      <div>
        <div class="storeName">${UPS_STORE.name}</div>
        <div class="storeLine">${UPS_STORE.address}</div>
        <div class="storeLine">Phone: ${UPS_STORE.phone} · Email: ${UPS_STORE.email}</div>
      </div>
    </div>
    <div class="rule"></div>
  </div>
  <h1>Customer Quote</h1>
  <p class="meta muted">
    Date: ${now.toLocaleString()}<br/>
    Print size: ${quoteWidth}" × ${quoteHeight}" &nbsp;•&nbsp; Quantity: ${quoteQty}<br/>
    Paper: ${selectedPaperText}<br/>
    Front: ${quoteFrontColorMode.toUpperCase()}${quoteBackEnabled ? " \u00A0\u2022\u00A0 Back: " + quoteBackColorMode.toUpperCase() : ""}<br/>
    ${quoteDocPages > 0 ? `Document pages: ${quoteDocPages}${quoteDocDuplex ? " (duplex)" : ""}` : ""}
  </p>

  <div class="box">
    <div style="font-weight:800;margin-bottom:8px">Best option</div>
    <div class="kpi">
      <div class="k"><div class="t">Sheet</div><div class="v">${best.sheetKey}</div></div>
      ${quoteShowAllPapers ? `<div class="k"><div class="t">Paper</div><div class="v">${best.paperLabel}</div></div>` : ""}
      <div class="k"><div class="t">Total</div><div class="v">$${best.total.toFixed(2)}</div></div>
    </div>
  </div>

  <div class="box">
    <div style="font-weight:800;margin-bottom:8px">Price breakdown</div>
    <table>
      <thead>
        <tr>${tableHeaders.map(h=>`<th>${h}</th>`).join("")}</tr>
      </thead>
      <tbody>
        ${rowHtml}
      </tbody>
    </table>
  </div>

  <button class="noPrint" onclick="window.print()" style="padding:10px 14px;border:0;border-radius:10px;background:#0f172a;color:white;font-weight:700;cursor:pointer">Print</button>
</body>
</html>
          `);
          w.document.close();
          w.focus();
          // Print after the logo finishes loading (important on iOS/slow connections)
          try {
            const img = w.document.querySelector('img.logo');
            const go = () => setTimeout(() => { try { w.print(); } catch {} }, 200);
            if (img && !img.complete) {
              img.addEventListener('load', go);
              img.addEventListener('error', go);
              // fallback in case events don't fire
              setTimeout(go, 1200);
            } else {
              go();
            }
          } catch (e) {
            setTimeout(() => { try { w.print(); } catch {} }, 400);
          }
        };

const quoteRows = computeQuickQuoteRows();
        const bestQuote = quoteRows[0] || null;

        const docSheetsNeeded =
          quoteDocPages > 0
            ? Math.ceil(
                quoteDocPages / (quoteDocDuplex ? 2 : 1)
              )
            : 0;

        // ---------- UI ----------

        const moveItem = (arr, fromIdx, toIdx) => {
          const next = [...(arr || [])];
          const [item] = next.splice(fromIdx, 1);
          next.splice(toIdx, 0, item);
          return next;
        };

        const reorderByIds = (arr, activeId, overId) => {
          if (!activeId || !overId || activeId === overId) return arr;
          const from = (arr || []).findIndex((x) => x.id === activeId);
          const to = (arr || []).findIndex((x) => x.id === overId);
          if (from < 0 || to < 0) return arr;
          return moveItem(arr, from, to);
        };

        const nudgeFile = (dir) => {
          setFrontFiles((prev) => {
            const arr = prev || [];
            const idx = arr.findIndex((x) => x.id === selectedFrontId);
            if (idx < 0) return arr;
            const nextIdx = Math.max(0, Math.min(arr.length - 1, idx + dir));
            if (nextIdx === idx) return arr;
            return moveItem(arr, idx, nextIdx);
          });
        };

        const handleFrontZoom = (delta) => setFrontZoom((z) => clampZoom((Number(z) || 1) + delta));
        const handleBackZoom = (delta) => setBackZoom((z) => clampZoom((Number(z) || 1) + delta));

        const toggleTools = () => setToolsOpen((v) => !v);

        const handleFrontCanvasClick = (e) => {
          const canvas = frontRef.current;
          if (!canvas) return;
          const rect = canvas.getBoundingClientRect();
          const scaleX = canvas.width / Math.max(1, rect.width);
          const scaleY = canvas.height / Math.max(1, rect.height);
          const x = (e.clientX - rect.left) * scaleX;
          const y = (e.clientY - rect.top) * scaleY;

          const placements = frontPlacementsRef.current || [];
          const hit = placements.find((p) => x >= p.x && x <= p.x + p.w && y >= p.y && y <= p.y + p.h);
          if (hit?.fileId) setSelectedFrontId(hit.fileId);
        };

        const handleFrontCanvasWheel = (e) => {
          if (!frontFiles?.length) return;
          if (frontTotalPages <= 1) return;
          e.preventDefault();
          const dir = e.deltaY > 0 ? 1 : -1;
          setFrontPreviewPage((p) => {
            const next = p + dir;
            const maxP = Math.max(0, frontTotalPages - 1);
            return Math.max(0, Math.min(maxP, next));
          });
        };
        return (
          <>
          <div className="space-y-6 pb-24 md:pb-10">
            <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
              <div>
                <h1 className="text-2xl font-bold text-slate-800">
                  The UPS Store Print Layout & Pricing
                </h1>
                <p className="text-sm text-slate-500">
                  Visual layout, accurate pricing, and quick quotes for
                  in-store printing.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  className={
                    "px-3 py-1.5 text-sm rounded-full border " +
                    (viewMode === "tool"
                      ? "bg-blue-600 text-white border-blue-600"
                      : "bg-white text-slate-700")
                  }
                  onClick={() => setViewMode("tool")}
                >
                  Layout & Pricing
                </button>
                <button
                  className={
                    "px-3 py-1.5 text-sm rounded-full border " +
                    (viewMode === "quote"
                      ? "bg-blue-600 text-white border-blue-600"
                      : "bg-white text-slate-700")
                  }
                  onClick={() => setViewMode("quote")}
                >
                  Quick Quote
                </button>
                <button
                  type="button"
                  onClick={handleAdminClick}
                  className="px-3 py-1.5 text-xs rounded-full border bg-white text-slate-600"
                >
                  {isAdmin
                    ? showAdmin
                      ? "Hide Admin"
                      : "Show Admin"
                    : "Admin / Pricing"}
                </button>
              
<div className="flex items-center gap-2">
  <button
    type="button"
    className="px-3 py-1.5 text-xs rounded-full border bg-white text-slate-600"
    onClick={() => { setViewMode("tool"); setShowAdmin(false); window.scrollTo({ top: 0, behavior: "smooth" }); }}
  >
    Home
  </button>
  <button
    type="button"
    className="px-3 py-1.5 text-xs rounded-full border bg-white text-slate-600"
    onClick={() => window.location.reload()}
  >
    Refresh
  </button>
</div>
</div>
            </header>


            {/* Mobile Bottom Navigation */}
            <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 tabbar">
              <div className="max-w-6xl mx-auto px-3 pb-[env(safe-area-inset-bottom)]">
                <div ref={tabbarRef} className="relative mt-2 mb-2">
                  <div className="indicator" style={{ left: tabIndicator.left, width: tabIndicator.width }} />
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      data-tab="tool"
                      onClick={() => { setViewMode("tool"); setShowAdmin(false); }}
                      className={"btn-press flex flex-col items-center justify-center gap-1 " + (!showAdmin && viewMode === "tool" ? "active" : "")}
                      aria-label="Layout & Pricing"
                    >
                      <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="3" y="4" width="18" height="16" rx="3"></rect>
                        <path d="M7 8h10M7 12h6M7 16h10"></path>
                      </svg>
                      <span className="text-[11px] font-semibold">Layout</span>
                    </button>

                    <button
                      type="button"
                      data-tab="quote"
                      onClick={() => { setViewMode("quote"); setShowAdmin(false); }}
                      className={"btn-press flex flex-col items-center justify-center gap-1 " + (!showAdmin && viewMode === "quote" ? "active" : "")}
                      aria-label="Quick Quote"
                    >
                      <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M7 7h10M7 11h10M7 15h6"></path>
                        <path d="M6 3h12a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H9l-4 3V6a3 3 0 0 1 3-3z"></path>
                      </svg>
                      <span className="text-[11px] font-semibold">Quote</span>
                    </button>

                    <button
                      type="button"
                      data-tab="admin"
                      onClick={handleAdminClick}
                      className={"btn-press flex flex-col items-center justify-center gap-1 " + (showAdmin ? "active" : "")}
                      aria-label="Admin & Pricing"
                    >
                      <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M12 3l2.2 4.5L19 8.2l-3.5 3.4.8 4.9L12 14.8 7.7 16.5l.8-4.9L5 8.2l4.8-.7L12 3z"></path>
                      </svg>
                      <span className="text-[11px] font-semibold">Admin</span>
                    </button>
                  </div>
                </div>
              </div>
            </nav>
{/* MAIN TOOL VIEW */}
            {viewMode === "tool" && (
              <div className="space-y-6">
                {/* Layout Pages */}
                <section className="bg-white rounded-2xl shadow-sm border border-slate-100 p-3">
                  <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
                    <button
                      type="button"
                      onClick={() => { setLayoutPage("paper"); window.scrollTo({ top: 0, behavior: "smooth" }); }}
                      className={
                        "h-10 px-4 rounded-xl border text-sm font-semibold whitespace-nowrap " +
                        (layoutPage === "paper"
                          ? "bg-blue-600 text-white border-blue-600"
                          : "bg-white text-slate-700 border-slate-200")
                      }
                    >
                      Paper Printing
                    </button>
                    <button
                      type="button"
                      onClick={() => { setLayoutPage("large"); window.scrollTo({ top: 0, behavior: "smooth" }); }}
                      className={
                        "h-10 px-4 rounded-xl border text-sm font-semibold whitespace-nowrap " +
                        (layoutPage === "large"
                          ? "bg-blue-600 text-white border-blue-600"
                          : "bg-white text-slate-700 border-slate-200")
                      }
                    >
                      Large Format
                    </button>
                    <button
                      type="button"
                      onClick={() => { setLayoutPage("blueprint"); window.scrollTo({ top: 0, behavior: "smooth" }); }}
                      className={
                        "h-10 px-4 rounded-xl border text-sm font-semibold whitespace-nowrap " +
                        (layoutPage === "blueprint"
                          ? "bg-blue-600 text-white border-blue-600"
                          : "bg-white text-slate-700 border-slate-200")
                      }
                    >
                      Blueprints
                    </button>

                    <div className="ml-auto flex items-center gap-2">
                      <span className="hidden sm:inline text-xs text-slate-500 whitespace-nowrap">
                        Switch sections without scrolling
                      </span>
                    </div>
                  </div>
                </section>

                {layoutPage === "paper" && (
                  <>
                {/* Paper workflow stepper */}
                <section className="glass rounded-2xl p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-xs text-slate-600">
                      Paper Printing workflow
                      <span className="hidden sm:inline"> · Tip: use the stepper to jump sections</span>
                    </div>
                    <div className="hidden sm:flex items-center gap-2">
                      <span className="kbd-hint">Click</span>
                      <span className="text-[11px] text-slate-500">to jump</span>
                    </div>
                  </div>

                  <div className="mt-3 flex items-center gap-2 overflow-x-auto no-scrollbar stepper">
                    <button
                      type="button"
                      onClick={() => document.getElementById("paperSetup")?.scrollIntoView({ behavior: "smooth", block: "start" })}
                      className="btn-press surface px-3 py-2 rounded-xl flex items-center gap-2 whitespace-nowrap"
                    >
                      <span className="step-dot active"></span>
                      <span className="text-xs font-semibold">1. Setup</span>
                    </button>
                    <div className="step-line"></div>
                    <button
                      type="button"
                      onClick={() => document.getElementById("paperUpload")?.scrollIntoView({ behavior: "smooth", block: "start" })}
                      className="btn-press surface px-3 py-2 rounded-xl flex items-center gap-2 whitespace-nowrap"
                    >
                      <span className="step-dot"></span>
                      <span className="text-xs font-semibold">2. Upload</span>
                    </button>
                    <div className="step-line"></div>
                    <button
                      type="button"
                      onClick={() => document.getElementById("paperPreview")?.scrollIntoView({ behavior: "smooth", block: "start" })}
                      className="btn-press surface px-3 py-2 rounded-xl flex items-center gap-2 whitespace-nowrap"
                    >
                      <span className="step-dot"></span>
                      <span className="text-xs font-semibold">3. Preview</span>
                    </button>
                    <div className="step-line"></div>
                    <button
                      type="button"
                      onClick={() => document.getElementById("paperCheckout")?.scrollIntoView({ behavior: "smooth", block: "start" })}
                      className="btn-press surface px-3 py-2 rounded-xl flex items-center gap-2 whitespace-nowrap"
                    >
                      <span className="step-dot"></span>
                      <span className="text-xs font-semibold">4. Checkout</span>
                    </button>
                  </div>
                </section>

                {/* Controls row */}

                <section id="paperSetup" className="glass rounded-2xl shadow-sm border border-slate-100 p-4 space-y-4">
                  <div className="flex flex-wrap gap-4 items-end">
                    <div>
                      <label className="block text-xs font-medium text-slate-600">
                        Base Sheet
                      </label>
                      <select
                        value={sheetKey}
                        onChange={(e) => setSheetKey(e.target.value)}
                        className="border rounded-md px-2 py-1 text-sm"
                      >
                        <option value="8.5x11">8.5 × 11 in</option>
                        <option value="11x17">11 × 17 in</option>
                        <option value="12x18">12 × 18 in</option>
                        <option value="custom">Custom…</option>
                      </select>
                    </div>

                    {sheetKey === "custom" && (
                      <div className="flex items-end gap-3">
                        <div>
                          <label className="block text-xs font-medium text-slate-600">
                            Custom Width (in)
                          </label>
                          <input
                            type="number"
                            min="0.1"
                            step="0.01"
                            value={customSize.w}
                            onChange={(e) =>
                              setCustomSize((s) => ({
                                ...s,
                                w: +e.target.value || 0
                              }))
                            }
                            className="border rounded-md px-2 py-1 text-sm w-24"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-slate-600">
                            Custom Height (in)
                          </label>
                          <input
                            type="number"
                            min="0.1"
                            step="0.01"
                            value={customSize.h}
                            onChange={(e) =>
                              setCustomSize((s) => ({
                                ...s,
                                h: +e.target.value || 0
                              }))
                            }
                            className="border rounded-md px-2 py-1 text-sm w-24"
                          />
                        </div>
                      </div>
                    )}

                    <div className="space-x-2">
                      <span className="text-xs font-medium text-slate-600">
                        Orientation
                      </span>
                      <button
                        onClick={() => setOrientation("portrait")}
                        className={
                          "px-2 py-1 text-xs rounded-md border " +
                          (orientation === "portrait"
                            ? "bg-blue-50 border-blue-400 text-blue-700"
                            : "bg-white border-slate-200 text-slate-700")
                        }
                      >
                        Portrait
                      </button>
                      <button
                        onClick={() => setOrientation("landscape")}
                        className={
                          "px-2 py-1 text-xs rounded-md border " +
                          (orientation === "landscape"
                            ? "bg-blue-50 border-blue-400 text-blue-700"
                            : "bg-white border-slate-200 text-slate-700")
                        }
                      >
                        Landscape
                      </button>
                    </div>

                    <div className="flex items-end gap-3">
                      <div>
                        <label className="block text-xs font-medium text-slate-600">
                          Print Width (in)
                        </label>
                        <input
                          type="number"
                          value={prints.width}
                          onChange={(e) =>
                            setPrints((p) => ({
                              ...p,
                              width: +e.target.value || 0
                            }))
                          }
                          className="border rounded-md px-2 py-1 text-sm w-24"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-600">
                          Print Height (in)
                        </label>
                        <input
                          type="number"
                          value={prints.height}
                          onChange={(e) =>
                            setPrints((p) => ({
                              ...p,
                              height: +e.target.value || 0
                            }))
                          }
                          className="border rounded-md px-2 py-1 text-sm w-24"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-600">
                          Total prints
                        </label>
                        <div className="border rounded-md px-2 py-1 text-sm w-24 bg-slate-50 text-slate-800">
                          {effectivePrintQty}
                        </div>
                        <div className="text-[10px] text-slate-500 mt-1 max-w-[120px]">
                          Set quantities in the file list.
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Paper type & options */}
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div className="space-y-1">
                      <span className="block text-xs font-medium text-slate-600">
                        Paper Type
                      </span>
                      <div className="flex flex-wrap gap-2">
                        {paperTypes.map((opt) => (
                          <button
                            key={opt.key}
                            type="button"
                            onClick={() => setPaperKey(opt.key)}
                            className={
                              "px-3 py-1.5 text-xs rounded-full border " +
                              (paperKey === opt.key
                                ? "bg-blue-600 text-white border-blue-600"
                                : "bg-white text-slate-700 border-slate-200")
                            }
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                      {!comboAllowed && (
                        <p className="text-[11px] text-amber-600">
                          {currentPaper.label} is not normally used on{" "}
                          {sheetKey}. Please double-check this combination.
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-4 text-xs">
                      <label className="flex items-center gap-1">
                        <input
                          type="checkbox"
                          checked={showBleed}
                          onChange={(e) =>
                            setShowBleed(e.target.checked)
                          }
                        />
                        Full bleed (adds 0.125" on each side)
                      </label>
                      <label className="flex items-center gap-1">
                        <input
                          type="checkbox"
                          checked={showCutLines}
                          onChange={(e) =>
                            setShowCutLines(e.target.checked)
                          }
                        />
                        Show cut boxes
                      </label>
                      <label className="flex items-center gap-1">
                        <input
                          type="checkbox"
                          checked={showGuides}
                          onChange={(e) =>
                            setShowGuides(e.target.checked)
                          }
                        />
                        Show margin guides
                      </label>
                    </div>
                  </div>
                </section>

                {/* PREVIEW + CONTROLS */}
                <section id="paperPreview" className="glass rounded-2xl shadow-sm border border-slate-100 p-3 space-y-4">
                  <div id="paperUpload" className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-1">
                    <div>
                      <h2 className="text-sm font-semibold text-slate-800">Upload & Preview</h2>
                      <p className="text-[11px] text-slate-500">Tap a file on the sheet to select it. Use Prev/Next to page multi-sheet jobs.</p>
                    </div>
                    <div className="md:hidden surface p-1 rounded-2xl flex w-full sm:w-auto">
                      <button type="button" onClick={() => setPreviewSide("front")} className={"btn-press flex-1 px-3 py-2 rounded-xl text-xs font-semibold " + (previewSide === "front" ? "bg-blue-600 text-white" : "bg-transparent text-slate-700")}>Front</button>
                      <button type="button" onClick={() => setPreviewSide("back")} className={"btn-press flex-1 px-3 py-2 rounded-xl text-xs font-semibold " + (previewSide === "back" ? "bg-blue-600 text-white" : "bg-transparent text-slate-700")}>Back</button>
                    </div>
                  </div>

                  <div className="grid md:grid-cols-2 gap-6">
                  {/* FRONT */}
                  <div className={"surface rounded-2xl shadow-sm border border-slate-100 p-4 space-y-3 " + (previewSide === "front" ? "" : "hidden md:block")}>
                    <div className="flex items-center justify-between">
                      <h2 className="font-semibold text-slate-800 text-sm">
                        Front
                      </h2>
                      <div className="flex items-center gap-3 text-xs">
                        <span className="text-slate-500">
                          Color mode:
                        </span>
                        <button
                          onClick={() =>
                            setFrontColorMode("color")
                          }
                          className={
                            "px-2 py-1 rounded-md border " +
                            (frontColorMode === "color"
                              ? "bg-blue-50 border-blue-400 text-blue-700"
                              : "bg-white border-slate-200 text-slate-700")
                          }
                        >
                          Color
                        </button>
                        <button
                          onClick={() => setFrontColorMode("bw")}
                          className={
                            "px-2 py-1 rounded-md border " +
                            (frontColorMode === "bw"
                              ? "bg-blue-50 border-blue-400 text-blue-700"
                              : "bg-white border-slate-200 text-slate-700")
                          }
                        >
                          B/W
                        </button>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-3 text-xs">
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        onChange={(e) => {
                          const files = Array.from(e.target.files || []);
                          if (!files.length) return;
                          const defaultQty = Math.max(1, Number(copiesPerFile) || 1);
                          const newItems = files.map((file) => ({
                            id: `f_${Date.now()}_${Math.random().toString(16).slice(2)}`,
                            file,
                            name: file.name,
                            rotation: 0,
                            qty: defaultQty
                          }));
                          setFrontFiles((prev) => {
                            const next = [...(prev || []), ...newItems];
                            return next;
                          });
                          setFrontImage(files[0]); // legacy single-image support
                          // auto-select first new item if nothing selected
                          setSelectedFrontId((cur) => cur || newItems[0]?.id || null);
                          e.target.value = "";
                        }}
                        className="border rounded-md px-2 py-1 text-xs"
                      />

                      <div className="w-full flex flex-wrap items-center gap-2">
                        <label className="flex items-center gap-2 text-[11px] text-slate-600">
                          <span>Default qty (new files)</span>
                          <input
                            type="number"
                            min="1"
                            value={copiesPerFile}
                            onChange={(e) =>
                              setCopiesPerFile(Math.max(1, +e.target.value || 1))
                            }
                            className="border rounded-md px-2 py-1 text-xs w-24 text-right"
                          />
                        </label>

                        <button
                          type="button"
                          disabled={!frontFiles.length}
                          onClick={() => {
                            const q = Math.max(1, Number(copiesPerFile) || 1);
                            setFrontFiles((prev) => (prev || []).map((it) => ({ ...it, qty: q })));
                          }}
                          className="px-2 py-1 border rounded-md bg-white text-slate-700 disabled:opacity-50"
                          title="Apply default qty to all uploaded files"
                        >
                          Apply qty to all
                        </button>

                        <label className="flex items-center gap-2 text-[11px] text-slate-600">
                          <input
                            type="checkbox"
                            checked={autoQtyFromFiles}
                            onChange={(e) => setAutoQtyFromFiles(e.target.checked)}
                          />
                          Auto-set overall quantity from files
                        </label>

                        {frontFiles.length > 0 && (
                          <button
                            type="button"
                            onClick={() => {
                              setFrontFiles([]);
                              setSelectedFrontId(null);
                              setFrontImage(null);
                            }}
                            className="px-2 py-1 border rounded-md bg-white text-slate-700"
                          >
                            Clear files ({frontFiles.length})
                          </button>
                        )}
                      </div>

                      {/* File list + per-file controls */}
                      {frontFiles.length > 0 && (
                        <div className="w-full space-y-2">
                          <div className="flex flex-wrap gap-2">
                            {frontFiles.slice(0, 18).map((it) => (
                              <button
                                key={it.id}
                                type="button"
                                onClick={() => setSelectedFrontId(it.id)}
                                className={
                                  "inline-flex items-center gap-2 px-2 py-1 rounded-full border text-[11px] bg-white max-w-full " +
                                  (selectedFrontId === it.id
                                    ? "border-blue-400 bg-blue-50"
                                    : "border-slate-200")
                                }
                                title={it.name}
                              >
                                <span className="max-w-[160px] truncate">{it.name}</span>
                                <span className="text-slate-500">×{Math.max(0, Number(it.qty) || 0)}</span>
                                <span className="text-slate-500">{(Number(it.rotation) || 0)}°</span>
                                <span
                                  className="text-red-500"
                                  title="Remove"
                                  onClick={(ev) => {
                                    ev.preventDefault();
                                    ev.stopPropagation();
                                    setFrontFiles((prev) => {
                                      const next = (prev || []).filter((x) => x.id !== it.id);
                                      // keep selection sane
                                      if (selectedFrontId === it.id) {
                                        setSelectedFrontId(next[0]?.id || null);
                                      }
                                      return next;
                                    });
                                  }}
                                >
                                  ✕
                                </span>
                              </button>
                            ))}
                            {frontFiles.length > 18 && (
                              <span className="text-[11px] text-slate-500">
                                +{frontFiles.length - 18} more
 
                          <div className="w-full">
                            <div className="surface rounded-2xl border border-slate-100 p-3">
                              <div className="flex items-center justify-between gap-2">
                                <div>
                                  <div className="text-xs font-semibold text-slate-800">File order</div>
                                  <div className="text-[11px] text-slate-500">Drag to reorder (desktop) or use arrows (mobile). Order affects how the preview is filled and exported.</div>
                                </div>
                              </div>

                              <ul className="mt-2 space-y-1">
                                {frontFiles.map((it, idx) => (
                                  <li
                                    key={"row_" + it.id}
                                    draggable
                                    onDragStart={() => { dragFrontIdRef.current = it.id; }}
                                    onDragEnter={() => { dragOverFrontIdRef.current = it.id; }}
                                    onDragOver={(e) => { e.preventDefault(); }}
                                    onDrop={(e) => {
                                      e.preventDefault();
                                      const active = dragFrontIdRef.current;
                                      const over = it.id;
                                      setFrontFiles((prev) => reorderByIds(prev || [], active, over));
                                      dragFrontIdRef.current = null;
                                      dragOverFrontIdRef.current = null;
                                    }}
                                    className={
                                      "flex items-center gap-2 px-2 py-2 rounded-xl border bg-white " +
                                      (selectedFrontId === it.id ? "border-blue-400 bg-blue-50" : "border-slate-200")
                                    }
                                  >
                                    <span className="select-none text-slate-400 cursor-grab" title="Drag to reorder">⋮⋮</span>

                                    <button
                                      type="button"
                                      onClick={() => setSelectedFrontId(it.id)}
                                      className="flex-1 text-left text-[11px] font-semibold text-slate-800 truncate"
                                      title={it.name}
                                    >
                                      {idx + 1}. {it.name}
                                    </button>

                                    <span className="text-[11px] text-slate-500">×{Math.max(0, Number(it.qty) || 0)}</span>

                                    <div className="flex items-center gap-1">
                                      <button
                                        type="button"
                                        className="btn-press px-2 py-1 rounded-lg border bg-white text-[11px]"
                                        onClick={() => setFrontFiles((prev) => {
                                          const arr = prev || [];
                                          if (idx <= 0) return arr;
                                          return moveItem(arr, idx, idx - 1);
                                        })}
                                        title="Move up"
                                      >
                                        ↑
                                      </button>
                                      <button
                                        type="button"
                                        className="btn-press px-2 py-1 rounded-lg border bg-white text-[11px]"
                                        onClick={() => setFrontFiles((prev) => {
                                          const arr = prev || [];
                                          if (idx >= arr.length - 1) return arr;
                                          return moveItem(arr, idx, idx + 1);
                                        })}
                                        title="Move down"
                                      >
                                        ↓
                                      </button>
                                    </div>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          </div>
                             </span>
                            )}
                          </div>

                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-[11px] text-slate-500">
                              Click a print on the preview (or a pill above) to select a file.
                            </span>

                            {(() => {
                              const sel = frontFiles.find((f) => f.id === selectedFrontId);
                              if (!sel) return null;
                              return (
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="text-[11px] text-slate-600">Selected:</span>
                                  <span className="text-[11px] font-semibold text-slate-800 max-w-[220px] truncate" title={sel.name}>{sel.name}</span>

                                  <label className="flex items-center gap-2 text-[11px] text-slate-600">
                                    <span>Qty</span>
                                    <input
                                      type="number"
                                      min="0"
                                      value={Math.max(0, Number(sel.qty) || 0)}
                                      onChange={(e) => {
                                        const v = Math.max(0, Number(e.target.value) || 0);
                                        setFrontFiles((prev) => (prev || []).map((x) => x.id === sel.id ? { ...x, qty: v } : x));
                                      }}
                                      className="border rounded-md px-2 py-1 text-xs w-20 text-right"
                                    />
                                  </label>

                                  <button
                                    type="button"
                                    onClick={() =>
                                      setFrontFiles((prev) =>
                                        (prev || []).map((x) =>
                                          x.id === sel.id
                                            ? { ...x, rotation: ((Number(x.rotation) || 0) + 90) % 360 }
                                            : x
                                        )
                                      )
                                    }
                                    className="px-2 py-1 border rounded-md bg-white text-slate-700"
                                  >
                                    Rotate selected 90°
                                  </button>
                                </div>
                              );
                            })()}

                            <button
                              type="button"
                              onClick={() => {
                                if (frontFiles.length) {
                                  // Rotate all uploaded files
                                  setFrontFiles((prev) =>
                                    (prev || []).map((x) => ({
                                      ...x,
                                      rotation: ((Number(x.rotation) || 0) + 90) % 360
                                    }))
                                  );
                                } else {
                                  // Legacy single file
                                  setFrontRotation((r) => (r + 90) % 360);
                                }
                              }}
                              className="px-2 py-1 border rounded-md bg-white text-slate-700"
                            >
                              Rotate all 90°
                            </button>
                          </div>

                          {/* Paging controls */}
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-[11px] text-slate-500">
                              Layout: {frontSlotInfo.cols}×{frontSlotInfo.rows} = {frontSlotInfo.perSheet}/sheet · Total prints: {frontTotalPrints}
                            </span>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                disabled={frontTotalPages <= 1 || frontPreviewPage <= 0}
                                onClick={() => setFrontPreviewPage((p) => Math.max(0, p - 1))}
                                className="px-2 py-1 border rounded-md bg-white text-slate-700 disabled:opacity-50"
                              >
                                Prev
                              </button>
                              <span className="text-[11px] text-slate-600">
                                Page {frontPreviewPage + 1} of {frontTotalPages}
                              </span>
                              <button
                                type="button"
                                disabled={frontTotalPages <= 1 || frontPreviewPage >= frontTotalPages - 1}
                                onClick={() => setFrontPreviewPage((p) => Math.min(frontTotalPages - 1, p + 1))}
                                className="px-2 py-1 border rounded-md bg-white text-slate-700 disabled:opacity-50"
                              >
                                Next
                              </button>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Legacy single-image rotate */}
                      {!frontFiles.length && (
                        <button
                          onClick={() => setFrontRotation((r) => (r + 90) % 360)}
                          className="px-3 py-1 border rounded-md bg-white text-slate-700"
                        >
                          Rotate 90°
                        </button>
                      )}
                    </div>
                    <div className="preview-stage">
                      <div className="tool-drawer">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold text-slate-800">Preview tools</span>
                            <span className="text-[11px] text-slate-500">Zoom, guides, and quick actions</span>
                          </div>
                          <button
                            type="button"
                            onClick={toggleTools}
                            className="btn-press px-2 py-1 rounded-lg border bg-white text-[11px] text-slate-700"
                          >
                            {toolsOpen ? "Hide" : "Show"}
                          </button>
                        </div>

                        {toolsOpen && (
                          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                            <div className="surface p-1 rounded-2xl flex items-center gap-1">
                              <button type="button" onClick={() => handleFrontZoom(-0.1)} className="btn-press px-2 py-1 rounded-xl border bg-white">−</button>
                              <input
                                type="range"
                                min={ZOOM_MIN}
                                max={ZOOM_MAX}
                                step="0.05"
                                value={frontZoom}
                                onChange={(e) => setFrontZoom(clampZoom(e.target.value))}
                                className="w-28"
                              />
                              <button type="button" onClick={() => handleFrontZoom(0.1)} className="btn-press px-2 py-1 rounded-xl border bg-white">+</button>
                              <button type="button" onClick={() => setFrontZoom(1)} className="btn-press px-2 py-1 rounded-xl border bg-white text-[11px]">100%</button>
                            </div>

                            <label className="btn-press inline-flex items-center gap-2 px-2 py-1 rounded-xl border bg-white text-[11px] text-slate-700">
                              <input type="checkbox" checked={showGuides} onChange={(e) => setShowGuides(e.target.checked)} />
                              Guides
                            </label>

                            <label className="btn-press inline-flex items-center gap-2 px-2 py-1 rounded-xl border bg-white text-[11px] text-slate-700">
                              <input type="checkbox" checked={showCutLines} onChange={(e) => setShowCutLines(e.target.checked)} />
                              Cut lines
                            </label>

                            <label className="btn-press inline-flex items-center gap-2 px-2 py-1 rounded-xl border bg-white text-[11px] text-slate-700">
                              <input type="checkbox" checked={showBleed} onChange={(e) => setShowBleed(e.target.checked)} />
                              Bleed
                            </label>

                            {frontFiles?.length > 0 && (
                              <div className="flex items-center gap-1 ml-auto">
                                <button type="button" onClick={() => nudgeFile(-1)} className="btn-press px-2 py-1 rounded-xl border bg-white text-[11px]">Move ↑</button>
                                <button type="button" onClick={() => nudgeFile(1)} className="btn-press px-2 py-1 rounded-xl border bg-white text-[11px]">Move ↓</button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      <div className="preview-viewport">
                        <div
                          className="min-w-full"
                          style={{ transform: `scale(${frontZoom})`, transformOrigin: "top left" }}
                        >
                          <canvas
                            ref={frontRef}
                            onClick={handleFrontCanvasClick}
                            onWheel={handleFrontCanvasWheel}
                            style={{ cursor: frontFiles.length ? "pointer" : "default" }}
                            className="w-full h-auto border border-dashed border-slate-300 rounded-md bg-slate-50"
                          />
                        </div>
                      </div>
                    </div>
                    <p className="text-[11px] text-slate-500">
                      Zoom: {Math.round((Number(frontZoom) || 1) * 100)}% · Sheet: {orientedWIn.toFixed(2)}" ×{" "}
                      {orientedHIn.toFixed(2)}" · Margins: 0.1" · Spacing: 0.05"
                    </p>
                  </div>

                  {/* BACK */}
                  <div className={"surface rounded-2xl shadow-sm border border-slate-100 p-4 space-y-3 " + (previewSide === "back" ? "" : "hidden md:block")}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <h2 className="font-semibold text-slate-800 text-sm">
                          Back
                        </h2>
                        <label className="flex items-center gap-1 text-xs text-slate-600">
                          <input
                            type="checkbox"
                            checked={showBack}
                            onChange={(e) =>
                              setShowBack(e.target.checked)
                            }
                          />
                          Enable
                        </label>
                      </div>
                      <div className="flex items-center gap-3 text-xs">
                        <span className="text-slate-500">
                          Color mode:
                        </span>
                        <button
                          onClick={() => setBackColorMode("color")}
                          disabled={!showBack}
                          className={
                            "px-2 py-1 rounded-md border " +
                            (backColorMode === "color"
                              ? "bg-blue-50 border-blue-400 text-blue-700"
                              : "bg-white border-slate-200 text-slate-700") +
                            (!showBack ? " opacity-50" : "")
                          }
                        >
                          Color
                        </button>
                        <button
                          onClick={() => setBackColorMode("bw")}
                          disabled={!showBack}
                          className={
                            "px-2 py-1 rounded-md border " +
                            (backColorMode === "bw"
                              ? "bg-blue-50 border-blue-400 text-blue-700"
                              : "bg-white border-slate-200 text-slate-700") +
                            (!showBack ? " opacity-50" : "")
                          }
                        >
                          B/W
                        </button>
                      </div>
                    </div>

                    {showBack && (
                      <>
                        <div className="flex flex-wrap items-center gap-3 text-xs">
                          <input
                            type="file"
                            accept="image/*"
                            onChange={(e) => {
                              const f = e.target.files[0];
                              if (!f) return;
                              setBackImage(f);
                            }}
                            className="border rounded-md px-2 py-1 text-xs"
                          />
                          <button
                            onClick={() =>
                              setBackRotation((r) => (r + 90) % 360)
                            }
                            className="px-3 py-1 border rounded-md bg-white text-slate-700"
                          >
                            Rotate 90°
                          </button>
                        </div>
                        <div className="preview-stage">
                          <div className="tool-drawer">
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-semibold text-slate-800">Preview tools</span>
                                <span className="text-[11px] text-slate-500">Zoom and guides</span>
                              </div>
                              <button
                                type="button"
                                onClick={toggleTools}
                                className="btn-press px-2 py-1 rounded-lg border bg-white text-[11px] text-slate-700"
                              >
                                {toolsOpen ? "Hide" : "Show"}
                              </button>
                            </div>

                            {toolsOpen && (
                              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                                <div className="surface p-1 rounded-2xl flex items-center gap-1">
                                  <button type="button" onClick={() => handleBackZoom(-0.1)} className="btn-press px-2 py-1 rounded-xl border bg-white">−</button>
                                  <input
                                    type="range"
                                    min={ZOOM_MIN}
                                    max={ZOOM_MAX}
                                    step="0.05"
                                    value={backZoom}
                                    onChange={(e) => setBackZoom(clampZoom(e.target.value))}
                                    className="w-28"
                                  />
                                  <button type="button" onClick={() => handleBackZoom(0.1)} className="btn-press px-2 py-1 rounded-xl border bg-white">+</button>
                                  <button type="button" onClick={() => setBackZoom(1)} className="btn-press px-2 py-1 rounded-xl border bg-white text-[11px]">100%</button>
                                </div>

                                <label className="btn-press inline-flex items-center gap-2 px-2 py-1 rounded-xl border bg-white text-[11px] text-slate-700">
                                  <input type="checkbox" checked={showGuides} onChange={(e) => setShowGuides(e.target.checked)} />
                                  Guides
                                </label>

                                <label className="btn-press inline-flex items-center gap-2 px-2 py-1 rounded-xl border bg-white text-[11px] text-slate-700">
                                  <input type="checkbox" checked={showCutLines} onChange={(e) => setShowCutLines(e.target.checked)} />
                                  Cut lines
                                </label>

                                <label className="btn-press inline-flex items-center gap-2 px-2 py-1 rounded-xl border bg-white text-[11px] text-slate-700">
                                  <input type="checkbox" checked={showBleed} onChange={(e) => setShowBleed(e.target.checked)} />
                                  Bleed
                                </label>
                              </div>
                            )}
                          </div>

                          <div className="preview-viewport">
                            <div
                              className="min-w-full"
                              style={{ transform: `scale(${backZoom})`, transformOrigin: "top left" }}
                            >
                              <canvas
                                ref={backRef}
                                className="w-full h-auto border border-dashed border-slate-300 rounded-md bg-slate-50"
                              />
                            </div>
                          </div>
                        </div>                      </>
                    )}

                    {!showBack && (
                      <p className="text-[11px] text-slate-400">
                        Enable back printing to layout the reverse side.
                      </p>
                    )}
                  </div>
                  </div>
                </section>

                {/* SUMMARY + ACTIONS */}
                <section id="paperCheckout" className="glass rounded-2xl shadow-sm border border-slate-100 p-4 flex flex-wrap items-center justify-between gap-4">
                  <div className="space-y-1 text-sm">
                    <p>
                      <span className="text-slate-500">
                        Sheets needed:
                      </span>{" "}
                      <span className="font-semibold">
                        {sheetsNeeded}
                      </span>
                    </p>
                    <p className="text-xs text-slate-500">
                      Sheet size: {sheetKey} · Paper:{" "}
                      {currentPaper.label}
                    </p>
                    <p className="text-xs text-slate-500">
                      Front per sheet: $
                      {effectiveFrontPerSheet.toFixed(4)} · Back per
                      sheet: ${effectiveBackPerSheet.toFixed(4)} ·
                      Discount factor: {discountFactor.toFixed(3)}
                    </p>
                    <p className="text-base font-semibold text-slate-900">
                      Estimated total: $
                      {totalPrice.toFixed(2)}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <button
                      onClick={downloadSheetPDF}
                      className="btn-press px-4 py-2 rounded-full bg-blue-600 text-white text-sm shadow-sm hover:bg-blue-700"
                    >
                      Download Preview (PDF)
                    </button>
                    <button
                      onClick={orderSheetJob}
                      className="btn-press px-4 py-2 rounded-full bg-emerald-600 text-white text-sm shadow-sm hover:bg-emerald-700"
                    >
                      Order Prints (Email to Store)
                    </button>
                  </div>
                </section>

                {/* LARGE FORMAT SECTION */}                  </>
                )}

                {layoutPage === "large" && (
                  <>

                <section className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <h2 className="font-semibold text-slate-800 text-sm">
                      Large Format Printing
                    </h2>
                    <p className="text-xs text-slate-500">
                      Max width: 36"
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-4 items-end text-sm">
                    
<SmartNumberInput
  label="Width (in)"
  value={lfWidth}
  onValue={(v) => setLfWidth(Math.max(0.1, v))}
  min={0.1}
  max={999}
  placeholder="e.g. 24"
/>
<SmartNumberInput
  label="Height (in)"
  value={lfHeight}
  onValue={(v) => setLfHeight(Math.max(0.1, v))}
  min={0.1}
  max={999}
  placeholder="e.g. 36"
/>

                    <div>
                      <label className="block text-xs font-medium text-slate-600">
                        Paper Type
                      </label>
                      <select
                        value={lfPaperKey}
                        onChange={(e) =>
                          setLfPaperKey(e.target.value)
                        }
                        className="border rounded-md px-2 py-1 text-sm"
                      >
                        {lfPaperTypes.map((p) => (
                          <option key={p.key} value={p.key}>
                            {p.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-x-2">
                      <span className="text-xs font-medium text-slate-600">
                        Color
                      </span>
                      <button
                        onClick={() => setLfColorMode("color")}
                        className={
                          "px-2 py-1 text-xs rounded-md border " +
                          (lfColorMode === "color"
                            ? "bg-blue-50 border-blue-400 text-blue-700"
                            : "bg-white border-slate-200 text-slate-700")
                        }
                      >
                        Color
                      </button>
                      <button
                        onClick={() => setLfColorMode("bw")}
                        className={
                          "px-2 py-1 text-xs rounded-md border " +
                          (lfColorMode === "bw"
                            ? "bg-blue-50 border-blue-400 text-blue-700"
                            : "bg-white border-slate-200 text-slate-700")
                        }
                      >
                        B/W
                      </button>
                    </div>
                    <label className="flex items-center gap-1 text-xs text-slate-600">
                      <input
                        type="checkbox"
                        checked={lfMaintainProp}
                        onChange={(e) =>
                          setLfMaintainProp(e.target.checked)
                        }
                      />
                      Keep image proportions
                    </label>
                  </div>

                  <div className="flex flex-wrap items-center gap-3 text-xs">
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => {
                        const f = e.target.files[0];
                        if (!f) return;
                        setLfImage(f);
                      }}
                      className="border rounded-md px-2 py-1 text-xs"
                    />
                    <button
                      onClick={() =>
                        setLfRotation((r) => (r + 90) % 360)
                      }
                      className="px-3 py-1 border rounded-md bg-white text-slate-700"
                    >
                      Rotate 90°
                    </button>
                    <label className="flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={lfGrommets}
                        onChange={(e) =>
                          setLfGrommets(e.target.checked)
                        }
                      />
                      Grommets
                    </label>
                    <label className="flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={lfFoamCore}
                        onChange={(e) =>
                          setLfFoamCore(e.target.checked)
                        }
                      />
                      Foam Core
                    </label>
                    <label className="flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={lfCoroSign}
                        onChange={(e) =>
                          setLfCoroSign(e.target.checked)
                        }
                      />
                      Coro Sign
                    </label>
                  </div>

                  <canvas
                    ref={lfRef}
                    className="w-full h-auto border border-dashed border-slate-300 rounded-md bg-slate-50"
                  />

                  <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
                    <div className="space-y-1">
                      <p>
                        Area:{" "}
                        <span className="font-semibold">
                          {lfAreaSqFt.toFixed(2)} sq ft
                        </span>
                      </p>
                      <p className="text-xs text-slate-500">
                        Base per sq ft (with markup): $
                        {lfBase.toFixed(4)} · Add-ons: $
                        {lfAddonTotal.toFixed(2)}
                      </p>
                      <p className="text-base font-semibold text-slate-900">
                        Estimated total: $
                        {lfTotalWithDiscount.toFixed(2)}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-3">
                      <button
                        onClick={downloadLfPDF}
                        className="px-4 py-2 rounded-full bg-blue-600 text-white text-sm shadow-sm hover:bg-blue-700"
                      >
                        Download Large Format PDF
                      </button>
                      <button
                        onClick={orderLargeFormatJob}
                        className="px-4 py-2 rounded-full bg-emerald-600 text-white text-sm shadow-sm hover:bg-emerald-700"
                      >
                        Order Large Format (Email)
                      </button>
                    </div>
                  </div>
                </section>
                {/* BLUEPRINT SECTION */}                  </>
                )}

                {layoutPage === "blueprint" && (
                  <>

                <section className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <h2 className="font-semibold text-slate-800 text-sm">
                      Blueprint Printing
                    </h2>
                    <p className="text-xs text-slate-500">
                      20lb plain bond only · B/W
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-4 items-end text-sm">
                    <div>
                      <label className="block text-xs font-medium text-slate-600">
                        Blueprint size
                      </label>
                      <select
                        value={bpSizeKey}
                        onChange={(e) => setBpSizeKey(e.target.value)}
                        className="border rounded-md px-2 py-1 text-sm"
                      >
                        {BLUEPRINT_SIZES.map((s) => (
                          <option key={s.key} value={s.key}>
                            {s.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-600">
                        Quantity (sheets)
                      </label>
                      <input
                        type="number"
                        min="1"
                        value={bpQty}
                        onChange={(e) => setBpQty(+e.target.value || 1)}
                        className="border rounded-md px-2 py-1 text-sm w-28"
                      />
                    </div>

                    <label className="flex items-center gap-1 text-xs text-slate-600">
                      <input
                        type="checkbox"
                        checked={bpMaintainProp}
                        onChange={(e) => setBpMaintainProp(e.target.checked)}
                      />
                      Keep image proportions
                    </label>
                  </div>

                  <div className="flex flex-wrap items-center gap-3 text-xs">
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => {
                        const f = e.target.files[0];
                        if (!f) return;
                        setBpImage(f);
                      }}
                      className="border rounded-md px-2 py-1 text-xs"
                    />
                    <button
                      onClick={() => setBpRotation((r) => (r + 90) % 360)}
                      className="px-3 py-1 border rounded-md bg-white text-slate-700"
                    >
                      Rotate 90°
                    </button>
                  </div>

                  <canvas
                    ref={bpRef}
                    className="w-full h-auto border border-dashed border-slate-300 rounded-md bg-slate-50"
                  />

                  <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
                    <div className="space-y-1">
                      <p>
                        Size:{" "}
                        <span className="font-semibold">
                          {bpSize.label}
                        </span>{" "}
                        · Qty:{" "}
                        <span className="font-semibold">{bpQty}</span>
                      </p>
                      <p className="text-xs text-slate-500">
                        Area / sheet: {bpAreaPerSheetSqFt.toFixed(2)} sq ft · PSF: $
                        {bpPsf.toFixed(2)} · Per sheet: $
                        {bpPerSheet.toFixed(2)}
                      </p>
                      <p className="text-base font-semibold text-slate-900">
                        Estimated total: ${bpTotal.toFixed(2)}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        Tier rule is editable in Admin per size (PSF + quantity
                        breaks).
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-3">
                      <button
                        onClick={downloadBlueprintPDF}
                        className="px-4 py-2 rounded-full bg-blue-600 text-white text-sm shadow-sm hover:bg-blue-700"
                      >
                        Download Blueprint PDF
                      </button>
                      <button
                        onClick={orderBlueprintJob}
                        className="px-4 py-2 rounded-full bg-emerald-600 text-white text-sm shadow-sm hover:bg-emerald-700"
                      >
                        Order Blueprints (Email)
                      </button>
                    </div>
                  </div>
                </section>

                  </>
                )}

              </div>
            )}

            {/* QUICK QUOTE VIEW */}
            {viewMode === "quote" && (
              <section className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4 space-y-4">
                <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
                  <div className="space-y-2">
                    <h2 className="font-semibold text-slate-800 text-sm">
                      Quick Quote (Sheets)
                    </h2>
                    <p className="text-xs text-slate-500 max-w-xl">
                      Enter a print size and quantity, and we’ll show
                      pricing for your selected paper type (or all paper types if enabled), using your current markup and discounts.
                    </p>
                    <p className="text-xs text-slate-600">
                      Showing:{" "}
                      {quoteShowAllPapers
                        ? "All paper types"
                        : (paperTypes.find((p) => p.key === quotePaperKey) || {})
                            .label}
                    </p>
                    {quoteBackEnabled && (
                      <p className="text-xs text-amber-600">
                        Back printing is enabled for this quote. Make
                        sure the document is prepared as duplex.
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-3 text-sm">
                    <div>
                      <label className="block text-xs font-medium text-slate-600">
                        Paper type
                      </label>
                      <select
                        value={quotePaperKey}
                        onChange={(e) => setQuotePaperKey(e.target.value)}
                        className="border rounded-md px-2 py-1 text-sm"
                      >
                        {paperTypes.map((pt) => (
                          <option key={pt.key} value={pt.key}>
                            {pt.label}
                          </option>
                        ))}
                      </select>
                      <label className="mt-1 flex items-center gap-2 text-[11px] text-slate-600">
                        <input
                          type="checkbox"
                          checked={quoteShowAllPapers}
                          onChange={(e) =>
                            setQuoteShowAllPapers(e.target.checked)
                          }
                        />
                        Show all paper types
                      </label>
                    </div>

                    <div className="flex items-end">
                      <button
                        type="button"
                        onClick={printQuickQuote}
                        className="px-3 py-2 rounded-full bg-slate-800 text-white text-sm shadow-sm hover:bg-slate-900"
                      >
                        Print Quote
                      </button>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-600">
                        Width (in)
                      </label>
                      <input
                        type="number"
                        value={quoteWidth}
                        onChange={(e) =>
                          setQuoteWidth(+e.target.value || 0)
                        }
                        className="border rounded-md px-2 py-1 text-sm w-20"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600">
                        Height (in)
                      </label>
                      <input
                        type="number"
                        value={quoteHeight}
                        onChange={(e) =>
                          setQuoteHeight(+e.target.value || 0)
                        }
                        className="border rounded-md px-2 py-1 text-sm w-20"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600">
                        Quantity
                      </label>
                      <input
                        type="number"
                        value={quoteQty}
                        onChange={(e) =>
                          setQuoteQty(+e.target.value || 0)
                        }
                        className="border rounded-md px-2 py-1 text-sm w-24"
                      />
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-4 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="text-slate-600">
                      Front color:
                    </span>
                    <button
                      onClick={() =>
                        setQuoteFrontColorMode("color")
                      }
                      className={
                        "px-2 py-1 rounded-md border " +
                        (quoteFrontColorMode === "color"
                          ? "bg-blue-50 border-blue-400 text-blue-700"
                          : "bg-white border-slate-200 text-slate-700")
                      }
                    >
                      Color
                    </button>
                    <button
                      onClick={() => setQuoteFrontColorMode("bw")}
                      className={
                        "px-2 py-1 rounded-md border " +
                        (quoteFrontColorMode === "bw"
                          ? "bg-blue-50 border-blue-400 text-blue-700"
                          : "bg-white border-slate-200 text-slate-700")
                      }
                    >
                      B/W
                    </button>
                  </div>
                  <label className="flex items-center gap-1 text-slate-600">
                    <input
                      type="checkbox"
                      checked={quoteBackEnabled}
                      onChange={(e) =>
                        setQuoteBackEnabled(e.target.checked)
                      }
                    />
                    Include back printing
                  </label>
                  {quoteBackEnabled && (
                    <div className="flex items-center gap-2">
                      <span className="text-slate-600">
                        Back color:
                      </span>
                      <button
                        onClick={() =>
                          setQuoteBackColorMode("color")
                        }
                        className={
                          "px-2 py-1 rounded-md border " +
                          (quoteBackColorMode === "color"
                            ? "bg-blue-50 border-blue-400 text-blue-700"
                            : "bg-white border-slate-200 text-slate-700")
                        }
                      >
                        Color
                      </button>
                      <button
                        onClick={() =>
                          setQuoteBackColorMode("bw")
                        }
                        className={
                          "px-2 py-1 rounded-md border " +
                          (quoteBackColorMode === "bw"
                            ? "bg-blue-50 border-blue-400 text-blue-700"
                            : "bg-white border-slate-200 text-slate-700")
                        }
                      >
                        B/W
                      </button>
                    </div>
                  )}
                </div>

                {/* Simple sheet count calculator for duplex docs */}
                <div className="border rounded-xl p-3 bg-slate-50/60 text-xs flex flex-wrap items-end gap-3">
                  <div>
                    <label className="block font-medium text-slate-700">
                      Document pages
                    </label>
                    <input
                      type="number"
                      value={quoteDocPages}
                      onChange={(e) =>
                        setQuoteDocPages(+e.target.value || 0)
                      }
                      className="border rounded-md px-2 py-1 text-xs w-20"
                    />
                  </div>
                  <label className="flex items-center gap-1 text-slate-700">
                    <input
                      type="checkbox"
                      checked={quoteDocDuplex}
                      onChange={(e) =>
                        setQuoteDocDuplex(e.target.checked)
                      }
                    />
                    Print front & back (duplex)
                  </label>
                  <div className="text-slate-700">
                    {quoteDocPages > 0 && (
                      <span>
                        This will use{" "}
                        <span className="font-semibold">
                          {docSheetsNeeded}
                        </span>{" "}
                        sheet
                        {docSheetsNeeded === 1 ? "" : "s"}.
                      </span>
                    )}
                  </div>
                </div>

                {/* Results */}
                <div className="overflow-auto border rounded-xl">
                  <table className="min-w-full text-[11px]">
                    <thead className="bg-slate-100">
                      <tr>
                        {quoteShowAllPapers && (
                          <th className="px-2 py-1 text-left">
                            Paper Type
                          </th>
                        )}
                        <th className="px-2 py-1 text-left">
                          Sheet Size
                        </th>
                        <th className="px-2 py-1 text-right">
                          Prints/Sheet
                        </th>
                        <th className="px-2 py-1 text-right">
                          Sheets Needed
                        </th>
                        <th className="px-2 py-1 text-right">
                          Front/Back per Sheet
                        </th>
                        <th className="px-2 py-1 text-right">
                          Estimated Total
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {quoteRows.length === 0 && (
                        <tr>
                          <td
                            colSpan={6}
                            className="px-3 py-4 text-center text-slate-400"
                          >
                            No valid pricing found. Check your Admin
                            pricing setup.
                          </td>
                        </tr>
                      )}
                      {quoteRows.map((row, idx) => {
                        const isBest =
                          bestQuote &&
                          row.paperLabel === bestQuote.paperLabel &&
                          row.sheetKey === bestQuote.sheetKey &&
                          row.total === bestQuote.total;
                        return (
                          <tr
                            key={idx}
                            className={
                              "border-t " +
                              (isBest
                                ? "bg-emerald-50/60"
                                : "bg-white")
                            }
                          >
                            {quoteShowAllPapers && (
                              <td className="px-2 py-1">
                                {row.paperLabel}
                              </td>
                            )}
                            <td className="px-2 py-1">
                              {row.sheetKey}
                            </td>
<td className="px-2 py-1 text-right">
  <div className="font-semibold">{row.printsPer}</div>
  {row.layout && (
    <div className="text-[10px] text-slate-500 leading-tight">
      {row.layout.cols}×{row.layout.rows} · sheet{" "}
      {row.layout.sheetOrientation}
      {row.layout.printRotated ? " · print rotated" : ""}
    </div>
  )}
</td>
                            <td className="px-2 py-1 text-right">
                              {row.sheets}
                            </td>
                            <td className="px-2 py-1 text-right">
                              ${row.perSheetFront.toFixed(4)} / $
                              {row.perSheetBack.toFixed(4)}
                            </td>
                            <td className="px-2 py-1 text-right font-semibold">
                              ${row.total.toFixed(2)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {bestQuote && (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
                    Recommended:{" "}
                    <span className="font-semibold">
                      {bestQuote.paperLabel} on {bestQuote.sheetKey}
                    </span>{" "}
                    — {bestQuote.printsPer} per sheet,{" "}
                    {bestQuote.sheets} sheets, approx.{" "}
                    <span className="font-semibold">
                      ${bestQuote.total.toFixed(2)}
                    </span>
                    .
                  </div>
                )}


                <div className="grid md:grid-cols-2 gap-4 pt-2">
                  <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <div className="text-xs font-semibold text-slate-800">Quick Quote (Large Format)</div>
                        <div className="text-[11px] text-slate-500">Estimate large format jobs by size, paper, color, and add-ons.</div>
                      </div>
                      <button
                        type="button"
                        onClick={printLargeFormatQuote}
                        className="px-3 py-2 rounded-full bg-slate-800 text-white text-xs shadow-sm hover:bg-slate-900"
                      >
                        Print Quote
                      </button>
                    </div>

                    <div className="flex flex-wrap gap-3 text-xs">
                      <div>
                        <label className="block font-medium text-slate-600">Width (in)</label>
                        <input type="number" value={lfWidth} onChange={(e)=>setLfWidth(+e.target.value||0)} className="border rounded-md px-2 py-1 text-xs w-24" />
                      </div>
                      <div>
                        <label className="block font-medium text-slate-600">Height (in)</label>
                        <input type="number" value={lfHeight} onChange={(e)=>setLfHeight(+e.target.value||0)} className="border rounded-md px-2 py-1 text-xs w-24" />
                      </div>
                      <div>
                        <label className="block font-medium text-slate-600">Paper</label>
                        <select value={lfPaperKey} onChange={(e)=>setLfPaperKey(e.target.value)} className="border rounded-md px-2 py-1 text-xs">
                          {lfPaperTypes.map((pt)=>(<option key={pt.key} value={pt.key}>{pt.label}</option>))}
                        </select>
                      </div>
                      <div>
                        <label className="block font-medium text-slate-600">Color</label>
                        <select value={lfColorMode} onChange={(e)=>setLfColorMode(e.target.value)} className="border rounded-md px-2 py-1 text-xs">
                          <option value="color">Color</option>
                          <option value="bw">B/W</option>
                        </select>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-3 text-[11px] text-slate-700">
                      <label className="flex items-center gap-2"><input type="checkbox" checked={lfGrommets} onChange={(e)=>setLfGrommets(e.target.checked)} />Grommets</label>
                      <label className="flex items-center gap-2"><input type="checkbox" checked={lfFoamCore} onChange={(e)=>setLfFoamCore(e.target.checked)} />Foam Core</label>
                      <label className="flex items-center gap-2"><input type="checkbox" checked={lfCoroSign} onChange={(e)=>setLfCoroSign(e.target.checked)} />Coro</label>
                    </div>

                    <div className="text-xs text-slate-700">
                      <div>Area: <span className="font-semibold">{lfAreaSqFt.toFixed(2)} sq ft</span></div>
                      <div>Estimated total: <span className="font-semibold">${lfTotalWithDiscount.toFixed(2)}</span></div>
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <div className="text-xs font-semibold text-slate-800">Quick Quote (Blueprints)</div>
                        <div className="text-[11px] text-slate-500">Blueprints are 20 LB plain bond with admin-editable PSF tiers per size.</div>
                      </div>
                      <button
                        type="button"
                        onClick={printBlueprintQuote}
                        className="px-3 py-2 rounded-full bg-slate-800 text-white text-xs shadow-sm hover:bg-slate-900"
                      >
                        Print Quote
                      </button>
                    </div>

                    <div className="flex flex-wrap gap-3 text-xs">
                      <div>
                        <label className="block font-medium text-slate-600">Size</label>
                        <select value={bpSizeKey} onChange={(e)=>setBpSizeKey(e.target.value)} className="border rounded-md px-2 py-1 text-xs">
                          {BLUEPRINT_SIZES.map((s)=>(<option key={s.key} value={s.key}>{s.label}</option>))}
                        </select>
                      </div>
                      <div>
                        <label className="block font-medium text-slate-600">Quantity</label>
                        <input type="number" value={bpQty} onChange={(e)=>setBpQty(+e.target.value||0)} className="border rounded-md px-2 py-1 text-xs w-24" />
                      </div>
                    </div>

                    <div className="text-xs text-slate-700">
                      <div>Per sheet: <span className="font-semibold">${bpPerSheet.toFixed(2)}</span></div>
                      <div>Estimated total: <span className="font-semibold">${bpTotal.toFixed(2)}</span></div>
                    </div>
                  </div>
                </div>
              </section>
            )}

            {/* ADMIN PANEL */}
            {isAdmin && showAdmin && (
              <section className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4 space-y-6">
                <h2 className="text-sm font-semibold text-slate-800">
                  Admin Pricing Panel
                </h2>
                <p className="text-[11px] text-slate-500 max-w-2xl">
                  Password: <code>store4979</code>. Values are stored in
                  this browser (localStorage) and can be exported to a{" "}
                  <code>pricing.json</code> file to reuse across computers
                  or deployments.
                </p>

                {/* Export / Import */}
                <div className="flex flex-wrap items-center gap-3 text-xs">
                  <button
                    type="button"
                    onClick={exportPricingJson}
                    className="px-3 py-1.5 rounded-full bg-slate-800 text-white"
                  >
                    Export pricing.json
                  </button>
                  <label className="flex items-center gap-2">
                    <span className="px-2 py-1.5 rounded-full border border-dashed border-slate-400 cursor-pointer">
                      Import pricing.json
                    </span>
                    <input
                      type="file"
                      accept="application/json"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files[0];
                        if (f) importPricingJson(f);
                        e.target.value = "";
                      }}
                    />
                  </label>
                </div>

{/* Manage Paper Types */}
<div className="space-y-4">
  <h3 className="font-semibold text-sm">
    Manage Paper Types
  </h3>
  <p className="text-[11px] text-slate-500">
    Add/remove paper types for <span className="font-semibold">Sheets</span> and <span className="font-semibold">Large Format</span>. Keys are used in <code>pricing.json</code>.
  </p>

  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
    {/* Sheet paper types */}
    <div className="border rounded-xl p-3 bg-slate-50/60 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="font-semibold text-xs">Sheets</h4>
        <span className="text-[11px] text-slate-500">
          {paperTypes.length} type{paperTypes.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className="space-y-2">
        {paperTypes.map((pt) => (
          <div key={pt.key} className="border rounded-lg p-2 bg-white">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] text-slate-500">Key:</span>
                <code className="text-[11px]">{pt.key}</code>
              </div>
              <button
                type="button"
                onClick={() => handleRemovePaperType(pt.key)}
                className="px-2 py-0.5 rounded-md border bg-slate-100 text-[11px]"
                title="Remove paper type"
              >
                Remove
              </button>
            </div>

            <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2 items-center">
              <label className="text-[11px] text-slate-600">
                Label
                <input
                  type="text"
                  value={pt.label}
                  onChange={(e) =>
                    handleUpdatePaperLabel(pt.key, e.target.value)
                  }
                  className="mt-1 w-full border rounded px-2 py-1 text-xs"
                />
              </label>

              <div className="text-[11px] text-slate-600">
                Sizes
                <div className="mt-1 flex flex-wrap gap-2">
                  {getPresetSheetKeys().map((sk) => (
                    <label key={sk} className="flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={(sheetKeysForPaper[pt.key] || []).includes(sk)}
                        onChange={() => handleTogglePaperSheet(pt.key, sk)}
                      />
                      <span>{sk}</span>
                    </label>
                  ))}
                </div>
                <div className="mt-1 text-[10px] text-slate-500">
                  (Keep at least one size enabled)
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="border rounded-lg p-2 bg-white space-y-2">
        <div className="font-semibold text-[11px]">Add new sheet paper type</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <label className="text-[11px] text-slate-600">
            Label
            <input
              type="text"
              value={newPaperLabel}
              onChange={(e) => setNewPaperLabel(e.target.value)}
              placeholder="e.g., 24 LB Paper"
              className="mt-1 w-full border rounded px-2 py-1 text-xs"
            />
          </label>
          <label className="text-[11px] text-slate-600">
            Key (optional)
            <input
              type="text"
              value={newPaperKey}
              onChange={(e) => setNewPaperKey(e.target.value)}
              placeholder="auto from label"
              className="mt-1 w-full border rounded px-2 py-1 text-xs"
            />
          </label>
        </div>
        <div className="text-[11px] text-slate-600">
          Sizes
          <div className="mt-1 flex flex-wrap gap-2">
            {getPresetSheetKeys().map((sk) => (
              <label key={sk} className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={!!newPaperSheets[sk]}
                  onChange={(e) =>
                    setNewPaperSheets((prev) => ({
                      ...(prev || {}),
                      [sk]: e.target.checked
                    }))
                  }
                />
                <span>{sk}</span>
              </label>
            ))}
          </div>
        </div>
        <button
          type="button"
          onClick={handleAddPaperType}
          className="px-3 py-1.5 rounded-full bg-slate-800 text-white text-xs"
        >
          Add sheet paper type
        </button>
      </div>
    </div>

    {/* Large format paper types */}
    <div className="border rounded-xl p-3 bg-slate-50/60 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="font-semibold text-xs">Large Format</h4>
        <span className="text-[11px] text-slate-500">
          {lfPaperTypes.length} type{lfPaperTypes.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className="space-y-2">
        {lfPaperTypes.map((pt) => (
          <div key={pt.key} className="border rounded-lg p-2 bg-white">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] text-slate-500">Key:</span>
                <code className="text-[11px]">{pt.key}</code>
              </div>
              <button
                type="button"
                onClick={() => handleRemoveLfPaperType(pt.key)}
                className="px-2 py-0.5 rounded-md border bg-slate-100 text-[11px]"
                title="Remove large format paper type"
              >
                Remove
              </button>
            </div>

            <label className="mt-2 block text-[11px] text-slate-600">
              Label
              <input
                type="text"
                value={pt.label}
                onChange={(e) =>
                  handleUpdateLfPaperLabel(pt.key, e.target.value)
                }
                className="mt-1 w-full border rounded px-2 py-1 text-xs"
              />
            </label>
          </div>
        ))}
      </div>

      <div className="border rounded-lg p-2 bg-white space-y-2">
        <div className="font-semibold text-[11px]">Add new large format paper type</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <label className="text-[11px] text-slate-600">
            Label
            <input
              type="text"
              value={newLfLabel}
              onChange={(e) => setNewLfLabel(e.target.value)}
              placeholder="e.g., New Banner Material"
              className="mt-1 w-full border rounded px-2 py-1 text-xs"
            />
          </label>
          <label className="text-[11px] text-slate-600">
            Key (optional)
            <input
              type="text"
              value={newLfKey}
              onChange={(e) => setNewLfKey(e.target.value)}
              placeholder="auto from label"
              className="mt-1 w-full border rounded px-2 py-1 text-xs"
            />
          </label>
        </div>
        <button
          type="button"
          onClick={handleAddLfPaperType}
          className="px-3 py-1.5 rounded-full bg-slate-800 text-white text-xs"
        >
          Add large format paper type
        </button>
      </div>
    </div>
  </div>
</div>

                {/* Sheet Base Costs Table */}
                <div className="mb-4 text-xs">
                  <h3 className="font-semibold text-sm mb-1">
                    Sheet Base Costs & Prices
                  </h3>
                  <p className="text-[11px] text-slate-500 mb-2">
                    Base costs are per sheet (color and B/W). Markup is
                    applied on top of these to calculate the price per
                    sheet shown below.
                  </p>
                  <div className="overflow-auto max-h-72 border rounded">
                    <table className="min-w-full text-[11px]">
                      <thead className="bg-gray-100">
                        <tr>
                          <th className="px-2 py-1 text-left">
                            Paper Type
                          </th>
                          <th className="px-2 py-1 text-left">
                            Sheet Size
                          </th>
                          <th className="px-2 py-1 text-right">
                            Base Color Cost
                          </th>
                          <th className="px-2 py-1 text-right">
                            Base B/W Cost
                          </th>
                          <th className="px-2 py-1 text-right">
                            Price Color (with markup)
                          </th>
                          <th className="px-2 py-1 text-right">
                            Price B/W (with markup)
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {paperTypes.map((pt) =>
                          (sheetKeysForPaper[pt.key] || []).map(
                            (sk) => {
                              const raw =
                                (pricing[pt.key] || {})[sk] || {};
                              const entry = normalizeEntry(raw);
                              return (
                                <tr
                                  key={pt.key + "-" + sk}
                                  className="border-t"
                                >
                                  <td className="px-2 py-1">
                                    {pt.label}
                                  </td>
                                  <td className="px-2 py-1">
                                    {sk}
                                  </td>
                                  <td className="px-2 py-1 text-right">
                                    <input
                                      type="number"
                                      step="0.0001"
                                      value={entry.baseCostColor}
                                      onChange={(e) => {
                                        const v =
                                          Number(
                                            e.target.value
                                          ) || 0;
                                        setPricing((prev) => {
                                          const next = {
                                            ...prev
                                          };
                                          const group =
                                            next[pt.key] || {};
                                          const norm =
                                            normalizeEntry(
                                              group[sk] || {}
                                            );
                                          if (!next[pt.key])
                                            next[pt.key] = {};
                                          next[pt.key][sk] = {
                                            ...norm,
                                            baseCostColor: v
                                          };
                                          return next;
                                        });
                                      }}
                                      className="border rounded px-1 py-0.5 w-20 text-right"
                                    />
                                  </td>
                                  <td className="px-2 py-1 text-right">
                                    <input
                                      type="number"
                                      step="0.0001"
                                      value={entry.baseCostBW}
                                      onChange={(e) => {
                                        const v =
                                          Number(
                                            e.target.value
                                          ) || 0;
                                        setPricing((prev) => {
                                          const next = {
                                            ...prev
                                          };
                                          const group =
                                            next[pt.key] || {};
                                          const norm =
                                            normalizeEntry(
                                              group[sk] || {}
                                            );
                                          if (!next[pt.key])
                                            next[pt.key] = {};
                                          next[pt.key][sk] = {
                                            ...norm,
                                            baseCostBW: v
                                          };
                                          return next;
                                        });
                                      }}
                                      className="border rounded px-1 py-0.5 w-20 text-right"
                                    />
                                  </td>
                                  <td className="px-2 py-1 text-right">
                                    $
                                    {entry.priceColor.toFixed(
                                      4
                                    )}
                                  </td>
                                  <td className="px-2 py-1 text-right">
                                    $
                                    {entry.priceBW.toFixed(4)}
                                  </td>
                                </tr>
                              );
                            }
                          )
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Sheet Markup */}
                <div className="border-t pt-4 grid md:grid-cols-2 gap-6 text-xs">
                  <div>
                    <h3 className="font-semibold text-sm mb-2">
                      Sheet Markups (%)
                    </h3>
                    <div className="space-y-2">
                      {paperTypes.map((pt) => (
                        <div
                          key={pt.key}
                          className="flex items-center justify-between gap-2"
                        >
                          <span>{pt.label}</span>
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              step="0.1"
                              value={markupPerPaper[pt.key] || 0}
                              onChange={(e) =>
                                setMarkupPerPaper((prev) => ({
                                  ...prev,
                                  [pt.key]:
                                    e.target.value === ""
                                      ? ""
                                      : +e.target.value || 0
                                }))
                              }
                              className="border rounded px-1 py-0.5 w-16 text-right"
                            />
                            <span>%</span>
                            <button
                              type="button"
                              onClick={() =>
                                applyMarkupForPaper(pt.key)
                              }
                              className="px-2 py-0.5 border rounded bg-slate-100"
                            >
                              Apply
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={applyMarkupForAllPapers}
                      className="mt-3 px-3 py-1.5 rounded-full bg-slate-800 text-white"
                    >
                      Apply all sheet markups
                    </button>
                  </div>

                  {/* Quantity discounts + back factor */}
                  <div className="space-y-3">
                    <div>
                      <h3 className="font-semibold text-sm mb-1">
                        Sheet Quantity Discounts
                      </h3>
                      <p className="text-[11px] text-slate-500 mb-2">
                        Discounts apply based on the number of sheets
                        (not prints).
                      </p>
                      <div className="space-y-1">
                        {quantityDiscounts.map((row, idx) => (
                          <div
                            key={idx}
                            className="flex items-center gap-2"
                          >
                            <span className="text-slate-600">
                              ≥
                            </span>
                            <input
                              type="number"
                              value={row.minSheets}
                              onChange={(e) => {
                                const v =
                                  +e.target.value || 0;
                                setQuantityDiscounts(
                                  (prev) => {
                                    const copy =
                                      [...prev];
                                    copy[idx] = {
                                      ...copy[idx],
                                      minSheets: v
                                    };
                                    return copy;
                                  }
                                );
                              }}
                              className="border rounded px-1 py-0.5 w-16 text-right"
                            />
                            <span className="text-slate-600">
                              sheets →
                            </span>
                            <input
                              type="number"
                              value={row.discountPercent}
                              onChange={(e) => {
                                const v =
                                  +e.target.value || 0;
                                setQuantityDiscounts(
                                  (prev) => {
                                    const copy =
                                      [...prev];
                                    copy[idx] = {
                                      ...copy[idx],
                                      discountPercent:
                                        v
                                    };
                                    return copy;
                                  }
                                );
                              }}
                              className="border rounded px-1 py-0.5 w-16 text-right"
                            />
                            <span>% off</span>
                            <button
                              type="button"
                              onClick={() =>
                                setQuantityDiscounts(
                                  (prev) =>
                                    prev.filter(
                                      (_, i) =>
                                        i !== idx
                                    )
                                )
                              }
                              className="text-red-500"
                            >
                              ✕
                            </button>
                          </div>
                        ))}
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setQuantityDiscounts((prev) => [
                            ...prev,
                            {
                              minSheets: 0,
                              discountPercent: 0
                            }
                          ])
                        }
                        className="mt-2 text-xs text-blue-600"
                      >
                        + Add discount tier
                      </button>
                    </div>

                    <div>
                      <h3 className="font-semibold text-sm mb-1">
                        Back-side Price Factor
                      </h3>
                      <p className="text-[11px] text-slate-500 mb-1">
                        Multiplier applied to the per-sheet price when
                        back printing is enabled. Example: 0.5 → front
                        + half-price back.
                      </p>
                      <input
                        type="number"
                        step="0.05"
                        value={backSideFactor}
                        onChange={(e) =>
                          setBackSideFactor(
                            parseFloat(e.target.value) || 0
                          )
                        }
                        className="border rounded px-2 py-1 text-xs w-24"
                      />
                    </div>
                  </div>
                </div>

                {/* LARGE FORMAT ADMIN */}
                <div className="border-t pt-4 grid md:grid-cols-2 gap-6 text-xs">
                  <div>
                    <h3 className="font-semibold text-sm mb-2">
                      Large Format Base Costs & Markups
                    </h3>
                    <div className="overflow-auto max-h-72 border rounded">
                      <table className="min-w-full text-[11px]">
                        <thead className="bg-gray-100">
                          <tr>
                            <th className="px-2 py-1 text-left">
                              Paper
                            </th>
                            <th className="px-2 py-1 text-right">
                              Base Color / sq ft
                            </th>
                            <th className="px-2 py-1 text-right">
                              Base B/W / sq ft
                            </th>
                            <th className="px-2 py-1 text-right">
                              Price Color
                            </th>
                            <th className="px-2 py-1 text-right">
                              Price B/W
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {lfPaperTypes.map((pt) => {
                            const entry = normalizeEntry(
                              lfPricing[pt.key] || {}
                            );
                            return (
                              <tr
                                key={pt.key}
                                className="border-t"
                              >
                                <td className="px-2 py-1">
                                  {pt.label}
                                </td>
                                <td className="px-2 py-1 text-right">
                                  <input
                                    type="number"
                                    step="0.0001"
                                    value={
                                      entry.baseCostColor
                                    }
                                    onChange={(e) => {
                                      const v =
                                        Number(
                                          e.target
                                            .value
                                        ) || 0;
                                      setLfPricing(
                                        (prev) => {
                                          const next =
                                            {
                                              ...prev
                                            };
                                          const norm =
                                            normalizeEntry(
                                              next[
                                                pt
                                                  .key
                                              ] ||
                                                {}
                                            );
                                          next[
                                            pt.key
                                          ] = {
                                            ...norm,
                                            baseCostColor:
                                              v
                                          };
                                          return next;
                                        }
                                      );
                                    }}
                                    className="border rounded px-1 py-0.5 w-20 text-right"
                                  />
                                </td>
                                <td className="px-2 py-1 text-right">
                                  <input
                                    type="number"
                                    step="0.0001"
                                    value={entry.baseCostBW}
                                    onChange={(e) => {
                                      const v =
                                        Number(
                                          e.target
                                            .value
                                        ) || 0;
                                      setLfPricing(
                                        (prev) => {
                                          const next =
                                            {
                                              ...prev
                                            };
                                          const norm =
                                            normalizeEntry(
                                              next[
                                                pt
                                                  .key
                                              ] ||
                                                {}
                                            );
                                          next[
                                            pt.key
                                          ] = {
                                            ...norm,
                                            baseCostBW: v
                                          };
                                          return next;
                                        }
                                      );
                                    }}
                                    className="border rounded px-1 py-0.5 w-20 text-right"
                                  />
                                </td>
                                <td className="px-2 py-1 text-right">
                                  $
                                  {entry.priceColor.toFixed(
                                    4
                                  )}
                                </td>
                                <td className="px-2 py-1 text-right">
                                  $
                                  {entry.priceBW.toFixed(4)}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    <div className="mt-3 space-y-1">
                      <h4 className="font-semibold text-xs">
                        Large Format Markup (% per paper)
                      </h4>
                      {lfPaperTypes.map((pt) => (
                        <div
                          key={pt.key}
                          className="flex items-center justify-between gap-2"
                        >
                          <span>{pt.label}</span>
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              step="0.1"
                              value={lfMarkupPerPaper[pt.key] || 0}
                              onChange={(e) =>
                                setLfMarkupPerPaper((prev) => ({
                                  ...prev,
                                  [pt.key]:
                                    e.target.value === ""
                                      ? ""
                                      : +e.target.value || 0
                                }))
                              }
                              className="border rounded px-1 py-0.5 w-16 text-right"
                            />
                            <span>%</span>
                            <button
                              type="button"
                              onClick={() =>
                                applyLfMarkupForPaper(pt.key)
                              }
                              className="px-2 py-0.5 border rounded bg-slate-100"
                            >
                              Apply
                            </button>
                          </div>
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={applyLfMarkupForAll}
                        className="mt-2 px-3 py-1.5 rounded-full bg-slate-800 text-white"
                      >
                        Apply all large-format markups
                      </button>
                    </div>
                  </div>

                  {/* LF add-ons */}
                  <div className="space-y-3">
                    <div>
                      <h3 className="font-semibold text-sm mb-1">
                        Large Format Add-ons
                      </h3>
                      <p className="text-[11px] text-slate-500 mb-2">
                        These costs are added on top of the base large
                        format price when the corresponding option is
                        checked.
                      </p>
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <span className="w-24">Grommets:</span>
                          <input
                            type="number"
                            step="0.01"
                            value={lfAddonPricing.grommets || 0}
                            onChange={(e) =>
                              setLfAddonPricing((prev) => ({
                                ...prev,
                                grommets:
                                  Number(e.target.value) || 0
                              }))
                            }
                            className="border rounded px-2 py-1 text-xs w-24 text-right"
                          />
                          <span className="text-slate-500 text-[11px]">
                            (per job)
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="w-24">Foam Core:</span>
                          <input
                            type="number"
                            step="0.01"
                            value={lfAddonPricing.foamCore || 0}
                            onChange={(e) =>
                              setLfAddonPricing((prev) => ({
                                ...prev,
                                foamCore:
                                  Number(e.target.value) || 0
                              }))
                            }
                            className="border rounded px-2 py-1 text-xs w-24 text-right"
                          />
                          <span className="text-slate-500 text-[11px]">
                            (per job)
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="w-24">Coro Sign:</span>
                          <input
                            type="number"
                            step="0.01"
                            value={lfAddonPricing.coroSign || 0}
                            onChange={(e) =>
                              setLfAddonPricing((prev) => ({
                                ...prev,
                                coroSign:
                                  Number(e.target.value) || 0
                              }))
                            }
                            className="border rounded px-2 py-1 text-xs w-24 text-right"
                          />
                          <span className="text-slate-500 text-[11px]">
                            (per job)
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                {/* BLUEPRINT PRICING */}
                <div className="border-t pt-4 text-xs">
                  <div className="flex flex-wrap items-end justify-between gap-3">
                    <div>
                      <h3 className="font-semibold text-sm mb-1">
                        Blueprint Pricing (20lb Plain Bond Only)
                      </h3>
                      <p className="text-[11px] text-slate-500">
                        Edit price per square foot (PSF) and the sheet-quantity breaks for each blueprint size.
                        Tier 4 is always open-ended (everything above Tier 3).
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setBpPricing(buildInitialBlueprintPricing())}
                      className="px-3 py-1.5 rounded-full bg-slate-800 text-white"
                    >
                      Reset blueprint defaults
                    </button>
                  </div>

                  <div className="mt-3 overflow-auto max-h-80 border rounded">
                    <table className="min-w-full text-[11px]">
                      <thead className="bg-gray-100">
                        <tr>
                          <th className="px-2 py-1 text-left">Size</th>
                          <th className="px-2 py-1 text-right">Area (sq ft)</th>

                          <th className="px-2 py-1 text-right">Tier 1 max qty</th>
                          <th className="px-2 py-1 text-right">Tier 1 PSF</th>

                          <th className="px-2 py-1 text-right">Tier 2 max qty</th>
                          <th className="px-2 py-1 text-right">Tier 2 PSF</th>

                          <th className="px-2 py-1 text-right">Tier 3 max qty</th>
                          <th className="px-2 py-1 text-right">Tier 3 PSF</th>

                          <th className="px-2 py-1 text-right">Tier 4+ PSF</th>
                        </tr>
                      </thead>
                      <tbody>
                        {BLUEPRINT_SIZES.map((s) => {
                          const area = (s.w * s.h) / 144;
                          const cfg = (bpPricing || {})[s.key] || {};
                          const tiers = Array.isArray(cfg.tiers) ? cfg.tiers : [];
                          const t0 = tiers[0] || { maxQty: "", psf: 0 };
                          const t1 = tiers[1] || { maxQty: "", psf: 0 };
                          const t2 = tiers[2] || { maxQty: "", psf: 0 };
                          const t3 = tiers[3] || { maxQty: null, psf: 0 };

                          const updateTier = (tierIdx, patch) => {
                            setBpPricing((prev) => {
                              const next = { ...(prev || {}) };
                              const cur = next[s.key] || { tiers: [] };
                              const curTiers = Array.isArray(cur.tiers) ? [...cur.tiers] : [];
                              while (curTiers.length < 4) curTiers.push({ maxQty: null, psf: 0 });
                              curTiers[tierIdx] = { ...curTiers[tierIdx], ...patch };
                              // keep tier 4 open-ended
                              curTiers[3] = { ...curTiers[3], maxQty: null };
                              next[s.key] = { ...cur, tiers: curTiers };
                              return next;
                            });
                          };

                          return (
                            <tr key={s.key} className="border-t">
                              <td className="px-2 py-1">{s.label}</td>
                              <td className="px-2 py-1 text-right">{area.toFixed(2)}</td>

                              <td className="px-2 py-1 text-right">
                                <input
                                  type="number"
                                  value={t0.maxQty ?? ""}
                                  onChange={(e) =>
                                    updateTier(0, { maxQty: +e.target.value || 0 })
                                  }
                                  className="border rounded px-1 py-0.5 w-20 text-right"
                                />
                              </td>
                              <td className="px-2 py-1 text-right">
                                <input
                                  type="number"
                                  step="0.01"
                                  value={Number(t0.psf) || 0}
                                  onChange={(e) =>
                                    updateTier(0, { psf: Number(e.target.value) || 0 })
                                  }
                                  className="border rounded px-1 py-0.5 w-20 text-right"
                                />
                              </td>

                              <td className="px-2 py-1 text-right">
                                <input
                                  type="number"
                                  value={t1.maxQty ?? ""}
                                  onChange={(e) =>
                                    updateTier(1, { maxQty: +e.target.value || 0 })
                                  }
                                  className="border rounded px-1 py-0.5 w-20 text-right"
                                />
                              </td>
                              <td className="px-2 py-1 text-right">
                                <input
                                  type="number"
                                  step="0.01"
                                  value={Number(t1.psf) || 0}
                                  onChange={(e) =>
                                    updateTier(1, { psf: Number(e.target.value) || 0 })
                                  }
                                  className="border rounded px-1 py-0.5 w-20 text-right"
                                />
                              </td>

                              <td className="px-2 py-1 text-right">
                                <input
                                  type="number"
                                  value={t2.maxQty ?? ""}
                                  onChange={(e) =>
                                    updateTier(2, { maxQty: +e.target.value || 0 })
                                  }
                                  className="border rounded px-1 py-0.5 w-20 text-right"
                                />
                              </td>
                              <td className="px-2 py-1 text-right">
                                <input
                                  type="number"
                                  step="0.01"
                                  value={Number(t2.psf) || 0}
                                  onChange={(e) =>
                                    updateTier(2, { psf: Number(e.target.value) || 0 })
                                  }
                                  className="border rounded px-1 py-0.5 w-20 text-right"
                                />
                              </td>

                              <td className="px-2 py-1 text-right">
                                <span className="text-slate-500">+</span>
                              </td>
                              <td className="px-2 py-1 text-right">
                                <input
                                  type="number"
                                  step="0.01"
                                  value={Number(t3.psf) || 0}
                                  onChange={(e) =>
                                    updateTier(3, { psf: Number(e.target.value) || 0 })
                                  }
                                  className="border rounded px-1 py-0.5 w-20 text-right"
                                />
                              </td>
                            </tr>

        );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                </div>
              </section>
            )}
          </div>

          <MobileNumberBar
            open={numBarOpen}
            onDone={blurActive}
            onClear={clearActive}
            onNudge={nudgeActive}
          />
          </>



        );
      }

export default PriceCalculatorApp;
