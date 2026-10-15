// scripts/tests/supabase-migration-discovery.mjs — which files the Supabase CLI
// treats as migrations, modelled on its Go loader (supabase/cli,
// apps/cli-go/pkg/migration/file.go and list.go): the NON-DIRECTORY entries
// directly inside supabase/migrations/ whose name matches ^([0-9]+)_(.*)\.sql$.
// The version is the digits before the first underscore; the name is the rest
// without `.sql`. A `.rollback.sql` file matches like any other: its name keeps
// the `.rollback` suffix and its version is its forward file's version.
//
// This module applies exactly that rule and nothing more. It exempts no file
// the CLI would list (Codex's review of 76883c6, item 1). It is a model of the
// CLI's rule as read from its source, not the CLI itself.
import { readdirSync, existsSync } from "node:fs";

export const MIGRATIONS_DIR = "supabase/migrations";
export const ROLLBACKS_DIR = "supabase/rollbacks";
export const MIGRATION_FILE = /^([0-9]+)_(.*)\.sql$/;

/**
 * The eligible set from a directory listing: `entries` are `{ name, isDirectory }`
 * for the entries directly inside supabase/migrations/. Returns
 * `{ file, version, name }` per eligible entry, in listing order.
 */
export function eligibleMigrations(entries) {
  const out = [];
  for (const e of entries) {
    if (e.isDirectory) continue;
    const m = MIGRATION_FILE.exec(e.name);
    if (m) out.push({ file: e.name, version: m[1], name: m[2] });
  }
  return out;
}

/** The eligible set of a checked-out tree, read from the filesystem as the CLI reads it. */
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
