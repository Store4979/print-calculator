# Stage 0 — Codex item 6: the sender's guards — PLAN, amended and implemented

**Status: reviewed by Codex on 2026-10-27 (`reviews/2026-10-27-item6-plan-review.md`):
AMEND, with local implementation allowed.** §A below records the amendments
(SG-1 to SG-6, Q1–Q7) and how the implementation meets them. **Where §A and
§0–§9 differ, §A governs**; §0–§9 are kept as the plan Codex reviewed.
- **Order:** CS → 2 → **6** → 3 → 4(c). Item 2 is complete (Codex accepted
  N `9404ee5`, 2026-10-27).
- **Not authorized here:** a push, a send of any kind, a token, or any
  change to a database.

**Sources:**
- Codex's incident review of 2026-10-12, §6 ("Process corrections"):
  `reviews/2026-10-12-stage0-incident-review.md`, also Appendix A of
  `docs/security/stage0-incident-2026-10-09.md`;
- Codex's review of K `df401b3`, K-R2: `reviews/2026-10-21-df401b3-review.md`.
  It listed the six procedures (P1–P6 in the capture runbook) as "procedural
  substitutes for this specific staging session". Item 6 supplies the
  machine-enforced safeguards before later work relies on them;
- the incident record's chronology and departures
  (`docs/security/stage0-incident-2026-10-09.md` §2–§3).

## 0. What item 6 is for, and what it is not

**For:** making the sender itself refuse the incident's departures, before
any request is issued:
- **a late write.** P2-01 was sent 13 h 43 min after its clearance and
  12 h 02 min after the reserve end;
- **the wrong command in the wrong window.** P2-01 was sent from window R,
  in place of STATE, 45 s after send 1;
- **a stale setup.** The windows and tokens stayed loaded overnight, and
  nothing in the sender knew.

It also turns the capture runbook's manual substitutes (P1–P6) into checks
the sender enforces, for every later session.

**Not:**
- **Proof of a PAT's permissions.** That is item 3. A window role is a local
  mistake barrier, not token authorization (Codex §3).
- **A sandbox against deliberate bypass.** Someone could:
  - edit the files;
  - copy a text into another tool;
  - set the environment by hand.

  The md5 pins, review and the procedure remain the controls for that. These
  guards are a regression and mistake gate, like the inventory (CLAUDE.md).
- **Cancellation of submitted work.** The deadline governs admission only.
  A request already sent runs to its server-side end (Codex §6.2).
- **A classifier.** Rule 3′ stays the classifier; an UNRESOLVED writing
  outcome still holds every later write (UO-1).

## 1. Requirements

| id | requirement | source |
|---|---|---|
| G-R1 | A writing send needs a deadline bound to the exact head, the project ref, the named text and an absolute time with a timezone. It is refused when the deadline is missing, invalid or expired, immediately before the network send, and with no request issued | §6.2 |
| G-R2 | A writing text needs the W setup marker. Window R refuses P1, P2 and RB texts before any request | §6.3 |
| G-R3 | Each go is bound to its one specific next text, so a command intended for STATE cannot inherit permission to run P2-01 | §6.3 |
| G-R4 | A stale marker cannot survive a new session or an expired clearance | §6.3 |
| G-R5 | Tests show refusal **with no network call** for an expired or missing deadline, an R-window write, a wrong text, a wrong head or ref, and a stale session setup. They include exact deadline boundaries and the real refusal receipt | §6, last paragraph |
| G-R6 | These checks supplement the byte and ref pins. They do not prove PAT permissions | §6.3 |
| G-R7 | The deadline does not cancel work already submitted | §6.2 |
| G-R8 | One current command at a time, and only fresh, single-use authorization: a command from history, an earlier message or a retype cannot send | K-R2 2, 4 |
| G-R9 | Every pause is an exit, and nothing loaded survives it | §6.1; K-R2 5 |
| G-R10 | The exit code and banner are not authorization | K-R2 6 |

## 2. The sender today (`scripts/manual/stage0-send.mjs`, pinned)

**What it already checks, in order:**
1. this file and the assembler are the blobs the manifest at HEAD pins;
2. the named text assembles to the pinned md5 and bytes;
3. the send policy allows that text on that target, and `--confirm-ref`
   repeats the target's ref;
4. the token is in `SUPABASE_ACCESS_TOKEN` and is shaped `sbp_…`.

**What it does not know:**
- the time;
- which window it runs in;
- what was cleared, and for which step;
- whether the same command already ran.

The results file does not record the window or token either (incident §2:
"The results files … do not record which window or token sent them").

## 3. Design

### 3.1 Three pieces

| piece | made by | when | lives | binds |
|---|---|---|---|---|
| **window marker** (R, W or C) | `stage0-window.mjs open`, run by Ryan in the window after the token is loaded | once per window, per clearance | `.stage0-send/guard/window-<id>.json` (gitignored) | its role; the session; the token loaded; the head; the target and ref; the clearance's absolute end |
| **go** | `stage0-go.mjs`, run by the preparing session (Claude), after Ryan's go in chat and the step's checks | once per send | `.stage0-send/guard/go-<id>.json` | one text (and, for a cancel, its step and backend_start); the head; the target and ref; the window marker it is for; the time it was issued; an absolute deadline |
| **the send** | `stage0-send.mjs`, run by Ryan | once | the existing receipt in `.stage0-send/` | it consumes the go, and records the binding in the receipt (§3.8) |

### 3.2 Sessions: a marker cannot outlive its window (G-R4, G-R9)

- **The setup block** in each new window sets a random session nonce, and
  never prints it:

  ```powershell
  $env:STAGE0_SESSION = [guid]::NewGuid().ToString()
  ```

  It goes after the two `-AsSecureString` lines (P1–P3 runbook §0.5).
- **`stage0-window.mjs open --role W --target production --confirm-ref
  <ref> --head <40-hex> --until <UTC>`** refuses unless:
  - the nonce and the token are both present;
  - HEAD equals `--head`;
  - the ref matches the target;
  - `--until` is a valid absolute UTC time in the future.

  It then writes a marker holding:
  - the role, target, ref, head and `until`;
  - `createdAt`;
  - `sessionId`, which is sha256 of the nonce. The nonce itself is never
    written;
  - `tokenTag`, which is HMAC-SHA256(key = the nonce, message = the token).
    It is never printed.

  It prints only the marker id, the role, the head, the ref and `until`.
- **The sender** finds the marker whose `sessionId` is sha256 of this
  shell's `STAGE0_SESSION`. It refuses when there is none, or more than
  one, and when:
  - the marker's `tokenTag` is not the current token's;
  - its head is not HEAD;
  - its ref is not the target's;
  - its `until` has passed.
- **What this gives:**
  - **A new window** has no nonce, or a different one, so every earlier
    marker is dead.
  - **An expired clearance** kills its marker. The window that stayed open
    overnight (the incident) is refused the next morning.
  - **Loading a different token** into a marked window (the write token
    into R, say) breaks `tokenTag`.
- **`stage0-window.mjs close`** deletes this session's marker and its
  unconsumed gos. The runbook's close becomes:
  1. `close`;
  2. `Remove-Item Env:SUPABASE_ACCESS_TOKEN`;
  3. `exit`;
  4. delete the token in the dashboard.

  A skipped `close` leaves a file that no shell can match, and that expires
  at `until`.
- **This is not a security boundary.** Someone who copies the nonce into
  another shell defeats it. It stops the mistakes the incident made.

### 3.3 Window roles, per text (G-R2)

The send policy's `read_only` flag is not the role. CANCEL-INSPECT and
LOCKPROBE-READBACK are sent with `read_only` false, for metadata
visibility, and do not write. So each text gets an explicit, reviewed
`window` in the manifest's send policy. The SQL outputs and pins are
unchanged; M-12 checks the new field.

| window | texts | why |
|---|---|---|
| **R** | P0, STATE, SIZE-PROBE, ENVELOPE-PROBE-1…5 | read-only reads |
| **W** | P1, P2-01, P2-02, P2-0304, P2-05, RB-5, RB-43, RB-2, RB-1, LOCKPROBE-* (all ten) | write, or run inside a writing phase (READBACK in A and U) |
| **C** | CANCEL-INSPECT, CANCEL-STEP-TEMPLATE | the second caller, which cancels a stage-0 text in flight (plan §E8). It is a separate role, so neither R nor W can cancel by accident |

**The rule:** a role sends only the texts whose `window` is that role.
- R refuses every W and C text. That is Codex's "R refuses P1/P2/RB texts",
  made total.
- W refuses R texts. That is stricter than §6.3; question Q2.
- C refuses everything else.

### 3.4 The go: one text, one use (G-R3, G-R8)

**`stage0-go.mjs`** writes one go file for the step Claude is about to
issue, then prints the one send command. It refuses unless:
- exactly one live marker of the text's role exists in this checkout, and
  the go is bound to it;
- the text, target, ref and head match that marker;
- the go's `deadline` is valid, in the future, and **not later than the
  marker's `until`**;
- **no earlier receipt of this marker's session is an UNRESOLVED writing
  send.** That is UO-1, enforced: after one, no further go is written in
  that session;
- in a capture phase, the progression gate says NEXT for exactly this text.

**The go's contents:**
- `goId`, random;
- `markerId`;
- `text`, plus `cancel: {step, backendStart}` for a cancel;
- `target`, `ref` and `head`;
- `issuedAt`;
- `deadline`.

**The deadline is the step's latest start,** not the window's end. The
runbook's rule, that the whole remaining path must fit before the reserve's
end, sets it. The go records it; the sender enforces it.

**Who writes the go is question Q1.** I propose the preparing session, so
that two parties act:
- a go exists only because the session issued that step;
- the send happens only because Ryan ran it, in a marked window, with the
  token.

A send command from shell history, from an earlier message or retyped finds
no unconsumed go for its text and is refused (G-R8). That stops a pasted
P2-01 command in R twice over: by role, and by go.

**The alternative:** Ryan runs the go command. That is two commands per
step, and a history replay of both lines would recreate the go.

### 3.5 The sender's order of checks (G-R1…G-R5)

Everything below happens before any network call. Steps 1–3 exist today.
1. **The manifest pins** (`selfCheck`): the sender, the assembler, and the
   new guard module (§3.11).
2. **The plan** (`planSend`): the md5, bytes, policy, target and ref.
3. **`--confirm-ref`** equals the ref.
4. **The token** is present and shaped `sbp_…`.
5. **The session:**
   - `STAGE0_SESSION` is present, and there is exactly one marker for it;
   - the marker's `tokenTag` matches the token;
   - its role allows the text's `window`.
6. **The head:** HEAD is a commit that equals the marker's head and the
   go's head. Tracked files are clean (question Q4).
7. **The go:**
   - exactly one unconsumed go is bound to this marker;
   - its text, cancel arguments, target and ref equal this send's;
   - its head equals HEAD.

   A go for another text is refused, and so is a missing one.
8. **The time:**
   - the marker's `until` has not passed;
   - the go's `deadline` has not passed.
9. **The go is consumed.** An atomic rename to `go-<id>.used-<startedAt>.json`
   comes before the request. A crash after this point needs a new go: there
   is no retry (UO-1).
10. **The deadline is checked again,** immediately before `fetch`, with the
    same clock. Then the request is sent.

Any refusal exits 2 with its reason. It writes no receipt, because nothing
was sent. The dry run stays as it is: no marker or go is needed, and there
is no network.

### 3.6 Times (G-R1, G-R5)

- **The only accepted form** is `YYYY-MM-DDTHH:MM:SS[.sss]Z`, validated
  totally (K-R1): a form that parses to no time is invalid, never a throw.
  - Eastern times stay in the human go.
  - The drafted-go rule (capture runbook §3) carries both times. The tools
    take only the UTC one.
- **The boundary is exclusive.** A send is admitted only when
  `now < deadline`. At exactly the deadline it is refused.
- **The clock is the machine's,** injectable in tests. Admission happens
  before any network call, so no server time is available to check it
  against.
  - Proposal: the setup block runs `w32tm /query /status`, and Ryan
    reports the last successful sync (question Q5).
  - The receipt keeps `startedAt` and `finishedAt` as today.

### 3.7 The head (G-R1)

- HEAD's full 40-hex commit must equal both the marker's head and the go's.
- The manifest is still read at HEAD, as today. A clearance therefore names
  one exact commit, and a checkout moved after setup refuses.

### 3.8 The receipt records the binding (evidence)

The receipt gains one optional key, `guard`:
- `goId` and `markerId`;
- `role`;
- `head`;
- `issuedAt` and `deadline`.

**What follows from it:**
- **The classifier's R1** accepts it only in that exact shape, validated
  totally, and the pre-guard receipts without it stay valid. So the 24
  fixtures are unchanged.
- **The capture gate** then reads `issuedAt` from the receipt, instead of
  from a time Claude records by hand.
- **The receipt says which window sent it,** which the incident record
  could not establish.

Question Q3.

### 3.9 The banner (G-R10)

The sender's "a writing text: read back before the next step …" line
becomes: "This exit code is a transport fact, not a go. The next step needs
its own go."

### 3.10 What stays the same

- The dry run.
- The cancel instantiation.
- The redaction and the token handling.
- The endpoint and the request body.
- The receipt's 14 keys. `guard` is a 15th, optional key.

### 3.11 Pins (no SQL change)

- **A new module, `scripts/manual/stage0-guard.mjs`,** holds the marker,
  go and time logic. `stage0-window.mjs`, `stage0-go.mjs` and the sender
  all import it.
- **The manifest** pins it, as it pins the sender and the assembler.
  `selfCheck` refuses a mismatch. The CLIs are pinned too, or they live
  inside the guard module (question Q6).
- **The manifest is regenerated** after staging (A3), with:
  - the sender's new blob;
  - the guard module's blob;
  - `window` in the send policy.

  **Every SQL output, the assembler and the probe texts are unchanged.**
  M-12 and the manifest checks prove it, and the 14-state replay runs at the
  new head.

## 4. The incident, replayed against these guards

At the real times (incident §2), each departure meets a refusal before any
request:

| what happened | the guard that refuses it |
|---|---|
| P2-01 cleared at Fri 01:34:14Z, with latest start 02:20Z and reserve end 03:15Z. Send 1 from W at 15:17:05.343Z | §3.5 step 8: the go's `deadline` (02:20Z) had passed by 12 h 57 min. The marker's `until` (03:15Z) had too |
| Send 2: P2-01 from window R at 15:17:50.900Z, in place of STATE | step 5: R's role refuses a W text. Step 7: R's only go was STATE's, if one had been written. Step 8: both deadlines had passed |
| The windows and tokens stayed loaded overnight | §3.2: each marker died at its `until`. A reopened window would have no nonce |
| "Run these back to back": W's P2-01, then R's STATE | §3.4: one go per text, per marker. The two windows cannot share a go |

**A test (G-12) replays these times and windows** through the real sender
with a fetch stub. It also checks that P2-01 send 2's real receipt bytes
still classify R3 under rule 3′, so the two layers stay separate.

**None of this authorizes Friday's write after the fact** (Codex §6).

## 5. Tests (no network; `scripts/tests/stage0-guard.test.js`, in `yarn test`)

**The harness:**
- every test injects a fetch stub that **fails the test if it is called**,
  unless the case expects one send;
- the clock is injected;
- markers, gos and receipts live in a temporary directory;
- HEAD comes from a fixture repo or an injected resolver.

| id | what | network calls |
|---|---|---|
| G-1 | no `STAGE0_SESSION`, no marker, or two markers for one session: refused | 0 |
| G-2 | a marker from another session (another nonce), which models a new window: refused | 0 |
| G-3 | a marker whose `until` has passed (stale setup); a marker whose head is not HEAD; a marker whose `tokenTag` is another token's: refused | 0 |
| G-4 | R sends a W text, every W text: refused. R sends a C text: refused. W sends an R text (if Q2 is accepted): refused. C sends a non-C text: refused | 0 |
| G-5 | no go; a go for another text (a STATE go used for P2-01); a go for another target, ref or head; a go bound to another marker: refused | 0 |
| G-6 | a consumed go, used a second time (the same command re-run): refused. A go consumed by a send whose fetch then throws: recorded, and a re-run is refused | 0 on the re-run |
| G-7 | a missing, malformed, offset-bearing (`+00:00`), non-UTC or impossible deadline (`2026-13-09T…`, `…T25:…`): refused, never a throw | 0 |
| G-8 | **the boundaries,** for the go's `deadline` and the marker's `until`: 1 ms before is admitted (one call to the stub); exactly at it is refused; 1 ms after is refused. The second check is exercised by a clock that crosses the deadline between steps 8 and 10 | 1 / 0 / 0 |
| G-9 | the HEAD moved after setup; a wrong `--confirm-ref`: refused | 0 |
| G-10 | `stage0-go.mjs` refuses: with no live marker; with a deadline after the marker's `until`; after an UNRESOLVED writing receipt in the session; in a capture phase whose gate does not say NEXT for that text | 0 |
| G-11 | the receipt's `guard` block: present and exact on a send. Rule 3′'s R1 refuses a malformed one. The 24 held fixtures still classify as today | 0 or 1 |
| G-12 | **the incident replay (§4),** at its real UTC times and windows. It also checks the real P2-01 send 2 receipt, byte for byte, still classifies R3 | 0 |
| G-13 | **a mutation companion,** like CL-12 and CL-28: each guard check removed in turn must make its named G-test admit a send. The stub then records a call where 0 was required | |
| G-14 | the dry run still needs no marker, no go and no token, and makes no call (SEND-1 stays) | 0 |
| G-15 | `close` deletes this session's marker and unconsumed gos, and touches no other session's | 0 |

**The existing tests stay green, adjusted for the new prerequisites:**
- SEND-1…7;
- the manifest checks (with the new pins and `window`);
- CL-1…28 (with the optional `guard` key);
- the 14-state replay.

## 6. Runbook changes (written with the implementation, for review)

- **The P1–P3 runbook's §0.5 setup block, and the capture runbook's
  §4.2,** add:
  - the `STAGE0_SESSION` line;
  - `stage0-window.mjs open --role …`, with its printed check;
  - and, at the close, `stage0-window.mjs close` first.
- **Every send step** becomes:
  1. Claude runs the step's checks (the gate, or the runbook's state
     check);
  2. Claude runs `stage0-go.mjs <TEXT> … --deadline <latest start>`, which
     prints the one send command;
  3. Ryan runs that command once.

  The procedures stay: no history, no retype, one command at a time.
- **The capture runbook's P1–P6** are marked as now enforced, each by its
  check. The human checks stay as a second layer.
- **The C5 runbook (DRAFT)** and **item 3's experiment** are written on the
  guarded sender.

## 7. What this cannot establish

- **That a token can or cannot write** (item 3).
- **That the machine's clock is right.** That rests on the clock check, Q5.
- **That a request outside the sender did not happen.** The pins and the
  procedure cover that.
- **Server-side admission time.** A request held upstream may start later
  (UO-1). The deadline bounds the send, not the server's start.

## 8. Questions for Codex

- **Q1. Who writes the go?** I propose the preparing session
  (`stage0-go.mjs`), as two-party issuance. The alternative is Ryan running
  it, which is two commands per step and replayable from history.
- **Q2. Should W refuse R texts?** §6.3 asks only that R refuse writes. The
  P1–P3 runbook already separates them. I propose yes.
- **Q3. Should the receipt carry an optional `guard` block,** with R1
  validating it? I propose yes, as evidence, with the 24 fixtures unchanged.
- **Q4. Should a live send refuse modified tracked files in the
  checkout?** Untracked files would be ignored, so `AGENTS.md` and
  `.stage0-send/` pass. I propose yes, as the capture runbook's V-HEAD,
  machine-checked.
- **Q5. The clock.** Is a recorded `w32tm` status at setup enough? Or should
  the go's deadline keep a fixed margin, for example 60 s, before the
  latest start?
- **Q6. Should the two new CLIs be separate pinned files,** or entry points
  of the pinned guard module (fewer pins)? I propose separate files, each
  pinned.
- **Q7. The C role.** Is a third role right for the cancel path, or should
  the cancel texts belong to R's second caller as today?

## 9. Order of work after review

1. This plan's review (Codex). No code before it.
2. **The implementation, one local commit:**
   - the guard module, the CLIs and the sender changes;
   - the manifest re-pin;
   - the tests;
   - the runbook blocks.

   Then the clean clone, build and 14-state replay, and a review request.
   The CL-28 tightening commit (`9404ee5` + 1) goes with the first item 6
   review, as Ryan asked.
3. **Item 3,** the read-token experiment on staging, on the guarded sender,
   under its own reviewed runbook and go.

Nothing is pushed, and nothing is sent, until Codex clears it.

---

## A. Codex's review of 2026-10-27, and the implementation

**The ruling:** AMEND; implement locally with SG-1 to SG-6; no further plan
round unless the design changes materially. Ryan's three preferences are
accepted: Claude issues each go after Ryan's recorded phase go and an
exact-step gate decision; W refuses R texts as well as the reverse; every new
receipt records and verifies its window. CL-28 (`0687296`) is accepted, to be
carried with this implementation. Nothing here clears a push, token, send,
database operation, item 3 or a production window.

**The code:**
- `scripts/manual/stage0-guard.mjs`: the library (records, checks, gate,
  issuance, admission);
- `scripts/manual/stage0-go.mjs` (Claude): `clock`, `phase`, `issue`,
  `void`, `dispose`, `status`;
- `scripts/manual/stage0-window.mjs` (Ryan): `open`, `status`, `close`;
- `scripts/manual/stage0-send.mjs`: `--go <id>` and `guardedSend()`;
- `scripts/manual/stage0-classify.mjs`: R1 accepts the `guard` block in its
  exact shape only;
- the manifest: a `window` per text (M-12) and the `guard` chain (M-13);
- the procedure: `docs/security/stage0-guarded-send-procedure.md`.

### A.1 The amendments, where each is met

| ruling | what the code does | tests |
|---|---|---|
| **SG-1** a go selected by its id | The send command names `--go <id>`. The sender loads that one go and requires its marker, phase (by the phase record's sha256), workflow, step, text, target, ref, head, checkout, role and request md5/bytes/read_only/endpoint to be this send's. It re-runs the phase's gate under the project lock and requires the gate to name the go's step. A used, voided or unknown id refuses. The issuer refuses a step the gate does not name, and refuses while any unused go is outstanding for the ref, so the project has at most one usable go. The human phase go is recorded with its exact text's sha256, its arrival and its deadline; the go's deadline is the phase deadline less 60 s, never after the marker's end. Cancellation arguments: no go is issued for a cancel (Q7), and the sender refuses any go whose request is not this send's, so an instantiated template cannot match one. | G-3, G-4, G-5, G-6, G-17, G-24 |
| **SG-2** an in-flight and unknown-outcome barrier | A claim is written to the project journal (per ref, in `~/.stage0-guard`, shared by every checkout) before a request can be made, then its outcome: NOT_SENT, or DISPATCHED with the receipt's sha256. PENDING (no outcome) and HOLD (a writing send classified R1 or R4; a missing, altered or unbound receipt; a malformed journal file) block every issuance and every admission, in the issuer and in the sender, across close, reopen, a new marker, a new session value and a new phase. Only a disposition naming the attempt id, with the review file's sha256, releases one. Admission and issuance are serialized by an exclusive lock file per ref. A failure after dispatch became possible is AfterDispatch (exit 5), never "nothing sent". The deadline check immediately before fetch records NOT_SENT. | G-6, G-7, G-8 (a real process killed after its claim), G-9, G-10, G-11, G-12, G-13 |
| **SG-3** the shell instance | The marker binds the process that started node, as Windows reports it through `Get-CimInstance Win32_Process`: pid, image (`powershell.exe` or `pwsh.exe` only) and creation time, with that time before node's own start. A child shell that inherited the session value and token, a later window, a reused pid and a closed window each refuse. The pid is the OS's parent link, not anything in the environment. | G-14, G-14b, **G-27, through real PowerShell processes** |
| **SG-4** window evidence on new receipts | Every guarded receipt carries `guard` (attempt, go, phase, step, marker, the role from the validated marker, head, the go's issue time and deadline); never the token, the session value or its HMAC. The guarded gate requires it, equal to the journal's claim, and reads each receipt by its recorded sha256. The historical path, `stage0-capture.mjs --progress`, issues nothing. The 24 held fixtures keep their classes. Each receipt is classified at its claim's head. | G-15, G-16, G-17 |
| **SG-5** time | Times are `YYYY-MM-DDTHH:MM:SS.sssZ` only, validated totally. Bounds are exclusive. Phase recording ≤ marker creation ≤ go issue ≤ now is checked, so authority from the future refuses. The clock check (w32tm against time.windows.com, three samples within ±2 s) must be under 60 min old and not later than now; a clock more than 2 s behind the latest time a guard tool saw refuses until a new check. | G-12, G-18, G-19, G-20, G-25 |
| **SG-6** the authority chain pinned | The manifest pins the transitive repository closure of `stage0-send.mjs`, `stage0-window.mjs` and `stage0-go.mjs`: 7 files, the classifier and the capture gate included. Before any go, marker or request, each tool recomputes that closure with a parser-free audit that fails closed, and requires every file in it to be pinned, with its blob. M-13 checks the pinned list against acorn's closure, and the audit's specifiers against acorn's, file by file. | G-21, M-13 |
| **Q2** exact roles | `window` is listed per text in the manifest; M-12 fixes the mapping; a missing or unknown role refuses; `read_only` is never consulted. | G-1, G-2, M-12 |
| **Q4** clean tracked files | Live admission, issuance and `open` refuse staged, unstaged, deleted and unmerged tracked changes; untracked files pass. Node options, `NODE_OPTIONS`, and a `git`, `powershell` or `w32tm` program planted where Windows would find it first, also refuse. | G-22 |
| **Q7** the C role | A C window exists, so R and W can never send a cancel text. No exception to the in-flight hold is defined, and no go is issued for a cancel text: live cancellation stays unapproved (P1–P3 runbook §R 6). | G-1, G-23 |

### A.2 Corrections to this plan's claims

- **G-R8** promised that "a command from history, an earlier message or a
  retype cannot send". No program can tell running the current command from
  retyping it. The tools refuse old, used, voided, unknown and expired ids,
  and wrong steps; "no history, no retype" stays a human control.
- **G-R9 and §6:** "every pause is an exit" is not machine-enforced, and the
  capture runbook's P1–P6 are **not** all enforced. The procedure's §0 says
  which part of each the tools refuse and which stays a person's job. A
  window someone walks away from stays usable until the phase deadline.
- **§3.2:** the session value alone does not bind a window: a child shell
  inherits it (Codex SG-3). The shell process binding does.
- **§3.4–§3.5:** the sender no longer looks for "the" go for a text; a crash
  after the claim holds the project instead of needing "a new go"; a
  failure after dispatch became possible exits 5.
- **§3.8:** the `guard` block is optional only for historical receipts; the
  guarded gate requires it.
- **§3.6, Q5:** a recorded `w32tm` status is not evidence of the current
  offset. It read `Leap Indicator: 3(not synchronized)` on 2026-10-27 while
  the stripchart showed +0.16 s. The stripchart comparison decides.

### A.3 Where the implementation differs from §3, beyond the rulings

- **The state lives in `~/.stage0-guard`,** not `.stage0-send/guard`: one
  journal for every checkout, so a fresh clone does not escape a hold
  (SG-2).
- **A marker belongs to one recorded phase** (`open --phase <id>`), and ends
  at that phase's deadline. There is no separate `--until`.
- **No per-step latest-start ceilings yet.** A go's deadline is the phase
  deadline less 60 s. A production runbook that needs per-step ceilings
  declares them with its phases, in review. (Added in P: §C.)
- **Only the capture workflow is declared.** No production phase, and no
  item 3 phase, can be recorded until it is declared in code with its gate.
- **The sender re-runs the gate** under the lock, as well as the issuer.
- **Exit codes:** 0 a recorded 201; 1 another recorded status; 2 refused,
  no request; 5 a request may have been made, its outcome not recorded.
- **Receipts are written as new files only** (`wx`); a name collision is
  AfterDispatch, never an overwrite.
- **The manifest generator** computes the chain with the same parser-free
  audit, so it still needs no `node_modules`.

### A.4 The tests

`scripts/tests/stage0-guard.test.js` (G-1 to G-26) and
`stage0-guard.shell.test.js` (G-27, Windows; skipped elsewhere), in
`yarn test`. Every negative asserts a Refusal **and zero requests** on a
counting fetch stub. G-6 and G-8 use real child processes: concurrent
issuers and senders, and a sender killed after its claim. G-26 is the
mutation companion: 14 named checks, each removed in turn, must admit exactly
one request where the original allows none, with a recorded result. A tooling
error under the mutant does not count.

### A.5 What it still cannot establish

- That a token can or cannot write (item 3).
- When a server starts a request, or that a held request never will: the
  deadline bounds admission on this machine's clock only.
- That a message in chat came from Ryan, or that a review file is a genuine
  review.
- That nobody edited the pinned files, the state directory or the
  environment on purpose: the pins, review and the procedures cover that.

---

## B. Codex's review of 78db6dc, and commit O

**The ruling** (`reviews/2026-10-27-78db6dc-review.md`): AMEND, two blockers,
I6-R1 and I6-R2; push held. SG-3, SG-4, SG-6, Q2, Q3, Q4, Q6 and Q7 are
accepted. Ryan's instructions for O: don't amend `78db6dc`, add O on top;
leave per-step deadlines out of O; say that the production deadline contract
is not complete.

### B.1 I6-R1: the store fails closed

| Codex's requirement | what O does | tests |
|---|---|---|
| 1. an explicitly initialized store with a project identity; an absent or unreadable journal is not an empty one | `store.json` holds the store's id, creation time, refs and predecessor. The repository records it at `docs/security/stage0-guard-store.json` (the anchor), read at HEAD, and every live command refuses unless the store is the anchored one, for the manifest's refs. Every journal and store directory must exist, as a directory. Admission and issuance check the store under the store lock they hold for the claim or the go. | ST-1, ST-2, ST-3 |
| 2. no silent creation; first use explicit; loss needs a reviewed restoration | Only `stage0-go.mjs init` makes the store, built beside its path and renamed into place, and only where nothing exists. No write creates a directory. While an anchor exists, `init` refuses; `init --restore` needs the anchored store's id and a review file naming it, and the new store works only once a reviewed commit anchors it. | ST-1, ST-1b, ST-3b, ST-8 |
| 3. persistent bookkeeping and cross-checks; a disposition does not hide damage | `ledger.jsonl` records every change, hash-chained, with each file's sha256. `storeCheck()` replays it and requires every recorded file, where its lifecycle puts it, with its ids; no unrecorded file; each claim on a live go, each outcome and disposition on a claim, once, in sequence. `holdsOf()` reports an attempt's problems before it looks at its disposition. | ST-3, ST-3c, ST-5 |
| 4. the high-water record: missing, invalid or unwritable refuses | `checkClock()` refuses a missing or invalid record, and refuses when it cannot advance it. Only a clock check (`recordClock`) re-establishes it, recording what it found (`hwmBefore`). | ST-4 |
| 5. close available on damage; status never says "no holds" unless intact | `closeSession()` checks no store integrity; it records where the ledger reads, and otherwise changes nothing and says why (exit 3). `status` on damage reports the problems and no holds list. | ST-6 |

Every damage case asserts, for **both** the issuer and the sender, no usable
new go and zero further requests: in the old phase, a fresh phase, a fresh
window, and another checkout of the same commit. The whole-store-loss case
runs the ordinary setup (clock, draft, phase, window) and an immediate send,
and `init` too: each refuses, and nothing recreates the store (ST-3b).
Serialization: one store lock for every change; concurrent `init` makes one
store (ST-1b); a ledger that cannot be written refuses and undoes the file it
wrote (ST-7). The mutation companion gains "the store check in the sender",
admitting a request only when that check is removed (G-26).

### B.2 I6-R2: one registration per human approval

`stage0-go.mjs draft` allocates an approval id (16 hex) for one workflow,
phase, head and ref, recorded in the ledger. Ryan's go line carries
`approval <id>`. `recordPhase()`, under the store lock:
- the same id again, with the same text, returns the SAME phase and its
  progress; with other words it refuses;
- a new registration needs a draft of this store for this workflow, phase,
  head and ref, drafted before the go arrived;
- `approvals/<id>.json` is written with `wx`, and `storeCheck()` refuses a
  second phase for one approval.

Neither the text nor the arrival time is the identity. A restart needs a new
draft, a new line and Ryan's new go (AP-4). Tests: AP-1 (sequential replay,
other words, none, two, undrafted and foreign ids), AP-2 (Codex's
reproduction: after A1, close, the same go again with a new window: the same
phase, A1 refused with no request, A2 next; and after completion), AP-3
(three processes registering one approval: one phase).

### B.3 The ordering note

`preflight()` (node options, NODE_OPTIONS, planted `git`, `powershell` or
`w32tm`) now runs before any program in all three command lines: the sender
before it reads the manifest with git (live sends; a dry run creates no
authority), the window and the issuer before anything else. ORD runs the real
command lines from a copy that is not a git repository: each refuses with
the preflight's reason, not a git error.

### B.4 Deferred: per-step deadlines

**The production deadline contract is not complete.** A go's deadline is the
capture-phase admission cutoff (the phase deadline less 60 s), the same for
every step. Per-step latest-start ceilings, bound to the recorded phase and
go and re-checked by the sender, come in a separate item 6 follow-up commit
after O. Item 4(c) supplies and reviews the production numbers and the
whole-remaining-path budget. No production phase is declared before both.
(The generic support is P: §C.)

### B.5 What O does not do

- It does not run `init`: no store exists on this machine, and no anchor is
  committed. Every live command refuses until both are in place, and that
  commit is reviewed with item 3's runbook.
- No push, token, send or database change.

---

## C. Codex's review of O, and commit P: per-step ceilings

**The ruling** (`reviews/2026-10-28-22610f8-review.md`, evidence
`reviews/release-22610f8-*`): ACCEPT O within the bounded mistake-barrier
contract.
- **Closed:** I6-R1 and I6-R2, for their reviewed cases.
- **Accepted:** the ordering fix, and the committed anchor as an identity
  anchor, not a log-head witness.
- **Pushed:** the staging-only push of `0687296`, `78db6dc` and O was
  cleared. It is recorded in the production plan §E13.
- **Still to come:** per-step ceilings stay the item 6 follow-up, which is
  this commit, P. Item 4(c) supplies the production numbers.

Ryan's instructions for P:
1. generic per-step ceilings, bound to the recorded phase and go and
   re-checked independently by the sender, so that a go can never extend a
   step's ceiling;
2. Codex's tail-loss ruling in the procedure and here, with the paired
   claim-and-log loss as a regression test.

### C.1 The ceilings

- **The declaration.** A workflow phase may carry `ceilings: { <step>: ms }`:
  what each step reserves before the phase deadline for the whole remaining
  path from it. `ceilingReserve()` refuses unless the declaration:
  - names exactly the phase's steps;
  - gives each a whole number of minutes, at least `MARGIN_MS` (60 s);
  - reserves no more for a later step than for the one before it.

  A phase that declares none reserves 60 s for every step: the capture-phase
  admission cutoff, as before. Every capture phase is such a phase. **A
  production phase must declare them**: one without them refuses at `draft`,
  `phase`, `issue` and the sender. No production phase is declared.
- **The phase** (`stage0-phase/3`) records `ceilings`: each step's ceiling
  as a UTC time, the deadline less its reserve. Registration refuses once
  any step's ceiling has passed. `loadPhase()` refuses a record whose
  ceilings are not one per step, in order, after its recording and at least
  60 s before its deadline.
- **The issuer** recomputes the step's ceiling with `ceilingOf()`. That
  function also refuses unless the phase recorded exactly the declared
  ceilings, every step's. The issuer refuses at or after the ceiling. The
  go (`stage0-go/2`) records the `ceiling`, and its `deadline` is the
  ceiling, or the marker's end if that is earlier. It is always the
  ceiling: a marker ends at the phase deadline.
- **The sender recomputes the ceiling itself**, with the same function, from
  its pinned declaration and the phase's deadline. It then refuses:
  - a go whose `ceiling` is not exactly that value (stale or altered);
  - a go whose `deadline` is later than it.

  Its existing exclusive checks of the go's deadline then hold at the
  ceiling at all three points: admission, under the store lock, and
  immediately before fetch.
- **Unchanged:** the claim and the receipt's guard block carry the go's
  deadline, as before. The classifier's guard-block shape is not touched.
- **The command lines.** `phase` prints every step's ceiling. `issue`
  prints the go's ceiling and deadline.

**What it does not do:**
- It does not compute whether the remaining path fits as a session's pace
  changes. The reserves are fixed, reviewed numbers; Claude still states
  the fit at each step.
- It does not supply the production numbers. That is item 4(c).
- Ryan's go line is unchanged: it names the deadline, and the ceilings
  follow from it and the declaration at the pinned head. Whether the line
  should also name each step's latest start is a question for Codex (the
  review request, §7).

### C.2 The tests

`scripts/tests/stage0-guard.ceiling.test.js`, in `yarn test`. Every negative
asserts a Refusal and zero requests.

| test | what it shows |
|---|---|
| CE-1 | Every capture phase gives 60 s per step. A production phase without ceilings, and each malformed declaration, refuse; nothing is drafted |
| CE-2 | Registration records every ceiling. Before, at and after the first step's ceiling: registered, refused, refused |
| CE-3 | The issuer, before, at and after each of A1, A2 and A3's ceilings: the go records the ceiling and ends at it, or nothing is issued |
| CE-4 | The sender, before, at and after each step's ceiling at admission (one request, or none), under the store lock (no claim) and immediately before fetch (NOT_SENT, nothing held) |
| CE-5 | **A late early step:** one minute after A1's ceiling, with the phase, its windows and A2's and A3's ceilings open. A1 is not issued; its earlier go is not sent; A2 is not issued (the gate names A1); a forged go running to the phase's cutoff, or restating A1's ceiling as the cutoff, is refused. The control, with 60 s reserves, admits A1 at the same time |
| CE-6 | **Stale or enlarged ceilings.** A go whose ceiling is later or earlier than declared. A go whose deadline is past its ceiling. A phase record with one ceiling moved (its ledger line re-chained, so the store checks). A declaration made tighter or looser after registration, at the issuer and for a go issued before. Each is refused |
| CE-7 | `phase` and `issue` print the ceilings |

- **G-18:** the window-end bound is now tested with a marker rewritten to end
  before the step's ceiling. An honest window always ends after it.
- **G-26** gains three mutants, 18 in all:
  - the sender's ceiling bound;
  - the go's recorded ceiling;
  - the phase's recorded ceilings in `ceilingOf()`.

  Each, removed, admits exactly one request in a scenario that only it
  refuses.
- **The fixture's `synthWorkflow`** declares 60 s per step for a production
  phase the test does not give ceilings. The other tests keep their timing,
  and the ceiling code runs in all of them.

### C.3 The tail-loss ruling

Codex's ruling, in the procedure's §7 and its §0 table:
- **Detected:** the newest claim lost together with its ledger line. The go
  sits in `gos/used/` while the shortened ledger expects it live.
- **Held, not damaged:** the newest outcome lost together with its line.
  The records agree, but the claim is PENDING, so the project stays held.
- **Not detected:** a store put back as a whole to a valid earlier state.
  The anchor is an identity anchor, the store records no head that
  survives a rollback, and receipts outside the store are not searched.
  Any known or suspected restore, sync rollback or storage loss is
  STOP-and-review. No backup or snapshot is restored in place. An
  unresolved send known from outside the store stays unresolved (UO-1).

**ST-9** (`stage0-guard.store.test.js`) is the regression test for the
first two cases, with no go and no request from the issuer and the sender.
The coherent rollback is deliberately not asserted. It is a limit, not a
behaviour any later change must keep.

### C.4 What P does not do

- No production phase, numbers or whole-path budget (item 4(c)).
- No `init`, no anchor, no token, send, push or database change. The first
  `init` and its anchor commit come with the item 3 plan, in their own
  review.

---

## D. Codex's review of P, and commit Q

**The ruling** (`reviews/2026-10-28-30c0eba-review.md`):
- **Mechanism:** the ceiling mechanism, ST-9 and the tail-loss text are
  accepted.
- **AMEND, and the exact-P push is held,** for P-R1.
- **Required before any production phase:** Q-P1, Ryan's explicit go times;
  and a tighter per-send not-after.
- **Required for every new phase:** Q-P2, declared ceilings. The capture
  phases keep their cutoff as a legacy exception.

Ryan's instructions: commit Q on top of P, without amending P, completing
item 6's generic deadline support.

### D.1 P-R1: ceilings need not follow execution order

- **Removed:** the cross-step rule from `ceilingReserve()` (a later step may
  not reserve more) and from `loadPhase()` (nondecreasing ceilings). Under
  P, the P1–P3 runbook's own binding map was refused:
  - P1 18:40;
  - P2-01 and P2-02 19:20;
  - P2-0304 19:17;
  - P2-05 19:08.
- **Kept:**
  - exact step coverage;
  - whole-minute values, now bounded to 60 s to 24 h;
  - each ceiling after the phase's recording and at least 60 s before its
    deadline;
  - the independent recomputation;
  - the execution-order gate;
  - every exclusive check.
- **Registration** refuses once ANY step's ceiling has passed, which need
  not be the first step's.
- **Tests:**
  - **CE-1** now registers the runbook's map as a positive case: it
    computes those five times and drafts;
  - **CE-8:**
    - a two-step phase whose second step reserves more, before, at and after
      that step's ceiling, at registration, at the issuer and at the sender;
    - one minute after A2's ceiling, A1 still starts, but A2 is never issued,
      and A1 is not issued again. The phase stops; nothing is reordered or
      skipped.

### D.2 Q-P1: the go line binds the whole time map

- For every phase that declares ceilings, `draft` takes the deadline
  (`--deadline`), records it, and prints the one defined line (`goLine()`):
  - the phase, workflow, approval id, head, target and ref;
  - every step in order with its absolute latest start, in UTC to the minute
    with its Eastern time;
  - the phase deadline, apart from the step limits.
- **The Eastern time** is formatted by `Intl` for America/New_York. Its
  offset is checked against the abbreviation, EDT −4 or EST −5; anything
  else refuses.
- **Registration** requires the drafted deadline, and a message EXACTLY
  equal to the line recomputed from the declaration and that deadline. So
  the registered map equals the recomputed one, and any other content
  refuses: a substring match is not used.
- **Re-registration** keeps O's idempotence: the same text and deadline
  return the same phase, with its ceilings. The same id with another
  deadline refuses.
- **CE-9** tests each of these refusals, with no phase recorded:
  - a wrong time;
  - swapped step/time pairs;
  - a duplicated step;
  - a missing step;
  - an extra step;
  - other words after the line;
  - another Eastern zone;
  - the legacy hand-written form;
  - a longer deadline, in the text or registered as such;
  - re-registration with a longer deadline.
- **The legacy capture phases** keep their hand-written line (the substring
  checks of O).

### D.3 The per-send not-after

- `issueGo({ notAfter })`, from `stage0-go.mjs issue --not-after <UTC>`, is
  an earlier bound for one send: the latest start that Claude's current
  whole-path check allows.
- **The issuer refuses** a value that has already passed, or that is later
  than the step's ceiling, the window's end or the phase deadline.
- **The go (`stage0-go/3`)** records `notAfter`, and its deadline is that
  value.
- **A production phase requires it,** at the issuer and again in the
  sender. The sender also requires a recorded not-after to equal the go's
  deadline, then enforces that deadline at all three of its checks.
- **The code binds the value it is given;** it computes no path. Claude
  states the computation (procedure §4).
- **CE-10:**
  - the bound recorded, at the ceiling allowed, after it refused, already
    passed refused, missing for production refused;
  - a staging go without one;
  - before, at and after the not-after while the ceiling is still open: one
    request, or none;
  - a forged production go without one, or ending after its not-after;
  - a tighter go issued after a NOT_SENT leaves the used go used;
  - a pending attempt still holds against a tighter go.

### D.4 Q-P2: every new phase declares its ceilings

- `LEGACY_CUTOFF_PHASES` names capture's B, A, T and U. `isLegacyPhase()`
  requires the capture workflow OBJECT itself, so another workflow named
  `capture`, or a new capture phase, gets no exception.
- Any other phase without `ceilings` refuses, at `draft`, `phase`, `issue`
  and the sender, whatever its target.
- **CE-1** covers:
  - production and staging phases without ceilings;
  - a look-alike capture workflow;
  - a legacy phase drafted without a deadline, and refusing one.
- **The fixture's `synthWorkflow`** declares 60 s per step for any phase a
  test does not name. A production `issue()` passes the latest bound the
  issuer admits, unless a test gives one.

### D.5 The mutation companion and the rest

- **G-26** gains two checks, 20 in all:
  - the go's not-after in the sender;
  - the production not-after in the sender.
- **The store:** draft events gain `deadline` (null for a legacy phase).
  Q changes neither the store's identity record, its `init` event nor the
  anchor format. Those are all the store made by the first init on
  2026-10-28 (`3389bb8f8df9280e7608c455249678f5`) holds so far.
- **No production phase, ceilings or not-after values** are declared or
  supplied: that is item 4(c).
