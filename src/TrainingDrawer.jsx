// ============================================================
//  TRAINING DRAWER — Interactive Step-by-Step Tutorials
//  The UPS Store #4979 Print Calculator
//
//  HOW IT WORKS:
//  - Floating "Learn" button (bottom-right) opens a side drawer
//  - Drawer shows scenario categories → individual lessons
//  - Each lesson walks through a real walk-in customer scenario
//  - "Try it now" hands off prefilled values to the live calculator
//  - Progress saved to localStorage (completed lessons get a check)
//
//  INTEGRATION:
//  - Import this in App.jsx
//  - Render <TrainingDrawer onApplyScenario={applyScenario} /> at root
//  - Implement applyScenario(scenarioConfig) in App.jsx (see bottom of this file
//    for the exact shape it receives)
// ============================================================

import { useState, useEffect, useMemo } from "react";

// localStorage key for tracking completed lessons
const LS_PROGRESS = "printcalc_training_progress_v1";

// ─── ICONS ───────────────────────────────────────────────────
const Icons = {
  GradCap: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/>
    </svg>
  ),
  Close: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
    </svg>
  ),
  Check: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  ),
  ChevronRight: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6"/>
    </svg>
  ),
  ChevronLeft: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 18 9 12 15 6"/>
    </svg>
  ),
  Play: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="5 3 19 12 5 21 5 3" fill="currentColor"/>
    </svg>
  ),
  Lightbulb: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.1V18h6v-1.2c0-.8.4-1.6 1-2.1A7 7 0 0 0 12 2z"/>
    </svg>
  ),
  Warn: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.3 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
    </svg>
  ),
  Customer: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
    </svg>
  ),
  Money: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
    </svg>
  ),
  Reset: () => (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>
    </svg>
  ),
};

// ═══════════════════════════════════════════════════════════════
//  SCENARIO LIBRARY — the heart of the training section
// ═══════════════════════════════════════════════════════════════
//
//  Each scenario has:
//    id              unique key for progress tracking
//    title           short lesson title
//    difficulty      'beginner' | 'intermediate' | 'advanced'
//    duration        rough time estimate (e.g. "3 min")
//    customerSays    sample customer phrasing — what the walk-in
//                    actually said at the counter
//    learningGoals   what the user will know after finishing
//    steps           array of step objects (see below)
//    expectedTotal   the price they should land on
//    tips            confidence-building notes ("why this works")
//    pitfalls        common mistakes to watch for
//    apply           config object handed to App.jsx via
//                    onApplyScenario() to prefill the live calculator
//
//  Each step has:
//    title           short step heading
//    body            explanation paragraph
//    field           (optional) which UI field to highlight
//                    visually in the screenshot annotation
//    value           (optional) the value to enter in that field
//
const CATEGORIES = [
  // ───────────────────────────────────────────────────────
  //  CATEGORY 1: COMMON WALK-INS
  // ───────────────────────────────────────────────────────
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
        title: "100 full-color flyers on 8.5×11",
        difficulty: "beginner",
        duration: "3 min",
        customerSays: "Hi, can I get 100 color flyers? Just regular paper, single-sided.",
        learningGoals: [
          "Set print size and quantity",
          "Choose paper type and sheet size",
          "Read the price bar",
        ],
        steps: [
          {
            title: "Open Sheets & Photos",
            body: "The Sheets & Photos tab handles anything that prints on a flat sheet — flyers, photos, business cards, postcards. It's the default tab and the one you'll use most.",
            field: "tab:paper",
          },
          {
            title: "Set the print size",
            body: "Step 1 of the form is 'Print Size'. The customer wants flyers, so choose 8.5 × 11 from the preset sheet sizes. The print fills the whole sheet.",
            field: "printSize",
            value: "8.5 × 11",
          },
          {
            title: "Set the quantity",
            body: "In the Quantity field, type 100. As soon as you change this number, the price bar at the bottom updates in real time.",
            field: "quantity",
            value: "100",
          },
          {
            title: "Pick the paper type",
            body: "For a basic flyer, 20lb Bond is your default. If the customer says 'something nicer' or 'thicker' — bump up to 24lb Premium or Cardstock 80lb.",
            field: "paperType",
            value: "20lb Bond",
          },
          {
            title: "Confirm color mode",
            body: "Color is selected by default. The customer said 'full-color', so leave it. (If they'd said 'black and white' or 'just text', you'd switch to B&W — which is significantly cheaper.)",
            field: "colorMode",
            value: "Color",
          },
          {
            title: "Read the price bar",
            body: "Look at the sticky bar at the bottom: Per Sheet, Sheets, Estimated Total. That total is your quote. Tell the customer the number, then hit Download Order Sheet to print the barcode/route slip for production.",
            field: "priceBar",
          },
        ],
        expectedTotal: "$45–60 (depends on your store's pricing)",
        tips: [
          "If the customer asks for double-sided, just toggle the Back Side switch — the calculator adds the back-side cost automatically.",
          "Quantity discounts kick in at tiers you've configured in Admin. A customer ordering 500 will see a lower per-sheet rate than 100.",
        ],
        pitfalls: [
          "Don't forget to confirm 'full bleed' vs 'with margins' — it doesn't change the price but it affects the file you receive.",
          "If the file is a PDF, drag it into the upload zone instead of typing dimensions — the calculator reads the page size automatically.",
        ],
        apply: {
          tab: "paper",
          printW: 8.5,
          printH: 11,
          quantity: 100,
          paperKey: "20lb_bond",
          sheetKey: "8.5x11",
          colorMode: "color",
          backEnabled: false,
        },
      },
      {
        id: "walkin-bizcards",
        title: "250 business cards, double-sided",
        difficulty: "beginner",
        duration: "4 min",
        customerSays: "I need 250 business cards. They're 3.5 by 2 inches, color on both sides.",
        learningGoals: [
          "Use a non-standard print size (gang-up imposition)",
          "Enable double-sided pricing",
          "Understand prints-per-sheet math",
        ],
        steps: [
          {
            title: "Open Sheets & Photos",
            body: "Business cards print on cardstock and run through the Ricoh just like flyers — only smaller and ganged up multiple per sheet. Same tab.",
            field: "tab:paper",
          },
          {
            title: "Enter the card size as the print size",
            body: "Print width 3.5, print height 2. The calculator will figure out how many cards fit on a sheet — that's called 'gang-up imposition' and it's where the savings come from.",
            field: "printSize",
            value: "3.5 × 2 (custom)",
          },
          {
            title: "Pick a sheet stock",
            body: "Choose Cardstock 80lb at 8.5 × 11. The preview shows you how many cards fit on each sheet (typically 10 per sheet for a 3.5×2 card on 8.5×11).",
            field: "paperType",
            value: "Cardstock 80lb",
          },
          {
            title: "Enter the customer quantity",
            body: "Type 250 in the Quantity field. The calculator does the math: 250 ÷ 10 per sheet = 25 sheets. You don't have to compute this yourself.",
            field: "quantity",
            value: "250",
          },
          {
            title: "Turn on Double-Sided",
            body: "Toggle the Back Side switch ON. The price bar updates — back side typically adds ~75% of the front cost (configured in Admin).",
            field: "backSide",
            value: "ON",
          },
          {
            title: "Quote the customer and produce",
            body: "Read the total to the customer. Hit Download Order Sheet — the PDF includes the barcode and a single-page preview showing the card layout exactly as it'll print.",
            field: "priceBar",
          },
        ],
        expectedTotal: "$30–55 (depends on pricing config)",
        tips: [
          "Most business card customers don't know their cards are 3.5×2. If they say 'standard', that's the size.",
          "If they bring in a PDF designed at 8.5×11 with all 10 cards already laid out, drop it in the upload zone instead — the calculator treats it as a single 8.5×11 print.",
        ],
        pitfalls: [
          "Don't enter quantity 250 with sheet size set to 3.5×2 only — the calculator needs the full sheet (8.5×11) selected so it knows to gang them up.",
          "Watch the front/back alignment in the preview — if your file isn't designed for duplex, it'll print misaligned. Recommend the customer bring a properly-set-up duplex PDF.",
        ],
        apply: {
          tab: "paper",
          printW: 3.5,
          printH: 2,
          quantity: 250,
          paperKey: "cardstock_80",
          sheetKey: "8.5x11",
          colorMode: "color",
          backEnabled: true,
        },
      },
      {
        id: "walkin-photos",
        title: "20 photo prints at 5×7",
        difficulty: "beginner",
        duration: "2 min",
        customerSays: "Can you print 20 of these photos? 5 by 7, glossy please.",
        learningGoals: [
          "Use photo paper (different from regular stock)",
          "Quote a small photo job",
        ],
        steps: [
          {
            title: "Open Sheets & Photos",
            body: "Photo prints run on the same Ricoh, but on photo media. Same tab.",
            field: "tab:paper",
          },
          {
            title: "Set print size to 5 × 7",
            body: "Click the 5×7 preset. This tells the calculator the customer wants the print to fill a 5×7 sheet — no margins, no gang-up.",
            field: "printSize",
            value: "5 × 7",
          },
          {
            title: "Choose Photo Glossy paper",
            body: "Photo Glossy is in the paper-type dropdown. Selecting it automatically restricts the sheet sizes to those your photo paper actually comes in.",
            field: "paperType",
            value: "Photo Glossy",
          },
          {
            title: "Set the quantity",
            body: "Type 20. Each print is one 5×7 sheet, so this is also 20 sheets.",
            field: "quantity",
            value: "20",
          },
          {
            title: "Quote",
            body: "Photo prints are priced per sheet at a higher rate than bond paper. The price bar shows the total — give it to the customer.",
            field: "priceBar",
          },
        ],
        expectedTotal: "$15–40 (depends on photo paper pricing)",
        tips: [
          "If the customer wants a mix of sizes (some 4×6, some 5×7), do them as separate jobs and add up the totals — or use Quick Quote to compare.",
          "Photo Matte exists too — same pricing structure, just a different finish. Ask the customer which they prefer.",
        ],
        pitfalls: [
          "If the customer's file isn't actually 5×7 aspect ratio, you'll get cropping or white bars. Open it before charging — saves a reprint.",
        ],
        apply: {
          tab: "paper",
          printW: 5,
          printH: 7,
          quantity: 20,
          paperKey: "photo_glossy",
          sheetKey: "8.5x11",
          colorMode: "color",
          backEnabled: false,
        },
      },
    ],
  },

  // ───────────────────────────────────────────────────────
  //  CATEGORY 2: BOOKLETS & DATAMERGE (IMPOSE)
  // ───────────────────────────────────────────────────────
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
        title: "20-page saddle-stitch booklet, 50 copies",
        difficulty: "intermediate",
        duration: "5 min",
        customerSays: "I need 50 booklets. 20 pages each, 5.5 by 8.5 finished, full color.",
        learningGoals: [
          "Understand signatures (sheets folded in half)",
          "Pick the right stock size for a finished size",
          "Recognize when a booklet exceeds saddle-stitch limits",
        ],
        steps: [
          {
            title: "Open Impose → Booklet Maker",
            body: "Saddle-stitch booklets are folded sheets stapled at the spine. The Impose tab handles the page-order math (called imposition) automatically.",
            field: "tab:impose",
          },
          {
            title: "Set the finished booklet size",
            body: "Finished size 5.5 × 8.5 means the closed booklet is letter-size folded in half. The calculator picks the right sheet stock automatically: 8.5 × 11, folded.",
            field: "finishedSize",
            value: "5.5 × 8.5",
          },
          {
            title: "Upload the customer's PDF",
            body: "Drop their 20-page PDF in the upload zone. The calculator reads the page count and shows you the signature math: 20 pages = 5 sheets, folded and stapled.",
            field: "pdfUpload",
          },
          {
            title: "Pick the paper",
            body: "Cardstock 80lb makes a sturdy booklet that holds up. 24lb Premium is lighter and cheaper. Ask the customer if it's a wedding program (heavier feels nicer) or a meeting handout (lighter is fine).",
            field: "paperType",
            value: "24lb Premium Bond",
          },
          {
            title: "Set the copies",
            body: "Quantity = 50 (number of finished booklets). The calculator multiplies: 5 sheets × 50 copies = 250 sheets to run on the Ricoh.",
            field: "quantity",
            value: "50",
          },
          {
            title: "Check the saddle-stitch warning",
            body: "If you're under the Ricoh's saddle-stitch limit (typically 15 sheets / 60 pages), you'll see a green checkmark. Over the limit = you'll need perfect-binding instead, and the calculator warns you in red.",
            field: "warningBox",
          },
        ],
        expectedTotal: "Per-sheet × 250 sheets, with quantity discount applied",
        tips: [
          "The calculator's preview shows the imposition order — front and back of each sheet — so you can sanity-check before printing.",
          "Booklets are always duplex. The back-side cost is automatically added; you don't toggle it manually.",
        ],
        pitfalls: [
          "Page count must be a multiple of 4 (front + back × folded). If the customer's PDF is 18 pages, the calculator pads with 2 blanks. Tell them so they can decide if they want to redesign.",
          "5.5 × 8.5 finished = 8.5 × 11 stock. 8.5 × 11 finished = 11 × 17 stock. Don't pick the finished size as the stock size — the booklet won't fold right.",
        ],
        apply: {
          tab: "impose",
          imposeTool: "booklet",
          finishedW: 5.5,
          finishedH: 8.5,
          totalPages: 20,
          copies: 50,
          paperKey: "24lb_premium",
          colorMode: "color",
        },
      },
      {
        id: "impose-tickets",
        title: "500 numbered raffle tickets",
        difficulty: "intermediate",
        duration: "4 min",
        customerSays: "I need 500 raffle tickets, numbered 1 to 500. They're 2 by 5.5 inches, color on top white on bottom.",
        learningGoals: [
          "Use DataMerge for sequential numbering",
          "Skip the CSV step (numbering only)",
          "Calculate prints-per-sheet for ticket layout",
        ],
        steps: [
          {
            title: "Open Impose → DataMerge",
            body: "DataMerge handles two jobs: (1) mail merge from a CSV — names, addresses, etc — and (2) sequential numbering, even without a CSV. Raffle tickets are case 2.",
            field: "tab:impose",
          },
          {
            title: "Upload the ticket template PDF",
            body: "The customer brings a one-ticket PDF designed at 2 × 5.5 with a placeholder where the number goes (often '#####' or {NUMBER}). Drop it in the upload zone.",
            field: "pdfUpload",
          },
          {
            title: "Pick the sheet stock",
            body: "Tickets are small — gang them up on 8.5 × 11 or 11 × 17. 11 × 17 fits more per sheet (typically 10) so it's faster and slightly cheaper for big runs. Cardstock 80lb makes a tear-resistant ticket.",
            field: "paperType",
            value: "Cardstock 80lb",
          },
          {
            title: "Skip the CSV step",
            body: "DataMerge doesn't require a CSV. If you just need 1, 2, 3… numbering, leave the CSV step empty and use the 'Sequential numbering' option.",
            field: "csvStep",
          },
          {
            title: "Set the start and quantity",
            body: "Start = 1, Total = 500. The calculator works out sheets needed: 500 ÷ 10 per sheet = 50 sheets.",
            field: "quantity",
            value: "500",
          },
          {
            title: "Quote and produce",
            body: "Color (the colored top half costs the same as full color in our pricing). Read the total. Download the order sheet — production runs the merge automatically.",
            field: "priceBar",
          },
        ],
        expectedTotal: "50 sheets × per-sheet rate, with discount for 500-piece volume",
        tips: [
          "If the customer brings a CSV with names attached to numbers (e.g. ticket #1 = John Smith), use the CSV upload — DataMerge will auto-fill both fields.",
          "Two-part raffle tickets (a stub) are still one design with two halves on the same ticket. Treat as one print at full ticket size.",
        ],
        pitfalls: [
          "Make sure the ticket template has the number placeholder in the same spot on every ticket — DataMerge swaps text in place, it doesn't reflow layouts.",
          "Don't enter 500 as the sheet count. 500 is the customer-facing quantity; the calculator computes sheets.",
        ],
        apply: {
          tab: "impose",
          imposeTool: "datamerge",
          printW: 2,
          printH: 5.5,
          quantity: 500,
          paperKey: "cardstock_80",
          sheetKey: "11x17",
          colorMode: "color",
          numberStart: 1,
        },
      },
      {
        id: "impose-mailmerge",
        title: "Mail-merge 200 personalized postcards",
        difficulty: "advanced",
        duration: "6 min",
        customerSays: "I have a list of 200 customers. I want a postcard mailed to each one with their name on the front.",
        learningGoals: [
          "Upload and map a CSV to template fields",
          "Set up a postcard layout for mail merge",
          "Communicate timing (merge takes longer than static prints)",
        ],
        steps: [
          {
            title: "Open Impose → DataMerge",
            body: "Mail-merge is DataMerge's main job. The customer provides a CSV (columns like FirstName, LastName, Address) and a postcard template with placeholders.",
            field: "tab:impose",
          },
          {
            title: "Upload the postcard template",
            body: "A 5.5 × 4.25 postcard PDF with placeholders like {FirstName} or %FIRST_NAME% baked into the design. Drop it in.",
            field: "pdfUpload",
          },
          {
            title: "Pick the stock",
            body: "Postcards = Cardstock 100lb on 11 × 17 (gangs up 8 per sheet). Cardstock 80lb is cheaper if budget matters more than thickness.",
            field: "paperType",
            value: "Cardstock 100lb",
          },
          {
            title: "Upload the CSV",
            body: "Step 3 is the CSV upload. The calculator reads the headers and shows you each column. Map placeholders → CSV columns: {FirstName} → 'first_name', etc.",
            field: "csvUpload",
          },
          {
            title: "Confirm the row count",
            body: "If the CSV has 200 rows and gang-up is 8 per sheet, that's 25 sheets. The calculator shows this in real time so you can sanity-check before quoting.",
            field: "quantity",
            value: "200 records",
          },
          {
            title: "Quote and warn about timing",
            body: "Mail-merges take longer than static prints because production has to validate the merge. Tell the customer 'same-day if dropped before noon, otherwise tomorrow' — set realistic expectations.",
            field: "priceBar",
          },
        ],
        expectedTotal: "25 sheets × cardstock rate, with 200-piece quantity discount",
        tips: [
          "Always open the CSV in a text editor first if you're unsure — bad encoding (special characters in names) is the #1 source of merge errors.",
          "If the customer's CSV has columns the template doesn't use, that's fine. Just don't map them.",
        ],
        pitfalls: [
          "Customer-provided CSVs sometimes have a blank trailing row. The calculator counts it as a record and you'd print one extra blank postcard. Open the CSV before uploading and trim trailing blanks.",
          "Placeholders are case-sensitive: {FirstName} ≠ {firstname}. Match exactly what's in the template.",
        ],
        apply: {
          tab: "impose",
          imposeTool: "datamerge",
          printW: 5.5,
          printH: 4.25,
          quantity: 200,
          paperKey: "cardstock_100",
          sheetKey: "11x17",
          colorMode: "color",
        },
      },
    ],
  },

  // ───────────────────────────────────────────────────────
  //  CATEGORY 3: LARGE FORMAT & BLUEPRINTS
  // ───────────────────────────────────────────────────────
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
        title: "3×8 ft vinyl banner with grommets",
        difficulty: "intermediate",
        duration: "4 min",
        customerSays: "I need a banner, 3 feet by 8 feet, with grommets in the corners.",
        learningGoals: [
          "Switch to Large Format tab",
          "Enter dimensions in inches (not feet)",
          "Add grommets as a per-each add-on",
        ],
        steps: [
          {
            title: "Open Large Format",
            body: "Anything wider than 13 inches is large format — runs on the HP DesignJet T2600 (36-inch wide roll). Banners, posters, trade-show graphics all live here.",
            field: "tab:large",
          },
          {
            title: "Enter dimensions in inches",
            body: "The customer said feet, but the calculator is in inches. 3 feet = 36 inches, 8 feet = 96 inches. Width 36, height 96. Always confirm the orientation (portrait vs landscape) — banners usually hang horizontally.",
            field: "dimensions",
            value: "36 × 96",
          },
          {
            title: "Pick the media",
            body: "Vinyl Banner is the standard banner material — weather-resistant, takes grommets without tearing. For indoor only, you could use Photo Satin (cheaper but won't survive rain).",
            field: "paperType",
            value: "Vinyl Banner",
          },
          {
            title: "Set the quantity",
            body: "Most banners are quantity 1. If the customer wants 3 identical banners, type 3.",
            field: "quantity",
            value: "1",
          },
          {
            title: "Add 4 grommets",
            body: "Scroll to the Add-Ons section. Grommets are priced per-each — the customer wants 4 (one in each corner). Type 4 in the grommet quantity field.",
            field: "grommets",
            value: "4",
          },
          {
            title: "Quote",
            body: "The price bar shows base banner cost + grommet add-on. Read the total to the customer. Download Order Sheet for production.",
            field: "priceBar",
          },
        ],
        expectedTotal: "Sq-ft cost × 24 sq ft + 4 × grommet rate",
        tips: [
          "Big banners (over 6 feet) get more grommets — typically every 2 feet along the top. Ask: 'Just corners, or do you want grommets every 2 feet for hanging?'",
          "Wind-load matters outdoors. A 3×8 banner in 30mph wind needs reinforced edges (hemming) — that's a separate add-on you may want to mention.",
        ],
        pitfalls: [
          "The DesignJet maxes out at 36 inches wide. A 4×8 banner has a 48-inch dimension — that side has to be the length (along the roll), not the width. The calculator catches this if you flip dimensions wrong.",
          "Don't print banners on photo media unless the customer explicitly asks. They'll tear and fade.",
        ],
        apply: {
          tab: "large",
          lfWidth: 36,
          lfHeight: 96,
          lfQuantity: 1,
          lfPaperKey: "vinyl_banner",
          grommetQty: 4,
        },
      },
      {
        id: "lf-poster",
        title: "Single 24×36 photo poster",
        difficulty: "beginner",
        duration: "3 min",
        customerSays: "Can you print this photo as a 24 by 36 poster?",
        learningGoals: [
          "Quote a one-off large-format print",
          "Choose between glossy and satin photo finish",
        ],
        steps: [
          {
            title: "Open Large Format",
            body: "24×36 is too wide for the Ricoh's 13-inch sheet limit, so it runs on the DesignJet. Large Format tab.",
            field: "tab:large",
          },
          {
            title: "Set dimensions",
            body: "Width 24, height 36. Posters are usually portrait — taller than wide.",
            field: "dimensions",
            value: "24 × 36",
          },
          {
            title: "Pick the finish",
            body: "Photo Glossy = high contrast, vibrant, good for action shots and color-saturated images. Photo Satin = matte sheen, no glare, better for portraits and indoor display. Ask the customer or look at their image.",
            field: "paperType",
            value: "Photo Satin",
          },
          {
            title: "Quantity 1",
            body: "Default. If they want 2 of the same poster, type 2 — quantity discount may apply.",
            field: "quantity",
            value: "1",
          },
          {
            title: "Quote",
            body: "Large format pricing is per square foot. 24×36 = 6 sq ft × per-sq-ft rate. The price bar shows it. Read it to the customer.",
            field: "priceBar",
          },
        ],
        expectedTotal: "6 sq ft × Photo Satin rate (typically $30–60)",
        tips: [
          "If the customer's file is low-resolution (under 100 DPI at 24×36 = pixelated mess), open it before printing. Recommend a smaller poster or a higher-res file.",
          "Posters get rolled in a tube for transport. Free with most stores; check yours.",
        ],
        pitfalls: [
          "Don't print high-end photos on Translucent Bond — that's for window graphics, not photo display.",
        ],
        apply: {
          tab: "large",
          lfWidth: 24,
          lfHeight: 36,
          lfQuantity: 1,
          lfPaperKey: "photo_satin_lf",
        },
      },
      {
        id: "blueprint-set",
        title: "Set of 8 architectural blueprints, 24×36",
        difficulty: "intermediate",
        duration: "4 min",
        customerSays: "I need a set of blueprints printed. Eight sheets, 24 by 36.",
        learningGoals: [
          "Use the Blueprints tab (different pricing model)",
          "Quote a multi-sheet blueprint set",
        ],
        steps: [
          {
            title: "Open Blueprints",
            body: "Blueprints are a separate tab because they're priced differently from photo posters — flat rate per sheet, regardless of color content. Architects print sets of these all the time.",
            field: "tab:blueprint",
          },
          {
            title: "Pick the size",
            body: "24×36 is the most common architectural size. Click the 24×36 preset.",
            field: "blueprintSize",
            value: "24 × 36",
          },
          {
            title: "Enter the sheet count",
            body: "Quantity = 8 (one per blueprint sheet, not multiplied by anything).",
            field: "quantity",
            value: "8",
          },
          {
            title: "Upload the blueprint file",
            body: "Customer brings a multi-page PDF (8 pages, one per sheet). The calculator can also accept DWG or individual images.",
            field: "pdfUpload",
          },
          {
            title: "Quote",
            body: "Per-sheet rate × 8 sheets, with any blueprint quantity discount. Lower per-sheet than photo posters because the ink usage is much lower.",
            field: "priceBar",
          },
        ],
        expectedTotal: "8 × blueprint per-sheet rate (configured in Admin)",
        tips: [
          "If the customer brings a multi-page PDF, the page count = sheet count automatically. You don't have to count.",
          "Architects often bring sets twice a year — same files. Ask if they want extras printed for revisions.",
        ],
        pitfalls: [
          "Blueprints are bond paper, not photo. Don't quote photo prices for blueprints — you'll either undercharge or scare them off.",
          "Pages with heavy color (renderings) might bleed through on bond paper. Recommend Translucent Bond if they show color renderings.",
        ],
        apply: {
          tab: "blueprint",
          bpWidth: 24,
          bpHeight: 36,
          bpQty: 8,
        },
      },
    ],
  },

  // ───────────────────────────────────────────────────────
  //  CATEGORY 4: QUICK QUOTE
  // ───────────────────────────────────────────────────────
  {
    id: "quote",
    label: "Quick Quote",
    icon: "⚡",
    color: "var(--blue)",
    bg: "var(--blue-light)",
    description: "Comparing prices for shoppers and budget-conscious customers",
    scenarios: [
      {
        id: "quote-compare",
        title: "Customer asks 'what's cheapest?'",
        difficulty: "beginner",
        duration: "3 min",
        customerSays: "I need 200 flyers, 8.5 by 11. What's cheapest?",
        learningGoals: [
          "Switch into Quick Quote mode",
          "Read a price comparison table",
          "Identify the 'Best' row",
        ],
        steps: [
          {
            title: "Click Quick Quote",
            body: "The Quick Quote button is in the header (top-right). Hitting it switches the calculator into a comparison view — instead of one quote, you see every paper × sheet combination side-by-side.",
            field: "header:quote",
          },
          {
            title: "Enter the print size and quantity",
            body: "Width 8.5, height 11, quantity 200. Color mode color, single-sided.",
            field: "quoteFields",
          },
          {
            title: "Read the table",
            body: "Each row is a paper × sheet combination, with the total price. Cheapest is highlighted with a 'Best' badge — usually 20lb Bond on 8.5×11.",
            field: "quoteTable",
          },
          {
            title: "Show the customer",
            body: "Turn the screen toward them and walk through 3–4 rows: 'On regular paper, $X. On premium, $Y. On cardstock, $Z.' Let them pick the trade-off.",
            field: "quoteTable",
          },
          {
            title: "Switch back to Sheets & Photos",
            body: "Once they pick, hit Quick Quote again to leave comparison mode and go back to the standard tool, then enter their choice and produce the order.",
            field: "header:quote",
          },
        ],
        expectedTotal: "Multiple options shown — customer picks",
        tips: [
          "Quick Quote is a sales tool. Customers love seeing options, and showing the table builds trust — they see you're not gouging.",
          "If they ask 'what about double-sided?' toggle the switch in Quick Quote — the whole table re-prices instantly.",
        ],
        pitfalls: [
          "Quick Quote ignores add-ons (grommets, lamination). For complete add-on pricing, use the standard tabs.",
          "Don't get lost in the table. The 'Best' row is what the customer wants 90% of the time. Lead with it.",
        ],
        apply: {
          viewMode: "quote",
          quotePrintW: 8.5,
          quotePrintH: 11,
          quoteQty: 200,
          quoteFrontColorMode: "color",
          quoteBackEnabled: false,
          quoteShowAllPapers: true,
        },
      },
      {
        id: "quote-budget",
        title: "Customer has a $50 budget",
        difficulty: "intermediate",
        duration: "3 min",
        customerSays: "I have 50 bucks. How many flyers can I get?",
        learningGoals: [
          "Reverse-engineer quantity from a budget",
          "Use Quick Quote to find the sweet spot",
        ],
        steps: [
          {
            title: "Open Quick Quote",
            body: "Same comparison view. We'll work backward: pick a paper, then bump quantity until the total hits ~$50.",
            field: "header:quote",
          },
          {
            title: "Start with the cheapest paper",
            body: "20lb Bond, 8.5×11, color. Set quantity to 100 as a starting point.",
            field: "quoteFields",
          },
          {
            title: "Watch the total — adjust",
            body: "If the table shows 100 flyers = $30, they have headroom. Bump to 150, then 200 — until you find the largest quantity that stays under $50.",
            field: "quoteTable",
          },
          {
            title: "Offer a small upgrade option",
            body: "If 175 flyers on 20lb Bond hits exactly $50 — also show them 100 flyers on 24lb Premium. Same budget, fewer flyers but nicer paper. Let them choose.",
            field: "quoteTable",
          },
          {
            title: "Confirm and switch back",
            body: "Once they pick, leave Quick Quote and produce the order in the regular Sheets & Photos tab.",
            field: "header:quote",
          },
        ],
        expectedTotal: "Fits inside their budget",
        tips: [
          "Quantity discounts mean a $50 budget often gets the customer further than they expect. Show them: '$50 actually gets you 175 flyers, not 150.'",
          "If they have a hard quantity ('I need at least 100'), that's a constraint — don't push them lower for a paper upgrade.",
        ],
        pitfalls: [
          "Don't quote a number that includes tax/charges the calculator doesn't show. Always communicate the calculator total as 'before tax'.",
        ],
        apply: {
          viewMode: "quote",
          quotePrintW: 8.5,
          quotePrintH: 11,
          quoteQty: 175,
          quoteFrontColorMode: "color",
          quoteBackEnabled: false,
          quoteShowAllPapers: true,
        },
      },
    ],
  },

  // ───────────────────────────────────────────────────────
  //  CATEGORY 5: TRICKY EDGE CASES
  // ───────────────────────────────────────────────────────
  {
    id: "edge",
    label: "Tricky Edge Cases",
    icon: "🎯",
    color: "var(--text)",
    bg: "var(--surface-3)",
    description: "Custom sizes, mixed orders, things that trip new staff",
    scenarios: [
      {
        id: "edge-custom",
        title: "Customer brings an odd size: 4.25 × 11",
        difficulty: "intermediate",
        duration: "3 min",
        customerSays: "I have these long flyers, 4.25 by 11. I need 300 of them.",
        learningGoals: [
          "Use a custom (non-preset) print size",
          "Understand gang-up math for odd sizes",
        ],
        steps: [
          {
            title: "Sheets & Photos tab",
            body: "Custom sizes still print on the Ricoh. Same tab as a standard flyer.",
            field: "tab:paper",
          },
          {
            title: "Pick the Custom preset",
            body: "In Step 1 (Print Size), the dropdown has presets (4×6, 5×7, 8.5×11, etc.) plus 'Custom'. Pick Custom — two number fields appear.",
            field: "printSize",
            value: "Custom",
          },
          {
            title: "Type 4.25 × 11",
            body: "Width 4.25, height 11. The calculator now figures out how many fit on a sheet.",
            field: "customDims",
            value: "4.25 × 11",
          },
          {
            title: "Pick the sheet stock",
            body: "8.5 × 11 paper at 4.25 × 11 print = exactly 2 prints per sheet (no waste). That's why this size exists — it's a 'half sheet' design that gangs perfectly.",
            field: "paperType",
            value: "20lb Bond",
          },
          {
            title: "Enter quantity 300",
            body: "300 ÷ 2 per sheet = 150 sheets. Calculator does the math.",
            field: "quantity",
            value: "300",
          },
          {
            title: "Quote",
            body: "Per-sheet rate × 150 sheets, with quantity discount. Same as a regular order — only the imposition was different.",
            field: "priceBar",
          },
        ],
        expectedTotal: "150 sheets × per-sheet rate",
        tips: [
          "Half-sheets (4.25×11), quarter-sheets (4.25×5.5), and bookmark sizes (2×8) are all common 'custom' sizes that gang perfectly. Memorize how many fit per sheet — speeds up your quoting.",
          "If a custom size doesn't gang cleanly (e.g. 4×9 on 8.5×11 = 2 with a lot of waste), the calculator still handles it, but the customer pays for the waste. Mention it: 'A 4×8.5 size would be cheaper for the same look.'",
        ],
        pitfalls: [
          "Don't confuse custom print size with custom sheet size. The print is what the customer sees on the finished piece. The sheet is what runs through the press.",
        ],
        apply: {
          tab: "paper",
          printW: 4.25,
          printH: 11,
          quantity: 300,
          paperKey: "20lb_bond",
          sheetKey: "8.5x11",
          colorMode: "color",
          backEnabled: false,
        },
      },
      {
        id: "edge-duplex-math",
        title: "Customer asks why double-sided isn't half price",
        difficulty: "intermediate",
        duration: "3 min",
        customerSays: "Wait — if I'm doing double-sided, I'm using the same paper, right? Why isn't it just the same price?",
        learningGoals: [
          "Explain duplex pricing logic",
          "Build customer trust by being transparent",
        ],
        steps: [
          {
            title: "Open the calculator with their job",
            body: "Sheets & Photos, 100 flyers, 8.5×11, 20lb Bond, single-sided. Show them the price.",
            field: "tab:paper",
          },
          {
            title: "Toggle Back Side ON",
            body: "Watch the price update. It typically goes up by ~75% of the front price — not 100%. Why? Same paper, same setup, but the back side does use ink and machine time.",
            field: "backSide",
            value: "ON",
          },
          {
            title: "Explain the 'why'",
            body: "Tell the customer: 'You're right that we're using one piece of paper instead of two. That's why double-sided is cheaper than printing twice. But the back side still uses ink and a second pass through the machine — that's the 75% add.'",
            field: "explanation",
          },
          {
            title: "Show the comparison",
            body: "Open Quick Quote with their dimensions. Toggle double-sided ON and OFF — they see the price changes in real time. This builds trust.",
            field: "header:quote",
          },
          {
            title: "Land the close",
            body: "'So 100 flyers double-sided costs ~75% more than single-sided, but a lot less than printing 200 single-sided flyers and gluing them together.' Most customers say 'OK, double-sided' at this point.",
            field: "priceBar",
          },
        ],
        expectedTotal: "Front price × 1.75 (configured in Admin as backSideFactor)",
        tips: [
          "The 75% multiplier is configurable in Admin. Some stores price it at 50%, some at 80%. Know your store's number.",
          "Customers who push back on price often just want to feel the math is fair. Showing the toggle live = trust earned.",
        ],
        pitfalls: [
          "Don't say 'double-sided is double the price'. It isn't, and a savvy customer will catch you.",
        ],
        apply: {
          tab: "paper",
          printW: 8.5,
          printH: 11,
          quantity: 100,
          paperKey: "20lb_bond",
          sheetKey: "8.5x11",
          colorMode: "color",
          backEnabled: true,
        },
      },
      {
        id: "edge-mixed",
        title: "Mixed order: flyers + business cards together",
        difficulty: "advanced",
        duration: "5 min",
        customerSays: "I need 200 flyers and 250 business cards. Can you give me one total?",
        learningGoals: [
          "Quote two jobs and combine totals",
          "Use the order sheet to bundle production",
        ],
        steps: [
          {
            title: "Quote the flyers first",
            body: "Sheets & Photos, 8.5×11, 20lb Bond, color, qty 200. Note the total — write it down or remember it.",
            field: "tab:paper",
          },
          {
            title: "Download the flyer order sheet",
            body: "Hit Download Order Sheet for the flyers. This locks in that quote with a barcode for production.",
            field: "priceBar",
          },
          {
            title: "Re-do the calculator for business cards",
            body: "Same tab. Change Print Size to 3.5 × 2 (custom). Cardstock 80lb at 8.5×11. Quantity 250. Toggle Back Side ON.",
            field: "printSize",
            value: "3.5 × 2",
          },
          {
            title: "Note the second total",
            body: "Cards total. Add it to the flyer total mentally or on a sticky note. That's the customer's grand total.",
            field: "priceBar",
          },
          {
            title: "Download the cards order sheet too",
            body: "Two separate order sheets, two separate barcodes — production runs them as separate jobs but you ring them up as one transaction.",
            field: "priceBar",
          },
          {
            title: "Communicate the bundle",
            body: "Tell the customer: 'Flyers $X, cards $Y, total $Z. Both ready by tomorrow.' Two POs, one transaction.",
            field: "explanation",
          },
        ],
        expectedTotal: "Flyer total + business card total",
        tips: [
          "If the customer asks for one combined invoice, ring them up at POS as a single transaction with two line items. The calculator just produces the production tickets.",
          "If they ask for a small bundle discount, you have authority to discount up to ~5% in most stores. Use it — it earns repeat business.",
        ],
        pitfalls: [
          "Don't try to fudge the cards into the flyer order to make it 'one job'. They're different stocks and different processes — production needs separate tickets.",
          "Watch for double-counting quantity discount tiers. 200 flyers + 250 cards ≠ 450-piece tier discount; they're separate jobs.",
        ],
        apply: {
          tab: "paper",
          printW: 8.5,
          printH: 11,
          quantity: 200,
          paperKey: "20lb_bond",
          sheetKey: "8.5x11",
          colorMode: "color",
          backEnabled: false,
        },
      },
    ],
  },

  // ───────────────────────────────────────────────────────
  //  CATEGORY 6: SPECIALTY / SIGNS365 TRADE PRINTING
  // ───────────────────────────────────────────────────────
  {
    id: "specialty",
    label: "Specialty (Signs365)",
    icon: "🪧",
    color: "var(--purple)",
    bg: "var(--purple-light)",
    description: "Banners, yard signs, magnets, decals — outsourced to Signs365",
    scenarios: [
      {
        id: "sp-banner-13oz",
        title: "Grand-opening vinyl banner (3×8 ft)",
        difficulty: "intermediate",
        duration: "4 min",
        customerSays: "I'm opening a new shop and I need a 3 by 8 foot banner with grommets to hang on the side of the building.",
        learningGoals: [
          "Switch to the Specialty tab",
          "Pick the right banner stock (13oz vinyl is the everyday default)",
          "Toggle grommets and read the per-sq-ft tier price live",
          "Read the Signs365 trade-order PDF for transcribing onto signs365.com",
        ],
        steps: [
          {
            title: "Open the Specialty tab",
            body: "Anything we don't print in-house — vinyl banners, yard signs, vehicle magnets, decals — runs through Signs365. The Specialty tab is the trade-print front end. The price you'll see is YOUR cost from Signs365 plus our markup, plus shipping passed through.",
            field: "tab:specialty",
          },
          {
            title: "Pick Banners → 13oz HD Vinyl Banner",
            body: "Category: Banners. Product: 13oz HD Vinyl Banner. 13oz is the everyday outdoor stock; 18oz is for premium / double-sided. Mesh is for fence wrap.",
            field: "category",
            value: "Banners → 13oz Vinyl",
          },
          {
            title: "Enter dimensions in inches",
            body: "Customer said 3×8 feet. Convert to inches: 36 wide × 96 tall. Quantity 1. The price bar updates instantly — you'll see the per-piece base, the qty-tier, the markup tier, and the shipping line.",
            field: "size",
            value: "36 × 96, qty 1",
          },
          {
            title: "Confirm grommets — they're free on 13oz",
            body: "13oz Vinyl includes grommets at no extra cost (Signs365 default is every 2 ft). Just leave the toggle on. Pole pockets DO cost extra ($1/lin ft + $10 setup) — only add if the customer wants a pole pocket finish.",
            field: "options",
            value: "Grommets on",
          },
          {
            title: "Read the trade-order PDF",
            body: "Click Generate Trade Order PDF. It prints a single-page sheet with every option spelled out, an 'INTERNAL ONLY' cost block, the active tier, and a barcode. Staff use it as the source of truth when transcribing the order onto signs365.com.",
            field: "priceBar",
          },
        ],
        expectedTotal: "$75–$95 customer total (varies with markup)",
        tips: [
          "13oz Vinyl is single-sided. If the customer wants double-sided printing on a vinyl banner, switch to 18oz Vinyl and pick 'Double-sided' — the cost roughly doubles.",
          "Always sanity-check the shipping line. A 36×96 banner is well under 999 sq ft so it ships at the $10 base; the 123\" oversize trigger is for very wide banners only.",
        ],
        pitfalls: [
          "Don't confuse the Customer Total (with markup + shipping) with the Signs365 print cost (your cost, before markup). The PDF labels them clearly.",
          "Don't enter feet — the calculator treats those numbers as inches. 3×8 entered as feet would be a tiny banner.",
        ],
        apply: {
          tab: "specialty",
          specialty: {
            category: "banners",
            product: "13oz-vinyl",
            width: 36, height: 96,
            quantity: 1,
            options: { grommets: true, polePocket: false, welding: false, rope: false, windSlits: false, rush: false },
          },
        },
      },

      {
        id: "sp-yard-signs",
        title: "Political yard signs (25 × 18×24 Coro)",
        difficulty: "intermediate",
        duration: "4 min",
        customerSays: "We need 25 yard signs, 18 by 24, single-sided, with the wire stakes.",
        learningGoals: [
          "Use a perSheet product with preset sizes",
          "See the active quantity tier shift as you scale up",
          "Add per-each step stakes (one per sign)",
          "Understand sheets-needed vs piece-quantity",
        ],
        steps: [
          {
            title: "Open Specialty → Rigid Signs",
            body: "Coroplast yard signs are 'rigid' on Signs365 even though they're flexible. Pick Category: Rigid Signs, Product: Coro 4mm. (10mm is heavy-duty for harsher weather.)",
            field: "category",
            value: "Rigid Signs → Coro 4mm",
          },
          {
            title: "Pick the stock size 18×24",
            body: "Coro is priced PER SHEET, not per piece. The size dropdown shows '18\" × 24\" (8/sheet)' — meaning 8 yard signs cut from one master sheet. Pick that. Sides: Single-sided.",
            field: "size",
            value: "18×24 (8 per sheet) · Single-sided",
          },
          {
            title: "Enter pieces (yard signs), not sheets",
            body: "Type 25 in the quantity field. The calculator derives sheets-needed: 25 ÷ 8 = ceil(3.125) = 4 sheets. The hint under the dimensions confirms it.",
            field: "quantity",
            value: "25",
          },
          {
            title: "Read the active tier",
            body: "4 sheets puts you in the '1–9 sheets' tier at $44/sheet → $176 base. The active-tier hint right below the size shows this. If the customer ordered 90 yard signs (12 sheets), you'd jump to the 10–50 tier at $33/sheet — point that out as upsell motivation.",
            field: "priceBar",
          },
          {
            title: "Add 25 standard wire stakes",
            body: "In Options, set 'Standard wire step stakes' to 25 (one per sign). Stakes are $1.25 each — added once across the order, not per piece. That's $31.25 added to your Signs365 cost.",
            field: "options",
            value: "Stakes: 25",
          },
          {
            title: "Generate the PDF and order",
            body: "The PDF spells out 'Sides: Single-sided', 'Standard wire step stakes: 25 ($1.25 ea)', the tier label, the shipping band, and the customer total. Staff transcribe each option into signs365.com line by line.",
            field: "priceBar",
          },
        ],
        expectedTotal: "$400–$500 customer total",
        tips: [
          "If they ask for double-sided yard signs, just switch the Sides chip — the tier table swaps to the double-sided rates ($55/$44/$40).",
          "Bigger orders cross thresholds: 51+ sheets gets the cheapest tier ($30/sheet for 4mm Single). Quote tiered upsells when you can.",
        ],
        pitfalls: [
          "Don't enter quantity as sheets. If you type '4' thinking '4 sheets', you'll quote them 32 yard signs of base, not 25. Always type the customer's piece count.",
          "Stakes setup-fee scenarios: 'Grommets' on Coro has a $15 setup fee, but stakes don't. Pay attention to the option's footer text.",
        ],
        apply: {
          tab: "specialty",
          specialty: {
            category: "rigidSigns",
            product: "coro-4mm",
            sizeKey: "18x24",
            quantity: 25,
            options: { sides: "single", stakes: 25, stakesHd: 0, grommets: 0, customCut: false, contourCut: false, glossFinish: 0, scoreFold: false, rush: false },
          },
        },
      },

      {
        id: "sp-vehicle-magnet",
        title: "Vehicle door magnet pair",
        difficulty: "beginner",
        duration: "3 min",
        customerSays: "I want two door magnets for my plumbing van — same design on both, 24 by 12.",
        learningGoals: [
          "Use a perPiece product with preset sizes",
          "See per-piece flat pricing (no sq-ft math)",
          "Read shipping that's keyed on magnet count",
        ],
        steps: [
          {
            title: "Open Specialty → Magnets",
            body: "Magnets has two products: Vehicle Magnet (preset sizes, sold per piece) and Custom Magnets (any size, priced per square inch). For van doors you almost always want the Vehicle Magnet preset — Signs365 cuts to the listed sizes.",
            field: "category",
            value: "Magnets → Vehicle Magnet",
          },
          {
            title: "Pick the 24×12 size",
            body: "The size dropdown shows the catalog: 18×12 ($11.95), 24×12 ($14.95), 24×18 ($20.95), 42×12, 72×24. 24×12 is the standard van-door size. Each magnet is priced flat — no sq-ft math.",
            field: "size",
            value: "24\" × 12\" — $14.95",
          },
          {
            title: "Quantity 2 (one per door)",
            body: "Set qty to 2. Print cost = $14.95 × 2 = $29.90. Shipping for magnets is 'per 10 magnets, $10' — 1 to 10 magnets ships at $10 flat.",
            field: "quantity",
            value: "2",
          },
          {
            title: "Read the customer total",
            body: "Print $29.90 → markup tier 'Under $50' (2.5×) → customer print $74.75. Shipping passes through at $10. Customer total ≈ $84.75. The PDF lists 'Vehicle Magnet 24×12 — qty 2' so signs365.com is a copy-paste.",
            field: "priceBar",
          },
        ],
        expectedTotal: "≈ $85 customer total",
        tips: [
          "Customer wants a custom size (e.g. 30×10)? Switch to 'Custom Magnets' — that's per square inch ($0.07/sq in). Door magnets at standard sizes are cheaper, so steer customers to the presets when possible.",
          "Rounded corners on Vehicle Magnets are FREE — toggle on at the customer's request, no upcharge.",
        ],
        pitfalls: [
          "Don't pick the 'Custom magnet' product for a standard size — you'll lose the bulk pricing.",
          "Vehicle magnets ship as a pack. If the customer also orders banners, those ship separately. The PDF shows one shipping line per Specialty job; combined orders need separate sheets.",
        ],
        apply: {
          tab: "specialty",
          specialty: {
            category: "magnets",
            product: "vehicle-magnet",
            sizeKey: "24x12",
            quantity: 2,
            options: { roundedCorners: false, rush: false },
          },
        },
      },

      {
        id: "sp-window-cling-min",
        title: "Tiny window cling — minimum-price floor",
        difficulty: "intermediate",
        duration: "3 min",
        customerSays: "I need 5 small window clings for our front door — about 4 inches square, store hours.",
        learningGoals: [
          "Use a perSqInch product (price per sq inch)",
          "Recognize when the minimum-price floor kicks in",
          "Read the warning callout when a min-price applies",
        ],
        steps: [
          {
            title: "Open Specialty → Adhesive Products",
            body: "Window Cling lives under Adhesive. Pick Category: Adhesive Products, Product: Window Cling.",
            field: "category",
            value: "Adhesive → Window Cling",
          },
          {
            title: "Enter custom dimensions 4×4",
            body: "Window Cling is custom-size. Width 4, height 4. Quantity 5. Per-piece sq-in math: 4×4 = 16 sq in × $0.02 = $0.32 per piece — way under the $2.88 minimum.",
            field: "size",
            value: "4\" × 4\", qty 5",
          },
          {
            title: "See the minimum-price warning",
            body: "Above the price bar a yellow callout reads 'Minimum price of $2.88 per piece applied'. That's because Window Cling has a per-piece floor: even though the math says $0.32, Signs365 charges $2.88 minimum per piece. So your real per-piece base is $2.88 × 5 = $14.40.",
            field: "priceBar",
          },
          {
            title: "Quote the customer",
            body: "Print $14.40 → markup tier 'Under $50' (2.5×) → customer print $36.00. Shipping passes through at the $10 base. Customer total ≈ $46.00. Mention to the customer that there's no extra charge for application instructions on the PDF — just useful info.",
            field: "priceBar",
          },
        ],
        expectedTotal: "≈ $46 customer total",
        tips: [
          "Window Cling has 'Application' (Inside/Outside) and 'Viewable' (Inside/Outside) selectors. They don't change the price but they DO change the file Signs365 needs — confirm with the customer and pick the right combo before downloading the PDF.",
          "If they want bigger clings (say 18×24), the per-sq-in math actually beats the minimum: 432 sq in × $0.02 = $8.64 per piece. The floor only matters for tiny clings.",
        ],
        pitfalls: [
          "Don't quote the un-floored math by mistake. Look for the warning callout — it's there to tell you the floor kicked in.",
          "Window Cling is single-sided. If the customer wants viewable from BOTH sides (true two-way visibility), they want a different product (Dualview or One Way Window) — different category.",
        ],
        apply: {
          tab: "specialty",
          specialty: {
            category: "adhesive",
            product: "window-cling",
            width: 4, height: 4,
            quantity: 5,
            options: { contourCut: false, application: "inside", viewable: "inside" },
          },
        },
      },

      {
        id: "sp-acrylic-plaque",
        title: "Acrylic plaque with stand-offs",
        difficulty: "advanced",
        duration: "5 min",
        customerSays: "I want a 12 by 18 acrylic donor plaque with the silver stand-offs on the corners — four of them.",
        learningGoals: [
          "Use perSqInch with a min-price floor",
          "Add a setupFee option (rounded corners)",
          "Add per-each stand-offs",
          "Recognize how Signs365 ships acrylic in sheet bands",
        ],
        steps: [
          {
            title: "Open Specialty → Rigid Signs → Acrylic",
            body: "Acrylic on Signs365 is priced at $0.10 per square inch with a $14.40 per-piece minimum. It ships as sheets (4608 sq in per sheet, the standard 48×96 stock).",
            field: "category",
            value: "Rigid Signs → Acrylic",
          },
          {
            title: "Enter dimensions 12×18",
            body: "Width 12, height 18. Quantity 1. Per piece: 12×18 = 216 sq in × $0.10 = $21.60. Above the $14.40 minimum, so the floor doesn't kick in here.",
            field: "size",
            value: "12\" × 18\", qty 1",
          },
          {
            title: "Add 4 silver stand-offs",
            body: "Options: 'Stand-off (Silver)' = 4. Each is $2.50, so +$10. They're per-each — added once across the order, not per piece. Black stand-offs are pricier ($3.50/ea); 'Additional' versions are spare hardware customers buy in addition to the corner set.",
            field: "options",
            value: "Stand-off Silver: 4",
          },
          {
            title: "Toggle Rounded corners (setup fee $5)",
            body: "If the customer wants rounded corners (looks classier on a plaque), toggle the option. It's a one-time $5 setup fee — not per piece. The PDF will note 'Rounded corners: Yes (+$5 setup)'.",
            field: "options",
            value: "Rounded corners: Yes",
          },
          {
            title: "Read shipping carefully",
            body: "Acrylic ships per the rigid-sheet bands. 12×18 fits in '24×36 and under', $10 per 3 sheets. 1 sheet → $10 shipping. Larger acrylic (say 24×36) would still fit the same band; 48×48 would jump bands and tiers.",
            field: "priceBar",
          },
        ],
        expectedTotal: "≈ $90 customer total",
        tips: [
          "Stand-offs are sold by Signs365 as accessory hardware. If the customer is going to attach the plaque themselves, they need the stand-offs from this order — point that out.",
          "Acrylic is heavy. Anything 48×96 ships freight ($199). Quote freight openly so the customer doesn't get surprised.",
        ],
        pitfalls: [
          "Don't forget the $5 rounded-corner setup is a one-time fee, not per piece. Customers often think the fee scales with quantity — it doesn't.",
          "Don't confuse Stand-off (initial set, typically 4 per plaque) with Additional Stand-off (spare/extras the customer wants on top). Both are listed because Signs365 lists them that way.",
        ],
        apply: {
          tab: "specialty",
          specialty: {
            category: "rigidSigns",
            product: "acrylic",
            width: 12, height: 18,
            quantity: 1,
            options: { contourCut: false, roundedCorners: true, standOffSilver: 4, standOffBlack: 0, addStandOffSilver: 0, addStandOffBlack: 0 },
          },
        },
      },
    ],
  },
];

// ═══════════════════════════════════════════════════════════════
//  PROGRESS TRACKING (localStorage)
// ═══════════════════════════════════════════════════════════════
const loadProgress = () => {
  try {
    const s = localStorage.getItem(LS_PROGRESS);
    return s ? JSON.parse(s) : {};
  } catch {
    return {};
  }
};

const saveProgress = (p) => {
  try {
    localStorage.setItem(LS_PROGRESS, JSON.stringify(p));
  } catch {}
};

// ═══════════════════════════════════════════════════════════════
//  MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════
export default function TrainingDrawer({ onApplyScenario }) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState("home"); // 'home' | 'category' | 'lesson'
  const [activeCategory, setActiveCategory] = useState(null);
  const [activeScenario, setActiveScenario] = useState(null);
  const [stepIdx, setStepIdx] = useState(0);
  const [progress, setProgress] = useState(loadProgress());

  // Lock body scroll while drawer is open
  useEffect(() => {
    if (open) {
      const orig = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => { document.body.style.overflow = orig; };
    }
  }, [open]);

  // Stats: how many lessons total / how many done
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

  const markComplete = (scenarioId) => {
    const next = { ...progress, [scenarioId]: true };
    setProgress(next);
    saveProgress(next);
  };

  const resetProgress = () => {
    if (!window.confirm("Reset all training progress? This clears your completed-lesson checkmarks.")) return;
    setProgress({});
    saveProgress({});
  };

  const openCategory = (cat) => {
    setActiveCategory(cat);
    setView("category");
  };

  const openScenario = (scen) => {
    setActiveScenario(scen);
    setStepIdx(0);
    setView("lesson");
  };

  const backHome = () => {
    setView("home");
    setActiveCategory(null);
    setActiveScenario(null);
  };

  const backToCategory = () => {
    setView("category");
    setActiveScenario(null);
    setStepIdx(0);
  };

  const handleTryItNow = () => {
    if (!activeScenario) return;
    markComplete(activeScenario.id);
    if (typeof onApplyScenario === "function") {
      onApplyScenario(activeScenario.apply);
    }
    setOpen(false);
    backHome();
  };

  const handleMarkDone = () => {
    if (!activeScenario) return;
    markComplete(activeScenario.id);
    backToCategory();
  };

  const difficultyBadge = (d) => {
    const colors = {
      beginner:     { bg: "var(--green-light)", color: "var(--green)" },
      intermediate: { bg: "var(--amber-light)", color: "var(--amber)" },
      advanced:     { bg: "#fee2e2",            color: "#dc2626" },
    };
    const c = colors[d] || colors.beginner;
    return (
      <span style={{
        background: c.bg, color: c.color,
        padding: "2px 8px", borderRadius: 6,
        fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.4,
      }}>{d}</span>
    );
  };

  // ─── RENDER ───────────────────────────────────────────────
  return (
    <>
      {/* Floating Learn button */}
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

      {/* Drawer */}
      {open && (
        <>
          <div className="training-backdrop" onClick={() => setOpen(false)} />
          <aside className="training-drawer" role="dialog" aria-label="Training">
            {/* Drawer header */}
            <div className="training-header">
              <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 0 }}>
                {view !== "home" && (
                  <button
                    className="training-back"
                    onClick={view === "lesson" ? backToCategory : backHome}
                    aria-label="Back"
                  >
                    <Icons.ChevronLeft />
                  </button>
                )}
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="training-header-title">
                    {view === "home" && "Training Center"}
                    {view === "category" && activeCategory?.label}
                    {view === "lesson" && activeScenario?.title}
                  </div>
                  <div className="training-header-sub">
                    {view === "home" && `${stats.done} of ${stats.total} lessons complete`}
                    {view === "category" && activeCategory?.description}
                    {view === "lesson" && `Step ${stepIdx + 1} of ${activeScenario?.steps.length}`}
                  </div>
                </div>
              </div>
              <button
                className="training-close"
                onClick={() => setOpen(false)}
                aria-label="Close"
              >
                <Icons.Close />
              </button>
            </div>

            {/* Drawer body — scrollable */}
            <div className="training-body">

              {/* ─── HOME VIEW ─── */}
              {view === "home" && (
                <>
                  {/* Progress bar */}
                  <div className="training-progress-block">
                    <div className="training-progress-row">
                      <div className="training-progress-label">Your progress</div>
                      <div className="training-progress-pct">{stats.pct}%</div>
                    </div>
                    <div className="training-progress-track">
                      <div
                        className="training-progress-fill"
                        style={{ width: `${stats.pct}%` }}
                      />
                    </div>
                    {stats.done > 0 && (
                      <button className="training-reset-btn" onClick={resetProgress}>
                        <Icons.Reset /> Reset progress
                      </button>
                    )}
                  </div>

                  {/* Welcome message — only first time */}
                  {stats.done === 0 && (
                    <div className="training-welcome">
                      <div className="training-welcome-icon">👋</div>
                      <div className="training-welcome-title">Welcome!</div>
                      <div className="training-welcome-body">
                        These lessons walk you through real walk-in scenarios so you'll quote prices fast and confidently. Pick a category below and click a lesson to start. Each one ends with a "Try it now" button that prefills the calculator.
                      </div>
                    </div>
                  )}

                  {/* Categories */}
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

              {/* ─── CATEGORY VIEW ─── */}
              {view === "category" && activeCategory && (
                <div className="training-scen-list">
                  {activeCategory.scenarios.map((scen, i) => (
                    <button
                      key={scen.id}
                      className={`training-scen-card ${progress[scen.id] ? "done" : ""}`}
                      onClick={() => openScenario(scen)}
                    >
                      <div className="training-scen-num" style={{ background: activeCategory.bg, color: activeCategory.color }}>
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

              {/* ─── LESSON VIEW ─── */}
              {view === "lesson" && activeScenario && (
                <LessonView
                  scenario={activeScenario}
                  category={activeCategory}
                  stepIdx={stepIdx}
                  setStepIdx={setStepIdx}
                  difficultyBadge={difficultyBadge}
                  onTryItNow={handleTryItNow}
                  onMarkDone={handleMarkDone}
                />
              )}
            </div>
          </aside>
        </>
      )}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════
//  LESSON VIEW (the step-by-step walkthrough)
// ═══════════════════════════════════════════════════════════════
function LessonView({ scenario, category, stepIdx, setStepIdx, difficultyBadge, onTryItNow, onMarkDone }) {
  const totalSteps = scenario.steps.length;
  const isFirst = stepIdx === 0;
  const isLast = stepIdx === totalSteps - 1;
  const step = scenario.steps[stepIdx];

  // intro pseudo-step shown before step 0 — but we fold it into the body of step 0 instead
  const showIntro = stepIdx === 0;

  return (
    <div className="lesson-view">

      {/* Step indicator dots */}
      <div className="lesson-dots">
        {scenario.steps.map((_, i) => (
          <button
            key={i}
            className={`lesson-dot ${i === stepIdx ? "active" : ""} ${i < stepIdx ? "done" : ""}`}
            onClick={() => setStepIdx(i)}
            style={{ "--cat-color": category.color }}
            aria-label={`Step ${i + 1}`}
          />
        ))}
      </div>

      {/* Intro card — only on step 0 */}
      {showIntro && (
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
              {scenario.learningGoals.map((g, i) => (
                <li key={i}>{g}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* The actual step */}
      <div className="lesson-step">
        <div className="lesson-step-header">
          <div className="lesson-step-num" style={{ background: category.bg, color: category.color }}>
            {stepIdx + 1}
          </div>
          <div className="lesson-step-title">{step.title}</div>
        </div>

        <div className="lesson-step-body">{step.body}</div>

        {step.value && (
          <div className="lesson-step-value">
            <span className="lesson-step-value-label">Set this:</span>
            <code className="lesson-step-value-code">{step.value}</code>
          </div>
        )}

        {step.field && (
          <div className="lesson-step-field" style={{ "--cat-color": category.color }}>
            <span className="lesson-step-field-icon">→</span>
            <span className="lesson-step-field-label">
              Field: <code>{step.field}</code>
            </span>
          </div>
        )}
      </div>

      {/* Tips, pitfalls, and expected total — only on last step */}
      {isLast && (
        <>
          {scenario.expectedTotal && (
            <div className="lesson-callout lesson-callout-money">
              <div className="lesson-callout-icon"><Icons.Money /></div>
              <div>
                <div className="lesson-callout-title">Expected total</div>
                <div className="lesson-callout-body">{scenario.expectedTotal}</div>
              </div>
            </div>
          )}

          {scenario.tips?.length > 0 && (
            <div className="lesson-callout lesson-callout-tip">
              <div className="lesson-callout-icon"><Icons.Lightbulb /></div>
              <div>
                <div className="lesson-callout-title">Tips & confidence builders</div>
                <ul className="lesson-callout-list">
                  {scenario.tips.map((t, i) => <li key={i}>{t}</li>)}
                </ul>
              </div>
            </div>
          )}

          {scenario.pitfalls?.length > 0 && (
            <div className="lesson-callout lesson-callout-warn">
              <div className="lesson-callout-icon"><Icons.Warn /></div>
              <div>
                <div className="lesson-callout-title">Common mistakes to avoid</div>
                <ul className="lesson-callout-list">
                  {scenario.pitfalls.map((p, i) => <li key={i}>{p}</li>)}
                </ul>
              </div>
            </div>
          )}
        </>
      )}

      {/* Footer — nav buttons */}
      <div className="lesson-footer">
        <button
          className="pc-btn pc-btn-secondary pc-btn-sm"
          onClick={() => setStepIdx(i => Math.max(0, i - 1))}
          disabled={isFirst}
        >
          <Icons.ChevronLeft /> Previous
        </button>

        {!isLast && (
          <button
            className="pc-btn pc-btn-primary pc-btn-sm"
            onClick={() => setStepIdx(i => Math.min(totalSteps - 1, i + 1))}
            style={{ background: category.color, borderColor: category.color }}
          >
            Next <Icons.ChevronRight />
          </button>
        )}

        {isLast && scenario.apply && (
          <button
            className="pc-btn pc-btn-primary pc-btn-sm lesson-try-btn"
            onClick={onTryItNow}
            style={{ background: category.color, borderColor: category.color }}
          >
            <Icons.Play /> Try it now
          </button>
        )}

        {isLast && !scenario.apply && (
          <button
            className="pc-btn pc-btn-success pc-btn-sm"
            onClick={onMarkDone}
          >
            <Icons.Check /> Mark complete
          </button>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
//  EXPORT — also expose categories for any external use
// ═══════════════════════════════════════════════════════════════
export { CATEGORIES };
