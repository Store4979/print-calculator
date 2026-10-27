#!/usr/bin/env node
// scripts/manual/stage0-send.mjs — how a PINNED stage-0 SQL text is sent to a
// database (plan §E1 "The transport"; Codex's decision A, review of 07574c1).
// The plan allows no other way. Nothing in code can stop a text being retyped
// into some other tool, so that rule is procedural. Why it exists: a text this
// size cannot be reproduced byte for byte by hand, and the manifest's md5 pins
// mean nothing if the bytes that arrive are not the pinned ones.
//
// Ryan runs it in his own PowerShell window. The session that prepares the
// steps runs only --dry-run, issues each go (stage0-go.mjs) and reads the
// results files; it never holds the token.
//
// In order, it:
//   1. reads the manifest committed at HEAD, and refuses unless everything
//      this file loads is the blob that manifest's guard chain pins
//      (stage0-guard.mjs selfCheck; Codex item 6, SG-6);
//   2. assembles the named text from the manifest's frozen inputs (git blobs)
//      and refuses unless its md5 and byte count equal the manifest's outputs
//      entry. For --cancel it checks the pinned template the same way, then
//      instantiates it with the assembler's validating cancelStepText();
//   3. refuses unless the manifest's send policy allows that text on that
//      target, and — for a live send — --confirm-ref repeats the target's
//      project ref;
//   4. with --dry-run, stops there. It prints md5, bytes, target and ref and
//      needs no token, window marker or go, and makes no network call;
//   5. reads the token ONLY from the SUPABASE_ACCESS_TOKEN environment
//      variable (never argv, never a file) and refuses when it is missing or
//      is not a personal access token (sbp_…);
//   6. refuses without --go <id>, then passes the send to the guards
//      (stage0-guard.mjs guardedSend): the checkout, the clock, this window's
//      marker and shell process, the text's window role, the go named by id,
//      the project journal and the step's gate. Every refusal there comes
//      before any request. The go is used up and a claim journalled before
//      the request; the deadline is checked again immediately before fetch;
//   7. POSTs {"query": <the checked text>} — plus "read_only": true for the
//      texts the policy marks read-only — to the Management API endpoint
//      https://api.supabase.com/v1/projects/<ref>/database/query. That is the
//      endpoint and body shape the Supabase MCP server's execute_sql uses
//      (@supabase/mcp-server-supabase 0.13.0; plan §E1);
//   8. writes the request md5/bytes, target, ref, timestamps, HTTP status,
//      raw response body and the guard block (go, marker, role, head) to a
//      new file in .stage0-send/ (gitignored), records its sha256 as the
//      attempt's outcome, and prints a short summary.
//
// The token goes out only in the Authorization header. This file prints and
// writes no token, and a response that contains the token is redacted before
// it is written or printed. scripts/tests/stage0-send.test.js checks all of
// that against a local mock server.
//
// A client-side timeout or a dropped connection says nothing about whether a
// writing text committed. The plan's rule applies: read back with STATE,
// through this sender, before anything else.
//
// Exit status: 0 HTTP 201, recorded; 1 another status or a transport error,
// recorded; 2 refused, and no request was made; 5 a request was, or may have
// been, made and its outcome is not recorded: the attempt holds the project.
// None of these is a go.
//
//   node scripts/manual/stage0-send.mjs <TEXT> --target <production|staging> --dry-run
//   node scripts/manual/stage0-send.mjs <TEXT> --target <t> --confirm-ref <ref> --go <id>
//   node scripts/manual/stage0-send.mjs --cancel <STEP> <BACKEND_START> --target production [--dry-run | --confirm-ref <ref> --go <id>]
import { mkdirSync, openSync, writeSync, closeSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as A from "./assemble-stage0.mjs";
import * as G from "./stage0-guard.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const API_BASE = "https://api.supabase.com";
export const ENDPOINT = "/v1/projects/{ref}/database/query";
export const SENDER_PATH = "scripts/manual/stage0-send.mjs";
export const TOKEN_ENV = "SUPABASE_ACCESS_TOKEN";
export const TIMEOUT_MS = 150_000; // above P1's 110 s transaction_timeout
export const RESULTS_DIR = join(ROOT, ".stage0-send");
const TOKEN_SHAPE = /^sbp_\S+$/;
const SAFE_ECHO = /^[A-Za-z0-9._-]{1,40}$/; // argv is echoed only in this shape
const echo = (v) => (typeof v === "string" && SAFE_ECHO.test(v) && !v.startsWith("sbp_") ? `"${v}"` : "(value not echoed)");

/** Refuse unless everything the sender loads is pinned by the manifest's guard chain. */
export function selfCheck(manifest, cwd = ROOT) {
  G.selfCheck(manifest, cwd, SENDER_PATH);
}

const assembled = new WeakMap();
function outputs(manifest, cwd) {
  if (!assembled.has(manifest)) assembled.set(manifest, A.assembleAll(manifest, { cwd }));
  return assembled.get(manifest);
}

/** The checked text for one send, and where it may go. Throws on any mismatch. */
export function planSend(manifest, name, target, { cancel = null, cwd = ROOT } = {}) {
  const policy = manifest.send && manifest.send.texts && manifest.send.texts[name];
  if (!policy) throw new Error(`${echo(name)} is not a sendable text in the manifest's send policy`);
  const pin = manifest.outputs && manifest.outputs[name];
  const text = outputs(manifest, cwd)[name];
  if (typeof text !== "string" || !pin) throw new Error(`${echo(name)} is not an assembled output`);
  const tMd5 = A.md5(text), tBytes = Buffer.byteLength(text);
  if (tMd5 !== pin.md5 || tBytes !== pin.bytes) {
    throw new Error(`${name}: the assembled text is ${tMd5} / ${tBytes} bytes, but the manifest pins ${pin.md5} / ${pin.bytes}; refusing`);
  }
  const ref = manifest.send.targets && manifest.send.targets[target];
  if (!ref) throw new Error(`unknown target ${echo(target)}; one of ${Object.keys(manifest.send.targets || {}).join(", ")}`);
  if (!policy.targets.includes(target)) throw new Error(`${name} may not be sent to ${target}; the manifest allows ${policy.targets.join(", ")}`);
  let sent = text, template = null;
  if (policy.instantiate === "cancel") {
    if (!cancel) throw new Error(`${name} is a template: send it with --cancel <STEP> <BACKEND_START>`);
    if (!/^[A-Z0-9-]{1,20}$/.test(String(cancel.step || "")) || !A.BACKEND_START_RE.test(String(cancel.backendStart || ""))) {
      throw new Error("--cancel takes a stage-0 step name and CANCEL-INSPECT's backend_start");
    }
    sent = A.cancelStepText(text, cancel.step, cancel.backendStart);
    template = { md5: tMd5, bytes: tBytes, step: cancel.step, backendStart: cancel.backendStart };
  } else if (cancel) {
    throw new Error("--cancel applies only to CANCEL-STEP-TEMPLATE");
  }
  return { name, target, ref, readOnly: policy.readOnly === true, text: sent, md5: A.md5(sent), bytes: Buffer.byteLength(sent), template };
}

/** The HTTP request for a plan. The token appears in the Authorization header only. */
export function requestFor(plan, token, apiBase = API_BASE) {
  const body = plan.readOnly ? { query: plan.text, read_only: true } : { query: plan.text };
  return {
    url: apiBase + ENDPOINT.replace("{ref}", plan.ref),
    init: {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  };
}

/**
 * Send one plan. Returns the record; never throws on an HTTP or network
 * failure. `admit`, when given, runs after the request is built and
 * immediately before fetch; if it throws, nothing is fetched and the error
 * propagates.
 */
export async function send(plan, { token, apiBase = API_BASE, fetchImpl = globalThis.fetch, timeoutMs = TIMEOUT_MS, clock = () => new Date(), admit = null } = {}) {
  if (!token) throw new Error(`${TOKEN_ENV} is not set; refusing`);
  const { url, init } = requestFor(plan, token, apiBase);
  if (admit) admit();
  const startedAt = clock().toISOString();
  let httpStatus = null, body = null, error = null;
  try {
    const res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    httpStatus = res.status;
    body = await res.text();
  } catch (e) {
    error = `${e && e.name}: ${e && e.message}`;
  }
  const finishedAt = clock().toISOString();
  let redacted = false;
  const scrub = (s) => {
    if (typeof s !== "string" || !s.includes(token)) return s;
    redacted = true;
    return s.split(token).join("[REDACTED: the access token]");
  };
  return {
    tool: SENDER_PATH,
    text: plan.name,
    target: plan.target,
    ref: plan.ref,
    readOnly: plan.readOnly,
    requestMd5: plan.md5,
    requestBytes: plan.bytes,
    ...(plan.template ? { cancelTemplate: plan.template } : {}),
    endpoint: url,
    startedAt,
    finishedAt,
    httpStatus,
    body: scrub(body),
    error: scrub(error),
    tokenRedactedFromResponse: redacted,
  };
}

/** Write one record to a NEW file in the results directory (never over another); returns its path. */
export function writeRecord(record, dir = RESULTS_DIR) {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${record.startedAt.replace(/[:.]/g, "-")}_${record.text}_${record.target}.json`);
  const fd = openSync(file, "wx");
  try { writeSync(fd, JSON.stringify(record, null, 2) + "\n"); } finally { closeSync(fd); }
  return file;
}

function parseArgs(argv) {
  const a = [...argv];
  const o = { name: null, target: null, confirmRef: null, dryRun: false, cancel: null, go: null };
  while (a.length) {
    const x = a.shift();
    if (x === "--dry-run") o.dryRun = true;
    else if (x === "--target") o.target = a.shift();
    else if (x === "--confirm-ref") o.confirmRef = a.shift();
    else if (x === "--go") o.go = a.shift() ?? "";
    else if (x === "--cancel") { o.cancel = { step: a.shift(), backendStart: a.shift() }; o.name = o.name || "CANCEL-STEP-TEMPLATE"; }
    else if (x.startsWith("-")) throw new Error(`unknown option ${echo(x)}; the token is read only from ${TOKEN_ENV}`);
    else if (o.name === null) o.name = x;
    else throw new Error(`unexpected argument ${echo(x)}`);
  }
  if (!o.name || !o.target) throw new Error("usage: stage0-send.mjs <TEXT> --target <production|staging> (--dry-run | --confirm-ref <ref> --go <id>)");
  if (o.go !== null && !/^[0-9a-f]{32}$/.test(o.go)) throw new Error("--go takes the 32-character go id stage0-go.mjs printed");
  return o;
}

/**
 * The command line. deps are for tests only: the command line itself passes
 * none, so the endpoint, the manifest and the guard state cannot be
 * redirected from argv or the environment.
 */
export async function main(argv, env, deps = {}) {
  const out = deps.stdout || ((s) => process.stdout.write(s));
  const o = parseArgs(argv);
  const root = deps.root || ROOT;
  const manifest = deps.manifest || A.manifestAt("HEAD", root);
  G.selfCheck(manifest, root, SENDER_PATH);
  const plan = planSend(manifest, o.name, o.target, { cancel: o.cancel, cwd: root });
  out(`text ${plan.name}${plan.template ? ` (instantiated from the template ${plan.template.md5} / ${plan.template.bytes} bytes)` : ""}\n`);
  out(`target ${plan.target} = ${plan.ref}; read_only ${plan.readOnly}\n`);
  out(`request md5 ${plan.md5}; ${plan.bytes} bytes\n`);
  if (o.dryRun) {
    if (o.go !== null) throw new Error("--dry-run takes no --go; refusing");
    out("dry run: verified against the manifest; no network call made\n");
    return { dryRun: true, plan };
  }
  if (o.confirmRef !== plan.ref) throw new Error(`--confirm-ref must repeat the target's project ref ${plan.ref}; refusing`);
  const token = env[TOKEN_ENV];
  if (!token) throw new Error(`${TOKEN_ENV} is not set; refusing`);
  if (!TOKEN_SHAPE.test(token)) throw new Error(`${TOKEN_ENV} is not a Supabase personal access token (sbp_…); refusing`);
  if (o.go === null) throw new G.Refusal("a live send needs --go <id>, the go stage0-go.mjs issued for this step; refusing");
  const ctxCache = new Map();
  const r = await G.guardedSend({
    plan, goId: o.go, token, env, manifest, root,
    stateDir: deps.stateDir, now: deps.now, identity: deps.identity, git: deps.git, workflows: deps.workflows,
    execArgv: deps.execArgv, ppid: deps.ppid, selfStartMs: deps.selfStartMs, readReceipt: deps.readReceipt,
    ctxAt: deps.ctxAt || ((h) => { if (!ctxCache.has(h)) ctxCache.set(h, (deps.contextAt || defaultContextAt)(h, root)); return ctxCache.get(h); }),
    send: (p, extra) => send(p, { token, apiBase: deps.apiBase, fetchImpl: deps.fetchImpl, timeoutMs: deps.timeoutMs, ...extra }),
    writeReceipt: deps.writeReceipt || ((rec) => writeRecord(rec, deps.resultsDir || RESULTS_DIR)),
  });
  const record = r.record;
  out(`${r.go.step} (go ${r.go.goId.slice(0, 8)}…, ${r.marker.role} window, attempt ${r.attemptId.slice(0, 8)}…)\n`);
  out(`${record.startedAt} → ${record.finishedAt}\n`);
  out(`HTTP ${record.httpStatus ?? "none"}${record.error ? ` | ${record.error}` : ""}\n`);
  out(`body (first 300 chars): ${String(record.body ?? "").slice(0, 300)}\n`);
  out("This exit code is a transport fact, not a go. The next step needs its own go.\n");
  out(`results file: ${r.file}\n`);
  return { dryRun: false, plan, record, file: r.file, attemptId: r.attemptId };
}

/** The rule 3′ context at a head: the manifest committed there, assembled (stage0-classify.mjs). */
function defaultContextAt(head, root) {
  return G.contextAt(head, root);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2), process.env).then(
    (r) => process.exit(r.dryRun || r.record.httpStatus === 201 ? 0 : 1),
    (e) => {
      process.stderr.write(`stage0-send: ${e.message}\n`);
      if (e instanceof G.AfterDispatch) {
        process.stderr.write("STOP: do not repeat this command, and send nothing else. The attempt holds the project until a reviewed disposition.\n");
        process.exit(5);
      }
      process.stderr.write("No request was made.\n");
      process.exit(2);
    },
  );
}
