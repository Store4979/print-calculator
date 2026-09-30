-- Release 2, stage 0 — PRODUCTION proofs. FAILING ASSERTIONS, not a report.
-- docs/security/release-2-stage-0-production-plan.md §E3. Pinned by md5 in
-- docs/security/stage0-production-manifest.json.
--
-- HOW IT RUNS: never on its own. scripts/manual/assemble-stage0.mjs splits
-- this file at its "@@stage0-proofs section" markers and interleaves the
-- sections with the P2 wrapper bodies and the rollback operations inside ONE
-- transaction that ends in ROLLBACK (P1):
--   section 0   before 01    capture the catalog and the real rows it touches
--   section 1   after 02     fixtures, including a live enrollment for 1b
--   section 1b  after 03 ALONE, inside a savepoint that P1 then rolls back:
--               03's staff-session body raises 42702. P2 never applies 03
--               alone — P2-0304 applies 03 and 04 in one transaction (review
--               of dc5a88b, N7) — so this state exists only here, to show
--               what 04 repairs
--   section 2   after P2-0304 and P2-05: A2 by catalog-set equality; every
--               end-to-end call
--   section 3   after 2      fixture removal; tables empty; real rows unchanged
--   section 4   after RB-*   the catalog equals section 0's, row for row
--
-- WHAT A FAILURE LOOKS LIKE: every check raises P0001 with its id
-- ("STAGE0 PROOF <id> FAILED: …"), which aborts the whole transaction.
-- Nothing is reported as a row to be read and judged. Success is the absence
-- of an error.
--
-- PRINCIPALS ARE CREATED INSIDE THE TRANSACTION. Two synthetic organizations
-- and stores (A, B) plus a store with no org (C, for 23502); three synthetic
-- auth.users rows (owner A, manager A, owner B — the cross-store principal),
-- every address @example.invalid; their memberships; staff and manager
-- employees at A and a staff employee at B, on PINs that no employee uses
-- (employees_pin_unique is global). No real user, store or employee id is
-- read or borrowed. Real rows are read only into md5 digests (section 0 vs
-- section 3), never into a result.
--
-- HELPERS are pg_temp functions: they exist only in this session and vanish
-- with the ROLLBACK, and pg_temp is invisible to every other session, so
-- nothing but this transaction can execute them. They are not in the public
-- schema, and the catalog fingerprint (public only) does not see them.
--
-- Owner identity for has_store_role() is simulated by setting
-- request.jwt.claims transaction-locally, which is what auth.uid() reads, and
-- the ACL is proven by EXECUTION as anon / authenticated via SET LOCAL ROLE
-- inside a subtransaction that is always rolled back.

-- @@stage0-proofs section 0: capture, before 01
create temp table stage0_proof (n text primary key, what text not null) on commit drop;
create temp table stage0_fix (k text primary key, v uuid not null) on commit drop;

create function pg_temp.stage0_check(p_id text, p_ok boolean, p_what text)
returns void language plpgsql as $f$
begin
  if p_ok is distinct from true then
    raise exception 'STAGE0 PROOF % FAILED: %', p_id, p_what using errcode = 'P0001';
  end if;
  insert into stage0_proof values (p_id, p_what);
end
$f$;

-- md5 over the rows a query returns, in a stable order. Used to prove that a
-- refused call left its rows exactly as they were.
create function pg_temp.stage0_digest(p_sql text)
returns text language plpgsql as $f$
declare v text;
begin
  execute 'select md5(coalesce(string_agg(x::text, E''\n'' order by x::text), '''')) from (' || p_sql || ') x' into v;
  return v;
end
$f$;

-- Run p_sql (as p_role when given) and require EXACTLY sqlstate p_state and
-- message p_msg. The inner block always ends in an exception, so its
-- subtransaction — the role switch and any effect of an unexpected success —
-- is always rolled back. p_unchanged: the rows that must be identical before
-- and after.
create function pg_temp.stage0_expect_error(p_id text, p_role text, p_sql text,
                                            p_state text, p_msg text, p_unchanged text)
returns void language plpgsql as $f$
declare v_state text; v_msg text; v_before text; v_after text;
begin
  v_before := pg_temp.stage0_digest(p_unchanged);
  begin
    if p_role is not null then
      execute format('set local role %I', p_role);
    end if;
    execute p_sql;
    v_state := 'NO ERROR';
    v_msg := '';
    raise exception 'stage0 sentinel' using errcode = 'P0002';
  exception when others then
    if v_state is null then
      v_state := sqlstate;
      v_msg := sqlerrm;
    end if;
  end;
  if v_state <> p_state or v_msg <> p_msg then
    raise exception 'STAGE0 PROOF % FAILED: expected [%] %, got [%] %', p_id, p_state, p_msg, v_state, v_msg
      using errcode = 'P0001';
  end if;
  v_after := pg_temp.stage0_digest(p_unchanged);
  if v_after is distinct from v_before then
    raise exception 'STAGE0 PROOF % FAILED: the refused call changed rows it must not touch', p_id
      using errcode = 'P0001';
  end if;
  insert into stage0_proof values (p_id, format('[%s] %s; rows unchanged', p_state, p_msg));
end
$f$;

create function pg_temp.fx(p_k text)
returns uuid language sql stable as $f$ select v from stage0_fix where k = p_k $f$;

create function pg_temp.stage0_deadline(p_where text)
returns void language plpgsql as $f$
begin
  if clock_timestamp() - transaction_timestamp()
     > make_interval(secs => current_setting('release2.stage0_deadline_s')::int) then
    raise exception 'STAGE0 deadline exceeded at %', p_where using errcode = 'P0001';
  end if;
end
$f$;

-- The whole public catalog as (kind, ident, fact) rows. P0's
-- catalog_fingerprint is md5 over exactly these rows; the assembler takes the
-- query from between the two markers, so the two cannot drift.
create temp view stage0_catalog_rows as
-- @@catalog-rows begin
select 'function'::text as kind,
       p.proname || '(' || oidvectortypes(p.proargtypes) || ')' as ident,
       md5(p.prosrc) || '|' || p.prosecdef::text || '|' || p.provolatile::text || '|'
         || coalesce(array_to_string(p.proconfig, ','), '') || '|'
         || pg_get_function_result(p.oid) || '|'
         || coalesce((select string_agg(coalesce(r.rolname, 'PUBLIC') || '=' || a.privilege_type, ','
                                        order by coalesce(r.rolname, 'PUBLIC'), a.privilege_type)
                        from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                        left join pg_roles r on r.oid = a.grantee), '') || '|'
         || coalesce(md5(obj_description(p.oid, 'pg_proc')), '') as fact
  from pg_proc p
 where p.pronamespace = 'public'::regnamespace
union all
select 'relation', c.relname,
       c.relkind::text || '|' || c.relrowsecurity::text || '|' || c.relforcerowsecurity::text || '|'
         || coalesce((select string_agg(coalesce(r.rolname, 'PUBLIC') || '=' || a.privilege_type, ','
                                        order by coalesce(r.rolname, 'PUBLIC'), a.privilege_type)
                        from aclexplode(coalesce(c.relacl, acldefault((case c.relkind when 'S' then 's' else 'r' end)::"char", c.relowner))) a
                        left join pg_roles r on r.oid = a.grantee), '')
  from pg_class c
 where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f')
union all
select 'column', c.relname || '.' || a.attname,
       format_type(a.atttypid, a.atttypmod) || '|' || a.attnotnull::text || '|'
         || coalesce(pg_get_expr(d.adbin, d.adrelid), '')
  from pg_attribute a
  join pg_class c on c.oid = a.attrelid
  left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
 where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'f')
   and a.attnum > 0 and not a.attisdropped
union all
select 'index', t.relname || '.' || c.relname, pg_get_indexdef(c.oid)
  from pg_index i
  join pg_class c on c.oid = i.indexrelid
  join pg_class t on t.oid = i.indrelid
 where c.relnamespace = 'public'::regnamespace
union all
select 'constraint', c.relname || '.' || k.conname, pg_get_constraintdef(k.oid)
  from pg_constraint k join pg_class c on c.oid = k.conrelid
 where c.relnamespace = 'public'::regnamespace
union all
select 'policy', c.relname || '.' || pol.polname,
       pol.polcmd::text || '|' || pol.polpermissive::text || '|'
         || array_to_string(array(select coalesce(r.rolname, 'PUBLIC') from unnest(pol.polroles) u(o)
                                    left join pg_roles r on r.oid = u.o order by 1), ',') || '|'
         || coalesce(pg_get_expr(pol.polqual, pol.polrelid), '') || '|'
         || coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '')
  from pg_policy pol join pg_class c on c.oid = pol.polrelid
 where c.relnamespace = 'public'::regnamespace
union all
select 'trigger', c.relname || '.' || t.tgname, pg_get_triggerdef(t.oid)
  from pg_trigger t join pg_class c on c.oid = t.tgrelid
 where c.relnamespace = 'public'::regnamespace and not t.tgisinternal
-- @@catalog-rows end
;

-- Digests of the real rows in every table the fixtures write to.
create temp view stage0_realrows as
select 'employees'::text as tbl, count(*) as n,
       md5(coalesce(string_agg(t::text, E'\n' order by t.id), '')) as digest from public.employees t
union all
select 'stores', count(*), md5(coalesce(string_agg(t::text, E'\n' order by t.id), '')) from public.stores t
union all
select 'organizations', count(*), md5(coalesce(string_agg(t::text, E'\n' order by t.id), '')) from public.organizations t
union all
select 'memberships', count(*), md5(coalesce(string_agg(t::text, E'\n' order by t.id), '')) from public.memberships t
union all
select 'auth.users', count(*), md5(coalesce(string_agg(t::text, E'\n' order by t.id), '')) from auth.users t;

create temp table stage0_catalog_before on commit drop as select * from stage0_catalog_rows;
create temp table stage0_realrows_before on commit drop as select * from stage0_realrows;

select pg_temp.stage0_check('S0.1', (select count(*) from stage0_catalog_before) > 0,
  'the catalog capture is not empty');
select pg_temp.stage0_check('S0.2', not exists (
    select 1 from stage0_catalog_before
     where ident like 'release2\_%' or ident like 'redeem\_enrollment\_ticket(%'
        or split_part(ident, '.', 1) in ('device_enrollments', 'enrollment_tickets', 'staff_sessions',
                                         'upload_capabilities', 'upload_capability_files', 'auth_attempts')
        or ident like '%employees\_id\_store\_uniq%'),
  'no Release 2 object exists before 01');
select pg_temp.stage0_check('S0.3', (select count(*) from pg_trigger t
                                      where t.tgrelid = 'auth.users'::regclass and not t.tgisinternal) = 0,
  'auth.users has no user-defined trigger (the fixtures insert there)');

-- @@stage0-proofs section 1: after 02 — fixtures (they must survive section 1b's savepoint rollback)
select pg_temp.stage0_deadline('section 1');
do $s1$
declare
  tag    text := to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS');
  v_pins text[];
  own_a  uuid := gen_random_uuid();
  mgr_a  uuid := gen_random_uuid();
  own_b  uuid := gen_random_uuid();
  org_a uuid; org_b uuid; st_a uuid; st_b uuid; st_c uuid;
  emp_a uuid; memp_a uuid; emp_b uuid;
  tk bytea := extensions.gen_random_bytes(32);
  r record;
begin
  select array_agg(x.p order by x.p) into v_pins from (
    select lpad(g::text, 4, '0') as p from generate_series(1000, 9999) g
     where not exists (select 1 from public.employees e where e.pin = lpad(g::text, 4, '0'))
     order by g limit 3) x;
  perform pg_temp.stage0_check('S1.1', coalesce(array_length(v_pins, 1), 0) = 3, 'three unused PINs exist');

  insert into auth.users (instance_id, id, aud, role, email) values
    ('00000000-0000-0000-0000-000000000000', own_a, 'authenticated', 'authenticated', 'stage0-owner-a-' || tag || '@example.invalid'),
    ('00000000-0000-0000-0000-000000000000', mgr_a, 'authenticated', 'authenticated', 'stage0-manager-a-' || tag || '@example.invalid'),
    ('00000000-0000-0000-0000-000000000000', own_b, 'authenticated', 'authenticated', 'stage0-owner-b-' || tag || '@example.invalid');
  insert into public.organizations (name, slug) values ('stage0 proof A', 'stage0-proof-a-' || tag) returning id into org_a;
  insert into public.organizations (name, slug) values ('stage0 proof B', 'stage0-proof-b-' || tag) returning id into org_b;
  insert into public.stores (slug, name, org_id) values ('stage0-proof-a-' || tag, 'stage0 proof A', org_a) returning id into st_a;
  insert into public.stores (slug, name, org_id) values ('stage0-proof-b-' || tag, 'stage0 proof B', org_b) returning id into st_b;
  insert into public.stores (slug, name) values ('stage0-proof-c-' || tag, 'stage0 proof C (no org)') returning id into st_c;
  insert into public.memberships (store_id, user_id, role, org_id) values
    (st_a, own_a, 'owner', org_a), (st_a, mgr_a, 'manager', org_a), (st_b, own_b, 'owner', org_b);
  insert into public.employees (name, pin, active, store_id, org_id, role)
    values ('stage0 staff A', v_pins[1], true, st_a, org_a, 'staff') returning id into emp_a;
  insert into public.employees (name, pin, active, store_id, org_id, role)
    values ('stage0 manager A', v_pins[2], true, st_a, org_a, 'manager') returning id into memp_a;
  insert into public.employees (name, pin, active, store_id, org_id, role)
    values ('stage0 staff B', v_pins[3], true, st_b, org_b, 'staff') returning id into emp_b;

  insert into stage0_fix values
    ('own_a', own_a), ('mgr_a', mgr_a), ('own_b', own_b), ('org_a', org_a), ('org_b', org_b),
    ('st_a', st_a), ('st_b', st_b), ('st_c', st_c), ('emp_a', emp_a), ('memp_a', memp_a), ('emp_b', emp_b);

  -- A live enrollment for section 1b's 42702 probe (01's redeem function).
  insert into public.enrollment_tickets (store_id, ticket_hash, created_by, expires_at)
    values (st_a, extensions.digest(tk, 'sha256'), own_a, now() + interval '15 minutes');
  select * into r from public.redeem_enrollment_ticket(extensions.digest(tk, 'sha256'),
    extensions.gen_random_bytes(32), extensions.gen_random_bytes(32), 'stage0 42702 probe');
  perform pg_temp.stage0_check('S1.2', r.store_id = st_a, 'the 42702 probe''s enrollment is at store A');
  insert into stage0_fix values ('enr_42702', r.enrollment_id);
end
$s1$;

-- @@stage0-proofs section 1b: after 03 ALONE, inside a savepoint — 03's body raises 42702
select pg_temp.stage0_deadline('section 1b');
do $s1b$
declare enr uuid := pg_temp.fx('enr_42702');
begin
  perform pg_temp.stage0_check('S1.0',
    md5((select p.prosrc from pg_proc p
          where p.oid = to_regprocedure('public.release2_create_staff_session(uuid,uuid,bytea,bytea,timestamptz,timestamptz)')))
      = 'bd6da6a2f80e13c7b20deab3b2c76e63',
    'the staff-session function has 03''s body (bd6da6a2…) after 03 alone');
  -- A live enrollment: an unknown one raises 28000 before the ambiguous
  -- statement is ever reached, which would prove nothing about 03's defect.
  perform pg_temp.stage0_expect_error('S1.3', null,
    format('select * from public.release2_create_staff_session(%L::uuid, %L::uuid, extensions.gen_random_bytes(32), '
           'extensions.gen_random_bytes(32), now() + interval ''12 hours'', now() + interval ''1 hour'')',
           enr, pg_temp.fx('emp_a')),
    '42702', 'column reference "store_id" is ambiguous',
    format('select s::text from public.staff_sessions s where s.enrollment_id = %L', enr)
      || format(' union all select de::text from public.device_enrollments de where de.id = %L', enr));
end
$s1b$;

-- @@stage0-proofs section 2: after P2-0304 and P2-05 — A2 by catalog-set equality, then every end-to-end call
select pg_temp.stage0_deadline('section 2');

-- A2: the Release 2 functions are EXACTLY these six, with these bodies and grantees.
select pg_temp.stage0_check('S2.1', (
  with have as (
    select p.proname || '(' || oidvectortypes(p.proargtypes) || ')' as ident, md5(p.prosrc) as body_md5,
           (select string_agg(coalesce(r.rolname, 'PUBLIC') || '=' || a.privilege_type, ','
                              order by coalesce(r.rolname, 'PUBLIC'), a.privilege_type)
              from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
              left join pg_roles r on r.oid = a.grantee) as acl
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and (p.proname like 'release2\_%' or p.proname = 'redeem_enrollment_ticket')),
  want(ident, body_md5, acl) as (values
    ('redeem_enrollment_ticket(bytea, bytea, bytea, text)', 'c024388886897f01a1154d8d12dc8996', 'postgres=EXECUTE,service_role=EXECUTE'),
    ('release2_record_attempt(text, text, integer, integer, integer)', 'e67957595afcc7a51d7f8673000d9302', 'postgres=EXECUTE,service_role=EXECUTE'),
    ('release2_clear_lockout(text, text, uuid, uuid)', 'b7f602cde969f2f2622c0d2343b1c249', 'authenticated=EXECUTE,postgres=EXECUTE,service_role=EXECUTE'),
    ('release2_prune_auth_attempts(integer)', 'ee254949f88474c58284b8a2c1ba3cb0', 'postgres=EXECUTE,service_role=EXECUTE'),
    ('release2_create_staff_session(uuid, uuid, bytea, bytea, timestamp with time zone, timestamp with time zone)', 'd30da6d0c7a4d14e1bcb1b9fcace37d9', 'postgres=EXECUTE,service_role=EXECUTE'),
    ('release2_revoke_enrollment(uuid, uuid, text)', 'a464a43cc72537bb02b3e4a1d904f655', 'postgres=EXECUTE,service_role=EXECUTE'))
  select count(*) = 0 from ((select * from have except select * from want)
                            union all (select * from want except select * from have)) d),
  'A2 functions: exactly the six, md5(prosrc) and EXECUTE grantees as the manifest');

select pg_temp.stage0_check('S2.2', not exists (
    select 1 from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and (p.proname like 'release2\_%' or p.proname = 'redeem_enrollment_ticket')
       and (not p.prosecdef or p.proconfig is distinct from array['search_path=public']
            or obj_description(p.oid, 'pg_proc') is null)),
  'A2 functions: SECURITY DEFINER, search_path=public, commented');

-- A2: six tables, RLS on, zero policies, grantees exactly postgres and
-- service_role, each holding the server's full table privilege set.
select pg_temp.stage0_check('S2.3', (
  with t as (
    select c.oid, c.relname, c.relowner, c.relacl, c.relrowsecurity
      from pg_class c
     where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
       and c.relname in ('device_enrollments', 'enrollment_tickets', 'staff_sessions',
                         'upload_capabilities', 'upload_capability_files', 'auth_attempts')),
  have as (
    select t.relname::text, coalesce(r.rolname::text, 'PUBLIC') as grantee, a.privilege_type::text
      from t cross join lateral aclexplode(coalesce(t.relacl, acldefault('r', t.relowner))) a
      left join pg_roles r on r.oid = a.grantee),
  want as (
    select t.relname::text, g.grantee::text, f.privilege_type::text
      from t cross join (values ('postgres'), ('service_role')) g(grantee)
      cross join lateral aclexplode(acldefault('r', t.relowner)) f)
  select (select count(*) from t) = 6
     and (select bool_and(t.relrowsecurity) from t)
     and not exists (select 1 from pg_policy pol where pol.polrelid in (select oid from t))
     and (select count(*) from ((select * from have except select * from want)
                                union all (select * from want except select * from have)) d) = 0),
  'A2 tables: six, RLS on, 0 policies, grantees exactly postgres + service_role with the full privilege set');

select pg_temp.stage0_check('S2.4', (
    select pg_get_constraintdef(k.oid) from pg_constraint k
     where k.conrelid = 'public.employees'::regclass and k.conname = 'employees_id_store_uniq') = 'UNIQUE (id, store_id)',
  'A2 constraint: employees_id_store_uniq UNIQUE (id, store_id)');

-- Nothing that existed before 01 changed or vanished, and everything new
-- belongs to Release 2.
select pg_temp.stage0_check('S2.5', not exists (
    select * from stage0_catalog_before except select * from stage0_catalog_rows),
  'every pre-existing public catalog row is unchanged');
select pg_temp.stage0_check('S2.6', not exists (
    select 1 from (select * from stage0_catalog_rows except select * from stage0_catalog_before) n
     where not (
       (n.kind = 'function' and (n.ident like 'release2\_%' or n.ident like 'redeem\_enrollment\_ticket(%'))
       or split_part(n.ident, '.', 1) in ('device_enrollments', 'enrollment_tickets', 'staff_sessions',
                                          'upload_capabilities', 'upload_capability_files', 'auth_attempts')
       or (n.kind in ('constraint', 'index') and n.ident = 'employees.employees_id_store_uniq'))),
  'every new public catalog row belongs to Release 2');

do $s2$
declare
  st_a uuid := pg_temp.fx('st_a'); st_b uuid := pg_temp.fx('st_b'); st_c uuid := pg_temp.fx('st_c');
  own_a uuid := pg_temp.fx('own_a'); mgr_a uuid := pg_temp.fx('mgr_a'); own_b uuid := pg_temp.fx('own_b');
  emp_a uuid := pg_temp.fx('emp_a'); memp_a uuid := pg_temp.fx('memp_a'); emp_b uuid := pg_temp.fx('emp_b');
  tk bytea := extensions.gen_random_bytes(32);
  tk_exp bytea := extensions.gen_random_bytes(32);
  tk_rev bytea := extensions.gen_random_bytes(32);
  tk_c bytea := extensions.gen_random_bytes(32);
  enr uuid; r record; r2 record; n int; v text; subj text;
  ticket_rows text; sess_rows text; enr_rows text; limiter_rows text;
begin
  -- E1 redeem a fresh ticket.
  insert into public.enrollment_tickets (store_id, ticket_hash, created_by, expires_at)
    values (st_a, extensions.digest(tk, 'sha256'), own_a, now() + interval '15 minutes');
  select * into r from public.redeem_enrollment_ticket(extensions.digest(tk, 'sha256'),
    extensions.gen_random_bytes(32), extensions.gen_random_bytes(32), 'stage0 proof counter');
  enr := r.enrollment_id;
  insert into stage0_fix values ('enr', enr);
  perform pg_temp.stage0_check('E1', r.store_id = st_a
    and exists (select 1 from public.device_enrollments de
                 where de.id = enr and de.store_id = st_a and de.created_by = own_a
                   and de.revoked_at is null and de.label = 'stage0 proof counter')
    and (select t.redeemed_into from public.enrollment_tickets t where t.ticket_hash = extensions.digest(tk, 'sha256')) = enr,
    'redeem: enrollment at store A, created_by owner A, ticket redeemed into it');

  ticket_rows := format('select t::text from public.enrollment_tickets t where t.store_id = %L', st_a);
  enr_rows    := format('select de::text from public.device_enrollments de where de.store_id = %L', st_a);

  -- E2 replay, E3 expired, E4 revoked: one error for all three, nothing written.
  perform pg_temp.stage0_expect_error('E2', null,
    format('select public.redeem_enrollment_ticket(%L::bytea, extensions.gen_random_bytes(32), extensions.gen_random_bytes(32), ''replay'')',
           extensions.digest(tk, 'sha256')),
    '28000', 'ticket not redeemable', ticket_rows || ' union all ' || enr_rows);
  insert into public.enrollment_tickets (store_id, ticket_hash, created_by, expires_at)
    values (st_a, extensions.digest(tk_exp, 'sha256'), own_a, now() - interval '1 minute');
  perform pg_temp.stage0_expect_error('E3', null,
    format('select public.redeem_enrollment_ticket(%L::bytea, extensions.gen_random_bytes(32), extensions.gen_random_bytes(32), ''expired'')',
           extensions.digest(tk_exp, 'sha256')),
    '28000', 'ticket not redeemable', ticket_rows || ' union all ' || enr_rows);
  insert into public.enrollment_tickets (store_id, ticket_hash, created_by, expires_at, revoked_at)
    values (st_a, extensions.digest(tk_rev, 'sha256'), own_a, now() + interval '15 minutes', now());
  perform pg_temp.stage0_expect_error('E4', null,
    format('select public.redeem_enrollment_ticket(%L::bytea, extensions.gen_random_bytes(32), extensions.gen_random_bytes(32), ''revoked'')',
           extensions.digest(tk_rev, 'sha256')),
    '28000', 'ticket not redeemable', ticket_rows || ' union all ' || enr_rows);

  -- E5 a store with no org (F-2's 23502): the ticket burn is undone with it.
  insert into public.enrollment_tickets (store_id, ticket_hash, created_by, expires_at)
    values (st_c, extensions.digest(tk_c, 'sha256'), own_a, now() + interval '15 minutes');
  perform pg_temp.stage0_expect_error('E5', null,
    format('select public.redeem_enrollment_ticket(%L::bytea, extensions.gen_random_bytes(32), extensions.gen_random_bytes(32), ''no org'')',
           extensions.digest(tk_c, 'sha256')),
    '23502', 'store has no org',
    format('select t::text from public.enrollment_tickets t where t.store_id = %L', st_c));

  -- E6 the ACL, by EXECUTION: client roles are refused by the grant itself.
  perform pg_temp.stage0_expect_error('E6a', 'authenticated',
    format('select public.redeem_enrollment_ticket(%L::bytea, extensions.gen_random_bytes(32), extensions.gen_random_bytes(32), ''acl'')',
           extensions.digest(tk_exp, 'sha256')),
    '42501', 'permission denied for function redeem_enrollment_ticket', ticket_rows);
  perform pg_temp.stage0_expect_error('E6b', 'anon',
    format('select public.release2_clear_lockout(''pin'', ''enr'', %L::uuid, %L::uuid)', enr, st_a),
    '42501', 'permission denied for function release2_clear_lockout', 'select 1');
  perform pg_temp.stage0_expect_error('E6c', 'anon',
    'select public.release2_record_attempt(''pin'', ''enr:acl'', 60, 5, 60)',
    '42501', 'permission denied for function release2_record_attempt', 'select 1');
  perform pg_temp.stage0_expect_error('E6d', 'authenticated',
    format('select public.release2_revoke_enrollment(%L::uuid, %L::uuid, ''acl'')', enr, own_a),
    '42501', 'permission denied for function release2_revoke_enrollment', enr_rows);
  perform pg_temp.stage0_expect_error('E6e', 'authenticated',
    format('select * from public.release2_create_staff_session(%L::uuid, %L::uuid, extensions.gen_random_bytes(32), '
           'extensions.gen_random_bytes(32), now() + interval ''12 hours'', now() + interval ''1 hour'')', enr, emp_a),
    '42501', 'permission denied for function release2_create_staff_session',
    format('select s::text from public.staff_sessions s where s.enrollment_id = %L', enr));
  perform pg_temp.stage0_expect_error('E6f', 'anon',
    'select public.release2_prune_auth_attempts(0)',
    '42501', 'permission denied for function release2_prune_auth_attempts', 'select a::text from public.auth_attempts a');

  -- E7 limiter: quota 2 admitted, the third refused and locked. A day-long
  -- window, so a minute boundary between calls cannot reset the count.
  subj := 'enr:' || enr;
  v := '';
  for i in 1..3 loop
    select * into r2 from public.release2_record_attempt('pin', subj, 86400, 2, 600);
    v := v || r2.allowed::text || '/' || r2.attempts || case when r2.locked_until is null then '' else '/locked' end || ' ';
  end loop;
  perform pg_temp.stage0_check('E7', v = 'true/1 true/2 false/3/locked ',
    'record_attempt x3, quota 2: true/1 true/2 false/3/locked (got ' || v || ')');
  limiter_rows := 'select a::text from public.auth_attempts a';

  -- E8 clear_lockout as AUTHENTICATED with owner A's claims: allowed on A.
  perform set_config('request.jwt.claims', json_build_object('sub', own_a, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select public.release2_clear_lockout('pin', 'enr', enr, st_a) into n;
  execute 'reset role';
  perform pg_temp.stage0_check('E8', n = 1 and not exists (
      select 1 from public.auth_attempts a where a.subject = subj and a.locked_until is not null),
    'owner A, as authenticated, clears the lockout on store A''s own device: 1 row, no lock left');

  -- Lock it again for the refusals below (attempt 4 exceeds quota 2).
  perform public.release2_record_attempt('pin', subj, 86400, 2, 600);
  perform pg_temp.stage0_check('E8b', exists (select 1 from public.auth_attempts a where a.subject = subj and a.locked_until > now()),
    'the device is locked again');

  -- E9 owner A claiming store B for A's device; E10 owner B (cross-store) on A;
  -- E11 owner A with an unknown subject — one indistinguishable answer.
  perform pg_temp.stage0_expect_error('E9', 'authenticated',
    format('select public.release2_clear_lockout(''pin'', ''enr'', %L::uuid, %L::uuid)', enr, st_b),
    '42501', 'not authorised', limiter_rows);
  perform set_config('request.jwt.claims', json_build_object('sub', own_b, 'role', 'authenticated')::text, true);
  perform pg_temp.stage0_expect_error('E10', 'authenticated',
    format('select public.release2_clear_lockout(''pin'', ''enr'', %L::uuid, %L::uuid)', enr, st_a),
    '42501', 'not authorised', limiter_rows);
  perform set_config('request.jwt.claims', json_build_object('sub', own_a, 'role', 'authenticated')::text, true);
  perform pg_temp.stage0_expect_error('E11', 'authenticated',
    format('select public.release2_clear_lockout(''pin'', ''enr'', %L::uuid, %L::uuid)', gen_random_uuid(), st_a),
    '42501', 'not authorised', limiter_rows);
  perform pg_temp.stage0_expect_error('E12', 'authenticated',
    format('select public.release2_clear_lockout(''sms'', ''enr'', %L::uuid, %L::uuid)', enr, st_a),
    '22023', 'unsupported scope', limiter_rows);

  -- E13 manager A may clear on its own store.
  perform set_config('request.jwt.claims', json_build_object('sub', mgr_a, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select public.release2_clear_lockout('pin', 'enr', enr, st_a) into n;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  perform pg_temp.stage0_check('E13', n = 1, 'manager A clears the lockout on store A: 1 row');

  -- E14 staff session: create, rotate, manager sign-in carries role manager.
  select * into r from public.release2_create_staff_session(enr, emp_a, extensions.gen_random_bytes(32),
    extensions.gen_random_bytes(32), now() + interval '12 hours', now() + interval '1 hour');
  select * into r2 from public.release2_create_staff_session(enr, emp_a, extensions.gen_random_bytes(32),
    extensions.gen_random_bytes(32), now() + interval '12 hours', now() + interval '1 hour');
  perform pg_temp.stage0_check('E14', r2.session_id <> r.session_id and r2.employee_role = 'staff' and r2.store_id = st_a
    and (select count(*) from public.staff_sessions s where s.enrollment_id = enr and s.revoked_at is null) = 1
    and (select s.revoked_reason from public.staff_sessions s where s.id = r.session_id) = 'rotated: new sign-in on this device',
    'create + rotate: new id, role staff, store A, one live session, the old one rotated');
  select * into r from public.release2_create_staff_session(enr, memp_a, extensions.gen_random_bytes(32),
    extensions.gen_random_bytes(32), now() + interval '12 hours', now() + interval '1 hour');
  perform pg_temp.stage0_check('E15', r.employee_role = 'manager'
    and (select count(*) from public.staff_sessions s where s.enrollment_id = enr and s.revoked_at is null) = 1,
    'manager sign-in: role manager, still one live session');

  sess_rows := format('select s::text from public.staff_sessions s where s.enrollment_id = %L', enr);

  -- E16 a cross-store employee on A's device.
  perform pg_temp.stage0_expect_error('E16', null,
    format('select * from public.release2_create_staff_session(%L::uuid, %L::uuid, extensions.gen_random_bytes(32), '
           'extensions.gen_random_bytes(32), now() + interval ''12 hours'', now() + interval ''1 hour'')', enr, emp_b),
    '28000', 'employee not usable for this enrollment', sess_rows);

  -- E17–E19 revoke refusals BEFORE the revoke: owner B, manager A, over-long reason.
  perform pg_temp.stage0_expect_error('E17', null,
    format('select public.release2_revoke_enrollment(%L::uuid, %L::uuid, ''probe'')', enr, own_b),
    '42501', 'not authorised', enr_rows || ' union all ' || sess_rows);
  perform pg_temp.stage0_expect_error('E18', null,
    format('select public.release2_revoke_enrollment(%L::uuid, %L::uuid, ''probe'')', enr, mgr_a),
    '42501', 'not authorised', enr_rows || ' union all ' || sess_rows);
  perform pg_temp.stage0_expect_error('E19', null,
    format('select public.release2_revoke_enrollment(%L::uuid, %L::uuid, %L)', enr, own_a, repeat('x', 201)),
    '22023', 'reason must be at most 200 printable characters', enr_rows || ' union all ' || sess_rows);

  -- E20 owner A revokes: cascade to the one live session.
  select * into r2 from public.release2_revoke_enrollment(enr, own_a, 'stage0 proof');
  perform pg_temp.stage0_check('E20', r2.o_sessions_revoked = 1 and r2.o_store_id = st_a
    and exists (select 1 from public.device_enrollments de where de.id = enr and de.revoked_at is not null
                   and de.revoked_by = own_a and de.revoked_reason = 'stage0 proof')
    and (select s.revoked_reason from public.staff_sessions s where s.id = r.session_id) = 'device revoked: stage0 proof'
    and not exists (select 1 from public.staff_sessions s where s.enrollment_id = enr and s.revoked_at is null),
    'owner revoke: sessions_revoked=1, revoked_by owner A, cascade reason, no live session');

  -- E21 AFTER the revoke (P5b): non-owners still refused before the idempotent
  -- return; owner A again returns 0 and changes nothing; the device cannot sign in.
  perform pg_temp.stage0_expect_error('E21a', null,
    format('select public.release2_revoke_enrollment(%L::uuid, %L::uuid, ''probe'')', enr, own_b),
    '42501', 'not authorised', enr_rows || ' union all ' || sess_rows);
  perform pg_temp.stage0_expect_error('E21b', null,
    format('select public.release2_revoke_enrollment(%L::uuid, %L::uuid, ''probe'')', enr, mgr_a),
    '42501', 'not authorised', enr_rows || ' union all ' || sess_rows);
  v := pg_temp.stage0_digest(enr_rows || ' union all ' || sess_rows);
  select * into r2 from public.release2_revoke_enrollment(enr, own_a, 'again');
  perform pg_temp.stage0_check('E21c', r2.o_sessions_revoked = 0
    and pg_temp.stage0_digest(enr_rows || ' union all ' || sess_rows) = v,
    'owner A on an already-revoked device: 0 revoked, rows unchanged');
  perform pg_temp.stage0_expect_error('E21d', null,
    format('select * from public.release2_create_staff_session(%L::uuid, %L::uuid, extensions.gen_random_bytes(32), '
           'extensions.gen_random_bytes(32), now() + interval ''12 hours'', now() + interval ''1 hour'')', enr, emp_a),
    '28000', 'enrollment not usable', sess_rows);

  -- E22 prune: an old unlocked row goes; an old row with a live lock and a
  -- current row stay.
  insert into public.auth_attempts (scope, subject, window_start, attempts)
    values ('pin', 'stage0:prune-old', now() - interval '30 days', 1);
  insert into public.auth_attempts (scope, subject, window_start, attempts, locked_until)
    values ('pin', 'stage0:prune-locked', now() - interval '30 days', 9, now() + interval '1 hour');
  select public.release2_prune_auth_attempts(604800) into n;
  perform pg_temp.stage0_check('E22', n = 1
    and not exists (select 1 from public.auth_attempts a where a.subject = 'stage0:prune-old')
    and exists (select 1 from public.auth_attempts a where a.subject = 'stage0:prune-locked')
    and exists (select 1 from public.auth_attempts a where a.subject = subj),
    'prune: exactly the old unlocked row deleted; the live lock and the current row kept');
end
$s2$;

-- @@stage0-proofs section 3: fixture removal — tables empty, real rows unchanged
select pg_temp.stage0_deadline('section 3');
do $s3$
declare
  stores uuid[] := array[pg_temp.fx('st_a'), pg_temp.fx('st_b'), pg_temp.fx('st_c')];
  users  uuid[] := array[pg_temp.fx('own_a'), pg_temp.fx('mgr_a'), pg_temp.fx('own_b')];
begin
  delete from public.auth_attempts a
   where a.subject in ('enr:' || pg_temp.fx('enr'), 'stage0:prune-locked');
  delete from public.staff_sessions s where s.store_id = any (stores);
  delete from public.enrollment_tickets t where t.store_id = any (stores);
  delete from public.device_enrollments de where de.store_id = any (stores);
  delete from public.memberships m where m.user_id = any (users);
  delete from public.employees e where e.id in (pg_temp.fx('emp_a'), pg_temp.fx('memp_a'), pg_temp.fx('emp_b'));
  delete from public.stores s where s.id = any (stores);
  delete from public.organizations o where o.id in (pg_temp.fx('org_a'), pg_temp.fx('org_b'));
  delete from auth.users u where u.id = any (users);

  perform pg_temp.stage0_check('S3.1',
    (select count(*) from public.device_enrollments) + (select count(*) from public.enrollment_tickets)
    + (select count(*) from public.staff_sessions) + (select count(*) from public.upload_capabilities)
    + (select count(*) from public.upload_capability_files) + (select count(*) from public.auth_attempts) = 0,
    'every Release 2 table is empty again (so nothing but the fixtures was ever in them)');
  perform pg_temp.stage0_check('S3.2', not exists (
      (select * from stage0_realrows_before except select * from stage0_realrows)
      union all (select * from stage0_realrows except select * from stage0_realrows_before)),
    'employees, stores, organizations, memberships and auth.users are byte-identical to section 0 ('
      || coalesce((select string_agg(tbl, ', ') from (select * from stage0_realrows_before
                                                        except select * from stage0_realrows) d), 'none differ') || ')');
end
$s3$;

-- @@stage0-proofs section 4: after RB-5, RB-43, RB-2, RB-1 — the catalog is section 0's
select pg_temp.stage0_deadline('section 4');
select pg_temp.stage0_check('S4.1', not exists (
    (select * from stage0_catalog_before except select * from stage0_catalog_rows)
    union all (select * from stage0_catalog_rows except select * from stage0_catalog_before)),
  'the public catalog equals section 0''s, row for row (differing: '
    || coalesce((select string_agg(kind || ' ' || ident, ', ') from (
         select * from ((select * from stage0_catalog_before except select * from stage0_catalog_rows)
                        union all (select * from stage0_catalog_rows except select * from stage0_catalog_before)) x
          limit 20) d), 'none') || ')');
select n, what from stage0_proof order by n;
