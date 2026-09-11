# Release 2 — server-verifiable identity and grant closure

**Status: PLAN ONLY. Nothing in this document has been applied.** No migration
has been run, no policy changed, no grant revoked. Baseline: `10235f2` (main,
Release 1 merged) and project `gmxyisjjaxtpycsmmzef`.

Architecture is settled by the two review documents and is not re-litigated
here. This plan works out the schema, contract, order and tests for it.

> **Revision 2 — 2026-09-11.** Rewritten after a review of revision 1. The
> two-tenant staging requirement, the client-path inventory, the distinct
> identity types, the success-flow tests and the both-writers B2 gate are
> unchanged. What changed:
>
> 1. **A whole category was missing (new Part 0.7 and Part 7 step 4a).**
>    Revision 1 treated "move the client off an endpoint" as equivalent to
>    closing it. It is not. Netlify deploys **every file in
>    `netlify/functions/`** as a live URL, so `get-download-url` and
>    `complete-job` stay open to the internet no matter what the UI calls.
>    Verified below: **seven deployed functions, zero authentication between
>    them.**
> 2. Cost closure covers **every delivery path**, not `sheet_prices` — the
>    deployed `/pricing.json` and seven `localStorage` caches carry the same
>    numbers (Part 6.2).
> 3. Session transport is a **host-only `HttpOnly` cookie plus a CSRF token**,
>    not a bearer header (Part 3.1).
> 4. **Demotion revokes**, and **polling does not refresh idle** (Part 5).
> 5. **Ticket redemption and enrollment are one transaction**, and the abuse
>    limits are durable rather than per-instance (Parts 2.2, 2.6).
> 6. Four factual corrections: "column-scoped RLS" is not a mechanism;
>    Realtime does not bypass SELECT RLS; the Windows claim was stale; the
>    rollback is break-glass, not a secure fallback.

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

All 14 tables: `rls=true`, `forced=false`.

**Two different bypasses, which revision 1 ran together.** They are not the
same mechanism and the distinction decides what `forced=true` would break:

- **`service_role` bypasses RLS because the role has the `BYPASSRLS`
  attribute.** It is a property of the role, applies to every table, and is
  **not** affected by `FORCE ROW LEVEL SECURITY`. This is what the Netlify
  functions use and what Release 2 depends on.
- **`forced=false` is about the table's owner.** A table owner is exempt from
  its own RLS unless the table is set `FORCE`; that is the flag's only effect.

So `forced=false` here is about `postgres`-as-owner, not about `service_role`.
Setting `forced=true` would not change function behaviour at all — worth
knowing before anyone proposes it as a hardening step, and worth not claiming
as protection we have.

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

**What the `storage.objects` row counts do and do not prove.** The `5 → 0`
result is a count of **metadata rows**, inside a transaction that was rolled
back. It proves the metadata table is truncatable by `anon`; it does **not**
prove the underlying file bytes were deleted, and the rollback restored the
rows regardless. The real-world impact of truncating that table is that the
objects become **unreferenced** — invisible to the app and to the Storage API
— which is destructive in effect even if the bytes linger in the backing
store. Stated this way so nobody later reads "5 → 0, restored" as evidence
that a real truncation would be recoverable. **All destructive probes stay in
staging from here on**; this one ran in production inside `begin … rollback`
before staging existed, and that is not a precedent to repeat.

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

`supabase_realtime` publishes **`public.pending_jobs`**.

**Correction to revision 1.** Revision 1 said "closing the REST read without
closing Realtime closes nothing", which implied publication membership is its
own way past RLS. It is not. Supabase Realtime's `postgres_changes` evaluates
**the same SELECT policies** as REST, per subscriber. So dropping
`anon_select_pending_jobs` closes the REST read **and** the subscription in
one move; removing the table from the publication is **defence in depth and a
blast-radius reduction, not the gate**.

What is true today, and is the reason it still matters: while
`anon_select_pending_jobs` is `USING true`, an unauthenticated subscriber
receives every queue row — including `files[].path` — **at write time** rather
than having to poll. Same authorisation, worse latency for the victim.

---

## 0.7 Deployed functions — the surface that is not the client

**This is the finding revision 1 missed entirely.** Netlify deploys **every
file in `netlify/functions/`** at `/.netlify/functions/<basename>`. Nothing in
the repo narrows that: `netlify.toml` declares no per-function paths, no
function-level redirects, and no custom routing. The two redirect rules are
`/upload` and the SPA catch-all — neither touches the function namespace.

So a function is reachable because it exists in that directory. **Rewiring the
client does not retire it, does not narrow it, and does not change its URL.**

**FACT — the authentication audit, every deployed function.** Grepping all
seven for `authorization|bearer|session|x-staff|x-device|x-upload|verifyAuth`
returns exactly one hit each (two in `send-print-job`). **Every single hit is
`{ auth: { persistSession: false } }` in the Supabase client constructor** —
a client-library option, not an identity check. `send-print-job`'s second hit
is a comment saying authentication is not part of Release 1.

| deployed URL | identity check | what it does with none |
|---|---|---|
| `/.netlify/functions/get-download-url` | **none** | signs any `customer-uploads` path the caller names |
| `/.netlify/functions/complete-job` | **none** | deletes a job's files and its queue row |
| `/.netlify/functions/start-upload` | **none** | mints an upload URL |
| `/.netlify/functions/register-job` | **none** | creates a queue row |
| `/.netlify/functions/fetch-link-job` | **none** | fetches a URL server-side and stores it |
| `/.netlify/functions/send-print-job` | **none** (rate limit + server-resolved recipient only) | mails the store |
| `/.netlify/functions/cleanup-stale-jobs` | **none in code**; `config = { schedule: "@hourly" }` | deletes files older than 24h |

`cleanup-stale-jobs` is the one genuine unknown. Netlify documents scheduled
functions as not invocable over HTTP in production, but that is **platform
behaviour this repo does not control and has never tested**. It gets a probe
of its own (Part 8, row 41) rather than an assumption. Scheduled and
maintenance entry points are inventoried the same way as request handlers:
being invoked by a timer does not mean it is *only* invoked by a timer.

**Aliases.** There are none to find, and that is itself a finding to record
rather than assume: `netlify.toml` declares no `[functions]` per-function
`path`, no function-level redirect, and no `/api/*` rewrite; no handler
exports a `config.path`. The only `export const config` in the tree is
`cleanup-stale-jobs`'s `{ schedule: "@hourly" }`. So the attack surface is
exactly one URL per file — but the **re-inventory in step 4a re-checks this**,
because adding an alias is a one-line change someone could make later.

### The residual attack, stated accurately

Revision 1 would have overstated this if it had described it at all, and it is
worth being precise so the fix is not mis-scoped. **`BUCKET` is hard-coded to
`"customer-uploads"`** in both `get-download-url.js:7` and
`complete-job.js:6`. Consequences:

- `get-download-url` signs **only** `customer-uploads` paths. A `job-files`
  path handed to it does not resolve — **they are separate buckets**, and the
  `job_files_anon_*` policies (finding 2) are a different exposure with a
  different fix. Conflating them would produce a wrong threat model.
- It is therefore **not** a blind read primitive. The caller must already hold
  a valid `customer-uploads` path. Today those come from `anon SELECT
  pending_jobs` — which is why the confirmed chain in the findings document
  runs through the queue read, and why closing that read narrows this function
  without closing it.
- `complete-job` takes a queue-row **`id`**, not a path, and looks the row up
  with the service-role key. A uuid is not guessable, so the same
  precondition applies: the attacker needs an id they harvested earlier.
- **Harvested identifiers outlive the policy drop.** Anyone who read
  `pending_jobs` before step 5 keeps a working list of paths and ids, and both
  functions honour them indefinitely. That is precisely why retirement
  (step 4a) cannot be replaced by the policy drop, and why it comes first.

So the accurate statement is: *these are post-harvest amplifiers, not
independent read primitives — and they remain fully effective against every
identifier harvested before the policies close.*

**Consequence for the whole release.** Every "moves server-side" row in Part 6
creates a *new* authenticated endpoint beside an *old* anonymous one. Until
the old one is removed from deployment or made to enforce the same checks, the
client migration has changed which door the staff use and **not** whether the
other door is locked. Part 7 step 4a exists for this, and it blocks grant
closure exactly the way the client migration does.

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
2. Replay the migrations in ledger order — **`supabase/migrations/*.sql` only,
   excluding `*.rollback.sql` companions and everything under
   `migrations/pending/`** (B2 in particular must NOT be applied; it is on
   hold, Part 9).

   **Matching md5s do not prove the schemas match.** `scripts/migration-md5.sh`
   proves the two ledgers contain the same *statements*; it says nothing about
   state those statements did not create. Production has drifted before — the
   2026-09-09 audit found eight applied migrations with no file, one of which
   had taken sign-in down — and anything applied by hand, by the Supabase
   dashboard, or by a platform upgrade is invisible to a hash comparison.

   So compare the **resulting state**, object by object, and treat a difference
   as a finding rather than noise: tables and columns with types and defaults;
   RLS enabled/forced per table; every policy with mode, command, roles, USING
   and WITH CHECK; table **and column** grants per role; functions with
   `prosecdef`, `proconfig` and `proacl`; triggers; publication membership;
   bucket settings (public flag, size limit, MIME allowlist); and
   `pg_default_acl`. Any divergence is reconciled before testing begins —
   a control proven on staging is worthless if production differs in the object
   it protects.
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
   *(This is the SMTP sink referred to in Part 10 — one requirement, stated
   here, not a second one.)*
7. Second Netlify site on the same repo, env vars pointing at staging, deploy
   previews attached to **it** rather than production. **Functions deploy per
   site**, so this is also where the step-4a legacy-URL probes run first: the
   staging site has its own copy of all seven.
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

**Revision 1 got this half right.** It showed the single-statement update
above and called the problem solved. The update is sound in isolation, but it
takes `redeemed_into = $2` — the enrollment id — which means the enrollment
**must already exist**, so revision 1 implied `insert enrollment` then
`update ticket` as two round trips. Two failure modes it did not address:

- Crash or timeout between them: the enrollment exists and the ticket is still
  unredeemed, so the same ticket pairs a **second** device. Single use lost.
- Reverse order: the ticket burns and the enrollment insert fails, so the owner
  has a dead ticket, no device, and no way to tell which happened.

**Both statements go in one transaction, in one SECURITY DEFINER function**,
so the ticket burn and the enrollment are atomic:

```sql
create function public.redeem_enrollment_ticket(p_ticket_hash bytea,
                                                p_token_hash  bytea,
                                                p_label       text)
returns table (enrollment_id uuid, store_id uuid)
language plpgsql security definer set search_path = public as $$
declare v_ticket public.enrollment_tickets%rowtype; v_enroll uuid;
begin
  -- Burn first, and lock the row: a concurrent redemption blocks here and
  -- then finds redeemed_at set, so exactly one caller proceeds.
  update public.enrollment_tickets t
     set redeemed_at = now()
   where t.ticket_hash = p_ticket_hash
     and t.redeemed_at is null
     and t.revoked_at  is null
     and t.expires_at  > now()
  returning t.* into v_ticket;

  if not found then
    raise exception 'ticket not redeemable' using errcode = '28000';
  end if;

  insert into public.device_enrollments (store_id, org_id, label,
                                         device_token_hash, created_by)
  select v_ticket.store_id, st.org_id, p_label, p_token_hash, v_ticket.created_by
    from public.stores st where st.id = v_ticket.store_id
  returning id into v_enroll;

  update public.enrollment_tickets set redeemed_into = v_enroll
   where id = v_ticket.id;

  return query select v_enroll, v_ticket.store_id;
end $$;

revoke execute on function public.redeem_enrollment_ticket(bytea,bytea,text)
  from public, anon, authenticated, service_role;
grant  execute on function public.redeem_enrollment_ticket(bytea,bytea,text)
  to service_role;
```

The explicit `revoke` is not optional here — per CLAUDE.md, this project's
default privileges grant EXECUTE on every new `public` function to anon and
authenticated **at CREATE time**. A SECURITY DEFINER function that redeems
tickets would otherwise be anon-callable the moment it exists, which would
hand away the entire enrollment system. `proacl` gets diffed before and after
in the rehearsal.

Either everything commits or nothing does. **Zero rows / the `28000` raise =
replay, expiry or revocation**, and the caller cannot distinguish which —
deliberate, so a probe cannot enumerate live tickets. The replay test (Part 8
row 1) fires two concurrent redemptions and asserts exactly one enrollment.

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
  last_used_at   timestamptz not null default now(),  -- ANY call, for audit
  last_active_at timestamptz not null default now(),  -- INTERACTIVE calls only
  absolute_expires_at timestamptz not null,           -- created_at + 12h
  idle_expires_at     timestamptz not null,           -- last_active_at + 60m
  role_checked_at timestamptz not null default now(),
  revoked_at     timestamptz,
  revoked_reason text
);
create index on public.staff_sessions (enrollment_id) where revoked_at is null;
create index on public.staff_sessions (employee_id)   where revoked_at is null;
```

**Two corrections to revision 1.**

**(a) Polling must not refresh idle.** Revision 1 had one `last_used_at` bumped
by every resolver call, and separately specified that the queue is polled. Put
together, that makes the 60-minute idle expiry **unreachable**: a counter tab
left open polls `queue-list` forever and holds the session alive indefinitely,
so the only real limit is the 12-hour absolute one. An unattended iPad staying
signed in all day is precisely what idle expiry exists to prevent.

So the two clocks are split. `last_used_at` records **any** call, for audit.
`idle_expires_at` advances only from `last_active_at`, which only
**interactive** calls set. Each endpoint declares which it is, in code, as a
property of the handler — never read from the request:

| interactive (refreshes idle) | passive (never refreshes idle) |
|---|---|
| `staff-login`, `orders-save`, `queue-download-url`, `queue-complete`, `jobs-save`, `job-file-*`, `send-print-job`, `orders-list`, `jobs-list` | `queue-list`, the badge count, any keepalive or heartbeat |

`queue-list` is the interesting one: it is what the queue tab polls on a timer,
so it is passive **even though staff do also open it by hand**. Taking the
safer reading costs a signed-in user nothing — any actual work on a queue job
(download, complete) is interactive and refreshes the clock. A tab that only
watches does not.

**(b) Demotion revokes.** Revision 1 copied `employee_role` at issue time and
said a later change "takes effect at next sign-in", treating promotion and
demotion as the same case. They are not:

- **Promotion** staff → manager not applying until next sign-in is fine. The
  session is narrower than the employee's current role; nothing leaks.
- **Demotion** manager → staff not applying is a **security failure**. The
  owner demotes someone precisely to stop them seeing margin, and under
  revision 1 that person keeps seeing it for up to 12 more hours.

So: **any change to `employees.role`, and any deactivation, revokes that
employee's live sessions** (Part 5). The session's copied `employee_role` then
only ever describes a session that is still valid, and re-authenticating
issues a session at the current role. Promotion still requires a fresh sign-in,
which is the harmless direction.

`role_checked_at` records when the copy was last reconciled against
`employees.role`, so a missed revocation shows up in an audit query rather than
being invisible.

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

**Quota reservation is atomic, and reserved before the URL is minted.**
Revision 1 stored `used_files` / `used_bytes` counters without saying when
they move. Read-then-increment across concurrent requests lets a caller mint
20 URLs against a limit of 10. So `start-upload` reserves in the same
statement that checks:

```sql
update public.upload_capabilities
   set used_files = used_files + 1,
       used_bytes = used_bytes + $2
 where id = $1 and revoked_at is null and consumed_at is null
   and expires_at > now()
   and used_files + 1 <= max_files
   and used_bytes + $2 <= max_bytes
returning id;
```

Zero rows = over quota, expired or already consumed. The declared size is a
**reservation**, reconciled against the object's real size at registration —
a caller that declares 1 byte and uploads 40 MB is caught then.

**Registration verifies the object exists.** A recorded path is a claim that a
URL was minted, not that anything was uploaded. `register-job` calls the
Storage API to confirm each object is present and reads its **actual** size
and MIME before creating the queue row; a path with no object is rejected.
Otherwise the queue fills with rows pointing at nothing and staff chase files
that were never sent.

**Consumption and the queue insert are one transaction, and idempotent.**
`consumed_at` is set and the `pending_jobs` row is inserted together, keyed by
the capability id — a retried `register-job` (flaky phone connection, an
impatient second tap) returns **the same** queue row rather than creating a
second. Either both happen or neither does.

## 2.5 Consistency — enforced, not implied by separate foreign keys

Revision 1 gave `staff_sessions` three independent FKs — `enrollment_id`,
`store_id`, `employee_id` — each valid on its own. **Three valid FKs do not
prove they agree.** A row naming store A's enrollment, store B's id and store
C's employee satisfies every one of them, and the resolver would then hand a
handler a `store_id` its enrollment never had.

Two layers, because neither alone is enough:

- **In the schema.** Composite foreign keys carry the tenant through, so
  disagreement is not representable: unique keys on
  `device_enrollments (id, store_id)` and `employees (id, store_id)`, then
  `staff_sessions (enrollment_id, store_id)` and
  `(employee_id, store_id)` referencing them. The database rejects a
  mismatched row at write time rather than trusting the writer.
- **In the resolver.** `store_id` is **read from the enrollment row** on every
  request and is the only value handlers ever see. The session's own
  `store_id` is a denormalised convenience for indexing, never an authority.
  If the two ever disagree, the request fails closed and the mismatch is
  logged — a disagreement means either a schema bug or tampering, and both
  deserve a loud failure rather than a silent pick.

The same shape applies to `upload_capabilities` → `upload_capability_files`
and to `enrollment_tickets` → `device_enrollments`.

## 2.6 Durable abuse limits

Release 1's `send-print-job` limiter lives in the warm Netlify instance and
says so honestly: *it raises the cost of abuse, it does not guarantee a cap.*
That was an acceptable statement for a mail endpoint. **It is not acceptable
for PIN verification**, and revision 1 left `staff-login` saying only
"rate-limited" without saying where the counter lives.

A per-instance counter does not bound PIN guessing. Netlify runs many
concurrent instances and recycles them; an attacker spreading guesses across
instances, or simply pausing until a cold start, faces no cumulative limit.
Against a 4-digit PIN — 10,000 possibilities — a limiter that resets is
close to no limiter. The whole point of moving PIN verification server-side
(Phase S1) is the cap, so the counter has to be **durable and shared**:

```sql
create table public.auth_attempts (
  scope        text not null,          -- 'pin' | 'ticket' | 'upload_cap'
  subject      text not null,          -- enrollment id, ticket-hash prefix, or IP
  window_start timestamptz not null,
  attempts     int  not null default 0,
  locked_until timestamptz,
  primary key (scope, subject, window_start)
);
create index on public.auth_attempts (locked_until) where locked_until is not null;
```

Counted **per enrollment** first and per IP second: the enrollment is the thing
being attacked and cannot be rotated by the attacker, whereas an IP can.
Lockout is exponential and capped, and **a lockout is recorded, not just
enforced** — an owner should be able to see that someone sat at their counter
trying PINs. Failures increment inside the same transaction that checks the
PIN, so a burst of concurrent guesses cannot all read a stale count.

The same table backs ticket redemption (Part 2.2), upload-capability minting,
and **outbound mail** — `send-print-job`'s per-instance limiter is replaced by
this one, not left alongside it. Part 10 previously listed durable mail
limiting as an optional opportunity; it is **in scope**, because a mail
endpoint that a staff session can drive is still a mail endpoint, and the
store's SMTP reputation is the thing at risk.

**Budgets are scoped so one attacker cannot lock out a shop.** A naive
per-store counter turns a rate limiter into a denial-of-service tool: an
attacker burns the store's budget and the counter cannot take orders. So:

- **PIN attempts** count per `(enrollment, employee)` — one employee's PIN
  being attacked never locks out their colleague, and never locks the device.
- **A locked enrollment still accepts a different employee's correct PIN**;
  lockout suppresses guessing at a subject, not use of the device.
- **IP budgets are secondary and never sole grounds** for refusing a request
  that also presents a valid credential. A shared storefront IP is normal.
- **An owner can always clear a lockout** from the admin panel, and sees that
  it happened.
- Mail limits are per store **and** per session, so one compromised session
  cannot consume the store's whole allowance.

## 2.7 Grants — explicit, and the opposite of the current default

```sql
revoke all on public.device_enrollments,  public.enrollment_tickets,
              public.staff_sessions,      public.upload_capabilities,
              public.upload_capability_files, public.auth_attempts
  from public, anon, authenticated;
grant select, insert, update, delete on
  public.device_enrollments, public.enrollment_tickets, public.staff_sessions,
  public.upload_capabilities, public.upload_capability_files,
  public.auth_attempts
  to service_role;
alter table public.device_enrollments   enable row level security;
alter table public.enrollment_tickets   enable row level security;
alter table public.staff_sessions       enable row level security;
alter table public.upload_capabilities  enable row level security;
alter table public.upload_capability_files enable row level security;
alter table public.auth_attempts        enable row level security;
```

RLS on with **zero policies** on all six — the `_archive_commission_columns`
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
   required.** Different cookie name, different table, different resolver. The
   resolver returns the token *kind*; a handler asserts the kind it needs.
2. **A device token without a live staff session grants nothing** beyond
   `staff-login`. Enrollment proves *which store's counter*, not *who*.
3. **Role comes from the session row**, never from the request.

### Transport — host-only `HttpOnly` cookie plus a CSRF token

Revision 1 said "header only, and it would land in logs", which reads as a
decision but skipped the reason the architecture called for a cookie. A bearer
token held in JS is readable by **any** script on the origin, so one XSS — or
one compromised CDN script, and this app loads three from cdnjs — exfiltrates
a live staff session. `HttpOnly` is what makes that impossible; it is the only
part of the contract that survives an attacker running code on the page.

```
Set-Cookie: __Host-pc_staff=<opaque>; HttpOnly; Secure; SameSite=Strict;
            Path=/; Max-Age=43200
```

- **`__Host-` prefix** — the browser rejects the cookie unless it is `Secure`,
  `Path=/`, and carries **no `Domain` attribute**. That makes it host-only:
  a sibling or subdomain cannot set or overwrite it. This is what stops cookie
  fixation, which a bare cookie name would not.
- **`HttpOnly`** — never readable from JS, so it cannot be exfiltrated by
  injected script, logged by an error reporter, or cached.
- **`SameSite=Strict`** — the cross-origin request in Part 8 row 21 carries no
  cookie at all.
- Same shape for `__Host-pc_device` and `__Host-pc_upload`. **Different cookie
  names are what keep the three kinds distinct** at the transport layer, before
  a resolver is even chosen.

**Cookies alone re-introduce CSRF**, which a bearer header did not have. That
is the trade, and it is paid explicitly rather than by relying on `SameSite`
alone — `SameSite` is a browser-enforced control with legacy and embedded-webview
gaps, and one of these devices is a counter iPad:

- Every state-changing request carries `X-PC-CSRF`, matched against a
  per-session CSRF secret stored **server-side on the session row**. The token
  is delivered in the `staff-login` response body (readable by JS, unlike the
  session cookie) and held in memory, not `localStorage`.
- **Double-submit alone is not accepted.** A cookie-readable CSRF value can be
  set by a subdomain attacker; the server-side comparison cannot.
- Requests missing or failing the CSRF check are rejected **before** the
  session is looked up, so a CSRF probe cannot be used to time session
  existence.
- `Origin` is checked against an allowlist as a second, independent gate.
  Neither gate alone is trusted.

**Never in a URL.** No token, session or CSRF, ever appears in a query string
or path — they land in access logs, `Referer` headers and browser history.
Part 8 row 23 asserts the server rejects it rather than merely never sending
it that way.

### Session rotation on PIN switch

Two staff share a counter; one signs in after the other. **`staff-login`
always issues a new session and revokes the previous one on that enrollment**
— it never re-uses or re-labels the existing session row. Without rotation the
second employee inherits the first's session identity, and the order history
attributes their work to the wrong person. Fixation is the security framing;
misattributed orders is the one that shows up in the store's own records.

### What the kiosk contract does and does not cover

- **Same-origin is not isolation.** `/upload` and the calculator are the same
  Netlify origin, so they share cookies, `localStorage`, the service worker and
  the CDN scripts. A `?mode=kiosk` flag is a **UI state**, not a boundary — it
  is exactly as strong as the JS that reads it. The `__Host-pc_upload` cookie
  being a different name stops a *handler* confusing the kinds; it does not
  stop a script on that origin reading whatever the origin can read.
  **Real isolation means a separate origin** (`upload.printcalculator2.…`, or
  a distinct Netlify site) so the browser enforces the boundary rather than
  our code. That is a bigger change than Release 2 and is **not** in it — so
  the residual risk is recorded here rather than implied away: *anyone who can
  run script on the shared origin can reach anything that origin can reach.*
- **An owner's Supabase session is not a staff session and is not revoked by
  `staff-session-revoke-all`.** If an owner signs into the admin panel on the
  counter iPad, `supabase-js` persists that session in `localStorage` under
  its own key, outside every table this release creates. Kiosk entry then
  leaves a **full owner credential** on a device a customer can touch, and the
  staff-session revoke says nothing about it. So kiosk entry must also call
  `supabase.auth.signOut()` and clear the client's auth storage, and the admin
  panel warns on sign-in from a device that is enrolled as a kiosk. The
  general rule: **every credential class on the device needs its own explicit
  teardown** — enumerate them, do not assume the new one is the only one.
- **Offline kiosk entry must not lie.** `staff-session-revoke-all` is a
  network call. When it fails, the local flag may flip while the server-side
  sessions stay live, and the UI must not report a revocation that did not
  happen. Kiosk entry therefore: clears local state, **retries** the revoke,
  and until it succeeds shows kiosk mode as *not confirmed* rather than
  silently succeeding. This is the Release 1 comment-discipline rule applied
  to UI state — do not assert a guarantee that was not enforced.
- **CORS failure is not proof a mutation was prevented.** A browser refusing
  to show a response does not mean the request never reached the handler;
  simple requests are sent before any preflight. So the cross-origin test
  (Part 8 row 21) asserts **server-side state is unchanged**, not that the
  browser reported an error.

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

## 3.3 The seven functions that already exist — disposition, one by one

New endpoints do not delete old ones. Every function in `netlify/functions/`
is a live URL (Part 0.7), so each of the seven needs an explicit decision, and
**"the client no longer calls it" is not one of them.**

| existing function | disposition | why |
|---|---|---|
| `get-download-url` | **delete the file** | `queue-download-url` replaces it with ownership checks. Nothing may keep an unauthenticated signer alive |
| `complete-job` | **delete the file** | `queue-complete` replaces it. This one is destructive — it deletes files and a row |
| `start-upload` | **keep, add capability auth** | genuinely public by design; it gains `resolveUpload` + the recorded-path write |
| `register-job` | **keep, add capability auth** | same, plus paths validated against `upload_capability_files` |
| `fetch-link-job` | **keep, add capability auth** | same, plus the tenant-aware allocation path B2 needs (Part 9) |
| `send-print-job` | **keep, add staff auth** | Release 1 fixed the recipient and added limits; identity is this release's job |
| `cleanup-stale-jobs` | **keep, add a guard** | scheduled, but HTTP-invocability is untested (Part 8 row 41). It gets an explicit non-schedule rejection rather than relying on the platform |

**Deletion is the only reliable retirement.** Options considered and rejected:

- *Leave it and rely on obscurity* — it is a documented, guessable path already
  present in this repo's own client history.
- *Return 410 from the handler body* — better than nothing, and it is the
  fallback if a delete must be staged, but it leaves a deployed function whose
  next editor can "restore" it. A file that does not exist cannot regress.
- *Block it with a redirect rule* — `netlify.toml` redirects do not reliably
  shadow the reserved `/.netlify/functions/` namespace. Not a control to bet on.

**Sequencing matters and is easy to get backwards.** The delete lands in
Part 7 **step 4a**, after the replacement endpoints are deployed and the client
is confirmed on them, and **before** grant closure. Deleting earlier breaks the
counter; deleting later means grants close while an anonymous door is still
open — which would make the whole release a false negative.

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
| staff session | **12 h** | **60 min, interactive calls only** | no | logout, kiosk entry, device revoke, demotion, deactivation, owner |
| upload capability | 30 min | — | consumed on `register-job` | expiry or quota |

**Idle is measured from interactive activity only** (Part 2.3a). Polling
`queue-list` on a timer does not hold a session open; downloading a file,
completing a job or saving an order does. Without that split the idle clock
never fires on an open counter tab and the 12-hour absolute expiry is the only
real bound.

Cascades, all server-side:

- Revoking a **device** revokes every session on it. A revoked device cannot
  create new sessions, so a counter iPad that walks out is one click.
- **Deactivating an employee** (`active=false`) revokes their live sessions.
- **Demoting an employee** manager → staff revokes their live sessions
  (Part 2.3b). The demotion is the owner acting to remove access *now*; a
  session carrying the old role for up to 12 hours would defeat it. Both the
  role trigger and the admin endpoint perform the revoke, so a role change made
  directly in SQL is covered too — a change made only through the UI path would
  leave the other path silently unsafe.
- Promotion staff → manager does **not** revoke; it applies at next sign-in.
  The live session is narrower than the employee's new role, which leaks
  nothing.
- **Kiosk entry calls `staff-session-revoke-all` for the enrollment.** Since
  sessions are server-side, this kills them in *every tab of that browser*,
  not just the one that flipped the flag. Removing `?mode=kiosk` restores no
  authority, because the tokens are gone from the server — re-entry requires a
  PIN. That is the property the "kiosk across tabs" test proves.
- Every resolver checks `revoked_at is null AND absolute_expires_at > now()
  AND idle_expires_at > now()` **in the same statement** that updates the
  activity clocks. No read-then-decide window. Which clock that statement
  advances depends on the handler's declared kind, never on the request.

---

# Part 6 — Every direct client data path that must move

Grants cannot close until **all** of these run server-side. This is the
checklist that gates Part 7 step 5.

## 6.1 The 17 direct data paths

| # | client path | file:line | reaches | replaced by |
|---|---|---|---|---|
| 1 | `fetchOrders` | `src/lib/supabase.js` | `orders` SELECT | `orders-list` |
| 2 | `insertOrder` | `src/lib/supabase.js` | `orders` INSERT | `orders-save` |
| 3 | offline queue drain | `src/lib/orderQueue.js` | `orders` INSERT | `orders-save` (same whitelist) |
| 4 | `PrintQueue` initial fetch | `src/components/PrintQueue.jsx:61` | `pending_jobs` SELECT | `queue-list` |
| 5 | **`PrintQueue` Realtime subscribe** | `src/components/PrintQueue.jsx:69-87` | `pending_jobs` Realtime | poll `queue-list` (passive — see Part 5) |
| 6 | queue badge count | App.jsx | `pending_jobs` SELECT | `queue-list` |
| 7 | `get-download-url` caller | `PrintQueue.jsx:111,129` | function (unauth) | `queue-download-url` + staff cookie |
| 8 | `complete-job` caller | `PrintQueue.jsx:148` | function (unauth) | `queue-complete` + staff cookie |
| 9 | `fetchPrintJobs` | `src/lib/supabase.js` | `print_jobs` SELECT | `jobs-list` |
| 10 | print-job insert | App.jsx save path | `print_jobs` INSERT | `jobs-save` |
| 11 | **`uploadJobFiles`** | `src/lib/supabase.js:113` ← `App.jsx:2675` | `job-files` INSERT | `job-file-upload-url` |
| 12 | **`downloadJobFile`** | `src/lib/supabase.js:186` ← `App.jsx:2724`, `JobHistory.jsx:298` | `job-files` SELECT | `job-file-download-url` |
| 13 | **`getJobFileSignedUrl`** | `src/lib/supabase.js:198` ← `JobHistory.jsx:287` | `job-files` SELECT | `job-file-download-url` |
| 14 | **`deleteJobFiles`** | `src/lib/supabase.js:213` — **no caller today** | `job-files` DELETE | `job-file-delete`, **or delete the export** |
| 15 | `findEmployeeByPin` | `src/lib/supabase.js:357` | `verify_employee_pin` RPC | `staff-login` |
| 16 | `sendOrderEmail` | `App.jsx` | `send-print-job` | same + staff cookie |
| 17 | `start-upload` / `register-job` / `fetch-link-job` callers | `UploadApp.jsx:192,203,180` | functions (unauth) | same + capability cookie |

**All four `job-files` helpers move — 11, 12, 13 and 14.** Number 14 has no
caller today. That is not a reason to skip it: it is an exported function
holding a direct anon-key DELETE, and leaving it is how a hole re-opens six
months after the policies close. It moves or it is deleted; either is fine,
silence is not.

Row 5 changes with the Realtime correction in Part 0.6. Dropping
`anon_select_pending_jobs` closes the subscription as well as the REST read,
because Realtime evaluates the same SELECT policy. The client still moves to
polling `queue-list`, because a server-side session cannot authorise a direct
Realtime channel — but the reason is "the channel has no way to carry our
identity", not "Realtime bypasses RLS".

Paths that **stay** on the anon key, by design: the price book shape
(`paper_types`, `discounts`, `addons`, `outsourced_products`, `settings`) and
the store profile. These are public config the kiosk and the upload page need
before any identity exists. Two things must come **out** of that public
surface first — `stores.bootstrap_secret_hash`, and every cost field.

## 6.2 Cost is delivered by five paths, not one

Revision 1 listed `sheet_prices` among the tables that stay open "by design"
and separately noted its cost columns are anon-readable, without reconciling
the two. Worse, it treated `sheet_prices` as *the* cost surface. **It is one of
three, and it is not the most exposed.**

| # | path | what it exposes | evidence |
|---|---|---|---|
| C1 | `public.sheet_prices` via `sheet_prices_read` | `paper_cost`, `click_color`, `click_bw` | Part 0.1 — `USING true` for `{anon,authenticated}` |
| C2 | **`/pricing.json`**, a deployed static file | `baseCostColor` / `baseCostBW` for **every** sheet and LF media, **plus `sheetMarkupPerPaper` and `lfMarkupPerPaper`** | `public/pricing.json` top-level keys; fetched at `App.jsx:1676` |
| C3 | **`localStorage` caches** | the same numbers, persisted per device, surviving restart | writes at `App.jsx:1453` (`LS.LABOR`), `:1464` (`LS.PRICING`), `:1465` (`LS.LF_PRICING`), `:1467` (`LS.BP_PRICING`), and the import path at `:1616` |
| C4 | **`src/data/signs365Pricing.json` — in the JS bundle** | 66 KB of Signs365 **wholesale trade costs** for every outsourced product, plus `shippingRules` | `import`ed by `SpecialtyTab.jsx`; also cached as `localStorage["signs365Pricing"]` |
| C5 | **`orders.cost_subtotal` / `orders.margin_pct`** | accepted **from the browser** on every insert | `ORDER_COLUMNS` in `orderQueue.js:21-27` |

**C4 was named by neither review and is the hardest of the five.** The
outsourced-product cost list is `import`ed, so it is **compiled into the
JavaScript bundle** — it ships to every kiosk and every walk-in who loads
`/upload`, with no fetch to intercept and no policy to close. The markup tiers
(2.5× under $50, 2× $50–200, 1.75× over $200) are in the component source, so
anyone with the bundle can derive the trade cost from the quoted price even
without the file. Fixing C4 means moving outsourced pricing behind an endpoint
that returns **selling prices only**, which is a real refactor of
`SpecialtyTab` — not a config change. It is scoped in step 4c below and it is
the reason the cost transition is its own substep rather than a line item.

**C5 is an integrity problem, not a confidentiality one.** The cost and margin
on a saved order are supplied by the client and stored verbatim. Anyone who
can insert an order — today, anyone at all, via `anon_rw_orders` — can write
whatever margin they like into the store's own history. After Release 2 the
insert requires a staff session, which fixes *who* can write, not *what*.

**C2 is the one that makes closing C1 pointless on its own.** `/pricing.json`
is served by the CDN to anyone who requests it — no key, no policy, no RLS. It
carries `baseCostColor` and `baseCostBW` for every stock (28lb, 20lb, 80c,
110c, 80t, 100t, 14pt, 18pt, and the LF media). Revoking `sheet_prices_read`
while that file ships would move the confidential numbers from one public
place to another and change nothing about who can read them.

`sw.js` already treats `/pricing.json` as sensitive and refuses to cache it —
the right instinct applied to the wrong layer. Not caching a public file does
not make it private.

**C3 is why sign-out matters.** The cost model is written to `localStorage` on
every config load, so it outlives the session on a shared counter device. Any
script on the origin can read it, and it survives a browser restart.

**The dividing line: selling prices are public, costs are not.** Public
quoting — the kiosk, `/upload`, an unauthenticated tab — must work with
**selling prices alone**. Every cost field, markup factor and margin threshold
is staff-only. That is the acceptance criterion for the whole substep: *a
quote produced with no identity is correct to the customer and reveals nothing
about what the store pays.*

**What Release 2 does about each:**

| | action | lands in |
|---|---|---|
| C1 | serve the price book through a **projection without cost columns** for the public path; cost columns reach only the server and authenticated managers/owners. Table-wide `SELECT` must be **revoked** first — see step 5.5 | step 5 |
| C2 | **split the file.** `/pricing.json` keeps selling prices and presets; cost and markup fields move behind an authenticated endpoint. The offline fallback keeps working and simply computes no margin — exactly as it already does when the blueprint LF media is missing | step 4b |
| C3 | cost caches **cleared on sign-out, kiosk entry and session expiry**, alongside the sw purge. Price caches stay — they are what makes the tool work offline. **Previously-populated storage must be cleared on upgrade**, not merely stopped: a kiosk that has run this app for months already holds the cost model, and a client that stops *writing* it leaves it there forever | step 4b |
| C4 | outsourced **selling** prices from an endpoint; the wholesale file leaves the bundle. Largest piece of work in the substep | step 4c |
| C5 | cost/margin computed and stamped **server-side** in `orders-save`; client-supplied `cost_subtotal` / `margin_pct` ignored, and the snapshot **versioned** against the pricing version that produced it | step 4b |

### Offline quotes and the pricing version

C5's server-side stamping collides with the offline queue, and the collision
has to be designed rather than discovered. An order quoted offline at 9am and
drained at 2pm must record **the margin that was true when it was quoted**,
not when it drained — otherwise a price change during the day silently
rewrites history.

So: every published price book carries a **`pricing_version`**. A queued order
stores that version (not the costs). On drain, `orders-save` recomputes cost
and margin **from the server-side copy of that version**. If the version is no
longer available, the order still saves — with `margin_pct = null` and a
recorded reason. **An order is never rejected and never silently discarded
because its pricing version aged out.**

### If margin is ever a paid tier

Stated now because it changes where the check lives. The permission matrix
(Part 4) gates margin on the PIN `manager` role, which is a **counter
permission**: it answers "may this person at this counter see it". A
subscription tier answers "has this tenant paid for it" — a different
question, on a different subject, changeable by a different party. If margin
becomes a commercial boundary, the entitlement is checked **server-side
against the tenant's subscription record**, in the same handler that decides
whether to include the fields, and a manager PIN never satisfies it on its
own. Building it as a role check now and calling it a tier later is how a
paid feature becomes free.

This is also a **kiosk leak surface**, which is why it is not merely a
confidentiality nicety. `canSeeMargin` and the `staffOnly` flag stop margin
reaching the *screen*, and `scripts/tests/kiosk-guard.test.js` is the contract
for that. Neither gate stops a customer opening devtools on the kiosk iPad and
reading `printcalc_sheet_pricing_v1`, or simply fetching `/pricing.json`.
The Phase E guarantee is about rendering; C2 and C3 are about storage and
transport, and they need their own fix.

---

# Part 7 — Order of operations

The Aug-31 lesson drives this: **nothing is revoked until its replacement is
deployed and confirmed in production.**

### Step 1 — Staging (Part 1). Nothing else starts until this is green.

### Step 2 — Additive migrations only
Six tables, their grants, RLS-on-zero-policies. Every `CREATE FUNCTION`
follows CLAUDE.md rule 4: `revoke ... from public, anon, authenticated,
service_role`, then explicit grants, with `proacl` diffed before/after in a
rolled-back rehearsal — `redeem_enrollment_ticket` above is the one that would
be anon-callable by default and is the one to prove. **Nothing existing is
touched.** Fully reversible by dropping six tables nothing references yet.

### Step 3 — Deploy the endpoints, dark
All endpoints live; **no client calls them**. Exercise them on staging with
the Part 8 matrix. Production is untouched and unaware.

### Step 4 — Deploy the client, dual-path
Client moves onto the endpoints. One release, all 17 paths, because a partial
move means a partial grant closure, which is no closure. This release also
carries the cost-delivery changes (Part 6.2): the `/pricing.json` split, and
clearing the cost caches on sign-out, kiosk entry and expiry.

**Confirm in production before anything tightens:**
- an owner enrolls the counter iPad and both kiosk devices
- staff sign in by PIN on each; a manager sees margin, staff does not
- a real order saves; the offline queue drains
- a real customer upload appears in the queue, is downloaded, is completed
- Job History downloads a file; a job saves with attachments
- a quote emails to the store
- kiosk entry and exit
- the app still prices correctly **with Supabase unreachable** — the
  `/pricing.json` fallback path, now cost-free, must degrade to "no margin"
  rather than to "no prices"

### Step 4a — Retire the legacy functions (NEW — blocks step 5)

Step 4 changes which door the staff use. **This step is what locks the other
door**, and without it grant closure is a false negative: the policies would
be shut while `get-download-url` still signs any path it is handed.

1. **Delete** `netlify/functions/get-download-url.js` and
   `netlify/functions/complete-job.js`. Deploy. Confirm both URLs return 404
   **from outside the app** — curl, no cookies, no `Origin`.
2. Add `resolveUpload` to `start-upload`, `register-job`, `fetch-link-job`;
   add `resolveStaff` to `send-print-job`; add the non-schedule guard to
   `cleanup-stale-jobs`. Deploy.
3. **Probe every deployed URL directly, independent of the UI** — the Part 8
   row 37-41 block. Under no identity, and under a *wrong-kind* identity.
4. Re-inventory `netlify/functions/` and diff against the Part 3.3 table. The
   inventory, not the intention, is the deliverable: a function that exists is
   a URL that answers.

**Only when every legacy URL is 404 or authenticated does step 5 begin.**

### Step 4b — Cost transition, additive (NEW)

The cost work gets its own additive → confirm → close cycle, because C1–C5
(Part 6.2) are five different mechanisms and closing one early breaks quoting.
Additive only; nothing is removed yet:

1. Publish `pricing_version` with every price book.
2. Deploy `pricing-costs` (staff-authenticated) returning cost fields, markup
   factors and thresholds.
3. Ship a `/pricing.json` that **still carries costs**, plus the new cost-free
   `/pricing-public.json`. Both served; the client reads the public one and
   fetches costs separately when it holds a session.
4. `orders-save` computes and stamps cost/margin server-side, ignoring the
   client's values, and records `pricing_version`. The offline queue sends the
   version instead of the numbers.
5. Clear the C3 caches on sign-out, kiosk entry and expiry — **including a
   one-time purge of already-populated keys on upgrade**, since an existing
   kiosk already holds the cost model.

**Confirm in production:** margin is identical before and after for a real
order; a kiosk device shows no cost key in `localStorage` after upgrade; a
quote with Supabase unreachable still prices, with margin absent rather than
wrong.

### Step 4c — Outsourced costs out of the bundle (NEW)

C4 on its own, because it is a `SpecialtyTab` refactor rather than a config
change. Selling prices and tier-resolved prices come from an endpoint; the
wholesale file and the markup tiers leave the client bundle. **Confirm:** a
Specialty quote is unchanged to the customer; the built bundle no longer
contains any Signs365 wholesale figure (grep the built assets for known cost
values — an assertion in `yarn test`, not a manual check).

### Step 4d — Close the cost paths

Only after 4b and 4c are confirmed: delete costs from `/pricing.json` (or
retire it for `/pricing-public.json`), and close C1 in step 5.5 below.

### Step 5 — Tighten, one object at a time, each with its own rollback file
1. `orders`: drop `anon_rw_orders`. No replacement policy — **function-only**.
2. `pending_jobs`: drop `anon_select_pending_jobs`. This closes the REST read
   **and** the Realtime subscription, since `postgres_changes` evaluates the
   same SELECT policy. Also remove the table from the `supabase_realtime`
   publication — defence in depth and a smaller blast radius, **not** the gate
   (correcting revision 1, which implied publication membership was its own
   bypass).
3. `print_jobs`: drop both anon policies.
4. `storage.objects`: drop all three `job_files_anon_*`.
5. **`stores.bootstrap_secret_hash` and the cost columns — the mechanism,
   stated correctly.** Revision 1 said "a view or column-scoped policy". There
   is no such thing as a column-scoped RLS policy: **RLS filters rows, never
   columns.** A policy cannot hide a column from a role that has `SELECT` on
   the table. Two mechanisms actually exist, and one must be chosen:

   - **Column privileges.** `revoke select on public.stores from anon,
     authenticated;` then `grant select (id, slug, name, address, phone, logo_url,
     …) on public.stores to anon, authenticated;` — the table-level grant must
     come **off** first, or the column grants add nothing (privileges are
     additive, so a table-level `SELECT` already covers every column). The
     row policy `stores_read` stays and keeps doing its own job.
   - **A projection with the base table closed.** A view (or security-invoker
     view plus a policy) exposing only the public columns, with `SELECT`
     revoked on `public.stores` entirely.

   Either works; **what does not work is leaving the table grant in place.**
   The same choice applies to the cost columns on `sheet_prices` (C1 in Part
   6.2) — and closing C1 is only meaningful once C2, the deployed
   `/pricing.json`, has been split in step 4.
6. `verify_employee_pin`: revoke EXECUTE from `anon` and `authenticated`
   (**Phase S1 lands here** — its rollback file already exists).
7. **Excess grants, everywhere they exist — not just `public`.**
   - `revoke truncate, references, trigger on all tables in schema public from
     anon, authenticated`
   - the same on **`storage.objects`**
   - and on **`storage.buckets`**, which revision 1 omitted. `anon` holds the
     full DML set there too. It is currently unexploitable only because that
     table has RLS on with zero policies (Part 0.5) — a single added policy
     would make the grant live, so the grant goes.
   - **Review the default privileges that produced all this.** These grants
     were not written by hand; they come from `ALTER DEFAULT PRIVILEGES` in
     this project, which is the same mechanism that makes every new function
     anon-executable (CLAUDE.md rule 4). Read `pg_default_acl` for **every
     role that creates objects here** — `postgres`, `supabase_admin`, the
     migration role — and fix the defaults, or the next table created arrives
     with the same grant set and this step has to be repeated forever.
8. `customer-uploads`: set a size limit and a MIME allowlist.

**Check all roles, not just anon.** Every probe runs as `anon` *and* as
`authenticated`, because `{anon,authenticated}` appears on every one of these
policies and a signed-in owner's browser sends `authenticated`.

### Step 6 — Verify denial
Direct REST, **every Storage verb** (read, upload, overwrite, sign, delete),
**Realtime subscribe including DELETE events**, and **every legacy function
URL** — all denied, as both roles, on staging and then production. The legacy
URLs are re-probed here even though step 4a already did: step 5 redeployed
the site, and a deploy is exactly when a deleted file comes back. Then purge prior sensitive caches:
bump the sw.js generation again as part of this release, since the client
changes anyway.

### Rollback — break-glass, not a supported mode

Each step 5 item has a `.rollback.sql` restoring the exact prior policy,
captured verbatim beforehand. Steps 2–4 roll back by redeploying the previous
client — the additive tables can stay; they harm nothing. **The ordering
constraint in reverse: restore the policy first, then roll back the client.**
Rolling back the client while the grants are closed leaves the counter unable
to work.

**Say plainly what a rollback is.** Revision 1 presented these files as the
safety net and stopped there, which reads as though rolling back returns the
system to a safe state. It does not. Every one of those files **restores a
policy this release exists to remove** — `anon_rw_orders` with `USING true`,
the anon queue read, the `job_files_anon_*` trio. A rolled-back system is
back to the posture the 2026-09-10 audit rated critical, with the one
difference that it is now publicly documented.

So a rollback is **break-glass**: it trades a known-critical exposure for
keeping the counter running, and it is the right trade at 9am on a Saturday
with customers waiting. What it is not is a place to rest. Conditions:

- It is an **incident**, not a deploy. Whoever pulls it says so.
- A rollback of step 4a — restoring a deleted function — is worse still: it
  re-opens an unauthenticated file-signing endpoint. Prefer fixing forward.
  If it must happen, the restored file returns 410 for everything except the
  exact call the counter needs.
- A time limit is set when it is pulled, not discovered later.
- Stale sessions are revoked on the way back up; the rolled-back client cannot
  be assumed to have cleaned anything.

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
| 21 | **cross-origin** | call every mutating endpoint from another origin | **server-side state unchanged** — asserted by reading the row back, not by observing a CORS error |
| 22 | **credential persistence** | sign out; inspect Cache Storage, `localStorage`, cookies | no session cookie, no CSRF value, no cost keys, **no `supabase.auth` session**; sw generation bumped. Queued orders are explicitly out of scope — see row 25 |
| 23 | token in a URL | session token as a query param | rejected by the server |
| 24 | **duplicate order retries** | same `orders-save` idempotency key twice, concurrently | exactly one row |
| 25 | **offline drain after revoke** | queue offline, revoke session, reconnect, sign in again | rows **survive and drain**; never silently dropped |
| 26 | upload quota, concurrent | 15 parallel `start-upload` against `max_files = 10` | at most 10 succeed — atomic reservation, not read-then-increment |
| 26b | declared vs actual size | declare 1 byte, upload 40 MB | rejected at registration against the real object size |
| 27 | **register-job path forgery** | register a path this capability never minted | 403 — `upload_capability_files` is the authority |
| 28 | register-job cross-capability | T2's minted path on T1's capability | 403 |
| 28b | **register-job idempotency** | same registration twice, concurrently | one queue row, same id returned both times |
| 28c | phantom object | register a minted path with nothing uploaded | rejected; no queue row |
| 29 | **direct REST after closure** | `orders`, `pending_jobs`, `print_jobs` as **anon and authenticated** | 0 rows / denied, both roles |
| 30 | **direct Storage after closure — all four verbs** | list/download, **upload**, **overwrite an existing object**, **delete**, and **create a signed URL**, both buckets, both roles | denied on every verb. A read-only probe would have missed `job_files_anon_insert` entirely |
| 31 | **Realtime after closure** | subscribe to `pending_jobs`, both roles | no rows delivered, **including DELETE events** — deletes are the documented narrower case, so they are asserted explicitly |
| 32 | TRUNCATE after revoke | `TRUNCATE orders`, `storage.objects`, `storage.buckets` as anon | permission denied (staging only) |
| 33 | bootstrap hash | `select bootstrap_secret_hash from stores` as anon **and authenticated** | column absent or denied |
| 33b | **cost closure, every path** | as anon: `sheet_prices` cost columns; `GET /pricing.json`; the built JS bundle grepped for known wholesale values; a fresh kiosk's `localStorage` | no cost, markup or threshold value reachable by any of the four |
| 33c | **cost snapshot integrity** | `orders-save` with `cost_subtotal: 0, margin_pct: 99` in the body | stored values are the **server's**, not the body's |
| 33d | pricing version ageing | queue offline, publish new prices, drain | margin reflects the **quoted** version; if unavailable, saves with null margin and a reason — never rejected |
| **37** | **legacy URL, no identity** | `POST /.netlify/functions/get-download-url` and `complete-job` with a **previously harvested** path and id, no cookies, from outside the app | **404** (file deleted). This is the row that proves step 4a, and harvested identifiers are the point |
| **38** | **legacy URL, wrong identity** | the retained five with an upload capability where staff is required, and vice versa | 401 — fails closed, never falls through to the old anonymous behaviour |
| **39** | **retained aliases enforce the replacement's permissions** | every kept function, cross-store ids | identical decisions to the new endpoint; a retained alias is not a weaker door |
| **40** | **deployed inventory matches the plan** | enumerate `netlify/functions/` and every declared path on the deployed site; diff against Part 3.3 | no function exists that the table does not list |
| **41** | **scheduled function over HTTP** | `POST` and `GET /.netlify/functions/cleanup-stale-jobs` from outside | rejected. If the platform allows the invocation, the handler's own guard must refuse it |
| 42 | **PIN lockout does not become a DoS** | lock employee A's PIN on an enrollment; employee B signs in on the same device | B succeeds; the counter keeps working |
| 43 | owner clears a lockout | admin panel clears it; A signs in | succeeds, and the lockout is visible in the log |
| 44 | **session rotation** | employee A signed in; B signs in on the same enrollment | A's session 401s; the order is attributed to B |
| 45 | **owner credential teardown** | owner signs into admin on the counter iPad, then kiosk entry | no `supabase.auth` session remains on the device |
| 46 | **offline kiosk entry is honest** | enter kiosk with the network down | UI does not claim revocation; retries; sessions die once reachable |
| 47 | **demotion** | manager signed in; owner demotes to staff | live session 401s (or loses margin) **immediately** — not at next sign-in |
| 48 | demotion made in SQL | change `employees.role` directly | same result — the trigger path is covered, not only the endpoint path |
| 49 | **idle is not refreshed by polling** | leave a tab polling `queue-list` for 61 min with no interaction | session **expires**; the poll does not hold it open |
| 50 | idle is refreshed by work | download a file every 30 min for 3 h | session stays alive until the 12 h absolute limit |
| 51 | **inconsistent session row** | attempt to write a session whose enrollment, employee and store disagree | rejected by the composite FKs; resolver also fails closed and logs |
| 52 | **ticket atomicity under injected failure** | fail the enrollment insert mid-transaction | ticket **not** consumed, no orphan enrollment, no credential returned |
| 34 | **successful counter flow** | enroll → PIN → quote → save → queue → download → complete | all succeed |
| 35 | **successful customer flow** | QR → capability → upload → register → appears in T1 queue only | succeeds; T2 never sees it |
| 36 | successful owner flow | Auth sign-in → enroll a device → revoke it → pricing publish | succeeds |

Rows 34–36 are not filler. A matrix that only proves denial will happily pass
with the app entirely broken.

### Rows 22 and 25 contradicted each other. Here is the resolution.

Revision 1 asserted in row 22 that after sign-out there is "no customer data"
in `localStorage`, and in row 25 that queued offline orders survive a
revocation. **Both cannot hold**, because the offline queue *is* customer data
in `localStorage`: `pendingTransactions` holds whole order rows
(`orderQueue.js:37`), and the active customer persists separately as
`orderCustomer` (`App.jsx:1345`). Revision 1 also offered a service-worker
generation bump as the remedy, which does not help: **the sw cache and
`localStorage` are different stores, and bumping one does not touch the
other.**

The contradiction is real and the resolution is a decision, not a wording fix.
**Queued orders win.** Losing a paid job is worse than holding a customer name
on a counter device the store controls, and silently discarding orders is the
one outcome ruled out entirely.

So, precisely:

| storage | on sign-out / kiosk entry | why |
|---|---|---|
| session cookie, CSRF value | **cleared** | credentials |
| `supabase.auth` session | **cleared** | an owner credential (Part 3.1) |
| cost caches (C3) | **cleared** | staff-only data |
| sw caches | **purged, generation bumped** | may hold customer file responses |
| `orderCustomer` | **cleared** | the customer at the counter has left |
| **`pendingTransactions`** | **kept, deliberately** | unsaved work; discarding it loses a real order |

Row 22 therefore asserts *no credential and no cost data* — **not** "no
customer data" — and names the queue as the known, deliberate exception.

**What keeping it requires.** The queue is not simply left alone:

- **Store-scoped.** Each queued row records the store it was quoted for, and
  drains **only** into that store. A device re-enrolled to another store never
  drains T1's orders into T2 — the cross-store case that makes this more than
  a cleanup question.
- **Employee re-resolved, never assumed.** A row carries the employee who
  quoted it. On drain the server verifies that employee still belongs to the
  store; if not, the order saves **flagged for attribution** rather than being
  silently reassigned to whoever happens to be signed in.
- **Idempotency keys are stable** across sign-out, revocation and re-enrolment,
  so retries after any of them still produce exactly one row (row 24).
- **Pricing version, not costs** (Part 6.2), so margin is the quoted one.
- **Never silently discarded.** If a row cannot drain, it stays queued and
  surfaces in the UI. No path deletes a queued order without saving it or
  telling someone.

The alternative — encrypting the queue under the session key — was considered
and rejected: it makes the data unrecoverable exactly when recovery matters
(revoked session, wiped device, employee gone), which trades a real
availability loss for a marginal confidentiality gain on a device the store
already controls physically.

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

# Part 10 — Scope boundaries, and the Release 1 record corrected

## Out of scope for Release 2

- **S2 custom SMTP** is a Phase S item and independent of enrollment. Staging's
  mail sink (Part 1.3 item 6) is a different requirement and is already in
  scope there.
- **S3 password recovery** is independent and still open.
- **PDF.js 4.2.67+** remains a mitigation, not a fix.
- **A separate origin for `/upload`.** The residual same-origin risk is
  recorded in Part 3.1 rather than implied away.

## Moved INTO scope by this revision

- **Durable mail limiting.** Revision 1 listed this as "a Release 2
  opportunity, not a requirement". It is now a requirement, in Part 2.6 with
  the other durable limits. A per-instance counter does not bound a mail
  endpoint any better than it bounds PIN guessing, and the store's SMTP
  reputation is what is at stake.

## Release 1 status — three corrections to the record

**Windows: the claim was stale and is withdrawn.** Revision 1 said "Windows is
still untested anywhere; no runner exists in this environment." That was true
when written and was superseded before it was published: **`1ce7849` ran
70/70 on Windows**, including the build and the manifest-injection checks.
The CRLF handling in `scripts/tests/source-util.mjs` and the `URL.pathname`
fix are therefore executed on Windows, not merely audited. What remains
untested on Windows is the *browser* service-worker upgrade check
(`scripts/manual/sw-upgrade-check.mjs`), which has only run on Linux.

**PDF rendering: owner-reported acceptance, recorded as such.** The five
`getDocument` call sites could not be exercised in this environment — the
sandbox proxy blocks cdnjs, so only Node-level parsing was proven. Ryan
confirmed preview and export across all five on the deploy preview. That is
**owner-reported acceptance testing**, which is the appropriate evidence for
"does this PDF still look right" and is not something a test suite replaces.
Recorded as a human-verified acceptance, not as an automated pass.

**Cache adoption: two different claims, only one of them verified.**

| claim | status |
|---|---|
| `print-app-v16` observed in Cache Storage on the checked counter devices | **confirmed by the owner** |
| v16 is the controlling worker on **every** counter device, and **every** pre-v16 cache holding sensitive responses is gone | **NOT established** |

The gap is real and worth keeping open rather than rounding off. `activate()`
evicts other `print-app-*` caches only once the new worker activates on that
device, and a device that has not been reloaded, or a tab left open since
before the merge, can still be running v14 with its pre-audit cache intact.
Nothing in this environment can enumerate the store's devices. So the
outstanding item is: **confirm on every counter and kiosk device that v16 is
active and no older `print-app-*` cache remains** — and until then, treat
"v16 verified" as "verified where it was checked".
