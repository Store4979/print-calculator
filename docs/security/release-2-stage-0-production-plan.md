# Release 2 — stage 0, production half

**Status: PLAN ONLY, for its own review round. Nothing here has been applied.**
Written 2026-09-24 on `security/release-2-slice-2`. Implements §4.2 of
`release-2-data-path-plan.md` for production after the staging half was
accepted (0a, 0b on both sites, 0c, preview deletion verified, inventory
review items covered).

Stage 0 ends when G0 passes. G0's five conditions and where each stands:

| G0 condition | today | closed by |
|---|---|---|
| 1 migrations 01–05 in production's ledger, files named and byte-identical | not applied | P2 |
| 2 deployment-context check in place, evidence (a)–(d) | (b), (c), half of (d) observed; context-alone denial observed on staging | P4 (a), (d) |
| 3 Phase 1 probes green on production | 404 baseline observed 09-18 | P7 (after the refusal is removed) |
| 4 a preview refused with 404 by a curl with no Origin | observed, but masked by the ref refusal on the production site | P7 (unmasked) |
| 5 inventory proves the client calls no endpoint | **closed** (inventory gate, 285/285) | — |

---

## 1. Facts this plan rests on (established 2026-09-23/24, read-only)

**F1 — The committed migration files for 01, 02 and 03 are NOT byte-identical
to what staging applied; 04 and 05 are.** Staging's ledger holds compact,
comment-free bodies for 01–03 (`md5(statements[1])` `ef5d5a38…`, `00a8033a…`,
`0960ff10…`), not the committed files (`e97a5fd7…`, `734e0db7…`, `302e05c6…`).
They are **semantically equal**: stripping `--` comments, collapsing whitespace,
joining adjacent string literals (the files split `COMMENT ON` strings across
lines; Postgres concatenates them) and removing space around punctuation gives
the same md5 for all five, computed independently in Python over the committed
blobs and in Postgres over staging's `statements[1]` (01 `da4699a6…`, 02
`7f1710aa…`, 03 `d26630f6…`, 04 `e023fd12…`, 05 `614f1572…`). 04 and 05 match
byte for byte (`2dcb03eb…`, `22b5010b…`).
*Consequence:* production applies the **committed file bytes**, so production's
ledger will hold the file (CLAUDE.md rule 4 holds from the first apply), and
staging's ledger stays as the one documented exception. Equality of the
*result* is then proven at the catalog level, not by text (P1, P3).

**F2 — 01 alters a live production table.** `alter table public.employees add
constraint employees_id_store_uniq unique (id, store_id)`. `id` is the primary
key, so the constraint cannot fail on data; building it takes a brief lock on
`employees` that blocks writes (PIN verification reads are not blocked). Every
other object in 01–05 is new. 01 references `public.stores`,
`public.organizations`, `auth.users`; 02/03 call `public.has_store_role`.

**F3 — 03, as committed, contains the 42702 defect that 04 repairs**
(`release2_create_staff_session` with unqualified columns). Between applying 03
and 04 the function exists and cannot run. Nothing can call it in that window:
every Release 2 endpoint is refused on production by the ref check, and the
function is `service_role` only.

**F4 — Rehearsal files exist only for 04 and 05**
(`supabase/rehearsals/release2_04_rehearsal.sql`, `…_05_…`). 01–03 were
rehearsed on staging before rule 4 required an end-to-end call.

**F5 — No production client bundle uses a legacy JWT key.** Every ready
production deploy that carries a Supabase client embeds an `sb_publishable_…`
key and no `eyJhbGciOi…` JWT (public GET of each permalink's JS, 2026-09-24).
The single `sb_secret_` string in today's bundle is supabase-js's own prefix
test (`t.startsWith("sb_publishable_")||t.startsWith("sb_secret_")`), not a key.
*Consequence:* disabling legacy JWT-based API keys breaks no browser, including
counter devices running an old cached bundle.

**F6 — What `SUPABASE_SERVICE_ROLE_KEY` holds on production is unknown to this
session and must stay so** — established by the operator from the prefix
shown in the dashboard (`eyJ…` legacy `service_role` JWT, or `sb_secret_…`),
never pasted into a session.

**F7 — Retained production deploys hold the key.** 71 production-context
deploys: the published one and three rollback targets kept; 28 key-bearing or
key-unknown deploys proposed for deletion (`deploy-inventory.md`,
`PRODUCTION-DELETE-LIST`); 39 have no functions. Deletion reaches permalinks
nobody should use; only rotation reaches the kept four.

---

## 2. Sequence

Each step ends at a stop point for the owner's confirmation. Every SQL
statement is shown before it runs. Every probe records status, content type and
body.

### P0 — read-only preconditions (production)

One read-only statement, shown for approval before it runs:

```sql
select
  (select max(version) from supabase_migrations.schema_migrations)            as ledger_version,   -- expect 20260909232836
  (select count(*) from supabase_migrations.schema_migrations
    where name like 'release2_%')                                              as release2_in_ledger, -- expect 0
  to_regprocedure('public.has_store_role(uuid,text[])') is not null            as has_store_role,   -- expect true
  to_regclass('public.organizations') is not null                              as organizations,    -- expect true
  exists (select 1 from information_schema.columns
           where table_schema='public' and table_name='stores' and column_name='org_id') as stores_org_id,
  (select count(*) from public.stores where org_id is null)                    as stores_without_org, -- redeem raises 23502 for these
  exists (select 1 from pg_constraint where conname='employees_id_store_uniq') as uniq_already_there, -- expect false
  (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname in ('device_enrollments','enrollment_tickets','staff_sessions',
          'upload_capabilities','upload_capability_files','auth_attempts'))   as release2_tables_present; -- expect 0
```

Any unexpected value stops the stage.

### P1 — rehearsal against production data, `begin … rollback`

New file `supabase/rehearsals/release2_stage0_production_rehearsal.sql`, run
on production in ONE transaction ending in `ROLLBACK`:

1. The five committed files **verbatim, in order** 01, 02, 03, 04, 05.
2. **ACL proofs** — `proacl` of all six functions equals
   `{postgres=X/postgres,service_role=X/postgres}` (plus `authenticated` for
   `release2_clear_lockout`), with no leading `=X` (PUBLIC); `prosecdef` and
   `proconfig` as staging.
3. **Table proofs** — the six tables: RLS on, **zero** policies, table grants
   exactly `service_role` (anon/authenticated hold nothing — they currently hold
   everything on public tables, so this is checked, not assumed).
4. **End-to-end calls with synthetic rows created inside the transaction**
   (a synthetic org and store, an owner membership, a staff and a manager
   employee, a ticket), so no real row is read into a result or touched:
   `redeem_enrollment_ticket` (redeem, replay → 28000, expired → 28000);
   `release2_record_attempt` (quota and cooldown, window rollover);
   `release2_clear_lockout` (owner OK, wrong store → 42501, unknown subject →
   42501); `release2_create_staff_session` (create, rotate, cross-store → 28000);
   `release2_revoke_enrollment` (incl. P5b: non-owners on an already-revoked
   enrollment → identical 42501); `release2_prune_auth_attempts`.
   P0 of the 04 rehearsal is kept: after 03 and **before** 04, a call reproduces
   42702, proving the rehearsal exercises the defect 04 repairs.
5. **Catalog fingerprint** — for every object 01–05 creates:
   `md5(pg_get_functiondef(oid))`, column lists with types/defaults/nullability,
   constraint definitions, index definitions, `proacl`, `relacl`, RLS flags. The
   same query runs on staging (read-only). **The two fingerprints must be equal**
   — this is the proof F1 needs, that the committed bytes produce what staging
   has.
6. `ROLLBACK`. A read after the rollback shows zero Release 2 objects and an
   unchanged `employees` constraint list.

### P2 — apply 01–05 to production, one at a time

For each file in order, with the owner watching:
1. `apply_migration` with the **committed file's bytes**.
2. Read back from `supabase_migrations.schema_migrations`: version, name,
   `md5(statements[1])`, `right(statements[1],1) = E'\n'`.
3. Compare to the file: equal, or equal to the file minus its final newline
   (the documented transport difference, `staging.md` §2) — anything else stops.
4. `git mv supabase/migrations/pending/release2_0N_….sql
   supabase/migrations/<version>_release2_0N_….sql` in the same commit as the
   ledger read-back record.

03 and 04 are applied back to back (F3). No commit is pushed to `main` during
P2 — the file moves ride the stage-0 branch.

**Rollback of P2:** each migration's objects are additive except F2's
constraint. A `.rollback.sql` per file is written and reviewed **before** P2
(drop functions, drop tables, `alter table employees drop constraint
employees_id_store_uniq`), and rehearsed in P1's transaction after the forward
files (apply → rollback file → assert the catalog equals P0's).

### P3 — post-apply read-back and snapshot refresh

The P1 catalog proofs repeated outside a transaction, recorded. Then
`scripts/manual/tables-snapshot.sql` re-run (read-only) and `supabase/tables.json`
refreshed: its `ledgerVersion` becomes 05's version and the six tables appear,
which INV-6 now **requires** (applied state) while the browser prohibition on
those names stays independent. The inventory suite must be green on that commit.

### P4 — production environment, the flag, and evidence (a) and (d)

Owner, in the Netlify dashboard for `printcalculator2`:
- `RELEASE2_ENABLED=true` — **scope: Functions, context: Production only.**
- `RELEASE2_ALLOWED_ORIGINS=https://printcalculator2.netlify.app` — Functions,
  Production.
- `RELEASE2_CONTEXTS` — **not set** (default `production`).
- A fresh production deploy of the current `main` (env changes do not reach a
  running deploy).

The production-ref refusal is still in the code, so every Release 2 endpoint
still answers 404 on production. Probes:
- **(a)** `GET https://printcalculator2.netlify.app/.netlify/functions/deploy-context`
  → `context:"production"`, `siteName:"printcalculator2"`, `flagPresent:true`,
  `contextAllowed:true`, `deployId` = the new published deploy.
- **(d)** the same route on a **fresh** production-site preview built after the
  env change → `flagPresent:false`; the production half of (d) is (a)'s
  `flagPresent:true`.
- **Dark baseline:** Phase 1's four calls on production → four JSON 404. With
  (a) showing context and flag both satisfied, the ref refusal is shown to be
  the only thing refusing.
- Legacy counter paths unchanged: a real order save and the queue tab, by the
  owner at the counter.

### P5 — key rotation (its own stop point; rehearsed on staging first)

1. **Establish the key type (F6)** — the owner reads the prefix of production's
   `SUPABASE_SERVICE_ROLE_KEY` in the dashboard and records only the type.
2. **Rehearse the whole procedure on staging** with staging's own keys, and
   record each step's result, before touching production.
3. **Create the new key**: a new secret API key (`sb_secret_…`) in the
   production project's API Keys page.
4. **Move every server consumer to it** — `SUPABASE_SERVICE_ROLE_KEY` for
   Functions in the Production context (this also covers the scheduled
   `cleanup-stale-jobs`). Any other holder (operator `.env.local` files,
   scripts, integrations) is listed and moved; the list is part of the record.
   Browsers need nothing (F5: they use the publishable key).
5. **Fresh build** of the current commit — not a republish — and probes on the
   new deploy: write-free key presence (`POST {}` to `start-upload` → `400
   fileName required`), plus one **authenticated, write-free** call proving the
   new key is accepted by Supabase. Which call is verified on staging in step 2
   (candidate: `get-download-url` for a path that does not exist, expecting the
   storage "object not found" answer rather than an authentication error; if
   that handler cannot distinguish them, a read-only diagnostic is added and
   reviewed first).
6. **Revoke the old key** — only after step 5 passes:
   - if it was a secret key: delete it;
   - if it was the legacy `service_role` JWT: disable JWT-based API keys for the
     project. This also disables the legacy `anon` JWT, which F5 shows no
     production bundle uses.
7. **Probe every retained production permalink** (the kept four and any
   not yet deleted) write-free: `start-upload` now fails for the key, recorded
   per URL in `deploy-inventory.md`.

**Rollback of P5:** before step 6 — set the env back to the old key and do a
fresh build. After step 6 with a deleted secret key — the old key cannot
return; create another new key and repeat 4–5. After disabling legacy JWT keys
— re-enable them in the dashboard (whether re-enabling restores the SAME keys
is verified in the staging rehearsal and recorded; if not, this rollback is
"create new keys"). **After rotation every rollback is a fresh build of the old
commit, never a republish**: the kept rollback targets' functions hold the
revoked key. Part 7's rollback contract gains that line.

### P6 — delete the production-ref refusal (the last change)

One code change on the stage-0 branch, reviewed: `release2Allowed()` loses
condition 2 (`ref === PRODUCTION_REF`), its header comment is rewritten to two
conditions (flag, verified context), `release2-guard.test.js` and DC-13 lose
"refused on the production ref" and gain "production context + flag + any ref
→ allowed; preview context on the production ref → 404". Merged to `main` only
with all of P0–P5 recorded. The kill switch `RELEASE2_ENABLED=false` +
redeploy remains the rollback.

### P7 — verification on production (no further change)

- **Phase 1 on production** → four uniform `401 {"ok":false,"error":"Unauthorized"}`.
- **Preview refusal, now unmasked:** a fresh production-site preview —
  `deploy-context` `deploy-preview`/`flagPresent:false`; `csrf-bootstrap` with
  no Origin, the production Origin and its own Origin → JSON 404.
- **Positive probes with real rows** (owner): mint and redeem a ticket on a
  scratch device, sign in a real PIN, log out, revoke the device; each step read
  back from the database. The scratch enrollment stays in the audit trail,
  revoked.
- Counter unchanged: a real order save, the queue tab, a PIN sign-in through the
  **legacy** path (no client calls Release 2 until slice 4).

G0 passes when P0–P7 are recorded.

---

## 3. Decisions for the reviewer

1. **Apply the committed bytes, not staging's compact bodies (F1).** Proposed.
   The alternative (replaying staging's text) would make production's ledger
   match staging's but not the repository, breaking rule 4 on production.
2. **Order of P5 relative to P2–P4.** Proposed as written: migrations and the
   flag first (reversible, additive), rotation before the refusal is lifted (so
   no retained bundle holds a working key when the endpoints go live).
3. **Delete the 28 old production deploys before P5.** Proposed: yes. Rotation
   makes their functions inert, but deletion also removes 28 permalinks serving
   old client code, and it needs no key change.
4. **`deploy-context` route after G0: keep or tombstone.** Open, as recorded in
   the staging half. It reveals `flagPresent` per deployment.
5. **The 42702 window between 03 and 04 (F3).** Proposed: accept (nothing can
   call the function), apply back to back. Alternative: apply a combined 03+04
   — rejected, because it would create a file that matches neither ledger.

## 4. Not in this plan

Client slices (4–9); any grant closure (stage E of each slice); the pending
`phase_b_b2_pending_jobs_queue_unique` migration; historical deploys of the
**staging** site (they hold the staging key only).
