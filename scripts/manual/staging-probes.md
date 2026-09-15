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

## Results

| probe | expected | observed |
|---|---|---|
| 1 (x4) | 401 | PASS |
| 2a | 200 + ticket | PASS |
| 2b | 401 | PASS |
| 2c | 401 for T1 **and** 200 for T2, same token | |
| 2c-ui | admin panel refuses owner-t2 (client gate, not a substitute) | PASS |
| 3a | 200 + `__Host-pc_device` | |
| 3b | 401 | |
| 3c | 200, kind=device, same csrf | |
| 3d | 200, role=staff, `__Host-pc_staff` | |
| 3e | 200, kind=staff | |
| 3f-i | 401 predicted (gap) | |
| 3f-ii | 200, role=manager | |
| 4a | 401 | |
| 4b | 401 | |
| 4c | 403 | |
| 4d | 415 | |
| 4e | 401 | |
| 4f-iii | 5x401 then 41x429 | |
| 4f-iv | 200 | |
