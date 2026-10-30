# Item 3, phase X: session record (working notes for plan §E15)

Fri 2026-10-30. Head H `04b6520aecbc597c6d963e3d7d64d58fcdcd0b7e`. Session
clone `C:\Dev\print-calculator-main\.review\item3-04b6520`. Staging
`lboajqihpsfrokqvjgnl` only.

## Before the go

- **About 16:37:50Z:** Ryan's message "Ready to start the item 3 phase X
  session now." arrives. He has one uninterrupted hour from it.
- **16:37:58.986Z, `stage0-go.mjs clock`:** offsets 21, 21 and 20 ms against
  time.windows.com (tolerance 2000 ms). High-water before:
  2026-10-30T15:35:57.146Z. The check is valid until 16:37:58Z + 60 min.
- **`status --target staging`:**
  - intact; store `3389bb8f8df9280e7608c455249678f5`; 60 events;
  - E's 17 attempts, all DISPATCHED;
  - no holds, gos or markers; lock false.
- **The disposition** `reviews/requests/item3-E-disposition.md` hashes to
  `00d5e2dce339b37050d49578f66165d00562768f1bd2575ee83fa95896f51c8c`, the
  approved final file.
- **16:38:11Z, `draft --workflow item3 --phase X --deadline 2026-10-30T17:27:00.000Z`:**
  approval `bb21e873878730fb`, for item3 X at 04b6520 on lboajqihpsfrokqvjgnl.
  Latest starts: X1 17:11 and X2 17:14 UTC. The deadline is 17:27 UTC
  (13:27 EDT).
- **Ryan's report:**
  - **Exposed schemas** (screenshot): "2 of 2 schemas exposed",
    `graphql_public` and `public`. `stage0_item3` is not listed.
  - **Windows** (pastes):
    - `STAGE0 X R - read token` and `STAGE0 X W - write token`, both in the
      session clone;
    - HEAD `04b6520…`, status empty, `NODE_OPTIONS` False;
    - 44 asterisks; True; 44; `STAGE0_SESSION` set;
    - no token value in any paste.
  - **`stage0-item3-X-read-20261030`:** resource access
    `print-calculator-staging` only; Database **READ** (6 endpoints) only
    ("Read on 1 capability, across 1 project"); expires "in a day"; last
    used Never; created "9 minutes ago" in the screenshot with its name.
  - **`stage0-item3-X-write-20261030`:** resource access
    `print-calculator-staging` only; Database **READ-WRITE** (8 endpoints)
    only ("Read-write on 1 capability, across 1 project"); expires "in a
    day"; last used Never; created "8 minutes ago".
  - The first pair of screenshots had the header cropped, so the names
    were not visible. Claude asked for the names; the second pair shows
    them.
  - **Mapping:** confirmed (R holds the read token, W the write token).
  - **V-CLIP:** "cleared".

## The go and registration

- **16:50:15Z:** Ryan's go line arrives, alone in its message. It is
  byte-identical to the drafted line (`item3-X-receipts/go-X.txt`, sha256
  `c406cf84a737f618436f26808ff1d9f51a40caf35214db471ba7ec165c74c098`).
- **16:50:25Z:** `phase --workflow item3 --phase X --go-text <file> --arrived
  2026-10-30T16:50:15.000Z --deadline 2026-10-30T17:27:00.000Z --reviewed
  C:/Dev/print-calculator-main/reviews/requests/item3-E-disposition.md`
  registers phase **`9dee28cfef698015cd346341cb021ee4`**. The disposition
  hashed to `00d5e2dce339b37050d49578f66165d00562768f1bd2575ee83fa95896f51c8c`
  just before. The ceilings are X1 17:11 and X2 17:14 UTC.
- **Markers** (Ryan's pastes):
  - R `30d3c9708fcef189ac1fc9420645e0f2`;
  - W `1f4671fb156187dea66629f789cfb864`.

  Each is `head 04b6520; staging lboajqihpsfrokqvjgnl; until
  2026-10-30T17:27:00.000Z`, and `status` printed "bound to this window".

## X1–X2

Each go was issued with no `--not-after`; the whole-path check left 19 and
21 min before the ceilings. No clock renewal was needed.

| step | text | window | read_only | go | attempt | sent | HTTP | body | class | verdict | receipt sha256 | bytes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| X1 | I3-CLEANUP | W | false | `cd249082a9c951022f8aff62668049ff` | `8bc3cc22b7b696b6273e4c48b98899b2` | 16:52:17.813Z → 16:52:18.201Z | 201 | `[{"gone":true}]` | R2 | MATCH | `e4a29e6dcd969cec19965cc91468e62aefa5cf77e408a88869a5e37100d38f8c` | 907 |
| X2 | I3-ABSENT | R | true | `134d68cd6e54c988dbc8aa48eb13395b` | `1adf7f74a620f98df654c1bebd511404` | 16:53:32.100Z → 16:53:32.470Z | 201 | `[{"gone":true}]` | R2 | MATCH | `f69df333cfba4cf37128e22c5dd3dd21707d4ca3811a793f6a57861a14e2572a` | 905 |

Both receipts have `error` null and `tokenRedactedFromResponse` false.
Byte-identical copies are in `item3-X-receipts/`.

- **16:53:47Z, `gate --phase 9dee28cf…`:** terminal outcome **COMPLETE**,
  with `corroborate` false (X has no separate read), no holds and no lock.
  The output is `item3-X-receipts/gate-after-X2.txt`, sha256
  `9f61910587d2e3a54612b22522bbe56fc0c58930ab6940cc11108aae72cb6cbb`.

## Close-down

- **Both windows, in order** (Ryan's pastes):
  - `close`: "closed marker 30d3c9708fcef189ac1fc9420645e0f2; voided 0
    unused go(s)" (R) and "closed marker 1f4671fb156187dea66629f789cfb864;
    voided 0 unused go(s)" (W);
  - then `Remove-Item Env:SUPABASE_ACCESS_TOKEN`,
    `Remove-Item Env:STAGE0_SESSION`, `exit`.
- **Ryan:** "tokens deleted / non listed / clipboard cleared". It arrived by
  about 16:56Z. The exact deletion time was not stated.
- **16:56:37Z, `status --target staging`:**
  - intact; 72 events;
  - 19 attempts (E1–E17, X1, X2), each DISPATCHED with its outcome
    recorded;
  - no holds, live gos or markers; lock false.

  The session clone is still at H with an empty status.

## Result

Item 3 is complete on staging:
- E is COMPLETE-REFUSED, with the separate read agreeing;
- E's disposition was approved by Ryan (final sha256 `00d5e2dc…`);
- X is COMPLETE, and `stage0_item3` is gone.

Nothing from item 3 remains on staging. Production was not touched.
