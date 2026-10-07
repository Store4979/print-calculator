# Stage 0 — P1 to P3 on production: runbook

**Status: DRAFT. It needs review before use, and nothing below has run.** Three
positions are Ryan's, for Codex to rule on (§R). Blocker PRE-0 is resolved in
the repository and is shown green at every state by the record replay (§PRE-0).

It turns plan §E0–E5 (with §A6, F4 and E6) into one ordered window on
**production**:
- Supabase project `gmxyisjjaxtpycsmmzef`;
- Netlify site `printcalculator2` (read only in this window).

It follows the C3 runbook's step style (`docs/security/stage0-c3-runbook.md`)
and the C5 draft's paste checks (`docs/security/stage0-c5-runbook.md` §0.2).

**Window: Sunday 2026-10-11, from 17:00 EDT (21:00Z).** Ryan confirmed that
#4979 is closed on Sundays, and set the start at 5:00 PM.
- The database part (§2–§9) runs 17:00–18:30 EDT, with a reserve to 19:00.
- With an in-window recovery (D-P2 = A), it runs to about 19:45.
- The repository part (§11) follows, with the counter open, until about
  19:40, or about 20:25 after a recovery.

The window is outside counter hours, with the owner present. A STOP leaves the
evening and the night for review before Monday's opening, and E0 keeps the
counter closed for P1 and P2.

Each step is one of:
- **RYAN** — an exact command or dashboard click-path. Ryan replies with the
  non-secret lines the step asks for.
- **CLAUDE** — an exact read-back, with its expected result.

**Any deviation is STOP.** Record it, then follow §A. Never retry until it
passes, and never edit a file to make a check pass.

Records go into plan §E11–E13 (template at the end).

---

## §R — Ryan's positions, for Codex to rule on

1. **D-P2 = Option A** (§A.2), the in-window recovery, with all of its
   conditions, plus:
   - **Ryan's explicit "go" in chat before each RB step**;
   - **a P0 re-check after the recovery**: the schema equals the baseline
     (P0-S identical to P0₀, `catalog_fingerprint` included), and the ledger
     is only appended to (P0-L).

   Option B stays written out.
2. **The counter re-opens after §7 (the database read-back) and §8 (the
   legacy smoke test) pass** (§10). The repository record (§11) follows with
   the counter open. It records a database that is already verified, and it
   changes only the repository: its commits stay local until §12, which
   pushes only the branch that builds staging.
3. **No second-session cancel.** The PG 17 time limits are the bound (§0.2).

---

## §PRE-0 — the suite stays green through the record (Blocker PRE-0, resolved)

**The finding (`da23e23`).** E5 requires the suite to be green on the P3
commit, and Netlify runs `yarn test` in every build. A failing record commit
therefore fails the staging build it triggers.
- In a scratch clone of `09bcf38`, §11's record commits took `yarn test` from
  372/372 to **349/372** after P2-01's record, and to **347/372** after all
  four.
- The record itself passed M-1…M-12 and the real INV-6.
- The failing tests built their fixtures from HEAD and assumed the Release 2
  files were still in `pending/`:
  - `release2-inventory.mutation.test.js`: CONTROL, MUT-1, 6, 11, 13, 14, 18,
    19, 21, 25, 27 and 33;
  - `release2-inventory.rollback.test.js`: RB-INV-1…11;
  - `stage0-manifest.lifecycle.test.js`: LC-3 and LC-4.

**The fix (this commit).** No assertion was removed or loosened, and no pinned
file changed. What changed is where the fixtures start.
- **`scripts/tests/stage0-recorded-state.mjs`** reads where the Release 2
  files ARE from the manifest's recorded state (`productionVersion`,
  `rollbackRecords`). It uses the manifest checks' own path functions:
  `forwardPath`, `companionPath`, `recordPath`. It puts a copy (or a scratch
  clone, by commit) back into the pending layout, so every fixture starts
  where it always did, whatever HEAD records.
  - `pendingCapture()` is the committed capture without the six Release 2
    tables, at the baseline version. Before P2 it equals the committed
    capture.
- **The mutation fixtures:** `mutate()` starts from the pending layout.
  `mutateReal()` keeps the tree and the real snapshot EXACTLY as HEAD records
  them, in every state. MUT-33 replays the apply on the real capture's
  pending view. CONTROL now also asserts the pending copy's baseline.
- **RB-INV-1…11** start from the pending layout and capture. RB-INV-8 now
  also checks the tree and the composed gate exactly as HEAD records them.
- **A race the replay found (pre-existing, any `yarn test`, Netlify
  included).**
  - The race:
    - the deploy-context tests write and remove the generated, gitignored
      `netlify/lib/deploy-context.json` in the REAL tree
      (`deploy-context-fixture.mjs`);
    - meanwhile, in another test process, RB-INV's fixture recursively
      copies the real `netlify/`;
    - run 1 of the replay caught it as `ENOENT` (`cpSync`, `netlify\lib`) in
      RB-INV-1, in 1 of 15 suites. That was a setup error, not an assertion.
  - The fix: the copy now leaves that one generated file out. No fixture reads
    it, and a clean checkout does not have it. The mutation fixtures copy only
    `netlify/functions/` and were never exposed.
- **The LC tests** start from a pending commit in the scratch clone. LC-1
  now also checks HEAD exactly as recorded.
- **`scripts/manual/stage0-record.mjs`** is new. It STAGES one step's record,
  and it is what §11 and §A.4 run (§11 has what it checks and what it
  refuses). `scripts/tests/stage0-record.test.js` (REC-1, REC-2, in
  `yarn test`) shows two things:
  - it stages exactly the record, for a forward step and for a rollback, and
    each committed result passes the manifest checks and the snapshot
    validation;
  - it refuses 18 wrong inputs, each before changing anything.
- **`scripts/tests/replay/stage0-record-replay.test.js`** is new, and runs on
  demand:
  - it makes the runbook's record commits with `stage0-record.mjs`, using
    synthetic versions and snapshots, in a scratch clone of the committed
    HEAD;
  - it runs the FULL suite at every state;
  - every state must show 0 failed, 0 skipped and the same test count as
    HEAD.

  It stays outside the `yarn test` glob: inside the suite it would run
  itself, and 15 full suites would add tens of minutes to every Netlify
  build.

**The replay, 2026-10-07** (all 15 states, 3 suites at a time):
- Run 1 was on `bc20640`, before the race fix.
- Run 2 was on `ebdf1a6`, which differs from this commit only in this
  runbook's results text and CLAUDE.md's race note. Every script, test and
  pinned file is identical.
- Each count is `yarn test`'s: 372 before this change, plus REC-1 and REC-2.
- Run 2 had 0 failed, 0 cancelled, 0 skipped and 0 todo at every state, and
  the replay's own test passed. It took 29 min.

| state | run 1 | run 2 |
|---|---|---|
| pending (HEAD) | 374/374 | 374/374 |
| P2-01 | 374/374 | 374/374 |
| P2-02 | 374/374 | 374/374 |
| P2-0304 | **373/374**: RB-INV-1 `ENOENT` in its fixture copy (the race above) | 374/374 |
| P2-05 (fully applied) | 374/374 | 374/374 |
| after RB-5 | 374/374 | 374/374 |
| after RB-43 | 374/374 | 374/374 |
| after RB-2 | 374/374 | 374/374 |
| RB-1 (committed rollback) | 374/374 | 374/374 |
| prefix 01 → RB-1 | 374/374 | 374/374 |
| prefix 01–02 → RB-2 | 374/374 | 374/374 |
| prefix 01–02 → RB-1 | 374/374 | 374/374 |
| prefix 01–04 → RB-43 | 374/374 | 374/374 |
| prefix 01–04 → RB-2 | 374/374 | 374/374 |
| prefix 01–04 → RB-1 | 374/374 | 374/374 |

The pre-window step §1.2 re-runs it at H.

---

## 0. Rules for every step

### 0.1 Identifiers

- **Supabase:** the dashboard URL contains **`gmxyisjjaxtpycsmmzef`**. If it
  contains `lboajqihpsfrokqvjgnl`, that is staging: STOP.
- **Netlify:** the site is **`printcalculator2`**, not
  `printcalculator2-staging`. It is only read here.
- **Claude's calls:**
  - every `execute_sql` names `project_id` `gmxyisjjaxtpycsmmzef`;
  - `get_project_url` runs once first and must return
    `https://gmxyisjjaxtpycsmmzef.supabase.co` (plan §E2, out of band).
- **Every sender run** prints `target production = gmxyisjjaxtpycsmmzef`.

### 0.2 What runs where

- **Pinned texts** (P0, P1, P2-*, STATE, RB-*):
  - only through `scripts/manual/stage0-send.mjs`, run by Ryan, never retyped
    (plan §E1 "The transport");
  - Claude runs only `--dry-run` and never holds a token.
- **Ad-hoc read-backs** (§0.6):
  - Claude runs them with `execute_sql`, read-only, labelled **"ad-hoc (not
    pinned)"** in the record;
  - Claude names each one in chat before running it, and the text is exactly
    §0.6's.
- **No edits in the checkout from §2 until §9.** Ryan's commands run in this
  checkout, and the sender reads the manifest at HEAD. Claude keeps snapshots
  and notes in its scratchpad until §11.
- **No pushes from §1 until §12** (§12 has the rules).
- **No cancel procedure (position 3, §R).** Every text is bounded by its own
  PG 17 timers:
  - P1: `statement_timeout` 90 s, `transaction_timeout` 110 s;
  - P2 and RB: 45 s and 45 s;
  - the sender's client timeout: 150 s.

  The second-caller cancel (plan §E8) would need the write token in a third
  window, and it has never run with a live second session.

### 0.3 Two windows, two tokens

Ryan opens two PowerShell windows in this checkout. Each holds exactly one
token, set once. The window titles are what V-WIN reads; they help a person
check, and they prevent nothing:

| window | title (set in §3) | token | Database permission | sends | `read_only` |
|---|---|---|---|---|---|
| **R** | `STAGE0 R - read token` | `stage0-p1p3-read-20261011` | **Read** | P0, STATE | `true` (the sender's policy) |
| **W** | `STAGE0 W - write token` | `stage0-p1p3-write-20261011` | the level above Read (name recorded at creation) | P1, P2-*, RB-* | not set |

Both tokens:
- **Resource access → Project →** the production project only;
- every other permission **None**;
- the **shortest expiry offered** (1 day at P0);
- **created at window start (§3)** and **deleted at §9 whatever happens**;
- never "Create legacy token".

A token is shown once at creation. If a window is lost, its token goes with
it:
1. delete that token in the dashboard;
2. create a replacement of the same kind (§3) before the next send.

### 0.4 The checks after a paste

| check | when | what is verified |
|---|---|---|
| **V-HEAD** | each window, before its first send | `git rev-parse HEAD` prints **H** (the commit Codex names when it clears this runbook), and `git status --short` prints only `?? AGENTS.md` |
| **V-DRY** | every dry run | the 4 lines: `text <NAME>`; `target production = gmxyisjjaxtpycsmmzef; read_only <true\|false>`; `request md5 <md5>; <bytes> bytes`; `dry run: verified against the manifest; no network call made`. The values must equal §0.7's table |
| **V-SCOPE** | after creating a token | Ryan reads back on the token's page: its name; Project = the production project only; Database at the intended level; everything else None; the expiry. Anything broader is STOP: delete it and report |
| **V-PROMPT** | every `Read-Host` | the text after `Read-Host` is a label and is never edited. The value goes at the masked prompt, after the colon (C3: a token prefix once became the label and reached the chat) |
| **V-MASK** | before Enter at the masked prompt | **44** asterisks |
| **V-PREFIX** | right after | `StartsWith("sbp_")` → `True`, and `.Length` → `44` |
| **V-CLIP** | after every token paste | copy a harmless word (`cleared`) so the token leaves the clipboard |
| **V-WIN** | before every send | the window's title matches §0.3's row for that text |
| **V-SEND** | after every live send | Ryan pastes the sender's lines (they carry no secret): target and `read_only` as V-DRY, the same md5 and bytes, `HTTP 201`, the `body (first 300 chars)` line, and the results file name |
| **V-FILE** | Claude, after every send | the results file has the expected `text`, `ref`, `readOnly`, `requestMd5`, `requestBytes`, `httpStatus 201`, `error null` and `tokenRedactedFromResponse false`, and its `body` is as expected. A `true` redaction flag means the token came back in a response: STOP, and delete that token now |

### 0.5 Ryan's commands

Window setup (§3), in each window:

```powershell
$Host.UI.RawUI.WindowTitle = "STAGE0 R - read token"     # window W: "STAGE0 W - write token"
git rev-parse HEAD
git status --short
# PowerShell 7.1 or later:
$env:SUPABASE_ACCESS_TOKEN = Read-Host "Paste token" -MaskInput
# Windows PowerShell 5.1 (no -MaskInput): use these two lines instead
#   $s = Read-Host "Paste token" -AsSecureString
#   $env:SUPABASE_ACCESS_TOKEN = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)); Remove-Variable s
$env:SUPABASE_ACCESS_TOKEN.StartsWith("sbp_")
$env:SUPABASE_ACCESS_TOKEN.Length
```

A send, with `<TEXT>` from §0.7 (window R for P0 and STATE, window W for the
rest):

```powershell
node scripts/manual/stage0-send.mjs <TEXT> --target production --confirm-ref gmxyisjjaxtpycsmmzef
```

The end of the window (§9), in each window:

```powershell
Remove-Item Env:SUPABASE_ACCESS_TOKEN
exit
```

### 0.6 Claude's ad-hoc read-backs (`execute_sql`, read-only, `project_id` `gmxyisjjaxtpycsmmzef`)

Each was run in the local PG 17 harness (PGlite 0.4.6) on 2026-10-07, where
it parsed and returned the values in §0.7:
- LOCKS, LEDGER and CATALOG at catalog state 00;
- LEDGER, CATALOG, R2COUNTS and TABLES-SNAPSHOT after P2-01, P2-02, P2-0304
  and P2-05.

A recovery passes through the same catalog states. Only its ledger rows
differ.

**LOCKS** — the gate before P1 and before P2-01, the two texts that need
ACCESS EXCLUSIVE on `employees`:

```sql
select (select count(*) from pg_locks l
         where l.relation = 'public.employees'::regclass and l.pid <> pg_backend_pid()) as employees_locks,
       (select count(*) from pg_stat_activity a
         where a.backend_type = 'client backend' and a.state <> 'idle' and a.pid <> pg_backend_pid()) as active_client_backends,
       now() as read_at;
```

- `employees_locks` must be `0`; `active_client_backends` is recorded only.
- This is a gate, not a result. If it shows a lock, nothing is sent. Ryan
  finds the holder (a signed-in counter PC, an open admin tab), then LOCKS is
  read again. Both reads are recorded.
- A holder that cannot be found is STOP. Nothing was sent.

**LEDGER** — the ledger head, its row count, and every Release 2 row in full
shape:

```sql
select (select count(*) from supabase_migrations.schema_migrations) as ledger_rows,
       (select max(m.version) from supabase_migrations.schema_migrations m) as ledger_head,
       (select json_agg(json_build_object(
                 'version', m.version, 'name', m.name,
                 'md5', md5(m.statements[1]), 'bytes', octet_length(m.statements[1]),
                 'final_lf', right(m.statements[1], 1) = E'\n',
                 'elements', cardinality(m.statements), 'lower', array_lower(m.statements, 1),
                 'created_by', m.created_by,
                 'idempotency_key_null', m.idempotency_key is null,
                 'rollback_null', m.rollback is null)
               order by m.version)
          from supabase_migrations.schema_migrations m
         where m.name like 'release2\_%') as release2_rows,
       now() as read_at;
```

**CATALOG** — the A1a / A2 read-back:
- per function: signature, `md5(prosrc)`, effective ACL, SECURITY DEFINER,
  `search_path`, comment;
- per table: RLS, policy count, grantees and the full privilege set;
- the constraint.

```sql
select (select json_agg(json_build_object(
                 'ident', p.proname || '(' || oidvectortypes(p.proargtypes) || ')',
                 'body_md5', md5(p.prosrc),
                 'acl', (select string_agg(coalesce(r.rolname::text, 'PUBLIC') || '=' || a.privilege_type, ','
                                           order by coalesce(r.rolname::text, 'PUBLIC'), a.privilege_type)
                           from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                           left join pg_roles r on r.oid = a.grantee),
                 'secdef', p.prosecdef,
                 'config', p.proconfig,
                 'commented', obj_description(p.oid, 'pg_proc') is not null)
               order by p.proname, oidvectortypes(p.proargtypes))
          from pg_proc p
         where p.pronamespace = 'public'::regnamespace
           and (p.proname like 'release2\_%' or p.proname = 'redeem_enrollment_ticket')) as functions,
       (select json_agg(json_build_object(
                 'table', c.relname,
                 'rls', c.relrowsecurity,
                 'policies', (select count(*) from pg_policy pol where pol.polrelid = c.oid),
                 'grantees', (select string_agg(g.grantee, ',' order by g.grantee)
                                from (select distinct coalesce(r.rolname::text, 'PUBLIC') as grantee
                                        from aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
                                        left join pg_roles r on r.oid = a.grantee) g),
                 'full_privileges', (select bool_and(x.privs = d.privs)
                                       from (select a.grantee, array_agg(a.privilege_type::text order by a.privilege_type::text) as privs
                                               from aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
                                              group by a.grantee) x,
                                            (select array_agg(a.privilege_type::text order by a.privilege_type::text) as privs
                                               from aclexplode(acldefault('r', c.relowner)) a) d))
               order by c.relname)
          from pg_class c
         where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
           and c.relname in ('device_enrollments', 'enrollment_tickets', 'staff_sessions',
                             'upload_capabilities', 'upload_capability_files', 'auth_attempts')) as tables,
       (select pg_get_constraintdef(k.oid) from pg_constraint k
         where k.conrelid = 'public.employees'::regclass and k.conname = 'employees_id_store_uniq') as employees_id_store_uniq,
       now() as read_at;
```

**R2COUNTS** — run only while the six tables exist (catalog state 01 or
later):

```sql
select (select count(*) from public.device_enrollments) as device_enrollments,
       (select count(*) from public.enrollment_tickets) as enrollment_tickets,
       (select count(*) from public.staff_sessions) as staff_sessions,
       (select count(*) from public.upload_capabilities) as upload_capabilities,
       (select count(*) from public.upload_capability_files) as upload_capability_files,
       (select count(*) from public.auth_attempts) as auth_attempts,
       now() as read_at;
```

**TABLES-SNAPSHOT** is the statement in `scripts/manual/tables-snapshot.sql`
(plan §E5: an ad-hoc read-back, not a stage-0 output).
- Claude saves its `tables_json` value verbatim in the scratchpad as
  `tables-after-<step>.json`.
- In §11, `stage0-record.mjs` fills the two by-hand fields, `project` and
  `capturedBy`. It refuses the snapshot unless:
  - its `ledgerVersion` is the step's last version;
  - its Release 2 tables follow the step;
  - its other tables, views and buckets are the committed capture's.

**CONSUMERS** shows that production's four Release 2 endpoints refuse. They
are the only server code on the published deploy (`7ec5af4`) that names the
new tables. Combined with the inventory gate (no client names them), that is
the plan's "no active consumers" (§F4).

The probe is write-free. The endpoints refuse on the production ref before
any method, Origin or body check, and before any database call (`gate()` in
`netlify/lib/release2.js` at `7ec5af4`).

```bash
for f in csrf-bootstrap enroll-ticket-create enroll-redeem staff-login; do printf '%s ' "$f"; curl -s -w ' HTTP %{http_code}\n' -X POST "https://printcalculator2.netlify.app/.netlify/functions/$f" -H 'content-type: application/json' --data-raw '{}'; done
```

Expected: four lines, each `<name> {"ok":false,"error":"Not Found"} HTTP 404`.

### 0.7 Expected values

**The texts.** These are taken from the manifest at `09bcf38`, which this
commit does not change. At H, the manifest is authoritative.

| text | md5 | bytes | `read_only` | window |
|---|---|---|---|---|
| P0 | `2d6977169a592cac78a15c5ebe17509b` | 11 694 | true | R |
| P1 | `2546a4a45a79cb2ec8a986df84396a9c` | 240 125 | false | W |
| P2-01 | `b680442d19f25aca0ede5fdf32542207` | 25 194 | false | W |
| P2-02 | `aecf712f514ae0620e578472b071e7df` | 18 921 | false | W |
| P2-0304 | `5e9a1ccfe8dd26678a6ee78b99c25fec` | 34 299 | false | W |
| P2-05 | `266d2f32ab61633d1b5357c71ec5d7ab` | 19 247 | false | W |
| STATE | `41dd91021512640818cf80cc7c8ee0f9` | 10 781 | true | R |
| RB-5 | `92c1c8bceb5c6a943c682cf3ca4c20db` | 16 551 | false | W |
| RB-43 | `55c1d3bd57b62e913225add48ef0080a` | 36 139 | false | W |
| RB-2 | `11ee730aac45528de1e49b19faae78af` | 15 445 | false | W |
| RB-1 | `c250dd6e36cc72836caa8be2b14780b5` | 17 688 | false | W |

**What a send returns.** The endpoint returns only the rows of the text's
LAST row-returning statement (plan §E8).

| text | `HTTP` | `body` | source |
|---|---|---|---|
| P0 | 201 | one row, 26 columns (§4) | §E10 |
| P1 | 201 | **45 rows `{n, what}`**: every proof that passed, from its final `select n, what from stage0_proof order by n`, then `ROLLBACK` (§5.3) | local PG 17 |
| P2-01, P2-02, P2-0304, P2-05, RB-* | 201 | **`[{"set_config":"45s"}]`**: the `transaction_timeout` line; the `DO` block and `COMMIT` return no rows | staging, 2026-09-29 (B-POSITIVE, the same wrapper pattern, through the same endpoint); local PG 17 |
| STATE | 201 | one row (table below) | local PG 17 |

**A failure looks like this:**
- any status other than 201, or `HTTP none | <error>` when no response came
  (the client timeout or a network error);
- the body of a refused text reads
  `Failed to run sql query: ERROR:  <SQLSTATE>: <message>` (or `FATAL:` for a
  `transaction_timeout`). That format was seen through `execute_sql` in N5. The
  HTTP status of an error has not yet been observed through the sender;
- the sender exits 0 only on 201.

**STATE**, by prefix. This is the plan §A6 prefix → recovery map, the
recovery being what STATE itself returns. Every row has `ledger_md5_ok true`.
`ledger_rows` lists each of 01–05 with its forward and rollback version or
`null`.

| after | `effective_prefix` | `catalog_state` | `recovery` (= the reviewed recovery for that prefix) |
|---|---|---|---|
| nothing applied | `""` | `00` | `none — nothing is applied` |
| P2-01 | `01` | `01` | `RB-1` |
| P2-02 | `01,02` | `02` | `RB-2, RB-1` |
| P2-0304 | `01,02,03,04` | `04` | `RB-43, RB-2, RB-1` |
| P2-05 | `01,02,03,04,05` | `05` | `RB-5, RB-43, RB-2, RB-1` |
| any other combination | — | `unrecognized` or a mismatch | `STOP — no reviewed recovery for this ledger/catalog combination; return to review` |

During a recovery (§A.3), the table is read upward:
- after RB-5, it is the P2-0304 row;
- after RB-43, the P2-02 row;
- after RB-2, the P2-01 row;
- after RB-1, the "nothing applied" row.

**LEDGER, the new rows per step.** Every Release 2 row also has:
- `final_lf true`, `elements 1`, `lower 1`;
- `created_by "store4979@theupsstore.com"`;
- `idempotency_key_null true`, `rollback_null true`.

Each `version` is after the previous head.

| step | new row(s): `name` — `md5` / `bytes` | `ledger_rows` |
|---|---|---|
| P2-01 | `release2_01_identity_schema` — `e97a5fd7c346a3b0a39bc6180dcfde46` / 13720 | 21 |
| P2-02 | `release2_02_auth_attempts_fn` — `734e0db7312b79081a769ca366c5b99a` / 6406 | 22 |
| P2-0304 | `release2_03_bind_and_atomicity` — `302e05c6a4939eb8021234cbc7325473` / 13062; then `release2_04_staff_session_qualify_columns` — `2dcb03eb36e47c8404a29500151e8394` / 5858, **its version one second after 03's** | 24 |
| P2-05 | `release2_05_revoke_enrollment` — `22b5010b9a3b20f5a3aaba4d212fd46c` / 5622 | 25 |

Rollback rows (§A.3 only) are named `<forward name>_rollback`, and carry
§A6's md5 and bytes:

| rollback file | md5 | bytes |
|---|---|---|
| 05rb | `9aa5d60657103f4d1925ebf20f2fcb3c` | 10316 |
| 04rb | `072fd70b8ef8fbdc654044f0a233d015` | 13324 |
| 03rb | `c2a8e5dd9b6029a2f7ccbf3d73b0bc68` | 14624 |
| 02rb | `d53dd43170b7cd2a266c4b7c88ed8326` | 9214 |
| 01rb | `9c81c9ba7fb4a0942d3d2dd5be68eb7a` | 11459 |

RB-43 writes 04rb's row first, then 03rb's one second later.

**CATALOG, per state (A1a).** Every listed function has:
- `secdef true`;
- `config ["search_path=public"]`;
- `commented true`.

`functions` must hold exactly the functions listed, in this order (by
name):

| state | function — `body_md5` — `acl` |
|---|---|
| 00 | `functions null`, `tables null`, `employees_id_store_uniq null` |
| 01 | `redeem_enrollment_ticket(bytea, bytea, bytea, text)` — `c024388886897f01a1154d8d12dc8996` — `postgres=EXECUTE,service_role=EXECUTE` |
| 02 | 01's row, then `release2_clear_lockout(text, text, uuid)` — `f06f2b206a8f6675668ec43f1b6ec384` — `authenticated=EXECUTE,postgres=EXECUTE,service_role=EXECUTE`, then `release2_record_attempt(text, text, integer, integer, integer)` — `fa208910f744eead2bdd14445d1d89d8` — `postgres=EXECUTE,service_role=EXECUTE` |
| 04 | 01's row, then `release2_clear_lockout(text, text, uuid, uuid)` — `b7f602cde969f2f2622c0d2343b1c249` — `authenticated=EXECUTE,postgres=EXECUTE,service_role=EXECUTE`; `release2_create_staff_session(uuid, uuid, bytea, bytea, timestamp with time zone, timestamp with time zone)` — `d30da6d0c7a4d14e1bcb1b9fcace37d9` — `postgres=EXECUTE,service_role=EXECUTE`; `release2_prune_auth_attempts(integer)` — `ee254949f88474c58284b8a2c1ba3cb0` — `postgres=EXECUTE,service_role=EXECUTE`; `release2_record_attempt(text, text, integer, integer, integer)` — `e67957595afcc7a51d7f8673000d9302` — `postgres=EXECUTE,service_role=EXECUTE` |
| 05 = **A2** | 04's five rows, plus `release2_revoke_enrollment(uuid, uuid, text)` — `a464a43cc72537bb02b3e4a1d904f655` — `postgres=EXECUTE,service_role=EXECUTE` (last) |

From state 01 on:
- `tables` is the six tables in name order: `auth_attempts`,
  `device_enrollments`, `enrollment_tickets`, `staff_sessions`,
  `upload_capabilities`, `upload_capability_files`;
- each has `rls true`, `policies 0`, `grantees "postgres,service_role"` and
  `full_privileges true`;
- `employees_id_store_uniq` is `"UNIQUE (id, store_id)"`.

**R2COUNTS:** every count `0`. That is expected because the endpoints refuse
(CONSUMERS) and P1's fixtures roll back with P1.

**TABLES-SNAPSHOT after a P2 step:**
- `role "postgres"`, `database "postgres"`;
- `views []`, `buckets ["customer-uploads","job-files"]`;
- `ledgerVersion` = that step's last ledger version;
- `tables` = the 14 in the committed `supabase/tables.json` plus the six,
  20 in all.

---

## 1. Pre-window (any time before; the counter may be open; nothing is sent)

**1.1 RYAN — checkout and dry runs.** In this checkout:

```powershell
git fetch origin
git checkout security/release-2-slice-2
git pull --ff-only
git rev-parse HEAD
git status --short
foreach ($t in "P0","P1","P2-01","P2-02","P2-0304","P2-05","STATE","RB-5","RB-43","RB-2","RB-1") { node scripts/manual/stage0-send.mjs $t --target production --dry-run }
```

→ **V-HEAD** (H), **V-DRY** for all eleven: 44 lines, each text's md5, bytes
and `read_only` as in §0.7. Ryan pastes the output.

**1.2 CLAUDE.**
- The same dry-run loop at H, with the same 44 lines.
- `yarn test` at H, in a clean clone: green.
- **The record replay at H** (§PRE-0):
  `node --test scripts/tests/replay/stage0-record-replay.test.js`. Every one
  of its 15 states must be green, with H's test count. It takes about 30 min
  at 3 suites at a time on this machine.
- Claude checks that no stage-0 text changed between this runbook and H. If
  one did, the manifest at H governs, and §0.7 is re-checked against it.

**1.3 RYAN — read-only.** Supabase (`gmxyisjjaxtpycsmmzef`) → Project
Settings → Integrations: is a GitHub connection set up? Report "none", or the
repository and branch it watches. If one exists, §12's push waits for review.

---

## 2. Window start

**2.1 RYAN — the counter.** Report the time and confirm:
- the counter is closed for the whole window;
- no staff are signed in on any counter PC or kiosk, and the app tabs there
  are closed;
- nobody is in the admin panel;
- the owner is present.

The public customer upload page cannot be paused. If a stage-0 text meets a
lock held by an upload, `lock_timeout` (3 s) aborts that text's transaction,
and nothing commits.

**2.2 RYAN — the backup, read-only.** Supabase → Database → **Backups**:
- the time and type of the **latest automatic backup**;
- whether point-in-time recovery is on.

This is an extra safety net only. Restoring it replaces the whole database,
including every order since that time, and is **not a step in this runbook**:
it would be a separate decision.

**2.3 RYAN — production deploy, read-only.** Netlify → `printcalculator2` →
Deploys: the **Published** deploy's id and commit.
- Expected: `6ab020c50a788b0008d430c9` at `7ec5af4`. On 2026-10-07,
  `origin/main` was `7ec5af48666e3779266464f77cdbe4bdf851ae5a`.
- Anything else is STOP: production changed outside this plan.

**2.4 CLAUDE.**
- `get_project_url` → `https://gmxyisjjaxtpycsmmzef.supabase.co`.
- CONSUMERS → four `404 Not Found`.
- LOCKS → `employees_locks 0`.
- LEDGER → `ledger_rows 20`, `ledger_head "20260909232836"`,
  `release2_rows null`.
- CATALOG → state 00 (all `null`).
- TABLES-SNAPSHOT → the committed `supabase/tables.json` content (its 14
  tables, `ledgerVersion "20260909232836"`), apart from `capturedAt` and the
  two by-hand fields.

Running each read-back now shows any tool or permission problem before
anything changes.

---

## 3. Tokens and windows

**3.1 RYAN — window R.** Open PowerShell in this checkout, then run §0.5's
setup with the title `STAGE0 R - read token`, up to and including
`git status --short`. → **V-HEAD**.

**3.2 RYAN — the read token.**
1. `https://supabase.com/dashboard/account/tokens` → **Generate new token** →
   name `stage0-p1p3-read-20261011` → Resource access **Project** → the
   production project only → **Database: Read**, everything else None →
   shortest expiry → generate. → **V-SCOPE**.
2. Copy it, paste it at window R's masked prompt (§0.5's `Read-Host` line).
   → **V-PROMPT**, **V-MASK**, then the two check lines → **V-PREFIX**.
3. → **V-CLIP**.

Report the token's name, scope, permission and expiry, and the `True` / `44`
lines.

**3.3 RYAN — window W.** As 3.1, titled `STAGE0 W - write token`. →
**V-HEAD**.

**3.4 RYAN — the write token.** As 3.2, named `stage0-p1p3-write-20261011`,
with **Database at the level above Read**. Record its name exactly as the
dashboard shows it. Paste into window W. → **V-SCOPE**, **V-PROMPT**,
**V-MASK**, **V-PREFIX**, **V-CLIP**.

The first send with this token is P1. If P1 is refused for permission, that
is STOP with nothing run (§A.1).

---

## 4. P0 at window start (window R)

**4.1 RYAN.** → **V-WIN** (R). Send `P0`. → **V-SEND**.

**4.2 CLAUDE.** → **V-FILE**. Every column must be **identical** to §E10's.
The one stated exception is `free_pins`:

| column | must equal |
|---|---|
| `catalog_fingerprint` | **`8b3c9eadf9eb8a98cb8cc6dca996663e`** |
| `ledger_head` / `ledger_rows` | **`20260909232836`** / **20** |
| `ledger_matches_repo`, `production_ledger_marker`, `staging_seed_absent`, `production_store_present` | true |
| `release2_in_ledger`, `release2_tables_present`, `release2_functions_present`, `stores_without_org`, `auth_users_user_triggers` | 0 |
| `stores_without_org_ids` | `[]` |
| `has_store_role`, `organizations`, `stores_org_id`, `probe_slug_absent`, `nil_job_absent`, `pg17_hard_timer`, `ledger_columns_as_pinned`, `ledger_rows_single_element` | true |
| `uniq_already_there` | false |
| `ledger_columns`, `ledger_created_by` | as §E10 (`["store4979@theupsstore.com"]`) |
| `server_version_num` | 170006 (any other value is STOP; P1 would then be the first run on that version) |
| `free_pins` | 8999, unless Ryan says an employee PIN was added or removed since 2026-10-07; still ≥ 3 |

These values become **P0₀**, the baseline for §5.4 and §A.

---

## 5. P1 — the rehearsal on production (window W)

**5.1 CLAUDE.** LOCKS → `employees_locks 0`.

**5.2 RYAN.** → **V-WIN** (W). Send `P1`. → **V-SEND**. Expected:
- `read_only false`;
- `request md5 2546a4a45a79cb2ec8a986df84396a9c; 240125 bytes`;
- `HTTP 201`;
- the body starts with `[{"n":"E1",`.

Bound: P1's `transaction_timeout` 110 s. Do nothing in window W until the
sender prints its result (at most 150 s).

**5.3 CLAUDE.** → **V-FILE**, then:

```bash
node -e "const f=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));const r=JSON.parse(f.body);const s=[...r].sort((a,b)=>a.n<b.n?-1:a.n>b.n?1:0).map(x=>x.n+'\t'+x.what+'\n').join('');console.log(f.httpStatus,f.ref,f.readOnly,f.requestMd5,f.requestBytes,r.length,require('crypto').createHash('md5').update(s).digest('hex'))" ".stage0-send/<P1 results file>"
```

**Expected exactly:** `201 gmxyisjjaxtpycsmmzef false 2546a4a45a79cb2ec8a986df84396a9c 240125 45 5983d4a7f104692cc90e0004da21efa9`.

The digest is md5 over the 45 rows, sorted by `n`, as `n<TAB>what<LF>`. It
was taken from the local PG 17 run of the same text. Every `what` is fixed by
the proofs file, so a passing run has exactly these rows. The ids are:
- `E1`–`E5`, `E6a`–`E6f`, `E7`, `E8`, `E8b`, `E9`–`E20`, `E21a`–`E21d`,
  `E22`;
- `S0.1`–`S0.3`, `S1.1`, `S1.2`, `S2.1`–`S2.6`, `S3.1`, `S3.2`, `S4.1`.

Section 1b's `S1.0` and `S1.3` (03 alone, its 42702) run inside the savepoint
that P1 rolls back, so their rows go with it. Their absence is expected: a
failure there would have aborted P1.

On a difference, Claude lists the missing and extra ids. Any difference is
STOP.

**5.4 RYAN — P0 again (window R).** → **V-WIN**, **V-SEND**.
**CLAUDE:** → **V-FILE**. **All 26 columns identical to P0₀**, `free_pins`
included. P1 commits nothing, so P0-S and P0-L must both be unchanged (plan
§E3).

**5.5 RYAN — STATE (window R).** This is the first run of STATE on
production. → **V-WIN**, **V-SEND**. **CLAUDE:** → **V-FILE**. Expected
`effective_prefix ""`, `ledger_md5_ok true`, `catalog_state "00"`,
`recovery "none — nothing is applied"`.

A permission error here is STOP before anything changes. STATE is the
read-back that decides every later unknown outcome, so it must be known to
work first.

---

## 6. P2 — apply, four steps, in order

Every step runs the same loop. The next step is sent only after Claude has
said **"PASS — next: <step>"**.

| | who | what | expected |
|---|---|---|---|
| a | CLAUDE | LOCKS, **before P2-01 only** | `employees_locks 0` |
| b | RYAN (W) | send the step. → **V-WIN**, **V-SEND** | `HTTP 201`, body `[{"set_config":"45s"}]` |
| c | RYAN (R) | send `STATE`. → **V-WIN**, **V-SEND** | the STATE row for this step (§0.7) |
| d | CLAUDE | → **V-FILE** for both files | as above |
| e | CLAUDE | LEDGER | the step's new row(s) and `ledger_rows` (§0.7); STATE's `ledger_rows` versions equal LEDGER's |
| f | CLAUDE | CATALOG | the A1a state for this step (§0.7) |
| g | CLAUDE | R2COUNTS | every count 0 |
| h | CLAUDE | TABLES-SNAPSHOT | saved as `tables-after-<step>.json`; `ledgerVersion` = the step's last ledger version; 20 tables |

**6.1 P2-01** (01: the six tables, the constraint and the redeem function;
ACCESS EXCLUSIVE on `employees` for at most 45 s). → state **01**, recovery
`RB-1`.

**6.2 P2-02** (02: the limiter functions). → state **02**, recovery
`RB-2, RB-1`.

**6.3 P2-0304** (03 and 04 in ONE transaction, so 03's 42702 body is never
committed). → state **04**, recovery `RB-43, RB-2, RB-1`. There are two
LEDGER rows, 04's one second after 03's.

**6.4 P2-05** (05: the revoke function). → state **05**, recovery
`RB-5, RB-43, RB-2, RB-1`.

**An unknown or failed step.** This covers any status other than 201, any
other body, `HTTP none`, a dead window, or any read-back in d–h that differs:
1. **STATE first** (window R), before anything else is chosen (plan §A6,
   E4). If window R is gone, create a replacement read token (§3.2) for it.
2. P2 stops at that step whatever STATE says. Continuing forward after a
   stopped step is not offered (plan §E4).
3. §A applies to the prefix STATE reports.

---

## 7. P3 — the database half

**7.1 CLAUDE — A2.** CATALOG → exactly state 05 (§0.7):
- the six functions with their `md5(prosrc)` and ACLs;
- each `SECURITY DEFINER`, `search_path=public`, commented;
- the six tables with RLS on, 0 policies, grantees postgres + service_role
  with the full privilege set;
- `employees_id_store_uniq UNIQUE (id, store_id)`.

**7.2 RYAN — P0 after the apply (window R).** → **V-WIN**, **V-SEND**.
**CLAUDE:** → **V-FILE**, then:
- **Unchanged from P0₀** (18 columns): `has_store_role`, `organizations`,
  `stores_org_id`, `stores_without_org` (0), `stores_without_org_ids` (`[]`),
  `probe_slug_absent`, `nil_job_absent`, `auth_users_user_triggers` (0),
  `free_pins`, `server_version_num`, `pg17_hard_timer`, `ledger_columns`,
  `ledger_columns_as_pinned`, `ledger_created_by`,
  `ledger_rows_single_element`, `production_ledger_marker`,
  `staging_seed_absent`, `production_store_present`.
- **Changed exactly as follows** (7 columns):
  - `uniq_already_there` **true**;
  - `release2_tables_present` **6**;
  - `release2_functions_present` **6**;
  - `ledger_head` = 05's version;
  - `ledger_rows` **25**;
  - `release2_in_ledger` **5**;
  - `ledger_matches_repo` **false**: the ledger is no longer the 20-row
    baseline. That is expected, and it is why plan §E6 splits P0-L.
- `catalog_fingerprint` = **`6bc6d53b1e2506390b1d86b32289511d`**:
  - this is the value the local harness computes after P2-05, identical on
    two fresh databases;
  - production's pre-apply fingerprint equalled the local one (§E10);
  - a difference therefore means production's post-apply catalog differs from
    the reviewed model: STOP (§A.1).

**7.3 RYAN — STATE (window R).** → `01,02,03,04,05` / `05` /
`RB-5, RB-43, RB-2, RB-1`, with the LEDGER versions.

**7.4 CLAUDE.**
- CONSUMERS → four `404`: the endpoints still refuse.
- R2COUNTS → all 0.
- `tables-after-P2-05.json` is the final snapshot (§E5).

---

## 8. RYAN — the legacy smoke test (the counter is still closed)

On a counter PC, at `https://printcalculator2.netlify.app` (hard refresh
first):
1. **PIN sign-in** with a real staff PIN → signed in. This is the
   `verify_employee_pin` path, which reads `employees`, the table 01 altered.
2. **Order save:** price a minimal job, then **Save Order** with customer
   name `STAGE0 SMOKE`.
   - The app must report it **saved**, not queued offline.
   - Report the time. The order stays in history as the smoke-test record,
     unless Ryan removes it the way he normally would.
3. **Queue tab:** it opens and lists the upload queue, with no error.
4. Sign out.

Report each result. Any failure is STOP (§A.1).

---

## 9. Tokens deleted (always, on every path)

**RYAN:**
1. In windows R and W: `Remove-Item Env:SUPABASE_ACCESS_TOKEN`, then `exit`.
2. `https://supabase.com/dashboard/account/tokens` → delete
   `stage0-p1p3-read-20261011` and `stage0-p1p3-write-20261011`.
3. Report the times.
4. The list shows no `stage0-` token.
5. If Windows clipboard history is on: Win+V → **Clear all**.

After this, nothing can be sent. Any later read is ad-hoc (§0.6), or needs new
tokens under §3.

---

## 10. RYAN — re-open the counter (position 2, §R)

Only after **§7** (the database half of P3, every read-back as expected) and
**§8** (the legacy smoke test) have both passed. Report the time.

The repository record (§11) follows with the counter open. It touches only
the repository, and its commits stay local until §12.

---

## 11. P3 — the repository half (CLAUDE; the counter is open)

Each commit is made in this checkout, and none is pushed until §12. Let `vNN`
be the versions LEDGER read back in §6. The snapshots are §6 h's
`tables-after-<step>.json`. Every commit must be green on its own. Netlify
runs `yarn test` in every build: a red head fails the staging build at §12,
and a red intermediate commit fails any later build of it. The replay
(§PRE-0) has shown this exact sequence green at every state, with synthetic
versions.

**11.1–11.4 — one commit per P2 step, in order (plan §E4, A5).** P2-0304 is
ONE commit, with both files (M-8). For each step, Claude runs:

```bash
node scripts/manual/stage0-record.mjs forward <step> "<scratchpad>/tables-after-<step>.json" <NN>=<vNN> [<NN>=<vNN>] --captured-by "Claude Code session <id> via Supabase MCP execute_sql (read-only, ad-hoc), authorized by Ryan, 2026-10-11"
```

It **stages** the record and stops:
- `git mv` of each forward file and its companion to
  `supabase/migrations/<vNN>_<name>…`;
- `productionVersion` recorded;
- the manifest generator run;
- `supabase/tables.json` from the snapshot, with `project` and `capturedBy`
  filled.

It stages only those paths, never `git add -A`: this checkout holds an
untracked `AGENTS.md`.

It refuses, before changing anything:
- a dirty tree;
- a step out of order;
- versions that are not one per file, increasing and after everything
  recorded;
- a snapshot whose `ledgerVersion`, Release 2 tables, other tables, views,
  buckets, role, query or keys are not as §0.7 requires.

After staging it checks:
- the manifest changed only in the record fields;
- the staged paths are exactly the record;
- the generator's `--check` passes.

Then Claude:
1. adds that step's row to plan §E12, then
   `git add docs/security/release-2-stage-0-production-plan.md`;
2. commits (`<step> on production: RECORD`);
3. runs the full suite on that commit in a scratch clone (memory:
   verify-commit-in-scratch-clone). It must be green with the same count as
   H.

**11.5 — the P1–P3 record commit.** It holds:
- plan §E11 (window start, P0, P1, P0 again, STATE);
- §E13 (P3, the smoke test, tokens, the counter's re-opening);
- §I;
- `CLAUDE.md`'s Release 2 paragraph: production now holds 01–05 at
  `v01`…`v05`, and `tables.json` lists the six tables.

It touches no pinned file. Then, in a clean clone of that commit:
`yarn install && yarn test` (record the count) and `yarn build`.

**P3 PASS** = §7 + §8 + §11, all green.

---

## 12. Push (CLAUDE, after §11, when Ryan says so)

- **One push**, of `security/release-2-slice-2` only. That is the staging
  site's production branch, so it **rebuilds staging once**
  (`printcalculator2-staging`, which reads the staging project).
- **Never push `main`:** it would build and publish production.
- **Never push `security/release-2-stage-0`:** it rebuilds PR #48's preview
  on the production site. On 2026-10-07, #48 was the only open PR.
- Production is untouched by the push.
  - **RYAN:** Netlify → `printcalculator2` → Deploys shows no new deploy.
  - **CLAUDE:** `deploy-context` on staging records the new staging deploy.
    Its build ran `yarn test` on the record commits. It goes in the next
    record commit, together with any staging rebuild not yet recorded.
- If 1.3 found a GitHub integration, the push waits for review.

---

## A. Abort paths

### A.1 Where it stops, and what follows

| stop | database | what is sent next | counter |
|---|---|---|---|
| before §5 (§1–§4: identifiers, tokens, P0₀ ≠ §E10) | unchanged | nothing | re-opens; nothing happened |
| P1 refused, failed or no response; or 5.3/5.4 differs | unchanged: P1 always ends in `ROLLBACK`, an error or a lost connection rolls it back, and P1 holds no lock afterwards | P0 (R) must equal P0₀; STATE `00` | re-opens after that P0 and the smoke test (§8) |
| 5.5 STATE fails | unchanged | nothing | re-opens after the smoke test |
| P2-01 stopped, STATE `""` / `00` | unchanged | P0 (R) = P0₀ | re-opens after that P0 and the smoke test |
| **P2 stopped with prefix 01, 01–02 or 01–04; or §8 fails after a complete P2** | a reviewed prefix, with read-backs as §0.7 for it | **decision D-P2 (A.2)** | **D-P2** |
| any read-back that STATE does not explain: STATE `STOP`, `ledger_md5_ok false`, a LEDGER/CATALOG difference for the prefix STATE names, or §7.2's fingerprint | not a reviewed state | only reads (STATE, P0, LEDGER, CATALOG, R2COUNTS, CONSUMERS), then §9 | stays closed until review. Ryan may re-open after the smoke test passes, and records why |
| §11 only: a repository record is red, or `stage0-record.mjs` refuses, but §7 and §8 passed | A2, verified | nothing; no push, and the red or refused record stays local for review | already open (§10). It is a record problem, not production's |

Every path runs §9. Then come the records (§A.4).

### A.2 DECISION FOR CODEX — D-P2: a partial P2 inside the window

When P2 stops at a prefix STATE recognizes, and every read-back of that
prefix matches §0.7, may the window run the recovery STATE returns, or is
every partial state STOP-and-review?

**Option A — pre-authorized in-window recovery (Ryan's position, §R 1).**
Ryan sends exactly the sequence STATE returns, one operation at a time, from
window W. Before each operation:
- Claude states the operation, its md5 and bytes (§0.7), and the
  preconditions it just re-checked;
- **Ryan gives an explicit "go" in chat for that one operation.** No "go"
  covers a later operation;
- each operation is read back (§A.3) before the next is proposed.

**All** of these must hold, checked by Claude just before the first
operation, with STATE re-read before each later one:
1. STATE returns a `recovery` sequence (not `STOP`), with
   `ledger_md5_ok true`, and LEDGER and CATALOG match that prefix exactly.
2. **The Release 2 tables are empty:** R2COUNTS all 0. RB-1's own guard also
   refuses unless the five identity/capability tables hold zero rows.
3. **Nothing consumes them:**
   - CONSUMERS shows four `404` on the published production deploy (2.3's id);
   - P4 has not started, and P6 is not merged;
   - the inventory gate is green at H (§1.2): no client names an endpoint
     (plan §F4).
4. P1 passed in this same window. So each RB wrapper body already ran against
   production's catalog in this window, and P1's section 4 proved the result
   equal to the pre-state, row for row.
5. **Each operation is sent at most once.**
   - A non-201 or lost response → STATE.
   - If STATE names the same operation again, it did not commit: STOP.
   - If STATE names the next operation, it committed: continue after the
     read-backs.
6. **At the end, the P0 re-check (window R):**
   - STATE shows `""` / `00` / `none — nothing is applied`;
   - **the schema equals the baseline:** P0-S identical to P0₀, column by
     column (`catalog_fingerprint` `8b3c9eadf9eb8a98cb8cc6dca996663e`
     included);
   - **the ledger was only appended to** (P0-L, plan §E6):
     - the original 20 rows are kept, and the production marker holds;
     - `ledger_rows` = 20 + 2k and `release2_in_ledger` = 2k, for k forward
       files;
     - `ledger_head` = the last rollback row;
     - `ledger_matches_repo false`;
     - LEDGER lists the k forward rows, then the k rollback rows, in RB order;
   - then the smoke test (§8), and the counter re-opens (§10).

   The repository record (§A.4) follows with the counter open: the database is
   back at the reviewed pre-window state. A failed P0 re-check is STOP-and-review,
   and the counter stays closed until review.

Why A:
- **The evidence.** No recovery could be better evidenced: the same RB bytes
  ran on production minutes earlier, inside P1.
- **The choice is mechanical.** STATE chooses the sequence, not a person.
  Each RB operation re-checks identity, its own md5 and the full A1a state
  before it changes anything.
- **F4 holds by construction, and is re-checked.** F4's preconditions for a
  destructive rollback (empty state, no consumers, before P6) hold in this
  window.
- **E0 already holds.** The counter is closed and the owner is present. RB-1
  needs ACCESS EXCLUSIVE on `employees` just as 01 did, so deferring it means
  a second closed-counter window.
- **B leads to the same recovery later.** P1's "before 01" guards refuse over
  any prefix, and E0 requires P1 again after a day. So B ends in the same
  recovery in a later window, with the same texts, after an overnight
  intermediate state and a second pair of tokens.

**Option B — every partial state is STOP-and-review.**
- After STATE, only reads are sent; then §9.
- The database stays at the prefix until review decides, for a later window.
- Every reviewed prefix is inert for the legacy app:
  - 01 adds empty tables, a constraint on `employees (id, store_id)` that
    always holds (`id` is the key), and a function nothing calls;
  - 02–05 add functions only.
- Counter: re-opens after the smoke test (§8) passes, by Ryan's decision,
  recorded.

**Under both options:**
- anything A.1's last row names is STOP-and-review;
- continuing forward after a stopped step is not offered (plan §E4);
- if the smoke test still fails after a full recovery, the cause is not
  Release 2: STOP, and it becomes an incident outside this runbook.

### A.3 The in-window recovery (only if D-P2 = A)

For each operation STATE names, in order:

| | who | what | expected |
|---|---|---|---|
| 0 | CLAUDE, then RYAN | Claude proposes `RB-x` with its md5/bytes and the re-checked preconditions; Ryan answers **"go RB-x"** | an explicit go for this operation only |
| a | RYAN (W) | send `RB-x`. → **V-WIN**, **V-SEND** | `HTTP 201`, `[{"set_config":"45s"}]` |
| b | RYAN (R) | `STATE` | the next row of §0.7's STATE table, read upward |
| c | CLAUDE | V-FILE ×2; LEDGER (the new `_rollback` row(s), §0.7's rollback md5 and bytes); CATALOG (the state STATE names); TABLES-SNAPSHOT (`tables-after-<op>.json`; after RB-1, the 14 tables again) | as listed |

Then point 6 of A.2.

### A.4 The repository record after a stop

- **Nothing applied:** the plan record only.
- **A prefix left applied (D-P2 = B):**
  - §11's per-step commits for the steps that committed;
  - each needs its own snapshot (§6 h).
- **After a recovery:**
  - §11's per-step commits for the forward steps;
  - then one commit per RB operation, RB-43's two records together (M-8):

    ```bash
    node scripts/manual/stage0-record.mjs rollback <RB-x> "<scratchpad>/tables-after-<RB-x>.json" <NN>=<version> [<NN>=<version>] --captured-by "…"
    ```

    It writes each rollback's pinned bytes as
    `supabase/migrations/<version>_<name>_rollback.sql`, appends
    `rollbackRecords`, and refuses an operation out of RB order (plan §E6,
    LC-3's layout).

  Each commit must be green on its own. The replay covers these states too:
  the recovery from every shorter prefix, and the full RB sequence.

---

## B. Time budget

| § | step | who | budget (min) | server bound |
|---|---|---|---|---|
| 1 | pre-window: checkout, dry runs, suite, the record replay (about 30 min), integration read | both | before the window | — |
| 2 | counter, backup, published deploy, Claude's first read-backs | R + C | 10 | — |
| 3 | two windows, two tokens, V-checks | R | 10 | — |
| 4 | P0 and its comparison | R + C | 5 | P0 took 0.5 s on 2026-10-07 |
| 5 | LOCKS, P1, its 45 rows, P0 again, STATE | R + C | 12 | P1: 110 s hard, client 150 s |
| 6 | P2: four steps × (send, STATE, 4 read-backs) | R + C | 28 | each step 45 s hard |
| 7 | A2, P0 after, STATE, CONSUMERS | R + C | 8 | — |
| 8 | smoke test | R | 10 | — |
| 9 | tokens deleted | R | 5 | — |
| 10 | counter re-opens | R | — | — |
| 11 | 4 + 1 record commits, a full suite on each (about 5 min, measured), build | C | 35 (counter open) | — |
| 12 | push and staging check | C + R | 10 | — |

- **To the counter's re-opening: about 1 h 30 min** (§2–§9), so
  17:00–18:30 EDT, with a reserve to 19:00.
- **With an in-window recovery (D-P2 = A):** about 45 min more, to about
  19:45 EDT. That covers the preconditions, up to four operations at about
  7 min each with Ryan's go before each, then the P0 re-check and the smoke
  test.
- **The repository record (§11)** then takes about 35 min with the counter
  open: until about 19:40 EDT, or 20:25 after a recovery.

---

## Record template (plan §E11–E13)

**§E11 — window start and P1:**
- H, both V-HEADs, the 44 dry-run lines;
- the counter confirmation and time; the backup time and type; the published
  deploy;
- `get_project_url`;
- the token names, scope, permission level names and expiry, the masked
  counts and `True` / `44`;
- P0₀ against §E10;
- LOCKS;
- P1: the results file, its status, timings, row count and digest;
- P0 after P1 against P0₀;
- STATE.

**§E12 — P2**, one row per step:

| step | sent → finished (UTC) | HTTP / body | STATE | ledger row(s): version — md5 / bytes | catalog | R2COUNTS | snapshot `ledgerVersion` |
|---|---|---|---|---|---|---|---|

**§E13 — P3:**
- A2 (CATALOG);
- P0 after the apply, with every column and the fingerprint;
- STATE; CONSUMERS;
- the smoke test (times, the `STAGE0 SMOKE` order);
- token deletion times;
- the record commits and their suite counts; `yarn build`;
- the counter's re-opening time;
- after §12, the staging deploy built by the push.

Every ad-hoc read-back is marked **"ad-hoc (not pinned)"**.
