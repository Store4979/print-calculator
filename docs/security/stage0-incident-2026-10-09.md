# Stage 0 incident — P2-01 applied outside the cleared window (Fri 2026-10-09): RECORD

**Status: RECORD.**
- **Codex's incident review (2026-10-12)** ruled at the cleared head
  `7181b42ce4cfe891ea0aa4a1f9adc70e29797d8e`. It is Appendix A (verbatim),
  and §5 records its decisions.
- **The counter re-opened on Tue 2026-10-13 at 12:20:46 EDT,** at verified
  state 01 (§6). This authorizes no migration or rollback.
- **No production migration window is cleared.**

The per-step record of P2-01 is plan §E12. The window that preceded it is
plan §E11 (`release-2-stage-0-production-plan.md`). Times are EDT (UTC−4)
unless marked Z. Every read-back marked **ad-hoc (not pinned)** was run
through the session's own Supabase MCP `execute_sql` connection (role
`postgres`). It was never sent through the sender.

---

## 1. Summary

- **The Thursday window.** It was cleared for Thursday 2026-10-08, from
  T 20:00 to a reserve end of 23:15 EDT (Codex's window amendment).
  - It ran to **P1 PASS**, and P2-01 was cleared at 21:34.
  - Ryan then ran out of time because of a scheduling conflict. Nothing was
    sent that night. The window lapsed without its close-out or token
    deletion (runbook §9).
- **Fri 11:17 EDT.** P2-01 was sent from window W with the write token,
  12 h 02 min after the reserve end. **Production committed 01.**
  - 45 s later, P2-01 was sent **again**, from window R with the **read
    token**. Its own guard refused it, because 01 was already in the ledger.
- **Production since then** has been at the reviewed prefix 01, settled and
  inert:
  - six empty tables with RLS on and zero policies;
  - the `employees (id, store_id)` constraint;
  - the redeem function, which nothing calls;
  - the four endpoints, still dark.

  The read-backs on Friday, Monday and Tuesday are identical.
- **The counter** was closed from the incident until Tue 12:20:46 EDT
  (Ryan).

## 2. Chronology

| EDT | UTC | event | source |
|---|---|---|---|
| Thu 2026-10-08 20:00 | Fri 00:00Z | T. The window is cleared to T+2:30 (22:30) and the reserve to T+3:15 (23:15). "If it no longer fits before T+3:15, start no further write." | window amendment |
| Thu 20:26 | 00:26Z | Runbook §2.1: the counter closed, Ryan present | plan §E11 |
| Thu 21:24:24 | 01:24:24.192Z | P0₀ (window R): RESOLVED, 26/26 equal to §E10 | plan §E11 |
| Thu 21:30:25 | 01:30:25.743Z | P1 (window W): RESOLVED, exactly the 45 rows, ROLLBACK | plan §E11 |
| Thu 21:32 | 01:32:00Z / 01:32:05Z | P0 = P0₀. STATE `""` / `00` | plan §E11 |
| Thu 21:33:58 | 01:33:58Z | LOCKS: 0 on `employees` | plan §E11 |
| Thu 21:34 | 01:34:14Z | **Claude clears P2-01.** "Run these back to back": window W `stage0-send.mjs P2-01 …`, then window R `stage0-send.mjs STATE …`. Also "never run it a second time". The 22:20 ceiling appears only inside the time-rule check, never as "do not send after 22:20" | the session transcript |
| Thu 21:34 → Fri 11:17 | | No message and no send. Ryan: "nothing happened, ran out of time and was unable to finish due to scheduling conflict." Also "ran out of time and couldn't continue", which Ryan says explains the Friday delay | Ryan, 2026-10-12 (verbatim) |
| Thu 22:20 | 02:20Z | P2-01's latest start passes | |
| Thu 23:15 | 03:15Z | Reserve end. The close-out runbook A.1 prescribes for "P2-01 … not started by its latest start" (P0 = P0₀, the smoke test, §9, re-open) is not run. **Both tokens stay live** | runbook A.1, §9 |
| Fri 2026-10-09 11:17:05 | 15:17:05.343Z → 15:17:06.921Z | **Send 1: P2-01 from window W** (write token). 201, `[{"set_config":"45s"}]` | results file; Ryan's paste |
| Fri 11:17:50 | 15:17:50.900Z → 15:17:52.228Z | **Send 2: P2-01 from window R** (read token), in place of STATE. 400, P0001 guard refusal | results file; Ryan's paste |
| Fri 11:19 | 15:19Z | Claude: STOP. No further send of any kind | |
| Fri 11:20:29–11:20:50 | 15:20:29–15:20:50Z | Diagnostics, ad-hoc (not pinned): STAGE0-BACKENDS, LEDGER, CATALOG, R2COUNTS, CONSUMERS, TABLES-SNAPSHOT (§8) | |
| Fri afternoon, Sat | | Counter closed | Ryan |
| Mon 2026-10-12 09:30 | 13:30Z | Ryan deletes both incident tokens. The list showed both **already expired**; "last used" was not noticed. Both windows closed | Ryan |
| Mon 09:35:56–58 | 13:35:56–58Z | Diagnostics again: identical (§8) | |
| Mon ~10:40–10:48 | ~14:40–14:48Z | Re-opening checklist rows 1–2 and STATE's V-DRY (§6) | |
| Mon ~11:00 | ~15:00Z | Codex's incident review received (Appendix A) | |
| Tue 2026-10-13 12:02:46 | 16:02:46.359Z → 16:02:46.996Z | The fresh STATE through the sender, with a temporary read token (§6) | |
| Tue 12:05–12:06 | 16:05–16:06Z | The fresh reads; the log queries (§6, §7) | |
| Tue by 12:19 | by 16:19Z | The smoke test: "PASSED AND VERIFIED." | Ryan |
| **Tue 12:20:46** | **16:20:46Z** | **Ryan re-opens the counter at verified 01** | Ryan |
| Tue 12:22:40 | 16:22:40Z | TABLES-SNAPSHOT for the 01 record, ad-hoc (not pinned) (plan §E12) | |
| Wed 2026-10-14 12:40 | 16:40Z | Supabase GitHub integration checked on production AND staging: none (§8) | Ryan |

The results files (`.stage0-send/`, gitignored, local to the checkout) do not
record which window or token sent them. Sends 1 and 2 are attributed to a
window and token from Ryan's Friday paste, which showed both windows.

**Timing of send 1:** 13 h 43 min after its clearance (Thu 21:34), 12 h 57 min
after its latest start (Thu 22:20), and 12 h 02 min after the reserve end
(Thu 23:15). Around 11:17, nobody used the app and nobody saw a delay or
error (Ryan).

## 3. Departures from the cleared procedure

Codex: "the late production write, skipped cleanup and wrong command in R".

| rule | where | what happened |
|---|---|---|
| Writes only inside the cleared window; "start no further write" once the path no longer fits before T+3:15 | the window amendment | Both sends came 12 h after T+3:15 |
| P2-01's latest start, 22:20 | runbook §B, as the amendment converted it | Passed by 12 h 57 min |
| §9, "Tokens deleted (always, on every path)" | runbook §9 | Not run Thursday: the operator ran out of time right after the 21:34 clearance. Both tokens were accepted at Fri 11:17. By Mon 09:30 the list showed both as already expired; their exact expiry ("in a day" from Thu ~21:0x / ~21:2x EDT) is not recorded |
| Window R holds the read token, for P0 and STATE only | runbook §0.3 | Window R sent P2-01. **How P2-01 got into window R:** Ryan, 2026-10-14: "I don't remember how P2-01 got into window R". The "ran out of time" answers explain the Friday delay, not this (Ryan) |
| One send per writing text | Claude's 21:34 instruction. The runbook itself forbids re-sending only after an UNRESOLVED send (§A.0) or a settled stop (A.2) | Send 2 repeated send 1, 45 s later |
| The lapsed window's close-out | runbook A.1 | Not run |

**Claude's own findings:**
- the 21:34 clearance did not state its own expiry;
- it paired two near-identical commands across two windows ("back to
  back").

Codex §6's corrections address all of these. §E0's one-day rule was not
breached by send 1: P1 ran at 01:30Z and send 1 at 15:17Z. **The
classification defect (§4) is separate from these departures.** Codex:
"Fixing the classifier alone does not address those departures."

## 4. Classification

| | send 1 | send 2 |
|---|---|---|
| window / token | W / write (Database READ-WRITE) | R / **read (Database READ)** |
| `readOnly` (the sender's policy, M-12) | false | false |
| request | P2-01, md5 `b680442d19f25aca0ede5fdf32542207`, 25194 bytes, `ref gmxyisjjaxtpycsmmzef` | the same |
| `httpStatus` / `error` / `tokenRedactedFromResponse` | 201 / null / false | 400 / null / false |
| body | `[{"set_config":"45s"}]`, exactly the expected body | `{"message":"Failed to run sql query: ERROR:  P0001: stage0 P2-01: release2_01_identity_schema is already in the ledger\nCONTEXT:  PL/pgSQL function inline_code_block line 312 at RAISE\n"}` |
| **runbook §0.7 at H (history, kept)** | **RESOLVED success: 01 COMMITTED** | **UNRESOLVED.** Rule 3's `^Failed to run sql query: (ERROR|FATAL):  [0-9A-Z]{5}: .+$` fits the first line only. The `CONTEXT:` line and the trailing `\n` keep the whole message from matching |
| **disposition (Codex §2, final)** | RESOLVED success: 01 committed | **A RESOLVED SQL guard refusal, with no second application of 01.** It is final after the receipt check: all 11 record fields present; `error null`; a complete JSON object whose only key is `message`; line 1 matches the regex; line 2 a `CONTEXT:` field; one trailing LF |

**The guard.**
- It is P2-01's sixth RAISE: DO-block line 312, text line 323. The five
  before it only read: the timeouts, production's 20 ledger rows, the
  staging seed, store4979, and the embedded md5.
- It runs before `execute f;` (text line 351), where the migration begins.
- Each P2 text has one `do $stage0_wrap$` block holding all its guards and
  `execute f;`. So every error a P2 text can raise after its `set_config`
  preamble carries a `CONTEXT:` line, a lock timeout on `employees`
  included. This is why rule 3 is Codex item 2.

## 5. Codex's decisions (incident review, 2026-10-12; Appendix A)

**Codex's evidence limit.** Codex did not inspect the receipts or query
production. The re-opening clearance required the original receipts to be
checked. That is §6 rows 1–1c.

| § | ruling | decision |
|---|---|---|
| 1 | **Counter: ACCEPT, conditional re-opening** | Re-open at verified 01 once the checks pass (§6: done). It is runbook §A.0's separate incident decision. It authorizes **no** migration or rollback, and gives **no clearance to continue P2 today**. **The reason:** the already-in-the-ledger guard runs before `execute f`, so a later execution of the same pinned duplicate would meet the committed marker and refuse before any migration work. **Preserve that marker.** Elapsed time and zero locks are supporting observations only |
| 2 | **Send 2 and rule 3: AMEND** | Send 2's disposition is as in §4, with the history kept. Rule 3 is fixed to recognize: the complete API error envelope; an anchored PostgreSQL primary error with SQLSTATE; and its supported diagnostic continuation fields, CONTEXT included. The precedence for sender errors, unreadable receipts and incomplete bodies is kept. **No** substring search for ERROR and **no** unrestricted multiline match. **Fixtures:** this exact P0001 response; representative real guard responses; a transport error despite 201; truncated responses; an unexpected success body; gateway/HTML text quoting an SQL error. **It blocks a new window, not the re-opening** |
| 3 | **Read-token capability: AMEND, blocking before the PAT split is relied on again** | Friday proves route access only. **A staging negative-capability experiment is needed:** a disposable fixture, project-scoped tokens, the read token attempting a bounded write without `read_only`, and the write token as the positive control. **The fixture is verified directly afterward**, not from the HTTP status. The `read_only` path's transaction and role behaviour are verified separately. **No migration guard as the test. No production permission experiment.** If the read token can write: document it, stop calling the PAT split a server-enforced write boundary, and have a reviewed protocol establish an adequate read-only boundary |
| 4 | **Migration path** | **(a) ACCEPT now:** stay at 01, re-open conditionally, and prepare a later reviewed window. **(b) REJECT** (blocking): RB-1 → P0 → the existing P1 → the existing P2-01…05 cannot complete. RB-1 appends a `_rollback` row and keeps the forward row (RB-1 text lines 244–245); P1 (line 491) and P2-01 (line 323) refuse while that forward row exists; the baseline changes; and the record tool rejects a forward step after rollback records. Nothing is deleted and no guard is bypassed. A re-apply path needs new SQL and a reviewed record lifecycle. **(c) AMEND, the preferred proposal, still blocking:** a rehearsal from the committed 01 state that verifies the remaining forward steps and the recovery states they can leave. It must preserve 01's ledger identity, set a fresh baseline, cover rollback without committing, and use newly pinned sender texts. The rehearsal, recovery mapping, revised runbook and exact head are reviewed before any window. Thursday's P1 cannot authorize continuation |
| 5 | **Repository record: ACCEPT recording 01 now** | Verify the receipts and the stored bytes (§6 rows 1–1c). Record 01 at `20261009151706` with the **current** table snapshot, the manifest and the record-state checks: plan §E12, and the record commit. This record keeps the out-of-window chronology, the duplicate send, the open token windows and the re-opening evidence. Do not hold pending for a contemplated rollback. A record authorizes no deploy or apply, and the next window needs clearance at its actual new head |
| 6 | **Process corrections: ACCEPT in principle; implementation review blocks a new window** | (1) **Every pause ends the session:** token cleanup and both windows closed before stepping away; no loaded production token overnight; resuming needs fresh setup and clearance. (2) **The sender enforces writing deadlines,** bound to the exact head, production ref, named text and an absolute timestamp with timezone. It refuses a missing, invalid or expired deadline before any request (admission only; it cancels nothing already submitted). (3) **A W setup marker is required for writing texts:** R refuses P1/P2/RB, each go is bound to its specific next text, and no stale W marker survives a new session or an expired clearance. (4) **The classifier,** as §2. **Tests:** refusal with no network call for an expired or missing deadline, an R-window write, a wrong text, a wrong head or ref, and a stale session setup; exact deadline-boundary tests; the real refusal receipt. Passing tests do not authorize Friday's write retroactively |

**What blocks any new production window:**
- §2's classifier, implemented, tested and reviewed;
- §3's staging experiment, and a protocol revision if the read token can
  write;
- §4(c)'s rehearsal, recovery mapping, revised runbook and exact head;
- §6's sender guards and their tests.

Each is planned after this record, for Codex review.

## 6. Re-opening evidence (Codex §1)

The stop rule throughout: "If anything fails or contradicts the incident as
reported, stop: the counter stays closed and it goes back to Codex."
Nothing failed or contradicted it.

| Codex §1 condition | check | result |
|---|---|---|
| The receipts bind both sends to production and pinned P2-01. Send 1 is a complete success, send 2 a complete guard refusal, with no sender error. Every other writing send is accounted for | **1.** Both results files: ref, readOnly, requestMd5, requestBytes, httpStatus, error, body (§4). The results files since P1 | **PASS** (Mon ~14:40Z). Since P1, the files are P0 and STATE (reads, Fri 01:32Z), the two P2-01 sends, and Tuesday's STATE (a read). No other writing send, and no other `.stage0-send/` directory under `C:\Dev` |
| | **1b.** Send 2's receipt is complete (Codex §2's finality condition) | **PASS** (Mon ~15:02Z) |
| Fresh STATE, ledger and catalog agree on 01: forward version `20261009151706`, the expected stored bytes, no later migration or unexpected change. Six tables empty; no stage-0 sessions or employee locks | **1c.** The ledger's `statements[1]` against the manifest's 01 pin | **PASS** (Mon ~15:04Z). Blob `3ea8abb32838a74129e52cfed5abc7b0a9aed33b`, md5 `e97a5fd7c346a3b0a39bc6180dcfde46`, 13720 bytes, 258 LFs and 0 CRs: equal to the ledger. The working-tree copy (13978 bytes, md5 `461af9e5…`) is CRLF only because of `core.autocrlf=true` in this machine's Git system config |
| | **2 / 2′.** LEDGER, CATALOG, R2COUNTS, STAGE0-BACKENDS, ad-hoc (not pinned) | **PASS**, Mon 14:43:28–30Z and again **Tue 16:05:45–50Z**: 21 rows, head `20261009151706`, the 01 row unchanged; exactly state 01; all six tables 0; `0` / `[]` / 0 locks on `employees` |
| | **3.** One fresh STATE through the sender (window R, temporary token `stage0-verify-read-20261012`: production only, Database: Read) | **PASS**, Tue 16:02:46.359Z → 16:02:46.996Z. V-DRY first (`read_only true`, `41dd91021512640818cf80cc7c8ee0f9`, 10781 bytes). `HTTP 201`, `error null`, `tokenRedactedFromResponse false`, 14 fields, no token text. **`effective_prefix "01"`, `ledger_md5_ok true`, `catalog_state "01"`, `recovery "RB-1"`; the ledger rows 01 forward `20261009151706`, all else null** |
| The client still uses the legacy paths; four endpoints dark; no Release 2 consumer enabled | **2 / 2′.** CONSUMERS; the live site against deploy `6ab020c5`; the live JS scanned | **PASS**, Mon 14:43:31–38Z and again **Tue 16:05:50–16:06:00Z**. CONSUMERS: four `{"ok":false,"error":"Not Found"} HTTP 404`. The live site serves deploy `6ab020c50a788b0008d430c9`'s files (`main-DZt0oGiJ.js` md5 `47ab9406ff3e141bd9c96850732c6bf0`, `index-ftBg9V1i.js` md5 `57fb08e6ac5ddc5764e3568ff9150f6d`, identical live and on the deploy). There is no deploy-context function. The live JS (780,229 bytes) names none of the six tables, `redeem_enrollment_ticket`, the four endpoints, or `release2` |
| Both incident PATs deleted or revoked, their status recorded; shell values removed; old windows closed; the temporary PAT deleted after use | Ryan | **PASS.** `stage0-p1p3-read-20261008` and `stage0-p1p3-write-20261008` were deleted Mon 09:30 EDT, **already expired**, with both windows closed. `stage0-verify-read-20261012` was created on Mon 2026-10-12. It was pasted into a shell only on Tue 2026-10-13, just before the STATE send, and was never loaded in a shell overnight (Ryan, 2026-10-14). This makes his 2026-10-13 answer "Today, just before STATE" precise: it describes the paste, not the creation. It was deleted with `Remove-Item` + `exit` by 12:20 EDT Tue; the exact time was not given |
| Legacy PIN sign-in, a real authorized smoke order, the existing queue workflow | **4.** The smoke test (runbook §8: PIN sign-in, a `STAGE0 SMOKE` order saved and not queued, the queue tab, sign out) | **PASS** by Ryan's report, "PASSED AND VERIFIED." (Tue ~12:19 EDT). The four results and the order's time were not itemized |
| Ryan's explicit re-opening decision and its time; the counter closed until then | Ryan | **"Yes, reopen now": Tue 2026-10-13 12:20:46 EDT (16:20:46Z).** Ryan confirmed the counter was closed throughout, from Fri 11:17 |

## 7. Supporting evidence: production's Postgres logs (not a condition; it replaces nothing)

**The queries.** These were read-only `query_logs` queries of production's
`postgres_logs`. Each selected `timestamp`, `parsed.user_name`,
`parsed.application_name`, `parsed.session_id`, `parsed.session_start_time`,
`parsed.backend_type`, `parsed.error_severity`, `parsed.sql_state_code` and
the first 300 characters of the message.

**Fri 2026-10-09 15:16:00–15:19:00Z: three lines.**
- Two are checkpointer lines.
- One is **send 2's ERROR**:
  - 15:17:52.184Z;
  - `user_name supabase_read_only_user`;
  - `application_name release2-stage0-P2-01`;
  - `client backend`;
  - session start 15:17:52 UTC;
  - P0001, "stage0 P2-01: release2_01_identity_schema is already in the
    ledger".
- **There is no line for send 1.**

**Tue 16:01:46–16:03:47Z (the STATE send ±1 min): no lines.**

**Reading:**
- **What the logs show.** The Database Read PAT's request, sent **without**
  `read_only`, logged in as **`supabase_read_only_user`**.
- **What they cannot show.** The queried windows held no line for send 1
  or for Tuesday's STATE. Both requests succeeded, so their login roles are
  **unproven**. The comparison with a read-token `read_only=true` request
  could not be made from these logs. This record does not say why there is
  no line: this project's logging settings were not established, and a
  short ingestion delay for Tuesday's window is not excluded (Codex's
  review of `76883c6`, §3).
- **Its limits.** `user_name` is the login role. It cannot show what that
  role may do, nor a later `SET ROLE` or transaction mode.
- **Codex §3's staging experiment is still required.**

## 8. State at this record

**The read-backs, all ad-hoc (not pinned):**

| read | Fri 2026-10-09 | Mon 2026-10-12 | Tue 2026-10-13 |
|---|---|---|---|
| STAGE0-BACKENDS | 15:20:29Z: `0`, `[]`, `employees_locks 0` | 13:35:56Z, 14:43:28Z: same | 16:05:45Z: same |
| LEDGER | 15:20:30Z: 21 rows, head `20261009151706`. One Release 2 row: `release2_01_identity_schema`, md5 `e97a5fd7c346a3b0a39bc6180dcfde46`, 13720 bytes, `final_lf true`, 1 element `[1:1]`, `created_by store4979@theupsstore.com`, idempotency_key and rollback null | 13:35:57Z, 14:43:29Z: identical | 16:05:47Z: identical |
| CATALOG | 15:20:31Z: exactly state 01. `redeem_enrollment_ticket(bytea, bytea, bytea, text)` with body `c024388886897f01a1154d8d12dc8996`, `postgres=EXECUTE,service_role=EXECUTE`, secdef, `search_path=public`, commented. Six tables: RLS on, 0 policies, grantees `postgres,service_role`, full privileges. `employees_id_store_uniq` = `UNIQUE (id, store_id)` | 13:35:58Z, 14:43:30Z: identical | 16:05:48Z: identical |
| R2COUNTS | 15:20:32Z: all six 0 | 13:35:58Z, 14:43:30Z: all 0 | 16:05:50Z: all 0 |
| CONSUMERS | 15:20:44Z: four 404 | 14:43:31Z: four 404 | 16:05:50Z: four 404 |
| TABLES-SNAPSHOT | 15:20:50Z: 20 tables, `ledgerVersion 20261009151706` | — | 16:22:40Z: the same, except `capturedAt`. Committed as `supabase/tables.json` |

**The other state:**
- **P0₀ (§E10) no longer describes production**, which has 21 ledger rows.
  Codex 4(c) requires a fresh baseline.
- **Repository:** 01 and its companion are recorded at
  `supabase/migrations/20261009151706_release2_01_identity_schema{,.rollback}.sql`,
  and the manifest records `productionVersion 20261009151706` (plan §E12).
  02–05 stay in `supabase/migrations/pending/`.
- **Supabase's GitHub integration, before any push** (Codex's question,
  2026-10-14). Ryan checked it on Wed 2026-10-14 at 12:40 EDT, read-only,
  with nothing clicked:
  - production `gmxyisjjaxtpycsmmzef` → Project Settings → Integrations:
    GitHub not connected, only "Connect GitHub"; Vercel not installed;
  - staging `lboajqihpsfrokqvjgnl` → Project Settings → Integrations:
    GitHub not connected, only "Connect GitHub"; Vercel not installed.

  The earlier record held only production's 2026-10-08 check (plan §E11).
  Staging had not been checked before 2026-10-14.

## 9. Ryan's answers recorded after the first draft (2026-10-14)

- **How P2-01 got into window R:** "I don't remember how P2-01 got into
  window R".
- **The temporary token `stage0-verify-read-20261012`:** "I created
  stage0-verify-read-20261012 on Monday 12 Oct and pasted it into a shell
  only on Tuesday, just before the STATE send. It was never loaded in a
  shell overnight." §6 is corrected to match.

---

## Appendix A — Codex's incident review, 12 October 2026 (verbatim)

# Release 2 stage 0 incident review — 12 October 2026

Reviewed source: cleared head 7181b42ce4cfe891ea0aa4a1f9adc70e29797d8e. Production: gmxyisjjaxtpycsmmzef. Ryan confirms the counter has remained closed since Friday's incident.

Evidence limit: these incident timestamps, responses and production read-backs are Ryan/Claude's reported evidence. I have not located the named execution-record attachment or raw PowerShell output and have not queried production. I independently checked the assembler, sender, record tool and runbook. The reopening clearance below requires checking the original sender receipts; it does not claim that I inspected them.

## 1. Counter — ACCEPT, conditional reopening clearance

The counter may reopen at verified state 01 after the checks below pass. Completing stage 0 is not a prerequisite. This is the separate incident decision required by §A.0; it does not authorize another migration or rollback.

The reason is specific to this incident. forwardWrapper checks for an existing release2_01_identity_schema ledger row before `execute f`, where the migration begins. P1 also contains this wrapper. Send 2 was reported to have reached precisely that pre-migration guard and returned its refusal. A later execution of the same pinned duplicate would encounter the same committed marker and refuse before migration work. Preserve that marker. Three days elapsed and zero current locks are supporting observations, not an API admission-time guarantee.

Ryan/Claude must record all of the following before opening:

- Original receipts bind both sends to production and the pinned P2-01 text: request MD5 b680442d19f25aca0ede5fdf32542207, 25,194 bytes. Send 1 has the complete expected success response with no sender error; Send 2 has the complete reported PostgreSQL guard refusal with no sender error. Account for every other writing send: there must be no additional unresolved request.
- Fresh read-only STATE, ledger and catalog checks agree on 01, with forward ledger version 20261009151706, expected stored migration bytes, and no later migration or unexpected change. All six Release 2 tables remain empty; no stage-0 sessions or employee locks remain.
- The current client still uses the legacy paths, the four guarded endpoints remain dark, and no Release 2 consumer has been enabled.
- Delete/revoke both incident PATs, remove their shell values and close both old windows. Record revocation or already-expired status; clearing a shell alone is insufficient. Delete any temporary verification PAT after its use too.
- Legacy PIN sign-in, a real authorized smoke order, and the existing queue workflow pass. Record Ryan's explicit reopening decision and time. If a check fails or contradicts the reported incident, keep the counter closed and return for incident review.

This clearance is independent of the expired migration window and the expired P1 rehearsal. There is no clearance to continue P2 today.

## 2. Send 2 and rule 3 — AMEND

On the complete response as reported, classify Send 2 in the incident disposition as RESOLVED SQL guard refusal, with no second application of 01. Retain the historical fact that §0.7's existing classifier labelled it UNRESOLVED; do not rewrite that history. The original receipt must confirm the completeness and absence of a sender transport error before this reclassification is final.

The single-line regular expression was a defect in the rule I accepted. I should have required a real DO-block guard response containing CONTEXT as a fixture. PostgreSQL provides context separately from its primary error message; its presence does not make a complete refusal an uncertain transport outcome. (PostgreSQL error fields: https://www.postgresql.org/docs/17/protocol-error-fields.html)

Fix the classification to recognize the complete API error envelope, a valid anchored PostgreSQL primary error with SQLSTATE, and its supported diagnostic continuation fields, including CONTEXT. Preserve precedence for sender errors, missing/unreadable receipts and incomplete bodies. Do not replace the rule with a substring search for ERROR or unrestricted multiline matching.

Required fixtures: this exact P0001 response, representative real guard responses, a transport error despite HTTP 201, truncated responses, an unexpected success body, and gateway/HTML text merely quoting an SQL error. The implementation and tests need review before another production window. This is blocking for a new window, not for the conditional incident reopening above.

## 3. Read-token capability — AMEND, blocking before relying on the split again

The read token reached a guard in a request without read_only. That proves route access, not either permission to write or enforced refusal of writes. Supabase documents the query route as available to fine-grained database_read or database_write permissions, with an optional read_only field. (Management API query contract: https://supabase.com/docs/reference/api/v1-run-a-query)

Require a reviewed staging negative-capability experiment using a disposable fixture and project-scoped tokens: the read token attempts a bounded write through the same route without read_only; the write token supplies the positive control. Verify the fixture directly afterward rather than inferring permission from HTTP status. Separately verify the read-only request path and its database transaction/role behavior. Do not use a migration guard as the test: it can refuse before permissions are exercised. No permission experiment on production is authorized here.

If the read token can write, document that result and stop describing the PAT split as a server-enforced write boundary. A sender's R/W label is a useful local mistake barrier, not token authorization. The revised production protocol must then establish an adequate read-only execution boundary and be reviewed.

## 4. Migration path

(a) ACCEPT now: remain at 01, reopen conditionally as above, and prepare a later reviewed window. No database write is needed to wait.

(b) REJECT as stated, blocking: RB-1 appends a rollback record and preserves the original forward ledger row. Both the existing P1 and P2-01 refuse whenever that forward name exists, including after rollback. Therefore RB-1 → P0 → existing P1 → existing P2-01…05 cannot complete with only the currently reviewed texts. The ledger baseline also changes. The record tool expressly rejects a forward step after rollback records exist. Do not delete history or silently bypass these guards to make the sequence work. A rollback/reapplication path would require new reviewed SQL and a reviewed record lifecycle.

(c) AMEND; preferred proposal for review, still blocking execution: prepare a rehearsal that starts from the actual committed 01 state and verifies the remaining forward steps and the recovery states they can leave. It must preserve 01's ledger identity, establish a fresh baseline, cover rollback behavior without committing rehearsal changes, and use newly pinned sender texts. Review the rehearsal, recovery mapping, revised runbook and resulting exact head before clearing a new window. Thursday's P1 cannot authorize continuation now.

## 5. Repository record — ACCEPT recording 01 now

Record what production actually did before scheduling more work. First verify the original receipts and the ledger's stored migration bytes, then record 01 at 20261009151706, capture the current table snapshot at that ledger version, update the manifest and run the record-state checks. Preserve the out-of-window chronology, the duplicate send, the open token windows and the eventual reopening evidence in the incident record.

Do not hold the repository in the pending state because a later rollback is contemplated. If a reviewed rollback later occurs, append its own record and snapshot while retaining the forward history. A repository record does not authorize deploying or applying anything. The next production window needs clearance at its actual new head.

## 6. Process corrections — ACCEPT in principle; implementation review blocks a new window

1. Every pause ends the session. Before stepping away or ending the cleared window, run token cleanup and close both windows. Resumption requires fresh setup and clearance; do not retain loaded production tokens overnight.
2. Enforce writing deadlines in the sender. Bind clearance to the exact head, production ref, named text and absolute timestamp with timezone. Refuse a missing, invalid or expired deadline immediately before the network send, with no request issued. The sender deadline governs admission; it does not cancel work already submitted.
3. Require the W setup marker for writing texts. R refuses P1/P2/RB texts before a request. Also bind each go to its specific next text, so a command intended to run STATE cannot inherit permission to run P2-01. A stale W marker must not survive a new session or expired clearance. These checks supplement byte/ref pins and do not prove PAT permissions.
4. Fix and test the SQL-error classifier as item 2 specifies. Unknown outcomes still prohibit retry or automatic recovery.

Tests must demonstrate refusal without any network call for expired/missing deadlines, R-window writes, wrong text, wrong head/ref and stale session setup. Include exact deadline-boundary tests and the real refusal receipt. Successful tests do not retrospectively authorize Friday's late write.

The incident contains both a classification defect and departures from the cleared procedure: the late production write, skipped cleanup and wrong command in R. Fixing the classifier alone does not address those departures. No new production migration window is cleared by this review.
