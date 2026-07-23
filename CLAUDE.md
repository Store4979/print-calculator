# CLAUDE.md — Print Calculator (The UPS Store #4979)

## What this is
Print quoting/estimating web app used daily at the counter of The UPS Store #4979
(4352 Bay Road, Saginaw MI). Users: store staff + walk-in customers.
Owner: Ryan. Live at https://printcalculator2.netlify.app

## Stack
- React 18 + Vite 5 + Tailwind CSS 3.4 (but components use custom CSS classes /
  inline styles, NOT Tailwind utilities — all styling lives in src/index.css
  with CSS custom properties / design tokens like --sp-*, --fs-*, --touch-target)
- Supabase: Postgres + Storage + Realtime (commission tracking, job history,
  customer upload queue). Project ref: gmxyisjjaxtpycsmmzef
- Netlify: hosting + serverless functions (netlify/functions/) + a scheduled
  function (cleanup-stale-jobs)
- jsPDF 2.5.1 and PDF.js 3.11.174 are **CDN globals** loaded in index.html
  (window.jspdf / window.pdfjsLib) — NEVER import them as npm modules
- Node 22 (pinned via .nvmrc and netlify.toml NODE_VERSION); MISE_DISABLE=1 in
  netlify.toml. @supabase/supabase-js is pinned EXACTLY (no ^) because there is
  no committed lockfile — a floating range once re-resolved to a version that
  required a newer Node and broke the deploy.
- **yarn only.** package-lock.json is gitignored. Build: `yarn install && yarn build`
- PWA bits: public/sw.js + manifest.webmanifest (no-cache headers in netlify.toml)

## Key files
- src/App.jsx — the monolith (~5,200 lines): all tabs (paper/large/blueprint/
  booklet/data-merge/queue), admin panel, pricing math, PDF generation, email
  ordering, employee login/commission plumbing, shared PriceBar + Collapsible +
  product tiles
- src/components/SpecialtyTab.jsx — Signs365 outsourced products (tiered markup:
  2.5x <$50, 2x $50–200, 1.75x >$200). Live pricing data: src/data/
  signs365Pricing.json (editable via src/components/Signs365PricingEditor.jsx).
  Source docs in repo root use SPACES in names: "Banner Products.md",
  "Rigid Products.md", "Adhesive Products.md", Magnet.md, Handheld.md
- src/BookletMaker.jsx — saddle-stitch imposition (Ricoh signature math)
- src/DataMerge.jsx — variable data printing, text-frame model
- src/JobHistory.jsx — saved job viewer (Supabase-backed)
- src/TrainingDrawer.jsx — staff training scenarios (drives applyScenario via
  CustomEvents like specialtyApplyScenario / trainingSpotlight)
- src/UploadApp.jsx + upload.html — customer self-serve upload page at /upload
  (separate Vite entry via src/upload-main.jsx)
- src/components/PrintQueue.jsx — staff queue tab for customer uploads (QR modal
  is portaled to document.body — see gotchas)
- src/components/EmployeeLogin.jsx, CommissionDashboard.jsx, MyNumbersPanel.jsx —
  employee PIN login + commission views
- src/lib/supabase.js — client init, findEmployeeByPin, job-file storage helpers
- src/lib/commissions.js — commission math
- src/barcode128.js — Code 128B generator drawn on order PDFs via jsPDF rects
- src/utils/tradeOrderPDF.js — Signs365 trade-order PDF
- netlify/functions/ — send-print-job.js (email) + six customer-upload-queue
  functions (start-upload, register-job, fetch-link-job, get-download-url,
  complete-job, cleanup-stale-jobs)
- supabase/schema.sql — reference schema for the Supabase project
- public/pricing.json — deployed pricing config (admin panel exports/imports this)

## Integration anchors in App.jsx (verify before relying on; update this file if they drift)
- PriceBar component ~line 672
- buildSaleSnapshot() ~line 2863
- requestCompleteSale() ~line 3113
- applyScenario() useCallback ~line 3232
- CompleteSaleDialog ~line 4993

## Hardware the app models
- Ricoh Pro C5400s: sheets up to 13×19.2", auto-duplex, saddle-stitch, ~4mm margins
- HP DesignJet T2600dr: 36" wide roll-fed large format

## Passwords / secrets conventions
- Admin panel password: store4979 (client-side, intentional)
- Job history DB password: store4979! (client-side gate, intentional)
- SUPABASE_SERVICE_ROLE_KEY: server-side ONLY, set in Netlify env vars,
  **never** with a VITE_ prefix, never in client code. Functions also read
  SUPABASE_URL (unprefixed) with VITE_SUPABASE_URL as fallback.
- VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY: client-safe publishable values.
  They are committed on purpose in BOTH netlify.toml and the tracked .env
  (RLS gates real access), so `yarn dev` talks to Supabase with zero setup.
  Personal overrides go in .env.local (gitignored; Vite loads it over .env).

## Hard-won gotchas (do not relearn these the expensive way)
- Duplicate useState declarations = silent Netlify build failure. Scan before finishing.
- Functions at module scope cannot reference component state.
- createClient at module scope in a Netlify function crashes with 502 if the env
  var is missing — create the client inside the handler after guard checks, and
  .trim() env values (stray whitespace in the Netlify dashboard broke init once).
- The /upload redirect in netlify.toml must come BEFORE the catch-all SPA redirect.
- Tailwind specificity conflicts need ultra-specific selectors or targeted !important.
- Netlify env var changes do NOT apply to running deploys — manual redeploy required.
- netlify.toml [functions] included_files=["package.json"] is load-bearing: it
  changes each function bundle's digest so runtime upgrades actually re-deploy them.
- applyScenario only sets fields present in a config — tile presets must explicitly
  reset fields like backEnabled, grommetQty, perSheetCap or they leak between jobs.
- Anything position:fixed inside a .pc-card breaks on hover — the card's
  :hover transform becomes its containing block and overflow clips it. Portal
  modals to document.body (see PrintQueue QR modal).
- GitHub squash-merge means local feature branches diverge from main after every
  merge — rebase onto origin/main (or reset a fresh branch) before new work.
- BookletMaker/DataMerge/SpecialtyTab receive shared components (PriceBar,
  CardHeader, PriceDelta) as props from App.jsx — don't re-import or fork them.

## Workflow rules for Claude Code sessions
1. **Plan first.** For any non-trivial task, present a short plan and wait for
   approval before writing code.
2. **Don't commit or push** unless explicitly asked. Leave the working tree dirty;
   Ryan reviews, then commits/pushes (push to main = Netlify auto-deploy).
3. After changes, verify with `yarn build` (and `yarn dev` for anything visual).
4. Never touch pricing math or the Supabase schema unless the task explicitly
   calls for it.
5. Prompt files from prior work (SPECIALTY_TAB_PROMPT.md,
   SIGNS365_PRICING_UPDATE.md, etc.) may exist in the repo root — they are
   historical specs, not standing instructions.
6. Keep this CLAUDE.md current: when you learn a new gotcha or an anchor moves,
   update it as part of the task.
