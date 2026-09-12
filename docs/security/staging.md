# Staging environment — Release 2 prerequisite

**Status: database and tenants stood up 2026-09-12. Netlify site, Auth config
and SMTP sink are NOT done yet — see "Outstanding" at the end.**

Staging exists because Netlify deploy previews currently run against
**production** Supabase, and Release 2 changes authentication and then removes
grants. Rehearsing that against live customer data is not acceptable.

---

## 1. Identity

| | value |
|---|---|
| Project name | `print-calculator-staging` |
| Project ref | `lboajqihpsfrokqvjgnl` |
| Organization | `dofrogiqvxgmmzprinqe` (same as production) |
| Region | `us-east-1` |
| Cost | **$10/month** — confirmed before creation |
| Production ref, for contrast | `gmxyisjjaxtpycsmmzef` — **never** the target of a staging command |

**Publishable (client-safe) key**: `sb_publishable_DEDmndmu9xmhNFeXTCbO6A_HE0EBkZ6`
(a legacy JWT `anon` key also exists). These are client-safe by design, like
production's committed values.

**The service-role key is NOT in this repo and must never be.** Read it from
the Supabase dashboard into the staging Netlify site's env vars only.

---

## 2. Schema replay — what was applied

All 20 files from `supabase/migrations/*.sql`, in ledger order.

**Excluded, deliberately:**

- the 8 `*.rollback.sql` companions — they undo what the forward files do
- everything in `supabase/migrations/pending/` — **B2 is on hold** and must not
  be applied here either, or staging stops representing production

### Verification 1 — content hashes

| result | count |
|---|---|
| byte-exact match with the repo file | **14** |
| differ **only** by the trailing newline | **6** |
| genuine mismatch | **0** |

The 6 are an artifact of how content passes through the migration tool, which
strips the file's final `\n`. Proven, not assumed: the repo file with its
trailing newline removed hashes to exactly what staging stored (e.g.
`create_print_jobs` — repo `6e95fdfc…` at 1807 bytes, repo-minus-newline
`bdc7cc81…` at 1806, staging `bdc7cc81…` at 1806).

**This is itself the argument for not trusting hashes.** A naive
`scripts/migration-md5.sh` comparison would report 6 failures on a schema that
is identical. Hashes prove statement text; they do not prove state.

### Verification 2 — state, object by object

Compared against the production evidence in `release-2-plan.md` Part 0:

| axis | result |
|---|---|
| public tables | **14**, same names |
| RLS | every table `rls=true forced=false`; `_archive_commission_columns` RLS on with **0 policies** |
| policies | all present with identical permissive mode, command, roles, `USING` and `WITH CHECK` |
| `anon` / `authenticated` table grants | `DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE` on all 14, plus `storage.objects` and `storage.buckets` — **matches production** |
| function ACLs | `verify_employee_pin` `{postgres,service_role,anon,authenticated}`, `has_store_role` `{postgres,authenticated,service_role}`, `employees_role_owner_only` and `set_updated_at` `{postgres,service_role}` — all match |
| realtime publication | `public.pending_jobs` |
| buckets | `customer-uploads` private / **no size limit** / **any MIME**; `job-files` private / 50 MB / 5 MIME types — matches |

### A finding from the replay

`pg_default_acl` on a **brand-new, empty** project already contains:

```
postgres objtype=r = {... anon=arwdDxtm/postgres, authenticated=arwdDxtm/postgres ...}
postgres objtype=f = {... anon=X/postgres,        authenticated=X/postgres        ...}
```

So the grant sprawl behind CLAUDE.md rule 4 — every new table reachable by
`anon`, every new function `anon`-executable at CREATE time — is a **Supabase
platform default, not something this project introduced**. That matters for
step 5.7: revoking the grants without changing the defaults fixes today's
tables and none of tomorrow's.

### Expected data differences (not drift)

Three migrations are data-dependent and matched nothing here, by design:

| migration | effect in staging |
|---|---|
| `phase_b_02_backfill_ups_org` | created the `ups-4979` org row; all `where slug='store4979'` clauses matched 0 rows — so **production's `bootstrap_secret_hash` was never written here** |
| `phase_b_03c_rotate_bootstrap_secret` | 0 rows, same reason |
| `store_mailbox_manager_membership` | 0 rows — no such `auth.users` row |
| `phase_e_01` role update | 0 rows — the hard-coded production employee UUID does not exist here |

The vestigial `ups-4979` organization row has no store attached and is left in
place so the ledger stays a faithful replay.

---

## 3. Two synthetic tenants

The cross-store rows in the Part 8 matrix are untestable on a single-tenant
database, and **a second tenant has never existed anywhere** until now.

| | T1 | T2 |
|---|---|---|
| org slug | `staging-t1` (plan `pro`) | `staging-t2` (plan `trial`) |
| store slug | `staging-t1-store` | `staging-t2-store` |
| manager PIN | `1101` | `2201` |
| staff PIN | `1102` | `2202` |
| employees / prices / orders / queue / print_jobs | 2 / 2 / 1 / 1 / 1 | 2 / 2 / 1 / 1 / 1 |

Seeded symmetrically on purpose: any asymmetry in a cross-tenant test result is
then a real finding rather than a seeding artifact. All data is **synthetic** —
`example.invalid` addresses, `555-…` numbers, placeholder file paths. **No
production customer data is copied into staging, ever.**

Both stores carry their own `bootstrap_secret_hash`, derived from
staging-only plaintext. Production's hash is not present.

---

## 4. Rules for using it

1. **Destructive probes run here, not in production.** The `TRUNCATE` and
   storage-deletion probes in the findings document ran against production
   inside `begin … rollback` before staging existed. That is not a precedent.
2. **Never point a staging command at `gmxyisjjaxtpycsmmzef`.** Check the ref.
3. **Reseed rather than repair.** If staging data drifts, re-run section 3's
   seed. It is `on conflict do nothing` throughout.
4. **Re-verify after any production migration.** Staging only proves something
   while it still matches. Re-run both verifications above.
5. **No service-role key in the repo.**

---

## 5. Outstanding before Release 2 testing can start

| # | item | why it blocks |
|---|---|---|
| 1 | **Second Netlify site** on this repo, env pointing at staging, previews attached to it | functions deploy per site; the legacy-URL probes (rows 37–41) need staging's own copies |
| 2 | **Auth config**: Site URL = the staging site, deploy-preview pattern in redirect URLs | the 2026-09-09 lockout came from a wrong Site URL; do not repeat it here |
| 3 | **Owner + manager Auth accounts** per tenant | `has_store_role` paths and the admin flows are untestable without them |
| 4 | **SMTP sink** (Mailpit or Ethereal) in the staging site's `SMTP_*` | a real relay in staging will eventually mail a real customer |
| 5 | Storage objects seeded into both buckets | storage denial tests (row 30) need objects to fail to read |

Items 1–4 need dashboard and Netlify access; they are the owner's to do or to
delegate. Nothing in Release 2 should be tested until they are done.
