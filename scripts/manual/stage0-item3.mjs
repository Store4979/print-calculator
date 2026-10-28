// scripts/manual/stage0-item3.mjs — the exact-step gate of item 3, the
// read-token experiment on staging (docs/security/stage0-item3-read-token-plan.md,
// as amended by Codex's review of 2026-10-28: I3-1 to I3-3; the runbook
// docs/security/stage0-item3-runbook.md). The guarded sender loads it as the
// `item3` workflow (stage0-guard.mjs WORKFLOWS).
//
// Every step's outcome is declared here before the session, from the text's
// SQL and a local PostgreSQL 17.5 run with synthetic roles (review-only; it
// shows nothing about Supabase's roles). checkStep() compares one receipt
// with its step:
//   MATCH  the receipt binds (not R1), is exactly a declared outcome, and
//          rule 3′ classifies it as that outcome says (R2 for a success, R3
//          for a refusal). A measured step (E14 to E16) MATCHes either way,
//          and records WROTE or REFUSED;
//   STOP   anything else. A 201 for a read_only control (E8 to E10) is a
//          STOP: read_only did not stop that write, STOP-and-review.
// nextStep() names the next step or the stop. It also checks each readback
// (E3, E13, E17) against the outcomes before it: a row or an object the
// outcomes do not explain, or one they call for that is missing, stops
// the phase. After E17, a WROTE stops the phase too: the Read PAT wrote,
// STOP-and-review, and X waits for a reviewed disposition.
//
// What is enforced and what is not: X can be registered only with a named
// review file (`requires`), whose sha256 the phase records. That the file is
// a genuine review of E's exact receipts is a human check; the gate sees
// only its own phase's attempts. A WHO row comes from its own request: it
// does not show the role or mode of another request.
//
// It makes no network call, no database call and no write.
import { classifyText, strictJson, ENVELOPE_PREFIX } from "./stage0-classify.mjs";

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const sameKeys = (o, keys) => isPlainObject(o) && JSON.stringify(Object.keys(o).sort()) === JSON.stringify([...keys].sort());
const MIN = 60000;

/** The refusals a step may declare: field-less ERRORs, as PostgreSQL 17.5 words them. */
export const REFUSALS = Object.freeze({
  insertReadOnly: Object.freeze({ code: "25006", message: "cannot execute INSERT in a read-only transaction" }),
  ownedDenied: Object.freeze({ code: "42501", message: "permission denied for table owned" }),
  createReadOnly: Object.freeze({ code: "25006", message: "cannot execute CREATE TABLE in a read-only transaction" }),
});
/** The refusal's whole body, as the Management API returns it (postgres-meta's formatting of a field-less ERROR). */
export const refusalBody = (r) => JSON.stringify({ message: `${ENVELOPE_PREFIX}ERROR:  ${r.code}: ${r.message}\n` });

const BASE_OBJECTS = [["open", "r"], ["open_pkey", "i"], ["owned", "r"], ["owned_pkey", "i"]];

/**
 * The steps, by id. `ok` is a declared 201 (its exact or shaped body is the
 * classifier's predicate); `refuse` lists the declared refusals; `measure`
 * allows either the 201 (WROTE) or one of its refusals (REFUSED);
 * `readback` names which outcomes the readback must show.
 */
export const STEPS = Object.freeze({
  E1: { phase: "E", text: "I3-SETUP", ok: true },
  E2: { phase: "E", text: "I3-FIXTURE", ok: true, fixture: true },
  E3: { phase: "E", text: "I3-READBACK", ok: true, readback: "empty" },
  E4: { phase: "E", text: "I3-WHO-R-RO", ok: true },
  E5: { phase: "E", text: "I3-WHO-R-DEF", ok: true },
  E6: { phase: "E", text: "I3-WHO-W-RO", ok: true },
  E7: { phase: "E", text: "I3-WHO-W-DEF", ok: true },
  E8: { phase: "E", text: "I3-INS-OWNED-W-RO", refuse: [REFUSALS.insertReadOnly, REFUSALS.ownedDenied], control: true },
  E9: { phase: "E", text: "I3-INS-OWNED-R-RO", refuse: [REFUSALS.insertReadOnly, REFUSALS.ownedDenied], control: true },
  E10: { phase: "E", text: "I3-INS-OPEN-R-RO", refuse: [REFUSALS.insertReadOnly], control: true },
  E11: { phase: "E", text: "I3-INS-OWNED-W-DEF", ok: true },
  E12: { phase: "E", text: "I3-DDL-W-DEF", ok: true },
  E13: { phase: "E", text: "I3-READBACK", ok: true, readback: "controls" },
  E14: { phase: "E", text: "I3-INS-OPEN-R-DEF", measure: [REFUSALS.insertReadOnly] },
  E15: { phase: "E", text: "I3-INS-OWNED-R-DEF", measure: [REFUSALS.insertReadOnly, REFUSALS.ownedDenied] },
  E16: { phase: "E", text: "I3-DDL-R-DEF", measure: [REFUSALS.createReadOnly] },
  E17: { phase: "E", text: "I3-READBACK", ok: true, readback: "final" },
  X1: { phase: "X", text: "I3-CLEANUP", ok: true },
  X2: { phase: "X", text: "I3-ABSENT", ok: true },
});

const E_STEPS = Array.from({ length: 17 }, (_, i) => `E${i + 1}`);
/**
 * The phases, each with its own go, tokens and windows. Each step reserves
 * about 3 minutes for itself and every step after it in the phase, plus 10
 * minutes for token cleanup: staging budgeting, not item 4(c)'s production
 * whole-path calculation. X starts only on a reviewed disposition of E.
 */
export const PHASES = Object.freeze({
  E: {
    steps: E_STEPS,
    token: "staging only: one Database: Read token (window R) and one Database: Read and Write token (window W)",
    writes: true,
    ceilings: Object.fromEntries(E_STEPS.map((s, i) => [s, (3 * (E_STEPS.length - i) + 10) * MIN])),
  },
  X: {
    steps: ["X1", "X2"],
    token: "staging only: one Database: Read token (window R) and one Database: Read and Write token (window W)",
    writes: true,
    requires: "a reviewed disposition of phase E (its phase id, its checked receipts, its readbacks and the separate-credential read)",
    ceilings: { X1: 16 * MIN, X2: 13 * MIN },
  },
});

/**
 * Compare one results file with its step. Any input gives a verdict: an
 * exception while checking is a STOP with its message. Only an unknown step
 * id throws.
 */
export function checkStep(id, fileText, ctx) {
  const step = STEPS[id];
  if (!step) throw new Error(`unknown step ${id}`);
  try { return checkStepChecked(id, step, fileText, ctx); } catch (e) {
    return { step: id, text: step.text, verdict: "STOP", reasons: [`the check could not complete (${e && e.name}: ${e && e.message}); a tooling defect, for review`], classification: null };
  }
}

function checkStepChecked(id, step, fileText, ctx) {
  const c = classifyText(fileText, ctx);
  const res = (verdict, reasons, extra = {}) => ({ step: id, text: step.text, verdict, reasons, classification: c, ...extra });
  if (c.class === "R1") return res("STOP", [`the receipt does not bind (R1): ${c.reasons.join("; ")}`]);
  const rec = strictJson(fileText);
  if (rec.text !== step.text) return res("STOP", [`the receipt is for ${rec.text}; step ${id} sends ${step.text}`]);
  if (rec.target !== "staging") return res("STOP", [`the receipt's target is ${rec.target}; item 3 runs on staging only`]);
  if (rec.httpStatus === 201) {
    if (step.refuse) return res("STOP", [`HTTP 201: read_only did not stop this write. STOP-and-review`]);
    if (c.class !== "R2") return res("STOP", [`a 201 that is not ${step.text}'s declared success (${c.class}: ${c.reasons.join("; ")})`]);
    if (step.fixture) {
      const why = fixtureProblems(c.values);
      if (why.length) return res("STOP", [`the fixture is not the declared one: ${why.join("; ")}`], { values: c.values });
    }
    return res("MATCH", [], { ...(step.measure ? { outcome: "WROTE" } : {}), ...(c.values ? { values: c.values } : {}) });
  }
  const declared = step.refuse || step.measure || [];
  const hit = declared.find((r) => rec.httpStatus === 400 && rec.body === refusalBody(r));
  if (!hit) return res("STOP", [`not a declared outcome of ${id}; recorded as itself (HTTP ${rec.httpStatus ?? "none"})`]);
  if (c.class !== "R3") return res("STOP", [`rule 3′ classifies the declared refusal as ${c.class}, not R3: a tooling defect, for review`]);
  return res("MATCH", [], { refusal: hit.code, ...(step.measure ? { outcome: "REFUSED" } : {}) });
}

/** The entries of an aclitem[] text, or null if any entry does not parse. */
export function aclEntries(text) {
  if (text === null) return [];
  if (typeof text !== "string" || !text.startsWith("{") || !text.endsWith("}")) return null;
  const body = text.slice(1, -1);
  if (!body) return [];
  const out = [];
  for (const item of body.split(",")) {
    const m = /^("?)([^"=/]*)\1=([a-zA-Z*]*)\/("?)([^"=/]+)\4$/.exec(item);
    if (!m) return null;
    out.push({ grantee: m[2], privileges: m[3], grantor: m[5] });
  }
  return out;
}

/**
 * The fixture contract (Codex, item 3 plan review I3-2): both tables owned
 * by the schema's owner, without row security, policies, triggers or rules;
 * exactly the two tables and their keys in the schema; `owned` granted to
 * nobody but its owner; `open` to its owner and to PUBLIC for SELECT and
 * INSERT only; the schema to its owner and to PUBLIC for USAGE and CREATE
 * only. The owner's default ACLs are recorded, not asserted: they explain
 * where a grant came from, and the table ACLs above are what bind.
 */
export function fixtureProblems(x) {
  const out = [];
  if (!isPlainObject(x)) return ["no fixture row"];
  const owner = x.schema_owner;
  const only = (acl, label, publicPrivileges) => {
    const e = aclEntries(acl);
    if (e === null) { out.push(`${label}'s ACL does not parse`); return; }
    for (const a of e) {
      if (a.grantee === owner) continue;
      if (a.grantee === "" && publicPrivileges !== null && a.privileges === publicPrivileges) continue;
      out.push(`${label} grants ${a.privileges} to ${a.grantee || "PUBLIC"}`);
    }
    if (publicPrivileges !== null && !e.some((a) => a.grantee === "" && a.privileges === publicPrivileges)) out.push(`${label} does not grant ${publicPrivileges} to PUBLIC`);
  };
  only(x.schema_acl, "the schema", "UC");
  const tables = Array.isArray(x.tables) ? x.tables : [];
  if (JSON.stringify(tables.map((t) => t && t.name)) !== JSON.stringify(["open", "owned"])) out.push("the tables are not exactly open and owned");
  for (const t of tables) {
    if (!sameKeys(t, ["name", "owner", "acl", "rls", "force_rls"])) { out.push("a table entry has other fields"); continue; }
    if (t.owner !== owner) out.push(`${t.name} is owned by ${t.owner}, not the schema's owner ${owner}`);
    if (t.rls !== false || t.force_rls !== false) out.push(`${t.name} has row security on`);
    only(t.acl, t.name, t.name === "open" ? "ar" : null);
  }
  if (x.policies !== 0 || x.triggers !== 0 || x.rules !== 0) out.push(`policies ${x.policies}, triggers ${x.triggers}, rules ${x.rules}; all must be 0`);
  if (JSON.stringify((x.objects || []).map((o) => [o && o.name, o && o.kind])) !== JSON.stringify(BASE_OBJECTS)) out.push("the schema holds other objects than the two tables and their keys");
  return out;
}

/** A readback's problems against the rows and objects the outcomes so far call for. */
export function readbackProblems(values, { owned, open, ddl }) {
  const out = [];
  if (!isPlainObject(values)) return ["no readback row"];
  const rows = (got, want, table) => {
    const ids = (got || []).map((r) => r && r.id);
    if (JSON.stringify(ids) !== JSON.stringify(want.map((w) => w.id))) { out.push(`${table} holds rows ${JSON.stringify(ids)}; the outcomes call for ${JSON.stringify(want.map((w) => w.id))}`); return; }
    for (const [i, r] of got.entries()) {
      if (!sameKeys(r, ["id", "label", "login_role", "session_role", "tx_read_only", "written_at"])) out.push(`${table} row ${r.id} has other columns`);
      else if (r.label !== want[i].label || ![r.login_role, r.session_role, r.tx_read_only, r.written_at].every((v) => typeof v === "string" && v.length)) out.push(`${table} row ${r.id} is not ${want[i].label} with its writer recorded`);
    }
  };
  rows(values.owned, owned, "owned");
  rows(values.open, open, "open");
  const want = [...BASE_OBJECTS.map(([n, k]) => [n, k]), ...ddl.map((n) => [n, "r"])].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const got = (values.objects || []).map((o) => [o && o.name, o && o.kind]);
  if (JSON.stringify(got) !== JSON.stringify(want)) out.push(`the schema's objects are ${JSON.stringify(got.map((g) => g[0]))}; the outcomes call for ${JSON.stringify(want.map((w) => w[0]))}`);
  if ((values.objects || []).some((o) => !isPlainObject(o) || typeof o.owner !== "string")) out.push("an object has no owner recorded");
  return out;
}

const INSERT_ROW = { E11: { id: 4, label: "I3-INS-OWNED-W-DEF" }, E14: { id: 5, label: "I3-INS-OPEN-R-DEF" }, E15: { id: 6, label: "I3-INS-OWNED-R-DEF" } };

/** What a readback must show after the results so far. */
function wanted(kind, byStep) {
  if (kind === "empty") return { owned: [], open: [], ddl: [] };
  const wrote = (s) => byStep[s] && byStep[s].outcome === "WROTE";
  const owned = [INSERT_ROW.E11, ...(kind === "final" && wrote("E15") ? [INSERT_ROW.E15] : [])];
  const open = kind === "final" && wrote("E14") ? [INSERT_ROW.E14] : [];
  const ddl = ["ddl_w", ...(kind === "final" && wrote("E16") ? ["ddl_r"] : [])];
  return { owned, open, ddl };
}

/**
 * The next step of a phase given the checkStep results so far, or the stop.
 * Only a MATCH continues, and not a MATCH after a writing send that rule 3′
 * classifies UNRESOLVED. A readback must show exactly what the outcomes
 * before it call for. After E17, a WROTE stops the phase for review.
 */
export function nextStep(phase, results) {
  const p = PHASES[phase];
  if (!p) throw new Error(`unknown phase ${phase}`);
  if (results.length > p.steps.length) throw new Error("more results than steps");
  const byStep = {};
  for (const [n, r] of results.entries()) {
    if (r.step !== p.steps[n]) throw new Error(`result ${n + 1} is for ${r.step}; phase ${phase} expects ${p.steps[n]}`);
    const later = `No later step of phase ${phase} is sent; X waits for a reviewed disposition.`;
    if (r.verdict !== "MATCH") return { stop: true, reason: `${r.step} was ${r.verdict}: ${r.reasons.join("; ")}. ${later}` };
    if (r.classification && r.classification.writing !== false && r.classification.outcome === "UNRESOLVED") return { stop: true, reason: `${r.step} matched, but rule 3′ classifies the writing send UNRESOLVED: the phase ends here. ${later}` };
    byStep[r.step] = r;
    const rb = STEPS[r.step].readback;
    if (rb) {
      const why = readbackProblems(r.values, wanted(rb, byStep));
      if (why.length) return { stop: true, reason: `${r.step}'s readback does not match the outcomes before it: ${why.join("; ")}. ${later}` };
    }
  }
  if (phase === "E" && results.length === p.steps.length) {
    const wrote = ["E14", "E15", "E16"].filter((s) => byStep[s].outcome === "WROTE");
    if (wrote.length) return { stop: true, reason: `the Read PAT WROTE at ${wrote.join(", ")} (${wrote.map((s) => STEPS[s].text).join(", ")}): STOP-and-review. The fixture stays as evidence; X needs a reviewed disposition` };
  }
  return { stop: false, next: p.steps[results.length] ?? null };
}
