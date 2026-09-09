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
