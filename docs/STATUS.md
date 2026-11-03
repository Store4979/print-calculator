- Last updated: 2026-11-03
- HEAD (main): 7ec5af4 Merge pull request #47 (origin/main, 2026-09-20; unchanged, since no session log goes to main)
- CI (main): none (no GitHub Actions workflows; Netlify runs yarn test + yarn build on deploy)
- Security (main): none (no security workflow)
- Deploy: https://printcalculator2.netlify.app/
- Board: Print Calculator

## 2026-11-03 — The records (X0); X1, the rehearsal target; X1b, Codex's AMEND of X1
- Shipped: security/release-2-slice-2 d8ec242..this commit (local, for Codex's review)
  - 50f8f0e X0: the records only, no code: T's and W2's push records (production plan §E13); in the 4(c) plan, V2's acceptance and rulings (C13, Realtime, attribution), the two image observations, W's AMEND and W2, the load accounting, and Ryan's four decisions on the outline (§0.2) (Codex: ACCEPT)
  - 4037d12 X1: the rehearsal target in the guard store (target add/retire, activeRef in every live command, storeCheck's target rules; synthetic refs only, the store's identity and anchor unchanged) and M-12's C8 effect rule; TG-1..7, TG-M (10 mutants), M-12b; the guard chain re-pinned (Codex: AMEND, X1-R1 blocking, X1-N1, the standing rule)
  - this commit (X1b): dispose refuses a retired ref's attempt before writing (X1-R1); the retirement rule as it is, with post-retirement close and void (X1-N1); TG-8, TG-9, TG-4's HOLD disposition, an 11th mutant; the standing rule on the real store (CLAUDE.md, procedure §7.2) and the departure record (production plan §E16); no test falls back to the real store (Ryan's ruling on ORD; Codex's review of 7168fc0): ORD's children and the fixture's launchers run with a synthetic home (syntheticHomeEnv), ORD checks a child's actual default store path, ORD-S puts a store read before each command line's preflight and finds it reaches only a sentinel store, SEND-4's live-path calls name a state directory, and the launch check LN-1..3 keeps it so; the guard chain re-pinned; this log
  - Not commits: X1's clean verification (555/555, build, replay 14 × 555, exit 0), superseded by X1b's (see its review request); X1b's first form (7168fc0; Codex: X1-R1, X1-N1, the rule and §E16 ACCEPTED, ORD AMEND) and second (f1d6112, never sent) amended with the ORD changes, their verifications stopped; the departure: an unreviewed, unlocked storeCheck on the real store at X1 (15:03Z), recorded in §E16, not evidence, not rerun
- CI/Security on main: none
- Open issues touched: none
- Needs from Ryan: forward the X1b review request to Codex (reviews/requests/codex-review-request-X1b.md)
- Needs a ruling from Claude (chat): none
- Next planned step: Codex's review of X1b; on acceptance, the staging-only push of X1b's exact hash (carrying X0 and X1); then X2 under the outline

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
