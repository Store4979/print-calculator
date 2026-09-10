#!/usr/bin/env node
// Enumerate the built assets into dist/sw.js.
//
// The service worker's cache allowlist must be a LIST, not a pattern: a
// prefix-plus-extension rule caches whatever happens to land under that
// prefix, which is how "static asset" quietly grows to include things it
// should not. Vite emits content-hashed filenames that cannot be known when
// sw.js is authored, so they are injected here, after the build.
//
// Failure mode is deliberate: if this never runs, BUILD_ASSETS stays [] and
// the worker caches only the hand-listed shell. Degraded, never unsafe.
//
// Node-only, no dependencies, and path handling is POSIX-normalised so the
// URLs it writes are identical on Windows and Linux.
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DIST = join(ROOT, "dist");
const SW = join(DIST, "sw.js");
const MARKER = "/*__BUILD_ASSETS__*/";

// Only these extensions, and only under /assets/, are eligible. Anything the
// build emits elsewhere must be added to CORE in sw.js by hand, on purpose.
const ELIGIBLE = /\.(?:js|css|woff2)$/i;

const walk = (dir) =>
  readdirSync(dir).flatMap((entry) => {
    const p = join(dir, entry);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

if (!existsSync(SW)) {
  console.error("inject-sw-manifest: dist/sw.js not found — did the build run?");
  process.exit(1);
}

const assetsDir = join(DIST, "assets");
const assets = existsSync(assetsDir)
  ? walk(assetsDir)
      .map((p) => "/" + relative(DIST, p).split(sep).join("/"))
      .filter((u) => ELIGIBLE.test(u))
      .sort()
  : [];

const src = readFileSync(SW, "utf8");
const hasMarker = src.includes(MARKER);
const alreadyInjected = /const BUILD_ASSETS = \[\s*"\//.test(src);

// IDEMPOTENT ON PURPOSE. A previous revision exited 1 when the marker was
// absent, which turns any second run — a retried deploy, a restored build
// cache, a local re-run — into a hard deploy failure. "Already done" is
// success, not an error.
if (!hasMarker && alreadyInjected) {
  console.log("inject-sw-manifest: dist/sw.js already carries an enumerated manifest — nothing to do.");
  process.exit(0);
}
if (!hasMarker) {
  console.error("inject-sw-manifest: dist/sw.js has neither the marker nor a manifest.");
  console.error("  This build's sw.js did not come from public/sw.js. Refusing to guess.");
  process.exit(1);
}

const list = assets.map((u) => `\n  ${JSON.stringify(u)},`).join("") + (assets.length ? "\n" : "");
const out = src.replace(MARKER, list);
writeFileSync(SW, out, "utf8");

// Verify our own output. This assertion used to live in `yarn test`, where it
// was wrong: yarn test runs BEFORE yarn build, so it was asserting on whatever
// dist/ happened to be lying around. It belongs here, after the build, where
// the thing it describes actually exists.
if (out.includes(MARKER)) {
  console.error("inject-sw-manifest: marker survived the replacement — aborting.");
  process.exit(1);
}
if (assets.length && !/const BUILD_ASSETS = \[\s*"\/assets\//.test(out)) {
  console.error("inject-sw-manifest: manifest did not take. Aborting rather than shipping an empty allowlist.");
  process.exit(1);
}
console.log(`inject-sw-manifest: enumerated ${assets.length} build asset(s) into dist/sw.js`);
for (const a of assets) console.log("  " + a);
