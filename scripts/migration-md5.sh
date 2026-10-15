#!/usr/bin/env bash
# Migration drift check — REPO side. Prints "<version> <name> <md5>" for every
# top-level supabase/migrations/*.sql file, in the same shape as
# supabase/drift-check.sql, so the two can be diffed. It lists the same files
# the Supabase CLI would discover, with nothing skipped: unexecuted rollback
# companions live in supabase/rollbacks/ and unapplied work in pending/, so
# neither is listed here, and a companion left at the top level shows up as a
# line with no ledger row.
set -euo pipefail
cd "$(dirname "$0")/.."
for f in supabase/migrations/*.sql; do
  b=$(basename "$f" .sql)
  version=${b%%_*}; name=${b#*_}
  printf '%s %s %s\n' "$version" "$name" "$(md5sum < "$f" | cut -d' ' -f1)"
done
