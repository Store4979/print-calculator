-- Phase B, migration 3b — POLICY TIGHTENING.
--
-- STATUS: APPLIED 2026-07-29 to project gmxyisjjaxtpycsmmzef.
-- (The pre-apply header said DO NOT APPLY; that gate has been satisfied and
-- is recorded below so the sequencing rationale is not lost.)
--
-- The gate that had to be satisfied first: the previously-deployed client
-- read public.employees directly, so applying this before the 03a client
-- shipped would have broken staff sign-in instantly, mid-shift. Released in
-- order — 03a RPC applied, client merged as efc9437 and deployed, then staff
-- PIN login + kiosk exit + admin sign-in confirmed on production — and only
-- then was this applied.
--
-- Closed the live exposure: policy `anon_rw_employees` was ALL / USING(true)
-- / WITH CHECK(true) for anon, so the client-side anon key could SELECT
-- every employee PIN in production, and INSERT/UPDATE/DELETE freely.
--
-- VERIFICATION, before -> after (anon role, request.jwt.claims role=anon):
--   anon SELECT employees ................ 2 rows  ->  0 rows   (exposure closed)
--   anon verify_employee_pin, correct PIN .   n/a   ->  1 row    (sign-in intact)
--   anon verify_employee_pin, wrong PIN ...   n/a   ->  0 rows
--   admin SELECT employees ............... 2 rows  ->  2 rows   (unaffected)
--   admin UPDATE reachable ...............   n/a   ->  2 rows   (edit/deactivate OK)
--
-- TEST ARTIFACT — do not re-derive this as a real failure. The first
-- post-apply verification appeared to show verify_employee_pin returning 0
-- rows for a correct PIN, i.e. staff sign-in broken. It was a flaw in the
-- test, not the system: the helper subquery that fetched a PIN to test with
--   (select pin from public.employees limit 1)
-- was evaluated AFTER `set local role anon`, and anon can no longer read the
-- table, so it passed a NULL pin and the RPC correctly matched nothing.
-- Capturing the PIN BEFORE dropping privileges returns 1 row. That mirrors
-- production, where the PIN comes from the staffer's keypad and never from a
-- table read. Any future test of this RPC must capture its inputs while
-- still privileged.
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
