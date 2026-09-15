-- RELEASE 2 / 04 REHEARSAL. STAGING ONLY (lboajqihpsfrokqvjgnl). The migration
-- body verbatim, then proofs that CALL THE FUNCTION with real rows, in ONE
-- transaction that ends in ROLLBACK. Nothing persists.
--
-- Why the calls: migration 03 rehearsed proacl and never executed the
-- function. PL/pgSQL resolves column references at first execution, not at
-- CREATE, so a body that is ambiguous (42702) applies cleanly and fails only
-- in production traffic. Every function rehearsal from here calls the function
-- end to end with the rows it will really see.
--
-- Fixtures come from scripts/staging-seed.sql plus one live enrollment:
--   enrollment  — the newest unrevoked device_enrollments row for T1
--                 (label 'Counter A', probe 3a)
--   T1 Staff    — employees row, PIN 1102, store …0a1
--   T2 Staff    — employees row, PIN 2202, store …0a2 (cross-store refusal)
begin;
create temp table proof(n int, step text, outcome text) on commit drop;
create temp table fn_before on commit drop as
  select proacl::text as acl, prosecdef, proconfig::text as cfg,
         obj_description(oid, 'pg_proc') as cmt, pg_get_function_result(oid) as ret
  from pg_proc where proname = 'release2_create_staff_session' and pronamespace = 'public'::regnamespace;

-- P0 the BUG, reproduced before the body runs: the shipped 03 function raises
-- 42702 on a real enrollment + employee. Rolled back by the savepoint.
do $$
declare v_enr uuid; v_emp uuid; r record;
begin
  select de.id into v_enr from public.device_enrollments de
   where de.store_id = '5ee41000-0000-4000-8000-0000000000a1' and de.revoked_at is null
   order by de.created_at desc limit 1;
  select e.id into v_emp from public.employees e where e.pin = '1102' and e.store_id = '5ee41000-0000-4000-8000-0000000000a1';
  begin
    select * into r from public.release2_create_staff_session(
      v_enr, v_emp, '\x01'::bytea, '\x02'::bytea, now() + interval '12 hours', now() + interval '1 hour');
    insert into proof values (0, 'P0 pre-fix call (expect 42702 ambiguous)', 'UNEXPECTED: ran, session_id=' || r.session_id);
  exception when others then
    insert into proof values (0, 'P0 pre-fix call (expect 42702 ambiguous)', '[' || sqlstate || '] ' || sqlerrm);
  end;
end $$;

-- ===================== 1. 04 body (verbatim) =====================
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

-- ===================== 2. proofs =====================
-- P1 ACL / secdef / search_path / return type unchanged; comment updated.
insert into proof
select 1, 'P1 proacl before -> after (expect identical, postgres+service_role) ; secdef ; cfg ; returns ; comment mentions 04',
  (select acl from fn_before) || '  ->  ' || p.proacl::text
  || ' ; identical=' || ((select acl from fn_before) = p.proacl::text)::text
  || ' ; secdef=' || p.prosecdef || ' ; cfg=' || p.proconfig::text
  || ' ; returns_same=' || ((select ret from fn_before) = pg_get_function_result(p.oid))::text
  || ' ; comment_04=' || (obj_description(p.oid,'pg_proc') like '%migration 04%')::text
from pg_proc p where p.proname = 'release2_create_staff_session' and p.pronamespace = 'public'::regnamespace;

-- P2..P5 END-TO-END CALLS with real rows.
do $$
declare v_enr uuid; v_store uuid; v_emp uuid; v_t2 uuid; r record; r2 record;
        n_live int; n_revoked int; v_reason text;
begin
  select de.id, de.store_id into v_enr, v_store from public.device_enrollments de
   where de.store_id = '5ee41000-0000-4000-8000-0000000000a1' and de.revoked_at is null
   order by de.created_at desc limit 1;
  select e.id into v_emp from public.employees e where e.pin = '1102' and e.store_id = '5ee41000-0000-4000-8000-0000000000a1';
  select e.id into v_t2  from public.employees e where e.pin = '2202' and e.store_id = '5ee41000-0000-4000-8000-0000000000a2';
  if v_enr is null or v_emp is null or v_t2 is null then
    insert into proof values (2, 'P2 fixtures', 'MISSING: enr=' || coalesce(v_enr::text,'null') || ' emp=' || coalesce(v_emp::text,'null') || ' t2=' || coalesce(v_t2::text,'null'));
    return;
  end if;

  -- P2 first sign-in creates ONE live session, role from the employees row.
  select * into r from public.release2_create_staff_session(
    v_enr, v_emp, '\x01'::bytea, '\x02'::bytea, now() + interval '12 hours', now() + interval '1 hour');
  select count(*) filter (where ss.revoked_at is null), count(*) filter (where ss.revoked_at is not null)
    into n_live, n_revoked from public.staff_sessions ss where ss.enrollment_id = v_enr;
  insert into proof values (2, 'P2 create (expect session_id, store …0a1, role=staff, live=1, revoked=0)',
    'session_id=' || r.session_id || ' store=' || r.store_id || ' role=' || r.employee_role
    || ' store_matches_enrollment=' || (r.store_id = v_store)::text
    || ' live=' || n_live || ' revoked=' || n_revoked);

  -- P3 second sign-in ROTATES: the first is revoked with the reason, exactly one live.
  select * into r2 from public.release2_create_staff_session(
    v_enr, v_emp, '\x03'::bytea, '\x04'::bytea, now() + interval '12 hours', now() + interval '1 hour');
  select count(*) filter (where ss.revoked_at is null), count(*) filter (where ss.revoked_at is not null)
    into n_live, n_revoked from public.staff_sessions ss where ss.enrollment_id = v_enr;
  select ss.revoked_reason into v_reason from public.staff_sessions ss where ss.id = r.session_id;
  insert into proof values (3, 'P3 rotate (expect new id, live=1, revoked=1, first has reason)',
    'new_id_differs=' || (r2.session_id <> r.session_id)::text
    || ' live=' || n_live || ' revoked=' || n_revoked || ' reason=' || coalesce(v_reason,'NULL'));

  -- P4 cross-store employee (T2 Staff on a T1 enrollment) must be refused with 28000.
  begin
    select * into r from public.release2_create_staff_session(
      v_enr, v_t2, '\x05'::bytea, '\x06'::bytea, now() + interval '12 hours', now() + interval '1 hour');
    insert into proof values (4, 'P4 cross-store employee (expect 28000)', 'UNEXPECTED: created ' || r.session_id);
  exception when others then
    insert into proof values (4, 'P4 cross-store employee (expect 28000)', '[' || sqlstate || '] ' || sqlerrm);
  end;

  -- P5 unknown enrollment must be refused with 28000.
  begin
    select * into r from public.release2_create_staff_session(
      '00000000-0000-0000-0000-000000000000', v_emp, '\x07'::bytea, '\x08'::bytea, now() + interval '12 hours', now() + interval '1 hour');
    insert into proof values (5, 'P5 unknown enrollment (expect 28000)', 'UNEXPECTED: created ' || r.session_id);
  exception when others then
    insert into proof values (5, 'P5 unknown enrollment (expect 28000)', '[' || sqlstate || '] ' || sqlerrm);
  end;
exception when others then
  insert into proof values (9, 'P2-P5 end-to-end', 'FAILED: [' || sqlstate || '] ' || sqlerrm);
end $$;

-- P6 the OUT-column hazard, stated as a proof: no unqualified reference to
-- either OUT column name remains in the body.
insert into proof
select 6, 'P6 body has no unqualified " store_id =" / " employee_role =" reference (expect 0 ; 0)',
  (select count(*) from regexp_matches(p.prosrc, '[^.\w]store_id\s*=', 'g'))::text || ' ; '
  || (select count(*) from regexp_matches(p.prosrc, '[^.\w]employee_role\s*=', 'g'))::text
from pg_proc p where p.proname = 'release2_create_staff_session' and p.pronamespace = 'public'::regnamespace;

select n, step, outcome from proof order by n;
rollback;
