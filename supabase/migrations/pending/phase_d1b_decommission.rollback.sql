-- ROLLBACK for 20260908000002_phase_d1b_decommission.sql
-- Restores the POST-D1-a state (orders table + compat view + nullable
-- incentive columns + commission_settings), i.e. the state in which both
-- the old and new clients work. To go all the way back to pre-D1, run
-- the D1-a rollback after this one.
--
-- Requires public._archive_commission_columns, written by D1-b. Without it
-- the incentive VALUES cannot be recovered (the columns can, as zeros).
begin;

-- 1. Undo the cosmetic renames.
alter policy anon_rw_orders on public.orders rename to anon_rw_transactions;
alter table public.orders rename constraint orders_employee_id_fkey to transactions_employee_id_fkey;
alter table public.orders rename constraint orders_org_id_fkey      to transactions_org_id_fkey;
alter table public.orders rename constraint orders_store_id_fkey    to transactions_store_id_fkey;
alter index if exists public.orders_pkey           rename to transactions_pkey;
alter index if exists public.orders_employee_idx   rename to transactions_employee_idx;
alter index if exists public.orders_created_at_idx rename to transactions_created_at_idx;
alter index if exists public.idx_orders_store      rename to idx_transactions_store;

-- 2. Re-add the incentive columns (nullable, default 0 — the D1-a shape).
alter table public.orders
  add column if not exists upsell_subtotal   numeric(10,2) default 0,
  add column if not exists base_commission   numeric(10,2) default 0,
  add column if not exists upsell_commission numeric(10,2) default 0,
  add column if not exists total_commission  numeric(10,2) default 0;

-- 3. Restore the historical values from the archive.
update public.orders o
   set upsell_subtotal   = a.upsell_subtotal,
       base_commission   = a.base_commission,
       upsell_commission = a.upsell_commission,
       total_commission  = a.total_commission
  from public._archive_commission_columns a
 where a.order_id = o.id;

-- 4. Recreate commission_settings and reseed the EXACT live values captured
--    2026-09-08 before D1-b (note upsell_rate 0.0500, not the 0.0800 default).
create table if not exists public.commission_settings (
  id                       int primary key default 1,
  base_rate                numeric(5,4)  not null default 0.0200,
  upsell_rate              numeric(5,4)  not null default 0.0800,
  monthly_bonus_threshold  numeric(10,2) not null default 5000.00,
  monthly_bonus_amount     numeric(10,2) not null default 50.00,
  updated_at               timestamptz   not null default now(),
  org_id                   uuid references public.organizations(id) on delete cascade,
  store_id                 uuid references public.stores(id) on delete cascade,
  constraint commission_settings_singleton check (id = 1)
);
create index if not exists idx_commission_settings_org on public.commission_settings(org_id);
alter table public.commission_settings enable row level security;
drop policy if exists anon_rw_commission_settings on public.commission_settings;
create policy anon_rw_commission_settings on public.commission_settings
  for all to anon, authenticated using (true) with check (true);
insert into public.commission_settings (id, base_rate, upsell_rate, monthly_bonus_threshold, monthly_bonus_amount, org_id, store_id)
select 1, 0.0200, 0.0500, 5000.00, 50.00, s.org_id, s.id from public.stores s where s.slug = 'store4979'
on conflict (id) do nothing;

-- 5. Restore the Phase A cloud key (empty flags; the admin can re-tick).
insert into public.settings (store_id, key, value)
select s.id, 'upsell_defaults', '{"paperTypes":{},"lfPaperTypes":{},"lfAddons":{"grommets":false,"foamCore":false}}'::jsonb
  from public.stores s where s.slug = 'store4979'
on conflict (store_id, key) do nothing;

-- 6. Recreate the compatibility view.
create view public.transactions with (security_invoker = true) as select * from public.orders;
grant select, insert, update, delete on public.transactions to anon, authenticated, service_role;

commit;
