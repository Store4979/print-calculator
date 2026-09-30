// scripts/tests/stage0-manifest-check.mjs — THE checks behind
// docs/security/stage0-production-manifest.json, as one function over a
// repository directory (review of d01b74a, N3). stage0-manifest.test.js runs
// it on this repository; stage0-manifest.lifecycle.test.js runs the SAME
// function on a scratch clone walked through every repository state stage 0
// produces: pending, after each apply, fully applied, committed rollback.
//
// Byte checking stays strict in every state. Each pinned input is identified
// by its git blob id, and in every state the file must exist, at the path that
// state puts it, with exactly that blob. What changes between states is only
// WHERE a file must be, and that is derived from the manifest's recorded state
// (migrations[].productionVersion, rollbackRecords), never guessed from the
// directory.
//
// Returns { "M-1": [problems…], … }; an empty array means that check passed.
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import * as A from "../manual/assemble-stage0.mjs";
import * as S from "../manual/stage0-send.mjs";

export const MANIFEST_PATH = "docs/security/stage0-production-manifest.json";
const md5 = (b) => createHash("md5").update(b).digest("hex");

export function gitIn(repo) {
  const out = (...args) => execFileSync("git", args, { cwd: repo, maxBuffer: 1 << 26 });
  const txt = (...args) => out(...args).toString("utf8").trim();
  const tryTxt = (...args) => { try { return txt(...args); } catch { return null; } };
  // One `ls-tree -r -t` per revision, cached: path → object id (blobs and trees).
  const trees = new Map();
  const treeOf = (rev) => {
    if (!trees.has(rev)) {
      const m = new Map();
      const raw = tryTxt("ls-tree", "-r", "-t", "--full-tree", rev) || "";
      for (const line of raw.split("\n")) {
        const t = line.indexOf("\t");
        if (t < 0) continue;
        const [, type, id] = line.slice(0, t).split(" ");
        m.set(line.slice(t + 1), { type, id });
      }
      trees.set(rev, m);
    }
    return trees.get(rev);
  };
  return {
    out, txt, tryTxt,
    hasCommit: (rev) => { try { out("cat-file", "-e", `${rev}^{commit}`); return true; } catch { return false; } },
    shallow: () => txt("rev-parse", "--is-shallow-repository") === "true",
    lastChange: (p) => txt("log", "-1", "--format=%H", "--", p),
    objAt: (rev, p) => treeOf(rev).get(p)?.id ?? null,
    blob: (id) => out("cat-file", "blob", id),
    lsTree: (rev, dir) => [...treeOf(rev)].filter(([p, o]) => o.type === "blob" && p.startsWith(dir + "/")).map(([p]) => p),
  };
}

// ── where each file must be in the recorded state ────────────────────────────
const MIG = "supabase/migrations";
export const forwardPath = (m) => (m.productionVersion ? `${MIG}/${m.productionVersion}_${m.name}.sql` : m.pendingPath);
export const companionPath = (m, r) => (m.productionVersion ? `${MIG}/${m.productionVersion}_${m.name}.rollback.sql` : r.pendingPath);
export const recordPath = (m, rec) => `${MIG}/${rec.version}_${m.name}_rollback.sql`;

/** Every pinned file with the path the recorded state puts it at. */
export function pinnedFiles(M) {
  const files = [];
  for (const m of M.migrations) files.push({ label: m.name, entry: m, path: forwardPath(m), frozenPath: m.pendingPath });
  for (const r of M.rollbacks) {
    const m = M.migrations.find((x) => x.n === r.n);
    files.push({ label: `${m.name}.rollback.sql`, entry: r, path: companionPath(m, r), frozenPath: r.pendingPath });
  }
  for (const rec of M.rollbackRecords) {
    const m = M.migrations.find((x) => x.n === rec.n);
    const r = M.rollbacks.find((x) => x.n === rec.n);
    files.push({ label: `applied rollback ${m.name} @${rec.version}`, entry: { ...r, pinnedAt: null }, path: recordPath(m, rec), frozenPath: null });
  }
  files.push({ label: "proofs", entry: M.proofs, path: M.proofs.path, frozenPath: M.proofs.path });
  files.push({ label: "assembler", entry: M.assembler, path: M.assembler.path, frozenPath: M.assembler.path });
  if (M.sender) files.push({ label: "sender", entry: M.sender, path: M.sender.path, frozenPath: M.sender.path });
  return files;
}

export function checkManifest(repo, M) {
  const g = gitIn(repo);
  const P = { "M-0": [], "M-1": [], "M-2": [], "M-3": [], "M-4": [], "M-5": [], "M-6": [], "M-6b": [], "M-7": [], "M-7b": [], "M-8": [], "M-10": [], "M-12": [] };
  const say = (k, s) => P[k].push(s);
  if (g.tryTxt("rev-parse", "--is-inside-work-tree") !== "true") { say("M-0", `${repo} is not a git checkout`); return P; }
  const manifestCommit = g.lastChange(MANIFEST_PATH);
  if (!manifestCommit) say("M-0", `${MANIFEST_PATH} has no commit`);
  const resolve = (pin) => (pin === "manifest-commit" ? manifestCommit : pin);
  const files = pinnedFiles(M);

  // M-1 the blob at the state's path, at HEAD: id, md5, bytes, no CR.
  for (const f of files) {
    const id = g.objAt("HEAD", f.path);
    if (id !== f.entry.blob) { say("M-1", `${f.label}: HEAD:${f.path} is ${id ?? "absent"}, pinned ${f.entry.blob}`); continue; }
    const b = g.blob(id);
    if (md5(b) !== f.entry.md5) say("M-1", `${f.label}: md5 ${md5(b)} != ${f.entry.md5}`);
    if (b.length !== f.entry.bytes) say("M-1", `${f.label}: ${b.length} bytes != ${f.entry.bytes}`);
    if (b.includes(0x0d)) say("M-1", `${f.label}: the blob holds a CR`);
  }

  // M-2 no uncommitted edit (line endings aside).
  for (const f of files) {
    const p = join(repo, f.path);
    if (!existsSync(p)) { say("M-2", `${f.label}: ${f.path} is missing from the working tree`); continue; }
    const wt = Buffer.from(readFileSync(p).toString("utf8").replace(/\r\n/g, "\n"), "utf8");
    if (md5(wt) !== f.entry.md5) say("M-2", `${f.label}: the working tree differs from the pinned bytes beyond line endings`);
  }

  // M-3 each pin resolves: a SHA holds the blob at its frozen path; "manifest-commit"
  // (a file changed in the same commit as the manifest, which cannot name its
  // own SHA) resolves to the commit that last changed the manifest, which must
  // hold the blob at the state's path. A record-only manifest update keeps
  // that true, because it changes the manifest and not the file.
  for (const f of files) {
    const pin = f.entry.pinnedAt;
    if (pin === null) continue; // an applied rollback record: its bytes are the companion's (M-1)
    if (pin !== "manifest-commit" && !/^[0-9a-f]{40}$/.test(pin)) { say("M-3", `${f.label}: pinnedAt ${JSON.stringify(pin)} is neither a full SHA nor "manifest-commit"`); continue; }
    const commit = resolve(pin);
    const at = pin === "manifest-commit" ? f.path : f.frozenPath;
    if (!g.hasCommit(commit)) { if (!g.shallow()) say("M-3", `${f.label}: commit ${commit} is missing and the clone is not shallow`); continue; }
    const id = g.objAt(commit, at);
    if (id !== f.entry.blob) say("M-3", `${f.label}: ${commit.slice(0, 7)}:${at} is ${id ?? "absent"}, pinned ${f.entry.blob}`);
  }

  // M-4 md5(prosrc) re-derived from the committed forward and rollback bodies, by blob.
  const BODY = /create\s+(?:or\s+replace\s+)?function\s+public\.(\w+)\s*\([\s\S]*?\bas\s+\$fn\$([\s\S]*?)\$fn\$/gi;
  for (const { file, functions } of M.bodies) {
    const rb = file.endsWith("rb");
    const e = (rb ? M.rollbacks : M.migrations).find((x) => x.n === file.slice(0, 2));
    let text;
    try { text = g.blob(e.blob).toString("utf8"); } catch { say("M-4", `${file}: blob ${e.blob} unreadable`); continue; }
    const got = {};
    for (const m of text.matchAll(BODY)) got[m[1]] = createHash("md5").update(m[2], "utf8").digest("hex");
    if (JSON.stringify(Object.entries(got).sort()) !== JSON.stringify(Object.entries(functions).sort())) say("M-4", `${file}: bodies ${JSON.stringify(got)} != ${JSON.stringify(functions)}`);
  }
  const produced = new Set(M.bodies.flatMap((b) => Object.values(b.functions)));
  for (const [k, f] of Object.entries(M.functions)) if (!produced.has(f.prosrcMd5)) say("M-4", `${k}: ${f.prosrcMd5} is derived from no committed body`);

  // M-5 the assembler's constants are the manifest's.
  const same = (a, b, what) => { if (JSON.stringify(a) !== JSON.stringify(b)) say("M-5", `${what} differ`); };
  same(A.MIGRATIONS.map((x) => [x.n, x.name, x.md5, x.bytes]), M.migrations.map((x) => [x.n, x.name, x.md5, x.bytes]), "migrations");
  same(Object.fromEntries(Object.entries(A.FUNCTIONS).map(([k, [s, h, acl]]) => [k, { signature: s, prosrcMd5: h, execute: acl.split(",") }])), M.functions, "functions");
  same(A.STATE_AFTER, M.stateAfter, "stateAfter");
  same(A.TABLES, M.tables.names, "tables");
  same(A.ROLLBACK_OPS, M.rollbackOperations, "rollbackOperations");
  same([A.PRODUCTION_REF, A.STAGING_SEED_STORE, A.PROBE_SLUG], [M.productionRef, M.identity.stagingSeedStore, M.identity.probeSlug], "identity markers");
  for (const m of M.migrations) if (m.pendingPath !== A.migrationPath(m)) say("M-5", `${m.name}: frozen path ${m.pendingPath}`);
  same([A.LEDGER_COLUMNS, A.LEDGER_CREATED_BY], [M.ledgerRow?.columns, M.ledgerRow?.createdBy], "the ledger row shape (N6)");

  // M-12 the send policy (review of 07574c1, decision A): pinned texts reach a
  // database only through scripts/manual/stage0-send.mjs, which sends a text
  // only where this policy allows. Every assembled output has exactly one
  // entry; the policy's shape is fixed here, so widening it is a test failure.
  const SP = M.send || {};
  if (!M.sender || M.sender.path !== S.SENDER_PATH) say("M-12", "the manifest does not pin the sender at " + S.SENDER_PATH);
  if (SP.endpoint !== S.API_BASE + S.ENDPOINT || SP.endpoint !== "https://api.supabase.com/v1/projects/{ref}/database/query") say("M-12", "the endpoint is not the Management API database/query endpoint the sender posts to");
  if (JSON.stringify(SP.targets) !== JSON.stringify({ production: A.PRODUCTION_REF, staging: A.STAGING_REF })) say("M-12", "the targets are not exactly production and staging, by ref");
  const texts = SP.texts || {};
  const outs = Object.keys(M.outputs || {});
  for (const k of outs) if (!texts[k]) say("M-12", `${k} has no send-policy entry`);
  for (const k of Object.keys(texts)) if (!outs.includes(k)) say("M-12", `the send policy names ${k}, which is not an output`);
  const READ_ONLY = ["P0", "STATE", "SIZE-PROBE"];
  for (const [k, e] of Object.entries(texts)) {
    const want = k.startsWith("LOCKPROBE-") ? ["staging"] : k === "SIZE-PROBE" ? null : ["production"];
    if (want && JSON.stringify(e.targets) !== JSON.stringify(want)) say("M-12", `${k} must go to ${want.join(", ")} only; the policy says ${JSON.stringify(e.targets)}`);
    if (k === "SIZE-PROBE" && (!Array.isArray(e.targets) || !e.targets.includes("staging") || e.targets.some((t) => !["staging", "production"].includes(t)))) say("M-12", "SIZE-PROBE must include staging and name no other target than production");
    if ((e.readOnly === true) !== READ_ONLY.includes(k)) say("M-12", `${k}: readOnly must be ${READ_ONLY.includes(k)}`);
    if ((e.instantiate === "cancel") !== (k === "CANCEL-STEP-TEMPLATE") || (e.instantiate !== undefined && e.instantiate !== "cancel")) say("M-12", `${k}: only CANCEL-STEP-TEMPLATE is instantiated, and only by --cancel`);
    const extra = Object.keys(e).filter((x) => !["targets", "readOnly", "instantiate"].includes(x));
    if (extra.length) say("M-12", `${k}: unknown policy fields ${extra.join(", ")}`);
  }

  // M-6 every output re-assembled from the frozen inputs has its pinned md5.
  let out = null;
  try { out = A.assembleAll(M, { cwd: repo }); } catch (e) { say("M-6", `assembly failed: ${e.message}`); }
  if (out) {
    const keys = Object.keys(out).sort();
    if (JSON.stringify(keys) !== JSON.stringify(Object.keys(M.outputs).sort())) say("M-6", `outputs ${keys} != pinned ${Object.keys(M.outputs).sort()}`);
    for (const [k, v] of Object.entries(out)) {
      if (!M.outputs[k]) continue;
      if (A.md5(v) !== M.outputs[k].md5) say("M-6", `${k}: md5 ${A.md5(v)} != ${M.outputs[k].md5}`);
      if (Buffer.byteLength(v) !== M.outputs[k].bytes) say("M-6", `${k}: bytes`);
    }
    // The P2 steps (N7: 03 and 04 are ONE step, P2-0304). Each embeds every
    // file of its step verbatim, gates each on md5/bytes before any EXECUTE,
    // and writes one ledger row per file from the checked literal.
    if (JSON.stringify(A.P2_STEPS.map((x) => x.step)) !== JSON.stringify(["P2-01", "P2-02", "P2-0304", "P2-05"])) say("M-6", "the P2 steps are not P2-01, P2-02, P2-0304, P2-05");
    for (const k of ["P2-03", "P2-04"]) if (out[k] !== undefined) say("M-6", `${k} exists: 03 must never be applied on its own (N7)`);
    for (const stp of A.P2_STEPS) {
      const w = out[stp.step] || "";
      const multi = stp.files.length > 1;
      stp.files.forEach((n, i) => {
        const m = M.migrations.find((x) => x.n === n);
        const v = multi ? `f${i + 1}` : "f";
        if (!w.includes(`$stage0_file$${g.blob(m.blob).toString("utf8")}$stage0_file$`)) say("M-6", `${stp.step} does not embed ${m.name}'s pinned blob verbatim`);
        if (!w.includes(`if md5(${v}) <> '${m.md5}' or octet_length(${v}) <> ${m.bytes} then`)) say("M-6", `${stp.step} lacks ${m.name}'s md5/bytes gate before EXECUTE`);
        if (!w.includes(`values (v_version, '${m.name}', array[${v}], '${M.ledgerRow.createdBy}');`)) say("M-6", `${stp.step} does not write ${m.name}'s statements[1] from the checked literal with apply_migration's created_by`);
      });
      if (multi) {
        const gates = stp.files.map((_, i) => w.indexOf(`if md5(f${i + 1}) <>`));
        const firstExec = w.indexOf("execute f1;");
        if (gates.some((x) => x < 0 || x > firstExec)) say("M-6", `${stp.step} does not check every file before executing any`);
        if (!(w.indexOf("execute f1;") < w.indexOf("execute f2;"))) say("M-6", `${stp.step} does not execute 03 before 04`);
      }
      if (!w.includes("the ledger row does not have apply_migration''s shape")) say("M-6", `${stp.step} does not assert its ledger rows' shape`);
    }
    // STATE is read-only and names exactly the reviewed recovery sequences.
    const stt = (out.STATE || "").replace(/--[^\n]*/g, " ");
    if (/\b(insert|update|delete|create|alter|drop|truncate|begin|commit|grant|revoke|lock)\b/i.test(stt.replace(/'[^']*'/g, "''"))) say("M-6", "STATE is not read-only");
    for (const r of A.RECOVERY) if (r.ops.length && !stt.includes(`'${r.ops.join(", ")}'`)) say("M-6", `STATE does not name the recovery ${r.ops.join(", ")}`);
    // The second-caller cancel procedure (plan §E8): INSPECT only reads; the
    // STEP template cancels (never terminates) ONE backend matched by exact
    // application_name AND backend_start, never the caller, refusing 0 or >1
    // matches before it signals.
    const ins = (out["CANCEL-INSPECT"] || "").replace(/--[^\n]*/g, " ").replace(/'[^']*'/g, "''");
    if (!ins.trim() || /\b(insert|update|delete|create|alter|drop|truncate|begin|commit|grant|revoke|do|lock)\b|pg_cancel_backend|pg_terminate_backend/i.test(ins)) say("M-6", "CANCEL-INSPECT is not read-only");
    const cs = (out["CANCEL-STEP-TEMPLATE"] || "").replace(/--[^\n]*/g, " ");
    if ((cs.match(/pg_cancel_backend\(/g) || []).length !== 1 || /pg_terminate_backend/.test(cs)) say("M-6", "CANCEL-STEP must call pg_cancel_backend exactly once and never pg_terminate_backend");
    for (const [what, re] of [
      ["matches the exact application_name", /where a\.application_name = v_app\s/],
      ["matches the exact backend_start", /backend_start at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS\.US"Z"'\) = v_start\s/],
      ["excludes the caller", /and a\.pid <> pg_backend_pid\(\);/],
      ["refuses zero matches", /if v_n = 0 then\s+raise exception/],
      ["refuses more than one match", /if v_n > 1 then\s+raise exception/],
      ["accepts only the stage-0 step names", new RegExp(`if v_app not in \\(${A.CANCEL_TARGETS.map((x) => `'${x}'`).join(", ")}\\) then\\s+raise exception`)],
    ]) if (!re.test(cs)) say("M-6", `CANCEL-STEP ${what}`);
    const sig = cs.indexOf("pg_cancel_backend(");
    if (!(cs.indexOf("if v_n = 0") < sig && cs.indexOf("if v_n > 1") < sig)) say("M-6", "CANCEL-STEP signals before its refusals");
    const stepNames = ["P1", ...A.P2_STEPS.map((x) => x.step), ...A.ROLLBACK_OPS.map((x) => x.op)];
    for (const n of stepNames) if (!(out[n] || "").includes(`set_config('application_name', 'release2-stage0-${n}', true)`)) say("M-6", `${n} does not run under the application_name CANCEL-STEP targets`);
    if (!/^begin isolation level repeatable read;$/m.test(out.P1 || "") || !/\nrollback;\n$/.test(out.P1 || "") || /^commit;$/m.test(out.P1 || "")) say("M-6", "P1 must begin repeatable read, end in ROLLBACK and never commit");
    // M-6c the staging lock rehearsal (N5) cannot touch anything but its own schema.
    const lp = Object.entries(out).filter(([k]) => k.startsWith("LOCKPROBE-"));
    if (lp.length !== 10) say("M-6", `expected 10 LOCKPROBE texts, found ${lp.length}`);
    for (const [k, v] of lp) {
      if (!/STAGING ONLY/.test(v)) say("M-6", `${k} is not marked STAGING ONLY`);
      const ddl = [...v.replace(/--[^\n]*/g, " ").matchAll(/\b(create|alter|drop|truncate|insert\s+into|update|delete\s+from|lock\s+table)\s+(?:table\s+|schema\s+|constraint\s+)?([a-z_][a-z0-9_.]*)/gi)]
        .map((x) => x[2].toLowerCase()).filter((t) => !t.startsWith("stage0_lockprobe") && !["if", "exception", "pg_temp"].includes(t));
      if (ddl.length) say("M-6", `${k} writes outside stage0_lockprobe: ${[...new Set(ddl)].join(", ")}`);
      if (/^B-/.test(k.slice(10)) && !v.includes("the staging seed store is absent")) say("M-6", `${k} lacks the staging-only guard`);
      if (/'b7a8e54c99432c5e0ddb60be4c46505f'\) then\s+raise exception '[^']*production's ledger rows/.test(v)) say("M-6", `${k} carries the production identity guard`);
    }
    // M-6b SIZE-PROBE: one read-only SELECT, larger than P1, with its pinned answer.
    const probe = out["SIZE-PROBE"] || "";
    if (!(Buffer.byteLength(probe) > Buffer.byteLength(out.P1)) || Buffer.byteLength(probe) - Buffer.byteLength(out.P1) !== M.sizeProbe.exceedsP1By) say("M-6b", "SIZE-PROBE size");
    if (!probe.startsWith(A.SIZE_PROBE_HEAD) || !probe.endsWith(A.SIZE_PROBE_TAIL)) say("M-6b", "SIZE-PROBE shape");
    else {
      const literal = probe.slice(A.SIZE_PROBE_HEAD.length, probe.length - A.SIZE_PROBE_TAIL.length);
      if (!A.SIZE_PROBE_LINE.repeat(Math.ceil(literal.length / A.SIZE_PROBE_LINE.length)).startsWith(literal) || literal.includes("$probe$")) say("M-6b", "SIZE-PROBE literal is not filler only");
      const outside = (A.SIZE_PROBE_HEAD + A.SIZE_PROBE_TAIL).replace(/^--.*$/gm, "");
      if ((outside.match(/;/g) || []).length !== 1 || /\b(insert|update|delete|create|drop|alter|grant|revoke|truncate|begin|commit|call|do)\b/i.test(outside)) say("M-6b", "SIZE-PROBE is not one read-only statement");
      if (JSON.stringify({ probe_bytes: Buffer.byteLength(literal), probe_md5: A.md5(literal) }) !== JSON.stringify(M.sizeProbe.expect)) say("M-6b", "SIZE-PROBE expected answer");
    }
  }

  // M-7 A3: the pinned commit (or the manifest's own commit) holds the pinned
  // trees and blobs; so does HEAD while enforced.
  const revs = [resolve(M.a3.commit)];
  if (M.a3.enforceAtHead) revs.push("HEAD");
  for (const rev of revs) {
    if (rev !== "HEAD" && !g.hasCommit(rev)) { if (!g.shallow()) say("M-7", `A3 commit ${rev} is missing and the clone is not shallow`); continue; }
    for (const [p, id] of [...Object.entries(M.a3.trees), ...Object.entries(M.a3.blobs)]) {
      const got = g.objAt(rev, p);
      if (got !== id) say("M-7", `A3 drift at ${rev === "HEAD" ? "HEAD" : rev.slice(0, 7)}: ${p} is ${got}, pinned ${id} — re-pin in the manifest (a reviewed change) or revert`);
    }
  }
  // M-7b the build-input binding: every script the build command runs is pinned,
  // and the tracked .env holds exactly the two public values.
  const toml = g.tryTxt("show", "HEAD:netlify.toml") || "";
  const cmd = (/^\s*command\s*=\s*"([^"]*)"/m.exec(toml) || [])[1] || "";
  const ran = [...cmd.matchAll(/node\s+(\S+\.m?js)/g)].map((x) => x[1]);
  if (!ran.length) say("M-7b", "no build command scripts found in netlify.toml");
  for (const s of ran) if (!(s in M.a3.blobs)) say("M-7b", `the build runs ${s}, which A3 does not pin`);
  for (const p of ["netlify.toml", "package.json", ".npmrc", ".nvmrc", ".env", "vite.config.js", "postcss.config.js", "tailwind.config.js", "index.html", "upload.html"]) {
    if (!(p in M.a3.blobs)) say("M-7b", `build input ${p} is not pinned`);
  }
  for (const t of ["netlify", "src", "public"]) if (!(t in M.a3.trees)) say("M-7b", `tree ${t} is not pinned`);
  const env = (g.tryTxt("show", "HEAD:.env") || "").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  const keys = env.map((l) => l.split("=")[0]);
  if (JSON.stringify(keys) !== JSON.stringify(["VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY"])) say("M-7b", `.env keys ${JSON.stringify(keys)}: only VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY may be tracked`);
  const val = (k) => (env.find((l) => l.startsWith(k + "=")) || "").slice(k.length + 1);
  if (val("VITE_SUPABASE_URL") !== `https://${M.productionRef}.supabase.co`) say("M-7b", ".env URL is not the production project");
  if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(val("VITE_SUPABASE_ANON_KEY"))) say("M-7b", ".env key is not a publishable key");

  // M-10 fresh-build rollback targets (review of d01b74a, N4): every approved
  // target carries the queue fix (the orderQueue.js blob 9937728 shipped), so a
  // recovery never reinstates the drain that lost orders queued during its
  // awaits. Commits that predate the fix stay retained URLs only.
  const RT = M.rollbackTargets;
  if (!RT || !RT.requiredBlob || !Array.isArray(RT.approved) || !RT.approved.length) {
    P["M-10"] = ["the manifest has no rollbackTargets with a requiredBlob and an approved list"];
  } else {
    const k = "M-10";
    P[k] = [];
    const req = RT.requiredBlob;
    for (const t of RT.approved) {
      const commit = t.commit === "a3" ? resolve(M.a3.commit) : t.commit;
      if (!g.hasCommit(commit)) { if (!g.shallow()) P[k].push(`approved target ${t.commit} is missing and the clone is not shallow`); continue; }
      const got = g.objAt(commit, req.path);
      if (got !== req.blob) P[k].push(`approved target ${t.commit} (${t.role}) has ${req.path} ${got}, not the fixed ${req.blob}`);
    }
    for (const r of RT.retainedNotRebuildable || []) {
      if (RT.approved.some((t) => t.commit === r.commit)) P[k].push(`${r.commit} is both approved and retained-only`);
      if (g.hasCommit(r.commit) && g.objAt(r.commit, req.path) === req.blob) P[k].push(`${r.commit} carries the fix; it needs no retained-only listing`);
    }
  }

  // M-8 the repository state the manifest records.
  const L = M.baselineLedger || [];
  if (L.length !== M.ledgerBaseline.rows || L.length !== 20) say("M-8", `baseline ledger has ${L.length} rows; the manifest says ${M.ledgerBaseline.rows}`);
  if (L.length && L[L.length - 1].version !== M.ledgerBaseline.head) say("M-8", "baseline head");
  const mk = L.find((r) => r.version === M.ledgerBaseline.marker.version);
  if (!mk || mk.name !== M.ledgerBaseline.marker.name || mk.md5 !== M.ledgerBaseline.marker.md5) say("M-8", "the production ledger marker is not in the baseline");
  for (const r of L) {
    const p = `${MIG}/${r.version}_${r.name}.sql`;
    if (g.objAt("HEAD", p) !== r.blob) say("M-8", `baseline ${p} is not the pinned blob at HEAD`);
  }
  // forwards apply in order, each after the one before and after the baseline
  let prev = M.ledgerBaseline.head, gap = false;
  for (const m of M.migrations) {
    if (!m.productionVersion) { gap = true; continue; }
    if (gap) say("M-8", `${m.name} is recorded applied after an unapplied predecessor`);
    if (!/^\d{14}$/.test(m.productionVersion) || !(m.productionVersion > prev)) say("M-8", `${m.name}: version ${m.productionVersion} is not after ${prev}`);
    prev = m.productionVersion;
  }
  // N7: 03 and 04 are one transaction — recorded applied together, rolled back together.
  const pv = (n) => M.migrations.find((x) => x.n === n).productionVersion;
  if (Boolean(pv("03")) !== Boolean(pv("04"))) say("M-8", "03 and 04 are recorded in different states; P2-0304 applies them in one transaction");
  const rec = (n) => M.rollbackRecords.some((r) => r.n === n);
  if (rec("03") !== rec("04")) say("M-8", "03 and 04 have different rollback records; RB-43 rolls them back in one transaction");
  // rollback records follow the RB order over what was applied, each after the last forward
  const applied = M.migrations.filter((m) => m.productionVersion).map((m) => m.n);
  const rbOrder = M.rollbackOperations.flatMap((o) => o.files).filter((n) => applied.includes(n));
  M.rollbackRecords.forEach((rec, i) => {
    if (rec.n !== rbOrder[i]) say("M-8", `rollback record ${i + 1} is ${rec.n}; the RB order over the applied set expects ${rbOrder[i]}`);
    if (!/^\d{14}$/.test(rec.version) || !(rec.version > prev)) say("M-8", `rollback record ${rec.n}: version ${rec.version} is not after ${prev}`);
    prev = rec.version;
  });
  // exactly the top-level migration files this state implies — no more, no fewer
  const top = g.lsTree("HEAD", MIG).filter((p) => !p.includes("/pending/") && /^supabase\/migrations\/\d{14}_.*\.sql$/.test(p) && !/\.rollback\.sql$/.test(p));
  const expect = new Set([
    ...L.map((r) => `${MIG}/${r.version}_${r.name}.sql`),
    ...M.migrations.filter((m) => m.productionVersion).map((m) => forwardPath(m)),
    ...M.rollbackRecords.map((rec) => recordPath(M.migrations.find((x) => x.n === rec.n), rec)),
  ]);
  for (const p of top) if (!expect.has(p)) say("M-8", `unexpected applied migration file ${p}`);
  for (const p of expect) if (!top.includes(p)) say("M-8", `missing applied migration file ${p}`);
  // every release2 file sits exactly where the state puts it
  const r2 = g.lsTree("HEAD", MIG).filter((p) => /release2_0[1-5]_/.test(p));
  const expectR2 = new Set(files.filter((f) => /release2_0[1-5]_/.test(f.path)).map((f) => f.path));
  for (const p of r2) if (!expectR2.has(p)) say("M-8", `release2 file ${p} is not where the recorded state puts it`);
  for (const p of expectR2) if (!r2.includes(p)) say("M-8", `release2 file ${p} is missing`);
  return P;
}
