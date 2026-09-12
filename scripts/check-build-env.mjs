#!/usr/bin/env node
// scripts/check-build-env.mjs — fail the build when the BROWSER bundle would be
// compiled against the wrong Supabase project.
//
// WHY THIS EXISTS
// netlify.toml used to set VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY under
// [build.environment], and its comment said "Override these in the Netlify
// dashboard if you rotate them". That is backwards: Netlify gives netlify.toml
// build variables precedence OVER dashboard variables. Since netlify.toml is
// shared by every site built from this repo, a staging site would have compiled
// its browser bundle against PRODUCTION while its functions — which read
// unprefixed SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY from the dashboard at
// RUNTIME, a separate mechanism entirely — talked to staging.
//
// That split-brain is worse than no isolation, because it looks isolated.
//
// ── TWO EXECUTED BYPASSES OF THE FIRST VERSION OF THIS FILE (both fixed here)
//
// P1 — MODE FILES. The first version hand-rolled precedence as
// [".env.local", ".env"]. Vite ALSO loads .env.[mode] and .env.[mode].local,
// and those have HIGHER precedence — and `vite build` defaults to
// mode="production" even for a staging deploy. Reproduced: staging values in
// .env.local plus production values in .env.production.local made the guard
// exit 0 reporting STAGING while the emitted bundle contained the PRODUCTION
// ref and zero staging refs.
//
// The fix is not a longer list. It is to stop reimplementing Vite's rules:
// this file now resolves through the INSTALLED Vite `loadEnv`, with the same
// mode, root and envDir the build will use. Equivalence by construction rather
// than by a parallel implementation that has to be kept in step. The same
// change fixes the related mishandling of explicitly-empty shell values, which
// the hand-rolled resolver skipped and Vite honours as empty.
//
// P2 — OMITTING EVERYTHING PASSED AS PRODUCTION. `expectedRaw || PRODUCTION_REF`
// meant absence == production, so a hosted site that set nothing at all was
// indistinguishable from production and exited 0. Verified with NETLIFY=true
// and a staging SITE_ID. A guard whose default is "assume the thing I am
// guarding against is fine" is not a guard.
//
// Now: on a HOSTED build, an explicit EXPECTED_SUPABASE_REF is REQUIRED unless
// the site is POSITIVELY identified as production by name. Absence on any other
// hosted site fails the build. Local builds still default to production,
// because the tracked .env is production and that is the developer convenience
// it exists for.
//
// WHAT THIS DOES NOT CHECK
// Function runtime vars (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY). They are
// read per request from the site's dashboard config and are invisible at build
// time. A green result here says nothing about the server half.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";

const ROOT = process.env.BUILD_ENV_ROOT || join(dirname(fileURLToPath(import.meta.url)), "..");

export const PRODUCTION_REF = "gmxyisjjaxtpycsmmzef";
export const PRODUCTION_SLUG = "store4979";
// The Netlify site that IS production. Used only to let that one site omit
// EXPECTED_SUPABASE_REF; every other hosted site must declare its ref.
export const PRODUCTION_SITE_NAMES = Object.freeze(["printcalculator2"]);

// Build mode, resolved the way the build itself will. `vite build` defaults to
// "production" — including on a staging deploy, which is exactly what made the
// mode-file bypass work. An explicit --mode/MODE wins if one is used.
export function resolveMode(env = process.env) {
  const argv = Array.isArray(env.__ARGV) ? env.__ARGV : [];
  const i = argv.indexOf("--mode");
  if (i >= 0 && argv[i + 1]) return String(argv[i + 1]).trim();
  const inline = argv.find((a) => String(a).startsWith("--mode="));
  if (inline) return String(inline).slice(7).trim();
  for (const k of ["VITE_MODE", "MODE", "NODE_ENV"]) {
    if (env[k] && String(env[k]).trim()) return String(env[k]).trim();
  }
  return "production";
}

// Resolve the whole browser-visible env through the INSTALLED Vite machinery.
//
// Do NOT reimplement Vite's precedence here. It loads .env, .env.local,
// .env.[mode] and .env.[mode].local, the mode files outrank the plain ones,
// and shell values outrank all of them — and an explicitly-empty shell value
// is honoured as empty rather than skipped. The previous hand-rolled version
// got the mode files wrong and the empty case wrong, and a parallel
// implementation would only drift again.
//
// prefix "" loads every key, not just VITE_*, because STORE_SLUG and
// EXPECTED_SUPABASE_REF are unprefixed. Vite itself only EXPOSES VITE_* to
// client code; we read the rest for our own checks.
export function loadResolvedEnv({ env = process.env, root = ROOT, mode } = {}) {
  const m = mode || resolveMode(env);
  // loadEnv reads process.env for the shell layer, so swap it for the duration
  // of the call and restore it — that keeps the function testable with an
  // injected env while still using Vite's real resolution.
  const saved = process.env;
  try {
    process.env = { ...env };
    const loaded = loadEnv(m, root, "");
    return { mode: m, values: loaded };
  } finally {
    process.env = saved;
  }
}

// Which layer supplied a value, for the failure message. Vite does not report
// this, so it is derived by re-reading the files in Vite's own precedence
// order — presentation only; the VALUE always comes from loadEnv above.
export function attributeSource(name, { env = process.env, root = ROOT, mode } = {}) {
  const m = mode || resolveMode(env);
  if (Object.prototype.hasOwnProperty.call(env, name)) return "environment";
  for (const file of [`.env.${m}.local`, `.env.${m}`, ".env.local", ".env"]) {
    const path = join(root, file);
    if (!existsSync(path)) continue;
    const text = readFileSync(path, "utf8");
    if (new RegExp(`^\\s*(export\\s+)?${name}\\s*=`, "m").test(text)) return file;
  }
  return "unset";
}

// https://<ref>.supabase.co → <ref>
export function refFromUrl(url) {
  const m = /^https:\/\/([a-z0-9]+)\.supabase\.(co|in)(\/|$)/i.exec(String(url).trim());
  return m ? m[1].toLowerCase() : "";
}

// Is this a hosted CI build, as opposed to a developer's machine?
export function isHostedBuild(env = process.env) {
  return Boolean(env.NETLIFY || env.CI || env.BUILD_ID || env.DEPLOY_ID || env.SITE_ID);
}

// Positively identified as THE production site — by name, not by absence of
// evidence. This is the ONLY hosted case allowed to omit EXPECTED_SUPABASE_REF.
export function isIdentifiedProductionSite(env = process.env) {
  const name = String(env.SITE_NAME || "").trim().toLowerCase();
  return name !== "" && PRODUCTION_SITE_NAMES.includes(name);
}

export function checkBuildEnv({ env = process.env, root = ROOT, mode } = {}) {
  const errors = [];
  const notes = [];

  const { mode: buildMode, values } = loadResolvedEnv({ env, root, mode });
  const at = (name) => attributeSource(name, { env, root, mode: buildMode });

  const expectedRaw = String(values.EXPECTED_SUPABASE_REF ?? "").trim();
  const hosted = isHostedBuild(env);
  const identifiedProd = isIdentifiedProductionSite(env);

  // P2: absence must NOT mean "production". On a hosted build the expected ref
  // is REQUIRED unless this is positively the production site.
  if (!expectedRaw && hosted && !identifiedProd) {
    errors.push(
      "EXPECTED_SUPABASE_REF is not set on a HOSTED build, and this site is not " +
        `identified as production (SITE_NAME=${JSON.stringify(env.SITE_NAME ?? null)}).\n` +
        "      Absence is not evidence of production. Set EXPECTED_SUPABASE_REF on this site.\n" +
        `      Known production site name(s): ${PRODUCTION_SITE_NAMES.join(", ")}`
    );
  }

  const expectedRef = expectedRaw || PRODUCTION_REF;
  const isProductionTarget = expectedRef === PRODUCTION_REF;

  if (!expectedRaw) {
    // Say which branch actually applied. An earlier version reported "site
    // identified as production" on a hosted build that had NOT been identified,
    // which is the false-invariant failure CLAUDE.md's comment rule is about.
    if (hosted && identifiedProd) {
      notes.push(`EXPECTED_SUPABASE_REF unset; site positively identified as production by name (${env.SITE_NAME}).`);
    } else if (hosted) {
      notes.push("EXPECTED_SUPABASE_REF unset on a hosted build and the site is NOT identified as production — refused below.");
    } else {
      notes.push("EXPECTED_SUPABASE_REF unset on a LOCAL build — production assumed, matching the tracked .env.");
    }
  }
  notes.push(`build mode: ${buildMode} (env files for this mode outrank .env / .env.local)`);

  const url = { value: String(values.VITE_SUPABASE_URL ?? "").trim(), source: at("VITE_SUPABASE_URL") };
  const key = { value: String(values.VITE_SUPABASE_ANON_KEY ?? "").trim(), source: at("VITE_SUPABASE_ANON_KEY") };
  const actualRef = refFromUrl(url.value);

  if (!url.value) {
    errors.push("VITE_SUPABASE_URL resolves to nothing — the browser client would have no backend.");
  } else if (!actualRef) {
    errors.push(`VITE_SUPABASE_URL is not a Supabase project URL: ${url.value} (from ${url.source})`);
  } else if (actualRef !== expectedRef) {
    errors.push(
      `BROWSER BUNDLE WOULD TARGET THE WRONG PROJECT.\n` +
        `      expected ref : ${expectedRef}${expectedRaw ? "" : "  (defaulted: EXPECTED_SUPABASE_REF unset)"}\n` +
        `      effective ref: ${actualRef}\n` +
        `      supplied by  : ${url.source}\n` +
        (actualRef === PRODUCTION_REF
          ? `      This is PRODUCTION. A non-production site must not compile against it.\n` +
            `      Most likely cause: the value came from the tracked .env fallback, or from\n` +
            `      netlify.toml [build.environment] — which OVERRIDES dashboard variables.`
          : "")
    );
  }

  if (!key.value) {
    errors.push("VITE_SUPABASE_ANON_KEY resolves to nothing.");
  } else if (url.source !== key.source) {
    // A mismatched pair is how you end up with one project's URL and another's key.
    errors.push(
      `VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY come from different sources ` +
        `(${url.source} vs ${key.source}). They must be set together.`
    );
  }

  // The store slug defaults to store4979 in BOTH the browser (storeConfig.js,
  // supabase.js) and the functions (register-job.js, send-print-job.js). That
  // store does not exist outside production, so an unset slug on staging means
  // every lookup misses and the failure looks like a code bug.
  const viteSlug = { value: String(values.VITE_STORE_SLUG ?? "").trim(), source: at("VITE_STORE_SLUG") };
  const fnSlug = { value: String(values.STORE_SLUG ?? "").trim(), source: at("STORE_SLUG") };
  if (!isProductionTarget) {
    for (const [name, got] of [
      ["VITE_STORE_SLUG", viteSlug],
      ["STORE_SLUG", fnSlug],
    ]) {
      if (!got.value) {
        errors.push(
          `${name} is unset on a non-production build. It defaults to "${PRODUCTION_SLUG}", ` +
            `which does not exist in this project.`
        );
      } else if (got.value === PRODUCTION_SLUG) {
        errors.push(`${name} is "${PRODUCTION_SLUG}" on a non-production build.`);
      }
    }
  }

  // Build-time vars are NOT function runtime vars. Nothing here can verify the
  // functions' SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY, which are read inside
  // the handler at runtime from the site's own dashboard config. Say so rather
  // than letting a green build imply the server half was checked too.
  notes.push(
    "NOT CHECKED: function runtime vars (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY). " +
      "They are read at request time from the site's dashboard config, not from this build. " +
      "Confirm them against a live function response before trusting any test result."
  );

  return {
    ok: errors.length === 0,
    errors,
    notes,
    expectedRef,
    actualRef,
    source: url.source,
    mode: buildMode,
    hosted,
    identifiedProd,
  };
}

function main() {
  // Pass argv through so an explicit --mode is honoured.
  const result = checkBuildEnv({ env: { ...process.env, __ARGV: process.argv.slice(2) } });
  console.log(`[check-build-env] mode: ${result.mode}  hosted: ${result.hosted}`);
  console.log(`[check-build-env] expected ref: ${result.expectedRef}`);
  console.log(`[check-build-env] effective ref: ${result.actualRef || "(none)"} (from ${result.source})`);
  for (const n of result.notes) console.log(`[check-build-env] note: ${n}`);
  if (!result.ok) {
    console.error("\n[check-build-env] BUILD REFUSED:\n");
    for (const e of result.errors) console.error(`  - ${e}`);
    console.error("");
    process.exit(1);
  }
  console.log("[check-build-env] browser config target OK");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
