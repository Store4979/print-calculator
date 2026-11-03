-- supabase/rehearsals/release2_stage0_4c_build00.sql
-- Item 4(c) plan §2.1: BUILD-00, READ-ONLY. One statement. The rehearsal
-- project's real initial shape, read as catalog metadata, before BUILD-01:
--   public       every relation, function and type in public, with its owner
--   ledger       supabase_migrations.schema_migrations: whether the schema and
--                table exist, the relation's kind, owner and RLS flags, its
--                columns (from pg_attribute, which does not depend on the
--                reader's grants), constraints and triggers; then its rows,
--                through one guarded read (below)
--   defaults     every pg_default_acl row, and each object-creating role's
--                implicit default where it has no global row. Each ACL entry
--                is grantee=PRIVILEGE/grantor, with a * after the privilege
--                when it carries the grant option. The key keeps the catalog's
--                object-type letter; acldefault's own letter for a sequence
--                is s (its S is a foreign server)
--   roles        the named roles' attributes, and the ACLs of public, auth,
--                storage, extensions and supabase_migrations
--   extensions   every extension
--   events       every event trigger, with its function's md5(prosrc)
--   buckets      storage.buckets: columns (type, NOT NULL, default, identity,
--                generated), constraints, unique indexes, triggers (with each
--                function's owner), RLS and forced RLS, and its owner
--   objects      storage.objects: kind, owner, the bucket_id column, RLS, and
--                every policy's name
--   publication  supabase_realtime: owner, FOR ALL TABLES, the action flags,
--                pubviaroot, and every member table
--   authusers    auth.users: owner, RLS, the fixture columns, every NOT NULL
--                column without a default, its user triggers
--   schemas      whether supabase_migrations and stage0_rehearsal exist, and
--                their owners
-- It returns (part, key, value) rows ordered by part and key in byte order.
-- Facts that depend on the reader (rows under RLS, current_user's
-- authority) are BUILD-00W's, except the ledger read's status. The ledger's
-- rows are the one stored rows this text reads; it reads no other platform
-- table's.
--
-- The guarded ledger read: `status` is, by the first that holds,
--   absent-schema      no supabase_migrations schema
--   denied-schema      the reader has no USAGE on it
--   absent-table       no schema_migrations relation in it
--   unsupported-shape  not an ordinary table with exactly production's six
--                      columns
--   denied-read        the reader has no table-level SELECT on it
--   hidden-read        row security is active for the reader, so rows may be
--                      hidden
--   empty, populated   the read ran: no row, or at least one
-- Only the last two run query_to_xml, on the one reviewed literal (M-6f pins
-- it), and `rows` is its result: each row's version, name, the md5, octet
-- length and element count of its statements, created_by and two null flags,
-- never a statement's text. Otherwise `rows` is <not read>. A read that fails
-- for any other reason fails this whole statement: the query route returns an
-- error, not a status.
with
named(rolname) as (
  select x.r from (values ('postgres'), ('anon'), ('authenticated'), ('service_role'),
                          ('authenticator'), ('supabase_read_only_user'), ('supabase_admin'),
                          ('supabase_storage_admin'), ('supabase_auth_admin')) as x(r)
),
creators as (
  select r.oid, r.rolname::text as rolname from pg_roles r
   where r.rolname = 'postgres' or r.oid in (select d.defaclrole from pg_default_acl d)
),
ledger_rel as (
  select c.oid, c.relkind::text as kind,
         c.relkind::text || '|' || pg_get_userbyid(c.relowner)::text || '|' || c.relrowsecurity::text || '|' || c.relforcerowsecurity::text as fact
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'supabase_migrations' and c.relname = 'schema_migrations'
),
ledger_cols as (
  select coalesce(string_agg(a.attname::text || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text || ':'
                             || coalesce(pg_get_expr(d.adbin, d.adrelid), ''), ', ' order by a.attnum), '') as columns
    from ledger_rel l
    join pg_attribute a on a.attrelid = l.oid and a.attnum > 0 and not a.attisdropped
    left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
),
ledger_guard as (
  select case
           when to_regnamespace('supabase_migrations') is null then 'absent-schema'
           when not has_schema_privilege('supabase_migrations', 'USAGE') then 'denied-schema'
           when to_regclass('supabase_migrations.schema_migrations') is null then 'absent-table'
           when (select l.kind from ledger_rel l) <> 'r'
                or (select s.columns from ledger_cols s)
                   <> 'version:text:true:, statements:text[]:false:, name:text:false:, created_by:text:false:, idempotency_key:text:false:, rollback:text[]:false:'
             then 'unsupported-shape'
           when not has_table_privilege('supabase_migrations.schema_migrations', 'SELECT') then 'denied-read'
           when row_security_active('supabase_migrations.schema_migrations') then 'hidden-read'
           else 'readable'
         end as verdict
),
ledger_read as (
  select g.verdict,
         case when g.verdict = 'readable'
              then query_to_xml('select m.version, m.name, md5(m.statements[1]) as statements_md5, octet_length(m.statements[1]) as statements_bytes, cardinality(m.statements) as statements_count, m.created_by, m.idempotency_key is null as idempotency_key_null, m.rollback is null as rollback_null from supabase_migrations.schema_migrations m order by m.version', true, false, '')::text
         end as doc
    from ledger_guard g
),
obs(part, key, value) as (
  select 'public', 'relation|' || c.relname, c.relkind::text || '|' || pg_get_userbyid(c.relowner)::text
    from pg_class c where c.relnamespace = 'public'::regnamespace
  union all
  select 'public', 'function|' || p.proname || '(' || oidvectortypes(p.proargtypes) || ')', pg_get_userbyid(p.proowner)::text
    from pg_proc p where p.pronamespace = 'public'::regnamespace
  union all
  select 'public', 'type|' || t.typname, pg_get_userbyid(t.typowner)::text
    from pg_type t where t.typnamespace = 'public'::regnamespace and t.typrelid = 0 and t.typelem = 0
  union all
  select 'ledger', 'schema', (to_regnamespace('supabase_migrations') is not null)::text
  union all
  select 'ledger', 'table', (exists (select 1 from ledger_rel l))::text
  union all
  select 'ledger', 'relation', coalesce((select l.fact from ledger_rel l), '')
  union all
  select 'ledger', 'columns', (select s.columns from ledger_cols s)
  union all
  select 'ledger', 'constraint|' || k.conname, k.contype::text || '|' || pg_get_constraintdef(k.oid)
    from pg_constraint k join ledger_rel l on l.oid = k.conrelid
  union all
  select 'ledger', 'trigger|' || t.tgname, t.tgenabled::text || '|' || pg_get_triggerdef(t.oid)
    from pg_trigger t join ledger_rel l on l.oid = t.tgrelid
   where not t.tgisinternal
  union all
  select 'ledger', 'status', (case when r.verdict <> 'readable' then r.verdict
                                   when strpos(r.doc, '<row>') > 0 then 'populated' else 'empty' end)
    from ledger_read r
  union all
  select 'ledger', 'rows', coalesce(r.doc, '<not read>') from ledger_read r
  union all
  select 'defaults', 'row|' || pg_get_userbyid(d.defaclrole)::text || '|'
           || (case when d.defaclnamespace = 0 then '*' else d.defaclnamespace::regnamespace::text end) || '|' || d.defaclobjtype::text,
         coalesce((select string_agg(coalesce(g.rolname, 'PUBLIC') || '=' || a.privilege_type || (case when a.is_grantable then '*' else '' end)
                                       || '/' || coalesce(o.rolname, '?'), ','
                                     order by coalesce(g.rolname, 'PUBLIC') collate "C", a.privilege_type collate "C",
                                              coalesce(o.rolname, '?') collate "C", a.is_grantable)
                     from aclexplode(d.defaclacl) a
                     left join pg_roles g on g.oid = a.grantee
                     left join pg_roles o on o.oid = a.grantor), '')
    from pg_default_acl d
  union all
  select 'defaults', 'implicit|' || k.rolname || '|' || t.t,
         coalesce((select string_agg(coalesce(g.rolname, 'PUBLIC') || '=' || a.privilege_type || (case when a.is_grantable then '*' else '' end)
                                       || '/' || coalesce(o.rolname, '?'), ','
                                     order by coalesce(g.rolname, 'PUBLIC') collate "C", a.privilege_type collate "C",
                                              coalesce(o.rolname, '?') collate "C", a.is_grantable)
                     from aclexplode(acldefault(t.acl_code::"char", k.oid)) a
                     left join pg_roles g on g.oid = a.grantee
                     left join pg_roles o on o.oid = a.grantor), '')
    from creators k cross join (values ('r', 'r'), ('S', 's'), ('f', 'f'), ('T', 'T'), ('n', 'n')) as t(t, acl_code)
   where not exists (select 1 from pg_default_acl d
                      where d.defaclrole = k.oid and d.defaclnamespace = 0 and d.defaclobjtype = t.t::"char")
  union all
  select 'roles', 'attr|' || n.rolname,
         coalesce((select r.rolsuper::text || '|' || r.rolinherit::text || '|' || r.rolcreaterole::text || '|'
                          || r.rolcreatedb::text || '|' || r.rolcanlogin::text || '|' || r.rolreplication::text || '|'
                          || r.rolbypassrls::text
                     from pg_roles r where r.rolname::text = n.rolname), '<absent>')
    from named n
  union all
  select 'roles', 'schema|' || s.nspname,
         pg_get_userbyid(s.nspowner)::text || '|'
           || coalesce((select string_agg(coalesce(g.rolname, 'PUBLIC') || '=' || a.privilege_type || (case when a.is_grantable then '*' else '' end), ','
                                          order by coalesce(g.rolname, 'PUBLIC') collate "C", a.privilege_type collate "C", a.is_grantable)
                          from aclexplode(coalesce(s.nspacl, acldefault('n', s.nspowner))) a
                          left join pg_roles g on g.oid = a.grantee), '')
    from pg_namespace s where s.nspname in ('public', 'auth', 'storage', 'extensions', 'supabase_migrations')
  union all
  select 'extensions', 'ext|' || e.extname, e.extversion || '|' || e.extnamespace::regnamespace::text from pg_extension e
  union all
  select 'events', 'evt|' || t.evtname,
         t.evtevent || '|' || t.evtenabled::text || '|' || coalesce(array_to_string(t.evttags, ','), '') || '|'
           || p.proname || '|' || pg_get_userbyid(p.proowner)::text || '|' || l.lanname || '|' || md5(p.prosrc)
    from pg_event_trigger t join pg_proc p on p.oid = t.evtfoid join pg_language l on l.oid = p.prolang
  union all
  select 'buckets', 'present', (to_regclass('storage.buckets') is not null)::text
  union all
  select 'buckets', 'column|' || a.attname,
         format_type(a.atttypid, a.atttypmod) || '|' || a.attnotnull::text || '|' || coalesce(pg_get_expr(d.adbin, d.adrelid), '') || '|'
           || a.attidentity::text || '|' || a.attgenerated::text
    from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
   where a.attrelid = to_regclass('storage.buckets') and a.attnum > 0 and not a.attisdropped
  union all
  select 'buckets', 'constraint|' || k.conname, k.contype::text || '|' || pg_get_constraintdef(k.oid)
    from pg_constraint k where k.conrelid = to_regclass('storage.buckets')
  union all
  select 'buckets', 'unique-index|' || c.relname, pg_get_indexdef(c.oid)
    from pg_index i join pg_class c on c.oid = i.indexrelid
   where i.indrelid = to_regclass('storage.buckets') and i.indisunique
  union all
  select 'buckets', 'trigger|' || t.tgname, t.tgenabled::text || '|' || pg_get_triggerdef(t.oid) || '|' || pg_get_userbyid(p.proowner)::text
    from pg_trigger t join pg_proc p on p.oid = t.tgfoid
   where t.tgrelid = to_regclass('storage.buckets') and not t.tgisinternal
  union all
  select 'buckets', 'table', c.relrowsecurity::text || '|' || c.relforcerowsecurity::text || '|' || pg_get_userbyid(c.relowner)::text
    from pg_class c where c.oid = to_regclass('storage.buckets')
  union all
  select 'objects', 'table', c.relkind::text || '|' || pg_get_userbyid(c.relowner)::text || '|' || c.relrowsecurity::text || '|' || c.relforcerowsecurity::text
    from pg_class c where c.oid = to_regclass('storage.objects')
  union all
  select 'objects', 'column|bucket_id', format_type(a.atttypid, a.atttypmod)
    from pg_attribute a where a.attrelid = to_regclass('storage.objects') and a.attname = 'bucket_id' and not a.attisdropped
  union all
  select 'objects', 'policy|' || pol.polname, pol.polcmd::text
    from pg_policy pol where pol.polrelid = to_regclass('storage.objects')
  union all
  select 'publication', 'pub|' || p.pubname,
         pg_get_userbyid(p.pubowner)::text || '|' || p.puballtables::text || '|' || p.pubinsert::text || '|' || p.pubupdate::text || '|'
           || p.pubdelete::text || '|' || p.pubtruncate::text || '|' || p.pubviaroot::text
    from pg_publication p where p.pubname = 'supabase_realtime'
  union all
  select 'publication', 'member|' || n.nspname || '.' || c.relname, p.pubname
    from pg_publication_rel pr join pg_publication p on p.oid = pr.prpubid
    join pg_class c on c.oid = pr.prrelid join pg_namespace n on n.oid = c.relnamespace
   where p.pubname = 'supabase_realtime'
  union all
  select 'authusers', 'table', pg_get_userbyid(c.relowner)::text || '|' || c.relrowsecurity::text || '|' || c.relforcerowsecurity::text
    from pg_class c where c.oid = to_regclass('auth.users')
  union all
  select 'authusers', 'column|' || a.attname, format_type(a.atttypid, a.atttypmod) || '|' || a.attnotnull::text || '|' || coalesce(pg_get_expr(d.adbin, d.adrelid), '')
    from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
   where a.attrelid = to_regclass('auth.users') and a.attname in ('instance_id', 'id', 'aud', 'role', 'email') and not a.attisdropped
  union all
  select 'authusers', 'notnull-nodefault',
         coalesce((select string_agg(a.attname::text, ',' order by a.attname::text collate "C")
                     from pg_attribute a
                    where a.attrelid = to_regclass('auth.users') and a.attnum > 0 and not a.attisdropped
                      and a.attnotnull and not a.atthasdef and a.attidentity = '' and a.attgenerated = ''), '')
  union all
  select 'authusers', 'user-triggers', (select count(*)::text from pg_trigger t where t.tgrelid = to_regclass('auth.users') and not t.tgisinternal)
  union all
  select 'schemas', 'schema|' || x.n, coalesce((select pg_get_userbyid(s.nspowner)::text from pg_namespace s where s.nspname = x.n), '<absent>')
    from (values ('supabase_migrations'), ('stage0_rehearsal')) as x(n)
)
select o.part, o.key, coalesce(o.value, '<null>') as value from obs o order by o.part collate "C", o.key collate "C";
