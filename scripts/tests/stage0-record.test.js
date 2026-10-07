// scripts/tests/stage0-record.test.js — scripts/manual/stage0-record.mjs, the
// tool that stages each stage-0 repository record (runbook §10, §A.4), seen
// to stage exactly the record and to refuse everything else before changing
// anything.
//
// A scratch `git clone --shared` of HEAD, committed back to the pending state
// first when HEAD records applies (stage0-recorded-state.mjs). The snapshots
// are synthetic stand-ins of TABLES-SNAPSHOT's output; versions are made up.
// The whole record chain is replayed, with the FULL suite at every state, by
// scripts/tests/replay/stage0-record-replay.test.js (on demand: it is too slow
// for every build).
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { recordStep } from "../manual/stage0-record.mjs";
import { md5 } from "../manual/assemble-stage0.mjs";
import { checkManifest, MANIFEST_PATH, recordPath } from "./stage0-manifest-check.mjs";
import { readTablesSnapshot } from "./inventory-check.mjs";
import { commitBackToPending, syntheticSnapshot } from "./stage0-recorded-state.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ID = ["-c", "user.name=stage0-record-test", "-c", "user.email=stage0-record@example.invalid", "-c", "commit.gpgsign=false"];
const V1 = "20261011210101", V2 = "20261011210203", RB1 = "20261011220101";

function scratch() {
  const dir = mkdtempSync(join(tmpdir(), "s0-rec-"));
  const side = mkdtempSync(join(tmpdir(), "s0-rec-snap-"));
  execFileSync("git", ["clone", "--quiet", "--shared", ROOT, dir]);
  const git = (...a) => execFileSync("git", [...ID, ...a], { cwd: dir, maxBuffer: 1 << 26 }).toString("utf8").trim();
  const M = JSON.parse(execFileSync("git", ["show", `HEAD:${MANIFEST_PATH}`], { cwd: dir }).toString("utf8"));
  const save = (m) => writeFileSync(join(dir, MANIFEST_PATH), JSON.stringify(m, null, 2) + "\n");
  const commit = (msg) => { git("add", "-A"); git("commit", "--quiet", "--allow-empty", "-m", msg); };
  const s = { dir, git, M, save, commit };
  commitBackToPending(s);
  const committed = JSON.parse(readFileSync(join(dir, "supabase", "tables.json"), "utf8"));
  let k = 0;
  s.snapshot = (over) => {
    const p = join(side, `snap-${k++}.json`);
    writeFileSync(p, JSON.stringify({ ...syntheticSnapshot(committed, s.M, over), ...(over.patch || {}) }, null, 2));
    return p;
  };
  s.clean = () => { rmSync(dir, { recursive: true, force: true }); rmSync(side, { recursive: true, force: true }); };
  s.headManifest = () => JSON.parse(execFileSync("git", ["show", `HEAD:${MANIFEST_PATH}`], { cwd: dir }).toString("utf8"));
  return s;
}
const failures = (P) => Object.entries(P).filter(([, v]) => v.length).map(([k, v]) => `${k}: ${v.join(" | ")}`);

test("REC-1 forward P2-01, then rollback RB-1: exactly the record is staged; each committed state passes every manifest check and the snapshot validation", () => {
  const s = scratch();
  try {
    const m01 = s.M.migrations.find((m) => m.n === "01");
    const r01 = s.M.rollbacks.find((r) => r.n === "01");
    const fwd = `supabase/migrations/${V1}_${m01.name}.sql`, comp = `supabase/migrations/${V1}_${m01.name}.rollback.sql`;
    const staged = recordStep({ root: s.dir, kind: "forward", name: "P2-01", snapshotPath: s.snapshot({ ledgerVersion: V1, r2: true }), versions: { "01": V1 }, capturedBy: "REC-1 fixture" });
    assert.deepEqual(staged, [MANIFEST_PATH, m01.pendingPath, r01.pendingPath, fwd, comp, "supabase/tables.json"].sort());
    const t1 = JSON.parse(readFileSync(join(s.dir, "supabase", "tables.json"), "utf8"));
    assert.equal(t1.project, s.M.productionRef, "project filled");
    assert.equal(t1.capturedBy, "REC-1 fixture", "capturedBy filled");
    for (const t of s.M.tables.names) assert.ok(t1.tables.includes(t), `${t} listed`);
    s.git("commit", "--quiet", "-m", "REC-1 P2-01 record");
    const M1 = s.headManifest();
    assert.equal(M1.migrations.find((m) => m.n === "01").productionVersion, V1);
    assert.deepEqual(failures(checkManifest(s.dir, M1)), [], "the P2-01 record passes M-1…M-12");
    assert.equal(readTablesSnapshot(join(s.dir, "supabase", "tables.json"), { root: s.dir }).error, undefined, "and the snapshot validation, INV-6 included");

    assert.throws(() => recordStep({ root: s.dir, kind: "rollback", name: "RB-2", snapshotPath: s.snapshot({ ledgerVersion: RB1, r2: true }), versions: { "02": RB1 }, capturedBy: "x" }),
      /RB-2 rolls back 02; the RB order over the applied set needs 01 next/);
    assert.throws(() => recordStep({ root: s.dir, kind: "forward", name: "P2-0304", snapshotPath: s.snapshot({ ledgerVersion: V2, r2: true }), versions: { "03": "20261011210301", "04": V2 }, capturedBy: "x" }),
      /P2-0304 needs exactly 01, 02 recorded applied/);

    const rec = recordPath(m01, { n: "01", version: RB1 });
    const staged2 = recordStep({ root: s.dir, kind: "rollback", name: "RB-1", snapshotPath: s.snapshot({ ledgerVersion: RB1, r2: false }), versions: { "01": RB1 }, capturedBy: "REC-1 fixture" });
    assert.deepEqual(staged2, [MANIFEST_PATH, rec, "supabase/tables.json"].sort());
    assert.equal(md5(readFileSync(join(s.dir, rec))), r01.md5, "the record holds the rollback's pinned bytes");
    s.git("commit", "--quiet", "-m", "REC-1 RB-1 record");
    const M2 = s.headManifest();
    assert.deepEqual(M2.rollbackRecords, [{ n: "01", version: RB1 }]);
    assert.deepEqual(failures(checkManifest(s.dir, M2)), [], "the RB-1 record passes M-1…M-12");
    assert.equal(readTablesSnapshot(join(s.dir, "supabase", "tables.json"), { root: s.dir }).error, undefined, "and the snapshot validation without the six tables");
    assert.throws(() => recordStep({ root: s.dir, kind: "forward", name: "P2-02", snapshotPath: s.snapshot({ ledgerVersion: "20261011230101", r2: true }), versions: { "02": "20261011230101" }, capturedBy: "x" }),
      /a forward step after a rollback is not a reviewed operation/);
  } finally { s.clean(); }
});

test("REC-2 refusals, each before anything changes: order, versions, snapshot shape and content, a dirty tree, provenance", () => {
  const s = scratch();
  try {
    const ok = { root: s.dir, kind: "forward", name: "P2-01", versions: { "01": V1 }, capturedBy: "REC-2 fixture" };
    const cases = [
      ["P2-02 first", { ...ok, name: "P2-02", versions: { "02": V1 }, snapshotPath: s.snapshot({ ledgerVersion: V1, r2: true }) }, /P2-02 needs exactly 01 recorded applied; the manifest records nothing/],
      ["a version not after the head", { ...ok, versions: { "01": "20200101000000" }, snapshotPath: s.snapshot({ ledgerVersion: "20200101000000", r2: true }) }, /version 20200101000000 for 01 is not after 20260909232836/],
      ["a malformed version", { ...ok, versions: { "01": "2026101121" }, snapshotPath: s.snapshot({ ledgerVersion: "2026101121", r2: true }) }, /is not 14 digits/],
      ["a version for a file not in the step", { ...ok, versions: { "01": V1, "02": V2 }, snapshotPath: s.snapshot({ ledgerVersion: V2, r2: true }) }, /needs exactly one version for each of 01/],
      ["a rollback with nothing applied", { ...ok, kind: "rollback", name: "RB-1", snapshotPath: s.snapshot({ ledgerVersion: V1, r2: false }) }, /RB-1 rolls back 01; the RB order over the applied set needs nothing next/],
      ["an unknown step", { ...ok, name: "P2-03", snapshotPath: s.snapshot({ ledgerVersion: V1, r2: true }) }, /"P2-03" is not a P2 step/],
      ["the snapshot taken before the step", { ...ok, snapshotPath: s.snapshot({ ledgerVersion: "20260909232836", r2: true }) }, /was not captured right after this step/],
      ["a Release 2 table missing", { ...ok, snapshotPath: s.snapshot({ ledgerVersion: V1, r2: true, patch: { tables: syntheticSnapshot(JSON.parse(readFileSync(join(s.dir, "supabase", "tables.json"), "utf8")), s.M, { ledgerVersion: V1, r2: true }).tables.filter((t) => t !== "auth_attempts") } }) }, /the six Release 2 tables exist; the snapshot lists/],
      ["another table appeared", { ...ok, snapshotPath: s.snapshot({ ledgerVersion: V1, r2: true, patch: { tables: [...syntheticSnapshot(JSON.parse(readFileSync(join(s.dir, "supabase", "tables.json"), "utf8")), s.M, { ledgerVersion: V1, r2: true }).tables, "surprise"].sort() } }) }, /non-Release-2 tables differ from the committed capture's/],
      ["a bucket changed", { ...ok, snapshotPath: s.snapshot({ ledgerVersion: V1, r2: true, patch: { buckets: ["job-files"] } }) }, /buckets differ from the committed capture's/],
      ["the staging project", { ...ok, snapshotPath: s.snapshot({ ledgerVersion: V1, r2: true, patch: { project: "lboajqihpsfrokqvjgnl" } }) }, /neither the placeholder nor gmxyisjjaxtpycsmmzef/],
      ["another role", { ...ok, snapshotPath: s.snapshot({ ledgerVersion: V1, r2: true, patch: { role: "anon" } }) }, /role is "anon"/],
      ["an extra key", { ...ok, snapshotPath: s.snapshot({ ledgerVersion: V1, r2: true, patch: { note: "x" } }) }, /the snapshot's keys are/],
      ["no --captured-by", { ...ok, capturedBy: null, snapshotPath: s.snapshot({ ledgerVersion: V1, r2: true }) }, /--captured-by is required/],
    ];
    for (const [label, args, re] of cases) {
      assert.throws(() => recordStep(args), re, label);
      assert.equal(s.git("status", "--porcelain"), "", `${label}: nothing changed`);
    }
    writeFileSync(join(s.dir, "README.md"), readFileSync(join(s.dir, "README.md"), "utf8") + "\nx\n");
    assert.throws(() => recordStep({ ...ok, snapshotPath: s.snapshot({ ledgerVersion: V1, r2: true }) }), /tracked files have changes/, "a dirty tree");
  } finally { s.clean(); }
});
