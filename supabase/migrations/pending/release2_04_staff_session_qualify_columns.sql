-- Release 2, migration 04 — release2_create_staff_session could not run.
-- STAGING FIRST. Repairs migration 03's rotation function in place.
--
-- ═══ WHAT WAS WRONG ═════════════════════════════════════════════════════════
-- The function `returns table (session_id uuid, store_id uuid, employee_role
-- text)`. In PL/pgSQL every OUT column is also a variable in scope for the
-- body, and the body's employee check was written unqualified:
--
--   select * into v_emp from public.employees
--    where id = p_employee and store_id = v_enr.store_id and active;
--
-- Postgres cannot tell whether `store_id` means employees.store_id or the OUT
-- column, so it raises 42702 "column reference "store_id" is ambiguous" on the
-- FIRST execution of that statement — not at CREATE time. CREATE only parses;
-- it does not resolve column references. So migration 03 applied cleanly, its
-- proacl diff looked right, and the function had never once run.
--
-- Found 2026-09-15 by probe 3d on staging (scripts/manual/staging-probes.md):
-- staff-login returned its uniform 401, both limiters had ADMITTED the attempt
-- (auth_attempts incremented), the employee row existed and was active, and
-- staff_sessions stayed EMPTY. The postgres log carried the 42702 twice, once
-- per admitted attempt. The handler's `if (rotErr) return authFailed()` made a
-- broken function indistinguishable from a wrong PIN from outside.
--
-- ═══ THE FIX ════════════════════════════════════════════════════════════════
-- Every table reference in the body now carries an alias and every column is
-- qualified through it. `employee_role` is an OUT column too and would collide
-- the moment any statement referenced employees.role or staff_sessions.
-- employee_role unqualified, so the rule is applied to the whole body rather
-- than to the one line that failed. The signature, the return type, the ACL
-- and the behaviour are unchanged; CREATE OR REPLACE keeps proacl and the
-- comment as they are, and both are re-issued anyway so this file stands alone.
--
-- ═══ PROCESS GAP THIS CLOSES ════════════════════════════════════════════════
-- The 03 rehearsal diffed proacl and never called the function with a real
-- enrollment and employee. A function that compiles is not a function that
-- runs. supabase/rehearsals/release2_04_rehearsal.sql calls this one end to
-- end (create, rotate, cross-store refusal) inside begin … rollback, and every
-- function rehearsal from here does the same (CLAUDE.md rule 4).

create or replace function public.release2_create_staff_session(
  p_enrollment  uuid,
  p_employee    uuid,
  p_token_hash  bytea,
  p_csrf_secret bytea,
  p_absolute    timestamptz,
  p_idle        timestamptz
) returns table (session_id uuid, store_id uuid, employee_role text)
language plpgsql security definer set search_path = public as $fn$
declare v_enr public.device_enrollments; v_emp public.employees; v_id uuid;
begin
  -- SERIALIZE per enrollment. Concurrent sign-ins on the same device queue
  -- here instead of interleaving revoke/insert pairs and leaving two live
  -- sessions.
  select de.* into v_enr from public.device_enrollments de
   where de.id = p_enrollment for update;
  if not found or v_enr.revoked_at is not null then
    raise exception 'enrollment not usable' using errcode = '28000';
  end if;

  -- The employee must belong to THIS enrollment's store and be active. Checked
  -- here rather than trusted from the caller, so the session cannot be created
  -- across tenants even if a handler passed the wrong pair.
  -- Qualified through the alias: `store_id` alone is ambiguous with the OUT
  -- column of the same name (42702), and so would `employee_role` be.
  select e.* into v_emp from public.employees e
   where e.id = p_employee and e.store_id = v_enr.store_id and e.active;
  if not found then
    raise exception 'employee not usable for this enrollment' using errcode = '28000';
  end if;

  update public.staff_sessions ss
     set revoked_at = now(), revoked_reason = 'rotated: new sign-in on this device'
   where ss.enrollment_id = p_enrollment and ss.revoked_at is null;

  insert into public.staff_sessions
    (enrollment_id, store_id, employee_id, employee_role, token_hash, csrf_secret,
     absolute_expires_at, idle_expires_at)
  values
    (p_enrollment, v_enr.store_id, p_employee, v_emp.role, p_token_hash, p_csrf_secret,
     p_absolute, p_idle)
  returning id into v_id;

  return query select v_id, v_enr.store_id, v_emp.role;
end
$fn$;

-- CREATE OR REPLACE preserves the ACL, but the revoke/grant is re-issued so
-- this file is complete on its own: public FIRST, then exactly service_role.
revoke execute on function public.release2_create_staff_session(uuid,uuid,bytea,bytea,timestamptz,timestamptz)
  from public, anon, authenticated, service_role;
grant  execute on function public.release2_create_staff_session(uuid,uuid,bytea,bytea,timestamptz,timestamptz)
  to service_role;

comment on function public.release2_create_staff_session(uuid,uuid,bytea,bytea,timestamptz,timestamptz) is
  'Release 2: revoke-then-create in ONE transaction, serialized per enrollment by a row '
  'lock. Two concurrent sign-ins on one device queue rather than interleaving into two '
  'live sessions. Re-checks enrollment and employee/store/active rather than trusting '
  'the caller. service_role only. Body columns are alias-qualified: the OUT columns '
  'store_id and employee_role shadow same-named table columns (42702, migration 04).';
