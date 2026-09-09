#!/usr/bin/env bash
# Migration drift check — REPO side. Prints "<version> <name> <md5>" for every
# applied migration file, in the same shape as supabase/drift-check.sql, so the
# two can be diffed. Rollback companions and pending/ are excluded on purpose:
# neither is in the ledger.
set -euo pipefail
cd "$(dirname "$0")/.."
for f in supabase/migrations/*.sql; do
  b=$(basename "$f" .sql)
  case "$b" in *.rollback) continue;; esac
  version=${b%%_*}; name=${b#*_}
  printf '%s %s %s\n' "$version" "$name" "$(md5sum < "$f" | cut -d' ' -f1)"
done
