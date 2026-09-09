-- Phase B, migration 1 of N — PURELY ADDITIVE.
-- Creates the organizations tenant root and adds nullable tenant-key
-- columns everywhere. No NOT NULL, no RLS changes to existing tables,
-- nothing dropped: the running store4979 app cannot observe this.

create table if not exists public.organizations (
  id                     uuid primary key default gen_random_uuid(),
  name                   text not null,
  slug                   text not null unique,
  plan                   text not null default 'trial',
  status                 text not null default 'active',
  trial_ends_at          timestamptz,
  -- Phase C (billing) fills these; nullable now by design.
  stripe_customer_id     text,
  stripe_subscription_id text,
  current_period_end     timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

-- stores: tenant parent + per-store bootstrap secret (hash only, never plaintext)
alter table public.stores      add column if not exists org_id uuid references public.organizations(id) on delete restrict;
alter table public.stores      add column if not exists bootstrap_secret_hash text;

-- memberships move to org-level tenancy (store_id stays for store-scoped roles)
alter table public.memberships add column if not exists org_id uuid references public.organizations(id) on delete cascade;

-- Operational tables gain both keys, nullable until backfilled.
alter table public.employees            add column if not exists org_id   uuid references public.organizations(id) on delete cascade;
alter table public.employees            add column if not exists store_id uuid references public.stores(id)        on delete cascade;
alter table public.transactions         add column if not exists org_id   uuid references public.organizations(id) on delete cascade;
alter table public.transactions         add column if not exists store_id uuid references public.stores(id)        on delete cascade;
alter table public.commission_settings  add column if not exists org_id   uuid references public.organizations(id) on delete cascade;
alter table public.commission_settings  add column if not exists store_id uuid references public.stores(id)        on delete cascade;
alter table public.print_jobs           add column if not exists org_id   uuid references public.organizations(id) on delete cascade;
alter table public.print_jobs           add column if not exists store_id uuid references public.stores(id)        on delete cascade;
alter table public.pending_jobs         add column if not exists org_id   uuid references public.organizations(id) on delete cascade;
alter table public.pending_jobs         add column if not exists store_id uuid references public.stores(id)        on delete cascade;

-- New table: RLS on from birth. Deny-by-default for anon; org members may
-- read their own org. Created AFTER memberships.org_id exists, since the
-- policy expression is parsed at creation time.
alter table public.organizations enable row level security;

drop policy if exists organizations_read on public.organizations;
create policy organizations_read on public.organizations
  for select to authenticated
  using (exists (
    select 1 from public.memberships m
    where m.org_id = organizations.id and m.user_id = auth.uid()
  ));

-- Tenant-key indexes: every future RLS policy filters on these.
create index if not exists idx_stores_org              on public.stores(org_id);
create index if not exists idx_memberships_org         on public.memberships(org_id);
create index if not exists idx_memberships_user        on public.memberships(user_id);
create index if not exists idx_employees_store         on public.employees(store_id);
create index if not exists idx_transactions_store      on public.transactions(store_id);
create index if not exists idx_commission_settings_org on public.commission_settings(org_id);
create index if not exists idx_print_jobs_store        on public.print_jobs(store_id);
create index if not exists idx_pending_jobs_store      on public.pending_jobs(store_id);