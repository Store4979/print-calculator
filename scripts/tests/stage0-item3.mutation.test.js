// scripts/tests/stage0-item3.mutation.test.js — the mutation companion of
// item 3's gate (Codex, review of ba1a0bd: the accepted plan's gate mutation
// companion). Each mutant removes one named check from a copy of its module:
//   - stage0-item3.mjs: fixture validation, readback consistency and the
//     final review pause;
//   - stage0-guard.mjs: the separate-credential read's hold and terminal
//     conditions;
//   - stage0-classify.mjs: the R-R1 effect metadata that decides a hold.
// For each, the ORIGINAL refuses the named invalid input (a STOP, no read,
// or a hold), and the MUTANT admits exactly that input: a MATCH, a terminal
// outcome, a permitted read, or no hold. An exception or an unrelated STOP
// under the mutant fails the test; it is not evidence that the check works.
//
//   I3-M1  each mutant admits its named negative; the original refuses it
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as G from "../manual/stage0-guard.mjs";
import * as C from "../manual/stage0-classify.mjs";
import * as I from "../manual/stage0-item3.mjs";
import { fixture, M, ROOT } from "./stage0-guard-fixture.mjs";
import { STAGING, row, readback, FIXTURE, answers, check, eResults, failedEntry, ctxWith } from "./stage0-item3-fixture.mjs";

const MANUAL = join(ROOT, "scripts", "manual");
const source = (f) => readFileSync(join(MANUAL, f), "utf8").replace(/\r\n/g, "\n");
const real = (f) => pathToFileURL(join(MANUAL, f)).href;
const clone = (x) => JSON.parse(JSON.stringify(x));

/** A copy of `file` with `edits` applied (each target exactly once) and its sibling imports pointed at `wire` (default: the real files). */
async function mutant(dir, n, file, edits, wire = {}) {
  let s = source(file);
  s = s.replace(/from "\.\/([^"]+)"/g, (m, f) => `from ${JSON.stringify(wire[f] || real(f))}`);
  for (const [from, to] of edits) {
    assert.equal(s.split(from).length, 2, `${file}: the mutant's target occurs exactly once: ${from.slice(0, 90)}`);
    s = s.split(from).join(to);
  }
  const p = join(dir, `mutant-${n}-${file}`);
  writeFileSync(p, s);
  return { url: pathToFileURL(p).href, mod: await import(pathToFileURL(p).href) };
}

/** Phase E with both windows, on a fresh fixture store; `send` runs one step through the real guard. */
function phaseE() {
  const fx = fixture();
  fx.clock();
  const ph = fx.phase("item3", "E", { minutes: 120 });
  const win = { R: fx.window("R", ph.phaseId, { pid: 1001 }), W: fx.window("W", ph.phaseId, { pid: 1002 }) };
  const send = async (id, [status, body], phase = ph, w = win, over = {}) => {
    const text = I.STEPS[id].text;
    fx.add(1000);
    const go = fx.issue(phase.phaseId, id);
    return fx.send(G, { text, target: "staging", win: w[M.send.texts[text].window], goId: go.goId, over: { fetchImpl: fx.fetchImpl(() => new Response(body, { status })), ...over } });
  };
  return { fx, ph, win, send };
}

/** E on the WROTE branch, then X registered and X1 sent with a transport failure: E is COMPLETE-WROTE, and the project is held. */
async function wroteThenHeld(s) {
  const a = answers(["E14", "E16"]);
  for (const id of I.PHASES.E.steps) await s.send(id, a[id]);
  const review = join(s.fx.dir, "e.md");
  writeFileSync(review, "a disposition of E");
  const x = s.fx.phase("item3", "X", { minutes: 60, reviewed: { path: review, sha256: G.sha256(readFileSync(review)) } });
  const w = { W: s.fx.window("W", x.phaseId, { pid: 2002 }) };
  const throwing = async (...args) => { s.fx.calls.push(args); throw new TypeError("fetch failed"); };
  await s.send("X1", [201, ""], x, w, { fetchImpl: throwing }).catch(() => {});
  return x;
}

const gateOf = (GM, s, phaseId = s.ph.phaseId) => GM.phaseGate({ paths: s.fx.paths, anchor: s.fx.anchor, manifest: M, phaseId, ctxAt: s.fx.ctxAt, now: s.fx.now() });

/** [class, writing, holds] for a transport-failed send of `text` under `manifest`, with the guard module GM. */
function holdVerdict(GM, CM, text, manifest, target = "staging") {
  const { bytes, entry, readReceipt } = failedEntry(text, manifest, target);
  const c = ctxWith(manifest);
  const cl = CM.classifyText(bytes.toString("utf8"), c);
  return [cl.class, cl.writing, GM.holdsOf([entry], { ctxAt: () => c, readReceipt }).length];
}

const withoutEffect = (k) => { const m = clone(M); delete m.send.texts[k].effect; return m; };
const movedP0 = () => { const m = clone(M); m.send.texts.P0.window = "W"; return m; };

/**
 * The mutants: [name, file, edits, run]. run(mod) returns the outcome on the
 * named negative under `mod` (the original or the mutant, with its sibling
 * modules); `refused` and `admitted` say what the original and the mutant
 * must give.
 */
const MUTANTS = [
  {
    name: "fixture: a table owned by another role", file: "stage0-item3.mjs",
    edits: [["if (t.owner !== owner) out.push(", "if (false) out.push("]],
    run: async ({ I3 }) => check("E2", [201, FIXTURE({ tables: JSON.parse(FIXTURE())[0].tables.map((t) => ({ ...t, owner: "someone" })) })], I3),
    refused: (r) => r.verdict === "STOP" && /not the schema's owner/.test(r.reasons.join("; ")),
    admitted: (r) => r.verdict === "MATCH",
  },
  {
    name: "fixture: owned granted to another role", file: "stage0-item3.mjs",
    edits: [["      out.push(`${label} grants ${a.privileges} to ${a.grantee || \"PUBLIC\"}`);\n", ""]],
    run: async ({ I3 }) => check("E2", [201, FIXTURE({ tables: JSON.parse(FIXTURE())[0].tables.map((t) => (t.name === "owned" ? { ...t, acl: "{postgres=arwdDxtm/postgres,supabase_read_only_user=a/postgres}" } : t)) })], I3),
    refused: (r) => r.verdict === "STOP" && /owned grants a to supabase_read_only_user/.test(r.reasons.join("; ")),
    admitted: (r) => r.verdict === "MATCH",
  },
  {
    name: "fixture: another object in the schema", file: "stage0-item3.mjs",
    edits: [["!== JSON.stringify(BASE_OBJECTS)) out.push(", "!== JSON.stringify(BASE_OBJECTS) && false) out.push("]],
    run: async ({ I3 }) => check("E2", [201, FIXTURE({ objects: [...JSON.parse(FIXTURE())[0].objects, { name: "v", kind: "v" }] })], I3),
    refused: (r) => r.verdict === "STOP" && /other objects/.test(r.reasons.join("; ")),
    admitted: (r) => r.verdict === "MATCH",
  },
  {
    name: "readback: a row in open that no outcome explains", file: "stage0-item3.mjs",
    edits: [["  rows(values.open, open, \"open\");\n", ""]],
    run: async ({ I3 }) => I3.nextStep("E", eResults([], { E17: [201, readback({ owned: [row(4, "I3-INS-OWNED-W-DEF")], open: [row(5, "I3-INS-OPEN-R-DEF")], ddl: ["ddl_w"] })] }, I3)),
    refused: (r) => r.stop === true && /E17's readback does not match.*open holds rows \[5\]/.test(r.reason),
    admitted: (r) => r.stop === false && r.terminal && r.terminal.outcome === "COMPLETE-REFUSED",
  },
  {
    name: "readback: an object that no outcome explains", file: "stage0-item3.mjs",
    edits: [["if (JSON.stringify(got) !== JSON.stringify(want)) out.push(", "if (false) out.push("]],
    run: async ({ I3 }) => I3.nextStep("E", eResults([], { E17: [201, readback({ owned: [row(4, "I3-INS-OWNED-W-DEF")], ddl: ["ddl_w", "ddl_r"] })] }, I3)),
    refused: (r) => r.stop === true && /E17's readback does not match.*objects/.test(r.reason),
    admitted: (r) => r.stop === false && r.terminal && r.terminal.outcome === "COMPLETE-REFUSED",
  },
  {
    name: "readback: a row without its writer recorded", file: "stage0-item3.mjs",
    edits: [["![r.login_role, r.session_role, r.tx_read_only, r.written_at].every((v) => typeof v === \"string\" && v.length)", "false"]],
    run: async ({ I3 }) => I3.nextStep("E", eResults([], { E13: [201, readback({ owned: [{ ...row(4, "I3-INS-OWNED-W-DEF"), login_role: "" }], ddl: ["ddl_w"] })] }, I3)),
    refused: (r) => r.stop === true && /E13's readback does not match.*with its writer recorded/.test(r.reason),
    admitted: (r) => r.stop === false && r.terminal && r.terminal.outcome === "COMPLETE-REFUSED",
  },
  {
    name: "final review pause: a WROTE", file: "stage0-item3.mjs",
    edits: [["const wrote = [\"E14\", \"E15\", \"E16\"].filter((s) => byStep[s].outcome === \"WROTE\");", "const wrote = [];"]],
    run: async ({ I3 }) => I3.nextStep("E", eResults(["E14", "E16"], {}, I3)),
    refused: (r) => r.terminal && r.terminal.outcome === "COMPLETE-WROTE" && r.terminal.disposition === "Codex",
    admitted: (r) => r.stop === false && r.terminal && r.terminal.outcome === "COMPLETE-REFUSED" && r.terminal.disposition === "Ryan or Codex",
  },
  {
    name: "read permission: a hold", file: "stage0-guard.mjs",
    edits: [["gate.terminal.corroborate === true && !holds.length && !lock);", "gate.terminal.corroborate === true && !lock);"]],
    run: async ({ G: GM }) => {
      const s = phaseE();
      try {
        await wroteThenHeld(s);
        const g = gateOf(GM, s);
        return { corroborate: g.corroborate, holds: g.holds.length, outcome: g.terminal && g.terminal.outcome };
      } finally { s.fx.cleanup(); }
    },
    refused: (r) => r.corroborate === false && r.holds === 1 && r.outcome === "COMPLETE-WROTE",
    admitted: (r) => r.corroborate === true && r.holds === 1,
  },
  {
    name: "read permission: the terminal outcome's own flag (X's end permits none)", file: "stage0-guard.mjs",
    edits: [["gate.complete && gate.terminal && gate.terminal.corroborate === true && !holds.length", "gate.complete && !holds.length"]],
    run: async ({ G: GM }) => {
      const s = phaseE();
      try {
        const a = answers();
        for (const id of I.PHASES.E.steps) await s.send(id, a[id]);
        const review = join(s.fx.dir, "e.md");
        writeFileSync(review, "a disposition of E");
        const x = s.fx.phase("item3", "X", { minutes: 60, reviewed: { path: review, sha256: G.sha256(readFileSync(review)) } });
        const w = { R: s.fx.window("R", x.phaseId, { pid: 2001 }), W: s.fx.window("W", x.phaseId, { pid: 2002 }) };
        for (const id of I.PHASES.X.steps) await s.send(id, a[id], x, w);
        const g = gateOf(GM, s, x.phaseId);
        return { corroborate: g.corroborate, outcome: g.terminal && g.terminal.outcome };
      } finally { s.fx.cleanup(); }
    },
    refused: (r) => r.corroborate === false && r.outcome === "COMPLETE",
    admitted: (r) => r.corroborate === true && r.outcome === "COMPLETE",
  },
  {
    name: "metadata/hold: an item 3 write text without its effect", file: "stage0-classify.mjs",
    edits: [["  if (!own(LEGACY_EFFECT, name)) return null;\n", "  if (!own(LEGACY_EFFECT, name)) return policy.readOnly !== true;\n"]],
    run: async ({ G: GM, C: CM }) => holdVerdict(GM, CM, "I3-INS-OWNED-R-RO", withoutEffect("I3-INS-OWNED-R-RO")),
    refused: (r) => JSON.stringify(r) === JSON.stringify(["R1", null, 1]),
    admitted: (r) => JSON.stringify(r) === JSON.stringify(["R1", false, 0]),
  },
  {
    name: "metadata/hold: a legacy text under another policy", file: "stage0-classify.mjs",
    edits: [["if (!isPlainObject(pin) || pin.md5 !== md5 || canonical(policy) !== canonical(reviewed)) return null;", "if (!isPlainObject(pin)) return null;"]],
    run: async ({ G: GM, C: CM }) => holdVerdict(GM, CM, "P0", movedP0(), "production"),
    refused: (r) => JSON.stringify(r) === JSON.stringify(["R1", null, 1]),
    admitted: (r) => JSON.stringify(r) === JSON.stringify(["R1", false, 0]),
  },
];

test("I3-M1 the item 3 mutation companion: each named check, removed, admits exactly its named negative, which the original refuses", async () => {
  const dir = mkdtempSync(join(tmpdir(), "s0-i3-mutants-"));
  try {
    for (const [n, m] of MUTANTS.entries()) {
      // The original.
      const before = await m.run({ I3: I, G, C });
      assert.ok(m.refused(before), `${m.name}: the original refuses it; got ${JSON.stringify(before && (before.reasons || before.reason || before))}`);
      // The mutant, with the modules that load it rewired to it.
      let mods;
      if (m.file === "stage0-item3.mjs") {
        const x = await mutant(dir, n, m.file, m.edits);
        mods = { I3: x.mod, G, C };
      } else if (m.file === "stage0-guard.mjs") {
        const x = await mutant(dir, n, m.file, m.edits);
        mods = { I3: I, G: x.mod, C };
      } else {
        const xc = await mutant(dir, n, m.file, m.edits);
        const xg = await mutant(dir, n, "stage0-guard.mjs", [], { "stage0-classify.mjs": xc.url });
        mods = { I3: I, G: xg.mod, C: xc.mod };
      }
      let after;
      try { after = await m.run(mods); } catch (e) { assert.fail(`${m.name}: the mutant must admit the negative; it threw ${e && e.constructor.name}: ${e && e.message}`); }
      assert.ok(m.admitted(after), `${m.name}: the mutant admits it; got ${JSON.stringify(after && (after.reasons || after.reason || after))}`);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
