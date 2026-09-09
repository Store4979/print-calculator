-- E-01 REHEARSAL. The migration body verbatim, then proofs, in ONE transaction
-- that ends in ROLLBACK. Nothing persists. Roles impersonated as PostgREST
-- sends them; PINs captured while privileged (anon cannot read employees).
begin;
create temp table proof(n int, step text, outcome text) on commit drop;
create temp table fn_before on commit drop as
  select proacl::text as acl, prosecdef, proconfig::text as cfg, obj_description(oid, 'pg_proc') as cmt
  from pg_proc where proname = 'verify_employee_pin' and pronamespace = 'public'::regnamespace;

-- ===================== 1. E-01 body (verbatim) =====================
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

-- ===================== 2. proofs =====================
insert into proof
select 0, 'P0 proacl before -> after (must be identical) ; secdef ; search_path ; comment restored',
  (select acl from fn_before) || '  ->  ' || p.proacl::text
  || ' ; identical_text=' || ((select acl from fn_before) = p.proacl::text)::text
  || ' ; identical_set=' || ((select array_agg(x::text order by x::text) from unnest((select acl from fn_before)::aclitem[]) x)
                            = (select array_agg(x::text order by x::text) from unnest(p.proacl) x))::text
  || ' ; secdef=' || p.prosecdef || ' ; cfg=' || p.proconfig::text
  || ' ; comment_has_role=' || (obj_description(p.oid,'pg_proc') like '%id/name/active/role%')::text
  || ' ; returns=' || pg_get_function_result(p.oid)
from pg_proc p where p.proname = 'verify_employee_pin' and p.pronamespace = 'public'::regnamespace;

-- P1 anon: Ryan's PIN -> manager. P2 anon: Jordan's PIN -> staff. P3 anon: wrong PIN -> no row.
do $$
declare sid uuid; pr text; pj text; r record; out1 text; out2 text; out3 text;
begin
  select id into sid from public.stores where slug = 'store4979';
  select pin into pr from public.employees where name = 'Ryan Sifuentes';
  select pin into pj from public.employees where name = 'Jordan Breecher';
  set local role anon; perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  select * into r from public.verify_employee_pin(sid, pr);
  out1 := coalesce(r.name || ' active=' || r.active || ' role=' || r.role, 'NO ROW');
  select * into r from public.verify_employee_pin(sid, pj);
  out2 := coalesce(r.name || ' active=' || r.active || ' role=' || r.role, 'NO ROW');
  select * into r from public.verify_employee_pin(sid, 'nope');
  out3 := coalesce(r.name, 'NO ROW');
  reset role;
  insert into proof values (1, 'P1 anon: Ryan PIN (expect manager)', out1);
  insert into proof values (2, 'P2 anon: Jordan PIN (expect staff)', out2);
  insert into proof values (3, 'P3 anon: wrong PIN (expect NO ROW)', out3);
exception when others then
  reset role;
  insert into proof values (1, 'P1-P3 anon RPC', 'FAILED: ' || sqlerrm);
end $$;

-- P4 authenticated (owner signed in on the same browser): Ryan's PIN still resolves.
do $$
declare sid uuid; pr text; r record;
begin
  select id into sid from public.stores where slug = 'store4979';
  select pin into pr from public.employees where name = 'Ryan Sifuentes';
  set local role authenticated;
  perform set_config('request.jwt.claims', '{"sub":"d76883f3-e9b6-4210-a740-dcf9624bc301","role":"authenticated"}', true);
  select * into r from public.verify_employee_pin(sid, pr);
  reset role;
  insert into proof values (4, 'P4 authenticated owner: Ryan PIN (expect manager)', coalesce(r.name || ' role=' || r.role, 'NO ROW'));
exception when others then
  reset role;
  insert into proof values (4, 'P4 authenticated owner: Ryan PIN', 'FAILED: ' || sqlerrm);
end $$;

-- P5 check constraint rejects an unknown role (as postgres, so the trigger is not what stops it).
do $$
begin
  update public.employees set role = 'boss' where name = 'Jordan Breecher';
  insert into proof values (5, 'P5 check constraint: role=boss (expect rejection)', 'UNEXPECTED: accepted');
exception when others then
  insert into proof values (5, 'P5 check constraint: role=boss (expect rejection)', 'OK rejected [' || sqlstate || '] ' || sqlerrm);
end $$;

-- P6 trigger, as the MANAGER admin account: promoting Jordan must fail with 42501.
do $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', '{"sub":"7c8a2a1c-60c3-4abc-bcd0-c13f0f95ed02","role":"authenticated"}', true);
  update public.employees set role = 'manager' where name = 'Jordan Breecher';
  reset role;
  insert into proof values (6, 'P6 manager admin sets Jordan role=manager (expect 42501)', 'UNEXPECTED: accepted');
exception when others then
  reset role;
  insert into proof values (6, 'P6 manager admin sets Jordan role=manager (expect 42501)', 'OK rejected [' || sqlstate || '] ' || sqlerrm);
end $$;

-- P7 trigger, same MANAGER: editing Jordan's name (role untouched) must still work — RLS lets managers edit staff.
do $$
declare n text;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', '{"sub":"7c8a2a1c-60c3-4abc-bcd0-c13f0f95ed02","role":"authenticated"}', true);
  update public.employees set name = 'Jordan Breecher (edited)' where name = 'Jordan Breecher';
  reset role;
  select name into n from public.employees where name like 'Jordan Breecher%';
  insert into proof values (7, 'P7 manager admin edits Jordan name, role untouched (expect OK)', 'OK now: ' || n);
exception when others then
  reset role;
  insert into proof values (7, 'P7 manager admin edits Jordan name, role untouched (expect OK)', 'FAILED: ' || sqlerrm);
end $$;

-- P8 trigger, as the OWNER: promoting Jordan succeeds.
do $$
declare rl text;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', '{"sub":"d76883f3-e9b6-4210-a740-dcf9624bc301","role":"authenticated"}', true);
  update public.employees set role = 'manager' where name like 'Jordan Breecher%';
  reset role;
  select role into rl from public.employees where name like 'Jordan Breecher%';
  insert into proof values (8, 'P8 owner sets Jordan role=manager (expect OK, manager)', 'OK now role=' || rl);
exception when others then
  reset role;
  insert into proof values (8, 'P8 owner sets Jordan role=manager (expect OK)', 'FAILED: ' || sqlerrm);
end $$;

-- P9 trigger on INSERT: manager admin inserting a new manager must fail; owner inserting with no role gets 'staff'.
do $$
declare sid uuid; oid_ uuid; v1 text; rl text;
begin
  select id, org_id into sid, oid_ from public.stores where slug = 'store4979';
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', '{"sub":"7c8a2a1c-60c3-4abc-bcd0-c13f0f95ed02","role":"authenticated"}', true);
    insert into public.employees (name, pin, store_id, org_id, role) values ('Rehearsal Mgr', '9998', sid, oid_, 'manager');
    v1 := 'UNEXPECTED: accepted';
  exception when others then
    v1 := 'OK rejected [' || sqlstate || ']';
  end;
  reset role;
  set local role authenticated;
  perform set_config('request.jwt.claims', '{"sub":"d76883f3-e9b6-4210-a740-dcf9624bc301","role":"authenticated"}', true);
  insert into public.employees (name, pin, store_id, org_id) values ('Rehearsal Staff', '9999', sid, oid_);
  reset role;
  select role into rl from public.employees where name = 'Rehearsal Staff';
  insert into proof values (9, 'P9 insert: manager admin inserts a manager (expect 42501) ; owner inserts with no role (expect staff)', v1 || ' ; default role=' || rl);
exception when others then
  reset role;
  insert into proof values (9, 'P9 insert', 'FAILED: ' || sqlerrm);
end $$;

-- P10 lockdown unchanged: anon still cannot read employees directly.
do $$
declare c int;
begin
  set local role anon; perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  select count(*) into c from public.employees;
  reset role;
  insert into proof values (10, 'P10 anon direct select employees (expect 0)', c::text);
exception when others then
  reset role;
  insert into proof values (10, 'P10 anon direct select employees', 'FAILED: ' || sqlerrm);
end $$;

-- P11 trigger function ACL: EXECUTE revoked from PUBLIC, not security definer.
insert into proof
select 11, 'P11 employees_role_owner_only: proacl (expect postgres + service_role only) ; secdef (expect false) ; trigger present',
  coalesce(p.proacl::text, 'NULL(=PUBLIC)') || ' ; ' || p.prosecdef || ' ; '
  || (select count(*) from pg_trigger where tgrelid = 'public.employees'::regclass and tgname = 'employees_role_owner_only')
from pg_proc p where p.proname = 'employees_role_owner_only' and p.pronamespace = 'public'::regnamespace;

select n, step, outcome from proof order by n;
rollback;
