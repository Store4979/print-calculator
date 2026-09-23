// netlify/lib/deploy-context.js — THE reader for the bundled deployment
// context. There is exactly one, and both callers use it: release2Allowed()
// in ./release2.js and the diagnostic route netlify/functions/deploy-context.js.
// A second reader would be a second policy; scripts/tests/release2-deploy-context.test.js
// asserts the route imports no other one.
//
// ── WHY A FILE AND NOT AN ENVIRONMENT VARIABLE ─────────────────────────────
// Stage 0 removes the "refuse on the production project ref" condition, and
// something has to take its place that a request cannot influence. CONTEXT is
// a BUILD-time variable: Netlify documents only URL, SITE_NAME and SITE_ID as
// predefined at function runtime, so `process.env.CONTEXT` inside a handler is
// not guaranteed to exist — and if it silently did not, a reader that treated
// absence as "production" would license production itself.
//
// So the value is written at build time by scripts/write-deploy-context.mjs
// into deploy-context.json beside this file, and shipped inside every function
// bundle by netlify.toml's [functions] included_files. It is fixed for the life
// of the bundle: a redeploy of the same build carries the same file, and no
// request, header or dashboard env edit can change it.
//
// ── FAIL CLOSED, WITH NO DEFAULT ───────────────────────────────────────────
// There is deliberately no fallback value anywhere below. Absent file,
// unparseable file, a missing key, or a `context` outside VALID_CONTEXTS all
// return the same thing: not ok. The caller turns that into a 404. A reader
// that defaulted `context` to "production" would convert a malformed bundle
// into a licensed one, which is the exact failure this module exists to
// prevent — that mutant is a test.
//
// Node-only, no dependencies, never throws.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** The only context values Netlify emits. Anything else is malformed. */
export const VALID_CONTEXTS = Object.freeze(["production", "deploy-preview", "branch-deploy", "dev"]);

/** Path inside the repo AND inside a function bundle (included_files keeps it). */
export const CONTEXT_FILE = "netlify/lib/deploy-context.json";

/** Every key the writer emits. A file missing any of them is malformed. */
export const REQUIRED_KEYS = Object.freeze([
  "context", "siteId", "siteName", "deployId", "commitRef", "builtAt",
]);

const absent = (reason, source = null, tried = []) =>
  ({ ok: false, reason, source, tried, context: null, meta: null });

function validate(raw, source) {
  let obj;
  try {
    obj = JSON.parse(raw);
  } catch {
    return absent("deploy-context.json is not valid JSON", source);
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    return absent("deploy-context.json is not a JSON object", source);
  }
  for (const k of REQUIRED_KEYS) {
    if (!(k in obj)) return absent(`deploy-context.json is missing the key ${JSON.stringify(k)}`, source);
  }
  const context = typeof obj.context === "string" ? obj.context.trim() : "";
  if (!VALID_CONTEXTS.includes(context)) {
    // Includes the local-build case, where the writer stores null on purpose:
    // a bundle built outside Netlify has no deployment context to verify.
    return absent(
      `deploy-context.json context ${JSON.stringify(obj.context)} is not one of ${VALID_CONTEXTS.join(", ")}`,
      source
    );
  }
  const str = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);
  return {
    ok: true,
    reason: null,
    source,
    context,
    tried: [],
    meta: {
      siteId: str(obj.siteId),
      siteName: str(obj.siteName),
      deployId: str(obj.deployId),
      commitRef: str(obj.commitRef),
      builtAt: str(obj.builtAt),
    },
  };
}

// Where the file can be, in order. The bundler inlines imported JS but this
// JSON is read from disk at runtime, so its location depends on how the
// bundle was assembled — which is why the diagnostic route reports `source`
// rather than this module asserting one layout is correct.
function candidatePaths() {
  const out = [];
  try {
    out.push({ source: "module-relative", path: fileURLToPath(new URL("./deploy-context.json", import.meta.url)) });
  } catch {
    /* import.meta.url is not a file URL in some bundlers; fall through */
  }
  const taskRoot = process.env.LAMBDA_TASK_ROOT;
  if (taskRoot) out.push({ source: "LAMBDA_TASK_ROOT", path: join(taskRoot, CONTEXT_FILE) });
  out.push({ source: "cwd", path: join(process.cwd(), CONTEXT_FILE) });
  return out;
}

/**
 * Read and validate the bundled deployment context.
 *
 * `root` is for tests only: it points the reader at one directory instead of
 * the candidate list. It is NOT an environment variable and cannot be set on a
 * deployment — the immutability claim above depends on there being no such
 * switch at runtime.
 *
 * Not cached. The file cannot change for the life of a bundle, so caching
 * would be safe, but a per-call read keeps this stateless and keeps tests on
 * the same path production takes. It is a few hundred bytes.
 *
 * @returns {{ok: boolean, reason: string|null, source: string|null, context: string|null,
 *            tried: string[], meta: object|null}}
 */
export function readDeployContext({ root = null } = {}) {
  const list = root === null
    ? candidatePaths()
    : [{ source: "root", path: join(root, CONTEXT_FILE) }];
  const tried = [];
  for (const c of list) {
    let raw;
    try {
      raw = readFileSync(c.path, "utf8");
    } catch {
      tried.push(c.source);
      continue;
    }
    // A file was found. Its verdict stands, valid or not: falling through to
    // another copy after a malformed one would be searching for a yes.
    return validate(raw, c.source);
  }
  return absent(`no ${CONTEXT_FILE} in the bundle`, null, tried);
}

/**
 * Which contexts this deployment is allowed to run Release 2 in.
 * Default: production only. `netlify dev` bundles context "dev", so local work
 * sets RELEASE2_CONTEXTS=production,dev deliberately and locally.
 */
export function allowedContexts(env = process.env) {
  const raw = String(env.RELEASE2_CONTEXTS || "").trim();
  if (!raw) return ["production"];
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}
