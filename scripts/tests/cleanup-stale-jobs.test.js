// scripts/tests/cleanup-stale-jobs.test.js
// Row 41: cleanup-stale-jobs was an UNAUTHENTICATED DESTRUCTIVE URL.
//
// Measured on staging 2026-09-12: it returned 200 over plain HTTP despite
// `export const config = { schedule: "@hourly" }`. The plan and two review
// rounds assumed Netlify made scheduled functions unreachable. It did not.
//
// The previous signature was `async () => {…}` — no event parameter at all, so
// no method, caller or header could be checked even in principle.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("../../netlify/functions/cleanup-stale-jobs.js", import.meta.url), "utf8");

// Run fn with env applied for the WHOLE call. An earlier version restored the
// environment right after import, so CLEANUP_SECRET was gone by the time the
// handler read it — every auth test got 503 instead of 401 and I nearly
// "fixed" working source.
async function withEnv(env, fn) {
  const saved = { ...process.env };
  Object.assign(process.env, env);
  try {
    const mod = await import("../../netlify/functions/cleanup-stale-jobs.js");
    return await fn(mod);
  } finally {
    for (const k of Object.keys(env)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

const ev = (over = {}) => ({
  httpMethod: "POST",
  headers: {},
  body: "{}",
  ...over,
});

const BASE = {
  CLEANUP_SECRET: "s3cret-value-of-known-length",
  SUPABASE_URL: "https://lboajqihpsfrokqvjgnl.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "svc",
};

test("REGRESSION: the handler receives the event at all", () => {
  // The whole bug in one line. `async () =>` cannot check anything.
  // Match at line start so the header comment, which QUOTES the old broken
  // signature, is not mistaken for the code. My first version of this
  // assertion failed on its own documentation.
  assert.match(SRC, /^export const handler = async \(event\)/m,
    "handler must take the event — the vulnerable version did not");
  assert.doesNotMatch(SRC, /^export const handler = async \(\s*\)\s*=>/m,
    "a zero-argument handler cannot authenticate its caller");
});

test("ROW 41: GET is refused (the old handler accepted any method)", async () => {
  await withEnv(BASE, async ({ handler }) => {
    assert.equal((await handler(ev({ httpMethod: "GET" }))).statusCode, 405);
  });
});

test("ROW 41: POST with NO secret is refused", async () => {
  await withEnv(BASE, async ({ handler }) => {
    const r = await handler(ev());
    assert.equal(r.statusCode, 401);
    assert.equal(JSON.parse(r.body).error, "Unauthorized");
  });
});

test("ROW 41: POST with a WRONG secret is refused", async () => {
  await withEnv(BASE, async ({ handler }) => {
    const wrong = "w".repeat(BASE.CLEANUP_SECRET.length);
    assert.equal((await handler(ev({ headers: { "x-cleanup-key": wrong } }))).statusCode, 401);
  });
});

test("ROW 41: the forged SCHEDULED body does not authenticate", async () => {
  // Netlify's scheduled invocation is a POST of {"next_run": "<ISO>"} with no
  // signature. Any caller can send it, which is exactly why this handler does
  // NOT try to detect the scheduler.
  await withEnv(BASE, async ({ handler }) => {
    const r = await handler(ev({ body: JSON.stringify({ next_run: new Date().toISOString() }) }));
    assert.equal(r.statusCode, 401, "a forgeable body must never be proof of the scheduler");
  });
});

test("an UNCONFIGURED secret refuses — never 'allow because unconfigured'", async () => {
  await withEnv({ ...BASE, CLEANUP_SECRET: "" }, async ({ handler }) => {
    const r = await handler(ev({ headers: { "x-cleanup-key": "anything" } }));
    assert.equal(r.statusCode, 503);
    assert.equal(JSON.parse(r.body).error, "Service Unavailable");
  });
});

test("the refusal explains nothing to the caller", async () => {
  await withEnv(BASE, async ({ handler }) => {
    const r = await handler(ev({ headers: { "x-cleanup-key": "x" } }));
    assert.doesNotMatch(r.body, /secret|CLEANUP|header|length/i);
  });
});

test("secret comparison is length-safe and rejects a prefix", async () => {
  await withEnv(BASE, async ({ handler }) => {
    const r = await handler(ev({ headers: { "x-cleanup-key": BASE.CLEANUP_SECRET.slice(0, 5) } }));
    assert.equal(r.statusCode, 401);
  });
});

test("authenticated: dryRun reports and deletes NOTHING; armed run deletes", async () => {
  const rows = [
    { id: "a", files: [{ path: "p1" }, { path: "p2" }], created_at: "2020-01-01" },
    { id: "b", files: [], created_at: "2020-01-01" },
  ];
  const mkClient = (calls) => () => ({
    from: () => ({
      select: () => ({ lt: () => ({ limit: async () => ({ data: rows, error: null }) }) }),
      delete: () => ({ eq: async () => { calls.push("row-delete"); return { error: null }; } }),
    }),
    storage: { from: () => ({ remove: async () => { calls.push("obj-remove"); return { error: null }; } }) },
  });

  await withEnv(BASE, async ({ handler, __setClientFactory }) => {
    const hdrs = { "x-cleanup-key": BASE.CLEANUP_SECRET };

    const dryCalls = [];
    __setClientFactory(mkClient(dryCalls));
    const dry = JSON.parse((await handler(ev({ headers: hdrs, body: '{"dryRun":true}' }))).body);
    assert.equal(dry.dryRun, true);
    assert.equal(dry.wouldDelete, 2);
    assert.equal(dry.wouldRemoveObjects, 2);
    assert.deepEqual(dryCalls, [], "dry run must not delete anything");

    const realCalls = [];
    __setClientFactory(mkClient(realCalls));
    const real = JSON.parse((await handler(ev({ headers: hdrs, body: "{}" }))).body);
    assert.equal(real.deleted, 2);
    assert.equal(real.objects, 2);
    assert.ok(realCalls.includes("obj-remove") && realCalls.includes("row-delete"));

    __setClientFactory(null);
  });
});

test("the schedule export is retained, and the file says the schedule now fails closed", () => {
  assert.match(SRC, /export const config = \{ schedule: "@hourly" \}/);
  assert.match(SRC, /FAIL CLOSED|fail closed/i);
  assert.match(SRC, /RE-ARMING THE SCHEDULE/);
});

test("the file records the measured finding, not the documented assumption", () => {
  assert.match(SRC, /returns 200 over plain HTTP/i);
  assert.match(SRC, /UNLOADED, NOT ABSENT/);
});
