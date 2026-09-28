# Release 2 — stage 0, production half

**Status: PLAN FOR REVIEW. Nothing here has been applied to production.**
Rewritten 2026-09-28, after the staging ledger reconciliation
(`release-2-staging-reconciliation.md`, complete): the committed migration files
01–05 are now the tested code on staging, byte for byte. Organized by the six
requirements Codex set for this plan — **A** manifest, **B** full retained-deploy
table, **C** credential transition, **D** evidence (a)/(d) with the refusal
still present, **E** bounded migration procedure, **F** acceptance and rollback.
The previous draft (F1 "carry the mismatch into production") is withdrawn.

Order of the production steps, each ending at a stop point for Ryan:

| step | what | changes production? | section |
|---|---|---|---|
| P0 | read-only preconditions | no (one SELECT) | E |
| P1 | rehearsal of 01–05 against production data in `begin … rollback` | no (rolled back; brief locks) | E |
| P2 | apply 01–05, one at a time, byte-checked | **yes — database** | E |
| P3 | post-apply read-back, snapshot refresh | no | E |
| P4 | env: `RELEASE2_ENABLED` (Functions, Production), fresh deploy; evidence (a)/(d); dark Phase 1 | **yes — env + deploy** | D |
| P5 | credential transition (rehearsed on staging first) | **yes — keys** | C |
| P6 | delete the production-ref refusal — the LAST change | **yes — code** | F |
| P7 | verification: Phase 1 401s, unmasked preview refusal, positive probes | writes probe rows | F |

G0 passes when P0–P7 are recorded against the acceptance list in F.

---

## A. Manifest — exactly what reaches production

Everything that will change on production, fixed in advance by hash, so that
"what was applied" can be compared with "what was reviewed" mechanically.

**A1. Migrations** (applied in this order; blobs at `7e3ad2d`, unchanged since
their first commits):

| # | file (today in `supabase/migrations/pending/`) | blob md5 | bytes | staging ledger (reconciled) |
|---|---|---|---|---|
| 1 | `release2_01_identity_schema.sql` | `e97a5fd7c346a3b0a39bc6180dcfde46` | 13 720 | `20260928160657` |
| 2 | `release2_02_auth_attempts_fn.sql` | `734e0db7312b79081a769ca366c5b99a` | 6 406 | `20260928160722` |
| 3 | `release2_03_bind_and_atomicity.sql` | `302e05c6a4939eb8021234cbc7325473` | 13 062 | `20260928160802` |
| 4 | `release2_04_staff_session_qualify_columns.sql` | `2dcb03eb36e47c8404a29500151e8394` | 5 858 | `20260928160825` |
| 5 | `release2_05_revoke_enrollment.sql` | `22b5010b9a3b20f5a3aaba4d212fd46c` | 5 622 | `20260928160847` |

**A2. Resulting objects** — what the database must contain after P2 and
nothing more (taken from the reconciled staging catalog, R3):

- Tables (6): `device_enrollments`, `enrollment_tickets`, `staff_sessions`,
  `upload_capabilities`, `upload_capability_files`, `auth_attempts` — each
  `relrowsecurity = true`, **0 policies**, `relacl =
  {postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres}`.
- One constraint on an existing table: `employees_id_store_uniq UNIQUE (id, store_id)`.
- Functions (6), each `SECURITY DEFINER`, `search_path=public`, `proacl =
  {postgres=X/postgres,service_role=X/postgres}` except
  `release2_clear_lockout` which adds `authenticated=X/postgres`; no PUBLIC
  entry, no `anon`. `md5(prosrc)` must equal:

  | function | defined by | `md5(prosrc)` |
  |---|---|---|
  | `redeem_enrollment_ticket(bytea,bytea,bytea,text)` | 01 | `c024388886897f01a1154d8d12dc8996` |
  | `release2_record_attempt(text,text,int,int,int)` | 03 | `e67957595afcc7a51d7f8673000d9302` |
  | `release2_clear_lockout(text,text,uuid,uuid)` | 03 | `b7f602cde969f2f2622c0d2343b1c249` |
  | `release2_prune_auth_attempts(int)` | 03 | `ee254949f88474c58284b8a2c1ba3cb0` |
  | `release2_create_staff_session(uuid,uuid,bytea,bytea,timestamptz,timestamptz)` | 04 | `d30da6d0c7a4d14e1bcb1b9fcace37d9` |
  | `release2_revoke_enrollment(uuid,uuid,text)` | 05 | `a464a43cc72537bb02b3e4a1d904f655` |

  These were derived two ways and agree: from staging's `pg_proc` after R2, and
  from the committed files' `$fn$` bodies by a script over the git blobs.

**A3. Code** — the `security/release-2-stage-0` content merged to `main` in ONE
reviewed PR before P4 (the deployment-context transport, the `deploy-context`
route, the three-condition gate with the ref refusal STILL PRESENT, the
inventory gate). The refusal deletion (P6) is a SEPARATE, later PR touching
only `netlify/lib/release2.js`, its header comment, and the two tests that pin
the refusal (`release2-guard.test.js`, DC-13).

**A4. Environment** (production site `printcalculator2`, Netlify dashboard, by
Ryan): `RELEASE2_ENABLED=true` — scope **Functions**, context **Production**
only; `RELEASE2_ALLOWED_ORIGINS=https://printcalculator2.netlify.app` —
Functions, Production; `RELEASE2_CONTEXTS` — **not set** (default
`production`); `SUPABASE_SERVICE_ROLE_KEY` — replaced in P5 by a new key (value
never in the repo, a session or this plan).

**A5. Repository moves** in the P2/P3 commits: each file `git mv`'d from
`pending/` to `supabase/migrations/<production version>_<name>.sql`; a
`.rollback.sql` companion for each (A6); `supabase/tables.json` recaptured;
`deploy-inventory.md` retained-deploy table refreshed after P5.

**A6. Rollback files, written and reviewed BEFORE P1** (and rehearsed inside
P1): one per migration, inverse order. 05: drop `release2_revoke_enrollment`.
04: re-create 03's `release2_create_staff_session` body (the pre-04 state is
the 42702 defect — rolling back 04 alone is pointless, so 04's rollback is
documented as "roll back 03 as well"). 03: restore 02's `clear_lockout`
signature and `record_attempt` body, drop `create_staff_session` and
`prune_auth_attempts`. 02: drop both functions. 01: drop the six tables, the
function, and `employees_id_store_uniq`. Each carries a guard that refuses to
run where the staging seed store exists (the inverse of the reconciliation
reset's guard) — a production rollback must not be pointable at staging by
mistake, and vice versa.

**A7. Making the manifest mechanical.** Proposed: commit A1/A2 as
`docs/security/stage0-production-manifest.json` with a test that (i) recomputes
each blob's md5 and fails on drift, and (ii) re-derives each `md5(prosrc)` from
the `$fn$` bodies of the committed files and fails on drift. P2 and P3 compare
against that file, not against this prose.

---

## B. Full retained-deploy table

Every deploy still listed on the production site, probed write-free
2026-09-28T16:12:14Z: key presence by `POST {}` to `start-upload` (every
historical version answers `400 fileName required` before any storage call; the
key guard runs first, so `Supabase URL not configured` and a Node-20 init
failure mean the key IS present), fixes by `git merge-base --is-ancestor`
against `9c99bbf`/`7f89876` (cleanup-stale-jobs) and `1ce7849`/`10235f2` (#43
recipient). Published deploy re-read: `6ab020c50a788b0008d430c9`.

**Summary: 57 deploys listed. Exactly four hold the production service-role
key — the four kept on purpose. No deploy's key state is unknown.**

| class | count |
|---|---|
| production, key PRESENT, writer live — **kept** (published + 3 rollback targets) | 4 |
| production, no functions | 25 |
| production, errored build (not served) | 9 |
| deploy-preview, key absent (PR #48 builds after the preview key was cleared) | 5 |
| deploy-preview, no functions | 11 |
| deploy-preview, errored build (not served) | 3 |

Everything else classified key-present or key-unknown has been deleted and
verified (56 previews on 2026-09-24; 28 production deploys and 6 older previews
on 2026-09-28; `deploy-inventory.md`). Five production deploys once counted as
"no functions" were in fact deleted in March–May; they no longer appear here.

The table is re-taken (i) immediately before P5, so the rotation's target set is
current, and (ii) after P5, when the four kept deploys must show the OLD key
refused. The full table is the appendix at the end of this plan.

---

## C. Credential transition

**C1. Facts it rests on.** No production client bundle has ever carried a
legacy JWT key — every ready production deploy with a client embeds
`sb_publishable_…`; the one `sb_secret_` string in today's bundle is
supabase-js's prefix test (read 2026-09-24). What
`SUPABASE_SERVICE_ROLE_KEY` holds on production is unknown to every session and
must stay so.

**C2. Consumers of the service key**, from the repository: every legacy
function (`start-upload`, `register-job`, `fetch-link-job`, `get-download-url`,
`complete-job`, `send-print-job`), the **scheduled** `cleanup-stale-jobs`, and
the Release 2 functions via `netlify/lib/release2-auth.js`. All read it from the
Netlify Functions environment of the production context. Outside the
repository, Ryan lists any other holder (operator `.env.local` files, scripts,
integrations) before step C5; the list is part of the record.

**C3. Rehearsed on staging first**, end to end, with staging's own keys, each
step recorded — including whether re-enabling legacy JWT keys (if that branch
applies) restores the SAME keys.

**C4. Steps on production** (by Ryan in the dashboards; this session never sees
a key):
1. **Establish the key type** from the prefix shown in the Netlify dashboard:
   `eyJ…` = the legacy `service_role` JWT; `sb_secret_…` = a secret API key.
   Record only the type.
2. **Create a new secret API key** in the production Supabase project.
3. **Move every consumer** (C2) to it: `SUPABASE_SERVICE_ROLE_KEY` for
   Functions in the Production context.
4. **Fresh build** of the current `main` (a build, not a republish — a
   republish reuses the bundle's captured environment). It becomes the
   published deploy.
5. **Prove the new key works, write-free, on the new deploy**: `POST {}` to
   `start-upload` → `400 fileName required` (key present), and one
   authenticated read that Supabase must accept — chosen and verified in C3
   (candidate: `get-download-url` on a path that does not exist, expecting
   Storage's object-not-found rather than an authentication error; if the
   handler cannot distinguish them, a read-only diagnostic is reviewed and added
   first). Counter check by Ryan: a real order save and the queue tab.
6. **Revoke the old key** — only after step 5: a secret key is deleted; the
   legacy `service_role` JWT is retired by disabling JWT-based API keys (which
   also disables the legacy `anon` JWT — C1 shows no bundle uses it).
7. **Probe the retained deploys** (B): the three rollback targets and the
   previous published deploy must now refuse for the key (`start-upload` no
   longer reaches `fileName required`), recorded per URL.

**C5. Timing:** after P4 (the flag and the context check are live, the ref
refusal still blocks) and **before P6**, so no retained bundle holds a working
key when the Release 2 endpoints go live.

**C6. Rollback of C:** before step 6 — restore the old value, fresh build. After
step 6 with a deleted secret key — it cannot return; create another new key and
repeat 3–5. After disabling legacy JWT keys — re-enable them (C3 records
whether that restores the same keys; if not, this branch is "create new keys").
**After C, every rollback of the site is a fresh build of the old commit, never
a republish**: the kept rollback targets' functions hold the revoked key.

---

## D. Evidence (a) and (d) with the refusal still present (P4)

The production-ref refusal stays in the code throughout P4, so production's
Release 2 endpoints keep answering 404; nothing here opens them.

1. Ryan sets A4's `RELEASE2_*` variables; a fresh production deploy of `main`
   (which now contains A3).
2. **(a)** `GET https://printcalculator2.netlify.app/.netlify/functions/deploy-context`
   → `200`, `context:"production"`, `siteName:"printcalculator2"`,
   `deployId` = the new published deploy, `flagPresent:true`,
   `contextAllowed:true`, `source` recorded.
3. **(d), both halves**: (a)'s `flagPresent:true` is the production half; a
   **fresh** production-site deploy preview built after the env change →
   `context:"deploy-preview"`, `flagPresent:false` is the preview half.
4. **Dark baseline**: Phase 1's four calls on production → four JSON `404`.
   With (a) showing both the context and the flag satisfied, the ref refusal is
   the only condition left that can produce them — which is the claim P6 relies
   on. The context condition refusing ON ITS OWN is already proven on staging
   (0b-staging, 2026-09-24: same project, same flag, `branch-deploy` and
   `deploy-preview` → 404 while `production` → 401).
5. Counter unchanged: a real order save and the queue tab (legacy paths).

---
## E. Bounded migration procedure (P0–P3)

**E0. Bounds.** One operator window, owner present, outside counter hours (the
01 constraint takes a brief lock on `employees` that blocks WRITES to it — PIN
verification reads are not blocked — and P1 takes the same lock inside its
transaction). Every step has a stop condition; a stop means stop, record, and
return to review — never retry-in-place, never edit a file to make a check pass.
Any gap of more than a day between P1 and P2 means P0 and P1 are re-run.

**E1. P0 — read-only preconditions.** One statement, shown to Ryan before it
runs:

```sql
select
  (select max(version) from supabase_migrations.schema_migrations)             as ledger_version,        -- expect 20260909232836
  (select count(*) from supabase_migrations.schema_migrations
    where name like 'release2_%')                                               as release2_in_ledger,    -- expect 0
  to_regprocedure('public.has_store_role(uuid,text[])') is not null             as has_store_role,        -- expect true
  to_regclass('public.organizations') is not null                               as organizations,         -- expect true
  exists (select 1 from information_schema.columns
           where table_schema='public' and table_name='stores' and column_name='org_id') as stores_org_id, -- expect true
  (select count(*) from public.stores where org_id is null)                     as stores_without_org,    -- redeem raises 23502 for these
  exists (select 1 from pg_constraint where conname='employees_id_store_uniq')  as uniq_already_there,    -- expect false
  (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname in ('device_enrollments','enrollment_tickets','staff_sessions',
          'upload_capabilities','upload_capability_files','auth_attempts'))    as release2_tables_present, -- expect 0
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and (p.proname like 'release2\_%' or p.proname='redeem_enrollment_ticket')) as release2_functions_present; -- expect 0
```

Stop on any unexpected value.

**E2. P1 — rehearsal on production, `begin … rollback`.** The R1 method, which
worked on staging: each committed file enters the transaction as a
dollar-quoted literal inside a `DO` block that checks `md5()` against A1 BEFORE
`EXECUTE`, so the database proves it ran the reviewed bytes. Order: 01, 02, 03
→ a real call that must raise **42702** (03's defect, proving the rehearsal
exercises what 04 repairs) → 04, 05 → proofs → the five rollback files (A6),
each md5-gated → an assertion that the catalog equals P0's → `ROLLBACK`.

The proofs are a NEW file, `supabase/rehearsals/release2_stage0_production_proofs.sql`,
reviewed before P1: the reconciliation proofs depend on the staging seed store,
which production does not have. It creates its fixtures INSIDE the
transaction — a synthetic organization and store, a staff and a manager
employee, owner and manager memberships pointing at an existing auth user id
read (not modified) from `memberships`, tickets — and runs A1–A3, the A2
`md5(prosrc)` comparison, and the same end-to-end calls as B1–B13. No real
row is read into a result or modified; everything is rolled back. After the
rollback, P0 is re-run and must return exactly the P0 values.

Stop on: any md5 mismatch, any proof deviating from its expectation, the
post-rollback P0 differing, or the transaction exceeding its window.

**E3. P2 — apply, one migration at a time.** `apply_migration` with each file's
exact committed bytes, in A1's order, 03 and 04 back to back (between them the
staff-session function exists and cannot run; nothing can call it — every
Release 2 endpoint is refused on production by the ref check, and the function
is `service_role` only). After EACH apply, before the next:
- read back the new ledger row: `version`, `md5(statements[1])`,
  `octet_length`, final newline;
- accept only A1's md5 and byte count (staging's R2 stored all five with the
  final newline intact; the older "trailing newline stripped" transport case is
  checked, not assumed) — anything else stops P2;
- after 01, 03, 04, 05: the functions each defined, `md5(prosrc)` against A2.

The `git mv` of each file to its production-version name happens in the same
commit as that ledger read-back.

**E4. P3 — post-apply read-back.** A2 in full, outside a transaction: six
tables (RLS, 0 policies, grants), the constraint, six functions (ACL, secdef,
search_path, `md5(prosrc)`). Then `scripts/manual/tables-snapshot.sql`
(read-only) and `supabase/tables.json` refreshed: `ledgerVersion` becomes 05's
production version and the six tables appear — which the inventory gate (INV-6)
then REQUIRES from applied state, while the browser prohibition on those names
stays independent. The inventory suite must be green on that commit.

---

## F. Acceptance and rollback

**F1. P6 — delete the production-ref refusal (the last change).** A separate
PR: `release2Allowed()` loses condition 2 (`ref === PRODUCTION_REF`); its
header is rewritten to two conditions (flag; verified context);
`release2-guard.test.js` and DC-13 lose "refused on the production ref" and
gain "production context + flag → allowed on any ref; preview context on the
production ref → 404". Merged only with P0–P5 recorded.

**F2. P7 — verification on production (no further change).**
- Phase 1 → four uniform `401 {"ok":false,"error":"Unauthorized"}`.
- A **fresh** production-site preview: `deploy-context` → `deploy-preview`,
  `flagPresent:false`; `csrf-bootstrap` with no Origin, the production Origin,
  and its own Origin → JSON `404` ×3 — now unmasked by any ref refusal.
- Positive probes with real rows, Ryan signed in: mint and redeem a ticket on a
  scratch device, sign in a real PIN, log out, revoke the device; each step read
  back from the database. The scratch enrollment stays in the audit trail,
  revoked.
- The counter unchanged: an order save, the queue tab, a PIN sign-in through the
  **legacy** path (no client calls Release 2 until slice 4).

**F3. Acceptance — G0 passes when every line is recorded:**

| G0 condition | evidence required |
|---|---|
| 1 migrations 01–05 in production's ledger, files named and byte-identical | E3 read-backs = A1; files renamed to production versions; A2 catalog incl. `md5(prosrc)`; tables.json refreshed and INV-6 green |
| 2 deployment-context check in place, (a)–(d) | (a) and (d) from P4; (b) and (c) already recorded (0b-prod 2026-09-23, 0a 2026-09-23); context-alone denial (0b-staging 2026-09-24) |
| 3 Phase 1 green on production | F2: four uniform 401s after P6 |
| 4 a preview refused with 404 by a curl with no Origin | F2: fresh production-site preview, three Origin variants, after P6 |
| 5 the inventory proves the client calls no endpoint | inventory gate green on the merged `main` (already closed; re-confirmed on the P3 commit) |
| plus: credential transition | C4 steps 1–7 recorded; B re-taken after C showing the kept deploys refused for the key |

**F4. Rollback, per step:**

| step | rollback | class |
|---|---|---|
| P1 | none needed — rolled back by construction | — |
| P2 / P3 | the A6 rollback files, in reverse order, each byte-checked after apply, then P0 must return its original values; the ledger keeps the forward rows (never edited) plus the rollback rows | reversal of a reviewed decision |
| P4 | `RELEASE2_ENABLED` removed + fresh deploy (endpoints were never open: the ref refusal was in place) | not an incident |
| P5 (C) | C6 | depends on branch |
| P6 | `RELEASE2_ENABLED=false` + fresh deploy → every Release 2 endpoint 404s; or revert the P6 PR and fresh build | incident if data was written through the endpoints |
| any | fresh build of the prior commit — **never a republish** after C | — |

**F5. Decisions for the reviewer.**
1. A7 — commit the manifest as JSON with a drift test (proposed: yes).
2. A6 — 04's rollback is documented as "roll back 03 as well" (proposed: yes;
   restoring the 42702 state alone has no use).
3. C5 — credential transition after P4 and before P6 (proposed as written).
4. The `deploy-context` route after G0 — keep or tombstone (open since the
   staging half; it reveals `flagPresent` per deployment).
5. E0 — an owner-present window outside counter hours for P1–P3.

---

## Appendix — retained deploys on the production site (2026-09-28T16:12:14Z)

| # | deploy id | context | state | PR | commit | built (UTC) | fixes (cleanup, recipient) | service-role key | role |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `6aa59114f573770008fb8dd5` | production | ready | — | `7f898762` | 2026-09-12T17:51 | cleanup yes, recipient yes | PRESENT, writer live | rollback target |
| 2 | `6aa994d535444e0008272512` | production | ready | — | `89de03e5` | 2026-09-15T18:56 | cleanup yes, recipient yes | PRESENT, writer live | rollback target |
| 3 | `6aad56a391c0cf0008d215fd` | production | ready | — | `99377287` | 2026-09-18T15:20 | cleanup yes, recipient yes | PRESENT, writer live | rollback target |
| 4 | `6ab020c50a788b0008d430c9` | production | ready | — | `7ec5af48` | 2026-09-20T18:07 | cleanup yes, recipient yes | PRESENT, writer live | published |
| 5 | `69ea366eb345cb0008d4de89` | deploy-preview | ready | #2 | `1e909012` | 2026-04-23T15:10 | cleanup no, recipient no | no functions | — |
| 6 | `69efa06d0258150009c4415a` | deploy-preview | ready | #3 | `35642ccc` | 2026-04-27T17:44 | cleanup no, recipient no | no functions | — |
| 7 | `69f1405fb03e030008ea5b28` | deploy-preview | ready | #5 | `686202cf` | 2026-04-28T23:18 | cleanup no, recipient no | no functions | — |
| 8 | `69f21ff79dceb3000872bbb3` | deploy-preview | ready | #6 | `6e70f803` | 2026-04-29T15:12 | cleanup no, recipient no | no functions | — |
| 9 | `69f224a66e778d00095dbdf0` | deploy-preview | ready | #7 | `ee39103c` | 2026-04-29T15:32 | cleanup no, recipient no | no functions | — |
| 10 | `69f22a286a5db200082f0034` | deploy-preview | ready | #8 | `396136d1` | 2026-04-29T15:56 | cleanup no, recipient no | no functions | — |
| 11 | `69f22d71db945f0008a8eebf` | deploy-preview | ready | #9 | `4b88e229` | 2026-04-29T16:10 | cleanup no, recipient no | no functions | — |
| 12 | `69fa1b469fbd70000868cee0` | deploy-preview | ready | #18 | `3aa6ada3` | 2026-05-05T16:31 | cleanup no, recipient no | no functions | — |
| 13 | `69fb769ac450950007f5b98d` | deploy-preview | ready | #20 | `0ae0878c` | 2026-05-06T17:12 | cleanup no, recipient no | no functions | — |
| 14 | `6a185ed1be36c9000881c63d` | deploy-preview | ready | #22 | `16bea086` | 2026-05-28T15:27 | cleanup no, recipient no | no functions | — |
| 15 | `6a318658f5c12a00089f5503` | deploy-preview | ready | #23 | `71c6b236` | 2026-06-16T17:22 | cleanup no, recipient no | no functions | — |
| 16 | `6a455b30299f480008ad8966` | deploy-preview | error | #27 | `55cb34ea` | 2026-07-01T18:23 | cleanup no, recipient no | not served (errored build) | — |
| 17 | `6aa31078e880ab0008667901` | deploy-preview | error | #43 | `7a7ac412` | 2026-09-10T20:18 | n/a | not served (errored build) | — |
| 18 | `6ab018331b0a1500089d0930` | deploy-preview | error | #47 | `d7fdbc9a` | 2026-09-20T17:30 | cleanup yes, recipient yes | not served (errored build) | — |
| 19 | `6ab3efa301777b0008a746f1` | deploy-preview | ready | #48 | `b294791d` | 2026-09-23T15:26 | cleanup yes, recipient yes | absent | — |
| 20 | `6ab3f40c055a620008aec356` | deploy-preview | ready | #48 | `47551b4c` | 2026-09-23T15:45 | cleanup yes, recipient yes | absent | — |
| 21 | `6ab40e674e6ec500087de9bc` | deploy-preview | ready | #48 | `fcb5da6e` | 2026-09-23T17:37 | cleanup yes, recipient yes | absent | — |
| 22 | `6ab40f88d8322c00084cf8d9` | deploy-preview | ready | #48 | `8821573a` | 2026-09-23T17:42 | cleanup yes, recipient yes | absent | — |
| 23 | `6ab53d56cb552000097ff85e` | deploy-preview | ready | #48 | `513b6226` | 2026-09-24T15:10 | cleanup yes, recipient yes | absent | — |
| 24 | `69c41cd74c2bc80007f8564c` | production | error | — | `ec0db90e` | 2026-03-25T17:35 | cleanup no, recipient no | not served (errored build) | — |
| 25 | `69c561d114d0b10008682845` | production | error | — | `100874de` | 2026-03-26T16:41 | cleanup no, recipient no | not served (errored build) | — |
| 26 | `69c561f0fc880f0009e2689c` | production | error | — | `7aba99f9` | 2026-03-26T16:42 | cleanup no, recipient no | not served (errored build) | — |
| 27 | `69c5627ff2336c0aa76e1c82` | production | error | — | `7aba99f9` | 2026-03-26T16:44 | cleanup no, recipient no | not served (errored build) | — |
| 28 | `69c56530b3100d1602a74815` | production | error | — | `7aba99f9` | 2026-03-26T16:56 | cleanup no, recipient no | not served (errored build) | — |
| 29 | `69c569ee8754e500090821b7` | production | error | — | `5e321192` | 2026-03-26T17:16 | cleanup no, recipient no | not served (errored build) | — |
| 30 | `69c569d84bf26d00081f4a2f` | production | error | — | `04944ff7` | 2026-03-26T17:16 | cleanup no, recipient no | not served (errored build) | — |
| 31 | `69c5734f1e03310008689787` | production | error | — | `8b2161af` | 2026-03-26T17:56 | cleanup no, recipient no | not served (errored build) | — |
| 32 | `69c573c01a6eb9152a1e0e05` | production | error | — | `8b2161af` | 2026-03-26T17:58 | cleanup no, recipient no | not served (errored build) | — |
| 33 | `69c6c1671a9e6f000891e745` | production | ready | — | `87812bc8` | 2026-03-27T17:41 | cleanup no, recipient no | no functions | — |
| 34 | `69caae5146f24d000830080b` | production | ready | — | `ae703568` | 2026-03-30T17:09 | cleanup no, recipient no | no functions | — |
| 35 | `69cab0a9cfbad00008128a4d` | production | ready | — | `a2a8ed19` | 2026-03-30T17:19 | cleanup no, recipient no | no functions | — |
| 36 | `69e64c05c1c063000825700f` | production | ready | — | `88f31d9f` | 2026-04-20T15:53 | cleanup no, recipient no | no functions | — |
| 37 | `69e64dfa39d3bb0008010262` | production | ready | — | `578708f3` | 2026-04-20T16:02 | cleanup no, recipient no | no functions | — |
| 38 | `69e64f040b7f8300089fa0bf` | production | ready | — | `b017062e` | 2026-04-20T16:06 | cleanup no, recipient no | no functions | — |
| 39 | `69e650e7e079d80009425b45` | production | ready | — | `0e29ae53` | 2026-04-20T16:14 | cleanup no, recipient no | no functions | — |
| 40 | `69e6520f6159c30007ba6b36` | production | ready | — | `f2baa5db` | 2026-04-20T16:19 | cleanup no, recipient no | no functions | — |
| 41 | `69e6536d7b02de000824ae43` | production | ready | — | `e33b9b27` | 2026-04-20T16:25 | cleanup no, recipient no | no functions | — |
| 42 | `69ea36aeb2dda00008e70a72` | production | ready | — | `daabfd80` | 2026-04-23T15:11 | cleanup no, recipient no | no functions | — |
| 43 | `69efa0b08ea1ab000890255c` | production | ready | — | `235b4f6f` | 2026-04-27T17:45 | cleanup no, recipient no | no functions | — |
| 44 | `69f14065910c4b0008582fab` | production | ready | — | `bfab350b` | 2026-04-28T23:19 | cleanup no, recipient no | no functions | — |
| 45 | `69f22000a432d10009e94ae1` | production | ready | — | `83a388e5` | 2026-04-29T15:13 | cleanup no, recipient no | no functions | — |
| 46 | `69f224adedf71d0008d9e594` | production | ready | — | `646c5050` | 2026-04-29T15:33 | cleanup no, recipient no | no functions | — |
| 47 | `69f22a441f1e470008c2035f` | production | ready | — | `05c31f42` | 2026-04-29T15:56 | cleanup no, recipient no | no functions | — |
| 48 | `69f22d7881e2640008efa7d9` | production | ready | — | `44725df8` | 2026-04-29T16:10 | cleanup no, recipient no | no functions | — |
| 49 | `69f3807a7b6dab0008ba11b0` | production | ready | — | `c76c05a5` | 2026-04-30T16:16 | cleanup no, recipient no | no functions | — |
| 50 | `69f38269259b900008acf551` | production | ready | — | `0683428d` | 2026-04-30T16:25 | cleanup no, recipient no | no functions | — |
| 51 | `69fa0ad99c9e0d00085e127e` | production | ready | — | `6e499757` | 2026-05-05T15:20 | cleanup no, recipient no | no functions | — |
| 52 | `69fa0b4a68636e0008d4c737` | production | ready | — | `1b352edc` | 2026-05-05T15:22 | cleanup no, recipient no | no functions | — |
| 53 | `69fa1be4edf1e30008441400` | production | ready | — | `0c1179de` | 2026-05-05T16:33 | cleanup no, recipient no | no functions | — |
| 54 | `69fb76a1ed26cb0008cf35f6` | production | ready | — | `17e3812c` | 2026-05-06T17:13 | cleanup no, recipient no | no functions | — |
| 55 | `6a185e3a9454ad3908173c59` | production | ready | — | `32e3311e` | 2026-05-28T15:24 | cleanup no, recipient no | no functions | — |
| 56 | `6a185f5f4ea61b00089dbd24` | production | ready | — | `8e94f58a` | 2026-05-28T15:29 | cleanup no, recipient no | no functions | — |
| 57 | `6a3186871b78390008bc6769` | production | ready | — | `f5c1287b` | 2026-06-16T17:23 | cleanup no, recipient no | no functions | — |
