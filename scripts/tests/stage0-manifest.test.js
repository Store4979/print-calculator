// scripts/tests/stage0-manifest.test.js — docs/security/stage0-production-manifest.json
// is the authority for what stage 0 applies to production (plan §A7, required
// by the reviewer's F5 ruling 1). The checks live in stage0-manifest-check.mjs
// so that stage0-manifest.lifecycle.test.js can run the SAME checks on every
// repository state stage 0 produces (review of d01b74a, N3). Here they run on
// this repository:
//
//   M-0 a git checkout — everything below reads git objects, not files
//   M-1 every pinned file at the path the recorded state puts it: blob id, md5,
//       bytes, no CR. Read from git, so a Windows CRLF checkout changes nothing
//   M-2 no uncommitted edit to a pinned file, line endings aside
//   M-3 each pin resolves: a SHA holds the blob at its frozen path; the marker
//       "manifest-commit" resolves to the commit that last changed the manifest
//       (which is how a record-only manifest update stays valid); a missing
//       commit is tolerated only in a detected shallow clone
//   M-4 md5(prosrc) re-derived from the committed forward and rollback bodies
//   M-5 the assembler's constants are the manifest's
//   M-6 every output, re-assembled from the FROZEN inputs (blob ids), has its
//       pinned md5; the wrapper embeds the blob and gates on it; P1 never commits
//   M-6b the SIZE-PROBE is one read-only SELECT larger than P1, with its answer
//   M-7 A3: the pinned commit holds the pinned trees and blobs; HEAD too while
//       enforced
//   M-7b the build-input binding: every script the build command runs is
//       pinned, and .env holds only the public URL and publishable key
//   M-8 the recorded state: the 20-row baseline, forwards applied in order,
//       rollback records in RB order, and exactly the migration files that
//       state implies
//   M-10 every approved fresh-build rollback target carries the queue fix;
//       commits before it are retained URLs only (review of d01b74a, N4)
//   M-12 the send policy the pinned sender enforces (review of 07574c1): every
//       output exactly once; production texts to production only, lock probes
//       to staging only, SIZE-PROBE to staging; read_only for P0, STATE and
//       SIZE-PROBE; the sender itself pinned
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { checkManifest, MANIFEST_PATH } from "./stage0-manifest-check.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const M = JSON.parse(readFileSync(join(ROOT, MANIFEST_PATH), "utf8"));
const P = checkManifest(ROOT, M);

const NAMES = {
  "M-0": "a git checkout",
  "M-1": "every pinned file's blob at its state path: id, md5, bytes, no CR",
  "M-2": "no uncommitted edit to a pinned file (line endings aside)",
  "M-3": "every pin resolves (SHA at the frozen path; manifest-commit at the manifest's commit)",
  "M-4": "md5(prosrc) re-derived from the committed forward and rollback bodies",
  "M-5": "the assembler's constants are the manifest's",
  "M-6": "every output re-assembled from the frozen inputs has its pinned md5",
  "M-6b": "SIZE-PROBE: one read-only SELECT larger than P1, with its pinned answer",
  "M-7": "A3: the pinned commit, and HEAD while enforced, hold the pinned trees and blobs",
  "M-7b": "the build-input binding: build scripts and .env",
  "M-8": "the recorded repository state: baseline, apply order, rollback records, exact file set",
  "M-10": "every approved fresh-build rollback target carries the queue fix (orderQueue.js f99d16a9)",
  "M-12": "the send policy: every output once, targets and read_only fixed, the sender pinned",
};
for (const [k, name] of Object.entries(NAMES)) {
  test(`${k} ${name}`, () => assert.deepEqual(P[k], [], "\n  " + P[k].join("\n  ")));
}

test("M-11 CANCEL-STEP is instantiated only for a stage-0 step and CANCEL-INSPECT's exact backend_start; the values are the only change", async () => {
  const A = await import("../manual/assemble-stage0.mjs");
  const t = A.assembleAll(M, { cwd: ROOT })["CANCEL-STEP-TEMPLATE"];
  assert.equal(A.md5(t), M.outputs["CANCEL-STEP-TEMPLATE"].md5, "the template is the pinned one");
  const ok = "2026-10-01T12:00:00.123456Z";
  const s = A.cancelStepText(t, "P2-0304", ok);
  assert.ok(!s.includes(A.CANCEL_APP) && !s.includes(A.CANCEL_START), "no placeholder left");
  assert.equal(s, t.replace(A.CANCEL_APP, "release2-stage0-P2-0304").replace(A.CANCEL_START, ok), "only the two values change");
  for (const step of ["P1", "P2-01", "P2-02", "P2-0304", "P2-05", "RB-5", "RB-43", "RB-2", "RB-1"]) assert.doesNotThrow(() => A.cancelStepText(t, step, ok), step);
  for (const step of ["P2-03", "P2-04", "P0", "STATE", "lockprobe-B-CANCEL", "", "P2-0304' or true --", undefined]) {
    assert.throws(() => A.cancelStepText(t, step, ok), /is not a stage-0 step/, String(step));
  }
  for (const bs of ["2026-10-01T12:00:00Z", "2026-10-01 12:00:00.123456+00", "2026-10-01T12:00:00.123456Z'; select 1; --", "2026-10-01T12:00:00.123456Z\n", "", undefined]) {
    assert.throws(() => A.cancelStepText(t, "P2-0304", bs), /backend_start must be exactly as CANCEL-INSPECT prints it/, JSON.stringify(bs));
  }
  assert.throws(() => A.cancelStepText(t + t, "P2-0304", ok), /each placeholder exactly once/);
});

test("M-9 the manifest is at schema 2, pending today, and the assembler reads it by blob only", () => {
  assert.equal(M.schema, "stage0-production-manifest/2");
  assert.equal(M.baselineLedger.length, 20);
  const src = readFileSync(join(ROOT, "scripts/manual/assemble-stage0.mjs"), "utf8").replace(/\r\n/g, "\n");
  const start = src.indexOf("export function assembleAll");
  const body = src.slice(start, src.indexOf("\n}\n", start));
  assert.doesNotMatch(body, /git\(\s*["'`]?HEAD|ls-tree|readFileSync/, "assembleAll reads no path, no HEAD, no working tree");
});
