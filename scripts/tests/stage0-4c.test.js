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
//         record; an unreadable fact stops, never equal; an event trigger's
//         differing digest stops or needs an R-IMG record
//   4C-8  a reading must reproduce its own md5s; a receipt binds by hash
//   4C-9  the comparator is pinned and audited by listing (CHAIN_LISTED),
//         and no entry loads it
//   4C-10 none of the new texts can be drafted, registered, issued or sent
//         before X4 declares a workflow that names it (Ryan, 2026-11-03)
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
import { I4C_POLICY, item4cProblems } from "./stage0-manifest-check.mjs";
import { fixture, synthWorkflow, M, ROOT } from "./stage0-guard-fixture.mjs";
import { FIX, raw, json, readingRows, edited as editedWith } from "./stage0-4c-fixture.mjs";

const obs = (name) => C.readObservation(readingRows(name));
const edited = (name, change) => editedWith(C, name, change);
const stops = (findings) => C.blocking(findings);
const reasons = (findings) => stops(findings).map((f) => `${f.key}: ${f.reason}`).join(" | ");
const others = (base) => Object.fromEntries(["01", "02", "04", "05"].map((s) => [s, C.otherRoleRows(M, base, s)]));
const post = (o, step, { baseline, previous, previousState, recordedOrders = 0, target = "rehearsal", windowStart } = {}) =>
  C.postFindings(M, o, { step, target, baseline, previous, previousState, otherRows: others(baseline), recordedOrders, windowStart });

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

test("4C-7 the tiers between two projects: a MATCH fact that differs stops; a residual needs its record; an unreadable fact stops, never equal; an event trigger's differing digest stops or needs an R-IMG record", () => {
  const prod = obs("c-01.json");
  const same = C.crossProject(prod, prod, { creator: "postgres", records: { "R-AUTHCFG": "the rehearsal claims no owner sign-in (§4.2)" } });
  assert.deepEqual(stops(same), []);
  assert.match(reasons(C.crossProject(prod, prod, { creator: "postgres" })), /R-AUTHCFG.*with no record/);
  const rec = { "R-AUTHCFG": "no owner sign-in claimed", "R-IMG|version": "the new image", "R-IMG|evt|x": "reviewed", "R-SET": "named only" };
  const differs = edited("c-01.json", (rows) => { rows.find((r) => r.key === "function|has_store_role(uuid, text[])").value += "x"; });
  assert.match(reasons(C.crossProject(prod, differs, { creator: "postgres", records: rec })), /function\|has_store_role.*a MATCH fact differs/);
  const unreadable = edited("c-01.json", (rows) => rows.splice(rows.findIndex((r) => r.key === "fn|auth.uid()"), 1));
  assert.match(reasons(C.crossProject(prod, unreadable, { creator: "postgres", records: rec })), /fn\|auth\.uid\(\): a MATCH fact differs/);
  const image = edited("c-01.json", (rows) => { rows.find((r) => r.key === "version").value += " (another build)"; });
  assert.deepEqual(stops(C.crossProject(prod, image, { creator: "postgres", records: rec })), [], "R-IMG with its record");
  assert.match(reasons(C.crossProject(prod, image, { creator: "postgres", records: { "R-AUTHCFG": "x" } })), /R-IMG: the image's version string differs, with no record/);
  const minor = edited("c-01.json", (rows) => { rows.find((r) => r.key === "server_version_num").value = "170100"; });
  assert.match(reasons(C.crossProject(prod, minor, { creator: "postgres", records: rec })), /a major or minor server change is reviewed/);
  const trigger = edited("c-01.json", (rows) => rows.push({ part: 8, key: "evt|x", value: "ddl_command_end|O||f|postgres|plpgsql|0123|" }));
  assert.match(reasons(C.crossProject(prod, trigger, { creator: "postgres", records: { "R-AUTHCFG": "x" } })), /evt\|x: R-IMG: an event trigger on the path differs, with no record/);
  assert.deepEqual(stops(C.crossProject(prod, trigger, { creator: "postgres", records: rec })), []);
  assert.ok(C.crossProject(prod, prod, { creator: "postgres", records: rec }).filter((f) => f.part === 10).every((f) => f.verdict === "RECORDED"), "part 10 is recorded");
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
