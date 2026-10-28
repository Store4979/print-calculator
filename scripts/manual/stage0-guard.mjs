// scripts/manual/stage0-guard.mjs — the checks a live stage-0 send passes
// before any request, and the records they read (Codex item 6: the incident
// review of 2026-10-12, §6, and K-R2 of the review of df401b3; the plan
// docs/security/stage0-item6-sender-guards-plan.md, as amended by Codex's
// reviews of 2026-10-27: SG-1 to SG-6 on the plan, I6-R1 and I6-R2 on 78db6dc).
//
// It is a library. Three pinned command lines use it:
//   stage0-go.mjs      (Claude) initializes the store once, records the clock
//                      check, drafts approval ids, records Ryan's phase go,
//                      issues one go per send, voids or disposes;
//   stage0-window.mjs  (Ryan, in each PowerShell window) opens and closes
//                      the window's marker;
//   stage0-send.mjs    (Ryan) sends one pinned text, naming its go by id.
//
// THE STORE (I6-R1). The records live in one per-user directory outside every
// checkout (~/.stage0-guard). It exists only once `stage0-go.mjs init` has
// made it: no other command creates it, or any directory in it. Its identity
// (store.json) is recorded in the repository (ANCHOR_PATH) in a reviewed
// commit, and every live command refuses unless the store here is that one.
// So a lost or replaced store is not a fresh start: `init` refuses while the
// repository names an established store, and a replacement is made only by
// `init --restore`, naming the lost store's id and a review file, and is
// usable only once the repository's anchor names it.
//   store.json             the store's id, creation time, the project refs,
//                          and the store it replaced (if any);
//   ledger.jsonl           one line per event, each with its sequence number
//                          and the sha256 of the line before: every phase,
//                          approval draft, marker, go, claim, outcome,
//                          disposition and clock check, with the sha256 of
//                          the file it wrote;
//   hwm.json               the latest time a guard tool has seen;
//   clock/<…>.json         each accepted clock check;
//   phases/<id>.json       Ryan's go for one phase, with his message's exact
//                          text beside it (<id>.go.txt);
//   approvals/<id>.json    the one phase registered for each approval id;
//   markers/<id>.json      one per open window; a closed one moves to
//                          markers/closed/;
//   gos/<id>.json          one per send, unused; a used go moves to gos/used/,
//                          a voided one to gos/void/;
//   journal/<ref>/         the claim of each admitted send, written before any
//                          request can be made, then its outcome and any
//                          disposition.
// storeCheck() replays the ledger and requires every file it names to exist
// with its recorded sha256 where its lifecycle puts it, every file present to
// be one it names, and every claim, outcome and disposition to belong to a go,
// a claim and a phase it recorded. Any difference is DAMAGE: nothing is
// issued, admitted or registered until a reviewed restoration.
//
// What the code checks, and what it does not:
//   - Each check below throws a Refusal before any request. The one place a
//     request can follow is guardedSend(), after the claim is journalled; from
//     there on a failure is AfterDispatch, never "nothing was sent".
//   - The marker binds a shell PROCESS: Windows' own record of the pid and
//     creation time of the process that started node. A child shell that
//     inherited the environment has another pid, so it is refused. A window
//     a person walks away from still matches until the phase deadline. "Every
//     pause is an exit" stays a procedure.
//   - Each step has a CEILING, its latest start: the phase deadline less the
//     time its workflow declaration reserves for the whole remaining path
//     from that step (stepCeilings). A later step may have an earlier
//     ceiling. Every phase declares its ceilings, except the reviewed capture
//     phases B, A, T and U, which keep the capture-phase admission cutoff
//     (the deadline less MARGIN_MS). The phase records its ceilings, the go
//     records its step's, and the issuer and the sender each recompute it
//     from the pinned declaration and the phase's deadline, refusing any
//     other value: a go's deadline is never later than its step's ceiling.
//   - Ryan's go line for a phase that declares ceilings is drafted by the
//     tool (goLine) with every step's latest start and the deadline, and is
//     registered only if his message is exactly that line.
//   - A go may carry an earlier NOT-AFTER, the latest start Claude's current
//     whole-path check allows; it is required for production. The sender
//     enforces the go's deadline, whichever bound set it. The code binds the
//     value; it does not compute the path.
//   - The production NUMBERS, and the whole-path budget they come from, are
//     item 4(c)'s, in review; no production phase is declared.
//   - The deadline bounds admission on this machine's clock. The clock check
//     compares that clock with a time server, within a stated tolerance; it
//     is not a guarantee of when a server starts the work, and it cancels
//     nothing.
//   - Recording a phase checks that Ryan's message names its approval id,
//     the phase, head, ref, deadline and steps. It does not show who wrote
//     the message.
//   - Anyone who can edit these files together, or the pinned code, can
//     defeat them. The pins, review and the runbook procedures are the
//     controls for that.
import { execFileSync } from "node:child_process";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, openSync, writeSync, fsyncSync, closeSync, readdirSync, renameSync, unlinkSync, mkdirSync, existsSync, statSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join, posix } from "node:path";
import * as A from "./assemble-stage0.mjs";
import * as C from "./stage0-classify.mjs";
import * as K from "./stage0-capture.mjs";
import * as I3 from "./stage0-item3.mjs";

/** A refusal before any request was made. The command lines exit 2. */
export class Refusal extends Error {}
/** A failure after a request was, or may have been, dispatched. The sender exits 5: HOLD. */
export class AfterDispatch extends Error {}
class NotSent extends Error {}

export const ROLES = Object.freeze(["R", "W", "C"]);
export const SHELLS = Object.freeze(["powershell.exe", "pwsh.exe"]);
export const SESSION_ENV = "STAGE0_SESSION";
export const TOKEN_ENV = "SUPABASE_ACCESS_TOKEN";
export const DEFAULT_STATE = join(homedir(), ".stage0-guard");
/** The repository's record of the established store (I6-R1), read at HEAD. */
export const ANCHOR_PATH = "docs/security/stage0-guard-store.json";
/** The clock check (SG-5): three w32tm samples against the reference, each within the tolerance; valid for freshMs. */
export const CLOCK = Object.freeze({ reference: "time.windows.com", samples: 3, toleranceMs: 2000, freshMs: 60 * 60 * 1000, backstepMs: 2000 });
/** No step's ceiling is later than the phase deadline less this. A step with no declared ceiling has exactly this one: the capture-phase admission cutoff. */
export const MARGIN_MS = 60 * 1000;
/** Ryan's go is recorded within this long of its arrival, with at least the second value left (capture runbook §3). */
export const PHASE_LIMITS = Object.freeze({ recordWithinMs: 10 * 60 * 1000, minRemainingMs: 30 * 60 * 1000 });
/** How long a command waits for the store lock before it refuses. */
export const LOCK_WAIT_MS = 10 * 1000;
/** The command lines that create authority or admit a send; the manifest pins everything they load (SG-6). */
export const CHAIN_ENTRIES = Object.freeze(["scripts/manual/stage0-send.mjs", "scripts/manual/stage0-window.mjs", "scripts/manual/stage0-go.mjs"]);
export const BUILTINS = Object.freeze(["node:child_process", "node:crypto", "node:fs", "node:os", "node:path", "node:url"]);

const SYSTEM32 = join(process.env.SystemRoot || "C:\\Windows", "System32");
const POWERSHELL = join(SYSTEM32, "WindowsPowerShell", "v1.0", "powershell.exe");
const W32TM = join(SYSTEM32, "w32tm.exe");

// ── small, total validators ─────────────────────────────────────────────────

const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const hex = (n) => (v) => typeof v === "string" && v.length === n && /^[0-9a-f]+$/.test(v);
const isId = hex(32);
const isApproval = hex(16);
const isSha = hex(64);
const isCommit = hex(40);
const isRef = (v) => typeof v === "string" && /^[a-z]{20}$/.test(v);
const isName = (v) => typeof v === "string" && /^[A-Z0-9][A-Z0-9-]{0,39}$/.test(v);
const isRole = (v) => ROLES.includes(v);
const an = (role) => (role === "R" ? "an R" : `a ${role}`);
const isInt = (v) => Number.isSafeInteger(v) && v >= 0;
const isPos = (v) => Number.isSafeInteger(v) && v > 0;
const isStr = (max) => (v) => typeof v === "string" && v.length > 0 && v.length <= max;
const isBool = (v) => typeof v === "boolean";
/** An absolute UTC time with milliseconds, as the tools write them: ms, or null. Total. */
export function utcMs(s) {
  if (typeof s !== "string" || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/.test(s)) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) && new Date(t).toISOString() === s ? t : null;
}
const isUtc = (v) => utcMs(v) !== null;
/** A Windows process creation time as the identity query prints it (seven fractional digits): ms, or null. Total. */
export function createdMs(s) {
  if (typeof s !== "string" || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{7}Z$/.test(s)) return null;
  const ms = s.slice(0, 23) + "Z";
  const t = Date.parse(ms);
  return Number.isFinite(t) && new Date(t).toISOString() === ms ? t : null;
}
export const iso = (ms) => new Date(ms).toISOString();
export const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const sameKeys = (o, keys) => isObj(o) && JSON.stringify(Object.keys(o).sort()) === JSON.stringify([...keys].sort());

/** The problems of `o` against an exact shape {key: predicate}; empty when it fits. */
function shapeProblems(o, spec, label) {
  if (!isObj(o)) return [`${label} is not one JSON object`];
  const out = [];
  for (const k of Object.keys(spec)) if (!own(o, k)) out.push(`${label} has no ${k}`);
  for (const k of Object.keys(o)) if (!own(spec, k)) out.push(`${label} has an unknown field ${k}`);
  for (const [k, ok] of Object.entries(spec)) if (own(o, k) && !ok(o[k])) out.push(`${label}.${k} has the wrong type or form`);
  return out;
}

const SHELL_SPEC = { pid: isPos, image: (v) => SHELLS.includes(v), created: (v) => createdMs(v) !== null };
const isShell = (v) => shapeProblems(v, SHELL_SPEC, "shell").length === 0;
const REQUEST_SPEC = { md5: hex(32), bytes: isPos, readOnly: isBool, endpoint: isStr(200) };
const isRequest = (v) => shapeProblems(v, REQUEST_SPEC, "request").length === 0;
const isReviewed = (v) => v === null || shapeProblems(v, { path: isStr(1024), sha256: isSha }, "reviewed").length === 0;
const isRefs = (v) => sameKeys(v, ["production", "staging"]) && isRef(v.production) && isRef(v.staging);
const isPredecessor = (v) => v === null || (shapeProblems(v, { storeId: isId, reviewed: (r) => r !== null && isReviewed(r) }, "predecessor").length === 0);

export const STORE_SPEC = { schema: (v) => v === "stage0-store/1", storeId: isId, createdAt: isUtc, refs: isRefs, predecessor: isPredecessor };
export const ANCHOR_SPEC = { schema: (v) => v === "stage0-guard-anchor/1", storeId: isId, createdAt: isUtc, refs: isRefs, predecessor: isPredecessor };
export const PHASE_SPEC = {
  schema: (v) => v === "stage0-phase/3", phaseId: isId, approvalId: isApproval, workflow: isStr(40), phase: isStr(40),
  steps: (v) => Array.isArray(v) && v.length > 0 && v.length <= 64 && v.every(isName) && new Set(v).size === v.length,
  target: isStr(40), ref: isRef, head: isCommit, checkout: isStr(1024),
  arrivedAt: isUtc, recordedAt: isUtc, deadline: isUtc,
  ceilings: (v) => isObj(v) && Object.keys(v).length > 0 && Object.keys(v).length <= 64 && Object.entries(v).every(([k, x]) => isName(k) && isUtc(x)),
  goText: (v) => shapeProblems(v, { sha256: isSha, bytes: isInt }, "goText").length === 0,
  reviewed: isReviewed,
};
const APPROVAL_SPEC = { schema: (v) => v === "stage0-approval/1", approvalId: isApproval, phaseId: isId };
export const MARKER_SPEC = {
  schema: (v) => v === "stage0-marker/1", markerId: isId, role: isRole, phaseId: isId, phaseSha: isSha,
  target: isStr(40), ref: isRef, head: isCommit, checkout: isStr(1024), createdAt: isUtc, until: isUtc,
  sessionId: isSha, tokenTag: isSha, shell: isShell,
};
export const GO_SPEC = {
  schema: (v) => v === "stage0-go/3", goId: isId, phaseId: isId, phaseSha: isSha, workflow: isStr(40), phase: isStr(40),
  step: isName, text: isName, target: isStr(40), ref: isRef, head: isCommit, checkout: isStr(1024), role: isRole, markerId: isId,
  issuedAt: isUtc, ceiling: isUtc, notAfter: (v) => v === null || isUtc(v), deadline: isUtc, request: isRequest, cancel: (v) => v === null,
  gate: (v) => shapeProblems(v, { next: isName, after: (a) => Array.isArray(a) && a.every(isId) }, "gate").length === 0,
};
export const CLAIM_SPEC = {
  schema: (v) => v === "stage0-claim/1", attemptId: isId, seq: isPos, goId: isId, phaseId: isId,
  step: isName, text: isName, target: isStr(40), ref: isRef, role: isRole, markerId: isId, shell: isShell,
  head: isCommit, checkout: isStr(1024), request: isRequest, issuedAt: isUtc, deadline: isUtc, claimedAt: isUtc,
};
export const OUTCOME_SPEC = {
  NOT_SENT: { schema: (v) => v === "stage0-outcome/1", attemptId: isId, state: (v) => v === "NOT_SENT", at: isUtc, reason: isStr(500) },
  DISPATCHED: {
    schema: (v) => v === "stage0-outcome/1", attemptId: isId, state: (v) => v === "DISPATCHED", at: isUtc,
    receipt: (v) => shapeProblems(v, { file: isStr(1024), sha256: isSha, bytes: isInt }, "receipt").length === 0,
    httpStatus: (v) => v === null || (Number.isSafeInteger(v) && v >= 100 && v <= 599),
  },
};
export const DISPOSITION_SPEC = { schema: (v) => v === "stage0-disposition/1", attemptId: isId, reviewed: (v) => v !== null && isReviewed(v), recordedAt: isUtc };
const CLOCK_SPEC = {
  schema: (v) => v === "stage0-clock/1", at: isUtc, reference: (v) => v === CLOCK.reference, offsetsMs: (v) => Array.isArray(v) && v.length === CLOCK.samples && v.every(Number.isSafeInteger),
  maxAbsOffsetMs: isInt, toleranceMs: (v) => v === CLOCK.toleranceMs, source: isStr(120), lastSync: isStr(120), leap: isStr(120),
  hwmBefore: (v) => v === "missing" || v === "invalid" || isUtc(v),
};
const HWM_SPEC = { ms: isInt, at: isUtc };
/** The receipt's guard block (SG-4): what the admission journal and marker bound. Never the token, the session value or the token HMAC. */
export const RECEIPT_GUARD_SPEC = { attemptId: isId, goId: isId, phaseId: isId, step: isName, markerId: isId, role: isRole, head: isCommit, issuedAt: isUtc, deadline: isUtc };

/** Each ledger event's own fields, besides seq, prev, at and kind. */
const EVENT_SPECS = {
  init: { storeId: isId },
  clock: { file: (v) => typeof v === "string" && /^[0-9TZ-]{24}_[0-9a-f]{8}\.json$/.test(v), sha256: isSha },
  draft: { approvalId: isApproval, workflow: isStr(40), phase: isStr(40), ref: isRef, head: isCommit, deadline: (v) => v === null || isUtc(v) },
  phase: { phaseId: isId, approvalId: isApproval, ref: isRef, sha256: isSha, goTextSha256: isSha, approvalSha256: isSha },
  "marker-open": { markerId: isId, phaseId: isId, ref: isRef, sha256: isSha },
  "marker-close": { markerId: isId, reason: (v) => v === "close" || v === "gone" },
  "go-issue": { goId: isId, phaseId: isId, step: isName, ref: isRef, markerId: isId, sha256: isSha },
  "go-void": { goId: isId, reason: (v) => v === "void" || v === "expired" || v === "close" },
  claim: { attemptId: isId, goId: isId, ref: isRef, claimSeq: isPos, sha256: isSha },
  outcome: { attemptId: isId, state: (v) => v === "NOT_SENT" || v === "DISPATCHED", sha256: isSha },
  disposition: { attemptId: isId, sha256: isSha },
};
const LINE_SPEC = { seq: isPos, prev: isSha, at: isUtc, kind: (v) => typeof v === "string" && own(EVENT_SPECS, v) };
const ZERO = "0".repeat(64);

// ── files ────────────────────────────────────────────────────────────────────

export function statePaths(dir) {
  return {
    dir,
    store: join(dir, "store.json"),
    ledger: join(dir, "ledger.jsonl"),
    hwm: join(dir, "hwm.json"),
    lock: join(dir, "lock"),
    clockLog: join(dir, "clock"),
    phases: join(dir, "phases"),
    approvals: join(dir, "approvals"),
    markers: join(dir, "markers"),
    closed: join(dir, "markers", "closed"),
    gos: join(dir, "gos"),
    used: join(dir, "gos", "used"),
    voided: join(dir, "gos", "void"),
    journalRoot: join(dir, "journal"),
    journal: (ref) => join(dir, "journal", ref),
  };
}
const SUBDIRS = (p, refs) => [p.clockLog, p.phases, p.approvals, p.markers, p.closed, p.gos, p.used, p.voided, p.journalRoot, ...refs.map((r) => p.journal(r))];

/** The exact JSON of a state file, or throws. */
export function readState(file) {
  return C.strictJson(readFileSync(file, "utf8"), { maxChars: 1 << 20 });
}

/** Write a new file, never over an existing one, and flush it. Creates no directory: the store's exist from init. */
export function writeOnce(file, value) {
  const fd = openSync(file, "wx");
  try { writeSync(fd, typeof value === "string" ? value : JSON.stringify(value, null, 2) + "\n"); fsyncSync(fd); } finally { closeSync(fd); }
}

function replaceFile(file, value) {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n");
  renameSync(tmp, file);
}

const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };
const newId = () => randomBytes(16).toString("hex");
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/**
 * Hold the store lock for fn: exclusive create, retried for up to waitMs,
 * then a refusal. The lock serializes every change to the store: approval
 * drafts, phase registration, markers, gos, claims, outcomes, dispositions
 * and clock checks.
 */
export function withLock(paths, fn, now, waitMs = LOCK_WAIT_MS) {
  if (!isDir(paths.dir)) throw new Refusal(`no guard store at ${paths.dir}; refusing`);
  const until = Date.now() + waitMs;
  let fd = null;
  for (;;) {
    try { fd = openSync(paths.lock, "wx"); break; } catch (e) {
      if (!e || e.code !== "EEXIST") throw new Refusal(`the store lock cannot be taken (${e && e.code}); refusing`);
      if (Date.now() >= until) {
        let since = "an unknown time";
        try { since = readFileSync(paths.lock, "utf8").trim().slice(0, 80); } catch { /* reported as unknown */ }
        throw new Refusal(`another guard process has held the store lock for over ${waitMs / 1000} s (${since}). If none is running, the lock is stale: check with stage0-go.mjs status, then remove ${paths.lock} by hand and record it; refusing`);
      }
      sleep(25);
    }
  }
  try { writeSync(fd, `pid ${process.pid} since ${iso(now)}`); } finally { closeSync(fd); }
  try { return fn(); } finally { try { unlinkSync(paths.lock); } catch { /* already gone */ } }
}

/** Rule 3′'s context at a head: the manifest committed there, assembled and checked against its pins. */
export const contextAt = (head, root) => C.contextAt(head, root);

// ── the store: identity, anchor, ledger and its check (I6-R1) ───────────────

/** The repository's anchor at HEAD: the established store's identity, or null when the repository records none. */
export function anchorAt(root, rev = "HEAD") {
  const git = (...a) => execFileSync("git", a, { cwd: root, stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1 << 20 }).toString("utf8");
  let listed;
  try { listed = git("ls-tree", "--name-only", rev, "--", ANCHOR_PATH).trim(); } catch (e) { throw new Refusal(`git could not read ${ANCHOR_PATH} at ${rev} (${String(e && e.message).split("\n")[0]}); refusing`); }
  if (!listed) return null;
  let a;
  try { a = C.strictJson(git("show", `${rev}:${ANCHOR_PATH}`), { maxChars: 4096 }); } catch { throw new Refusal(`${ANCHOR_PATH} at ${rev} is not one strict JSON object; refusing`); }
  const bad = shapeProblems(a, ANCHOR_SPEC, ANCHOR_PATH);
  if (bad.length) throw new Refusal(`${bad.join("; ")}; refusing`);
  return a;
}

/** The anchor text to commit for a store (the store's identity, under the anchor's schema). */
export const anchorFor = (store) => ({ schema: "stage0-guard-anchor/1", storeId: store.storeId, createdAt: store.createdAt, refs: store.refs, predecessor: store.predecessor });

/**
 * Make the store, explicitly (I6-R1). Refuses when anything exists at its
 * path. A first store needs the repository to record none; a replacement
 * (`restore`) needs the repository to record the lost store's id, and a
 * review file that names it. The store is built beside its path and renamed
 * into place, so two concurrent inits cannot both succeed. It returns the
 * new store record; the repository's anchor must then be committed, in
 * review, before any live command accepts it.
 */
export function initStore({ paths, manifest, anchor, now, restore = null }) {
  const refs = { production: manifest.send.targets.production, staging: manifest.send.targets.staging };
  if (!isRefs(refs)) throw new Refusal("the manifest does not name the production and staging refs; refusing");
  let predecessor = null;
  if (restore === null) {
    if (anchor) throw new Refusal(`the repository records an established store (${anchor.storeId}). A lost or damaged store is replaced only by a reviewed restoration: init --restore; refusing`);
  } else {
    if (!anchor) throw new Refusal("the repository records no established store, so there is nothing to restore; refusing");
    if (restore.predecessor !== anchor.storeId) throw new Refusal(`the repository records store ${anchor.storeId}, not ${String(restore.predecessor).slice(0, 32)}; refusing`);
    if (!Buffer.isBuffer(restore.reviewedBytes) || !restore.reviewedBytes.toString("utf8").includes(anchor.storeId)) throw new Refusal("the review file does not name the lost store's id; refusing");
    predecessor = { storeId: anchor.storeId, reviewed: { path: restore.reviewedPath, sha256: sha256(restore.reviewedBytes) } };
  }
  if (existsSync(paths.dir)) throw new Refusal(`${paths.dir} exists. A store is made only where nothing is; a damaged one is moved aside, as evidence, by hand and on the record; refusing`);
  const store = { schema: "stage0-store/1", storeId: newId(), createdAt: iso(now), refs, predecessor };
  const tmp = `${paths.dir}.init-${newId().slice(0, 8)}`;
  const t = statePaths(tmp);
  try {
    mkdirSync(tmp);
    for (const d of SUBDIRS(t, [refs.production, refs.staging])) mkdirSync(d);
    writeOnce(t.store, store);
    writeOnce(t.hwm, { ms: now, at: iso(now) });
    const line = JSON.stringify({ seq: 1, prev: ZERO, at: iso(now), kind: "init", storeId: store.storeId });
    writeOnce(t.ledger, line + "\n");
    renameSync(tmp, paths.dir);
  } catch (e) {
    try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort: a leftover .init- directory is not the store */ }
    if (e instanceof Refusal) throw e;
    throw new Refusal(`the store could not be made (${e && e.code ? e.code : e && e.message}); refusing`);
  }
  return store;
}

/** The ledger's events, checked line by line: strict JSON, exact shape, consecutive sequence, and each line's prev the sha256 of the line before. */
export function readLedger(paths) {
  let raw;
  try { raw = readFileSync(paths.ledger, "utf8"); } catch (e) { return { events: [], problems: [`the ledger is missing or unreadable (${e && e.code})`], seq: 0, tail: ZERO }; }
  const problems = [];
  const lines = raw.split("\n");
  const last = lines.pop();
  if (last !== "") problems.push("the ledger's last line is incomplete");
  const events = [];
  let prev = ZERO;
  for (const [i, line] of lines.entries()) {
    let ev = null;
    try { ev = C.strictJson(line, { maxChars: 1 << 16 }); } catch (e) { problems.push(`ledger line ${i + 1} is not strict JSON (${e.message})`); break; }
    const spec = isObj(ev) && own(EVENT_SPECS, ev.kind) ? { ...LINE_SPEC, ...EVENT_SPECS[ev.kind] } : LINE_SPEC;
    const bad = shapeProblems(ev, spec, `ledger line ${i + 1}`);
    if (bad.length) { problems.push(...bad); break; }
    if (ev.seq !== i + 1) { problems.push(`ledger line ${i + 1} has sequence ${ev.seq}`); break; }
    if (ev.prev !== prev) { problems.push(`ledger line ${i + 1} does not follow line ${i}: the chain is broken`); break; }
    prev = sha256(Buffer.from(line, "utf8"));
    events.push(ev);
  }
  if (!events.length && !problems.length) problems.push("the ledger is empty");
  return { events, problems, seq: events.length, tail: prev };
}

/** Append one event (the store lock is held, and chk is this lock's storeCheck). Throws on any failure. */
function appendEvent(paths, chk, kind, fields, now) {
  const ev = { seq: chk.seq + 1, prev: chk.tail, at: iso(now), kind, ...fields };
  const bad = shapeProblems(ev, { ...LINE_SPEC, ...EVENT_SPECS[kind] }, `the ${kind} event`);
  if (bad.length) throw new Refusal(`${bad.join("; ")}; refusing`);
  const line = JSON.stringify(ev);
  const fd = openSync(paths.ledger, "a");
  try { writeSync(fd, line + "\n"); fsyncSync(fd); } finally { closeSync(fd); }
  chk.seq += 1;
  chk.tail = sha256(Buffer.from(line, "utf8"));
  return ev;
}

/**
 * Write the files of one event, then record it; if recording fails, undo the
 * writes and refuse. `steps` are [do, undo] pairs, run in order.
 */
function logged(paths, chk, kind, fields, steps, now) {
  const done = [];
  try {
    for (const [doIt, undo] of steps) { doIt(); done.push(undo); }
    return appendEvent(paths, chk, kind, fields, now);
  } catch (e) {
    for (const undo of done.reverse()) { try { undo(); } catch { /* the check below reports what is left */ } }
    if (e instanceof Refusal) throw e;
    throw new Refusal(`the ${kind} could not be recorded (${e && e.code ? e.code : e && e.message}); nothing was changed that the ledger does not record; refusing`);
  }
}
const fileStep = (file, value) => [() => writeOnce(file, value), () => unlinkSync(file)];
const moveStep = (from, to) => [() => renameSync(from, to), () => renameSync(to, from)];

/**
 * The store, checked against its ledger (I6-R1). Returns { ok, problems,
 * store, seq, tail, index }. `ok` is true only when: the store and every
 * directory exist; the store is the one the repository's anchor names, for
 * the manifest's refs; the ledger chains from its init event; each event
 * follows the lifecycle (a draft before its phase, a phase before its
 * markers and gos, a go issued before it is used or voided, a claim before
 * its outcome and disposition, each once); every file an event names exists
 * where its lifecycle puts it, with the recorded sha256 and the ids the
 * event names; and no file is present that no event names. A disposition
 * releases a hold; it never excuses a problem found here.
 */
export function storeCheck({ paths, anchor, manifest }) {
  const problems = [];
  const say = (s) => problems.push(s);
  const index = { drafts: new Map(), phases: new Map(), approvals: new Map(), markers: new Map(), gos: new Map(), claims: new Map(), outcomes: new Map(), dispositions: new Map(), clocks: [], claimSeq: {} };
  const result = (store, L) => ({ ok: problems.length === 0, problems, store, seq: L ? L.seq : 0, tail: L ? L.tail : ZERO, index });
  if (!isDir(paths.dir)) { say(`no guard store at ${paths.dir}: it was never made here (stage0-go.mjs init), or it is lost`); return result(null, null); }
  let store = null;
  try { store = readState(paths.store); } catch { say("store.json is missing or not strict JSON"); return result(null, null); }
  const sbad = shapeProblems(store, STORE_SPEC, "store.json");
  if (sbad.length) { problems.push(...sbad); return result(null, null); }
  if (!anchor) say(`the repository records no established store at HEAD (${ANCHOR_PATH})`);
  else if (JSON.stringify(anchorFor(store)) !== JSON.stringify(anchor)) say(`the store here (${store.storeId}) is not the one the repository records (${anchor.storeId})`);
  if (manifest && (store.refs.production !== manifest.send.targets.production || store.refs.staging !== manifest.send.targets.staging)) say("the store's refs are not the manifest's");
  const refs = [store.refs.production, store.refs.staging];
  for (const d of SUBDIRS(paths, refs)) if (!isDir(d)) say(`${d.slice(paths.dir.length + 1)} is missing or not a directory`);
  const L = readLedger(paths);
  problems.push(...L.problems);
  if (problems.length) return result(store, L);
  const ev0 = L.events[0];
  if (ev0.kind !== "init" || ev0.storeId !== store.storeId) say("the ledger does not start with this store's init");

  // Replay the ledger into what must exist.
  const expect = new Map(); // path → { sha, check(value) }
  const want = (file, sha, check = null) => { expect.set(file, { sha, check }); };
  const del = (file) => expect.delete(file);
  const rel = (i, s) => say(`ledger line ${i + 1}: ${s}`);
  const idsMatch = (spec, fields, label) => (v) => {
    const bad = shapeProblems(v, spec, label);
    for (const [k, x] of Object.entries(fields)) if (!bad.length && v[k] !== x) bad.push(`${label}.${k} is not the ledger's`);
    return bad;
  };
  for (const [i, ev] of L.events.entries()) {
    if (i === 0) continue;
    const ref = ev.ref;
    if (ref !== undefined && !refs.includes(ref)) { rel(i, `ref ${ref} is not this store's`); continue; }
    switch (ev.kind) {
      case "init": rel(i, "a second init"); break;
      case "clock":
        if (index.clocks.some((c) => c.file === ev.file)) rel(i, "a clock check recorded twice");
        index.clocks.push(ev);
        want(join(paths.clockLog, ev.file), ev.sha256, (v) => shapeProblems(v, CLOCK_SPEC, `clock/${ev.file}`));
        break;
      case "draft":
        if (index.drafts.has(ev.approvalId)) rel(i, `approval ${ev.approvalId} drafted twice`);
        index.drafts.set(ev.approvalId, ev);
        break;
      case "phase": {
        const d = index.drafts.get(ev.approvalId);
        if (!d) rel(i, `phase ${ev.phaseId} names approval ${ev.approvalId}, which was never drafted`);
        else if (d.ref !== ref) rel(i, `phase ${ev.phaseId}'s ref is not its approval's`);
        if (index.approvals.has(ev.approvalId)) rel(i, `approval ${ev.approvalId} registered twice`);
        if (index.phases.has(ev.phaseId)) rel(i, `phase ${ev.phaseId} registered twice`);
        index.approvals.set(ev.approvalId, ev.phaseId);
        index.phases.set(ev.phaseId, ev);
        want(join(paths.phases, `${ev.phaseId}.json`), ev.sha256, idsMatch(PHASE_SPEC, { phaseId: ev.phaseId, approvalId: ev.approvalId, ref }, `phase ${ev.phaseId}`));
        want(join(paths.phases, `${ev.phaseId}.go.txt`), ev.goTextSha256);
        want(join(paths.approvals, `${ev.approvalId}.json`), ev.approvalSha256, idsMatch(APPROVAL_SPEC, { approvalId: ev.approvalId, phaseId: ev.phaseId }, `approval ${ev.approvalId}`));
        break;
      }
      case "marker-open": {
        const ph = index.phases.get(ev.phaseId);
        if (!ph) rel(i, `marker ${ev.markerId} names phase ${ev.phaseId}, which was never registered`);
        else if (ph.ref !== ref) rel(i, `marker ${ev.markerId}'s ref is not its phase's`);
        if (index.markers.has(ev.markerId)) rel(i, `marker ${ev.markerId} opened twice`);
        index.markers.set(ev.markerId, { open: true, ev });
        want(join(paths.markers, `${ev.markerId}.json`), ev.sha256, idsMatch(MARKER_SPEC, { markerId: ev.markerId, phaseId: ev.phaseId, ref }, `marker ${ev.markerId}`));
        break;
      }
      case "marker-close": {
        const m = index.markers.get(ev.markerId);
        if (!m || !m.open) { rel(i, `marker ${ev.markerId} is closed but was not open`); break; }
        m.open = false;
        const e = expect.get(join(paths.markers, `${ev.markerId}.json`));
        del(join(paths.markers, `${ev.markerId}.json`));
        want(join(paths.closed, `${ev.markerId}.json`), e.sha, e.check);
        break;
      }
      case "go-issue": {
        const ph = index.phases.get(ev.phaseId);
        if (!ph) rel(i, `go ${ev.goId} names phase ${ev.phaseId}, which was never registered`);
        else if (ph.ref !== ref) rel(i, `go ${ev.goId}'s ref is not its phase's`);
        if (!index.markers.has(ev.markerId)) rel(i, `go ${ev.goId} names marker ${ev.markerId}, which was never opened`);
        if (index.gos.has(ev.goId)) rel(i, `go ${ev.goId} issued twice`);
        index.gos.set(ev.goId, { state: "live", ev });
        want(join(paths.gos, `${ev.goId}.json`), ev.sha256, idsMatch(GO_SPEC, { goId: ev.goId, phaseId: ev.phaseId, step: ev.step, ref, markerId: ev.markerId }, `go ${ev.goId}`));
        break;
      }
      case "go-void": case "claim": {
        const g = index.gos.get(ev.goId);
        if (!g || g.state !== "live") { rel(i, `go ${ev.goId} is ${ev.kind === "claim" ? "used" : "voided"} but is not a live go`); break; }
        g.state = ev.kind === "claim" ? "used" : "void";
        const e = expect.get(join(paths.gos, `${ev.goId}.json`));
        del(join(paths.gos, `${ev.goId}.json`));
        want(join(g.state === "used" ? paths.used : paths.voided, `${ev.goId}.json`), e.sha, e.check);
        if (ev.kind === "go-void") break;
        if (g.ev.ref !== ref) rel(i, `claim ${ev.attemptId}'s ref is not its go's`);
        if (index.claims.has(ev.attemptId)) rel(i, `attempt ${ev.attemptId} claimed twice`);
        index.claimSeq[ref] = (index.claimSeq[ref] || 0) + 1;
        if (ev.claimSeq !== index.claimSeq[ref]) rel(i, `claim ${ev.attemptId} has sequence ${ev.claimSeq}; ${index.claimSeq[ref]} is next for ${ref}`);
        index.claims.set(ev.attemptId, { ev, go: g.ev });
        g.attemptId = ev.attemptId;
        want(join(paths.journal(ref), `${ev.attemptId}.claim.json`), ev.sha256, idsMatch(CLAIM_SPEC, { attemptId: ev.attemptId, goId: ev.goId, ref, seq: ev.claimSeq, phaseId: g.ev.phaseId, step: g.ev.step, markerId: g.ev.markerId }, `claim ${ev.attemptId}`));
        break;
      }
      case "outcome": case "disposition": {
        const c = index.claims.get(ev.attemptId);
        if (!c) { rel(i, `${ev.kind} for attempt ${ev.attemptId}, which was never claimed`); break; }
        const map = ev.kind === "outcome" ? index.outcomes : index.dispositions;
        if (map.has(ev.attemptId)) rel(i, `a second ${ev.kind} for attempt ${ev.attemptId}`);
        map.set(ev.attemptId, ev);
        const cref = c.ev.ref;
        const spec = ev.kind === "outcome" ? OUTCOME_SPEC[ev.state] : DISPOSITION_SPEC;
        want(join(paths.journal(cref), `${ev.attemptId}.${ev.kind}.json`), ev.sha256, (v) => {
          const bad = shapeProblems(v, spec, `${ev.kind} ${ev.attemptId}`);
          if (!bad.length && v.attemptId !== ev.attemptId) bad.push(`${ev.kind} ${ev.attemptId} names another attempt`);
          if (!bad.length && ev.kind === "outcome" && v.state !== ev.state) bad.push(`outcome ${ev.attemptId}'s state is not the ledger's`);
          return bad;
        });
        break;
      }
      default: rel(i, `unknown kind ${ev.kind}`);
    }
  }

  // Every expected file, as recorded; and nothing else.
  for (const [file, e] of expect) {
    const label = file.slice(paths.dir.length + 1);
    let buf;
    try { buf = readFileSync(file); } catch { say(`${label} is missing: the ledger records it`); continue; }
    if (sha256(buf) !== e.sha) { say(`${label} is not the file the ledger records`); continue; }
    if (e.check) {
      let v = null;
      try { v = C.strictJson(buf.toString("utf8"), { maxChars: 1 << 20 }); } catch { say(`${label} is not strict JSON`); continue; }
      for (const b of e.check(v)) say(b);
    }
  }
  const listing = (dir, skip = []) => { try { return readdirSync(dir).filter((n) => !skip.includes(n)); } catch { say(`${dir.slice(paths.dir.length + 1)} cannot be listed`); return []; } };
  for (const [dir, skip] of [[paths.clockLog, []], [paths.phases, []], [paths.approvals, []], [paths.markers, ["closed"]], [paths.closed, []], [paths.gos, ["used", "void"]], [paths.used, []], [paths.voided, []], ...refs.map((r) => [paths.journal(r), []])]) {
    for (const n of listing(dir, skip)) if (!expect.has(join(dir, n))) say(`${join(dir, n).slice(paths.dir.length + 1)} is present, but the ledger does not record it`);
  }
  for (const n of listing(paths.journalRoot)) if (!refs.includes(n)) say(`journal/${n} is not one of the store's refs`);
  for (const n of listing(paths.dir)) {
    if (["store.json", "ledger.jsonl", "hwm.json", "lock", "clock", "phases", "approvals", "markers", "gos", "journal"].includes(n) || /^hwm\.json\.[0-9]+\.tmp$/.test(n)) continue;
    say(`${n} is present in the store, but is not one of its files`);
  }
  return result(store, L);
}

/** The checked store, or a refusal naming the damage. */
export function requireStore({ paths, anchor, manifest }) {
  const chk = storeCheck({ paths, anchor, manifest });
  if (!chk.ok) {
    const list = chk.problems.slice(0, 5).join("; ") + (chk.problems.length > 5 ? `; and ${chk.problems.length - 5} more` : "");
    throw new Refusal(`the guard store is DAMAGED or not the established one: ${list}. Nothing is registered, issued or sent until a reviewed restoration; refusing`);
  }
  return chk;
}

// ── the policy's window roles (Q2) ──────────────────────────────────────────

/** The text's window role from the manifest's send policy. Missing or unknown refuses; read_only is never consulted. */
export function roleOf(manifest, text) {
  const texts = manifest && manifest.send && manifest.send.texts;
  const p = isObj(texts) && typeof text === "string" && own(texts, text) ? texts[text] : null;
  if (!p || !isRole(p.window)) throw new Refusal(`${isName(text) ? text : "the text"} has no window role in the manifest's send policy; refusing`);
  return p.window;
}

// ── the pinned chain (SG-6) ─────────────────────────────────────────────────

// The words the audit below looks for are assembled from pieces, because the
// audit also reads this file: written out, they would be findings here.
const KEYWORD = ["im", "port"].join("");
const HEADER = new RegExp(`^${KEYWORD} [^"'\`;\\n]+ from "([^"\\n]+)";$`);
const REEXPORT = new RegExp(`\\b${["ex", "port"].join("")}\\s*[*{]`);
const LOADER = new RegExp(`\\b(?:${[["re", "quire"], ["create", "Re", "quire"], ["ev", "al"]].map((p) => p.join("")).join("|")})\\b|\\b${["Func", "tion"].join("")}\\s*\\(`);
/**
 * The module specifiers a chain file loads, read without a parser, failing
 * closed. Every occurrence of the module keyword in the raw text, comments
 * included, must be either a whole line of the one-line static form
 * (keyword, names, `from "<spec>";`) at column 0, or the keyword followed by
 * `.meta.url`. A multi-line, side-effect-only or dynamic form is a problem,
 * and so are export lists, star re-exports, the CommonJS loader words, the
 * code-evaluation word and a call of the Function constructor, anywhere.
 * JavaScript keywords cannot contain escapes, so a real static or dynamic
 * load always shows the keyword. The parser-based closure in
 * stage0-manifest-check.mjs (M-13) checks the same files against acorn.
 */
export function importAudit(src, path) {
  const specs = [];
  const problems = [];
  const lines = String(src).replace(/\r\n/g, "\n").split("\n");
  for (const [i, line] of lines.entries()) {
    const at = `${path}:${i + 1}`;
    const W = new RegExp(`\\b${KEYWORD}\\b`, "g");
    let m;
    while ((m = W.exec(line))) {
      if (m.index === 0 && HEADER.test(line)) { specs.push(HEADER.exec(line)[1]); continue; }
      if (line.startsWith(".meta.url", m.index + KEYWORD.length)) continue;
      problems.push(`${at}: the module keyword outside the one-line static form`);
    }
    if (REEXPORT.test(line)) problems.push(`${at}: an export list or a star re-export`);
    if (LOADER.test(line)) problems.push(`${at}: a loader or code-evaluation word`);
  }
  return { specs, problems };
}

/** Every repository file `entry` loads, transitively, through importAudit; `read(path)` gives the source or null. */
export function chainClosure(entry, read) {
  const seen = new Set();
  const problems = [];
  const queue = [entry];
  while (queue.length) {
    const p = queue.shift();
    if (seen.has(p)) continue;
    seen.add(p);
    const src = read(p);
    if (typeof src !== "string") { problems.push(`${p} cannot be read`); continue; }
    const a = importAudit(src, p);
    problems.push(...a.problems);
    for (const s of a.specs) {
      if (BUILTINS.includes(s)) continue;
      if (/^\.\.?\//.test(s)) queue.push(posix.normalize(posix.join(posix.dirname(p), s)));
      else problems.push(`${p} loads ${JSON.stringify(s)}, which is neither a repository file nor an allowed node: module`);
    }
  }
  return { files: [...seen].sort(), problems };
}

/** LF-normalized blob id of a working-tree file, as git would store it. */
export function workingBlob(path, root) {
  const lf = Buffer.from(readFileSync(join(root, path)).toString("utf8").replace(/\r\n/g, "\n"), "utf8");
  return execFileSync("git", ["hash-object", "--stdin"], { cwd: root, input: lf }).toString().trim();
}

/**
 * Refuse unless everything `entry` loads is pinned by the manifest's guard
 * chain, with its pinned blob in the working tree. An edit, a dropped pin and
 * a newly loaded unpinned file each refuse here, before any go or request.
 */
export function selfCheck(manifest, root, entry, { blobOf = workingBlob } = {}) {
  const g = manifest && manifest.guard;
  if (!isObj(g) || !Array.isArray(g.files) || !Array.isArray(g.entries)) throw new Refusal("the manifest pins no guard chain; refusing");
  if (!g.entries.includes(entry)) throw new Refusal(`the manifest's guard chain does not name ${entry} as an entry; refusing`);
  const pins = new Map(g.files.filter((f) => isObj(f) && typeof f.path === "string").map((f) => [f.path, f]));
  const read = (p) => { try { return readFileSync(join(root, p), "utf8"); } catch { return null; } };
  const { files, problems } = chainClosure(entry, read);
  for (const p of files) {
    const pin = pins.get(p);
    if (!pin) { problems.push(`${p} is loaded by ${entry}, but the manifest does not pin it`); continue; }
    let id = null;
    try { id = blobOf(p, root); } catch { /* reported below */ }
    if (id !== pin.blob) problems.push(`${p} is ${id ?? "unreadable"}, but the manifest pins ${pin.blob}`);
  }
  for (const [label, pin] of [["sender", manifest.sender], ["assembler", manifest.assembler]]) {
    if (!isObj(pin) || !pins.has(pin.path) || pins.get(pin.path).blob !== pin.blob) problems.push(`the manifest's ${label} pin is not its guard-chain pin`);
  }
  if (problems.length) throw new Refusal(`the pinned chain does not hold: ${problems.slice(0, 6).join("; ")}${problems.length > 6 ? `; and ${problems.length - 6} more` : ""}; refusing`);
}

// ── the process, the checkout and the clock ─────────────────────────────────

/** Node options and NODE_OPTIONS can load code from outside the chain (Q4). */
export function processProblems({ execArgv = [], env = {} } = {}) {
  const out = [];
  if (execArgv.length) out.push(`node was started with ${execArgv.length} option(s); run these tools as plain \`node <script>\``);
  if (typeof env.NODE_OPTIONS === "string" && env.NODE_OPTIONS.trim()) out.push("NODE_OPTIONS is set; clear it in this window");
  return out;
}

/** A program the guarded tools start by name would be found in these directories first (Windows' search order). */
export function plantedTools(dirs) {
  const out = [];
  for (const d of new Set(dirs)) for (const n of ["git", "powershell", "w32tm"]) for (const x of ["", ".com", ".exe"]) {
    if (existsSync(join(d, n + x))) out.push(`${join(d, n + x)} exists, and would run in place of the system program`);
  }
  return out;
}

/** The cheap checks every live command runs before it starts any program (Codex's ordering note on 78db6dc). */
export function preflight({ execArgv, env, dirs }) {
  const pre = [...processProblems({ execArgv, env }), ...plantedTools(dirs)];
  if (pre.length) throw new Refusal(`${pre.join("; ")}; refusing`);
}

/** HEAD and the tracked changes (staged, unstaged, deleted, unmerged). Untracked files are not listed (Q4). */
export function gitState(root) {
  const g = (...a) => execFileSync("git", a, { cwd: root, maxBuffer: 1 << 24 }).toString("utf8");
  return { head: g("rev-parse", "HEAD").trim(), dirty: g("status", "--porcelain=v1", "--untracked-files=no").split("\n").filter(Boolean) };
}

/** Refuse unless the checkout is at a full commit with no tracked change; returns HEAD. */
export function checkoutHead(git, root) {
  let s;
  try { s = git(root); } catch (e) { throw new Refusal(`git could not report the checkout (${String(e && e.message).split("\n")[0]}); refusing`); }
  if (!isObj(s) || !isCommit(s.head) || !Array.isArray(s.dirty)) throw new Refusal("git did not report a full HEAD commit; refusing");
  if (s.dirty.length) throw new Refusal(`the checkout has tracked changes (${s.dirty.slice(0, 3).map((l) => l.slice(3)).join(", ")}${s.dirty.length > 3 ? ", …" : ""}); refusing`);
  return s.head;
}

/** w32tm's offsets, in ms, from /stripchart /dataonly output; null when any sample line is unreadable. */
export function parseStripchart(text) {
  const out = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!/^[0-9]{1,2}:[0-9]{2}:[0-9]{2},/.test(line)) continue;
    const m = /^[0-9]{1,2}:[0-9]{2}:[0-9]{2}, ([+-])([0-9]{1,6})\.([0-9]{1,7})s$/.exec(line);
    if (!m) return null;
    out.push((m[1] === "-" ? -1 : 1) * (Number(m[2]) * 1000 + Number((m[3] + "000").slice(0, 3))));
  }
  return out;
}

/** Run w32tm for the clock check. The status is informational; the samples decide. */
export function measureClock(run = (args) => execFileSync(W32TM, args, { windowsHide: true, timeout: 60000, stdio: ["ignore", "pipe", "pipe"] }).toString("utf8")) {
  let status = null;
  try { status = run(["/query", "/status"]); } catch (e) { status = `unavailable: ${String(e && e.message).split("\n")[0]}`; }
  const stripchart = run(["/stripchart", `/computer:${CLOCK.reference}`, "/dataonly", `/samples:${CLOCK.samples}`]);
  return { status, stripchart };
}

/** The high-water record: { ms } when present and valid, else "missing" or "invalid". */
function readHwm(paths) {
  let h;
  try { h = readState(paths.hwm); } catch (e) { return e && e.code === "ENOENT" ? "missing" : "invalid"; }
  return shapeProblems(h, HWM_SPEC, "hwm.json").length || iso(h.ms) !== h.at ? "invalid" : h;
}

/**
 * Accept a measurement as the clock check, or refuse (an established, intact
 * store only). It records the check in the ledger and sets the high-water
 * mark to now: a check against the time server is the one thing that may
 * re-establish a missing or invalid high-water record, and the record keeps
 * what it found (hwmBefore). It repairs nothing about send history.
 */
export function recordClock({ paths, anchor, manifest, measurement, now }) {
  const offsets = parseStripchart(measurement && measurement.stripchart);
  if (!offsets || offsets.length !== CLOCK.samples) throw new Refusal(`w32tm did not give ${CLOCK.samples} readable samples against ${CLOCK.reference}; the clock cannot be established; refusing`);
  const maxAbs = Math.max(...offsets.map(Math.abs));
  if (maxAbs > CLOCK.toleranceMs) throw new Refusal(`this machine's clock is ${maxAbs} ms from ${CLOCK.reference}, beyond the ${CLOCK.toleranceMs} ms tolerance; resynchronize it, then check again; refusing`);
  const pick = (re) => { const m = re.exec(String(measurement.status || "")); return m ? m[1].trim().slice(0, 120) : "not reported"; };
  return withLock(paths, () => {
    const chk = requireStore({ paths, anchor, manifest });
    const h = readHwm(paths);
    const rec = {
      schema: "stage0-clock/1", at: iso(now), reference: CLOCK.reference, offsetsMs: offsets, maxAbsOffsetMs: maxAbs, toleranceMs: CLOCK.toleranceMs,
      source: pick(/^Source:\s*(.+)$/m), lastSync: pick(/^Last Successful Sync Time:\s*(.+)$/m), leap: pick(/^Leap Indicator:\s*(.+)$/m),
      hwmBefore: typeof h === "string" ? h : h.at,
    };
    const file = `${rec.at.replace(/[:.]/g, "-")}_${newId().slice(0, 8)}.json`;
    const text = JSON.stringify(rec, null, 2) + "\n";
    logged(paths, chk, "clock", { file, sha256: sha256(Buffer.from(text, "utf8")) }, [fileStep(join(paths.clockLog, file), text)], now);
    try { replaceFile(paths.hwm, { ms: now, at: iso(now) }); } catch (e) { throw new Refusal(`the clock check is recorded, but the high-water record could not be written (${e && e.code}); refusing`); }
    return rec;
  }, now);
}

/**
 * Refuse unless the latest recorded clock check is fresh and not later than
 * now, and the high-water record exists, is valid, and is not more than
 * backstepMs ahead of now. A missing or invalid high-water record refuses
 * until a new clock check; so does failing to advance it. `chk` is a passing
 * storeCheck.
 */
export function checkClock(paths, now, chk) {
  if (!Number.isFinite(now)) throw new Refusal("no current time; refusing");
  const last = chk.index.clocks[chk.index.clocks.length - 1];
  if (!last) throw new Refusal("no clock check is recorded: run `node scripts/manual/stage0-go.mjs clock` first; refusing");
  const rec = readState(join(paths.clockLog, last.file));
  const at = utcMs(rec.at);
  if (now < at) throw new Refusal(`the clock check (${rec.at}) is later than now: the clock went back; run a new clock check; refusing`);
  if (now - at >= CLOCK.freshMs) throw new Refusal(`the clock check (${rec.at}) is older than ${CLOCK.freshMs / 60000} min; run a new one; refusing`);
  const h = readHwm(paths);
  if (typeof h === "string") throw new Refusal(`the clock high-water record is ${h}: run a new clock check (stage0-go.mjs clock); refusing`);
  if (now < h.ms - CLOCK.backstepMs) throw new Refusal(`the clock is ${h.ms - now} ms behind a time a guard tool already saw (${h.at}): it went back; run a new clock check; refusing`);
  if (now > h.ms) {
    try { replaceFile(paths.hwm, { ms: now, at: iso(now) }); } catch (e) { throw new Refusal(`the clock high-water record could not be advanced (${e && e.code}); refusing`); }
  }
  return rec;
}

// ── the window's shell (SG-3) ───────────────────────────────────────────────

/**
 * The process `pid` as Windows reports it: pid, image name (lower case) and
 * creation time; null when there is no such process. Only Windows: the
 * marker's binding was rehearsed on PowerShell windows there.
 */
export function shellIdentity(pid) {
  if (process.platform !== "win32") throw new Refusal("the guarded tools bind a PowerShell window, and run only on Windows; refusing");
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Refusal("no parent process id; refusing");
  const script = `$ProgressPreference = "SilentlyContinue"; $p = Get-CimInstance Win32_Process -Filter "ProcessId=${pid}"; if ($p) { [pscustomobject]@{ pid = [int]$p.ProcessId; image = ([string]$p.Name).ToLowerInvariant(); created = $p.CreationDate.ToUniversalTime().ToString("o") } | ConvertTo-Json -Compress }`;
  let out;
  try {
    out = execFileSync(POWERSHELL, ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], { windowsHide: true, timeout: 30000, maxBuffer: 1 << 16, stdio: ["ignore", "pipe", "pipe"] }).toString("utf8").trim();
  } catch (e) { throw new Refusal(`Windows did not report process ${pid} (${String(e && e.message).split("\n")[0]}); refusing`); }
  if (!out) return null;
  let v;
  try { v = C.strictJson(out, { maxChars: 4096 }); } catch { throw new Refusal(`the report on process ${pid} is not readable; refusing`); }
  if (!sameKeys(v, ["pid", "image", "created"]) || v.pid !== pid || typeof v.image !== "string" || createdMs(v.created) === null) throw new Refusal(`the report on process ${pid} is not the expected shape; refusing`);
  return { pid: v.pid, image: v.image, created: v.created };
}

const sameShell = (a, b) => isObj(a) && isObj(b) && a.pid === b.pid && a.image === b.image && a.created === b.created;

/** The shell that started this node process, checked: a PowerShell, created before this process. */
export function invokingShell({ identity, ppid, selfStartMs }) {
  const s = identity(ppid);
  if (!s) throw new Refusal(`the process that started node (${ppid}) is gone; refusing`);
  if (!SHELLS.includes(s.image)) throw new Refusal(`node was started by ${s.image}, not by a PowerShell window; run the command directly in the window; refusing`);
  const c = createdMs(s.created);
  if (c === null || !(c <= selfStartMs)) throw new Refusal(`process ${s.pid} was created after this node process started, so it is not the window that started it; refusing`);
  return s;
}

// ── sessions and tokens ─────────────────────────────────────────────────────

const SESSION_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TOKEN_SHAPE = /^sbp_\S+$/;
export const sessionIdOf = (nonce) => sha256(Buffer.from(nonce, "utf8"));
export const tokenTagOf = (nonce, token) => createHmac("sha256", nonce).update(token, "utf8").digest("hex");

function sessionOf(env) {
  const nonce = env[SESSION_ENV];
  if (typeof nonce !== "string" || !SESSION_SHAPE.test(nonce)) throw new Refusal(`${SESSION_ENV} is not set to a fresh [guid]::NewGuid() value in this window; refusing`);
  return nonce;
}

// ── workflows: the exact-step gates (SG-1) ──────────────────────────────────

/**
 * The workflows a go can be issued for, each with its reviewed phases and its
 * gate. Every phase declares `ceilings` (ceilingReserve), except the item 2
 * capture phases in LEGACY_CUTOFF_PHASES. Two staging workflows are
 * declared: item 2's capture and item 3's read-token experiment
 * (stage0-item3.mjs). No production phase is: it needs item 4(c)'s reviewed
 * ceilings.
 */
export const WORKFLOWS = Object.freeze({
  capture: Object.freeze({
    target: "staging",
    phases: Object.freeze(Object.fromEntries(Object.entries(K.PHASES).map(([k, p]) => [k, Object.freeze({ steps: Object.freeze([...p.steps]), requires: p.requires || null })]))),
    stepText: (id) => K.STEPS[id].text,
    check: (id, text, ctx) => K.checkStep(id, text, ctx),
    next: (phase, results) => K.nextStep(phase, results),
  }),
  item3: Object.freeze({
    target: "staging",
    phases: Object.freeze(Object.fromEntries(Object.entries(I3.PHASES).map(([k, p]) => [k, Object.freeze({ steps: Object.freeze([...p.steps]), requires: p.requires || null, ceilings: Object.freeze({ ...p.ceilings }) })]))),
    stepText: (id) => I3.STEPS[id].text,
    check: (id, text, ctx) => I3.checkStep(id, text, ctx),
    next: (phase, results) => I3.nextStep(phase, results),
  }),
});

// ── per-step ceilings ───────────────────────────────────────────────────────

/**
 * The reviewed item 2 capture phases that keep the 60 s admission cutoff for
 * every step, and their old go-line form (Codex, review of 30c0eba, Q-P2).
 * The exception names the capture workflow object itself, not a name: any
 * other workflow, or a new capture phase, declares its ceilings.
 */
export const LEGACY_CUTOFF_PHASES = Object.freeze(["B", "A", "T", "U"]);
export const isLegacyPhase = (wf, phaseName) => wf === WORKFLOWS.capture && LEGACY_CUTOFF_PHASES.includes(phaseName);
/** The longest reserve a declaration may give one step. */
export const MAX_RESERVE_MS = 24 * 60 * 60 * 1000;

/**
 * What a phase's declaration reserves before its deadline for each step, in
 * ms: `ceilings: { <step>: ms }`, the time the whole remaining path from that
 * step needs. A later step may reserve MORE than an earlier one (its
 * recovery can take longer), so its ceiling may come earlier: each ceiling
 * is its own admission limit, and the steps still run in their declared
 * order (Codex, review of 30c0eba, P-R1). A phase that declares none refuses,
 * except a legacy capture phase (isLegacyPhase), which gets MARGIN_MS for
 * every step. A declaration refuses unless it names exactly the phase's
 * steps, each a whole number of minutes from MARGIN_MS to MAX_RESERVE_MS.
 */
export function ceilingReserve(wf, phaseName) {
  const p = isObj(wf) && isObj(wf.phases) && own(wf.phases, phaseName) ? wf.phases[phaseName] : null;
  if (!p || !Array.isArray(p.steps)) throw new Refusal(`no declared phase ${JSON.stringify(String(phaseName).slice(0, 20))}; refusing`);
  const decl = own(p, "ceilings") && p.ceilings !== undefined ? p.ceilings : null;
  if (decl === null) {
    if (isLegacyPhase(wf, phaseName)) return Object.fromEntries(p.steps.map((s) => [s, MARGIN_MS]));
    throw new Refusal(`phase ${phaseName} declares no per-step ceilings; only the reviewed capture phases ${LEGACY_CUTOFF_PHASES.join(", ")} keep the 60 s cutoff; refusing`);
  }
  if (!sameKeys(decl, p.steps)) throw new Refusal(`phase ${phaseName}'s ceilings do not name exactly its steps; refusing`);
  for (const s of p.steps) {
    const v = decl[s];
    if (!Number.isSafeInteger(v) || v < MARGIN_MS || v > MAX_RESERVE_MS || v % 60000 !== 0) throw new Refusal(`phase ${phaseName}'s ceiling for ${s} is not a whole number of minutes from ${MARGIN_MS / 1000} s to ${MAX_RESERVE_MS / 3600000} h; refusing`);
  }
  return Object.fromEntries(p.steps.map((s) => [s, decl[s]]));
}

/** Each step's ceiling, its latest start, in ms: the phase deadline less its reserve. */
export function stepCeilings(wf, phaseName, deadlineMs) {
  const reserve = ceilingReserve(wf, phaseName);
  return Object.fromEntries(Object.entries(reserve).map(([s, v]) => [s, deadlineMs - v]));
}

/**
 * A recorded phase's ceiling for one step, recomputed from the declaration
 * and the phase's deadline. Refuses unless the phase recorded exactly the
 * declared ceilings, every step's: a stale or altered record is never used.
 */
export function ceilingOf(wf, phase, step) {
  const dl = utcMs(phase.deadline);
  if (dl === null || !isObj(phase.ceilings)) throw new Refusal(`phase ${phase.phaseId} has no readable deadline or ceilings; refusing`);
  const want = stepCeilings(wf, phase.phase, dl);
  if (!sameKeys(phase.ceilings, Object.keys(want))) throw new Refusal(`phase ${phase.phaseId}'s ceilings are not one per declared step; refusing`);
  for (const [s, ms] of Object.entries(want)) if (phase.ceilings[s] !== iso(ms)) throw new Refusal(`phase ${phase.phaseId} records ${s}'s ceiling as ${phase.ceilings[s]}; its declaration gives ${iso(ms)}: a stale or altered ceiling; refusing`);
  if (!own(want, step)) throw new Refusal(`phase ${phase.phase} has no step ${isName(step) ? step : "of that name"}; refusing`);
  return want[step];
}

// ── approvals and phases (I6-R2) ────────────────────────────────────────────

const minuteUtc = (ms) => iso(ms).slice(0, 16).replace("T", " ") + " UTC";
const APPROVAL_IN_TEXT = /\bapproval ([0-9a-f]{16})\b/g;
const EASTERN = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", timeZoneName: "short" });

/**
 * A whole-minute UTC time as Eastern wall time, "HH:MM EDT YYYY-MM-DD", for
 * the reader only. The offset is checked against the abbreviation (EDT is
 * UTC-4, EST UTC-5); any other result refuses.
 */
export function easternOf(ms) {
  const p = Object.fromEntries(EASTERN.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  const wall = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute));
  const hours = (wall - ms) / 3600000;
  if (!((p.timeZoneName === "EDT" && hours === -4) || (p.timeZoneName === "EST" && hours === -5))) throw new Refusal(`the Eastern time of ${iso(ms)} could not be checked (${p.timeZoneName}, ${hours} h); refusing`);
  return `${p.hour}:${p.minute} ${p.timeZoneName} ${p.year}-${p.month}-${p.day}`;
}

/**
 * Ryan's go line for a phase that declares ceilings, in its one defined form
 * (Codex, review of 30c0eba, Q-P1): the phase, its workflow, the approval id,
 * the head, the target and ref; every step in order with its absolute latest
 * start; and the phase deadline, apart from the step limits. Each time is UTC
 * to the minute, with its Eastern time beside it. Registration requires the
 * message to be exactly this text, so a missing, extra, duplicated, swapped
 * or wrong time, or any other words, refuses.
 */
export function goLine({ workflow, phase, approvalId, head, target, ref, steps, ceilings, deadline }) {
  const at = (ms) => `${minuteUtc(ms)} (${easternOf(ms)})`;
  return `GO phase ${phase} (${workflow}), approval ${approvalId}: head ${head.slice(0, 7)}, ${target} ${ref}. Latest starts: ${steps.map((s) => `${s} ${at(ceilings[s])}`).join("; ")}. Phase deadline ${at(deadline)}.`;
}

/**
 * Draft a fresh approval id for one phase (Claude, before Ryan approves its
 * go line). One id registers at most one phase; a restart needs a newly
 * drafted id and a newly approved line.
 *
 * A legacy capture phase takes no deadline here: its line is written by hand
 * and must carry `approval <id>`. Every other phase is drafted WITH its
 * deadline (a whole minute), which the draft records, and the draft returns
 * the exact line (goLine) with every step's latest start, to be shown to
 * Ryan before he approves it. It refuses when a step's ceiling has already
 * passed.
 */
export function draftApproval({ paths, anchor, manifest, workflows = WORKFLOWS, workflow, phase, head, deadline = null, now }) {
  const wf = isObj(workflows) && own(workflows, workflow) ? workflows[workflow] : null;
  if (!wf || !own(wf.phases, phase)) throw new Refusal(`no reviewed workflow phase ${JSON.stringify(`${String(workflow).slice(0, 20)} ${String(phase).slice(0, 20)}`)} is declared; refusing`);
  ceilingReserve(wf, phase);
  const legacy = isLegacyPhase(wf, phase);
  const ref = manifest.send.targets[wf.target];
  return withLock(paths, () => {
    const chk = requireStore({ paths, anchor, manifest });
    checkClock(paths, now, chk);
    const dl = legacy ? null : utcMs(deadline);
    if (legacy && deadline !== null) throw new Refusal(`capture phase ${phase} keeps its legacy go line; it is drafted without a deadline; refusing`);
    if (!legacy && (dl === null || dl % 60000 !== 0)) throw new Refusal("this phase is drafted with its deadline, a whole-minute UTC time, YYYY-MM-DDTHH:MM:00.000Z (--deadline); refusing");
    let line = null;
    if (!legacy) {
      const ceilings = stepCeilings(wf, phase, dl);
      const late = wf.phases[phase].steps.filter((s) => !(now < ceilings[s]));
      if (late.length) throw new Refusal(`step ${late[0]}'s ceiling ${iso(ceilings[late[0]])} has already passed for that deadline; refusing`);
      line = (approvalId) => goLine({ workflow, phase, approvalId, head, target: wf.target, ref, steps: wf.phases[phase].steps, ceilings, deadline: dl });
      line("0".repeat(16)); // rendered once before anything is recorded: a time that cannot be shown refuses here
    }
    let approvalId;
    do { approvalId = randomBytes(8).toString("hex"); } while (chk.index.drafts.has(approvalId));
    logged(paths, chk, "draft", { approvalId, workflow, phase, ref, head, deadline: legacy ? null : iso(dl) }, [], now);
    return { approvalId, workflow, phase, ref, head, deadline: legacy ? null : iso(dl), line: line ? line(approvalId) : null };
  }, now);
}

/**
 * Register Ryan's go for one phase from his message's exact text (I6-R2).
 * The text must carry exactly one `approval <id>`, drafted in this store for
 * this workflow, phase, head and ref. If that approval is already registered,
 * the SAME phase is returned, with its progress and ceilings, provided the
 * text and the deadline are the same; another text or deadline with a used
 * id refuses. A new registration also refuses unless:
 *   - for a phase that declares ceilings: the deadline is the drafted one,
 *     and the text is EXACTLY goLine() for that draft, so every step's
 *     latest start in it equals the map recomputed here (Q-P1);
 *   - for a legacy capture phase: the text names the phase ("GO phase
 *     <P> "), the head (7 characters), the ref, every step and the deadline
 *     as "YYYY-MM-DD HH:MM UTC";
 *   - the go is recorded within PHASE_LIMITS.recordWithinMs of its arrival,
 *     with at least PHASE_LIMITS.minRemainingMs left and no step's ceiling
 *     passed; and a phase that needs a reviewed decision names one.
 * A token-shaped value in the text refuses. Neither the text nor the arrival
 * time is the approval's identity. The phase records every step's ceiling
 * (stepCeilings), computed from the declaration and the deadline.
 */
export function recordPhase({ paths, anchor, manifest, workflows = WORKFLOWS, workflow, phase, goText, arrivedAt, deadline, reviewed = null, head, checkout, now }) {
  const wf = isObj(workflows) && own(workflows, workflow) ? workflows[workflow] : null;
  if (!wf) throw new Refusal(`no reviewed workflow ${JSON.stringify(String(workflow).slice(0, 20))} is declared for the guarded sender; refusing`);
  const p = own(wf.phases, phase) ? wf.phases[phase] : null;
  if (!p) throw new Refusal(`workflow ${workflow} declares no phase ${JSON.stringify(String(phase).slice(0, 20))}; refusing`);
  if (typeof goText !== "string" || !goText.length || goText.length > 4096) throw new Refusal("the go text is missing or too long; refusing");
  if (/sbp_|sb_secret_/.test(goText)) throw new Refusal("the go text holds a token-shaped value: STOP, delete that token; refusing");
  const ids = [...goText.matchAll(APPROVAL_IN_TEXT)].map((m) => m[1]);
  if (ids.length !== 1) throw new Refusal(`the go text must carry exactly one "approval <16 hex>" (it carries ${ids.length}); refusing`);
  const approvalId = ids[0];
  const ref = manifest.send.targets[wf.target];
  return withLock(paths, () => {
    const chk = requireStore({ paths, anchor, manifest });
    if (chk.index.approvals.has(approvalId)) {
      const existing = loadPhase(paths, chk.index.approvals.get(approvalId));
      if (existing.phase.goText.sha256 !== sha256(Buffer.from(goText, "utf8"))) throw new Refusal(`approval ${approvalId} is already registered (phase ${existing.phase.phaseId}) with another text: a used approval id with new words is not a new approval; refusing`);
      if (deadline !== existing.phase.deadline) throw new Refusal(`approval ${approvalId} is already registered (phase ${existing.phase.phaseId}) with the deadline ${existing.phase.deadline}: re-registration never changes a deadline or a ceiling; refusing`);
      return { phase: existing.phase, existing: true };
    }
    checkClock(paths, now, chk);
    const draft = chk.index.drafts.get(approvalId);
    if (!draft) throw new Refusal(`approval ${approvalId} was never drafted in this store; refusing`);
    if (draft.workflow !== workflow || draft.phase !== phase || draft.ref !== ref || draft.head !== head) throw new Refusal(`approval ${approvalId} was drafted for ${draft.workflow} ${draft.phase} at ${draft.head.slice(0, 7)} on ${draft.ref}; refusing`);
    if (!isRef(ref)) throw new Refusal(`the manifest has no ref for ${wf.target}; refusing`);
    const arrived = utcMs(arrivedAt);
    const dl = utcMs(deadline);
    if (arrived === null || dl === null) throw new Refusal("the arrival and the deadline must be UTC times, YYYY-MM-DDTHH:MM:SS.sssZ; refusing");
    if (dl % 60000 !== 0) throw new Refusal("the deadline must be a whole minute, as the go states it; refusing");
    if (arrived < utcMs(draft.at)) throw new Refusal("the go arrived before its approval id was drafted; refusing");
    if (arrived > now) throw new Refusal("the go's arrival is later than now; refusing");
    if (now - arrived > PHASE_LIMITS.recordWithinMs) throw new Refusal(`the go arrived more than ${PHASE_LIMITS.recordWithinMs / 60000} min ago; a late record needs a new go; refusing`);
    if (dl - now < PHASE_LIMITS.minRemainingMs) throw new Refusal(`less than ${PHASE_LIMITS.minRemainingMs / 60000} min remain before the deadline; refusing`);
    const ceilings = stepCeilings(wf, phase, dl);
    const late = p.steps.filter((s) => !(now < ceilings[s]));
    if (late.length) throw new Refusal(`step ${late[0]}'s ceiling ${iso(ceilings[late[0]])} has already passed: the phase cannot run; refusing`);
    if (isLegacyPhase(wf, phase)) {
      const missing = [`GO phase ${phase} `, head.slice(0, 7), ref, minuteUtc(dl), ...p.steps].filter((s) => !goText.includes(s));
      if (missing.length) throw new Refusal(`the go text does not name ${missing.map((s) => JSON.stringify(s)).join(", ")}; refusing`);
    } else {
      if (draft.deadline !== deadline) throw new Refusal(`approval ${approvalId} was drafted with the deadline ${draft.deadline}; this registration gives ${deadline}; refusing`);
      const want = goLine({ workflow, phase, approvalId, head, target: wf.target, ref, steps: p.steps, ceilings, deadline: dl });
      if (goText !== want) throw new Refusal(`the go text is not exactly the drafted line, so its step times, steps or deadline are not the ones this phase would record; it must read: ${want}; refusing`);
    }
    if (p.requires && reviewed === null) throw new Refusal(`phase ${phase} needs ${p.requires}; name it (--reviewed); refusing`);
    const rec = {
      schema: "stage0-phase/3", phaseId: newId(), approvalId, workflow, phase, steps: [...p.steps], target: wf.target, ref, head, checkout,
      arrivedAt, recordedAt: iso(now), deadline, ceilings: Object.fromEntries(p.steps.map((s) => [s, iso(ceilings[s])])), goText: { sha256: sha256(Buffer.from(goText, "utf8")), bytes: Buffer.byteLength(goText) }, reviewed,
    };
    const bad = shapeProblems(rec, PHASE_SPEC, "the phase");
    if (bad.length) throw new Refusal(`${bad.join("; ")}; refusing`);
    const recText = JSON.stringify(rec, null, 2) + "\n";
    const apText = JSON.stringify({ schema: "stage0-approval/1", approvalId, phaseId: rec.phaseId }, null, 2) + "\n";
    logged(paths, chk, "phase", { phaseId: rec.phaseId, approvalId, ref, sha256: sha256(Buffer.from(recText, "utf8")), goTextSha256: rec.goText.sha256, approvalSha256: sha256(Buffer.from(apText, "utf8")) }, [
      fileStep(join(paths.phases, `${rec.phaseId}.go.txt`), goText),
      fileStep(join(paths.phases, `${rec.phaseId}.json`), recText),
      fileStep(join(paths.approvals, `${approvalId}.json`), apText),
    ], now);
    return { phase: rec, existing: false };
  }, now);
}

/** A phase record and its sha256, checked against its stored go text; throws a Refusal on any problem. */
export function loadPhase(paths, phaseId) {
  if (!isId(phaseId)) throw new Refusal("not a phase id; refusing");
  let raw, rec, text;
  try { raw = readFileSync(join(paths.phases, `${phaseId}.json`)); rec = C.strictJson(raw.toString("utf8")); text = readFileSync(join(paths.phases, `${phaseId}.go.txt`)); } catch { throw new Refusal(`no phase ${phaseId} is recorded; refusing`); }
  const bad = shapeProblems(rec, PHASE_SPEC, "the phase");
  if (bad.length || rec.phaseId !== phaseId) throw new Refusal(`phase ${phaseId} is malformed: ${bad.join("; ") || "its id"}; refusing`);
  if (sha256(text) !== rec.goText.sha256 || text.length !== rec.goText.bytes) throw new Refusal(`phase ${phaseId}'s go text is not the one recorded; refusing`);
  const ar = utcMs(rec.arrivedAt), rc = utcMs(rec.recordedAt), dl = utcMs(rec.deadline);
  if (!(ar <= rc && rc < dl)) throw new Refusal(`phase ${phaseId}'s times are out of order; refusing`);
  const cs = rec.steps.map((s) => (own(rec.ceilings, s) ? utcMs(rec.ceilings[s]) : null));
  if (!sameKeys(rec.ceilings, rec.steps) || cs.some((c) => !(rc < c && c <= dl - MARGIN_MS))) throw new Refusal(`phase ${phaseId}'s ceilings are not one per step, each after its record and at least ${MARGIN_MS / 1000} s before its deadline; refusing`);
  return { phase: rec, sha: sha256(raw) };
}

// ── markers ─────────────────────────────────────────────────────────────────

function readMarkers(paths) {
  const out = [];
  let names;
  try { names = readdirSync(paths.markers).filter((f) => f.endsWith(".json")); } catch { throw new Refusal("the markers directory cannot be listed; refusing"); }
  for (const f of names) {
    let m = null;
    try { m = readState(join(paths.markers, f)); } catch { /* malformed: below */ }
    const bad = shapeProblems(m, MARKER_SPEC, `marker ${f}`);
    out.push({ file: join(paths.markers, f), marker: bad.length ? null : m, problems: bad.length ? bad : (f === `${m.markerId}.json` ? [] : [`marker ${f} is not named by its id`]) });
  }
  return out;
}

/**
 * Open this window's marker for one phase (Ryan, after loading the token and
 * setting STAGE0_SESSION). Refuses on a damaged store, a malformed or foreign
 * phase, a role the phase never sends, a missing session value or token, a
 * shell that is not a PowerShell window, a second marker for this shell or
 * session, and a live window of the same role in the phase. A marker whose
 * window is gone is closed (moved to markers/closed/, recorded).
 */
export function openMarker({ paths, anchor, manifest, phaseId, role, env, head, checkout, now, identity, ppid, selfStartMs, workflows = WORKFLOWS }) {
  if (!isRole(role)) throw new Refusal("the role is R, W or C; refusing");
  const nonce = sessionOf(env);
  const token = env[TOKEN_ENV];
  if (typeof token !== "string" || !TOKEN_SHAPE.test(token)) throw new Refusal(`${TOKEN_ENV} is not a personal access token in this window; load it first; refusing`);
  const shell = invokingShell({ identity, ppid, selfStartMs });
  return withLock(paths, () => {
    const chk = requireStore({ paths, anchor, manifest });
    checkClock(paths, now, chk);
    const { phase, sha } = loadPhase(paths, phaseId);
    if (phase.head !== head || phase.checkout !== checkout) throw new Refusal(`phase ${phaseId} was recorded for ${phase.head.slice(0, 7)} in ${phase.checkout}; this is ${head.slice(0, 7)} in ${checkout}; refusing`);
    if (!(utcMs(phase.recordedAt) <= now)) throw new Refusal("the phase is recorded later than now: the clock went back; refusing");
    if (now >= utcMs(phase.deadline)) throw new Refusal(`phase ${phase.phase}'s deadline ${phase.deadline} has passed; refusing`);
    const wf = own(workflows, phase.workflow) ? workflows[phase.workflow] : null;
    const texts = phase.steps.map((s) => (wf ? wf.stepText(s) : null));
    if (!texts.some((t) => t && roleOf(manifest, t) === role)) throw new Refusal(`phase ${phase.phase} sends nothing from ${an(role)} window; refusing`);
    const sessionId = sessionIdOf(nonce);
    const removed = [];
    for (const e of readMarkers(paths)) {
      const m = e.marker;
      if (!m) throw new Refusal(`a malformed marker is present (${e.problems[0]}); refusing`);
      if (m.sessionId === sessionId || sameShell(m.shell, shell)) throw new Refusal(`this window already has marker ${m.markerId} (role ${m.role}); close it first; refusing`);
      if (m.phaseId === phaseId && m.role === role) {
        if (now < utcMs(m.until) && sameShell(identity(m.shell.pid), m.shell)) throw new Refusal(`a live ${role} window for this phase already exists (marker ${m.markerId}); refusing`);
        logged(paths, chk, "marker-close", { markerId: m.markerId, reason: "gone" }, [moveStep(e.file, join(paths.closed, `${m.markerId}.json`))], now);
        removed.push(m.markerId);
      }
    }
    const marker = {
      schema: "stage0-marker/1", markerId: newId(), role, phaseId, phaseSha: sha, target: phase.target, ref: phase.ref, head, checkout,
      createdAt: iso(now), until: phase.deadline, sessionId, tokenTag: tokenTagOf(nonce, token), shell,
    };
    const text = JSON.stringify(marker, null, 2) + "\n";
    logged(paths, chk, "marker-open", { markerId: marker.markerId, phaseId, ref: phase.ref, sha256: sha256(Buffer.from(text, "utf8")) }, [fileStep(join(paths.markers, `${marker.markerId}.json`), text)], now);
    return { marker, removed };
  }, now);
}

/** The well-formed markers of this window's session value (none when it is unset). */
export function sessionMarkers(paths, env) {
  const nonce = env[SESSION_ENV];
  if (typeof nonce !== "string" || !SESSION_SHAPE.test(nonce)) return [];
  const sid = sessionIdOf(nonce);
  return readMarkers(paths).filter((e) => e.marker && e.marker.sessionId === sid).map((e) => e.marker);
}

/**
 * Close this session's markers and void their unused gos: each is moved, as
 * evidence, and recorded. It checks no pin, head, clock or store integrity,
 * so it can run when those fail. When the ledger cannot be read, or the lock
 * cannot be taken, it changes nothing and reports why: the marker then stays
 * where it is, and binds only this window's process, which is about to exit.
 */
export function closeSession({ paths, env, now }) {
  const nonce = env[SESSION_ENV];
  const out = { markers: [], gos: [], problems: [] };
  if (typeof nonce !== "string" || !SESSION_SHAPE.test(nonce)) return out;
  const sid = sessionIdOf(nonce);
  try {
    withLock(paths, () => {
      const L = readLedger(paths);
      if (L.problems.length) throw new Refusal(`the ledger is damaged (${L.problems[0]})`);
      const chk = { seq: L.seq, tail: L.tail };
      for (const e of readMarkers(paths)) {
        if (!e.marker || e.marker.sessionId !== sid) continue;
        const mid = e.marker.markerId;
        for (const f of readdirSync(paths.gos).filter((n) => n.endsWith(".json"))) {
          let g = null;
          try { g = readState(join(paths.gos, f)); } catch { continue; }
          if (!isObj(g) || g.markerId !== mid || f !== `${g.goId}.json`) continue;
          logged(paths, chk, "go-void", { goId: g.goId, reason: "close" }, [moveStep(join(paths.gos, f), join(paths.voided, f))], now);
          out.gos.push(g.goId);
        }
        logged(paths, chk, "marker-close", { markerId: mid, reason: "close" }, [moveStep(e.file, join(paths.closed, `${mid}.json`))], now);
        out.markers.push(mid);
      }
    }, now, 2000);
  } catch (e) { out.problems.push(e.message); }
  return out;
}

// ── the journal (SG-2) ──────────────────────────────────────────────────────

/** Every attempt in the project's journal, by claim order, each with its problems (a malformed file is a problem, never skipped). */
export function readJournal(paths, ref) {
  const dir = paths.journal(ref);
  let names;
  try { names = readdirSync(dir); } catch (e) { throw new Refusal(`the ${ref} journal cannot be listed (${e && e.code}): the store is damaged; refusing`); }
  const by = new Map();
  const get = (id) => { if (!by.has(id)) by.set(id, { attemptId: id, claim: null, outcome: null, disposition: null, problems: [] }); return by.get(id); };
  for (const n of names) {
    const m = /^([0-9a-f]{32})\.(claim|outcome|disposition)\.json$/.exec(n);
    if (!m) { get(`unknown:${n}`).problems.push(`an unknown journal file ${n}`); continue; }
    const e = get(m[1]);
    let v = null;
    try { v = readState(join(dir, n)); } catch (err) { e.problems.push(`${n} is not readable JSON (${err.message})`); continue; }
    const spec = m[2] === "claim" ? CLAIM_SPEC : m[2] === "disposition" ? DISPOSITION_SPEC : OUTCOME_SPEC[isObj(v) ? v.state : ""];
    const bad = spec ? shapeProblems(v, spec, n) : [`${n} has an unknown state`];
    if (bad.length || v.attemptId !== m[1]) { e.problems.push(...(bad.length ? bad : [`${n} names another attempt`])); continue; }
    e[m[2]] = v;
  }
  const all = [...by.values()];
  for (const e of all) {
    if (!e.claim && !e.problems.length) e.problems.push(`attempt ${e.attemptId} has no claim`);
    if (e.claim && e.claim.ref !== ref) e.problems.push(`attempt ${e.attemptId}'s claim is for another ref`);
  }
  const seqs = all.filter((e) => e.claim).map((e) => e.claim.seq);
  if (new Set(seqs).size !== seqs.length) for (const e of all) e.problems.push("two claims share a sequence number");
  return all.sort((a, b) => (a.claim ? a.claim.seq : 0) - (b.claim ? b.claim.seq : 0));
}

const RECEIPT_READER = (file) => { try { return readFileSync(file); } catch { return null; } };

/**
 * The receipt of a DISPATCHED attempt, checked against its claim: the file
 * exists with the journal's sha256, it is one strict JSON object, and its
 * guard block is exactly the claim's binding. Returns { text, rec } or { why }.
 */
export function boundReceipt(entry, readReceipt = RECEIPT_READER) {
  const o = entry.outcome;
  const buf = readReceipt(o.receipt.file);
  if (!buf) return { why: "its receipt is missing or unreadable" };
  if (sha256(buf) !== o.receipt.sha256 || buf.length !== o.receipt.bytes) return { why: "its receipt is not the file the journal recorded" };
  const text = buf.toString("utf8");
  let rec;
  try { rec = C.strictJson(text); } catch { return { why: "its receipt is not one strict JSON document" }; }
  if (!isObj(rec) || !own(rec, "guard")) return { why: "its receipt has no guard block" };
  const bad = shapeProblems(rec.guard, RECEIPT_GUARD_SPEC, "the guard block");
  if (bad.length) return { why: bad.join("; ") };
  const c = entry.claim;
  const want = { attemptId: c.attemptId, goId: c.goId, phaseId: c.phaseId, step: c.step, markerId: c.markerId, role: c.role, head: c.head, issuedAt: c.issuedAt, deadline: c.deadline };
  for (const k of Object.keys(want)) if (rec.guard[k] !== want[k]) return { why: `its guard block's ${k} is not the claim's` };
  if (rec.text !== c.text || rec.ref !== c.ref || rec.target !== c.target) return { why: "its text, target or ref is not the claim's" };
  if (rec.requestMd5 !== c.request.md5 || rec.requestBytes !== c.request.bytes || rec.readOnly !== c.request.readOnly || rec.endpoint !== c.request.endpoint) return { why: "its request is not the claim's" };
  return { text, rec };
}

/**
 * What holds the project: every attempt with a problem in its files (a
 * disposition does not excuse one: I6-R1), and every attempt without a
 * disposition that is PENDING (a claim and no outcome: in flight, or
 * crashed), or HOLD (a DISPATCHED receipt that is missing, altered or not
 * bound to its claim; or a writing send, as the classifier counts writing,
 * that rule 3′ classifies R1 or R4). NOT_SENT holds nothing. Callers run it
 * only on a store that passed storeCheck.
 */
export function holdsOf(entries, { readReceipt = RECEIPT_READER, ctxAt }) {
  const out = [];
  for (const e of entries) {
    const hold = (why) => out.push({ attemptId: e.attemptId, kind: "HOLD", why });
    if (e.problems.length) { hold(e.problems.join("; ")); continue; }
    if (e.disposition) continue;
    if (!e.outcome) { out.push({ attemptId: e.attemptId, kind: "PENDING", why: `${e.claim.step} (${e.claim.text}) was claimed at ${e.claim.claimedAt} and has no recorded outcome` }); continue; }
    if (e.outcome.state === "NOT_SENT") continue;
    const b = boundReceipt(e, readReceipt);
    if (b.why) { hold(`${e.claim.step}: ${b.why}`); continue; }
    let c;
    try { c = C.classifyText(b.text, ctxAt(e.claim.head)); } catch (err) { hold(`${e.claim.step}: it cannot be classified at ${e.claim.head.slice(0, 7)} (${err.message})`); continue; }
    if (c.writing !== false && (c.class === "R1" || c.class === "R4")) hold(`${e.claim.step} (${e.claim.text}) is a writing send that rule 3′ classifies ${c.class} UNRESOLVED`);
  }
  return out;
}

/**
 * The exact-step gate of a recorded phase, from the journal (SG-1, SG-4).
 * Each attempt of the phase, in claim order, must have a bound receipt
 * (boundReceipt), started after its claim and finished before now, whose
 * role is its text's policy role; NOT_SENT attempts are skipped. The
 * workflow's own check and next-step rule decide. A receipt without a guard
 * block, a pending attempt or an altered file stops the phase. The capture
 * tool's --progress, which takes issue times by hand, is a historical review
 * path and issues nothing.
 */
export function guardedProgress({ phase, entries, workflows = WORKFLOWS, ctxAt, readReceipt = RECEIPT_READER, now }) {
  const results = [];
  const stop = (reason) => ({ stop: true, next: null, complete: false, reason, results });
  const wf = own(workflows, phase.workflow) ? workflows[phase.workflow] : null;
  const p = wf && own(wf.phases, phase.phase) ? wf.phases[phase.phase] : null;
  if (!p) return stop(`workflow ${phase.workflow} no longer declares phase ${phase.phase}`);
  if (JSON.stringify(p.steps) !== JSON.stringify(phase.steps)) return stop(`phase ${phase.phase}'s steps are not the ones recorded with its go`);
  if (p.requires && !phase.reviewed) return stop(`phase ${phase.phase} needs ${p.requires}`);
  if (!(now < utcMs(phase.deadline))) return stop(`phase ${phase.phase}'s deadline ${phase.deadline} has passed`);
  for (const e of entries.filter((x) => x.claim && x.claim.phaseId === phase.phaseId)) {
    if (e.problems.length) return stop(`attempt ${e.attemptId}: ${e.problems.join("; ")}`);
    if (!e.outcome) return stop(`${e.claim.step} has no recorded outcome (pending)`);
    if (e.outcome.state === "NOT_SENT") continue;
    const id = p.steps[results.length];
    if (e.claim.step !== id) return stop(`attempt ${e.attemptId} is ${e.claim.step}; step ${results.length + 1} of phase ${phase.phase} is ${id ?? "none"}`);
    const b = boundReceipt(e, readReceipt);
    if (b.why) return stop(`${id}: ${b.why}`);
    if (b.rec.text !== wf.stepText(id)) return stop(`${id}'s receipt is for ${b.rec.text}`);
    const st = utcMs(b.rec.startedAt), fin = utcMs(b.rec.finishedAt);
    if (st === null || fin === null || st < utcMs(e.claim.claimedAt) || fin > now) return stop(`${id}'s receipt times are not after its claim and before now`);
    let ctx;
    try { ctx = ctxAt(e.claim.head); } catch (err) { return stop(`${id} cannot be checked at ${e.claim.head.slice(0, 7)} (${err.message})`); }
    try { if (roleOf(ctx.manifest, b.rec.text) !== e.claim.role) return stop(`${id} was sent from ${an(e.claim.role)} window; its text's role is ${roleOf(ctx.manifest, b.rec.text)}`); } catch (err) { return stop(err.message); }
    results.push(wf.check(id, b.text, ctx));
  }
  let ns;
  try { ns = wf.next(phase.phase, results); } catch (err) { return stop(err.message); }
  if (ns.stop) return stop(ns.reason);
  if (ns.next === null) return { stop: false, next: null, complete: true, reason: `phase ${phase.phase} is complete`, results };
  return { stop: false, next: ns.next, complete: false, reason: `${ns.next} may be sent next`, results };
}

// ── gos (SG-1) ──────────────────────────────────────────────────────────────

function readGo(paths, goId) {
  if (!isId(goId)) throw new Refusal("--go takes a 32-character go id; refusing");
  const live = join(paths.gos, `${goId}.json`);
  if (!existsSync(live)) {
    if (existsSync(join(paths.used, `${goId}.json`))) throw new Refusal(`go ${goId} was already used: a repeated or remembered command is refused; refusing`);
    if (existsSync(join(paths.voided, `${goId}.json`))) throw new Refusal(`go ${goId} was voided; refusing`);
    throw new Refusal(`no go ${goId} was issued; refusing`);
  }
  let g;
  try { g = readState(live); } catch { throw new Refusal(`go ${goId} is not readable; refusing`); }
  const bad = shapeProblems(g, GO_SPEC, "the go");
  if (bad.length || g.goId !== goId) throw new Refusal(`go ${goId} is malformed: ${bad.join("; ") || "its id"}; refusing`);
  return g;
}

/** The live markers of a phase and role whose window process still exists. */
function liveMarkers(paths, phaseId, role, now, identity) {
  const out = [];
  for (const e of readMarkers(paths)) {
    if (!e.marker) throw new Refusal(`a malformed marker is present (${e.problems[0]}); refusing`);
    const m = e.marker;
    if (m.phaseId !== phaseId || m.role !== role || now >= utcMs(m.until)) continue;
    if (sameShell(identity(m.shell.pid), m.shell)) out.push(m);
  }
  return out;
}

const heldMessage = (holds) => `the project is held: ${holds.map((h) => `${h.kind} ${h.attemptId.slice(0, 8)}: ${h.why}`).join("; ")}`;

/**
 * Issue the one go for the next step of a recorded phase (Claude). Under the
 * store lock, refuses unless: the store passes storeCheck; the clock check
 * holds; the phase is this checkout's and HEAD's, before its deadline; the
 * step is the one the gate names; exactly one live marker of the step's role
 * exists for the phase, with its window still running; the project has no
 * pending or held attempt; no unused go is outstanding for the ref (an
 * expired one is voided, recorded); and the step's ceiling, recomputed by
 * ceilingOf(), has not passed. The go records that ceiling, and its deadline
 * is the ceiling, or the marker's end if that is earlier.
 *
 * `notAfter` (ms), when given, is an EARLIER bound for this one send: the
 * latest start the current whole-path check allows, which Claude states
 * (Codex, review of 30c0eba). It must be later than now and no later than
 * the step's ceiling, the marker's end and the phase deadline; the go records
 * it and it becomes the go's deadline. It is required for a production
 * phase. The code binds the value it is given; it does not compute the path.
 * A tighter bound never re-arms a used go or releases a hold.
 *
 * `planFor(text, target)` is the sender's planSend: the go binds that
 * request's md5, bytes and read_only.
 */
export function issueGo({ paths, anchor, manifest, phaseId, step, head, checkout, now, identity, workflows = WORKFLOWS, ctxAt, readReceipt = RECEIPT_READER, planFor, notAfter = null }) {
  return withLock(paths, () => {
    const chk = requireStore({ paths, anchor, manifest });
    checkClock(paths, now, chk);
    const { phase, sha } = loadPhase(paths, phaseId);
    if (phase.head !== head || phase.checkout !== checkout) throw new Refusal(`phase ${phaseId} was recorded for ${phase.head.slice(0, 7)} in ${phase.checkout}; refusing`);
    if (!(utcMs(phase.recordedAt) <= now)) throw new Refusal("the phase is recorded later than now: the clock went back; refusing");
    const wf = own(workflows, phase.workflow) ? workflows[phase.workflow] : null;
    if (!wf || !phase.steps.includes(step)) throw new Refusal(`phase ${phase.phase} has no step ${isName(step) ? step : "of that name"}; refusing`);
    const ceiling = ceilingOf(wf, phase, step);
    const text = wf.stepText(step);
    const role = roleOf(manifest, text);
    if (role === "C") throw new Refusal("no reviewed phase sends a cancel: live cancellation is not approved (P1-P3 runbook §R 6), and no exception to the in-flight hold is defined; refusing");
    const plan = planFor(text, phase.target);
    if (plan.ref !== phase.ref || plan.template) throw new Refusal(`${text} does not plan to ${phase.ref}; refusing`);
    const markers = liveMarkers(paths, phaseId, role, now, identity);
    if (markers.length !== 1) throw new Refusal(`${markers.length} live ${role} windows are open for this phase; exactly one is needed; refusing`);
    const marker = markers[0];
    if (marker.head !== head || marker.ref !== phase.ref || marker.phaseSha !== sha || !(utcMs(marker.createdAt) <= now)) throw new Refusal(`marker ${marker.markerId} is not bound to this phase, head and ref; refusing`);
    let deadline = Math.min(ceiling, utcMs(marker.until));
    if (!(now < deadline)) throw new Refusal(`step ${step}'s ceiling ${iso(deadline)} has passed; refusing`);
    if (notAfter !== null) {
      if (!Number.isSafeInteger(notAfter)) throw new Refusal("--not-after must be a UTC time, YYYY-MM-DDTHH:MM:SS.sssZ; refusing");
      if (!(notAfter <= deadline && notAfter <= utcMs(phase.deadline))) throw new Refusal(`--not-after ${iso(notAfter)} is later than step ${step}'s ceiling, its window's end or the phase deadline (${iso(deadline)}): it can only tighten them; refusing`);
      if (!(now < notAfter)) throw new Refusal(`--not-after ${iso(notAfter)} has already passed; refusing`);
      deadline = notAfter;
    } else if (phase.target === "production") throw new Refusal(`a production go needs --not-after: the latest start the current whole-path check allows for ${step}; refusing`);
    const entries = readJournal(paths, phase.ref);
    const holds = holdsOf(entries, { readReceipt, ctxAt });
    if (holds.length) throw new Refusal(`${heldMessage(holds)}. A reviewed disposition (stage0-go.mjs dispose) releases it; refusing`);
    for (const [goId, g] of chk.index.gos) {
      if (g.state !== "live" || g.ev.ref !== phase.ref) continue;
      const live = readGo(paths, goId);
      if (now < utcMs(live.deadline)) throw new Refusal(`go ${goId} (${live.step}) is outstanding until ${live.deadline}; it is used or voided first; refusing`);
      logged(paths, chk, "go-void", { goId, reason: "expired" }, [moveStep(join(paths.gos, `${goId}.json`), join(paths.voided, `${goId}.json`))], now);
    }
    const gate = guardedProgress({ phase, entries, workflows, ctxAt, readReceipt, now });
    if (gate.stop || gate.complete || gate.next !== step) throw new Refusal(`the gate does not name ${step}: ${gate.stop ? `STOP: ${gate.reason}` : gate.complete ? gate.reason : `the next step is ${gate.next}`}; refusing`);
    const go = {
      schema: "stage0-go/3", goId: newId(), phaseId, phaseSha: sha, workflow: phase.workflow, phase: phase.phase, step, text,
      target: phase.target, ref: phase.ref, head, checkout, role, markerId: marker.markerId, issuedAt: iso(now), ceiling: iso(ceiling),
      notAfter: notAfter === null ? null : iso(notAfter), deadline: iso(deadline),
      request: { md5: plan.md5, bytes: plan.bytes, readOnly: plan.readOnly, endpoint: manifest.send.endpoint.replace("{ref}", plan.ref) },
      cancel: null,
      gate: { next: gate.next, after: entries.filter((e) => e.claim && e.claim.phaseId === phaseId).map((e) => e.attemptId) },
    };
    const goText = JSON.stringify(go, null, 2) + "\n";
    logged(paths, chk, "go-issue", { goId: go.goId, phaseId, step, ref: phase.ref, markerId: marker.markerId, sha256: sha256(Buffer.from(goText, "utf8")) }, [fileStep(join(paths.gos, `${go.goId}.json`), goText)], now);
    return go;
  }, now);
}

/** Void an unused go (Claude). The go moves to gos/void/, recorded. */
export function voidGo({ paths, anchor, manifest, goId, now }) {
  return withLock(paths, () => {
    const chk = requireStore({ paths, anchor, manifest });
    readGo(paths, goId);
    logged(paths, chk, "go-void", { goId, reason: "void" }, [moveStep(join(paths.gos, `${goId}.json`), join(paths.voided, `${goId}.json`))], now);
  }, now);
}

/**
 * Record a reviewed disposition of one held or pending attempt, on an intact
 * store only: a disposition is not a restoration. The review file must name
 * the attempt id; its sha256 is recorded. That the file is a genuine review
 * is a human check.
 */
export function dispose({ paths, anchor, manifest, ref, attemptId, reviewedPath, reviewedBytes, now }) {
  if (!isId(attemptId)) throw new Refusal("not an attempt id; refusing");
  if (!Buffer.isBuffer(reviewedBytes) || !reviewedBytes.toString("utf8").includes(attemptId)) throw new Refusal("the review file does not name the attempt id; refusing");
  return withLock(paths, () => {
    const chk = requireStore({ paths, anchor, manifest });
    const c = chk.index.claims.get(attemptId);
    if (!c || c.ev.ref !== ref) throw new Refusal(`attempt ${attemptId} is not in the ${ref} journal; refusing`);
    if (chk.index.dispositions.has(attemptId)) throw new Refusal(`attempt ${attemptId} already has a disposition; refusing`);
    const d = { schema: "stage0-disposition/1", attemptId, reviewed: { path: reviewedPath, sha256: sha256(reviewedBytes) }, recordedAt: iso(now) };
    const text = JSON.stringify(d, null, 2) + "\n";
    logged(paths, chk, "disposition", { attemptId, sha256: sha256(Buffer.from(text, "utf8")) }, [fileStep(join(paths.journal(ref), `${attemptId}.disposition.json`), text)], now);
    return d;
  }, now);
}

// ── admission and the send (SG-1 to SG-5) ───────────────────────────────────

/**
 * Admit one live send and make it. Before any request, in order: the process
 * and the programs it starts; the checkout (clean, at a full commit); the
 * store (storeCheck) and the clock; the window (session value, exactly one
 * marker, the same shell process, the same token, the marker's head, ref and
 * end); the text's role; the go named by id (unused, this marker's, this
 * phase's, step, text, head, ref and request, issued before now, before its
 * deadline); the step's ceiling, recomputed here by ceilingOf() from the
 * declaration and the phase's deadline, which the go must record exactly and
 * its deadline must not pass; a recorded not-after must be the go's deadline,
 * and a production go must have one. Under the store lock: the store again, no
 * pending or held attempt, and the gate names the go's step. Then the go is
 * moved to gos/used/ and the claim is written and recorded. Immediately
 * before fetch, inside send(), the deadline, the marker's end and the clock
 * are checked again; a failure there records NOT_SENT. After that point every
 * failure is AfterDispatch: the claim stays pending, which holds the project.
 *
 * `send(plan, {clock, admit})` is the sender's send(); `writeReceipt(record)`
 * writes the receipt and returns its path.
 */
export async function guardedSend(o) {
  const { plan, goId, token, env, anchor, manifest, root, now = Date.now, identity = shellIdentity, git = gitState, workflows = WORKFLOWS, ctxAt, readReceipt = RECEIPT_READER } = o;
  const paths = statePaths(o.stateDir || DEFAULT_STATE);
  const execArgv = o.execArgv || process.execArgv;
  const ppid = o.ppid ?? process.ppid;
  const selfStartMs = o.selfStartMs ?? Date.now() - process.uptime() * 1000;
  const t0 = now();
  preflight({ execArgv, env, dirs: [root, process.cwd()] });
  const head = checkoutHead(git, root);
  const chk0 = requireStore({ paths, anchor, manifest });
  checkClock(paths, t0, chk0);
  const nonce = sessionOf(env);
  const sid = sessionIdOf(nonce);
  const mine = readMarkers(paths).filter((e) => !e.marker || e.marker.sessionId === sid);
  if (mine.some((e) => !e.marker)) throw new Refusal("a malformed marker is present; refusing");
  if (mine.length !== 1) throw new Refusal(`${mine.length ? "more than one marker" : "no marker"} for this window's session: open one with stage0-window.mjs; refusing`);
  const marker = mine[0].marker;
  const shell = invokingShell({ identity, ppid, selfStartMs });
  if (!sameShell(shell, marker.shell)) throw new Refusal(`marker ${marker.markerId} belongs to another window (process ${marker.shell.pid}); this command runs in process ${shell.pid}. A window opened from it, or after it, inherits nothing; refusing`);
  if (tokenTagOf(nonce, token) !== marker.tokenTag) throw new Refusal(`the token in this window is not the one loaded when marker ${marker.markerId} was opened; refusing`);
  if (marker.head !== head || marker.checkout !== root || marker.ref !== plan.ref || marker.target !== plan.target) throw new Refusal(`marker ${marker.markerId} is for ${marker.head.slice(0, 7)} ${marker.target} ${marker.ref}; this send is ${head.slice(0, 7)} ${plan.target} ${plan.ref}; refusing`);
  const created = utcMs(marker.createdAt), until = utcMs(marker.until);
  if (!(created <= t0)) throw new Refusal(`marker ${marker.markerId} was created later than now: the clock went back; refusing`);
  if (!(t0 < until)) throw new Refusal(`marker ${marker.markerId} ended at ${marker.until}; refusing`);
  const role = roleOf(manifest, plan.name);
  if (role !== marker.role) throw new Refusal(`${plan.name} is sent from ${an(role)} window; this is ${an(marker.role)} window; refusing`);
  const go = readGo(paths, goId);
  const { phase, sha } = loadPhase(paths, go.phaseId);
  const want = {
    markerId: marker.markerId, phaseId: marker.phaseId, phaseSha: sha, workflow: phase.workflow, phase: phase.phase,
    text: plan.name, target: plan.target, ref: plan.ref, head, checkout: root, role,
  };
  for (const [k, v] of Object.entries(want)) if (go[k] !== v) throw new Refusal(`go ${goId} is not for this send: its ${k} differs; refusing`);
  if (marker.phaseSha !== sha || phase.head !== head || phase.ref !== plan.ref) throw new Refusal(`go ${goId}'s phase is not this marker's, head and ref; refusing`);
  if (!phase.steps.includes(go.step)) throw new Refusal(`go ${goId}'s step is not in its phase; refusing`);
  const wf = own(workflows, phase.workflow) ? workflows[phase.workflow] : null;
  if (!wf) throw new Refusal(`workflow ${phase.workflow} is not declared; refusing`);
  const ceiling = ceilingOf(wf, phase, go.step);
  if (go.ceiling !== iso(ceiling)) throw new Refusal(`go ${goId} records ${go.step}'s ceiling as ${go.ceiling}; its declaration gives ${iso(ceiling)}: a stale or altered go; refusing`);
  if (go.notAfter !== null && go.deadline !== go.notAfter) throw new Refusal(`go ${goId}'s deadline ${go.deadline} is not its recorded not-after ${go.notAfter}; refusing`);
  if (phase.target === "production" && go.notAfter === null) throw new Refusal(`go ${goId} is a production go with no not-after; refusing`);
  const request = { md5: plan.md5, bytes: plan.bytes, readOnly: plan.readOnly, endpoint: manifest.send.endpoint.replace("{ref}", plan.ref) };
  if (JSON.stringify(go.request) !== JSON.stringify(request) || plan.template !== null) throw new Refusal(`go ${goId}'s request is not this send's; refusing`);
  const issued = utcMs(go.issuedAt), dl = utcMs(go.deadline);
  if (!(utcMs(phase.recordedAt) <= created && created <= issued && issued <= t0)) throw new Refusal(`go ${goId} was issued later than now, or before its marker: the clock went back; refusing`);
  if (!(dl <= ceiling)) throw new Refusal(`go ${goId}'s deadline ${go.deadline} is after step ${go.step}'s ceiling ${iso(ceiling)}: a go never extends it; refusing`);
  if (!(dl <= until && dl <= utcMs(phase.deadline) && issued < dl)) throw new Refusal(`go ${goId}'s deadline is after its marker's or phase's end; refusing`);
  if (!(t0 < dl)) throw new Refusal(`go ${goId}'s deadline ${go.deadline} has passed; refusing`);
  const claim = withLock(paths, () => {
    const t1 = now();
    const chk = requireStore({ paths, anchor, manifest });
    const entries = readJournal(paths, plan.ref);
    const holds = holdsOf(entries, { readReceipt, ctxAt });
    if (holds.length) throw new Refusal(`${heldMessage(holds)}; refusing`);
    const gate = guardedProgress({ phase, entries, workflows, ctxAt, readReceipt, now: t1 });
    if (gate.stop || gate.next !== go.step) throw new Refusal(`the gate does not name ${go.step}: ${gate.stop ? `STOP: ${gate.reason}` : gate.complete ? gate.reason : `the next step is ${gate.next}`}; refusing`);
    if (!(t1 < dl && t1 < until)) throw new Refusal(`go ${goId}'s deadline ${go.deadline} has passed; refusing`);
    const g = chk.index.gos.get(goId);
    if (!g || g.state !== "live") throw new Refusal(`go ${goId} was used by another command; refusing`);
    const claimSeq = (chk.index.claimSeq[plan.ref] || 0) + 1;
    const c = {
      schema: "stage0-claim/1", attemptId: newId(), seq: claimSeq,
      goId, phaseId: phase.phaseId, step: go.step, text: plan.name, target: plan.target, ref: plan.ref, role, markerId: marker.markerId, shell,
      head, checkout: root, request, issuedAt: go.issuedAt, deadline: go.deadline, claimedAt: iso(t1),
    };
    const text = JSON.stringify(c, null, 2) + "\n";
    logged(paths, chk, "claim", { attemptId: c.attemptId, goId, ref: plan.ref, claimSeq, sha256: sha256(Buffer.from(text, "utf8")) }, [
      moveStep(join(paths.gos, `${goId}.json`), join(paths.used, `${goId}.json`)),
      fileStep(join(paths.journal(plan.ref), `${c.attemptId}.claim.json`), text),
    ], t1);
    return c;
  }, t0);
  // Record one outcome, under the lock, against a store that still checks.
  const recordOutcome = (value, t, waitMs) => withLock(paths, () => {
    const chk = requireStore({ paths, anchor, manifest });
    const text = JSON.stringify(value, null, 2) + "\n";
    logged(paths, chk, "outcome", { attemptId: claim.attemptId, state: value.state, sha256: sha256(Buffer.from(text, "utf8")) }, [fileStep(join(paths.journal(plan.ref), `${claim.attemptId}.outcome.json`), text)], t);
  }, t, waitMs);
  // The last check, called by send() after it builds the request and
  // immediately before fetch.
  const admit = () => {
    const t = now();
    let why = null;
    if (!(t < dl)) why = `go ${goId}'s deadline ${go.deadline} passed before the request`;
    else if (!(t < until)) why = `marker ${marker.markerId} ended before the request`;
    else { try { checkClock(paths, t, chk0); } catch (e) { why = e.message; } }
    if (why === null) return;
    try { recordOutcome({ schema: "stage0-outcome/1", attemptId: claim.attemptId, state: "NOT_SENT", at: iso(t), reason: why.slice(0, 500) }, t, LOCK_WAIT_MS); }
    catch (e) { throw new NotSent(`${why}; no request was made, but NOT_SENT could not be recorded (${e.message}), so attempt ${claim.attemptId} stays pending and holds the project until a reviewed disposition`); }
    throw new NotSent(`${why}; no request was made, and attempt ${claim.attemptId} is recorded NOT_SENT`);
  };
  let record;
  try { record = await o.send(plan, { clock: () => new Date(now()), admit }); } catch (e) {
    if (e instanceof NotSent) throw new Refusal(e.message);
    throw new AfterDispatch(`the send failed after the request was, or may have been, dispatched (${e && e.message}); attempt ${claim.attemptId} stays pending: HOLD`);
  }
  record.guard = { attemptId: claim.attemptId, goId, phaseId: phase.phaseId, step: go.step, markerId: marker.markerId, role, head, issuedAt: go.issuedAt, deadline: go.deadline };
  let file;
  try { file = o.writeReceipt(record); } catch (e) { throw new AfterDispatch(`the request was dispatched (HTTP ${record.httpStatus ?? "none"}), but its receipt could not be written (${e.message}); attempt ${claim.attemptId} stays pending: HOLD`); }
  try {
    const buf = readFileSync(file);
    const t = now();
    recordOutcome({ schema: "stage0-outcome/1", attemptId: claim.attemptId, state: "DISPATCHED", at: iso(t), receipt: { file, sha256: sha256(buf), bytes: buf.length }, httpStatus: record.httpStatus }, t, 3 * LOCK_WAIT_MS);
  } catch (e) { throw new AfterDispatch(`the request was dispatched and its receipt written to ${file}, but its outcome could not be recorded (${e.message}); attempt ${claim.attemptId} stays pending: HOLD`); }
  return { record, file, attemptId: claim.attemptId, go, marker };
}

/**
 * The guard state for one ref, for the status command. Read-only. On a store
 * that fails storeCheck it reports DAMAGED with the problems and no holds
 * list: an empty list would claim a history that is not known to be intact.
 */
export function status({ paths, anchor, manifest, ref, ctxAt, readReceipt = RECEIPT_READER, now }) {
  const chk = storeCheck({ paths, anchor, manifest });
  if (!chk.ok) return { intact: false, damaged: chk.problems, lock: existsSync(paths.lock) };
  const entries = readJournal(paths, ref);
  const gos = [...chk.index.gos].filter(([, g]) => g.ev.ref === ref && g.state === "live").map(([goId]) => {
    const g = readState(join(paths.gos, `${goId}.json`));
    return { goId, step: g.step, ceiling: g.ceiling, notAfter: g.notAfter, deadline: g.deadline, live: now < utcMs(g.deadline) };
  });
  return {
    intact: true,
    storeId: chk.store.storeId,
    events: chk.seq,
    holds: holdsOf(entries, { readReceipt, ctxAt }),
    attempts: entries.map((e) => ({ attemptId: e.attemptId, seq: e.claim && e.claim.seq, step: e.claim && e.claim.step, state: e.outcome ? e.outcome.state : e.claim ? "PENDING" : "MALFORMED", disposed: Boolean(e.disposition) })),
    gos,
    markers: readMarkers(paths).map((e) => (e.marker ? { markerId: e.marker.markerId, role: e.marker.role, phaseId: e.marker.phaseId, until: e.marker.until, ref: e.marker.ref } : { malformed: e.problems[0] })),
    lock: existsSync(paths.lock),
  };
}

