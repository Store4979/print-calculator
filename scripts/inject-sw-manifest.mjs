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
if (!src.includes(MARKER)) {
  console.error("inject-sw-manifest: marker not found in dist/sw.js — refusing to guess.");
  process.exit(1);
}

const list = assets.map((u) => `\n  ${JSON.stringify(u)},`).join("") + (assets.length ? "\n" : "");
writeFileSync(SW, src.replace(MARKER, list), "utf8");
console.log(`inject-sw-manifest: enumerated ${assets.length} build asset(s) into dist/sw.js`);
for (const a of assets) console.log("  " + a);
