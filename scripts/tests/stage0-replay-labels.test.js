// scripts/tests/stage0-replay-labels.test.js — the record replay's expected
// states, derived from a recorded state (stage0-replay-labels.mjs; Codex's
// review of 799cc2e, item 1). The replay itself runs on demand; this checks,
// on every build, that the derivation keeps every reachable recovery, the one
// from HEAD's own prefix included, and omits only the unreachable ones.
// The recorded states here are synthetic, so no count depends on what HEAD
// happens to record today.
import test from "node:test";
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { expectedLabels } from "./stage0-replay-labels.mjs";
import { readManifest } from "./stage0-recorded-state.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
/** The real manifest with `applied` (the migration numbers) recorded applied, and `rollbacks` records. */
function stateWith(applied, rollbacks = []) {
  const M = JSON.parse(JSON.stringify(readManifest(ROOT)));
  M.migrations.forEach((m, i) => { m.productionVersion = applied.includes(m.n) ? `2026101112000${i}` : null; });
  M.rollbackRecords = rollbacks;
  return M;
}
const FORWARD_AND_RB = ["after RB-5", "after RB-43", "after RB-2", "RB-1 (committed rollback)"];
const REC = {
  "01": ["prefix 01 → RB-1"],
  "01,02": ["prefix 01,02 → RB-2", "prefix 01,02 → RB-1"],
  "01,02,03,04": ["prefix 01,02,03,04 → RB-43", "prefix 01,02,03,04 → RB-2", "prefix 01,02,03,04 → RB-1"],
};

test("RL-1 from a pending HEAD: every forward, every RB operation, and the recovery from each shorter prefix (15)", () => {
  assert.deepEqual(expectedLabels(stateWith([])), [
    "pending (HEAD)", "P2-01", "P2-02", "P2-0304", "P2-05 (fully applied)", ...FORWARD_AND_RB,
    ...REC["01"], ...REC["01,02"], ...REC["01,02,03,04"],
  ]);
});

test("RL-2 from HEAD at 01: the recovery from HEAD's own prefix, 01 → RB-1, is kept (14)", () => {
  const labels = expectedLabels(stateWith(["01"]));
  assert.deepEqual(labels, [
    "HEAD (as recorded)", "P2-02", "P2-0304", "P2-05 (fully applied)", ...FORWARD_AND_RB,
    ...REC["01"], ...REC["01,02"], ...REC["01,02,03,04"],
  ]);
  assert.equal(labels.filter((l) => l === "prefix 01 → RB-1").length, 1);
});

test("RL-3 later recorded states keep their own prefix's recovery and omit only the earlier ones", () => {
  assert.deepEqual(expectedLabels(stateWith(["01", "02"])), [
    "HEAD (as recorded)", "P2-0304", "P2-05 (fully applied)", ...FORWARD_AND_RB, ...REC["01,02"], ...REC["01,02,03,04"],
  ], "at 01–02: no recovery from 01 alone (unreachable), the one from 01–02 kept");
  assert.deepEqual(expectedLabels(stateWith(["01", "02", "03", "04"])), [
    "HEAD (as recorded)", "P2-05 (fully applied)", ...FORWARD_AND_RB, ...REC["01,02,03,04"],
  ], "at 01–04: only the recovery from 01–04");
  assert.deepEqual(expectedLabels(stateWith(["01", "02", "03", "04", "05"])), ["HEAD (as recorded)", ...FORWARD_AND_RB], "fully applied: the RB sequence, no shorter prefix");
  assert.deepEqual(expectedLabels(stateWith(["01"], [{ n: "01", version: "20261011130001" }])), ["HEAD (as recorded)"], "a recorded rollback is final");
  assert.deepEqual(expectedLabels(stateWith(["01"]), false), ["HEAD (as recorded)", "P2-02", "P2-0304", "P2-05 (fully applied)", ...FORWARD_AND_RB], "STAGE0_REPLAY_STATES=main: no recoveries");
});
