// src/lib/buildStamp.js — which client build is RUNNING.
//
// WHY: the offline order queue fix (PR #46) is on production, but a counter
// tablet can keep executing an older bundle for days — a tab suspended in the
// background resumes with the code it loaded, and public/sw.js serves the
// cached shell and cached assets on an offline or flaky reopen. Nothing
// server-side can say which build a given device is executing. This can.
//
// HOW: vite.config.js `define`s __PC_BUILD__ from Netlify's build-time
// environment (COMMIT_REF, DEPLOY_ID, CONTEXT) and Vite replaces the
// identifier with a literal in the emitted bundle. So the value is a property
// of the JavaScript file itself: whatever bundle the browser is running,
// cached or fresh, reports its own build. It is never fetched. A server
// deploy id fetched at runtime would say what is DEPLOYED, not what is
// RUNNING, and that is exactly the distinction this exists to make.
//
// A build outside Netlify (yarn dev, a local yarn build) has no COMMIT_REF or
// DEPLOY_ID. That is rendered as an unmistakable MISSING, never as a blank
// and never as anything that could be mistaken for a version.

/* global __PC_BUILD__ */
const fromDefine = () => {
  try {
    // eslint-disable-next-line no-undef
    if (typeof __PC_BUILD__ !== "undefined" && __PC_BUILD__ && typeof __PC_BUILD__ === "object") {
      return __PC_BUILD__;
    }
  } catch {}
  return null;
};

const raw = fromDefine();

export const BUILD = Object.freeze({
  commit: raw?.commit || null,
  deployId: raw?.deployId || null,
  context: raw?.context || null,
  builtAt: raw?.builtAt || null,
});

export const MISSING_STAMP = "BUILD STAMP MISSING — not a Netlify build (local or dev bundle)";

// The string shown in the Admin footer. Pure: takes the stamp as an argument
// so the tests can drive every shape, and defaults to this bundle's own.
export function formatBuildStamp(b = BUILD) {
  const commit = typeof b?.commit === "string" ? b.commit.trim() : "";
  const deploy = typeof b?.deployId === "string" ? b.deployId.trim() : "";
  if (!commit || !deploy) return MISSING_STAMP;
  const short = commit.slice(0, 12);
  const when = typeof b?.builtAt === "string" && b.builtAt ? b.builtAt.replace(/\.\d{3}Z$/, "Z") : "built-at unknown";
  const ctx = typeof b?.context === "string" && b.context ? b.context : "context unknown";
  return `client build ${short} · deploy ${deploy} · ${when} · ${ctx}`;
}
