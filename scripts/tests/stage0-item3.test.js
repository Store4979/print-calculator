// scripts/tests/stage0-item3.test.js — item 3's gate, texts and holds
// (docs/security/stage0-item3-runbook.md; Codex's item 3 plan review, I3-1 to
// I3-3). Every send goes to the fixture's counting fetch stub: nothing reaches
// staging. "Refused" means a Refusal with ZERO further requests.
//
//   I3-1  the declarations: the texts, their policy and effect, the ceilings,
//         X's required review, and the classifier's effect rule
//   I3-2  checkStep: every declared outcome MATCHes; anything else STOPs; a
//         201 at a read_only control STOPs
//   I3-3  the fixture contract and the readback rules (nextStep)
//   I3-4  E and X end to end through the guarded tools, on both branches
//   I3-5  I3-1: an unresolved read_only write probe holds the project in
//         every failure mode, across a fresh window, phase X and another
//         checkout
//   I3-6  R-R1: at run time, a missing effect on any item 3 write text, or
//         on a new text with readOnly true, is unknown and holds; only the
//         29 legacy texts, under their exact pin and policy, keep the
//         read_only-derived effect
//   I3-7  R-R3: the separate-credential read is permitted only after a
//         terminal outcome with nothing held; its query is the runbook's,
//         byte for byte; its rows are compared with E17
// The mutation companion is stage0-item3.mutation.test.js.
import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, readFileSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as G from "../manual/stage0-guard.mjs";
import * as C from "../manual/stage0-classify.mjs";
import * as I from "../manual/stage0-item3.mjs";
import * as A from "../manual/assemble-stage0.mjs";
import * as GO from "../manual/stage0-go.mjs";
import { fixture, M, ctx, ROOT, T0 } from "./stage0-guard-fixture.mjs";
import { I3_POLICY, LEGACY_EFFECT_TEXTS } from "./stage0-manifest-check.mjs";
import { STAGING, receiptFor, BASE, row, readback, FIXTURE, WHO, R, REF, answers, check, eResults, finalValues, corroborationRows, failedEntry, ctxWith } from "./stage0-item3-fixture.mjs";

const MIN = 60000;
const clone = (x) => JSON.parse(JSON.stringify(x));

async function refused(fn, re, label = "") {
  let err = null;
  try { await fn(); } catch (e) { err = e; }
  assert.ok(err, `${label}: expected a refusal`);
  assert.ok(err instanceof G.Refusal, `${label}: expected a Refusal, got ${err && err.constructor.name}: ${err && err.message}`);
  if (re) assert.match(err.message, re, label);
  return err;
}


// ── I3-1 ─────────────────────────────────────────────────────────────────────

test("I3-1 the declarations: every step's text has its staging policy and effect; every phase declares its ceilings; X needs a reviewed disposition; effect, never read_only, decides writing", () => {
  assert.deepEqual(Object.keys(A.item3Texts()).sort(), Object.keys(I3_POLICY).sort());
  for (const [name, p] of Object.entries(I3_POLICY)) {
    assert.deepEqual(M.send.texts[name], { targets: ["staging"], readOnly: p.readOnly, window: p.window, effect: p.effect }, name);
    assert.equal(C.effectWriting(M, name), p.effect === "write", `${name}: writing follows the effect`);
  }
  for (const [id, s] of Object.entries(I.STEPS)) assert.ok(Object.hasOwn(I3_POLICY, s.text), `${id} sends ${s.text}`);
  const wf = G.WORKFLOWS.item3;
  assert.equal(wf.target, "staging");
  assert.deepEqual(Object.keys(wf.phases), ["E", "X"]);
  for (const ph of ["E", "X"]) assert.deepEqual(G.ceilingReserve(wf, ph), I.PHASES[ph].ceilings, `${ph}'s ceilings are declared`);
  assert.equal(I.PHASES.E.ceilings.E1, 61 * MIN);
  assert.equal(I.PHASES.E.ceilings.E17, 13 * MIN);
  assert.match(wf.phases.X.requires, /reviewed disposition of phase E/);
  // The classifier's effect rule (I3-1; R-R1 is I3-6).
  const policyAs = (name, policy) => ({ ...M, send: { ...M.send, texts: { ...M.send.texts, [name]: policy } } });
  assert.equal(C.effectWriting(policyAs("I3-ABSENT", { ...M.send.texts["I3-ABSENT"], effect: "write" }), "I3-ABSENT"), true, "a read_only text declared write is writing");
  assert.equal(C.effectWriting(policyAs("I3-READBACK", { ...M.send.texts["I3-READBACK"], effect: "read" }), "I3-READBACK"), false);
  assert.equal(C.effectWriting(policyAs("I3-ABSENT", { ...M.send.texts["I3-ABSENT"], effect: "maybe" }), "I3-ABSENT"), null, "an invalid effect is unknown, so treated as writing");
  assert.equal(C.effectWriting(M, "P0"), false, "a text before item 3, under its pin and policy, keeps its read_only-derived effect");
  assert.equal(C.effectWriting(M, "P1"), true);
  assert.equal(C.effectWriting(M, "NO-SUCH-TEXT"), null);
  // Codex's reproduction (plannedReadOnlyWriteProbe): a read_only INSERT whose request failed in transport.
  const c = C.classifyText(receiptFor("I3-INS-OWNED-R-RO", null, null, { error: "TypeError: fetch failed" }), ctx());
  assert.equal(c.class, "R1");
  assert.equal(c.writing, true, "the request mode under test never makes it non-writing");
});

// ── I3-2 ─────────────────────────────────────────────────────────────────────

test("I3-2 checkStep: each declared outcome MATCHes (with WROTE or REFUSED for the measured steps); an undeclared refusal, another status or body, or a 201 at a read_only control STOPs", () => {
  for (const branch of [[], ["E14", "E15", "E16"]]) {
    const a = answers(branch);
    for (const id of Object.keys(I.STEPS)) {
      const r = check(id, a[id]);
      assert.equal(r.verdict, "MATCH", `${id} on ${JSON.stringify(branch)}: ${r.reasons.join("; ")}`);
      if (I.STEPS[id].measure) assert.equal(r.outcome, branch.includes(id) ? "WROTE" : "REFUSED", id);
    }
  }
  assert.equal(check("E8", REF(R.ownedDenied)).verdict, "MATCH", "E8 may also be refused on owned's privilege");
  assert.equal(check("E15", REF(R.insertReadOnly)).outcome, "REFUSED");
  const stops = [
    ["E8", [201, '[{"id":1,"label":"I3-INS-OWNED-W-RO"}]'], /read_only did not stop this write/],
    ["E9", [201, '[{"id":2,"label":"I3-INS-OWNED-R-RO"}]'], /read_only did not stop this write/],
    ["E10", [201, '[{"id":3,"label":"I3-INS-OPEN-R-RO"}]'], /read_only did not stop this write/],
    ["E10", REF(R.ownedDenied), /not a declared outcome/],
    ["E10", REF({ code: "42501", message: "permission denied for table open" }), /not a declared outcome/],
    ["E14", REF({ code: "42501", message: "permission denied for table open" }), /not a declared outcome/],
    ["E16", REF({ code: "42501", message: "permission denied for schema stage0_item3" }), /not a declared outcome/],
    ["E16", [403, '{"message":"Forbidden resource"}'], /not a declared outcome/],
    ["E14", [401, '{"message":"Unauthorized"}'], /not a declared outcome/],
    ["E9", [400, JSON.stringify({ message: `${C.ENVELOPE_PREFIX}ERROR:  25006: cannot execute INSERT in a read-only transaction\nCONTEXT:  x\n` })], /not a declared outcome/],
    ["E11", [201, "[]"], /not I3-INS-OWNED-W-DEF's declared success/],
    ["E2", [201, FIXTURE({ policies: 1 })], /the fixture is not the declared one/],
    ["E4", [201, '[{"login_role":"x"}]'], /not I3-WHO-R-RO's declared success/],
  ];
  for (const [id, a, re] of stops) {
    const r = check(id, a);
    assert.equal(r.verdict, "STOP", `${id} ${a[1].slice(0, 60)}`);
    assert.match(r.reasons.join("; "), re, id);
  }
  // A receipt for another text, or one that does not bind (R1), STOPs.
  assert.equal(I.checkStep("E9", receiptFor("I3-INS-OPEN-R-RO", ...REF(R.insertReadOnly)), ctx()).verdict, "STOP");
  assert.equal(I.checkStep("E9", "{not json", ctx()).verdict, "STOP");
});

// ── I3-3 ─────────────────────────────────────────────────────────────────────

test("I3-3 the fixture contract (I3-2) and the readback rules: a grant, a policy, a trigger, row security or an object the contract does not allow stops; each readback must show exactly what the outcomes before it call for; E ends in COMPLETE-REFUSED or, after a WROTE, the distinct COMPLETE-WROTE", () => {
  const fx = (over) => I.fixtureProblems(JSON.parse(FIXTURE(over))[0]);
  assert.deepEqual(fx(), []);
  const tables = JSON.parse(FIXTURE())[0].tables;
  const withAcl = (name, acl) => tables.map((t) => (t.name === name ? { ...t, acl } : t));
  for (const [label, over, re] of [
    ["owned granted to another role", { tables: withAcl("owned", "{postgres=arwdDxtm/postgres,supabase_read_only_user=a/postgres}") }, /owned grants a to supabase_read_only_user/],
    ["owned granted to PUBLIC", { tables: withAcl("owned", "{postgres=arwdDxtm/postgres,=r/postgres}") }, /owned grants r to PUBLIC/],
    ["open granted more than ar", { tables: withAcl("open", "{postgres=arwdDxtm/postgres,=arw/postgres}") }, /open grants arw to PUBLIC/],
    ["open not granted to PUBLIC", { tables: withAcl("open", "{postgres=arwdDxtm/postgres}") }, /open does not grant ar to PUBLIC/],
    ["the schema without CREATE for PUBLIC", { schema_acl: "{postgres=UC/postgres,=U/postgres}" }, /the schema grants U to PUBLIC/],
    ["an unparseable ACL", { tables: withAcl("owned", "postgres=arwdDxtm/postgres") }, /owned's ACL does not parse/],
    ["row security", { tables: tables.map((t) => ({ ...t, rls: true })) }, /has row security on/],
    ["a trigger", { triggers: 1 }, /triggers 1/],
    ["another object", { objects: [...BASE.map(([name, kind]) => ({ name, kind })), { name: "v", kind: "v" }] }, /other objects/],
    ["another owner", { tables: tables.map((t) => ({ ...t, owner: "someone" })) }, /not the schema's owner/],
  ]) assert.match(fx(over).join("; "), re, label);

  const run = (results) => I.nextStep("E", results);
  const all = (branch, over = {}) => eResults(branch, over);
  const refusedEnd = run(all([]));
  assert.deepEqual([refusedEnd.stop, refusedEnd.next, refusedEnd.terminal], [false, null, { outcome: "COMPLETE-REFUSED", wrote: [], corroborate: true, disposition: "Ryan or Codex" }], "all refused: E's terminal outcome");
  const wrote = run(all(["E15"]));
  assert.deepEqual([wrote.stop, wrote.next, wrote.terminal], [false, null, { outcome: "COMPLETE-WROTE", wrote: ["E15"], corroborate: true, disposition: "Codex" }], "a WROTE: the distinct terminal outcome, not a STOP");
  assert.match(wrote.reason, /the Read PAT WROTE at E15 \(I3-INS-OWNED-R-DEF\): STOP-and-review before any cleanup/);
  const x = I.nextStep("X", [check("X1", answers().X1), check("X2", answers().X2)]);
  assert.deepEqual([x.stop, x.next, x.terminal], [false, null, { outcome: "COMPLETE", corroborate: false }], "X's end permits no read");
  for (const [label, branch, over, re] of [
    ["E3 with a row", [], { E3: [201, readback({ owned: [row(4, "I3-INS-OWNED-W-DEF")] })] }, /E3's readback does not match/],
    ["E13 without the control row", [], { E13: [201, readback({ ddl: ["ddl_w"] })] }, /E13's readback does not match.*owned holds rows \[\]/],
    ["E13 without ddl_w", [], { E13: [201, readback({ owned: [row(4, "I3-INS-OWNED-W-DEF")] })] }, /E13's readback does not match.*objects/],
    ["E17 with a row no outcome explains", [], { E17: [201, readback({ owned: [row(4, "I3-INS-OWNED-W-DEF")], open: [row(5, "I3-INS-OPEN-R-DEF")], ddl: ["ddl_w"] })] }, /E17's readback does not match.*open holds rows \[5\]/],
    ["E17 missing a WROTE row", ["E14"], { E17: [201, readback({ owned: [row(4, "I3-INS-OWNED-W-DEF")], ddl: ["ddl_w"] })] }, /E17's readback does not match.*open holds rows \[\]/],
    ["E17 with ddl_r after a REFUSED E16", [], { E17: [201, readback({ owned: [row(4, "I3-INS-OWNED-W-DEF")], ddl: ["ddl_w", "ddl_r"] })] }, /E17's readback does not match.*objects/],
  ]) {
    const r = run(all(branch, over));
    assert.equal(r.stop, true, label);
    assert.match(r.reason, re, label);
  }
  // Partial results name the next step; a non-MATCH stops at once.
  assert.deepEqual(run(all([]).slice(0, 7)), { stop: false, next: "E8" });
  const bad = all([]).slice(0, 9);
  bad[8] = check("E9", [201, '[{"id":2,"label":"I3-INS-OWNED-R-RO"}]']);
  assert.match(run(bad).reason, /E9 was STOP: HTTP 201: read_only did not stop this write/);
});

// ── I3-4 and I3-5: through the guarded tools ────────────────────────────────

/** A fixture with phase E registered (a 120-minute deadline) and an R (1001) and a W (1002) window. */
function setupE() {
  const fx = fixture();
  fx.clock();
  const ph = fx.phase("item3", "E", { minutes: 120 });
  const win = { R: fx.window("R", ph.phaseId, { pid: 1001 }), W: fx.window("W", ph.phaseId, { pid: 1002 }) };
  return { fx, ph, win };
}
const winOf = (text) => M.send.texts[text].window;

/** Issue and send one step through the guard, answering with `a` ([status, body]) or `over`. */
async function step(s, id, a, over = {}) {
  const text = I.STEPS[id].text;
  s.fx.add(1000); // each receipt is named by its start time; the readback is sent three times
  const go = s.fx.issue(s.ph.phaseId, id);
  return s.fx.send(G, { text, target: "staging", win: s.win[winOf(text)], goId: go.goId, over: { fetchImpl: s.fx.fetchImpl(() => new Response(a[1], { status: a[0] })), ...over } });
}

test("I3-4 E and X end to end through the guarded tools: E ends COMPLETE-REFUSED, or COMPLETE-WROTE after a WROTE; either permits the one read, whose rows `corroborate` compares with E17; X needs a named review file and then cleans up", async () => {
  for (const branch of [[], ["E14", "E16"]]) {
    const s = setupE();
    try {
      const a = answers(branch);
      for (const id of I.PHASES.E.steps) await step(s, id, a[id]);
      assert.equal(s.fx.calls.length, 17, "one request per step");
      assert.deepEqual(s.fx.status(STAGING).holds, [], "nothing held: every outcome is resolved");
      const gate = G.guardedProgress({ phase: s.ph, entries: G.readJournal(s.fx.paths, STAGING), ctxAt: s.fx.ctxAt, now: s.fx.now() });
      assert.deepEqual([gate.stop, gate.complete, gate.terminal.outcome], [false, true, branch.length ? "COMPLETE-WROTE" : "COMPLETE-REFUSED"], gate.reason);
      if (branch.length) assert.match(gate.reason, /the Read PAT WROTE at E14, E16/);
      await refused(() => s.fx.issue(s.ph.phaseId, "E17"), /the gate does not name E17/, "nothing more in E");
      // The one separate-credential read: `gate` permits it and prints the
      // exact query; `corroborate` compares its rows with E17.
      const out = [];
      const deps = { manifest: M, anchor: s.fx.anchor, stateDir: s.fx.stateDir, now: s.fx.now, execArgv: [], stdout: (x) => out.push(x), ctxAt: s.fx.ctxAt };
      const g = GO.main(["gate", "--phase", s.ph.phaseId], {}, deps).gate;
      assert.deepEqual([g.corroborate, g.query, g.holds], [true, I.CORROBORATION_SQL, []]);
      const rowsFile = join(s.fx.dir, "corroboration-rows.json");
      writeFileSync(rowsFile, JSON.stringify(corroborationRows(finalValues(branch))));
      const agree = GO.main(["corroborate", "--phase", s.ph.phaseId, "--rows", rowsFile], {}, deps);
      assert.deepEqual([agree.exit, agree.corroboration.problems], [0, []]);
      writeFileSync(rowsFile, JSON.stringify(corroborationRows(finalValues(branch)).slice(1)));
      const disagree = GO.main(["corroborate", "--phase", s.ph.phaseId, "--rows", rowsFile], {}, deps);
      assert.equal(disagree.exit, 3, "a missing object is a disagreement");
      assert.match(out.join(""), /AGREE[\s\S]*DISAGREE with E17: STOP, with no cleanup/);
      // X: a review file is required to register.
      await refused(() => s.fx.register("item3", "X", { minutes: 60 }), /phase X needs a reviewed disposition of phase E/);
      const review = join(s.fx.dir, "e-disposition.md");
      writeFileSync(review, `Phase E ${s.ph.phaseId}: reviewed.`);
      const x = s.fx.phase("item3", "X", { minutes: 60, reviewed: { path: review, sha256: G.sha256(readFileSync(review)) } });
      assert.equal(x.reviewed.sha256, G.sha256(readFileSync(review)));
      const winX = { R: s.fx.window("R", x.phaseId, { pid: 2001 }), W: s.fx.window("W", x.phaseId, { pid: 2002 }) };
      for (const id of I.PHASES.X.steps) {
        const text = I.STEPS[id].text;
        s.fx.add(1000);
        const go = s.fx.issue(x.phaseId, id);
        await s.fx.send(G, { text, target: "staging", win: winX[winOf(text)], goId: go.goId, over: { fetchImpl: s.fx.fetchImpl(() => new Response(a[id][1], { status: a[id][0] })) } });
      }
      assert.equal(G.guardedProgress({ phase: x, entries: G.readJournal(s.fx.paths, STAGING), ctxAt: s.fx.ctxAt, now: s.fx.now() }).complete, true);
      assert.equal(s.fx.calls.length, 19);
    } finally { s.fx.cleanup(); }
  }
});

test("I3-5 I3-1: every read_only write probe (E8, E9, E10), and each measured write, holds the project when its outcome is unresolved, in every failure mode, across a fresh window, phase X and another checkout", async () => {
  const modes = {
    "a transport failure": { fetchImpl: async () => { throw new TypeError("fetch failed"); } },
    "an incomplete body": { fetchImpl: async () => new Response('[{"id":2,"lab', { status: 201 }) },
    "a 401": { fetchImpl: async () => new Response('{"message":"Unauthorized"}', { status: 401 }) },
    "a 403": { fetchImpl: async () => new Response('{"message":"Forbidden resource"}', { status: 403 }) },
    "an unsupported 400 body": { fetchImpl: async () => new Response("<html>Bad Gateway</html>", { status: 400 }) },
    "an unbound receipt (it could not be written)": { writeReceipt: () => { throw new Error("synthetic receipt-disk failure"); } },
  };
  const cases = [...["E8", "E9", "E10"].flatMap((id) => Object.keys(modes).map((m) => [id, m])), ["E14", "a transport failure"], ["E15", "a 403"], ["E16", "an incomplete body"]];
  for (const [id, mode] of cases) {
    const s = setupE();
    try {
      const a = answers();
      const upTo = I.PHASES.E.steps.indexOf(id);
      for (const prior of I.PHASES.E.steps.slice(0, upTo)) await step(s, prior, a[prior]);
      const before = s.fx.calls.length;
      const over = { ...modes[mode] };
      if (over.fetchImpl) { const f = over.fetchImpl; over.fetchImpl = async (...x) => { s.fx.calls.push(x); return f(...x); }; }
      await step(s, id, a[id], over).catch(() => {});
      const label = `${id}, ${mode}`;
      assert.equal(s.fx.calls.length, before + 1, `${label}: one request`);
      const h = s.fx.status(STAGING).holds;
      assert.equal(h.length, 1, `${label}: held`);
      // The next step, fresh windows, phase X and another checkout: no go, no request.
      const next = I.PHASES.E.steps[upTo + 1];
      await refused(() => s.fx.issue(s.ph.phaseId, next), /the project is held/, `${label}: the next step`);
      for (const w of [s.win.R, s.win.W]) G.closeSession({ paths: s.fx.paths, env: w.env, now: s.fx.now() });
      s.fx.window("R", s.ph.phaseId, { pid: 3001 });
      s.fx.window("W", s.ph.phaseId, { pid: 3002 });
      await refused(() => s.fx.issue(s.ph.phaseId, next), /the project is held/, `${label}: after fresh windows`);
      const review = join(s.fx.dir, "e.md");
      writeFileSync(review, "a disposition of E that does not name the held attempt");
      const x = s.fx.phase("item3", "X", { minutes: 60, reviewed: { path: review, sha256: G.sha256(readFileSync(review)) } });
      s.fx.window("W", x.phaseId, { pid: 3003 });
      await refused(() => s.fx.issue(x.phaseId, "X1"), /the project is held/, `${label}: phase X`);
      // Another checkout of the same commit reads the same store, and sees the hold.
      const other = mkdtempSync(join(tmpdir(), "s0-i3-checkout-"));
      try {
        mkdirSync(join(other, "scripts", "manual"), { recursive: true });
        for (const f of M.guard.files) writeFileSync(join(other, f.path), readFileSync(join(ROOT, f.path), "utf8").replace(/\r\n/g, "\n"));
        const r = GO.main(["status", "--target", "staging"], {}, { root: other, manifest: M, anchor: s.fx.anchor, stateDir: s.fx.stateDir, now: s.fx.now, execArgv: [], stdout: () => {}, ctxAt: s.fx.ctxAt });
        assert.equal(r.exit, 3, `${label}: another checkout's status`);
        assert.equal(r.status.holds.length, 1, `${label}: another checkout sees the hold`);
      } finally { rmSync(other, { recursive: true, force: true }); }
      assert.equal(s.fx.calls.length, before + 1, `${label}: no further request`);
    } finally { s.fx.cleanup(); }
  }
});

// ── I3-6 R-R1 ────────────────────────────────────────────────────────────────

test("I3-6 R-R1: at run time a missing effect on each item 3 write text, or on a new text with readOnly true, is unknown and holds; only the 29 texts before item 3, under their exact pin and policy, keep the read_only-derived effect", () => {
  // [class, writing, holds] for a transport-failed send of `text` under `manifest`.
  const verdict = (text, manifest, target = "staging", aliases = {}) => {
    const { bytes, entry, readReceipt } = failedEntry(text, manifest, target);
    const c = ctxWith(manifest, aliases);
    const cl = C.classifyText(bytes.toString("utf8"), c);
    return [cl.class, cl.writing, G.holdsOf([entry], { ctxAt: () => c, readReceipt }).length];
  };
  const writes = Object.keys(I3_POLICY).filter((k) => I3_POLICY[k].effect === "write");
  assert.equal(writes.length, 10);
  for (const k of writes) {
    assert.deepEqual(verdict(k, M), ["R1", true, 1], `${k}, as declared`);
    const missing = clone(M);
    delete missing.send.texts[k].effect;
    assert.deepEqual(verdict(k, missing), ["R1", null, 1], `${k} without its effect: unknown, so held`);
    const invalid = clone(M);
    invalid.send.texts[k].effect = "maybe";
    assert.deepEqual(verdict(k, invalid), ["R1", null, 1], `${k} with an invalid effect`);
  }
  // A new identity, read_only, with no effect: unknown, so held.
  const NEW = "I3-NEW-PROBE";
  const m = clone(M);
  m.outputs[NEW] = clone(M.outputs["I3-INS-OWNED-R-RO"]);
  m.send.texts[NEW] = { targets: ["staging"], readOnly: true, window: "R" };
  assert.deepEqual(verdict(NEW, m, "staging", { [NEW]: "I3-INS-OWNED-R-RO" }), ["R1", null, 1], "a new text with readOnly true and no effect");
  // The legacy controls: each of the 29, under its pin and policy, keeps its old effect.
  for (const k of LEGACY_EFFECT_TEXTS) assert.equal(C.effectWriting(M, k), M.send.texts[k].readOnly !== true, k);
  assert.deepEqual(verdict("P0", M, "production"), ["R1", false, 0], "P0 (read_only) under its pin and policy: not writing, as before");
  assert.deepEqual(verdict("ENVELOPE-PROBE-1", M), ["R1", false, 0]);
  assert.deepEqual(verdict("RB-1", M, "production"), ["R1", true, 1]);
  // A legacy text whose policy or pin is not the listed one keeps nothing.
  const moved = clone(M);
  moved.send.texts.P0.window = "W";
  assert.deepEqual(verdict("P0", moved, "production"), ["R1", null, 1], "P0 under another policy");
  const repinned = clone(M);
  repinned.outputs.P0 = { ...repinned.outputs.P0, md5: "0".repeat(32) };
  assert.deepEqual(verdict("P0", repinned, "production"), ["R1", null, 1], "P0 under another pin");
});

// ── I3-7 R-R3 ────────────────────────────────────────────────────────────────

test("I3-7 R-R3: the separate-credential read's query is the runbook's, byte for byte, with relkind cast; its rows are compared with E17; it is permitted only after a terminal outcome with nothing held, never after a STOP, a failed control, an unsupported outcome, an inconsistent readback, a hold, a partial phase or the deadline", async () => {
  const runbook = readFileSync(join(ROOT, "docs", "security", "stage0-item3-runbook.md"), "utf8").replace(/\r\n/g, "\n");
  const block = /## 6\.[\s\S]*?\n( *)```sql\n([\s\S]*?)\n *```/.exec(runbook);
  assert.ok(block, "runbook §6 holds one sql block");
  assert.equal(block[2].split("\n").map((l) => l.slice(block[1].length)).join("\n"), I.CORROBORATION_SQL);
  assert.equal(G.WORKFLOWS.item3.corroboration.sql, I.CORROBORATION_SQL);
  assert.equal(G.WORKFLOWS.item3.corroboration.step, "E17");
  assert.match(I.CORROBORATION_SQL, /c\.relname \|\| ':' \|\| c\.relkind::text,/);

  // The comparison.
  for (const branch of [[], ["E14", "E15", "E16"]]) {
    const v = finalValues(branch);
    assert.deepEqual(I.corroborationProblems(corroborationRows(v), v), [], JSON.stringify(branch));
  }
  const v = finalValues(["E14", "E16"]);
  const rows = corroborationRows(v);
  for (const [label, r, re] of [
    ["a missing row", rows.filter((x) => x.t !== "open"), /^open: the read has \[\]/],
    ["an extra row", [...rows, { t: "owned", id: 7, label: "x", login_role: "a", session_role: "a", tx_read_only: "off" }], /^owned: /],
    ["another writer", rows.map((x) => (x.t === "open" ? { ...x, login_role: "postgres" } : x)), /^open: /],
    ["another owner", rows.map((x) => (x.label === "ddl_r:r" ? { ...x, login_role: "someone" } : x)), /^object: /],
    ["another kind", rows.map((x) => (x.label === "ddl_r:r" ? { ...x, label: "ddl_r:v" } : x)), /^object: /],
    ["an unknown kind of row", [...rows, { t: "view", id: null, label: null, login_role: null, session_role: null, tx_read_only: null }], /is of kind "view"/],
    ["another column", rows.map((x, i) => (i ? x : { ...x, written_at: "x" })), /does not have exactly the columns/],
    ["not an array", { rows }, /not an array/],
  ]) assert.match(I.corroborationProblems(r, v).join("; "), re, label);
  assert.match(I.corroborationProblems(rows, null).join("; "), /no E17 readback/);

  // The permission, through the guarded tools.
  const gateOf = (s) => G.phaseGate({ paths: s.fx.paths, anchor: s.fx.anchor, manifest: M, phaseId: s.ph.phaseId, ctxAt: s.fx.ctxAt, now: s.fx.now() });
  const readOf = (s, r) => G.corroborateRead({ paths: s.fx.paths, anchor: s.fx.anchor, manifest: M, phaseId: s.ph.phaseId, rowsText: JSON.stringify(r), ctxAt: s.fx.ctxAt, now: s.fx.now() });
  const runE = async (s, a, upTo = 17) => { for (const id of I.PHASES.E.steps.slice(0, upTo)) await step(s, id, a[id]).catch(() => {}); };
  const throwing = (s) => async (...x) => { s.fx.calls.push(x); throw new TypeError("fetch failed"); };
  const cases = [
    ["a failed control (a 201 at E9)", (s) => runE(s, { ...answers(), E9: [201, '[{"id":2,"label":"I3-INS-OWNED-R-RO"}]'] }, 9), /E9 was STOP|the project is held/],
    ["an inconsistent E17", (s) => runE(s, { ...answers(), E17: [201, readback({ owned: [row(4, "I3-INS-OWNED-W-DEF")], open: [row(5, "I3-INS-OPEN-R-DEF")], ddl: ["ddl_w"] })] }), /STOP: E17's readback does not match/],
    ["an unsupported outcome (a 403 at E14)", (s) => runE(s, { ...answers(), E14: [403, '{"message":"Forbidden resource"}'] }, 14), /the project is held/],
    ["a partial phase (before E17)", (s) => runE(s, answers(), 16), /the next step is E17/],
    ["E's deadline passed", async (s) => { await runE(s, answers(["E14"])); s.fx.add(130 * MIN); }, /STOP: phase E's deadline/],
    ["a hold elsewhere after COMPLETE-WROTE (X1 unresolved)", async (s) => {
      await runE(s, answers(["E14", "E16"]));
      assert.equal(gateOf(s).corroborate, true, "permitted before the hold");
      const review = join(s.fx.dir, "e.md");
      writeFileSync(review, "a disposition of E");
      const x = s.fx.phase("item3", "X", { minutes: 60, reviewed: { path: review, sha256: G.sha256(readFileSync(review)) } });
      const w = s.fx.window("W", x.phaseId, { pid: 4002 });
      s.fx.add(1000);
      const go = s.fx.issue(x.phaseId, "X1");
      await s.fx.send(G, { text: "I3-CLEANUP", target: "staging", win: w, goId: go.goId, over: { fetchImpl: throwing(s) } }).catch(() => {});
    }, /the project is held/],
  ];
  for (const [label, setup, re] of cases) {
    const s = setupE();
    try {
      await setup(s);
      const g = gateOf(s);
      assert.equal(g.corroborate, false, label);
      assert.equal(g.query, undefined, `${label}: no query is printed`);
      await refused(() => readOf(s, corroborationRows(finalValues())), new RegExp(`the gate does not permit the separate-credential read: .*(?:${re.source})`), label);
    } finally { s.fx.cleanup(); }
  }
});
