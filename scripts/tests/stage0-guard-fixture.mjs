// scripts/tests/stage0-guard-fixture.mjs — a throwaway guard state for the
// item 6 tests (stage0-guard.test.js, stage0-send.test.js): its own state
// directory, a settable clock, Windows shell processes by pid, a clean HEAD,
// and a fetch stub that counts every request. Nothing here reaches the
// network, the real ~/.stage0-guard or a real window.
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
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
 * MATCHes when its receipt binds (not R1) and is HTTP 201; any other result
 * stops the phase, as the capture gate does.
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

/** A fresh guard state, or `attach` to an existing one (a child process). `identity` replaces the injected shell processes. Call cleanup() when done. */
export function fixture({ workflows = {}, t0 = T0, attach = null, identity = null } = {}) {
  const dir = attach ? null : mkdtempSync(join(tmpdir(), "s0-guard-"));
  const stateDir = attach ? attach.stateDir : join(dir, "state");
  const paths = G.statePaths(stateDir);
  const results = attach ? attach.results : join(dir, "results");
  let t = t0;
  const shells = new Map();
  const calls = [];
  const fx = {
    dir, stateDir, paths, results, shells, calls, workflows,
    now: () => t,
    set: (ms) => { t = ms; },
    add: (ms) => { t += ms; },
    identity: identity || ((pid) => shells.get(pid) ?? null),
    git: () => ({ head: HEAD, dirty: [] }),
    ctxAt: () => ctx(),
    shell(pid, { image = "powershell.exe", created = t0 === T0 ? SHELL_CREATED : G.iso(t0 - 3600000).replace("Z", "0000Z") } = {}) {
      shells.set(pid, { pid, image, created });
      return pid;
    },
    clock(offsets = ["+00.0100000", "+00.0110000", "-00.0090000"]) {
      return G.recordClock(paths, { status: "Leap Indicator: 0(no warning)\nLast Successful Sync Time: 10/28/2026 9:00:00 AM\nSource: time.windows.com,0x9\n", stripchart: offsets.map((o, i) => `10:00:0${i}, ${o}s`).join("\n") + "\n" }, t);
    },
    goText(workflow, phase, deadline) {
      const wf = workflows[workflow] || G.WORKFLOWS[workflow];
      const ref = M.send.targets[wf.target];
      return `GO phase ${phase} at X ${HEAD.slice(0, 7)}: steps ${wf.phases[phase].steps.join(", ")} to ${wf.target} ${ref} only. Deadline ${G.iso(deadline).slice(0, 16).replace("T", " ")} UTC.`;
    },
    phase(workflow, phase, { minutes = 45, reviewed = null, goText = null } = {}) {
      const deadline = Math.floor((t + minutes * 60000) / 60000) * 60000;
      return G.recordPhase({ paths, manifest: M, workflows: { ...G.WORKFLOWS, ...workflows }, workflow, phase, goText: goText ?? fx.goText(workflow, phase, deadline), arrivedAt: G.iso(t), deadline: G.iso(deadline), reviewed, head: HEAD, checkout: ROOT, now: t });
    },
    /** Open a window: a shell pid, a session value and a token; returns its env. */
    window(role, phaseId, { pid, n = pid, token = TOKEN } = {}) {
      fx.shell(pid);
      const env = { [G.SESSION_ENV]: nonce(n), [G.TOKEN_ENV]: token };
      const r = G.openMarker({ paths, manifest: M, phaseId, role, env, head: HEAD, checkout: ROOT, now: t, identity: fx.identity, ppid: pid, selfStartMs: t, workflows: { ...G.WORKFLOWS, ...workflows } });
      return { env, pid, marker: r.marker };
    },
    issue(phaseId, step) {
      return G.issueGo({ paths, manifest: M, phaseId, step, head: HEAD, checkout: ROOT, now: t, identity: fx.identity, workflows: { ...G.WORKFLOWS, ...workflows }, ctxAt: fx.ctxAt, planFor: (text, target) => S.planSend(M, text, target, { cwd: ROOT }) });
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
        plan, goId, token: token ?? win.env[G.TOKEN_ENV], env: win.env, manifest: M, root: ROOT, stateDir, now: fx.now, identity: fx.identity, git: fx.git,
        workflows: { ...G.WORKFLOWS, ...workflows }, ctxAt: fx.ctxAt, execArgv: [], ppid: win.pid, selfStartMs: t,
        send: (p, extra) => S.send(p, { token: token ?? win.env[G.TOKEN_ENV], fetchImpl: over.fetchImpl || fx.fetchImpl(), ...extra }),
        writeReceipt: (rec) => S.writeRecord(rec, results),
        ...over,
      });
    },
    /** The same through the sender's command line, as Ryan runs it. */
    main(argv, env, over = {}) {
      return S.main(argv, env, {
        stdout: () => {}, manifest: M, root: ROOT, stateDir, now: fx.now, identity: fx.identity, git: fx.git, workflows: { ...G.WORKFLOWS, ...workflows },
        ctxAt: fx.ctxAt, execArgv: [], selfStartMs: t, resultsDir: results, fetchImpl: fx.fetchImpl(), ...over,
      });
    },
    cleanup: () => { if (dir) rmSync(dir, { recursive: true, force: true }); },
  };
  return fx;
}
