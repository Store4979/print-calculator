-- record_public_table_grants
--
-- PARKED (Ryan, 2026-10-20). A DRAFT, applied nowhere: not on production, not
-- on staging. It is kept here, outside supabase/migrations/, so no migration
-- discovery or record check sees it. It waits until stage 0 is complete, then
-- goes to Codex review with the record-side changes listed in
-- docs/security/release-2-stage-0-production-plan.md section I.
--
-- Why. From 2026-10-30 Supabase gives a NEW table in public no automatic Data
-- API grants: the platform default privileges that today hand every new table
-- to anon, authenticated and service_role stop applying, including when
-- migrations rebuild a database (db reset, preview branches, new projects,
-- staging rebuilds). Existing live tables keep their grants. Every table here
-- got its grants from that default, except the six Release 2 tables, whose
-- migration grants service_role explicitly. So a database rebuilt from
-- supabase/migrations/ after that date would leave the app's roles with no
-- access. This migration states the table grants explicitly, for every table
-- in public that exists today, so a rebuild gets them without the default.
--
-- What it does. Only GRANTs, never a REVOKE. Each grant below is a privilege
-- the role already holds on production (read 2026-10-20, ad-hoc, read-only).
-- So applying it on production changes no grant; the before/after comparison
-- of every grant on public tables is the evidence for that, recorded with the
-- apply.
--
--   service_role   exactly what production gives it: the full table privilege
--                  set on all 20 tables (the Netlify functions use it).
--   authenticated  exactly what production gives it: the full set on the 14
--                  application tables, none on the six Release 2 tables.
--   anon           ONLY what the signed-out app uses today, and that the RLS
--                  policies admit for anon. Production's anon also holds
--                  UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER and MAINTAIN
--                  (and SELECT/INSERT where no policy admits anon) from the old
--                  default. Those are NOT granted here, so in a REBUILT
--                  database anon holds less than it does on production today.
--                  Production keeps them until Release 2 closes the grants.
--   postgres       owns every table; an owner needs no grant.
--
-- RLS is not changed here: every table already has it enabled by its own
-- migration.

-- service_role: all 20 tables.
grant select, insert, update, delete, truncate, references, trigger, maintain on table
  public._archive_commission_columns, public.addons, public.discounts, public.employees,
  public.memberships, public.orders, public.organizations, public.outsourced_products,
  public.paper_types, public.pending_jobs, public.print_jobs, public.settings,
  public.sheet_prices, public.stores,
  public.auth_attempts, public.device_enrollments, public.enrollment_tickets,
  public.staff_sessions, public.upload_capabilities, public.upload_capability_files
  to service_role;

-- authenticated: the 14 application tables (the signed-in owner/manager admin).
grant select, insert, update, delete, truncate, references, trigger, maintain on table
  public._archive_commission_columns, public.addons, public.discounts, public.employees,
  public.memberships, public.orders, public.organizations, public.outsourced_products,
  public.paper_types, public.pending_jobs, public.print_jobs, public.settings,
  public.sheet_prices, public.stores
  to authenticated;

-- anon: the signed-out app.
--   price book and store profile (storeConfig.js, supabase.js), the *_read policies
grant select on table
  public.stores, public.paper_types, public.sheet_prices, public.discounts,
  public.addons, public.settings
  to anon;
--   staff queue list and realtime (App.jsx, PrintQueue.jsx), anon_select_pending_jobs
grant select on table public.pending_jobs to anon;
--   order save and history (supabase.js), anon_rw_orders;
--   job history save and list (supabase.js), the two print_jobs anon policies.
--   SELECT also serves insert(...).select("id, created_at").
grant select, insert on table public.orders, public.print_jobs to anon;
