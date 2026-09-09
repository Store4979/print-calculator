-- Phase E, migration 01 — employee roles + role-aware PIN RPC. NOT YET APPLIED.
--
-- Purely additive. Gives counter-staff PINs a role ('staff' | 'manager') so a
-- manager working under a PIN can see margin without an admin sign-in, and
-- makes verify_employee_pin return that role.
--
-- ACL NOTE (this function's grants have broken production once, 2026-08-31):
-- Postgres refuses CREATE OR REPLACE when the result type changes, so the RPC
-- is DROPped and re-CREATEd. A freshly created function carries EXECUTE for
-- PUBLIC by default, and this project's default privileges also grant it to
-- anon/authenticated/service_role. The revoke + grants below pin the exact
-- ACL the function has today, in the same aclitem order:
-- {postgres, service_role, anon, authenticated}. DROP
-- also discards the function comment, so it is re-issued. The rehearsal
-- (supabase/rehearsals/phase_e_01_rehearsal.sql) diffs proacl before/after
-- and requires them identical.

-- 1. The role column. Existing rows take the default.
alter table public.employees
  add column role text not null default 'staff'
  constraint employees_role_check check (role in ('staff','manager'));

-- 2. The RPC returns role alongside id/name/active. Still never the pin.
drop function public.verify_employee_pin(uuid, text);
create function public.verify_employee_pin(p_store_id uuid, p_pin text)
returns table(id uuid, name text, active boolean, role text)
language sql stable security definer
set search_path = public
as $$
  select e.id, e.name, e.active, e.role
  from public.employees e
  where e.store_id = p_store_id
    and e.pin      = p_pin
    and e.active
  limit 1;
$$;
-- Default privileges pre-grant anon/authenticated/service_role at CREATE time;
-- clear all of them and re-issue in the original order so proacl is
-- byte-identical to the pre-migration value, not merely the same set.
revoke execute on function public.verify_employee_pin(uuid, text) from public, anon, authenticated, service_role;
grant  execute on function public.verify_employee_pin(uuid, text) to service_role;
grant  execute on function public.verify_employee_pin(uuid, text) to anon, authenticated;
comment on function public.verify_employee_pin(uuid, text) is
  'Store-scoped counter-staff PIN check. SECURITY DEFINER so the employees table can stay closed to anon. '
  'Returns id/name/active/role only, never the pin. Phase E: role drives margin visibility (a manager PIN sees margin at the counter). '
  'IS CALLED BY THE APP: src/lib/supabase.js findEmployeeByPin() -> EmployeeLogin (staff sign-in) and the kiosk exit dialog. '
  'Do not revoke EXECUTE from anon/authenticated without replacing the client call path. '
  'KNOWN RISK, BETA BLOCKER (Phase S1): a 4-digit PIN behind an anon-callable RPC is 10k-guess brute-forceable. '
  'Accepted short-term (single tenant, physical counter). Before the first external tenant: move verification into a '
  'rate-limited Netlify function using service_role and revoke these grants.';

-- 3. The owner works the counter under this PIN and confirmed (2026-09-09)
--    it should see margin. Jordan Breecher stays 'staff' via the default.
update public.employees
   set role = 'manager'
 where id = '083d6664-201d-402e-af79-4f4ba88ba251';

-- 4. Only a store OWNER may assign roles, enforced at the table so the client
--    gate is not the only gate. The RLS update policy lets managers edit
--    employees (name/PIN/active) and that stays; this guards the role column
--    alone. NOT security definer on purpose: current_user must be the caller.
--    postgres (SQL editor, migrations) and service_role (server functions) pass.
create function public.employees_role_owner_only()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and new.role is not distinct from old.role then
    return new;
  end if;
  if tg_op = 'INSERT' and new.role = 'staff' then
    return new;
  end if;
  if current_user in ('postgres', 'service_role') then
    return new;
  end if;
  if public.has_store_role(new.store_id, array['owner']) then
    return new;
  end if;
  raise exception 'Only a store owner can assign employee roles'
    using errcode = '42501';
end;
$$;
-- Trigger functions cannot be called directly, but the project's default
-- privileges would still list anon/authenticated on it. Keep it clean.
revoke execute on function public.employees_role_owner_only() from public, anon, authenticated;
create trigger employees_role_owner_only
  before insert or update of role on public.employees
  for each row execute function public.employees_role_owner_only();
