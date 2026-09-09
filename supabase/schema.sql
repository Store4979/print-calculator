-- ============================================================
--  Employees + order history — reference schema
--  Tables: employees, orders (formerly transactions; incentive columns
--  removed in Phase D1: 20260908180945 renamed + compat view,
--  20260909164923 dropped the view, the columns and commission_settings)
--
--  This is an in-store tool on trusted devices. RLS is ON, but the
--  policies allow read/write for the anon key so the existing
--  publishable key works without per-user auth. Revisit if the
--  threat model changes (public deploy, untrusted devices, etc.).
-- ============================================================

-- ── employees ─────────────────────────────────────────────
create table if not exists public.employees (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  pin         text not null,
  active      boolean not null default true,
  -- Phase E (20260909224658): a manager PIN sees margin at the counter.
  -- Only a store owner may change it — trigger employees_role_owner_only.
  role        text not null default 'staff'
              constraint employees_role_check check (role in ('staff','manager')),
  created_at  timestamptz not null default now(),
  -- Stored as plaintext on purpose — these are 4-digit station PINs
  -- for internal use, not security credentials. The check enforces
  -- the format; the unique constraint prevents PIN collisions.
  constraint employees_pin_4digit check (pin ~ '^\d{4}$'),
  constraint employees_pin_unique unique (pin)
);

create index if not exists employees_active_idx on public.employees (active);

-- verify_employee_pin(p_store_id uuid, p_pin text)
--   returns table(id uuid, name text, active boolean, role text)
--   SECURITY DEFINER, search_path=public. EXECUTE: postgres, service_role,
--   anon, authenticated (explicitly revoked + re-granted; see CLAUDE.md rule 4).
--   Called by src/lib/supabase.js findEmployeeByPin. Phase S1 moves it server-side.
-- employees_role_owner_only(): BEFORE INSERT OR UPDATE OF role trigger. Rejects
--   a role assignment (42501) unless has_store_role(store_id, {owner}); postgres
--   and service_role pass. Not security definer on purpose.

-- ── orders ─────────────────────────────────────────────────
-- One row per saved order. employee_id/employee_name record WHO RANG IT —
-- denormalized so the record survives a future employee deletion or
-- rename. line_items keeps the full detail of what was ordered. The
-- Phase B tenant keys (org_id, store_id) are stamped on insert.
create table if not exists public.orders (
  id                  uuid primary key default gen_random_uuid(),
  employee_id         uuid not null references public.employees(id),
  employee_name       text not null,
  total               numeric(10,2) not null,
  base_subtotal       numeric(10,2) not null,   -- shown as "Subtotal" in the UI
  line_items          jsonb not null,
  service_type        text not null,
  notes               text,
  created_at          timestamptz not null default now(),
  org_id              uuid references public.organizations(id) on delete cascade,
  store_id            uuid references public.stores(id) on delete cascade
);

create index if not exists orders_employee_idx   on public.orders (employee_id);
create index if not exists orders_created_at_idx on public.orders (created_at desc);
create index if not exists idx_orders_store      on public.orders (store_id);

-- ── _archive_commission_columns (transitional, keep) ───────
-- Written by D1-b (20260909164923) immediately before the four incentive
-- columns were dropped: one row per order that existed at that moment.
-- It is the ONLY source for the values the D1-b rollback restores.
-- RLS on, no policies: invisible to anon/authenticated, readable via
-- service role / SQL editor. Do not drop until the owner says so.
create table if not exists public._archive_commission_columns (
  order_id           uuid,
  upsell_subtotal    numeric(10,2),
  base_commission    numeric(10,2),
  upsell_commission  numeric(10,2),
  total_commission   numeric(10,2),
  archived_at        timestamptz
);
alter table public._archive_commission_columns enable row level security;

-- ── RLS ────────────────────────────────────────────────────
alter table public.employees           enable row level security;
alter table public.orders              enable row level security;

drop policy if exists "anon_rw_employees" on public.employees;
create policy "anon_rw_employees"
  on public.employees
  for all
  to anon, authenticated
  using (true)
  with check (true);

drop policy if exists "anon_rw_orders" on public.orders;
create policy "anon_rw_orders"
  on public.orders
  for all
  to anon, authenticated
  using (true)
  with check (true);

-- ============================================================
--  Customer self-serve uploads — pending_jobs + storage
--  Files live in the PRIVATE 'customer-uploads' bucket; this row holds
--  only metadata + storage paths. Anon may SELECT (the in-store staff
--  queue subscribes with the publishable key); INSERT/UPDATE/DELETE go
--  through service-role Netlify functions only, so the public key can't
--  write or tamper. Files are gated behind signed URLs minted
--  server-side, so a leaked path is not file access. Same trusted-staff
--  / public-anon model as the order tables above.
-- ============================================================

create table if not exists public.pending_jobs (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  customer_name text not null,
  job_date      text not null,                       -- 'YYYY-MM-DD' in America/Detroit
  queue_number  int  not null,                       -- per-day position shown to customer/staff
  files         jsonb not null default '[]'::jsonb,  -- [{ name, path, type, page_count }]
  notes         text,
  source        text not null default 'upload'       -- 'upload' | 'link'
);

create index if not exists pending_jobs_created_at_idx on public.pending_jobs (created_at);
create index if not exists pending_jobs_job_date_idx    on public.pending_jobs (job_date);

alter table public.pending_jobs enable row level security;
alter table public.pending_jobs replica identity full;  -- full old row on realtime DELETE events

-- Anon: read-only (staff queue + realtime). NO anon write policy on purpose —
-- only the service role (Netlify functions) mutates this table.
drop policy if exists "anon_select_pending_jobs" on public.pending_jobs;
create policy "anon_select_pending_jobs"
  on public.pending_jobs
  for select
  to anon, authenticated
  using (true);

-- Make the table emit realtime events.
alter publication supabase_realtime add table public.pending_jobs;

-- Private bucket for customer files. No storage.objects policies needed:
-- the service role bypasses RLS, and clients up/download via signed URLs/tokens.
insert into storage.buckets (id, name, public)
values ('customer-uploads', 'customer-uploads', false)
on conflict (id) do nothing;
