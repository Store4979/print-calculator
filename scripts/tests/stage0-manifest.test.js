// scripts/tests/stage0-manifest.test.js — docs/security/stage0-production-manifest.json
// is the authority for what stage 0 applies to production (plan §A7, required
// by the reviewer's F5 ruling 1). This test holds it to the repository:
//
//   M-1 every pinned file's GIT BLOB bytes: blob id, md5, byte count. Read with
//       `git show HEAD:<path>`, never from the working tree — a Windows checkout
//       (core.autocrlf=true) holds CRLF copies whose md5 is not the blob's.
//   M-2 the working-tree copy of each pinned file differs from its HEAD blob by
//       line endings at most (an uncommitted edit fails here, not at P2).
//   M-3 each file's pinnedAt commit resolves the pinned blob. Absent commits
//       are tolerated only in a shallow clone, which is detected. The marker
//       "manifest-commit" (a file changed in the same commit as the manifest,
//       which cannot name its own SHA) is checked, not trusted: the file's
//       last change must BE the manifest's last change.
//   M-4 every md5(prosrc) re-derived from the `$fn$` bodies of the committed
//       forward AND rollback files, file by file (A1a, A2, A6).
//   M-5 the assembler's constants are the manifest's.
//   M-6 every assembled output re-assembled from HEAD and re-hashed.
//   M-7 A3: the pinned commit resolves the pinned trees and blobs; while
//       enforceAtHead is true, HEAD resolves them too.
//   M-8 the manifest's own shape: 20 ledger rows at the baseline, four
//       rollback operations covering the five companions once each.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as A from "../manual/assemble-stage0.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const M = JSON.parse(readFileSync(join(ROOT, "docs", "security", "stage0-production-manifest.json"), "utf8"));
const gitOut = (...args) => execFileSync("git", args, { cwd: ROOT, maxBuffer: 1 << 26 });
const git = (...args) => gitOut(...args).toString("utf8").trim();
const blobBytes = (rev, p) => gitOut("show", `${rev}:${p}`);
const md5 = (b) => createHash("md5").update(b).digest("hex");
const hasObject = (rev) => { try { gitOut("cat-file", "-e", `${rev}^{commit}`); return true; } catch { return false; } };
const shallow = () => git("rev-parse", "--is-shallow-repository") === "true";

const PINNED = [...M.migrations, ...M.rollbacks, M.proofs, M.assembler];

test("M-0 this is a git checkout (the manifest is checked against git objects, not files)", () => {
  assert.equal(git("rev-parse", "--is-inside-work-tree"), "true");
});

test("M-1 every pinned file's git blob: id, md5, bytes", () => {
  for (const f of PINNED) {
    assert.equal(git("rev-parse", `HEAD:${f.path}`), f.blob, `${f.path}: blob id`);
    const b = blobBytes("HEAD", f.path);
    assert.equal(md5(b), f.md5, `${f.path}: md5 of the git blob`);
    assert.equal(b.length, f.bytes, `${f.path}: byte count`);
    assert.ok(!b.includes(0x0d), `${f.path}: the blob holds no CR`);
  }
});

test("M-2 no pinned file has an uncommitted edit (line endings aside)", () => {
  for (const f of PINNED) {
    const wt = readFileSync(join(ROOT, f.path)).toString("utf8").replace(/\r\n/g, "\n");
    assert.equal(md5(Buffer.from(wt, "utf8")), f.md5, `${f.path}: the working tree differs from HEAD beyond line endings`);
  }
});

test("M-3 each pinnedAt commit resolves the pinned blob", () => {
  const MANIFEST = "docs/security/stage0-production-manifest.json";
  const lastChange = (p) => git("log", "-1", "--format=%H", "--", p);
  for (const f of PINNED) {
    if (f.pinnedAt === "manifest-commit") {
      assert.equal(lastChange(f.path), lastChange(MANIFEST),
        `${f.path}: marked "manifest-commit" but its last change is not the manifest's last change — re-pin with the real SHA`);
      continue;
    }
    assert.match(f.pinnedAt, /^[0-9a-f]{40}$/, `${f.path}: pinnedAt is a full commit SHA`);
    if (!hasObject(f.pinnedAt)) {
      assert.ok(shallow(), `${f.path}: commit ${f.pinnedAt} is missing and the clone is not shallow`);
      continue;
    }
    assert.equal(git("rev-parse", `${f.pinnedAt}:${f.path}`), f.blob, `${f.path} at ${f.pinnedAt.slice(0, 7)}`);
  }
});

// `create [or replace] function public.<name>(…) … as $fn$<body>$fn$`
const BODY = /create\s+(?:or\s+replace\s+)?function\s+public\.(\w+)\s*\([\s\S]*?\bas\s+\$fn\$([\s\S]*?)\$fn\$/gi;
function bodiesOf(text) {
  const out = {};
  for (const m of text.matchAll(BODY)) {
    assert.ok(!(m[1] in out), `a file defines ${m[1]} twice`);
    out[m[1]] = createHash("md5").update(m[2], "utf8").digest("hex");
  }
  return out;
}

test("M-4 md5(prosrc) re-derived from the committed forward and rollback files", () => {
  const pathOf = (key) => {
    const rb = key.endsWith("rb");
    const n = rb ? key.slice(0, 2) : key;
    return (rb ? M.rollbacks : M.migrations).find((x) => x.n === n).path;
  };
  assert.equal(M.bodies.length, 10, "five forward files and five rollback files");
  for (const { file, functions } of M.bodies) {
    const text = blobBytes("HEAD", pathOf(file)).toString("utf8");
    assert.deepEqual(bodiesOf(text), functions, `${file}: the function bodies it defines`);
  }
  // Every final and intermediate md5 in the function table is produced by some file.
  const produced = new Set(M.bodies.flatMap((b) => Object.values(b.functions)));
  for (const [k, f] of Object.entries(M.functions)) assert.ok(produced.has(f.prosrcMd5), `${k}: ${f.prosrcMd5} is derived from a committed body`);
  // 03's intermediate staff-session body is the one the review named.
  assert.equal(M.functions.css03.prosrcMd5, "bd6da6a2f80e13c7b20deab3b2c76e63");
});

test("M-5 the assembler's constants are the manifest's", () => {
  assert.deepEqual(A.MIGRATIONS.map((x) => ({ n: x.n, name: x.name, md5: x.md5, bytes: x.bytes })),
    M.migrations.map((x) => ({ n: x.n, name: x.name, md5: x.md5, bytes: x.bytes })));
  assert.deepEqual(Object.fromEntries(Object.entries(A.FUNCTIONS).map(([k, [s, h, acl]]) => [k, { signature: s, prosrcMd5: h, execute: acl.split(",") }])),
    M.functions);
  assert.deepEqual(A.STATE_AFTER, M.stateAfter);
  assert.deepEqual(A.TABLES, M.tables.names);
  assert.deepEqual(A.ROLLBACK_OPS, M.rollbackOperations);
  assert.equal(A.PRODUCTION_REF, M.productionRef);
  assert.equal(A.STAGING_SEED_STORE, M.identity.stagingSeedStore);
  assert.equal(A.PROBE_SLUG, M.identity.probeSlug);
});

test("M-6 every assembled output, re-assembled from HEAD, has its pinned md5", () => {
  const out = A.assembleAll("HEAD");
  assert.deepEqual(Object.keys(out).sort(), Object.keys(M.outputs).sort(), "the set of outputs");
  for (const [k, v] of Object.entries(out)) {
    assert.equal(A.md5(v), M.outputs[k].md5, `${k}: md5`);
    assert.equal(Buffer.byteLength(v), M.outputs[k].bytes, `${k}: bytes`);
  }
  // The wrapper embeds each file as the md5-checked literal it writes to the ledger.
  for (const x of M.migrations) {
    const w = out[`P2-${x.n}`];
    assert.ok(w.includes(`$stage0_file$${blobBytes("HEAD", x.path).toString("utf8")}$stage0_file$`), `P2-${x.n} embeds the blob verbatim`);
    assert.match(w, new RegExp(`md5\\(f\\) <> '${x.md5}' or octet_length\\(f\\) <> ${x.bytes}`), `P2-${x.n} checks md5 and bytes before EXECUTE`);
    assert.match(w, /array\[f\]\);/, `P2-${x.n} writes statements[1] from the checked literal`);
    assert.match(w, /set_config\('lock_timeout', '3s', true\)/);
    assert.match(w, /set_config\('statement_timeout', '45s', true\)/);
  }
  assert.match(out.P1, /^begin isolation level repeatable read;$/m);
  assert.match(out.P1, /\nrollback;\n$/, "P1 ends in ROLLBACK");
  assert.doesNotMatch(out.P1, /^commit;$/m, "P1 never commits");
});

test("M-6b SIZE-PROBE: one read-only SELECT, larger than P1, with its pinned answer", () => {
  const out = A.assembleAll("HEAD");
  const probe = out["SIZE-PROBE"];
  assert.ok(Buffer.byteLength(probe) > Buffer.byteLength(out.P1), "the probe is larger than P1");
  assert.equal(Buffer.byteLength(probe) - Buffer.byteLength(out.P1), M.sizeProbe.exceedsP1By);
  // Its whole text is the fixed head, a literal of filler lines, and the fixed tail:
  // nothing but one SELECT over its own literal.
  assert.ok(probe.startsWith(A.SIZE_PROBE_HEAD) && probe.endsWith(A.SIZE_PROBE_TAIL));
  const literal = probe.slice(A.SIZE_PROBE_HEAD.length, probe.length - A.SIZE_PROBE_TAIL.length);
  assert.ok(A.SIZE_PROBE_LINE.repeat(Math.ceil(literal.length / A.SIZE_PROBE_LINE.length)).startsWith(literal),
    "the literal is filler lines only");
  assert.doesNotMatch(literal, /\$probe\$/);
  const outside = (A.SIZE_PROBE_HEAD + A.SIZE_PROBE_TAIL).replace(/^--.*$/gm, "");
  assert.equal((outside.match(/;/g) || []).length, 1, "exactly one statement");
  assert.doesNotMatch(outside, /\b(insert|update|delete|create|drop|alter|grant|revoke|truncate|begin|commit|call|do)\b/i,
    "no write, DDL or transaction control outside the literal");
  assert.deepEqual({ probe_bytes: Buffer.byteLength(literal), probe_md5: A.md5(literal) }, M.sizeProbe.expect,
    "the answer the database must return");
});

test("M-7 A3: the pinned commit resolves the pinned trees and blobs; HEAD too while enforced", () => {
  const revs = [M.a3.commit];
  if (M.a3.enforceAtHead) revs.push("HEAD");
  for (const rev of revs) {
    if (rev !== "HEAD" && !hasObject(rev)) { assert.ok(shallow(), `A3 commit ${rev} is missing and the clone is not shallow`); continue; }
    for (const [p, id] of [...Object.entries(M.a3.trees), ...Object.entries(M.a3.blobs)]) {
      assert.equal(git("rev-parse", `${rev}:${p}`), id,
        `A3 drift at ${rev === "HEAD" ? "HEAD" : rev.slice(0, 7)}: ${p} differs from the pinned object — re-pin in the manifest (a reviewed change) or revert`);
    }
  }
});

test("M-8 the manifest's shape", () => {
  assert.equal(M.ledgerBaseline.rows, 20);
  assert.equal(A.ledgerRows("HEAD").length, 20, "20 top-level migration files at HEAD");
  assert.equal(A.ledgerRows("HEAD").at(-1).version, M.ledgerBaseline.head);
  const marker = A.ledgerRows("HEAD").find((r) => r.version === M.ledgerBaseline.marker.version);
  assert.deepEqual(marker, { version: M.ledgerBaseline.marker.version, name: M.ledgerBaseline.marker.name, md5: M.ledgerBaseline.marker.md5 });
  assert.deepEqual(M.rollbackOperations.flatMap((o) => o.files).sort(), ["01", "02", "03", "04", "05"]);
  assert.deepEqual(M.rollbackOperations.map((o) => o.op), ["RB-5", "RB-43", "RB-2", "RB-1"]);
  assert.ok(M.migrations.every((x) => x.productionVersion === null || /^\d{14}$/.test(x.productionVersion)));
  assert.ok(existsSync(join(ROOT, M.proofs.path)));
});
