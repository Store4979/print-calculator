- Last updated: 2026-10-30
- HEAD (main): 7ec5af4 Merge pull request #47 (origin/main, 2026-09-20; unchanged, since no session log goes to main)
- CI (main): none (no GitHub Actions workflows; Netlify runs yarn test + yarn build on deploy)
- Security (main): none (no security workflow)
- Deploy: https://printcalculator2.netlify.app/
- Board: Print Calculator

## 2026-10-30 — Item 3 on staging: phase E COMPLETE-REFUSED, disposition approved, phase X cleanup; docs commit T
- Shipped: security/release-2-slice-2 04b6520..this commit (local, for Codex's review)
  - this commit (T):
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

## 2026-10-27 — Item 2 complete (capture commit, C-COMB); item 6 guarded sender and its correction O
- Shipped: security/release-2-slice-2 1042d2c..22610f8 (not main)
  - 95ecd65 Item 2 capture commit: the 15 staging receipts; SUPPORT from them
  - 9404ee5 Item 2, Codex's review of 95ecd65 (C-COMB): R3 only for the five witnessed profiles
  - 0687296 CL-28: each profile mutant must make its named negative exactly R3
  - 78db6dc Item 6: the guarded sender (Codex's review of the item 6 plan, SG-1 to SG-6)
  - 22610f8 O: item 6, Codex's review of 78db6dc (I6-R1, I6-R2, the ordering note)
- CI/Security on main: none
- Open issues touched: none
- Needs from Ryan: not recorded in history
- Needs a ruling from Claude (chat): not recorded in history
- Next planned step: not recorded in history

## 2026-10-21 — Item 2: Codex's review of df401b3 (K-R1, K-R2)
- Shipped: security/release-2-slice-2 df401b3..1042d2c (not main)
  - 1042d2c Item 2: total timestamp validation; the six capture procedures; a real progression gate
- CI/Security on main: none
- Open issues touched: none
- Needs from Ryan: not recorded in history
- Needs a ruling from Claude (chat): not recorded in history
- Next planned step: not recorded in history
