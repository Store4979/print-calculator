-- ROLLBACK for phase_e_02_cost_model (version assigned at apply time).
-- Drops the decomposition columns and the pricing mode. base_cost_* and
-- price_* were never modified by E-02, so nothing needs restoring. A client
-- deployed on Phase E treats missing paper_cost/click_* as "not decomposed"
-- and falls back to base_cost_*.
begin;
alter table public.paper_types  drop column pricing_mode;
alter table public.sheet_prices drop column paper_cost, drop column click_color, drop column click_bw;
commit;
