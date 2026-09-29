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
};
for (const [k, name] of Object.entries(NAMES)) {
  test(`${k} ${name}`, () => assert.deepEqual(P[k], [], "\n  " + P[k].join("\n  ")));
}

test("M-9 the manifest is at schema 2, pending today, and the assembler reads it by blob only", () => {
  assert.equal(M.schema, "stage0-production-manifest/2");
  assert.equal(M.baselineLedger.length, 20);
  const src = readFileSync(join(ROOT, "scripts/manual/assemble-stage0.mjs"), "utf8").replace(/\r\n/g, "\n");
  const start = src.indexOf("export function assembleAll");
  const body = src.slice(start, src.indexOf("\n}\n", start));
  assert.doesNotMatch(body, /git\(\s*["'`]?HEAD|ls-tree|readFileSync/, "assembleAll reads no path, no HEAD, no working tree");
});
