-- supabase/rehearsals/release2_stage0_4c_checked_state.sql
-- Item 4(c) plan §2.2 and §6.4: the checked state, READ-ONLY. One statement.
-- The assembler emits it twice, as P0-4C (the baseline at 01, P0′) and as
-- POST-4C (the readback after a step, POST′); only the header line differs.
-- Which state is accepted is decided in code (scripts/manual/stage0-4c-compare.mjs),
-- never here: this text only observes.
--
-- It returns one row per fact, (part, key, value), ordered by part and by
-- key in byte order, then one '#md5' row per part, an md5 over that part's
-- "key=value" lines joined by LF in byte order, and part 0's '#md5', over
-- the parts' "part=md5" lines. A null value is the text <null>. Roles and
-- objects are named, never numbered by OID. The parts:
--    1  the ledger and 01's identity
--    2  the application objects in public, their owners, public's owner and
--       ACL, and P0's catalog_fingerprint
--    3  the default ACLs, global and per schema, with the implicit default
--       for each object-creating role and type that has no global row
--    4  the roles: attributes, memberships, schema USAGE, table privileges,
--       and EXECUTE (Release 2's as exec-r2, every other as exec)
--    5  the settings: values only for an allowlist of non-secret names
--    6  the non-public dependency closure (pgcrypto, auth.uid(), auth.users)
--    7  the extensions
--    8  the event triggers, with each function's language and md5(prosrc)
--    9  the server
--   10  data, recorded: row counts, the five real-row digests as P1's
--       section 0 computes them, and the identity markers
-- It reads no setting value outside the allowlist, and returns an md5, never
-- a value, for any row of data.
with
named(rolname) as (
  select x.r from (values ('postgres'), ('anon'), ('authenticated'), ('service_role'),
                          ('authenticator'), ('supabase_read_only_user')) as x(r)
  union select pg_get_userbyid(p.proowner)::text from pg_proc p
         where p.pronamespace = 'public'::regnamespace and p.prosecdef
  union select current_user::text
  union select session_user::text
),
roles_here as (
  select r.oid, r.rolname::text as rolname from pg_roles r join named n on n.rolname = r.rolname::text
),
creators as (
  select r.oid, r.rolname::text as rolname from pg_roles r
   where r.rolname = 'postgres'
      or r.oid in (select p.proowner from pg_proc p where p.pronamespace = 'public'::regnamespace)
      or r.oid in (select c.relowner from pg_class c where c.relnamespace = 'public'::regnamespace)
      or r.oid in (select d.defaclrole from pg_default_acl d)
),
allow(name) as (
  select x.n from (values ('search_path'), ('statement_timeout'), ('lock_timeout'),
                          ('idle_in_transaction_session_timeout'), ('transaction_timeout'),
                          ('default_transaction_read_only'), ('role'), ('pgrst.db_schemas')) as x(n)
),
cat as (
-- the catalog rows, exactly as the proofs file's catalog-rows block defines them
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
),
p1 as (
  select 'row|' || m.version as key,
         coalesce(m.name, '<null>') || '|' || coalesce(md5(m.statements[1]), '<null>') || '|'
           || coalesce(octet_length(m.statements[1])::text, '<null>') || '|'
           || coalesce(cardinality(m.statements)::text, '<null>') || '|'
           || coalesce(to_jsonb(m) ->> 'created_by', '<null>') || '|'
           || (coalesce(jsonb_typeof(to_jsonb(m) -> 'idempotency_key'), 'null') = 'null')::text || '|'
           || (coalesce(jsonb_typeof(to_jsonb(m) -> 'rollback'), 'null') = 'null')::text || '|'
           || coalesce((right(m.statements[1], 1) = chr(10))::text, '<null>') as value
    from supabase_migrations.schema_migrations m
  union all
  select 'count', count(*)::text from supabase_migrations.schema_migrations m
  union all
  select 'head', coalesce(max(m.version), '<null>') from supabase_migrations.schema_migrations m
  union all
  select 'columns', coalesce(string_agg(c.column_name || ':' || c.data_type || ':' || c.is_nullable || ':'
                                        || coalesce(c.column_default, ''), ', ' order by c.ordinal_position), '')
    from information_schema.columns c
   where c.table_schema = 'supabase_migrations' and c.table_name = 'schema_migrations'
),
p2 as (
  select c.kind || '|' || c.ident as key, c.fact as value from cat c
  union all
  select 'owner|function|' || p.proname || '(' || oidvectortypes(p.proargtypes) || ')', pg_get_userbyid(p.proowner)::text
    from pg_proc p where p.pronamespace = 'public'::regnamespace
  union all
  select 'owner|relation|' || c.relname, pg_get_userbyid(c.relowner)::text
    from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f')
  union all
  select 'schema|public', pg_get_userbyid(n.nspowner)::text || '|'
           || coalesce((select string_agg(coalesce(r.rolname, 'PUBLIC') || '=' || a.privilege_type, ','
                                          order by coalesce(r.rolname, 'PUBLIC') collate "C", a.privilege_type collate "C")
                          from aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) a
                          left join pg_roles r on r.oid = a.grantee), '')
    from pg_namespace n where n.nspname = 'public'
  union all
  select 'fingerprint', (select md5(coalesce(string_agg(c.kind || chr(9) || c.ident || chr(9) || c.fact, chr(10)
                                                        order by c.kind, c.ident, c.fact), '')) from cat c)
),
p3 as (
  select 'row|' || pg_get_userbyid(d.defaclrole)::text || '|'
           || (case when d.defaclnamespace = 0 then '*' else d.defaclnamespace::regnamespace::text end) || '|'
           || d.defaclobjtype::text as key,
         coalesce((select string_agg(coalesce(g.rolname, 'PUBLIC') || '=' || a.privilege_type || '/' || coalesce(o.rolname, '?'), ','
                                     order by coalesce(g.rolname, 'PUBLIC') collate "C", a.privilege_type collate "C")
                     from aclexplode(d.defaclacl) a
                     left join pg_roles g on g.oid = a.grantee
                     left join pg_roles o on o.oid = a.grantor), '') as value
    from pg_default_acl d
  union all
  select 'implicit|' || k.rolname || '|' || t.t,
         coalesce((select string_agg(coalesce(g.rolname, 'PUBLIC') || '=' || a.privilege_type || '/' || coalesce(o.rolname, '?'), ','
                                     order by coalesce(g.rolname, 'PUBLIC') collate "C", a.privilege_type collate "C")
                     from aclexplode(acldefault(t.t::"char", k.oid)) a
                     left join pg_roles g on g.oid = a.grantee
                     left join pg_roles o on o.oid = a.grantor), '')
    from creators k cross join (values ('r'), ('S'), ('f'), ('T'), ('n')) as t(t)
   where not exists (select 1 from pg_default_acl d
                      where d.defaclrole = k.oid and d.defaclnamespace = 0 and d.defaclobjtype = t.t::"char")
),
p4 as (
  select 'attr|' || n.rolname as key,
         coalesce((select r.rolsuper::text || '|' || r.rolinherit::text || '|' || r.rolcreaterole::text || '|'
                          || r.rolcreatedb::text || '|' || r.rolcanlogin::text || '|' || r.rolreplication::text || '|'
                          || r.rolbypassrls::text || '|' || r.rolconnlimit::text
                     from pg_roles r where r.rolname::text = n.rolname), '<absent>') as value
    from named n
  union all
  select 'member|' || pg_get_userbyid(m.roleid)::text || '|' || pg_get_userbyid(m.member)::text || '|'
           || pg_get_userbyid(m.grantor)::text,
         m.admin_option::text || '|' || m.inherit_option::text || '|' || m.set_option::text
    from pg_auth_members m
   where m.roleid in (select h.oid from roles_here h) or m.member in (select h.oid from roles_here h)
  union all
  select 'usage|' || h.rolname || '|' || s.nspname, has_schema_privilege(h.oid, s.oid, 'USAGE')::text
    from roles_here h cross join pg_namespace s
   where s.nspname in ('public', 'auth', 'extensions', 'supabase_migrations')
  union all
  select 'table|' || h.rolname || '|' || t.qname,
         coalesce((select string_agg(x.p, ',' order by x.p collate "C")
                     from (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) as x(p)
                    where has_table_privilege(h.oid, t.oid, x.p)), '')
    from roles_here h
    cross join (select c.oid, s.nspname || '.' || c.relname as qname
                  from pg_class c join pg_namespace s on s.oid = c.relnamespace
                 where (s.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f'))
                    or (s.nspname = 'auth' and c.relname = 'users')
                    or (s.nspname = 'supabase_migrations' and c.relname = 'schema_migrations')) t
  union all
  select (case when s.nspname = 'public' and (p.proname like 'release2\_%' or p.proname = 'redeem_enrollment_ticket')
               then 'exec-r2|' else 'exec|' end)
           || h.rolname || '|' || s.nspname || '.' || p.proname || '(' || oidvectortypes(p.proargtypes) || ')',
         has_function_privilege(h.oid, p.oid, 'EXECUTE')::text
    from roles_here h
    cross join pg_proc p
    join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public'
      or (s.nspname = 'auth' and p.proname = 'uid')
      or (s.nspname = 'extensions' and p.proname in ('gen_random_bytes', 'digest'))
),
p5 as (
  select 'setting|' || (case when s.setdatabase = 0 then '*'
                             else coalesce((select d.datname::text from pg_database d where d.oid = s.setdatabase), '?') end)
           || '|' || (case when s.setrole = 0 then '*' else pg_get_userbyid(s.setrole)::text end)
           || '|' || split_part(c.kv, '=', 1) as key,
         (case when split_part(c.kv, '=', 1) in (select a.name from allow a)
               then substr(c.kv, strpos(c.kv, '=') + 1) else '<name only>' end) as value
    from pg_db_role_setting s cross join lateral unnest(s.setconfig) as c(kv)
   where s.setdatabase = 0 or s.setdatabase = (select d.oid from pg_database d where d.datname = current_database())
  union all
  select 'session|' || a.name, coalesce(current_setting(a.name, true), '<unset>') from allow a
),
p6 as (
  select 'pgcrypto' as key,
         coalesce((select e.extversion || '|' || e.extnamespace::regnamespace::text from pg_extension e where e.extname = 'pgcrypto'),
                  '<absent>') as value
  union all
  select 'fn|' || x.sig,
         coalesce((select pg_get_userbyid(p.proowner)::text || '|' || p.provolatile::text || '|' || md5(p.prosrc)
                     from pg_proc p where p.oid = to_regprocedure(x.sig)), '<absent>')
    from (values ('extensions.gen_random_bytes(integer)'), ('extensions.digest(bytea, text)'),
                 ('extensions.digest(text, text)'), ('auth.uid()')) as x(sig)
  union all
  select 'authusers-col|' || a.attname,
         format_type(a.atttypid, a.atttypmod) || '|' || a.attnotnull::text || '|' || coalesce(pg_get_expr(d.adbin, d.adrelid), '')
    from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
   where a.attrelid = 'auth.users'::regclass and a.attname in ('instance_id', 'id', 'aud', 'role', 'email') and not a.attisdropped
  union all
  select 'authusers-notnull-nodefault',
         coalesce((select string_agg(a.attname::text, ',' order by a.attname::text collate "C")
                     from pg_attribute a
                    where a.attrelid = 'auth.users'::regclass and a.attnum > 0 and not a.attisdropped
                      and a.attnotnull and not a.atthasdef and a.attidentity = '' and a.attgenerated = ''), '')
  union all
  select 'authusers-user-triggers', (select count(*)::text from pg_trigger t where t.tgrelid = 'auth.users'::regclass and not t.tgisinternal)
),
p7 as (
  select 'ext|' || e.extname as key, e.extversion || '|' || e.extnamespace::regnamespace::text as value from pg_extension e
),
p8 as (
  select 'evt|' || t.evtname as key,
         t.evtevent || '|' || t.evtenabled::text || '|' || coalesce(array_to_string(t.evttags, ','), '') || '|'
           || p.proname || '|' || pg_get_userbyid(p.proowner)::text || '|' || l.lanname || '|' || md5(p.prosrc) || '|'
           || coalesce((select e.extname || '@' || e.extversion
                          from pg_depend dp join pg_extension e on e.oid = dp.refobjid
                         where dp.classid = 'pg_proc'::regclass and dp.objid = p.oid
                           and dp.refclassid = 'pg_extension'::regclass and dp.deptype = 'e'), '') as value
    from pg_event_trigger t join pg_proc p on p.oid = t.evtfoid join pg_language l on l.oid = p.prolang
),
p9 as (
  select 'version' as key, version() as value
  union all
  select 'server_version_num', current_setting('server_version_num')
),
p10 as (
  select 'count|auth.users' as key, (select count(*)::text from auth.users t) as value
  union all select 'count|public.employees', (select count(*)::text from public.employees t)
  union all select 'count|public.stores', (select count(*)::text from public.stores t)
  union all select 'count|public.organizations', (select count(*)::text from public.organizations t)
  union all select 'count|public.memberships', (select count(*)::text from public.memberships t)
  union all select 'count|public.orders', (select count(*)::text from public.orders t)
  union all select 'count|public.settings', (select count(*)::text from public.settings t)
  union all select 'count|public.addons', (select count(*)::text from public.addons t)
  union all select 'count|public.discounts', (select count(*)::text from public.discounts t)
  union all select 'count|public.outsourced_products', (select count(*)::text from public.outsourced_products t)
  union all select 'count|public.paper_types', (select count(*)::text from public.paper_types t)
  union all select 'count|public.print_jobs', (select count(*)::text from public.print_jobs t)
  union all select 'count|public.sheet_prices', (select count(*)::text from public.sheet_prices t)
  union all select 'count|public.pending_jobs', (select count(*)::text from public.pending_jobs t)
  union all select 'count|public.device_enrollments', (select count(*)::text from public.device_enrollments t)
  union all select 'count|public.enrollment_tickets', (select count(*)::text from public.enrollment_tickets t)
  union all select 'count|public.staff_sessions', (select count(*)::text from public.staff_sessions t)
  union all select 'count|public.upload_capabilities', (select count(*)::text from public.upload_capabilities t)
  union all select 'count|public.upload_capability_files', (select count(*)::text from public.upload_capability_files t)
  union all select 'count|public.auth_attempts', (select count(*)::text from public.auth_attempts t)
  union all select 'digest|public.employees', (select md5(coalesce(string_agg(t::text, chr(10) order by t.id), '')) from public.employees t)
  union all select 'digest|public.stores', (select md5(coalesce(string_agg(t::text, chr(10) order by t.id), '')) from public.stores t)
  union all select 'digest|public.organizations', (select md5(coalesce(string_agg(t::text, chr(10) order by t.id), '')) from public.organizations t)
  union all select 'digest|public.memberships', (select md5(coalesce(string_agg(t::text, chr(10) order by t.id), '')) from public.memberships t)
  union all select 'digest|auth.users', (select md5(coalesce(string_agg(t::text, chr(10) order by t.id), '')) from auth.users t)
  union all select 'free_pins', (select count(*)::text from generate_series(1000, 9999) g
                                  where not exists (select 1 from public.employees e where e.pin = lpad(g::text, 4, '0')))
  union all select 'stores_without_org', (select count(*)::text from public.stores s where s.org_id is null)
  union all select 'probe_slug_absent', (not exists (select 1 from public.stores s where s.slug = 'r2-probe-nonexistent'))::text
  union all select 'nil_job_absent', (not exists (select 1 from public.pending_jobs j where j.id = '00000000-0000-0000-0000-000000000000'))::text
  union all select 'rehearsal_marker', (to_regnamespace('stage0_rehearsal') is not null)::text
),
obs(part, key, value) as (
  select 1, k.key, k.value from p1 k
  union all select 2, k.key, k.value from p2 k
  union all select 3, k.key, k.value from p3 k
  union all select 4, k.key, k.value from p4 k
  union all select 5, k.key, k.value from p5 k
  union all select 6, k.key, k.value from p6 k
  union all select 7, k.key, k.value from p7 k
  union all select 8, k.key, k.value from p8 k
  union all select 9, k.key, k.value from p9 k
  union all select 10, k.key, k.value from p10 k
),
md5s as (
  select g.part,
         md5(coalesce((select string_agg(o.key || '=' || coalesce(o.value, '<null>'), chr(10) order by o.key collate "C")
                         from obs o where o.part = g.part), '')) as m
    from generate_series(1, 10) as g(part)
)
select u.part, u.key, u.value
  from (select o.part, o.key, coalesce(o.value, '<null>') as value from obs o
        union all
        select s.part, '#md5', s.m from md5s s
        union all
        select 0, '#md5', (select md5(string_agg(s.part::text || '=' || s.m, chr(10) order by s.part)) from md5s s)) u
 order by u.part, u.key collate "C";
