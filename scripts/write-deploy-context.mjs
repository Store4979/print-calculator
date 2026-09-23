#!/usr/bin/env node
// Write netlify/lib/deploy-context.json from the build environment.
//
// Runs inside the Netlify build command, after scripts/check-build-env.mjs and
// BEFORE `yarn build`, so the file exists when Netlify bundles the functions
// (netlify.toml [functions] included_files ships it into every bundle). The
// reader is netlify/lib/deploy-context.js; see its header for why this is a
// file and not a runtime environment variable.
//
// FAIL CLOSED AT THE WRITER TOO. On a hosted build, every field this records
// must be present and CONTEXT must be exactly one of the four values Netlify
// emits. A hosted build that cannot describe itself does not get to produce a
// bundle that will later be asked to prove what it is — so this exits 1 rather
// than writing a half-identified file. Locally there is no deployment context
// to record: the file is written with nulls, the reader rejects it, and
// Release 2 endpoints refuse. That is the intended local state (`netlify dev`
// sets CONTEXT=dev, which is valid, and needs RELEASE2_CONTEXTS=production,dev
// set deliberately).
//
// The staleness cross-check — that this file describes the SAME commit as the
// bundle's own __PC_BUILD__ stamp — lives in scripts/inject-sw-manifest.mjs,
// which runs after the build and can fail the deploy.
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isHostedBuild } from "./check-build-env.mjs";
import { VALID_CONTEXTS, CONTEXT_FILE, REQUIRED_KEYS } from "../netlify/lib/deploy-context.js";

// Overridable so the tests can drive this exact file against a temp tree,
// rather than a reimplementation of it (the SW_MANIFEST_DIST pattern).
const ROOT = process.env.DEPLOY_CONTEXT_ROOT || fileURLToPath(new URL("..", import.meta.url));
const OUT = join(ROOT, CONTEXT_FILE);

const die = (...lines) => {
  for (const l of lines) console.error(l);
  process.exit(1);
};

export function buildPayload(env = process.env) {
  const trim = (v) => {
    const s = String(v ?? "").trim();
    return s === "" ? null : s;
  };
  const hosted = isHostedBuild(env);
  const context = trim(env.CONTEXT);
  const errors = [];

  // A present-but-wrong CONTEXT is a misconfiguration wherever it happens.
  if (context !== null && !VALID_CONTEXTS.includes(context)) {
    errors.push(
      `CONTEXT is ${JSON.stringify(context)}, which is not one of ${VALID_CONTEXTS.join(", ")}. ` +
        "Netlify emits only those four; a different value means this is not the environment it claims."
    );
  }

  const payload = {
    context,
    siteId: trim(env.SITE_ID),
    siteName: trim(env.SITE_NAME),
    deployId: trim(env.DEPLOY_ID),
    commitRef: trim(env.COMMIT_REF),
    builtAt: new Date().toISOString(),
  };

  // A laptop may not claim to be a deployment. `netlify dev` sets CONTEXT=dev
  // and that is the only context a non-hosted build may record; production,
  // deploy-preview and branch-deploy are facts only Netlify's builder can
  // establish. Refusing here means a locally built bundle can never carry a
  // file that says "production".
  if (!hosted && context !== null && context !== "dev") {
    errors.push(
      `CONTEXT is ${JSON.stringify(context)} on a build that is not hosted by Netlify. ` +
        "Only \"dev\" (netlify dev) may be recorded locally."
    );
  }

  if (hosted) {
    if (context === null) {
      errors.push("CONTEXT is empty on a HOSTED build. Absence is not a context; refusing to write a file that cannot be verified.");
    }
    for (const [key, envName] of [
      ["siteId", "SITE_ID"], ["siteName", "SITE_NAME"],
      ["deployId", "DEPLOY_ID"], ["commitRef", "COMMIT_REF"],
    ]) {
      if (payload[key] === null) errors.push(`${envName} is empty on a HOSTED build.`);
    }
  }

  return { payload, errors, hosted };
}

function main() {
  const { payload, errors, hosted } = buildPayload(process.env);
  if (errors.length) {
    die(
      "[write-deploy-context] REFUSED: the build environment does not describe this deployment:",
      ...errors.map((e) => `  - ${e}`),
      ""
    );
  }
  // Key order is fixed so the emitted file is diffable; the reader checks for
  // presence, not order.
  const ordered = {};
  for (const k of REQUIRED_KEYS) ordered[k] = payload[k];
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(ordered, null, 2) + "\n", "utf8");
  console.log(
    `[write-deploy-context] wrote ${CONTEXT_FILE} (hosted=${hosted}) ` +
      `context=${ordered.context ?? "null"} site=${ordered.siteName ?? "null"} commit=${ordered.commitRef ?? "null"}`
  );
  if (!hosted) {
    console.log("[write-deploy-context] local build: nulls written; the reader treats this as no context and Release 2 endpoints refuse.");
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
