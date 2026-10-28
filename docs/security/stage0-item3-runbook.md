# Stage 0 — item 3: the read-token experiment on staging — RUNBOOK

**Status: DRAFT, for Codex's review with the item 3 implementation and the
guard store's anchor.** It clears no session, token or send.
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
6. **After E17:**
   - **the separate-credential read (§6);**
   - token deletion and window close (procedure §5). Every pause is an exit.

**Stop rules:**
- **Any STOP from the gate ends E at once.** No later step, cleanup
  included, goes without a reviewed decision. The fixture stays as
  evidence.
- **A 201 at E8–E10 is a STOP:** `read_only` did not stop a write.
  STOP-and-review.
- **A WROTE at E14–E16:** the gate runs E17 and then STOPS. The Read PAT
  wrote: STOP-and-review. No cleanup without Codex's reviewed disposition.
- **An exit code 5, or a hold:** STOP-and-review (procedure §6). A tighter
  go, a clock check, a new window or a new phase releases nothing.

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

## 6. The separate-credential read (after E17)

- **Not a fallback.** This is a labelled, read-only corroboration only. It
  never follows a STOP, and never routes around a hold.
- **Who and how:** Claude, through the Supabase MCP `execute_sql` of this
  session. That is the MCP server's own authorization, not either PAT, and
  not the sender.
- **Target:** staging `lboajqihpsfrokqvjgnl`.
- **Exactly this query, unpinned and labelled ad-hoc:**

  ```sql
  -- item 3, separate-credential read (ad-hoc, read-only, not a pinned text)
  select 'owned' as t, id, label, login_role, session_role, tx_read_only from stage0_item3.owned
  union all
  select 'open', id, label, login_role, session_role, tx_read_only from stage0_item3.open
  union all
  select 'object', null, c.relname || ':' || c.relkind, pg_get_userbyid(c.relowner), null, null
    from pg_class c where c.relnamespace = 'stage0_item3'::regnamespace
  order by 1, 2, 3;
  ```

- **Its result is recorded verbatim.** If it disagrees with E17 in any
  row, object or owner: STOP, with no cleanup.

## 7. Phase X (cleanup), under its own go

- **X's registration needs a reviewed disposition of E,** named with
  `--reviewed <file>`; the phase records the file's sha256. The review file
  names:
  - E's phase id;
  - every E receipt, with its verdict;
  - E3, E13 and E17;
  - the separate-credential read;
  - the conclusion.
- **On the all-REFUSED path,** with every readback consistent, Ryan may
  approve that disposition himself. After any WROTE, a failed control, a
  STOP or a disagreement, it is Codex's reviewed disposition.
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
