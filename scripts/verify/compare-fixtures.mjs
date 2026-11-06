// scripts/verify/compare-fixtures.mjs — the verification driver's fixture comparison. It
// compares what the two local harnesses wrote at the exact commit with that commit's
// fixtures, read as GIT BLOBS: a checkout on Windows is CRLF and the harnesses write LF,
// which is what made the X3b run's first comparison fail on every file.
//
//   node compare-fixtures.mjs --clone <dir> --commit <hash> --writing-out <dir> --x2-out <dir> --report <file>
//
// For each harness:
//   - the run's file set and the commit's are the same;
//   - each index is valid: its listing is exactly the files beside it, each sha256 is those
//     bytes, for the run's and for the commit's; the two indexes may differ only on files
//     that themselves differ;
//   - a file is byte-identical to its blob, or it is a generated reading, named below, whose
//     differences are only the permitted ones.
//
// A generated reading's own digests must reproduce from its rows, on both sides. Its data
// digests may change with every build (now(), random ids), with the md5s derived from them.
//
// ITS LEDGER (Codex DR-1, review of 2d53bed). The commit's manifest names the fixed versions:
// every baselineLedger version and 01's recorded production version. Each keeps its exact
// key and its contents, and its name and md5 are the manifest's. A timestamp may differ only
// on the entries LEDGER_PATHS names for that fixture, the forward and recovery steps the
// harness ran locally. Those keep their identity and contents, in the named order, with
// increasing versions after every fixed one; part 1's count and head follow from them. A
// STATE fixture's versions are exactly its reading's: each n's forward and rollback are the
// versions of that n's entries there, on the same side.
//
// Exit 0 when nothing is out of place; 1 when anything is; 2 when it cannot run. It reads
// git and the two folders, and writes only its report. No store, token, remote or database.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const sha = (b) => createHash("sha256").update(b).digest("hex");
const md5 = (s) => createHash("md5").update(Buffer.from(String(s), "utf8")).digest("hex");
const byBytes = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b));
const MANIFEST = "docs/security/stage0-production-manifest.json";

/** The real-row digests of part 10, and the two md5s derived from them. */
const DATA = Object.freeze(["0|#md5", "10|#md5", "10|digest|auth.users", "10|digest|public.employees", "10|digest|public.memberships", "10|digest|public.organizations", "10|digest|public.stores"]);
const VERSION = /^[0-9]{14}$/;
const LEDGER_ROW = /^row\|/;

const FORWARD_02 = ["02"], FORWARD_04 = ["02", "03", "04"], FORWARD_05 = ["02", "03", "04", "05"];
/**
 * The locally generated ledger entries of each reading, in order: `n` is that migration's
 * forward entry, `nr` its recovery. Every other ledger row in a reading is a fixed one.
 */
export const LEDGER_PATHS = Object.freeze({
  "c-01.json": [],
  "c-P2-02.json": FORWARD_02,
  "c-P2-0304.json": FORWARD_04,
  "c-P2-05.json": FORWARD_05,
  "c-RB-5.json": [...FORWARD_05, "05r"],
  "c-RB-43.json": [...FORWARD_05, "05r", "04r", "03r"],
  "c-RB-2.json": [...FORWARD_05, "05r", "04r", "03r", "02r"],
  "d-RB-2-from-02-01.json": [],
  "d-RB-2-from-02-P2-02.json": FORWARD_02,
  "d-RB-2-from-02-RB-2.json": [...FORWARD_02, "02r"],
  "d-RB-43-from-04-01.json": [],
  "d-RB-43-from-04-P2-02.json": FORWARD_02,
  "d-RB-43-from-04-P2-0304.json": FORWARD_04,
  "d-RB-43-from-04-RB-43.json": [...FORWARD_04, "04r", "03r"],
  "f-anon-exec-auth-uid-02-01.json": [],
  "f-anon-exec-auth-uid-02.json": FORWARD_02,
  "f-anon-exec-other-function-02-01.json": [],
  "f-anon-exec-other-function-02.json": FORWARD_02,
  "f-anon-exec-record-attempt-02-01.json": [],
  "f-anon-exec-record-attempt-02.json": FORWARD_02,
  "f-anon-select-stores-02-01.json": [],
  "f-anon-select-stores-02.json": FORWARD_02,
  "f-authenticated-exec-css-04-01.json": [],
  "f-authenticated-exec-css-04.json": FORWARD_04,
  "f-authenticator-member-service-role-02-01.json": [],
  "f-authenticator-member-service-role-02.json": FORWARD_02,
  "f-membership-inherit-02-01.json": [],
  "f-membership-inherit-02.json": FORWARD_02,
  "g-grant-option.json": [],
  "g-grant-plain.json": [],
  "g-grant-revoked.json": [],
  "g-schema-option.json": [],
  "g-seq-row.json": [],
});
/** Each STATE fixture, and the reading whose ledger it reports. */
export const STATE_READINGS = Object.freeze({
  "c-01-state.json": "c-01.json",
  "c-P2-02-state.json": "c-P2-02.json",
  "c-P2-0304-state.json": "c-P2-0304.json",
  "c-P2-05-state.json": "c-P2-05.json",
  "c-RB-5-state.json": "c-RB-5.json",
  "c-RB-43-state.json": "c-RB-43.json",
  "c-RB-2-state.json": "c-RB-2.json",
  "d-RB-2-from-02-state.json": "d-RB-2-from-02-RB-2.json",
  "d-RB-43-from-04-state.json": "d-RB-43-from-04-RB-43.json",
});
const WRITING_READINGS = Object.freeze({ "w-old-state.json": [], "w-current-state.json": [] });

/** A reading's digests, from its rows: each part's md5 and the whole's. */
export function digestProblems(rows) {
  const problems = [];
  const parts = new Map();
  const md5s = new Map();
  for (const r of rows) {
    if (r === null || typeof r !== "object" || !Number.isInteger(r.part) || typeof r.key !== "string" || typeof r.value !== "string") { problems.push("a row is not { part, key, value }"); continue; }
    if (r.key === "#md5") { md5s.set(r.part, r.value); continue; }
    if (!parts.has(r.part)) parts.set(r.part, []);
    parts.get(r.part).push(r);
  }
  for (let p = 1; p <= 10; p++) {
    const text = (parts.get(p) ?? []).slice().sort((a, b) => byBytes(a.key, b.key)).map((r) => `${r.key}=${r.value}`).join("\n");
    if (md5s.get(p) !== md5(text)) problems.push(`part ${p}'s rows do not reproduce its md5`);
  }
  if (md5s.get(0) !== md5(Array.from({ length: 10 }, (_, i) => `${i + 1}=${md5s.get(i + 1)}`).join("\n"))) problems.push("the parts' md5s do not reproduce the whole's");
  return problems;
}

/** The manifest's fixed ledger rows and the named entries' identities. */
export function ledgerNames(manifest) {
  const one = manifest.migrations.find((m) => m.n === "01");
  if (!one || !VERSION.test(String(one.productionVersion))) throw new Error("the manifest records no production version for 01");
  const fixed = new Map(manifest.baselineLedger.map((r) => [r.version, { name: r.name, md5: r.md5 }]));
  fixed.set(one.productionVersion, { name: one.name, md5: one.md5 });
  const entry = (id) => {
    const n = id.slice(0, 2), m = manifest.migrations.find((x) => x.n === n);
    if (!id.endsWith("r")) return { name: m.name, md5: m.md5 };
    return { name: `${m.name}_rollback`, md5: manifest.rollbacks.find((x) => x.n === n).md5 };
  };
  return { fixed, entry, newestFixed: [...fixed.keys()].sort().at(-1) };
}
const plausible = (v) => {
  const d = new Date(Date.UTC(+v.slice(0, 4), +v.slice(4, 6) - 1, +v.slice(6, 8), +v.slice(8, 10), +v.slice(10, 12), +v.slice(12, 14)));
  return d.toISOString().replace(/[-:T]/g, "").slice(0, 14) === v;
};

/** One side's part 1 against the manifest and the fixture's named path: its generated versions, by id. */
function ledgerOfSide(rows, path, names, say) {
  const facts = new Map(rows.filter((r) => r.part === 1).map((r) => [r.key, r.value]));
  const versions = [...facts.keys()].filter((k) => LEDGER_ROW.test(k)).map((k) => k.slice(4)).sort();
  for (const v of versions) if (!VERSION.test(v) || !plausible(v)) say(`the ledger key row|${v} is not a version`);
  for (const [v, want] of names.fixed) {
    const value = facts.get(`row|${v}`);
    if (value === undefined) { say(`the fixed ledger version ${v} (${want.name}) is not there`); continue; }
    const [name, sum] = value.split("|");
    if (name !== want.name || sum !== want.md5) say(`the fixed ledger row ${v} is ${name}|${sum}, not the manifest's ${want.name}|${want.md5}`);
  }
  const generated = versions.filter((v) => !names.fixed.has(v));
  const haveNames = generated.map((v) => facts.get(`row|${v}`).split("|")[0]);
  const wantNames = path.map((id) => names.entry(id).name);
  if (JSON.stringify(haveNames) !== JSON.stringify(wantNames)) say(`its generated ledger entries are [${haveNames.join(", ")}], not the named [${wantNames.join(", ")}]`);
  const byId = {};
  path.forEach((id, i) => {
    const v = generated[i];
    if (v === undefined) return;
    byId[id] = v;
    if (v <= names.newestFixed) say(`the generated version ${v} is not after every fixed one`);
    const sum = facts.get(`row|${v}`).split("|")[1];
    if (sum !== names.entry(id).md5) say(`the generated row ${v} has md5 ${sum}, not the manifest's ${names.entry(id).md5}`);
  });
  if (facts.get("count") !== String(names.fixed.size + path.length)) say(`its ledger count is ${facts.get("count")}, not ${names.fixed.size + path.length}`);
  if (facts.get("head") !== versions.at(-1)) say(`its ledger head is ${facts.get("head")}, not its newest row ${versions.at(-1)}`);
  return { byId, generated, facts };
}

/** Compares the two harnesses' output with the commit's fixtures. */
export function compareAll({ clone, commit, writingOut, x2Out }) {
  const git = (args, input) => execFileSync("git", ["-C", clone, ...args], { maxBuffer: 1 << 30, input });
  const manifest = JSON.parse(git(["cat-file", "blob", `${commit}:${MANIFEST}`]).toString("utf8"));
  const names = ledgerNames(manifest);
  const loadBlobs = (dir) => {
    const list = git(["ls-tree", "--name-only", commit, `${dir}/`]).toString("utf8").trim().split("\n").map((p) => p.slice(dir.length + 1));
    const raw = git(["cat-file", "--batch"], list.map((f) => `${commit}:${dir}/${f}\n`).join(""));
    const blobs = new Map();
    let at = 0;
    for (const f of list) {
      const nl = raw.indexOf(10, at);
      const m = /^[0-9a-f]+ blob ([0-9]+)$/.exec(raw.subarray(at, nl).toString("utf8"));
      if (!m) throw new Error(`${dir}/${f} does not read at ${commit}`);
      const n = Number(m[1]);
      blobs.set(f, raw.subarray(nl + 1, nl + 1 + n));
      at = nl + 1 + n + 1;
    }
    return blobs;
  };

  const compareHarness = (h) => {
    const problems = [];
    const say = (s) => problems.push(`${h.name}: ${s}`);
    const blobs = loadBlobs(h.dir);
    const committedNames = [...blobs.keys()];
    const runEntries = readdirSync(h.out).sort();
    for (const f of runEntries) if (!statSync(join(h.out, f)).isFile()) say(`${f} in the run is not a file`);
    const runNames = runEntries.filter((f) => statSync(join(h.out, f)).isFile());
    const blob = (f) => blobs.get(f);
    const run = (f) => readFileSync(join(h.out, f));
    if (JSON.stringify([...committedNames].sort()) !== JSON.stringify(runNames)) say(`the run's files are not the commit's: only in the run [${runNames.filter((f) => !committedNames.includes(f)).join(", ")}], only in the commit [${committedNames.filter((f) => !runNames.includes(f)).join(", ")}]`);
    const namesBoth = runNames.filter((f) => committedNames.includes(f));

    const indexOf = (read, label, list) => {
      let idx;
      try { idx = JSON.parse(read("index.json").toString("utf8")); } catch (e) { say(`the ${label} index does not read: ${e.message}`); return { files: {} }; }
      const files = idx.files ?? {};
      if (JSON.stringify(Object.keys(idx).sort()) !== JSON.stringify(["files", "note"])) say(`the ${label} index holds more than its files and note`);
      const want = list.filter((f) => f !== "index.json").sort();
      if (JSON.stringify(Object.keys(files).sort()) !== JSON.stringify(want)) say(`the ${label} index does not list exactly its files`);
      for (const f of want) if (files[f] !== sha(read(f))) say(`the ${label} index's sha256 of ${f} is not its bytes`);
      return idx;
    };
    const runIndex = indexOf(run, "run's", runNames);
    const commitIndex = indexOf(blob, "commit's", committedNames);
    if (runIndex.note !== commitIndex.note) say("the two indexes' notes differ");

    const asRows = (t) => t.map(([part, key, value]) => ({ part, key, value }));
    /** A reading's rows, from a whole list or a stored difference from its base on the same side. */
    const rowsOf = (read, f) => {
      const j = JSON.parse(read(f).toString("utf8"));
      if (Array.isArray(j)) return j;
      if (j.base) return asRows(j.rows);
      const base = new Map(rowsOf(read, j.from).map((x) => [`${x.part}|${x.key}`, x]));
      for (const [p, k] of j.drop) base.delete(`${p}|${k}`);
      for (const [part, key, value] of j.set) base.set(`${part}|${key}`, { part, key, value });
      return [...base.values()];
    };
    const key = (r) => `${r.part}|${r.key}`;
    const identical = [], generated = [], differing = [];

    const compareReading = (f, path) => {
      const a = rowsOf(run, f), b = rowsOf(blob, f);
      const sayIn = (side) => (s) => say(`${f} (${side}): ${s}`);
      for (const [side, rows] of [["run", a], ["commit", b]]) for (const p of digestProblems(rows)) sayIn(side)(p);
      const sideA = ledgerOfSide(a, path, names, sayIn("run"));
      const sideB = ledgerOfSide(b, path, names, sayIn("commit"));
      // Each generated entry's contents are the commit's, whatever its timestamp.
      for (const id of path) {
        const va = sideA.byId[id], vb = sideB.byId[id];
        if (va !== undefined && vb !== undefined && sideA.facts.get(`row|${va}`) !== sideB.facts.get(`row|${vb}`)) say(`${f}: the generated entry ${id}'s contents moved`);
      }
      const generatedKeys = new Set([...sideA.generated, ...sideB.generated].map((v) => `1|row|${v}`));
      const ma = new Map(a.map((r) => [key(r), r.value])), mb = new Map(b.map((r) => [key(r), r.value]));
      const moved = [...new Set([...ma.keys(), ...mb.keys()])].filter((k) => ma.get(k) !== mb.get(k));
      const timestampsMoved = moved.some((k) => generatedKeys.has(k));
      const allowed = new Set([...DATA, ...(timestampsMoved ? ["1|#md5", "1|head"] : [])]);
      const bad = moved.filter((k) => !allowed.has(k) && !generatedKeys.has(k));
      if (bad.length) say(`${f} moved outside the permitted rows: ${bad.slice(0, 6).join(", ")}`);
      generated.push({ f, moved: moved.length, generatedVersionsMoved: moved.filter((k) => generatedKeys.has(k)).length / 2 });
      return { run: sideA, commit: sideB };
    };
    const compareState = (f, sides) => {
      const path = LEDGER_PATHS[STATE_READINGS[f]];
      const mask = (t) => JSON.stringify(JSON.parse(t).map((x) => ({ ...x, ledger_rows: x.ledger_rows.map((r) => (r.n === "01" ? r : { ...r, forward: r.forward === null ? null : "<version>", rollback: r.rollback === null ? null : "<version>" })) })));
      if (mask(run(f).toString("utf8")) !== mask(blob(f).toString("utf8"))) say(`${f} moved outside its ledger versions`);
      for (const [side, read, ledger] of [["run", run, sides.run], ["commit", blob, sides.commit]]) {
        for (const x of JSON.parse(read(f).toString("utf8"))) {
          for (const r of x.ledger_rows) {
            if (r.n === "01") {
              if (r.forward !== manifest.migrations.find((m) => m.n === "01").productionVersion || r.rollback !== null) say(`${f} (${side}): 01's row is not the recorded one`);
              continue;
            }
            const forward = path.includes(r.n) ? ledger.byId[r.n] ?? null : null;
            const rollback = path.includes(`${r.n}r`) ? ledger.byId[`${r.n}r`] ?? null : null;
            if (r.forward !== forward || r.rollback !== rollback) say(`${f} (${side}): ${r.n}'s versions ${r.forward}, ${r.rollback} are not its reading's ${forward}, ${rollback}`);
          }
        }
      }
      if (!run(f).equals(blob(f))) generated.push({ f, moved: "ledger versions" });
    };

    const sidesOf = new Map();
    for (const f of namesBoth.filter((x) => x !== "index.json")) {
      const same = run(f).equals(blob(f));
      try {
        if (Object.hasOwn(h.readings, f)) {
          const sides = compareReading(f, h.readings[f]);
          sidesOf.set(f, sides);
          if (same) { generated.pop(); identical.push(f); } else differing.push(f);
        } else if (Object.hasOwn(h.states, f)) {
          if (same) identical.push(f); else differing.push(f);
        } else if (same) identical.push(f);
        else { differing.push(f); say(`${f} is not byte-identical to its blob, and is not a generated reading`); }
      } catch (e) { say(`${f} could not be compared: ${e.message}`); }
    }
    for (const f of Object.keys(h.readings)) if (!namesBoth.includes(f)) say(`the named reading ${f} is not there`);
    for (const f of Object.keys(h.states)) {
      if (!namesBoth.includes(f)) { say(`the named state ${f} is not there`); continue; }
      const sides = sidesOf.get(h.states[f]);
      if (!sides) { say(`${f}: its reading ${h.states[f]} was not compared`); continue; }
      try { compareState(f, sides); } catch (e) { say(`${f} could not be compared: ${e.message}`); }
    }
    const runFiles = runIndex.files ?? {}, commitFiles = commitIndex.files ?? {};
    for (const f of Object.keys({ ...runFiles, ...commitFiles })) if (runFiles[f] !== commitFiles[f] && !differing.includes(f)) say(`the indexes differ on ${f}, whose bytes do not`);
    return { name: h.name, files: namesBoth.length, identical: identical.length, generated, problems };
  };

  const results = [
    { name: "writing", dir: "scripts/tests/fixtures/stage0-4c-writing", out: writingOut, readings: WRITING_READINGS, states: {} },
    { name: "x2", dir: "scripts/tests/fixtures/stage0-4c", out: x2Out, readings: LEDGER_PATHS, states: STATE_READINGS },
  ].map(compareHarness);
  const problems = results.flatMap((r) => r.problems);
  return { commit, ok: problems.length === 0, fixedVersions: names.fixed.size, results, problems };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
  const clone = arg("--clone"), commit = arg("--commit"), writingOut = arg("--writing-out"), x2Out = arg("--x2-out"), report = arg("--report");
  if (!clone || !commit || !writingOut || !x2Out || !report) { process.stderr.write("usage: compare-fixtures.mjs --clone <dir> --commit <hash> --writing-out <dir> --x2-out <dir> --report <file>\n"); process.exit(2); }
  let out;
  try { out = compareAll({ clone, commit, writingOut, x2Out }); }
  catch (e) { process.stderr.write(`it cannot run: ${e.stack}\n`); process.exit(2); }
  writeFileSync(report, `${JSON.stringify(out, null, 2)}\n`);
  for (const r of out.results) process.stdout.write(`${r.name}: ${r.files} files, ${r.identical} byte-identical to their blobs, ${r.generated.length} generated readings with only permitted differences, ${r.problems.length} problems\n`);
  for (const p of out.problems.slice(0, 30)) process.stdout.write(`PROBLEM ${p}\n`);
  process.exit(out.problems.length ? 1 : 0);
}
