# Stage 0 — item 4(c): the rehearsal from 01, the recovery mapping and the production window — PLAN

**Status: PLAN, revised as V2 for Codex's review of V (2026-11-02).** U
(`3624efd`) was sent back for amendment (U-1 to U-5), and V (`ed393be`)
answered it. Codex then sent V back with two blocking corrections, V-1 and
V-2, accepted C7′, U-3, C9 and C12, and ruled C10: the smoke order is kept.
This revision answers V-1 and V-2, applies those rulings and the review's
further bounds, and corrects the image provenance (§0.1). It clears
nothing: no project is created, no token, no send, no window. After Codex
accepts this plan, the implementation commit (§10) and its runbooks come
back for review before any session.

**Codex accepted V2 at plan level** (review of `ea0c616`, 2026-11-02,
`reviews/2026-11-02-ea0c616-review.md`). V-1 and V-2 are closed at this
level. The preflight, the comparator, the SQL, the target extension and the
runbooks are implementation still to be reviewed. The acceptance authorizes
no project creation, baseline capture, rehearsal session or window. V2's
push waited for W2, because V2 contains W (§0). It was pushed with W2 to
the staging branch on 2026-11-03 (production plan §E13). Its rulings are in
§12.

**Sources:**
- Codex's incident review, 2026-10-12, §4(b) and §4(c)
  (`docs/security/stage0-incident-2026-10-09.md`, Appendix A);
- **Codex's review of T and U, 2026-11-02**
  (`reviews/2026-11-02-c62644a-3624efd-review.md`): C1–C8, U-1 to U-5, and
  its further design bounds;
- **Codex's review of V, 2026-11-02**
  (`reviews/2026-11-02-ed393be-review.md`): V-1, V-2, the rulings on C7′,
  U-3, C9, C10 and C12, and its implementation bounds. With it, Codex's
  local role-privilege probe (`reviews/release-ed393be-role-delta-probe.mjs`
  and `.json`) and its rerun of the lock inventory
  (`reviews/release-ed393be-locks-rerun.json`);
- **Codex's review of the G-6 addendum, 2026-11-02**
  (`reviews/2026-11-02-G6-addendum-review.md`);
- the production plan: §A1a and §A2 (the states), §A6 (rollback files,
  STATE, UO-1), §E2–§E5 (P0–P3), §E10–§E13 (what ran), §E15 (item 3),
  §I (4(c)'s classifier scope, confirmed in Codex's review of `95ecd65`);
- Codex's reviews of `78db6dc` and `22610f8`: no production phase until
  4(c) supplies its ceilings and whole-path budget;
- Codex's item 3 plan review (2026-10-28): Q-4 (production identity
  evidence is reviewed separately), Q-5 (declared step and time maps,
  mandatory for production), I3-2 (four REVOKEs do not remove other
  default grants);
- the guarded-send procedure, `docs/security/stage0-guarded-send-procedure.md`;
- the P1–P3 runbook's §B time budget, §0.7/§A.0 and §8 (the template for
  §7);
- Supabase, read 2026-10-31: changelog discussion 45329 (the 30 October
  grants change); the docs pages "Database Backups", "Restore to a new
  project", "Manage Compute usage", "Billing FAQ", "Deleting Your
  Project"; and, through the Supabase MCP (metadata reads only, no SQL):
  the organization's plan, its project list and the new-project cost;
- the platform images (§2.2): two separate observations of Supabase's
  project list on 2026-10-31, by Claude Code at 13:16:42Z and by Claude in
  chat at about 16:55Z (relayed by Ryan);
- Ryan, 2026-11-02: the decisions in §0.2;
- a local lock inventory, 2026-11-02 (§1.2), rerun by Codex;
- main@7ec5af4, read from git for §4.2: `netlify/functions/complete-job.js`,
  the order columns (`src/lib/orderQueue.js`) and the order history
  (`src/components/OrdersDashboard.jsx`).

## 0. Where things stand

- **Production holds 01 only:** `20261009151706`
  `release2_01_identity_schema`, md5 `e97a5fd7c346a3b0a39bc6180dcfde46`,
  13 720 bytes (§E12, §E13). The counter re-opened at verified 01 on
  2026-10-13, after Codex's re-opening checks, and has run there since.
- **The old texts cannot finish the path.** P1 and P2-01 refuse while 01's
  forward row exists. RB-1 keeps that row, so RB-1 → P1 → P2 cannot complete
  either (Codex 4(b)). No ledger history is deleted to get round this.
- **What Codex 4(c) asks for:**
  - a rehearsal that starts from the committed 01 state;
  - that verifies the remaining forward steps and the recovery states they
    can leave;
  - that preserves 01's ledger identity and establishes a fresh baseline;
  - that covers rollback behaviour without committing rehearsal changes;
  - with newly pinned sender texts;
  - then a review of the rehearsal, the recovery mapping, the revised
    runbook and the exact head before a new window is cleared.
- **Done before this plan:** item 2 (the classifier), item 6 (the guarded
  sender) and item 3 (the read-token experiment). Codex accepted item 3's
  record, T, on 2026-11-02, and T was pushed to the staging branch the same
  day (production plan §E13).
- **G-6 (SG-1/SG-2), under Codex's ruling on the G-6 addendum**
  (2026-11-02):
  - **the capture is accepted,** and the assertion mechanism it shows is
    established. The test's stale regex rejected the guard's real 10 s
    lock-wait refusal, while every issuer assembled its plan inside the
    store lock;
  - **T's two original failing assertions remain lost.** They are recorded
    as unidentified, not explained by the capture;
  - **F1–F3 are required before any new guard-dependent session,** this
    plan's rehearsal included, and before any production phase. W
    (`4b7450d`) implemented them, and Codex returned it **AMEND**
    (review of `4b7450d`, 2026-11-02), with three blocking corrections
    and one non-blocking note:
    - W-R1: the gate's eligibility time must be read after the warm-up
      and the lock wait;
    - W-R2: an exclusion witness that cannot be established must fail
      LK-6;
    - W-R3: a usable stale-holder check outside the store, and a real
      dead-holder regression;
    - W-N1: the race helpers' timers.

    **W2 (`d8ec242`, on V2) answers them. Codex accepted it** (review of
    `d8ec242`, 2026-11-02), keeping t0 in the sender's first check, and
    found F1–F3 addressed by W and W2 together. It was pushed to the
    staging branch, with U, V, W and V2, on 2026-11-03, after its 14-state
    replay was green (production plan §E13). That closes the prerequisite;
    it clears no live session.
  - **W's load campaign, as Codex counted it:**
    - 48 complete passing race TAP outputs: 40 with wrapper exit 0; four
      010 runs with exit 127 and passing TAP; four 012 runs with passing
      TAP and no exit line;
    - not 200 completed runs, and not 48 captured zero exits;
    - nine complete load suites 537/537, with B #4 and C #4 stopped
      incomplete.
  - **W's guard changes are separate from this plan's store extension**
    (§2.3). W corrects the guard: the lock's retry on acquisition, and
    status, gate and the sender's first check reading one locked
    snapshot. The rehearsal target extension is a later change, in the
    implementation commit. Neither relaxes the exact-head clearance that
    every session needs.

### 0.1 Codex's reviews of U and V, and where they are answered

**Codex's review of V** (2026-11-02), answered in V2:

| item | Codex's ruling | V2's answer | where |
|---|---|---|---|
| **V-1** the non-public BUILD preflight | AMEND, blocking | BUILD-00 and a new W-side read, BUILD-00W, cover every non-public object the migrations and BUILD-01 write or depend on: `storage.buckets`' write shape and any pre-existing target row, `storage.objects`' owner and policy names, the `supabase_realtime` publication, and the W role's authority over each. Their reviewed acceptance is re-asserted inside BUILD-01 before the first file runs. Metadata only; unreadable or unsupported is a STOP. Event triggers bind non-secret body digests, or their difference is a recorded residual. The scope is stated | §2.1, §2.2 |
| **V-2** POST′ and the role facts | AMEND, blocking | POST′ permits only a reviewed per-state, per-role, per-signature table of Release 2 EXECUTE facts, rollback histories and removed signatures included; every other role fact stays exact. The tests are planned | §6.4 |
| C7′ the planned refusals | ACCEPT | unchanged | §2.5 |
| U-3 the lock footprint, C6 withdrawn | ACCEPT | unchanged; Codex's rerun recorded | §1.2 |
| U-5 the narrowed rehearsal and the production smoke | ACCEPT in scope | the smoke order is kept (C10); no claim of owner or queue runtime proof at intermediate states | §4.2 |
| C9 P1′'s own lock rows | ACCEPT as bounded evidence | recorded only outside the savepoint, in an exact result schema with a bounded size; Codex's wording on row locks | §1.2, §6.1 |
| **C10** the smoke order | **keep the labelled order** | a minimal order, kept as a durable test record with its id, store, time, amount and purpose. No removal step, no dashboard deletion. The upload's file removal gets its own labelled read | §4.2, §7.1 |
| C12 recovery coverage | ACCEPT in principle | unchanged; its tests and analysis come with the implementation | §3.6 |
| the image provenance | ACCEPT | corrected: observed by Claude in chat on 2026-10-31, relayed by Ryan | Sources, §2.2 |
| further bounds | the first baseline receipt, P0′'s data scope around P1′, P1′'s lock rows, G-6's status | the first receipt is evidence, reviewed, then bound by hash; an explicit data-comparison scope; G-6 under the addendum ruling | §0, §6.4, §6.1 |

**Codex's review of U** (2026-11-02), answered in V:

| item | Codex's ruling | V's answer | where |
|---|---|---|---|
| C1 the throwaway venue, a synthetic ledger | ACCEPT in principle | BUILD-00 reads and accepts the fresh project's real shape; BUILD-01 stops on anything unexpected, never erases; the ledger is labelled as reconstruction | §2.1 |
| C2 a third, retirable guarded target | ACCEPT in principle | the store extension's bounds, as Codex set them | §2.3 |
| C3 the equality set | AMEND: U-2 | "exact equality" is replaced by a checked state in three tiers: MATCH, a named residual, or STOP | §2.2, §6.4 |
| C4 the recovery policy | **B**, conditionally | B is the plan; its conditions are listed | §3.5, §7.2 |
| C5 RB-1 excluded | ACCEPT | kept; the lock claim it was made to support is corrected | §1.2, §3.2 |
| C6 re-opening after an UNRESOLVED 02–05 or P1′ | **REJECTED** | dropped; the existing incident-review rule stands | §4.4 |
| C7 fault captures and R4 dispositions | AMEND: U-1 | no concurrency protocol: single-request planned refusals only; a refusal outside a witnessed profile is a hold, its first receipt to Codex | §2.5, §6.2 |
| C8 preserved bytes, a rehearsal target, explicit `effect` | ACCEPT | M-12's update, with LEGACY_EFFECT left as it is | §6.3 |
| U-1 | a two-send lock fault cannot run under SG-2 | dropped; what is and is not exercised is listed | §2.5 |
| U-2 | a checked application and dependency state, with explicit platform differences | P0′'s diagnostic rows, the default ACLs at every scope, the roles, the dependency closure, the settings allowlist, the image record | §2.2 |
| U-3 | the "no lock" premise is false for P1′ | corrected; a local lock inventory of P1′ and of each step text; P1′ records its own locks on Supabase | §1.2, §4.3, §6.1 |
| U-4 | the baseline read cannot accept post-step states | P0′ accepts only 01; POST′ accepts one intended state, bound to the step | §6.4 |
| U-5 | the app check must exercise what it claims | the rehearsal's claim is narrowed; the production smoke test is representative (V2: its order is kept, C10) | §4.2, §7.1 |
| further notes | BUILD-01, the store, policy B, recovery coverage, the time map, 30 October, backup and cost, C8's detail | folded in | §2.1, §2.3, §3.5, §3.6, §5, §6.3, §7, §8 |

### 0.2 Ryan's decisions (2026-11-02)

- **The throwaway project is created only after Codex accepts this plan
  and the store change** (the implementation commit's §2.3 extension).
- **The window's shape is option A:** Sunday, from 17:00 EST (§7.3). The
  date is chosen with the window's clearance.
- **No pre-window logical dump and no PITR.** Instead, two requirements
  before the window (§8.2):
  - a daily backup from the last 24 hours;
  - the day's orders exported or printed.
- **The rehearsal's app claims are narrowed** to what it exercises, and the
  **production smoke test is made representative:** PIN sign-in, owner
  sign-in, a saved test order and an upload through the queue (§4.2).
- **The smoke order is kept** (C10, decided with Codex's review of V): one
  minimal labelled order stays as a durable test record. Nothing deletes
  it.
- **No concurrency protocol is built** for the rehearsal (U-1, §2.5).

**Ryan's decisions on the implementation outline (2026-11-03;**
`reviews/requests/stage0-item4c-implementation-outline.md` §5, after
Codex's rulings in its review of `d8ec242`):
1. **The production phase:** X4 declares the production workflow's steps
   and gate without ceilings. A production timing commit after the
   rehearsal adds the measured ceilings and the window length. Until then
   the production workflow cannot draft, register, issue or send, and there
   is no legacy fallback.
2. **The throwaway project** is created once X4 is in review, so the
   ref-binding commit can follow it straight away. Nothing can run on the
   project before X4's workflows exist. This refines the first decision
   above.
3. **The rehearsal ref:** a separate reviewed ref-binding commit, then
   `target add` under its own clearance.
4. **The production smoke test (§4.2): Ryan does it himself.**
   - On a computer: the app and the Queue tab, signed in with his own staff
     PIN, then owner sign-in with his owner account.
   - On his phone: the upload through `/upload`, a one-page PDF.
   - The order: one black-and-white copy.

## 1. What the remaining path touches

These facts shape the rest of the plan. They come from reading the
committed files (line numbers at T) and, for locks, a local measurement
(§1.2). The rehearsal (§2) and P1′ on production (§6) are what show them on
Supabase.

**1.1 The forward files 02–05 create, replace and drop functions only.**

| file | statements | EXECUTE after the file |
|---|---|---|
| 02 | `create function release2_record_attempt(…)` (:32), `create function release2_clear_lockout(text,text,uuid)` (:98) | `revoke … from public, anon, authenticated, service_role` then `grant … to service_role` (:83–86); clear_lockout to `authenticated, service_role` (:114–117) |
| 03 | `drop function … clear_lockout(text,text,uuid)` (:55); `create function … clear_lockout(text,text,uuid,uuid)` (:57); `create or replace function release2_record_attempt` (:121); `create function release2_create_staff_session` (:186); `create function release2_prune_auth_attempts` (:246) | clear_lockout (4 args): revoke from the four, grant to `authenticated, service_role` (:109–112); staff_session: to `service_role` (:231–234); prune: to `service_role` (:259–261). **record_attempt: no revoke or grant in 03:** `CREATE OR REPLACE` keeps 02's ACL |
| 04 | `create or replace function release2_create_staff_session` (:41) | re-issues revoke from the four and grant to `service_role` (:90–93) |
| 05 | `create function release2_revoke_enrollment` (:40) | revoke from the four, grant to `service_role` (:94–97) |

- **No** `create table`, `create sequence`, identity or serial column,
  `alter table`, index, policy or trigger in any of the four files.
- Every function is PL/pgSQL, `security definer set search_path = public`,
  with a comment.
- The rollback companions 02rb–05rb likewise drop and re-create functions
  only. Each re-created function carries its own revoke (PUBLIC first) and
  grants, and its comment.

**1.2 What the remaining path locks (corrected, U-3).**

U said no step locks a table the live app uses. **That is false for P1′,
and imprecise for the step texts.** The corrected statement rests on
reading the SQL and on a local lock inventory, run on 2026-11-02:
- **The database:** PGlite 0.4.6 (PostgreSQL 17.5, one connection). The
  stage-0 local database is built exactly as
  `scripts/manual/stage0-local-pglite.mjs` builds it, then P2-01 is
  committed to reach state 01.
- **A P1′ approximation:** P1's own assembled bytes at U, less three
  pieces:
  - the P2-01 body;
  - RB-1;
  - section 0's S0.2, which asserts that no Release 2 object exists (false
    at 01).

  It runs piece by piece in one transaction. After each piece `pg_locks`
  is read for its own backend, then everything is rolled back. All 44
  remaining checks passed.
- **The six production step texts** were committed in turn, from 01 to
  "after 05" and back to 01, with `pg_locks` read just before each COMMIT.
- **The limits:** it is not evidence about Supabase. There are no platform
  event triggers, no other session and no contention. The script and its
  output are outside the repository; V's review request names them.
- **Codex reran it** against U's clone (review of V): all 44 checks pass and
  all six committed operations run. Codex accepted it as a PGlite
  approximation from existing SQL. It is not the future pinned P1′,
  production's exact ledger identity, a contention test or a complete
  peak-lock trace.

**The six step texts** (P2-02, P2-0304, P2-05, RB-5, RB-43, RB-2). Each
holds these until its commit:

| lock | on | from |
|---|---|---|
| AccessShareLock | `public.stores` | the identity guard's read |
| AccessShareLock, RowExclusiveLock | the ledger table | the head read and the ledger row |
| ShareUpdateExclusiveLock | each function it creates or replaces | the DDL on it |
| AccessExclusiveLock | each function it drops | `DROP FUNCTION` |
| AccessShareLock | roles `anon`, `authenticated`, `service_role` | `GRANT`/`REVOKE` |
| AccessShareLock, RowExclusiveLock | system catalogs | the DDL |

So each step text locks one app table, `stores`, and only in
AccessShareLock, which conflicts with nothing but ACCESS EXCLUSIVE.

**P1′** (the approximation) adds the following. Every lock is held until
its ROLLBACK, except inside the savepoint:

| piece | locks on app or platform tables |
|---|---|
| section 0: the capture, with real-row digests | AccessShareLock on `employees`, `stores`, `organizations`, `memberships`, `auth.users` |
| section 1: the fixtures | RowExclusiveLock on `auth.users`, `organizations`, `stores`, `memberships`, `employees`, `enrollment_tickets`, `device_enrollments`; RowShareLock (foreign-key checks) on `auth.users`, `organizations`, `stores`, `device_enrollments` |
| 03 alone and section 1b, inside the savepoint | AccessShareLock on `device_enrollments`, `staff_sessions`, and the function locks. All are released at `rollback to savepoint` |
| section 2: A2 and the end-to-end calls | RowExclusiveLock on `auth_attempts`, `staff_sessions`; RowShareLock on `employees`; AccessShareLock on `enrollment_tickets`, `device_enrollments`, `staff_sessions` |
| section 3: fixture removal | RowExclusiveLock on `upload_capabilities`. **Through the foreign-key actions of deleting the fixture stores,** it also takes RowExclusiveLock on `orders`, `settings`, `addons`, `discounts`, `outsourced_products`, `paper_types`, `pending_jobs`, `print_jobs` and `sheet_prices`, plus RowShareLock on `orders` and `enrollment_tickets` |
| RB-5, RB-43, RB-2, section 4 | function locks only |

**What that means:**
- **P1′ takes no ACCESS EXCLUSIVE, SHARE or SHARE ROW EXCLUSIVE lock on an
  app table.** Its table locks are RowExclusive, RowShare and AccessShare.
  App DML takes RowExclusive too, so the two do not conflict at table
  level. They can conflict through a row (the same row updated or deleted,
  or the same unique key inserted concurrently), and with DDL.
- **It does hold RowExclusiveLock on nine app tables it never names**
  (section 3's foreign-key actions), plus the tables its fixtures write,
  for its whole transaction. P1 took 4.5 s on production.
- **The rows it locks** are the fixture rows it inserts and deletes, and the
  rows those reference. Section 1 references only rows it created, so all
  of them are synthetic. This comes from reading the SQL, not from
  `pg_locks`: row locks normally are not listed there, and waits on them
  commonly appear as transaction-id waits. **An empty row-lock list proves
  no absence of row conflicts.**
- **Not shown locally:**
  - locks taken and released inside a subtransaction that rolled back.
    Every `stage0_expect_error` probe ends that way, and section 1b is seen
    only at its boundaries;
  - Supabase's event triggers (P0′ lists them, §2.2);
  - any wait, which needs a second session.
- **On Supabase,** P1′ records its own `pg_locks` at named boundaries
  outside its savepoint, in an exact result schema of bounded size (§6.1).
  R1 on the throwaway and P1′ on production each report their own
  footprint, subject to the same limits.
- **Contrast with what is already done:** 01 (P2-01) added
  `employees_id_store_uniq`, which took ACCESS EXCLUSIVE on `employees`.
  RB-1 would take the same, plus locks on the tables its foreign keys
  reference. Neither runs in this plan (§3.2).
- **The steps are short.** P2-01 took 1.6 s on production, and P1 took
  4.5 s (§E11, §E12).

**1.3 main@7ec5af4, the live app, reaches none of what 02–05 change.**
- **The browser code:**
  - PIN sign-in calls `verify_employee_pin` (`src/lib/supabase.js:362`), a
    `stable` SQL function that only reads `employees`;
  - owner sign-in uses Supabase Auth (`src/lib/storeConfig.js:105`) and
    the membership tables;
  - order saving inserts into `orders` (`src/lib/supabase.js:388`).
  - A `git grep` of `src/` at `7ec5af4` finds no Release 2 table or
    function.
- **The upload queue** runs through main's Netlify functions with the
  service-role key: `pending_jobs` and the `customer-uploads` bucket.
  `complete-job` calls Storage's `remove` on the job's file paths, does not
  inspect its returned error, and then deletes the `pending_jobs` row
  (`netlify/functions/complete-job.js:36–39`). Its 200, or the job leaving
  the queue, therefore does not show that the file is gone (Codex, review
  of V).
- **What else writes the tables P1′ reaches,** at main (§6.4 relies on it):
  - `pending_jobs`: the queue functions. `register-job` is called by the
    customer upload page and by the kiosk's submit, and `fetch-link-job`
    by the upload page. Then the scheduled `cleanup-stale-jobs`, and
    `complete-job` from the Queue tab. The browser app itself only reads
    it (the Queue tab, and its badge at `src/App.jsx:1360`);
  - `print_jobs`: only the browser app's job-history helpers
    (`src/lib/supabase.js`);
  - `auth.users`: Supabase Auth, on a sign-in and on a recovery or
    magic-link request;
  - every other table P1′ reaches: only the browser app. No Netlify
    function at main writes one, apart from the Release 2 endpoints, which
    are dark on production.
  - So while the counter and the admin panel are closed, `pending_jobs`
    is the only one with a writer expected to act (customers and the
    schedule). Supabase Auth can still write `auth.users` if someone
    requests a link for an account.
- **main's four Release 2 endpoints do name them:**
  - `enroll-redeem`, `staff-login` and `release2-auth.js` call
    `redeem_enrollment_ticket`, `release2_create_staff_session` and
    `release2_record_attempt`;
  - each calls `gate()` first (`netlify/lib/release2.js:136`), and
    `release2Allowed()` returns 404 on the production ref
    (`netlify/lib/release2.js:52`), before any database call.
  - Their darkness on production is one of Codex's re-opening checks, and
    it held on 2026-10-13.

## 2. The "from 01" question: where the remaining path is rehearsed

**The proposal:**
- a **throwaway Supabase project**, rebuilt to production's 01 state from
  the repository's migrations. It is a **production-shaped rehearsal with
  an enumerated compatibility gap, not a clone of production**: the same
  reads run on both, and every difference is MATCH, a named residual or a
  STOP (§2.2);
- on it, 02–05 and every recovery operation run for real, through the
  guarded sender, timed;
- then **P1′ on production**, in a rolled-back transaction, inside the
  window. It is the final test of the pinned SQL under production's own
  catalog, roles and defaults (§6).

Staging cannot serve. It holds 01–05, under its own ledger versions and with
its seed store present. So it can never pass production's identity guards,
and the production texts' bytes cannot run there.

### 2.1 How the project would be built

No Supabase CLI command of any kind, no GitHub integration, no automatic
migration integration, and no branching.

1. **Ryan creates it in the dashboard, only after Codex accepts this plan
   and the store change** (Ryan, 2026-11-02):
   - organization "Sifuentes INC" (Pro plan), region `us-east-1`, the same
     as production;
   - Micro compute; a name such as `print-calculator-4c-rehearsal`;
   - the cost is re-read when it is created (§2.7);
   - the database password is generated and not kept anywhere Claude
     reads. Every send uses the Management API query route with fresh
     project-scoped PATs, as on production and staging;
   - Data API: keep `public` exposed. The app check in §4 needs it.
2. **Ryan reports its ref in chat.** A ref is not a secret. The ref enters
   the repository only through the reviewed extension in §2.3.
3. **Two pinned reads come first: BUILD-00 and BUILD-00W.**
   - **BUILD-00** (R, `read_only`) reads the fresh project's real initial
     shape, using §2.2's parts:
     - any object in `public` (none expected);
     - whether the ledger schema and table exist, and any rows in them;
     - every default ACL row at every scope;
     - the schema privileges, roles, extensions and event triggers;
     - **the non-public preflight below** (V-1).
   - **BUILD-00W** (W, without `read_only`, `effect` read) is the minimal W
     identity read. It runs exactly as BUILD-01 will be sent, so it
     observes the role BUILD-01 will run as on this project: its name, its
     attributes and memberships, and the preflight's authority facts
     evaluated for that role. It is SELECT-only, confined statement by
     statement as M-6e confines item 3's texts. No DDL, write or
     capability probe is sent.

   **Their acceptance has two layers:**
   - **predicates in reviewed code:** each fact the pinned migrations need
     in order to run as written (below). A failing predicate, or a fact the
     role cannot read, is a STOP for review;
   - **the full receipt is evidence.** BUILD-00's and BUILD-00W's first
     receipts go to Codex as evidence, not through a comparator that would
     need them approved before it could report them. After that review a
     **binding commit** pins the accepted facts by hash and assembles
     BUILD-01's text with them (§10).

   Nothing is erased, granted or replaced to make a project fit. An
   unexpected fact is a STOP, and an accepted state for it needs its own
   review.
4. **One pinned writing text, BUILD-01, then builds the database,** through
   the guarded sender, to the rehearsal target only.
   - **Its transaction:** one transaction, unless a migration file cannot
     run inside a transaction block. The local run finds out which. Any
     such file makes BUILD-01 a short sequence of texts instead.
   - **In order, it:**
     - **re-asserts the bound acceptance inside its transaction, before
       the first migration file runs:** it reads the same facts again as
       the role it runs as, requires each part's digest to equal the
       bound one, and runs the predicates again. Any difference raises,
       and the transaction rolls back;
     - **sets the default ACL rows to an exact target, then asserts them:**
       - the target is the pre-30-October set that production's 21
         migrations ran under: tables, functions and sequences to anon,
         authenticated and service_role, for the object-creating role;
       - the rows are added and revoked to reach exactly that set, at the
         global and the `public` scope;
       - three `GRANT ALL` lines alone would add to an extra global or
         per-schema grant on a new image, never erase it (Codex, U-2);
     - creates `supabase_migrations.schema_migrations` with exactly
       production's six columns (§E8, N6), if BUILD-00 found it absent;
     - runs the 21 top-level files of `supabase/migrations/`:
       - from their git blobs, in version order, each md5- and byte-gated;
       - each followed by its ledger row at **production's** version, with
         `statements[1]` byte-identical and `created_by`
         `store4979@theupsstore.com`;
       - this is the PGlite harness's construction. The public-catalog
         fingerprint it produced for the 20 older files equalled
         production's at P0 (§E10);
     - **inserts synthetic rows** where production's data predates a
       migration, as the harness does:
       - the store `store4979`, an owner membership on a synthetic auth
         user, and two employees on synthetic PINs;
       - rows sized to the counts in production's baseline read (§2.2);
       - **No production row is copied;**
     - creates a marker outside `public`: schema `stage0_rehearsal`, one
       row with the project's ref and the words "reconstruction: these
       ledger rows record a rebuild, not production's API history". P0′
       reports whether the marker is present (§2.4);
     - finally sets the default ACL rows to exactly production's, as its
       baseline read shows them after the 30 October change (§5), and
       asserts them.
5. **The ledger it writes is reconstruction provenance** (C1, accepted in
   principle). It makes no claim that production's API calls ran on this
   project, and it is never a reason to repair production's or staging's
   history (Codex item 4).

**The non-public preflight** (V-1). Three migrations write platform objects
outside `public`, and BUILD-01 writes more of its own. Replaying those bytes
on a newer image needs each object's shape and the W role's authority over
it. BUILD-00 reads the shapes and BUILD-00W reads the authority, as catalog
metadata only. "The W role" is the role BUILD-00W observes on this project,
never one assumed from staging.

| object | what writes it | what is read | the predicates (else STOP) |
|---|---|---|---|
| `storage.buckets` | `20260506182304`: `INSERT (id, name, public, file_size_limit, allowed_mime_types)` … `ON CONFLICT (id) DO UPDATE SET public, file_size_limit, allowed_mime_types, updated_at = now()`. `20260629173251`: `INSERT (id, name, public)` … `ON CONFLICT (id) DO NOTHING` | every column (name, type, NOT NULL, default, identity and generated kind); its constraints and unique indexes; its triggers (name, timing, events, enabled, function and the function's owner); RLS and forced RLS; its owner; the W role's schema USAGE and its INSERT, UPDATE and SELECT privileges; any row whose `id` is `job-files` or `customer-uploads`, read in BUILD-00W | the six named columns exist, with types the literals assign to; every NOT NULL column without a default is among the columns each INSERT supplies; none of the supplied or updated columns is generated, or an identity `GENERATED ALWAYS`; a unique index or constraint is exactly on (`id`), so the conflict arbiter exists; the W role holds INSERT on the supplied columns, UPDATE on the four updated ones, and SELECT where `ON CONFLICT … DO UPDATE` needs it; RLS does not apply to the W role (it owns the table or has BYPASSRLS, and RLS is not forced), since no policy is evaluated to argue that a write would pass; the triggers are the reviewed set; **neither target row exists.** A pre-existing `job-files` row would be overwritten by the first file's `DO UPDATE`, so it is a STOP, never something to fit |
| `storage.objects` | `20260506182318`: `DROP POLICY IF EXISTS` and `CREATE POLICY` of `job_files_anon_insert`, `job_files_anon_select` and `job_files_anon_delete` | presence, kind and owner; every existing policy's name; the `bucket_id` column and its type; RLS | an ordinary table with a `bucket_id` text column; **none of the three policy names exists,** so each `DROP … IF EXISTS` removes nothing; the W role owns the table or holds its owner's privileges (`pg_has_role(…, 'USAGE')`; a superuser passes). Table DML privileges do not confer policy authority: PostgreSQL requires ownership for `CREATE POLICY` and `DROP POLICY` |
| publication `supabase_realtime` | `20260629173251`: reads `pg_publication_tables`, then `ALTER PUBLICATION supabase_realtime ADD TABLE public.pending_jobs` | presence, owner, `puballtables`, the insert/update/delete/truncate flags, `pubviaroot`, every member table | it exists; it is not `FOR ALL TABLES`; `public.pending_jobs` is not a member; the W role owns the publication or holds its owner's privileges. Reading `pg_publication_tables` is not authority to alter it. The table's ownership, which `ADD TABLE` also requires, comes from the W role creating `pending_jobs` earlier in the same file |
| `auth.users` | BUILD-01's synthetic rows (`instance_id`, `id`, `aud`, `role`, `email`, as the PGlite harness writes them); the foreign keys of `20260722003606` and 01; the read in `20260909160312` | P0′ part 6's facts; the W role's INSERT, SELECT and REFERENCES; its triggers; RLS | the W role holds INSERT, SELECT, and REFERENCES on `id`; every NOT NULL column without a default is supplied; RLS does not apply to the W role; the trigger set is the reviewed one (none is expected) |
| schemas `supabase_migrations`, `stage0_rehearsal` | BUILD-01: the ledger schema and table where absent, and the marker | their presence and owners; the W role's CREATE on the database | the marker schema is absent; the ledger schema is absent, or exactly as BUILD-00 found it; CREATE on the database |
| default privileges | BUILD-01's two exact targets (step 4) | every `pg_default_acl` row (§2.2 part 3) | the W role is the object-creating role, or holds its privileges |

**Facts that depend on the reader are read as the W role.** Row visibility
under RLS, and any fact about `current_user`, change with who reads. So the
target-row checks and the authority facts are BUILD-00W's, read as the role
BUILD-01 runs as, and that role's exemption from RLS on `storage.buckets` is
itself a predicate. A row check by a role that RLS filters would prove
nothing. BUILD-00's other facts are catalog facts, the same for any reader
that can see them.

**What the preflight shows, and what it does not:**
- **BUILD's SQL compatibility is checked:** the pinned bytes can run as
  written, as the W role, on this project, without overwriting anything.
  It is an extra bounded gate. The transaction's rollback on any SQL error
  remains the backstop, and the preflight does not promise that every
  runtime failure becomes impossible.
- **Storage service, real file operations, Realtime delivery and the
  production queue are tested only by the final production smoke**
  (§4.2). The rehearsal neither uploads nor downloads a file, and no
  Realtime client connects. The publication's BUILD compatibility is
  checked, not Realtime equivalence.
- **Production's Storage schema and publication are not read** by this
  plan, apart from §4.2's labelled check of the smoke test's own file.
- **It never** reads a stored object, copies a platform schema or its data,
  grants a platform role membership, disables a hook, or replaces a pinned
  historical file to get past a shape.
- **Not known yet:** whether the new image gives the W role policy
  authority on `storage.objects` and ownership-level authority on the
  publication. BUILD-00W reads it. If either is missing, BUILD stops and
  the plan comes back for review.

### 2.2 The checked state: what must match, what is a named residual, what stops

**STATE alone cannot show the projects agree.** STATE reads:
- the effective prefix and its ledger md5s;
- which A1a Release 2 function set the catalog holds.

**A public-catalog fingerprint alone is not enough either.** Codex showed
on PostgreSQL 17.5 that the public fingerprint and the public-scope default
rows can stay equal while a **global** function default differs. A function
created afterwards is then executable by anon in one database and not in
the other. A per-schema default adds to the global one and cannot revoke
it.

**So P0′ returns diagnostic rows,** one per fact (`part | key | value`),
with an md5 per part, on both projects. Roles and objects are named, never
numbered by OID. A mismatch can then be explained, not just detected. The
parts:

1. **The ledger and 01's identity.** For every row: version, name, md5 and
   octet length of `statements[1]`, cardinality, `created_by`, and
   `idempotency_key` and `rollback` null. Also the table's six columns.
2. **The application objects in `public`:**
   - P0's catalog rows: functions with their ACLs, relations with their
     ACLs and RLS flags, columns, indexes, constraints, policies, triggers;
   - and what P0's fingerprint omits: each object's **owner**, and the
     `public` schema's owner and ACL.
3. **The default ACLs, at the global scope and the `public` scope:**
   - every `pg_default_acl` row: role, scope, object type and ACL;
   - which roles: those that create objects on the path. That is the role
     W's requests run as, which WHO-P and WHO-R show, and every role that
     owns an object in `public`;
   - for each role and object type without a row, the **implicit default**
     (`acldefault`), so an absent row and an empty one are told apart.
4. **The roles:**
   - which roles: `postgres`, `anon`, `authenticated`, `service_role`,
     `authenticator`, `supabase_read_only_user`, every owner of a SECURITY
     DEFINER function in `public`, and the roles R's and W's requests run
     as;
   - their `pg_roles` attributes;
   - their memberships, with the admin, inherit and set options;
   - their **effective privileges** on what the path uses:
     - schema USAGE on `public`, `auth`, `extensions` and
       `supabase_migrations`;
     - table privileges on `public`'s tables, `auth.users` and the
       ledger;
     - EXECUTE on the Release 2 functions, `auth.uid()`,
       `extensions.gen_random_bytes` and `extensions.digest`.
   - Each EXECUTE fact on a Release 2 function is a row (role, signature,
     true or false), explicit false rows included. After a step, POST′
     permits only the reviewed Release 2 delta of these rows (V-2, §6.4).
     P0′ permits none.
5. **The settings** (`pg_db_role_setting`, per role and per database, and
   the session's own values). **Values are read only for an allowlist of
   non-secret names:**
   - `search_path`, `statement_timeout`, `lock_timeout`,
     `idle_in_transaction_session_timeout`, `transaction_timeout`;
   - `default_transaction_read_only`, `role` and `pgrst.db_schemas`.

   Any other setting is reported by name only, with no value and no
   digest. Supabase projects have carried the JWT secret as a
   database-level setting (`app.settings.jwt_secret`). Whether these
   projects do is not known, and P0′ must not find out by reading a value.
6. **The non-public dependency closure** of P1′, the step texts and the app
   check:
   - `pgcrypto`: its version and schema; `extensions.gen_random_bytes` and
     `extensions.digest`, present with their owners. P1′'s fixtures and
     proofs call both. A migration-only search does not cover them;
   - `auth.uid()`: owner, volatility and the md5 of its definition;
   - `auth.users`:
     - the columns P1′'s fixtures write (`instance_id`, `id`, `aud`,
       `role`, `email`);
     - every NOT NULL column without a default, because a newer image
       could add one and P1′'s insert would then fail;
     - its user-defined triggers, which S0.3 requires to be none.
7. **The extensions:** every `pg_extension` row (name, version, schema).
8. **The event triggers:** every `pg_event_trigger` row: name, event,
   enabled, tags, and the function's name and owner. Supabase installs DDL
   event triggers. One that fires on `CREATE FUNCTION` is an effect the
   public fingerprint cannot see.
   - **Matching names and owners do not establish equal bodies** (Codex,
     review of V). So each trigger function's non-secret implementation
     facts are bound too: its language, `md5(prosrc)`, and the extension
     that owns it with that extension's version, if one does. No
     definition is dumped.
   - **What an equal digest shows:** the same source text. For a C
     function, `prosrc` is only its symbol name. Whatever the function
     calls is not covered.
   - **A difference** is either a STOP, or a named residual entry under
     R-IMG that records the trigger and what its behaviour leaves
     unproven. Behavioural equality is never inferred from names alone.
9. **The server:** `version()` and `server_version_num`.
10. **Data, recorded but not compared across projects:**
    - row counts for the tables P1′ touches;
    - the real-row digests of the five tables P1′'s fixtures write, as
      P1's section 0 computes them (an md5, never a value);
    - `free_pins`, `stores_without_org`;
    - the probe and nil identities;
    - `rehearsal_marker`.

    Within one project, around P1′ and after each step, §6.4's data scope
    says which of these must stay equal.

**Each fact is in one of three tiers,** fixed in a reviewed table in the
comparator's code (§6.4):
- **MATCH, else STOP for review:**
  - parts 1 and 2, exactly;
  - part 3, after BUILD-01 sets the target: the global and `public` rows
    for the object-creating role;
  - part 4, by name;
  - part 5's allowlisted values for those roles;
  - part 6: the same signatures, owners and EXECUTE, the same fixture
    columns, no NOT NULL column without a default beyond production's, no
    user trigger, and the same `auth.uid()` md5;
  - part 8: event triggers are on the path, so any difference is reviewed,
    and either stops or becomes a recorded R-IMG entry;
  - a **major or minor server change** (part 9) is reviewed too (Codex).
- **A named residual, each reviewed and recorded with what it leaves
  unproven.** None is innocuous by default:
  - **R-IMG, the image:** production reports 17.6.1.111, and the new
    project gets the current image. It leaves unproven the platform code
    outside these reads: PostgREST, Auth, Storage, the query endpoint's
    mapping from a token and a `read_only` flag to a role, and the API
    route's envelopes;
  - **R-VER:** a different build within the same PostgreSQL minor
    version;
  - **R-EXT:** an extension that differs outside part 6's closure. It is
    accepted only after the record says why the complete path does not
    depend on it;
  - **R-SET:** an unlisted setting present on one side only, known by name
    only;
  - **R-AUTHCFG:** the Auth service's configuration (hooks, Site URL) is
    not readable by SQL. The rehearsal claims no owner sign-in (§4.2).
- **Recorded:** part 10, and the operator metadata below.

**Unreadable is not equal.** A fact R's role cannot read is reported as
unreadable, and the proof that needs it stops. Nothing is inferred. R's
readability of each part is shown on staging, read-only, before the
production read.

**No role equivalence is manufactured.** Nothing changes a platform-managed
role, or production's defaults, to make the reads agree. BUILD-01 sets only
the throwaway's own default ACL rows, to an exact target, and asserts them.

**The image record (Codex's ruling):**
- **Recorded,** with each observation's time:
  - production's image, 17.6.1.111, and staging's, 17.6.1.166, in **two
    separate observations** of Supabase's project list on 2026-10-31,
    each reporting both values (Ryan, 2026-11-02; Codex's review of
    `ea0c616`):
    1. Claude Code, through the Supabase MCP `list_projects`, at
       13:16:42Z;
    2. Claude in chat, at about 16:55Z, relayed by Ryan. That time is
       approximate, and stays so.

    They are not merged. The Claude Code `list_projects` result of
    2026-10-29 23:56:06Z is another, earlier observation, neither of these
    two;
  - the new project's image when it is created;
  - each project's region and SQL `version()` and build.

  These values are operator and platform metadata, not an independent
  live read by Codex's review. They do not make item 3's staging
  measurement production evidence.
- **A matching `server_version_num` does not establish matching images.**
- **Changing production's image is not proposed.** It would be a
  production change outside this plan, and the throwaway may run a newer
  image without forcing one.

**WHO-P and WHO-R:**
- **What they are:** the same text, on production and on the throwaway. For
  each token and mode, they read the role, the transaction mode and the
  relevant effective privileges.
- **How:** SELECTs only, confined statement by statement as M-6e confines
  item 3's texts. There is no INSERT, DDL or mode-switch probe.
- **Their limit:** matching WHO values establish neither a general write
  boundary nor identical behaviour for every request.
- **Item 3's finding stands for staging only.** It was measured on
  staging's image, 17.6.1.166. Only WHO-P speaks for production (Q-4).
- **On the throwaway, the W leg comes first:** BUILD-00W is WHO-R's W
  identity read, sent before BUILD-01 so that the preflight's authority
  facts refer to the role BUILD-01 will actually run as (§2.1).

**The production half is a separate, reviewed, read-only session** (§10,
step 4): P0′, STATE′ and WHO-P. It comes before BUILD-01, because BUILD-01
copies production's default ACL rows. **Its first receipt is evidence:**
P0′ checks only its baseline-only preconditions there (§6.4) and reports
every observation. Codex reviews the receipt, and a binding commit then
pins it by hash. Every later comparison is against that bound receipt.

**What the checked state does not cover:**
- the `auth`, `storage` and `realtime` schemas beyond part 6's
  dependencies and BUILD's preflight (§2.1), which is read on the
  throwaway only. Copying platform schemas wholesale, or reading real auth
  or customer data, is not a way to close that gap;
- whatever the image changes outside these reads (R-IMG);
- production's data, load, hardware and network path.

### 2.3 The guard store knows exactly two projects

**This is the main code consequence of the proposal.**
- `initStore` records `refs = { production, staging }` from the manifest
  (`scripts/manual/stage0-guard.mjs:341`).
- Every live command refuses if the manifest's refs differ from the store's
  (:452).
- The sender accepts only a target named in `manifest.send.targets` and in
  the text's policy (`scripts/manual/stage0-send.mjs:104–106`).

A rehearsal through the guarded sender therefore needs a **reviewed
extension** (C2, accepted in principle). Codex's bounds:
- `send.targets.rehearsal` in the manifest;
- **add and retire events,** each bound to reviewed metadata:
  - each is serialized under the store's lock and crash-safe;
  - each is recorded in the hash-chained ledger;
- **the store's identity is preserved:**
  - the immutable production and staging refs;
  - every existing approval, claim, outcome and hold;
  - the hash chain's validation;
- **a retired ref cannot come back** through an old checkout, an alias, an
  old marker or an old go;
- **retirement removes nothing silently:** no live, pending or held
  experiment. The ordering of deletion, disposition and retirement is
  itself reviewed;
- **no second `init`,** and the rehearsal ref never takes the staging slot;
- holds, markers and phases stay per project, as now;
- the guard chain is re-pinned and audited (M-13).

**Rejected alternatives:**
- sends without the guard: from item 6 on, no live send happens without
  `--go`;
- `execute_sql` for a pinned text: CLAUDE.md;
- putting the new ref in the `staging` slot: the store check refuses it;
- a second store: that needs `init`, which is never run again.

The extension is code, so it belongs to the implementation commit, and the
project is created only after Codex accepts it (§0.2).

**X1 built it** (`4037d12`). Codex's review of X0 and X1 (2026-11-03)
accepted X0 as records and X1's design, and returned X1 **AMEND**:
- **X1-R1, blocking:** `dispose` recorded a disposition for an attempt of a
  retired ref, which the next storeCheck reads as damage, so an ordinary
  command could damage the shared store. X1b makes `dispose` refuse it
  before writing anything;
- **X1-N1:** "every command refuses a retired ref" overstated the rule.
  The actual rule: a retired ref gains no new authority and nothing is
  dispatched to it, while history reads (status, gate) and the closing of
  retained records (void, a window's close) stay available, releasing no
  hold and reviving nothing. X1b states it and tests it;
- **the standing rule:** unreviewed code never executes against the real
  guard store, read-only helper calls included (guarded-send procedure
  §7.2). X1's request had counted an unreviewed, unlocked storeCheck run
  on the real store as evidence; it is withdrawn, and recorded as a
  departure in the production plan's §E16.

The combined X0/X1 push is held until X1b is reviewed.

**X1b's reviews** (Codex, 2026-11-03):
- **of `7168fc0`:** X1-R1, X1-N1, the standing rule and §E16 accepted
  and closed; ORD AMEND;
- **of `f1d6112` and `d160c6e`:** all four ORD requirements closed at
  `d160c6e`, and the clone-preservation rule accepted. The push was held
  only for the new launch analyzer's LN-R1 and LN-R2;
- **Ryan deferred the analyzer** (§13). X1c removes it and keeps
  everything else.

### 2.4 A hazard the throwaway creates, and its marker

**By construction, the throwaway passes production's identity guards:**
- the same 21 ledger rows with their md5s;
- `store4979` present;
- the staging seed store absent.

So **the guards inside the texts can no longer tell production from the
rehearsal project.** That is what lets the production bytes be rehearsed,
and it removes one layer of protection while the project exists.

**What still separates them:**
- the sender's ref binding;
- each phase's declared target;
- the go's ref;
- the window markers.

**Mitigations:**
- rehearsal phases are declared for the rehearsal target only, and
  production phases for production only;
- P0′ reports `rehearsal_marker`, which must be false at every production
  read;
- the project is deleted, and its ref retired in the store, before the
  production window is cleared (§2.7).

### 2.5 What runs on it

Every text goes through the guarded sender, one request at a time, and each
is timed by its receipt. After each write comes POST′ for the intended state
(§6.4).

**Three sessions, each with its own clearance,** because a first receipt is
evidence to review before anything is compared with it:
- **session 1, R0a,** read-only;
- **session 2, R0b,** one write (BUILD-01) and its reads;
- **session 3, R1–R4.**

Between them, Codex reviews the receipts, and a binding commit pins what was
accepted (§10).

| # | what | shows |
|---|---|---|
| R0a | BUILD-00 and BUILD-00W, read-only; their receipts to Codex; then the binding commit | the fresh project's shape and the W role's authority, the non-public preflight included (§2.1) |
| R0b | BUILD-01; P0′ and WHO-R; compared with production's bound P0′ and WHO-P; the receipts to Codex; then the binding commit | the checked state: each fact MATCH, a named residual, or a STOP (§2.2). The throwaway's own baseline, bound by hash for its POST′ reads |
| R1 | P1′, rolled back; then P0′ again | P1′ commits nothing: P0′ equals R0b's bound baseline, data included. Nothing else writes the throwaway between those reads: it has no deployed functions and no schedule, and the app check first runs in R3. P1′'s lock rows (§1.2) |
| R2 | planned single-request refusals (below) | each guard's refusal through the real API route, as classified; the state unchanged |
| R3 | P2-02 → POST′ → app check; P2-0304 → POST′ → app check; P2-05 → POST′ → A2 → app check | the forward path, committed step by step; the app check of §4.2 at "after 02", "after 04" and "after 05" |
| R4 | RB-5 → POST′; RB-43 → POST′; RB-2 → POST′ → app check | every recovery operation, each committed on its own |

**R2: the planned refusals, one request each:**
- **at 01, after R1:** P2-0304, P2-05, RB-5, RB-43 and RB-2, each out of
  order. Each wrapper's state guard refuses before its file runs;
- **after P2-02, inside R3:** P2-02 again. It refuses because 02 is
  already in the ledger;
- **after P2-05:** P1′. Its state-01 check refuses (§6.1).

**How each is run:**
- each is an **expected-refusal step** in the rehearsal workflow, as item
  3's gate expected refusals;
- its gate requires an R3 with the expected message, and POST′ showing the
  state unchanged.

**No concurrency protocol** (U-1; Ryan, 2026-11-02):
- there is no second caller and no lock holder;
- SG-2's single-in-flight rule is unchanged (Codex re-ran G-7).
- U's two-send lock fault (FAULT-LOCK) is dropped, and with it the second
  throwaway project U offered for it.

**A planned refusal outside a witnessed profile is a hold:**
- its R4 holds the rehearsal ref, as UO-1 requires, and the session writes
  nothing more;
- **that first receipt, and the evidence for its disposition, come back to
  Codex** before any further write;
- a disposition by Ryan's hash is not a blanket release of R4s. Item 3's
  cleanup followed MATCH receipts and a terminal outcome, not an unknown
  writing hold.

**What R2 exercises:**
- the guards' refusals, raised in each wrapper's DO block. Each is expected
  to be the witnessed "re-raised ERROR" profile, but that is not assumed;
- their classification;
- POST′ after a refusal.

**What it does not exercise.** Each of these stays R4 or R1 on production,
which means STOP-and-review under UO-1:
- `lock_timeout` (55P03), and any lock wait. **A lock_timeout on
  production is R4, STOP-and-review;**
- `statement_timeout` (57014);
- `transaction_timeout` (25P04, FATAL);
- a cancel;
- a transport failure (R1);
- a gateway error (R4);
- a request that starts late;
- concurrent sessions.

**Rehearsal receipts and SUPPORT** (C7, amended):
- the planned refusals' receipts may support a **separately reviewed**
  SUPPORT extension. That review needs the exact text, query and frame
  bindings, the ordered witnessed profiles, the raw receipts, and
  required-failing cross-text and combination tests;
- a new image or project is not authority to accept other variants;
- an unsupported outcome stays unsupported until that review.

**Not reachable on one project:** a second forward pass after a recovery.
The forward texts refuse once a rollback row exists (4(b)). The proposal is
one project, one forward pass and one full back-out. A second project is
created only if R0a–R4 change a text.

**RB-1 is not run** (§3.2).

### 2.6 Timing

- **A receipt's `startedAt`/`finishedAt`** is the sender's client-observed
  elapsed time for the request, network included. It is not the server's
  execution time.
- **The operator steps** are timed from the journal and the session record:
  token setup, read-backs, comparisons, app checks, a disposition if one is
  needed, and cleanup.
- **Before the production phase declaration is committed,** these
  measurements, each with a stated margin, replace §7's estimates.

### 2.7 Cost, and deleting the project

**Cost, read 2026-10-31.** It is re-read for the actual project when Ryan
creates it (Codex):
- The organization is on **Pro**. Its $10 monthly compute credit covers one
  Micro project, and it already runs five active projects.
- `get_cost` for a new project: **$10 a month**. Micro compute bills at
  **$0.01344 an hour**, and each started hour is billed in full. That is
  about **$0.32 a day**: about $1 for 3 days, about $2.26 for 7 days.
- **Compute hours are not covered by the spend cap.**
- This plan does not estimate disk or egress. For a database this small
  they are expected to be negligible, and the organization's usage page
  shows the actual charge.
- The project lives through three sessions and the reviews between them
  (§2.5), so days rather than hours: about $2.26 for 7 days.

**Deletion:**
- **When:** after the rehearsal's record commit, and before the production
  window is cleared.
- **How:** Ryan deletes the project in the dashboard (Settings → General →
  Delete project), and reports the time.
- **What it removes:** billing stops; its data, backups and keys are removed
  and cannot be recovered.
- **The store:** the retirement event then retires the ref (§2.3), and the
  sender refuses it from then on.
- **The tokens:** the session record lists both, deleted at the end of
  each rehearsal session, as for every phase.

### 2.8 The alternatives compared

| | PGlite only | P1′ only (production, rolled back) | throwaway + P1′ (**proposed**) | clone of a production backup + P1′ (noted) |
|---|---|---|---|---|
| Supabase's real role model | no: `postgres` is superuser there | yes | yes | yes |
| production's catalog, defaults, roles and dependencies | rebuilt from migrations under a simulated default | **yes** | rebuilt, then checked by P0′'s diagnostic rows, every difference named (§2.2) | copied, though a copy does not by itself prove platform equivalence |
| each step committed alone, read back by a later transaction | yes, locally | **no:** one transaction | **yes** | yes |
| recovery operations as separate committed transactions | yes, locally | no | **yes** | yes |
| the API route's real envelopes for refusals | no | only the paths that occur | **guard refusals only** (§2.5) | the same |
| each text's lock inventory | yes, one session | P1′'s own lock rows | **yes:** every text's lock rows; no contention | the same |
| lock waits, timeouts, a second caller | no | no | **no** (U-1) | no |
| main's app at each committed state | no | no | **PIN sign-in and an order save only** (§4.2) | the same |
| the whole path's timing, operator steps included | no | P1′ only | **yes** | yes |
| touches production | no | **a writing send per attempt** (a window each time) | read-only reads only | creates a copy of production |
| real data | no | yes, rolled back | no: synthetic | **yes: a second copy** |
| cost | none | a window | about $0.32 a day | the source's compute size, mirrored |

**What each leaves unproven:**
- **PGlite only:**
  - Supabase's role model;
  - the API route and its envelopes;
  - the guarded sender and classifier end to end;
  - concurrency, locks and timeouts;
  - the platform's own default privileges;
  - timing;
  - the app.

  It proves the SQL executes on PostgreSQL 17.5.
- **P1′ only:**
  - separate commits, and the read-backs between them;
  - recovery as committed transactions;
  - real refusal envelopes outside its one transaction;
  - the app at intermediate states;
  - the whole path's timing.

  Every further attempt is another production writing send.
- **Throwaway + P1′:**
  - production's data, load and hardware;
  - each named residual, R-IMG first (§2.2);
  - lock contention, timeouts, cancels and transport failures (§2.5);
  - owner sign-in and the queue at intermediate states (§4.2);
  - production's identity: the texts' guards pass on both (§2.4).

  P1′ covers the catalog, role and default half of that on production
  itself, in one transaction.
- **Clone** (Supabase "Restore to a new project", beta; paid plan with
  physical backups):
  - it would copy production's database: data, roles and default
    privileges, but no storage objects;
  - Supabase's own restore documentation lists extensions, settings and
    service configuration among the items needing attention, so a copy is
    not by itself proof of platform equivalence (Codex);
  - it copies employee PINs, customer orders and auth users with hashed
    passwords;
  - a cloned project cannot itself be cloned;
  - it mirrors the source's compute size.

  Recorded so Ryan can weigh it. It is not proposed, because it makes a
  second copy of real data.

## 3. The recovery mapping from 01

**3.1 01 is now an operating state.** Codex's re-opening checks passed
there, and the counter has run at 01 since 2026-10-13. So the mapping's
floor is 01, not "nothing Release 2".

**3.2 The mapping, under policy B** (C4, ruled conditionally; §3.5):

| committed prefix | catalog state (A1a) | main's app (§4) | in the window | later, if a back-out is ever wanted |
|---|---|---|---|---|
| 01 | after 01 | works (re-opening checks, 2026-10-13) | rest here if §3.5 holds | none needed |
| 01–02 | after 02 | expected to work | rest here if §3.5 holds | RB-2, in its own reviewed session |
| 01–04 | after 04 | expected to work | rest here if §3.5 holds | RB-43, then RB-2 |
| 01–05 | after 05 (A2) | expected to work | rest here if §3.5 holds | RB-5, RB-43, RB-2 |

- **U's policy A columns are dropped.** Under B a stop at a verified state
  is an allowed branch, so finishing the later forward steps is not
  mandatory after every admission (Codex).
- **A state that fails §3.5 does not re-open.** That includes a failed
  smoke test: STOP-and-review, and the reviewed recovery route stays
  available.

**RB-1 is outside the mapping** (C5, accepted):
- it would take ACCESS EXCLUSIVE on `employees` (§1.2);
- nothing in the remaining path requires leaving 01;
- it stays a reviewed text in the repository;
- P1′ does not run it either. P1′'s own locks are §1.2's: excluding RB-1
  removes its ACCESS EXCLUSIVE, not P1′'s other locks.

**3.3 STATE′.**
- STATE's `recovery` column encodes the old table. At 01 it returns
  `RB-1` (read on 2026-10-13).
- STATE selects the sequence, and no operation is chosen from memory. So
  the new mapping needs a new pinned text, STATE′: STATE's reads with
  this table.

**3.4 UO-1 is unchanged.**
- STATE′ selects a recovery only for a SETTLED state.
- After an UNRESOLVED writing send: STOP-and-review, no retry, no recovery,
  and the project hold stays. The counter follows §4.4.

**3.5 Policy B and its conditions** (Codex, C4). Before the counter
re-opens at any settled state, every one of these holds:
- STATE′, and POST′ accepted for exactly that state (§6.4): the exact
  prefix, the empty protected tables, every unrelated object and default
  unchanged;
- the four Release 2 endpoints dark on production;
- no request in flight and no UNKNOWN outcome;
- the tokens deleted and the windows closed;
- the production smoke test passed (§4.2).

A failed check has no automatic re-opening. B is not a way to leave an
UNKNOWN state operating or to hide a bad state.

**3.6 Recovery coverage** (Codex's note). One forward pass and one back-out
exercise every rollback operation. They do not visit every ledger history
each operation can start from. Two histories with the same catalog state are
not treated as the same state until each is checked:

| ledger history | catalog state | local PGlite run | the rehearsal (R3, R4) |
|---|---|---|---|
| fresh 01 | after 01 | yes | yes (R0b) |
| fresh 01–02 | after 02 | yes | yes (after P2-02) |
| fresh 01–04 | after 04 | yes | yes (after P2-0304) |
| fresh 01–05 | after 05 | yes | yes (after P2-05) |
| 01–05, then RB-5 | after 04 | yes | yes |
| 01–05, then RB-5 and RB-43 | after 02 | yes | yes |
| 01–05, then RB-5, RB-43 and RB-2 | after 01 | yes | yes |
| RB-2 from a fresh 01–02 | after 01 | yes | **no** |
| RB-43 from a fresh 01–04 | after 02 | yes | **no** |

- **What covers the rows the rehearsal does not reach:**
  - the local run, which already runs the recovery from every committed
    prefix (N7). It is extended to STATE′'s mapping;
  - an exact analysis of each RB wrapper's guard: which catalog function
    set and which ledger rows it requires.
- **What STATE′ classifies by:** a state's ledger rows and its catalog,
  never its catalog alone.

## 4. The live app at main@7ec5af4 at every state the forward path can leave

**4.1 What the counter uses:**
- PIN sign-in;
- owner sign-in;
- order saving;
- the upload queue (Netlify functions, `pending_jobs`/`print_jobs`,
  Storage), fed by the customer upload page `/upload`.

§1.3 gives the code paths.

**4.2 What is shown where** (U-5; Ryan, 2026-11-02).

**The static check** is part of the implementation commit's tests: no file
reached from main's browser entry points names a Release 2 table or
function. It runs on main's tree at `7ec5af4`, read from git. It is a fact
about the code, not a run.

**The rehearsal's app check, narrowed to what it exercises:**
- **The claim:** at each committed state on the throwaway, main@7ec5af4's
  browser code signs in by PIN (`verify_employee_pin`) as a synthetic
  employee and saves an order that reads back.
- **Nothing else is claimed for it:**
  - not owner sign-in or membership resolution: a sign-in screen that
    renders is not authentication;
  - not the upload queue: `yarn dev` alone runs no Netlify functions.
- **How Ryan runs it:**
  - in a clean clone of main@7ec5af4, with that clone's tracked `.env`
    deleted, so no production URL is present to fall back to;
  - with a gitignored `.env.local` naming the throwaway's URL and
    publishable key.
- **Before any PIN is typed,** the browser's network panel must show the
  first Supabase request going to `<throwaway ref>.supabase.co`. Otherwise
  STOP.
- **The synthetic PIN** exists only in BUILD-01's rows. Claude does not
  type it: it would go to a non-local host.
- **Each saved order's id and time** go into the session record. The next
  POST′ expects exactly those new `orders` rows (§6.4).

**The production smoke test, made representative.** On the live site, at
whatever settled state the window ends in, before re-opening (§7.1, step
10):
1. **PIN sign-in** with a real staff PIN.
2. **Owner sign-in:** Ryan signs in to the admin panel with the owner
   account, and the order history opens. That covers Supabase Auth,
   membership resolution and RLS.
3. **Order save: one minimal order,** for example a single black-and-white
   copy, with `STAGE0 SMOKE <date>` in the Save Order dialog's notes. It
   is reported saved, not queued offline, and appears in the order
   history. **Recorded** in the session record: its id, store, time
   (UTC), amount and purpose ("stage-0 window smoke test, kept as a test
   record"). No other test order is made.
4. **An upload through the queue:**
   - a small synthetic file is sent through `/upload`, with
     `STAGE0 SMOKE` as the customer name;
   - **before completion,** a labelled ad-hoc read (below) records the
     job's id and its file's bucket path, and shows that the Storage
     object record for that path exists. That is the read's positive
     control;
   - the job appears in the Queue tab, and it opens;
   - the job is completed through the app;
   - **after completion,** the same read again (below).
5. **Sign out.**

**The smoke order is kept** (C10: Codex's ruling on V, and Ryan's decision,
2026-11-02):
- **It stays as a durable, labelled test record.** Nothing deletes it: no
  removal step, no dashboard deletion, no SQL.
- **It shows in the ordinary history and reports.** Main's order history
  has no exclusion for test orders (`src/components/OrdersDashboard.jsx`
  at `7ec5af4`), so the order counts in its volume and revenue rollups,
  and in the margin view if it carries a cost. Ryan should expect it
  there. No price, margin or report is altered to hide it.
- **If Ryan later wants it deleted,** that is a separately reviewed,
  exact-row guarded operation on Codex's terms: the recorded id, store
  and label, the expected row, its dependencies and side effects, an
  asserted affected-row count, its own policy, go, receipt and readback,
  and its unknown-outcome handling. Never a wildcard by label or a bulk
  "smoke cleanup". It is not part of this plan or its window.

**The upload's file removal is checked separately** (Codex, review of V).
`complete-job` does not inspect `storage.remove`'s error before it deletes
the job row (§1.3), so neither its 200 nor the job leaving the queue shows
that the file is gone.
- **The read:** a labelled ad-hoc read, through `execute_sql`, of exactly
  the synthetic job:
  - the `pending_jobs` row, found first by its `STAGE0 SMOKE` customer
    name and its time, then read by its recorded id: its file paths before
    completion, and its absence after;
  - the `storage.objects` record with `bucket_id = 'customer-uploads'`
    and each recorded path as `name`: present before, and expected absent
    after.

  It reads metadata of that one synthetic job only: no other row, no file
  content.
- **What it can show:** that the Storage service's object record for the
  path is gone. It does not show that the underlying stored bytes were
  erased, and the record says so.
- **If the record remains, or the result is uncertain** (an error, an
  unreadable fact, a disagreement between the reads): record it with both
  reads, and bring it back to Codex for a bounded disposition. **No cleanup
  write** is made for it, through the app, the dashboard or SQL.
- **Re-opening (C13, Codex's ruling on V2):** a remaining or uncertain
  object from this one synthetic upload does not, **by itself**, hold
  re-opening. It is recorded as a cleanup residual and brought back for a
  bounded disposition, with no further cleanup write. It is never reported
  as a successful removal.
  - **The exception is narrow.** Every other gate of §3.5 still holds:
    - the exact settled database state accepted;
    - the four endpoints dark;
    - no writing request unresolved or in flight;
    - the tokens deleted and the windows closed;
    - the smoke checks passed.
  - **It excuses nothing else:** not a failure to save the order, sign in,
    open the uploaded file or complete the queue action, and not a state
    that cannot be established. It never waives an unknown writing-send
    hold, and never covers a customer's file.
  - The runbook's smoke-and-re-opening predicate carries this exception
    explicitly, so it cannot contradict a generic "smoke passed".
- **Realtime (Codex's note on V2):** opening the Queue tab after the upload
  can load the job from its first query, which shows nothing about
  Realtime. So the Queue tab is open and subscribed before the upload. The
  record claims Realtime delivery only if the new job appears there without
  a reload.
- **One job, bound first:** the reads are of one uniquely identified
  synthetic job, by its recorded id and exact bucket path. A missing or
  ambiguous identification never widens the read, and starts no cleanup.
- `complete-job` creates no order row, so the upload path needs no order
  cleanup.

**What the smoke test leaves unproven:**
- other staff PINs, and the manager role's margin view;
- other owner accounts and other tenants;
- the offline order queue's drain;
- e-mail ordering (`send-print-job`);
- job history (the job-files helpers);
- the kiosk;
- the scheduled `cleanup-stale-jobs`;
- behaviour under a day's load.

It also shows only the window's final state, at one moment.

**What the rehearsal leaves unproven at intermediate states:** owner
sign-in and the queue. Re-opening does not depend on them there. The counter
re-opens only at the window's final settled state, where the full smoke test
runs (§3.5).

**4.3 During a step** (corrected, U-3):
- **The counter is closed for the whole window.** That costs nothing
  outside store hours, and it keeps the smoke test clean.
- **Two things stay live:** the customer upload page and the scheduled
  `cleanup-stale-jobs`. Their DML takes RowExclusiveLock, which conflicts
  with no table lock in §1.2.
- **A row conflict** needs the same row or the same unique key. P1′ writes
  only rows it creates.
- **The limit:** this follows from the lock modes and from reading the SQL.
  It is not a contention measurement.

**4.4 After an UNRESOLVED writing send** (C6 rejected). The existing rule
stands, for 02–05 and P1′ as for every writing text:
- STOP-and-review;
- the hold on further sends;
- the counter stays closed until a separate reviewed incident decision,
  Monday morning included (BC rejected, review of `0bbf598`).

**Why:** a quiet STATE′, a lock read and a smoke test do not show that a
queued upstream request cannot start later. Function-only DDL is a real
difference in risk, but it is not a re-opening exemption. A later proposal
would need an analysis of the exact operation, a late start, and the
resources and fixtures it touches.

## 5. Supabase's 30 October grants change

**5.1 What changed** (discussion 45329, read 2026-10-31):
- **Tables:** new tables in `public` are no longer granted SELECT, INSERT,
  UPDATE and DELETE automatically to anon, authenticated and service_role.
- **Sequences:** the post's opt-in SQL also revokes USAGE and SELECT on new
  sequences.
- **Projects:** the setting became the default for new projects from 30
  May, and was **applied to all existing projects on 30 October.**
- **Existing objects** keep their grants.
- **What the post does not establish:**
  - how the change is implemented in an existing project's default
    privileges, or each project's actual rows. P0′'s default ACL rows, at
    the global and schema scopes, are that evidence (§2.2);
  - anything about functions: its SQL does not touch them.

**5.2 Confirmed for 02–05** (§1.1, from the four files):
- they create **no table and no sequence**, and no identity or serial
  column;
- **every function they create** is followed in the same file by `revoke
  execute … from public, anon, authenticated, service_role` (PUBLIC first)
  and explicit grants;
- **`release2_record_attempt` is replaced in place** by 03 with
  `CREATE OR REPLACE`, with no revoke or grant, so it keeps the ACL 02
  set: postgres and service_role;
- **04 replaces `release2_create_staff_session` in place** and re-issues
  its revoke and grant anyway;
- **03's `DROP` + `CREATE` of `clear_lockout`** resets its ACL and comment,
  and both are re-issued.

So none of 02–05's objects takes a grant from the table or sequence default.

**5.3 Checked against the rehearsal's ACL readback.**
- **Neither existing check saw the new default:**
  - staging received 02–05 on 2026-09-28;
  - P1 asserted A1a's EXECUTE grantees for every state inside its
    transaction on production on 2026-10-08 (P1 PASS).
- **What the explicit revokes fix:** the four named roles end up exactly as
  granted, whatever the default.
- **What they do not fix:** a default grant to **any other role** survives
  those four REVOKEs. Codex showed this locally (I3-2), and showed that a
  **global** default does the same while the public-scope rows stay equal
  (U-2).
- **Why that is still caught:** the A1a check is an exact set of
  `grantee=privilege` pairs from
  `aclexplode(coalesce(proacl, acldefault('f', proowner)))`, compared both
  ways. It runs:
  - in every forward and RB wrapper, before commit;
  - in P1's proofs.

  A step under a wider default would therefore **refuse**, not commit a
  wider ACL. Those exact grantee-set assertions remain necessary.
- **The new evidence this plan adds:**
  - P0′ reads production's default ACL rows at the global and `public`
    scopes (§2.2);
  - P1′ re-asserts A1a under them, on production;
  - BUILD-01 sets the throwaway's rows to exactly those before 02–05 run.

**5.4 Where the change does matter: any rebuild from the migrations.** A
database built from them after 30 October differs from production unless
the old default is reproduced first:
- **the 20 older tables:** see the parked grants record (§I, item 4). Its
  rebuild evidence: without the record, 1 of 28 app-shaped checks passes
  under every new-default variant. The parked record stays separate from
  this plan;
- **01's own six tables:**
  - 01 grants service_role SELECT, INSERT, UPDATE and DELETE explicitly
    (`20261009151706_release2_01_identity_schema.sql:243–247`), and revokes
    only from public, anon and authenticated (:238–241);
  - service_role's full set on production (A2: `arwdDxtm` on staging) came
    partly from the old default;
  - under a default that removes every table privilege, a rebuild gives
    service_role `arwd` only, and A2's table proof fails;
  - under the post's SQL, which revokes only SELECT, INSERT, UPDATE and
    DELETE, the rest would still come from the default.

  Which of the two production now has is what P0′'s default rows show.
- **Hence BUILD-01's two exact default targets:** the old one before the
  migrations, and production's current one after them (§2.1).
- **The PGlite harness's shim uses the old default**, so its 01 state
  matches production's. The local run "from 01" adds a second variant with
  production's current default for 02–05.

## 6. The texts

### 6.1 New and preserved pinned texts

Each is emitted by the assembler from git blobs and md5-pinned in the
manifest. Its send policy fixes its targets, `read_only`, window and
`effect`. Names are provisional.

| text | effect | window, `read_only` | targets | what it is |
|---|---|---|---|---|
| **P0′** | read | R, true | production, rehearsal | **The baseline at 01, and only at 01** (§6.4). §2.2's diagnostic rows, parts 1–10, with an md5 per part. 01's identity: version, md5, 13 720 bytes, `created_by`, one element, final LF. The ledger is exactly the 21 files, head `20261009151706`. The six Release 2 tables present and empty, `employees_id_store_uniq` present, catalog state 01 (A1a). `catalog_fingerprint` as P0 defines it. `server_version_num` ≥ 170000. The probe and nil identities absent; `auth_users_user_triggers` 0; `free_pins` ≥ 3; `stores_without_org` 0. `rehearsal_marker` |
| **POST′** | read | R, true | production, rehearsal | **The post-step readback** (U-4). The same observations as P0′, without P0′'s baseline-only preconditions. Its acceptance takes one intended state, bound to the step just sent, with that state's reviewed Release 2 EXECUTE rows (V-2, §6.4) |
| **WHO-P**, **WHO-R** | read | R and W, each with and without `read_only` | production; rehearsal | Codex's Q-4, on each project: the role, the transaction mode and the relevant effective privileges, for each token and mode. Modelled on item 3's WHO texts: SELECTs only, confined statement by statement as M-6e confines item 3's. No INSERT, DDL or mode-switch probe |
| **P1′** | write | W, false | production, rehearsal | `begin isolation level repeatable read`, then E1's settings (statement 90 s, transaction 110 s). **Section 0′:** capture the catalog and the real-row md5s. S0.2 is replaced by a check that the catalog is state 01 (A1a) and the ledger's head is 01's row. Then **P2-02's body verbatim**, section 1's fixtures, a `savepoint`, 03 alone, the 42702 proof (1b), and `rollback to savepoint`. **P2-0304's and P2-05's bodies verbatim.** Section 2 (A2, end to end), section 3 (fixture removal), **RB-5, RB-43, RB-2** through their wrappers, and section 4: the catalog equals section 0′'s row for row. **Lock rows** at named boundaries, never inside the savepoint (below). Then its one final result, then `ROLLBACK`. Unlike P1: no 01 body, and **no RB-1** |
| **STATE′** | read | R, true | production, rehearsal | STATE's reads, with §3.2's mapping |
| **BUILD-00** | read | R, true | rehearsal only | The fresh project's real initial shape and the non-public preflight's shapes (§2.1) |
| **BUILD-00W** | read | W, false | rehearsal only | The W role BUILD-01 will run as, and its authority over each preflight object (§2.1). SELECT-only, confined as M-6e confines item 3's texts |
| **BUILD-01** | write | W, false | rehearsal only | §2.1. Assembled in the binding commit, with BUILD-00's and BUILD-00W's accepted facts, which it re-asserts before the first file runs |
| P2-02, P2-0304, P2-05, RB-5, RB-43, RB-2 | write | W, false | production, **plus rehearsal** | **Bytes preserved** (C8, accepted), subject to the local run and the rehearsal showing that their guards accept the 01 state as written: they assert "after 01" and check the identity rows as a subset. Gaining a target changes their policy, so each now **declares `effect`** (§6.3) |
| CANCEL-INSPECT, CANCEL-STEP-TEMPLATE | as now, plus `effect` | C | production, plus rehearsal | preserved |
| P0, P1, P2-01, RB-1, STATE | — | — | — | **Not in any new phase.** They stay in the manifest as history. P0 expects pre-01 values, P1 and P2-01 refuse over 01, RB-1 is outside the mapping, and STATE encodes the old mapping |

- **New texts:** every one declares `effect`. The 29 legacy compatibility
  entries are not widened.
- **01's ledger identity is preserved:** no text writes, moves or deletes
  01's row. P0′ and POST′ check it at every read.
- **U's FAULT-LOCK is dropped** (U-1).

**P1′'s result and its lock rows** (C9, accepted as bounded evidence):
- **One final result, with an exact schema:** `n integer, kind text,
  at text, fact text`, ordered by `n`, returned just before `ROLLBACK`.
  `kind` is `proof` or `lock`:
  - a `proof` row is one of P1's proof rows: `at` is the proof id, and
    `fact` what it proved;
  - a `lock` row is one lock of P1′'s own backend
    (`pid = pg_backend_pid()`) at one boundary: `at` is the boundary's
    name, and `fact` is `locktype|mode|granted|target`. The target is the
    relation's schema-qualified name, or `pg_describe_object` for an
    object lock.
- **Bounded size:**
  - locks on `pg_catalog` and `pg_toast` relations are one summary row per
    boundary, with their count and modes;
  - so are the lock types other than relation and object, with a count per
    type;
  - the success predicate requires exactly the declared boundary names, and
    at most a fixed total row count. The implementation sets that count
    from the local run's, with a stated margin. A larger or differently
    shaped result is not success: STOP-and-review.
- **Recorded outside the rolled-back subtransaction.** Every lock row is
  written at a boundary of the top-level transaction: after section 0′,
  after P2-02's body, after section 1 (just before `savepoint`), just after
  `rollback to savepoint`, after P2-0304's body, after P2-05's body, after
  sections 2 and 3, after each RB wrapper, and after section 4. **None is
  written inside the savepoint,** so none is undone with it.
- **What the savepoint hides:** 1b's own proof rows are written inside it
  and undone with it, as in P1. Their only evidence is that the
  transaction continued past them, since a failing check raises. The
  locks held inside the savepoint are not observed either.
- **The implementation's tests:** the local run shows every declared
  boundary's rows present in the result, and a mutant that records a
  boundary inside the savepoint loses those rows and fails the success
  predicate.
- **The stated gaps stay:** failed subtransactions (every
  `stage0_expect_error` probe), transient locks between boundaries, row
  locks (§1.2), platform hooks, and concurrency.

### 6.2 The classifier scope (Codex's review of `95ecd65`, plan §I)

For each form the runbook relies on, the implementation commit brings
together:
- the exact SQL and its pins;
- **each PERFORM's source and query, bound per text:**
  - P1′'s proof helpers (43 lines of the proofs file match `perform`);
  - RB-43's two `perform set_config('release2.rollback_op', …)`
    (`assemble-stage0.mjs:440`), inside P1′ and as RB-43;
- **named-function frames**, such as P1′'s `pg_temp` check helpers, if a
  failure can surface through them;
- the **witnessed ordered profile** and its receipt;
- the success and result predicates: SUCCESS entries for P0′, POST′,
  WHO-P, WHO-R, P1′, STATE′, BUILD-00, BUILD-00W and BUILD-01, with the
  preserved texts' entries unchanged;
- **tests** that refuse the same query or frame under another text, or in
  an unreviewed combination.

**The design aim.** Each new writing text catches every guard and proof
failure and raises it again from its top-level DO block. The refusal is then
one of the witnessed "re-raised" or "detail/hint re-raised" profiles, and no
new profile is needed for a check that fails. P1's section 0 calls its
checks from top-level SELECTs today, so P1′ wraps them. Some failures cannot
be caught there:
- 25P04 from `transaction_timeout`, which is FATAL;
- a `statement_timeout` or `lock_timeout` raised inside a PERFORMed helper.

**These stay residual R4, STOP-and-review,** unless a receipt shows them
and Codex reviews that profile. So does any planned refusal of §2.5 that
turns out not to be a witnessed profile: it is a hold, and its first
receipt goes to Codex (U-1).

**Unchanged:**
- the uncaptured STMTTIMEOUT PERFORM stays R4;
- CANCEL-STEP-TEMPLATE's optional forms stay unsupported while no runbook
  relies on them.

**Where receipts come from.** SUPPORT grows only in a reviewed capture
commit of sender receipts. Every receipt so far is from staging. §2.5's
planned refusals on the rehearsal project may supply more, under C7's
amended terms.

### 6.3 C8's detail: M-12 and `effect`

- **What M-12 does today:** it forbids `effect` on the legacy names.
- **The implementation commit updates M-12** to allow a reviewed, explicit
  `effect` on these legacy identities when their policy changes (the
  rehearsal target).
- **LEGACY_EFFECT, the frozen compatibility table** for the historical
  policies, is kept as it is. It is never edited to bless the new target
  set.
- **Tests:**
  - historical receipts keep their classification and their holds;
  - a changed policy with a missing or invalid `effect` is handled
    conservatively, as writing.

### 6.4 State-aware readback contracts (U-4)

**P0′ accepts only state 01.**
- **Its baseline-only preconditions, in code, at every run:**
  - the ledger is exactly the 21 rows, with head 01;
  - the catalog is state 01 (A1a);
  - the Release 2 EXECUTE rows are exactly 01's (below), with no row of a
    later state;
  - P0′'s other preconditions (§6.1).
- **The first capture on each project is evidence, not a comparison**
  (Codex, review of V):
  - at the production baseline session, and at R0b on the throwaway, P0′
    checks only those preconditions and reports every observation;
  - Codex reviews that receipt;
  - a binding commit then pins it by hash: the md5 of each part, and of
    the whole;
  - from then on, every P0′ and POST′ on that project is compared with
    the bound receipt.

  No comparator needs a receipt approved before it can report it.
- **When it runs:**
  - at each baseline session: the first capture;
  - at the window's start: every MATCH fact equal to production's bound
    baseline;
  - after P1′ on production: under the data scope below;
  - after R1 on the throwaway: equal to R0b's bound baseline, data
    included, since nothing else has written there yet (§2.5).

**P0′ around production P1′: the data-comparison scope** (Codex, review of
V). Customers and the scheduled cleanup can act while the counter is
closed. Two kinds of read answer different questions:
- **inside P1′,** under repeatable read, sections 3 and 4 compare against
  section 0′'s snapshot. They show that P1′'s own actions left the real-row
  digests of the five tables its fixtures write (`employees`, `stores`,
  `organizations`, `memberships`, `auth.users`), and the catalog, as they
  were. Another session's commit after the snapshot is invisible to them;
- **the P0′ after P1′** is a new transaction. It shows the database as it
  is now, including what others committed meanwhile, and it cannot
  separate P1′'s effect from theirs.

So the window-start P0′ and the P0′ after P1′ are compared fact by fact:

| fact | rule | why |
|---|---|---|
| the ledger | equal, else STOP | P1′'s wrappers write ledger rows inside its transaction (P1 wrote ten), so a committed P1′ would leave them |
| every MATCH fact of parts 1–9 | equal, else STOP | as at every read |
| the six Release 2 tables empty; the probe and nil identities absent; `rehearsal_marker` false | equal, else STOP | as at every read |
| the row counts and real-row digests of `employees`, `stores`, `organizations`, `memberships` and `auth.users`; `free_pins`; `stores_without_org` | equal, else STOP | P1′'s fixtures write these tables. While the counter and the admin panel are closed (the runbook closes every counter and admin tab first), nothing is expected to write them. Supabase Auth could still write `auth.users` on a link request (§1.3); that too stops, as unexplained until reviewed |
| the row counts of `orders`, `settings`, `addons`, `discounts`, `outsourced_products`, `paper_types`, `print_jobs` and `sheet_prices`, which section 3 reaches through foreign keys | equal, else STOP | only the browser app writes them, and the counter and admin panel are closed (§1.3) |
| the row count of `pending_jobs` | recorded, with its known possible writers as context, not compared | the customer upload functions and `cleanup-stale-jobs` stay live (§4.3) |

- **A STOP here is conservative:** no further write starts, and the
  receipts go to review. A difference is not read as proof that P1′
  committed.
- **A change in `pending_jobs` is not evidence either way.** A changed
  count does not identify its writer. The record names the known possible
  writers as context, and never attributes a change to one of them without
  evidence for it (Codex's review of V2).
- **Part 10 therefore adds** the real-row digests of those five tables,
  computed as P1's section 0 computes them: an md5 over the rows, never a
  value.

**POST′ accepts one intended state, taken from the step just sent:**
- the workflow declares each step's intended state, and the gate passes it
  on;
- POST′ never accepts "some recognized state".

| step sent | intended state | ledger, beyond the 21 baseline rows | catalog |
|---|---|---|---|
| P2-02 | after 02 | exactly 02's row: name, md5, bytes, `created_by`, a version after the head | the baseline rows, with exactly A1a's after-02 delta on the Release 2 functions |
| P2-0304 | after 04 | 02's row, then 03's and 04's, 04's one second after 03's | the after-04 delta |
| P2-05 | after 05 | as above, plus 05's row | the after-05 delta (A2) |
| RB-5 | after 04, rolled back | plus 05rb's row | the after-04 delta |
| RB-43 | after 02, rolled back | plus 04rb's and 03rb's rows | the after-02 delta |
| RB-2 | 01, rolled back | plus 02rb's row | the baseline catalog |
| a planned refusal (§2.5) | unchanged | exactly the previous accepted readback's | exactly the previous |

**In every case POST′ also requires:**
- 01's identity unchanged;
- the six protected tables empty;
- every catalog row outside the permitted Release 2 delta identical to the
  bound baseline, shown by diagnostic rows and by a fingerprint of the
  rest;
- **the Release 2 EXECUTE rows exactly the intended state's reviewed rows,
  and every other role fact identical to the bound baseline** (V-2,
  below);
- the default ACL, setting, dependency and event-trigger rows identical to
  the same project's bound baseline;
- the data facts under the same scope as around P1′ (above):
  - on production, the STOP rows equal to the window-start P0′, and
    `pending_jobs` recorded. The smoke test comes after the last POST′;
  - on the throwaway, every data fact equal to the previous accepted
    readback, except `orders`, which grows by exactly the orders that the
    app checks since then saved and recorded (§4.2);
- on production, the four Release 2 endpoints dark: an HTTP read, as in
  the re-opening checks. The throwaway has no deployed endpoints.

**V-2: the role facts each intended state permits to change.** Part 4
holds one row per role and Release 2 signature, with its effective EXECUTE
(`has_function_privilege`), explicit false rows included. A step changes
those rows legitimately: at 01 there are three rows for `anon`,
`authenticated` and `service_role`, and after P2-02 nine (Codex's local
probe). So POST′ compares part 4 in two halves:
- **every role fact outside the Release 2 EXECUTE rows stays exactly the
  bound baseline's:** attributes; memberships with their admin, inherit and
  set options; schema and table privileges; EXECUTE on `auth.uid()`,
  `extensions.gen_random_bytes`, `extensions.digest` and every other
  function;
- **the Release 2 EXECUTE rows must be exactly the reviewed rows of the
  intended state:** no row missing, no row extra, no value different.

**The reviewed rows for `anon`, `authenticated` and `service_role`.** They
come from Codex's local probe, and agree with A1a's grantee sets
(production plan §A1a). T is true, F false:

| intended state | signature | anon | authenticated | service_role |
|---|---|---|---|---|
| **01** | `redeem_enrollment_ticket(bytea, bytea, bytea, text)` | F | F | T |
| **after 02** | `redeem_enrollment_ticket(…)` | F | F | T |
| | `release2_record_attempt(text, text, integer, integer, integer)` | F | F | T |
| | `release2_clear_lockout(text, text, uuid)` | F | **T** | T |
| **after 04** | `redeem_enrollment_ticket(…)` | F | F | T |
| | `release2_record_attempt(…)`, replaced in place by 03, ACL kept | F | F | T |
| | `release2_clear_lockout(text, text, uuid, uuid)` | F | **T** | T |
| | `release2_create_staff_session(uuid, uuid, bytea, bytea, timestamp with time zone, timestamp with time zone)` | F | F | T |
| | `release2_prune_auth_attempts(integer)` | F | F | T |
| **after 05** | the five rows of after 04 | as after 04 | | |
| | `release2_revoke_enrollment(uuid, uuid, text)` | F | F | T |

- **Counts:** 3 rows at 01, 9 after 02, 15 after 04, 18 after 05, as the
  probe found.
- **Removed signatures:** after 04 and after 05, a row for the
  three-argument `release2_clear_lockout` is an unexplained extra row.
  After RB-43, a row for the four-argument form is.
- **Replacement in place** (`release2_record_attempt` in 03,
  `release2_create_staff_session` in 04) keeps the signature, so its rows
  do not change. The new bodies are part 2's catalog delta.

**The other roles part 4 names** (`postgres`, `authenticator`,
`supabase_read_only_user`, the owners of SECURITY DEFINER functions in
`public`, and R's and W's roles). Their rows depend on each role's
attributes and memberships on that project, which only the bound baseline
shows:
- the implementation commit carries the rule their rows follow. A role's
  row is true when it is in A1a's grantee set for that signature, holds a
  grantee's privileges through a baseline membership, owns the function,
  or is a superuser; otherwise it is false;
- after each project's baseline review, the binding commit adds those
  roles' literal rows for every state, reviewed with the receipt;
- POST′ compares against the literal rows, never against the rule at run
  time. A test checks that the literal rows agree with the rule and the
  bound memberships.

**Bound to the same intended state as the ledger and catalog delta.** The
gate passes one intended state, and it selects all three:
- RB-5's POST′ takes the after-04 rows, RB-43's the after-02 rows and
  RB-2's the 01 rows, each with its own ledger history;
- a planned refusal takes the previous accepted readback's rows;
- P0′ takes only the 01 rows.

**The tests the implementation brings** (Codex, review of V). They run on
the comparator, with observation rows read from the local run's real
catalog at each state:
- **every legitimate transition passes:**
  - fresh 02, 04 and 05;
  - RB-5, RB-43 and RB-2 after the full forward pass;
  - §3.6's two local-only histories: RB-2 from a fresh 01–02, and RB-43
    from a fresh 01–04;
- **each of these fails, with its reason named:**
  - **a wrong EXECUTE grant,** made by a real `GRANT` in the local
    database: for example `anon` on `release2_record_attempt` after 02,
    or `authenticated` on `release2_create_staff_session` after 04;
  - **an unrelated membership change:** for example `authenticator`
    granted `service_role`, or a membership's inherit option changed;
  - **an unrelated privilege change:** for example `anon` gaining SELECT
    on a `public` table, or EXECUTE on `auth.uid()` or on a
    non-Release-2 function changing;
  - **a missing expected row:** for example `service_role` on
    `release2_revoke_enrollment` absent after 05;
  - **an unexplained extra row:** the three-argument
    `release2_clear_lockout` still present after 04, or a row for a role
    outside the bound role set;
  - **the right rows under the wrong history:** after-05 rows offered to
    RB-5's POST′;
  - **any Release 2 row beyond 01's** offered to P0′.
- **Each negative is a required-failing mutant,** as in item 3's mutation
  companions: it must turn into exactly its expected refusal, never an
  exception.

**Progression is bound to it:**
- the gate admits the next step only after POST′ for the intended state is
  accepted;
- the step's own receipt is still classified by rule 3′;
- a resting state under B is accepted only by POST′ for that state, plus
  §3.5.

## 7. The production window

### 7.1 Steps, counter-closed time and the Read token's role

The time budget follows the P1–P3 runbook's §B. Every estimate is replaced
by the rehearsal's measured time plus a stated margin before the phase
declaration is committed (§2.6). Durations are minutes. **The counter is
closed from §2 to §11.**

| § | step | who | counter closed | elapsed | the Read token in this step |
|---|---|---|---|---|---|
| 1 | Before the window, counter open: a clean clone at H, the suite, the 14-state replay with `STAGE0_REPLAY_KEEP=1` (about 35 min), dry runs, store status | C | 0 | — | — |
| 2 | Counter closed. The backup read and **the day's orders exported or printed** (§8.2), the published deploy, Claude's first read-backs (LOCKS, ad hoc) | R + C | 15 | 0:15 | not loaded |
| 3 | The clock check. Two windows, two tokens, V-checks, markers; the go line registered | R + C | 15 | 0:30 | loaded in R only |
| 4 | P0′, STATE′; compared with the baseline session's receipts (§6.4) | R + C | 5 | 0:35 | **R sends.** What stops an unintended write, in order: the pinned bytes are SELECT-only (md5, M-6-style confinement); the sender refuses a text outside R's policy; the go names this step only. The Read PAT's read-only default is an **accident barrier only, never a write boundary**. Item 3 measured it on staging's newer image; for production, only WHO-P speaks |
| 5 | LOCKS, P1′, its rows and lock rows, P0′ again, STATE′ | R + C | 12 | 0:47 | **P1′ is W only.** A P1′ go cannot be admitted in R (wrong window). Nothing about the Read token is counted on for P1′'s safety |
| 6 | P2-02: send, classify, POST′ (after 02), STATE′ | R + C | 7 | 0:54 | W sends; POST′ and STATE′ are R, as in §4 |
| 7 | P2-0304: as §6, POST′ (after 04) | R + C | 7 | 1:01 | as §6 |
| 8 | P2-05: as §6, POST′ (after 05) | R + C | 7 | 1:08 | as §6 |
| 9 | A2, STATE′, CONSUMERS, the endpoints' darkness | R + C | 8 | 1:16 | R reads, as in §4 |
| 10 | **The smoke test (§4.2):** PIN sign-in, owner sign-in, the minimal `STAGE0 SMOKE` order (its id, store, time, amount and purpose recorded), an upload through the queue with the labelled file read before and after its completion, sign out | R + C | 18 | 1:34 | — |
| 11 | Tokens deleted, windows closed, store status | R + C | 5 | 1:39 | deleted |
| 12 | **Counter re-opens,** if §3.5 holds | R | — | **≈ 1:39** | — |
| 13 | The record commits (about 5 min of suite per commit). The smoke order stays (§4.2); a remaining or uncertain upload file goes to Codex for a disposition | C | 0 | — | — |

- **Total counter-closed time on the planned path: about 99 minutes.**
  V's 96 grows by the upload file's two reads (§4.2).
- **The clock check** is refreshed relative to when it was actually made
  and how much of its freshness is left. No step starts on a check that
  would lapse before that step's deadline.
- **A pause or an expiry ends the session:** tokens deleted and windows
  closed. Tokens are never left loaded.
- **The Read token is an accident barrier only,** in every production
  step, never a write boundary:
  - item 3 showed its read-only default on staging, for three statements.
    Nothing that switches the transaction mode first was tested (§E15);
  - **that was staging's image, 17.6.1.166.** Production runs 17.6.1.111;
  - so only the production identity read, WHO-P (Codex's Q-4), speaks for
    production. Q-4 already forbids inferring production's behaviour from
    staging;
  - WHO-P's values are read as evidence, never as a boundary.

### 7.2 Ceilings: the latest starts, from the whole remaining path

D is the reserve end. A step's ceiling is D less the time its whole
required path needs:
- the step itself, with its read-backs;
- under policy B, no in-window recovery;
- the close-out: final reads 5, smoke test 18, tokens 5, so 28.

| step | path under B | ceiling |
|---|---|---|
| P1′ | 12 + 28 | D − 40 |
| P2-02 | 7 + 28 | D − 35 |
| P2-0304 | 7 + 28 | D − 35 |
| P2-05 | 7 + A2 8 + 28 | **D − 43** |

- **A later step can have an earlier ceiling.** That is the P1–P3
  runbook's own shape (P-R1), and no ordering rule is added.
- **The window's length, provisional:** D = start + 2 h 15 min. The planned
  path takes 99 minutes, which leaves 36 minutes of margin. P2-05's
  expected start (start + 1:01) is 31 minutes before its ceiling
  (start + 1:32).
- **Before a declaration is concrete,** each estimate is replaced by its
  measured time and a stated margin (Codex):
  - the requests, the operator steps and the comparisons;
  - owner sign-in and the queue, with the upload file's two reads;
  - a disposition, if one is needed.
- **The production phase is declared in code:**
  - its steps, its gate and its ceilings, in the form
    `scripts/manual/stage0-guard.mjs` `WORKFLOWS` already takes;
  - drafted go lines, with each step's UTC latest start;
  - a **mandatory per-send not-after** from Claude's current whole-path
    check at the actual pace.
- **The rule is unchanged** (Codex, review of `0bbf598`): before any
  forward step, the whole remaining required path must end before D. Out
  of time means no more writes are started. Under B, stopping at a verified
  state is an allowed branch.

### 7.3 Times

**Ryan chose option A** (2026-11-02): **Sunday, the counter closed from
17:00 EST.**

| window, counter closed from the start | counter re-opens (planned) | reserve end D | UTC |
|---|---|---|---|
| Sunday 17:00 EST | about 18:39 | 19:15 | 22:00Z – 00:15Z |

- **The slack before the next opening** is Sunday evening and night. A STOP
  leaves it for review. After an UNRESOLVED send the counter stays closed
  until a reviewed decision (§4.4).
- **The date** is chosen with the window's clearance, which needs every
  review in §10 first. Ryan confirms that Sunday's closing time. The store's
  web page says "Open 7 Days" and gives no times.
- **Every EST and UTC line** in the go line comes from the actual date and
  the approved go, never from this table.

## 8. Recovery of last resort

**8.1 What exists:**
- **Daily physical backups.** The organization is on Pro, so production is
  backed up daily and the last 7 days can be restored. Its Postgres 17.6
  image uses physical backups.
- **PITR** is an add-on, and this plan does not know whether it is on. The
  dashboard shows it.
- **A restore** is a dashboard action on the whole project, and the
  project is inaccessible while it runs.

**8.2 Before the window (§7.1 §2; Ryan's decisions, 2026-11-02).**
- **The backup:** Ryan reads Database → Backups, read-only, nothing
  clicked. He records the latest backup's time and whether PITR is on.
  Codex asked for the backup and PITR status to be read again when it
  matters, and this read is that. **No backup within the last 24 hours:
  STOP, no window.**
- **The day's orders:** Ryan exports them (the order history's CSV export
  in the admin panel) or prints them, so they could be re-entered by hand
  if a restore were ever needed.
- **No logical dump and no PITR** are taken for the window.

**8.3 What restoring that backup would lose** — everything written after
the backup's time:
- that day's saved orders, which the export or print in §8.2 records;
- `print_jobs`/`pending_jobs` rows;
- employee, price and settings edits;
- auth changes: new users and password changes. Refresh tokens issued
  since become invalid, so staff sign in again;
- membership changes;
- the window's own ledger rows and 02–05.

**Storage objects are not in a database backup:**
- files uploaded since the backup stay in Storage with no
  `storage.objects` row (orphans);
- files deleted since are not restored.

**Also:**
- daily backups do not store custom-role passwords (none is known in this
  project);
- the counter is down until the restore completes.

**8.4 Ways to lose less, not taken** (Ryan, 2026-11-02):
- **a logical dump** just before the window (`pg_dump`). It would need the
  database password in Ryan's shell, and the dump would hold real data;
- **PITR for the window:** about $0.137 an hour, plus at least Small
  compute. The compute change restarts the project, and daily backups stop
  while PITR is on;
- **"Restore to a new project"** of the pre-window backup, for
  investigation without overwriting production. It is a second copy of
  real data.

**8.5 When:**
- **Never as a stage-0 step.** A backup is an incident option with
  data-loss consequences, not a routine retry or recovery (Codex).
- **A settled state** has its reviewed recovery, or is an operating state
  (§3).
- **An UNRESOLVED send** is STOP-and-review.
- Neither calls for a restore by itself. A restore is Ryan's incident
  decision, only if production is unusable and no reviewed operation
  applies. Its record states what was lost.

## 9. What 4(c) reuses

- **From item 2:**
  - rule 3′ and the five witnessed profiles. Elements do not compose;
  - `readbackAcceptance`, and the real fixtures;
  - the capture procedure, the only way SUPPORT grows.
- **From item 3:**
  - `effect` on every text;
  - the M-6e confinement pattern, for WHO-P, WHO-R and the new texts;
  - a gate ending in named terminal outcomes, with expected-refusal steps;
  - a disposition approved by hash, for a terminal outcome only. It is not
    a release for an unknown R4 (U-1);
  - the WHO texts as the model for WHO-P and WHO-R;
  - the finding that the Read token is an accident barrier only (§7.1).
- **From item 6, the guarded sender as W leaves it** (F1–F3, once Codex has
  reviewed W; §0), **changed by this plan only through §2.3's target
  extension:**
  - the existing store (no `init`);
  - one request in flight per project (SG-2, G-7);
  - drafted go lines with per-step ceilings, and the mandatory production
    not-after;
  - markers, holds, dispositions and the clock rule;
  - UO-1, and "every pause is an exit".

## 10. What Codex will need to clear, in order

0. **G-6, W and W2** (Codex's ruling on the G-6 addendum, 2026-11-02):
   F1–F3 are implemented and reviewed before any new guard-dependent
   session. W (`4b7450d`) was returned AMEND; W2 (`d8ec242`) answers it,
   and Codex accepted W2 (review of `d8ec242`). That prerequisite is
   closed. Neither clears a session by itself: each session still needs
   its own exact-head clearance.
1. **This plan (V2).** The questions in §12.
2. **The implementation commit:**
   - the texts and pins, the policies and effects: BUILD-00, BUILD-00W,
     P0′, POST′, WHO-P, WHO-R, P1′ with its result schema, STATE′; and
     BUILD-01's assembly, whose accepted facts come with B1 (step 5);
   - the comparator: its MATCH, residual and STOP table, the data scope,
     and V-2's Release 2 EXECUTE rows with the rule for the other roles
     (§2.2, §6.4);
   - BUILD's predicates (§2.1);
   - §2.3's rehearsal target and store events;
   - M-12's update (§6.3);
   - the PERFORM entries and frames;
   - the rehearsal workflow, with its three sessions and its
     expected-refusal steps (§2.5), and the production phase declaration,
     with its ceilings;
   - the rehearsal runbook, and the production runbook with its smoke
     test, the kept order's record and the upload file check (§4.2);
   - tests and mutation companions:
     - the static main check (§4.2);
     - V-2's legitimate transitions and its negatives (§6.4);
     - P1′'s result schema, and its savepoint-boundary mutant (§6.1);
     - each of BUILD's predicates, with a passing and a failing local
       shape (§2.1);
   - the local PGlite run: from a reconstructed 01, under both defaults
     (§5.4); P1′'s lock inventory (§1.2); and the recovery coverage of
     §3.6;
   - the 14-state replay, extended to the new states if the record tool
     needs it.
3. **Ryan creates the throwaway,** once 1 and the store change in 2 are
   accepted (§0.2).
4. **Two read-only sessions,** each with its own clearance and tokens:
   - the production baseline and identity read: P0′, STATE′ and WHO-P;
   - rehearsal session 1 (R0a): BUILD-00 and BUILD-00W.

   Their receipts go to Codex as evidence.
5. **Binding commit B1:**
   - production's reviewed baseline, pinned by hash, with its other
     roles' literal Release 2 EXECUTE rows (§6.4);
   - BUILD-00's and BUILD-00W's accepted facts, pinned, and BUILD-01
     assembled and pinned with them.
6. **Rehearsal session 2 (R0b):** BUILD-01, then P0′ and WHO-R. The tiered
   comparison with production and its residuals go to Codex.
7. **Binding commit B2:** the throwaway's reviewed baseline, pinned by
   hash; its residual records; its other roles' literal rows.
8. **Rehearsal session 3:** R1–R4, the app checks and the session record.
   Then a record commit, and the deletion with the ref's retirement.
9. **A capture commit,** if §2.5's receipts are to extend SUPPORT.
10. **Push clearances** for those commits, each by exact hash.
11. **The production window's clearance** at the exact head, with Ryan's
    drafted go line, on a Sunday under option A (§7.3).
12. **The C5 credential runbook** keeps its own separate review.

## 11. What this plan does not do

- No project is created, no token, no send, no push.
- **Nothing in production or staging is read or changed** by this plan.
  The Supabase calls behind it were metadata and docs only (2026-10-31),
  and neither V nor V2 added any.
- **The local lock inventory** (§1.2) ran on PGlite, outside the
  repository. So did Codex's role-privilege probe, whose rows §6.4 uses.
- No code, test, SQL text, manifest or pin changes. Those are the
  implementation commit.
- It clears no window. Every time in §7 is an estimate until the rehearsal
  measures it.

## 12. Questions

**Recorded rulings** (Codex, 2026-11-02):
- **on U:** C1, C2, C5 and C8 accepted; C4 policy B, conditionally; C6
  rejected; C3 and C7 amended, as U-2 and U-1;
- **on V:** C7′ and U-3 accepted; C9 accepted as bounded evidence; C12
  accepted in principle; C3′ amended by V-1 and C11 by V-2; **C10: the
  labelled smoke order is kept.**
- **on V2** (review of `ea0c616`): **ACCEPT at plan level.**
  - V-1 and V-2 are closed at this level. So are BUILD-00W, the data scope,
    P1′'s result (as bounded evidence), the three sessions with B1 and B2,
    C10, and the upload's metadata reads.
  - **C13:** accepted with the narrow scope in §4.2.
  - The images: two separate observations (§2.2).
  - **V2's push was held for W2,** and went with W2's on 2026-11-03.
- **on W2** (review of `d8ec242`): ACCEPT, with t0 kept in the sender's
  first check. The outline's split was accepted and its decisions 5–9
  ruled (§0.2; the outline, §5).

  Points for the implementation:
  - BUILD's predicates are tested with accepted and refused local shapes,
    reader visibility included, and with a fact that changes between
    BUILD-00 and BUILD-01;
  - the other roles' literal EXECUTE rows reflect inherited privileges,
    owners and superusers under the bound memberships. The rule-checking
    test uses the bound baseline, never memberships observed at run time;
  - the throwaway's `orders` delta is exactly the app checks' recorded
    orders, never a matching count alone;
  - P1′'s test moves a required observation into the savepoint and fails;
  - BUILD-00W has an explicit policy and effect, with statement
    confinement. Its observed identity and authority must agree at the
    build; a name or token class alone is no authority.

**For Codex:** nothing open at plan level. V2's questions (V-1, V-2, the
data scope, P1′'s result, the session order and C13) are ruled above. The
implementation (§10, step 2) comes back for its own review.

**For Ryan:**
- **The date:** a Sunday, chosen with the window's clearance, and that
  Sunday's closing time.

## 13. Open items (separate work)

**The whole-tree launch analyzer, deferred** (Ryan, 2026-11-03, choosing
option 2 of Codex's review of `d160c6e`).
- **What it was:** X1b (`f1d6112`, `d160c6e`) added
  `scripts/tests/stage0-guard-launch-check.mjs` and its tests LN-1 and
  LN-2. They parsed every file under `scripts/tests` and classified each
  child-process launch, and each in-process command-line or `guardedSend`
  call, by how it reached a guard store.
- **Why it was removed (X1c):** Codex found two defects, each blocking if
  the analyzer stayed:
  - **LN-R1, effective options:** it credited the first `env` property
    and ignored a later one, which JavaScript uses. It treated any
    `stateDir` property as containment, an explicit falsy value or a
    later override included, though the entry points use
    `stateDir || DEFAULT_STATE`;
  - **LN-R2, lexical bindings:** it read the helper, the imports and the
    consts by file-wide name. A parameter that shadowed `syntheticHomeEnv`,
    or an argv, was credited as the outer binding.

  Codex's six reproducing sources are in
  `reviews/release-d160c6e-launch-check.mjs`/`.json`.
- **What stays without it:** the containment Codex required, in the tests'
  own code:
  - ORD and ORD-S;
  - the default-path probe;
  - `syntheticHomeEnv` and the fixture's launchers;
  - SEND-4's explicit path;
  - LN-3, which tests the helper.

  Review, not a static check, keeps new tests to the rule (guarded-send
  procedure §7.2).
- **It comes back only as its own reviewed work,** with:
  - bounded, fail-closed rules that reason about the effective option, or
    refuse the ambiguous form: a duplicate or overridden `env`, an
    explicit falsy `stateDir`, an override that can erase an accepted
    one;
  - lexical binding resolution, or a refusal on shadowing or ambiguity;
  - required-failing negatives for Codex's exact sources, and meaningful
    positives.

  Its result is never to be called proof that every future path is safe:
  it runs with the tests, not before them.
