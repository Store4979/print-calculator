# Stage 0 — C3 staging rehearsal: runbook

**Status: FOR REVIEW — nothing below has run.** Codex accepted `07574c1` and
cleared C3 to run on staging under the approved plan
(`docs/security/release-2-stage-0-production-plan.md` §C3 items 1–7, applying
§C4–C8 to staging). **Production is not touched by any step.** C3 runs in one
session with Ryan, items 1–7, after Codex reviews this runbook and the pinned
sender.

Each step is either:
- **RYAN** — an exact dashboard click-path. Ryan replies "done" plus the
  non-secret observation the step asks for;
- **CLAUDE** — an exact probe from this session, with its expected result.

**Any deviation from an expected result is STOP.** Record the observation;
never retry until it passes. Results go into plan §E9 as they happen.

---

## 0. Rules for every step

**Identifiers, confirmed at the top of EVERY Ryan step:**
- the Supabase dashboard URL contains `lboajqihpsfrokqvjgnl` (project
  `print-calculator-staging`);
- the Netlify site name is `printcalculator2-staging`.

If either differs, STOP. Never act on `gmxyisjjaxtpycsmmzef` or
`printcalculator2`.

**Claude's identifiers:**
- every `execute_sql` / `query_logs` call names `project_id`
  `lboajqihpsfrokqvjgnl`. `get_project_url` is read once first and must
  return `https://lboajqihpsfrokqvjgnl.supabase.co`;
- every probe host is `printcalculator2-staging.netlify.app` or ends in
  `--printcalculator2-staging.netlify.app`.

**Key values never enter chat, this session or the repository.** Ryan copies
keys dashboard-to-dashboard only, and reports names, types, creation and
last-updated times, and the prefixes a step asks for. The single exception
is the invalid-key control's generated value (step 3.4). It is not a key:
it exists in no project and grants nothing.

**Write-free.** Row R returns before any insert. The cleanup call always
carries `{"dryRun":true}`. READBACK (below) must return 0 rows for
`R2-PROBE` at the start and at the end.

**Transport (plan §E1 "The transport").** A pinned SQL text goes to a
database only through `scripts/manual/stage0-send.mjs`, run by Ryan, and is
never retyped. C3 sends one pinned text, the SIZE-PROBE (section 9). READBACK
and the C3.6 log queries are **ad-hoc (not pinned)** read-only reads, sent
with `execute_sql` / `query_logs` and labelled as such in the record.

**Ryan's sender commands (used in section 9 only).** Run them in Ryan's own
PowerShell, in this repository's checkout at the reviewed commit. The token
is a Supabase personal access token (`sbp_…`):
- **it is account-wide:** it reaches production too. The sender's policy
  sends SIZE-PROBE to staging only;
- create it just before section 9, with the shortest expiry the dashboard
  offers;
- delete it right after section 9.

```powershell
git log -1 --format=%H                        # must print the reviewed commit
# PowerShell 7.1 or later:
$env:SUPABASE_ACCESS_TOKEN = Read-Host "Paste token" -MaskInput
# Windows PowerShell 5.1 (it has no -MaskInput) — use these two lines instead:
#   $s = Read-Host "Paste token" -AsSecureString
#   $env:SUPABASE_ACCESS_TOKEN = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)); Remove-Variable s
$env:SUPABASE_ACCESS_TOKEN.StartsWith("sbp_")  # prints only True or False
node scripts/manual/stage0-send.mjs SIZE-PROBE --target staging --dry-run
node scripts/manual/stage0-send.mjs SIZE-PROBE --target staging --confirm-ref lboajqihpsfrokqvjgnl
Remove-Item Env:SUPABASE_ACCESS_TOKEN
```

The token is read only from that environment variable. It is never on the
command line, never written, never printed, and the sender refuses without
it. Ryan reports only the `True`/`False` line and the sender's summary (md5,
bytes, ref, HTTP status, the results file name). The results file, in
`.stage0-send/` (gitignored), is read by Claude.

**No pushes from step 1.1 until step F.6.**
- `security/release-2-slice-2` is the staging site's production branch.
  Every push rebuilds and republishes staging with whatever key is set at
  that moment, which would add an unplanned deploy to the old-key set.
- `security/release-2-stage-0` must never be pushed during C3. A push also
  rebuilds PR #48's preview on the PRODUCTION site.

**Deploy names used below:**

| name | what it captured | built at |
|---|---|---|
| `D_old` | staging's current key (the "old key") | before C3, recorded in 1.3 |
| `D_tmpS` | the temporary secret key `c3-temp` | 3.1 |
| `D_tmpL` | the legacy `service_role` JWT, only if the old key's type is unknown (1.7) | 3.2 |
| `D_new` | the new secret key `release2-stage0-c3` | 3.3 |
| `D_ctl` | the generated nonexistent `sb_secret_…` value (the invalid-key control), on branch `security/release-2-stage-0` | 3.4 |
| `D_final` | the final environment | F.3 |

Each deploy is probed on its **unique deploy URL**,
`https://<deployId>--printcalculator2-staging.netlify.app`. The branch URL
`https://security-release-2-stage-0--printcalculator2-staging.netlify.app`
is used for `D_ctl`. The plain URL `https://printcalculator2-staging.netlify.app`
is always the currently published production deploy.

### The probes (Claude runs these; Ryan runs CLEANUP)

**CTX(host)** binds a URL to a deploy. It is read-only and non-secret:

```bash
curl -s "https://<host>/.netlify/functions/deploy-context"
```

Record `deployId`, `commitRef`, `context` and `siteName`, which must be
`printcalculator2-staging`.

**ROW-R(host)** is the distinguishing read (plan C6 row R). It is
write-free: `register-job` looks up the store with the deploy's key and
returns before any insert.

```bash
curl -s -w '\nHTTP %{http_code}\n' -X POST "https://<host>/.netlify/functions/register-job" -H 'content-type: application/json' --data-raw '{"customerName":"R2-PROBE","files":[{"path":"r2-probe/none"}],"storeSlug":"r2-probe-nonexistent"}'
```

- **accepted:** `HTTP 400`, `{"ok":false,"error":"Unknown store: r2-probe-nonexistent"}`;
- **refused:** `HTTP 500`, `{"ok":false,"error":"Store lookup failed: <message>"}`.
  The `<message>` is recorded verbatim.

Each probe's UTC time is recorded (`date -u +%FT%TZ` immediately before it)
for C3.6.

**READBACK** — `execute_sql`, read-only, **ad-hoc (not pinned)**:

```sql
select (select count(*) from public.pending_jobs where customer_name = 'R2-PROBE') as r2_probe_rows,
       (select count(*) from public.stores where slug = 'r2-probe-nonexistent') as probe_slug_rows,
       (select count(*) from public.pending_jobs) as pending_jobs_total,
       now() as read_at;
```

Expected: `r2_probe_rows = 0` and `probe_slug_rows = 0`. `pending_jobs_total`
is recorded and compared at the end.

**CLEANUP(host)** is run by **Ryan only**, because he holds
`CLEANUP_SECRET`. Paste it into **Windows PowerShell**. The secret is typed
at a masked prompt, never echoed and never shown in chat; it does appear on
curl.exe's command line for the duration of the call, on this machine only.
Replace `<host>` before pasting:

```powershell
$u = "https://<host>/.netlify/functions/cleanup-stale-jobs"
$s = Read-Host -AsSecureString "CLEANUP_SECRET (staging)"
$k = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))
$out = @('{"dryRun":true}' | curl.exe -s -w "`n%{http_code}" -X POST $u -H "content-type: application/json" -H "x-cleanup-key: $k" --data-binary "@-")
Remove-Variable k, s
$j = ($out[0..($out.Count - 2)] -join "`n") | ConvertFrom-Json
"HTTP $($out[-1]) | dryRun=$($j.dryRun) | error=$($j.error)"
```

Ryan reports only the last line. It carries no secret: the status, the
`dryRun` field, and the error text when there is one. The body is piped on
stdin (`--data-binary "@-"`) because Windows PowerShell 5.1 strips the
double quotes from a JSON argument passed to a native program.

---

## 1. Records before anything changes (all read-only)

**1.1 RYAN — the staging API-keys inventory.** Supabase → project
`print-calculator-staging` → Project Settings → **API Keys**.
- **"API Keys" tab:** for every publishable and secret key, the name, type
  and created time. Do not reveal any secret value.
- **"Legacy API Keys" tab:** whether the JWT-based keys (`anon`,
  `service_role`) are enabled or disabled.

**1.2 RYAN — the staging environment variables.** Netlify →
`printcalculator2-staging` → Site configuration → **Environment variables**.
For each variable below, record its scopes, its contexts (Production, Deploy
Previews, Branch deploys, any specific-branch values, local), whether it is
marked secret, and its **last-updated time** — never a value, except where
a prefix is asked for:
- `SUPABASE_SERVICE_ROLE_KEY`;
- `VITE_SUPABASE_ANON_KEY`: the **first 15 characters** of the
  Functions-scoped Production value (**C8 on staging: must be
  `sb_publishable_`**), and separately the Builds-scoped value's first 15
  characters (the key the staging client bundle uses);
- `CLEANUP_SECRET`: present or absent; if present, its scopes and contexts;
- `SUPABASE_URL`: contexts. The value is not secret and must contain
  `lboajqihpsfrokqvjgnl`.

**1.3 RYAN — the deploy that captured the old key, and the branch
settings.**
- Netlify → Deploys: the **currently published** deploy's id, commit and
  time. This is `D_old`. Its unique URL,
  `https://<id>--printcalculator2-staging.netlify.app`, is **the deploy
  that captured the old key**.
- Site configuration → Build & deploy → **Branches and deploy contexts**:
  the production branch (expected `security/release-2-slice-2`) and the
  branch-deploy setting (all branches, or which ones are listed).
  `security/release-2-stage-0` must be built there.

**1.4 RYAN — other holders (C2).** Anyone or anything outside this
repository that holds a staging secret key or the staging `service_role`
JWT (a `.env.local`, a script, an integration), or "none". Every pre-existing
secret key is deleted at F.1, so this list is taken first.

**1.5 CLAUDE.**
- `get_project_url` → `https://lboajqihpsfrokqvjgnl.supabase.co`.
- READBACK: expect `r2_probe_rows = 0` and `probe_slug_rows = 0`; record
  `pending_jobs_total`.

**1.6 CLAUDE.**
- CTX on the plain URL and on `D_old`'s unique URL: both show 1.3's
  `deployId`, context `production`.
- ROW-R(`D_old`) → **accepted**. The old key works, so a later refusal on
  this URL can be attributed.

**1.7 CLAUDE — the old key's type (C4.1).** From 1.1 and 1.2:
- `SUPABASE_SERVICE_ROLE_KEY` was last updated **before every secret key's
  creation time**, or no secret key exists → **T = legacy JWT**;
- otherwise → **T = unknown**. A secret key existed when it was written, so
  either type is possible.

**Stop conditions for section 1:**
- `probe_slug_rows ≠ 0` or `r2_probe_rows ≠ 0`;
- ROW-R(`D_old`) not accepted;
- an identifier mismatch.

**1.8 RYAN — only if C8 failed** (the Functions `VITE_SUPABASE_ANON_KEY` is
not `sb_publishable_`). Set the Production, Functions-scoped
`VITE_SUPABASE_ANON_KEY` to the staging publishable key, copied from the
Supabase API Keys page. The publishable key is public. It takes effect at
the next build, `D_new`, before any legacy key is disabled.

---

## 2. Temporary settings (before any build)

Environment changes reach only deploys built after them.

**2.1 RYAN — `CLEANUP_SECRET` for C3.2.** Both `D_new` (Production) and
`D_ctl` (branch `security/release-2-stage-0`) need it at build time.
- **Absent (1.2):** create `CLEANUP_SECRET`, Functions scope, with the same
  temporary value for Production and for the branch/Branch deploys. Use a
  random value kept outside chat, e.g. from a password manager.
- **Present but not in the branch context:** add the same value for that
  branch.
- Record exactly what was added; F.2 removes exactly that.

---

## 3. Builds — each a fresh build, never a republish

**3.1 `D_tmpS` — a deploy that captured a SECRET key (always).**
- RYAN: Supabase → API Keys → "API Keys" tab → **Create new secret key**,
  name `c3-temp`. Copy it from Supabase to Netlify → Environment variables →
  `SUPABASE_SERVICE_ROLE_KEY` → Edit → **Production** value → paste → Save.
  Then Deploys → Trigger deploy → **Clear cache and deploy site**. When it is
  Published, report the deploy id and the created time of `c3-temp`.
- CLAUDE: CTX(`D_tmpS`): context `production`, commit =
  `security/release-2-slice-2`'s tip. ROW-R(`D_tmpS`) → **accepted**.

**3.2 `D_tmpL` — a deploy that captured the LEGACY `service_role` JWT
(only if T = unknown).** If T = legacy, `D_old` is that deploy, so skip this
step.
- RYAN: Supabase → API Keys → **Legacy API Keys** → `service_role` → copy.
  Paste into Netlify → `SUPABASE_SERVICE_ROLE_KEY` → Production → Save →
  **Clear cache and deploy site**. Report the deploy id.
- CLAUDE: CTX(`D_tmpL`), ROW-R(`D_tmpL`) → **accepted**.

**3.3 `D_new` — the new key (C3.3).**
- RYAN: Supabase → **Create new secret key**, name `release2-stage0-c3`.
  Paste into Netlify → `SUPABASE_SERVICE_ROLE_KEY` → **Production** → Save →
  **Clear cache and deploy site**. Report the deploy id, and the key's
  created time.
- CLAUDE: CTX(`D_new`), and the plain URL shows the same `deployId`.
  ROW-R(`D_new`) → **accepted**. That is **C3.3**: the legacy writer's
  supabase-js `createClient` takes an `sb_secret_` key.
- RYAN: CLEANUP(`printcalculator2-staging.netlify.app`) →
  `HTTP 200 | dryRun=True | error=`. That is **C3.2, valid half**.

**3.4 `D_ctl` — the invalid-key control (C3.1a, C3.2 control half).**
- CLAUDE generates the value at run time:

  ```bash
  node -e "const c='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',r=n=>Array.from(require('crypto').randomBytes(n),b=>c[b%62]).join('');console.log('sb_secret_'+r(22)+'_'+r(8))"
  ```

  It has the `sb_secret_` prefix and a secret key's shape (22 + `_` + 8
  characters), and it exists in no project. Claude shows it in chat for Ryan
  to paste. **The record carries only its md5 and length**, never the value.
  A committed `sb_secret_…` string could trip GitHub's secret scanning and
  block the results push, and a reader would have to take on trust that it
  is fake.
- RYAN: Netlify → `SUPABASE_SERVICE_ROLE_KEY` → Edit → add a value for the
  **specific branch `security/release-2-stage-0`**. If the UI offers only
  the whole **Branch deploys** context, use that, provided 1.3 showed this is
  the only branch the site builds; say which was used. Paste the generated
  value → Save. **Do not change the Production value.**
- RYAN: **fresh build of that branch, with no commit.** Netlify → Deploys →
  the most recent deploy of branch `security/release-2-stage-0`
  (`6ab53d545ba8250008cd98c1` or later) → open it → **Retry → "Clear cache
  and retry with latest branch commit"**. The branch tip is `513b622`,
  unchanged since 2026-09-24. If that option is not offered:
  - Site configuration → Build & deploy → Build hooks → **Add build hook**
    for branch `security/release-2-stage-0`;
  - Ryan triggers it himself with
    `curl.exe -s -X POST -d "{}" "<hook URL>"` (the hook URL stays out of
    chat);
  - delete the hook at F.2.

  **Never a push to that branch**: a push also rebuilds PR #48's preview on
  the production site, a new production-site deploy. Report the new branch
  deploy's id.
- CLAUDE: CTX(branch URL) shows context `branch-deploy`, commit `513b622`,
  and 3.4's `deployId`. ROW-R(branch URL) → **refused**
  `500 Store lookup failed: <message>`. Record the message: **the
  invalid-key control message**.
- RYAN: CLEANUP(`security-release-2-stage-0--printcalculator2-staging.netlify.app`)
  → `HTTP 500 | dryRun= | error=<message>`. Record it: **C3.2 control
  half**.
- RYAN: Netlify → `SUPABASE_SERVICE_ROLE_KEY` → remove the branch value →
  Save. `D_ctl` keeps the generated value, which grants nothing.
- CLAUDE: ROW-R(`D_new`) → still **accepted**.

---

## 4. Baseline BEFORE any revocation (the C5.6 analog)

CLAUDE runs ROW-R on each of `D_old`, `D_tmpS`, `D_tmpL` (if built) and
`D_new` → all **accepted**, then READBACK (`r2_probe_rows = 0`). Without
this baseline, a later refusal cannot be attributed to the revocation.

---

## 5. Revocation kind 1 — a DELETED secret key

- RYAN: Supabase → API Keys → `c3-temp` → **Delete** → confirm. Report the
  time.
- CLAUDE:
  - ROW-R(`D_tmpS`) → **refused**. Record the exact message: **kind 1, a
    deleted secret key**;
  - ROW-R(`D_new`) → **accepted**, which proves the revocation missed the
    new key;
  - ROW-R(`D_old`) → recorded. It is expected accepted, because `c3-temp`
    did not exist when `D_old` was built.

---

## 6. Revocation kind 2 — DISABLED legacy JWT keys (after C8)

Precondition: C8 passed (1.2), or 1.8 fixed it and `D_new` was built after
the fix.

**6.1 RYAN — hold an owner token before disabling.** C3.4 needs a live owner
token. If the staging client bundle uses the legacy anon key (1.2's Builds
prefix), the staging app cannot sign in or refresh once legacy keys are
disabled.
- Open `https://printcalculator2-staging.netlify.app` and sign in to admin as
  `owner-t1@example.invalid`.
- In that tab's browser console, run the line below. It keeps the token in
  the page and shows nothing:
  `window.__c3t = JSON.parse(localStorage.getItem('printcalc_auth_v1')).access_token; 'held'`
- The access token lives about an hour, so 6.2 and 6.3 run promptly.

**6.2 RYAN — disable.** Supabase → API Keys → **Legacy API Keys** →
**Disable JWT-based API keys** → confirm. Report the time.

**6.3 CLAUDE.**
- ROW-R on the legacy-captured deploy (`D_old` if T = legacy, `D_tmpL` if
  T = unknown) → **refused**. Record the exact message: **kind 2, disabled
  legacy JWT keys**.
- ROW-R(`D_new`) → **accepted**.
- If T = unknown: ROW-R(`D_old`) is recorded. If it flipped here, the old
  key was the legacy JWT.

**6.4 RYAN — C3.4, owner auth with legacy keys disabled.** In the same
console tab:

```js
[await fetch('https://lboajqihpsfrokqvjgnl.supabase.co/auth/v1/user', { headers: { apikey: 'sb_publishable_DEDmndmu9xmhNFeXTCbO6A_HE0EBkZ6', authorization: 'Bearer ' + window.__c3t } }).then(r => r.status),
 await fetch('/.netlify/functions/enroll-list', { headers: { authorization: 'Bearer ' + window.__c3t } }).then(r => r.status)]
```

Report only the two numbers. The publishable key is public (it is in
`docs/security/staging.md`).
- **Expected: `[200, 200]`.** The token is live, and `enroll-list` on
  `D_new` validated it with the Functions `sb_publishable_` key. That is
  **C3.4**.
- `[200, 401]`: owner auth is broken with legacy keys disabled. **STOP**:
  this is a C8 failure, not a retry.
- First number ≠ 200: the token is not live, so the test is inconclusive.
  **STOP** and record; do not retry in place.
- Afterwards: `delete window.__c3t`.

**6.5 (T = unknown only) — bind `D_old`.**
- RYAN deletes every secret key that existed before C3 (1.1's list, once
  1.4 is resolved). Report the names and times.
- CLAUDE: ROW-R(`D_old`) → recorded. If it flips here, the old key was one
  of those secret keys. Either way, the flip binds C4's type after the fact.

---

## 7. C3.5 — does re-enabling legacy keys restore the SAME keys?

While the legacy keys are enabled, every staging deploy that captured the
legacy JWT works again. This lasts minutes, on staging only.

- RYAN: Supabase → API Keys → Legacy API Keys → **re-enable** → confirm.
  Report the time.
- CLAUDE:
  - ROW-R on the legacy-captured deploy. **Accepted** means the same keys
    returned; **refused** means re-enabling issued different keys. Record the
    answer: that is **C3.5**, which decides how dangerous C9's break-glass
    is.
  - ROW-R(`D_new`) → **accepted**.
- RYAN: **Disable JWT-based API keys** again → confirm. Report the time.
- CLAUDE: ROW-R on the legacy-captured deploy → **refused**, with 6.3's
  message.

---

## 8. C3.6 — what the provider logs record about the key

CLAUDE runs `query_logs` over the window from section 4 to section 7, using
the recorded probe times:
- `project_id` `lboajqihpsfrokqvjgnl`;
- ClickHouse, read-only;
- **ad-hoc (not pinned)**: these queries read logs, never the database.

**Q1 — attribute NAMES only, no values:**

```sql
select arrayJoin(mapKeys(log_attributes)) as k, count() as n
from logs where source = 'edge_logs' group by k order by k
```

**Q2 — the probe requests.** The `stores` lookups the probes caused, found
by path and time. Q2's columns are fixed from Q1's names under one rule:
**any attribute whose name mentions `apikey`, `authorization`, `key`,
`token`, `jwt`, `secret` or `cookie` is selected ONLY as `length(v)` and
`substring(v, 1, 10)`**. Ten characters are exactly a type prefix
(`sb_secret_`, `sb_publis…`, `eyJhbGciOi`). Every other attribute may be
selected by value. **No raw credential value is ever selected**, so none can
enter the session.

**Record, per probe:**
- the status;
- which fields, if any, identify WHICH key made the request (a key name,
  id, hash or prefix) or only its type;
- or that nothing does.

That is **C3.6**, and it is what C6's provider-side column may rely on in
production.

---

## 9. C3.7 — the transport accepts P1's size (SIZE-PROBE through the sender)

It is independent of sections 1–8 and may run at any point in the session.
Running it first surfaces a transport problem before any dashboard work.

**9.1 CLAUDE — the dry run, before Ryan holds a token.** Claude runs
`node scripts/manual/stage0-send.mjs SIZE-PROBE --target staging --dry-run`.
Expected:
- `target staging = lboajqihpsfrokqvjgnl; read_only true`;
- `request md5 <outputs["SIZE-PROBE"].md5>; <outputs["SIZE-PROBE"].bytes> bytes`.

At the reviewed commit, that is `64836acd787dc72bb0ad3e6564a66db4`, 241 149
bytes.

**9.2 RYAN — create the token.** Open
`https://supabase.com/dashboard/account/tokens` → **Generate new token** →
name `stage0-c3-<date>`, with the shortest expiry offered. Copy it straight
into the `Read-Host` prompt from section 0. Never paste it anywhere else.

**9.3 RYAN — send.** Run section 0's commands in order:
- the prefix check must print `True`;
- the dry run's md5 and bytes must equal 9.1's;
- then the live send;
- then `Remove-Item Env:SUPABASE_ACCESS_TOKEN`.

Report the summary lines and the results file name.

**9.4 CLAUDE — read the results file.**
- `requestMd5` and `requestBytes` equal the manifest's `outputs["SIZE-PROBE"]`.
- `ref` is `lboajqihpsfrokqvjgnl`.
- `httpStatus` is `201`.
- `body` parses to one row, whose `probe_bytes` and `probe_md5` equal the
  manifest's `sizeProbe.expect` (240 951, `79c453d9ccdc3a1b14eb34619ffe2cea`
  at the reviewed commit).

Also recorded: the timings, and the observation that the probe arrived with
the bytes intact. Any other status, a different answer, a truncation or a
transport error **stops the C3.7 record**; P1 is not sent until it is
understood (plan §C3.7).

**9.5 RYAN — delete the token.** Open the Access Tokens page → the
`stage0-c3-<date>` token → **Delete**. Report the time. It is deleted whatever
9.3's outcome was.

---

## F. Final staging state, and a read-back of all of it

**F.1 RYAN — Supabase.**
- Secret keys: delete every secret key except `release2-stage0-c3`.
  `c3-temp` is already gone; the pre-existing keys come from 1.1, and are
  deleted only after 1.4 is resolved.
- Legacy keys: **disabled** (6.2, re-disabled in 7).

**F.2 RYAN — Netlify.**
- `SUPABASE_SERVICE_ROLE_KEY`:
  - Production value = `release2-stage0-c3` (unchanged since 3.3);
  - no branch value (removed in 3.4);
  - any other context value from 1.2 that held an old key is either set to
    `release2-stage0-c3` or removed. Say which.
- `CLEANUP_SECRET`: remove exactly what 2.1 added.
- The build hook, if one was created in 3.4: delete it.
- `VITE_SUPABASE_ANON_KEY`: unchanged, or 1.8's publishable value.

**F.3 RYAN — capture the final environment.** Deploys → **Clear cache and
deploy site** → `D_final`. Report the id.

**F.4 CLAUDE — read-back probes.**
- CTX(`D_final`), and the plain URL shows the same id.
- ROW-R(`D_final`) → **accepted**.
- ROW-R on `D_old`, `D_tmpS`, `D_tmpL` (if built) and `D_ctl` → **refused**,
  each with its recorded message.
- `cleanup-stale-jobs` with **no** `x-cleanup-key`: `curl -s -w '\nHTTP %{http_code}\n' -X POST https://printcalculator2-staging.netlify.app/.netlify/functions/cleanup-stale-jobs`.
  Expect **`503`** if 2.1 created the secret and F.2 removed it; **`401`** if
  staging had its own `CLEANUP_SECRET` before C3. Either way, nothing is
  deleted.
- READBACK: `r2_probe_rows = 0`, `probe_slug_rows = 0`, and
  `pending_jobs_total` equal to 1.5's. Staging has no customer traffic, and
  the scheduled cleanup cannot authenticate. A difference is recorded and
  explained, never ignored.

**F.5 RYAN — dashboard read-back.**
- Supabase API Keys: the key list (names, types, created times) shows only
  the publishable key(s) and `release2-stage0-c3`.
- Legacy API Keys: disabled.
- Netlify environment variables: `SUPABASE_SERVICE_ROLE_KEY` contexts and
  last-updated time; no branch value; `CLEANUP_SECRET` as it was before C3.
- Supabase Access Tokens: no `stage0-c3-…` token remains (deleted in 9.5).

**F.6 CLAUDE.** Record everything in plan §E9, then commit and push. The
push to `security/release-2-slice-2` rebuilds staging's published deploy
with the final environment, which is expected. Its id is added to the
record once it is published.

---

## Record template (plan §E9)

| C3 item | evidence | result |
|---|---|---|
| 1a invalid-key control | ROW-R on `D_ctl` (branch, `513b622`), generated value md5/len | `500 Store lookup failed: …` |
| 1b kind 1: deleted secret key | ROW-R on `D_tmpS` after 5 | `500 Store lookup failed: …` |
| 1b kind 2: disabled legacy JWT keys | ROW-R on the legacy-captured deploy after 6.2 | `500 Store lookup failed: …` |
| 2 cleanup read | CLEANUP on `D_new` / `D_ctl` | `200 dryRun:true` / `500 …` |
| 3 supabase-js takes `sb_secret_` | ROW-R on `D_new` | `400 Unknown store: …` |
| 4 owner auth, legacy disabled | 6.4 | `[200, 200]` |
| 5 re-enable restores the same keys? | 7 | yes / no |
| 6 provider-side record | 8 | fields, and whether any identifies the key |
| 7 SIZE-PROBE | 9, through the sender: the results file (request md5/bytes, ref, status, answer) | `201`, the answer equal to `sizeProbe.expect` |

Also recorded:
- 1.1–1.4 (inventory, variable metadata, `D_old`, holders);
- 1.7 (T);
- every deploy id and commit;
- every probe's UTC time;
- the R2-PROBE read-backs;
- section F.

---

## Why C3.7 uses the sender

Drafting this runbook showed that C3.7 could not be run as first written.
`execute_sql` takes its query as an argument the session must generate, and
cannot read a file. The SIZE-PROBE is 241 149 bytes: a 51-byte line repeated
about 4 724½ times, cut at an exact byte. That cannot be regenerated byte for
byte, and a miscount would fail C3.7 on transcription rather than transport.
P1 (240 KB) and the 10–36 KB production texts have the same problem.

Codex chose option A: the pinned sender, `scripts/manual/stage0-send.mjs`,
which posts the exact assembled bytes to the endpoint `execute_sql` itself
uses. Plan §E1 "The transport" has:
- the endpoint confirmation (`@supabase/mcp-server-supabase` 0.13.0);
- the checks the sender makes, and the send policy;
- the token handling;
- the tests.
