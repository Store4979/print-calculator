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
//   run G  the default ACLs on real catalog rows: the implicit sequence
//          default against a real sequence, a real global sequence row, and
//          a real GRANT, GRANT OPTION and REVOKE GRANT OPTION
//   run L  BUILD-00's guarded ledger read, each case in an ordinary and in a
//          read-only transaction: absent schema or table, empty, populated,
//          unsupported shapes, denied and hidden reads, real roles
// It writes each reading to the fixtures directory: the 01 reading whole,
// every other checked-state reading as its difference from it, and an
// index of every file's sha256. A FAIL line below names a case that did not
// give its expected value, and the process exits 1.
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
// run G: the default ACLs against real catalog rows. A reading's key letter is
// pg_default_acl's; acldefault's letter for a sequence differs from it.
const SEQ_OWNER = "postgres=SELECT/postgres,postgres=UPDATE/postgres,postgres=USAGE/postgres";
const fact = (rows, part, key) => rows.find((r) => r.part === part && r.key === key)?.value;
const rowDiff = (from, to) => {
  const key = (r) => JSON.stringify([r.part, r.key, r.value]);
  const a = new Set(from.map(key)), b = new Set(to.map(key));
  return { added: to.filter((r) => !a.has(key(r))), removed: from.filter((r) => !b.has(key(r))) };
};
{
  // A real sequence: once it has an ACL, its owner's entry is the implicit default.
  const db = await fresh();
  const build = await read(db, "BUILD-00");
  await db.exec("create schema acl_probe; create sequence acl_probe.s; grant usage on sequence acl_probe.s to anon;");
  const actual = (await db.query(`select string_agg(g.rolname || '=' || a.privilege_type || '/' || o.rolname, ',' order by a.privilege_type collate "C") as v
    from pg_class c cross join lateral aclexplode(c.relacl) a join pg_roles g on g.oid = a.grantee join pg_roles o on o.oid = a.grantor
   where c.oid = 'acl_probe.s'::regclass and a.grantee = c.relowner`)).rows[0].v;
  const implicit = fact(build, "defaults", "implicit|postgres|S");
  const foreignServer = (await db.query(`select string_agg(a.privilege_type, ',') as v from aclexplode(acldefault('S', (select oid from pg_roles where rolname = 'postgres'))) a`)).rows[0].v;
  save("g-seq-actual.json", { implicit, actual, foreignServer });
  say(implicit === actual && actual === SEQ_OWNER && foreignServer === "USAGE", "run G: BUILD-00's implicit sequence default is a real sequence owner's, not acldefault's foreign server");
}
{
  // A real global sequence row: the implicit default gives way to it.
  const db = await fresh();
  const before = await read(db, "BUILD-00");
  await db.exec("alter default privileges grant select on sequences to anon;");
  const d = rowDiff(before, await read(db, "BUILD-00"));
  save("g-seq-row-build00.json", d);
  say(fact(d.removed, "defaults", "implicit|postgres|S") === SEQ_OWNER && fact(d.added, "defaults", "row|postgres|*|S") === `anon=SELECT/postgres,${SEQ_OWNER}`, "run G: BUILD-00 with a global sequence row");
  const at = await at01();
  await at.exec("alter default privileges grant select on sequences to anon;");
  const rows = await read(at, "P0-4C");
  saveReading("g-seq-row.json", rows);
  say(fact(rows, 3, "row|postgres|*|S") === `anon=SELECT/postgres,${SEQ_OWNER}` && fact(rows, 3, "implicit|postgres|S") === undefined, "run G: the checked state with a global sequence row");
}
{
  // Real GRANT, GRANT OPTION and REVOKE GRANT OPTION: the same database's three readings.
  const FN = "PUBLIC=EXECUTE/postgres,anon=EXECUTE/postgres,postgres=EXECUTE/postgres";
  const FNG = "PUBLIC=EXECUTE/postgres,anon=EXECUTE*/postgres,postgres=EXECUTE/postgres";
  const db = await at01();
  await db.exec("alter default privileges grant execute on functions to anon;");
  const plain = await read(db, "P0-4C"), plainB = await read(db, "BUILD-00");
  await db.exec("alter default privileges grant execute on functions to anon with grant option;");
  const option = await read(db, "P0-4C"), optionB = await read(db, "BUILD-00");
  await db.exec("alter default privileges revoke grant option for execute on functions from anon;");
  const revoked = await read(db, "P0-4C"), revokedB = await read(db, "BUILD-00");
  saveReading("g-grant-plain.json", plain);
  saveReading("g-grant-option.json", option);
  saveReading("g-grant-revoked.json", revoked);
  save("g-grant-build00.json", { plain: plainB.filter((r) => r.part === "defaults"), option: rowDiff(plainB, optionB), revoked: rowDiff(plainB, revokedB) });
  say(fact(plain, 3, "row|postgres|*|f") === FN && fact(option, 3, "row|postgres|*|f") === FNG && fact(revoked, 3, "row|postgres|*|f") === FN, "run G: the checked state shows the grant option come and go");
  say(fact(plainB, "defaults", "row|postgres|*|f") === FN && fact(optionB, "defaults", "row|postgres|*|f") === FNG && fact(revokedB, "defaults", "row|postgres|*|f") === FN, "run G: BUILD-00 shows the grant option come and go");
}
{
  // The same for a schema's own ACL, which both texts read outside the preserved catalog block.
  const db = await at01();
  const before = fact(await read(db, "P0-4C"), 2, "schema|public"), beforeB = fact(await read(db, "BUILD-00"), "roles", "schema|public");
  await db.exec("grant usage on schema public to anon with grant option;");
  const rows = await read(db, "P0-4C");
  saveReading("g-schema-option.json", rows);
  const afterB = fact(await read(db, "BUILD-00"), "roles", "schema|public");
  say(before.includes("anon=USAGE,") && fact(rows, 2, "schema|public").includes("anon=USAGE*,") && beforeB.includes("anon=USAGE,") && afterB.includes("anon=USAGE*,"), "run G: public's own ACL shows the grant option");
}
// run L: BUILD-00's guarded ledger read, each case in an ordinary and in a
// read-only transaction, as the role named. A fixture holds both readings'
// `ledger` part.
const LEDGER_BODY = "select 'BODY-MARKER';";
const LEDGER_POPULATED = `${LEDGER}
  insert into supabase_migrations.schema_migrations (version, name, statements, created_by) values ('20260101000000', 'a <row> & name', array['${LEDGER_BODY.replaceAll("'", "''")}'], 'store4979@theupsstore.com');
  insert into supabase_migrations.schema_migrations (version, statements, idempotency_key) values ('20260102000000', array['one;', 'two;'], 'key-1');`;
const READER = "create role ledger_reader nologin; grant usage on schema auth, storage, extensions to ledger_reader;";
const CAN_READ = "grant usage on schema supabase_migrations to ledger_reader; grant select on supabase_migrations.schema_migrations to ledger_reader;";
const LEDGER_CASES = [
  ["absent-schema", "drop schema supabase_migrations;", null, "absent-schema"],
  ["absent-table", "", null, "absent-table"],
  ["empty", LEDGER, null, "empty"],
  ["populated", LEDGER_POPULATED, null, "populated"],
  ["extra-column", `${LEDGER_POPULATED} alter table supabase_migrations.schema_migrations add column extra text;`, null, "unsupported-shape"],
  ["missing-columns", "create table supabase_migrations.schema_migrations (version text primary key, statements text[], name text);", null, "unsupported-shape"],
  ["wrong-type", LEDGER.replace("statements text[]", "statements text"), null, "unsupported-shape"],
  ["view", `create table supabase_migrations.real_rows (version text not null, statements text[], name text, created_by text, idempotency_key text, rollback text[]);
    create view supabase_migrations.schema_migrations as select * from supabase_migrations.real_rows;`, null, "unsupported-shape"],
  ["denied-schema", `${LEDGER_POPULATED} ${READER}`, "ledger_reader", "denied-schema"],
  ["denied-read", `${LEDGER_POPULATED} ${READER} grant usage on schema supabase_migrations to ledger_reader;`, "ledger_reader", "denied-read"],
  ["hidden-read", `${LEDGER_POPULATED} ${READER} ${CAN_READ} alter table supabase_migrations.schema_migrations enable row level security;`, "ledger_reader", "hidden-read"],
  ["partial-read", `${LEDGER_POPULATED} ${READER} ${CAN_READ} alter table supabase_migrations.schema_migrations enable row level security;
    create policy one_row on supabase_migrations.schema_migrations for select using (version = '20260101000000');`, "ledger_reader", "hidden-read"],
  ["reader-empty", `${LEDGER} ${READER} ${CAN_READ}`, "ledger_reader", "empty"],
  ["reader-populated", `${LEDGER_POPULATED} ${READER} ${CAN_READ}`, "ledger_reader", "populated"],
];
const ledgerPart = async (db, role, readOnly) => {
  await db.exec(readOnly ? "begin read only" : "begin");
  try {
    if (role) await db.exec(`set local role ${role}`);
    return (await db.query(TEXTS["BUILD-00"])).rows.filter((r) => r.part === "ledger");
  } finally { await db.exec("rollback"); }
};
for (const [label, setup, role, status] of LEDGER_CASES) {
  const db = await fresh();
  if (setup) await db.exec(setup);
  const ordinary = await ledgerPart(db, role, false), readOnly = await ledgerPart(db, role, true);
  save(`l-${label}.json`, { ordinary, readOnly });
  say(fact(ordinary, "ledger", "status") === status && JSON.stringify(ordinary) === JSON.stringify(readOnly), `run L: ${label}: ${status}, and the same in a read-only transaction`);
}
{
  // The guard is what tells these from an empty ledger: the bare read shows no row, or fails.
  const bare = async (setup) => {
    const db = await fresh();
    await db.exec(setup);
    const ls = `select query_to_xml('select version from supabase_migrations.schema_migrations', true, false, '')::text as doc`;
    const owner = (await db.query(ls)).rows[0].doc;
    await db.exec("begin read only; set local role ledger_reader");
    const reader = await db.query(ls).then((r) => r.rows[0].doc, (e) => `error ${e.code}`);
    await db.exec("rollback");
    return { ownerSeesRow: owner.includes("<row>"), reader: reader.startsWith("error") ? reader : { seesRow: reader.includes("<row>") } };
  };
  const hidden = await bare(`${LEDGER_POPULATED} ${READER} ${CAN_READ} alter table supabase_migrations.schema_migrations enable row level security;`);
  const denied = await bare(`${LEDGER_POPULATED} ${READER} grant usage on schema supabase_migrations to ledger_reader;`);
  save("l-bare-controls.json", { hidden, denied });
  say(hidden.ownerSeesRow && hidden.reader.seesRow === false && denied.reader === "error 42501", "run L: without the guard, a hidden read looks empty and a denied one fails");
  // 01's real ledger, the 21 rows.
  const db = await at01();
  const rows = await ledgerPart(db, null, true);
  save("l-at01.json", rows);
  say(fact(rows, "ledger", "status") === "populated" && fact(rows, "ledger", "rows").split("<row>").length - 1 === 21, "run L: the database at 01: populated, 21 rows");
}
writeFileSync(join(OUT, "index.json"), JSON.stringify({ note: "Written by scripts/manual/stage0-item4c-local-pglite.mjs; each file's sha256. stage0-4c.test.js refuses a fixture that is not this.", files }, null, 2) + "\n");
console.log(`${Object.keys(files).length} fixtures written to ${OUT}`);
process.exit(failures ? 1 : 0);
