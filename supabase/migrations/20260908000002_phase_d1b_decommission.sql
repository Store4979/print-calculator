-- Phase D1, migration b — DECOMMISSION. NOT YET APPLIED.
--
-- APPLY ONLY AFTER the D1 client is deployed to production and a Save
-- Order has been confirmed to land in public.orders. This drops the view
-- the OLD client writes through and the table it reads on mount; applying
-- it while that client is still live breaks order-saving at every counter.
--
-- POINT OF NO RETURN for the incentive VALUES: the four dropped columns
-- hold historical commission amounts. They are copied to
-- _archive_commission_columns first, which is what makes the rollback
-- file honest. That table has RLS on and no policies — invisible to anon,
-- readable only via service role / SQL editor.
--
-- Supersedes Phase B steps B1/B3 (commission_settings store_id re-key and
-- PK repoint) entirely: the table is gone. Neither was ever applied.

-- 1. Preserve what the drops destroy.
create table public._archive_commission_columns as
  select id as order_id, upsell_subtotal, base_commission, upsell_commission, total_commission,
         now() as archived_at
  from public.orders;
alter table public._archive_commission_columns enable row level security;
comment on table public._archive_commission_columns is
  'Phase D1: incentive columns copied from orders before they were dropped. '
  'Used only by the D1-b rollback. Safe to drop once the rollback window has passed.';

-- 2. Retire the compatibility view (old client is gone by now).
drop view if exists public.transactions;

-- 3. Drop the incentive layer.
alter table public.orders
  drop column if exists upsell_subtotal,
  drop column if exists base_commission,
  drop column if exists upsell_commission,
  drop column if exists total_commission;

drop table if exists public.commission_settings;

-- 4. Phase A published the upsell flags to the cloud config; the client no
--    longer writes or reads this key.
delete from public.settings where key = 'upsell_defaults';

-- 5. Cosmetic hygiene: names that still say "transactions". Zero risk.
alter index if exists public.transactions_pkey            rename to orders_pkey;
alter index if exists public.transactions_employee_idx    rename to orders_employee_idx;
alter index if exists public.transactions_created_at_idx  rename to orders_created_at_idx;
alter index if exists public.idx_transactions_store       rename to idx_orders_store;
alter table public.orders rename constraint transactions_employee_id_fkey to orders_employee_id_fkey;
alter table public.orders rename constraint transactions_org_id_fkey      to orders_org_id_fkey;
alter table public.orders rename constraint transactions_store_id_fkey    to orders_store_id_fkey;
alter policy anon_rw_transactions on public.orders rename to anon_rw_orders;
-- NOTE: anon_rw_orders remains ALL/qual=true. Tightening it is Phase B
-- section 4 scope, deliberately not changed here.
