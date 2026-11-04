// scripts/manual/stage0-item4c-local-base.mjs — what item 4(c)'s two local
// harnesses share: a real Postgres (PGlite, PG 17 compiled to WASM), the minimal
// Supabase shim, the database at 01 as the stage-0 harness builds it, and the
// texts assembled from the manifest. NOT evidence about production or about the
// rehearsal project. It writes nothing and is not in the guard chain.
//
// PGlite is NOT a dependency of this repository. Install it outside the repo and
// point at it with PGLITE_DIR. The texts come from the manifest committed at HEAD,
// or, while authoring, from the file STAGE0_MANIFEST names.
import { pathToFileURL, fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { readFileSync } from "node:fs";

export const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
if (!process.env.PGLITE_DIR) {
  process.stderr.write("set PGLITE_DIR to an installed @electric-sql/pglite package directory (see the header)\n");
  process.exit(2);
}
const { PGlite } = await import(pathToFileURL(join(process.env.PGLITE_DIR, "dist", "index.js")).href);
const { pgcrypto } = await import(pathToFileURL(join(process.env.PGLITE_DIR, "dist", "contrib", "pgcrypto.js")).href);
export const A = await import(pathToFileURL(join(REPO, "scripts", "manual", "assemble-stage0.mjs")).href);
process.chdir(REPO);
export const MANIFEST = process.env.STAGE0_MANIFEST ? JSON.parse(readFileSync(process.env.STAGE0_MANIFEST, "utf8")) : A.manifestAt("HEAD", REPO);
export const TEXTS = A.assembleAll(MANIFEST, { cwd: REPO });
for (const k of A.TEXTS_4C) if (!TEXTS[k]) throw new Error(`the manifest assembles no ${k}`);
export const blob = (id) => A.gitBlob(id, REPO).toString("utf8");

// The stage-0 harness's shim, with the two platform roles P0-4C names.
export const SHIM = `
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
export const LEDGER = `create table supabase_migrations.schema_migrations (version text not null primary key, statements text[], name text,
  created_by text, idempotency_key text unique, rollback text[]);`;

export async function fresh() {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(SHIM);
  return db;
}
export async function at01() {
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
export const read = async (db, text) => (await db.query(TEXTS[text])).rows;
export async function step(db, name) {
  await new Promise((r) => { setTimeout(r, 2100); }); // the ledger rows of two steps are seconds apart
  try { await db.exec(TEXTS[name]); } catch (e) { await db.exec("rollback").catch(() => {}); throw new Error(`${name}: ${e.message}`); }
}
