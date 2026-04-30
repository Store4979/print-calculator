# Replace Specialty Tab Pricing with Real Signs365 Catalog

## Context
The Specialty tab is already built and working in the print calculator (React 18 + Vite 5 + Tailwind 3.4). I now have the **real, complete Signs365 pricing data** in 5 markdown files in the repo root. This prompt replaces the placeholder pricing with the actual catalog and adds shipping cost calculation.

## Source Files (all in repo root)
- `Banner_Products.md` — vinyl banners, HDPE, canvas, mesh, posters, nocurl, banner stands
- `Rigid_Products.md` — Coro, Acrylic, Foamcore, PVC, Polystyrene, Aluminum, Backlite, JBond
- `Adhesive_Products.md` — 3M IJ-35C, 3M Controltac, Window Cling, GF 203OAPAE, GF830, Orajet, One Way Window, Dualview, Footprints, BootPrints, LowTac Wall, Dry Erase, Reflective
- `Magnet.md` — Vehicle magnets, Custom magnets
- `Handheld.md` — Paper, Hard Card

**Read all 5 files at the start.** Don't paraphrase — extract every product, every tier, every option, every shipping rule exactly as written.

## Repo & Constraints
- Repo: github.com/Store4979/print-calculator
- Updates via GitHub web interface — provide full replacement files for new files, exact before/after blocks for edits
- React 18, Vite 5, Tailwind 3.4
- jsPDF via CDN in index.html
- Admin password: store4979
- **No duplicate `useState` declarations** (causes Netlify build failures)
- **External constants stay outside the component**, state-dependent logic stays inside
- **Tailwind specificity:** custom CSS needs ultra-specific selectors

## Phase 1: Schema Redesign

The existing `signs365Pricing.json` schema is too simple for real Signs365 data. Replace it with a richer schema that handles all three pricing models, product-specific tier breaks, setup fees, and shipping.

### New schema (`src/data/signs365Pricing.json`)

```json
{
  "_comment": "Real Signs365 pricing extracted from MD files. Last updated: 2026-04-29",
  "_version": "2.0",

  "categories": {
    "<categoryKey>": {
      "label": "Display name",
      "description": "Brief description",
      "products": {
        "<productKey>": {
          "label": "Product display name",
          "pricingModel": "perSqFt | perSheet | perSqInch",
          "tiers": [
            { "minQty": 1, "maxQty": 9, "cost": 44.00, "label": "1-9" },
            { "minQty": 10, "maxQty": 50, "cost": 33.00, "label": "10-50" },
            { "minQty": 51, "maxQty": null, "cost": 30.00, "label": "51+" }
          ],
          "minPrice": 14.40,
          "sizes": [
            { "key": "12x18", "label": "12\" x 18\"", "perSheet": 20 }
          ],
          "sizeMode": "preset | custom | both",
          "options": [
            {
              "key": "sides",
              "label": "Sides",
              "type": "tierVariant",
              "variantField": true,
              "choices": [
                { "value": "single", "label": "Single-sided", "tierKey": "single" },
                { "value": "double", "label": "Double-sided", "tierKey": "double" }
              ]
            },
            {
              "key": "polePocket",
              "label": "Pole pocket",
              "type": "perLinearFt",
              "costPerLinearFt": 1.00,
              "setupFee": 10.00,
              "default": "off"
            },
            {
              "key": "grommets",
              "label": "Grommets",
              "type": "perEach",
              "costPerEach": 0.25,
              "setupFee": 15.00
            },
            {
              "key": "stakes",
              "label": "Step stakes",
              "type": "perEachAddon",
              "costPerEach": 1.25
            },
            {
              "key": "rush",
              "label": "Rush (100% upcharge)",
              "type": "percentMultiplier",
              "multiplier": 2.00
            },
            {
              "key": "contourCut",
              "label": "Contour cutting (+10%)",
              "type": "percentMultiplier",
              "multiplier": 1.10
            },
            {
              "key": "lamination",
              "label": "Lamination",
              "type": "select",
              "choices": [
                { "value": "none", "label": "None", "costPerSqFt": 0 },
                { "value": "gloss", "label": "Gloss laminate", "costPerSqFt": 1.24 },
                { "value": "matte", "label": "Matte laminate", "costPerSqFt": 0 }
              ]
            }
          ],
          "shippingRules": "rigid_sheet | banner | adhesive | magnet_sheet | magnet_each | handheld | acrylic_sheet"
        }
      }
    }
  },

  "shippingRules": {
    "banner": {
      "description": "Banner products by sq ft and size",
      "tiers": [
        { "maxSqFt": 999, "cost": 10.00 },
        { "maxSqFt": null, "cost": 199.00, "label": "Freight" }
      ],
      "freightTriggers": [
        { "if": "anyDimensionGte", "value": 123, "cost": 199.00 }
      ]
    },
    "adhesive": {
      "tiers": [
        { "maxSqFt": 999, "cost": 10.00 },
        { "maxSqFt": null, "cost": 199.00, "label": "Freight" }
      ]
    },
    "rigid_sheet": {
      "description": "Tiered by sheet count and finished size band",
      "sizeBands": [
        {
          "name": "24x36 and under",
          "maxWidth": 24, "maxHeight": 36,
          "tiers": [
            { "perSheets": 3, "cost": 10.00 },
            { "minSheets": 58, "cost": 199.00, "label": "Freight" }
          ]
        },
        {
          "name": "24x36 to 32x48",
          "minWidth": 24, "maxWidth": 32, "maxHeight": 48,
          "tiers": [
            { "perSheets": 3, "cost": 15.00 },
            { "minSheets": 22, "cost": 199.00, "label": "Freight" }
          ]
        },
        {
          "name": "36x36 to 36x48",
          "minWidth": 36, "maxWidth": 36, "maxHeight": 48,
          "tiers": [
            { "perSheets": 3, "cost": 35.00 },
            { "minSheets": 22, "cost": 199.00, "label": "Freight" }
          ]
        },
        {
          "name": "36x48 to 48x48",
          "minWidth": 36, "maxWidth": 48, "maxHeight": 48,
          "tiers": [
            { "maxSheets": 5, "cost": 50.00 },
            { "minSheets": 6, "maxSheets": 9, "cost": 75.00 },
            { "minSheets": 10, "cost": 199.00, "label": "Freight" }
          ]
        },
        {
          "name": "39x72 and 24x96",
          "tiers": [
            { "maxSheets": 9, "cost": 75.00 },
            { "minSheets": 10, "cost": 199.00, "label": "Freight" }
          ]
        },
        {
          "name": "48x96",
          "tiers": [
            { "minSheets": 1, "cost": 199.00, "label": "Freight" }
          ]
        }
      ]
    },
    "acrylic_sheet": {
      "_note": "Same band logic as rigid_sheet but with acrylic-specific tier counts (10+ instead of 22+/58+ on smaller bands)",
      "sizeBands": [
        {
          "name": "24x36 and under",
          "maxWidth": 24, "maxHeight": 36,
          "tiers": [
            { "perSheets": 3, "cost": 10.00 },
            { "minSheets": 10, "cost": 199.00, "label": "Freight" }
          ]
        }
      ]
    },
    "magnet_each": {
      "description": "Vehicle magnets",
      "tiers": [
        { "perItems": 10, "cost": 10.00 },
        { "minItems": 191, "cost": 199.00, "label": "Freight" }
      ]
    },
    "magnet_sheet": {
      "description": "Custom magnets by square inch (1 sheet = 4,608 sq in)",
      "tiers": [
        { "perSqIn": 2025, "cost": 10.00 },
        { "minSqIn": 40500, "cost": 199.00, "label": "Freight" }
      ]
    },
    "handheld": {
      "description": "Paper",
      "tiers": [
        { "perSheets": 100, "cost": 10.00 }
      ]
    },
    "hardcard": {
      "description": "Hard card sets",
      "tiers": [
        { "perItems": 10, "cost": 10.00 }
      ]
    }
  },

  "markup": {
    "type": "tiered",
    "tiers": [
      { "maxCost": 50, "multiplier": 2.5, "label": "Under $50" },
      { "maxCost": 200, "multiplier": 2.0, "label": "$50–$200" },
      { "maxCost": null, "multiplier": 1.75, "label": "Over $200" }
    ]
  }
}
```

### Schema rules

- **Tiers are quantity-based per product.** Read the `1-9 / 10-50 / 51+` style tables in the MD files exactly. Some products have 2 tiers, some 3, some 4 (Mesh has 4: 1-999, 1000-2499, 2500-4999, 5000+). Don't normalize — preserve each product's actual tier structure.
- **`pricingModel` matches the unit of cost in the MD file:**
  - "$X per sheet" → `perSheet`
  - "$X per square foot" → `perSqFt`
  - "$X per square inch" → `perSqInch`
- **Sided variants are tier variants, not separate products.** Coro 4mm Single-Sided and 4mm Double-Sided are the same product with a `sides` option. Use the `tierVariant` option type so each variant has its own tier table.
- **Setup fees are one-time per order**, not per unit. Pole pocket $10 setup, Grommets $15 setup on Coro, Rounded Corners $5 setup on Acrylic/Aluminum.
- **`minPrice`** field captures the "minimum price of $X" notes (Window Cling $2.88, Acrylic $14.40, etc.).
- **Per-each add-ons** (stakes, grommets per each, stand-offs, drill holes, H-stakes, additional stand-offs) take a quantity input.
- **Rush is a global option** on most products — 100% additional. Implement once, reuse via reference.
- **Contour cutting** is +10% on the print cost (multiplier 1.10) — appears on many products.

### Categories to create (with all products from the MD files)

1. **Banners** — 13oz Vinyl, 15oz Vinyl, 18oz Vinyl Single, 18oz Vinyl Double, HDPE, Canvas, Mesh, Poster, NoCurl, Econo Banner Stand
2. **Rigid Signs** — Coro 4mm S/D, Coro 10mm S/D, Acrylic, Foamcore S/D, PVC 3mm S/D, PVC 6mm S/D, Polystyrene S/D, Aluminum .040 S/D, Aluminum .080 S/D, Backlite, JBond 3mm S/D, JBond 6mm S/D
3. **Adhesive Products** — 3M IJ-35C, 3M Controltac, Window Cling, GF 203OAPAE, GF830 AutoMark, Orajet Clear, One Way Window (50/50, 70/30), DualView S/D, Footprints, BootPrints, LowTac Wall, Dry Erase, Reflective
4. **Magnets** — Vehicle Magnet (preset sizes), Custom Magnet (per sq in)
5. **Handheld** — Paper (multiple preset sizes), Hard Card .025/.04 S/D

### Shared size lists

Coro, Foamcore, PVC, and Polystyrene share the same long size list (about 70 sizes). **Define this list once** as a constant in the JSON (e.g., `_sharedSizes.rigidSheets`) and reference it from each product's `sizes` field, OR include it inline if reuse via JSON reference is awkward — your call, but don't duplicate 70 entries 4 times by hand.

## Phase 2: Update Pricing Engine

Update the pricing function in `src/components/SpecialtyTab.jsx` to handle the new schema:

1. **Resolve active tier** based on product, current quantity, and any `tierVariant` option (e.g., sides). Use the product's own `tiers` array, not a global one.
2. **Calculate base print cost** based on `pricingModel`:
   - `perSqFt`: width × height / 144 × tier.cost × quantity
   - `perSheet`: tier.cost × quantity
   - `perSqInch`: width × height × tier.cost × quantity
3. **Apply minimum price floor** (`minPrice`) per piece if defined.
4. **Apply option costs in this order:**
   - Per-sq-ft additions (e.g., gloss lamination $1.24/sqft on One Way Window)
   - Per-linear-ft additions (pole pocket, rope, webbing) + setup fee once
   - Per-each additions (grommets, stakes, drill holes, stand-offs) + setup fee once
   - Percent multipliers (rush 2.0x, contour cut 1.10x) — applied last, multiplicatively
5. **Calculate shipping** by looking up the product's `shippingRules` key and applying the matching rule:
   - For rigid sheets: determine size band from product width/height, then apply the band's tier table to the sheet count
   - For banners/adhesives: total sq ft thresholds, plus oversize freight trigger
   - For magnets and handheld: per-N-units tiers
6. **Markup** applies to the **print cost only** (not shipping). Shipping is passed through at cost.
7. **Return:**
```js
   {
     printCost,           // signs365 cost before markup
     shippingCost,        // signs365 shipping cost
     totalCost,           // print + shipping
     customerPrintPrice,  // print cost × markup
     customerTotal,       // customerPrintPrice + shippingCost
     margin,
     marginPct,
     appliedTier,
     appliedMarkupTier,
     warnings: []         // e.g., "Minimum price applied", "Freight shipping required"
   }
```

## Phase 3: Update UI

The existing UI structure is fine but needs new fields:

1. **Add a sided-variant selector** when product has `tierVariant` options (renders before the tier display so users see the right pricing).
2. **Show active quantity tier** in the UI ("You're on the 10-50 tier — order 51+ to save more").
3. **Add a "Custom size" toggle** for products supporting both preset and custom sizes.
4. **Display shipping cost as a separate line** in the price breakdown:
```
   Print cost (Signs365):  $X
   Shipping (Signs365):    $Y
   Setup fees:             $Z
   --
   Your cost (total):      $X+Y+Z
   Markup tier (2.0x):     applied to print only
   --
   Customer print price:   $A
   Customer shipping:      $Y (passthrough)
   --
   Customer total:         $A+Y
   Margin:                 $A - $X = $M (Mpct%)
```
5. **Show warnings** ("Freight shipping triggered — verify with Signs365") when oversize/freight rules hit.
6. **Setup fees collapse** — show "Pole pocket setup ($10 one-time)" so it's clear that's a per-order, not per-unit charge.

## Phase 4: Update Trade Order PDF

The existing `tradeOrderPDF.js` needs to include the new shipping/setup line items:

- Add a "Shipping" line in the cost breakdown
- Add a "Setup fees" line if any apply
- Show the active quantity tier and markup tier
- Add a "Freight required" warning callout if applicable
- For products with sided variants, spell out the side selection clearly ("Sides: Single-sided" or "Sides: Double-sided")
- For per-each addons, show count clearly ("Grommets: 8 ($0.25 each + $15 setup)")

## Phase 5: Admin Panel Updates

The admin panel section "Signs365 Pricing" needs to handle the richer schema:

1. Allow editing each product's tier costs (every row in the tier table)
2. Allow editing setup fees per option
3. Allow editing shipping rule costs (the rigid sheet bands, banner thresholds, etc.)
4. Allow editing min prices
5. Keep markup tiers and the existing localStorage `signs365Pricing` override key (overwrite with new schema; old overrides will be discarded — that's fine since the catalog is changing fundamentally)
6. Update export/import to include the v2 schema

## Phase 6: Acceptance Criteria

- [ ] All products from all 5 MD files appear in their correct categories
- [ ] Tier breaks match the source files exactly (1-9, 10-50, 51+ for Coro; 1-9, 10-17, 18+ for PVC; etc.)
- [ ] Per-sq-ft, per-sheet, and per-sq-inch products all calculate correctly
- [ ] Min price floors apply (Window Cling $2.88, Acrylic $14.40, Aluminum minimums, JBond minimums)
- [ ] Setup fees apply once per order, not per unit
- [ ] Rush adds 100%, Contour cut adds 10%, both correctly multiplicative
- [ ] Per-each addons (stakes, grommets, stand-offs, drill holes) calculate per-quantity + setup
- [ ] Shipping calculates correctly for each rule type and triggers freight at correct thresholds
- [ ] Oversize products (123x123+, 48x96, etc.) trigger freight automatically
- [ ] Markup applies to print cost only; shipping passes through at cost
- [ ] PDF shows full breakdown with tier and shipping info
- [ ] Admin panel can edit all new fields
- [ ] Build succeeds on Netlify, no regressions in other tabs

## Deliverables

1. **Full replacement file:** `src/data/signs365Pricing.json` with every product, tier, option, and shipping rule from the 5 MD files. **Read the MD files directly — do not paraphrase.**
2. **Full replacement file:** `src/components/SpecialtyTab.jsx` with the updated pricing engine and UI.
3. **Full replacement file:** `src/utils/tradeOrderPDF.js` with the updated PDF layout.
4. **Exact before/after blocks** for the admin panel changes.
5. **A migration note** at the top of your response listing anything in the source MDs that was ambiguous and how you resolved it (e.g., "Mesh on banners has grommets listed but no per-each cost — assumed $0 like 13oz Vinyl").

## Process Note

After reading the 5 MD files, **before writing any code, post a brief structured summary of what you extracted**: how many products per category, total option types found, total shipping rules, any ambiguities. I'll confirm before you generate the full files.
