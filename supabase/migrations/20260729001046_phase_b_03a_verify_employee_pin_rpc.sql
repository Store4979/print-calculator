-- Phase B, migration 3a — ADDITIVE ONLY (no policy changes).
-- Creates the store-scoped PIN check so the client can migrate OFF direct
-- table reads BEFORE the employees policies are tightened in 03b. Applying
-- 03b first would break staff PIN login on the currently-deployed client.
--
-- Returns id/name/active ONLY. The pin column is never selected, never
-- returned, and no select * appears anywhere in this function.
-- NOTE: public.employees has no `role` column (role lives on memberships,
-- which is the owner/manager surface, not the counter-staff surface), so
-- the projection is id/name/active.

create or replace function public.verify_employee_pin(p_store_id uuid, p_pin text)
returns table (id uuid, name text, active boolean)
language sql
stable
security definer
set search_path = public
as $$
  select e.id, e.name, e.active
  from public.employees e
  where e.store_id = p_store_id
    and e.pin      = p_pin
    and e.active
  limit 1;
$$;

-- Least privilege: nothing broader than anon + authenticated.
revoke all on function public.verify_employee_pin(uuid, text) from public;
revoke all on function public.verify_employee_pin(uuid, text) from anon, authenticated;
grant execute on function public.verify_employee_pin(uuid, text) to anon;
grant execute on function public.verify_employee_pin(uuid, text) to authenticated;

comment on function public.verify_employee_pin(uuid, text) is
  'Store-scoped counter-staff PIN check. SECURITY DEFINER so the employees '
  'table can stay closed to anon. Returns id/name/active only — never the '
  'pin. RESIDUAL RISK: a 4-digit PIN is 10k-guess brute-forceable through '
  'this RPC. Strictly better than the prior anon SELECT of every PIN, but '
  'it is a BETA BLOCKER: before the first external tenant this must require '
  'the store-scoped token (Phase B section 1) or move behind a rate-limited '
  'Netlify function.';