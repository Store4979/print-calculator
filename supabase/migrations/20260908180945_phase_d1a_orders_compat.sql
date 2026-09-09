-- Phase D1, migration a — RENAME + COMPATIBILITY. Zero downtime.
-- Order history is NOT commission data: `transactions` is the order log with
-- incentive columns bolted on. Rename to `orders`; keep the currently-deployed
-- client working through an updatable, security_invoker view; relax the
-- incentive columns so the new client can omit them until D1-b drops them.
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