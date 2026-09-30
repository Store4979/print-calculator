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
// The lexical route check (INV-R1) is bounded: a route assembled from pieces
// none of which contains ".netlify", "netlify/" or "/functions/" is not seen by
// it. That residual was REJECTED as sufficient for G0 (reviews of the fcb5da6
// round and of 8913a69). It is closed by the request/dispatcher boundary
// (MUT-42..48): every raw request API is a site whatever its URL looks like,
// only allowlisted sites may exist, and dispatchers accept only statically
// approved route-name literals. No further lexical substring is added.
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
import { ALLOWLIST, RETIRED_EVER } from "./inventory-allowlist.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const BASELINE = appliedBaselineVersion(ROOT);

const FIXTURE_TABLES = {
  project: "gmxyisjjaxtpycsmmzef", capturedBy: "fixture", query: "scripts/manual/tables-snapshot.sql", capturedAt: "2026-09-23T14:59:46Z",
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

/** Run one mutant; return errors and helpers. `gate` is the COMPOSED verdict:
 *  scanner errors plus the real allowlist's problems — what CI would say. */
function mutate(apply, opts = {}) {
  const root = copyTree();
  try {
    apply(root);
    const r = runInventory({ root, retiredEver: RETIRED_EVER, ...opts });
    const gate = [...r.errors, ...compareToAllowlist(r.sites, ALLOWLIST)];
    return { errors: r.errors, joined: r.errors.join("\n"), gate, gateJoined: gate.join("\n"), sites: r.sites, siteIn: (file) => r.sites.filter((s) => s.file === file) };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
/** Edit a file in the copy by exact replacement (asserts the anchor is unique). */
function edit(root, rel, from, to) {
  const p = join(root, rel);
  const src = readFileSync(p, "utf8");
  assert.equal(src.split(from).length - 1, 1, `anchor not unique in ${rel}: ${from}`);
  writeFileSync(p, src.replace(from, to), "utf8");
}

test("CONTROL — the unmutated copy with the fixture snapshot scans clean, and the fixture is validated (not skipped)", () => {
  const r = mutate(() => {});
  assert.deepEqual(r.gate, [], "\n  " + r.gate.join("\n  "));
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
  assert.deepEqual(r.siteIn("src/mutant.js").map((s) => `${s.kind}|${s.name}`).sort(), ["request|call:fetch:dynamic", "route-builder|template"],
    "both the route builder and the raw request are sites (Part 1 of the 8913a69 review)");
  const problems = compareToAllowlist(r.sites, {});   // an empty allowlist: everything is a problem
  assert.ok(problems.some((p) => p.includes("src/mutant.js|route-builder|template")), "the allowlist sees the new builder");
  assert.match(mutate((root) => write(root, "src/mutant.js", "export const u = \"/.netlify/functions/../admin\";\n")).joined, /route piece .* is not a full/);
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
  }).joined, /is not in the tombstone form/);
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

// ── review of b294791: I1–I4, INV-6 — every case judged by the COMPOSED gate ──

test("MUT-21 (I1) a boolean-only use is a guard; a value escape through || or && fails, including export-then-.from", () => {
  const ok = mutate((root) => write(root, "src/mutant.js", IMPORT + "export const f = () => { if (!supabase) return null; return supabase ? 1 : 0; };\nsupabase && console.log(1);\n"));
  assert.deepEqual(ok.errors, [], "guards alone raise no scanner error (the new file is still refused by the allowlist as a holder — that is INV-2, not I1)");
  assert.match(mutate((root) => write(root, "src/mutant.js", IMPORT + "export const c = supabase || null;\nexport const f = () => c.from(\"orders\");\n")).gateJoined, /escapes as a value through a logical expression/);
  assert.match(mutate((root) => write(root, "src/mutant.js", IMPORT + "export const f = () => supabase && supabase;\n")).gateJoined, /escapes as a value/);
  assert.match(mutate((root) => write(root, "src/mutant.js", IMPORT + "const c = supabase ?? null;\nexport const f = () => c.from(\"orders\");\n")).gateJoined, /escapes as a value/);
});

test("MUT-22 (I1) dynamic import of the package outside the gateway fails", () => {
  assert.match(mutate((root) => write(root, "src/mutant.js", "export const f = async () => (await import(\"@supabase/supabase-js\")).createClient(\"u\", \"k\");\n")).gateJoined,
    /dynamic import\(\) of @supabase\/supabase-js; only src\/lib\/supabase\.js may/);
});

test("MUT-23 (I1) a route built piecewise fails outside the approved dispatcher", () => {
  assert.match(mutate((root) => write(root, "src/mutant.js", "export const call = (n) => fetch(\"/.netlify/\" + \"functions/\" + n);\n")).gateJoined, /route piece "\/\.netlify\/" is not a full/);
  assert.match(mutate((root) => write(root, "src/mutant.js", "const P = \"/.netlify/functions/\";\nexport const call = (n) => fetch(P + n);\n")).gateJoined, /route piece "\/\.netlify\/functions\/" is not a full/);
  assert.match(mutate((root) => write(root, "src/mutant.js", "export const call = (n) => fetch([\".netlify\", \"functions\", n].join(\"/\"));\n")).gateJoined, /route piece "\.netlify" is not a full/);
});

test("MUT-24 (I2) a shadowing binding inside an already-allowlisted function defeats the constant: parameter, nested local, catch, destructuring", () => {
  const SIG = "export const downloadJobFile = async (path) => {";
  assert.match(mutate((root) => edit(root, "src/lib/supabase.js", SIG, "export const downloadJobFile = async (path, JOB_FILES_BUCKET) => {")).gateJoined,
    /identifier JOB_FILES_BUCKET is shadowed here by a parameter/, "parameter shadow — site count unchanged, so only the scanner can catch it");
  assert.match(mutate((root) => edit(root, "src/lib/supabase.js", SIG, SIG + "\n  const JOB_FILES_BUCKET = path;")).gateJoined,
    /identifier JOB_FILES_BUCKET is shadowed here by a const in an enclosing block/, "nested-local shadow");
  assert.match(mutate((root) => edit(root, "src/lib/supabase.js", SIG, "export const downloadJobFile = async ({ path, JOB_FILES_BUCKET }) => {")).gateJoined,
    /shadowed here by a parameter/, "destructuring parameter shadow");
  assert.match(mutate((root) => write(root, "src/mutant.js", IMPORT + "const B = \"job-files\";\nexport const f = () => { try { throw 0; } catch (B) { return supabase.storage.from(B).list(); } };\n")).gateJoined,
    /shadowed here by a catch binding/, "catch shadow");
});

test("MUT-25 (I3) the tombstone form is parsed: a 200 with a 410 comment, a request-dependent branch, an extra statement and a parameter all fail", () => {
  const retire = (root, body) => { write(root, "netlify/functions/_retired.json", { retired: ["old-route"] }); write(root, "netlify/functions/old-route.js", body); };
  assert.deepEqual(mutate((root) => retire(root, TOMBSTONE)).errors, [], "control: the real tombstone form passes the scanner");
  assert.match(mutate((root) => retire(root, "export const TOMBSTONE = true;\n// answers 410\nexport const handler = async () => ({ statusCode: 200, body: \"410 Gone\" });\n")).gateJoined,
    /statusCode is 200, not the literal 410/);
  assert.match(mutate((root) => retire(root, "export const TOMBSTONE = true;\nexport const handler = async (event) => (event.httpMethod === \"GET\" ? { statusCode: 410 } : { statusCode: 200 });\n")).gateJoined,
    /handler must take no parameters/);
  assert.match(mutate((root) => retire(root, "export const TOMBSTONE = true;\nexport const handler = async () => (Math.random() > 0.5 ? { statusCode: 410 } : { statusCode: 410 });\n")).gateJoined,
    /handler must return an object literal/);
  assert.match(mutate((root) => retire(root, "export const TOMBSTONE = true;\nconst x = 1;\nexport const handler = async () => ({ statusCode: 410 });\n")).gateJoined,
    /has 3 top-level statements/);
  assert.match(mutate((root) => retire(root, "export const TOMBSTONE = true;\nexport const handler = async () => ({ statusCode: 410, body: JSON.stringify({}) });\n")).gateJoined,
    /property "body" is not a literal/);
});

test("MUT-26 (I4) capturedAt, capturedBy, database and query: missing, empty and invalid each fail", () => {
  const snap = (over) => (root) => { const o = { ...FIXTURE_TABLES, ...over }; for (const k of Object.keys(over)) if (over[k] === undefined) delete o[k]; write(root, "supabase/tables.json", o); };
  assert.match(mutate(snap({ capturedAt: undefined })).gateJoined, /capturedAt is missing or not a UTC timestamp/);
  assert.match(mutate(snap({ capturedAt: "" })).gateJoined, /capturedAt is missing or not/);
  assert.match(mutate(snap({ capturedAt: "yesterday" })).gateJoined, /capturedAt is missing or not/);
  assert.match(mutate(snap({ capturedAt: "2026-13-45T99:00:00Z" })).gateJoined, /capturedAt is missing or not/);
  assert.match(mutate(snap({ capturedBy: undefined })).gateJoined, /capturedBy is missing or empty/);
  assert.match(mutate(snap({ capturedBy: "   " })).gateJoined, /capturedBy is missing or empty/);
  assert.match(mutate(snap({ database: undefined })).gateJoined, /database is missing or empty/);
  assert.match(mutate(snap({ database: "" })).gateJoined, /database is missing or empty/);
  assert.match(mutate(snap({ query: undefined })).gateJoined, /query must name scripts\/manual\/tables-snapshot\.sql/);
  assert.match(mutate(snap({ query: "something-else.sql" })).gateJoined, /query must name/);
});

test("MUT-27 (INV-6) Release 2 table presence follows applied state: apply + refresh passes; refresh alone fails; apply alone fails; the browser prohibition holds in every case", () => {
  const R2 = ["auth_attempts", "device_enrollments", "enrollment_tickets", "staff_sessions", "upload_capabilities", "upload_capability_files"];
  const applyAll = (root) => {
    const pending = join(root, "supabase", "migrations", "pending"), applied = join(root, "supabase", "migrations");
    for (const f of readdirSync(pending)) if (/^release2_/.test(f)) renameSync(join(pending, f), join(applied, `20260930120000_${f}`));
  };
  const refreshed = { ...FIXTURE_TABLES, ledgerVersion: "20260930120000", tables: [...FIXTURE_TABLES.tables, ...R2] };

  const both = mutate((root) => { applyAll(root); write(root, "supabase/tables.json", refreshed); });
  assert.deepEqual(both.gate, [], "a legitimate stage-0 apply with a refreshed snapshot passes: " + both.gateJoined);

  const refreshOnly = mutate((root) => write(root, "supabase/tables.json", { ...FIXTURE_TABLES, tables: [...FIXTURE_TABLES.tables, ...R2] }));
  assert.match(refreshOnly.gateJoined, /contains "[a-z_]+", which no applied migration creates/);

  const applyOnly = mutate((root) => { applyAll(root); write(root, "supabase/tables.json", { ...FIXTURE_TABLES, ledgerVersion: "20260930120000" }); });
  assert.match(applyOnly.gateJoined, /lacks "[a-z_]+", which an APPLIED release2 migration creates/);

  const prohibitionStillHolds = mutate((root) => { applyAll(root); write(root, "supabase/tables.json", refreshed); write(root, "src/mutant.js", IMPORT + "export const f = () => supabase.from(\"staff_sessions\").select(\"*\");\n"); });
  assert.match(prohibitionStillHolds.gateJoined, /names the Release 2 table "staff_sessions"/, "independent of applied state and of the snapshot");
});

// ── Codex review of b294791: its EXACT reproductions, verbatim ──────────────
// MUT-21..27 cover the same defects in shapes chosen before the review file
// was available. These are the reviewer's own mutations, run against the
// REAL committed snapshot and the real allowlist, so the regression is pinned
// to the evidence that found it.

function mutateReal(apply, opts = {}) {
  return mutate((root) => {
    cpSync(join(ROOT, "supabase", "tables.json"), join(root, "supabase", "tables.json"));
    apply(root);
  }, opts);
}

test("MUT-28 Codex I1a exact: escape appended INSIDE the gateway fails", () => {
  const r = mutateReal((root) => {
    const p = join(root, "src", "lib", "supabase.js");
    writeFileSync(p, readFileSync(p, "utf8") + '\nexport const escaped = supabase || null;\nexport const hiddenReach = () => escaped.from("orders").select("*");\n');
  });
  assert.match(r.gateJoined, /src\/lib\/supabase\.js:\d+: the client escapes as a value through a logical expression/);
});

test("MUT-29 Codex I1b and I1c exact: destructured dynamic package import; concatenated route", () => {
  assert.match(mutateReal((root) => write(root, "src/hidden.js",
    'export async function hiddenReach(url, key) {\n  const { createClient } = await import("@supabase/supabase-js");\n  return createClient(url, key).from("orders").select("*");\n}\n')).gateJoined,
    /dynamic import\(\) of @supabase\/supabase-js/);
  assert.match(mutateReal((root) => write(root, "src/hidden.js",
    'export const hiddenRoute = name =>\n  fetch("/.netlify/" + "functions/" + name);\n')).gateJoined,
    /route piece "\/\.netlify\/" is not a full/);
});

test("MUT-30 Codex I2 exact: a DEFAULTED parameter shadows the bucket constant in downloadJobFile", () => {
  const r = mutateReal((root) => edit(root, "src/lib/supabase.js",
    "export const downloadJobFile = async (path) => {",
    'export const downloadJobFile = async (\n  path, JOB_FILES_BUCKET = "customer-uploads"\n) => {'));
  assert.match(r.gateJoined, /identifier JOB_FILES_BUCKET is shadowed here by a parameter/);
});

test("MUT-31 Codex I3 exact: a 200 handler with a 410 comment, listed in BOTH retirement records", () => {
  const r = mutateReal((root) => {
    write(root, "netlify/functions/_retired.json", { retired: ["old-route"] });
    write(root, "netlify/functions/old-route.js", '// Previously returned 410\nexport const TOMBSTONE = true;\nexport const handler = async () => ({ statusCode: 200, body: "still live" });\n');
  }, { retiredEver: [...RETIRED_EVER, "old-route"] });
  assert.match(r.gateJoined, /statusCode is 200, not the literal 410/);
});

test("MUT-32 Codex I4 exact: the real snapshot with capturedAt, capturedBy and database removed fails", () => {
  const r = mutateReal((root) => {
    const p = join(root, "supabase", "tables.json");
    const j = JSON.parse(readFileSync(p, "utf8"));
    delete j.capturedAt; delete j.capturedBy; delete j.database;
    writeFileSync(p, JSON.stringify(j, null, 2));
  });
  assert.match(r.gateJoined, /capturedAt is missing/);
});

test("MUT-33 Codex lifecycle note: a stage-0 apply with the REAL snapshot refreshed passes the composed gate", () => {
  const R2 = ["auth_attempts", "device_enrollments", "enrollment_tickets", "staff_sessions", "upload_capabilities", "upload_capability_files"];
  const r = mutateReal((root) => {
    const pending = join(root, "supabase", "migrations", "pending"), applied = join(root, "supabase", "migrations");
    for (const f of readdirSync(pending)) if (/^release2_/.test(f)) renameSync(join(pending, f), join(applied, `20261001000000_${f}`));
    const p = join(root, "supabase", "tables.json");
    const j = JSON.parse(readFileSync(p, "utf8"));
    j.ledgerVersion = "20261001000000";
    j.tables = [...j.tables, ...R2].sort();
    writeFileSync(p, JSON.stringify(j, null, 2));
  });
  assert.deepEqual(r.gate, [], "\n  " + r.gate.join("\n  "));
});

// ── review of ff677d6: INV-R1..R3 ─────────────────────────────────────────────
// Reproductions written by this session from the review's descriptions (the
// review file itself was not available); each is judged by the COMPOSED gate on
// the REAL snapshot and allowlist, and each passed the ff677d6 scanner.

test("MUT-34 (R1) route templates built from fragments fail — in a NEW file and inside an allowlisted dispatcher; a suffix after the dispatcher fails", () => {
  const re = /route template .* is not the dispatcher form/;
  assert.match(mutateReal((root) => write(root, "src/r1.js", "export const f = (n) => fetch(`/.netlify/${\"functions\"}/${n}`);\n")).gateJoined, re);
  assert.match(mutateReal((root) => write(root, "src/r1.js", "export const f = (n) => fetch(`/.netlify${\"/functions/\"}${n}`);\n")).gateJoined, re);
  assert.match(mutateReal((root) => edit(root, "src/components/PrintQueue.jsx",
    "const FN = (name) => `/.netlify/functions/${name}`;", "const FN = (name) => `/.netlify/${\"functions\"}/${name}`;")).gateJoined, re);
  assert.match(mutateReal((root) => edit(root, "src/components/PrintQueue.jsx",
    "const FN = (name) => `/.netlify/functions/${name}`;", "const FN = (name) => `/.netlify/functions/${name}/x`;")).gateJoined, re,
    "same site count — only the form check can see it");
  assert.match(mutateReal((root) => write(root, "src/r1.js", "export const f = (n) => fetch(\"/.net\" + \"lify/functions/\" + n);\n")).gateJoined,
    /route piece "lify\/functions\/" is not a full/);
});

test("MUT-35 (R1 controls) the dispatcher form is a route-builder site, not an error; the word Netlify in prose is not a route", () => {
  const r = mutateReal((root) => write(root, "src/r1.js", "export const f = (name) => fetch(`/.netlify/functions/${name}`);\nexport const m = \"not a Netlify build\";\n"));
  assert.deepEqual(r.errors, [], "the scanner accepts the dispatcher form and the prose");
  assert.deepEqual(r.siteIn("src/r1.js").map((s) => `${s.kind}|${s.name}`).sort(), ["request|f:fetch:dynamic", "route-builder|template"]);
  assert.match(r.gateJoined, /NOT ALLOWLISTED: src\/r1\.js\|route-builder\|template/, "a NEW dispatcher is still refused by the allowlist");
});

test("MUT-36 (R2) re-exporting the package fails in every form, the gateway included", () => {
  const re = /re-exports @supabase\/supabase-js/;
  for (const src of [
    "export { createClient } from \"@supabase/supabase-js\";\n",
    "export * from \"@supabase/supabase-js\";\n",
    "export * as sb from \"@supabase/supabase-js\";\n",
    "export { createClient as cc } from \"@supabase/supabase-js\";\n",
  ]) assert.match(mutateReal((root) => write(root, "src/r2.js", src)).gateJoined, re, src);
  assert.match(mutateReal((root) => {
    const p = join(root, "src", "lib", "supabase.js");
    writeFileSync(p, readFileSync(p, "utf8") + "\nexport { createClient as makeClient } from \"@supabase/supabase-js\";\n");
  }).gateJoined, /src\/lib\/supabase\.js:\d+: re-exports @supabase\/supabase-js/);
});

test("MUT-37 (R3) a var anywhere in the using function shadows the constant — nested block, for-head — in the allowlisted downloadJobFile", () => {
  const SIG = "export const downloadJobFile = async (path) => {";
  const re = /identifier JOB_FILES_BUCKET is shadowed here by a var hoisted to the enclosing function/;
  assert.match(mutateReal((root) => edit(root, "src/lib/supabase.js", SIG, SIG + "\n  if (path) { var JOB_FILES_BUCKET = \"customer-uploads\"; }")).gateJoined, re);
  assert.match(mutateReal((root) => edit(root, "src/lib/supabase.js", SIG, SIG + "\n  for (var JOB_FILES_BUCKET = \"customer-uploads\"; false;) {}")).gateJoined, re);
  assert.match(mutateReal((root) => edit(root, "src/lib/supabase.js", SIG, SIG + "\n  { { var { JOB_FILES_BUCKET } = { JOB_FILES_BUCKET: \"customer-uploads\" }; } }")).gateJoined, re, "destructuring var, two blocks deep");
});

test("MUT-38 (R3 controls) a var of the same name in a SEPARATE function, or in a function NESTED inside the using one, does not shadow", () => {
  const SIG = "export const downloadJobFile = async (path) => {";
  const sep = mutateReal((root) => {
    const p = join(root, "src", "lib", "supabase.js");
    writeFileSync(p, readFileSync(p, "utf8") + "\nexport const unrelated = () => { var JOB_FILES_BUCKET = \"x\"; return JOB_FILES_BUCKET; };\n");
  });
  assert.deepEqual(sep.gate, [], "separate function: " + sep.gateJoined);
  const nested = mutateReal((root) => edit(root, "src/lib/supabase.js", SIG, SIG + "\n  const helper = () => { var JOB_FILES_BUCKET = \"x\"; return JOB_FILES_BUCKET; }; void helper;"));
  assert.deepEqual(nested.gate, [], "nested function: " + nested.gateJoined);
});

// ── Codex review of ff677d6: its EXACT reproductions, verbatim ──────────────

test("MUT-39 Codex INV-R1 exact: hiddenRoute built from template fragments", () => {
  const r = mutateReal((root) => write(root, "src/review-hidden-route.js",
    'export const hiddenRoute = name => fetch(`/.netlify/${"functions"}/${name}`);\n'));
  assert.match(r.gateJoined, /src\/review-hidden-route\.js:1: route template .* is not the dispatcher form/);
});

test("MUT-40 Codex INV-R2 exact: a package re-export in one file, the client built from it in another", () => {
  const r = mutateReal((root) => {
    write(root, "src/review-client-factory.js", 'export { createClient } from "@supabase/supabase-js";\n');
    write(root, "src/review-hidden-client.js",
      'import { createClient } from "./review-client-factory.js"; export const hiddenReach = (url, key) => createClient(url, key).from("orders").select("*");\n');
  });
  assert.match(r.gateJoined, /src\/review-client-factory\.js:1: re-exports @supabase\/supabase-js/);
});

test("MUT-41 Codex INV-R3 exact: `if (true) { var JOB_FILES_BUCKET = … }` at the start of downloadJobFile", () => {
  const r = mutateReal((root) => edit(root, "src/lib/supabase.js",
    "export const downloadJobFile = async (path) => {",
    'export const downloadJobFile = async (path) => {\n  if (true) { var JOB_FILES_BUCKET = "customer-uploads"; }'));
  assert.match(r.gateJoined, /identifier JOB_FILES_BUCKET is shadowed here by a var hoisted to the enclosing function/);
});

// ── Review of 8913a69, Part 1: the request/dispatcher boundary ──────────────
// Detection is by request API and by dispatcher call, never by how a URL is
// spelled: the residual stated above for the lexical route check is closed by
// this boundary, not by more substrings.

test("MUT-42 Codex exact: a fetch whose URL is joined from pieces (\".net\" + \"lify\") is a NEW request site the gate refuses", () => {
  const r = mutateReal((root) => write(root, "src/review-hidden-route.js",
    'export const hiddenRoute = name =>\n  fetch(["", ".net" + "lify", "functions", name].join("/"));\n'));
  assert.match(r.gateJoined, /NOT ALLOWLISTED: src\/review-hidden-route\.js\|request\|hiddenRoute:fetch:dynamic/);
});

test("MUT-43 Codex exact: reviewHiddenCaller = name => callQueueFn(name, {}) in App.jsx fails the dispatcher rule", () => {
  const r = mutateReal((root) => {
    const p = join(root, "src", "App.jsx");
    writeFileSync(p, readFileSync(p, "utf8") + "\nexport const reviewHiddenCaller = name => callQueueFn(name, {});\n");
  });
  assert.match(r.gateJoined, /dispatcher callQueueFn called from reviewHiddenCaller with a non-literal route name/);
});

test("MUT-44 variants: template literal, URL object, alias of fetch, window.fetch, globalThis.fetch — all refused", () => {
  const cases = [
    ["template", "export const f1 = (n) => fetch(`/.net${\"lify\"}/functions/${n}`);\n", /NOT ALLOWLISTED: src\/v\.js\|request\|f1:fetch:dynamic/],
    ["URL object", "export const f2 = (n) => fetch(new URL(\"/x/\" + n, location.origin));\n", /NOT ALLOWLISTED: src\/v\.js\|request\|f2:fetch:dynamic/],
    ["alias", "const go = fetch;\nexport const f3 = (u) => go(u);\n", /the request API fetch is referenced as a value/],
    ["window.fetch", "export const f4 = (u) => window.fetch(u);\n", /NOT ALLOWLISTED: src\/v\.js\|request\|f4:fetch:dynamic/],
    ["globalThis.fetch alias", "const g = globalThis.fetch;\nexport const f5 = (u) => g(u);\n", /globalThis\.fetch is referenced without being called/],
    ["computed window", "export const f6 = (u) => window[\"fe\" + \"tch\"](u);\n", /computed access on window can reach a request API/],
    ["fetch.call", "export const f7 = (u) => fetch.call(null, u);\n", /the request API fetch is referenced as a value/],
  ];
  for (const [label, src, re] of cases) assert.match(mutateReal((root) => write(root, "src/v.js", src)).gateJoined, re, label);
});

test("MUT-45 variants: a dispatcher re-exported, aliased, or passed as a value; a literal naming no function", () => {
  const app = (tail) => (root) => { const p = join(root, "src", "App.jsx"); writeFileSync(p, readFileSync(p, "utf8") + tail); };
  assert.match(mutateReal(app("\nexport { callQueueFn as reviewedTransport };\n")).gateJoined, /dispatcher callQueueFn is re-exported as reviewedTransport/);
  assert.match(mutateReal(app("\nexport const q = callQueueFn;\n")).gateJoined, /dispatcher callQueueFn is referenced as a value \(VariableDeclarator\)/);
  assert.match(mutateReal(app("\nexport const r = [\"start-upload\"].map(callQueueFn);\n")).gateJoined, /dispatcher callQueueFn is referenced as a value \(CallExpression\)/);
  assert.match(mutateReal(app("\nexport const s = () => callQueueFn(\"no-such-route\", {});\n")).gateJoined, /callQueueFn\("no-such-route"\) names no function/);
  assert.match(mutateReal((root) => edit(root, "src/components/PrintQueue.jsx",
    "const FN = (name) => `/.netlify/functions/${name}`;", "const FN = (name) => `/.netlify/functions/${name}`;\nexport const leak = (n) => FN(n);")).gateJoined,
    /dispatcher FN called from leak with a non-literal route name/, "FN outside its reviewed forwarding caller");
});

test("MUT-46 every other raw request API: XMLHttpRequest, sendBeacon, EventSource, WebSocket, axios, a remote dynamic import", () => {
  const cases = [
    ["xhr", "export const a = () => new XMLHttpRequest();\n", /NOT ALLOWLISTED: src\/v\.js\|request\|a:XMLHttpRequest:none/],
    ["beacon", "export const b = (u) => navigator.sendBeacon(u, \"x\");\n", /NOT ALLOWLISTED: src\/v\.js\|request\|b:sendBeacon:dynamic/],
    ["eventsource", "export const c = (u) => new EventSource(u);\n", /NOT ALLOWLISTED: src\/v\.js\|request\|c:EventSource:dynamic/],
    ["websocket", "export const d = (u) => new WebSocket(u);\n", /NOT ALLOWLISTED: src\/v\.js\|request\|d:WebSocket:dynamic/],
    ["axios", "import axios from \"axios\";\nexport const e = (u) => axios.get(u);\n", /imports the request library "axios"/],
    ["remote import", "export const f = () => import(\"https://example.com/x.js\");\n", /dynamic import\(\) of a remote URL/],
  ];
  for (const [label, src, re] of cases) assert.match(mutateReal((root) => write(root, "src/v.js", src)).gateJoined, re, label);
});

test("MUT-47 an allowlisted site whose reviewed literal is changed, and a second request inside a reviewed dispatcher, both fail", () => {
  const a = mutateReal((root) => edit(root, "src/App.jsx", 'fetch("/.netlify/functions/send-print-job"', 'fetch("/pricing.json?x"'));
  assert.match(a.gateJoined, /STALE: src\/App\.jsx\|request\|sendOrderEmail:fetch:lit=\/\.netlify\/functions\/send-print-job/);
  const b = mutateReal((root) => edit(root, "src/components/PrintQueue.jsx", "const res = await fetch(FN(name), {", "await fetch(\"/extra\"); const res = await fetch(FN(name), {"));
  assert.match(b.gateJoined, /NOT ALLOWLISTED: src\/components\/PrintQueue\.jsx\|request\|callFn:fetch:lit=\/extra/);
});

test("MUT-48 CONTROLS: the real dispatcher calls with literal route names, and a .fetch method on an ordinary object, are not violations", () => {
  const r = mutateReal((root) => write(root, "src/v.js", "const api = { fetch: (x) => x };\nexport const ok = () => api.fetch(\"anything\");\n"));
  assert.deepEqual(r.errors, [], "api.fetch is not a request API");
  assert.deepEqual(r.siteIn("src/v.js").filter((s) => s.kind === "request"), []);
  assert.deepEqual(mutateReal(() => {}).gate, [], "the real tree's literal dispatcher calls and reviewed forwarding pass");
});

// ── Review of d01b74a, N1: global aliases and the asset transport ────────────
const LOGO_FETCH = 'return fetch(BUNDLED_LOGO, { method: "GET", credentials: "omit", redirect: "error", cache: "no-store" });';
const CODEX_POST = 'fetch(["", ".net" + "lify", "functions", "register" + "-job"].join("/"), {\n  method: "POST",\n  body: JSON.stringify({ customerName: "MUTANT", files: [{ path: "x" }] })\n})';

test("MUT-49 Codex exact #1: the split register-job POST, put where the logo request was and inside the asset transport, fails both ways", () => {
  const inApp = mutateReal((root) => edit(root, "src/App.jsx",
    "UPS_LOGO_PDF_DATA_URL = await loadLogoDataUrl(UPS_LOGO_DATA_URL);",
    `await ${CODEX_POST};\n  UPS_LOGO_PDF_DATA_URL = await loadLogoDataUrl(UPS_LOGO_DATA_URL);`));
  assert.match(inApp.gateJoined, /NOT ALLOWLISTED: src\/App\.jsx\|request\|ensureLogoPdfDataUrl:fetch:dynamic/);
  const inTransport = mutateReal((root) => edit(root, "src/lib/assetTransport.js", LOGO_FETCH, `return ${CODEX_POST};`));
  assert.match(inTransport.gateJoined, /asset transport: the URL must be one of the listed string constants/);
  assert.match(inTransport.gateJoined, /NOT ALLOWLISTED: src\/lib\/assetTransport\.js\|request\|fetchBundledLogo:fetch:dynamic/);
  assert.match(inTransport.gateJoined, /STALE: src\/lib\/assetTransport\.js\|request\|fetchBundledLogo:fetch:const=BUNDLED_LOGO/);
});

test("MUT-50 Codex exact #2, and every other way to hold or reach the global object", () => {
  const exact = mutateReal((root) => edit(root, "src/App.jsx", 'import { loadLogoDataUrl, loadBundledPricing } from "./lib/assetTransport.js";',
    'import { loadLogoDataUrl, loadBundledPricing } from "./lib/assetTransport.js";\nconst reviewBrowser = window;\nexport const reviewRequest = name =>\n  reviewBrowser.fetch(["", ".net" + "lify", "functions", name].join("/"));'));
  assert.match(exact.gateJoined, /src\/App\.jsx:\d+: window \(the global object\) is used as a value \(VariableDeclarator\)/, "Codex's exact alias");
  const cases = [
    ["globalThis alias", "const g = globalThis;\nexport const a = (u) => g.fetch(u);\n", /globalThis \(the global object\) is used as a value/],
    ["self alias", "const s = self;\nexport const a = (u) => s.fetch(u);\n", /self \(the global object\) is used as a value/],
    ["window.self alias", "const s = window.self;\nexport const a = (u) => s.fetch(u);\n", /window\.self \(the global object\) is used as a value/],
    ["destructured fetch", "const { fetch: f } = window;\nexport const a = (u) => f(u);\n", /window \(the global object\) is used as a value/],
    ["Reflect.get", "export const a = (u) => Reflect.get(window, \"fetch\")(u);\n", /window \(the global object\) is used as a value \(CallExpression\)/],
    ["argument", "const use = (w) => w.fetch;\nexport const a = (u) => use(globalThis)(u);\n", /globalThis \(the global object\) is used as a value/],
    ["navigator alias", "const n = navigator;\nexport const a = (u) => n.sendBeacon(u);\n", /navigator \(the navigator object\) is used as a value/],
    ["document alias", "const d = document;\nexport const a = (u) => d.defaultView.fetch(u);\n", /document \(the document object\) is used as a value/],
    ["defaultView via a param", "export const a = (d, u) => d.defaultView.fetch(u);\n", /\.defaultView on something that is not the free `document`/],
    ["computed global prop", "export const a = (k, u) => window[k].fetch(u);\n", /computed access on window can reach a request API/],
    ["eval", "export const a = (s) => eval(s);\n", /eval evaluates code from a string/],
    ["Function", "export const a = (s) => Function(s)();\n", /Function evaluates code from a string/],
    ["constructor", "export const a = (s) => (() => 0).constructor(s)();\n", /reads a \.constructor/],
    ["string timer", "export const a = () => setTimeout(\"fet\" + \"ch('/x')\", 0);\n", /setTimeout's first argument is not provably a function/],
  ];
  for (const [label, src, re] of cases) assert.match(mutateReal((root) => write(root, "src/v.js", src)).gateJoined, re, label);
});

test("MUT-51 requests reached THROUGH a global chain are sites, whatever the chain", () => {
  const cases = [
    ["window.self.fetch", "export const a = (u) => window.self.fetch(u);\n", /NOT ALLOWLISTED: src\/v\.js\|request\|a:fetch:dynamic/],
    ["globalThis.window.fetch", "export const a = (u) => globalThis.window.fetch(u);\n", /NOT ALLOWLISTED: src\/v\.js\|request\|a:fetch:dynamic/],
    ["document.defaultView.fetch", "export const a = (u) => document.defaultView.fetch(u);\n", /NOT ALLOWLISTED: src\/v\.js\|request\|a:fetch:dynamic/],
    ["free top", "export const a = (u) => top.fetch(u);\n", /NOT ALLOWLISTED: src\/v\.js\|request\|a:fetch:dynamic/],
    ["optional chain", "export const a = (u) => window?.fetch(u);\n", /NOT ALLOWLISTED: src\/v\.js\|request\|a:fetch:dynamic/],
    ["window.navigator.sendBeacon", "export const a = (u) => window.navigator.sendBeacon(u, \"x\");\n", /NOT ALLOWLISTED: src\/v\.js\|request\|a:sendBeacon:dynamic/],
    ["Worker", "export const a = (u) => new Worker(u);\n", /NOT ALLOWLISTED: src\/v\.js\|request\|a:Worker:dynamic/],
  ];
  for (const [label, src, re] of cases) assert.match(mutateReal((root) => write(root, "src/v.js", src)).gateJoined, re, label);
});

test("MUT-52 the asset transport is GET / credentials omit / redirect error on a literal same-origin path: a POST, a body, credentials, a redirect or another URL fails", () => {
  const on = (from, to) => mutateReal((root) => edit(root, "src/lib/assetTransport.js", LOGO_FETCH, LOGO_FETCH.replace(from, to))).gateJoined;
  assert.match(on('method: "GET"', 'method: "POST"'), /asset transport: method must be the literal "GET"/, "POST through the asset path");
  assert.match(on('method: "GET"', 'method: "GET", body: "x"'), /option "body" is not allowed on an asset request/, "a body");
  assert.match(on('method: "GET"', 'method: "GET", headers: { "content-type": "application/json" }'), /option "headers" is not allowed on an asset request/, "headers");
  assert.match(on('credentials: "omit"', 'credentials: "include"'), /credentials must be the literal "omit"/, "credentials include");
  assert.match(on('redirect: "error"', 'redirect: "follow"'), /redirect must be the literal "error"/, "redirect follow");
  assert.match(on(', redirect: "error"', ""), /redirect must be the literal "error"/, "redirect absent");
  assert.match(mutateReal((root) => edit(root, "src/lib/assetTransport.js", LOGO_FETCH,
    'const o = { method: "GET", credentials: "omit", redirect: "error" };\n  return fetch(BUNDLED_LOGO, o);')).gateJoined,
    /the options must be a literal object/, "options via a variable");
  assert.match(mutateReal((root) => edit(root, "src/lib/assetTransport.js", 'const BUNDLED_LOGO = "/ups-logo.png";', 'const BUNDLED_LOGO = "/.netlify/functions/register-job";')).gateJoined,
    /BUNDLED_LOGO = "\/\.netlify\/functions\/register-job" is not a same-origin asset path/, "a function route as the asset path");
  assert.match(mutateReal((root) => edit(root, "src/lib/assetTransport.js", 'const BUNDLED_LOGO = "/ups-logo.png";', 'const BUNDLED_LOGO = "https://example.com/logo.png";')).gateJoined,
    /is not a same-origin asset path/, "another origin");
  assert.match(mutateReal((root) => edit(root, "src/lib/assetTransport.js", "async function fetchBundledPricing() {",
    'async function fetchSomethingElse(u) {\n  return fetch(u, { method: "GET", credentials: "omit", redirect: "error" });\n}\n\nasync function fetchBundledPricing() {')).gateJoined,
    /asset transport: a request in fetchSomethingElse, which is not a listed asset-transport function/, "an unlisted transport function");
});

test("MUT-53 CONTROLS: locals named top/parent/self/window, typeof/in probes and member reads of the globals are not violations", () => {
  const r = mutateReal((root) => write(root, "src/v.js", [
    "export const a = () => { const top = { fetch: (x) => x }; return top.fetch(1); };",
    "export const b = (parent) => parent.fetch;",
    "export const c = () => { const self = { n: 1 }; return self; };",
    "export const d = (window) => window;",
    "export const e = () => typeof window !== \"undefined\" && \"serviceWorker\" in navigator && globalThis.navigator?.locks;",
    "export const f = () => window.location.origin + document.title;",
    "",
  ].join("\n")));
  assert.deepEqual(r.errors, [], "none of these hold or call through the global object");
  assert.deepEqual(r.siteIn("src/v.js").filter((s) => s.kind === "request"), []);
});

// ── Review of dc5a88b, N1: code-evaluation sinks, fail-closed ────────────────
test("MUT-54 Codex's four exact modules each fail the unchanged gate", () => {
  const cases = [
    ["window.eval", "export const reviewRun = source => window.eval(source);\n", /window\.eval evaluates code from a string/],
    ["window.Function", "export const reviewRun = source => window.Function(source)();\n", /window\.Function evaluates code from a string/],
    ["window.setTimeout", "export const reviewRun = source => window.setTimeout(source, 0);\n", /window\.setTimeout's first argument is not provably a function/],
    ["setTimeout", "export const reviewRun = source => setTimeout(source, 0);\n", /setTimeout's first argument is not provably a function/],
  ];
  for (const [label, src, re] of cases) {
    const r = mutateReal((root) => write(root, "src/v.js", src));
    assert.match(r.gateJoined, re, label);
  }
});

test("MUT-55 every other route to an evaluation sink fails: qualified, computed, aliased, via .constructor", () => {
  const cases = [
    ["globalThis.Function", "export const a = (s) => new globalThis.Function(s);\n", /globalThis\.Function evaluates code/],
    ["self['eval']", "export const a = (s) => self[\"eval\"](s);\n", /computed access on self can reach a request API or a code-evaluation sink/],
    ["window[k]", "export const a = (k, s) => window[k](s);\n", /computed access on window/],
    ["alias of window.eval", "const e = window.eval;\nexport const a = (s) => e(s);\n", /window\.eval evaluates code/],
    ["window.self.eval", "export const a = (s) => window.self.eval(s);\n", /window\.self\.eval evaluates code/],
    ["indirect eval", "export const a = (s) => (0, eval)(s);\n", /eval evaluates code from a string/],
    ["arrow constructor", "export const a = (s) => (() => 0).constructor(s)();\n", /reads a \.constructor/],
    ["array constructor chain", "export const a = (s) => [].constructor.constructor(s)();\n", /reads a \.constructor/],
    ["constructor held", "const F = (() => {}).constructor;\nexport const a = (s) => F(s)();\n", /reads a \.constructor/],
    ["async constructor", "export const a = (s) => Object.getPrototypeOf(async function () {}).constructor(s);\n", /reads a \.constructor/],
    ["computed 'constructor'", "export const a = (s) => (() => 0)[\"constructor\"](s)();\n", /reads a \.constructor/],
    ["setInterval with a string var", "export const a = (s) => setInterval(s, 10);\n", /setInterval's first argument is not provably a function/],
    ["globalThis.setInterval", "export const a = (s) => globalThis.setInterval(s, 10);\n", /globalThis\.setInterval's first argument is not provably a function/],
    ["template-string timer", "export const a = () => setTimeout(`fet${\"ch\"}('/x')`, 0);\n", /setTimeout's first argument is not provably a function/],
    ["timer held", "const st = setTimeout;\nexport const a = (s) => st(s, 0);\n", /setTimeout is referenced as a value/],
    ["qualified timer held", "const st = window.setTimeout;\nexport const a = (s) => st(s, 0);\n", /window\.setTimeout is referenced as a value/],
    ["let-bound callback (reassignable)", "export const a = () => { let g = () => 1; setTimeout(g, 0); };\n", /setTimeout's first argument is not provably a function/],
    ["function declaration later reassigned via destructuring", "function g() { return 1; }\nexport const a = () => setTimeout(g, 0);\nexport const b = (o) => { ({ g } = o); };\n", /setTimeout's first argument is not provably a function/],
    ["parameter callback", "export const a = (cb) => setTimeout(cb, 0);\n", /setTimeout's first argument is not provably a function/],
    ["member callback", "export const a = (o) => setTimeout(o.run, 0);\n", /setTimeout's first argument is not provably a function/],
    ["dynamic import()", "export const a = (n) => import(n);\n", /dynamic import\(\) with a non-literal specifier/],
    ["template import()", "export const a = (n) => import(`./${n}.js`);\n", /dynamic import\(\) with a non-literal specifier/],
    ["Worker with a variable URL", "export const a = (u) => new Worker(u);\n", /new Worker with a non-literal URL/],
    ["SharedWorker with a variable URL", "export const a = (u) => new SharedWorker(u);\n", /new SharedWorker with a non-literal URL/],
  ];
  for (const [label, src, re] of cases) assert.match(mutateReal((root) => write(root, "src/v.js", src)).gateJoined, re, label);
});

test("MUT-56 CONTROLS: ordinary callback timers, literal imports and class constructors pass", () => {
  const r = mutateReal((root) => write(root, "src/v.js", [
    "const tock = () => 2;",
    "const tack = function () { return 3; };",
    "export const a = () => setTimeout(() => {}, 0);",
    "export const b = () => setTimeout(function () {}, 0);",
    "export const d = () => setInterval(tock, 10);",
    "export const d2 = () => setInterval(tack, 10);",
    "export const e = () => window.setTimeout(() => {}, 1);",
    "export const f = () => { const local = () => 3; return setTimeout(local, 0); };",
    "export const g = async () => (await import(\"qrcode\")).default;",
    "export class K { constructor(x) { this.x = x; } }",
    "export const h = () => { const id = setTimeout(() => {}, 1); clearTimeout(id); return tock; };",
    "",
  ].join("\n")));
  assert.deepEqual(r.errors, [], "none of these can evaluate a string");
});

// ── Review of add1d2c, N1: "provably callable" is structural ─────────────────
// A timer's first argument passes only as (a) an inline arrow or function
// expression, or (b) a name that scope resolution binds to a `const`
// initialized with one. The allowlist is unchanged in every case below.
const NOT_CALLABLE = /(setTimeout|setInterval)'s first argument is not provably a function/;

test("MUT-57 Codex's two exact add1d2c cases (a for…of / for…in write to a function declaration's name) fail the unchanged gate", () => {
  const cases = [
    ["for…of", "export const reviewRun = source => { function callback(){}; for (callback of [source]) {}; setTimeout(callback, 0); };\n"],
    ["for…in", "export const reviewRun = source => { function callback(){}; for (callback in { [source]: 1 }) {}; setTimeout(callback, 0); };\n"],
  ];
  for (const [label, src] of cases) assert.match(mutateReal((root) => write(root, "src/v.js", src)).gateJoined, NOT_CALLABLE, label);
});

test("MUT-58 every binding other than a const function fails by rule, whatever writes it or not", () => {
  const cases = [
    ["array destructuring write", "export const a = source => { function callback() {}; [callback] = [source]; setTimeout(callback, 0); };\n"],
    ["object destructuring write", "export const a = (o) => { function callback() {}; ({ a: callback } = o); setTimeout(callback, 0); };\n"],
    ["var redeclaration shadowing a function", "function callback() {}\nexport const a = (source) => { var callback = source; setTimeout(callback, 0); };\n"],
    ["var in a nested block shadowing an outer const arrow", "const callback = () => 1;\nexport const a = (source) => { if (source) { var callback = source; } setTimeout(callback, 0); };\n"],
    ["a function declaration passed directly", "function callback() {}\nexport const a = () => setTimeout(callback, 0);\n"],
    ["a function declaration, never written", "export const a = () => { function tick() { return 1; } return setInterval(tick, 10); };\n"],
    ["a function expression's own name", "export const a = function namedFn() { return setTimeout(namedFn, 5); };\n"],
    ["a let arrow reassigned", "export const a = (source) => { let cb = () => 1; cb = source; setTimeout(cb, 0); };\n"],
    ["a let arrow never reassigned", "export const a = () => { let cb = () => 1; setTimeout(cb, 0); };\n"],
    ["a var arrow", "export const a = () => { var cb = () => 1; setTimeout(cb, 0); };\n"],
    ["an inner let shadowing an outer const arrow", "const cb = () => 1;\nexport const a = (source) => { let cb = source; setTimeout(cb, 0); };\n"],
    ["a parameter shadowing an outer const arrow", "const cb = () => 1;\nexport const a = (cb) => setTimeout(cb, 0);\n"],
    ["a catch binding shadowing an outer const arrow", "const cb = () => 1;\nexport const a = () => { try { x(); } catch (cb) { setTimeout(cb, 0); } };\n"],
    ["a for-of const shadowing an outer const arrow", "const cb = () => 1;\nexport const a = (xs) => { for (const cb of xs) setTimeout(cb, 0); };\n"],
    ["a destructured const", "export const a = (o) => { const { cb } = o; setTimeout(cb, 0); };\n"],
    ["a const holding a call result", "const make = () => () => 1;\nconst cb = make();\nexport const a = () => setTimeout(cb, 0);\n"],
    ["a const alias of a const arrow", "const f = () => 1;\nconst cb = f;\nexport const a = () => setTimeout(cb, 0);\n"],
    ["an imported binding", "import { cb } from \"./lib/assetTransport.js\";\nexport const a = () => setTimeout(cb, 0);\n"],
    ["a class", "class C {}\nexport const a = () => setTimeout(C, 0);\n"],
    ["arguments", "export const a = function () { return setTimeout(arguments, 0); };\n"],
    ["a free name", "export const a = () => setTimeout(notDeclaredAnywhere, 0);\n"],
    ["a member, qualified timer", "export const a = (o) => window.setTimeout(o.cb, 0);\n"],
    ["a bound function", "const f = () => 1;\nexport const a = () => setTimeout(f.bind(null), 0);\n"],
    ["a conditional of two arrows", "export const a = (k) => setTimeout(k ? () => 1 : () => 2, 0);\n"],
  ];
  for (const [label, src] of cases) {
    const r = mutateReal((root) => write(root, "src/v.js", src));
    assert.match(r.gateJoined, NOT_CALLABLE, label);
  }
});

test("MUT-59 CONTROLS: inline arrow, inline function, const arrow and const function expression pass — at module level, in a block, in a for-head, exported, and with a (throwing) write to the const elsewhere; the real tree (TrainingDrawer's `const measure = () => …`) passes", () => {
  const r = mutateReal((root) => write(root, "src/v.js", [
    "const tock = () => 1;",
    "export const exported = () => 2;",
    "export const a = () => setTimeout(() => {}, 0);",
    "export const b = () => setTimeout(function () {}, 0);",
    "export const c = () => setInterval(tock, 10);",
    "export const d = () => setInterval(exported, 10);",
    "export const e = () => { { const inner = function () { return 3; }; return setTimeout(inner, 0); } };",
    "export const f = () => { for (const step = () => 4; ;) return setTimeout(step, 0); };",
    "export const g = (k) => { let cb = k; { const cb = () => 5; setTimeout(cb, 0); } return cb; };",
    // A write to a const throws at run time and changes nothing, so it does not
    // defeat the rule; the rule never consults writes.
    "export const h = (o) => { ({ tock } = o); };",
    "export const i = () => window.setTimeout(tock, 1);",
    "",
  ].join("\n")));
  assert.deepEqual(r.errors, [], "each argument is an inline function or a const bound to one");
  assert.deepEqual(mutateReal(() => {}).gate, [], "the real src/ tree, unchanged, passes");
  const real = readFileSync(join(ROOT, "src", "TrainingDrawer.jsx"), "utf8");
  assert.match(real, /const measure = \(\) =>/, "TrainingDrawer still declares measure as a const arrow");
  assert.match(real, /setInterval\(measure, 250\)/, "and passes it to setInterval");
});
