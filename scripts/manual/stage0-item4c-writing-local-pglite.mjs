#!/usr/bin/env node
// Item 4(c)'s local runs of its writing texts (the implementation outline §3,
// runs A and B; X3), in a REAL Postgres (PGlite, PG 17 compiled to WASM): a
// pre-review check and the source of the fixtures stage0-4c-writing.test.js
// reads. NOT evidence about production or about the rehearsal project.
//
//   run B  P1-4C at 01, under the old default and under a current-default
//          variant: every proof passes; the result has exactly its schema,
//          boundaries and cap; P0-4C after equals P0-4C before, data included;
//          the savepoint-relocation mutant loses a boundary's rows; each kind of
//          failure, with the frames PostgreSQL gives it; the real stage0_expect_error
//          inside the real outer handler, with a lock_not_available, a deadlock_detected
//          and their controls. Each 55P03 and 40P01 is RAISED, not a measured lock wait
//          or deadlock: PGlite has one session
//   run W  BUILD-01 from the shim's fresh shape, under the same two variants: the
//          21 files replay as written, with their ledger rows, the marker and the
//          exact default rows; each mutated shape refused by the predicate named,
//          and a fact changed between the reads and BUILD-01 refused; each arbiter
//          and text-column shape refused or committed, with what PostgreSQL does to
//          that shape when BUILD-01's first step is taken out; a stock-like set of
//          triggers and CHECKs bound exactly, and each change to it after the review
//          refused before any file, with a sequence as the witness of what would run;
//          X3e: each class of stored expression, on both tables, refused in both places
//          before any file, each ordinary built-in form committed, and what the walk
//          cannot see, recorded. X3f: the stored node trees, policy counts and foreign keys
//          the same way, with Codex's enum comparator as it ran it
// It writes each result to the fixtures directory, with an index of every file's
// sha256. A FAIL line below names a case that did not give its expected value,
// and the process exits 1.
//
// WHAT IT CANNOT SHOW: Supabase's real roles (postgres is a superuser here), its
// platform objects (the shim's storage and auth are minimal), platform hooks, event
// triggers, the image, concurrency, the query route.
//
//   PGLITE_DIR=<dir>/node_modules/@electric-sql/pglite node scripts/manual/stage0-item4c-writing-local-pglite.mjs [--out <dir>]
import { createHash } from "node:crypto";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { writeFileSync, mkdirSync } from "node:fs";
import { REPO, A, MANIFEST, TEXTS, LEDGER, fresh, at01, read } from "./stage0-item4c-local-base.mjs";

const C = await import(pathToFileURL(join(REPO, "scripts", "manual", "stage0-4c-compare.mjs")).href);
const CL = await import(pathToFileURL(join(REPO, "scripts", "manual", "stage0-classify.mjs")).href);
const args = process.argv.slice(2);
const OUT = args.includes("--out") ? args[args.indexOf("--out") + 1] : join(REPO, "scripts", "tests", "fixtures", "stage0-4c-writing");
mkdirSync(OUT, { recursive: true });
const files = {};
const save = (name, value) => {
  const text = JSON.stringify(value) + "\n";
  writeFileSync(join(OUT, name), text);
  files[name] = createHash("sha256").update(text).digest("hex");
};
let failures = 0;
const say = (ok, label) => { console.log(`${ok ? "PASS" : "FAIL"}  ${label}`); if (!ok) failures++; };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const src = A.sourceFromManifest(MANIFEST, { cwd: REPO });

/** A multi-statement text's last result, or the error's fields. */
async function runText(db, text) {
  try {
    const all = await db.exec(text);
    const last = [...all].reverse().find((r) => r.fields && r.fields.length);
    return { ok: true, rows: last ? last.rows : [] };
  } catch (e) {
    await db.exec("rollback").catch(() => {});
    return { ok: false, code: e.code, message: e.message, where: e.where ?? null, severity: e.severity ?? null };
  }
}

// The current-default variant of plan §5.4: what the post's opt-in SQL does, on
// the tables and sequences of public, for the object-creating role.
const CURRENT_DEFAULT = `alter default privileges in schema public revoke select, insert, update, delete on tables from anon, authenticated, service_role;
  alter default privileges in schema public revoke usage, select on sequences from anon, authenticated, service_role;`;

// ── run B: P1-4C ────────────────────────────────────────────────────────────
const p1 = TEXTS["P1-4C"];
{
  const db = await at01();
  const before = await read(db, "P0-4C");
  const r = await runText(db, p1);
  say(r.ok, `run B: P1-4C completes at 01${r.ok ? "" : `: ${r.code} ${r.message}`}`);
  const after = await read(db, "P0-4C");
  save("b-p1.json", r.rows ?? r);
  const check = CL.SUCCESS["P1-4C"].check(JSON.stringify(r.rows ?? []));
  say(check.ok, `run B: its result is P1-4C's contracted success${check.ok ? "" : `: ${check.why}`}`);
  say(same(before, after), "run B: P0-4C after equals P0-4C before, data included");
  save("b-p1-p0-unchanged.json", { equal: same(before, after), rows: before.length });
  // The boundary relocated inside the savepoint: its rows are undone with it.
  const boundary = "do $stage0_locks$\nbegin\n  perform pg_temp.stage0_locks(3, 'before-savepoint');\n" + A.RERAISE + "$stage0_locks$;\n";
  const at = p1.indexOf("\n-- ===== lock boundary before-savepoint =====\n");
  if (at < 0 || p1.split(boundary).length !== 2) throw new Error("the boundary is not where this run expects it");
  const moved = p1.replace(boundary, "").replace("savepoint stage0_03_alone;\n", `savepoint stage0_03_alone;\n${boundary}`);
  const m = await runText(await at01(), moved);
  say(m.ok, `run B: the relocated text runs${m.ok ? "" : `: ${m.message}`}`);
  save("b-p1-inside-savepoint.json", m.rows ?? m);
  const mc = CL.SUCCESS["P1-4C"].check(JSON.stringify(m.rows ?? []));
  say(!mc.ok && /before-savepoint/.test(mc.why), `run B: the relocated boundary's rows are gone, and the predicate refuses: ${mc.why}`);
}
{
  const db = await at01();
  await db.exec(CURRENT_DEFAULT);
  const before = await read(db, "P0-4C");
  const r = await runText(db, p1);
  const check = CL.SUCCESS["P1-4C"].check(JSON.stringify(r.rows ?? []));
  const after = await read(db, "P0-4C");
  say(r.ok && check.ok && same(before, after), `run B: under the current-default variant: completes, contracted, P0-4C unchanged${r.ok ? "" : `: ${r.message}`}`);
  save("b-p1-current-default.json", r.rows ?? r);
}
// Each kind of failure, with the frames it comes with.
const FAILURES = [
  // S0.2: not at 01. A check in a top-level DO: re-raised, one frame.
  ["b-fail-s02", "create function public.release2_extra() returns void language sql as 'select 1';", p1, /^STAGE0 PROOF S0\.2 FAILED/, "P0001", /^PL\/pgSQL function inline_code_block line \d+ at RAISE$/],
  // A wrapper's guard, in its verbatim body: one frame.
  ["b-fail-guard", "update public.stores set slug = 'not-store4979' where slug = 'store4979';", p1, /store4979 is absent/, "P0001", /^PL\/pgSQL function inline_code_block line \d+ at RAISE$/],
];
for (const [name, setup, text, msg, code, frames] of FAILURES) {
  const db = await at01();
  await db.exec(setup);
  const r = await runText(db, text);
  save(`${name}.json`, r);
  say(!r.ok && r.code === code && msg.test(r.message) && frames.test(String(r.where)), `run B: ${name}: ${r.code} ${String(r.message).slice(0, 70)} | ${String(r.where).slice(0, 90)}`);
}
{
  // After the forward path, P1-4C's state-01 check refuses (plan §2.5, R2).
  const db = await at01();
  await db.exec(TEXTS["P2-02"]);
  const r = await runText(db, p1);
  save("b-fail-after-02.json", r);
  say(!r.ok && /^STAGE0 PROOF S0\.2 FAILED/.test(r.message) && /^PL\/pgSQL function inline_code_block line \d+ at RAISE$/.test(String(r.where)), `run B: after P2-02 the state-01 check refuses: ${String(r.message).slice(0, 70)}`);
}
{
  // How PERFORM's query reads in a frame, on a multi-line call, with no handler.
  const db = await at01();
  const r = await runText(db, `create function pg_temp.boom(p text, q text) returns void language plpgsql as $f$ begin raise exception 'boom' using errcode = 'P0001'; end $f$;
do $x$
begin
  perform pg_temp.boom('a',
    'b');
end
$x$;`);
  save("b-perform-frame.json", r);
  say(!r.ok && String(r.where).includes("SQL statement \"SELECT pg_temp.boom('a',\n    'b')\"") && /at PERFORM$/.test(String(r.where)), `run B: PERFORM's frame quotes SELECT, then the call as written: ${JSON.stringify(r.where)}`);
}
{
  // X3-R1 (Codex's review of 87b34fa): section 0's real helper, inside the real outer
  // handler, at 01. Each error is raised on purpose: PGlite has one session, so no
  // lock wait is measured here, and its envelope is rendered by the test, not a receipt.
  const quote = (s) => `'${s.replaceAll("'", "''")}'`;
  const raising = (state, message) => `do $inner$ begin raise exception ${quote(message)} using errcode = ${quote(state)}; end $inner$;`;
  const helper = (sql, unchanged = "select 1 as v") => `do $probe$\nbegin\n  perform pg_temp.stage0_expect_error('X3-LOCK', null, ${quote(sql)}, '42501', 'the expected refusal', ${quote(unchanged)});\n${A.RERAISE}$probe$;`;
  const LOCK = "canceling statement due to lock timeout";
  const DEADLOCK = "deadlock detected";
  const section0 = A.p1PrimeSections(src)["0"];
  const HANDLER = "    raise exception 'stage0 sentinel' using errcode = 'P0002';\n  exception\n    when lock_not_available or deadlock_detected then raise;\n    when others then\n";
  if (section0.split(HANDLER).length !== 2) throw new Error("the helper's handler is not where this run expects it");
  const asX3Had = section0.split(HANDLER).join("    raise exception 'stage0 sentinel' using errcode = 'P0002';\n  exception when others then\n");
  const asX3bHad = section0.split(HANDLER).join("    raise exception 'stage0 sentinel' using errcode = 'P0002';\n  exception\n    when lock_not_available then raise;\n    when others then\n");
  const raiser = (name, state, message) => `create function pg_temp.${name}() returns integer language plpgsql as $f$ begin raise exception ${quote(message)} using errcode = ${quote(state)}; end $f$;`;
  const LOCK_FN = raiser("x3_lock", "55P03", LOCK);
  const DEADLOCK_FN = raiser("x3_deadlock", "40P01", DEADLOCK);
  const inCheck = (call) => `do $probe$\nbegin\n  perform ${call};\n${A.RERAISE}$probe$;`;
  const db = await at01();
  const FRAMES = /stage0_expect_error/;
  for (const [name, head, text, check] of [
    // Codex's probe: the state and its frames survive both handlers.
    ["lock-through-helper", section0, helper(raising("55P03", LOCK)), (r) => r.code === "55P03" && r.message === LOCK && FRAMES.test(r.where)],
    // The same for a deadlock (X3c), which X3b's helper still converted.
    ["deadlock-through-helper", section0, helper(raising("40P01", DEADLOCK)), (r) => r.code === "40P01" && r.message === DEADLOCK && FRAMES.test(r.where)],
    ["deadlock-other-words", section0, helper(raising("40P01", "some other words")), (r) => r.code === "40P01" && r.message === "some other words"],
    ["deadlock-words-other-state", section0, helper(raising("42P01", DEADLOCK)), (r) => r.code === "P0001" && r.message === `STAGE0 PROOF X3-LOCK FAILED: expected [42501] the expected refusal, got [42P01] ${DEADLOCK}`],
    ["deadlock-in-the-digest", `${section0}\n${DEADLOCK_FN}`, helper("select 1", "select pg_temp.x3_deadlock() as v"), (r) => r.code === "40P01" && /stage0_digest/.test(r.where)],
    ["deadlock-in-a-check", `${section0}\n${DEADLOCK_FN}`, inCheck("pg_temp.x3_deadlock()"), (r) => r.code === "40P01" && /at PERFORM$/.test(r.where)],
    ["deadlock-helper-as-x3b-had-it", asX3bHad, helper(raising("40P01", DEADLOCK)), (r) => r.code === "P0001" && /got \[40P01\]/.test(r.message)],
    // Unrelated states whose words say "deadlock" or "lock timeout", through the outer handler alone: they stay under the profiles.
    ["unrelated-state-deadlock-words", section0, `do $probe$\nbegin\n  raise exception ${quote(DEADLOCK)} using errcode = '42P01';\n${A.RERAISE}$probe$;`, (r) => r.code === "42P01" && r.message === DEADLOCK],
    ["unrelated-state-lock-words", section0, `do $probe$\nbegin\n  raise exception ${quote(LOCK)} using errcode = '42P01';\n${A.RERAISE}$probe$;`, (r) => r.code === "42P01" && r.message === LOCK],
    // Each state raised directly in a DO block: the one frame a witnessed profile has, and still its state.
    ["lock-one-frame", section0, `do $probe$\nbegin\n  raise exception ${quote(LOCK)} using errcode = '55P03';\n${A.RERAISE}$probe$;`, (r) => r.code === "55P03" && /^PL\/pgSQL function inline_code_block line \d+ at RAISE$/.test(r.where)],
    ["deadlock-one-frame", section0, `do $probe$\nbegin\n  raise exception ${quote(DEADLOCK)} using errcode = '40P01';\n${A.RERAISE}$probe$;`, (r) => r.code === "40P01" && /^PL\/pgSQL function inline_code_block line \d+ at RAISE$/.test(r.where)],
    // The state decides, not the words: other words keep the state, and the words alone stay a wrong refusal.
    ["lock-other-words", section0, helper(raising("55P03", "some other words")), (r) => r.code === "55P03" && r.message === "some other words"],
    ["timeout-words-other-state", section0, helper(raising("42P01", LOCK)), (r) => r.code === "P0001" && r.message === `STAGE0 PROOF X3-LOCK FAILED: expected [42501] the expected refusal, got [42P01] ${LOCK}`],
    // The helper's own controls.
    ["expected-refusal", section0, helper(raising("42501", "the expected refusal")), (r) => r.ok && r.proof === "[42501] the expected refusal; rows unchanged"],
    ["wrong-refusal", section0, helper(raising("42P01", "another refusal")), (r) => r.code === "P0001" && /got \[42P01\] another refusal$/.test(r.message)],
    ["wrong-message", section0, helper(raising("42501", "another message")), (r) => r.code === "P0001" && /got \[42501\] another message$/.test(r.message)],
    ["no-refusal", section0, helper("select 1"), (r) => r.code === "P0001" && /got \[NO ERROR\] $/.test(r.message)],
    // OTHERS does not match query_canceled, in either handler.
    ["statement-timeout-state", section0, helper(raising("57014", "canceling statement due to statement timeout")), (r) => r.code === "57014" && FRAMES.test(r.where)],
    // The other places a lock wait can surface on this path: the digest, before the inner block, and a check.
    ["lock-in-the-digest", `${section0}\n${LOCK_FN}`, helper("select 1", "select pg_temp.x3_lock() as v"), (r) => r.code === "55P03" && /stage0_digest/.test(r.where)],
    ["lock-in-a-check", `${section0}\n${LOCK_FN}`, inCheck("pg_temp.x3_lock()"), (r) => r.code === "55P03" && /at PERFORM$/.test(r.where)],
    // The helper as X3 had it: this is the conversion Codex found, and the fix is what ends it.
    ["lock-helper-as-x3-had-it", asX3Had, helper(raising("55P03", LOCK)), (r) => r.code === "P0001" && /got \[55P03\]/.test(r.message)],
  ]) {
    await db.exec("begin");
    await db.exec(head);
    const r = await runText(db, text);
    if (r.ok) { r.proof = (await db.query("select what from stage0_proof where n = 'X3-LOCK'")).rows[0]?.what ?? null; await db.exec("rollback"); }
    delete r.rows;
    save(`b-helper-${name}.json`, r);
    say(check({ where: "", ...r }), `run B: the helper, ${name}: ${r.ok ? r.proof : `${r.code} ${String(r.message).slice(0, 90)}`}`);
  }
}

// ── run W: BUILD-01 ─────────────────────────────────────────────────────────
const REF = "abcdefghijklmnopqrst";
const reading = async (db) => ({ build00: await read(db, "BUILD-00"), build00w: await read(db, "BUILD-00W") });
/** The set a review of this reading would accept: each shape here is its own review. */
const own = (rd) => C.reviewedSetOf(rd.build00);
/** B1's explicit disposition of each reported body, as if a reader gave it: these runs are about the other rules. */
const disposed = (rd) => Object.fromEntries(Object.entries(C.bodyReviewItemsOf(rd.build00)).map(([k, digest]) => [k, { digest, disposition: "this local run's own body" }]));
/** Production's checked state, for the target after the files: at01's, on each variant. */
const finalFor = async (setup) => { const db = await at01(); if (setup) await db.exec(setup); return read(db, "P0-4C"); };
const reference = await at01();
const refState = await read(reference, "P0-4C");
const partOf = (rows, p) => rows.filter((r) => r.part === p).map((r) => [r.key, r.value]);

for (const [label, setup, finalSetup] of [["w-old", "", ""], ["w-current", CURRENT_DEFAULT, CURRENT_DEFAULT]]) {
  const db = await fresh();
  if (setup) await db.exec(setup);
  const rd = await reading(db);
  const finalFrom = await finalFor(finalSetup);
  const { facts, findings } = C.build01Facts({ ...rd, ref: REF, finalFrom, reviewed: own(rd), bodyReview: disposed(rd) });
  say(facts !== null, `run W: ${label}: the facts bind${facts ? "" : `: ${JSON.stringify(C.blocking(findings))}`}`);
  const text = A.build01Text(src, MANIFEST, facts);
  save(`${label}-facts.json`, { facts, md5: A.md5(text), bytes: Buffer.byteLength(text) });
  const r = await runText(db, text);
  say(r.ok, `run W: ${label}: BUILD-01 commits${r.ok ? "" : `: ${r.code} ${r.message} | ${r.where}`}`);
  say(CL.SUCCESS["BUILD-01"].check(JSON.stringify(r.rows ?? [])).ok, `run W: ${label}: its last row is its contracted success: ${JSON.stringify(r.rows)}`);
  const state = await read(db, "P0-4C");
  save(`${label}-state.json`, state);
  const fp = (rows) => rows.find((x) => x.part === 2 && x.key === "fingerprint")?.value;
  const stops = C.blocking(C.p0Findings(MANIFEST, C.readObservation(state), { target: "rehearsal" }));
  say(!stops.length, `run W: ${label}: P0-4C accepts the result at 01 on the rehearsal${stops.length ? `: ${JSON.stringify(stops.slice(0, 3))}` : ""}`);
  say(fp(state) === fp(refState), `run W: ${label}: the public catalog's fingerprint equals the local 01's`);
  say(same(partOf(state, 1).filter(([k]) => !k.startsWith("#")), partOf(refState, 1).filter(([k]) => !k.startsWith("#"))), `run W: ${label}: the ledger part equals the local 01's`);
  say(same(partOf(state, 3), partOf(finalFrom, 3)), `run W: ${label}: the default ACL part is the target's, exactly`);
  const marker = (await db.query("select ref, note from stage0_rehearsal.marker")).rows;
  say(same(marker, [{ ref: REF, note: A.BUILD_MARKER_NOTE }]), "run W: the marker holds the ref and its words");
}
{
  // BUILD-01 where BUILD-00 found no schema, and an empty ledger.
  for (const [label, setup, status] of [["w-absent-schema", "drop schema supabase_migrations;", "absent-schema"], ["w-empty", LEDGER, "empty"]]) {
    const db = await fresh();
    await db.exec(setup);
    const rd = await reading(db);
    const { facts } = C.build01Facts({ ...rd, ref: REF, finalFrom: refState, reviewed: own(rd), bodyReview: disposed(rd) });
    say(facts?.ledger === status, `run W: ${label}: the facts bind ${status}`);
    const text = A.build01Text(src, MANIFEST, facts);
    const r = await runText(db, text);
    save(`${label}-facts.json`, { facts, md5: A.md5(text), bytes: Buffer.byteLength(text) });
    say(r.ok, `run W: ${label}: BUILD-01 commits${r.ok ? "" : `: ${r.message}`}`);
  }
}
// Each mutated shape: the facts are read from it, so only the predicate refuses it.
const SHAPES = [
  ["job-files-row", "insert into storage.buckets (id, name) values ('job-files', 'job-files');", ["buckets-rows"]],
  ["customer-uploads-row", "insert into storage.buckets (id, name) values ('customer-uploads', 'customer-uploads');", ["buckets-rows"]],
  ["extra-notnull-bucket-column", "alter table storage.buckets add column tenant text not null;", ["buckets-notnull"]],
  ["generated-bucket-column", "alter table storage.buckets drop column file_size_limit; alter table storage.buckets add column file_size_limit bigint generated always as (1) stored;", ["buckets-generated"]],
  ["no-arbiter", "alter table storage.objects drop constraint objects_bucket_id_fkey; alter table storage.buckets drop constraint buckets_pkey;", ["buckets-arbiter"]],
  ["policy-present", "create policy job_files_anon_insert on storage.objects for insert with check (true);", ["objects-policies"]],
  ["publication-all-tables", "drop publication supabase_realtime; create publication supabase_realtime for all tables;", ["publication-present"]],
  ["publication-absent", "drop publication supabase_realtime;", ["publication-authority", "publication-present"]],
  ["extra-notnull-user-column", "alter table auth.users add column tenant text not null;", ["authusers-notnull"]],
  ["user-trigger", "create function auth.t() returns trigger language plpgsql as 'begin return new; end'; create trigger t before insert on auth.users for each row execute function auth.t();", ["authusers-triggers"]],
  ["marker-present", "create schema stage0_rehearsal;", ["marker-absent"]],
  ["object-in-public", "create table public.something (id int);", ["public-empty"]],
  ["pending-jobs-member", "create table public.pending_jobs (id int primary key); alter publication supabase_realtime add table public.pending_jobs;", ["public-empty", "publication-member"]],
  ["objects-absent", "drop table storage.objects;", ["objects-authority", "objects-table"]],
  ["user-column-type", "alter table auth.users alter column email type integer using 0;", ["authusers-columns"]],
];
for (const [name, setup, want] of SHAPES) {
  const db = await fresh();
  await db.exec(setup);
  const rd = await reading(db);
  const creator = rd.build00w.find((r) => r.part === "role" && r.key === "name").value;
  const ledger = rd.build00.find((r) => r.part === "ledger" && r.key === "status").value;
  const js = C.buildPredicateFindings(rd.build00, rd.build00w, { creator, ledger, reviewed: own(rd) }).map((f) => f.key).sort();
  const facts = { ref: REF, creator, ledger, employees: 2, digests: { build00: C.partDigests(rd.build00), build00w: C.partDigests(rd.build00w) }, reviewed: own(rd), defaultsNow: C.defaultsOf(rd.build00, "defaults", creator), defaultsFinal: C.defaultsOf(refState, 3, creator) };
  const r = await runText(db, A.build01Text(src, MANIFEST, facts));
  const sql = (/does not hold: (.*)$/.exec(String(r.message)) || [, ""])[1].split(", ").filter(Boolean).sort();
  save(`w-shape-${name}.json`, { js, sql, code: r.code ?? null, where: r.where ?? null });
  say(same(js, want) && same(sql, want) && !r.ok && /^PL\/pgSQL function inline_code_block line \d+ at RAISE$/.test(String(r.where)), `run W: ${name}: the comparator and BUILD-01 both refuse: ${js.join(", ")} | ${sql.join(", ")}`);
}
// X3-R2 and X3-R3 (Codex's review of 87b34fa): the arbiter and the text columns. Each
// shape's readings are saved whole, so the test runs the comparator on them, and the
// refusal is BUILD-01's own read, before any file. `real` is what PostgreSQL does to the
// shape with BUILD-01's first step taken out: the failure the predicate prevents, or,
// for a shape that is only unsupported, a commit. So each expected outcome comes from
// the database, not from either predicate.
const NO_KEY = "alter table storage.objects drop constraint objects_bucket_id_fkey; alter table storage.buckets drop constraint buckets_pkey;";
const withoutFirstStep = (text) => { const s = text.split(/(?=^do \$stage0_build\$$)/m); s.splice(1, 1); return s.join(""); };
const noneLeft = async (db) => (await db.query("select to_regclass('supabase_migrations.schema_migrations') is null as ledger_absent, to_regnamespace('stage0_rehearsal') is null as marker_absent, to_regclass('public.print_jobs') is null as files_absent")).rows[0];
const STOPPED = [
  // Codex's two probes.
  ["deferrable-key", `${NO_KEY} alter table storage.buckets add primary key (id) deferrable initially immediate;`, ["buckets-arbiter"], "55000"],
  ["name-varchar-1", "alter table storage.buckets alter column name type varchar(1);", ["buckets-columns"], "22001"],
  // The arbiter's other forms.
  ["deferred-key", `${NO_KEY} alter table storage.buckets add primary key (id) deferrable initially deferred;`, ["buckets-arbiter"], "55000"],
  ["second-deferrable-unique", "alter table storage.buckets add constraint buckets_id_deferrable unique (id) deferrable;", ["buckets-arbiter"], "55000"],
  ["partial-key", `${NO_KEY} create unique index buckets_id_partial on storage.buckets (id) where public;`, ["buckets-arbiter"], "42P10"],
  ["invalid-key", "update pg_index set indisvalid = false where indexrelid = 'storage.buckets_pkey'::regclass;", ["buckets-arbiter"], "42P10"],
  ["composite-key", `${NO_KEY} alter table storage.buckets add primary key (id, name);`, ["buckets-arbiter"], "42P10"],
  ["expression-key", `${NO_KEY} create unique index buckets_id_expr on storage.buckets (lower(id));`, ["buckets-arbiter"], "42P10"],
  // Shapes PostgreSQL would take, which the narrow form stops for review.
  ["unique-not-primary", `${NO_KEY} alter table storage.buckets add constraint buckets_id_unique unique (id);`, ["buckets-arbiter"], null],
  ["index-no-constraint", `${NO_KEY} create unique index buckets_id_idx on storage.buckets (id);`, ["buckets-arbiter"], null],
  // Each bounded column one short of the longest literal it is given.
  ["id-one-short", "alter table storage.buckets alter column id type varchar(15);", ["buckets-columns"], "22001"],
  ["name-one-short", "alter table storage.buckets alter column name type varchar(15);", ["buckets-columns"], "22001"],
  ["aud-one-short", "alter table auth.users alter column aud type varchar(12);", ["authusers-columns"], "22001"],
  ["role-one-short", "alter table auth.users alter column role type varchar(12);", ["authusers-columns"], "22001"],
  ["email-one-short", "alter table auth.users alter column email type varchar(24);", ["authusers-columns"], "22001"],
  // A form the rule does not name, long enough: unsupported, so it stops.
  ["name-char-20", "alter table storage.buckets alter column name type char(20);", ["buckets-columns"], null],
];
for (const [name, setup, want, realCode] of STOPPED) {
  const db = await fresh();
  await db.exec(setup);
  const rd = await reading(db);
  const creator = rd.build00w.find((r) => r.part === "role" && r.key === "name").value;
  const ledger = rd.build00.find((r) => r.part === "ledger" && r.key === "status").value;
  const js = C.buildPredicateFindings(rd.build00, rd.build00w, { creator, ledger, reviewed: own(rd) }).map((f) => f.key).sort();
  const facts = { ref: REF, creator, ledger, employees: 2, digests: { build00: C.partDigests(rd.build00), build00w: C.partDigests(rd.build00w) }, reviewed: own(rd), defaultsNow: C.defaultsOf(rd.build00, "defaults", creator), defaultsFinal: C.defaultsOf(refState, 3, creator) };
  const text = A.build01Text(src, MANIFEST, facts);
  const r = await runText(db, text);
  const sql = (/does not hold: (.*)$/.exec(String(r.message)) || [, ""])[1].split(", ").filter(Boolean).sort();
  const left = await noneLeft(db);
  const real = await runText(db, withoutFirstStep(text));
  save(`w-stop-${name}.json`, { ...rd, js, sql, code: r.code ?? null, message: r.message ?? null, where: r.where ?? null, left, real: real.ok ? { committed: true } : { committed: false, code: real.code, message: real.message } });
  const realOk = realCode === null ? real.ok : !real.ok && real.code === realCode;
  say(same(js, want) && same(sql, want) && !r.ok && left.ledger_absent && left.marker_absent && left.files_absent && realOk, `run W: ${name}: the comparator and BUILD-01's first step name ${js.join(", ")} | ${sql.join(", ")}; without that step: ${real.ok ? "it commits" : `${real.code} ${real.message}`}`);
}
const COMMITTED = [
  ["key-recreated", `${NO_KEY} alter table storage.buckets add primary key (id);`],
  // The platform's own shape: another unique index, on name, is no arbiter here.
  ["key-and-unique-name", "create unique index bname on storage.buckets (name);"],
  // Each bounded column exactly as long as the longest literal it is given.
  ["fit-exact", "alter table storage.buckets alter column id type varchar(16), alter column name type varchar(16); alter table auth.users alter column aud type varchar(13), alter column role type varchar(13), alter column email type varchar(25);"],
  ["fit-unbounded", "alter table storage.buckets alter column id type varchar, alter column name type varchar; alter table auth.users alter column aud type varchar, alter column role type varchar, alter column email type varchar;"],
  ["fit-text", "alter table auth.users alter column aud type text, alter column role type text, alter column email type text;"],
];
for (const [name, setup] of COMMITTED) {
  const db = await fresh();
  await db.exec(setup);
  const rd = await reading(db);
  const { facts, findings } = C.build01Facts({ ...rd, ref: REF, finalFrom: refState, reviewed: own(rd), bodyReview: disposed(rd) });
  const stops = C.blocking(findings);
  const r = facts ? await runText(db, A.build01Text(src, MANIFEST, facts)) : { ok: false, message: "no facts" };
  const state = r.ok ? await read(db, "P0-4C") : [];
  const fp = (rows) => rows.find((x) => x.part === 2 && x.key === "fingerprint")?.value;
  const success = CL.SUCCESS["BUILD-01"].check(JSON.stringify(r.rows ?? [])).ok;
  save(`w-commit-${name}.json`, { ...rd, stops, committed: r.ok, success, fingerprintEqual: fp(state) === fp(refState) });
  say(!stops.length && r.ok && success && fp(state) === fp(refState), `run W: ${name}: the facts bind, BUILD-01 commits, and the catalog's fingerprint is the local 01's${r.ok ? "" : `: ${r.code} ${r.message}`}`);
}
// X3d (Codex's review of 1a7aff1, §2): what runs on BUILD-01's INSERTs is bound exactly.
// STOCK is a synthetic shape with a stock project's counts and the behaviours Ryan's
// staging read describes: seven enabled triggers on storage.buckets, two of them on
// INSERT, under another owner; five CHECKs using only built-ins; one on auth.users. Its
// bodies and hashes are this run's own, and nothing here approves them: `reviewed` is
// taken from the shape's own reading, as B1 takes it from the throwaway's reviewed R0a.
const STOCK = `
create role supabase_storage_admin nologin;
alter table storage.buckets add column lifecycle_state text;
create sequence storage.review_witness;
create function storage.enforce_bucket_name_length() returns trigger language plpgsql as $f$
begin
  if length(new.name) > 100 then raise exception 'bucket name is too long'; end if;
  return new;
end $f$;
create function storage.protect_bucket_control_columns() returns trigger language plpgsql as $f$
begin
  if new.lifecycle_state is not null and not pg_has_role(current_user, tg_argv[0], 'member') then
    raise exception 'only that role may set a lifecycle column' using errcode = '42501';
  end if;
  return new;
end $f$;
create function storage.bucket_lifecycle() returns trigger language plpgsql as $f$ begin return coalesce(new, old); end $f$;
alter function storage.enforce_bucket_name_length() owner to supabase_storage_admin;
alter function storage.protect_bucket_control_columns() owner to supabase_storage_admin;
alter function storage.bucket_lifecycle() owner to supabase_storage_admin;
create trigger enforce_bucket_name_length_trigger before insert or update of name on storage.buckets for each row execute function storage.enforce_bucket_name_length();
create trigger protect_bucket_control_insert before insert on storage.buckets for each row execute function storage.protect_bucket_control_columns('service_role');
create trigger protect_bucket_control_update before update of lifecycle_state on storage.buckets for each row execute function storage.bucket_lifecycle();
create trigger protect_bucket_control_delete before delete on storage.buckets for each row execute function storage.bucket_lifecycle();
create trigger bucket_versioning_update after update of public on storage.buckets for each row execute function storage.bucket_lifecycle();
create trigger bucket_versioning_delete after delete on storage.buckets for each row execute function storage.bucket_lifecycle();
create trigger bucket_lifecycle_truncate before truncate on storage.buckets for each statement execute function storage.bucket_lifecycle();
alter table storage.buckets
  add constraint buckets_name_length check (length(name) <= 100),
  add constraint buckets_id_length check (length(id) <= 100),
  add constraint buckets_size_positive check (file_size_limit is null or file_size_limit >= 0),
  add constraint buckets_lifecycle_form check (lifecycle_state is null or length(lifecycle_state) > 0),
  add constraint buckets_name_form check (position('/' in name) = 0);
alter table auth.users add constraint users_email_length check (email is null or length(email) <= 255);
`;
const NEXTVAL_BODY = "perform nextval('storage.review_witness');";
const WHEN_FN = "create function storage.when_fn(text) returns boolean language plpgsql as $f$ begin return true; end $f$; create trigger with_when before insert on storage.buckets for each row when (storage.when_fn(new.name)) execute function storage.bucket_lifecycle();";
const CHECK_FN = "create function storage.check_fn(text) returns boolean language plpgsql as $f$ begin return true; end $f$; alter table storage.buckets add constraint via_fn check (storage.check_fn(name));";
const USERS_CHECK_FN = "create function auth.check_fn(text) returns boolean language plpgsql as $f$ begin return true; end $f$; alter table auth.users add constraint via_fn check (auth.check_fn(aud));";
const facts0 = (rd, reviewed) => { const creator = rd.build00w.find((r) => r.part === "role" && r.key === "name").value; return { ref: REF, creator, ledger: rd.build00.find((r) => r.part === "ledger" && r.key === "status").value, employees: 2, digests: { build00: C.partDigests(rd.build00), build00w: C.partDigests(rd.build00w) }, reviewed, defaultsNow: C.defaultsOf(rd.build00, "defaults", creator), defaultsFinal: C.defaultsOf(refState, 3, creator) }; };
const witness = async (db) => (await db.query("select is_called from storage.review_witness")).rows[0].is_called;
const REVIEW_STOPS = [
  // Name, what the reviewed reading already holds beyond STOCK, what moves after it, the predicates, and whether PostgreSQL's own run consumes the witness.
  // Codex's probe: the same declaration, function name and owner, with only the body replaced.
  ["function-body-replaced", "", `create or replace function storage.enforce_bucket_name_length() returns trigger language plpgsql as $f$ begin ${NEXTVAL_BODY} raise exception 'refused'; end $f$;`, ["buckets-reviewed"], true],
  ["function-security-definer", "", "alter function storage.enforce_bucket_name_length() security definer;", ["buckets-reviewed"], false],
  ["function-config", "", "alter function storage.enforce_bucket_name_length() set search_path = storage;", ["buckets-reviewed"], false],
  ["function-volatility", "", "alter function storage.enforce_bucket_name_length() stable;", ["buckets-reviewed"], false],
  ["function-owner", "", "alter function storage.enforce_bucket_name_length() owner to postgres;", ["buckets-reviewed"], false],
  ["trigger-added", "", `create function storage.added() returns trigger language plpgsql as $f$ begin ${NEXTVAL_BODY} return new; end $f$; create trigger added before insert on storage.buckets for each row execute function storage.added();`, ["buckets-reviewed"], true],
  ["trigger-removed", "", "drop trigger protect_bucket_control_update on storage.buckets;", ["buckets-reviewed"], false],
  ["trigger-disabled", "", "alter table storage.buckets disable trigger protect_bucket_control_insert;", ["buckets-reviewed"], false],
  ["trigger-definition-changed", "", "drop trigger enforce_bucket_name_length_trigger on storage.buckets; create trigger enforce_bucket_name_length_trigger before insert on storage.buckets for each row execute function storage.enforce_bucket_name_length();", ["buckets-reviewed"], false],
  ["when-function-replaced", WHEN_FN, `create or replace function storage.when_fn(text) returns boolean language plpgsql as $f$ begin ${NEXTVAL_BODY} return true; end $f$;`, ["buckets-reviewed"], true],
  ["check-added", "", "alter table storage.buckets add constraint extra check (length(name) > 0);", ["buckets-reviewed"], false],
  ["check-changed", "", "alter table storage.buckets drop constraint buckets_name_length, add constraint buckets_name_length check (length(name) <= 99);", ["buckets-reviewed"], false],
  ["check-removed", "", "alter table storage.buckets drop constraint buckets_id_length;", ["buckets-reviewed"], false],
  ["check-function-replaced", CHECK_FN, `create or replace function storage.check_fn(text) returns boolean language plpgsql as $f$ begin ${NEXTVAL_BODY} return true; end $f$;`, ["buckets-reviewed"], true],
  ["users-check-added", "", "alter table auth.users add constraint extra check (length(aud) > 0);", ["authusers-reviewed"], false],
  ["users-check-changed", "", "alter table auth.users drop constraint users_email_length, add constraint users_email_length check (email is null or length(email) <= 254);", ["authusers-reviewed"], false],
  ["users-check-removed", "", "alter table auth.users drop constraint users_email_length;", ["authusers-reviewed"], false],
  ["users-check-function-replaced", USERS_CHECK_FN, `create or replace function auth.check_fn(text) returns boolean language plpgsql as $f$ begin ${NEXTVAL_BODY} return true; end $f$;`, ["authusers-reviewed"], true],
  ["users-trigger-added", "", `create function auth.added() returns trigger language plpgsql as $f$ begin ${NEXTVAL_BODY} return new; end $f$; create trigger added before insert on auth.users for each row execute function auth.added();`, ["authusers-reviewed", "authusers-triggers"], true],
];
for (const [name, before, after, want, consumes] of REVIEW_STOPS) {
  const db = await fresh();
  await db.exec(STOCK);
  if (before) await db.exec(before);
  const atReview = await reading(db);
  const reviewed = C.reviewedSetOf(atReview.build00);
  const bound = C.build01Facts({ ...atReview, ref: REF, finalFrom: refState, reviewed, bodyReview: disposed(atReview) });
  if (!bound.facts) throw new Error(`${name}: the reviewed reading does not bind: ${JSON.stringify(C.blocking(bound.findings))}`);
  await db.exec(after);
  const rd = await reading(db);
  const creator = rd.build00w.find((r) => r.part === "role" && r.key === "name").value;
  const ledger = rd.build00.find((r) => r.part === "ledger" && r.key === "status").value;
  const js = C.buildPredicateFindings(rd.build00, rd.build00w, { creator, ledger, reviewed }).map((f) => f.key).sort();
  // As B1 would run it: the facts bound at review, so the part's digest refuses too.
  const asBound = await runText(db, A.build01Text(src, MANIFEST, bound.facts));
  // The predicate alone: the digests are the current reading's, and only the reviewed set is old.
  const text = A.build01Text(src, MANIFEST, facts0(rd, reviewed));
  const r = await runText(db, text);
  const sql = (/does not hold: (.*)$/.exec(String(r.message)) || [, ""])[1].split(", ").filter(Boolean).sort();
  const left = await noneLeft(db);
  const refused = await witness(db);
  const real = await runText(db, withoutFirstStep(text));
  const consumed = await witness(db);
  save(`w-reviewed-stop-${name}.json`, { reviewed, ...rd, js, sql, asBound: { code: asBound.code ?? null, message: asBound.message ?? null, where: asBound.where ?? null }, code: r.code ?? null, where: r.where ?? null, left, witnessAfterRefusal: refused, real: real.ok ? { committed: true } : { committed: false, code: real.code, message: real.message }, witnessWithoutTheStep: consumed });
  const digest = want.some((p) => p.startsWith("buckets")) ? "digest build00.buckets" : "digest build00.authusers";
  say(same(js, want) && same(sql, want) && !r.ok && String(asBound.message).includes(digest) && want.every((p) => String(asBound.message).includes(p)) && left.ledger_absent && left.marker_absent && left.files_absent && refused === false && consumed === consumes, `run W: ${name}: the comparator and BUILD-01's first step name ${js.join(", ")} | ${sql.join(", ")}; the witness is unconsumed after the refusal; without that step: ${real.ok ? "it commits" : `${real.code} ${String(real.message).slice(0, 60)}`}, witness consumed ${consumed}`);
}
for (const [name, extra] of [["stock-set", ""], ["stock-set-with-functions", `${WHEN_FN} ${CHECK_FN} ${USERS_CHECK_FN}`]]) {
  const db = await fresh();
  await db.exec(STOCK);
  if (extra) await db.exec(extra);
  const rd = await reading(db);
  const reviewed = C.reviewedSetOf(rd.build00);
  const { facts, findings } = C.build01Facts({ ...rd, ref: REF, finalFrom: refState, reviewed, bodyReview: disposed(rd) });
  const stops = C.blocking(findings);
  const text = facts ? A.build01Text(src, MANIFEST, facts) : "";
  const r = facts ? await runText(db, text) : { ok: false, message: "no facts" };
  const state = r.ok ? await read(db, "P0-4C") : [];
  const fp = (rows) => rows.find((x) => x.part === 2 && x.key === "fingerprint")?.value;
  save(`w-reviewed-commit-${name}.json`, { reviewed, ...rd, stops, facts, md5: facts ? A.md5(text) : null, committed: r.ok, success: CL.SUCCESS["BUILD-01"].check(JSON.stringify(r.rows ?? [])).ok, fingerprintEqual: fp(state) === fp(refState), witness: await witness(db) });
  say(!stops.length && r.ok && fp(state) === fp(refState) && (await witness(db)) === false, `run W: ${name}: the reviewed set binds, ${Object.keys(reviewed.buckets).length} rows on buckets and ${Object.keys(reviewed.authusers).length} on auth.users; BUILD-01 commits, and the catalog's fingerprint is the local 01's${r.ok ? "" : `: ${r.code} ${r.message}`}`);
}
{
  // Codex's probe of 1a7aff1, as it ran there: a fresh database, a bucket trigger that only
  // raises, both reads bound, then only the function's body replaced. At X3b both reads
  // compared equal after the replacement, and the sequence's value was consumed.
  const db = await fresh();
  await db.exec("create sequence storage.review_witness; create function storage.review_reject() returns trigger language plpgsql as $$ begin raise exception 'refused'; end $$; create trigger review_reject before insert on storage.buckets for each row execute function storage.review_reject();");
  const before = await reading(db);
  const reviewed = C.reviewedSetOf(before.build00);
  const bound = C.build01Facts({ ...before, ref: REF, finalFrom: refState, reviewed, bodyReview: disposed(before) });
  await db.exec("create or replace function storage.review_reject() returns trigger language plpgsql as $$ begin perform nextval('storage.review_witness'); raise exception 'refused'; end $$;");
  const after = await reading(db);
  const js = C.blocking(C.build01Facts({ ...after, ref: REF, finalFrom: refState, reviewed, bodyReview: disposed(before) }).findings).map((f) => f.key);
  const r = await runText(db, A.build01Text(src, MANIFEST, bound.facts));
  const left = await noneLeft(db);
  const refused = await witness(db);
  const real = await runText(db, withoutFirstStep(A.build01Text(src, MANIFEST, bound.facts)));
  const consumed = await witness(db);
  save("w-reviewed-codex-probe.json", { readingsEqual: same(before, after), bound: bound.facts !== null, reviewed, ...after, js, code: r.code ?? null, message: r.message ?? null, where: r.where ?? null, left, witnessAfterRefusal: refused, real: real.ok ? { committed: true } : { committed: false, code: real.code, message: real.message }, witnessWithoutTheStep: consumed });
  say(bound.facts !== null && !same(before, after) && same(js, ["buckets-reviewed", "body-review"]) && !r.ok && String(r.message).includes("buckets-reviewed") && left.ledger_absent && left.files_absent && refused === false && real.message === "refused" && consumed === true, `run W: Codex's probe: the reads now differ; refused before any file: ${String(r.message).slice(30, 120)}; the witness unconsumed, and consumed without that step`);
}
// X3e (Codex's review of 2d53bed, §3): what a stored expression can run. Each shape is built
// on the shim, on each table it applies to, and read. `want` is each predicate that must
// refuse it, in the comparator and in BUILD-01's first step, before any file. `consumes` is
// what PostgreSQL's own run does to the witness with that first step taken out, per table
// where the two differ. A body that calls no sequence leaves it unconsumed, and ON CONFLICT
// refuses a table with an INSERT rule. IMMUTABLE proves nothing here: it is a promise to the
// optimizer, and a body declared IMMUTABLE that calls nextval does consume the sequence.
const TABLES = [
  { part: "buckets", T: "storage.buckets", S: "storage", C: "name", K: "text" },
  { part: "authusers", T: "auth.users", S: "auth", C: "email::text", K: "uuid" },
];
const EXPR_PRELUDE = ({ S }) => `
create sequence if not exists storage.review_witness;
create function ${S}.vol_fn() returns bigint language plpgsql as $f$ begin return nextval('storage.review_witness'); end $f$;
create function ${S}.vol_check(text) returns boolean language plpgsql as $f$ begin perform nextval('storage.review_witness'); return true; end $f$;
create function ${S}.imm_fn(text) returns boolean language plpgsql immutable as $f$ begin return true; end $f$;
create function ${S}.pass_fn() returns trigger language plpgsql as $f$ begin return new; end $f$;
create function ${S}.op_fn(text, text) returns boolean language plpgsql as $f$ begin perform nextval('storage.review_witness'); return true; end $f$;
create operator ${S}.=== (function = ${S}.op_fn, leftarg = text, rightarg = text);
`;
const W = "storage.review_witness";
const ENUM = (S) => `create type ${S}.x_en as enum ('a', 'b');`;
const EXPR_STOPS = [
  // Direct sequence calls, on a column BUILD-01 does not supply.
  ["default-nextval", ({ T }) => `alter table ${T} add column x_c bigint default nextval('${W}');`, ["routes", "sequence-calls"], true],
  ["default-nextval-no-constant-dependency", ({ T }) => `alter table ${T} add column x_c bigint default nextval(('${W}'::text)::regclass);`, ["sequence-calls"], true],
  ["default-nextval-computed-name", ({ T }) => `alter table ${T} add column x_c bigint default nextval(concat('storage.', 'review_witness')::regclass);`, ["sequence-calls"], true],
  ["default-setval", ({ T }) => `alter table ${T} add column x_c bigint default setval('${W}', 5);`, ["routes", "sequence-calls"], true],
  ["default-setval-no-constant-dependency", ({ T }) => `alter table ${T} add column x_c bigint default setval(('${W}'::text)::regclass, 5);`, ["sequence-calls"], true],
  ["identity-column", ({ T }) => `alter table ${T} add column x_c bigint generated by default as identity;`, ["sequence-calls"], false],
  // A function outside pg_catalog, in each newly covered class.
  ["default-function", ({ T, S }) => `alter table ${T} add column x_c bigint default ${S}.vol_fn();`, ["expression-calls", "expression-nodes", "routes"], true],
  ["generated-function", ({ T, S, C }) => `alter table ${T} add column x_c boolean generated always as (${S}.imm_fn(${C})) stored;`, ["expression-calls", "expression-nodes", "routes"], false],
  ["index-expression-function", ({ T, S, C }) => `create index x_i on ${T} (${S}.imm_fn(${C}));`, ["expression-calls", "expression-nodes", "routes"], false],
  ["index-predicate-function", ({ T, S, C }) => `create index x_i on ${T} (id) where ${S}.imm_fn(${C});`, ["expression-calls", "expression-nodes", "routes"], false],
  ["domain-check-function", ({ T, S }) => `create domain ${S}.x_d as text check (${S}.vol_check(value)); alter table ${T} add column x_c ${S}.x_d;`, ["expression-calls", "expression-nodes", "routes"], true],
  ["domain-chain", ({ T, S }) => `create domain ${S}.x_in as text check (${S}.vol_check(value)); create domain ${S}.x_mid as ${S}.x_in; create domain ${S}.x_out as ${S}.x_mid; alter table ${T} add column x_c ${S}.x_out;`, ["expression-calls", "expression-nodes", "routes"], true],
  ["domain-check-nextval", ({ T, S }) => `create domain ${S}.x_d as bigint check (nextval('${W}') > 0); alter table ${T} add column x_c ${S}.x_d;`, ["routes", "sequence-calls"], true],
  ["domain-check-dynamic-nextval", ({ T, S }) => `create domain ${S}.x_d as bigint check (nextval(('${W}'::text)::regclass) > 0); alter table ${T} add column x_c ${S}.x_d;`, ["sequence-calls"], true],
  ["domain-default-nextval", ({ T, S }) => `create domain ${S}.x_d as bigint default nextval('${W}'); alter table ${T} add column x_c ${S}.x_d;`, ["routes", "sequence-calls"], true],
  ["array-of-domain", ({ T, S }) => `create domain ${S}.x_d as text check (${S}.imm_fn(value)); alter table ${T} add column x_c ${S}.x_d[];`, ["expression-calls", "expression-nodes", "routes"], false],
  // An operator: its oprcode is what runs, and no dependency names a pinned one.
  ["default-custom-operator", ({ T, S }) => `alter table ${T} add column x_c boolean default ('a'::text OPERATOR(${S}.===) 'b'::text);`, ["expression-nodes", "routes"], true],
  ["default-operator-over-unlisted-builtin", ({ T, S }) => `create operator ${S}.@+@ (function = pg_catalog.textcat, leftarg = text, rightarg = text); alter table ${T} add column x_c text default ('a'::text OPERATOR(${S}.@+@) 'b'::text);`, ["expression-nodes", "routes"], false],
  // A custom cast prints as ::integer, so only the walk can see the function behind it.
  ["default-custom-cast", ({ T, S }) => `create function ${S}.x_cast(uuid) returns integer language plpgsql immutable as $f$ begin return 1; end $f$; create cast (uuid as integer) with function ${S}.x_cast(uuid); alter table ${T} add column x_c integer default ('00000000-0000-0000-0000-000000000000'::uuid)::integer;`, ["expression-nodes", "routes"], false],
  ["operator-implemented-by-nextval", ({ T, S }) => `create operator ${S}.@@@ (function = pg_catalog.nextval, rightarg = regclass); alter table ${T} add column x_c bigint default (OPERATOR(${S}.@@@) '${W}'::regclass);`, ["expression-nodes", "routes", "sequence-calls"], true],
  ["operator-implemented-by-nextval-computed", ({ T, S }) => `create operator ${S}.@@@ (function = pg_catalog.nextval, rightarg = regclass); alter table ${T} add column x_c bigint default (OPERATOR(${S}.@@@) ('${W}'::text)::regclass);`, ["expression-nodes", "routes", "sequence-calls"], true],
  ["check-custom-operator-over-nextval", ({ T, S, C }) => `create operator ${S}.@@@ (function = pg_catalog.nextval, rightarg = regclass); alter table ${T} add constraint x_k check ((OPERATOR(${S}.@@@) ('${W}'::text)::regclass) > 0 or ${C} is null);`, ["sequence-calls"], true],
  // The existing coverage: a sequence call has no dependency to follow, and a type on the path is strict.
  ["check-nextval", ({ T }) => `alter table ${T} add constraint x_k check (nextval('${W}') > 0);`, ["routes", "sequence-calls"], true],
  ["check-dynamic-nextval", ({ T }) => `alter table ${T} add constraint x_k check (nextval(('${W}'::text)::regclass) > 0);`, ["sequence-calls"], true],
  ["check-through-domain", ({ T, S, C }) => `create domain ${S}.x_d as text check (${S}.vol_check(value)); alter table ${T} add constraint x_k check (((${C})::${S}.x_d) is not null);`, ["expression-calls", "expression-nodes", "routes"], true],
  ["trigger-when-nextval", ({ T, S }) => `create trigger x_t before insert on ${T} for each row when (nextval('${W}') > 0) execute function ${S}.pass_fn();`, ["routes", "sequence-calls"], true, { authusers: ["authusers-triggers"] }],
  ["trigger-when-dynamic-nextval", ({ T, S }) => `create trigger x_t before insert on ${T} for each row when (nextval(('${W}'::text)::regclass) > 0) execute function ${S}.pass_fn();`, ["sequence-calls"], true, { authusers: ["authusers-triggers"] }],
  // Rewrite rules, and the table's own shape.
  ["rule-on-insert", ({ T }) => `create rule x_r as on insert to ${T} do also select nextval('${W}');`, ["rules"], { buckets: false, authusers: true }],
  ["rule-on-update", ({ T }) => `create rule x_r as on update to ${T} do also select nextval('${W}');`, ["rules"], { buckets: false, authusers: false }],
  ["inherited-by-a-child", ({ T, S }) => `create table ${S}.x_child () inherits (${T});`, ["relation"], false],
  // Types and other routes nothing here handles.
  ["composite-type", ({ T, S }) => `create type ${S}.x_t as (a int); alter table ${T} add column x_c ${S}.x_t;`, ["routes"], false],
  ["range-type", ({ T, S }) => `create type ${S}.x_t as range (subtype = int4); alter table ${T} add column x_c ${S}.x_t;`, ["routes"], false],
  ["custom-base-type", ({ T, S }) => `create type ${S}.x_t; create function ${S}.x_t_in(cstring) returns ${S}.x_t language internal immutable as 'int4in'; create function ${S}.x_t_out(${S}.x_t) returns cstring language internal immutable as 'int4out'; create type ${S}.x_t (input = ${S}.x_t_in, output = ${S}.x_t_out, like = int4); alter table ${T} add column x_c ${S}.x_t;`, ["routes"], false],
  ["custom-collation", ({ T, S }) => `create collation ${S}.x_coll from "C"; alter table ${T} add column x_c text collate ${S}.x_coll;`, ["routes"], false],
  ["custom-operator-class", ({ T, S, C }) => `create operator class ${S}.x_ops for type text using btree as operator 1 <, operator 2 <=, operator 3 =, operator 4 >=, operator 5 >, function 1 bttextcmp(text, text); create index x_i on ${T} ((${C}) ${S}.x_ops);`, ["routes"], false],
  ["exclusion-custom-operator", ({ T, S, C }) => `create function ${S}.ex_fn(text, text) returns boolean language plpgsql immutable as $f$ begin return false; end $f$; create operator ${S}.=%= (function = ${S}.ex_fn, leftarg = text, rightarg = text, commutator = OPERATOR(${S}.=%=)); create operator class ${S}.x_ops for type text using btree as operator 1 <, operator 2 <=, operator 3 ${S}.=%=, operator 4 >=, operator 5 >, function 1 bttextcmp(text, text); alter table ${T} add constraint x_e exclude using btree ((${C}) ${S}.x_ops with OPERATOR(${S}.=%=));`, ["routes"], false],
  // Built-ins that cannot be read as changing nothing: the literal holds what would run.
  ["builtin-running-a-query", ({ T }) => `alter table ${T} add column x_c text default query_to_xml('select nextval(''${W}'')', true, false, '')::text;`, ["expression-calls", "expression-nodes"], true],
  ["generated-immutable-body-calling-nextval", ({ T, S, C }) => `create function ${S}.imm_next(text) returns boolean language plpgsql immutable as $f$ begin perform nextval('${W}'); return true; end $f$; alter table ${T} add column x_c boolean generated always as (${S}.imm_next(${C})) stored;`, ["expression-calls", "expression-nodes", "routes"], true],
  // X3f: what a node runs that its text does not show. MINMAX over the type's default operator class, I/O through the type's functions, and the rest of the node model.
  ["least-enum", ({ T, S }) => `${ENUM(S)} alter table ${T} add column x_c ${S}.x_en default LEAST('b'::${S}.x_en, 'a'::${S}.x_en);`, ["expression-nodes"], false],
  ["greatest-enum", ({ T, S }) => `${ENUM(S)} alter table ${T} add column x_c ${S}.x_en default GREATEST('b'::${S}.x_en, 'a'::${S}.x_en);`, ["expression-nodes"], false],
  ["least-domain", ({ T, S }) => `create domain ${S}.x_d as text; alter table ${T} add column x_c text default LEAST('a'::${S}.x_d, 'b'::${S}.x_d);`, ["expression-nodes"], false],
  ["least-domain-over-enum", ({ T, S }) => `${ENUM(S)} create domain ${S}.x_d as ${S}.x_en; alter table ${T} add column x_c ${S}.x_en default LEAST('a'::${S}.x_d, 'b'::${S}.x_d);`, ["expression-nodes"], false],
  ["least-array-of-enum", ({ T, S }) => `${ENUM(S)} alter table ${T} add column x_c ${S}.x_en[] default LEAST(ARRAY['a'::${S}.x_en], ARRAY['b'::${S}.x_en]);`, ["expression-nodes"], false],
  ["coerceviaio-from-enum", ({ T, S }) => `${ENUM(S)} alter table ${T} add column x_c text default ('a'::${S}.x_en)::text;`, ["expression-nodes"], false],
  ["coerceviaio-to-enum", ({ T, S }) => `${ENUM(S)} alter table ${T} add column x_c ${S}.x_en default ('a'::text)::${S}.x_en;`, ["expression-nodes"], false],
  ["coerceviaio-unreviewed-builtin", ({ T }) => `alter table ${T} add column x_c inet default ('1.1.1.1'::text)::inet;`, ["expression-nodes"], false],
  ["arraycoerce-enum", ({ T, S }) => `${ENUM(S)} alter table ${T} add column x_c text[] default ('{a}'::${S}.x_en[])::text[];`, ["expression-nodes"], false],
  ["generated-least-enum", ({ T, S }) => `${ENUM(S)} alter table ${T} add column x_e ${S}.x_en, add column x_c ${S}.x_en generated always as (LEAST(x_e, x_e)) stored;`, ["expression-nodes"], false],
  ["check-least-enum", ({ T, S }) => `${ENUM(S)} alter table ${T} add column x_e ${S}.x_en, add constraint x_k check ((LEAST(x_e, x_e) is not null) or (x_e is null));`, ["expression-nodes"], false],
  ["index-expression-least-enum", ({ T, S }) => `${ENUM(S)} alter table ${T} add column x_e ${S}.x_en; create index x_i on ${T} (LEAST(x_e, x_e));`, ["expression-nodes"], false],
  ["index-predicate-least-enum", ({ T, S }) => `${ENUM(S)} alter table ${T} add column x_e ${S}.x_en; create index x_i on ${T} (id) where (LEAST(x_e, x_e) is not null);`, ["expression-nodes"], false],
  ["trigger-when-least-enum", ({ T, S }) => `${ENUM(S)} alter table ${T} add column x_e ${S}.x_en; create trigger x_t before insert on ${T} for each row when (LEAST(new.x_e, new.x_e) is null) execute function ${S}.pass_fn();`, ["expression-nodes"], false, { authusers: ["authusers-triggers"] }],
  ["domain-check-least-enum", ({ T, S }) => `${ENUM(S)} create domain ${S}.x_d as ${S}.x_en check ((LEAST(value, value) is not null) or (value is null)); alter table ${T} add column x_c ${S}.x_d;`, ["expression-nodes"], false],
  ["domain-default-least-enum", ({ T, S }) => `${ENUM(S)} create domain ${S}.x_d as ${S}.x_en default LEAST('a'::${S}.x_en, 'b'::${S}.x_en); alter table ${T} add column x_c ${S}.x_d;`, ["expression-nodes"], false],
  // X3g: the enum exception is the built-in equality and inequality under an OPEXPR, and nothing else.
  ["enum-ordering-in-check", ({ T, S }) => `${ENUM(S)} alter table ${T} add column x_e ${S}.x_en, add constraint x_k check (x_e < 'b');`, ["expression-nodes"], false],
  ["enum-equality-and-least-in-check", ({ T, S }) => `${ENUM(S)} alter table ${T} add column x_e ${S}.x_en, add constraint x_k check ((x_e = 'a') and (LEAST(x_e, x_e) = 'a'));`, ["expression-nodes"], false],
  ["enum-equality-and-coerceviaio-in-check", ({ T, S }) => `${ENUM(S)} alter table ${T} add column x_e ${S}.x_en, add constraint x_k check ((x_e = 'a') and ((x_e)::text = 'a'));`, ["expression-nodes"], false],
  ["enum-equality-and-ordering-in-check", ({ T, S }) => `${ENUM(S)} alter table ${T} add column x_e ${S}.x_en, add constraint x_k check ((x_e = 'a') or (x_e < 'b'));`, ["expression-nodes"], false],
  ["enum-distinct-in-check", ({ T, S }) => `${ENUM(S)} alter table ${T} add column x_e ${S}.x_en, add constraint x_k check (x_e is distinct from 'b');`, ["expression-nodes"], false],
  ["enum-nullif-default", ({ T, S }) => `${ENUM(S)} alter table ${T} add column x_c ${S}.x_en default NULLIF('a'::${S}.x_en, 'b'::${S}.x_en);`, ["expression-nodes"], false],
  ["enum-any-in-check", ({ T, S }) => `${ENUM(S)} alter table ${T} add column x_e ${S}.x_en, add constraint x_k check (x_e = ANY (ARRAY['a'::${S}.x_en, 'b'::${S}.x_en]));`, ["expression-nodes"], false],
  // The built-in's own signature in another schema: CREATE OPERATOR finds enum_eq only over anyenum.
  ["enum-lookalike-operator-default", ({ T, S }) => `${ENUM(S)} create operator ${S}.= (function = pg_catalog.enum_eq, leftarg = anyenum, rightarg = anyenum); alter table ${T} add column x_c boolean default ('a'::${S}.x_en OPERATOR(${S}.=) 'a'::${S}.x_en);`, ["expression-nodes", "routes"], false],
  ["enum-lookalike-operator-in-check", ({ T, S }) => `${ENUM(S)} create operator ${S}.= (function = pg_catalog.enum_eq, leftarg = anyenum, rightarg = anyenum); alter table ${T} add column x_e ${S}.x_en, add constraint x_k check (x_e OPERATOR(${S}.=) 'a'::${S}.x_en);`, ["expression-nodes"], false],
  ["enum-lookalike-function", ({ T, S }) => `${ENUM(S)} create function ${S}.enum_eq(${S}.x_en, ${S}.x_en) returns boolean language sql immutable as 'select $1::text = $2::text'; create operator ${S}.= (function = ${S}.enum_eq, leftarg = ${S}.x_en, rightarg = ${S}.x_en); alter table ${T} add column x_c boolean default ('a'::${S}.x_en OPERATOR(${S}.=) 'a'::${S}.x_en);`, ["expression-nodes", "routes"], false],
  // X3g (Codex XF-R1): a built-in operator off the reviewed list. @@ reads default_text_search_config.
  ["text-search-operator", ({ T }) => `alter table ${T} add column x_c boolean default ('cats'::text @@ 'cat'::text);`, ["expression-nodes"], false],
  ["pseudo-type-function-over-enum", ({ T, S }) => `${ENUM(S)} alter table ${T} add column x_c text default concat('a'::${S}.x_en);`, ["expression-nodes"], false],
  ["unlisted-cast-function", ({ T }) => `alter table ${T} add column x_c money default (1)::money;`, ["expression-nodes"], false],
  ["row-comparison", ({ T }) => `alter table ${T} add column x_c boolean default (ROW('a'::text, 'b'::text) < ROW('c'::text, 'd'::text));`, ["expression-nodes"], false],
  ["subscripting", ({ T }) => `alter table ${T} add column x_c text default (ARRAY['a'::text, 'b'::text])[1];`, ["expression-nodes"], false],
  // X3f: foreign keys, from each key's own rows. The referencing and referenced sides are read, not inferred from this table's columns.
  ["fk-out-custom-type", ({ T, S }) => `${ENUM(S)} create table ${S}.x_ref (k ${S}.x_en primary key); alter table ${T} add column x_f ${S}.x_en references ${S}.x_ref (k);`, ["foreign-keys"], false],
  ["fk-in-domain", ({ T, S, K }) => `create domain ${S}.x_d as ${K}; create table ${S}.x_kid (b ${S}.x_d references ${T} (id));`, ["foreign-keys"], false],
  ["fk-out-custom-opclass", ({ T, S }) => `create function ${S}.ex_fn(text, text) returns boolean language plpgsql immutable as $f$ begin return $1 = $2; end $f$; create operator ${S}.=%= (function = ${S}.ex_fn, leftarg = text, rightarg = text, commutator = OPERATOR(${S}.=%=)); create operator class ${S}.x_ops for type text using btree as operator 1 <, operator 2 <=, operator 3 ${S}.=%=, operator 4 >=, operator 5 >, function 1 bttextcmp(text, text); create table ${S}.x_ref (k text); create unique index x_ref_k on ${S}.x_ref (k ${S}.x_ops); alter table ${T} add column x_f text references ${S}.x_ref (k);`, ["foreign-keys"], false],
  ["builtin-with-a-side-effect", ({ T }) => `alter table ${T} add column x_c text default set_config('x.y', '1', true);`, ["expression-calls", "expression-nodes"], false],
];
const facts0Reviewed = (rd) => facts0(rd, own(rd));
// A stored difference from the shim's fresh reading, so each case's fixture holds only what its shape added.
const EXPR_BASE = await (async () => { const db = await fresh(); await db.exec(EXPR_PRELUDE(TABLES[0]) + EXPR_PRELUDE(TABLES[1])); return reading(db); })();
save("w-expr-base.json", EXPR_BASE);
const deltaOf = (base, rows) => {
  const k = (r) => JSON.stringify([r.part, r.key]);
  const have = new Map(base.map((r) => [k(r), r.value])), now = new Set(rows.map(k));
  return { set: rows.filter((r) => have.get(k(r)) !== r.value), drop: base.filter((r) => !now.has(k(r))).map((r) => [r.part, r.key]) };
};
const namesOf = (r) => (/does not hold: (.*)$/.exec(String(r.message)) || [, ""])[1].split(", ").filter(Boolean).sort();
for (const [name, sql, wantShort, consumesAny, extra] of EXPR_STOPS) {
  for (const t of TABLES) {
    const db = await fresh();
    await db.exec(EXPR_PRELUDE(TABLES[0]) + EXPR_PRELUDE(TABLES[1]));
    await db.exec(sql(t));
    const rd = await reading(db);
    const creator = rd.build00w.find((r) => r.part === "role" && r.key === "name").value;
    const ledger = rd.build00.find((r) => r.part === "ledger" && r.key === "status").value;
    const js = C.buildPredicateFindings(rd.build00, rd.build00w, { creator, ledger, reviewed: own(rd) }).map((f) => f.key).sort();
    const noFacts = C.build01Facts({ ...rd, ref: REF, finalFrom: refState, reviewed: own(rd), bodyReview: disposed(rd) }).facts === null;
    const text = A.build01Text(src, MANIFEST, facts0Reviewed(rd));
    const r = await runText(db, text);
    const sqlNames = namesOf(r);
    const left = await noneLeft(db);
    const refused = await witness(db);
    const real = await runText(db, withoutFirstStep(text));
    const consumed = await witness(db);
    const consumes = typeof consumesAny === "object" ? consumesAny[t.part] : consumesAny;
    const want = [...wantShort.map((n) => `${t.part}-${n}`), ...((extra && extra[t.part]) || [])].sort();
    save(`w-expr-stop-${t.part}-${name}.json`, { part: t.part, want, b00: deltaOf(EXPR_BASE.build00, rd.build00), b00w: deltaOf(EXPR_BASE.build00w, rd.build00w), js, sql: sqlNames, noFacts, code: r.code ?? null, where: r.where ?? null, left, witnessAfterRefusal: refused, real: real.ok ? { committed: true } : { committed: false, code: real.code, message: String(real.message).slice(0, 200) }, consumed });
    say(same(js, want) && same(sqlNames, want) && noFacts && !r.ok && left.ledger_absent && left.marker_absent && left.files_absent && refused === false && consumed === consumes, `run W: ${t.part} ${name}: both refuse ${want.join(", ")} before any file (js ${js.join(", ")} | sql ${sqlNames.join(", ")}), witness unconsumed; PostgreSQL's own run ${consumed ? "consumes" : "does not consume"} it (wanted ${consumes}): ${real.ok ? "commits" : `${real.code} ${String(real.message).slice(0, 60)}`}`);
  }
}
// Addition and replacement after the review, from shapes the rules accept.
const REVIEWED_OPERATOR = ({ T, S, C }) => `create function ${S}.safe_op(text, text) returns boolean language plpgsql as $f$ begin return true; end $f$; create operator ${S}.=#= (function = ${S}.safe_op, leftarg = text, rightarg = text); alter table ${T} add constraint x_op check ((${C}) OPERATOR(${S}.=#=) 'x'::text);`;
const REVIEWED_HELPER = ({ T, S, C }) => `create function ${S}.helper(text) returns boolean language plpgsql as $f$ begin return true; end $f$; create function ${S}.checks(a text) returns boolean language sql begin atomic select ${S}.helper(a); end; alter table ${T} add constraint x_sb check (${S}.checks(${C}));`;
const EXPR_AFTER_REVIEW = [
  ["default-added", () => "", ({ T }) => `alter table ${T} add column x_c bigint default nextval('${W}');`, ["reviewed", "routes", "sequence-calls"], true],
  ["default-replaced", ({ T }) => `alter table ${T} add column x_c bigint default 1;`, ({ T }) => `alter table ${T} alter column x_c set default nextval(('${W}'::text)::regclass);`, ["reviewed", "sequence-calls"], true],
  ["generated-added", () => "", ({ T, S, C }) => `alter table ${T} add column x_c boolean generated always as (${S}.imm_fn(${C})) stored;`, ["expression-calls", "expression-nodes", "reviewed", "routes"], false],
  ["index-expression-added", () => "", ({ T, S, C }) => `create index x_i on ${T} (${S}.imm_fn(${C}));`, ["expression-calls", "expression-nodes", "reviewed", "routes"], false],
  ["index-predicate-replaced", ({ T }) => `create index x_i on ${T} (id) where id is not null;`, ({ T, S, C }) => `drop index ${T.split(".")[0]}.x_i; create index x_i on ${T} (id) where ${S}.imm_fn(${C});`, ["expression-calls", "expression-nodes", "reviewed", "routes"], false],
  ["domain-check-added", ({ T, S }) => `create domain ${S}.x_d as text; alter table ${T} add column x_c ${S}.x_d;`, ({ S }) => `alter domain ${S}.x_d add constraint x_dk check (${S}.vol_check(value));`, ["expression-calls", "expression-nodes", "reviewed", "routes"], true],
  ["domain-default-added", ({ T, S }) => `create domain ${S}.x_d as bigint; alter table ${T} add column x_c ${S}.x_d;`, ({ S }) => `alter domain ${S}.x_d set default nextval('${W}');`, ["reviewed", "routes", "sequence-calls"], true],
  ["rule-added", () => "", ({ T }) => `create rule x_r as on insert to ${T} do also select nextval('${W}');`, ["reviewed", "rules"], { buckets: false, authusers: true }],
  ["delete-rule-changed", ({ T }) => `create rule x_r as on delete to ${T} do also select 1;`, ({ T }) => `create or replace rule x_r as on delete to ${T} do also select 2;`, ["reviewed"], false],
  ["check-operator-function-replaced", REVIEWED_OPERATOR, ({ S }) => `create or replace function ${S}.safe_op(text, text) returns boolean language plpgsql as $f$ begin perform nextval('${W}'); return true; end $f$;`, ["reviewed"], true],
  ["check-operator-swapped", REVIEWED_OPERATOR, ({ T, S, C }) => `alter table ${T} drop constraint x_op; alter table ${T} add constraint x_op check ((${C}) OPERATOR(${S}.===) 'x'::text);`, ["reviewed"], true],
  ["check-custom-cast-function-replaced", ({ T, S }) => `create function ${S}.x_cast(uuid) returns integer language plpgsql immutable as $f$ begin return 1; end $f$; create cast (uuid as integer) with function ${S}.x_cast(uuid); alter table ${T} add column x_u uuid, add constraint x_kc check (((x_u)::integer > 0) or (x_u is null));`, ({ S }) => `create or replace function ${S}.x_cast(uuid) returns integer language plpgsql immutable as $f$ begin return 2; end $f$;`, ["reviewed"], false],
  ["fk-added", () => "", ({ T, S }) => `create table ${S}.x_ref (k text primary key); alter table ${T} add column x_f text references ${S}.x_ref (k);`, ["reviewed"], false],
  ["fk-referencing-table-added", () => "", ({ T, S, K }) => `create table ${S}.x_kid (b ${K} references ${T} (id));`, ["reviewed"], false],
  ["fk-removed", ({ T, S, K }) => `create table ${S}.x_kid (b ${K} constraint x_kid_fk references ${T} (id));`, ({ S }) => `alter table ${S}.x_kid drop constraint x_kid_fk;`, ["reviewed"], false],
  ["policy-added", () => "", ({ T }) => `create policy x_p on ${T} for select using (true);`, ["reviewed"], false],
  ["helper-in-a-parsed-body-replaced", REVIEWED_HELPER, ({ S }) => `create or replace function ${S}.helper(text) returns boolean language plpgsql as $f$ begin perform nextval('${W}'); return true; end $f$;`, ["reviewed"], true],
];
for (const [name, before, after, wantShort, consumesAny] of EXPR_AFTER_REVIEW) {
  for (const t of TABLES) {
    const db = await fresh();
    await db.exec(EXPR_PRELUDE(TABLES[0]) + EXPR_PRELUDE(TABLES[1]));
    if (before(t)) await db.exec(before(t));
    const atReview = await reading(db);
    const reviewed = own(atReview);
    const bound = C.build01Facts({ ...atReview, ref: REF, finalFrom: refState, reviewed, bodyReview: disposed(atReview) });
    if (!bound.facts) throw new Error(`${name}: the reviewed reading does not bind: ${JSON.stringify(C.blocking(bound.findings))}`);
    await db.exec(after(t));
    const rd = await reading(db);
    const creator = rd.build00w.find((r) => r.part === "role" && r.key === "name").value;
    const ledger = rd.build00.find((r) => r.part === "ledger" && r.key === "status").value;
    const js = C.buildPredicateFindings(rd.build00, rd.build00w, { creator, ledger, reviewed }).map((f) => f.key).sort();
    const asBound = await runText(db, A.build01Text(src, MANIFEST, bound.facts));
    const text = A.build01Text(src, MANIFEST, facts0(rd, reviewed));
    const r = await runText(db, text);
    const sqlNames = namesOf(r);
    const left = await noneLeft(db);
    const refused = await witness(db);
    const real = await runText(db, withoutFirstStep(text));
    const consumed = await witness(db);
    const consumes = typeof consumesAny === "object" ? consumesAny[t.part] : consumesAny;
    const want = wantShort.map((n) => `${t.part}-${n}`).sort();
    const digest = `digest build00.${t.part}`;
    save(`w-expr-after-${t.part}-${name}.json`, { part: t.part, want, reviewed, b00: deltaOf(EXPR_BASE.build00, rd.build00), b00w: deltaOf(EXPR_BASE.build00w, rd.build00w), js, sql: sqlNames, asBound: { code: asBound.code ?? null, message: asBound.message ?? null }, code: r.code ?? null, left, witnessAfterRefusal: refused, real: real.ok ? { committed: true } : { committed: false, code: real.code, message: String(real.message).slice(0, 200) }, consumed });
    say(same(js, want) && same(sqlNames, want) && String(asBound.message).includes(digest) && want.every((p) => String(asBound.message).includes(p)) && left.ledger_absent && left.files_absent && refused === false && consumed === consumes, `run W: after review, ${t.part} ${name}: both refuse ${want.join(", ")}, as bound the digest too (js ${js.join(", ")} | sql ${sqlNames.join(", ")}), witness unconsumed, PostgreSQL's own run ${consumed ? "consumes" : "does not consume"} it (wanted ${consumes})`);
  }
}
// Ordinary built-in forms the rules keep, including a literal that names a function it does not call.
const BUILTIN_CONTROLS = ({ T, S, C }) => `
create type ${S}.x_enum as enum ('A', 'B');
create domain ${S}.x_short as text check (length(value) < 1000);
create domain ${S}.x_shorter as ${S}.x_short default 'x' check (char_length(value) < 500);
alter table ${T}
  add column x_now timestamptz default now(),
  add column x_uuid uuid default gen_random_uuid(),
  add column x_lower text default lower('ABC'),
  add column x_literal text default 'nextval(''x'') setval(y) query_to_xml(z) it''s',
  add column x_varchar varchar(10) default ''::character varying,
  add column x_numeric numeric(10,2) default 0.5::numeric(10,2),
  add column "x (quoted)" text default 'a',
  add column x_enum ${S}.x_enum default 'A',
  add column x_enums ${S}.x_enum[],
  add column x_domain ${S}.x_shorter,
  add column x_stamp1 timestamptz,
  add column x_stamp2 timestamptz,
  add column x_small smallint default 1::smallint,
  add column x_varchar5 varchar(5) default 'abcdef'::varchar(5),
  add column x_greatest timestamptz default GREATEST(now(), now()),
  add column x_case text default (CASE WHEN 1 = 1 THEN 'x' ELSE 'y' END),
  add column x_nullif text default NULLIF('a'::text, 'b'::text),
  add column x_any boolean default ('a'::text = ANY (ARRAY['a'::text, 'b'::text])),
  add column x_current timestamptz default CURRENT_TIMESTAMP,
  add column x_io date default ('2020-01-01'::text)::date,
  add column x_arrays text[] default ('{a}'::varchar[])::text[],
  add column x_j jsonb,
  add column x_least timestamptz generated always as (LEAST(x_stamp1, x_stamp2)) stored,
  add column x_coalesce text generated always as (COALESCE(x_literal, 'nextval(q)')) stored,
  add constraint x_status check ((x_numeric >= (0)::numeric) and (x_numeric <= (2)::numeric)),
  add constraint x_form check (x_literal <> 'setval(z)'),
  add constraint x_json check ((jsonb_typeof(x_j) = 'object') and (jsonb_array_length(x_j) >= 0));
create index x_lower_i on ${T} (lower(${C}));
create index x_partial_i on ${T} (id) where (${C}) !~ '^[0-9 ]*$'::text;
create rule x_delete_r as on delete to ${T} do also select 1;
alter table ${T} add constraint x_ex exclude using btree (id with =);
`;
for (const [name, setup] of [
  ["builtins", (t) => BUILTIN_CONTROLS(t)],
  ["trigger-when-builtin", () => "create function storage.pass2() returns trigger language plpgsql as $f$ begin return new; end $f$; create trigger x_when before update on storage.buckets for each row when (old.name is distinct from new.name) execute function storage.pass2();"],
  ["reviewed-operator-in-check", REVIEWED_OPERATOR],
  ["reviewed-helper-in-a-parsed-body", REVIEWED_HELPER],
  // Foreign keys on both sides, over reviewed built-in types and operators.
  ["fk-builtin", ({ T, S, K }) => `create table ${S}.x_ref (k text primary key); alter table ${T} add column x_f text references ${S}.x_ref (k); create table ${S}.x_kid (b ${K} references ${T} (id));`],
  // A policy with RLS off, and one with RLS on for an owner it does not apply to: the count is evidence.
  ["policy-rls-off", ({ T }) => `create policy x_p on ${T} for select using (true);`],
  ["policy-rls-on-superuser", ({ T }) => `alter table ${T} enable row level security; create policy x_p on ${T} for select using (true);`],
  // X3g: the stock form of an enum column, its Const default (Codex's control) and CHECKs of equality and
  // inequality against that literal, which compare the values' OIDs.
  ["enum-stock-form", ({ T, S }) => `create type ${S}.buckettype as enum ('STANDARD', 'ANALYTICS'); alter table ${T} add column x_type ${S}.buckettype not null default 'STANDARD'::${S}.buckettype, add constraint x_type_is check (x_type = 'STANDARD'::${S}.buckettype), add constraint x_type_not check (x_type <> 'ANALYTICS'::${S}.buckettype);`],
  // X3g: the stock smallint CHECK and boolean partial index, over listed operators.
  ["stock-forms", ({ T, C }) => `alter table ${T} add column x_status smallint default 0, add column x_sso boolean not null default false, add constraint x_status_check check ((x_status >= 0) and (x_status <= 2)); create unique index x_sso_u on ${T} ((${C})) where (x_sso = false);`],
]) {
  for (const t of TABLES) {
    if (name === "trigger-when-builtin" && t.part !== "buckets") continue;
    const db = await fresh();
    await db.exec(EXPR_PRELUDE(TABLES[0]) + EXPR_PRELUDE(TABLES[1]));
    await db.exec(setup(t));
    const rd = await reading(db);
    const reviewed = own(rd);
    const { facts, findings } = C.build01Facts({ ...rd, ref: REF, finalFrom: refState, reviewed, bodyReview: disposed(rd) });
    const stops = C.blocking(findings);
    const text = facts ? A.build01Text(src, MANIFEST, facts) : "";
    const r = facts ? await runText(db, text) : { ok: false, message: "no facts" };
    const state = r.ok ? await read(db, "P0-4C") : [];
    const fp = (rows) => rows.find((x) => x.part === 2 && x.key === "fingerprint")?.value;
    const consumed = await witness(db);
    save(`w-expr-commit-${t.part}-${name}.json`, { part: t.part, reviewed, b00: deltaOf(EXPR_BASE.build00, rd.build00), b00w: deltaOf(EXPR_BASE.build00w, rd.build00w), stops, committed: r.ok, success: CL.SUCCESS["BUILD-01"].check(JSON.stringify(r.rows ?? [])).ok, fingerprintEqual: fp(state) === fp(refState), consumed });
    say(!stops.length && r.ok && fp(state) === fp(refState) && consumed === false, `run W: control ${t.part} ${name}: the rules keep it, BUILD-01 commits, the witness is unconsumed${stops.length ? `: ${JSON.stringify(stops)}` : ""}${r.ok ? "" : `: ${r.code} ${String(r.message).slice(0, 120)}`}`);
  }
}
{
  // Codex's probe of c940f0f, the same sequence: a custom enum, its own default B-tree class and
  // comparator, an unsupplied bucket column with a MINMAX default, and only the comparator's body
  // replaced after the review. The readings do not move, since nothing reports the comparator, so
  // a digest cannot catch it: the shape itself must stop. At X3e both reads bound, BUILD-01
  // committed, and the sequence was consumed.
  for (const [form, fn] of [["least", "LEAST"], ["greatest", "GREATEST"]]) {
    const db = await fresh();
    await db.exec(`create sequence storage.review_witness;
create type storage.review_enum as enum ('a','b');
create function storage.review_cmp(storage.review_enum,storage.review_enum) returns integer language plpgsql immutable as $f$ begin
 return case when $1::text < $2::text then -1 when $1::text > $2::text then 1 else 0 end;
end $f$;
create operator class storage.review_enum_ops default for type storage.review_enum using btree as
 operator 1 < (anyenum,anyenum), operator 2 <= (anyenum,anyenum), operator 3 = (anyenum,anyenum), operator 4 >= (anyenum,anyenum), operator 5 > (anyenum,anyenum), function 1 storage.review_cmp(storage.review_enum,storage.review_enum);
alter table storage.buckets add column review_enum_value storage.review_enum default ${fn}('b'::storage.review_enum,'a'::storage.review_enum);`);
    const before = await reading(db);
    const reviewed = own(before);
    const atReview = C.build01Facts({ ...before, ref: REF, finalFrom: refState, reviewed, bodyReview: disposed(before) });
    const js = C.blocking(atReview.findings).map((f) => f.key);
    // What X3e bound for this reading: the facts as they would have been, so only the first step's own read can refuse.
    const text = A.build01Text(src, MANIFEST, facts0(before, reviewed));
    await db.exec("create or replace function storage.review_cmp(storage.review_enum,storage.review_enum) returns integer language plpgsql immutable as $f$ begin perform nextval('storage.review_witness'); return case when $1::text < $2::text then -1 when $1::text > $2::text then 1 else 0 end; end $f$;");
    const after = await reading(db);
    const r = await runText(db, text);
    const left = await noneLeft(db);
    const refused = await witness(db);
    const real = await runText(db, withoutFirstStep(text));
    const consumed = (await db.query("select is_called, last_value::text from storage.review_witness")).rows[0];
    save(`w-expr-codex-enum-${form}.json`, { b00: deltaOf(EXPR_BASE.build00, before.build00), b00w: deltaOf(EXPR_BASE.build00w, before.build00w), readingsEqualAfterReplacement: same(before, after), noFacts: atReview.facts === null, js, sql: namesOf(r), code: r.code ?? null, where: r.where ?? null, left, witnessAfterRefusal: refused, real: real.ok ? { committed: true } : { committed: false, code: real.code, message: String(real.message).slice(0, 200) }, consumed });
    say(same(before, after) && atReview.facts === null && same(js, ["buckets-expression-nodes"]) && same(namesOf(r), ["buckets-expression-nodes"]) && !r.ok && r.code === "P0001" && left.ledger_absent && left.files_absent && refused === false && consumed.is_called === true, `run W: Codex's enum comparator, ${fn}: the readings are still equal after the body is replaced, and both refuse ${js.join(", ")} | ${namesOf(r).join(", ")} before any file, witness unconsumed; without the step: ${real.ok ? "it commits" : `${real.code}`}, witness ${JSON.stringify(consumed)}`);
  }
}
{
  // Codex's probe of 0acf9ca (XF-R1), the same sequence: a bucket default calling @@(text,text), read
  // and bound under one default_text_search_config and run under another. The readings do not move,
  // the default's value does, and at X3f both bound and BUILD-01 committed. Not shown to write
  // anything it should not: shown to run what the readings do not hold. The reviewed list now stops
  // it in both implementations, and BUILD-01's own text, with its list put back to X3f's blanket rule,
  // commits on the same database.
  const db = await fresh();
  await db.exec("set default_text_search_config = 'pg_catalog.english'; alter table storage.buckets add column review_ts boolean default ('cats'::text @@ 'cat'::text);");
  const value = async () => (await db.query("select ('cats'::text @@ 'cat'::text) as v")).rows[0].v;
  const before = await reading(db);
  const english = await value();
  const reviewed = own(before);
  const atReview = C.build01Facts({ ...before, ref: REF, finalFrom: refState, reviewed, bodyReview: disposed(before) });
  const js = C.blocking(atReview.findings).map((f) => f.key);
  const text = A.build01Text(src, MANIFEST, facts0(before, reviewed));
  await db.exec("set default_text_search_config = 'pg_catalog.simple'");
  const after = await reading(db);
  const simple = await value();
  const r = await runText(db, text);
  const left = await noneLeft(db);
  // X3f's blanket rule, put back into this text's operator check: every built-in non-volatile operator.
  const head = "not coalesce('node-operator|' || x.ref || '|' || x.fact in (";
  const at = text.indexOf(head);
  if (at < 0 || text.indexOf(head, at + 1) >= 0) throw new Error("the operator check is not in BUILD-01's text exactly once");
  const end = text.indexOf("), false)", at) + "), false)".length;
  const blanket = `${text.slice(0, at)}not coalesce(x.fact ~ '^pg_catalog[|]true[|]pg_catalog[|]true[|][is][|]', false)${text.slice(end)}`;
  const m = await runText(db, blanket);
  const inserted = m.ok ? (await db.query("select review_ts from storage.buckets order by name")).rows.map((x) => x.review_ts) : null;
  save("w-expr-codex-text-search.json", { b00: deltaOf(EXPR_BASE.build00, before.build00), b00w: deltaOf(EXPR_BASE.build00w, before.build00w), readingsEqualAfterSetting: same(before, after), values: { english, simple }, noFacts: atReview.facts === null, js, sql: namesOf(r), code: r.code ?? null, where: r.where ?? null, left, blanketSql: m.ok ? { committed: true, review_ts: inserted } : { committed: false, code: m.code, message: String(m.message).slice(0, 200) } });
  say(same(before, after) && english === true && simple === false && atReview.facts === null && same(js, ["buckets-expression-nodes"]) && same(namesOf(r), ["buckets-expression-nodes"]) && !r.ok && r.code === "P0001" && left.ledger_absent && left.files_absent && m.ok, `run W: Codex's @@ under two text search settings: the readings are equal, the value moves ${english} → ${simple}, and both refuse ${js.join(", ")} | ${namesOf(r).join(", ")} before any file; with X3f's blanket rule back in the text, BUILD-01 ${m.ok ? `commits, the new buckets' review_ts ${JSON.stringify(inserted)}` : `does not commit: ${m.code}`}`);
}
{
  // Codex's stock-like expressions on auth.users, as it ran them: kept.
  const db = await fresh();
  await db.exec(`alter table auth.users add column review_small smallint default 1::smallint;
alter table auth.users add column review_varchar varchar(5) default 'abcdef'::varchar(5);
alter table auth.users add column review_least timestamptz generated always as (least(created_at, updated_at)) stored;
alter table auth.users add constraint review_json check (jsonb_typeof(raw_app_meta_data) = 'object' and jsonb_array_length(raw_user_meta_data) >= 0);
create index review_lower on auth.users(lower(email)) where email !~ 'x';`);
  const rd = await reading(db);
  const { facts, findings } = C.build01Facts({ ...rd, ref: REF, finalFrom: refState, reviewed: own(rd), bodyReview: disposed(rd) });
  const stops = C.blocking(findings).map((f) => f.key);
  const r = facts ? await runText(db, A.build01Text(src, MANIFEST, facts)) : { ok: false, message: "no facts" };
  save("w-expr-commit-codex-stock-controls.json", { b00: deltaOf(EXPR_BASE.build00, rd.build00), b00w: deltaOf(EXPR_BASE.build00w, rd.build00w), stops, committed: r.ok });
  say(!stops.length && r.ok, `run W: Codex's stock-like expressions on auth.users: the varchar length coercion, integer to smallint, timestamp LEAST, the JSON CHECK and the lower(email) index with its regex predicate are kept, and BUILD-01 commits${r.ok ? "" : `: ${r.code} ${String(r.message).slice(0, 120)}`}`);
}
{
  // XE-R2: a policy count is evidence. RLS on, a role it applies to, and a policy that would admit
  // it: the no-active-RLS preflight still refuses. The writer's identity is BUILD-00W's own, read as
  // that role; BUILD-00, read here by another role, labels nobody as the writer.
  const db = await fresh();
  await db.exec(`create role reader nologin; grant usage on schema auth, storage, extensions, supabase_migrations to reader; grant select on all tables in schema storage to reader; grant select on auth.users to reader;
    alter table storage.buckets enable row level security; alter table auth.users enable row level security;
    create policy x_p on storage.buckets for all using (true) with check (true); create policy x_p on auth.users for all using (true) with check (true);`);
  const asPostgres = await read(db, "BUILD-00");
  await db.exec("set role reader");
  const asReader = await read(db, "BUILD-00W");
  const rd = { build00: asPostgres, build00w: asReader };
  const js = C.buildPredicateFindings(rd.build00, rd.build00w, { creator: "postgres", ledger: "absent-table", reviewed: own(rd) }).map((f) => f.key).sort();
  const facts = { ref: REF, creator: "postgres", ledger: "absent-table", employees: 2, digests: { build00: C.partDigests(rd.build00), build00w: C.partDigests(rd.build00w) }, reviewed: own(rd), defaultsNow: C.defaultsOf(rd.build00, "defaults", "postgres"), defaultsFinal: C.defaultsOf(rd.build00, "defaults", "postgres") };
  const r = await runText(db, A.build01Text(src, MANIFEST, facts));
  await db.exec("reset role");
  const count = (part) => rd.build00.find((x) => x.part === part && x.key === "policies").value;
  const writer = C.writerOf(Object.fromEntries(["role"].map((p) => [p, Object.fromEntries(rd.build00w.filter((x) => x.part === p).map((x) => [x.key, x.value]))])));
  save("w-shape-rls-with-policy.json", { js, sql: namesOf(r), policies: { buckets: count("buckets"), authusers: count("authusers") }, writer, rls: { buckets: rd.build00w.find((x) => x.part === "buckets" && x.key === "rls_applies").value, authusers: rd.build00w.find((x) => x.part === "authusers" && x.key === "rls_applies").value } });
  say(js.includes("buckets-rls") && js.includes("authusers-rls") && namesOf(r).includes("buckets-rls") && namesOf(r).includes("authusers-rls") && count("buckets") === "1" && count("authusers") === "1" && writer.role === "reader" && writer.bypassrls === false, `run W: RLS on with a policy that would admit the role: both refuse ${js.filter((n) => n.endsWith("-rls")).join(", ")}, the counts are 1 and 1, and the writer is BUILD-00W's ${writer.role}, bypassrls ${writer.bypassrls}`);
}
{
  // What the walk cannot see, and B1's review item: a PL/pgSQL body records no dependency on
  // what it calls, so replacing its helper leaves both readings equal. A parsed SQL-standard
  // body does record it (reviewed-helper-in-a-parsed-body above). Empty dependencies prove nothing here.
  const db = await fresh();
  await db.exec(EXPR_PRELUDE(TABLES[0]) + EXPR_PRELUDE(TABLES[1]));
  await db.exec("create function storage.string_helper() returns boolean language plpgsql as $f$ begin return true; end $f$; create function storage.string_body() returns trigger language plpgsql as $f$ begin perform storage.string_helper(); return new; end $f$; create trigger x_string before insert on storage.buckets for each row execute function storage.string_body();");
  const before = await reading(db);
  const items = Object.keys(C.bodyReviewItemsOf(before.build00));
  const bound = C.build01Facts({ ...before, ref: REF, finalFrom: refState, reviewed: own(before), bodyReview: disposed(before) });
  const noDisposition = C.build01Facts({ ...before, ref: REF, finalFrom: refState, reviewed: own(before) });
  await db.exec("create or replace function storage.string_helper() returns boolean language plpgsql as $f$ begin perform nextval('storage.review_witness'); return true; end $f$;");
  const after = await reading(db);
  const r = await runText(db, A.build01Text(src, MANIFEST, bound.facts));
  const consumed = await witness(db);
  save("w-expr-limit-string-body-helper.json", { readingsEqual: same(before, after), items, boundWithDispositions: bound.facts !== null, withoutDispositions: C.blocking(noDisposition.findings).map((f) => f.key), committed: r.ok, consumed });
  say(same(before, after) && bound.facts !== null && noDisposition.facts === null && r.ok && consumed === true && items.includes("buckets|trigger-function|x_string|storage.string_body()") && !items.some((k) => k.includes("string_helper")), `run W: the limit: a PL/pgSQL helper replaced leaves the readings equal and BUILD-01 consumes the witness; the walk reports the body and not the helper, so B1 must read it, and no disposition means no facts`);
}
{
  // A reading with no review at all: nothing binds, in the comparator, and build01Text refuses without a set.
  const db = await fresh();
  await db.exec(STOCK);
  const rd = await reading(db);
  const none = C.build01Facts({ ...rd, ref: REF, finalFrom: refState });
  const noneNames = [...new Set(C.blocking(none.findings).map((f) => f.key))].sort();
  say(none.facts === null && same(noneNames, ["authusers-reviewed", "body-review", "buckets-reviewed"]), `run W: no reviewed set and no dispositions: no facts, naming ${noneNames.join(", ")}`);
}
{
  // A column one of the two INSERTs supplies is gone: BUILD-00 reports it, and
  // BUILD-00W's privilege read of that column fails the statement, here and inside
  // BUILD-01: an error, never a false fact.
  const db = await fresh();
  const baseW = await read(db, "BUILD-00W");
  await db.exec("alter table storage.buckets drop column allowed_mime_types;");
  const b = await read(db, "BUILD-00");
  const w = await read(db, "BUILD-00W").then(() => null, (e) => e.code);
  const js = C.buildPredicateFindings(b, baseW, { creator: "postgres", ledger: "absent-table", reviewed: C.reviewedSetOf(b) }).map((f) => f.key);
  const facts = { ref: REF, creator: "postgres", ledger: "absent-table", employees: 2, digests: { build00: C.partDigests(b), build00w: C.partDigests(baseW) }, reviewed: C.reviewedSetOf(b), defaultsNow: C.defaultsOf(b, "defaults", "postgres"), defaultsFinal: C.defaultsOf(refState, 3, "postgres") };
  const r = await runText(db, A.build01Text(src, MANIFEST, facts));
  save("w-shape-missing-bucket-column.json", { js, build00wError: w, code: r.code ?? null, where: r.where ?? null });
  say(w === "42703" && same(js, ["buckets-columns"]) && r.code === "42703" && /^PL\/pgSQL function inline_code_block line \d+ at RAISE$/.test(String(r.where)), `run W: missing-bucket-column: BUILD-00W fails ${w}, the comparator names ${js.join(", ")}, and BUILD-01 re-raises ${r.code}`);
}
{
  // A reader that RLS filters: the facts are BUILD-00W's, read as that role.
  // Run as that role, BUILD-01's own read names the same predicates, the authority
  // ones among them, which a superuser's run cannot reach.
  const db = await fresh();
  await db.exec(`create role reader nologin; grant usage on schema auth, storage, extensions, supabase_migrations to reader; grant select on all tables in schema storage to reader; grant select on auth.users to reader;
    alter table storage.buckets enable row level security; insert into storage.buckets (id, name) values ('job-files', 'job-files');`);
  const baseline = C.defaultsOf(await read(db, "BUILD-00"), "defaults", "postgres");
  await db.exec("set role reader");
  const rd = await reading(db);
  const js = C.buildPredicateFindings(rd.build00, rd.build00w, { creator: "postgres", ledger: "absent-table", reviewed: own(rd) }).map((f) => f.key).sort();
  const facts = { ref: REF, creator: "postgres", ledger: "absent-table", employees: 2, digests: { build00: C.partDigests(rd.build00), build00w: C.partDigests(rd.build00w) }, reviewed: own(rd), defaultsNow: baseline, defaultsFinal: baseline };
  const r = await runText(db, A.build01Text(src, MANIFEST, facts));
  await db.exec("reset role");
  const sql = (/does not hold: (.*)$/.exec(String(r.message)) || [, ""])[1].split(", ").filter(Boolean).sort();
  save("w-shape-rls-reader.json", { js, sql, row: rd.build00w.find((x) => x.key === "row|job-files").value, rls: rd.build00w.find((x) => x.part === "buckets" && x.key === "rls_applies").value });
  const want = ["authusers-authority", "buckets-authority", "buckets-rls", "creator", "database-create", "objects-authority", "publication-authority"];
  say(same(js, want) && same(sql, want) && rd.build00w.find((x) => x.key === "row|job-files").value === "false", `run W: a reader RLS filters sees no target row; the comparator and BUILD-01 both refuse: ${js.join(", ")} | ${sql.join(", ")}`);
}
{
  // A fact changed between the reads and BUILD-01: the digest refuses before any file.
  const db = await fresh();
  const rd = await reading(db);
  const { facts } = C.build01Facts({ ...rd, ref: REF, finalFrom: refState, reviewed: own(rd), bodyReview: disposed(rd) });
  const text = A.build01Text(src, MANIFEST, facts);
  await db.exec("insert into auth.users (id, email) values ('33333333-3333-4333-8333-333333333333', 'x@example.invalid'); alter table storage.buckets add column later text;");
  const r = await runText(db, text);
  const gone = (await db.query("select to_regclass('supabase_migrations.schema_migrations') is null as ledger_absent, to_regnamespace('stage0_rehearsal') is null as marker_absent, to_regclass('public.print_jobs') is null as files_absent")).rows[0];
  save("w-fact-changed.json", { code: r.code ?? null, message: r.message ?? null, where: r.where ?? null, gone });
  say(!r.ok && /does not hold: buckets-reviewed, digest build00\.buckets/.test(String(r.message)) && gone.ledger_absent && gone.marker_absent && gone.files_absent, `run W: a fact changed after the reads: ${String(r.message).slice(0, 100)}`);
}
{
  // A later file's failure: re-raised, one frame, and nothing stays.
  const db = await fresh();
  const rd = await reading(db);
  const { facts } = C.build01Facts({ ...rd, ref: REF, finalFrom: refState, reviewed: own(rd), bodyReview: disposed(rd) });
  const text = A.build01Text(src, MANIFEST, facts);
  await db.exec("create role probe nologin");
  const broken = text.replace("  execute f;\n", "  raise exception 'a planted failure' using errcode = '22012';\n");
  const r = await runText(db, broken);
  const left = (await db.query("select to_regclass('supabase_migrations.schema_migrations') is null as ledger_absent")).rows[0];
  save("w-file-failure.json", { code: r.code ?? null, message: r.message ?? null, where: r.where ?? null, left });
  say(!r.ok && r.code === "22012" && /^PL\/pgSQL function inline_code_block line \d+ at RAISE$/.test(String(r.where)) && left.ledger_absent, `run W: a failure in a step is re-raised with one frame, and nothing stays: ${r.code} ${r.message}`);
}
writeFileSync(join(OUT, "index.json"), JSON.stringify({ note: "Written by scripts/manual/stage0-item4c-writing-local-pglite.mjs; each file's sha256. stage0-4c-writing.test.js refuses a fixture that is not this.", files }, null, 2) + "\n");
console.log(`${Object.keys(files).length} fixtures written to ${OUT}`);
process.exit(failures ? 1 : 0);
