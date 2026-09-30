#!/usr/bin/env node
// Assemble every SQL text that stage 0 runs against PRODUCTION — P0, P1, the
// five P2 wrappers and the four rollback operations
// (docs/security/release-2-stage-0-production-plan.md §E1–§E4, §A6).
//
// WHY ASSEMBLED, AND WHY PINNED: the reviewed bytes must be the executed bytes.
// The md5 of each output is pinned in docs/security/stage0-production-manifest.json,
// and scripts/tests/stage0-manifest.test.js re-assembles and compares. The
// reconciliation assembler this replaces was unpinned (plan §G).
//
// INPUTS ARE FROZEN BY CONTENT (review of d01b74a, N3). Every input is read by
// its git BLOB ID, taken from the manifest's `inputs` section: the five
// migrations, their five rollback companions, the proofs file and the 20-row
// production baseline ledger. It is never read by path, by HEAD or from the
// working tree. So:
//   - a Windows checkout's CRLF cannot change a byte;
//   - stage 0's own repository moves (pending/ to <version>_<name>.sql at P2,
//     rollback records appended after a rollback) change no output. A git mv
//     keeps the blob id, and the baseline is the manifest's, not whatever the
//     directory holds today;
//   - a shallow clone still assembles: the blobs are reachable from HEAD
//     wherever the files now live.
// Each blob read is checked against the manifest's md5 and byte count before
// it is used. The output is deterministic: no clock, no environment.
//
// WHAT THE WRAPPER DOES (plan §E1), per step, inside ONE transaction:
//   set_config(…, true) for lock_timeout / statement_timeout /
//   idle_in_transaction_session_timeout (and transaction_timeout on PG >= 17),
//   then ONE `DO` statement that asserts those settings are in force, checks
//   positive production identity, md5-checks each embedded file, asserts the
//   state before, EXECUTEs the file, asserts the state after, writes the
//   ledger row from the md5-checked literal, and checks the deadline. Any
//   failure raises, and the transaction rolls back. Whether a step committed is
//   decided by reading the ledger back, never by this script.
//
//   node scripts/manual/assemble-stage0.mjs --list     names + md5 (manifest at HEAD)
//   node scripts/manual/assemble-stage0.mjs P2-01      one text to stdout
//   node scripts/manual/assemble-stage0.mjs --manifest <file> --list   another manifest
//
// It never connects to a database.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const md5 = (s) => createHash("md5").update(typeof s === "string" ? Buffer.from(s, "utf8") : s).digest("hex");

const PEND = "supabase/migrations/pending/";
export const PROOFS = "supabase/rehearsals/release2_stage0_production_proofs.sql";

// A1 — the forward migrations, in apply order.
export const MIGRATIONS = [
  { n: "01", name: "release2_01_identity_schema", md5: "e97a5fd7c346a3b0a39bc6180dcfde46", bytes: 13720 },
  { n: "02", name: "release2_02_auth_attempts_fn", md5: "734e0db7312b79081a769ca366c5b99a", bytes: 6406 },
  { n: "03", name: "release2_03_bind_and_atomicity", md5: "302e05c6a4939eb8021234cbc7325473", bytes: 13062 },
  { n: "04", name: "release2_04_staff_session_qualify_columns", md5: "2dcb03eb36e47c8404a29500151e8394", bytes: 5858 },
  { n: "05", name: "release2_05_revoke_enrollment", md5: "22b5010b9a3b20f5a3aaba4d212fd46c", bytes: 5622 },
];

// A1a — the Release 2 function set after each migration: catalog signature,
// md5(prosrc), effective EXECUTE grantees.
const OWN = "postgres=EXECUTE,service_role=EXECUTE";
const OWN_AUTH = "authenticated=EXECUTE,postgres=EXECUTE,service_role=EXECUTE";
const CSS = "release2_create_staff_session(uuid, uuid, bytea, bytea, timestamp with time zone, timestamp with time zone)";
export const FUNCTIONS = {
  redeem: ["redeem_enrollment_ticket(bytea, bytea, bytea, text)", "c024388886897f01a1154d8d12dc8996", OWN],
  rec02: ["release2_record_attempt(text, text, integer, integer, integer)", "fa208910f744eead2bdd14445d1d89d8", OWN],
  clr02: ["release2_clear_lockout(text, text, uuid)", "f06f2b206a8f6675668ec43f1b6ec384", OWN_AUTH],
  clr03: ["release2_clear_lockout(text, text, uuid, uuid)", "b7f602cde969f2f2622c0d2343b1c249", OWN_AUTH],
  rec03: ["release2_record_attempt(text, text, integer, integer, integer)", "e67957595afcc7a51d7f8673000d9302", OWN],
  css03: [CSS, "bd6da6a2f80e13c7b20deab3b2c76e63", OWN],
  prune: ["release2_prune_auth_attempts(integer)", "ee254949f88474c58284b8a2c1ba3cb0", OWN],
  css04: [CSS, "d30da6d0c7a4d14e1bcb1b9fcace37d9", OWN],
  revoke: ["release2_revoke_enrollment(uuid, uuid, text)", "a464a43cc72537bb02b3e4a1d904f655", OWN],
};
export const STATE_AFTER = {
  "00": [],
  "01": ["redeem"],
  "02": ["redeem", "rec02", "clr02"],
  "03": ["redeem", "clr03", "rec03", "css03", "prune"],
  "04": ["redeem", "clr03", "rec03", "css04", "prune"],
  "05": ["redeem", "clr03", "rec03", "css04", "prune", "revoke"],
};
export const TABLES = ["device_enrollments", "enrollment_tickets", "staff_sessions", "upload_capabilities", "upload_capability_files", "auth_attempts"];

// A6 — the rollback operations. Files run in the listed order in ONE transaction.
export const ROLLBACK_OPS = [
  { op: "RB-5", files: ["05"] },
  { op: "RB-43", files: ["04", "03"], marker: "RB-43" },
  { op: "RB-2", files: ["02"] },
  { op: "RB-1", files: ["01"] },
];

// E2 identity markers.
export const PRODUCTION_REF = "gmxyisjjaxtpycsmmzef";
export const STAGING_SEED_STORE = "5ee41000-0000-4000-8000-0000000000a1";
export const PROBE_SLUG = "r2-probe-nonexistent";

export const git = (rev, path, cwd) => execFileSync("git", ["show", `${rev}:${path}`], { maxBuffer: 1 << 26, cwd });
/** A blob's bytes by its id. */
export const gitBlob = (id, cwd) => execFileSync("git", ["cat-file", "blob", id], { maxBuffer: 1 << 26, cwd });
// Where the inputs lived when they were frozen (before any stage-0 move).
export const migrationPath = (m) => `${PEND}${m.name}.sql`;
export const rollbackPath = (m) => `${PEND}${m.name}.rollback.sql`;

/**
 * The frozen inputs, read by blob id from the manifest and checked against its
 * md5 and byte count. `readBlob(id)` defaults to `git cat-file blob` in `cwd`.
 */
export function sourceFromManifest(manifest, { cwd, readBlob = (id) => gitBlob(id, cwd) } = {}) {
  const get = (entry, label) => {
    const b = readBlob(entry.blob);
    if (md5(b) !== entry.md5 || b.length !== entry.bytes) throw new Error(`${label}: blob ${entry.blob} differs from the manifest's md5/bytes`);
    return b.toString("utf8");
  };
  const byN = (list, n) => { const e = list.find((x) => x.n === n); if (!e) throw new Error(`no manifest entry ${n}`); return e; };
  const ledger = manifest.baselineLedger.map((r) => ({ version: r.version, name: r.name, md5: r.md5 }));
  return {
    migration: (m) => get(byN(manifest.migrations, m.n), m.name),
    rollback: (m) => get(byN(manifest.rollbacks, m.n), `${m.name}.rollback.sql`),
    proofs: () => get(manifest.proofs, PROOFS),
    ledger: () => ledger,
  };
}

/** The manifest as committed at `rev` (default HEAD). */
export function manifestAt(rev = "HEAD", cwd) {
  return JSON.parse(git(rev, "docs/security/stage0-production-manifest.json", cwd).toString("utf8"));
}

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

// ── SQL fragments ────────────────────────────────────────────────────────────
function identityGuard(rows, tag) {
  const values = rows.map((r) => `      (${q(r.version)}, ${q(r.name)}, ${q(r.md5)})`).join(",\n");
  return `  -- Positive production identity (plan §E2): production's ${rows.length} ledger rows with
  -- their committed md5s; the staging seed store absent; store4979 present.
  if (select count(*) from (values
${values}
      ) as want(version, name, body_md5)
      where not exists (select 1 from supabase_migrations.schema_migrations m
                         where m.version = want.version and m.name = want.name
                           and md5(m.statements[1]) = want.body_md5)) <> 0 then
    raise exception '${tag}: production''s ledger rows are absent or differ — not production; refusing' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.stores s where s.id = ${q(STAGING_SEED_STORE)}) then
    raise exception '${tag}: the staging seed store exists — this is staging; refusing' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.stores s where s.slug = 'store4979') then
    raise exception '${tag}: store4979 is absent — not production; refusing' using errcode = 'P0001';
  end if;
`;
}

function fnState(key, tag, label) {
  const want = STATE_AFTER[key].map((k) => FUNCTIONS[k]);
  const wantSql = want.length
    ? `(values\n${want.map(([i, m, a]) => `        (${q(i)}, ${q(m)}, ${q(a)})`).join(",\n")}\n      ) as w(ident, body_md5, acl)`
    : `(select null::text, null::text, null::text where false) as w(ident, body_md5, acl)`;
  return `  -- ${label}: the Release 2 functions are EXACTLY plan §A1a's "after ${key}" set.
  if (with have as (
        select p.proname || '(' || oidvectortypes(p.proargtypes) || ')' as ident, md5(p.prosrc) as body_md5,
               (select string_agg(coalesce(r.rolname, 'PUBLIC') || '=' || a.privilege_type, ','
                                  order by coalesce(r.rolname, 'PUBLIC'), a.privilege_type)
                  from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                  left join pg_roles r on r.oid = a.grantee) as acl
          from pg_proc p
         where p.pronamespace = 'public'::regnamespace
           and (p.proname like 'release2\\_%' or p.proname = 'redeem_enrollment_ticket')),
      want as (select * from ${wantSql})
      select count(*) from ((select * from have except select * from want)
                            union all (select * from want except select * from have)) d) <> 0 then
    raise exception '${tag}: ${label} — the Release 2 functions differ from plan §A1a "after ${key}"' using errcode = 'P0001';
  end if;
  if exists (select 1 from pg_proc p
              where p.pronamespace = 'public'::regnamespace
                and (p.proname like 'release2\\_%' or p.proname = 'redeem_enrollment_ticket')
                and (not p.prosecdef or p.proconfig is distinct from array['search_path=public']
                     or obj_description(p.oid, 'pg_proc') is null)) then
    raise exception '${tag}: ${label} — a Release 2 function lacks SECURITY DEFINER, search_path=public or its comment' using errcode = 'P0001';
  end if;
`;
}

function tableState(present, tag, label) {
  const list = TABLES.map(q).join(", ");
  if (!present) {
    return `  if exists (select 1 from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname in (${list}))
     or exists (select 1 from pg_constraint k where k.conname = 'employees_id_store_uniq') then
    raise exception '${tag}: ${label} — a Release 2 table or employees_id_store_uniq already exists' using errcode = 'P0001';
  end if;
`;
  }
  return `  if (select count(*) from pg_class c
       where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relname in (${list})
         and c.relrowsecurity
         and not exists (select 1 from pg_policy pol where pol.polrelid = c.oid)
         and (select array_agg(distinct coalesce(r.rolname::text, 'PUBLIC') order by coalesce(r.rolname::text, 'PUBLIC'))
                from aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
                left join pg_roles r on r.oid = a.grantee) = array['postgres', 'service_role']) <> ${TABLES.length}
     or (select pg_get_constraintdef(k.oid) from pg_constraint k
          where k.conrelid = 'public.employees'::regclass and k.conname = 'employees_id_store_uniq')
        is distinct from 'UNIQUE (id, store_id)' then
    raise exception '${tag}: ${label} — the six tables (RLS on, 0 policies, grantees postgres + service_role) or employees_id_store_uniq are not as 01 leaves them' using errcode = 'P0001';
  end if;
`;
}

// Review of d01b74a, N5: the hard timer is transaction_timeout, which exists
// only from PG 17. The settings line sets it unconditionally (an older server
// rejects the parameter, and the text stops there, before any DDL). This
// assert requires PG 17 and the timer in force; P0 stops on pg17_hard_timer
// false. statement_timeout bounds ONE statement; the deadline checks are
// boundary checks that interrupt nothing.
const SETTINGS_ASSERT = (tag, t = { lock: ["3s"], statement: ["45s", "90s"], tx: ["45s", "110s"], modes: ["P1", "P2", "RB"] }) => `  if current_setting('server_version_num')::int < 170000
     or current_setting('lock_timeout') not in (${t.lock.map(q).join(", ")})
     or current_setting('statement_timeout') not in (${t.statement.map(q).join(", ")})
     or current_setting('transaction_timeout') not in (${t.tx.map(q).join(", ")})
     or current_setting('idle_in_transaction_session_timeout') <> '10s'
     or current_setting('release2.stage0_mode', true) not in (${t.modes.map(q).join(", ")}) then
    raise exception '${tag}: the stage-0 timeouts (PG 17 transaction_timeout included) are not in force in this transaction' using errcode = 'P0001';
  end if;
`;

const DEADLINE = (tag) => `  if clock_timestamp() - transaction_timestamp()
     > make_interval(secs => current_setting('release2.stage0_deadline_s')::int) then
    raise exception '${tag}: the transaction deadline was exceeded' using errcode = 'P0001';
  end if;
`;

// The ledger row, written from the md5-checked literal. In the rolled-back
// rehearsal (P1) ten rows are written within a second or two, so a version
// that is not after the head is bumped; for real (P2, RB) it stops.
// THE LEDGER ROW SHAPE (review of d01b74a, N6). Read back read-only from
// staging's schema_migrations on 2026-09-29, the table has six columns:
//   version text NOT NULL (PK), statements text[], name text,
//   created_by text, idempotency_key text (UNIQUE), rollback text[]
// All nullable except version, none with a default. Every one of the 31 rows
// apply_migration wrote there has statements = one element [1:1] holding the
// file's exact bytes, created_by = the authorizing account's email (one
// distinct value), and idempotency_key and rollback null. list_migrations
// lists every row by (version, name). The wrapper writes that same shape.
// P0 reads production's column list and created_by values, and stops if
// either differs from what is pinned here and in the manifest (ledgerRow).
export const LEDGER_CREATED_BY = "store4979@theupsstore.com";
export const LEDGER_COLUMNS = "version:text:NO:, statements:ARRAY:YES:, name:text:YES:, created_by:text:YES:, idempotency_key:text:YES:, rollback:ARRAY:YES:";

// A second row in the same transaction (RB-43) is stamped one second later.
const LEDGER_INSERT = (varName, name, tag, offsetSeconds = 0, table = "supabase_migrations.schema_migrations") => `  v_head := (select max(m.version) from ${table} m);
  v_version := to_char((clock_timestamp() at time zone 'utc')${offsetSeconds ? ` + interval '${offsetSeconds} second'` : ""}, 'YYYYMMDDHH24MISS');
  if v_version <= v_head then
    if current_setting('release2.stage0_mode') = 'P1' then
      v_version := (v_head::numeric + 1)::text;
    else
      raise exception '${tag}: version % is not after the ledger head %; refusing', v_version, v_head using errcode = 'P0001';
    end if;
  end if;
  insert into ${table} (version, name, statements, created_by)
  values (v_version, ${q(name)}, array[${varName}], ${q(LEDGER_CREATED_BY)});
  -- The row must have apply_migration's shape (N6): one element [1:1] holding
  -- the checked bytes, created_by set, idempotency_key and rollback null.
  if not exists (select 1 from ${table} m
                  where m.version = v_version and m.name = ${q(name)}
                    and cardinality(m.statements) = 1 and array_lower(m.statements, 1) = 1
                    and md5(m.statements[1]) = md5(${varName}) and octet_length(m.statements[1]) = octet_length(${varName})
                    and m.created_by = ${q(LEDGER_CREATED_BY)}
                    and m.idempotency_key is null and m.rollback is null) then
    raise exception '${tag}: the ledger row does not have apply_migration''s shape' using errcode = 'P0001';
  end if;
`;

function fileLiteral(text, label) {
  if (text.includes("$stage0_")) throw new Error(`${label} contains the reserved dollar-quote prefix $stage0_`);
  return `$stage0_file$${text}$stage0_file$`;
}

function forwardWrapper(src, m, rows) {
  const text = src.migration(m);
  if (md5(text) !== m.md5 || Buffer.byteLength(text) !== m.bytes) throw new Error(`${m.name}: git bytes differ from A1`);
  const tag = `stage0 P2-${m.n}`;
  const prev = String(Number(m.n) - 1).padStart(2, "0");
  return `do $stage0_wrap$
declare
  f constant text := ${fileLiteral(text, m.name)};
  v_head text;
  v_version text;
begin
${SETTINGS_ASSERT(tag)}${identityGuard(rows, tag)}  if md5(f) <> ${q(m.md5)} or octet_length(f) <> ${m.bytes} then
    raise exception '${tag}: the embedded bytes differ from the manifest' using errcode = 'P0001';
  end if;
  if exists (select 1 from supabase_migrations.schema_migrations m where m.name = ${q(m.name)}) then
    raise exception '${tag}: ${m.name} is already in the ledger' using errcode = 'P0001';
  end if;
${fnState(prev, tag, "state before")}${tableState(m.n !== "01", tag, "state before")}  execute f;
${fnState(m.n, tag, "state after")}${tableState(true, tag, "state after")}${LEDGER_INSERT("f", m.name, tag)}${DEADLINE(tag)}end
$stage0_wrap$;
`;
}

// ── N7 (review of dc5a88b): 03 and 04 are ONE forward transaction ───────────
// 03 alone is the 42702 defect, and RB-43 already treats the pair as one. A
// separately committed 03 with no 04 would leave a state that no reviewed
// rollback reverses (RB-43 needs 04's row; RB-2 needs the after-02 state).
// P2-0304 therefore:
//   - checks both files' md5 and bytes before executing either;
//   - asserts the after-02 state, executes 03 then 04, asserts the after-04
//     state;
//   - writes 03's ledger row and then 04's, one second later (the RB-43
//     technique), each with apply_migration's shape.
// Any failure rolls back both files and both rows, leaving the after-02 state.
export const P2_STEPS = [
  { step: "P2-01", files: ["01"] },
  { step: "P2-02", files: ["02"] },
  { step: "P2-0304", files: ["03", "04"] },
  { step: "P2-05", files: ["05"] },
];

function forwardWrapperMulti(src, ns, rows, tag) {
  const ms = ns.map((n) => MIGRATIONS.find((x) => x.n === n));
  const decl = [], gate = [], run = [];
  ms.forEach((m, i) => {
    const text = src.migration(m);
    if (md5(text) !== m.md5 || Buffer.byteLength(text) !== m.bytes) throw new Error(`${m.name}: git bytes differ from A1`);
    decl.push(`  f${i + 1} constant text := ${fileLiteral(text, m.name)};`);
    gate.push(`  if md5(f${i + 1}) <> ${q(m.md5)} or octet_length(f${i + 1}) <> ${m.bytes} then
    raise exception '${tag}: the embedded bytes of ${m.name} differ from the manifest' using errcode = 'P0001';
  end if;
  if exists (select 1 from supabase_migrations.schema_migrations m where m.name = ${q(m.name)}) then
    raise exception '${tag}: ${m.name} is already in the ledger' using errcode = 'P0001';
  end if;
`);
    run.push(`  execute f${i + 1};\n`);
  });
  const prev = String(Number(ns[0]) - 1).padStart(2, "0");
  const last = ns[ns.length - 1];
  const ledger = ms.map((m, i) => LEDGER_INSERT(`f${i + 1}`, m.name, tag, i)).join("");
  return `do $stage0_wrap$
declare
${decl.join("\n")}
  v_head text;
  v_version text;
begin
${SETTINGS_ASSERT(tag)}${identityGuard(rows, tag)}${gate.join("")}${fnState(prev, tag, "state before")}${tableState(prev !== "00", tag, "state before")}${run.join("")}${fnState(last, tag, "state after")}${tableState(true, tag, "state after")}${ledger}${DEADLINE(tag)}end
$stage0_wrap$;
`;
}

// ── N7: recovery by committed prefix, decided by read-back ───────────────────
// The EFFECTIVE committed prefix is the forward rows in the ledger (with A1's
// md5) minus those a later rollback row undid. Each prefix has exactly one
// reviewed recovery sequence. Any other combination — a prefix that is not
// one of these, a catalog that does not match the prefix, a forward row with
// the wrong md5 — is STOP: no operation is chosen, and it returns to review.
export const RECOVERY = [
  { prefix: [], state: "00", ops: [] },
  { prefix: ["01"], state: "01", ops: ["RB-1"] },
  { prefix: ["01", "02"], state: "02", ops: ["RB-2", "RB-1"] },
  { prefix: ["01", "02", "03", "04"], state: "04", ops: ["RB-43", "RB-2", "RB-1"] },
  { prefix: ["01", "02", "03", "04", "05"], state: "05", ops: ["RB-5", "RB-43", "RB-2", "RB-1"] },
];

function stateReadback(rows) {
  const keys = ["00", "01", "02", "03", "04", "05"];
  const have = `(select p.proname || '(' || oidvectortypes(p.proargtypes) || ')' as ident, md5(p.prosrc) as body_md5,
               (select string_agg(coalesce(r.rolname, 'PUBLIC') || '=' || a.privilege_type, ','
                                  order by coalesce(r.rolname, 'PUBLIC'), a.privilege_type)
                  from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                  left join pg_roles r on r.oid = a.grantee) as acl
          from pg_proc p
         where p.pronamespace = 'public'::regnamespace
           and (p.proname like 'release2\\_%' or p.proname = 'redeem_enrollment_ticket'))`;
  const want = (k) => {
    const w = STATE_AFTER[k].map((f) => FUNCTIONS[f]);
    return w.length
      ? `(values ${w.map(([i, m, a]) => `(${q(i)}, ${q(m)}, ${q(a)})`).join(", ")})`
      : `(select null::text, null::text, null::text where false)`;
  };
  const matchCols = keys.map((k) => `(select count(*) = 0 from ((select * from h except select * from ${want(k)} as w${k}(ident, body_md5, acl))
          union all (select * from ${want(k)} as v${k}(ident, body_md5, acl) except select * from h)) d) as s${k}`).join(",\n       ");
  const fwd = MIGRATIONS.map((m) => `(${q(m.n)}, ${q(m.name)}, ${q(m.md5)})`).join(", ");
  const rec = RECOVERY.map((r) => `(${q(r.prefix.join(","))}, ${q(r.state)}, ${q(r.ops.join(", ") || "none — nothing is applied")})`).join(", ");
  return `-- STATE — READ-ONLY (plan §A6/F4, review of dc5a88b N7). Run it BEFORE choosing any recovery, and
-- whenever a step's outcome is unknown (a lost response, a dropped connection, a timeout reported by the
-- client). It derives the effective committed prefix from the ledger, checks the catalog matches it, and
-- names the one reviewed recovery sequence for that prefix — or STOP.
with led as (
  select f.n, f.name, f.body_md5,
         (select m.version from supabase_migrations.schema_migrations m where m.name = f.name order by m.version desc limit 1) as fwd_version,
         (select count(*) from supabase_migrations.schema_migrations m where m.name = f.name) as fwd_rows,
         (select count(*) from supabase_migrations.schema_migrations m where m.name = f.name and md5(m.statements[1]) = f.body_md5) as fwd_rows_md5_ok,
         (select m.version from supabase_migrations.schema_migrations m where m.name = f.name || '_rollback' order by m.version desc limit 1) as rb_version
    from (values ${fwd}) as f(n, name, body_md5)
),
eff as (
  select coalesce(string_agg(n, ',' order by n) filter (where fwd_version is not null and (rb_version is null or rb_version < fwd_version)), '') as prefix,
         bool_and(fwd_rows = fwd_rows_md5_ok) as md5_ok
    from led
),
h as ${have},
cat as (
  select ${matchCols}
),
cat_state as (
  select case when s05 then '05' when s04 then '04' when s03 then '03' when s02 then '02' when s01 then '01'
              when s00 and (select count(*) from pg_class c where c.relnamespace = 'public'::regnamespace
                              and c.relname in (${TABLES.map(q).join(", ")})) = 0 then '00'
              else 'unrecognized' end as state
    from cat
),
recovery(prefix, state, ops) as (values ${rec})
select (select prefix from eff) as effective_prefix,
       (select md5_ok from eff) as ledger_md5_ok,
       (select state from cat_state) as catalog_state,
       (select json_agg(json_build_object('n', n, 'forward', fwd_version, 'rollback', rb_version) order by n) from led) as ledger_rows,
       coalesce((select r.ops from recovery r, eff, cat_state
                  where r.prefix = eff.prefix and r.state = cat_state.state and eff.md5_ok), 'STOP — no reviewed recovery for this ledger/catalog combination; return to review') as recovery;
`;
}

function rollbackWrapper(src, op, rows) {
  const tag = `stage0 ${op.op}`;
  const decl = [], body = [];
  op.files.forEach((n, i) => {
    const m = MIGRATIONS.find((x) => x.n === n);
    const text = src.rollback(m);
    decl.push(`  f${i + 1} constant text := ${fileLiteral(text, rollbackPath(m))};`);
    body.push(`  if md5(f${i + 1}) <> ${q(md5(text))} or octet_length(f${i + 1}) <> ${Buffer.byteLength(text)} then
    raise exception '${tag}: the embedded bytes of ${m.name}.rollback.sql differ from the manifest' using errcode = 'P0001';
  end if;
`);
  });
  const run = op.files.map((n, i) => {
    const m = MIGRATIONS.find((x) => x.n === n);
    return `  execute f${i + 1};\n${LEDGER_INSERT(`f${i + 1}`, `${m.name}_rollback`, tag, i)}`;
  }).join("");
  const marker = op.marker
    ? [`  perform set_config('release2.rollback_op', ${q(op.marker)}, true);\n`, `  perform set_config('release2.rollback_op', '', true);\n`]
    : ["", ""];
  return `do $stage0_wrap$
declare
${decl.join("\n")}
  v_head text;
  v_version text;
begin
${SETTINGS_ASSERT(tag)}${identityGuard(rows, tag)}${body.join("")}${marker[0]}${run}${marker[1]}${DEADLINE(tag)}end
$stage0_wrap$;
`;
}

function settings(name, mode, statementTimeout, deadline, txTimeout) {
  return `select set_config('application_name', ${q(`release2-stage0-${name}`)}, true),
       set_config('lock_timeout', '3s', true),
       set_config('statement_timeout', ${q(statementTimeout)}, true),
       set_config('idle_in_transaction_session_timeout', '10s', true),
       set_config('release2.stage0_mode', ${q(mode)}, true),
       set_config('release2.stage0_deadline_s', ${q(String(deadline))}, true);
-- The hard timer. transaction_timeout exists only from PG 17: an older server
-- rejects this parameter and the text stops here, before any DDL (N5).
select set_config('transaction_timeout', ${q(txTimeout)}, true);
`;
}

/** The proofs file split at its section markers, plus the catalog-rows query. */
export function proofSections(src) {
  const text = src.proofs();
  const parts = text.split(/^-- @@stage0-proofs section (\d[a-z]?):.*$/m);
  const sections = {};
  const order = [];
  for (let i = 1; i < parts.length; i += 2) { sections[parts[i]] = parts[i + 1]; order.push(parts[i]); }
  if (order.join(",") !== "0,1,1b,2,3,4") throw new Error("proofs: expected sections 0, 1, 1b, 2, 3, 4 in order");
  const cat = /^-- @@catalog-rows begin\n([\s\S]*?)^-- @@catalog-rows end$/m.exec(text);
  if (!cat) throw new Error("proofs: catalog-rows markers not found");
  return { text, sections, catalogRows: cat[1] };
}

function p0(rows, catalogRows) {
  const values = rows.map((r) => `      (${q(r.version)}, ${q(r.name)}, ${q(r.md5)})`).join(",\n");
  const tables = TABLES.map(q).join(", ");
  return `-- P0 — read-only preconditions and positive identity (plan §E2). One statement.
-- Out of band first: the MCP project_id is ${PRODUCTION_REF}, and get_project_url returns
-- https://${PRODUCTION_REF}.supabase.co.
select
  -- P0-S: schema and data (restorable)
  to_regprocedure('public.has_store_role(uuid,text[])') is not null as has_store_role,
  to_regclass('public.organizations') is not null as organizations,
  exists (select 1 from information_schema.columns
           where table_schema = 'public' and table_name = 'stores' and column_name = 'org_id') as stores_org_id,
  (select count(*) from public.stores s where s.org_id is null) as stores_without_org,
  (select coalesce(array_agg(s.id order by s.id), '{}') from public.stores s where s.org_id is null) as stores_without_org_ids,
  exists (select 1 from pg_constraint k where k.conname = 'employees_id_store_uniq') as uniq_already_there,
  (select count(*) from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname in (${tables})) as release2_tables_present,
  (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
      and (p.proname like 'release2\\_%' or p.proname = 'redeem_enrollment_ticket')) as release2_functions_present,
  (select md5(coalesce(string_agg(c.kind || E'\\t' || c.ident || E'\\t' || c.fact, E'\\n' order by c.kind, c.ident, c.fact), ''))
     from (
${catalogRows}     ) c) as catalog_fingerprint,
  not exists (select 1 from public.stores s where s.slug = ${q(PROBE_SLUG)}) as probe_slug_absent,
  not exists (select 1 from public.pending_jobs j where j.id = '00000000-0000-0000-0000-000000000000') as nil_job_absent,
  (select count(*) from pg_trigger t where t.tgrelid = 'auth.users'::regclass and not t.tgisinternal) as auth_users_user_triggers,
  (select count(*) from generate_series(1000, 9999) g
    where not exists (select 1 from public.employees e where e.pin = lpad(g::text, 4, '0'))) as free_pins,
  current_setting('server_version_num')::int as server_version_num,
  current_setting('server_version_num')::int >= 170000 as pg17_hard_timer,
  -- P0-L: the ledger (append-only)
  (select max(m.version) from supabase_migrations.schema_migrations m) as ledger_head,
  (select count(*) from supabase_migrations.schema_migrations m) as ledger_rows,
  (select count(*) = 0 from (
     (select m.version, m.name, md5(m.statements[1]) from supabase_migrations.schema_migrations m
      except select * from (values
${values}
      ) as want(version, name, body_md5))
     union all
     (select * from (values
${values}
      ) as want(version, name, body_md5)
      except select m.version, m.name, md5(m.statements[1]) from supabase_migrations.schema_migrations m)) d) as ledger_matches_repo,
  (select count(*) from supabase_migrations.schema_migrations m where m.name like 'release2\\_%') as release2_in_ledger,
  (select string_agg(c.column_name || ':' || c.data_type || ':' || c.is_nullable || ':' || coalesce(c.column_default, ''), ', '
                     order by c.ordinal_position)
     from information_schema.columns c
    where c.table_schema = 'supabase_migrations' and c.table_name = 'schema_migrations') as ledger_columns,
  -- N6: the shape the wrapper writes must be the shape this ledger holds.
  (select string_agg(c.column_name || ':' || c.data_type || ':' || c.is_nullable || ':' || coalesce(c.column_default, ''), ', '
                     order by c.ordinal_position)
     from information_schema.columns c
    where c.table_schema = 'supabase_migrations' and c.table_name = 'schema_migrations') = ${q(LEDGER_COLUMNS)} as ledger_columns_as_pinned,
  -- via to_jsonb so that a ledger WITHOUT the column still answers (null) rather than erroring
  (select coalesce(array_agg(distinct to_jsonb(m) ->> 'created_by' order by to_jsonb(m) ->> 'created_by'), '{}')
     from supabase_migrations.schema_migrations m) as ledger_created_by,
  (select bool_and(cardinality(m.statements) = 1 and array_lower(m.statements, 1) = 1)
     from supabase_migrations.schema_migrations m) as ledger_rows_single_element,
  -- identity markers
  exists (select 1 from supabase_migrations.schema_migrations m
           where m.version = '20260909232836' and m.name = 'phase_e_03_order_margin_snapshot'
             and md5(m.statements[1]) = 'b7a8e54c99432c5e0ddb60be4c46505f') as production_ledger_marker,
  not exists (select 1 from public.stores s where s.id = ${q(STAGING_SEED_STORE)}) as staging_seed_absent,
  exists (select 1 from public.stores s where s.slug = 'store4979') as production_store_present;
`;
}

// SIZE-PROBE (plan §C3, Ryan's decision 2): ONE harmless read-only SELECT,
// 1 KiB larger than P1, sent through the same SQL tool on staging to confirm
// the tool accepts a text of P1's size before P1 is ever sent. It reads no
// table and changes nothing: it returns the byte length and md5 of its own
// literal, which the manifest pins as the expected answer.
export const SIZE_PROBE_HEAD =
  "-- SIZE-PROBE: harmless, read-only (plan C3). One SELECT larger than P1; it reads no table.\n" +
  "select octet_length(s.x) as probe_bytes, md5(s.x) as probe_md5 from (select $probe$";
export const SIZE_PROBE_TAIL = "$probe$::text as x) s;\n";
export const SIZE_PROBE_LINE = "stage0 size probe: reads nothing, changes nothing.\n";
export function sizeProbe(p1Bytes) {
  const target = p1Bytes + 1024;
  const room = target - Buffer.byteLength(SIZE_PROBE_HEAD) - Buffer.byteLength(SIZE_PROBE_TAIL);
  const filler = SIZE_PROBE_LINE.repeat(Math.ceil(room / SIZE_PROBE_LINE.length)).slice(0, room);
  return { text: SIZE_PROBE_HEAD + filler + SIZE_PROBE_TAIL, literal: filler };
}

// ── N5: the staging two-session lock rehearsal ───────────────────────────────
// A throwaway schema on STAGING ONLY (stage0_lockprobe: a table t and a ledger
// of the real ledger's shape). The session-B texts are the P2 wrapper pattern:
// the same settings line, settings assert, md5 gate, EXECUTE, ledger insert,
// shape assert and deadline. They differ in exactly these ways:
//   - their own guard: staging seed store present, production marker absent;
//   - their own table and ledger;
//   - scaled timeouts where a scenario needs one to fire in reasonable time;
//   - one handler around the whole body that re-raises with the SQLSTATE,
//     the elapsed ms and the backend pid. The re-raise aborts the transaction
//     exactly as the P2 wrapper's unhandled error does.
// The production identity guard is untouched and never applied here.
export const LOCKPROBE_FILE = "alter table stage0_lockprobe.t add constraint t_id_uniq unique (id);\n";
const LOCKPROBE_GUARD = (tag) => `  if not exists (select 1 from public.stores s where s.id = ${q(STAGING_SEED_STORE)}) then
    raise exception '${tag}: the staging seed store is absent — this rehearsal runs on staging only; refusing' using errcode = 'P0001';
  end if;
  if exists (select 1 from supabase_migrations.schema_migrations m
              where m.version = '20260909232836' and m.name = 'phase_e_03_order_margin_snapshot'
                and md5(m.statements[1]) = 'b7a8e54c99432c5e0ddb60be4c46505f') then
    raise exception '${tag}: the production ledger marker is present — not staging; refusing' using errcode = 'P0001';
  end if;
  if to_regclass('stage0_lockprobe.t') is null or to_regclass('stage0_lockprobe.ledger') is null then
    raise exception '${tag}: run LOCKPROBE-SETUP first' using errcode = 'P0001';
  end if;
`;
function lockProbeSession(name, { waitForHolder = false, sleepAfter = 0, lock = "3s", statement = "45s", tx = "45s", deadline = 40 }) {
  const tag = `lockprobe ${name}`;
  const f = LOCKPROBE_FILE;
  const wait = waitForHolder ? `  -- a CONFLICTING lock must be held by another backend before the DDL is tried
  for i in 1..100 loop
    exit when exists (select 1 from pg_locks l where l.relation = 'stage0_lockprobe.t'::regclass
                        and l.granted and l.pid <> pg_backend_pid());
    perform pg_sleep(0.1);
  end loop;
  if not exists (select 1 from pg_locks l where l.relation = 'stage0_lockprobe.t'::regclass and l.granted and l.pid <> pg_backend_pid()) then
    raise exception '${tag}: no holder seen within 10 s — the sessions did not overlap; nothing was tried' using errcode = 'P0001';
  end if;
` : "";
  const hold = sleepAfter ? `  perform pg_sleep(${sleepAfter});   -- the lock from the DDL is held here\n` : "";
  return `-- ${name} — staging two-session lock rehearsal, session B (plan §E8, N5). STAGING ONLY.
begin;
${settings(`lockprobe-${name}`, "P2", statement, deadline, tx).replace("set_config('lock_timeout', '3s', true)", `set_config('lock_timeout', ${q(lock)}, true)`)}do $stage0_wrap$
declare
  f constant text := ${fileLiteral(f, "LOCKPROBE_FILE")};
  v_head text;
  v_version text;
  v_t0 timestamptz := clock_timestamp();
begin
${SETTINGS_ASSERT(tag, { lock: [lock], statement: [statement], tx: [tx], modes: ["P2"] })}${LOCKPROBE_GUARD(tag)}  if md5(f) <> ${q(md5(f))} or octet_length(f) <> ${Buffer.byteLength(f)} then
    raise exception '${tag}: the embedded bytes differ' using errcode = 'P0001';
  end if;
${wait}  v_t0 := clock_timestamp();
  execute f;
${hold}${LEDGER_INSERT("f", "lockprobe", tag, 0, "stage0_lockprobe.ledger")}${DEADLINE(tag)}exception
  -- query_canceled (57014: statement timeout, pg_cancel_backend) is NOT matched
  -- by OTHERS in PL/pgSQL, so it is named. A transaction_timeout ends the
  -- session (FATAL) and cannot be caught at all.
  when query_canceled then
    raise exception '${tag}: [%] % — after % ms, backend %', sqlstate, sqlerrm,
      round(extract(epoch from clock_timestamp() - v_t0) * 1000), pg_backend_pid() using errcode = sqlstate;
  when others then
    raise exception '${tag}: [%] % — after % ms, backend %', sqlstate, sqlerrm,
      round(extract(epoch from clock_timestamp() - v_t0) * 1000), pg_backend_pid() using errcode = sqlstate;
end
$stage0_wrap$;
commit;
`;
}
function lockProbeTexts() {
  return {
    "LOCKPROBE-SETUP": `-- LOCKPROBE-SETUP — STAGING ONLY (plan §E8, N5): a throwaway schema, never a real table.
do $g$ begin
  if not exists (select 1 from public.stores s where s.id = ${q(STAGING_SEED_STORE)}) then
    raise exception 'lockprobe setup: not staging; refusing' using errcode = 'P0001'; end if;
  if to_regnamespace('stage0_lockprobe') is not null then
    raise exception 'lockprobe setup: stage0_lockprobe already exists; clean up first' using errcode = 'P0001'; end if;
end $g$;
create schema stage0_lockprobe;
create table stage0_lockprobe.t (id int);
insert into stage0_lockprobe.t values (1), (2);
create table stage0_lockprobe.ledger (version text not null primary key, statements text[], name text,
  created_by text, idempotency_key text unique, rollback text[]);
insert into stage0_lockprobe.ledger (version, name, statements, created_by) values ('20000101000000', 'baseline', array['-- baseline'], ${q(LEDGER_CREATED_BY)});
select 'stage0_lockprobe ready' as setup;
`,
    // Session A: a READER, as a counter PIN lookup is, holding ACCESS SHARE for 15 s.
    "LOCKPROBE-HOLD": `-- LOCKPROBE-HOLD — session A (STAGING ONLY): a reader holding ACCESS SHARE on the probe table for 15 s,
-- as a counter PIN lookup holds it on employees. Conflicts with the ACCESS EXCLUSIVE the DDL needs.
begin;
select set_config('application_name', 'release2-stage0-lockprobe-holder', true);
lock table stage0_lockprobe.t in access share mode;
select pg_sleep(15);
commit;
`,
    // 1. B meets a held lock: lock_timeout 3 s must refuse it (55P03).
    "LOCKPROBE-B-LOCKTIMEOUT": lockProbeSession("B-LOCKTIMEOUT", { waitForHolder: true }),
    // 2a. B holds the lock past statement_timeout (8 s here): 57014, released.
    "LOCKPROBE-B-STMTTIMEOUT": lockProbeSession("B-STMTTIMEOUT", { sleepAfter: 30, statement: "8s", tx: "20s", deadline: 20 }),
    // 2b. B holds the lock past transaction_timeout (8 s) with statement_timeout 50 s: the PG 17 hard timer.
    // (Not 60 s: PostgreSQL displays 60s as "1min", and the settings assert compares the display text —
    // it failed closed on staging with 60s, 2026-09-29. Every production value displays as itself.)
    "LOCKPROBE-B-TXTIMEOUT": lockProbeSession("B-TXTIMEOUT", { sleepAfter: 30, statement: "50s", tx: "8s", deadline: 20 }),
    // 2c. B holds the lock and is cancelled by C (statement_timeout 30 s as the backstop).
    "LOCKPROBE-B-CANCEL": lockProbeSession("B-CANCEL", { sleepAfter: 60, statement: "30s", tx: "45s", deadline: 40 }),
    "LOCKPROBE-C-CANCEL": `-- LOCKPROBE-C-CANCEL — session C (STAGING ONLY): find session B holding ACCESS EXCLUSIVE on the probe
-- table (by application_name), cancel it with pg_cancel_backend, and report who and when.
do $c$
declare v_pid int; v_t0 timestamptz := clock_timestamp();
begin
  for i in 1..150 loop
    -- pg_stat_activity is snapshotted once per transaction (stats_fetch_consistency
    -- = cache); without clearing it, this loop would reread its first snapshot.
    perform pg_stat_clear_snapshot();
    select a.pid into v_pid from pg_stat_activity a join pg_locks l on l.pid = a.pid
     where a.application_name = 'release2-stage0-lockprobe-B-CANCEL'
       and l.relation = 'stage0_lockprobe.t'::regclass and l.mode = 'AccessExclusiveLock' and l.granted
     limit 1;
    exit when v_pid is not null;
    perform pg_sleep(0.1);
  end loop;
  if v_pid is null then raise exception 'lockprobe C: session B never held the lock within 15 s' using errcode = 'P0001'; end if;
  perform set_config('lockprobe.cancelled_pid', v_pid::text, true);
  perform set_config('lockprobe.cancelled_ok', pg_cancel_backend(v_pid)::text, true);
  perform set_config('lockprobe.waited_ms', round(extract(epoch from clock_timestamp() - v_t0) * 1000)::text, true);
end $c$;
select current_setting('lockprobe.cancelled_pid') as cancelled_pid, current_setting('lockprobe.cancelled_ok') as pg_cancel_backend,
       current_setting('lockprobe.waited_ms') as found_after_ms, pg_backend_pid() as canceller_pid;
`,
    // 3. The positive control: no holder, the same wrapper commits.
    "LOCKPROBE-B-POSITIVE": lockProbeSession("B-POSITIVE", {}),
    "LOCKPROBE-READBACK": `-- LOCKPROBE-READBACK (STAGING ONLY, read-only): DDL, ledger rows, locks and backends on the probe.
select
  exists (select 1 from pg_constraint k where k.conrelid = 'stage0_lockprobe.t'::regclass and k.conname = 't_id_uniq') as ddl_committed,
  (select json_agg(json_build_object('version', m.version, 'name', m.name, 'n', cardinality(m.statements),
          'md5', md5(m.statements[1]), 'created_by', m.created_by) order by m.version) from stage0_lockprobe.ledger m) as ledger,
  (select coalesce(json_agg(json_build_object('pid', l.pid, 'mode', l.mode, 'granted', l.granted,
          'app', (select a.application_name from pg_stat_activity a where a.pid = l.pid))), '[]'::json)
     from pg_locks l where l.relation in ('stage0_lockprobe.t'::regclass, 'stage0_lockprobe.ledger'::regclass)
      and l.pid <> pg_backend_pid()) as locks,
  (select coalesce(json_agg(json_build_object('pid', a.pid, 'app', a.application_name, 'state', a.state,
          'xact_start', a.xact_start, 'backend_start', a.backend_start)), '[]'::json)
     from pg_stat_activity a where a.application_name like 'release2-stage0-lockprobe%') as lockprobe_backends,
  now() as read_at;
`,
    "LOCKPROBE-CLEANUP": `-- LOCKPROBE-CLEANUP (STAGING ONLY): drop ONLY the rehearsal schema, then show nothing is left.
do $g$ begin
  if not exists (select 1 from public.stores s where s.id = ${q(STAGING_SEED_STORE)}) then
    raise exception 'lockprobe cleanup: not staging; refusing' using errcode = 'P0001'; end if;
end $g$;
drop schema stage0_lockprobe cascade;
select to_regnamespace('stage0_lockprobe') is null as schema_gone,
       (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'stage0_lockprobe') as relations_left,
       (select count(*) from pg_locks l join pg_stat_activity a on a.pid = l.pid
         where a.application_name like 'release2-stage0-lockprobe%' and l.pid <> pg_backend_pid()) as probe_locks_left,
       (select count(*) from pg_stat_activity a where a.application_name like 'release2-stage0-lockprobe%' and a.state <> 'idle') as probe_backends_active;
`,
  };
}

// ── The second-caller cancel procedure (plan §E8; review of dc5a88b, non-blocking) ──
// One caller's execute_sql calls are serialized, so a running stage-0 text can
// only be cancelled from a SECOND caller. CANCEL-INSPECT (read-only) lists every
// backend running a stage-0 text with its exact backend_start and its locks.
// CANCEL-STEP is a pinned TEMPLATE: `--cancel <step> <backend_start>` checks it
// against the manifest's md5, validates both values and substitutes them. That
// is the reviewed way to produce its text; nothing stops a hand edit, which is
// why the text re-validates both values itself.
export const CANCEL_TARGETS = ["P1", ...P2_STEPS.map((s) => s.step), ...ROLLBACK_OPS.map((o) => o.op)].map((n) => `release2-stage0-${n}`);
export const BACKEND_START_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const BACKEND_START = (col) => `to_char(${col} at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
export const CANCEL_APP = "@@CANCEL_APPLICATION_NAME@@";
export const CANCEL_START = "@@CANCEL_BACKEND_START@@";

function cancelTexts() {
  return {
    "CANCEL-INSPECT": `-- CANCEL-INSPECT — READ-ONLY, from a SECOND caller while a stage-0 text is in flight (plan §E8).
-- Every backend running a stage-0 text (application_name release2-stage0-…), never the caller: its exact
-- backend_start (the value CANCEL-STEP needs), its state, and every lock it holds or awaits; and every lock
-- on public.employees. Run it BEFORE CANCEL-STEP to choose the ONE target, and AFTER it to read back the
-- outcome; then run STATE.
select pg_stat_clear_snapshot();
select
  (select coalesce(json_agg(json_build_object(
          'pid', a.pid, 'application_name', a.application_name,
          'backend_start', ${BACKEND_START("a.backend_start")},
          'xact_start', a.xact_start, 'state', a.state,
          'wait_event_type', a.wait_event_type, 'wait_event', a.wait_event,
          'locks', (select coalesce(json_agg(json_build_object('locktype', l.locktype, 'relation', l.relation::regclass::text,
                                                               'mode', l.mode, 'granted', l.granted)
                                             order by l.granted desc, l.mode), '[]'::json)
                      from pg_locks l where l.pid = a.pid))
          order by a.backend_start), '[]'::json)
     from pg_stat_activity a
    where a.application_name like 'release2-stage0-%' and a.pid <> pg_backend_pid()) as stage0_backends,
  (select coalesce(json_agg(json_build_object('application_name', t.app, 'backends', t.n) order by t.app), '[]'::json)
     from (select a.application_name as app, count(*) as n from pg_stat_activity a
            where a.application_name like 'release2-stage0-%' and a.pid <> pg_backend_pid()
            group by a.application_name) t) as backends_per_name,
  (select coalesce(json_agg(json_build_object('pid', l.pid, 'mode', l.mode, 'granted', l.granted,
          'application_name', (select a.application_name from pg_stat_activity a where a.pid = l.pid)) order by l.pid), '[]'::json)
     from pg_locks l where l.relation = 'public.employees'::regclass and l.pid <> pg_backend_pid()) as employees_locks,
  pg_backend_pid() as caller_pid,
  clock_timestamp() as read_at;
`,
    "CANCEL-STEP-TEMPLATE": `-- CANCEL-STEP — from a SECOND caller only (plan §E8). Instantiate it with
-- \`node scripts/manual/assemble-stage0.mjs --cancel <step> <backend_start>\`, which checks this template
-- against its pinned md5 and validates both values; never edit the placeholders by hand. Shown to Ryan
-- before it runs.
-- It cancels ONE backend: the exact application_name of a stage-0 step AND the exact backend_start that
-- CANCEL-INSPECT reported, never the caller. On zero matches or more than one, nothing is cancelled.
-- It uses pg_cancel_backend only, never pg_terminate_backend: the target's transaction aborts and releases its locks.
-- The match and the signal are two statements. A target that ends between them makes pg_cancel_backend
-- return false; PID reuse inside that window is not prevented. Read back with CANCEL-INSPECT, then STATE.
do $stage0_cancel$
declare
  v_app   constant text := '${CANCEL_APP}';
  v_start constant text := '${CANCEL_START}';
  v_n     int;
  v_pid   int;
begin
  if v_app not in (${CANCEL_TARGETS.map(q).join(", ")}) then
    raise exception 'stage0 cancel: % is not a stage-0 step; nothing was cancelled', v_app using errcode = 'P0001';
  end if;
  if v_start !~ ${q(BACKEND_START_RE.source)} then
    raise exception 'stage0 cancel: backend_start % is not in CANCEL-INSPECT''s format; nothing was cancelled', v_start using errcode = 'P0001';
  end if;
  perform pg_stat_clear_snapshot();
  select count(*), min(a.pid) into v_n, v_pid
    from pg_stat_activity a
   where a.application_name = v_app
     and ${BACKEND_START("a.backend_start")} = v_start
     and a.pid <> pg_backend_pid();
  if v_n = 0 then
    raise exception 'stage0 cancel: no backend is % started at % (it has ended, or a value is wrong); nothing was cancelled — run CANCEL-INSPECT and STATE', v_app, v_start using errcode = 'P0001';
  end if;
  if v_n > 1 then
    raise exception 'stage0 cancel: % backends are % started at %; ambiguous, nothing was cancelled', v_n, v_app, v_start using errcode = 'P0001';
  end if;
  perform set_config('stage0.cancel_pid', v_pid::text, false);
  perform set_config('stage0.cancel_sent', pg_cancel_backend(v_pid)::text, false);
end
$stage0_cancel$;
select current_setting('stage0.cancel_pid') as cancelled_pid, current_setting('stage0.cancel_sent') as pg_cancel_backend,
       pg_backend_pid() as caller_pid, clock_timestamp() as sent_at;
`,
  };
}

/** CANCEL-STEP from the pinned template: a known stage-0 step and CANCEL-INSPECT's exact backend_start, or a throw. */
export function cancelStepText(template, step, backendStart) {
  const app = `release2-stage0-${step}`;
  if (!CANCEL_TARGETS.includes(app)) throw new Error(`--cancel: "${step}" is not a stage-0 step; one of ${CANCEL_TARGETS.map((x) => x.slice("release2-stage0-".length)).join(", ")}`);
  if (typeof backendStart !== "string" || !BACKEND_START_RE.test(backendStart)) throw new Error("--cancel: backend_start must be exactly as CANCEL-INSPECT prints it (YYYY-MM-DDTHH:MM:SS.ffffffZ)");
  if (template.split(CANCEL_APP).length !== 2 || template.split(CANCEL_START).length !== 2) throw new Error("--cancel: the template does not carry each placeholder exactly once");
  return template.replace(CANCEL_APP, app).replace(CANCEL_START, backendStart);
}

/**
 * Every stage-0 SQL text, by name, from the manifest's frozen inputs.
 * Deterministic: the same manifest inputs give the same bytes, wherever the
 * files live in the repository at the time.
 */
export function assembleAll(manifest, opts = {}) {
  const src = sourceFromManifest(manifest, opts);
  const rows = src.ledger();
  const { sections, catalogRows } = proofSections(src);
  // The P2 step bodies (N7: 03 and 04 are one step), plus 03 ALONE, which
  // only P1 uses, inside a savepoint it rolls back, to show 03's 42702.
  const W = {
    "01": forwardWrapper(src, MIGRATIONS[0], rows),
    "02": forwardWrapper(src, MIGRATIONS[1], rows),
    "0304": forwardWrapperMulti(src, ["03", "04"], rows, "stage0 P2-0304"),
    "05": forwardWrapper(src, MIGRATIONS[4], rows),
  };
  const W03alone = forwardWrapper(src, MIGRATIONS[2], rows);
  const RB = Object.fromEntries(ROLLBACK_OPS.map((op) => [op.op, rollbackWrapper(src, op, rows)]));
  const out = {};
  out.P0 = p0(rows, catalogRows);
  out.P1 = [
    "-- P1 — rehearsal of 01–05, proofs and rollbacks on production, ONE transaction, ROLLBACK (plan §E3).\n",
    "begin isolation level repeatable read;\n",
    settings("P1", "P1", "90s", 100, "110s"),
    "\n-- ===== proofs section 0 =====", sections["0"],
    "\n-- ===== P2-01 body =====\n", W["01"],
    "\n-- ===== P2-02 body =====\n", W["02"],
    "\n-- ===== proofs section 1 =====", sections["1"],
    "\n-- ===== 03 ALONE, in a savepoint (never a P2 step): its 42702, then undone =====\nsavepoint stage0_03_alone;\n", W03alone,
    "\n-- ===== proofs section 1b =====", sections["1b"],
    "\nrollback to savepoint stage0_03_alone;\nrelease savepoint stage0_03_alone;\n",
    "\n-- ===== P2-0304 body =====\n", W["0304"],
    "\n-- ===== P2-05 body =====\n", W["05"],
    "\n-- ===== proofs section 2 =====", sections["2"],
    "\n-- ===== proofs section 3 =====", sections["3"],
    ...ROLLBACK_OPS.flatMap((op) => [`\n-- ===== ${op.op} =====\n`, RB[op.op]]),
    "\n-- ===== proofs section 4 =====", sections["4"],
    "\nrollback;\n",
  ].join("");
  out["SIZE-PROBE"] = sizeProbe(Buffer.byteLength(out.P1)).text;
  for (const s of P2_STEPS) {
    const names = s.files.map((n) => MIGRATIONS.find((x) => x.n === n).name).join(" + ");
    out[s.step] = `-- ${s.step} — apply ${names} to production${s.files.length > 1 ? " in ONE transaction (N7)" : ""} (plan §E1, §E4).\nbegin;\n${settings(s.step, "P2", "45s", 40, "45s")}${W[s.files.join("")]}commit;\n`;
  }
  out.STATE = stateReadback(rows);
  Object.assign(out, cancelTexts());
  Object.assign(out, lockProbeTexts());
  for (const op of ROLLBACK_OPS) {
    out[op.op] = `-- ${op.op} — rollback operation (plan §A6, §F4). Before P6 only.\nbegin;\n${settings(op.op, "RB", "45s", 40, "45s")}${RB[op.op]}commit;\n`;
  }
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  let manifest;
  const i = args.indexOf("--manifest");
  if (i >= 0) { manifest = JSON.parse(readFileSync(args[i + 1], "utf8")); args.splice(i, 2); }
  else manifest = manifestAt("HEAD");
  const all = assembleAll(manifest);
  if (args[0] === "--cancel") {
    const t = all["CANCEL-STEP-TEMPLATE"];
    const pin = manifest.outputs && manifest.outputs["CANCEL-STEP-TEMPLATE"];
    if (!pin || md5(t) !== pin.md5 || Buffer.byteLength(t) !== pin.bytes) {
      process.stderr.write("--cancel: the CANCEL-STEP template does not match the manifest's pin; refusing\n");
      process.exit(2);
    }
    try { process.stdout.write(cancelStepText(t, args[1], args[2])); }
    catch (e) { process.stderr.write(`${e.message}\n`); process.exit(2); }
  } else if (args[0] === "--list" || !args.length) {
    for (const [k, v] of Object.entries(all)) process.stdout.write(`${md5(v)}  ${String(Buffer.byteLength(v)).padStart(7)}  ${k}\n`);
  } else if (all[args[0]] !== undefined) {
    process.stdout.write(all[args[0]]);
  } else {
    process.stderr.write(`unknown output ${args[0]}; one of: ${Object.keys(all).join(", ")}\n`);
    process.exit(2);
  }
}
