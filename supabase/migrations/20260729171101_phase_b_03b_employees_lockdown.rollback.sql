-- ROLLBACK for 20260729171101_phase_b_03b_employees_lockdown.sql
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
--
-- ============================================================
-- READ THIS BEFORE RELYING ON THIS FILE AS A SIGN-IN FIX
-- ============================================================
-- This rollback restores TABLE ACCESS. It does NOT restore the old sign-in
-- path, because the client no longer uses it.
--
-- Since efc9437 the deployed client calls verify_employee_pin() via RPC. It
-- does NOT run `from("employees").select(...).eq("pin", ...)` anymore. So:
--
--   * If the problem is RLS on the employees TABLE (admin employee list or
--     add/edit/deactivate failing) — this file fixes it.
--
--   * If the problem is the RPC ITSELF (dropped, renamed, permissions
--     revoked, signature changed, returning wrong rows) — this file fixes
--     NOTHING. Staff sign-in stays broken, because restoring
--     anon_rw_employees just reopens a table the client never reads.
--     (Exactly what happened 2026-08-31 -> 2026-09-09: EXECUTE was revoked
--     on the RPC; see 20260909160307.)
--
-- A full revert of the PIN path therefore requires BOTH:
--   1. this file (or leaving 03b in place, which is fine on its own), AND
--   2. reverting the client to a build that reads the employees table
--      directly — i.e. main before efc9437 — and redeploying.
--
-- If sign-in is down and the cause is unclear, check the RPC first:
--   select count(*) from public.verify_employee_pin(
--     (select id from public.stores where slug='store4979'), '<a real pin>');
-- Capture that pin while still privileged — running the subquery as anon
-- passes NULL and produces a false failure (see the README ledger row).

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
