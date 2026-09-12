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
// That split-brain is worse than no isolation, because it looks isolated. A
// "staging" test would read and write production rows through the browser
// client while every server-side check passed.
//
// WHAT THIS CHECKS
// The EFFECTIVE value, resolved the way Vite resolves it:
//   shell/CI env  >  .env.local  >  .env
// (Vite does not overwrite variables that already exist in the environment.)
// The tracked .env carries production values as a local-dev convenience, so it
// is a silent fallback on any site that does not set the variables itself —
// which is exactly how staging would have inherited production.
//
// CONTRACT
//   EXPECTED_SUPABASE_REF unset → production is assumed, and the effective ref
//     must be the production ref. Production keeps building with no dashboard
//     change, and is still guarded.
//   EXPECTED_SUPABASE_REF set   → the effective ref must equal it exactly.
//     Staging sets it to the staging ref, so any leak of production through
//     netlify.toml, .env, or a forgotten dashboard value FAILS THE BUILD.
//
// This is fail-closed: no silent pass, and never a warning where the wrong
// project would be reachable.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = process.env.BUILD_ENV_ROOT || join(dirname(fileURLToPath(import.meta.url)), "..");

export const PRODUCTION_REF = "gmxyisjjaxtpycsmmzef";
export const PRODUCTION_SLUG = "store4979";

// Minimal dotenv parse: KEY=VALUE, `export` prefix, # comments, optional quotes.
export function parseDotenv(text) {
  const out = {};
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    let key = line.slice(0, eq).trim();
    if (key.startsWith("export ")) key = key.slice(7).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
      (value.startsWith("'") && value.endsWith("'") && value.length > 1)
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

// Resolve one variable the way Vite would: existing env wins, then .env.local,
// then .env. Returns {value, source} so the failure message can name the file
// that actually supplied it.
export function resolveEnv(name, { env = process.env, root = ROOT } = {}) {
  if (env[name] !== undefined && String(env[name]).trim() !== "") {
    return { value: String(env[name]).trim(), source: "environment" };
  }
  for (const file of [".env.local", ".env"]) {
    const path = join(root, file);
    if (!existsSync(path)) continue;
    const parsed = parseDotenv(readFileSync(path, "utf8"));
    if (parsed[name] !== undefined && parsed[name].trim() !== "") {
      return { value: parsed[name].trim(), source: file };
    }
  }
  return { value: "", source: "unset" };
}

// https://<ref>.supabase.co → <ref>
export function refFromUrl(url) {
  const m = /^https:\/\/([a-z0-9]+)\.supabase\.(co|in)(\/|$)/i.exec(String(url).trim());
  return m ? m[1].toLowerCase() : "";
}

export function checkBuildEnv({ env = process.env, root = ROOT } = {}) {
  const errors = [];
  const notes = [];

  const expectedRaw = (env.EXPECTED_SUPABASE_REF || "").trim();
  const expectedRef = expectedRaw || PRODUCTION_REF;
  const isProductionTarget = expectedRef === PRODUCTION_REF;

  if (!expectedRaw) {
    notes.push(
      "EXPECTED_SUPABASE_REF is unset — assuming PRODUCTION. Any non-production " +
        "site MUST set it, or this guard cannot tell the difference."
    );
  }

  const url = resolveEnv("VITE_SUPABASE_URL", { env, root });
  const key = resolveEnv("VITE_SUPABASE_ANON_KEY", { env, root });
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
  const viteSlug = resolveEnv("VITE_STORE_SLUG", { env, root });
  const fnSlug = resolveEnv("STORE_SLUG", { env, root });
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

  return { ok: errors.length === 0, errors, notes, expectedRef, actualRef, source: url.source };
}

function main() {
  const result = checkBuildEnv();
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
