-- ROLLBACK for phase_e_01_employee_roles (version assigned at apply time).
-- Restores the pre-Phase-E state: no role column, RPC returns id/name/active,
-- same ACL and comment as 20260909160307 left them. The client deployed on
-- Phase E reads `role` from the RPC and treats a missing value as 'staff', so
-- this rollback does not break sign-in; it only hides margin from PINs.
begin;

drop trigger if exists employees_role_owner_only on public.employees;
drop function if exists public.employees_role_owner_only();

drop function public.verify_employee_pin(uuid, text);
create function public.verify_employee_pin(p_store_id uuid, p_pin text)
returns table(id uuid, name text, active boolean)
language sql stable security definer
set search_path = public
as $$
  select e.id, e.name, e.active
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
  'Returns id/name/active only, never the pin. IS CALLED BY THE APP: src/lib/supabase.js findEmployeeByPin() -> '
  'EmployeeLogin (staff sign-in) and the kiosk exit dialog. Do not revoke EXECUTE from anon/authenticated without '
  'replacing the client call path. KNOWN RISK, BETA BLOCKER: a 4-digit PIN behind an anon-callable RPC is 10k-guess '
  'brute-forceable. Accepted short-term (single tenant, physical counter). Before the first external tenant: move '
  'verification into a rate-limited Netlify function using service_role and revoke these grants.';

alter table public.employees drop column role;

commit;
