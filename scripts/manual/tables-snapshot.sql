-- scripts/manual/tables-snapshot.sql — capture the table/view/bucket NAMES the
-- client may reach, for scripts/tests/release2-inventory.test.js.
--
-- READ-ONLY. One statement; names only, no row data, nothing applied. Its
-- output is committed verbatim as supabase/tables.json.
--
-- WHICH PROJECT: PRODUCTION (gmxyisjjaxtpycsmmzef, the ref pinned in
-- netlify/lib/release2.js). The client ships against production, so production
-- is the authority for which names src/ may name. SQL cannot see the project
-- ref, so the capturing session records it BY HAND in the JSON header below,
-- from the MCP project_id the statement was run against.
--
-- WHAT THE OUTPUT RECORDS AND WHY
--   capturedAt     when
--   database/role  information_schema is ROLE-FILTERED: it lists only what the
--                  current role can see. Recording current_user makes a later
--                  diff explainable when a role change, not a schema change,
--                  moved the list.
--   ledgerVersion  the newest supabase_migrations.schema_migrations version at
--                  capture — the snapshot's schema fix-point, for the drift
--                  check (supabase/drift-check.sql) to reconcile against.
--   tables/views   public.* by table_type. Views are included because
--                  `.from("x")` can target one: `transactions` was a compat view
--                  and is GONE, and the test must classify a stale name as
--                  gone, not unknown.
--   buckets        storage.buckets.id — what `.storage.from("<id>")` names.
--
-- WHAT IT IS NOT USED FOR: the list of Release 2 table names FORBIDDEN in src/.
-- That list is derived from supabase/migrations/pending/release2_*.sql, never
-- from this snapshot. Once stage 0 applies 01–05 to production, a refreshed
-- snapshot WILL contain those tables; a prohibition derived from the snapshot
-- would evaporate at exactly the moment it starts mattering.
--
-- Refresh: re-run, replace supabase/tables.json, note the new ledgerVersion in
-- the commit. The MCP execute_sql project_id and the datetime go in the header
-- fields `project` and `capturedBy` by hand after the run.
select jsonb_pretty(jsonb_build_object(
  'project',       'RECORDED BY HAND: MCP project_id the statement ran against',
  'capturedBy',    'RECORDED BY HAND: session/operator',
  'query',         'scripts/manual/tables-snapshot.sql',
  'capturedAt',    to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  'database',      current_database(),
  'role',          current_user,
  'ledgerVersion', (select max(version) from supabase_migrations.schema_migrations),
  'tables',        (select coalesce(jsonb_agg(t.table_name order by t.table_name), '[]'::jsonb)
                      from information_schema.tables t
                     where t.table_schema = 'public' and t.table_type = 'BASE TABLE'),
  'views',         (select coalesce(jsonb_agg(t.table_name order by t.table_name), '[]'::jsonb)
                      from information_schema.tables t
                     where t.table_schema = 'public' and t.table_type = 'VIEW'),
  'buckets',       (select coalesce(jsonb_agg(b.id order by b.id), '[]'::jsonb)
                      from storage.buckets b)
)) as tables_json;
