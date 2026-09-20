// scripts/tests/build-stamp.test.js — the client build stamp.
//
// Two properties, each with the mutant that must fail it:
//  1. The stamp reflects the RUNNING bundle: it is a compile-time literal
//     (vite.config.js `define`), read by src/lib/buildStamp.js from the
//     __PC_BUILD__ identifier and from nothing else. No fetch, no runtime
//     env, no server value. A server deploy id says what is deployed, not
//     what is executing — the distinction W1 exists to make.
//  2. A missing value renders as an unmistakable MISSING, never a blank and
//     never something that reads as a version.
// What is NOT here: any read of the repo's dist/. On Netlify `yarn test` runs
// BEFORE `yarn build`, and the checkout is not clean — the previous deploy's
// dist/ is restored with the build cache. The first version of this file read
// dist/ behind an existsSync guard, assuming CI would never have one; PR #47's
// production-site preview then failed in `yarn test` on the 09-18 bundle. The
// emitted-bundle check belongs after the build, in scripts/inject-sw-manifest.mjs
// (asserted wired and ordered below), and section 3 keeps dist/ out of this
// directory.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { stripComments } from "./source-util.mjs";
import { formatBuildStamp, MISSING_STAMP } from "../../src/lib/buildStamp.js";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const STAMP_SRC = stripComments(read("../../src/lib/buildStamp.js"));
const VITE_SRC = stripComments(read("../../vite.config.js"));
const APP_SRC = stripComments(read("../../src/App.jsx"));

// ── 1. compiled in, never fetched ──────────────────────────────────────────
test("buildStamp.js reads __PC_BUILD__ and nothing else — no fetch, no runtime env, no import.meta.env", () => {
  assert.match(STAMP_SRC, /typeof __PC_BUILD__ !== "undefined"/);
  assert.doesNotMatch(STAMP_SRC, /fetch\s*\(/, "a fetched value is a server value, not the running bundle's");
  assert.doesNotMatch(STAMP_SRC, /process\.env|import\.meta\.env/, "runtime env is not the bundle");
  assert.doesNotMatch(STAMP_SRC, /XMLHttpRequest|navigator\.|localStorage|sessionStorage/);
  assert.doesNotMatch(STAMP_SRC, /^\s*import\s/m, "no imports: nothing outside this file feeds the value");
});

test("vite.config.js defines __PC_BUILD__ from Netlify's build-time COMMIT_REF and DEPLOY_ID — the same env the build guard already reads", () => {
  assert.match(VITE_SRC, /define:\s*\{[\s\S]*__PC_BUILD__:\s*JSON\.stringify\(buildStamp\)/);
  assert.match(VITE_SRC, /env\.COMMIT_REF/);
  assert.match(VITE_SRC, /env\.DEPLOY_ID/);
  // Missing values pass through as null so the renderer can say MISSING;
  // they are never defaulted to a string that could read as a version.
  assert.match(VITE_SRC, /trim\(env\.COMMIT_REF\)\s*\|\|\s*null/);
  assert.match(VITE_SRC, /trim\(env\.DEPLOY_ID\)\s*\|\|\s*null/);
  assert.doesNotMatch(VITE_SRC, /COMMIT_REF\)\s*\|\|\s*["'][^"']+["']/, "no placeholder default");
});

test("the Admin footer renders formatBuildStamp() and carries the raw values as data attributes", () => {
  assert.match(APP_SRC, /import \{ formatBuildStamp, BUILD \} from "\.\/lib\/buildStamp\.js"/);
  assert.match(APP_SRC, /className="admin-build-stamp"/);
  assert.match(APP_SRC, /data-build-commit=\{BUILD\.commit \|\| ""\}/);
  assert.match(APP_SRC, /\{formatBuildStamp\(\)\}/);
});

test("the stamp is reachable WITHOUT an admin sign-in: the employee PIN dialog shows it, and boot logs it once", () => {
  const LOGIN_SRC = stripComments(read("../../src/components/EmployeeLogin.jsx"));
  assert.match(LOGIN_SRC, /import \{ formatBuildStamp, BUILD \} from "\.\.\/lib\/buildStamp\.js"/);
  assert.match(LOGIN_SRC, /className="emp-login-build-stamp"/);
  assert.match(LOGIN_SRC, /\{formatBuildStamp\(\)\}/);
  const MAIN_SRC = stripComments(read("../../src/main.jsx"));
  assert.match(MAIN_SRC, /console\.info\(`\[print-calculator\] \$\{formatBuildStamp\(\)\}`\)/);
});

test("the post-build invariant lives in inject-sw-manifest.mjs, runs after yarn build on Netlify, and refuses a MISSING stamp on a Netlify build", () => {
  const INJ = stripComments(read("../inject-sw-manifest.mjs"));
  assert.match(INJ, /BUILD STAMP invariant failed/);
  assert.match(INJ, /__PC_BUILD__/, "checks the identifier was replaced");
  assert.match(INJ, /builtAt/);
  assert.match(INJ, /COMMIT_REF was empty at build time/);
  assert.match(INJ, /DEPLOY_ID was empty at build time/);
  // It must run BEFORE the write, like the manifest validation.
  const invIdx = INJ.indexOf("BUILD STAMP invariant failed");
  const writeIdx = INJ.indexOf("writeFileSync(SW, pendingWrite");
  assert.ok(invIdx > 0 && writeIdx > invIdx, "the stamp check precedes the only write");
  // The check keys on the main-*.js entry bundle. Pin the entry name in the
  // Vite config so a rename cannot make the invariant silently inapplicable.
  assert.match(VITE_SRC, /input:\s*\{[\s\S]*?main:\s*path\.resolve\(__dirname,\s*'index\.html'\)/,
    "the index.html entry must be named `main` so the bundle is main-*.js and the injector's stamp check applies");
  assert.ok(INJ.includes("/assets\\/main-[\\w-]+\\.js$/"), "the injector looks for main-*.js");
});

// ── 2. missing is unmistakable ─────────────────────────────────────────────
test("a complete stamp formats as commit · deploy · time · context", () => {
  const s = formatBuildStamp({ commit: "9937728abcdef0123456", deployId: "66f1a2b3c4d5e6f7a8b9c0d1", context: "production", builtAt: "2026-09-18T14:02:11.123Z" });
  assert.equal(s, "client build 9937728abcde · deploy 66f1a2b3c4d5e6f7a8b9c0d1 · 2026-09-18T14:02:11Z · production");
});

test("a missing commit OR deploy id renders MISSING — never blank, never a placeholder that reads as a version", () => {
  const shapes = [
    { commit: null, deployId: "d", context: "production", builtAt: "2026-09-18T00:00:00.000Z" },
    { commit: "abc", deployId: null, context: "production", builtAt: "2026-09-18T00:00:00.000Z" },
    { commit: "", deployId: "", context: null, builtAt: null },
    { commit: "   ", deployId: "d", context: null, builtAt: null },
    null,
    undefined,
    {},
  ];
  for (const b of shapes) {
    const s = formatBuildStamp(b);
    assert.equal(s, MISSING_STAMP, JSON.stringify(b));
  }
  assert.match(MISSING_STAMP, /MISSING/);
  assert.match(MISSING_STAMP, /not a Netlify build/);
  assert.doesNotMatch(MISSING_STAMP, /\b\d+\.\d+/, "must not contain anything version-shaped");
  assert.doesNotMatch(MISSING_STAMP, /\b[0-9a-f]{7,}\b/, "must not contain anything SHA-shaped");
});

test("MUTANT: a renderer that falls back to 'unknown' or an empty string for a missing value would pass for a version — it must not be what ships", () => {
  // The shape this test forbids, written out so the scenario is seen to
  // distinguish it from the shipped renderer.
  const mutant = (b) => `client build ${b?.commit || "unknown"} · deploy ${b?.deployId || ""}`;
  const shipped = formatBuildStamp({ commit: null, deployId: null });
  const bad = mutant({ commit: null, deployId: null });
  assert.notEqual(shipped, bad);
  assert.doesNotMatch(shipped, /unknown ·|· $/);
  assert.match(bad, /unknown/, "the mutant reads as a version line with a soft word in it");
});

// ── 3. yarn test never reads the repo's dist/ ──────────────────────────────
// A test that reads dist/ asserts against whatever build happens to be on
// disk. On Netlify that is the PREVIOUS deploy's output, so it either fails
// the deploy for a reason unrelated to the code under test (PR #47) or, worse,
// passes on stale output. Post-build assertions live in inject-sw-manifest.mjs.
// Second time this has bitten: sw-cache.test.js ("the SOURCE worker carries
// the injection marker") already declined to read dist/ for this reason, in a
// comment; a comment is remembered, this test makes it unrepresentable.
// Temp-dir fixtures named "dist" (build-env-bundle, inject-sw-manifest) are
// fine and are not matched: the forbidden thing is a path into THIS repo.
test("no test in scripts/tests reads the repo's dist/ — post-build checks belong in inject-sw-manifest.mjs", () => {
  const here = new URL("./", import.meta.url);
  const files = readdirSync(here).filter((f) => /\.test\.js$/.test(f));
  assert.ok(files.includes("build-stamp.test.js"), "this file is in the set it checks");
  for (const f of files) {
    const src = stripComments(readFileSync(new URL(f, here), "utf8"));
    assert.doesNotMatch(src, /["'`]\.\.\/\.\.\/dist(?:\/|["'`])/, `${f} reads the repo's dist/`);
    assert.doesNotMatch(src, /\/dist\/assets\//, `${f} reads the repo's dist/assets/`);
  }
});
