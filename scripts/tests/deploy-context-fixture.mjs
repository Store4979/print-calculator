// Shared fixture for tests that need the REAL deploy-context reader to find a
// file. Not a test file (the runner globs *.test.js).
//
// Why it writes the real path instead of an environment override: the reader
// deliberately has no env switch — the whole point of a bundled file is that
// nothing at runtime can redirect it (netlify/lib/deploy-context.js header).
// So a test that wants the reader to see a context writes the file the reader
// looks for, and restores whatever was there.
//
// netlify/lib/deploy-context.json is generated and gitignored; on a developer
// machine a local build may have left one, and on Netlify `yarn test` runs
// BEFORE the writer, so the previous deploy's file can still be on disk. Both
// are restored byte-for-byte.
import { readFileSync, writeFileSync, existsSync, rmSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
export const CONTEXT_PATH = join(REPO_ROOT, "netlify", "lib", "deploy-context.json");

/** A complete, valid context file. Override any field per test. */
export const validContext = (over = {}) => ({
  context: "production",
  siteId: "03ff880d-eb73-4035-8b71-3588b22a0b20",
  siteName: "printcalculator2-staging",
  deployId: "6ab018331b0a1500089d0930",
  commitRef: "0123456789abcdef0123456789abcdef01234567",
  builtAt: "2026-09-20T18:07:22.850Z",
  ...over,
});

/**
 * Run `fn` with `payload` written where the reader will find it, then restore.
 * `payload === null` removes the file for the duration (the absent case).
 */
export async function withRepoDeployContext(payload, fn) {
  const had = existsSync(CONTEXT_PATH);
  const before = had ? readFileSync(CONTEXT_PATH, "utf8") : null;
  try {
    if (payload === null) {
      if (had) rmSync(CONTEXT_PATH);
    } else {
      mkdirSync(dirname(CONTEXT_PATH), { recursive: true });
      writeFileSync(CONTEXT_PATH, typeof payload === "string" ? payload : JSON.stringify(payload, null, 2) + "\n", "utf8");
    }
    return await fn();
  } finally {
    if (before === null) {
      if (existsSync(CONTEXT_PATH)) rmSync(CONTEXT_PATH);
    } else {
      writeFileSync(CONTEXT_PATH, before, "utf8");
    }
  }
}
