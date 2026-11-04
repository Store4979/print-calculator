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
//          failure, with the frames PostgreSQL gives it
//   run W  BUILD-01 from the shim's fresh shape, under the same two variants: the
//          21 files replay as written, with their ledger rows, the marker and the
//          exact default rows; each mutated shape refused by the predicate named,
//          and a fact changed between the reads and BUILD-01 refused
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

// ── run W: BUILD-01 ─────────────────────────────────────────────────────────
const REF = "abcdefghijklmnopqrst";
const reading = async (db) => ({ build00: await read(db, "BUILD-00"), build00w: await read(db, "BUILD-00W") });
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
  const { facts, findings } = C.build01Facts({ ...rd, ref: REF, finalFrom });
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
    const { facts } = C.build01Facts({ ...rd, ref: REF, finalFrom: refState });
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
  const js = C.buildPredicateFindings(rd.build00, rd.build00w, { creator, ledger }).map((f) => f.key).sort();
  const facts = { ref: REF, creator, ledger, employees: 2, digests: { build00: C.partDigests(rd.build00), build00w: C.partDigests(rd.build00w) }, defaultsNow: C.defaultsOf(rd.build00, "defaults", creator), defaultsFinal: C.defaultsOf(refState, 3, creator) };
  const r = await runText(db, A.build01Text(src, MANIFEST, facts));
  const sql = (/does not hold: (.*)$/.exec(String(r.message)) || [, ""])[1].split(", ").filter(Boolean).sort();
  save(`w-shape-${name}.json`, { js, sql, code: r.code ?? null, where: r.where ?? null });
  say(same(js, want) && same(sql, want) && !r.ok && /^PL\/pgSQL function inline_code_block line \d+ at RAISE$/.test(String(r.where)), `run W: ${name}: the comparator and BUILD-01 both refuse: ${js.join(", ")} | ${sql.join(", ")}`);
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
  const js = C.buildPredicateFindings(b, baseW, { creator: "postgres", ledger: "absent-table" }).map((f) => f.key);
  const facts = { ref: REF, creator: "postgres", ledger: "absent-table", employees: 2, digests: { build00: C.partDigests(b), build00w: C.partDigests(baseW) }, defaultsNow: C.defaultsOf(b, "defaults", "postgres"), defaultsFinal: C.defaultsOf(refState, 3, "postgres") };
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
  const js = C.buildPredicateFindings(rd.build00, rd.build00w, { creator: "postgres", ledger: "absent-table" }).map((f) => f.key).sort();
  const facts = { ref: REF, creator: "postgres", ledger: "absent-table", employees: 2, digests: { build00: C.partDigests(rd.build00), build00w: C.partDigests(rd.build00w) }, defaultsNow: baseline, defaultsFinal: baseline };
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
  const { facts } = C.build01Facts({ ...rd, ref: REF, finalFrom: refState });
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
  const { facts } = C.build01Facts({ ...rd, ref: REF, finalFrom: refState });
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
