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
// devDependencies and no more). Install it outside the repo and point at it:
//   npm install --prefix <scratch dir> @electric-sql/pglite@0.3
//   PGLITE_DIR=<scratch dir>/node_modules/@electric-sql/pglite node scripts/manual/stage0-local-pglite.mjs [rev]
import { execFileSync } from "node:child_process";
import { pathToFileURL, fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const REV = process.argv[2] || "HEAD";
if (!process.env.PGLITE_DIR) {
  process.stderr.write("set PGLITE_DIR to an installed @electric-sql/pglite package directory (see the header)\n");
  process.exit(2);
}
const { PGlite } = await import(pathToFileURL(join(process.env.PGLITE_DIR, "dist", "index.js")).href);
const { pgcrypto } = await import(pathToFileURL(join(process.env.PGLITE_DIR, "dist", "contrib", "pgcrypto.js")).href);
const { assembleAll } = await import(pathToFileURL(join(REPO, "scripts", "manual", "assemble-stage0.mjs")).href);
const git = (p) => execFileSync("git", ["show", `${REV}:${p}`], { cwd: REPO, maxBuffer: 1 << 26 }).toString("utf8");
process.chdir(REPO);
const OUT = assembleAll(REV);

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
create table supabase_migrations.schema_migrations (version text primary key, statements text[], name text);
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`;

async function freshDb({ staging = false } = {}) {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(SHIM);
  await db.exec(`insert into auth.users (instance_id, id, aud, role, email) values
    ('00000000-0000-0000-0000-000000000000', '11111111-1111-4111-8111-111111111111', 'authenticated', 'authenticated', 'owner@example.invalid'),
    ('00000000-0000-0000-0000-000000000000', '22222222-2222-4222-8222-222222222222', 'authenticated', 'authenticated', 'store4979@theupsstore.com');`);
  const files = execFileSync("git", ["ls-tree", "--name-only", REV, "supabase/migrations/"], { cwd: REPO }).toString().split("\n")
    .filter((p) => /\/\d{14}_.*\.sql$/.test(p) && !/\.rollback\.sql$/.test(p)).sort();
  for (const p of files) {
    const b = p.split("/").pop();
    const sql = git(p);
    try { await db.exec(sql); } catch (e) { throw new Error(`migration ${b}: ${e.message}`); }
    await db.query("insert into supabase_migrations.schema_migrations (version, name, statements) values ($1, $2, array[$3])",
      [b.slice(0, 14), b.slice(15, -4), sql]);
    if (b.startsWith("20260722003606")) {
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
  && p0a.auth_users_user_triggers == 0 && p0a.free_pins >= 3 && p0a.ledger_rows == 20 && p0a.release2_in_ledger == 0);

let r = await run(db, "P1");
expect("P1 runs to ROLLBACK with every proof passing", r.ok, r.error || `${r.ms} ms`);
const p0b = await one(db, OUT.P0);
expect("P0 after P1 is identical (S and L)", JSON.stringify(p0b) === JSON.stringify(p0a));

for (const n of ["01", "02", "03", "04", "05"]) {
  r = await run(db, `P2-${n}`);
  expect(`P2-${n} commits`, r.ok, r.error || `${r.ms} ms`);
}
const led = (await db.query("select version, name, md5(statements[1]) as md5, octet_length(statements[1]) as bytes from supabase_migrations.schema_migrations where name like 'release2%' order by version")).rows;
console.log(led);
expect("five forward ledger rows with A1 md5/bytes", led.length === 5 && led.map((x) => x.md5).join() ===
  "e97a5fd7c346a3b0a39bc6180dcfde46,734e0db7312b79081a769ca366c5b99a,302e05c6a4939eb8021234cbc7325473,2dcb03eb36e47c8404a29500151e8394,22b5010b9a3b20f5a3aaba4d212fd46c");
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
for (const n of ["01", "02", "03", "04", "05"]) { r = await run(db4, `P2-${n}`); if (!r.ok) throw new Error(r.error); }
for (const [f, re] of [["release2_05_revoke_enrollment", null], ["release2_04_staff_session_qualify_columns", /only inside operation RB-43/]]) {
  const text = git(`supabase/migrations/pending/${f}.rollback.sql`);
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

console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL PASS");
process.exit(failures ? 1 : 0);
