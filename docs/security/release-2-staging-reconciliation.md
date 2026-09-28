# Release 2 — staging ledger reconciliation (01, 02, 03)

**Status: COMPLETE 2026-09-28 — R1–R4 PASSED, R5 recorded. The committed 01–05 files are the tested code on staging.** Written 2026-09-24. The
stage-0 production plan waits on this.

> **Qualification, 2026-09-28 (Codex review of `8913a69`).** The results below
> stand. Three things this document relied on are **SUPERSEDED, not approved
> for reuse** (production plan §G):
> - the reset file's seed-store guard, which is negative-only — the file is not
>   edited, because its bytes are staging's ledger `statements[1]` for
>   `20260928160606`;
> - the unpinned `assemble-reconciliation-rehearsal.mjs`;
> - §3's closing claim that the exact previous state is "always recoverable …
>   byte for byte" from the ledger. The ledger holds statement text, not state.
>
> The stage-0 production work uses positive identity markers, a pinned
> assembler (`scripts/manual/assemble-stage0.mjs`) and catalog-fingerprint
> equality instead.

## 1. What is wrong, exactly

Staging's ledger (`supabase_migrations.schema_migrations`, project
`lboajqihpsfrokqvjgnl`) holds, for `release2_01`, `02` and `03`, bodies that
are **not** the committed files:

| migration | staging version | ledger `md5(statements[1])` | committed blob md5 | committed | byte-identical |
|---|---|---|---|---|---|
| 01 identity schema | `20260912171058` | `ef5d5a38…` (7 132 chars) | `e97a5fd7…` (13 720 bytes) | `b2ac88a` 17:11:41Z, 43 s after the apply | **no** |
| 02 auth attempts fn | `20260912175605` | `00a8033a…` | `734e0db7…` | `792ad61` 17:56:38Z, 33 s after | **no** |
| 03 bind + atomicity | `20260912203409` | `0960ff10…` | `302e05c6…` | `fc54250` 20:36:58Z, 2 min 49 s after | **no** |
| 04 qualify columns | `20260915142741` | `2dcb03eb…` | `2dcb03eb…` | — | yes |
| 05 revoke enrollment | `20260916225132` | `22b5010b…` | `22b5010b…` | — | yes |

**How it happened (from the file history).** Each of 01, 02 and 03 has had
exactly one committed version, ever (`git log --all`); none of them, with or
without its final newline or with CRLF, hashes to the ledger body. Each was
committed seconds to minutes *after* staging applied a different body. So the
session that applied them sent a hand-compacted, comment-free body to
`apply_migration` and committed a laid-out, commented file. None of the three
commits claimed byte identity; each deferred it to "when this reaches
production". The trailing-newline transport note in `staging.md` §2 does not
explain this — that covers six older migrations whose bodies differ by one final
`\n`.

**The diff.** Staging's three bodies were written to disk from a read-only query
and accepted only because their md5 equals the ledger's (all three exact). Diffing
them against the committed blobs, the only differences are:
- `--` comment lines and trailing comments (only in the files);
- layout: line breaks, alignment, one-line `if … end if;` split across lines,
  `end $fn$;` vs `end\n$fn$;`, `errcode='x'` vs `errcode = 'x'`;
- `COMMENT ON FUNCTION … IS` strings: one literal in the ledger, adjacent
  literals across lines in the files (`'…' '…'`), which Postgres concatenates.

Diff size: 01 +218/−83 lines, 02 +55/−2, 03 +190/−40. After removing comments,
collapsing whitespace, joining adjacent literals and removing spaces around
punctuation, **all five** migrations hash equal on both sides, with the hash
computed independently in Python over the committed blobs and in Postgres over
`statements[1]`: 01 `da4699a6…`, 02 `7f1710aa…`, 03 `d26630f6…`,
04 `e023fd12…`, 05 `614f1572…`.

## 2. Which is the tested code

**The staging ledger bodies are the tested code.** Every staging probe (1–5f,
3g–3l, 5a–5e) and the 04/05 rehearsals ran against functions created from them.
**The committed 01–03 files have never been executed anywhere.** The normalized
equality above is a strong textual argument that they would produce the same
objects, but it is an argument, not a test, and it is not byte equality where it
matters: PL/pgSQL bodies are stored verbatim in `pg_proc.prosrc`, so the
functions staging has are not the text production would receive from the files.

Nothing here edits an applied migration. The fix is to make the committed bytes
the tested code.

## 3. Proposed reconciliation (not run)

All steps are staging-only. Each ends at a stop point.

**R0 — record the starting state (read-only; already captured 2026-09-24).**
Six functions, six tables (RLS on, 0 policies), `employees_id_store_uniq`
present; no object outside the Release 2 set depends on the tables; rows:
2 enrollments, 3 tickets, 6 sessions, 11 attempt rows, 0 capabilities — all
probe fixtures.

**R1 — rehearse the entire reconciliation in one `begin … rollback`.**
`node scripts/manual/assemble-reconciliation-rehearsal.mjs` builds it from HEAD,
byte for byte: the reset (`supabase/staging/release2_reconciliation_reset.sql`)
→ committed 01, 02, 03 → a real call proving 03 raises **42702** (R0) → committed
04, 05 → `supabase/rehearsals/release2_reconciliation_proofs.sql` (ACL/RLS/grant
catalog proofs A1–A3 and end-to-end calls B1–B13 with real seed rows: redeem,
replay, expiry, limiter quota, `clear_lockout` as owner / wrong store / unknown
subject, session create/rotate/cross-store, revoke with cascade and the P5b
non-owner refusals before and after, prune) → `ROLLBACK`. The assembler prints
each included file's md5 so the rehearsal is shown to contain the committed
bytes. Afterwards, a read-only check that R0's state is unchanged.

**R1 RESULT — PASS, 2026-09-24 (approved by Ryan; rolled back).** Run as one
`begin … rollback` on staging. To make "verbatim" something the database
proves rather than something I assert, each committed file went in as a
dollar-quoted literal inside a `DO` block that checked `md5()` against the
committed blob BEFORE `EXECUTE` — a single wrong byte would have aborted the
transaction. Every one matched:

| check | result |
|---|---|
| M0 reset file | md5 `c4ca9c0b…` = committed; executed → 0 tables / 0 functions / 0 constraint |
| M1–M5 committed 01–05 | `e97a5fd7…`, `734e0db7…`, `302e05c6…`, `2dcb03eb…`, `22b5010b…` = committed; executed |
| M6 proofs file | `5665557d…` = committed; executed |
| R0 committed 03 before 04 | `[42702] column reference "store_id" is ambiguous` — the defect 04 repairs, reproduced |
| A1 function ACLs (6) | `{postgres=X/postgres,service_role=X/postgres}`; `release2_clear_lockout` also `authenticated=X`; no PUBLIC, no anon; all `secdef=true`, `search_path=public` |
| A2 tables (6) | `rls=true ; policies=0 ; acl={postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres}` — no client-role grant |
| A3 | `UNIQUE (id, store_id)` on `employees` |
| B1 redeem | enrollment created, store `…0a1` |
| B2 replay / B3 expired | `[28000] ticket not redeemable` / same |
| B4 limiter, quota 2 | `true/1 true/2 false/3` |
| B5 clear_lockout as T1 owner | `1` |
| B6 claiming T2 / B7 unknown subject | `[42501] not authorised` / same |
| B8 create + rotate | new id, role `staff`, live=1, reason `rotated: new sign-in on this device` |
| B9 cross-store employee | `[28000] employee not usable for this enrollment` |
| B10 T2 owner revokes T1 device | `[42501] not authorised` |
| B11 owner revoke | `revoked=1`, reason `device revoked: reconciliation probe` |
| B12 T2 owner / T1 manager on already-revoked | `[42501]` / `[42501]` (P5b) |
| B13 prune | old row deleted, live lock kept |

After the rollback, read-only: 6 functions, `employees_id_store_uniq` present,
rows 2/3/6/11 as at R0, no probe rows, ledger unchanged (5 `release2_` rows, max
`20260916225132`). `md5(prosrc)` of the CURRENT (compact-body) functions recorded
for comparison after R2: `redeem_enrollment_ticket` `f850bfdd…`,
`release2_record_attempt` `52407443…`. **Stopped here; R2 needs a separate go.**

**R2 — apply for real, one migration at a time.**
1. `apply_migration` with the reset file's bytes (name
   `release2_00_reconciliation_reset`); read back its ledger version. The
   file's guard refuses unless the synthetic staging seed store exists.
2. `apply_migration` with each committed file 01→05, in order, 03 and 04 back
   to back. After each: read back version, `md5(statements[1])`, final-newline
   flag; accept only the file's md5, or the file minus its final `\n`. Anything
   else stops R2.
3. The five old ledger rows stay untouched as history. The ledger then reads:
   old 01–05, the reset, new 01–05.

**R2 RESULT — APPLIED 2026-09-28 (approved by Ryan).** `apply_migration` with each
committed file's exact bytes, the ledger read back after every apply, before the
next:

| migration | staging version | ledger md5 | bytes | final `
` | vs committed |
|---|---|---|---|---|---|
| `release2_00_reconciliation_reset` | `20260928160606` | `c4ca9c0b…` | 2 498 | yes | **identical** |
| `release2_01_identity_schema` | `20260928160657` | `e97a5fd7…` | 13 720 | yes | **identical** |
| `release2_02_auth_attempts_fn` | `20260928160722` | `734e0db7…` | 6 406 | yes | **identical** |
| `release2_03_bind_and_atomicity` | `20260928160802` | `302e05c6…` | 13 062 | yes | **identical** |
| `release2_04_staff_session_qualify_columns` | `20260928160825` | `2dcb03eb…` | 5 858 | yes | **identical** |
| `release2_05_revoke_enrollment` | `20260928160847` | `22b5010b…` | 5 622 | yes | **identical** |

The five original rows (`20260912171058` … `20260916225132`) are untouched and
still hold the old bodies. 03 and 04 were applied 23 s apart. The reset removed
every Release 2 row on staging (the old enrollments, tickets, sessions and
attempts were probe fixtures).

**R3 RESULT — PASS 2026-09-28**, `begin … rollback`, proofs file md5-gated again
(`5665557d…`): A1 six ACLs exactly as R1 (no PUBLIC, no anon; `authenticated`
only on `release2_clear_lockout`); A2 six tables RLS on, 0 policies,
postgres + service_role only; A3 `UNIQUE (id, store_id)`; B1–B13 identical to R1
(redeem; replay and expiry 28000; limiter `true/1 true/2 false/3`; clear_lockout
1 / 42501 / 42501; create + rotate live=1; cross-store 28000; revoke 42501 before,
cascade `device revoked: reconciliation probe`, 42501 after for T2 owner and T1
manager; prune).

**Function bodies are now the committed bytes.** `md5(prosrc)` on staging, each
also derived independently from the committed file's `$fn$` body (Python over
the git blob — all six EQUAL). This is the reference production must reproduce:

| function | defined by | `md5(prosrc)` |
|---|---|---|
| `redeem_enrollment_ticket` | 01 | `c0243888…` (was `f850bfdd…` from the compact body) |
| `release2_record_attempt` | 03 | `e6795759…` (was `52407443…`) |
| `release2_clear_lockout` | 03 | `b7f602cd…` |
| `release2_prune_auth_attempts` | 03 | `ee254949…` |
| `release2_create_staff_session` | 04 | `d30da6d0…` |
| `release2_revoke_enrollment` | 05 | `a464a43c…` |

**R4 RESULT — PASS, 2026-09-28 16:47–16:57Z** (plain staging, deploy `6aba9057…`
of `95c1c43`; Chrome, owner-t1 signed in by Ryan; T2 and manager tokens placed
by Ryan as page variables and discarded with the tab afterwards). Every token
was checked before any 401 from it was trusted: `jwtInfo()` for subject, email
and seconds to expiry, AND a live `GET /auth/v1/user` → `200` with the right
email. owner-t1 `ce5f92f9…` (≥2 973 s left), owner-t2 `f82d617e…` (3 544 s),
manager-t1 `139bf934…` (3 544 s). No unexpected 401 occurred, so no retry was
needed.

| probe | result |
|---|---|
| Phase 1 (16:09Z) | four uniform `401 {"ok":false,"error":"Unauthorized"}` |
| 2a owner-t1 mints for T1 | `200` ticket `d0faab78…`, store `…0a1`, expires +15 min |
| 2b manager-t1 mints for T1 | `401` (token live: `/auth/v1/user` 200) |
| 2c **control** owner-t2 mints for T2 | `200`, store `…0a2`, ticket issued |
| 2c owner-t2 mints for T1 | `401` — same token, own store 200, other store 401 |
| 3a redeem | `200` enrollment `a463b98c…` ("Counter A"), csrf returned. Cookie attributes not re-observed (page JS cannot read `Set-Cookie`); stand as recorded 09-15, code unchanged |
| 3b replay | `401` |
| 3c bootstrap | `200 kind:"device"`, csrf identical to 3a |
| 3d login PIN 1102 | `200` T1 Staff, role `staff`, new csrf, expires +12 h |
| 3e bootstrap | `200 kind:"staff"`, csrf = 3d's |
| 3f-i staff token, PIN 1101 | `401` — the predicted gap, reproduced |
| 3f-ii device token, PIN 1101 | `200` T1 Manager, role `manager` |
| 3g logout | `200 kind:"device"`, csrf = device A's |
| 3j logout again (run right after 3g) | `401` |
| 3h bootstrap | `200 kind:"device"`, csrf = 3a's |
| 3i login PIN 1102 | `200` T1 Staff |
| 3k rotate to manager, revoke-all | `200`, then `200 {revoked:1}` |
| 3l revoked staff token / bootstrap / revoke-all | `401` / `200 kind:"device"` / `200 {revoked:0}` |
| 5a owner-t1 revokes ENR_A (after one live sign-in) | `200` store `…0a1`, sessionsRevoked 1 |
| 5b bootstrap / login / revoke again | `401` / `401` / `200`, sessionsRevoked 0 |
| 5c owner-t2 on the revoked ENR_A; owner-t1 on a random id | `401` / `401`, **identical body** |
| 5d 201-char reason | `400 reason must be at most 200 printable characters` |
| 5e owner-t1 list | `200`: Counter A only, revoked with reason, liveSessions 0; keys `id,label,createdAt,lastSeenAt,revokedAt,revokedReason,liveSessions`; forbidden-content pattern: no match |
| 5e **control** owner-t2 lists T2 | `200`, store `…0a2`, 0 devices |
| 5e owner-t2 lists T1 | `401` |

**Database read-back (read-only, no hashes or secrets selected):** ticket
`d0faab78…` redeemed into `a463b98c…`; the enrollment's session rows in order —
`rotated: new sign-in on this device` (T1 Staff), `logout` (T1 Manager, 3g),
`rotated…` (T1 Staff), `kiosk entry` (T1 Manager, 3k),
`device revoked: probe: shared tablet` (T1 Staff, 5a); 0 live; no other
enrollment touched. ENR_A `revoked_by` = owner-t1, reason `probe: shared
tablet`, and unchanged after 5c. T1 has exactly one ticket (minted by
owner-t1): 2b and 2c minted nothing. T2 has one ticket — 2c's positive control,
unredeemed, expiring.

**Conclusion.** Staging's Release 2 functions now come from the committed bytes
(R2), are proven by direct calls (R3) and by every HTTP probe of the slice 2/3
sequence (R4). The committed files ARE the tested code.

**Obsolete after R2:** `supabase/rehearsals/release2_04_rehearsal.sql` and
`release2_05_rehearsal.sql` open with `create function` / expect the
pre-04 42702 on the LIVE function; both are superseded by
`release2_reconciliation_proofs.sql` for any re-run.

**R3 — proofs-only rehearsal on the applied objects** (`begin` + the proofs
file + `rollback`): A1–A3 and B1–B13 again, now against persistent objects
created from the committed bytes. This is "03/04/05 rehearsed with real function
calls" after the apply. Plus: the catalog fingerprint (`md5(prosrc)` per
function) is recorded as the reference production must reproduce.

**R4 — Phase 1 and probes 3–5 on plain staging** (browser, owner sign-ins by
Ryan where a token is needed), each with the database read back. The reset
removed Counter C/D and every session, so 2a (mint) and 3a (redeem) re-create
them. 0a/0c are re-run as a check that the deploy is unaffected.

**R5 — record.** `staging.md` §5a: the new ledger versions, the reset, the
five retained historical rows, and that staging's Release 2 functions now come
from the committed bytes. `release2-inventory.test.js` (INV-6) is unaffected:
staging's ledger is not production's.

**Abort and rollback.** R1 changes nothing. If R2 fails after the reset,
staging has no Release 2 objects until the failing file is fixed and applied.
Only staging is affected, and production is unaffected. The exact previous state
is always recoverable: the old bodies are still in the ledger's `statements[1]`
and can be re-applied byte for byte. *[SUPERSEDED 2026-09-28: this overstated
it — re-applying statement text does not restore state. See the qualification
at the top and production plan §G.]*

## 4. Not in this proposal

Production. The stage-0 production plan
(`release-2-stage-0-production-plan.md`) is on hold until R5 is recorded, then
rewritten against the new staging ledger.
