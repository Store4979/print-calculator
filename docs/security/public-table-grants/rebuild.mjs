// Review-only rebuild test (Ryan, 2026-10-20, item 4). Evidence only: not in
// `yarn test` or the build. Rebuilds the database from supabase/migrations/ in a local
// PostgreSQL 17.5 (PGlite 0.4.6, installed outside the repository, in-memory,
// no network), under the platform default privileges as they are today and as
// they will be from 2026-10-30, and checks what the app's roles can do.
//
// The Supabase shim is scripts/manual/stage0-local-pglite.mjs's, verbatim,
// except for its three default-privilege lines, which are the variable here:
//   old          tables, functions, sequences -> anon, authenticated, service_role
//                (what pg_default_acl holds on production today)
//   new          functions and sequences only: NEW TABLES GET NO GRANTS (the
//                2026-10-30 change as the notice states it, tables only)
//   new-strict   functions only: tables AND sequences lose theirs, which is
//                the change as changelog 45329 lists it
//   docs         none of the three: the opt-in snippet on the "Securing your
//                API" docs page, which also revokes function EXECUTE
//   docs-global  none, and new functions also lose PUBLIC EXECUTE
// Migrations: every top-level file of supabase/migrations/ at HEAD, in
// version order, read from git blobs; then, where stated, the parked draft
// docs/security/public-table-grants/record_public_table_grants.sql from the
// working tree. Production rows that predate phase_b_02 are inserted where
// the stage-0 harness inserts them.
//
// Usage: node rebuild.mjs <repo> <live-grants.json>
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const [repo, liveFile] = process.argv.slice(2);
const PG = "C:/Dev/print-calculator-main/node_modules/@electric-sql/pglite";
const { PGlite } = await import(pathToFileURL(join(PG, "dist/index.js")).href);
const { pgcrypto } = await import(pathToFileURL(join(PG, "dist/contrib/pgcrypto.js")).href);
const git = (...a) => execFileSync("git", ["-C", repo, ...a], { maxBuffer: 1 << 26 }).toString("utf8");
const live = JSON.parse(readFileSync(liveFile, "utf8"));

// The shim: read from the stage-0 harness at HEAD, not retyped.
const harness = git("show", "HEAD:scripts/manual/stage0-local-pglite.mjs");
const shimStart = harness.indexOf("const SHIM = `") + "const SHIM = `".length;
const SHIM = harness.slice(shimStart, harness.indexOf("`;", shimStart));
const DEFAULTS = {
  tables: "alter default privileges in schema public grant all on tables to anon, authenticated, service_role;",
  functions: "alter default privileges in schema public grant all on functions to anon, authenticated, service_role;",
  sequences: "alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;",
};
for (const line of Object.values(DEFAULTS)) if (!SHIM.includes(line)) throw new Error(`the shim no longer holds: ${line}`);
const shimFor = ({ keep, extra = "" }) => Object.entries(DEFAULTS).reduce((s, [k, line]) => (keep.includes(k) ? s : s.replace(line, `-- (${k} default removed for this run)`)), SHIM) + extra;
// docs: the opt-in snippet on supabase.com/docs/guides/api/securing-your-api
// (tables, functions and sequences, plus its in-schema PUBLIC revoke, which
// PostgreSQL ignores: a per-schema default cannot remove a global one).
// docs-global: the worst case, new functions also lose PUBLIC EXECUTE.
const VARIANTS = {
  old: { keep: ["tables", "functions", "sequences"] },
  new: { keep: ["functions", "sequences"] },
  "new-strict": { keep: ["functions"] },
  docs: { keep: [], extra: "\nalter default privileges in schema public revoke execute on functions from public;\n" },
  "docs-global": { keep: [], extra: "\nalter default privileges revoke execute on functions from public;\n" },
};

const migrations = git("ls-tree", "--name-only", "HEAD", "supabase/migrations/").split("\n").filter((p) => /\/\d{14}_[^/]+\.sql$/.test(p)).sort();
const draftPath = "docs/security/public-table-grants/record_public_table_grants.sql";
const draft = readFileSync(join(repo, draftPath), "utf8");

const OWNER = "11111111-1111-4111-8111-111111111111";
async function rebuild(variant, withDraft) {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(shimFor(VARIANTS[variant]));
  await db.exec(`insert into auth.users (instance_id, id, aud, role, email) values
    ('00000000-0000-0000-0000-000000000000', '${OWNER}', 'authenticated', 'authenticated', 'owner@example.invalid'),
    ('00000000-0000-0000-0000-000000000000', '22222222-2222-4222-8222-222222222222', 'authenticated', 'authenticated', 'store4979@theupsstore.com');`);
  for (const p of migrations) {
    try { await db.exec(git("show", `HEAD:${p}`)); } catch (e) { throw new Error(`${variant}: ${p}: ${e.message}`); }
    if (p.includes("20260722003606_")) {
      await db.exec(`insert into public.stores (slug, name) values ('store4979', 'The UPS Store #4979');
        insert into public.memberships (store_id, user_id, role) select id, '${OWNER}', 'owner' from public.stores where slug = 'store4979';
        insert into public.employees (name, pin, active) values ('Real Staff', '1234', true), ('Real Manager', '0842', true);`);
    }
  }
  if (withDraft) await db.exec(draft);
  return db;
}

// The same relation-grants query run on production (the report shows it).
const GRANTS = `select c.relname, c.relkind, pg_get_userbyid(c.relowner) as owner,
       c.relrowsecurity as rls, c.relforcerowsecurity as rls_forced,
       (c.relacl is null) as acl_is_default,
       coalesce(r.rolname, 'PUBLIC') as grantee,
       string_agg(a.privilege_type || case when a.is_grantable then '*' else '' end, ',' order by a.privilege_type) as privileges,
       string_agg(distinct pg_get_userbyid(a.grantor), ',') as grantors
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
left join pg_roles r on r.oid = a.grantee
where n.nspname = 'public' and c.relkind in ('r','p','v','m','f')
group by c.relname, c.relkind, c.relowner, c.relrowsecurity, c.relforcerowsecurity, (c.relacl is null), r.rolname
order by c.relname, grantee`;
const snapshot = async (db) => (await db.query(GRANTS)).rows;
// Function EXECUTE in public, extension members left out (the same query is
// run read-only on production).
const FUNCS = `select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as fn, p.prosecdef as secdef,
       string_agg(coalesce(r.rolname, 'PUBLIC'), ',' order by coalesce(r.rolname, 'PUBLIC')) as execute_to
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
left join pg_roles r on r.oid = a.grantee
where n.nspname = 'public' and a.privilege_type = 'EXECUTE'
  and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
group by p.oid, p.proname, p.prosecdef
order by 1`;
const funcs = async (db) => (await db.query(FUNCS)).rows;
const key = (r) => `${r.relname}|${r.grantee}`;
function diff(a, b) {
  const A = new Map(a.map((r) => [key(r), r])), B = new Map(b.map((r) => [key(r), r]));
  const out = [];
  for (const k of new Set([...A.keys(), ...B.keys()])) {
    const x = A.get(k), y = B.get(k);
    const fx = x ? `${x.privileges} rls=${x.rls}/${x.rls_forced}` : "(none)", fy = y ? `${y.privileges} rls=${y.rls}/${y.rls_forced}` : "(none)";
    if (fx !== fy) out.push({ table_grantee: k, left: fx, right: fy });
  }
  return out.sort((p, q) => p.table_grantee.localeCompare(q.table_grantee));
}

// The app's database operations, by role, in the shapes the client and the
// Netlify functions issue (inventory sites; netlify/functions/*.js). Zero-row
// forms check the privilege without data; the real-row forms exercise RLS too.
const CHECKS = [
  // anon: the signed-out app
  ["anon", "stores: select by slug", "select * from public.stores where slug = 'store4979'"],
  ["anon", "paper_types: select", "select * from public.paper_types where store_id = (select id from public.stores where slug = 'store4979') order by sort_order"],
  ["anon", "sheet_prices: select", "select * from public.sheet_prices where store_id = (select id from public.stores where slug = 'store4979')"],
  ["anon", "discounts: select", "select * from public.discounts where store_id = (select id from public.stores where slug = 'store4979')"],
  ["anon", "addons: select", "select * from public.addons where store_id = (select id from public.stores where slug = 'store4979')"],
  ["anon", "settings: select", "select * from public.settings where store_id = (select id from public.stores where slug = 'store4979')"],
  ["anon", "pending_jobs: count today", "select count(*) from public.pending_jobs where job_date = to_char(current_date, 'YYYY-MM-DD')"],
  ["anon", "pending_jobs: queue list", "select * from public.pending_jobs order by queue_number"],
  ["anon", "print_jobs: insert ... returning", "insert into public.print_jobs select * from public.print_jobs where false returning id, created_at"],
  ["anon", "print_jobs: list", "select * from public.print_jobs order by created_at desc"],
  ["anon", "orders: insert ... returning", "insert into public.orders select * from public.orders where false returning id, created_at"],
  ["anon", "orders: list", "select * from public.orders order by created_at desc limit 50"],
  ["anon", "verify_employee_pin rpc", "select * from public.verify_employee_pin((select id from public.stores where slug = 'store4979'), '1234')"],
  ["anon", "orders: a real row, RLS included", "REAL:orders"],
  ["anon", "print_jobs: a real row, RLS included", "REAL:print_jobs"],
  // authenticated: the signed-in owner (admin panel)
  ["authenticated", "stores: select + update", "select id from public.stores where slug = 'store4979'; update public.stores set name = name where slug = 'store4979'"],
  ["authenticated", "memberships: own role", `select role from public.memberships where user_id = '${OWNER}'`],
  ["authenticated", "paper_types: upsert, select, delete", "insert into public.paper_types select * from public.paper_types where false on conflict (store_id, kind, key) do update set key = excluded.key; select id, kind, key from public.paper_types; delete from public.paper_types where false"],
  ["authenticated", "sheet_prices: upsert", "insert into public.sheet_prices select * from public.sheet_prices where false on conflict (store_id, paper_type_id, sheet_key) do update set sheet_key = excluded.sheet_key"],
  ["authenticated", "discounts: delete + insert", "delete from public.discounts where false; insert into public.discounts select * from public.discounts where false"],
  ["authenticated", "addons: upsert", "insert into public.addons select * from public.addons where false on conflict (store_id, kind, key) do update set key = excluded.key"],
  ["authenticated", "settings: upsert", "insert into public.settings select * from public.settings where false on conflict (store_id, key) do update set key = excluded.key"],
  ["authenticated", "employees: select, insert, update", "select * from public.employees order by name; insert into public.employees select * from public.employees where false returning *; update public.employees set name = name where false"],
  ["authenticated", "orders: dashboard list", "select * from public.orders order by created_at desc limit 50"],
  // service_role: the Netlify functions
  ["service_role", "pending_jobs: function reads and writes", "select * from public.pending_jobs; insert into public.pending_jobs select * from public.pending_jobs where false; update public.pending_jobs set id = id where false; delete from public.pending_jobs where false"],
  ["service_role", "stores: send-print-job, register-job", "select * from public.stores where slug = 'store4979'"],
  ["service_role", "memberships: enroll-list, enroll-ticket-create", "select * from public.memberships"],
  ["service_role", "Release 2 tables", "select * from public.device_enrollments; select * from public.staff_sessions; insert into public.enrollment_tickets select * from public.enrollment_tickets where false; update public.staff_sessions set revoked_at = revoked_at where false"],
];

// A real row for a table: every NOT NULL column without a default gets a
// value of its type. store_id, org_id and employee_id are resolved here, as
// postgres, and sent as values, the way the app sends them (anon cannot read
// employees; the PIN login RPC hands the client its employee id).
async function realInsert(db, table) {
  const cols = (await db.query(`select column_name, data_type, udt_name from information_schema.columns
     where table_schema = 'public' and table_name = $1 and is_nullable = 'NO' and column_default is null and is_generated = 'NEVER' and identity_generation is null
     order by ordinal_position`, [table])).rows;
  const ids = (await db.query(`select s.id as store_id, s.org_id, (select e.id from public.employees e order by e.name limit 1) as employee_id
     from public.stores s where s.slug = 'store4979'`)).rows[0];
  const value = (c) => {
    if (c.column_name in ids && ids[c.column_name]) return `'${ids[c.column_name]}'`;
    if (c.data_type === "uuid") return "gen_random_uuid()";
    if (/int|numeric|double|real/.test(c.data_type)) return "1";
    if (c.data_type === "boolean") return "false";
    if (c.data_type === "jsonb" || c.data_type === "json") return "'{}'";
    if (c.data_type === "date") return "current_date";
    if (/timestamp/.test(c.data_type)) return "now()";
    if (c.data_type === "ARRAY") return "'{}'";
    return "'x'";
  };
  const names = cols.map((c) => c.column_name);
  return names.length
    ? `insert into public.${table} (${names.join(", ")}) values (${cols.map(value).join(", ")}) returning id, created_at`
    : `insert into public.${table} default values returning id, created_at`;
}
async function runChecks(db) {
  const out = [];
  for (const [role, name, sqlOrReal] of CHECKS) {
    const sql = sqlOrReal.startsWith("REAL:") ? await realInsert(db, sqlOrReal.slice(5)) : sqlOrReal;
    await db.exec("begin");
    let result = "ok";
    try {
      await db.exec(`set local role ${role};`);
      if (role === "authenticated") await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: OWNER, role: "authenticated" })]);
      await db.exec(sql);
    } catch (e) { result = `${e.code || "?"} ${String(e.message).split("\n")[0]}`; }
    await db.exec("rollback");
    out.push({ role, check: name, result });
  }
  return out;
}

const report = { engine: null, migrations: migrations.length, draft: draftPath, runs: {} };
for (const variant of Object.keys(VARIANTS)) {
  for (const withDraft of [false, true]) {
    const db = await rebuild(variant, withDraft);
    report.engine ??= (await db.query("select version() as v")).rows[0].v;
    const snap = await snapshot(db);
    const fns = await funcs(db);
    const checks = await runChecks(db);
    report.runs[`${variant}${withDraft ? " + draft" : ""}`] = {
      grantRows: snap.length,
      vsLive: diff(live.rows, snap),
      functions: fns,
      checksFailed: checks.filter((c) => c.result !== "ok"),
      checksPassed: checks.filter((c) => c.result === "ok").length,
      checks: checks.length,
      snapshot: snap,
    };
    await db.close();
  }
}
// No-op proof on a production-shaped database: the old-default rebuild, before
// and after the draft.
report.noOpOnOldDefault = diff(report.runs.old.snapshot, report.runs["old + draft"].snapshot);
// The lock each GRANT statement takes (pg_locks inside the transaction).
{
  const db = await rebuild("old", false);
  await db.exec("begin");
  await db.exec(draft);
  report.locksHeldByTheDraft = (await db.query(`select c.relname as relation, l.mode from pg_locks l
     join pg_class c on c.oid = l.relation join pg_namespace n on n.oid = c.relnamespace
     where l.locktype = 'relation' and l.pid = pg_backend_pid() and n.nspname = 'public' order by 1, 2`)).rows;
  await db.exec("rollback");
  await db.close();
}
for (const r of Object.values(report.runs)) delete r.snapshot;
console.log(JSON.stringify(report, null, 2));
