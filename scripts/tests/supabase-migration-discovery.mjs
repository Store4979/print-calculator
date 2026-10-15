// scripts/tests/supabase-migration-discovery.mjs — which files in
// supabase/migrations/ are ELIGIBLE, by filename, to be local migrations for
// the Supabase CLI. This is a model of one function, not the CLI.
//
// The source modelled is supabase/cli, apps/cli-go/pkg/migration/list.go
// (ListLocalMigrations) and file.go (migrateFilePattern). Claude read both on
// 2026-10-14 EDT (2026-10-15T01:15Z), at develop
// 5806448112af182a11d3dc73a573e5a9901fd2a3 and at release v2.121.0: the two
// files were byte-identical at both (file.go md5 90e770d11b6b2f3abe5cb7b143a6cad6,
// list.go md5 8c41a97bb94a1dc2fd2a8b054cda4f4c). There, ListLocalMigrations:
//   - reads the immediate entries of the migrations directory (fs.ReadDir,
//     which returns them sorted by filename);
//   - skips directories;
//   - skips the FIRST entry when shouldSkip holds: its name contains
//     <14 digits>_init.sql with a timestamp before 20211209000000, a
//     deprecated legacy form;
//   - keeps every other name matching ^([0-9]+)_(.*)\.sql$, with no
//     .rollback.sql exemption. Version = the leading digits; name = the rest
//     without .sql.
// Callers may pass version filters; this models the unfiltered listing.
//
// It models the filename rule only: not how the CLI orders, compares with the
// remote ledger, or applies migrations. It exempts nothing the source does
// not exempt (Codex's review of 76883c6, item 1). A later CLI release may
// change the rule; re-read the source and update the revision above before
// relying on this model for it.
import { readdirSync, existsSync } from "node:fs";

export const MIGRATIONS_DIR = "supabase/migrations";
export const ROLLBACKS_DIR = "supabase/rollbacks";
export const MIGRATION_FILE = /^([0-9]+)_(.*)\.sql$/;
const LEGACY_INIT = /([0-9]{14})_init\.sql/;

/** shouldSkip in list.go: a legacy <timestamp>_init.sql before 20211209000000. */
export const legacyInitSkipped = (name) => {
  const m = LEGACY_INIT.exec(name);
  return Boolean(m) && Number(m[1]) < 20211209000000;
};

/**
 * The eligible set from a directory listing: `entries` are `{ name, isDirectory }`
 * for the entries directly inside supabase/migrations/, in any order. Returns
 * `{ file, version, name }` per eligible entry, in filename order.
 */
export function eligibleMigrations(entries) {
  const sorted = [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const out = [];
  sorted.forEach((e, i) => {
    if (e.isDirectory) return;
    if (i === 0 && legacyInitSkipped(e.name)) return;
    const m = MIGRATION_FILE.exec(e.name);
    if (m) out.push({ file: e.name, version: m[1], name: m[2] });
  });
  return out;
}

/** The eligible set of a checked-out tree, read from the filesystem. */
export function eligibleOnDisk(root) {
  const dir = `${root}/${MIGRATIONS_DIR}`;
  if (!existsSync(dir)) return [];
  return eligibleMigrations(readdirSync(dir, { withFileTypes: true }).map((d) => ({ name: d.name, isDirectory: d.isDirectory() })));
}

/** Versions that more than one eligible file carries. */
export function duplicateVersions(eligible) {
  const seen = new Map();
  for (const e of eligible) seen.set(e.version, [...(seen.get(e.version) || []), e.file]);
  return [...seen].filter(([, files]) => files.length > 1).map(([version, files]) => ({ version, files }));
}
