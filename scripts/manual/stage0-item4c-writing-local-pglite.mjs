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
//          refused before any file, with a sequence as the witness of what would run
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
  const { facts, findings } = C.build01Facts({ ...rd, ref: REF, finalFrom, reviewed: own(rd) });
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
    const { facts } = C.build01Facts({ ...rd, ref: REF, finalFrom: refState, reviewed: own(rd) });
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
  const { facts, findings } = C.build01Facts({ ...rd, ref: REF, finalFrom: refState, reviewed: own(rd) });
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
  const bound = C.build01Facts({ ...atReview, ref: REF, finalFrom: refState, reviewed });
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
  const { facts, findings } = C.build01Facts({ ...rd, ref: REF, finalFrom: refState, reviewed });
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
  const bound = C.build01Facts({ ...before, ref: REF, finalFrom: refState, reviewed });
  await db.exec("create or replace function storage.review_reject() returns trigger language plpgsql as $$ begin perform nextval('storage.review_witness'); raise exception 'refused'; end $$;");
  const after = await reading(db);
  const js = C.blocking(C.build01Facts({ ...after, ref: REF, finalFrom: refState, reviewed }).findings).map((f) => f.key);
  const r = await runText(db, A.build01Text(src, MANIFEST, bound.facts));
  const left = await noneLeft(db);
  const refused = await witness(db);
  const real = await runText(db, withoutFirstStep(A.build01Text(src, MANIFEST, bound.facts)));
  const consumed = await witness(db);
  save("w-reviewed-codex-probe.json", { readingsEqual: same(before, after), bound: bound.facts !== null, reviewed, ...after, js, code: r.code ?? null, message: r.message ?? null, where: r.where ?? null, left, witnessAfterRefusal: refused, real: real.ok ? { committed: true } : { committed: false, code: real.code, message: real.message }, witnessWithoutTheStep: consumed });
  say(bound.facts !== null && !same(before, after) && same(js, ["buckets-reviewed"]) && !r.ok && String(r.message).includes("buckets-reviewed") && left.ledger_absent && left.files_absent && refused === false && real.message === "refused" && consumed === true, `run W: Codex's probe: the reads now differ; refused before any file: ${String(r.message).slice(30, 120)}; the witness unconsumed, and consumed without that step`);
}
{
  // A reading with no review at all: nothing binds, in the comparator, and build01Text refuses without a set.
  const db = await fresh();
  await db.exec(STOCK);
  const rd = await reading(db);
  const none = C.build01Facts({ ...rd, ref: REF, finalFrom: refState });
  say(none.facts === null && same(C.blocking(none.findings).map((f) => f.key).sort(), ["authusers-reviewed", "buckets-reviewed"]), `run W: no reviewed set: no facts, naming ${C.blocking(none.findings).map((f) => f.key).sort().join(", ")}`);
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
  const { facts } = C.build01Facts({ ...rd, ref: REF, finalFrom: refState, reviewed: own(rd) });
  const text = A.build01Text(src, MANIFEST, facts);
  await db.exec("insert into auth.users (id, email) values ('33333333-3333-4333-8333-333333333333', 'x@example.invalid'); alter table storage.buckets add column later text;");
  const r = await runText(db, text);
  const gone = (await db.query("select to_regclass('supabase_migrations.schema_migrations') is null as ledger_absent, to_regnamespace('stage0_rehearsal') is null as marker_absent, to_regclass('public.print_jobs') is null as files_absent")).rows[0];
  save("w-fact-changed.json", { code: r.code ?? null, message: r.message ?? null, where: r.where ?? null, gone });
  say(!r.ok && /does not hold: digest build00\.buckets/.test(String(r.message)) && gone.ledger_absent && gone.marker_absent && gone.files_absent, `run W: a fact changed after the reads: ${String(r.message).slice(0, 100)}`);
}
{
  // A later file's failure: re-raised, one frame, and nothing stays.
  const db = await fresh();
  const rd = await reading(db);
  const { facts } = C.build01Facts({ ...rd, ref: REF, finalFrom: refState, reviewed: own(rd) });
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
