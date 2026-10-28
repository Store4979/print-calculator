// scripts/tests/stage0-guard-fixture.mjs — a throwaway guard store for the
// item 6 tests (stage0-guard.test.js, stage0-guard.store.test.js,
// stage0-send.test.js): its own explicitly initialized store, the anchor the
// repository would record for it, a settable clock, Windows shell processes
// by pid, a clean HEAD, and a fetch stub that counts every request. Nothing
// here reaches the network, the real ~/.stage0-guard or a real window.
import { mkdtempSync, rmSync, readFileSync, appendFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import * as A from "../manual/assemble-stage0.mjs";
import * as G from "../manual/stage0-guard.mjs";
import * as C from "../manual/stage0-classify.mjs";
import * as S from "../manual/stage0-send.mjs";
import { MANIFEST_PATH } from "./stage0-manifest-check.mjs";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
/** The working tree's manifest: at a commit, the one HEAD carries. */
export const M = JSON.parse(readFileSync(join(ROOT, MANIFEST_PATH), "utf8"));
let ctxMemo = null;
export const ctx = () => ctxMemo || (ctxMemo = C.contextFor(M, { cwd: ROOT }));
export const HEAD = "1234567890abcdef1234567890abcdef12345678";
export const T0 = Date.parse("2026-10-28T14:00:00.000Z");
export const TOKEN = "sbp_" + "0123456789abcdef".repeat(2) + "item6test";
export const OTHER_TOKEN = "sbp_" + "fedcba9876543210".repeat(2) + "item6othr";
export const nonce = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const SHELL_CREATED = "2026-10-28T13:00:00.1234567Z";
const SET_CONFIG = '[{"set_config":"45s"}]';
/** A 201 body each text's success predicate accepts where one exists; "[]" elsewhere (R4 for a read). */
export const okBody = (text) => (/^(P2-|RB-)/.test(text) || text === "LOCKPROBE-B-POSITIVE" ? SET_CONFIG
  : text === "LOCKPROBE-SETUP" ? '[{"setup":"stage0_lockprobe ready"}]'
    : text === "LOCKPROBE-CLEANUP" ? '[{"schema_gone":true,"relations_left":0,"probe_locks_left":0,"probe_backends_active":0}]'
      : text === "LOCKPROBE-READBACK" ? JSON.stringify([{ ddl_committed: false, ledger: [{ version: "20000101000000", name: "baseline", n: 1, md5: A.md5("-- baseline"), created_by: A.LEDGER_CREATED_BY }], locks: [], lockprobe_backends: [], read_at: "2026-10-28 14:00:01.000000+00" }])
        : "[]");

/**
 * A workflow declared for a test: phases of [step id, text] pairs. A step
 * MATCHes when its receipt binds (not R1) and is HTTP 201; any other result,
 * or an UNRESOLVED writing send, stops the phase, as the capture gate does.
 */
export function synthWorkflow(target, phases) {
  const textOf = {};
  const decl = {};
  for (const [name, steps] of Object.entries(phases)) {
    decl[name] = { steps: steps.map(([id]) => id), requires: null };
    for (const [id, text] of steps) textOf[id] = text;
  }
  return {
    target,
    phases: decl,
    stepText: (id) => textOf[id],
    check: (id, text, c) => {
      const cl = C.classifyText(text, c);
      const rec = C.strictJson(text);
      return { step: id, text: textOf[id], verdict: cl.class !== "R1" && rec.httpStatus === 201 ? "MATCH" : "STOP", reasons: [], classification: cl };
    },
    next: (phase, results) => {
      const steps = decl[phase].steps;
      for (const [n, r] of results.entries()) {
        if (r.step !== steps[n]) throw new Error(`result ${n + 1} is ${r.step}`);
        if (r.verdict !== "MATCH") return { stop: true, reason: `${r.step} was ${r.verdict}` };
        if (r.classification.writing !== false && r.classification.outcome === "UNRESOLVED") return { stop: true, reason: `${r.step} was a writing send classified UNRESOLVED` };
      }
      return { stop: false, next: steps[results.length] ?? null };
    },
  };
}

/**
 * A guard store made by init (or `attach`ed to an existing one, in a child
 * process), with the anchor the repository would record for it. `identity`
 * replaces the injected shell processes. Call cleanup() when done.
 */
export function fixture({ workflows = {}, t0 = T0, attach = null, identity = null, init = true } = {}) {
  const dir = attach ? null : mkdtempSync(join(tmpdir(), "s0-guard-"));
  const stateDir = attach ? attach.stateDir : join(dir, "state");
  const paths = G.statePaths(stateDir);
  const results = attach ? attach.results : join(dir, "results");
  let t = t0;
  const shells = new Map();
  const calls = [];
  const all = () => ({ ...G.WORKFLOWS, ...workflows });
  const fx = {
    dir, stateDir, paths, results, shells, calls, workflows, anchor: null,
    now: () => t,
    set: (ms) => { t = ms; },
    add: (ms) => { t += ms; },
    identity: identity || ((pid) => shells.get(pid) ?? null),
    git: () => ({ head: HEAD, dirty: [] }),
    ctxAt: () => ctx(),
    init() {
      const store = G.initStore({ paths, manifest: M, anchor: null, now: t });
      fx.anchor = G.anchorFor(store);
      return store;
    },
    shell(pid, { image = "powershell.exe", created = t0 === T0 ? SHELL_CREATED : G.iso(t0 - 3600000).replace("Z", "0000Z") } = {}) {
      shells.set(pid, { pid, image, created });
      return pid;
    },
    clock(offsets = ["+00.0100000", "+00.0110000", "-00.0090000"]) {
      return G.recordClock({ paths, anchor: fx.anchor, manifest: M, measurement: { status: "Leap Indicator: 0(no warning)\nLast Successful Sync Time: 10/28/2026 9:00:00 AM\nSource: time.windows.com,0x9\n", stripchart: offsets.map((o, i) => `10:00:0${i}, ${o}s`).join("\n") + "\n" }, now: t });
    },
    check: () => G.storeCheck({ paths, anchor: fx.anchor, manifest: M }),
    draft(workflow, phase) {
      return G.draftApproval({ paths, anchor: fx.anchor, manifest: M, workflows: all(), workflow, phase, head: HEAD, now: t }).approvalId;
    },
    goText(workflow, phase, deadline, approvalId) {
      const wf = all()[workflow];
      const ref = M.send.targets[wf.target];
      return `GO phase ${phase} at X ${HEAD.slice(0, 7)}, approval ${approvalId}: steps ${wf.phases[phase].steps.join(", ")} to ${wf.target} ${ref} only. Deadline ${G.iso(deadline).slice(0, 16).replace("T", " ")} UTC.`;
    },
    /** Draft an approval and register its phase; returns { phase, existing, goText, approvalId }. */
    register(workflow, phase, { minutes = 45, reviewed = null, goText = null, approvalId = null, arrivedAt = null, deadline = null } = {}) {
      const dl = deadline ?? Math.floor((t + minutes * 60000) / 60000) * 60000;
      const id = approvalId ?? (goText === null ? fx.draft(workflow, phase) : null);
      const text = goText ?? fx.goText(workflow, phase, dl, id);
      const r = G.recordPhase({ paths, anchor: fx.anchor, manifest: M, workflows: all(), workflow, phase, goText: text, arrivedAt: arrivedAt ?? G.iso(t), deadline: G.iso(dl), reviewed, head: HEAD, checkout: ROOT, now: t });
      return { ...r, goText: text, approvalId: id };
    },
    phase(workflow, phase, opts = {}) { return fx.register(workflow, phase, opts).phase; },
    /** Open a window: a shell pid, a session value and a token; returns its env. */
    window(role, phaseId, { pid, n = pid, token = TOKEN } = {}) {
      fx.shell(pid);
      const env = { [G.SESSION_ENV]: nonce(n), [G.TOKEN_ENV]: token };
      const r = G.openMarker({ paths, anchor: fx.anchor, manifest: M, phaseId, role, env, head: HEAD, checkout: ROOT, now: t, identity: fx.identity, ppid: pid, selfStartMs: t, workflows: all() });
      return { env, pid, marker: r.marker };
    },
    issue(phaseId, step) {
      return G.issueGo({ paths, anchor: fx.anchor, manifest: M, phaseId, step, head: HEAD, checkout: ROOT, now: t, identity: fx.identity, workflows: all(), ctxAt: fx.ctxAt, planFor: (text, target) => S.planSend(M, text, target, { cwd: ROOT }) });
    },
    void: (goId) => G.voidGo({ paths, anchor: fx.anchor, manifest: M, goId, now: t }),
    dispose: (attemptId, reviewedPath, ref = M.send.targets.production) => G.dispose({ paths, anchor: fx.anchor, manifest: M, ref, attemptId, reviewedPath, reviewedBytes: readFileSync(reviewedPath), now: t }),
    status: (ref = M.send.targets.production) => G.status({ paths, anchor: fx.anchor, manifest: M, ref, ctxAt: fx.ctxAt, now: t }),
    /**
     * Write a go by hand, with its ledger line, as an issuer that skipped its
     * checks would: the store stays consistent, so only the sender's own
     * checks can refuse it. `over` changes fields.
     */
    forgeGo({ phase, marker, step, text, target, over = {} }) {
      const plan = S.planSend(M, text, target, { cwd: ROOT });
      const go = {
        schema: "stage0-go/1", goId: randomBytes(16).toString("hex"), phaseId: phase.phaseId, phaseSha: marker.phaseSha, workflow: phase.workflow, phase: phase.phase, step, text, target,
        ref: plan.ref, head: HEAD, checkout: ROOT, role: G.roleOf(M, text), markerId: marker.markerId, issuedAt: G.iso(t),
        deadline: G.iso(Math.min(G.utcMs(phase.deadline) - G.MARGIN_MS, G.utcMs(marker.until))),
        request: { md5: plan.md5, bytes: plan.bytes, readOnly: plan.readOnly, endpoint: M.send.endpoint.replace("{ref}", plan.ref) },
        cancel: null, gate: { next: step, after: [] }, ...over,
      };
      const textOut = JSON.stringify(go, null, 2) + "\n";
      writeFileSync(join(paths.gos, `${go.goId}.json`), textOut);
      fx.ledger("go-issue", { goId: go.goId, phaseId: go.phaseId, step: go.step, ref: go.ref, markerId: go.markerId, sha256: G.sha256(Buffer.from(textOut, "utf8")) });
      return go;
    },
    /** Append one ledger line by hand, chained as the guard chains them. */
    ledger(kind, fields) {
      const L = G.readLedger(paths);
      if (L.problems.length) throw new Error(`the ledger is not clean: ${L.problems[0]}`);
      appendFileSync(paths.ledger, JSON.stringify({ seq: L.seq + 1, prev: L.tail, at: G.iso(t), kind, ...fields }) + "\n");
    },
    /** A fetch stub that counts requests and answers 201 with the text's body (or `respond`). */
    fetchImpl(respond = null) {
      return async (url, init) => {
        calls.push({ url, init });
        const q = JSON.parse(init.body).query;
        const name = Object.keys(M.outputs).find((k) => ctx().texts[k] === q) || "";
        if (respond) return respond(name, url, init);
        return new Response(okBody(name), { status: 201 });
      };
    },
    /** The guarded send with this fixture's deps; `over` replaces any of them. */
    send(G2, { text, target, win, goId, token = null, over = {} }) {
      const plan = S.planSend(M, text, target, { cwd: ROOT });
      return G2.guardedSend({
        plan, goId, token: token ?? win.env[G.TOKEN_ENV], env: win.env, anchor: fx.anchor, manifest: M, root: ROOT, stateDir, now: fx.now, identity: fx.identity, git: fx.git,
        workflows: all(), ctxAt: fx.ctxAt, execArgv: [], ppid: win.pid, selfStartMs: t,
        send: (p, extra) => S.send(p, { token: token ?? win.env[G.TOKEN_ENV], fetchImpl: over.fetchImpl || fx.fetchImpl(), ...extra }),
        writeReceipt: (rec) => S.writeRecord(rec, results),
        ...over,
      });
    },
    /** The same through the sender's command line, as Ryan runs it. */
    main(argv, env, over = {}) {
      return S.main(argv, env, {
        stdout: () => {}, manifest: M, root: ROOT, stateDir, anchor: fx.anchor, now: fx.now, identity: fx.identity, git: fx.git, workflows: all(),
        ctxAt: fx.ctxAt, execArgv: [], selfStartMs: t, resultsDir: results, fetchImpl: fx.fetchImpl(), ...over,
      });
    },
    cleanup: () => { if (dir) rmSync(dir, { recursive: true, force: true }); },
  };
  if (attach) fx.anchor = G.anchorFor(G.readState(paths.store));
  else if (init) fx.init();
  return fx;
}
