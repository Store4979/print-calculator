// scripts/tests/stage0-guard.target.test.js — an added target in the guard
// store (item 4(c) plan §2.3; the implementation outline's X1). Every ref
// here is synthetic: no Supabase project, no real ref, no real store. Each
// case builds a throwaway store, and a manifest that names a `rehearsal`
// target with the synthetic ref (as the reviewed ref-binding commit will),
// with STATE and P2-02 allowed on it and their effects declared (C8).
//
//   TG-1  a store with no added target checks and reads as before; an
//         unnamed or never-added target is refused everywhere
//   TG-2  add, then one guarded send on the added ref; the store's identity,
//         anchor, production and staging records are unchanged
//   TG-3  what target add refuses, each with nothing recorded
//   TG-4  what target retire refuses (live phase, go, marker; PENDING;
//         HOLD), then a retirement once nothing is live
//   TG-5  after retirement every way back is refused: draft, registration,
//         an old phase's marker and go, re-adding by its name or another,
//         the staging slot; status still reads its history; a new ref may
//         be added
//   TG-6  storeCheck: the target files and events, damage and half states;
//         a writer stopped between target-add's files and its ledger line
//         is BUSY, then DAMAGED once its lock is removed, never a silent
//         half state
//   TG-7  the command line: stage0-go.mjs target add and retire
//   TG-M  the mutation companion: each named check, removed, turns its
//         scenario into exactly the permissive result the original refuses
// (Codex's rulings: C2 and §2.3's bounds in the reviews of U and V; the
// outline's split, review of d8ec242.)
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, unlinkSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import * as G from "../manual/stage0-guard.mjs";
import * as GO from "../manual/stage0-go.mjs";
import { fixture, synthWorkflow, M, ROOT, ctx, within, guardCopy } from "./stage0-guard-fixture.mjs";

const REH = "abcdefghijklmnopqrst";
const REH2 = "tsrqponmlkjihgfedcba";
const PROD = M.send.targets.production;
const STAGING = M.send.targets.staging;

/** M, with `target` named for `ref`, and STATE and P2-02 allowed on it, each declaring its effect (C8). */
function manifestWith(entries = { rehearsal: REH }) {
  const X = JSON.parse(JSON.stringify(M));
  for (const [target, ref] of Object.entries(entries)) {
    X.send.targets[target] = ref;
    for (const [k, effect] of [["STATE", "read"], ["P2-02", "write"]]) {
      X.send.texts[k].targets = [...X.send.texts[k].targets, target];
      X.send.texts[k].effect = effect;
    }
  }
  return X;
}
const X1 = manifestWith();
const ctxOf = (X) => () => ({ ...ctx(), manifest: X });
const WF = (target = "rehearsal") => ({ r: synthWorkflow(target, { P: [["S1", "STATE"], ["S2", "P2-02"]] }) });

/** A throwaway store whose manifest names the rehearsal target (not yet added). */
function setup({ X = X1, target = "rehearsal" } = {}) {
  const fx = fixture({ workflows: WF(target), manifest: X, ctxAt: ctxOf(X) });
  fx.clock();
  return fx;
}
/** A review file, written beside the store, holding `text`. */
function review(fx, text, name = `review-${Math.random().toString(16).slice(2, 10)}.md`) {
  const path = join(fx.dir, name);
  writeFileSync(path, text);
  return { reviewedPath: path, reviewedBytes: readFileSync(path) };
}
const add = (fx, X = X1, target = "rehearsal", ref = REH, mod = G) => mod.addTarget({ paths: fx.paths, anchor: fx.anchor, manifest: X, target, ref, ...review(fx, `Reviewed: target ${target}, ref ${ref}, the item 4(c) rehearsal project.`), now: fx.now() });
const retire = (fx, X = X1, target = "rehearsal", ref = REH, mod = G) => mod.retireTarget({ paths: fx.paths, anchor: fx.anchor, manifest: X, target, ref, ...review(fx, `Reviewed: retire target ${target}, ref ${ref}.`), now: fx.now(), ctxAt: fx.ctxAt });
/** The error fn throws (synchronously or by rejecting), or null. */
async function caught(fn) { try { await fn(); return null; } catch (e) { return e; } }
async function refused(fn, re, label) {
  const e = await caught(fn);
  assert.ok(e instanceof Error && !(e instanceof G.AfterDispatch) && e.constructor.name !== "AfterDispatch", `${label}: refused, not after dispatch (${e && e.constructor.name}: ${e && e.message})`);
  if (re) assert.match(e.message, re, label);
  return e;
}
const seq = (fx) => G.readLedger(fx.paths).seq;
const lastKind = (fx) => { const L = G.readLedger(fx.paths); return L.events[L.events.length - 1].kind; };
/** A phase on the rehearsal target with an R (1001) and a W (1002) window. */
function phaseWithWindows(fx, opts = {}) {
  const ph = fx.phase("r", "P", opts);
  const R = fx.window("R", ph.phaseId, { pid: 1001 });
  const W = fx.window("W", ph.phaseId, { pid: 1002 });
  return { ph, R, W };
}
/** Retire by hand, as a store edit that bypasses retireTarget would: consistent files and ledger, nothing else checked. */
function forgeRetire(fx, target = "rehearsal", ref = REH) {
  if (!existsSync(fx.paths.retired)) mkdirSync(fx.paths.retired);
  renameSync(join(fx.paths.targets, `${ref}.json`), join(fx.paths.retired, `${ref}.json`));
  fx.ledger("target-retire", { target, ref, reviewedSha256: "a".repeat(64) });
}

test("TG-1 a store with no added target checks and reads as before (no targets directory, no `targets` in status); a target the manifest does not name, or names but the store never added, is refused by draft, registration and the sender", async () => {
  const fx = setup();
  try {
    assert.equal(fx.check().ok, true);
    assert.equal(existsSync(fx.paths.targets), false, "no targets directory");
    const st = fx.status(PROD);
    assert.equal(st.intact, true);
    assert.ok(!("targets" in st), "no targets field");
    assert.deepEqual(readdirSync(fx.paths.journalRoot).sort(), [PROD, STAGING].sort());
    // Never added: the manifest names it, the store does not have it.
    await refused(() => fx.draft("r", "P"), /target rehearsal \(abcdefghijklmnopqrst\) was never added to this guard store/, "draft");
    // Not named: plain M has no rehearsal target.
    const fy = fixture({ workflows: WF() });
    try {
      fy.clock();
      await refused(() => fy.draft("r", "P"), /the manifest has no ref for rehearsal/, "draft under M");
    } finally { fy.cleanup(); }
    assert.equal(fx.check().ok, true, "the refusals recorded nothing");
    assert.equal(fx.calls.length, 0);
  } finally { fx.cleanup(); }
});

test("TG-2 target add, then one guarded send on the added ref: the target record, its journal and one request; store.json, the anchor and the production and staging journals are unchanged; status lists the target", async () => {
  const fx = setup();
  try {
    const storeBytes = readFileSync(fx.paths.store);
    const anchor = JSON.stringify(fx.anchor);
    const rec = add(fx);
    assert.deepEqual([rec.target, rec.ref, rec.schema], ["rehearsal", REH, "stage0-target/1"]);
    assert.equal(lastKind(fx), "target-add");
    assert.ok(existsSync(join(fx.paths.targets, `${REH}.json`)));
    assert.ok(existsSync(fx.paths.journal(REH)));
    assert.deepEqual(readFileSync(fx.paths.store), storeBytes, "store.json unchanged");
    assert.equal(JSON.stringify(G.anchorFor(G.readState(fx.paths.store))), anchor, "the anchor unchanged");
    assert.equal(fx.check().ok, true, fx.check().problems.join("; "));
    const { ph, R } = phaseWithWindows(fx);
    assert.equal(ph.ref, REH);
    fx.add(1000);
    const go = fx.issue(ph.phaseId, "S1");
    assert.equal(go.ref, REH);
    const r = await fx.send(G, { text: "STATE", target: "rehearsal", win: R, goId: go.goId });
    assert.ok(r.record, "a recorded send");
    assert.equal(fx.calls.length, 1, "one request");
    assert.ok(fx.calls[0].url.includes(REH), "to the added ref's endpoint");
    assert.equal(G.readJournal(fx.paths, REH).length, 1, "its claim is in the added ref's journal");
    assert.equal(G.readJournal(fx.paths, PROD).length, 0);
    assert.equal(G.readJournal(fx.paths, STAGING).length, 0);
    const st = fx.status(REH);
    assert.equal(st.intact, true);
    assert.deepEqual(st.holds, []);
    assert.deepEqual(st.targets, [{ target: "rehearsal", ref: REH, state: "active" }]);
    assert.equal(fx.check().ok, true);
  } finally { fx.cleanup(); }
});

test("TG-3 target add refuses, recording nothing: production or staging as a name; a malformed ref; a manifest that does not name exactly that ref; a review file that does not name both; one of the store's own refs; a ref already active; a second active target; a damaged store", async () => {
  const fx = setup();
  try {
    const base = seq(fx);
    const tryAdd = (o) => G.addTarget({ paths: fx.paths, anchor: fx.anchor, manifest: X1, target: "rehearsal", ref: REH, ...review(fx, `target rehearsal ref ${REH}`), now: fx.now(), ...o });
    for (const [label, o, re] of [
      ["production as a name", { target: "production", ref: PROD }, /neither production nor staging|other than production and staging/],
      ["staging as a name", { target: "staging" }, /other than production and staging/],
      ["an upper-case name", { target: "Rehearsal" }, /lower-case name/],
      ["a malformed ref", { ref: "ABC" }, /20 lower-case letters/],
      ["a manifest without the target", { manifest: M }, /does not name abcdefghijklmnopqrst as target rehearsal/],
      ["a manifest naming another ref", { ref: REH2 }, /does not name tsrqponmlkjihgfedcba as target rehearsal/],
      ["a review file without the ref", review(fx, "target rehearsal, no ref"), /does not name the target and its ref/],
      ["a review file without the target", review(fx, `ref ${REH} only`), /does not name the target and its ref/],
      ["one of the store's own refs", { manifest: manifestWith({ rehearsal: PROD }), ref: PROD, ...review(fx, `target rehearsal ref ${PROD}`) }, new RegExp(`${PROD} is one of the store's own refs`)],
    ]) {
      await refused(() => tryAdd(o), re, label);
      assert.equal(seq(fx), base, `${label}: nothing recorded`);
    }
    add(fx);
    const after = seq(fx);
    await refused(() => add(fx), /is already active as target rehearsal/, "the same ref again");
    const X2 = manifestWith({ rehearsal: REH, other: REH2 });
    await refused(() => add(fx, X2, "other", REH2), /target rehearsal \(abcdefghijklmnopqrst\) is active; at most one added target is active/, "a second active target");
    assert.equal(seq(fx), after, "nothing more recorded");
    writeFileSync(join(fx.paths.gos, "planted.json"), "{}");
    await refused(() => add(fx, X2, "other", REH2), /DAMAGED/, "a damaged store");
    assert.equal(seq(fx), after);
  } finally { fx.cleanup(); }
});

test("TG-4 target retire refuses while anything of the ref is live, pending or held (a phase before its deadline, a live go, an open marker; a PENDING claim; a HOLD), and on a review file or a target that does not match; once nothing is live it retires, moving only the target record", async () => {
  // A live phase with an open marker and a live go.
  {
    const fx = setup();
    try {
      add(fx);
      const { ph } = phaseWithWindows(fx);
      fx.add(1000);
      fx.issue(ph.phaseId, "S1");
      const base = seq(fx);
      await refused(() => retire(fx), /is live until|is open until|runs until/, "a live go, marker and phase");
      await refused(() => G.retireTarget({ paths: fx.paths, anchor: fx.anchor, manifest: X1, target: "rehearsal", ref: REH, ...review(fx, "retire, naming nothing"), now: fx.now(), ctxAt: fx.ctxAt }), /does not name the target and its ref/, "the review file");
      await refused(() => retire(fx, X1, "other", REH), /is not an active target named other/, "another name");
      await refused(() => retire(fx, X1, "rehearsal", REH2), /is not an active target named rehearsal/, "another ref");
      assert.equal(seq(fx), base, "nothing recorded");
      // After the phase deadline, nothing is live: it retires.
      fx.set(G.utcMs(ph.deadline) + 1000);
      const r = retire(fx);
      assert.deepEqual([r.target, r.ref], ["rehearsal", REH]);
      assert.equal(lastKind(fx), "target-retire");
      assert.ok(!existsSync(join(fx.paths.targets, `${REH}.json`)) && existsSync(join(fx.paths.retired, `${REH}.json`)), "only the target record moved");
      assert.ok(existsSync(fx.paths.journal(REH)), "its journal stays");
      assert.equal(fx.check().ok, true, fx.check().problems.join("; "));
      assert.deepEqual(fx.status(REH).targets, [{ target: "rehearsal", ref: REH, state: "retired" }]);
    } finally { fx.cleanup(); }
  }
  // A PENDING claim holds it, even after the phase deadline, until it is disposed of.
  {
    const fx = setup();
    try {
      add(fx);
      const { ph, R } = phaseWithWindows(fx);
      fx.add(1000);
      const go = fx.issue(ph.phaseId, "S1");
      const e = await caught(() => fx.send(G, { text: "STATE", target: "rehearsal", win: R, goId: go.goId, over: { writeReceipt: () => { throw new Error("the disk is full"); } } }));
      assert.ok(e instanceof G.AfterDispatch, String(e));
      fx.set(G.utcMs(ph.deadline) + 1000);
      await refused(() => retire(fx), /the project is held: PENDING/, "PENDING");
      const attemptId = G.readJournal(fx.paths, REH)[0].attemptId;
      fx.dispose(attemptId, review(fx, `Disposition of ${attemptId}`).reviewedPath, REH);
      retire(fx);
      assert.equal(fx.check().ok, true);
    } finally { fx.cleanup(); }
  }
  // An R4 writing send HOLDs it.
  {
    const fx = setup();
    try {
      add(fx);
      const { ph, R, W } = phaseWithWindows(fx);
      fx.add(1000);
      await fx.send(G, { text: "STATE", target: "rehearsal", win: R, goId: fx.issue(ph.phaseId, "S1").goId });
      fx.add(1000);
      await fx.send(G, { text: "P2-02", target: "rehearsal", win: W, goId: fx.issue(ph.phaseId, "S2").goId, over: { fetchImpl: fx.fetchImpl(() => new Response("upstream timeout", { status: 504 })) } });
      fx.set(G.utcMs(ph.deadline) + 1000);
      await refused(() => retire(fx), /the project is held: HOLD/, "HOLD");
    } finally { fx.cleanup(); }
  }
});

test("TG-5 after retirement every way back is refused: draft and registration by its name or an alias, an old phase's marker and go, re-adding it by its name or another, the ref in the staging slot; status still reads its history; a new ref may then be added under the same name", async () => {
  const fx = setup();
  try {
    add(fx);
    const { ph, R } = phaseWithWindows(fx);
    fx.add(1000);
    const go = fx.issue(ph.phaseId, "S1");
    const before = fx.draft("r", "P", Math.floor((G.utcMs(ph.deadline) + 3600000) / 60000) * 60000);
    fx.set(G.utcMs(ph.deadline) + 1000);
    retire(fx);
    fx.clock();
    const base = seq(fx);
    await refused(() => fx.draft("r", "P"), /target rehearsal \(abcdefghijklmnopqrst\) was retired at ledger line [0-9]+; a retired ref never comes back/, "draft");
    await refused(() => fx.register("r", "P", { approvalId: before, deadline: Math.floor((G.utcMs(ph.deadline) + 3600000) / 60000) * 60000 }), /was retired at ledger line/, "registration of a draft made before");
    fx.shell(1003);
    await refused(() => G.openMarker({ paths: fx.paths, anchor: fx.anchor, manifest: X1, phaseId: ph.phaseId, role: "R", env: { [G.SESSION_ENV]: "00000000-0000-4000-8000-000000009999", [G.TOKEN_ENV]: "sbp_" + "0123456789abcdef".repeat(2) + "item6test" }, head: "1234567890abcdef1234567890abcdef12345678", checkout: ROOT, now: fx.now(), identity: fx.identity, ppid: 1003, selfStartMs: fx.now() }), /was retired at ledger line|has passed/, "an old phase's marker");
    await refused(() => fx.send(G, { text: "STATE", target: "rehearsal", win: R, goId: go.goId }), /was retired|deadline/, "an old go");
    await refused(() => add(fx), /was retired at ledger line [0-9]+; a retired ref never comes back/, "re-adding by its name");
    const alias = manifestWith({ rehearsal: REH, alias: REH });
    await refused(() => add(fx, alias, "alias", REH), /was retired at ledger line/, "re-adding by another name");
    const fa = fixture({ workflows: WF("alias"), manifest: alias, ctxAt: ctxOf(alias), attach: { stateDir: fx.stateDir, results: fx.results }, t0: fx.now() });
    fa.clock();
    await refused(() => fa.draft("r", "P"), /target rehearsal \(abcdefghijklmnopqrst\) was retired/, "a draft under an alias");
    const slot = JSON.parse(JSON.stringify(X1));
    slot.send.targets.staging = REH;
    await refused(() => G.addTarget({ paths: fx.paths, anchor: fx.anchor, manifest: slot, target: "rehearsal", ref: REH, ...review(fx, `rehearsal ${REH}`), now: fx.now() }), /DAMAGED.*the store's refs are not the manifest's/, "the staging slot");
    assert.equal(seq(fx), base + 1, "nothing recorded but the alias fixture's clock check");
    // Its history stays readable.
    const st = fx.status(REH);
    assert.equal(st.intact, true);
    assert.equal(st.attempts.length, 0);
    assert.deepEqual(st.targets, [{ target: "rehearsal", ref: REH, state: "retired" }]);
    // A new project's ref, under the same name, may be added.
    const X3 = manifestWith({ rehearsal: REH2 });
    const rec = add(fx, X3, "rehearsal", REH2);
    assert.equal(rec.ref, REH2);
    assert.equal(fx.check().ok, true, fx.check().problems.join("; "));
    assert.deepEqual(G.storeCheck({ paths: fx.paths, anchor: fx.anchor, manifest: X3 }).problems, []);
    assert.equal(fx.calls.length, 0, "no request");
  } finally { fx.cleanup(); }
});

const WRITER = `
import { readFileSync, writeFileSync } from "node:fs";
const c = JSON.parse(readFileSync(process.argv[2], "utf8"));
const X = await import(c.copyUrl);
Object.assign(X.__pause, c.pause);
let out;
try { const rec = X.addTarget({ paths: X.statePaths(c.stateDir), anchor: c.anchor, manifest: c.manifest, target: "rehearsal", ref: c.ref, reviewedPath: c.reviewedPath, reviewedBytes: readFileSync(c.reviewedPath), now: c.now }); out = { ok: true, ref: rec.ref }; }
catch (e) { out = { ok: false, name: e.constructor.name, message: e.message }; }
writeFileSync(c.out, JSON.stringify(out));
`;

test("TG-6 storeCheck reads the target files and events: an add of a store ref, a second add, an event for a retired ref, a stray targets directory, a missing journal, a stray retired directory; a writer stopped between target-add's files and its ledger line is BUSY, then DAMAGED once its lock is removed, never a silent half state", { timeout: 120000 }, async () => {
  const damaged = (fx, re) => { const c = fx.check(); assert.equal(c.ok, false, "DAMAGED"); assert.match(c.problems.join("; "), re); };
  {
    const fx = setup();
    try {
      fx.ledger("target-add", { target: "rehearsal", ref: PROD, sha256: "a".repeat(64), reviewedSha256: "b".repeat(64) });
      mkdirSync(fx.paths.targets);
      damaged(fx, new RegExp(`target rehearsal adds ${PROD}, one of the store's own refs`));
    } finally { fx.cleanup(); }
  }
  {
    const fx = setup();
    try {
      add(fx);
      const L = G.readLedger(fx.paths);
      const ev = L.events[L.events.length - 1];
      fx.ledger("target-add", { target: "rehearsal", ref: REH, sha256: ev.sha256, reviewedSha256: ev.reviewedSha256 });
      damaged(fx, /ref abcdefghijklmnopqrst was already added at ledger line/);
    } finally { fx.cleanup(); }
  }
  {
    const fx = setup();
    try {
      add(fx);
      retire(fx);
      fx.ledger("draft", { approvalId: "0123456789abcdef", workflow: "r", phase: "P", ref: REH, head: "1234567890abcdef1234567890abcdef12345678", deadline: null });
      damaged(fx, /ref abcdefghijklmnopqrst was retired at ledger line [0-9]+/);
    } finally { fx.cleanup(); }
  }
  {
    const fx = setup();
    try {
      mkdirSync(fx.paths.targets);
      damaged(fx, /targets is present in the store, but is not one of its files/);
    } finally { fx.cleanup(); }
  }
  {
    const fx = setup();
    try {
      add(fx);
      rmSync(fx.paths.journal(REH), { recursive: true });
      damaged(fx, /journal\/abcdefghijklmnopqrst is missing or not a directory/);
    } finally { fx.cleanup(); }
  }
  {
    const fx = setup();
    try {
      add(fx);
      mkdirSync(fx.paths.retired);
      damaged(fx, /targets[\\/]retired is present, but the ledger does not record it/);
    } finally { fx.cleanup(); }
  }
  // A writer stopped between target-add's files and its ledger line.
  {
    const fx = setup();
    const dir = mkdtempSync(join(tmpdir(), "s0-target-"));
    try {
      const copy = await guardCopy(dir, "x");
      const r = review(fx, `target rehearsal ref ${REH}`);
      const files = { paused: join(dir, "paused"), resume: join(dir, "resume"), out: join(dir, "out.json") };
      writeFileSync(join(dir, "writer.mjs"), WRITER);
      const cfg = join(dir, "cfg.json");
      writeFileSync(cfg, JSON.stringify({ copyUrl: copy.url, stateDir: fx.stateDir, anchor: fx.anchor, manifest: X1, ref: REH, reviewedPath: r.reviewedPath, now: fx.now(), out: files.out, pause: { file: files.paused, kind: "target-add", resume: files.resume, ms: 120000 } }));
      const p = spawn(process.execPath, [join(dir, "writer.mjs"), cfg], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
      let stderr = "";
      p.stderr.on("data", (d) => { stderr += d; });
      const exited = new Promise((res) => p.on("exit", (code, signal) => res({ code, signal })));
      try {
        const until = Date.now() + 60000;
        while (!existsSync(files.paused)) { if (p.exitCode !== null) throw new Error(`the writer ended before it paused: ${stderr}`); if (Date.now() > until) throw new Error("the writer never paused"); await new Promise((res) => setTimeout(res, 10)); }
        const busy = G.status({ paths: fx.paths, anchor: fx.anchor, manifest: X1, ref: PROD, ctxAt: fx.ctxAt, clock: fx.now, lockWaitMs: 300 });
        assert.equal(busy.busy, true, "BUSY while the writer holds the lock between its files and its ledger line");
        assert.ok(existsSync(join(fx.paths.targets, `${REH}.json`)) && existsSync(fx.paths.journal(REH)), "its files were written");
        p.kill();
        assert.ok(await within(exited, 30000), "the writer exited");
      } finally { if (p.exitCode === null) { p.kill(); await within(exited, 30000); } }
      assert.ok(existsSync(fx.paths.lock), "the stopped writer's lock stays");
      assert.equal(G.status({ paths: fx.paths, anchor: fx.anchor, manifest: X1, ref: PROD, ctxAt: fx.ctxAt, clock: fx.now, lockWaitMs: 300 }).busy, true, "still BUSY: nothing removes the lock");
      unlinkSync(fx.paths.lock); // the test's own removal, after its own writer's exit (procedure §7.1)
      const st = G.status({ paths: fx.paths, anchor: fx.anchor, manifest: X1, ref: PROD, ctxAt: fx.ctxAt, clock: fx.now });
      assert.equal(st.intact, false, "DAMAGED, never a silent half state");
      assert.match(st.damaged.join("; "), /targets is present in the store, but is not one of its files/);
      assert.match(st.damaged.join("; "), /journal\/abcdefghijklmnopqrst is not one of the store's refs/);
    } finally { fx.cleanup(); rmSync(dir, { recursive: true, force: true }); }
  }
  // Resumed instead, the same writer completes: an intact store with the target active.
  {
    const fx = setup();
    const dir = mkdtempSync(join(tmpdir(), "s0-target-"));
    try {
      const copy = await guardCopy(dir, "x");
      const r = review(fx, `target rehearsal ref ${REH}`);
      const files = { paused: join(dir, "paused"), resume: join(dir, "resume"), out: join(dir, "out.json") };
      writeFileSync(join(dir, "writer.mjs"), WRITER);
      const cfg = join(dir, "cfg.json");
      writeFileSync(cfg, JSON.stringify({ copyUrl: copy.url, stateDir: fx.stateDir, anchor: fx.anchor, manifest: X1, ref: REH, reviewedPath: r.reviewedPath, now: fx.now(), out: files.out, pause: { file: files.paused, kind: "target-add", resume: files.resume, ms: 120000 } }));
      const p = spawn(process.execPath, [join(dir, "writer.mjs"), cfg], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
      const exited = new Promise((res) => p.on("exit", (code, signal) => res({ code, signal })));
      try {
        const until = Date.now() + 60000;
        while (!existsSync(files.paused)) { if (p.exitCode !== null || Date.now() > until) throw new Error("the writer never paused"); await new Promise((res) => setTimeout(res, 10)); }
        writeFileSync(files.resume, "go");
        assert.ok(await within(exited, 60000), "the writer finished");
      } finally { if (p.exitCode === null) { p.kill(); await within(exited, 30000); } }
      assert.deepEqual(JSON.parse(readFileSync(files.out, "utf8")), { ok: true, ref: REH });
      assert.equal(fx.check().ok, true, fx.check().problems.join("; "));
      assert.equal(lastKind(fx), "target-add");
    } finally { fx.cleanup(); rmSync(dir, { recursive: true, force: true }); }
  }
});

test("TG-7 the command line: stage0-go.mjs target add and target retire, with their usage refusals; status --target names the added target", () => {
  const fx = setup();
  try {
    const out = [];
    const go = (argv) => GO.main(argv, {}, { root: ROOT, manifest: X1, anchor: fx.anchor, stateDir: fx.stateDir, now: fx.now, identity: fx.identity, git: fx.git, stdout: (s) => out.push(s), execArgv: [], ctxAt: fx.ctxAt });
    const r = review(fx, `Reviewed: target rehearsal, ref ${REH}.`);
    assert.throws(() => go(["target", "move", "--target", "rehearsal"]), /usage: stage0-go\.mjs target add\|retire/);
    assert.throws(() => go(["target", "add", "--target", "rehearsal", "--ref", REH]), /target add needs --reviewed/);
    const a = go(["target", "add", "--target", "rehearsal", "--ref", REH, "--reviewed", r.reviewedPath]);
    assert.equal(a.target.ref, REH);
    assert.match(out.join(""), /target rehearsal = abcdefghijklmnopqrst added at /);
    const st = go(["status", "--target", "rehearsal"]);
    assert.equal(st.exit, 0);
    assert.deepEqual(st.status.targets, [{ target: "rehearsal", ref: REH, state: "active" }]);
    assert.throws(() => go(["status", "--target", "nowhere"]), /--target is one the manifest names: production, staging, rehearsal/);
    const d = go(["target", "retire", "--target", "rehearsal", "--ref", REH, "--reviewed", review(fx, `retire rehearsal ${REH}`).reviewedPath]);
    assert.equal(d.retired.ref, REH);
    assert.match(out.join(""), /retired at .*; it is never added again/);
    assert.equal(fx.check().ok, true);
  } finally { fx.cleanup(); }
});

// ── the mutation companion ─────────────────────────────────────────────────

/**
 * Each named check, removed by exact edits of stage0-guard.mjs, with a
 * scenario the original refuses and the exact permissive result the mutant
 * must give instead. `run(mod, fx)` runs the scenario's last operation
 * through the module given; `permits(result, fx, before)` says whether it
 * was the permissive result.
 */
const MUTANTS = [
  {
    name: "the sender's active-target checks (its first check and its claim)",
    edits: [
      ["  if (taken(snap.target) !== plan.ref) throw", "  if (false) throw"],
      ["    if (activeRef(chk, manifest, plan.target) !== plan.ref) throw", "    if (false) throw"],
    ],
    setup: async (fx) => {
      add(fx);
      const { ph, R } = phaseWithWindows(fx);
      fx.add(1000);
      const go = fx.issue(ph.phaseId, "S1");
      forgeRetire(fx);
      return { R, go };
    },
    run: (mod, fx, s) => fx.send(mod, { text: "STATE", target: "rehearsal", win: s.R, goId: s.go.goId }),
    // After the claim, the store reads the claim for a retired ref as damage, so the mutant's outcome is AfterDispatch; the request is the permissive result.
    permits: (r, fx, before) => fx.calls.length === before.calls + 1,
  },
  {
    name: "issue's active-target check",
    edits: [["    if (activeRef(chk, manifest, phase.target) !== phase.ref) throw new Refusal(`phase ${phaseId}'s ref ${phase.ref} is not the manifest's ${phase.target} ref; refusing`);\n    if (!(utcMs(phase.recordedAt) <= now)) throw new Refusal(\"the phase is recorded later than now: the clock went back; refusing\");\n    const wf", "    if (!(utcMs(phase.recordedAt) <= now)) throw new Refusal(\"the phase is recorded later than now: the clock went back; refusing\");\n    const wf"]],
    setup: async (fx) => { add(fx); const { ph } = phaseWithWindows(fx); fx.add(1000); forgeRetire(fx); return { ph }; },
    run: (mod, fx, s) => fx.issue(s.ph.phaseId, "S1", { guard: mod }),
    permits: (r) => Boolean(r && r.goId && r.ref === REH),
  },
  {
    name: "the marker's active-target check",
    edits: [["    if (activeRef(chk, manifest, phase.target) !== phase.ref) throw new Refusal(`phase ${phaseId}'s ref ${phase.ref} is not the manifest's ${phase.target} ref; refusing`);\n    if (!(utcMs(phase.recordedAt) <= now)) throw new Refusal(\"the phase is recorded later than now: the clock went back; refusing\");\n    if (now >= utcMs(phase.deadline))", "    if (!(utcMs(phase.recordedAt) <= now)) throw new Refusal(\"the phase is recorded later than now: the clock went back; refusing\");\n    if (now >= utcMs(phase.deadline))"]],
    setup: async (fx) => { add(fx); const ph = fx.phase("r", "P"); forgeRetire(fx); fx.shell(1001); return { ph }; },
    run: (mod, fx, s) => mod.openMarker({ paths: fx.paths, anchor: fx.anchor, manifest: X1, phaseId: s.ph.phaseId, role: "R", env: { [G.SESSION_ENV]: "00000000-0000-4000-8000-000000001001", [G.TOKEN_ENV]: "sbp_" + "0123456789abcdef".repeat(2) + "item6test" }, head: "1234567890abcdef1234567890abcdef12345678", checkout: ROOT, now: fx.now(), identity: fx.identity, ppid: 1001, selfStartMs: fx.now(), workflows: { ...G.WORKFLOWS, ...fx.workflows } }),
    permits: (r) => Boolean(r && r.marker && r.marker.ref === REH),
  },
  {
    name: "draft's active-target check",
    edits: [["    const ref = activeRef(chk, manifest, wf.target);\n    const dl = legacy", "    const ref = manifest.send.targets[wf.target];\n    const dl = legacy"]],
    setup: async (fx) => { add(fx); forgeRetire(fx); return {}; },
    run: (mod, fx) => mod.draftApproval({ paths: fx.paths, anchor: fx.anchor, manifest: X1, workflows: { ...G.WORKFLOWS, ...fx.workflows }, workflow: "r", phase: "P", head: "1234567890abcdef1234567890abcdef12345678", deadline: G.iso(Math.floor((fx.now() + 45 * 60000) / 60000) * 60000), now: fx.now() }),
    permits: (r) => Boolean(r && r.approvalId && r.ref === REH),
  },
  {
    name: "registration's active-target check",
    edits: [["    const ref = activeRef(chk, manifest, wf.target);\n    const draft = chk.index.drafts.get(approvalId);", "    const ref = manifest.send.targets[wf.target];\n    const draft = chk.index.drafts.get(approvalId);"]],
    setup: async (fx) => {
      add(fx);
      const dl = Math.floor((fx.now() + 45 * 60000) / 60000) * 60000;
      const approvalId = fx.draft("r", "P", dl);
      forgeRetire(fx);
      return { dl, approvalId };
    },
    run: (mod, fx, s) => fx.register("r", "P", { approvalId: s.approvalId, deadline: s.dl, guard: mod }),
    permits: (r) => Boolean(r && r.phase && r.phase.ref === REH && r.existing === false),
  },
  {
    name: "retire's nothing-live checks (go, marker, phase)",
    edits: [
      ["      if (now < utcMs(live.deadline)) throw new Refusal(`go ${goId} (${live.step}) is live until", "      if (false) throw new Refusal(`go ${goId} (${live.step}) is live until"],
      ["      if (now < utcMs(mk.until)) throw", "      if (false) throw"],
      ["      if (now < utcMs(phase.deadline)) throw new Refusal(`phase ${phaseId} (${phase.phase}) runs until", "      if (false) throw new Refusal(`phase ${phaseId} (${phase.phase}) runs until"],
    ],
    setup: async (fx) => { add(fx); const { ph } = phaseWithWindows(fx); fx.add(1000); fx.issue(ph.phaseId, "S1"); return {}; },
    run: (mod, fx) => retire(fx, X1, "rehearsal", REH, mod),
    permits: (r, fx) => Boolean(r && r.ref === REH) && lastKind(fx) === "target-retire",
  },
  {
    name: "retire's hold check",
    edits: [["    if (holds.length) throw new Refusal(`${heldMessage(holds)}. A held or pending attempt is disposed of", "    if (false) throw new Refusal(`${heldMessage(holds)}. A held or pending attempt is disposed of"]],
    setup: async (fx) => {
      add(fx);
      const { ph, R } = phaseWithWindows(fx);
      fx.add(1000);
      const go = fx.issue(ph.phaseId, "S1");
      await caught(() => fx.send(G, { text: "STATE", target: "rehearsal", win: R, goId: go.goId, over: { writeReceipt: () => { throw new Error("the disk is full"); } } }));
      fx.set(G.utcMs(ph.deadline) + 1000);
      return {};
    },
    run: (mod, fx) => retire(fx, X1, "rehearsal", REH, mod),
    permits: (r, fx) => Boolean(r && r.ref === REH) && lastKind(fx) === "target-retire",
  },
  {
    // Re-adding a retired ref also fails to make its journal directory, which
    // stays as evidence; that second barrier is made tolerant here too, so the
    // named check is the one shown.
    name: "add's never-again check (with the journal directory's second barrier made tolerant)",
    edits: [
      ["    if (prior) throw new Refusal(prior.retired !== null", "    if (prior && prior.retired === null) throw new Refusal(prior.retired !== null"],
      ["      dirStep(paths.journal(ref)),\n", "      ...(isDir(paths.journal(ref)) ? [] : [dirStep(paths.journal(ref))]),\n"],
    ],
    setup: async (fx) => { add(fx); retire(fx); return {}; },
    run: (mod, fx) => add(fx, X1, "rehearsal", REH, mod),
    permits: (r, fx) => Boolean(r && r.ref === REH) && lastKind(fx) === "target-add",
  },
  {
    name: "add's one-active check",
    edits: [["    if (live) throw new Refusal(`target ${live.target} (${live.ref}) is active; at most one", "    if (false) throw new Refusal(`target ${live.target} (${live.ref}) is active; at most one"]],
    setup: async (fx) => { add(fx, manifestWith({ rehearsal: REH, other: REH2 })); return {}; },
    run: (mod, fx) => add(fx, manifestWith({ rehearsal: REH, other: REH2 }), "other", REH2, mod),
    permits: (r, fx) => Boolean(r && r.ref === REH2) && lastKind(fx) === "target-add",
  },
  {
    name: "storeCheck's retired-ref rule",
    edits: [["    if (ref !== undefined && !activeAt(ref)) { rel(i, notActive(ref)); continue; }", "    if (ref !== undefined && !refs.includes(ref)) { rel(i, notActive(ref)); continue; }"]],
    setup: async (fx) => {
      add(fx);
      retire(fx);
      fx.ledger("draft", { approvalId: "0123456789abcdef", workflow: "r", phase: "P", ref: REH, head: "1234567890abcdef1234567890abcdef12345678", deadline: null });
      return {};
    },
    run: (mod, fx) => mod.storeCheck({ paths: fx.paths, anchor: fx.anchor, manifest: X1 }),
    permits: (r) => Boolean(r && r.ok === true),
  },
];

test("TG-M the mutation companion: each named check, removed, turns its scenario into exactly the permissive result (a request, a go, a marker, a draft, a phase, a retirement, an addition, a passing check) where the original refuses or reports damage", { timeout: 240000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "s0-target-mutants-"));
  try {
    for (const [n, mt] of MUTANTS.entries()) {
      // The original refuses (or, for storeCheck, reports damage).
      {
        const fx = setup();
        try {
          const s = await mt.setup(fx);
          const before = { calls: fx.calls.length, seq: seq(fx) };
          const r = await caught(() => mt.run(G, fx, s));
          if (mt.name === "storeCheck's retired-ref rule") assert.equal(G.storeCheck({ paths: fx.paths, anchor: fx.anchor, manifest: X1 }).ok, false, `${mt.name}: the original reports damage`);
          else {
            assert.ok(r instanceof G.Refusal && !(r instanceof G.AfterDispatch), `${mt.name}: the original refuses (${r && r.constructor.name}: ${r && r.message})`);
            assert.equal(fx.calls.length, before.calls, `${mt.name}: no request under the original`);
            assert.equal(seq(fx), before.seq, `${mt.name}: nothing recorded under the original`);
          }
        } finally { fx.cleanup(); }
      }
      // The mutant gives exactly the permissive result, never an unrelated exception.
      {
        const X = (await guardCopy(dir, `m${n}`, mt.edits)).mod;
        const fx = setup();
        try {
          const s = await mt.setup(fx);
          const before = { calls: fx.calls.length, seq: seq(fx) };
          let r, e = null;
          try { r = await mt.run(X, fx, s); } catch (x) { e = x; }
          assert.ok(mt.permits(r, fx, before), `${mt.name}: the mutant must permit its scenario; it gave ${e ? `${e.constructor.name}: ${e.message}` : JSON.stringify(r).slice(0, 300)}`);
          if (e) assert.equal(e.constructor.name, "AfterDispatch", `${mt.name}: the only exception allowed is the store's damage after the mutant's request`);
        } finally { fx.cleanup(); }
      }
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
