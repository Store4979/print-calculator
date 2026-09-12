// scripts/tests/build-env-bundle.test.js
// EMITTED-BUNDLE regression for the mode-file bypass (P1).
//
// The guard's unit tests assert what the guard REPORTS. That is exactly what
// was insufficient: the first version reported "staging" while Vite emitted
// production, because the guard hand-rolled a precedence order that omitted
// .env.[mode] and .env.[mode].local. A test of the reporter cannot catch a
// reporter that disagrees with the compiler.
//
// So this builds a real (tiny) Vite project with the same env-file layout that
// produced the bypass, greps the EMITTED bundle, and requires the guard's
// verdict to match what Vite actually baked in. Equivalence is asserted against
// the compiler, not against a second implementation of its rules.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "vite";

import { checkBuildEnv, PRODUCTION_REF } from "../check-build-env.mjs";

const STAGING_REF = "lboajqihpsfrokqvjgnl";
const PROD_URL = `https://${PRODUCTION_REF}.supabase.co`;
const STAGING_URL = `https://${STAGING_REF}.supabase.co`;

// A minimal app whose only job is to bake VITE_SUPABASE_URL into the output.
function project(envFiles) {
  const dir = mkdtempSync(join(tmpdir(), "bundle-env-"));
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(
    join(dir, "src", "main.js"),
    `export const backend = import.meta.env.VITE_SUPABASE_URL;\nconsole.log(backend);\n`
  );
  for (const [name, body] of Object.entries(envFiles)) writeFileSync(join(dir, name), body);
  return dir;
}

// Vite reads process.env at build time, so the RUNNER's environment reaches
// the bundle. On Netlify that means the production site's own
// VITE_SUPABASE_URL — which silently overrides the .env files these tests are
// about, and makes them pass or fail for reasons unrelated to the case under
// test. Verified: with a production VITE_SUPABASE_URL exported, two of these
// tests failed locally exactly as they would have in CI.
//
// So the VITE_SUPABASE_* variables are cleared for the duration of the build
// unless a test explicitly wants a shell value (keepShellEnv).
async function buildAndRead(dir, mode, { keepShellEnv = false } = {}) {
  const managed = ["VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY", "VITE_STORE_SLUG", "STORE_SLUG"];
  const saved = {};
  if (!keepShellEnv) {
    for (const k of managed) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  }
  try {
    await build({
      root: dir,
      mode,
      logLevel: "silent",
      build: {
        outDir: join(dir, "dist"),
        lib: { entry: join(dir, "src", "main.js"), formats: ["es"], fileName: "out" },
        minify: false,
        emptyOutDir: true,
      },
    });
  } finally {
    if (!keepShellEnv) {
      for (const k of managed) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    }
  }
  const outDir = join(dir, "dist");
  return readdirSync(outDir)
    .filter((f) => f.endsWith(".js") || f.endsWith(".mjs"))
    .map((f) => readFileSync(join(outDir, f), "utf8"))
    .join("\n");
}

const envPair = (url) => `VITE_SUPABASE_URL=${url}\nVITE_SUPABASE_ANON_KEY=key_for_${url.slice(8, 16)}\n`;

test("P1 REGRESSION: .env.production.local outranks .env.local, and the guard agrees with the bundle", async () => {
  // The exact layout that bypassed the first version: staging in .env.local,
  // production in .env.production.local, expecting staging.
  const dir = project({
    ".env": envPair(PROD_URL),
    ".env.local": envPair(STAGING_URL),
    ".env.production.local": envPair(PROD_URL),
  });
  try {
    const emitted = await buildAndRead(dir, "production");
    const bundleHasProd = emitted.includes(PRODUCTION_REF);
    const bundleHasStaging = emitted.includes(STAGING_REF);

    // What Vite actually did: mode file wins.
    assert.equal(bundleHasProd, true, "expected the production ref in the emitted bundle");
    assert.equal(bundleHasStaging, false, "staging ref must NOT be in the bundle");

    // What the guard says about the same tree. It must REFUSE, and it must
    // name the mode file — the first version said "OK (from .env.local)".
    const r = checkBuildEnv({
      env: { EXPECTED_SUPABASE_REF: STAGING_REF, VITE_STORE_SLUG: "s", STORE_SLUG: "s" },
      root: dir,
      mode: "production",
    });
    assert.equal(r.ok, false, "guard must refuse when the bundle would target production");
    assert.equal(r.actualRef, PRODUCTION_REF, "guard must resolve the same ref Vite baked in");
    assert.equal(r.source, ".env.production.local");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("P1 REGRESSION: .env.production also outranks .env.local", async () => {
  const dir = project({
    ".env.local": envPair(STAGING_URL),
    ".env.production": envPair(PROD_URL),
  });
  try {
    const emitted = await buildAndRead(dir, "production");
    assert.equal(emitted.includes(PRODUCTION_REF), true);
    const r = checkBuildEnv({
      env: { EXPECTED_SUPABASE_REF: STAGING_REF, VITE_STORE_SLUG: "s", STORE_SLUG: "s" },
      root: dir,
      mode: "production",
    });
    assert.equal(r.ok, false);
    assert.equal(r.source, ".env.production");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a correctly configured staging tree emits staging, and the guard passes", async () => {
  const dir = project({
    ".env": envPair(PROD_URL),
    ".env.production.local": envPair(STAGING_URL),
  });
  try {
    const emitted = await buildAndRead(dir, "production");
    assert.equal(emitted.includes(STAGING_REF), true);
    assert.equal(emitted.includes(PRODUCTION_REF), false);
    const r = checkBuildEnv({
      env: { EXPECTED_SUPABASE_REF: STAGING_REF, VITE_STORE_SLUG: "s", STORE_SLUG: "s" },
      root: dir,
      mode: "production",
    });
    assert.equal(r.ok, true, r.errors.join("\n"));
    assert.equal(r.actualRef, STAGING_REF);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("shell env beats every file, in the bundle and in the guard", async () => {
  const dir = project({
    ".env": envPair(PROD_URL),
    ".env.production.local": envPair(PROD_URL),
  });
  const saved = process.env.VITE_SUPABASE_URL;
  try {
    process.env.VITE_SUPABASE_URL = STAGING_URL;
    const emitted = await buildAndRead(dir, "production", { keepShellEnv: true });
    assert.equal(emitted.includes(STAGING_REF), true, "shell value must win in the bundle");
    const r = checkBuildEnv({
      env: {
        VITE_SUPABASE_URL: STAGING_URL,
        VITE_SUPABASE_ANON_KEY: "k",
        EXPECTED_SUPABASE_REF: STAGING_REF,
        VITE_STORE_SLUG: "s",
        STORE_SLUG: "s",
      },
      root: dir,
      mode: "production",
    });
    assert.equal(r.ok, true, r.errors.join("\n"));
    assert.equal(r.source, "environment");
  } finally {
    if (saved === undefined) delete process.env.VITE_SUPABASE_URL;
    else process.env.VITE_SUPABASE_URL = saved;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an explicitly EMPTY shell value is honoured as empty, not skipped", async () => {
  // The hand-rolled resolver skipped empty strings and fell through to the
  // files; Vite treats an empty shell value as the value. That disagreement is
  // its own bypass shape, so it is pinned here against the real compiler.
  const dir = project({ ".env": envPair(PROD_URL) });
  const saved = process.env.VITE_SUPABASE_URL;
  try {
    process.env.VITE_SUPABASE_URL = "";
    const emitted = await buildAndRead(dir, "production", { keepShellEnv: true });
    assert.equal(emitted.includes(PRODUCTION_REF), false, "an empty shell value must not fall back to .env");

    const r = checkBuildEnv({
      env: { VITE_SUPABASE_URL: "", VITE_SUPABASE_ANON_KEY: "", EXPECTED_SUPABASE_REF: PRODUCTION_REF },
      root: dir,
      mode: "production",
    });
    assert.equal(r.ok, false, "an empty browser config must be refused, not defaulted");
    assert.match(r.errors.join("\n"), /resolves to nothing/);
  } finally {
    if (saved === undefined) delete process.env.VITE_SUPABASE_URL;
    else process.env.VITE_SUPABASE_URL = saved;
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── MODE SELECTION: guard CLI and a real build, SAME env, NO injected mode ───
//
// The tests above inject mode:"production" into both sides, so they verify
// precedence AFTER a mode is chosen and never exercise mode selection itself.
// That is exactly the gap the second P1 slipped through: VITE_MODE / MODE /
// NODE_ENV moved the guard's mode while Vite's stayed "production".
//
// These run the guard as a SUBPROCESS (its real CLI path, reading its own
// process.env) and `vite build` with NO mode argument — the same unqualified
// invocation netlify.toml uses — under one shared environment. Nothing is
// injected on either side.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const GUARD = fileURLToPath(new URL("../check-build-env.mjs", import.meta.url));

// Build the child's environment from a KNOWN BASE rather than inheriting the
// runner's. On Netlify, process.env carries the production site's own
// VITE_SUPABASE_URL / SITE_NAME / NETLIFY, which would reach the child and
// change what it resolves — the test would then pass or fail for reasons that
// have nothing to do with the case under test. Only PATH-ish essentials are
// inherited; every variable the guard reads is set explicitly here.
const GUARD_READS = [
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_ANON_KEY",
  "VITE_STORE_SLUG",
  "STORE_SLUG",
  "EXPECTED_SUPABASE_REF",
  "SITE_NAME",
  "SITE_ID",
  "NETLIFY",
  "CI",
  "BUILD_ID",
  "DEPLOY_ID",
  "NODE_ENV",
  "MODE",
  "VITE_MODE",
];

function runGuard(env, root) {
  const base = {};
  for (const k of ["PATH", "HOME", "TMPDIR", "SystemRoot", "USERPROFILE", "APPDATA"]) {
    if (process.env[k] !== undefined) base[k] = process.env[k];
  }
  const childEnv = { ...base, BUILD_ENV_ROOT: root };
  for (const k of GUARD_READS) if (env[k] !== undefined) childEnv[k] = env[k];
  try {
    execFileSync(process.execPath, [GUARD], { env: childEnv, encoding: "utf8", stdio: "pipe" });
    return { code: 0 };
  } catch (e) {
    return { code: e.status ?? 1, out: String(e.stdout ?? "") + String(e.stderr ?? "") };
  }
}

// The env-file layout that makes a wrong mode look correct: staging in
// .env.local (what a mis-moded guard reads) and production in
// .env.production.local (what Vite actually reads).
const trapFiles = () => ({
  ".env": envPair(PROD_URL),
  ".env.local": envPair(STAGING_URL),
  ".env.production.local": envPair(PROD_URL),
});

for (const [label, extraEnv] of [
  ["NODE_ENV=development", { NODE_ENV: "development" }],
  ["MODE=staging", { MODE: "staging" }],
  ["VITE_MODE=staging", { VITE_MODE: "staging" }],
  ["no mode vars at all", {}],
]) {
  test(`mode selection — ${label}: guard REFUSES and the bundle is production`, async () => {
    const dir = project(trapFiles());
    try {
      // runGuard builds the child env from a known base, so nothing from the
      // runner (or from Netlify) leaks in. VITE_SUPABASE_* are deliberately
      // absent, forcing resolution through the env FILES — which is the whole
      // point of a mode-selection test.
      const env = {
        ...extraEnv,
        EXPECTED_SUPABASE_REF: STAGING_REF,
        VITE_STORE_SLUG: "staging-t1-store",
        STORE_SLUG: "staging-t1-store",
      };

      // 1. The real build, no --mode, same env.
      const savedEnv = { ...process.env };
      for (const [k, v] of Object.entries(extraEnv)) process.env[k] = v;
      let emitted;
      try {
        emitted = await buildAndRead(dir, undefined);
      } finally {
        for (const k of Object.keys(extraEnv)) {
          if (savedEnv[k] === undefined) delete process.env[k];
          else process.env[k] = savedEnv[k];
        }
      }
      assert.equal(emitted.includes(PRODUCTION_REF), true, "Vite must have used mode=production");
      assert.equal(emitted.includes(STAGING_REF), false);

      // 2. The guard CLI, same env, must refuse.
      const r = runGuard(env, dir);
      assert.equal(r.code, 1, `guard must REFUSE; got exit ${r.code}\n${r.out ?? ""}`);
      assert.match(r.out, /WRONG PROJECT/);
      assert.match(r.out, /\.env\.production\.local/, "must name the file Vite actually read");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

test("mode selection — a fully configured staging tree still PASSES the CLI", async () => {
  // The control: the fix must refuse a wrong mode without refusing a correct build.
  const dir = project({ ".env": envPair(PROD_URL), ".env.production.local": envPair(STAGING_URL) });
  try {
    const emitted = await buildAndRead(dir, undefined);
    assert.equal(emitted.includes(STAGING_REF), true);
    const r = runGuard(
      {
        EXPECTED_SUPABASE_REF: STAGING_REF,
        VITE_STORE_SLUG: "staging-t1-store",
        STORE_SLUG: "staging-t1-store",
        NODE_ENV: "development",
        MODE: "staging",
      },
      dir
    );
    assert.equal(r.code, 0, `guard must PASS; got ${r.code}\n${r.out ?? ""}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("mode selection — production control still PASSES the CLI", async () => {
  const dir = project({ ".env": envPair(PROD_URL) });
  try {
    const r = runGuard({ NETLIFY: "true", SITE_NAME: "printcalculator2" }, dir);
    assert.equal(r.code, 0, `production must PASS; got ${r.code}\n${r.out ?? ""}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("MODE INVARIANT: the real netlify.toml AND package.json both match expectations", async () => {
  // Two mutation points, not one. netlify.toml runs `yarn build`, which runs
  // package.json's "build" script, which is where `vite build` actually lives.
  const { readFileSync } = await import("node:fs");
  const { modeInvariantErrors, BUILD_MODE } = await import("../check-build-env.mjs");

  const toml = readFileSync(new URL("../../netlify.toml", import.meta.url), "utf8");
  const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
  const tomlCommand = /^\s*command\s*=\s*"([^"]+)"/m.exec(toml)?.[1] ?? "";

  assert.equal(BUILD_MODE, "production");
  const errors = modeInvariantErrors({
    tomlCommand,
    packageBuildScript: pkg.scripts?.build,
  });
  assert.deepEqual(errors, [], errors.join("\n"));
});

// ── FALSIFICATION: each mutation point must break the invariant ─────────────
// The previous version of this test read only netlify.toml, so mutating
// package.json to `vite build --mode staging` left all 104 tests passing while
// the real build mode changed. Verified, and the consequence was a guard
// exiting 0 in pinned production mode against a bundle built in staging mode.
// These cases exist so that gap cannot be re-introduced silently in EITHER file.
const REAL_TOML_COMMAND =
  "yarn install && yarn test && node scripts/check-build-env.mjs && yarn build && node scripts/inject-sw-manifest.mjs";

for (const [label, mutation, expectMatch] of [
  [
    "package.json gains --mode staging",
    { tomlCommand: REAL_TOML_COMMAND, packageBuildScript: "vite build --mode staging" },
    /package\.json "build" is/,
  ],
  [
    "package.json gains --mode production (still an unexpected command)",
    { tomlCommand: REAL_TOML_COMMAND, packageBuildScript: "vite build --mode production" },
    /package\.json "build" is/,
  ],
  [
    "package.json switches bundler",
    { tomlCommand: REAL_TOML_COMMAND, packageBuildScript: "rollup -c" },
    /package\.json "build" is/,
  ],
  [
    "netlify.toml gains --mode staging",
    { tomlCommand: REAL_TOML_COMMAND + " --mode staging", packageBuildScript: "vite build" },
    /netlify\.toml build command changed/,
  ],
  [
    "netlify.toml drops the guard entirely",
    {
      tomlCommand: "yarn install && yarn test && yarn build && node scripts/inject-sw-manifest.mjs",
      packageBuildScript: "vite build",
    },
    /netlify\.toml build command changed/,
  ],
]) {
  test(`FALSIFICATION — ${label}: the invariant must FAIL`, async () => {
    const { modeInvariantErrors } = await import("../check-build-env.mjs");
    const errors = modeInvariantErrors(mutation);
    assert.ok(errors.length > 0, "mutation went undetected");
    assert.match(errors.join("\n"), expectMatch);
  });
}

test("FALSIFICATION — the unmutated pair passes (control)", async () => {
  const { modeInvariantErrors } = await import("../check-build-env.mjs");
  assert.deepEqual(
    modeInvariantErrors({ tomlCommand: REAL_TOML_COMMAND, packageBuildScript: "vite build" }),
    []
  );
});

test("an explicit --mode in either file must equal BUILD_MODE", async () => {
  const { modeInvariantErrors } = await import("../check-build-env.mjs");
  // Even if someone updates the EXPECTED_* strings, a mismatched mode is caught.
  const errs = modeInvariantErrors({
    tomlCommand: REAL_TOML_COMMAND,
    packageBuildScript: "vite build --mode staging",
    buildMode: "production",
  });
  assert.match(errs.join("\n"), /--mode staging but BUILD_MODE is "production"/);
});
