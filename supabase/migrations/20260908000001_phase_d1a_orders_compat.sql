-- Phase D1, migration a — RENAME + COMPATIBILITY. Zero downtime.
-- Applied to gmxyisjjaxtpycsmmzef 2026-09-08. Rollback alongside.
--
-- Order history is NOT commission data: `transactions` is the order log with
-- incentive columns bolted on. This renames it to `orders` and keeps the
-- CURRENTLY DEPLOYED client working through an updatable view, so no counter
-- loses the ability to save an order during the deploy window.
--
-- Proven in a rolled-back transaction before apply: rename preserves rows
-- (1->1), sum(total) (0.65), policies (1), indexes (4), columns (15), RLS
-- (on); the policy follows the table; anon still reads through it.
--
-- What each statement is for:
--   rename ............ all rows/indexes/FKs/RLS/org_id/store_id survive
--   view .............. old client's from("transactions") keeps resolving;
--                       auto-updatable so its INSERT ... RETURNING still works;
--                       security_invoker so RLS applies to the caller, not the
--                       view owner (otherwise a view created by postgres would
--                       bypass RLS entirely)
--   drop not null ..... new client omits the incentive columns; old client
--                       still sends them. Both are valid until D1-b drops them.
alter table public.transactions rename to orders;

create view public.transactions
  with (security_invoker = true)
  as select * from public.orders;
grant select, insert, update, delete on public.transactions to anon, authenticated, service_role;

alter table public.orders
  alter column upsell_subtotal   drop not null, alter column upsell_subtotal   set default 0,
  alter column base_commission   drop not null, alter column base_commission   set default 0,
  alter column upsell_commission drop not null, alter column upsell_commission set default 0,
  alter column total_commission  drop not null, alter column total_commission  set default 0;
