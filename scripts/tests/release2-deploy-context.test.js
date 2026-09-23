// scripts/tests/release2-deploy-context.test.js — stage 0's replacement for
// the production-ref refusal: a deployment context that a request cannot
// influence, read from a file compiled into the function bundle.
//
// The failure being designed against is specific. CONTEXT is a BUILD-time
// variable; it is not documented as present at function runtime. A guard that
// read process.env.CONTEXT and treated absence as "production" would license
// production itself the first time the variable was missing — silently, and
// exactly where it matters. So: the value is written to a file at build time,
// the reader has no default, and every malformed shape below is refused.
//
// Numbered to match the report: DC-1 … DC-22.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { stripComments } from "./source-util.mjs";
import { withRepoDeployContext, validContext } from "./deploy-context-fixture.mjs";
import {
  readDeployContext,
  allowedContexts,
  VALID_CONTEXTS,
  REQUIRED_KEYS,
  CONTEXT_FILE,
} from "../../netlify/lib/deploy-context.js";
import { release2Allowed, gate, PRODUCTION_REF } from "../../netlify/lib/release2.js";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const STAGING_REF = "lboajqihpsfrokqvjgnl";
const STAGING_URL = `https://${STAGING_REF}.supabase.co`;
const PROD_URL = `https://${PRODUCTION_REF}.supabase.co`;
const WRITER = fileURLToPath(new URL("../write-deploy-context.mjs", import.meta.url));

/** A temp tree with (or without) a context file, for the reader's `root`. */
function tree(contents) {
  const root = mkdtempSync(join(tmpdir(), "dctx-"));
  if (contents !== undefined) {
    const p = join(root, CONTEXT_FILE);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, typeof contents === "string" ? contents : JSON.stringify(contents), "utf8");
  }
  return root;
}
const cleanup = (root) => rmSync(root, { recursive: true, force: true });

// ── 1. the reader ──────────────────────────────────────────────────────────

test("DC-1 a complete, valid file is read: ok, context, metadata, and the source named", () => {
  const root = tree(validContext({ context: "production" }));
  try {
    const r = readDeployContext({ root });
    assert.equal(r.ok, true);
    assert.equal(r.context, "production");
    assert.equal(r.reason, null);
    assert.equal(r.source, "root");
    assert.equal(r.meta.siteName, "printcalculator2-staging");
    assert.equal(r.meta.commitRef, "0123456789abcdef0123456789abcdef01234567");
  } finally { cleanup(root); }
});

test("DC-2 every context Netlify emits is accepted, and nothing else is", () => {
  for (const c of VALID_CONTEXTS) {
    const root = tree(validContext({ context: c }));
    try { assert.equal(readDeployContext({ root }).ok, true, c); } finally { cleanup(root); }
  }
  // Near misses: a plausible-looking value is still not one of the four.
  for (const c of ["staging", "Production", "PRODUCTION", "production ", "", " ", "prod", "preview", null, 42, true, ["production"]]) {
    const root = tree(validContext({ context: c }));
    try {
      const r = readDeployContext({ root });
      const trimmedMatch = typeof c === "string" && VALID_CONTEXTS.includes(c.trim());
      assert.equal(r.ok, trimmedMatch, `context ${JSON.stringify(c)}`);
      if (!trimmedMatch) assert.match(r.reason, /is not one of/);
    } finally { cleanup(root); }
  }
});

test("DC-3 an absent file is absent, not a pass — and the reader says where it looked", () => {
  const root = tree(undefined);
  try {
    const r = readDeployContext({ root });
    assert.equal(r.ok, false);
    assert.equal(r.context, null);
    assert.match(r.reason, /no netlify\/lib\/deploy-context\.json/);
  } finally { cleanup(root); }
});

test("DC-4 a missing key is malformed — each of the six, one at a time", () => {
  for (const key of REQUIRED_KEYS) {
    const obj = validContext();
    delete obj[key];
    const root = tree(obj);
    try {
      const r = readDeployContext({ root });
      assert.equal(r.ok, false, `deleting ${key} should refuse`);
      assert.match(r.reason, new RegExp(`missing the key "${key}"`));
    } finally { cleanup(root); }
  }
});

test("DC-5 unparseable, non-object and empty files are refused and never throw", () => {
  for (const body of ["", "   ", "not json", "[]", '"production"', "null", "{"]) {
    const root = tree(body);
    try {
      const r = readDeployContext({ root });
      assert.equal(r.ok, false, JSON.stringify(body));
      assert.equal(r.context, null);
    } finally { cleanup(root); }
  }
});

test("DC-6 MUTANT: a reader that defaults a missing/invalid context to production must not be what ships", () => {
  // The shipped reader has no default anywhere. This is the shape that would
  // license production from a malformed bundle.
  const mutant = (obj) => ({ ok: true, context: (obj && obj.context) || "production" });
  const malformed = { siteId: null };            // no context key at all
  assert.equal(mutant(malformed).context, "production", "the mutant reads as production");

  const root = tree(malformed);
  try {
    assert.equal(readDeployContext({ root }).ok, false, "the shipped reader refuses it");
  } finally { cleanup(root); }

  const SRC = stripComments(read("../../netlify/lib/deploy-context.js"));
  assert.doesNotMatch(SRC, /\|\|\s*"production"/, "no defaulting to production in the reader");
  assert.doesNotMatch(SRC, /\?\?\s*"production"/, "no nullish fallback to production either");
});

test("DC-7 the reader has no environment switch: nothing at runtime can redirect it", () => {
  const SRC = stripComments(read("../../netlify/lib/deploy-context.js"));
  // LAMBDA_TASK_ROOT is the runtime's own directory, not a file selector: it
  // says WHERE the bundle was unpacked, and the filename is still the fixed
  // CONTEXT_FILE constant. An env var naming the FILE would defeat the
  // immutability the bundled file exists for, so there is none.
  const envReads = [...new Set([...SRC.matchAll(/process\.env\.([A-Z0-9_]+)/g)].map((m) => m[1]))].sort();
  assert.deepEqual(envReads, ["LAMBDA_TASK_ROOT"]);
  assert.doesNotMatch(SRC, /process\.env\[[^\]]+\]/, "no computed env lookup either");
  // The allow-list is read through the caller's env parameter, not from the
  // module's own process.env — one place decides policy.
  assert.match(SRC, /env\.RELEASE2_CONTEXTS/);
  assert.match(SRC, /const CONTEXT_FILE|export const CONTEXT_FILE/);
});

test("DC-8 allowedContexts: production by default; the dev opt-in is explicit", () => {
  assert.deepEqual(allowedContexts({}), ["production"]);
  assert.deepEqual(allowedContexts({ RELEASE2_CONTEXTS: "" }), ["production"]);
  assert.deepEqual(allowedContexts({ RELEASE2_CONTEXTS: "production,dev" }), ["production", "dev"]);
  assert.deepEqual(allowedContexts({ RELEASE2_CONTEXTS: " production , dev , " }), ["production", "dev"]);
});

// ── 2. the guard ───────────────────────────────────────────────────────────

const OK_CTX = { ok: true, context: "production", reason: null, source: "test", tried: [], meta: {} };
const ctx = (context) => ({ ...OK_CTX, context });
const ABSENT = { ok: false, reason: "no netlify/lib/deploy-context.json in the bundle", source: null, tried: [], context: null, meta: null };

test("DC-9 all three conditions must hold: staging ref + flag + production context", () => {
  const r = release2Allowed({ RELEASE2_ENABLED: "true", SUPABASE_URL: STAGING_URL }, { deployContext: OK_CTX });
  assert.equal(r.ok, true);
  assert.match(r.reason, /in context production/);
});

test("DC-10 a deploy preview is refused even with the flag and a staging project", () => {
  const r = release2Allowed({ RELEASE2_ENABLED: "true", SUPABASE_URL: STAGING_URL }, { deployContext: ctx("deploy-preview") });
  assert.equal(r.ok, false);
  assert.equal(r.status, 404);
  assert.match(r.reason, /not in RELEASE2_CONTEXTS/);
});

test("DC-11 no context file: refused, with the flag set and a staging project", () => {
  const r = release2Allowed({ RELEASE2_ENABLED: "true", SUPABASE_URL: STAGING_URL }, { deployContext: ABSENT });
  assert.equal(r.ok, false);
  assert.equal(r.status, 404);
  assert.match(r.reason, /deployment context is unverified/);
});

test("DC-12 the flag is still required in an allowed context", () => {
  const r = release2Allowed({ SUPABASE_URL: STAGING_URL }, { deployContext: OK_CTX });
  assert.equal(r.ok, false);
  assert.equal(r.status, 404);
  assert.match(r.reason, /not enabled on this deployment/);
});

test("DC-13 the production-ref refusal STAYS until stage 0's production review deletes it", () => {
  // Everything else perfect — production context, flag set — and still 404.
  const r = release2Allowed({ RELEASE2_ENABLED: "true", SUPABASE_URL: PROD_URL }, { deployContext: OK_CTX });
  assert.equal(r.ok, false);
  assert.equal(r.status, 404);
  assert.match(r.reason, /refuse to run against the production project/);
  const SRC = stripComments(read("../../netlify/lib/release2.js"));
  assert.match(SRC, /ref === PRODUCTION_REF/, "condition 2 is still in the code");
});

test("DC-14 RELEASE2_CONTEXTS=production,dev admits a netlify dev bundle; the default does not", () => {
  const env = { RELEASE2_ENABLED: "true", SUPABASE_URL: STAGING_URL };
  assert.equal(release2Allowed(env, { deployContext: ctx("dev") }).ok, false);
  assert.equal(release2Allowed({ ...env, RELEASE2_CONTEXTS: "production,dev" }, { deployContext: ctx("dev") }).ok, true);
});

test("DC-15 gate() carries the context condition, and still says nothing to the caller", () => {
  const env = { RELEASE2_ENABLED: "true", SUPABASE_URL: STAGING_URL, URL: "https://site.example" };
  const ev = { httpMethod: "POST", headers: { "content-type": "application/json" } };
  assert.equal(gate(ev, { env, deployContext: OK_CTX }), null, "a good request passes");
  const res = gate(ev, { env, deployContext: ctx("deploy-preview") });
  assert.equal(res.statusCode, 404);
  assert.equal(JSON.parse(res.body).error, "Not Found");
  assert.doesNotMatch(res.body, /context|deploy-preview|RELEASE2/i, "the refusal must not explain itself");
});

// ── 3. the writer ──────────────────────────────────────────────────────────

function runWriter(env) {
  const root = mkdtempSync(join(tmpdir(), "dcw-"));
  // A hosted build is detected from NETLIFY/CI/BUILD_ID/DEPLOY_ID/SITE_ID, so
  // the inherited environment is NOT passed through: a CI run of this suite
  // would otherwise make every "local" case hosted.
  const clean = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, DEPLOY_CONTEXT_ROOT: root, ...env };
  let status = 0, stderr = "", stdout = "";
  try {
    stdout = execFileSync(process.execPath, [WRITER], { env: clean, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    status = e.status ?? 1;
    stderr = String(e.stderr || "");
    stdout = String(e.stdout || "");
  }
  const p = join(root, CONTEXT_FILE);
  const file = existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;
  cleanup(root);
  return { status, stdout, stderr, file };
}

const NETLIFY_ENV = {
  NETLIFY: "true", CONTEXT: "deploy-preview", SITE_ID: "03ff880d-eb73-4035-8b71-3588b22a0b20",
  SITE_NAME: "printcalculator2", DEPLOY_ID: "6ab018331b0a1500089d0930",
  COMMIT_REF: "0123456789abcdef0123456789abcdef01234567",
};

test("DC-16 a hosted build writes exactly the six keys, and the reader accepts the result", () => {
  const r = runWriter(NETLIFY_ENV);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(Object.keys(r.file), [...REQUIRED_KEYS]);
  assert.equal(r.file.context, "deploy-preview");
  assert.equal(r.file.commitRef, NETLIFY_ENV.COMMIT_REF);
  assert.match(r.file.builtAt, /^20\d\d-\d\d-\d\dT/);
});

test("DC-17 a hosted build with a missing or invalid CONTEXT exits 1 and writes nothing", () => {
  const noCtx = runWriter({ ...NETLIFY_ENV, CONTEXT: "" });
  assert.equal(noCtx.status, 1);
  assert.equal(noCtx.file, null, "nothing is written when the environment cannot be trusted");
  assert.match(noCtx.stderr, /CONTEXT is empty on a HOSTED build/);

  const badCtx = runWriter({ ...NETLIFY_ENV, CONTEXT: "staging" });
  assert.equal(badCtx.status, 1);
  assert.equal(badCtx.file, null);
  assert.match(badCtx.stderr, /not one of production, deploy-preview, branch-deploy, dev/);
});

test("DC-18 a hosted build missing any identity field exits 1 — one field at a time", () => {
  for (const k of ["SITE_ID", "SITE_NAME", "DEPLOY_ID", "COMMIT_REF"]) {
    const r = runWriter({ ...NETLIFY_ENV, [k]: "" });
    assert.equal(r.status, 1, `${k} empty should refuse`);
    assert.match(r.stderr, new RegExp(`${k} is empty on a HOSTED build`));
  }
});

test("DC-19 a local build writes nulls the reader rejects, and may claim nothing but dev", () => {
  const local = runWriter({});
  assert.equal(local.status, 0, local.stderr);
  assert.equal(local.file.context, null);
  assert.equal(local.file.commitRef, null);
  const root = tree(local.file);
  try {
    assert.equal(readDeployContext({ root }).ok, false, "nulls are not a context");
  } finally { cleanup(root); }

  // netlify dev is the one local context that may be recorded.
  assert.equal(runWriter({ CONTEXT: "dev" }).file.context, "dev");
  // A laptop claiming to be production is refused: only Netlify's builder can
  // establish that, and a bundle that said so would be believed.
  const lie = runWriter({ CONTEXT: "production" });
  assert.equal(lie.status, 1);
  assert.equal(lie.file, null);
  assert.match(lie.stderr, /not hosted by Netlify/);
});

// ── 4. the diagnostic route ────────────────────────────────────────────────

test("DC-20 the route: GET only, no-store, one reader, and no Supabase anything", async () => {
  const SRC = stripComments(read("../../netlify/functions/deploy-context.js"));

  // ONE reader. The only import in the file is the shared module.
  const imports = [...SRC.matchAll(/^import\s[^;]*?from\s+"([^"]+)"/gm)].map((m) => m[1]);
  assert.deepEqual(imports, ["../lib/deploy-context.js"],
    "a second reader would be a second policy; this route must use the shared one");

  // It must not be able to reach a key or an origin allowlist by any path.
  assert.doesNotMatch(SRC, /SUPABASE_/, "never reads any SUPABASE_* value");
  assert.doesNotMatch(SRC, /@supabase\/supabase-js|createClient/, "never imports the Supabase client");
  assert.doesNotMatch(SRC, /RELEASE2_ALLOWED_ORIGINS/);
  assert.doesNotMatch(SRC, /release2\.js/, "and it does not go through the gate — it must answer where the gate refuses");

  const mod = await import("../../netlify/functions/deploy-context.js");
  const post = await mod.handler({ httpMethod: "POST", headers: {} });
  assert.equal(post.statusCode, 405);

  await withRepoDeployContext(validContext({ context: "deploy-preview" }), async () => {
    const saved = process.env.RELEASE2_ENABLED;
    const savedSecret = process.env.SUPABASE_SERVICE_ROLE_KEY;
    process.env.RELEASE2_ENABLED = "true";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "MARKER-SERVICE-ROLE-KEY";
    try {
      const res = await mod.handler({ httpMethod: "GET", headers: {} });
      assert.equal(res.statusCode, 200);
      assert.equal(res.headers["cache-control"], "no-store");
      const body = JSON.parse(res.body);
      assert.equal(body.ok, true);
      assert.equal(body.context, "deploy-preview");
      assert.equal(body.siteName, "printcalculator2-staging");
      assert.deepEqual(body.allowedContexts, ["production"]);
      assert.equal(body.contextAllowed, false, "a preview is reported as not allowed to run Release 2");
      assert.equal(body.flagPresent, true, "presence is reported");
      assert.doesNotMatch(res.body, /MARKER-SERVICE-ROLE-KEY/, "no env value reaches the body");
      assert.equal(typeof body.source, "string");
    } finally {
      if (saved === undefined) delete process.env.RELEASE2_ENABLED; else process.env.RELEASE2_ENABLED = saved;
      if (savedSecret === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = savedSecret;
    }
  });

  await withRepoDeployContext(null, async () => {
    const res = await mod.handler({ httpMethod: "GET", headers: {} });
    const body = JSON.parse(res.body);
    assert.equal(res.statusCode, 200, "the diagnostic still answers when there is nothing to report");
    assert.equal(body.ok, false);
    assert.equal(body.context, null);
    assert.match(body.reason, /deploy-context\.json/);
  });
});

// ── 5. the build wiring ────────────────────────────────────────────────────

test("DC-21 the writer runs before the build, and the file ships inside the function bundles", () => {
  const toml = read("../../netlify.toml");
  const cmd = /^\s*command\s*=\s*"([^"]+)"/m.exec(toml)[1];
  assert.ok(cmd.includes("node scripts/write-deploy-context.mjs"), "the writer is in the build command");
  assert.ok(cmd.indexOf("write-deploy-context") < cmd.indexOf("yarn build"),
    "it must run BEFORE the build, so the file exists when the functions are bundled");
  assert.ok(cmd.indexOf("check-build-env") < cmd.indexOf("write-deploy-context"),
    "and after the env guard, which decides whether this build should happen at all");
  assert.match(toml, /included_files\s*=\s*\[[^\]]*"netlify\/lib\/deploy-context\.json"/,
    "read from disk at request time, so the bundler will not carry it unless it is listed");

  const ignore = read("../../.gitignore");
  assert.match(ignore, /^netlify\/lib\/deploy-context\.json$/m,
    "generated per build; a tracked copy would let a stale commit ref describe a fresh deploy");
});

test("DC-22 the injector cross-checks the context file against this build — hosted only", () => {
  const INJ = stripComments(read("../inject-sw-manifest.mjs"));
  assert.match(INJ, /deploy-context\.json is absent on a Netlify build/);
  assert.match(INJ, /!= build env COMMIT_REF/);
  assert.match(INJ, /__PC_BUILD__ commit/, "the file is compared with the bundle's own stamp, not only with the env");
  // Inside the onNetlify branch: a local build writes nulls and is not checked.
  const netlifyIdx = INJ.indexOf("const onNetlify");
  const dcIdx = INJ.indexOf("deploy-context.json is absent on a Netlify build");
  const writeIdx = INJ.indexOf("writeFileSync(SW, pendingWrite");
  assert.ok(netlifyIdx > 0 && dcIdx > netlifyIdx, "the cross-check is inside the hosted branch");
  assert.ok(writeIdx > dcIdx, "and it precedes the only write");
});
