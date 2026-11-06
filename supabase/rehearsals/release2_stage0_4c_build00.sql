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
--                function's owner), RLS and forced RLS, and its owner. For each
--                unique index, `arbiter|<name>` reports the catalog properties an
--                ON CONFLICT arbiter depends on: key columns (<expression> for an
--                expression), indnatts, indnkeyatts, access method, indisvalid,
--                indisready, indislive, indimmediate, indisprimary, whether it has
--                expressions, whether it has a predicate, and its constraint's
--                contype, condeferrable, condeferred and convalidated, or <no
--                constraint>
--   objects      storage.objects: kind, owner, the bucket_id column, RLS, and
--                every policy's name
--   publication  supabase_realtime: owner, FOR ALL TABLES, the action flags,
--                pubviaroot, and every member table
--   authusers    auth.users: owner, RLS, the fixture columns, every NOT NULL
--                column without a default, its user triggers
--   schemas      whether supabase_migrations and stage0_rehearsal exist, and
--                their owners
-- What runs on BUILD-01's INSERTs, for storage.buckets (part buckets) and auth.users
-- (part authusers). B1 binds these rows exactly (plan §2.1, §0.7):
--   relation                          relkind, relispartition, relhassubclass, its parents
--   column-type|<column>              every column: attidentity, attgenerated, its type
--   default|<column>                  every stored default or generated expression:
--                                     pg_get_expr
--   index|<name>                      every index: indisunique, indisvalid, pg_get_indexdef
--   index-expr|<name>                 its expressions, pg_get_expr, where it has any
--   index-pred|<name>                 its predicate, pg_get_expr, where it has one
--   trigger|<name>                    every trigger that is not internal, enabled or
--                                     not: tgenabled, pg_get_triggerdef, its function's
--                                     owner
--   check|<name>                      every CHECK: pg_get_constraintdef
--   rule|<name>                       every rewrite rule: ev_type, ev_enabled, is_instead,
--                                     pg_get_ruledef
--   domain-check|<domain>|<name>      each CHECK of a domain the walk below reaches
--   domain-default|<domain>           each default of one: pg_get_expr
--   trigger-function|<name>|<fn>      each function reached from a trigger on a path
--   check-function|<name>|<fn>        with no type on it (below); the same from a CHECK
--   route|<origin>|<name>|<kind>|<id> every other object the walk reaches
-- THE WALK starts at each column's type and collation, each stored default or generated
-- expression, each index, each exclusion constraint, each CHECK and each trigger. It
-- follows every pg_depend row but those naming a schema, a language or an extension, and
-- what pg_depend does not record: an operator's oprcode, an exclusion constraint's
-- operators, a trigger's function, a domain's base type and CHECKs, an array's element. It
-- takes the first two only for an operator created after initdb (oid 16384 or above), so a
-- built-in operator ends the walk. PostgreSQL records no dependency on a pinned object, so a
-- pinned built-in function shows here only through those edges. It stops at a relation.
-- A path is STRICT from a column, default, index or exclusion, and from any type on it.
-- <kind> is pg_identify_object's type. Each route row's value starts with the object's
-- schema, then: a function's facts; an operator's oprcode; a type's typtype and typcategory.
-- It leaves out the types and collations of pg_catalog that end a walk.
-- A function's facts are language, owner, prosecdef, provolatile and proconfig, md5(prosrc)
-- and md5(pg_get_functiondef), a line feed, and the definition itself, so that review
-- reads what it binds. String-defined bodies, including PL/pgSQL bodies, need not record
-- what they call, and a parsed SQL-standard body can: the walk follows what is recorded,
-- and review reads the rest (plan §0.7). This text judges nothing: the comparator and
-- BUILD-01's first step judge these rows, so what they accept can change without a new
-- reading. It executes no stored expression.
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
with recursive
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
reviewed_tables as (
  select 'buckets' as part, to_regclass('storage.buckets') as rel
  union all
  select 'authusers', to_regclass('auth.users')
),
reviewed_triggers as (
  select r.part, r.rel, t.oid, t.tgname, t.tgfoid, t.tgenabled
    from reviewed_tables r join pg_trigger t on t.tgrelid = r.rel
   where not t.tgisinternal
),
reviewed_checks as (
  select r.part, r.rel, k.oid, k.conname
    from reviewed_tables r join pg_constraint k on k.conrelid = r.rel
   where k.contype = 'c'
),
reviewed_exclusions as (
  select r.part, r.rel, k.oid, k.conname
    from reviewed_tables r join pg_constraint k on k.conrelid = r.rel
   where k.contype = 'x'
),
reviewed_columns as (
  select r.part, r.rel, a.attname, a.attnum, a.atttypid, a.atttypmod, a.attcollation, a.attidentity, a.attgenerated
    from reviewed_tables r join pg_attribute a on a.attrelid = r.rel
   where a.attnum > 0 and not a.attisdropped
),
reviewed_defaults as (
  select c.part, c.rel, c.attname, d.oid, d.adbin, d.adrelid
    from reviewed_columns c join pg_attrdef d on d.adrelid = c.rel and d.adnum = c.attnum
),
reviewed_indexes as (
  select r.part, r.rel, c.oid, c.relname, i.indisunique, i.indisvalid, i.indexprs, i.indpred, i.indrelid
    from reviewed_tables r join pg_index i on i.indrelid = r.rel join pg_class c on c.oid = i.indexrelid
),
walk_edges(from_class, from_obj, to_class, to_obj) as (
  select d.classid, d.objid, d.refclassid, d.refobjid
    from pg_depend d
   where d.refclassid not in ('pg_namespace'::regclass, 'pg_language'::regclass, 'pg_extension'::regclass)
  union
  select 'pg_operator'::regclass::oid, o.oid, 'pg_proc'::regclass::oid, o.oprcode::oid from pg_operator o where o.oprcode::oid <> 0 and o.oid >= 16384
  union
  select 'pg_constraint'::regclass::oid, k.oid, 'pg_operator'::regclass::oid, x.op from pg_constraint k cross join lateral unnest(k.conexclop) as x(op) where x.op >= 16384
  union
  select 'pg_trigger'::regclass::oid, t.oid, 'pg_proc'::regclass::oid, t.tgfoid from pg_trigger t
  union
  select 'pg_type'::regclass::oid, t.oid, 'pg_type'::regclass::oid, t.typbasetype from pg_type t where t.typtype = 'd'
  union
  select 'pg_type'::regclass::oid, t.oid, 'pg_type'::regclass::oid, t.typelem from pg_type t where t.typcategory = 'A' and t.typelem <> 0
  union
  select 'pg_type'::regclass::oid, k.contypid, 'pg_constraint'::regclass::oid, k.oid from pg_constraint k where k.contypid <> 0
),
walk(part, rel, origin, name, classid, objid, strict, is_root) as (
  select c.part, c.rel, 'column'::text, c.attname::text, 'pg_type'::regclass::oid, c.atttypid, true, true from reviewed_columns c
  union
  select c.part, c.rel, 'column', c.attname::text, 'pg_collation'::regclass::oid, c.attcollation, true, true from reviewed_columns c where c.attcollation <> 0
  union
  select d.part, d.rel, 'default', d.attname::text, 'pg_attrdef'::regclass::oid, d.oid, true, true from reviewed_defaults d
  union
  select i.part, i.rel, 'index', i.relname::text, 'pg_class'::regclass::oid, i.oid, true, true from reviewed_indexes i
  union
  select x.part, x.rel, 'exclusion', x.conname::text, 'pg_constraint'::regclass::oid, x.oid, true, true from reviewed_exclusions x
  union
  select k.part, k.rel, 'check', k.conname::text, 'pg_constraint'::regclass::oid, k.oid, false, true from reviewed_checks k
  union
  select t.part, t.rel, 'trigger', t.tgname::text, 'pg_trigger'::regclass::oid, t.oid, false, true from reviewed_triggers t
  union
  select w.part, w.rel, w.origin, w.name, e.to_class, e.to_obj, w.strict or e.to_class = 'pg_type'::regclass::oid, false
    from walk w join walk_edges e on e.from_class = w.classid and e.from_obj = w.objid
   where w.is_root or w.classid <> 'pg_class'::regclass::oid
),
walked as (
  select w.part, w.origin, w.name, w.classid, w.objid, bool_or(w.strict) as strict, i.type as kind, i.schema as schema_name, i.identity
    from walk w cross join lateral pg_identify_object(w.classid, w.objid, 0) i
   where not (w.is_root and w.origin <> 'column')
     and not (w.classid = 'pg_class'::regclass::oid and w.objid = w.rel::oid)
   group by w.part, w.origin, w.name, w.classid, w.objid, i.type, i.schema, i.identity
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
  select 'buckets', 'arbiter|' || c.relname,
         coalesce((select string_agg(coalesce(a.attname::text, '<expression>'), ',' order by x.ord)
                     from unnest(i.indkey::int2[]) with ordinality as x(attnum, ord)
                     left join pg_attribute a on a.attrelid = i.indrelid and a.attnum = x.attnum
                    where x.ord <= i.indnkeyatts), '') || '|'
           || i.indnatts::text || '|' || i.indnkeyatts::text || '|' || m.amname::text || '|'
           || i.indisvalid::text || '|' || i.indisready::text || '|' || i.indislive::text || '|'
           || i.indimmediate::text || '|' || i.indisprimary::text || '|'
           || (i.indexprs is not null)::text || '|' || (i.indpred is not null)::text || '|'
           || coalesce((select string_agg(k.contype::text || '|' || k.condeferrable::text || '|' || k.condeferred::text || '|' || k.convalidated::text, ',')
                          from pg_constraint k
                         where k.conindid = c.oid and k.conrelid = i.indrelid and k.contype in ('p', 'u', 'x')), '<no constraint>')
    from pg_index i
    join pg_class c on c.oid = i.indexrelid
    join pg_am m on m.oid = c.relam
   where i.indrelid = to_regclass('storage.buckets') and i.indisunique
  union all
  select t.part, 'trigger|' || t.tgname, t.tgenabled::text || '|' || pg_get_triggerdef(t.oid) || '|' || pg_get_userbyid(p.proowner)::text
    from reviewed_triggers t join pg_proc p on p.oid = t.tgfoid
  union all
  select c.part, 'check|' || c.conname, pg_get_constraintdef(c.oid) from reviewed_checks c
  union all
  select w.part,
         (case when w.origin in ('check', 'trigger') and not w.strict then w.origin || '-function|' || w.name || '|' else 'route|' || w.origin || '|' || w.name || '|function|' end)
           || n.nspname || '.' || p.proname || '(' || oidvectortypes(p.proargtypes) || ')',
         (case when w.origin in ('check', 'trigger') and not w.strict then '' else n.nspname::text || '|' end)
           || l.lanname::text || '|' || pg_get_userbyid(p.proowner)::text || '|' || p.prosecdef::text || '|' || p.provolatile::text || '|'
           || coalesce(array_to_string(p.proconfig, ','), '') || '|' || md5(p.prosrc) || '|' || md5(pg_get_functiondef(p.oid)) || chr(10) || pg_get_functiondef(p.oid)
    from walked w join pg_proc p on w.classid = 'pg_proc'::regclass::oid and p.oid = w.objid join pg_namespace n on n.oid = p.pronamespace join pg_language l on l.oid = p.prolang
  union all
  select w.part, 'route|' || w.origin || '|' || w.name || '|' || w.kind || '|' || w.identity,
         coalesce(w.schema_name, '') || '|'
           || coalesce((select o.oprcode::regprocedure::text from pg_operator o where w.classid = 'pg_operator'::regclass::oid and o.oid = w.objid),
                       (select t.typtype::text || t.typcategory::text from pg_type t where w.classid = 'pg_type'::regclass::oid and t.oid = w.objid), '')
    from walked w
   where w.classid <> 'pg_proc'::regclass::oid
     and not (w.classid = 'pg_type'::regclass::oid and w.schema_name = 'pg_catalog' and exists (select 1 from pg_type t where t.oid = w.objid and t.typtype = 'b'))
     and not (w.classid = 'pg_collation'::regclass::oid and w.schema_name = 'pg_catalog')
  union all
  select r.part, 'relation',
         c.relkind::text || '|' || c.relispartition::text || '|' || c.relhassubclass::text || '|' || (select count(*)::text from pg_inherits h where h.inhrelid = c.oid)
    from reviewed_tables r join pg_class c on c.oid = r.rel
  union all
  select c.part, 'column-type|' || c.attname, c.attidentity::text || '|' || c.attgenerated::text || '|' || format_type(c.atttypid, c.atttypmod) from reviewed_columns c
  union all
  select d.part, 'default|' || d.attname, pg_get_expr(d.adbin, d.adrelid) from reviewed_defaults d
  union all
  select i.part, 'index|' || i.relname, i.indisunique::text || '|' || i.indisvalid::text || '|' || pg_get_indexdef(i.oid) from reviewed_indexes i
  union all
  select i.part, 'index-expr|' || i.relname, pg_get_expr(i.indexprs, i.indrelid) from reviewed_indexes i where i.indexprs is not null
  union all
  select i.part, 'index-pred|' || i.relname, pg_get_expr(i.indpred, i.indrelid) from reviewed_indexes i where i.indpred is not null
  union all
  select r.part, 'rule|' || w.rulename, w.ev_type::text || '|' || w.ev_enabled::text || '|' || w.is_instead::text || '|' || pg_get_ruledef(w.oid)
    from reviewed_tables r join pg_rewrite w on w.ev_class = r.rel
  union all
  select d.part, 'domain-check|' || d.contypid::regtype::text || '|' || k.conname, pg_get_constraintdef(k.oid)
    from (select distinct w.part, c.oid, c.contypid
            from walked w join pg_constraint c on w.classid = 'pg_constraint'::regclass::oid and c.oid = w.objid
           where c.contypid <> 0) d
    join pg_constraint k on k.oid = d.oid
  union all
  select d.part, 'domain-default|' || d.oid::regtype::text, pg_get_expr(t.typdefaultbin, 0)
    from (select distinct w.part, w.objid as oid from walked w where w.classid = 'pg_type'::regclass::oid) d
    join pg_type t on t.oid = d.oid
   where t.typtype = 'd' and t.typdefaultbin is not null
  union all
  select 'authusers', 'constraint|' || k.conname, k.contype::text || '|' || pg_get_constraintdef(k.oid)
    from pg_constraint k where k.conrelid = to_regclass('auth.users')
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
