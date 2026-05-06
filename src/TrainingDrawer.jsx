// Interactive coaching: drawer browses lessons; once a scenario starts,
// the drawer collapses into a slim strip and a spotlight overlay highlights
// the real field the user should click. Steps auto-advance when the user's
// liveState matches the step's condition. Pricing is computed at runtime
// from pricingData against pricing.json values — never hardcoded.

import { useState, useEffect, useMemo, useRef, useCallback } from "react";

const LS_PROGRESS = "printcalc_training_progress_v1";

// ─── ICONS ───────────────────────────────────────────────────────────────
const Icons = {
  GradCap: () => (<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg>),
  Close:   () => (<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>),
  Check:   () => (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>),
  ChevronRight: () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>),
  ChevronLeft:  () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>),
  Play:    () => (<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>),
  Pause:   () => (<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>),
  Customer: () => (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>),
  Reset:   () => (<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>),
};

// ─── PRICING HELPERS ─────────────────────────────────────────────────────
// Pure functions over `pricingData`. These mirror the math App.jsx uses, so
// scenario "expected" totals match what the user sees in the price bar.

function computePrintsPerSheet(printW, printH, sheetW, sheetH, marginIn, spacingIn) {
  const usableW = sheetW - 2 * marginIn;
  const usableH = sheetH - 2 * marginIn;
  if (usableW <= 0 || usableH <= 0 || printW <= 0 || printH <= 0) return 1;
  const fits = (pw, ph) => {
    const cols = Math.floor((usableW + spacingIn) / (pw + spacingIn));
    const rows = Math.floor((usableH + spacingIn) / (ph + spacingIn));
    return Math.max(0, cols) * Math.max(0, rows);
  };
  const portrait  = fits(printW, printH);
  const landscape = fits(printH, printW);
  return Math.max(1, portrait, landscape);
}

function parseSheetKey(sheetKey) {
  const m = String(sheetKey).match(/^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)$/);
  if (!m) return [8.5, 11];
  return [parseFloat(m[1]), parseFloat(m[2])];
}

function sheetDiscountFactor(sheets, tiers) {
  if (!Array.isArray(tiers) || !tiers.length) return 1;
  const sorted = [...tiers].sort((a, b) => (a.minSheets || 0) - (b.minSheets || 0));
  let pct = 0;
  for (const t of sorted) {
    if (sheets >= (t.minSheets || 0)) pct = t.discountPercent || 0;
  }
  return Math.max(0, 1 - pct / 100);
}

function computeExpectedTotal(spec, pricingData) {
  if (!spec || !pricingData) return null;
  const { sheetPricing, lfPricing, blueprintPricing,
          quantityDiscounts, backSideFactor,
          lfAddonPricing, previewMargin, previewSpacing } = pricingData;

  if (spec.kind === "sheet") {
    const cell = sheetPricing?.[spec.paperKey]?.[spec.sheetKey];
    if (!cell) return null;
    const priceField = spec.color === "bw" ? "priceBW" : "priceColor";
    const front = Number(cell[priceField]) || 0;
    const back  = spec.duplex ? front * (Number(backSideFactor) || 0) : 0;
    const [sw, sh] = parseSheetKey(spec.sheetKey);
    const printsPer = computePrintsPerSheet(spec.printW, spec.printH, sw, sh,
                        Number(previewMargin) || 0.125, Number(previewSpacing) || 0.0625);
    const sheets = Math.ceil((Number(spec.quantity) || 0) / Math.max(1, printsPer));
    const factor = sheetDiscountFactor(sheets, quantityDiscounts);
    return (front + back) * sheets * factor;
  }

  if (spec.kind === "lf") {
    const cell = lfPricing?.[spec.lfPaperKey];
    if (!cell) return null;
    const priceField = spec.color === "bw" ? "priceBW" : "priceColor";
    const psf = Number(cell[priceField]) || 0;
    const sqFt = (Number(spec.lfWidth) * Number(spec.lfHeight)) / 144;
    const base = psf * sqFt;
    const grommetCost = spec.grommetCount > 0
      ? (Number(lfAddonPricing?.grommetEach) || 0) * spec.grommetCount : 0;
    const foamCost = spec.foamCore ? (Number(lfAddonPricing?.foamCore) || 0) : 0;
    return base + grommetCost + foamCost;
  }

  if (spec.kind === "bp") {
    const sizeRow = blueprintPricing?.[spec.bpSizeKey];
    if (!sizeRow?.tiers?.length) return null;
    const qty = Number(spec.bpQty) || 1;
    let psf = sizeRow.tiers[sizeRow.tiers.length - 1].psf;
    for (const t of sizeRow.tiers) {
      if (t.maxQty == null || qty <= t.maxQty) { psf = t.psf; break; }
    }
    const [w, h] = parseSheetKey(spec.bpSizeKey);
    const sqFt = (w * h) / 144;
    return Number(psf) * sqFt * qty;
  }

  return null;
}

// ─── SCENARIO LIBRARY ────────────────────────────────────────────────────
// Each scenario:
//   id, title, difficulty, duration, customerSays, learningGoals, tips, pitfalls
//   spec      — pure inputs used to compute expected total + drive conditions
//   steps[]   — array of { id, target?, instruction, detail?, condition?, initialState? }
//
// Step contract:
//   target        — data-tour ID for the spotlight (optional)
//   instruction   — 1-2 sentence terse direction shown in the strip
//   detail        — longer "Need help?" text (optional)
//   condition(s, expected) — fn over liveState; truthy → auto-advance
//   initialState  — { tab?, viewMode? } — set when the step starts (sparingly)

const CATEGORIES = [
  // ──────────────────────────────────────────────────────────
  // 1. COMMON WALK-INS
  // ──────────────────────────────────────────────────────────
  {
    id: "walkins",
    label: "Common Walk-Ins",
    icon: "🖨",
    color: "var(--teal)",
    bg: "var(--teal-light)",
    description: "The everyday jobs you'll see at the counter",
    scenarios: [
      {
        id: "walkin-flyer",
        title: "100 color flyers on 20 LB",
        difficulty: "beginner",
        duration: "2 min",
        customerSays: "Can I get 100 color flyers? Just regular paper, single-sided.",
        learningGoals: ["Pick paper + sheet size", "Set quantity", "Read the price bar"],
        spec: { kind: "sheet", paperKey: "20lb", sheetKey: "8.5x11",
                printW: 8.5, printH: 11, quantity: 100, color: "color", duplex: false },
        steps: [
          { id: "tab", target: "tab-paper",
            instruction: "Open the Sheets & Photos tab.",
            detail: "Sheets & Photos handles flat-sheet jobs: flyers, photos, business cards.",
            condition: s => s.activeTab === "paper" && s.viewMode === "tool",
            initialState: { tab: "paper", viewMode: "tool" } },
          { id: "sheet", target: "sheet-size-8.5x11",
            instruction: "Pick 8.5 × 11 as the sheet size.",
            condition: s => s.sheetKey === "8.5x11" },
          { id: "paper", target: "paper-type",
            instruction: "Choose 20 LB Paper.",
            detail: "20 LB is the standard cheap flyer stock.",
            condition: s => s.paperKey === "20lb" },
          { id: "w", target: "print-width",
            instruction: "Set print width to 8.5 (full sheet).",
            condition: s => Math.abs(s.printW - 8.5) < 0.01 },
          { id: "h", target: "print-height",
            instruction: "Set print height to 11.",
            condition: s => Math.abs(s.printH - 11) < 0.01 },
          { id: "qty", target: "quantity",
            instruction: "Type 100 in Quantity.",
            condition: s => Number(s.quantity) === 100 },
          { id: "color", target: "front-color-mode",
            instruction: "Confirm Color is selected.",
            condition: s => s.frontColorMode === "color" },
          { id: "read", target: "price-bar",
            instruction: "Read Estimated total — that's your quote.",
            detail: "If you're within ~5% of target, you nailed it.",
            condition: (s, expected) => expected != null
              && Math.abs((s.liveTotal || 0) - expected) / Math.max(1, expected) < 0.05 },
        ],
        tips: [
          "If they want double-sided, just toggle Double-Sided — back-side cost is added automatically.",
          "Volume discounts kick in at 50, 150, 250, 350+ sheets (10/15/20/25%+).",
        ],
        pitfalls: [
          "Always confirm full-bleed vs with-margins — same price, but it changes how the file should look.",
          "If the file is a PDF, drop it into Upload — page size auto-fills.",
        ],
      },
      {
        id: "walkin-bizcards",
        title: "250 double-sided business cards on 110 LB",
        difficulty: "beginner",
        duration: "3 min",
        customerSays: "I need 250 business cards — 3.5 × 2, color on both sides.",
        learningGoals: ["Use a non-standard print size (gang-up)", "Enable double-sided", "See volume discount"],
        spec: { kind: "sheet", paperKey: "110c", sheetKey: "8.5x11",
                printW: 3.5, printH: 2, quantity: 250, color: "color", duplex: true },
        steps: [
          { id: "tab", target: "tab-paper",
            instruction: "Open Sheets & Photos.",
            condition: s => s.activeTab === "paper" && s.viewMode === "tool",
            initialState: { tab: "paper", viewMode: "tool" } },
          { id: "paper", target: "paper-type",
            instruction: "Pick 110 LB Cardstock Cover.",
            detail: "110 LB is the heaviest cardstock — what most cards use.",
            condition: s => s.paperKey === "110c" },
          { id: "sheet", target: "sheet-size-8.5x11",
            instruction: "Choose 8.5 × 11 sheet.",
            condition: s => s.sheetKey === "8.5x11" },
          { id: "w", target: "print-width",
            instruction: "Print width 3.5.",
            condition: s => Math.abs(s.printW - 3.5) < 0.01 },
          { id: "h", target: "print-height",
            instruction: "Print height 2.",
            condition: s => Math.abs(s.printH - 2) < 0.01 },
          { id: "qty", target: "quantity",
            instruction: "Type 250.",
            detail: "Calculator does the gang-up math: 10 cards/sheet → 25 sheets.",
            condition: s => Number(s.quantity) === 250 },
          { id: "duplex", target: "back-side-toggle",
            instruction: "Turn Double-sided ON.",
            condition: s => s.showBack === true },
          { id: "read", target: "price-bar",
            instruction: "Quote the customer the Estimated total.",
            condition: (s, expected) => expected != null
              && Math.abs((s.liveTotal || 0) - expected) / Math.max(1, expected) < 0.05 },
        ],
        tips: [
          "If they bring a pre-imposed 8.5×11 PDF (10 cards already laid out), set print size to 8.5×11 instead.",
          "Standard card size is 3.5×2 — if they say 'standard', that's what they mean.",
        ],
        pitfalls: [
          "Don't set sheet size to 3.5×2 — the calculator needs full-sheet 8.5×11 to do gang-up.",
          "Double-sided uses the back-side factor (default 50%) — duplex isn't free.",
        ],
      },
      {
        id: "walkin-photos",
        title: "20 photo prints on 100 LB Text Gloss",
        difficulty: "beginner",
        duration: "2 min",
        customerSays: "Can you print 20 photos? 5×7, glossy please.",
        learningGoals: ["Use gloss text for photo prints", "Quote a small photo job"],
        spec: { kind: "sheet", paperKey: "100t", sheetKey: "8.5x11",
                printW: 5, printH: 7, quantity: 20, color: "color", duplex: false },
        steps: [
          { id: "tab", target: "tab-paper",
            instruction: "Open Sheets & Photos.",
            condition: s => s.activeTab === "paper" && s.viewMode === "tool",
            initialState: { tab: "paper", viewMode: "tool" } },
          { id: "sheet", target: "sheet-size-8.5x11",
            instruction: "Pick 8.5 × 11 sheet.",
            detail: "We don't stock 5×7 sheets — gang up two 5×7 prints per 8.5×11.",
            condition: s => s.sheetKey === "8.5x11" },
          { id: "paper", target: "paper-type",
            instruction: "Choose 100 LB Text Gloss.",
            detail: "We don't stock dedicated photo paper — 100 LB Text Gloss is the gloss option for photo-style prints.",
            condition: s => s.paperKey === "100t" },
          { id: "w", target: "print-width",
            instruction: "Print width 5.",
            condition: s => Math.abs(s.printW - 5) < 0.01 },
          { id: "h", target: "print-height",
            instruction: "Print height 7.",
            condition: s => Math.abs(s.printH - 7) < 0.01 },
          { id: "qty", target: "quantity",
            instruction: "Quantity 20.",
            condition: s => Number(s.quantity) === 20 },
          { id: "read", target: "price-bar",
            instruction: "Read the total to the customer.",
            condition: (s, expected) => expected != null
              && Math.abs((s.liveTotal || 0) - expected) / Math.max(1, expected) < 0.05 },
        ],
        tips: [
          "14PT Gloss is even thicker — offer it if they say 'something nicer'.",
          "If their file isn't 5:7 ratio, you'll get cropping. Open it before charging.",
        ],
        pitfalls: ["Photos on plain 20 LB look terrible. Always upsell to a gloss stock."],
      },
    ],
  },

  // ──────────────────────────────────────────────────────────
  // 2. BOOKLETS & DATAMERGE
  // ──────────────────────────────────────────────────────────
  {
    id: "impose",
    label: "Booklets & DataMerge",
    icon: "📖",
    color: "var(--green)",
    bg: "var(--green-light)",
    description: "Saddle-stitch booklets, mail merges, numbered tickets",
    scenarios: [
      {
        id: "impose-booklet",
        title: "20-page saddle-stitch booklet on 80 LB",
        difficulty: "intermediate",
        duration: "4 min",
        customerSays: "I need 50 booklets — 20 pages each, 5.5 × 8.5 finished, full color.",
        learningGoals: ["Open Booklet Maker", "Pick a finished size preset", "Pick paper for a booklet"],
        // Impose internal state isn't visible; only Impose-tab + tool can auto-advance.
        spec: null,
        steps: [
          { id: "tab", target: "tab-impose",
            instruction: "Open the Impose tab.",
            condition: s => s.activeTab === "impose" && s.viewMode === "tool",
            initialState: { tab: "impose", viewMode: "tool" } },
          { id: "tool", target: "impose-tool-booklet",
            instruction: "Pick the Booklet Maker tool.",
            detail: "Saddle-stitch booklets fold sheets in half and staple them at the spine." },
          { id: "preset", target: "booklet-preset-half-letter",
            instruction: "Choose the Half-Letter (5.5 × 8.5) preset.",
            detail: "Half-letter is letter-size folded in half — runs on 8.5 × 11 stock." },
          { id: "paper", target: "booklet-paper-type",
            instruction: "Pick 80 LB Cardstock Cover for a sturdy booklet.",
            detail: "80 LB feels nicer than 28 LB; 28 LB is fine for handouts." },
          { id: "upload", target: "booklet-upload",
            instruction: "Drop their 20-page PDF here." },
          { id: "review", target: "booklet-upload",
            instruction: "Confirm: 20 pages = 5 sheets folded, well within saddle-stitch limit (~15 sheets).",
            detail: "Page count must be a multiple of 4. The tool auto-pads if not." },
        ],
        tips: [
          "For wedding programs, upsell to 80 LB Cover — it feels premium.",
          "Booklets are always duplex — back-side cost is built in.",
        ],
        pitfalls: ["Don't pick the finished size as the stock size — 5.5×8.5 finished = 8.5×11 stock."],
      },
      {
        id: "impose-tickets",
        title: "500 numbered raffle tickets on 80 LB",
        difficulty: "intermediate",
        duration: "3 min",
        customerSays: "500 raffle tickets, numbered 1-500, on cardstock.",
        learningGoals: ["Use DataMerge for sequential numbering", "Skip the CSV step"],
        spec: null,
        steps: [
          { id: "tab", target: "tab-impose",
            instruction: "Open Impose.",
            condition: s => s.activeTab === "impose" && s.viewMode === "tool",
            initialState: { tab: "impose", viewMode: "tool" } },
          { id: "tool", target: "impose-tool-datamerge",
            instruction: "Pick Data Merge.",
            detail: "DataMerge handles CSV mail-merge AND sequential numbering — even without a CSV." },
          { id: "tmpl", target: "datamerge-template-upload",
            instruction: "Drop the customer's one-ticket template PDF here." },
          { id: "paper", target: "datamerge-paper-type",
            instruction: "Pick 80 LB Cardstock Cover for tear-resistant tickets.",
            detail: "28 LB tears too easily; 80 LB Cardstock holds up." },
          { id: "skip-csv", target: "datamerge-csv-upload",
            instruction: "Skip the CSV — sequential numbering doesn't need one.",
            detail: "Use the field-style sequential number option in step 4 instead." },
        ],
        tips: ["Two-part raffle tickets (with a stub) = one design at full ticket size."],
        pitfalls: ["Number placeholders must be in the same spot on every ticket — DataMerge swaps text in place."],
      },
      {
        id: "impose-mailmerge",
        title: "Mail-merge 200 personalized postcards on 110 LB",
        difficulty: "advanced",
        duration: "5 min",
        customerSays: "I have 200 customers. Postcard each, with their name on the front.",
        learningGoals: ["Upload template + CSV", "Map placeholders to columns"],
        spec: null,
        steps: [
          { id: "tab", target: "tab-impose",
            instruction: "Open Impose.",
            condition: s => s.activeTab === "impose" && s.viewMode === "tool",
            initialState: { tab: "impose", viewMode: "tool" } },
          { id: "tool", target: "impose-tool-datamerge",
            instruction: "Pick Data Merge." },
          { id: "tmpl", target: "datamerge-template-upload",
            instruction: "Drop the postcard template (with placeholders like {FirstName})." },
          { id: "paper", target: "datamerge-paper-type",
            instruction: "Pick 110 LB Cardstock Cover for a thick postcard.",
            detail: "USPS minimum for postcards is 7pt — 110 LB easily clears." },
          { id: "csv", target: "datamerge-csv-upload",
            instruction: "Upload the CSV. Map {FirstName} → first_name etc." },
        ],
        tips: ["Bad CSV encoding breaks merges. Open in a text editor first if names have accents."],
        pitfalls: ["Placeholders are case-sensitive: {FirstName} ≠ {firstname}."],
      },
    ],
  },

  // ──────────────────────────────────────────────────────────
  // 3. LARGE FORMAT & BLUEPRINTS
  // ──────────────────────────────────────────────────────────
  {
    id: "largeformat",
    label: "Large Format & Blueprints",
    icon: "📐",
    color: "var(--amber)",
    bg: "var(--amber-light)",
    description: "Banners, posters, blueprints — anything off the HP DesignJet",
    scenarios: [
      {
        id: "lf-banner",
        title: "3×8 ft banner on ThriftyBanner with 4 grommets",
        difficulty: "intermediate",
        duration: "3 min",
        customerSays: "3 by 8 foot banner with grommets in the corners.",
        learningGoals: ["Convert feet → inches", "Add grommets per-each", "Spot the 36\" max"],
        spec: { kind: "lf", lfPaperKey: "lexjet_thrifty_banner",
                lfWidth: 36, lfHeight: 96, color: "color",
                grommetCount: 4, foamCore: false },
        steps: [
          { id: "tab", target: "tab-large",
            instruction: "Open Large Format.",
            condition: s => s.activeTab === "large" && s.viewMode === "tool",
            initialState: { tab: "large", viewMode: "tool" } },
          { id: "w", target: "lf-width",
            instruction: "Width 36 inches (3 feet).",
            detail: "DesignJet maxes at 36\" — the 3 ft side has to be the width.",
            condition: s => Math.abs(s.lfWidth - 36) < 0.1 },
          { id: "h", target: "lf-height",
            instruction: "Height 96 inches (8 feet).",
            condition: s => Math.abs(s.lfHeight - 96) < 0.1 },
          { id: "media", target: "lf-paper-type",
            instruction: "Pick LexJet TOUGHcoat ThriftyBanner.",
            detail: "Vinyl banner stock — weather-resistant, takes grommets without tearing.",
            condition: s => s.lfPaperKey === "lexjet_thrifty_banner" },
          { id: "grom", target: "lf-grommet-toggle",
            instruction: "Toggle Grommets ON.",
            condition: s => s.lfGrommets === true },
          { id: "gcount", target: "lf-grommet-count",
            instruction: "Set grommet count to 4 (one in each corner).",
            condition: s => s.lfGrommets && Number(s.lfGrommetCount) === 4 },
          { id: "read", target: "lf-price-bar",
            instruction: "Read the total — base + grommet add-on.",
            condition: (s, expected) => expected != null
              && Math.abs((s.liveTotal || 0) - expected) / Math.max(1, expected) < 0.06 },
        ],
        tips: [
          "Banners over 6 ft typically get grommets every 2 ft — ask before assuming 4.",
          "Outdoor + windy = recommend hemmed edges (separate add-on).",
        ],
        pitfalls: [
          "DesignJet maxes at 36\" wide — 4×8 banners must run with 4 ft as the length.",
          "Don't put a banner on photo paper. It'll tear in a week.",
        ],
      },
      {
        id: "lf-poster",
        title: "24×36 photo poster on HP Gloss",
        difficulty: "beginner",
        duration: "2 min",
        customerSays: "Print this photo as a 24 × 36 poster.",
        learningGoals: ["Quote a one-off poster", "Pick HP Gloss for photos"],
        spec: { kind: "lf", lfPaperKey: "hp_gloss_photo",
                lfWidth: 24, lfHeight: 36, color: "color",
                grommetCount: 0, foamCore: false },
        steps: [
          { id: "tab", target: "tab-large",
            instruction: "Open Large Format.",
            condition: s => s.activeTab === "large" && s.viewMode === "tool",
            initialState: { tab: "large", viewMode: "tool" } },
          { id: "w", target: "lf-width",
            instruction: "Width 24.",
            condition: s => Math.abs(s.lfWidth - 24) < 0.1 },
          { id: "h", target: "lf-height",
            instruction: "Height 36 (portrait).",
            condition: s => Math.abs(s.lfHeight - 36) < 0.1 },
          { id: "media", target: "lf-paper-type",
            instruction: "Pick HP Universal Instant-dry Gloss Photo Paper.",
            detail: "Gloss = high contrast, vibrant — best for action and saturated images.",
            condition: s => s.lfPaperKey === "hp_gloss_photo" },
          { id: "read", target: "lf-price-bar",
            instruction: "Read the total. 6 sq ft × per-sq-ft rate.",
            condition: (s, expected) => expected != null
              && Math.abs((s.liveTotal || 0) - expected) / Math.max(1, expected) < 0.06 },
        ],
        tips: [
          "If they want a matte finish, switch to LexJet Polypropylene Matte.",
          "Posters get rolled in a tube for transport — usually free.",
        ],
        pitfalls: ["Low-res files (< 100 DPI at full size) print pixelated. Open before printing."],
      },
      {
        id: "blueprint-set",
        title: "8 architectural blueprints, 24×36",
        difficulty: "intermediate",
        duration: "3 min",
        customerSays: "Eight blueprint sheets, 24 by 36.",
        learningGoals: ["Use the Blueprints tab", "See per-sq-ft tier pricing"],
        spec: { kind: "bp", bpSizeKey: "24x36", bpQty: 8 },
        steps: [
          { id: "tab", target: "tab-blueprint",
            instruction: "Open Blueprints.",
            detail: "Blueprints have their own tier pricing — flat per-sq-ft, not photo rates.",
            condition: s => s.activeTab === "blueprint" && s.viewMode === "tool",
            initialState: { tab: "blueprint", viewMode: "tool" } },
          { id: "size", target: "bp-size-24x36",
            instruction: "Pick 24 × 36.",
            condition: s => s.bpSizeKey === "24x36" },
          { id: "qty", target: "bp-quantity",
            instruction: "Quantity 8.",
            condition: s => Number(s.bpQty) === 8 },
          { id: "read", target: "bp-price-bar",
            instruction: "Read total — sq-ft × tier rate × 8.",
            condition: (s, expected) => expected != null
              && Math.abs((s.liveTotal || 0) - expected) / Math.max(1, expected) < 0.05 },
        ],
        tips: ["Multi-page PDF? page count = sheet count automatically."],
        pitfalls: ["Don't quote photo prices for blueprints — wildly off."],
      },
    ],
  },

  // ──────────────────────────────────────────────────────────
  // 4. QUICK QUOTE
  // ──────────────────────────────────────────────────────────
  {
    id: "quote",
    label: "Quick Quote",
    icon: "⚡",
    color: "var(--blue)",
    bg: "var(--blue-light)",
    description: "Compare prices at a glance",
    scenarios: [
      {
        id: "quote-compare",
        title: "Customer asks 'what's cheapest?'",
        difficulty: "beginner",
        duration: "2 min",
        customerSays: "200 flyers, 8.5 × 11. What's cheapest?",
        learningGoals: ["Switch to Quick Quote", "Read the comparison table"],
        spec: null,
        steps: [
          { id: "open", target: "header-quote",
            instruction: "Click Quick Quote in the header.",
            condition: s => s.viewMode === "quote" },
          { id: "w", target: "quote-print-w",
            instruction: "Print width 8.5.",
            condition: s => Math.abs(s.quotePrintW - 8.5) < 0.01 },
          { id: "h", target: "quote-print-h",
            instruction: "Print height 11.",
            condition: s => Math.abs(s.quotePrintH - 11) < 0.01 },
          { id: "qty", target: "quote-qty",
            instruction: "Quantity 200.",
            condition: s => Number(s.quoteQty) === 200 },
          { id: "color", target: "quote-color",
            instruction: "Color (default).",
            condition: s => s.quoteFrontColorMode === "color" },
          { id: "all", target: "quote-all-papers",
            instruction: "All paper types ON to compare every option.",
            condition: s => s.quoteShowAllPapers === true },
          { id: "read", target: "quote-table",
            instruction: "Find the 'Best' row — that's your cheapest quote." },
        ],
        tips: ["The Best badge picks the lowest total automatically."],
        pitfalls: ["Cheapest isn't always best — 20 LB is cheap but flimsy."],
      },
      {
        id: "quote-budget",
        title: "Reverse-quoting on a tight budget",
        difficulty: "intermediate",
        duration: "3 min",
        customerSays: "I've got $50 — how many color flyers can I get?",
        learningGoals: ["Use the comparison to back into quantity", "Show paper trade-offs"],
        spec: null,
        steps: [
          { id: "open", target: "header-quote",
            instruction: "Open Quick Quote.",
            condition: s => s.viewMode === "quote" },
          { id: "size", target: "quote-print-w",
            instruction: "Set print width 8.5.",
            condition: s => Math.abs(s.quotePrintW - 8.5) < 0.01 },
          { id: "h", target: "quote-print-h",
            instruction: "Print height 11.",
            condition: s => Math.abs(s.quotePrintH - 11) < 0.01 },
          { id: "guess", target: "quote-qty",
            instruction: "Try quantity 100 first — adjust up/down to land near $50.",
            detail: "Watch the table totals as you change qty. The 50-tier discount kicks in at 50 sheets." },
          { id: "table", target: "quote-table",
            instruction: "Pick the row that fits the budget. Tell the customer the trade-off." },
        ],
        tips: ["Higher qty = lower per-sheet thanks to volume tiers."],
        pitfalls: ["Don't shrink to BW just to fit budget — ask first."],
      },
    ],
  },

  // ──────────────────────────────────────────────────────────
  // 5. TRICKY EDGE CASES
  // ──────────────────────────────────────────────────────────
  {
    id: "edge",
    label: "Tricky Edge Cases",
    icon: "🧠",
    color: "var(--purple)",
    bg: "#f3e8ff",
    description: "Gang-up math, duplex pricing, mixed orders",
    scenarios: [
      {
        id: "edge-postcards",
        title: "200 4×6 postcards on 80 LB — gang-up + discount",
        difficulty: "intermediate",
        duration: "3 min",
        customerSays: "200 postcards, 4 by 6, color one side, on cardstock.",
        learningGoals: ["See 2-up gang-up math", "Watch the volume-discount tier kick in"],
        spec: { kind: "sheet", paperKey: "80c", sheetKey: "8.5x11",
                printW: 4, printH: 6, quantity: 200, color: "color", duplex: false },
        steps: [
          { id: "tab", target: "tab-paper",
            instruction: "Open Sheets & Photos.",
            condition: s => s.activeTab === "paper" && s.viewMode === "tool",
            initialState: { tab: "paper", viewMode: "tool" } },
          { id: "sheet", target: "sheet-size-8.5x11",
            instruction: "Pick 8.5 × 11 — postcards gang up on it.",
            condition: s => s.sheetKey === "8.5x11" },
          { id: "paper", target: "paper-type",
            instruction: "Pick 80 LB Cardstock Cover.",
            condition: s => s.paperKey === "80c" },
          { id: "w", target: "print-width",
            instruction: "Print width 4.",
            condition: s => Math.abs(s.printW - 4) < 0.01 },
          { id: "h", target: "print-height",
            instruction: "Print height 6.",
            condition: s => Math.abs(s.printH - 6) < 0.01 },
          { id: "qty", target: "quantity",
            instruction: "Quantity 200.",
            detail: "2 postcards/sheet × 100 sheets = 200. 100 sheets hits the 50-tier (10% off).",
            condition: s => Number(s.quantity) === 200 },
          { id: "read", target: "price-bar",
            instruction: "Read total — note the discount line.",
            condition: (s, expected) => expected != null
              && Math.abs((s.liveTotal || 0) - expected) / Math.max(1, expected) < 0.06 },
        ],
        tips: ["Cut in-house after printing — easy upsell to '4×6 photo card style'."],
        pitfalls: ["Don't quote 200 sheets — gang-up makes it 100. The calc handles it automatically."],
      },
      {
        id: "edge-duplex",
        title: "Duplex math: 100 cards single vs double sided",
        difficulty: "beginner",
        duration: "2 min",
        customerSays: "What's the price difference if I add the back too?",
        learningGoals: ["See backSideFactor in action (50% of front)"],
        spec: { kind: "sheet", paperKey: "80c", sheetKey: "8.5x11",
                printW: 3.5, printH: 2, quantity: 100, color: "color", duplex: true },
        steps: [
          { id: "tab", target: "tab-paper",
            instruction: "Open Sheets & Photos.",
            condition: s => s.activeTab === "paper" && s.viewMode === "tool",
            initialState: { tab: "paper", viewMode: "tool" } },
          { id: "paper", target: "paper-type",
            instruction: "80 LB Cardstock Cover.",
            condition: s => s.paperKey === "80c" },
          { id: "w", target: "print-width",
            instruction: "Print width 3.5.",
            condition: s => Math.abs(s.printW - 3.5) < 0.01 },
          { id: "h", target: "print-height",
            instruction: "Print height 2.",
            condition: s => Math.abs(s.printH - 2) < 0.01 },
          { id: "qty", target: "quantity",
            instruction: "Quantity 100.",
            condition: s => Number(s.quantity) === 100 },
          { id: "duplex", target: "back-side-toggle",
            instruction: "Toggle Double-sided ON. Watch the price jump.",
            detail: "Back-side adds 50% of front cost (configurable in Admin).",
            condition: s => s.showBack === true },
          { id: "read", target: "price-bar",
            instruction: "That delta vs single-sided is what you tell the customer.",
            condition: (s, expected) => expected != null
              && Math.abs((s.liveTotal || 0) - expected) / Math.max(1, expected) < 0.05 },
        ],
        tips: ["Most people pick double-sided when shown the small upcharge."],
        pitfalls: ["File needs to be designed for duplex — front+back PDFs, or it'll misalign."],
      },
      {
        id: "edge-mixed",
        title: "Mixed order: flyers + a poster (use Job History)",
        difficulty: "advanced",
        duration: "4 min",
        customerSays: "100 flyers and a poster, all together.",
        learningGoals: ["Run two jobs", "Check the Job History badge"],
        spec: null,
        steps: [
          { id: "tab1", target: "tab-paper",
            instruction: "Start with Sheets & Photos.",
            condition: s => s.activeTab === "paper" && s.viewMode === "tool",
            initialState: { tab: "paper", viewMode: "tool" } },
          { id: "qty", target: "quantity",
            instruction: "Set quantity 100 for the flyers.",
            condition: s => Number(s.quantity) === 100 },
          { id: "complete", target: "complete-sale",
            instruction: "Complete Sale to log the flyer job (if signed in).",
            detail: "If you're not signed in, this button is disabled — sign in via the header." },
          { id: "tab2", target: "tab-large",
            instruction: "Switch to Large Format for the poster.",
            condition: s => s.activeTab === "large",
            initialState: { tab: "large" } },
          { id: "history", target: "header-job-history",
            instruction: "After both are sold, open Job History to see both line items." },
        ],
        tips: ["Each job is logged separately so you can track per-job commission."],
        pitfalls: ["Don't combine into one Calc field — keep them as discrete jobs."],
      },
    ],
  },

  // ──────────────────────────────────────────────────────────
  // 6. SPECIALTY (Signs365 trade printing)
  //
  // SpecialtyTab owns its own state internally (selectedCategory,
  // selectedProduct, width/height, selectedSizeKey, quantity,
  // selectedOptions). That state isn't exposed to App.jsx's liveState,
  // so these scenarios are informational ("Got it" advance) rather
  // than condition-driven. They DO spotlight real data-tour targets
  // and use the existing specialtyApplyScenario CustomEvent bridge to
  // pre-fill the calculator when a step needs the user to land on a
  // specific category/product.
  // ──────────────────────────────────────────────────────────
  {
    id: "specialty",
    label: "Specialty (Signs365)",
    icon: "🪧",
    color: "var(--slate)",
    bg: "var(--slate-light)",
    description: "Outsourced rigid signs, magnets, and large-format specialty",
    scenarios: [
      {
        id: "specialty-yard-sign",
        title: "24×36 Coroplast yard sign with H-stake",
        difficulty: "beginner",
        duration: "3 min",
        customerSays: "I need one of those political-style yard signs — 24 by 36, with the wire stake.",
        learningGoals: [
          "Open the Specialty tab and pick Rigid Signs → Coro 4mm",
          "Pick a preset size and quantity",
          "Add the wire step-stake as a per-each option",
        ],
        spec: null,
        steps: [
          { id: "tab", target: "tab-specialty",
            instruction: "Open the Specialty tab.",
            detail: "Specialty handles trade-print jobs we send to Signs365 — rigid signs, magnets, vinyl banners.",
            condition: s => s.activeTab === "specialty" && s.viewMode === "tool",
            initialState: { tab: "specialty", viewMode: "tool" } },
          { id: "category", target: "specialty-category",
            instruction: "Pick the Rigid Signs category." },
          { id: "product", target: "specialty-product",
            instruction: "Pick Coro 4mm.",
            detail: "Coroplast 4mm is the standard yard-sign substrate — outdoor-rated, lightweight, takes a stake." },
          { id: "size", target: "specialty-size-preset",
            instruction: "Pick 24″ × 36″ from the size dropdown.",
            detail: "Use the (5 per sheet) layout — Signs365's standard gang-up for that size." },
          { id: "qty", target: "specialty-quantity",
            instruction: "Quantity 1." },
          { id: "stake", target: "specialty-price-bar",
            instruction: "Scroll down to Options and add 1 standard wire step-stake (+$1.25).",
            detail: "If your store doesn't stock H-stakes, mention to the customer that we'll throw it in the order from Signs365 — adds about a buck per sign." },
          { id: "quote", target: "specialty-price-bar",
            instruction: "Read the customer total — that's your quote." },
        ],
        tips: [
          "Customers usually want 1–4 yard signs. Quote each as quantity 1 unless they want identical copies.",
          "Heavy-duty step stakes are $2.25 — recommend them in windy areas.",
        ],
        pitfalls: [
          "Don't quote 24×36 Coro at the rigid-sign rate without picking the preset — Coro 4mm is sized through stock cuts, not custom.",
          "Stakes ship with the order; they're not in our store inventory.",
        ],
      },
      {
        id: "specialty-aluminum",
        title: "Pair of 18×24 aluminum parking signs",
        difficulty: "beginner",
        duration: "3 min",
        customerSays: "Two aluminum signs, 18 by 24 — for the parking lot.",
        learningGoals: [
          "Pick Aluminum .040 — weather-permanent vs Coroplast",
          "Set quantity 2",
          "Recognize when to upsell to .080",
        ],
        spec: null,
        steps: [
          { id: "tab", target: "tab-specialty",
            instruction: "Open the Specialty tab.",
            condition: s => s.activeTab === "specialty" && s.viewMode === "tool",
            initialState: { tab: "specialty", viewMode: "tool" } },
          { id: "category", target: "specialty-category",
            instruction: "Pick the Rigid Signs category." },
          { id: "product", target: "specialty-product",
            instruction: "Pick Aluminum .040.",
            detail: "Aluminum is weather-permanent — 5+ year outdoor lifespan vs Coroplast's 2–3. Best for parking, real-estate, permanent signage." },
          { id: "size", target: "specialty-size-preset",
            instruction: "Pick 18″ × 24″ from the size dropdown." },
          { id: "qty", target: "specialty-quantity",
            instruction: "Quantity 2." },
          { id: "quote", target: "specialty-price-bar",
            instruction: "Read the customer total. That's the printed pair plus shipping passthrough.",
            detail: "Aluminum is materially more expensive than Coro — about 3–4× the per-piece cost. Customer should know up front." },
        ],
        tips: [
          "If they're mounting on a building or post that flexes, recommend .080 (heavier gauge) — won't dent.",
          "Holes for mounting are a setup fee — confirm with the customer where they want them.",
        ],
        pitfalls: [
          "Don't recommend Coroplast for permanent outdoor parking signs — it'll fade and warp inside a year.",
          "Aluminum can't take H-stakes; it needs a post or surface mount.",
        ],
      },
      {
        id: "specialty-vehicle-magnet",
        title: "Pair of vehicle magnets (18×12)",
        difficulty: "intermediate",
        duration: "4 min",
        customerSays: "Two car-door magnets, around 18 by 12.",
        learningGoals: [
          "Pick the Magnets category and Vehicle Magnet product",
          "Use the 18×12 preset size",
          "Confirm the design fits inside the 96×48 max (it does at this size — calm-water example)",
        ],
        spec: null,
        steps: [
          { id: "tab", target: "tab-specialty",
            instruction: "Open the Specialty tab.",
            condition: s => s.activeTab === "specialty" && s.viewMode === "tool",
            initialState: { tab: "specialty", viewMode: "tool" } },
          { id: "category", target: "specialty-category",
            instruction: "Pick the Magnets category." },
          { id: "product", target: "specialty-product",
            instruction: "Pick Vehicle Magnet.",
            detail: "Vehicle Magnet is the standard pre-cut car-door size with rounded corners. Use Custom Magnets if they want a non-standard shape or size." },
          { id: "size", target: "specialty-size-preset",
            instruction: "Pick the 18″ × 12″ preset.",
            detail: "Stock magnet sizes: 18×12, 24×12, 24×18, 42×12, 72×24. Anything else uses Custom Magnets, which is priced per-square-inch." },
          { id: "qty", target: "specialty-quantity",
            instruction: "Quantity 2." },
          { id: "size-check", target: "specialty-size-warning",
            instruction: "Confirm no size-cap warning is showing — 18×12 is well within 96×48.",
            detail: "Magnets share the same 96×48 sheet-stock limit as rigid signs. Notice the warning slot is empty here. The next scenario shows what happens when it isn't." },
          { id: "quote", target: "specialty-price-bar",
            instruction: "Read the customer total — pair price plus shipping." },
        ],
        tips: [
          "Most customers want them with rounded corners (default on for Vehicle Magnets).",
          "Mention they should clean the door first and apply on a warm day for adhesion.",
        ],
        pitfalls: [
          "Don't put magnets on aluminum or fiberglass body panels — they only stick to steel.",
          "Custom Magnets at sizes near 24×24 cost more than the 24×18 preset because they're priced per sq in, not per piece.",
        ],
      },
      {
        id: "specialty-oversize",
        title: "Oversized 60×96 rigid sign — handling the size warning",
        difficulty: "advanced",
        duration: "5 min",
        customerSays: "I want a Coroplast sign that's 60 inches tall by 96 inches wide. Can you do that?",
        learningGoals: [
          "Trigger the 96×48 size-cap warning",
          "Read the suggested panel split",
          "Communicate panel-split or banner-flip options to the customer",
        ],
        spec: null,
        steps: [
          { id: "tab", target: "tab-specialty",
            instruction: "Open the Specialty tab.",
            condition: s => s.activeTab === "specialty" && s.viewMode === "tool",
            initialState: { tab: "specialty", viewMode: "tool" } },
          { id: "category", target: "specialty-category",
            instruction: "Pick Rigid Signs." },
          { id: "product", target: "specialty-product",
            instruction: "Pick Acrylic — it's the rigid product that takes custom dimensions.",
            detail: "Coro 4mm uses preset sizes only and tops out at 48×96. Acrylic uses custom dims, so we can enter 60×96 to demonstrate the warning. The lesson is generic to any rigid sign." },
          { id: "w", target: "specialty-width",
            instruction: "Width 96." },
          { id: "h", target: "specialty-height",
            instruction: "Height 60. The warning should now appear below." },
          { id: "warning", target: "specialty-size-warning",
            instruction: "Read the warning. 96×60 fails because the short side (60) > 48.",
            detail: "Signs365 sources rigid sheet at 96″ × 48″ max. A piece fits if min(w,h) ≤ 48 AND max(w,h) ≤ 96. 60 on the short axis means it can't lay flat on a single sheet." },
          { id: "split-button", target: "specialty-panel-split-button",
            instruction: "Click 'Show panel split' to see the suggested layout." },
          { id: "split-result", target: "specialty-panel-split-result",
            instruction: "Read the suggested split — typically 2 panels of approximately 96×30 or similar.",
            detail: "The algorithm picks the layout with the fewest panels and least wasted area. Each panel goes through Signs365 as its own line item at the panel size." },
          { id: "talk-it", target: "specialty-panel-split-result",
            instruction: "Phrase it for the customer: 'We can do this as 2 panels that join in the middle — most folks don't notice the seam from a few feet away. Or we can flip to a vinyl banner if it doesn't have to be rigid.'",
            detail: "Vinyl banner is the same artwork on lexjet ThriftyBanner — runs on the DesignJet, no size limit, and grommets are pennies. Often half the price of multi-panel rigid." },
          { id: "quote", target: "specialty-price-bar",
            instruction: "If they're going with panel split, quote it as N×panel-price. If they're switching to a banner, take them to the Large Format tab instead." },
        ],
        tips: [
          "When a customer asks for oversized rigid, always offer the banner alternative first — it's cheaper and easier to install.",
          "The 96×48 limit is sheet-stock. Some flexible substrates (vinyl on roll) have no upper bound on length.",
        ],
        pitfalls: [
          "Don't promise Signs365 can do oversized rigid in one piece — they can't.",
          "Don't quote a panel split as 'seamless' — there's a visible joint. Be honest with the customer.",
          "Don't forget the panel split increases install complexity — the customer will need to hang the panels in alignment.",
        ],
      },
    ],
  },
];

// ─── PROGRESS PERSISTENCE ───────────────────────────────────────────────
function loadProgress() {
  try { const raw = localStorage.getItem(LS_PROGRESS); return raw ? JSON.parse(raw) : {}; }
  catch { return {}; }
}
function saveProgress(p) {
  try { localStorage.setItem(LS_PROGRESS, JSON.stringify(p)); } catch {}
}

// ─── SPOTLIGHT OVERLAY ──────────────────────────────────────────────────
function Spotlight({ targetId, instruction, onMisclick, shakeKey }) {
  const [rect, setRect] = useState(null);
  const [radius, setRadius] = useState(8);
  const overlayRef = useRef(null);

  useEffect(() => {
    if (!targetId) { setRect(null); return; }
    let raf = 0;
    const measure = () => {
      const el = document.querySelector(`[data-tour="${targetId}"]`);
      if (!el) { setRect(null); return; }
      const r = el.getBoundingClientRect();
      const cs = window.getComputedStyle(el);
      setRect({ x: r.left, y: r.top, w: r.width, h: r.height });
      setRadius(parseFloat(cs.borderRadius) || 8);
      // Scroll target into view if mostly off-screen.
      if (r.top < 80 || r.bottom > window.innerHeight - 80) {
        el.scrollIntoView({ block: "center", behavior: "smooth" });
      }
    };
    const onChange = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(measure); };
    measure();
    window.addEventListener("scroll", onChange, true);
    window.addEventListener("resize", onChange);
    const interval = setInterval(measure, 250); // catch reflows after state updates
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onChange, true);
      window.removeEventListener("resize", onChange);
      clearInterval(interval);
    };
  }, [targetId]);

  // Tooltip placement: prefer below, flip up if no room.
  const tooltip = useMemo(() => {
    if (!rect) return null;
    const margin = 12;
    const tipW = 280;
    const spaceBelow = window.innerHeight - (rect.y + rect.h);
    const above = spaceBelow < 120;
    const top = above ? rect.y - margin - 70 : rect.y + rect.h + margin;
    let left = rect.x + rect.w / 2 - tipW / 2;
    left = Math.max(12, Math.min(window.innerWidth - tipW - 12, left));
    return { top, left, width: tipW, above };
  }, [rect]);

  if (!rect) return null;
  const pad = 6;
  const x = Math.max(0, rect.x - pad);
  const y = Math.max(0, rect.y - pad);
  const w = rect.w + pad * 2;
  const h = rect.h + pad * 2;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // Four shutter rectangles around the hole catch misclicks while letting
  // clicks pass through the hole to the real target.
  const handleMisclick = () => onMisclick && onMisclick();

  return (
    <div ref={overlayRef} className="coach-overlay">
      <svg className="coach-overlay-svg" width="100%" height="100%">
        <defs>
          <mask id="coach-mask">
            <rect x="0" y="0" width="100%" height="100%" fill="white" />
            <rect x={x} y={y} width={w} height={h} rx={radius + 2} ry={radius + 2} fill="black" />
          </mask>
        </defs>
        <rect x="0" y="0" width="100%" height="100%" fill="rgba(0,0,0,0.42)" mask="url(#coach-mask)" />
      </svg>

      <div className="coach-shutter" style={{ left: 0, top: 0, width: vw, height: y }}                    onClick={handleMisclick} />
      <div className="coach-shutter" style={{ left: 0, top: y + h, width: vw, height: Math.max(0, vh - y - h) }} onClick={handleMisclick} />
      <div className="coach-shutter" style={{ left: 0, top: y, width: x, height: h }}                      onClick={handleMisclick} />
      <div className="coach-shutter" style={{ left: x + w, top: y, width: Math.max(0, vw - x - w), height: h }} onClick={handleMisclick} />

      <div
        key={shakeKey}
        className="coach-spotlight-ring"
        style={{ left: x, top: y, width: w, height: h, borderRadius: radius + 2 }}
      />
      {tooltip && instruction && (
        <div
          className={`coach-tooltip ${tooltip.above ? "above" : "below"}`}
          style={{ left: tooltip.left, top: tooltip.top, width: tooltip.width }}
        >
          {instruction}
        </div>
      )}
    </div>
  );
}

// ─── COACHING STRIP ─────────────────────────────────────────────────────
function CoachStrip({
  scenario, category, stepIdx, totalSteps, expected, liveTotal, paused,
  onSkip, onPause, onResume, onExit, onAdvance, isInformational,
}) {
  const step = scenario.steps[stepIdx];
  const [helpOpen, setHelpOpen] = useState(false);
  const isFinal = stepIdx === totalSteps - 1;
  const fmt = (n) => (n == null || isNaN(n)) ? "—" : `$${Number(n).toFixed(2)}`;

  return (
    <aside className="coach-strip" style={{ "--cat-color": category.color, "--cat-bg": category.bg }}>
      <header className="coach-strip-head">
        <div className="coach-strip-title">{scenario.title}</div>
        <button className="coach-strip-x" onClick={onExit} aria-label="Exit coaching">
          <Icons.Close />
        </button>
      </header>

      <div className="coach-strip-progress">
        <div className="coach-strip-step">Step {stepIdx + 1} of {totalSteps}</div>
        <div className="coach-strip-dots">
          {scenario.steps.map((_, i) => (
            <span key={i} className={`coach-dot ${i === stepIdx ? "active" : ""} ${i < stepIdx ? "done" : ""}`} />
          ))}
        </div>
      </div>

      <div className="coach-strip-body">
        <div className="coach-instruction">{step.instruction}</div>
        {step.detail && (
          <details className="coach-help" open={helpOpen} onToggle={(e) => setHelpOpen(e.target.open)}>
            <summary>Need help?</summary>
            <div>{step.detail}</div>
          </details>
        )}

        {expected != null && stepIdx === 0 && (
          <div className="coach-target-price">
            🎯 Target: <strong>{fmt(expected)}</strong> — let's get there together.
          </div>
        )}

        {isFinal && expected != null && (
          <div className="coach-final">
            <div>Expected: <strong>{fmt(expected)}</strong></div>
            <div>Actual: <strong>{fmt(liveTotal)}</strong></div>
            {Math.abs((liveTotal || 0) - expected) / Math.max(1, expected) < 0.05
              ? <div className="coach-final-ok">✓ You nailed it.</div>
              : <div className="coach-final-warn">Close — double-check the target row.</div>}
          </div>
        )}

        {isInformational && (
          <button className="coach-got-it" onClick={onAdvance}>Got it →</button>
        )}
      </div>

      <footer className="coach-strip-foot">
        <button className="coach-foot-btn" onClick={onSkip}>Skip step</button>
        <button className="coach-foot-btn" onClick={paused ? onResume : onPause}>
          {paused ? <><Icons.Play /> Resume</> : <><Icons.Pause /> Pause</>}
        </button>
        <button className="coach-foot-btn coach-foot-exit" onClick={onExit}>Exit</button>
      </footer>
    </aside>
  );
}

// ─── LESSON VIEW (browse before coaching) ───────────────────────────────
function LessonIntro({ scenario, category, expected, difficultyBadge, onStartCoaching, onBack }) {
  const fmt = (n) => (n == null || isNaN(n)) ? null : `$${Number(n).toFixed(2)}`;
  return (
    <div className="lesson-view">
      <div className="lesson-intro" style={{ borderLeft: `3px solid ${category.color}` }}>
        <div className="lesson-intro-row">
          {difficultyBadge(scenario.difficulty)}
          <span className="lesson-intro-duration">⏱ {scenario.duration}</span>
        </div>
        <div className="lesson-customer">
          <div className="lesson-customer-icon"><Icons.Customer /></div>
          <div>
            <div className="lesson-customer-label">Customer says:</div>
            <div className="lesson-customer-quote">"{scenario.customerSays}"</div>
          </div>
        </div>
        <div className="lesson-goals">
          <div className="lesson-goals-label">You'll learn how to:</div>
          <ul className="lesson-goals-list">
            {scenario.learningGoals.map((g, i) => <li key={i}>{g}</li>)}
          </ul>
        </div>
        {expected != null && (
          <div className="lesson-target">🎯 Target price: <strong>{fmt(expected)}</strong></div>
        )}
      </div>

      {scenario.tips?.length > 0 && (
        <div className="lesson-tips">
          <div className="lesson-tips-label">Tips</div>
          <ul>{scenario.tips.map((t, i) => <li key={i}>{t}</li>)}</ul>
        </div>
      )}
      {scenario.pitfalls?.length > 0 && (
        <div className="lesson-pitfalls">
          <div className="lesson-pitfalls-label">Pitfalls</div>
          <ul>{scenario.pitfalls.map((t, i) => <li key={i}>{t}</li>)}</ul>
        </div>
      )}

      <div className="lesson-footer">
        <button className="pc-btn pc-btn-secondary" onClick={onBack}>Back</button>
        <button
          className="pc-btn pc-btn-primary lesson-start-btn"
          style={{ background: category.color, borderColor: category.color }}
          onClick={onStartCoaching}
        >
          <Icons.Play /> Start coaching
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
//  MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════
export default function TrainingDrawer({ onApplyScenario, liveState = {}, pricingData = null }) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState("home"); // home | category | lesson
  const [activeCategory, setActiveCategory] = useState(null);
  const [activeScenario, setActiveScenario] = useState(null);
  const [progress, setProgress] = useState(loadProgress);

  // Coaching state
  const [coaching, setCoaching] = useState(false);
  const [stepIdx, setStepIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const [shakeKey, setShakeKey] = useState(0);   // bump to retrigger shake animation
  const [flashKey, setFlashKey] = useState(0);   // bump to flash strip border on advance
  const advanceTimerRef = useRef(null);

  // Lock body scroll when drawer is open in non-coaching mode (drawer covers the screen)
  useEffect(() => {
    if (open && !coaching) {
      const orig = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => { document.body.style.overflow = orig; };
    }
  }, [open, coaching]);

  const stats = useMemo(() => {
    const total = CATEGORIES.reduce((s, c) => s + c.scenarios.length, 0);
    const done = Object.values(progress).filter(Boolean).length;
    return { total, done, pct: total ? Math.round((done / total) * 100) : 0 };
  }, [progress]);

  const categoryProgress = (cat) => {
    const total = cat.scenarios.length;
    const done = cat.scenarios.filter(s => progress[s.id]).length;
    return { total, done, pct: total ? Math.round((done / total) * 100) : 0 };
  };

  const markComplete = useCallback((id) => {
    setProgress(prev => {
      const next = { ...prev, [id]: true };
      saveProgress(next);
      return next;
    });
  }, []);

  const expectedTotal = useMemo(() => {
    if (!activeScenario || !pricingData) return null;
    return computeExpectedTotal(activeScenario.spec, pricingData);
  }, [activeScenario, pricingData]);

  // Auto-advance: re-evaluate the current step's condition whenever liveState changes.
  useEffect(() => {
    if (!coaching || paused || !activeScenario) return;
    const step = activeScenario.steps[stepIdx];
    if (!step?.condition) return; // informational steps wait for "Got it"
    const matched = (() => {
      try { return !!step.condition(liveState, expectedTotal); }
      catch { return false; }
    })();
    if (!matched) return;
    setFlashKey(k => k + 1);
    if (advanceTimerRef.current) clearTimeout(advanceTimerRef.current);
    advanceTimerRef.current = setTimeout(() => {
      const next = stepIdx + 1;
      if (next >= activeScenario.steps.length) {
        markComplete(activeScenario.id);
        // stay on the final step so the user can see expected vs actual
      } else {
        setStepIdx(next);
        const ns = activeScenario.steps[next];
        if (ns?.initialState && typeof onApplyScenario === "function") {
          onApplyScenario(ns.initialState);
        }
      }
    }, 400);
    return () => { if (advanceTimerRef.current) clearTimeout(advanceTimerRef.current); };
  }, [liveState, coaching, paused, activeScenario, stepIdx, expectedTotal, onApplyScenario, markComplete]);

  const startCoaching = (scen) => {
    setActiveScenario(scen);
    setStepIdx(0);
    setCoaching(true);
    setOpen(false); // collapse drawer to make room for the strip
    setPaused(false);
    // Apply the first step's initialState immediately so we land on the right tab.
    const first = scen.steps[0];
    if (first?.initialState && typeof onApplyScenario === "function") {
      onApplyScenario(first.initialState);
    }
  };

  const skipStep = () => {
    if (!activeScenario) return;
    const next = stepIdx + 1;
    if (next >= activeScenario.steps.length) {
      markComplete(activeScenario.id);
    } else {
      setStepIdx(next);
      const ns = activeScenario.steps[next];
      if (ns?.initialState && typeof onApplyScenario === "function") {
        onApplyScenario(ns.initialState);
      }
    }
  };

  const advanceInformational = () => skipStep();

  const exitCoaching = () => {
    if (!activeScenario) { setCoaching(false); return; }
    const last = activeScenario.steps.length - 1;
    if (stepIdx < last) {
      const ok = window.confirm(
        `You're ${stepIdx + 1}/${activeScenario.steps.length} of the way through. Exit anyway?`
      );
      if (!ok) return;
    }
    setCoaching(false);
    setActiveScenario(null);
    setStepIdx(0);
    setPaused(false);
  };

  const onMisclick = () => setShakeKey(k => k + 1);

  const resetProgress = () => {
    if (!window.confirm("Reset all training progress?")) return;
    setProgress({});
    saveProgress({});
  };

  const openCategory = (cat) => { setActiveCategory(cat); setView("category"); };
  const openLesson   = (scen) => { setActiveScenario(scen); setView("lesson"); };
  const backHome     = () => { setView("home"); setActiveCategory(null); setActiveScenario(null); };
  const backToCat    = () => { setView("category"); setActiveScenario(null); };

  const difficultyBadge = (d) => {
    const colors = {
      beginner:     { bg: "var(--green-light)", color: "var(--green)" },
      intermediate: { bg: "var(--amber-light)", color: "var(--amber)" },
      advanced:     { bg: "#fee2e2",            color: "#dc2626" },
    };
    const c = colors[d] || colors.beginner;
    return (
      <span style={{
        background: c.bg, color: c.color, padding: "2px 8px",
        borderRadius: 6, fontSize: 10, fontWeight: 600,
        textTransform: "uppercase", letterSpacing: 0.4,
      }}>{d}</span>
    );
  };

  const currentStep = (coaching && activeScenario) ? activeScenario.steps[stepIdx] : null;
  const isInformational = !!currentStep && !currentStep.condition;

  return (
    <>
      {/* Floating Learn FAB */}
      {!coaching && (
        <button
          className="training-fab"
          onClick={() => setOpen(true)}
          aria-label="Open training"
          title="Training & tutorials"
        >
          <Icons.GradCap />
          <span className="training-fab-label">Learn</span>
          {stats.done > 0 && (
            <span className="training-fab-badge">{stats.done}/{stats.total}</span>
          )}
        </button>
      )}

      {/* Drawer (browse mode) */}
      {open && !coaching && (
        <>
          <div className="training-backdrop" onClick={() => setOpen(false)} />
          <aside className="training-drawer" role="dialog" aria-label="Training">
            <div className="training-header">
              <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 0 }}>
                {view !== "home" && (
                  <button
                    className="training-back"
                    onClick={view === "lesson" ? backToCat : backHome}
                    aria-label="Back"
                  >
                    <Icons.ChevronLeft />
                  </button>
                )}
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="training-header-title">
                    {view === "home"     && "Training Center"}
                    {view === "category" && activeCategory?.label}
                    {view === "lesson"   && activeScenario?.title}
                  </div>
                  <div className="training-header-sub">
                    {view === "home"     && `${stats.done} of ${stats.total} lessons complete`}
                    {view === "category" && activeCategory?.description}
                    {view === "lesson"   && "Read it through, then start interactive coaching"}
                  </div>
                </div>
              </div>
              <button className="training-close" onClick={() => setOpen(false)} aria-label="Close">
                <Icons.Close />
              </button>
            </div>

            <div className="training-body">
              {view === "home" && (
                <>
                  <div className="training-progress-block">
                    <div className="training-progress-row">
                      <div className="training-progress-label">Your progress</div>
                      <div className="training-progress-pct">{stats.pct}%</div>
                    </div>
                    <div className="training-progress-track">
                      <div className="training-progress-fill" style={{ width: `${stats.pct}%` }} />
                    </div>
                    {stats.done > 0 && (
                      <button className="training-reset-btn" onClick={resetProgress}>
                        <Icons.Reset /> Reset progress
                      </button>
                    )}
                  </div>

                  {stats.done === 0 && (
                    <div className="training-welcome">
                      <div className="training-welcome-icon">👋</div>
                      <div className="training-welcome-title">Welcome!</div>
                      <div className="training-welcome-body">
                        Pick a lesson, read the customer scenario, then click Start Coaching.
                        We'll spotlight each real field — you click them, the calculator updates,
                        and the next step appears automatically.
                      </div>
                    </div>
                  )}

                  <div className="training-section-label">Categories</div>
                  <div className="training-cat-list">
                    {CATEGORIES.map(cat => {
                      const cp = categoryProgress(cat);
                      return (
                        <button
                          key={cat.id}
                          className="training-cat-card"
                          onClick={() => openCategory(cat)}
                          style={{ "--cat-color": cat.color, "--cat-bg": cat.bg }}
                        >
                          <div className="training-cat-icon">{cat.icon}</div>
                          <div className="training-cat-meta">
                            <div className="training-cat-title">{cat.label}</div>
                            <div className="training-cat-desc">{cat.description}</div>
                            <div className="training-cat-progress">
                              <div className="training-cat-progress-track">
                                <div
                                  className="training-cat-progress-fill"
                                  style={{ width: `${cp.pct}%`, background: cat.color }}
                                />
                              </div>
                              <span className="training-cat-progress-count">{cp.done}/{cp.total}</span>
                            </div>
                          </div>
                          <div className="training-cat-chevron"><Icons.ChevronRight /></div>
                        </button>
                      );
                    })}
                  </div>
                </>
              )}

              {view === "category" && activeCategory && (
                <div className="training-scen-list">
                  {activeCategory.scenarios.map((scen, i) => (
                    <button
                      key={scen.id}
                      className={`training-scen-card ${progress[scen.id] ? "done" : ""}`}
                      onClick={() => openLesson(scen)}
                    >
                      <div className="training-scen-num"
                           style={{ background: activeCategory.bg, color: activeCategory.color }}>
                        {progress[scen.id] ? <Icons.Check /> : i + 1}
                      </div>
                      <div className="training-scen-meta">
                        <div className="training-scen-title">{scen.title}</div>
                        <div className="training-scen-row">
                          {difficultyBadge(scen.difficulty)}
                          <span className="training-scen-duration">⏱ {scen.duration}</span>
                          {progress[scen.id] && (
                            <span className="training-scen-done">✓ Completed</span>
                          )}
                        </div>
                      </div>
                      <div className="training-scen-chevron"><Icons.ChevronRight /></div>
                    </button>
                  ))}
                </div>
              )}

              {view === "lesson" && activeScenario && activeCategory && (
                <LessonIntro
                  scenario={activeScenario}
                  category={activeCategory}
                  expected={computeExpectedTotal(activeScenario.spec, pricingData)}
                  difficultyBadge={difficultyBadge}
                  onBack={backToCat}
                  onStartCoaching={() => startCoaching(activeScenario)}
                />
              )}
            </div>
          </aside>
        </>
      )}

      {/* Coaching mode: spotlight + strip */}
      {coaching && activeScenario && activeCategory && currentStep && (
        <>
          {!paused && (
            <Spotlight
              targetId={currentStep.target}
              instruction={currentStep.instruction}
              onMisclick={onMisclick}
              shakeKey={shakeKey}
            />
          )}
          <div key={`flash-${flashKey}`} className="coach-flash" />
          <CoachStrip
            scenario={activeScenario}
            category={activeCategory}
            stepIdx={stepIdx}
            totalSteps={activeScenario.steps.length}
            expected={expectedTotal}
            liveTotal={liveState.liveTotal}
            paused={paused}
            isInformational={isInformational}
            onSkip={skipStep}
            onPause={() => setPaused(true)}
            onResume={() => setPaused(false)}
            onExit={exitCoaching}
            onAdvance={advanceInformational}
          />
        </>
      )}
    </>
  );
}

export { CATEGORIES };
