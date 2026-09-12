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

### Verification 1 — content hashes (raw, unmodified)

| result | count |
|---|---|
| byte-exact match with the repo file | **14** |
| differ by the trailing `\n` only | **6** |
| any other difference | **0** |

**The six are REAL byte differences and the raw check is right to flag them.**
`supabase/migrations/README.md` promises the repo file is byte-identical to
`statements[1]`; six staging entries are not. `scripts/migration-md5.sh` is
**not** to be relaxed, and whitespace is **not** to be normalised — a checker
that forgives one byte forgives the next one too, and byte identity is the
property that made the 2026-09-09 ledger reconciliation possible.

**Cause: transport, not content.** The migration tool strips the file's final
newline. Demonstrated rather than asserted — `create_print_jobs`: repo
`6e95fdfc…` at 1807 bytes; repo with the final `\n` removed `bdc7cc81…` at
1806; staging stored `bdc7cc81…` at 1806.

**The six affected staging ledger versions**, recorded so the difference is
enumerated rather than a standing excuse:

| # | migration | repo md5 (as committed) | staging md5 (repo minus final `\n`) |
|---|---|---|---|
| 1 | `create_print_jobs` | `6e95fdfcc19ed4609dceb5cb7a1b70b4` | `bdc7cc81fa5fdeefe1f09c7b7c5037fe` |
| 2 | `commission_tracking_phase1` | `32a4007b31ab9017d9a2295aeb1e1fad` | `c937fc43a09732be21186a332a41b051` |
| 17 | `phase_d1b_decommission` | `bf0de438ff5b570169a63dccc654df46` | `80b785e7f3064554d41d03d35a666ff3` |
| 18 | `phase_e_01_employee_roles` | `068d409a57f632246892ee8d6e3f370f` | `066baa69eddda45737d6450cf82121a8` |
| 19 | `phase_e_02_cost_model` | `83c1094e151208d3a28b54deba4e2f4a` | `0ee5b79991b046c9f2d5967e4eae1fdb` |
| 20 | `phase_e_03_order_margin_snapshot` | `b7a8e54c99432c5e0ddb60be4c46505f` | `b3e58c9bda4995ed3ffd876b1d1411e2` |

The **final-LF comparison is a separate, narrowly-scoped check**: it confirms
`md5(repo_file_without_trailing_LF) == staging_md5` for exactly these six, and
it is not part of the drift checker. It answers "is this the known transport
difference?" — nothing else. **Production's ledger is unaffected** and its
files remain byte-identical; this applies only to the staging replay.

Hashes prove statement text. **Verification 2 is what proves the schema.**

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

## 4. Netlify environment — the split-brain that had to be fixed first

**Staging was not usable until this was fixed, and the failure would have been
silent.** `netlify.toml` hard-coded `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY` under `[build.environment]`, with a comment saying
"Override these in the Netlify dashboard if you rotate them" — **backwards**.
Netlify gives `netlify.toml` build variables precedence **over** dashboard
variables, and `netlify.toml` is shared by every site built from this repo.

So a staging site would have:

| half | reads | pointed at |
|---|---|---|
| **browser bundle** | `VITE_*` at **build** time, from `netlify.toml` | **PRODUCTION** |
| **functions** | `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` at **runtime**, from that site's dashboard | staging |

Split-brain — and worse than no isolation, because every server-side check
would pass while the browser read and wrote production rows.

**Fixed:**

1. **Project identity removed from `netlify.toml`.** Set it per site in the
   dashboard, which is site-specific by construction. Build-time `VITE_*` and
   function-runtime vars are **separate mechanisms** and must both be set.
2. **`scripts/check-build-env.mjs` runs in the build command**, before
   `yarn build`. It resolves the **effective** value the way Vite does
   (shell env > `.env.local` > `.env`) and refuses the build on a mismatch.
   - `EXPECTED_SUPABASE_REF` **unset** → production assumed and verified.
     Production therefore keeps building with **no dashboard change**, still
     guarded.
   - `EXPECTED_SUPABASE_REF` **set** → the effective ref must equal it. Any
     leak of production through `netlify.toml`, `.env`, or a stale dashboard
     value **fails the build**.
3. **The tracked `.env` fallback is covered.** It holds production values for
   local dev, and Vite falls back to it, so a staging site that set nothing
   would have inherited production *through `.env`* even after `netlify.toml`
   was cleaned. Proven: with `EXPECTED_SUPABASE_REF` set to staging and no
   other env, the guard exits 1 and names `.env` as the source.
4. **Store slug.** `VITE_STORE_SLUG` and `STORE_SLUG` both default to
   `store4979`, which does not exist here. The guard **requires** both on any
   non-production build and rejects `store4979`.

Covered by 15 tests in `scripts/tests/check-build-env.test.js`, including both
halves of the original bug.

**What the guard does NOT check, stated so a green build is not over-read:**
the functions' runtime `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. Those
are read per request from the site's dashboard config and are invisible at
build time. **Before any test write, confirm the emitted browser config and
the actual REST/Storage request destinations in every deploy context** — read
the built bundle, and watch a live function response — rather than inferring
either from a passing build.

## 5. Rules for using it

1. **Destructive probes run here, not in production.** The `TRUNCATE` and
   storage-deletion probes in the findings document ran against production
   inside `begin … rollback` before staging existed. That is not a precedent.
2. **Never point a staging command at `gmxyisjjaxtpycsmmzef`.** Check the ref.
3. **Reseed with `scripts/staging-seed.sql`** — a runnable artifact, not a
   description. It **RESETS then seeds**: `ON CONFLICT DO NOTHING` cannot
   restore a fixture an adversarial test has altered (a revoked session, a
   demoted employee, a drained queue) — it leaves the mutated row and reports
   success. Its **first statement refuses to run** if the database contains
   `store4979` or an `ups-4979` org with stores attached, so a paste into the
   wrong SQL editor tab destroys nothing. Both behaviours are verified: the
   guard raised `42501` against a simulated production marker, and a reset
   restored an employee deliberately mutated to `staff/inactive` plus a
   deleted queue row.
4. **Re-verify after any production migration.** Staging only proves something
   while it still matches. Re-run both verifications above.
5. **No service-role key in the repo.**

---

## 6. Outstanding before Release 2 testing can start — FIVE items

All five block. An earlier revision of this file called it four and described
item 5 as a footnote; it is not.

| # | item | why it blocks |
|---|---|---|
| 1 | **Second Netlify site** on this repo, with `EXPECTED_SUPABASE_REF`, `VITE_SUPABASE_*`, `VITE_STORE_SLUG`, `STORE_SLUG`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` set **in its dashboard**, previews attached to it | functions deploy per site, so the legacy-URL probes (rows 37–41) need staging's own copies. The guard in §4 fails the build until this is right |
| 2 | **Auth config**: Site URL = the staging site, deploy-preview pattern in redirect URLs | the 2026-09-09 lockout came from a wrong Site URL; do not repeat it here |
| 3 | **Owner + manager Auth accounts** per tenant, with `memberships` rows | `has_store_role` paths and every admin flow are untestable without them |
| 4 | **SMTP sink** (Mailpit or Ethereal) in the staging site's `SMTP_*` | a real relay in staging will eventually mail a real customer |
| 5 | **Real Storage objects at the seeded paths** — `customer-uploads/staging-t{1,2}-store/synthetic.pdf` and `job-files/jobs/staging-t{1,2}-store/synthetic-job.pdf` | **a missing object is not a negative fixture.** A denial test against a path with no object cannot tell "denied" from "absent" — it passes for the wrong reason. Authorized access to a known synthetic object must be proven **first**, so that the later denial means something |

Items 1–4 need dashboard and Netlify access. Item 5 needs a service-role
upload of two small synthetic PDFs per bucket; the seed script already writes
the matching `files[].path` and `file_urls[].path` values, so the paths are
fixed and must match exactly.

Nothing in Release 2 should be tested until all five are done.
