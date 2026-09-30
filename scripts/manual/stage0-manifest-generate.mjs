#!/usr/bin/env node
// Regenerate docs/security/stage0-production-manifest.json from the repository
// (review of d01b74a, N3). A manual tool: its output is a DIFF for review, and
// the manifest test (scripts/tests/stage0-manifest.test.js) is what holds the
// result to the repository. Running this tool approves nothing.
//
// What it recomputes:
//   - the pinned files' blob ids, md5s and byte counts, read from the paths
//     the recorded state puts them at, LF-normalized as git stores them;
//   - pinnedAt: kept when the bytes are unchanged, otherwise "manifest-commit";
//   - the outputs, by assembling from the new inputs;
//   - A3: the trees and blobs of the production build inputs, from the INDEX.
//     Stage the change first, then run this; a3.commit becomes
//     "manifest-commit", which the test resolves to the commit that carries
//     the manifest.
// What it preserves from the existing manifest (records, not derivations):
//   the baseline ledger once frozen, migrations[].productionVersion,
//   rollbackRecords, rollbackTargets, deploys, p6, a3.enforceAtHead, the send
//   policy (which texts may go to which project, read-only or not), and the
//   reviewer-facing notes.
//
//   node scripts/manual/stage0-manifest-generate.mjs          write the manifest
//   node scripts/manual/stage0-manifest-generate.mjs --check  exit 1 if it would change
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as A from "./assemble-stage0.mjs";
import { forwardPath, companionPath, MANIFEST_PATH } from "../tests/stage0-manifest-check.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const git = (...a) => execFileSync("git", a, { cwd: ROOT, maxBuffer: 1 << 26 });
const txt = (...a) => git(...a).toString("utf8").trim();
const lf = (p) => Buffer.from(readFileSync(join(ROOT, p)).toString("utf8").replace(/\r\n/g, "\n"), "utf8");
const writeBlob = (b) => execFileSync("git", ["hash-object", "-w", "--stdin"], { cwd: ROOT, input: b }).toString().trim();

const old = JSON.parse(readFileSync(join(ROOT, MANIFEST_PATH), "utf8"));
const entry = (path, prev) => {
  const b = lf(path);
  const blob = writeBlob(b);
  return { blob, md5: A.md5(b), bytes: b.length, pinnedAt: prev && prev.blob === blob && prev.pinnedAt ? prev.pinnedAt : "manifest-commit" };
};

// The baseline ledger is frozen the first time and preserved after.
let baselineLedger = old.baselineLedger;
if (!baselineLedger) {
  baselineLedger = txt("ls-tree", "--name-only", "HEAD", "supabase/migrations/").split("\n")
    .map((p) => p.split("/").pop()).filter((b) => /^\d{14}_.*\.sql$/.test(b) && !/\.rollback\.sql$/.test(b)).sort()
    .map((b) => { const p = `supabase/migrations/${b}`; const bytes = git("show", `HEAD:${p}`); return { version: b.slice(0, 14), name: b.slice(15, -4), blob: txt("rev-parse", `HEAD:${p}`), md5: A.md5(bytes) }; });
}

const migrations = A.MIGRATIONS.map((x) => {
  const prev = (old.migrations || []).find((m) => m.n === x.n) || {};
  const m = { n: x.n, name: x.name, pendingPath: A.migrationPath(x), productionVersion: prev.productionVersion ?? null };
  return { ...m, ...entry(forwardPath(m), prev) };
});
const rollbacks = A.MIGRATIONS.map((x) => {
  const prev = (old.rollbacks || []).find((r) => r.n === x.n) || {};
  const m = migrations.find((y) => y.n === x.n);
  const r = { n: x.n, pendingPath: A.rollbackPath(x) };
  return { ...r, ...entry(companionPath(m, r), prev) };
});
const proofs = { path: A.PROOFS, ...entry(A.PROOFS, old.proofs) };
const assembler = { path: "scripts/manual/assemble-stage0.mjs", ...entry("scripts/manual/assemble-stage0.mjs", old.assembler) };
const sender = { path: "scripts/manual/stage0-send.mjs", ...entry("scripts/manual/stage0-send.mjs", old.sender) };

const F = A.FUNCTIONS;
const M = {
  schema: "stage0-production-manifest/2",
  authority: old.authority,
  productionRef: A.PRODUCTION_REF,
  ledgerBaseline: old.ledgerBaseline,
  baselineLedger,
  identity: { stagingSeedStore: A.STAGING_SEED_STORE, productionStoreSlug: "store4979", probeSlug: A.PROBE_SLUG, nilJobId: "00000000-0000-0000-0000-000000000000" },
  migrations,
  rollbacks,
  rollbackRecords: old.rollbackRecords || [],
  proofs,
  assembler,
  sender,
  functions: Object.fromEntries(Object.entries(F).map(([k, [sig, h, acl]]) => [k, { signature: sig, prosrcMd5: h, execute: acl.split(",") }])),
  stateAfter: A.STATE_AFTER,
  bodies: old.bodies,
  tables: old.tables,
  constraint: old.constraint,
  rollbackOperations: A.ROLLBACK_OPS,
  ledgerRow: {
    columns: A.LEDGER_COLUMNS,
    createdBy: A.LEDGER_CREATED_BY,
    observed: (old.ledgerRow && old.ledgerRow.observed) || "staging supabase_migrations.schema_migrations, read-only, 2026-09-29 (review of d01b74a, N6): six columns as `columns`; all 31 rows apply_migration wrote hold statements = one element [1:1] with the file's exact bytes, created_by = one value, idempotency_key and rollback null; list_migrations lists every row by (version, name)",
  },
};
const all = A.assembleAll(M, { cwd: ROOT });
M.outputs = Object.fromEntries(Object.entries(all).map(([k, v]) => [k, { md5: A.md5(v), bytes: Buffer.byteLength(v) }]));
const probe = A.sizeProbe(Buffer.byteLength(all.P1));
M.sizeProbe = { ...old.sizeProbe, expect: { probe_bytes: Buffer.byteLength(probe.literal), probe_md5: A.md5(probe.literal) }, exceedsP1By: Buffer.byteLength(all["SIZE-PROBE"]) - Buffer.byteLength(all.P1) };

const index = txt("write-tree");
const A3_TREES = ["netlify", "src", "public"];
const A3_BLOBS = [
  "netlify.toml", "package.json", ".npmrc", ".nvmrc", ".env", "vite.config.js", "postcss.config.js", "tailwind.config.js",
  "index.html", "upload.html", "scripts/check-build-env.mjs", "scripts/write-deploy-context.mjs", "scripts/inject-sw-manifest.mjs",
  "scripts/tests/inventory-check.mjs", "scripts/tests/inventory-allowlist.mjs",
];
for (const p of [...A3_TREES, ...A3_BLOBS]) if (!existsSync(join(ROOT, p))) throw new Error(`A3 input ${p} is missing`);
const a3trees = Object.fromEntries(A3_TREES.map((p) => [p, txt("rev-parse", `${index}:${p}`)]));
const a3blobs = Object.fromEntries(A3_BLOBS.map((p) => [p, txt("rev-parse", `${index}:${p}`)]));
const a3Changed = JSON.stringify([a3trees, a3blobs]) !== JSON.stringify([old.a3.trees, old.a3.blobs]);
M.a3 = { ...old.a3, commit: a3Changed ? "manifest-commit" : old.a3.commit, trees: a3trees, blobs: a3blobs };
for (const k of ["rollbackTargets", "p6", "deploys", "send"]) if (k in old) M[k] = old[k];

const text = JSON.stringify(M, null, 2) + "\n";
if (process.argv.includes("--check")) {
  const cur = readFileSync(join(ROOT, MANIFEST_PATH), "utf8").replace(/\r\n/g, "\n");
  if (cur !== text) { process.stderr.write("the manifest would change\n"); process.exit(1); }
  process.stdout.write("the manifest is current\n");
} else {
  writeFileSync(join(ROOT, MANIFEST_PATH), text);
  process.stdout.write(`wrote ${MANIFEST_PATH}${a3Changed ? " (A3 re-pinned to manifest-commit)" : ""}\n`);
}
