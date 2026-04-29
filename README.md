# Print Calculator

Internal pricing, ordering, and commission-tracking app for **The UPS Store #4979** (Saginaw, MI).

- **Live:** https://printcalculator2.netlify.app
- **Stack:** React 18 + Vite 5 + plain CSS, deployed to Netlify
- **Build:** `yarn install && yarn build` (Node 20, pinned via `.nvmrc`)
- **Backend:** Supabase (Postgres + RLS) for completed-sale persistence and the commission system

## Features

- **Sheets & Photos** — multi-job ticket with grouped volume discounts.
- **Large Format** — stretched-to-size preview, grommets / foam-core add-ons.
- **Blueprints** — preset sizes with tiered psf pricing.
- **Impose** — booklet imposition + data-merge variable printing.
- **Quick Quote** — compare prices across paper types and sheet sizes.
- **Admin panel** — pricing controls, paper-type management, upsell flags, commission settings, employee management, and reports.
- **Commission tracking** — PIN sign-in, "Complete Sale" flow with per-line upsell claims, offline-queued transactions, and a personal "My Numbers" view.

## Local development

```sh
nvm use            # Node 20 from .nvmrc
yarn install
yarn dev           # vite dev server on :5173
yarn build         # production build into dist/
yarn preview       # serve dist/ on :4173
```

`jsPDF` and `PDF.js` are loaded from CDN in `index.html` (not npm packages). Don't try to import them — use `window.jspdf.jsPDF` and `window.pdfjsLib`.

## Supabase setup

The app expects a Supabase project with two schema slices:

1. **Print job history** — `print_jobs` table (used by Job History and the Save-Job dialog).
2. **Commission tracking** — `employees`, `transactions`, `commission_settings` tables (used by the PIN login, Complete Sale flow, and Commission Dashboard).

### Apply the schema

The commission schema lives in [`supabase/schema.sql`](supabase/schema.sql). Run it once in the SQL Editor of your Supabase project. It is idempotent (everything is `if not exists` / `on conflict do nothing`) so reruns are safe.

The print_jobs schema was applied via an earlier migration; if you're starting fresh, run:

```sql
create table if not exists public.print_jobs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  job_type text not null,
  paper_type text, paper_key text, sheet_size text, sku text,
  print_size text, orientation text, color_mode text,
  quantity integer, sheets_needed integer, sides text,
  per_sheet_price numeric(12,4),
  discount_percent numeric(6,3),
  total_price numeric(12,2),
  file_names text[],
  customer_name text, customer_email text, customer_phone text,
  notes text,
  addons jsonb, job_details jsonb
);
alter table public.print_jobs enable row level security;
create policy "anon_rw" on public.print_jobs for all to anon, authenticated using (true) with check (true);
```

### Environment variables

The client reads these at build time (Vite):

| Variable | Where | Notes |
|----------|-------|-------|
| `VITE_SUPABASE_URL` | Netlify build env + `.env` for local dev | e.g. `https://xxxx.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | Netlify build env + `.env` for local dev | Use the **publishable** anon key (`sb_publishable_...`). RLS on every table protects real data; this key is safe to ship in the bundle. |

For Netlify, set both in the dashboard or in `[build.environment]` in `netlify.toml`. For local dev, create a `.env` file with the same two vars (gitignore it if it ever holds anything sensitive — for a publishable key it's fine).

### RLS policy stance

All commission tables enable RLS but allow the anon role full read/write. The app is gated client-side by:

- **Admin password** (`store4979`) for the Admin panel.
- **Per-employee 4-digit PIN** for completing sales.
- **Job-history password** for viewing the print-job log.

This is appropriate for an in-store tool on trusted devices. If the deployment surface ever changes (public URL, untrusted devices), tighten the policies and move the gates server-side.

## Project layout

```
src/
  App.jsx                       Main app, all calculator tabs, admin panel
  main.jsx                      ReactDOM root
  index.css                     All styling (CSS custom properties)
  barcode128.js                 Code 128B barcode for order sheets
  BookletMaker.jsx              Saddle-stitch booklet imposition
  DataMerge.jsx                 Variable data printing
  JobHistory.jsx                Print-job log viewer (uses Supabase)
  components/
    EmployeeLogin.jsx           PIN keypad
    CommissionDashboard.jsx     Admin reports / employees / settings
    MyNumbersPanel.jsx          Read-only employee summary
  lib/
    supabase.js                 Supabase client + helpers
    commissions.js              Commission math + offline queue

supabase/
  schema.sql                    Commission schema (run once per project)

netlify/
  functions/
    send-print-job.js           Email serverless function
```

## Commission system at a glance

- **Recognition rule:** whoever rings up the completed sale gets full credit. No splits.
- **Quote vs. sale:** "Generate Quote" produces a PDF without touching the database. "Complete Sale" inserts a row into `transactions` with the commission already split into base / upsell.
- **Hybrid model:**
  - 2% on the base subtotal (default; admin-editable).
  - 8% on the upsell subtotal (default; admin-editable).
  - $50 monthly bonus per employee whose monthly sales clear the threshold (defaults: $5,000 / $50, both admin-editable).
- **Upsell claim:** items the admin flags as upsell-eligible (specific papers, grommets, foam-core, …) show an "⬆ Upsell" toggle on the calculator. The toggle defaults OFF — staff opts in only when they actively suggested the upgrade. The toggle's state determines whether that line item lands in the base subtotal or the upsell subtotal.
- **Offline queue:** if Supabase can't be reached at sale time, the row is stored under `localStorage.pendingTransactions`. The queue drains on app mount, after every successful insert, and whenever the browser fires `online`. A pending count is surfaced in the header so you can manually retry.

## Useful URLs

- Calculator: https://printcalculator2.netlify.app
- Branch preview (current iteration): see Netlify deploys on the `claude/fix-pdf-print-quality-fHXAB` branch
