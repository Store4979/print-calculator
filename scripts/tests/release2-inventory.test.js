// scripts/tests/release2-inventory.test.js — G0's fifth condition and every
// later slice's G-inventory: the client reaches exactly the tables, buckets,
// RPCs, channels and Netlify functions this allowlist says it does, and
// nothing else. The scan is scripts/tests/inventory-check.mjs (a real parser:
// acorn + acorn-jsx, the suite's only dependencies, pinned exactly). Its
// mutants live in release2-inventory.mutation.test.js — each forbidden reach
// shape is injected into a copy of src/ and the scan is seen to FAIL on it.
//
// The allowlist is the plan's Part 6 inventory as it stands in the code
// TODAY, each entry tagged with the slice whose stage D removes it, or
// `auth-jwt` for the owner-JWT helpers that stay. Allowances are per
// occurrence with expected cardinality: a site not listed fails, a second
// occurrence in an allowlisted file fails, and a listed site that has gone
// fails too (an allowlist that outlives its sites stops describing anything).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { stripComments } from "./source-util.mjs";
import {
  runInventory, compareToAllowlist, appliedBaselineVersion, protectedNamesByState,
  GATEWAY, CLIENT_INIT, APPROVED_RPC, SNAPSHOT_PROJECT,
} from "./inventory-check.mjs";
import { ALLOWLIST, RETIRED_EVER } from "./inventory-allowlist.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

const run = () => runInventory({ root: ROOT, retiredEver: RETIRED_EVER });

test("INV-1 the inventory runs clean on the real tree: every input present and valid, no forbidden reach shape", () => {
  const r = run();
  assert.deepEqual(r.errors, [], "\n  " + r.errors.join("\n  "));
});

test("INV-2 the sites found are exactly the allowlist, per occurrence — nothing extra, no count drift, nothing stale", () => {
  const problems = compareToAllowlist(run().sites, ALLOWLIST);
  assert.deepEqual(problems, [], "\n  " + problems.join("\n  "));
});

test("INV-3 every allowlist entry carries a slice tag from the plan, a positive count, and a known kind", () => {
  const valid = new Set(["4", "5", "6", "7", "8", "9", "auth-jwt"]);
  const kinds = new Set(["table", "view", "bucket", "rpc", "channel", "fn", "route-builder", "holds-client"]);
  for (const [k, v] of Object.entries(ALLOWLIST)) {
    assert.ok(valid.has(v.slice), `${k}: slice ${JSON.stringify(v.slice)}`);
    assert.ok(Number.isInteger(v.count) && v.count > 0, `${k}: count`);
    assert.ok(kinds.has(k.split("|")[1]), `${k}: kind`);
  }
  // Every approved RPC is allowlisted somewhere with the slice the approval names.
  for (const [rpc, slice] of Object.entries(APPROVED_RPC)) {
    const hit = Object.entries(ALLOWLIST).find(([k]) => k.endsWith(`|rpc|${rpc}`));
    assert.ok(hit, `approved RPC ${rpc} has no allowlist entry`);
    assert.equal(hit[1].slice, slice, `${rpc}: allowlist slice must match the approval`);
  }
});

test("INV-4 the gateway is two files, the package import is one file, and §0.2's claim about who holds the client is true today", () => {
  assert.deepEqual([...GATEWAY], ["src/lib/supabase.js", "src/lib/storeConfig.js"]);
  assert.equal(CLIENT_INIT, "src/lib/supabase.js");
  const holders = run().sites.filter((s) => s.kind === "holds-client").map((s) => s.file).sort();
  assert.deepEqual(holders, [
    "src/App.jsx", "src/UploadApp.jsx", "src/components/PrintQueue.jsx", "src/lib/storeConfig.js", "src/lib/supabase.js",
  ], "four importers plus the definer, and no other file");
});

test("INV-5 the protected Release 2 names come from the migration files in both lifecycle locations, never from the snapshot", () => {
  const SRC = stripComments(readFileSync(new URL("./inventory-check.mjs", import.meta.url), "utf8"));
  const fn = SRC.slice(SRC.indexOf("function createdTables"), SRC.indexOf("export function tombstoneProblem"));
  assert.match(fn, /"pending"/, "reads supabase/migrations/pending/");
  assert.match(fn, /createdTables\(join\(root, "supabase", "migrations"\)\)/, "and supabase/migrations/ itself (the applied names)");
  assert.match(fn, /create\\s\+table/i, "derives names from CREATE TABLE statements");
  assert.doesNotMatch(fn, /tables\.json|snapshot|tables\b/, "the protected set does not read the snapshot");
  assert.match(SRC, /protected set is empty/, "an empty protected set is a failure");
});

test("INV-6 the snapshot is the production capture at the repo's applied baseline, and its Release 2 table presence follows applied migration state", () => {
  const snap = JSON.parse(readFileSync(new URL("../../supabase/tables.json", import.meta.url), "utf8"));
  assert.equal(snap.project, SNAPSHOT_PROJECT);
  assert.equal(snap.query, "scripts/manual/tables-snapshot.sql");
  assert.equal(snap.ledgerVersion, appliedBaselineVersion(ROOT), "ledger version at capture == newest applied migration file");
  assert.doesNotMatch(JSON.stringify(snap), /RECORDED BY HAND/);
  // Presence is decided by where each release2 migration lives, not by a
  // fixed expectation: a legitimate stage-0 apply plus a snapshot refresh
  // passes; either half alone fails (MUT-26). The browser prohibition on
  // these names (MUT-18) is independent of both.
  const { applied, pendingOnly } = protectedNamesByState(ROOT);
  assert.ok(applied.size + pendingOnly.size > 0, "a protected set exists");
  for (const tname of applied) assert.ok(snap.tables.includes(tname), `${tname}: applied on production, so the snapshot must list it`);
  for (const tname of pendingOnly) assert.ok(!snap.tables.includes(tname), `${tname}: still pending, so the snapshot must not list it`);
});
