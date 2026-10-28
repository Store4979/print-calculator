// scripts/tests/stage0-guard.ceiling.test.js — per-step ceilings, the item 6
// follow-up (Codex's review of 78db6dc, item 1; accepted deferral in its
// review of 22610f8). A step's ceiling is its latest start: the phase
// deadline less what the phase's declaration reserves for the whole remaining
// path from that step. The phase records every step's ceiling, the go records
// its step's, and the issuer and the sender each recompute it from the
// declaration: a go can never extend it. Every negative asserts a Refusal and
// ZERO requests on the fixture's counting fetch stub.
//
//   CE-1  the declaration: capture phases reserve 60 s; a production phase
//         must declare one ceiling per step; a malformed one refuses
//   CE-2  registration records every ceiling; before/at/after the first one
//   CE-3  the issuer: before/at/after each step's ceiling
//   CE-4  the sender: before/at/after each step's ceiling, at admission,
//         under the store lock and immediately before fetch
//   CE-5  a late early step: the phase is live, the step's ceiling is not
//   CE-6  stale or enlarged ceilings, in the go, the phase record or the
//         declaration, refuse at the issuer and the sender
//   CE-7  the command lines print the ceilings
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import * as G from "../manual/stage0-guard.mjs";
import * as GO from "../manual/stage0-go.mjs";
import { fixture, synthWorkflow, M, T0 } from "./stage0-guard-fixture.mjs";

const PROD = "gmxyisjjaxtpycsmmzef";
const MIN = 60000;
/** P: A1 starts at least 50 min before the deadline, A2 20 min, A3 10 min. */
const CEIL = { P: { A1: 50 * MIN, A2: 20 * MIN, A3: 10 * MIN } };
const STEPS = [["A1", "P2-01"], ["A2", "STATE"], ["A3", "P2-02"]];
const WF = (ceilings = CEIL) => ({ t: synthWorkflow("production", { P: STEPS }, { ceilings }) });
const WIN_OF = { A1: "W", A2: "R", A3: "W" };
const TEXT_OF = Object.fromEntries(STEPS);

async function refused(fn, re, label = "") {
  let err = null;
  try { await fn(); } catch (e) { err = e; }
  assert.ok(err, `${label}: expected a refusal`);
  assert.ok(err instanceof G.Refusal, `${label}: expected a Refusal, got ${err && err.constructor.name}: ${err && err.message}`);
  if (re) assert.match(err.message, re, label);
  return err;
}

/** Rewrite the ledger as a deliberate, consistent edit would: `edit(events)` changes events in place, and every line is re-chained. */
function rechain(fx, edit) {
  const L = G.readLedger(fx.paths);
  assert.deepEqual(L.problems, []);
  const events = L.events.map((e) => ({ ...e }));
  edit(events);
  let prev = "0".repeat(64);
  const lines = events.map((e, i) => {
    const line = JSON.stringify({ ...e, seq: i + 1, prev });
    prev = G.sha256(Buffer.from(line, "utf8"));
    return line;
  });
  writeFileSync(fx.paths.ledger, lines.join("\n") + "\n");
}

/**
 * A store with a clock check, phase P recorded at T0 with a 90-minute
 * deadline (so A1's ceiling is T0 + 40 min, A2's T0 + 70 min, A3's
 * T0 + 80 min), and an R (1001) and a W (1002) window open.
 */
function setup({ workflows = WF() } = {}) {
  const fx = fixture({ workflows });
  fx.clock();
  const ph = fx.phase("t", "P", { minutes: 90 });
  const win = { R: fx.window("R", ph.phaseId, { pid: 1001 }), W: fx.window("W", ph.phaseId, { pid: 1002 }) };
  const c = Object.fromEntries(Object.entries(ph.ceilings).map(([s, v]) => [s, G.utcMs(v)]));
  return { fx, ph, win, c, D: G.utcMs(ph.deadline) };
}

/** Send every step before `step`, each by its own go, at the current time. */
async function sendBefore(s, step) {
  for (const [id, text] of STEPS) {
    if (id === step) return;
    const go = s.fx.issue(s.ph.phaseId, id);
    const r = await s.fx.send(G, { text, target: "production", win: s.win[WIN_OF[id]], goId: go.goId });
    assert.equal(r.record.httpStatus, 201, `${id} sent`);
  }
}

/** Move the fixture's clock to `ms` and record a fresh clock check there. */
const at = (s, ms) => { s.fx.set(ms); s.fx.clock(); };

// ── CE-1 ─────────────────────────────────────────────────────────────────────

test("CE-1 the declaration: every capture phase reserves 60 s per step; a production phase must declare one ceiling per step, in whole minutes, at least 60 s, never longer for a later step", async () => {
  for (const [name, p] of Object.entries(G.WORKFLOWS.capture.phases)) {
    assert.deepEqual(G.stepCeilings(G.WORKFLOWS.capture, name, T0), Object.fromEntries(p.steps.map((s) => [s, T0 - G.MARGIN_MS])), `capture ${name}: the admission cutoff`);
  }
  assert.deepEqual(G.ceilingReserve(WF().t, "P"), CEIL.P);
  assert.deepEqual(G.ceilingReserve(synthWorkflow("staging", { S: STEPS }), "S"), { A1: G.MARGIN_MS, A2: G.MARGIN_MS, A3: G.MARGIN_MS }, "a staging phase may declare none");
  const bad = [
    ["none, for production", null, /targets production and declares no per-step ceilings/],
    ["a step left out", { A1: 50 * MIN, A2: 20 * MIN }, /do not name exactly its steps/],
    ["a step it does not have", { ...CEIL.P, A4: 5 * MIN }, /do not name exactly its steps/],
    ["not whole minutes", { ...CEIL.P, A2: 20 * MIN + 1 }, /is not a whole number of minutes/],
    ["less than 60 s", { ...CEIL.P, A3: 0 }, /is not a whole number of minutes, at least 60 s/],
    ["a later step longer than an earlier one", { ...CEIL.P, A2: 55 * MIN }, /no longer than the step's before it/],
    ["not a number", { ...CEIL.P, A1: "50" }, /is not a whole number of minutes/],
    ["not an object", [50 * MIN, 20 * MIN, 10 * MIN], /do not name exactly its steps/],
  ];
  for (const [label, decl, re] of bad) {
    const wf = WF({ P: decl });
    assert.throws(() => G.ceilingReserve(wf.t, "P"), (e) => e instanceof G.Refusal && re.test(e.message), label);
    const fx = fixture({ workflows: wf });
    try {
      fx.clock();
      const lines = readFileSync(fx.paths.ledger, "utf8");
      await refused(() => fx.draft("t", "P"), re, `${label}: no approval is drafted`);
      assert.equal(readFileSync(fx.paths.ledger, "utf8"), lines, `${label}: nothing recorded`);
      assert.equal(fx.calls.length, 0);
    } finally { fx.cleanup(); }
  }
});

// ── CE-2 ─────────────────────────────────────────────────────────────────────

test("CE-2 registration records every step's ceiling from the declaration and the deadline; it refuses at or after the first step's ceiling", async () => {
  const s = setup();
  try {
    assert.equal(s.ph.schema, "stage0-phase/3");
    assert.deepEqual(s.ph.ceilings, { A1: G.iso(s.D - 50 * MIN), A2: G.iso(s.D - 20 * MIN), A3: G.iso(s.D - 10 * MIN) });
  } finally { s.fx.cleanup(); }
  const D = T0 + 90 * MIN;
  const c1 = D - 50 * MIN;
  for (const [delta, ok] of [[-1, true], [0, false], [1, false]]) {
    const fx = fixture({ workflows: WF() });
    try {
      fx.clock();
      fx.set(c1 + delta);
      const run = () => fx.register("t", "P", { deadline: D });
      if (ok) assert.equal(run().phase.ceilings.A1, G.iso(c1), `A1's ceiling ${delta}`);
      else {
        await refused(run, /step A1's ceiling 2026-10-28T14:40:00\.000Z has already passed: the phase cannot run/, `A1's ceiling ${delta}`);
        assert.equal(readdirSync(fx.paths.phases).length, 0, `A1's ceiling ${delta}: no phase recorded`);
      }
    } finally { fx.cleanup(); }
  }
});

// ── CE-3 ─────────────────────────────────────────────────────────────────────

test("CE-3 the issuer: a step's go is issued strictly before its ceiling, records it, and ends at it; at or after, nothing is issued", async () => {
  for (const step of ["A1", "A2", "A3"]) {
    for (const delta of [-1, 0, 1]) {
      const s = setup();
      try {
        await sendBefore(s, step);
        at(s, s.c[step] + delta);
        const label = `${step}, ceiling ${delta}`;
        if (delta < 0) {
          const go = s.fx.issue(s.ph.phaseId, step);
          assert.equal(go.schema, "stage0-go/2", label);
          assert.equal(go.ceiling, G.iso(s.c[step]), label);
          assert.equal(go.deadline, G.iso(s.c[step]), `${label}: the go ends at the ceiling`);
        } else {
          await refused(() => s.fx.issue(s.ph.phaseId, step), new RegExp(`step ${step}'s ceiling ${G.iso(s.c[step]).replace(/\./g, "\\.")} has passed`), label);
          assert.equal(readdirSync(s.fx.paths.gos).filter((f) => f.endsWith(".json")).length, 0, `${label}: no go`);
        }
      } finally { s.fx.cleanup(); }
    }
  }
});

// ── CE-4 ─────────────────────────────────────────────────────────────────────

test("CE-4 the sender: each step's go is admitted strictly before its ceiling; at or after it, at admission, under the lock or immediately before fetch, there is no request", async () => {
  for (const step of ["A1", "A2", "A3"]) {
    const send = (s, go, over = {}) => s.fx.send(G, { text: TEXT_OF[step], target: "production", win: s.win[WIN_OF[step]], goId: go.goId, over });
    // At admission.
    for (const [delta, calls] of [[-1, 1], [0, 0], [1, 0]]) {
      const s = setup();
      try {
        await sendBefore(s, step);
        const before = s.fx.calls.length;
        const go = s.fx.issue(s.ph.phaseId, step);
        at(s, s.c[step] + delta);
        const label = `${step}: admission at ceiling ${delta}`;
        if (calls) assert.equal((await send(s, go)).record.httpStatus, 201, label);
        else await refused(() => send(s, go), /deadline .* has passed/, label);
        assert.equal(s.fx.calls.length, before + calls, label);
      } finally { s.fx.cleanup(); }
    }
    // Admitted at the ceiling less 1 ms; the ceiling reached under the store lock: no claim, no request.
    {
      const s = setup();
      try {
        await sendBefore(s, step);
        const before = s.fx.calls.length;
        const attempts = s.fx.status().attempts.length;
        const go = s.fx.issue(s.ph.phaseId, step);
        at(s, s.c[step] - 1);
        let k = 0;
        await refused(() => send(s, go, { now: () => (++k <= 1 ? s.c[step] - 1 : s.c[step]) }), /deadline .* has passed/, `${step}: under the lock`);
        assert.equal(s.fx.status().attempts.length, attempts, `${step}: under the lock: no claim`);
        assert.equal(s.fx.calls.length, before, `${step}: under the lock`);
      } finally { s.fx.cleanup(); }
    }
    // Claimed at the ceiling less 1 ms; the ceiling reached at the last check before fetch: NOT_SENT, no request, nothing held.
    {
      const s = setup();
      try {
        await sendBefore(s, step);
        const before = s.fx.calls.length;
        const go = s.fx.issue(s.ph.phaseId, step);
        at(s, s.c[step] - 1);
        let k = 0;
        const e = await refused(() => send(s, go, { now: () => (++k <= 2 ? s.c[step] - 1 : s.c[step]) }), /passed before the request; no request was made, and attempt [0-9a-f]{32} is recorded NOT_SENT/, `${step}: before fetch`);
        const id = /attempt ([0-9a-f]{32})/.exec(e.message)[1];
        assert.equal(G.readState(join(s.fx.paths.journal(PROD), `${id}.outcome.json`)).state, "NOT_SENT");
        assert.deepEqual(s.fx.status().holds, []);
        assert.equal(s.fx.calls.length, before, `${step}: before fetch`);
      } finally { s.fx.cleanup(); }
    }
  }
});

// ── CE-5 ─────────────────────────────────────────────────────────────────────

test("CE-5 a late early step: with the phase, its windows and the later steps' ceilings still open, A1 past its own ceiling is neither issued nor sent, by an issued or a forged go", async () => {
  const s = setup();
  try {
    const early = s.fx.issue(s.ph.phaseId, "A1");
    const late = s.c.A1 + MIN;
    at(s, late);
    assert.ok(late < s.c.A2 && late < s.D - G.MARGIN_MS, "the phase, A2's and A3's ceilings are all still open");
    await refused(() => s.fx.issue(s.ph.phaseId, "A1"), /step A1's ceiling .* has passed/, "the issuer");
    await refused(() => s.fx.send(G, { text: "P2-01", target: "production", win: s.win.W, goId: early.goId }), /deadline .* has passed/, "the go issued before the ceiling");
    await refused(() => s.fx.issue(s.ph.phaseId, "A2"), /the gate does not name A2/, "and the phase cannot skip ahead");
    const cutoff = G.iso(s.D - G.MARGIN_MS);
    const enlarged = s.fx.forgeGo({ phase: s.ph, marker: s.win.W.marker, step: "A1", text: "P2-01", target: "production", over: { deadline: cutoff } });
    await refused(() => s.fx.send(G, { text: "P2-01", target: "production", win: s.win.W, goId: enlarged.goId }), /is after step A1's ceiling .*: a go never extends it/, "a go running to the phase's cutoff");
    const restated = s.fx.forgeGo({ phase: s.ph, marker: s.win.W.marker, step: "A1", text: "P2-01", target: "production", over: { ceiling: cutoff, deadline: cutoff } });
    await refused(() => s.fx.send(G, { text: "P2-01", target: "production", win: s.win.W, goId: restated.goId }), /records A1's ceiling as .*: a stale or altered go/, "a go restating A1's ceiling as the cutoff");
    assert.equal(s.fx.calls.length, 0);
  } finally { s.fx.cleanup(); }
  // The control: the same steps and times with each step reserving only 60 s (the capture cutoff) admit A1.
  const ctl = setup({ workflows: WF({ P: { A1: MIN, A2: MIN, A3: MIN } }) });
  try {
    at(ctl, T0 + 41 * MIN);
    const go = ctl.fx.issue(ctl.ph.phaseId, "A1");
    assert.equal((await ctl.fx.send(G, { text: "P2-01", target: "production", win: ctl.win.W, goId: go.goId })).record.httpStatus, 201);
    assert.equal(ctl.fx.calls.length, 1, "only the ceiling refused it");
  } finally { ctl.fx.cleanup(); }
});

// ── CE-6 ─────────────────────────────────────────────────────────────────────

test("CE-6 stale or enlarged ceilings refuse: in the go (later, earlier, or a deadline past it), in the phase record, and after the declaration changed (tighter or looser)", async () => {
  const forged = [
    ["the go's ceiling enlarged", (c) => ({ ceiling: G.iso(c + 5 * MIN), deadline: G.iso(c) }), /records A1's ceiling as .*: a stale or altered go/],
    ["the go's ceiling stale (earlier)", (c) => ({ ceiling: G.iso(c - 5 * MIN), deadline: G.iso(c - 5 * MIN) }), /records A1's ceiling as .*: a stale or altered go/],
    ["the go's deadline past its ceiling", (c) => ({ ceiling: G.iso(c), deadline: G.iso(c + 5 * MIN) }), /is after step A1's ceiling .*: a go never extends it/],
  ];
  for (const [label, over, re] of forged) {
    const s = setup();
    try {
      const go = s.fx.forgeGo({ phase: s.ph, marker: s.win.W.marker, step: "A1", text: "P2-01", target: "production", over: over(s.c.A1) });
      await refused(() => s.fx.send(G, { text: "P2-01", target: "production", win: s.win.W, goId: go.goId }), re, label);
      assert.equal(s.fx.calls.length, 0, label);
    } finally { s.fx.cleanup(); }
  }
  {
    // The phase record's A2 ceiling moved 5 min later, its ledger line with it (an edit the store check cannot see).
    const fx = fixture({ workflows: WF() });
    try {
      fx.clock();
      const ph = fx.phase("t", "P", { minutes: 90 });
      const file = join(fx.paths.phases, `${ph.phaseId}.json`);
      const edited = { ...ph, ceilings: { ...ph.ceilings, A2: G.iso(G.utcMs(ph.ceilings.A2) + 5 * MIN) } };
      const text = JSON.stringify(edited, null, 2) + "\n";
      writeFileSync(file, text);
      rechain(fx, (events) => { for (const e of events) if (e.kind === "phase" && e.phaseId === ph.phaseId) e.sha256 = G.sha256(Buffer.from(text, "utf8")); });
      assert.equal(fx.check().ok, true, "the store itself is consistent");
      const W = fx.window("W", ph.phaseId, { pid: 1002 });
      const re = /records A2's ceiling as .*; its declaration gives .*: a stale or altered ceiling/;
      await refused(() => fx.issue(ph.phaseId, "A1"), re, "the issuer");
      const go = fx.forgeGo({ phase: ph, marker: W.marker, step: "A1", text: "P2-01", target: "production" });
      await refused(() => fx.send(G, { text: "P2-01", target: "production", win: W, goId: go.goId }), re, "the sender");
      assert.equal(fx.calls.length, 0);
    } finally { fx.cleanup(); }
  }
  for (const [label, a1] of [["a tighter declaration", 55 * MIN], ["a looser declaration", 45 * MIN]]) {
    const s = setup();
    try {
      const go = s.fx.issue(s.ph.phaseId, "A1");
      s.fx.workflows.t = WF({ P: { ...CEIL.P, A1: a1 } }).t;
      const re = /records A1's ceiling as .*; its declaration gives .*: a stale or altered ceiling/;
      await refused(() => s.fx.send(G, { text: "P2-01", target: "production", win: s.win.W, goId: go.goId }), re, `${label}: the sender, with a go issued before it`);
      s.fx.void(go.goId);
      await refused(() => s.fx.issue(s.ph.phaseId, "A1"), re, `${label}: the issuer`);
      assert.equal(s.fx.calls.length, 0, label);
    } finally { s.fx.cleanup(); }
  }
});

// ── CE-7 ─────────────────────────────────────────────────────────────────────

test("CE-7 the command lines: phase prints every step's ceiling; issue prints the go's ceiling and deadline", async () => {
  const fx = fixture({ workflows: WF() });
  try {
    fx.clock();
    const out = [];
    const deps = { manifest: M, anchor: fx.anchor, stateDir: fx.stateDir, now: fx.now, git: fx.git, execArgv: [], stdout: (x) => out.push(x), workflows: fx.workflows, ctxAt: fx.ctxAt, identity: fx.identity };
    const { draft } = GO.main(["draft", "--workflow", "t", "--phase", "P"], {}, deps);
    const D = T0 + 90 * MIN;
    const goFile = join(fx.dir, "go.txt");
    writeFileSync(goFile, fx.goText("t", "P", D, draft.approvalId));
    const { phase } = GO.main(["phase", "--workflow", "t", "--phase", "P", "--go-text", goFile, "--arrived", G.iso(fx.now()), "--deadline", G.iso(D)], {}, deps);
    assert.match(out.join(""), /ceilings \(latest starts\): A1 before 2026-10-28T14:40:00\.000Z; A2 before 2026-10-28T15:10:00\.000Z; A3 before 2026-10-28T15:20:00\.000Z/);
    fx.window("W", phase.phaseId, { pid: 1002 });
    const { go } = GO.main(["issue", "--phase", phase.phaseId, "--step", "A1"], {}, deps);
    assert.match(out.join(""), new RegExp(`go ${go.goId}: A1 \\(P2-01\\) from the W window, .* before 2026-10-28T14:40:00\\.000Z \\(A1's ceiling 2026-10-28T14:40:00\\.000Z\\)`));
  } finally { fx.cleanup(); }
});
