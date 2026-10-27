# Stage 0 — the guarded sender: the procedure for every later session

**Status: DRAFT, for Codex's review with the item 6 implementation.** It
clears no session, token, send or window. Item 3's staging experiment is the
first session expected to run under it, under its own reviewed runbook and go.

**Sources:**
- the item 6 plan, `docs/security/stage0-item6-sender-guards-plan.md`, as
  amended by Codex's review of 2026-10-27 (SG-1 to SG-6; its §A);
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
| **P3** the gate before every send | `stage0-go.mjs issue` runs the phase's gate on the journal, and the sender runs it again under the project lock. Only the step the gate names is issued or admitted. | Whether the whole remaining path fits before the reserve's end (the time rule) is Claude's stated check, not code. |
| **P4** only this session's fresh results | The gate reads receipts through the journal: each by its recorded sha256, with a guard block equal to its claim. A receipt without one, a stripped or edited one, or a historical one stops the phase. | — |
| **P5** every pause is an exit | Nothing detects a person stepping away. The marker's end (the phase deadline) and the clock check's 60 minutes bound how long a forgotten window stays usable. | **Every pause is an exit (§5).** |
| **P6** exit codes and banners are not authorization | The sender's banner now says so. An unresolved writing outcome holds the project until a reviewed disposition (§6), in every window and every later phase. | Reading the classification and the step's check before asking for the next go. |

The guards are a mistake barrier, not a sandbox. Anyone who edits the pinned
files, the state directory (§7) or the environment by hand can defeat them;
the pins, review and these procedures are the controls for that.

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
   - Every guard tool records the latest time it has seen. A clock more than
     **2 s** behind that time has gone back: every tool refuses until a new
     clock check.
   - If w32tm cannot reach the server, or the offset is beyond 2 s, there is
     no session until the clock is corrected and checked again.
   - What this establishes: this machine's clock agreed with the time server
     within 2 s at that check. It says nothing about when a server starts a
     request, and it cancels nothing.

## 2. The phase go

1. **RYAN** reports the token's name, scope, level and actual expiry, as
   before.
2. **CLAUDE** drafts the complete go line. It must contain, exactly:
   - `GO phase <P> ` (with the space);
   - the head's first 7 characters;
   - the target's ref;
   - every step id of the phase;
   - the deadline as `YYYY-MM-DD HH:MM UTC`, with the Eastern time beside it
     and both dates (October is UTC−4; after 1 November 2026, UTC−5).

   The deadline is the latest start of the phase's last step, inside the
   token's expiry.
3. **RYAN** returns it word for word. Its arrival is the go time.
4. **CLAUDE** writes Ryan's message, exactly, to a file outside the
   checkout, and records it within 10 minutes of its arrival, with at least
   30 minutes left:

   ```bash
   node scripts/manual/stage0-go.mjs phase --workflow capture --phase <P> --go-text <file> --arrived <UTC> --deadline <UTC> [--reviewed <file>]
   ```

   It refuses unless the text names everything in point 2. A phase that
   needs a reviewed decision (U) names the review file. A token-shaped value
   in the text is a STOP. It prints the phase id. Recording checks what the
   message says; it does not show who sent it, which stays Ryan's chat.

   Only the item 2 capture phases are declared today. A production phase,
   or item 3's, is declared in code with its gate, in review, before any go
   for it can be recorded.

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

1. **CLAUDE** issues the step's go:

   ```bash
   node scripts/manual/stage0-go.mjs issue --phase <phase id> --step <STEP>
   ```

   It refuses unless the gate names this step, exactly one live window of
   the step's role is open for the phase, the project holds nothing, and no
   other unused go is outstanding. It prints one command, for one window:

   ```powershell
   node scripts/manual/stage0-send.mjs <TEXT> --target <t> --confirm-ref <ref> --go <32-character id>
   ```

   The go's deadline is the phase deadline less 60 s. Claude also states the
   time rule (the remaining path fits before the reserve's end), which the
   tools do not compute.
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

- `close` removes the window's marker and its unused gos. It checks no pin,
  head or clock, so it works when they fail. If it fails anyway, the next
  three lines and the token deletion still happen.
- The journal, the used gos and the receipts stay: they are the evidence.
- A window closed without `close` leaves a marker no other process matches;
  it ends at the phase deadline, and a new window of that role replaces it.
- **A pause is not detectable.** A window someone walks away from stays
  usable until the phase deadline. The exit is the control.

## 6. Holds and dispositions

The journal holds the **project**, for every window, phase and checkout
(§7), when an attempt:
- is **PENDING**: claimed, with no recorded outcome. That is a send in
  flight, or one whose process died. No go is issued and no send admitted
  while it stands;
- is **HOLD**: its receipt is missing, altered or unbound to its claim; a
  journal file is malformed; or it is a writing send that rule 3′ classifies
  R1 or R4.

A NOT_SENT attempt (the deadline passed in the last check before fetch)
holds nothing, and its step stays next. Its go is used: a new go is issued.

**Only a reviewed disposition releases a hold:**

```bash
node scripts/manual/stage0-go.mjs dispose --target <t> --attempt <attempt id> --reviewed <review file>
```

The review file must name the attempt id; its sha256 is recorded. Elapsed
time, a quiet STATE, a new phase or a new go release nothing. That the file
is a genuine review is a human check. Under UO-1 a held writing outcome
still keeps the counter closed until a separate reviewed incident decision.

## 7. The state directory

`%USERPROFILE%\.stage0-guard` holds the clock check, the phases, the
markers, the gos and the journal for every checkout on this machine, so a
fresh clone or a new window meets the same holds. **It is never edited,
moved or deleted by hand.** A stale `lock-<ref>` file (a guard process
killed under the lock) is reported by `status`; it is removed by hand only
after confirming no guard process runs, and that removal is recorded.
