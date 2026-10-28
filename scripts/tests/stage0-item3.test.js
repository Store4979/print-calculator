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
import { I3_POLICY } from "./stage0-manifest-check.mjs";

const STAGING = "lboajqihpsfrokqvjgnl";
const MIN = 60000;

async function refused(fn, re, label = "") {
  let err = null;
  try { await fn(); } catch (e) { err = e; }
  assert.ok(err, `${label}: expected a refusal`);
  assert.ok(err instanceof G.Refusal, `${label}: expected a Refusal, got ${err && err.constructor.name}: ${err && err.message}`);
  if (re) assert.match(err.message, re, label);
  return err;
}

/** A receipt of the sender's shape for an item 3 text, bound to its pin. */
function receiptFor(text, httpStatus, body, extra = {}) {
  const pin = M.outputs[text];
  return JSON.stringify({
    tool: M.sender.path, text, target: "staging", ref: STAGING, readOnly: M.send.texts[text].readOnly === true, requestMd5: pin.md5, requestBytes: pin.bytes,
    endpoint: M.send.endpoint.replace("{ref}", STAGING), startedAt: "2026-10-28T14:00:00.000Z", finishedAt: "2026-10-28T14:00:01.000Z",
    httpStatus, body, error: null, tokenRedactedFromResponse: false, ...extra,
  }, null, 2) + "\n";
}

const BASE = [["open", "r"], ["open_pkey", "i"], ["owned", "r"], ["owned_pkey", "i"]];
const row = (id, label, login = "postgres", ro = "off") => ({ id, label, login_role: login, session_role: login, tx_read_only: ro, written_at: "2026-10-28 14:00:00.123456+00" });
const readback = ({ owned = [], open = [], ddl = [] } = {}) => JSON.stringify([{
  owned, open, objects: [...BASE, ...ddl.map((n) => [n, "r"])].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([name, kind]) => ({ name, kind, owner: "postgres" })),
}]);
const FIXTURE = (over = {}) => JSON.stringify([{
  schema_owner: "postgres", schema_acl: "{postgres=UC/postgres,=UC/postgres}",
  tables: [
    { name: "open", owner: "postgres", acl: "{postgres=arwdDxtm/postgres,=ar/postgres}", rls: false, force_rls: false },
    { name: "owned", owner: "postgres", acl: "{postgres=arwdDxtm/postgres}", rls: false, force_rls: false },
  ],
  policies: 0, triggers: 0, rules: 0, objects: BASE.map(([name, kind]) => ({ name, kind })),
  default_acls: [{ role: "postgres", schema: "*", type: "r", acl: "{anon=arwdDxtm/postgres}" }], ...over,
}]);
const WHO = (login, ro) => JSON.stringify([{ login_role: login, session_role: login, tx_read_only: ro ? "on" : "off", default_tx_read_only: "off", superuser: false, bypass_rls: false,
  write_all_data: false, read_all_data: true, schema_usage: true, schema_create: true, owned_insert: false, owned_select: true, open_insert: true, open_select: true }]);
const R = I.REFUSALS;
const REF = (r) => [400, I.refusalBody(r)];

/**
 * Each step's declared answer on one branch: `wrote` names the measured steps
 * (E14, E15, E16) that WROTE; the others are REFUSED.
 */
function answers(wrote = []) {
  const w = (s) => wrote.includes(s);
  return {
    E1: [201, '[{"setup":"stage0_item3 ready"}]'], E2: [201, FIXTURE()], E3: [201, readback()],
    E4: [201, WHO("supabase_read_only_user", true)], E5: [201, WHO("supabase_read_only_user", false)],
    E6: [201, WHO("supabase_read_only_user", true)], E7: [201, WHO("postgres", false)],
    E8: REF(R.insertReadOnly), E9: REF(R.insertReadOnly), E10: REF(R.insertReadOnly),
    E11: [201, '[{"id":4,"label":"I3-INS-OWNED-W-DEF"}]'], E12: [201, '[{"created":true}]'],
    E13: [201, readback({ owned: [row(4, "I3-INS-OWNED-W-DEF")], ddl: ["ddl_w"] })],
    E14: w("E14") ? [201, '[{"id":5,"label":"I3-INS-OPEN-R-DEF"}]'] : REF(R.insertReadOnly),
    E15: w("E15") ? [201, '[{"id":6,"label":"I3-INS-OWNED-R-DEF"}]'] : REF(R.ownedDenied),
    E16: w("E16") ? [201, '[{"created":true}]'] : REF(R.createReadOnly),
    E17: [201, readback({
      owned: [row(4, "I3-INS-OWNED-W-DEF"), ...(w("E15") ? [row(6, "I3-INS-OWNED-R-DEF", "supabase_read_only_user")] : [])],
      open: w("E14") ? [row(5, "I3-INS-OPEN-R-DEF", "supabase_read_only_user")] : [],
      ddl: ["ddl_w", ...(w("E16") ? ["ddl_r"] : [])],
    })],
    X1: [201, '[{"gone":true}]'], X2: [201, '[{"gone":true}]'],
  };
}
const check = (id, [status, body]) => I.checkStep(id, receiptFor(I.STEPS[id].text, status, body), ctx());

// ── I3-1 ─────────────────────────────────────────────────────────────────────

test("I3-1 the declarations: every step's text has its staging policy and effect; every phase declares its ceilings; X needs a reviewed disposition; effect, never read_only, decides writing", () => {
  assert.deepEqual(Object.keys(A.item3Texts()).sort(), Object.keys(I3_POLICY).sort());
  for (const [name, p] of Object.entries(I3_POLICY)) {
    assert.deepEqual(M.send.texts[name], { targets: ["staging"], readOnly: p.readOnly, window: p.window, effect: p.effect }, name);
    assert.equal(C.effectWriting(M.send.texts[name]), p.effect === "write", `${name}: writing follows the effect`);
  }
  for (const [id, s] of Object.entries(I.STEPS)) assert.ok(Object.hasOwn(I3_POLICY, s.text), `${id} sends ${s.text}`);
  const wf = G.WORKFLOWS.item3;
  assert.equal(wf.target, "staging");
  assert.deepEqual(Object.keys(wf.phases), ["E", "X"]);
  for (const ph of ["E", "X"]) assert.deepEqual(G.ceilingReserve(wf, ph), I.PHASES[ph].ceilings, `${ph}'s ceilings are declared`);
  assert.equal(I.PHASES.E.ceilings.E1, 61 * MIN);
  assert.equal(I.PHASES.E.ceilings.E17, 13 * MIN);
  assert.match(wf.phases.X.requires, /reviewed disposition of phase E/);
  // The classifier's effect rule (I3-1).
  assert.equal(C.effectWriting({ readOnly: true, effect: "write" }), true, "a read_only probe declared write is writing");
  assert.equal(C.effectWriting({ readOnly: false, effect: "read" }), false);
  assert.equal(C.effectWriting({ readOnly: true, effect: "maybe" }), null, "an invalid effect is unknown, so treated as writing");
  assert.equal(C.effectWriting({ readOnly: true }), false, "a text before item 3 keeps its read_only-derived effect");
  assert.equal(C.effectWriting({ readOnly: false }), true);
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

test("I3-3 the fixture contract (I3-2) and the readback rules: a grant, a policy, a trigger, row security or an object the contract does not allow stops; each readback must show exactly what the outcomes before it call for; a WROTE stops E after E17", () => {
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
  const all = (branch, over = {}) => Object.keys(I.STEPS).filter((s) => s.startsWith("E")).map((id) => check(id, over[id] || answers(branch)[id]));
  assert.deepEqual(run(all([])), { stop: false, next: null }, "all refused: E is complete");
  const wrote = run(all(["E15"]));
  assert.equal(wrote.stop, true);
  assert.match(wrote.reason, /the Read PAT WROTE at E15 \(I3-INS-OWNED-R-DEF\): STOP-and-review/);
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

test("I3-4 E and X end to end through the guarded tools: the all-refused branch completes E; a WROTE stops E after E17; X needs a named review file and then cleans up", async () => {
  for (const branch of [[], ["E14", "E16"]]) {
    const s = setupE();
    try {
      const a = answers(branch);
      for (const id of I.PHASES.E.steps) await step(s, id, a[id]);
      assert.equal(s.fx.calls.length, 17, "one request per step");
      assert.deepEqual(s.fx.status(STAGING).holds, [], "nothing held: every outcome is resolved");
      const gate = G.guardedProgress({ phase: s.ph, entries: G.readJournal(s.fx.paths, STAGING), ctxAt: s.fx.ctxAt, now: s.fx.now() });
      if (branch.length) {
        assert.equal(gate.stop, true);
        assert.match(gate.reason, /the Read PAT WROTE at E14, E16/);
      } else assert.equal(gate.complete, true, gate.reason);
      await refused(() => s.fx.issue(s.ph.phaseId, "E17"), /the gate does not name E17/, "nothing more in E");
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
