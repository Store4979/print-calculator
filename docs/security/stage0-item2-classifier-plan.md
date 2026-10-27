# Stage 0 — Codex item 2: the SQL-error classifier (rule 3′) — PLAN for review

**Status: IMPLEMENTED LOCALLY, for Codex's review (§10).** The plan was
reviewed by Codex on 2026-10-15: AMEND, direction accepted. Its rulings are
folded in below (§0 lists them).
- **CS was accepted at I `c75d1d7`** (Codex, 2026-10-20), which cleared
  the implementation as local work.
- **The push of the implementation is not cleared.**
- **The capture session has its own runbook,**
  `docs/security/stage0-item2-capture-runbook.md`, a DRAFT for Codex.
- **No database work runs under this plan.** The staging capture session
  (§6) is held until its own runbook, its exact probe pins and its
  executable stop rules have been reviewed by Codex. It runs on staging
  only.
- **No production send of any kind** is part of it.

Source: Codex's incident review, 2026-10-12, §2 and §6.4
(`docs/security/stage0-incident-2026-10-09.md`, Appendix A). Codex's plan
review: `reviews/2026-10-15-cs-and-item2-plan-review.md` (Codex's
workspace).

## 0. Codex's rulings (2026-10-15)

| # | question | ruling | where it is folded in |
|---|---|---|---|
| 1 | FATAL | **ACCEPT conditionally.** Only a complete, bound, captured PostgreSQL envelope, under an accepted status and the supported grammar, is recognized. A connection error or any other body stays UNRESOLVED. **Recognition is not permission to retry, not proof of an unchanged prefix, and not automatic recovery** | §3 R3 |
| 2 | Observed statuses | **ACCEPT.** Start with 400; extend only with reviewed captures and fixtures. An unknown status stays UNRESOLVED. An HTTP status alone proves no SQL outcome | §3 R3 |
| 3 | `ENVELOPE-PROBE-1…5` | **ACCEPT as designs, not as send clearance.** Implement and pin them after CS. Their exact texts, send policies and the capture runbook are reviewed before any send. **Each capture must show that the intended SQLSTATE and path were reached**: a permission refusal is not evidence for the nested-EXECUTE or DETAIL envelope | §6 |
| 4 | `SQL statement` frames | **AMEND.** Matching against the bound receipt's finite executed inputs is the right bound. Match a **complete known candidate, in its captured rendering, before** reading any closing quote or frame boundary. "The first quote followed by a PL/pgSQL-looking line" is not a delimiter, because that sequence can occur inside pinned SQL. Unknown statements or renderings stay UNRESOLVED; receipts are never normalized, and no execution-provenance proxy is invented | §3, the envelope parser |
| 5 | One sitting for items 2 and 3 | **Two sessions.** Item 2's captures and classifier, then item 6's sender controls, then item 3's experiment. Item 3 is not pulled forward to reuse loaded tokens. Every pause still ends the session | §6 |
| 6 | Where the success predicates live | **In the classifier module, with binding tests.** Exact send-policy coverage is required. The classifier and its local policy dependencies are bound (pinned) when the sender starts relying on them, in item 6. Expected digest and shape constants stay tied to reviewed SQL and receipts | §3 R2, §4 |

**Further corrections, required before implementation or capture
acceptance:**
- **The receipt contract** is the sender's real schema: 14 mandatory
  fields, with types, plus the conditional `cancelTemplate`. The endpoint
  and project are bound too (§3 R1).
- **Cancel instances have their own binding path** (§3 R1).
- **Duplicate JSON keys** are parsed defensively. A duplicate-key receipt
  or envelope is a negative fixture, never a trusted result (§3 R1, R3).
- **Success is not acceptance.** P0 and STATE get field-type and
  nested-shape checks. The classifier separates "the SQL executed" from the
  runbook's semantic acceptance, and never presents R2 as clearance (§3 R2).
- **Predicates come from reviewed SQL result contracts and existing
  receipts.** An unsupported text returns UNRESOLVED. There is no
  permissive "any 201" placeholder (§3 R2).
- **How the still-pinned sender's exit code is consumed until item 6** is
  stated: a sender exit 0 is not a classification and not a go (§4).
- **The capture runbook has pre-declared expected outcomes and stop points**
  (§6).
  - An UNRESOLVED writing send stops all later writes, including automatic
    cleanup and retry. A disposable schema is no exemption.
  - Each phase has its own go, timing, receipt preservation and token
    cleanup.
- **The grammar is an evidence-backed supported subset.** Its frame tokens
  and lengths are explicit, and the parser's input and work are bounded.
  Unsupported complete variants stay UNRESOLVED, and the incident's
  historical classification is kept. Real captures are read as exact
  receipts, never retyped (§3, §5).

---

## 1. What Codex required

- **Recognize** the complete API error envelope: a valid, anchored
  PostgreSQL primary error with SQLSTATE, and its supported diagnostic
  continuation fields, CONTEXT included.
- **Preserve the precedence** for sender errors, missing or unreadable
  receipts, and incomplete bodies. Unknown outcomes still prohibit retry or
  automatic recovery (§6.4).
- **Never** a substring search for ERROR, and **never** unrestricted
  multiline matching.
- **The fixtures:**
  - the exact P0001 response;
  - representative real guard responses;
  - a transport error despite HTTP 201;
  - truncated responses;
  - an unexpected success body;
  - gateway/HTML text merely quoting an SQL error.
- **Review:** the implementation and tests are reviewed before another
  production window. Item 2 blocks a new window, not the re-opening (done).

## 2. What exists today (at `76883c6`)

- **Rule 3 is prose only** (runbook §0.7; CLAUDE.md). Every classification
  so far was made by hand by the session, with ad-hoc checkers kept outside
  the repo.
- **What the sender writes** (`scripts/manual/stage0-send.mjs`). Its results
  record carries:
  - `tool`, `text`, `target`, `ref`, `readOnly`, `requestMd5`,
    `requestBytes`, `endpoint`;
  - for a cancel, `cancelTemplate`;
  - `startedAt`, `finishedAt`, `httpStatus`;
  - `body`: the raw response text from `res.text()`, with the token scrubbed;
  - `error`: any transport exception;
  - `tokenRedactedFromResponse`.
- **What the sender does not do:**
  - it records **no response headers**, so `content-type` is unknown to any
    classifier;
  - it classifies nothing;
  - it exits 0 on any 201.
- **The sender is pinned by blob** (`manifest.sender`, checked by
  `selfCheck`). Importing a classifier into it is a pin change, and belongs
  to item 6.
- **One real SQL-error envelope has been seen through the sender**
  (production, 2026-10-09, P2-01 send 2): HTTP **400**; the body a JSON
  object whose only key is `message`:
  - `Failed to run sql query: ERROR:  P0001: stage0 P2-01: release2_01_identity_schema is already in the ledger\n`
  - `CONTEXT:  PL/pgSQL function inline_code_block line 312 at RAISE\n`
- **The guards' own fields.** All 363 `raise exception` sites in the nine
  writing texts use only `errcode`: no DETAIL, HINT or MESSAGE. A guard
  refusal therefore carries a primary line and CONTEXT only.
- **Errors that PostgreSQL itself raises carry more:**
  - lock timeout (55P03), statement timeout (57014), cancel (57014) and DDL
    failures can carry DETAIL, HINT or CONTEXT;
  - **FATAL 25P04** (transaction timeout) ends the session (plan §E8, N5 2b).
- **Where errors surface:**
  - **P2 and RB wrappers have NO exception handler.** An error inside
    `execute f` reaches the API raw, with a **nested, multi-line CONTEXT**:
    a `SQL statement "…"` frame quoting the executed text, then
    `PL/pgSQL function inline_code_block line N at EXECUTE`. A 55P03 on
    `employees` during P2-01 would look like this. It is the likeliest real
    refusal, and it has never been observed.
  - **P1** has one handler.
  - **The `LOCKPROBE-*` texts** (staging-only, pinned) catch every error
    and re-raise it with its SQLSTATE, the elapsed ms and the pid.

## 3. Rule 3′ — the proposed classification, in precedence order

The **receipt** is the results file, never a paste.

**R1 — UNRESOLVED: receipt integrity and binding.** Any one of these:
- the file is missing, unreadable, or not exactly one JSON object;
- **a duplicate key anywhere in the file.** The file is scanned for
  duplicate object keys before `JSON.parse`, because `JSON.parse` keeps
  the last duplicate silently. A duplicate-key receipt is a negative
  fixture;
- **the key set is not exactly the sender's schema.** The 14 mandatory
  fields, plus `cancelTemplate` exactly when the text is a cancel, and no
  other key:

  | field | type and rule |
  |---|---|
  | `tool` | string, equal to `scripts/manual/stage0-send.mjs` |
  | `text` | string, a text in the manifest's send policy |
  | `target` | string, a target the policy allows for that text |
  | `ref` | string, equal to `send.targets[target]` |
  | `readOnly` | boolean, equal to the policy's `readOnly` |
  | `requestMd5` | 32 lowercase hex characters |
  | `requestBytes` | a positive integer |
  | `endpoint` | string, equal to `send.endpoint` with `{ref}` replaced by `ref` |
  | `startedAt`, `finishedAt` | strings in the exact form `YYYY-MM-DDTHH:MM:SS.sssZ` (what `toISOString()` writes), with `finishedAt` ≥ `startedAt` |
  | `httpStatus` | an integer, or null (no response) |
  | `body` | a string, or null |
  | `error` | a string, or null |
  | `tokenRedactedFromResponse` | boolean |
  | `cancelTemplate` (cancel only) | an object with exactly `md5`, `bytes`, `step`, `backendStart` |

- `error` is not null;
- `body` is not a string;
- `tokenRedactedFromResponse` is not `false`. That is also an immediate STOP
  and a token deletion;
- **the receipt does not bind** to the pinned text:
  - **an ordinary text:** `requestMd5` and `requestBytes` must equal
    `outputs[text]`;
  - **a cancel instance has its own path.** Its request is the
    instantiated SQL, not the template, so the checks are:
    - `cancelTemplate.md5` and `.bytes` equal
      `outputs["CANCEL-STEP-TEMPLATE"]`;
    - `step` is one of the assembler's `CANCEL_TARGETS`;
    - `backendStart` matches `BACKEND_START_RE`;
    - the request is rebuilt with the reviewed assembler's
      `cancelStepText(template, step, backendStart)`, and its md5 and byte
      count equal the receipt's `requestMd5` and `requestBytes`.

  The manifest is read at a named commit, by default HEAD; the record pins
  do not change outputs. This is Codex §1's "receipts bind … to the pinned
  text", made mechanical.

**R2 — RESOLVED success: the SQL executed and returned its contracted
shape.** `httpStatus === 201` **and** the text's own success predicate holds
**exactly**. The body is parsed with the same duplicate-key check as the
receipt.

| text(s) | success predicate |
|---|---|
| P2-01, P2-02, P2-0304, P2-05, RB-5, RB-43, RB-2, RB-1 | `body === '[{"set_config":"45s"}]'` |
| P1 | A JSON array of exactly 45 objects, each with exactly the keys `n` (a string, such as `"E1"`; corrected from "an integer" against the receipt, §10) and `what` (a string). Sorted by `n`, the `n\twhat\n` lines have md5 `5983d4a7f104692cc90e0004da21efa9` (plan §E11, §5.3), which fixes every id and label |
| P0 | A JSON array of exactly one object with exactly the 26 named columns, **each of its contracted JSON type**, nested values included. The types come from the reviewed P0 SQL and the three held P0 receipts |
| STATE | A JSON array of exactly one object with exactly `effective_prefix`, `ledger_md5_ok`, `catalog_state`, `ledger_rows`, `recovery`. Each has its contracted type and nested shape (`ledger_md5_ok` a boolean; `ledger_rows` exactly its reviewed nested keys), taken from the reviewed STATE SQL and the two held STATE receipts |
| SIZE-PROBE | Its §E9 shape, read from the receipt of 2026-10-07 |
| CANCEL-INSPECT, CANCEL-STEP, `LOCKPROBE-*`, `ENVELOPE-PROBE-*` | **Explicitly unsupported until** each has a predicate taken from its reviewed SQL result contract and a reviewed receipt (§6). Until then a 201 is R4, UNRESOLVED. No permissive "any 201" placeholder, and no predicate weakened to get a first capture through |

- **R2 is not acceptance and not clearance.** It says the request executed
  and returned the contracted shape, nothing more.
  - **The runbook's semantic checks stay separate.** A STATE whose
    `ledger_md5_ok` is `false`, or whose prefix or catalog state is not
    the expected one, is R2 and **still stops advancement**.
  - For P0 and STATE, the module also exports a separate pure function,
    `readbackAcceptance(text, values, expected)`. It returns
    `ACCEPT` / `STOP` with its reasons, and the classifier's own output
    never includes a go.
- **Where the predicates live (Codex Q6):** in the classifier module, keyed
  by text name.
  - A binding test fails if any text in `manifest.send.texts` has no
    predicate or explicit "unsupported" entry, or if the module names a
    text the policy does not have. Coverage is exact both ways.
  - The digest and shape constants cite the reviewed SQL and receipts they
    come from.
  - Binding the module and its local policy dependencies into the pins is
    item 6, when the sender starts relying on them.

**R3 — RESOLVED SQL error.** All three of these:
1. `httpStatus` is in the **observed set**: `{400}` today (Codex Q2). Any
   status is added only from a reviewed capture with its fixture, and a
   valid envelope under any other status is R4. A status alone proves no
   SQL outcome;
2. `body` has **no duplicate key** (scanned before parsing) and parses as
   JSON to a plain object whose own keys are **exactly** `["message"]`,
   with a string value *m*;
3. *m* is accepted by the **envelope parser** below.

**FATAL (Codex Q1, accepted conditionally).** `FATAL` is recognized only
in a complete, bound, captured envelope under an accepted status and the
supported grammar. A connection error, or any other body, stays
UNRESOLVED. **Recognizing a FATAL is not permission to retry, not proof of
an unchanged prefix, and not an automatic recovery.**

**The envelope parser.** It reads *m* left to right, with no regex over
the whole string:

```text
m        := "Failed to run sql query: " primary fields
primary  := severity ":  " sqlstate ": " text "\n"
severity := "ERROR" | "FATAL"
sqlstate := 5 characters of [0-9A-Z]
text     := ≥1 characters, none of them "\n"
fields   := [DETAIL] [HINT] [QUERY] [CONTEXT]                    -- this order, each at most once
DETAIL   := "DETAIL:  " text "\n"
HINT     := "HINT:  " text "\n"
QUERY    := (only if §6 captures one; until then not accepted)
CONTEXT  := "CONTEXT:  " frame ("\n" frame)* "\n"
frame    := plpgsql | sqlstmt | (another kind ONLY if §6 captures it)
plpgsql  := "PL/pgSQL function " fname " line " digits " at " STMT
sqlstmt  := "SQL statement \"" sqltext "\""
```

- **`sqltext`: candidates first, never a delimiter search (Codex Q4).**
  - The candidates are the **finite set of executed inputs** of the
    receipt's bound text. For P2/RB, that is the embedded file `f` (or
    `f1`, `f2`). The parser takes their bytes from the assembler, by the
    bound `requestMd5`.
  - At the offset just after `SQL statement "`, the parser tries each
    complete candidate, **in its captured rendering**. It accepts one only
    if `m` continues with exactly that rendering followed by `"\n`.
  - It never looks for "the first `"` followed by a PL/pgSQL-looking
    line": that sequence can occur inside pinned SQL.
  - The rendering of a statement inside `SQL statement "…"` (verbatim,
    truncated, or with escaped quotes) is a **capture question**. Until
    §6's B2 capture shows it, no rendering is supported, and a `sqlstmt`
    frame is R4.
  - Unknown statements or renderings stay UNRESOLVED. Receipts are never
    normalized, and no execution-provenance proxy is invented.
- **The supported frame tokens are explicit.**
  - `fname` is `inline_code_block`, or a function name from the bound
    text's reviewed SQL.
  - `digits` is 1–6 decimal digits.
  - `STMT` is one of a fixed list taken from captures (`RAISE`,
    `EXECUTE`, …).
  - Everything else is R4.
- **Bounds.** The parser's work is linear in `m`.
  - `m` is refused (R4) above a fixed byte limit: the largest executed
    input of the bound text (0 when it has none) plus 64 KiB of envelope.
  - At most 16 frames, and each `text` at most 8 KiB.
- **Nothing may be left over** after the last field.
- **A supported subset, not a guarantee.** The grammar is an
  evidence-backed subset of PostgreSQL's error output, and it does not
  claim to recognize every possible error. A complete but unsupported
  variant stays UNRESOLVED. The incident's historical classification of
  send 2 (UNRESOLVED under §0.7 as written) is kept as history.
- **These cases are not recognized and fall to R4:**
  - a field out of order;
  - an unknown label;
  - an empty `text`;
  - a frame of an unknown kind;
  - a `sqltext` that is not a pinned input.
- **What is still hypothesis.** The DETAIL/HINT single-line form, the field
  order, the frame forms and the trailing `\n` after a field-less primary
  line are **hypotheses**. §6's captures confirm or correct each one, and
  the implementation follows the captures. **Anything not captured is not
  accepted.**

**R4 — UNRESOLVED:** everything else. That includes:
- a 201 with any other body;
- any status outside the observed set;
- gateway or HTML text, even when it quotes a valid *m*;
- JSON with any other key.

**The classifier's output:**
- `{class, reasons[], sqlError?}`, where `sqlError = {severity, sqlstate,
  primary, detail?, hint?, context: [frames]}`.
- It carries **no** retry or recovery suggestion. An UNRESOLVED writing send
  still goes to runbook §A.0.

**FATAL and the observed-status rule** were the two questions here. Codex
answered both (§0, Q1 and Q2), and R3 above carries the answers.

## 4. Implementation

- **`scripts/manual/stage0-classify.mjs`.** It holds the pure functions
  `classifyRecord(record, { manifest, assembled })` and
  `parseEnvelope(message, { pinnedInputs })`. Its CLI is
  `node scripts/manual/stage0-classify.mjs <results file>…`, which prints
  one line per file: the class, text, target, status, and either the
  `sqlstate` with the primary line, or the reasons. It makes no network
  call, no database call and no write.
- **Not imported by the sender** in item 2. The sender stays at its pinned
  blob. Wiring the classifier into the sender's output and exit code, and
  re-pinning, is **item 6**.
- **Until item 6, the two are consumed like this:**
  - **The sender still exits 0 on any 201 and 1 otherwise.** That exit
    code is a transport fact only. **It is not a classification, and it is
    not a go for the next step.**
  - **The classifier CLI runs on every results file before anything
    follows it.** That includes the next send, a cleanup and a token
    deletion step. Its class, plus the runbook's semantic acceptance where
    one applies, decides the next step. It replaces the session's ad-hoc
    checkers.
- **The body is never normalized.** Results files are UTF-8 with LF, and the
  body is the server's text as `res.text()` returned it. The CRLF lesson
  applies to the repo's files, not to receipts.
- **Comments describe behaviour only** (the comment discipline).
- **Docs, in the same change:**
  - the P1–P3 runbook's §0.7 rule 3 is marked superseded by the classifier.
    The runbook was executed and clears nothing further, so its history is
    kept;
  - plan §E1 points to the module;
  - CLAUDE.md's classification bullet is replaced;
  - the next runbook (item 4(c)) cites the classifier, not prose.

## 5. Fixtures and tests (`scripts/tests/stage0-classify.test.js`, in `yarn test`)

**Real, already held.** These are copied verbatim from `.stage0-send/` into
`scripts/tests/fixtures/stage0-classify/real/`. Each was checked to contain
no `sbp_` text and `tokenRedactedFromResponse false`; they hold only the
public project ref, timings and bodies.

| receipt | expected |
|---|---|
| P2-01 send 2 (production, 2026-10-09T15:17:50Z, 400) | **R3**: `ERROR`, `P0001`, primary "stage0 P2-01: release2_01_identity_schema is already in the ledger", one `plpgsql` frame (line 312, RAISE). **This is the exact P0001 response Codex names** |
| P2-01 send 1 (201) | R2 |
| P1 (2026-10-09T01:30:25Z) | R2: 45 rows, digest `5983d4a7…` |
| P0 ×3, STATE ×2 (production) | R2 |
| SIZE-PROBE (staging, 2026-10-07) | R2 |

**Real, to be captured on staging (§6).** They are added to `real/` with
their capture record. **The implementation is not offered for review
without them**, because Codex requires "representative real guard
responses".

**Synthetic.** These live in `synthetic/`, each with a one-line reason:

| family | cases | expected |
|---|---|---|
| Transport error despite 201 | Codex's `{httpStatus: 201, body: null, error: "TypeError: response body connection reset"}`; a 201 with the exact success body and `error` non-null | R1 |
| Truncated responses | **Every** proper prefix of the real P0001 body and of the real success body, generated in the test, not stored. The P0001 message with its trailing `\n` removed, and with its CONTEXT cut mid-frame | R4 |
| Unexpected success bodies | A 201 with `[]`; with `[{"set_config":"90s"}]`; with STATE's body under a P2 text; with the exact body plus a trailing `\n`; with P1's rows minus one | R4 |
| Gateway / HTML quoting an SQL error | A 502 HTML page containing the exact *m*. A 400 `{"error": m}`. A 400 `{"message": "proxy: " + m}`. A 400 `{"message": m, "code": 1}`. A 500 with a valid envelope. A 200 with a valid envelope | R4 |
| Grammar edges | Fields out of order; an unknown label (`NOTE:  `); one space after `ERROR:`; a lowercase SQLSTATE; a 4-character SQLSTATE; a `SQL statement` frame whose text is not a pinned input; junk after the last frame; a second primary line | R4 |
| Receipt binding | A wrong `requestMd5`; the right text with the wrong `ref`; a wrong `endpoint` or `tool`; `readOnly` flipped; a text not in the send policy; each mandatory field missing in turn; each field of the wrong type in turn; an extra key; a malformed or reversed timestamp pair; `tokenRedactedFromResponse: true` on an otherwise perfect R2 or R3 | R1 |
| Cancel binding | A real-shaped cancel instance (rebuilt with the assembler) whose `requestMd5` matches; then a wrong `step`, a malformed `backendStart`, a template md5 that is not the pin, and a `requestMd5` that matches the template rather than the instance; `cancelTemplate` on a non-cancel text, and missing on a cancel | R1, except the first (which reaches R2's "unsupported" rule, R4) |
| Duplicate keys | A receipt with two `body` keys; an envelope `{"message": m1, "message": m2}`; a P2 success body `[{"set_config":"45s","set_config":"45s"}]` | R1 for the receipt; R4 for the envelope and the body |
| Success is not acceptance | A STATE 201 with the exact shape and `ledger_md5_ok: false`; one with an unexpected `catalog_state`; a P0 201 with a column of the wrong JSON type | the first two R2 with `readbackAcceptance` STOP; the third R4 |

**Mutation companion.** For each parser constraint (the anchoring, the
two spaces, the SQLSTATE class, the field order, the frame kinds, the
pinned `sqltext`, the observed-status set), a mutant parser with that
constraint removed must misclassify at least one fixture. This proves the
fixtures constrain the parser. It is the same idea as the inventory's MUT
tests.

**History run.** The CLI over all 9 receipts in `.stage0-send/` reproduces
the dispositions already on record:
- send 2 gives R3 P0001, which matches Codex §2;
- every other receipt gives R2.

The output goes into the review packet.

## 6. The staging capture session (HELD: its own runbook goes to Codex first)

**What it is for:** real envelopes for every error shape a stage-0 text can
produce. **It runs on staging only** (`lboajqihpsfrokqvjgnl`), through the
sender, under Codex §6.1: tokens created just before and deleted right
after, and every pause ends the session.

**Held.** No staging send happens until Codex has reviewed three things:
- a separate capture runbook;
- the exact probe pins (texts, md5s and send policies, after CS);
- the executable stop rules below.

The tables in A and B are **designs** (Codex Q3: accepted as designs, not as
send clearance).

**Stop rules (Codex's corrections).** The capture runbook makes each of
these concrete:
- **Expected outcomes are declared before the run.**
  - Each step's runbook row names its expected class, and for a 201 its
    exact expected success shape. That shape is taken from the text's
    reviewed SQL result contract before the session, not learned from the
    capture.
  - **A step whose receipt does not match its declared outcome is a STOP.**
    That includes a first-time 201 shape and a new error envelope (R4). In
    particular A1's first success shape and A4's FATAL or transport outcome
    cannot be "accepted as they come": the sequence does not continue
    automatically past an unknown receipt.
- **An UNRESOLVED writing send stops every later write.** That includes
  `LOCKPROBE-CLEANUP`, any automatic cleanup and any retry.
  - Diagnostics are not clearance to resume, and a reviewed incident
    disposition may be required.
  - **A disposable schema is no exemption.**
- **Each phase (A, B) has its own go, timing, receipt preservation and
  token cleanup.** A phase's go names its exact texts and a deadline, and
  lapses with the session. Its results files are preserved before
  anything else runs. Its token is deleted at the phase's end, or at any
  stop.
- **Each capture must show that the intended SQLSTATE and path were
  reached.** A permission refusal, or any other SQLSTATE, is not evidence
  for the nested-EXECUTE or DETAIL envelope it was meant to produce. It is
  recorded as itself.
- **Receipts are read as exact files**, never as retyped terminal excerpts.

**A. Already pinned, no pin change: the N5 `LOCKPROBE-*` texts.** They
are staging-only, written with the P2 wrapper, and write only inside their
throwaway schema (M-6c). One window, with a staging **Read-Write** token, in
this order:

| # | text | expected outcome (from §E8) | what it gives |
|---|---|---|---|
| A1 | `LOCKPROBE-SETUP` | 201 | its success shape |
| A2 | `LOCKPROBE-B-LOCKTIMEOUT`, with **no holder** | a refusal, "no holder seen within 10 s …" | **a real guard refusal raised inside the wrapper's DO block**. Whether the probe's handler re-raises it is read from the capture |
| A3 | `LOCKPROBE-B-STMTTIMEOUT` | `57014` statement timeout, re-raised | a PostgreSQL-raised ERROR through PL/pgSQL |
| A4 | `LOCKPROBE-B-TXTIMEOUT` | **FATAL `25P04`**, which cannot be caught, so it is raw | **the API's FATAL envelope**: settles the FATAL question |
| A5 | `LOCKPROBE-B-POSITIVE` | 201; commits inside `stage0_lockprobe` only | its success shape |
| A6 | `LOCKPROBE-READBACK` | 201 | its shape, and the state after A2–A5 |
| A7 | `LOCKPROBE-CLEANUP` | 201; the schema dropped | its shape; nothing left behind |

- **Not part of this plan:** scenario 1 (55P03 with a holder) and 2c (a
  user cancel through `C-CANCEL`). Codex: they are not required to resolve
  the classifier. §E8's N5 record keeps its own status, "the pinned bytes
  ran" still open.

**B. New, a pin change: `ENVELOPE-PROBE-1…5`.** Five tiny texts,
staging-only and `read_only: true`, sent with a staging **Read** token. None
writes:

| # | text | expected | what it gives |
|---|---|---|---|
| B1 | `select 1/0;` | `22012`, no fields | the field-less form and its trailing `\n` |
| B2 | `do $$ begin execute E'select 1;\n-- line two\nselect 1/0;'; end $$;` | `22012` with CONTEXT `SQL statement "…multi-line…"` + `PL/pgSQL function inline_code_block line 1 at EXECUTE` | **P2's unhandled `execute f` shape**, which nothing else produces |
| B3 | `select '{'::json;` | `22P02` with DETAIL and CONTEXT (`JSON data, line 1: {`) | a built-in DETAIL, and a non-PL/pgSQL frame kind |
| B4 | `do $$ begin raise exception 'probe' using errcode = 'P0001', detail = 'd', hint = 'h'; end $$;` | DETAIL, HINT, CONTEXT | the field order |
| B5 | `select from from;` | `42601` with a position | how the API renders a position. Such a response stays R4 unless the capture shows a form the grammar can bound |

- **Where B2's frame goes.** B2's `sqltext` is the probe's own executed
  string. It becomes a pinned input of `ENVELOPE-PROBE-2`, so the
  pinned-input rule is tested on a real capture.
- **Every capture is classified twice:** by today's rule 3 (as history)
  and by the new classifier.
- **The capture record goes into plan §E** (a new subsection), with every
  results file.
- **Nothing runs on production.** The production-only texts are not sent
  anywhere.

**Not combined with item 3 (Codex Q5: two sessions).** The order is item 2's
captures and classifier, then item 6's sender controls, then item 3's
experiment. Item 3 is not pulled forward to reuse loaded tokens.

## 7. Order of work

Codex accepted **CS → 2 → 6 → 3 → 4(c)** (2026-10-15).
1. ~~Codex reviews this plan~~: done, AMEND, folded in (§0).
2. **CS is implemented and accepted by Codex first.** The
   `ENVELOPE-PROBE` checks rely on its SQL handling.
3. **The implementation commit** (local, not pushed) holds:
   - the module, the tests, and the synthetic and real-in-hand fixtures;
   - the `ENVELOPE-PROBE` pins (manifest and assembler outputs; the
     generator's `--check`), checked through CS's SQL view;
   - the docs.

   It is green on a clean clone (`yarn test`, `yarn build`).
4. **To Codex, before any send:** the capture runbook, the exact probe pins
   and the stop rules (§6).
5. **The §6 capture session**, only after that review and Ryan's go, on
   staging.
6. **The capture commit** holds the real fixtures, any grammar corrections
   they force, and the plan §E record. It is green.
7. **Codex reviews the implementation, the tests and the captures.** Until
   then no production window.

## 8. Out of scope

- **Item 6:** the sender prints the classifier's result and exits on it;
  `content-type` is recorded; the deadline, window marker and per-text go;
  re-pinning the sender.
- **Item 3:** the read-token negative-capability experiment.
- **Item 4(c):** a rehearsal from 01 and its runbook.

## 9. Questions for Codex — answered 2026-10-15

The six questions (FATAL; the observed-status rule; the five
`ENVELOPE-PROBE` designs; the `sqltext` bound; one sitting or two; where
the predicates live) are answered in §0 and folded into §3–§7.

## 10. The implementation (local, for review)

**What it consists of:**
- `scripts/manual/stage0-classify.mjs`, rule 3′:
  - `strictJson`, which refuses duplicate keys, deep nesting and oversize
    input;
  - `classifyText`, R1–R4;
  - `receiptProblems`, with the cancel path;
  - `SUCCESS`, `SUPPORT` and `OBSERVED_STATUSES`;
  - `parseEnvelope` and `readbackAcceptance`;
  - a CLI.
- `scripts/manual/stage0-capture.mjs`, the executable stop rules:
  - `STEPS` and `PHASES`;
  - `checkStep`, which gives MATCH, STOP-RECORD or STOP;
  - `nextStep`;
  - `pgMetaFormat`;
  - a CLI.
- **The assembler** gains `ENVELOPE-PROBE-1…5` and `executedInputs()`.
  - The manifest pins the five probes: staging only, `read_only`.
  - It re-pins the assembler.
  - No other output changes.
- **The manifest checks:** M-12 admits the probes to staging only, as
  `read_only`. **M-6d** checks they are marked STAGING ONLY and hold no write
  word.
- **The tests:** `scripts/tests/stage0-classify.test.js` (CL-1…18), the
  CS-4 M-6d control, SEND-3 and CS-5's input set.
- **The fixtures:**
  - the nine receipts, byte for byte, kept `-text` by `.gitattributes`;
  - the N5 `execute_sql` history.

**Corrections and decisions found while implementing, each for Codex:**
1. **P1's `n` is a string,** not an integer: `"E1"`, `"S0.1"`. The receipt
   is the contract, so the predicate follows it. The digest over the rows
   sorted by `n` is unchanged, `5983d4a7…`.
2. **The lock-probe successes are declared now.**
   - LOCKPROBE-SETUP, B-POSITIVE and CLEANUP get exact R2 bodies, and
     READBACK a typed shape. Each comes from its SQL result contract.
   - Codex asked for this: "define the supported expected successes before
     the run". Without it, A1's 201 would be an UNRESOLVED writing send, and
     the session would stop at its first step.
   - The other lock-probe texts, CANCEL-* and the probes stay unsupported
     for a 201.
3. **SUPPORT today is P2-01 send 2's form only:** `ERROR`, one `CONTEXT`
   frame, `PL/pgSQL function inline_code_block line N at RAISE`.
   - Not supported until the capture commit: a field-less envelope, DETAIL,
     HINT, QUERY, FATAL, a `SQL statement` frame, EXECUTE and PERFORM.
   - The grammar code for them is exercised under a test support object,
     and the mutation companion runs against it.
4. **The QUERY field can span lines.** The 42702 history message proves it,
   so the single-line `text` hypothesis is false for QUERY. QUERY stays
   unsupported, and that message is outside the grammar even with every
   element enabled.
5. **The capture session is split into B, A, T and U.** The runbook's §2
   says why: T2's FATAL would otherwise strand the cleanup.
6. **The declared outcomes rest on three things,** all attached or in the
   repository:
   - postgres-meta's error formatting (H-FMT), read from source;
   - PostgreSQL 17.5's own fields, from a review-only PGlite run;
   - the N5 `execute_sql` messages, copied exactly from the transcript.
   None of them is a sender receipt, so none extends SUPPORT.
7. **A PERFORM frame quotes PERFORM's own query** (`SELECT pg_sleep(30)`),
   which is not an `EXECUTE` input. Whether such queries join a text's
   candidates is a capture-commit question.
8. **M-6d's CS-4 control found a real gap.** In the strings-kept view, an
   E-string escape that runs into a word (`\ndelete`, `\x64elete`)
   hid the word. M-6d now decodes E-string escapes, and refuses a U&
   literal. A write assembled at run time (concatenation) is still not
   seen: the md5 pin and review are that control.
9. **The synthetic fixtures are generated in the test,** each case with its
   reason, rather than stored under `synthetic/`. The truncation family
   uses every proper prefix, as §5 asks.
10. **The CLIs' exit status:**
    - `stage0-classify.mjs`: 0 when everything is R2, 1 with an R3, 3 when
      anything is UNRESOLVED, 2 on usage;
    - `stage0-capture.mjs`: 0 on MATCH, otherwise 3.

    The classifier prints "A classification, not a go."

**Codex's review of K `df401b3` (2026-10-21): AMEND, two blockers,** and
rulings 1–8 accepted (`reviews/2026-10-21-df401b3-review.md`). L, on top of
K:
- **K-R1, totality.** A timestamp of the right form that parses to no time
  (`2026-13-09…`, `…T25:17…`) threw `RangeError` out of the R1 checks:
  - the CLI exited 1 with no line, the code for an R3;
  - the capture checker crashed instead of stopping.

  `isIso` now tests for a finite parsed time before `toISOString()`. Both
  forms, in both fields, are R1 through the library, the classify CLI
  (exit 3) and the capture checker (STOP), in CL-19; K throws on all four.
  As a safety net, an exception inside `classifyText` or `checkStep` is now
  R1 or STOP with its message, a tooling defect for review (CL-20).
- **K-R2, the operational substitute for item 6.**
  - Codex's six procedures are P1–P6 in the capture runbook's §4.
  - `nextStep()` now runs as a real gate: `stage0-capture.mjs --progress`
    (`progress()`) runs before every send. It re-checks the phase's results
    files in order, and requires each to be fresh and single-use against
    the go, the deadline and the time its command was issued. It names the
    one next step or the stop. It is read-only, and the go in chat stays
    the authority (CL-22, CL-23).
- **The STOP-RECORD wording.** It claims only that the message starts with
  the expected severity, SQLSTATE and primary text. The path and rendering
  stay unconfirmed, and such a receipt is never nested-frame evidence on its
  own (CL-21).

**The capture commit (local, for review).** Codex accepted L, and cleared
the capture at H = L. The capture ran B, A, T and U, and every receipt was
a MATCH (plan §E14). Codex's capture review
(`reviews/2026-10-23-capture-BAT-review.md`) accepted the receipts and gave
T2 its disposition. Its §2 accepted the direction below, within its bounds.
This commit holds the concrete code, fixtures and record for review.

**What changes:**
- **The fixtures.** The 15 receipts are copied byte for byte into `real/`
  (`-text`), so `REAL` has 24 entries. `CAPTURE` maps each step to its
  file, md5, class now and class at L.
- **SUPPORT,** each entry naming its sender witness:
  - FATAL (T2);
  - the field-less envelope (B1);
  - DETAIL (B4; B3 also) and HINT (B4), single-line, in order, each at most
    once;
  - the verbatim `SQL statement "…"` frame (B2);
  - EXECUTE (B2) and PERFORM (T2) as frame statements.

  `OBSERVED_STATUSES` stays exactly {400}, now witnessed by all eight
  capture errors as well. CL-3 requires every SUPPORT entry and PERFORM
  binding to name a receipt held in `real/`.
- **What stays out:**
  - QUERY;
  - a LINE position block. B3 and B5 show it, so it is recorded, not
    treated as impossible. It now has its own refusal reason;
  - a non-PL/pgSQL frame (B3's `JSON data`);
  - any other function name or statement kind;
  - any status but 400.
- **PERFORM's query (ruling 7, decided).** `PERFORM_QUERIES` binds
  `LOCKPROBE-B-TXTIMEOUT` → `SELECT pg_sleep(30)` explicitly:
  - `contextFor` refuses the context when an entry's source, `perform
    pg_sleep(30);`, is not in its pinned text exactly once;
  - the query is taken from T2's receipt, not derived from the source;
  - it is a candidate for that text only (CL-26);
  - P1, RB-43 and CANCEL-STEP-TEMPLATE also hold PERFORMs. They have no
    entry, so a frame quoting one is R4 until a reviewed entry and receipt
    exist.
- **A tightening, beyond the proposal, for review.** Candidates are typed
  `{sql, via}`:
  - a statement frame must be followed by the PL/pgSQL frame at its
    candidate's `via` (EXECUTE for an executed input, PERFORM for a PERFORM
    query);
  - an EXECUTE or PERFORM frame must follow such a statement frame;
  - a statement frame with nothing after it is refused.

  B2 and T2 show the pairs; nothing showed another order. Three new
  mutants prove each check load-bearing (CL-12).
- **Composition, as `95ecd65` had it: withdrawn.** In `95ecd65`, SUPPORT's
  elements composed: an envelope was R3 when each element was supported,
  even in a combination no receipt shows (a field-less FATAL; T2's frames
  under ERROR). Codex ruled that blocking (C-COMB), and N replaces it with
  five witnessed profiles. See below.
- **The assembler is unchanged,** so nothing is re-pinned, and every SQL
  output stays the same. The PERFORM binding lives in the classifier, which
  the manifest does not pin.
- **The capture checker:**
  - B1, B2, B4 and T2 now declare R3 (`classNow`);
  - T2's comment keeps L's R4 and why T stopped;
  - nothing else in the declarations changes.

  Under this SUPPORT, a phase T run completes after T2. U still needs a
  reviewed decision named. The rule that a writing send's UNRESOLVED MATCH
  ends its phase stays, tested with T2 as it was at L (CL-15).
- **The new tests:**
  - **CL-24:** each receipt is its step's MATCH with its class now. L's
    SUPPORT, run through this parser, gives each one the class recorded
    at L;
  - **CL-25:** the recorded gos, deadlines and issue times replay through
    the gate, NEXT at each step, then COMPLETE;
  - **CL-26:** the PERFORM binding and the pairing, on the real receipts.

**The history, kept apart.** At L, rule 3′ classified B1–B5 and T2 as R4,
and the records keep that output. Under this commit B1, B2, B4 and T2 are
R3, and B3 and B5 stay R4. T2's disposition as a resolved SQL failure is
Codex's reviewed human decision of 2026-10-23. It is not a rewrite of L's
output.

**Codex's review of `95ecd65` (2026-10-27): AMEND, one blocker, C-COMB**
(`reviews/2026-10-27-95ecd65-review.md`). Everything else was accepted:
- U's results, the fixtures, the records and the prompt fix;
- the pairing check;
- the push records riding along.

Codex confirmed point 4's PERFORM gap as item 4(c)'s scope (plan §I). The
push of `95ecd65` is held until N is reviewed.

**C-COMB.** Codex reproduced five R3s at `95ecd65` that no receipt
witnesses as a whole:
1. a field-less FATAL;
2. ERROR with T2's PERFORM pair;
3. FATAL with DETAIL and HINT added to T2's pair;
4. ERROR with DETAIL only and a RAISE frame;
5. ERROR with two RAISE frames.

**Commit N, on top of `95ecd65`:**
- **The profile set.** After the envelope parses, `matchProfile()` requires
  it to be exactly one of `PROFILES`. A profile binds the severity, the
  ordered fields and the ordered frames, frame count included, and names
  its witness. The list is written out, never generated from SUPPORT.

  | profile | severity | fields | frames | witness |
  |---|---|---|---|---|
  | field-less | ERROR | none | none | B1 |
  | re-raised | ERROR | CONTEXT | `inline_code_block` at RAISE | P2-01 send 2; A2; A3 |
  | detail/hint re-raised | ERROR | DETAIL, HINT, CONTEXT | `inline_code_block` at RAISE | B4 |
  | executed input | ERROR | CONTEXT | a bound EXECUTE input, then `inline_code_block` at EXECUTE | B2 |
  | transaction-timeout PERFORM | FATAL **25P04** | CONTEXT | `SELECT pg_sleep(30)`, under `LOCKPROBE-B-TXTIMEOUT` only, then `inline_code_block` at PERFORM | T2 |
- **What the profiles bind:**
  - the FATAL profile binds its SQLSTATE, its query and its text;
  - the ERROR profiles keep any SQLSTATE, primary text and line number
    within the parser's bounds. Nothing is normalized.
- **What stays independent.** SUPPORT, candidate matching and the typed
  pairing are still checked separately. A parse failure is reported as
  before, and a parsed envelope outside the profiles is R4: "supported
  elements in a combination no receipt shows". An R3 result now names its
  `profile`.
- **The tests:**
  - **CL-27:** every R3 fixture is its witness's profile, and the 24
    fixtures keep their classes. Fifteen named negatives are R4 through
    `classifyText` with otherwise bound receipts:
    - Codex's five;
    - FATAL under another SQLSTATE, re-raised, or as an executed input;
    - DETAIL/HINT with the EXECUTE pair, HINT only, or with no CONTEXT;
    - a RAISE after the EXECUTE pair;
    - T2's message under another text, both unbound and with the same
      PERFORM entry added there;
    - another bound PERFORM query under T2's own text;
  - **CL-28:** seven mutants each remove or broaden one part of the check:
    the whole check, the severity, the SQLSTATE, the fields, the exact
    frames, the PERFORM's text and the PERFORM's query. Each must make its
    named negative R3. CL-12's parser mutants (candidate-first, ambiguity,
    pairing) are unchanged;
  - **CL-10 and CL-26:** their composition expectations are replaced. CL-3
    requires each profile's witness to be a held receipt.
- **Unchanged:** the assembler, the manifest, every SQL text, and the
  receipts and their classes, at L and now.
