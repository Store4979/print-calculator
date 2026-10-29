# Stage 0 — item 3: the read-token experiment on staging — RUNBOOK

**Status: DRAFT, for Codex's review with the item 3 implementation (R, as
corrected by S for Codex's review of ba1a0bd: R-R1 to R-R3) and the guard
store's anchor.** It clears no session, token or send.
- **What it needs:** Codex's clearance of the exact head **H** this runbook
  names, and Ryan's go line for each phase.
- **Its sources:**
  - the plan `docs/security/stage0-item3-read-token-plan.md`, as amended by
    Codex's review of 2026-10-28 (I3-1 to I3-3, Q-1 to Q-5);
  - the guarded-send procedure, `docs/security/stage0-guarded-send-procedure.md`,
    which this runbook follows step for step;
  - the gate, `scripts/manual/stage0-item3.mjs`.

**Staging only:** `lboajqihpsfrokqvjgnl`. No production request of any kind.
No DDL or write outside the throwaway schema `stage0_item3`.

## 0. What it establishes, and what it does not

- **E** measures, through the sender's route
  (`/v1/projects/{ref}/database/query`), what a **Database: Read** PAT's
  request without `read_only` can do:
  - one INSERT into a table that grants INSERT to PUBLIC (`open`, E14);
  - one INSERT into a table the fixture grants to nobody (`owned`, E15);
  - one CREATE TABLE in a schema that grants CREATE to PUBLIC (E16).
- **Before that, the controls:**
  - three INSERTs sent with `read_only` (E8–E10);
  - the write token's INSERT and CREATE TABLE (E11, E12);
  - the fixture's owners, ACLs and objects (E2);
  - each request mode's login role, transaction mode and effective
    privileges (E4–E7);
  - a direct readback of the fixture after each stage (E3, E13, E17).
- **What a result means:**
  - **A WROTE** at E14–E16 disproves the Read/Write-token boundary for that
    observed path: STOP-and-review.
  - **A REFUSED** establishes that statement's refusal for that token and
    mode. It does not establish every SQL capability, nor anything about
    production (Codex Q-4).
  - **A 42501** is an object or schema privilege refusal. On its own it is
    not evidence of a read-only transaction.
  - **WHO rows** come from their own requests. They do not show a failed
    request's role or mode.
- **Not done:** no production read or write, no DDL outside
  `stage0_item3`, and no change to roles, memberships or default privileges.

## 1. The texts and their policy (manifest at H)

| step | text | window | `read_only` | effect | declared outcome |
|---|---|---|---|---|---|
| E1 | I3-SETUP | W | false | write | 201 `[{"setup":"stage0_item3 ready"}]` |
| E2 | I3-FIXTURE | R | true | read | 201, and the fixture contract (§2) |
| E3 | I3-READBACK | W | false | read | 201: no rows; the four base objects |
| E4 | I3-WHO-R-RO | R | true | read | 201, one row of the WHO columns (values recorded) |
| E5 | I3-WHO-R-DEF | R | false | read | as E4 |
| E6 | I3-WHO-W-RO | W | true | read | as E4 |
| E7 | I3-WHO-W-DEF | W | false | read | as E4 |
| E8 | I3-INS-OWNED-W-RO | W | true | write | refused: 25006, or 42501 on `owned` |
| E9 | I3-INS-OWNED-R-RO | R | true | write | refused: 25006, or 42501 on `owned` |
| E10 | I3-INS-OPEN-R-RO | R | true | write | refused: 25006 |
| E11 | I3-INS-OWNED-W-DEF | W | false | write | 201 `[{"id":4,"label":"I3-INS-OWNED-W-DEF"}]` |
| E12 | I3-DDL-W-DEF | W | false | write | 201 `[{"created":true}]` |
| E13 | I3-READBACK | W | false | read | 201: row 4 only; base objects plus `ddl_w` |
| E14 | I3-INS-OPEN-R-DEF | R | false | write | **measured**: WROTE (201, id 5) or REFUSED (25006) |
| E15 | I3-INS-OWNED-R-DEF | R | false | write | **measured**: WROTE (201, id 6) or REFUSED (25006, or 42501 on `owned`) |
| E16 | I3-DDL-R-DEF | R | false | write | **measured**: WROTE (201 created) or REFUSED (25006) |
| E17 | I3-READBACK | W | false | read | 201: exactly the rows and objects E11–E16 explain |
| X1 | I3-CLEANUP | W | false | write | 201 `[{"gone":true}]` |
| X2 | I3-ABSENT | R | true | read | 201 `[{"gone":true}]` |

**Each refusal is declared word for word** (`stage0-item3.mjs REFUSALS`):
- `ERROR:  25006: cannot execute INSERT in a read-only transaction`;
- `ERROR:  42501: permission denied for table owned`;
- `ERROR:  25006: cannot execute CREATE TABLE in a read-only transaction`.

Each comes as HTTP 400 with the body `{"message": "Failed to run sql query:
" + it + "\n"}`, and rule 3′ classifies it R3 (profile B1).

**How these were fixed:** by a local PostgreSQL 17.5 (PGlite) run with
synthetic roles. It is review-only: the script is outside the repository
and attached to the review request. It shows nothing about Supabase's roles.

**In that local run**, the read role's direct readback of `owned` failed
with 42501, because the role has no SELECT there. So the readbacks go from
the **W** window without `read_only`, where the owner reads its own fixture;
their effect is declared read.

**Effect (I3-1):** every INSERT, CREATE, SETUP and CLEANUP is declared
`effect: "write"`, whatever its `read_only` flag and window.
- So an unresolved outcome of any of them, a `read_only` probe included,
  holds the project (procedure §6). That covers a transport failure, an
  incomplete or unsupported body, a 401/403, or an unbound receipt.
- The R window sends INSERTs and a CREATE here only as these named,
  staging-only exceptions. The R/W window stays a local mistake barrier,
  not token authority.
- **A missing effect is unknown, so writing** (Codex, review of ba1a0bd,
  R-R1). The classifier keeps the old read_only-derived effect only for the
  29 texts before item 3, each under exactly its listed pin and policy
  (`stage0-classify.mjs LEGACY_EFFECT`). An item 3 text, or any new text,
  without `effect` holds the project on an unresolved outcome, whatever its
  `read_only` flag.

## 2. The fixture contract (I3-2)

E2's row must show all of the following, or the phase stops:
- both tables owned by the schema's owner, with row security off;
- no policy, trigger or rule;
- the schema holding exactly `open`, `owned` and their primary keys;
- `owned` granted to nobody but its owner;
- `open` granted to its owner, and to PUBLIC for `ar` (SELECT, INSERT)
  only;
- the schema granted to its owner, and to PUBLIC for `UC` (USAGE, CREATE)
  only.

The owner's default ACLs (global, and for `stage0_item3`) are **recorded**:
they explain where a grant came from. An unexpected grant is evidence: it is
never revoked in the session to make the result tidy.

`owned` means "the fixture grants nothing to other roles", not "every role
is powerless on it". An inherited or member privilege shows in E4–E7's
`owned_insert`. An INSERT proves that the request inserted, not who owns
what.

## 3. Before the session

1. **Clearance:** Codex's review clears H. Make a fresh clone at H, with
   its status empty, then `yarn install --frozen-lockfile`.
2. **The store:** `node scripts/manual/stage0-go.mjs status --target staging`
   prints `"intact": true` and store `3389bb8f8df9280e7608c455249678f5`,
   the anchor at H.
3. **Exposure:** Claude checks (Supabase dashboard → staging → API
   settings, or `postgrest.db_schemas` from an ad-hoc read) that
   `stage0_item3` is not among staging's Data API exposed schemas. If it is:
   STOP.
4. **The dry runs (V-DRY):** each of the 19 steps' texts, each matching its
   pin.
5. **The clock check** (procedure §1): `node scripts/manual/stage0-go.mjs clock`.

## 4. Phase E

1. **CLAUDE** drafts the approval and the go line:

   ```bash
   node scripts/manual/stage0-go.mjs draft --workflow item3 --phase E --deadline <UTC, whole minute>
   ```

   It prints the line, with every step's latest start and the phase
   deadline. Claude shows the WHOLE line to Ryan.
2. **RYAN** creates two tokens: staging only, one **Database: Read** and one
   **Database: Read and Write**. He reports each one's name, scope, level
   and expiry (V-SCOPE). Then he returns the go line word for word.
3. **CLAUDE** registers it (procedure §2.5) and prints the windows'
   command.
4. **RYAN** opens window R with the Read token and window W with the Read
   and Write token (procedure §3).
5. **For each step E1…E17, in order:**
   - Claude states the whole-path check;
   - Claude issues the step's go, with `--not-after` where the current pace
     needs one earlier than the step's ceiling (procedure §4);
   - Ryan runs the one command once, in the window it names;
   - Claude classifies the receipt and reads `status`. The gate (the sender
     and the issuer) decides the next step.
6. **After E17, E's end is one of two terminal outcomes** (Codex, review of
   ba1a0bd, R-R3). Claude reads it with
   `node scripts/manual/stage0-go.mjs gate --phase <E's phase id>`:
   - **COMPLETE-REFUSED:** every step matched, every readback agreed, and
     E14–E16 were all REFUSED;
   - **COMPLETE-WROTE:** the same, except that the Read PAT WROTE at one or
     more of E14–E16. The experiment completed consistently, and its result
     is STOP-and-review **before any cleanup**. X waits for Codex's reviewed
     disposition.

   Either outcome, with nothing held and no lock, and before E's deadline,
   is the only state in which `gate` prints
   `"corroborate": true`. Then, in this order:
   - **the separate-credential read (§6),** once;
   - token deletion and window close (procedure §5). Every pause is an exit.

**Stop rules:**
- **Any STOP from the gate ends E at once.** No later step, no
  separate-credential read and no cleanup goes without a reviewed decision.
  The fixture stays as evidence.
- **A 201 at E8–E10 is a STOP:** `read_only` did not stop a write.
  STOP-and-review.
- **A WROTE at E14–E16 is not a STOP by itself:** the gate runs E17, and
  only a consistent E17 reaches COMPLETE-WROTE. That outcome is still
  STOP-and-review for everything after the one read: no cleanup without
  Codex's reviewed disposition.
- **An exit code 5, or a hold:** STOP-and-review (procedure §6). A tighter
  go, a clock check, a new window or a new phase releases nothing. A hold
  also forbids the separate-credential read: `gate` reports
  `"corroborate": false`.

## 5. The clock during the session (renewal)

- The clock check is valid for 60 minutes. Phase E's ceilings run up to
  about 61 minutes before its deadline, and a session may outlast one check.
- **Renewal:** before issuing any go less than 5 minutes before the check's
  60-minute mark, Claude runs `node scripts/manual/stage0-go.mjs clock`
  again. Ryan's windows and tokens are untouched, and the issuer and the
  sender then use the new check.
- **A renewal changes only the clock check.** It does not extend a step's
  ceiling or the phase deadline, reopen a stopped phase, re-arm a used go,
  or resolve a pending or held attempt.
- **A failed renewal is a pause:** w32tm unreachable, or an offset beyond
  ±2 s. Every window closes, the tokens are deleted, and the session ends
  (procedure §5).

## 6. The separate-credential read (after a terminal outcome of E)

- **Not a fallback.** This is a labelled, read-only corroboration only, sent
  once. It is permitted only when `stage0-go.mjs gate --phase <E>` prints
  `"corroborate": true`: COMPLETE-REFUSED or COMPLETE-WROTE, nothing held,
  no lock, before E's deadline. It never follows a STOP, a failed control,
  an unsupported outcome or an inconsistent readback, and never routes
  around a hold.
- **Who and how:** Claude, through the Supabase MCP `execute_sql` of this
  session. That is the MCP server's own authorization, not either PAT, and
  not the sender.
- **Target:** staging `lboajqihpsfrokqvjgnl`.
- **Exactly this query, unpinned and labelled ad-hoc.** It is
  `CORROBORATION_SQL` in `stage0-item3.mjs`, and `gate` prints it; a test
  (I3-7) requires this block to be byte-identical to it:

  ```sql
  -- item 3, separate-credential read (ad-hoc, read-only, not a pinned text)
  select 'owned' as t, id, label, login_role, session_role, tx_read_only from stage0_item3.owned
  union all
  select 'open', id, label, login_role, session_role, tx_read_only from stage0_item3.open
  union all
  select 'object', null, c.relname || ':' || c.relkind::text, pg_get_userbyid(c.relowner), null, null
    from pg_class c where c.relnamespace = 'stage0_item3'::regnamespace
  order by 1, 2, 3;
  ```

  `relkind` is PostgreSQL's internal `"char"` type. Without the `::text`
  cast, the concatenation fails with `42725: operator is not unique: text
  || "char"` (Codex's local PostgreSQL 17.5 run; R had that defect).
- **The comparison:** Claude saves the returned JSON array exactly, as a
  file outside the checkout, and runs
  `node scripts/manual/stage0-go.mjs corroborate --phase <E> --rows <file>`.
  It re-checks the permission, then compares every row of `owned` and
  `open` (id, label and the writer columns) and every object (name, kind,
  owner) with E17's readback.
- **Its result is recorded verbatim, with the command's output.** AGREE
  (exit 0) goes into E's disposition. DISAGREE (exit 3), or a refusal: STOP,
  with no cleanup.
- **The local rehearsal** (`scripts/manual/stage0-item3-local-pglite.mjs`,
  PGlite 0.4.6 with synthetic roles) runs this exact query on both terminal
  outcomes, compares it with E17 as `corroborate` does, and shows the uncast
  form's 42725. It shows nothing about Supabase.

## 7. Phase X (cleanup), under its own go

- **X's registration needs a reviewed disposition of E,** named with
  `--reviewed <file>`; the phase records the file's sha256. The review file
  names:
  - E's phase id;
  - every E receipt, with its verdict;
  - E3, E13 and E17;
  - the separate-credential read;
  - the conclusion.
- **On COMPLETE-REFUSED,** with the read in agreement, Ryan may approve
  that disposition himself. After COMPLETE-WROTE, a failed control, a STOP
  or a disagreement, it is Codex's reviewed disposition.
- **What is enforced, and what is a person's job:** the tools enforce that
  X names a review file and records its hash. That the file is a genuine
  review of E's exact receipts is the human check: the gate does not read
  phase E.
- **Then,** fresh tokens and windows, as in §4: X1 I3-CLEANUP from W, X2
  I3-ABSENT from R. Then the tokens are deleted and the windows closed.

## 8. The record

Plan §E15 (a new section of the production plan) records:
- the tokens' names, scopes, levels and expiries, and their deletion times;
- every go, issue, send and receipt, with its verdict;
- each WHO row;
- the fixture row;
- each readback;
- the separate-credential read;
- E's conclusion, X's disposition and its review file.

Each observation is stated exactly: which token, which request mode, which
statement, what came back.
