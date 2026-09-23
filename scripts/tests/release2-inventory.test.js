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
  runInventory, compareToAllowlist, appliedBaselineVersion,
  GATEWAY, CLIENT_INIT, APPROVED_RPC, SNAPSHOT_PROJECT,
} from "./inventory-check.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

// Routes that have EVER been retired (a slice's stage D adds here and never
// removes). Retirement survives the deletion of both the tombstone file and
// the _retired.json entry because this list is a third, reviewed record.
export const RETIRED_EVER = Object.freeze([]);

// file | kind | name  ->  { count, slice }
// kind: table | view | bucket | rpc | channel | fn | route-builder | holds-client
export const ALLOWLIST = Object.freeze({
  // ── App.jsx: queue badge (slice 5), kiosk upload (slice 8), email (slice 6)
  "src/App.jsx|table|pending_jobs":            { count: 1, slice: "5" },
  "src/App.jsx|channel|pending_jobs_badge":    { count: 1, slice: "5" },
  "src/App.jsx|bucket|customer-uploads":       { count: 1, slice: "8" },
  "src/App.jsx|fn|start-upload":               { count: 1, slice: "8" },   // kiosk caller Part 6 missed
  "src/App.jsx|fn|register-job":               { count: 1, slice: "8" },   // kiosk caller Part 6 missed
  "src/App.jsx|fn|send-print-job":             { count: 1, slice: "6" },
  "src/App.jsx|route-builder|template":        { count: 1, slice: "8" },   // callQueueFn
  "src/App.jsx|holds-client|import supabase":  { count: 1, slice: "8" },   // last use is the kiosk upload
  // ── PrintQueue.jsx: the staff queue (slice 5)
  "src/components/PrintQueue.jsx|table|pending_jobs":           { count: 1, slice: "5" },
  "src/components/PrintQueue.jsx|channel|pending_jobs":         { count: 1, slice: "5" },
  "src/components/PrintQueue.jsx|fn|get-download-url":          { count: 2, slice: "5" },   // legacy signer
  "src/components/PrintQueue.jsx|fn|complete-job":              { count: 1, slice: "5" },   // legacy deleter
  "src/components/PrintQueue.jsx|route-builder|template":       { count: 1, slice: "5" },   // FN()
  "src/components/PrintQueue.jsx|holds-client|import supabase": { count: 1, slice: "5" },
  // ── UploadApp.jsx: the customer page (slice 8)
  "src/UploadApp.jsx|bucket|customer-uploads":      { count: 1, slice: "8" },
  "src/UploadApp.jsx|fn|start-upload":              { count: 1, slice: "8" },
  "src/UploadApp.jsx|fn|register-job":              { count: 1, slice: "8" },
  "src/UploadApp.jsx|fn|fetch-link-job":            { count: 1, slice: "8" },
  "src/UploadApp.jsx|route-builder|template":       { count: 1, slice: "8" },   // FN()
  "src/UploadApp.jsx|holds-client|import supabase": { count: 1, slice: "8" },
  // ── storeConfig.js: owner-JWT price book and store config (stays)
  "src/lib/storeConfig.js|table|stores":        { count: 5, slice: "auth-jwt" },
  "src/lib/storeConfig.js|table|paper_types":   { count: 5, slice: "auth-jwt" },
  "src/lib/storeConfig.js|table|sheet_prices":  { count: 2, slice: "auth-jwt" },
  "src/lib/storeConfig.js|table|discounts":     { count: 3, slice: "auth-jwt" },
  "src/lib/storeConfig.js|table|addons":        { count: 2, slice: "auth-jwt" },
  "src/lib/storeConfig.js|table|settings":      { count: 2, slice: "auth-jwt" },
  "src/lib/storeConfig.js|table|memberships":   { count: 1, slice: "auth-jwt" },
  "src/lib/storeConfig.js|holds-client|import supabase": { count: 1, slice: "auth-jwt" },
  // ── supabase.js: the gateway itself
  "src/lib/supabase.js|holds-client|defines the client": { count: 1, slice: "auth-jwt" },
  "src/lib/supabase.js|table|print_jobs":       { count: 3, slice: "7" },
  "src/lib/supabase.js|bucket|job-files":       { count: 4, slice: "7" },   // upload/download/signed-url/delete
  "src/lib/supabase.js|table|orders":           { count: 2, slice: "6" },   // rows 2 and 3 share the insert
  "src/lib/supabase.js|rpc|verify_employee_pin": { count: 1, slice: "4" },  // path 15, S1
  "src/lib/supabase.js|table|employees":        { count: 3, slice: "auth-jwt" },
  "src/lib/supabase.js|table|stores":           { count: 1, slice: "auth-jwt" },
});

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
  const fn = SRC.slice(SRC.indexOf("export function protectedNamesFromMigrations"), SRC.indexOf("export function compareToAllowlist"));
  assert.match(fn, /"pending"/, "reads supabase/migrations/pending/");
  assert.match(fn, /join\(root, "supabase", "migrations"\)\]/, "and supabase/migrations/ itself (the applied names)");
  assert.match(fn, /create\\s\+table/i, "derives names from CREATE TABLE statements");
  assert.doesNotMatch(fn, /tables\.json|snapshot|tables\b/, "the protected set does not read the snapshot");
  assert.match(SRC, /protected set is empty/, "an empty protected set is a failure");
});

test("INV-6 the snapshot is the production capture at the repo's applied baseline", () => {
  const snap = JSON.parse(readFileSync(new URL("../../supabase/tables.json", import.meta.url), "utf8"));
  assert.equal(snap.project, SNAPSHOT_PROJECT);
  assert.equal(snap.query, "scripts/manual/tables-snapshot.sql");
  assert.equal(snap.ledgerVersion, appliedBaselineVersion(ROOT), "ledger version at capture == newest applied migration file");
  assert.doesNotMatch(JSON.stringify(snap), /RECORDED BY HAND/);
  // The Release 2 tables are NOT in the snapshot today (production has none),
  // and MUT-13 proves the prohibition does not depend on that.
  for (const t of ["staff_sessions", "device_enrollments", "enrollment_tickets", "auth_attempts"]) {
    assert.ok(!snap.tables.includes(t), `${t} in the production snapshot would mean stage 0 ran`);
  }
});
