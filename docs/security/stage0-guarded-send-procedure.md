# Stage 0 — the guarded sender: the procedure for every later session

**Status: DRAFT, for Codex's review with the item 6 implementation, its
correction O (accepted, `22610f8`), the per-step-ceiling follow-up P
(`30c0eba`, AMEND) and its correction Q.** It clears no session, token, send
or window. Item 3's staging experiment is the first session expected to run
under it, under its own reviewed runbook and go.

**Per-step ceilings (P, Q).** Each step's go ends at the step's **ceiling**,
its latest start: the phase deadline less what the phase's declaration
reserves for the whole remaining path from that step.
- A later step may reserve more, so its ceiling may come EARLIER than an
  earlier step's. The steps still run in their declared order: past a
  step's ceiling, that step is not issued, and nothing later is.
- The phase records every step's ceiling and the go records its own. The
  issuer and the sender each recompute it from the pinned declaration and the
  phase's deadline, and refuse a stale or enlarged value. A go never outlives
  its step's ceiling.
- **Every phase declares its ceilings**, except the reviewed item 2 capture
  phases B, A, T and U. Those keep the **capture-phase admission cutoff**,
  the deadline less 60 s, as a named legacy exception.
- **The go line** for a phase that declares ceilings is drafted by
  `stage0-go.mjs draft`. It gives every step with its absolute latest start,
  then the phase deadline. Ryan approves it word for word, and it registers
  only if his message is exactly that line (§2).
- **A go may carry an earlier not-after:** the latest start that Claude's
  current whole-path check allows. A production go must carry one (§4). It
  can only tighten the ceiling, the window's end and the phase deadline.

**The production deadline contract is complete only with item 4(c).** Its
review supplies the production ceilings and the whole-remaining-path budget
they come from. Until then no production phase is declared, so no production
go can be issued (Codex, reviews of `78db6dc` and `22610f8`).

**Sources:**
- the item 6 plan, `docs/security/stage0-item6-sender-guards-plan.md`, as
  amended by Codex's reviews of 2026-10-27 (SG-1 to SG-6, its §A; I6-R1 and
  I6-R2, its §B);
- the capture runbook's six procedures, P1–P6
  (`docs/security/stage0-item2-capture-runbook.md` §4);
- the P1–P3 runbook's window setup and checks (§0.4, §0.5).

From the item 6 commit on, `stage0-send.mjs` makes no live send without
`--go <id>`. The send commands written in the P1–P3 runbook (§0.5) and the
capture runbook (§4.3) are therefore superseded for any new session. Their
token, prompt and paste checks (V-SCOPE, V-PROMPT, V-MASK, V-PREFIX, V-CLIP,
`-AsSecureString` only) stay as written.

## 0. What the machine checks, and what stays a person's job

| procedure | what the tools now refuse, before any request | what stays human |
|---|---|---|
| **P1** a fresh window and token per phase | A marker binds one PowerShell process (Windows' pid, image and creation time) and an HMAC of the token loaded in it. A child shell, a later window, another token, a closed window: each is refused. One live window per role per phase. The marker ends at the phase deadline. | Checking the token's page: the project, the level, the expiry. |
| **P2** one current command at a time | Every send names its go by id. A go is single-use, bound to one phase, step, text, window, head, ref and request, and expires. A used, voided, unknown, expired or foreign go is refused. | Nothing tells running the current command apart from retyping it: **no history, no up-arrow, no retype, no command from an earlier message**. |
| **P3** the gate before every send | `stage0-go.mjs issue` runs the phase's gate on the journal, and the sender runs it again under the store lock. Only the step the gate names is issued or admitted. | — |
| **the time rule** (per-step ceilings) | Each step has a ceiling, its latest start, from the reviewed declaration and the phase deadline. Nothing is issued at or after it. The sender recomputes it, and refuses at or after it (at admission, under the store lock and immediately before fetch), and refuses a go that records another ceiling or ends later. A go's not-after, when given, is its deadline, and the sender enforces it the same way. A production go without one refuses. | That the declared reserves are right: item 4(c)'s review for production. The current whole-path check: Claude computes, at each step, the latest start that still fits at the session's actual pace, and passes it as `--not-after`. The code binds that value; it does not compute it. |
| **P4** only this session's fresh results | The gate reads receipts through the journal: each by its recorded sha256, with a guard block equal to its claim. A receipt without one, a stripped or edited one, or a historical one stops the phase. | — |
| **P5** every pause is an exit | Nothing detects a person stepping away. The marker's end (the phase deadline) and the clock check's 60 minutes bound how long a forgotten window stays usable. | **Every pause is an exit (§5).** |
| **P6** exit codes and banners are not authorization | The sender's banner now says so. An unresolved writing outcome holds the project until a reviewed disposition (§6), in every window and every later phase. | Reading the classification and the step's check before asking for the next go. |
| **the store** (I6-R1) | Only `init` makes the store; the repository's anchor must name it. Every live command checks the store against its ledger, both ways: a lost, altered or unrecorded file is DAMAGE, and nothing is registered, issued or sent. | Never editing, moving or deleting the store; a restoration is reviewed (§7). A whole store rolled back to a valid earlier state is NOT detected: never restore a backup or snapshot of it in place, and treat any suspected restore, sync rollback or storage loss as STOP-and-review (§7). |
| **one approval, one phase** (I6-R2) | Ryan's go line carries an approval id drafted for that phase. The same id again returns the same phase, with its progress; it never makes a second one. | That the line came from Ryan, in chat. |

The guards are a mistake barrier, not a sandbox. Anyone who edits the pinned
files, the store (§7) or the environment by hand can defeat them; the pins,
review and these procedures are the controls for that.

## 0.1 Once, before the first session: the store (CLAUDE, then a reviewed commit)

```bash
node scripts/manual/stage0-go.mjs init
```

- It makes `%USERPROFILE%\.stage0-guard`, where nothing exists, and prints
  the anchor: the store's id, creation time and refs.
- That anchor is committed, exactly, as
  `docs/security/stage0-guard-store.json`, in a reviewed commit. Until it is
  at HEAD, every live command refuses.
- **No other command makes the store, or any directory in it.** While the
  repository records an established store, `init` refuses: a lost store is
  never replaced by running `init` again (§7).
- `init` is not part of a session. On this machine it ran once, on
  2026-10-28, under Codex's narrow first-init clearance, from a clean
  checkout of O. It made store `3389bb8f8df9280e7608c455249678f5`. The
  verbatim record is the item 3 plan's §9, and the anchor is
  `docs/security/stage0-guard-store.json`, both in the item 3
  implementation commit, for review. A rebuilt implementation reuses this
  store; nothing justifies another first init.

## 1. Before the session (CLAUDE)

1. In the checkout: `git rev-parse HEAD` prints the cleared head, and
   `git status --short` prints only untracked files (`?? AGENTS.md`). The
   tools refuse any tracked change: staged, unstaged, deleted or unmerged.
2. The dry runs of the phase's texts, as before (V-DRY).
3. **The clock check:**

   ```bash
   node scripts/manual/stage0-go.mjs clock
   ```

   It runs `w32tm /stripchart /computer:time.windows.com /dataonly
   /samples:3` and records the result. **Accepted only when** all three
   samples are readable and each offset is within **±2 s**. It also records
   w32tm's `/query /status` lines, for information only: on 2026-10-27 that
   status read `Leap Indicator: 3(not synchronized)` while the stripchart
   showed +0.16 s, so the status alone is not evidence.
   - The guard tools refuse when the check is missing, **60 minutes old or
     older**, or later than the current time.
   - Every guard tool records the latest time it has seen (the high-water
     record). A clock more than **2 s** behind that time has gone back: every
     tool refuses until a new clock check. A missing or invalid high-water
     record, or one that cannot be written, refuses the same way. Only a clock
     check re-establishes it, and the check records what it found
     (`hwmBefore`). A clock check repairs nothing about send history.
   - If w32tm cannot reach the server, or the offset is beyond 2 s, there is
     no session until the clock is corrected and checked again.
   - What this establishes: this machine's clock agreed with the time server
     within 2 s at that check. It says nothing about when a server starts a
     request, and it cancels nothing.

## 2. The phase go

1. **RYAN** reports the token's name, scope, level and actual expiry, as
   before.
2. **CLAUDE** drafts a fresh approval id for the phase, and with it the go
   line. For a phase that declares ceilings, the draft takes the phase
   deadline: a whole minute, inside the token's expiry.

   ```bash
   node scripts/manual/stage0-go.mjs draft --workflow <w> --phase <P> --deadline <UTC>
   ```

   The id is recorded in the store for this workflow, phase, head, ref and
   deadline. It registers one phase, once. The draft prints Ryan's go line
   in its one defined form:

   ```text
   GO phase <P> (<w>), approval <id>: head <7>, <target> <ref>. Latest starts: <S1> YYYY-MM-DD HH:MM UTC (HH:MM EDT YYYY-MM-DD); <S2> …. Phase deadline YYYY-MM-DD HH:MM UTC (HH:MM EDT YYYY-MM-DD).
   ```

   - Every step appears, in order, with its absolute latest start. The phase
     deadline comes last, apart from the step limits.
   - Each Eastern time is computed from the UTC time by the tool, which
     checks the offset (EDT is UTC−4, EST UTC−5). The UTC values are the
     binding ones.
   - A draft refuses when a step's latest start has already passed for that
     deadline.
3. **The legacy capture phases (B, A, T, U)** are drafted without
   `--deadline`, and their line is still written by hand. It must contain,
   exactly:
   - `GO phase <P> ` (with the space);
   - `approval <id>`, the id from point 2, once;
   - the head's first 7 characters;
   - the target's ref;
   - every step id of the phase;
   - the deadline as `YYYY-MM-DD HH:MM UTC`, with the Eastern time beside it
     and both dates.

   Their ceilings are all the deadline less 60 s.
4. **CLAUDE** shows Ryan the complete line before he approves it, and
   **RYAN** returns it word for word. Its arrival is the go time.
5. **CLAUDE** writes Ryan's message, exactly, to a file outside the
   checkout, and records it within 10 minutes of its arrival, with at least
   30 minutes left:

   ```bash
   node scripts/manual/stage0-go.mjs phase --workflow <w> --phase <P> --go-text <file> --arrived <UTC> --deadline <UTC> [--reviewed <file>]
   ```

   It refuses unless:
   - the approval id was drafted for this phase;
   - **for a phase that declares ceilings:** the deadline is the drafted
     one, and the message is EXACTLY the drafted line. Any of these refuses:
     a wrong, swapped, duplicated, missing or extra step time; other words;
     another Eastern time; a longer deadline (CE-9);
   - **for a legacy capture phase:** the text names everything in point 3;
   - no step's ceiling has passed.

   A phase that needs a reviewed decision (U) names the review file. A
   token-shaped value in the text is a STOP. It prints the phase id and
   every step's ceiling. Recording checks what the message says; it does not
   show who sent it, which stays Ryan's chat.
   - **The same approval again** (the same line recorded twice, by mistake or
     from history) returns the SAME phase, with its progress and ceilings: it
     never makes a second phase or restarts its steps. The same id with other
     words, or with another deadline, refuses.
   - **A restart** needs a new approval: a newly drafted id, a newly drafted
     line, and Ryan's new go. Neither the wording nor the arrival time is the
     approval's identity.

   Two staging workflows are declared: the item 2 capture phases, and item
   3's phases E and X (`--workflow item3`; runbook
   `docs/security/stage0-item3-runbook.md`). A production phase is declared
   in code with its gate and its ceilings, in review, before any go for it
   can be recorded.

## 3. Each window (RYAN)

In a NEW PowerShell window in the checkout, per window role the phase uses:

```powershell
$Host.UI.RawUI.WindowTitle = "STAGE0 <phase> <R|W>"
git rev-parse HEAD
git status --short
$s = Read-Host "Paste token" -AsSecureString
$env:SUPABASE_ACCESS_TOKEN = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)); Remove-Variable s
$env:SUPABASE_ACCESS_TOKEN.StartsWith("sbp_")
$env:SUPABASE_ACCESS_TOKEN.Length
$env:STAGE0_SESSION = [guid]::NewGuid().ToString()
node scripts/manual/stage0-window.mjs open --role <R|W> --phase <phase id>
```

- **V-HEAD**, **V-SCOPE**, **V-PROMPT**, **V-MASK**, **V-PREFIX**, **V-CLIP**,
  as in the P1–P3 runbook §0.4.
- Run `node` directly in the window: not through `yarn`, `npx` or another
  shell. The marker binds the process that starts node, and refuses one that
  is not a PowerShell window. Rehearsed (G-27): `yarn run` puts a
  `node.cmd` shim first on PATH (`%TEMP%\yarn--<id>\`), and through it
  node's parent is `cmd.exe`, which is refused. On this machine `node` is
  nvm4w's `C:\nvm4w\nodejs\node.exe`, which PowerShell starts directly.
  `NODE_OPTIONS` must be unset.
- The `open` line prints `marker <id>: role <R|W>; head <7>; <target> <ref>;
  until <UTC>`. Ryan pastes it. It carries no secret: never the token, the
  session value or the HMAC.
- `node scripts/manual/stage0-window.mjs status` in the same window prints
  that marker and `bound to this window`.

Which window sends what is fixed in the manifest (M-12): **R** reads (P0,
STATE, SIZE-PROBE, the envelope probes); **W** writes, or reads back inside a
writing phase (P1, P2-*, RB-*, every LOCKPROBE text); **C** is the cancel
caller, and no phase uses it: live cancellation is not approved, and no go is
issued for a cancel text.

## 4. Each step

1. **CLAUDE** states the current whole-path check: the latest start for
   this step at which the whole remaining path still fits, taking the larger
   of the budgeted duration and the slowest pace actually seen. Then Claude
   issues the step's go with that bound:

   ```bash
   node scripts/manual/stage0-go.mjs issue --phase <phase id> --step <STEP> [--not-after <UTC>]
   ```

   - `--not-after` is **required for a production phase**. On staging it is
     optional, and without it the go ends at the step's ceiling.
   - It must be later than now, and no later than the step's ceiling, the
     window's end or the phase deadline. It can only tighten them.
     Extending a ceiling needs a newly reviewed and approved phase, never an
     edited go.

   It refuses unless the gate names this step, exactly one live window of
   the step's role is open for the phase, the project holds nothing, no
   other unused go is outstanding, and the step's ceiling has not passed. It
   prints one command, for one window:

   ```powershell
   node scripts/manual/stage0-send.mjs <TEXT> --target <t> --confirm-ref <ref> --go <32-character id>
   ```

   The go's deadline is its not-after, or else the step's ceiling. The sender
   recomputes the ceiling from the declaration and the phase's deadline. It
   refuses a go that records another ceiling or ends later, a go whose
   deadline is not its recorded not-after, and a production go without one.
   It enforces the go's deadline at admission, under the store lock and
   immediately before fetch (CE-10).
   - Past the deadline the step is not sent, even while the phase and its
     windows are still open.
   - Past a step's ceiling the gate does not skip ahead to a later step:
     nothing more is issued in that phase (CE-5, CE-8). That is a stop, and
     the reviewed recovery protocol follows. Steps are never reordered.
   - A tighter go never re-arms a used go, and never releases a pending or
     held attempt.
2. **RYAN** runs that command once, in the window it names, and pastes the
   sender's lines. They carry no secret.
3. **The exit code:**
   - **0** HTTP 201, recorded;
   - **1** another status or a transport error, recorded;
   - **2** refused: no request was made. Nothing is retried; the refusal is
     reported, and the next action comes from Claude;
   - **5** a request was, or may have been, made and its outcome is not
     recorded: **STOP-and-review**. The project is held (§6). Run nothing
     else.

   None of these is a go.
4. **CLAUDE** classifies the receipt (rule 3′), runs the step's check, and
   reads `node scripts/manual/stage0-go.mjs status --target <t>`. The next
   step needs its own go (point 1). A command that was not run is voided
   (`stage0-go.mjs void --go <id>`) before any other go is issued.

## 5. Every pause is an exit (P5; the end of every session)

In each window, in this order:

```powershell
node scripts/manual/stage0-window.mjs close
Remove-Item Env:SUPABASE_ACCESS_TOKEN
Remove-Item Env:STAGE0_SESSION
exit
```

Then delete the token in the dashboard, report the time, and clear Win+V.

- `close` moves the window's marker to `markers/closed/` and voids its
  unused gos, each recorded in the ledger. It checks no pin, head, clock or
  store integrity, so it works when they fail. Where the ledger itself
  cannot be read it changes nothing, says why and exits 3; the marker then
  binds only this window's process, which is about to exit. **Either way the
  next three lines and the token deletion still happen.**
- The journal, the used and voided gos, the closed markers and the receipts
  stay: they are the evidence.
- A window closed without `close` leaves a marker no other process matches;
  it ends at the phase deadline, and a new window of that role replaces it.
- **A pause is not detectable.** A window someone walks away from stays
  usable until the phase deadline. The exit is the control.

## 6. Holds and dispositions

`status` first checks the store (§7). On a damaged store it prints DAMAGED,
the problems found, and **no holds list**: an empty list would claim a
history that is not known to be intact. It exits 3 on damage, a hold or a
held lock.

The journal holds the **project**, for every window, phase and checkout
(§7), when an attempt:
- is **PENDING**: claimed, with no recorded outcome. That is a send in
  flight, or one whose process died. No go is issued and no send admitted
  while it stands;
- is **HOLD**: its receipt is missing, altered or unbound to its claim; a
  journal file is malformed; or it is a writing send that rule 3′ classifies
  R1 or R4.

A NOT_SENT attempt (the go's deadline, its step's ceiling, passed in the
last check before fetch) holds nothing, and its step stays next. Its go is
used: a new go is issued only while that step's ceiling has not passed.

**Only a reviewed disposition releases a hold:**

```bash
node scripts/manual/stage0-go.mjs dispose --target <t> --attempt <attempt id> --reviewed <review file>
```

The review file must name the attempt id; its sha256 is recorded. Elapsed
time, a quiet STATE, a new phase or a new go release nothing. That the file
is a genuine review is a human check. Under UO-1 a held writing outcome
still keeps the counter closed until a separate reviewed incident decision.
A disposition releases a hold on an intact store only: it never excuses
damage (§7), not even to the attempt it names.

## 7. The store (I6-R1)

`%USERPROFILE%\.stage0-guard` holds the clock checks, the approval drafts,
the phases, the markers, the gos and the journal for every checkout on this
machine, so a fresh clone or a new window meets the same holds. **It is
never edited, moved or deleted by hand.**

- **The ledger.** Every change is one line of `ledger.jsonl`, with its
  sequence number, the sha256 of the line before, and the sha256 of each file
  it wrote. Every live command replays it under the store lock, and requires:
  - the store to be the one the repository's anchor names, for the
    manifest's refs;
  - every file the ledger names to exist, with its recorded sha256, where its
    lifecycle puts it (a used go in `gos/used/`, a closed marker in
    `markers/closed/`, …), and to carry the ids the ledger gives it;
  - every claim, outcome and disposition to belong to a go, a claim and a
    phase the ledger recorded, in order and once each;
  - no file the ledger does not name.

  Any difference is **DAMAGE**. Nothing is drafted, registered, opened,
  issued, sent, voided or disposed of; `status` reports it; `close` still
  runs where it can. A missing claim, outcome or disposition, a lost
  directory, a store that is not the anchored one, and a missing store are
  all damage, not a fresh start.
- **What the checks cannot see: a coherent rollback** (Codex, review of
  `22610f8`). The checks compare the ledger with the files, so they catch
  a loss that leaves the two disagreeing:
  - the newest claim lost together with its ledger line is damage. The go
    sits in `gos/used/` while the shortened ledger expects it live (ST-9);
  - the newest outcome lost together with its line leaves records that
    agree, but the claim is PENDING again, so the project stays held
    (ST-9).

  A store put back **as a whole** to a valid earlier state passes every
  check. That state might come from a restored profile, backup or snapshot,
  a sync rollback or a filesystem restore: in each case the used go is back
  in its live place too. Neither the anchor nor anything in the store
  records its latest sequence, and receipts outside the store are not
  searched. A PENDING attempt may have no receipt at all. So:
  - any known or suspected restore, sync rollback or storage loss affecting
    `%USERPROFILE%\.stage0-guard` is **STOP-and-review**;
  - **no backup or snapshot of the store is ever restored in place**, even
    when every check passes on it. Restoration is only the reviewed path
    below;
  - an unresolved send known from outside the store (a receipt, a
    transcript, a report) stays unresolved, whatever `status` says. If the
    latest history cannot be established, UO-1 applies. A clock check, a new
    marker or a new phase is not a disposition.

  This is a limit of a local mistake barrier, not an anti-rollback
  guarantee and not a behaviour to keep: another head file inside the same
  store would roll back with it and prove nothing.
- **The lock.** One `lock` file serializes every change. A command waits up
  to 10 s for it, then refuses. A stale lock (a guard process killed while
  holding it) is reported by `status`. It is removed by hand only after
  confirming no guard process runs, and that removal is recorded.
- **Restoration, the only way past damage.** It is a reviewed decision, not
  a command:
  1. STOP. No send, no new go.
  2. Move the damaged store aside, unchanged, as evidence, and record where.
  3. A review decides what the lost or damaged history means: every attempt
     whose outcome is not known stays undecided under UO-1. The review file
     names the lost store's id.
  4. `node scripts/manual/stage0-go.mjs init --restore --predecessor <lost store id> --reviewed <review file>`
     makes a new store that records its predecessor and the review's sha256.
  5. The new anchor is committed in review. Until it is at HEAD, every live
     command refuses.
