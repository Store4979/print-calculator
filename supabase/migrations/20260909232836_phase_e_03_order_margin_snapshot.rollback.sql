-- ROLLBACK for 20260909232836_phase_e_03_order_margin_snapshot.sql
-- Drops the two snapshot columns. A client deployed on Phase E sends them in
-- its insert; after this rollback that insert FAILS on an unknown column and
-- the row is queued — so roll the client back first (or accept queued rows
-- until it is), exactly the D1-b ordering in reverse.
begin;
alter table public.orders drop column cost_subtotal, drop column margin_pct;
commit;
