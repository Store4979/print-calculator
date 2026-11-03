-- supabase/rehearsals/release2_stage0_4c_build00w.sql
-- Item 4(c) plan §2.1: BUILD-00W, READ-ONLY, sent from W without read_only,
-- exactly as BUILD-01 will be sent, so that it observes the role BUILD-01
-- will run as. One statement. It reads, as that role:
--   role         its name, its attributes, and its memberships with their
--                admin, inherit and set options
--   buckets      its USAGE on storage; INSERT on each column the two bucket
--                INSERTs supply, UPDATE on the four the conflict updates,
--                SELECT on the table; whether RLS applies to it (it applies
--                unless the role owns the table or has BYPASSRLS, and RLS is
--                not forced); and whether either target row (job-files,
--                customer-uploads) exists, as this role sees the table
--   objects      whether it holds the owner's privileges on storage.objects
--   publication  whether it holds supabase_realtime's owner's privileges
--   authusers    INSERT and SELECT on auth.users, REFERENCES on its id, and
--                whether RLS applies to it
--   database     CREATE on this database
-- It returns (part, key, value) rows ordered by part and key in byte order.
-- It sends no DDL, no write and no capability probe.
with
me as (select r.oid, r.rolname::text as rolname, r.rolsuper, r.rolbypassrls from pg_roles r where r.rolname = current_user),
obs(part, key, value) as (
  select 'role', 'name', (select m.rolname from me m)
  union all
  select 'role', 'session', session_user::text
  union all
  select 'role', 'attr', (select r.rolsuper::text || '|' || r.rolinherit::text || '|' || r.rolcreaterole::text || '|' || r.rolcreatedb::text
                                 || '|' || r.rolcanlogin::text || '|' || r.rolreplication::text || '|' || r.rolbypassrls::text
                            from pg_roles r where r.rolname = current_user)
  union all
  select 'role', 'member|' || pg_get_userbyid(a.roleid)::text,
         a.admin_option::text || '|' || a.inherit_option::text || '|' || a.set_option::text || '|' || pg_get_userbyid(a.grantor)::text
    from pg_auth_members a where a.member = (select m.oid from me m)
  union all
  select 'role', 'tx_read_only', current_setting('transaction_read_only')
  union all
  select 'buckets', 'schema_usage', coalesce((select has_schema_privilege(n.oid, 'USAGE')::text from pg_namespace n where n.nspname = 'storage'), '<absent>')
  union all
  select 'buckets', 'insert|' || x.c, coalesce((select has_column_privilege(c.oid, x.c, 'INSERT')::text from pg_class c where c.oid = to_regclass('storage.buckets')), '<absent>')
    from (values ('id'), ('name'), ('public'), ('file_size_limit'), ('allowed_mime_types')) as x(c)
  union all
  select 'buckets', 'update|' || x.c, coalesce((select has_column_privilege(c.oid, x.c, 'UPDATE')::text from pg_class c where c.oid = to_regclass('storage.buckets')), '<absent>')
    from (values ('public'), ('file_size_limit'), ('allowed_mime_types'), ('updated_at')) as x(c)
  union all
  select 'buckets', 'select', coalesce((select has_table_privilege(c.oid, 'SELECT')::text from pg_class c where c.oid = to_regclass('storage.buckets')), '<absent>')
  union all
  select 'buckets', 'rls_applies',
         coalesce((select (c.relrowsecurity and (c.relforcerowsecurity or not (c.relowner = m.oid or m.rolbypassrls or m.rolsuper)))::text
                     from pg_class c, me m where c.oid = to_regclass('storage.buckets')), '<absent>')
  union all
  select 'buckets', 'row|' || x.id, (exists (select 1 from storage.buckets b where b.id = x.id))::text
    from (values ('job-files'), ('customer-uploads')) as x(id)
  union all
  select 'objects', 'owner_privileges', coalesce((select pg_has_role(current_user, c.relowner, 'USAGE')::text from pg_class c where c.oid = to_regclass('storage.objects')), '<absent>')
  union all
  select 'publication', 'owner_privileges', coalesce((select pg_has_role(current_user, p.pubowner, 'USAGE')::text from pg_publication p where p.pubname = 'supabase_realtime'), '<absent>')
  union all
  select 'authusers', 'insert', coalesce((select has_table_privilege(c.oid, 'INSERT')::text from pg_class c where c.oid = to_regclass('auth.users')), '<absent>')
  union all
  select 'authusers', 'select', coalesce((select has_table_privilege(c.oid, 'SELECT')::text from pg_class c where c.oid = to_regclass('auth.users')), '<absent>')
  union all
  select 'authusers', 'references|id', coalesce((select has_column_privilege(c.oid, 'id', 'REFERENCES')::text from pg_class c where c.oid = to_regclass('auth.users')), '<absent>')
  union all
  select 'authusers', 'rls_applies',
         coalesce((select (c.relrowsecurity and (c.relforcerowsecurity or not (c.relowner = m.oid or m.rolbypassrls or m.rolsuper)))::text
                     from pg_class c, me m where c.oid = to_regclass('auth.users')), '<absent>')
  union all
  select 'database', 'create', has_database_privilege(current_database(), 'CREATE')::text
)
select o.part, o.key, coalesce(o.value, '<null>') as value from obs o order by o.part collate "C", o.key collate "C";
