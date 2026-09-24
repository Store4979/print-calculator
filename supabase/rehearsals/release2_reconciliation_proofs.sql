-- STAGING ONLY. Release 2 reconciliation proofs: CALL every Release 2 function
-- with real rows (CLAUDE.md rule 4). Contains NO create/replace/drop: it runs
-- (a) inside the combined rehearsal, after the committed 01–05 are applied in
-- the same transaction, and (b) after the real apply, on its own. The caller
-- wraps it in BEGIN … ROLLBACK; it creates only rows, all inside that
-- transaction.
--
-- Fixtures from scripts/staging-seed.sql: T1 store …0a1 with an owner and a
-- manager membership and staff PIN 1102; T2 store …0a2 with an owner and staff
-- PIN 2202. Owner identity is simulated for has_store_role() by setting
-- request.jwt.claims locally, which is what auth.uid() reads.
create temp table if not exists proof(n text, step text, outcome text) on commit drop;

-- ── A. catalog: ACLs, RLS, grants, the employees constraint ───────────────
insert into proof
select 'A1', 'ACL ' || p.oid::regprocedure::text,
       coalesce(p.proacl::text, 'NULL')
       || case when p.proacl::text ~ '(^\{|,)=X' then '  <<< PUBLIC HOLDS EXECUTE' else '' end
       || case when p.proacl::text ~ 'anon=' then '  <<< ANON HOLDS EXECUTE' else '' end
       || case when p.proacl::text ~ 'authenticated=' and p.proname <> 'release2_clear_lockout' then '  <<< AUTHENTICATED HOLDS EXECUTE' else '' end
       || ' ; secdef=' || p.prosecdef || ' ; cfg=' || coalesce(p.proconfig::text, 'NULL')
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and (p.proname like 'release2\_%' or p.proname = 'redeem_enrollment_ticket');

insert into proof
select 'A2', 'table ' || c.relname,
       'rls=' || c.relrowsecurity || ' ; policies=' || (select count(*) from pg_policy where polrelid = c.oid)
       || ' ; acl=' || coalesce(c.relacl::text, 'NULL')
       || case when c.relacl::text ~ '(anon|authenticated)=' then '  <<< CLIENT ROLE HOLDS A GRANT' else '' end
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('device_enrollments','enrollment_tickets','staff_sessions','upload_capabilities','upload_capability_files','auth_attempts');

insert into proof
select 'A3', 'employees_id_store_uniq', coalesce((select pg_get_constraintdef(oid) from pg_constraint
  where conrelid = 'public.employees'::regclass and conname = 'employees_id_store_uniq'), 'MISSING');

-- ── B. end-to-end calls ────────────────────────────────────────────────────
do $$
declare
  t1 constant uuid := '5ee41000-0000-4000-8000-0000000000a1';
  t2 constant uuid := '5ee41000-0000-4000-8000-0000000000a2';
  own1 uuid; own2 uuid; mgr1 uuid; emp1 uuid; emp2 uuid;
  enr uuid; r record; r2 record; n int; v text; tk bytea := extensions.gen_random_bytes(32);
begin
  select m.user_id into own1 from public.memberships m where m.store_id = t1 and m.role = 'owner' limit 1;
  select m.user_id into own2 from public.memberships m where m.store_id = t2 and m.role = 'owner' limit 1;
  select m.user_id into mgr1 from public.memberships m where m.store_id = t1 and m.role = 'manager' limit 1;
  select e.id into emp1 from public.employees e where e.store_id = t1 and e.pin = '1102';
  select e.id into emp2 from public.employees e where e.store_id = t2 and e.pin = '2202';
  if own1 is null or own2 is null or emp1 is null or emp2 is null then
    insert into proof values ('B0', 'fixtures', 'MISSING own1/own2/emp1/emp2 — run scripts/staging-seed.sql'); return;
  end if;

  -- B1 redeem: fresh ticket → enrollment; replay → 28000; expired → 28000.
  insert into public.enrollment_tickets (store_id, ticket_hash, created_by, expires_at)
  values (t1, extensions.digest(tk, 'sha256'), own1, now() + interval '15 minutes');
  select * into r from public.redeem_enrollment_ticket(extensions.digest(tk, 'sha256'), extensions.gen_random_bytes(32), extensions.gen_random_bytes(32), 'reconciliation probe');
  enr := r.enrollment_id;
  insert into proof values ('B1', 'redeem (expect enrollment, store …0a1)', 'enrollment=' || enr || ' store=' || r.store_id);
  begin
    perform public.redeem_enrollment_ticket(extensions.digest(tk, 'sha256'), extensions.gen_random_bytes(32), extensions.gen_random_bytes(32), 'replay');
    insert into proof values ('B2', 'replay (expect 28000)', 'UNEXPECTED: redeemed twice');
  exception when others then insert into proof values ('B2', 'replay (expect 28000)', '[' || sqlstate || '] ' || sqlerrm); end;
  insert into public.enrollment_tickets (store_id, ticket_hash, created_by, expires_at)
  values (t1, extensions.digest('expired-' || enr::text, 'sha256'), own1, now() - interval '1 minute');
  begin
    perform public.redeem_enrollment_ticket(extensions.digest('expired-' || enr::text, 'sha256'), extensions.gen_random_bytes(32), extensions.gen_random_bytes(32), 'expired');
    insert into proof values ('B3', 'expired ticket (expect 28000)', 'UNEXPECTED: redeemed');
  exception when others then insert into proof values ('B3', 'expired ticket (expect 28000)', '[' || sqlstate || '] ' || sqlerrm); end;

  -- B4 limiter: quota 2 admitted, the third refused, cooldown set.
  v := '';
  for i in 1..3 loop
    select * into r2 from public.release2_record_attempt('pin', 'enr:' || enr, 60, 2, 60);
    v := v || r2.allowed::text || '/' || r2.attempts || ' ';
  end loop;
  insert into proof values ('B4', 'record_attempt x3, quota 2 (expect true/1 true/2 false/3)', v);

  -- B5 clear_lockout as the T1 owner; wrong store and unknown subject refuse identically.
  perform set_config('request.jwt.claims', json_build_object('sub', own1)::text, true);
  select public.release2_clear_lockout('pin', 'enr', enr, t1) into n;
  insert into proof values ('B5', 'clear_lockout own store (expect 1)', n::text);
  begin
    perform public.release2_clear_lockout('pin', 'enr', enr, t2);
    insert into proof values ('B6', 'clear_lockout claiming T2 (expect 42501)', 'UNEXPECTED: allowed');
  exception when others then insert into proof values ('B6', 'clear_lockout claiming T2 (expect 42501)', '[' || sqlstate || '] ' || sqlerrm); end;
  begin
    perform public.release2_clear_lockout('pin', 'enr', gen_random_uuid(), t1);
    insert into proof values ('B7', 'clear_lockout unknown subject (expect 42501)', 'UNEXPECTED: allowed');
  exception when others then insert into proof values ('B7', 'clear_lockout unknown subject (expect 42501)', '[' || sqlstate || '] ' || sqlerrm); end;
  perform set_config('request.jwt.claims', '', true);

  -- B8 staff session: create, rotate, cross-store refused.
  select * into r from public.release2_create_staff_session(enr, emp1, extensions.gen_random_bytes(32), extensions.gen_random_bytes(32), now() + interval '12 hours', now() + interval '1 hour');
  select * into r2 from public.release2_create_staff_session(enr, emp1, extensions.gen_random_bytes(32), extensions.gen_random_bytes(32), now() + interval '12 hours', now() + interval '1 hour');
  select count(*) filter (where ss.revoked_at is null) into n from public.staff_sessions ss where ss.enrollment_id = enr;
  insert into proof values ('B8', 'create + rotate (expect new id, role staff, live=1, reason rotated)',
    'differs=' || (r2.session_id <> r.session_id) || ' role=' || r2.employee_role || ' live=' || n
    || ' reason=' || coalesce((select ss.revoked_reason from public.staff_sessions ss where ss.id = r.session_id), 'NULL'));
  begin
    perform public.release2_create_staff_session(enr, emp2, extensions.gen_random_bytes(32), extensions.gen_random_bytes(32), now() + interval '12 hours', now() + interval '1 hour');
    insert into proof values ('B9', 'cross-store employee (expect 28000)', 'UNEXPECTED: created');
  exception when others then insert into proof values ('B9', 'cross-store employee (expect 28000)', '[' || sqlstate || '] ' || sqlerrm); end;

  -- B10 revoke: non-owners refused BEFORE and AFTER the revoke (P5b), owner cascades.
  begin
    perform public.release2_revoke_enrollment(enr, own2, 'probe');
    insert into proof values ('B10', 'T2 owner revokes T1 device (expect 42501)', 'UNEXPECTED: allowed');
  exception when others then insert into proof values ('B10', 'T2 owner revokes T1 device (expect 42501)', '[' || sqlstate || '] ' || sqlerrm); end;
  select * into r from public.release2_revoke_enrollment(enr, own1, 'reconciliation probe');
  insert into proof values ('B11', 'owner revoke (expect sessions_revoked=1, cascade reason)',
    'revoked=' || r.o_sessions_revoked || ' reason=' || coalesce((select ss.revoked_reason from public.staff_sessions ss where ss.id = r2.session_id), 'NULL'));
  foreach v in array array['T2 owner', 'T1 manager'] loop
    begin
      perform public.release2_revoke_enrollment(enr, case when v = 'T2 owner' then own2 else mgr1 end, 'probe');
      insert into proof values ('B12', v || ' on already-revoked (expect 42501)', 'UNEXPECTED: allowed');
    exception when others then insert into proof values ('B12', v || ' on already-revoked (expect 42501)', '[' || sqlstate || '] ' || sqlerrm); end;
  end loop;

  -- B13 prune: an old unlocked row goes, a live lock stays.
  insert into public.auth_attempts (scope, subject, window_start, attempts) values ('pin', 'enr:prune-old', now() - interval '30 days', 1);
  insert into public.auth_attempts (scope, subject, window_start, attempts, locked_until) values ('pin', 'enr:prune-locked', now() - interval '30 days', 9, now() + interval '1 hour');
  select public.release2_prune_auth_attempts(604800) into n;
  insert into proof values ('B13', 'prune (expect old gone, locked kept)',
    'deleted>=' || n || ' old_left=' || (select count(*) from public.auth_attempts where subject = 'enr:prune-old')
    || ' locked_left=' || (select count(*) from public.auth_attempts where subject = 'enr:prune-locked'));
exception when others then
  insert into proof values ('B!', 'end-to-end block', 'FAILED: [' || sqlstate || '] ' || sqlerrm);
end $$;

select n, step, outcome from proof order by n;
