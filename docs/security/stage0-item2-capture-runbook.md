# Stage 0 — item 2: the staging capture session — RUNBOOK (DRAFT, for Codex review)

**Status: DRAFT. Nothing in it runs yet.** Three things are reviewed by Codex
before any send: this runbook, the exact probe pins (§1), and the executable
stop rules (`scripts/manual/stage0-capture.mjs`, §2). After that review, each
phase still needs its own go from Ryan (§3).
- **Staging only:** `lboajqihpsfrokqvjgnl`. No production send of any kind.
- **H** below is the commit Codex names when it clears this runbook.

Source: `docs/security/stage0-item2-classifier-plan.md` §6, with Codex's plan
review (`reviews/2026-10-15-cs-and-item2-plan-review.md`, "Capture runbook and
unknown outcomes").

## 0. What it is for, and what it is not

**For:** real sender receipts of the error shapes a stage-0 text can produce.
Rule 3′'s SUPPORT (`scripts/manual/stage0-classify.mjs`) admits today only the
one SQL error ever received through the sender: P2-01 send 2's
`ERROR … CONTEXT: PL/pgSQL function inline_code_block line N at RAISE`. The
capture commit (§7) extends SUPPORT only from what these receipts show.

**Not part of it:**
- item 3, the read-token experiment (Codex Q5: two sessions);
- item 6, the sender's deadline and window guards;
- N5 scenario 1 (55P03 with a holder) and scenario 2c (a cancel). Their N5
  status ("the pinned bytes ran" still open) is unchanged.

## 1. The pins (manifest at H)

| text | md5 | bytes | `read_only` | phase |
|---|---|---|---|---|
| ENVELOPE-PROBE-1 | `94a0ad24c017d29693346aefa07d0165` | 100 | true | B |
| ENVELOPE-PROBE-2 | `5c6d0617384192f7d9381f57b2a91104` | 207 | true | B |
| ENVELOPE-PROBE-3 | `f95beecbe5e7840b21177800ffe4feb3` | 130 | true | B |
| ENVELOPE-PROBE-4 | `c6f2a0d0489f5d4aa894a61f1859cc85` | 209 | true | B |
| ENVELOPE-PROBE-5 | `ece595beef61fa0817442376b2266089` | 112 | true | B |
| LOCKPROBE-SETUP | `d5a8c9de513479429cac9410090666d1` | 991 | false | A, T |
| LOCKPROBE-B-LOCKTIMEOUT | `726f086647bb2a1ef087f19e16de6527` | 5519 | false | A |
| LOCKPROBE-B-STMTTIMEOUT | `b4bb7ddaaedb12c6c97b41ff44529fce` | 4969 | false | A |
| LOCKPROBE-B-POSITIVE | `f18e4ee1a898c7168c7bc65978fc4684` | 4871 | false | A |
| LOCKPROBE-READBACK | `f0d1a6e51d5012fb732241f9e2ae9cc2` | 1164 | false | A, U |
| LOCKPROBE-CLEANUP | `c31297aaa5f8cb481acf48f1cdaa810c` | 924 | false | A, U |
| LOCKPROBE-B-TXTIMEOUT | `040bd75a51d45641aa9dd7df35e939ad` | 4945 | false | T |

**The five probes are new pins.** M-6d, M-12 and the CS-4 control check them:
staging only, `read_only`, marked STAGING ONLY, and no write word, read with
strings kept and E-string escapes decoded. Each is one comment line and one
statement:

```sql
-- ENVELOPE-PROBE-1 — STAGING ONLY, read-only (item 2 plan §6 B1): 22012, no fields.
select 1/0;
-- ENVELOPE-PROBE-2 — STAGING ONLY, read-only (item 2 plan §6 B2): 22012 inside EXECUTE, so a SQL statement frame and an EXECUTE frame.
do $$ begin execute E'select 1;\n-- line two\nselect 1/0;'; end $$;
-- ENVELOPE-PROBE-3 — STAGING ONLY, read-only (item 2 plan §6 B3): 22P02, with DETAIL and a JSON data frame.
select '{'::json;
-- ENVELOPE-PROBE-4 — STAGING ONLY, read-only (item 2 plan §6 B4): P0001, with DETAIL, HINT and a RAISE frame.
do $$ begin raise exception 'probe' using errcode = 'P0001', detail = 'd', hint = 'h'; end $$;
-- ENVELOPE-PROBE-5 — STAGING ONLY, read-only (item 2 plan §6 B5): 42601, with a position.
select from from;
```

**The LOCKPROBE texts are the N5 pins**, unchanged. They are staging-only and
write only inside their throwaway schema `stage0_lockprobe` (M-6c).

## 2. The executable stop rules

After every send, Claude runs both commands on the exact results file, never
on a pasted excerpt:

```bash
node scripts/manual/stage0-capture.mjs <STEP> .stage0-send/<results file>
node scripts/manual/stage0-classify.mjs .stage0-send/<results file>
```

`stage0-capture.mjs` prints one verdict:

| verdict | meaning | what follows |
|---|---|---|
| **MATCH** | the receipt binds (not R1), is exactly the step's declared outcome, and rule 3′ gives the declared class | the next step of the phase, if `nextStep` allows it |
| **STOP-RECORD** | the intended SQLSTATE and path were reached, but the status or rendering differs from the declared one | the phase ends. The receipt is evidence for review |
| **STOP** | anything else: R1, another status, another SQLSTATE (a permission refusal included), a transport failure, gateway text, another success body | the phase ends. The receipt is recorded as itself |

**Only MATCH continues** (`nextStep` in the module). The other rules:
- **Any other verdict ends the phase at once.**
  - No later step of the phase is sent.
  - In a writing phase (A, T, U), no later write is sent, cleanup included,
    until a reviewed decision.
  - Diagnostics are not clearance to resume. A disposable schema is no
    exemption.
- **A MATCH of a writing send that rule 3′ still classifies UNRESOLVED ends
  its phase too.** That is T2, whose FATAL is outside today's SUPPORT. So T
  ends after T2 by design, and U starts only on a reviewed decision about
  T2's receipt.
- **A step's expected outcome was declared before the session** (the module's
  `STEPS`), from:
  - the text's SQL;
  - what PostgreSQL 17.5 reports for it (a local PGlite run, review-only and
    outside the repository, attached to the review request);
  - for A2, A3 and T2, the N5 `execute_sql` messages of 2026-09-29. They
    are copied exactly into `scripts/tests/fixtures/stage0-classify/execute-sql-history.json`.

  Nothing is learned from the capture.
- **The hypotheses the session tests:**
  - **H-FMT:** the API's message is `Failed to run sql query: ` plus
    postgres-meta's error formatting (`pgMetaFormat`; supabase/postgres-meta
    `src/lib/db.ts` on master, read 2026-10-20). P2-01 send 2 and every N5
    message fit it;
  - **H-STATUS:** every SQL error comes back as HTTP 400, FATAL included.
    Only P0001 has been seen through the sender;
  - **H-ROWS:** only the last row-returning statement's rows come back
    (plan §E8);
  - **H-TS:** READBACK's `read_at` comes back as a string. Its format is
    recorded, not asserted.

  A difference is STOP-RECORD, a finding for review, never a correction in
  the moment.

`node scripts/manual/stage0-capture.mjs --list` prints every step and its
declared outcome. At H:

| step | plan | text | declared outcome | rule 3′ now |
|---|---|---|---|---|
| B1 | B1 | ENVELOPE-PROBE-1 | 400, `…ERROR:  22012: division by zero\n` | R4 |
| B2 | B2 | ENVELOPE-PROBE-2 | 400, 22012 + `CONTEXT:  SQL statement "<the executed string>"` + `PL/pgSQL function inline_code_block line 1 at EXECUTE` | R4 |
| B3 | B3 | ENVELOPE-PROBE-3 | 400, 22P02 + `LINE 2:` and its caret + DETAIL + `CONTEXT:  JSON data, line 1: {` | R4 |
| B4 | B4 | ENVELOPE-PROBE-4 | 400, P0001 `probe` + `DETAIL:  d` + `HINT:  h` + `… line 1 at RAISE` | R4 |
| B5 | B5 | ENVELOPE-PROBE-5 | 400, 42601 + `LINE 2:` and its caret, no other field | R4 |
| A1 | A1 | LOCKPROBE-SETUP | 201, `[{"setup":"stage0_lockprobe ready"}]` | R2 |
| A2 | A2 | LOCKPROBE-B-LOCKTIMEOUT (no holder) | 400, P0001 re-raised: `… no holder seen within 10 s … — after <10000–11999> ms, backend <pid>` + `… line 75 at RAISE` | R3 |
| A3 | A3 | LOCKPROBE-B-STMTTIMEOUT | 400, 57014 re-raised: `… canceling statement due to statement timeout — after <7000–8999> ms, backend <pid>` + `… line 64 at RAISE` | R3 |
| A4 | A5 | LOCKPROBE-B-POSITIVE | 201, `[{"set_config":"45s"}]` | R2 |
| A5 | A6 | LOCKPROBE-READBACK | 201: the DDL committed; ledger = the baseline row and one `lockprobe` row of the checked bytes; no lock; no probe backend | R2 |
| A6 | A7 | LOCKPROBE-CLEANUP | 201, `[{"schema_gone":true,"relations_left":0,"probe_locks_left":0,"probe_backends_active":0}]` | R2 |
| T1 | A1 again | LOCKPROBE-SETUP | as A1 | R2 |
| T2 | A4 | LOCKPROBE-B-TXTIMEOUT | 400, `…FATAL:  25P04: terminating connection due to transaction timeout\nCONTEXT:  SQL statement "SELECT pg_sleep(30)"\nPL/pgSQL function inline_code_block line 33 at PERFORM\n` | R4 |
| U1 | A6 again | LOCKPROBE-READBACK | 201: no DDL; the baseline row only; no lock; no probe backend | R2 |
| U2 | A7 again | LOCKPROBE-CLEANUP | as A6 | R2 |

**Why the plan's A1–A7 became A, T and U.** The plan ran TXTIMEOUT (its A4)
in the middle of one phase. Its FATAL is the outcome Codex named as one that
cannot be accepted as it comes. An UNRESOLVED writing send stops every later
write, cleanup included, and a FATAL is R4 today. So in the plan's order, A4
would always strand A5–A7 and the schema. Here:
- the main phase A ends with its own cleanup;
- TXTIMEOUT runs alone in T, after its own SETUP;
- its READBACK and CLEANUP (U) wait for a reviewed decision.

## 3. Phases, order, tokens and gos

Order: **B, then A, then T.** U runs only on a reviewed decision about T2's
receipt.
- B goes first: it is read-only and sends nothing that writes.
- A is the main writing phase. It reuses nothing from B.

**Each phase has its own:**
- **go**, given by Ryan in chat, naming the phase, its exact steps and an
  absolute deadline (EDT). The go lapses at that deadline, at any stop, and
  at any pause. Every pause ends the session (incident record §5);
- **token**:
  - B uses a staging **Database: Read** token, named `stage0-item2-B-<date>`;
  - A, T and U each use a staging token at the level above Read, named
    `stage0-item2-<phase>-<date>`;
  - every token has Resource access → Project → **staging only**, every other
    permission None, and the shortest expiry. Never "Create legacy token";
  - created just before the phase, deleted at its end or at any stop,
    whatever the outcome;
- **receipt preservation** (§4.4) before anything else follows it.

**One window, one token, one send at a time.** The window is titled
`STAGE0 ITEM2 <phase>`. Each send waits for the sender's result. No second
caller is used: no step of this session needs one.

## 4. The procedure for each phase

**4.1 CLAUDE — before the phase.**
1. In this checkout, `git rev-parse HEAD` prints H, and `git status --short`
   prints only `?? AGENTS.md`.
2. Each text of the phase: `node scripts/manual/stage0-send.mjs <TEXT>
   --target staging --dry-run`. The md5 and bytes equal §1 (P1–P3 runbook
   V-DRY, with `target staging = lboajqihpsfrokqvjgnl`).
3. Print the phase's numbered command list, and its declared outcomes
   (`--list`).

**4.2 RYAN — token and window.** The P1–P3 runbook's §0.5 window setup and
§3.2 token steps, with staging in place of production and this phase's name
and level:
- **V-SCOPE**, **V-PROMPT**, **V-MASK** and **V-PREFIX** as written there;
- **V-CLIP** after the paste.

Report the token's name, scope, level and expiry, and the `True` / `44`
lines.

**4.3 Each step, in order.**
1. **RYAN** runs:
   ```powershell
   node scripts/manual/stage0-send.mjs <TEXT> --target staging --confirm-ref lboajqihpsfrokqvjgnl
   ```
   Then he pastes the sender's lines. They carry no secret.
2. **CLAUDE** runs §2's two commands on that results file and reports the
   verdict.
3. **Only on MATCH**, and only if `nextStep` allows it, does Ryan send the
   next step. On anything else, go to §5.

**Timings:**
- A2 waits about 10 s before it refuses (no holder);
- A3 holds about 8 s;
- T2 holds about 8 s, then the session is ended by the server.

Nothing is typed into the window while a send is running.

**4.4 CLAUDE — preserve the receipts.** At the end of the phase, or at any
stop, before anything else:
- list the phase's results files with their md5 and byte counts;
- write that list into the capture record.

The files are never edited, moved or renamed; they stay in `.stage0-send/`.

**4.5 RYAN — close.**
1. In the window, run `Remove-Item Env:SUPABASE_ACCESS_TOKEN`, then `exit`.
2. Delete the phase's token in the dashboard.
3. Report the time.

If Windows clipboard history is on: Win+V → **Clear all**. After this,
nothing can be sent in this phase.

## 5. Stop points

Each of these ends the phase at once. Then: §4.4, then §4.5, then review.
1. **A verdict other than MATCH**, or a MATCH after which `nextStep` stops
   (T2).
2. **A sender refusal before sending:** exit 2, for example a pin mismatch
   or a wrong ref. Nothing was sent, and nothing is changed in the moment.
3. **`tokenRedactedFromResponse: true`.** The token is deleted first.
4. **The deadline, a pause, a lost window,** or anything unexpected in the
   console.
5. **In A, T or U, any outcome other than the declared one** is a STOP for
   every later write, cleanup included. Whatever it leaves on staging (the
   `stage0_lockprobe` schema, a probe ledger row) is recorded, not cleaned
   up, until a reviewed decision. LOCKPROBE-READBACK is not sent as a
   diagnostic inside the stopped phase.
6. **A1 or T1 refused** because `stage0_lockprobe` already exists (P0001
   "clean up first"). That is STOP: an earlier leftover goes to review, not
   to CLEANUP.

## 6. The capture record

The record goes into plan §E, in a new subsection, with:
- each send's step, verdict, rule 3′ class, the results file name, its md5
  and size, and the sender's lines;
- the tokens' names, levels, creation and deletion times;
- each phase's go and deadline as given.

Every receipt is classified twice:
- by the old rule 3 regex, as history;
- by rule 3′.

## 7. After the session: the capture commit (separate, reviewed)

It contains:
- **the receipts,** copied byte for byte into
  `scripts/tests/fixtures/stage0-classify/real/` (`.gitattributes` keeps
  them `-text`), with their md5s in `REAL`;
- **SUPPORT and OBSERVED_STATUSES,** extended only to what the receipts
  show, each entry naming its receipt;
- **any grammar correction the captures force,** for a STOP-RECORD for
  example. Each is reviewed; no receipt is normalized to fit;
- **the open questions, decided with evidence:**
  - whether a PERFORM frame's quoted query (`SELECT pg_sleep(30)`, PERFORM's
    own query) joins the bound text's candidates. Today the candidates are
    only `executedInputs`, what an `EXECUTE` runs;
  - how a position is rendered;
- **the record,** in plan §E.

Codex reviews the implementation, the tests and the captures before any
production window (plan §I).

## 8. What the session cannot establish

- Production's behaviour. Staging and production share the endpoint, but
  this session reaches only staging.
- Any error shape that is not captured. The grammar stays an evidence-backed
  subset: a complete but unsupported variant is R4.
- Anything about item 3: the B token sends only `read_only` texts.
