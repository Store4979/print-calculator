# Release 2 — server-verifiable identity and grant closure

**Status: PLAN ONLY. Nothing in this document has been applied.** No migration
has been run, no policy changed, no grant revoked. Baseline: `10235f2` (main,
Release 1 merged) and project `gmxyisjjaxtpycsmmzef`.

Architecture is settled by the two review documents and is not re-litigated
here. This plan works out the schema, contract, order and tests for it.

---

# Part 0 — Evidence, to the full standard

Every policy below reports **permissive mode, command, roles, USING and WITH
CHECK separately**. For INSERT policies `USING` is `(null)` *by definition* —
Postgres does not evaluate a USING clause on INSERT — so **WITH CHECK is the
only gate** and is printed on its own. Nothing here is inferred from `qual`.

## 0.1 Policies reachable by `anon`

| table | policy | mode | cmd | roles | USING | WITH CHECK | effect |
|---|---|---|---|---|---|---|---|
| `public.orders` | `anon_rw_orders` | PERMISSIVE | ALL | `{anon,authenticated}` | `true` | `true` | **full read/write/delete, unrestricted** |
| `public.pending_jobs` | `anon_select_pending_jobs` | PERMISSIVE | SELECT | `{anon,authenticated}` | `true` | `(null)` | **read all, unrestricted** |
| `public.print_jobs` | `anon_can_select_print_jobs` | PERMISSIVE | SELECT | `{anon,authenticated}` | `true` | `(null)` | **read all, unrestricted** |
| `public.print_jobs` | `anon_can_insert_print_jobs` | PERMISSIVE | INSERT | `{anon,authenticated}` | `(null)` — N/A for INSERT | **`true`** | **insert anything, unrestricted** |
| `public.stores` | `stores_read` | PERMISSIVE | SELECT | `{anon,authenticated}` | `true` | `(null)` | read all incl. `bootstrap_secret_hash` |
| `public.settings` | `settings_read` | PERMISSIVE | SELECT | `{anon,authenticated}` | `true` | `(null)` | read all |
| `public.sheet_prices` | `sheet_prices_read` | PERMISSIVE | SELECT | `{anon,authenticated}` | `true` | `(null)` | read all incl. cost columns |
| `public.paper_types` | `paper_types_read` | PERMISSIVE | SELECT | `{anon,authenticated}` | `true` | `(null)` | read all |
| `public.discounts` | `discounts_read` | PERMISSIVE | SELECT | `{anon,authenticated}` | `true` | `(null)` | read all |
| `public.addons` | `addons_read` | PERMISSIVE | SELECT | `{anon,authenticated}` | `true` | `(null)` | read all |
| `public.outsourced_products` | `outsourced_products_read` | PERMISSIVE | SELECT | `{anon,authenticated}` | `true` | `(null)` | read all |
| `storage.objects` | `job_files_anon_select` | PERMISSIVE | SELECT | `{anon,authenticated}` | `bucket_id = 'job-files'` | `(null)` | list/read the bucket |
| `storage.objects` | `job_files_anon_insert` | PERMISSIVE | INSERT | `{anon,authenticated}` | `(null)` — N/A | `bucket_id = 'job-files'` | write into the bucket |
| `storage.objects` | `job_files_anon_delete` | PERMISSIVE | DELETE | `{anon,authenticated}` | `bucket_id = 'job-files'` | `(null)` | delete from the bucket |

Every policy in the project is **PERMISSIVE**; there is not one RESTRICTIVE
policy anywhere. That matters: permissive policies are OR-ed, so adding a
narrow policy beside `anon_rw_orders` widens nothing — the old one must be
**dropped**, not out-voted.

## 0.2 Policies reachable only by `authenticated` (owner/manager)

`addons`, `discounts`, `employees`, `memberships`, `outsourced_products`,
`paper_types`, `settings`, `sheet_prices`, `stores` all follow the same shape:
SELECT open, and INSERT/UPDATE/DELETE gated on
`has_store_role(store_id, ARRAY['owner','manager'])` — with INSERT gated by
**WITH CHECK** and UPDATE gated by **both** USING and WITH CHECK.
`memberships` is owner-only. `organizations` is membership-scoped.
`employees` SELECT is **not** open to anon (the 03b lockdown) — its USING is
`has_store_role(...)`.

## 0.3 RLS state, every public table

All 14 tables: `rls=true`, `forced=false`. `forced=false` means the table
owner bypasses RLS — relevant only for `postgres`/`service_role`, which is how
the Netlify functions already work, and is the mechanism Release 2 depends on.

`_archive_commission_columns`: RLS on, **0 policies** → deny-all to non-owner.
Correct as-is.

## 0.4 Table-level grants — the layer RLS does not cover

**`anon` and `authenticated` both hold `SELECT, INSERT, UPDATE, DELETE,
TRUNCATE, REFERENCES, TRIGGER` on all 14 public tables**, and the same set on
`storage.objects` and `storage.buckets`.

**`TRUNCATE` is not filtered by RLS.** Proven in a rolled-back transaction as
`anon`:

| probe | result |
|---|---|
| `UPDATE employees SET pin='0000'` | blocked by RLS (0 rows) — 03b holds |
| `TRUNCATE employees` | **SUCCEEDED, 2 → 0** |
| `TRUNCATE orders` | **SUCCEEDED, 3 → 0** |
| `TRUNCATE storage.objects` | **SUCCEEDED, 5 → 0** |

**Reachability is NOT established.** PostgREST exposes no TRUNCATE verb, so
this needs a direct Postgres connection, which needs database credentials the
publishable key does not provide. Latent privilege that should not exist —
not a demonstrated remote exploit. Revoking costs nothing: nothing in the app
uses TRUNCATE, REFERENCES or TRIGGER.

## 0.5 Storage

| bucket | public | size limit | mime allowlist | objects |
|---|---|---|---|---|
| `customer-uploads` | false | **none** | **any** | 0 |
| `job-files` | false | 50 MB | png/jpeg/gif/webp/pdf | 5 |

**`storage.buckets` has RLS on with zero policies.** Probed as `anon`:
`SELECT` returns **0 buckets**, and `UPDATE ... SET public = true` on
`customer-uploads` changed **no rows**. So despite holding the grant, anon
**cannot** flip a private bucket public. That was the worst case available
here and it is closed.

**`storage.objects` DELETE via SQL is blocked by Supabase's own trigger**
(`42501 Direct deletion from storage tables is not allowed`) — *not* by the
policy. The `job_files_anon_delete` policy is still live for deletes through
the **Storage HTTP API**, which is the path that matters.

## 0.6 Functions and Realtime

| function | secdef | search_path | ACL |
|---|---|---|---|
| `verify_employee_pin(uuid,text)` | **true** | pinned `public` | postgres, service_role, **anon**, **authenticated** |
| `has_store_role(uuid,text[])` | true | pinned `public` | postgres, authenticated, service_role |
| `employees_role_owner_only()` | false | pinned `public` | postgres, service_role |
| `set_updated_at()` | false | pinned `public` | postgres, service_role |

`supabase_realtime` publishes **`public.pending_jobs`**. Realtime enforces
RLS, so `anon_select_pending_jobs` being `USING true` means an unauthenticated
subscriber receives every queue row — including `files[].path` — **as it is
written**. Closing the REST read without closing Realtime closes nothing.

---

# Part 1 — Staging, the prerequisite

Netlify previews currently run against production Supabase. Release 2 changes
authentication and then removes grants; rehearsing that against live data is
not acceptable.

## 1.1 What "isolated" has to mean here

| axis | requirement | why |
|---|---|---|
| Database | separate project | grant/policy changes are the thing under test |
| Storage | separate buckets | the test seeds and deletes customer-file objects |
| Auth | separate user pool | enrollment issues real sessions; Site URL differs |
| Mail | **sink, never a real relay** | `send-print-job` must be exercised without mailing the store |

## 1.2 Options and cost (retrieved from the live org `dofrogiqvxgmmzprinqe`)

| option | cost | separate DB | storage | auth | notes |
|---|---|---|---|---|---|
| **Second Supabase project** | **$10/month** | yes | yes | yes | persistent, own Site URL, own SMTP settings |
| Supabase branch | $0.01344/hour ≈ $9.80/month if always on | yes | yes | yes | tied to a git branch, designed to be ephemeral |

**Recommendation: a second project**, `print-calculator-staging`. Release 2 is
not a one-branch experiment — it needs a stable place to re-run the two-tenant
matrix, and a branch that disappears takes the second tenant with it.

## 1.3 Standing it up

1. Create the project. Record its ref, URL and publishable key.
2. Apply **every** migration from `supabase/migrations/` in ledger order, then
   run `scripts/migration-md5.sh` against the staging ledger. Staging must be
   byte-identical to production's schema before anything new is tested.
3. Create both buckets with production's settings, plus the **size limit and
   MIME allowlist `customer-uploads` currently lacks** — staging is where that
   gets proven before production gets it.
4. **Seed two tenants.** `store4979` plus a throwaway second store with its
   own org, employees, orders, pending jobs and job files. The two-tenant
   matrix is untestable on a single-tenant database, and this is the first
   time a second tenant has existed anywhere.
5. Auth: Site URL = the staging Netlify site; add its deploy-preview pattern.
   Create an owner and a manager account.
6. **Mail sink.** Point staging `SMTP_*` at a capture service (Mailpit or an
   Ethereal account). A real relay in staging will eventually mail a customer.
7. Second Netlify site on the same repo, env vars pointing at staging, deploy
   previews attached to **it** rather than production.
8. Add `docs/security/staging.md` recording refs, keys location and the reseed
   procedure. Nothing secret in the repo.

**Gate: no Release 2 migration is applied to production until the whole
sequence below has run green on staging, twice — once forward, once through
the rollback.**

---

# Part 2 — Schema

All additive. Names are proposals.

## 2.1 Device enrollment

```sql
-- A browser that an owner has paired to a store. Long-lived, revocable.
create table public.device_enrollments (
  id              uuid primary key default gen_random_uuid(),
  store_id        uuid not null references public.stores(id) on delete cascade,
  org_id          uuid not null references public.organizations(id) on delete cascade,
  label           text not null,                     -- "Front counter iPad"
  device_token_hash bytea not null unique,           -- sha256(token); token never stored
  created_by      uuid not null references auth.users(id),
  created_at      timestamptz not null default now(),
  last_seen_at    timestamptz,
  revoked_at      timestamptz,
  revoked_by      uuid references auth.users(id),
  revoked_reason  text
);
create index on public.device_enrollments (store_id) where revoked_at is null;
```

The **store is derived from this row**, never from a `storeSlug` in a request
body. That is the rule the whole design turns on.

## 2.2 Pairing tickets — single use

```sql
create table public.enrollment_tickets (
  id            uuid primary key default gen_random_uuid(),
  store_id      uuid not null references public.stores(id) on delete cascade,
  ticket_hash   bytea not null unique,               -- sha256(ticket)
  created_by    uuid not null references auth.users(id),
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,                -- created_at + 15 min
  redeemed_at   timestamptz,
  redeemed_into uuid references public.device_enrollments(id),
  revoked_at    timestamptz
);
```

Single use is enforced **in the database**, not in the handler:

```sql
update public.enrollment_tickets
   set redeemed_at = now(), redeemed_into = $2
 where ticket_hash = $1
   and redeemed_at is null
   and revoked_at is null
   and expires_at > now()
returning id;
```

Zero rows returned = replay, expiry or revocation. One statement, no
read-then-write window. The replay test targets exactly this.

## 2.3 Staff sessions — opaque, server-owned

```sql
create table public.staff_sessions (
  id             uuid primary key default gen_random_uuid(),
  enrollment_id  uuid not null references public.device_enrollments(id) on delete cascade,
  store_id       uuid not null references public.stores(id) on delete cascade,
  employee_id    uuid not null references public.employees(id) on delete cascade,
  employee_role  text not null check (employee_role in ('staff','manager')),
  token_hash     bytea not null unique,              -- sha256(token); token never stored
  created_at     timestamptz not null default now(),
  last_used_at   timestamptz not null default now(),
  absolute_expires_at timestamptz not null,          -- created_at + 12h
  idle_expires_at     timestamptz not null,          -- last_used_at + 60m, rolling
  revoked_at     timestamptz,
  revoked_reason text
);
create index on public.staff_sessions (enrollment_id) where revoked_at is null;
```

`employee_role` is **copied at issue time**. A later role change does not
retroactively widen a live session; it takes effect at next sign-in. That is
deliberate and is what the role-tampering test asserts.

## 2.4 Upload capabilities — the customer path

```sql
create table public.upload_capabilities (
  id           uuid primary key default gen_random_uuid(),
  store_id     uuid not null references public.stores(id) on delete cascade,
  token_hash   bytea not null unique,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,                 -- created_at + 30 min
  max_files    int  not null default 10,
  max_bytes    bigint not null default 52428800,
  used_files   int  not null default 0,
  used_bytes   bigint not null default 0,
  consumed_at  timestamptz,                          -- set when register-job succeeds
  revoked_at   timestamptz
);

-- Server-recorded file ownership. register-job may ONLY accept paths listed here.
create table public.upload_capability_files (
  capability_id uuid not null references public.upload_capabilities(id) on delete cascade,
  path          text not null,
  size_bytes    bigint,
  mime          text,
  minted_at     timestamptz not null default now(),
  primary key (capability_id, path)
);
```

This is what "upload registration bound to server-recorded file ownership"
means concretely: `start-upload` writes the row it mints; `register-job`
accepts a path **only** if this table says the same capability minted it.

## 2.5 Grants — explicit, and the opposite of the current default

```sql
revoke all on public.device_enrollments,  public.enrollment_tickets,
              public.staff_sessions,      public.upload_capabilities,
              public.upload_capability_files
  from public, anon, authenticated;
grant select, insert, update, delete on
  public.device_enrollments, public.enrollment_tickets, public.staff_sessions,
  public.upload_capabilities, public.upload_capability_files
  to service_role;
alter table public.device_enrollments   enable row level security;
alter table public.enrollment_tickets   enable row level security;
alter table public.staff_sessions       enable row level security;
alter table public.upload_capabilities  enable row level security;
alter table public.upload_capability_files enable row level security;
```

RLS on with **zero policies** on all five — the `_archive_commission_columns`
pattern, which this project has already proven denies everything to non-owner
roles. `service_role` reaches them by owner bypass (`forced=false`).

Owners need to *see* their enrollments in the admin panel. That read goes
through a function endpoint, not a policy, so `authenticated` never holds a
grant on these tables.

**The whole point: no token is ever stored.** Every table holds
`sha256(token)`. A dump of these tables lets an attacker authenticate as
nobody.

---

# Part 3 — Endpoint contract

All under `/.netlify/functions/`. Every one uses `service_role` **after**
resolving identity. Every one derives `store_id` from the enrollment or
capability row, never from the body.

## 3.1 Identity resolution — one shared module

```
resolveStaff(req)   -> { enrollment, session, employee, store_id, role } | 401
resolveDevice(req)  -> { enrollment, store_id } | 401
resolveUpload(req)  -> { capability, store_id } | 401
resolveOwner(req)   -> { user, store_id, role } | 401     // Supabase Auth JWT + has_store_role
```

Three rules, each with a test:

1. **An upload capability is never accepted where staff or device auth is
   required.** Different header, different table, different resolver. The
   resolver returns the token *kind*; a handler asserts the kind it needs.
2. **A device token without a live staff session grants nothing** beyond
   `staff-login`. Enrollment proves *which store's counter*, not *who*.
3. **Role comes from the session row**, never from the request.

## 3.2 Endpoints

| endpoint | auth | does | store from |
|---|---|---|---|
| `enroll-ticket-create` | **owner** (Auth JWT) | mints a single-use ticket, returns it once | `has_store_role` on the owner's membership |
| `enroll-redeem` | ticket | redeems atomically, creates enrollment, returns device token once | the ticket row |
| `enroll-list` / `enroll-revoke` | **owner** | list/revoke devices | owner's membership |
| `staff-login` | device | verifies PIN server-side, rate-limited; creates session | enrollment row |
| `staff-logout` | staff | revokes this session | session row |
| `staff-session-revoke-all` | device | revokes every session on this enrollment (kiosk entry) | enrollment row |
| `queue-list` | staff | queue rows for this store, **file paths stripped** | session |
| `queue-download-url` | staff | signs a path **after** checking the job is this store's | session |
| `queue-complete` | staff | deletes files + row **after** the same check | session |
| `orders-save` | staff | inserts an order, stamps store/employee from session | session |
| `orders-list` | staff, margin fields only if `role='manager'` | order history | session |
| `jobs-save` / `jobs-list` | staff | legacy `print_jobs` | session |
| `job-file-upload-url` / `job-file-download-url` / `job-file-delete` | staff | the four `job-files` helpers, server-side | session |
| `send-print-job` | staff | recipient already server-resolved (Release 1) | session |
| `upload-capability-create` | **public** | mints a constrained capability | `STORE_SLUG` env / QR param validated against `stores` |
| `start-upload` | upload capability | mints one signed upload URL, **records the path** | capability |
| `register-job` | upload capability | queue row from **recorded** paths only | capability |
| `fetch-link-job` | upload capability | Google import, same allocation path as register-job | capability |

`queue-list` stripping file paths is deliberate. Staff do not need the path;
they need a job id and a filename. Paths only exist inside
`queue-download-url`, which checks ownership before signing. That removes the
harvest step from the confirmed exploit chain rather than only gating the
signing step.

---

# Part 4 — Permission matrix

Rows are what a caller *has*. Columns are what they can reach. **No** means
the server returns 401/403 and touches nothing.

| capability → | queue list | download | complete | order save | order margin | job history | job files | email | enroll mgmt | pricing write |
|---|---|---|---|---|---|---|---|---|---|---|
| nothing (anon) | No | No | No | No | No | No | No | No | No | No |
| upload capability | No | No | No | No | No | No | No | No | No | No |
| device token only | No | No | No | No | No | No | No | No | No | No |
| staff session, `staff` | **Yes** | **Yes** | **Yes** | **Yes** | **No** | **Yes** | **Yes** | **Yes** | No | No |
| staff session, `manager` | Yes | Yes | Yes | Yes | **Yes** | Yes | Yes | Yes | **No** | **No** |
| Auth `manager` | via staff session | " | " | " | Yes | " | " | " | **No** | **Yes** |
| Auth `owner` | via staff session | " | " | " | Yes | " | " | " | **Yes** | Yes |

Two lines matter most:

- **PIN `manager` grants counter permissions only** — margin visibility. It
  never grants enrollment, membership or billing. A manager PIN is a counter
  credential, not an ownership credential.
- **Upload capability and device token are each, alone, worth nothing.** Every
  staff column needs a live session.

Cross-store is a separate axis and always **No**: every row is filtered by the
`store_id` on the resolved session, and a mismatched id in a request body is
ignored, not honoured.

---

# Part 5 — Expiry and revocation

| credential | absolute | idle | single use | revoked by |
|---|---|---|---|---|
| enrollment ticket | 15 min | — | **yes, in SQL** | owner, or redemption |
| device token | none | none | no | owner via `enroll-revoke` |
| staff session | **12 h** | **60 min rolling** | no | staff logout, kiosk entry, device revoke, owner |
| upload capability | 30 min | — | consumed on `register-job` | expiry or quota |

Cascades, all server-side:

- Revoking a **device** revokes every session on it. A revoked device cannot
  create new sessions, so a counter iPad that walks out is one click.
- Revoking an **employee** (`active=false`) revokes their live sessions.
- **Kiosk entry calls `staff-session-revoke-all` for the enrollment.** Since
  sessions are server-side, this kills them in *every tab of that browser*,
  not just the one that flipped the flag. Removing `?mode=kiosk` restores no
  authority, because the tokens are gone from the server — re-entry requires a
  PIN. That is the property the "kiosk across tabs" test proves.
- Every resolver checks `revoked_at is null AND absolute_expires_at > now()
  AND idle_expires_at > now()` **in the same statement** that bumps
  `last_used_at`. No read-then-decide window.

---

# Part 6 — Every direct client data path that must move

Grants cannot close until **all** of these run server-side. This is the
checklist that gates Part 7 step 5.

| # | client path | file:line | reaches | replaced by |
|---|---|---|---|---|
| 1 | `fetchOrders` | `src/lib/supabase.js` | `orders` SELECT | `orders-list` |
| 2 | `insertOrder` | `src/lib/supabase.js` | `orders` INSERT | `orders-save` |
| 3 | offline queue drain | `src/lib/orderQueue.js` | `orders` INSERT | `orders-save` (same whitelist) |
| 4 | `PrintQueue` initial fetch | `src/components/PrintQueue.jsx:61` | `pending_jobs` SELECT | `queue-list` |
| 5 | **`PrintQueue` Realtime subscribe** | `src/components/PrintQueue.jsx:69-87` | `pending_jobs` Realtime | poll `queue-list`, or Realtime **after** the policy is scoped |
| 6 | queue badge count | App.jsx | `pending_jobs` SELECT | `queue-list` |
| 7 | `get-download-url` caller | `PrintQueue.jsx:111,129` | function (unauth) | `queue-download-url` + staff header |
| 8 | `complete-job` caller | `PrintQueue.jsx:148` | function (unauth) | `queue-complete` + staff header |
| 9 | `fetchPrintJobs` | `src/lib/supabase.js` | `print_jobs` SELECT | `jobs-list` |
| 10 | print-job insert | App.jsx save path | `print_jobs` INSERT | `jobs-save` |
| 11 | **`uploadJobFiles`** | `src/lib/supabase.js:113` ← `App.jsx:2675` | `job-files` INSERT | `job-file-upload-url` |
| 12 | **`downloadJobFile`** | `src/lib/supabase.js:186` ← `App.jsx:2724`, `JobHistory.jsx:298` | `job-files` SELECT | `job-file-download-url` |
| 13 | **`getJobFileSignedUrl`** | `src/lib/supabase.js:198` ← `JobHistory.jsx:287` | `job-files` SELECT | `job-file-download-url` |
| 14 | **`deleteJobFiles`** | `src/lib/supabase.js:213` — **no caller today** | `job-files` DELETE | `job-file-delete`, **or delete the export** |
| 15 | `findEmployeeByPin` | `src/lib/supabase.js:357` | `verify_employee_pin` RPC | `staff-login` |
| 16 | `sendOrderEmail` | `App.jsx` | `send-print-job` | same + staff header |
| 17 | `start-upload` / `register-job` / `fetch-link-job` callers | `UploadApp.jsx:192,203,180` | functions (unauth) | same + capability header |

**All four `job-files` helpers move — 11, 12, 13 and 14.** Number 14 has no
caller today. That is not a reason to skip it: it is an exported function
holding a direct anon-key DELETE, and leaving it is how a hole re-opens six
months after the policies close. It moves or it is deleted; either is fine,
silence is not.

Paths that **stay** on the anon key, by design: the price book
(`paper_types`, `sheet_prices`, `discounts`, `addons`, `outsourced_products`,
`settings`) and the store profile. These are public config the kiosk and the
upload page need before any identity exists. `stores` needs its
`bootstrap_secret_hash` removed from the anon-visible surface — a view or a
column-scoped policy — which is in Part 7 step 5.

---

# Part 7 — Order of operations

The Aug-31 lesson drives this: **nothing is revoked until its replacement is
deployed and confirmed in production.**

### Step 1 — Staging (Part 1). Nothing else starts until this is green.

### Step 2 — Additive migrations only
Five tables, their grants, RLS-on-zero-policies. Every `CREATE FUNCTION`
follows CLAUDE.md rule 4: `revoke ... from public, anon, authenticated,
service_role`, then explicit grants, with `proacl` diffed before/after in a
rolled-back rehearsal. **Nothing existing is touched.** Fully reversible by
dropping five tables nothing references yet.

### Step 3 — Deploy the endpoints, dark
All endpoints live; **no client calls them**. Exercise them on staging with
the Part 8 matrix. Production is untouched and unaware.

### Step 4 — Deploy the client, dual-path
Client moves onto the endpoints. One release, all 17 paths, because a partial
move means a partial grant closure, which is no closure.

**Confirm in production before anything tightens:**
- an owner enrolls the counter iPad and both kiosk devices
- staff sign in by PIN on each; a manager sees margin, staff does not
- a real order saves; the offline queue drains
- a real customer upload appears in the queue, is downloaded, is completed
- Job History downloads a file; a job saves with attachments
- a quote emails to the store
- kiosk entry and exit

### Step 5 — Tighten, one object at a time, each with its own rollback file
1. `orders`: drop `anon_rw_orders`. No replacement policy — **function-only**.
2. `pending_jobs`: drop `anon_select_pending_jobs`. **Remove it from the
   `supabase_realtime` publication**, or the subscription channel stays open.
3. `print_jobs`: drop both anon policies.
4. `storage.objects`: drop all three `job_files_anon_*`.
5. `stores`: replace `stores_read` with a view or column-scoped policy that
   excludes `bootstrap_secret_hash`.
6. `verify_employee_pin`: revoke EXECUTE from `anon` and `authenticated`
   (**Phase S1 lands here** — its rollback file already exists).
7. `revoke truncate, references, trigger on all tables in schema public from
   anon, authenticated` — and the same on `storage.objects`.
8. `customer-uploads`: set a size limit and a MIME allowlist.

**Check all roles, not just anon.** Every probe runs as `anon` *and* as
`authenticated`, because `{anon,authenticated}` appears on every one of these
policies and a signed-in owner's browser sends `authenticated`.

### Step 6 — Verify denial
Direct REST, direct Storage API, **and Realtime subscribe** all denied, as
both roles, on staging and then production. Then purge prior sensitive caches:
bump the sw.js generation again as part of this release, since the client
changes anyway.

### Rollback
Each step 5 item has a `.rollback.sql` restoring the exact prior policy,
captured verbatim beforehand. Steps 2–4 roll back by redeploying the previous
client — the additive tables can stay; they harm nothing. **The ordering
constraint in reverse: restore the policy first, then roll back the client.**
Rolling back the client while the grants are closed leaves the counter unable
to work.

---

# Part 8 — Test matrix

Adversarial fixtures, not a happy-path generator. A generator produces the
requests the client makes; every row below is a request the client would never
make, which is the point.

Two tenants throughout: **T1** = store4979, **T2** = the throwaway. Every
cross-tenant row asserts a 403/404 **and** that nothing was read or written.

| # | case | fixture | expected |
|---|---|---|---|
| 1 | **ticket replay** | redeem the same ticket twice, concurrently | exactly one enrollment; second returns 409; `redeemed_at` set once |
| 2 | ticket expiry | redeem at +16 min | 401, no enrollment |
| 3 | ticket from another store | T1 ticket, claim T2 | enrollment is T1's — ticket decides, body ignored |
| 4 | **anon PIN attempts** | `staff-login` with no device token | 401 before the PIN is even read |
| 5 | PIN brute force | 100 attempts on one enrollment | rate-limited; lockout recorded |
| 6 | PIN of a T2 employee on a T1 device | valid T2 PIN, T1 device | 401 — PIN is scoped by the enrollment's store |
| 7 | **device token without session** | device token on `queue-list`, `orders-save`, every staff endpoint | 401 on all |
| 8 | **upload capability as staff** | capability token on every staff endpoint | 401 — wrong token kind, not merely wrong scope |
| 9 | device token as upload capability | device token on `start-upload` | 401 |
| 10 | **wrong-store ids** | T1 session; body names a T2 job / order / path | 403, T2 row untouched, response leaks nothing about its existence |
| 11 | **role tampering** | staff session; `role: manager` in body/header | margin absent — role read from the session row only |
| 12 | role escalation after issue | promote employee to manager mid-session | live session still `staff`; next login is manager |
| 13 | PIN manager tries owner powers | manager session on `enroll-ticket-create`, `enroll-revoke`, membership write | 403 on all |
| 14 | **revocation, device** | revoke device, reuse a live session token | 401 immediately |
| 15 | revocation, session | logout, reuse token | 401 |
| 16 | revocation, employee | deactivate employee, reuse session | 401 |
| 17 | expiry, idle | session idle 61 min | 401 |
| 18 | expiry, absolute | session used every 30 min for 13 h | 401 at 12 h despite activity |
| 19 | **kiosk across tabs** | two tabs, same browser; enter kiosk in tab A; act as staff in tab B | tab B 401 — server-side revoke, not per-tab state |
| 20 | kiosk flag removal | remove `?mode=kiosk`, retry | still 401; PIN required |
| 21 | **cross-origin** | call every endpoint from another origin | CORS denies; and a forged `Origin` still fails auth |
| 22 | **cache persistence** | sign out, inspect Cache Storage and localStorage | no token, no customer data; sw generation bumped |
| 23 | token in a URL | session token as a query param | rejected — header only, and it would land in logs |
| 24 | **duplicate order retries** | same `orders-save` idempotency key twice, concurrently | exactly one row |
| 25 | offline drain after revoke | queue offline, revoke session, reconnect | rows stay queued, not silently dropped |
| 26 | upload quota | capability + 11 files / 51 MB | refused at the limit, partial upload not registered |
| 27 | **register-job path forgery** | register a path this capability never minted | 403 — `upload_capability_files` is the authority |
| 28 | register-job cross-capability | T2's minted path on T1's capability | 403 |
| 29 | **direct REST after closure** | `orders`, `pending_jobs`, `print_jobs` as **anon and authenticated** | 0 rows / denied, both roles |
| 30 | **direct Storage after closure** | list and download `job-files`, both roles | denied |
| 31 | **Realtime after closure** | subscribe to `pending_jobs`, both roles | no rows delivered |
| 32 | TRUNCATE after revoke | `TRUNCATE orders` as anon | permission denied |
| 33 | bootstrap hash | `select bootstrap_secret_hash from stores` as anon | column absent or denied |
| 34 | **successful counter flow** | enroll → PIN → quote → save → queue → download → complete | all succeed |
| 35 | **successful customer flow** | QR → capability → upload → register → appears in T1 queue only | succeeds; T2 never sees it |
| 36 | successful owner flow | Auth sign-in → enroll a device → revoke it → pricing publish | succeeds |

Rows 34–36 are not filler. A matrix that only proves denial will happily pass
with the app entirely broken.

---

# Part 9 — B2 stays on hold, and why

`supabase/migrations/pending/phase_b_b2_pending_jobs_queue_unique.sql` is
**not applied** and must not be until the two writers agree.

`register-job` (post-#37) allocates `max(queue_number)+1` per
`(store_id, job_date)`, stamps the tenant, and retries on `23505`.
`fetch-link-job` still uses **global `count(*)+1`**, stamps **no store**, has
**no retry**, and **uploads the file before inserting the row**.

Under B2's unique constraint that combination strands files: the upload
succeeds, the insert hits `23505`, nothing retries, and the object sits in the
bucket with no queue row and no owner — invisible to staff, and only
`cleanup-stale-jobs` eventually removes it.

**Order:** migrate both writers onto one tenant-aware allocation path — the
same helper, the same retry, insert-then-upload or a compensating delete — and
only then rehearse B2 against mixed upload/link/deletion concurrency plus the
legacy rows where `store_id` is null. `NULLS NOT DISTINCT` is already in the
pending file for those rows; it has never been exercised against real data.

---

# Part 10 — What this plan does not cover

- **S2 custom SMTP** is a Phase S item and independent of enrollment. Staging
  needs a mail sink regardless (Part 1), which is not the same work.
- **S3 password recovery** is independent and still open.
- **PDF.js 4.2.67+** remains a mitigation, not a fix.
- **Windows** is still untested anywhere; no runner exists in this
  environment.
- **A durable rate limiter** for `send-print-job`. The in-instance limiter
  from Release 1 should move to `staff_sessions`-adjacent storage once shared
  state exists — a Release 2 opportunity, not a requirement.
