-- ROLLBACK for 20260728000004_phase_b_03b_employees_lockdown.sql
--
-- Paste-and-run if anything at the counter breaks after 03b. This restores
-- the PRE-03b state exactly: policy `anon_rw_employees`, ALL verbs, for
-- anon + authenticated, USING(true) / WITH CHECK(true).
--
-- Captured from pg_policies on the live project before 03b was applied:
--   tablename   = employees
--   policyname  = anon_rw_employees
--   cmd         = ALL
--   roles       = {anon,authenticated}
--   qual        = true
--   with_check  = true
--
-- WARNING: running this REOPENS the exposure — anon can again SELECT every
-- employee PIN. It is a break-glass measure to keep the counter running,
-- not a resting state. Re-apply 03b as soon as the client issue is fixed.
--
-- verify_employee_pin() from 03a is intentionally NOT dropped here: it is
-- additive, the deployed client depends on it, and leaving it in place
-- means the revert does not also break the new sign-in path.

begin;

drop policy if exists employees_admin_read   on public.employees;
drop policy if exists employees_admin_insert on public.employees;
drop policy if exists employees_admin_update on public.employees;
drop policy if exists employees_admin_delete on public.employees;

drop policy if exists anon_rw_employees on public.employees;
create policy anon_rw_employees on public.employees
  for all to anon, authenticated
  using (true)
  with check (true);

commit;

-- Post-rollback assertion (expects the original row count, e.g. 2):
--   begin;
--     set local role anon;
--     set local request.jwt.claims = '{"role":"anon"}';
--     select count(*) from public.employees;
--   rollback;
