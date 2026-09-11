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
