// scripts/manual/stage0-guard.mjs — the checks a live stage-0 send passes
// before any request, and the records they read (Codex item 6: the incident
// review of 2026-10-12, §6, and K-R2 of the review of df401b3; the plan
// docs/security/stage0-item6-sender-guards-plan.md, as amended by Codex's
// review of 2026-10-27, SG-1 to SG-6).
//
// It is a library. Three pinned command lines use it:
//   stage0-go.mjs      (Claude) records the clock check and Ryan's phase go,
//                      issues one go per send, voids or disposes;
//   stage0-window.mjs  (Ryan, in each PowerShell window) opens and closes
//                      the window's marker;
//   stage0-send.mjs    (Ryan) sends one pinned text, naming its go by id.
//
// The records live in one per-user directory outside every checkout
// (~/.stage0-guard), so a new window, a new phase or a fresh clone reads the
// same journal:
//   clock.json, hwm.json   the last accepted clock check, and the latest time
//                          a guard tool has seen;
//   phases/<id>.json       Ryan's go for one phase, with his message's exact
//                          text beside it (<id>.go.txt);
//   markers/<id>.json      one per window: its role (R, W or C), the phase,
//                          the head and ref, the phase deadline, the window's
//                          shell process as Windows reports it (pid, image,
//                          creation time), and an HMAC of the token loaded in
//                          it, keyed by the window's STAGE0_SESSION value;
//   gos/<id>.json          one per send: the phase, the logical step, its
//                          text, the marker, the head, the ref, the request's
//                          md5/bytes and an absolute deadline. Using a go
//                          moves it to gos/used/; voiding it, to gos/void/;
//   journal/<ref>/         one claim per admitted send, written before any
//                          request can be made, then its outcome (NOT_SENT,
//                          or DISPATCHED with the receipt's sha256) and, after
//                          a review, a disposition. These tools never delete
//                          a journal file.
//
// What the code checks, and what it does not:
//   - Each check below throws a Refusal before any request. The one place a
//     request can follow is guardedSend(), after the claim is written; from
//     there on a failure is AfterDispatch, never "nothing was sent".
//   - The marker binds a shell PROCESS: Windows' own record of the pid and
//     creation time of the process that started node. A child shell that
//     inherited the environment has another pid, so it is refused. A window
//     a person walks away from still matches until the phase deadline. "Every
//     pause is an exit" stays a procedure.
//   - The deadline bounds admission on this machine's clock. The clock check
//     compares that clock with a time server, within a stated tolerance; it
//     is not a guarantee of when a server starts the work, and it cancels
//     nothing.
//   - Recording a phase checks that Ryan's message names the phase, head,
//     ref, deadline and steps. It does not show who wrote the message.
//   - Anyone who can edit these files, or the pinned code, can defeat them.
//     The pins, review and the runbook procedures are the controls for that.
import { execFileSync } from "node:child_process";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, openSync, writeSync, fsyncSync, closeSync, readdirSync, renameSync, unlinkSync, mkdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname, posix } from "node:path";
import * as A from "./assemble-stage0.mjs";
import * as C from "./stage0-classify.mjs";
import * as K from "./stage0-capture.mjs";

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
/** The clock check (SG-5): three w32tm samples against the reference, each within the tolerance; valid for freshMs. */
export const CLOCK = Object.freeze({ reference: "time.windows.com", samples: 3, toleranceMs: 2000, freshMs: 60 * 60 * 1000, backstepMs: 2000 });
/** A go's deadline is this much before the phase deadline (Codex Q5: it only tightens the reviewed latest start). */
export const MARGIN_MS = 60 * 1000;
/** Ryan's go is recorded within this long of its arrival, with at least the second value left (capture runbook §3). */
export const PHASE_LIMITS = Object.freeze({ recordWithinMs: 10 * 60 * 1000, minRemainingMs: 30 * 60 * 1000 });
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
const isSha = hex(64);
const isCommit = hex(40);
const isRef = (v) => typeof v === "string" && /^[a-z]{20}$/.test(v);
const isName = (v) => typeof v === "string" && /^[A-Z0-9][A-Z0-9-]{0,39}$/.test(v);
const isRole = (v) => ROLES.includes(v);
const an = (role) => (role === "R" ? "an R" : `a ${role}`);
const isInt = (v) => Number.isSafeInteger(v) && v >= 0;
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

const SHELL_SPEC = { pid: (v) => Number.isSafeInteger(v) && v > 0, image: (v) => SHELLS.includes(v), created: (v) => createdMs(v) !== null };
const isShell = (v) => shapeProblems(v, SHELL_SPEC, "shell").length === 0;
const REQUEST_SPEC = { md5: hex(32), bytes: (v) => Number.isSafeInteger(v) && v > 0, readOnly: isBool, endpoint: isStr(200) };
const isRequest = (v) => shapeProblems(v, REQUEST_SPEC, "request").length === 0;
const isReviewed = (v) => v === null || shapeProblems(v, { path: isStr(1024), sha256: isSha }, "reviewed").length === 0;

export const PHASE_SPEC = {
  schema: (v) => v === "stage0-phase/1", phaseId: isId, workflow: isStr(40), phase: isStr(40),
  steps: (v) => Array.isArray(v) && v.length > 0 && v.length <= 64 && v.every(isName) && new Set(v).size === v.length,
  target: isStr(40), ref: isRef, head: isCommit, checkout: isStr(1024),
  arrivedAt: isUtc, recordedAt: isUtc, deadline: isUtc,
  goText: (v) => shapeProblems(v, { sha256: isSha, bytes: isInt }, "goText").length === 0,
  reviewed: isReviewed,
};
export const MARKER_SPEC = {
  schema: (v) => v === "stage0-marker/1", markerId: isId, role: isRole, phaseId: isId, phaseSha: isSha,
  target: isStr(40), ref: isRef, head: isCommit, checkout: isStr(1024), createdAt: isUtc, until: isUtc,
  sessionId: isSha, tokenTag: isSha, shell: isShell,
};
export const GO_SPEC = {
  schema: (v) => v === "stage0-go/1", goId: isId, phaseId: isId, phaseSha: isSha, workflow: isStr(40), phase: isStr(40),
  step: isName, text: isName, target: isStr(40), ref: isRef, head: isCommit, checkout: isStr(1024), role: isRole, markerId: isId,
  issuedAt: isUtc, deadline: isUtc, request: isRequest, cancel: (v) => v === null,
  gate: (v) => shapeProblems(v, { next: isName, after: (a) => Array.isArray(a) && a.every(isId) }, "gate").length === 0,
};
export const CLAIM_SPEC = {
  schema: (v) => v === "stage0-claim/1", attemptId: isId, seq: (v) => Number.isSafeInteger(v) && v > 0, goId: isId, phaseId: isId,
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
/** The receipt's guard block (SG-4): what the admission journal and marker bound. Never the token, the session value or the token HMAC. */
export const RECEIPT_GUARD_SPEC = { attemptId: isId, goId: isId, phaseId: isId, step: isName, markerId: isId, role: isRole, head: isCommit, issuedAt: isUtc, deadline: isUtc };

// ── files ────────────────────────────────────────────────────────────────────

export function statePaths(dir) {
  return {
    dir,
    clock: join(dir, "clock.json"),
    clockLog: join(dir, "clock"),
    hwm: join(dir, "hwm.json"),
    phases: join(dir, "phases"),
    markers: join(dir, "markers"),
    gos: join(dir, "gos"),
    used: join(dir, "gos", "used"),
    voided: join(dir, "gos", "void"),
    journal: (ref) => join(dir, "journal", ref),
    lock: (ref) => join(dir, `lock-${ref}`),
  };
}

/** The exact JSON of a state file, or throws. */
export function readState(file) {
  return C.strictJson(readFileSync(file, "utf8"), { maxChars: 1 << 20 });
}

/** Write a new file, never over an existing one, and flush it to disk. */
export function writeOnce(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  const fd = openSync(file, "wx");
  try { writeSync(fd, typeof value === "string" ? value : JSON.stringify(value, null, 2) + "\n"); fsyncSync(fd); } finally { closeSync(fd); }
}

function replaceFile(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n");
  renameSync(tmp, file);
}

const listJson = (dir) => { try { return readdirSync(dir).filter((f) => f.endsWith(".json")); } catch { return []; } };
const newId = () => randomBytes(16).toString("hex");

/** Hold the project lock for fn. Exclusive create, so a second process is refused, never queued. */
export function withLock(paths, ref, fn, now) {
  const file = paths.lock(ref);
  mkdirSync(paths.dir, { recursive: true });
  let fd;
  try { fd = openSync(file, "wx"); } catch {
    let since = "an unknown time";
    try { since = readFileSync(file, "utf8").trim().slice(0, 80); } catch { /* reported as unknown */ }
    throw new Refusal(`another guard process holds the ${ref} lock (${since}). If none is running, the lock is stale: check with stage0-go.mjs status, then remove ${file} by hand; refusing`);
  }
  try { writeSync(fd, `pid ${process.pid} since ${iso(now)}`); } finally { closeSync(fd); }
  try { return fn(); } finally { try { unlinkSync(file); } catch { /* already gone */ } }
}

/** Rule 3′'s context at a head: the manifest committed there, assembled and checked against its pins. */
export const contextAt = (head, root) => C.contextAt(head, root);

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

/** Accept a measurement as the clock check, or refuse; writes clock.json and resets the high-water mark. */
export function recordClock(paths, measurement, now) {
  const offsets = parseStripchart(measurement && measurement.stripchart);
  if (!offsets || offsets.length !== CLOCK.samples) throw new Refusal(`w32tm did not give ${CLOCK.samples} readable samples against ${CLOCK.reference}; the clock cannot be established; refusing`);
  const maxAbs = Math.max(...offsets.map(Math.abs));
  if (maxAbs > CLOCK.toleranceMs) throw new Refusal(`this machine's clock is ${maxAbs} ms from ${CLOCK.reference}, beyond the ${CLOCK.toleranceMs} ms tolerance; resynchronize it, then check again; refusing`);
  const pick = (re) => { const m = re.exec(String(measurement.status || "")); return m ? m[1].trim().slice(0, 120) : "not reported"; };
  const rec = {
    schema: "stage0-clock/1", at: iso(now), reference: CLOCK.reference, offsetsMs: offsets, maxAbsOffsetMs: maxAbs, toleranceMs: CLOCK.toleranceMs,
    source: pick(/^Source:\s*(.+)$/m), lastSync: pick(/^Last Successful Sync Time:\s*(.+)$/m), leap: pick(/^Leap Indicator:\s*(.+)$/m),
  };
  writeOnce(join(paths.clockLog, `${rec.at.replace(/[:.]/g, "-")}_${newId().slice(0, 8)}.json`), rec);
  replaceFile(paths.clock, rec);
  replaceFile(paths.hwm, { ms: now, at: iso(now) });
  return rec;
}

const CLOCK_SPEC = {
  schema: (v) => v === "stage0-clock/1", at: isUtc, reference: (v) => v === CLOCK.reference, offsetsMs: (v) => Array.isArray(v) && v.length === CLOCK.samples && v.every(Number.isSafeInteger),
  maxAbsOffsetMs: isInt, toleranceMs: (v) => v === CLOCK.toleranceMs, source: isStr(120), lastSync: isStr(120), leap: isStr(120),
};

/**
 * Refuse unless a clock check is recorded, fresh, not in the future, and the
 * clock has not gone back past the latest time a guard tool saw. A backward
 * step refuses until a new clock check; a forward step only makes deadlines
 * pass sooner. Advances the high-water mark.
 */
export function checkClock(paths, now) {
  if (!Number.isFinite(now)) throw new Refusal("no current time; refusing");
  let rec;
  try { rec = readState(paths.clock); } catch { throw new Refusal("no clock check is recorded: run `node scripts/manual/stage0-go.mjs clock` first; refusing"); }
  const bad = shapeProblems(rec, CLOCK_SPEC, "the clock check");
  if (bad.length || rec.maxAbsOffsetMs > CLOCK.toleranceMs || Math.max(...rec.offsetsMs.map(Math.abs)) !== rec.maxAbsOffsetMs) throw new Refusal("the recorded clock check is malformed; run a new one; refusing");
  const at = utcMs(rec.at);
  if (now < at) throw new Refusal(`the clock check (${rec.at}) is later than now: the clock went back; run a new clock check; refusing`);
  if (now - at >= CLOCK.freshMs) throw new Refusal(`the clock check (${rec.at}) is older than ${CLOCK.freshMs / 60000} min; run a new one; refusing`);
  let hwm = null;
  try { const h = readState(paths.hwm); if (sameKeys(h, ["ms", "at"]) && isInt(h.ms)) hwm = h.ms; } catch { /* none yet */ }
  if (hwm !== null && now < hwm - CLOCK.backstepMs) throw new Refusal(`the clock is ${hwm - now} ms behind a time a guard tool already saw (${iso(hwm)}): it went back; run a new clock check; refusing`);
  if (hwm === null || now > hwm) { try { replaceFile(paths.hwm, { ms: now, at: iso(now) }); } catch { /* best effort: the next check reads the older mark */ } }
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
 * gate. Only the item 2 capture phases are declared. No production phase is:
 * the next production runbook declares its own, with their gate, in review,
 * and until then a production go refuses.
 */
export const WORKFLOWS = Object.freeze({
  capture: Object.freeze({
    target: "staging",
    phases: Object.freeze(Object.fromEntries(Object.entries(K.PHASES).map(([k, p]) => [k, Object.freeze({ steps: Object.freeze([...p.steps]), requires: p.requires || null })]))),
    stepText: (id) => K.STEPS[id].text,
    check: (id, text, ctx) => K.checkStep(id, text, ctx),
    next: (phase, results) => K.nextStep(phase, results),
  }),
});

// ── phases ───────────────────────────────────────────────────────────────────

const minuteUtc = (ms) => iso(ms).slice(0, 16).replace("T", " ") + " UTC";

/**
 * Record Ryan's go for one phase from his message's exact text. Refuses
 * unless the text names the phase ("GO phase <P> "), the head (7 characters),
 * the ref, every step and the deadline as "YYYY-MM-DD HH:MM UTC"; the go is
 * recorded within PHASE_LIMITS.recordWithinMs of its arrival, with at least
 * PHASE_LIMITS.minRemainingMs left; and a phase that needs a reviewed decision
 * names one. A token-shaped value in the text refuses.
 */
export function recordPhase({ paths, manifest, workflows = WORKFLOWS, workflow, phase, goText, arrivedAt, deadline, reviewed = null, head, checkout, now }) {
  const wf = isObj(workflows) && own(workflows, workflow) ? workflows[workflow] : null;
  if (!wf) throw new Refusal(`no reviewed workflow ${JSON.stringify(String(workflow).slice(0, 20))} is declared for the guarded sender; refusing`);
  const p = own(wf.phases, phase) ? wf.phases[phase] : null;
  if (!p) throw new Refusal(`workflow ${workflow} declares no phase ${JSON.stringify(String(phase).slice(0, 20))}; refusing`);
  const ref = manifest.send.targets[wf.target];
  if (!isRef(ref)) throw new Refusal(`the manifest has no ref for ${wf.target}; refusing`);
  const arrived = utcMs(arrivedAt);
  const dl = utcMs(deadline);
  if (arrived === null || dl === null) throw new Refusal("the arrival and the deadline must be UTC times, YYYY-MM-DDTHH:MM:SS.sssZ; refusing");
  if (dl % 60000 !== 0) throw new Refusal("the deadline must be a whole minute, as the go states it; refusing");
  if (arrived > now) throw new Refusal("the go's arrival is later than now; refusing");
  if (now - arrived > PHASE_LIMITS.recordWithinMs) throw new Refusal(`the go arrived more than ${PHASE_LIMITS.recordWithinMs / 60000} min ago; a late record needs a new go; refusing`);
  if (dl - now < PHASE_LIMITS.minRemainingMs) throw new Refusal(`less than ${PHASE_LIMITS.minRemainingMs / 60000} min remain before the deadline; refusing`);
  if (typeof goText !== "string" || !goText.length || goText.length > 4096) throw new Refusal("the go text is missing or too long; refusing");
  if (/sbp_|sb_secret_/.test(goText)) throw new Refusal("the go text holds a token-shaped value: STOP, delete that token; refusing");
  const missing = [`GO phase ${phase} `, head.slice(0, 7), ref, minuteUtc(dl), ...p.steps].filter((s) => !goText.includes(s));
  if (missing.length) throw new Refusal(`the go text does not name ${missing.map((s) => JSON.stringify(s)).join(", ")}; refusing`);
  if (p.requires && reviewed === null) throw new Refusal(`phase ${phase} needs ${p.requires}; name it (--reviewed); refusing`);
  const rec = {
    schema: "stage0-phase/1", phaseId: newId(), workflow, phase, steps: [...p.steps], target: wf.target, ref, head, checkout,
    arrivedAt, recordedAt: iso(now), deadline, goText: { sha256: sha256(Buffer.from(goText, "utf8")), bytes: Buffer.byteLength(goText) }, reviewed,
  };
  const bad = shapeProblems(rec, PHASE_SPEC, "the phase");
  if (bad.length) throw new Refusal(`${bad.join("; ")}; refusing`);
  writeOnce(join(paths.phases, `${rec.phaseId}.go.txt`), goText);
  writeOnce(join(paths.phases, `${rec.phaseId}.json`), rec);
  return rec;
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
  return { phase: rec, sha: sha256(raw) };
}

// ── markers ─────────────────────────────────────────────────────────────────

function readMarkers(paths) {
  const out = [];
  for (const f of listJson(paths.markers)) {
    let m = null;
    try { m = readState(join(paths.markers, f)); } catch { /* malformed: below */ }
    const bad = shapeProblems(m, MARKER_SPEC, `marker ${f}`);
    out.push({ file: join(paths.markers, f), marker: bad.length ? null : m, problems: bad.length ? bad : (f === `${m.markerId}.json` ? [] : [`marker ${f} is not named by its id`]) });
  }
  return out;
}

/**
 * Open this window's marker for one phase (Ryan, after loading the token and
 * setting STAGE0_SESSION). Refuses on a malformed or foreign phase, a role
 * the phase never sends, a missing session value or token, a shell that is
 * not a PowerShell window, a second marker for this shell or session, and a
 * live window of the same role in the phase. A marker whose window is gone
 * is removed.
 */
export function openMarker({ paths, manifest, phaseId, role, env, head, checkout, now, identity, ppid, selfStartMs, workflows = WORKFLOWS }) {
  const { phase, sha } = loadPhase(paths, phaseId);
  if (phase.head !== head || phase.checkout !== checkout) throw new Refusal(`phase ${phaseId} was recorded for ${phase.head.slice(0, 7)} in ${phase.checkout}; this is ${head.slice(0, 7)} in ${checkout}; refusing`);
  if (!(utcMs(phase.recordedAt) <= now)) throw new Refusal("the phase is recorded later than now: the clock went back; refusing");
  if (now >= utcMs(phase.deadline)) throw new Refusal(`phase ${phase.phase}'s deadline ${phase.deadline} has passed; refusing`);
  if (!isRole(role)) throw new Refusal("the role is R, W or C; refusing");
  const wf = own(workflows, phase.workflow) ? workflows[phase.workflow] : null;
  const texts = phase.steps.map((s) => (wf ? wf.stepText(s) : null));
  if (!texts.some((t) => t && roleOf(manifest, t) === role)) throw new Refusal(`phase ${phase.phase} sends nothing from ${an(role)} window; refusing`);
  const nonce = sessionOf(env);
  const token = env[TOKEN_ENV];
  if (typeof token !== "string" || !TOKEN_SHAPE.test(token)) throw new Refusal(`${TOKEN_ENV} is not a personal access token in this window; load it first; refusing`);
  const shell = invokingShell({ identity, ppid, selfStartMs });
  const sessionId = sessionIdOf(nonce);
  const removed = [];
  for (const e of readMarkers(paths)) {
    if (!e.marker) throw new Refusal(`a malformed marker is present (${e.problems[0]}); inspect it with stage0-go.mjs status; refusing`);
    const m = e.marker;
    if (m.sessionId === sessionId || sameShell(m.shell, shell)) throw new Refusal(`this window already has marker ${m.markerId} (role ${m.role}); close it first; refusing`);
    if (m.phaseId === phaseId && m.role === role) {
      if (now < utcMs(m.until) && sameShell(identity(m.shell.pid), m.shell)) throw new Refusal(`a live ${role} window for this phase already exists (marker ${m.markerId}); refusing`);
      unlinkSync(e.file);
      removed.push(m.markerId);
    }
  }
  const marker = {
    schema: "stage0-marker/1", markerId: newId(), role, phaseId, phaseSha: sha, target: phase.target, ref: phase.ref, head, checkout,
    createdAt: iso(now), until: phase.deadline, sessionId, tokenTag: tokenTagOf(nonce, token), shell,
  };
  writeOnce(join(paths.markers, `${marker.markerId}.json`), marker);
  return { marker, removed };
}

/** The well-formed markers of this window's session value (none when it is unset). */
export function sessionMarkers(paths, env) {
  const nonce = env[SESSION_ENV];
  if (typeof nonce !== "string" || !SESSION_SHAPE.test(nonce)) return [];
  const sid = sessionIdOf(nonce);
  return readMarkers(paths).filter((e) => e.marker && e.marker.sessionId === sid).map((e) => e.marker);
}

/** Remove this session's markers and their unused gos. No pin, head or clock check: closing must always work. */
export function closeSession({ paths, env }) {
  const nonce = env[SESSION_ENV];
  if (typeof nonce !== "string" || !SESSION_SHAPE.test(nonce)) return { markers: [], gos: [] };
  const sid = sessionIdOf(nonce);
  const markers = [];
  for (const e of readMarkers(paths)) if (e.marker && e.marker.sessionId === sid) { unlinkSync(e.file); markers.push(e.marker.markerId); }
  const gos = [];
  for (const f of listJson(paths.gos)) {
    let g = null;
    try { g = readState(join(paths.gos, f)); } catch { /* not this session's */ }
    if (isObj(g) && markers.includes(g.markerId)) { unlinkSync(join(paths.gos, f)); gos.push(g.goId); }
  }
  return { markers, gos };
}

// ── the journal (SG-2) ──────────────────────────────────────────────────────

/** Every attempt in the project's journal, by claim order, each with its problems (a malformed file is a problem, never skipped). */
export function readJournal(paths, ref) {
  const dir = paths.journal(ref);
  let names = [];
  try { names = readdirSync(dir); } catch { return []; }
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
 * What holds the project: every attempt without a disposition that is
 * PENDING (a claim and no outcome: in flight, or crashed), or HOLD (a
 * problem in its files; a DISPATCHED receipt that is missing, altered or not
 * bound to its claim; or a writing send, as the classifier counts writing,
 * that rule 3′ classifies R1 or R4). NOT_SENT holds nothing.
 */
export function holdsOf(entries, { readReceipt = RECEIPT_READER, ctxAt }) {
  const out = [];
  for (const e of entries) {
    if (e.disposition) continue;
    const hold = (why) => out.push({ attemptId: e.attemptId, kind: "HOLD", why });
    if (e.problems.length) { hold(e.problems.join("; ")); continue; }
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

/**
 * Issue the one go for the next step of a recorded phase (Claude). Refuses
 * unless: the phase is this checkout's and HEAD's, before its deadline; the
 * step is the one the gate names; exactly one live marker of the step's role
 * exists for the phase, with its window still running; the project has no
 * pending or held attempt; and no unused go is outstanding for the ref (an
 * expired one is voided). The deadline is the phase deadline less MARGIN_MS,
 * never after the marker's end. `planFor(text, target)` is the sender's
 * planSend: the go binds that request's md5, bytes and read_only.
 */
export function issueGo({ paths, manifest, phaseId, step, head, checkout, now, identity, workflows = WORKFLOWS, ctxAt, readReceipt = RECEIPT_READER, planFor }) {
  const { phase, sha } = loadPhase(paths, phaseId);
  if (phase.head !== head || phase.checkout !== checkout) throw new Refusal(`phase ${phaseId} was recorded for ${phase.head.slice(0, 7)} in ${phase.checkout}; refusing`);
  if (!(utcMs(phase.recordedAt) <= now)) throw new Refusal("the phase is recorded later than now: the clock went back; refusing");
  const wf = own(workflows, phase.workflow) ? workflows[phase.workflow] : null;
  if (!wf || !phase.steps.includes(step)) throw new Refusal(`phase ${phase.phase} has no step ${isName(step) ? step : "of that name"}; refusing`);
  const text = wf.stepText(step);
  const role = roleOf(manifest, text);
  if (role === "C") throw new Refusal("no reviewed phase sends a cancel: live cancellation is not approved (P1-P3 runbook §R 6), and no exception to the in-flight hold is defined; refusing");
  const plan = planFor(text, phase.target);
  if (plan.ref !== phase.ref || plan.template) throw new Refusal(`${text} does not plan to ${phase.ref}; refusing`);
  const markers = liveMarkers(paths, phaseId, role, now, identity);
  if (markers.length !== 1) throw new Refusal(`${markers.length} live ${role} windows are open for this phase; exactly one is needed; refusing`);
  const marker = markers[0];
  if (marker.head !== head || marker.ref !== phase.ref || marker.phaseSha !== sha || !(utcMs(marker.createdAt) <= now)) throw new Refusal(`marker ${marker.markerId} is not bound to this phase, head and ref; refusing`);
  const deadline = Math.min(utcMs(phase.deadline) - MARGIN_MS, utcMs(marker.until));
  if (!(now < deadline)) throw new Refusal(`the step's latest start ${iso(deadline)} has passed; refusing`);
  return withLock(paths, phase.ref, () => {
    const entries = readJournal(paths, phase.ref);
    const holds = holdsOf(entries, { readReceipt, ctxAt });
    if (holds.length) throw new Refusal(`the project is held: ${holds.map((h) => `${h.kind} ${h.attemptId.slice(0, 8)}: ${h.why}`).join("; ")}. A reviewed disposition (stage0-go.mjs dispose) releases it; refusing`);
    for (const f of listJson(paths.gos)) {
      let g = null;
      try { g = readState(join(paths.gos, f)); } catch { throw new Refusal(`an unreadable go ${f} is outstanding; refusing`); }
      if (!isObj(g) || g.ref !== phase.ref) continue;
      if (now < utcMs(g.deadline)) throw new Refusal(`go ${g.goId} (${g.step}) is outstanding until ${g.deadline}; it is used or voided first; refusing`);
      mkdirSync(paths.voided, { recursive: true });
      renameSync(join(paths.gos, f), join(paths.voided, f));
    }
    const gate = guardedProgress({ phase, entries, workflows, ctxAt, readReceipt, now });
    if (gate.stop || gate.complete || gate.next !== step) throw new Refusal(`the gate does not name ${step}: ${gate.stop ? `STOP: ${gate.reason}` : gate.complete ? gate.reason : `the next step is ${gate.next}`}; refusing`);
    const go = {
      schema: "stage0-go/1", goId: newId(), phaseId, phaseSha: sha, workflow: phase.workflow, phase: phase.phase, step, text,
      target: phase.target, ref: phase.ref, head, checkout, role, markerId: marker.markerId, issuedAt: iso(now), deadline: iso(deadline),
      request: { md5: plan.md5, bytes: plan.bytes, readOnly: plan.readOnly, endpoint: manifest.send.endpoint.replace("{ref}", plan.ref) },
      cancel: null,
      gate: { next: gate.next, after: entries.filter((e) => e.claim && e.claim.phaseId === phaseId).map((e) => e.attemptId) },
    };
    writeOnce(join(paths.gos, `${go.goId}.json`), go);
    return go;
  }, now);
}

/** Void an unused go (Claude). The go is kept in gos/void/. */
export function voidGo(paths, goId) {
  readGo(paths, goId);
  mkdirSync(paths.voided, { recursive: true });
  renameSync(join(paths.gos, `${goId}.json`), join(paths.voided, `${goId}.json`));
}

/**
 * Record a reviewed disposition of one held or pending attempt. The review
 * file must name the attempt id; its sha256 is recorded. That the file is a
 * genuine review is a human check.
 */
export function dispose({ paths, ref, attemptId, reviewedPath, reviewedBytes, now }) {
  if (!isId(attemptId)) throw new Refusal("not an attempt id; refusing");
  const e = readJournal(paths, ref).find((x) => x.attemptId === attemptId);
  if (!e) throw new Refusal(`attempt ${attemptId} is not in the ${ref} journal; refusing`);
  if (e.disposition) throw new Refusal(`attempt ${attemptId} already has a disposition; refusing`);
  if (!Buffer.isBuffer(reviewedBytes) || !reviewedBytes.toString("utf8").includes(attemptId)) throw new Refusal("the review file does not name the attempt id; refusing");
  const d = { schema: "stage0-disposition/1", attemptId, reviewed: { path: reviewedPath, sha256: sha256(reviewedBytes) }, recordedAt: iso(now) };
  writeOnce(join(paths.journal(ref), `${attemptId}.disposition.json`), d);
  return d;
}

// ── admission and the send (SG-1 to SG-5) ───────────────────────────────────

/**
 * Admit one live send and make it. Before any request, in order: the process
 * and the programs it starts; the checkout (clean, at a full commit); the
 * clock; the window (session value, exactly one marker, the same shell
 * process, the same token, the marker's head, ref and end); the text's role;
 * the go named by id (unused, this marker's, this phase's, step, text, head,
 * ref and request, issued before now, before its deadline). Under the
 * project lock: no pending or held attempt, and the gate names the go's step.
 * Then the go is moved to gos/used/ and the claim is written. Immediately
 * before fetch, inside send(), the deadline and the marker's end are checked
 * again; a failure there records NOT_SENT. After that point every failure is
 * AfterDispatch: the claim stays pending, which holds the project.
 *
 * `send(plan, {clock, admit})` is the sender's send(); `writeReceipt(record)`
 * writes the receipt and returns its path.
 */
export async function guardedSend(o) {
  const { plan, goId, token, env, manifest, root, now = Date.now, identity = shellIdentity, git = gitState, workflows = WORKFLOWS, ctxAt, readReceipt = RECEIPT_READER } = o;
  const paths = statePaths(o.stateDir || DEFAULT_STATE);
  const execArgv = o.execArgv || process.execArgv;
  const ppid = o.ppid ?? process.ppid;
  const selfStartMs = o.selfStartMs ?? Date.now() - process.uptime() * 1000;
  const t0 = now();
  const pre = [...processProblems({ execArgv, env }), ...plantedTools([root, process.cwd()])];
  if (pre.length) throw new Refusal(`${pre.join("; ")}; refusing`);
  const head = checkoutHead(git, root);
  checkClock(paths, t0);
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
  const request = { md5: plan.md5, bytes: plan.bytes, readOnly: plan.readOnly, endpoint: manifest.send.endpoint.replace("{ref}", plan.ref) };
  if (JSON.stringify(go.request) !== JSON.stringify(request) || plan.template !== null) throw new Refusal(`go ${goId}'s request is not this send's; refusing`);
  const issued = utcMs(go.issuedAt), dl = utcMs(go.deadline);
  if (!(utcMs(phase.recordedAt) <= created && created <= issued && issued <= t0)) throw new Refusal(`go ${goId} was issued later than now, or before its marker: the clock went back; refusing`);
  if (!(dl <= until && dl <= utcMs(phase.deadline) && issued < dl)) throw new Refusal(`go ${goId}'s deadline is after its marker's or phase's end; refusing`);
  if (!(t0 < dl)) throw new Refusal(`go ${goId}'s deadline ${go.deadline} has passed; refusing`);
  const claim = withLock(paths, plan.ref, () => {
    const t1 = now();
    const entries = readJournal(paths, plan.ref);
    const holds = holdsOf(entries, { readReceipt, ctxAt });
    if (holds.length) throw new Refusal(`the project is held: ${holds.map((h) => `${h.kind} ${h.attemptId.slice(0, 8)}: ${h.why}`).join("; ")}; refusing`);
    const gate = guardedProgress({ phase, entries, workflows, ctxAt, readReceipt, now: t1 });
    if (gate.stop || gate.next !== go.step) throw new Refusal(`the gate does not name ${go.step}: ${gate.stop ? `STOP: ${gate.reason}` : gate.complete ? gate.reason : `the next step is ${gate.next}`}; refusing`);
    if (!(t1 < dl && t1 < until)) throw new Refusal(`go ${goId}'s deadline ${go.deadline} has passed; refusing`);
    mkdirSync(paths.used, { recursive: true });
    try { renameSync(join(paths.gos, `${goId}.json`), join(paths.used, `${goId}.json`)); } catch { throw new Refusal(`go ${goId} was used by another command; refusing`); }
    const c = {
      schema: "stage0-claim/1", attemptId: newId(), seq: entries.reduce((n, e) => Math.max(n, e.claim ? e.claim.seq : 0), 0) + 1,
      goId, phaseId: phase.phaseId, step: go.step, text: plan.name, target: plan.target, ref: plan.ref, role, markerId: marker.markerId, shell,
      head, checkout: root, request, issuedAt: go.issuedAt, deadline: go.deadline, claimedAt: iso(t1),
    };
    try { writeOnce(join(paths.journal(plan.ref), `${c.attemptId}.claim.json`), c); } catch (e) { throw new Refusal(`go ${goId} is used, but its claim could not be written (${e.message}); nothing was sent; refusing`); }
    return c;
  }, t0);
  const journalFile = (kind) => join(paths.journal(plan.ref), `${claim.attemptId}.${kind}.json`);
  // The last check, called by send() after it builds the request and
  // immediately before fetch.
  const admit = () => {
    const t = now();
    let why = null;
    if (!(t < dl)) why = `go ${goId}'s deadline ${go.deadline} passed before the request`;
    else if (!(t < until)) why = `marker ${marker.markerId} ended before the request`;
    else { try { checkClock(paths, t); } catch (e) { why = e.message; } }
    if (why === null) return;
    try { writeOnce(journalFile("outcome"), { schema: "stage0-outcome/1", attemptId: claim.attemptId, state: "NOT_SENT", at: iso(t), reason: why.slice(0, 500) }); }
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
    writeOnce(journalFile("outcome"), { schema: "stage0-outcome/1", attemptId: claim.attemptId, state: "DISPATCHED", at: iso(now()), receipt: { file, sha256: sha256(buf), bytes: buf.length }, httpStatus: record.httpStatus });
  } catch (e) { throw new AfterDispatch(`the request was dispatched and its receipt written to ${file}, but its outcome could not be recorded (${e.message}); attempt ${claim.attemptId} stays pending: HOLD`); }
  return { record, file, attemptId: claim.attemptId, go, marker };
}

/** A summary of the guard state for one ref, for the status command. Read-only. */
export function status({ paths, ref, ctxAt, readReceipt = RECEIPT_READER, now }) {
  const entries = readJournal(paths, ref);
  const gos = [];
  for (const f of listJson(paths.gos)) { try { const g = readState(join(paths.gos, f)); if (isObj(g) && g.ref === ref) gos.push(g); } catch { gos.push({ goId: f, unreadable: true }); } }
  return {
    holds: holdsOf(entries, { readReceipt, ctxAt }),
    attempts: entries.map((e) => ({ attemptId: e.attemptId, seq: e.claim && e.claim.seq, step: e.claim && e.claim.step, state: e.outcome ? e.outcome.state : e.claim ? "PENDING" : "MALFORMED", disposed: Boolean(e.disposition) })),
    gos: gos.map((g) => ({ goId: g.goId, step: g.step, deadline: g.deadline, live: !g.unreadable && now < utcMs(g.deadline) })),
    markers: readMarkers(paths).map((e) => (e.marker ? { markerId: e.marker.markerId, role: e.marker.role, phaseId: e.marker.phaseId, until: e.marker.until, ref: e.marker.ref } : { malformed: e.problems[0] })),
    lock: existsSync(paths.lock(ref)),
  };
}
