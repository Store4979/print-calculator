// scripts/tests/stage0-guard.ceiling.test.js — per-step ceilings, the item 6
// follow-up (Codex's review of 78db6dc, item 1; accepted deferral in its
// review of 22610f8). A step's ceiling is its latest start: the phase
// deadline less what the phase's declaration reserves for the whole remaining
// path from that step. The phase records every step's ceiling, the go records
// its step's, and the issuer and the sender each recompute it from the
// declaration: a go can never extend it. Every negative asserts a Refusal and
// ZERO requests on the fixture's counting fetch stub.
//
//   CE-1  the declaration: only capture B, A, T, U keep 60 s; every other
//         phase declares its ceilings; the runbook's map, where a later step
//         reserves more, is valid (Codex, review of 30c0eba: P-R1, Q-P2)
//   CE-2  registration records every ceiling; before/at/after the earliest
//   CE-3  the issuer: before/at/after each step's ceiling
//   CE-4  the sender: before/at/after each step's ceiling, at admission,
//         under the store lock and immediately before fetch
//   CE-5  a late early step: the phase is live, the step's ceiling is not
//   CE-6  stale or enlarged ceilings, in the go, the phase record or the
//         declaration, refuse at the issuer and the sender
//   CE-7  the command lines: the drafted line, --not-after
//   CE-8  a later step with an earlier ceiling (P-R1)
//   CE-9  the go line binds every step's latest start and the deadline (Q-P1)
//   CE-10 the per-send not-after (Codex's tighter-bound ruling)
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

/** The P1–P3 runbook's binding latest starts before its 20:15 end (§B; Codex, review of 30c0eba, P-R1): later steps reserve MORE. */
const RUNBOOK = { "P1": 95, "P2-01": 55, "P2-02": 55, "P2-0304": 58, "P2-05": 67 };
const RUNBOOK_WF = () => ({ r: synthWorkflow("production", { R: Object.keys(RUNBOOK).map((s) => [s, "STATE"]) }, { ceilings: { R: Object.fromEntries(Object.entries(RUNBOOK).map(([s, m]) => [s, m * MIN])) } }) });

test("CE-1 the declaration: only the reviewed capture phases B, A, T, U keep 60 s per step; every other phase declares one ceiling per step, in whole minutes from 60 s to 24 h; a later step may reserve more (P-R1, Q-P2)", async () => {
  assert.deepEqual(Object.keys(G.WORKFLOWS.capture.phases).sort(), [...G.LEGACY_CUTOFF_PHASES].sort(), "the legacy exception names exactly the declared capture phases");
  for (const [name, p] of Object.entries(G.WORKFLOWS.capture.phases)) {
    assert.deepEqual(G.stepCeilings(G.WORKFLOWS.capture, name, T0), Object.fromEntries(p.steps.map((s) => [s, T0 - G.MARGIN_MS])), `capture ${name}: the admission cutoff`);
  }
  assert.deepEqual(G.ceilingReserve(WF().t, "P"), CEIL.P);
  {
    const end = Date.parse("2026-10-28T20:15:00.000Z");
    const want = { "P1": "18:40", "P2-01": "19:20", "P2-02": "19:20", "P2-0304": "19:17", "P2-05": "19:08" };
    const got = G.stepCeilings(RUNBOOK_WF().r, "R", end);
    for (const [s, hm] of Object.entries(want)) assert.equal(G.iso(got[s]).slice(11, 16), hm, `the runbook's ${s}`);
    const fx = fixture({ workflows: RUNBOOK_WF() });
    try {
      fx.clock();
      assert.match(fx.draft("r", "R", end), /^[0-9a-f]{16}$/, "the runbook's map drafts");
    } finally { fx.cleanup(); }
  }
  const bad = [
    ["none, for production", WF({ P: null }), /phase P declares no per-step ceilings; only the reviewed capture phases B, A, T, U keep the 60 s cutoff/],
    ["none, for a new staging phase", { t: synthWorkflow("staging", { P: STEPS }, { ceilings: { P: null } }) }, /phase P declares no per-step ceilings/],
    ["none, for a phase named B in another workflow named capture", { capture: synthWorkflow("staging", { B: STEPS }, { ceilings: { B: null } }) }, /phase B declares no per-step ceilings/, "capture", "B"],
    ["a step left out", WF({ P: { A1: 50 * MIN, A2: 20 * MIN } }), /do not name exactly its steps/],
    ["a step it does not have", WF({ P: { ...CEIL.P, A4: 5 * MIN } }), /do not name exactly its steps/],
    ["not whole minutes", WF({ P: { ...CEIL.P, A2: 20 * MIN + 1 } }), /is not a whole number of minutes/],
    ["less than 60 s", WF({ P: { ...CEIL.P, A3: 0 } }), /is not a whole number of minutes from 60 s to 24 h/],
    ["more than 24 h", WF({ P: { ...CEIL.P, A1: 24 * 60 * MIN + MIN } }), /is not a whole number of minutes from 60 s to 24 h/],
    ["not a number", WF({ P: { ...CEIL.P, A1: "50" } }), /is not a whole number of minutes/],
    ["not an object", WF({ P: [50 * MIN, 20 * MIN, 10 * MIN] }), /do not name exactly its steps/],
  ];
  for (const [label, workflows, re, wname = "t", pname = "P"] of bad) {
    assert.throws(() => G.ceilingReserve(workflows[wname], pname), (e) => e instanceof G.Refusal && re.test(e.message), label);
    const fx = fixture({ workflows });
    try {
      fx.clock();
      const lines = readFileSync(fx.paths.ledger, "utf8");
      await refused(() => fx.draft(wname, pname), re, `${label}: no approval is drafted`);
      assert.equal(readFileSync(fx.paths.ledger, "utf8"), lines, `${label}: nothing recorded`);
      assert.equal(fx.calls.length, 0);
    } finally { fx.cleanup(); }
  }
  {
    // A legacy capture phase is drafted without a deadline, and refuses one.
    const fx = fixture();
    try {
      fx.clock();
      assert.match(fx.draft("capture", "B"), /^[0-9a-f]{16}$/);
      await refused(() => G.draftApproval({ paths: fx.paths, anchor: fx.anchor, manifest: M, workflow: "capture", phase: "B", head: "1234567890abcdef1234567890abcdef12345678", deadline: G.iso(T0 + 60 * MIN), now: fx.now() }), /keeps its legacy go line/);
    } finally { fx.cleanup(); }
  }
});

// ── CE-2 ─────────────────────────────────────────────────────────────────────

test("CE-2 registration records every step's ceiling from the declaration and the deadline; it refuses at or after the earliest one", async () => {
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
      const id = fx.draft("t", "P", D);
      fx.set(c1 + delta);
      const run = () => fx.register("t", "P", { deadline: D, approvalId: id });
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
          assert.equal(go.schema, "stage0-go/3", label);
          assert.equal(go.ceiling, G.iso(s.c[step]), label);
          assert.equal(go.notAfter, G.iso(s.c[step]), `${label}: the fixture's not-after is the ceiling`);
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

test("CE-7 the command lines: draft prints the line to approve; phase registers exactly it and prints every ceiling; issue takes --not-after and prints it", async () => {
  const fx = fixture({ workflows: WF() });
  try {
    fx.clock();
    const out = [];
    const deps = { manifest: M, anchor: fx.anchor, stateDir: fx.stateDir, now: fx.now, git: fx.git, execArgv: [], stdout: (x) => out.push(x), workflows: fx.workflows, ctxAt: fx.ctxAt, identity: fx.identity };
    const D = T0 + 90 * MIN;
    await refused(() => GO.main(["draft", "--workflow", "t", "--phase", "P"], {}, deps), /drafted with its deadline/, "no --deadline");
    const { draft } = GO.main(["draft", "--workflow", "t", "--phase", "P", "--deadline", G.iso(D)], {}, deps);
    const line = `GO phase P (t), approval ${draft.approvalId}: head 1234567, production gmxyisjjaxtpycsmmzef. Latest starts: A1 2026-10-28 14:40 UTC (10:40 EDT 2026-10-28); A2 2026-10-28 15:10 UTC (11:10 EDT 2026-10-28); A3 2026-10-28 15:20 UTC (11:20 EDT 2026-10-28). Phase deadline 2026-10-28 15:30 UTC (11:30 EDT 2026-10-28).`;
    assert.equal(draft.line, line, "the one defined form");
    assert.ok(out.join("").includes(`to approve word for word (each step's latest start, then the phase deadline):\n${line}\n`));
    const goFile = join(fx.dir, "go.txt");
    writeFileSync(goFile, line + "\n");
    const { phase } = GO.main(["phase", "--workflow", "t", "--phase", "P", "--go-text", goFile, "--arrived", G.iso(fx.now()), "--deadline", G.iso(D)], {}, deps);
    assert.match(out.join(""), /ceilings \(latest starts\): A1 before 2026-10-28T14:40:00\.000Z; A2 before 2026-10-28T15:10:00\.000Z; A3 before 2026-10-28T15:20:00\.000Z/);
    fx.window("W", phase.phaseId, { pid: 1002 });
    await refused(() => GO.main(["issue", "--phase", phase.phaseId, "--step", "A1"], {}, deps), /a production go needs --not-after/, "no --not-after");
    const { go } = GO.main(["issue", "--phase", phase.phaseId, "--step", "A1", "--not-after", "2026-10-28T14:30:00.000Z"], {}, deps);
    assert.match(out.join(""), new RegExp(`go ${go.goId}: A1 \\(P2-01\\) from the W window, .* before 2026-10-28T14:30:00\\.000Z \\(A1's ceiling 2026-10-28T14:40:00\\.000Z; not-after 2026-10-28T14:30:00\\.000Z\\)`));
  } finally { fx.cleanup(); }
});

// ── CE-8 ─────────────────────────────────────────────────────────────────────

/** A2 runs after A1 but reserves more, so its ceiling comes first: with the 90-minute deadline, A1's is T0 + 70 min and A2's T0 + 50 min. */
const EARLY2 = () => ({ t: synthWorkflow("production", { P: [["A1", "P2-01"], ["A2", "STATE"]] }, { ceilings: { P: { A1: 20 * MIN, A2: 40 * MIN } } }) });

test("CE-8 P-R1: a later step with an earlier ceiling: registration needs every ceiling ahead; A2 is issued and sent strictly before its own ceiling; after it, A1 can still start but A2 is never issued, and nothing is reordered or skipped", async () => {
  const D = T0 + 90 * MIN;
  const c2 = D - 40 * MIN;
  for (const [delta, ok] of [[-1, true], [0, false], [1, false]]) {
    const fx = fixture({ workflows: EARLY2() });
    try {
      fx.clock();
      const id = fx.draft("t", "P", D);
      fx.set(c2 + delta);
      const run = () => fx.register("t", "P", { deadline: D, approvalId: id });
      if (ok) assert.equal(run().phase.ceilings.A2, G.iso(c2), `registration, A2's ceiling ${delta}`);
      else await refused(run, /step A2's ceiling .* has already passed: the phase cannot run/, `registration, A2's ceiling ${delta}`);
    } finally { fx.cleanup(); }
  }
  for (const delta of [-1, 0, 1]) {
    const s = setup({ workflows: EARLY2() });
    try {
      await sendBefore(s, "A2");
      at(s, s.c.A2 + delta);
      if (delta < 0) assert.equal(s.fx.issue(s.ph.phaseId, "A2").deadline, G.iso(s.c.A2), "the issuer, before");
      else await refused(() => s.fx.issue(s.ph.phaseId, "A2"), /step A2's ceiling .* has passed/, `the issuer, ${delta}`);
    } finally { s.fx.cleanup(); }
  }
  for (const [delta, calls] of [[-1, 1], [0, 0], [1, 0]]) {
    const s = setup({ workflows: EARLY2() });
    try {
      await sendBefore(s, "A2");
      const before = s.fx.calls.length;
      const go = s.fx.issue(s.ph.phaseId, "A2");
      at(s, s.c.A2 + delta);
      const run = () => s.fx.send(G, { text: "STATE", target: "production", win: s.win.R, goId: go.goId });
      if (calls) assert.equal((await run()).record.httpStatus, 201, "the sender, before");
      else await refused(run, /deadline .* has passed/, `the sender, ${delta}`);
      assert.equal(s.fx.calls.length, before + calls, `the sender, ${delta}`);
    } finally { s.fx.cleanup(); }
  }
  {
    const s = setup({ workflows: EARLY2() });
    try {
      at(s, s.c.A2 + MIN);
      assert.ok(s.c.A2 + MIN < s.c.A1, "A1's ceiling is still open");
      const g1 = s.fx.issue(s.ph.phaseId, "A1");
      assert.equal((await s.fx.send(G, { text: "P2-01", target: "production", win: s.win.W, goId: g1.goId })).record.httpStatus, 201, "A1 still starts");
      await refused(() => s.fx.issue(s.ph.phaseId, "A2"), /step A2's ceiling .* has passed/, "A2 can no longer be issued");
      await refused(() => s.fx.issue(s.ph.phaseId, "A1"), /the gate does not name A1/, "nor A1 again: the phase stops there");
      assert.equal(s.fx.calls.length, 1);
    } finally { s.fx.cleanup(); }
  }
});

// ── CE-9 ─────────────────────────────────────────────────────────────────────

test("CE-9 Q-P1: a phase that declares ceilings registers only its drafted line, exactly: a wrong, swapped, duplicated, missing or extra step time, other words, another Eastern time or a longer deadline refuses; re-registration keeps the phase and its ceilings", async () => {
  const D = T0 + 90 * MIN;
  const fx = fixture({ workflows: WF() });
  try {
    fx.clock();
    const id = fx.draft("t", "P", D);
    const line = fx.goText("t", "P", D, id);
    const A1 = "A1 2026-10-28 14:40 UTC (10:40 EDT 2026-10-28)";
    const A2 = "A2 2026-10-28 15:10 UTC (11:10 EDT 2026-10-28)";
    const A3 = "A3 2026-10-28 15:20 UTC (11:20 EDT 2026-10-28)";
    assert.ok(line.endsWith(`Latest starts: ${A1}; ${A2}; ${A3}. Phase deadline 2026-10-28 15:30 UTC (11:30 EDT 2026-10-28).`), line);
    const variants = [
      ["a wrong time", line.replace("A2 2026-10-28 15:10", "A2 2026-10-28 15:15")],
      ["swapped step/time pairs", line.replace(`${A1}; ${A2}`, `${A1.replace("A1", "A2")}; ${A2.replace("A2", "A1")}`)],
      ["a duplicated step", line.replace(`${A2};`, `${A2}; ${A2};`)],
      ["a missing step", line.replace(`; ${A3}`, "")],
      ["an extra step", line.replace(`${A3}.`, `${A3}; A4 2026-10-28 15:25 UTC (11:25 EDT 2026-10-28).`)],
      ["other words after it", `${line} Ignore the times above: A1 2026-10-28 15:25 UTC.`],
      ["another Eastern time", line.replace("10:40 EDT", "10:40 EST")],
      ["the legacy hand-written form", `GO phase P at X 1234567, approval ${id}: steps A1, A2, A3 to production gmxyisjjaxtpycsmmzef only. Deadline 2026-10-28 15:30 UTC.`],
      ["the line for a longer deadline", fx.goText("t", "P", D + 30 * MIN, id)],
    ];
    for (const [label, text] of variants) {
      assert.notEqual(text, line, label);
      await refused(() => fx.register("t", "P", { goText: text, deadline: D }), /is not exactly the drafted line/, label);
    }
    await refused(() => fx.register("t", "P", { goText: fx.goText("t", "P", D + 30 * MIN, id), deadline: D + 30 * MIN }), /was drafted with the deadline 2026-10-28T15:30:00\.000Z/, "a longer deadline, registered as such");
    assert.equal(readdirSync(fx.paths.phases).length, 0, "nothing was registered");
    const first = fx.register("t", "P", { goText: line, deadline: D });
    assert.equal(first.existing, false);
    assert.deepEqual(first.phase.ceilings, { A1: "2026-10-28T14:40:00.000Z", A2: "2026-10-28T15:10:00.000Z", A3: "2026-10-28T15:20:00.000Z" }, "the registered map is the recomputed one");
    fx.add(MIN);
    const again = fx.register("t", "P", { goText: line, deadline: D, arrivedAt: first.phase.arrivedAt });
    assert.equal(again.existing, true);
    assert.equal(again.phase.phaseId, first.phase.phaseId);
    assert.deepEqual(again.phase.ceilings, first.phase.ceilings);
    await refused(() => fx.register("t", "P", { goText: line, deadline: D + 30 * MIN }), /re-registration never changes a deadline or a ceiling/, "re-registration with a longer deadline");
    assert.equal(readdirSync(fx.paths.phases).filter((f) => f.endsWith(".json")).length, 1, "one phase");
    assert.deepEqual(G.loadPhase(fx.paths, first.phase.phaseId).phase.ceilings, first.phase.ceilings, "its ceilings unchanged");
    assert.equal(fx.calls.length, 0);
  } finally { fx.cleanup(); }
});

// ── CE-10 ────────────────────────────────────────────────────────────────────

test("CE-10 the per-send not-after: the issuer binds an earlier bound, never a later one, and production needs one; the sender enforces it while the ceiling is still open; a tighter go never re-arms a used go or releases a hold", async () => {
  {
    const s = setup();
    try {
      const na = T0 + 10 * MIN;
      const go = s.fx.issue(s.ph.phaseId, "A1", { notAfter: na });
      assert.deepEqual([go.ceiling, go.notAfter, go.deadline], [G.iso(s.c.A1), G.iso(na), G.iso(na)]);
      s.fx.void(go.goId);
      await refused(() => s.fx.issue(s.ph.phaseId, "A1", { notAfter: s.c.A1 + 1 }), /is later than step A1's ceiling, its window's end or the phase deadline/, "1 ms after the ceiling");
      const atCeiling = s.fx.issue(s.ph.phaseId, "A1", { notAfter: s.c.A1 });
      assert.equal(atCeiling.deadline, G.iso(s.c.A1), "at the ceiling");
      s.fx.void(atCeiling.goId);
      await refused(() => s.fx.issue(s.ph.phaseId, "A1", { notAfter: s.fx.now() }), /--not-after .* has already passed/, "already reached");
      await refused(() => s.fx.issue(s.ph.phaseId, "A1", { notAfter: null }), /a production go needs --not-after/, "missing, for production");
      assert.equal(s.fx.calls.length, 0);
    } finally { s.fx.cleanup(); }
  }
  {
    const fx = fixture({ workflows: { s: synthWorkflow("staging", { S: [["S1", "SIZE-PROBE"]] }) } });
    try {
      fx.clock();
      const ph = fx.phase("s", "S");
      fx.window("R", ph.phaseId, { pid: 1001 });
      const go = fx.issue(ph.phaseId, "S1");
      assert.deepEqual([go.notAfter, go.deadline], [null, ph.ceilings.S1], "a staging go may go without one; its ceiling bounds it");
    } finally { fx.cleanup(); }
  }
  for (const [delta, calls] of [[-1, 1], [0, 0], [1, 0]]) {
    const s = setup();
    try {
      const na = T0 + 10 * MIN;
      const go = s.fx.issue(s.ph.phaseId, "A1", { notAfter: na });
      at(s, na + delta);
      assert.ok(na + delta < s.c.A1, "A1's ceiling is still open");
      const run = () => s.fx.send(G, { text: "P2-01", target: "production", win: s.win.W, goId: go.goId });
      if (calls) assert.equal((await run()).record.httpStatus, 201, "before the not-after");
      else await refused(run, /deadline .* has passed/, `the not-after ${delta}`);
      assert.equal(s.fx.calls.length, calls, `the not-after ${delta}`);
    } finally { s.fx.cleanup(); }
  }
  {
    const s = setup();
    try {
      const none = s.fx.forgeGo({ phase: s.ph, marker: s.win.W.marker, step: "A1", text: "P2-01", target: "production", over: { notAfter: null } });
      await refused(() => s.fx.send(G, { text: "P2-01", target: "production", win: s.win.W, goId: none.goId }), /is a production go with no not-after/, "a production go without one");
      const loose = s.fx.forgeGo({ phase: s.ph, marker: s.win.W.marker, step: "A1", text: "P2-01", target: "production", over: { notAfter: G.iso(T0 + 10 * MIN) } });
      at(s, T0 + 20 * MIN);
      await refused(() => s.fx.send(G, { text: "P2-01", target: "production", win: s.win.W, goId: loose.goId }), /is not its recorded not-after/, "a deadline past its not-after");
      assert.equal(s.fx.calls.length, 0);
    } finally { s.fx.cleanup(); }
  }
  {
    const s = setup();
    try {
      const D1 = T0 + 20 * MIN;
      const g1 = s.fx.issue(s.ph.phaseId, "A1", { notAfter: D1 });
      s.fx.set(D1 - 1);
      let k = 0;
      await refused(() => s.fx.send(G, { text: "P2-01", target: "production", win: s.win.W, goId: g1.goId, over: { now: () => (++k <= 2 ? D1 - 1 : D1) } }), /is recorded NOT_SENT/, "g1 reaches its not-after before fetch");
      const g2 = s.fx.issue(s.ph.phaseId, "A1", { notAfter: T0 + 25 * MIN });
      await refused(() => s.fx.send(G, { text: "P2-01", target: "production", win: s.win.W, goId: g1.goId }), /already used/, "the used go stays used");
      assert.equal((await s.fx.send(G, { text: "P2-01", target: "production", win: s.win.W, goId: g2.goId })).record.httpStatus, 201);
      assert.equal(s.fx.calls.length, 1);
    } finally { s.fx.cleanup(); }
  }
  {
    const s = setup();
    try {
      const g1 = s.fx.issue(s.ph.phaseId, "A1");
      const e = await s.fx.send(G, { text: "P2-01", target: "production", win: s.win.W, goId: g1.goId, over: { writeReceipt: () => { throw new Error("synthetic receipt-disk failure"); } } }).catch((x) => x);
      assert.ok(e instanceof G.AfterDispatch);
      await refused(() => s.fx.issue(s.ph.phaseId, "A1", { notAfter: T0 + 5 * MIN }), /the project is held: PENDING/, "a tighter go does not release a pending attempt");
      assert.equal(s.fx.calls.length, 1);
    } finally { s.fx.cleanup(); }
  }
});
