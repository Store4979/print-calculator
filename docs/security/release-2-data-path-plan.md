# Release 2 — moving the 17 client data paths (stage 0, slices 4–9)

**Status: PLAN ONLY. Nothing here is built.** Written 2026-09-17 after slice 3
was accepted on staging. This is the execution plan for Part 6 of
`release-2-plan.md` (the 17 paths) and the parts of Part 7 they drive
(steps 4, 4a, 4e, 5.1–5.4, 5.6), plus the closure of C5. It does NOT cover
the rest of the cost transition (4b–4d, 5.5) or the excess-grant sweep
(5.7); those are named where they touch this work and otherwise left to
their own plan.

Everything shipped so far adds endpoints nothing calls. This is the first
work that changes what the counter does.

---

## 0. Amendments to Part 6 and Part 7

### 0.1 Step 4 says "one release, all 17 paths". This plan slices it.

Step 4's reasoning is: *"a partial move means a partial grant closure, which
is no closure."* That is true of a **grant** and false of the **client**.
Grants close per object, and step 5 already says so — "one object at a time,
each with its own rollback file". A table's grant can close the moment every
path that reaches **that table** has moved:

| object | paths that reach it | closes when |
|---|---|---|
| `verify_employee_pin` EXECUTE | 15 (two callers) | slice 4 |
| `pending_jobs` SELECT + Realtime, `get-download-url`, `complete-job` | 4, 5, 6, 7, 8 | slice 5 |
| `orders` `anon_rw_orders` | 1, 2, 3 | slice 6 |
| `print_jobs` anon policies, `job_files_anon_*` | 9–14 | slice 7 |
| `start-upload` / `register-job` / `fetch-link-job` (authentication, not a grant) | 17, incl. the kiosk (§0.2) | slice 8 |
| `orders.cost_subtotal` / `margin_pct` accepted from the browser (C5) | 2, 3 — the *content* of the write, not the grant | slice 9 |

So the client moves in slices, each ending in the closure of exactly the
object(s) its paths reach. What must NOT happen — and what step 4 was really
guarding against — is closing an object while a path to it remains. The
inventory gate in §0.2 makes that mechanical rather than a matter of care.

**Why slice at all.** One release of all 17 paths means one counter
confirmation covering sign-in, orders, the queue, uploads, job files and
email at once, and one rollback that reverts all of them. A failure in job
files would roll back sign-in. Slicing makes each confirmation small enough
to actually run at a working counter, and each rollback narrow enough to
leave the rest standing. The reviewer is asked to accept this amendment to
step 4's wording; the property step 4 protects is kept.

### 0.2 Part 6's inventory missed the kiosk. The gate must be a grep, not a list.

Part 6's table of 17 paths was verified by two reviewers. It still lists
`UploadApp.jsx:192,203,180` as the only callers of `start-upload`,
`register-job` and `fetch-link-job`, and **`App.jsx:5448` and `:5459` also
call `start-upload` and `register-job`** — the kiosk's "Send to counter"
sheet uploads through the same unauthenticated functions the `/upload` page
uses. Step 4a authenticates those functions. If the kiosk client is not
moved onto a capability at the same time, step 4a breaks the kiosk submit,
on the customer-facing device, on a Saturday.

**Why the list missed it, and why a better list would too.** The kiosk
callers do not contain the string `/.netlify/functions/start-upload`. They
call `callQueueFn("start-upload", …)`, and the URL is assembled inside the
helper from a template. A reviewer searching for the URL finds
`UploadApp.jsx`, which builds its URL the same way but happens to sit next
to its `FN()` helper, and stops. The name and the route live in different
places, and a hand-maintained table is a second copy of a truth that
already exists in two other places — the filesystem (`netlify/functions/`)
and the schema (the table names). Copies drift. Two careful reviewers did
not fail; the artefact did.

**The gate is therefore mechanical, and it is a test.** The sources of
truth are enumerated, not remembered:

- **function names** = the basenames of `netlify/functions/*.js`;
- **table names** = every `create table public.<name>` in
  `supabase/migrations/`;
- **reach patterns** in `src/`, matched per line on comment-stripped source
  (CLAUDE.md rule 4):
  `"<function-name>"` as a string literal anywhere;
  `.from("<table>")`; `.rpc(`; `.channel(`; `supabase.storage` (the chain
  breaks across lines, so `.storage.from(` on one line does not match —
  measured on `supabase.js:131,201,217`).

`scripts/tests/release2-inventory.test.js` runs that enumeration and
compares it to an **allowlist in the test**, where every permitted reach is
tagged with the slice that removes it. The test fails on any reach not in
the allowlist — a new direct path cannot be added without either moving it
or adding it to the plan with a slice. As each slice reaches stage D, its
entries are deleted from the allowlist, and the test then fails if the reach
ever reappears. Run today, before any slice, the enumeration finds every
reach site behind Part 6's 17 rows (it counts sites, not rows: rows 2 and 3
share `supabase.js:388`, rows 12 and 13 share `:201`, and the offline drain
in `orderQueue.js` takes its insert function as a parameter so its reach is
that same site), the three `employees` helpers that run under the owner's
JWT and are allowlisted permanently, **and the two kiosk callers** — which
is the point.

`G-inventory` in §3 is this test, green, on the build being deployed. Not a
grep somebody ran.

### 0.3 The kiosk needs three credential classes

The kiosk device is **enrolled** (an owner pairs it, per step 4's confirm
list) so that kiosk exit can be a PIN sign-in and kiosk entry can revoke
sessions. But its customer-facing action — sending a job to the counter — is
an **upload**, which under Part 3.2 needs an upload capability, not a device
token. So a kiosk holds a `__Host-pc_device` cookie always, a
`__Host-pc_staff` cookie while a staffer has exited kiosk mode, and mints a
`__Host-pc_upload` capability per customer submission. Three cookies, three
classes, each consulted only by the endpoints of its class. Part 3.1's rule
that a device token "gets you as far as staff-login and no further" already
implies this; stated here so slice 8 does not let the device token authorise
an upload.

---

## 1. Slicing

| slice | paths | what the counter gains | what closes |
|---|---|---|---|
| **0 — production light-up** *(its own review round, §4)* | none | Release 2 exists on production; nothing calls it | nothing — it opens the endpoints |
| **4 — identity at the counter** *(the first client slice, §5)* | 15: `findEmployeeByPin` from `EmployeeLogin` and the kiosk exit | PIN sign-in through `staff-login` on an enrolled device; sign-out; kiosk entry revokes server-side; sessions expire; owner pairs and revokes devices | **S1**: `verify_employee_pin` EXECUTE revoked from `anon`, `authenticated` (step 5.6) |
| **5 — queue, staff side** | 4, 5, 6, 7, 8 | queue tab and badge poll `queue-list`; download and complete through staff endpoints; file paths never reach the browser | step 5.2 (`anon_select_pending_jobs`, publication) and step 4e for `get-download-url`, `complete-job` |
| **6 — orders and email** | 1, 2, 3, 16 | orders save and list through staff endpoints; drain is idempotent; margin fields server-gated by role; email needs a staff session | step 5.1 (`anon_rw_orders`); `send-print-job` authenticated (4a, part) |
| **7 — jobs and job files** | 9, 10, 11, 12, 13, 14 | Job History and attachments through staff endpoints; path 14 deleted | steps 5.3, 5.4 |
| **8 — customer upload capability** | 17 + the kiosk submit | `/upload` and the kiosk mint a capability; the three retained functions require it; recorded paths only | step 4a (`resolveUpload` ×3) |
| **9 — C5: server-stamped cost and margin** (§6.5) | the content of 2 and 3 | `orders-save` computes cost and margin from the server-side price book at the order's `pricing_version`; client-sent values ignored | the browser's ability to write the store's margin history |

**Order and why.** 0 first and alone (§4). 4 next because every staff
endpoint needs the staff cookie it creates, and because S1 is the one closure
that needs no other path moved. 5 before 6 because `get-download-url` signs
any path it is handed and `pending_jobs` is anon-readable — customer files
are enumerable and downloadable by anyone today, which outranks the orders
exposure. 6 next as the highest-traffic path. 7 last of the staff slices as
the least-used surface. 8 is independent of the staff cookie and can run in
parallel with 6–7 once 5 has landed. 9 depends on the cost substep's
`pricing_version` and sits after it; it is in this document so it is not
lost (§6.5).

**Not in these slices:** the employee-management and store-config writers
(`listEmployees`, `createEmployee`, `updateEmployee`, `publishStoreConfig`
and the rest of `storeConfig.js`) run under the owner's Auth JWT and RLS,
not the anon key, and are not among the 17. They stay. The inventory test
allowlists them permanently, tagged `auth-jwt`. Note for the cost substep:
`storeConfig.js:41–50` and `:82` use `select("*")` on `stores` and
`sheet_prices`; step 5.5's column privileges will make those fail with
"permission denied for column" until they name their columns.

---

## 2. The stage sequence, defined once

Every client slice runs the same five stages.

**Principle: no runtime fallback.** "Dual-path" has exactly one meaning
here: both implementations are in the bundle, selected by a **build-time
flag per slice** (`VITE_R2_IDENTITY`, `VITE_R2_QUEUE`, …). The client never
tries the endpoint and falls back to the direct path on failure. A fallback
hides exactly the failures the counter confirmation exists to find — an
unenrolled device, an expired session, a wrong-store refusal — by making
them succeed through the door the release is closing, and for writes it can
insert twice. A slice's confirmation is only evidence if every request it
observed went through the new path. Netlify env vars are per site, so
staging runs a slice ON while production runs it OFF from the same commit.
This is not a preference to be traded for convenience; a fallback would
make the confirmation gates below meaningless.

| stage | what lands | who confirms | rollback | rollback class |
|---|---|---|---|---|
| **A — additive, server** | new endpoints; additive migrations (indexes, columns), each rehearsed with real rows in `begin … rollback`, applied, ledger version read back, file placed | staging probes (the sequence in `staging-probes.md`, extended per slice) | none needed — endpoints refuse without identity; additive schema harms nothing | — |
| **B — deploy, dual-path** | client carries both paths; flag ON for the staging site, OFF for production | staging: probe doc + the slice's confirm checklist against the staging tenants | none needed in production — the legacy path is what runs | — |
| **C — counter-confirm** | flag flipped ON for production (env change **plus manual redeploy** — env changes do not reach running deploys) | **the owner at the real counter**, against the slice's checklist; then a soak | flag OFF + redeploy → legacy path. **Cheap**: no grant has moved, nothing reopens | not an incident |
| **D — tighten, client** | legacy path and flag deleted; the slice's entries removed from the inventory allowlist; for 4e-type deletions the old function files removed | build passes with the inventory test green; legacy-route inventory (Part 8 row 40) shows the old URLs 404; short soak | redeploy the stage-C build. Still cheap: grants still open | not an incident |
| **E — tighten, grants** | the step-5 migration for that object, with its `.rollback.sql` captured verbatim from `pg_policies` / `proacl` beforehand; the step-6 denial probes for that object run immediately | denial probes green; counter still working | restore the policy = **reopening**. The full Rollback contract from Part 7: named owner, compensating restriction, expiry, tracked as an incident, sessions revoked on the way back up. **Policy first, then client** if the client also goes back | **incident** |

**Why D and E are separate.** D is the last moment a rollback is cheap.
Running the legacy-free client at the counter for a soak *before* closing
the grant means the grant closure, when it comes, changes nothing the counter
can observe — every request was already going through the endpoint. If the
grant closure breaks something, that something was reaching the table by a
path the inventory did not enumerate, which is exactly the finding step 5
exists to surface, and it surfaces with the cheap rollback already spent and
the expensive one in hand. That asymmetry is deliberate: the expensive
rollback should only ever be needed for an unknown path, never for a known
one.

**Soak lengths.** C: three business days including one weekend day, because
the kiosk sees different traffic on a Saturday. D: one business day. Both
measured on the Netlify function logs: no 5xx, no limiter 503, 401 rates
consistent with observed PIN mistakes, and — for slices with a deleted
legacy path — no request to the old URL.

---

## 3. The gates

| gate | sits between | passes when |
|---|---|---|
| **G0 — production lit** | stage 0 and every client slice | migrations 01–05 in production's ledger with files named and byte-identical; the ref refusal removed; Phase 1 probes (four 401s) green on `printcalculator2.netlify.app`; the inventory test proves nothing in the client calls an endpoint yet |
| **G-staging** (per slice) | B and C | the slice's staging probes and checklist green, DB agreeing |
| **G-counter** (per slice) | C and D | the owner has run the slice's checklist at the real counter; C soak complete |
| **G-inventory** (per slice) | D and E | `release2-inventory.test.js` green with the slice's entries removed from the allowlist; for 4e deletions the old URLs return 404 on the deployed build (row 40); D soak complete |
| **G-denial** (per slice) | E and the next slice | the step-6 probes for the closed object green: the direct path is refused *and* the counter still works |

A gate is owner-run where it says "owner". The rest are reproducible from
the repo and the probe doc.

---

## 4. Stage 0 — Release 2 reaches production. Its own review round.

Nothing in Release 2 runs on production today: the kill switch in
`netlify/lib/release2.js` refuses on the production ref, says so is "not
configurable by an environment variable", and the file's own header says the
module is removed "when Release 2 reaches production for real". Stage 0 is
that moment. **It is a different risk class from the client slices that
follow**, and is reviewed and landed on its own:

- The client slices change *which door the counter uses*; a rollback flips
  a flag. Stage 0 changes *whether the doors exist on production at all*, and
  puts five migrations into the production ledger that have only ever run on
  staging.
- It is the first time service-role-backed endpoints are reachable from
  the internet in front of the production database. Every property the
  slice 2 and 3 probes established was established on staging; stage 0 is
  where those probes are re-run against production, with real
  `store4979` rows behind them.
- Its rollback is an env flag, but its *blast radius* is every endpoint at
  once, not one path.

So stage 0 ships alone, is confirmed alone, and no client slice's stage B
starts until G0 has passed. Its steps:

1. **Migrations 01–05 to production**, one at a time, in ledger order, each
   read back and its file moved out of `pending/` under the assigned version,
   byte-identical to `statements[1]` (the trailing-newline transport
   difference documented in `staging.md` §2 is checked, not assumed). 01's
   `employees_id_store_uniq` constraint cannot fail on data — `id` is the
   primary key. 03 must follow 02 (it drops 02's `clear_lockout` signature).
2. **Rehearse 03, 04 and 05 on production** in `begin … rollback` with
   synthetic rows created inside the transaction (an enrollment for
   `store4979`, a synthetic employee — the role trigger admits `postgres`).
   Same proofs as the staging rehearsals, including 05's P5b. A migration
   that has only been rehearsed on staging has not been rehearsed against
   the data it will run on.
3. **Env on the production site**: `RELEASE2_ENABLED=true`,
   `RELEASE2_ALLOWED_ORIGINS=https://printcalculator2.netlify.app`.
   `SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` already exist. Nothing changes
   yet: the ref refusal still wins.
4. **Code**: delete the `PRODUCTION_REF` refusal and its branch in
   `release2Allowed()`; keep the flag check and the "URL must parse" check.
   `RELEASE2_ENABLED` becomes production's kill switch from here on. Update
   the header comment to say what the module now does (comment discipline —
   the current text would become a false claim), and `release2-guard.test.js`
   loses the "refuses on the production ref" case and gains "refuses when the
   flag is absent, on any ref".
5. Deploy. Probe Phase 1 on production: four uniform 401s. Then the
   positive probes with real rows: an owner mints and redeems a ticket on a
   scratch device, signs in a real PIN, logs out, revokes the device — the
   slice 2/3 sequence, on production, with the database read back. The
   scratch enrollment is revoked at the end and stays in the audit trail.
6. Deploy previews of the production site: `originOk()` reads `env.URL`
   first, so a preview origin is refused with 403 — previews cannot drive the
   endpoints, which is the intended outcome of the kill switch's old job.
   Confirmed by a probe from a preview, not assumed.

**Rollback of stage 0:** `RELEASE2_ENABLED=false` + redeploy → every endpoint
404s. The migrations stay: RLS on, zero policies, service-role only. Not an
incident — nothing the client uses has changed — but it is a reversal of a
reviewed decision and is recorded as such.

---

## 5. Slice 4 — identity at the counter, and S1

### 5.1 Stage A — server

No new endpoints. One small change to `csrf-bootstrap`: the `kind:"staff"`
branch also returns `employee: { id, name, role }`. After a reload the tab
must know who is signed in and whether to render margin; today that comes
from `currentEmployee` in `localStorage`, which is client-trusted and
exactly what Release 2 replaces. The plan's "no session content is returned"
meant no token, session id or key material — this is the same display
information `staff-login` already returns to the same holder, and the
authority for margin *data* stays with the endpoints that check the session
row (`orders-list` in slice 6, `pricing-costs` in the cost substep). One
test: the staff branch returns exactly `kind`, `csrf`, `employee` and
nothing else. **Put to the reviewer** — the alternative is a client-side cache
of `{name, role}` cleared on logout, which is the C3-style persistence the
plan is trying to stop.

### 5.2 Stage B — client, behind `VITE_R2_IDENTITY`

New: `src/lib/release2Client.js`. One module, the only place that knows the
endpoint names (so the inventory test can allowlist it by file):

- `call(name, {csrf, body})` — same-origin `fetch`, JSON, `x-pc-csrf` when
  given; cookies ride along (same-origin default).
- In-memory `csrf` and `kind`. **The 401 contract**, applied to every call:
  a 401 from any staff endpoint → `bootstrap()` → if `kind:"staff"` retry
  once with the fresh token → if `kind:"device"` raise the PIN prompt → if
  401 raise "this device isn't paired". Never an error dialog for a 401, and
  never a fallback to a direct path (§2).
- `bootstrap()`, `login(pin)`, `logout()`, `kioskEnter()`, `pairDevice(label)`
  (ticket-create then redeem, from the owner's own session, in one action —
  the 5a shape), `listDevices()`, `revokeDevice(id, reason)`.

Changes, each behind the flag:

- `EmployeeLogin.jsx`: `login(pin)` instead of `findEmployeeByPin`. Same
  "wrong PIN" message on 401; a locked device (429) says so and names the
  wait. Serves both callers — staff sign-in and kiosk exit.
- `App.jsx` boot: `bootstrap()`; `currentEmployee` comes from its response,
  is never written to `localStorage`, and the existing key is **deleted on
  upgrade** (a device that has run the app for months still holds it).
- Sign-out button → `logout()` → device state → PIN prompt.
- Kiosk entry → `kioskEnter()`; the kiosk badge shows **"not confirmed"**
  until the 200 with its count arrives, and retries (Part 3.1's
  offline-must-not-lie rule). Kiosk exit → `login(pin)`.
- Session expiry UX: the first 401 after 60 idle minutes or 12 hours raises
  the PIN prompt over the current screen; React state is untouched, so the
  quote in progress survives re-login. **This is a new counter behaviour**
  — today a PIN login persists indefinitely — and is on the checklist.
- Admin panel: a **Devices** section for owners — "Pair this device"
  (label, then `pairDevice`), the list from `enroll-list` with live-session
  counts and revocation reasons, and Revoke with a bounded reason. Owner-only
  in the client by membership role, and enforced by the endpoints regardless.
- Owner sign-in on a kiosk-enrolled device warns (Part 3.1).

`yarn dev` note: `__Host-` cookies need HTTPS, so the endpoint path cannot be
exercised on `http://localhost`. Flag OFF keeps local dev on the legacy path
until stage D; after D, local work on identity uses `netlify dev` over HTTPS
or staging. Recorded so nobody weakens the cookie attributes to make
localhost work.

Tests: the 401 contract on a fake `fetch`; flag ON → no `.rpc(` reaches
`verify_employee_pin` (behavioural, mocked client); kiosk "not confirmed"
until 200; `kiosk-guard.test.js` unchanged and green; the inventory test
with path 15's two entries still allowlisted (they leave at D).

### 5.3 Stage C — the counter checklist (gate G-counter, owner-run)

1. Owner pairs the counter iPad and both kiosk devices from Admin → Devices;
   the list shows three, labelled.
2. Staff PIN signs in on each; a manager sees margin, staff does not (Phase E
   gates unchanged).
3. Six wrong PINs on one device → locked message; a second device still
   signs in (F-2 at the counter).
4. Reload mid-quote: still signed in, quote intact (bootstrap).
5. Sign out → PIN prompt; sign in as a different employee (the 3f gap, at
   the counter).
6. Leave a tab idle 61 minutes; the next action prompts for a PIN; the
   quote is intact.
7. Kiosk entry: badge reads "not confirmed" until the server answers, then
   "kiosk"; a second staff tab's next action prompts for a PIN (row 19, the
   client half). Kiosk exit by PIN.
8. Owner revokes a device from the list; that device's next action says
   "not paired"; owner re-pairs it.
9. Supabase unreachable: pricing still works (public config, unchanged);
   sign-in fails with the same message as today (the RPC needed the network
   too). No regression.
10. Queued-order handover (rows 22b–22d): **unchanged in this slice** —
    orders still go direct. Recorded as not exercised.

Then the C soak.

### 5.4 Stage D — tighten, client

Delete `findEmployeeByPin`, the legacy branches in `EmployeeLogin` and the
kiosk exit, the flag, and `getStoredEmployee`. Remove path 15's entries from
the inventory allowlist; the test now fails on any `.rpc(` of
`verify_employee_pin` — the 2026-08-31 outage was a revoke issued on the
claim that nothing called it, and CLAUDE.md says to grep before revoking;
the test is that grep, kept green forever. `release2-pin-parity.test.js`
stays: the RPC text still exists and `PIN_LOOKUP` still mirrors it. D soak.

### 5.5 Stage E — S1 closes (gate G-denial)

Migration `release2_06_revoke_pin_rpc_execute.sql`:
`revoke execute on function public.verify_employee_pin(uuid, text) from anon,
authenticated;` — `service_role` keeps it; PUBLIC is not on the ACL today
(`staging.md` §2 verification) and the migration asserts that in a `DO`
block before revoking. Rollback file = the body of
`20260909160307_restore_pin_rpc_execute_for_app_roles.sql`, which already
exists for exactly this. The function is **not dropped**: rollback is a grant,
not a re-create.

Denial probes: from a browser console with the anon key,
`supabase.rpc('verify_employee_pin', …)` → 42501; from an owner's
authenticated session → 42501; `staff-login` at the counter still 200.

**Rollback of E** is the reopening kind. Compensating restriction: the
endpoints stay deployed and the devices stay enrolled so the client can be
moved forward again in one deploy; expiry set when pulled. Then update
CLAUDE.md: the PHASE S section and the `verify_employee_pin` gotcha.

---

## 6. Slices 5–9

Each follows §2. Only what is specific to the slice is listed.

### 6.1 Slice 5 — queue, staff side (paths 4–8)

**A.** Endpoints `queue-list`, `queue-download-url`, `queue-complete` (§7).
No schema change.

**B.** `PrintQueue.jsx`: poll `queue-list` every 15 s while the tab is
visible, immediately on focus; the Realtime channel and the direct
`pending_jobs` read go behind the flag. The badge (`App.jsx:1359`, its
channel at `:1366`) reads the same response. Download and complete by
`jobId` + `fileName`; **no storage path is ever in the browser** — the
response strips `files[].path` and the server signs the path it stored.

**C checklist.** A real customer upload appears within one poll; it opens;
completing it removes the row and its objects (checked in Storage); the badge
matches the tab; two staff tabs both see it; Supabase unreachable → the tab
says "offline", not an empty queue.

**D.** Delete the channel, the direct reads, the two function callers, and
**`netlify/functions/get-download-url.js` and `complete-job.js`** (4e for
these two). Row 40: the old URLs return 404 on the deployed build. Inventory
allowlist loses paths 4–8.

**E.** Migration: `drop policy anon_select_pending_jobs on public.pending_jobs;
alter publication supabase_realtime drop table public.pending_jobs;` —
rollback recreates the policy verbatim (captured from `pg_policies` first)
and re-adds the table. Denial: anon `select` on `pending_jobs` → 0 rows;
an anon Realtime subscription receives nothing on a new insert; the old
function URLs 404. `register-job` (service role) is unaffected.

### 6.2 Slice 6 — orders and email (paths 1, 2, 3, 16)

**A.** Endpoints `orders-list`, `orders-save`; `send-print-job` gains
`resolveStaff` + CSRF (its 4a item). Additive migration `release2_07`:
`orders.client_order_id uuid` and a unique index on
`(store_id, client_order_id) where client_order_id is not null` — the
idempotency key the plan requires to be stable across sign-out and
re-enrolment, so a retried drain cannot double-insert.

**B.** `insertOrder` → `orders-save`; `fetchOrders` → `orders-list`;
`orderQueue.js` drains through `orders-save`. The `pendingTransactions`
key does not change (renaming orphans queued rows). Every enqueued row gets
a `clientOrderId` at enqueue; rows queued before the upgrade get one at
drain. **Drain triggers**: reconnect *and* a successful `staff-login`. On
401 the rows stay queued and the bar shows "N orders waiting — sign in to
save". **Never discarded.**

**C5 is deferred to slice 9, and tracked there.** `orders-save` in this
slice stores the client's `cost_subtotal` and `margin_pct` verbatim — the
same integrity as today, no worse. This slice fixes *who* can write; slice 9
fixes *what* is written. The handler carries a comment that says exactly
that, and the inventory test allowlists `orders-save`'s two client-supplied
cost fields under slice 9 so they cannot be forgotten (§6.5).

**C checklist.** A real order saves and appears in history; manager sees the
margin column, staff does not — **the first server-enforced margin gate**;
network off, two orders queued, network on, both drain exactly once
(`client_order_id` unique); reload with queued rows and an expired session →
prompt → sign in → drain; a quote emails to the store; the kiosk is
unaffected (its submit is an upload, slice 8).

**E.** `drop policy anon_rw_orders on public.orders;` — no replacement,
function-only. Denial: anon insert → 42501; anon select → 0 rows.

### 6.3 Slice 7 — jobs and job files (paths 9–14)

**A.** `jobs-list`, `jobs-save`, `job-file-upload-url`,
`job-file-download-url` (§7). **Path 14 (`deleteJobFiles`) is deleted, not
moved**: no caller, and the inventory test's `supabase.storage` pattern
fails on any `.remove(` that reappears. Additive: a `job_file_paths` table
(or a column on `print_jobs`) recording every path the server minted, so
`jobs-save` accepts recorded paths only — the same rule `register-job`
follows.

**B.** `fetchPrintJobs`, the save path in `App.jsx`, `uploadJobFiles`,
`downloadJobFile`, `getJobFileSignedUrl` → the four endpoints.

**C checklist.** A job saves with two attachments; Job History lists it and
downloads each; a job with no files saves; a 60 MB file is refused with the
bucket's message.

**E.** Drop the two `print_jobs` anon policies and the three
`job_files_anon_*` policies, two migrations, two rollback files. Denial: anon
select/insert on `print_jobs` refused; anon `createSignedUrl` and `upload`
on `job-files` refused.

### 6.4 Slice 8 — customer upload capability (path 17 + the kiosk submit)

**A.** `upload-capability-create` (§7); `resolveUpload` in `start-upload`,
`register-job`, `fetch-link-job`; paths recorded on
`upload_capability_files` (table exists since 01). The `cleanup-stale-jobs`
guard shipped in Release 1 (its tests are in the suite).

**B.** `UploadApp.jsx` **and `KioskSubmitSheet` in `App.jsx`** mint a
capability before the first upload; `start-upload` and `register-job` calls
carry the cookie; `register-job` accepts only paths this capability
recorded. `fetch-link-job` (the QR hand-off) is keyed by capability, not by
an unauthenticated id.

**C checklist.** A customer at `/upload` completes end to end; the kiosk
"Send to counter" completes **on both kiosk devices**; a capability older
than 30 minutes is refused and the page re-mints; the per-source limiter
refuses the 41st mint in 15 minutes from one address and the counter is
unaffected.

**D/E.** There is no grant to close: the tightening *is* the handler
authentication. D deletes the unauthenticated branches; E is the direct
probe of each function under no identity and under a wrong-kind identity
(Part 8 rows 38–39). Rollback of E strips authentication from three
service-role handlers — reopening class, with the compensating restrictions
Part 7 names for 4a.

### 6.5 Slice 9 — C5: cost and margin stamped server-side

**The finding it closes.** Part 6.2 C5, in the reviewer's words: the cost
and margin on a saved order are supplied by the client and stored verbatim,
so anyone who can insert an order can write whatever margin they like into
the store's own history. Slice 6 narrows *who* can insert to a staff
session and changes nothing about *what* they can write. A staffer's
browser — or a devtools console on the counter iPad — still sets
`margin_pct`. That is an integrity gap in the store's own books, and it is
deferred, not accepted.

**Why it is deferred.** Stamping server-side needs (a) the server to hold
the price book that produced the quote, and (b) the order to say *which*
version of the price book that was — the `pricing_version` from Part 6.2's
"offline quotes" section. Both come from the cost substep (4b), which
publishes the versioned price book and moves costs behind `pricing-costs`.
Building C5 before that means building a second, unversioned server-side
cost model that 4b then replaces. Slice 9 therefore sits **immediately after
4b** and is the first thing to land once it has.

**What lands.**

- **A.** Additive migration: `orders.pricing_version text`,
  `orders.margin_source text` (`'client'` for every row written before this
  slice, `'server'` after, `'unavailable'` when the version has aged out).
  `orders-save` computes `cost_subtotal` and `margin_pct` from the
  server-side copy of the price book at the order's `pricing_version` and
  **ignores the client's values**; if that version is no longer available the
  order still saves with `margin_pct = null` and `margin_source =
  'unavailable'` — an order is never rejected or discarded because its
  pricing version aged out. The snapshot the client sends still carries its
  own numbers for the customer-facing PDF; the *stored* margin is the
  server's.
- **B.** The client stamps `pricing_version` on every quote at the moment it
  is priced (from the price book it loaded), and the offline queue carries
  it — an order quoted at 9 am and drained at 2 pm records the margin that
  was true at 9 am.
- **C checklist.** A saved order's `margin_pct` matches
  `src/lib/margin.js` for the same inputs (the pure engine is the oracle);
  a devtools-altered `margin_pct` on the request is ignored, the stored value
  is the server's; a price change between quote and drain leaves the
  drained order at the quote-time margin; a queued order whose version has
  been retired saves with `margin_source = 'unavailable'` and the dashboard
  shows "—", never 100%.
- **D.** `orders-save` stops accepting `cost_subtotal` / `margin_pct` at
  all (400 on presence, so a stale client is loud, not silently ignored);
  the two fields leave the client whitelist; the slice 9 allowlist entries
  are removed from the inventory test.
- **E.** Nothing to revoke: the closure is in the handler. The denial probe
  is the devtools test above, run on production.

**Tracking.** Slice 9 has a row in §1, a gate like every other slice, and
allowlist entries in the inventory test that fail the build if they are
deleted without the handler change. If the cost substep slips, slice 9 slips
with it — and the entry in this document is what makes that visible rather
than silent.

---

## 7. Endpoint contracts

**Shared, every new endpoint.** `gate()` first (kill-switch flag, method,
Origin allowlist, JSON on mutations). Credential resolved first, CSRF
compared to that row's secret second, on every mutation. The store is the
resolved row's, never a body field. Any credential failure → uniform 401.
A row that is unknown **or belongs to another store** → uniform 404
`{"ok":false,"error":"Not Found"}`, so the response cannot distinguish
"exists elsewhere" from "does not exist". *(Part 8 row 10 says 403; a 403
that differs from the unknown-id response tells the caller the row exists
in another tenant. Put to the reviewer.)* No token, session id, storage path
or key material in any response. `cache-control: no-store`. `interactive`
stated per endpoint, never defaulted.

| endpoint | method / credential / interactive | request | response | notes |
|---|---|---|---|---|
| `queue-list` | GET / staff / **passive** | — | `{ ok, jobs:[{ id, customerName, jobDate, queueNumber, source, createdAt, files:[{ name, size, type }] }] }` for the session's store | `files[].path` stripped. Polled; must not hold a session open |
| `queue-download-url` | POST / staff / interactive / CSRF | `{ jobId, fileName }` | `{ ok, url, expiresAt }` (60 s) | job loaded by id **and** session store; the path signed is the one **stored** for that `fileName`, never a client path |
| `queue-complete` | POST / staff / interactive / CSRF | `{ jobId }` | `{ ok, deleted: n }` | same load rule; objects removed then the row; missing row → 404 |
| `orders-list` | GET / staff / interactive | `?limit=&before=` | `{ ok, orders:[…] }` | `cost_subtotal`, `margin_pct` present **only if the session row's role is `manager`** (row 11: never from the request) |
| `orders-save` (slice 6) | POST / staff / interactive / CSRF | `{ clientOrderId, order:{ whitelist minus tenant/employee fields } }` | `{ ok, orderId, duplicate }` | `store_id`, `org_id`, `employee_id`, `employee_name` stamped from the session; client-sent copies ignored; unknown keys → 400; duplicate `clientOrderId` → 200 with `duplicate:true`, no second row. **Stores client `cost_subtotal` / `margin_pct` verbatim until slice 9** |
| `orders-save` (slice 9) | as above | `order` also carries `pricingVersion`; `cost_subtotal` / `margin_pct` **refused** (400) | as above | cost and margin computed server-side at `pricingVersion`; `margin_source` recorded |
| `jobs-list` / `jobs-save` | as orders | as orders; `file_urls[].path` must be paths this store's `job-file-upload-url` minted | as orders | recorded paths only |
| `job-file-upload-url` | POST / staff / interactive / CSRF | `{ fileName, size, type }` | `{ ok, path, url, expiresAt }` (5 min) | path is **server-minted** (`jobs/<id>/<safeName>`), recorded before the URL is returned; size checked against the bucket limit |
| `job-file-download-url` | POST / staff / interactive / CSRF | `{ jobId, fileName }` | `{ ok, url, expiresAt }` | serves paths 12 and 13; same rule as the queue variant |
| `upload-capability-create` | POST / **public** / — | `{ storeSlug }` | `{ ok, expiresAt, maxFiles, maxBytes }` + `Set-Cookie __Host-pc_upload` (30 min) | slug validated against `stores`; limiter `ticketSource`-shaped per address; rate and quota are the only bounds — say so in the handler |
| `start-upload` / `register-job` / `fetch-link-job` | POST / **upload capability** / — | unchanged bodies | unchanged | `resolveUpload`; every issued path recorded on the capability; `register-job` refuses paths it did not issue; wrong-kind cookie (device, staff) → 401 |
| `send-print-job` | POST / staff / interactive / CSRF | unchanged | unchanged | `resolveStaff` before the mail is built; wrong-kind → 401 |
| `csrf-bootstrap` *(change)* | GET / any / passive | — | staff branch adds `employee:{ id, name, role }` | see §5.1 |

---

## 8. Decisions for the reviewer

1. **Slicing step 4** (§0.1). The property is kept per object; the wording
   changes.
2. **A grep-based inventory gate replaces the maintained list** (§0.2).
   Two reviewers verified the list and it still missed the kiosk callers,
   because the name and the route live in different places. The test
   enumerates from the filesystem and the schema.
3. **Stage 0 is its own review round** (§4). Migrations 01–05 to production
   and the removal of the ref refusal are the moment Release 2 stops being
   staging-only — a different risk class from any client slice.
4. **No runtime fallback, as a principle** (§2). A fallback hides exactly
   the failures the counter confirmation exists to find.
5. **`csrf-bootstrap` returns the employee** (§5.1) versus a client-side
   cache that C3 would then have to clear.
6. **404 for wrong-store rows** (§7) versus the plan's 403.
7. **C5 is deferred to a named slice 9** (§6.5), gated on the cost substep's
   `pricing_version`, tracked by an inventory allowlist entry that fails the
   build if it is deleted without the handler change. Deferring is fine;
   losing track of it is not.
8. **Soak lengths** (§2): three business days for C including a weekend day,
   one for D.
