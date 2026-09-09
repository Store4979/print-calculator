-- ============================================================
--  PHASE A · Migration 001 — Store configuration tables
--  Roadmap §6 Phase A: extract the store into configuration.
--
--  Purely ADDITIVE. Touches no existing table (employees,
--  transactions, commission_settings, print_jobs, pending_jobs).
--  The running store app does not read these tables until the
--  frontend wiring lands after the UI redesign merges.
--
--  Tables: stores, memberships, paper_types, sheet_prices,
--          discounts, addons, settings, outsourced_products
--  Every config table carries store_id (Phase B adds org_id above).
-- ============================================================

-- ── updated_at helper ───────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ── stores (the storeProfile) ───────────────────────────────
create table if not exists public.stores (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null unique,
  name       text not null,
  address    text,
  phone      text,
  email      text,
  logo_url   text,
  colors     jsonb not null default '{}'::jsonb,   -- {primary, accent, ...}
  timezone   text not null default 'America/Detroit',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint stores_slug_format check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$')
);
create trigger stores_updated_at before update on public.stores
  for each row execute function public.set_updated_at();

-- ── memberships (auth roles; Phase B adds organizations) ────
create table if not exists public.memberships (
  id         uuid primary key default gen_random_uuid(),
  store_id   uuid not null references public.stores(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null check (role in ('owner','manager','staff')),
  created_at timestamptz not null default now(),
  unique (store_id, user_id)
);
create index if not exists memberships_user_idx on public.memberships (user_id);

-- Role check used by every write policy. SECURITY DEFINER so the
-- memberships lookup itself is not subject to RLS recursion.
create or replace function public.has_store_role(p_store uuid, p_roles text[])
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.memberships m
    where m.store_id = p_store
      and m.user_id  = auth.uid()
      and m.role     = any(p_roles)
  );
$$;
revoke all on function public.has_store_role(uuid, text[]) from public;
grant execute on function public.has_store_role(uuid, text[]) to anon, authenticated;

-- ── paper_types (sheet + large-format lists) ────────────────
-- kind='sheet'         → sheetKeysForPaper via sheet_keys[], markup from sheetMarkupPerPaper
-- kind='large_format'  → priced per sqft, markup from lfMarkupPerPaper
create table if not exists public.paper_types (
  id          uuid primary key default gen_random_uuid(),
  store_id    uuid not null references public.stores(id) on delete cascade,
  kind        text not null check (kind in ('sheet','large_format')),
  key         text not null,
  label       text not null,
  sheet_keys  text[] not null default '{}',        -- e.g. {8.5x11, 11x17}; empty for large_format
  markup_percent numeric(8,2),                     -- e.g. 700 = 700%
  upsell_flag boolean not null default false,      -- upsellFlags.paperTypes / .lfPaperTypes
  sort_order  int not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (store_id, kind, key)
);
create trigger paper_types_updated_at before update on public.paper_types
  for each row execute function public.set_updated_at();
create index if not exists paper_types_store_idx on public.paper_types (store_id, kind, sort_order);

-- ── sheet_prices ────────────────────────────────────────────
-- kind='sheet': one row per (paper, sheet size), sheet_key set, sku from skuMap.
-- kind='large_format': one row per paper, sheet_key NULL, prices are per-sqft.
create table if not exists public.sheet_prices (
  id              uuid primary key default gen_random_uuid(),
  store_id        uuid not null references public.stores(id) on delete cascade,
  paper_type_id   uuid not null references public.paper_types(id) on delete cascade,
  sheet_key       text,                            -- '8.5x11' | '11x17' | '12x18' | NULL (large format)
  base_cost_color numeric(10,4) not null default 0,
  base_cost_bw    numeric(10,4) not null default 0,
  price_color     numeric(10,4) not null default 0,
  price_bw        numeric(10,4) not null default 0,
  sku             text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique nulls not distinct (store_id, paper_type_id, sheet_key)
);
create trigger sheet_prices_updated_at before update on public.sheet_prices
  for each row execute function public.set_updated_at();
create index if not exists sheet_prices_store_idx on public.sheet_prices (store_id, paper_type_id);

-- ── discounts (quantity discount ladders) ───────────────────
create table if not exists public.discounts (
  id               uuid primary key default gen_random_uuid(),
  store_id         uuid not null references public.stores(id) on delete cascade,
  kind             text not null check (kind in ('sheet','large_format')),
  min_qty          int not null check (min_qty >= 0),
  discount_percent numeric(5,2) not null check (discount_percent between 0 and 100),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (store_id, kind, min_qty)
);
create trigger discounts_updated_at before update on public.discounts
  for each row execute function public.set_updated_at();

-- ── addons (large-format add-ons; lfAddonPricing) ───────────
-- pricing_unit: 'each' (× count × qty), 'flat_per_print' (× qty), 'flat' (legacy)
create table if not exists public.addons (
  id           uuid primary key default gen_random_uuid(),
  store_id     uuid not null references public.stores(id) on delete cascade,
  kind         text not null default 'large_format' check (kind in ('large_format','sheet')),
  key          text not null,
  label        text not null,
  price        numeric(10,2) not null default 0,
  pricing_unit text not null default 'flat_per_print' check (pricing_unit in ('each','flat_per_print','flat')),
  upsell_flag  boolean not null default false,     -- upsellFlags.lfAddons
  active       boolean not null default true,
  sort_order   int not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (store_id, kind, key)
);
create trigger addons_updated_at before update on public.addons
  for each row execute function public.set_updated_at();

-- ── settings (per-store key/value; the misc knobs) ──────────
create table if not exists public.settings (
  store_id   uuid not null references public.stores(id) on delete cascade,
  key        text not null,
  value      jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (store_id, key)
);
create trigger settings_updated_at before update on public.settings
  for each row execute function public.set_updated_at();

-- ── outsourced_products (BYO trade-printer catalog) ─────────
create table if not exists public.outsourced_products (
  id             uuid primary key default gen_random_uuid(),
  store_id       uuid not null references public.stores(id) on delete cascade,
  category_key   text not null,
  category_label text,
  product_key    text not null,
  label          text not null,
  data           jsonb not null,
  active         boolean not null default true,
  sort_order     int not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (store_id, category_key, product_key)
);
create trigger outsourced_products_updated_at before update on public.outsourced_products
  for each row execute function public.set_updated_at();
create index if not exists outsourced_products_store_idx
  on public.outsourced_products (store_id, category_key, sort_order);

-- ============================================================
--  Row-Level Security
-- ============================================================

alter table public.stores               enable row level security;
alter table public.memberships          enable row level security;
alter table public.paper_types          enable row level security;
alter table public.sheet_prices        enable row level security;
alter table public.discounts            enable row level security;
alter table public.addons               enable row level security;
alter table public.settings             enable row level security;
alter table public.outsourced_products  enable row level security;

-- stores: read all; update owner/manager; no client insert/delete
create policy stores_read   on public.stores for select to anon, authenticated using (true);
create policy stores_update on public.stores for update to authenticated
  using (public.has_store_role(id, array['owner','manager']))
  with check (public.has_store_role(id, array['owner','manager']));

-- memberships: see your own rows; owners see + manage the store's rows
create policy memberships_read on public.memberships for select to authenticated
  using (user_id = auth.uid() or public.has_store_role(store_id, array['owner']));
create policy memberships_insert on public.memberships for insert to authenticated
  with check (public.has_store_role(store_id, array['owner']));
create policy memberships_update on public.memberships for update to authenticated
  using (public.has_store_role(store_id, array['owner']))
  with check (public.has_store_role(store_id, array['owner']));
create policy memberships_delete on public.memberships for delete to authenticated
  using (public.has_store_role(store_id, array['owner']));

-- config tables: identical policy set
do $$
declare t text;
begin
  foreach t in array array['paper_types','sheet_prices','discounts','addons','settings','outsourced_products']
  loop
    execute format('create policy %I_read on public.%I for select to anon, authenticated using (true)', t, t);
    execute format($p$create policy %I_insert on public.%I for insert to authenticated
      with check (public.has_store_role(store_id, array['owner','manager']))$p$, t, t);
    execute format($p$create policy %I_update on public.%I for update to authenticated
      using (public.has_store_role(store_id, array['owner','manager']))
      with check (public.has_store_role(store_id, array['owner','manager']))$p$, t, t);
    execute format($p$create policy %I_delete on public.%I for delete to authenticated
      using (public.has_store_role(store_id, array['owner','manager']))$p$, t, t);
  end loop;
end $$;