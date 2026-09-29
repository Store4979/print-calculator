// scripts/tests/stage0-manifest.lifecycle.test.js — the manifest checks
// survive every repository state stage 0 produces (review of d01b74a, N3).
//
// A scratch `git clone --shared` of this repository's HEAD is walked through
// what the plan's commits will do:
//   pending → P2-01 … P2-05 (each forward and its companion git-mv'd to
//   supabase/migrations/<version>_…, productionVersion recorded) → fully
//   applied → RB-5, RB-43, RB-2, RB-1 committed (each rollback's bytes under
//   its own version, rollbackRecords appended).
// Each state is a real commit. Each commit runs the SAME checkManifest() that
// stage0-manifest.test.js runs on this repository. Every check must pass in
// every state, with the outputs byte-identical to the pinned ones, and no
// check is relaxed. Negative controls show the checks still bite in the moved
// layout.
//
// It tests the COMMITTED HEAD, not the working tree: that is what a clone is.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { checkManifest, MANIFEST_PATH, forwardPath, companionPath, recordPath } from "./stage0-manifest-check.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ID = ["-c", "user.name=stage0-lifecycle-test", "-c", "user.email=stage0-lifecycle@example.invalid", "-c", "commit.gpgsign=false"];

function scratch() {
  const dir = mkdtempSync(join(tmpdir(), "s0-life-"));
  execFileSync("git", ["clone", "--quiet", "--shared", ROOT, dir]);
  const git = (...a) => execFileSync("git", [...ID, ...a], { cwd: dir, maxBuffer: 1 << 26 }).toString("utf8").trim();
  const M = JSON.parse(execFileSync("git", ["show", `HEAD:${MANIFEST_PATH}`], { cwd: dir }).toString("utf8"));
  const save = (m) => writeFileSync(join(dir, MANIFEST_PATH), JSON.stringify(m, null, 2) + "\n");
  const commit = (msg) => { git("add", "-A"); git("commit", "--quiet", "--allow-empty", "-m", msg); };
  const clean = () => rmSync(dir, { recursive: true, force: true });
  return { dir, git, M, save, commit, clean };
}
const failures = (P) => Object.entries(P).filter(([, v]) => v.length).map(([k, v]) => `${k}: ${v.join(" | ")}`);
const FWD = (n) => `2026100112000${Number(n)}`;
const RBV = (i) => `2026100113000${i + 1}`;

function applyForward(s, m) {
  const r = s.M.rollbacks.find((x) => x.n === m.n);
  const fromF = forwardPath(m), fromC = companionPath(m, r);
  m.productionVersion = FWD(m.n);
  s.git("mv", fromF, forwardPath(m));
  s.git("mv", fromC, companionPath(m, r));
  s.save(s.M);
  s.commit(`P2-${m.n} record`);
}
function recordRollback(s, n, i) {
  const m = s.M.migrations.find((x) => x.n === n);
  const r = s.M.rollbacks.find((x) => x.n === n);
  const rec = { n, version: RBV(i) };
  const p = join(s.dir, recordPath(m, rec));
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, execFileSync("git", ["cat-file", "blob", r.blob], { cwd: s.dir }));
  s.M.rollbackRecords.push(rec);
  s.save(s.M);
  s.commit(`${n} rollback record`);
}

test("LC-1 pending → each apply → fully applied → committed rollback: every manifest check passes in every state, outputs byte-identical", () => {
  const s = scratch();
  try {
    assert.deepEqual(failures(checkManifest(s.dir, s.M)), [], "pending");
    for (const m of s.M.migrations) {
      applyForward(s, m);
      assert.deepEqual(failures(checkManifest(s.dir, s.M)), [], `after P2-${m.n}`);
    }
    const top = s.git("ls-tree", "--name-only", "HEAD", "supabase/migrations/").split("\n")
      .filter((p) => /\/\d{14}_.*\.sql$/.test(p) && !/\.rollback\.sql$/.test(p));
    assert.equal(top.length, 25, "fully applied: 20 baseline + 5 forward files");
    const order = s.M.rollbackOperations.flatMap((o) => o.files);
    order.forEach((n, i) => {
      recordRollback(s, n, i);
      assert.deepEqual(failures(checkManifest(s.dir, s.M)), [], `after the ${n} rollback record`);
    });
    const top2 = s.git("ls-tree", "--name-only", "HEAD", "supabase/migrations/").split("\n")
      .filter((p) => /\/\d{14}_.*\.sql$/.test(p) && !/\.rollback\.sql$/.test(p));
    assert.equal(top2.length, 30, "committed rollback: 20 + 5 forward + 5 rollback records, history kept");
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

    for (const m of s.M.migrations.slice(1)) applyForward(s, m);
    const M3 = JSON.parse(JSON.stringify(s.M));
    M3.rollbackRecords = [{ n: "01", version: RBV(0) }];
    s.save(M3);
    s.commit("wrong order");
    assert.match(failures(checkManifest(s.dir, M3)).join("\n"), /M-8: rollback record 1 is 01; the RB order over the applied set expects 05/);
  } finally { s.clean(); }
});
