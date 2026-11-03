// scripts/tests/stage0-guard-fixture.mjs — a throwaway guard store for the
// item 6 tests (stage0-guard.test.js, stage0-guard.store.test.js,
// stage0-send.test.js): its own explicitly initialized store, the anchor the
// repository would record for it, a settable clock, Windows shell processes
// by pid, a clean HEAD, and a fetch stub that counts every request. Nothing
// here reaches the network, the real ~/.stage0-guard or a real window.
// Two helpers for separate processes and injected faults (Codex's review of
// the G-6 addendum): releaseTogether, and guardCopy. `within` bounds a wait
// and clears its timer on every path (W-N1, Codex's review of W).
import { mkdtempSync, mkdirSync, rmSync, readFileSync, appendFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
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
 * `ceilings` gives a phase's per-step reserves ({ <phase>: { <step>: ms } },
 * or null for none). Every phase must declare them, so one the test does not
 * name reserves MARGIN_MS for every step: the capture-phase admission
 * cutoff, as a declared ceiling.
 */
export function synthWorkflow(target, phases, { ceilings = {} } = {}) {
  const textOf = {};
  const decl = {};
  for (const [name, steps] of Object.entries(phases)) {
    const ids = steps.map(([id]) => id);
    const c = Object.hasOwn(ceilings, name) ? ceilings[name] : Object.fromEntries(ids.map((id) => [id, G.MARGIN_MS]));
    decl[name] = { steps: ids, requires: null, ...(c === undefined ? {} : { ceilings: c }) };
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

/** The phase's recorded ceiling for a step; for a step it does not have, its admission cutoff. */
const ceilingIn = (phase, step) => (Object.hasOwn(phase.ceilings, step) ? phase.ceilings[step] : G.iso(G.utcMs(phase.deadline) - G.MARGIN_MS));

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
    /** Draft an approval id; a phase that declares ceilings is drafted with its deadline (default: 45 min ahead, to the minute). */
    draft(workflow, phase, deadline = Math.floor((t + 45 * 60000) / 60000) * 60000) {
      const legacy = G.isLegacyPhase(all()[workflow], phase);
      return G.draftApproval({ paths, anchor: fx.anchor, manifest: M, workflows: all(), workflow, phase, head: HEAD, deadline: legacy ? null : G.iso(deadline), now: t }).approvalId;
    },
    /** Ryan's go line: goLine() for a phase that declares ceilings, the old hand-written form for a legacy capture phase. */
    goText(workflow, phase, deadline, approvalId) {
      const wf = all()[workflow];
      const ref = M.send.targets[wf.target];
      if (G.isLegacyPhase(wf, phase)) return `GO phase ${phase} at X ${HEAD.slice(0, 7)}, approval ${approvalId}: steps ${wf.phases[phase].steps.join(", ")} to ${wf.target} ${ref} only. Deadline ${G.iso(deadline).slice(0, 16).replace("T", " ")} UTC.`;
      return G.goLine({ workflow, phase, approvalId, head: HEAD, target: wf.target, ref, steps: wf.phases[phase].steps, ceilings: G.stepCeilings(wf, phase, deadline), deadline });
    },
    /** Draft an approval and register its phase; returns { phase, existing, goText, approvalId }. `guard` registers through another copy of the guard module (guardCopy). */
    register(workflow, phase, { minutes = 45, reviewed = null, goText = null, approvalId = null, arrivedAt = null, deadline = null, guard = G } = {}) {
      const dl = deadline ?? Math.floor((t + minutes * 60000) / 60000) * 60000;
      const id = approvalId ?? (goText === null ? fx.draft(workflow, phase, dl) : null);
      const text = goText ?? fx.goText(workflow, phase, dl, id);
      const r = guard.recordPhase({ paths, anchor: fx.anchor, manifest: M, workflows: all(), workflow, phase, goText: text, arrivedAt: arrivedAt ?? G.iso(t), deadline: G.iso(dl), reviewed, head: HEAD, checkout: ROOT, now: t });
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
    /**
     * Issue a go. A production go needs a not-after: unless the test gives
     * one (null for none), the fixture passes the latest the issuer admits,
     * the step's ceiling or its window's end if earlier; if it cannot read
     * them, none, and the issuer refuses for its own reason. `guard` issues
     * through another copy of the guard module (guardCopy).
     */
    issue(phaseId, step, { notAfter, guard = G } = {}) {
      let na = notAfter === undefined ? null : notAfter;
      if (notAfter === undefined) {
        try {
          const { phase } = G.loadPhase(paths, phaseId);
          if (phase.target === "production") {
            const role = G.roleOf(M, all()[phase.workflow].stepText(step));
            const ends = readdirSync(paths.markers).filter((f) => f.endsWith(".json")).map((f) => G.readState(join(paths.markers, f))).filter((m) => m.phaseId === phaseId && m.role === role).map((m) => G.utcMs(m.until));
            na = Math.min(G.utcMs(phase.ceilings[step]), ...ends);
          }
        } catch { na = null; }
      }
      return guard.issueGo({ paths, anchor: fx.anchor, manifest: M, phaseId, step, head: HEAD, checkout: ROOT, now: t, identity: fx.identity, workflows: all(), ctxAt: fx.ctxAt, planFor: (text, target) => S.planSend(M, text, target, { cwd: ROOT }), notAfter: Number.isFinite(na) ? na : null });
    },
    void: (goId) => G.voidGo({ paths, anchor: fx.anchor, manifest: M, goId, now: t }),
    dispose: (attemptId, reviewedPath, ref = M.send.targets.production) => G.dispose({ paths, anchor: fx.anchor, manifest: M, ref, attemptId, reviewedPath, reviewedBytes: readFileSync(reviewedPath), now: t }),
    status: (ref = M.send.targets.production) => G.status({ paths, anchor: fx.anchor, manifest: M, ref, ctxAt: fx.ctxAt, clock: fx.now }),
    /**
     * Write a go by hand, with its ledger line, as an issuer that skipped its
     * checks would: the store stays consistent, so only the sender's own
     * checks can refuse it. `over` changes fields. Unless `over` names it,
     * notAfter is the go's final deadline for a production phase (as the
     * fixture's issue() gives) and null otherwise.
     */
    forgeGo({ phase, marker, step, text, target, over = {} }) {
      const plan = S.planSend(M, text, target, { cwd: ROOT });
      const go = {
        schema: "stage0-go/3", goId: randomBytes(16).toString("hex"), phaseId: phase.phaseId, phaseSha: marker.phaseSha, workflow: phase.workflow, phase: phase.phase, step, text, target,
        ref: plan.ref, head: HEAD, checkout: ROOT, role: G.roleOf(M, text), markerId: marker.markerId, issuedAt: G.iso(t),
        ceiling: ceilingIn(phase, step), notAfter: null,
        deadline: G.iso(Math.min(G.utcMs(ceilingIn(phase, step)), G.utcMs(marker.until))),
        request: { md5: plan.md5, bytes: plan.bytes, readOnly: plan.readOnly, endpoint: M.send.endpoint.replace("{ref}", plan.ref) },
        cancel: null, gate: { next: step, after: [] }, ...over,
      };
      if (!Object.hasOwn(over, "notAfter")) go.notAfter = phase.target === "production" ? go.deadline : null;
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

const tick = (ms) => new Promise((r) => setTimeout(r, ms));
const trim = (s) => (s.length > 4000 ? `…${s.slice(-4000)}` : s);

/**
 * Wait for `done` or for `ms`, whichever comes first, and clear the timer on
 * every path (W-N1, Codex's review of W): a timer that lost the race would
 * otherwise keep this process alive until it fired. True when `done` won.
 */
export async function within(done, ms) {
  let id = null;
  const timeout = new Promise((r) => { id = setTimeout(() => r(false), ms); });
  try { return await Promise.race([done.then(() => true), timeout]); } finally { clearTimeout(id); }
}

/**
 * Start one node process per config, running `script` with its config file
 * as its one argument, and release them together once every one is ready
 * (Codex's review of the G-6 addendum, F1: an acknowledgement, not a pause).
 * Each config gains `ready`, `start`, `out` and `startWithinMs`. A worker
 * writes `ready` once it has loaded its modules and initialized its fixture,
 * waits at most startWithinMs for `start`, does its work and writes `out`.
 *   - Every worker must be ready within readyMs, and every worker must have
 *     exited within doneMs of the start.
 *   - A worker that exits before it is ready, or a bound that passes, kills
 *     the workers this call started, waits for them, and throws with every
 *     worker's diagnostics.
 *   - `afterStart(workers)` runs once the start file is written (G-8 kills a
 *     worker there). If it throws, the workers are killed and waited for,
 *     and its error is thrown.
 *   - Every bounded wait here goes through `within`, so no timer it starts
 *     outlives the call, on any path (W-N1; HL-1).
 * Returns, per worker: index, pid, exitCode, signal, readyAt, exitedAt,
 * stdout and stderr (the last 4000 characters of each), outRaw, and out (its
 * parsed JSON, or null when it wrote nothing parseable).
 */
export async function releaseTogether({ dir, script, cfgs, readyMs = 60000, doneMs = 120000, afterStart = null }) {
  const start = join(dir, "start");
  const ws = cfgs.map((c, i) => {
    const cfg = { ...c, ready: join(dir, `ready-${i}`), start, out: join(dir, `out-${i}.json`), startWithinMs: readyMs + 30000 };
    const file = join(dir, `cfg-${i}.json`);
    writeFileSync(file, JSON.stringify(cfg));
    const p = spawn(process.execPath, [script, file], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    const w = { index: i, pid: p.pid, cfg, p, stdout: "", stderr: "", exitCode: null, signal: null, exited: false, readyAt: null, exitedAt: null };
    p.stdout.on("data", (d) => { w.stdout = trim(w.stdout + d); });
    p.stderr.on("data", (d) => { w.stderr = trim(w.stderr + d); });
    w.done = new Promise((res) => { p.on("exit", (code, signal) => { w.exited = true; w.exitCode = code; w.signal = signal; w.exitedAt = new Date().toISOString(); res(); }); p.on("error", (e) => { w.stderr = trim(`${w.stderr}\nspawn error: ${e.message}`); }); });
    return w;
  });
  const result = (w) => {
    let outRaw = null, out = null;
    try { outRaw = readFileSync(w.cfg.out, "utf8"); out = JSON.parse(outRaw); } catch { /* none, or not JSON: null */ }
    return { index: w.index, pid: w.pid, exitCode: w.exitCode, signal: w.signal, readyAt: w.readyAt, exitedAt: w.exitedAt, stdout: w.stdout, stderr: w.stderr, outRaw, out };
  };
  const fail = async (why) => {
    for (const w of ws) if (!w.exited) { try { w.p.kill(); } catch { /* reported by its exit */ } }
    await within(Promise.all(ws.map((w) => w.done)), 30000);
    throw new Error(`${why}; the workers: ${JSON.stringify(ws.map(result))}`);
  };
  const readyBy = Date.now() + readyMs;
  for (;;) {
    for (const w of ws) if (!w.readyAt && existsSync(w.cfg.ready)) w.readyAt = new Date().toISOString();
    if (ws.every((w) => w.readyAt)) break;
    const early = ws.find((w) => w.exited && !w.readyAt);
    if (early) await fail(`worker ${early.index} exited before it was ready`);
    if (Date.now() > readyBy) await fail(`not every worker was ready within ${readyMs} ms`);
    await tick(10);
  }
  writeFileSync(start, "go");
  if (afterStart) {
    try { await afterStart(ws); } catch (e) {
      for (const w of ws) if (!w.exited) { try { w.p.kill(); } catch { /* reported by its exit */ } }
      await within(Promise.all(ws.map((w) => w.done)), 30000);
      throw e;
    }
  }
  if (!(await within(Promise.all(ws.map((w) => w.done)), doneMs))) await fail(`not every worker exited within ${doneMs} ms of the start`);
  return ws.map(result);
}

const HOLDER = `
import { readFileSync, writeFileSync } from "node:fs";
const c = JSON.parse(readFileSync(process.argv[2], "utf8"));
const G = await import(c.guardUrl);
G.withLock(G.statePaths(c.stateDir), () => {
  const from = Date.now();
  writeFileSync(c.ready, JSON.stringify({ pid: process.pid, from }));
  while (Date.now() < from + c.holdMs) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
}, c.now);
`;

/**
 * Start a process that takes the fixture store's real lock, through the real
 * module, recording its pid and fx's time, and holds it for holdMs from
 * `from`, the moment it held it (W-R1, W-R3: Codex's review of W). It releases
 * the lock no earlier than releaseAt (from + holdMs). Resolves once it holds
 * the lock, with kill(), which kills it and awaits its exit.
 */
export async function holder(fx, holdMs = 120000) {
  const dir = join(fx.dir, `holder-${randomBytes(3).toString("hex")}`);
  mkdirSync(dir);
  const script = join(dir, "holder.mjs");
  writeFileSync(script, HOLDER);
  const cfg = join(dir, "cfg.json");
  const ready = join(dir, "ready");
  writeFileSync(cfg, JSON.stringify({ guardUrl: pathToFileURL(join(MANUAL, "stage0-guard.mjs")).href, stateDir: fx.stateDir, ready, holdMs, now: fx.now() }));
  const p = spawn(process.execPath, [script, cfg], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  let stderr = "";
  p.stderr.on("data", (d) => { stderr = trim(stderr + d); });
  const exited = new Promise((r) => p.on("exit", (code, signal) => r({ code, signal })));
  const kill = async () => {
    if (p.exitCode === null && p.signalCode === null) p.kill();
    if (!(await within(exited, 30000))) throw new Error(`holder ${p.pid} did not exit`);
    return exited;
  };
  const until = Date.now() + 60000;
  while (!existsSync(ready)) {
    if (p.exitCode !== null) throw new Error(`the holder exited before it held the lock: ${stderr}`);
    if (Date.now() > until) { await kill(); throw new Error(`the holder never held the lock: ${stderr}`); }
    await tick(10);
  }
  let rec = null;
  for (let i = 0; i < 100 && !rec; i++) { try { rec = JSON.parse(readFileSync(ready, "utf8")); } catch { await tick(10); } }
  if (!rec) { await kill(); throw new Error("the holder's record is unreadable"); }
  return { pid: p.pid, from: rec.from, releaseAt: rec.from + holdMs, kill, exited };
}

const MANUAL = join(ROOT, "scripts", "manual");

/** The original acquisition rule, as a mutant of the copy: only EEXIST is waited through (F2's required-failing case). */
export const EEXIST_ONLY = { from: 'export const LOCK_BUSY_CODES = Object.freeze(["EEXIST", "EPERM", "EACCES", "EBUSY"]);', to: 'export const LOCK_BUSY_CODES = Object.freeze(["EEXIST"]);' };
/** No protected snapshot, as a mutant of the copy: the readers read without the lock (F3's required-failing case). */
export const NO_SNAPSHOT = { from: "  try { return withLock(paths, () => fn(stamp()), stamp, waitMs); } catch (e) {", to: "  try { return fn(stamp()); } catch (e) {" };

/**
 * A copy of scripts/manual/stage0-guard.mjs for injected faults (Codex's
 * review of the G-6 addendum, F2 and F3), written to `dir` as
 * guard-<name>.mjs, its sibling modules loaded from the real files. It
 * differs from the real module only by:
 *   - the lock's exclusive create goes through `__faults`: `plan(n)`, given
 *     the 1-based count of create attempts in this copy, returns an error
 *     code to raise in place of that attempt, or null to make the real
 *     create (`attempts` counts them);
 *   - `__pause`: when `file` is set, logged() writes that file (the event's
 *     kind) after an event's file steps and before its ledger line, for the
 *     `kind` named (any kind when null), then waits up to `ms` for the
 *     `resume` file;
 *   - `edits`, each [from, to], applied after these (each target exactly
 *     once): the mutants.
 * Returns { url, mod }. Nothing here is reachable from the command lines.
 */
export async function guardCopy(dir, name, edits = []) {
  let s = readFileSync(join(MANUAL, "stage0-guard.mjs"), "utf8").replace(/\r\n/g, "\n");
  s = s.replace(/from "\.\/([^"]+)"/g, (m, f) => `from ${JSON.stringify(pathToFileURL(join(MANUAL, f)).href)}`);
  const once = (from, to) => {
    if (s.split(from).length !== 2) throw new Error(`guardCopy: the target does not occur exactly once: ${from.slice(0, 90)}`);
    s = s.split(from).join(to);
  };
  once('openSync(paths.lock, "wx")', '__lockOpen(paths.lock, "wx")');
  once("    return appendEvent(paths, chk, kind, fields, now);", "    __pauseBetween(kind);\n    return appendEvent(paths, chk, kind, fields, now);");
  for (const [from, to] of edits) once(from, to);
  s += `
export const __faults = { plan: null, attempts: 0 };
function __lockOpen(file, flags) {
  const n = ++__faults.attempts;
  const code = __faults.plan ? __faults.plan(n) : null;
  if (code) { const e = new Error(\`\${code}: injected on create attempt \${n}\`); e.code = code; throw e; }
  return openSync(file, flags);
}
export const __pause = { file: null, kind: null, resume: null, ms: 0 };
function __pauseBetween(kind) {
  if (!__pause.file || (__pause.kind && __pause.kind !== kind)) return;
  writeFileSync(__pause.file, kind);
  const until = Date.now() + __pause.ms;
  while (Date.now() < until && !(__pause.resume && existsSync(__pause.resume))) sleep(10);
}
`;
  const p = join(dir, `guard-${name}.mjs`);
  writeFileSync(p, s);
  const url = pathToFileURL(p).href;
  return { url, mod: await import(url) };
}
