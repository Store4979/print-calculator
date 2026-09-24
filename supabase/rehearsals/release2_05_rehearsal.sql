-- RELEASE 2 / 05 REHEARSAL. STAGING ONLY (lboajqihpsfrokqvjgnl). The migration
-- body verbatim, then proofs that CALL THE FUNCTION with real rows, in ONE
-- transaction that ends in ROLLBACK. Nothing persists.
--
-- Fixtures: the newest unrevoked T1 enrollment (Counter C) HOLDING A LIVE
-- STAFF SESSION — sign one in before running, or P1 proves the cascade on an
-- empty set; the four staging Auth users by email.
begin;
create temp table proof(n int, step text, outcome text) on commit drop;

-- P0a: ACL at CREATE time, captured by creating the function and reading
-- proacl BEFORE the revoke/grant lines run. Demonstrates the PUBLIC grant the
-- revoke list exists to remove.
create function public.release2_revoke_enrollment(
  p_enrollment uuid,
  p_owner      uuid,
  p_reason     text default null
) returns table (o_enrollment_id uuid, o_store_id uuid, o_sessions_revoked int)
language plpgsql security definer set search_path = public as $fn$
declare
  v_enr    public.device_enrollments;
  v_reason text;
  v_n      int := 0;
begin
  if p_enrollment is null or p_owner is null then
    raise exception 'enrollment and owner required' using errcode = '22023';
  end if;
  if p_reason is not null and (length(p_reason) > 200 or p_reason !~ '^[[:print:]]*$') then
    raise exception 'reason must be at most 200 printable characters' using errcode = '22023';
  end if;
  v_reason := coalesce(nullif(btrim(p_reason), ''), 'owner revoked device');

  select de.* into v_enr from public.device_enrollments de
   where de.id = p_enrollment for update;

  if not found
     or not exists (
       select 1 from public.memberships m
        where m.user_id = p_owner and m.store_id = v_enr.store_id and m.role = 'owner')
  then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  if v_enr.revoked_at is not null then
    return query select v_enr.id, v_enr.store_id, 0;
    return;
  end if;

  update public.device_enrollments de
     set revoked_at = now(), revoked_by = p_owner, revoked_reason = v_reason
   where de.id = p_enrollment;

  update public.staff_sessions ss
     set revoked_at = now(), revoked_reason = 'device revoked: ' || v_reason
   where ss.enrollment_id = p_enrollment and ss.revoked_at is null;
  get diagnostics v_n = row_count;

  return query select v_enr.id, v_enr.store_id, v_n;
end
$fn$;

insert into proof
select 0, 'P0a proacl at CREATE (expect a leading =X/postgres = PUBLIC)', coalesce(p.proacl::text, 'NULL(=PUBLIC)')
from pg_proc p where p.proname = 'release2_revoke_enrollment' and p.pronamespace = 'public'::regnamespace;

revoke execute on function public.release2_revoke_enrollment(uuid,uuid,text)
  from public, anon, authenticated, service_role;
grant  execute on function public.release2_revoke_enrollment(uuid,uuid,text)
  to service_role;

comment on function public.release2_revoke_enrollment(uuid,uuid,text) is
  'Release 2: owner revokes a device enrollment and cascades to every live session on it, '
  'in one transaction under a row lock. p_owner is TRUSTED — service_role only; the sole '
  'caller derives it from auth.getUser(). Unknown, wrong-store and non-owner all raise the '
  'same 42501 before any write and before the idempotent already-revoked return. Reason is '
  'bounded to 200 printable chars and copied into the cascade as "device revoked: <reason>".';

insert into proof
select 1, 'P0b proacl after revoke/grant (expect {postgres, service_role}) ; secdef ; cfg ; comment',
  p.proacl::text || ' ; secdef=' || p.prosecdef || ' ; cfg=' || p.proconfig::text
  || ' ; comment_ok=' || (obj_description(p.oid,'pg_proc') like '%p_owner is TRUSTED%')::text
from pg_proc p where p.proname = 'release2_revoke_enrollment' and p.pronamespace = 'public'::regnamespace;

-- ===================== end-to-end calls =====================
do $$
declare
  v_enr uuid; v_store uuid; v_before timestamptz;
  v_o1 uuid; v_o2 uuid; v_m1 uuid;
  r record; n_live_before int; n_live_after int; v_sess_reason text; v_enr_reason text; v_by uuid;
  v_unknown uuid := '00000000-0000-0000-0000-000000000000';
  msg_o2 text; msg_m1 text; msg_unk text; msg_o2_rev text; msg_m1_rev text;
  v_rev_at timestamptz; v_rev_by uuid;
begin
  select u.id into v_o1 from auth.users u where lower(u.email) = 'owner-t1@example.invalid';
  select u.id into v_o2 from auth.users u where lower(u.email) = 'owner-t2@example.invalid';
  select u.id into v_m1 from auth.users u where lower(u.email) = 'manager-t1@example.invalid';
  select de.id, de.store_id into v_enr, v_store from public.device_enrollments de
   where de.store_id = '5ee41000-0000-4000-8000-0000000000a1' and de.revoked_at is null
   order by de.created_at desc limit 1;
  if v_enr is null or v_o1 is null or v_o2 is null or v_m1 is null then
    insert into proof values (2, 'fixtures', 'MISSING: enr=' || coalesce(v_enr::text,'null') || ' o1=' || coalesce(v_o1::text,'null') || ' o2=' || coalesce(v_o2::text,'null') || ' m1=' || coalesce(v_m1::text,'null'));
    return;
  end if;
  select count(*) into n_live_before from public.staff_sessions ss where ss.enrollment_id = v_enr and ss.revoked_at is null;

  -- P2 owner-t2 on a LIVE T1 enrollment: 42501, nothing changed.
  begin
    select * into r from public.release2_revoke_enrollment(v_enr, v_o2, 'x');
    msg_o2 := 'UNEXPECTED: ran';
  exception when others then msg_o2 := '[' || sqlstate || '] ' || sqlerrm; end;
  -- P3 manager-t1 on the same live enrollment.
  begin
    select * into r from public.release2_revoke_enrollment(v_enr, v_m1, 'x');
    msg_m1 := 'UNEXPECTED: ran';
  exception when others then msg_m1 := '[' || sqlstate || '] ' || sqlerrm; end;
  -- P4 unknown enrollment, owner-t1.
  begin
    select * into r from public.release2_revoke_enrollment(v_unknown, v_o1, 'x');
    msg_unk := 'UNEXPECTED: ran';
  exception when others then msg_unk := '[' || sqlstate || '] ' || sqlerrm; end;
  select de.revoked_at into v_before from public.device_enrollments de where de.id = v_enr;
  select count(*) into n_live_after from public.staff_sessions ss where ss.enrollment_id = v_enr and ss.revoked_at is null;
  insert into proof values (2, 'P2 owner-t2 on live T1 device (expect 42501)', msg_o2);
  insert into proof values (3, 'P3 manager-t1 on live T1 device (expect 42501, same message)', msg_m1 || ' ; same_as_P2=' || (msg_m1 = msg_o2)::text);
  insert into proof values (4, 'P4 unknown enrollment (expect 42501, same message)', msg_unk || ' ; same_as_P2=' || (msg_unk = msg_o2)::text);
  insert into proof values (5, 'P2-P4 changed nothing (expect revoked_at NULL, live count unchanged)',
    'revoked_at=' || coalesce(v_before::text,'NULL') || ' live_before=' || n_live_before || ' live_after=' || n_live_after);

  -- P6 reason bound: 201 chars and a control character are 22023.
  begin
    select * into r from public.release2_revoke_enrollment(v_enr, v_o1, repeat('a', 201));
    insert into proof values (6, 'P6 reason 201 chars (expect 22023)', 'UNEXPECTED: ran');
  exception when others then insert into proof values (6, 'P6 reason 201 chars (expect 22023)', '[' || sqlstate || '] ' || sqlerrm); end;
  begin
    select * into r from public.release2_revoke_enrollment(v_enr, v_o1, E'ok\nnot');
    insert into proof values (7, 'P7 reason with newline (expect 22023)', 'UNEXPECTED: ran');
  exception when others then insert into proof values (7, 'P7 reason with newline (expect 22023)', '[' || sqlstate || '] ' || sqlerrm); end;

  -- P1 owner-t1 revokes: cascade to the live session(s) with the device reason.
  select * into r from public.release2_revoke_enrollment(v_enr, v_o1, 'rehearsal: shared tablet');
  select de.revoked_reason, de.revoked_by into v_enr_reason, v_by from public.device_enrollments de where de.id = v_enr;
  select count(*) into n_live_after from public.staff_sessions ss where ss.enrollment_id = v_enr and ss.revoked_at is null;
  select string_agg(distinct ss.revoked_reason, ' | ') into v_sess_reason
    from public.staff_sessions ss where ss.enrollment_id = v_enr and ss.revoked_reason like 'device revoked:%';
  insert into proof values (8, 'P1 owner-t1 revokes live device (expect store …0a1, sessions_revoked = live_before, enrollment reason+by set, cascade reason names device)',
    'store=' || r.o_store_id || ' sessions_revoked=' || r.o_sessions_revoked || ' expected=' || n_live_before
    || ' live_after=' || n_live_after || ' enr_reason=' || coalesce(v_enr_reason,'NULL') || ' by_owner_t1=' || (v_by = v_o1)::text
    || ' cascade_reason=' || coalesce(v_sess_reason,'NONE'));
  insert into proof values (9, 'P1b earlier revocations keep their own reasons',
    (select string_agg(ss.revoked_reason, ' | ' order by ss.created_at) from public.staff_sessions ss where ss.enrollment_id = v_enr));

  -- P5 owner-t1 again on the now-revoked enrollment: idempotent, 0, unchanged.
  select de.revoked_at, de.revoked_by into v_rev_at, v_rev_by from public.device_enrollments de where de.id = v_enr;
  select * into r from public.release2_revoke_enrollment(v_enr, v_o1, 'second call');
  insert into proof values (10, 'P5 owner-t1 on already-revoked (expect sessions_revoked=0, timestamps/by unchanged)',
    'sessions_revoked=' || r.o_sessions_revoked || ' unchanged=' ||
    (select (de.revoked_at = v_rev_at and de.revoked_by = v_rev_by and de.revoked_reason = 'rehearsal: shared tablet')::text
       from public.device_enrollments de where de.id = v_enr));

  -- P5b BIND PRECEDES THE IDEMPOTENT RETURN: non-owners on the SAME
  -- already-revoked enrollment must still get 42501 — otherwise
  -- revoked-vs-live in another tenant is enumerable by status code.
  begin
    select * into r from public.release2_revoke_enrollment(v_enr, v_o2, 'x');
    msg_o2_rev := 'UNEXPECTED: ran';
  exception when others then msg_o2_rev := '[' || sqlstate || '] ' || sqlerrm; end;
  begin
    select * into r from public.release2_revoke_enrollment(v_enr, v_m1, 'x');
    msg_m1_rev := 'UNEXPECTED: ran';
  exception when others then msg_m1_rev := '[' || sqlstate || '] ' || sqlerrm; end;
  insert into proof values (11, 'P5b owner-t2 and manager-t1 on the already-revoked enrollment (expect 42501 both, same message as P2)',
    'o2=' || msg_o2_rev || ' ; m1=' || msg_m1_rev || ' ; identical_to_live_case=' || (msg_o2_rev = msg_o2 and msg_m1_rev = msg_o2)::text);
exception when others then
  insert into proof values (99, 'end-to-end block', 'FAILED: [' || sqlstate || '] ' || sqlerrm);
end $$;

-- P12 no unqualified OUT-name or table-column reference in the body.
insert into proof
select 12, 'P12 body has no unqualified " store_id =" / " enrollment_id =" / " revoked_at is" (expect 0 ; 0 ; 0)',
  (select count(*) from regexp_matches(p.prosrc, '[^.\w]store_id\s*=', 'g'))::text || ' ; '
  || (select count(*) from regexp_matches(p.prosrc, '[^.\w]enrollment_id\s*=', 'g'))::text || ' ; '
  || (select count(*) from regexp_matches(p.prosrc, '[^.\w]revoked_at\s+is', 'g'))::text
from pg_proc p where p.proname = 'release2_revoke_enrollment' and p.pronamespace = 'public'::regnamespace;

select n, step, outcome from proof order by n;
rollback;
