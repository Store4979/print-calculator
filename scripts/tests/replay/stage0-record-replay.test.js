// scripts/tests/replay/stage0-record-replay.test.js — the runbook's record
// commits, replayed, with the FULL suite at every state they produce
// (Blocker PRE-0, docs/security/stage0-p1-p3-runbook.md §1.2 and §10).
//
// ON DEMAND, NOT IN `yarn test`:
//   node --test scripts/tests/replay/stage0-record-replay.test.js
// It is outside the scripts/tests/*.test.js glob on purpose. It runs that whole
// suite once per state, so inside the suite it would recurse, and it would add
// tens of minutes to every Netlify build (Netlify runs `yarn test` before
// every build).
//
// What it does, in a scratch clone of the COMMITTED HEAD (uncommitted work is
// not included: commit first):
//   1. From the state HEAD records, it makes each remaining record commit
//      exactly as the runbook's §10 / §A.4 makes it: scripts/manual/stage0-record.mjs
//      stages the record, a plan line is added, and the result is committed.
//      - the forward steps not yet recorded: P2-01, P2-02, P2-0304, P2-05;
//      - then the rollback operations in RB order: RB-5, RB-43, RB-2, RB-1
//        (the committed-rollback state);
//      - and, unless STAGE0_REPLAY_STATES=main, the recovery from each shorter
//        committed prefix: 01 → RB-1; 01–02 → RB-2, RB-1; 01–04 → RB-43, RB-2,
//        RB-1 (runbook §A.3, plan §A6).
//      Versions are synthetic, and so are the snapshots (syntheticSnapshot: the
//      shape TABLES-SNAPSHOT returns).
//   2. At HEAD and at every commit it made, it runs `node --test
//      scripts/tests/*.test.js` in a clone of that commit. Each must report 0
//      failed, 0 cancelled, 0 skipped and 0 todo, every test passed, and the
//      SAME number of tests as at HEAD, so no test disappears in a later state.
//
// The clones live in .stage0-replay/ (gitignored) INSIDE this repository, so
// their tests resolve this repository's node_modules (acorn, acorn-jsx)
// without a link. It is removed at the end, unless STAGE0_REPLAY_KEEP=1.
// STAGE0_REPLAY_JOBS sets how many suites run at once (default 3).
// STAGE0_REPLAY_REV names the ref to replay from (default HEAD), e.g. a
// refs/verify/tmp pointing at a commit made from the index for review.
// .stage0-replay-summary.json (gitignored) keeps the last run's per-state counts.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, rmSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { recordStep } from "../../manual/stage0-record.mjs";
import { P2_STEPS, RECOVERY } from "../../manual/assemble-stage0.mjs";
import { MANIFEST_PATH } from "../stage0-manifest-check.mjs";
import { syntheticSnapshot } from "../stage0-recorded-state.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const BASE = join(ROOT, ".stage0-replay");
const PLAN = "docs/security/release-2-stage-0-production-plan.md";
const ID = ["-c", "user.name=stage0-record-replay", "-c", "user.email=stage0-replay@example.invalid", "-c", "commit.gpgsign=false"];
const JOBS = Math.max(1, Number(process.env.STAGE0_REPLAY_JOBS) || 3);
const ALL = process.env.STAGE0_REPLAY_STATES !== "main";

const fmt = (ms) => new Date(ms).toISOString().replace(/[-:T]/g, "").slice(0, 14);

/** Build every record commit in `dir`; return [{ label, sha }], HEAD first. */
function buildStates(dir) {
  const git = (...a) => execFileSync("git", [...ID, ...a], { cwd: dir, maxBuffer: 1 << 26 }).toString("utf8").trim();
  const manifest = () => JSON.parse(git("show", `HEAD:${MANIFEST_PATH}`));
  const committed = () => JSON.parse(git("show", "HEAD:supabase/tables.json"));
  const M0 = manifest();
  const recorded = [M0.ledgerBaseline.head, ...M0.migrations.map((m) => m.productionVersion).filter(Boolean), ...M0.rollbackRecords.map((r) => r.version)];
  const newest = recorded.reduce((a, b) => (b > a ? b : a));
  // A synthetic clock: one minute per step, after everything HEAD records.
  let clock = Math.max(Date.UTC(2026, 9, 11, 21, 0, 0), Date.UTC(+newest.slice(0, 4), +newest.slice(4, 6) - 1, +newest.slice(6, 8), +newest.slice(8, 10), +newest.slice(10, 12), +newest.slice(12, 14)) + 60000);
  const versionsFor = (files) => { const v = {}; files.forEach((n, i) => { v[n] = fmt(clock + i * 1000); }); clock += 60000; return v; };
  let k = 0;
  const step = (kind, name, files, r2After) => {
    const M = manifest();
    const versions = versionsFor(files);
    const last = versions[files[files.length - 1]];
    const snap = join(BASE, `snapshot-${String(k++).padStart(2, "0")}-${name}.json`);
    writeFileSync(snap, JSON.stringify(syntheticSnapshot(committed(), M, { ledgerVersion: last, r2: r2After }), null, 2));
    recordStep({ root: dir, kind, name, snapshotPath: snap, versions, capturedBy: "stage0-record-replay (synthetic versions and snapshot)" });
    appendFileSync(join(dir, PLAN), `\n<!-- replay only: ${name} recorded at ${Object.entries(versions).map(([n, v]) => `${n}=${v}`).join(" ")} -->\n`);
    git("add", "--", PLAN);
    git("commit", "--quiet", "-m", `replay: ${name} record (synthetic)`);
    return git("rev-parse", "HEAD");
  };

  const states = [{ label: M0.migrations.some((m) => m.productionVersion) || M0.rollbackRecords.length ? "HEAD (as recorded)" : "pending (HEAD)", sha: git("rev-parse", "HEAD") }];
  if (M0.rollbackRecords.length) return states;   // a recorded rollback is final: no forward after it
  const forwardSha = {};
  for (const s of P2_STEPS) {
    if (s.files.every((n) => M0.migrations.find((m) => m.n === n).productionVersion)) continue;
    forwardSha[s.step] = step("forward", s.step, s.files, true);
    states.push({ label: s.step === "P2-05" ? "P2-05 (fully applied)" : s.step, sha: forwardSha[s.step] });
  }
  const full = git("rev-parse", "HEAD");
  for (const op of manifest().rollbackOperations) {
    const sha = step("rollback", op.op, op.files, !op.files.includes("01"));
    states.push({ label: op.op === "RB-1" ? "RB-1 (committed rollback)" : `after ${op.op}`, sha });
  }
  if (ALL) {
    for (const R of RECOVERY.filter((r) => r.prefix.length && r.prefix.length < 5)) {
      const lastStep = P2_STEPS.filter((s) => s.files.every((n) => R.prefix.includes(n))).pop();
      const from = forwardSha[lastStep.step];
      if (!from) continue;   // HEAD already records beyond this prefix
      git("checkout", "--quiet", "--detach", from);
      for (const op of R.ops) {
        const files = manifest().rollbackOperations.find((o) => o.op === op).files;
        const sha = step("rollback", op, files, !files.includes("01"));
        states.push({ label: `prefix ${R.prefix.join(",")} → ${op}`, sha });
      }
    }
    git("checkout", "--quiet", "--detach", full);
  }
  return states;
}

/** Run the full suite in a fresh clone of `sha`; resolve with its TAP counts. */
function runSuite(builder, label, sha, i) {
  const dir = join(BASE, `state-${String(i).padStart(2, "0")}`);
  // A branch per state, so the clone carries the commit (a detached commit may
  // not reach a clone), and so the suite's own scratch clones of this clone do.
  execFileSync("git", ["branch", "--force", `replay-state-${i}`, sha], { cwd: builder });
  execFileSync("git", ["clone", "--quiet", "--no-checkout", builder, dir]);
  execFileSync("git", ["checkout", "--quiet", "-B", "replay-state", sha], { cwd: dir });
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;   // a child of the test runner would otherwise report in its binary format
  return new Promise((resolve) => {
    const t0 = Date.now();
    const child = spawn(process.execPath, ["--test", "--test-reporter=tap", "scripts/tests/*.test.js"], { cwd: dir, env });
    let out = "";
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { out += d; });
    child.on("close", (code) => {
      writeFileSync(join(BASE, `state-${String(i).padStart(2, "0")}.tap`), out);
      const count = (k) => { const m = new RegExp(`^# ${k} (\\d+)$`, "m").exec(out); return m ? Number(m[1]) : null; };
      const failed = [...out.matchAll(/^not ok \d+ - (.*)$/gm)].map((m) => m[1]);
      resolve({ label, sha, code, seconds: Math.round((Date.now() - t0) / 1000), tests: count("tests"), pass: count("pass"), fail: count("fail"),
        cancelled: count("cancelled"), skipped: count("skipped"), todo: count("todo"), failed });
    });
  });
}

async function pool(items, n, fn) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) { const i = next++; results[i] = await fn(items[i], i); }
  }));
  return results;
}

test("REPLAY the runbook's record commits: the FULL suite is green, with the same test count, at every state", async (t) => {
  rmSync(BASE, { recursive: true, force: true });
  mkdirSync(BASE, { recursive: true });
  try {
    const builder = join(BASE, "builder");
    const rev = process.env.STAGE0_REPLAY_REV || "HEAD";
    execFileSync("git", ["clone", "--quiet", "--no-checkout", ROOT, builder]);
    execFileSync("git", ["fetch", "--quiet", ROOT, `+${rev}:refs/replay/base`], { cwd: builder });
    execFileSync("git", ["checkout", "--quiet", "--detach", "refs/replay/base"], { cwd: builder });
    t.diagnostic(`replaying from ${rev} = ${execFileSync("git", ["rev-parse", "HEAD"], { cwd: builder }).toString().trim()}`);
    const states = buildStates(builder);
    t.diagnostic(`${states.length} states, ${JOBS} at a time`);
    const results = await pool(states, JOBS, (s, i) => runSuite(builder, s.label, s.sha, i));
    for (const r of results) t.diagnostic(`${r.label.padEnd(28)} ${r.sha.slice(0, 10)}  ${r.pass}/${r.tests} pass, ${r.fail} fail, ${r.skipped} skipped  (${r.seconds} s)${r.failed.length ? "  FAILED: " + r.failed.join(" | ") : ""}`);
    writeFileSync(join(ROOT, ".stage0-replay-summary.json"), JSON.stringify(results.map(({ failed, ...r }) => ({ ...r, failed })), null, 2) + "\n");
    const n = results[0].tests;
    assert.ok(n > 0, "the suite ran at HEAD");
    for (const r of results) {
      assert.equal(r.fail, 0, `${r.label}: ${r.failed.join(" | ")}`);
      assert.equal(r.code, 0, `${r.label}: exit code`);
      assert.equal(r.cancelled, 0, `${r.label}: cancelled`);
      assert.equal(r.skipped, 0, `${r.label}: skipped`);
      assert.equal(r.todo, 0, `${r.label}: todo`);
      assert.equal(r.pass, r.tests, `${r.label}: every test passed`);
      assert.equal(r.tests, n, `${r.label}: the same ${n} tests as at HEAD`);
    }
  } finally {
    if (process.env.STAGE0_REPLAY_KEEP !== "1") rmSync(BASE, { recursive: true, force: true });
  }
});
