#!/usr/bin/env node
// Local execution of every stage-0 SQL text in a REAL Postgres (PGlite, PG 17
// compiled to WASM) — a pre-review check, NOT evidence about production.
// docs/security/release-2-stage-0-production-plan.md §E7.
//
// It builds a production-shaped database from the committed migrations: a
// minimal Supabase shim (roles anon/authenticated/service_role, auth.users,
// auth.uid(), storage.buckets/objects, the realtime publication, the ledger
// table, and this project's default privileges), then every top-level file in
// supabase/migrations/ in version order with its ledger row. Production data
// that predates phase_b_02 is inserted at that point: store4979, an owner and
// two employees. On that database it runs:
//   P0; P1; P0 again (must be identical); P2-01..05; the ledger read-back;
//   the rollback operations out of order (must refuse) and in order; RB-1
//   over a non-empty table (must refuse); P0-S restored; P0-L appended.
// Plus the negative controls: a staging-shaped database, an unknown ledger,
// a rollback file outside its operation, and two mutated proof expectations.
//
// WHAT IT CANNOT SHOW:
//   - concurrency (PGlite is one connection), so lock_timeout, a held
//     employees lock and a cancel are not exercised;
//   - Supabase's real role model (postgres is a superuser here);
//   - the production server version (P0 reads it);
//   - production's real rows.
// P1 on production is what shows those.
//
// PGlite is NOT a dependency of this repository (CLAUDE.md: two
// devDependencies and no more). Install it outside the repo, at the version
// the reviewed runs used, and point at it:
//   npm install --prefix <scratch dir> @electric-sql/pglite@0.4.6
//   PGLITE_DIR=<scratch dir>/node_modules/@electric-sql/pglite node scripts/manual/stage0-local-pglite.mjs [rev]
// 0.4.6 reports PostgreSQL 17.5, and the review of d01b74a ran it at that
// version. 0.3.16 also runs it; 0.3.14 does not, because it lacks
// dist/contrib/pgcrypto.js.
//
// Inputs come from the manifest committed at [rev] (default HEAD): the
// assembled texts and the 20 baseline migrations, both by blob id, as the
// assembler reads them.
import { pathToFileURL, fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const REV = process.argv[2] || "HEAD";
if (!process.env.PGLITE_DIR) {
  process.stderr.write("set PGLITE_DIR to an installed @electric-sql/pglite package directory (see the header)\n");
  process.exit(2);
}
const { PGlite } = await import(pathToFileURL(join(process.env.PGLITE_DIR, "dist", "index.js")).href);
const { pgcrypto } = await import(pathToFileURL(join(process.env.PGLITE_DIR, "dist", "contrib", "pgcrypto.js")).href);
const { assembleAll, manifestAt, gitBlob } = await import(pathToFileURL(join(REPO, "scripts", "manual", "assemble-stage0.mjs")).href);
process.chdir(REPO);
// STAGE0_MANIFEST=<file> runs an uncommitted manifest (authoring only); the
// default is the manifest committed at [rev].
const MANIFEST = process.env.STAGE0_MANIFEST
  ? JSON.parse((await import("node:fs")).readFileSync(process.env.STAGE0_MANIFEST, "utf8"))
  : manifestAt(REV, REPO);
const blob = (id) => gitBlob(id, REPO).toString("utf8");
const OUT = assembleAll(MANIFEST, { cwd: REPO });

const SHIM = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
grant anon, authenticated, service_role to postgres;
create schema auth; create schema storage; create schema extensions; create schema supabase_migrations;
create extension pgcrypto schema extensions;
grant usage on schema public, auth, storage, extensions to anon, authenticated, service_role;
create table auth.users (
  instance_id uuid, id uuid primary key, aud varchar(255), role varchar(255), email varchar(255),
  encrypted_password varchar(255), created_at timestamptz default now(), updated_at timestamptz,
  last_sign_in_at timestamptz, raw_app_meta_data jsonb, raw_user_meta_data jsonb,
  is_sso_user boolean not null default false, is_anonymous boolean not null default false);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                         (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')), '')::uuid $$;
create function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')) $$;
create table storage.buckets (id text primary key, name text not null, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[], owner uuid, created_at timestamptz default now(), updated_at timestamptz default now());
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id),
  name text, owner uuid, metadata jsonb, created_at timestamptz default now(), updated_at timestamptz default now());
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name, '/') $$;
create publication supabase_realtime;
-- The ledger exactly as staging's live table (read back 2026-09-29, review N6).
create table supabase_migrations.schema_migrations (version text not null primary key, statements text[], name text,
  created_by text, idempotency_key text unique, rollback text[]);
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`;

async function freshDb({ staging = false, oldLedger = false } = {}) {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(oldLedger
    ? SHIM.replace(/create table supabase_migrations\.schema_migrations \([\s\S]*?\);/, "create table supabase_migrations.schema_migrations (version text primary key, statements text[], name text);")
    : SHIM);
  await db.exec(`insert into auth.users (instance_id, id, aud, role, email) values
    ('00000000-0000-0000-0000-000000000000', '11111111-1111-4111-8111-111111111111', 'authenticated', 'authenticated', 'owner@example.invalid'),
    ('00000000-0000-0000-0000-000000000000', '22222222-2222-4222-8222-222222222222', 'authenticated', 'authenticated', 'store4979@theupsstore.com');`);
  for (const row of MANIFEST.baselineLedger) {
    const b = `${row.version}_${row.name}.sql`;
    const sql = blob(row.blob);
    try { await db.exec(sql); } catch (e) { throw new Error(`migration ${b}: ${e.message}`); }
    if (oldLedger) await db.query("insert into supabase_migrations.schema_migrations (version, name, statements) values ($1, $2, array[$3])", [row.version, row.name, sql]);
    else await db.query("insert into supabase_migrations.schema_migrations (version, name, statements, created_by) values ($1, $2, array[$3], $4)", [row.version, row.name, sql, "store4979@theupsstore.com"]);
    if (row.version === "20260722003606") {
      // production data that predates phase_b_02: the store, its owner, staff.
      await db.exec(`insert into public.stores (slug, name) values ('store4979', 'The UPS Store #4979');
        insert into public.memberships (store_id, user_id, role) select id, '11111111-1111-4111-8111-111111111111', 'owner' from public.stores where slug = 'store4979';
        insert into public.employees (name, pin, active) values ('Real Staff', '1234', true), ('Real Manager', '0842', true);`);
    }
  }
  if (staging) await db.exec(`insert into public.stores (id, slug, name, org_id) select '5ee41000-0000-4000-8000-0000000000a1', 'seed-t1', 'Seed T1', org_id from public.stores where slug = 'store4979';`);
  return db;
}

const one = async (db, sql) => (await db.query(sql)).rows[0];
async function run(db, name) {
  if (name !== "P1") await new Promise((r) => setTimeout(r, 2100)); // real steps are minutes apart
  const t = Date.now();
  try { await db.exec(OUT[name]); return { ok: true, ms: Date.now() - t }; }
  catch (e) { await db.exec("rollback").catch(() => {}); return { ok: false, error: e.message, ms: Date.now() - t }; }
}
const P0S = ["has_store_role", "organizations", "stores_org_id", "stores_without_org", "uniq_already_there", "release2_tables_present",
  "release2_functions_present", "catalog_fingerprint", "probe_slug_absent", "nil_job_absent", "auth_users_user_triggers", "free_pins"];
const pick = (o, ks) => Object.fromEntries(ks.map((k) => [k, o[k]]));
let failures = 0;
const expect = (label, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? "  — " + detail : ""}`); if (!cond) failures++; };

// ── the main sequence ───────────────────────────────────────────────────────
const db = await freshDb();
const p0a = await one(db, OUT.P0);
console.log("P0 (fresh):", JSON.stringify(p0a));
expect("P0 identity + preconditions", p0a.ledger_matches_repo && p0a.production_ledger_marker && p0a.staging_seed_absent
  && p0a.production_store_present && p0a.stores_without_org == 0 && p0a.release2_tables_present == 0
  && p0a.release2_functions_present == 0 && !p0a.uniq_already_there && p0a.probe_slug_absent && p0a.nil_job_absent
  && p0a.auth_users_user_triggers == 0 && p0a.free_pins >= 3 && p0a.ledger_rows == 20 && p0a.release2_in_ledger == 0
  && p0a.pg17_hard_timer === true && p0a.ledger_columns_as_pinned === true && p0a.ledger_rows_single_element === true
  && JSON.stringify(p0a.ledger_created_by) === JSON.stringify(["store4979@theupsstore.com"]));

let r = await run(db, "P1");
expect("P1 runs to ROLLBACK with every proof passing", r.ok, r.error || `${r.ms} ms`);
const p0b = await one(db, OUT.P0);
expect("P0 after P1 is identical (S and L)", JSON.stringify(p0b) === JSON.stringify(p0a));

const STEPS = ["P2-01", "P2-02", "P2-0304", "P2-05"];   // N7: 03 and 04 are one step
for (const k of STEPS) {
  r = await run(db, k);
  expect(`${k} commits`, r.ok, r.error || `${r.ms} ms`);
}
const st5 = await one(db, OUT.STATE);
expect("STATE after all four steps: prefix 01..05, catalog 05, recovery RB-5, RB-43, RB-2, RB-1",
  st5.effective_prefix === "01,02,03,04,05" && st5.catalog_state === "05" && st5.ledger_md5_ok === true && st5.recovery === "RB-5, RB-43, RB-2, RB-1", JSON.stringify(st5));
const led = (await db.query("select version, name, md5(statements[1]) as md5, octet_length(statements[1]) as bytes from supabase_migrations.schema_migrations where name like 'release2%' order by version")).rows;
console.log(led);
expect("five forward ledger rows with A1 md5/bytes", led.length === 5 && led.map((x) => x.md5).join() ===
  "e97a5fd7c346a3b0a39bc6180dcfde46,734e0db7312b79081a769ca366c5b99a,302e05c6a4939eb8021234cbc7325473,2dcb03eb36e47c8404a29500151e8394,22b5010b9a3b20f5a3aaba4d212fd46c");
// N6: the wrapper's rows have apply_migration's shape, in full.
const shape = (await db.query(`select version, name, cardinality(statements) as n, array_lower(statements, 1) as lo, array_upper(statements, 1) as hi,
    md5(statements[1]) as md5, created_by, idempotency_key, rollback from supabase_migrations.schema_migrations where name like 'release2%' order by version`)).rows;
expect("N6: wrapper rows have apply_migration's full shape (one element [1:1], created_by set, idempotency_key and rollback null)",
  shape.length === 5 && shape.every((x) => x.n === 1 && x.lo === 1 && x.hi === 1 && x.created_by === "store4979@theupsstore.com" && x.idempotency_key === null && x.rollback === null));
// N6: list_migrations lists every ledger row by (version, name), in version
// order (observed on staging 2026-09-29, including rows with repeated names).
// The same projection here must list the five wrapper rows.
const listed = (await db.query("select version, coalesce(name, '') as name from supabase_migrations.schema_migrations order by version")).rows;
expect("N6: the list_migrations projection lists the five wrapper rows, after the 20 baseline rows",
  listed.length === 25 && listed.slice(20).map((x) => x.name).join() === "release2_01_identity_schema,release2_02_auth_attempts_fn,release2_03_bind_and_atomicity,release2_04_staff_session_qualify_columns,release2_05_revoke_enrollment",
  listed.slice(20).map((x) => x.version + " " + x.name).join("; "));
r = await run(db, "P2-05");
expect("P2-05 twice is refused", !r.ok && /already in the ledger/.test(r.error), r.error);

// RB-43 on its own file order is enforced: run RB-2 before RB-43 → refused.
r = await run(db, "RB-2");
expect("RB-2 before RB-5/RB-43 is refused by its state guard", !r.ok, r.error);
r = await run(db, "RB-43");
expect("RB-43 before RB-5 is refused (state after 05)", !r.ok, r.error);
for (const op of ["RB-5", "RB-43", "RB-2"]) {
  r = await run(db, op);
  expect(`${op} commits`, r.ok, r.error || `${r.ms} ms`);
}
// RB-1 over non-empty state is refused (F-7).
await db.exec(`insert into public.enrollment_tickets (store_id, ticket_hash, created_by, expires_at)
  select id, extensions.digest('x', 'sha256'), '11111111-1111-4111-8111-111111111111', now() from public.stores where slug = 'store4979'`);
r = await run(db, "RB-1");
expect("RB-1 over a non-empty Release 2 table is refused", !r.ok && /not empty/.test(r.error), r.error);
await db.exec("delete from public.enrollment_tickets");
r = await run(db, "RB-1");
expect("RB-1 commits over empty state", r.ok, r.error || `${r.ms} ms`);
const p0c = await one(db, OUT.P0);
expect("after RB: P0-S identical to the original (catalog fingerprint included)", JSON.stringify(pick(p0c, P0S)) === JSON.stringify(pick(p0a, P0S)),
  JSON.stringify(pick(p0c, P0S)));
const led2 = (await db.query("select version, name from supabase_migrations.schema_migrations where name like 'release2%' order by version")).rows.map((x) => x.name);
expect("after RB: P0-L = 20 original + 5 forward + 5 rollback rows, in order", p0c.ledger_rows == 30 && led2.join() ===
  "release2_01_identity_schema,release2_02_auth_attempts_fn,release2_03_bind_and_atomicity,release2_04_staff_session_qualify_columns,release2_05_revoke_enrollment,release2_05_revoke_enrollment_rollback,release2_04_staff_session_qualify_columns_rollback,release2_03_bind_and_atomicity_rollback,release2_02_auth_attempts_fn_rollback,release2_01_identity_schema_rollback", led2.join());

// ── negative controls ───────────────────────────────────────────────────────
const stg = await freshDb({ staging: true });
for (const name of ["P1", "P2-01"]) {
  r = await run(stg, name);
  expect(`${name} on a staging-shaped database is refused`, !r.ok && /staging/.test(r.error), r.error);
}
// N6 control: a ledger WITHOUT apply_migration's columns is flagged by P0 and refused by the wrapper.
const old3 = await freshDb({ oldLedger: true });
const p0old = await one(old3, OUT.P0);
expect("N6 control: P0 flags a ledger of another shape (ledger_columns_as_pinned false)", p0old.ledger_columns_as_pinned === false);
r = await run(old3, "P2-01");
expect("N6 control: the wrapper cannot write its row into a ledger of another shape", !r.ok && /created_by/.test(r.error), r.error);
const unk = await freshDb();
await unk.exec("update supabase_migrations.schema_migrations set statements = array[statements[1] || ' '] where version = '20260427173246'");
r = await run(unk, "P2-01");
expect("P2-01 on an unknown ledger is refused", !r.ok && /not production/.test(r.error), r.error);
const lk = await freshDb();
// a held lock on employees: the wrapper must fail on lock_timeout, not queue
r = await run(lk, "P2-02");
expect("P2-02 before 01 is refused by the state guard", !r.ok, r.error);

// the proofs are FAILING assertions: break 04's expectation and P1 must fail
const bad = OUT.P1.replace("'d30da6d0c7a4d14e1bcb1b9fcace37d9', 'postgres=EXECUTE,service_role=EXECUTE'),\n    ('release2_revoke_enrollment",
                           "'00000000000000000000000000000000', 'postgres=EXECUTE,service_role=EXECUTE'),\n    ('release2_revoke_enrollment");
expect("mutation control: the proofs text was mutated", bad !== OUT.P1);
const db3 = await freshDb();
try { await db3.exec(bad); expect("a wrong A2 expectation fails P1", false); }
catch (e) { expect("a wrong A2 expectation fails P1", /STAGE0 PROOF S2\.1 FAILED/.test(e.message), e.message.slice(0, 160)); }

// a rollback file run on its own (outside RB-43) refuses
const db4 = await freshDb();
for (const k of STEPS) { r = await run(db4, k); if (!r.ok) throw new Error(r.error); }
for (const [f, re] of [["release2_05_revoke_enrollment", null], ["release2_04_staff_session_qualify_columns", /only inside operation RB-43/]]) {
  const text = blob(MANIFEST.rollbacks.find((x) => f.startsWith(`release2_${x.n}_`)).blob);
  if (!re) { await db4.exec("begin"); await db4.exec(text); await db4.exec("rollback"); expect(`${f}.rollback.sql runs standalone inside begin…rollback`, true); continue; }
  try { await db4.exec("begin"); await db4.exec(text); expect(`${f}.rollback.sql outside RB-43 is refused`, false); }
  catch (e) { expect(`${f}.rollback.sql outside RB-43 is refused`, re.test(e.message), e.message.slice(0, 140)); }
  await db4.exec("rollback").catch(() => {});
}
// a wrong expected error in an end-to-end proof fails P1
const bad2 = OUT.P1.replace("'ticket not redeemable', ticket_rows", "'ticket redeemable', ticket_rows");
expect("mutation control 2: E2's expected message was mutated", bad2 !== OUT.P1);
const db5 = await freshDb();
try { await db5.exec(bad2); expect("a wrong E2 expectation fails P1", false); }
catch (e) { expect("a wrong E2 expectation fails P1", /STAGE0 PROOF E2 FAILED/.test(e.message), e.message.slice(0, 200)); }

// ── N7 (review of dc5a88b): recovery from EVERY committed prefix ─────────────
// For each prefix the P2 steps can commit, the pinned STATE read-back must name
// exactly one recovery sequence, and running it must restore P0-S (catalog
// fingerprint included) while the ledger only grows: the original 20 rows, the
// forward rows, then the rollback rows, in order.
const RB_NAMES = { "RB-5": ["05"], "RB-43": ["04", "03"], "RB-2": ["02"], "RB-1": ["01"] };
const NAME = Object.fromEntries(MANIFEST.migrations.map((m) => [m.n, m.name]));
const PREFIXES = [
  { steps: ["P2-01"], prefix: "01", state: "01", ops: ["RB-1"] },
  { steps: ["P2-01", "P2-02"], prefix: "01,02", state: "02", ops: ["RB-2", "RB-1"] },
  { steps: ["P2-01", "P2-02", "P2-0304"], prefix: "01,02,03,04", state: "04", ops: ["RB-43", "RB-2", "RB-1"] },
  { steps: ["P2-01", "P2-02", "P2-0304", "P2-05"], prefix: "01,02,03,04,05", state: "05", ops: ["RB-5", "RB-43", "RB-2", "RB-1"] },
];
async function recoverAndCheck(d, label, p0orig, fwd, ops) {
  for (const op of ops) {
    const rr = await run(d, op);
    expect(`${label}: ${op} commits`, rr.ok, rr.error || `${rr.ms} ms`);
  }
  const after = await one(d, OUT.P0);
  expect(`${label}: after recovery P0-S is identical to the original (catalog fingerprint included)`,
    JSON.stringify(pick(after, P0S)) === JSON.stringify(pick(p0orig, P0S)), JSON.stringify(pick(after, P0S)));
  const names = (await d.query("select name from supabase_migrations.schema_migrations where name like 'release2%' order by version")).rows.map((x) => x.name);
  const want = [...fwd.map((n) => NAME[n]), ...ops.flatMap((o) => RB_NAMES[o]).map((n) => NAME[n] + "_rollback")];
  expect(`${label}: the ledger only grew — 20 + ${fwd.length} forward + ${want.length - fwd.length} rollback rows, in order`,
    after.ledger_rows == 20 + want.length && names.join() === want.join(), names.join());
  const fin = await one(d, OUT.STATE);
  expect(`${label}: STATE afterwards — nothing applied`, fin.effective_prefix === "" && fin.catalog_state === "00" && /^none/.test(fin.recovery), JSON.stringify(fin));
}
for (const P of PREFIXES) {
  const d = await freshDb();
  const p0orig = await one(d, OUT.P0);
  for (const k of P.steps) { const rr = await run(d, k); if (!rr.ok) throw new Error(`${k}: ${rr.error}`); }
  const st = await one(d, OUT.STATE);
  expect(`prefix ${P.prefix}: STATE names the prefix, the matching catalog and ${P.ops.join(", ")}`,
    st.effective_prefix === P.prefix && st.catalog_state === P.state && st.recovery === P.ops.join(", "), JSON.stringify(st));
  await recoverAndCheck(d, `prefix ${P.prefix}`, p0orig, P.prefix.split(","), P.ops);
}

// A partial recovery is itself a prefix: after RB-5 from the full prefix, STATE names what remains.
{
  const d = await freshDb();
  for (const k of STEPS) { const rr = await run(d, k); if (!rr.ok) throw new Error(rr.error); }
  const rr = await run(d, "RB-5");
  expect("partial recovery: RB-5 commits", rr.ok, rr.error);
  const st = await one(d, OUT.STATE);
  expect("partial recovery: STATE then names prefix 01..04 and RB-43, RB-2, RB-1",
    st.effective_prefix === "01,02,03,04" && st.catalog_state === "04" && st.recovery === "RB-43, RB-2, RB-1", JSON.stringify(st));
}

// Forced failures INSIDE P2-0304 — local fault injection on a COPY of the pinned
// text, never a change to it. Each must leave the after-02 state with no 03 row.
const F2_GATE = /if md5\(f2\) <> '2dcb03eb36e47c8404a29500151e8394' or octet_length\(f2\) <> 5858 then/;
expect("fault injection anchor: P2-0304 gates f2 (04) on its md5 and bytes", F2_GATE.test(OUT["P2-0304"]));
async function afterFailed0304(label, text, errRe) {
  const d = await freshDb();
  const p0orig = await one(d, OUT.P0);
  for (const k of ["P2-01", "P2-02"]) { const rr = await run(d, k); if (!rr.ok) throw new Error(rr.error); }
  let err = null;
  try { await d.exec(text); } catch (e) { err = e.message; await d.exec("rollback").catch(() => {}); }
  expect(`${label}: P2-0304 fails`, err !== null && errRe.test(err), err);
  const rows = (await d.query("select name from supabase_migrations.schema_migrations where name like 'release2%' order by version")).rows.map((x) => x.name);
  expect(`${label}: no 03 or 04 row — the ledger holds 01 and 02 only`, rows.join() === [NAME["01"], NAME["02"]].join(), rows.join());
  const st = await one(d, OUT.STATE);
  expect(`${label}: STATE — prefix 01,02, the after-02 catalog, recovery RB-2, RB-1`,
    st.effective_prefix === "01,02" && st.catalog_state === "02" && st.recovery === "RB-2, RB-1", JSON.stringify(st));
  await recoverAndCheck(d, label, p0orig, ["01", "02"], ["RB-2", "RB-1"]);
}
// (a) 04's bytes wrong: the md5 gate refuses before EITHER file executes.
const origF2 = MANIFEST.migrations.find((m) => m.n === "04");
const f2text = blob(origF2.blob);
const f2wrong = f2text.replace("could not run.", "could not ruN.");
expect("fault (a) mutated 04's bytes", f2wrong !== f2text && OUT["P2-0304"].includes(f2text));
await afterFailed0304("forced failure (a), 04's bytes wrong", OUT["P2-0304"].replace(f2text, f2wrong), /embedded bytes of release2_04_staff_session_qualify_columns differ/);
// (b) a failure AFTER 03 has executed: 04's literal fails at runtime, with its gate
//     re-pointed at the faulty bytes so that 03 really runs first.
const f2fault = "select 1/0;\n" + f2text;
const md5 = (t) => createHash("md5").update(t, "utf8").digest("hex");
const faultText = OUT["P2-0304"].replace(f2text, f2fault)
  .replace(F2_GATE, `if md5(f2) <> '${md5(f2fault)}' or octet_length(f2) <> ${Buffer.byteLength(f2fault)} then`);
await afterFailed0304("forced failure (b), 04 fails after 03 executed", faultText, /division by zero/);

// STATE refuses a combination no recovery covers: the catalog says 03 ran, the ledger says it did not.
{
  const d = await freshDb();
  for (const k of ["P2-01", "P2-02"]) { const rr = await run(d, k); if (!rr.ok) throw new Error(rr.error); }
  await d.exec(blob(MANIFEST.migrations.find((m) => m.n === "03").blob));   // fault injection: 03 outside any wrapper, no ledger row
  const st = await one(d, OUT.STATE);
  expect("STATE control: catalog 03 with ledger 01,02 is STOP, not an operation", st.catalog_state === "03" && /^STOP/.test(st.recovery), JSON.stringify(st));
}

console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL PASS");
process.exit(failures ? 1 : 0);
