#!/usr/bin/env node
// Enumerate the built assets into dist/sw.js, then validate the result.
//
// The service worker's cache allowlist must be a LIST, not a pattern: a
// prefix-plus-extension rule caches whatever happens to land under that
// prefix, which is how "static asset" quietly grows to include things it
// should not. Vite emits content-hashed filenames that cannot be known when
// sw.js is authored, so they are injected here, after the build.
//
// TWO PATHS, ONE VALIDATION. Either the marker is present and we inject, or a
// manifest is already there and we parse it — and then the SAME checks run.
// An earlier revision exited 0 on the already-injected path *before* the
// validation block, so those runs validated nothing.
//
// Exposure scope, stated narrowly: a NORMAL deploy rebuilds dist first, so the
// marker is present and injection takes the fresh path. The unvalidated path
// was reachable only with a REUSED already-injected artefact — a restored
// build cache or a retried deploy. Real, and narrower than "every repeat".
// Either way, an unchanged repeat must succeed AFTER validating, not instead.
//
// Failure mode if this never runs at all: BUILD_ASSETS stays [] and the worker
// caches only the hand-listed shell. Degraded, never unsafe.
//
// Node-only, no dependencies; path handling is POSIX-normalised so the URLs it
// writes are identical on Windows and Linux.
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
// Overridable so scripts/tests/inject-sw-manifest.test.js can drive real
// fixtures through this exact file rather than a reimplementation of it.
const DIST = process.env.SW_MANIFEST_DIST || join(ROOT, "dist");
const SW = join(DIST, "sw.js");
const MARKER = "/*__BUILD_ASSETS__*/";

// Only these extensions, and only under /assets/, are eligible. Anything the
// build emits elsewhere must be added to CORE in sw.js by hand, on purpose.
const ELIGIBLE = /\.(?:js|css|woff2)$/i;

const die = (...lines) => { for (const l of lines) console.error(l); process.exit(1); };

const walk = (dir) =>
  readdirSync(dir).flatMap((entry) => {
    const p = join(dir, entry);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

if (!existsSync(SW)) die("inject-sw-manifest: dist/sw.js not found — did the build run?");

const assetsDir = join(DIST, "assets");
const diskAssets = existsSync(assetsDir)
  ? walk(assetsDir)
      .map((p) => "/" + relative(DIST, p).split(sep).join("/"))
      .filter((u) => ELIGIBLE.test(u))
      .sort()
  : [];

const src = readFileSync(SW, "utf8");
const hasMarker = src.includes(MARKER);

const parseManifest = (text) => {
  const m = text.match(/const BUILD_ASSETS\s*=\s*\[([\s\S]*?)\]\s*;/);
  if (!m) return null;
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
};

// ── Resolve the manifest that WILL BE in dist/sw.js after this run ──
// Nothing is written yet. Validation happens first so a failure never leaves a
// half-mutated dist/sw.js behind for the next run to puzzle over.
let manifest;
let mode;
let pendingWrite = null;
if (hasMarker) {
  manifest = diskAssets;
  const list = manifest.map((u) => `\n  ${JSON.stringify(u)},`).join("") + (manifest.length ? "\n" : "");
  const out = src.replace(MARKER, list);
  if (out.includes(MARKER)) die("inject-sw-manifest: marker survived the replacement — aborting.");
  if (manifest.length && !/const BUILD_ASSETS = \[\s*"\/assets\//.test(out))
    die("inject-sw-manifest: manifest did not take. Aborting rather than shipping an empty allowlist.");
  pendingWrite = out;
  mode = "injected";
} else {
  const existing = parseManifest(src);
  if (!existing) {
    die("inject-sw-manifest: dist/sw.js has neither the marker nor a manifest.",
        "  This build's sw.js did not come from public/sw.js. Refusing to guess.");
  }
  manifest = existing;
  mode = "already-injected";
}

// ── Validation. Runs on BOTH paths, against the manifest that is now on disk ──
//
// COVERAGE: entry-point HTML asset references. This scans `src=` and `href=`
// attributes in the two built HTML entry points (index.html, upload.html).
// That is all it sees. It
// does NOT follow JS module imports, dynamically constructed URLs, `import()`
// specifiers, CSS url() references, or anything fetched at runtime. A lazy
// chunk reached only through an import() is invisible here — which is why an
// asset being "unreferenced" below is reported, not treated as an error.
const entryHtml = ["index.html", "upload.html"].map((f) => join(DIST, f)).filter((f) => existsSync(f));

const requested = new Set();
const queryBearing = [];
for (const f of entryHtml) {
  const html = readFileSync(f, "utf8");
  for (const m of html.matchAll(/(?:src|href)\s*=\s*["']([^"']+)["']/g)) {
    const ref = m[1];
    if (!ref.startsWith("/assets/")) continue;
    // REJECT, do not normalise. Stripping the query here would let
    // /assets/x.js?v=2 validate against /assets/x.js and pass — while sw.js
    // isSensitiveRequest refuses ANY same-origin URL carrying a search string,
    // so the browser would request a URL the worker can never cache. Silently
    // normalising it away is precisely the mismatch this invariant exists to
    // catch.
    if (ref.includes("?")) { queryBearing.push({ file: f, ref }); continue; }
    requested.add(ref);
  }
}

if (queryBearing.length) {
  die("inject-sw-manifest: entry HTML references assets with a query string:",
      ...queryBearing.map(({ file, ref }) => `  ${relative(DIST, file)}  ->  ${ref}`),
      "  sw.js treats any same-origin URL with a search as sensitive and never caches it,",
      "  so these would be requested but never cacheable. Emit them without a query.");
}

const missing = [...requested].filter((u) => !manifest.includes(u));
if (missing.length) {
  die(`inject-sw-manifest: the entry HTML references assets the manifest does not list (${mode}):`,
      ...missing.map((m) => "  MISSING  " + m),
      "  The cache allowlist would not cover them. Aborting.");
}

// ── Build stamp invariant (2026-09-18) ──────────────────────────────────────
// The client build stamp (vite.config.js `define` -> src/lib/buildStamp.js)
// exists so a counter device can prove which bundle it is RUNNING, including
// after an offline reopen from this worker's cache. That only works if the
// stamp is a LITERAL inside the emitted main bundle. This step runs after
// `yarn build` on Netlify (scripts/tests run BEFORE the build and cannot see
// dist/), so it is the one place the emitted artefact can be checked and the
// deploy failed. Checked here, before anything is written, like the manifest.
//
// What is asserted: the main bundle contains the inlined object with a
// build-time `builtAt`, the MISSING text (so a local bundle still says so),
// and NOT the raw identifier (which would mean `define` did not apply). On a
// Netlify build, COMMIT_REF and DEPLOY_ID must also be present as literals:
// a production bundle that says MISSING is honest but useless for the device
// retirement checkpoint, so it does not ship.
//
// SCOPE: the check applies when the dist holds this app's entry bundle,
// main-*.js (vite.config.js rollupOptions.input `main`; a test pins that
// name). The injector's own fixture tests drive it against throwaway dists
// with no such bundle, and for those it says so and skips. A real build that
// emitted no main bundle would also skip, which is why the entry name is
// pinned by test rather than trusted.
const mainBundle = diskAssets.find((u) => /^\/assets\/main-[\w-]+\.js$/.test(u));
if (!mainBundle) {
  console.log("inject-sw-manifest: no main-*.js entry bundle in this dist; build stamp invariant not applicable (fixture or non-app dist)");
} else {
  const js = readFileSync(join(DIST, mainBundle.slice(1)), "utf8");
  const problems = [];
  if (/__PC_BUILD__/.test(js)) problems.push("the __PC_BUILD__ identifier survived: vite `define` did not apply");
  if (!/"?builtAt"?:"20\d\d-\d\d-\d\dT\d\d:\d\d:\d\d/.test(js)) problems.push("no build-time builtAt literal in the main bundle");
  if (!/"?commit"?:/.test(js) || !/"?deployId"?:/.test(js)) problems.push("stamp object keys not found in the main bundle");
  if (!/BUILD STAMP MISSING/.test(js)) problems.push("the MISSING text is not in the main bundle");
  const onNetlify = Boolean(process.env.NETLIFY || process.env.DEPLOY_ID || process.env.BUILD_ID || process.env.SITE_ID);
  if (onNetlify) {
    // Match the literal's own values, not the env: the env could be set while
    // the define silently dropped it.
    const commitLit = js.match(/"?commit"?:"([0-9a-f]{7,40})"/);
    const deployLit = js.match(/"?deployId"?:"([0-9a-f]{8,})"/);
    if (!commitLit) problems.push("Netlify build but the main bundle carries no commit literal: COMMIT_REF was empty at build time");
    if (!deployLit) problems.push("Netlify build but the main bundle carries no deployId literal: DEPLOY_ID was empty at build time");
    if (commitLit && process.env.COMMIT_REF && commitLit[1] !== String(process.env.COMMIT_REF).trim())
      problems.push(`bundle commit ${commitLit[1]} != build env COMMIT_REF ${process.env.COMMIT_REF}`);

    // ── Staleness cross-check: deploy-context.json describes THIS build ────
    // The function bundles carry netlify/lib/deploy-context.json and the
    // Release 2 gate trusts it. Netlify does not hand each build a clean
    // checkout — the previous deploy's files can still be on disk (that is how
    // a stale dist/ failed PR #47 in `yarn test`) — so a build whose writer
    // step did not run could ship a bundle whose context file describes an
    // OLDER deploy. Two comparisons, both here because this is the one step
    // that runs after the build and can fail the deploy: the file against the
    // build environment, and the file against the client bundle's own
    // __PC_BUILD__ commit. Local builds write nulls and are not checked.
    const DC = join(ROOT, "netlify/lib/deploy-context.json");
    if (!existsSync(DC)) {
      problems.push("netlify/lib/deploy-context.json is absent on a Netlify build: scripts/write-deploy-context.mjs did not run");
    } else {
      let dc = null;
      try { dc = JSON.parse(readFileSync(DC, "utf8")); } catch { problems.push("netlify/lib/deploy-context.json is not valid JSON"); }
      if (dc) {
        const ctxCommit = String(dc.commitRef ?? "").trim();
        if (!ctxCommit) {
          problems.push("deploy-context.json carries no commitRef on a Netlify build");
        } else {
          if (process.env.COMMIT_REF && ctxCommit !== String(process.env.COMMIT_REF).trim())
            problems.push(`deploy-context.json commitRef ${ctxCommit} != build env COMMIT_REF ${process.env.COMMIT_REF} (stale context file)`);
          if (commitLit && ctxCommit !== commitLit[1])
            problems.push(`deploy-context.json commitRef ${ctxCommit} != bundle __PC_BUILD__ commit ${commitLit[1]} (one of the two is stale)`);
        }
        if (!String(dc.context ?? "").trim())
          problems.push("deploy-context.json carries no context on a Netlify build");
      }
    }
  }
  if (problems.length) {
    die("inject-sw-manifest: BUILD STAMP invariant failed; refusing to ship a bundle that cannot identify itself:",
        ...problems.map((p) => "  " + p),
        `  (bundle: ${mainBundle}, netlify=${onNetlify})`);
  }
  console.log(`inject-sw-manifest: build stamp present in ${mainBundle}${onNetlify ? " (Netlify: commit + deployId literals verified; deploy-context.json agrees)" : " (local build: MISSING stamp is expected and present)"}`);
}

// Validation passed. Only now is anything written.
if (pendingWrite !== null) writeFileSync(SW, pendingWrite, "utf8");

const unreferenced = manifest.filter((u) => !requested.has(u));

console.log(`inject-sw-manifest: ${mode}; manifest carries ${manifest.length} build asset(s)`);
for (const a of manifest) console.log(`  ${requested.has(a) ? "html-referenced" : "not-in-html   "} ${a}`);
console.log(`  validated: ${requested.size} asset(s) referenced by src=/href= in ${entryHtml.length} entry point(s), all present`);
console.log(`  coverage: entry-point HTML asset references only — JS imports, dynamically constructed URLs and runtime fetches are NOT covered`);
if (unreferenced.length) {
  console.log(`  note: ${unreferenced.length} manifest asset(s) are not referenced from entry HTML (lazy chunks reached via import()) — cached, which is intended`);
}
