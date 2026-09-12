// scripts/tests/check-build-env.test.js
// The guard that stops a staging build compiling the browser bundle against
// production. The failure it prevents is silent: functions would talk to
// staging while the browser talked to production, and every server-side check
// would pass.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  checkBuildEnv,
  refFromUrl,
  resolveMode,
  loadResolvedEnv,
  attributeSource,
  isHostedBuild,
  isIdentifiedProductionSite,
  PRODUCTION_REF,
  PRODUCTION_SLUG,
  PRODUCTION_SITE_NAMES,
} from "../check-build-env.mjs";

const STAGING_REF = "lboajqihpsfrokqvjgnl";
const PROD_URL = `https://${PRODUCTION_REF}.supabase.co`;
const STAGING_URL = `https://${STAGING_REF}.supabase.co`;

function fixture(files = {}) {
  const dir = mkdtempSync(join(tmpdir(), "buildenv-"));
  mkdirSync(dir, { recursive: true });
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
  return dir;
}
const cleanup = (d) => rmSync(d, { recursive: true, force: true });

const stagingEnv = (over = {}) => ({
  EXPECTED_SUPABASE_REF: STAGING_REF,
  VITE_STORE_SLUG: "staging-t1-store",
  STORE_SLUG: "staging-t1-store",
  ...over,
});

test("refFromUrl extracts the project ref, and rejects a non-Supabase URL", () => {
  assert.equal(refFromUrl(PROD_URL), PRODUCTION_REF);
  assert.equal(refFromUrl(`${STAGING_URL}/`), STAGING_REF);
  assert.equal(refFromUrl("https://evil.example.com"), "");
  assert.equal(refFromUrl(""), "");
});

test("resolveMode: defaults to production, honours --mode and MODE", () => {
  assert.equal(resolveMode({}), "production");
  assert.equal(resolveMode({ __ARGV: ["--mode", "staging"] }), "staging");
  assert.equal(resolveMode({ __ARGV: ["--mode=staging"] }), "staging");
  assert.equal(resolveMode({ MODE: "qa" }), "qa");
});

test("P1: mode files outrank .env.local — resolved through Vite, not reimplemented", () => {
  const dir = fixture({
    ".env": `VITE_SUPABASE_URL=${PROD_URL}`,
    ".env.local": `VITE_SUPABASE_URL=${STAGING_URL}`,
    ".env.production.local": `VITE_SUPABASE_URL=${PROD_URL}`,
  });
  try {
    const { values } = loadResolvedEnv({ env: {}, root: dir, mode: "production" });
    assert.equal(values.VITE_SUPABASE_URL, PROD_URL, "the mode file must win");
    assert.equal(attributeSource("VITE_SUPABASE_URL", { env: {}, root: dir, mode: "production" }),
      ".env.production.local");
  } finally {
    cleanup(dir);
  }
});

test("attributeSource walks Vite's precedence order", () => {
  const dir = fixture({
    ".env": `VITE_SUPABASE_URL=${PROD_URL}`,
    ".env.local": `VITE_SUPABASE_URL=${STAGING_URL}`,
  });
  try {
    assert.equal(attributeSource("VITE_SUPABASE_URL", { env: {}, root: dir, mode: "production" }), ".env.local");
    assert.equal(
      attributeSource("VITE_SUPABASE_URL", { env: { VITE_SUPABASE_URL: "x" }, root: dir, mode: "production" }),
      "environment"
    );
  } finally {
    cleanup(dir);
  }
});

test("falls back to .env when nothing else supplies it", () => {
  const dir = fixture({ ".env": `VITE_SUPABASE_URL=${PROD_URL}` });
  try {
    const { values } = loadResolvedEnv({ env: {}, root: dir, mode: "production" });
    assert.equal(values.VITE_SUPABASE_URL, PROD_URL);
    assert.equal(attributeSource("VITE_SUPABASE_URL", { env: {}, root: dir, mode: "production" }), ".env");
  } finally {
    cleanup(dir);
  }
});

test("THE BUG: staging site with no env of its own inherits production from the tracked .env — REFUSED", () => {
  const dir = fixture({
    ".env": `VITE_SUPABASE_URL=${PROD_URL}\nVITE_SUPABASE_ANON_KEY=sb_publishable_prod`,
  });
  try {
    const r = checkBuildEnv({ env: stagingEnv(), root: dir });
    assert.equal(r.ok, false);
    assert.equal(r.actualRef, PRODUCTION_REF);
    assert.equal(r.source, ".env");
    const joined = r.errors.join("\n");
    assert.match(joined, /WRONG PROJECT/);
    assert.match(joined, /This is PRODUCTION/);
  } finally {
    cleanup(dir);
  }
});

test("THE OTHER HALF: the old netlify.toml value arrives as environment — still REFUSED for staging", () => {
  // netlify.toml [build.environment] lands in the build's shell env and
  // outranks dashboard variables, which is exactly how it beat staging's own.
  const dir = fixture({});
  try {
    const r = checkBuildEnv({
      env: stagingEnv({ VITE_SUPABASE_URL: PROD_URL, VITE_SUPABASE_ANON_KEY: "sb_publishable_prod" }),
      root: dir,
    });
    assert.equal(r.ok, false);
    assert.equal(r.source, "environment");
    assert.match(r.errors.join("\n"), /WRONG PROJECT/);
  } finally {
    cleanup(dir);
  }
});

test("staging pointed at staging PASSES", () => {
  const dir = fixture({ ".env": `VITE_SUPABASE_URL=${PROD_URL}\nVITE_SUPABASE_ANON_KEY=sb_publishable_prod` });
  try {
    const r = checkBuildEnv({
      env: stagingEnv({ VITE_SUPABASE_URL: STAGING_URL, VITE_SUPABASE_ANON_KEY: "sb_publishable_staging" }),
      root: dir,
    });
    assert.equal(r.ok, true, r.errors.join("\n"));
    assert.equal(r.actualRef, STAGING_REF);
  } finally {
    cleanup(dir);
  }
});

test("production is unchanged: EXPECTED_SUPABASE_REF unset + .env production PASSES", () => {
  // The transition must not break production, which has no dashboard change yet.
  const dir = fixture({
    ".env": `VITE_SUPABASE_URL=${PROD_URL}\nVITE_SUPABASE_ANON_KEY=sb_publishable_prod`,
  });
  try {
    const r = checkBuildEnv({ env: {}, root: dir });
    assert.equal(r.ok, true, r.errors.join("\n"));
    assert.equal(r.expectedRef, PRODUCTION_REF);
    assert.match(r.notes.join("\n"), /LOCAL build — production assumed/);
  } finally {
    cleanup(dir);
  }
});

test("production guard still bites: unset expectation but a non-production URL is REFUSED", () => {
  const dir = fixture({});
  try {
    const r = checkBuildEnv({
      env: { VITE_SUPABASE_URL: STAGING_URL, VITE_SUPABASE_ANON_KEY: "k" },
      root: dir,
    });
    assert.equal(r.ok, false);
    assert.match(r.errors.join("\n"), /WRONG PROJECT/);
  } finally {
    cleanup(dir);
  }
});

test("a missing browser config is refused, not defaulted", () => {
  const dir = fixture({});
  try {
    const r = checkBuildEnv({ env: stagingEnv(), root: dir });
    assert.equal(r.ok, false);
    assert.match(r.errors.join("\n"), /VITE_SUPABASE_URL resolves to nothing/);
  } finally {
    cleanup(dir);
  }
});

test("URL and key from different sources is refused (mismatched pair)", () => {
  const dir = fixture({ ".env": `VITE_SUPABASE_ANON_KEY=sb_publishable_prod` });
  try {
    const r = checkBuildEnv({ env: stagingEnv({ VITE_SUPABASE_URL: STAGING_URL }), root: dir });
    assert.equal(r.ok, false);
    assert.match(r.errors.join("\n"), /different sources/);
  } finally {
    cleanup(dir);
  }
});

test("non-production build refuses an unset store slug — it defaults to store4979", () => {
  const dir = fixture({});
  try {
    const r = checkBuildEnv({
      env: {
        EXPECTED_SUPABASE_REF: STAGING_REF,
        VITE_SUPABASE_URL: STAGING_URL,
        VITE_SUPABASE_ANON_KEY: "k",
      },
      root: dir,
    });
    assert.equal(r.ok, false);
    const joined = r.errors.join("\n");
    assert.match(joined, /VITE_STORE_SLUG is unset/);
    assert.match(joined, /STORE_SLUG is unset/);
    assert.match(joined, new RegExp(PRODUCTION_SLUG));
  } finally {
    cleanup(dir);
  }
});

test("non-production build refuses an explicit store4979 slug", () => {
  const dir = fixture({});
  try {
    const r = checkBuildEnv({
      env: stagingEnv({
        VITE_SUPABASE_URL: STAGING_URL,
        VITE_SUPABASE_ANON_KEY: "k",
        VITE_STORE_SLUG: PRODUCTION_SLUG,
        STORE_SLUG: PRODUCTION_SLUG,
      }),
      root: dir,
    });
    assert.equal(r.ok, false);
    assert.match(r.errors.join("\n"), /is "store4979" on a non-production build/);
  } finally {
    cleanup(dir);
  }
});

test("the guard states what it does NOT check — function runtime vars", () => {
  const dir = fixture({ ".env": `VITE_SUPABASE_URL=${PROD_URL}\nVITE_SUPABASE_ANON_KEY=k` });
  try {
    const r = checkBuildEnv({ env: {}, root: dir });
    assert.equal(r.ok, true);
    // A green build must not imply the server half was verified.
    assert.match(r.notes.join("\n"), /NOT CHECKED: function runtime vars/);
    assert.match(r.notes.join("\n"), /SUPABASE_SERVICE_ROLE_KEY/);
  } finally {
    cleanup(dir);
  }
});

test("netlify.toml no longer hard-codes the Supabase project identity", async () => {
  const { readFileSync } = await import("node:fs");
  const toml = readFileSync(new URL("../../netlify.toml", import.meta.url), "utf8");
  // The assignment is what matters; the explanatory comment may name the ref.
  const assigns = toml
    .split(/\r?\n/)
    .filter((l) => /^\s*VITE_SUPABASE_(URL|ANON_KEY)\s*=/.test(l));
  assert.deepEqual(assigns, [], "netlify.toml must not assign Supabase identity — it outranks dashboard vars");
  assert.match(toml, /check-build-env\.mjs/, "the guard must run in the build command");
});

test("P2: hosted build with EVERY setting omitted is REFUSED", () => {
  // The bypass: absence used to mean production, so a hosted staging site that
  // set nothing was indistinguishable from production and exited 0.
  const dir = fixture({ ".env": `VITE_SUPABASE_URL=${PROD_URL}\nVITE_SUPABASE_ANON_KEY=k` });
  try {
    const r = checkBuildEnv({
      env: { NETLIFY: "true", SITE_ID: "a1b2c3-staging", SITE_NAME: "printcalculator2-staging", CONTEXT: "deploy-preview" },
      root: dir,
      mode: "production",
    });
    assert.equal(r.ok, false);
    const joined = r.errors.join("\n");
    assert.match(joined, /not set on a HOSTED build/);
    assert.match(joined, /Absence is not evidence of production/);
  } finally {
    cleanup(dir);
  }
});

test("P2: hosted build with NO site name at all is REFUSED", () => {
  const dir = fixture({ ".env": `VITE_SUPABASE_URL=${PROD_URL}\nVITE_SUPABASE_ANON_KEY=k` });
  try {
    const r = checkBuildEnv({ env: { CI: "true" }, root: dir, mode: "production" });
    assert.equal(r.ok, false);
    assert.match(r.errors.join("\n"), /not set on a HOSTED build/);
  } finally {
    cleanup(dir);
  }
});

test("P2: only the POSITIVELY identified production site may omit it", () => {
  const dir = fixture({ ".env": `VITE_SUPABASE_URL=${PROD_URL}\nVITE_SUPABASE_ANON_KEY=k` });
  try {
    const r = checkBuildEnv({
      env: { NETLIFY: "true", SITE_NAME: PRODUCTION_SITE_NAMES[0] },
      root: dir,
      mode: "production",
    });
    assert.equal(r.ok, true, r.errors.join("\n"));
    assert.equal(r.identifiedProd, true);
    assert.match(r.notes.join("\n"), /positively identified as production/);
  } finally {
    cleanup(dir);
  }
});

test("P2: a local build may still omit it — the tracked .env is production", () => {
  const dir = fixture({ ".env": `VITE_SUPABASE_URL=${PROD_URL}\nVITE_SUPABASE_ANON_KEY=k` });
  try {
    const r = checkBuildEnv({ env: {}, root: dir, mode: "production" });
    assert.equal(r.ok, true, r.errors.join("\n"));
    assert.equal(r.hosted, false);
    assert.match(r.notes.join("\n"), /LOCAL build/);
  } finally {
    cleanup(dir);
  }
});

test("isHostedBuild / isIdentifiedProductionSite", () => {
  assert.equal(isHostedBuild({}), false);
  for (const k of ["NETLIFY", "CI", "BUILD_ID", "DEPLOY_ID", "SITE_ID"]) {
    assert.equal(isHostedBuild({ [k]: "1" }), true, k);
  }
  assert.equal(isIdentifiedProductionSite({ SITE_NAME: PRODUCTION_SITE_NAMES[0] }), true);
  assert.equal(isIdentifiedProductionSite({ SITE_NAME: "PrintCalculator2" }), true, "case-insensitive");
  assert.equal(isIdentifiedProductionSite({ SITE_NAME: "printcalculator2-staging" }), false);
  assert.equal(isIdentifiedProductionSite({}), false);
});

test("the guard reports which branch applied, and never claims a false one", () => {
  const dir = fixture({ ".env": `VITE_SUPABASE_URL=${PROD_URL}\nVITE_SUPABASE_ANON_KEY=k` });
  try {
    const r = checkBuildEnv({ env: { NETLIFY: "true", SITE_NAME: "some-other-site" }, root: dir, mode: "production" });
    // It must NOT say the site was identified as production.
    assert.doesNotMatch(r.notes.join("\n"), /positively identified as production/);
    assert.match(r.notes.join("\n"), /NOT identified as production/);
  } finally {
    cleanup(dir);
  }
});
