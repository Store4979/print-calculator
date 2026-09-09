-- ROLLBACK for 20260908000001_phase_d1a_orders_compat.sql — EXACT inverse.
-- Safe at any point before D1-b: no data is lost by D1-a, so this restores
-- the pre-D1 shape completely. The old client works again immediately.
--
-- If the NEW client is already deployed when you run this, it will fail to
-- save orders (it targets `orders`); revert the client too in that case.
alter table public.orders
  alter column upsell_subtotal   set not null, alter column upsell_subtotal   drop default,
  alter column base_commission   set not null, alter column base_commission   drop default,
  alter column upsell_commission set not null, alter column upsell_commission drop default,
  alter column total_commission  set not null, alter column total_commission  drop default;

drop view if exists public.transactions;
alter table public.orders rename to transactions;
