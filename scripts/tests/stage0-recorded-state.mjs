// scripts/tests/stage0-recorded-state.mjs — where the Release 2 files ARE,
// read from the manifest's RECORDED state, for the test fixtures that need the
// pending layout (Blocker PRE-0, docs/security/stage0-p1-p3-runbook.md).
//
// The fixture tests (release2-inventory.mutation, release2-inventory.rollback,
// stage0-manifest.lifecycle) each start from the PENDING layout and then make
// their own moves. Before P2 that layout is simply HEAD. After a P2 record
// commit it is not:
//   - an applied forward file and its companion sit at
//     supabase/migrations/<productionVersion>_<name>[.rollback].sql;
//   - an applied rollback sits at supabase/migrations/<version>_<name>_rollback.sql.
// The recorded state (migrations[].productionVersion, rollbackRecords) says
// which, and the paths come from the same functions the manifest checks use
// (forwardPath, companionPath, recordPath). resetToPending() puts a COPY back
// into the pending layout, so each fixture starts where it always did,
// whatever HEAD records. Nothing here writes to the repository itself.
import { readFileSync, existsSync, renameSync, rmSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { MANIFEST_PATH, forwardPath, companionPath, recordPath } from "./stage0-manifest-check.mjs";

/** The manifest as this tree records it (the working-tree file; JSON ignores line endings). */
export const readManifest = (root) => JSON.parse(readFileSync(join(root, MANIFEST_PATH), "utf8"));

/** Per migration: whether it is recorded applied, where its files are, and where they go when pending. */
export function releaseFiles(M) {
  return M.migrations.map((m) => {
    const r = M.rollbacks.find((x) => x.n === m.n);
    return {
      n: m.n, name: m.name, applied: Boolean(m.productionVersion),
      forward: forwardPath(m), companion: companionPath(m, r),
      pendingForward: m.pendingPath, pendingCompanion: r.pendingPath,
    };
  });
}

/** The rollback records the manifest lists, as repository paths. */
export const rollbackRecordPaths = (M) =>
  (M.rollbackRecords || []).map((rec) => recordPath(M.migrations.find((x) => x.n === rec.n), rec));

/**
 * Put the copy at `root` into the pending layout that the recorded state `M`
 * implies: every recorded rollback removed, every applied forward and
 * companion moved back to its pending path. Throws when the copy does not
 * hold a file where the recorded state says it is, and when, afterwards, any
 * release2 file is left outside pending/.
 */
export function resetToPending(root, M) {
  for (const p of rollbackRecordPaths(M)) {
    if (!existsSync(join(root, p))) throw new Error(`resetToPending: the recorded rollback ${p} is not in the copy`);
    rmSync(join(root, p));
  }
  for (const f of releaseFiles(M)) {
    if (!f.applied) continue;
    for (const [from, to] of [[f.forward, f.pendingForward], [f.companion, f.pendingCompanion]]) {
      if (!existsSync(join(root, from))) throw new Error(`resetToPending: the recorded ${from} is not in the copy`);
      renameSync(join(root, from), join(root, to));
    }
  }
  for (const f of releaseFiles(M)) {
    for (const p of [f.pendingForward, f.pendingCompanion]) {
      if (!existsSync(join(root, p))) throw new Error(`resetToPending: ${p} is missing after the reset`);
    }
  }
  const stray = readdirSync(join(root, "supabase", "migrations")).filter((x) => /^\d{14}_release2_/.test(x));
  if (stray.length) throw new Error(`resetToPending: release2 files outside the recorded state: ${stray.join(", ")}`);
}

/**
 * In a scratch git clone: commit the recorded state back to pending (git mv
 * the applied files back, git rm the rollback records, clear the manifest's
 * record fields). `s` carries the clone's `git(...args)`, its manifest `M`
 * (mutated), `save(M)` and `commit(msg)`. Does nothing when HEAD is pending.
 */
export function commitBackToPending(s) {
  const recorded = rollbackRecordPaths(s.M);
  const applied = releaseFiles(s.M).filter((f) => f.applied);
  if (!recorded.length && !applied.length) return false;
  for (const p of recorded) s.git("rm", "--quiet", p);
  for (const f of applied) {
    s.git("mv", f.forward, f.pendingForward);
    s.git("mv", f.companion, f.pendingCompanion);
  }
  for (const m of s.M.migrations) m.productionVersion = null;
  s.M.rollbackRecords = [];
  s.save(s.M);
  s.commit("fixture: the recorded state back to pending");
  return true;
}

/**
 * A stand-in for TABLES-SNAPSHOT's output (runbook §0.6), for tests and the
 * replay only: the shape the real statement returns, with its two by-hand
 * placeholders, the committed capture's non-Release-2 tables, views and
 * buckets, and the six Release 2 tables when `r2` is true.
 */
export function syntheticSnapshot(committed, M, { ledgerVersion, r2, capturedAt = "2026-10-11T21:00:00Z" }) {
  const six = new Set(M.tables.names);
  const tables = [...committed.tables.filter((t) => !six.has(t)), ...(r2 ? M.tables.names : [])].sort();
  return {
    project: "RECORDED BY HAND: MCP project_id the statement ran against",
    capturedBy: "RECORDED BY HAND: session/operator",
    query: "scripts/manual/tables-snapshot.sql",
    capturedAt, database: committed.database, role: committed.role, ledgerVersion,
    tables, views: committed.views, buckets: committed.buckets,
  };
}

/**
 * The capture as it was before any Release 2 apply: the given capture with the
 * manifest's six Release 2 tables taken out, at the baseline ledger version.
 * Before P2 it equals the committed capture. After a P2 record it is the
 * committed capture's own non-Release-2 tables, views and buckets.
 */
export function pendingCapture(capture, M) {
  const r2 = new Set(M.tables.names);
  return { ...capture, ledgerVersion: M.ledgerBaseline.head, tables: capture.tables.filter((t) => !r2.has(t)) };
}
