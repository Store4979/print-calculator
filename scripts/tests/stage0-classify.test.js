// scripts/tests/stage0-classify.test.js — rule 3′, the stage-0 send classifier
// (scripts/manual/stage0-classify.mjs), and the item 2 capture session's
// executable stop rules (scripts/manual/stage0-capture.mjs). Classifier plan
// §5. No test here reaches the network or a database.
//
//   CL-1  history and the capture: the 24 held receipts classify as on record
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
//   CL-19 K-R1: a timestamp that parses to no time is R1 everywhere: the
//         library, the classify CLI (exit 3) and the capture checker (STOP)
//   CL-20 a defect inside a check is R1 or STOP, never an uncaught exception
//   CL-21 STOP-RECORD claims only the severity, SQLSTATE and primary text
//   CL-22 the progression gate: NEXT, COMPLETE and every stop, freshness and
//         single use included
//   CL-23 the gate's command line
//   CL-24 the capture's 15 receipts: each step's MATCH now; L's classes kept
//   CL-25 the recorded progression of B, A, T and U replays through the gate
//   CL-26 a PERFORM query binds to its own text; a statement frame pairs with
//         the frame of the statement that ran it
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
const HELD = {
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
// The item 2 capture's receipts on staging (plan §E14), by step: the file,
// its md5, the class the capture commit gives it, and the class rule 3′ gave
// it at L (1042d2c), which the capture records keep.
const CAPTURE = {
  B1: ["2026-10-22T15-35-38-187Z_ENVELOPE-PROBE-1_staging.json", "e95f621b69c39af28d85196c5c9daf45", "R3", "R4"],
  B2: ["2026-10-22T15-43-05-120Z_ENVELOPE-PROBE-2_staging.json", "47303b3eb7b022f87cbfc5d9e934ed19", "R3", "R4"],
  B3: ["2026-10-22T15-43-57-386Z_ENVELOPE-PROBE-3_staging.json", "94f373a573429158ef476acb39d03b54", "R4", "R4"],
  B4: ["2026-10-22T15-44-50-624Z_ENVELOPE-PROBE-4_staging.json", "1f159c49497390bbd1d7d42e3e0e8964", "R3", "R4"],
  B5: ["2026-10-22T15-45-41-244Z_ENVELOPE-PROBE-5_staging.json", "777a619451a5b8a8c4967e234011aca5", "R4", "R4"],
  A1: ["2026-10-22T16-40-36-989Z_LOCKPROBE-SETUP_staging.json", "cd8bb95e58c29165d7563962e30ebc10", "R2", "R2"],
  A2: ["2026-10-22T16-41-36-172Z_LOCKPROBE-B-LOCKTIMEOUT_staging.json", "a54661da84ebe306c517752a9bfa047b", "R3", "R3"],
  A3: ["2026-10-22T16-45-58-150Z_LOCKPROBE-B-STMTTIMEOUT_staging.json", "226de5fcaca12f4ccb7cc14f440d7106", "R3", "R3"],
  A4: ["2026-10-22T16-48-07-410Z_LOCKPROBE-B-POSITIVE_staging.json", "60a5535dd8cd80c2462b0b3ac5f4ad1b", "R2", "R2"],
  A5: ["2026-10-22T16-50-51-100Z_LOCKPROBE-READBACK_staging.json", "82eaa0daa19d6b64eff5aee01a0c0635", "R2", "R2"],
  A6: ["2026-10-22T16-51-47-129Z_LOCKPROBE-CLEANUP_staging.json", "713ef03d32bd141c0a5d25e43912223d", "R2", "R2"],
  T1: ["2026-10-23T15-27-47-027Z_LOCKPROBE-SETUP_staging.json", "ff576ccebc8d4339095db05193948b4a", "R2", "R2"],
  T2: ["2026-10-23T15-31-55-289Z_LOCKPROBE-B-TXTIMEOUT_staging.json", "c40698a74e7ed9e714d75f2ae7989ebc", "R3", "R4"],
  U1: ["2026-10-27T14-29-34-831Z_LOCKPROBE-READBACK_staging.json", "8bb00312b3654b04c93c9b99bb01255d", "R2", "R2"],
  U2: ["2026-10-27T14-31-49-148Z_LOCKPROBE-CLEANUP_staging.json", "028abf34e66eae4ca23ec475ebe1280e", "R2", "R2"],
};
const REAL = { ...HELD, ...Object.fromEntries(Object.values(CAPTURE).map(([f, md5, now]) => [f, [md5, now]])) };
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

test("CL-1 history and the capture: the 24 held receipts classify as on record (the nine before the capture unchanged; the capture's as Codex's review §2 rules)", () => {
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
  // The capture's new forms, element by element.
  const sq = (id) => C.classifyText(real(CAPTURE[id][0]), ctx);
  assert.deepEqual(sq("B1").sqlError, { severity: "ERROR", sqlstate: "22012", primary: "division by zero", context: [] });
  assert.deepEqual(sq("B2").sqlError.context, [
    { kind: "sqlstmt", via: "EXECUTE", input: 0, md5: A.md5(A.ENVELOPE_PROBE_2_EXECUTED) },
    { kind: "plpgsql", fname: "inline_code_block", line: 1, stmt: "EXECUTE" },
  ]);
  assert.deepEqual(sq("B4").sqlError, { severity: "ERROR", sqlstate: "P0001", primary: "probe", detail: "d", hint: "h", context: [{ kind: "plpgsql", fname: "inline_code_block", line: 1, stmt: "RAISE" }] });
  const t2 = sq("T2");
  assert.deepEqual(t2.sqlError, {
    severity: "FATAL", sqlstate: "25P04", primary: "terminating connection due to transaction timeout",
    context: [
      { kind: "sqlstmt", via: "PERFORM", input: 1, md5: A.md5("SELECT pg_sleep(30)") },
      { kind: "plpgsql", fname: "inline_code_block", line: 33, stmt: "PERFORM" },
    ],
  });
  assert.equal(t2.writing, true);
  for (const id of ["B3", "B5"]) assert.match(sq(id).reasons[0], /a LINE position block is not supported/, id);
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
  // Every SUPPORT entry and PERFORM binding names the receipt that shows it:
  // each receipt time in it is a fixture's.
  const leaves = (o) => (typeof o === "string" ? [o] : o && typeof o === "object" ? Object.values(o).flatMap(leaves) : []);
  const stamps = (w) => w.match(/[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z/g) || [];
  const witnesses = [...leaves(C.SUPPORT), ...Object.values(C.PERFORM_QUERIES).flat().map((e) => e.witness), ...leaves(C.OBSERVED_STATUSES)];
  assert.equal(witnesses.length, 13, "11 SUPPORT entries, 1 PERFORM binding, 1 status");
  for (const w of witnesses) {
    assert.ok(stamps(w).length, `a witness without a receipt time: ${w}`);
    for (const t of stamps(w)) assert.ok(Object.keys(REAL).some((f) => f.startsWith(t.split(":").join("-").split(".").join("-"))), `${t}: no fixture holds that receipt`);
  }
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
const EX = (sql) => ({ sql, via: "EXECUTE" });
const PF = (sql) => ({ sql, via: "PERFORM" });
const PROBE2 = A.ENVELOPE_PROBE_2_EXECUTED;
const SLEEP = "SELECT pg_sleep(30)";
const sqlFrame = (sql, stmt) => `CONTEXT:  SQL statement "${sql}"\nPL/pgSQL function inline_code_block line 1 at ${stmt}\n`;
// Each case: the message, its candidates, and whether the grammar accepts it
// under FULL (every element enabled) and under the capture commit's SUPPORT.
const GRAMMAR = [
  ["the real P0001", M2, [], true, true],
  ["field-less", `${P}ERROR:  22012: division by zero\n`, [], true, true],
  ["a SQL statement frame quoting a pinned input", `${P}ERROR:  22012: division by zero\n${sqlFrame(PROBE2, "EXECUTE")}`, [EX(PROBE2)], true, true],
  ["a pinned input that itself holds a quote, a newline and a PL/pgSQL-looking line", `${P}ERROR:  22012: division by zero\n${sqlFrame(TRAP, "EXECUTE")}`, [EX(TRAP)], true, true],
  ["DETAIL, HINT, CONTEXT in order", `${P}ERROR:  P0001: probe\nDETAIL:  d\nHINT:  h\nCONTEXT:  PL/pgSQL function inline_code_block line 1 at RAISE\n`, [], true, true],
  ["FATAL", `${P}FATAL:  25P04: terminating connection due to transaction timeout\n`, [], true, true],
  ["T2's form: a PERFORM query, then its PERFORM frame", `${P}FATAL:  25P04: terminating connection due to transaction timeout\n${sqlFrame(SLEEP, "PERFORM")}`, [PF(SLEEP)], true, true],
  ["a single-line QUERY", `${P}ERROR:  P0001: x\nQUERY:  select 1\nCONTEXT:  PL/pgSQL function inline_code_block line 1 at RAISE\n`, [], true, false],
  ["a PERFORM query offered as an EXECUTE input", `${P}FATAL:  25P04: x\n${sqlFrame(SLEEP, "PERFORM")}`, [EX(SLEEP)], false, false],
  ["an executed input followed by a PERFORM frame", `${P}ERROR:  22012: x\n${sqlFrame(PROBE2, "PERFORM")}`, [EX(PROBE2)], false, false],
  ["a statement frame followed by a RAISE frame", `${P}ERROR:  22012: x\n${sqlFrame(PROBE2, "RAISE")}`, [EX(PROBE2)], false, false],
  ["an EXECUTE frame with no statement frame before it", `${P}ERROR:  22012: x\nCONTEXT:  PL/pgSQL function inline_code_block line 1 at EXECUTE\n`, [], false, false],
  ["a PERFORM frame with no statement frame before it", `${P}FATAL:  25P04: x\nCONTEXT:  PL/pgSQL function inline_code_block line 33 at PERFORM\n`, [], false, false],
  ["a statement frame with nothing after it", `${P}ERROR:  22012: x\nCONTEXT:  SQL statement "${PROBE2}"\n`, [EX(PROBE2)], false, false],
  ["two statement frames in a row", `${P}ERROR:  22012: x\nCONTEXT:  SQL statement "a"\nSQL statement "b"\nPL/pgSQL function inline_code_block line 1 at EXECUTE\n`, [EX("a"), EX("b")], false, false],
  ["a LINE position block", JSON.parse(rec(CAPTURE.B5[0]).body).message, [], false, false],
  ["fields out of order", `${P}ERROR:  P0001: probe\nHINT:  h\nDETAIL:  d\n`, [], false, false],
  ["a repeated field", `${P}ERROR:  P0001: probe\nDETAIL:  d\nDETAIL:  e\n`, [], false, false],
  ["an unknown label", `${P}ERROR:  P0001: probe\nNOTE:  n\n`, [], false, false],
  ["one space after ERROR:", `${P}ERROR: P0001: probe\n`, [], false, false],
  ["a lowercase SQLSTATE", `${P}ERROR:  p0001: probe\n`, [], false, false],
  ["a four-character SQLSTATE", `${P}ERROR:  P001: probe\n`, [], false, false],
  ["no prefix", `ERROR:  P0001: probe\n`, [], false, false],
  ["a prefixed prefix", `proxy: ${P}ERROR:  P0001: probe\n`, [], false, false],
  ["a SQL statement frame quoting no pinned input", `${P}ERROR:  22012: division by zero\n${sqlFrame("select 1/0;", "EXECUTE")}`, [EX(PROBE2)], false, false],
  ["junk after the last frame", `${M2}junk\n`, [], false, false],
  ["junk after the last field", `${P}ERROR:  P0001: probe\nDETAIL:  d\njunk\n`, [], false, false],
  ["a second primary line", `${P}ERROR:  P0001: probe\nERROR:  P0001: again\n`, [], false, false],
  ["an empty primary text", `${P}ERROR:  P0001: \n`, [], false, false],
  ["a frame of an unknown kind", `${P}ERROR:  22P02: invalid input syntax for type json\nCONTEXT:  JSON data, line 1: {\n`, [], false, false],
  ["a function name that is not supported", `${P}ERROR:  P0001: x\nCONTEXT:  PL/pgSQL function f() line 1 at RAISE\n`, [], false, false],
  ["a seven-digit line", `${P}ERROR:  P0001: x\nCONTEXT:  PL/pgSQL function inline_code_block line 1234567 at RAISE\n`, [], false, false],
  ["seventeen frames", `${P}ERROR:  P0001: x\nCONTEXT:  ${Array(17).fill("PL/pgSQL function inline_code_block line 1 at RAISE").join("\n")}\n`, [], false, false],
  ["a primary text over 8 KiB", `${P}ERROR:  P0001: ${"x".repeat(8 * 1024 + 1)}\n`, [], false, false],
  ["a message over the bound", `${P}ERROR:  P0001: x\nDETAIL:  ${"x".repeat(8000)}\n`.repeat(9), [], false, false],
];

test("CL-10 the envelope grammar: its accepted forms, its edges and bounds; the capture commit's SUPPORT admits the captured elements and nothing else", () => {
  for (const [name, m, candidates, ok] of GRAMMAR) assert.equal(C.parseEnvelope(m, { candidates, support: FULL }).ok, ok, `${name} (FULL)`);
  for (const [name, m, candidates, , okSupport] of GRAMMAR) assert.equal(C.parseEnvelope(m, { candidates }).ok, okSupport, `${name} (SUPPORT)`);
  // What stays out, by name (Codex's capture review §2).
  assert.match(C.parseEnvelope(`${P}ERROR:  P0001: x\nQUERY:  q\n`).why, /the field QUERY is not supported yet/);
  assert.match(C.parseEnvelope(JSON.parse(rec(CAPTURE.B3[0]).body).message).why, /a LINE position block is not supported/);
  assert.match(C.parseEnvelope(`${P}ERROR:  22P02: x\nDETAIL:  d\nCONTEXT:  JSON data, line 1: {\n`).why, /a frame of a kind that is not supported/);
  assert.match(C.parseEnvelope(`${P}ERROR:  P0001: x\nCONTEXT:  PL/pgSQL function f() line 1 at RAISE\n`).why, /function is not a supported name/);
  assert.match(C.parseEnvelope(`${P}ERROR:  P0001: x\nCONTEXT:  PL/pgSQL function inline_code_block line 1 at FETCH\n`).why, /statement kind that is not supported/);
  assert.match(C.parseEnvelope(`${P}PANIC:  XX000: x\n`).why, /no ERROR or FATAL/);
  // Through P2-01 send 2's receipt, under the observed status: a refusal is
  // R4, and an accepted form that needs no candidate is R3. A statement frame
  // quotes no input of P2-01's, so it is R4 there.
  const s2 = rec(SEND2);
  for (const [name, m, candidates, , okSupport] of GRAMMAR) {
    if (!okSupport) assert.equal(cls({ ...s2, body: env(m) }).class, "R4", name);
    else if (!candidates.length) assert.equal(cls({ ...s2, body: env(m) }).class, "R3", name);
    else assert.equal(cls({ ...s2, body: env(m) }).class, "R4", `${name}, under another text`);
  }
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
  ["the pinned sqltext", [["      const hits = candidates.map((c, n) => ({ c, n })).filter(({ c }) => m.startsWith(`${c.sql}\"" + String.fromCharCode(92) + "n`, start));", "      const e = m.indexOf('\"' + String.fromCharCode(10), start); const hits = e < 0 ? [] : [{ c: { sql: m.slice(start, e), via: \"EXECUTE\" }, n: -1 }];"]], "a SQL statement frame quoting no pinned input"],
  ["the candidate-first match", [["      const hits = candidates.map((c, n) => ({ c, n })).filter(({ c }) => m.startsWith(`${c.sql}\"" + String.fromCharCode(92) + "n`, start));", "      const e = m.indexOf('\"' + String.fromCharCode(10), start); const hits = candidates.map((c, n) => ({ c, n })).filter(({ c }) => e >= 0 && m.slice(start, e) === c.sql);"]], "a pinned input that itself holds a quote, a newline and a PL/pgSQL-looking line"],
  ["the statement that ran it", [["        if (fx.stmt !== ran) return no(`the frame after a SQL statement frame is at ${fx.stmt}, not at the ${ran} that ran that candidate`);\n", ""]], "a PERFORM query offered as an EXECUTE input"],
  ["a statement frame's PL/pgSQL frame", [["    if (ran) return no(\"a SQL statement frame with no PL/pgSQL frame after it\");\n", ""]], "a statement frame with nothing after it"],
  ["an EXECUTE or PERFORM frame's statement frame", [["      } else if (RUNS_SQL.includes(fx.stmt)) {\n        return no(`a frame at ${fx.stmt} without the SQL statement frame of the query it ran`);\n      }", "      }"]], "an EXECUTE frame with no statement frame before it"],
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
  // As 400 receipts of their texts: the two re-raised errors are R3, and so,
  // since the capture commit, is the FATAL (R4 at L).
  const as400 = (text, m) => cls(receiptFor(text, "staging", 400, env(m))).class;
  assert.equal(as400("LOCKPROBE-B-LOCKTIMEOUT", HIST["2026-09-29T16:30:37.252Z"].message), "R3");
  assert.equal(as400("LOCKPROBE-B-LOCKTIMEOUT", HIST["2026-09-29T16:38:55.436Z"].message), "R3", "55P03, re-raised, is the same envelope shape");
  assert.equal(as400("LOCKPROBE-B-STMTTIMEOUT", HIST["2026-09-29T16:39:58.546Z"].message), "R3");
  assert.equal(as400("LOCKPROBE-B-TXTIMEOUT", HIST["2026-09-29T16:45:30.271Z"].message), "R3", "the FATAL with its bound PERFORM query");
  assert.equal(HIST["2026-09-29T16:45:30.271Z"].message, JSON.parse(rec(CAPTURE.T2[0]).body).message, "T2's receipt says exactly what N5 saw");
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

test("CL-15 nextStep: only a MATCH continues; a STOP ends the phase; a MATCH of a writing send rule 3′ calls UNRESOLVED ends it too (T2 at L)", () => {
  const ok = (id) => check(id, declaredReceipt(id));
  assert.deepEqual(K.nextStep("B", []), { stop: false, next: "B1" });
  assert.deepEqual(K.nextStep("B", ["B1", "B2"].map(ok)), { stop: false, next: "B3" });
  assert.deepEqual(K.nextStep("B", K.PHASES.B.steps.map(ok)), { stop: false, next: null });
  assert.deepEqual(K.nextStep("A", K.PHASES.A.steps.map(ok)), { stop: false, next: null });
  const a2stop = check("A2", { ...declaredReceipt("A2"), body: env(`${P}ERROR:  42501: permission denied\n`) });
  const s = K.nextStep("A", [ok("A1"), a2stop]);
  assert.equal(s.stop, true);
  assert.match(s.reason, /A2 was STOP: the phase ends here\. No later step of phase A is sent, cleanup included, until a reviewed decision/);
  assert.deepEqual(K.nextStep("T", ["T1", "T2"].map(ok)), { stop: false, next: null }, "T2 is R3 since the capture commit, so T completes");
  // The rule, as it applied to T2 at L: a writing send's MATCH that rule 3′
  // calls UNRESOLVED ends the phase. A read-only one does not (B at L).
  const unresolved = (r) => ({ ...r, classification: { ...r.classification, class: "R4", outcome: "UNRESOLVED" } });
  const t = K.nextStep("T", [ok("T1"), unresolved(ok("T2"))]);
  assert.equal(t.stop, true, "T2 matched, and still ended the phase");
  assert.match(t.reason, /writing send that rule 3′ classifies UNRESOLVED \(R4\)/);
  assert.deepEqual(K.nextStep("B", [unresolved(ok("B1"))]), { stop: false, next: "B2" });
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
  const held = node([CL, ...Object.keys(HELD).map((f) => join(FIX, "real", f))]);
  assert.equal(held.status, 1, held.stderr);
  assert.match(held.stdout, /R3 RESOLVED SQL error \| P2-01 -> production \| HTTP 400 \| ERROR P0001: stage0 P2-01: release2_01_identity_schema is already in the ledger/);
  assert.equal(held.stdout.split("\n").filter((l) => l.startsWith("R2 ")).length, 8);
  assert.match(held.stdout, /A classification, not a go\./);
  const all = node([CL, ...Object.keys(REAL).map((f) => join(FIX, "real", f))]);
  assert.equal(all.status, 3, "B3 and B5 are R4");
  const count = (c) => all.stdout.split("\n").filter((l) => l.startsWith(`${c} `)).length;
  assert.deepEqual([count("R2"), count("R3"), count("R4"), count("R1")], [15, 7, 2, 0]);
  assert.match(all.stdout, /R3 RESOLVED SQL error \| LOCKPROBE-B-TXTIMEOUT -> staging \| HTTP 400 \| FATAL 25P04: terminating connection due to transaction timeout/);
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

// Codex's two forms (review of df401b3, K-R1): each matches the ISO pattern
// and parses to no time. Before L they threw RangeError out of the R1 checks.
const BAD_TIMES = ["2026-13-09T15:17:05.343Z", "2026-10-09T25:17:05.343Z"];

test("CL-19 K-R1: an invalid month or hour in startedAt or finishedAt is R1, from the library, the classify CLI (exit 3) and the capture checker (STOP)", () => {
  const node = (args) => spawnSync(process.execPath, args, { cwd: ROOT, encoding: "utf8" });
  const dir = mkdtempSync(join(tmpdir(), "stage0-classify-kr1-"));
  try {
    for (const field of ["startedAt", "finishedAt"]) {
      for (const bad of BAD_TIMES) {
        const why = `${field} = ${bad}`;
        const c = cls({ ...rec(SEND1), [field]: bad });
        assert.equal(c.class, "R1", why);
        assert.ok(c.reasons.includes(`the field ${field} has the wrong type or form`), `${why}: the timestamp check itself refuses it, not the safety net`);
        const f = join(dir, `${field}-${bad.slice(5, 7)}-${bad.slice(11, 13)}.json`);
        writeFileSync(f, asFile({ ...rec(SEND1), [field]: bad }));
        const r = node([join(ROOT, "scripts", "manual", "stage0-classify.mjs"), f]);
        assert.equal(r.status, 3, `${why}: the CLI exits 3 (${r.stderr})`);
        assert.match(r.stdout, new RegExp(`^R1 UNRESOLVED \\| P2-01 -> production \\| HTTP 201 \\| .*the field ${field} has the wrong type or form`), why);
        const s = check("A1", { ...declaredReceipt("A1"), [field]: bad });
        assert.equal(s.verdict, "STOP", `${why}: the capture checker stops`);
        const a1 = join(dir, `a1-${field}-${bad.slice(5, 7)}.json`);
        writeFileSync(a1, asFile({ ...declaredReceipt("A1"), [field]: bad }));
        const cp = node([join(ROOT, "scripts", "manual", "stage0-capture.mjs"), "A1", a1]);
        assert.equal(cp.status, 3, `${why}: the capture CLI exits 3 (${cp.stderr})`);
        assert.match(cp.stdout, /^STOP A1 LOCKPROBE-SETUP \| the receipt does not bind \(R1\)/, why);
      }
    }
    // Kept: a reversed pair and a calendar date that normalizes are still R1.
    r1({ ...rec(SEND1), finishedAt: "2026-10-09T15:17:04.000Z" }, "a reversed pair");
    r1({ ...rec(SEND1), startedAt: "2026-02-30T15:17:05.343Z" }, "a normalized invalid calendar date");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("CL-20 a defect inside a check is R1 or STOP with its message, never an uncaught exception", () => {
  const broken = { ...ctx, inputs: new Proxy({}, { get() { throw new Error("planted defect"); } }) };
  const c = C.classifyText(asFile(rec(SEND2)), broken);
  assert.equal(c.class, "R1");
  assert.match(c.reasons[0], /the classifier could not complete \(Error: planted defect\); a tooling defect, for review/);
  const s = K.checkStep("A2", asFile(declaredReceipt("A2")), { ...ctx, texts: new Proxy(ctx.texts, { get(t, k) { if (k === "LOCKPROBE-B-LOCKTIMEOUT") throw new Error("planted defect"); return t[k]; } }) });
  assert.equal(s.verdict, "STOP");
  assert.ok(s.reasons.some((x) => /could not complete|does not bind/.test(x)), JSON.stringify(s.reasons));
  assert.throws(() => K.checkStep("Z9", "{}", ctx), /unknown step/, "only an unknown step id throws");
});

test("CL-21 STOP-RECORD claims only the severity, SQLSTATE and primary text; the path and rendering stay unconfirmed", () => {
  // Codex's example: B2 with its primary line and none of its frames.
  const r = check("B2", declaredReceipt("B2", { body: env(`${P}ERROR:  22012: division by zero\n`) }));
  assert.equal(r.verdict, "STOP-RECORD");
  assert.match(r.reasons[0], /starts with the expected ERROR 22012 and primary text, but the receipt is not the declared one .*; the path and the rendering are unconfirmed, for review/);
  assert.ok(!/path (was|were) reached/.test(r.reasons[0]), "it never claims the path");
});

// ── the progression gate ────────────────────────────────────────────────────

const GO = "2026-10-21T16:00:00Z";
const DEADLINE = "2026-10-21T17:00:00Z";
const NOW = Date.parse("2026-10-21T16:30:00.000Z");
/** A results file as the sender would write it for a step: its name and its exact text. */
function sent(id, startedAt, over = {}) {
  const finishedAt = new Date(Date.parse(startedAt) + 1500).toISOString();
  const r = declaredReceipt(id, { startedAt, finishedAt, ...over });
  return { file: `.stage0-send/${K.senderFileName(r)}`, text: asFile(r) };
}
/** Entries for consecutive steps: each issued at :m0 past the minute grid, each receipt 5 s later. */
function run(ids, firstMinute = 1) {
  return ids.map((id, n) => {
    const issuedAt = `2026-10-21T16:${String(firstMinute + n).padStart(2, "0")}:00Z`;
    return { step: id, issuedAt, ...sent(id, `2026-10-21T16:${String(firstMinute + n).padStart(2, "0")}:05.000Z`) };
  });
}
const gate = (phase, entries, over = {}) => K.progress({ phase, goAt: GO, deadline: DEADLINE, now: NOW, entries, ...over }, ctx);

test("CL-22 the progression gate names the one next step, COMPLETE, or the stop; freshness and single use included", () => {
  assert.deepEqual([gate("B", []).next, gate("B", []).stop], ["B1", false], "before the first send");
  assert.equal(gate("B", run(["B1", "B2"])).next, "B3");
  const all = gate("B", run(K.PHASES.B.steps));
  assert.equal(all.complete, true);
  assert.equal(all.next, null);
  assert.equal(gate("A", run(K.PHASES.A.steps)).complete, true);
  // The go and the deadline.
  assert.match(gate("B", [], { now: Date.parse(DEADLINE) }).reason, /the deadline .* has passed/);
  assert.match(gate("B", [], { now: Date.parse(GO) - 1 }).reason, /the go is in the future/);
  assert.match(gate("B", [], { deadline: GO }).reason, /the deadline is not after the go/);
  assert.match(gate("B", [], { goAt: "2026-10-21 16:00" }).reason, /absolute UTC times/);
  assert.match(gate("B", [], { goAt: "2026-13-21T16:00:00Z" }).reason, /absolute UTC times/, "the gate's time check is total too");
  assert.match(gate("Q", []).reason, /unknown phase/);
  // Order and binding.
  const [b1, b2] = run(["B1", "B2"]);
  assert.match(gate("B", [b2, b1]).reason, /is given as B2; step 1 of phase B is B1/);
  assert.match(gate("B", [{ ...b1, file: ".stage0-send/renamed.json" }]).reason, /the file name is not the sender's/);
  assert.match(gate("B", [{ ...b1, text: null }]).reason, /missing or unreadable/);
  assert.match(gate("B", [{ ...b1, issuedAt: "16:01" }]).reason, /the issue time is not an absolute UTC time/);
  // Freshness: before the go, before its command, overlapping the previous one, after now.
  const early = { step: "B1", issuedAt: "2026-10-21T15:59:00Z", ...sent("B1", "2026-10-21T15:59:05.000Z") };
  assert.match(gate("B", [early]).reason, /issued before the phase's go/);
  assert.match(gate("B", [{ ...b1, issuedAt: "2026-10-21T16:01:10Z" }]).reason, /started before its command was issued/);
  assert.match(gate("B", [b1, { ...b2, issuedAt: "2026-10-21T16:01:06Z" }]).reason, /issued before the previous receipt finished/);
  const late = { step: "B1", issuedAt: "2026-10-21T16:40:00Z", ...sent("B1", "2026-10-21T16:40:05.000Z") };
  assert.match(gate("B", [late]).reason, /finished after now/);
  // Single use. Inside one phase every step sends a different text, so a
  // receipt can match one step at most; a results file offered again is
  // refused outright. A phase that repeated a step (none does) shows it.
  for (const [ph, p] of Object.entries(K.PHASES)) assert.equal(new Set(p.steps.map((s) => K.STEPS[s].text)).size, p.steps.length, `phase ${ph}: distinct texts`);
  const a1 = run(["A1"])[0];
  K.PHASES.X = { steps: ["A1", "A1"], token: "test only", writes: true };
  try {
    const again = { ...a1, issuedAt: "2026-10-21T16:02:00Z" };
    assert.match(gate("X", [a1, again]).reason, /already used in this phase/);
  } finally { delete K.PHASES.X; }
  // An old receipt cannot open a new phase: A's SETUP receipt offered as T1 under T's later go.
  assert.match(gate("T", [{ ...a1, step: "T1" }], { goAt: "2026-10-21T16:20:00Z" }).reason, /issued before the phase's go/);
  // A stop from a check.
  const bad = { ...run(["A1"])[0], ...sent("A1", "2026-10-21T16:01:05.000Z", { body: "[]" }) };
  const s = gate("A", [bad]);
  assert.equal(s.stop, true);
  assert.match(s.reason, /A1 was STOP: the phase ends here\. No later step of phase A is sent, cleanup included, until a reviewed decision/);
  // T completes now that T2 is R3 (it stopped at L); U still needs a reviewed decision named.
  assert.equal(gate("T", run(["T1", "T2"])).complete, true);
  assert.match(gate("U", []).reason, /phase U needs a reviewed decision on T2's receipt; none is named/);
  assert.equal(gate("U", [], { reviewed: "Codex's disposition of T2, reviews/<file>" }).next, "U1");
  assert.match(gate("B", run(["B1", "B2", "B3", "B4", "B5", "B1"])).reason, /more results files than phase B has steps/);
});

test("CL-23 the gate's command line: NEXT exits 0, COMPLETE 4, a stop 3, usage 2", () => {
  const node = (args) => spawnSync(process.execPath, args, { cwd: ROOT, encoding: "utf8" });
  const CP = join(ROOT, "scripts", "manual", "stage0-capture.mjs");
  const now = Date.now();
  const iso = (ms) => new Date(ms).toISOString();
  const go = iso(now - 3600e3).replace(/\.\d{3}Z$/, "Z");
  const deadline = iso(now + 3600e3).replace(/\.\d{3}Z$/, "Z");
  const dir = mkdtempSync(join(tmpdir(), "stage0-gate-cli-"));
  try {
    const entries = K.PHASES.B.steps.map((id, n) => {
      const issued = now - 3000e3 + n * 60e3;
      const r = declaredReceipt(id, { startedAt: iso(issued + 5e3), finishedAt: iso(issued + 6e3) });
      const f = join(dir, K.senderFileName(r));
      writeFileSync(f, asFile(r));
      return `${id}=${f}@${iso(issued)}`;
    });
    const two = node([CP, "--progress", "B", "--go", go, "--deadline", deadline, ...entries.slice(0, 2)]);
    assert.equal(two.status, 0, two.stdout + two.stderr);
    assert.match(two.stdout, /^ {2}MATCH B1 ENVELOPE-PROBE-1$/m);
    assert.match(two.stdout, /^NEXT: B3 may be sent next: ENVELOPE-PROBE-3 to staging, before /m);
    const all = node([CP, "--progress", "B", "--go", go, "--deadline", deadline, ...entries]);
    assert.equal(all.status, 4, all.stdout);
    assert.match(all.stdout, /^COMPLETE: phase B is complete/m);
    const past = node([CP, "--progress", "B", "--go", go, "--deadline", iso(now - 60e3).replace(/\.\d{3}Z$/, "Z"), ...entries.slice(0, 1)]);
    assert.equal(past.status, 3);
    assert.match(past.stdout, /^STOP: /m);
    assert.equal(node([CP, "--progress", "B", "--go", go]).status, 2, "no deadline");
    assert.equal(node([CP, "--progress", "B", "--go", go, "--deadline", deadline, "B1-no-separators"]).status, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── the capture's receipts ──────────────────────────────────────────────────

// SUPPORT as it stood at L (1042d2c): P2-01 send 2's form only.
const SUPPORT_AT_L = {
  severities: { ERROR: "L" }, fieldless: null, fields: { CONTEXT: "L" },
  frames: { plpgsql: { fnames: { inline_code_block: "L" }, stmts: { RAISE: "L" } }, sqlstmt: null },
};

test("CL-24 the capture's 15 receipts: each is its step's MATCH, with the class the capture commit gives it; L's SUPPORT gives the class recorded at L", () => {
  assert.deepEqual(Object.keys(CAPTURE), Object.values(K.PHASES).flatMap((p) => p.steps), "one receipt per step, in phase order");
  for (const [id, [f, , now, atL]] of Object.entries(CAPTURE)) {
    const r = K.checkStep(id, real(f), ctx);
    assert.equal(r.verdict, "MATCH", `${id}: ${r.reasons.join("; ")}`);
    assert.equal(r.classification.class, now, id);
    assert.equal(K.STEPS[id].classNow, now, `${id}: the declared class`);
    const x = rec(f);
    assert.equal(x.text, K.STEPS[id].text, id);
    if (x.httpStatus === 400) {
      const okAtL = C.parseEnvelope(JSON.parse(x.body).message, { candidates: C.candidatesFor(ctx, x.text), support: SUPPORT_AT_L }).ok;
      assert.equal(okAtL ? "R3" : "R4", atL, `${id}: its class at L`);
    } else assert.equal(atL, now, `${id}: a success's class is unchanged`);
  }
});

// The gos, deadlines and command issue times of the four phases, as the
// capture records give them (plan §E14), and the time of each phase's final
// gate.
const RECORDED = {
  B: { go: "2026-10-22T15:32:37Z", deadline: "2026-10-22T20:00:00Z", final: "2026-10-22T15:46:01Z", issued: ["15:32:40", "15:36:36", "15:43:31", "15:44:21", "15:45:19"], day: "2026-10-22" },
  A: { go: "2026-10-22T16:22:22Z", deadline: "2026-10-22T18:00:00Z", final: "2026-10-22T16:52:10Z", issued: ["16:38:26", "16:40:58", "16:44:25", "16:46:29", "16:48:35", "16:51:16"], day: "2026-10-22" },
  T: { go: "2026-10-23T15:23:53Z", deadline: "2026-10-23T16:15:00Z", final: "2026-10-23T15:32:30Z", issued: ["15:26:05", "15:28:21"], day: "2026-10-23" },
  U: { go: "2026-10-27T14:22:49Z", deadline: "2026-10-27T15:06:00Z", final: "2026-10-27T14:32:10Z", issued: ["14:28:23", "14:29:59"], day: "2026-10-27", reviewed: "reviews/2026-10-23-capture-BAT-review.md" },
};

test("CL-25 the recorded progression replays through the gate: NEXT for each step at its issue time, then COMPLETE (T stopped after T2 at L; it completes now)", () => {
  for (const [phase, r] of Object.entries(RECORDED)) {
    const steps = K.PHASES[phase].steps;
    assert.equal(r.issued.length, steps.length, phase);
    const entries = steps.map((id, n) => ({ step: id, file: `.stage0-send/${CAPTURE[id][0]}`, text: real(CAPTURE[id][0]), issuedAt: `${r.day}T${r.issued[n]}Z` }));
    const at = (iso) => ({ phase, goAt: r.go, deadline: r.deadline, now: Date.parse(iso), reviewed: r.reviewed ?? null });
    for (const [n, id] of steps.entries()) {
      const g = K.progress({ ...at(entries[n].issuedAt), entries: entries.slice(0, n) }, ctx);
      assert.equal(g.next, id, `${phase}: the gate before ${id} (${g.reason})`);
    }
    const end = K.progress({ ...at(r.final), entries }, ctx);
    assert.equal(end.complete, true, `${phase}: ${end.reason}`);
  }
  // The same receipts cannot open a later phase, or be offered twice.
  const u = RECORDED.U;
  const a5asU1 = [{ step: "U1", file: `.stage0-send/${CAPTURE.A5[0]}`, text: real(CAPTURE.A5[0]), issuedAt: "2026-10-27T14:28:23Z" }];
  assert.equal(K.progress({ phase: "U", goAt: u.go, deadline: u.deadline, now: Date.parse(u.final), reviewed: u.reviewed, entries: a5asU1 }, ctx).stop, true, "A5's READBACK (the DDL committed) is not U1's");
  const u1early = [{ step: "U1", file: `.stage0-send/${CAPTURE.U1[0]}`, text: real(CAPTURE.U1[0]), issuedAt: "2026-10-27T14:22:00Z" }];
  assert.match(K.progress({ phase: "U", goAt: u.go, deadline: u.deadline, now: Date.parse(u.final), reviewed: u.reviewed, entries: u1early }, ctx).reason, /issued before the phase's go/);
});

test("CL-26 a PERFORM query is a candidate for its own text only, bound to its one source; a statement frame pairs with the frame of the statement that ran it", () => {
  assert.deepEqual(ctx.performs, { "LOCKPROBE-B-TXTIMEOUT": [SLEEP] });
  assert.deepEqual(C.candidatesFor(ctx, "LOCKPROBE-B-TXTIMEOUT").map((c) => c.via), ["EXECUTE", "PERFORM"]);
  assert.deepEqual(C.candidatesFor(ctx, "P1").map((c) => c.via), Array(10).fill("EXECUTE"), "P1's PERFORMs have no entry");
  // T2's exact message, under other texts' receipts: no bound candidate there.
  const t2 = rec(CAPTURE.T2[0]);
  for (const text of ["LOCKPROBE-B-STMTTIMEOUT", "LOCKPROBE-B-LOCKTIMEOUT"]) assert.equal(cls(receiptFor(text, "staging", 400, t2.body)).class, "R4", text);
  for (const text of ["P2-01", "RB-43", "P1"]) assert.equal(cls(receiptFor(text, "production", 400, t2.body)).class, "R4", text);
  // An entry that does not bind to its pinned text refuses the context.
  const texts = { ...ctx.texts };
  texts["LOCKPROBE-B-TXTIMEOUT"] = ctx.texts["LOCKPROBE-B-TXTIMEOUT"].replace("perform pg_sleep(30);", "perform pg_sleep(31);");
  assert.throws(() => C.performQueries(texts), /is not in the pinned text exactly once/, "the source is gone");
  texts["LOCKPROBE-B-TXTIMEOUT"] = `${ctx.texts["LOCKPROBE-B-TXTIMEOUT"]}\n-- perform pg_sleep(30);\n`;
  assert.throws(() => C.performQueries(texts), /is not in the pinned text exactly once/, "the source twice");
  delete texts["LOCKPROBE-B-TXTIMEOUT"];
  assert.throws(() => C.performQueries(texts), /not an assembled text/);
  // The pairing, on the real receipts: T2's and B2's messages, each with one frame changed.
  const t2m = JSON.parse(t2.body).message;
  const asT2 = (m) => cls({ ...t2, body: env(m) }).class;
  assert.equal(asT2(t2m), "R3");
  assert.equal(asT2(t2m.replace("at PERFORM", "at EXECUTE")), "R4", "the PERFORM query, then an EXECUTE frame");
  assert.equal(asT2(t2m.replace("at PERFORM", "at RAISE")), "R4", "the PERFORM query, then a RAISE frame");
  assert.equal(asT2(t2m.replace(`SQL statement "${SLEEP}"\n`, "")), "R4", "the PERFORM frame without its statement frame");
  assert.equal(asT2(t2m.replace("FATAL:  25P04", "ERROR:  57014")), "R3", "elements compose: the same frames under ERROR");
  const b2 = rec(CAPTURE.B2[0]);
  const b2m = JSON.parse(b2.body).message;
  assert.equal(cls({ ...b2, body: env(b2m.replace("at EXECUTE", "at PERFORM")) }).class, "R4", "an executed input, then a PERFORM frame");
  assert.equal(cls({ ...b2, body: env(b2m.replace("select 1/0;", "select 1/1;")) }).class, "R4", "a statement frame quoting what was not executed");
});
