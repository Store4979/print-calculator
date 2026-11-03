// scripts/tests/stage0-guard.lock.test.js — the store lock (F2) and the
// readers' locked snapshots (F3), under Codex's review of the G-6 addendum
// (2026-11-02). Faults are injected into a copy of the real module
// (guardCopy): its lock's exclusive create is driven by a test plan, and its
// logged() can pause between an event's files and its ledger line. The copy
// is reachable from no command line, and every case uses a throwaway store.
//
//   LK-1  F2: a transient EEXIST, EPERM, EACCES or EBUSY is retried; the
//         critical section runs once; the EEXIST-only rule refuses the others
//   LK-2  F2: a lasting busy code refuses at the bound, naming it; only a lock
//         file that is there is reported as another process's lock
//   LK-3  F2: a non-retryable create error refuses at the first attempt
//   LK-4  F2: a critical section that throws releases the lock, unrepeated
//   LK-5  F2: the outcome of a dispatched send: a transient fault is waited
//         through; a lasting one is AfterDispatch, the claim, receipt and hold
//         kept, one request; the EEXIST-only rule loses the outcome; a lock
//         wait never extends the go's deadline
//   LK-6  F2: real processes on the real lock: never two holders at once, by
//         an exclusion witness every counted section established (W-R2)
//   LK-6b W-R2: a witness that cannot be established (injected EACCES,
//         EPERM) fails LK-6's verifier; W's checks alone accepted it
//   SN-1  F3: a writer paused between a change's file and its ledger line:
//         status, gate and the sender's first check are BUSY, never DAMAGED,
//         and change nothing; afterwards each reads the finished state
//   SN-2  F3: a reader that waits behind the paused writer reads its finished
//         change
//   SN-3  F3: a writer paused mid-claim, then in flight: BUSY, then a
//         genuinely PENDING attempt in one coherent snapshot
//   SN-4  F3: planted damage, with and without another writer: DAMAGED in a
//         locked snapshot, BUSY while the writer holds the lock, DAMAGED after
//   SN-5  F3: a missing store or ledger; the reader's own lock; a stale lock
//   SN-M  F3's mutation companion: without the protected snapshot the
//         paused-writer case reads as DAMAGED, which SN-1 refuses
//   SN-6  W-R3: a real holder process, then killed: the same BUSY before and
//         after its exit, the lock left in place; after a test-only removal,
//         the real state (intact, a PENDING hold that survives, or damage)
//   HL-1  W-N1: releaseTogether leaves no timer behind, on its success,
//         early-exit and afterStart-failure paths; a deliberate leak is seen
// (Codex's review of W, 2026-11-02, for LK-6b, SN-6 and HL-1.)
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, mkdtempSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import * as G from "../manual/stage0-guard.mjs";
import { fixture, synthWorkflow, M, ROOT, nonce, releaseTogether, within, holder, guardCopy, EEXIST_ONLY, NO_SNAPSHOT } from "./stage0-guard-fixture.mjs";

const PROD = "gmxyisjjaxtpycsmmzef";
const PHASES = { P: [["A1", "P2-01"], ["A2", "STATE"], ["A3", "P2-02"]], Y: [["Y1", "STATE"]] };
const WF = () => ({ t: synthWorkflow("production", PHASES) });
const FIXTURE_URL = pathToFileURL(join(ROOT, "scripts", "tests", "stage0-guard-fixture.mjs")).href;
const MEASUREMENT = { status: "Leap Indicator: 0(no warning)\nLast Successful Sync Time: 10/28/2026 9:00:00 AM\nSource: time.windows.com,0x9\n", stripchart: "10:00:00, +00.0100000s\n10:00:01, +00.0110000s\n10:00:02, -00.0090000s\n" };
const tick = (ms) => new Promise((r) => setTimeout(r, ms));

// The copies: X injects faults and pauses; OLD is X under the EEXIST-only
// rule; SHORT waits 200 ms for the lock (600 ms for an outcome); NOSNAP reads
// without the protected snapshot.
const DIR = mkdtempSync(join(tmpdir(), "s0-lock-"));
test.after(() => rmSync(DIR, { recursive: true, force: true }));
const X = await guardCopy(DIR, "x");
const OLD = (await guardCopy(DIR, "eexist-only", [[EEXIST_ONLY.from, EEXIST_ONLY.to]])).mod;
const SHORT_EDIT = ["export const LOCK_WAIT_MS = 10 * 1000;", "export const LOCK_WAIT_MS = 200;"];
const SHORT = (await guardCopy(DIR, "short", [SHORT_EDIT])).mod;
const SHORT_OLD = (await guardCopy(DIR, "short-eexist-only", [SHORT_EDIT, [EEXIST_ONLY.from, EEXIST_ONLY.to]])).mod;
const NOSNAP = (await guardCopy(DIR, "nosnap", [[NO_SNAPSHOT.from, NO_SNAPSHOT.to]])).mod;

const arm = (mod, plan) => { mod.__faults.attempts = 0; mod.__faults.plan = plan; };
const disarm = (mod) => { mod.__faults.plan = null; };
/** The error fn throws (synchronously or by rejecting), or null. */
async function caught(fn) { try { await fn(); return null; } catch (e) { return e; } }
const liveGos = (fx) => readdirSync(fx.paths.gos).filter((f) => f.endsWith(".json"));
const holds = (fx) => G.holdsOf(G.readJournal(fx.paths, PROD), { ctxAt: fx.ctxAt });
const all = (fx) => ({ ...G.WORKFLOWS, ...fx.workflows });

/** A store with a clock check, phase P, an R (1001) and a W (1002) window, and A1's go. */
function setupP() {
  const fx = fixture({ workflows: WF() });
  fx.clock();
  const ph = fx.phase("t", "P");
  const R = fx.window("R", ph.phaseId, { pid: 1001 });
  const W = fx.window("W", ph.phaseId, { pid: 1002 });
  const go = fx.issue(ph.phaseId, "A1");
  return { fx, ph, R, W, go };
}

const statusOf = (mod, fx, lockWaitMs) => mod.status({ paths: fx.paths, anchor: fx.anchor, manifest: M, ref: PROD, ctxAt: fx.ctxAt, clock: fx.now, ...(lockWaitMs ? { lockWaitMs } : {}) });
const gateOf = (mod, fx, phaseId, lockWaitMs) => mod.phaseGate({ paths: fx.paths, anchor: fx.anchor, manifest: M, phaseId, workflows: all(fx), ctxAt: fx.ctxAt, clock: fx.now, ...(lockWaitMs ? { lockWaitMs } : {}) });

// ── F2: the lock's acquisition ──────────────────────────────────────────────

test("LK-1 F2: a transient EEXIST, EPERM, EACCES or EBUSY on the lock's exclusive create is retried within the wait, and the critical section runs once, after the create succeeds; under the EEXIST-only rule EPERM, EACCES and EBUSY refuse at once and it never runs", async () => {
  assert.deepEqual([...G.LOCK_BUSY_CODES], ["EEXIST", "EPERM", "EACCES", "EBUSY"]);
  for (const code of G.LOCK_BUSY_CODES) {
    for (const [label, mod] of [["the retry", X.mod], ["the EEXIST-only rule", OLD]]) {
      const fx = fixture({ workflows: WF() });
      try {
        let runs = 0;
        arm(mod, (n) => (n <= 3 ? code : null));
        const call = () => mod.withLock(fx.paths, () => { runs++; assert.ok(existsSync(fx.paths.lock), "the section runs holding the lock file"); return "done"; }, fx.now(), 5000);
        if (mod === X.mod || code === "EEXIST") {
          assert.equal(call(), "done", `${code}, ${label}`);
          assert.equal(runs, 1, `${code}, ${label}: the section ran once`);
          assert.equal(mod.__faults.attempts, 4, `${code}, ${label}: three failed creates, then the lock`);
        } else {
          const e = await caught(call);
          assert.ok(e instanceof mod.LockUnavailable, `${code}, ${label}: ${e && e.message}`);
          assert.equal(e.message, `the store lock cannot be taken (${code}); refusing`);
          assert.equal(runs, 0, `${code}, ${label}: the section never ran`);
          assert.equal(mod.__faults.attempts, 1, `${code}, ${label}: refused at the first create`);
        }
        assert.equal(existsSync(fx.paths.lock), false, `${code}, ${label}: no lock is left`);
      } finally { disarm(mod); fx.cleanup(); }
    }
  }
});

test("LK-2 F2: a busy code that lasts refuses at the bound and names it; only EEXIST is reported as another guard process's lock; the critical section never runs, and a waiter never removes a lock file", async () => {
  for (const code of G.LOCK_BUSY_CODES) {
    const fx = fixture({ workflows: WF() });
    try {
      let runs = 0;
      arm(X.mod, () => code);
      const t = Date.now();
      const e = await caught(() => X.mod.withLock(fx.paths, () => { runs++; }, fx.now(), 300));
      assert.ok(e instanceof X.mod.LockUnavailable, `${code}: ${e && e.message}`);
      assert.ok(Date.now() - t >= 300, `${code}: it waited the bound`);
      assert.ok(X.mod.__faults.attempts >= 2, `${code}: it retried`);
      assert.equal(runs, 0, `${code}: the section never ran`);
      if (code === "EEXIST") assert.match(e.message, /^another guard process has held the store lock for over 0\.3 s \(an unknown time\)\. /);
      else {
        assert.equal(e.message, `the store lock could not be taken within 0.3 s: its exclusive create still failed with ${code}. That error does not show which process, if any, holds it; refusing`);
        assert.ok(!/another guard process/.test(e.message), `${code}: no owner is claimed`);
      }
      assert.equal(existsSync(fx.paths.lock), false, `${code}: no lock file was made`);
    } finally { disarm(X.mod); fx.cleanup(); }
  }
  // A real lock file another process left: named, waited for, and left where it is.
  const fx = fixture({ workflows: WF() });
  try {
    writeFileSync(fx.paths.lock, "pid 4242 since 2026-10-28T14:00:00.000Z");
    let runs = 0;
    const e = await caught(() => G.withLock(fx.paths, () => { runs++; }, fx.now(), 300));
    assert.ok(e instanceof G.LockUnavailable);
    assert.equal(e.message, `another guard process has held the store lock for over 0.3 s (pid 4242 since 2026-10-28T14:00:00.000Z). ${G.STALE_LOCK_STEPS(fx.paths.lock)}; refusing`);
    assert.ok(!/check with stage0-go\.mjs status, then remove/.test(e.message), "not the old advice, which sent status to check itself");
    assert.equal(runs, 0);
    assert.equal(readFileSync(fx.paths.lock, "utf8"), "pid 4242 since 2026-10-28T14:00:00.000Z", "the waiter left the lock file as it was");
  } finally { fx.cleanup(); }
});

test("LK-3 F2: a create error outside LOCK_BUSY_CODES refuses at the first attempt, names it, and the critical section never runs", async () => {
  for (const code of ["ENOENT", "EROFS", "EISDIR", "EMFILE", "EIO"]) {
    const fx = fixture({ workflows: WF() });
    try {
      let runs = 0;
      arm(X.mod, (n) => (n === 1 ? code : null));
      const e = await caught(() => X.mod.withLock(fx.paths, () => { runs++; }, fx.now(), 5000));
      assert.ok(e instanceof X.mod.LockUnavailable, `${code}: ${e && e.message}`);
      assert.equal(e.message, `the store lock cannot be taken (${code}); refusing`);
      assert.equal(X.mod.__faults.attempts, 1, `${code}: one attempt`);
      assert.equal(runs, 0);
      assert.equal(existsSync(fx.paths.lock), false);
    } finally { disarm(X.mod); fx.cleanup(); }
  }
});

test("LK-4 F2: a critical section that throws, an Error or a Refusal, after a retried create, releases the lock and throws the same error; it ran once and is not repeated", async () => {
  const fx = fixture({ workflows: WF() });
  try {
    for (const thrown of [new Error("the section failed"), new X.mod.Refusal("refused inside; refusing")]) {
      let runs = 0;
      arm(X.mod, (n) => (n === 1 ? "EPERM" : null));
      const e = await caught(() => X.mod.withLock(fx.paths, () => { runs++; throw thrown; }, fx.now(), 5000));
      assert.equal(e, thrown, "the same error, unwrapped");
      assert.equal(runs, 1, "run once, never again");
      assert.equal(X.mod.__faults.attempts, 2);
      assert.equal(existsSync(fx.paths.lock), false, "released");
      disarm(X.mod);
      assert.equal(X.mod.withLock(fx.paths, () => "next", fx.now(), 300), "next", "the next holder takes it at once");
    }
  } finally { disarm(X.mod); fx.cleanup(); }
});

test("LK-5 F2: a dispatched send's outcome: a transient lock fault is waited through; a lasting one is AfterDispatch with the claim, receipt and hold kept and one request; the EEXIST-only rule loses it; a delayed claim lock never extends the go's deadline", async () => {
  /** Send A1 through `mod`; from the request on, `planAfter(n, k)` drives the creates (k: the count at the request). */
  const sendWith = async (mod, planAfter) => {
    const s = setupP();
    let k = null;
    arm(mod, null);
    const fetchImpl = async (url, init) => {
      s.fx.calls.push({ url, init });
      k = mod.__faults.attempts;
      mod.__faults.plan = (n) => planAfter(n, k);
      return new Response('[{"set_config":"45s"}]', { status: 201 });
    };
    const r = await s.fx.send(mod, { text: "P2-01", target: "production", win: s.W, goId: s.go.goId, over: { fetchImpl } }).catch((e) => e);
    disarm(mod);
    return { ...s, r, k };
  };
  {
    const s = await sendWith(X.mod, (n, k) => (n > k && n <= k + 3 ? "EPERM" : null));
    try {
      assert.ok(s.r && s.r.record, `transient: recorded (${s.r && s.r.message})`);
      assert.equal(s.fx.calls.length, 1, "transient: one request");
      assert.equal(X.mod.__faults.attempts, s.k + 4, "transient: three failed creates, then the outcome's lock");
      const entries = G.readJournal(s.fx.paths, PROD);
      assert.equal(entries.length, 1);
      assert.equal(entries[0].outcome.state, "DISPATCHED");
      assert.deepEqual(holds(s.fx), [], "transient: nothing holds");
      assert.equal(s.fx.check().ok, true);
      assert.equal(existsSync(s.fx.paths.lock), false);
    } finally { s.fx.cleanup(); }
  }
  // Lasting, and the EEXIST-only rule on a transient fault: both lose the outcome.
  for (const [label, mod, plan, re] of [
    ["lasting EPERM", SHORT, (n, k) => (n > k ? "EPERM" : null), /its outcome could not be recorded \(the store lock could not be taken within 0\.6 s: its exclusive create still failed with EPERM\./],
    ["the EEXIST-only rule, a transient EPERM", OLD, (n, k) => (n > k && n <= k + 3 ? "EPERM" : null), /its outcome could not be recorded \(the store lock cannot be taken \(EPERM\); refusing\)/],
  ]) {
    const s = await sendWith(mod, plan);
    try {
      assert.ok(s.r instanceof mod.AfterDispatch, `${label}: AfterDispatch, got ${s.r && s.r.constructor.name}: ${s.r && s.r.message}`);
      assert.match(s.r.message, re, label);
      assert.equal(s.fx.calls.length, 1, `${label}: exactly one request, never resent`);
      const entries = G.readJournal(s.fx.paths, PROD);
      assert.equal(entries.length, 1, `${label}: the claim is kept`);
      assert.equal(entries[0].outcome, null, `${label}: no outcome`);
      assert.deepEqual(holds(s.fx).map((h) => [h.kind, h.attemptId]), [["PENDING", entries[0].attemptId]], `${label}: it holds the project`);
      const file = /its receipt written to (.+), but its outcome/.exec(s.r.message)[1];
      assert.equal(G.readState(file).guard.attemptId, entries[0].attemptId, `${label}: the receipt is kept, bound to the claim`);
      assert.equal(s.fx.check().ok, true, `${label}: the store is intact`);
      assert.equal(existsSync(s.fx.paths.lock), false);
    } finally { s.fx.cleanup(); }
  }
  // The claim's lock, delayed by transient faults past the go's deadline: no claim, no request.
  {
    const s = setupP();
    try {
      const D = G.utcMs(s.go.deadline);
      let k = 0;
      s.fx.set(D - 1);
      arm(X.mod, (n) => (n >= 2 && n <= 4 ? "EBUSY" : null));
      const e = await s.fx.send(X.mod, { text: "P2-01", target: "production", win: s.W, goId: s.go.goId, over: { now: () => (++k <= 1 ? D - 1 : D) } }).catch((x) => x);
      assert.ok(e instanceof X.mod.Refusal, `refused: ${e && e.message}`);
      assert.match(e.message, /deadline .* has passed/);
      assert.equal(X.mod.__faults.attempts, 5, "the first check, three failed creates, then the claim's lock");
      assert.equal(s.fx.calls.length, 0, "no request");
      assert.equal(G.readJournal(s.fx.paths, PROD).length, 0, "no claim");
      assert.deepEqual(liveGos(s.fx), [`${s.go.goId}.json`], "the go is still live");
    } finally { disarm(X.mod); s.fx.cleanup(); }
  }
});

const STRESS = `
import { readFileSync, writeFileSync, existsSync, openSync, closeSync, unlinkSync } from "node:fs";
const c = JSON.parse(readFileSync(process.argv[2], "utf8"));
const G = await import(c.guardUrl);
const paths = G.statePaths(c.stateDir);
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
writeFileSync(c.ready, String(process.pid));
const until = Date.now() + c.startWithinMs;
while (!existsSync(c.start)) { if (Date.now() > until) process.exit(3); await new Promise((r) => setTimeout(r, 2)); }
const out = { ran: 0, sections: 0, witnessed: 0, breaches: 0, markerErrors: {}, refusals: {} };
const count = (o, k) => { o[k] = (o[k] || 0) + 1; };
for (let i = 0; i < c.m; i++) {
  try {
    G.withLock(paths, () => {
      out.sections++;
      // The exclusion witness: its own exclusive create, then its removal. A
      // section counts as observed only when both succeed (witnessed).
      let fd;
      try {
        if (c.witnessFault) { const e = new Error(c.witnessFault + ": injected on the witness"); e.code = c.witnessFault; throw e; }
        fd = openSync(c.marker, "wx");
      } catch (e) { if (e.code === "EEXIST") out.breaches++; else count(out.markerErrors, "create " + e.code); return; }
      closeSync(fd);
      sleep(1);
      for (let t = 0; ; t++) { try { unlinkSync(c.marker); break; } catch (e) { if (t > 500) { count(out.markerErrors, "remove " + e.code); return; } sleep(1); } }
      out.witnessed++;
    }, Date.now());
    out.ran++;
  } catch (e) { count(out.refusals, e.constructor.name); }
}
writeFileSync(c.out, JSON.stringify(out));
process.exit(0);
`;

/**
 * LK-6's verifier (W-R2, Codex's review of W): the problems in the stress
 * workers' results, [] when there are none. Every process ran to its end;
 * no witness error of any kind; never two holders (no EEXIST on the
 * witness); every acquisition ran its section once and every section
 * established its witness (witnessed == sections == ran); every call either
 * ran or was refused, and only as LockUnavailable.
 */
function stressProblems(res, m) {
  const p = [];
  for (const r of res) if (!(r.exitCode === 0 && r.signal === null && r.out)) p.push(`process ${r.pid} did not run to its end (exit ${r.exitCode}, signal ${r.signal})`);
  if (p.length) return p;
  const sum = (k) => res.reduce((n, r) => n + r.out[k], 0);
  for (const r of res) for (const [k, n] of Object.entries(r.out.markerErrors)) p.push(`process ${r.pid}: ${n} witness error(s) ${k}`);
  if (sum("breaches") !== 0) p.push(`${sum("breaches")} section(s) found another holder's witness`);
  if (sum("witnessed") !== sum("sections")) p.push(`${sum("sections") - sum("witnessed")} section(s) without an established witness`);
  if (sum("sections") !== sum("ran")) p.push(`${sum("sections")} sections for ${sum("ran")} acquisitions`);
  const refusals = res.reduce((n, r) => n + Object.values(r.out.refusals).reduce((a, b) => a + b, 0), 0);
  if (sum("ran") + refusals !== res.length * m) p.push(`${sum("ran")} ran and ${refusals} refused, of ${res.length * m} calls`);
  for (const r of res) for (const k of Object.keys(r.out.refusals)) if (k !== "LockUnavailable") p.push(`process ${r.pid}: a refusal ${k}`);
  return p;
}

/** W's checks alone, kept to show the gap LK-6b closes: they never read the witness's errors. */
function wCheckProblems(res, m) {
  const sum = (k) => res.reduce((n, r) => n + r.out[k], 0);
  const refusals = res.reduce((n, r) => n + Object.values(r.out.refusals).reduce((a, b) => a + b, 0), 0);
  return [sum("breaches") === 0, sum("sections") === sum("ran"), sum("ran") + refusals === res.length * m].every(Boolean) ? [] : ["W's checks fail"];
}

/** n real stress processes, m calls each, on the fixture's real lock; `extra` reaches each worker's config. */
const stressRun = (fx, name, n, m, extra = {}) => {
  const dir = join(fx.dir, name);
  mkdirSync(dir);
  writeFileSync(join(dir, "stress.mjs"), STRESS);
  const marker = join(fx.dir, `${name}-inside`);
  return releaseTogether({ dir, script: join(dir, "stress.mjs"), cfgs: Array.from({ length: n }, () => ({ guardUrl: pathToFileURL(join(ROOT, "scripts", "manual", "stage0-guard.mjs")).href, stateDir: fx.stateDir, marker, m, ...extra })), doneMs: 240000 });
};

test("LK-6 F2: real processes contend for the real lock: never two holders at once, by a witness every counted section established; each section ran once per acquisition; a refusal is only LockUnavailable", { timeout: 300000 }, async () => {
  const fx = fixture({ workflows: WF() });
  try {
    const m = 150;
    const res = await stressRun(fx, "lk6", 3, m);
    const d = JSON.stringify(res.map((r) => ({ pid: r.pid, exitCode: r.exitCode, signal: r.signal, out: r.out, stderr: r.stderr || undefined })));
    assert.deepEqual(stressProblems(res, m), [], d);
    assert.ok(res.reduce((n, r) => n + r.out.witnessed, 0) > 0, `some sections ran and were witnessed: ${d}`);
    assert.equal(existsSync(fx.paths.lock), false, "no lock is left");
    assert.equal(fx.check().ok, true, "the store is unchanged");
  } finally { fx.cleanup(); }
});

test("LK-6b W-R2: a witness that cannot be established (an injected EACCES or EPERM on its create) fails LK-6's verifier, though W's checks alone accept the same run", { timeout: 120000 }, async () => {
  for (const code of ["EACCES", "EPERM"]) {
    const fx = fixture({ workflows: WF() });
    try {
      const m = 5;
      const res = await stressRun(fx, `lk6b-${code}`, 2, m, { witnessFault: code });
      const d = JSON.stringify(res.map((r) => ({ pid: r.pid, exitCode: r.exitCode, out: r.out, stderr: r.stderr || undefined })));
      for (const r of res) assert.ok(r.exitCode === 0 && r.out && r.out.sections > 0, `${code}: the workers ran their sections: ${d}`);
      const p = stressProblems(res, m);
      assert.ok(p.some((x) => x.includes(`witness error(s) create ${code}`)), `${code}: the witness error is a problem: ${p.join("; ")}`);
      assert.ok(p.some((x) => / section\(s\) without an established witness$/.test(x)), `${code}: the unwitnessed sections are a problem: ${p.join("; ")}`);
      assert.deepEqual(wCheckProblems(res, m), [], `${code}: W's checks alone accept this run, which is the gap: ${d}`);
      assert.equal(existsSync(fx.paths.lock), false, `${code}: no lock is left`);
    } finally { fx.cleanup(); }
  }
});

// ── F3: the readers' locked snapshots ───────────────────────────────────────

const WRITER = `
import { readFileSync, writeFileSync, existsSync } from "node:fs";
const c = JSON.parse(readFileSync(process.argv[2], "utf8"));
const F = await import(c.fixtureUrl);
const X = await import(c.copyUrl);
const fx = F.fixture({ workflows: { t: F.synthWorkflow("production", c.phases) }, attach: { stateDir: c.stateDir, results: c.results }, t0: c.now });
for (const pid of c.shells || []) fx.shell(pid);
Object.assign(X.__pause, c.pause);
writeFileSync(c.ready, String(process.pid));
const until = Date.now() + c.startWithinMs;
while (!existsSync(c.start)) { if (Date.now() > until) process.exit(3); await new Promise((r) => setTimeout(r, 2)); }
let out;
try {
  if (c.mode === "clock") { X.recordClock({ paths: fx.paths, anchor: fx.anchor, manifest: F.M, measurement: c.measurement, now: c.now }); out = { ok: true }; }
  else if (c.mode === "close") { const r = X.closeSession({ paths: fx.paths, env: c.env, now: c.now }); out = { ok: r.problems.length === 0, closed: r }; }
  else if (c.mode === "hang") {
    const fetchImpl = async () => { writeFileSync(c.out + ".fetched", "1"); setInterval(() => {}, 1000); return new Promise(() => {}); };
    await fx.send(X, { text: "P2-01", target: "production", win: { env: c.env, pid: c.pid }, goId: c.goId, over: { fetchImpl } });
    out = { ok: true };
  } else out = { ok: false, message: "unknown mode" };
} catch (e) { out = { ok: false, name: e.constructor.name, message: e.message }; }
writeFileSync(c.out, JSON.stringify(out));
process.exit(0);
`;

/**
 * Run one writer process through the copy X, paused by `c.pause` between an
 * event's files and its ledger line; `during(worker, files)` runs while it is
 * paused, and the writer is resumed after. Returns the writer's result.
 */
async function writer(fx, c, during) {
  const dir = join(fx.dir, `wr-${randomBytes(3).toString("hex")}`);
  mkdirSync(dir);
  const script = join(dir, "writer.mjs");
  writeFileSync(script, WRITER);
  const files = { paused: join(dir, "paused"), resume: join(dir, "resume") };
  const res = await releaseTogether({
    dir, script,
    cfgs: [{ fixtureUrl: FIXTURE_URL, copyUrl: X.url, stateDir: fx.stateDir, results: fx.results, now: fx.now(), phases: PHASES, measurement: MEASUREMENT, ...c, pause: { file: files.paused, resume: files.resume, ms: 120000, ...c.pause } }],
    afterStart: async (ws) => {
      const until = Date.now() + 60000;
      while (!existsSync(files.paused)) {
        if (ws[0].exited) throw new Error(`the writer ended before it paused: ${ws[0].stderr} ${existsSync(ws[0].cfg.out) ? readFileSync(ws[0].cfg.out, "utf8") : ""}`);
        if (Date.now() > until) throw new Error("the writer never paused");
        await tick(10);
      }
      try { await during(ws[0], files); } finally { writeFileSync(files.resume, "go"); }
    },
  });
  return res[0];
}

/** The reason a snapshot reader gives when the writer `pid` holds the lock, for `what`. */
const busyBehind = (what, pid, fx) => new RegExp(`^the guard store is busy, so ${what} is not established \\(another guard process has held the store lock for over 0\\.3 s \\(pid ${pid} since ${G.iso(fx.now()).replace(/\./g, "\\.")}\\)\\. `);

test("SN-1 F3: with another process paused between a change's file and its ledger line, status, the gate and the sender's first check report BUSY (the state not established), never DAMAGED, and change nothing; once it finishes, each reads the finished, intact state", async () => {
  const { fx, ph, W, go } = setupP();
  try {
    const seen = {};
    const eventsBefore = G.readLedger(fx.paths).seq;
    const w = await writer(fx, { mode: "clock", pause: { kind: "clock" } }, async (wk) => {
      const raw = fx.check();
      assert.equal(raw.ok, false, "the paused state is real: read without the lock, it does not check");
      assert.match(raw.problems.join("; "), /clock.[^;]+ is present, but the ledger does not record it/);
      seen.pid = wk.pid;
      seen.status = statusOf(G, fx, 300);
      seen.gate = await caught(() => gateOf(G, fx, ph.phaseId, 300));
      seen.send = await caught(() => fx.send(G, { text: "P2-01", target: "production", win: W, goId: go.goId, over: { lockWaitMs: 300 } }));
    });
    assert.deepEqual(w.out, { ok: true }, `the writer finished: ${JSON.stringify(w)}`);
    assert.equal(seen.status.busy, true, JSON.stringify(seen.status));
    assert.ok(!("intact" in seen.status) && !("holds" in seen.status), "BUSY gives no intact flag and no holds list");
    assert.match(seen.status.reason, busyBehind("the status", seen.pid, fx));
    for (const [label, e, what] of [["the gate", seen.gate, `phase ${ph.phaseId}'s gate`], ["the sender", seen.send, "the send's first check"]]) {
      assert.ok(e instanceof G.LockUnavailable, `${label}: BUSY, got ${e && e.constructor.name}: ${e && e.message}`);
      assert.match(e.message, busyBehind(what, seen.pid, fx), label);
      assert.ok(!/DAMAGED/.test(e.message), `${label}: never DAMAGED`);
    }
    assert.equal(fx.calls.length, 0, "no request");
    assert.deepEqual(liveGos(fx), [`${go.goId}.json`], "the go is untouched");
    assert.equal(G.readJournal(fx.paths, PROD).length, 0, "no claim");
    // Afterwards: the finished, intact state, the writer's change included.
    const L = G.readLedger(fx.paths);
    assert.equal(L.seq, eventsBefore + 1, "the one change, recorded");
    assert.equal(L.events[L.events.length - 1].kind, "clock");
    const st = fx.status();
    assert.equal(st.intact, true, JSON.stringify(st));
    assert.deepEqual(st.holds, []);
    assert.equal(st.events, eventsBefore + 1);
    assert.equal(gateOf(G, fx, ph.phaseId).next, "A1");
    const r = await fx.send(G, { text: "P2-01", target: "production", win: W, goId: go.goId });
    assert.ok(r.record, "the send is admitted");
    assert.equal(fx.calls.length, 1);
    assert.equal(existsSync(fx.paths.lock), false);
  } finally { fx.cleanup(); }
});

test("SN-2 F3: a status that waits behind the paused writer reads its finished change, intact", async () => {
  const { fx } = setupP();
  try {
    const eventsBefore = G.readLedger(fx.paths).seq;
    let st;
    await writer(fx, { mode: "clock", pause: { kind: "clock", ms: 1500 } }, async () => {
      st = statusOf(G, fx); // the full wait: the writer resumes on its own while this waits
    });
    assert.equal(st.intact, true, JSON.stringify(st));
    assert.equal(st.events, eventsBefore + 1, "the writer's change, finished");
    assert.deepEqual(st.holds, []);
  } finally { fx.cleanup(); }
});

test("SN-3 F3: a writer paused mid-claim, then in flight: status and the gate are BUSY while it holds the lock, then report a genuinely PENDING attempt in one coherent snapshot; the hold stays after the process dies", async () => {
  const { fx, ph, W, go } = setupP();
  try {
    const seen = {};
    await writer(fx, { mode: "hang", pause: { kind: "claim" }, goId: go.goId, env: W.env, pid: W.pid, shells: [1001, 1002] }, async (wk, files) => {
      seen.status = statusOf(G, fx, 300);
      seen.gate = await caught(() => gateOf(G, fx, ph.phaseId, 300));
      writeFileSync(files.resume, "go");
      const fetched = `${wk.cfg.out}.fetched`;
      const until = Date.now() + 60000;
      while (!existsSync(fetched) && Date.now() < until) await tick(20);
      assert.ok(existsSync(fetched), "the writer's request is in flight");
      seen.inflight = statusOf(G, fx);
      seen.gate2 = gateOf(G, fx, ph.phaseId);
      wk.p.kill();
    });
    assert.equal(seen.status.busy, true, JSON.stringify(seen.status));
    assert.ok(seen.gate instanceof G.LockUnavailable, String(seen.gate));
    const entries = G.readJournal(fx.paths, PROD);
    assert.equal(entries.length, 1, "one claim");
    const id = entries[0].attemptId;
    assert.equal(seen.inflight.intact, true, JSON.stringify(seen.inflight));
    assert.deepEqual(seen.inflight.holds.map((h) => [h.kind, h.attemptId]), [["PENDING", id]], "the PENDING attempt, in the snapshot");
    assert.deepEqual(seen.inflight.attempts.map((a) => [a.attemptId, a.state]), [[id, "PENDING"]]);
    assert.deepEqual(seen.inflight.gos, [], "and its go used, in the same snapshot");
    assert.deepEqual(seen.gate2.holds.map((h) => h.kind), ["PENDING"]);
    assert.equal(seen.gate2.stop, true);
    assert.match(seen.gate2.reason, /A1 has no recorded outcome \(pending\)/);
    const after = fx.status();
    assert.deepEqual(after.holds.map((h) => [h.kind, h.attemptId]), [["PENDING", id]], "it holds after the process dies");
    assert.equal(fx.check().ok, true);
  } finally { fx.cleanup(); }
});

test("SN-4 F3: planted damage is DAMAGED in a locked snapshot (status, gate, sender, no request); with another writer holding the lock it is BUSY, and DAMAGED again once the writer finishes", async () => {
  const { fx, ph, W, go } = setupP();
  try {
    writeFileSync(join(fx.paths.gos, "planted.json"), "{}");
    const damaged = (st) => st.intact === false && !("holds" in st) && /planted\.json is present, but the ledger does not record it/.test(st.damaged.join("; "));
    assert.ok(damaged(fx.status()), "status: DAMAGED");
    const ge = await caught(() => gateOf(G, fx, ph.phaseId));
    assert.ok(ge instanceof G.Refusal && !(ge instanceof G.LockUnavailable) && /DAMAGED/.test(ge.message), `the gate: DAMAGED (${ge && ge.message})`);
    const se = await caught(() => fx.send(G, { text: "P2-01", target: "production", win: W, goId: go.goId }));
    assert.ok(se instanceof G.Refusal && /DAMAGED/.test(se.message), `the sender: DAMAGED (${se && se.message})`);
    // With another writer: close works where the ledger reads, and holds the lock while it is paused.
    const seen = {};
    const w = await writer(fx, { mode: "close", pause: { kind: "marker-close" }, env: { [G.SESSION_ENV]: nonce(1001) } }, async () => {
      seen.status = statusOf(G, fx, 300);
    });
    assert.equal(w.out.ok, true, JSON.stringify(w.out));
    assert.equal(seen.status.busy, true, "BUSY while the writer holds the lock, not DAMAGED");
    assert.ok(damaged(fx.status()), "DAMAGED again once it finished: the damage is still there");
    assert.equal(fx.calls.length, 0, "no request");
  } finally { fx.cleanup(); }
});

test("SN-5 F3: no store or no ledger is DAMAGED, never BUSY; the reader's own lock is not counted and is released; a stale lock file is BUSY until removed by hand, and no reader removes it", async () => {
  {
    const fx = fixture({ workflows: WF(), init: false });
    try {
      const st = fx.status();
      assert.equal(st.intact, false);
      assert.match(st.damaged.join("; "), /no guard store/);
      assert.equal(existsSync(fx.stateDir), false, "nothing was made");
      const ge = await caught(() => gateOf(G, fx, "0".repeat(32)));
      assert.ok(ge instanceof G.Refusal && !(ge instanceof G.LockUnavailable) && /no guard store/.test(ge.message), String(ge));
    } finally { fx.cleanup(); }
  }
  {
    const { fx, ph } = setupP();
    try {
      unlinkSync(fx.paths.ledger);
      const st = fx.status();
      assert.equal(st.intact, false);
      assert.match(st.damaged.join("; "), /the ledger is missing or unreadable/);
      const ge = await caught(() => gateOf(G, fx, ph.phaseId));
      assert.ok(ge instanceof G.Refusal && /DAMAGED/.test(ge.message), String(ge));
    } finally { fx.cleanup(); }
  }
  {
    const { fx, ph } = setupP();
    try {
      const st = fx.status();
      assert.equal(st.intact, true);
      assert.ok(!("lock" in st) && !("busy" in st), "the reader's own lock is not reported");
      const g = gateOf(G, fx, ph.phaseId);
      assert.ok(!("lock" in g), "nor in the gate");
      assert.equal(existsSync(fx.paths.lock), false, "and it is released");
      writeFileSync(fx.paths.lock, "pid 999999 since 2026-10-28T14:00:00.000Z");
      const busy = statusOf(G, fx, 300);
      assert.equal(busy.busy, true);
      assert.match(busy.reason, /pid 999999 since 2026-10-28T14:00:00\.000Z/);
      const ge = await caught(() => gateOf(G, fx, ph.phaseId, 300));
      assert.ok(ge instanceof G.LockUnavailable, String(ge));
      assert.ok(existsSync(fx.paths.lock), "no reader removes a lock file");
      unlinkSync(fx.paths.lock);
      assert.equal(fx.status().intact, true, "removed by hand: intact");
    } finally { fx.cleanup(); }
  }
});

test("SN-M F3's mutation companion: without the protected snapshot (NO_SNAPSHOT), the paused-writer case of SN-1 reads as DAMAGED in status, the gate and the sender, which SN-1 refuses; the original reads BUSY", async () => {
  const { fx, ph, W, go } = setupP();
  try {
    const seen = {};
    await writer(fx, { mode: "clock", pause: { kind: "clock" } }, async () => {
      seen.original = statusOf(G, fx, 300);
      seen.status = statusOf(NOSNAP, fx, 300);
      seen.gate = await caught(() => gateOf(NOSNAP, fx, ph.phaseId, 300));
      seen.send = await caught(() => fx.send(NOSNAP, { text: "P2-01", target: "production", win: W, goId: go.goId, over: { lockWaitMs: 300 } }));
    });
    assert.equal(seen.original.busy, true, "the original: BUSY");
    assert.equal(seen.status.intact, false, `the mutant's status: DAMAGED (${JSON.stringify(seen.status)})`);
    assert.match(seen.status.damaged.join("; "), /is present, but the ledger does not record it/);
    for (const [label, e] of [["the gate", seen.gate], ["the sender", seen.send]]) {
      assert.ok(e instanceof NOSNAP.Refusal && !(e instanceof NOSNAP.LockUnavailable), `${label} under the mutant: ${e && e.constructor.name}`);
      assert.match(e.message, /DAMAGED/, `${label} under the mutant: DAMAGED`);
    }
    assert.equal(fx.calls.length, 0);
  } finally { fx.cleanup(); }
});

// ── W-R3: a stale lock, and W-N1: the helper's timers ───────────────────────

test("SN-6 W-R3: a real holder process, then killed: status is BUSY with the lock's pid and time while it lives, and the same BUSY after its exit, with the lock file left as it was (BUSY is no liveness check, and nothing removes the lock); only after a test-only removal does status read the real state: intact, a PENDING hold that survives the removal, or damage", { timeout: 240000 }, async () => {
  for (const kase of ["intact", "pending", "damaged"]) {
    const { fx, ph, W, go } = setupP();
    let h = null;
    try {
      if (kase === "pending") {
        const e = await caught(() => fx.send(G, { text: "P2-01", target: "production", win: W, goId: go.goId, over: { writeReceipt: () => { throw new Error("the disk is full"); } } }));
        assert.ok(e instanceof G.AfterDispatch, `${kase}: the claim stays pending (${e && e.message})`);
      }
      if (kase === "damaged") writeFileSync(join(fx.paths.gos, "planted.json"), "{}");
      const before = fx.status();
      h = await holder(fx);
      const header = `pid ${h.pid} since ${G.iso(fx.now())}`;
      assert.equal(readFileSync(fx.paths.lock, "utf8"), header, `${kase}: the lock records the holder`);
      const busy = { busy: true, reason: `the guard store is busy, so the status is not established (another guard process has held the store lock for over 0.3 s (${header}). ${G.STALE_LOCK_STEPS(fx.paths.lock)}); refusing` };
      assert.deepEqual(statusOf(G, fx, 300), busy, `${kase}: BUSY while the holder lives, with its header and the procedure`);
      const ge = await caught(() => gateOf(G, fx, ph.phaseId, 300));
      assert.ok(ge instanceof G.LockUnavailable && ge.message.includes(`(${header})`), `${kase}: the gate is busy too (${ge && ge.message})`);
      const exit = await h.kill();
      assert.ok(exit.code !== 0 || exit.signal !== null, `${kase}: the holder was killed (${JSON.stringify(exit)})`);
      assert.deepEqual(statusOf(G, fx, 300), busy, `${kase}: the same BUSY once the holder has exited: status cannot tell`);
      assert.deepEqual(statusOf(G, fx, 300), busy, `${kase}: and again: no reader removes the lock`);
      assert.equal(readFileSync(fx.paths.lock, "utf8"), header, `${kase}: the lock file is as the holder left it`);
      // The test's own removal, after it awaited its own holder's exit: the
      // procedure's step 3 (§7.1), never something a command does.
      unlinkSync(fx.paths.lock);
      const st = fx.status();
      if (kase === "intact") {
        assert.equal(st.intact, true, JSON.stringify(st));
        assert.deepEqual(st.holds, []);
        assert.deepEqual(st, { ...before, readAt: st.readAt }, `${kase}: the state is as it was before the holder`);
      } else if (kase === "pending") {
        assert.equal(st.intact, true, JSON.stringify(st));
        assert.equal(st.holds.length, 1, `${kase}: the hold survives the lock's removal: ${JSON.stringify(st.holds)}`);
        assert.equal(st.holds[0].kind, "PENDING");
        assert.deepEqual(st.holds, before.holds, `${kase}: the same hold as before the holder`);
        const ie = await caught(() => fx.issue(ph.phaseId, "A1"));
        assert.ok(ie instanceof G.Refusal, `${kase}: nothing is issued while it holds (${ie && ie.message})`);
        assert.equal(fx.calls.length, 1, `${kase}: only the one request of the pending attempt`);
      } else {
        assert.equal(st.intact, false, JSON.stringify(st));
        assert.ok(!("holds" in st), `${kase}: no holds list`);
        assert.match(st.damaged.join("; "), /planted\.json is present, but the ledger does not record it/);
      }
      if (kase !== "pending") assert.equal(fx.calls.length, 0, `${kase}: no request`);
    } finally {
      if (h) await h.kill().catch(() => {});
      fx.cleanup();
    }
  }
});

const LIFETIME_PROBE = `
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
const c = JSON.parse(readFileSync(process.argv[2], "utf8"));
const F = await import(c.fixtureUrl);
const dirOf = (n) => { const d = join(c.dir, n); mkdirSync(d); return d; };
const cases = {};
const ok = await F.releaseTogether({ dir: dirOf("ok"), script: c.okWorker, cfgs: [{}], readyMs: 60000, doneMs: 60000 });
cases.ok = ok[0].out;
try { await F.releaseTogether({ dir: dirOf("early"), script: c.earlyWorker, cfgs: [{}], readyMs: 60000, doneMs: 60000 }); cases.early = "returned"; }
catch (e) { cases.early = e.message.includes("exited before it was ready") ? "refused" : e.message; }
try { await F.releaseTogether({ dir: dirOf("after"), script: c.okWorker, cfgs: [{}], readyMs: 60000, doneMs: 60000, afterStart: async () => { throw new Error("afterStart failed"); } }); cases.after = "returned"; }
catch (e) { cases.after = e.message === "afterStart failed" ? "rethrown" : e.message; }
if (c.leakMs) setTimeout(() => {}, c.leakMs);
writeFileSync(c.out, JSON.stringify({ cases, returnedAt: Date.now() }));
`;
const OK_WORKER = `
import { readFileSync, writeFileSync, existsSync } from "node:fs";
const c = JSON.parse(readFileSync(process.argv[2], "utf8"));
writeFileSync(c.ready, "1");
while (!existsSync(c.start)) await new Promise((r) => setTimeout(r, 5));
writeFileSync(c.out, JSON.stringify({ ok: true }));
`;

/** Run the lifetime probe; returns its cases and how long its process lived after releaseTogether last returned. */
async function lifetime(dir, leakMs = 0) {
  writeFileSync(join(dir, "probe.mjs"), LIFETIME_PROBE);
  writeFileSync(join(dir, "ok.mjs"), OK_WORKER);
  writeFileSync(join(dir, "early.mjs"), "process.exit(4);\n");
  const out = join(dir, "probe-out.json");
  writeFileSync(join(dir, "probe.json"), JSON.stringify({ fixtureUrl: FIXTURE_URL, dir, okWorker: join(dir, "ok.mjs"), earlyWorker: join(dir, "early.mjs"), out, leakMs }));
  const p = spawn(process.execPath, [join(dir, "probe.mjs"), join(dir, "probe.json")], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  let stderr = "";
  p.stderr.on("data", (d) => { stderr += d; });
  const exited = new Promise((r) => p.on("exit", (code, signal) => r({ code, signal })));
  if (!(await within(exited, 150000))) { p.kill(); await within(exited, 30000); throw new Error(`the probe did not exit: ${stderr}`); }
  const exitAt = Date.now();
  const { code } = await exited;
  assert.equal(code, 0, `the probe ran to its end: ${stderr}`);
  const r = JSON.parse(readFileSync(out, "utf8"));
  return { cases: r.cases, afterReturnMs: exitAt - r.returnedAt };
}

test("HL-1 W-N1: releaseTogether leaves no timer behind: a process that used it on its success, early-exit and afterStart-failure paths, with 60 s and 30 s bounds, exits within seconds of its return; a timer the probe leaves on purpose is seen", { timeout: 300000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "s0-hl1-"));
  try {
    mkdirSync(join(dir, "clean"));
    const clean = await lifetime(join(dir, "clean"));
    assert.deepEqual(clean.cases, { ok: { ok: true }, early: "refused", after: "rethrown" });
    assert.ok(clean.afterReturnMs < 8000, `the process exited ${clean.afterReturnMs} ms after the helper's last return; a timer left referenced would hold it for up to 60 s`);
    // The control: a 20 s timer left referenced on purpose is measured as such.
    mkdirSync(join(dir, "leak"));
    const leak = await lifetime(join(dir, "leak"), 20000);
    assert.ok(leak.afterReturnMs >= 15000, `the measurement sees a referenced timer: ${leak.afterReturnMs} ms`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
