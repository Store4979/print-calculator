#!/usr/bin/env node
// scripts/manual/stage0-record.mjs — the REPOSITORY record of one stage-0
// database step (docs/security/stage0-p1-p3-runbook.md §10 and §A.4; plan
// §A5, §E4, §E6). It STAGES the record and stops. It never commits, never
// pushes, and never talks to a database.
//
//   node scripts/manual/stage0-record.mjs forward  <P2 step> <snapshot.json> <n>=<version>... --captured-by "<text>"
//   node scripts/manual/stage0-record.mjs rollback <RB op>   <snapshot.json> <n>=<version>... --captured-by "<text>"
//
// <n>=<version> is one pair per file of the step, e.g. 03=20261011211005
// 04=20261011211006 for P2-0304, each the version LEDGER read back.
// <snapshot.json> is TABLES-SNAPSHOT's tables_json output, saved verbatim.
//
// forward:  git mv each file of the step and its .rollback.sql companion from
//           pending/ to supabase/migrations/<version>_<name>…, and record
//           migrations[].productionVersion.
// rollback: write each rollback file's pinned bytes (the manifest's blob) as
//           supabase/migrations/<version>_<name>_rollback.sql, and append
//           rollbackRecords.
// Both:     run scripts/manual/stage0-manifest-generate.mjs, write
//           supabase/tables.json from the snapshot (project and capturedBy
//           filled), stage exactly those paths.
//
// It refuses, before changing anything:
//   - a tree with changes to tracked files (the record must be the only change);
//   - a step that is not the next one the recorded state allows: P2 order, or
//     the RB order over the applied set, with no forward after a rollback;
//   - versions that are not one per file, 14 digits, increasing, and after
//     everything already recorded;
//   - a snapshot that is not TABLES-SNAPSHOT's shape, whose ledgerVersion is
//     not the step's last version, whose Release 2 tables do not follow the
//     step, or whose other tables, views or buckets differ from the committed
//     capture's.
// After staging it checks, and throws if any fails (the staged change is then
// left for the operator to inspect, or to drop with `git reset --hard HEAD`):
//   - the manifest changed only in the record fields;
//   - the staged paths are exactly the record's;
//   - the generator's --check passes.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import * as A from "./assemble-stage0.mjs";
import { MANIFEST_PATH, forwardPath, companionPath, recordPath } from "../tests/stage0-manifest-check.mjs";

const ROOT_DEFAULT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const TABLES_PATH = "supabase/tables.json";
export const SNAPSHOT_KEYS = ["project", "capturedBy", "query", "capturedAt", "database", "role", "ledgerVersion", "tables", "views", "buckets"];
const VERSION_RE = /^\d{14}$/;

const fail = (msg) => { throw new Error(`stage0-record: ${msg}`); };
const sameSet = (a, b) => a.length === b.length && [...a].sort().every((x, i) => x === [...b].sort()[i]);

/** What the recorded state allows next, and what the step's Release 2 tables must be afterwards. */
function planStep(M, kind, name, versions) {
  const applied = M.migrations.filter((m) => m.productionVersion).map((m) => m.n);
  const done = (M.rollbackRecords || []).map((r) => r.n);
  let files;
  if (kind === "forward") {
    const i = A.P2_STEPS.findIndex((s) => s.step === name);
    if (i < 0) fail(`"${name}" is not a P2 step; one of ${A.P2_STEPS.map((s) => s.step).join(", ")}`);
    files = A.P2_STEPS[i].files;
    if (done.length) fail("rollback records exist; a forward step after a rollback is not a reviewed operation");
    const before = A.P2_STEPS.slice(0, i).flatMap((s) => s.files);
    if (!sameSet(applied, before)) fail(`${name} needs exactly ${before.join(", ") || "nothing"} recorded applied; the manifest records ${applied.join(", ") || "nothing"}`);
  } else if (kind === "rollback") {
    const op = (M.rollbackOperations || []).find((o) => o.op === name);
    if (!op) fail(`"${name}" is not a rollback operation; one of ${(M.rollbackOperations || []).map((o) => o.op).join(", ")}`);
    files = op.files;
    const rbOrder = M.rollbackOperations.flatMap((o) => o.files).filter((n) => applied.includes(n));
    if (!isDeepStrictEqual(done, rbOrder.slice(0, done.length))) fail(`the recorded rollbacks ${done.join(", ")} do not follow the RB order ${rbOrder.join(", ")}`);
    const next = rbOrder.slice(done.length, done.length + files.length);
    if (!isDeepStrictEqual(next, files)) fail(`${name} rolls back ${files.join(", ")}; the RB order over the applied set needs ${next.join(", ") || "nothing"} next`);
  } else {
    fail(`the kind must be "forward" or "rollback", not "${kind}"`);
  }
  if (!sameSet(Object.keys(versions), files)) fail(`${name} needs exactly one version for each of ${files.join(", ")}; given ${Object.keys(versions).join(", ") || "none"}`);
  const recorded = [M.ledgerBaseline.head, ...M.migrations.map((m) => m.productionVersion).filter(Boolean), ...(M.rollbackRecords || []).map((r) => r.version)];
  let prev = recorded.reduce((a, b) => (b > a ? b : a));
  for (const n of files) {
    const v = versions[n];
    if (!VERSION_RE.test(v)) fail(`version ${JSON.stringify(v)} for ${n} is not 14 digits`);
    if (!(v > prev)) fail(`version ${v} for ${n} is not after ${prev}, the newest version already recorded or given`);
    prev = v;
  }
  const r2After = kind === "forward" || !(done.includes("01") || files.includes("01"));
  return { files, last: versions[files[files.length - 1]], r2After };
}

/** TABLES-SNAPSHOT's output, held to the committed capture: returns the object to write. */
function checkSnapshot(snapshot, committed, M, { last, r2After }, capturedBy) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) fail("the snapshot is not a JSON object");
  if (!sameSet(Object.keys(snapshot), SNAPSHOT_KEYS)) fail(`the snapshot's keys are ${Object.keys(snapshot).join(", ")}; TABLES-SNAPSHOT gives ${SNAPSHOT_KEYS.join(", ")}`);
  if (snapshot.query !== "scripts/manual/tables-snapshot.sql") fail("the snapshot's query is not scripts/manual/tables-snapshot.sql");
  for (const k of ["role", "database"]) if (snapshot[k] !== committed[k]) fail(`the snapshot's ${k} is ${JSON.stringify(snapshot[k])}; the committed capture's is ${JSON.stringify(committed[k])}`);
  if (typeof snapshot.capturedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(snapshot.capturedAt)) fail("the snapshot's capturedAt is not a UTC timestamp");
  if (snapshot.ledgerVersion !== last) fail(`the snapshot's ledgerVersion is ${snapshot.ledgerVersion}; this step's last version is ${last}. It was not captured right after this step`);
  if (!(snapshot.project === M.productionRef || (typeof snapshot.project === "string" && snapshot.project.startsWith("RECORDED BY HAND")))) {
    fail(`the snapshot's project is ${JSON.stringify(snapshot.project)}, neither the placeholder nor ${M.productionRef}`);
  }
  if (typeof capturedBy !== "string" || !capturedBy.trim() || capturedBy.includes("RECORDED BY HAND")) fail("--captured-by is required: who captured it, how, on whose authority, when");
  for (const k of ["tables", "views", "buckets"]) {
    if (!Array.isArray(snapshot[k]) || !snapshot[k].every((x) => typeof x === "string" && x)) fail(`the snapshot's ${k} is not a list of names`);
    if (new Set(snapshot[k]).size !== snapshot[k].length) fail(`the snapshot's ${k} has duplicates`);
  }
  const r2 = new Set(M.tables.names);
  const others = (t) => t.filter((x) => !r2.has(x)).sort();
  if (!isDeepStrictEqual(others(snapshot.tables), others(committed.tables))) {
    fail(`the snapshot's non-Release-2 tables differ from the committed capture's: [${others(snapshot.tables).join(", ")}] vs [${others(committed.tables).join(", ")}]`);
  }
  const have = M.tables.names.filter((t) => snapshot.tables.includes(t));
  if (r2After && have.length !== M.tables.names.length) fail(`after this step the six Release 2 tables exist; the snapshot lists ${have.join(", ") || "none"}`);
  if (!r2After && have.length) fail(`after this step the Release 2 tables are dropped; the snapshot still lists ${have.join(", ")}`);
  for (const k of ["views", "buckets"]) if (!isDeepStrictEqual(snapshot[k], committed[k])) fail(`the snapshot's ${k} differ from the committed capture's`);
  const out = {};
  for (const k of SNAPSHOT_KEYS) out[k] = snapshot[k];
  out.project = M.productionRef;
  out.capturedBy = capturedBy.trim();
  return out;
}

/** The manifest without its record fields: what must NOT change. */
const withoutRecords = (M) => ({ ...M, migrations: M.migrations.map((m) => ({ ...m, productionVersion: null })), rollbackRecords: [] });

/**
 * Stage the record of one step. Returns the staged paths.
 * @param {{root?: string, kind: "forward"|"rollback", name: string, snapshotPath: string, versions: Record<string,string>, capturedBy: string}} o
 */
export function recordStep({ root = ROOT_DEFAULT, kind, name, snapshotPath, versions, capturedBy }) {
  const git = (...a) => execFileSync("git", a, { cwd: root, maxBuffer: 1 << 26 }).toString("utf8");
  if (git("status", "--porcelain", "--untracked-files=no").trim()) fail("tracked files have changes; the record must be the only change (commit or set them aside first)");
  const M = JSON.parse(git("show", `HEAD:${MANIFEST_PATH}`));
  const committed = JSON.parse(git("show", `HEAD:${TABLES_PATH}`));
  const plan = planStep(M, kind, name, versions);
  let snapshot;
  try { snapshot = JSON.parse(readFileSync(snapshotPath, "utf8").replace(/^﻿/, "")); } catch (e) { fail(`the snapshot ${snapshotPath} is not readable JSON (${e.message})`); }
  const tables = checkSnapshot(snapshot, committed, M, plan, capturedBy);

  // ── act ──
  const expected = [MANIFEST_PATH, TABLES_PATH];
  if (kind === "forward") {
    for (const n of plan.files) {
      const m = M.migrations.find((x) => x.n === n);
      const r = M.rollbacks.find((x) => x.n === n);
      const moved = { ...m, productionVersion: versions[n] };
      for (const [from, to] of [[m.pendingPath, forwardPath(moved)], [r.pendingPath, companionPath(moved, r)]]) {
        git("mv", from, to);
        expected.push(from, to);
      }
      m.productionVersion = versions[n];
    }
  } else {
    for (const n of plan.files) {
      const m = M.migrations.find((x) => x.n === n);
      const r = M.rollbacks.find((x) => x.n === n);
      const rec = { n, version: versions[n] };
      const bytes = execFileSync("git", ["cat-file", "blob", r.blob], { cwd: root, maxBuffer: 1 << 26 });
      if (A.md5(bytes) !== r.md5 || bytes.length !== r.bytes) fail(`the rollback blob of ${m.name} is not the manifest's md5/bytes`);
      const p = recordPath(m, rec);
      mkdirSync(dirname(join(root, p)), { recursive: true });
      writeFileSync(join(root, p), bytes);
      git("add", "--", p);
      expected.push(p);
      M.rollbackRecords.push(rec);
    }
  }
  writeFileSync(join(root, MANIFEST_PATH), JSON.stringify(M, null, 2) + "\n");
  execFileSync(process.execPath, [join(root, "scripts", "manual", "stage0-manifest-generate.mjs")], { cwd: root, stdio: "pipe" });
  writeFileSync(join(root, TABLES_PATH), JSON.stringify(tables, null, 2) + "\n");
  git("add", "--", MANIFEST_PATH, TABLES_PATH);

  // ── check ──
  const head = JSON.parse(git("show", `HEAD:${MANIFEST_PATH}`));
  const now = JSON.parse(readFileSync(join(root, MANIFEST_PATH), "utf8"));
  if (!isDeepStrictEqual(withoutRecords(now), withoutRecords(head))) fail("the regenerated manifest changed outside the record fields; inspect `git diff --cached`");
  if (!isDeepStrictEqual(now.migrations.map((m) => m.productionVersion), M.migrations.map((m) => m.productionVersion))) fail("the manifest's productionVersion fields are not the recorded ones");
  if (!isDeepStrictEqual(now.rollbackRecords, M.rollbackRecords)) fail("the manifest's rollbackRecords are not the recorded ones");
  const staged = git("diff", "--cached", "--name-only", "--no-renames").split("\n").map((x) => x.trim()).filter(Boolean);
  if (!sameSet(staged, expected)) fail(`the staged paths are [${staged.join(", ")}]; the record is [${expected.join(", ")}]`);
  if (git("diff", "--name-only").trim()) fail("the working tree differs from what was staged");
  execFileSync(process.execPath, [join(root, "scripts", "manual", "stage0-manifest-generate.mjs"), "--check"], { cwd: root, stdio: "pipe" });
  return staged.sort();
}

export function parseArgs(argv) {
  const a = [...argv];
  const o = { kind: a.shift(), name: a.shift(), snapshotPath: a.shift(), versions: {}, capturedBy: null };
  while (a.length) {
    const x = a.shift();
    if (x === "--captured-by") o.capturedBy = a.shift();
    else if (/^\d{2}=/.test(x)) {
      const [n, v] = x.split("=");
      if (n in o.versions) fail(`version for ${n} given twice`);
      o.versions[n] = v;
    } else fail(`unexpected argument ${JSON.stringify(x)}`);
  }
  if (!o.kind || !o.name || !o.snapshotPath) fail("usage: stage0-record.mjs <forward|rollback> <step> <snapshot.json> <n>=<version>... --captured-by \"<text>\"");
  return o;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const staged = recordStep(parseArgs(process.argv.slice(2)));
    process.stdout.write(`staged (not committed):\n${staged.map((p) => `  ${p}`).join("\n")}\nnext: add the plan record, stage it, and commit.\n`);
  } catch (e) {
    process.stderr.write(`${e.message}\n`);
    process.exit(2);
  }
}
