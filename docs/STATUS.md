- Last updated: 2026-11-03
- HEAD (main): 7ec5af4 Merge pull request #47 (origin/main, 2026-09-20; unchanged, since no session log goes to main)
- CI (main): none (no GitHub Actions workflows; Netlify runs yarn test + yarn build on deploy)
- Security (main): none (no security workflow)
- Deploy: https://printcalculator2.netlify.app/
- Board: Print Calculator

## 2026-11-03 — X0 to X1c pushed to staging; X2, item 4(c)'s read texts and comparator
- Shipped: security/release-2-slice-2 d8ec242..a5a05ec pushed 18:37Z (X0, X1, X1b, X1c, under Codex's review of a5a05ec after its replay condition, 14 × 559/559, exit 0; staging deploy 6aea29e4; production unchanged); a5a05ec..this commit local, for Codex's review
  - 50f8f0e X0: the records only, no code: T's and W2's push records (production plan §E13); in the 4(c) plan, V2's acceptance and rulings (C13, Realtime, attribution), the two image observations, W's AMEND and W2, the load accounting, and Ryan's four decisions on the outline (§0.2) (Codex: ACCEPT)
  - 4037d12 X1: the rehearsal target in the guard store (target add/retire, activeRef in every live command, storeCheck's target rules; synthetic refs only, the store's identity and anchor unchanged) and M-12's C8 effect rule; TG-1..7, TG-M (10 mutants), M-12b; the guard chain re-pinned (Codex: AMEND, X1-R1 blocking, X1-N1, the standing rule)
  - d160c6e X1b: dispose refuses a retired ref's attempt before writing (X1-R1); the retirement rule as it is, with post-retirement close and void (X1-N1); TG-8, TG-9, TG-4's HOLD disposition, an 11th mutant; the standing rule on the real store (procedure §7.2, CLAUDE.md) and the departure record (§E16); no test falls back to the real store: syntheticHomeEnv for ORD's children and the fixture's launchers, ORD's default-path probe, ORD-S's early-read sentinel, SEND-4's explicit path; a whole-tree launch analyzer (LN-1, LN-2); the guard chain re-pinned (Codex: X1-R1, X1-N1, the rule, §E16 and all four ORD requirements ACCEPTED; the analyzer AMEND, LN-R1 and LN-R2; amended twice before review of the ORD part, from 7168fc0 and f1d6112)
  - a5a05ec X1c: the analyzer removed and deferred (Ryan; 4(c) plan §13): stage0-guard-launch-check.mjs, LN-1 and LN-2 gone, LN-3 kept, and no claim left that a static check enforces safe launches; CLAUDE.md workflow rule 7 (keep .review evidence until Codex's verdict) (Codex: ACCEPT, pushed)
  - this commit (X2): item 4(c)'s read texts (P0-4C, POST-4C, WHO-4C-*, STATE-4C, BUILD-00, BUILD-00W; four pinned SQL sources; policies exact, production only, BUILD-00/00W no target; M-6f) and the pure comparator stage0-4c-compare.mjs (V-2's rows, the step states, the data scope, the tiers, receipt binding), pinned by listing (CHAIN_LISTED); the classifier's shape entries; the local PGlite harness and its fixtures (runs A, C, D, F); 4C-1..4C-10 and 4C-M1 (12 mutants); this log
  - Not commits: X1's clean verification (555/555, build, replay 14 × 555, exit 0); 7168fc0's, f1d6112's and d160c6e's clean verifications, each stopped for the next commit after its suite, build and manifest check (557, 560, 561/561); their logs kept, and f1d6112's and d160c6e's clones (7168fc0's was deleted mid-review before rule 7: Codex's LC-3/4/5); X1c's verification (559/559, build, replay 14 × 559, exit 0); the X1c push record (production plan §E13), uncommitted, for the next records commit; the departure: an unreviewed, unlocked storeCheck on the real store at X1 (15:03Z), recorded in §E16, not evidence, not rerun
- CI/Security on main: none
- Open issues touched: none
- Needs from Ryan: the Netlify dashboard read after the X1c push; forward the X2 review request to Codex (reviews/requests/codex-review-request-X2.md)
- Needs a ruling from Claude (chat): none
- Next planned step: Codex's review of X2; then X3 (the writing texts) under the outline; the launch analyzer only as its own reviewed work

## 2026-11-02 — T and W2 pushed; G-6 fixed (W, W2); the 4(c) plan accepted (V2)
- Shipped: security/release-2-slice-2 04b6520..c62644a pushed 16:59Z (T only, cleared by Codex; staging deploy 6ae8c169; production unchanged); c62644a..d8ec242 pushed 2026-11-03 02:20Z (U, V, W, V2, W2, under Codex's review of d8ec242 after its replay condition; staging deploy 6ae9450b; production unchanged)
  - ed393be V: docs/security/stage0-item4c-plan.md answers Codex's review of U (U-1 to U-5, C1–C8) and records Ryan's decisions (Codex: AMEND, V-1 and V-2)
  - 4b7450d W: G-6's F1–F3 under Codex's review of the G-6 addendum (withLock retries EPERM/EACCES/EBUSY on acquisition only; status, gate and the sender's first check read one locked snapshot, BUSY not DAMAGED; G-6/AP-3 released on acknowledgement; LK-*, SN-* tests); the guard chain re-pinned (Codex: AMEND, W-R1 to W-R3, W-N1)
  - ea0c616 V2: the plan answers Codex's review of V: BUILD's non-public preflight with BUILD-00W (V-1); POST′'s reviewed Release 2 EXECUTE rows (V-2); the smoke order kept (C10) and the upload's file read; the data scope around P1′; P1′'s result schema; first receipts bound by hash; G-6's status; the image provenance (Codex: ACCEPT at plan level; its push held for W2)
  - d8ec242 W2: Codex's review of W: status, gate and corroborate read their clock under the lock (W-R1, TM-*); LK-6 counts only witnessed sections (W-R2, LK-6b); the stale-lock procedure, procedure §7.1, in the refusal and the docs (W-R3, SN-6); within() clears the helpers' timers (W-N1, HL-1); the guard chain re-pinned (Codex: ACCEPT, with the outline's split and decisions 5–9 ruled)
  - Not commits: the G-6 capture and addendum (Codex: ACCEPTED); W verified 537/537, build, replay 14 × 537; W's load campaign, as Codex counted it: 48 complete passing race TAP results (40 with exit 0, four 010 runs with exit 127, four 012 runs with no exit line), nine load suites 537/537, B #4 and C #4 stopped incomplete; not 200 completed runs, and not 48 captured zero exits; W2 verified 546/546, build, replay 14 × 546 (exit 0); W2's short cold-load sample after the push: 12 runs, all exit 0, the nine race tests ok in each, 35–40 s per run, at a mild load; the 4(c) implementation outline (reviews/requests); this session's records (the push records, V2's acceptance, the image observations, W's AMEND and W2) went into the next session's X0
- CI/Security on main: none
- Open issues touched: none
- Needs from Ryan: the outline's decisions 1–4; the word to start X1 (both given 2026-11-03)
- Needs a ruling from Claude (chat): none
- Next planned step: X1 (the rehearsal target and M-12) under the outline, when Ryan says; the docs commit for these records when he asks

## 2026-10-31 — T verified; the item 4(c) plan (docs commit U)
- Shipped: security/release-2-slice-2 c62644a..this commit (local, for Codex's review)
  - this commit (U): docs/security/stage0-item4c-plan.md, the rehearsal from 01, the recovery mapping and the window
  - Not commits: T's review request finished (3 replays: 40 of 42 suites green, G-6 failed twice, assertion not captured)
- CI/Security on main: none
- Open issues touched: none
- Needs from Ryan: forward T's and U's review requests; decide on the throwaway project and the window option (plan §12)
- Needs a ruling from Claude (chat): none
- Next planned step: Codex's reviews of T (with G-6) and U; then the 4(c) implementation commit

## 2026-10-30 — Item 3 on staging: phase E COMPLETE-REFUSED, disposition approved, phase X cleanup; docs commit T
- Shipped: security/release-2-slice-2 04b6520..c62644a (local, for Codex's review)
  - c62644a T:
    - the Q and R+S push records (§E13);
    - the item 3 record (§E15) and its evidence in docs/security/evidence/stage0-item3/;
    - the session-log and push-form rules
  - Not commits: phase E (c862e1bc…) and phase X (9dee28cf…) ran on staging, 19 sends, all MATCH; production untouched
- CI/Security on main: none
- Open issues touched: none
- Needs from Ryan: forward T's review request to Codex
- Needs a ruling from Claude (chat): none
- Next planned step: Codex's review of T; then the item 4(c) plan (the rehearsal from 01) for Codex

## 2026-10-29 — Q pushed; S accepted and pushed with R; main back to origin
- Shipped: security/release-2-slice-2 22610f8..04b6520, in two Codex-cleared pushes
  - Q 4e2a375 pushed 17:35Z (22610f8..4e2a375, carrying P; staging deploy 6ae383ff)
  - 04b6520 S: item 3, R-R1, R-R2, R-R3 and the gate's mutation companion (Codex: ACCEPT)
  - R+S pushed 23:49Z (4e2a375..04b6520; staging deploy 6ae3db97); production unchanged
  - main: 15e0c91 and 19dfb0a moved to the local-only branch session-log-draft; main reset to 7ec5af4
- CI/Security on main: none
- Open issues touched: none
- Needs from Ryan: the Netlify reads after both pushes (done)
- Needs a ruling from Claude (chat): none
- Next planned step: item 3 phase E on staging at H = 04b6520
