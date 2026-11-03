-- supabase/rehearsals/release2_stage0_4c_who.sql
-- Item 4(c) plan §2.2 (Codex's Q-4): WHO, READ-ONLY. One statement, one row.
-- The assembler emits it four times, for each window and mode: WHO-4C-R-RO,
-- WHO-4C-R-DEF, WHO-4C-W-RO and WHO-4C-W-DEF. It reads this request's login
-- and session role, its transaction mode, and the effective privileges the
-- remaining path uses. It probes nothing: no INSERT, no DDL, no mode switch.
-- Matching values establish neither a general write boundary nor identical
-- behaviour for every request. A role that does not exist reads as null.
select
  current_user::text as login_role,
  session_user::text as session_role,
  current_setting('transaction_read_only') as tx_read_only,
  current_setting('default_transaction_read_only') as default_tx_read_only,
  current_setting('statement_timeout') as statement_timeout,
  current_setting('lock_timeout') as lock_timeout,
  (select r.rolsuper from pg_roles r where r.rolname = current_user) as superuser,
  (select r.rolbypassrls from pg_roles r where r.rolname = current_user) as bypass_rls,
  (select r.rolcreaterole from pg_roles r where r.rolname = current_user) as create_role,
  (select pg_has_role(current_user, r.oid, 'MEMBER') from pg_roles r where r.rolname = 'pg_write_all_data') as write_all_data,
  (select pg_has_role(current_user, r.oid, 'MEMBER') from pg_roles r where r.rolname = 'pg_read_all_data') as read_all_data,
  (select pg_has_role(current_user, r.oid, 'MEMBER') from pg_roles r where r.rolname = 'service_role') as member_service_role,
  (select pg_has_role(current_user, r.oid, 'MEMBER') from pg_roles r where r.rolname = 'postgres') as member_postgres,
  (select pg_has_role(current_user, r.oid, 'MEMBER') from pg_roles r where r.rolname = 'supabase_admin') as member_supabase_admin,
  has_database_privilege(current_database(), 'CREATE') as database_create,
  (select has_schema_privilege(n.oid, 'USAGE') from pg_namespace n where n.nspname = 'public') as public_usage,
  (select has_schema_privilege(n.oid, 'CREATE') from pg_namespace n where n.nspname = 'public') as public_create,
  (select has_schema_privilege(n.oid, 'USAGE') from pg_namespace n where n.nspname = 'supabase_migrations') as ledger_schema_usage,
  (select has_table_privilege(c.oid, 'SELECT') from pg_class c where c.oid = to_regclass('supabase_migrations.schema_migrations')) as ledger_select,
  (select has_table_privilege(c.oid, 'INSERT') from pg_class c where c.oid = to_regclass('supabase_migrations.schema_migrations')) as ledger_insert,
  (select pg_has_role(current_user, c.relowner, 'USAGE') from pg_class c where c.oid = to_regclass('public.employees')) as employees_owner_privileges,
  (select pg_has_role(current_user, c.relowner, 'USAGE') from pg_class c where c.oid = to_regclass('public.auth_attempts')) as auth_attempts_owner_privileges,
  (select pg_has_role(current_user, n.nspowner, 'USAGE') from pg_namespace n where n.nspname = 'public') as public_owner_privileges,
  (select has_table_privilege(c.oid, 'SELECT') from pg_class c where c.oid = to_regclass('auth.users')) as auth_users_select,
  (select has_table_privilege(c.oid, 'INSERT') from pg_class c where c.oid = to_regclass('auth.users')) as auth_users_insert;
