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

async function buildAndRead(dir, mode) {
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
    const emitted = await buildAndRead(dir, "production");
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
    const emitted = await buildAndRead(dir, "production");
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
