// scripts/tests/migration-discovery.test.js — a FILENAME-ELIGIBILITY check:
// which files in this repository the Supabase CLI's local-migration listing
// would accept by name (Codex's review of 76883c6, item 1). It is not a
// simulation of the CLI or of how it applies migrations. The rule is
// supabase-migration-discovery.mjs (a model of ListLocalMigrations, revision
// and date in its header): the non-directory entries directly in
// supabase/migrations/ named ^([0-9]+)_(.*)\.sql$, with no file exempted. An
// unexecuted .rollback.sql companion matches that rule like any other file,
// so companions live in supabase/rollbacks/ (or pending/ while their forward
// is unapplied), never at the top level.
//
// It reads the working tree, which in a clean checkout is HEAD.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { MIGRATIONS_DIR, ROLLBACKS_DIR, eligibleMigrations, eligibleOnDisk, duplicateVersions } from "./supabase-migration-discovery.mjs";
import { recordPath } from "./stage0-manifest-check.mjs";
import { readManifest } from "./stage0-recorded-state.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const lfMd5 = (p) => createHash("md5").update(readFileSync(p).toString("utf8").replace(/\r\n/g, "\n"), "utf8").digest("hex");
const COMPANION = /^(\d{14})_(.+)\.rollback\.sql$/;

/** Every unexecuted companion in the repository, by LF md5: supabase/rollbacks/ and pending/. */
function companions() {
  const out = new Map();
  for (const d of [join(ROOT, ROLLBACKS_DIR), join(ROOT, MIGRATIONS_DIR, "pending")]) {
    if (!existsSync(d)) continue;
    for (const f of readdirSync(d)) if (f.endsWith(".rollback.sql")) out.set(lfMd5(join(d, f)), `${d === join(ROOT, ROLLBACKS_DIR) ? ROLLBACKS_DIR : `${MIGRATIONS_DIR}/pending`}/${f}`);
  }
  return out;
}

test("DISC-1 the discoverable set holds no unexecuted rollback companion, and every version in it is unique", () => {
  const eligible = eligibleOnDisk(ROOT);
  assert.ok(eligible.length >= 20, `the CLI's rule finds the applied migrations (${eligible.length})`);
  assert.deepEqual(eligible.filter((e) => e.file.endsWith(".rollback.sql")).map((e) => e.file), [], "no .rollback.sql companion is discoverable");
  assert.deepEqual(duplicateVersions(eligible), [], "no two discoverable files share a version");
  // By content too: no discoverable file is a companion's bytes under another
  // name, except an EXECUTED rollback that the manifest records at its own
  // ledger version (recordPath).
  const M = readManifest(ROOT);
  const executed = new Set((M.rollbackRecords || []).map((rec) => recordPath(M.migrations.find((m) => m.n === rec.n), rec)));
  const known = companions();
  for (const e of eligible) {
    const p = `${MIGRATIONS_DIR}/${e.file}`;
    const twin = known.get(lfMd5(join(ROOT, p)));
    if (twin && !executed.has(p)) assert.fail(`${p} is byte-identical to the unexecuted companion ${twin}, and the manifest records no executed rollback at that path`);
  }
});

test("DISC-2 supabase/rollbacks/ holds only companions, each paired with a discoverable forward file of the same version", () => {
  const dir = join(ROOT, ROLLBACKS_DIR);
  assert.ok(existsSync(dir), `${ROLLBACKS_DIR}/ exists`);
  const eligible = new Set(eligibleOnDisk(ROOT).map((e) => e.file));
  const entries = readdirSync(dir, { withFileTypes: true });
  assert.ok(entries.length > 0, `${ROLLBACKS_DIR}/ is not empty`);
  for (const d of entries) {
    assert.ok(!d.isDirectory(), `${ROLLBACKS_DIR}/${d.name} is a file`);
    const m = COMPANION.exec(d.name);
    assert.ok(m, `${ROLLBACKS_DIR}/${d.name} is named <version>_<name>.rollback.sql`);
    assert.ok(eligible.has(`${m[1]}_${m[2]}.sql`), `${ROLLBACKS_DIR}/${d.name} has its forward file ${MIGRATIONS_DIR}/${m[1]}_${m[2]}.sql`);
  }
});

test("DISC-3 the filename rule exempts nothing: it lists a top-level companion and the check catches it", () => {
  const listing = [
    { name: "20260101000000_thing.sql", isDirectory: false },
    { name: "20260101000000_thing.rollback.sql", isDirectory: false },
    { name: "20260102000000_dir_named_like_a_migration.sql", isDirectory: true },
    { name: "pending", isDirectory: true },
    { name: "README.md", isDirectory: false },
    { name: "x_20260103000000.sql", isDirectory: false },
    { name: "20260104000000.sql", isDirectory: false },
    { name: "123_short_version.sql", isDirectory: false },
  ];
  const eligible = eligibleMigrations(listing);
  assert.deepEqual(eligible, [
    { file: "123_short_version.sql", version: "123", name: "short_version" },
    { file: "20260101000000_thing.rollback.sql", version: "20260101000000", name: "thing.rollback" },
    { file: "20260101000000_thing.sql", version: "20260101000000", name: "thing" },
  ], "in filename order, as fs.ReadDir returns them: the companion is listed with its forward's version and the name 'thing.rollback'; directories and non-matching names are not");
  assert.deepEqual(duplicateVersions(eligible), [{ version: "20260101000000", files: ["20260101000000_thing.rollback.sql", "20260101000000_thing.sql"] }]);
  // The parse Codex gives for the file this review found.
  assert.deepEqual(eligibleMigrations([{ name: "20261009151706_release2_01_identity_schema.rollback.sql", isDirectory: false }]),
    [{ file: "20261009151706_release2_01_identity_schema.rollback.sql", version: "20261009151706", name: "release2_01_identity_schema.rollback" }]);
});

test("DISC-4 the source's one other skip: a legacy <timestamp>_init.sql before 20211209000000, and only as the FIRST entry", () => {
  const files = (names) => eligibleMigrations(names.map((name) => (typeof name === "string" ? { name, isDirectory: false } : name))).map((e) => e.file);
  assert.deepEqual(files(["20211102000000_x.sql", "20211101000000_init.sql"]), ["20211102000000_x.sql"], "first in filename order and legacy: skipped");
  assert.deepEqual(files(["20211101000000_aaa.sql", "20211101000001_init.sql"]), ["20211101000000_aaa.sql", "20211101000001_init.sql"], "not first: listed");
  assert.deepEqual(files(["20220101000000_init.sql"]), ["20220101000000_init.sql"], "on or after 20211209000000: listed");
  assert.deepEqual(files([{ name: "0_dir", isDirectory: true }, "20211101000000_init.sql"]), ["20211101000000_init.sql"], "a directory first: the init file is not the first entry, so it is listed");
  assert.equal(eligibleOnDisk(ROOT).some((e) => /_init\.sql$/.test(e.file)), false, "this repository has no init file, so the skip changes nothing here");
});
