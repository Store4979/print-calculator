# Item 3, phase E: disposition, for Ryan's approval under runbook §7

**Status: DRAFT, UNSIGNED.** This is the reviewed disposition of phase E
that phase X's registration must name (`stage0-go.mjs phase --workflow item3
--phase X … --reviewed <this file>`; runbook §7). The tools record this
file's sha256; they do not read it. That it is a true account of E's exact
receipts is the human check. Under runbook §7 and Codex's review of S
(`reviews/2026-10-29-04b6520-review.md`, "Session clearance"), a
COMPLETE-REFUSED outcome with an agreeing separate read may be approved by
Ryan himself. It clears nothing until the approval in §9 is appended.

## 1. The phase

- **Phase id:** `c862e1bc2ce6258cbbd907b312b144ae`. Workflow `item3`,
  phase `E`, steps E1–E17.
- **Approval id:** `8231f9740c9a980e`, drafted 2026-10-30T14:59:49Z with
  deadline 2026-10-30T16:49:00.000Z.
- **Go:**
  - Ryan's go line arrived 2026-10-30T15:16:50Z and was registered at
    about 15:17:08Z;
  - the go text's sha256 is `7f4a79784a43f446e076b440e65407f34d5326d2245c455761a9c90f5dcbf144`, and it is byte-identical to the
    drafted line.
- **Head H:** `04b6520aecbc597c6d963e3d7d64d58fcdcd0b7e` (tree
  `00f16c61a96575d92201080535914296478a2385`). It was run from the clean
  session clone `C:\Dev\print-calculator-main\.review\item3-04b6520`.
- **Target:** staging `lboajqihpsfrokqvjgnl` only. Nothing was sent to
  production.
- **The route:** the sender `scripts/manual/stage0-send.mjs`, posting to
  `https://api.supabase.com/v1/projects/lboajqihpsfrokqvjgnl/database/query`.
- **Windows and tokens:**
  - window R, marker `c7673a55feaccdfb2edefb6e3d5f3f1d`, with PAT
    `stage0-item3-E-read-20261030`: print-calculator-staging only,
    Database **READ**, nothing else;
  - window W, marker `728ddf89c1e463ab196486f6cb50b1a5`, with PAT
    `stage0-item3-E-write-20261030`: print-calculator-staging only,
    Database **READ-WRITE**, nothing else;
  - each was set to expire "in a day" (the dashboard's words). Both were
    deleted after E (§7).
- **Sends:** 2026-10-30T15:23:22.539Z to 15:35:57.414Z. Every send fell
  inside its go's deadline, its step's ceiling. No go carried a not-after,
  and no clock renewal was needed.

## 2. Every receipt

Each receipt has:
- target `staging`, ref `lboajqihpsfrokqvjgnl`;
- in its guard block, head `04b6520aecbc597c6d963e3d7d64d58fcdcd0b7e` and
  phase `c862e1bc2ce6258cbbd907b312b144ae`;
- `error` null and `tokenRedactedFromResponse` false.

The class is rule 3′'s (`stage0-classify.mjs` at H). The verdict is the
gate's (`stage0-item3.mjs` at H). Each receipt is the file
`<startedAt>_<text>_staging.json` in the session clone's `.stage0-send/`.
Byte-identical copies are in `reviews/requests/item3-E-receipts/`.

| step | text | window | read_only | HTTP | rule 3′ | gate verdict | attempt id | receipt sha256 | bytes |
|---|---|---|---|---|---|---|---|---|---|
| E1 | I3-SETUP | W | false | 201 | R2 | MATCH | `477f82dd2d61a8efce10a22938ee07a9` | `23b66619c6eb519b246dbfc2ea30b20504e0c9c6d356e36acdaf82e0453ac50b` | 925 |
| E2 | I3-FIXTURE | R | true | 201 | R2 | MATCH | `99ec286eccf19dc5c4641c88fb8c2d1a` | `71faf1148605278745d997dd0d6f1e3fff30ef258a24fc78212a2aa50fcbedbe` | 1469 |
| E3 | I3-READBACK | W | false | 201 | R2 | MATCH | `c9469ee70f6b8df447f11c976a05e66c` | `2bd1c1169aae7ebf6f114168dd8e320e94781f2fd8b5a4f95c8e9d4e20b07512` | 1177 |
| E4 | I3-WHO-R-RO | R | true | 201 | R2 | MATCH | `1c90f9d94eba6d06e624f2d2baae0e39` | `f42c20280e4bffe13d472cc44e7f8598e1a729ff8cba6a7ea0b160a451369e0d` | 1258 |
| E5 | I3-WHO-R-DEF | R | false | 201 | R2 | MATCH | `9c128cd9f67c5b5e3602842d6f753319` | `97e5c09853fa5abc8b48be51cba7c00f7361cf498440dab481bf7f2d31e9e915` | 1260 |
| E6 | I3-WHO-W-RO | W | true | 201 | R2 | MATCH | `88a8bdc1780c3efa25238d08df19421e` | `cf0e32d50e0f20863b7a601f68de93c8bf79e13a2fdf40aa99da3348f82d60e4` | 1258 |
| E7 | I3-WHO-W-DEF | W | false | 201 | R2 | MATCH | `cfecb968898512e7fab36e5a7effe675` | `76fab0b34b5f70c062eb428ebdec65b30491eeb8ec04503e3dddfa9b007f4614` | 1231 |
| E8 | I3-INS-OWNED-W-RO | W | true | 400 | R3 | MATCH | `01bbbfd240959873bdca9bc339d47cb6` | `f77785432c6b6bc6b0e81ec30ac9a0f14af80281d54ead3bc9ec361e35728586` | 1005 |
| E9 | I3-INS-OWNED-R-RO | R | true | 400 | R3 | MATCH | `4713fca076a9bcc8f8b6571e4573a162` | `69892b302efe7ba25c2194f24e3e14db94e5d1072a920abe01a3d461d3da6b22` | 1005 |
| E10 | I3-INS-OPEN-R-RO | R | true | 400 | R3 | MATCH | `53aad8189bcc8c0943b243e79c940520` | `c0f1a9a8b78a2decbc72e260a486934a371d9aeb25adf46c4840347913fc08c2` | 1005 |
| E11 | I3-INS-OWNED-W-DEF | W | false | 201 | R2 | MATCH | `39317faf4bcf6111cdf938fa204402d1` | `f92f8540c24cba29b76ceef6caa22d308c9dc747ce22dc614af917447216004a` | 944 |
| E12 | I3-DDL-W-DEF | W | false | 201 | R2 | MATCH | `6f94c5365d4b99831f5eec904003749a` | `53f467f0ac23a4ce87c94cd139e349fdedd703792e1254d6333b20b9883236e0` | 913 |
| E13 | I3-READBACK | W | false | 201 | R2 | MATCH | `ea3b53376532f3d96cd32f9734e1be1a` | `f18a42083ced727ce5cb11353d034ab55b52212893fe9446e88155e52cd135b9` | 1415 |
| E14 | I3-INS-OPEN-R-DEF | R | false | 400 | R3 | MATCH, REFUSED | `09fd8e9f9ab15e86a6fd76f8e24efce8` | `d0049436bc7d4c5bcf7169b2069b07e322c0d1e356f19bf5fae5c4a065892b33` | 1007 |
| E15 | I3-INS-OWNED-R-DEF | R | false | 400 | R3 | MATCH, REFUSED | `428999b64e2242361b8bac73949a9548` | `84e7055d25a42cc6adf2a0dd2e5e7b63b04f5c5abd16edbd2adc41a353fd22d1` | 1008 |
| E16 | I3-DDL-R-DEF | R | false | 400 | R3 | MATCH, REFUSED | `eb07b663a37c19cf5d4787b1f614e060` | `d5c9d95c4b09ef6e4ef545eb4095cfd0c2317a18bc02bdce3f4171b1f4cf21e3` | 1008 |
| E17 | I3-READBACK | W | false | 201 | R2 | MATCH | `6233ebbfcc3bcd209f86fb036c439ccf` | `8bf6ef935ea10388ecf5cd57a7dd1f35037e8b59269b76e73a9e31fe0727caa9` | 1415 |

The response bodies of the refusals:
- **E8, E9, E10, E14, E15:** `{"message":"Failed to run sql query: ERROR:  25006: cannot execute INSERT in a read-only transaction\n"}`
- **E16:** `{"message":"Failed to run sql query: ERROR:  25006: cannot execute CREATE TABLE in a read-only transaction\n"}`

## 3. The readbacks

All three were sent from W without `read_only`, by the fixture's owner.
The gate checked each one against the outcomes before it.

- **E3** (expected: no rows, the four base objects): `[{"owned":[],"open":[],"objects":[{"name":"open","kind":"r","owner":"postgres"},{"name":"open_pkey","kind":"i","owner":"postgres"},{"name":"owned","kind":"r","owner":"postgres"},{"name":"owned_pkey","kind":"i","owner":"postgres"}]}]`
- **E13** (expected: row 4 only, plus `ddl_w`): `[{"owned":[{"id":4,"label":"I3-INS-OWNED-W-DEF","login_role":"postgres","session_role":"postgres","tx_read_only":"off","written_at":"2026-10-30T15:32:02.488961+00:00"}],"open":[],"objects":[{"name":"ddl_w","kind":"r","owner":"postgres"},{"name":"open","kind":"r","owner":"postgres"},{"name":"open_pkey","kind":"i","owner":"postgres"},{"name":"owned","kind":"r","owner":"postgres"},{"name":"owned_pkey","kind":"i","owner":"postgres"}]}]`
- **E17** (expected: exactly what E11–E16 explain): `[{"owned":[{"id":4,"label":"I3-INS-OWNED-W-DEF","login_role":"postgres","session_role":"postgres","tx_read_only":"off","written_at":"2026-10-30T15:32:02.488961+00:00"}],"open":[],"objects":[{"name":"ddl_w","kind":"r","owner":"postgres"},{"name":"open","kind":"r","owner":"postgres"},{"name":"open_pkey","kind":"i","owner":"postgres"},{"name":"owned","kind":"r","owner":"postgres"},{"name":"owned_pkey","kind":"i","owner":"postgres"}]}]`

E17 is identical to E13. No row or object from E14–E16 appears.

## 4. The fixture and the WHO rows (context for §8)

- **E2, the fixture contract:** `[{"schema_owner":"postgres","schema_acl":"{postgres=UC/postgres,=UC/postgres}","tables":[{"name":"open","owner":"postgres","acl":"{postgres=arwdDxtm/postgres,=ar/postgres}","rls":false,"force_rls":false},{"name":"owned","owner":"postgres","acl":"{postgres=arwdDxtm/postgres}","rls":false,"force_rls":false}],"policies":0,"triggers":0,"rules":0,"objects":[{"name":"open","kind":"r"},{"name":"open_pkey","kind":"i"},{"name":"owned","kind":"r"},{"name":"owned_pkey","kind":"i"}],"default_acls":[]}]`
- **E4** (R, read_only): `[{"login_role":"supabase_read_only_user","session_role":"supabase_read_only_user","tx_read_only":"on","default_tx_read_only":"on","superuser":false,"bypass_rls":true,"write_all_data":false,"read_all_data":true,"schema_usage":true,"schema_create":true,"owned_insert":false,"owned_select":true,"open_insert":true,"open_select":true}]`
- **E5** (R, no read_only): `[{"login_role":"supabase_read_only_user","session_role":"supabase_read_only_user","tx_read_only":"on","default_tx_read_only":"on","superuser":false,"bypass_rls":true,"write_all_data":false,"read_all_data":true,"schema_usage":true,"schema_create":true,"owned_insert":false,"owned_select":true,"open_insert":true,"open_select":true}]`
- **E6** (W, read_only): `[{"login_role":"supabase_read_only_user","session_role":"supabase_read_only_user","tx_read_only":"on","default_tx_read_only":"on","superuser":false,"bypass_rls":true,"write_all_data":false,"read_all_data":true,"schema_usage":true,"schema_create":true,"owned_insert":false,"owned_select":true,"open_insert":true,"open_select":true}]`
- **E7** (W, no read_only): `[{"login_role":"postgres","session_role":"postgres","tx_read_only":"off","default_tx_read_only":"off","superuser":false,"bypass_rls":true,"write_all_data":false,"read_all_data":true,"schema_usage":true,"schema_create":true,"owned_insert":true,"owned_select":true,"open_insert":true,"open_select":true}]`

A WHO row describes its own request only. It does not show the role or mode
of any other request.

## 5. The separate-credential read

- **Permission:** `gate` printed `"corroborate": true` at 15:36:15Z
  (COMPLETE-REFUSED, nothing held, no lock, before E's deadline).
- **The read:**
  - sent once, by Claude, between 15:36:15Z and 15:36:46Z, through this
    session's Supabase MCP `execute_sql`;
  - project `lboajqihpsfrokqvjgnl`;
  - authorized by the MCP server's own credential, neither PAT, and not
    sent through the sender;
  - unpinned, and labelled ad-hoc in its first line.
- **The query, exactly as `gate` printed it:**

  ```sql
  -- item 3, separate-credential read (ad-hoc, read-only, not a pinned text)
  select 'owned' as t, id, label, login_role, session_role, tx_read_only from stage0_item3.owned
  union all
  select 'open', id, label, login_role, session_role, tx_read_only from stage0_item3.open
  union all
  select 'object', null, c.relname || ':' || c.relkind::text, pg_get_userbyid(c.relowner), null, null
    from pg_class c where c.relnamespace = 'stage0_item3'::regnamespace
  order by 1, 2, 3;
  ```

- **The rows, saved exactly** as `item3-E-receipts/corroboration-rows.json`,
  sha256 `981749c9b98f714461ac0938d4d0a2bfdd53ef69985711893b46c86fef6a5e5f`:

  ```json
  [{"t":"object","id":null,"label":"ddl_w:r","login_role":"postgres","session_role":null,"tx_read_only":null},{"t":"object","id":null,"label":"open:r","login_role":"postgres","session_role":null,"tx_read_only":null},{"t":"object","id":null,"label":"open_pkey:i","login_role":"postgres","session_role":null,"tx_read_only":null},{"t":"object","id":null,"label":"owned:r","login_role":"postgres","session_role":null,"tx_read_only":null},{"t":"object","id":null,"label":"owned_pkey:i","login_role":"postgres","session_role":null,"tx_read_only":null},{"t":"owned","id":4,"label":"I3-INS-OWNED-W-DEF","login_role":"postgres","session_role":"postgres","tx_read_only":"off"}]
  ```

- **The comparison:** `node scripts/manual/stage0-go.mjs corroborate --phase
  c862e1bc2ce6258cbbd907b312b144ae --rows <that file>`, at 15:36:46Z, exit
  0. Its output (`item3-E-receipts/corroborate-output.txt`, sha256
  `191dc1c86a43eecaa823df499c084d5a462770ee978f9ce670e37ec5d78b70a3`):

  ```text
  AGREE: the separate-credential read agrees with E17 in every row, object and owner.
  ```

## 6. The gate

**At 15:36:15Z, after E17** (`item3-E-receipts/gate-after-E17.txt`, sha256
`f656a8faceba6b37582f0943f1b43da164bc086004d33cbc5f04eaeb9d164c28`), verbatim:

```text
{
  "phaseId": "c862e1bc2ce6258cbbd907b312b144ae",
  "workflow": "item3",
  "phase": "E",
  "stop": false,
  "next": null,
  "complete": true,
  "terminal": {
    "outcome": "COMPLETE-REFUSED",
    "wrote": [],
    "corroborate": true,
    "disposition": "Ryan or Codex"
  },
  "reason": "E is complete and consistent, and every measured write was REFUSED. The one separate-credential read (runbook §6) is permitted while nothing is held; X waits for a reviewed disposition",
  "results": [
    {
      "step": "E1",
      "verdict": "MATCH"
    },
    {
      "step": "E2",
      "verdict": "MATCH"
    },
    {
      "step": "E3",
      "verdict": "MATCH"
    },
    {
      "step": "E4",
      "verdict": "MATCH"
    },
    {
      "step": "E5",
      "verdict": "MATCH"
    },
    {
      "step": "E6",
      "verdict": "MATCH"
    },
    {
      "step": "E7",
      "verdict": "MATCH"
    },
    {
      "step": "E8",
      "verdict": "MATCH"
    },
    {
      "step": "E9",
      "verdict": "MATCH"
    },
    {
      "step": "E10",
      "verdict": "MATCH"
    },
    {
      "step": "E11",
      "verdict": "MATCH"
    },
    {
      "step": "E12",
      "verdict": "MATCH"
    },
    {
      "step": "E13",
      "verdict": "MATCH"
    },
    {
      "step": "E14",
      "verdict": "MATCH",
      "outcome": "REFUSED"
    },
    {
      "step": "E15",
      "verdict": "MATCH",
      "outcome": "REFUSED"
    },
    {
      "step": "E16",
      "verdict": "MATCH",
      "outcome": "REFUSED"
    },
    {
      "step": "E17",
      "verdict": "MATCH"
    }
  ],
  "holds": [],
  "lock": false,
  "corroborate": true,
  "query": "-- item 3, separate-credential read (ad-hoc, read-only, not a pinned text)\nselect 'owned' as t, id, label, login_role, session_role, tx_read_only from stage0_item3.owned\nunion all\nselect 'open', id, label, login_role, session_role, tx_read_only from stage0_item3.open\nunion all\nselect 'object', null, c.relname || ':' || c.relkind::text, pg_get_userbyid(c.relowner), null, null\n  from pg_class c where c.relnamespace = 'stage0_item3'::regnamespace\norder by 1, 2, 3;"
}
The one separate-credential read is permitted now, exactly the query above (COMPLETE-REFUSED).
```

**Re-read at 2026-10-30T16:18:36Z** (read-only): the same terminal outcome:
`{"stop":false,"next":null,"complete":true,"terminal":{"outcome":"COMPLETE-REFUSED","wrote":[],"corroborate":true,"disposition":"Ryan or Codex"},"holds":[],"lock":false,"corroborate":true}`.

That re-read still prints `"corroborate": true` because E's deadline
(16:49Z) has not passed and nothing is held. The read was made once and is
not repeated: the once-only rule is procedural (Codex, review of S).

## 7. Close-down

- **Both windows closed** (Ryan's pastes):
  - W: "closed marker 728ddf89c1e463ab196486f6cb50b1a5; voided 0 unused
    go(s)";
  - R: "closed marker c7673a55feaccdfb2edefb6e3d5f3f1d; voided 0 unused
    go(s)";
  - each then ran `Remove-Item Env:SUPABASE_ACCESS_TOKEN`,
    `Remove-Item Env:STAGE0_SESSION`, `exit`.
- **The tokens:** both deleted and the clipboard cleared, as Ryan
  confirmed by 15:41Z. The exact deletion time was not stated.
- **15:41:22Z, `status --target staging`:**
  - store `3389bb8f8df9280e7608c455249678f5` intact, 59 events;
  - 17 attempts, each with its outcome recorded;
  - no holds, no live gos, no markers, no lock.

## 8. Conclusion

**What phase E observed.** On staging (`lboajqihpsfrokqvjgnl`), on
2026-10-30, through the sender's route, three statements were each refused
with `25006`, the read-only-transaction refusal. Each was sent with a
**Database: Read** PAT and without `read_only`:
1. an INSERT into `stage0_item3.open`, a table that grants INSERT to PUBLIC
   (E14);
2. an INSERT into `stage0_item3.owned`, a table that grants nothing beyond
   its owner (E15);
3. a CREATE TABLE in `stage0_item3`, a schema that grants CREATE to PUBLIC
   (E16).

None of the three left a row or an object: E17 and the separate read agree.

**The controls held:**
- with `read_only`, every INSERT was refused with `25006`, from both tokens:
  - E8, W, into `owned`;
  - E9, R, into `owned`;
  - E10, R, into `open`;
- without `read_only`, the **Read and Write** PAT's INSERT into `owned`
  (E11) and its CREATE TABLE in `stage0_item3` (E12) both succeeded.

So the route and the fixture accepted an INSERT and a CREATE TABLE when the
request ran as `postgres`.

**What the WHO rows show, for their own requests:**
- the Read PAT's requests, with `read_only` (E4) and without it (E5), ran
  as `supabase_read_only_user` with `transaction_read_only` on and
  `default_transaction_read_only` on;
- the Read and Write PAT's request with `read_only` (E6) ran the same way;
- the Read and Write PAT's request without `read_only` (E7) ran as
  `postgres`, read-write.

The role of each refused request (E14–E16) was not observed: only its
`25006` was.

**What this does NOT establish:**
- **Anything about production.** No production request of any kind was
  made, and production's roles and settings were not read.
- **Anything beyond these three statements**, in this fixture, by this
  token, on this route, on this date. In particular, no statement was sent
  that first tries to change the transaction's mode, and no function, other
  schema or other kind of statement was tried.
- **Anything about other routes**: PostgREST, other Management API
  endpoints, or the MCP server's tools under their own credential.
- **That the Read/Write PAT split is server-enforced in general.** What was
  observed is a role whose transactions default to read-only. That is a
  platform setting, and this experiment cannot show it will stay as it is.

**Disposition:**
- E's outcome, COMPLETE-REFUSED with an agreeing separate read, is accepted
  as recorded here.
- Nothing is held, and no incident or STOP needs review.
- The fixture is no longer needed as evidence. The receipts, the gate
  output and the separate read are preserved (§2–§6), as are the guard
  store's journal and the session clone's `.stage0-send/`.
- **Phase X may be registered naming this file,** under its own freshly
  drafted go line, with fresh R and W tokens and windows:
  - X1 `I3-CLEANUP` from W, expected `[{"gone":true}]`;
  - X2 `I3-ABSENT` from R, expected `[{"gone":true}]`.

  Staging only.

## 9. Approval

Unsigned. Ryan approves by sending, in chat, exactly this line, with the
sha256 of this file as drafted in place of `<sha256>`:

```text
APPROVE item 3 phase E disposition c862e1bc2ce6258cbbd907b312b144ae, sha256 <sha256>
```

Claude then appends, at the very end of this file, an "Approved" block:
- Ryan's message, verbatim;
- the time it arrived;
- this file's draft sha256.

None of the draft's bytes change: the appended file begins with exactly
the draft. The final file's sha256 is the one X's registration records.

## Approved

- **Ryan's message, verbatim**, sent in chat:

  ```text
  APPROVE item 3 phase E disposition c862e1bc2ce6258cbbd907b312b144ae, sha256 28189dfa646893df4e6d601290d8cde795ee7e50495f22c7f9adcecbbceedc37
  ```

- **Arrived:** 2026-10-30T16:34:36Z (12:34 EDT 2026-10-30).
- **The draft it approves:** sha256 `28189dfa646893df4e6d601290d8cde795ee7e50495f22c7f9adcecbbceedc37`, 18970 bytes. That
  draft is every byte of this file above this block, unchanged.
