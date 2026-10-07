// scripts/tests/stage0-manifest.lifecycle.test.js — the manifest checks
// survive every repository state stage 0 produces (review of d01b74a, N3).
//
// A scratch `git clone --shared` of this repository's HEAD is walked through
// what the plan's commits will do:
//   pending → P2-01, P2-02, P2-0304, P2-05 (each forward and its companion
//   git-mv'd to supabase/migrations/<version>_…, productionVersion recorded;
//   P2-0304 moves 03 and 04 in ONE commit, as it applies them in one
//   transaction — review of dc5a88b, N7) → fully applied → RB-5, RB-43, RB-2,
//   RB-1 committed (each operation one commit; each rollback's bytes under its
//   own version, rollbackRecords appended).
// LC-3 does the same from every shorter committed prefix, running exactly the
// recovery operations the assembler's RECOVERY table names for it.
// Each state is a real commit. Each commit runs the SAME checkManifest() that
// stage0-manifest.test.js runs on this repository. Every check must pass in
// every state, with the outputs byte-identical to the pinned ones, and no
// check is relaxed. Negative controls show the checks still bite in the moved
// layout.
//
// It tests the COMMITTED HEAD, not the working tree: that is what a clone is.
//
// Every walk starts from the PENDING state (Blocker PRE-0,
// docs/security/stage0-p1-p3-runbook.md). When HEAD already records applies
// or rollbacks, the scratch clone first commits the state back to pending:
// the files are located from the recorded state (stage0-recorded-state.mjs)
// and git-mv'd back, the records removed, and the manifest's record fields
// cleared. Before P2 that commit does not exist, because HEAD is pending.
// LC-1 also checks HEAD exactly as it is recorded.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { checkManifest, MANIFEST_PATH, forwardPath, companionPath, recordPath } from "./stage0-manifest-check.mjs";
import { P2_STEPS, RECOVERY } from "../manual/assemble-stage0.mjs";
import { commitBackToPending } from "./stage0-recorded-state.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ID = ["-c", "user.name=stage0-lifecycle-test", "-c", "user.email=stage0-lifecycle@example.invalid", "-c", "commit.gpgsign=false"];

/** A scratch clone of HEAD. `atPending` (the default) first commits the recorded state back to pending, when it is not. */
function scratch({ atPending = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "s0-life-"));
  execFileSync("git", ["clone", "--quiet", "--shared", ROOT, dir]);
  const git = (...a) => execFileSync("git", [...ID, ...a], { cwd: dir, maxBuffer: 1 << 26 }).toString("utf8").trim();
  const M = JSON.parse(execFileSync("git", ["show", `HEAD:${MANIFEST_PATH}`], { cwd: dir }).toString("utf8"));
  const save = (m) => writeFileSync(join(dir, MANIFEST_PATH), JSON.stringify(m, null, 2) + "\n");
  const commit = (msg) => { git("add", "-A"); git("commit", "--quiet", "--allow-empty", "-m", msg); };
  const clean = () => rmSync(dir, { recursive: true, force: true });
  const s = { dir, git, M, save, commit, clean };
  if (atPending) commitBackToPending(s);
  return s;
}
const failures = (P) => Object.entries(P).filter(([, v]) => v.length).map(([k, v]) => `${k}: ${v.join(" | ")}`);
const FWD = (n) => `2026100112000${Number(n)}`;
const RBV = (i) => `2026100113000${i + 1}`;

/** A P2 step's repository record: every file of the step moves in ONE commit. */
function applyStep(s, stp, commit = true) {
  for (const n of stp.files) {
    const m = s.M.migrations.find((x) => x.n === n);
    const r = s.M.rollbacks.find((x) => x.n === n);
    const fromF = forwardPath(m), fromC = companionPath(m, r);
    m.productionVersion = FWD(n);
    s.git("mv", fromF, forwardPath(m));
    s.git("mv", fromC, companionPath(m, r));
  }
  s.save(s.M);
  if (commit) s.commit(`${stp.step} record`);
}
const applyForward = (s, m) => applyStep(s, { step: `P2-${m.n}`, files: [m.n] });
/** A rollback operation's repository record: all its files in ONE commit. */
function recordOperation(s, op, commit = true) {
  for (const n of s.M.rollbackOperations.find((o) => o.op === op).files) {
    const m = s.M.migrations.find((x) => x.n === n);
    const r = s.M.rollbacks.find((x) => x.n === n);
    const rec = { n, version: RBV(s.M.rollbackRecords.length) };
    const p = join(s.dir, recordPath(m, rec));
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, execFileSync("git", ["cat-file", "blob", r.blob], { cwd: s.dir }));
    s.M.rollbackRecords.push(rec);
  }
  s.save(s.M);
  if (commit) s.commit(`${op} record`);
}
const topFiles = (s) => s.git("ls-tree", "--name-only", "HEAD", "supabase/migrations/").split("\n")
  .filter((p) => /\/\d{14}_.*\.sql$/.test(p) && !/\.rollback\.sql$/.test(p));

test("LC-1 pending → each P2 step → fully applied → committed rollback: every manifest check passes in every state, outputs byte-identical", () => {
  const head = scratch({ atPending: false });
  try {
    assert.deepEqual(failures(checkManifest(head.dir, head.M)), [], "HEAD, exactly as recorded");
  } finally { head.clean(); }
  const s = scratch();
  try {
    assert.deepEqual(P2_STEPS.map((x) => x.step), ["P2-01", "P2-02", "P2-0304", "P2-05"]);
    assert.deepEqual(failures(checkManifest(s.dir, s.M)), [], "pending");
    for (const stp of P2_STEPS) {
      applyStep(s, stp);
      assert.deepEqual(failures(checkManifest(s.dir, s.M)), [], `after ${stp.step}`);
    }
    assert.equal(topFiles(s).length, 25, "fully applied: 20 baseline + 5 forward files");
    for (const o of s.M.rollbackOperations) {
      recordOperation(s, o.op);
      assert.deepEqual(failures(checkManifest(s.dir, s.M)), [], `after the ${o.op} record`);
    }
    assert.equal(topFiles(s).length, 30, "committed rollback: 20 + 5 forward + 5 rollback records, history kept");
    // A record-only manifest update (a P4 deploy id) keeps every pin valid.
    s.M.deploys = { ...s.M.deploys, P4: { deployId: "record-only-test", commitRef: "none" } };
    s.save(s.M);
    s.commit("record-only update");
    assert.deepEqual(failures(checkManifest(s.dir, s.M)), [], "after a record-only manifest update");
  } finally { s.clean(); }
});

test("LC-2 the moved layout still bites: a changed byte, a recorded-but-unmoved apply, a stray file, a wrong record order", () => {
  const s = scratch();
  try {
    applyForward(s, s.M.migrations[0]);
    const moved = join(s.dir, forwardPath(s.M.migrations[0]));
    writeFileSync(moved, readFileSync(moved, "utf8") + "-- x\n");
    s.commit("tamper");
    assert.match(failures(checkManifest(s.dir, s.M)).join("\n"), /^M-1: .*release2_01_identity_schema/m, "one byte in a moved file");
    s.git("reset", "--quiet", "--hard", "HEAD~1");

    const M2 = JSON.parse(JSON.stringify(s.M));
    M2.migrations[1].productionVersion = FWD("02");
    s.save(M2);
    s.commit("recorded, not moved");
    const f2 = failures(checkManifest(s.dir, M2)).join("\n");
    assert.match(f2, /M-8: .*missing applied migration file supabase\/migrations\/20261001120002_release2_02/);
    assert.match(f2, /M-1: release2_02_auth_attempts_fn: HEAD:supabase\/migrations\/20261001120002_release2_02_auth_attempts_fn\.sql is absent/);
    s.git("reset", "--quiet", "--hard", "HEAD~1");

    writeFileSync(join(s.dir, "supabase/migrations/20261001120099_stray.sql"), "select 1;\n");
    s.commit("stray");
    assert.match(failures(checkManifest(s.dir, s.M)).join("\n"), /M-8: unexpected applied migration file supabase\/migrations\/20261001120099_stray\.sql/);
    s.git("reset", "--quiet", "--hard", "HEAD~1");

    for (const stp of P2_STEPS.slice(1)) applyStep(s, stp);
    const M3 = JSON.parse(JSON.stringify(s.M));
    M3.rollbackRecords = [{ n: "01", version: RBV(0) }];
    s.save(M3);
    s.commit("wrong order");
    assert.match(failures(checkManifest(s.dir, M3)).join("\n"), /M-8: rollback record 1 is 01; the RB order over the applied set expects 05/);
  } finally { s.clean(); }
});

test("LC-3 recovery from EVERY committed prefix (review of dc5a88b, N7): the RECOVERY table's operations, one commit each, and every manifest check passes in every state", () => {
  const partial = RECOVERY.filter((r) => r.prefix.length && r.prefix.length < 5);
  assert.deepEqual(partial.map((r) => r.prefix.join()), ["01", "01,02", "01,02,03,04"], "LC-1 covers the full prefix");
  for (const R of partial) {
    const s = scratch();
    try {
      const steps = P2_STEPS.filter((x) => x.files.every((n) => R.prefix.includes(n)));
      assert.deepEqual(steps.flatMap((x) => x.files), R.prefix, `prefix ${R.prefix} is a union of whole P2 steps`);
      for (const stp of steps) applyStep(s, stp);
      assert.deepEqual(failures(checkManifest(s.dir, s.M)), [], `prefix ${R.prefix} committed`);
      for (const op of R.ops) {
        recordOperation(s, op);
        assert.deepEqual(failures(checkManifest(s.dir, s.M)), [], `prefix ${R.prefix}: after the ${op} record`);
      }
      assert.deepEqual(s.M.rollbackRecords.map((x) => x.n), [...R.prefix].reverse(), `prefix ${R.prefix}: every applied file has its rollback record, in RB order`);
      assert.equal(topFiles(s).length, 20 + 2 * R.prefix.length, `prefix ${R.prefix}: the ledger's history is only appended to`);
      const pending = s.git("ls-tree", "--name-only", "HEAD", "supabase/migrations/pending/").split("\n").filter((p) => /release2_0\d_[a-z_]+\.sql$/.test(p) && !/\.rollback\.sql$/.test(p));
      assert.equal(pending.length, 5 - R.prefix.length, `prefix ${R.prefix}: the unapplied files stay pending`);
    } finally { s.clean(); }
  }
});

test("LC-4 03 and 04 are one transaction in the record too: 03 recorded without 04, or one of the RB-43 pair without the other, fails M-8", () => {
  const s = scratch();
  try {
    applyStep(s, P2_STEPS[0]);
    applyStep(s, P2_STEPS[1]);
    applyForward(s, s.M.migrations.find((m) => m.n === "03"));
    assert.match(failures(checkManifest(s.dir, s.M)).join("\n"), /M-8: 03 and 04 are recorded in different states/);
    applyForward(s, s.M.migrations.find((m) => m.n === "04"));
    assert.deepEqual(failures(checkManifest(s.dir, s.M)), [], "03 and 04 both recorded");
    const M4 = JSON.parse(JSON.stringify(s.M));
    M4.rollbackRecords = [{ n: "04", version: RBV(0) }];
    const m4 = s.M.migrations.find((m) => m.n === "04");
    const p = join(s.dir, recordPath(m4, M4.rollbackRecords[0]));
    writeFileSync(p, execFileSync("git", ["cat-file", "blob", s.M.rollbacks.find((x) => x.n === "04").blob], { cwd: s.dir }));
    s.save(M4);
    s.commit("half of RB-43");
    assert.match(failures(checkManifest(s.dir, M4)).join("\n"), /M-8: 03 and 04 have different rollback records/);
  } finally { s.clean(); }
});
