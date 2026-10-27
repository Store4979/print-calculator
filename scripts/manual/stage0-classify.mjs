#!/usr/bin/env node
// scripts/manual/stage0-classify.mjs — rule 3′: how a stage-0 send's results
// file is classified (docs/security/stage0-item2-classifier-plan.md §3–§4;
// Codex item 2, incident review of 2026-10-12, §2).
//
// The input is a results file that the pinned sender
// (scripts/manual/stage0-send.mjs) wrote to .stage0-send/, read as its exact
// bytes, never a paste. In precedence order it is one of:
//   R1 UNRESOLVED   the file is not exactly one sender record, or the record
//                   does not bind to the pinned text it names;
//   R2 RESOLVED     success: HTTP 201 and the text's own success predicate;
//   R3 RESOLVED     SQL error: an observed status, a body that is exactly
//                   {"message": m}, and m inside the supported envelope grammar;
//   R4 UNRESOLVED   anything else.
//
// What a class does NOT say:
//   - R2 says the request executed and returned its contracted shape. It is
//     not acceptance and not a go. readbackAcceptance() is the separate check
//     of P0's and STATE's values;
//   - R3 is not permission to retry, not proof of an unchanged prefix and not
//     an automatic recovery;
//   - an UNRESOLVED writing send goes to the runbook's STOP-and-review.
// The result never carries a retry or recovery suggestion.
//
// The envelope grammar is an evidence-backed SUBSET of what PostgreSQL and the
// Management API can produce (SUPPORT below). An element is accepted only once
// a sender receipt shows it, in the form shown. Anything else is R4, however
// reasonable it looks. SUPPORT grows only in a reviewed capture commit, with
// the receipt as its fixture.
//
// It makes no network call, no database call and no write. Until item 6 the
// sender does not import it, and the sender's exit code (0 on any 201) is a
// transport fact, not a classification.
//
//   node scripts/manual/stage0-classify.mjs [--rev <commit>] <results file>…
//
// Exit status: 0 when every file is R2; 1 when some file is R3 and none is
// UNRESOLVED; 3 when any file is UNRESOLVED (R1 or R4); 2 when the files
// cannot be classified at all (usage, or the texts do not match the pins).
// None of these is a go: the class, and the runbook's semantic acceptance
// where one applies, decide the next step.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as A from "./assemble-stage0.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

// ── Strict JSON ──────────────────────────────────────────────────────────────

const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const NUMBER = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;

/**
 * JSON.parse that refuses what JSON.parse silently accepts or collapses: a
 * duplicate object key anywhere (JSON.parse keeps the last), nesting deeper
 * than maxDepth, and input longer than maxChars. Throws with the reason.
 */
export function strictJson(text, { maxChars = 64 * 1024 * 1024, maxDepth = 32 } = {}) {
  if (typeof text !== "string") throw new Error("not a string");
  if (text.length > maxChars) throw new Error(`longer than ${maxChars} characters`);
  let i = 0;
  const fail = (why) => { throw new Error(`${why} at offset ${i}`); };
  const ws = () => { while (i < text.length && " \t\n\r".includes(text[i])) i++; };
  const str = () => {
    const s = i++;
    while (i < text.length) {
      const c = text.charCodeAt(i);
      if (c === 0x22) { i++; return JSON.parse(text.slice(s, i)); }
      if (c === 0x5c) { i += 2; continue; }
      if (c < 0x20) fail("a control character in a string");
      i++;
    }
    return fail("an unterminated string");
  };
  const value = (depth) => {
    if (depth > maxDepth) fail(`nesting deeper than ${maxDepth}`);
    ws();
    const c = text[i];
    if (c === "{") {
      i++;
      const o = {};
      const seen = new Set();
      ws();
      if (text[i] === "}") { i++; return o; }
      for (;;) {
        ws();
        if (text[i] !== '"') fail("an object key that is not a string");
        const k = str();
        if (seen.has(k)) fail(`a duplicate key ${JSON.stringify(k)}`);
        seen.add(k);
        ws();
        if (text[i] !== ":") fail("a missing colon");
        i++;
        Object.defineProperty(o, k, { value: value(depth + 1), enumerable: true, writable: true, configurable: true });
        ws();
        if (text[i] === ",") { i++; continue; }
        if (text[i] === "}") { i++; return o; }
        fail("a missing comma or closing brace");
      }
    }
    if (c === "[") {
      i++;
      const a = [];
      ws();
      if (text[i] === "]") { i++; return a; }
      for (;;) {
        a.push(value(depth + 1));
        ws();
        if (text[i] === ",") { i++; continue; }
        if (text[i] === "]") { i++; return a; }
        fail("a missing comma or closing bracket");
      }
    }
    if (c === '"') return str();
    for (const [w, v] of [["true", true], ["false", false], ["null", null]]) if (text.startsWith(w, i)) { i += w.length; return v; }
    NUMBER.lastIndex = i;
    const n = NUMBER.exec(text);
    if (!n) fail("an invalid value");
    i = NUMBER.lastIndex;
    return Number(n[0]);
  };
  const v = value(0);
  ws();
  if (i !== text.length) fail("content after the value");
  return v;
}

// ── The context: the manifest, its texts and their executed inputs ──────────

/** The context to classify against: the manifest committed at `rev`. */
export function contextAt(rev = "HEAD", cwd = ROOT) {
  return contextFor(A.manifestAt(rev, cwd), { cwd });
}

/**
 * The context for a manifest object. Refuses when any assembled text differs
 * from its pin, or a PERFORM_QUERIES entry does not bind to its text.
 */
export function contextFor(manifest, opts = {}) {
  const texts = A.assembleAll(manifest, opts);
  for (const [k, pin] of Object.entries(manifest.outputs || {})) {
    if (typeof texts[k] !== "string" || A.md5(texts[k]) !== pin.md5 || Buffer.byteLength(texts[k]) !== pin.bytes) {
      throw new Error(`${k}: the assembled text does not match the manifest's pin; refusing to classify against it`);
    }
  }
  return { manifest, texts, inputs: A.executedInputs(manifest, opts), performs: performQueries(texts) };
}

// ── R1: the receipt is the sender's record, and it binds ────────────────────

/** The sender's record (stage0-send.mjs send()): these 14 keys, plus cancelTemplate for a cancel. */
export const RECEIPT_KEYS = ["tool", "text", "target", "ref", "readOnly", "requestMd5", "requestBytes", "endpoint", "startedAt", "finishedAt", "httpStatus", "body", "error", "tokenRedactedFromResponse"];
const ISO_MS = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/;
// Total: a form that parses to no time (month 13, hour 25) is false, never a
// throw. toISOString() is called only on a finite time (Codex, review of
// df401b3, K-R1).
const isIso = (s) => {
  if (typeof s !== "string" || !ISO_MS.test(s)) return false;
  const t = Date.parse(s);
  return Number.isFinite(t) && new Date(t).toISOString() === s;
};
const HEX32 = /^[0-9a-f]{32}$/;
const isPosInt = (n) => Number.isSafeInteger(n) && n > 0;
const FIELD_OK = {
  tool: (v) => typeof v === "string",
  text: (v) => typeof v === "string",
  target: (v) => typeof v === "string",
  ref: (v) => typeof v === "string",
  readOnly: (v) => typeof v === "boolean",
  requestMd5: (v) => typeof v === "string" && HEX32.test(v),
  requestBytes: isPosInt,
  endpoint: (v) => typeof v === "string",
  startedAt: isIso,
  finishedAt: isIso,
  httpStatus: (v) => v === null || (Number.isSafeInteger(v) && v >= 100 && v <= 599),
  body: (v) => v === null || typeof v === "string",
  error: (v) => v === null || typeof v === "string",
  tokenRedactedFromResponse: (v) => typeof v === "boolean",
};

/** Every reason the record is not a bound sender record (R1); empty when it is. */
export function receiptProblems(rec, ctx) {
  const out = [];
  if (!isPlainObject(rec)) return ["the file is not one JSON object"];
  const M = ctx.manifest;
  const policy = typeof rec.text === "string" && own(M.send.texts, rec.text) ? M.send.texts[rec.text] : null;
  const isCancel = Boolean(policy && policy.instantiate === "cancel");
  const keys = [...RECEIPT_KEYS, ...(own(rec, "cancelTemplate") ? ["cancelTemplate"] : [])];
  for (const k of RECEIPT_KEYS) if (!own(rec, k)) out.push(`the field ${k} is missing`);
  for (const k of Object.keys(rec)) if (!keys.includes(k)) out.push(`the field ${k} is not the sender's`);
  for (const [k, ok] of Object.entries(FIELD_OK)) if (own(rec, k) && !ok(rec[k])) out.push(`the field ${k} has the wrong type or form`);
  if (isIso(rec.startedAt) && isIso(rec.finishedAt) && rec.finishedAt < rec.startedAt) out.push("finishedAt is before startedAt");
  if (rec.error !== null && own(rec, "error")) out.push("the sender recorded a transport error");
  if (own(rec, "body") && typeof rec.body !== "string") out.push("there is no response body");
  if (rec.tokenRedactedFromResponse !== false) out.push("the response held the access token (tokenRedactedFromResponse is not false): STOP and delete the token now");
  // binding to the pinned text
  if (rec.tool !== M.sender.path) out.push(`tool is not ${M.sender.path}`);
  if (!policy) { out.push("the text is not in the manifest's send policy"); return out; }
  if (!policy.targets.includes(rec.target)) out.push(`the policy does not allow ${rec.text} on ${JSON.stringify(rec.target)}`);
  if (rec.ref !== M.send.targets[rec.target]) out.push("ref is not the target's project ref");
  if (rec.readOnly !== (policy.readOnly === true)) out.push("readOnly is not the policy's");
  if (rec.endpoint !== M.send.endpoint.replace("{ref}", rec.ref)) out.push("endpoint is not the policy's endpoint for that ref");
  const pin = M.outputs[rec.text];
  if (!isCancel) {
    if (own(rec, "cancelTemplate")) out.push("cancelTemplate is present on a text that is not a cancel template");
    if (rec.requestMd5 !== pin.md5 || rec.requestBytes !== pin.bytes) out.push("requestMd5/requestBytes are not the pinned text's");
    return out;
  }
  // A cancel instance: its request is the instantiated SQL, not the template.
  const ct = rec.cancelTemplate;
  if (!isPlainObject(ct)) { out.push("a cancel has no cancelTemplate object"); return out; }
  if (JSON.stringify(Object.keys(ct).sort()) !== JSON.stringify(["backendStart", "bytes", "md5", "step"])) out.push("cancelTemplate does not have exactly md5, bytes, step, backendStart");
  if (ct.md5 !== pin.md5 || ct.bytes !== pin.bytes) out.push("cancelTemplate md5/bytes are not the pinned template's");
  if (typeof ct.step !== "string" || !A.CANCEL_TARGETS.includes(`release2-stage0-${ct.step}`)) out.push("cancelTemplate.step is not a stage-0 step");
  if (typeof ct.backendStart !== "string" || !A.BACKEND_START_RE.test(ct.backendStart)) out.push("cancelTemplate.backendStart is not in CANCEL-INSPECT's format");
  let inst = null;
  try { inst = A.cancelStepText(ctx.texts[rec.text], ct.step, ct.backendStart); } catch { /* the reasons above say why */ }
  if (inst === null || A.md5(inst) !== rec.requestMd5 || Buffer.byteLength(inst) !== rec.requestBytes) out.push("requestMd5/requestBytes are not the instance the reviewed assembler builds from the template, step and backendStart");
  return out;
}

// ── R2: success predicates, from each text's reviewed SQL and held receipts ──

const SET_CONFIG_45S = '[{"set_config":"45s"}]';
const typeOk = {
  bool: (v) => typeof v === "boolean",
  int: (v) => Number.isSafeInteger(v) && v >= 0,
  text: (v) => typeof v === "string",
  md5: (v) => typeof v === "string" && HEX32.test(v),
  version: (v) => typeof v === "string" && /^[0-9]{14}$/.test(v),
  uuids: (v) => Array.isArray(v) && v.every((x) => typeof x === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(x)),
  textsOrNull: (v) => Array.isArray(v) && v.every((x) => x === null || typeof x === "string"),
};
/** P0's 26 columns and their JSON types (the P0 SQL in assemble-stage0.mjs; the three held P0 receipts). */
export const P0_COLUMNS = {
  has_store_role: "bool", organizations: "bool", stores_org_id: "bool", stores_without_org: "int", stores_without_org_ids: "uuids",
  uniq_already_there: "bool", release2_tables_present: "int", release2_functions_present: "int", catalog_fingerprint: "md5",
  probe_slug_absent: "bool", nil_job_absent: "bool", auth_users_user_triggers: "int", free_pins: "int", server_version_num: "int",
  pg17_hard_timer: "bool", ledger_head: "version", ledger_rows: "int", ledger_matches_repo: "bool", release2_in_ledger: "int",
  ledger_columns: "text", ledger_columns_as_pinned: "bool", ledger_created_by: "textsOrNull", ledger_rows_single_element: "bool",
  production_ledger_marker: "bool", staging_seed_absent: "bool", production_store_present: "bool",
};
const sameKeys = (o, keys) => isPlainObject(o) && JSON.stringify(Object.keys(o).sort()) === JSON.stringify([...keys].sort());
const parsed = (body) => { try { return { v: strictJson(body, { maxChars: 1 << 20 }) }; } catch (e) { return { why: `the body is not JSON without duplicate keys: ${e.message}` }; } };
const oneRow = (body, keys) => {
  const p = parsed(body);
  if (p.why) return p;
  if (!Array.isArray(p.v) || p.v.length !== 1) return { why: "the body is not an array of exactly one row" };
  if (!sameKeys(p.v[0], keys)) return { why: "the row does not have exactly the contracted columns" };
  return { row: p.v[0] };
};
const exact = (want) => (body) => (body === want ? { ok: true } : { ok: false, why: `the body is not exactly ${want}` });
const unsupported = (why) => ({ kind: "unsupported", why });
const P2_SOURCE = "the wrapper's last row-returning statement, set_config('transaction_timeout', '45s', true); P2-01 send 1 (production, 2026-10-09T15:17:05.343Z)";

/**
 * Each sendable text's success predicate, keyed by text name. The binding
 * test requires exactly the manifest's send policy, both ways. A text that is
 * "unsupported" has no reviewed receipt of success yet: its 201 is R4.
 */
export const SUCCESS = {
  P0: {
    kind: "p0",
    source: "the P0 SQL (assemble-stage0.mjs p0()); P0 receipts 2026-10-07T15:21:44.109Z, 2026-10-09T01:24:24.192Z, 2026-10-09T01:32:00.580Z",
    check: (body) => {
      const r = oneRow(body, Object.keys(P0_COLUMNS));
      if (r.why) return { ok: false, why: r.why };
      const bad = Object.entries(P0_COLUMNS).filter(([k, t]) => !typeOk[t](r.row[k])).map(([k]) => k);
      return bad.length ? { ok: false, why: `columns of the wrong JSON type: ${bad.join(", ")}` } : { ok: true, values: r.row };
    },
  },
  P1: {
    kind: "p1",
    source: "the proofs' final select n, what from stage0_proof order by n; P1 receipt 2026-10-09T01:30:25.743Z; P1-P3 runbook 5.3",
    check: (body) => {
      const p = parsed(body);
      if (p.why) return { ok: false, why: p.why };
      if (!Array.isArray(p.v) || p.v.length !== 45) return { ok: false, why: "the body is not an array of exactly 45 rows" };
      if (!p.v.every((r) => sameKeys(r, ["n", "what"]) && typeof r.n === "string" && typeof r.what === "string")) return { ok: false, why: "a row is not exactly {n: string, what: string}" };
      if (new Set(p.v.map((r) => r.n)).size !== 45) return { ok: false, why: "the ids are not 45 distinct values" };
      const lines = [...p.v].sort((a, b) => (a.n < b.n ? -1 : a.n > b.n ? 1 : 0)).map((r) => `${r.n}\t${r.what}\n`).join("");
      return A.md5(lines) === "5983d4a7f104692cc90e0004da21efa9" ? { ok: true } : { ok: false, why: "the rows, sorted by n as n<TAB>what<LF>, do not have md5 5983d4a7f104692cc90e0004da21efa9" };
    },
  },
  "SIZE-PROBE": {
    kind: "size-probe",
    source: "the SIZE-PROBE SQL; manifest sizeProbe.expect; receipt 2026-10-07T00:11:42.130Z (staging)",
    check: (body, ctx) => {
      const r = oneRow(body, ["probe_bytes", "probe_md5"]);
      if (r.why) return { ok: false, why: r.why };
      const e = ctx.manifest.sizeProbe.expect;
      return r.row.probe_bytes === e.probe_bytes && r.row.probe_md5 === e.probe_md5 ? { ok: true } : { ok: false, why: "the probe's answer is not the pinned one" };
    },
  },
  STATE: {
    kind: "state",
    source: "the STATE SQL (assemble-stage0.mjs stateReadback()); STATE receipts 2026-10-09T01:32:05.922Z and 2026-10-13T16:02:46.359Z",
    check: (body) => {
      const r = oneRow(body, ["effective_prefix", "ledger_md5_ok", "catalog_state", "ledger_rows", "recovery"]);
      if (r.why) return { ok: false, why: r.why };
      const s = r.row;
      if (typeof s.effective_prefix !== "string" || !/^(0[1-5](,0[1-5])*)?$/.test(s.effective_prefix)) return { ok: false, why: "effective_prefix is not a comma list of 01-05" };
      if (typeof s.ledger_md5_ok !== "boolean") return { ok: false, why: "ledger_md5_ok is not a boolean" };
      if (!["00", "01", "02", "03", "04", "05", "unrecognized"].includes(s.catalog_state)) return { ok: false, why: "catalog_state is not one of 00-05 or unrecognized" };
      const rowsOk = Array.isArray(s.ledger_rows) && s.ledger_rows.length === 5 && s.ledger_rows.every((x, i) => sameKeys(x, ["n", "forward", "rollback"])
        && x.n === `0${i + 1}` && (x.forward === null || typeOk.version(x.forward)) && (x.rollback === null || typeOk.version(x.rollback)));
      if (!rowsOk) return { ok: false, why: "ledger_rows is not five {n, forward, rollback} rows for 01-05" };
      if (typeof s.recovery !== "string") return { ok: false, why: "recovery is not a string" };
      return { ok: true, values: s };
    },
  },
  ...Object.fromEntries(["P2-01", "P2-02", "P2-0304", "P2-05", "RB-5", "RB-43", "RB-2", "RB-1"].map((k) => [k, { kind: "exact", source: P2_SOURCE, check: exact(SET_CONFIG_45S) }])),
  "CANCEL-INSPECT": unsupported("no reviewed receipt of its success yet"),
  "CANCEL-STEP-TEMPLATE": unsupported("no reviewed receipt of its success yet"),
  // The four lock-probe texts the capture session expects to succeed. Each
  // predicate is declared before the run from the text's SQL result contract
  // (Codex: "define the supported expected successes before the run"); the
  // JSON types follow the held receipts (count -> number, boolean -> boolean,
  // json -> nested JSON). The other lock-probe texts stay unsupported.
  "LOCKPROBE-SETUP": { kind: "exact", source: "its last row-returning statement, select 'stage0_lockprobe ready' as setup", check: exact('[{"setup":"stage0_lockprobe ready"}]') },
  "LOCKPROBE-B-POSITIVE": { kind: "exact", source: `the P2 wrapper pattern: ${P2_SOURCE}`, check: exact(SET_CONFIG_45S) },
  "LOCKPROBE-CLEANUP": {
    kind: "exact",
    source: "its last row-returning statement: schema_gone, then three counts",
    check: exact('[{"schema_gone":true,"relations_left":0,"probe_locks_left":0,"probe_backends_active":0}]'),
  },
  "LOCKPROBE-READBACK": {
    kind: "shape",
    source: "the READBACK SQL: five columns, three of them json_agg arrays; the values are the capture step's to check",
    check: (body) => {
      const r = oneRow(body, ["ddl_committed", "ledger", "locks", "lockprobe_backends", "read_at"]);
      if (r.why) return { ok: false, why: r.why };
      const x = r.row;
      const str = (v) => typeof v === "string";
      const strOrNull = (v) => v === null || typeof v === "string";
      const each = (a, keys, ok) => Array.isArray(a) && a.every((o) => sameKeys(o, keys) && ok(o));
      if (typeof x.ddl_committed !== "boolean") return { ok: false, why: "ddl_committed is not a boolean" };
      if (!each(x.ledger, ["version", "name", "n", "md5", "created_by"], (o) => typeOk.version(o.version) && str(o.name) && typeOk.int(o.n) && typeOk.md5(o.md5) && strOrNull(o.created_by))) return { ok: false, why: "ledger is not an array of {version, name, n, md5, created_by}" };
      if (!each(x.locks, ["pid", "mode", "granted", "app"], (o) => typeOk.int(o.pid) && str(o.mode) && typeof o.granted === "boolean" && strOrNull(o.app))) return { ok: false, why: "locks is not an array of {pid, mode, granted, app}" };
      if (!each(x.lockprobe_backends, ["pid", "app", "state", "xact_start", "backend_start"], (o) => typeOk.int(o.pid) && str(o.app) && strOrNull(o.state) && strOrNull(o.xact_start) && strOrNull(o.backend_start))) return { ok: false, why: "lockprobe_backends is not an array of {pid, app, state, xact_start, backend_start}" };
      if (!str(x.read_at)) return { ok: false, why: "read_at is not a string" };
      return { ok: true, values: x };
    },
  },
  ...Object.fromEntries(["HOLD", "B-LOCKTIMEOUT", "B-STMTTIMEOUT", "B-TXTIMEOUT", "B-CANCEL", "C-CANCEL"]
    .map((k) => [`LOCKPROBE-${k}`, unsupported("not expected to succeed in the capture session; no reviewed receipt of its success")])),
  ...Object.fromEntries([1, 2, 3, 4, 5].map((n) => [`ENVELOPE-PROBE-${n}`, unsupported("an error probe: a 201 is not its contract")])),
};

/** P0's identity and timer columns, which must hold whatever the expected values. */
const P0_INVARIANTS = { pg17_hard_timer: true, ledger_columns_as_pinned: true, ledger_rows_single_element: true, production_ledger_marker: true, staging_seed_absent: true, production_store_present: true };

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The runbook's semantic check of an R2 read-back, kept apart from the
 * classifier (Codex: success is not acceptance). `values` is an R2 result's
 * row; `expected` names the values the runbook expects, column by column.
 * Returns ACCEPT or STOP with its reasons. It is never a go on its own.
 */
export function readbackAcceptance(text, values, expected) {
  const reasons = [];
  if (text !== "P0" && text !== "STATE") return { verdict: "STOP", reasons: [`${text} has no read-back acceptance`] };
  if (!isPlainObject(values)) return { verdict: "STOP", reasons: ["no read-back values (not an R2 result)"] };
  if (!isPlainObject(expected) || !Object.keys(expected).length) return { verdict: "STOP", reasons: ["no expected values were given"] };
  for (const [k, want] of Object.entries(expected)) {
    if (!own(values, k)) reasons.push(`${k} is not a column of ${text}`);
    else if (!same(values[k], want)) reasons.push(`${k} is ${JSON.stringify(values[k])}, expected ${JSON.stringify(want)}`);
  }
  if (text === "P0") {
    for (const [k, want] of Object.entries(P0_INVARIANTS)) if (values[k] !== want) reasons.push(`${k} is ${JSON.stringify(values[k])}; P0 requires ${want}`);
  } else {
    if (values.ledger_md5_ok !== true) reasons.push("ledger_md5_ok is not true");
    const r = A.RECOVERY.find((x) => x.prefix.join(",") === values.effective_prefix);
    const want = r ? r.ops.join(", ") || "none — nothing is applied" : null;
    if (!r) reasons.push(`no reviewed recovery for prefix ${JSON.stringify(values.effective_prefix)}`);
    else {
      if (values.catalog_state !== r.state) reasons.push(`catalog_state is ${JSON.stringify(values.catalog_state)}; prefix ${JSON.stringify(values.effective_prefix)} needs ${r.state}`);
      if (values.recovery !== want) reasons.push(`recovery is ${JSON.stringify(values.recovery)}; prefix ${JSON.stringify(values.effective_prefix)} has ${JSON.stringify(want)}`);
    }
  }
  return { verdict: reasons.length ? "STOP" : "ACCEPT", reasons };
}

// ── R3: the supported envelope grammar ───────────────────────────────────────

const P2_01_SEND_2 = "P2-01 send 2, production, 2026-10-09T15:17:50.900Z (scripts/tests/fixtures/stage0-classify/real/)";
// The item 2 capture's sender receipts on staging, in the same fixture
// directory (plan §E14; Codex's capture review of 2026-10-23, §2).
const CAPTURE = (step, text, at) => `capture ${step}, ${text}, staging, ${at} (scripts/tests/fixtures/stage0-classify/real/)`;
const B1 = CAPTURE("B1", "ENVELOPE-PROBE-1", "2026-10-22T15:35:38.187Z");
const B2 = CAPTURE("B2", "ENVELOPE-PROBE-2", "2026-10-22T15:43:05.120Z");
const B3 = CAPTURE("B3", "ENVELOPE-PROBE-3", "2026-10-22T15:43:57.386Z");
const B4 = CAPTURE("B4", "ENVELOPE-PROBE-4", "2026-10-22T15:44:50.624Z");
const A2 = CAPTURE("A2", "LOCKPROBE-B-LOCKTIMEOUT", "2026-10-22T16:41:36.172Z");
const A3 = CAPTURE("A3", "LOCKPROBE-B-STMTTIMEOUT", "2026-10-22T16:45:58.150Z");
const T2 = CAPTURE("T2", "LOCKPROBE-B-TXTIMEOUT", "2026-10-23T15:31:55.289Z");

/** The HTTP statuses an SQL error has been seen under, through the sender. */
export const OBSERVED_STATUSES = Object.freeze({ 400: `${P2_01_SEND_2}; and all eight capture errors (B1-B5, A2, A3 and T2)` });

/**
 * The elements the envelope parser accepts, each with the sender receipt
 * that shows it. A missing or null entry is not accepted. Accepting each
 * element is not enough for R3: the whole envelope must also be one of
 * PROFILES, the combinations a receipt shows. Not accepted at all: QUERY, a
 * LINE position block (B3 and B5 show its rendering; it stays unsupported),
 * a frame of another kind (B3's "JSON data"), and any other function name or
 * statement kind.
 */
export const SUPPORT = Object.freeze({
  severities: Object.freeze({ ERROR: P2_01_SEND_2, FATAL: T2 }),
  fieldless: B1,
  fields: Object.freeze({ DETAIL: `${B4}; also ${B3}`, HINT: B4, CONTEXT: P2_01_SEND_2 }),
  frames: Object.freeze({
    plpgsql: Object.freeze({
      fnames: Object.freeze({ inline_code_block: P2_01_SEND_2 }),
      stmts: Object.freeze({ RAISE: P2_01_SEND_2, EXECUTE: B2, PERFORM: T2 }),
    }),
    sqlstmt: B2,
  }),
});

/**
 * The statement kinds whose frame follows the "SQL statement" frame of the
 * query they ran, and the candidate each one quotes: EXECUTE an executed
 * input (assemble-stage0.mjs executedInputs()), PERFORM its own query
 * (PERFORM_QUERIES). B2 and T2 show each pair.
 */
const RUNS_SQL = Object.freeze(["EXECUTE", "PERFORM"]);

/**
 * The query each bound PERFORM runs, per text, as its frame quotes it. T2
 * shows `perform pg_sleep(30);` quoted as `SELECT pg_sleep(30)`. An entry
 * binds one text's one PERFORM source to the query its receipt shows; the
 * query is not derived from the source. There is no generic rule: the query
 * is a candidate for its own text only, and another PERFORM (P1's, RB-43's,
 * CANCEL-STEP-TEMPLATE's) needs its own reviewed entry and receipt (Codex,
 * capture review §2). performQueries() refuses an entry whose source is not
 * in its pinned text exactly once.
 */
export const PERFORM_QUERIES = Object.freeze({
  "LOCKPROBE-B-TXTIMEOUT": Object.freeze([Object.freeze({ source: "perform pg_sleep(30);", query: "SELECT pg_sleep(30)", witness: T2 })]),
});

/** Each text's bound PERFORM queries, checked against the assembled texts. Throws on an unbound entry. */
export function performQueries(texts) {
  const out = {};
  for (const [k, list] of Object.entries(PERFORM_QUERIES)) {
    if (typeof texts[k] !== "string") throw new Error(`PERFORM_QUERIES names ${k}, which is not an assembled text`);
    out[k] = list.map(({ source, query }) => {
      if (texts[k].split(source).length !== 2) throw new Error(`${k}: the PERFORM source ${JSON.stringify(source)} is not in the pinned text exactly once`);
      return query;
    });
  }
  return out;
}

/**
 * The envelope structures rule 3′ resolves: each is a whole combination a
 * sender receipt shows (Codex's review of 95ecd65, C-COMB). A parsed envelope
 * is R3 only when its severity, its ordered fields and its ordered frames,
 * frame count included, are exactly one profile's. The supported elements in
 * any other combination are R4. The list is written out: it is not generated
 * from SUPPORT, and a new profile needs its own receipt and review.
 *   - The transaction-timeout profile also binds its SQLSTATE and its one
 *     PERFORM: that query, under that text.
 *   - The other profiles take any SQLSTATE, primary text and line number,
 *     each within the parser's bounds.
 */
export const PROFILES = Object.freeze([
  Object.freeze({ name: "field-less", severity: "ERROR", fields: Object.freeze([]), frames: Object.freeze([]), witness: B1 }),
  Object.freeze({ name: "re-raised", severity: "ERROR", fields: Object.freeze(["CONTEXT"]), frames: Object.freeze(["PL/pgSQL inline_code_block at RAISE"]), witness: `${P2_01_SEND_2}; ${A2}; ${A3}` }),
  Object.freeze({ name: "detail/hint re-raised", severity: "ERROR", fields: Object.freeze(["DETAIL", "HINT", "CONTEXT"]), frames: Object.freeze(["PL/pgSQL inline_code_block at RAISE"]), witness: B4 }),
  Object.freeze({ name: "executed input", severity: "ERROR", fields: Object.freeze(["CONTEXT"]), frames: Object.freeze(["SQL statement via EXECUTE", "PL/pgSQL inline_code_block at EXECUTE"]), witness: B2 }),
  Object.freeze({
    name: "transaction-timeout PERFORM", severity: "FATAL", sqlstate: "25P04", fields: Object.freeze(["CONTEXT"]),
    frames: Object.freeze(["SQL statement via PERFORM", "PL/pgSQL inline_code_block at PERFORM"]),
    perform: Object.freeze({ text: "LOCKPROBE-B-TXTIMEOUT", query: "SELECT pg_sleep(30)" }), witness: T2,
  }),
]);

/** A parsed envelope's structure: its fields and its frames, in order. */
export function structureOf(sqlError) {
  return {
    fields: FIELD_ORDER.filter((f) => (f === "CONTEXT" ? sqlError.context.length > 0 : own(sqlError, f.toLowerCase()))),
    frames: sqlError.context.map((f) => (f.kind === "sqlstmt" ? `SQL statement via ${f.via}` : `PL/pgSQL ${f.fname} at ${f.stmt}`)),
  };
}

/** The one profile a parsed envelope of `text` is: {ok: true, profile} or {ok: false, why}. */
export function matchProfile(sqlError, text) {
  const { fields, frames } = structureOf(sqlError);
  const quoted = (sqlError.context.find((f) => f.kind === "sqlstmt") || {}).md5;
  const hits = PROFILES.filter((p) => p.severity === sqlError.severity
    && (p.sqlstate === undefined || p.sqlstate === sqlError.sqlstate)
    && same(p.fields, fields)
    && same(p.frames, frames)
    && (!p.perform || (p.perform.text === text && quoted === A.md5(p.perform.query))));
  if (hits.length === 1) return { ok: true, profile: hits[0].name };
  return { ok: false, why: `${hits.length ? "more than one profile" : "no witnessed profile"} is ${sqlError.severity} ${sqlError.sqlstate} with fields [${fields.join(", ")}] and frames [${frames.join("; ")}] under ${text}` };
}

/** A text's statement-frame candidates: what its EXECUTEs run, then its bound PERFORM queries. */
export function candidatesFor(ctx, text) {
  return [
    ...(ctx.inputs[text] || []).map((sql) => ({ sql, via: "EXECUTE" })),
    ...((ctx.performs && ctx.performs[text]) || []).map((sql) => ({ sql, via: "PERFORM" })),
  ];
}

export const ENVELOPE_PREFIX = "Failed to run sql query: ";
export const LIMITS = Object.freeze({ envelope: 64 * 1024, text: 8 * 1024, frames: 16, lineDigits: 6 });
const FIELD_ORDER = ["DETAIL", "HINT", "QUERY", "CONTEXT"];

/**
 * Parse an error message m left to right against the supported grammar:
 *   m        := "Failed to run sql query: " severity ":  " sqlstate ": " text "\n" fields
 *   fields   := [DETAIL] [HINT] [QUERY] [CONTEXT], in this order, each at most once
 *   CONTEXT  := "CONTEXT:  " frame ("\n" frame)* "\n", and nothing after it
 *   frame    := "PL/pgSQL function " fname " line " digits " at " stmt
 *             | "SQL statement \"" <a complete candidate> "\""
 * Every element must also be in `support`. `candidates` are {sql, via}
 * (candidatesFor()). A SQL statement frame is matched against complete
 * candidates before any closing quote is read, and the next frame must be a
 * PL/pgSQL frame at the candidate's `via` statement. An EXECUTE or PERFORM
 * frame must follow such a statement frame. Returns {ok: true, sqlError} or
 * {ok: false, why}.
 */
export function parseEnvelope(m, { candidates = [], support = SUPPORT } = {}) {
  const no = (why) => ({ ok: false, why });
  if (typeof m !== "string") return no("the message is not a string");
  const maxInput = candidates.reduce((a, c) => Math.max(a, c.sql.length), 0);
  if (m.length > maxInput + LIMITS.envelope) return no(`the message is longer than the bound ${maxInput + LIMITS.envelope}`);
  let i = 0;
  const at = (s) => m.startsWith(s, i);
  const line = () => {
    const e = m.indexOf("\n", i);
    if (e < 0) return null;
    const t = m.slice(i, e);
    i = e + 1;
    return t;
  };
  if (!at(ENVELOPE_PREFIX)) return no("the message does not start with the API's prefix");
  i += ENVELOPE_PREFIX.length;
  const sev = ["ERROR", "FATAL"].find((s) => at(`${s}:  `));
  if (!sev) return no("no ERROR or FATAL followed by a colon and two spaces");
  if (!support.severities[sev]) return no(`severity ${sev} is not supported yet (no sender capture shows it)`);
  i += sev.length + 3;
  const state = m.slice(i, i + 5);
  if (!/^[0-9A-Z]{5}$/.test(state) || !m.startsWith(": ", i + 5)) return no("no five-character SQLSTATE [0-9A-Z] followed by a colon and a space");
  i += 7;
  const primary = line();
  if (primary === null) return no("the primary line does not end in a newline");
  if (!primary.length || primary.length > LIMITS.text) return no("the primary text is empty or longer than 8 KiB");
  const err = { severity: sev, sqlstate: state, primary, context: [] };
  let next = 0;
  let fields = 0;
  while (i < m.length) {
    const k = FIELD_ORDER.findIndex((f) => at(`${f}:  `));
    if (k < 0 && at("LINE ")) return no("a LINE position block is not supported (B3 and B5 show its rendering; it stays unsupported)");
    if (k < 0) return no("an unknown label, or content after the last field");
    if (k < next) return no(`${FIELD_ORDER[k]} is out of order or repeated`);
    const f = FIELD_ORDER[k];
    if (!support.fields[f]) return no(`the field ${f} is not supported yet (no sender capture shows it)`);
    next = k + 1;
    fields++;
    i += f.length + 3;
    if (f !== "CONTEXT") {
      const t = line();
      if (t === null || !t.length || t.length > LIMITS.text) return no(`${f} is empty, unterminated or longer than 8 KiB`);
      err[f.toLowerCase()] = t;
      continue;
    }
    let ran = null; // the `via` of the statement frame just read, until its PL/pgSQL frame
    for (;;) {
      if (err.context.length >= LIMITS.frames) return no(`more than ${LIMITS.frames} frames`);
      const fr = frame();
      if (!fr.ok) return fr;
      const fx = fr.frame;
      if (fx.kind === "sqlstmt") {
        if (ran) return no("a SQL statement frame where the PL/pgSQL frame of the statement that ran the previous one belongs");
        ran = fx.via;
      } else if (ran) {
        if (fx.stmt !== ran) return no(`the frame after a SQL statement frame is at ${fx.stmt}, not at the ${ran} that ran that candidate`);
        ran = null;
      } else if (RUNS_SQL.includes(fx.stmt)) {
        return no(`a frame at ${fx.stmt} without the SQL statement frame of the query it ran`);
      }
      err.context.push(fx);
      if (i === m.length) break;
    }
    if (ran) return no("a SQL statement frame with no PL/pgSQL frame after it");
  }
  if (!fields && !support.fieldless) return no("a field-less envelope is not supported yet (no sender capture shows it)");
  return { ok: true, sqlError: err };

  function frame() {
    const PL = "PL/pgSQL function ";
    const SQ = 'SQL statement "';
    if (at(PL)) {
      const pl = support.frames.plpgsql;
      if (!pl) return no("a PL/pgSQL frame is not supported yet");
      i += PL.length;
      const fname = Object.keys(pl.fnames).find((f) => at(`${f} line `));
      if (!fname) return no("a PL/pgSQL frame whose function is not a supported name");
      i += fname.length + " line ".length;
      let d = 0;
      while (d < LIMITS.lineDigits + 1 && /[0-9]/.test(m[i + d] || "")) d++;
      if (d < 1 || d > LIMITS.lineDigits || !m.startsWith(" at ", i + d)) return no("a PL/pgSQL frame without 1-6 line digits and \" at \"");
      const lineNo = Number(m.slice(i, i + d));
      i += d + " at ".length;
      const stmt = Object.keys(pl.stmts).find((s) => m.startsWith(`${s}\n`, i));
      if (!stmt) return no("a PL/pgSQL frame at a statement kind that is not supported");
      i += stmt.length + 1;
      return { ok: true, frame: { kind: "plpgsql", fname, line: lineNo, stmt } };
    }
    if (at(SQ)) {
      if (!support.frames.sqlstmt) return no("a SQL statement frame is not supported yet (no sender capture shows its rendering)");
      const start = i + SQ.length;
      const hits = candidates.map((c, n) => ({ c, n })).filter(({ c }) => m.startsWith(`${c.sql}"\n`, start));
      if (hits.length !== 1) return no(hits.length ? "a SQL statement frame that matches more than one candidate input" : "a SQL statement frame that quotes no complete input of the bound text");
      i = start + hits[0].c.sql.length + 2;
      return { ok: true, frame: { kind: "sqlstmt", via: hits[0].c.via, input: hits[0].n, md5: A.md5(hits[0].c.sql) } };
    }
    return no("a frame of a kind that is not supported");
  }
}

// ── The classifier ───────────────────────────────────────────────────────────

const summary = (rec) => (isPlainObject(rec) ? { text: rec.text, target: rec.target, httpStatus: rec.httpStatus } : {});

/**
 * Classify a results file's exact text against a context (contextAt /
 * contextFor). It returns a classification for any input: an exception
 * inside it is reported as R1 UNRESOLVED with its message, so a defect here
 * stops the runbook instead of crashing it.
 */
export function classifyText(fileText, ctx) {
  try { return classifyChecked(fileText, ctx); } catch (e) {
    return { class: "R1", outcome: "UNRESOLVED", reasons: [`the classifier could not complete (${e && e.name}: ${e && e.message}); a tooling defect, for review`], writing: null };
  }
}

function classifyChecked(fileText, ctx) {
  let rec;
  try { rec = strictJson(fileText); } catch (e) {
    return { class: "R1", outcome: "UNRESOLVED", reasons: [`the file is not exactly one JSON document: ${e.message}`] };
  }
  const r1 = receiptProblems(rec, ctx);
  const writing = isPlainObject(rec) && own(ctx.manifest.send.texts, rec.text) ? ctx.manifest.send.texts[rec.text].readOnly !== true : null;
  const base = { ...summary(rec), writing };
  if (r1.length) return { class: "R1", outcome: "UNRESOLVED", reasons: r1, ...base, tokenExposed: isPlainObject(rec) && rec.tokenRedactedFromResponse !== false };
  if (rec.httpStatus === 201) {
    const s = SUCCESS[rec.text];
    if (!s) return { class: "R4", outcome: "UNRESOLVED", reasons: [`${rec.text} has no success predicate entry`], ...base };
    if (s.kind === "unsupported") return { class: "R4", outcome: "UNRESOLVED", reasons: [`a 201 for ${rec.text}, which has no supported success predicate: ${s.why}`], ...base };
    const r = s.check(rec.body, ctx);
    if (r.ok) return { class: "R2", outcome: "RESOLVED success", reasons: [], ...base, ...(r.values ? { values: r.values } : {}) };
    return { class: "R4", outcome: "UNRESOLVED", reasons: [`a 201 that is not ${rec.text}'s contracted success: ${r.why}`], ...base };
  }
  if (own(OBSERVED_STATUSES, rec.httpStatus)) {
    const p = parsed(rec.body);
    if (p.why) return { class: "R4", outcome: "UNRESOLVED", reasons: [p.why], ...base };
    if (!sameKeys(p.v, ["message"]) || typeof p.v.message !== "string") return { class: "R4", outcome: "UNRESOLVED", reasons: ['the body is not exactly {"message": <string>}'], ...base };
    const env = parseEnvelope(p.v.message, { candidates: candidatesFor(ctx, rec.text) });
    if (!env.ok) return { class: "R4", outcome: "UNRESOLVED", reasons: [`not a supported SQL-error envelope: ${env.why}`], ...base };
    const prof = matchProfile(env.sqlError, rec.text);
    if (!prof.ok) return { class: "R4", outcome: "UNRESOLVED", reasons: [`supported elements in a combination no receipt shows: ${prof.why}`], ...base };
    return { class: "R3", outcome: "RESOLVED SQL error", reasons: [], ...base, sqlError: env.sqlError, profile: prof.profile };
  }
  return { class: "R4", outcome: "UNRESOLVED", reasons: [`HTTP ${rec.httpStatus ?? "none"} is neither a success nor an observed SQL-error status`], ...base };
}

/** One printed line per classification. */
export function describe(c, file) {
  const head = `${c.class} ${c.outcome} | ${c.text ?? "?"} -> ${c.target ?? "?"} | HTTP ${c.httpStatus ?? "none"}`;
  const tail = c.class === "R3" ? `${c.sqlError.severity} ${c.sqlError.sqlstate}: ${c.sqlError.primary}` : c.reasons.join("; ") || "contracted success";
  return `${head} | ${tail} | ${file}`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  let rev = "HEAD";
  const r = args.indexOf("--rev");
  if (r >= 0) { rev = args[r + 1]; args.splice(r, 2); }
  if (!args.length || args.some((a) => a.startsWith("-"))) {
    process.stderr.write("usage: stage0-classify.mjs [--rev <commit>] <results file>...\n");
    process.exit(2);
  }
  let ctx;
  try { ctx = contextAt(rev, ROOT); } catch (e) { process.stderr.write(`stage0-classify: ${e.message}\n`); process.exit(2); }
  let worst = 0;
  for (const f of args) {
    let text = null;
    try { text = readFileSync(f, "utf8"); } catch (e) { /* missing or unreadable: R1 */ }
    const c = text === null ? { class: "R1", outcome: "UNRESOLVED", reasons: ["the results file is missing or unreadable"] } : classifyText(text, ctx);
    process.stdout.write(describe(c, f) + "\n");
    if (c.tokenExposed) process.stdout.write("  STOP: the response held the access token. Delete the token now.\n");
    if (c.outcome === "UNRESOLVED" && c.writing !== false) process.stdout.write("  An UNRESOLVED send that is, or may be, a writing send: runbook STOP-and-review. No retry, no recovery.\n");
    worst = Math.max(worst, c.class === "R2" ? 0 : c.class === "R3" ? 1 : 3);
  }
  process.stdout.write("A classification, not a go.\n");
  process.exit(worst);
}
