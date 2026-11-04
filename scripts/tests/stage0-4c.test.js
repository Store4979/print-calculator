// scripts/tests/stage0-4c.test.js — item 4(c)'s read texts and comparator
// (the implementation outline's X2). The readings are the fixtures
// scripts/manual/stage0-item4c-local-pglite.mjs recorded on PGlite (runs A,
// C, D and F), pinned by sha256 in their index; every store is synthetic.
//   4C-1  the texts: pinned, their policies exact, M-6f admits each and
//         refuses a write, INTO, a quoted identifier, an unlisted function,
//         two statements, set_config, an E-string and a dollar body
//   4C-2  the fixtures are the index's, and each text's success predicate
//         accepts its recorded local result
//   4C-3  P0′ accepts 01 only: the baseline passes; every later reading, a
//         Release 2 row beyond 01's and a missing rehearsal marker stop
//   4C-4  POST′ accepts every legitimate transition (run C, run D), and the
//         other roles' observed rows follow the rule
//   4C-5  V-2's negatives stop with their reason: run F's real GRANTs and
//         membership changes, and mutated rows (a wrong value, a missing
//         row, an extra row, the right rows under the wrong history)
//   4C-6  the data scope: orders grow by exactly the recorded orders; a
//         STOP row stops; pending_jobs is recorded, never a STOP
//   4C-7  the tiers: a MATCH fact that differs stops; a residual needs its
//         record; an unreadable fact stops, never equal
//   4C-8  a reading must reproduce its own md5s; a receipt binds by hash
//   4C-9  the comparator is pinned and audited by listing (CHAIN_LISTED),
//         and no entry loads it
//   4C-10 none of the new texts can be drafted, registered, issued or sent
//         before X4 declares a workflow that names it (Ryan, 2026-11-03)
//   4C-11 R1: a sequence's implicit default is a real sequence owner's, and a
//         real global sequence row replaces it
//   4C-12 R2: a real GRANT and REVOKE GRANT OPTION change the observation and
//         stop an unequal comparison
//   4C-13 R3: any different server_version_num stops, every record present; a
//         build and an image show only in their own evidence
//   4C-14 R4: each differing event trigger needs its own record
//   4C-15 R5: a required fact missing or unusable on both sides stops; an
//         optional one does not
//   4C-16 BUILD-00's guarded ledger read: each real case's status, and what
//         it leaves for BUILD-01; never an empty ledger from a denied read
//   4C-17 M-6f holds query_to_xml to the one reviewed literal in BUILD-00
//   4C-18 B1: only the exact reviewed document shows an empty ledger
//   4C-19 B2: an absence status holds only with facts that agree with it, and
//         an empty ledger only from the one relation form
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
import * as GO from "../manual/stage0-go.mjs";
import { I4C_POLICY, I4C_LEDGER_QUERY, item4cProblems } from "./stage0-manifest-check.mjs";
import { fixture, synthWorkflow, M, ROOT } from "./stage0-guard-fixture.mjs";
import { FIX, raw, json, readingRows, edited as editedWith } from "./stage0-4c-fixture.mjs";

const obs = (name) => C.readObservation(readingRows(name));
const edited = (name, change) => editedWith(C, name, change);
const stops = (findings) => C.blocking(findings);
const reasons = (findings) => stops(findings).map((f) => `${f.key}: ${f.reason}`).join(" | ");
const others = (base) => Object.fromEntries(["01", "02", "04", "05"].map((s) => [s, C.otherRoleRows(M, base, s)]));
const post = (o, step, { baseline, previous, previousState, recordedOrders = 0, target = "rehearsal", windowStart } = {}) =>
  C.postFindings(M, o, { step, target, baseline, previous, previousState, otherRows: others(baseline), recordedOrders, windowStart });
/** One image on both sides, unless a test says otherwise. */
const SAME_IMAGE = { production: "17.6.1.111", rehearsal: "17.6.1.111" };
const cross = (a, b, records = {}, images = SAME_IMAGE) => C.crossProject(a, b, { creator: "postgres", records, images });
/** Every generic residual record, each saying nothing specific. */
const ALL_GENERIC = Object.fromEntries(C.RESIDUALS.map((r) => [r, `a generic ${r} record`]));

test("4C-1 the item 4(c) texts are pinned with exactly their policies, and M-6f admits each and refuses each forbidden form", () => {
  const out = A.assembleAll(M, { cwd: ROOT });
  assert.deepEqual(A.TEXTS_4C.slice().sort(), Object.keys(I4C_POLICY).sort());
  for (const k of A.TEXTS_4C) {
    assert.equal(A.md5(out[k]), M.outputs[k].md5, `${k}: pinned`);
    assert.deepEqual(M.send.texts[k], I4C_POLICY[k], `${k}: its policy`);
    assert.equal(M.send.texts[k].effect, "read");
    assert.deepEqual(item4cProblems(out[k], k), [], `${k}: M-6f admits it`);
  }
  for (const [k, e] of Object.entries(M.item4c.sources)) assert.equal(e.path, A.SOURCES_4C[k]);
  const base = out["WHO-4C-R-RO"];
  for (const [label, text, re] of [
    ["a write", base.replace("select\n", "insert into public.stores (slug) values ('x');\nselect\n"), /insert|statement/],
    ["INTO", base.replace(/;\n$/, " into t;\n"), /\binto\b/],
    ["a quoted identifier", base.replace("pg_roles r", "\"pg_roles\" r"), /quoted identifier/],
    ["an unlisted function", base.replace("current_setting('lock_timeout')", "pg_sleep(1)::text"), /pg_sleep/],
    ["two statements", base + "select 1;\n", /one statement/],
    ["set_config", base.replace("current_setting('lock_timeout')", "set_config('role', 'x', true)"), /set_config/],
    ["an E-string", base.replace("'pg_write_all_data'", "E'pg_write_all_data'"), /E-string/],
    ["a dollar body", base.replace("'pg_read_all_data'", "$q$pg_read_all_data$q$"), /dollar/],
  ]) assert.match(item4cProblems(text, "WHO-4C-R-RO").join("; "), re, label);
});

test("4C-2 the fixtures are exactly the harness's, and each text's success predicate accepts its recorded local result", () => {
  const index = json("index.json").files;
  const present = readdirSync(FIX).filter((f) => f !== "index.json").sort();
  assert.deepEqual(present, Object.keys(index).sort(), "every fixture is indexed, and every indexed one present");
  for (const [f, sha] of Object.entries(index)) assert.equal(createHash("sha256").update(raw(f)).digest("hex"), sha, `${f}: its sha256`);
  const ok = (text, body) => { const r = CL.SUCCESS[text].check(JSON.stringify(body)); assert.equal(r.ok, true, `${text}: ${r.why}`); };
  ok("P0-4C", readingRows("c-01.json"));
  for (const s of ["P2-02", "P2-0304", "P2-05", "RB-5", "RB-43", "RB-2"]) {
    ok("POST-4C", readingRows(`c-${s}.json`));
    ok("STATE-4C", json(`c-${s}-state.json`));
  }
  ok("STATE-4C", json("c-01-state.json"));
  for (const w of A.WHO_4C) ok(w, json("c-01-who.json"));
  ok("BUILD-00", json("a-build00.json"));
  ok("BUILD-00W", json("a-build00w.json"));
  // STATE-4C's mapping, read at each state of run C and run D.
  const rec = (f) => json(f)[0].recovery;
  assert.equal(rec("c-01-state.json"), "none needed — 01 is the floor");
  assert.equal(rec("c-P2-02-state.json"), "RB-2");
  assert.equal(rec("c-P2-0304-state.json"), "RB-43, RB-2");
  assert.equal(rec("c-P2-05-state.json"), "RB-5, RB-43, RB-2");
  assert.equal(rec("c-RB-5-state.json"), "RB-43, RB-2");
  assert.equal(rec("c-RB-43-state.json"), "RB-2");
  assert.equal(rec("c-RB-2-state.json"), "none needed — 01 is the floor");
  assert.equal(rec("d-RB-2-from-02-state.json"), "none needed — 01 is the floor");
  assert.equal(rec("d-RB-43-from-04-state.json"), "RB-2");
});

test("4C-3 P0′ accepts state 01 only: the 01 baseline passes on production; every later reading, a Release 2 row beyond 01's, and a rehearsal without its marker stop", () => {
  const base = obs("c-01.json");
  assert.deepEqual(base.problems, []);
  assert.deepEqual(stops(C.p0Findings(M, base, { target: "production" })), []);
  for (const s of ["P2-02", "P2-0304", "P2-05", "RB-5", "RB-43", "RB-2"]) {
    assert.ok(stops(C.p0Findings(M, obs(`c-${s}.json`), { target: "production" })).length > 0, `${s}'s reading is not P0′'s`);
  }
  const beyond = edited("c-01.json", (rows) => rows.push({ part: 4, key: "exec-r2|postgres|public.release2_prune_auth_attempts(integer)", value: "true" }));
  assert.match(reasons(C.p0Findings(M, beyond, { target: "production" })), /a Release 2 row beyond 01's/);
  assert.match(reasons(C.p0Findings(M, base, { target: "rehearsal" })), /the rehearsal marker is false on rehearsal/);
  const marked = edited("c-01.json", (rows) => { rows.find((r) => r.key === "rehearsal_marker").value = "true"; });
  assert.deepEqual(stops(C.p0Findings(M, marked, { target: "rehearsal" })), []);
  assert.match(reasons(C.p0Findings(M, marked, { target: "production" })), /the rehearsal marker is true on production/);
});

test("4C-4 POST′ accepts every legitimate transition: the forward path and its back-out (run C), RB-2 from a fresh 01–02 and RB-43 from a fresh 01–04 (run D); the other roles' observed rows follow the rule", () => {
  const paths = [
    ["c", "c-01.json", ["P2-02", "P2-0304", "P2-05", "RB-5", "RB-43", "RB-2"], (s) => `c-${s}.json`],
    ["d02", "d-RB-2-from-02-01.json", ["P2-02", "RB-2"], (s) => `d-RB-2-from-02-${s}.json`],
    ["d04", "d-RB-43-from-04-01.json", ["P2-02", "P2-0304", "RB-43"], (s) => `d-RB-43-from-04-${s}.json`],
  ];
  for (const [label, first, steps, file] of paths) {
    const baseline = obs(first);
    assert.deepEqual(stops(C.p0Findings(M, baseline, { target: "production" })), [], `${label}: its own 01 baseline`);
    let previous = baseline, previousState = "01";
    for (const s of steps) {
      const o = obs(file(s));
      assert.equal(C.catalogState(M, o), C.STEP_STATES[s].catalog, `${label} ${s}: the catalog state`);
      assert.deepEqual(stops(post(o, s, { baseline, previous, previousState })), [], `${label} ${s}: accepted`);
      const seen = Object.fromEntries(Object.entries(o.parts[4]).filter(([k]) => k.startsWith("exec-r2|") && !C.V2_ROLES.includes(k.split("|")[1])));
      assert.deepEqual(seen, C.otherRoleRows(M, baseline, C.STEP_STATES[s].catalog), `${label} ${s}: the other roles' rows follow the rule`);
      previous = o; previousState = C.STEP_STATES[s].catalog;
    }
  }
  // V-2's row counts for the three roles: 3, 9, 15, 18.
  for (const [s, n] of [["01", 3], ["02", 9], ["04", 15], ["05", 18]]) assert.equal(Object.keys(C.V2_EXEC[s]).length * 3, n);
  // A planned refusal leaves the previous state unchanged.
  const at02 = obs("c-P2-02.json");
  assert.deepEqual(stops(post(at02, C.REFUSAL, { baseline: obs("c-01.json"), previous: at02, previousState: "02" })), []);
});

test("4C-5 V-2's negatives each stop with their reason: run F's real GRANTs and membership changes, and mutated rows", () => {
  const F = [
    ["f-anon-exec-record-attempt-02", "P2-02", /exec-r2\|anon\|public\.release2_record_attempt.*V-2: EXECUTE is true/],
    ["f-authenticated-exec-css-04", "P2-0304", /exec-r2\|authenticated\|public\.release2_create_staff_session.*V-2: EXECUTE is true/],
    ["f-authenticator-member-service-role-02", "P2-02", /member\|service_role\|supabase_read_only_user/],
    ["f-membership-inherit-02", "P2-02", /member\|authenticated\|authenticator/],
    ["f-anon-select-stores-02", "P2-02", /table\|anon\|public\.stores: differs from the bound baseline/],
    ["f-anon-exec-auth-uid-02", "P2-02", /exec\|anon\|auth\.uid\(\): differs from the bound baseline/],
    ["f-anon-exec-other-function-02", "P2-02", /exec\|anon\|public\.has_store_role\(uuid, text\[\]\): differs from the bound baseline/],
  ];
  for (const [label, step, re] of F) {
    const baseline = obs(`${label}-01.json`);
    let previous = baseline, previousState = "01";
    if (step === "P2-0304") { previous = edited(`${label}.json`, () => {}); previousState = "02"; }
    const o = obs(`${label}.json`);
    const f = step === "P2-0304"
      ? C.postFindings(M, o, { step: C.REFUSAL, target: "rehearsal", baseline, previous: o, previousState: "04", otherRows: others(baseline), recordedOrders: 0 })
      : post(o, step, { baseline, previous, previousState });
    assert.match(reasons(f), re, `${label}: refused with its reason`);
  }
  const baseline = obs("c-01.json");
  const at02 = obs("c-P2-02.json"), at04 = obs("c-P2-0304.json"), at05 = obs("c-P2-05.json");
  // A wrong EXECUTE value, alone (the ACL row as reviewed): V-2 names it.
  const wrong = edited("c-P2-02.json", (rows) => { rows.find((r) => r.key === "exec-r2|anon|public.release2_clear_lockout(text, text, uuid)").value = "true"; });
  assert.match(reasons(post(wrong, "P2-02", { baseline, previous: baseline, previousState: "01" })), /V-2: EXECUTE is true; state 02's reviewed row says false/);
  // A missing expected row: service_role on revoke_enrollment after 05.
  const missing = edited("c-P2-05.json", (rows) => rows.splice(rows.findIndex((r) => r.key === "exec-r2|service_role|public.release2_revoke_enrollment(uuid, uuid, text)"), 1));
  assert.match(reasons(post(missing, "P2-05", { baseline, previous: at04, previousState: "04" })), /release2_revoke_enrollment.*V-2: the reviewed row is missing/);
  // An unexplained extra row: the three-argument clear_lockout after 04.
  const extra = edited("c-P2-0304.json", (rows) => rows.push({ part: 4, key: "exec-r2|anon|public.release2_clear_lockout(text, text, uuid)", value: "false" }));
  assert.match(reasons(post(extra, "P2-0304", { baseline, previous: at02, previousState: "02" })), /release2_clear_lockout\(text, text, uuid\).*V-2: an unexplained extra row/);
  // A row for a role outside the bound role set.
  const stranger = edited("c-P2-02.json", (rows) => rows.push({ part: 4, key: "exec-r2|stranger|public.release2_clear_lockout(text, text, uuid)", value: "true" }));
  assert.match(reasons(post(stranger, "P2-02", { baseline, previous: baseline, previousState: "01" })), /exec-r2\|stranger.*not in the bound rows for the other roles/);
  // The right rows under the wrong history: after-05's reading offered to RB-5's POST′.
  assert.match(reasons(post(at05, "RB-5", { baseline, previous: at05, previousState: "05" })), /the step added 0 ledger rows; RB-5 adds 1/);
});

test("4C-6 the data scope: on the rehearsal orders grow by exactly the recorded orders, and any other data fact that moves stops; on production a STOP row stops and pending_jobs is recorded, never a STOP", () => {
  const baseline = obs("c-01.json");
  const at02 = obs("c-P2-02.json");
  const bump = (key, by) => (rows) => { const r = rows.find((x) => x.key === key); r.value = String(Number(r.value) + by); };
  const ordered = edited("c-P2-02.json", bump("count|public.orders", 1));
  assert.deepEqual(stops(post(ordered, "P2-02", { baseline, previous: baseline, previousState: "01", recordedOrders: 1 })), []);
  assert.match(reasons(post(ordered, "P2-02", { baseline, previous: baseline, previousState: "01", recordedOrders: 0 })), /orders did not grow by exactly the 0 recorded/);
  const other = edited("c-P2-02.json", bump("count|public.print_jobs", 1));
  assert.match(reasons(post(other, "P2-02", { baseline, previous: baseline, previousState: "01", recordedOrders: 1 })), /count\|public\.print_jobs: differs from the previous accepted readback|orders did not grow/);
  // Production, around P1′.
  const after = edited("c-01.json", bump("count|public.employees", 1));
  assert.match(reasons(C.dataScope(baseline, after)), /count\|public\.employees: differs from the window-start P0′/);
  const queued = edited("c-01.json", bump("count|public.pending_jobs", 2));
  assert.deepEqual(stops(C.dataScope(baseline, queued)), [], "pending_jobs is never a STOP");
  assert.ok(C.dataScope(baseline, queued).some((f) => f.verdict === "RECORDED" && f.key === "count|public.pending_jobs"));
  const prodPost = post(at02, "P2-02", { baseline, previous: baseline, previousState: "01", target: "production", windowStart: baseline });
  assert.deepEqual(stops(prodPost), []);
  assert.match(reasons(post(at02, "P2-02", { baseline, previous: baseline, previousState: "01", target: "production" })), /no window-start P0′/);
});

test("4C-7 the tiers between two projects: a MATCH fact that differs stops; a residual needs its record; an unreadable fact stops, never equal", () => {
  const prod = obs("c-01.json");
  const same = cross(prod, prod, { "R-AUTHCFG": "the rehearsal claims no owner sign-in (§4.2)" });
  assert.deepEqual(stops(same), []);
  assert.match(reasons(cross(prod, prod)), /R-AUTHCFG.*with no record/);
  const rec = { "R-AUTHCFG": "no owner sign-in claimed", "R-VER": "the new build", "R-SET": "named only" };
  const differs = edited("c-01.json", (rows) => { rows.find((r) => r.key === "function|has_store_role(uuid, text[])").value += "x"; });
  assert.match(reasons(cross(prod, differs, rec)), /function\|has_store_role.*a MATCH fact differs/);
  const unreadable = edited("c-01.json", (rows) => rows.splice(rows.findIndex((r) => r.key === "fn|auth.uid()"), 1));
  assert.match(reasons(cross(prod, unreadable, rec)), /fn\|auth\.uid\(\): a MATCH fact differs/);
  assert.ok(cross(prod, prod, rec).filter((f) => f.part === 10).every((f) => f.verdict === "RECORDED"), "part 10 is recorded");
});

test("4C-8 a reading must reproduce its own md5s, and a reviewed receipt binds by hash", () => {
  const rows = readingRows("c-01.json");
  const tampered = rows.map((r) => (r.key === "free_pins" ? { ...r, value: "1" } : r));
  assert.match(C.readObservation(tampered).problems.join("; "), /part 10's rows do not reproduce its md5/);
  assert.match(C.readObservation([...rows, rows.find((r) => r.part === 2 && r.key !== "#md5")]).problems.join("; "), /holds key .* twice/);
  assert.match(C.readObservation(rows.filter((r) => !(r.part === 3 && r.key === "#md5"))).problems.join("; "), /part 3 has no md5 row/);
  assert.deepEqual(stops(C.p0Findings(M, C.readObservation(tampered), { target: "production" })).length > 0, true, "never compared");
  const base = obs("c-01.json");
  const binding = C.bindReceipt(base);
  assert.deepEqual(C.bindingFindings(base, binding), []);
  assert.match(C.bindingFindings(obs("c-P2-02.json"), binding).map((f) => f.reason).join("; "), /part 1 is not the bound receipt's/);
  assert.throws(() => C.bindReceipt(C.readObservation(tampered)), /cannot be bound/);
});

test("4C-9 the comparator is pinned and audited by listing, not loaded: CHAIN_LISTED names it, the manifest pins it, the audit passes, and no entry's closure holds it", () => {
  assert.deepEqual(G.CHAIN_LISTED, ["scripts/manual/stage0-4c-compare.mjs"]);
  assert.deepEqual(M.guard.listed, G.CHAIN_LISTED);
  const path = "scripts/manual/stage0-4c-compare.mjs";
  const pin = M.guard.files.find((f) => f.path === path);
  assert.ok(pin, "pinned with the guard chain");
  const src = readFileSync(join(ROOT, path), "utf8");
  assert.deepEqual(G.importAudit(src, path).problems, []);
  assert.deepEqual(G.importAudit(src, path).specs, ["node:crypto"]);
  const read = (p) => { try { return readFileSync(join(ROOT, p), "utf8"); } catch { return null; } };
  for (const e of G.CHAIN_ENTRIES) assert.ok(!G.chainClosure(e, read).files.includes(path), `${e} does not load it`);
});

test("4C-10 none of the new texts can be drafted, registered, issued or sent before X4 declares a workflow that names it: production's and the rehearsal-only ones", async () => {
  // No declared workflow's step names a 4(c) text, so no draft, phase or go can carry one.
  for (const [wname, wf] of Object.entries(G.WORKFLOWS)) {
    for (const [pname, p] of Object.entries(wf.phases)) for (const id of p.steps) assert.ok(!A.TEXTS_4C.includes(wf.stepText(id)), `${wname} ${pname} ${id}`);
  }
  // The real command lines, on a synthetic store.
  const fx = fixture();
  try {
    fx.clock();
    const deps = { manifest: M, anchor: fx.anchor, stateDir: fx.stateDir, now: fx.now, identity: fx.identity, git: fx.git, execArgv: [], stdout: () => {}, ctxAt: fx.ctxAt };
    for (const w of ["item4c", "4c", "rehearsal", "production", "P0-4C"]) {
      assert.throws(() => GO.main(["draft", "--workflow", w, "--phase", "P"], {}, deps), /workflow|phase|refus/i, `draft ${w}`);
    }
    // A go is issued only for a declared step, with that step's text: a go
    // issued for a declared step does not carry a 4(c) text, and the sender
    // refuses one named for another text, before any request.
    const wf = { t: synthWorkflow("production", { P: [["A1", "STATE"]] }) };
    const fy = fixture({ workflows: wf });
    try {
      fy.clock();
      const ph = fy.phase("t", "P");
      const R = fy.window("R", ph.phaseId, { pid: 1001 });
      fy.add(1000);
      const go = fy.issue(ph.phaseId, "A1");
      assert.equal(go.text, "STATE", "the go carries its declared step's text");
      for (const text of ["P0-4C", "POST-4C", "STATE-4C", "WHO-4C-R-RO"]) {
        let err = null;
        try { await fy.send(G, { text, target: "production", win: R, goId: go.goId }); } catch (e) { err = e; }
        assert.ok(err instanceof G.Refusal, `${text}: refused (${err && err.message})`);
        assert.match(err.message, /is not for this send: its text differs/, text);
        assert.equal(fy.calls.length, 0, `${text}: no request`);
      }
    } finally { fy.cleanup(); }
  } finally { fx.cleanup(); }
  // The rehearsal-only texts plan to no target at all; the others only to production.
  for (const k of ["BUILD-00", "BUILD-00W"]) for (const t of ["production", "staging"]) assert.throws(() => S.planSend(M, k, t, { cwd: ROOT }), /may not be sent/);
  for (const k of A.TEXTS_4C.filter((x) => !x.startsWith("BUILD-"))) assert.throws(() => S.planSend(M, k, "staging", { cwd: ROOT }), /may not be sent/);
  assert.throws(() => S.planSend(M, "P0-4C", "rehearsal", { cwd: ROOT }), /unknown target/);
});

// The literal values below are written here, from what PostgreSQL documents,
// not read from the harness's results.
const SEQ_OWNER = "postgres=SELECT/postgres,postgres=UPDATE/postgres,postgres=USAGE/postgres";
const part = (o, n, k) => o.parts[n][k];
const factOf = (rows, p, k) => rows.find((r) => r.part === p && r.key === k)?.value;

test("4C-11 R1: the implicit default for a sequence is a real sequence owner's, not acldefault's foreign server; a real global sequence row replaces it", () => {
  assert.equal(factOf(json("a-build00.json"), "defaults", "implicit|postgres|S"), SEQ_OWNER, "BUILD-00, on a fresh shim");
  assert.equal(part(obs("c-01.json"), 3, "implicit|postgres|S"), SEQ_OWNER, "the checked state, at 01");
  const real = json("g-seq-actual.json");
  assert.equal(real.actual, SEQ_OWNER, "a real sequence's owner entry");
  assert.equal(real.implicit, real.actual, "BUILD-00 reports exactly it");
  assert.equal(real.foreignServer, "USAGE", "acldefault's S is a foreign server: the letter X2 passed");
  // The other four letters are the same in both code systems, and unchanged.
  assert.equal(part(obs("c-01.json"), 3, "implicit|postgres|f"), "PUBLIC=EXECUTE/postgres,postgres=EXECUTE/postgres");
  assert.equal(part(obs("c-01.json"), 3, "implicit|postgres|n"), "postgres=CREATE/postgres,postgres=USAGE/postgres");
  assert.equal(part(obs("c-01.json"), 3, "implicit|postgres|T"), "PUBLIC=USAGE/postgres,postgres=USAGE/postgres");
  assert.match(part(obs("c-01.json"), 3, "implicit|postgres|r"), /^postgres=DELETE\/postgres,.*postgres=UPDATE\/postgres$/);
  // The control: a real global row, and the absent-row and explicit-row readings told apart.
  const d = json("g-seq-row-build00.json");
  assert.deepEqual(d.removed.map((r) => [r.key, r.value]), [["implicit|postgres|S", SEQ_OWNER]]);
  assert.deepEqual(d.added.map((r) => [r.key, r.value]), [["row|postgres|*|S", `anon=SELECT/postgres,${SEQ_OWNER}`]]);
  const row = obs("g-seq-row.json");
  assert.equal(part(row, 3, "row|postgres|*|S"), `anon=SELECT/postgres,${SEQ_OWNER}`);
  assert.equal(part(row, 3, "implicit|postgres|S"), undefined);
  assert.deepEqual(C.requiredFindings(row), [], "a global row covers the sequence default as an implicit one does");
  const f = stops(cross(obs("c-01.json"), row, ALL_GENERIC));
  assert.deepEqual(f.map((x) => x.key).sort(), ["implicit|postgres|S", "row|postgres|*|S"], "the two readings stop on exactly these");
  assert.ok(f.every((x) => /default ACL/.test(x.reason)));
});

test("4C-12 R2: a real GRANT, GRANT OPTION and REVOKE GRANT OPTION change the default-ACL observation and stop an unequal comparison", () => {
  const FN = "PUBLIC=EXECUTE/postgres,anon=EXECUTE/postgres,postgres=EXECUTE/postgres";
  const FNG = "PUBLIC=EXECUTE/postgres,anon=EXECUTE*/postgres,postgres=EXECUTE/postgres";
  const plain = obs("g-grant-plain.json"), option = obs("g-grant-option.json"), revoked = obs("g-grant-revoked.json");
  assert.equal(part(plain, 3, "row|postgres|*|f"), FN);
  assert.equal(part(option, 3, "row|postgres|*|f"), FNG);
  assert.equal(part(revoked, 3, "row|postgres|*|f"), FN, "revoking the option restores it");
  assert.notEqual(plain.md5[3], option.md5[3], "part 3's md5 moves with the grant option");
  assert.equal(plain.md5[3], revoked.md5[3]);
  const f = stops(cross(plain, option, ALL_GENERIC));
  assert.deepEqual(f.map((x) => x.key), ["row|postgres|*|f"], "exactly that row stops, every generic record present");
  assert.match(f[0].reason, /default ACL/);
  assert.deepEqual(stops(cross(plain, revoked, ALL_GENERIC)), []);
  // Within one project, POST′ against the bound baseline.
  const within = stops(post(option, C.REFUSAL, { baseline: plain, previous: plain, previousState: "01" }));
  assert.deepEqual(within.map((x) => x.key), ["row|postgres|*|f"]);
  // BUILD-00: the same real statements change exactly that row.
  const b = json("g-grant-build00.json");
  assert.equal(factOf(b.plain, "defaults", "row|postgres|*|f"), FN);
  assert.deepEqual(b.option.removed.map((r) => [r.key, r.value]), [["row|postgres|*|f", FN]]);
  assert.deepEqual(b.option.added.map((r) => [r.key, r.value]), [["row|postgres|*|f", FNG]]);
  assert.deepEqual([b.revoked.added, b.revoked.removed], [[], []]);
  // Public's own ACL, the row both texts read outside the preserved catalog block.
  const schema = obs("g-schema-option.json");
  assert.match(part(schema, 2, "schema|public"), /anon=USAGE\*,/);
  assert.match(part(obs("c-01.json"), 2, "schema|public"), /anon=USAGE,/);
  assert.deepEqual(stops(cross(obs("c-01.json"), schema, ALL_GENERIC)).map((x) => x.key), ["schema|public"]);
});

test("4C-13 R3: any different server_version_num stops with every record present; a same-number build and an image each need their own record", () => {
  const prod = obs("c-01.json");
  assert.equal(part(prod, 9, "server_version_num"), "170005");
  const at = (num, version = "PostgreSQL synthetic") => edited("c-01.json", (rows) => {
    rows.find((r) => r.key === "server_version_num").value = num;
    rows.find((r) => r.key === "version").value = version;
  });
  // Every generic record, and a keyed one too: none of them can waive a version change.
  const every = { ...ALL_GENERIC, "R-VER|server_version_num": "keyed", "R-IMG|server_version_num": "keyed", "R-VER|version": "keyed", "R-IMG|version": "keyed" };
  for (const [a, b] of [["170005", "170006"], ["170006", "180000"], ["170006", "170005"]]) {
    const f = stops(cross(at(a), at(b), every));
    assert.deepEqual(f.map((x) => x.key), ["server_version_num"], `${a} to ${b}`);
    assert.match(f[0].reason, new RegExp(`a major or minor server change is reviewed: ${a} and ${b}`));
  }
  // The same number, a different build: its own evidence, version(), and its own record.
  const build = at("170005", "PostgreSQL 17.5 another build");
  const none = stops(cross(at("170005", "PostgreSQL 17.5 one build"), build, { "R-AUTHCFG": "x" }));
  assert.deepEqual(none.map((x) => x.key), ["version"]);
  assert.match(none[0].reason, /R-VER: version\(\) differs at one server_version_num.*with no record/);
  const ok = cross(at("170005", "PostgreSQL 17.5 one build"), build, { "R-AUTHCFG": "x", "R-VER": "the new build" });
  assert.deepEqual(stops(ok), []);
  assert.ok(ok.some((f) => f.verdict === "RESIDUAL" && f.key === "version"));
  assert.ok(ok.some((f) => f.verdict === "MATCH" && f.key === "server_version_num"));
  // The image: no SQL read shows it, so it is given, and a difference needs R-IMG's record.
  const noImage = stops(C.crossProject(prod, prod, { creator: "postgres", records: ALL_GENERIC }));
  assert.deepEqual(noImage.map((x) => x.key), ["image"]);
  for (const images of [{ production: "17.6.1.111" }, { production: "17.6.1.111", rehearsal: " " }, "17.6.1.111", null]) {
    assert.deepEqual(stops(C.crossProject(prod, prod, { creator: "postgres", records: ALL_GENERIC, images })).map((x) => x.key), ["image"], JSON.stringify(images));
  }
  const other = { production: "17.6.1.111", rehearsal: "17.6.1.166" };
  assert.match(reasons(cross(prod, prod, { "R-AUTHCFG": "x" }, other)), /image: R-IMG: the images differ: 17\.6\.1\.111 and 17\.6\.1\.166, with no record/);
  const img = cross(prod, prod, { "R-AUTHCFG": "x", "R-IMG": "the current image" }, other);
  assert.deepEqual(stops(img), []);
  assert.ok(img.some((f) => f.verdict === "RESIDUAL" && f.key === "image"));
  assert.ok(cross(prod, prod, { "R-AUTHCFG": "x" }).some((f) => f.verdict === "MATCH" && f.key === "image"));
  // A number that is not one, on both sides, equal or not.
  for (const bad of ["17.6", "1e6", "160010", "", "0170005", "170005 "]) {
    assert.match(reasons(C.p0Findings(M, at(bad), { target: "production" })), /server_version_num: a required fact is not usable/, JSON.stringify(bad));
    assert.match(reasons(cross(at(bad), at(bad), ALL_GENERIC)), /server_version_num: production's baseline: a required fact is not usable/, JSON.stringify(bad));
  }
});

test("4C-14 R4: each differing event trigger needs its own record: an added trigger, a changed body and a removed trigger are refused with only a generic R-IMG, and accepted with theirs", () => {
  const TRIGGER = "ddl_command_end|O||f|postgres|plpgsql|00000000000000000000000000000000|";
  const OTHER = "ddl_command_end|O||f|postgres|plpgsql|11111111111111111111111111111111|";
  const push = (key, value) => (rows) => rows.push({ part: 8, key, value });
  const base = edited("c-01.json", push("evt|one", TRIGGER));
  const cases = [
    ["added", edited("c-01.json", (rows) => { push("evt|one", TRIGGER)(rows); push("evt|two", TRIGGER)(rows); }), "evt|two"],
    ["a changed body", edited("c-01.json", push("evt|one", OTHER)), "evt|one"],
    ["removed", obs("c-01.json"), "evt|one"],
  ];
  for (const [label, reh, key] of cases) {
    const generic = stops(cross(base, reh, ALL_GENERIC));
    assert.deepEqual(generic.map((x) => x.key), [key], `${label}: a generic R-IMG does not cover it`);
    assert.match(generic[0].reason, new RegExp(`with no record under R-IMG\\|${key.replace("|", "\\|")}`), label);
    const another = stops(cross(base, reh, { ...ALL_GENERIC, "R-IMG|evt|unrelated": "reviewed, another trigger" }));
    assert.deepEqual(another.map((x) => x.key), [key], `${label}: another trigger's record does not cover it`);
    assert.deepEqual(stops(cross(base, reh, { ...ALL_GENERIC, [`R-IMG|${key}`]: "   " })).map((x) => x.key), [key], `${label}: a blank record is none`);
    const own = cross(base, reh, { ...ALL_GENERIC, [`R-IMG|${key}`]: `${key}: reviewed; what its behaviour leaves unproven` });
    assert.deepEqual(stops(own), [], `${label}: its own record`);
    assert.ok(own.some((f) => f.verdict === "RESIDUAL" && f.key === key && f.part === 8), label);
  }
  // Equal triggers, and an empty part 8 on both sides, need no record.
  assert.deepEqual(stops(cross(base, base, { "R-AUTHCFG": "x" })), []);
  assert.deepEqual(Object.keys(obs("c-01.json").parts[8]), [], "the local run has no event trigger");
  assert.deepEqual(stops(cross(obs("c-01.json"), obs("c-01.json"), { "R-AUTHCFG": "x" })), []);
});

test("4C-15 R5: a required fact missing or unusable on both sides stops every comparison; optional settings and an empty event-trigger part do not", () => {
  const records = { ...ALL_GENERIC };
  const drop = (keys) => edited("c-01.json", (rows) => { for (const k of keys) { const i = rows.findIndex((r) => r.key === k); assert.ok(i >= 0, k); rows.splice(i, 1); } });
  const set = (values) => edited("c-01.json", (rows) => { for (const [k, v] of Object.entries(values)) { const r = rows.find((x) => x.key === k); assert.ok(r, k); r.value = v; } });
  const REQUIRED = ["pgcrypto", ...C.REQUIRED_FUNCTIONS.map((f) => `fn|${f}`), ...Object.keys(C.REQUIRED_AUTH_COLUMNS).map((c) => `authusers-col|${c}`),
    "authusers-notnull-nodefault", "authusers-user-triggers", "ext|pgcrypto", "server_version_num", "version", "fingerprint", "schema|public", "columns", "count", "head",
    ...C.DATA_SCOPE.stop, ...Object.keys(C.DATA_SCOPE.recorded)];
  assert.equal(C.REQUIRED_FUNCTIONS.length, 4);
  assert.deepEqual(Object.keys(C.REQUIRED_AUTH_COLUMNS).sort(), ["aud", "email", "id", "instance_id", "role"]);
  for (const k of REQUIRED) {
    const o = drop([k]);
    assert.ok(stops(C.requiredFindings(o)).some((f) => f.key === k), `${k}: requiredFindings names it`);
    for (const [label, f] of [["P0′", C.p0Findings(M, o, { target: "production" })], ["both sides", cross(o, o, records)], ["the data scope", C.dataScope(o, o)]]) {
      assert.ok(stops(f).some((x) => x.key === k && /a required fact is missing/.test(x.reason)), `${k}: ${label}`);
    }
  }
  // Codex's reading: pgcrypto and its functions absent, equal on both sides.
  const absent = edited("c-01.json", (rows) => {
    for (const r of rows) if (r.part === 6 && (r.key === "pgcrypto" || r.key.startsWith("fn|extensions."))) r.value = "<absent>";
    for (let i = rows.length - 1; i >= 0; i--) if ((rows[i].part === 7 && rows[i].key === "ext|pgcrypto") || (rows[i].part === 4 && rows[i].key.includes("|extensions."))) rows.splice(i, 1);
  });
  for (const f of [C.p0Findings(M, absent, { target: "production" }), cross(absent, absent, records)]) {
    assert.match(reasons(f), /pgcrypto: .*a required fact is not usable \(<absent>\)/);
    assert.match(reasons(f), /fn\|extensions\.digest\(text, text\): .*a required fact is not usable \(<absent>\)/);
    assert.match(reasons(f), /ext\|pgcrypto: .*a required fact is missing/);
    assert.match(reasons(f), /exec\|service_role\|extensions\.gen_random_bytes\(integer\): .*a required fact is missing/);
  }
  // Equal on both sides, and each unusable.
  for (const [label, values, key] of [
    ["auth.uid() absent", { "fn|auth.uid()": "<absent>" }, "fn|auth.uid()"],
    ["a function fact without its md5", { "fn|auth.uid()": "postgres|s|" }, "fn|auth.uid()"],
    ["a fixture column of another type", { "authusers-col|id": "text|true|" }, "authusers-col|id"],
    ["a fixture column cut short", { "authusers-col|email": "character varying(255)" }, "authusers-col|email"],
    ["a NOT NULL column beyond the fixtures'", { "authusers-notnull-nodefault": "id,tenant_id" }, "authusers-notnull-nodefault"],
    ["a user trigger", { "authusers-user-triggers": "1" }, "authusers-user-triggers"],
    ["pgcrypto elsewhere", { pgcrypto: "1.3|public", "ext|pgcrypto": "1.3|public" }, "pgcrypto"],
    ["part 7 not part 6's", { "ext|pgcrypto": "9.9|extensions" }, "ext|pgcrypto"],
    ["a count that is no count", { "count|public.employees": "many" }, "count|public.employees"],
    ["a digest that is no digest", { "digest|public.employees": "<null>" }, "digest|public.employees"],
    ["a flag that is no flag", { probe_slug_absent: "<null>" }, "probe_slug_absent"],
    ["a free-PIN count that is no count", { free_pins: "" }, "free_pins"],
    ["a role absent", { "attr|service_role": "<absent>" }, "attr|service_role"],
    ["an EXECUTE fact that is no flag", { "exec|anon|auth.uid()": "<null>" }, "exec|anon|auth.uid()"],
  ]) {
    const o = set(values);
    assert.ok(stops(cross(o, o, records)).some((f) => f.key === key && /a required fact/.test(f.reason)), `${label}: both sides`);
    assert.ok(stops(C.p0Findings(M, o, { target: "production" })).some((f) => f.key === key), `${label}: P0′`);
  }
  // Postgres's default for each object type: a global row or an implicit one, never neither or both.
  const neither = drop(["implicit|postgres|f"]);
  assert.match(reasons(cross(neither, neither, records)), /postgres\|f: .*this reading has neither/);
  const both = edited("c-01.json", (rows) => rows.push({ part: 3, key: "row|postgres|*|f", value: "postgres=EXECUTE/postgres" }));
  assert.match(reasons(C.p0Findings(M, both, { target: "production" })), /postgres\|f: .*this reading has both/);
  // POST′: the same hole, with the reading, the baseline and the window start each lacking the fact.
  const baseline = obs("c-01.json");
  const noEmp = (name) => edited(name, (rows) => rows.splice(rows.findIndex((r) => r.key === "count|public.employees"), 1));
  const after = noEmp("c-P2-02.json"), base = noEmp("c-01.json");
  assert.match(reasons(post(after, "P2-02", { baseline: base, previous: base, previousState: "01", target: "production", windowStart: base })), /count\|public\.employees: a required fact is missing/);
  assert.match(reasons(post(after, "P2-02", { baseline: base, previous: base, previousState: "01" })), /count\|public\.employees: a required fact is missing/);
  assert.match(reasons(post(obs("c-P2-02.json"), "P2-02", { baseline, previous: baseline, previousState: "01", target: "production", windowStart: base })), /count\|public\.employees: the window-start P0′: a required fact is missing/);
  // A receipt without them is not bound.
  assert.throws(() => C.bindReceipt(drop(["fn|auth.uid()"])), /without its required facts cannot be bound: fn\|auth\.uid\(\): a required fact is missing/);
  // Not every sentinel: an optional setting and an empty part 8 stay allowed.
  const noSession = drop(["session|lock_timeout"]);
  assert.deepEqual(stops(cross(noSession, noSession, { "R-AUTHCFG": "x" })), [], "an allowlisted setting's absence is compared, and is not a required fact");
  const named = edited("c-01.json", (rows) => rows.push({ part: 5, key: "setting|postgres|*|app.settings.jwt_secret", value: "<name only>" }));
  assert.deepEqual(stops(cross(named, named, { "R-AUTHCFG": "x" })), [], "an unlisted setting, known by name only, on both sides");
  assert.deepEqual(C.requiredFindings(obs("c-01.json")), [], "the 01 reading, with an empty part 8, holds them all");
  // A required fact on one side only stays a difference too.
  assert.ok(stops(cross(baseline, drop(["fn|auth.uid()"]), records)).some((f) => f.key === "fn|auth.uid()" && /a MATCH fact differs/.test(f.reason)));
});

test("4C-16 BUILD-00's guarded ledger read: each real case gives its status in an ordinary and a read-only transaction; only nothing there, or the pinned table with no row, leaves BUILD-01 free; a denied or hidden read is never empty", () => {
  const ledger = (f) => json(`l-${f}.json`);
  for (const [name, status, stopRe] of [
    ["absent-schema", "absent-schema", null],
    ["absent-table", "absent-table", null],
    ["empty", "empty", null],
    ["reader-empty", "empty", null],
    ["populated", "populated", /already holds rows/],
    ["reader-populated", "populated", /already holds rows/],
    ["extra-column", "unsupported-shape", /not an ordinary table with production's six columns/],
    ["missing-columns", "unsupported-shape", /not an ordinary table with production's six columns/],
    ["wrong-type", "unsupported-shape", /not an ordinary table with production's six columns/],
    ["view", "unsupported-shape", /not an ordinary table with production's six columns/],
    ["denied-schema", "denied-schema", /no USAGE on the ledger's schema/],
    ["denied-read", "denied-read", /may not read the ledger/],
    ["hidden-read", "hidden-read", /rows may be hidden/],
    ["partial-read", "hidden-read", /rows may be hidden/],
  ]) {
    const { ordinary, readOnly } = ledger(name);
    assert.deepEqual(ordinary, readOnly, `${name}: the same in a read-only transaction`);
    assert.equal(factOf(ordinary, "ledger", "status"), status, name);
    const f = C.build00LedgerFindings(ordinary);
    if (stopRe) assert.match(reasons(f), stopRe, name);
    else assert.deepEqual(stops(f), [], name);
    assert.ok(f.some((x) => x.verdict === "RECORDED" && x.key === "status" && x.reason === status), `${name}: the status is reported`);
    const read = status === "empty" || status === "populated";
    assert.equal(factOf(ordinary, "ledger", "rows") === "<not read>", !read, `${name}: rows are read only under a read status`);
    assert.ok(!JSON.stringify(ordinary).includes("BODY-MARKER") && !JSON.stringify(ordinary).includes("one;"), `${name}: never a statement's text`);
  }
  assert.equal(factOf(ledger("absent-schema").ordinary, "ledger", "schema"), "false");
  assert.equal(factOf(ledger("absent-table").ordinary, "ledger", "schema"), "true");
  assert.equal(factOf(ledger("absent-table").ordinary, "ledger", "table"), "false");
  // The rows: identity and digests, written here independently of the harness.
  const rows = factOf(ledger("populated").ordinary, "ledger", "rows");
  for (const piece of ["<version>20260101000000</version>", "<name>a &lt;row&gt; &amp; name</name>", `<statements_md5>${C.md5("select 'BODY-MARKER';")}</statements_md5>`,
    "<statements_bytes>21</statements_bytes>", "<statements_count>1</statements_count>", "<created_by>store4979@theupsstore.com</created_by>",
    "<version>20260102000000</version>", "<name xsi:nil=\"true\"/>", `<statements_md5>${C.md5("one;")}</statements_md5>`, "<statements_count>2</statements_count>",
    "<idempotency_key_null>false</idempotency_key_null>", "<rollback_null>true</rollback_null>"]) assert.ok(rows.includes(piece), piece);
  assert.equal(rows.split("<row>").length - 1, 2, "a name holding <row> is escaped, so it counts no row");
  // The six columns are the manifest's, in catalog terms.
  const asManifest = C.LEDGER_COLUMNS.split(", ").map((c) => { const [n, t, nn, d] = c.split(":"); return `${n}:${t === "text[]" ? "ARRAY" : t}:${nn === "true" ? "NO" : "YES"}:${d}`; }).join(", ");
  assert.equal(asManifest, M.ledgerRow.columns);
  assert.equal(factOf(ledger("empty").ordinary, "ledger", "columns"), C.LEDGER_COLUMNS);
  // The local database at 01 has the 21 rows, and BUILD-00 would stop on them.
  const at01 = json("l-at01.json");
  assert.equal(factOf(at01, "ledger", "rows").split("<row>").length - 1, 21);
  assert.match(reasons(C.build00LedgerFindings(at01)), /already holds rows/);
  // Without the guard, a hidden read shows no row and a denied one fails.
  assert.deepEqual(json("l-bare-controls.json"), { hidden: { ownerSeesRow: true, reader: { seesRow: false } }, denied: { ownerSeesRow: true, reader: "error 42501" } });
  // Total: malformed readings stop, and a reading cannot pass for empty.
  const EMPTY = ledger("empty").ordinary;
  const change = (key, value) => EMPTY.map((r) => (r.key === key ? { ...r, value } : r));
  assert.deepEqual(stops(C.build00LedgerFindings(EMPTY)), []);
  for (const [label, input, re] of [
    ["not a list", null, /not a list of rows/],
    ["no ledger part", [{ part: "defaults", key: "x", value: "y" }], /did not report it/],
    ["no status", EMPTY.filter((r) => r.key !== "status"), /status: BUILD-00 did not report it/],
    ["no rows", EMPTY.filter((r) => r.key !== "rows"), /rows: BUILD-00 did not report it/],
    ["an unknown status", change("status", "readable"), /not a status BUILD-00 reports/],
    ["a key twice", [...EMPTY, EMPTY[0]], /the key appears twice/],
    ["a value that is not text", [...EMPTY.filter((r) => r.key !== "rows"), { part: "ledger", key: "rows", value: null }], /a ledger row is not text/],
    ["a row that is not an object", [null, ...EMPTY], /a row is not an object/],
    ["empty, from other columns", change("columns", "version:text:true:"), /without production's six columns/],
    ["empty, with no table", change("table", "false"), /table: false, under the status empty/],
    ["empty, with no schema", change("schema", "false"), /schema: false, under the status empty/],
  ]) assert.match(reasons(C.build00LedgerFindings(input)), re, label);
  const DENIED = ledger("denied-read").ordinary;
  assert.match(reasons(C.build00LedgerFindings(DENIED.map((r) => (r.key === "rows" ? { ...r, value: "<table x>\n</table>\n" } : r)))), /a result under the status denied-read/);
  assert.match(reasons(C.build00LedgerFindings(ledger("absent-table").ordinary.map((r) => (r.key === "schema" ? { ...r, value: "false" } : r)))), /schema: false, under the status absent-table/);
});

test("4C-17 M-6f holds query_to_xml to the one reviewed literal, in BUILD-00 only: a nested write, a non-literal argument, changed flags and other XML functions each fail", () => {
  const out = A.assembleAll(M, { cwd: ROOT });
  const text = out["BUILD-00"];
  assert.deepEqual(item4cProblems(text, "BUILD-00"), []);
  const call = `query_to_xml('${I4C_LEDGER_QUERY}', true, false, '')`;
  assert.equal(text.split(call).length, 2, "the text holds the reviewed call once");
  const literal = `'${I4C_LEDGER_QUERY}'`;
  // Read as a text of its own, M-6f's other rules find one word in the literal: the ledger's rollback column.
  assert.deepEqual(item4cProblems(`${I4C_LEDGER_QUERY};`, "the literal"), ["the literal holds rollback"]);
  // It names no statement's text: each of the three stored columns appears only under md5, octet_length, cardinality or a null test.
  assert.ok(!/m\.statements\s*(,| from)/.test(I4C_LEDGER_QUERY) && !/m\.rollback\s*(,| from)/.test(I4C_LEDGER_QUERY) && !/m\.idempotency_key\s*(,| from)/.test(I4C_LEDGER_QUERY));
  const NOT_REVIEWED = /query_to_xml arguments are not the reviewed literal and flags/;
  for (const [label, mutated, re] of [
    ["a nested write", text.replace(literal, "'insert into public.stores (slug) values (''x'') returning slug'"), NOT_REVIEWED],
    ["a nested delete", text.replace(literal, "'with d as (delete from supabase_migrations.schema_migrations returning version) select * from d'"), NOT_REVIEWED],
    ["a nested read of the bodies", text.replace(literal, "'select statements from supabase_migrations.schema_migrations'"), NOT_REVIEWED],
    ["one space added", text.replace(literal, `' ${I4C_LEDGER_QUERY}'`), NOT_REVIEWED],
    ["a column for an argument", text.replace(literal, "g.verdict"), NOT_REVIEWED],
    ["a concatenation after the literal", text.replace(literal, `${literal} || ' limit 1'`), NOT_REVIEWED],
    ["a concatenation before it", text.replace(literal, `'select 1;' || ${literal}`), NOT_REVIEWED],
    ["a built string", text.replace(literal, "chr(115) || 'elect 1'"), NOT_REVIEWED],
    ["a string continued onto the literal", text.replace(literal, `${literal}\n' limit 1'`), NOT_REVIEWED],
    ["another flag", text.replace(`${literal}, true, false, ''`, `${literal}, false, false, ''`), NOT_REVIEWED],
    ["a target namespace", text.replace(`${literal}, true, false, ''`, `${literal}, true, false, 'x'`), NOT_REVIEWED],
    ["no call", text.replace(call, "null::text"), /calls query_to_xml 0 times/],
    ["a second call", text.replace(call, `${call} || ${call}`), /calls query_to_xml 2 times/],
    ["another XML function", text.replace(call, `table_to_xml('supabase_migrations.schema_migrations', true, false, '')`), /table_to_xml/],
    ["the schema form", text.replace(call, `${call} || query_to_xml_and_xmlschema('select 1', true, false, '')`), /query_to_xml_and_xmlschema/],
  ]) {
    assert.notEqual(mutated, text, label);
    assert.match(item4cProblems(mutated, "BUILD-00").join("; "), re, label);
  }
  for (const k of A.TEXTS_4C.filter((x) => x !== "BUILD-00")) {
    const mutated = out[k].replace(/;\n$/, ` union all select query_to_xml(${literal}, true, false, '')::text;\n`);
    assert.notEqual(mutated, out[k], k);
    assert.match(item4cProblems(mutated, k).join("; "), /calls query_to_xml; only BUILD-00 may/, k);
    assert.deepEqual(item4cProblems(out[k], k), [], `${k}: as it is`);
  }
});

// Written here, independently of the comparator and of the harness; 4C-18 and
// 4C-19 check them against PostgreSQL's own results in the run L fixtures.
const EMPTY_DOCUMENT = "<table xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\">\n\n</table>\n";
const SIX_COLUMNS = "version:text:true:, statements:text[]:false:, name:text:false:, created_by:text:false:, idempotency_key:text:false:, rollback:text[]:false:";
const ledgerOnly = (rows, key, value) => rows.map((r) => (r.key === key ? { ...r, value } : r));

test("4C-18 B1: only the exact reviewed document shows an empty ledger: Codex's three negatives, a cut-short document and every other form stop, on that fact alone; PostgreSQL's own result passes", () => {
  for (const name of ["empty", "reader-empty"]) {
    const { ordinary, readOnly } = json(`l-${name}.json`);
    for (const rows of [ordinary, readOnly]) {
      assert.equal(factOf(rows, "ledger", "rows"), EMPTY_DOCUMENT, `${name}: PostgreSQL's own empty result`);
      assert.deepEqual(stops(C.build00LedgerFindings(rows)), [], `${name}: it passes`);
    }
  }
  const EMPTY = json("l-empty.json").ordinary;
  const XSI = "xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\"";
  for (const [label, doc] of [
    // Codex's three reproductions, byte for byte (review of 5ae51c6, B1).
    ["malformed XML", "<table invalid>\n</table>\n"],
    ["an unfamiliar child", `<table ${XSI}>\n<unexpected/>\n</table>\n`],
    ["an empty row element", `<table ${XSI}>\n<row/>\n</table>\n`],
    // A cut-short document, each way.
    ["cut short, an opening tag only", "<table xmlns:xsi=\"x\">\n"],
    ["cut short, the reviewed start", EMPTY_DOCUMENT.slice(0, -"</table>\n".length)],
    ["cut short, its final newline", EMPTY_DOCUMENT.slice(0, -1)],
    // A row, and every other form of no row.
    ["a real row", `<table ${XSI}>\n\n<row>\n  <version>20260101000000</version>\n</row>\n\n</table>\n`],
    ["another namespace value", "<table xmlns:xsi=\"x\">\n\n</table>\n"],
    ["a further attribute", `<table ${XSI} xmlns="x">\n\n</table>\n`],
    ["a wrapper around it", `<x>\n${EMPTY_DOCUMENT}</x>\n`],
    ["a prolog before it", `<?xml version="1.0"?>\n${EMPTY_DOCUMENT}`],
    ["a comment inside it", `<table ${XSI}>\n<!-- -->\n</table>\n`],
    ["no blank line", `<table ${XSI}>\n</table>\n`],
    ["CRLF line ends", EMPTY_DOCUMENT.replaceAll("\n", "\r\n")],
    ["a leading space", ` ${EMPTY_DOCUMENT}`],
    ["a trailing newline", `${EMPTY_DOCUMENT}\n`],
    ["nothing at all", ""],
    ["the words for a read that did not run", "<not read>"],
  ]) {
    const found = stops(C.build00LedgerFindings(ledgerOnly(EMPTY, "rows", doc)));
    assert.deepEqual(found.map((f) => [f.key, f.reason]), [["rows", "not the reviewed empty document, byte for byte"]], label);
  }
  // `populated` stops whatever its document holds: no row parser is needed.
  for (const doc of ["<table invalid>\n", EMPTY_DOCUMENT, ""]) {
    const found = stops(C.build00LedgerFindings(ledgerOnly(json("l-populated.json").ordinary, "rows", doc)));
    assert.deepEqual(found.map((f) => f.key), ["status"], doc);
    assert.match(found[0].reason, /already holds rows/);
  }
});

test("4C-19 B2: an absence status holds only with the facts that agree with it, keeping the schema's presence apart; an empty ledger holds only in the one relation form; an unknown fact stops", () => {
  const ROW = (key, value) => ({ part: "ledger", key, value });
  for (const [status, schema, other] of [["absent-schema", "false", "true"], ["absent-table", "true", "false"]]) {
    const { ordinary, readOnly } = json(`l-${status}.json`);
    for (const rows of [ordinary, readOnly]) {
      // What PostgreSQL reported, written out here: exactly these six facts.
      assert.deepEqual(Object.fromEntries(rows.map((r) => [r.key, r.value])), { columns: "", relation: "", rows: "<not read>", schema, status, table: "false" }, status);
      assert.deepEqual(stops(C.build00LedgerFindings(rows)), [], `${status}: the SQL's own result passes`);
    }
    for (const [label, input, key, re] of [
      // Codex's three reproductions (review of 5ae51c6, B2), for both statuses.
      ["a relation", ledgerOnly(ordinary, "relation", "r|postgres|false|false"), "relation", /has no relation/],
      ["the six columns", ledgerOnly(ordinary, "columns", SIX_COLUMNS), "columns", /a relation's columns/],
      ["a constraint", [...ordinary, ROW("constraint|some_pkey", "p|PRIMARY KEY (version)")], "constraint|some_pkey", /a relation's fact/],
      ["a trigger", [...ordinary, ROW("trigger|some_trigger", "O|CREATE TRIGGER some_trigger")], "trigger|some_trigger", /a relation's fact/],
      ["a view for a relation", ledgerOnly(ordinary, "relation", "v|postgres|false|false"), "relation", /has no relation/],
      ["one column", ledgerOnly(ordinary, "columns", "version:text:true:"), "columns", /a relation's columns/],
      ["a table", ledgerOnly(ordinary, "table", "true"), "table", /^true, under the status/],
      ["the other status's schema fact", ledgerOnly(ordinary, "schema", other), "schema", new RegExp(`^${other}, under the status ${status}$`)],
      ["a document", ledgerOnly(ordinary, "rows", EMPTY_DOCUMENT), "rows", /a result under the status/],
      ["no result at all", ledgerOnly(ordinary, "rows", ""), "rows", /a result under the status/],
      ["no relation fact", ordinary.filter((r) => r.key !== "relation"), "relation", /did not report it/],
      ["no columns fact", ordinary.filter((r) => r.key !== "columns"), "columns", /did not report it/],
      ["an unknown fact", [...ordinary, ROW("other", "x")], "other", /not a fact BUILD-00 reports/],
    ]) {
      const found = stops(C.build00LedgerFindings(input));
      assert.deepEqual(found.map((f) => f.key), [key], `${status}, ${label}`);
      assert.match(found[0].reason, re, `${status}, ${label}`);
    }
    // Several contradictions at once are each named.
    const all = [...ledgerOnly(ledgerOnly(ordinary, "relation", "r|postgres|false|false"), "columns", SIX_COLUMNS), ROW("constraint|a", "p"), ROW("trigger|b", "O")];
    assert.deepEqual(stops(C.build00LedgerFindings(all)).map((f) => f.key).sort(), ["columns", "constraint|a", "relation", "trigger|b"], status);
  }
  // The empty path: the one relation form, on both real empty cases.
  const FORM = "r|postgres|false|false";
  for (const name of ["empty", "reader-empty"]) {
    const { ordinary } = json(`l-${name}.json`);
    assert.equal(factOf(ordinary, "ledger", "relation"), FORM, name);
    assert.equal(factOf(ordinary, "ledger", "columns"), SIX_COLUMNS, name);
    for (const form of ["v|postgres|false|false", "p|postgres|false|false", "r", "r|", "r|postgres", "r|postgres|false", "r|postgres|false|false|x", "r||false|false",
      "r|postgres|true|false", "r|postgres|false|true", "r|postgres|true|true", "r|supabase_admin|false|false", " r|postgres|false|false", "R|postgres|false|false", ""]) {
      const found = stops(C.build00LedgerFindings(ledgerOnly(ordinary, "relation", form)));
      assert.deepEqual(found.map((f) => f.key), ["relation"], `${name}, ${form}`);
      assert.match(found[0].reason, /not the one relation form reviewed/, `${name}, ${form}`);
    }
    // Its constraints are reported, not judged here; an unknown fact stops.
    assert.ok(ordinary.some((r) => r.key.startsWith("constraint|")), name);
    assert.deepEqual(stops(C.build00LedgerFindings(ordinary.filter((r) => !r.key.startsWith("constraint|")))), [], `${name}: binding the shape is the binding commit's`);
    for (const key of ["other", "__proto__", "constraint", "trigger"]) {
      assert.deepEqual(stops(C.build00LedgerFindings([...ordinary, ROW(key, "x")])).map((f) => f.reason), ["not a fact BUILD-00 reports"], `${name}, ${key}`);
    }
  }
});
