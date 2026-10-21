// scripts/tests/stage0-classify.test.js — rule 3′, the stage-0 send classifier
// (scripts/manual/stage0-classify.mjs), and the item 2 capture session's
// executable stop rules (scripts/manual/stage0-capture.mjs). Classifier plan
// §5. No test here reaches the network or a database.
//
//   CL-1  history: the nine held receipts classify as on record
//   CL-2  the real fixtures are the sender's files byte for byte
//   CL-3  coverage: a predicate entry for exactly the send policy's texts; the
//         receipt keys are the real sender's; the observed statuses
//   CL-4  receipt binding (R1)
//   CL-5  cancel instances bind through their own path (R1)
//   CL-6  duplicate keys: a receipt is R1; an envelope or a body is R4
//   CL-7  truncated responses are R4
//   CL-8  unexpected success bodies are R4
//   CL-9  gateway or HTML text quoting an SQL error is R4
//   CL-10 the envelope grammar, its edges and its bounds
//   CL-11 success is not acceptance: readbackAcceptance
//   CL-12 the mutation companion: each parser constraint is load-bearing
//   CL-13 the N5 execute_sql history fits the declared capture outcomes
//   CL-14 every capture step's declared outcome is a MATCH; the stop variants
//   CL-15 nextStep: only MATCH continues; T2 ends its phase
//   CL-16 the declarations bind to the pinned texts
//   CL-17 the two command lines
//   CL-18 no network call
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as A from "../manual/assemble-stage0.mjs";
import * as C from "../manual/stage0-classify.mjs";
import * as K from "../manual/stage0-capture.mjs";
import * as S from "../manual/stage0-send.mjs";
import { MANIFEST_PATH } from "./stage0-manifest-check.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const FIX = join(ROOT, "scripts", "tests", "fixtures", "stage0-classify");
const M = JSON.parse(readFileSync(join(ROOT, MANIFEST_PATH), "utf8"));
const ctx = C.contextFor(M, { cwd: ROOT });

// The receipts in .stage0-send/ as the sender wrote them: md5 of the file, and the class on record.
const REAL = {
  "2026-10-07T00-11-42-130Z_SIZE-PROBE_staging.json": ["b5fea7c74ccc0c2a559fd2e43a958604", "R2"],
  "2026-10-07T15-21-44-109Z_P0_production.json": ["a4407704e2e73a3c9e7a251bd94ac074", "R2"],
  "2026-10-09T01-24-24-192Z_P0_production.json": ["567a4646edfac8eff50c951b9635cbdd", "R2"],
  "2026-10-09T01-30-25-743Z_P1_production.json": ["542b5c405c6de169ed79dfa0f78874ca", "R2"],
  "2026-10-09T01-32-00-580Z_P0_production.json": ["c4107c11d0a03b1d9fcc94f0a0cca786", "R2"],
  "2026-10-09T01-32-05-922Z_STATE_production.json": ["7bfa2c79e54c2efa725c8f4173cd995d", "R2"],
  "2026-10-09T15-17-05-343Z_P2-01_production.json": ["d4f2ae922a3d733f083cc711a3a15ead", "R2"],
  "2026-10-09T15-17-50-900Z_P2-01_production.json": ["9b497c2c99c7616359289c8774957808", "R3"],
  "2026-10-13T16-02-46-359Z_STATE_production.json": ["4bfd515a52745533dc2b6d1aefdc3dd2", "R2"],
};
const SEND1 = "2026-10-09T15-17-05-343Z_P2-01_production.json";
const SEND2 = "2026-10-09T15-17-50-900Z_P2-01_production.json";
const STATE01 = "2026-10-13T16-02-46-359Z_STATE_production.json";
const P0 = "2026-10-07T15-21-44-109Z_P0_production.json";
const P1 = "2026-10-09T01-30-25-743Z_P1_production.json";
const real = (f) => readFileSync(join(FIX, "real", f), "utf8");
const rec = (f) => JSON.parse(real(f));
const asFile = (r) => (typeof r === "string" ? r : JSON.stringify(r, null, 2) + "\n");
const cls = (r) => C.classifyText(asFile(r), ctx);
const env = (m) => JSON.stringify({ message: m });
const M2 = JSON.parse(rec(SEND2).body).message;
const SET45 = '[{"set_config":"45s"}]';

/** A receipt of the sender's shape for a text and target, bound to its pin. */
function receiptFor(text, target, httpStatus, body, extra = {}) {
  const pin = M.outputs[text];
  const ref = M.send.targets[target];
  return {
    tool: M.sender.path, text, target, ref, readOnly: M.send.texts[text].readOnly === true, requestMd5: pin.md5, requestBytes: pin.bytes,
    endpoint: M.send.endpoint.replace("{ref}", ref), startedAt: "2026-10-21T12:00:00.000Z", finishedAt: "2026-10-21T12:00:01.000Z",
    httpStatus, body, error: null, tokenRedactedFromResponse: false, ...extra,
  };
}

test("CL-1 history: the nine held receipts classify as on record (P2-01 send 2 is R3 P0001; every other one R2)", () => {
  assert.deepEqual(readdirSync(join(FIX, "real")).sort(), Object.keys(REAL).sort());
  for (const [f, [, want]] of Object.entries(REAL)) assert.equal(C.classifyText(real(f), ctx).class, want, f);
  const c = C.classifyText(real(SEND2), ctx);
  assert.equal(c.outcome, "RESOLVED SQL error");
  assert.deepEqual(c.sqlError, {
    severity: "ERROR", sqlstate: "P0001", primary: "stage0 P2-01: release2_01_identity_schema is already in the ledger",
    context: [{ kind: "plpgsql", fname: "inline_code_block", line: 312, stmt: "RAISE" }],
  });
  assert.equal(c.writing, true);
  assert.deepEqual(Object.keys(cls(rec(STATE01)).values).sort(), ["catalog_state", "effective_prefix", "ledger_md5_ok", "ledger_rows", "recovery"]);
});

test("CL-2 the real fixtures are the sender's files byte for byte: md5, no CR, no token text, tokenRedactedFromResponse false", () => {
  for (const [f, [md5]] of Object.entries(REAL)) {
    const b = readFileSync(join(FIX, "real", f));
    assert.equal(A.md5(b), md5, `${f}: the bytes the sender wrote`);
    assert.ok(!b.includes(0x0d), `${f}: no CR (.gitattributes keeps them -text)`);
    assert.ok(!b.toString("utf8").includes("sbp_"), `${f}: no access-token text`);
    assert.equal(JSON.parse(b).tokenRedactedFromResponse, false);
    assert.deepEqual(C.strictJson(b.toString("utf8")), JSON.parse(b), `${f}: strictJson reads what JSON.parse reads`);
  }
});

test("CL-3 coverage: one predicate entry per send-policy text, both ways; the receipt keys are the real sender's; statuses {400}", async () => {
  assert.deepEqual(Object.keys(C.SUCCESS).sort(), Object.keys(M.send.texts).sort(), "exactly the send policy's texts");
  for (const [k, s] of Object.entries(C.SUCCESS)) {
    if (s.kind === "unsupported") assert.ok(s.why, `${k}: why it is unsupported`);
    else { assert.equal(typeof s.check, "function", k); assert.ok(s.source, `${k}: the SQL or receipt it comes from`); }
  }
  assert.deepEqual(Object.keys(C.OBSERVED_STATUSES), ["400"]);
  // The record the real sender writes, through a mock fetch: its keys, and its class.
  const plan = S.planSend(M, "P2-01", "production", { cwd: ROOT });
  const r = await S.send(plan, { token: "sbp_test", fetchImpl: async () => ({ status: 201, text: async () => SET45 }), clock: () => new Date("2026-10-21T12:00:00.000Z") });
  assert.deepEqual(Object.keys(r).sort(), [...C.RECEIPT_KEYS].sort());
  assert.equal(cls(r).class, "R2", "what the sender writes for a P2 success is R2");
  const cp = S.planSend(M, "CANCEL-STEP-TEMPLATE", "production", { cancel: { step: "P2-0304", backendStart: "2026-10-01T12:00:00.123456Z" }, cwd: ROOT });
  const cr = await S.send(cp, { token: "sbp_test", fetchImpl: async () => ({ status: 201, text: async () => "[]" }) });
  assert.deepEqual(Object.keys(cr).sort(), [...C.RECEIPT_KEYS, "cancelTemplate"].sort());
  assert.equal(cls(cr).class, "R4", "a bound cancel instance reaches R2's unsupported rule");
});

const r1 = (r, why) => {
  const c = cls(r);
  assert.equal(c.class, "R1", `${why}: ${JSON.stringify(c.reasons)}`);
  return c;
};

test("CL-4 receipt binding: a missing, mistyped or extra field, a wrong pin, ref, endpoint, tool, readOnly, text, target or timestamp, a transport error despite 201 and a leaked token are R1", () => {
  const base = rec(SEND1);
  assert.equal(cls(base).class, "R2");
  for (const k of C.RECEIPT_KEYS) { const r = { ...base }; delete r[k]; r1(r, `${k} missing`); }
  const wrong = {
    tool: 1, text: 1, target: 1, ref: 1, readOnly: "false", requestMd5: base.requestMd5.toUpperCase(), requestBytes: String(base.requestBytes), endpoint: 1,
    startedAt: "2026-10-09 15:17:05", finishedAt: 1, httpStatus: "201", body: 1, error: 1, tokenRedactedFromResponse: "false",
  };
  for (const [k, v] of Object.entries(wrong)) r1({ ...base, [k]: v }, `${k} of the wrong type`);
  r1({ ...base, extra: 1 }, "an extra key");
  r1({ ...base, requestMd5: "0".repeat(32) }, "a wrong requestMd5");
  r1({ ...base, requestBytes: base.requestBytes + 1 }, "a wrong requestBytes");
  r1({ ...base, ref: M.send.targets.staging }, "the right text with the wrong ref");
  r1({ ...base, endpoint: base.endpoint.replace("api.supabase.com", "api.example.com") }, "a wrong endpoint");
  r1({ ...base, tool: "scripts/manual/other.mjs" }, "a wrong tool");
  r1({ ...base, readOnly: true }, "readOnly flipped");
  r1({ ...base, text: "P2-03" }, "a text not in the send policy");
  r1({ ...base, target: "staging", ref: M.send.targets.staging, endpoint: M.send.endpoint.replace("{ref}", M.send.targets.staging) }, "a target the policy does not allow");
  r1({ ...base, finishedAt: "2026-10-09T15:17:04.000Z" }, "a reversed timestamp pair");
  r1({ ...base, startedAt: "2026-02-30T15:17:05.343Z" }, "a malformed timestamp");
  r1({ ...base, httpStatus: 201, body: null, error: "TypeError: response body connection reset" }, "Codex's transport error despite 201");
  r1({ ...base, error: "AbortError: The operation was aborted" }, "the exact success body with error non-null");
  for (const f of [SEND1, SEND2]) assert.equal(r1({ ...rec(f), tokenRedactedFromResponse: true }, "a leaked token").tokenExposed, true);
  r1("not json", "not JSON");
  r1("[]\n", "not an object");
  r1(asFile(base) + "{}", "two documents");
});

test("CL-5 cancel instances bind through their own path: the rebuilt instance binds; a wrong step, backend_start or template, the template's own md5, or a misplaced cancelTemplate is R1", () => {
  const T = "CANCEL-STEP-TEMPLATE";
  const bs = "2026-10-01T12:00:00.123456Z";
  const inst = A.cancelStepText(ctx.texts[T], "P2-0304", bs);
  const ct = { md5: M.outputs[T].md5, bytes: M.outputs[T].bytes, step: "P2-0304", backendStart: bs };
  const cancel = (over = {}) => receiptFor(T, "production", 201, "[]", { requestMd5: A.md5(inst), requestBytes: Buffer.byteLength(inst), cancelTemplate: ct, ...over });
  const ok = cls(cancel());
  assert.equal(ok.class, "R4");
  assert.match(ok.reasons[0], /no supported success predicate/);
  r1(cancel({ cancelTemplate: { ...ct, step: "P2-03" } }), "a step that is not a stage-0 step");
  r1(cancel({ cancelTemplate: { ...ct, backendStart: "2026-10-01T12:00:00Z" } }), "a malformed backend_start");
  r1(cancel({ cancelTemplate: { ...ct, md5: "f".repeat(32) } }), "a template md5 that is not the pin");
  r1(cancel({ requestMd5: M.outputs[T].md5, requestBytes: M.outputs[T].bytes }), "a requestMd5 that matches the template, not the instance");
  r1(cancel({ cancelTemplate: { ...ct, step: "P1" } }), "a step whose instance is not the request");
  r1(cancel({ cancelTemplate: { ...ct, extra: 1 } }), "cancelTemplate with an extra key");
  { const r = cancel(); delete r.cancelTemplate; r1(r, "a cancel without cancelTemplate"); }
  r1({ ...rec(SEND1), cancelTemplate: ct }, "cancelTemplate on a text that is not a cancel");
});

test("CL-6 duplicate keys: a receipt with two body keys is R1; an envelope with two messages and a P2 body with two set_config keys are R4; strictJson refuses them", () => {
  const dup = asFile(rec(SEND1)).replace('"body": ', '"body": "x",\n  "body": ');
  r1(dup, "a receipt with two body keys");
  assert.equal(cls({ ...rec(SEND2), body: `{"message":${JSON.stringify(M2)},"message":${JSON.stringify(M2)}}` }).class, "R4");
  assert.equal(cls({ ...rec(SEND1), body: '[{"set_config":"45s","set_config":"45s"}]' }).class, "R4");
  assert.throws(() => C.strictJson('{"a":1,"a":1}'), /duplicate key "a"/);
  assert.throws(() => C.strictJson('[{"a":{"b":1,"b":2}}]'), /duplicate key "b"/);
  assert.throws(() => C.strictJson('{"a":1,"\\u0061":2}'), /duplicate key "a"/, "an escaped duplicate is a duplicate");
  assert.throws(() => C.strictJson("[".repeat(40) + "]".repeat(40)), /nesting deeper than 32/);
  assert.throws(() => C.strictJson('{"a":1} x'), /content after the value/);
  const p = C.strictJson('{"__proto__":{"x":1}}');
  assert.equal(Object.getPrototypeOf(p), Object.prototype, "a __proto__ key is an own property, not the prototype");
  assert.deepEqual(Object.keys(p), ["__proto__"]);
});

test("CL-7 truncated responses: every proper prefix of the real P0001 body and of the real success body, a message without its last newline and a CONTEXT cut mid-frame are R4", () => {
  const s2 = rec(SEND2);
  const s1 = rec(SEND1);
  for (let n = 0; n < s2.body.length; n++) assert.equal(cls({ ...s2, body: s2.body.slice(0, n) }).class, "R4", `P0001 body prefix ${n}`);
  for (let n = 0; n < s1.body.length; n++) assert.equal(cls({ ...s1, body: s1.body.slice(0, n) }).class, "R4", `success body prefix ${n}`);
  assert.equal(cls({ ...s2, body: env(M2.slice(0, -1)) }).class, "R4", "the trailing newline removed");
  assert.equal(cls({ ...s2, body: env(M2.slice(0, M2.indexOf(" at RAISE")) + "\n") }).class, "R4", "CONTEXT cut mid-frame");
});

test("CL-8 unexpected success bodies are R4: [], 90s, STATE's body under a P2 text, the exact body plus a newline, P1 minus a row, a wrong SIZE-PROBE answer, a P0 column of the wrong type", () => {
  const s1 = rec(SEND1);
  for (const body of ["[]", '[{"set_config":"90s"}]', rec(STATE01).body, SET45 + "\n"]) assert.equal(cls({ ...s1, body }).class, "R4", body);
  const p1 = rec(P1);
  assert.equal(cls({ ...p1, body: JSON.stringify(JSON.parse(p1.body).slice(1)) }).class, "R4", "P1 minus one row");
  const rows = JSON.parse(p1.body);
  rows[0].what += ".";
  assert.equal(cls({ ...p1, body: JSON.stringify(rows) }).class, "R4", "P1 with one label changed");
  const sp = rec("2026-10-07T00-11-42-130Z_SIZE-PROBE_staging.json");
  assert.equal(cls({ ...sp, body: sp.body.replace("240951", "240950") }).class, "R4", "a wrong SIZE-PROBE answer");
  const p0 = rec(P0);
  assert.equal(cls({ ...p0, body: p0.body.replace('"free_pins":8999', '"free_pins":"8999"') }).class, "R4", "a P0 count as a string");
});

test("CL-9 gateway or HTML text quoting an SQL error is R4: HTML, another key, a prefix, an extra key, 500, 200, 201", () => {
  const s2 = rec(SEND2);
  for (const [httpStatus, body] of [
    [502, `<html><body><h1>502 Bad Gateway</h1><pre>${M2}</pre></body></html>`],
    [400, JSON.stringify({ error: M2 })],
    [400, env("proxy: " + M2)],
    [400, JSON.stringify({ message: M2, code: 1 })],
    [500, env(M2)],
    [200, env(M2)],
    [201, env(M2)],
  ]) assert.equal(cls({ ...s2, httpStatus, body }).class, "R4", `${httpStatus} ${body.slice(0, 40)}`);
});

// A support object with every element enabled: the grammar's own behaviour,
// apart from which elements today's SUPPORT admits.
const FULL = {
  severities: { ERROR: "test", FATAL: "test" },
  fieldless: "test",
  fields: { DETAIL: "test", HINT: "test", QUERY: "test", CONTEXT: "test" },
  frames: { plpgsql: { fnames: { inline_code_block: "test" }, stmts: { RAISE: "test", EXECUTE: "test", PERFORM: "test" } }, sqlstmt: { rendering: "verbatim" } },
};
const P = "Failed to run sql query: ";
const TRAP = 'select 1;\n-- "\nPL/pgSQL function inline_code_block line 1 at EXECUTE\nselect 1/0;';
// Each case: the message, its candidate inputs, and whether the grammar accepts it under FULL.
const GRAMMAR = [
  ["the real P0001", M2, [], true],
  ["field-less", `${P}ERROR:  22012: division by zero\n`, [], true],
  ["a SQL statement frame quoting a pinned input", `${P}ERROR:  22012: division by zero\nCONTEXT:  SQL statement "${A.ENVELOPE_PROBE_2_EXECUTED}"\nPL/pgSQL function inline_code_block line 1 at EXECUTE\n`, [A.ENVELOPE_PROBE_2_EXECUTED], true],
  ["a pinned input that itself holds a quote, a newline and a PL/pgSQL-looking line", `${P}ERROR:  22012: division by zero\nCONTEXT:  SQL statement "${TRAP}"\nPL/pgSQL function inline_code_block line 1 at EXECUTE\n`, [TRAP], true],
  ["DETAIL, HINT, CONTEXT in order", `${P}ERROR:  P0001: probe\nDETAIL:  d\nHINT:  h\nCONTEXT:  PL/pgSQL function inline_code_block line 1 at RAISE\n`, [], true],
  ["FATAL", `${P}FATAL:  25P04: terminating connection due to transaction timeout\n`, [], true],
  ["fields out of order", `${P}ERROR:  P0001: probe\nHINT:  h\nDETAIL:  d\n`, [], false],
  ["a repeated field", `${P}ERROR:  P0001: probe\nDETAIL:  d\nDETAIL:  e\n`, [], false],
  ["an unknown label", `${P}ERROR:  P0001: probe\nNOTE:  n\n`, [], false],
  ["one space after ERROR:", `${P}ERROR: P0001: probe\n`, [], false],
  ["a lowercase SQLSTATE", `${P}ERROR:  p0001: probe\n`, [], false],
  ["a four-character SQLSTATE", `${P}ERROR:  P001: probe\n`, [], false],
  ["no prefix", `ERROR:  P0001: probe\n`, [], false],
  ["a prefixed prefix", `proxy: ${P}ERROR:  P0001: probe\n`, [], false],
  ["a SQL statement frame quoting no pinned input", `${P}ERROR:  22012: division by zero\nCONTEXT:  SQL statement "select 1/0;"\nPL/pgSQL function inline_code_block line 1 at EXECUTE\n`, [A.ENVELOPE_PROBE_2_EXECUTED], false],
  ["junk after the last frame", `${M2}junk\n`, [], false],
  ["junk after the last field", `${P}ERROR:  P0001: probe\nDETAIL:  d\njunk\n`, [], false],
  ["a second primary line", `${P}ERROR:  P0001: probe\nERROR:  P0001: again\n`, [], false],
  ["an empty primary text", `${P}ERROR:  P0001: \n`, [], false],
  ["a frame of an unknown kind", `${P}ERROR:  22P02: invalid input syntax for type json\nCONTEXT:  JSON data, line 1: {\n`, [], false],
  ["a function name that is not supported", `${P}ERROR:  P0001: x\nCONTEXT:  PL/pgSQL function f() line 1 at RAISE\n`, [], false],
  ["a seven-digit line", `${P}ERROR:  P0001: x\nCONTEXT:  PL/pgSQL function inline_code_block line 1234567 at RAISE\n`, [], false],
  ["seventeen frames", `${P}ERROR:  P0001: x\nCONTEXT:  ${Array(17).fill("PL/pgSQL function inline_code_block line 1 at RAISE").join("\n")}\n`, [], false],
  ["a primary text over 8 KiB", `${P}ERROR:  P0001: ${"x".repeat(8 * 1024 + 1)}\n`, [], false],
  ["a message over the bound", `${P}ERROR:  P0001: x\nDETAIL:  ${"x".repeat(8000)}\n`.repeat(9), [], false],
];

test("CL-10 the envelope grammar: its accepted forms, its edges and bounds; today's SUPPORT admits only the observed P0001 form", () => {
  for (const [name, m, candidates, ok] of GRAMMAR) assert.equal(C.parseEnvelope(m, { candidates, support: FULL }).ok, ok, `${name} (FULL)`);
  for (const [name, m, candidates] of GRAMMAR) {
    const r = C.parseEnvelope(m, { candidates });
    assert.equal(r.ok, name === "the real P0001", `${name} (SUPPORT)`);
  }
  assert.match(C.parseEnvelope(`${P}FATAL:  25P04: x\n`).why, /severity FATAL is not supported yet/);
  assert.match(C.parseEnvelope(`${P}ERROR:  22012: x\n`).why, /field-less envelope is not supported yet/);
  assert.match(C.parseEnvelope(`${P}ERROR:  P0001: x\nDETAIL:  d\n`).why, /DETAIL is not supported yet/);
  // Through a receipt, under the observed status: the grammar's refusals are R4.
  const s2 = rec(SEND2);
  for (const [name, m] of GRAMMAR) if (name !== "the real P0001") assert.equal(cls({ ...s2, body: env(m) }).class, "R4", name);
});

test("CL-11 success is not acceptance: R2 read-backs pass or STOP on their values; a P0 type error is R4", () => {
  const st = cls(rec(STATE01));
  assert.equal(st.class, "R2");
  assert.deepEqual(C.readbackAcceptance("STATE", st.values, { effective_prefix: "01", catalog_state: "01" }), { verdict: "ACCEPT", reasons: [] });
  const s0 = cls(rec("2026-10-09T01-32-05-922Z_STATE_production.json"));
  assert.equal(C.readbackAcceptance("STATE", s0.values, { effective_prefix: "", catalog_state: "00" }).verdict, "ACCEPT");
  const bad = rec(STATE01);
  const md5False = cls({ ...bad, body: bad.body.replace('"ledger_md5_ok":true', '"ledger_md5_ok":false') });
  assert.equal(md5False.class, "R2", "the query completed: R2");
  assert.equal(C.readbackAcceptance("STATE", md5False.values, { effective_prefix: "01" }).verdict, "STOP", "but ledger_md5_ok false stops advancement");
  const unrec = cls({ ...bad, body: bad.body.replace('"catalog_state":"01"', '"catalog_state":"unrecognized"') });
  assert.equal(unrec.class, "R2");
  assert.equal(C.readbackAcceptance("STATE", unrec.values, { effective_prefix: "01", catalog_state: "01" }).verdict, "STOP");
  assert.equal(C.readbackAcceptance("STATE", st.values, { effective_prefix: "01,02" }).verdict, "STOP", "an unexpected prefix stops");
  const p0 = cls(rec(P0));
  assert.equal(p0.class, "R2");
  assert.equal(C.readbackAcceptance("P0", p0.values, { catalog_fingerprint: "8b3c9eadf9eb8a98cb8cc6dca996663e", ledger_rows: 20, ledger_head: "20260909232836", free_pins: 8999 }).verdict, "ACCEPT");
  assert.equal(C.readbackAcceptance("P0", p0.values, { ledger_rows: 21 }).verdict, "STOP");
  assert.equal(C.readbackAcceptance("P0", { ...p0.values, pg17_hard_timer: false }, { ledger_rows: 20 }).verdict, "STOP", "the hard timer is required whatever is expected");
  assert.equal(C.readbackAcceptance("P0", p0.values, {}).verdict, "STOP", "no expected values: STOP");
  assert.equal(C.readbackAcceptance("P2-01", {}, { x: 1 }).verdict, "STOP", "no acceptance for other texts");
  assert.equal(C.readbackAcceptance("STATE", undefined, { effective_prefix: "01" }).verdict, "STOP", "not an R2 result");
});

// ── CL-12 the mutation companion ────────────────────────────────────────────
// Each mutant removes one parser constraint from a copy of the module (its
// assembler import pointed at the real file). Each must misclassify at least
// one case, so the fixtures, not just the code, hold that constraint.
const SRC = readFileSync(join(ROOT, "scripts", "manual", "stage0-classify.mjs"), "utf8").replace(/\r\n/g, "\n");
// [constraint, edits, the fixture the mutant must misclassify]
const MUTANTS = [
  ["the anchoring", [["  if (!at(ENVELOPE_PREFIX)) return no(\"the message does not start with the API's prefix\");\n  i += ENVELOPE_PREFIX.length;", "  i = m.indexOf(ENVELOPE_PREFIX);\n  if (i < 0) return no(\"x\");\n  i += ENVELOPE_PREFIX.length;"]], "a prefixed prefix"],
  ["the two spaces", [["const sev = [\"ERROR\", \"FATAL\"].find((s) => at(`${s}:  `));", "const sev = [\"ERROR\", \"FATAL\"].find((s) => at(`${s}:`));"], ["  i += sev.length + 3;", "  i += sev.length + 1;\n  while (m[i] === \" \") i++;"]], "one space after ERROR:"],
  ["the SQLSTATE class", [["/^[0-9A-Z]{5}$/.test(state)", "/^.{5}$/.test(state)"]], "a lowercase SQLSTATE"],
  ["the field order", [["    if (k < next) return no(`${FIELD_ORDER[k]} is out of order or repeated`);\n", ""]], "fields out of order"],
  ["the frame kinds", [["    return no(\"a frame of a kind that is not supported\");", "    { const e = m.indexOf(String.fromCharCode(10), i); if (e < 0) return no(\"x\"); i = e + 1; return { ok: true, frame: { kind: \"other\" } }; }"]], "a frame of an unknown kind"],
  ["the pinned sqltext", [["      const hits = candidates.map((c, n) => ({ c, n })).filter(({ c }) => m.startsWith(`${c}\"" + String.fromCharCode(92) + "n`, start));", "      const e = m.indexOf('\"' + String.fromCharCode(10), start); const hits = e < 0 ? [] : [{ c: m.slice(start, e), n: -1 }];"]], "a SQL statement frame quoting no pinned input"],
  ["the candidate-first match", [["      const hits = candidates.map((c, n) => ({ c, n })).filter(({ c }) => m.startsWith(`${c}\"" + String.fromCharCode(92) + "n`, start));", "      const e = m.indexOf('\"' + String.fromCharCode(10), start); const hits = candidates.map((c, n) => ({ c, n })).filter(({ c }) => e >= 0 && m.slice(start, e) === c);"]], "a pinned input that itself holds a quote, a newline and a PL/pgSQL-looking line"],
  ["nothing left over", [["  while (i < m.length) {", "  while (i < m.length && FIELD_ORDER.some((f) => at(`${f}:  `))) {"]], "junk after the last field"],
  ["the observed-status set", [["  if (own(OBSERVED_STATUSES, rec.httpStatus)) {", "  if (rec.httpStatus !== 201) {"]], "status 500"],
];
const STATUS_CASES = [[500, env(M2)], [200, env(M2)], [502, env(M2)]];

async function mutantModule(edits, dir, n) {
  let s = SRC.split('from "./assemble-stage0.mjs"').join(`from ${JSON.stringify(pathToFileURL(join(ROOT, "scripts", "manual", "assemble-stage0.mjs")).href)}`);
  for (const [from, to] of edits) {
    assert.equal(s.split(from).length, 2, `the mutant's target occurs exactly once: ${from.slice(0, 70)}`);
    s = s.split(from).join(to);
  }
  const p = join(dir, `mutant-${n}.mjs`);
  writeFileSync(p, s);
  return import(pathToFileURL(p).href);
}

test("CL-12 the mutation companion: removing each parser constraint misclassifies its named fixture", async () => {
  const dir = mkdtempSync(join(tmpdir(), "stage0-classify-mutants-"));
  try {
    const realStatus = STATUS_CASES.map(([h, b]) => cls({ ...rec(SEND2), httpStatus: h, body: b }).class);
    for (const [n, [name, edits, must]] of MUTANTS.entries()) {
      const X = await mutantModule(edits, dir, n);
      const flipped = GRAMMAR.filter(([, m, candidates, ok]) => X.parseEnvelope(m, { candidates, support: FULL }).ok !== ok).map(([c]) => c);
      const mctx = X.contextFor(M, { cwd: ROOT });
      const statusFlips = STATUS_CASES.filter(([h, b], i) => X.classifyText(asFile({ ...rec(SEND2), httpStatus: h, body: b }), mctx).class !== realStatus[i]).map(([h]) => `status ${h}`);
      assert.ok([...flipped, ...statusFlips].includes(must), `${name}: the mutant must misclassify "${must}"; it flipped ${JSON.stringify([...flipped, ...statusFlips])}`);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── the capture session ─────────────────────────────────────────────────────

const H = JSON.parse(readFileSync(join(FIX, "execute-sql-history.json"), "utf8"));
const HIST = Object.fromEntries(H.messages.map((x) => [x.at, x]));

test("CL-13 the N5 execute_sql history fits the declared capture outcomes (A2, A3, T2), and is exact transcript text", () => {
  for (const x of H.messages) {
    assert.equal(JSON.parse(x.toolResult).error.message, x.message, `${x.at}: the message is the tool result's`);
    assert.equal(x.project, A.STAGING_REF, `${x.at}: staging`);
  }
  for (const [id, at] of [["A2", "2026-09-29T16:30:37.252Z"], ["A3", "2026-09-29T16:39:58.546Z"], ["T2", "2026-09-29T16:45:30.271Z"]]) {
    const st = K.STEPS[id];
    assert.ok(K.matchDeclared(HIST[at].message, K.declaredMessage(st, ctx.texts), st.expect.ranges), `${id} is what N5 saw at ${at}`);
  }
  // As 400 receipts of their texts, today's rule 3′ says: the two re-raised errors are R3, the FATAL is R4.
  const as400 = (text, m) => cls(receiptFor(text, "staging", 400, env(m))).class;
  assert.equal(as400("LOCKPROBE-B-LOCKTIMEOUT", HIST["2026-09-29T16:30:37.252Z"].message), "R3");
  assert.equal(as400("LOCKPROBE-B-LOCKTIMEOUT", HIST["2026-09-29T16:38:55.436Z"].message), "R3", "55P03, re-raised, is the same envelope shape");
  assert.equal(as400("LOCKPROBE-B-STMTTIMEOUT", HIST["2026-09-29T16:39:58.546Z"].message), "R3");
  assert.equal(as400("LOCKPROBE-B-TXTIMEOUT", HIST["2026-09-29T16:45:30.271Z"].message), "R4", "FATAL and a SQL statement frame are not supported yet");
  // The 42702: DETAIL, a QUERY that spans two lines and a named-function frame: outside the grammar, even under FULL.
  const q = HIST["2026-09-15T14:18:30.382Z"].message;
  assert.equal(C.parseEnvelope(q, { support: FULL }).ok, false);
});

/** A receipt of exactly a step's declared outcome. */
function declaredReceipt(id, over = {}) {
  const st = K.STEPS[id];
  const e = st.expect;
  if (e.status === 201) {
    const body = e.body !== undefined ? e.body : JSON.stringify([{
      ddl_committed: id === "A5",
      ledger: [
        { version: "20000101000000", name: "baseline", n: 1, md5: A.md5("-- baseline"), created_by: A.LEDGER_CREATED_BY },
        ...(id === "A5" ? [{ version: "20261021120000", name: "lockprobe", n: 1, md5: A.md5(A.LOCKPROBE_FILE), created_by: A.LEDGER_CREATED_BY }] : []),
      ],
      locks: [], lockprobe_backends: [], read_at: "2026-10-21T12:00:00.000Z",
    }]);
    return receiptFor(st.text, "staging", 201, body, over);
  }
  const lo = (e.ranges.ms || [1000])[0];
  const m = K.declaredMessage(st, ctx.texts).split("{ms}").join(String(lo)).split("{pid}").join("1836099");
  return receiptFor(st.text, "staging", 400, env(m), over);
}
const check = (id, r) => K.checkStep(id, asFile(r), ctx);

test("CL-14 every capture step's declared outcome is a MATCH with its declared class; the stop variants are STOP or STOP-RECORD", () => {
  for (const id of Object.keys(K.STEPS)) {
    const r = check(id, declaredReceipt(id));
    assert.equal(r.verdict, "MATCH", `${id}: ${r.reasons.join("; ")}`);
    assert.equal(r.classification.class, K.STEPS[id].classNow, `${id}: rule 3′'s class`);
  }
  for (const id of Object.keys(K.STEPS).filter((x) => K.STEPS[x].expect.status === 400)) {
    const d = declaredReceipt(id);
    const m = JSON.parse(d.body).message;
    assert.equal(check(id, { ...d, body: env(`${P}ERROR:  42501: permission denied for schema public\n`) }).verdict, "STOP", `${id}: a permission refusal is not the intended path`);
    assert.equal(check(id, { ...d, body: env(m.slice(0, -1)) }).verdict, "STOP-RECORD", `${id}: the intended SQLSTATE, rendered otherwise`);
    assert.equal(check(id, { ...d, httpStatus: 500 }).verdict, "STOP-RECORD", `${id}: the intended SQLSTATE under another status`);
    assert.equal(check(id, { ...d, body: JSON.stringify({ message: m, code: 1 }) }).verdict, "STOP-RECORD", `${id}: another body shape`);
    assert.equal(check(id, { ...d, httpStatus: null, body: null, error: "TypeError: fetch failed" }).verdict, "STOP", `${id}: a transport failure`);
    assert.equal(check(id, { ...d, body: "<html>502</html>", httpStatus: 502 }).verdict, "STOP", `${id}: gateway text`);
  }
  for (const id of ["A2", "A3"]) {
    const [lo, hi] = K.STEPS[id].expect.ranges.ms;
    for (const ms of [lo - 1, hi + 1]) {
      const m = K.declaredMessage(K.STEPS[id], ctx.texts).split("{ms}").join(String(ms)).split("{pid}").join("1836099");
      assert.equal(check(id, declaredReceipt(id, { body: env(m) })).verdict, "STOP-RECORD", `${id}: ${ms} ms is outside the declared range`);
    }
  }
  for (const id of Object.keys(K.STEPS).filter((x) => K.STEPS[x].expect.status === 201)) {
    const d = declaredReceipt(id);
    assert.equal(check(id, { ...d, body: "[]" }).verdict, "STOP", `${id}: another success body`);
    assert.equal(check(id, { ...d, httpStatus: 400, body: env(M2) }).verdict, "STOP", `${id}: an error where a success is declared`);
  }
  assert.equal(check("A4", declaredReceipt("A1")).verdict, "STOP", "a receipt for another text");
  assert.equal(check("A1", { ...declaredReceipt("A1"), tokenRedactedFromResponse: true }).verdict, "STOP", "R1");
  assert.equal(check("A5", declaredReceipt("U1")).verdict, "STOP", "READBACK without the committed DDL, where A5 declares it");
  assert.throws(() => check("Z9", declaredReceipt("A1")), /unknown step/);
});

test("CL-15 nextStep: only a MATCH continues; a STOP ends the phase; T2's MATCH ends phase T (a writing send rule 3′ calls UNRESOLVED)", () => {
  const ok = (id) => check(id, declaredReceipt(id));
  assert.deepEqual(K.nextStep("B", []), { stop: false, next: "B1" });
  assert.deepEqual(K.nextStep("B", ["B1", "B2"].map(ok)), { stop: false, next: "B3" });
  assert.deepEqual(K.nextStep("B", K.PHASES.B.steps.map(ok)), { stop: false, next: null });
  assert.deepEqual(K.nextStep("A", K.PHASES.A.steps.map(ok)), { stop: false, next: null });
  const a2stop = check("A2", { ...declaredReceipt("A2"), body: env(`${P}ERROR:  42501: permission denied\n`) });
  const s = K.nextStep("A", [ok("A1"), a2stop]);
  assert.equal(s.stop, true);
  assert.match(s.reason, /A2 was STOP: the phase ends here\. No later step of phase A is sent, cleanup included, until a reviewed decision/);
  const t = K.nextStep("T", ["T1", "T2"].map(ok));
  assert.equal(t.stop, true, "T2 matched, and still ends the phase");
  assert.match(t.reason, /writing send that rule 3′ classifies UNRESOLVED \(R4\)/);
  assert.deepEqual(K.nextStep("U", [ok("U1")]), { stop: false, next: "U2" });
  assert.equal(K.PHASES.U.requires, "a reviewed decision on T2's receipt");
  assert.throws(() => K.nextStep("A", [ok("A2")]), /expects A1/);
});

/** The PL/pgSQL line of the nth `needle` inside a text's DO body (line 1 is the rest of the opening line). */
function plpgsqlLine(text, needle, nth = 1) {
  const open = "do $stage0_wrap$";
  const s = text.indexOf(open) + open.length;
  let i = s - 1;
  for (let k = 0; k < nth; k++) i = text.indexOf(needle, i + 1);
  return 1 + text.slice(s, i).split("\n").length - 1;
}

test("CL-16 the declarations bind to the pinned texts: positions, CONTEXT lines, the executed input; the steps cover the phases, staging only", () => {
  const t3 = ctx.texts["ENVELOPE-PROBE-3"];
  const t5 = ctx.texts["ENVELOPE-PROBE-5"];
  assert.equal(t3.slice(Number(K.STEPS.B3.expect.server.position) - 1).slice(0, 3), "'{'", "B3's position is the literal");
  const p5 = Number(K.STEPS.B5.expect.server.position) - 1;
  assert.equal(t5.slice(p5, p5 + 4), "from");
  assert.ok(t5.indexOf("from") < p5 && t5.indexOf("from", t5.indexOf("from") + 1) === p5, "B5's position is the second from");
  assert.equal(plpgsqlLine(ctx.texts["P2-01"], "raise exception 'stage0 P2-01: release2_01_identity_schema is already in the ledger'"), 312, "the method gives P2-01 send 2's real line");
  const raises = (t) => t.split("raise exception").length - 1;
  const lt = ctx.texts["LOCKPROBE-B-LOCKTIMEOUT"];
  assert.match(K.STEPS.A2.expect.server.where, new RegExp(` line ${plpgsqlLine(lt, "raise exception", raises(lt))} at RAISE$`), "A2: the handler's OTHERS raise");
  const stt = ctx.texts["LOCKPROBE-B-STMTTIMEOUT"];
  assert.match(K.STEPS.A3.expect.server.where, new RegExp(` line ${plpgsqlLine(stt, "raise exception", raises(stt) - 1)} at RAISE$`), "A3: the query_canceled raise");
  assert.match(K.STEPS.T2.expect.server.where, new RegExp(` line ${plpgsqlLine(ctx.texts["LOCKPROBE-B-TXTIMEOUT"], "perform pg_sleep(30)")} at PERFORM$`), "T2: the perform pg_sleep(30)");
  assert.deepEqual(ctx.inputs["ENVELOPE-PROBE-2"], [A.ENVELOPE_PROBE_2_EXECUTED]);
  const b2 = ctx.texts["ENVELOPE-PROBE-2"];
  const lit = b2.slice(b2.indexOf("E'") + 2, b2.indexOf("'; end"));
  assert.equal(lit.split(String.fromCharCode(92) + "n").join("\n"), A.ENVELOPE_PROBE_2_EXECUTED, "probe 2's E-string is its executed input");
  assert.deepEqual(Object.values(K.PHASES).flatMap((p) => p.steps).sort(), Object.keys(K.STEPS).sort(), "every step is in exactly one phase");
  for (const [id, st] of Object.entries(K.STEPS)) {
    assert.ok(M.send.texts[st.text].targets.includes("staging") && !M.send.texts[st.text].targets.includes("production"), `${id}: ${st.text} is staging-only`);
    assert.equal(K.PHASES[st.phase].steps.includes(id), true);
  }
  for (const n of [1, 2, 3, 4, 5]) assert.deepEqual(M.send.texts[`ENVELOPE-PROBE-${n}`], { targets: ["staging"], readOnly: true });
  assert.equal(K.PHASES.B.writes, false);
});

test("CL-17 the command lines: classify exits 0 on R2 only, 1 with an R3, 3 with an UNRESOLVED file, 2 on usage; capture exits 0 on MATCH, 3 otherwise", () => {
  const node = (args) => spawnSync(process.execPath, args, { cwd: ROOT, encoding: "utf8" });
  const CL = join(ROOT, "scripts", "manual", "stage0-classify.mjs");
  const all = node([CL, ...Object.keys(REAL).map((f) => join(FIX, "real", f))]);
  assert.equal(all.status, 1, all.stderr);
  assert.match(all.stdout, /R3 RESOLVED SQL error \| P2-01 -> production \| HTTP 400 \| ERROR P0001: stage0 P2-01: release2_01_identity_schema is already in the ledger/);
  assert.equal(all.stdout.split("\n").filter((l) => l.startsWith("R2 ")).length, 8);
  assert.match(all.stdout, /A classification, not a go\./);
  assert.equal(node([CL, join(FIX, "real", SEND1)]).status, 0);
  const dir = mkdtempSync(join(tmpdir(), "stage0-classify-cli-"));
  try {
    const bad = join(dir, "r4.json");
    writeFileSync(bad, asFile({ ...rec(SEND1), body: "[]" }));
    const r = node([CL, join(FIX, "real", SEND1), bad]);
    assert.equal(r.status, 3);
    assert.match(r.stdout, /runbook STOP-and-review\. No retry, no recovery\./);
    assert.equal(node([CL, join(dir, "missing.json")]).status, 3, "a missing file is R1");
    assert.equal(node([CL]).status, 2);
    const CP = join(ROOT, "scripts", "manual", "stage0-capture.mjs");
    const a1 = join(dir, "a1.json");
    writeFileSync(a1, asFile(declaredReceipt("A1")));
    const ok = node([CP, "A1", a1]);
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    assert.match(ok.stdout, /^MATCH A1 LOCKPROBE-SETUP \| rule 3′: R2 RESOLVED success/);
    const no = node([CP, "A4", a1]);
    assert.equal(no.status, 3);
    assert.match(no.stdout, /The phase ends here/);
    assert.equal(node([CP, "Z9", a1]).status, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("CL-18 classification and step checks make no network call", () => {
  const saved = globalThis.fetch;
  globalThis.fetch = () => { throw new Error("a network call was made"); };
  try {
    for (const f of Object.keys(REAL)) C.classifyText(real(f), ctx);
    for (const id of Object.keys(K.STEPS)) check(id, declaredReceipt(id));
  } finally { globalThis.fetch = saved; }
});
