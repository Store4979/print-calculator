# Stage 0 — item 4(c): the rehearsal from 01, the recovery mapping and the production window — PLAN

**Status: PLAN, for Codex's review (2026-10-31).** It clears nothing: no
project is created, no token, no send, no window. Ryan decides whether the
throwaway project in §2 is created. After Codex clears this plan, the
implementation commit (§11) and its runbooks come back for review before
any session.

**Sources:**
- Codex's incident review, 2026-10-12, §4(b) and §4(c)
  (`docs/security/stage0-incident-2026-10-09.md`, Appendix A);
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
- the P1–P3 runbook's §B time budget and §0.7/§A.0 (the template for §7);
- Supabase, read 2026-10-31: changelog discussion 45329 (the 30 October
  grants change); the docs pages "Database Backups", "Restore to a new
  project", "Manage Compute usage", "Billing FAQ", "Deleting Your
  Project"; and, through the Supabase MCP (metadata reads only, no SQL):
  the organization's plan, its project list and the new-project cost.

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
  sender) and item 3 (the read-token experiment, recorded in T; T is waiting
  for Codex's review).
- **Open before production relies on it:** G-6 (SG-1/SG-2) failed in 2 of
  42 replayed suites at T, with the assertion not captured. Codex's ruling
  is pending in T's review (§10, step 0).

## 1. What the remaining path touches

These facts shape the rest of the plan. Each comes from reading the
committed files; the line numbers are at T. The rehearsal (§2) and P1′ on
production (§6) are what prove them.

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

**1.2 No step locks a table the live app uses, by reading.**
- `CREATE`, `DROP` and `CREATE OR REPLACE FUNCTION` on PL/pgSQL bodies do
  not open the tables a body names: PL/pgSQL resolves them at first
  execution.
- Besides the migration, the forward and RB wrappers:
  - read `pg_catalog`, the ledger and `stores` (the identity guard);
  - insert their ledger rows.
- **Contrast with what is already done:**
  - 01 (P2-01) added `employees_id_store_uniq`, which took ACCESS EXCLUSIVE
    on `employees`. That lock is why the counter closed for P1 and P2 and
    stayed closed after an UNRESOLVED send (§A6, BC rejected);
  - RB-1 would take the same lock, plus locks on the tables its foreign
    keys reference.
- **The steps are short.** P2-01 took 1.6 s on production, and P1 took
  4.5 s (§E11, §E12).
- **Limit:** this comes from reading the SQL and PostgreSQL's documented
  behaviour. It is not an observation of production. The rehearsal's app
  checks (§4) run between steps, not during them.

**1.3 main@7ec5af4, the live app, reaches none of what 02–05 change.**
- **The browser code:**
  - PIN sign-in calls `verify_employee_pin` (`src/lib/supabase.js:362`);
  - owner sign-in uses Supabase Auth (`src/lib/storeConfig.js:105`) and
    the membership tables;
  - order saving inserts into `orders` (`src/lib/supabase.js:388`).
  - A `git grep` of `src/` at `7ec5af4` finds no Release 2 table or
    function.
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
- a **throwaway Supabase project** built to production's exact 01 state from
  the repository's migrations, proven equal to production by the same reads
  on both;
- on it, 02–05 and every recovery path run for real, through the guarded
  sender, timed;
- then **P1′ on production**, in a rolled-back transaction, as the final
  check inside the window (§6).

Staging cannot serve. It holds 01–05, under its own ledger versions and with
its seed store present. So it can never pass production's identity guards,
and the production texts' bytes cannot run there.

### 2.1 How the project would be built

No Supabase CLI command of any kind, no GitHub integration and no
branching.

1. **Ryan creates it in the dashboard** (his decision; nothing is created
   by this plan):
   - organization "Sifuentes INC" (Pro plan), region `us-east-1`, the same
     as production;
   - Micro compute; a name such as `print-calculator-4c-rehearsal`.
   - The database password is generated and not kept anywhere Claude
     reads. Every send uses the Management API query route with
     project-scoped PATs, as on production and staging.
   - Data API: keep `public` exposed. The app check in §4 needs it.
2. **Ryan reports its ref in chat.** A ref is not a secret. The ref enters
   the repository only through the reviewed extension in §2.3.
3. **One new pinned writing text, BUILD-01, builds the database.** It is
   sent through the guarded sender, to the rehearsal target only.
   - It runs in one transaction, unless a migration file cannot run inside
     a transaction block. The local run finds out which; any such file
     makes BUILD-01 a short sequence of texts instead.
   - In that transaction it:
     - **refuses** unless the target is empty: no table in `public`, and no
       ledger table or no row in it;
     - sets the default privileges for role `postgres` in schema `public` to
       the pre-30-October default that production's 21 migrations ran under:
       tables, functions and sequences to anon, authenticated and service_role.
       These are the three lines of the PGlite shim, which match what
       production's `pg_default_acl` held when read on 2026-10-20
       (`docs/security/public-table-grants/rebuild.mjs`, header);
     - creates `supabase_migrations.schema_migrations` with exactly
       production's six columns (§E8, N6);
     - runs the 21 top-level files of `supabase/migrations/` from their git
       blobs, in version order, each md5- and byte-gated. Each is followed by
       its ledger row at **production's** version, with `statements[1]`
       byte-identical and `created_by` `store4979@theupsstore.com`.
       - This is the PGlite harness's construction.
       - The public-catalog fingerprint it produced for the 20 older files
         equalled production's at P0 (§E10).
     - inserts synthetic rows where production's data predates a migration,
       as the harness does: the store `store4979`, an owner membership and two
       employees. It also inserts synthetic rows sized to the counts in
       production's baseline read (§2.2). **No production row is copied.**
     - creates a marker outside `public`: schema `stage0_rehearsal`, holding
       one row with the project's ref. The public-catalog fingerprint does
       not see it, and P0′ reports whether it is present (§2.4);
     - finally sets the default privileges to exactly what production's
       baseline read shows today, after the 30 October change (§5).
4. **Writing a ledger by hand, even on a throwaway, is a deliberate act.**
   It is not a repair of production's or staging's ledger, which Codex
   item 4 forbids. It is still ledger history written on purpose, so it
   is listed for Codex's ruling (§12, C1).

### 2.2 Proven equal: by which reads

**STATE alone cannot prove equality.** STATE reads:
- the effective prefix and its ledger md5s;
- which A1a Release 2 function set the catalog holds.

It compares nothing else: not the other tables' grants, policies or
constraints, the default privileges, the server version, or the data.

**The proposed equality set.** These reads go to both projects, and every
catalog, ledger, identity, default and version column must be equal:
- **P0′**, the new baseline at 01 (§6.1), which includes P0's
  `catalog_fingerprint` over `public`;
- **STATE′** (§3.3);
- the default-privileges rows.

Data-dependent columns, such as counts and `free_pins`, are recorded,
not compared.

**The production half is a separate, reviewed, read-only session**
(§10, step 3). It also carries Codex's Q-4 identity read (§6.1, WHO-P). It
comes before BUILD-01, because BUILD-01 copies production's current default
privileges.

**What equality does not cover:**
- the `auth`, `storage` and `realtime` schemas, and platform configuration;
- Supabase's image. Production runs 17.6.1.111 and staging 17.6.1.166. A
  new project gets a current 17.6.1 image, so `server_version_num` may
  match while the image differs;
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
extension**:
- `send.targets.rehearsal` in the manifest;
- a store event that adds the rehearsal ref, made under the store's own lock
  and recorded in its hash-chained ledger, with that ref's directories
  created;
- a later event that **retires** it, so no go can name it again;
- holds, markers and phases kept per project, as now;
- the guard chain re-pinned and audited (M-13).

**Rejected alternatives:**
- sends without the guard: from item 6 on, no live send happens without
  `--go`;
- `execute_sql` for a pinned text: CLAUDE.md;
- putting the new ref in the `staging` slot: the store check refuses it;
- a second store: that needs `init`, which is never run again.

**Codex rules on the extension (§12, C2).** It is code, so it belongs to
the implementation commit, not to this plan.

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

Every text goes through the guarded sender, and each is timed by its receipt.
After each write come STATE′ and the read-backs.

| # | what | shows |
|---|---|---|
| R0 | BUILD-01; then P0′, STATE′ and the defaults read | equality with production's baseline (§2.2), or STOP |
| R1 | P1′, rolled back; then P0′ again | P1′ commits nothing (all P0′ columns identical) |
| R2 | **fault controls:** each forward and RB text is refused once on purpose, leaving the state unchanged. A second caller holds a lock the step needs for a few seconds (the ledger table, ACCESS EXCLUSIVE), so the step's `lock_timeout` (3 s) refuses it with 55P03. This is the N5 lock-rehearsal pattern of §E8 | a SETTLED refusal at every step; the real envelope each refusal produces (§6.2) |
| R3 | P2-02 → STATE′ → app check; P2-0304 → STATE′ → app check; P2-05 → STATE′ → A2 → app check | the forward path, step by step, committed; main's app at "after 02", "after 03+04" and "after 05" (§4) |
| R4 | RB-5 → STATE′ → app check; RB-43 → STATE′ → app check; RB-2 → STATE′ (= 01) → app check | every recovery operation, each committed on its own. A partial recovery is itself a prefix, so this covers the recovery from every prefix |

**R2's refusals will most likely hold the rehearsal project.**
- A 55P03 raised by a statement inside a wrapper's DO block reaches the
  envelope with frames that none of the five witnessed profiles has (§6.2).
- So under today's classifier each R2 refusal is most likely **R4,
  UNRESOLVED**. Being a writing text's outcome, it holds the rehearsal ref
  until a disposition, as UO-1 requires. STATE′ afterwards is a diagnostic
  only.
- The rehearsal runbook therefore needs a reviewed disposition procedure
  for these expected outcomes: one per refusal, approved by Ryan by hash,
  as item 3's phase E disposition was.
- **The alternative:** run R2 on a **second** throwaway project, so the
  clean path R0, R1, R3, R4 is never interleaved with holds. It costs one
  more BUILD-01 and about $0.32 a day.
- Codex rules on both, with C7.

**Not reachable on one project:** a second forward pass after a recovery.
The forward texts refuse once a rollback row exists (4(b)). A second pass
needs a second project and a second BUILD-01. The proposal is one project,
one forward pass and one full back-out. A second project is created only if
R0–R4 change a text.

**RB-1 is not run** (§3.2).

### 2.6 Timing

- Each receipt's `startedAt`/`finishedAt` gives the server time.
- The operator steps (token setup, read-backs, app checks) are timed from
  the journal and the session record.
- These measurements replace §7's estimates before the production phase
  declaration is committed.

### 2.7 Cost, and deleting the project

**Cost:**
- The organization is on **Pro**. Its $10 monthly compute credit covers one
  Micro project, and it already runs five active projects.
- `get_cost` for a new project: **$10 a month**. Micro compute bills at
  **$0.01344 an hour**, and each started hour is billed in full. That is
  about **$0.32 a day**: about $1 for 3 days, about $2.26 for 7 days.
- **Compute hours are not covered by the spend cap.**
- This plan does not estimate disk or egress. For a database this small
  they are expected to be negligible, and the organization's usage page
  shows the actual charge.

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
| production's exact catalog, defaults, version | rebuilt from migrations under a simulated default | **yes** | rebuilt, then proven equal by reads (§2.2) | copied |
| each step committed alone, read back by a later transaction | yes, locally | **no:** one transaction | **yes** | yes |
| recovery operations as separate committed transactions | yes, locally | no | **yes** | yes |
| the API route's real envelopes for refusals | no | only the paths that occur | **yes:** the fault controls produce them | yes |
| locks, timeouts, a second caller | no: one connection | partly | yes | yes |
| main's app at each committed state | no | no | **yes** | yes |
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
  - the platform outside `public`, and the newer image;
  - production's identity: the texts' guards pass on both (§2.4).

  P1′ covers the catalog, role and default half of that on production
  itself, in one transaction.
- **Clone** (Supabase "Restore to a new project", beta; paid plan with
  physical backups):
  - it would copy production's database exactly: data, roles and default
    privileges, but no storage objects;
  - that includes employee PINs, customer orders and auth users with hashed
    passwords;
  - a cloned project cannot itself be cloned;
  - it mirrors the source's compute size.

  Recorded so Ryan can weigh it. It is not proposed, because it makes a
  second copy of real data.

## 3. The recovery mapping from 01

**3.1 01 is now an operating state.** Codex's re-opening checks passed
there, and the counter has run at 01 since 2026-10-13. So the mapping's
floor is 01, not "nothing Release 2".

**3.2 The mapping:**

| committed prefix | catalog state (A1a) | main's app (§4) | **policy A:** recover to 01 in the window | **policy B:** rest at any verified settled state |
|---|---|---|---|---|
| 01 | after 01 | works (re-opening checks, 2026-10-13) | none | none |
| 01–02 | after 02 | expected to work | RB-2 | none; a back-out, if ever wanted, is its own reviewed session |
| 01–04 | after 04 | expected to work | RB-43, then RB-2 | none |
| 01–05 | after 05 (A2) | expected to work | none if A2 and the smoke test pass; otherwise RB-5, RB-43, RB-2 | none if A2 and the smoke test pass; otherwise STOP-and-review |

**RB-1 is outside the window's mapping.**
- It would take ACCESS EXCLUSIVE on `employees` (§1.2).
- Nothing in the remaining path requires leaving 01.
- It stays a reviewed text in the repository.
- P1′ does not run it either (§6.1), so P1′ takes no lock on any table the
  app uses.

**3.3 STATE′.**
- STATE's `recovery` column encodes the old table. At 01 it returns
  `RB-1` (read on 2026-10-13).
- STATE selects the sequence, and no operation is chosen from memory. So
  the new mapping needs a new pinned text, STATE′: STATE's reads with
  this table.

**3.4 UO-1 is unchanged.**
- STATE′ selects a recovery only for a SETTLED state.
- After an UNRESOLVED writing send: STOP-and-review, no retry, no recovery,
  and the project hold stays. The counter question is §4.4.

**3.5 Policy A or B is Codex's choice (§12, C4).**
- **I recommend B**, provided the rehearsal's app checks pass at every
  state.
- Each in-window back-out is itself a writing send, with its own failure
  modes and its own reserve.
- Under B the window's reserve covers reads and close-out, not three RB
  steps (§7.2).

## 4. The live app at main@7ec5af4 at every state the forward path can leave

**4.1 What the counter uses:**
- PIN sign-in;
- owner sign-in;
- order saving;
- the upload queue (Netlify functions, `pending_jobs`/`print_jobs`,
  Storage).

§1.3 gives the code paths.

**4.2 Sign-in and order saving at each state:**

| state | PIN sign-in, owner sign-in, order saving | basis | shown by |
|---|---|---|---|
| 01 | **work** | observed | Codex's re-opening checks on 2026-10-13 (legacy PIN sign-in, a real smoke order, the queue), and daily use since |
| after 02 | **expected to work** | 02 adds two functions only; main reaches neither (§1.3); nothing else in `public` changes (A1a, P1′'s catalog-set equality) | (i) the static check below; (ii) the rehearsal's app check at R3; (iii) on production, the smoke test after the window |
| after 03+04 | expected to work | functions only, as above | as above |
| after 05 | expected to work | functions only; A2 | as above |

- **The static check** is part of the implementation commit's tests: no
  file reached from main's browser entry points names a Release 2 table or
  function. It runs on main's tree at `7ec5af4`, read from git.
- **The rehearsal's app check:**
  - **Ryan runs it** in a clean clone of main@7ec5af4 (`yarn dev`), with
    the rehearsal project's URL and publishable key in a gitignored
    `.env.local` that he writes;
  - it covers PIN sign-in with a synthetic employee from BUILD-01, a saved
    order read back, and the owner sign-in screen;
  - Claude does not type credentials into it: the PIN would go to a
    non-local host.

**4.3 During a step.**
- By §1.2 no step takes a lock on a table the app uses, and each lasts
  seconds.
- The plan still keeps the counter closed for the whole window:
  - it costs nothing outside store hours;
  - it keeps the smoke test clean.

**4.4 Must the counter stay closed until recovery?**
- **After a SETTLED step: no.** At any settled state whose read-backs and
  smoke test pass, the counter re-opens at that state (policy B), or after
  the in-window back-out (policy A).
- **After an UNRESOLVED writing send, today's rule** keeps the counter
  closed until a separate reviewed incident decision, Monday morning
  included (BC rejected, review of `0bbf598`).
  - That rule protected the counter from a request that might start later
    and take P2-01's lock on `employees`.
  - For 02–05 and P1′, such a request takes no lock on a table the app
    uses, and changes nothing main reaches.
- **Question for Codex (§12, C6):** after an UNRESOLVED 02–05 or P1′ send,
  may the counter re-open once the re-opening checks pass? The project hold
  on further sends would stay until a reviewed disposition.
  - **I recommend yes, for these texts only.**
  - The database state stays UNKNOWN in the record either way.

## 5. Supabase's 30 October grants change

**5.1 What changed** (discussion 45329, read 2026-10-31):
- **Tables:** new tables in `public` are no longer granted SELECT, INSERT,
  UPDATE and DELETE automatically to anon, authenticated and service_role.
- **Sequences:** the post's opt-in SQL also revokes USAGE and SELECT on new
  sequences.
- **Projects:** the setting became the default for new projects from 30
  May, and was **applied to all existing projects on 30 October.**
- **Unknowns:** the post does not say how that is implemented in an
  existing project's default privileges, and its SQL does not touch
  functions.
- **Existing objects** keep their grants.

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
  those four REVOKEs. Codex showed this locally (I3-2).
- **Why that is still caught:** the A1a check is an exact set of
  `grantee=privilege` pairs from
  `aclexplode(coalesce(proacl, acldefault('f', proowner)))`, compared both
  ways. It runs:
  - in every forward and RB wrapper, before commit;
  - in P1's proofs.

  A step under a wider default would therefore **refuse**, not commit a
  wider ACL.
- **The new evidence this plan adds:**
  - P0′ reads production's current `pg_default_acl` rows for `public`;
  - P1′ re-asserts A1a under that default, on production;
  - BUILD-01 copies that default before 02–05 run on the rehearsal project.

**5.4 Where the change does matter: any rebuild from the migrations.** A
database built from them after 30 October differs from production unless
the old default is reproduced first:
- **the 20 older tables:** see the parked grants record (§I, item 4). Its
  rebuild evidence: without the record, 1 of 28 app-shaped checks passes
  under every new-default variant;
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

  Which of the two production now has is what P0′'s defaults column shows.
- **Hence BUILD-01's two default settings:** the old one before the
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
| **P0′** | read | R, true | production, rehearsal | The baseline at 01. 01's identity: version, md5, 13 720 bytes, `created_by`, one element, final LF. The ledger set equals the 21 files, head `20261009151706`, no row after it. Six Release 2 tables present and empty (counts), `employees_id_store_uniq` present, catalog state 01 (A1a). `catalog_fingerprint` as P0 defines it. Default privileges for `public`. `server_version_num` ≥ 170000. The probe and nil identities absent; `auth_users_user_triggers` 0; `free_pins` ≥ 3; `stores_without_org` 0. Row counts for the tables P1′ touches. `rehearsal_marker` |
| **WHO-P** | read | R and W, each with and without `read_only` | production | Codex's Q-4: production's own role, transaction mode and relevant privileges, for each token and mode. Modelled on item 3's WHO texts. SELECTs only, confined statement by statement as M-6e confines item 3's texts. No INSERT and no DDL probe on production |
| **P1′** | write | W, false | production, rehearsal | `begin isolation level repeatable read`, then E1's settings (statement 90 s, transaction 110 s). Capture the catalog and the real-row md5s. **P2-02's body verbatim**, then the fixtures. `savepoint`, 03 alone, the 42702 proof, `rollback to savepoint`. **P2-0304's and P2-05's bodies verbatim.** Proofs §2 (A2, end to end), then fixture removal. **RB-5, RB-43, RB-2** through their wrappers. The catalog must equal step 1's row for row (state 01); then `ROLLBACK`. Unlike P1: no 01 body, and **no RB-1** |
| **STATE′** | read | R, true | production, rehearsal | STATE's reads, with §3's mapping (policy A or B, as ruled) |
| **BUILD-01** | write | W, false | rehearsal only | §2.1 |
| **FAULT-LOCK** | write | W, false | rehearsal only | The second caller for R2: holds ACCESS EXCLUSIVE on the ledger table for a bounded few seconds, then rolls back. Declared as writing because it takes locks (I3-1's conservative rule) |
| P2-02, P2-0304, P2-05, RB-5, RB-43, RB-2 | write | W, false | production, **plus rehearsal** | **Bytes preserved,** subject to the local run and the rehearsal showing that their guards accept the 01 state as written: they assert "after 01" and check the identity rows as a subset. Gaining a target changes their policy, so each now **declares `effect`**. LEGACY_EFFECT is not edited to match |
| CANCEL-INSPECT, CANCEL-STEP-TEMPLATE | as now, plus `effect` | C | production, plus rehearsal | preserved |
| P0, P1, P2-01, RB-1, STATE | — | — | — | **Not in any new phase.** They stay in the manifest as history. P0 expects pre-01 values, P1 and P2-01 refuse over 01, RB-1 is outside the mapping, and STATE encodes the old mapping |

- **New texts:** every one declares `effect`. The 29 legacy compatibility
  entries are not widened.
- **01's ledger identity is preserved:** no text writes, moves or deletes
  01's row. P0′ checks it at every baseline.

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
- the success and result predicates: SUCCESS entries for P0′, WHO-P, P1′,
  STATE′, BUILD-01 and FAULT-LOCK, with the preserved texts' entries
  unchanged;
- **tests** that refuse the same query or frame under another text, or in
  an unreviewed combination.

**The design aim.** Each new writing text catches every guard and proof
failure and raises it again from its top-level DO block. The refusal is
then one of the witnessed "re-raised" or "detail/hint re-raised" profiles,
and no new profile is needed for a check that fails. Some failures cannot
be caught there:
- 25P04 from `transaction_timeout`, which is FATAL;
- a `statement_timeout` or `lock_timeout` raised inside a PERFORMed helper;
- R2's 55P03 refusals, wherever their frames place them.

These stay **residual R4, STOP-and-review**, unless a receipt shows them
and Codex reviews that profile.

**Unchanged:**
- the uncaptured STMTTIMEOUT PERFORM stays R4;
- CANCEL-STEP-TEMPLATE's optional forms stay unsupported while no runbook
  relies on them.

**Where the receipts come from (§12, C7).** SUPPORT grows only in a
reviewed capture commit of sender receipts, and every receipt so far is
from staging. R2's fault controls on the rehearsal project would produce
the receipts these texts need, and Codex rules whether they may.

## 7. The production window

### 7.1 Steps, counter-closed time and the Read token's role

The time budget follows the P1–P3 runbook's §B. Every estimate is replaced
by the rehearsal's measured time plus a margin before the phase
declaration is committed. Durations are minutes. **The counter is closed
from §2 to §11.**

| § | step | who | counter closed | elapsed | the Read token in this step (point 6) |
|---|---|---|---|---|---|
| 1 | Before the window, counter open: a clean clone at H, the suite, the 14-state replay with `STAGE0_REPLAY_KEEP=1` (about 35 min), dry runs, the clock check, store status | C | 0 | — | — |
| 2 | Counter closed. Backup read (§8.2), the published deploy, Claude's first read-backs (LOCKS, ad hoc) | R + C | 10 | 0:10 | not loaded |
| 3 | Two windows, two tokens, V-checks, markers; the go line registered | R + C | 15 | 0:25 | loaded in R only |
| 4 | P0′, STATE′; compared with the production baseline (§2.2) | R + C | 5 | 0:30 | **R sends.** What stops an unintended write, in order: the pinned bytes are SELECT-only (md5, M-6-style confinement); the sender refuses a text outside R's policy; the go names this step only. The Read PAT's read-only default (item 3, staging) is an **accident barrier only, never a write boundary** |
| 5 | LOCKS, P1′, its rows, P0′ again, STATE′ | R + C | 12 | 0:42 | **P1′ is W only.** A P1′ go cannot be admitted in R (wrong window). Nothing about the Read token is counted on for P1′'s safety |
| 6 | P2-02: send, classify, STATE′, read-backs | R + C | 7 | 0:49 | W sends; STATE′ is R, as in §4 |
| 7 | P2-0304: as §6 | R + C | 7 | 0:56 | as §6 |
| 8 | P2-05: as §6 | R + C | 7 | 1:03 | as §6 |
| 9 | A2, P0′ after, STATE′, CONSUMERS | R + C | 8 | 1:11 | R reads, as in §4 |
| 10 | Smoke test: PIN sign-in, a real smoke order, the queue | R | 10 | 1:21 | — |
| 11 | Tokens deleted, windows closed, store status | R + C | 5 | 1:26 | deleted |
| 12 | **Counter re-opens** | R | — | **≈ 1:26** | — |
| 13 | Record commits (counter open; about 5 min of suite per commit) | C | 0 | — | — |

- **Total counter-closed time on the planned path: about 86 minutes.**
- **The clock check** (valid 60 minutes) is renewed once, before §8.
- **In every production step,** the Read token is treated as an accident
  barrier only, never as a write boundary. Item 3 showed its read-only
  default on staging, for three statements, and nothing that switches the
  transaction mode first was tested (§E15). Q-4 forbids inferring
  production's behaviour from staging, so WHO-P records production's own
  values, and those are also read as evidence, never as a boundary.

### 7.2 Ceilings: the latest starts, from the whole remaining path

D is the reserve end. A step's ceiling is D less the time its whole
required path needs:
- the step itself, with its read-backs;
- the worst recovery it can leave under the ruled policy;
- the close-out: final reads 5, smoke test 10, tokens 5, so 20.

Each RB step budgets 7, as a forward step does.

| step | policy A: path | A: ceiling | policy B: path | B: ceiling |
|---|---|---|---|---|
| P1′ | 12 + 20 | D − 32 | 12 + 20 | D − 32 |
| P2-02 | 7 + RB-2 7 + 20 | D − 34 | 7 + 20 | D − 27 |
| P2-0304 | 7 + RB-43 7 + RB-2 7 + 20 | D − 41 | 7 + 20 | D − 27 |
| P2-05 | 7 + A2 8 + RB-5, RB-43, RB-2 21 + 20 | **D − 56** | 7 + A2 8 + 20 | D − 35 |
| RB-5 | 7 + 14 + 20 | D − 41 | (not in the window) | — |
| RB-43 | 7 + 7 + 20 | D − 34 | — | — |
| RB-2 | 7 + 20 | D − 27 | — | — |

- **A later step can have an earlier ceiling** (P2-05 under A). That is
  the P1–P3 runbook's own shape (P-R1), and no ordering rule is added.
- **The window's length.** The planned path takes 86 minutes, policy A's
  worst back-out adds 26, and a margin of about 23 follows. **D = start +
  2 h 15 min.**
- **Under policy A,** P2-05's expected start (start + 0:56) is 23 minutes
  before its ceiling (start + 1:19).
- **The production phase is declared in code:**
  - its steps, its gate and its ceilings, in the form
    `scripts/manual/stage0-guard.mjs` `WORKFLOWS` already takes;
  - drafted go lines, with each step's UTC latest start;
  - a **mandatory per-send not-after** from Claude's current whole-path
    check at the actual pace.
- **The rule is unchanged** (Codex, review of `0bbf598`): before any
  forward or RB step, the whole remaining required path must end before D.
  Out of time means no more writes are started.

### 7.3 Times: for Ryan to choose

The store's web page says "Open 7 Days" and gives no times, so **Ryan
confirms that day's closing time and the next opening time.** From
1 November all times are **EST (UTC−5)**. The window needs every review in
§10 first, so a date is chosen with the clearance, not now.

| option | window, counter closed from the start | counter re-opens (planned) | reserve end D | UTC | slack before the next opening |
|---|---|---|---|---|---|
| **A** (the shape Codex accepted for 2026-10-11) | **Sunday 17:00 EST** | about 18:26 | 19:15 | 22:00Z – 00:15Z | Sunday evening and night |
| **B** | **Saturday 18:00 EST**, if Saturday closes by then | about 19:26 | 20:15 | 23:00Z – 01:15Z | Saturday night and Sunday morning |
| C | weekday 19:30 EST, after close | about 20:56 | 21:45 | 00:30Z – 02:45Z (next UTC day) | one night; not recommended |

- **A STOP leaves that slack for review.** After an UNRESOLVED send the
  counter stays closed until a reviewed decision, unless Codex rules
  otherwise under §4.4.
- **If the store closes for a whole day** (Thanksgiving, Thu 2026-11-26,
  for example; the page lists no holiday hours), a daytime window that
  day leaves the most slack.
- **Ryan's choice:** an option, a date, and that day's hours.

## 8. Recovery of last resort

**8.1 What exists:**
- **Daily physical backups.** The organization is on Pro, so production is
  backed up daily and the last 7 days can be restored. Its Postgres 17.6
  image uses physical backups.
- **PITR** is an add-on, and this plan does not know whether it is on. The
  dashboard shows it.
- **A restore** is a dashboard action on the whole project, and the
  project is inaccessible while it runs.

**8.2 Before the window (§7.1 §2).**
- Ryan reads Database → Backups, read-only, nothing clicked. He records the
  latest backup's time and whether PITR is on.
- **No backup within the last 24 hours: STOP, no window.**

**8.3 What restoring that backup would lose** — everything written after
the backup's time:
- that day's saved orders;
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
- the counter is down until the restore completes;
- the day's orders would have to be re-entered by hand from their PDFs or
  emails.

**8.4 Ways to lose less, none proposed by default:**
- **a logical dump** Ryan takes just before the window (`pg_dump`). It
  needs the database password in his shell, and the dump holds real data
  that must be stored and deleted with care. It is not a Supabase CLI
  migration command, but it is a credential step;
- **PITR for the window:** about $0.137 an hour, plus at least Small
  compute. The compute change restarts the project, and daily backups stop
  while PITR is on;
- **"Restore to a new project"** of the pre-window backup, for
  investigation without overwriting production. It is a second copy of
  real data.

**8.5 When:**
- **Never as a stage-0 step.**
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
  - the M-6e confinement pattern, for WHO-P and the new texts;
  - a gate ending in named terminal outcomes;
  - a disposition approved by hash;
  - the WHO texts as the model for WHO-P;
  - the finding that the Read token is an accident barrier only (§7.1).
- **From item 6, the guarded sender unchanged except for §2.3's target
  extension:**
  - the existing store (no `init`);
  - drafted go lines with per-step ceilings, and the mandatory production
    not-after;
  - markers, holds, dispositions and the clock rule;
  - UO-1, and "every pause is an exit".

## 10. What Codex will need to clear, in order

0. **G-6** (T's review): its failing assertion captured and its cause
   ruled, before any production phase relies on SG-1/SG-2.
1. **This plan (U).** The questions in §12, and Ryan's decision on the
   project.
2. **The implementation commit:**
   - the texts and pins, the policies and effects;
   - §2.3's rehearsal target and store events;
   - the PERFORM entries and frames;
   - the rehearsal and production phase declarations, with their ceilings;
   - the rehearsal runbook and the production runbook;
   - tests and mutation companions, including the static main check (§4.2);
   - the local PGlite run from a reconstructed 01, under both defaults
     (§5.4);
   - the 14-state replay, extended to the new states if the record tool
     needs it.
3. **The production baseline and identity read:** P0′, STATE′, the defaults
   read and WHO-P. Read-only, its own clearance and tokens.
4. **The rehearsal session(s)** on the throwaway: R0–R4, the app checks and
   the session record. Then a record commit, and the deletion with the
   ref's retirement.
5. **A capture commit,** if R2's receipts are to extend SUPPORT (§12, C7).
6. **Push clearances** for those commits, each by exact hash.
7. **The production window's clearance** at the exact head, with Ryan's
   drafted go line, and the time option chosen (§7.3).
8. **The C5 credential runbook** keeps its own separate review.

## 11. What this plan does not do

- No project is created, no token, no send, no push.
- **Nothing in production or staging is read or changed.** The Supabase
  calls behind this plan were metadata and docs only.
- No code, test, SQL text, manifest or pin changes. Those are the
  implementation commit.
- It clears no window. Every time in §7 is an estimate until the rehearsal
  measures it.

## 12. Questions

**For Codex:**
- **C1. The venue:**
  - Is the throwaway project, built by BUILD-01 with its hand-built ledger
    at production's versions, acceptable?
  - Is the clone alternative rightly not proposed?
- **C2. The store and manifest extension** for a third, retirable target
  (§2.3).
- **C3. The equality set:** P0′, STATE′ and the defaults read on both
  projects, rather than STATE alone (§2.2).
- **C4. Policy A or B** for the window's recovery (§3.5).
- **C5. RB-1 out of P1′ and out of the window's mapping** (§3.2).
- **C6. The counter after an UNRESOLVED 02–05 or P1′ send** (§4.4).
- **C7. R2's fault controls:**
  - may their receipts on the rehearsal project extend SUPPORT, through a
    reviewed capture commit (§6.2)?
  - their expected R4 holds: a reviewed disposition procedure, or a second
    throwaway project (§2.5)?
- **C8. The preserved texts** keep their bytes, gain the rehearsal target
  and declare `effect` (§6.1).

**For Ryan:**
- **Whether to create the throwaway project, and when** (§2.1, §2.7).
- **The window:** an option and date in §7.3, and that day's store hours.
- **Whether any §8.4 measure is wanted** before the window.
