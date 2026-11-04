- Last updated: 2026-11-04
- HEAD (main): 7ec5af4 Merge pull request #47 (origin/main, 2026-09-20; unchanged, since no session log goes to main)
- CI (main): none (no GitHub Actions workflows; Netlify runs yarn test + yarn build on deploy)
- Security (main): none (no security workflow)
- Deploy: https://printcalculator2.netlify.app/
- Board: Print Calculator

## 2026-11-04 — X2c accepted, and X2 to X2c pushed to staging; X3, item 4(c)'s writing texts
- Shipped: security/release-2-slice-2 a5a05ec..47a0b69 pushed 19:12Z (X2, X2b, X2c, under Codex's review of 47a0b69; staging deploy 6aeb8393; production unchanged); 47a0b69..this commit local, for Codex's review
  - 47a0b69 X2c: Codex's review of X2b: under `empty`, only the exact reviewed document, byte for byte (B1), and the one relation form; absent-schema and absent-table only with the matching schema and table facts, an empty relation and columns, no constraint or trigger fact, and <not read> (B2); an unknown fact and a non-object row stop; the schema-ACL comparison scope and X4's images obligation recorded (4(c) plan §0.4, §2.2); CLAUDE.md's to_regclass line narrowed; 4C-18, 4C-19, 4C-M1 at 52 mutants; the comparator re-pinned; no SQL text, send policy or fixture changed (Codex: ACCEPT, pushed)
  - this commit (X3): P1-4C (P1′, its proofs source, 11 lock boundaries, its exact result and cap); BUILD-01 as a function of the facts B1 binds, with its re-assertion before the first file, and no text, policy or target until B1; M-6g; the preflight predicates in the comparator and in BUILD-01's SQL; the classifier's success entries and declared PERFORMs; the sender binds the step's declared text, go.text and the planned text (G-28, a G-26 mutant); the local run and its fixtures; 4W-1..4W-14, 4W-M1..M3; the guard chain re-pinned; no rehearsal target and no change to a preserved text's policy; this log
  - Not commits: X2b's replay finished after Codex's inspection (14 × 577, exit 0, 00:17:54Z); a local check that BUILD-00's text reports `empty` for an RLS-exempt reader (.review/x2c-evidence); X2c's clean verification (579/579, build, M-13, harness 33 PASS, replay 14 × 579, exit 0, 18:48:54Z); the X2c push record (production plan §E13), written and uncommitted, waiting for Ryan's Netlify read
- CI/Security on main: none
- Open issues touched: none
- Needs from Ryan: the Netlify read after the X2c push; forward the X3 review request to Codex (reviews/requests/codex-review-request-X3.md)
- Needs a ruling from Claude (chat): none
- Next planned step: Codex's review of X3, which asks a staging-only push clearance naming its hash; then X4 (the workflows, the production gate and both runbooks)

## 2026-11-03 — X0 to X1c pushed to staging; X2, item 4(c)'s read texts and comparator (Codex: AMEND); X2b
- Shipped: security/release-2-slice-2 d8ec242..a5a05ec pushed 18:37Z (X0, X1, X1b, X1c, under Codex's review of a5a05ec after its replay condition, 14 × 559/559, exit 0; staging deploy 6aea29e4; production unchanged); a5a05ec..5ae51c6 local, for Codex's review
  - 50f8f0e X0: the records only, no code: T's and W2's push records (production plan §E13); in the 4(c) plan, V2's acceptance and rulings (C13, Realtime, attribution), the two image observations, W's AMEND and W2, the load accounting, and Ryan's four decisions on the outline (§0.2) (Codex: ACCEPT)
  - 4037d12 X1: the rehearsal target in the guard store (target add/retire, activeRef in every live command, storeCheck's target rules; synthetic refs only, the store's identity and anchor unchanged) and M-12's C8 effect rule; TG-1..7, TG-M (10 mutants), M-12b; the guard chain re-pinned (Codex: AMEND, X1-R1 blocking, X1-N1, the standing rule)
  - d160c6e X1b: dispose refuses a retired ref's attempt before writing (X1-R1); the retirement rule as it is, with post-retirement close and void (X1-N1); TG-8, TG-9, TG-4's HOLD disposition, an 11th mutant; the standing rule on the real store (procedure §7.2, CLAUDE.md) and the departure record (§E16); no test falls back to the real store: syntheticHomeEnv for ORD's children and the fixture's launchers, ORD's default-path probe, ORD-S's early-read sentinel, SEND-4's explicit path; a whole-tree launch analyzer (LN-1, LN-2); the guard chain re-pinned (Codex: X1-R1, X1-N1, the rule, §E16 and all four ORD requirements ACCEPTED; the analyzer AMEND, LN-R1 and LN-R2; amended twice before review of the ORD part, from 7168fc0 and f1d6112)
  - a5a05ec X1c: the analyzer removed and deferred (Ryan; 4(c) plan §13): stage0-guard-launch-check.mjs, LN-1 and LN-2 gone, LN-3 kept, and no claim left that a static check enforces safe launches; CLAUDE.md workflow rule 7 (keep .review evidence until Codex's verdict) (Codex: ACCEPT, pushed)
  - e6f99bf X2: item 4(c)'s read texts (P0-4C, POST-4C, WHO-4C-*, STATE-4C, BUILD-00, BUILD-00W; four pinned SQL sources; policies exact, production only, BUILD-00/00W no target; M-6f) and the pure comparator stage0-4c-compare.mjs (V-2's rows, the step states, the data scope, the tiers, receipt binding), pinned by listing (CHAIN_LISTED); the classifier's shape entries; the local PGlite harness and its fixtures (runs A, C, D, F); 4C-1..4C-10 and 4C-M1 (12 mutants) (Codex: AMEND, R1 to R5 and the BUILD-00 ledger read; no push; the sender's text-to-step binding set for X3)
  - 5ae51c6 X2b: Codex's review of X2: the sequence default maps S to s for acldefault (R1); default ACL entries keep the grant option (R2, and public's own ACL); any different server_version_num stops, a build in version() and an image in the project list each need their record (R3); an event trigger takes only its own record (R4); requiredFindings on each reading before any comparison, the data scope's facts included (R5); BUILD-00's guarded ledger read through query_to_xml on one reviewed literal, build00LedgerFindings, M-6f's nested rule; runs G and L, the fixtures regenerated, 4C-11..4C-17, 4C-M1 at 34 mutants; the X1c push record (production plan §E13); 4(c) plan §0.3; this log (Codex: R1 to R5, the guarded SQL read, M-6f's nested rule and both additions ACCEPTED; AMEND, B1 and B2 in build00LedgerFindings; no push)
  - Not commits: X1's clean verification (555/555, build, replay 14 × 555, exit 0); 7168fc0's, f1d6112's and d160c6e's clean verifications, each stopped for the next commit after its suite, build and manifest check (557, 560, 561/561); their logs kept, and f1d6112's and d160c6e's clones (7168fc0's was deleted mid-review before rule 7: Codex's LC-3/4/5); X1c's verification (559/559, build, replay 14 × 559, exit 0); X2's clean verification (570/570, build, replay 14 × 570, exit 0; Codex accepted the results, which do not close R1 to R5); Ryan's Netlify read after the X1c push (no new production deploy, by about 22:14Z); X2b's clean verification (577/577, build, harness 33 PASS, replay 14 × 577, exit 0), after a first precheck that failed on the script's own node_modules link (kept, .review/precheck-X2b-1); the departure: an unreviewed, unlocked storeCheck on the real store at X1 (15:03Z), recorded in §E16, not evidence, not rerun
- CI/Security on main: none
- Open issues touched: none
- Needs from Ryan: forward the X2b review request to Codex (done)
- Needs a ruling from Claude (chat): none
- Next planned step: Codex's review of X2b (done: AMEND); then X3 under the outline; the launch analyzer only as its own reviewed work

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
