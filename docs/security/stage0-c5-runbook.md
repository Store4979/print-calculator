# Stage 0 — C5, the production credential transition (P5): runbook

**Status: DRAFT. It needs its own review before use, and nothing below has
run.** It turns plan §C5 (with §C4, C6–C9 and B1) into an ordered procedure
for **production**:
- Supabase project `gmxyisjjaxtpycsmmzef`;
- Netlify site `printcalculator2`, production branch `main`,
  `https://printcalculator2.netlify.app`.

It is modelled on the C3 staging runbook
(`docs/security/stage0-c3-runbook.md`). Every check after a paste is built
from a mistake that happened in C3 (plan §E9).

**When it may run (C10):** after P4 is recorded (the flag and context check
are live, and the production-ref refusal still blocks), and **before P6**.
It is never run before P4: P4's own build captures the old key, and the
old-key set (B1) is taken after it.

Each step is either:
- **RYAN** — an exact dashboard click-path. Ryan replies "done" plus the
  non-secret observation asked for;
- **CLAUDE** — an exact probe, with its expected result.

**Any deviation is STOP:** record it and return to review. Never retry until
it passes.

---

## 0. Rules

### 0.1 Identifiers, before EVERY Ryan step

- The **Supabase** URL contains **`gmxyisjjaxtpycsmmzef`**. If it contains
  `lboajqihpsfrokqvjgnl`, that is **staging**: STOP.
- The **Netlify** site is **`printcalculator2`**, **not**
  `printcalculator2-staging`. The two dashboards look identical; read the
  site name in the header every time. A wrong site is STOP.
- Claude's calls (`get_project_url`, `execute_sql`, `query_logs`) name
  `project_id` `gmxyisjjaxtpycsmmzef`. `get_project_url` must return
  `https://gmxyisjjaxtpycsmmzef.supabase.co` before the first of them.
- Every probe host is `printcalculator2.netlify.app` or ends in
  `--printcalculator2.netlify.app`.

### 0.2 The checks after a paste (from C3's mistakes)

| check | when | what Ryan or Claude verifies | the C3 event behind it |
|---|---|---|---|
| **V-TYPE** | after creating a key | Ryan: the key is listed under the **"Secret keys"** heading with the intended name, and its masked value starts `sb_secret_` | C3 3.3: the first "secret" key was created under **Publishable**, and row R accepted it |
| **V-CONTEXT** | after every save of `SUPABASE_SERVICE_ROLE_KEY` | Ryan re-opens the variable and reads back which contexts hold a value. It must equal the step's expected layout exactly; report it | C3 3.1/3.2: "same value for all deploy contexts" put keys into five contexts instead of Production only |
| **V-PLACEMENT** | after every build that should hold the new key | Claude: row R accepted **and** the gateway log row for that probe shows `sb_secret_` and the new key's hash (plan C5.5) | C3 3.3: row R alone cannot tell a publishable key from a secret key |
| **V-CLIP** | after every key paste into a dashboard | Ryan copies a harmless word (e.g. `cleared`) to overwrite the clipboard before the next step. Before any masked prompt, the asterisk count must match the expected length: `CLEANUP_SECRET` 64, an `sbp_` token 44 | C3: an `sb_secret_` key still in the clipboard was pasted into the cleanup prompt |
| **V-PROMPT** | every `Read-Host` | the text after `Read-Host` is a label, never edited. The value goes **after the colon**, at the masked prompt | C3 9.3: a token's first 9 characters became a prompt label and reached the chat |
| **V-BIND** | every deploy | bound by its `deploy-context` `deployId` and `commitRef`. "Published" on the dashboard is not enough | C3 F.3: "published" was reported before the build had finished |

### 0.3 No pushes

There are no pushes to `main` from step 1.1 until step F. A push to `main`
builds and publishes production with whatever key is set at that moment,
which adds an unplanned old-key or new-key deploy. Record commits go to the
release branch, which rebuilds staging only.

### 0.4 No access token is needed

C5 sends no pinned SQL text. Its database reads are **ad-hoc (not pinned)**
read-only queries through `execute_sql`, plus `query_logs`, both labelled as
such. No personal access token is created in C5.

### 0.5 Write-free

- Row R returns before any insert. P0 proves the slug `r2-probe-nonexistent`
  does not exist.
- The cleanup call always carries `{"dryRun":true}`.
- READBACK is `0` R2-PROBE rows at the start and at the end.
- The canary is the **one** intended mail (C7).

### 0.6 The probes

**CTX(host)** and **ROW-R(host)** are exactly as in the C3 runbook §0, with
production hosts:

- **CTX:** `curl -s "https://<host>/.netlify/functions/deploy-context"`.
  Record `deployId`, `commitRef`, `context`, and `siteName` =
  `printcalculator2`.
- **ROW-R:**

  ```bash
  curl -s -w '\nHTTP %{http_code}\n' -X POST "https://<host>/.netlify/functions/register-job" -H 'content-type: application/json' --data-raw '{"customerName":"R2-PROBE","files":[{"path":"r2-probe/none"}],"storeSlug":"r2-probe-nonexistent"}'
  ```

  - accepted = `400 Unknown store: r2-probe-nonexistent`;
  - refused = `500 Store lookup failed: <message>`. Production accepts only
    the two recorded messages (plan C5.8).

**LOG(ts)** (`query_logs`, read-only) returns the `edge_logs` rows for
`/rest/v1/stores` in a ±30 s window around a probe. Credential fields are
read only as the first 10 characters, except `apikey.prefix`, which may be
read in full (15 characters) for C5.5's name binding:
- `response.status_code`;
- `request.sb.apikey.apikey.prefix` and `.hash`;
- `request.sb.jwt.apikey.payload.role` and `.signature_prefix`;
- `unauthorized_hint.error_code`;
- `request.headers.x_client_info` (`runtime=node` is a function;
  `runtime=web` is a browser).

A missing row is recorded as missing. It proves nothing either way.

**READBACK** (`execute_sql`, ad-hoc, not pinned, read-only):

```sql
select (select count(*) from public.pending_jobs where customer_name = 'R2-PROBE') as r2_probe_rows,
       (select count(*) from public.stores where slug = 'r2-probe-nonexistent') as probe_slug_rows,
       now() as read_at;
```

**CLEANUP(host)** is the C3 runbook's PowerShell block, run by **Ryan**, with
the production host. Under V-CLIP and V-PROMPT, the prompt must show **64**
asterisks before Enter.

**LOOP(host)** is plan C5.8's bounded re-probe, run by Claude:
- row R every 30 s, for at most 10 min;
- it stops at the first refusal whose message is one of the two accepted;
- every attempt is written to the session log;
- not refused after 10 min, or refused with any other message, is STOP.

```bash
H="<host>"; for i in $(seq 1 20); do t=$(date -u +%FT%TZ); r=$(curl -s -w ' HTTP %{http_code}' -X POST "https://$H/.netlify/functions/register-job" -H 'content-type: application/json' --data-raw '{"customerName":"R2-PROBE","files":[{"path":"r2-probe/none"}],"storeSlug":"r2-probe-nonexistent"}'); echo "$t $r"; case "$r" in *"Unregistered API key"*|*"Legacy API keys are disabled"*) echo "REFUSED (accepted message) at attempt $i"; exit 0;; *"Store lookup failed"*) echo "STOP: refused with an unrecorded message"; exit 1;; esac; sleep 30; done; echo "STOP: not refused within 10 min"; exit 1
```

---

## 1. Records before anything changes (C5.1, C4.1, C8, B1) — all read-only

**1.1 RYAN — the production API-keys inventory.** Supabase →
`gmxyisjjaxtpycsmmzef` → Project Settings → **API Keys**.
- **"API Keys" tab:** every publishable and secret key, with its name, type,
  and created time if shown.
- **"Legacy API Keys" tab:** enabled or disabled.
- Report the project's name as shown, too.

**1.2 RYAN — the production variables.** Netlify → `printcalculator2` →
Environment variables. For `SUPABASE_SERVICE_ROLE_KEY`,
`VITE_SUPABASE_ANON_KEY`, `SUPABASE_URL` and `CLEANUP_SECRET`, report each
one's:
- scopes;
- **context layout** ("same value for all" or per context, and which
  contexts hold a value);
- whether it is marked secret;
- **last updated** time.

No values, except two non-secret ones:
- `SUPABASE_URL` must contain `gmxyisjjaxtpycsmmzef`;
- `VITE_SUPABASE_ANON_KEY`'s first 15 characters, if the dashboard reveals
  them (C8).

**1.3 CLAUDE — C8 from the public side.** If `VITE_SUPABASE_ANON_KEY` has one
value for all scopes and contexts, read the published client bundle, as C3
did: the value compiled next to `https://gmxyisjjaxtpycsmmzef.supabase.co`.
- It must start `sb_publishable_`.
- A JWT there (C3 found staging's legacy anon key that way) means **C8
  fails**, and 1.8 applies.

**1.4 RYAN + CLAUDE — the old-key set (B1), taken AFTER P4.**
- Ryan: Netlify → Deploys. List every **ready** production-site deploy that
  can still serve functions: its id, context, commit and time. That covers
  P4's published deploy, the B2 rows (`6ab020c5…` @`7ec5af4`, `6aad56a3…`
  @`9937728`), the retained `6aa994d5…` @`89de03e` and `6aa59114…`
  @`7f89876`, and anything built since.
- Claude: CTX on each unique URL (V-BIND). The list Claude binds is **the
  old-key set**.

**1.5 RYAN — other holders (C2).** Anything outside the repository that holds
a production secret key or the production `service_role` JWT, or "none".

**1.6 CLAUDE — target and READBACK.** `get_project_url`, then READBACK:
`r2_probe_rows 0`, `probe_slug_rows 0`.

**1.7 CLAUDE — the old key's TYPE (C4).**
- C4.1 from 1.1/1.2: was the variable last written before every secret key
  existed?
- **The provider-side evidence C3 made available:** one ROW-R on P4's
  published deploy, then LOG(ts) for that probe.
  - A JWT `apikey` (`signature_prefix` recorded) means the old key is the
    **legacy `service_role` JWT**.
  - An `sb_secret_` prefix with a hash means it is that **secret key**.
- Record T = legacy / secret / unknown. If no log row exists, T rests on
  C4.1, or is unknown, and C4.3 applies.
- *(For review: C4 does not yet list the log as evidence. C3 showed it is
  reliable when the row exists.)*

**1.8 RYAN — only if C8 failed (1.3).** Set `VITE_SUPABASE_ANON_KEY` (the
Functions scope at least) to the **production** `default` publishable key,
copied from production's API Keys page. Run **V-CONTEXT** on it. It takes
effect at 4's build, before any legacy disable (C8).

**Stop conditions:** an identifier mismatch; `probe_slug_rows ≠ 0`; an
old-key URL that cannot be bound.

---

## 2. C5.2 — RYAN: create the new secret key

Supabase (`gmxyisjjaxtpycsmmzef`) → API Keys → "API Keys" tab. Scroll to the
**"Secret keys"** heading and use **that section's** "Add new secret key"
button. Name it **`release2_stage0_<YYYYMMDD>`**; use hyphens if the
dashboard accepts them.

→ **V-TYPE**: report the heading it is listed under, its name, and that its
masked value starts `sb_secret_`. Anything else is STOP. Do **not** delete a
wrongly-typed key yet; report it.

---

## 3. C5.3 — RYAN: move the consumers (Production only)

Copy the new key from Supabase. Then Netlify (`printcalculator2`) →
Environment variables → `SUPABASE_SERVICE_ROLE_KEY` → Options → Edit:
- If 1.2 recorded **"same value for all deploy contexts"**: choose
  **"Different value for each deploy context"**. Paste the key into
  **Production**, and **clear every other context** (Deploy Previews, Branch
  deploys, Preview Server & Agent Runners, Local development).
- If it was already per-context: change **Production** only, and leave the
  other contexts exactly as 1.2 recorded them.
- Scopes: unchanged. Save.

→ **V-CONTEXT**: re-open the variable and report the layout. Only Production
may hold the new key; every other context must be as stated above.
→ **V-CLIP**.

---

## 4. C5.4 — RYAN + CLAUDE: a fresh build of the pinned source

- **Ryan:** Deploys → Trigger deploy → **"Clear cache and deploy project"**.
  That builds `main`'s tip, which must be the A3 commit (P4). It is a build,
  never a republish. Report "started".
- **Claude:** wait until the plain URL's CTX shows a **new** `deployId`
  (**V-BIND**). Record it and its `commitRef`.
- **Claude — the A3 comparison:** for every pinned path in the manifest's
  `a3` block, run `git rev-parse <commitRef>:<path>`. Each must equal the
  pin. Any difference is STOP.
- That deploy is **`P_new`**.

---

## 5. C5.5 — the current-deploy proof on `P_new`

1. **CLAUDE:** row P (`start-upload` `POST {}` → `400 fileName required`),
   then **ROW-R → accepted**.
2. **CLAUDE — V-PLACEMENT / the key-type proof (plan C5.5):** LOG(ts) for
   that ROW-R:
   - the row shows `runtime=node`, `apikey.prefix` beginning **`sb_secret_`**,
     and a hash that is new to the record;
   - the 15-character `apikey.prefix` equals the prefix the API Keys page
     shows for the new key, which Ryan reads there. **If the name cannot be
     positively bound to the observed prefix and hash — the page shows no
     prefix, or it differs — STOP before step 7.** There is no elimination
     fallback (plan C5.5);
   - **Ryan** re-confirms it is listed under **"Secret keys"**.

   A publishable prefix, or a JWT, is STOP.
3. **RYAN — the canary (C7):**

   ```bash
   curl -s -X POST https://printcalculator2.netlify.app/.netlify/functions/send-print-job -H 'content-type: application/json' -d '{"subject":"STAGE 0 CANARY - no action needed","details":{"jobId":"STAGE0-CANARY","user":{"name":"STAGE 0 CANARY - no action needed"}}}'
   ```

   - Ryan confirms the mail arrived in the store inbox.
   - Ryan reads the `send-print-job` function log for that request. It must
     show `recipientSource: "store:store4979"`.
   - Any `fallback:*` is STOP.
4. **RYAN — CLEANUP(printcalculator2.netlify.app)** → `HTTP 200 |
   dryRun=True`, with V-CLIP and V-PROMPT (64 asterisks).
5. **RYAN — the counter check:** a real order save, and the queue tab.

---

## 6. C5.6 — CLAUDE: the historical baseline, BEFORE revocation

ROW-R on every URL in the old-key set (1.4) → **accepted**. Then LOG(ts) for
each, recording the key identity each one sends. Then READBACK.

Without this baseline, a later refusal cannot be attributed to the
revocation.

---

## 7. C5.7 — RYAN: revoke, per T (C4)

**Precondition:** C8 passed (1.3, or 1.8 applied and built in 4).

| T (1.7) | revoke |
|---|---|
| legacy | API Keys → **Legacy API Keys** → **Disable JWT-based API keys** |
| secret | API Keys → that **secret key** → Delete |
| unknown | both: disable legacy, AND delete **every secret key that existed before 2** (1.1's list). Never the new key |

Report the time of each action. **Never re-enable legacy keys:** C3.5 showed
re-enabling restores the SAME keys, so every legacy-captured deploy would
reopen. That is C9's break-glass, which voids G0.

---

## 8. C5.8 — CLAUDE: the historical proof

1. **LOOP** on each old-key URL, one URL at a time. Each must end in an
   accepted refusal within 10 min; the attempts and the stop time are
   recorded per URL.
2. LOG(ts) for the refusing probe: the gateway code must be the matching
   one, and the key identity must match 6's row for that URL.
3. Then the rest of the C6 matrix on each URL: rows P, D, X, F (and C if
   authorized). These routes cannot distinguish, so they rely on the
   same-deploy binding plus the provider-side record.

---

## 9. C5.9 — CLAUDE: the current deploy, after every loop has ended

ROW-R(`P_new`) → **accepted**, plus LOG(ts) showing the same `sb_secret_` hash
as in 5. That proves the revocation missed the new key.

The owner-Auth check is P7's first step, after P6 (plan C8). Until then,
C3.4 is the mechanism's proof.

---

## 10. C5.10 — RYAN: the provider-side record

The API Keys page now shows:
- the old key gone, or legacy disabled, as 7 did;
- the new secret key.

Report the list and the time.

---

## F. Final read-back

- **Ryan:** the API Keys inventory as in 1.1; the Netlify variables as in 1.2
  (layout and last-updated time); and **no** personal access tokens were
  created in C5.
- **Claude:**
  - CTX on the plain URL;
  - ROW-R and LOG on `P_new`, which must still be accepted with `sb_secret_`;
  - one ROW-R on each old-key URL, which must still be refused;
  - READBACK `0`;
  - the B1 table re-taken after P5 (plan B1).
- **Record** everything in the plan's P5 record. Commit to the release
  branch: this rebuilds **staging**, not production. No push to `main`.

**Rollback before 7** (plan C9): set `SUPABASE_SERVICE_ROLE_KEY` Production
back to the old key's value (copied from Supabase; it is still valid), then
a fresh build.

**After 7:** a deleted key cannot return. Create a replacement secret key and
repeat 2–5. Legacy re-enable is break-glass only (plan C9).
