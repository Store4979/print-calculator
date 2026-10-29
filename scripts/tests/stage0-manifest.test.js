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
//       pinned md5; the wrapper embeds the blob and gates on it; P1 never commits;
//       M-6c the lock probes write only their own schema; M-6d the five item 2
//       envelope probes are marked STAGING ONLY and hold no write word, even
//       inside a string
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
//       and envelope probes to staging only, SIZE-PROBE to staging; read_only
//       for P0, STATE, SIZE-PROBE and the envelope probes; each text's window
//       role, R, W or C (Codex item 6, Q2); the sender itself pinned
//   M-13 the guard chain (Codex item 6, SG-6): exactly the files the three
//       guarded entry points load, as acorn reads them; only node: built-ins
//       besides; the tools' parser-free audit agrees with acorn file by file
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
  "M-7b": "the build-input binding: build scripts, the inventory's local import closure, and .env",
  "M-8": "the recorded repository state: baseline, apply order, rollback records, exact file set",
  "M-10": "every approved fresh-build rollback target carries the queue fix (orderQueue.js f99d16a9)",
  "M-12": "the send policy: every output once, targets, read_only and window fixed, the sender pinned",
  "M-13": "the guard chain: exactly the guarded entry points' closure, pinned, built-ins only, audit equal to acorn",
};
for (const [k, name] of Object.entries(NAMES)) {
  test(`${k} ${name}`, () => assert.deepEqual(P[k], [], "\n  " + P[k].join("\n  ")));
}

test("M-12/M-13 catch a wrong window role, a dropped chain pin, an extra pin and a reordered list", () => {
  const X = JSON.parse(JSON.stringify(M));
  X.send.texts["LOCKPROBE-READBACK"].window = "R";
  X.send.texts["CANCEL-INSPECT"].window = "W";
  delete X.send.texts.P0.window;
  X.guard.files = X.guard.files.filter((f) => f.path !== "scripts/manual/stage0-capture.mjs");
  X.guard.files.push({ ...X.guard.files[0], path: "scripts/manual/stage0-record.mjs" });
  const Q = checkManifest(ROOT, X);
  assert.ok(Q["M-12"].includes('LOCKPROBE-READBACK: window must be W (Codex item 6, Q2); the policy says "R"'), Q["M-12"].join("\n"));
  assert.ok(Q["M-12"].includes('CANCEL-INSPECT: window must be C (Codex item 6, Q2); the policy says "W"'));
  assert.ok(Q["M-12"].includes("P0: window must be R (Codex item 6, Q2); the policy says undefined"));
  assert.ok(Q["M-13"].includes("scripts/manual/stage0-capture.mjs is loaded by the guard chain but not pinned in guard.files"), Q["M-13"].join("\n"));
  assert.ok(Q["M-13"].includes("scripts/manual/stage0-record.mjs is pinned in guard.files but no entry loads it"));
  assert.ok(Q["M-13"].includes("guard.files is not a sorted list of distinct paths"));
  const Y = JSON.parse(JSON.stringify(M));
  Y.guard.entries = Y.guard.entries.slice(1);
  assert.deepEqual(checkManifest(ROOT, Y)["M-13"], ["guard.entries is not stage0-guard.mjs's CHAIN_ENTRIES"]);
});

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

// ── CS-4: M-6/M-6b's SQL predicates see writes hidden by comment-like text ──
// docs/security/stage0-comment-stripping-plan.md §4. Each predicate passes on
// its real text, and catches every hit planted behind every SQL wrapper below.
// Each wrapper is a form a regex `--`/`/* */` pass could not see past.
const SQL_WRAPPERS = [
  ["a /* inside a line comment, closed by -- */", (hit) => `\n-- netlify/functions/*.js\n${hit}\n-- */\n`],
  ["a literal '--' before the hit", (hit) => `\nselect '--'; ${hit}\n`],
  ["an E-string with an escaped quote and --", (hit) => `\nselect E'\\'--'; ${hit}\n`],
  ["a quoted identifier holding --", (hit) => `\nselect "a--b"; ${hit}\n`],
  ["a dollar body holding --", (hit) => `\nselect $q$--$q$; ${hit}\n`],
];
const SQL_TEXTS = async () => {
  const A = await import("../manual/assemble-stage0.mjs");
  return { A, out: A.assembleAll(M, { cwd: ROOT }) };
};

test("CS-4 M-6: STATE and CANCEL-INSPECT are read-only, and a write hidden behind each wrapper is reported", async () => {
  const { out } = await SQL_TEXTS();
  const { readOnlyViolations, STATE_WRITE_WORDS, INSPECT_WRITE_WORDS } = await import("./stage0-manifest-check.mjs");
  for (const [name, words, hits] of [
    ["STATE", STATE_WRITE_WORDS, ["delete from public.employees;", "drop table public.staff_sessions;", "truncate public.employees;"]],
    ["CANCEL-INSPECT", INSPECT_WRITE_WORDS, ["delete from public.employees;", "drop table public.staff_sessions;", "select pg_terminate_backend(1);", "do $i$ begin null; end $i$;"]],
  ]) {
    assert.deepEqual(readOnlyViolations(out[name], name, words), [], `the real ${name}`);
    for (const hit of hits) for (const [w, wrap] of SQL_WRAPPERS) {
      assert.ok(readOnlyViolations(out[name] + wrap(hit), name, words).length > 0, `${name}: ${hit} behind ${w}`);
    }
    // Text inside a nested block comment is a comment: not reported.
    assert.deepEqual(readOnlyViolations(out[name] + "\n/* a /* drop table x */ still a comment */ select 1;\n", name, words), [], `${name}: a nested comment`);
  }
  assert.deepEqual(readOnlyViolations("", "CANCEL-INSPECT", INSPECT_WRITE_WORDS), ["CANCEL-INSPECT is empty"]);
  assert.deepEqual(readOnlyViolations("-- only a comment\n", "CANCEL-INSPECT", INSPECT_WRITE_WORDS), ["CANCEL-INSPECT is empty"]);
  assert.match(readOnlyViolations("select 'abc", "STATE", STATE_WRITE_WORDS)[0], /STATE does not lex: .*unterminated string/);
});

test("CS-4 M-6: CANCEL-STEP's one pg_cancel_backend and no pg_terminate_backend hold against hidden calls", async () => {
  const { out } = await SQL_TEXTS();
  const { cancelStepProblems } = await import("./stage0-manifest-check.mjs");
  const t = out["CANCEL-STEP-TEMPLATE"];
  assert.deepEqual(cancelStepProblems(t), [], "the real template");
  for (const hit of ["perform pg_terminate_backend(v_pid);", "perform pg_cancel_backend(v_pid);"]) {
    for (const [w, wrap] of SQL_WRAPPERS) {
      assert.ok(cancelStepProblems(t + wrap(hit)).includes("CANCEL-STEP must call pg_cancel_backend exactly once and never pg_terminate_backend"), `${hit} behind ${w}`);
    }
  }
});

test("CS-4 M-6c: a LOCKPROBE write outside stage0_lockprobe hidden behind each wrapper is reported", async () => {
  const { out } = await SQL_TEXTS();
  const { lockprobeOutside } = await import("./stage0-manifest-check.mjs");
  const probes = Object.keys(out).filter((k) => k.startsWith("LOCKPROBE-"));
  assert.equal(probes.length, 10);
  for (const k of probes) assert.deepEqual(lockprobeOutside(out[k], k), [], `the real ${k}`);
  for (const k of ["LOCKPROBE-SETUP", "LOCKPROBE-B-LOCKTIMEOUT"]) {
    for (const hit of ["drop table public.employees;", "alter table public.employees add column x int;"]) {
      for (const [w, wrap] of SQL_WRAPPERS) assert.ok(lockprobeOutside(out[k] + wrap(hit), k).length > 0, `${k}: ${hit} behind ${w}`);
    }
  }
});

test("CS-4 M-6d: an envelope probe's write hidden behind each wrapper, or inside an EXECUTE string, is reported", async () => {
  const { out } = await SQL_TEXTS();
  const { probeWriteViolations, ENVELOPE_PROBES } = await import("./stage0-manifest-check.mjs");
  assert.deepEqual(Object.keys(out).filter((k) => k.startsWith("ENVELOPE-PROBE-")).sort(), ENVELOPE_PROBES);
  for (const k of ENVELOPE_PROBES) assert.deepEqual(probeWriteViolations(out[k], k), [], `the real ${k}`);
  for (const k of ["ENVELOPE-PROBE-1", "ENVELOPE-PROBE-2"]) {
    for (const hit of ["drop table public.employees;", "select pg_terminate_backend(1);", "set role postgres;"]) {
      for (const [w, wrap] of SQL_WRAPPERS) assert.ok(probeWriteViolations(out[k] + wrap(hit), k).length > 0, `${k}: ${hit} behind ${w}`);
    }
  }
  // Strings are kept: what an EXECUTE runs is a string, and a write in it is
  // seen, also when an E-string escape runs into the word.
  const BS = String.fromCharCode(92);
  for (const s of [
    "do $$ begin execute 'drop table public.employees'; end $$;\n",
    `do $$ begin execute E'select 1;${BS}ndelete from public.orders;'; end $$;\n`,
    `do $$ begin execute E'select 1;${BS}x20delete from public.orders;'; end $$;\n`,
    `do $$ begin execute E'select 1; ${BS}x64elete from public.orders;'; end $$;\n`,
    `do $$ begin execute E'select 1; ${BS}u0064elete from public.orders;'; end $$;\n`,
    `do $$ begin execute E'select 1; ${BS}144elete from public.orders;'; end $$;\n`,
  ]) assert.ok(probeWriteViolations(s, "ENVELOPE-PROBE-2").some((p) => /is not read-only: delete|is not read-only: drop/.test(p)), s);
  assert.deepEqual(probeWriteViolations(`select U&'d${BS}0065lete';\n`, "ENVELOPE-PROBE-1"), ["ENVELOPE-PROBE-1 holds a U& literal or identifier, whose escapes M-6d does not decode"]);
  assert.deepEqual(probeWriteViolations("-- only a comment\n", "ENVELOPE-PROBE-1"), ["ENVELOPE-PROBE-1 is empty"]);
  const { decodeEString } = await import("./stage0-manifest-check.mjs");
  assert.equal(decodeEString(`E'a${BS}nb${BS}x41${BS}u0042${BS}103${BS}${BS}${BS}q'`), "E'a bABC" + BS + "q'");
});

test("CS-4 M-6e: an item 3 write outside stage0_item3 (a prefix-collision or quoted target included), an unrecognized or administrative statement in a write text, a write or an unlisted call in a read text, or a guard ahead of a probe, hidden behind each wrapper, is reported as itself", async () => {
  const { out } = await SQL_TEXTS();
  const { item3Problems, I3_POLICY } = await import("./stage0-manifest-check.mjs");
  assert.deepEqual(Object.keys(out).filter((k) => k.startsWith("I3-")).sort(), Object.keys(I3_POLICY).sort());
  for (const [k, p] of Object.entries(I3_POLICY)) assert.deepEqual(item3Problems(out[k], k, p.effect), [], `the real ${k}`);
  const cases = [
    ["I3-SETUP", "write", ["drop table public.employees;", "grant all on table public.orders to anon;", "set role postgres;",
      "create schema stage0_item3_other;", "create table stage0_item3x.t (id int);"]],
    ["I3-INS-OWNED-R-DEF", "write", ["insert into public.orders (id) values (1);", "do $x$ begin raise notice 'x'; end $x$;",
      // Codex's three (review of ba1a0bd, R-R2), each of which R's checker admitted.
      "insert into stage0_item3_other.owned (id,label) values (9,'x');", 'insert into "public"."orders" (id) values (9);', "select pg_terminate_backend(12345);",
      // Unsupported target forms: the right schema quoted, a read from outside, a data-modifying CTE, a setting.
      `insert into "stage0_item3"."owned" (id, label) values (9, 'I3-X') returning id, label;`, "insert into stage0_item3.owned select 9, label from public.orders returning id, label;",
      "with d as (delete from public.orders returning 1) select 1;", "select set_config('role', 'postgres', false);", "select pg_catalog.pg_terminate_backend(12345);"]],
    ["I3-DDL-R-DEF", "write", ["create table public.t (id int);", "alter table stage0_item3.owned owner to anon; alter default privileges grant all on tables to anon;",
      "create table stage0_item3_other.ddl_r (id int);", "create table stage0_item3.ddl_x as select * from public.employees;", "create table if not exists public.t (id int);"]],
    ["I3-CLEANUP", "write", ["drop schema stage0_item3_old cascade;", "drop table public.orders;"]],
    ["I3-FIXTURE", "read", ["insert into stage0_item3.owned (id, label) values (9, 'x');", "select pg_terminate_backend(1);", "create table stage0_item3.x (id int);",
      "select lo_unlink(1);", 'select "pg_terminate_backend"(1);', "select 1 into stage0_item3.x;", "select pg_catalog.pg_terminate_backend(1);"]],
    ["I3-WHO-R-DEF", "read", ["delete from stage0_item3.open;", "select pg_sleep(1);", "select nextval('stage0_item3.s');"]],
  ];
  // Differential: the hit must add a finding the wrapper alone does not
  // (a wrapper statement is itself outside a write text's grammar), and in a
  // write text that finding quotes the hit's own statement.
  for (const [k, effect, hits] of cases) {
    for (const hit of hits) for (const [w, wrap] of SQL_WRAPPERS) {
      const base = item3Problems(out[k] + wrap(""), k, effect);
      const extra = item3Problems(out[k] + wrap(hit), k, effect).filter((p) => !base.includes(p));
      assert.ok(extra.length > 0, `${k}: ${hit} behind ${w}`);
      if (effect === "write") assert.ok(extra.some((p) => p.includes(hit.split(";")[0].slice(0, 18))), `${k}: a finding quotes ${hit} behind ${w}: ${extra.join("; ")}`);
    }
  }
  assert.deepEqual(item3Problems(out["I3-SETUP"].replace(/STAGING ONLY/g, "staging"), "I3-SETUP", "write"), ["I3-SETUP is not marked STAGING ONLY"]);
  assert.match(item3Problems(out["I3-CLEANUP"].replace("the staging seed store is absent", "x"), "I3-CLEANUP", "write").join("; "), /lacks the staging guard/);
  assert.match(item3Problems(out["I3-ABSENT"], "I3-ABSENT", "maybe").join("; "), /has no declared effect/);
  assert.deepEqual(item3Problems("-- only a comment\n", "I3-ABSENT", "read"), ["I3-ABSENT is empty"]);
});

test("CS-4 M-6b: SIZE-PROBE outside its literal stays one read-only statement; hidden writes, a moved junction and a planted dollar body are reported", async () => {
  const { A } = await SQL_TEXTS();
  const { sizeProbeOutsideProblems } = await import("./stage0-manifest-check.mjs");
  const H = A.SIZE_PROBE_HEAD, T = A.SIZE_PROBE_TAIL;
  assert.deepEqual(sizeProbeOutsideProblems(H, T), [], "the real head and tail");
  for (const hit of ["drop table public.employees;", "select 1;"]) {
    for (const [w, wrap] of SQL_WRAPPERS) {
      assert.ok(sizeProbeOutsideProblems(wrap(hit) + H, T).includes("SIZE-PROBE is not one read-only statement"), `${hit} behind ${w}`);
    }
  }
  assert.ok(sizeProbeOutsideProblems(H.slice(0, -"$probe$".length), "$probe$" + T).includes("SIZE-PROBE's head and tail do not meet at its $probe$ literal"), "a moved junction");
  assert.ok(sizeProbeOutsideProblems("select $h$ drop table public.employees $h$;\n" + H, T).length > 0, "a second dollar body is code, so the write in it is seen");
});
