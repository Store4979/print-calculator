-- Phase B, migration 3b — POLICY TIGHTENING.
-- Applied only after the 03a client shipped to production and staff PIN
-- login, kiosk exit, and admin sign-in were all confirmed working there.
--
-- Closes the live exposure: anon_rw_employees was ALL / USING(true) /
-- WITH CHECK(true), so the client-side anon key could SELECT every employee
-- PIN and write the table freely. After this, anon has no access at all; the
-- only anon path to a PIN check is verify_employee_pin() from 03a, which
-- returns id/name/active and never the pin.
--
-- Verb coverage proven behaviourally in a rolled-back transaction:
--   anon   SELECT rows=0 | INSERT DENIED 42501 | UPDATE 0 rows | DELETE 0 rows
--   admin  SELECT rows=2 | INSERT ALLOWED      | UPDATE 1 row  | DELETE 1 row
--
-- ROLLBACK: 20260728000004_phase_b_03b_employees_lockdown.rollback.sql

drop policy if exists anon_rw_employees on public.employees;

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