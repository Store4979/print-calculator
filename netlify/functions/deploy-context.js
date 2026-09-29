// netlify/functions/deploy-context.js — read-only diagnostic. It answers what
// THIS bundle says about the deployment it was built for.
//
// WHY IT EXISTS: stage 0 replaces "refuse on the production project ref" with
// a verified deployment context (docs/security/release-2-data-path-plan.md
// §4.1). That refusal is only allowed to be deleted once four observations are
// in hand — production says production, a preview of production says
// deploy-preview, staging says production with its own site name, and the
// Functions-scoped flag is present in production and absent in the preview.
// This route is how those observations are made, so it must answer on
// deployments where the Release 2 gate itself refuses. It therefore does NOT
// call gate().
//
// WHAT IT DELIBERATELY DOES NOT DO:
//  - it never imports the Supabase client and never reads any SUPABASE_* value,
//    so no key can reach a response body by any path;
//  - it never reads RELEASE2_ALLOWED_ORIGINS;
//  - it does not report the Release 2 gate's overall verdict. Computing that
//    means reading SUPABASE_URL, which this route is forbidden to touch. It
//    reports the context condition only, and says so.
//  - it reports RELEASE2_ENABLED as two BOOLEANS, never its value:
//    `flagPresent` (the platform put a non-empty value in this runtime —
//    scoping evidence) and `flagEnabled` (the gate's condition 1 holds, via
//    release2FlagEnabled(), the one predicate release2Allowed() also calls).
//
// IT IS A PROBING AID, STATED PLAINLY: the two flag booleans tell an anonymous
// caller which deployments carry and enable the flag, and the metadata names
// the site and commit. None of it is secret (the commit is already compiled
// into the client bundle by src/lib/buildStamp.js), but it is information, and
// it is here because the evidence for deleting a security control has to be
// observable. The stage 0 production review ruled to KEEP it after G0, GET-only
// and non-secret (docs/security/release-2-stage-0-production-plan.md, F5).
//
// The ONLY import is the single shared module; a second reader or a second
// flag predicate would be a second policy
// (scripts/tests/release2-deploy-context.test.js asserts this).
import { readDeployContext, allowedContexts, release2FlagEnabled, VALID_CONTEXTS } from "../lib/deploy-context.js";

const HEADERS = Object.freeze({
  "content-type": "application/json",
  "cache-control": "no-store",
});

const reply = (statusCode, obj) => ({ statusCode, headers: { ...HEADERS }, body: JSON.stringify(obj) });

export const handler = async (event) => {
  if (event?.httpMethod !== "GET") {
    return reply(405, { ok: false, error: "Method Not Allowed" });
  }

  const dc = readDeployContext();
  const allowed = allowedContexts(process.env);

  // Presence, not value. `!== ""` rather than `=== "true"`: the question this
  // answers is "did the platform put the variable in this runtime", which is
  // what evidence (d) needs. Whether its value passes is `flagEnabled` below.
  const flagPresent = String(process.env.RELEASE2_ENABLED ?? "").trim() !== "";
  // Enabled, by the gate's own predicate (plan D4, review B5): presence alone
  // does not show that condition 1 holds.
  const flagEnabled = release2FlagEnabled(process.env);

  return reply(200, {
    ok: dc.ok,
    reason: dc.ok ? null : dc.reason,
    source: dc.source,
    triedWithoutFinding: dc.ok ? [] : dc.tried,
    context: dc.context,
    ...(dc.meta || { siteId: null, siteName: null, deployId: null, commitRef: null, builtAt: null }),
    validContexts: VALID_CONTEXTS,
    allowedContexts: allowed,
    contextAllowed: Boolean(dc.ok && allowed.includes(dc.context)),
    flagPresent,
    flagEnabled,
    // Deliberately does not name the project-URL variable: the test asserts
    // that token appears nowhere in this file, which is the strongest and
    // simplest form the assertion can take.
    note:
      "Context condition and flag predicate only. This route does not evaluate the " +
      "whole Release 2 gate, which also reads the project URL.",
  });
};
