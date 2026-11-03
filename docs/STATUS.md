- Last updated: 2026-11-02
- HEAD (main): 7ec5af4 Merge pull request #47 (origin/main, 2026-09-20; unchanged, since no session log goes to main)
- CI (main): none (no GitHub Actions workflows; Netlify runs yarn test + yarn build on deploy)
- Security (main): none (no security workflow)
- Deploy: https://printcalculator2.netlify.app/
- Board: Print Calculator

## 2026-11-02 — T pushed; G-6 fixed (W, W2); the 4(c) plan revised (V, V2)
- Shipped: security/release-2-slice-2 04b6520..c62644a pushed 16:59Z (T only, cleared by Codex; staging deploy 6ae8c169; production unchanged); 3624efd..this commit local, for Codex's review
  - ed393be V: docs/security/stage0-item4c-plan.md answers Codex's review of U (U-1 to U-5, C1–C8) and records Ryan's decisions (Codex: AMEND, V-1 and V-2)
  - 4b7450d W: G-6's F1–F3 under Codex's review of the G-6 addendum (withLock retries EPERM/EACCES/EBUSY on acquisition only; status, gate and the sender's first check read one locked snapshot, BUSY not DAMAGED; G-6/AP-3 released on acknowledgement; LK-*, SN-* tests); the guard chain re-pinned (Codex: AMEND, W-R1 to W-R3, W-N1)
  - ea0c616 V2: the plan answers Codex's review of V: BUILD's non-public preflight with BUILD-00W (V-1); POST′'s reviewed Release 2 EXECUTE rows (V-2); the smoke order kept (C10) and the upload's file read; the data scope around P1′; P1′'s result schema; first receipts bound by hash; G-6's status; the image provenance
  - this commit (W2): Codex's review of W: status, gate and corroborate read their clock under the lock (W-R1, TM-*); LK-6 counts only witnessed sections (W-R2, LK-6b); the stale-lock procedure, procedure §7.1, in the refusal and the docs (W-R3, SN-6); within() clears the helpers' timers (W-N1, HL-1); the guard chain re-pinned
  - Not commits: the G-6 capture and addendum (Codex: ACCEPTED); W verified 537/537, build, replay 14 × 537; W's load campaign, as Codex counted it: 48 complete passing race TAP results (40 with exit 0, four 010 runs with exit 127, four 012 runs with no exit line), nine load suites 537/537, B #4 and C #4 stopped incomplete; T's push record with Ryan's Netlify read (§E13), uncommitted
- CI/Security on main: none
- Open issues touched: none
- Needs from Ryan: forward the V2 and W2 review requests to Codex
- Needs a ruling from Claude (chat): none
- Next planned step: Codex's rulings on V2 and W2; then the 4(c) implementation commit and the session clearances

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

## 2026-10-28 — Item 6 per-step ceilings (P, Q); first guard-store init; item 3 implementation (R)
- Shipped: O 22610f8 pushed 15:49Z (9404ee5..22610f8; staging only, cleared by Codex); the rest local
  - 30c0eba P: item 6 follow-up: per-step ceilings; Codex's tail-loss ruling (Codex: AMEND)
  - 4e2a375 Q: P-R1, Q-P1 (the exact go line), the per-send not-after, Q-P2
  - ba1a0bd R: item 3 read-token experiment implementation + guard store anchor (Codex, 10-29: AMEND)
  - Not a commit: the first guard-store init ran 17:23Z under Codex's narrow clearance (store 3389bb8f…)
- CI/Security on main: none
- Open issues touched: none
- Needs from Ryan: relay the Q and R review requests to Codex
- Needs a ruling from Claude (chat): none
- Next planned step: Codex's reviews of Q and R, then item 3's staging session at the head Codex names
