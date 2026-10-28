# Stage 0 — item 3: the read-token experiment on staging, and the guard store's first init — PLAN

**Status: PLAN, for Codex's review.** It clears nothing: no `init`, no
anchor, no token, no send. After Codex clears it, the implementation commit
(§5) and the session runbook come back for review before any session.

**Sources:**
- Codex's incident review, 2026-10-12, §3
  (`docs/security/stage0-incident-2026-10-09.md`, Appendix A);
- Codex's capture-plan ruling Q5: two sessions, so item 3 is not pulled
  forward;
- Codex's reviews of `78db6dc` and `22610f8`: the item 3 runbook declares
  its phase and gate; the first init and anchor are separately reviewed; the
  tail-loss boundary is preserved;
- the guarded-send procedure, `docs/security/stage0-guarded-send-procedure.md`.

## 0. The question

On 2026-10-09 a **Database: Read** PAT sent P2-01 to production **without**
`read_only`, and the request reached a PL/pgSQL guard (send 2). That shows
the route accepts such a request. It does not show whether the token could
have written. Postgres logged that request's login role as
`supabase_read_only_user`. That is supporting evidence only (incident §7):
it does not show what the role may do, and the successful requests left no
line.

Codex §3 requires all of the following:
1. a staging negative-capability experiment, with a disposable fixture and
   project-scoped tokens;
2. the read token attempts a bounded write through the same route, without
   `read_only`;
3. the write token is the positive control;
4. the fixture is verified directly afterward, not from the HTTP status;
5. the `read_only` request path, its transaction and its role are verified
   separately;
6. no migration guard is the test: a guard can refuse before permissions are
   exercised;
7. no permission experiment on production.

**If the read token can write:** document it, stop calling the PAT split a
server-enforced write boundary, and have a reviewed protocol establish an
adequate read-only boundary.

**The route:** the sender posts to `/v1/projects/{ref}/database/query`, with
the body `{ query, parameters, read_only }` (manifest `send.source`).
Supabase documents that route as experimental and beta. Its reference page
(read 2026-10-28) also lists a separate `POST
/v1/projects/{ref}/database/query/read-only`, "Run a sql query as
supabase_read_only_user". The sender does not use that endpoint. This plan
tests only the route the sender uses.

## 1. The experiment

**Staging only:** `lboajqihpsfrokqvjgnl`. Every text is pinned, emitted by
the assembler and sent through the guarded sender (§3). No ad-hoc write of
any kind.

**The fixture:** a throwaway schema `stage0_item3`, made by the write token.
It holds two tables:
- `owned`: owned by the write token's login role. `revoke all … from
  public, anon, authenticated, service_role` (the table-grant rule), and no
  other grant. This is what a migration writes to: an object the read
  token's role is given no privilege on;
- `open`: `grant usage` on the schema and `grant select, insert` on the
  table to `public`. A refusal here can come only from the transaction or
  the session, not from a missing table privilege. The two tables together
  say WHICH layer refuses.

Each table has `id int primary key` and `label text not null`, plus columns
filled by defaults at insert:
- `login_role default current_user`;
- `session_role default session_user`;
- `tx_read_only default current_setting('transaction_read_only')`;
- `written_at default clock_timestamp()`.

So each row records who wrote it and in what mode. Before the session,
Claude checks that `stage0_item3` is not among staging's Data API exposed
schemas; if it is, STOP.

**The texts** (each `-- I3-… — STAGING ONLY`). The suffix names the window
and the mode: R or W, then `RO` (`read_only: true`) or `DEF` (no
`read_only`, the default).

| text | window | `read_only` | SQL (sketch) |
|---|---|---|---|
| I3-SETUP | W | false | create the schema and both tables, revoke and grant as above; `select 'stage0_item3 ready' as setup` |
| I3-WHO-R-RO, I3-WHO-R-DEF, I3-WHO-W-RO, I3-WHO-W-DEF | as named | as named | one row: `current_user`, `session_user`, `transaction_read_only`, `default_transaction_read_only`, membership of `pg_write_all_data`, and INSERT privilege on `owned` and on `open`. The same SQL bytes under four names, so that the policy fixes each one's window and mode |
| I3-INS-OWNED-W-RO | W | true | `insert into stage0_item3.owned (id, label) values (1, '…') returning id, label` |
| I3-INS-OWNED-R-RO | R | true | the same, id 2 |
| I3-INS-OPEN-R-RO | R | true | into `open`, id 3 |
| I3-INS-OWNED-W-DEF | W | false | into `owned`, id 4: **the positive control** |
| I3-INS-OPEN-R-DEF | R | false | into `open`, id 5: **the question, transaction layer** |
| I3-INS-OWNED-R-DEF | R | false | into `owned`, id 6: **the question, privilege layer** |
| I3-READBACK | R | true | every row of both tables, every column, ordered by id; the schema's presence |
| I3-CLEANUP | W | false | `drop schema stage0_item3 cascade`; `select to_regnamespace('stage0_item3') is null as gone` |
| I3-ABSENT | R | true | `select to_regnamespace('stage0_item3') is null as gone` |

- **Every write is one plain INSERT of one row** into the disposable schema.
  There is no guard, function or DO block in front of it, so it exercises
  the permission itself (Codex's point 6).
- **DDL by the read token is not attempted.** Production's texts are
  mostly DDL; see Q-3.

**The phases.** Each phase has its own go line from Ryan, and its own fresh
pair of windows and tokens (procedure P1).

| phase | steps, in order | expected |
|---|---|---|
| **E** (experiment) | E1 I3-SETUP · E2 I3-READBACK · E3 WHO-R-RO · E4 WHO-R-DEF · E5 WHO-W-RO · E6 WHO-W-DEF · E7 INS-OWNED-W-RO · E8 INS-OWNED-R-RO · E9 INS-OPEN-R-RO · E10 INS-OWNED-W-DEF · E11 I3-READBACK · E12 INS-OPEN-R-DEF · E13 INS-OWNED-R-DEF · E14 I3-READBACK | below |
| **X** (cleanup) | X1 I3-CLEANUP · X2 I3-ABSENT | `gone true`, twice |

**The order is deliberate:**
- the `read_only` controls (E7–E9) and the write token's positive control
  (E10) come before the question (E12, E13);
- the fixture is read back directly before the question (E11) and after it
  (E14);
- so a "can write" result arrives with every control already on record.

**The declared outcomes** (the gate's `checkStep`, declared before the
session, as in item 2):

| step | declared outcome | anything else |
|---|---|---|
| E1, E10 | 201 and the exact row (`setup`; `id 4`) | STOP |
| E2 | 201, both tables empty, the schema present | STOP |
| E3–E6 | 201 and one row of exactly the declared columns. The VALUES are the measurement: recorded, never asserted | STOP |
| E7, E8, E9 | **a refusal:** HTTP 400, body `{"message"}`, SQLSTATE `25006` (read-only transaction) or `42501` (insufficient privilege), rule 3′ R3. Which of the two is recorded | **a 201 is STOP-and-review:** `read_only` did not stop a write |
| E11 | 201: exactly the E10 row in `owned`, nothing in `open` | STOP |
| E12, E13 | **the measurement.** Either WROTE (201 and the exact row, R2) or REFUSED (as E7) | STOP |
| E14 | 201: exactly the E10 row, plus E12's and E13's rows where those steps WROTE | STOP |
| X1, X2 | 201, `gone true` | STOP |

- **The gate** (`nextStep`) checks E14 against E12's and E13's recorded
  outcomes. A row the outcome does not explain, or a missing one, is STOP.
- **A refusal SQLSTATE** other than `25006` or `42501` is STOP. So is any
  frame, DETAIL or HINT that makes rule 3′ anything but R3.
- **An HTTP 403 or 401** from the route, or any non-SQL body, is STOP. It
  is not "cannot write". It is classified R4, and as a writing send it
  holds the project until a reviewed disposition (procedure §6).
- **Before the session:** a local PostgreSQL 17.5 (PGlite) run records each
  refusal's exact message text, outside the repository, as in item 2. Two
  conditions are simulated there:
  - a role with no privilege on `owned`;
  - `default_transaction_read_only`.

  This fixes the declared texts. It shows nothing about Supabase's roles.

## 2. What each result would mean, and what follows

| E12 (open), E13 (owned) | reading | what follows |
|---|---|---|
| REFUSED, REFUSED | On staging, for these tokens, a Read PAT's request without `read_only` could not insert. E12's SQLSTATE says whether the transaction or the role refused. E3–E6 show the login role and mode for each token and mode | Record it. The PAT split may be described as observed on staging for INSERT, not as proven for DDL or for production (Q-3, Q-4). X runs under its own go |
| WROTE, REFUSED | the read token's session can write; only table privileges stopped `owned` | **STOP-and-review.** The PAT split is not a server-enforced write boundary. X waits for a reviewed decision; the rows are the evidence |
| either, WROTE | the read token wrote a table its role should not own | **STOP-and-review**, as above |
| any STOP | not a result | the phase ends at once. No cleanup without a reviewed decision |

**If the read token can write,** the production protocol needs a reviewed
read-only boundary. Candidates, for review then and not decided here:
- every non-writing text sent with `read_only: true`. P0 and STATE already
  are. E7–E9 then show whether that refuses a write;
- the documented `/database/query/read-only` endpoint for reads. That would
  be a new transport, and needs its own review.

**Whatever the result:**
- **`read_only: true`:** E7–E9 are the first direct evidence of whether it
  refuses a write for both tokens. A 201 at any of them is STOP: then
  `read_only` is not a boundary either;
- **the login role** for each token and mode is recorded (E3–E6). The R/W
  window label stays a local mistake barrier in every case (Codex §3);
- **the fixture is read directly** (E11, E14). After E14, Claude also makes
  one ad-hoc, unpinned, labelled `execute_sql` read of both tables on
  staging, through another credential (§4). If it disagrees with E14, STOP.

## 3. Under the guarded sender

Item 3 is the first session under the guarded procedure. Every send needs a
go issued by `stage0-go.mjs` against a registered phase.

**The workflow `item3`** is declared in code, in a new pinned chain module
`scripts/manual/stage0-item3.mjs`. It exports `STEPS`, `PHASES`,
`checkStep` and `nextStep`, as `stage0-capture.mjs` does for capture.
- `stage0-guard.mjs` declares `WORKFLOWS.item3`, with target `staging`. The
  chain grows from seven files to eight. The manifest's `guard` pins it,
  and the raw-text audit applies (no loader words, the one-line static
  import form).
- Keeping it out of `stage0-capture.mjs` leaves item 2's accepted gate
  unchanged.

**Ceilings:** both phases DECLARE them, although staging does not require
it (Q-P2 of P's review request). They are the first real use of the ceiling
code before production, with whole minutes reserved before the phase
deadline:

| step | E1 | E2 | E3 | E4 | E5 | E6 | E7 | E8 | E9 | E10 | E11 | E12 | E13 | E14 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| reserve (min) | 45 | 42 | 39 | 36 | 33 | 30 | 27 | 24 | 21 | 18 | 15 | 12 | 9 | 6 |

X reserves 6 min for X1 and 3 min for X2. These are staging choices for a
session of about 3 minutes per step, with a 90-minute phase deadline. E's
reserves cover E's own steps: X is its own phase, with its own go and
deadline. They are not item 4(c)'s production numbers.

**The send policy** (manifest M-12):
- every I3 text has `targets: ["staging"]`, the window and `read_only` in
  §1's table;
- a new manifest check, like M-6c and M-6d for item 2, requires each I3
  text to:
  - be marked STAGING ONLY;
  - write only inside `stage0_item3`, read with strings kept and E-string
    escapes decoded;
  - have its write word only in the six INS texts, SETUP and CLEANUP.

**The classifier:**
- `SUCCESS` gains an exact predicate for each I3 text whose success body is
  known before the session (SETUP, the six INS rows, CLEANUP, ABSENT);
- WHO and READBACK get shape predicates (declared keys and types), since
  their values are the measurement;
- no new envelope PROFILE is expected: a 25006 or 42501 refusal is a
  field-less ERROR, profile B1. If the PGlite run or the session shows
  otherwise, that is STOP-RECORD for review, never a correction in the
  moment;
- the classifier is re-pinned and reviewed with the implementation.

**What the guard adds:**
- a writing send that rule 3′ classifies R1 or R4 holds the project (E7–E13,
  X1). A 201 at E12 or E13 is R2 under its predicate, so no hold. It is
  stopped by the PROCEDURE (§2), not by a hold;
- a step past its ceiling is not sent (CE-5), and the phase stops there.

## 4. The guard store's first `init`, and its anchor

**Preconditions,** each recorded:
1. Codex clears this plan.
2. **The store is absent:** `Test-Path "$env:USERPROFILE\.stage0-guard"` is
   `False`. (It was `False` when read on 2026-10-28.)
3. **No sync or backup covers it.** This is Codex's tail-loss ruling: the
   store cannot detect a coherent rollback, so nothing may be able to roll
   it back. At 2026-10-28, read-only:
   - OneDrive is installed, at `C:\Users\Tex's PC\OneDrive`;
   - Desktop, Documents and Pictures are NOT redirected into it;
   - `C:\Users\Tex's PC\.stage0-guard` is outside it;
   - the File History service is stopped.

   Ryan's screenshot of Windows Settings → Windows backup, 2026-10-28,
   shows:
   - OneDrive "Syncing", with "OneDrive folder syncing" whose folder list
     ("Manage sync settings") was not opened;
   - "Remember my apps" On, "App list: Backed up";
   - "Remember my preferences" On, "Preferences: Backed up".

   The screenshot does not show which folders OneDrive syncs. The registry
   read above is what places the store outside them.

   At init these reads are repeated, and Ryan opens "Manage sync settings"
   and reports the folder list. He also confirms that no other backup, sync
   or restore tool covers `C:\Users\Tex's PC`. If anything does, STOP: the
   store's location is decided in review first.
4. **A clean checkout:** a fresh clone at the head Codex names, with no
   tracked changes, `SUPABASE_ACCESS_TOKEN` and `STAGE0_SESSION` unset, and
   no `NODE_OPTIONS`.

**The step (Claude), once:**

```bash
node scripts/manual/stage0-go.mjs init
```

- It makes `%USERPROFILE%\.stage0-guard`, renaming it into place from a
  sibling build directory. It prints the anchor: the store's id, creation
  time, refs, and `predecessor: null`.
- It makes no network call and needs no token.
- Its output is recorded verbatim.

**The anchor commit:**
- the printed anchor goes into the repository, exactly, as
  `docs/security/stage0-guard-store.json`;
- it is committed WITH the item 3 implementation commit (§5), so one review
  covers both. The alternative is a separate anchor-only commit on top: Q-1;
- until that commit is at the session checkout's HEAD, every live command
  refuses;
- `init` runs after this plan is cleared and before the implementation
  commit. The store's identity does not depend on the implementation, so an
  AMEND of the implementation keeps it.

**What the anchor is, and is not** (Codex, review of `22610f8`):
- it is an identity anchor: which store is the established one. It is not
  a log head, and nothing proves the store holds its latest history;
- a whole-store rollback to a valid earlier state is not detected. So:
  - no backup or snapshot of the store is ever restored in place;
  - any known or suspected restore, sync rollback or storage loss is
    STOP-and-review;
  - an unresolved send known from outside the store stays unresolved,
    whatever `status` says (UO-1);
- after `init` the store is never edited, moved or deleted by hand. Loss of
  it, at any time, takes the reviewed restoration path (procedure §7).
  `init --restore` makes a new store; it never revives the old one.

## 5. The implementation commit, for review

On top of the commit Codex names:
- **the assembler:** the I3 texts. The assembler, its outputs and the
  manifest are re-pinned. Every existing output stays byte-identical;
- **the send policy and the new manifest check** (§3);
- **`scripts/manual/stage0-item3.mjs`:** `STEPS`, `PHASES` (with ceilings),
  `checkStep`, `nextStep`;
- **`stage0-guard.mjs`:** `WORKFLOWS.item3`; the chain is eight files;
- **the classifier:** the `SUCCESS` entries;
- **tests:**
  - every declared outcome, and each STOP, on synthetic receipts;
  - the E14 consistency rule;
  - the whole of E and X end to end through the guarded tools, on the
    counting fetch stub, for both measured branches;
  - the manifest check's negatives, with the CS-4 control;
  - the mutation companion extended where the item 3 gate adds a check;
- **the runbook** `docs/security/stage0-item3-runbook.md`:
  - the go lines (with approval ids);
  - each window's setup;
  - every step's command;
  - the stop rules of §1 and §2;
  - V-SCOPE for the two tokens: staging only; Database: Read, and Database:
    Read and Write;
  - the ad-hoc read of §2;
  - the record;
- **`docs/security/stage0-guard-store.json`:** the anchor from §4;
- **docs:** the procedure, CLAUDE.md, and the production plan §E13's O push
  record, flagged as before.

Verified as for O and P (a fresh clone, `yarn test`, `yarn build`, the
14-state replay), then sent for Codex's review. The session needs that
review's clearance, at its exact head, and Ryan's go line for each phase.

## 6. What this plan does not do

- No production request of any kind. No permission experiment on
  production. No DDL by the read token.
- No change to item 4(c), the production texts or any production window.
- It does not decide the production read-only boundary if the read token
  can write. That is a later reviewed protocol (§2).

## 7. Questions for Codex

- **Q-1.** Anchor placement: in the implementation commit (proposed), or a
  separate anchor-only commit on top, reviewed on its own?
- **Q-2.** The `open` table grants INSERT to `public`, to tell a
  transaction-level refusal from a privilege-level one. Is that grant
  acceptable on staging, or should E12 be dropped and only `owned` tested?
- **Q-3.** Should the read token also attempt one bounded DDL statement
  (`create table stage0_item3.r_made ()`)? Production's texts are mostly
  DDL, and an INSERT refusal does not prove a DDL refusal.
- **Q-4.** Staging and production are separate projects. Is a staging
  result enough to describe the production PAT split? Or does production
  need its own read-only, non-writing evidence, such as one `I3-WHO-R-DEF`
  read? (Today that text is staging-only, and none is proposed for
  production.)
- **Q-5.** The reserves in §3, and declaring ceilings on staging phases at
  all.

---

## 8. Codex's review of this plan, and the implementation

**The ruling** (`reviews/2026-10-28-item3-plan-review.md`; §0 to §7 above are
the reviewed text, SHA-256 `b365348f…bb0cfbf25c`):
- **The plan:** AMEND; local implementation may proceed.
- **Q-1:** the combined implementation and anchor commit is accepted.
- **Q-2:** the PUBLIC INSERT on `open` is accepted, for the isolated
  fixture only.
- **Q-3:** add a bounded CREATE TABLE probe, with its control and a catalog
  readback.
- **Q-4:** no inference from staging to production.
- **Q-5:** every new phase declares its ceilings, and the maps are
  rebudgeted.
- **Separately:** a narrow clearance for one token-free first `init` (§9).

**How the implementation differs from §1 to §5:**

| review point | what the implementation does |
|---|---|
| **I3-1** effect, not the request mode | Every I3 text's send policy carries `effect` ("read" or "write"). The classifier takes writing from it (`effectWriting()`); only the texts before item 3 may omit it, and they keep their read_only-derived effect (M-12 lists them). Every INSERT, CREATE, SETUP and CLEANUP is "write", so an unresolved read_only probe holds the project. I3-5 tests each failure mode: transport, incomplete body, 401, 403, unsupported body, unbound receipt. The hold survives fresh windows and phase X, and shows from another checkout. |
| **I3-2** effective privileges | A new read, `I3-FIXTURE` (E2), records owners, ACLs, the owner's default ACLs, RLS, policies, triggers, rules and every object. The gate's fixture contract STOPs on any grant, object or setting the fixture does not intend. Default ACLs are recorded, not asserted. Each WHO row adds superuser, bypass-RLS, `pg_read_all_data`, schema USAGE and CREATE, and SELECT on both tables. Each readback row carries its writer's login role, session role, transaction mode and time. |
| **I3-3** bounded DDL | `I3-DDL-W-DEF` (E12, the control) and `I3-DDL-R-DEF` (E16, measured) are one plain `create table stage0_item3.ddl_w` or `ddl_r`, then `to_regclass`. SETUP grants CREATE on the schema to PUBLIC, the schema-local permission path, so a refusal there is the transaction's, not a missing CREATE. A 42501 on the schema is undeclared, so STOP. Each readback lists every object in the schema with its owner. |
| the readback's window | The local PostgreSQL run showed that a role without SELECT cannot read `owned` back. So `I3-READBACK` goes from **W without read_only** (the owner reads its fixture), with `effect: "read"`. |
| E→X | X declares `requires` (a reviewed disposition of E), so it registers only with a named review file, whose sha256 the phase records. That the file reviews E's exact receipts is the human check: the gate sees only its own phase (stage0-item3.mjs says so). After a WROTE, the gate itself STOPs E after E17. |
| the steps | E has 17 steps (runbook §1): SETUP, FIXTURE, an empty readback, four WHO reads, three read_only controls, the INSERT and CREATE controls, a readback, the three measured writes and a final readback. Then the separate-credential read (runbook §6). |
| Q-5 the ceilings | Each step reserves 3 minutes for itself and every later step in its phase, plus 10 minutes for token cleanup. E1 reserves 61 min and E17 13; X1 16 and X2 13. This is staging budgeting. |
| the clock | Runbook §5: a renewal before the 60-minute mark. It extends no ceiling, reopens nothing and resolves nothing. |
| the outcomes | Declared word for word from a local PostgreSQL 17.5 run with synthetic roles (review-only): 25006 for an INSERT or CREATE in a read-only transaction, 42501 for `owned`. The measured steps MATCH as WROTE or REFUSED. A 201 at a read_only control is STOP. |

## 9. The first init: record

Run on 2026-10-28 under Codex's narrow clearance, from a fresh, clean
checkout of exactly O (`C:\Dev\print-calculator-main\.review\init-22610f8`,
HEAD `22610f80d08b4ed6d905a821e7c0feca4ffdd013`, tree `1812698a…`).

**Preconditions, read at 17:12:33Z and again at 17:23:46.898Z:**
- **The store had never been initialized:**
  - no anchor was ever committed on any ref;
  - `C:\Users\Tex's PC\.stage0-guard` did not exist;
  - no `.stage0-guard*` entry was in the profile.
- **The environment:** `SUPABASE_ACCESS_TOKEN`, `STAGE0_SESSION` and
  `NODE_OPTIONS` were unset (only whether each was set was printed).
- **The checkout:** HEAD was exactly O, its status empty, and the manifest's
  refs were production `gmxyisjjaxtpycsmmzef` and staging
  `lboajqihpsfrokqvjgnl`.
- **Sync and backup:**
  - OneDrive's only sync root is `C:\Users\Tex's PC\OneDrive`;
  - Desktop, Documents, Pictures, Music and Videos are at their profile
    defaults;
  - the File History service was stopped;
  - Ryan's Windows backup screenshot shows the app list and preferences
    backed up. Codex: that is not evidence about this directory.
- **Ryan, in chat:** "OneDrive Manage back up: Desktop, Documents, Pictures,
  Music and Videos are all off. No other backup, sync or restore tool is
  installed or covers C:\Users\Tex's PC, and no one else manages backups for
  this PC."

These checks exclude the automatic sync and restore found here. They cannot
prove that nothing could ever roll the disk back.

**The command, 17:23:47.155Z:** `node scripts/manual/stage0-go.mjs init`,
exit code 0. Its output, verbatim:

```text
store 3389bb8f8df9280e7608c455249678f5 made at C:\Users\Tex's PC\.stage0-guard.
Commit this, exactly, as docs/security/stage0-guard-store.json, in a reviewed commit; until it is at HEAD, every live command refuses:
{
  "schema": "stage0-guard-anchor/1",
  "storeId": "3389bb8f8df9280e7608c455249678f5",
  "createdAt": "2026-10-28T17:23:47.656Z",
  "refs": {
    "production": "gmxyisjjaxtpycsmmzef",
    "staging": "lboajqihpsfrokqvjgnl"
  },
  "predecessor": null
}
```

**Afterwards:**
- the store exists, and the checkout's status was still empty;
- no clock command, draft, phase, marker, token or remote request was run,
  and nothing was read from or written into the store;
- the anchor above is `docs/security/stage0-guard-store.json`, unchanged;
- a rebuilt or corrected implementation reuses this store, and never runs
  init again.
