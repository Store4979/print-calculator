// scripts/tests/stage0-guard.store.test.js — the guard store fails closed
// (Codex's review of 78db6dc: I6-R1), one registration per human approval
// (I6-R2), and the cheap checks before any program (its ordering note). Every
// case uses a throwaway store and a fetch stub that counts requests; after
// any damage, BOTH the issuer and the sender must give no usable go and ZERO
// further requests, also with fresh markers, phases and another checkout.
//
//   ST-1  only init makes a store; every other command refuses where none is,
//         and makes none; init refuses an occupied path or an established
//         anchor; two concurrent inits make one store
//   ST-2  the anchor: read at HEAD from a real repository; a store that is
//         not the anchored one refuses
//   ST-3  Codex's reproductions: journal moved, journal replaced by a file,
//         sole pending claim moved, whole store moved then ordinary setup and
//         an immediate send, disposed claim damaged, outstanding go nulled
//   ST-4  the high-water record: missing or invalid refuses; only a clock
//         check re-establishes it, and records what it found
//   ST-5  missing outcome, disposition, used go or phase; unknown files;
//         identity and sequence mismatches; a broken or truncated ledger
//   ST-6  status never says "no holds" for a damaged store; close still
//         works where the ledger reads, and changes nothing where it does not
//   ST-7  a failed ledger write leaves nothing unrecorded; a held lock refuses
//   ST-8  a reviewed restoration: init --restore, and the anchor to follow
//   AP-1  an approval id registers one phase; the same text returns it; other
//         words, no id, two ids, an undrafted or foreign id refuse
//   AP-2  Codex's reproduction: the same go recorded again after A1, close
//         and a new window: the same phase, A1 refused, A2 next
//   AP-3  concurrent registration of one approval makes one phase
//   AP-4  a genuine restart: a newly drafted id, a new phase
//   ORD   node options and planted programs refuse before any program, through
//         the real command lines
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, unlinkSync, mkdtempSync, rmSync, renameSync, appendFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import * as G from "../manual/stage0-guard.mjs";
import * as S from "../manual/stage0-send.mjs";
import * as GO from "../manual/stage0-go.mjs";
import * as WIN from "../manual/stage0-window.mjs";
import { fixture, synthWorkflow, M, ROOT, HEAD, TOKEN, OTHER_TOKEN, nonce } from "./stage0-guard-fixture.mjs";

const PROD = "gmxyisjjaxtpycsmmzef";
const hex = (n) => randomBytes(n / 2).toString("hex");
const WF = () => ({ t: synthWorkflow("production", { P: [["A1", "P2-01"], ["A2", "STATE"], ["A3", "P2-02"]], Q: [["B1", "P2-01"]] }) });

async function refused(fn, re, label = "") {
  let err = null;
  try { await fn(); } catch (e) { err = e; }
  assert.ok(err, `${label}: expected a refusal`);
  assert.ok(err instanceof G.Refusal, `${label}: expected a Refusal, got ${err && err.constructor.name}: ${err && err.message}`);
  if (re) assert.match(err.message, re, label);
  return err;
}

/** A store with a clock check, phase P and a W window (1001), and a PENDING claim for A1 (its receipt could not be written). */
async function pendingBase() {
  const fx = fixture({ workflows: WF() });
  fx.clock();
  const ph = fx.phase("t", "P");
  const W = fx.window("W", ph.phaseId, { pid: 1001 });
  const go = fx.issue(ph.phaseId, "A1");
  const e = await fx.send(G, { text: "P2-01", target: "production", win: W, goId: go.goId, over: { writeReceipt: () => { throw new Error("synthetic receipt-disk failure"); } } }).catch((x) => x);
  assert.ok(e instanceof G.AfterDispatch);
  assert.equal(fx.calls.length, 1);
  const st = fx.status();
  assert.equal(st.intact, true);
  assert.deepEqual(st.holds.map((h) => h.kind), ["PENDING"]);
  return { fx, ph, W, go, attemptId: st.holds[0].attemptId };
}

/** A copy of the seven pinned chain files: another checkout of the same commit. */
function otherCheckout() {
  const dir = mkdtempSync(join(tmpdir(), "s0-checkout-"));
  mkdirSync(join(dir, "scripts", "manual"), { recursive: true });
  for (const f of M.guard.files) writeFileSync(join(dir, f.path), readFileSync(join(ROOT, f.path), "utf8").replace(/\r\n/g, "\n"));
  return dir;
}

/**
 * After damage: no usable go and no request, from the issuer and the sender,
 * in the old phase, a fresh phase, a fresh window and another checkout.
 */
async function noGoNoRequest(fx, { ph, W, go }, label, { storeGone = false } = {}) {
  const before = fx.calls.length;
  const gosBefore = existsSync(fx.paths.gos) ? readdirSync(fx.paths.gos).filter((f) => f.endsWith(".json")).length : 0;
  const re = storeGone ? /no guard store|DAMAGED/ : /DAMAGED/;
  fx.add(1000);
  await refused(() => fx.issue(ph.phaseId, "A1"), re, `${label}: the issuer, old phase`);
  await refused(() => fx.send(G, { text: "P2-01", target: "production", win: W, goId: go.goId }), re, `${label}: the sender, the old go`);
  await refused(() => fx.register("t", "Q"), re, `${label}: a fresh phase`);
  await refused(() => fx.window("W", ph.phaseId, { pid: 3001 }), re, `${label}: a fresh window`);
  const other = otherCheckout();
  try {
    await refused(() => GO.main(["draft", "--workflow", "t", "--phase", "Q"], {}, { root: other, manifest: M, anchor: fx.anchor, stateDir: fx.stateDir, now: fx.now, git: fx.git, execArgv: [], stdout: () => {}, workflows: fx.workflows }), re, `${label}: another checkout`);
  } finally { rmSync(other, { recursive: true, force: true }); }
  const st = existsSync(fx.stateDir) ? fx.status() : { intact: false };
  assert.equal(st.intact, false, `${label}: status reports damage`);
  assert.ok(!("holds" in st), `${label}: and no holds list`);
  assert.equal(fx.calls.length, before, `${label}: no further request`);
  const gosAfter = existsSync(fx.paths.gos) ? readdirSync(fx.paths.gos).filter((f) => f.endsWith(".json")).length : 0;
  assert.ok(gosAfter <= gosBefore, `${label}: no new go`);
}

// ── ST-1 ─────────────────────────────────────────────────────────────────────

test("ST-1 I6-R1: only init makes a store; clock, draft, phase, window, issue, send, void and dispose refuse where none is, and make none", async () => {
  const fx = fixture({ workflows: WF(), init: false });
  try {
    fx.anchor = { schema: "stage0-guard-anchor/1", storeId: hex(32), createdAt: G.iso(fx.now()), refs: { production: PROD, staging: M.send.targets.staging }, predecessor: null };
    const gone = /no guard store/;
    await refused(() => fx.clock(), gone, "clock");
    await refused(() => fx.draft("t", "P"), gone, "draft");
    await refused(() => fx.register("t", "P", { goText: `GO phase P approval ${hex(16)}` }), gone, "phase");
    await refused(() => fx.window("W", hex(32), { pid: 1001 }), gone, "window");
    await refused(() => fx.issue(hex(32), "A1"), gone, "issue");
    await refused(() => fx.void(hex(32)), gone, "void");
    writeFileSync(join(fx.dir, "r.md"), "x");
    await refused(() => fx.dispose(hex(32), join(fx.dir, "r.md")), /review file does not name|no guard store/, "dispose");
    fx.shell(1001);
    await refused(() => fx.send(G, { text: "P2-01", target: "production", win: { env: { [G.SESSION_ENV]: nonce(1), [G.TOKEN_ENV]: TOKEN }, pid: 1001 }, goId: hex(32) }), /no guard store|DAMAGED/, "send");
    assert.equal(fx.status().intact, false);
    assert.equal(existsSync(fx.stateDir), false, "nothing made the store");
    assert.equal(fx.calls.length, 0);
  } finally { fx.cleanup(); }
});

test("ST-1b I6-R1: init refuses an occupied path (even empty) and an established anchor; two concurrent inits make one store", async () => {
  const fx = fixture({ workflows: WF(), init: false });
  try {
    mkdirSync(fx.stateDir);
    await refused(() => G.initStore({ paths: fx.paths, manifest: M, anchor: null, now: fx.now() }), /exists\. A store is made only where nothing is/);
    rmSync(fx.stateDir, { recursive: true });
    await refused(() => G.initStore({ paths: fx.paths, manifest: M, anchor: { storeId: hex(32) }, now: fx.now() }), /records an established store .* init --restore/);
    assert.equal(existsSync(fx.stateDir), false);
    // Two processes, released together.
    const w = join(fx.dir, "w.mjs");
    writeFileSync(w, `
import { existsSync, writeFileSync } from "node:fs";
const G = await import(process.env.S0_GUARD);
const M = JSON.parse(process.env.S0_M);
while (!existsSync(process.env.S0_START)) await new Promise((r) => setTimeout(r, 2));
try { const s = G.initStore({ paths: G.statePaths(process.env.S0_STATE), manifest: M, anchor: null, now: Date.now() }); writeFileSync(process.argv[2], JSON.stringify({ ok: true, storeId: s.storeId })); }
catch (e) { writeFileSync(process.argv[2], JSON.stringify({ ok: false, message: e.message })); }
`);
    const start = join(fx.dir, "start");
    const env = { ...process.env, S0_GUARD: pathToFileURL(join(ROOT, "scripts", "manual", "stage0-guard.mjs")).href, S0_M: JSON.stringify({ send: M.send }), S0_START: start, S0_STATE: fx.stateDir };
    const outs = [0, 1, 2].map((i) => join(fx.dir, `o${i}.json`));
    const procs = outs.map((o) => { const p = spawn(process.execPath, [w, o], { env, stdio: "ignore" }); return new Promise((r) => p.on("exit", r)); });
    await new Promise((r) => setTimeout(r, 800));
    writeFileSync(start, "go");
    await Promise.all(procs);
    const res = outs.map((o) => JSON.parse(readFileSync(o, "utf8")));
    assert.equal(res.filter((r) => r.ok).length, 1, JSON.stringify(res));
    const store = G.readState(fx.paths.store);
    assert.equal(store.storeId, res.find((r) => r.ok).storeId);
    assert.deepEqual(readdirSync(fx.dir).filter((n) => n.startsWith("state.init-")), [], "no leftover build directory");
    fx.anchor = G.anchorFor(store);
    assert.equal(fx.check().ok, true);
  } finally { fx.cleanup(); }
});

// ── ST-2 ─────────────────────────────────────────────────────────────────────

test("ST-2 I6-R1: the anchor is read at HEAD; absent is null, malformed refuses; a store that is not the anchored one refuses", async () => {
  const repo = mkdtempSync(join(tmpdir(), "s0-anchor-"));
  try {
    const git = (...a) => execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...a], { cwd: repo, stdio: ["ignore", "pipe", "pipe"] });
    git("init", "-q");
    writeFileSync(join(repo, "a.txt"), "a");
    git("add", "a.txt");
    git("commit", "-q", "-m", "a");
    assert.equal(G.anchorAt(repo), null, "no anchor at HEAD");
    mkdirSync(join(repo, "docs", "security"), { recursive: true });
    writeFileSync(join(repo, G.ANCHOR_PATH), '{"schema":"stage0-guard-anchor/1"}');
    git("add", G.ANCHOR_PATH);
    git("commit", "-q", "-m", "bad");
    assert.throws(() => G.anchorAt(repo), (e) => e instanceof G.Refusal && /has no storeId/.test(e.message));
    const fx = fixture({ workflows: WF() });
    try {
      writeFileSync(join(repo, G.ANCHOR_PATH), JSON.stringify(fx.anchor, null, 2) + "\n");
      git("add", G.ANCHOR_PATH);
      git("commit", "-q", "-m", "good");
      assert.deepEqual(G.anchorAt(repo), fx.anchor);
      assert.equal(fx.check().ok, true);
      const real = fx.anchor;
      fx.anchor = { ...real, storeId: hex(32) };
      await refused(() => fx.clock(), /is not the one the repository records/, "another store's anchor");
      fx.anchor = null;
      await refused(() => fx.clock(), /records no established store at HEAD/, "no anchor");
      fx.anchor = { ...real, refs: { ...real.refs, staging: "abcdefghijabcdefghij" } };
      await refused(() => fx.clock(), /is not the one the repository records/, "other refs");
    } finally { fx.cleanup(); }
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

// ── ST-3 ─────────────────────────────────────────────────────────────────────

test("ST-3 I6-R1, Codex's reproductions: journal moved, journal replaced by a file, sole pending claim moved: no go, no request", async () => {
  for (const kind of ["the journal directory moved away", "the journal path replaced by a regular file", "the sole pending claim moved away"]) {
    const b = await pendingBase();
    try {
      await refused(() => b.fx.issue(b.ph.phaseId, "A1"), /the project is held: PENDING/, `${kind}: held before the damage`);
      const j = b.fx.paths.journal(PROD);
      if (kind.includes("directory")) renameSync(j, join(b.fx.dir, "saved-journal"));
      if (kind.includes("regular file")) { renameSync(j, join(b.fx.dir, "saved-journal")); writeFileSync(j, "synthetic non-directory"); }
      if (kind.includes("claim")) renameSync(join(j, `${b.attemptId}.claim.json`), join(b.fx.dir, "saved-claim.json"));
      assert.match(b.fx.check().problems.join(" "), kind.includes("claim") ? /claim\.json is missing: the ledger records it/ : /journal.gmxyisjjaxtpycsmmzef is missing or not a directory/, kind);
      await noGoNoRequest(b.fx, b, kind);
    } finally { b.fx.cleanup(); }
  }
});

test("ST-3b I6-R1, Codex's reproduction: the whole store moved away; ordinary setup refuses and makes nothing; an immediate send refuses; init refuses while the repository anchors the lost store", async () => {
  const b = await pendingBase();
  try {
    renameSync(b.fx.stateDir, join(b.fx.dir, "saved-state"));
    await refused(() => b.fx.clock(), /no guard store/, "the clock check");
    await refused(() => b.fx.draft("t", "Q"), /no guard store/, "a new approval");
    await refused(() => b.fx.register("t", "Q", { goText: `GO phase Q approval ${hex(16)}` }), /no guard store/, "a phase");
    await refused(() => b.fx.window("W", b.ph.phaseId, { pid: 3003 }), /no guard store/, "a window");
    await refused(() => b.fx.send(G, { text: "P2-01", target: "production", win: b.W, goId: b.go.goId }), /no guard store|DAMAGED/, "an immediate send");
    await refused(() => G.initStore({ paths: b.fx.paths, manifest: M, anchor: b.fx.anchor, now: b.fx.now() }), /records an established store/, "a fresh init");
    await refused(() => GO.main(["init"], {}, { manifest: M, anchor: b.fx.anchor, stateDir: b.fx.stateDir, now: b.fx.now, git: b.fx.git, execArgv: [], stdout: () => {} }), /records an established store/, "init through the command line");
    assert.equal(existsSync(b.fx.stateDir), false, "nothing recreated the store");
    await noGoNoRequest(b.fx, b, "a lost store", { storeGone: true });
    assert.equal(b.fx.calls.length, 1, "only the original request");
  } finally { b.fx.cleanup(); }
});

test("ST-3c I6-R1, Codex's reproductions: a disposed claim damaged into invalid JSON is not excused by its disposition; a nulled outstanding go gives no second go", async () => {
  {
    const b = await pendingBase();
    try {
      const review = join(b.fx.dir, "review.md");
      writeFileSync(review, `Reviewed disposition of synthetic attempt ${b.attemptId}.`);
      b.fx.dispose(b.attemptId, review);
      assert.deepEqual(b.fx.status().holds, [], "disposed");
      writeFileSync(join(b.fx.paths.journal(PROD), `${b.attemptId}.claim.json`), "{damaged JSON");
      assert.equal(G.holdsOf(G.readJournal(b.fx.paths, PROD), { ctxAt: b.fx.ctxAt })[0].kind, "HOLD", "holdsOf no longer skips a disposed attempt's problems");
      await noGoNoRequest(b.fx, b, "a damaged disposed claim");
    } finally { b.fx.cleanup(); }
  }
  {
    const fx = fixture({ workflows: WF() });
    try {
      fx.clock();
      const ph = fx.phase("t", "P");
      const W = fx.window("W", ph.phaseId, { pid: 1001 });
      const first = fx.issue(ph.phaseId, "A1");
      writeFileSync(join(fx.paths.gos, `${first.goId}.json`), "null");
      await refused(() => fx.issue(ph.phaseId, "A1"), /DAMAGED.*is not the file the ledger records/, "a second go for the step");
      await refused(() => fx.send(G, { text: "P2-01", target: "production", win: W, goId: first.goId }), /DAMAGED/, "the nulled go");
      assert.equal(readdirSync(fx.paths.gos).filter((f) => f.endsWith(".json")).length, 1);
      assert.equal(fx.calls.length, 0);
    } finally { fx.cleanup(); }
  }
});

// ── ST-4 ─────────────────────────────────────────────────────────────────────

test("ST-4 I6-R1, Codex's reproduction: a missing or invalid high-water record refuses (it is never recreated by a check); a clock check re-establishes it and records what it found", async () => {
  for (const kind of ["missing", "invalid"]) {
    const fx = fixture({ workflows: WF() });
    try {
      fx.clock();
      const ph = fx.phase("t", "P");
      const W = fx.window("W", ph.phaseId, { pid: 1001 });
      const go = fx.issue(ph.phaseId, "A1");
      G.checkClock(fx.paths, fx.now() + 10000, fx.check());
      fx.add(5000);
      assert.throws(() => G.checkClock(fx.paths, fx.now(), fx.check()), /went back/);
      if (kind === "missing") unlinkSync(fx.paths.hwm); else writeFileSync(fx.paths.hwm, "{broken");
      assert.throws(() => G.checkClock(fx.paths, fx.now(), fx.check()), new RegExp(`high-water record is ${kind}`), kind);
      assert.equal(existsSync(fx.paths.hwm), kind === "invalid", `${kind}: the check recreated nothing`);
      await refused(() => fx.send(G, { text: "P2-01", target: "production", win: W, goId: go.goId }), new RegExp(`high-water record is ${kind}`), `${kind}: the sender`);
      fx.void(go.goId);
      await refused(() => fx.issue(ph.phaseId, "A1"), new RegExp(`high-water record is ${kind}`), `${kind}: the issuer`);
      await refused(() => fx.window("R", ph.phaseId, { pid: 1002 }), /sends nothing|high-water/, `${kind}: setup`);
      assert.equal(fx.calls.length, 0);
      const rec = fx.clock();
      assert.equal(rec.hwmBefore, kind, "the clock check records what it found");
      const g2 = fx.issue(ph.phaseId, "A1");
      const r = await fx.send(G, { text: "P2-01", target: "production", win: W, goId: g2.goId });
      assert.equal(r.record.httpStatus, 201, `${kind}: after the clock check`);
    } finally { fx.cleanup(); }
  }
  {
    const fx = fixture({ workflows: WF() });
    try {
      fx.clock();
      const ph = fx.phase("t", "P");
      fx.window("W", ph.phaseId, { pid: 1001 });
      // A high-water record that cannot be advanced refuses: here hwm.json is a directory.
      fx.add(1000);
      unlinkSync(fx.paths.hwm);
      mkdirSync(fx.paths.hwm);
      await refused(() => fx.issue(ph.phaseId, "A1"), /high-water record is (invalid|missing)|could not be advanced/);
    } finally { fx.cleanup(); }
  }
});

// ── ST-5 ─────────────────────────────────────────────────────────────────────

/** A store with one DISPATCHED R2 write (A1) and a disposition of an older PENDING attempt in Q; returns its ids and files. */
async function fullBase() {
  const fx = fixture({ workflows: WF() });
  fx.clock();
  const q = fx.phase("t", "Q");
  const Wq = fx.window("W", q.phaseId, { pid: 1005 });
  const gq = fx.issue(q.phaseId, "B1");
  await fx.send(G, { text: "P2-01", target: "production", win: Wq, goId: gq.goId, over: { writeReceipt: () => { throw new Error("disk"); } } }).catch(() => {});
  const pendingId = fx.status().holds[0].attemptId;
  const review = join(fx.dir, "review.md");
  writeFileSync(review, `attempt ${pendingId}: reviewed`);
  fx.dispose(pendingId, review);
  fx.add(1000);
  const ph = fx.phase("t", "P");
  const W = fx.window("W", ph.phaseId, { pid: 1001 });
  const go = fx.issue(ph.phaseId, "A1");
  const r = await fx.send(G, { text: "P2-01", target: "production", win: W, goId: go.goId });
  assert.equal(fx.check().ok, true);
  const j = fx.paths.journal(PROD);
  return { fx, ph, W, go, attemptId: r.attemptId, pendingId, files: {
    claim: join(j, `${r.attemptId}.claim.json`), outcome: join(j, `${r.attemptId}.outcome.json`), disposition: join(j, `${pendingId}.disposition.json`),
    used: join(fx.paths.used, `${go.goId}.json`), phase: join(fx.paths.phases, `${ph.phaseId}.json`), goText: join(fx.paths.phases, `${ph.phaseId}.go.txt`),
    approval: join(fx.paths.approvals, `${ph.approvalId}.json`), marker: join(fx.paths.markers, `${W.marker.markerId}.json`),
  } };
}

test("ST-5 I6-R1: a missing outcome, disposition, used go, phase, go text, approval or marker; an unknown file; a swapped claim; a broken, truncated or half-written ledger: each is damage, with no go and no request", async () => {
  const cases = [
    ["a missing outcome", (b) => unlinkSync(b.files.outcome), /outcome\.json is missing: the ledger records it/],
    ["a missing disposition", (b) => unlinkSync(b.files.disposition), /disposition\.json is missing: the ledger records it/],
    ["a missing used go", (b) => unlinkSync(b.files.used), /gos.used.[0-9a-f]{32}\.json is missing/],
    ["a missing phase", (b) => unlinkSync(b.files.phase), /phases.[0-9a-f]{32}\.json is missing/],
    ["a missing go text", (b) => unlinkSync(b.files.goText), /\.go\.txt is missing/],
    ["a missing approval", (b) => unlinkSync(b.files.approval), /approvals.[0-9a-f]{16}\.json is missing/],
    ["a missing open marker", (b) => unlinkSync(b.files.marker), /markers.[0-9a-f]{32}\.json is missing/],
    ["an unknown file among the phases", (b) => writeFileSync(join(b.fx.paths.phases, "notes.txt"), "x"), /phases.notes\.txt is present, but the ledger does not record it/],
    ["an unknown entry in the store", (b) => writeFileSync(join(b.fx.stateDir, "extra.json"), "{}"), /extra\.json is present in the store/],
    ["a claim swapped with another attempt's", (b) => writeFileSync(b.files.claim, readFileSync(join(b.fx.paths.journal(PROD), `${b.pendingId}.claim.json`))), /claim\.json is not the file the ledger records/],
    ["a ledger line edited", (b) => { const t = readFileSync(b.fx.paths.ledger, "utf8").split("\n"); t[3] = t[3].replace('"seq":4', '"seq":40'); writeFileSync(b.fx.paths.ledger, t.join("\n")); }, /ledger line 4 has sequence 40/],
    ["a ledger line re-hashed out of order", (b) => { const t = readFileSync(b.fx.paths.ledger, "utf8").split("\n"); [t[4], t[5]] = [t[5], t[4]]; writeFileSync(b.fx.paths.ledger, t.join("\n")); }, /has sequence|does not follow/],
    ["the ledger's last line removed", (b) => { const t = readFileSync(b.fx.paths.ledger, "utf8").split("\n"); t.splice(-2, 1); writeFileSync(b.fx.paths.ledger, t.join("\n")); }, /outcome\.json is present, but the ledger does not record it/],
    ["a half-written last line", (b) => appendFileSync(b.fx.paths.ledger, '{"seq":'), /last line is incomplete/],
    ["the ledger missing", (b) => unlinkSync(b.fx.paths.ledger), /the ledger is missing/],
    ["store.json replaced", (b) => writeFileSync(b.fx.paths.store, JSON.stringify({ ...G.readState(b.fx.paths.store), storeId: hex(32) })), /is not the one the repository records/],
  ];
  for (const [label, damage, re] of cases) {
    const b = await fullBase();
    try {
      damage(b);
      const chk = b.fx.check();
      assert.equal(chk.ok, false, label);
      assert.match(chk.problems.join(" "), re, label);
      await noGoNoRequest(b.fx, b, label);
    } finally { b.fx.cleanup(); }
  }
});

// ── ST-6 ─────────────────────────────────────────────────────────────────────

test("ST-6 I6-R1: status prints no holds list for a damaged store; close still records on a readable ledger, and on an unreadable one changes nothing and says why", async () => {
  {
    const b = await fullBase();
    try {
      unlinkSync(b.files.outcome);
      const out = [];
      const r = GO.main(["status", "--target", "production"], {}, { manifest: M, anchor: b.fx.anchor, stateDir: b.fx.stateDir, now: b.fx.now, execArgv: [], stdout: (s) => out.push(s), ctxAt: b.fx.ctxAt });
      assert.equal(r.exit, 3);
      assert.equal(r.status.intact, false);
      assert.match(out.join(""), /DAMAGED: .* Holds are unknown/);
      assert.ok(!out.join("").includes('"holds"'), "no holds list printed");
      const c = WIN.main(["close"], b.W.env, { stateDir: b.fx.stateDir, now: b.fx.now, stdout: () => {} });
      assert.deepEqual(c.closed.markers, [b.W.marker.markerId], "close works on a damaged store whose ledger reads");
      assert.ok(existsSync(join(b.fx.paths.closed, `${b.W.marker.markerId}.json`)), "the marker is kept, as evidence");
    } finally { b.fx.cleanup(); }
  }
  {
    const b = await fullBase();
    try {
      appendFileSync(b.fx.paths.ledger, "garbage\n");
      const out = [];
      const c = WIN.main(["close"], b.W.env, { stateDir: b.fx.stateDir, now: b.fx.now, stdout: (s) => out.push(s) });
      assert.equal(c.exit, 3);
      assert.deepEqual(c.closed.markers, []);
      assert.match(out.join(""), /close could not record: .*the ledger is damaged.*continue with the next steps/);
      assert.match(out.join(""), /Remove-Item Env:SUPABASE_ACCESS_TOKEN; Remove-Item Env:STAGE0_SESSION; exit/);
      assert.ok(existsSync(b.files.marker), "nothing moved");
      const none = WIN.main(["close"], b.W.env, { stateDir: join(b.fx.dir, "nowhere"), now: b.fx.now, stdout: () => {} });
      assert.equal(none.exit, 3, "no store at all: close still runs, and says so");
    } finally { b.fx.cleanup(); }
  }
});

// ── ST-7 ─────────────────────────────────────────────────────────────────────

test("ST-7 I6-R1: a ledger that cannot be written refuses and leaves nothing unrecorded; a lock held by another process refuses after the wait", async () => {
  const fx = fixture({ workflows: WF() });
  try {
    fx.clock();
    const ph = fx.phase("t", "P");
    fx.window("W", ph.phaseId, { pid: 1001 });
    chmodSync(fx.paths.ledger, 0o444);
    try {
      await refused(() => fx.issue(ph.phaseId, "A1"), /the go-issue could not be recorded|EPERM|EACCES/);
    } finally { chmodSync(fx.paths.ledger, 0o644); }
    assert.equal(readdirSync(fx.paths.gos).filter((f) => f.endsWith(".json")).length, 0, "the go file was undone");
    assert.equal(fx.check().ok, true, "the store is still consistent");
    writeFileSync(fx.paths.lock, "pid 1 since 2026-10-28T14:00:00.000Z");
    const t = Date.now();
    await refused(() => fx.issue(ph.phaseId, "A1"), /has held the store lock for over 10 s/);
    assert.ok(Date.now() - t >= 9000, "it waited for the lock");
    unlinkSync(fx.paths.lock);
    assert.ok(fx.issue(ph.phaseId, "A1").goId);
  } finally { fx.cleanup(); }
});

// ── ST-8 ─────────────────────────────────────────────────────────────────────

test("ST-8 I6-R1: a reviewed restoration: init --restore names the lost store and a review; the new store works only once the anchor names it", async () => {
  const b = await pendingBase();
  try {
    const lost = b.fx.anchor.storeId;
    renameSync(b.fx.stateDir, join(b.fx.dir, "evidence-store"));
    const review = join(b.fx.dir, "restore-review.md");
    writeFileSync(review, "reviewed, but not naming it");
    await refused(() => G.initStore({ paths: b.fx.paths, manifest: M, anchor: b.fx.anchor, now: b.fx.now(), restore: { predecessor: lost, reviewedPath: review, reviewedBytes: readFileSync(review) } }), /does not name the lost store's id/);
    await refused(() => G.initStore({ paths: b.fx.paths, manifest: M, anchor: b.fx.anchor, now: b.fx.now(), restore: { predecessor: hex(32), reviewedPath: review, reviewedBytes: readFileSync(review) } }), /records store .*, not/);
    await refused(() => G.initStore({ paths: b.fx.paths, manifest: M, anchor: null, now: b.fx.now(), restore: { predecessor: lost, reviewedPath: review, reviewedBytes: readFileSync(review) } }), /nothing to restore/);
    writeFileSync(review, `Restoration reviewed: store ${lost} was lost; its attempt ${b.attemptId} stays undecided.`);
    const out = [];
    const r = GO.main(["init", "--restore", "--predecessor", lost, "--reviewed", review], {}, { manifest: M, anchor: b.fx.anchor, stateDir: b.fx.stateDir, now: b.fx.now, git: b.fx.git, execArgv: [], stdout: (s) => out.push(s) });
    assert.equal(r.store.predecessor.storeId, lost);
    assert.match(out.join(""), /Commit this, exactly, as docs\/security\/stage0-guard-store\.json/);
    await refused(() => b.fx.clock(), /is not the one the repository records/, "until the anchor names the new store");
    b.fx.anchor = G.anchorFor(r.store);
    b.fx.clock();
    assert.equal(b.fx.check().ok, true, "with the reviewed anchor");
  } finally { b.fx.cleanup(); }
});

// ── AP: one registration per human approval (I6-R2) ─────────────────────────

test("AP-1 I6-R2: an approval id registers one phase; the same text again returns it; other words, no id, two ids, an undrafted or foreign id refuse", async () => {
  const fx = fixture({ workflows: WF() });
  try {
    fx.clock();
    const first = fx.register("t", "P");
    assert.equal(first.existing, false);
    fx.add(1000);
    const again = fx.register("t", "P", { goText: first.goText });
    assert.equal(again.existing, true);
    assert.equal(again.phase.phaseId, first.phase.phaseId, "the same phase");
    await refused(() => fx.register("t", "P", { goText: first.goText + " (again)" }), /already registered .* with another text/);
    await refused(() => fx.register("t", "P", { goText: first.goText.replace(/approval [0-9a-f]{16}/, "") }), /exactly one "approval <16 hex>" \(it carries 0\)/);
    await refused(() => fx.register("t", "P", { goText: `${first.goText} approval ${hex(16)}` }), /it carries 2/);
    const dl = Date.parse(first.phase.deadline);
    await refused(() => fx.register("t", "P", { goText: fx.goText("t", "P", dl, hex(16)) }), /was never drafted in this store/);
    const forQ = fx.draft("t", "Q");
    await refused(() => fx.register("t", "P", { goText: fx.goText("t", "P", dl, forQ) }), /was drafted for t Q/);
    assert.equal(readdirSync(fx.paths.phases).filter((f) => f.endsWith(".json")).length, 1, "one phase");
    assert.equal(fx.check().ok, true);
  } finally { fx.cleanup(); }
});

test("AP-2 I6-R2, Codex's reproduction: after A1 is sent and the window closed, the same go recorded again (same text, same arrival) gives the same phase: A1 is refused with no request, A2 is next", async () => {
  const fx = fixture({ workflows: WF() });
  try {
    fx.clock();
    const r1 = fx.register("t", "P");
    const ph = r1.phase;
    const W = fx.window("W", ph.phaseId, { pid: 1001 });
    const go = fx.issue(ph.phaseId, "A1");
    await fx.send(G, { text: "P2-01", target: "production", win: W, goId: go.goId });
    assert.equal(fx.calls.length, 1);
    G.closeSession({ paths: fx.paths, env: W.env, now: fx.now() });
    fx.add(1000);
    const r2 = fx.register("t", "P", { goText: r1.goText, arrivedAt: ph.arrivedAt, deadline: Date.parse(ph.deadline) });
    assert.equal(r2.existing, true);
    assert.equal(r2.phase.phaseId, ph.phaseId);
    const W2 = fx.window("W", r2.phase.phaseId, { pid: 4004, token: OTHER_TOKEN });
    await refused(() => fx.issue(r2.phase.phaseId, "A1"), /the gate does not name A1: the next step is A2/);
    const forged = fx.forgeGo({ phase: ph, marker: W2.marker, step: "A1", text: "P2-01", target: "production" });
    await refused(() => fx.send(G, { text: "P2-01", target: "production", win: W2, goId: forged.goId }), /the gate does not name A1/);
    assert.equal(fx.calls.length, 1, "no second request");
    fx.void(forged.goId);
    const R = fx.window("R", ph.phaseId, { pid: 4005 });
    const g2 = fx.issue(ph.phaseId, "A2");
    await fx.send(G, { text: "STATE", target: "production", win: R, goId: g2.goId });
    fx.add(1000);
    const g3 = fx.issue(ph.phaseId, "A3");
    await fx.send(G, { text: "P2-02", target: "production", win: W2, goId: g3.goId });
    fx.add(1000);
    assert.equal(fx.register("t", "P", { goText: r1.goText }).phase.phaseId, ph.phaseId, "after completion too");
    await refused(() => fx.issue(ph.phaseId, "A1"), /phase P is complete/);
    assert.equal(fx.calls.length, 3);
  } finally { fx.cleanup(); }
});

test("AP-3 I6-R2: concurrent registration of one approval, in separate processes, makes one phase", async () => {
  const fx = fixture({ workflows: WF() });
  try {
    fx.clock();
    const id = fx.draft("t", "P");
    const dl = Math.floor((fx.now() + 45 * 60000) / 60000) * 60000;
    const text = fx.goText("t", "P", dl, id);
    const w = join(fx.dir, "w.mjs");
    writeFileSync(w, `
import { readFileSync, existsSync, writeFileSync } from "node:fs";
const c = JSON.parse(readFileSync(process.argv[2], "utf8"));
const F = await import(c.fixture);
const fx = F.fixture({ workflows: { t: F.synthWorkflow("production", c.phases) }, attach: { stateDir: c.stateDir, results: c.results }, t0: c.now });
while (!existsSync(c.start)) await new Promise((r) => setTimeout(r, 2));
try { const r = fx.register("t", "P", { goText: c.text, deadline: c.dl }); writeFileSync(c.out, JSON.stringify({ ok: true, phaseId: r.phase.phaseId, existing: r.existing })); }
catch (e) { writeFileSync(c.out, JSON.stringify({ ok: false, message: e.message })); }
`);
    const start = join(fx.dir, "start");
    const runs = [0, 1, 2].map((i) => {
      const cfg = join(fx.dir, `c${i}.json`);
      const out = join(fx.dir, `o${i}.json`);
      writeFileSync(cfg, JSON.stringify({ fixture: pathToFileURL(join(ROOT, "scripts", "tests", "stage0-guard-fixture.mjs")).href, phases: { P: [["A1", "P2-01"], ["A2", "STATE"], ["A3", "P2-02"]], Q: [["B1", "P2-01"]] }, stateDir: fx.stateDir, results: fx.results, now: fx.now(), start, out, text, dl }));
      const p = spawn(process.execPath, [w, cfg], { stdio: "ignore" });
      return { out, done: new Promise((r) => p.on("exit", r)) };
    });
    await new Promise((r) => setTimeout(r, 1500));
    writeFileSync(start, "go");
    await Promise.all(runs.map((r) => r.done));
    const res = runs.map((r) => JSON.parse(readFileSync(r.out, "utf8")));
    assert.ok(res.every((r) => r.ok), JSON.stringify(res));
    assert.equal(new Set(res.map((r) => r.phaseId)).size, 1, "one phase id");
    assert.equal(res.filter((r) => !r.existing).length, 1, "registered once, returned twice");
    assert.equal(readdirSync(fx.paths.phases).filter((f) => f.endsWith(".json")).length, 1);
    assert.equal(fx.check().ok, true);
  } finally { fx.cleanup(); }
});

test("AP-4 I6-R2: a genuine restart needs a newly drafted id and a new approved line; it is a new phase", async () => {
  const fx = fixture({ workflows: WF() });
  try {
    fx.clock();
    const a = fx.register("t", "P");
    fx.add(1000);
    const b = fx.register("t", "P");
    assert.notEqual(a.approvalId, b.approvalId);
    assert.notEqual(a.phase.phaseId, b.phase.phaseId);
    assert.equal(b.existing, false);
    assert.equal(fx.check().ok, true);
  } finally { fx.cleanup(); }
});

// ── ORD: the cheap checks come first, through the real command lines ────────

test("ORD Codex's ordering note: node options and a planted program refuse before any program starts, in all three command lines", { timeout: 120000 }, () => {
  const dir = otherCheckout(); // not a git repository: any program call would fail differently
  try {
    const run = (script, args, env, label, re) => {
      const r = spawnSync(process.execPath, [join(dir, "scripts", "manual", script), ...args], { cwd: dir, env, encoding: "utf8" });
      assert.equal(r.status, 2, `${label}: exit 2 (${r.stderr})`);
      assert.match(r.stderr, re, label);
      assert.ok(!/not a git repository|ENOENT|spawn/.test(r.stderr), `${label}: no program ran first (${r.stderr})`);
    };
    const base = { ...process.env };
    delete base.NODE_OPTIONS;
    delete base[G.TOKEN_ENV];
    delete base[G.SESSION_ENV];
    const opt = { ...base, NODE_OPTIONS: "--no-deprecation" };
    run("stage0-send.mjs", ["P0", "--target", "production", "--confirm-ref", PROD, "--go", hex(32)], opt, "the sender", /NODE_OPTIONS is set/);
    run("stage0-window.mjs", ["open", "--role", "R", "--phase", hex(32)], opt, "the window", /NODE_OPTIONS is set/);
    run("stage0-go.mjs", ["status", "--target", "production"], opt, "the issuer", /NODE_OPTIONS is set/);
    writeFileSync(join(dir, "git.exe"), "");
    run("stage0-send.mjs", ["P0", "--target", "production", "--confirm-ref", PROD, "--go", hex(32)], base, "the sender, planted git", /git\.exe exists, and would run in place of the system program/);
    run("stage0-window.mjs", ["open", "--role", "R", "--phase", hex(32)], base, "the window, planted git", /git\.exe exists/);
    run("stage0-go.mjs", ["issue", "--phase", hex(32), "--step", "A1"], base, "the issuer, planted git", /git\.exe exists/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
