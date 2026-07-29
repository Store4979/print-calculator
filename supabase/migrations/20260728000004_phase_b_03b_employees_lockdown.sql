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
--   * has_store_role actually returns TRUE for the production admin — not
--     merely "admin requires a JWT". Asserted under the real auth.uid() in a
--     rolled-back transaction:
--         auth.uid() resolves                                => true
--         has_store_role(store4979,{owner,manager})          => TRUE
--         employees visible under this policy's predicate    => 2
--     so employee management keeps working rather than silently emptying.
--
-- OUTSTANDING PRE-FLIGHT (must be confirmed on production before applying):
--   auth.users.last_sign_in_at for bigtex989@gmail.com is NULL — that
--   account has never completed a Supabase Auth sign-in. The membership is
--   correct, so has_store_role is not the risk; obtaining a session is. If
--   admin sign-in does not actually work in production, employee management
--   becomes unreachable after this migration. VERIFY ADMIN SIGN-IN FIRST.
--
-- VERB COVERAGE: the policy being dropped (anon_rw_employees) is ALL, i.e.
-- it permits SELECT + INSERT + UPDATE + DELETE. The replacements below must
-- therefore cover all four, or editing/deactivating an employee starts
-- failing after this migration in a way a "does the list load?" check would
-- never surface. Proven by applying this migration inside a rolled-back
-- transaction and exercising every verb as both roles:
--
--   actor  verb                  outcome
--   ------ --------------------- ---------------------
--   anon   SELECT                rows=0
--   anon   INSERT                DENIED 42501
--   anon   UPDATE                rows_affected=0
--   anon   DELETE                rows_affected=0
--   admin  SELECT                rows=2
--   admin  INSERT                ALLOWED
--   admin  UPDATE (deactivate)   rows_affected=1
--   admin  DELETE                rows_affected=1
--
-- Note the asymmetry: anon INSERT raises 42501, but anon UPDATE/DELETE
-- silently affect 0 rows — RLS filters rather than errors on those verbs.
-- That is the desired direction here (anon no-ops), but it is exactly why
-- verb coverage had to be proven behaviourally, not just structurally.
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
