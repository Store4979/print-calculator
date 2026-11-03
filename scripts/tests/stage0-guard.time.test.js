// scripts/tests/stage0-guard.time.test.js — the readers' decision time (W-R1,
// Codex's review of W, 2026-11-02). status, gate and corroborate are given a
// clock and read it once they hold the store lock: after their warm-up and
// after any wait for the lock. A deadline that passes during either is past
// at the decision. The cases run through stage0-go.mjs's command line (its
// test-only deps: a fixture clock, and a ctxAt that advances that clock to
// stand for a slow warm-up) and through a real process holding the store's
// lock. The command line itself takes no time from its arguments.
//
//   TM-1  the control: a warm-up and a lock wait that end before E's
//         deadline; gate permits the read, corroborate agrees; decidedAt is
//         the time after them
//   TM-2  E's deadline passes during the warm-up: gate STOPs with no query,
//         corroborate refuses
//   TM-3  E's deadline passes during the lock wait: the same
//   TM-4  status: a go's `live` is judged after the lock wait (readAt)
//   TM-5  no fixed time: a reader given no clock refuses
//   TM-M  the mutation companion: a gate that decides at the time it was
//         called permits the read after the deadline in TM-2's and TM-3's
//         cases, which they refuse
import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as G from "../manual/stage0-guard.mjs";
import * as GO from "../manual/stage0-go.mjs";
import * as I from "../manual/stage0-item3.mjs";
import { fixture, synthWorkflow, M, ROOT, holder, within, guardCopy } from "./stage0-guard-fixture.mjs";
import { answers, finalValues, corroborationRows } from "./stage0-item3-fixture.mjs";

const STAGING = M.send.targets.staging;
const PROD = M.send.targets.production;
const HOLD_MS = 3000;

/** A store with phase E of item 3 run to COMPLETE-REFUSED, which permits the one read before E's deadline. */
async function completedE() {
  const fx = fixture();
  fx.clock();
  const ph = fx.phase("item3", "E", { minutes: 120 });
  const win = { R: fx.window("R", ph.phaseId, { pid: 1001 }), W: fx.window("W", ph.phaseId, { pid: 1002 }) };
  const a = answers();
  for (const id of I.PHASES.E.steps) {
    const text = I.STEPS[id].text;
    fx.add(1000);
    const go = fx.issue(ph.phaseId, id);
    await fx.send(G, { text, target: "staging", win: win[M.send.texts[text].window], goId: go.goId, over: { fetchImpl: fx.fetchImpl(() => new Response(a[id][1], { status: a[id][0] })) } });
  }
  const rows = join(fx.dir, "rows.json");
  writeFileSync(rows, JSON.stringify(corroborationRows(finalValues())));
  return { fx, ph, rows, D: G.utcMs(ph.deadline) };
}

/**
 * stage0-go.mjs's main, with its test-only deps. `warm` ms are added to the
 * fixture clock at the first ctxAt call, which is the warm-up before the
 * store lock; `now` replaces the fixture clock.
 */
function goMain(fx, argv, { warm = 0, now = null } = {}) {
  let warmed = false;
  const ctxAt = (h) => { if (warm && !warmed) { warmed = true; fx.add(warm); } return fx.ctxAt(h); };
  return GO.main(argv, {}, { root: ROOT, manifest: M, anchor: fx.anchor, stateDir: fx.stateDir, now: now || fx.now, identity: fx.identity, git: fx.git, stdout: () => {}, execArgv: [], ctxAt });
}

/**
 * Run `fn(clock)` while a real process holds the store lock for HOLD_MS. The
 * clock reads `before` until the holder's release time, then `after`: a
 * reader that waited for the lock and read its clock under it sees `after`.
 * Checks that the call started while the lock was held and ended after the
 * release, and that the holder exits.
 */
async function behindHolder(fx, before, after, fn) {
  const h = await holder(fx, HOLD_MS);
  try {
    const clock = () => (Date.now() >= h.releaseAt ? after : before);
    assert.ok(existsSync(fx.paths.lock) && Date.now() < h.releaseAt - 500, "the command starts while the holder holds the lock");
    let r, e = null;
    try { r = fn(clock); } catch (x) { e = x; }
    assert.ok(Date.now() >= h.releaseAt, "the command waited for the lock");
    assert.ok(await within(h.exited, 30000), "the holder released the lock and exited");
    if (e) throw e;
    return r;
  } finally { await h.kill().catch(() => {}); }
}

/** The error fn throws, or null. */
const caught = (fn) => { try { fn(); return null; } catch (e) { return e; } };
const PASSED = /^the gate does not permit the separate-credential read: STOP: phase E's deadline \S+ has passed; refusing$/;

test("TM-1 W-R1 control: a warm-up and a lock wait that end before E's deadline: `gate` permits the read with its query and `corroborate` agrees, through the command line; decidedAt is the time after the warm-up or the wait", { timeout: 120000 }, async () => {
  const s = await completedE();
  try {
    const { fx, ph, rows, D } = s;
    fx.set(D - 3000);
    const g = goMain(fx, ["gate", "--phase", ph.phaseId], { warm: 1000 });
    assert.equal(g.gate.stop, false, g.gate.reason);
    assert.equal(g.gate.corroborate, true);
    assert.equal(g.gate.query, I.CORROBORATION_SQL);
    assert.equal(g.gate.decidedAt, G.iso(D - 2000), "decided after the warm-up");
    fx.set(D - 3000);
    const c = goMain(fx, ["corroborate", "--phase", ph.phaseId, "--rows", rows], { warm: 1000 });
    assert.deepEqual([c.corroboration.agree, c.exit, c.corroboration.decidedAt], [true, 0, G.iso(D - 2000)]);
    const gw = await behindHolder(fx, D - 3000, D - 1000, (clock) => goMain(fx, ["gate", "--phase", ph.phaseId], { now: clock }));
    assert.deepEqual([gw.gate.corroborate, gw.gate.decidedAt], [true, G.iso(D - 1000)], "decided after the lock wait, still before the deadline");
    const cw = await behindHolder(fx, D - 3000, D - 1000, (clock) => goMain(fx, ["corroborate", "--phase", ph.phaseId, "--rows", rows], { now: clock }));
    assert.deepEqual([cw.corroboration.agree, cw.corroboration.decidedAt], [true, G.iso(D - 1000)]);
  } finally { s.fx.cleanup(); }
});

test("TM-2 W-R1: E's deadline passes during the warm-up: `gate` STOPs at its decision time and prints no query, and `corroborate` refuses, through the command line", { timeout: 120000 }, async () => {
  const s = await completedE();
  try {
    const { fx, ph, rows, D } = s;
    fx.set(D - 1000);
    const g = goMain(fx, ["gate", "--phase", ph.phaseId], { warm: 2000 });
    assert.equal(g.gate.stop, true);
    assert.match(g.gate.reason, /^phase E's deadline \S+ has passed$/);
    assert.equal(g.gate.corroborate, false);
    assert.equal(g.gate.query, undefined, "no query is offered");
    assert.equal(g.gate.decidedAt, G.iso(D + 1000), "decided after the warm-up");
    fx.set(D - 1000);
    const e = caught(() => goMain(fx, ["corroborate", "--phase", ph.phaseId, "--rows", rows], { warm: 2000 }));
    assert.ok(e instanceof G.Refusal, String(e));
    assert.match(e.message, PASSED);
  } finally { s.fx.cleanup(); }
});

test("TM-3 W-R1: E's deadline passes while the command waits for the store lock (a real process holds it): `gate` STOPs with no query, and `corroborate` refuses, through the command line", { timeout: 120000 }, async () => {
  const s = await completedE();
  try {
    const { fx, ph, rows, D } = s;
    const g = await behindHolder(fx, D - 1000, D + 1000, (clock) => goMain(fx, ["gate", "--phase", ph.phaseId], { now: clock }));
    assert.deepEqual([g.gate.stop, g.gate.corroborate, g.gate.query], [true, false, undefined]);
    assert.equal(g.gate.decidedAt, G.iso(D + 1000), "decided after the lock wait");
    const e = await behindHolder(fx, D - 1000, D + 1000, (clock) => caught(() => goMain(fx, ["corroborate", "--phase", ph.phaseId, "--rows", rows], { now: clock })));
    assert.ok(e instanceof G.Refusal, String(e));
    assert.match(e.message, PASSED);
  } finally { s.fx.cleanup(); }
});

test("TM-4 W-R1: `status` judges a go's `live` at its read time, after the lock wait, through the command line; before its deadline it is live", { timeout: 120000 }, async () => {
  const fx = fixture({ workflows: { t: synthWorkflow("production", { P: [["A1", "P2-01"]] }) } });
  try {
    fx.clock();
    const ph = fx.phase("t", "P");
    fx.window("W", ph.phaseId, { pid: 1002 });
    const go = fx.issue(ph.phaseId, "A1");
    const dl = G.utcMs(go.deadline);
    const main = (clock) => GO.main(["status", "--target", "production"], {}, { root: ROOT, manifest: M, anchor: fx.anchor, stateDir: fx.stateDir, now: clock, identity: fx.identity, git: fx.git, stdout: () => {}, execArgv: [], ctxAt: fx.ctxAt, workflows: { ...G.WORKFLOWS, ...fx.workflows } });
    const late = await behindHolder(fx, dl - 1000, dl + 1000, main);
    assert.deepEqual(late.status.gos.map((x) => [x.goId, x.live]), [[go.goId, false]], "past its deadline at the read");
    assert.equal(late.status.readAt, G.iso(dl + 1000), "read after the lock wait");
    const early = await behindHolder(fx, dl - 3000, dl - 1000, main);
    assert.deepEqual(early.status.gos.map((x) => [x.goId, x.live]), [[go.goId, true]], "live before it");
    assert.equal(G.readJournal(fx.paths, PROD).length, 0, "status changed nothing");
  } finally { fx.cleanup(); }
});

test("TM-5 W-R1: a reader given a time instead of a clock refuses: phaseGate, corroborateRead and status", () => {
  const fx = fixture();
  try {
    const base = { paths: fx.paths, anchor: fx.anchor, manifest: M, ctxAt: fx.ctxAt, now: fx.now() };
    const zero = "0".repeat(32);
    for (const [label, call] of [
      ["phaseGate", () => G.phaseGate({ ...base, phaseId: zero })],
      ["corroborateRead", () => G.corroborateRead({ ...base, phaseId: zero, rowsText: "[]" })],
      ["status", () => G.status({ ...base, ref: STAGING })],
    ]) {
      const e = caught(call);
      assert.ok(e instanceof G.Refusal, `${label}: ${e}`);
      assert.match(e.message, /is read with a clock, not a fixed time; refusing$/, label);
    }
    assert.equal(existsSync(fx.paths.lock), false, "no lock was taken");
  } finally { fx.cleanup(); }
});

test("TM-M W-R1's mutation companion: a gate that decides at the time it was called permits the read after E's deadline, in TM-2's warm-up case and TM-3's lock-wait case; the real gate refuses both", { timeout: 120000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "s0-time-"));
  const s = await completedE();
  try {
    const { fx, ph, D } = s;
    const X = (await guardCopy(dir, "decide-at-call", [
      ["function gateNow({ paths, anchor, manifest, phaseId, workflows, ctxAt, readReceipt, clock, lockWaitMs = LOCK_WAIT_MS }) {\n", "function gateNow({ paths, anchor, manifest, phaseId, workflows, ctxAt, readReceipt, clock, lockWaitMs = LOCK_WAIT_MS }) {\n  const called = clock();\n"],
      ["    const gate = guardedProgress({ phase, entries, workflows, ctxAt, readReceipt, now: t });", "    const gate = guardedProgress({ phase, entries, workflows, ctxAt, readReceipt, now: called });"],
    ])).mod;
    const gate = (mod, clock, warm) => {
      let warmed = false;
      const ctxAt = (h) => { if (warm && !warmed) { warmed = true; fx.add(warm); } return fx.ctxAt(h); };
      return mod.phaseGate({ paths: fx.paths, anchor: fx.anchor, manifest: M, phaseId: ph.phaseId, ctxAt, clock });
    };
    fx.set(D - 1000);
    assert.equal(gate(X, fx.now, 2000).corroborate, true, "the mutant permits the read after a warm-up past the deadline");
    fx.set(D - 1000);
    assert.equal(gate(G, fx.now, 2000).corroborate, false, "the real gate refuses it");
    assert.equal((await behindHolder(fx, D - 1000, D + 1000, (clock) => gate(X, clock, 0))).corroborate, true, "the mutant permits it after a lock wait past the deadline");
    assert.equal((await behindHolder(fx, D - 1000, D + 1000, (clock) => gate(G, clock, 0))).corroborate, false, "the real gate refuses it");
  } finally { s.fx.cleanup(); rmSync(dir, { recursive: true, force: true }); }
});
