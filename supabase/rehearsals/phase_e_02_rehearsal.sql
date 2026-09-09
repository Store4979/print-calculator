-- E-02 REHEARSAL. The migration body verbatim, then proofs, in ONE transaction
-- that ends in ROLLBACK. Nothing persists.
begin;
create temp table proof(n int, step text, outcome text) on commit drop;
create temp table before_prices on commit drop as
  select id, base_cost_color, base_cost_bw, price_color, price_bw from public.sheet_prices;

-- ===================== 1. E-02 body (verbatim) =====================
-- Phase E, migration 02 — explicit cost model. NOT YET APPLIED.
--
-- Purely additive. sheet_prices gains the decomposition of base cost into
-- paper (media) cost + click charge, so the admin editor can show and edit
-- the two halves. base_cost_color / base_cost_bw remain the consumed fields
-- and are kept equal to paper_cost + click_* by the client on publish; no
-- price and no consumed cost changes here.
--
-- Backfill is the LOSSLESS decomposition the owner chose (2026-09-09):
--   sheet rows:  paper_cost = base_cost_bw, click_bw = 0,
--                click_color = base_cost_color - base_cost_bw   (0.0361 on every row)
--   LF rows:     paper_cost = base_cost_color, clicks = 0     (media only; LF has
--                no click charge and base_cost_bw is 0 on every LF row, so the
--                sheet formula would wrongly put the whole media cost in the click)
-- No B&W click value is invented. Until the owner enters the true B&W click,
-- duplex B&W cost is understated — the pricing editor shows a callout saying so.
--
-- Both tables carry an updated_at trigger; the backfill bumps updated_at on the
-- 22 sheet_prices rows. Expected.

-- 1. Cost decomposition columns.
alter table public.sheet_prices
  add column paper_cost  numeric(10,4),
  add column click_color numeric(10,4),
  add column click_bw    numeric(10,4);
comment on column public.sheet_prices.paper_cost  is 'Media cost per sheet (or per sq ft for large format). base_cost_* = paper_cost + click_*.';
comment on column public.sheet_prices.click_color is 'Color click charge per side. 0 for large format.';
comment on column public.sheet_prices.click_bw    is 'B&W click charge per side. Backfilled 0 (never entered) — the true value is unknown until the owner enters it.';

-- 2. Backfill, lossless, by paper kind.
update public.sheet_prices sp
   set paper_cost  = sp.base_cost_bw,
       click_bw    = 0,
       click_color = round(sp.base_cost_color - sp.base_cost_bw, 4)
  from public.paper_types pt
 where pt.id = sp.paper_type_id
   and pt.kind = 'sheet';

update public.sheet_prices sp
   set paper_cost  = sp.base_cost_color,
       click_bw    = 0,
       click_color = 0
  from public.paper_types pt
 where pt.id = sp.paper_type_id
   and pt.kind = 'large_format';

-- 3. Pricing mode per paper: cost-up (enter markup, derive price — today's
--    behaviour) or market-down (enter price, derive markup).
alter table public.paper_types
  add column pricing_mode text not null default 'cost_up'
  constraint paper_types_pricing_mode_check check (pricing_mode in ('cost_up','market_down'));
comment on column public.paper_types.pricing_mode is 'Admin input mode only. Both modes write the same price/markup data; quote-time consumption is unchanged.';

-- ===================== 2. proofs =====================
-- P1 identity per kind, all rows.
insert into proof
select 1, 'P1 decomposition identity: rows ; sheet mismatches (expect 0) ; LF mismatches (expect 0) ; nulls (expect 0)',
  (select count(*) from public.sheet_prices) || ' ; '
  || (select count(*) from public.sheet_prices sp join public.paper_types pt on pt.id = sp.paper_type_id
       where pt.kind = 'sheet' and (round(sp.paper_cost + sp.click_color, 4) <> sp.base_cost_color
                                 or round(sp.paper_cost + sp.click_bw, 4)    <> sp.base_cost_bw)) || ' ; '
  || (select count(*) from public.sheet_prices sp join public.paper_types pt on pt.id = sp.paper_type_id
       where pt.kind = 'large_format' and (sp.paper_cost <> sp.base_cost_color or sp.click_color <> 0 or sp.click_bw <> 0)) || ' ; '
  || (select count(*) from public.sheet_prices where paper_cost is null or click_color is null or click_bw is null);

-- P2 the click_color premium is the known constant on every sheet row.
insert into proof
select 2, 'P2 sheet click_color distinct values (expect {0.0361}) ; click_bw distinct (expect {0})',
  (select string_agg(distinct sp.click_color::text, ',') from public.sheet_prices sp join public.paper_types pt on pt.id = sp.paper_type_id where pt.kind = 'sheet')
  || ' ; ' || (select string_agg(distinct click_bw::text, ',') from public.sheet_prices);

-- P3 nothing consumed changed: base costs and prices identical to before.
insert into proof
select 3, 'P3 base_cost_* and price_* changed rows (expect 0)',
  (select count(*) from public.sheet_prices sp join before_prices b on b.id = sp.id
    where sp.base_cost_color <> b.base_cost_color or sp.base_cost_bw <> b.base_cost_bw
       or sp.price_color <> b.price_color or sp.price_bw <> b.price_bw)::text;

-- P4 anon (the app at load time) can read the new columns.
do $$
declare c int; m int;
begin
  set local role anon; perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  select count(*) into c from public.sheet_prices where paper_cost is not null;
  select count(*) into m from public.paper_types where pricing_mode = 'cost_up';
  reset role;
  insert into proof values (4, 'P4 anon reads: sheet_prices with paper_cost (expect 22) ; paper_types cost_up (expect 16)', c || ' ; ' || m);
exception when others then
  reset role;
  insert into proof values (4, 'P4 anon reads', 'FAILED: ' || sqlerrm);
end $$;

-- P5 owner publish path can write the new columns; manager too (policy is owner/manager).
do $$
declare v numeric; md text;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', '{"sub":"d76883f3-e9b6-4210-a740-dcf9624bc301","role":"authenticated"}', true);
  update public.sheet_prices sp set click_bw = 0.0090, paper_cost = round(sp.base_cost_bw - 0.0090, 4)
   where sp.sheet_key = '8.5x11' and sp.paper_type_id = (select id from public.paper_types where key = '28lb' and kind = 'sheet');
  update public.paper_types set pricing_mode = 'market_down' where key = '28lb' and kind = 'sheet';
  reset role;
  select click_bw into v from public.sheet_prices sp where sp.sheet_key = '8.5x11' and sp.paper_type_id = (select id from public.paper_types where key = '28lb' and kind = 'sheet');
  select pricing_mode into md from public.paper_types where key = '28lb' and kind = 'sheet';
  insert into proof values (5, 'P5 owner writes click_bw=0.0090 on 28lb 8.5x11 and market_down on 28lb (expect both)', 'click_bw=' || v || ' ; mode=' || md);
exception when others then
  reset role;
  insert into proof values (5, 'P5 owner writes', 'FAILED: ' || sqlerrm);
end $$;

-- P6 re-derived identity still holds after an owner edit (paper_cost + click_bw = base_cost_bw).
insert into proof
select 6, 'P6 identity after owner edit on 28lb 8.5x11 (expect true)',
  (round(sp.paper_cost + sp.click_bw, 4) = sp.base_cost_bw)::text || ' paper_cost=' || sp.paper_cost || ' click_bw=' || sp.click_bw || ' base_cost_bw=' || sp.base_cost_bw
from public.sheet_prices sp where sp.sheet_key = '8.5x11' and sp.paper_type_id = (select id from public.paper_types where key = '28lb' and kind = 'sheet');

-- P7 pricing_mode check constraint.
do $$
begin
  update public.paper_types set pricing_mode = 'guess' where key = '20lb' and kind = 'sheet';
  insert into proof values (7, 'P7 pricing_mode=guess (expect rejection)', 'UNEXPECTED: accepted');
exception when others then
  insert into proof values (7, 'P7 pricing_mode=guess (expect rejection)', 'OK rejected [' || sqlstate || ']');
end $$;

-- P8 manager admin can also write (publish is owner/manager by policy).
do $$
declare c int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', '{"sub":"7c8a2a1c-60c3-4abc-bcd0-c13f0f95ed02","role":"authenticated"}', true);
  update public.sheet_prices set click_bw = 0.0100 where sheet_key = '11x17' and paper_type_id = (select id from public.paper_types where key = '20lb' and kind = 'sheet');
  get diagnostics c = row_count;
  reset role;
  insert into proof values (8, 'P8 manager admin updates click_bw on 20lb 11x17 (expect 1 row)', c::text);
exception when others then
  reset role;
  insert into proof values (8, 'P8 manager admin update', 'FAILED: ' || sqlerrm);
end $$;

-- P9 rollback file body (minus begin/commit) restores the pre-E-02 column set.
alter table public.paper_types  drop column pricing_mode;
alter table public.sheet_prices drop column paper_cost, drop column click_color, drop column click_bw;
insert into proof
select 9, 'P9 after rollback body: E-02 columns remaining (expect 0) ; prices intact (expect 0 changed)',
  (select count(*) from information_schema.columns where table_schema = 'public'
     and ((table_name = 'sheet_prices' and column_name in ('paper_cost','click_color','click_bw'))
       or (table_name = 'paper_types' and column_name = 'pricing_mode'))) || ' ; '
  || (select count(*) from public.sheet_prices sp join before_prices b on b.id = sp.id
       where sp.base_cost_color <> b.base_cost_color or sp.base_cost_bw <> b.base_cost_bw
          or sp.price_color <> b.price_color or sp.price_bw <> b.price_bw);

select n, step, outcome from proof order by n;
rollback;
