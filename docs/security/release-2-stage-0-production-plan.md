# Release 2 — stage 0, production half

**Status: PLAN FOR REVIEW, revision 2. Nothing here has been applied to
production, and production stays blocked until this revision is accepted.**

Revision 2 answers Codex's review of `8913a69`, which returned AMEND. That
review accepted the staging reconciliation and the deploy deletions. The
revision resolves the review's items F-1…F-8, B1…B6 and the five F5 rulings,
and qualifies three staging artifacts as superseded (§G). Section H maps
each item to where it is resolved.

The artifacts this plan names are committed beside it and pinned by hash in
`docs/security/stage0-production-manifest.json` (§A7), which
`scripts/tests/stage0-manifest.test.js` checks:
- the five rollback companions (§A6);
- the production proofs (§E3);
- the assembler that emits every SQL text run against production (§E1).

Where this prose and the manifest disagree, the manifest is authoritative, and
the disagreement is a defect in this document.

Order of the production steps, each ending at a stop point for Ryan:

| step | what | changes production? | section |
|---|---|---|---|
| P0 | read-only preconditions and positive identity | no (read-only SELECTs) | E2 |
| P1 | rehearsal of 01–05 + proofs + rollbacks, one transaction, `ROLLBACK` | no (rolled back) — **but holds ACCESS EXCLUSIVE on `employees` for its duration: counter closed** | E3 |
| P2 | apply 01–05, one wrapper transaction each, byte-checked | **yes — database; 01 closes the counter** | E4 |
| P3 | post-apply read-back, snapshot refresh | no | E5 |
| P4 | env: `RELEASE2_ENABLED` (Functions, Production), fresh build of the pinned source; evidence (a)/(d) + runtime-enabled evidence; dark Phase 1 | **yes — env + deploy** | D |
| P5 | credential transition (rehearsed on staging first, C3) | **yes — keys** | C |
| P6 | delete the production-ref refusal — the LAST change | **yes — code** | F1 |
| P7 | verification: Phase 1 401s, unmasked preview refusal, positive probes | writes probe rows | F2 |

G0 passes when P0–P7 are recorded against the acceptance list in F3. Every
stop point records the deploy id, if one exists, and the commit it was built
from. That commit is checked against the manifest's pinned trees (§A3, B6).

---

## A. Manifest — exactly what reaches production

**A1. Migrations**, applied in this order. The blobs are unchanged since their
first commits; `git rev-parse <commit>:<path>` returns the blob ids below.

| # | file (today in `supabase/migrations/pending/`) | git blob | md5 | bytes | staging ledger (reconciled) |
|---|---|---|---|---|---|
| 1 | `release2_01_identity_schema.sql` | `3ea8abb3…` | `e97a5fd7c346a3b0a39bc6180dcfde46` | 13 720 | `20260928160657` |
| 2 | `release2_02_auth_attempts_fn.sql` | `f8d9a997…` | `734e0db7312b79081a769ca366c5b99a` | 6 406 | `20260928160722` |
| 3 | `release2_03_bind_and_atomicity.sql` | `3666b539…` | `302e05c6a4939eb8021234cbc7325473` | 13 062 | `20260928160802` |
| 4 | `release2_04_staff_session_qualify_columns.sql` | `df1a5da0…` | `2dcb03eb36e47c8404a29500151e8394` | 5 858 | `20260928160825` |
| 5 | `release2_05_revoke_enrollment.sql` | `ca2e83ea…` | `22b5010b9a3b20f5a3aaba4d212fd46c` | 5 622 | `20260928160847` |

The full blob ids are in the manifest. Every md5 is of the git blob bytes (LF),
never of a Windows working-tree copy (`core.autocrlf=true` on the operator's
machine).

**A1a. Intermediate expectations, per migration (B2).** After each apply, P2
checks exactly the state that migration produces, not the final catalog. The
full A2 is compared only after 05. Signatures are in catalog form
(`proname(oidvectortypes(proargtypes))`). An ACL is the grantee=privilege
set from `aclexplode(coalesce(proacl, acldefault('f', proowner)))`. The
`coalesce` matters: a NULL `proacl` means PUBLIC may execute, and a bare
`aclexplode(proacl)` would report it as empty.

| after | Release 2 functions that must exist — and no others | `md5(prosrc)` | EXECUTE grantees |
|---|---|---|---|
| 01 | `redeem_enrollment_ticket(bytea, bytea, bytea, text)` | `c024388886897f01a1154d8d12dc8996` | postgres, service_role |
| 02 | the above, plus `release2_record_attempt(text, text, integer, integer, integer)` | `fa208910f744eead2bdd14445d1d89d8` | postgres, service_role |
| | plus `release2_clear_lockout(text, text, uuid)` | `f06f2b206a8f6675668ec43f1b6ec384` | postgres, authenticated, service_role |
| 03 | `release2_clear_lockout(text, text, uuid)` **gone**; `release2_clear_lockout(text, text, uuid, uuid)` | `b7f602cde969f2f2622c0d2343b1c249` | postgres, authenticated, service_role |
| | `release2_record_attempt(…)` replaced in place | `e67957595afcc7a51d7f8673000d9302` | unchanged: postgres, service_role |
| | `release2_create_staff_session(uuid, uuid, bytea, bytea, timestamp with time zone, timestamp with time zone)` | **`bd6da6a2f80e13c7b20deab3b2c76e63`** (03's body, the 42702 defect) | postgres, service_role |
| | `release2_prune_auth_attempts(integer)` | `ee254949f88474c58284b8a2c1ba3cb0` | postgres, service_role |
| 04 | `release2_create_staff_session(…)` replaced in place | `d30da6d0c7a4d14e1bcb1b9fcace37d9` | unchanged |
| 05 | plus `release2_revoke_enrollment(uuid, uuid, text)` | `a464a43cc72537bb02b3e4a1d904f655` | postgres, service_role — **now the full A2** |

At every step:
- all Release 2 functions are `SECURITY DEFINER` with
  `proconfig = {search_path=public}` and a non-null comment;
- the six tables of 01 exist with RLS on, 0 policies, and grantees exactly
  {postgres, service_role};
- `employees_id_store_uniq` is `UNIQUE (id, store_id)`.

The two 02 bodies are the only values in this table not observed in a
`pg_proc` somewhere. They are derived from the committed `$fn$` bodies by the
same script whose other six derivations matched staging's `pg_proc` exactly
(R3). P1 checks all of them in the database before anything is applied.

**A2. Final objects** — what the database must contain after 05, and nothing
more:
- **Tables (6):** `device_enrollments`, `enrollment_tickets`, `staff_sessions`,
  `upload_capabilities`, `upload_capability_files`, `auth_attempts`. Each
  has `relrowsecurity = true` and **0 policies**. The grantee set is exactly
  {postgres, service_role}, each holding the server's full table privilege
  set (`arwdDxtm` on staging; the `m`, MAINTAIN, exists only from PG 17, so
  the proofs compare against `acldefault('r', relowner)` rather than a
  literal).
- **One constraint on an existing table:** `employees_id_store_uniq UNIQUE (id, store_id)`.
- **Functions (6):** the "after 05" rows of A1a.
- **Nothing else changed:** P1 proves this by catalog-set equality over the
  whole `public` schema (§E3).

**A3. Code, pinned (B6).** "The stage-0 content merged to `main`" is replaced
by content addresses. The manifest's `a3` block names a commit on this branch
and the git TREE id, at that commit, of each path that reaches the production
build:
- trees: `netlify/`, `src/`, `public/`;
- blobs: `netlify.toml`, `package.json`, `vite.config.js`, `index.html`,
  `upload.html`, `scripts/write-deploy-context.mjs`,
  `scripts/inject-sw-manifest.mjs`, `scripts/tests/inventory-check.mjs`,
  `scripts/tests/inventory-allowlist.mjs`.

A squash merge onto an unchanged `main` reproduces those trees under a new
commit SHA, so the binding is by tree, not by SHA. **At the P4, P5 and P6 stop
points the deploy's `commit_ref` is resolved and each pinned path is compared
with `git rev-parse <commit_ref>:<path>`**; any difference stops the step. The
ref refusal is still present in A3.

The refusal deletion (P6) is a separate, later PR touching only
`netlify/lib/release2.js`, its header comment, and the tests that pin the
refusal (`release2-guard.test.js`, DC-13). The manifest gains a `p6` block
with the new `netlify/` tree in that PR.

**A4. Environment.** Production site `printcalculator2`, set in the Netlify
dashboard by Ryan:

| variable | value | scope | context |
|---|---|---|---|
| `RELEASE2_ENABLED` | `true` | **Functions** | **Production** only |
| `RELEASE2_ALLOWED_ORIGINS` | `https://printcalculator2.netlify.app` | Functions | Production |
| `RELEASE2_CONTEXTS` | **not set** (default `production`) | — | — |
| `SUPABASE_SERVICE_ROLE_KEY` | a new secret key, replaced in P5 (§C). The value is never in the repo, a session or this plan | — | — |
| Functions `VITE_SUPABASE_ANON_KEY` | verified `sb_publishable_…` by prefix in C8 before anything legacy is disabled | — | — |

**A5. Repository moves** in the P2/P3 commits:
- each migration and its `.rollback.sql` companion is `git mv`'d from
  `pending/` to `supabase/migrations/<production version>_<name>…`;
- `supabase/tables.json` is recaptured;
- the manifest gains the production versions;
- the `deploy-inventory.md` retained-deploy table is refreshed after P4 and
  after P5.

**A6. Rollback files — committed before P1, rehearsed inside P1.** They are
companions in the repo's convention:
`supabase/migrations/pending/release2_0N_<name>.rollback.sql`, one per
migration. Each carries:
- a **positive production guard** (§E2 identity markers — the staging-seed
  inverse alone was not enough, F-6);
- a check that its own forward migration is in the ledger with A1's md5;
- a check that the database is in the exact state the forward migration left
  (A1a).

The procedure runs them only as these **four operations**. RB-43's pairing is
enforced by its marker; the other files are guarded by identity and state, but
not by an operation marker:

| operation | files, in order, ONE transaction | effect | guard beyond identity |
|---|---|---|---|
| RB-5 | 05rb | drop `release2_revoke_enrollment` | A1a "after 05" state |
| **RB-43** | **04rb then 03rb** | 04rb re-creates 03's `release2_create_staff_session` body (`bd6da6a2…`) with its exact ACL and comment. 03rb then drops it and `release2_prune_auth_attempts`, drops the four-argument `clear_lockout`, and re-creates 02's `clear_lockout(text,text,uuid)` (body `f06f2b20…`, ACL postgres/authenticated/service_role, comment). It also restores 02's `record_attempt` body (`fa208910…`) and comment by `CREATE OR REPLACE`, which keeps its ACL | both files refuse unless the transaction-local marker `release2.rollback_op = 'RB-43'` is set, which only the RB-43 wrapper sets. 03rb also refuses unless the staff-session body is `bd6da6a2…`, i.e. unless 04rb ran first in this transaction |
| RB-2 | 02rb | drop both 02 functions | A1a "after 02" state |
| RB-1 | 01rb | drop the redeem function, the six tables, the constraint. **Closes the counter:** dropping the constraint takes ACCESS EXCLUSIVE on `employees`, and dropping the tables locks the tables their foreign keys reference (§E0) | **the five identity/capability tables hold zero rows** (§F4, F-7). `auth_attempts` rows are limiter counters and are disposable; the guard reports their count |

Why RB-43 is one operation (F5 ruling 2): the state between 03 and 04 is the
42702 defect, so restoring it alone has no use. Two transactions would leave a
window in which the defective body exists. Every re-created function carries
its explicit `revoke … from public, anon, authenticated, service_role`
(PUBLIC first, CLAUDE.md rule 4) and its grants in the same file, and re-issues
its comment. `DROP` + `CREATE` resets both, so neither is left to the
default.

**A7. The manifest is REQUIRED (F5 ruling 1).**
`docs/security/stage0-production-manifest.json` holds:
- A1 (paths, blob ids, md5, bytes);
- A1a and A2 (signatures, intermediate and final `md5(prosrc)`, ACL sets,
  catalog expectations);
- A3 (commit + trees);
- A6 (the five rollback files' blob ids, md5, bytes, and the four operations);
- the proofs file's blob id and md5;
- the assembler's blob id and the md5 of **every SQL text it emits** (§E1).

`scripts/tests/stage0-manifest.test.js` reads **git blob bytes** (`git show
<rev>:<path>`, so CRLF on a Windows checkout cannot change an md5). It checks:
- every md5, byte count and blob id;
- each pinned commit resolves the pinned objects (tolerated as absent only in a
  shallow clone, which the test detects rather than assumes);
- each `md5(prosrc)` re-derived from the `$fn$` bodies of the committed
  forward and rollback files;
- each assembled output re-assembled and re-hashed;
- that no working-tree copy of a pinned file differs from its HEAD blob other
  than by line endings.

P0–P3 compare against the manifest, not against this prose.

---

## B. Retained-deploy table

The table was probed write-free at 2026-09-28T16:12:14Z. It is unchanged from
revision 1 and given in full in the appendix.
- **Key presence:** `POST {}` to `start-upload`, which is **presence only** (B1;
  see C6).
- **Fixes:** `git merge-base --is-ancestor` against `9c99bbf`/`7f89876`
  (cleanup) and `1ce7849`/`10235f2` (#43 recipient).
- **Summary:** 57 deploys listed; the four that hold the production
  service-role key are the four kept on purpose.

**B1. The old-key set is re-taken after P4 (B4).** P4's fresh production build
is itself a new deploy that captures the OLD key, and so does any build before
P5. The set of URLs that P5's revocation must cut off is therefore the table
re-taken **after P4 and immediately before the revocation step (C4.7)**, not
this appendix. The same table is taken again after P5.

**B2. Rollback targets are a named list (B4)**, each a reviewed commit that is
compatible with the post-stage-0 database. The migrations are additive, and no
listed commit's client or functions name a Release 2 object.

| commit | deploy today | role |
|---|---|---|
| `7ec5af4` | `6ab020c50a788b0008d430c9` | published before P4 |
| `9937728` | `6aad56a391c0cf0008d215fd` | rollback target |
| `89de03e` | `6aa994d535444e0008272512` | rollback target |
| `7f89876` | `6aa59114f573770008fb8dd5` | rollback target |
| the A3 commit | P4's deploy | published from P4 |

A rollback to anything not on this list is a new review. After P5 a rollback
is a **fresh build** of a listed commit, never a republish: the kept deploys'
functions hold the revoked key (C9).

**B3. Re-probe the retained URLs after every rollback rehearsal and every
inventory-changing build.** Any build of the production site adds a key-holding
deploy until P5. After P5, any republish would reinstate a revoked key. Each
re-probe is the C6 matrix, recorded per URL with its date.

---

## C. Credential transition (P5)

**C1. Facts it rests on.**
- No production client bundle has ever carried a legacy JWT key. Every ready
  production deploy with a client embeds `sb_publishable_…` (read
  2026-09-24).
- **Netlify secret environment values are write-only** (F-4): the dashboard
  and the API do not return them. Revision 1's step "establish the key type
  from the prefix shown in the Netlify dashboard" is **withdrawn** — no such
  prefix is shown. The type of the credential production's functions
  captured must be bound another way (C4), or treated as unknown.
- `VITE_SUPABASE_ANON_KEY` is read **at runtime by the Functions**, not only
  at build: by `resolveOwnerUser()` in `netlify/lib/release2-auth.js` (for
  `enroll-list` and `enroll-revoke`) and by `enroll-ticket-create`'s own copy.
  That runtime value comes from the deploy's Functions environment. Which
  value it is (a dashboard value, or the committed `netlify.toml` value) is
  established by C8, not assumed.

**C2. Consumers.**
- **Service key:**
  - every legacy function: `start-upload`, `register-job`, `fetch-link-job`,
    `get-download-url`, `complete-job`, `send-print-job`;
  - the secret-gated `cleanup-stale-jobs`;
  - the Release 2 functions, via `serviceClient()`.
- **Functions anon key:** the three owner-auth paths above.
- **Outside the repository:** Ryan lists any other holder of either key
  (operator `.env.local` files, scripts, integrations) before C4.7. The list
  is part of the record.

**C3. Rehearsal on staging first — PROPOSED, awaiting approval, not run.** It
is the whole of C4 on staging, with staging's keys, and must also demonstrate:
1. **The distinguishing authenticated read (C6 row R).** Staging uses a
   nonexistent slug like production. The read must return **accepted**
   (`400 Unknown store: …`) on a deploy holding a valid key, and **refused**
   (`500 Store lookup failed: …`) on:
   - (a) a staging branch deploy built with a syntactically valid but
     nonexistent `sb_secret_…` value — **the invalid-key control**;
   - (b) a staging deploy that captured the old key, after the old key is
     revoked.

   The exact refusal message is recorded for **both revocation kinds**: a
   deleted secret key and disabled legacy JWT keys. P5 accepts only those
   recorded messages.
2. **The cleanup read.** An authorized `POST` with `x-cleanup-key` and
   `{"dryRun":true}` reaches its SELECT: `200` with `dryRun:true` on a valid
   key, and `500` with the recorded message on the control.
3. **supabase-js accepts a `sb_secret_` key** for the service path. The
   legacy writers' `createClient` with the new key gets the accepted answer
   in (1).
4. **Owner Auth validation after legacy keys are disabled:** `enroll-list`
   with a live owner token returns `200` on a staging deploy whose Functions
   `VITE_SUPABASE_ANON_KEY` is `sb_publishable_…`. This is F-5's mechanism,
   proven where the endpoints are open.
5. **Re-enabling legacy JWT keys restores the SAME keys, or not.** This decides
   how dangerous C9's break-glass is.
6. **Which provider-side record ties a refusal to the credential.** Supabase's
   API logs for the probe timestamps show whether an entry carries anything
   that identifies the key (a key name or prefix) or only a status. Whatever
   they carry is what C6's provider-side column may rely on in production.

**C4. Binding the captured credential's type (F-4).** The old credential is
either the legacy `service_role` JWT or one of the project's secret API keys.
Evidence, in order:
1. **Deploy provenance.**
   - Netlify shows each variable's *last updated* time even for secret values.
   - Supabase's API Keys page shows each secret key's name and creation time.
   - Ryan records both (names, types and times — never values).
   - If the variable was last written **before any secret key existed in the
     project**, the captured value can only be the legacy JWT.
2. **A reviewed private type-only check — rejected as a route.** Every
   function on Netlify is a public URL, so a route that classifies the key
   would be a new unauthenticated surface. Not proposed.
3. **Otherwise the type is UNKNOWN, and the retirement set is every
   possibility:**
   - disable legacy JWT-based keys (only after C8 passes);
   - delete **every secret API key that existed before C5.2**.

   The recorded key inventory from (1) is that list. Nothing the old
   credential could be survives. This costs any other holder of a pre-existing
   secret key its access, which is why C2's outside-the-repo list is taken
   first.

**C5. Steps on production.** Ryan performs them in the dashboards; this
session never sees a key.
1. Record the key inventory and the variable metadata (C4.1). Re-take the old-key
   set (B1).
2. **Create a new secret API key** (`release2-stage0-<date>`).
3. **Move the consumers:** `SUPABASE_SERVICE_ROLE_KEY` for Functions,
   Production context, set to the new key.
4. **Fresh build of the pinned source** ("Clear cache and deploy site" on the
   branch whose tip matches A3's trees — a build, never a republish). Record
   the deploy id and `commit_ref`, compare the A3 trees, and publish.
5. **Current-deploy proof** (C6, rows marked *current*) on the new deploy:
   - presence;
   - the distinguishing read, which must be **accepted**;
   - the canary mail (C7), which must show `recipientSource = "store:store4979"`;
   - the cleanup dry run (C7), if authorized;
   - the counter check by Ryan: a real order save and the queue tab.
6. **Historical baseline, BEFORE revocation.** Each URL in the old-key set gets
   the distinguishing read, which must be **accepted**. Without this baseline
   a later refusal cannot be attributed to the revocation.
7. **Revoke**, per C4:
   - delete the old secret key;
   - or disable legacy JWT-based keys, only after C8;
   - or both, when the type is unknown.
8. **Historical proof.** Each URL in the old-key set gets the C6 matrix. The
   distinguishing read must now be **refused** with a C3-recorded message.
   The routes that cannot distinguish get C6's provider-side evidence and the
   same-deploy binding.
9. **Current deploy re-probed after revocation.** The distinguishing read must
   still be **accepted**, which proves the revocation missed the new key. C8's
   owner-auth check follows.
10. **Provider-side record:**
    - the API Keys page state (old key gone, or legacy keys disabled), with
      its time;
    - the log entries C3 showed are meaningful.

**C6. Probe matrix (B1).** "Pre-auth" means the handler answers before any
Supabase request. **`start-upload {}` is pre-auth: an invalid key gets the same
400 with zero outbound requests, so it proves presence and nothing else.**

| row | route and request | stage | valid key | invalid / revoked key | distinguishes? | writes? | use |
|---|---|---|---|---|---|---|---|
| P | `start-upload` `POST {}` | pre-auth | `400 fileName required` | same | **no** — presence only | no | current + historical, presence |
| **R** | `register-job` `POST {"customerName":"R2-PROBE","files":[{"path":"r2-probe/none"}],"storeSlug":"r2-probe-nonexistent"}` | post-auth: `stores` SELECT with the key, then returns before any insert | `400 Unknown store: r2-probe-nonexistent` | `500 Store lookup failed: <C3-recorded message>` | **yes** | **no** — returns before the insert. P0 proves no store has that slug. Readback per §4.2: `pending_jobs` count for `customer_name='R2-PROBE'` = 0 | **the** distinguishing read: current + historical + control |
| D | `get-download-url` `POST {"paths":["r2-probe/none"]}` | post-auth | `200 {urls:[{url:null}]}` | `200 {urls:[{url:null}]}` | **no** — auth failure and missing object collapse | no | provider-side evidence + same-deploy binding |
| X | `complete-job` `POST {"id":"00000000-0000-0000-0000-000000000000"}` | post-auth | `404 Job not found` | `404 Job not found` | **no** | no. P0 proves no `pending_jobs` row has the nil id, which `gen_random_uuid()` never produces | provider-side evidence + same-deploy binding |
| F | `fetch-link-job` `POST {}` | pre-auth | `400 customerName and url required` | same | no | no. Its post-auth path fetches a Google URL and uploads, so it is never probed past pre-auth | presence + same-deploy binding |
| M | `send-print-job` | — | — | — | via the function log only (C7) | **sends mail** | current deploy only, the canary |
| C | `cleanup-stale-jobs` `POST` + `x-cleanup-key` + `{"dryRun":true}` | post-auth: SELECT, returns before any delete | `200 {dryRun:true,…}` | `500 <message>` | yes | no. Every kept commit's handler supports `dryRun` (verified in git at `7f89876`, `89de03e`, `9937728`, `7ec5af4`) | current deploy, only if `CLEANUP_SECRET` is set and Ryan authorizes (C7) |

**Same-deploy binding, stated as an inference, not a proof.** Netlify gives
every function in one deploy the same environment snapshot. So row R refusing
on a deploy means that deploy's signer (D), deleter (X), link fetcher (F),
mailer and cleanup captured the same revoked value. This is what covers each
legacy writer, the signer and the deleter per URL, as §4.2 of the data-path
plan requires, where the route cannot distinguish. The provider-side record
(C5.10) is the independent evidence. Where C3 shows the logs identify the
key, those entries are recorded per probe; where they show only a status, the
record says so.

**C7. Mail and cleanup proofs (F-3).**
- **Mail.** `send-print-job` falls back to the compiled-in address on any
  lookup failure (`fallback:lookup-miss`, `fallback:no-db`, `fallback:threw`),
  and a delivered email looks the same either way. **Delivery alone proves
  nothing about the key.** The proof is an **operator-authorized, identified
  canary**:
  - Ryan sends one order through the app, subject `R2-CANARY-<date>`, from
    the counter;
  - the Netlify function log line `send-print-job recipient resolved` for
    that request shows `recipientSource: "store:store4979"`;
  - the canary is delivered to the store mailbox.

  Both are recorded, the log line and the delivery. **Any `fallback:*` fails
  C5.5.**
- **Cleanup.** The scheduled invocation cannot send `x-cleanup-key`, so on
  production cleanup is **paused unless something authenticated calls it**.
  Before P5 is approved, Ryan answers: is `CLEANUP_SECRET` set on production,
  and does any caller (pg_cron + pg_net, a GitHub Action, a person) send it?
  - **If a real authenticated scheduler exists:** it is identified by name,
    and its next run after C5.4 must succeed (its log line). The authorized
    dry run (row C) is also recorded on the new deploy.
  - **If none exists:** cleanup is **recorded as paused**. The dry run is
    still run once if the secret is set, as a second distinguishing read.
    Re-arming the schedule is a separate decision, not part of G0.

**C8. The Functions anon key (F-5).** Before any legacy key is disabled:
- Ryan reads the production Functions `VITE_SUPABASE_ANON_KEY` value in the
  dashboard and records **its prefix only**. It is not a secret, but only the
  prefix goes in the record. It must be `sb_publishable_`.
- If it is not, it is set to the production publishable key, followed by a
  fresh build, **before** C5.7.
- "Consumed by a fresh deploy": the recorded value must predate the created
  time of the deploy under test.

After revocation, owner Auth validation is proven on production by the first
P7 step, run **before any other P7 probe**: `enroll-list` with a live owner
token → `200`. P7 is after P6, when the endpoint answers. Until then, C3.4
is the mechanism's proof. A `401` there, with the token proven live by
`GET /auth/v1/user` → `200`, means owner auth is broken. The recovery is C8's
fix, not a retry.

**C9. Rollback of C (B4).**
- **Before C5.7:** set `SUPABASE_SERVICE_ROLE_KEY` back to the old key's value,
  which Ryan copies from the Supabase dashboard (the value is still valid),
  followed by a fresh build.
- **After deleting a secret key:** it cannot return. Create another key and
  repeat C5.3–C5.5.
- **After disabling legacy JWT keys — BREAK-GLASS.** Re-enabling them (if C3.5
  shows the same keys return) **re-opens every retained deploy that captured
  the legacy key**. So:
  - re-enabling **revokes G0** (the acceptance record is marked void);
  - the reopened URLs are recorded, from the B1 table at that moment;
  - retirement is restored — the keys disabled again, or those deploys
    deleted and their 404s probed — before any other step proceeds.

  **The preferred path is a replacement secret key**, never re-enabling.

After C, every rollback of the site is a fresh build of a B2-listed commit,
never a republish. Afterwards, B3's re-probe.

**C10. Timing (F5 ruling 3, accepted):** after P4 (the flag and the context
check are live, the ref refusal still blocks) and **before P6**, so no
retained bundle holds a working key when the endpoints open.

---

## D. Evidence (a) and (d), and the runtime flag, with the refusal present (P4)

The production-ref refusal stays in the code throughout P4, so production's
Release 2 endpoints keep answering 404.

1. Ryan sets A4's `RELEASE2_*` variables, then a fresh production build of the
   pinned source (A3). **Stop point:** the deploy id, its `commit_ref`, and the
   A3 tree comparison.
2. **(a)** `GET …/.netlify/functions/deploy-context` → `200`,
   `context:"production"`, `siteName:"printcalculator2"`, `deployId` = the P4
   deploy, `flagPresent:true`, `contextAllowed:true`, `source` recorded.
3. **(d)** The production half is (a)'s `flagPresent:true`. The preview half is a
   **fresh** production-site deploy preview built after the env change,
   showing `context:"deploy-preview"` and `flagPresent:false`.
4. **Runtime-ENABLED evidence (B5), separate from presence.** `flagPresent` is
   scoping evidence: it proves the variable reached the runtime, not that the
   gate's predicate (`RELEASE2_ENABLED === "true"`) holds. One of the
   following, recorded before P6:
   - **(i) Proposed: a reviewed boolean diagnostic.**
     - `deploy-context` gains `flagEnabled`, computed by a predicate exported
       from `netlify/lib/deploy-context.js`, which the gate's condition 1
       also imports. The two can then never disagree.
     - It reports the boolean only, never the value. The route stays GET-only,
       imports only the shared reader, and reads no `SUPABASE_*` value.
     - It is a code change. It changes A3's `netlify/` tree, and the manifest
       is updated in the same reviewed PR. **Not implemented in this round;
       awaiting approval.**
   - **(ii) If (i) is declined: operator-bound evidence.**
     - Ryan records the variable's value (`true` is not a secret), its scope
       and context, and its last-updated time.
     - That time must precede the P4 deploy's created time, bound by deploy id.
   - After P6 the gate itself evaluates the predicate, and Phase 1's 401s are
     the runtime proof. (i) or (ii) is what makes it known **before** the
     refusal is deleted.
5. **Dark baseline:** Phase 1 → four JSON `404`. The context-alone refusal is
   already proven on staging (0b-staging, 2026-09-24).
6. The counter is unchanged: an order save and the queue tab.
7. **B1 re-taken**, because P4's deploy holds the old key.

**`deploy-context` after G0 (F5 ruling 4): kept.** It stays GET-only and
non-secret: no `SUPABASE_*` read, no value of any variable, booleans and build
metadata only. `release2-deploy-context.test.js` asserts all three.

---

## E. Bounded migration procedure (P0–P3)

**E0. Bounds (F-1, corrected).** Revision 1 called 01's lock brief and said it
blocked only writes. **That was wrong.**
- **`ALTER TABLE employees ADD CONSTRAINT … UNIQUE` takes ACCESS EXCLUSIVE on
  `employees`.** ACCESS EXCLUSIVE conflicts with every lock mode, including the
  ACCESS SHARE a plain SELECT takes. It is held **until the transaction ends**.
  While it is held, these block:
  - `verify_employee_pin` (staff sign-in, kiosk exit);
  - any order save (its employee foreign key takes a row lock on `employees`);
  - anything else that reads `employees`.
- **The foreign keys 01 creates take SHARE ROW EXCLUSIVE** on `stores`,
  `organizations`, `employees` and **`auth.users`**, which blocks writes to
  them. That includes the `last_sign_in_at` update of any Supabase Auth
  sign-in.
- **P1 holds all of these** for its whole transaction, because it runs 01 first.

Therefore:
- **The counter is closed for P1 and for P2's 01.** The window is outside
  counter hours, the owner is present, no staff are signed in, and the kiosks
  are idle.
- 02–05 touch only objects 01 created, and the same window covers them.
- A gap of more than a day between P1 and P2 means P0 and P1 are re-run.
- A stop means stop, record, and return to review. Never retry in place; never
  edit a file to make a check pass.

**E1. The execution wrapper (F-1).** `apply_migration` runs each call in its
own session, so a `SET LOCAL` sent in a separate call cannot bound the DDL. The
timeouts must be set **in the transaction that executes the DDL**, and A1's
bytes must not change. So **P2 does not use `apply_migration`.** Each step is
one `execute_sql` call whose text is emitted by
`scripts/manual/assemble-stage0.mjs` from git blobs, with every output's md5
pinned in the manifest:

```sql
begin;
select set_config('application_name', 'release2-stage0-P2-01', true),
       set_config('lock_timeout', '3s', true),
       set_config('statement_timeout', '45s', true),
       set_config('idle_in_transaction_session_timeout', '10s', true);
-- PG >= 17 only (P0 reads server_version_num); the assembler emits this line
-- only when the manifest's p0.serverVersionNum says so:
select set_config('transaction_timeout', '45s', true);
do $stage0_wrap$
declare
  f   constant text := $stage0_file$<A1 file bytes, verbatim>$stage0_file$;
  v   text;
begin
  -- the settings above are in force in THIS transaction, or nothing runs
  if current_setting('lock_timeout') <> '3s' or current_setting('statement_timeout') <> '45s' then
    raise exception 'stage0 wrapper: timeouts not in force' using errcode = 'P0001';
  end if;
  <positive identity guard, §E2>                       -- refuses staging and unknown datasets
  if md5(f) <> '<A1 md5>' or octet_length(f) <> <A1 bytes> then
    raise exception 'stage0 wrapper: bytes differ from the manifest' using errcode = 'P0001';
  end if;
  <A1a "before" state assertion>                       -- e.g. 03 refuses unless the "after 02" state holds
  execute f;
  <A1a "after" state assertion>                        -- the per-migration expectation; any deviation raises
  v := to_char(clock_timestamp() at time zone 'utc', 'YYYYMMDDHH24MISS');
  if v <= (select max(version) from supabase_migrations.schema_migrations) then
    raise exception 'stage0 wrapper: version % not after the ledger head', v using errcode = 'P0001';
  end if;
  insert into supabase_migrations.schema_migrations (version, name, statements)
  values (v, '<name>', array[f]);                      -- statements[1] IS the md5-checked literal
  if clock_timestamp() - transaction_timestamp() > interval '40 seconds' then
    raise exception 'stage0 wrapper: deadline exceeded' using errcode = 'P0001';
  end if;
end
$stage0_wrap$;
commit;
```

How it bounds and aborts:
- **`lock_timeout` 3 s bounds the wait for ACCESS EXCLUSIVE.** A counter
  transaction that holds `employees` makes the wrapper fail rather than queue.
  A queued ACCESS EXCLUSIVE request would itself block every later reader.
- **The whole migration is ONE statement** (the `DO` block), so
  `statement_timeout` 45 s is a **whole-transaction deadline** for the DDL and
  the ledger write. `transaction_timeout` backs it up where the server has it.
  The explicit deadline check is last.
- **Timeout, cancel, error.** A timeout, a `pg_cancel_backend` on the session
  (found in `pg_stat_activity` by its `application_name`), or any raised check
  aborts the transaction. PostgreSQL releases the locks at abort, and the
  `COMMIT` becomes a rollback. If the client vanishes mid-transaction,
  `idle_in_transaction_session_timeout` ends the session.
- **Whether a step committed** is decided only by the read-back (E4): the
  ledger row with A1's md5 either exists or it does not.

**The ledger row** is written by the wrapper, **in the same transaction as the
DDL**, so they commit or roll back together:
- `version` is the UTC timestamp at execution, in `apply_migration`'s own
  14-digit format, and must be after the ledger head. In P2 and the RB
  operations, a version not after the head stops the step. In P1 only, whose
  ten rows fall within a second or two and are rolled back, it is bumped to
  head + 1. A second row in one transaction (RB-43) is stamped one second
  later, so the next step waits for the clock to pass it;
- `name` is the file's name without `.sql`;
- `statements` is `array[f]`, so `statements[1]` is **the md5-checked
  literal**, byte for byte.

P0 reads the ledger table's column list. The wrapper's three-column insert is
used only if every other column is nullable or defaulted; otherwise P0 stops
for review. The P2 file is then named by the version read back (CLAUDE.md rule
4, whose intent — a file for every ledger row, byte-identical to
`statements[1]` — is met; the tool is different, and that is why it is stated
here).

The dollar-quote tags are chosen by the assembler to not occur in any embedded
file, and it refuses otherwise. **RB operations use the same wrapper:**
- each file of the operation is md5-gated;
- RB-43 sets `release2.rollback_op` transaction-locally;
- one ledger row is written per rollback file, in the same transaction — RB-43
  writes two, one second apart.

**E2. P0 — read-only preconditions and positive identity (F-2, F-6, B3).**
**Out of band, first:**
- the MCP `project_id` for every call is `gmxyisjjaxtpycsmmzef`;
- `get_project_url` returns `https://gmxyisjjaxtpycsmmzef.supabase.co`;
- both are recorded.

Then the assembled P0 statement, shown to Ryan before it runs. It returns one
row in two groups.

*P0-S — schema and data (restorable; must return identically after any
rollback):*

| column | expect |
|---|---|
| `has_store_role`, `organizations`, `stores_org_id` | true |
| **`stores_without_org`** | **0. If nonzero, STOP; `stores_without_org_ids` returns the store IDs (IDs only) for a separate decision** (F-2). `redeem_enrollment_ticket` raises 23502 for such a store |
| `uniq_already_there` | false |
| `release2_tables_present`, `release2_functions_present` | 0 |
| `catalog_fingerprint` | md5 over the whole `public` catalog (functions with `md5(prosrc)` and effective ACL; relations with RLS and effective ACL; constraints; indexes; policies; non-internal triggers; function comments). Recorded; P1 and any rollback must reproduce it |
| `probe_slug_absent` | true: no store has slug `r2-probe-nonexistent` (C6 row R) |
| `nil_job_absent` | true: no `pending_jobs.id` is the nil uuid (C6 row X) |
| `auth_users_user_triggers` | 0 (the proofs insert synthetic `auth.users` rows; a trigger there would be an unreviewed side effect inside P1) |
| `free_pins` | ≥ 3 (the proofs need three unused four-digit PINs; `employees_pin_unique` is global). Counted, never listed |
| `server_version_num` | recorded (decides `transaction_timeout`) |

*P0-L — the ledger (append-only; it never returns to these values after P2):*

| column | expect |
|---|---|
| `ledger_head` | `20260909232836` |
| `ledger_rows` | 20 |
| `ledger_matches_repo` | true: the set of (version, `md5(statements[1])`) equals the 20 top-level files in `supabase/migrations/` (the assembler embeds the list from git blobs) |
| `release2_in_ledger` | 0 |
| `ledger_columns` | exactly the recorded column list; every column other than version/name/statements is nullable or defaulted |

*Identity (F-6) — positive, all required:*
- `ledger_matches_repo` (above);
- **the production row `20260909232836` named `phase_e_03_order_margin_snapshot`
  with `md5(statements[1]) = b7a8e54c99432c5e0ddb60be4c46505f`**. Staging
  stored that migration under another version, minus its final newline, as
  `b3e58c9b…`;
- **the staging seed store `5ee41000-0000-4000-8000-0000000000a1` absent**;
- a store with slug `store4979` present.

A staging dataset fails the first three. An unknown dataset fails the
ledger-set equality.

Every wrapper and every rollback file carries the same markers in guard form:
- the 20 production rows must be **present**, each with its md5;
- the seed store must be absent;
- `store4979` must be present.

The guard checks that the 20 rows are present, not that the ledger equals
them: the ledger grows after P2, so equality holds at P0 only. A rollback
therefore cannot be pointed at staging, or at a database with another
history, by mistake.

Stop on any unexpected value.

**E3. P1 — rehearsal on production, one transaction, `ROLLBACK`.** It is emitted
by the assembler as one text (md5 in the manifest):
- `begin isolation level repeatable read`;
- the E1 settings, with `statement_timeout` 90 s per statement;
- a whole-transaction deadline asserted at every section boundary, 100 s.

Order:
1. Capture the catalog rows behind `catalog_fingerprint`, and md5s of the real
   rows in the tables the proofs touch (`employees`, `stores`,
   `organizations`, `memberships`, `auth.users`), into temp tables. The md5s
   are compared, never returned.
2. **The P2 wrapper bodies for 01, 02, 03, verbatim**, including their ledger
   inserts. P1 therefore proves the exact P2 text, ledger write included,
   against production's ledger table.
3. Proofs §1: fixtures, and **03's staff-session call raising 42702**. The
   fixtures need a live enrollment, because an unknown one raises 28000
   before the ambiguous statement.
4. Wrappers 04, 05.
5. Proofs §2: the full A2 by catalog-set equality, then the end-to-end calls.
6. Proofs §3: fixture removal. The Release 2 tables hold zero rows, and the
   real-row md5s equal step 1's.
7. RB-5, RB-43, RB-2, RB-1, through the same wrappers, rollback ledger rows
   included.
8. Proofs §4: the catalog equals step 1's, **row for row**; on a mismatch the
   differing identifiers are named.
9. `ROLLBACK`.

**The proofs** (`supabase/rehearsals/release2_stage0_production_proofs.sql`,
sections 0–4 matching steps 1, 3, 5, 6 and 8 above) are **failing assertions,
not a report**. Every check raises `P0001` with its id on any deviation, which
aborts the transaction. Their helpers are `pg_temp` functions, visible only to
this session and gone at the `ROLLBACK`; the catalog fingerprint covers
`public` only. The checks:
- **Principals created inside the transaction** — no real user id is read or
  borrowed:
  - two synthetic organizations and stores, A and B;
  - three synthetic `auth.users`: owner A, manager A, owner B (the
    cross-store principal), each `@example.invalid`;
  - their memberships;
  - staff and manager employees at A, and a staff employee at B, on unused
    PINs.
- **Exact expected errors:** SQLSTATE **and** message (e.g. `28000 ticket not
  redeemable`, `42501 not authorised`, `42702 column reference "store_id" is
  ambiguous`).
- **Unchanged-row checks after every refused call.** The affected rows'
  `to_jsonb` is captured before and compared after: ticket, enrollment,
  sessions, limiter rows.
- **ACLs proven by execution as well as by catalog:**
  - `set local role anon` → `release2_clear_lockout` refused 42501;
  - `set local role authenticated` → `redeem_enrollment_ticket` refused 42501;
  - `authenticated` with owner A's claims → `clear_lockout` on A allowed, on B
    refused, on an unknown subject refused identically.
- **The staging R3 sequence**, with results asserted instead of recorded:
  redeem / replay / expiry, limiter quota, session create / rotate /
  cross-store, revoke with cascade, the P5b refusals before and after, prune.

Stop on:
- any raised check;
- the deadline;
- the post-rollback P0 (re-run after `ROLLBACK`) differing from P0 in **any**
  P0-S or P0-L column. P1 commits nothing, so both groups must be identical.

**E4. P2 — apply, one wrapper transaction per migration.** The assembled
`P2-01` … `P2-05` texts, in order, 03 and 04 back to back. Between them the
staff-session function has 03's body and cannot run. Nothing can call it:
every Release 2 endpoint is refused on production by the ref check, and the
function is `service_role` only.

After EACH step, before the next, a read-only read-back:
- the new ledger row: `version`, `name`, `md5(statements[1])`, `octet_length`,
  final newline. Accept only A1's md5 and byte count — the wrapper inserts the
  literal it checked, so the transport-stripped-newline case cannot arise, and
  the check confirms that;
- A1a's row for that migration, from the catalog.

Anything else stops P2 at that migration, and F4 applies. The `git mv` of each
file and its companion to the production-version name happens in the commit
that records that read-back.

**E5. P3 — post-apply read-back.**
- A2 in full, outside a transaction.
- Then `scripts/manual/tables-snapshot.sql` (read-only), and
  `supabase/tables.json` refreshed. `ledgerVersion` becomes 05's production
  version and the six tables appear. The inventory gate (INV-6) then REQUIRES
  them from applied state, while the browser prohibition on those names stays
  independent.
- The manifest gains the five production versions.
- The inventory suite and the manifest test are green on that commit.

**E6. The rolled-back state, represented (B3).** A rollback of P2 on
production (F4) would end with these rows appended to the ledger, which is
append-only:
- the five forward rows;
- the rollback rows (RB-5; RB-43's two; RB-2; RB-1).

`max(version)` would be RB-1's, and `release2_in_ledger` would be 5 forward + 5
rollback rows. **So "P0 must return its original values" was wrong for the
ledger.** The post-rollback check is split:
- **P0-S must be identical**, `catalog_fingerprint` included — the schema and
  data are restored;
- **P0-L must equal the original 20 rows, unchanged**, plus exactly those ten
  appended rows. Each of the ten carries A1's or A6's md5, and they appear in
  that order.

In the repository:
- the forward files stay in `supabase/migrations/` (history is never deleted);
- each applied rollback's bytes are committed as
  `supabase/migrations/<rb version>_release2_0N_<name>_rollback.sql`,
  byte-identical to its ledger row;
- a recaptured `tables.json` lacks the six tables.

The inventory gate (INV-6) now accepts that state **explicitly**. It computes
Release 2 table presence as the net of applied files **in version order**: a
table created by an applied forward file is expected unless a LATER applied
file drops it. **A drop counts only if that file's bytes carry an A6 rollback
md5 from the manifest** (a reviewed rollback). An unreviewed drop, a rollback
older than its forward, or a rollback of a migration never applied fails the
gate. SQL comments are stripped before matching.
`scripts/tests/release2-inventory.rollback.test.js` walks apply → rollback →
snapshot → inventory in a copy of the repository:
- forward and rollback files stay in place, and no history is deleted;
- the post-rollback snapshot is the committed production capture with only
  `ledgerVersion` and provenance advanced. The test asserts that its
  tables/views/buckets are the capture's own, byte for byte, so it cannot
  pass by listing tables that a rollback dropped;
- Codex's reproduction (applied files, no rollback) fails with the exact
  message it reported.

**E7. Executed so far — locally, not on any Supabase project.** Every
assembled text was run in a real Postgres 17 (PGlite, WASM), with
`scripts/manual/stage0-local-pglite.mjs`. The database was built from a
minimal Supabase shim plus the 20 committed migrations and production-shaped
rows.

Results, all as designed:
- **Sequence:** P0; P1 (every proof, 03's 42702, all four RB operations,
  catalog equality); P0 identical after P1; P2-01…05, each ledger row carrying
  A1's md5 and bytes; RB-5, RB-43, RB-2, RB-1; P0-S identical to the original,
  `catalog_fingerprint` included; P0-L = the 20 rows + 5 forward + 5 rollback
  rows, in order.
- **Refused as designed:**
  - P1 and P2-01 on a staging-shaped database;
  - P2-01 on an unknown ledger;
  - P2-02 before 01, and P2-05 twice;
  - RB-2 or RB-43 out of order, and RB-1 over a non-empty table;
  - 04's rollback run outside RB-43;
  - P1 with a mutated A2 expectation or a mutated end-to-end expectation.
- **Real defects this execution found and fixed:**
  - an `acldefault()` call with a `text` argument;
  - a `name[]` vs `text[]` comparison;
  - UNIONs of different row types in the unchanged-row checks;
  - RB-43 writing two ledger rows with the same version.

**What it cannot show:**
- lock waits, `lock_timeout` and cancel (PGlite has one connection);
- Supabase's non-superuser `postgres` and its role memberships;
- production's server version and rows.

P1 on production is the first run that shows those.

---

## F. Acceptance and rollback

**F1. P6 — delete the production-ref refusal (the last change).**
- A separate PR: `release2Allowed()` loses condition 2, and its header is
  rewritten to two conditions (flag, verified context).
- `release2-guard.test.js` and DC-13 lose "refused on the production ref" and
  gain two cases: "production context + flag → allowed on any ref" and
  "preview context on the production ref → 404".
- The manifest gains the `p6` trees.
- Merged only with P0–P5 recorded, and with D4's runtime-enabled evidence.
- Stop point: the P6 deploy id, its `commit_ref`, and the `p6` tree comparison.

**F2. P7 — verification on production (no further change).**
1. **Owner Auth validation first (F-5):** `enroll-list` with a live owner
   token → `200` (C8).
2. Phase 1 → four uniform `401 {"ok":false,"error":"Unauthorized"}`.
3. A **fresh** production-site preview: `deploy-context` →
   `deploy-preview`, `flagPresent:false`. Then `csrf-bootstrap` with no
   Origin, with the production Origin and with its own Origin → JSON `404`
   ×3.
4. Positive probes with real rows, Ryan signed in: mint and redeem a ticket on
   a scratch device, sign in a real PIN, log out, revoke the device. Each step
   is read back from the database. The scratch enrollment stays in the audit
   trail, revoked.
5. The counter is unchanged: an order save, the queue tab, a PIN sign-in
   through the **legacy** path.

**F3. Acceptance — G0 passes when every line is recorded:**

| G0 condition | evidence required |
|---|---|
| 1 migrations 01–05 in production's ledger, files named and byte-identical | E4 read-backs = A1 and A1a per step; files renamed to production versions; A2 in full (E5); `tables.json` refreshed and INV-6 green; manifest updated and green |
| 2 deployment-context check in place, (a)–(d) | (a) and (d) from P4; (b) and (c) already recorded (0b-prod and 0a, both 2026-09-23); the context-alone denial (0b-staging, 2026-09-24); **plus the D4 runtime-enabled evidence** |
| 3 Phase 1 green on production | F2: four uniform 401s after P6 |
| 4 a preview refused with 404 by a curl with no Origin | F2: a fresh production-site preview, three Origin variants, after P6 |
| 5 the inventory proves the client calls no endpoint | inventory gate — INCLUDING the request/dispatcher boundary (`bbbd637`) — green on the A3 source and on the P3 commit, and accepted by review. Not closed until then |
| plus: credential transition | C5 steps 1–10 recorded: key inventory; current-deploy proof including the canary's `store:store4979`; historical baseline and proof per URL of the post-P4 old-key set; provider-side record; C8's prefix; the cleanup answer (scheduler named, or paused) |
| plus: bound to source | the P4, P5 and P6 deploy ids and `commit_ref`s, each compared with the manifest's pinned trees |

**F4. Rollback, per step (F-7).**

| step | rollback | precondition | class |
|---|---|---|---|
| P1 | none needed — rolled back by construction | — | — |
| P2/P3, **before P6 only** | the RB operations in reverse (RB-5, RB-43, RB-2, RB-1) through the E1 wrapper, each read back, in an E0 window (RB-1 closes the counter). Then E6: P0-S identical, P0-L = the original rows + the appended rows | **the Release 2 state is empty or disposable** (RB-1's guard enforces zero rows in the five identity/capability tables). **There are no active consumers:** P6 not merged, Phase 1 on the published deploy answering 404 at that time (recorded), and the inventory green (no client names an endpoint) | reversal of a reviewed decision |
| P4 | `RELEASE2_ENABLED` removed, then a fresh build of the A3 source | — | not an incident |
| P5 (C) | C9 — break-glass rules apply | — | depends on branch |
| **after P6** | `RELEASE2_ENABLED=false`, then a **fresh approved build** → every Release 2 endpoint 404s. **The data is never dropped**: the tables, their rows and the ledger stay. The RB operations are NOT available after P6 | — | an incident if data was written through the endpoints |
| any | a fresh build of a B2-listed commit — **never a republish** after C — then B3's re-probe | — | — |

**F5. The reviewer's rulings (8913a69 review), as applied:**
1. **A7 manifest: REQUIRED** → §A7, the manifest and its test.
2. **The 03+04 rollback is one atomic reviewed operation, preserving ACLs** → RB-43 (§A6), with guards that make it unrunnable as two operations.
3. **C5 order: accepted** → C10.
4. **Keep `deploy-context`** → D, final paragraph.
5. **E0 window: accepted** → E0, now with the corrected lock facts.

---

## G. Staging artifacts: qualifications (not rewrites)

These stay as the record of what was run on staging; their results stand. They
are **SUPERSEDED — not approved for reuse**, for production or for any future
staging run:

| artifact | why superseded | replaced by |
|---|---|---|
| `supabase/staging/release2_reconciliation_reset.sql`, its guard | A **negative** guard (refuses unless the staging seed store exists) proves "is staging", but it is the only guard and it identifies the target by one synthetic row. The file itself is **not edited**: its bytes are staging's ledger `statements[1]` for `20260928160606` | E2's positive identity markers, in every stage-0 wrapper and rollback file |
| `scripts/manual/assemble-reconciliation-rehearsal.mjs` | **unpinned**: it read whatever HEAD was, and nothing recorded the md5 of its output. The md5 gate in R1 was added by hand around its output | `scripts/manual/assemble-stage0.mjs`, whose every output is pinned in the manifest and re-assembled by the test. The old script now refuses to run unless explicitly told it is replaying history |
| the reconciliation doc's "the exact previous state is always recoverable … re-applied byte for byte" | the ledger holds statement text, not state. Re-applying old DDL does not restore ACLs changed since, dropped rows or comments, and "exact" was a guarantee nothing enforced (CLAUDE.md comment discipline) | E6: restored state is asserted by `catalog_fingerprint` equality, never inferred from DDL |

The reconciliation doc, `staging.md` and the assembler carry a pointer to this
section.

---

## H. Traceability — every item of the 8913a69 review

| item | resolved in |
|---|---|
| F-1 locks, timeouts, wrapper, counter closed, abort | E0, E1, E3 (P1 settings), E4 |
| F-2 `stores_without_org = 0` or stop with IDs | E2 P0-S |
| F-3 canary with `store:store4979`; cleanup dry run, scheduler or paused; authenticated read chosen in C3 | C3.1–C3.2, C6 rows R and C, C7 |
| F-4 write-only secrets; bind the type or retire every possibility | C1, C4, C5.1, C5.7 |
| F-5 Functions anon key `sb_publishable_`, fresh deploy, owner auth after revocation | A4, C1, C3.4, C8, F2.1 |
| F-6 positive production identity | E2 (out of band + markers), A6, E1 guard |
| F-7 rollback after P6 = flag off + fresh build; destructive rollback only before P6 with empty state and no consumers | F4 |
| F-8 (the pre-P1 artifacts) | A6, A7, E3 — committed files; see the Part 3 commits |
| B1 presence-only probe; collapsing signer; probe matrix; invalid-key control; current vs historical; legacy writers, signer, deleter; provider-side evidence | C3.1, C5.5–C5.10, C6 |
| B2 per-migration intermediate expectations | A1a, E4 |
| B3 schema/data vs append-only ledger; reviewed rolled-back state accepted by the inventory | E2 (P0-S / P0-L), E6, the INV-6 net-state change and its regression test |
| B4 break-glass re-enable; named rollback targets; re-probe; old-key set after P4 | B1–B3, C9 |
| B5 runtime-enabled evidence separate from `flagPresent`; `deploy-context` kept | D4, D (final paragraph) |
| B6 A3/C pinned; deploy ids bound to source | A3, C5.4, D1, F1, F3 |
| F5 rulings 1–5 | F5 |
| staging qualifications | G |
| inventory residual (R1, request boundary) | G0 condition 5 (F3); closed at the boundary in `bbbd637`, pending review |

## I. Proposed steps awaiting approval (none run)

1. **C3 on staging** — the full credential rehearsal, the invalid-key control,
   and the six demonstrations. Staging keys and staging deploys only.
2. **D4(i)** — the `flagEnabled` diagnostic as a reviewed code change, or
   Ryan's choice of D4(ii).
3. **The canary mail (C7)** — its timing (during C5.5), subject, and who
   reads the function log.
4. **The cleanup question (C7)** — is `CLEANUP_SECRET` set on production, and
   what (if anything) calls cleanup with it? Ryan's answer decides "scheduler
   named" or "paused".
5. **P0** — read-only, against production, once this revision is accepted.
6. P1 onward, each at its own stop point.

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
