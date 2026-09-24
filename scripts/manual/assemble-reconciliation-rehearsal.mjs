#!/usr/bin/env node
// Assemble the STAGING Release 2 reconciliation rehearsal: one transaction that
// resets the Release 2 objects, applies the five COMMITTED migration files
// verbatim, proves 03's 42702 before 04 repairs it, runs every end-to-end call,
// and ends in ROLLBACK. Nothing persists.
//
// Why assembled rather than hand-written: the point of the reconciliation is
// that the committed bytes become the tested code, so the rehearsal must
// contain those bytes and nothing retyped. This script reads the files from the
// git index (HEAD), not the working tree, prints the md5 of each included file
// to stderr, and writes the SQL to stdout.
//
//   node scripts/manual/assemble-reconciliation-rehearsal.mjs > rehearsal.sql
//
// It never connects to a database.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

const FILES = [
  "supabase/staging/release2_reconciliation_reset.sql",
  "supabase/migrations/pending/release2_01_identity_schema.sql",
  "supabase/migrations/pending/release2_02_auth_attempts_fn.sql",
  "supabase/migrations/pending/release2_03_bind_and_atomicity.sql",
  "@42702",
  "supabase/migrations/pending/release2_04_staff_session_qualify_columns.sql",
  "supabase/migrations/pending/release2_05_revoke_enrollment.sql",
  "supabase/rehearsals/release2_reconciliation_proofs.sql",
];

// Between 03 and 04: the committed 03 must reproduce 42702 on a real call, so
// the rehearsal is seen to exercise the defect 04 repairs.
const PROVE_42702 = `
create temp table if not exists proof(n text, step text, outcome text) on commit drop;
do $$
declare t1 constant uuid := '5ee41000-0000-4000-8000-0000000000a1'; v_enr uuid; v_emp uuid; v_own uuid; r record;
begin
  select m.user_id into v_own from public.memberships m where m.store_id = t1 and m.role = 'owner' limit 1;
  insert into public.device_enrollments (store_id, org_id, label, device_token_hash, csrf_secret, created_by)
  select t1, s.org_id, 'reconciliation 42702 probe', extensions.gen_random_bytes(32), extensions.gen_random_bytes(32), v_own
    from public.stores s where s.id = t1
  returning id into v_enr;
  select e.id into v_emp from public.employees e where e.store_id = t1 and e.pin = '1102';
  begin
    select * into r from public.release2_create_staff_session(v_enr, v_emp, extensions.gen_random_bytes(32), extensions.gen_random_bytes(32), now() + interval '12 hours', now() + interval '1 hour');
    insert into proof values ('R0', 'committed 03 before 04 (expect 42702)', 'UNEXPECTED: ran');
  exception when others then
    insert into proof values ('R0', 'committed 03 before 04 (expect 42702)', '[' || sqlstate || '] ' || sqlerrm);
  end;
  delete from public.device_enrollments where id = v_enr;
end $$;
`;

const read = (p) => execFileSync("git", ["show", `HEAD:${p}`], { encoding: "buffer" });
const parts = ["begin;\n"];
for (const f of FILES) {
  if (f === "@42702") { parts.push(`\n-- ===== between 03 and 04 =====\n${PROVE_42702}\n`); continue; }
  const bytes = read(f);
  process.stderr.write(`${createHash("md5").update(bytes).digest("hex")}  ${bytes.length}  ${f}\n`);
  parts.push(`\n-- ===== ${f} (HEAD, verbatim) =====\n`, bytes.toString("utf8"), "\n");
}
parts.push("\nrollback;\n");
process.stdout.write(parts.join(""));
