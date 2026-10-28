// scripts/tests/stage0-guard.test.js — the guarded sender (Codex item 6:
// docs/security/stage0-item6-sender-guards-plan.md, as amended by Codex's
// review of 2026-10-27, SG-1 to SG-6). No test here reaches the network: every
// send goes to a fetch stub that counts requests, and "refused" means a
// Refusal with ZERO requests. Clocks, shell processes and HEAD are injected;
// stage0-guard.shell.test.js runs the shell binding through real PowerShell
// processes on Windows, stage0-guard.store.test.js covers the store's
// integrity and one-registration-per-approval (Codex's review of 78db6dc,
// I6-R1 and I6-R2), and stage0-guard.ceiling.test.js the per-step ceilings
// (its item 1; P).
//
//   G-1  Q2: each text goes only from a window of its policy role
//   G-2  Q2: a missing or unknown role refuses; read_only never decides it
//   G-3  SG-1: an old STATE command does not consume a newly issued STATE go
//   G-4  SG-1: a go of another phase, or for a step the gate does not name, refuses
//   G-5  SG-1: a replayed issuance is refused; one usable go per project
//   G-6  SG-1/SG-2: concurrent issuance and concurrent sends, in separate processes
//   G-7  SG-2: a claimed request still in flight holds everything
//   G-8  SG-2: a crash after the claim holds across close, reopen, a new marker and a new phase
//   G-9  SG-2: a fetch failure and a response-body failure hold a writing send
//   G-10 SG-2: a receipt or outcome that cannot be written is AfterDispatch, and holds
//   G-11 SG-2: a missing or altered receipt, or a malformed journal file, holds
//   G-12 SG-2/SG-5: the pre-fetch check records NOT_SENT and holds nothing
//   G-13 SG-2: R4 holds a writing send, not a read; a reviewed disposition releases one attempt
//   G-14 SG-3: the marker binds the window's shell process and its token
//   G-15 SG-4: the receipt's guard block; R1 refuses a malformed one; the 24 fixtures keep their class
//   G-16 SG-4: guarded progression stops on a stripped, swapped or historical receipt
//   G-17 the real capture gate (phase U) through the guarded tools
//   G-18 SG-5: the exact deadline boundaries
//   G-19 SG-5: authority from the future, and the clock check
//   G-20 SG-5: the time and state parsers are total
//   G-21 SG-6: the pinned chain refuses an edit, a dropped pin and an unpinned helper
//   G-22 Q4: tracked changes, node options and planted programs refuse
//   G-23 Q7: no go is issued for a cancel
//   G-24 the dry run needs no token, marker, go, clock or network; a live send needs --go
//   G-25 the 2026-10-09 incident, replayed at its real times
//   G-26 the mutation companion: each named check removed admits a request the original refuses
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, unlinkSync, mkdtempSync, rmSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import * as G from "../manual/stage0-guard.mjs";
import * as C from "../manual/stage0-classify.mjs";
import * as S from "../manual/stage0-send.mjs";
import * as WIN from "../manual/stage0-window.mjs";
import * as GO from "../manual/stage0-go.mjs";
import { fixture, synthWorkflow, M, ctx, ROOT, HEAD, T0, TOKEN, OTHER_TOKEN, nonce, SHELL_CREATED } from "./stage0-guard-fixture.mjs";

const PROD = "gmxyisjjaxtpycsmmzef";
const STAGING = "lboajqihpsfrokqvjgnl";
const REAL = join(ROOT, "scripts", "tests", "fixtures", "stage0-classify", "real");
const clone = (x) => JSON.parse(JSON.stringify(x));
const hex32 = () => randomBytes(16).toString("hex");
const MIN = 60000;

/** Run fn; it must throw (or reject with) a Refusal matching re. */
async function refused(fn, re, label = "") {
  let err = null;
  try { await fn(); } catch (e) { err = e; }
  assert.ok(err, `${label}: expected a refusal`);
  assert.ok(err instanceof G.Refusal, `${label}: expected a Refusal, got ${err && err.constructor.name}: ${err && err.message}`);
  if (re) assert.match(err.message, re, label);
  return err;
}

/** A go written by hand, with its ledger line (the fixture's forgeGo): only the sender's own checks can refuse it. */
const forgeGo = (fx, o) => fx.forgeGo(o);

/**
 * Rewrite the ledger as a deliberate, consistent edit would: `edit(events)`
 * changes events in place, and every line is re-chained.
 */
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

/** Rewrite a marker to end at `untilMs`, with its ledger line, as a deliberate consistent edit would; returns the new marker. */
function endMarker(fx, marker, untilMs) {
  const m = { ...marker, until: G.iso(untilMs) };
  const text = JSON.stringify(m, null, 2) + "\n";
  writeFileSync(join(fx.paths.markers, `${m.markerId}.json`), text);
  rechain(fx, (events) => { for (const e of events) if (e.kind === "marker-open" && e.markerId === m.markerId) e.sha256 = G.sha256(Buffer.from(text, "utf8")); });
  return m;
}

const holds = (fx, ref = PROD) => G.holdsOf(G.readJournal(fx.paths, ref), { ctxAt: fx.ctxAt });
const outcomeOf = (fx, attemptId, ref = PROD) => G.readState(join(fx.paths.journal(ref), `${attemptId}.outcome.json`));
const liveGos = (fx) => (existsSync(fx.paths.gos) ? readdirSync(fx.paths.gos).filter((f) => f.endsWith(".json")) : []);

/** The production workflow most tests use. */
const WF = () => ({
  t: synthWorkflow("production", {
    X: [["S1", "STATE"], ["S2", "P0"], ["S3", "STATE"]],
    Y: [["Y1", "STATE"]],
    P: [["A1", "P2-01"], ["A2", "STATE"], ["A3", "P2-02"]],
  }),
});
/** A fixture with a clock check, a phase recorded, and an R (1001) and a W (1002) window open where the phase sends from them. */
function setupP({ workflows = WF(), phase = "P" } = {}) {
  const fx = fixture({ workflows });
  fx.clock();
  const ph = fx.phase("t", phase);
  const roles = new Set(ph.steps.map((s) => G.roleOf(M, workflows.t.stepText(s))));
  const R = roles.has("R") ? fx.window("R", ph.phaseId, { pid: 1001 }) : null;
  const W = roles.has("W") ? fx.window("W", ph.phaseId, { pid: 1002 }) : null;
  return { fx, ph, R, W };
}

// ── Q2 ───────────────────────────────────────────────────────────────────────

test("G-1 Q2: each text goes only from a window of its policy role; R refuses W and C texts, W refuses R and C, C refuses the rest, before any request", async () => {
  for (const target of ["production", "staging"]) {
    const texts = Object.keys(M.send.texts).filter((k) => M.send.texts[k].targets.includes(target) && k !== "CANCEL-STEP-TEMPLATE");
    const steps = texts.map((k, i) => [`S${i}`, k]);
    const fx = fixture({ workflows: { m: synthWorkflow(target, { ALL: steps }) } });
    try {
      fx.clock();
      const ph = fx.phase("m", "ALL");
      const roles = [...new Set(texts.map((k) => G.roleOf(M, k)))].sort();
      assert.deepEqual(roles, target === "production" ? ["C", "R", "W"] : ["R", "W"]);
      const wins = Object.fromEntries(roles.map((r, i) => [r, fx.window(r, ph.phaseId, { pid: 3000 + i })]));
      let n = 0;
      for (const [id, text] of steps) {
        for (const r of roles) {
          if (r === G.roleOf(M, text)) continue;
          const go = forgeGo(fx, { phase: ph, marker: wins[r].marker, step: id, text, target });
          await refused(() => fx.send(G, { text, target, win: wins[r], goId: go.goId }), new RegExp(`^${text} is sent from an? ${G.roleOf(M, text)} window; this is an? ${r} window`), `${r} sends ${text}`);
          n++;
        }
      }
      assert.equal(n, target === "production" ? 24 : 16, "12 production texts with two other roles each; 16 staging texts with one");
      assert.equal(fx.calls.length, 0, "no request");
      if (target === "staging") await refused(() => fx.window("C", ph.phaseId, { pid: 3999 }), /sends nothing from a C window/, "no C window on staging");
    } finally { fx.cleanup(); }
  }
});

test("G-2 Q2: a text with no window role, or an unknown one, is refused; read_only does not decide the role", async () => {
  assert.equal(G.roleOf(M, "LOCKPROBE-READBACK"), "W", "not read_only, writes nothing, W");
  assert.equal(G.roleOf(M, "CANCEL-INSPECT"), "C", "not read_only, writes nothing, C");
  assert.equal(G.roleOf(M, "STATE"), "R");
  for (const bad of [undefined, null, "", "X", "r", ["R"]]) {
    const M2 = clone(M);
    if (bad === undefined) delete M2.send.texts.STATE.window; else M2.send.texts.STATE.window = bad;
    assert.throws(() => G.roleOf(M2, "STATE"), (e) => e instanceof G.Refusal && /has no window role/.test(e.message), JSON.stringify(bad));
  }
  assert.throws(() => G.roleOf(M, "NOT-A-TEXT"), G.Refusal);
  assert.throws(() => G.roleOf(M, "__proto__"), G.Refusal);
  const { fx, ph, R } = setupP({ phase: "X" });
  try {
    const go = fx.issue(ph.phaseId, "S1");
    const M2 = clone(M);
    delete M2.send.texts.STATE.window;
    await refused(() => fx.send(G, { text: "STATE", target: "production", win: R, goId: go.goId, over: { manifest: M2 } }), /has no window role/);
    assert.equal(fx.calls.length, 0);
  } finally { fx.cleanup(); }
});

// ── SG-1 ─────────────────────────────────────────────────────────────────────

test("G-3 SG-1: the send command names its go by id; an old STATE command does not consume a newly issued STATE go", async () => {
  const { fx, ph, R } = setupP({ phase: "X" });
  try {
    const run = (text, goId) => fx.main([text, "--target", "production", "--confirm-ref", PROD, "--go", goId], R.env, { ppid: R.pid });
    const g1 = fx.issue(ph.phaseId, "S1");
    await run("STATE", g1.goId);
    fx.add(1000);
    const g2 = fx.issue(ph.phaseId, "S2");
    await run("P0", g2.goId);
    fx.add(1000);
    const g3 = fx.issue(ph.phaseId, "S3");
    assert.equal(g3.text, "STATE");
    assert.equal(fx.calls.length, 2);
    await refused(() => run("STATE", g1.goId), new RegExp(`go ${g1.goId} was already used`), "the S1 command from history");
    assert.equal(fx.calls.length, 2, "no request");
    assert.ok(existsSync(join(fx.paths.gos, `${g3.goId}.json`)), "the new STATE go is untouched");
    const r = await run("STATE", g3.goId);
    assert.equal(r.record.guard.step, "S3");
    assert.equal(fx.calls.length, 3);
    const gate = G.guardedProgress({ phase: ph, entries: G.readJournal(fx.paths, PROD), workflows: { ...G.WORKFLOWS, ...fx.workflows }, ctxAt: fx.ctxAt, now: fx.now() });
    assert.equal(gate.complete, true);
  } finally { fx.cleanup(); }
});

test("G-4 SG-1: a go issued for another phase, or for a step the gate does not name, is refused even with the same text", async () => {
  const fx = fixture({ workflows: WF() });
  try {
    fx.clock();
    const X = fx.phase("t", "X");
    const Y = fx.phase("t", "Y");
    const RX = fx.window("R", X.phaseId, { pid: 1001 });
    const RY = fx.window("R", Y.phaseId, { pid: 1003 });
    const gy = fx.issue(Y.phaseId, "Y1");
    assert.equal(gy.text, "STATE");
    await refused(() => fx.send(G, { text: "STATE", target: "production", win: RX, goId: gy.goId }), /is not for this send: its markerId differs/, "Y's go from X's window");
    const s3 = forgeGo(fx, { phase: X, marker: RX.marker, step: "S3", text: "STATE", target: "production" });
    await refused(() => fx.send(G, { text: "STATE", target: "production", win: RX, goId: s3.goId }), /the gate does not name S3: the next step is S1/, "a STATE go for S3 while S1 is next");
    const wrongPhase = forgeGo(fx, { phase: X, marker: RX.marker, step: "S1", text: "STATE", target: "production", over: { phaseId: Y.phaseId } });
    await refused(() => fx.send(G, { text: "STATE", target: "production", win: RX, goId: wrongPhase.goId }), /its phaseId differs/);
    const notInPhase = forgeGo(fx, { phase: X, marker: RX.marker, step: "Y1", text: "STATE", target: "production" });
    await refused(() => fx.send(G, { text: "STATE", target: "production", win: RX, goId: notInPhase.goId }), /step is not in its phase/);
    for (const [k, v] of [["text", "P0"], ["target", "staging"], ["head", "f".repeat(40)], ["checkout", ROOT + "-other"], ["phaseSha", "0".repeat(64)], ["workflow", "capture"], ["phase", "Y"]]) {
      const g = forgeGo(fx, { phase: X, marker: RX.marker, step: "S1", text: "STATE", target: "production", over: { [k]: v } });
      await refused(() => fx.send(G, { text: "STATE", target: "production", win: RX, goId: g.goId }), new RegExp(`its ${k} differs`), k);
    }
    const plan = S.planSend(M, "STATE", "production", { cwd: ROOT });
    const badReq = forgeGo(fx, { phase: X, marker: RX.marker, step: "S1", text: "STATE", target: "production", over: { request: { md5: plan.md5, bytes: plan.bytes + 1, readOnly: true, endpoint: M.send.endpoint.replace("{ref}", PROD) } } });
    await refused(() => fx.send(G, { text: "STATE", target: "production", win: RX, goId: badReq.goId }), /request is not this send's/);
    await refused(() => fx.send(G, { text: "STATE", target: "production", win: RX, goId: hex32() }), /no go [0-9a-f]{32} was issued/);
    fx.void(gy.goId);
    await refused(() => fx.send(G, { text: "STATE", target: "production", win: RY, goId: gy.goId }), /was voided/);
    // A go whose ref is not its phase's is caught by the store check itself.
    const wrongRef = forgeGo(fx, { phase: X, marker: RX.marker, step: "S1", text: "STATE", target: "production", over: { ref: STAGING } });
    await refused(() => fx.send(G, { text: "STATE", target: "production", win: RX, goId: wrongRef.goId }), /DAMAGED.*go [0-9a-f]{32}'s ref is not its phase's/, "ref");
    assert.equal(fx.calls.length, 0, "no request");
  } finally { fx.cleanup(); }
});

test("G-5 SG-1: a replayed issuance is refused; at most one usable go per project; a used step is not issued again", async () => {
  const { fx, ph, R } = setupP({ phase: "X" });
  try {
    const g1 = fx.issue(ph.phaseId, "S1");
    await refused(() => fx.issue(ph.phaseId, "S1"), new RegExp(`go ${g1.goId} \\(S1\\) is outstanding`), "the same issuance again");
    await refused(() => fx.issue(ph.phaseId, "S2"), /is outstanding/, "another step while one go is outstanding");
    assert.equal(liveGos(fx).length, 1);
    await fx.send(G, { text: "STATE", target: "production", win: R, goId: g1.goId });
    fx.add(1000);
    await refused(() => fx.issue(ph.phaseId, "S1"), /the gate does not name S1: the next step is S2/, "the S1 issuance replayed after S1 was sent");
    const g2 = fx.issue(ph.phaseId, "S2");
    fx.void(g2.goId);
    const g2b = fx.issue(ph.phaseId, "S2");
    assert.notEqual(g2b.goId, g2.goId);
    assert.equal(liveGos(fx).length, 1);
    await refused(() => fx.send(G, { text: "P0", target: "production", win: R, goId: g2.goId }), /was voided/);
    assert.equal(fx.calls.length, 1);
  } finally { fx.cleanup(); }
});

// ── child processes: concurrency and a real crash ───────────────────────────

const WORKER = `
import { readFileSync, writeFileSync, existsSync } from "node:fs";
const cfg = JSON.parse(readFileSync(process.argv[2], "utf8"));
const F = await import(cfg.fixtureUrl);
const G = await import(cfg.guardUrl);
const fx = F.fixture({ workflows: { t: F.synthWorkflow(cfg.target, cfg.phases) }, attach: { stateDir: cfg.stateDir, results: cfg.results }, t0: cfg.now });
for (const pid of cfg.shells) fx.shell(pid);
while (!existsSync(cfg.startFile)) await new Promise((r) => setTimeout(r, 2));
let out;
try {
  if (cfg.mode === "issue") { const g = fx.issue(cfg.phaseId, cfg.step); out = { ok: true, goId: g.goId }; }
  else {
    let n = 0;
    const fetchImpl = cfg.mode === "hang"
      ? async () => { n++; writeFileSync(cfg.outFile + ".fetched", "1"); setInterval(() => {}, 1000); return new Promise(() => {}); }
      : async () => { n++; return new Response('[{"set_config":"45s"}]', { status: 201 }); };
    try { await fx.send(G, { text: cfg.text, target: cfg.target, win: { env: cfg.env, pid: cfg.pid }, goId: cfg.goId, over: { fetchImpl } }); out = { ok: true, calls: n }; }
    catch (e) { out = { ok: false, name: e.constructor.name, message: e.message, calls: n }; }
  }
} catch (e) { out = { ok: false, name: e.constructor.name, message: e.message }; }
writeFileSync(cfg.outFile, JSON.stringify(out));
process.exit(0);
`;

/** Start one worker per config, release them together, and return their outputs. */
async function workers(fx, cfgs, { kill = null } = {}) {
  const wdir = join(fx.dir, `w-${hex32().slice(0, 6)}`);
  mkdirSync(wdir, { recursive: true });
  const script = join(wdir, "worker.mjs");
  writeFileSync(script, WORKER);
  const startFile = join(wdir, "start");
  const procs = cfgs.map((c, i) => {
    const outFile = join(wdir, `out-${i}.json`);
    const cfgFile = join(wdir, `cfg-${i}.json`);
    writeFileSync(cfgFile, JSON.stringify({
      fixtureUrl: pathToFileURL(join(ROOT, "scripts", "tests", "stage0-guard-fixture.mjs")).href,
      guardUrl: pathToFileURL(join(ROOT, "scripts", "manual", "stage0-guard.mjs")).href,
      stateDir: fx.stateDir, results: fx.results, now: fx.now(), startFile, outFile, ...c,
    }));
    const p = spawn(process.execPath, [script, cfgFile], { stdio: "ignore", windowsHide: true });
    return { p, outFile, done: new Promise((res) => p.on("exit", res)) };
  });
  await new Promise((r) => setTimeout(r, 1500)); // every worker has loaded its modules
  writeFileSync(startFile, "go");
  if (kill) {
    const fetched = procs[kill.index].outFile + ".fetched";
    const until = Date.now() + 60000;
    while (!existsSync(fetched) && Date.now() < until) await new Promise((r) => setTimeout(r, 20));
    assert.ok(existsSync(fetched), "the hanging worker reached fetch");
    procs[kill.index].p.kill();
  }
  await Promise.all(procs.map((x) => x.done));
  return procs.map((x) => (existsSync(x.outFile) ? JSON.parse(readFileSync(x.outFile, "utf8")) : null));
}

test("G-6 SG-1/SG-2: two processes issuing the same step leave one usable go; two processes sending one go make at most one request", async () => {
  const { fx, ph, W } = setupP();
  try {
    const phases = { X: [["S1", "STATE"], ["S2", "P0"], ["S3", "STATE"]], Y: [["Y1", "STATE"]], P: [["A1", "P2-01"], ["A2", "STATE"], ["A3", "P2-02"]] };
    const issued = await workers(fx, [0, 1, 2].map(() => ({ mode: "issue", phaseId: ph.phaseId, step: "A1", target: "production", phases, shells: [1001, 1002] })));
    assert.equal(issued.filter((o) => o && o.ok).length, 1, `exactly one issuer wins: ${JSON.stringify(issued)}`);
    for (const o of issued.filter((x) => x && !x.ok)) assert.match(o.message, /holds the gmxyisjjaxtpycsmmzef lock|is outstanding/);
    assert.equal(liveGos(fx).length, 1, "one usable go");
    const goId = issued.find((o) => o.ok).goId;
    const sent = await workers(fx, [0, 1, 2].map(() => ({ mode: "send", goId, text: "P2-01", target: "production", env: W.env, pid: W.pid, phases, shells: [1001, 1002] })));
    assert.equal(sent.filter((o) => o && o.ok).length, 1, `exactly one sender is admitted: ${JSON.stringify(sent)}`);
    assert.equal(sent.reduce((n, o) => n + (o ? o.calls || 0 : 0), 0), 1, "one request in all");
    const entries = G.readJournal(fx.paths, PROD);
    assert.equal(entries.length, 1, "one claim");
  } finally { fx.cleanup(); }
});

// ── SG-2 ─────────────────────────────────────────────────────────────────────

test("G-7 SG-2: while a claimed request is in flight, no go is issued and no send is admitted", async () => {
  const { fx, ph, R, W } = setupP();
  try {
    const g1 = fx.issue(ph.phaseId, "A1");
    let release;
    const gate = new Promise((r) => { release = r; });
    const inflight = fx.send(G, { text: "P2-01", target: "production", win: W, goId: g1.goId, over: { fetchImpl: async () => { fx.calls.push("A1"); await gate; return new Response('[{"set_config":"45s"}]', { status: 201 }); } } });
    assert.equal(fx.calls.length, 1, "A1's request is in flight");
    assert.deepEqual(holds(fx).map((h) => h.kind), ["PENDING"]);
    await refused(() => fx.issue(ph.phaseId, "A2"), /the project is held: PENDING/, "issuance");
    const a2 = forgeGo(fx, { phase: ph, marker: R.marker, step: "A2", text: "STATE", target: "production" });
    await refused(() => fx.send(G, { text: "STATE", target: "production", win: R, goId: a2.goId }), /the project is held: PENDING/, "a send");
    assert.equal(fx.calls.length, 1, "no second request");
    const { ph2 } = await heldAcrossSessions(fx, "while in flight");
    release();
    await inflight;
    assert.deepEqual(holds(fx), [], "the outcome is recorded: nothing holds");
    assert.ok(!existsSync(join(fx.paths.gos, `${a2.goId}.json`)), "closing the R window removed its unused go");
    fx.add(1000);
    const g2 = fx.issue(ph2.phaseId, "A1");
    assert.equal(g2.step, "A1", "the new phase goes on once the claim has its outcome");
  } finally { fx.cleanup(); }
});

/**
 * After an unknown outcome: closing every window, opening new ones (new
 * session values and shells) in a NEW phase, nothing is issued or admitted.
 */
async function heldAcrossSessions(fx, label) {
  const before = fx.calls.length;
  for (const pid of [1001, 1002]) G.closeSession({ paths: fx.paths, env: { [G.SESSION_ENV]: nonce(pid) }, now: fx.now() });
  assert.deepEqual(readdirSync(fx.paths.markers).filter((f) => f.endsWith(".json")), [], `${label}: closed`);
  fx.add(1000);
  const ph2 = fx.phase("t", "P");
  const R2 = fx.window("R", ph2.phaseId, { pid: 5001 });
  const W2 = fx.window("W", ph2.phaseId, { pid: 5002 });
  await refused(() => fx.issue(ph2.phaseId, "A1"), /the project is held/, `${label}: issuance in a new phase`);
  const forged = forgeGo(fx, { phase: ph2, marker: W2.marker, step: "A1", text: "P2-01", target: "production" });
  await refused(() => fx.send(G, { text: "P2-01", target: "production", win: W2, goId: forged.goId }), /the project is held/, `${label}: a send from a new window`);
  const forgedR = forgeGo(fx, { phase: ph2, marker: R2.marker, step: "A1", text: "STATE", target: "production" });
  await refused(() => fx.send(G, { text: "STATE", target: "production", win: R2, goId: forgedR.goId }), /the project is held|is not for this send|gate does not name/, `${label}: a read`);
  assert.equal(fx.calls.length, before, `${label}: no request`);
  for (const g of [forged, forgedR]) fx.void(g.goId);
  return { ph2, R2, W2 };
}

/** On a DAMAGED store: closing, a new phase, a window, a go and a send are each refused, with no request. */
async function refusedWhileDamaged(fx, label, { ph, W }) {
  const before = fx.calls.length;
  assert.equal(fx.check().ok, false, `${label}: the store check fails`);
  const st = fx.status();
  assert.equal(st.intact, false, `${label}: status reports damage`);
  assert.ok(!("holds" in st), `${label}: status prints no holds list`);
  fx.add(1000);
  await refused(() => fx.draft("t", "P"), /DAMAGED/, `${label}: a new approval`);
  await refused(() => fx.issue(ph.phaseId, "A2"), /DAMAGED/, `${label}: issuance`);
  await refused(() => fx.window("R", ph.phaseId, { pid: 5003 }), /DAMAGED/, `${label}: a new window`);
  const g = fx.forgeGo({ phase: ph, marker: W.marker, step: "A1", text: "P2-01", target: "production" });
  await refused(() => fx.send(G, { text: "P2-01", target: "production", win: W, goId: g.goId }), /DAMAGED/, `${label}: a send`);
  assert.equal(fx.calls.length, before, `${label}: no request`);
}

test("G-8 SG-2: a process killed after its claim leaves PENDING, which holds across close, reopen, a new marker and a new phase until a reviewed disposition", async () => {
  const { fx, ph, W } = setupP();
  try {
    const g1 = fx.issue(ph.phaseId, "A1");
    const phases = { X: [["S1", "STATE"], ["S2", "P0"], ["S3", "STATE"]], Y: [["Y1", "STATE"]], P: [["A1", "P2-01"], ["A2", "STATE"], ["A3", "P2-02"]] };
    const out = await workers(fx, [{ mode: "hang", goId: g1.goId, text: "P2-01", target: "production", env: W.env, pid: W.pid, phases, shells: [1001, 1002] }], { kill: { index: 0 } });
    assert.equal(out[0], null, "the worker died before reporting");
    const h = holds(fx);
    assert.equal(h.length, 1);
    assert.equal(h[0].kind, "PENDING");
    await heldAcrossSessions(fx, "after a crash");
    const review = join(fx.dir, "review.md");
    writeFileSync(review, "no reviewed text names it");
    await refused(() => fx.dispose(h[0].attemptId, review), /does not name the attempt id/);
    writeFileSync(review, `Disposition of attempt ${h[0].attemptId}: reviewed.`);
    fx.dispose(h[0].attemptId, review);
    assert.deepEqual(holds(fx), []);
  } finally { fx.cleanup(); }
});

test("G-9 SG-2: a fetch failure and a response-body failure are recorded, classify R1, and hold the project", async () => {
  for (const [label, fetchImpl] of [
    ["fetch failure", async () => { throw new TypeError("fetch failed"); }],
    ["response-body failure", async () => ({ status: 201, text: async () => { throw new TypeError("terminated"); } })],
  ]) {
    const { fx, ph, W } = setupP();
    try {
      const g1 = fx.issue(ph.phaseId, "A1");
      let n = 0;
      const r = await fx.send(G, { text: "P2-01", target: "production", win: W, goId: g1.goId, over: { fetchImpl: async (...a) => { n++; return fetchImpl(...a); } } });
      assert.equal(n, 1, label);
      assert.match(r.record.error, /TypeError/, label);
      const h = holds(fx);
      assert.equal(h.length, 1, label);
      assert.match(h[0].why, /writing send that rule 3′ classifies R1/, label);
      await heldAcrossSessions(fx, label);
    } finally { fx.cleanup(); }
  }
});

test("G-10 SG-2: a receipt or an outcome that cannot be written after the request is AfterDispatch, never 'nothing sent', and holds", async () => {
  {
    const { fx, ph, W } = setupP();
    try {
      const g1 = fx.issue(ph.phaseId, "A1");
      const e = await fx.send(G, { text: "P2-01", target: "production", win: W, goId: g1.goId, over: { writeReceipt: () => { throw new Error("disk full"); } } }).catch((x) => x);
      assert.ok(e instanceof G.AfterDispatch, String(e));
      assert.match(e.message, /dispatched \(HTTP 201\), but its receipt could not be written/);
      assert.equal(fx.calls.length, 1);
      assert.deepEqual(holds(fx).map((h) => h.kind), ["PENDING"]);
      await heldAcrossSessions(fx, "no receipt");
    } finally { fx.cleanup(); }
  }
  {
    const { fx, ph, W } = setupP();
    try {
      const g1 = fx.issue(ph.phaseId, "A1");
      const e = await fx.send(G, {
        text: "P2-01", target: "production", win: W, goId: g1.goId,
        over: { writeReceipt: (rec) => { const f = S.writeRecord(rec, fx.results); writeFileSync(join(fx.paths.journal(PROD), `${rec.guard.attemptId}.outcome.json`), "{not json"); return f; } },
      }).catch((x) => x);
      assert.ok(e instanceof G.AfterDispatch, String(e));
      assert.match(e.message, /its outcome could not be recorded/);
      assert.deepEqual(holds(fx).map((h) => h.kind), ["HOLD"]);
      // The planted outcome file is no outcome the ledger records: the store is damaged.
      await refusedWhileDamaged(fx, "no outcome", { ph, W });
    } finally { fx.cleanup(); }
  }
});

test("G-11 SG-2/I6-R1: a missing or altered receipt holds the project; a malformed claim or an unknown journal file is damage", async () => {
  const { fx, ph, W } = setupP();
  try {
    const g1 = fx.issue(ph.phaseId, "A1");
    const r = await fx.send(G, { text: "P2-01", target: "production", win: W, goId: g1.goId });
    assert.deepEqual(holds(fx), [], "a bound R2 write holds nothing");
    const bytes = readFileSync(r.file);
    unlinkSync(r.file);
    assert.match(holds(fx)[0].why, /receipt is missing or unreadable/);
    const { ph2, R2 } = await heldAcrossSessions(fx, "a missing receipt");
    writeFileSync(r.file, Buffer.concat([bytes, Buffer.from(" ")]));
    assert.match(holds(fx)[0].why, /not the file the journal recorded/);
    writeFileSync(r.file, bytes);
    assert.deepEqual(holds(fx), []);
    const jdir = fx.paths.journal(PROD);
    writeFileSync(join(jdir, `${hex32()}.claim.json`), '{"schema":"stage0-claim/1"}');
    assert.match(holds(fx).map((h) => h.why).join(" "), /has no attemptId|has no seq/);
    for (const f of readdirSync(jdir)) if (!f.startsWith(r.attemptId)) unlinkSync(join(jdir, f));
    writeFileSync(join(jdir, "notes.txt"), "x");
    assert.match(holds(fx)[0].why, /an unknown journal file notes\.txt/);
    assert.match(fx.check().problems.join(" "), /journal.gmxyisjjaxtpycsmmzef.notes\.txt is present, but the ledger does not record it/);
    fx.add(1000);
    await refused(() => fx.issue(ph2.phaseId, "A1"), /DAMAGED/);
    const a2 = forgeGo(fx, { phase: ph2, marker: R2.marker, step: "A2", text: "STATE", target: "production" });
    await refused(() => fx.send(G, { text: "STATE", target: "production", win: R2, goId: a2.goId }), /DAMAGED/);
    assert.equal(fx.calls.length, 1);
  } finally { fx.cleanup(); }
});

test("G-12 SG-2/SG-5: when the deadline passes between admission and fetch, NOT_SENT is recorded, no request is made, and nothing is held", async () => {
  const { fx, ph, W } = setupP();
  try {
    const g1 = fx.issue(ph.phaseId, "A1");
    const D = G.utcMs(g1.deadline);
    let k = 0;
    const now = () => (++k <= 2 ? D - 1 : D); // admission and the lock at D-1; the pre-fetch check at D
    fx.set(D - 1);
    const e = await refused(() => fx.send(G, { text: "P2-01", target: "production", win: W, goId: g1.goId, over: { now } }), /passed before the request; no request was made, and attempt [0-9a-f]{32} is recorded NOT_SENT/);
    assert.equal(fx.calls.length, 0);
    const id = /attempt ([0-9a-f]{32})/.exec(e.message)[1];
    assert.equal(outcomeOf(fx, id).state, "NOT_SENT");
    assert.deepEqual(holds(fx), []);
    const gate = G.guardedProgress({ phase: ph, entries: G.readJournal(fx.paths, PROD), workflows: { ...G.WORKFLOWS, ...fx.workflows }, ctxAt: fx.ctxAt, now: D - 1 });
    assert.equal(gate.next, "A1", "a NOT_SENT attempt does not use up its step");
    await refused(() => fx.send(G, { text: "P2-01", target: "production", win: W, goId: g1.goId }), /already used/, "the go itself is used");
  } finally { fx.cleanup(); }
});

test("G-13 SG-2: an R4 writing send holds the project, an R4 read does not; a reviewed disposition releases exactly one attempt", async () => {
  const { fx, ph, W } = setupP();
  try {
    const g1 = fx.issue(ph.phaseId, "A1");
    await fx.send(G, { text: "P2-01", target: "production", win: W, goId: g1.goId, over: { fetchImpl: async () => { fx.calls.push(1); return new Response("[]", { status: 201 }); } } });
    const h = holds(fx);
    assert.equal(h.length, 1);
    assert.match(h[0].why, /P2-01\) is a writing send that rule 3′ classifies R4 UNRESOLVED/);
    fx.add(1000);
    await refused(() => fx.issue(ph.phaseId, "A2"), /the project is held: HOLD/);
    const review = join(fx.dir, "review.md");
    writeFileSync(review, `Reviewed: attempt ${h[0].attemptId} is disposed of.`);
    fx.dispose(h[0].attemptId, review);
    await refused(() => fx.dispose(h[0].attemptId, review), /already has a disposition/);
    assert.deepEqual(holds(fx), []);
    await refused(() => fx.issue(ph.phaseId, "A2"), /the gate does not name A2: STOP: A1 was STOP|the gate does not name A2: STOP/, "the phase itself still stops; a new phase needs a new go");
    // A read: STATE answered with a body that is not its contract is R4, and holds nothing.
    const fx2 = fixture({ workflows: WF() });
    try {
      fx2.clock();
      const X = fx2.phase("t", "X");
      const R2 = fx2.window("R", X.phaseId, { pid: 1001 });
      const s1 = fx2.issue(X.phaseId, "S1");
      await fx2.send(G, { text: "STATE", target: "production", win: R2, goId: s1.goId });
      assert.equal(C.classifyText(readFileSync(readdirSync(fx2.results).map((f) => join(fx2.results, f))[0], "utf8"), ctx()).class, "R4");
      assert.deepEqual(holds(fx2), []);
    } finally { fx2.cleanup(); }
  } finally { fx.cleanup(); }
});

// ── SG-3 ─────────────────────────────────────────────────────────────────────

test("G-14 SG-3: the marker binds the window's shell process and token; a child shell, a closed or reused process, another program and another token are refused", async () => {
  const { fx, ph, R } = setupP({ phase: "X" });
  try {
    const g1 = fx.issue(ph.phaseId, "S1");
    const send = (over, env = R.env, token) => fx.send(G, { text: "STATE", target: "production", win: { env, pid: over.ppid ?? R.pid }, goId: g1.goId, token, over });
    fx.shell(2001, { created: "2026-10-28T13:30:00.0000000Z" });
    await refused(() => send({ ppid: 2001 }), /belongs to another window \(process 1001\); this command runs in process 2001/, "a child shell with the inherited environment");
    fx.shell(2002, { image: "node.exe" });
    await refused(() => send({ ppid: 2002 }), /node was started by node\.exe, not by a PowerShell window/, "a shim");
    fx.shell(2003, { image: "cmd.exe" });
    await refused(() => send({ ppid: 2003 }), /started by cmd\.exe/);
    fx.shells.set(2004, { pid: 2004, image: "powershell.exe", created: G.iso(fx.now() + 5).replace("Z", "0000Z") });
    await refused(() => send({ ppid: 2004 }), /created after this node process started/, "a process younger than node");
    const real = fx.shells.get(1001);
    fx.shells.set(1001, { ...real, created: "2026-10-28T13:00:00.9999999Z" });
    await refused(() => send({}), /belongs to another window/, "a reused pid");
    fx.shells.delete(1001);
    await refused(() => send({}), /the process that started node \(1001\) is gone/, "a closed window");
    await refused(() => fx.issue(ph.phaseId, "S2"), /0 live R windows are open|outstanding/, "the issuer sees the closed window");
    fx.shells.set(1001, real);
    await refused(() => send({}, R.env, OTHER_TOKEN), /the token in this window is not the one loaded/, "another token");
    await refused(() => send({}, { [G.TOKEN_ENV]: TOKEN }), /STAGE0_SESSION is not set/, "no session value");
    await refused(() => send({}, { [G.SESSION_ENV]: nonce(9999), [G.TOKEN_ENV]: TOKEN }), /no marker for this window's session/, "another session value");
    assert.equal(fx.calls.length, 0, "no request");
    await refused(() => fx.window("R", ph.phaseId, { pid: 1001, n: 1001 }), /this window already has marker/, "a second marker in one window");
    const r = await send({});
    assert.equal(r.record.httpStatus, 201, "the window itself is admitted");
    assert.equal(fx.calls.length, 1);
  } finally { fx.cleanup(); }
});

test("G-14b SG-3: a window that is gone is replaced on open; a live one of the same role is not", async () => {
  const fx = fixture({ workflows: WF() });
  try {
    fx.clock();
    const ph = fx.phase("t", "X");
    const R1 = fx.window("R", ph.phaseId, { pid: 1001 });
    await refused(() => fx.window("R", ph.phaseId, { pid: 1005 }), new RegExp(`a live R window for this phase already exists \\(marker ${R1.marker.markerId}\\)`));
    fx.shells.delete(1001);
    const R2 = fx.window("R", ph.phaseId, { pid: 1006 });
    assert.ok(!existsSync(join(fx.paths.markers, `${R1.marker.markerId}.json`)), "the dead window's marker is closed");
    assert.ok(existsSync(join(fx.paths.closed, `${R1.marker.markerId}.json`)), "and kept, as evidence");
    assert.ok(existsSync(join(fx.paths.markers, `${R2.marker.markerId}.json`)));
    const closed = G.closeSession({ paths: fx.paths, env: R2.env, now: fx.now() });
    assert.deepEqual(closed.markers, [R2.marker.markerId]);
    assert.deepEqual(G.closeSession({ paths: fx.paths, env: {}, now: fx.now() }), { markers: [], gos: [], problems: [] }, "closing with no session value changes nothing");
    assert.equal(fx.check().ok, true, "every close is recorded");
  } finally { fx.cleanup(); }
});

// ── SG-4 ─────────────────────────────────────────────────────────────────────

const HELD_FIXTURES = readdirSync(REAL).filter((f) => f.endsWith(".json")).sort();

test("G-15 SG-4: R1 accepts a guard block only in its exact shape; without one, the 24 held receipts keep their classes", () => {
  assert.equal(HELD_FIXTURES.length, 24);
  assert.deepEqual([...C.GUARD_KEYS].sort(), Object.keys(G.RECEIPT_GUARD_SPEC).sort(), "the classifier's and the guard's block are the same keys");
  for (const f of HELD_FIXTURES) {
    const text = readFileSync(join(REAL, f), "utf8");
    const rec = JSON.parse(text);
    assert.ok(!("guard" in rec), `${f} predates item 6`);
    const base = C.classifyText(text, ctx());
    const role = G.roleOf(M, rec.text);
    const guard = { attemptId: hex32(), goId: hex32(), phaseId: hex32(), step: "S1", markerId: hex32(), role, head: HEAD, issuedAt: rec.startedAt, deadline: G.iso(Date.parse(rec.startedAt) + 60000) };
    const withGuard = C.classifyText(JSON.stringify({ ...rec, guard }, null, 2), ctx());
    assert.equal(withGuard.class, base.class, `${f}: a well-formed guard block changes nothing`);
    const bad = [
      ["a missing key", (() => { const g = { ...guard }; delete g.head; return g; })(), /exactly the guard keys/],
      ["an extra key", { ...guard, tokenTag: "0".repeat(64) }, /exactly the guard keys/],
      ["a short id", { ...guard, goId: "abc" }, /32 lower-case hex/],
      ["another role", { ...guard, role: role === "R" ? "W" : "R" }, /window role in the send policy/],
      ["role X", { ...guard, role: "X" }, /not R, W or C/],
      ["a short head", { ...guard, head: "abc1234" }, /full commit id/],
      ["month 13", { ...guard, deadline: "2026-13-01T00:00:00.000Z" }, /two ordered UTC times/],
      ["a deadline before the issue", { ...guard, deadline: G.iso(Date.parse(rec.startedAt) - 60000) }, /two ordered UTC times/],
      ["sent before its go", { ...guard, issuedAt: G.iso(Date.parse(rec.startedAt) + 1) }, /started before its go was issued/],
      ["not an object", "W", /guard is not an object/],
    ];
    for (const [label, g, re] of bad) {
      const c = C.classifyText(JSON.stringify({ ...rec, guard: g }), ctx());
      assert.equal(c.class, "R1", `${f}: ${label}`);
      assert.match(c.reasons.join("; "), re, `${f}: ${label}`);
    }
  }
});

/**
 * Rewrite one attempt's receipt, its outcome's sha256 and the ledger line
 * that records the outcome, consistently, as a deliberate edit would: the
 * store check passes, so only the receipt's binding to its claim can catch it.
 */
function tamper(fx, attemptId, edit) {
  const of = join(fx.paths.journal(PROD), `${attemptId}.outcome.json`);
  const o = G.readState(of);
  const rec = JSON.parse(readFileSync(o.receipt.file, "utf8"));
  const text = typeof edit === "function" ? (edit(rec), JSON.stringify(rec, null, 2) + "\n") : edit;
  writeFileSync(o.receipt.file, text);
  const buf = readFileSync(o.receipt.file);
  const outText = JSON.stringify({ ...o, receipt: { ...o.receipt, sha256: G.sha256(buf), bytes: buf.length } }, null, 2) + "\n";
  writeFileSync(of, outText);
  rechain(fx, (events) => { events.find((e) => e.kind === "outcome" && e.attemptId === attemptId).sha256 = G.sha256(Buffer.from(outText, "utf8")); });
  assert.equal(fx.check().ok, true, "the edit is consistent with the store");
}

test("G-16 SG-4: guarded progression stops, and the project holds, on a stripped guard, a swapped window, a wrong role, go, phase, step or head, and a historical receipt", async () => {
  const cases = [
    ["a stripped guard block", (r) => { delete r.guard; }, /no guard block/],
    ["a swapped window id", (r) => { r.guard.markerId = hex32(); }, /guard block's markerId is not the claim's/],
    ["a wrong role", (r) => { r.guard.role = "R"; }, /guard block's role is not the claim's/],
    ["a wrong go", (r) => { r.guard.goId = hex32(); }, /guard block's goId is not the claim's/],
    ["a wrong phase", (r) => { r.guard.phaseId = hex32(); }, /guard block's phaseId is not the claim's/],
    ["a wrong step", (r) => { r.guard.step = "A2"; }, /guard block's step is not the claim's/],
    ["a wrong head", (r) => { r.guard.head = "f".repeat(40); }, /guard block's head is not the claim's/],
    ["a later issue time", (r) => { r.guard.issuedAt = G.iso(Date.parse(r.guard.issuedAt) + 1); }, /guard block's issuedAt is not the claim's/],
    ["a historical receipt (P2-01 send 1, 2026-10-09)", readFileSync(join(REAL, "2026-10-09T15-17-05-343Z_P2-01_production.json"), "utf8"), /no guard block|request is not the claim's/],
  ];
  for (const [label, edit, re] of cases) {
    const { fx, ph, W } = setupP();
    try {
      const g1 = fx.issue(ph.phaseId, "A1");
      const r = await fx.send(G, { text: "P2-01", target: "production", win: W, goId: g1.goId });
      assert.deepEqual(holds(fx), [], `${label}: bound before the edit`);
      tamper(fx, r.attemptId, edit);
      const h = holds(fx);
      assert.equal(h.length, 1, label);
      assert.match(h[0].why, re, label);
      const gate = G.guardedProgress({ phase: ph, entries: G.readJournal(fx.paths, PROD), workflows: { ...G.WORKFLOWS, ...fx.workflows }, ctxAt: fx.ctxAt, now: fx.now() });
      assert.equal(gate.stop, true, label);
      assert.match(gate.reason, re, label);
      fx.add(1000);
      await refused(() => fx.issue(ph.phaseId, "A2"), /the project is held: HOLD/, label);
      assert.equal(fx.calls.length, 1, label);
    } finally { fx.cleanup(); }
  }
});

test("G-17 the real capture gate through the guarded tools: phase U needs its reviewed decision; U2 before U1 is refused; each step by its own go; complete after U2", async () => {
  const fx = fixture();
  try {
    fx.clock();
    await refused(() => fx.phase("capture", "U"), /phase U needs a reviewed decision on T2's receipt/);
    const ph = fx.phase("capture", "U", { reviewed: { path: "C:/reviews/2026-10-23-capture-BAT-review.md", sha256: "a".repeat(64) } });
    assert.deepEqual(ph.steps, ["U1", "U2"]);
    assert.equal(ph.ref, STAGING);
    await refused(() => fx.window("R", ph.phaseId, { pid: 1001 }), /sends nothing from an R window/);
    const W = fx.window("W", ph.phaseId, { pid: 1002 });
    await refused(() => fx.issue(ph.phaseId, "U2"), /the gate does not name U2: the next step is U1/);
    const u1 = fx.issue(ph.phaseId, "U1");
    assert.equal(u1.text, "LOCKPROBE-READBACK");
    const run = (text, goId) => fx.main([text, "--target", "staging", "--confirm-ref", STAGING, "--go", goId], W.env, { ppid: W.pid });
    await run("LOCKPROBE-READBACK", u1.goId);
    fx.add(1000);
    const u2 = fx.issue(ph.phaseId, "U2");
    await run("LOCKPROBE-CLEANUP", u2.goId);
    fx.add(1000);
    await refused(() => fx.issue(ph.phaseId, "U2"), /phase U is complete/);
    assert.equal(fx.calls.length, 2);
    assert.deepEqual(holds(fx, STAGING), []);
    const gate = G.guardedProgress({ phase: ph, entries: G.readJournal(fx.paths, STAGING), ctxAt: fx.ctxAt, now: fx.now() });
    assert.deepEqual(gate.results.map((r) => [r.step, r.verdict]), [["U1", "MATCH"], ["U2", "MATCH"]]);
    await refused(() => fx.phase("capture", "Q", { goText: "x" }), /declares no phase "Q"/);
    await refused(() => fx.phase("production", "P1", { goText: "x" }), /no reviewed workflow "production"/, "no production phase is declared");
  } finally { fx.cleanup(); }
});

// ── SG-5 ─────────────────────────────────────────────────────────────────────

test("G-18 SG-5: the go's deadline and the window's end are exclusive bounds: 1 ms before is admitted, at or after is refused", async () => {
  for (const [delta, calls] of [[-1, 1], [0, 0], [1, 0]]) {
    const { fx, ph, W } = setupP();
    try {
      const g1 = fx.issue(ph.phaseId, "A1");
      fx.set(G.utcMs(g1.deadline) + delta);
      const p = fx.send(G, { text: "P2-01", target: "production", win: W, goId: g1.goId });
      if (calls) assert.equal((await p).record.httpStatus, 201, `go deadline ${delta}`);
      else await refused(() => p, /deadline .* has passed/, `go deadline ${delta}`);
      assert.equal(fx.calls.length, calls, `go deadline ${delta}`);
    } finally { fx.cleanup(); }
  }
  // A window always ends at the phase deadline, after every step's ceiling;
  // to reach its own bound, this marker is rewritten to end 5 min before the
  // ceiling (and its ledger line with it), so the issuer's go ends there too.
  for (const [delta, calls] of [[-1, 1], [0, 0], [1, 0]]) {
    const { fx, ph, W } = setupP();
    try {
      W.marker = endMarker(fx, W.marker, G.utcMs(ph.ceilings.A1) - 5 * MIN);
      const go = fx.issue(ph.phaseId, "A1");
      assert.equal(go.deadline, W.marker.until, "the go ends with its window");
      fx.set(G.utcMs(W.marker.until) + delta);
      const p = fx.send(G, { text: "P2-01", target: "production", win: W, goId: go.goId });
      if (calls) assert.equal((await p).record.httpStatus, 201, `window end ${delta}`);
      else await refused(() => p, /ended at/, `window end ${delta}`);
      assert.equal(fx.calls.length, calls, `window end ${delta}`);
    } finally { fx.cleanup(); }
  }
});

test("G-19 SG-5: authority from the future refuses; the clock check must exist, be fresh, within tolerance and not later than now; a clock that went back refuses until a new check", async () => {
  {
    const { fx, ph, W } = setupP();
    try {
      const go = forgeGo(fx, { phase: ph, marker: W.marker, step: "A1", text: "P2-01", target: "production", over: { issuedAt: G.iso(fx.now() + 1) } });
      await refused(() => fx.send(G, { text: "P2-01", target: "production", win: W, goId: go.goId }), /was issued later than now/, "a go from the future");
      fx.add(2000);
      const W2 = fx.window("W", fx.phase("t", "P").phaseId, { pid: 1009 });
      fx.add(-1000);
      await refused(() => fx.send(G, { text: "P2-01", target: "production", win: W2, goId: go.goId }), /was created later than now/, "a marker from the future");
      fx.add(3000);
      const ph3 = fx.phase("t", "P");
      fx.add(-1500);
      await refused(() => fx.window("R", ph3.phaseId, { pid: 1010 }), /recorded later than now/, "a phase from the future");
      assert.equal(fx.calls.length, 0);
    } finally { fx.cleanup(); }
  }
  {
    const fx = fixture({ workflows: WF() });
    try {
      const cc = (t) => G.checkClock(fx.paths, t, fx.check());
      assert.throws(() => cc(fx.now()), /no clock check is recorded/);
      fx.clock();
      fx.add(60 * MIN);
      assert.throws(() => cc(fx.now()), /older than 60 min/);
      fx.add(-60 * MIN);
      fx.add(-5000);
      assert.throws(() => cc(fx.now()), /later than now: the clock went back/);
      fx.add(5000);
      cc(fx.now() + 30000);
      assert.throws(() => cc(fx.now() + 27999), /2001 ms behind a time a guard tool already saw/);
      cc(fx.now() + 28000);
      fx.add(25000);
      fx.clock();
      cc(fx.now());
      assert.throws(() => fx.clock(["+02.0010000", "+00.0010000", "+00.0010000"]), /2001 ms from time\.windows\.com, beyond the 2000 ms tolerance/);
      assert.throws(() => fx.clock(["+00.0010000", "+00.0010000"]), /did not give 3 readable samples/);
      const rc = (measurement) => G.recordClock({ paths: fx.paths, anchor: fx.anchor, manifest: M, measurement, now: fx.now() });
      assert.throws(() => rc({ status: null, stripchart: "10:00:00, error: 0x800705B4\n" }), /did not give 3 readable samples/);
      const ok = rc({ status: "unavailable: access denied", stripchart: "10:00:00, -01.9990000s\n10:00:02, +00.0000000s\n10:00:04, +01.5000000s\n" });
      assert.deepEqual(ok.offsetsMs, [-1999, 0, 1500]);
      assert.equal(ok.source, "not reported");
      assert.equal(fx.check().ok, true, "every clock check is recorded");
    } finally { fx.cleanup(); }
  }
  {
    const { fx, ph, W } = setupP();
    try {
      const g1 = fx.issue(ph.phaseId, "A1");
      fx.add(50 * MIN);
      await refused(() => fx.send(G, { text: "P2-01", target: "production", win: W, goId: g1.goId }), /ended at|deadline .* has passed/, "a clock that jumped forward");
      fx.add(-50 * MIN + 1000);
      await refused(() => fx.send(G, { text: "P2-01", target: "production", win: W, goId: g1.goId }), /it went back; run a new clock check/, "and back");
      const deps = { manifest: M, anchor: fx.anchor, stateDir: fx.stateDir, now: fx.now, identity: fx.identity, git: fx.git, execArgv: [], stdout: () => {}, workflows: fx.workflows, ctxAt: fx.ctxAt };
      await refused(() => GO.main(["issue", "--phase", ph.phaseId, "--step", "A2"], {}, deps), /it went back; run a new clock check/, "the issuer, too");
      fx.shell(7003);
      await refused(() => WIN.main(["open", "--role", "R", "--phase", ph.phaseId], { [G.SESSION_ENV]: nonce(7003), [G.TOKEN_ENV]: TOKEN }, { ...deps, ppid: 7003, selfStartMs: fx.now() }), /it went back; run a new clock check/, "and a window's setup");
      fx.clock();
      const r = await fx.send(G, { text: "P2-01", target: "production", win: W, goId: g1.goId });
      assert.equal(r.record.httpStatus, 201, "after a new clock check");
    } finally { fx.cleanup(); }
  }
});

test("G-20 SG-5: the time and state parsers are total: an impossible or offset time, a malformed state file, is a refusal, never a crash", async () => {
  const bad = ["2026-13-01T00:00:00.000Z", "2026-02-30T00:00:00.000Z", "2026-10-28T24:00:00.000Z", "2026-10-28T23:59:60.000Z", "2026-10-28T14:00:00Z", "2026-10-28T14:00:00.000+00:00",
    "2026-10-28 14:00:00.000Z", "2026-10-28T14:00:00.000z", " 2026-10-28T14:00:00.000Z", "", null, undefined, 1730124000000, {}, [], "2026-10-28T14:00:00.0000Z"];
  for (const s of bad) assert.equal(G.utcMs(s), null, JSON.stringify(s));
  assert.equal(G.utcMs("2026-10-28T14:00:00.000Z"), T0);
  for (const s of ["2026-10-28T13:00:00.123456Z", "2026-02-30T13:00:00.1234567Z", "2026-10-28T13:00:00.1234567+00:00", null]) assert.equal(G.createdMs(s), null, JSON.stringify(s));
  assert.equal(G.createdMs(SHELL_CREATED), Date.parse("2026-10-28T13:00:00.123Z"));
  const fx = fixture({ workflows: WF() });
  try {
    fx.clock();
    const ap = fx.draft("t", "X");
    for (const s of bad.slice(0, 8)) {
      await refused(() => G.recordPhase({ paths: fx.paths, anchor: fx.anchor, manifest: M, workflows: { ...G.WORKFLOWS, ...fx.workflows }, workflow: "t", phase: "X", goText: `GO phase X approval ${ap}`, arrivedAt: s, deadline: "2026-10-28T14:45:00.000Z", head: HEAD, checkout: ROOT, now: fx.now() }), /must be UTC times/, `arrival ${s}`);
    }
    assert.equal(fx.calls.length, 0);
  } finally { fx.cleanup(); }
  // A go or marker file that is malformed, even with its ledger line, is damage: every send and go refuses.
  for (const [k, v] of [["deadline", "2026-13-01T00:00:00.000Z"], ["issuedAt", "2026-10-28T14:00:00Z"], ["goId", 7], ["request", null], ["cancel", {}], ["extra", 1], ["marker", null]]) {
    const { fx: f2, ph, W } = setupP();
    try {
      let goId = hex32();
      if (k === "marker") writeFileSync(join(f2.paths.markers, `${hex32()}.json`), '{"schema":"stage0-marker/1","until":"2026-02-30T00:00:00.000Z"}');
      else { const go = f2.forgeGo({ phase: ph, marker: W.marker, step: "A1", text: "P2-01", target: "production", over: { [k]: v } }); if (typeof go.goId === "string") goId = go.goId; }
      await refused(() => f2.send(G, { text: "P2-01", target: "production", win: W, goId }), /DAMAGED/, k);
      await refused(() => f2.issue(ph.phaseId, "A1"), /DAMAGED/, `${k}: issuance`);
      assert.equal(f2.calls.length, 0, k);
    } finally { f2.cleanup(); }
  }
});

// ── SG-6 ─────────────────────────────────────────────────────────────────────

/** A copy of the pinned chain in a scratch directory, as LF files; returns its root. */
function chainCopy() {
  const dir = mkdtempSync(join(tmpdir(), "s0-chain-"));
  for (const f of M.guard.files) {
    mkdirSync(join(dir, "scripts", "manual"), { recursive: true });
    writeFileSync(join(dir, f.path), readFileSync(join(ROOT, f.path), "utf8").replace(/\r\n/g, "\n"));
  }
  return dir;
}

test("G-21 SG-6: each entry's chain is pinned; an edit, a dropped pin, an unpinned helper and a package each refuse before any go, marker or request", async () => {
  assert.deepEqual(M.guard.entries, G.CHAIN_ENTRIES);
  for (const e of G.CHAIN_ENTRIES) G.selfCheck(M, ROOT, e);
  const dir = chainCopy();
  try {
    for (const e of G.CHAIN_ENTRIES) G.selfCheck(M, dir, e);
    const gpath = join(dir, "scripts", "manual", "stage0-guard.mjs");
    const orig = readFileSync(gpath, "utf8");
    writeFileSync(gpath, orig + "// an edit\n");
    for (const e of G.CHAIN_ENTRIES) assert.throws(() => G.selfCheck(M, dir, e), /stage0-guard\.mjs is [0-9a-f]{40}, but the manifest pins/, `an edit, ${e}`);
    writeFileSync(gpath, orig);
    const M2 = clone(M);
    M2.guard.files = M2.guard.files.filter((f) => f.path !== "scripts/manual/stage0-classify.mjs");
    assert.throws(() => G.selfCheck(M2, dir, S.SENDER_PATH), /stage0-classify\.mjs is loaded by scripts\/manual\/stage0-send\.mjs, but the manifest does not pin it/, "a dropped pin");
    const withHelper = orig.replace('import * as K from "./stage0-capture.mjs";\n', 'import * as K from "./stage0-capture.mjs";\nimport { x } from "./stage0-helper.mjs";\n');
    assert.notEqual(withHelper, orig);
    writeFileSync(gpath, withHelper);
    writeFileSync(join(dir, "scripts", "manual", "stage0-helper.mjs"), "export const x = 1;\n");
    const M3 = clone(M);
    M3.guard.files.find((f) => f.path === "scripts/manual/stage0-guard.mjs").blob = G.workingBlob("scripts/manual/stage0-guard.mjs", dir);
    assert.throws(() => G.selfCheck(M3, dir, S.SENDER_PATH), /stage0-helper\.mjs is loaded by scripts\/manual\/stage0-send\.mjs, but the manifest does not pin it/, "an unpinned helper, with the guard re-pinned");
    writeFileSync(gpath, orig.replace('import * as K from "./stage0-capture.mjs";\n', 'import * as K from "./stage0-capture.mjs";\nimport acorn from "acorn";\n'));
    M3.guard.files.find((f) => f.path === "scripts/manual/stage0-guard.mjs").blob = G.workingBlob("scripts/manual/stage0-guard.mjs", dir);
    assert.throws(() => G.selfCheck(M3, dir, S.SENDER_PATH), /loads "acorn", which is neither a repository file nor an allowed node: module/, "a package");
    writeFileSync(gpath, orig + "// an edit\n");
    const M4 = clone(M);
    M4.guard.entries = M4.guard.entries.filter((e) => e !== S.SENDER_PATH);
    assert.throws(() => G.selfCheck(M4, ROOT, S.SENDER_PATH), /does not name scripts\/manual\/stage0-send\.mjs as an entry/);
    assert.throws(() => G.selfCheck({ ...M, guard: undefined }, ROOT, S.SENDER_PATH), /pins no guard chain/);
    // Through each command line, against the edited copy: no request, no marker, no go.
    const { fx, ph, W } = setupP();
    try {
      const g1 = fx.issue(ph.phaseId, "A1");
      await refused(() => fx.main(["P2-01", "--target", "production", "--confirm-ref", PROD, "--go", g1.goId], W.env, { ppid: W.pid, root: dir }), /the pinned chain does not hold/, "the sender");
      assert.equal(fx.calls.length, 0);
      const markers = readdirSync(fx.paths.markers).length;
      await refused(() => WIN.main(["open", "--role", "R", "--phase", ph.phaseId], { [G.SESSION_ENV]: nonce(7001), [G.TOKEN_ENV]: TOKEN }, { root: dir, manifest: M, anchor: fx.anchor, stateDir: fx.stateDir, now: fx.now, identity: fx.identity, ppid: 1001, git: fx.git, execArgv: [], stdout: () => {} }), /the pinned chain does not hold/, "the window");
      assert.equal(readdirSync(fx.paths.markers).length, markers);
      fx.void(g1.goId);
      await refused(() => GO.main(["issue", "--phase", ph.phaseId, "--step", "A1"], {}, { root: dir, manifest: M, anchor: fx.anchor, stateDir: fx.stateDir, now: fx.now, identity: fx.identity, git: fx.git, execArgv: [], stdout: () => {}, workflows: fx.workflows }), /the pinned chain does not hold/, "the issuer");
      assert.equal(liveGos(fx).length, 0);
      // Closing a window needs no pin, head or clock check: it works against the edited copy.
      const closed = WIN.main(["close"], W.env, { root: dir, stateDir: fx.stateDir, stdout: () => {} });
      assert.deepEqual(closed.closed.markers, [W.marker.markerId]);
    } finally { fx.cleanup(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── Q4, Q7, the dry run ─────────────────────────────────────────────────────

test("G-22 Q4: tracked changes, node options, NODE_OPTIONS and a planted program refuse the sender, the issuer and the window; the issuer refuses a token or session in its environment", async () => {
  const { fx, ph, W } = setupP();
  try {
    const g1 = fx.issue(ph.phaseId, "A1");
    const dirty = () => ({ head: HEAD, dirty: ["M  scripts/manual/stage0-send.mjs", " D docs/x.md", "UU a.txt"] });
    await refused(() => fx.send(G, { text: "P2-01", target: "production", win: W, goId: g1.goId, over: { git: dirty } }), /tracked changes \(scripts\/manual\/stage0-send\.mjs, docs\/x\.md, a\.txt\)/);
    await refused(() => fx.send(G, { text: "P2-01", target: "production", win: W, goId: g1.goId, over: { git: () => ({ head: "abc", dirty: [] }) } }), /full HEAD commit/);
    await refused(() => fx.send(G, { text: "P2-01", target: "production", win: W, goId: g1.goId, over: { execArgv: ["--import", "x.mjs"] } }), /node was started with 2 option\(s\)/);
    await refused(() => fx.send(G, { text: "P2-01", target: "production", win: { ...W, env: { ...W.env, NODE_OPTIONS: "--require x.js" } }, goId: g1.goId }), /NODE_OPTIONS is set/);
    const goDeps = { manifest: M, anchor: fx.anchor, stateDir: fx.stateDir, now: fx.now, identity: fx.identity, execArgv: [], stdout: () => {}, workflows: fx.workflows };
    fx.void(g1.goId);
    await refused(() => GO.main(["issue", "--phase", ph.phaseId, "--step", "A1"], {}, { ...goDeps, git: dirty }), /tracked changes/);
    await refused(() => GO.main(["issue", "--phase", ph.phaseId, "--step", "A1"], { [G.TOKEN_ENV]: TOKEN }, { ...goDeps, git: fx.git }), /holds no token and no window session/);
    await refused(() => GO.main(["issue", "--phase", ph.phaseId, "--step", "A1"], { [G.SESSION_ENV]: nonce(1) }, { ...goDeps, git: fx.git }), /holds no token and no window session/);
    await refused(() => WIN.main(["open", "--role", "R", "--phase", ph.phaseId], { [G.SESSION_ENV]: nonce(7002), [G.TOKEN_ENV]: TOKEN }, { manifest: M, anchor: fx.anchor, stateDir: fx.stateDir, now: fx.now, identity: fx.identity, ppid: 1001, git: dirty, execArgv: [], stdout: () => {} }), /tracked changes/);
    assert.equal(fx.calls.length, 0);
    assert.equal(liveGos(fx).length, 0);
    const planted = mkdtempSync(join(tmpdir(), "s0-planted-"));
    try {
      writeFileSync(join(planted, "git.exe"), "");
      writeFileSync(join(planted, "powershell.com"), "");
      const p = G.plantedTools([planted]);
      assert.equal(p.length, 2);
      assert.match(p.join(" "), /git\.exe exists, and would run in place of the system program/);
      assert.deepEqual(G.plantedTools([ROOT]), [], "the checkout has none");
    } finally { rmSync(planted, { recursive: true, force: true }); }
  } finally { fx.cleanup(); }
});

test("G-23 Q7: no go is issued for a cancel text; a C window exists only to keep R and W from sending one", async () => {
  const fx = fixture({ workflows: { t: synthWorkflow("production", { K: [["K1", "CANCEL-INSPECT"]] }) } });
  try {
    fx.clock();
    const ph = fx.phase("t", "K");
    fx.window("C", ph.phaseId, { pid: 1001 });
    await refused(() => fx.issue(ph.phaseId, "K1"), /no reviewed phase sends a cancel: live cancellation is not approved/);
    assert.equal(liveGos(fx).length, 0);
  } finally { fx.cleanup(); }
});

test("G-24 the dry run needs no token, marker, go, clock, store or clean tree, and makes no request; a live send needs a well-formed --go", async () => {
  const fx = fixture({ init: false });
  try {
    let n = 0;
    const r = await S.main(["P2-0304", "--target", "production", "--dry-run"], {}, { manifest: M, stdout: () => {}, fetchImpl: () => { n++; }, stateDir: fx.stateDir, git: () => { throw new Error("no git"); } });
    assert.equal(r.dryRun, true);
    assert.equal(n, 0);
    assert.ok(!existsSync(fx.stateDir), "the dry run wrote no guard state");
    await assert.rejects(S.main(["P0", "--target", "production", "--dry-run", "--go", hex32()], {}, { manifest: M, stdout: () => {} }), /--dry-run takes no --go/);
    await refused(() => fx.main(["P0", "--target", "production", "--confirm-ref", PROD], { [G.TOKEN_ENV]: TOKEN }), /a live send needs --go/);
    await assert.rejects(fx.main(["P0", "--target", "production", "--confirm-ref", PROD, "--go", "abc"], { [G.TOKEN_ENV]: TOKEN }), /--go takes the 32-character go id/);
    await assert.rejects(fx.main(["P0", "--target", "production", "--confirm-ref", PROD, "--go"], { [G.TOKEN_ENV]: TOKEN }), /--go takes the 32-character go id/);
    assert.equal(fx.calls.length, 0);
  } finally { fx.cleanup(); }
});

// ── the incident ─────────────────────────────────────────────────────────────

test("G-25 the 2026-10-09 incident, replayed at its real times and windows: every departure is refused before any request", async () => {
  // P2-01 was cleared at 01:34:14Z with latest start 02:20Z; the go's deadline
  // is that latest start. Send 1 went from W at 15:17:05.343Z; send 2, P2-01
  // again, from R at 15:17:50.900Z, in place of STATE (incident record §2).
  const wf = { t: synthWorkflow("production", { P: [["P2-01", "P2-01"], ["STATE-1", "STATE"]] }) };
  const at = (s) => Date.parse(s);
  const setup = () => {
    const fx = fixture({ workflows: wf, t0: at("2026-10-09T01:33:00.000Z") });
    fx.clock();
    fx.set(at("2026-10-09T01:34:14.000Z"));
    const ph = fx.register("t", "P", { deadline: at("2026-10-09T02:20:00.000Z") }).phase;
    fx.add(30000);
    const R = fx.window("R", ph.phaseId, { pid: 4001 });
    const W = fx.window("W", ph.phaseId, { pid: 4002 });
    fx.add(30000);
    const go = fx.issue(ph.phaseId, "P2-01");
    assert.equal(go.deadline, "2026-10-09T02:19:00.000Z", "the latest start less the 60 s margin");
    return { fx, ph, R, W, go };
  };
  const cases = [
    ["send 1 as it happened: W, P2-01, 15:17:05.343Z", "2026-10-09T15:17:05.343Z", false, (s) => ["P2-01", s.W], /older than 60 min/],
    ["send 1 after a fresh clock check", "2026-10-09T15:17:05.343Z", true, (s) => ["P2-01", s.W], /ended at 2026-10-09T02:20:00\.000Z/],
    ["send 2: P2-01 from R at 15:17:50.900Z", "2026-10-09T15:17:50.900Z", true, (s) => ["P2-01", s.R], /ended at/],
    ["send 2's text from R while the window was still open", "2026-10-09T01:40:00.000Z", false, (s) => ["P2-01", s.R], /P2-01 is sent from a W window; this is an R window/],
  ];
  for (const [label, when, freshClock, who, re] of cases) {
    const s = setup();
    try {
      s.fx.set(at(when));
      if (freshClock) s.fx.clock();
      const [text, win] = who(s);
      await refused(() => s.fx.send(G, { text, target: "production", win, goId: s.go.goId }), re, label);
      assert.equal(s.fx.calls.length, 0, label);
    } finally { s.fx.cleanup(); }
  }
  {
    const s = setup();
    try {
      s.fx.set(at("2026-10-09T15:17:00.000Z"));
      s.fx.clock();
      await refused(() => s.fx.issue(s.ph.phaseId, "STATE-1"), /0 live R windows are open for this phase/, "nothing can be issued the next morning");
      s.fx.void(s.go.goId);
      await refused(() => s.fx.window("W", s.ph.phaseId, { pid: 4003 }), /deadline 2026-10-09T02:20:00\.000Z has passed/, "a reopened window cannot rejoin the phase");
    } finally { s.fx.cleanup(); }
  }
  const send2 = readFileSync(join(REAL, "2026-10-09T15-17-50-900Z_P2-01_production.json"), "utf8");
  assert.equal(C.classifyText(send2, ctx()).class, "R3", "rule 3′ still classifies the real send 2 receipt R3: the two layers stay separate");
});

// ── the mutation companion ──────────────────────────────────────────────────

const GUARD_SRC = readFileSync(join(ROOT, "scripts", "manual", "stage0-guard.mjs"), "utf8").replace(/\r\n/g, "\n");
async function mutant(edits, dir, n) {
  let s = GUARD_SRC;
  for (const m of ["assemble-stage0.mjs", "stage0-classify.mjs", "stage0-capture.mjs"]) s = s.split(`from "./${m}"`).join(`from ${JSON.stringify(pathToFileURL(join(ROOT, "scripts", "manual", m)).href)}`);
  for (const [from, to] of edits) {
    assert.equal(s.split(from).length, 2, `the mutant's target occurs exactly once: ${from.slice(0, 90)}`);
    s = s.split(from).join(to);
  }
  const p = join(dir, `mutant-${n}.mjs`);
  writeFileSync(p, s);
  return import(pathToFileURL(p).href);
}

/** A PENDING attempt in phase Y (its receipt cannot be written after the request); returns its attempt id. */
async function pendingInY(fx) {
  const Y = fx.phase("t", "Y");
  const RY = fx.window("R", Y.phaseId, { pid: 1003 });
  const gy = fx.issue(Y.phaseId, "Y1");
  const e = await fx.send(G, { text: "STATE", target: "production", win: RY, goId: gy.goId, over: { writeReceipt: () => { throw new Error("disk full"); } } }).catch((x) => x);
  assert.ok(e instanceof G.AfterDispatch, String(e));
  const h = holds(fx);
  assert.equal(h[0].kind, "PENDING");
  return h[0].attemptId;
}

/** Phase P with declared ceilings (A1 50 min, A2 20 min, A3 10 min before a 90-minute deadline), recorded at T0: A1's ceiling is T0 + 40 min. */
function setupCeil() {
  const workflows = { t: synthWorkflow("production", { P: [["A1", "P2-01"], ["A2", "STATE"], ["A3", "P2-02"]] }, { ceilings: { P: { A1: 50 * MIN, A2: 20 * MIN, A3: 10 * MIN } } }) };
  const fx = fixture({ workflows });
  fx.clock();
  const ph = fx.phase("t", "P", { minutes: 90 });
  return { fx, ph, c1: G.utcMs(ph.ceilings.A1) };
}

/** Each scenario sets up with the real guard and sends with `X`; it returns the result or the error and the request count. */
const SCENARIOS = {
  "a go whose deadline passes its step's ceiling": async (X) => {
    const { fx, ph, c1 } = setupCeil();
    const W = fx.window("W", ph.phaseId, { pid: 1002 });
    const go = forgeGo(fx, { phase: ph, marker: W.marker, step: "A1", text: "P2-01", target: "production", over: { deadline: G.iso(G.utcMs(ph.deadline) - G.MARGIN_MS) } });
    fx.set(c1 + MIN);
    fx.clock();
    return [fx, () => fx.send(X, { text: "P2-01", target: "production", win: W, goId: go.goId })];
  },
  "a go recording a stale ceiling": async (X) => {
    const { fx, ph, c1 } = setupCeil();
    const W = fx.window("W", ph.phaseId, { pid: 1002 });
    const go = forgeGo(fx, { phase: ph, marker: W.marker, step: "A1", text: "P2-01", target: "production", over: { ceiling: G.iso(c1 - 5 * MIN), deadline: G.iso(c1 - 5 * MIN) } });
    return [fx, () => fx.send(X, { text: "P2-01", target: "production", win: W, goId: go.goId })];
  },
  "a phase record with an altered ceiling": async (X) => {
    const { fx, ph } = setupCeil();
    const text = JSON.stringify({ ...ph, ceilings: { ...ph.ceilings, A2: G.iso(G.utcMs(ph.ceilings.A2) + 5 * MIN) } }, null, 2) + "\n";
    writeFileSync(join(fx.paths.phases, `${ph.phaseId}.json`), text);
    rechain(fx, (events) => { for (const e of events) if (e.kind === "phase" && e.phaseId === ph.phaseId) e.sha256 = G.sha256(Buffer.from(text, "utf8")); });
    const W = fx.window("W", ph.phaseId, { pid: 1002 });
    const go = forgeGo(fx, { phase: ph, marker: W.marker, step: "A1", text: "P2-01", target: "production" });
    return [fx, () => fx.send(X, { text: "P2-01", target: "production", win: W, goId: go.goId })];
  },
  "an R window sends a W text": async (X) => {
    const { fx, ph, R } = setupP();
    const go = forgeGo(fx, { phase: ph, marker: R.marker, step: "A1", text: "P2-01", target: "production" });
    return [fx, () => fx.send(X, { text: "P2-01", target: "production", win: R, goId: go.goId })];
  },
  "a child shell with the inherited environment": async (X) => {
    const { fx, ph, W } = setupP();
    const go = fx.issue(ph.phaseId, "A1");
    fx.shell(2001, { created: "2026-10-28T13:30:00.0000000Z" });
    return [fx, () => fx.send(X, { text: "P2-01", target: "production", win: { env: W.env, pid: 2001 }, goId: go.goId })];
  },
  "another token in the window": async (X) => {
    const { fx, ph, W } = setupP();
    const go = fx.issue(ph.phaseId, "A1");
    return [fx, () => fx.send(X, { text: "P2-01", target: "production", win: W, goId: go.goId, token: OTHER_TOKEN })];
  },
  "a go past its deadline": async (X) => {
    const { fx, ph, W } = setupP();
    const go = forgeGo(fx, { phase: ph, marker: W.marker, step: "A1", text: "P2-01", target: "production", over: { deadline: G.iso(fx.now() + MIN) } });
    fx.add(MIN + 1);
    return [fx, () => fx.send(X, { text: "P2-01", target: "production", win: W, goId: go.goId })];
  },
  "a pending attempt in another phase": async (X) => {
    const { fx, ph, W } = setupP();
    await pendingInY(fx);
    const go = forgeGo(fx, { phase: ph, marker: W.marker, step: "A1", text: "P2-01", target: "production" });
    return [fx, () => fx.send(X, { text: "P2-01", target: "production", win: W, goId: go.goId })];
  },
  "a pending attempt whose claim is lost": async (X) => {
    const { fx, ph, W } = setupP();
    const id = await pendingInY(fx);
    renameSync(join(fx.paths.journal(PROD), `${id}.claim.json`), join(fx.dir, "lost-claim.json"));
    const go = forgeGo(fx, { phase: ph, marker: W.marker, step: "A1", text: "P2-01", target: "production" });
    return [fx, () => fx.send(X, { text: "P2-01", target: "production", win: W, goId: go.goId })];
  },
  "a go for a step the gate does not name": async (X) => {
    const { fx, ph, W } = setupP();
    const go = forgeGo(fx, { phase: ph, marker: W.marker, step: "A3", text: "P2-02", target: "production" });
    return [fx, () => fx.send(X, { text: "P2-02", target: "production", win: W, goId: go.goId })];
  },
  "a used go whose step is still next": async (X) => {
    const { fx, ph, W } = setupP();
    const go = fx.issue(ph.phaseId, "A1");
    const D = G.utcMs(go.deadline);
    let k = 0;
    fx.set(D - 1);
    await fx.send(G, { text: "P2-01", target: "production", win: W, goId: go.goId, over: { now: () => (++k <= 2 ? D - 1 : D) } }).catch(() => {});
    fx.set(D - MIN);
    fx.clock();
    return [fx, () => fx.send(X, { text: "P2-01", target: "production", win: W, goId: go.goId })];
  },
  "another HEAD": async (X) => {
    const { fx, ph, W } = setupP();
    const go = fx.issue(ph.phaseId, "A1");
    return [fx, () => fx.send(X, { text: "P2-01", target: "production", win: W, goId: go.goId, over: { git: () => ({ head: "f".repeat(40), dirty: [] }) } })];
  },
  "tracked changes": async (X) => {
    const { fx, ph, W } = setupP();
    const go = fx.issue(ph.phaseId, "A1");
    return [fx, () => fx.send(X, { text: "P2-01", target: "production", win: W, goId: go.goId, over: { git: () => ({ head: HEAD, dirty: [" M x"] }) } })];
  },
  "a stale clock check": async (X) => {
    const fx = fixture({ workflows: WF() });
    fx.clock();
    fx.add(20 * MIN);
    const ph = fx.phase("t", "P");
    const W = fx.window("W", ph.phaseId, { pid: 1002 });
    const go = fx.issue(ph.phaseId, "A1");
    fx.add(41 * MIN);
    return [fx, () => fx.send(X, { text: "P2-01", target: "production", win: W, goId: go.goId })];
  },
  "a clock that went back": async (X) => {
    const { fx, ph, W } = setupP();
    const go = fx.issue(ph.phaseId, "A1");
    G.checkClock(fx.paths, fx.now() + 30000, fx.check());
    fx.add(10000);
    return [fx, () => fx.send(X, { text: "P2-01", target: "production", win: W, goId: go.goId })];
  },
  "a go issued in the future": async (X) => {
    const { fx, ph, W } = setupP();
    const go = forgeGo(fx, { phase: ph, marker: W.marker, step: "A1", text: "P2-01", target: "production", over: { issuedAt: G.iso(fx.now() + 1000) } });
    return [fx, () => fx.send(X, { text: "P2-01", target: "production", win: W, goId: go.goId })];
  },
  "NODE_OPTIONS": async (X) => {
    const { fx, ph, W } = setupP();
    const go = fx.issue(ph.phaseId, "A1");
    return [fx, () => fx.send(X, { text: "P2-01", target: "production", win: { ...W, env: { ...W.env, NODE_OPTIONS: "--require x.js" } }, goId: go.goId })];
  },
  "the deadline passing before fetch": async (X) => {
    const { fx, ph, W } = setupP();
    const go = fx.issue(ph.phaseId, "A1");
    const D = G.utcMs(go.deadline);
    let k = 0;
    fx.set(D - 1);
    return [fx, () => fx.send(X, { text: "P2-01", target: "production", win: W, goId: go.goId, over: { now: () => (++k <= 2 ? D - 1 : D) } })];
  },
};

/** The named checks, each removed by exact edits of stage0-guard.mjs, with the scenario that only it refuses. */
const GUARD_MUTANTS = [
  ["the role check", "an R window sends a W text", [["  if (role !== marker.role) throw new Refusal(`${plan.name} is sent from ${an(role)} window; this is ${an(marker.role)} window; refusing`);\n", ""]]],
  ["the shell binding", "a child shell with the inherited environment", [["  if (!sameShell(shell, marker.shell)) throw", "  if (false) throw"]]],
  ["the token binding", "another token in the window", [["  if (tokenTagOf(nonce, token) !== marker.tokenTag) throw", "  if (false) throw"]]],
  ["the go's deadline", "a go past its deadline", [
    ["  if (!(t0 < dl)) throw", "  if (false) throw"],
    ["    if (!(t1 < dl && t1 < until)) throw", "    if (!(t1 < until)) throw"],
    ["    if (!(t < dl)) why =", "    if (false) why ="],
  ]],
  ["the project hold in the sender", "a pending attempt in another phase", [["    if (holds.length) throw new Refusal(`${heldMessage(holds)}; refusing`);\n", ""]]],
  ["the store check in the sender (I6-R1)", "a pending attempt whose claim is lost", [
    ["  const chk0 = requireStore({ paths, anchor, manifest });", "  const chk0 = storeCheck({ paths, anchor, manifest });"],
    ["    const chk = requireStore({ paths, anchor, manifest });\n    const entries = readJournal(paths, plan.ref);", "    const chk = storeCheck({ paths, anchor, manifest });\n    const entries = readJournal(paths, plan.ref);"],
    ["  const recordOutcome = (value, t, waitMs) => withLock(paths, () => {\n    const chk = requireStore({ paths, anchor, manifest });", "  const recordOutcome = (value, t, waitMs) => withLock(paths, () => {\n    const chk = storeCheck({ paths, anchor, manifest });"],
  ]],
  ["the gate in the sender", "a go for a step the gate does not name", [["    if (gate.stop || gate.next !== go.step) throw", "    if (false) throw"]]],
  ["single use", "a used go whose step is still next", [
    ["  const live = join(paths.gos, `${goId}.json`);\n  if (!existsSync(live)) {", "  const live = existsSync(join(paths.gos, `${goId}.json`)) ? join(paths.gos, `${goId}.json`) : join(paths.used, `${goId}.json`);\n  if (!existsSync(live)) {"],
    ["    if (!g || g.state !== \"live\") throw new Refusal(`go ${goId} was used by another command; refusing`);\n", ""],
    ["      moveStep(join(paths.gos, `${goId}.json`), join(paths.used, `${goId}.json`)),\n      fileStep(join(paths.journal(plan.ref)", "      fileStep(join(paths.journal(plan.ref)"],
    // the second claim of one go is itself damage, so the outcome is recorded without the check
    ["  const recordOutcome = (value, t, waitMs) => withLock(paths, () => {\n    const chk = requireStore({ paths, anchor, manifest });", "  const recordOutcome = (value, t, waitMs) => withLock(paths, () => {\n    const chk = storeCheck({ paths, anchor, manifest });"],
  ]],
  ["the HEAD binding", "another HEAD", [["  const head = checkoutHead(git, root);\n  const chk0 = requireStore(", "  checkoutHead(git, root);\n  const head = readMarkers(paths).find((e) => e.marker).marker.head;\n  const chk0 = requireStore("]]],
  ["clean tracked files", "tracked changes", [["  if (s.dirty.length) throw", "  if (false) throw"]]],
  ["the clock check's freshness", "a stale clock check", [["  if (now - at >= CLOCK.freshMs) throw", "  if (false) throw"]]],
  ["the backward-clock check", "a clock that went back", [["  if (now < h.ms - CLOCK.backstepMs) throw", "  if (false) throw"]]],
  ["the issue time", "a go issued in the future", [["created <= issued && issued <= t0))", "created <= issued))"]]],
  ["NODE_OPTIONS", "NODE_OPTIONS", [["  if (typeof env.NODE_OPTIONS === \"string\" && env.NODE_OPTIONS.trim()) out.push", "  if (false) out.push"]]],
  ["the pre-fetch check", "the deadline passing before fetch", [["  const admit = () => {\n", "  const admit = () => {\n    return;\n"]]],
  ["the step's ceiling in the sender", "a go whose deadline passes its step's ceiling", [["  if (!(dl <= ceiling)) throw", "  if (false) throw"]]],
  ["the go's recorded ceiling", "a go recording a stale ceiling", [["  if (go.ceiling !== iso(ceiling)) throw", "  if (false) throw"]]],
  ["the phase's recorded ceilings (ceilingOf)", "a phase record with an altered ceiling", [["  for (const [s, ms] of Object.entries(want)) if (phase.ceilings[s] !== iso(ms)) throw", "  for (const [s, ms] of Object.entries(want)) if (false) throw"]]],
];

test("G-26 the mutation companion: each named check, removed, admits exactly one request in the scenario where the original allows none", async () => {
  const dir = mkdtempSync(join(tmpdir(), "s0-guard-mutants-"));
  try {
    for (const [n, [name, scenario, edits]] of GUARD_MUTANTS.entries()) {
      const [fx0, run0] = await SCENARIOS[scenario](G);
      try {
        const before = fx0.calls.length;
        await refused(run0, null, `${name}: the original refuses "${scenario}"`);
        assert.equal(fx0.calls.length, before, `${name}: no request under the original`);
      } finally { fx0.cleanup(); }
      const X = await mutant(edits, dir, n);
      const [fx1, run1] = await SCENARIOS[scenario](X);
      try {
        // Exactly one request and a recorded result: a tooling error under
        // the mutant is not evidence of a permissive check (Codex, SG-6).
        const before = fx1.calls.length;
        const r = await run1().catch((e) => { throw new Error(`${name}: the mutant must admit "${scenario}"; it threw ${e && e.constructor.name}: ${e && e.message}`); });
        assert.ok(r && r.record, `${name}: a recorded send`);
        assert.equal(fx1.calls.length, before + 1, `${name}: exactly one request under the mutant`);
      } finally { fx1.cleanup(); }
      assert.ok(X);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
