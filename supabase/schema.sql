-- ============================================================
--  Employees + order history — reference schema
--  Tables: employees, orders (formerly transactions; incentive columns
--  removed in Phase D1, see supabase/migrations/20260908*)
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
  created_at  timestamptz not null default now(),
  -- Stored as plaintext on purpose — these are 4-digit station PINs
  -- for internal use, not security credentials. The check enforces
  -- the format; the unique constraint prevents PIN collisions.
  constraint employees_pin_4digit check (pin ~ '^\d{4}$'),
  constraint employees_pin_unique unique (pin)
);

create index if not exists employees_active_idx on public.employees (active);

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
