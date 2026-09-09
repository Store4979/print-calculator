-- D1-b REHEARSAL. Runs the decommission body verbatim, then the proofs the
-- owner required, then the rollback file, all inside ONE transaction that
-- ends in ROLLBACK. Nothing here persists. Re-runnable at any time before
-- D1-b is applied; after apply it will fail at step 2 (view already gone).
--
-- Roles are impersonated exactly as PostgREST would: `set local role` plus
-- request.jwt.claims. Lookups that anon cannot do (employees is locked down)
-- are captured into variables BEFORE the role switch.
begin;

-- ===================== 1. D1-b body (verbatim) =====================
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

-- ===================== 2. proofs =====================
create temp table proof(n int, step text, outcome text) on commit drop;

-- P1: the DEPLOYED client (insertOrder -> public.orders) sends exactly ORDER_COLUMNS,
--     nine columns. Values copied from the real "test one" production row. As anon.
do $$
declare t record; new_id uuid;
begin
  select employee_id, employee_name, total, base_subtotal, line_items, service_type, org_id, store_id
    into t from public.orders where notes = 'test one';
  set local role anon; perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  insert into public.orders (employee_id, employee_name, total, base_subtotal, line_items, service_type, notes, org_id, store_id)
  values (t.employee_id, t.employee_name, t.total, t.base_subtotal, t.line_items, t.service_type, 'D1-b rehearsal P1', t.org_id, t.store_id)
  returning id into new_id;
  reset role;
  insert into proof values (1, 'P1 anon: exact 9-column ORDER_COLUMNS insert into public.orders', 'OK  id=' || new_id);
exception when others then
  reset role;
  insert into proof values (1, 'P1 anon: exact 9-column ORDER_COLUMNS insert into public.orders', 'FAILED: ' || sqlerrm);
end $$;

-- P2: same insert as the signed-in owner (a browser with an admin session sends `authenticated`).
do $$
declare t record; new_id uuid;
begin
  select employee_id, employee_name, total, base_subtotal, line_items, service_type, org_id, store_id
    into t from public.orders where notes = 'test one';
  set local role authenticated;
  perform set_config('request.jwt.claims', '{"sub":"d76883f3-e9b6-4210-a740-dcf9624bc301","role":"authenticated"}', true);
  insert into public.orders (employee_id, employee_name, total, base_subtotal, line_items, service_type, notes, org_id, store_id)
  values (t.employee_id, t.employee_name, t.total, t.base_subtotal, t.line_items, t.service_type, 'D1-b rehearsal P2', t.org_id, t.store_id)
  returning id into new_id;
  reset role;
  insert into proof values (2, 'P2 authenticated (owner): same 9-column insert', 'OK  id=' || new_id);
exception when others then
  reset role;
  insert into proof values (2, 'P2 authenticated (owner): same 9-column insert', 'FAILED: ' || sqlerrm);
end $$;

-- P3: OFFLINE QUEUE DRAIN. A row the PRE-D1 client wrote to localStorage carries
--     eleven keys (incl. the four dropped columns, no org/store). drainPendingOrders
--     strips _queuedAt, toOrderRow whitelists it to SEVEN keys (verified by running
--     the real JS), then insertOrder stamps org_id/store_id best-effort.
--     P3a = stamped (normal path). P3b = unstamped (store lookup failed).
do $$
declare t record; a uuid; b uuid;
begin
  select employee_id, employee_name, line_items, org_id, store_id into t from public.orders where notes = 'test one';
  set local role anon; perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  insert into public.orders (employee_id, employee_name, total, base_subtotal, line_items, service_type, notes, org_id, store_id)
  values (t.employee_id, t.employee_name, 12.34, 12.34, t.line_items, 'sheets', 'D1-b rehearsal P3a legacy queued row, whitelisted + stamped', t.org_id, t.store_id)
  returning id into a;
  insert into public.orders (employee_id, employee_name, total, base_subtotal, line_items, service_type, notes)
  values (t.employee_id, t.employee_name, 12.34, 12.34, t.line_items, 'sheets', 'D1-b rehearsal P3b legacy queued row, whitelisted, unstamped')
  returning id into b;
  reset role;
  insert into proof values (3, 'P3 anon: drain path, legacy row after toOrderRow (7 keys) stamped / unstamped', 'OK  ids=' || a || ' / ' || b);
exception when others then
  reset role;
  insert into proof values (3, 'P3 anon: drain path, legacy row after toOrderRow (7 keys) stamped / unstamped', 'FAILED: ' || sqlerrm);
end $$;

-- P4 (negative, proves the whitelist is load-bearing): the same legacy row inserted
--     VERBATIM, the way the pre-D1 drainPendingTransactions did. MUST fail.
do $$
declare t record;
begin
  select employee_id, employee_name, line_items into t from public.orders where notes = 'test one';
  set local role anon; perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  insert into public.orders (employee_id, employee_name, total, base_subtotal, upsell_subtotal, base_commission, upsell_commission, total_commission, line_items, service_type, notes)
  values (t.employee_id, t.employee_name, 12.34, 12.34, 0, 0.09, 0, 0.09, t.line_items, 'sheets', 'D1-b rehearsal P4 MUST NOT LAND');
  reset role;
  insert into proof values (4, 'P4 anon: legacy 11-key row WITHOUT whitelist (expect failure)', 'UNEXPECTED: insert succeeded');
exception when others then
  reset role;
  insert into proof values (4, 'P4 anon: legacy 11-key row WITHOUT whitelist (expect failure)', 'OK  rejected: ' || sqlerrm);
end $$;

-- P5: reads. fetchOrders is select * on public.orders as anon; the view must be gone.
do $$
declare c int; v text;
begin
  set local role anon; perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  select count(*) into c from public.orders;
  begin
    execute 'select count(*) from public.transactions';
    v := 'UNEXPECTED: view still readable';
  exception when others then
    v := 'view gone: ' || sqlerrm;
  end;
  reset role;
  insert into proof values (5, 'P5 anon: select * from orders (expect 6 = 2 real + 4 rehearsal) ; compat view', c || ' rows ; ' || v);
exception when others then
  reset role;
  insert into proof values (5, 'P5 anon: select * from orders ; compat view', 'FAILED: ' || sqlerrm);
end $$;

-- P6: archive honesty. Row count equals orders at archive time (2), the one nonzero
--     historical value survived, and anon sees nothing (RLS on, no policies).
do $$
declare n int; v numeric; an int;
begin
  select count(*) into n from public._archive_commission_columns;
  select total_commission into v from public._archive_commission_columns where order_id = 'd0f64962-dfd4-4929-8a68-40f21b077630';
  set local role anon; perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  select count(*) into an from public._archive_commission_columns;
  reset role;
  insert into proof values (6, 'P6 archive: rows (expect 2) ; d0f64962 total_commission (expect 0.01) ; anon-visible rows (expect 0)', n || ' ; ' || coalesce(v::text,'NULL') || ' ; ' || an);
exception when others then
  reset role;
  insert into proof values (6, 'P6 archive', 'FAILED: ' || sqlerrm);
end $$;

-- P7: the rest of the body landed.
insert into proof
select 7, 'P7 post-state',
  'commission_settings=' || coalesce(to_regclass('public.commission_settings')::text, 'GONE')
  || ' ; upsell_defaults rows=' || (select count(*) from public.settings where key = 'upsell_defaults')
  || ' ; dropped cols still present=' || (select count(*) from information_schema.columns where table_schema='public' and table_name='orders' and column_name in ('upsell_subtotal','base_commission','upsell_commission','total_commission'))
  || ' ; indexes=' || (select string_agg(indexname, ',' order by indexname) from pg_indexes where schemaname='public' and tablename='orders')
  || ' ; constraints=' || (select string_agg(conname, ',' order by conname) from pg_constraint where conrelid='public.orders'::regclass)
  || ' ; policies=' || (select string_agg(policyname, ',') from pg_policies where tablename='orders');

-- ===================== 3. rollback file, verbatim minus begin/commit =====================
-- ROLLBACK for 20260908000002_phase_d1b_decommission.sql
-- Restores the POST-D1-a state (orders table + compat view + nullable
-- incentive columns + commission_settings), i.e. the state in which both
-- the old and new clients work. To go all the way back to pre-D1, run
-- the D1-a rollback after this one.
--
-- Requires public._archive_commission_columns, written by D1-b. Without it
-- the incentive VALUES cannot be recovered (the columns can, as zeros).

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


-- P8: the rollback file restores the post-D1-a state, values included.
insert into proof
select 8, 'P8 rollback file: d0f64962 total_commission (expect 0.01) ; commission_settings upsell_rate (expect 0.0500) ; upsell_defaults rows (expect 1) ; view ; indexes',
  coalesce((select total_commission::text from public.orders where id = 'd0f64962-dfd4-4929-8a68-40f21b077630'), 'NULL')
  || ' ; ' || coalesce((select upsell_rate::text from public.commission_settings where id = 1), 'NULL')
  || ' ; ' || (select count(*) from public.settings where key = 'upsell_defaults')
  || ' ; ' || coalesce(to_regclass('public.transactions')::text, 'MISSING')
  || ' ; ' || (select string_agg(indexname, ',' order by indexname) from pg_indexes where schemaname='public' and tablename='orders');

select n, step, outcome from proof order by n;

rollback;
