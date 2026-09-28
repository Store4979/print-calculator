// scripts/tests/release2-inventory.rollback.test.js — INV-6 in the ROLLED-BACK
// state (review of 8913a69, B3; docs/security/release-2-stage-0-production-plan.md
// §E6). Walks the repository through the moves stage 0 would make:
//
//   apply     the five release2 files and their .rollback.sql companions move
//             from pending/ to supabase/migrations/<version>_… (P2)
//   rollback  each applied rollback's bytes are committed as
//             supabase/migrations/<rb version>_<name>_rollback.sql (F4)
//   snapshot  tables.json recaptured at the rollback's ledger version
//   inventory the composed gate runs on that tree
//
// No history is deleted: the forward files stay applied. The post-rollback
// snapshot is the COMMITTED production capture with only ledgerVersion and the
// provenance fields advanced — the fields a real capture changes. The test
// asserts that its tables/views/buckets are the capture's own, so it cannot
// pass by listing tables a rollback dropped. There is no real post-rollback
// capture, because no rollback has happened. That is why only the fields a
// capture changes are advanced.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, cpSync, writeFileSync, rmSync, readFileSync, renameSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runInventory, compareToAllowlist, readTablesSnapshot, appliedReleaseState } from "./inventory-check.mjs";
import { ALLOWLIST, RETIRED_EVER } from "./inventory-allowlist.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const NAMES = [
  "release2_01_identity_schema",
  "release2_02_auth_attempts_fn",
  "release2_03_bind_and_atomicity",
  "release2_04_staff_session_qualify_columns",
  "release2_05_revoke_enrollment",
];
const FWD = (i) => `2026100112000${i + 1}`;          // forward versions, 01..05
const RB_ORDER = [4, 3, 2, 1, 0];                    // RB-5, RB-43 (04 then 03), RB-2, RB-1
const RBV = (k) => `2026100113000${k + 1}`;          // rollback versions, in apply order
const SIX = ["device_enrollments", "enrollment_tickets", "staff_sessions", "upload_capabilities", "upload_capability_files", "auth_attempts"];
const CAPTURE = JSON.parse(readFileSync(join(ROOT, "supabase", "tables.json"), "utf8"));

function tree() {
  const root = mkdtempSync(join(tmpdir(), "inv-rb-"));
  for (const d of ["src", "netlify", "supabase"]) cpSync(join(ROOT, d), join(root, d), { recursive: true });
  return root;
}
const MIG = (root) => join(root, "supabase", "migrations");
const PEND = (root) => join(MIG(root), "pending");

/** P2's repository move: forward files and companions out of pending/. */
function apply(root) {
  NAMES.forEach((n, i) => {
    renameSync(join(PEND(root), `${n}.sql`), join(MIG(root), `${FWD(i)}_${n}.sql`));
    renameSync(join(PEND(root), `${n}.rollback.sql`), join(MIG(root), `${FWD(i)}_${n}.rollback.sql`));
  });
}
/** F4's repository record: each applied rollback's bytes under its own version. */
function rollBack(root, { order = RB_ORDER, version = RBV } = {}) {
  order.forEach((i, k) => {
    const bytes = readFileSync(join(MIG(root), `${FWD(i)}_${NAMES[i]}.rollback.sql`));
    writeFileSync(join(MIG(root), `${version(k)}_${NAMES[i]}_rollback.sql`), bytes);
  });
}
function snapshot(root, ledgerVersion, tables = CAPTURE.tables) {
  writeFileSync(join(root, "supabase", "tables.json"), JSON.stringify({
    ...CAPTURE,
    capturedBy: "release2-inventory.rollback.test.js fixture: the committed production capture, ledgerVersion advanced",
    capturedAt: "2026-10-01T13:00:10Z",
    ledgerVersion,
    tables,
  }, null, 2) + "\n");
}
const snap = (root) => readTablesSnapshot(join(root, "supabase", "tables.json"), { root });
function gate(root) {
  const r = runInventory({ root, retiredEver: RETIRED_EVER });
  return [...r.errors, ...compareToAllowlist(r.sites, ALLOWLIST)];
}
function withTree(fn) {
  const root = tree();
  try { return fn(root); } finally { rmSync(root, { recursive: true, force: true }); }
}

test("RB-INV-1 apply → rollback → snapshot → inventory: the composed gate passes, history intact", () => {
  withTree((root) => {
    apply(root);
    rollBack(root);
    snapshot(root, RBV(4));
    const files = readdirSync(MIG(root));
    for (const [i, n] of NAMES.entries()) {
      assert.ok(files.includes(`${FWD(i)}_${n}.sql`), `forward file ${n} stays applied`);
      assert.ok(files.some((f) => f.endsWith(`_${n}_rollback.sql`)), `rollback of ${n} recorded`);
    }
    const written = JSON.parse(readFileSync(join(root, "supabase", "tables.json"), "utf8"));
    assert.deepEqual(written.tables, CAPTURE.tables, "the post-rollback snapshot's tables are the committed capture's own");
    assert.deepEqual(written.views, CAPTURE.views);
    assert.deepEqual(written.buckets, CAPTURE.buckets);
    for (const t of SIX) assert.ok(!written.tables.includes(t));
    const net = appliedReleaseState(root);
    assert.deepEqual(net.errors, []);
    assert.deepEqual([...net.present], [], "nothing Release 2 is expected after a full rollback");
    assert.deepEqual([...net.dropped.keys()].sort(), [...SIX].sort());
    assert.equal(snap(root).error, undefined);
    assert.deepEqual(gate(root), [], "the composed inventory gate is green in the rolled-back state");
  });
});

test("RB-INV-2 Codex's reproduction: applied, no rollback, the capture not refreshed → fails exactly as reported", () => {
  withTree((root) => {
    apply(root);
    snapshot(root, FWD(4));
    assert.match(snap(root).error, /supabase\/tables\.json lacks "device_enrollments", which an APPLIED release2 migration creates/);
  });
});

test("RB-INV-3 rolled back in the repo but the snapshot still lists the tables → fails", () => {
  withTree((root) => {
    apply(root);
    rollBack(root);
    snapshot(root, RBV(4), [...CAPTURE.tables, ...SIX].sort());
    assert.match(snap(root).error, /contains "\w+", which the applied reviewed rollback \d{14}_release2_\w+_rollback\.sql dropped/);
  });
});

test("RB-INV-4 an UNREVIEWED drop: one byte changed in an applied rollback → fails", () => {
  withTree((root) => {
    apply(root);
    rollBack(root);
    const f = join(MIG(root), `${RBV(4)}_${NAMES[0]}_rollback.sql`);
    writeFileSync(f, readFileSync(f, "utf8").replace("drop table public.auth_attempts;", "drop table public.auth_attempts; "));
    snapshot(root, RBV(4));
    assert.match(snap(root).error, /_release2_01_identity_schema_rollback\.sql drops .* is not byte-identical to any committed release2 \.rollback\.sql companion/);
  });
});

test("RB-INV-5 history deleted: forward 01 removed, its rollback present → fails", () => {
  withTree((root) => {
    apply(root);
    rollBack(root);
    rmSync(join(MIG(root), `${FWD(0)}_${NAMES[0]}.sql`));
    snapshot(root, RBV(4));
    assert.match(snap(root).error, /drops "\w+", which no EARLIER applied migration creates/);
  });
});

test("RB-INV-6 a rollback OLDER than its forward → fails", () => {
  withTree((root) => {
    apply(root);
    rollBack(root, { version: (k) => `2026093000000${k + 1}` });
    snapshot(root, FWD(4));
    assert.match(snap(root).error, /drops "\w+", which no EARLIER applied migration creates/);
  });
});

test("RB-INV-7 a comment that mentions a DROP drops nothing", () => {
  withTree((root) => {
    apply(root);
    writeFileSync(join(MIG(root), `${RBV(0)}_release2_99_note.sql`), "-- drop table public.device_enrollments;\nselect 1;\n");
    snapshot(root, RBV(0));
    assert.match(snap(root).error, /lacks "device_enrollments"/, "the tables are still expected");
  });
});

test("RB-INV-8 controls: the committed tree passes, and applied-without-rollback passes with the tables captured", () => {
  withTree((root) => {
    assert.equal(snap(root).error, undefined, "today's tree and capture");
    apply(root);
    snapshot(root, FWD(4), [...CAPTURE.tables, ...SIX].sort());
    assert.equal(snap(root).error, undefined, "applied state with the six tables present");
  });
});
