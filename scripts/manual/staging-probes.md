# Release 2 slice 2 — manual HTTP probe sequence (STAGING ONLY)

Owner-run. The sandbox cannot reach `netlify.app`, so every row here is a
request a human makes from a browser console or a shell.

**Target — the plain staging URL, no preview prefix:**

    https://printcalculator2-staging.netlify.app

The staging Netlify site builds `security/release-2-slice-2` as its production
branch. For most of this work no staging preview host existed at all: Deploy
Previews fire only for PRs that target a site's production branch, and PR #45
targets `main` — which is why 30 hours of probes were aimed at a hostname
Netlify was never going to create.

## Use the PLAIN staging URL, not the staging preview

Since the production branch was repointed, a second staging host also exists:

    https://deploy-preview-45--printcalculator2-staging.netlify.app

**Do not probe it.** It is a different ORIGIN, and `RELEASE2_ALLOWED_ORIGINS`
lists only the plain URL. On a Netlify deploy preview, `URL` remains the site's
main address while `DEPLOY_PRIME_URL` holds the preview address, and
`originOk()` reads `env.URL || env.DEPLOY_PRIME_URL` — `URL` first. A console
`fetch` from the preview therefore sends an origin matching neither the site URL
nor the allowlist, and every probe returns `403`. If the Release 2 environment
variables are additionally scoped to the production context, they return `404`
instead. Both look like total failure and are only the wrong hostname.

Phase 1 passed against the plain URL. Every probe below assumes it.

## Do not point this at production

`https://printcalculator2.netlify.app` and any `deploy-preview-*--printcalculator2`
host are linked to the production Supabase project. Every endpoint below returns
a bare `404` there, by design — `release2Allowed()` refuses when the project ref
is production, and no environment variable overrides it. That refusal has been
observed for real and is the expected answer, not a failure. But these probes
create enrollments, sessions and lockout rows, so run them only against staging.

## Preconditions

- `RELEASE2_ENABLED=true` on the staging site.
- `RELEASE2_ALLOWED_ORIGINS=https://printcalculator2-staging.netlify.app`.
  Note this is redundant: `originOk()` also accepts `origin === env.URL`, which
  Netlify sets to the site URL on a production-branch build. You therefore
  cannot test the allowlist by emptying it — probe 4c uses a foreign origin.
- Staging seed applied: stores `staging-t1-store` / `staging-t2-store`,
  four memberships, four employees.
- Auth accounts exist for `owner-t1@`, `manager-t1@`, `owner-t2@`,
  `manager-t2@example.invalid`. Passwords are the owner's; they appear nowhere
  in this repo.

Seed values used below:

| what | value |
|---|---|
| T1 store id | `5ee41000-0000-4000-8000-0000000000a1` |
| T2 store id | `5ee41000-0000-4000-8000-0000000000a2` |
| T1 Manager PIN | `1101` |
| T1 Staff PIN | `1102` |
| T2 Staff PIN | `2202` |

---

## Setup

Run this once per browser window — the normal window **and** the private window
used for device B. Everything after it is two or three lines.

```js
const BASE = 'https://printcalculator2-staging.netlify.app';
const FN = BASE + '/.netlify/functions/';

const call = (path, opts = {}) =>
  fetch(FN + path, { credentials: 'include', ...opts })
    .then(async r => ({ status: r.status, body: await r.text() }));

const J = (csrf, body, auth) => ({
  method: 'POST',
  headers: Object.assign(
    { 'content-type': 'application/json' },
    csrf ? { 'x-pc-csrf': csrf } : {},
    auth ? { authorization: 'Bearer ' + auth } : {}
  ),
  body: JSON.stringify(body),
});

const token = () => {
  const raw = JSON.parse(
    localStorage.getItem('printcalc_auth_v1') || 'null');
  const t = raw?.access_token;
  if (!t) throw new Error('no access_token in printcalc_auth_v1');
  return t;
};

const T1 = '5ee41000-0000-4000-8000-0000000000a1';
const T2 = '5ee41000-0000-4000-8000-0000000000a2';
```

`J(csrf, body, auth)` builds all three header shapes, which is what keeps every
probe below to a single short line.

`token()` reads the key this app actually uses. `src/lib/supabase.js` sets
`storageKey: "printcalc_auth_v1"`, so the default `sb-<ref>-auth-token` key does
not exist here, and the stored object is FLAT — `access_token` sits at the top
level with no `currentSession` nesting.

## Retry an unexpected 401 once before recording it

`token()` returns whatever is in localStorage at the moment it is called, which
may be an access token that has just expired. `enroll-ticket-create` validates
it with `getUser()` against Supabase, so an expired token yields a genuine
`401` — indistinguishable from "this caller is not an owner".

Observed in practice: 2a returned `401`, and the identical call moments later
returned `200`. supabase-js refreshes in the background and rewrites
localStorage between the two.

So on any **unexpected** `401` from an authorized probe, run it once more before
writing it down. Reloading the staging tab immediately before Phase 2 makes it
less likely. This applies only to probes that are SUPPOSED to succeed — 2b and
2c must return `401` every time, and a `401` there is the result, not a stale
token.

---

## Phase 0 — stage 0: the deployment context (2026-09-23, deploy `6ab3be3c…` of `6c47eb6`)

`release2Allowed()` now has a third condition: `netlify/lib/deploy-context.json`,
written at build and shipped inside every function bundle, must carry a
`context` in `RELEASE2_CONTEXTS`. The production-ref refusal is still in place.
`GET /.netlify/functions/deploy-context` is a read-only diagnostic outside the
gate; it reports the context condition only, never the gate's verdict.

### 0a — the plain staging site reports itself

`curl https://printcalculator2-staging.netlify.app/.netlify/functions/deploy-context`

Status: **PASS** — `200 application/json`, `Cache-Control: no-store`. Recorded:

| field | value |
|---|---|
| `ok` | `true` |
| `source` | **`LAMBDA_TASK_ROOT`** — `included_files` shipped the file; the module-relative candidate missed (the bundler inlines the lib, so `import.meta.url` is the function's own path) and the second candidate found it at `<task root>/netlify/lib/deploy-context.json`. This was the one assumption the local build could not verify. |
| `context` | `production` |
| `siteName` / `siteId` | `printcalculator2-staging` / `3106189d-9053-46a3-bfc7-22ba6b52511a` |
| `deployId` | `6ab3be3c58ae100008e98f37` — equals the Netlify deploy id that served it |
| `commitRef` | `6c47eb6e05df21816f326ea6f35e8e4096db0edd` |
| `builtAt` | `2026-09-23T11:56:01.768Z` |
| `allowedContexts` / `contextAllowed` | `["production"]` / `true` |
| `flagPresent` | `true` |

This is §4.1's evidence **(c)**: staging reports `production` under its own site name.

### 0b — a deploy preview reports `deploy-preview`; its Release 2 endpoints 404

Run 2026-09-23 against PR #48's previews (draft, `security/release-2-stage-0` → main, head `b294791`).

**0b-prod — the production site's preview.** `deploy-preview-48--printcalculator2.netlify.app`,
deploy `6ab3efa301777b0008a746f1`, permalink `6ab3efa301777b0008a746f1--printcalculator2.netlify.app`.

`GET /.netlify/functions/deploy-context` → `200 application/json`, `Cache-Control: no-store`:

```json
{"ok":true,"reason":null,"source":"LAMBDA_TASK_ROOT","triedWithoutFinding":[],
 "context":"deploy-preview","siteId":"03ff880d-eb73-4035-8b71-3588b22a0b20","siteName":"printcalculator2",
 "deployId":"6ab3efa301777b0008a746f1","commitRef":"b294791db2451f84239af1994478af6d7afbee4c",
 "builtAt":"2026-09-23T15:26:54.897Z","validContexts":["production","deploy-preview","branch-deploy","dev"],
 "allowedContexts":["production"],"contextAllowed":false,"flagPresent":false,
 "note":"Context condition only. This route does not evaluate the Release 2 gate, which also reads the project URL and the flag's value."}
```

`GET csrf-bootstrap` — no Origin: `{"ok":false,"error":"Not Found"}` → `404 application/json`;
with `Origin: https://printcalculator2-staging.netlify.app`: `404`; with its own Origin: `404`.

Status: **PASS as evidence (b) and the flag-absence half of (d) ONLY.** The
bundle reports `deploy-preview` under the production site's name, and the
Functions-scoped flag is absent in the preview. The 404s are **masked**: on
this site the production-ref refusal fires before the context condition, so
they prove nothing about the context condition. Write-free key probe
(`POST {}` to `start-upload`): `500 Service role key not configured` — this
preview has **no service-role key**; the 56 older preview permalinks that do
are listed in `docs/security/deploy-inventory.md`.

**0b-staging — the staging site's preview: MISSING.** The staging site built
no preview for PR #48 (polled 15:16–15:40Z; its only previews ever are PR
#45's, immutable, pre-stage-0). The context-denial evidence proper —
`csrf-bootstrap` 404 with and without an Origin header on a bundle where the
ref refusal is NOT in the way — is therefore **not yet observed**. The old #45
artefact was not used as a substitute (it answers 401: live endpoints, the F2
hazard). To obtain it: enable deploy previews on the staging site for PR
#48, or branch-deploy `security/release-2-stage-0` there (context
`branch-deploy`, also outside the allow-list → must 404).

### 0c — Phase 1 re-run on plain staging, curl, no cookie, no Origin

Status: **PASS** — the context condition admits the real site; the four
credential-free calls are still refused uniformly:

```
POST staff-login            {"ok":false,"error":"Unauthorized"} -> 401 application/json
POST enroll-redeem          {"ok":false,"error":"Unauthorized"} -> 401 application/json
POST enroll-ticket-create   {"ok":false,"error":"Unauthorized"} -> 401 application/json
GET  csrf-bootstrap         {"ok":false,"error":"Unauthorized"} -> 401 application/json
```

401, not 404: the gate passed all three conditions and the handler refused
for want of a credential — which is the point. A 404 here would have meant
the context file did not ship.

---

## Phase 1 — unauthenticated routing smoke tests

Status: **PASSED** — `401` on all four.

```js
await call('staff-login',          J(null, {}));
await call('enroll-redeem',        J(null, {}));
await call('enroll-ticket-create', J(null, {}));
await call('csrf-bootstrap');
```

All four return `401` with body `{"ok":false,"error":"Unauthorized"}`.
Uniform by design: unknown, expired, revoked and wrong-kind credentials are
indistinguishable from outside.

---

## Phase 2 — authorized ticket creation

### 2a — owner mints a ticket

Signed in as `owner-t1@example.invalid`.

```js
await call('enroll-ticket-create', J(null, { storeId: T1 }, token()));
```

Expect `200` with `{ok:true, ticket, ticketId, storeId, expiresAt}`.
Copy `ticket` immediately — only its sha256 is stored, so it is shown once and
cannot be retrieved again. TTL is 15 minutes.

### 2b — manager must be refused

Sign out, sign in as `manager-t1@example.invalid`, run the same line.

```js
await call('enroll-ticket-create', J(null, { storeId: T1 }, token()));
```

Expect `401`. Not `403`: the query filters `.eq("role","owner")`, so a manager's
membership is simply not found. Pairing a device is an ownership act, and Part 4
withholds it from a PIN manager and an Auth manager alike.

### 2c — cross-tenant owner must be refused

**The admin UI cannot produce this token.** The staging build pins
`VITE_STORE_SLUG` to `staging-t1-store`, so signing in as `owner-t2` is refused
by the app with "That account isn't an owner or manager of this store" and the
account is signed straight back out.

That refusal is a correct result and worth recording — but it is **not** 2c. It
is a CLIENT-SIDE gate. 2c asks whether the ENDPOINT refuses a valid, live T2
owner token that names T1, which is the server-side tenancy bind — the same
shape as finding P1-1 in `release2_clear_lockout`, where authorization was
checked against one store and the action taken on another. Accepting the UI
refusal as proof of the server property would be accepting a client gate as an
authorization boundary, which is the category error this release exists to
correct. An attacker does not use the admin panel.

So mint the token directly from Supabase Auth's REST endpoint. This does not
touch `printcalc_auth_v1`, so the T1 session in this window survives and the
rest of the sequence is unaffected.

```js
const STAGING_REF = 'lboajqihpsfrokqvjgnl';
const STAGING_ANON = 'sb_publishable_DEDmndmu9xmhNFeXTCbO6A_HE0EBkZ6';

const tokenFor = async (email, password) => {
  const r = await fetch(
    `https://${STAGING_REF}.supabase.co/auth/v1/token?grant_type=password`,
    { method: 'POST',
      headers: { apikey: STAGING_ANON, 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }) });
  const j = await r.json();
  if (!j.access_token) throw new Error('sign-in failed: ' + JSON.stringify(j));
  return j.access_token;
};
```

Then, with T2's owner password:

```js
const T2_OWNER = await tokenFor('owner-t2@example.invalid', 'PASSWORD');
await call('enroll-ticket-create', J(null, { storeId: T1 }, T2_OWNER));
```

Expect `401`. T2's owner holds no owner membership for T1, so the store filter
returns nothing.

Worth also confirming the token itself is good, so a `401` cannot be blamed on a
bad sign-in — this should return `200` with `storeId` ending `...0a2`:

```js
await call('enroll-ticket-create', J(null, { storeId: T2 }, T2_OWNER));
```

That pair is what makes 2c evidence: the SAME token succeeds for its own store
and fails for the other. One `401` alone proves nothing, because an unusable
token also returns `401`.

---

## Phase 3 — redemption, replay, bootstrap, login

Normal window. This window is **device A** for the rest of the sequence.

### 3a — redeem

```js
const TICKET = 'PASTE_FROM_2a';
await call('enroll-redeem', J(null, { ticket: TICKET, label: 'Counter A' }));
```

Expect `200` with `{ok:true, enrollmentId, csrf}`.
Check Application to Cookies for `__Host-pc_device`: HttpOnly, Secure,
SameSite=Strict, Path=/, and no Domain attribute. The `__Host-` prefix makes
those last two properties enforced by the browser rather than promised by us.

Save the returned `csrf` — probe 4f needs it after several other steps.

### 3b — replay the same ticket

Re-run the two lines from 3a unchanged.

```js
await call('enroll-redeem', J(null, { ticket: TICKET, label: 'Counter A' }));
```

Expect `401`. Single-use. Replay, expiry and revocation all answer identically
so a caller cannot enumerate which tickets are live.

### 3c — bootstrap does not rotate

```js
await call('csrf-bootstrap');
```

Expect `200` with `kind:"device"` and a `csrf` **identical** to 3a's. A
different value is a failure: rotating on issue would invalidate the token a
second counter tab is already holding, and its next save would fail with a
perfectly valid session.

### 3d — positive login

```js
const CSRF_DEV_A = 'PASTE_csrf_FROM_3a';
await call('staff-login', J(CSRF_DEV_A, { pin: '1102' }));
```

Expect `200` with `employee:{name:"T1 Staff", role:"staff"}`, a new `csrf`, an
`expiresAt`, and a `__Host-pc_staff` cookie. The `role` comes from the rotation
function, which re-reads `employees` under the enrollment's store — not from the
lookup in the handler and not from anything the caller sent.

### 3e — bootstrap kind flips

```js
await call('csrf-bootstrap');
```

Expect `200` with `kind:"staff"` and the csrf from 3d, because `resolveStaff`
runs before `resolveDevice`.

### 3f-i — predicted failure, run it anyway

```js
const CSRF_STAFF_A = 'PASTE_csrf_FROM_3d';
await call('staff-login', J(CSRF_STAFF_A, { pin: '1101' }));
```

Predicted `401`, and if so this is a **gap, not a pass**. `staff-login` compares
against `device.csrfSecret`, but after a page reload the only token a client can
recover is the staff one from 3e — the device token lived in memory and is gone.
With no logout endpoint in slice 2, a reloaded counter tab holding a live
session cannot switch employee.

### 3f-ii — same PIN, device token

```js
await call('staff-login', J(CSRF_DEV_A, { pin: '1101' }));
```

Expect `200` with `role:"manager"`. Together with 3f-i this isolates the cause to
the token class rather than the PIN, the session state or the limiter. Report
both results.

---

### 3g — logout (slice 3)

Device A, holding the staff csrf from 3f-ii (the manager session).

```js
const CSRF_STAFF_A = 'PASTE_csrf_FROM_3f-ii';
await call('staff-logout', J(CSRF_STAFF_A, {}));
```

Expect `200` with `{ok:true, kind:"device", csrf}` where `csrf` equals
`CSRF_DEV_A`, and a `Set-Cookie` that expires `__Host-pc_staff` (`Max-Age=0`).
The database check is the acceptance evidence: the 3f-ii session row now has
`revoked_reason = 'logout'`, and no other session on the enrollment changed.

### 3h — bootstrap falls back to the device

```js
await call('csrf-bootstrap');
```

Expect `200` with `kind:"device"` and the csrf from 3a. This is the state a
reloaded tab lands in after logout.

### 3i — the 3f gap, closed

```js
await call('staff-login', J(CSRF_DEV_A, { pin: '1102' }));
```

Expect `200` with `role:"staff"`. A tab that held only a staff token (3f-i)
can now log out, recover the device token in the same response, and sign in
the next employee.

### 3j — reuse after logout

```js
await call('staff-logout', J(CSRF_STAFF_A, {}));
```

Expect `401` — the revoked session no longer resolves (plan row 15). Note that
after 3i the browser holds a NEW staff cookie, so run 3j immediately after 3g
and before 3i, or read it as "old csrf against the new session", which is
also 401.

### 3k — kiosk entry revokes every live session on the device (slice 3)

Same device as 3i, which holds a live staff session. Note what "every" can
mean on one enrollment: rotation (F-4) guarantees at most ONE live session
per device at any moment, so from the server's view the set of live rows on
an enrollment has size 0 or 1. The probe therefore asserts what the endpoint
promises: every row that IS live is revoked with the kiosk reason, rows
already revoked keep their own reason, and other enrollments are untouched.
Rotate once more first so the enrollment carries three reasons to compare:

```js
const CSRF_STAFF_1 = 'PASTE_csrf_FROM_3i';
await call('staff-login', J(CSRF_DEV_A, { pin: '1101' }));   // 3i's row -> 'rotated…', new manager row live
await call('staff-session-revoke-all', J(CSRF_DEV_A, {}));
```

Expect `200` with `{ok:true, revoked:1}` and a `Set-Cookie` that expires
`__Host-pc_staff`. Database: on this enrollment the manager row now reads
`revoked_reason='kiosk entry'`, the rotated and logout rows keep their
reasons, and sessions on other enrollments are unchanged.

### 3l — both staff tokens are dead, the device is not

```js
await call('staff-login', J(CSRF_STAFF_1, { pin: '1102' }));   // staff csrf of a revoked session
await call('csrf-bootstrap');                                     // device cookie still resolves
await call('staff-session-revoke-all', J(CSRF_DEV_A, {}));       // nothing live
```

Expect `401`, then `200 kind:"device"`, then `200 {revoked:0}`.

**Scope of this substitution.** 3k/3l prove revoke-all's SERVER semantics on
one device: every live session revoked, count returned, cookie cleared. They
do NOT cover plan row 19 (two tabs, same browser: tab A enters kiosk, tab B
acts as staff). Row 19 is about tab B DISCOVERING the revocation on its next
request — a client concern for step 4 — and is not exercised here. Nor does a
`200` mean the tab is customer-safe: an owner's Supabase Auth session in the
same browser is a different credential class this endpoint never sees;
clearing it is the client's job at kiosk entry (step 4).

### 5a — owner revokes the device it is standing at (slice 3)

Device A holds a live staff session. Signed in as `owner-t1` in the normal
window; the revoke is sent FROM device A's own window so the request carries
the device's own cookies (an owner who finds a shared tablet revokes it from
that tablet). Get `ENR_A` from 3a's `enrollmentId`.

```js
await call('enroll-revoke', J(null, { enrollmentId: ENR_A, reason: 'probe: shared tablet' }, token()));
```

Expect `200` with `{ok:true, enrollmentId, storeId:"…0a1", sessionsRevoked:1}`.
Database: `device_enrollments` row has `revoked_by` = owner-t1 and the reason;
the live session row reads `revoked_reason = 'device revoked: probe: shared
tablet'`; earlier rows keep their own reasons.

### 5b — the device is dead

```js
await call('csrf-bootstrap');                                   // 401
await call('staff-login', J(CSRF_DEV_A, { pin: '1102' }));      // 401
await call('enroll-revoke', J(null, { enrollmentId: ENR_A }, token()));   // 200, sessionsRevoked:0 (idempotent)
```

### 5c — wrong tenant and unknown id answer identically, and change nothing

With `window.T2_OWNER` set (2c):

```js
await call('enroll-revoke', J(null, { enrollmentId: ENR_A }, window.T2_OWNER));            // 401
await call('enroll-revoke', J(null, { enrollmentId: crypto.randomUUID() }, token()));      // 401
```

Both `401`, same body. ENR_A's row is unchanged (still revoked by owner-t1 at
the 5a timestamp). The first call is the P5b property from the rehearsal: a
non-owner on an already-revoked enrollment is refused exactly as on a live
one, so revoked-vs-live in another tenant is not enumerable by status.

### 5d — the reason is bounded

```js
await call('enroll-revoke', J(null, { enrollmentId: ENR_A, reason: 'x'.repeat(201) }, token()));   // 400
```

### 5e — list: tenant-scoped, no secrets

```js
const L = await call('enroll-list');                             // owner-t1: 200, T1 devices incl. revoked with reason, liveSessions counts
/[0-9a-f]{64}|\x[0-9a-f]+|token|secret|created_by|revoked_by/i.test(L.body)   // false
await fetch(FN + 'enroll-list?storeId=' + T1, { headers: { authorization: 'Bearer ' + window.T2_OWNER } }).then(r => r.status)   // 401
```

`call('enroll-list')` needs the owner token: use
`fetch(FN + 'enroll-list', { headers: { authorization: 'Bearer ' + token() } })`.

---

**Client contract for a logout `401`:** treat it as "already in device state —
bootstrap again", not as an error. Refusals are uniform, so a tab cannot tell
already-logged-out from wrong-CSRF from expired, and the correct recovery is
the same for all three: call `csrf-bootstrap` and use whatever token class it
returns. A logout that "fails" has left nothing live that the caller could
have used.

---

## Phase 4 — negatives

### 4a — missing CSRF header

```js
await call('staff-login', J(null, { pin: '1102' }));
```

Expect `401`. Spends no budget: `csrfOk` runs before either limiter, so 4a and
4b do not disturb the counts in 4f.

### 4b — wrong CSRF value

```js
await call('staff-login', J('AAAA', { pin: '1102' }));
```

Expect `401`.

### 4c — cross-origin

Shell, not console: a console `fetch` from the staging tab always sends the
staging origin, and the allowlist cannot be tested by emptying it because
`originOk()` independently accepts `env.URL`.

```bash
curl -s -i -X POST \
  https://printcalculator2-staging.netlify.app/.netlify/functions/staff-login \
  -H 'content-type: application/json' \
  -H 'origin: https://evil.example.com' \
  -d '{}'
```

Expect `403` with `{"ok":false,"error":"Forbidden"}`.

### 4d — form-POST shape

```bash
curl -s -i -X POST \
  https://printcalculator2-staging.netlify.app/.netlify/functions/staff-login \
  -H 'content-type: application/x-www-form-urlencoded' \
  -H 'origin: https://printcalculator2-staging.netlify.app' \
  -d 'pin=1102'
```

Expect `415`. This is the shape that needs no CORS preflight, so the JSON
content-type requirement is carrying real weight rather than being decoration.

### 4e — cross-store PIN

Device A is enrolled to T1. `2202` is a real, active PIN in T2.

```js
await call('staff-login', J(CSRF_DEV_A, { pin: '2202' }));
```

Expect `401`. The store is derived from the enrollment row, never from a request
body, so a valid PIN from another tenant resolves nothing here.

### STOP

4e charged one attempt against `enr:<device A>` and one against
`store:<T1>`. Report Phase 4 results and wait: `auth_attempts` gets cleared on
staging by SQL so that 4f's counts are exact rather than off by one.

---

## 4f — the 57b regression

The one that matters. Two devices means two cookie jars: device A in the normal
window, device B in a **private window**. One browser profile cannot hold two
`__Host-pc_device` cookies for the same origin.

### 4f-i — mint a second ticket

Normal window, signed in as `owner-t1@example.invalid`.

```js
await call('enroll-ticket-create', J(null, { storeId: T1 }, token()));
```

Expect `200`. Copy the new `ticket`.

### 4f-ii — enroll device B

**Private window.** Open the staging URL, run the Setup block, then:

```js
const TICKET_B = 'PASTE_FROM_4f-i';
await call('enroll-redeem', J(null, { ticket: TICKET_B, label: 'Counter B' }));
```

Expect `200`. Save this window's `csrf` as device B's.

### 4f-iii — burn device A's budget

**Normal window.**

```js
const out = [];
for (let i = 0; i < 46; i++) {
  const r = await call('staff-login', J(CSRF_DEV_A, { pin: '9999' }));
  out.push(r.status);
}
console.log(out.join(','));
```

Expect **five `401`s followed by forty-one `429`s**. Five because
`p_max_attempts` counts admitted evaluations — attempts 1 through 5 are
evaluated and the 6th is refused. Four `401`s means the off-by-one regressed
(`attempts + 1 >= p_max_attempts` instead of `>`).

### 4f-iv — device B, correct PIN

**Private window.**

```js
const CSRF_DEV_B = 'PASTE_csrf_FROM_4f-ii';
await call('staff-login', J(CSRF_DEV_B, { pin: '1102' }));
```

Expect **`200`**. This is the assertion the whole phase exists for.

Under the pre-fix code both budgets were charged unconditionally, so each of
device A's 41 refused requests still spent one unit of the shared 30-request
store budget — and device B's correct PIN came back `429`. One attacker with one
enrolled device could deny the entire counter, which is the exact failure the
store-level budget was scoped to prevent. A `429` here means F-2 regressed.

Afterwards `auth_attempts` should show **5** against `store:<T1>`, not 46.

---

## A result is recorded only when the database agrees

Every positive probe leaves a row behind, so a reported pass can be checked
rather than trusted: 2a leaves a ticket, 3a an enrollment and a redeemed
ticket, 3d a staff session, and every admitted login attempt an
`auth_attempts` row. A "pass" for which the corresponding row does not exist
was not run against this target, whatever the console showed. Phase 3 was
reported as passing once while `device_enrollments` and `staff_sessions` were
both empty; those entries were reverted and the phase re-run.

The rule caught a second one on 2026-09-15: 3d returned `401` while both
limiters had admitted the attempt and `staff_sessions` stayed empty. The
handler's uniform `401` was hiding a `42702` from
`release2_create_staff_session` (an OUT column named `store_id` shadowing
`employees.store_id`), visible only in the postgres log. HTTP status alone
would have recorded a false FAIL on 3d and a false PASS on 4e. Migration 04
fixed it; its rehearsal calls the function with real rows, which the 03
rehearsal never did.

## Results

| probe | expected | observed |
|---|---|---|
| 1 (x4) | 401 | PASS |
| 2a | 200 + ticket | PASS (re-run 2026-09-15 14:15Z, ticket 7962dddd…, redeemed by 3a) |
| 2b | 401 | PASS |
| 2c | 401 for T1 **and** 200 for T2, same token | PASS 2026-09-16 — the same owner-t2 token (minted by the owner, placed in `window.T2_OWNER`) got `401` naming T1 and `200` naming T2 (ticket `d129c87d…`, storeId `…0a2`). The endpoint binds the store to the caller's membership, not to the body. DB: exactly one new ticket, store …0a2, created_by owner-t2; nothing for T1 |
| 2c-ui | admin panel refuses owner-t2 (client gate, not a substitute) | PASS |
| 3a | 200 + `__Host-pc_device` | PASS — 200, enrollment b79410ed… (DB row present); cookie invisible to document.cookie as expected, attributes not inspected |
| 3b | 401 | PASS |
| 3c | 200, kind=device, same csrf | PASS |
| 3d | 200, role=staff, `__Host-pc_staff` | PASS after migration 04 (2026-09-15 14:28Z): 200, employee `T1 Staff` role=staff, new csrf, expiresAt +12h; `staff_sessions` row present. First run FAILED 401: limiters admitted it, employee existed, but `release2_create_staff_session` raised 42702 `column reference "store_id" is ambiguous` (OUT column vs `employees.store_id`), rotation failed, handler returned authFailed(). Fixed by `supabase/migrations/pending/release2_04_staff_session_qualify_columns.sql`, staging ledger `20260915142741`. |
| 3e | 200, kind=staff | PASS — 200, kind=staff, csrf identical to 3d (first run returned kind=device as a consequence of the 3d failure) |
| 3f-i | 401 predicted (gap) | 401 — the predicted gap, confirmed with a live staff session: a reloaded tab holding only the staff csrf cannot switch employee |
| 3f-ii | 200, role=manager | PASS — 200, employee `T1 Manager` role=manager; DB shows the 3d staff session revoked with reason `rotated: new sign-in on this device` and exactly one live session (first run FAILED 401, same 42702 as 3d) |
| 3g | 200, kind=device, csrf = device csrf, staff cookie cleared; DB `revoked_reason='logout'` | PASS 2026-09-16 — 200, kind=device, csrf identical to the enrollment's; the manager session row reads `revoked_reason='logout'` (see DB note below) |
| 3h | 200, kind=device | PASS — 200, kind=device, csrf identical to 3a's |
| 3i | 200, role=staff (3f gap closed) | PASS — 200, `T1 Staff` role=staff using the csrf returned by 3g; bootstrap afterwards reads kind=staff |
| 3j | 401 | PASS — 401 on the revoked session's csrf, run immediately after 3g |
| 3k | 200 `{revoked:1}`, staff cookie cleared; DB live row -> `'kiosk entry'`, other reasons intact | PASS 2026-09-16 — `{"ok":true,"revoked":1}`; DB on Counter C: rotated, logout, rotated, **kiosk entry** — each row keeps its own reason (see DB note) |
| 3l | 401, then 200 kind=device, then 200 `{revoked:0}` | PASS — 401 for the 3i staff csrf AND for the just-revoked manager csrf; bootstrap 200 kind=device with the enrollment's csrf; second revoke-all 200 `{revoked:0}` |
| 5a | 200 `{sessionsRevoked:1}` from the revoked device itself; DB `revoked_by`=owner-t1, cascade reason names the device | PASS 2026-09-16 — run from the owner's own window enrolled as `Counter D`, so the request carried the revoked device's cookies plus the owner JWT: 200 `{sessionsRevoked:1}`. DB: `revoked_by` owner-t1, reason `probe: shared tablet`, the session reads `device revoked: probe: shared tablet`; Counter C untouched (live 1) |
| 5b | 401, 401, then 200 `{sessionsRevoked:0}` | PASS — bootstrap 401, staff-login 401 with the device csrf AND with the staff csrf, second revoke 200 `{sessionsRevoked:0}` |
| 5c | 401 both, identical body, row unchanged | PASS 2026-09-17 — owner-t1 naming an unknown id: 401. Fresh owner-t2 token (positive control: its own-store list returned 200 immediately before AND after): 401 on the revoked Counter D and 401 on the live Counter C, identical bodies — revoked-vs-live not enumerable. DB: both rows unchanged, Counter D still revoked by owner-t1 at the 5a timestamp, Counter C still live. (First attempt on 09-16 used a token that had expired; discarded) |
| 5d | 400 | PASS — 201 chars and a newline both 400 `reason must be at most 200 printable characters` |
| 5e | 200 with reasons and live counts, no secrets; T2 owner naming T1 -> 401 | PASS — owner-t1: 200, `Counter D` revoked with reason and 0 live, `Counter C` live 1; body keys exactly id/label/createdAt/lastSeenAt/revokedAt/revokedReason/liveSessions, no hex64/bytea/hash/csrf/created_by/revoked_by. owner-t2 (fresh token): own store 200 with storeId …0a2 and 0 devices; naming T1 -> 401 |
| 4a | 401 | PASS (device cookie present; no attempt charged) — re-run after 04, same |
| 4b | 401 | PASS (device cookie present; no attempt charged) — re-run after 04, same |
| 4c | 403 | PASS — `{"ok":false,"error":"Forbidden"}` |
| 4d | 415 | PASS — `{"ok":false,"error":"Unsupported Media Type"}` |
| 4e | 401 | PASS — 401 re-run after 04, with 3d/3f-ii proving a correct same-store PIN on this device returns 200 |
| 4f-iii | 5x401 then 41x429 | PASS 2026-09-15 — `401,401,401,401,401` then 41×`429`, first 429 at attempt 6 |
| 4f-iv | 200 | PASS — 200, employee `T1 Staff` role=staff on device B (separate cookie jar: bootstrap was 401 there before enrolling); `auth_attempts` store subject read 6 afterwards (5 admitted from device A + 1 from device B), never 46 |
