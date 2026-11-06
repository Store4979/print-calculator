// scripts/tests/stage0-4c-writing.test.js — item 4(c)'s writing texts (the
// implementation outline's X3). The results are the fixtures
// scripts/manual/stage0-item4c-writing-local-pglite.mjs recorded on PGlite (runs B
// and W), pinned by sha256 in their index. Expected values are written here, from
// the plan, or read from P1's own production receipt. Every store is synthetic.
//   4W-1  P1-4C: pinned, its policy exact, its wrapper bodies byte for byte, and
//         each way of breaking its shape refused
//   4W-2  the fixtures are the index's
//   4W-3  P1-4C's success predicate: accepts the real result; refuses a missing
//         boundary (the real savepoint mutant), a relocated one, a result over the
//         cap and every other shape
//   4W-4  its proofs are P1's reviewed receipt, but for S0.2
//   4W-5  its lock rows: every boundary, and no strong lock on an app table
//   4W-6  a failure is re-raised, one frame, so rule 3′ resolves it as a witnessed
//         profile; a check's own frames, with no handler in the way, are R4
//   4W-7  the declared PERFORMs: exactly the text's, each for its own text only,
//         and no new profile
//   4W-8  neither writing text can be drafted, issued or sent before X4; BUILD-01
//         has no text, policy or target; the preserved policies are unchanged
//   4W-9  BUILD-01's assembly: the facts' text is the one the local run ran; its
//         re-assertion comes before the first file; bad facts refuse
//   4W-10 M-6g admits it and refuses each statement outside its grammar
//   4W-11 the preflight predicates: the comparator and BUILD-01's own read agree on
//         every real shape, and each predicate fails on its own negative
//   4W-12 the facts: Codex's X2c boundaries stay as narrow as ruled
//   4W-13 the default ACL targets and statements
//   4W-14 the real builds: accepted at 01, the catalog and ledger the local 01's,
//         the default rows exactly the target's
//   4W-15 X3-R1 and X3c, Codex's first probe: a lock_not_available and a
//         deadlock_detected through the real helper and the real outer handler keep
//         their state and frames, and their envelopes are R4; the helper's controls;
//         every catch point on the path; every route, none of them R3
//   4W-16 X3-R2, the second: the arbiter comes from catalog properties. Codex's
//         deferrable key stops in both implementations before any file
//   4W-17 X3-R3, the third: a bounded text column must hold the literals. The literal
//         table is the files' and BUILD-01's own
// Each database run in these three is the harness's, on PGlite, which is not a
// dependency of this repository; the test runs the comparator and the classifier on
// what that run recorded, and each 55P03 and 40P01 there was raised on purpose.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import * as A from "../manual/assemble-stage0.mjs";
import * as C from "../manual/stage0-4c-compare.mjs";
import * as G from "../manual/stage0-guard.mjs";
import * as S from "../manual/stage0-send.mjs";
import * as CL from "../manual/stage0-classify.mjs";
import { P1_4C_PERFORMS } from "../manual/stage0-4c-performs.mjs";
import { I4C_WRITE_POLICY, build01Problems, checkManifest, p1PrimeProblems, stepBody } from "./stage0-manifest-check.mjs";
import { lexSql, sqlCode } from "./sql-lexer.mjs";
import { fixture, synthWorkflow, M, ROOT } from "./stage0-guard-fixture.mjs";

const FIX = join(ROOT, "scripts", "tests", "fixtures", "stage0-4c-writing");
const raw = (f) => readFileSync(join(FIX, f), "utf8").replace(/\r\n/g, "\n");
const json = (f) => JSON.parse(raw(f));
const OLD = join(ROOT, "scripts", "tests", "fixtures", "stage0-4c");
const oldJson = (f) => JSON.parse(readFileSync(join(OLD, f), "utf8"));
const OUT = A.assembleAll(M, { cwd: ROOT });
const P1P = OUT["P1-4C"];
const src = A.sourceFromManifest(M, { cwd: ROOT });
const ctx = CL.contextFor(M, { cwd: ROOT });
const predicate = (rows) => CL.SUCCESS["P1-4C"].check(JSON.stringify(rows));
/** The text with its one occurrence of `from` replaced. split and join: these texts hold dollar quotes, which String.replace would read as patterns. */
const swapIn = (text, from, to) => { assert.equal(text.split(from).length, 2, `one occurrence: ${from.slice(0, 80)}`); return text.split(from).join(to); };
const ONE_FRAME = /^PL\/pgSQL function inline_code_block line \d+ at RAISE$/;
/** stage0_expect_error's handler, as P1-4C holds it. */
const HELPER_ARM = "  exception\n    when lock_not_available or deadlock_detected then raise;\n    when others then\n";
/** The 11 boundaries, written out from plan §6.1. */
const BOUNDARIES = ["after-section-0", "after-P2-02", "before-savepoint", "after-savepoint-rollback", "after-P2-0304", "after-P2-05", "after-sections-2-3", "after-RB-5", "after-RB-43", "after-RB-2", "after-section-4"];

test("4W-1 P1-4C is pinned, its policy exact and production-only; it holds the six wrapper bodies byte for byte, and each way of breaking its shape is refused", () => {
  assert.equal(A.md5(P1P), M.outputs["P1-4C"].md5);
  assert.deepEqual(M.send.texts["P1-4C"], { targets: ["production"], readOnly: false, window: "W", effect: "write" });
  assert.deepEqual(I4C_WRITE_POLICY["P1-4C"], M.send.texts["P1-4C"]);
  assert.equal(M.item4c.sources.p1prime.path, "supabase/rehearsals/release2_stage0_4c_p1prime_proofs.sql");
  assert.deepEqual([...A.P1_4C_BOUNDARIES], BOUNDARIES);
  assert.deepEqual(p1PrimeProblems(P1P, OUT), []);
  assert.ok(Buffer.byteLength(P1P) < Buffer.byteLength(OUT.P1), "smaller than P1, whose size the route has taken (SIZE-PROBE)");
  const noBoundary = (name) => `do $stage0_locks$\nbegin\n  perform pg_temp.stage0_locks(${BOUNDARIES.indexOf(name) + 1}, '${name}');\n${A.RERAISE}$stage0_locks$;\n`;
  const into = (name) => swapIn(swapIn(P1P, noBoundary(name), ""), "\nsavepoint stage0_03_alone;\n", `\nsavepoint stage0_03_alone;\n${noBoundary(name)}`);
  const body = (k) => stepBody(OUT[k], k);
  for (const [label, text, re] of [
    ["a commit", P1P.replace("\nrollback;\n", "\ncommit;\n"), /end in ROLLBACK/],
    ["no repeatable read", P1P.replace("begin isolation level repeatable read;", "begin;"), /repeatable read/],
    ["another application name", P1P.replace("'release2-stage0-P1'", "'release2-stage0-other'"), /application name/],
    ["a wrapper changed by a byte", swapIn(P1P, body("P2-02"), swapIn(body("P2-02"), "stage0 P2-02: store4979 is absent", "stage0 P2-02: store4979 is gone")), /P2-02's body/],
    ["a wrapper removed", swapIn(P1P, body("RB-5"), ""), /RB-5's body/],
    ["a wrapper twice", swapIn(P1P, body("RB-2"), body("RB-2") + body("RB-2")), /RB-2's body/],
    ["RB-1 added", swapIn(P1P, "\n-- ===== proofs section 4 =====", `\n${body("RB-1")}\n-- ===== proofs section 4 =====`), /RB-1's body/],
    ["P2-01 added", swapIn(P1P, "\n-- ===== P2-02 body =====", `\n${body("P2-01")}\n-- ===== P2-02 body =====`), /P2-01's body/],
    ["two bodies out of order", swapIn(swapIn(swapIn(P1P, body("P2-05"), "(here)"), body("P2-0304"), body("P2-05")), "(here)", body("P2-0304")), /out of order/],
    ["a boundary dropped", swapIn(P1P, noBoundary("after-RB-5"), ""), /boundary after-RB-5 exactly once/],
    ["a boundary inside the savepoint", into("before-savepoint"), /boundary before-savepoint inside the savepoint/],
    ["a boundary not declared", P1P.replace("\nrollback;\n", "\nselect pg_temp.stage0_locks(99, 'extra');\nrollback;\n"), /not declared/],
    ["another catalog query", P1P.replace("-- @@catalog-rows end", "union all select 'x', 'y', 'z'\n-- @@catalog-rows end"), /catalog query/],
    ["no savepoint", P1P.replace("\nsavepoint stage0_03_alone;\n", "\n"), /no savepoint/],
    ["the helper's handler as X3 had it", swapIn(P1P, HELPER_ARM, "  exception when others then\n"), /a handler in P1-4C does not first let lock_not_available and deadlock_detected through/],
    ["the helper's handler as X3b had it", swapIn(P1P, HELPER_ARM, "  exception\n    when lock_not_available then raise;\n    when others then\n"), /a handler in P1-4C does not first let lock_not_available and deadlock_detected through/],
    ["a boundary's handler without the pass-through", swapIn(P1P, noBoundary("after-RB-5"), noBoundary("after-RB-5").split("  when lock_not_available or deadlock_detected then raise;\n").join("")), /a handler in P1-4C does not first let lock_not_available and deadlock_detected through/],
    ["a boundary's handler passing 55P03 alone", swapIn(P1P, noBoundary("after-RB-5"), noBoundary("after-RB-5").split("when lock_not_available or deadlock_detected then").join("when lock_not_available then")), /a handler in P1-4C does not first let lock_not_available and deadlock_detected through/],
    ["a proof expecting 55P03", swapIn(P1P, "perform pg_temp.stage0_expect_error('E2', null,", "perform pg_temp.stage0_expect_error('E0', null, 'select 1', '55P03', 'x', 'select 1');\n  perform pg_temp.stage0_expect_error('E2', null,"), /a proof in P1-4C expects 55P03 or 40P01/],
    ["a proof expecting 40P01", swapIn(P1P, "perform pg_temp.stage0_expect_error('E2', null,", "perform pg_temp.stage0_expect_error('E0', null, 'select 1', '40P01', 'x', 'select 1');\n  perform pg_temp.stage0_expect_error('E2', null,"), /a proof in P1-4C expects 55P03 or 40P01/],
  ]) {
    assert.notEqual(text, P1P, label);
    assert.match(p1PrimeProblems(text, OUT).join("; "), re, label);
  }
  assert.deepEqual(p1PrimeProblems(undefined, OUT), ["P1-4C is not assembled"]);
});

test("4W-2 the fixtures are exactly the harness's", () => {
  const index = json("index.json").files;
  assert.deepEqual(readdirSync(FIX).filter((f) => f !== "index.json").sort(), Object.keys(index).sort());
  for (const [f, sha] of Object.entries(index)) assert.equal(createHash("sha256").update(raw(f)).digest("hex"), sha, f);
});

const RESULT = json("b-p1.json");
const proofs = RESULT.filter((r) => r.kind === "proof");
const locks = RESULT.filter((r) => r.kind === "lock");
const renumber = (rows) => rows.map((r, i) => ({ ...r, n: i + 1 }));

test("4W-3 P1-4C's predicate accepts the real result, and refuses a missing boundary, a relocated boundary, a result over the cap and every other shape", () => {
  for (const f of ["b-p1.json", "b-p1-current-default.json"]) assert.equal(predicate(json(f)).ok, true, f);
  const ok = predicate(RESULT);
  assert.equal(ok.values.proofs, 45);
  assert.equal(ok.values.locks.length, locks.length);
  assert.equal(RESULT.length, 1206, "the local run the cap is set from");
  assert.equal(CL.P1_4C_RESULT.maxRows, 1809, "1206 with a 50% margin, as its comment says");
  // The real text with one boundary moved inside the savepoint: the rows are gone.
  const real = predicate(json("b-p1-inside-savepoint.json"));
  assert.equal(real.ok, false);
  assert.match(real.why, /missing before-savepoint/);
  assert.ok(!json("b-p1-inside-savepoint.json").some((r) => r.at === "before-savepoint"));
  const firstOf = (at) => locks.filter((r) => r.at === at);
  const others = (at) => locks.filter((r) => r.at !== at);
  const filler = Array.from({ length: CL.P1_4C_RESULT.maxRows - RESULT.length + 1 }, () => ({ n: 0, kind: "lock", at: "after-section-4", fact: "relation|AccessShareLock|true|public.x" }));
  for (const [label, rows, re] of [
    ["not an array", { rows: RESULT }, /not an array/],
    ["over the cap by one", renumber([...RESULT, ...filler]), /over the cap of 1809/],
    ["a boundary missing", renumber([...proofs, ...others("after-P2-05")]), /missing after-P2-05/],
    ["a boundary relocated", renumber([...proofs, ...firstOf("after-P2-02"), ...firstOf("after-section-0"), ...others("after-section-0").filter((r) => r.at !== "after-P2-02")]), /not exactly the declared ones/],
    ["a boundary split in two", renumber([...proofs, ...firstOf("after-section-0"), ...firstOf("after-P2-02"), ...firstOf("after-section-0"), ...others("after-section-0").filter((r) => r.at !== "after-P2-02")]), /not exactly the declared ones/],
    ["a boundary not declared", renumber([...proofs, ...locks, { kind: "lock", at: "after-more", fact: "relation|AccessShareLock|true|public.x" }]), /not exactly the declared ones/],
    ["no lock rows", renumber(proofs), /missing after-section-0/],
    ["a column missing", RESULT.map((r) => { const { fact, ...rest } = r; return fact ? rest : r; }), /not exactly \{ n, kind, at, fact \}/],
    ["a column added", RESULT.map((r) => ({ ...r, extra: 1 })), /not exactly \{ n, kind, at, fact \}/],
    ["numbered from 0", RESULT.map((r) => ({ ...r, n: r.n - 1 })), /not numbered 1 onward/],
    ["a number as text", RESULT.map((r) => ({ ...r, n: String(r.n) })), /not numbered 1 onward/],
    ["another kind", RESULT.map((r, i) => (i === 0 ? { ...r, kind: "note" } : r)), /wrong form/],
    ["a lock row before a proof", renumber([locks[0], ...proofs, ...locks.slice(1)]), /before the last proof/],
    ["a proof missing", renumber([...proofs.slice(1), ...locks]), /44 proof rows/],
    ["a proof changed", RESULT.map((r) => (r.at === "E1" ? { ...r, fact: `${r.fact}.` } : r)), /do not have md5/],
    ["a lock fact out of form", RESULT.map((r) => (r.n === 60 ? { ...r, fact: "relation|AccessShareLock" } : r)), /not locktype\|mode\|granted\|target/],
  ]) {
    const r = predicate(rows);
    assert.equal(r.ok, false, label);
    assert.match(r.why, re, label);
  }
});

test("4W-4 its proof rows are P1's production receipt, row for row, but for S0.2, the state-01 check that replaces it", () => {
  const receipt = JSON.parse(readFileSync(join(ROOT, "scripts", "tests", "fixtures", "stage0-classify", "real", "2026-10-09T01-30-25-743Z_P1_production.json"), "utf8"));
  const p1 = Object.fromEntries(JSON.parse(receipt.body).map((r) => [r.n, r.what]));
  const mine = Object.fromEntries(proofs.map((r) => [r.at, r.fact]));
  assert.deepEqual(Object.keys(mine).sort(), Object.keys(p1).sort(), "the same 45 ids");
  for (const k of Object.keys(p1)) if (k !== "S0.2") assert.equal(mine[k], p1[k], k);
  assert.equal(p1["S0.2"], "no Release 2 object exists before 01");
  assert.equal(mine["S0.2"], "the catalog is state 01 (plan A1a) and the ledger's head is 01's row");
});

test("4W-5 its lock rows cover every boundary in order, and no boundary shows a strong lock on an app table (plan §1.2); P0-4C is unchanged after it", () => {
  const seen = [];
  for (const r of locks) if (seen.at(-1) !== r.at) seen.push(r.at);
  assert.deepEqual(seen, BOUNDARIES);
  const STRONG = /^relation\|(AccessExclusiveLock|ExclusiveLock|ShareRowExclusiveLock|ShareLock)\|true\|(public|auth|storage)\./;
  assert.deepEqual(locks.filter((r) => STRONG.test(r.fact)).map((r) => `${r.at}: ${r.fact}`), [], "only RowExclusive, RowShare and AccessShare on app tables");
  // The nine tables section 3 reaches through foreign keys, and the ones the fixtures write.
  const at = (b) => locks.filter((r) => r.at === b).map((r) => r.fact);
  for (const t of ["orders", "settings", "addons", "discounts", "outsourced_products", "paper_types", "pending_jobs", "print_jobs", "sheet_prices", "employees", "stores", "organizations", "memberships"]) {
    assert.ok(at("after-sections-2-3").includes(`relation|RowExclusiveLock|true|public.${t}`), t);
  }
  assert.ok(at("after-section-0").includes("relation|AccessShareLock|true|auth.users"));
  assert.ok(at("after-section-0").some((f) => f.startsWith("summary|") && f.endsWith(":" + f.split(":").at(-1)) && /pg_catalog:\d+$/.test(f)), "pg_catalog as one summary row");
  assert.equal(at("after-section-0").filter((f) => /\|pg_catalog\./.test(f)).length, 0, "no pg_catalog relation row of its own");
  assert.deepEqual(json("b-p1-p0-unchanged.json").equal, true);
});

/** A sender receipt of P1-4C for the error PostgreSQL gave, rendered as the Management API renders one. */
function errorReceipt(text, target, code, message, where) {
  const pin = M.outputs[text];
  const ref = M.send.targets[target];
  const body = JSON.stringify({ message: `Failed to run sql query: ERROR:  ${code}: ${message}\n${where ? `CONTEXT:  ${where}\n` : ""}` });
  return JSON.stringify({ tool: M.sender.path, text, target, ref, readOnly: M.send.texts[text].readOnly === true, requestMd5: pin.md5, requestBytes: pin.bytes, endpoint: M.send.endpoint.replace("{ref}", ref), startedAt: "2026-11-04T12:00:00.000Z", finishedAt: "2026-11-04T12:00:01.000Z", httpStatus: 400, body, error: null, tokenRedactedFromResponse: false });
}

test("4W-6 a failing check and a wrapper's guard are re-raised with one frame, so rule 3′ resolves them as the witnessed profile; a check's own frames, with no handler in the way, are R4", () => {
  for (const f of ["b-fail-s02.json", "b-fail-guard.json", "b-fail-after-02.json"]) {
    const e = json(f);
    assert.match(e.where, ONE_FRAME, f);
    const c = CL.classifyText(errorReceipt("P1-4C", "production", e.code, e.message, e.where), ctx);
    assert.equal(c.class, "R3", `${f}: ${c.reasons}`);
    assert.equal(c.profile, "re-raised", f);
    assert.equal(c.writing, true, f);
  }
  assert.match(json("b-fail-after-02.json").message, /^STAGE0 PROOF S0\.2 FAILED/);
  // A check's own frames, with no handler in the way, are R4: an unsupported function name.
  const raw2 = "PL/pgSQL function pg_temp_3.stage0_check(text,boolean,text) line 4 at RAISE\nSQL statement \"SELECT pg_temp.stage0_check('S0.1', false, 'x')\"\nPL/pgSQL function inline_code_block line 3 at PERFORM";
  assert.equal(CL.classifyText(errorReceipt("P1-4C", "production", "P0001", "x", raw2), ctx).class, "R4");
  // The handler: every checking DO block in the proofs ends in it, and 55P03 and 40P01 keep their frames.
  const proofsSource = src.item4c("p1prime");
  const blocks = [...proofsSource.matchAll(/^do \$(s[0-9a-z]+)\$\n[\s\S]*?^\$\1\$;$/gm)];
  assert.deepEqual(blocks.map((m) => m[1]), ["s0", "s1", "s1b", "s2a", "s2", "s3", "s4"]);
  for (const m of blocks) assert.ok(m[0].includes(A.RERAISE), m[1]);
  assert.equal(A.RERAISE, "exception\n  when lock_not_available or deadlock_detected then raise;\n  when others then raise exception '%', sqlerrm using errcode = sqlstate;\nend\n");
  assert.equal(P1P.split("do $stage0_locks$").length - 1, 11);
  // A wrapper's EXECUTE keeps its witnessed profile, for the files P1-4C holds, and for no other.
  const executed = (sql) => `SQL statement "${sql}"\nPL/pgSQL function inline_code_block line 7 at EXECUTE`;
  const run = (m) => CL.classifyText(errorReceipt("P1-4C", "production", "42P01", "x", executed(src.migration(m))), ctx);
  assert.deepEqual(ctx.inputs["P1-4C"].length, 8, "02, 03, 04, 05, and the rollbacks of 05, 04, 03, 02");
  for (const n of ["02", "03", "04", "05"]) {
    const c = run(A.MIGRATIONS.find((m) => m.n === n));
    assert.equal(c.class, "R3", n);
    assert.equal(c.profile, "executed input", n);
  }
  const one = run(A.MIGRATIONS[0]);
  assert.equal(one.class, "R4", "01 is not in P1-4C");
  assert.match(one.reasons[0], /quotes no complete input/);
});

/** Every PERFORM of a text, read with the repo's lexer: the expression after the keyword. File literals are data. */
function performsIn(body) {
  const out = [];
  const segs = lexSql(body, { label: "performs" });
  segs.forEach((s, i) => {
    const text = body.slice(s.start, s.end);
    if (s.kind === "dollar") { if (!text.startsWith("$stage0_file$")) out.push(...performsIn(body.slice(s.bodyStart, s.bodyEnd))); return; }
    if (s.kind !== "code") return;
    for (const m of text.matchAll(/\bperform\b/gi)) {
      const start = s.start + m.index + m[0].length;
      let end = -1;
      for (let j = i; j < segs.length && end < 0; j++) {
        if (segs[j].kind !== "code") continue;
        const at = body.indexOf(";", j === i ? start : segs[j].start);
        if (at >= 0 && at < segs[j].end) end = at;
      }
      out.push(body.slice(start, end).trim());
    }
  });
  return out;
}

test("4W-7 the declared PERFORMs are exactly the text's, each a candidate for its own text only; no profile admits one, so an envelope quoting one is R4, and the witnessed ones are as they were", () => {
  const want = new Map();
  for (const e of performsIn(P1P)) want.set(e, (want.get(e) ?? 0) + 1);
  const have = new Map(P1_4C_PERFORMS.map((e) => (Array.isArray(e) ? e : [e, 1])));
  assert.deepEqual([...have].sort(), [...want].sort(), "the table is the text's, both ways");
  assert.equal(performsIn(P1P).length, 71);
  // The rewrite the table's queries rest on: the real frame of a multi-line call.
  const frame = json("b-perform-frame.json").where;
  assert.ok(frame.includes("SQL statement \"SELECT pg_temp.boom('a',\n    'b')\"\nPL/pgSQL function inline_code_block line 3 at PERFORM"), frame);
  // A declared entry is no witness: PERFORM_QUERIES still holds T2's alone.
  assert.deepEqual(Object.keys(CL.PERFORM_QUERIES), ["LOCKPROBE-B-TXTIMEOUT"]);
  assert.deepEqual(CL.PROFILES.map((p) => p.name), ["field-less", "re-raised", "detail/hint re-raised", "executed input", "transaction-timeout PERFORM"], "no new profile");
  const query = "SELECT pg_temp.stage0_locks(3, 'before-savepoint')";
  assert.ok(ctx.performs["P1-4C"].includes(query));
  const frames = (q) => `SQL statement "${q}"\nPL/pgSQL function inline_code_block line 3 at PERFORM`;
  const asFatal = (r) => { const o = JSON.parse(r); o.body = o.body.replace("ERROR:  ", "FATAL:  "); return JSON.stringify(o); };
  // Under its own text: it parses, and no witnessed profile admits it.
  const own = CL.classifyText(errorReceipt("P1-4C", "production", "57014", "canceling statement due to statement timeout", frames(query)), ctx);
  assert.equal(own.class, "R4");
  assert.match(own.reasons[0], /no witnessed profile/);
  // FATAL 25P04: T2's profile binds its own text and query, so this is R4 too.
  const fatal = CL.classifyText(asFatal(errorReceipt("P1-4C", "production", "25P04", "terminating connection due to transaction timeout", frames(query))), ctx);
  assert.equal(fatal.class, "R4");
  assert.match(fatal.reasons[0], /no witnessed profile/);
  // Under another text: it does not even parse.
  for (const [text, target] of [["P1", "production"], ["P2-02", "production"], ["RB-43", "production"], ["LOCKPROBE-B-TXTIMEOUT", "staging"]]) {
    const c = CL.classifyText(errorReceipt(text, target, "57014", "x", frames(query)), ctx);
    assert.equal(c.class, "R4", text);
    assert.match(c.reasons[0], /quotes no complete input of the bound text/, text);
  }
  // RB-43's two, under RB-43 and inside P1-4C, and refused elsewhere.
  for (const q of ["SELECT set_config('release2.rollback_op', 'RB-43', true)", "SELECT set_config('release2.rollback_op', '', true)"]) {
    assert.ok(ctx.performs["RB-43"].includes(q) && ctx.performs["P1-4C"].includes(q), q);
    for (const text of ["RB-43", "P1-4C"]) assert.match(CL.classifyText(errorReceipt(text, "production", "57014", "x", frames(q)), ctx).reasons[0], /no witnessed profile/, text);
    for (const text of ["RB-5", "RB-2", "P2-02", "P1"]) assert.match(CL.classifyText(errorReceipt(text, "production", "57014", "x", frames(q)), ctx).reasons[0], /quotes no complete input/, text);
  }
  // T2's own query under P1-4C does not parse; the witnessed pairing is untouched.
  assert.match(CL.classifyText(errorReceipt("P1-4C", "production", "25P04", "x", frames("SELECT pg_sleep(30)")), ctx).reasons[0], /quotes no complete input/);
  // An entry that does not bind refuses the context, and the twice-held one counts.
  const texts = { ...ctx.texts };
  texts["P1-4C"] = P1P.replace(`perform ${"pg_temp.stage0_locks(3, 'before-savepoint')"};`, "perform pg_temp.stage0_locks(3, 'moved');");
  assert.throws(() => CL.performQueries(texts), /is not in the pinned text exactly once/);
  const twice = "perform set_config('request.jwt.claims', json_build_object('sub', own_a, 'role', 'authenticated')::text, true);";
  assert.equal(P1P.split(twice).length - 1, 2);
  texts["P1-4C"] = P1P.replace(twice, "");
  assert.throws(() => CL.performQueries(texts), /is not in the pinned text exactly 2 times/);
  // A manifest from before X3 has no such text, and that binds nothing.
  const before = { ...ctx.texts };
  delete before["P1-4C"];
  assert.ok(!Object.hasOwn(CL.performQueries(before), "P1-4C"));
});

test("4W-8 neither writing text can be drafted, issued or sent before X4: no workflow names one; BUILD-01 has no text, policy or target; the preserved texts' policies and pins are unchanged, and no text names a rehearsal target", async () => {
  for (const [wname, wf] of Object.entries(G.WORKFLOWS)) {
    for (const [pname, p] of Object.entries(wf.phases)) for (const id of p.steps) assert.ok(!["P1-4C", "BUILD-01"].includes(wf.stepText(id)), `${wname} ${pname} ${id}`);
  }
  assert.ok(!Object.hasOwn(M.outputs, "BUILD-01") && !Object.hasOwn(OUT, "BUILD-01") && !Object.hasOwn(M.send.texts, "BUILD-01"));
  assert.ok(!M.item4c.build01, "no facts are bound");
  assert.throws(() => S.planSend(M, "BUILD-01", "production", { cwd: ROOT }), /is not a sendable text/);
  assert.throws(() => S.planSend(M, "P1-4C", "staging", { cwd: ROOT }), /may not be sent/);
  assert.throws(() => S.planSend(M, "P1-4C", "rehearsal", { cwd: ROOT }), /unknown target/);
  assert.deepEqual(M.send.targets, { production: A.PRODUCTION_REF, staging: A.STAGING_REF }, "no rehearsal target");
  // C8 waits for the ref-binding commit: every preserved text keeps its listed pin and policy, with no effect.
  for (const [k, [md5, policy]] of Object.entries(CL.LEGACY_EFFECT)) {
    assert.equal(M.outputs[k].md5, md5, k);
    assert.deepEqual(M.send.texts[k], policy, k);
  }
  // A go for a declared step carries that step's text, and the sender refuses it for P1-4C, before any request.
  const wf = { t: synthWorkflow("production", { P: [["A1", "STATE"]] }) };
  const fx = fixture({ workflows: wf });
  try {
    fx.clock();
    const ph = fx.phase("t", "P");
    const R = fx.window("R", ph.phaseId, { pid: 1001 });
    const go = fx.issue(ph.phaseId, "A1");
    assert.equal(go.text, "STATE");
    let err = null;
    try { await fx.send(G, { text: "P1-4C", target: "production", win: R, goId: go.goId }); } catch (e) { err = e; }
    assert.ok(err instanceof G.Refusal);
    assert.equal(fx.calls.length, 0);
  } finally { fx.cleanup(); }
});

const facts = json("w-old-facts.json").facts;
const manifestFiles = () => {
  const one = M.migrations.find((m) => m.n === "01");
  return [...M.baselineLedger.map((r) => ({ version: r.version, name: r.name, md5: r.md5, blob: r.blob })), { version: one.productionVersion, name: one.name, md5: one.md5, blob: one.blob }].map((f) => {
    const b = A.gitBlob(f.blob, ROOT);
    return { ...f, bytes: b.length, text: b.toString("utf8") };
  });
};
const reads = () => ({ build00: src.item4c("build00").slice(0, -2), build00w: src.item4c("build00w").slice(0, -2) });
const sibling = (text, f = facts) => build01Problems(text, { files: manifestFiles(), facts: f, createdBy: M.ledgerRow.createdBy, ...reads() });
const BUILD = A.build01Text(src, M, facts);

test("4W-9 BUILD-01's text is a function of the bound facts: the one the local run ran; its re-assertion comes before the first file; a text exists only with facts, and bad facts refuse", () => {
  for (const f of ["w-old", "w-current", "w-absent-schema", "w-empty"]) {
    const r = json(`${f}-facts.json`);
    const text = A.build01Text(src, M, r.facts);
    assert.equal(A.md5(text), r.md5, f);
    assert.equal(Buffer.byteLength(text), r.bytes, f);
    assert.ok(Buffer.byteLength(text) < M.outputs["SIZE-PROBE"].bytes, `${f}: smaller than what the route has taken`);
  }
  // The order, by position in the text.
  const pos = (s) => { const i = BUILD.indexOf(s); assert.ok(i >= 0, s); return i; };
  const firstFile = pos("$stage0_file$");
  assert.ok(pos("the bound acceptance does not hold") < firstFile, "the re-assertion is before the first file");
  assert.ok(pos("the pre-30-October target") < firstFile, "the first default target is before the first file");
  assert.ok(pos("create table supabase_migrations.schema_migrations") < firstFile);
  assert.ok(pos("insert into auth.users") < firstFile);
  assert.ok(pos("create schema stage0_rehearsal") > BUILD.lastIndexOf("$stage0_file$"), "the marker is after the last file");
  assert.ok(pos("the current production rows") > pos("create schema stage0_rehearsal"));
  assert.ok(BUILD.endsWith("commit;\n"));
  assert.equal(BUILD.split("$stage0_file$").length - 1, 42, "21 files, each literal opened and closed");
  // Through the manifest: with facts it assembles, with its inputs for the classifier; without, neither.
  const withFacts = { ...M, item4c: { ...M.item4c, build01: facts } };
  assert.equal(A.assembleAll(withFacts, { cwd: ROOT })["BUILD-01"], BUILD);
  assert.equal(A.executedInputs(withFacts, { cwd: ROOT })["BUILD-01"].length, 21);
  assert.ok(!Object.hasOwn(A.executedInputs(M, { cwd: ROOT }), "BUILD-01"));
  // Facts that cannot make a text.
  for (const [label, change, re] of [
    ["production's ref", { ref: A.PRODUCTION_REF }, /not production's, not staging's/],
    ["staging's ref", { ref: A.STAGING_REF }, /not production's, not staging's/],
    ["a ref out of form", { ref: "ABC" }, /rehearsal project's/],
    ["a populated ledger", { ledger: "populated" }, /does not build over a ledger that is populated/],
    ["a denied ledger", { ledger: "denied-read" }, /does not build over/],
    ["one employee", { employees: 1 }, /two or more employees/],
    ["a creator out of form", { creator: "Robert'); drop" }, /not a role name/],
    ["no digests", { digests: { build00: {}, build00w: {} } }, /digests of build00/],
    ["a digest out of form", { digests: { build00: { x: "nope" }, build00w: facts.digests.build00w } }, /digests of build00/],
  ]) assert.throws(() => A.build01Text(src, M, { ...facts, ...change }), re, label);
  // The two reads, verbatim, inside the first step; and a changed fact, from the real run.
  assert.ok(BUILD.includes(reads().build00) && BUILD.includes(reads().build00w));
  const changed = json("w-fact-changed.json");
  assert.match(changed.message, /does not hold: digest build00\.buckets/);
  assert.match(changed.where, ONE_FRAME);
  assert.deepEqual(changed.gone, { ledger_absent: true, marker_absent: true, files_absent: true });
  // A failure in a later step, from the real run: re-raised, one frame, and the whole transaction gone.
  const planted = json("w-file-failure.json");
  assert.equal(planted.code, "22012");
  assert.match(planted.where, ONE_FRAME);
  assert.equal(planted.left.ledger_absent, true);
  // Its success is its last row-returning statement.
  assert.equal(CL.SUCCESS["BUILD-01"].check('[{"set_config":"110s"}]').ok, true);
  assert.equal(CL.SUCCESS["BUILD-01"].check('[{"set_config":"45s"}]').ok, false);
});

test("4W-10 M-6g admits BUILD-01 in each ledger form, and refuses every statement outside its grammar", () => {
  assert.deepEqual(sibling(BUILD), []);
  for (const f of ["w-current", "w-absent-schema", "w-empty"]) {
    const r = json(`${f}-facts.json`);
    assert.deepEqual(sibling(A.build01Text(src, M, r.facts), r.facts), [], f);
  }
  const FILE = manifestFiles()[3];
  const firstFileStep = `  execute f;\n`;
  const mutate = [
    ["a write in the re-assertion", BUILD.replace("  if v_bad is not null then", "  delete from public.stores;\n  if v_bad is not null then"), /first step holds delete/],
    ["a second INTO", BUILD.replace("  if v_bad is not null then", "  select 1 into v_bad;\n  if v_bad is not null then"), /INTO other than once/],
    ["a call off the list", BUILD.replace("  if v_bad is not null then", "  if pg_sleep(1) is null then null; end if;\n  if v_bad is not null then"), /calls pg_sleep/],
    ["a changed read", BUILD.replace("select 'database', 'create',", "select 'database', 'created',"), /does not embed BUILD-00W/],
    ["a read removed", swapIn(BUILD, reads().build00, "select 'x' as part, 'y' as key, 'z' as value"), /does not embed BUILD-00 exactly once/],
    ["another digest", BUILD.replace(facts.digests.build00.buckets, "0".repeat(32)), /does not bind exactly the facts' part digests/],
    ["the refusal removed", BUILD.replace("raise exception 'stage0 BUILD-01: the bound acceptance does not hold: %', v_bad using errcode = 'P0001';", "null;"), /does not refuse when the bound acceptance fails/],
    ["a statement between steps", BUILD.replace("\ncommit;\n", "\ndelete from public.stores;\ncommit;\n"), /is not a DO step/],
    ["a commit in the middle", swapIn(BUILD, "do $stage0_build$\nbegin\n  insert into auth.users", "commit;\ndo $stage0_build$\nbegin\n  insert into auth.users"), /is not a DO step/],
    ["a step added", swapIn(BUILD, "\ncommit;\n", "\ndo $stage0_build$\nbegin\n  null;\n" + A.RERAISE + "$stage0_build$;\ncommit;\n"), /DO steps, not/],
    ["a step removed", BUILD.replace(/do \$stage0_build\$\nbegin\n  create schema stage0_rehearsal;[\s\S]*?\$stage0_build\$;\n/, ""), /DO steps, not/],
    ["no handler in a step", BUILD.replace(`  create schema stage0_rehearsal;\n  create table stage0_rehearsal.marker (ref text primary key, note text not null);\n  insert into stage0_rehearsal.marker (ref, note) values ('${facts.ref}', '${A.BUILD_MARKER_NOTE.replace("'", "''")}');\n${A.RERAISE}`, `  create schema stage0_rehearsal;\n  create table stage0_rehearsal.marker (ref text primary key, note text not null);\n  insert into stage0_rehearsal.marker (ref, note) values ('${facts.ref}', '${A.BUILD_MARKER_NOTE.replace("'", "''")}');\nend\n`), /does not end in the handler/],
    ["a file changed by a byte", swapIn(BUILD, `$stage0_file$${FILE.text}`, `$stage0_file$-- x\n${FILE.text}`), /does not hold its file's blob/],
    ["a file's gate changed", BUILD.replace(`if md5(f) <> '${FILE.md5}'`, `if md5(f) <> '${"0".repeat(32)}'`), /statement 2 is not its form/],
    ["a ledger row at another version", BUILD.replace(`values ('${FILE.version}', '${FILE.name}', array[f]`, `values ('99999999999999', '${FILE.name}', array[f]`), /statement 5 is not its form/],
    ["a write in a file step", BUILD.replace(firstFileStep, "  delete from public.stores;\n  execute f;\n"), /has 8 statements, not 7/],
    ["a second EXECUTE", BUILD.replace(firstFileStep, "  execute 'drop table public.stores';\n  execute f;\n"), /has 8 statements, not 7/],
    ["a foreign user", BUILD.replace("'owner@example.invalid'", "'someone@realcompany.example'"), /users step statement 1/],
    ["a real-looking employee", BUILD.replace("'Rehearsal Employee 2'", "'Real Person'"), /only its synthetic employees/],
    ["a second store", BUILD.replace("insert into public.stores (slug, name) values ('store4979', 'The UPS Store #4979');", "insert into public.stores (slug, name) values ('store4979', 'The UPS Store #4979'), ('other', 'Other');"), /the one store/],
    ["another marker ref", BUILD.replace(`values ('${facts.ref}', 'reconstruction`, "values ('zzzzzzzzzzzzzzzzzzzz', 'reconstruction"), /marker row/],
    ["a marker with other words", BUILD.replace("reconstruction: these ledger rows", "these ledger rows"), /marker row/],
    ["a default for another role", BUILD.replace("  if (with have as (", "  alter default privileges for role anon grant select on tables to public;\n  if (with have as ("), /changes another role's defaults/],
    ["a table grant in a default step", BUILD.replace("  if (with have as (", "  grant all on public.stores to anon;\n  if (with have as ("), /outside its grammar/],
    ["a default assertion removed", BUILD.replace("raise exception 'stage0 BUILD-01: the default ACLs are not the pre-30-October target' using errcode = 'P0001';", "null;"), /does not assert its rows/],
    ["other settings", BUILD.replace("set_config('statement_timeout', '90s', true)", "set_config('statement_timeout', '0', true)"), /settings are not its form/],
    ["a predicate dropped", BUILD.replace(/^ {6}\('buckets-rows', .*\n/m, ""), /exactly the preflight table's predicates/],
    ["a predicate added", BUILD.replace(/^( {6}\('creator', .*)\n/m, "      ('another', true),\n$1\n"), /exactly the preflight table's predicates/],
    ["the timeouts unchecked", BUILD.replace("the stage-0 timeouts (PG 17 transaction_timeout included) are not in force in this transaction", "not in force"), /does not check its timeouts/],
    ["no commit", BUILD.replace("\ncommit;\n", "\nrollback;\n"), /does not end in commit/],
  ];
  for (const [label, text, re] of mutate) {
    assert.notEqual(text, BUILD, label);
    assert.match(sibling(text).join("; "), re, label);
  }
  // Through checkManifest, once B1 binds facts, and with a text but no facts.
  const bound = { ...M, item4c: { ...M.item4c, build01: facts }, outputs: { ...M.outputs, "BUILD-01": { md5: A.md5(BUILD), bytes: Buffer.byteLength(BUILD) } } };
  assert.deepEqual(checkManifest(ROOT, bound)["M-6"], [], "M-6 runs M-6g on the bound text");
  const unbound = { ...M, outputs: { ...M.outputs, "BUILD-01": { md5: A.md5(BUILD), bytes: Buffer.byteLength(BUILD) } } };
  assert.ok(checkManifest(ROOT, unbound)["M-6"].includes("BUILD-01 has a text with no bound facts"));
  // The steps out of order: the re-assertion after a file, and two files swapped.
  const steps = BUILD.split(/(?=^do \$stage0_build\$$)/m);
  const swap = (i, k) => { const s = [...steps]; [s[i], s[k]] = [s[k], s[i]]; return s.join(""); };
  assert.match(sibling(swap(1, 5)).join("; "), /first step|default-ACL|not its form/, "the re-assertion moved");
  const f1 = steps.findIndex((s) => s.includes("$stage0_file$"));
  assert.match(sibling(swap(f1, f1 + 1)).join("; "), /does not hold its file's blob/, "two files swapped");
});

test("4W-11 the preflight predicates: on every real shape the comparator and BUILD-01's own read name the same ones; each predicate fails on its own negative; a malformed reading stops", () => {
  assert.deepEqual([...C.BUILD_PREDICATE_NAMES], [...A.BUILD_PREDICATE_NAMES], "one table of names, in both places");
  assert.equal(C.BUILD_PREDICATE_NAMES.length, 24);
  const WANT = {
    "job-files-row": ["buckets-rows"], "customer-uploads-row": ["buckets-rows"], "extra-notnull-bucket-column": ["buckets-notnull"], "generated-bucket-column": ["buckets-generated"],
    "no-arbiter": ["buckets-arbiter"], "policy-present": ["objects-policies"], "publication-all-tables": ["publication-present"], "publication-absent": ["publication-authority", "publication-present"],
    "extra-notnull-user-column": ["authusers-notnull"], "user-trigger": ["authusers-triggers"], "marker-present": ["marker-absent"], "object-in-public": ["public-empty"],
    "pending-jobs-member": ["public-empty", "publication-member"], "objects-absent": ["objects-authority", "objects-table"], "user-column-type": ["authusers-columns"],
    "rls-reader": ["authusers-authority", "buckets-authority", "buckets-rls", "creator", "database-create", "objects-authority", "publication-authority"],
  };
  const tried = new Set();
  for (const [name, want] of Object.entries(WANT)) {
    const r = json(`w-shape-${name}.json`);
    assert.deepEqual(r.js, want, `${name}: the comparator`);
    assert.deepEqual(r.sql, want, `${name}: BUILD-01's own read`);
    want.forEach((p) => tried.add(p));
  }
  // The authority predicates fail for a reader RLS filters, which sees no target row: "buckets-rows" alone would have passed.
  const rls = json("w-shape-rls-reader.json");
  assert.equal(rls.row, "false");
  assert.equal(rls.rls, "true");
  const missing = json("w-shape-missing-bucket-column.json");
  assert.equal(missing.build00wError, "42703");
  assert.deepEqual(missing.js, ["buckets-columns"]);
  assert.equal(missing.code, "42703");
  tried.add("buckets-columns");
  // Each predicate on its own negative, from the real fresh shape.
  const b = oldJson("a-build00.json"), w = oldJson("a-build00w.json");
  const ask = (x, y) => C.buildPredicateFindings(x, y, { creator: "postgres", ledger: "absent-table" }).map((f) => f.key);
  assert.deepEqual(ask(b, w), [], "the shim's fresh shape passes them all");
  const set = (rows, part, key, value) => rows.map((r) => (r.part === part && r.key === key ? { ...r, value } : r));
  const drop = (rows, part, key) => rows.filter((r) => !(r.part === part && r.key === key));
  const add = (rows, part, key, value) => [...rows, { part, key, value }];
  for (const [name, x, y] of [
    ["public-empty", add(b, "public", "relation|x", "r|postgres"), w],
    ["ledger", set(b, "ledger", "status", "empty"), w],
    ["buckets-present", set(b, "buckets", "present", "false"), w],
    ["buckets-columns", set(b, "buckets", "column|id", "integer|true|||"), w],
    ["buckets-notnull", add(b, "buckets", "column|tenant", "text|true|||"), w],
    ["buckets-generated", set(b, "buckets", "column|updated_at", "timestamp with time zone|false||a|"), w],
    ["buckets-arbiter", b.filter((r) => !r.key.startsWith("arbiter|")), w],
    ["buckets-authority", b, set(w, "buckets", "update|updated_at", "false")],
    ["buckets-rls", b, set(w, "buckets", "rls_applies", "true")],
    ["buckets-rows", b, set(w, "buckets", "row|customer-uploads", "true")],
    ["objects-table", set(b, "objects", "table", "v|postgres|false|false"), w],
    ["objects-policies", add(b, "objects", "policy|job_files_anon_delete", "d"), w],
    ["objects-authority", b, set(w, "objects", "owner_privileges", "false")],
    ["publication-present", set(b, "publication", "pub|supabase_realtime", "postgres|true|true|true|true|true|false"), w],
    ["publication-member", add(b, "publication", "member|public.pending_jobs", "supabase_realtime"), w],
    ["publication-authority", b, set(w, "publication", "owner_privileges", "<absent>")],
    ["authusers-columns", drop(b, "authusers", "column|email"), w],
    ["authusers-notnull", set(b, "authusers", "notnull-nodefault", "id,tenant"), w],
    ["authusers-authority", b, set(w, "authusers", "references|id", "false")],
    ["authusers-rls", b, set(w, "authusers", "rls_applies", "true")],
    ["authusers-triggers", set(b, "authusers", "user-triggers", "1"), w],
    ["marker-absent", set(b, "schemas", "schema|stage0_rehearsal", "postgres"), w],
    ["database-create", b, set(w, "database", "create", "false")],
    ["creator", b, set(set(w, "role", "name", "someone"), "role", "attr", "false|true|false|false|true|false|false")],
  ]) { assert.deepEqual(ask(x, y), [name], name); tried.add(name); }
  assert.deepEqual([...tried].sort(), [...C.BUILD_PREDICATE_NAMES].sort(), "every predicate has a negative");
  // A missing fact fails its predicate; a malformed reading is a STOP, not an exception.
  for (const bad of [null, "rows", [null], [{ part: "x", key: "k" }], [{ part: "x", key: "k", value: "v" }, { part: "x", key: "k", value: "v" }]]) {
    const f = C.buildPredicateFindings(bad, w, { creator: "postgres", ledger: "absent-table" });
    assert.equal(f.length, 1, JSON.stringify(bad));
    assert.match(f[0].reason, /not rows of text/);
  }
  assert.ok(ask([], w).includes("buckets-present"), "no facts at all");
});

test("4W-12 the facts bind only what the ledger rule and the predicates accept: Codex's X2c boundaries stay as narrow as ruled", () => {
  const b = oldJson("a-build00.json"), w = oldJson("a-build00w.json");
  const finalFrom = json("w-old-state.json");
  const ok = C.build01Facts({ build00: b, build00w: w, ref: "abcdefghijklmnopqrst", finalFrom });
  assert.equal(ok.facts.ledger, "absent-table");
  assert.equal(ok.facts.creator, "postgres");
  assert.deepEqual(ok.facts.digests.build00w, C.partDigests(w));
  const emptyLedger = json("w-empty-facts.json").facts;
  assert.equal(emptyLedger.ledger, "empty");
  // What X2c accepted, and nothing wider: the owner, RLS off, the exact document.
  const asEmpty = (rows, over) => [...rows.filter((r) => r.part !== "ledger"), ...Object.entries({ schema: "true", table: "true", relation: "r|postgres|false|false", columns: C.LEDGER_COLUMNS, status: "empty", rows: "<table xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\">\n\n</table>\n", ...over }).map(([key, value]) => ({ part: "ledger", key, value }))];
  assert.notEqual(C.build01Facts({ build00: asEmpty(b, {}), build00w: w, ref: "abcdefghijklmnopqrst", finalFrom }).facts, null);
  for (const [label, over, re] of [
    ["another owner", { relation: "r|supabase_admin|false|false" }, /not the one relation form/],
    ["RLS on", { relation: "r|postgres|true|false" }, /not the one relation form/],
    ["RLS forced", { relation: "r|postgres|false|true" }, /not the one relation form/],
    ["another empty serialization", { rows: "<table xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\">\n</table>\n" }, /not the reviewed empty document/],
    ["a populated ledger", { status: "populated", rows: "<table x><row></row></table>" }, /already holds rows/],
  ]) {
    const r = C.build01Facts({ build00: asEmpty(b, over), build00w: w, ref: "abcdefghijklmnopqrst", finalFrom });
    assert.equal(r.facts, null, label);
    assert.match(C.blocking(r.findings).map((f) => f.reason).join(" | "), re, label);
  }
  // Total: readings it cannot use give no facts and no exception.
  for (const [label, input] of [
    ["no default rows", { build00: b.filter((r) => r.part !== "defaults"), build00w: w, ref: "abcdefghijklmnopqrst", finalFrom }],
    ["a final state with no default rows", { build00: b, build00w: w, ref: "abcdefghijklmnopqrst", finalFrom: [{ part: 3, key: "x", value: "y" }] }],
    ["a final state of junk", { build00: b, build00w: w, ref: "abcdefghijklmnopqrst", finalFrom: [null] }],
    ["BUILD-00 not rows", { build00: null, build00w: w, ref: "abcdefghijklmnopqrst", finalFrom }],
    ["BUILD-00W not rows", { build00: b, build00w: "rows", ref: "abcdefghijklmnopqrst", finalFrom }],
  ]) assert.equal(C.build01Facts(input).facts, null, label);
  // A predicate that fails, and no production state, give no facts.
  assert.equal(C.build01Facts({ build00: b, build00w: w.map((r) => (r.key === "row|job-files" ? { ...r, value: "true" } : r)), ref: "abcdefghijklmnopqrst", finalFrom }).facts, null);
  assert.equal(C.build01Facts({ build00: b, build00w: w, ref: "abcdefghijklmnopqrst" }).facts, null);
  // The digests are BUILD-01's: key TAB value LF, keys in byte order, written out here.
  assert.deepEqual(C.partDigests([{ part: "p", key: "b", value: "2" }, { part: "p", key: "a", value: "1" }]), { p: A.md5("a\t1\nb\t2\n") });
  assert.throws(() => C.partDigests([{ part: "p", key: "a", value: 1 }]), TypeError);
});

test("4W-13 the default ACL targets are what the plan names, and the statements reach exactly them", () => {
  const OWNER_T = "postgres=DELETE/postgres,postgres=INSERT/postgres,postgres=MAINTAIN/postgres,postgres=REFERENCES/postgres,postgres=SELECT/postgres,postgres=TRIGGER/postgres,postgres=TRUNCATE/postgres,postgres=UPDATE/postgres";
  assert.equal(A.implicitDefault("postgres", "r"), OWNER_T);
  assert.equal(A.implicitDefault("postgres", "S"), "postgres=SELECT/postgres,postgres=UPDATE/postgres,postgres=USAGE/postgres");
  assert.equal(A.implicitDefault("postgres", "f"), "PUBLIC=EXECUTE/postgres,postgres=EXECUTE/postgres");
  assert.equal(A.implicitDefault("postgres", "T"), "PUBLIC=USAGE/postgres,postgres=USAGE/postgres");
  assert.equal(A.implicitDefault("postgres", "n"), "postgres=CREATE/postgres,postgres=USAGE/postgres");
  const old = A.oldDefaultTarget("postgres");
  assert.equal(old["public|f"], "anon=EXECUTE/postgres,authenticated=EXECUTE/postgres,service_role=EXECUTE/postgres");
  assert.equal(old["public|S"], ["anon", "authenticated", "service_role"].flatMap((g) => ["SELECT", "UPDATE", "USAGE"].map((p) => `${g}=${p}/postgres`)).join(","));
  assert.equal(old["public|T"], "");
  // The shim's rows are that target, read from a real database.
  assert.deepEqual(C.defaultsOf(oldJson("a-build00.json"), "defaults", "postgres"), old);
  assert.deepEqual(C.defaultsOf(json("w-old-state.json"), 3, "postgres"), old);
  // Nothing to do when already there.
  assert.deepEqual(A.defaultAclStatements("postgres", old, old), []);
  // Revokes first, then grants, each grantee on its line.
  const to = { ...old, "public|f": "anon=EXECUTE*/postgres", "*|n": "postgres=CREATE/postgres,postgres=USAGE/postgres,x=USAGE/postgres" };
  assert.deepEqual(A.defaultAclStatements("postgres", old, to), [
    "alter default privileges for role postgres grant usage on schemas to x;",
    "alter default privileges for role postgres in schema public revoke execute on functions from authenticated;",
    "alter default privileges for role postgres in schema public revoke execute on functions from service_role;",
    "alter default privileges for role postgres in schema public grant execute on functions to anon with grant option;",
  ]);
  assert.deepEqual(A.defaultAclStatements("postgres", { "*|f": "anon=EXECUTE*/postgres" }, { "*|f": "anon=EXECUTE/postgres" }), ["alter default privileges for role postgres revoke grant option for execute on functions from anon;"]);
  assert.deepEqual(A.defaultAclStatements("postgres", { "*|f": "PUBLIC=EXECUTE/postgres,postgres=EXECUTE/postgres" }, { "*|f": "postgres=EXECUTE/postgres" }), ["alter default privileges for role postgres revoke execute on functions from public;"]);
  // A shape it does not know is not fitted.
  for (const [label, from, target, re] of [
    ["another grantor", { "*|f": "anon=EXECUTE/supabase_admin" }, {}, /granted by supabase_admin/],
    ["a scope it does not set", { "auth|f": "" }, {}, /not a default-ACL scope/],
    ["schemas at the public scope", { "public|n": "" }, {}, /not a default-ACL scope/],
    ["an entry out of form", { "*|f": "not an acl" }, {}, /not an ACL entry/],
    ["a role out of form", { "*|f": "Robert=EXECUTE/postgres" }, {}, /not a role name/],
  ]) assert.throws(() => A.defaultAclStatements("postgres", from, target), re, label);
  assert.throws(() => A.defaultAclStatements("Robert", {}, {}), /not a role name/);
  // The current-default variant's real run: its statements took the rows to exactly the target.
  const cur = json("w-current-facts.json").facts;
  assert.notDeepEqual(cur.defaultsNow, old);
  assert.notDeepEqual(cur.defaultsFinal, old);
  assert.deepEqual(C.defaultsOf(json("w-current-state.json"), 3, "postgres"), cur.defaultsFinal);
});

test("4W-14 the real builds: P0-4C accepts each at 01 on the rehearsal; the catalog is one fingerprint, with 21 ledger rows at production's versions; the marker is true", () => {
  const fp = (rows) => rows.find((r) => r.part === 2 && r.key === "fingerprint").value;
  const ref = oldJson("c-01.json");
  const refFp = ref.rows.find((x) => x[0] === 2 && x[1] === "fingerprint")[2];
  for (const f of ["w-old-state.json", "w-current-state.json"]) {
    const rows = json(f);
    const o = C.readObservation(rows);
    assert.deepEqual(C.blocking(C.p0Findings(M, o, { target: "rehearsal" })), [], f);
    assert.equal(fp(rows), refFp, `${f}: the local 01's catalog`);
    assert.equal(o.parts[10].rehearsal_marker, "true");
    assert.equal(o.parts[1].count, "21");
    assert.equal(o.parts[1].head, M.migrations.find((m) => m.n === "01").productionVersion);
    assert.equal(C.blocking(C.p0Findings(M, o, { target: "production" })).some((x) => x.key === "rehearsal_marker"), true, `${f}: not production`);
  }
});

const LOCK_WORDS = "canceling statement due to lock timeout";
const DEADLOCK_WORDS = "deadlock detected";
const helperRun = (name) => {
  const e = json(`b-helper-${name}.json`);
  return { e, c: e.ok ? null : CL.classifyText(errorReceipt("P1-4C", "production", e.code, e.message, e.where), ctx) };
};
/** Every handler in a text: the word EXCEPTION where RAISE does not come before it. */
const handlersIn = (view) => [...view.matchAll(/\bexception\b/gi)].filter((m) => !/\braise\s+$/i.test(view.slice(Math.max(0, m.index - 40), m.index)));

test("4W-15 X3-R1 and X3c: a lock_not_available and a deadlock_detected through the real stage0_expect_error and the real outer handler keep their state and frames, and their envelopes are R4; the helper still judges every other refusal; every catch point on the path passes both; every route is R4", () => {
  // Codex's probe, from the harness's run of section 0's real helper. The 55P03 is raised on purpose.
  const lock = helperRun("lock-through-helper");
  assert.equal(lock.e.code, "55P03");
  assert.equal(lock.e.message, LOCK_WORDS);
  assert.match(lock.e.where, /PL\/pgSQL function pg_temp_\d+\.stage0_expect_error\(text,text,text,text,text,text\) line \d+ at EXECUTE/);
  assert.match(lock.e.where, /PL\/pgSQL function inline_code_block line \d+ at PERFORM$/);
  assert.equal(lock.c.class, "R4", lock.c.reasons.join("; "));
  // As X3 had it, the same call is what Codex found: P0001, one frame, R3. The fix is what changes this.
  const old = helperRun("lock-helper-as-x3-had-it");
  assert.equal(old.e.code, "P0001");
  assert.match(old.e.message, /got \[55P03\] canceling statement due to lock timeout$/);
  assert.match(old.e.where, ONE_FRAME);
  assert.equal(old.c.class, "R3");
  assert.equal(old.c.profile, "re-raised");
  // The state and frames decide, never the words: other words stay 55P03 and R4; the words under another state stay a wrong refusal, R3.
  const words = helperRun("lock-other-words");
  assert.equal(words.e.code, "55P03");
  assert.equal(words.e.message, "some other words");
  assert.equal(words.c.class, "R4");
  const notLock = helperRun("timeout-words-other-state");
  assert.equal(notLock.e.code, "P0001");
  assert.equal(notLock.e.message, `STAGE0 PROOF X3-LOCK FAILED: expected [42501] the expected refusal, got [42P01] ${LOCK_WORDS}`);
  assert.equal(notLock.c.class, "R3");
  // X3c: the same for a deadlock, which X3b's helper still converted to P0001, R3 (Codex's probe of 1a7aff1).
  const dead = helperRun("deadlock-through-helper");
  assert.equal(dead.e.code, "40P01");
  assert.equal(dead.e.message, DEADLOCK_WORDS);
  assert.match(dead.e.where, /PL\/pgSQL function pg_temp_\d+\.stage0_expect_error\(text,text,text,text,text,text\) line \d+ at EXECUTE/);
  assert.equal(dead.c.class, "R4", dead.c.reasons.join("; "));
  const oldDead = helperRun("deadlock-helper-as-x3b-had-it");
  assert.equal(oldDead.e.code, "P0001");
  assert.match(oldDead.e.message, /got \[40P01\] deadlock detected$/);
  assert.match(oldDead.e.where, ONE_FRAME);
  assert.equal(oldDead.c.class, "R3");
  assert.equal(oldDead.c.profile, "re-raised");
  const deadWords = helperRun("deadlock-other-words");
  assert.equal(deadWords.e.code, "40P01");
  assert.equal(deadWords.e.message, "some other words");
  assert.equal(deadWords.c.class, "R4");
  const notDead = helperRun("deadlock-words-other-state");
  assert.equal(notDead.e.code, "P0001");
  assert.equal(notDead.c.class, "R3");
  // Each state alone, in the one frame a witnessed profile has: the frames fit, and the state still decides.
  for (const [name, state] of [["lock-one-frame", "55P03"], ["deadlock-one-frame", "40P01"]]) {
    const r = helperRun(name);
    assert.equal(r.e.code, state, name);
    assert.match(r.e.where, ONE_FRAME, name);
    assert.equal(r.c.class, "R4", name);
    assert.match(r.c.reasons[0], /reports SQLSTATE/, name);
  }
  // An unrelated SQLSTATE whose words say "deadlock" or "lock timeout" stays under the profiles.
  for (const [name, words] of [["unrelated-state-deadlock-words", DEADLOCK_WORDS], ["unrelated-state-lock-words", LOCK_WORDS]]) {
    const r = helperRun(name);
    assert.deepEqual([r.e.code, r.e.message], ["42P01", words], name);
    assert.deepEqual([r.c.class, r.c.profile], ["R3", "re-raised"], name);
  }
  // The helper's own controls: the expected refusal is a proof row, and a wrong one, a wrong message or no refusal are its failure.
  const expected = helperRun("expected-refusal");
  assert.equal(expected.e.ok, true);
  assert.equal(expected.e.proof, "[42501] the expected refusal; rows unchanged");
  for (const [name, re] of [["wrong-refusal", /got \[42P01\] another refusal$/], ["wrong-message", /got \[42501\] another message$/], ["no-refusal", /got \[NO ERROR\] $/]]) {
    const r = helperRun(name);
    assert.equal(r.e.code, "P0001", name);
    assert.match(r.e.message, re, name);
    assert.match(r.e.where, ONE_FRAME, name);
    assert.equal(r.c.class, "R3", name);
    assert.equal(r.c.profile, "re-raised", name);
  }
  // OTHERS does not match query_canceled, in either handler; and a lock wait elsewhere on this path keeps its state.
  const stmt = helperRun("statement-timeout-state");
  assert.equal(stmt.e.code, "57014");
  assert.equal(stmt.c.class, "R4");
  for (const [name, state, frame] of [["lock-in-the-digest", "55P03", /pg_temp_\d+\.stage0_digest\(text\) line \d+ at EXECUTE/], ["lock-in-a-check", "55P03", /SQL statement "SELECT pg_temp\.x3_lock\(\)"/], ["deadlock-in-the-digest", "40P01", /pg_temp_\d+\.stage0_digest\(text\) line \d+ at EXECUTE/], ["deadlock-in-a-check", "40P01", /SQL statement "SELECT pg_temp\.x3_deadlock\(\)"/]]) {
    const r = helperRun(name);
    assert.equal(r.e.code, state, name);
    assert.match(r.e.where, frame, name);
    assert.equal(r.c.class, "R4", name);
  }
  // Every catch point in P1-4C's own code: the helper's, the seven sections' and the 11 boundaries'. p1PrimeProblems holds each to it (4W-1).
  const view = sqlCode(P1P, { label: "P1-4C", strings: "blank", bodies: (s) => (s.tag === "stage0_file" ? "data" : "code") });
  const handlers = handlersIn(view);
  assert.equal(handlers.length, 19);
  for (const m of handlers) assert.match(view.slice(m.index, m.index + 80), /^exception\s+when lock_not_available or deadlock_detected then raise;/);
  // Nothing else on the path catches: no wrapper, and none of the 21 files, the forwards it runs or the rollbacks.
  for (const k of ["P2-02", "P2-0304", "P2-05", "RB-5", "RB-43", "RB-2"]) assert.deepEqual(handlersIn(OUT[k]).map((m) => m.index), [], k);
  const blobs = [...M.baselineLedger.map((r) => [r.name, r.blob]), ...M.migrations.map((m) => [m.name, m.blob]), ...M.rollbacks.map((r) => [`rollback ${r.n}`, r.blob])];
  assert.equal(blobs.length, 30);
  for (const [name, blob] of blobs) assert.deepEqual(handlersIn(A.gitBlob(blob, ROOT).toString("utf8")).map((m) => m.index), [], name);
  // The old pinned P1 is unchanged, its helper as it was.
  assert.deepEqual([M.outputs.P1.md5, M.outputs.P1.bytes], ["2546a4a45a79cb2ec8a986df84396a9c", 240125]);
  assert.equal(A.md5(OUT.P1), M.outputs.P1.md5);
  assert.ok(OUT.P1.includes("  exception when others then\n"));
  // WHAT THE HANDLERS DO NOT REACH (plan §6.2). These are not catch points, and the frames fit a profile, so the classifier's own rule is what makes them R4 (X3c), under P1-4C as under P2-02. Synthetic envelopes; stage0-classify.lockstates.test.js has the matrix.
  const executed = `SQL statement "${src.migration(A.MIGRATIONS.find((x) => x.n === "02"))}"\nPL/pgSQL function inline_code_block line 7 at EXECUTE`;
  for (const text of ["P1-4C", "P2-02"]) {
    for (const state of ["55P03", "40P01"]) {
      for (const where of [executed, null]) {
        const a = CL.classifyText(errorReceipt(text, "production", state, "any words", where), ctx);
        assert.equal(a.class, "R4", `${text} ${state}`);
        assert.match(a.reasons[0], /reports SQLSTATE/, `${text} ${state}`);
      }
      // A statement of a check, with its own frame: no profile either.
      assert.equal(CL.classifyText(errorReceipt(text, "production", state, "any words", "PL/pgSQL function inline_code_block line 9 at SQL statement"), ctx).class, "R4", `${text} ${state}`);
    }
  }
});

const FINAL = json("w-old-state.json");
const REF = "abcdefghijklmnopqrst";
const ARBITER_OF = (rows) => rows.filter((r) => r.part === "buckets" && r.key.startsWith("arbiter|")).map((r) => [r.key, r.value]);
/** A stopped shape: both readings' predicates, on the live comparator and from BUILD-01's own run; before any file; and what PostgreSQL does with BUILD-01's first step taken out. */
function assertStopped(name, want, real) {
  const r = json(`w-stop-${name}.json`);
  const bound = C.build01Facts({ build00: r.build00, build00w: r.build00w, ref: REF, finalFrom: FINAL });
  assert.equal(bound.facts, null, `${name}: no facts`);
  assert.deepEqual(C.blocking(bound.findings).map((f) => f.key), [want], `${name}: the comparator, here`);
  assert.deepEqual(r.js, [want], `${name}: the comparator, in the run`);
  assert.deepEqual(r.sql, [want], `${name}: BUILD-01's own read`);
  assert.equal(r.message, `stage0 BUILD-01: the bound acceptance does not hold: ${want}`, name);
  assert.equal(r.code, "P0001", name);
  assert.match(r.where, ONE_FRAME, name);
  assert.deepEqual(r.left, { ledger_absent: true, marker_absent: true, files_absent: true }, `${name}: before any file`);
  if (real === null) assert.deepEqual(r.real, { committed: true }, `${name}: PostgreSQL would take it; the form is narrower`);
  else {
    assert.equal(r.real.committed, false, name);
    assert.equal(r.real.code, real, `${name}: the failure the predicate prevents`);
  }
  return r;
}
function assertCommitted(name) {
  const r = json(`w-commit-${name}.json`);
  const bound = C.build01Facts({ build00: r.build00, build00w: r.build00w, ref: REF, finalFrom: FINAL });
  assert.notEqual(bound.facts, null, `${name}: the facts bind, here: ${JSON.stringify(C.blocking(bound.findings))}`);
  assert.deepEqual(C.blocking(bound.findings), [], name);
  assert.deepEqual(r.stops, [], name);
  assert.equal(r.committed, true, `${name}: BUILD-01 commits`);
  assert.equal(r.success, true, `${name}: its contracted success`);
  assert.equal(r.fingerprintEqual, true, `${name}: the catalog is the local 01's`);
  return r;
}

test("4W-16 X3-R2: the arbiter comes from catalog properties, not an index definition's text. Codex's deferrable key has the accepted definition and stops in both implementations before any file; a nondeferrable key commits", () => {
  assert.equal(A.BUILD_ARBITER, C.BUILD_ARBITER, "one form, in both places");
  // Codex's probe. The definition's text is what X3 accepted; only the properties tell it apart.
  const key = assertStopped("deferrable-key", "buckets-arbiter", "55000");
  assert.match(key.real.message, /^ON CONFLICT does not support deferrable unique constraints\/exclusion constraints as arbiters$/);
  const def = key.build00.find((r) => r.part === "buckets" && r.key === "unique-index|buckets_pkey").value;
  assert.match(def, / ON storage\.buckets USING btree \(id\)$/);
  assert.deepEqual(ARBITER_OF(key.build00), [["arbiter|buckets_pkey", "id|1|1|btree|true|true|true|false|true|false|false|p|true|false|true"]]);
  // The positive: the same key, recreated without DEFERRABLE.
  const plain = assertCommitted("key-recreated");
  assert.deepEqual(ARBITER_OF(plain.build00), [["arbiter|buckets_pkey", C.BUILD_ARBITER]]);
  // The shim's fresh shape is that form, and so is the platform's: another unique index, on name, is no arbiter here.
  assert.deepEqual(ARBITER_OF(oldJson("a-build00.json")), [["arbiter|buckets_pkey", C.BUILD_ARBITER]]);
  const named = assertCommitted("key-and-unique-name");
  assert.deepEqual(ARBITER_OF(named.build00), [["arbiter|bname", "name|1|1|btree|true|true|true|true|false|false|false|<no constraint>"], ["arbiter|buckets_pkey", C.BUILD_ARBITER]]);
  // Every other form, each with what PostgreSQL itself does to it.
  for (const [name, real] of [["deferred-key", "55000"], ["second-deferrable-unique", "55000"], ["partial-key", "42P10"], ["invalid-key", "42P10"], ["composite-key", "42P10"], ["expression-key", "42P10"], ["unique-not-primary", null], ["index-no-constraint", null]]) assertStopped(name, "buckets-arbiter", real);
  // Two arbiters, with one of them the supported form, stop: the executor refuses a deferrable one among them.
  assert.ok(ARBITER_OF(json("w-stop-second-deferrable-unique.json").build00).some(([, v]) => v === C.BUILD_ARBITER));
  // The real statements: the only ON CONFLICT on a platform table is on (id) of storage.buckets, in the two files.
  const files = manifestFiles();
  const conflicts = files.flatMap((f) => [...f.text.matchAll(/insert\s+into\s+(storage|auth)\.\w+[^;]*?on\s+conflict\s*([^;]*?)\s+do\s+/gis)].map((m) => [f.name, m[1].toLowerCase(), m[2]]));
  assert.deepEqual(conflicts.map(([, , arbiter]) => arbiter), ["(id)", "(id)"]);
});

test("4W-17 X3-R3: a bounded text column must hold the literals this build supplies. Codex's varchar(1) stops in both implementations before any file; each column one short stops, exactly long enough commits, and the unbounded forms commit; the literal table is the files' and BUILD-01's own", () => {
  // Codex's probe.
  const short = assertStopped("name-varchar-1", "buckets-columns", "22001");
  assert.equal(short.real.message, "value too long for type character varying(1)");
  // Each column at the boundary, in both implementations, with PostgreSQL's own 22001.
  for (const [name, want] of [["id-one-short", "buckets-columns"], ["name-one-short", "buckets-columns"], ["aud-one-short", "authusers-columns"], ["role-one-short", "authusers-columns"], ["email-one-short", "authusers-columns"]]) assertStopped(name, want, "22001");
  // A form the rule does not name stops, though PostgreSQL would take it.
  assertStopped("name-char-20", "buckets-columns", null);
  // The supported forms commit.
  const typeOf = (rows, part, column) => rows.find((r) => r.part === part && r.key === `column|${column}`).value.split("|")[0];
  const exact = assertCommitted("fit-exact");
  assert.deepEqual(["id", "name"].map((c) => typeOf(exact.build00, "buckets", c)), ["character varying(16)", "character varying(16)"]);
  assert.deepEqual(["aud", "role", "email"].map((c) => typeOf(exact.build00, "authusers", c)), ["character varying(13)", "character varying(13)", "character varying(25)"]);
  const unbounded = assertCommitted("fit-unbounded");
  assert.deepEqual(["id", "name"].map((c) => typeOf(unbounded.build00, "buckets", c)), ["character varying", "character varying"]);
  assert.deepEqual(["aud", "role", "email"].map((c) => typeOf(unbounded.build00, "authusers", c)), ["character varying", "character varying", "character varying"]);
  const texts = assertCommitted("fit-text");
  assert.deepEqual(["aud", "role", "email"].map((c) => typeOf(texts.build00, "authusers", c)), ["text", "text", "text"]);
  // The shim's own varchar(255) is the real auth.users form, and it binds.
  assert.equal(typeOf(oldJson("a-build00.json"), "authusers", "email"), "character varying(255)");
  // The table: the comparator's numbers are the longest of the assembler's literals.
  assert.deepEqual(C.BUILD_LITERAL_LENGTHS, Object.fromEntries(Object.entries(A.BUILD_LITERALS).map(([k, v]) => [k, Math.max(...v.map((s) => s.length))])));
  // The literals are what the build supplies: the files' two INSERTs into storage.buckets, and BUILD-01's one INSERT into auth.users.
  const files = manifestFiles();
  const buckets = files.flatMap((f) => [...f.text.matchAll(/insert\s+into\s+storage\.buckets\s*\(id,\s*name[^)]*\)\s*values\s*\(\s*'([^']*)',\s*'([^']*)'/gi)].map((m) => [m[1], m[2]]));
  assert.deepEqual(buckets, [["job-files", "job-files"], ["customer-uploads", "customer-uploads"]]);
  assert.equal(files.flatMap((f) => [...f.text.matchAll(/insert\s+into\s+storage\.buckets/gi)]).length, 2, "no other INSERT");
  assert.deepEqual(buckets.map(([id]) => id), [...A.BUILD_LITERALS["buckets.id"]]);
  assert.deepEqual(buckets.map(([, name]) => name), [...A.BUILD_LITERALS["buckets.name"]]);
  assert.equal(files.flatMap((f) => [...f.text.matchAll(/insert\s+into\s+auth\.users/gi)]).length, 0, "no file writes auth.users");
  assert.equal(BUILD.split("insert into auth.users (instance_id, id, aud, role, email) values").length - 1, 1);
  for (const [, email] of A.BUILD_USERS) assert.ok(BUILD.includes(`'authenticated', 'authenticated', '${email}')`), email);
  assert.deepEqual([...A.BUILD_LITERALS["authusers.email"]], A.BUILD_USERS.map(([, email]) => email));
});
