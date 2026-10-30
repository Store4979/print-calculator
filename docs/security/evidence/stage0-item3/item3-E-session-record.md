# Item 3, phase E: session record (working notes for plan §E15)

Fri 2026-10-30. Head H `04b6520aecbc597c6d963e3d7d64d58fcdcd0b7e`. Session
clone `C:\Dev\print-calculator-main\.review\item3-04b6520`. Staging
`lboajqihpsfrokqvjgnl` only.

## Before the go

- **14:59Z (approx.):** Ryan's message "Ready to start the item 3 phase E
  session now." arrives. He has two uninterrupted hours from it.
- **14:59:27.795Z, `stage0-go.mjs clock`:** offsets 11, 12 and 11 ms against
  time.windows.com (tolerance 2000 ms). w32tm source time.windows.com,0x9;
  last sync 10/30/2026 8:26:32 AM. High-water before: 2026-10-28T17:23:47.656Z.
  The check is valid until 15:59:27Z.
- **`status --target staging`:** intact; store `3389bb8f8df9280e7608c455249678f5`;
  2 events (init, clock); no holds, attempts, gos or markers; lock false.
- **14:59:49Z, `draft --workflow item3 --phase E --deadline 2026-10-30T16:49:00.000Z`:**
  approval `8231f9740c9a980e`, for item3 E at 04b6520 on lboajqihpsfrokqvjgnl.
  The line is shown in full to Ryan. Latest starts: E1 15:48 … E17 16:36 UTC,
  every 3 min. The deadline is 16:49 UTC (12:49 EDT).
- **Windows** (Ryan's pastes, about 15:09Z). Both are in the session clone:
  - HEAD `04b6520…`, `git status --short` empty, `Test-Path Env:NODE_OPTIONS`
    False;
  - `-AsSecureString` prompt with 44 asterisks; `StartsWith("sbp_")` True;
    `Length` 44; `STAGE0_SESSION` set;
  - no token value appeared in any paste;
  - the second window was first titled `STAGE0 E R - write token`. Claude
    asked for it to be retitled `STAGE0 E W - write token` (the title is a
    label only).
- **Ryan's report, about 15:14Z** (dashboard screenshots):
  - **Exposed schemas:** "2 of 2 schemas exposed", namely `graphql_public`
    and `public`. `stage0_item3` is not listed. The same page shows
    "Automatically expose new tables" ON, and the extra search path
    `public, extensions`.
  - **`stage0-item3-E-read-20261030`:**
    - resource access `print-calculator-staging` only;
    - capabilities: Database **READ** (6 endpoints) only ("Read on 1
      capability, across 1 project");
    - expires "in a day"; created "11 minutes ago"; last used Never.
  - **`stage0-item3-E-write-20261030`:**
    - resource access `print-calculator-staging` only;
    - capabilities: Database **READ-WRITE** (8 endpoints) only ("Read-write
      on 1 capability, across 1 project");
    - expires "in a day"; created "10 minutes ago"; last used Never.
  - **Mapping, confirmed by Ryan:** window R holds the read token, window W
    the write token.
  - **V-CLIP:** "cleared".

## The go and registration

- **15:16:50Z:** Ryan's go line arrives, alone in its message. It is
  byte-identical to the drafted line (`item3-E-receipts/go-E.txt`, sha256
  `7f4a79784a43f446…`).
- **15:17:08Z:** `phase --workflow item3 --phase E --go-text <file> --arrived
  2026-10-30T15:16:50.000Z --deadline 2026-10-30T16:49:00.000Z` registers
  phase **`c862e1bc2ce6258cbbd907b312b144ae`**. Its ceilings are E1 15:48 …
  E17 16:36 UTC.
- **Markers** (Ryan's pastes):
  - R `c7673a55feaccdfb2edefb6e3d5f3f1d`;
  - W `728ddf89c1e463ab196486f6cb50b1a5`.

  Each is `head 04b6520; staging lboajqihpsfrokqvjgnl; until
  2026-10-30T16:49:00.000Z`, and `status` printed "bound to this window".

## E1–E17

Each go was issued with no `--not-after`. The whole-path check at every step
left 27 to 60 min before the step's ceiling, at a measured pace of about
1 min per step. No clock renewal was needed: the last go was issued at
15:35:34Z, before the 15:54Z renewal mark. Each receipt was classified with
rule 3′, and the gate was read before the next go.

| step | text | window | go | sent (start) | HTTP | class | verdict | receipt sha256 |
|---|---|---|---|---|---|---|---|---|
| E1 | I3-SETUP | W | e90254ee… | 15:23:22.539Z | 201 | R2 | MATCH | 23b66619c6eb519b… |
| E2 | I3-FIXTURE | R | 5cdd8989… | 15:24:38.464Z | 201 | R2 | MATCH | 71faf11486052787… |
| E3 | I3-READBACK | W | 9a0f760c… | 15:25:43.753Z | 201 | R2 | MATCH | 2bd1c1169aae7ebf… |
| E4 | I3-WHO-R-RO | R | f8fd3585… | 15:26:35.516Z | 201 | R2 | MATCH | f42c20280e4bffe1… |
| E5 | I3-WHO-R-DEF | R | c8e8e967… | 15:27:57.356Z | 201 | R2 | MATCH | 97e5c09853fa5abc… |
| E6 | I3-WHO-W-RO | W | 56b7734d… | 15:28:46.840Z | 201 | R2 | MATCH | cf0e32d50e0f2086… |
| E7 | I3-WHO-W-DEF | W | 9e825e03… | 15:29:37.131Z | 201 | R2 | MATCH | 76fab0b34b5f70c0… |
| E8 | I3-INS-OWNED-W-RO | W | 8eb1bb2d… | 15:30:16.541Z | 400 25006 | R3 | MATCH | f77785432c6b6bc6… |
| E9 | I3-INS-OWNED-R-RO | R | 0d72ebb8… | 15:30:51.353Z | 400 25006 | R3 | MATCH | 69892b302efe7ba2… |
| E10 | I3-INS-OPEN-R-RO | R | 28d54861… | 15:31:26.019Z | 400 25006 | R3 | MATCH | c0f1a9a8b78a2dec… |
| E11 | I3-INS-OWNED-W-DEF | W | 28ce6fc3… | 15:32:02.240Z | 201 | R2 | MATCH | f92f8540c24cba29… |
| E12 | I3-DDL-W-DEF | W | 8ead837d… | 15:32:36.692Z | 201 | R2 | MATCH | 53f467f0ac23a4ce… |
| E13 | I3-READBACK | W | 01e4cc58… | 15:33:09.761Z | 201 | R2 | MATCH | f18a42083ced727c… |
| E14 | I3-INS-OPEN-R-DEF | R | fe20a115… | 15:33:50.070Z | 400 25006 | R3 | MATCH, **REFUSED** | d0049436bc7d4c5b… |
| E15 | I3-INS-OWNED-R-DEF | R | 4d5a7f23… | 15:34:44.097Z | 400 25006 | R3 | MATCH, **REFUSED** | 84e7055d25a42cc6… |
| E16 | I3-DDL-R-DEF | R | f72c5099… | 15:35:19.560Z | 400 25006 (CREATE TABLE) | R3 | MATCH, **REFUSED** | d5c9d95c4b09ef6e… |
| E17 | I3-READBACK | W | 00b8eb21… | 15:35:57.147Z | 201 | R2 | MATCH | 8bf6ef935ea10388… |

Byte-identical copies of all 17 receipts are in `item3-E-receipts/`.

**What came back:**
- **E2, the fixture:**
  - schema owner `postgres`, ACL `{postgres=UC/postgres,=UC/postgres}`;
  - `open` `{postgres=arwdDxtm/postgres,=ar/postgres}`, `owned`
    `{postgres=arwdDxtm/postgres}`;
  - row security off on both; 0 policies, triggers and rules;
  - objects exactly `open`, `open_pkey`, `owned`, `owned_pkey`;
  - `default_acls` `[]`: `postgres` has no default ACL, global or for
    `stage0_item3`.
- **The WHO rows.** Each describes only its own request:
  - **E4 (R, read_only), E5 (R, no read_only) and E6 (W, read_only)** are
    identical:
    - login and session role `supabase_read_only_user`;
    - `tx_read_only` on, `default_tx_read_only` on;
    - superuser false, bypass_rls true, write_all_data false,
      read_all_data true;
    - schema usage and create true;
    - `owned` insert false and select true; `open` insert true and select
      true.
  - **E7 (W, no read_only):**
    - login and session role `postgres`;
    - `tx_read_only` off, `default_tx_read_only` off;
    - superuser false, bypass_rls true, write_all_data false,
      read_all_data true;
    - schema usage and create true; insert and select on both tables true.
- **The readbacks:**
  - **E3:** no rows; the four base objects.
  - **E13:** `owned` row 4 (`I3-INS-OWNED-W-DEF`, written by `postgres`,
    `tx_read_only` off, 2026-10-30T15:32:02.488961+00:00); `open` empty; the
    base objects plus `ddl_w`, all owned by `postgres`.
  - **E17:** identical to E13.

## Terminal outcome and the separate-credential read

- **15:36:15Z, `gate`:** **COMPLETE-REFUSED**, with `wrote: []`,
  `corroborate: true`, `disposition: "Ryan or Codex"`, no holds and no
  lock. The output is in `item3-E-receipts/gate-after-E17.txt`.
- **About 15:36:30Z, the read:** sent once, by Claude, through this
  session's Supabase MCP `execute_sql`, to project `lboajqihpsfrokqvjgnl`.
  It used the MCP server's own authorization, neither PAT. The query is
  exactly the one `gate` printed. It returned six rows:
  - five objects (`ddl_w:r`, `open:r`, `open_pkey:i`, `owned:r`,
    `owned_pkey:i`), each owned by `postgres`;
  - one row in `owned`: `4`, `I3-INS-OWNED-W-DEF`, `postgres`, `postgres`,
    `off`.

  Saved exactly as `item3-E-receipts/corroboration-rows.json` (sha256
  `981749c9b98f7144…`).
- **15:36:46Z, `corroborate --phase c862e1bc… --rows <file>`:** exit 0,
  "AGREE: the separate-credential read agrees with E17 in every row, object
  and owner."

## Close-down

- **Both windows, in order** (Ryan's pastes):
  - `close`: "closed marker 728ddf89c1e463ab196486f6cb50b1a5; voided 0
    unused go(s)" (W) and "closed marker c7673a55feaccdfb2edefb6e3d5f3f1d;
    voided 0 unused go(s)" (R);
  - then `Remove-Item Env:SUPABASE_ACCESS_TOKEN`,
    `Remove-Item Env:STAGE0_SESSION`, `exit`.
- **Ryan:** "Confirmed tokens are deleted and clipboard cleared." It
  arrived by 15:41Z. The exact deletion time was not stated.
- **15:41:22Z, `status --target staging`:** intact; 59 events; 17
  attempts, each DISPATCHED with its outcome recorded; no holds, live gos or
  markers; lock false. The session clone is still at H with an empty status.

## What remains

- **On staging:** `stage0_item3` stays, with `owned` row 4 and `ddl_w`. It
  is the evidence; X is not cleared.
- **The disposition:** COMPLETE-REFUSED with an AGREE read. Under runbook §7
  Ryan may approve E's disposition himself. X needs that review file
  (`--reviewed`), a fresh phase go, and fresh tokens and windows.

## The disposition (approved)

- **The draft:** `item3-E-disposition.md`, 18970 bytes, sha256
  `28189dfa646893df4e6d601290d8cde795ee7e50495f22c7f9adcecbbceedc37`. It
  was generated from the evidence files and checked against them.
- **The approval:** Ryan's line, alone in his message, arrived
  2026-10-30T16:34:36Z: `APPROVE item 3 phase E disposition
  c862e1bc2ce6258cbbd907b312b144ae, sha256 28189dfa…5f22c7f9adcecbbceedc37`.
  It names exactly the draft's hash, which was re-checked before appending.
- **The final file:** the draft plus an appended "Approved" block (his line
  verbatim, its arrival time, the draft hash): 19437 bytes, sha256
  **`00d5e2dce339b37050d49578f66165d00562768f1bd2575ee83fa95896f51c8c`**.
  Its first 18970 bytes are the draft, byte for byte. X's registration
  names this file.
