# Release 2 — moving the 17 client data paths (stage 0, slices 4–9)

**Status: PLAN ONLY. Nothing in this plan is built.** Revision 9,
2026-09-20. Revisions 2–7 accepted the findings of six review rounds
(§9). Revision 8 accepted one P2 and one wording correction from the
review of revision 7 (W1, W2) and was **accepted with no blocking
findings**; revision 9 records that, the second standalone PR, and two
wording corrections from that review (§6.2: page code can write
`localStorage`; a queue-count decrease is reconciled against acknowledged
saves). The standalone T3 fix is **shipped**: PR #46, merged to `main` at
`9937728`, live on production, so the queue module's shipped shape (`_id`
per entry, `LOCK_NAME = "pc-order-queue"`, `assignMissingIds`,
`dequeueById`, one drain in flight) is the source baseline slice 6 builds
on. The **client build stamp** the §6.2 checkpoint depends on is
**merged**: PR #47, `main` at `7ec5af4` (`src/lib/buildStamp.js`,
compiled in by `vite.config.js`, checked post-build by
`scripts/inject-sw-manifest.mjs`). This branch is rebased onto `7ec5af4`.
Merged source, live deployment and completed device checkpoints are three
separate facts; §6.2 states which are established.

**What is true of production today, stated in four separate columns**
(a corrected earlier habit of saying "production is untouched by Release
2"; four guarded routes plus four absent routes is not eight guard
passes):

| | state on production (`main` at `7ec5af4`) |
|---|---|
| **code deployed, dark** | slice 2's four functions (`staff-login`, `enroll-redeem`, `enroll-ticket-create`, `csrf-bootstrap`) are deployed and refuse with the kill switch's JSON 404. Slice 3's four exist only on this branch; on production they are **absent** (HTML 404), which is not a guard pass. `netlify/lib/release2.js` is deployed. |
| **gates verified live** | the production-ref refusal, verified 2026-09-18 on all four deployed routes (status, content type and body recorded per route). Not verified: a preview URL with and without an Origin header (that is G0's probe). |
| **migrations applied** | none from Release 2. Production's ledger ends at `phase_e_03`. Staging has 01–05. |
| **client paths enabled** | none. No client on any site calls a Release 2 endpoint; the standalone queue fix (#46) and the build stamp (#47) are client changes but not Release 2 paths. |

This is the execution plan for Part 6 of `release-2-plan.md` (the 17 paths)
and the parts of Part 7 they drive (steps 4, 4a, 4e, 5.1–5.4, 5.6), plus the
closure of C5. It does NOT cover the rest of the cost transition (4b–4d,
5.5) or the excess-grant sweep (5.7).

Everything shipped so far adds endpoints nothing calls. This is the first
work that changes what the counter does.

---

## 0. Amendments to Part 6 and Part 7

### 0.1 The unit of closure (from review finding F1)

Revision 1 sliced by **browser path and table grant**: the queue slice would
add `queue-download-url`, which loads a `pending_jobs` row by id *and* the
session's store, then signs the path stored in that row. The row lookup is
correct. **The row's contents are attacker-controlled.** `register-job`
takes `files` from the request body and inserts them verbatim, with no path
validation and no caller check — its own comment says caller validation is
"Phase B section 5". `fetch-link-job` uploads and inserts on its own with no
tenant fields at all. So a store-scoped reader built on those rows signs
whatever path a writer chose to store, and the closure is hollow.

**The unit of closure is a protected operation plus its dependencies —
the privileged writers that produce the rows it reads, and the provenance of
every stored reference it acts on. Not browser paths, not table grants.**
A slice closes an operation only when:

1. every browser path to the object has moved (Part 6's list, mechanised in
   §0.2);
2. every **writer** of the rows the operation reads either validates what it
   stores or is replaced;
3. every **stored reference** the operation will act on — a storage path, a
   file entry, an employee attribution, a cost figure — either has recorded
   provenance or has been validated or quarantined, **including rows that
   already exist**.

Applied to every slice in §1: the queue (paths written by `register-job` and
`fetch-link-job`), job files (`print_jobs.file_urls[].path` written by the
client today — the same shape as the queue), orders (employee attribution
and, in slice 9, cost figures). Revision 1's "queue before orders" ordering
was right about the chain and wrong about the direction of the queue's own
dependency; §1 keeps the order and adds the writers.

### 0.2 Step 4's "one release, all 17 paths" becomes slices; the gate is a test

Step 4's reasoning — *a partial move means a partial grant closure* — is
true of a grant and false of the client. Grants close per object, and step 5
already says so. With §0.1's definition, each slice closes exactly the
operations whose dependencies it has covered:

| operation | browser paths | writers / provenance | closes in |
|---|---|---|---|
| PIN check (`verify_employee_pin` EXECUTE) | 15 (two callers) | `employees` rows, written under the owner's JWT + RLS — trusted | slice 4 |
| sign / delete a customer file; read the queue | 4, 5, 6, 7, 8 | `register-job`, `fetch-link-job`; every existing `files[].path` | slice 5 |
| save / list orders; email a quote | 1, 2, 3, 16 | `orders-save` (new); queued-order attribution | slice 6 |
| sign / upload / delete a job file; read Job History | 9–14 | `jobs-save` (new); every existing `file_urls[].path` | slice 7 |
| create an upload (entitlement) | 17 + the kiosk | the capability | slice 8 |
| the cost figures on an order (C5) | content of 2, 3 | `orders-save` computing, not accepting | slice 9 |

**The inventory is a test, not a list, and it enumerates from what is
deployed and applied — not from source files that can be renamed or
deleted.** Revision 1 proposed enumerating tables from `create table` lines
and functions from `netlify/functions/*.js`. Both fail in exactly the case
that matters (finding F5): `orders` was created by
`alter table public.transactions rename to orders` and has no `create table`
line anywhere; and deleting `get-download-url.js` removes its basename from
discovery at the moment the prohibition on calling it begins.

`scripts/tests/release2-inventory.test.js`:

- **Tables** come from `supabase/tables.json`, a committed snapshot of
  `information_schema.tables` for `public` (and `storage.buckets`)
  generated by the same drift-check procedure that already reconciles the
  ledger, and refreshed by it. The test does not enumerate tables to grep
  for; it greps **every** `.from("<x>")` literal in `src/` and classifies
  `<x>`: a known table, a known bucket, or a failure. A rename produces a
  name the snapshot knows; a stale name (`transactions`) fails.
- **Functions** come from `netlify/functions/*.js` **plus
  `netlify/functions/_retired.json`**, the list of route tombstones (§2).
  A retired function keeps a file that answers 410 to everyone and keeps its
  name in the retired list; both are inputs to the test, so the name never
  leaves discovery. Deleting a tombstone file or its list entry fails the
  test.
- **Reach detection is not per-line** (R7). Revision 2's per-line scan
  misses `supabase.from(` with `"orders"` on the next line, and an alias
  (`const q = supabase.from; q("orders")`) defeats any textual pattern.
  Two mechanisms, both required:
  1. **A narrow gateway.** `@supabase/supabase-js` is imported in exactly
     one file today, `src/lib/supabase.js`, which exports the raw client;
     four files use it directly (`App.jsx`, `PrintQueue.jsx`,
     `UploadApp.jsx`, `storeConfig.js`). **The gateway is two files, not
     one**: `src/lib/supabase.js` and `src/lib/storeConfig.js`.
     `storeConfig.js` holds the retained owner-JWT helpers (public price
     book reads; owner writes under RLS) and legitimately needs the client
     after every slice has run, so the export restriction is: the raw
     client may be imported **only** by `storeConfig.js`; `App.jsx`,
     `PrintQueue.jsx` and `UploadApp.jsx` lose their imports at their
     slices' D (allowlisted until then); no other file may ever import it.
     The test asserts the package import exists only in `supabase.js`, the
     client identifier is referenced only inside the two gateway files
     (plus allowlisted files until their slice), and nothing else in `src/`
     names it.
  2. **A real parser inside the gateway** (the reviewer's choice over
     textual matching). `acorn` **plus `acorn-jsx`** as devDependencies —
     every scanned file in `src/` except the two gateway modules is `.jsx`,
     so a parser without JSX support would fail on the very files the
     inventory has to read — the suite's
     zero-dependency property is traded for AST-level certainty on the two
     files that matter. The scan walks `CallExpression` nodes whose callee
     is a `MemberExpression` with property `from`, `rpc` or `channel` on
     the client (or on `client.storage`), takes the first argument, and
     **fails** unless it is a string `Literal` — a variable, a template
     literal with expressions, or a computed value is a failure, not an
     unknown. It also fails on any `MemberExpression` naming those
     properties that is **not** the callee of a call (aliasing:
     `const q = supabase.from;`), on destructuring of the client
     (`const { from } = supabase`), and on **computed access**
     (`supabase["from"]`, `supabase[m]`). Function names: string literals
     anywhere in `src/`, from the AST of every file.
  The **mutants that must fail**, each a test: the literal on the next
  line; the aliased method; the destructured method; computed access with
  a literal and with a variable; a variable table name; a template-literal
  table name; the client imported by a third file; a `.from` call on a
  variable that was assigned the client.
- **Allowlist in the test**, each entry tagged with the slice whose stage D
  removes it, or `auth-jwt` for the owner-JWT helpers that stay. Run today
  it finds every reach site behind Part 6's 17 rows (sites, not rows: rows 2
  and 3 share `supabase.js:388`, rows 12 and 13 share `:201`, the drain in
  `orderQueue.js` takes its insert function as a parameter), the three
  `employees` helpers, **and the two kiosk callers** at `App.jsx:5448,5459`
  that Part 6 missed because `callQueueFn("start-upload", …)` assembles the
  route from a template and the literal URL never appears.

**Every gate is falsified before it is trusted** (F5). A companion
`release2-inventory.mutation.test.js` copies `src/` to a temp dir, injects
one forbidden reach of each kind — a `.from("orders")`, a
`"get-download-url"` literal, a `supabase.storage` chain, a stale table
name — and asserts the inventory check **fails** on each; it also deletes a
tombstone entry and asserts failure. A gate that has never been seen to fail
has not been shown to gate anything. The same rule applies to the
behavioural tests in §6: each is paired with the mutation that must make it
fail.

### 0.3 The kiosk needs three credential classes

The kiosk device is enrolled (an owner pairs it), so kiosk exit is a PIN
sign-in and kiosk entry revokes sessions. Its customer-facing action —
sending a job to the counter — is an **upload**, which needs an upload
capability. A kiosk therefore holds `__Host-pc_device` always,
`__Host-pc_staff` while a staffer has exited kiosk mode, and mints
`__Host-pc_upload` per customer submission. Each endpoint consults only its
own class, and `csrf-bootstrap` hands out the token **for the class asked
for** (§8), not merely the highest class present.

---

## 1. Slicing

| slice | paths | what the counter gains | what closes |
|---|---|---|---|
| **0 — production light-up** *(its own review round, §4)* | none | Release 2 exists on production; nothing calls it | nothing — it opens the endpoints, behind a verified deployment context |
| **4 — identity at the counter** *(§5)* | 15 | PIN sign-in through `staff-login` on an enrolled device; sign-out; kiosk entry revokes server-side; sessions expire; owner pairs and revokes devices | **S1**: `verify_employee_pin` EXECUTE revoked (5.6) |
| **5 — queue: provenance, writers, staff side** *(§6.1)* | 4, 5, 6, 7, 8 | uploads get allocation records; `register-job` and `fetch-link-job` store only allocated paths and stamp the tenant; existing rows validated or quarantined; queue tab and badge poll; download and complete by opaque file id | 5.2; the legacy signer and deleter tombstoned (4e) |
| **6 — orders and email** *(§6.2)* | 1, 2, 3, 16 | orders through staff endpoints; drain idempotent, original store and employee preserved; margin server-gated by role; email needs a staff session | 5.1; `send-print-job` authenticated (4a, part) |
| **7 — jobs and job files** *(§6.3)* | 9–14 | job-file uploads allocated; existing `file_urls` validated or quarantined; download by opaque id; path 14 deleted | 5.3, 5.4 |
| **8 — customer upload capability** *(§6.4)* | 17 + kiosk | `/upload` and the kiosk mint a capability; the three writers require it | 4a (`resolveUpload` ×3) |
| **9 — C5: cost and margin computed server-side** *(§6.5)* | content of 2, 3 | `orders-save` computes from the price book at the order's `pricing_version`; client figures accepted and ignored | the browser's ability to write the store's margin history |

**Order.** 0 alone. 4 first because every staff endpoint needs the staff
cookie. 5 next because customer files are downloadable by anyone today — and
now with its writers, because a reader on unvalidated rows closes nothing.
6, 7 follow. 8 is independent of the staff cookie and can run alongside 6–7
once 5 has landed; it changes the customer's page. 9 sits immediately after
the cost substep's 4b and is tracked here so it cannot slip silently.

**Stays:** the employee-management and store-config writers
(`listEmployees`, `createEmployee`, `updateEmployee`, `publishStoreConfig`,
the rest of `storeConfig.js`) run under the owner's JWT and RLS; allowlisted
`auth-jwt`. Note for the cost substep: `storeConfig.js:41–50,82` use
`select("*")` on `stores` and `sheet_prices`; step 5.5's column privileges
will break those until they name columns.

---

## 2. The stage sequence, defined once

**Principle: no runtime fallback.** "Dual-path" means both implementations
are in the bundle, selected by a **build-time flag per slice**
(`VITE_R2_IDENTITY`, `VITE_R2_QUEUE`, …). The client never tries the
endpoint and falls back to the direct path. A fallback makes an unenrolled
device, an expired session or a wrong-store refusal *succeed* through the
door the release is closing, and for writes can insert twice; a slice's
confirmation is only evidence if every observed request went through the
new path. Netlify env vars are per site, so staging runs a slice ON while
production runs it OFF from the same commit.

**Retained handlers are dual-mode with separate activation** (F4). Where a
slice adds authentication or provenance to a handler the flag-OFF client
still calls (`send-print-job`, `start-upload`, `register-job`,
`fetch-link-job`, and the legacy signer/deleter before they are
tombstoned), stage A ships the handler with **both** branches and a
server-side activation variable (`RELEASE2_ACTIVATE_<HANDLER>`), OFF. Stage C
flips the handler's activation together with the client flag, in one
redeploy. Stage D deletes the unauthenticated branch. Without this, stage A
would break every flag-OFF client — which is every production client.

**Route tombstones, not deletions** (F5). A retired function's file is
replaced by a handler that returns `410 Gone` to every request, with no
imports and no client, and its name is added to `_retired.json`. The URL
stays discoverable and refused; the inventory test keeps forbidding its
name in `src/`. Part 7's rollback section already names a 410 tombstone as
valid closure.

| stage | what lands | who confirms | rollback | class |
|---|---|---|---|---|
| **A — additive, server** | new endpoints; additive migrations, each rehearsed with real rows in `begin … rollback`, applied, ledger read back, file placed; dual-mode retained handlers, activation OFF; **provenance backfill and quarantine of existing rows where the slice needs it** | staging probes | redeploy previous functions; additive schema stays. A refuses nothing a flag-OFF client sends (slice 5's `register-job` accepts and quarantines the old shape; refusal activates at C). The one thing A's rollback cannot undo is data: quarantine verdicts on existing rows stay — see §7 | not an incident (data verdicts recorded) |
| **B — deploy, dual-path** | client carries both paths; flag ON for staging, OFF for production | staging: probe doc + the slice's checklist | none in production — legacy runs | — |
| **C — counter-confirm** | client flag ON **and** the slice's handler activations ON for production, one env change plus manual redeploy | **the owner at the real counter**, then a soak | flags OFF + redeploy. Cheap for the client; **reopening for any handler C activated** — see §7 | per §7 |
| **D — tighten, client and routes** | legacy client path and flag deleted; unauthenticated handler branches deleted; retired routes tombstoned; the slice's inventory entries removed | inventory test green; row 40 shows the old URLs 410; short soak | redeploy the stage-C build — which still has activation ON, so nothing reopens | not an incident |
| **E — tighten, grants** | the step-5 migration for the object, `.rollback.sql` captured verbatim beforehand; step-6 denial probes run immediately | denial probes green; counter working | restore the policy = **reopening**. Full Part 7 Rollback contract | incident |

**Why D and E are separate.** D is the last moment the grant rollback is
unspent. Running the legacy-free client at the counter before closing the
grant means the grant closure changes nothing the counter can observe. If it
breaks something, that something reached the table by a path the inventory
did not enumerate — the finding step 5 exists to surface.

**Soak lengths.** C: three business days including one weekend day (the
kiosk sees different traffic on a Saturday). D: one business day. Measured on
the function logs: no 5xx, no limiter 503, 401 rates consistent with PIN
mistakes, no request to a tombstoned route except probes.

---

## 3. The gates

| gate | between | passes when |
|---|---|---|
| **G0 — production lit** | stage 0 and every client slice | migrations 01–05 in production's ledger with files named and byte-identical; deployment-context check in place (§4); Phase 1 probes green on production; a preview deploy **refused with 404 by a curl carrying no Origin**; inventory test proves nothing in the client calls an endpoint yet |
| **G-staging** (per slice) | B and C | the slice's staging probes and checklist green, DB agreeing |
| **G-counter** (per slice) | C and D | the owner has run the slice's checklist at the counter; C soak complete |
| **G-inventory** (per slice) | D and E | inventory test green with the slice's entries removed; mutation test green; row 40 shows tombstoned routes 410; D soak complete |
| **G-denial** (per slice) | E and the next slice | step-6 probes for the closed object green: direct path refused *and* the counter works |

Each gate's test has been **seen to fail** under its mutation before it is
relied on (§0.2). Gates marked "owner" are owner-run; the rest are
reproducible from the repo and the probe doc.

---

## 4. Stage 0 — Release 2 reaches production. Its own review round.

Nothing in Release 2 runs on production today: `release2Allowed()` refuses
on the production ref. Stage 0 is the moment that changes, and it is a
different risk class from every client slice: the client slices change
which door the counter uses and roll back by flag; stage 0 changes whether
the doors exist on production at all, puts five staging-only migrations into
the production ledger, and is the first time service-role-backed endpoints
sit in front of the production database. It ships alone, is confirmed
alone, and no client slice's stage B starts until G0 passes.

### 4.1 Origin is not a deployment boundary (F2)

Revision 1 said deploy previews would be kept off the endpoints because
`originOk()` reads `env.URL` first and refuses a preview's Origin. That is
wrong twice over: **`originOk()` returns `true` when there is no Origin
header** — that is by design, it is a CSRF check for browsers — so any
non-browser request to a preview URL passes it; and Origin is
client-supplied in any case. A preview deploy of the production site runs
with the production service-role key, so removing the ref refusal with
nothing in its place would put an unauthenticated route to production
Supabase on every PR. `originOk()` stays exactly what it is — the CSRF
discipline for browser calls — and is not asked to be a boundary.

**Replacement, before the ref refusal is removed:** `release2Allowed()`
requires a **verified deployment context**, read from facts Netlify fixes at
build time and no request can influence:

- **The transport is a bundled, immutable file, not a runtime variable**
  (R4). `CONTEXT` is a **build-time** variable; Netlify documents only
  `URL`, `SITE_NAME` and `SITE_ID` as predefined at function runtime, so
  `process.env.CONTEXT` inside a handler is not guaranteed and, as revision
  2 was written, its absence would have 404'd production itself. Instead a
  build step (`scripts/write-deploy-context.mjs`, run from the `build`
  command before Vite) writes `netlify/lib/deploy-context.json` —
  `{ context, siteId, siteName, deployId, commitRef, builtAt }` from the
  build environment — and `netlify.toml`'s `included_files` (already
  load-bearing, see CLAUDE.md) ships it inside every function bundle.
  `release2Allowed()` reads that file; it is fixed at build and cannot be
  changed by a request, an env edit, or a redeploy of the same build.
  `context` must be in `RELEASE2_CONTEXTS` (default `production`). The
  staging site builds its branch *as* its production context, so it
  passes; a preview of either site does not. A bundle with no file, or a
  file with no `context`, **refuses** — fail closed, never fail open.
- `RELEASE2_ENABLED=true` is set with **scope: Functions** and **context:
  Production** in the Netlify UI, so it is read at function runtime (the
  scope) and absent from preview deploys (the context).

Two independent facts of different kinds — stated precisely, because
revision 3 called both "build-time" and the second is not: the bundled
file is a **build-time fact**, immutable for the life of the bundle; the
flag is a **runtime value** that the platform scopes to Functions in the
production context, so it is present at runtime only where the platform
put it and no request can supply it. Absence of either → 404. **Proven before the ref guard is
lifted**: a read-only `deploy-context` function that returns the bundled
metadata (no secrets) is deployed first, and the recorded evidence is (a)
production: `{ context: "production", siteName: "printcalculator2", … }`;
(b) a deploy preview of production: `{ context: "deploy-preview", … }`;
(c) staging: `{ context: "production", siteName: "printcalculator2-staging" }`;
(d) `RELEASE2_ENABLED` readable from a production function and absent from
the preview's. Only with all four in hand is the `PRODUCTION_REF` refusal
deleted. `netlify dev` bundles `context: "dev"`, so local work needs
`RELEASE2_CONTEXTS=production,dev` set locally, deliberately. `release2-guard.test.js`
loses "refuses on the production ref" and gains: refuses when `CONTEXT` is
`deploy-preview` or absent even with the flag; refuses when the flag is
absent even in `production`; allows only both. The header comment is
rewritten to describe this (comment discipline).

### 4.2 Steps

1. **Migrations 01–05 to production**, one at a time, in ledger order, each
   read back and its file moved out of `pending/` under the assigned
   version, byte-identical to `statements[1]` (the trailing-newline
   transport difference in `staging.md` §2 is checked, not assumed). 03 must
   follow 02.
2. **Rehearse 03, 04 and 05 on production** in `begin … rollback` with
   synthetic rows created inside the transaction. Same proofs as staging,
   including 05's P5b. A migration rehearsed only on staging has not been
   rehearsed against the data it will run on.
3. **Env on the production site**: `RELEASE2_ENABLED=true` (Functions
   scope, production context only),
   `RELEASE2_ALLOWED_ORIGINS=https://printcalculator2.netlify.app`,
   `RELEASE2_CONTEXTS=production`. **And the "older deployments" writer
   class, bounded honestly** (§6.1, T1). Today every deploy preview and
   branch deploy of the production site runs the *legacy* functions — not
   Release 2 gated — against production Supabase with the production
   service key. Revision 4 said scoping `SUPABASE_SERVICE_ROLE_KEY` to the
   production context would make that class "gone". **It does not.**
   Netlify snapshots environment values per deploy and function bundles
   are immutable, so an old preview permalink keeps running its old
   `register-job` with the key it captured at build; and historical
   **production** permalinks (`<deploy-id>--printcalculator2.netlify.app`)
   were never previews and are outside the scoping entirely. The bounded
   claim is: **future** previews and branch deploys lack the key, and
   their legacy handlers refuse with the existing guard. Everything already
   built keeps its key until the key itself is invalid. So:
   - **Inventory the immutable URLs** — every historical production
     deploy, every preview and branch deploy, every alias — from the
     Netlify API, into `docs/security/deploy-inventory.md`, refreshed at
     each cutover. **Every legacy function is a separately bundled route
     with its own captured environment**, so the inventory lists, per
     deploy, each of `register-job`, `start-upload`, `fetch-link-job`,
     **`get-download-url` and `complete-job`** — the legacy signer and
     deleter — and each is probed on its own. `register-job` refusing on
     an old deploy proves nothing about that deploy's signer.
   - **Retirement mechanisms, exactly three** (U2). Revision 5 listed
     "lock" among them; a **locked** Netlify deploy pins the *published*
     version and stops automatic publishing — the permalink keeps serving.
     Locking is withdrawn. What retires a URL is: (1) **deletion** of the
     deploy through the API, after which the permalink 404s — verified by
     probing it; (2) a **specifically verified access restriction** — a
     control that is applied and then shown, by probing the exact
     permalink, to refuse it (a site-wide restriction counts only once the
     probe shows the permalink itself refused); or (3) **revocation of the
     credential the bundle captured**. **The action taken is recorded per
     retained URL** in the inventory, with the probe result and its date.
   - **The credential, named** (U2). What the functions hold in
     `SUPABASE_SERVICE_ROLE_KEY` is, on production today, to be
     established in the rehearsal, not assumed: either the legacy
     `service_role` **JWT** (one of the project's two JWT-based API keys,
     revocable only by disabling JWT-based keys for the whole project) or
     a newer **secret API key** (`sb_secret_…`, individually creatable and
     revocable on the project's API Keys page). The procedure, **rehearsed
     on staging first** and recorded step by step: (a) create a new secret
     key; (b) set it as `SUPABASE_SERVICE_ROLE_KEY` for Functions in the
     production context; (c) a **fresh build** — not a republish — and a
     probe that every legacy function on the new deploy works; (d) revoke
     the old: delete it if it was a secret key; if it was the legacy JWT,
     first confirm the production **client** no longer uses the legacy
     `anon` JWT (staging already uses `sb_publishable_…`; production's
     `VITE_SUPABASE_ANON_KEY` is checked and migrated first, because
     disabling JWT-based keys disables both), then disable JWT-based keys;
     (e) probe every inventoried old URL with readback; (f) confirm
     `supabase-js` accepts the secret key for `createClient` under the
     service path — on staging, with a readback, before production.
     Rotation is the only control that reaches a permalink nobody can
     delete.
   - **Rollback consequence, stated**: "publish an old deploy" republishes
     an immutable bundle with its **captured** key, which is now revoked,
     so its functions fail. After rotation, every rollback is a **fresh
     build of the old commit**, never a republish. Part 7's rollback
     contract gains that line.
   - **Probe the exact old URLs with readback**, not a status code: call
     each inventoried legacy `register-job` with a marker customer name and
     a fabricated path, then read `pending_jobs` for the marker and
     `storage.objects` for the path — nothing written. A generic 500 does
     not say which control refused (missing key, revoked key, or a bug),
     and the readback is what proves the write did not happen.
   - **Re-run after every rollback rehearsal**, not once at stage 0: a
     rollback that republishes anything reopens exactly this class.
4. **Code**: §4.1's context check lands first; the ref refusal is removed
   in the same change, after it.
5. Deploy. Phase 1 on production: four uniform 401s. Then the positive
   probes with real rows: an owner mints and redeems a ticket on a scratch
   device, signs in a real PIN, logs out, revokes the device, with the
   database read back. The scratch enrollment stays in the audit trail,
   revoked.
6. **Preview refusal, proven not assumed**: a `curl` with **no Origin
   header** to a deploy-preview URL of the production site → 404. A second
   curl with the staging Origin → 404. Third, the inventoried legacy URLs
   (step 3) each probed with a marker name and a fabricated path, with the
   `pending_jobs` and `storage.objects` readback showing nothing written —
   recorded per URL, not as one status code.

**Rollback of stage 0:** `RELEASE2_ENABLED=false` + redeploy → every endpoint
404s. Migrations stay: RLS on, zero policies, service-role only. Not an
incident, but a reversal of a reviewed decision, recorded as such.

---

## 5. Slice 4 — identity at the counter, and S1

### 5.1 Stage A

No new endpoints. Two changes to `csrf-bootstrap`:

- **Class-specific bootstrap** (contract correction 1): `GET
  csrf-bootstrap?kind=staff|device|upload` returns the token for **that**
  class if its cookie resolves, else 401. Without `kind`, the current
  staff-then-device order. Needed because classes coexist on one device
  (§0.3): a kiosk that has exited to staff mode still needs the upload
  class's token for a customer submission, and a tab holding a staff
  session cannot otherwise recover the device token (the 3f shape,
  generalised). Each endpoint compares only against its own class's secret.
- The `staff` branch also returns `employee: { id, name, role }` — display
  state for a reloaded tab; the authority for margin *data* stays with the
  endpoints that read the session row. **Put to the reviewer** against a
  client-side cache that C3 would then have to clear.

### 5.2 Stage B — client, behind `VITE_R2_IDENTITY`

New `src/lib/release2Client.js`, the only module that knows endpoint names:
`call()`, in-memory `csrf` per class, the **401 contract** (401 → bootstrap
for the class → retry once, or raise the PIN prompt, or "this device isn't
paired"; never a fallback), `bootstrap(kind)`, `login(pin)`, `logout()`,
`kioskEnter()`, `pairDevice(label)`, `listDevices()`, `revokeDevice()`.

Behind the flag: `EmployeeLogin` uses `login(pin)` for staff sign-in and
kiosk exit; boot calls `bootstrap()` and `currentEmployee` comes from it —
never written to `localStorage`, and the existing key is deleted on
upgrade; sign-out → `logout()`; kiosk entry → `kioskEnter()` with the badge
reading **"not confirmed"** until the 200 arrives; session expiry raises the
PIN prompt over the current screen with React state intact; Admin gains a
**Devices** section (pair, list with live counts and reasons, revoke with a
bounded reason); owner sign-in on a kiosk-enrolled device warns.

`yarn dev` cannot exercise the endpoint path (`__Host-` needs HTTPS);
flag OFF keeps local dev on the legacy path until D. Recorded so nobody
weakens cookie attributes for localhost.

Tests: the 401 contract on a fake `fetch`; flag ON → no `.rpc(` reaches
`verify_employee_pin`; "not confirmed" until 200; `kiosk-guard` green;
each paired with its failing mutation.

### 5.3 Stage C — counter checklist (owner)

1. Owner pairs the counter iPad and both kiosks; the list shows three.
2. Staff PIN signs in on each; manager sees margin, staff does not.
3. Six wrong PINs on one device → locked; a second device still signs in.
4. Reload mid-quote: still signed in, quote intact.
5. Sign out → PIN prompt; sign in as a different employee.
6. 61 idle minutes → PIN prompt on next action; quote intact.
7. Kiosk entry "not confirmed" until the server answers; a second staff
   tab's next action prompts for a PIN; kiosk exit by PIN.
8. Owner revokes a device; it says "not paired"; owner re-pairs it.
9. Supabase unreachable: pricing works; sign-in fails as today.
10. Queued-order handover: unchanged in this slice, recorded as not
    exercised.

### 5.4 Stage D

Delete `findEmployeeByPin`, the legacy branches, the flag,
`getStoredEmployee`; remove path 15 from the allowlist — the test is now the
"grep before revoking" that the 2026-08-31 outage lacked, kept green
forever. `release2-pin-parity.test.js` stays.

### 5.5 Stage E — S1 closes

`release2_06_revoke_pin_rpc_execute.sql`: revoke EXECUTE on
`verify_employee_pin(uuid, text)` from `anon`, `authenticated`;
`service_role` keeps it; a `DO` block asserts PUBLIC is absent first.
Rollback = the body of `20260909160307_restore_pin_rpc_execute_for_app_roles.sql`.
Not dropped. Denial: anon and authenticated `rpc()` → 42501; `staff-login`
still 200. Then CLAUDE.md's PHASE S section and the gotcha are updated.

---

## 6. Slices 5–9

### 6.1 Slice 5 — queue: provenance, writers, staff side (paths 4–8)

**What is wrong today, precisely.** `start-upload` mints a path and records
nothing. `register-job` inserts `files[]` from the body verbatim — any path,
any count — and resolves the store from a body slug. `fetch-link-job`
uploads and inserts on its own with **no `store_id`/`org_id`** (both
nullable, so it succeeds and the row is invisible to any store-scoped
reader) and numbers by a **global** `count(*)+1`. `get-download-url` signs
any path in the bucket. `complete-job` deletes any row and the paths it
holds. `cleanup-stale-jobs` sweeps old rows, never orphan objects. A reader
that trusts `files[].path` inherits all of it.

**A — additive, server.**

- Migration `release2_07_upload_allocations`: table
  `upload_allocations (id uuid pk, bucket text, path text unique, store_id
  uuid, org_id uuid, capability_id uuid null, expected_name text, max_bytes
  int, source text, created_at, consumer_kind text null check (consumer_kind
  in ('pending_job','print_job')), consumer_id uuid null, consumed_at
  timestamptz null, released_at timestamptz null, expired_at timestamptz
  null, object_removed_at timestamptz null, remove_attempts int not null
  default 0)`. RLS on, zero policies.
  **Typed consumer link, no foreign key** (R6): revision 2's `consumed_by
  uuid references pending_jobs` could not also point at a print job (slice 7
  shares the table) and would have blocked `complete-job` from deleting a
  referenced queue row — or, with `on delete set null`, would have turned a
  completed allocation back into a consumable one. **The state machine is
  one-way and nothing is ever replayable:**
  `allocated` (all three timestamps null) → `consumed` (`consumed_at`,
  `consumer_kind`, `consumer_id` set, in the registration function) →
  `released` (`released_at` set when the consumer is completed or cleaned
  up). `expired_at` is set by the sweep on an allocation never consumed.
  The **only** consumable state is `consumed_at is null and expired_at is
  null`; consumption sets `consumed_at` under `for update` and no code path
  clears it.

  **Expiry claims the allocation atomically BEFORE any storage I/O** (S2).
  Revision 3 had the sweep remove the object and then set `expired_at`, so
  a registration could consume a still-unexpired allocation while the
  delete was in flight and acknowledge a job whose file then vanished. The
  completion path already had the right order; expiry now uses it. A SQL
  function `release2_expire_allocations(p_older_than)` selects `allocated`
  rows older than the threshold `for update skip locked`, sets
  `expired_at`, and returns their paths; only then does the sweep remove
  the objects, setting `object_removed_at` on success and retrying on the
  next run while it is null. Under that discipline a concurrent registration
  either consumed first (expiry then sees `consumed_at` and skips) or expiry
  won (consumption fails with "upload expired — please upload again"); an
  acknowledged job never loses its file.

  **The full set of allowed states**, enforced by a CHECK constraint so an
  impossible combination cannot be written:

  | state | `consumed_at` | `released_at` | `expired_at` | `object_removed_at` |
  |---|---|---|---|---|
  | allocated | null | null | null | null |
  | consumed | set | null | null | null |
  | released | set | set | null | null, then set |
  | expired | null | null | set | null, then set |

  Anything else — released without consumed, expired and consumed, expired
  and released, removed while allocated or consumed — is rejected by the
  constraint. Removal of an object happens **only** from `released` or
  `expired`, and only through the record.

  **Ordering on completion**: (1) mark the row's allocations released
  (under the same lock), (2) remove the objects, (3) delete the row. A
  crash after (1) leaves released allocations whose objects the sweep
  removes; a crash after (2) leaves a row that `queue-list` shows as
  "completing" and a retried complete finishes idempotently. **The sweep**
  (`cleanup-stale-jobs`) runs `release2_expire_allocations` at three hours
  (past the two-hour token), then removes objects for `expired` and
  `released` rows with `object_removed_at` null. `pending_jobs.files[]` entries
  gain **`fileId`** = the allocation id (contract correction 4): a **stable
  opaque identifier**, minted by the server, never a filename.
- `start-upload` (dual-mode, activation OFF in A but the allocation is
  always written): allocates before signing, returns `{ allocationId, path,
  token }`. The path is still returned — the client must upload to it and
  hand it back — so the contract says **"download and complete never accept
  a path, and a row can reference only an allocated one"**, not "no path in
  any response" (contract correction 3; revision 1's claim was false on its
  face, `start-upload` has always returned one). The signed upload token's
  lifetime is **Supabase's, fixed at two hours for `createSignedUploadUrl`,
  not a parameter we set** (contract correction 2; revision 1's "5 min" was
  invented). The bound on an allocation is therefore the record, not the
  token: single-use, `max_bytes`, and swept.
- `register-job` — **old shape accepted and quarantined at A; refused from C.**
  The flag-OFF callers of `register-job` are not the staff client: they are
  `UploadApp.jsx` and the kiosk's Send-to-counter sheet, and both post
  `files[]` built the old way, `{ name, path, size, type }`. Every path
  they post after A deploys carries an allocation, because the new
  `start-upload` wrote one before issuing it — so the old shape is matched
  to its allocation by exact `path` and verified like the new shape.
  **Three classes of caller can present a path with no allocation**
  (revision 3 named only the first, which was wrong): a legitimate customer
  mid-flow at the deploy moment (path issued by the old `start-upload`);
  **any public caller**, since `register-job` is unauthenticated until
  slice 8 and a body path can be fabricated; and **older deployments** —
  any immutable historical deploy (production permalinks included) running
  pre-slice-5 handlers with a captured key against the same database. The
  first is served safely as below; the second is refused from C and, until
  then, produces a row whose entries are marked `unverified` and which is
  never claimable (§ existing rows); the third is **bounded, not closed**,
  by §4.2 step 3 — future deploys lack the key, historical ones are
  inventoried, retired where possible, and otherwise cut off by rotating
  the key, with readback probes re-run after every rollback rehearsal.
  Until rotation, an unvalidated row from an old deploy is possible. **It
  carries no provenance mark at all** — an old handler contains no such
  code, and revision 5 was wrong to say it would land as `unverified`.
  Two things make that safe: **new readers treat missing provenance as
  untrusted** — a `files[]` entry with no provenance record is never
  signed, deleted or claimed, exactly as a `suspect` one — and an explicit
  **DB mechanism** adds the mark for rows no new handler wrote: an `AFTER
  INSERT` trigger on `pending_jobs` (and `print_jobs`) that writes a
  provenance row `unverified` for every entry whose path has no allocation
  at insert time. The new `register-job` marks its own rows; the trigger
  catches everyone else's. **The reader's denial is the gate and is
  mandatory on its own**: a reader denies on *missing* provenance whether
  or not the trigger exists or fired — the trigger adds evidence for the
  recovery view, it is not what protects the signer. A reader that
  required the `unverified` mark before denying would trust every row the
  trigger missed. The test asserts denial on a row with no provenance
  record at all, with the trigger absent. Revision 2 let the deploy-moment
  request fail;
  that is a customer-facing failure at a deploy moment — F4's failure mode
  reappearing inside F1's fix — and the safe form costs nothing. So:
  - **At A**, an entry with an allocation (by `allocationId`, or by exact
    `path` for the old shape) is verified against the object, consumed
    atomically, and given its `fileId`. An entry with a path and **no
    allocation** is accepted only if the path matches the writer's pattern
    and the object exists; the row is then written **quarantined**
    (`quarantine_reason = 'unallocated path at registration'`, the entry
    marked `provenance: 'unverified'`). The customer sees success and the
    counter sees the row. The new endpoints never sign or delete a
    quarantined entry; the legacy signer, which is what the flag-OFF counter
    uses until C, still serves it. Between A and C the only rows that can
    be quarantined this way are deploy-moment ones, and they are served and
    completed through the legacy path like any other.
  - **At C**, `RELEASE2_ACTIVATE_REGISTER_PROVENANCE` flips with the client
    flag: an entry with no allocation is **refused** (400, the existing
    "ask the counter" message) and nothing is written. Every path in flight
    at that moment carries an allocation, so nothing is refused that was
    issued by this deployment.
  - **The old `{ path }` shape stays until slice 8's D** (R2), under the
    same checks as `allocationId`; see this slice's D and §6.4.

  In both modes the row's `files[]` is built **from the allocation
  records**, never from the body, and the tenant comes from the allocation,
  never from the body slug. The verify-and-consume is a SQL function,
  rehearsed, so a concurrent second registration of the same allocation
  fails on `consumed_at`.
- **`fetch-link-job` gets its own migration and treatment** (F1): it
  allocates through the same record, stamps `store_id`/`org_id` (from
  `STORE_SLUG` until slice 8 gives it a capability), numbers per store per
  day by `max+1` like `register-job` with the same 23505 retry, and registers
  through the same SQL function. A **link-import acceptance test**: a public
  Google Doc URL produces one row with tenant fields set, a store-scoped
  queue number, and one allocation-backed `fileId`; a non-Google URL is
  refused; a private doc is refused with the sharing message.
- **Existing rows: screened, never trusted by inference; adjudicated by
  an authority** (R1, R3). Revision 2 backfilled trusted allocations for
  rows whose paths matched the writer's pattern, whose objects existed, and
  whose `store_id` was non-null. **None of those three is evidence of
  ownership.** The pattern is the writer's, not the tenant's; existence
  proves only that *some* upload happened; and `store_id` was written by
  `register-job` from a body slug the caller chose. A poisoned row — one
  registered against another customer's live object — passes all three, and
  the backfill would have converted the poisoning into a trusted record,
  which is worse than leaving it untrusted. So:
  - **What the migration does to rows: nothing.** `files` is **never
    replaced with `[]`** (revision 2 did, and that alone broke the flag-OFF
    counter — `PrintQueue.jsx:110` maps `files[].path` for Open Files and
    `:127` takes `files[0].path` for Send to Calculator; with `[]` there is
    nothing to hand the legacy signer). The original references stay
    exactly as stored, in place, and are **protected**: the new endpoints
    act only on allocation records, and no legacy row has one until it is
    adjudicated.
  - **The screen**, recorded per row and per entry in a new
    `pending_jobs_provenance` table, not inferred into trust: (a)
    `object_exists`; (b) `sole_reference` — no other `pending_jobs` or
    `print_jobs` row references the same path; (c) `co_created` — the
    object's `storage.objects.created_at` falls within the two hours before
    the row's `created_at` (the token lifetime; the legitimate flow uploads
    then registers within minutes); (d) `tenant_present`. A row failing (b)
    or (c) is the poisoning shape and is marked `suspect`; the rest are
    marked `legacy-unadjudicated`. Neither mark is trust. The rehearsal
    prints every verdict before anything commits.
  - **Independent ownership evidence, named.** There is none in the data.
    No path carries a tenant; no object carries an owner (service-role
    uploads have `owner = null`); the row's `store_id` is caller-chosen.
  - **First claim is not ownership** (S1). Revision 3 let a store owner
    claim any unadjudicated row, refusing only a path *already* allocated.
    A poisoned row is unallocated by construction, so whichever owner
    claimed first would win and the genuine owner's later claim would be
    the one refused. Being T1's owner is authority over T1; it is not
    authority over an object of unknown ownership. **The authority model,
    decided by the dataset, not by who arrives first:**
    - The migration classifies the legacy dataset in a `DO` block and
      records the verdict in `pending_jobs_legacy_dataset (mode, store_id,
      decided_at, decided_by, attestation)`: **`single-store`** only if
      the **whole historical dataset** names one store — not today's store
      count. **Revision 5's predicate was wrong on exactly the
      configuration it exists to recognise** (U3): it unioned every
      `store_id` with every `org_id`, and `stores.id` and `stores.org_id`
      are distinct UUIDs, so one store already yields two members and the
      check could never say `single-store`. Fail-closed, but it broke the
      owner recovery path. The check now normalises **through the real
      relationships**, in three separate steps, and never mixes value
      kinds:
      1. **Canonical store ids.** The set of distinct `stores.id`, plus
         every `store_id` value in `memberships`, `pending_jobs`,
         `print_jobs`, `orders`, the archive table, `upload_allocations`
         and every Release 2 table. A `store_id` that is not in `stores`
         is an **unknown**, listed, never dropped. `single-store` requires
         this set, unknowns aside, to have exactly one member.
      2. **Org mappings, validated separately.** Every `stores.org_id`
         resolves to an `organizations` row, and every row carrying both
         `store_id` and `org_id` agrees with its store's `org_id`. A
         mismatch is an unknown, listed. The org count is **not** part of
         the store-count predicate.
      3. **Slugs resolved through the trusted mapping.** Storage path
         prefixes that look like slugs (the seed's
         `<slug>/synthetic.pdf` shape) are resolved to `stores.id` through
         `stores.slug`; a prefix that resolves to no store is an unknown,
         listed with the object. Strings are never unioned with UUIDs.
      **Unknowns stay unknown**: any unknown in steps 1–3 forces
      `multi-store`-style operator adjudication for the affected rows or
      objects, whatever the store count. Otherwise **`multi-store`**. The
      operator confirms the verdict **and attests** that no other tenant's
      data was ever loaded into this project — recorded in `attestation`
      with their identity — before the migration is applied (the rehearsal
      prints all three sets and the unknowns). **The rehearsal proves the
      predicate on a fixture set, not a fixture**: staging (two stores)
      must classify `multi-store`; a scripted single-store copy must
      classify `single-store` — the case revision 5 could not produce;
      and a scripted copy carrying **a null-store row and a row whose
      `org_id` is foreign or resolves to no organization** must surface
      both as **unknowns** that force adjudication, so the separate org
      check cannot be satisfied by omission — a predicate that never sees
      an unresolved org has not been shown to catch one.
    - In **`single-store` mode** the one question — which tenant — has
      exactly one possible answer, and the store's owner adjudicates the
      remaining question, whether the reference is intact, through the
      recovery view: `queue-legacy-list` (owner JWT; `customer_name`,
      `created_at`, `queue_number`, `source`, file names and sizes, the
      screen verdicts; **never a path**), `queue-legacy-claim { jobId }` and
      `queue-legacy-discard { jobId }`. A claim is granted only for a row
      whose every entry passed the screen (`object_exists`,
      `sole_reference`, `co_created`); a row with any `suspect` entry
      **cannot be claimed by anyone** — it is quarantined for re-upload
      (the counter asks the customer to submit again) or operator disposal.
      Null-store rows (every `fetch-link-job` row) are claimable here,
      because there is one store. `store4979` is in this mode.
    - In **`multi-store` mode** a tenant's claim is a **submission**, not
      a grant: `queue-legacy-claim` writes a claim request. An **operator**
      — authority over the whole dataset, exercised from the SQL editor
      through `release2_legacy_grant(claim_id)` / `release2_legacy_deny`,
      recorded with `decided_by` — grants a submission only when the row's
      entries passed the screen **and no other store has submitted a claim
      on any of the same paths**. Two submissions on one path, or any
      `suspect` verdict, are **denied to both** and the row is quarantined
      for re-upload. Null-store rows are never claimable by a tenant in
      this mode; they are listed for the operator only. Staging has two
      stores and is therefore in this mode, which is where the operator
      path is exercised.
    - `unverified` entries (rows written after A by a public caller with a
      fabricated path, §6.1 `register-job`) are the poisoning shape by
      definition and are never claimable in either mode.
    - A **grant** creates the allocation records (`source =
      'owner-claimed'` or `'operator-granted'`, `claimed_by`, `claimed_at`);
      a **discard** releases nothing and deletes nothing — it marks the row
      for the retention policy below.
  - **Stage A is behaviour-preserving; stage C is the operational cutover.
    Not both.** At A the counter is flag-OFF, `get-download-url` and
    `complete-job` run unchanged with activation OFF, `files[]` is untouched,
    and every row opens exactly as it did the day before. At C the counter
    moves to endpoints that act only on allocation records, and every legacy
    row must by then have been **adjudicated — claimed, denied or
    discarded — under the dataset's authority model** — a named
    precondition of G-counter for slice 5. Any row still
    unadjudicated at C stays visible in the recovery view and is never
    silently gone. In practice the queue turns over within a day and the
    sweep removes the stale, so the set at C is expected to be empty, but
    the plan does not depend on that.
- **`cleanup-stale-jobs` and a retention policy for unknown legacy
  objects** (R1, S1). The deletion loop today removes objects at
  `row.files[].path` — paths the writer chose — so a row registered against
  a victim's live object deletes the victim's file when the attacker's row
  goes stale. Revision 3 let the sweep delete a legacy object when
  `sole_reference` and `co_created` passed; those are **metadata by this
  document's own wording** and cannot become ownership evidence at the
  point of removal. So the sweep **never deletes an object that has no
  allocation record**, full stop. What it does instead is governed by an
  explicit **retention policy**, tested as a policy:
  - **Scope**: bucket `customer-uploads` (and `job-files` from slice 7).
  - **Protected**: any object whose path has an allocation in `allocated`
    or `consumed` state is never touched by anything but the state machine.
  - **Allocated objects**: removed only from `released` or `expired`,
    through the record (§6.1 state machine).
  - **Unknown legacy objects** — present in the bucket, no allocation
    record — are **quarantined for authorized disposal**: the sweep lists
    them (path, size, `created_at`, referencing rows if any) into a
    `legacy_objects_report` table and deletes nothing. **Age**: an unknown
    object becomes *eligible* for disposal 30 days after stage A. **Who may
    delete**: the operator only, through `release2_dispose_legacy_objects`
    from the SQL editor; never the sweep, never a tenant owner, never a
    claim or discard. **Concurrency and durability** (T2): revision 4
    relied on a row lock that ends with the transaction, and on `for
    update` over `upload_allocations` — which locks **nothing** when no
    allocation row exists, which is precisely the case for an unknown
    legacy object. A grant could therefore allocate a path after disposal
    committed and before the remote delete landed, and the newly allocated
    object would vanish. So:
    - **A durable exclusion table**, `path_exclusions (bucket text, path
      text, reason text, created_at, removed_at null, primary key (bucket,
      path))`. Disposal **inserts the exclusion atomically, in the same
      transaction, before it returns a removal list**. The row is never
      deleted: it survives a failed remote delete and every retry
      (`remove_attempts` on the report row; `removed_at` set only on
      success) and it stays after completion, so the exact `(bucket, path)`
      can never be allocated again. Paths are date-prefixed UUIDs, so a
      permanent exclusion costs nothing legitimate.
    - **The exclusion is a mandatory precondition** for every
      `start-upload` allocation, every `job-file-upload-url` allocation,
      every legacy grant (owner or operator) and every claim submission:
      `not exists (select 1 from path_exclusions where bucket = … and path
      = …)`, checked inside the same function that writes the allocation.
    - **What is locked when no row exists**: a transaction-scoped
      advisory lock on `hashtext(bucket || '/' || path)` —
      `pg_advisory_xact_lock` — taken by allocation, grant, expiry and
      disposal alike, **before** the exclusion check and before any row is
      read or written. That is the canonical serialization for a path;
      the row locks on `upload_allocations` remain for the state machine
      but no longer carry the exclusion. Two operations on one path
      cannot interleave whether or not an allocation row exists yet.
    - The mutants that must fail: a grant that skips the exclusion check;
      a disposal that returns paths before inserting exclusions; a retry
      path that deletes the exclusion; an allocation that takes the row
      lock but not the advisory lock.
  - **Legacy rows** whose objects are unknown: the sweep may delete a stale
    *row* (a tenant-attributed record) after the existing 24-hour cutoff,
    but the object stays in the report until the operator disposes of it.
  - The policy test asserts, on a scripted bucket and table, that the sweep
    issues **no** `remove` for any path without a `released`/`expired`
    allocation, that the report contains every unknown object, and that
    disposal refuses a path with a live allocation; its mutants (a sweep
    that removes on `sole_reference`, a disposal that skips the lock) must
    fail.
- New endpoints `queue-list`, `queue-download-url`, `queue-complete` (§8).
  The legacy `get-download-url` and `complete-job` gain a dual-mode
  activation (`RELEASE2_ACTIVATE_LEGACY_QUEUE`) that, when ON, requires a
  staff session and resolves the path **through the allocation record for
  that job** rather than signing what it is handed.

**B.** `PrintQueue.jsx` polls `queue-list` every 15 s while visible, at
once on focus; the Realtime channel and direct reads go behind the flag;
the badge reads the same response; download and complete by `{ jobId,
fileId }`. Quarantined rows render with their reason and no file actions.

**C checklist.** A real customer upload appears within one poll and opens;
completing it removes the row and its objects; the badge matches; two staff
tabs agree; a Google-link import appears with a correct number; a
quarantined legacy row shows "needs attention" and cannot be opened or
completed from the new tab; Supabase unreachable → "offline", not empty.

**D.** Delete the channel, the direct reads, the two staff-side function
callers; **tombstone** `get-download-url` and `complete-job`; remove paths
4–8 from the allowlist. Row 40: both routes 410. **The old `{ path }` input
shape of `register-job` is NOT removed here** (R2): its callers are
`UploadApp.jsx:193–205` and the kiosk sheet at `App.jsx:5448–5460`, which
destructure `{ path, token }` from `start-upload` and push `{ name, path,
type }` — neither is a staff client, neither is behind this slice's flag,
and removing the shape at D would have broken every **fresh** customer and
kiosk submission, not merely a mid-flow one. The exact-path form stays
accepted, **with the identical allocation, ownership and consumption checks
as `allocationId`** — a compatible input shape under the same checks is not
a fallback — until slice 8's stage D, after both constructors have moved
(§6.4 B).

**E.** `drop policy anon_select_pending_jobs on public.pending_jobs; alter
publication supabase_realtime drop table public.pending_jobs;` — rollback
recreates the policy verbatim and re-adds the table. Denial: anon select →
0 rows; an anon subscription receives nothing; tombstones 410.

**What slice 5 leaves open, by design:** anyone can still call
`start-upload` and `register-job` and create allocation-backed rows. That is
abuse (spam, storage cost), not integrity — the rows can only ever reference
objects the server allocated. Slice 8's capability and limiter close it.

### 6.2 Slice 6 — orders and email (paths 1, 2, 3, 16)

**A.** `orders-list`, `orders-save` (§8); `send-print-job` dual-mode with
`RELEASE2_ACTIVATE_SEND` (activation at C, unauthenticated branch deleted
at D). Migration `release2_08`: **`orders.client_order_id text`**, with
`check (client_order_id ~ '^[A-Za-z0-9_-]{1,64}$')`, unique on
`(store_id, client_order_id) where client_order_id is not null`. **Why
text, not uuid** (V2): the shipped generator (`orderQueue.js:66–68`)
returns `crypto.randomUUID()` when it exists and otherwise a
`q_<base36>_<base36>` fallback — and `randomUUID` needs a secure
context, so the fallback will fire somewhere eventually. That value
cannot enter a `uuid` column, and the order carrying it would be
undrainable. So the **stable representation of every persisted source id
is the `_id` itself, as bounded opaque text**, sent verbatim as
`clientOrderId` and stored as sent. That choice stands on **preserving
existing identities without conversion** — it needs no claim that a
mapping would be impossible, and revision 7's sentence about
`crypto.subtle` is withdrawn: `newId()` tests only whether `randomUUID`
is absent or throws and never inspects `subtle` (W2). Mapping an identity
is not hashing content: two identical orders already hold different
`_id`s and stay distinct. **Never reminted on retry** — the id is read
from the persisted entry every time — and **never a reason to discard a
queued order**: an entry with a `q_` id drains like any other.
`orders.quoted_at timestamptz`; `orders.submitted_by_employee_id uuid`;
`orders.attribution_note text`; `orders.margin_source text` (`'client'` for
everything until slice 9).

**Original store and employee are preserved and validated separately from
the submitting session** (F3; Part 8 rows 25b, 25c, 65). A queued row
carries `clientOrderId`, `quotedAt`, `quotedStoreId`, `quotedEmployeeId`,
`quotedEmployeeName`, and the order. `orders-save` receives them and:

- **Store**: `quotedStoreId` must equal the session's enrollment store.
  Otherwise **409 `WRONG_STORE`**; the row is not written, stays queued, and
  the client shows it as "queued for another store" rather than retrying
  (25b: a device re-enrolled to T2 never drains T1's rows into T2). This is
  a distinguishable refusal on purpose; §10 decision 7 records why it must
  not be made uniform.
- **Employee**: `employee_id` is the **quoting** employee. If that employee
  exists in this store and is active → attributed normally. If inactive →
  attributed to them, `attribution_note = 'quoting employee inactive at
  save'` (25c, 65: recovery by a newly authenticated employee keeps A's
  attribution). If the id is missing (a row queued by a pre-slice client
  carries `employee_id` in its columns, which is used as `quotedEmployeeId`;
  a row with neither) → saved with `employee_id` = the submitter and
  `attribution_note = 'quoting employee unknown; attributed to submitter'`.
  **Never silently reassigned.** `submitted_by_employee_id` is always the
  session's employee.
- `store_id`, `org_id` stamped from the enrollment; `employee_name` from the
  `employees` row; client-sent copies ignored.

**Every stored occurrence gets its own durable identity, assigned under a
serialised migration** (F3, R5, S3). Revision 2 assigned random ids at
boot, so two tabs could assign different ids to one row and insert twice.
Revision 3 derived the id from content — `uuidv5(_queuedAt + canonical
row)` — so tabs would agree; but `orderQueue.js:48–53` does a plain push
with no per-entry identity, so **two identical orders queued in the same
millisecond are two entries with identical content and identical
`_queuedAt`**, and the content-derived id collapses them into one: one
saves, one acks as duplicate, the dequeue removes both — a lost order, and
two identical orders in a minute (two 4×6 photo jobs, two card reorders)
is ordinary counter traffic. **Content is not identity when content
repeats.** So:

- Every entry gets a **random `_id` at enqueue** (the shipped generator,
  UUID or `q_` fallback) — one writer, one moment, one identity per
  occurrence — and that `_id`, verbatim, is its `clientOrderId` (§ A
  above for the representation).
- Legacy entries (no id) are given ids **in place**, by whichever tab
  holds the Web Lock (`navigator.locks.request("pc-order-queue", { mode:
  "exclusive" }, …)`) — the shipped `assignMissingIds`: the holder reads
  the queue, assigns a random id to each entry lacking one — **one id per
  occurrence, identical entries included** — writes it back under the
  lock with read-back, and releases. A second tab waits for the lock, then
  reads a queue whose entries already have ids. Two tabs meeting two
  identical entries therefore converge on **two ids**, because only one
  tab assigns and it assigns per entry. Nothing is moved (U1, §6.2 below).
- Every drain and every dequeue also runs under the same lock, and a
  dequeue targets an entry **by id**, never by content or index.
- **Unsupported browsers**: Web Locks is available on every device the
  counter runs (Safari ≥ 15.4, Chrome ≥ 69). Where `navigator.locks` is
  absent, the client performs **no destructive queue write at all** — no
  migration, no drain, no dequeue — and shows "N orders waiting — update
  this browser to save them". Revision 3's `localStorage` lease fallback is
  **withdrawn**: a best-effort lease cannot back a no-loss promise for
  destructive writes, so the safe behaviour is to do nothing destructive.
- **A data-loss defect in shipped code, independent of this plan** (T3).
  `orderQueue.js:59–74` `drainPendingOrders` loads the queue, awaits each
  insert in a loop, then calls `writePendingOrders(remaining)` — a
  **whole-key overwrite of a snapshot taken before the awaits**. Anything
  enqueued during those awaits is erased. It needs no second tab:
  `saveOrderWithFallback` at `:83` fires `drainPendingOrders(insertFn)
  .catch(() => {})` **without awaiting**, and the `online` handler at
  `App.jsx:1518` does the same, so a drain runs in the background while the
  counter keeps working; an order that fails and queues mid-drain is
  destroyed by that drain's final write. `writePendingOrders` also swallows
  storage errors, so "queued" can be reported when nothing was stored.
  **Status: SHIPPED.** PR #46, merged to `main` at `9937728`, live on
  production 2026-09-18, and this branch is rebased onto it. What shipped,
  and what slice 6 therefore builds on as its **source baseline**: a
  random `_id` per entry at enqueue; `assignMissingIds()` giving legacy
  entries an id under the lock and persisting it before any insert;
  `dequeueById()` — a merge that re-reads the stored queue and removes one
  `_id`, never a snapshot write; one drain in flight per tab
  (`_drainInFlight`); `writePendingOrders` verified by read-back and
  `saveOrderWithFallback` returning `queued: false` when nothing was
  stored; every read-modify-write under the Web Locks API with
  `LOCK_NAME = "pc-order-queue"` where the browser has it. Tests in
  `scripts/tests/order-queue.test.js` include the shipped drain as a
  mutant that loses the order. Slice 6 adopts `_id` as the source of
  `clientOrderId` and **reuses the same lock name**, which is what makes
  post-#46 tabs cooperating writers below.
- **In this slice: a retained-source reconciliation, never a whole-key
  clear** (T3, U1). Revision 5 said legacy entries would be moved to a new
  key "in one atomic pair of writes". **Two `setItem` calls are not a
  transaction**, and the counterexample holds: copy `[A]` to the new key,
  an old tab appends `B` to the legacy key, the migration clears the
  legacy key from its snapshot, `B` is gone — the drain overwrite one
  level up. That sentence is withdrawn. Quiescence of old writers cannot
  be verified from inside a tab (a stale tab announces nothing, and
  `navigator.locks.query()` shows a cooperating writer only while it
  holds the lock), so it is not claimed as the precondition; the protocol
  is one that needs no clear:
  - **Writers on the legacy key, three classes.** *Pre-#46 bundles*: no
    lock, no `_id`, snapshot overwrite — fully non-cooperating. *Post-#46,
    pre-slice-6 bundles*: every read-modify-write under
    `"pc-order-queue"`, per-entry `_id`, merge writes — cooperating for
    every write, but they drain by direct anon insert. *Slice-6 bundles.*
  - **New entries** go to a **new key**, `pendingOrders_v2`, which no
    older bundle reads or writes, so nothing outside slice 6 can touch
    them.
  - **The legacy key is retained and never cleared or written from a
    snapshot.** Legacy entries are not moved at all. They are **drained
    in place** by the slice-6 client through `orders-save`, each entry's
    `_id` as its `clientOrderId`, and each removed **by id** after the
    acknowledgement with the shipped `dequeueById` merge under the shared
    lock — the same per-entry protocol #46 established. **Pre-fix
    entries** (queued before #46, no `_id`) are handled separately and
    first: the shipped `assignMissingIds` gives each one its own id under
    the lock and persists it by read-back before any request; an entry
    that cannot be persisted is not drained. The legacy key empties as its
    entries are acknowledged and reaches zero on its own.
  - **Restartable by construction.** Every step is keyed by `_id` and is
    a per-entry merge. A crash after the server acknowledged and before
    the dequeue leaves the entry in place; the retry sends the same
    `clientOrderId`, receives `duplicate: true`, and dequeues. No step
    depends on a snapshot being current.
  - **Enqueue, id assignment, drain and dequeue are all under the same
    Web Lock**, on both keys, so no read-modify-write overwrites another
    cooperating writer's. **Failed persistence is failure to queue**:
    `setItem` is verified by read-back, and an entry that is not durably
    stored is reported "not saved and could not be queued" and **never
    acknowledged or sent** — an id on the wire with no stored row behind
    it is the unstable identity that produces a duplicate next time.
- **Two residual windows, stated honestly — one is a duplicate, the
  other is an inherited loss risk** (V1; revision 6's "neither a loss" is
  withdrawn). (1) A *post-#46, pre-slice-6* tab may drain a legacy entry
  by direct anon insert while a slice-6 tab drains the same entry through
  `orders-save`: the old tab inserts outside the lock, then finds the
  entry already dequeued. Result: a **duplicate** row in history, visible
  and recoverable. It closes at slice 6's stage E, when the anon insert
  is refused. (2) A *pre-#46* tab **can still lose legacy-key entries.**
  Its drain's failure path writes back a pre-await snapshot of the legacy
  key, no new-tab lock can reach that write, and the legacy key has none
  of the new key's isolation — so an entry a cooperating writer appended
  to the legacy key during that old drain's awaits is erased. The
  reproduction is sound and uses two writer classes this plan permits to
  coexist. **Pre-#46 tabs therefore carry an inherited loss risk for the
  legacy backlog until they are retired**, and no no-loss claim is made
  for that backlog before then. Recorded explicitly:
  - **The window**: from #46 going live (2026-09-18) until every pre-#46
    execution context is gone.
  - **The affected population**: entries in `pendingTransactions` on a
    device where a pre-#46 tab still exists — including a tab
    **suspended in the background that can resume** days later with its
    old bundle still loaded (a suspended iPad tab keeps its JavaScript; a
    service-worker update does not swap a page's already-loaded code),
    and any offline context that resumes. New-key entries are outside the
    population by construction.
  - **The operational exit criterion, operator-verified — a compatibility
    checkpoint before slice 6's stage C** (W1). Closing the old contexts
    is necessary and **not sufficient**: `public/sw.js` serves navigations
    network-first with the cached shell as the fallback, and assets
    cache-first with a background refresh, so a device closed, restarted
    and reopened **offline or on a flaky connection gets the cached
    pre-#46 shell and the cached pre-#46 bundle, both successfully** — the
    likeliest reopen condition for a counter tablet. A restart terminates
    the old context; it does not establish what the next one loads. The
    checkpoint therefore has three parts, per device (the counter iPad,
    both kiosks, any staff device that has run the app), each recorded
    with device, date and person:
    1. **Close** every tab of the app and restart the browser after #46
       is live.
    2. **Reopen the canonical app URL ONLINE** and **verify from the
       running client** that its build is #46 or later. **A server deploy
       id is not evidence of the client currently executing.** The
       evidence is a **build stamp compiled into the bundle** — Vite
       `define` of Netlify's `COMMIT_REF` and `DEPLOY_ID` at build time
       (`src/lib/buildStamp.js`), rendered in the employee PIN dialog
       footer (reachable with no admin sign-in), the Admin panel footer
       and one `console.info` line at boot; a missing value renders
       `BUILD STAMP MISSING`, never anything version-shaped — and its
       commit is checked against `git` to descend from `9937728`. Any
       stamp at all implies #47, which contains #46. **Three facts,
       established separately** (review of revision 8): (i) the stamp's
       **source is merged** — PR #47, `main` at `7ec5af4`, this branch
       rebased onto it; (ii) it is **deployed** — production deploy
       `6ab020c5…` of `7ec5af4` reached `ready` 2026-09-20 18:07Z, and
       the `main-*.js` production served at 18:21Z carried
       `commit:"7ec5af4…", context:"production"`; that is the server's
       answer about what it serves and says nothing about what any
       device is executing; (iii) **device checkpoints completed: none.**
       No device has recorded steps 1–3, so every device is
       **unverified** until it does.
    3. **Reopen OFFLINE** (network off at the device) and verify the
       same stamp: after step 2 the service worker has stored the fresh
       shell and, on first fetch, the fresh bundle, so an offline reopen
       must now serve the fixed pair. A device that shows an older stamp
       offline, or cannot show one, **stays unverified and does not
       pass.**
    **Do NOT clear site data** on any device: that destroys the backlog
    this checkpoint exists to protect. The shell refresh in steps 2–3 is
    the service worker's own network-first navigation and asset fetch; a
    service worker has no access to `localStorage`, but **page code
    does**, and the reopened app's page code writes the queue key
    legitimately: `drainPendingOrders` runs on mount and on every
    `online` event, and a save during the check enqueues or drains. So the
    checkpoint record holds the queue's entry count before and after,
    **reconciled against acknowledged saves**: the decrease must equal the
    number of orders the drain acknowledged (the app's "Synced N unsynced
    orders" toast, `App.jsx:1273`) **and** those N rows must be read back
    from `public.orders` for the store in the check window. A decrease
    that reconciles is a drain; a decrease that does not is a loss and
    the device does not pass. Without this step a normal drain reads as
    data loss and a real loss hides behind one. Clearing site data — the
    one act that empties the key with no save behind it — is forbidden
    here. Quiescence is
    **not** inferred from inside a tab — a stale tab announces nothing
    and `navigator.locks.query()` cannot see a writer that is not holding
    the lock — and in-place draining is kept; the checkpoint is a human
    act with evidence from the executing client, recorded, and it is the
    only thing that turns "inherited risk" into "retired". Until all
    three parts are recorded for a device, that device's legacy backlog
    is treated as at-risk and the counter is told so.
  - **The mixed-version failure-path test stays**: the shipped pre-#46
    drain (copied verbatim as a mutant) runs its failure path while a
    cooperating writer appends to the legacy key, and the test asserts
    the append **is lost** — the inherited risk, demonstrated — and that
    an entry in `pendingOrders_v2` is untouched by the same run.

**Dequeue rule** (from the review of decision 7): **no failed save status
may dequeue a row.** A row leaves the queue only on (a) a validated save
acknowledgement (`ok: true` with an `orderId`), (b) a `duplicate: true`
acknowledgement, or (c) an explicit user discard from the "orders waiting"
view. 401, 409, 4xx, 5xx, a network error and a lost response all leave the
row where it is. Tests, each with its failing mutation: **lost response**
(server inserted, client saw a network error, retry → `duplicate`);
**reload mid-drain** (ids survive, second pass yields duplicates, one row
each); **concurrent drain** (two tabs, same queue, exactly one row per
order); **id representation** (an entry with a UUID `_id`, an entry with an
existing `q_` `_id`, and two identical id-less legacy occurrences each
drain to **exactly one server row per occurrence**, and a restart after a
lost acknowledgement produces no second row — all with the generator's
fallback **forced** by removing `crypto.randomUUID` while
`navigator.locks` remains available; the mutant that remints an id on
retry, and the mutant that skips an entry for having a `q_` id, must
fail); **two-tab legacy id assignment** (two tabs, two identical legacy
entries, exactly two ids and two rows; the mutant that assigns ids
**outside the lock** — an unsynchronized assignment — must fail); **enqueue
during drain** (an entry enqueued while a drain awaits survives the drain's
final write; the snapshot-overwrite mutant must fail); **failed
persistence** (a `setItem` that does not read back leaves the queue
unchanged, returns `queued: false`, and no request carries the id); **no
status dequeues** (every non-ack response leaves the queue length
unchanged); **25b**, **25c**, **65**.

**C5 deferred to slice 9, tracked there.** `orders-save` stores client
`cost_subtotal`/`margin_pct` verbatim with `margin_source='client'`; the
handler says so; the allowlist tags the two fields `slice-9`. A
**behavioural cost-tampering test exists from this slice** (F5): it asserts
the stored value equals the sent value *and* `margin_source='client'` — so
the gap is measured, not assumed — and slice 9 inverts it.

**C checklist.** **Before the flag flip**: the pre-#46 retirement
checkpoint is recorded per device — every app tab closed and the browser
restarted, then an **online reopen showing a client build stamp at or
after `9937728`**, then an **offline reopen showing the same stamp**, on
the counter iPad, both kiosks and any staff device, with device, date
and person, and **without clearing site data** (V1, W1); a device that
cannot show the stamp offline does not pass. Then: a real order saves; manager sees the margin column, staff
does not — the first server-enforced margin gate; network off, two orders
queued, network on, both drain exactly once; reload with queued rows and an
expired session → prompt → sign in as a *different* employee → the orders
carry the original employee; a row queued before this deploy drains with its
id assigned first; a quote emails; the kiosk is unaffected.

**E.** `drop policy anon_rw_orders on public.orders;` Denial: anon insert →
42501; anon select → 0 rows.

### 6.3 Slice 7 — jobs and job files (paths 9–14)

The queue's shape again: `print_jobs.file_urls[].path` is written by the
client today, so the same provenance work applies.

**A.** `jobs-list`, `jobs-save`, `job-file-upload-url`,
`job-file-download-url` (§8). Allocation records for the `job-files` bucket
in the same `upload_allocations` table (`bucket` column), keyed to the
staff session's store; `file_urls[]` entries gain `fileId`; `jobs-save`
accepts only this store's unconsumed allocations, builds `file_urls` from
the records, verifies the objects, consumes in one function. **Existing
`print_jobs` rows are screened and adjudicated exactly as the queue's**
(§6.1, R1/R3): `file_urls` untouched, a provenance record per entry
(object exists, sole reference, co-created, tenant present), the same
dataset-decided authority model for claims, the same retention policy for
unknown objects, and an operational cutover at C with "adjudicated" as a
G-counter precondition. Consumer link `consumer_kind =
'print_job'`. **Path 14 (`deleteJobFiles`) is deleted**, no caller; the inventory's
`supabase.storage` pattern fails on any `.remove(` that reappears. Signed
upload token: Supabase's two hours; allocation single-use and swept.

**C checklist.** A job saves with two attachments; Job History lists and
downloads each by id; a job with no files saves; a quarantined legacy job
shows "attachments need attention"; a 60 MB file is refused by the bucket.

**E.** Drop the two `print_jobs` anon policies and the three
`job_files_anon_*` policies; two migrations, two rollback files. Denial:
anon select/insert on `print_jobs` refused; anon `createSignedUrl` and
`upload` on `job-files` refused.

### 6.4 Slice 8 — customer upload capability (path 17 + the kiosk submit)

**A.** `upload-capability-create` (§8); `resolveUpload` added dual-mode to
`start-upload`, `register-job`, `fetch-link-job` under
`RELEASE2_ACTIVATE_UPLOAD_CAP`; allocations record `capability_id`; the
capability's quota is enforced against its allocations.

**B.** `UploadApp.jsx` **and `KioskSubmitSheet`** mint a capability before
the first upload; both ask `csrf-bootstrap?kind=upload` for the class token
(the kiosk also holds device and staff cookies — §0.3); and **both request
constructors move to `{ allocationId }`** (R2) — the `{ path }` shape they
send today is retired at this slice's D, not slice 5's.

**D** (addition). Remove the exact-path input shape from `register-job`;
`allocationId` only. Row 40 for the shape: a `{ path }` entry → 400.

**C checklist.** `/upload` end to end; the kiosk "Send to counter" on both
kiosks; a capability older than 30 minutes is refused and re-minted; the
41st mint in 15 minutes from one address is refused and the counter is
unaffected.

**D/E.** D deletes the unauthenticated branches. E is the direct probe of
each writer under no identity and under a wrong-kind identity (rows 38–39).

### 6.5 Slice 9 — C5: cost and margin computed server-side

**The finding it closes.** Part 6.2 C5: cost and margin on a saved order
are supplied by the client and stored verbatim. Slice 6 narrows *who* can
write; a devtools console on the counter iPad still sets `margin_pct`. An
integrity gap in the store's own books — deferred, not accepted.

**Why deferred.** Server-side computation needs the versioned price book
(`pricing_version`) from the cost substep's 4b. Slice 9 lands **immediately
after 4b**.

**What lands** (F6 shapes the contract):

- `orders.pricing_version text`. `orders-save` computes `cost_subtotal` and
  `margin_pct` from the server-side price book at the order's
  `pricing_version` and records `margin_source='server'`.
- **Deprecated client cost fields are accepted and ignored, never a 400**
  (F6). A 400 on presence would strand every queued order from a client one
  version behind, on a device that cannot be upgraded until it reconnects
  — the exact row-loss the drain design forbids. The handler ignores them,
  counts the occurrence in the logs, and the client stops sending them at D.
- **An unknown or retired `pricing_version` saves with `margin_pct = null`
  and `margin_source='unavailable'`. It is never repriced at the current
  version** (F6): silently repricing would rewrite history with numbers
  that were not true when the customer was quoted. An order is never
  rejected and never discarded for its version.
- The client stamps `pricing_version` at quote time; the offline queue
  carries it.
- **C checklist.** Stored `margin_pct` matches `src/lib/margin.js` for the
  same inputs (the pure engine is the oracle); a devtools-altered value is
  ignored and `margin_source='server'`; a price change between quote and
  drain leaves the drained order at the quote-time margin; a retired version
  saves `unavailable` and the dashboard shows "—", never 100%.
- **D.** The two fields leave the client whitelist; the `slice-9` allowlist
  entries are removed; the slice-6 tampering test is inverted: sent value ≠
  stored value, `margin_source='server'`.

**Tracking.** A row in §1, the gate structure of every slice, and allowlist
entries that fail the build if deleted without the handler change. If the
cost substep slips, slice 9 slips visibly.

---

## 7. Per-surface transition table (F4)

Revision 1 said every stage-D rollback was cheap. It is not: deleting the
legacy signer in D and rolling D back restores an unauthenticated signer —
Part 7's step-4e reopening contract, not a flag flip. And activating
authentication on a retained handler at A would break every flag-OFF
client. This table records, per surface, **the first stage whose rollback
reopens something** and **the last stage whose rollback is safe**. Every
rollback at or after "first closure" takes the full Part 7 Rollback contract.

| surface | slice | mechanism of closure | first closure | last safe rollback | note |
|---|---|---|---|---|---|
| PIN check | 4 | grant revoke | **E** | D | client-only until E |
| `register-job` / `fetch-link-job` path provenance | 5 | allocation recording from A; old shape accepted-and-quarantined at A; **refusal activated at C** | **C** | B | A records allocations and quarantines the unallocated; nothing is refused until C, so a flag-OFF customer upload never breaks. C's rollback restores acceptance of unallocated paths — reopening |
| existing queue rows | 5 | screen at A (metadata only, `files` untouched); adjudication (owner in `single-store`, operator in `multi-store`) before C; new endpoints act on grants only from C | **C** (cutover) | B | A is behaviour-preserving; the provenance and dataset-mode tables are additive and their rollback is a drop |
| customer-file signer / deleter | 5 | activation on legacy handlers at C; tombstone at D | **C** | B | D's rollback target is the C build with activation ON — safe |
| queue read + Realtime | 5 | grant + publication | **E** | D | |
| `send-print-job` | 6 | activation at C | **C** | B | |
| orders write / read | 6 | grant | **E** | D | |
| order attribution | 6 | `orders-save` logic | **A** (for rows written by it) | — | legacy rows keep their attribution |
| job-file signer / upload / delete | 7 | `jobs-save` provenance from A; storage policies at E | **A** / **E** | D | |
| existing `print_jobs` rows | 7 | screen at A; adjudication before C under the same authority model | **C** | B | as the queue |
| upload writers' entitlement | 8 | activation at C | **C** | B | |
| cost figures | 9 | `orders-save` computes | **A** | — | legacy rows keep `margin_source='client'` |

The "—" rollbacks are integrity closures whose reversal reintroduces
untrusted data, not access; they are recorded as reopening and take the
contract like any other.

---

## 8. Endpoint contracts

**Shared.** `gate()` first (deployment context + flag, method, Origin
allowlist as CSRF discipline, JSON on mutations). Credential resolved
first; CSRF compared to **that class's** secret second, on every mutation.
The store is the resolved row's, never a body field. Credential failure →
uniform 401. A row unknown **or in another store** → uniform 404 *(Part 8
row 10 says 403; a distinguishable 403 reveals existence in another tenant —
put to the reviewer)*. **Download, complete and delete never accept a
storage path; a row can reference only a path the server allocated.**
`no-store`. `interactive` explicit per endpoint.

| endpoint | method / credential / interactive | request | response | notes |
|---|---|---|---|---|
| `csrf-bootstrap` | GET / any / passive | `?kind=staff\|device\|upload` optional | `{ ok, kind, csrf }`; staff adds `employee:{id,name,role}` | with `kind`: that class or 401 |
| `queue-list` | GET / staff / **passive** | — | `{ ok, jobs:[{ id, customerName, jobDate, queueNumber, source, createdAt, quarantineReason, files:[{ fileId, name, size, type }] }] }` | no paths; polled |
| `queue-download-url` | POST / staff / interactive / CSRF | `{ jobId, fileId }` | `{ ok, url, expiresAt }` (60 s) | job by id + store; `fileId` → allocation for that job; sign the allocation's path |
| `queue-complete` | POST / staff / interactive / CSRF | `{ jobId }` | `{ ok, deleted: n }` | release allocations → remove objects → delete row; idempotent on retry |
| `queue-legacy-list` / `queue-legacy-claim` / `queue-legacy-discard` | GET, POST / **owner JWT** | `{ jobId }` | rows with screen verdicts, **no paths** | the recovery view (§6.1). `single-store`: claim grants for intact rows only. `multi-store`: claim is a submission; grant/deny is the operator's, from SQL. `suspect` and `unverified` rows: never claimable |
| `release2_expire_allocations`, `release2_legacy_grant` / `_deny`, `release2_dispose_legacy_objects` | SQL functions, `service_role` / operator | — | — | expiry and disposal claim rows `for update skip locked` **before** any storage I/O; rehearsed with real rows |
| `deploy-context` | GET / public | — | bundled build metadata, no secrets | the R4 proof; read-only |
| `start-upload` | POST / (slice 8: upload cap) | `{ fileName, size, type }` | `{ ok, allocationId, path, token }` | allocation written first; token lifetime is Supabase's (2 h); single-use, `max_bytes`, swept at 3 h |
| `register-job` | POST / (slice 8: upload cap) | `{ customerName, notes, files:[{ allocationId }] }`; the exact-path shape `{ path }` accepted **until slice 8 D** under the identical checks | `{ ok, job }` | row built from allocations; objects verified; consumed atomically (typed consumer link); tenant from allocation. Unallocated path: written with provenance `unverified` at A, **refused from C** |
| `fetch-link-job` | POST / (slice 8: upload cap) | `{ customerName, notes, url }` | `{ ok, job }` | allocates, stamps tenant, per-store numbering, registers via the same function |
| `orders-list` | GET / staff / interactive | `?limit=&before=` | `{ ok, orders:[…] }` | cost/margin fields only if the session row's role is `manager` |
| `orders-save` | POST / staff / interactive / CSRF | `{ clientOrderId, quotedAt, quotedStoreId, quotedEmployeeId, pricingVersion?, order }` | `{ ok, orderId, duplicate }` \| 409 `WRONG_STORE` | attribution per §6.2; slice 6: client cost fields stored, `margin_source='client'`; slice 9: computed, client fields **ignored**, unknown version → `unavailable` |
| `jobs-list` / `jobs-save` | as orders | `file_urls:[{ allocationId }]` | as orders | recorded paths only |
| `job-file-upload-url` | POST / staff / interactive / CSRF | `{ fileName, size, type }` | `{ ok, allocationId, path, url }` | as `start-upload`, `job-files` bucket, store from session |
| `job-file-download-url` | POST / staff / interactive / CSRF | `{ jobId, fileId }` | `{ ok, url, expiresAt }` | as the queue variant |
| `upload-capability-create` | POST / public | `{ storeSlug }` | `{ ok, expiresAt, maxFiles, maxBytes }` + `__Host-pc_upload` | slug validated; per-address limiter; rate and quota are the only bounds — said in the handler |
| `send-print-job` | POST / staff / interactive / CSRF | unchanged | unchanged | activation at C |
| `get-download-url`, `complete-job` | — | — | **410** from D | tombstones in `_retired.json` |

---

## 9. Review traceability

| finding | where it landed |
|---|---|
| **F1** readers on unvalidated rows; writers and provenance in scope; legacy rows; `fetch-link-job` | §0.1 (unit of closure), §1, §6.1 (allocations, `register-job`, `fetch-link-job` migration + link-import test, quarantine), §6.3 (same for job files) |
| **F2** Origin is not a deployment boundary | §4.1: `CONTEXT` + context-scoped flag before the ref refusal goes; `originOk()` stays CSRF only; G0 proves a preview 404s to a curl with no Origin |
| **F3** original store/employee; rows 25b/25c/65; durable idempotency; lost response, reload, concurrent drain | §6.2 |
| **F4** per-surface first closure / last safe rollback; D is reopening for the signer; activation separate from A | §2 (dual-mode + activation), §7 (table) |
| **F5** rename invisible to CREATE enumeration; deleted names leave discovery; tampering tests; falsify each gate | §0.2 (`tables.json` from applied schema, `_retired.json`, classify every `.from`), mutation test, §6.2 tampering test, §3 |
| **F6** never 400 on deprecated fields; unknown versions never repriced | §6.5 |
| contract 1: class-specific bootstrap | §0.3, §5.1, §8 |
| contract 2: two-hour token, not five minutes | §6.1, §6.3, §8 |
| contract 3: "no path in any response" dropped | §6.1, §8 shared rule |
| contract 4: opaque `fileId`, not `fileName` | §6.1, §8 |
| **R1** backfill inferred ownership from the untrusted row; cleanup follows `files[].path` | §6.1: screen recorded, never trusted; adjudication under the dataset-decided authority model (superseding the rev-3 owner-claim); the sweep never removes an object without an allocation record (superseding the rev-3 sole-reference rule) |
| **R2** removing `{ path }` at slice 5 D breaks fresh customer/kiosk submissions | §6.1 D, §6.4 B/D, §8: shape retained under identical checks until slice 8 D |
| **R3** `files` → `[]` broke the flag-OFF counter; A cannot be both preserving and a cutover | §6.1: references preserved in place; recovery view defined; A preserving, C the cutover with a named precondition |
| **R4** `CONTEXT` is build-time; absent → 404s production | §4.1: bundled immutable context file + Functions-scoped flag; four-part proof before the guard lifts |
| **R5** two tabs assign different legacy ids | §6.2: one-tab migration under Web Locks assigning a random id per occurrence (the rev-3 deterministic id was withdrawn by S3); two-tab test |
| **R6** `consumed_by` FK blocks deletion / cannot type the consumer / replayable | §6.1: typed consumer link, one-way state machine, completion ordering, sweep |
| **R7** per-line scanner misses multiline and aliases | §0.2: parser (`acorn` + `acorn-jsx`) plus gateway confinement (the rev-3 textual option was withdrawn by the rev-3 review); named mutants incl. aliases and computed access |
| decision 7 wording: "404 makes the client drop it" | removed; §6.2 dequeue rule: only a validated ack, a duplicate ack or an explicit discard dequeues |
| **S1** first claim is not ownership; cleanup cannot turn metadata into ownership at removal | §6.1: dataset-decided authority model (`single-store` owner / `multi-store` operator over submissions), conflicts and `suspect` denied to all; retention policy — the sweep never removes an unallocated object, operator-only disposal after 30 days under lock |
| **S2** expiry deleted before claiming | §6.1: `release2_expire_allocations` claims under `for update skip locked` before any I/O; removal retried; allowed-state table as a CHECK |
| **S3** content-derived ids collapse identical entries | §6.2: random id per occurrence; one-tab migration under Web Locks; no destructive write without Web Locks; lease withdrawn |
| scanner: parser + gateway; reconcile `storeConfig.js` | §0.2: `acorn`, gateway is two files, raw client importable only by `storeConfig.js`; computed-access and alias mutants |
| stale: decision 3's quarantine rule | §10 decision 3 rewritten |
| stale: "both build-time facts" | §4.1, §10 decision 4: one build-time fact, one runtime platform-scoped value |
| stale: "only deploy-moment callers can supply unallocated paths" | §6.1: three caller classes named; public callers refused from C and unclaimable until then; older deployments **bounded**, not closed (T1) |
| **T1** service-key scoping does not retire immutable old deploys; production permalinks outside it | §4.2 step 3 and 6: bounded claim; immutable-URL inventory; retire or rotate the key through a rehearsed transition; rollback = fresh build, never republish; readback probes per URL, re-run after every rollback rehearsal |
| **T2** disposal exclusion must outlive the transaction; `for update` on an empty lookup locks nothing | §6.1: durable `path_exclusions` keyed `(bucket, path)`, inserted before the removal list is returned, retained across retry and after completion; mandatory precondition on every allocation/grant/claim; `pg_advisory_xact_lock` on the path hash as the canonical serialization |
| **T3** whole-key overwrite of a pre-await snapshot; unawaited background drains; swallowed persistence errors | §6.2: standalone fix **SHIPPED** (PR #46, `main` at `9937728`); in the slice, a new key isolated from old bundles, every RMW under the lock, failed persistence = failure to queue, no unstable identity ever sent |
| reconciliations: `object_removed_at` in the schema; unsynchronized-assignment mutant; R1/R5/R7 rows; "only deploy-moment" sentence; historical-dataset single-store check; JSX parser | §6.1 schema; §6.2 tests; this table; §6.1; §6.1 dataset mode; §0.2 |
| **U1** two `setItem`s are not a transaction; a non-cooperating writer's append during handoff is lost | §6.2: "atomic pair" withdrawn; retained-source reconciliation — legacy key never cleared, entries drained in place by `_id` with the shipped merge, pre-fix entries handled separately, restartable; one residual window is a duplicate, the other an inherited loss risk with a recorded exit criterion (V1) |
| **U2** a locked deploy still serves; the signer is a separate bundle; "service key" unnamed | §4.2 step 3: lock withdrawn, three mechanisms (delete, verified restriction, credential revocation) recorded per URL; signer/deleter in the inventory and probed individually; key type established in rehearsal (legacy JWT vs `sb_secret_`), full rotation procedure incl. the client's anon key |
| **U3** the store/org union could never be single-store | §6.1: canonical store ids, org mappings validated separately, slugs resolved through `stores.slug`; unknowns listed and adjudicated, never dropped; the predicate proven on both fixtures in the rehearsal |
| standalone fix status | header, §6.2, §10 11a: SHIPPED at `9937728`; branch rebased; shipped names are the slice-6 baseline |
| "old handlers stamp `unverified`" | §6.1: withdrawn; missing provenance is denied by the reader unconditionally, and an `AFTER INSERT` trigger adds the mark as evidence for the recovery view |
| **V1** "neither a loss" was false: the old drain's failure path erases legacy-key appends | §6.2: withdrawn; window, affected population (incl. suspended/resumable contexts) and an operator-verified compatibility checkpoint recorded as the exit criterion; in-place draining kept; mixed-version failure-path test kept |
| **V2** the shipped `q_` fallback id cannot enter a `uuid` column | §6.2 A: `client_order_id` is bounded opaque text, the `_id` verbatim; never reminted, never a reason to discard; four representation tests with the fallback forced |
| **W1** restart does not establish what the next context loads; the sw serves the cached pre-#46 shell and bundle offline | §6.2 checkpoint: online reopen with a client build stamp verified from the executing bundle, then an offline reopen showing the same; a server deploy id is not evidence; site data never cleared; the stamp shipped as PR #47 (`main` at `7ec5af4`), merged and deployed, with no device checkpoint yet recorded — three facts kept separate |
| **W2** "`crypto.subtle` is unavailable in exactly the contexts where the fallback fires" was wrong; `newId()` never inspects `subtle` | §6.2 A: sentence withdrawn; opaque text stands on preserving identities without conversion |
| reconciliations: decision 11 "moved"; T3 trace row "proposed"; null-store / unresolved-org fixture; missing-provenance denial independent of the trigger | §10 11; this table; §6.1 fixtures; §6.1 |
| status wording | header table: code deployed dark / gates verified live / migrations applied / client paths enabled, each stated separately |

---

## 10. Decisions for the reviewer

1. Slicing step 4 by **unit of closure** (§0.1), with the per-surface
   table (§7) as the honest account of what each stage's rollback reopens.
2. **Provenance on `register-job`: recorded from A, refused from C**
   (§6.1, §7 row 2). Stated explicitly: requiring allocations at A would
   break only a customer mid-flow at the deploy moment, since every path
   issued after A carries an allocation — but that is still a customer
   upload failing on production because a stage-A deploy landed, F4's
   failure mode inside F1's fix. So A accepts the old shape, matches it to
   its allocation where one exists, and **quarantines** the rest; refusal
   activates at C with the client flag. Cost of the safe form: between A
   and C a deploy-moment row can exist with an unverified entry, served by
   the legacy signer that the flag-OFF counter is using anyway, and never
   by the new endpoints.
3. **Legacy rows are screened, never trusted by inference, and adjudicated
   under a dataset-decided authority model** (§6.1): `files` untouched; a
   per-entry screen recorded as metadata; `single-store` mode lets the one
   owner adjudicate intact rows and forbids claiming any `suspect` row;
   `multi-store` mode makes tenant claims submissions that an operator
   grants only without conflict; conflicts and `suspect` rows are denied to
   everyone and quarantined for re-upload. Revision 2's pattern/object/
   tenant quarantine rule is withdrawn.
4. **Deployment context** (§4.1): one **build-time** fact (the bundled
   `deploy-context.json`) plus one **runtime** value the platform scopes to
   Functions in the production context (`RELEASE2_ENABLED`), neither of
   which a request can supply. The service key scoped to production
   **bounds** the older-deployments class to future deploys; immutable
   historical deploys are retired or cut off by key rotation (§4.2, T1),
   which makes every post-rotation rollback a fresh build.
5. `csrf-bootstrap` returns the employee (§5.1) versus a client cache.
6. 404 for wrong-store rows (§8) versus Part 8's 403.
7. **`WRONG_STORE` as a distinguishable 409 on `orders-save`** (§6.2) — a
   deliberate departure from uniform refusal, and the reason is the threat
   model, not convenience. **Do not "correct" this to a 404 later.**
   Uniform refusal (401 and 404 indistinguishable from unknown) exists so an
   unauthenticated or wrong-class prober cannot enumerate whether a row, a
   device or a tenant exists. `orders-save`'s caller is a different model:
   it already holds a valid staff session for some store S, and the 409
   reports only that the `quotedStoreId` **the caller itself supplied** is
   not S — a relation between two values the caller already knows. It
   reveals nothing about any row in any other tenant; there is no lookup in
   T at all. The 409 is justified by the **safe recovery information** it
   carries: the staffer learns that this row was quoted at another store
   and can recover it on the right device (row 25b: "they stay queued
   against T1 and surface as such"). It is **not** justified by any other
   status being permission to lose work — under §6.2's dequeue rule no
   failed status, 404 included, ever dequeues a row; a uniform 404 would
   merely leave the row queued with no way to tell the staffer why it will
   never save. Contrast `queue-download-url`, where a wrong-store `jobId`
   **is** a lookup in T and a distinguishable answer **would** reveal
   existence — so there the uniform 404 stands. The rule: distinguishable
   refusal is permitted only where the caller is already authenticated to a
   store, the response is computed from values the caller supplied, and the
   distinction gives the caller information needed to recover their own
   work.
8. Soak lengths (§2).
9. **Authority over legacy rows follows the dataset** (§6.1): the
   migration classifies `single-store` or `multi-store` and records it; the
   owner adjudicates only in the former; an operator adjudicates
   submissions in the latter; first-come claims are gone. Every legacy row
   claimed, denied or discarded is a G-counter precondition for slices 5
   and 7.
10. **Scanner mechanism** (§0.2): parser (`acorn`) plus gateway
    confinement, as the reviewer chose; the gateway is `supabase.js` and
    `storeConfig.js`, and only the latter may import the raw client after
    the last slice.
11. **Per-occurrence identity and isolation from old clients** (§6.2):
    random `_id` per entry at enqueue, sent verbatim as bounded opaque
    text; a new storage key no old bundle touches; legacy entries **drained
    in place**, never moved, ids assigned in place under Web Locks; enqueue
    and every RMW under the same lock; failed persistence is failure to
    queue and no identity is sent unpersisted; no destructive queue write
    without Web Locks; the lease fallback withdrawn. Pre-#46 tabs carry an
    inherited loss risk for the legacy backlog until the operator-verified
    retirement checkpoint is recorded per device (V1).
11a. **T3 standalone fix: SHIPPED** (§6.2) — PR #46, `main` at `9937728`,
    live on production, branch rebased onto it. Slice 6 builds on the
    shipped module's names and lock, and drains the legacy key in place
    rather than moving it (U1).
11b. **Client build stamp: MERGED and DEPLOYED** (§6.2) — PR #47, `main` at
    `7ec5af4`, production deploy `6ab020c5…` ready 2026-09-20 18:07Z,
    branch rebased onto it. It is the evidence the retirement checkpoint
    reads from the executing client; **no device checkpoint is recorded**,
    so nothing about the legacy backlog's risk has changed yet.
12. **Deployment context transport** (§4.1): a bundled file written at
    build, plus a Functions-scoped, production-context flag; the four-part
    proof precedes lifting the ref guard.
13. **Retention policy for unknown legacy objects** (§6.1): the sweep never
    removes an object without an allocation; unknown objects are reported,
    eligible after 30 days, and disposed of only by the operator, who
    first writes a **durable exclusion** for `(bucket, path)` that every
    later allocation, grant and claim must check; serialization by an
    advisory lock on the path, since no row exists to lock.
14. **Expiry before I/O** (§6.1): `allocated → expired` is claimed under
    the lock, then the object is removed and retried; the allowed-state
    table is a CHECK constraint.
