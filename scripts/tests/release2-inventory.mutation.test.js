// scripts/tests/release2-inventory.mutation.test.js — the inventory scan,
// seen to fail. Each test copies the tree into a temp dir, injects ONE
// forbidden shape (F5, R7, and the six review additions A1–A6), runs the real
// scan from inventory-check.mjs and asserts it reports the shape. A gate that
// has never been seen to fail has not been shown to gate anything.
//
// The fixture tables.json below is for the SCAN's logic, not production's
// schema; the real supabase/tables.json is captured by
// scripts/manual/tables-snapshot.sql and judged by release2-inventory.test.js.
// The fixture passes the same validation the real one must (project, role,
// ledger version == the copied tree's applied baseline), so the control run
// proves the validation is reachable, not skipped.
//
// Not here, by design: the "client-controlled server costing" mutant (C5).
// That is a behavioural test against orders-save — the server must compute
// cost from the price book and ignore client figures — and orders-save does
// not exist until slice 6; §6.2 places that test there. An inventory scan
// cannot express it, and a fake of it here would be a test that tests nothing.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, cpSync, writeFileSync, rmSync, readFileSync, existsSync, renameSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runInventory, compareToAllowlist, appliedBaselineVersion } from "./inventory-check.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const BASELINE = appliedBaselineVersion(ROOT);

const FIXTURE_TABLES = {
  project: "gmxyisjjaxtpycsmmzef", capturedBy: "fixture", query: "scripts/manual/tables-snapshot.sql", capturedAt: "fixture",
  database: "postgres", role: "postgres", ledgerVersion: BASELINE,
  tables: ["addons", "discounts", "employees", "memberships", "orders", "paper_types", "pending_jobs",
           "print_jobs", "settings", "sheet_prices", "stores"],
  views: [],
  buckets: ["customer-uploads", "job-files"],
};
const TOMBSTONE = "// TOMBSTONE\nexport const TOMBSTONE = true;\nexport const handler = async () => ({ statusCode: 410, body: \"Gone\" });\n";

/** A working copy: src/, netlify/functions/, supabase/migrations (names + pending bodies), fixture snapshot. */
function copyTree() {
  const root = mkdtempSync(join(tmpdir(), "inv-"));
  cpSync(join(ROOT, "src"), join(root, "src"), { recursive: true });
  cpSync(join(ROOT, "netlify", "functions"), join(root, "netlify", "functions"), { recursive: true });
  cpSync(join(ROOT, "supabase", "migrations"), join(root, "supabase", "migrations"), { recursive: true });
  writeFileSync(join(root, "supabase", "tables.json"), JSON.stringify(FIXTURE_TABLES, null, 2));
  return root;
}
const write = (root, rel, body) => {
  const p = join(root, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, typeof body === "string" ? body : JSON.stringify(body, null, 2), "utf8");
};
const IMPORT = 'import { supabase } from "./lib/supabase.js";\n';

/** Run one mutant; return errors and helpers. */
function mutate(apply, opts = {}) {
  const root = copyTree();
  try {
    apply(root);
    const r = runInventory({ root, ...opts });
    return { errors: r.errors, joined: r.errors.join("\n"), sites: r.sites, siteIn: (file) => r.sites.filter((s) => s.file === file) };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("CONTROL — the unmutated copy with the fixture snapshot scans clean, and the fixture is validated (not skipped)", () => {
  const r = mutate(() => {});
  assert.deepEqual(r.errors, [], "\n  " + r.errors.join("\n  "));
  assert.ok(r.sites.length > 40, "the real sites are found");
  assert.ok(BASELINE, "the copied tree has an applied baseline to reconcile against");
});

// ── reach shapes (F5, R7) ────────────────────────────────────────────────────

test("MUT-1 the table literal on the NEXT line is still found (a per-line grep misses it)", () => {
  const r = mutate((root) => write(root, "src/mutant.js", IMPORT + "export const f = () => supabase\n  .from(\n    \"orders\"\n  ).select(\"*\");\n"));
  assert.deepEqual(r.errors, []);
  const s = r.siteIn("src/mutant.js").map((x) => `${x.kind}|${x.name}`);
  assert.ok(s.includes("table|orders"), `found ${JSON.stringify(s)}`);
  assert.ok(s.includes("holds-client|import supabase"));
});

test("MUT-2 aliasing the method: const q = supabase.from", () => {
  const r = mutate((root) => write(root, "src/mutant.js", IMPORT + "const q = supabase.from;\nexport const f = () => q(\"orders\");\n"));
  assert.match(r.joined, /supabase\.from is referenced without being called/);
});

test("MUT-3 destructuring the client", () => {
  const r = mutate((root) => write(root, "src/mutant.js", IMPORT + "const { from } = supabase;\nexport const f = () => from(\"orders\");\n"));
  assert.match(r.joined, /used as a value/);
});

test("MUT-4 computed access with a literal and with a variable", () => {
  assert.match(mutate((root) => write(root, "src/mutant.js", IMPORT + "export const f = () => supabase[\"from\"](\"orders\");\n")).joined, /computed access/);
  assert.match(mutate((root) => write(root, "src/mutant.js", IMPORT + "export const f = (m) => supabase[m](\"orders\");\n")).joined, /computed access/);
});

test("MUT-5 a name not knowable at parse time: parameter, template with expression, inner const", () => {
  assert.match(mutate((root) => write(root, "src/mutant.js", IMPORT + "export const f = (t) => supabase.from(t);\n")).joined, /knowable at parse time/);
  assert.match(mutate((root) => write(root, "src/mutant.js", IMPORT + "export const f = (x) => supabase.from(`${x}`);\n")).joined, /knowable at parse time/);
  assert.match(mutate((root) => write(root, "src/mutant.js", IMPORT + "export const f = () => { const t = \"orders\"; return supabase.from(t); };\n")).joined,
    /knowable at parse time/, "only a TOP-LEVEL const string resolves");
});

test("MUT-6 the accepted const resolution is exactly same-file top-level const: let, reassignment and an imported binding all fail", () => {
  assert.equal(mutate((root) => write(root, "src/mutant.js", IMPORT + "const T = \"orders\";\nexport const f = () => supabase.from(T);\n")).errors.length, 0,
    "control: a top-level const string resolves");
  assert.match(mutate((root) => write(root, "src/mutant.js", IMPORT + "let T = \"orders\";\nexport const f = () => supabase.from(T);\n")).joined,
    /identifier T is not a same-file top-level const string/, "let");
  assert.match(mutate((root) => write(root, "src/mutant.js", IMPORT + "var T = \"orders\";\nT = \"employees\";\nexport const f = () => supabase.from(T);\n")).joined,
    /identifier T is not a same-file top-level const string/, "reassigned");
  assert.match(mutate((root) => {
    write(root, "src/names.js", "export const T = \"orders\";\n");
    write(root, "src/mutant.js", IMPORT + "import { T } from \"./names.js\";\nexport const f = () => supabase.from(T);\n");
  }).joined, /identifier T is not a same-file top-level const string/, "imported binding");
});

test("MUT-7 a .from call on a variable that was assigned the client; the client passed as an argument; the client in an object literal", () => {
  assert.match(mutate((root) => write(root, "src/mutant.js", IMPORT + "const c = supabase;\nexport const f = () => c.from(\"orders\");\n")).joined, /used as a value/);
  assert.match(mutate((root) => write(root, "src/mutant.js", IMPORT + "const h = (c) => c.from(\"orders\");\nexport const f = () => h(supabase);\n")).joined, /used as a value/);
  assert.match(mutate((root) => write(root, "src/mutant.js", IMPORT + "export const deps = { supabase };\n")).joined, /placed in an object literal/);
});

// ── A5: the gateway follows bindings and fails closed ───────────────────────

test("MUT-8 imports: third file importing the package; client under another name; NAMESPACE import; DYNAMIC import (literal and non-literal)", () => {
  assert.match(mutate((root) => write(root, "src/mutant.js", "import { createClient } from \"@supabase/supabase-js\";\nexport const c = createClient(\"u\", \"k\");\n")).joined,
    /imports @supabase\/supabase-js; only src\/lib\/supabase\.js may/);
  assert.match(mutate((root) => write(root, "src/mutant.js", "import { supabase as sb } from \"./lib/supabase.js\";\nexport const f = () => sb.from(\"orders\");\n")).joined,
    /imports the client under another name/);
  assert.match(mutate((root) => write(root, "src/mutant.js", "import * as sb from \"./lib/supabase.js\";\nexport const f = () => sb.supabase.from(\"orders\");\n")).joined,
    /namespace import of the gateway module/);
  assert.match(mutate((root) => write(root, "src/mutant.js", "export const f = async () => (await import(\"./lib/supabase.js\")).supabase.from(\"orders\");\n")).joined,
    /dynamic import\(\) of the gateway module/);
  assert.match(mutate((root) => write(root, "src/mutant.js", "export const f = async (p) => (await import(p)).supabase.from(\"orders\");\n")).joined,
    /dynamic import\(\) with a non-literal specifier/);
});

test("MUT-9 re-exporting the client is a second gateway: named re-export, export *, and a second definer", () => {
  assert.match(mutate((root) => write(root, "src/mutant.js", "export { supabase } from \"./lib/supabase.js\";\n")).joined, /second gateway/);
  assert.match(mutate((root) => write(root, "src/mutant.js", "export * from \"./lib/supabase.js\";\n")).joined, /second gateway/);
  assert.match(mutate((root) => write(root, "src/mutant.js", "export const supabase = null;\n")).joined, /defines and exports a "supabase"; only src\/lib\/supabase\.js may/);
});

test("MUT-10 optional chaining on the client, and .schema()", () => {
  assert.match(mutate((root) => write(root, "src/mutant.js", IMPORT + "export const f = () => supabase?.from(\"orders\");\n")).joined, /optional chaining on the client/);
  assert.match(mutate((root) => write(root, "src/mutant.js", IMPORT + "export const f = () => supabase.schema(\"private\").from(\"orders\");\n")).joined, /supabase\.schema\(/);
});

test("MUT-11 dynamic route construction in a new file is a route-builder site the allowlist refuses; a malformed route literal fails outright", () => {
  const r = mutate((root) => write(root, "src/mutant.js", "export const call = (n) => fetch(`/.netlify/functions/${n}`);\n"));
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.siteIn("src/mutant.js").map((s) => `${s.kind}|${s.name}`), ["route-builder|template"]);
  const problems = compareToAllowlist(r.sites, {});   // an empty allowlist: everything is a problem
  assert.ok(problems.some((p) => p.includes("src/mutant.js|route-builder|template")), "the allowlist sees the new builder");
  assert.match(mutate((root) => write(root, "src/mutant.js", "export const u = \"/.netlify/functions/../admin\";\n")).joined, /route literal .* is not exactly/);
  assert.match(mutate((root) => write(root, "src/mutant.js", "export const u = \"/.netlify/functions/no-such-fn\";\n")).joined, /is not a function in netlify\/functions/);
});

test("MUT-12 a file that does not parse fails the scan; a new file is discovered without registration", () => {
  assert.match(mutate((root) => write(root, "src/deep/new/mutant.jsx", "export const X = <div>{oops\n")).joined, /src\/deep\/new\/mutant\.jsx: does not parse/);
  const r = mutate((root) => write(root, "src/deep/new/mutant.jsx", IMPORT + "export const f = () => supabase.from(\"orders\");\n"));
  assert.ok(r.siteIn("src/deep/new/mutant.jsx").length > 0, "a nested new file is scanned");
});

test("MUT-13 NEGATIVE CONTROL: comments, strings that merely mention the client, and .from on things that are not the client are not reaches", () => {
  const r = mutate((root) => write(root, "src/mutant.js",
    "// supabase.from(\"secret\") in a comment\n/* supabase.storage.from(\"secret\") */\n" +
    "const arr = Array.from([1, 2]);\nconst other = { from: (x) => x };\nexport const g = other.from(\"secret\");\n" +
    "export const s = \"supabase.from(\\\"secret\\\")\";\nexport const a = arr;\n"));
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.siteIn("src/mutant.js"), [], "no site from any of it");
});

// ── A4: kinds stay distinct ─────────────────────────────────────────────────

test("MUT-14 a bucket name as a table, a table name as a bucket, an unknown bucket, storage used other than .from, an unapproved RPC", () => {
  assert.match(mutate((root) => write(root, "src/mutant.js", IMPORT + "export const f = () => supabase.from(\"job-files\").select(\"*\");\n")).joined, /names a BUCKET, not a table/);
  assert.match(mutate((root) => write(root, "src/mutant.js", IMPORT + "export const f = () => supabase.storage.from(\"orders\").list();\n")).joined, /names a TABLE, not a bucket/);
  assert.match(mutate((root) => write(root, "src/mutant.js", IMPORT + "export const f = () => supabase.storage.from(\"secret-bucket\").list();\n")).joined, /storage\.from\("secret-bucket"\) names no bucket/);
  assert.match(mutate((root) => write(root, "src/mutant.js", IMPORT + "export const f = () => supabase.storage.listBuckets();\n")).joined, /supabase\.storage used other than/);
  assert.match(mutate((root) => write(root, "src/mutant.js", IMPORT + "export const f = () => supabase.rpc(\"drop_everything\");\n")).joined, /\.rpc\("drop_everything"\) is not an approved RPC/);
  assert.match(mutate((root) => write(root, "src/mutant.js", IMPORT + "export const f = () => supabase.from(\"transactions\").select(\"*\");\n")).joined, /\.from\("transactions"\) names no table or view/, "stale compat view");
});

// ── A2 + tombstones ─────────────────────────────────────────────────────────

test("MUT-15 the legacy signer called after its tombstone: entry + file present, PrintQueue still names it", () => {
  const r = mutate((root) => {
    write(root, "netlify/functions/_retired.json", { retired: ["get-download-url"] });
    write(root, "netlify/functions/get-download-url.js", TOMBSTONE);
  });
  assert.match(r.joined, /names the retired route "get-download-url"/);
});

test("MUT-16 retirement holds when BOTH the tombstone file and the manifest entry are deleted and the caller is reintroduced", () => {
  // The reviewed RETIRED_EVER list in the test is the third record.
  const r = mutate((root) => {
    write(root, "netlify/functions/_retired.json", { retired: [] });
    rmSync(join(root, "netlify", "functions", "get-download-url.js"));   // the live file, standing in for a deleted tombstone
    // PrintQueue still names get-download-url: the caller is "reintroduced"
  }, { retiredEver: ["get-download-url"] });
  assert.match(r.joined, /get-download-url was retired and is no longer listed/);
  assert.match(r.joined, /get-download-url was retired and its tombstone file is gone/);
  assert.match(r.joined, /names the retired route "get-download-url"/);
});

test("MUT-17 tombstone bookkeeping: entry without a file; tombstone file without an entry; a tombstone that imports; a tombstone without the marker", () => {
  assert.match(mutate((root) => write(root, "netlify/functions/_retired.json", { retired: ["some-old-route"] })).joined, /retired route some-old-route has no tombstone file/);
  assert.match(mutate((root) => write(root, "netlify/functions/some-old-route.js", TOMBSTONE)).joined, /some-old-route\.js is a tombstone but is not listed/);
  assert.match(mutate((root) => {
    write(root, "netlify/functions/_retired.json", { retired: ["some-old-route"] });
    write(root, "netlify/functions/some-old-route.js", "import { gate } from \"../lib/release2.js\";\nexport const TOMBSTONE = true;\nexport const handler = async () => ({ statusCode: 410 });\n");
  }).joined, /tombstone .* imports something/);
  assert.match(mutate((root) => {
    write(root, "netlify/functions/_retired.json", { retired: ["some-old-route"] });
    write(root, "netlify/functions/some-old-route.js", "export const handler = async () => ({ statusCode: 410 });\n");
  }).joined, /lacks the marker/);
});

// ── A1: protected names survive the migration leaving pending/ ──────────────

test("MUT-18 a Release 2 table named in src/ fails; still fails when the snapshot lists it; still fails after the identity migration moves to its applied name", () => {
  assert.match(mutate((root) => write(root, "src/mutant.js", "export const T = \"staff_sessions\";\n")).joined, /names the Release 2 table "staff_sessions"/);
  assert.match(mutate((root) => {
    write(root, "supabase/tables.json", { ...FIXTURE_TABLES, tables: [...FIXTURE_TABLES.tables, "staff_sessions", "device_enrollments"] });
    write(root, "src/mutant.js", IMPORT + "export const f = () => supabase.from(\"device_enrollments\").select(\"*\");\n");
  }).joined, /names the Release 2 table "device_enrollments"/, "the snapshot listing it changes nothing");
  // Stage 0: 01 leaves pending/ under a ledger version; the snapshot is refreshed to include the new tables.
  const r = mutate((root) => {
    const pending = join(root, "supabase", "migrations", "pending");
    const applied = join(root, "supabase", "migrations");
    for (const f of readdirSync(pending)) if (/^release2_/.test(f)) renameSync(join(pending, f), join(applied, `20260930120000_${f}`));
    write(root, "supabase/tables.json", { ...FIXTURE_TABLES, ledgerVersion: "20260930120000", tables: [...FIXTURE_TABLES.tables, "staff_sessions", "device_enrollments", "enrollment_tickets", "auth_attempts", "upload_capabilities", "upload_capability_files"] });
    write(root, "src/mutant.js", IMPORT + "export const f = () => supabase.from(\"enrollment_tickets\").select(\"*\");\n");
  });
  assert.match(r.joined, /names the Release 2 table "enrollment_tickets"/, "discovered from the applied location");
  assert.ok(!r.joined.includes("protected set is empty"));
  // And with NO release2 migration anywhere, the empty protected set is itself a failure.
  assert.match(mutate((root) => {
    const pending = join(root, "supabase", "migrations", "pending");
    for (const f of readdirSync(pending)) if (/^release2_/.test(f)) rmSync(join(pending, f));
  }).joined, /protected set is empty/);
});

// ── A3: allowances are per occurrence ───────────────────────────────────────

test("MUT-19 cardinality: a second reach in an allowlisted file fails; a removed allowance with the caller present fails; a stale unused allowance fails", () => {
  const base = mutate(() => {});
  const allow = {};
  for (const s of base.sites) { const k = `${s.file}|${s.kind}|${s.name}`; allow[k] = allow[k] || { count: 0, slice: "x" }; allow[k].count++; }
  assert.deepEqual(compareToAllowlist(base.sites, allow), [], "control: the derived allowlist matches exactly");

  const second = mutate((root) => {
    const p = join(root, "src", "lib", "supabase.js");
    writeFileSync(p, readFileSync(p, "utf8") + "\nexport const extra = () => supabase.from(\"orders\").select(\"id\");\n");
  });
  assert.match(compareToAllowlist(second.sites, allow).join("\n"), /COUNT: src\/lib\/supabase\.js\|table\|orders found ×3, allowlist says ×2/);

  const removed = { ...allow }; delete removed["src/lib/supabase.js|rpc|verify_employee_pin"];
  assert.match(compareToAllowlist(base.sites, removed).join("\n"), /NOT ALLOWLISTED: src\/lib\/supabase\.js\|rpc\|verify_employee_pin/);

  const stale = { ...allow, "src/gone.js|table|orders": { count: 1, slice: "6" } };
  assert.match(compareToAllowlist(base.sites, stale).join("\n"), /STALE: src\/gone\.js\|table\|orders/);
});

// ── A6: snapshot validation ─────────────────────────────────────────────────

test("MUT-20 snapshot validation: missing, malformed, empty, wrong project, unapproved role, duplicates, RECORDED BY HAND, ledger mismatch", () => {
  const rm = (root) => rmSync(join(root, "supabase", "tables.json"));
  assert.match(mutate(rm).joined, /tables\.json is absent/);
  assert.match(mutate((root) => write(root, "supabase/tables.json", "{not json")).joined, /not valid JSON/);
  assert.match(mutate((root) => write(root, "supabase/tables.json", { ...FIXTURE_TABLES, tables: [] })).joined, /lists no tables/);
  assert.match(mutate((root) => write(root, "supabase/tables.json", { ...FIXTURE_TABLES, project: "lboajqihpsfrokqvjgnl" })).joined, /project is "lboajqihpsfrokqvjgnl", expected gmxyisjjaxtpycsmmzef/);
  assert.match(mutate((root) => write(root, "supabase/tables.json", { ...FIXTURE_TABLES, role: "anon" })).joined, /captured as role "anon"/);
  assert.match(mutate((root) => write(root, "supabase/tables.json", { ...FIXTURE_TABLES, tables: [...FIXTURE_TABLES.tables, "orders"] })).joined, /tables has duplicates: orders/);
  assert.match(mutate((root) => write(root, "supabase/tables.json", { ...FIXTURE_TABLES, project: "RECORDED BY HAND: MCP project_id" })).joined, /RECORDED BY HAND/);
  assert.match(mutate((root) => write(root, "supabase/tables.json", { ...FIXTURE_TABLES, ledgerVersion: "20200101000000" })).joined, /ledgerVersion 20200101000000 != newest applied migration file/);
  assert.match(mutate((root) => write(root, "supabase/tables.json", { ...FIXTURE_TABLES, views: "none" })).joined, /has no views array/);
});
