#!/usr/bin/env node
// scripts/manual/stage0-capture.mjs — the executable stop rules of the item 2
// staging capture session (docs/security/stage0-item2-capture-runbook.md;
// docs/security/stage0-item2-classifier-plan.md §6).
//
// Every step's ONE expected outcome is declared here before the session, from
// the text's reviewed SQL and from what PostgreSQL 17.5 reports for it. Nothing
// is learned from the capture. After each send, checkStep() compares the
// results file with its step:
//   MATCH        the receipt binds (not R1), is exactly the declared outcome,
//                and rule 3′ classifies it as the step declares;
//   STOP-RECORD  the intended SQLSTATE and path were reached, but the
//                rendering differs from the declared one. The receipt is
//                evidence for review;
//   STOP         anything else: R1, another status, another SQLSTATE (a
//                permission refusal included), a transport failure, another
//                success body.
// Only MATCH lets the phase go on (nextStep). Any other verdict ends the phase:
// no later send in it, and a writing phase's later writes, cleanup included,
// wait for a reviewed decision. A MATCH of a writing send that rule 3′ still
// classifies UNRESOLVED (T2's FATAL) ends its phase too. A MATCH changes
// nothing in rule 3′'s SUPPORT, which grows only in the reviewed capture
// commit.
//
// The declared error renderings follow postgres-meta's error formatting
// (pgMetaFormat below). That the Management API's "Failed to run sql query: "
// message is that formatting is a HYPOTHESIS. The one sender receipt of an
// error, P2-01 send 2, and the N5 execute_sql messages of 2026-09-29 fit it.
// The capture tests it.
//
//   node scripts/manual/stage0-capture.mjs --list
//   node scripts/manual/stage0-capture.mjs <STEP> <results file>
//
// Exit status: 0 MATCH; 3 STOP-RECORD or STOP; 2 usage or context error.
// It makes no network call, no database call and no write.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as A from "./assemble-stage0.mjs";
import { classifyText, contextAt, strictJson, ENVELOPE_PREFIX } from "./stage0-classify.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * postgres-meta's DatabaseError formatting (supabase/postgres-meta,
 * src/lib/db.ts on master, read 2026-10-20), without its statement-timeout
 * prefix offset. JavaScript indexes UTF-16 code units and PostgreSQL's
 * position counts characters; they agree for these texts, which hold no
 * character outside the BMP.
 */
export function pgMetaFormat(f, sql) {
  let s = "";
  if (f.severity) s += `${f.severity}:  `;
  if (f.code) s += `${f.code}: `;
  if (f.message) s += f.message;
  s += "\n";
  if (f.position) {
    const position = Number(f.position) - 1;
    let line = "";
    let lineNumber = 0;
    let lineOffset = 0;
    const lines = sql.split("\n");
    let currentOffset = 0;
    for (let i = 0; i < lines.length; i++) {
      if (currentOffset + lines[i].length > position) { line = lines[i]; lineNumber = i + 1; lineOffset = position - currentOffset; break; }
      currentOffset += lines[i].length + 1;
    }
    s += `LINE ${lineNumber}: ${line}\n${" ".repeat(5 + String(lineNumber).length + 2 + lineOffset)}^\n`;
  }
  if (f.detail) s += `DETAIL:  ${f.detail}\n`;
  if (f.hint) s += `HINT:  ${f.hint}\n`;
  if (f.internalQuery) s += `QUERY:  ${f.internalQuery}\n`;
  if (f.where) s += `CONTEXT:  ${f.where}\n`;
  return s;
}

const PGLITE = "PGlite 0.4.6 (PostgreSQL 17.5), local and in-memory, 2026-10-20 (review-only; not in the repository)";
const N5 = (at) => `the N5 execute_sql message of 2026-09-29T${at}Z (staging), whose CONTEXT line is the one the pinned text gives`;
const SET_CONFIG_45S = '[{"set_config":"45s"}]';
const SETUP_BODY = '[{"setup":"stage0_lockprobe ready"}]';
const CLEANUP_BODY = '[{"schema_gone":true,"relations_left":0,"probe_locks_left":0,"probe_backends_active":0}]';
const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const sameKeys = (o, keys) => isPlainObject(o) && JSON.stringify(Object.keys(o).sort()) === JSON.stringify([...keys].sort());

/** LOCKPROBE-READBACK after a phase: the DDL committed or not; the probe ledger; no locks; no probe backend. */
function readbackShape(applied) {
  return (body) => {
    let v;
    try { v = strictJson(body, { maxChars: 1 << 16 }); } catch (e) { return `the body is not JSON without duplicate keys: ${e.message}`; }
    if (!Array.isArray(v) || v.length !== 1 || !sameKeys(v[0], ["ddl_committed", "ledger", "locks", "lockprobe_backends", "read_at"])) return "not one row with exactly the five READBACK columns";
    const r = v[0];
    if (r.ddl_committed !== applied) return `ddl_committed is ${JSON.stringify(r.ddl_committed)}, declared ${applied}`;
    const row = (x, version, name, md5) => sameKeys(x, ["version", "name", "n", "md5", "created_by"]) && version(x.version) && x.name === name && x.n === 1 && x.md5 === md5 && x.created_by === A.LEDGER_CREATED_BY;
    const base = (x) => row(x, (s) => s === "20000101000000", "baseline", A.md5("-- baseline"));
    const probe = (x) => row(x, (s) => typeof s === "string" && /^[0-9]{14}$/.test(s) && s > "20000101000000", "lockprobe", A.md5(A.LOCKPROBE_FILE));
    if (!Array.isArray(r.ledger) || r.ledger.length !== (applied ? 2 : 1) || !base(r.ledger[0]) || (applied && !probe(r.ledger[1]))) return `the probe ledger is not ${applied ? "the baseline row and one lockprobe row of the checked bytes" : "the baseline row only"}`;
    if (!Array.isArray(r.locks) || r.locks.length) return "a lock is still held on the probe tables";
    if (!Array.isArray(r.lockprobe_backends) || r.lockprobe_backends.length) return "a probe backend is still present";
    if (typeof r.read_at !== "string" || !r.read_at.length || r.read_at.length > 64) return "read_at is not a string";
    return null;
  };
}

const ERR = (server, ranges = {}) => ({ status: 400, server, ranges });

/**
 * The steps, by id. `text` is the pinned text sent; `writes` follows its send
 * policy; `expect` is the declared outcome; `classNow` is what rule 3′, with
 * today's SUPPORT, says of that outcome; `plan` is the classifier plan's label.
 */
export const STEPS = {
  B1: { phase: "B", plan: "B1", text: "ENVELOPE-PROBE-1", classNow: "R4", source: PGLITE,
    expect: ERR({ severity: "ERROR", code: "22012", message: "division by zero" }) },
  B2: { phase: "B", plan: "B2", text: "ENVELOPE-PROBE-2", classNow: "R4", source: PGLITE,
    expect: ERR({ severity: "ERROR", code: "22012", message: "division by zero", where: `SQL statement "${A.ENVELOPE_PROBE_2_EXECUTED}"\nPL/pgSQL function inline_code_block line 1 at EXECUTE` }) },
  B3: { phase: "B", plan: "B3", text: "ENVELOPE-PROBE-3", classNow: "R4", source: PGLITE,
    expect: ERR({ severity: "ERROR", code: "22P02", message: "invalid input syntax for type json", detail: "The input string ended unexpectedly.", position: "117", where: "JSON data, line 1: {" }) },
  B4: { phase: "B", plan: "B4", text: "ENVELOPE-PROBE-4", classNow: "R4", source: PGLITE,
    expect: ERR({ severity: "ERROR", code: "P0001", message: "probe", detail: "d", hint: "h", where: "PL/pgSQL function inline_code_block line 1 at RAISE" }) },
  B5: { phase: "B", plan: "B5", text: "ENVELOPE-PROBE-5", classNow: "R4", source: PGLITE,
    expect: ERR({ severity: "ERROR", code: "42601", message: 'syntax error at or near "from"', position: "104" }) },
  A1: { phase: "A", plan: "A1", text: "LOCKPROBE-SETUP", classNow: "R2", source: `${PGLITE}; its last row-returning statement`,
    expect: { status: 201, body: SETUP_BODY } },
  A2: { phase: "A", plan: "A2", text: "LOCKPROBE-B-LOCKTIMEOUT", classNow: "R3", source: `${PGLITE}; ${N5("16:30:37.252")}`,
    expect: ERR({ severity: "ERROR", code: "P0001", message: "lockprobe B-LOCKTIMEOUT: [P0001] lockprobe B-LOCKTIMEOUT: no holder seen within 10 s — the sessions did not overlap; nothing was tried — after {ms} ms, backend {pid}", where: "PL/pgSQL function inline_code_block line 75 at RAISE" }, { ms: [10000, 11999] }) },
  A3: { phase: "A", plan: "A3", text: "LOCKPROBE-B-STMTTIMEOUT", classNow: "R3", source: N5("16:39:58.546"),
    expect: ERR({ severity: "ERROR", code: "57014", message: "lockprobe B-STMTTIMEOUT: [57014] canceling statement due to statement timeout — after {ms} ms, backend {pid}", where: "PL/pgSQL function inline_code_block line 64 at RAISE" }, { ms: [7000, 8999] }) },
  A4: { phase: "A", plan: "A5", text: "LOCKPROBE-B-POSITIVE", classNow: "R2", source: `${PGLITE}; the wrapper's last row-returning statement`,
    expect: { status: 201, body: SET_CONFIG_45S } },
  A5: { phase: "A", plan: "A6", text: "LOCKPROBE-READBACK", classNow: "R2", source: `${PGLITE}; the READBACK SQL`,
    expect: { status: 201, shape: readbackShape(true), shapeName: "the DDL committed; the baseline row and one lockprobe row; no locks; no probe backend" } },
  A6: { phase: "A", plan: "A7", text: "LOCKPROBE-CLEANUP", classNow: "R2", source: `${PGLITE}; its last row-returning statement`,
    expect: { status: 201, body: CLEANUP_BODY } },
  T1: { phase: "T", plan: "A1 again", text: "LOCKPROBE-SETUP", classNow: "R2", source: `${PGLITE}; its last row-returning statement`,
    expect: { status: 201, body: SETUP_BODY } },
  // A writing send that rule 3′ classifies R4 (FATAL is not supported yet),
  // so phase T ends here even on a MATCH; U needs a reviewed go.
  T2: { phase: "T", plan: "A4", text: "LOCKPROBE-B-TXTIMEOUT", classNow: "R4", source: N5("16:45:30.271"),
    expect: ERR({ severity: "FATAL", code: "25P04", message: "terminating connection due to transaction timeout", where: 'SQL statement "SELECT pg_sleep(30)"\nPL/pgSQL function inline_code_block line 33 at PERFORM' }) },
  U1: { phase: "U", plan: "A6 again", text: "LOCKPROBE-READBACK", classNow: "R2", source: `${PGLITE}; the READBACK SQL`,
    expect: { status: 201, shape: readbackShape(false), shapeName: "no DDL; the baseline row only; no locks; no probe backend" } },
  U2: { phase: "U", plan: "A7 again", text: "LOCKPROBE-CLEANUP", classNow: "R2", source: `${PGLITE}; its last row-returning statement`,
    expect: { status: 201, body: CLEANUP_BODY } },
};

/**
 * The phases, in the order the runbook runs them. Each has its own go, token,
 * deadline and receipt preservation. U starts only on a reviewed decision
 * about T2's receipt.
 */
export const PHASES = {
  B: { steps: ["B1", "B2", "B3", "B4", "B5"], token: "staging only, Database: Read", writes: false },
  A: { steps: ["A1", "A2", "A3", "A4", "A5", "A6"], token: "staging only, Database: Read and Write", writes: true },
  T: { steps: ["T1", "T2"], token: "staging only, Database: Read and Write", writes: true },
  U: { steps: ["U1", "U2"], token: "staging only, Database: Read and Write", writes: true, requires: "a reviewed decision on T2's receipt" },
};

/** The declared message of an error step, built from its server fields and the pinned text. */
export function declaredMessage(step, texts) {
  return ENVELOPE_PREFIX + pgMetaFormat(step.expect.server, texts[step.text]);
}

/** Match m against a declared message with {ms} and {pid} slots; returns the slot values or null. */
export function matchDeclared(m, declared, ranges = {}) {
  const parts = declared.split(/(\{ms\}|\{pid\})/);
  let i = 0;
  const got = {};
  for (const p of parts) {
    if (p === "{ms}" || p === "{pid}") {
      let d = 0;
      while (d < 8 && /[0-9]/.test(m[i + d] || "")) d++;
      if (d < 1 || d > 7 || m[i] === "0") return null;
      got[p.slice(1, -1)] = Number(m.slice(i, i + d));
      i += d;
    } else {
      if (!m.startsWith(p, i)) return null;
      i += p.length;
    }
  }
  if (i !== m.length) return null;
  for (const [k, [lo, hi]] of Object.entries(ranges)) if (!(got[k] >= lo && got[k] <= hi)) return null;
  return got;
}

/** Compare one results file with its step. */
export function checkStep(id, fileText, ctx) {
  const step = STEPS[id];
  if (!step) throw new Error(`unknown step ${id}`);
  const c = classifyText(fileText, ctx);
  const res = (verdict, reasons) => ({ step: id, text: step.text, verdict, reasons, classification: c });
  if (c.class === "R1") return res("STOP", [`the receipt does not bind (R1): ${c.reasons.join("; ")}`]);
  const rec = strictJson(fileText);
  if (rec.text !== step.text) return res("STOP", [`the receipt is for ${rec.text}; step ${id} sends ${step.text}`]);
  if (rec.target !== "staging") return res("STOP", [`the receipt's target is ${rec.target}; the capture runs on staging only`]);
  const e = step.expect;
  if (e.status === 201) {
    if (rec.httpStatus !== 201) return res("STOP", [`HTTP ${rec.httpStatus ?? "none"}; declared 201`]);
    const why = e.body !== undefined ? (rec.body === e.body ? null : `the body is not exactly ${e.body}`) : e.shape(rec.body);
    if (why) return res("STOP", [`a 201 that is not the declared success: ${why}`]);
  } else {
    const declared = declaredMessage(step, ctx.texts);
    let body = null;
    try { body = strictJson(rec.body ?? "", { maxChars: 1 << 20 }); } catch { /* not JSON: neither a match nor a record */ }
    const m = isPlainObject(body) && typeof body.message === "string" ? body.message : null;
    const exactBody = sameKeys(body, ["message"]) && m !== null;
    const matched = exactBody && rec.httpStatus === e.status ? matchDeclared(m, declared, e.ranges) : null;
    if (!matched) {
      const s = e.server;
      const literal = s.message.split("{")[0];
      const intended = m !== null && m.startsWith(`${ENVELOPE_PREFIX}${s.severity}:  ${s.code}: ${literal}`);
      return intended
        ? res("STOP-RECORD", [`the intended ${s.severity} ${s.code} was reached; the status or rendering differs from the declared one (HTTP ${rec.httpStatus ?? "none"})`])
        : res("STOP", [`not the intended ${s.severity} ${s.code} on its declared path; recorded as itself (HTTP ${rec.httpStatus ?? "none"})`]);
    }
  }
  if (c.class !== step.classNow) return res("STOP", [`rule 3′ classifies the declared outcome as ${c.class}, but the step declares ${step.classNow}: a tooling defect`]);
  return res("MATCH", []);
}

/**
 * The next step of a phase given the checkStep results so far, or the stop.
 * Only a MATCH continues, and not even a MATCH after a writing send that rule
 * 3′ classifies UNRESOLVED: an UNRESOLVED writing send stops every later
 * write, cleanup included.
 */
export function nextStep(phase, results) {
  const p = PHASES[phase];
  if (!p) throw new Error(`unknown phase ${phase}`);
  if (results.length > p.steps.length) throw new Error("more results than steps");
  for (const [n, r] of results.entries()) {
    if (r.step !== p.steps[n]) throw new Error(`result ${n + 1} is for ${r.step}; phase ${phase} expects ${p.steps[n]}`);
    const later = `No later step of phase ${phase} is sent${p.writes ? ", cleanup included, until a reviewed decision" : ""}.`;
    if (r.verdict !== "MATCH") return { stop: true, reason: `${r.step} was ${r.verdict}: the phase ends here. ${later}` };
    if (r.classification.writing !== false && r.classification.outcome === "UNRESOLVED") {
      return { stop: true, reason: `${r.step} matched, but it is a writing send that rule 3′ classifies UNRESOLVED (${r.classification.class}): the phase ends here. ${later}` };
    }
  }
  return { stop: false, next: p.steps[results.length] ?? null };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [id, file] = process.argv.slice(2);
  let ctx;
  try { ctx = contextAt("HEAD", ROOT); } catch (e) { process.stderr.write(`stage0-capture: ${e.message}\n`); process.exit(2); }
  if (id === "--list") {
    for (const [ph, p] of Object.entries(PHASES)) {
      process.stdout.write(`phase ${ph} (token: ${p.token}; ${p.writes ? "writes" : "read-only"})\n`);
      for (const s of p.steps) {
        const st = STEPS[s];
        const what = st.expect.status === 201 ? (st.expect.body ?? st.expect.shapeName) : JSON.stringify(declaredMessage(st, ctx.texts));
        process.stdout.write(`  ${s} (plan ${st.plan}) ${st.text}: HTTP ${st.expect.status}, ${st.classNow} now; ${what}\n`);
      }
    }
    process.exit(0);
  }
  if (!STEPS[id] || !file) { process.stderr.write("usage: stage0-capture.mjs --list | <STEP> <results file>\n"); process.exit(2); }
  let text = null;
  try { text = readFileSync(file, "utf8"); } catch { /* reported below */ }
  const r = text === null ? { step: id, text: STEPS[id].text, verdict: "STOP", reasons: ["the results file is missing or unreadable"] } : checkStep(id, text, ctx);
  process.stdout.write(`${r.verdict} ${r.step} ${r.text}${r.reasons.length ? ` | ${r.reasons.join("; ")}` : ""}${r.classification ? ` | rule 3′: ${r.classification.class} ${r.classification.outcome}` : ""}\n`);
  if (r.verdict !== "MATCH") process.stdout.write("  The phase ends here: no later step of it is sent. A writing phase's later writes, cleanup included, wait for a reviewed decision.\n");
  else if (r.classification.writing !== false && r.classification.outcome === "UNRESOLVED") process.stdout.write("  A writing send that rule 3′ classifies UNRESOLVED: the phase ends here, even on a MATCH.\n");
  process.exit(r.verdict === "MATCH" ? 0 : 3);
}
