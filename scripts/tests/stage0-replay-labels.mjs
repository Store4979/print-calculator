// scripts/tests/stage0-replay-labels.mjs — the states the record replay
// (scripts/tests/replay/stage0-record-replay.test.js) must build from a given
// recorded state. They are derived from the manifest's recorded fields alone,
// not from the replay's own bookkeeping, so the replay can assert that no case
// silently drops out (Codex's review of 799cc2e, item 1: the recovery from
// HEAD's own prefix, 01 → RB-1, had gone missing). Unit-tested by
// stage0-replay-labels.test.js on every build.
import { P2_STEPS, RECOVERY } from "../manual/assemble-stage0.mjs";

/**
 * The replay's state labels, in its order, for the recorded state `M0`.
 * - HEAD first;
 * - a recorded rollback is final, so nothing follows it;
 * - every P2 step HEAD does not record;
 * - every rollback operation, from the fully applied state;
 * - with `all`, the recovery from each shorter committed prefix that HEAD can
 *   reach: a prefix that contains every migration HEAD records applied.
 */
export function expectedLabels(M0, all = true) {
  const applied = new Set(M0.migrations.filter((m) => m.productionVersion).map((m) => m.n));
  const labels = [applied.size || M0.rollbackRecords.length ? "HEAD (as recorded)" : "pending (HEAD)"];
  if (M0.rollbackRecords.length) return labels;
  for (const s of P2_STEPS) if (!s.files.every((n) => applied.has(n))) labels.push(s.step === "P2-05" ? "P2-05 (fully applied)" : s.step);
  for (const o of M0.rollbackOperations) labels.push(o.op === "RB-1" ? "RB-1 (committed rollback)" : `after ${o.op}`);
  if (all) {
    for (const R of RECOVERY) {
      if (!R.prefix.length || R.prefix.length >= 5) continue;
      if (![...applied].every((n) => R.prefix.includes(n))) continue;
      for (const op of R.ops) labels.push(`prefix ${R.prefix.join(",")} → ${op}`);
    }
  }
  return labels;
}
