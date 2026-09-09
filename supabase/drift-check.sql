-- Migration drift check — LEDGER side.
-- Run this against the project (SQL editor or MCP execute_sql), then run
--   scripts/migration-md5.sh
-- in the repo and diff the two lists. Every applied version must have a file
-- named <version>_<name>.sql whose md5 matches body_md5. Unapplied work lives
-- in supabase/migrations/pending/ and must NOT appear in this ledger.
select version,
       name,
       md5(statements[1])                as body_md5,
       right(statements[1], 1) = E'\n'   as ends_with_newline
from supabase_migrations.schema_migrations
order by version;
