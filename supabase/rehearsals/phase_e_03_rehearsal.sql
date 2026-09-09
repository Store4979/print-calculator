-- E-03 REHEARSAL. The migration body verbatim, then proofs, in ONE transaction
-- that ends in ROLLBACK. Nothing persists. Each insert below is exactly what
-- the client sends after toOrderRow with the widened ORDER_COLUMNS (11):
--   pre-D1 row : 11 legacy keys -> 7 keys (+ org/store stamped by insertOrder)
--   current row: 9 keys -> 9 keys
--   new row    : 11 keys -> 11 keys
-- Key sets verified by running the whitelist logic in Node (see PR).
begin;
create temp table proof(n int, step text, outcome text) on commit drop;

-- ===================== 1. E-03 body (verbatim) =====================
-- Phase E, migration 03 — margin snapshot on orders. NOT YET APPLIED.
--
-- Purely additive, both nullable. Costs change over time; an order must keep
-- the cost and margin it was quoted at. The client stamps both at save time
-- from the same values the PriceBar displayed. Historical rows have no cost
-- data and stay NULL — the dashboard renders "—" for them, never zero.
--
-- Client contract (src/lib/orderQueue.js): ORDER_COLUMNS grows 9 -> 11
-- (adds cost_subtotal, margin_pct). Three queued-row shapes must drain against
-- this schema — a pre-D1 7-key row, a current 9-key row, a new 11-key row —
-- and the rehearsal proves all three as anon
-- (supabase/rehearsals/phase_e_03_rehearsal.sql).
alter table public.orders
  add column cost_subtotal numeric(10,2),
  add column margin_pct    numeric(6,2);
comment on column public.orders.cost_subtotal is 'Sum of line costs at save time (materials, plus labor when the store has labor enabled). NULL on rows saved before Phase E.';
comment on column public.orders.margin_pct    is '(total - cost_subtotal) / total * 100 at save time. NULL on rows saved before Phase E. Can be negative.';

-- ===================== 2. proofs =====================
-- P1 anon: NEW 11-key row (deployed Phase E client) — stamped values read back.
do $$
declare t record; new_id uuid; c numeric; m numeric;
begin
  select employee_id, employee_name, line_items, org_id, store_id into t from public.orders where notes = 'test one';
  set local role anon; perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  insert into public.orders (employee_id, employee_name, total, base_subtotal, line_items, service_type, notes, org_id, store_id, cost_subtotal, margin_pct)
  values (t.employee_id, t.employee_name, 4.54, 4.54, t.line_items, 'sheets', 'E-03 rehearsal P1 new 11-key', t.org_id, t.store_id, 0.57, 87.44)
  returning id, cost_subtotal, margin_pct into new_id, c, m;
  reset role;
  insert into proof values (1, 'P1 anon: NEW 11-key row (expect OK, 0.57 / 87.44)', 'OK cost_subtotal=' || c || ' margin_pct=' || m);
exception when others then
  reset role;
  insert into proof values (1, 'P1 anon: NEW 11-key row', 'FAILED: ' || sqlerrm);
end $$;

-- P2 anon: CURRENT 9-key row (queued by today's deployed client, drained after the Phase E deploy).
do $$
declare t record; c numeric; m numeric;
begin
  select employee_id, employee_name, line_items, org_id, store_id into t from public.orders where notes = 'test one';
  set local role anon; perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  insert into public.orders (employee_id, employee_name, total, base_subtotal, line_items, service_type, notes, org_id, store_id)
  values (t.employee_id, t.employee_name, 4.54, 4.54, t.line_items, 'sheets', 'E-03 rehearsal P2 current 9-key', t.org_id, t.store_id)
  returning cost_subtotal, margin_pct into c, m;
  reset role;
  insert into proof values (2, 'P2 anon: CURRENT 9-key row (expect OK, both NULL)', 'OK cost_subtotal=' || coalesce(c::text,'NULL') || ' margin_pct=' || coalesce(m::text,'NULL'));
exception when others then
  reset role;
  insert into proof values (2, 'P2 anon: CURRENT 9-key row', 'FAILED: ' || sqlerrm);
end $$;

-- P3 anon: PRE-D1 row after the whitelist — 7 keys, stamped (normal) and unstamped (store lookup failed).
do $$
declare t record; a uuid; b uuid;
begin
  select employee_id, employee_name, line_items, org_id, store_id into t from public.orders where notes = 'test one';
  set local role anon; perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  insert into public.orders (employee_id, employee_name, total, base_subtotal, line_items, service_type, notes, org_id, store_id)
  values (t.employee_id, t.employee_name, 12.34, 12.34, t.line_items, 'sheets', 'E-03 rehearsal P3a pre-D1 7-key stamped', t.org_id, t.store_id)
  returning id into a;
  insert into public.orders (employee_id, employee_name, total, base_subtotal, line_items, service_type, notes)
  values (t.employee_id, t.employee_name, 12.34, 12.34, t.line_items, 'sheets', 'E-03 rehearsal P3b pre-D1 7-key unstamped')
  returning id into b;
  reset role;
  insert into proof values (3, 'P3 anon: PRE-D1 7-key row, stamped / unstamped (expect both OK)', 'OK ids=' || a || ' / ' || b);
exception when others then
  reset role;
  insert into proof values (3, 'P3 anon: PRE-D1 7-key row', 'FAILED: ' || sqlerrm);
end $$;

-- P4 negative: the pre-D1 row WITHOUT the whitelist (legacy commission keys) must still fail.
do $$
declare t record;
begin
  select employee_id, employee_name, line_items into t from public.orders where notes = 'test one';
  set local role anon; perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  insert into public.orders (employee_id, employee_name, total, base_subtotal, upsell_subtotal, base_commission, upsell_commission, total_commission, line_items, service_type, notes)
  values (t.employee_id, t.employee_name, 12.34, 12.34, 0, 0.09, 0, 0.09, t.line_items, 'sheets', 'E-03 rehearsal P4 MUST NOT LAND');
  reset role;
  insert into proof values (4, 'P4 anon: legacy row without whitelist (expect failure)', 'UNEXPECTED: accepted');
exception when others then
  reset role;
  insert into proof values (4, 'P4 anon: legacy row without whitelist (expect failure)', 'OK rejected: ' || sqlerrm);
end $$;

-- P5 authenticated owner: NEW 11-key row (admin-signed-in browser), negative margin allowed.
do $$
declare t record; m numeric;
begin
  select employee_id, employee_name, line_items, org_id, store_id into t from public.orders where notes = 'test one';
  set local role authenticated;
  perform set_config('request.jwt.claims', '{"sub":"d76883f3-e9b6-4210-a740-dcf9624bc301","role":"authenticated"}', true);
  insert into public.orders (employee_id, employee_name, total, base_subtotal, line_items, service_type, notes, org_id, store_id, cost_subtotal, margin_pct)
  values (t.employee_id, t.employee_name, 10.00, 10.00, t.line_items, 'sheets', 'E-03 rehearsal P5 underwater', t.org_id, t.store_id, 11.25, -12.50)
  returning margin_pct into m;
  reset role;
  insert into proof values (5, 'P5 authenticated owner: 11-key row with negative margin (expect OK, -12.50)', 'OK margin_pct=' || m);
exception when others then
  reset role;
  insert into proof values (5, 'P5 authenticated owner: 11-key row', 'FAILED: ' || sqlerrm);
end $$;

-- P6 history: the two real rows stay NULL (dashboard shows "—"); only P1/P5 carry values.
insert into proof
select 6, 'P6 real rows with NULL cost (expect 2) ; rehearsal rows with values (expect 2) ; anon select * rows (expect 8)',
  (select count(*) from public.orders where notes not like 'E-03 rehearsal%' and cost_subtotal is null and margin_pct is null) || ' ; '
  || (select count(*) from public.orders where cost_subtotal is not null) || ' ; '
  || (select count(*) from public.orders);

-- P7 rollback body: drop both columns; a 9-key insert still works, real rows untouched.
alter table public.orders drop column cost_subtotal, drop column margin_pct;
do $$
declare t record; x uuid;
begin
  select employee_id, employee_name, line_items, org_id, store_id into t from public.orders where notes = 'test one';
  set local role anon; perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  insert into public.orders (employee_id, employee_name, total, base_subtotal, line_items, service_type, notes, org_id, store_id)
  values (t.employee_id, t.employee_name, 1, 1, t.line_items, 'sheets', 'E-03 rehearsal P7 after rollback', t.org_id, t.store_id) returning id into x;
  reset role;
  insert into proof values (7, 'P7 after rollback body: columns gone ; 9-key insert (expect 0 cols, OK)',
    (select count(*) from information_schema.columns where table_schema='public' and table_name='orders' and column_name in ('cost_subtotal','margin_pct')) || ' cols ; OK id=' || x);
exception when others then
  reset role;
  insert into proof values (7, 'P7 after rollback body', 'FAILED: ' || sqlerrm);
end $$;

select n, step, outcome from proof order by n;
rollback;
