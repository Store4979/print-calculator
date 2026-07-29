-- Phase B, migration 3b — POLICY TIGHTENING. DO NOT APPLY until the 03a
-- client is deployed AND staff PIN login + kiosk exit are confirmed working
-- on production. The previously-deployed client reads public.employees
-- directly; applying this first breaks staff sign-in instantly, mid-shift.
--
-- Closes the live exposure: policy `anon_rw_employees` is ALL / USING(true)
-- / WITH CHECK(true) for anon, so the client-side anon key can currently
-- SELECT every employee PIN in production, and INSERT/UPDATE/DELETE freely.
--
-- After this, anon has NO access to employees at all. The only anon path to
-- a PIN check is verify_employee_pin() from 03a, which returns id/name/
-- active and never the pin.
--
-- Admin surface verified safe beforehand:
--   * handleAdminClick returns early to AdminLogin whenever
--     isSupabaseConfigured, so the offline password CANNOT unlock admin in
--     production — every production admin session carries a real JWT.
--   * syncRole() sets isAdmin=false when the session goes null, so an
--     expired JWT re-locks the UI instead of leaving it unlocked.
--   * Nothing joins employees for display names: CommissionDashboard reads
--     tx.employee_id / tx.employee_name, both denormalized onto
--     transactions. No blank-name failure mode.
--
-- ROLLBACK: see 20260728000004_phase_b_03b_employees_lockdown.rollback.sql
-- (restores anon_rw_employees exactly as it exists today).

begin;

-- The blanket anon policy that is the actual exposure.
drop policy if exists anon_rw_employees on public.employees;

-- Owner/manager only, scoped to their own store, for every verb.
drop policy if exists employees_admin_read   on public.employees;
create policy employees_admin_read on public.employees
  for select to authenticated
  using (has_store_role(store_id, array['owner','manager']));

drop policy if exists employees_admin_insert on public.employees;
create policy employees_admin_insert on public.employees
  for insert to authenticated
  with check (has_store_role(store_id, array['owner','manager']));

drop policy if exists employees_admin_update on public.employees;
create policy employees_admin_update on public.employees
  for update to authenticated
  using (has_store_role(store_id, array['owner','manager']))
  with check (has_store_role(store_id, array['owner','manager']));

drop policy if exists employees_admin_delete on public.employees;
create policy employees_admin_delete on public.employees
  for delete to authenticated
  using (has_store_role(store_id, array['owner','manager']));

commit;

-- Post-apply assertion (run separately, expects 0):
--   begin;
--     set local role anon;
--     set local request.jwt.claims = '{"role":"anon"}';
--     select count(*) as must_be_zero from public.employees;
--   rollback;
