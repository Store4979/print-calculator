#!/usr/bin/env node
// Item 4(c)'s local runs (the implementation outline §3) in a REAL Postgres
// (PGlite, PG 17 compiled to WASM): a pre-review check and the source of the
// fixtures stage0-4c.test.js reads. NOT evidence about production or about
// the rehearsal project.
//
// It builds the database at 01 as the stage-0 harness builds its baseline
// (stage0-local-pglite.mjs): a minimal Supabase shim, the 20 baseline
// migrations with their ledger rows and the data that predates phase_b_02,
// then 01 at its production version. On it, with the texts assembled from
// the manifest:
//   run A  BUILD-00 and BUILD-00W on the shim alone (a fresh project)
//   run C  P0-4C, STATE-4C and WHO-4C at 01; then P2-02, P2-0304, P2-05,
//          RB-5, RB-43 and RB-2, each committed, with POST-4C and STATE-4C
//          after each
//   run D  RB-2 from a fresh 01–02, and RB-43 from a fresh 01–04 (§3.6)
//   run F  real GRANTs and membership changes at a state, then POST-4C:
//          the readings stage0-4c-compare.mjs must refuse (V-2's real half)
// It writes each reading to the fixtures directory: the 01 reading whole,
// every other checked-state reading as its difference from it, and an
// index of every file's sha256.
//
// WHAT IT CANNOT SHOW: Supabase's real roles (postgres is a superuser here),
// platform hooks, event triggers, the image, concurrency, the query route.
//
// PGlite is NOT a dependency of this repository. Install it outside the repo
// and point at it, as for stage0-local-pglite.mjs:
//   PGLITE_DIR=<dir>/node_modules/@electric-sql/pglite node scripts/manual/stage0-item4c-local-pglite.mjs [--out <dir>]
// The texts come from the manifest committed at HEAD, or, while authoring,
// from the file STAGE0_MANIFEST names.
import { pathToFileURL, fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = process.argv.slice(2);
const OUT = args.includes("--out") ? args[args.indexOf("--out") + 1] : join(REPO, "scripts", "tests", "fixtures", "stage0-4c");
if (!process.env.PGLITE_DIR) {
  process.stderr.write("set PGLITE_DIR to an installed @electric-sql/pglite package directory (see the header)\n");
  process.exit(2);
}
const { PGlite } = await import(pathToFileURL(join(process.env.PGLITE_DIR, "dist", "index.js")).href);
const { pgcrypto } = await import(pathToFileURL(join(process.env.PGLITE_DIR, "dist", "contrib", "pgcrypto.js")).href);
const A = await import(pathToFileURL(join(REPO, "scripts", "manual", "assemble-stage0.mjs")).href);
process.chdir(REPO);
const MANIFEST = process.env.STAGE0_MANIFEST ? JSON.parse(readFileSync(process.env.STAGE0_MANIFEST, "utf8")) : A.manifestAt("HEAD", REPO);
const TEXTS = A.assembleAll(MANIFEST, { cwd: REPO });
for (const k of A.TEXTS_4C) if (!TEXTS[k]) throw new Error(`the manifest assembles no ${k}`);
const blob = (id) => A.gitBlob(id, REPO).toString("utf8");

// The stage-0 harness's shim, with the two platform roles P0-4C names.
const SHIM = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create role authenticator noinherit login; create role supabase_read_only_user login;
grant anon, authenticated, service_role to postgres;
grant anon, authenticated, service_role to authenticator;
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
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`;
const LEDGER = `create table supabase_migrations.schema_migrations (version text not null primary key, statements text[], name text,
  created_by text, idempotency_key text unique, rollback text[]);`;

async function fresh() {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(SHIM);
  return db;
}
async function at01() {
  const db = await fresh();
  await db.exec(LEDGER);
  await db.exec(`insert into auth.users (instance_id, id, aud, role, email) values
    ('00000000-0000-0000-0000-000000000000', '11111111-1111-4111-8111-111111111111', 'authenticated', 'authenticated', 'owner@example.invalid'),
    ('00000000-0000-0000-0000-000000000000', '22222222-2222-4222-8222-222222222222', 'authenticated', 'authenticated', 'store4979@theupsstore.com');`);
  const one = MANIFEST.migrations.find((m) => m.n === "01");
  for (const row of [...MANIFEST.baselineLedger, { version: one.productionVersion, name: one.name, blob: one.blob }]) {
    const sql = blob(row.blob);
    await db.exec(sql);
    await db.query("insert into supabase_migrations.schema_migrations (version, name, statements, created_by) values ($1, $2, array[$3], $4)", [row.version, row.name, sql, A.LEDGER_CREATED_BY]);
    if (row.version === "20260722003606") {
      await db.exec(`insert into public.stores (slug, name) values ('store4979', 'The UPS Store #4979');
        insert into public.memberships (store_id, user_id, role) select id, '11111111-1111-4111-8111-111111111111', 'owner' from public.stores where slug = 'store4979';
        insert into public.employees (name, pin, active) values ('Real Staff', '1234', true), ('Real Manager', '0842', true);`);
    }
  }
  return db;
}
const read = async (db, text) => (await db.query(TEXTS[text])).rows;
async function step(db, name) {
  await new Promise((r) => setTimeout(r, 2100)); // the ledger rows of two steps are seconds apart
  try { await db.exec(TEXTS[name]); } catch (e) { await db.exec("rollback").catch(() => {}); throw new Error(`${name}: ${e.message}`); }
}

const files = {};
const save = (name, value) => {
  const text = JSON.stringify(value) + "\n";
  writeFileSync(join(OUT, name), text);
  files[name] = createHash("sha256").update(text).digest("hex");
};
const triple = (rows) => rows.map((r) => [r.part, r.key, r.value]);
let base = null;
/** A checked-state reading: the 01 reading whole, any other as its difference from it. */
const saveReading = (name, rows) => {
  const t = triple(rows);
  if (!base) { base = t; save(name, { base: true, rows: t }); return; }
  const key = (x) => `${x[0]}|${x[1]}`;
  const b = new Map(base.map((x) => [key(x), x[2]]));
  const n = new Map(t.map((x) => [key(x), x[2]]));
  save(name, {
    from: "c-01.json",
    set: t.filter((x) => b.get(key(x)) !== x[2]),
    drop: base.filter((x) => !n.has(key(x))).map((x) => [x[0], x[1]]),
  });
};

mkdirSync(OUT, { recursive: true });
let failures = 0;
const say = (ok, label) => { console.log(`${ok ? "PASS" : "FAIL"}  ${label}`); if (!ok) failures++; };

// run A: a fresh project.
{
  const db = await fresh();
  save("a-build00.json", await read(db, "BUILD-00"));
  save("a-build00w.json", await read(db, "BUILD-00W"));
  say(true, "run A: BUILD-00 and BUILD-00W on the shim alone");
}
// run C: from 01, the whole path.
{
  const db = await at01();
  saveReading("c-01.json", await read(db, "P0-4C"));
  save("c-01-state.json", await read(db, "STATE-4C"));
  save("c-01-who.json", await read(db, "WHO-4C-R-RO"));
  for (const s of ["P2-02", "P2-0304", "P2-05", "RB-5", "RB-43", "RB-2"]) {
    await step(db, s);
    saveReading(`c-${s}.json`, await read(db, "POST-4C"));
    save(`c-${s}-state.json`, await read(db, "STATE-4C"));
  }
  say(true, "run C: 01, then P2-02, P2-0304, P2-05, RB-5, RB-43 and RB-2, each committed and read");
}
// run D: the two histories the rehearsal does not reach.
// Each fresh database has its own data digests (timestamps, random ids), so
// each separate path also records its own 01 reading, its baseline.
for (const [label, steps] of [["d-RB-2-from-02", ["P2-02", "RB-2"]], ["d-RB-43-from-04", ["P2-02", "P2-0304", "RB-43"]]]) {
  const db = await at01();
  saveReading(`${label}-01.json`, await read(db, "P0-4C"));
  for (const s of steps) { await step(db, s); saveReading(`${label}-${s}.json`, await read(db, "POST-4C")); }
  save(`${label}-state.json`, await read(db, "STATE-4C"));
  say(true, `run D: ${steps.join(", ")}`);
}
// run F: real changes the comparator must refuse, each from a fresh path.
const F = [
  ["f-anon-exec-record-attempt-02", ["P2-02"], "grant execute on function public.release2_record_attempt(text, text, integer, integer, integer) to anon;"],
  ["f-authenticated-exec-css-04", ["P2-02", "P2-0304"], "grant execute on function public.release2_create_staff_session(uuid, uuid, bytea, bytea, timestamptz, timestamptz) to authenticated;"],
  ["f-authenticator-member-service-role-02", ["P2-02"], "grant service_role to supabase_read_only_user;"],
  // authenticator is NOINHERIT, so its grants default to inherit false: flip one to true.
  ["f-membership-inherit-02", ["P2-02"], "revoke authenticated from authenticator; grant authenticated to authenticator with inherit true;"],
  ["f-anon-select-stores-02", ["P2-02"], "revoke select on public.stores from anon;"],
  ["f-anon-exec-auth-uid-02", ["P2-02"], "revoke execute on function auth.uid() from public;"],
  // The migrations already revoke has_store_role from public and anon: grant it.
  ["f-anon-exec-other-function-02", ["P2-02"], "grant execute on function public.has_store_role(uuid, text[]) to anon;"],
];
for (const [label, steps, change] of F) {
  const db = await at01();
  saveReading(`${label}-01.json`, await read(db, "P0-4C"));
  for (const s of steps) await step(db, s);
  await db.exec(change);
  saveReading(`${label}.json`, await read(db, "POST-4C"));
  say(true, `run F: ${label}: ${change}`);
}
writeFileSync(join(OUT, "index.json"), JSON.stringify({ note: "Written by scripts/manual/stage0-item4c-local-pglite.mjs; each file's sha256. stage0-4c.test.js refuses a fixture that is not this.", files }, null, 2) + "\n");
console.log(`${Object.keys(files).length} fixtures written to ${OUT}`);
process.exit(failures ? 1 : 0);
