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
