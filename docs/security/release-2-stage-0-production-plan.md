# Release 2 — stage 0, production half

**Status: PLAN FOR REVIEW, revision 2. Nothing here has been applied to
production, and production stays blocked until this revision is accepted.**

Revision 2 answers Codex's review of `8913a69`, which returned AMEND. That
review accepted the staging reconciliation and the deploy deletions. The
revision resolves the review's items F-1…F-8, B1…B6 and the five F5 rulings,
and qualifies three staging artifacts as superseded (§G). Section H maps
each item to where it is resolved. Ryan's decisions on §I, dated 2026-09-29,
are folded in:
- D4 implemented;
- C3 gated on Codex's acceptance of this revision;
- the canary subject;
- cleanup recorded as paused;
- no type-only route.

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
| P2 | apply 01–05 as four wrapper transactions — P2-01, P2-02, **P2-0304 (03 and 04 together)**, P2-05 — byte-checked | **yes — database; 01 closes the counter** | E4 |
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

**The "after 03" row exists only inside P1 (review of dc5a88b, N7).** P2
never commits 03 alone. P2-0304 applies 03 and 04 in one transaction. It
asserts "after 02" before and "after 04" after, so no committed state has
03's defective staff-session body. P1 still reaches "after 03" inside a
savepoint to prove the 42702 that 04 repairs (§E3), then rolls the savepoint
back.

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
by content addresses. The manifest's `a3` block names a commit and the git
TREE or BLOB id, at that commit, of **every input of the production build**
(review of d01b74a, N3):
- trees: `netlify/`, `src/`, `public/`;
- the build's own configuration: `netlify.toml` (whose build command is the
  sequence below), `package.json`, `.npmrc`, `.nvmrc`, `vite.config.js`,
  `postcss.config.js`, `tailwind.config.js`, `index.html`, `upload.html`;
- the tracked `.env`, which holds only the two public values (the production
  URL and the `sb_publishable_` key). M-7b fails on any third key, another
  URL or a non-publishable key;
- every script the build command runs: `scripts/check-build-env.mjs`,
  `scripts/write-deploy-context.mjs`, `scripts/inject-sw-manifest.mjs`. M-7b
  parses the command in `netlify.toml` and fails on any script it runs that
  is not pinned;
- the inventory gate: `scripts/tests/inventory-check.mjs`,
  `scripts/tests/inventory-allowlist.mjs`.

A squash merge onto an unchanged `main` reproduces those trees under a new
commit SHA, so the binding is by tree, not by SHA. **At the P4, P5 and P6 stop
points the deploy's `commit_ref` is resolved and each pinned path is compared
with `git rev-parse <commit_ref>:<path>`**; any difference stops the step. The
ref refusal is still present in A3.

`a3.commit` is either a SHA or `"manifest-commit"`. The latter pins code
changed in the same commit as the manifest, which cannot name its own SHA.
The test resolves it to the commit that last changed the manifest and checks
the pinned objects there. A later record-only manifest update keeps it valid:
it moves the resolution forward to a commit with the same trees. Pins so far:
`5ee7ec4`, then `64730fe` (D4's `flagEnabled`), then the N-series commits of
this round.

While the manifest's `a3.enforceAtHead` is true, the manifest test also
requires HEAD to match. A change to production-bound code before P4
therefore fails the suite until it is re-pinned, in review. At the P4 stop
point `a3.commit` is replaced by the concrete SHA of the deployed
`commit_ref`.

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
- the manifest gains the production versions (`migrations[].productionVersion`);
  after an applied rollback it gains `rollbackRecords`;
- the `deploy-inventory.md` retained-deploy table is refreshed after P4 and
  after P5.

**The moves change no assembled byte (N3).** The rehearsal inputs are frozen
by CONTENT: the manifest's `inputs` are git blob ids, and the assembler reads
every input by blob id. That covers the five migrations, the five companions,
the proofs and the 20-row production baseline ledger. A `git mv` keeps a blob
id, so after the forwards move the assembler emits byte-identical outputs,
the RB operations included.

The checks are state-aware. The recorded state (`productionVersion`,
`rollbackRecords`) decides where each file must be. In every state the file
must be there with exactly its pinned blob, and the migration directory must
hold exactly:
- the 20 baseline files;
- plus the applied forwards;
- plus the applied rollback records.

That is 20, then 21–25, then up to 30 after a committed rollback.
`scripts/tests/stage0-manifest.lifecycle.test.js` walks a scratch clone
through every state as real commits:
- pending;
- each of the four P2 steps, P2-0304's two files in ONE commit;
- fully applied;
- each of the four rollback operations, one commit each (RB-43's two records
  together);
- a record-only manifest update;
- (LC-3) from each shorter committed prefix — 01; 01–02; 01–04 — exactly the
  recovery operations §A6's table names for it.

It runs the SAME checks as the manifest test in each. It also shows the
checks still refuse in the moved layout:
- a changed byte;
- an apply recorded but not moved;
- a stray file;
- a rollback record out of RB order;
- (LC-4) 03 recorded without 04, or one half of RB-43 recorded without the
  other.

The manifest is regenerated by `scripts/manual/stage0-manifest-generate.mjs`.
It recomputes what can be derived, preserves every record, and produces a diff
for review; the test, not the tool, holds the result to the repository.

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

**Why 03 and 04 are also one FORWARD operation (review of dc5a88b, N7).** The
same reasoning holds on the way in. With separate P2-03 and P2-04 steps, a
failure of P2-04 would leave 03 committed with its defective body, and no
reviewed operation could leave that state: RB-43 needs 04's body first.
P2-0304 is one transaction:
- both files are md5- and byte-checked before either executes;
- "after 02" is asserted before, and "after 04" after;
- it writes two ledger rows with distinct, increasing versions — 03 at the
  execution time, 04 one second later, the same technique as RB-43;
- the whole-row shape assert and the PG 17 timeouts are as in E1.

Any failure inside it rolls back both files and both rows. The committed
state is then "after 02", with no 03 row. P2-03 and P2-04 no longer exist as
steps; M-6 fails if either reappears.

**Committed prefix → recovery.** P2 can commit only these prefixes. Each has
exactly one reviewed recovery, run in this order, each operation through the
E1 wrapper and each read back:

| committed prefix | catalog state (A1a) | recovery |
|---|---|---|
| none | nothing Release 2 | none |
| 01 | after 01 | RB-1 |
| 01–02 | after 02 | RB-2, then RB-1 |
| 01–04 | after 04 | RB-43, then RB-2, then RB-1 |
| 01–05 | after 05 (A2) | RB-5, then RB-43, then RB-2, then RB-1 |

A partial recovery is itself a prefix: after RB-5 commits, the state is 01–04,
and the table's next line applies.

**An unknown commit outcome is resolved by read-back BEFORE any operation is
chosen.** A lost response, a dropped connection or a client-side timeout says
nothing about whether the transaction committed. The operator runs the
assembler's pinned **STATE** text, a read-only SELECT (md5 in the manifest).
It returns:
- `effective_prefix`: the forward rows in the ledger that no later
  `_rollback` row undoes;
- `ledger_md5_ok`: every such forward row carries A1's md5;
- `catalog_state`: which A1a function set the catalog holds exactly;
- the ledger rows it read;
- `recovery`: the table's operations, only when prefix, catalog and md5 all
  agree. Otherwise it returns **`STOP`**, and the operator returns to review.

No operation is retried or chosen from memory, and no ledger row is written
by hand. STATE selects the sequence. Each RB operation's own guards still
re-check the full A1a state (tables, constraint, bodies, ACLs) before it
changes anything.

**A7. The manifest is REQUIRED (F5 ruling 1).**
`docs/security/stage0-production-manifest.json` holds:
- A1 (paths, blob ids, md5, bytes);
- A1a and A2 (signatures, intermediate and final `md5(prosrc)`, ACL sets,
  catalog expectations);
- A3 (commit + trees);
- A6 (the five rollback files' blob ids, md5, bytes, and the four operations);
- the proofs file's blob id and md5;
- the assembler's blob id and the md5 of **every SQL text it emits** (§E1),
  including the read-only SIZE-PROBE (C3.7) and its expected answer, and the
  read-only STATE read-back (§A6).

`scripts/tests/stage0-manifest.test.js` runs the checks in
`scripts/tests/stage0-manifest-check.mjs` on this repository. They read **git
objects**, never working-tree bytes, so CRLF on a Windows checkout cannot
change an md5. They check:
- every pinned file at the path the recorded state puts it: blob id, md5,
  bytes;
- each pin resolves: a SHA holds the blob at its frozen path;
  `"manifest-commit"` resolves to the manifest's own commit. Absence is
  tolerated only in a detected shallow clone;
- each `md5(prosrc)` re-derived from the committed forward and rollback bodies;
- each output re-assembled from the frozen inputs and re-hashed;
- the A3 build-input binding (M-7, M-7b);
- the recorded repository state (M-8);
- that no working-tree copy of a pinned file differs from its blob other than
  by line endings.

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

**B2. Fresh-build rollback targets are a named list (B4)**, each a reviewed
commit that is compatible with the post-stage-0 database. The migrations are
additive, and no listed commit's client or functions name a Release 2 object.
**Each must also carry the queue fix** (review of d01b74a, N4):
`src/lib/orderQueue.js` blob `f99d16a9…`, shipped in `9937728` (`cefda59`,
"stop the drain erasing orders queued during its awaits"). A target without
it would reinstate the lost-order window the fix closed. The manifest's
`rollbackTargets` block lists them, and M-10 checks each one's blob.

| commit | deploy today | role | `orderQueue.js` |
|---|---|---|---|
| `7ec5af4` | `6ab020c50a788b0008d430c9` | published before P4 | `f99d16a9…` ✓ |
| `9937728` | `6aad56a391c0cf0008d215fd` | rollback target (the fix) | `f99d16a9…` ✓ |
| the A3 commit | P4's deploy | published from P4 | `f99d16a9…` ✓ (M-10 on the pinned tree) |

**Not rebuild targets:** `89de03e` (deploy `6aa994d5…`) and `7f89876` (deploy
`6aa59114…`) carry the pre-fix blob `cdec8a2e…`, whose drain writes the
pre-await `remaining` snapshot back. They remain **retained URLs** in the
retirement inventory (B1, B3, C5.6–C5.8): they hold the key until P5, and are
probed like every retained URL. They are never a rollback destination.

A rollback to anything not on the list above is a new review. After P5 a rollback
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

**C3. Rehearsal on staging first — APPROVED by Ryan 2026-09-29 to run ONLY
after Codex accepts revision 2. Not run.** It
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
7. **The SQL tool accepts P1's size** (Ryan's decision 2). The assembled
   `SIZE-PROBE` is sent through the same `execute_sql` tool that will carry
   P1:
   - it is ONE read-only `SELECT` over its own literal, reads no table, and
     changes nothing;
   - it is exactly 1 KiB larger than P1, whatever P1's size at the time;
   - its expected answer is the manifest's `sizeProbe.expect`, and its
     output's md5 and bytes are the manifest's `outputs["SIZE-PROBE"]`. The
     numbers move whenever P1's bytes do, so this plan does not restate them.

   Any other answer, a truncation or a transport error stops the C3 record.
   P1 is then not sent until the transport is solved.

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
   would be a new unauthenticated surface. Not proposed; Ryan agreed
   2026-09-29.
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
  - **Subject (Ryan's decision 3):** `STAGE 0 CANARY - no action needed`.
    The app builds its own subject (`Print Order – <customer> – <id>`), so
    the canary is sent directly to `send-print-job` on the new deploy. Ryan
    runs it at C5.5, after the deploy's A3 comparison:

    ```bash
    curl -s -X POST https://printcalculator2.netlify.app/.netlify/functions/send-print-job -H 'content-type: application/json' -d '{"subject":"STAGE 0 CANARY - no action needed","details":{"jobId":"STAGE0-CANARY","user":{"name":"STAGE 0 CANARY - no action needed"}}}'
    ```

    The recipient is resolved server-side; the body cannot choose it.
  - **Ryan confirms delivery** of that subject in the store inbox.
  - **Ryan reads the send-print-job function log** for that request. The line
    `send-print-job recipient resolved` must show
    `recipientSource: "store:store4979"`.

  Both are recorded, the log line and the delivery. **Any `fallback:*` fails
  C5.5.**
- **Cleanup — RECORDED 2026-09-29 (Ryan's decision 4): `CLEANUP_SECRET` is
  SET on production, and there is NO external caller.** The scheduled
  invocation cannot send `x-cleanup-key`, so **cleanup on production is
  PAUSED**: abandoned uploads stay in the private bucket past 24 h.
  - No scheduler is named, and none is part of G0.
  - Because the secret is set, the authorized dry run (row C) is run once at
    C5.5 on the new deploy, by Ryan (he holds the secret), as a second
    distinguishing read. It returns counts and deletes nothing.
  - Re-arming the schedule (pg_cron + pg_net, a GitHub Action, or manual
    runs) is a separate decision, not part of G0.

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
   deploy, `flagPresent:true`, **`flagEnabled:true`**, `contextAllowed:true`,
   `source` recorded.
3. **(d)** The production half is (a)'s `flagPresent:true`. The preview half is a
   **fresh** production-site deploy preview built after the env change,
   showing `context:"deploy-preview"`, `flagPresent:false` and
   `flagEnabled:false`.
4. **Runtime-ENABLED evidence (B5), separate from presence.** `flagPresent` is
   scoping evidence: it proves the variable reached the runtime, not that the
   gate's predicate (`RELEASE2_ENABLED === "true"`) holds. One of the
   following, recorded before P6:
   - **(i) IMPLEMENTED (`64730fe`, Ryan's decision 1): a reviewed boolean
     diagnostic.**
     - `deploy-context` reports `flagEnabled`, computed by
       `release2FlagEnabled()` from `netlify/lib/deploy-context.js`
       (`String(RELEASE2_ENABLED || "").trim() === "true"`).
       `release2Allowed()` imports the same function for condition 1 and reads
       the flag nowhere else.
     - DC-24 checks that the predicate, the gate and the route agree on
       sixteen values, and that no value reaches the body. It has been seen
       to fail on two mutants.
     - `flagPresent` is kept, and separate.
     - The route stays GET-only, imports only the shared module, and reads no
       `SUPABASE_*` value.
     - A3 and the manifest were re-pinned to `64730fe`.
   - The evidence recorded before P6 is (a)'s `flagEnabled:true`, on the P4
     deploy, bound by deploy id and `commit_ref`. (ii), the operator-bound
     record, is not needed.
   - After P6 the gate itself evaluates the predicate, and Phase 1's 401s are
     the runtime proof. `flagEnabled` is what makes it known **before** the
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
-- The hard timer. PG 17 only: an older server rejects the parameter and the
-- text stops here, before any DDL (N5). P0 requires PG 17.
select set_config('transaction_timeout', '45s', true);
do $stage0_wrap$
declare
  f   constant text := $stage0_file$<A1 file bytes, verbatim>$stage0_file$;
  v   text;
begin
  -- the settings above are in force in THIS transaction, or nothing runs
  if current_setting('server_version_num')::int < 170000
     or current_setting('lock_timeout') <> '3s' or current_setting('statement_timeout') <> '45s'
     or current_setting('transaction_timeout') <> '45s' then
    raise exception 'stage0 wrapper: timeouts not in force' using errcode = 'P0001';
  end if;
  <positive identity guard, §E2>                       -- refuses staging and unknown datasets
  if md5(f) <> '<A1 md5>' or octet_length(f) <> <A1 bytes> then
    raise exception 'stage0 wrapper: bytes differ from the manifest' using errcode = 'P0001';
  end if;
  <A1a "before" state assertion>                       -- e.g. P2-0304 refuses unless the "after 02" state holds
  execute f;
  <A1a "after" state assertion>                        -- the per-migration expectation; any deviation raises
  v := to_char(clock_timestamp() at time zone 'utc', 'YYYYMMDDHH24MISS');
  if v <= (select max(version) from supabase_migrations.schema_migrations) then
    raise exception 'stage0 wrapper: version % not after the ledger head', v using errcode = 'P0001';
  end if;
  insert into supabase_migrations.schema_migrations (version, name, statements, created_by)
  values (v, '<name>', array[f], '<ledgerRow.createdBy>');  -- statements[1] IS the md5-checked literal
  <assert the row's full shape: one element [1:1], md5 = f, created_by set,
   idempotency_key and rollback null — apply_migration's shape (N6)>
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
- **Three different bounds, stated exactly (corrected, N5):**
  - **`statement_timeout` bounds ONE statement.** It is 45 s for P2 and RB,
    90 s for P1. In P2 and RB the DDL, the ledger write and every check are
    in one `DO` statement, so it bounds that work. The few `set_config`
    statements around it are separately bounded, and instant.
  - **`transaction_timeout` is the hard timer for the whole transaction.** It
    is 45 s for P2 and RB, 110 s for P1. It **exists only from PG 17**: an
    older server rejects the parameter, and the text stops at that line
    before any DDL. The wrapper also asserts the server version and that the
    timer is in force. P0 stops unless `pg17_hard_timer` is true. When it
    fires, it ends the SESSION (FATAL), which rolls the transaction back.
  - **The deadline checks are boundary checks, not timers.** They are the
    wrapper's final check and P1's checks at each proofs section. They run
    only when execution reaches them and interrupt nothing.
- **Timeout, cancel, error.** A timeout, a `pg_cancel_backend` on the session
  (found in `pg_stat_activity` by its `application_name`), or any raised check
  aborts the transaction. PostgreSQL releases the locks at abort, and the
  `COMMIT` becomes a rollback. If the client vanishes mid-transaction,
  `idle_in_transaction_session_timeout` ends the session.
- **Whether a step committed** is decided only by the read-back (E4, and
  STATE in §A6): the ledger row with A1's md5 either exists or it does not.

**The ledger row** is written by the wrapper, **in the same transaction as the
DDL**, so they commit or roll back together:
- `version` is the UTC timestamp at execution, in `apply_migration`'s own
  14-digit format, and must be after the ledger head. In P2 and the RB
  operations, a version not after the head stops the step. In P1 only, whose
  ten rows fall within a second or two and are rolled back, it is bumped to
  head + 1. A second row in one transaction (P2-0304, RB-43) is stamped one
  second later, so the next step waits for the clock to pass it;
- `name` is the file's name without `.sql`;
- `statements` is `array[f]`, so `statements[1]` is **the md5-checked
  literal**, byte for byte;
- `created_by` is the value `apply_migration` records (the manifest's
  `ledgerRow.createdBy`); `idempotency_key` and `rollback` stay null.

That is **`apply_migration`'s row shape as read back from staging**, not an
assumption. The record is in §E8 (N6). The wrapper asserts the whole shape
of its own row before the transaction can commit.

P0 reads production's ledger:
- the column list, which must equal the pinned `ledgerRow.columns`
  (`ledger_columns_as_pinned`);
- the distinct `created_by` values;
- that every row is a single-element array.

Any difference stops P0 for review; the wrapper is re-pinned to the shape
production holds. A ledger without `created_by` would also make the wrapper's
insert fail (shown locally). The P2 file is then named by the version read back (CLAUDE.md rule
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
| `server_version_num`, `pg17_hard_timer` | **`pg17_hard_timer` must be true** (`server_version_num` ≥ 170000), or P0 stops: `transaction_timeout`, the only hard timer, exists only from PG 17 (N5). Staging reports 170006 |

*P0-L — the ledger (append-only; it never returns to these values after P2):*

| column | expect |
|---|---|
| `ledger_head` | `20260909232836` |
| `ledger_rows` | 20 |
| `ledger_matches_repo` | true: the set of (version, `md5(statements[1])`) equals the 20 top-level files in `supabase/migrations/` (the assembler embeds the list from git blobs) |
| `release2_in_ledger` | 0 |
| `ledger_columns` | recorded; `ledger_columns_as_pinned` must be **true** (the six columns of §E8, N6) |
| `ledger_created_by` | recorded; must be exactly `{store4979@theupsstore.com}` (the value `apply_migration` wrote on staging) or P0 stops and the wrapper is re-pinned |
| `ledger_rows_single_element` | true: every existing row is one element [1:1], as `apply_migration` writes |

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
- the E1 settings, with `statement_timeout` 90 s per statement and
  `transaction_timeout` 110 s. The latter is the hard timer, PG 17, required
  by P0;
- a 100 s deadline CHECK at every proofs section boundary. It is a boundary
  check that interrupts nothing; if a statement runs long, the two timers
  above are what stop it.

Order:
1. Capture the catalog rows behind `catalog_fingerprint`, and md5s of the real
   rows in the tables the proofs touch (`employees`, `stores`,
   `organizations`, `memberships`, `auth.users`), into temp tables. The md5s
   are compared, never returned.
2. **The P2-01 and P2-02 wrapper bodies, verbatim**, including their ledger
   inserts. P1 therefore proves the exact P2 text, ledger write included,
   against production's ledger table.
3. Proofs §1: fixtures, including a live enrollment, because an unknown one
   raises 28000 before the ambiguous statement.
4. `savepoint stage0_03_alone`; a wrapper for 03 alone; proofs §1b: 03's body
   is `bd6da6a2…`, and **its staff-session call raises 42702**. Then
   `rollback to savepoint`, back to the "after 02" state with the fixtures
   kept. This 03-alone wrapper exists only in P1 (N7).
5. **The exact P2-0304 body** (03 and 04 in one transaction, two ledger rows),
   then P2-05.
6. Proofs §2: the full A2 by catalog-set equality, then the end-to-end calls.
7. Proofs §3: fixture removal. The Release 2 tables hold zero rows, and the
   real-row md5s equal step 1's.
8. RB-5, RB-43, RB-2, RB-1, through the same wrappers, rollback ledger rows
   included.
9. Proofs §4: the catalog equals step 1's, **row for row**; on a mismatch the
   differing identifiers are named.
10. `ROLLBACK`.

**The proofs** (`supabase/rehearsals/release2_stage0_production_proofs.sql`,
sections 0, 1, 1b, 2, 3, 4 matching steps 1, 3, 4, 6, 7 and 9 above) are
**failing assertions, not a report**. Every check raises `P0001` with its id on any deviation, which
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

**E4. P2 — apply, four wrapper transactions.** The assembled `P2-01`,
`P2-02`, `P2-0304`, `P2-05` texts, in that order. P2-0304 applies 03 and 04
in ONE transaction (§A6, N7), so no committed state holds 03's defective
staff-session body.

After EACH step, before the next, a read-only read-back:
- the new ledger row or rows (two for P2-0304): `version`, `name`,
  `md5(statements[1])`, `octet_length`, final newline. Accept only A1's md5
  and byte count. The wrapper inserts the literal it checked, so the
  transport-stripped-newline case cannot arise, and the check confirms that;
- A1a's row for the state that step leaves, from the catalog;
- the STATE text (§A6), which must name the step's prefix.

Anything else stops P2 at that step. So does a response that never arrives:
STATE is read back first, and §A6's table names the recovery for the prefix
it reports. F4 applies. The `git mv` of each file and its companion to the
production-version name happens in the commit that records that read-back.
For P2-0304 that is one commit for both.

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

**The whole gate, not only the scanner (N2).** The review of `d01b74a` found
the scanner accepting that state while `release2-inventory.test.js` still
required every historically created table. Its INV-6 now asserts the
scanner's own net state (`appliedReleaseState`):
- tables present, where a table is present unless dropped by a later reviewed
  rollback;
- tables dropped, which must be absent;
- pending-only tables, which must be absent;
- a coherent applied history.

RB-INV-9 runs that REAL test file, unchanged, in a child `node --test`
pointed at Codex's fixture (`INVENTORY_ROOT`). The fixture has the five
forwards moved with history kept, the five rollback records appended, and the
snapshot without the six tables. The file passes 7/7. RB-INV-10 shows the
same file failing Codex's original reproduction, and a rollback whose
snapshot keeps the dropped tables. RB-INV-9 fails against the previous INV-6
with the message Codex reported. RB-INV-11 (N7) runs the same real file on
every shorter committed prefix (01; 01–02; 01–04) twice: once applied, with
the six tables captured, and once after that prefix's recovery, with them
gone. A recovered prefix whose snapshot keeps the tables fails.

**E8. Staging records (review of d01b74a), each approved by Ryan for this
round.**

*N6 — the ledger row `apply_migration` writes (READ-ONLY, 2026-09-29).*
Target confirmed first: `get_project_url` returned
`https://lboajqihpsfrokqvjgnl.supabase.co` (staging), with role `postgres` and
`server_version_num` 170006.
- **Columns** of `supabase_migrations.schema_migrations`, in order:
  - `version` text NOT NULL (the PK);
  - `statements` text[];
  - `name` text;
  - `created_by` text;
  - `idempotency_key` text (UNIQUE);
  - `rollback` text[].

  All are nullable except `version`, none has a default, and there are no user
  triggers.
- **The five reconciled rows** (`20260928160657`…`160847`, plus the reset
  `20260928160606`): each has `cardinality(statements) = 1` with bounds
  [1:1]. `md5(statements[1])` and `octet_length` equal A1 exactly
  (`e97a5fd7…`/13 720 … `22b5010b…`/5 622), and each ends in LF.
  `created_by` = `store4979@theupsstore.com`; `idempotency_key` and `rollback`
  are null.
- **The whole ledger** (31 rows): `created_by` is set on every row, to that one
  value. There is no `idempotency_key`, no `rollback`, and no multi-element
  `statements`.
- **`list_migrations`** (read-only) lists all 31 rows by (version, name), in
  version order, repeated names included.

What changed: the wrapper's insert previously left `created_by` null. It now
writes it, and asserts the full shape in-transaction. Every output was
re-assembled and re-pinned. Locally, with a ledger of exactly this shape,
the wrapper's five rows read back with that full shape. The `(version, name)`
projection `list_migrations` returns lists them after the 20 baseline rows. A
ledger without `created_by` is flagged by P0 and refuses the wrapper's
insert. No live write was made to test recognition.

*N5 — the two-session lock rehearsal (APPROVED to run on staging).* The
texts are the pinned `LOCKPROBE-*` outputs of the assembler; M-6c checks that
none writes outside its own schema. They use the same `execute_sql` tool and
the P2 wrapper pattern, built from the same code. That means:
- the same settings line;
- the same settings assert, which now requires PG 17;
- the same md5 gate, `EXECUTE`, ledger insert, shape assert and deadline.

They differ only in:
- their own guard: the staging seed store must be present and the production
  marker absent. **The production identity guard is untouched and never
  used**;
- a throwaway schema `stage0_lockprobe`, with a table `t` and a ledger of the
  real ledger's shape. The "migration" is
  `alter table stage0_lockprobe.t add constraint t_id_uniq unique (id)`, the
  lock class 01 takes on `employees`;
- scaled timeouts where a scenario must fire in reasonable time;
- one handler that re-raises any error with its SQLSTATE, the elapsed ms and
  the backend pid. `query_canceled` is named explicitly, because PL/pgSQL's
  `OTHERS` does not match it.

Procedure (session A, B and C calls issued concurrently where marked), with a
READBACK after each scenario:
0. SETUP.
1. Lock refusal: A holds ACCESS SHARE on `t` for 15 s, as a counter reader
   holds it on `employees` ∥ B-LOCKTIMEOUT waits until it sees A's lock, then
   must fail `55P03` at ≈3 s. No DDL, no ledger row; A's lock alone remains
   until A ends.
2. a. B-STMTTIMEOUT acquires the lock, then holds it past `statement_timeout`
      8 s: `57014`. Lock released, no DDL, no ledger row.
   b. B-TXTIMEOUT holds it past `transaction_timeout` 8 s, with
      `statement_timeout` 50 s (`1e122db`; 60 s displays as `1min` and failed
      the settings assert, see below). The PG 17 hard timer ends the session.
      Lock released, no DDL, no ledger row.
   c. B-CANCEL holds it (`statement_timeout` 30 s as backstop) ∥ C finds
      B's backend by `application_name` holding ACCESS EXCLUSIVE, then calls
      `pg_cancel_backend` and reports B's pid. B fails `57014` "user
      request". Lock released, no DDL, no ledger row.
3. B-POSITIVE, with no holder: commits the DDL and one ledger row of
   `apply_migration`'s shape.
4. CLEANUP drops only `stage0_lockprobe`, and shows no relation, lock or
   active rehearsal backend left.

**N5 RECORD — PASS, 2026-09-29 16:31–16:49Z, staging `lboajqihpsfrokqvjgnl`
(PG 170006), with the texts pinned at `8faf290`, `83bbf62` and `1e122db`.**

*The transport, measured first (read-only):*
- Every `execute_sql` call runs on a NEW backend (`application_name`
  `mgmt-api`, backend started ≈17 ms before the query), and that connection is
  closed after the call. A transaction therefore cannot outlive a call, and
  a closed connection releases its locks.
- Calls issued by one caller are serialized, even when issued together.
- A background subagent calling the same tool runs CONCURRENTLY with the
  caller: its backend was `active` while the caller's query ran. The second
  session in every scenario below is such a caller, through the same tool.
- The tool returns only the rows of the LAST row-returning statement, which is
  why every scenario is followed by a separate read-back.

| scenario | session(s), pid | result | read-back after |
|---|---|---|---|
| 0 SETUP | — | `stage0_lockprobe ready` | — |
| 1 lock refusal | A holder 1836823 (`release2-stage0-lockprobe-holder`, ACCESS SHARE, xact 16:38:50.078) ∥ B 1836824 | **`55P03` "canceling statement due to lock timeout" after 3001 ms** | no DDL; ledger = baseline only; locks: A's ACCESS SHARE only (B left none); B's backend gone |
| 2a statement timeout | B 1836837 (lock taken, then `pg_sleep(30)` under `statement_timeout` 8 s) | **`57014` "canceling statement due to statement timeout" after 7998 ms** | no DDL; baseline only; no locks; no rehearsal backend |
| 2b transaction timeout | B (lock taken, then `pg_sleep(30)` under `transaction_timeout` 8 s, `statement_timeout` 50 s) | **FATAL `25P04` "terminating connection due to transaction timeout"**, inside `pg_sleep(30)`. The session is ended; there is no pid in the message, because FATAL cannot be caught | no DDL; baseline only; no locks; no rehearsal backend |
| 2c cancel | B 1837574, run by a subagent, held **AccessExclusiveLock** (and the index build's ShareLock) at 16:47:42.08 ∥ C 1837575 found it by `application_name` in 3 ms, then `pg_cancel_backend(1837574)` → **true** | B: **`57014` "canceling statement due to user request" after 1013 ms, backend 1837574** | (16:47:44.26) no DDL; baseline only; no locks; no rehearsal backend |
| 3 positive control | B-POSITIVE, no holder | committed | `t_id_uniq` present; ledger row `20260929164826 lockprobe`, one element, md5 `59ece267…` = the checked bytes, `created_by` set; no locks |
| 4 CLEANUP | — | `drop schema stage0_lockprobe cascade` | schema gone, 0 relations, 0 rehearsal locks, 0 active rehearsal backends. Real ledger unchanged (31 rows, head `20260928160847`); no `stage0*` schema; no `t_id_uniq` |

*Found and fixed during the run, each re-pinned in its own commit BEFORE the
affected text ran again:*
- **The `pg_stat_activity` snapshot.** A wait loop joined to
  `pg_stat_activity` rereads the transaction's first snapshot
  (`stats_fetch_consistency = cache`) and never sees a new session.
  C-CANCEL now calls `pg_stat_clear_snapshot()` on each iteration
  (`83bbf62`). B's wait loops read `pg_locks`, which is live.
- **A display value.** `statement_timeout = 60s` displays as `1min`, so
  B-TXTIMEOUT's settings assert (it compares display text) failed closed:
  P0001, no DDL, nothing left behind. The rehearsal value became 50 s
  (`1e122db`). Every production value displays as itself. 3 s, 10 s and 45 s
  were confirmed on staging by the assert passing; 90 s and 110 s (P1) were
  confirmed on PG 17.5 locally. A mismatch fails closed at the assert before
  any DDL.
- **Two scenario-1 attempts that did not overlap.** The B text refused with
  "no holder seen within 10 s — the sessions did not overlap; nothing was
  tried". The caller's own calls were serialized, or issued in a later turn,
  after the holder had finished. The guard did what it says; nothing was
  changed.

*What this establishes for production, and what it does not:*
- **Established:**
  - `lock_timeout` refuses a DDL that meets a reader's lock at ≈3 s.
  - `statement_timeout`, `transaction_timeout` (PG 17) and
    `pg_cancel_backend` each end the transaction after the ACCESS EXCLUSIVE
    lock is held, and each releases it with no DDL and no ledger row.
  - The same wrapper pattern commits cleanly when nothing contends.
  - All of it through the `execute_sql` tool that P1/P2 will use.
- **For the operator:** cancelling a running P1/P2 needs a SECOND caller while
  the first call is in flight. One caller's calls are serialized. The C-CANCEL
  pattern — find the backend by `application_name`, clear the stats snapshot,
  `pg_cancel_backend` — is the rehearsed way, and the pinned procedure below
  is built on it. Otherwise the timers are the bound.
- **Not established:** production's own lock traffic, and a PG 17 server other
  than staging's 17.6. P0 requires PG 17.

*The pinned second-caller cancel procedure (review of `dc5a88b`,
non-blocking).* Every stage-0 text runs under
`application_name = release2-stage0-<step>`, where the step is P1, P2-01,
P2-02, P2-0304, P2-05, RB-5, RB-43, RB-2 or RB-1 (M-6 checks each). To stop
one that is in flight, the second caller is a background subagent on the
same `execute_sql` tool and project id, and runs:
1. **CANCEL-INSPECT** (pinned, read-only). It returns every stage-0 backend
   except the caller, with:
   - its exact `backend_start`, as UTC text to the microsecond;
   - its state and wait event;
   - every lock it holds or awaits.

   It also returns the backends per name and every lock on
   `public.employees`. Proceed only if exactly one row carries the step's
   name.
2. **`node scripts/manual/assemble-stage0.mjs --cancel <step> <backend_start>`**
   produces CANCEL-STEP from its pinned template. It refuses unless the
   template's md5 and bytes equal the manifest's, the step is one of the nine,
   and `backend_start` is exactly in INSPECT's format. The text is shown to
   Ryan before it runs.
3. **CANCEL-STEP**, from the second caller:
   - it re-validates both values in SQL, so a hand-edited copy refuses too;
   - it matches the exact `application_name` AND the exact `backend_start`,
     never the caller (`pid <> pg_backend_pid()`);
   - it refuses zero matches and more than one, with nothing signalled;
   - then `pg_cancel_backend` (never `pg_terminate_backend`) returns the pid
     and the signal's result.

   The match and the signal are two statements: a target that ends between
   them makes the signal return false, and PID reuse inside that window is
   not prevented.
4. **CANCEL-INSPECT again** — the target gone or idle, its locks released —
   **then STATE** (§A6), which alone decides what committed.

Evidence so far: M-6 checks the texts statically, and M-11 checks the
instantiation's refusals. Locally (PGlite, one connection), INSPECT runs as a
read. CANCEL-STEP refuses:
- a missing target;
- the caller's own `application_name` + `backend_start` (which match exactly
  one backend without the exclusion);
- hand-edited values.

**Not yet run with a live second session.** The mechanism is the one
rehearsed as C-CANCEL (2c above). A staging run of these texts would be a
separate approval.

**E7. Executed so far — locally, not on any Supabase project.** Every
assembled text was run in a real Postgres 17 (PGlite 0.3.16 here; the review
of d01b74a re-ran it on PGlite 0.4.6, PostgreSQL 17.5, which is now the pinned
version in the script's header), with
`scripts/manual/stage0-local-pglite.mjs`. The database was built from a
minimal Supabase shim plus the 20 committed migrations and production-shaped
rows.

Results, all as designed:
- **Sequence:** P0; P1 (every proof, 03's 42702 inside its savepoint, all
  four RB operations, catalog equality); P0 identical after P1; P2-01,
  P2-02, P2-0304, P2-05, each ledger row carrying A1's md5 and bytes; STATE
  naming prefix 01–05 and RB-5, RB-43, RB-2, RB-1; those four; P0-S identical
  to the original, `catalog_fingerprint` included; P0-L = the 20 rows + 5
  forward + 5 rollback rows, in order.
- **Recovery from every committed prefix (N7), each on a fresh database:**
  - 01 → RB-1;
  - 01–02 → RB-2, RB-1;
  - 01–04 → RB-43, RB-2, RB-1;
  - 01–05 → RB-5, RB-43, RB-2, RB-1;
  - a partial recovery (RB-5 only, after which STATE names the 01–04 line).

  In each, STATE names exactly that prefix, catalog state and sequence. After
  it, P0-S is identical to the original (catalog fingerprint, so schema and
  ACLs), and the ledger only grew: the 20 rows, the forward rows, then the
  rollback rows, in order. STATE then reports nothing applied.
- **Forced failures inside P2-0304**, local fault injection on a copy of the
  pinned text, never on the text itself:
  - (a) 04's embedded bytes altered: the md5 gate refuses before either file
    executes;
  - (b) 04 made to fail at runtime, after 03 has executed, with its gate
    re-pointed at the faulty bytes.

  Both leave the ledger at 01 and 02 only, with no 03 row, and the catalog
  "after 02". STATE names RB-2, RB-1, and that recovery restores P0-S.
- **STATE refuses to guess:** 03 executed outside any wrapper (catalog
  "after 03", ledger 01–02) returns `STOP`, not an operation.
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
| 2 deployment-context check in place, (a)–(d) | (a) and (d) from P4; (b) and (c) already recorded (0b-prod and 0a, both 2026-09-23); the context-alone denial (0b-staging, 2026-09-24); **plus `flagEnabled:true` on the P4 deploy (D4)** |
| 3 Phase 1 green on production | F2: four uniform 401s after P6 |
| 4 a preview refused with 404 by a curl with no Origin | F2: a fresh production-site preview, three Origin variants, after P6 |
| 5 the inventory proves the client calls no endpoint | inventory gate — INCLUDING the request/dispatcher boundary (`bbbd637`) — green on the A3 source and on the P3 commit, and accepted by review. Not closed until then |
| plus: credential transition | C5 steps 1–10 recorded: key inventory; current-deploy proof including the canary's `store:store4979`; historical baseline and proof per URL of the post-P4 old-key set; provider-side record; C8's prefix; the cleanup answer (scheduler named, or paused) |
| plus: bound to source | the P4, P5 and P6 deploy ids and `commit_ref`s, each compared with the manifest's pinned trees |

**What G0 condition 5's inventory gate is, and is not (review of dc5a88b,
N1).** It is a regression gate against unreviewed or accidental request paths
in `src/`. Every raw request API is an allowlisted site. The global object may
only be read through. It fails closed on the named code-evaluation sinks:
- `eval` and `Function`, free or through any global chain (computed access
  included);
- any `.constructor` member;
- timers whose first argument is not provably a function. Since the review
  of `add1d2c` that means only an inline arrow or function expression, or a
  name that scope resolution binds to a `const` initialized with one;
- non-literal `import()` specifiers and worker URLs.

It is **not** a sandbox against deliberately obfuscated source. For example,
it does not resolve computed member access with a non-literal key on ordinary
objects. Mandatory code review of every change to `src/` is the control for
that.

**F4. Rollback, per step (F-7).**

| step | rollback | precondition | class |
|---|---|---|---|
| P1 | none needed — rolled back by construction | — | — |
| P2/P3, **before P6 only** | STATE first (§A6), then exactly the sequence §A6's prefix table names for the committed prefix — at most RB-5, RB-43, RB-2, RB-1 — through the E1 wrapper, each read back, in an E0 window (RB-1 closes the counter). `STOP` from STATE means return to review. Then E6: P0-S identical, P0-L = the original rows + the appended rows | **the Release 2 state is empty or disposable** (RB-1's guard enforces zero rows in the five identity/capability tables). **There are no active consumers:** P6 not merged, Phase 1 on the published deploy answering 404 at that time (recorded), and the inventory green (no client names an endpoint) | reversal of a reviewed decision |
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
| B4 break-glass re-enable; named rollback targets; re-probe; old-key set after P4 | B1–B3, C9; targets restricted to commits carrying the queue fix (N4, M-10) |
| B5 runtime-enabled evidence separate from `flagPresent`; `deploy-context` kept | D4 — `flagEnabled` implemented in `64730fe` (DC-24); D (final paragraph) |
| B6 A3/C pinned; deploy ids bound to source | A3, C5.4, D1, F1, F3 |
| F5 rulings 1–5 | F5 |
| staging qualifications | G |

**The review of `d01b74a` (AMEND), item by item:**

| item | resolved in |
|---|---|
| N1 request boundary: global aliases, the dynamic asset exception | `1c7d552`. The inventory resolves the global object through aliases, chains, `document.defaultView`, eval/Function/constructor/string timers; the global may only be read through. `src/lib/assetTransport.js` is the only asset site: fixed bundled paths, GET/omit/error, all enforced by the scanner. The logo policy runs before any request. MUT-49..53 include Codex's two exact snippets, a function-route logo, POST and redirect cases; `asset-transport.test.js` is the runtime test |
| N2 INV-6 in the real test file | `c995894`. `release2-inventory.test.js` INV-6 uses `appliedReleaseState`. RB-INV-9 runs the real file on Codex's lifecycle fixture (7/7), and RB-INV-10 shows it still failing Codex's original reproduction. It fails the old INV-6 with Codex's message |
| N3 manifest lifecycle; frozen inputs; build-input binding; PGlite version | `45ee1a3`. Inputs pinned by blob, state-aware checks, the lifecycle test (pending → each apply → fully applied → committed rollback → record-only update), manifest-commit resolution, M-7b (every build script and `.env`), PGlite 0.4.6 in the harness docs; A5, A7 |
| N4 rollback targets | `a2ae897`. B2 lists `7ec5af4`, `9937728` and the A3 source only; `89de03e` and `7f89876` are retained URLs; M-10 requires `orderQueue.js` `f99d16a9…` |
| N5 deadline wording; PG 17; the lock rehearsal | `8faf290` (wording E1/E2/E3, PG 17 mandatory in wrapper and P0, texts pinned), `83bbf62` and `1e122db` (fixes found in the run), and this record (§E8) |
| N6 ledger-row shape | `e58834e`. The staging read-back (§E8), the wrapper writing `created_by` and asserting the full shape, P0's ledger-shape columns, the manifest `ledgerRow`, and local recognition via the `list_migrations` projection |
| inventory residual (R1, request boundary) | G0 condition 5 (F3); closed at the boundary in `bbbd637`, pending review |

**The review of `dc5a88b` (AMEND; N2–N6, F-1, B3, B4 and F5-1 accepted):**

| item | resolved in |
|---|---|
| N1 qualified eval/Function, `.constructor` chains, string timers, dynamic import/worker URLs | `8f5c428`. The scanner fails closed on each, through the existing global-object resolution; MUT-54 (Codex's four cases), MUT-55 (24 variants), MUT-56 (controls: callback timers, literal imports). No `src/` file changed. The boundary statement is in F3 and the scanner header |
| N7 partial-apply recovery | `a3a4544`. P2-0304 (§A6, E1, E4) replaces P2-03 and P2-04; P1 keeps 03's 42702 inside a savepoint (E3); the prefix → recovery table and the STATE read-back (§A6, F4); the harness from every prefix and two forced failures inside P2-0304 (E7); LC-3/LC-4 and RB-INV-11; M-6 and M-8 checks for the new step |
| E8 stale "60 s" in the 2b procedure | `12460fe`: 50 s, as run and recorded |
| (non-blocking) pinned second-caller cancel | the cancel commit. CANCEL-INSPECT and the CANCEL-STEP template (§E8): exact `application_name` + `backend_start`, caller excluded, ambiguity refused, read-back then STATE; M-6, M-11, and the local refusals. Not yet run with a live second session |

**The review of `add1d2c` (N7, F-8, B6, the N1 boundary statement and the
cancel procedure accepted):**

| item | resolved in |
|---|---|
| N1 residual: a `for…of` / `for…in` head writing to a function declaration's name passed the timer check | the N1 structural commit. `provablyCallable` no longer looks for writes. The argument passes only as an inline arrow or function expression, or as a name that scope resolution (`resolveBinding`) binds to a `const` initialized with one. Codex's two exact cases (MUT-57), 24 variants (MUT-58: destructuring writes, `var` redeclaration, a function declaration passed directly, a `let` arrow reassigned or not, shadowing params/catch/for-of, imports and more), and controls (MUT-59, TrainingDrawer's `const measure` included), all with the allowlist unchanged. No `src/` file changed |

**The review of `87f3d3d` (the for…of/for…in cases and the client smoke
record accepted):**

| item | resolved in |
|---|---|
| N1 blocker: `resolveBinding` searched a switch's case declarations for a reference in the DISCRIMINANT, which the language evaluates in the enclosing scope | the scope-audit commit. A scope's declarations now apply only to what the language evaluates inside it: the switch discriminant resolves outward, and parameter expressions never see the body's vars. The const-only rule is unchanged. Every case is scanned AND executed as a real module with a recording timer, and the record is printed. MUT-60 is Codex's exact case: refused, and executed it hands the timer the caller's string. MUT-61 is the audit, all refused: for…of/for…in right sides, the for(;;) init/test/update, parameter defaults (plain, destructuring, arrow, catch), class `extends` and computed method/field keys, and object computed keys. MUT-62 holds the cases where the scanner credits a const still in its TDZ — a case test, a later declarator in a for head, a statement before a block's const. Executed, each throws `ReferenceError` with ZERO timer calls. MUT-63 holds controls with recorded function calls: consts in case and loop bodies, a for-head const, a parameter default that the language resolves to an outer const, and the real tree (TrainingDrawer). No `src/` file, assembler or SQL changed; the manifest moves only the scanner pin |

## I. Decisions, what has run, and what remains

**Ryan's decisions, 2026-09-29:**
1. **D4:** `flagEnabled` added with the gate's exact predicate, with tests;
   `flagPresent` kept; A3 and the manifest re-pinned (`64730fe`).
2. **C3:** approved to run **only after Codex accepts revision 2**, including
   the SIZE-PROBE (C3.7).
3. **Canary:** subject `STAGE 0 CANARY - no action needed`. Ryan confirms
   delivery in the store inbox and reads the send-print-job function log
   (C7).
4. **Cleanup:** `CLEANUP_SECRET` set, no external caller. Recorded as PAUSED
   (C7).
5. **No private type-only check route** (C4.2).

**Run on staging for the review of `d01b74a` (both approved by Ryan for that
round; records in §E8):**
- N6: the read-only ledger read-back;
- N5: the two-session lock rehearsal, in a throwaway schema that was dropped
  afterwards.

Nothing ran on production.

The review of `dc5a88b` round was repo-only: nothing ran on staging or
production.

**Remaining, each at its own stop point, none started:**
1. The client smoke record (Ryan).
2. Codex's review of this revision (including the d01b74a N1–N6 and the
   dc5a88b N1 and N7 corrections).
3. C3 on staging, including C3.7, only after Codex accepts.
4. P0 (read-only), then P1 onward.

---

## Appendix — retained deploys on the production site (2026-09-28T16:12:14Z)

| # | deploy id | context | state | PR | commit | built (UTC) | fixes (cleanup, recipient) | service-role key | role |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `6aa59114f573770008fb8dd5` | production | ready | — | `7f898762` | 2026-09-12T17:51 | cleanup yes, recipient yes | PRESENT, writer live | retained (not a rebuild target: pre-queue-fix, N4) |
| 2 | `6aa994d535444e0008272512` | production | ready | — | `89de03e5` | 2026-09-15T18:56 | cleanup yes, recipient yes | PRESENT, writer live | retained (not a rebuild target: pre-queue-fix, N4) |
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
