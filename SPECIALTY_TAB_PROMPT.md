# Add Specialty/Trade Print Tab for Signs365 Integration

## Context
This is a React 18 + Vite 5 + Tailwind 3.4 print calculator app for The UPS Store #4979 (Saginaw, MI). The app currently has Sheets & Photos / Large Format / Blueprints / Impose tabs. I'm adding a new **Specialty** tab that mirrors Signs365 trade printer pricing across 7 product categories, applies tiered markup, and generates a PDF order sheet that staff use to manually place orders on signs365.com.

## Repo & Deployment
- Repo: github.com/Store4979/print-calculator
- Live: printcalculator2.netlify.app
- Admin password: store4979
- Updates made via GitHub web interface (provide full replacement files for new files, exact before/after blocks for App.jsx edits)

## Architectural Constraints (CRITICAL — these have caused build failures before)
1. **State vs. external constants:** Functions defined outside the React component cannot reference component state. Keep `signs365Pricing.json` data as imported constants; keep state-dependent logic inside the component.
2. **No duplicate `useState` declarations** — they cause silent build failures on Netlify. Check existing state before adding new state.
3. **Tailwind specificity:** Custom CSS in index.css needs ultra-specific selectors or targeted `!important` to override Tailwind utilities.
4. **jsPDF is loaded via CDN in index.html** — don't re-import. Access as `window.jspdf.jsPDF`.
5. **Use the existing SKU pattern** for keying: `category:product:size:material` matching the existing `paperKey:sheetKey` convention.
6. **Existing barcode128.js** is already wired up — reuse it for the Trade Print Order Sheet.

## Phase 1: Pricing Data File

Create `src/data/signs365Pricing.json` covering all 7 categories: vinyl banners, yard signs, rigid signs, decals, magnets, posters, foam board/gatorboard.

**Important:** All `baseCost*` values in the JSON below are **PLACEHOLDERS based on typical Signs365 pricing**. The owner will verify and update these against current Signs365 pricing in the admin panel before going live. Add this comment at the top of the file:

```json
{
  "_comment": "PLACEHOLDER PRICING — verify against current Signs365 pricing before going live. Last updated: 2026-04-29",
  ...
}
```

```json
{
  "_comment": "PLACEHOLDER PRICING — verify against current Signs365 pricing. Last updated: 2026-04-29",
  "categories": {
    "banners": {
      "label": "Vinyl Banners",
      "description": "Hemmed and grommeted, indoor/outdoor",
      "products": {
        "13oz-scrim": {
          "label": "13oz Scrim Vinyl",
          "pricingModel": "perSqFt",
          "baseCostPerSqFt": 1.25,
          "minSqFt": 6,
          "sizes": "custom",
          "options": {
            "hemming": { "label": "Hemming", "type": "checkbox", "default": true, "cost": 0 },
            "grommets": {
              "label": "Grommets",
              "type": "select",
              "choices": [
                { "value": "every-2ft", "label": "Every 2ft (standard)", "cost": 0 },
                { "value": "corners-only", "label": "Corners only", "cost": 0 },
                { "value": "none", "label": "No grommets", "cost": 0 }
              ]
            },
            "polePocket": {
              "label": "Pole pocket",
              "type": "select",
              "choices": [
                { "value": "none", "label": "None", "cost": 0 },
                { "value": "top-3in", "label": "Top 3\"", "costPerLinearFt": 1.50 },
                { "value": "top-bottom-3in", "label": "Top & bottom 3\"", "costPerLinearFt": 3.00 }
              ]
            },
            "doubleSided": { "label": "Double-sided print", "type": "checkbox", "default": false, "costMultiplier": 1.75 }
          }
        },
        "18oz-blockout": {
          "label": "18oz Blockout (double-sided)",
          "pricingModel": "perSqFt",
          "baseCostPerSqFt": 2.95,
          "minSqFt": 6,
          "sizes": "custom",
          "options": {
            "hemming": { "label": "Hemming", "type": "checkbox", "default": true, "cost": 0 },
            "grommets": {
              "label": "Grommets",
              "type": "select",
              "choices": [
                { "value": "every-2ft", "label": "Every 2ft (standard)", "cost": 0 },
                { "value": "none", "label": "No grommets", "cost": 0 }
              ]
            }
          }
        },
        "mesh": {
          "label": "Mesh Banner (fence wrap)",
          "pricingModel": "perSqFt",
          "baseCostPerSqFt": 2.25,
          "minSqFt": 6,
          "sizes": "custom",
          "options": {
            "hemming": { "label": "Hemming", "type": "checkbox", "default": true, "cost": 0 },
            "grommets": {
              "label": "Grommets",
              "type": "select",
              "choices": [
                { "value": "every-2ft", "label": "Every 2ft (standard)", "cost": 0 },
                { "value": "none", "label": "No grommets", "cost": 0 }
              ]
            }
          }
        }
      }
    },

    "yardSigns": {
      "label": "Yard Signs (Coroplast)",
      "description": "Corrugated plastic, single or double-sided",
      "products": {
        "coroplast-4mm": {
          "label": "4mm Coroplast",
          "pricingModel": "perPiece",
          "sizes": [
            { "key": "12x18", "label": "12\" x 18\"", "baseCost": 6.00 },
            { "key": "18x24", "label": "18\" x 24\"", "baseCost": 9.00 },
            { "key": "24x18", "label": "24\" x 18\"", "baseCost": 10.00 },
            { "key": "24x36", "label": "24\" x 36\"", "baseCost": 16.00 },
            { "key": "36x24", "label": "36\" x 24\"", "baseCost": 16.00 },
            { "key": "48x24", "label": "48\" x 24\"", "baseCost": 22.00 },
            { "key": "48x36", "label": "48\" x 36\"", "baseCost": 30.00 }
          ],
          "options": {
            "sides": {
              "label": "Sides",
              "type": "select",
              "choices": [
                { "value": "single", "label": "Single-sided", "costMultiplier": 1.0 },
                { "value": "double", "label": "Double-sided", "costMultiplier": 1.5 }
              ]
            },
            "hStakes": { "label": "H-stakes (per each)", "type": "perEachAddon", "costPerEach": 1.50 }
          }
        },
        "coroplast-10mm": {
          "label": "10mm Coroplast (heavy duty)",
          "pricingModel": "perPiece",
          "sizes": [
            { "key": "18x24", "label": "18\" x 24\"", "baseCost": 14.00 },
            { "key": "24x36", "label": "24\" x 36\"", "baseCost": 24.00 },
            { "key": "48x24", "label": "48\" x 24\"", "baseCost": 32.00 }
          ],
          "options": {
            "sides": {
              "label": "Sides",
              "type": "select",
              "choices": [
                { "value": "single", "label": "Single-sided", "costMultiplier": 1.0 },
                { "value": "double", "label": "Double-sided", "costMultiplier": 1.5 }
              ]
            }
          }
        }
      }
    },

    "rigidSigns": {
      "label": "Rigid Signs (ACM / PVC)",
      "description": "Aluminum composite or PVC for durable signage",
      "products": {
        "acm-3mm": {
          "label": "3mm ACM (Dibond)",
          "pricingModel": "perSqFt",
          "baseCostPerSqFt": 5.50,
          "minSqFt": 4,
          "sizes": "custom",
          "options": {
            "sides": {
              "label": "Sides",
              "type": "select",
              "choices": [
                { "value": "single", "label": "Single-sided", "costMultiplier": 1.0 },
                { "value": "double", "label": "Double-sided", "costMultiplier": 1.5 }
              ]
            },
            "drillHoles": { "label": "Drill holes (per each)", "type": "perEachAddon", "costPerEach": 0.50 }
          }
        },
        "pvc-3mm": {
          "label": "3mm PVC (Sintra)",
          "pricingModel": "perSqFt",
          "baseCostPerSqFt": 4.25,
          "minSqFt": 4,
          "sizes": "custom",
          "options": {
            "sides": {
              "label": "Sides",
              "type": "select",
              "choices": [
                { "value": "single", "label": "Single-sided", "costMultiplier": 1.0 },
                { "value": "double", "label": "Double-sided", "costMultiplier": 1.5 }
              ]
            }
          }
        },
        "pvc-6mm": {
          "label": "6mm PVC (Sintra)",
          "pricingModel": "perSqFt",
          "baseCostPerSqFt": 6.50,
          "minSqFt": 4,
          "sizes": "custom",
          "options": {
            "sides": {
              "label": "Sides",
              "type": "select",
              "choices": [
                { "value": "single", "label": "Single-sided", "costMultiplier": 1.0 },
                { "value": "double", "label": "Double-sided", "costMultiplier": 1.5 }
              ]
            }
          }
        }
      }
    },

    "decals": {
      "label": "Decals & Vinyl Lettering",
      "description": "Cut or printed vinyl, indoor/outdoor",
      "products": {
        "printed-vinyl-contour": {
          "label": "Printed Vinyl Decal (contour cut)",
          "pricingModel": "perSqFt",
          "baseCostPerSqFt": 4.00,
          "minSqFt": 1,
          "sizes": "custom",
          "options": {
            "lamination": {
              "label": "Lamination",
              "type": "select",
              "choices": [
                { "value": "none", "label": "None", "costPerSqFt": 0 },
                { "value": "gloss", "label": "Gloss laminate", "costPerSqFt": 0.75 },
                { "value": "matte", "label": "Matte laminate", "costPerSqFt": 0.75 }
              ]
            }
          }
        },
        "printed-vinyl-kisscut": {
          "label": "Printed Vinyl Decal (kiss cut sheet)",
          "pricingModel": "perSqFt",
          "baseCostPerSqFt": 3.50,
          "minSqFt": 1,
          "sizes": "custom",
          "options": {
            "lamination": {
              "label": "Lamination",
              "type": "select",
              "choices": [
                { "value": "none", "label": "None", "costPerSqFt": 0 },
                { "value": "gloss", "label": "Gloss laminate", "costPerSqFt": 0.75 },
                { "value": "matte", "label": "Matte laminate", "costPerSqFt": 0.75 }
              ]
            }
          }
        },
        "cut-vinyl-lettering": {
          "label": "Cut Vinyl Lettering (single color)",
          "pricingModel": "perSqFt",
          "baseCostPerSqFt": 3.00,
          "minSqFt": 1,
          "sizes": "custom",
          "options": {
            "color": {
              "label": "Color",
              "type": "select",
              "choices": [
                { "value": "black", "label": "Black", "cost": 0 },
                { "value": "white", "label": "White", "cost": 0 },
                { "value": "red", "label": "Red", "cost": 0 },
                { "value": "blue", "label": "Blue", "cost": 0 },
                { "value": "other", "label": "Other (specify in notes)", "cost": 0 }
              ]
            }
          }
        }
      }
    },

    "magnets": {
      "label": "Magnetic Signs",
      "description": "Vehicle door magnets, 30mil",
      "products": {
        "car-magnet-30mil": {
          "label": "30mil Vehicle Magnet",
          "pricingModel": "perPiece",
          "sizes": [
            { "key": "12x18", "label": "12\" x 18\"", "baseCost": 14.00 },
            { "key": "18x24", "label": "18\" x 24\"", "baseCost": 22.00 },
            { "key": "24x12", "label": "24\" x 12\"", "baseCost": 16.00 },
            { "key": "24x18", "label": "24\" x 18\"", "baseCost": 22.00 },
            { "key": "custom", "label": "Custom size", "baseCost": null, "perSqFtCost": 6.00 }
          ],
          "options": {}
        }
      }
    },

    "posters": {
      "label": "Posters",
      "description": "Large format paper posters, indoor use",
      "products": {
        "poster-paper-gloss": {
          "label": "Gloss Poster Paper",
          "pricingModel": "perSqFt",
          "baseCostPerSqFt": 2.00,
          "minSqFt": 2,
          "sizes": "custom",
          "options": {
            "lamination": {
              "label": "Lamination",
              "type": "select",
              "choices": [
                { "value": "none", "label": "None", "costPerSqFt": 0 },
                { "value": "gloss", "label": "Gloss laminate", "costPerSqFt": 1.00 },
                { "value": "matte", "label": "Matte laminate", "costPerSqFt": 1.00 }
              ]
            }
          }
        },
        "poster-paper-matte": {
          "label": "Matte Poster Paper",
          "pricingModel": "perSqFt",
          "baseCostPerSqFt": 2.00,
          "minSqFt": 2,
          "sizes": "custom",
          "options": {
            "lamination": {
              "label": "Lamination",
              "type": "select",
              "choices": [
                { "value": "none", "label": "None", "costPerSqFt": 0 },
                { "value": "gloss", "label": "Gloss laminate", "costPerSqFt": 1.00 },
                { "value": "matte", "label": "Matte laminate", "costPerSqFt": 1.00 }
              ]
            }
          }
        }
      }
    },

    "foamBoard": {
      "label": "Foam Board / Gatorboard",
      "description": "Lightweight rigid display boards",
      "products": {
        "foam-board-3-16": {
          "label": "3/16\" Foam Board",
          "pricingModel": "perSqFt",
          "baseCostPerSqFt": 4.50,
          "minSqFt": 4,
          "sizes": "custom",
          "options": {
            "lamination": {
              "label": "Lamination",
              "type": "select",
              "choices": [
                { "value": "none", "label": "None", "costPerSqFt": 0 },
                { "value": "gloss", "label": "Gloss laminate", "costPerSqFt": 1.00 },
                { "value": "matte", "label": "Matte laminate", "costPerSqFt": 1.00 }
              ]
            }
          }
        },
        "foam-board-1-2": {
          "label": "1/2\" Foam Board",
          "pricingModel": "perSqFt",
          "baseCostPerSqFt": 5.50,
          "minSqFt": 4,
          "sizes": "custom",
          "options": {
            "lamination": {
              "label": "Lamination",
              "type": "select",
              "choices": [
                { "value": "none", "label": "None", "costPerSqFt": 0 },
                { "value": "gloss", "label": "Gloss laminate", "costPerSqFt": 1.00 },
                { "value": "matte", "label": "Matte laminate", "costPerSqFt": 1.00 }
              ]
            }
          }
        },
        "gatorboard-3-16": {
          "label": "3/16\" Gatorboard (rigid)",
          "pricingModel": "perSqFt",
          "baseCostPerSqFt": 6.50,
          "minSqFt": 4,
          "sizes": "custom",
          "options": {
            "lamination": {
              "label": "Lamination",
              "type": "select",
              "choices": [
                { "value": "none", "label": "None", "costPerSqFt": 0 },
                { "value": "gloss", "label": "Gloss laminate", "costPerSqFt": 1.00 },
                { "value": "matte", "label": "Matte laminate", "costPerSqFt": 1.00 }
              ]
            }
          }
        },
        "gatorboard-1-2": {
          "label": "1/2\" Gatorboard (rigid)",
          "pricingModel": "perSqFt",
          "baseCostPerSqFt": 7.50,
          "minSqFt": 4,
          "sizes": "custom",
          "options": {
            "lamination": {
              "label": "Lamination",
              "type": "select",
              "choices": [
                { "value": "none", "label": "None", "costPerSqFt": 0 },
                { "value": "gloss", "label": "Gloss laminate", "costPerSqFt": 1.00 },
                { "value": "matte", "label": "Matte laminate", "costPerSqFt": 1.00 }
              ]
            }
          }
        }
      }
    }
  },

  "markup": {
    "type": "tiered",
    "tiers": [
      { "maxCost": 50, "multiplier": 2.5, "label": "Under $50" },
      { "maxCost": 200, "multiplier": 2.0, "label": "$50–$200" },
      { "maxCost": null, "multiplier": 1.75, "label": "Over $200" }
    ]
  },

  "quantityDiscounts": [
    { "minQty": 1, "maxQty": 4, "discount": 0, "label": "1–4" },
    { "minQty": 5, "maxQty": 9, "discount": 0.05, "label": "5–9 (5% off)" },
    { "minQty": 10, "maxQty": 24, "discount": 0.10, "label": "10–24 (10% off)" },
    { "minQty": 25, "maxQty": null, "discount": 0.15, "label": "25+ (15% off)" }
  ]
}
```

## Phase 2: Add the Specialty Tab to App.jsx

1. **Locate the existing tab navigation** (the row with Sheets & Photos / Large Format / Blueprints / Impose).
2. **Add a new "Specialty" tab** matching existing tab styling and active-state pattern. Place it after "Blueprints" and before "Impose" (or wherever fits the existing order — match the pattern, don't fight it).
3. **Reuse the existing `activeTab` state** — add `'specialty'` as a valid value, do NOT create a new state variable.
4. **Conditionally render `<SpecialtyTab />`** when `activeTab === 'specialty'`, mirroring the existing tab render pattern.
5. **Pass any shared props** the existing tabs use (customer info, order number, etc.) so the Trade Order PDF can populate them.

## Phase 3: Create SpecialtyTab Component

Create `src/components/SpecialtyTab.jsx`:

**Structure:**
- Import `signs365Pricing` from `../data/signs365Pricing.json` at the top of the file (outside the component)
- Import any shared utilities (barcode, jsPDF helpers) from existing locations
- All pricing math lives **inside** the component (so it can read state and admin overrides from localStorage)

**Component state:**
```jsx
const [selectedCategory, setSelectedCategory] = useState('');
const [selectedProduct, setSelectedProduct] = useState('');
const [width, setWidth] = useState('');
const [height, setHeight] = useState('');
const [selectedSizeKey, setSelectedSizeKey] = useState('');
const [quantity, setQuantity] = useState(1);
const [selectedOptions, setSelectedOptions] = useState({});
```

**UI flow:**
1. **Category dropdown** — populated from `signs365Pricing.categories`. Show category label and description.
2. **Product dropdown** — populated from selected category's `products`. Show product label.
3. **Size inputs** — render based on `pricingModel`:
   - `"perSqFt"` → width and height inputs in inches, with a live "X sq ft (min Y sq ft)" indicator
   - `"perPiece"` → size dropdown from the product's `sizes` array; if a "custom" size exists with `perSqFtCost`, show width/height inputs when selected
4. **Quantity input** — numeric, min 1
5. **Options section** — dynamically render based on the product's `options` object:
   - `type: "checkbox"` → toggle
   - `type: "select"` → dropdown with choices
   - `type: "perEachAddon"` → numeric input (e.g., "How many H-stakes?")
6. **Live price display** — integrates with the existing sticky price bar
7. **Action buttons:** "Generate Trade Order PDF" and "Reset"

**Pricing function (inside component):**
```jsx
function calculatePrice() {
  // 1. Get product config
  // 2. Calculate base cost:
  //    - perSqFt: max(width × height / 144, minSqFt) × baseCostPerSqFt × quantity
  //    - perPiece: size.baseCost × quantity (or perSqFtCost path for custom)
  // 3. Apply option costs/multipliers (sides multiplier, lamination $/sqft, pole pocket per linear ft, per-each addons)
  // 4. Apply quantity discount tier from signs365Pricing.quantityDiscounts
  // 5. Apply markup tier from signs365Pricing.markup.tiers (based on post-discount cost)
  // 6. Return { baseCost, postDiscountCost, customerPrice, margin, appliedTier, appliedDiscount }
}
```

**Validation:**
- Disable "Generate PDF" button until category, product, valid size, and quantity ≥ 1 are set
- Show inline warnings for sub-minimum sizes (display "Minimum 6 sq ft applied" rather than blocking)

## Phase 4: Trade Print Order Sheet PDF

Create `src/utils/tradeOrderPDF.js` exporting `generateTradeOrderPDF(orderData)`.

**PDF spec (single page, portrait, letter size):**
- **Header:** UPS Store #4979 logo (preserve aspect ratio — this was a previous fix), store address, "Trade Print Order — Signs365"
- **Order metadata:** Order # with Code 128B barcode (use existing `barcode128.js`), date, staff initials field
- **Customer info section:** name, phone, email (pulled from existing customer info state if available)
- **Job specs section** (the main block — must be easy to transcribe to signs365.com):
  - Category & Product (e.g., "Vinyl Banners → 13oz Scrim Vinyl")
  - Dimensions (formatted clearly: `36" × 96"` or selected preset size)
  - Quantity
  - **All selected options spelled out**, one per line: "Hemming: Yes", "Grommets: Every 2ft", "Pole pocket: Top 3\"", "Double-sided: No", etc.
- **Internal cost tracking** (clearly labeled "INTERNAL ONLY — DO NOT GIVE TO CUSTOMER"):
  - Signs365 base cost
  - Quantity discount applied
  - Markup tier applied
  - Customer price
  - Margin (dollars and percentage)
- **Notes section:** blank lined area for handwritten staff notes
- **Footer:** "Order placed on signs365.com by ______ on ______"

Match the visual style of the existing print order sheet (same header treatment, same barcode placement, same fonts).

## Phase 5: Admin Panel Integration

In the existing admin panel (password: store4979), add a new collapsible section **"Signs365 Pricing"** below the existing pricing sections.

**Editable fields:**
- For each category → product: base cost (perSqFt or perPiece), and option costs
- Markup tiers: edit `maxCost` and `multiplier` for each tier
- Quantity discount tiers: edit `minQty`, `maxQty`, `discount`

**Persistence:**
- Save overrides to localStorage under key `signs365Pricing` (separate from existing pricing key — do not collide)
- On app load, deep-merge saved overrides on top of JSON defaults
- "Reset to defaults" button clears localStorage overrides for this section only

**Export/Import:**
- Include `signs365Pricing` overrides in the existing `pricing.json` export
- Handle missing key gracefully on import (older exports won't have it)

## Phase 6: Acceptance Criteria

- [ ] "Specialty" tab appears in tab nav with consistent styling, no regressions to existing tabs
- [ ] All 7 categories selectable; product list updates per category
- [ ] perSqFt products correctly compute area (with min sq ft floor)
- [ ] perPiece products correctly use size baseCost
- [ ] All option types render correctly (checkbox, select, perEachAddon)
- [ ] Live price updates instantly on any input change
- [ ] Quantity discounts apply at correct thresholds (5, 10, 25)
- [ ] Markup tiers apply at correct cost thresholds ($50, $200)
- [ ] "Generate Trade Order PDF" produces a single-page sheet with barcode, all specs, and internal cost section
- [ ] PDF is easy for staff to use as a transcription source for signs365.com
- [ ] Admin panel allows editing all Signs365 pricing fields
- [ ] Admin export includes Signs365 overrides
- [ ] Build succeeds on Netlify (Node 20, MISE_DISABLE=1, no duplicate useState)
- [ ] No regressions in Sheets & Photos, Large Format, Blueprints, Impose

## Deliverables Format

Provide:
1. **Full replacement files** for new files:
   - `src/data/signs365Pricing.json`
   - `src/components/SpecialtyTab.jsx`
   - `src/utils/tradeOrderPDF.js`
2. **Exact before/after code blocks** with file paths and clear placement instructions for:
   - `src/App.jsx` (tab nav + render switch + any shared prop wiring)
   - The existing admin panel component (new Signs365 Pricing section + export/import handling)
3. **A short test checklist** at the end so I can verify each phase before pushing to GitHub.

## After Build
List any TODOs the owner must complete before going live, especially:
- Verifying placeholder Signs365 base costs against current Signs365 pricing
- Confirming any product variations Signs365 offers that aren't in the JSON yet
- Testing the full flow end-to-end with a real test order
