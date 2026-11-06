// scripts/verify/check-tap.mjs — a required step of the verification driver: reads TAP
// logs and fails unless each shows every test passing. An exit code is not enough for
// these: a run can exit 0 and report skipped tests, and the replay's summary is one test
// wrapping many runs.
//
//   node check-tap.mjs --file <tap>... [--expect <tests>]
//   node check-tap.mjs --replay <dir of state-NN.tap> --summary <.stage0-replay-summary.json> --pins <verification-pins.json> --clone <dir> [--expect <tests>]
//
// The replay form takes its expected states from the pin set's reviewed set for the
// tested commit's recorded state (its manifest's migrations with a production version,
// and its count of rollback records). No reviewed set for that state is a failure, so a
// record commit that changes the state must bring its own reviewed set.
//
// Exit 0 when every log has tests = pass > 0, no failed, cancelled, skipped or todo test,
// and no `not ok` line; 1 otherwise; 2 on bad usage.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const MANIFEST = "docs/security/stage0-production-manifest.json";
const argv = process.argv.slice(2);
const opt = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
const expect = opt("--expect") === undefined ? null : Number(opt("--expect"));
const usage = () => { process.stderr.write("usage: check-tap.mjs --file <tap>... [--expect <n>] | --replay <dir> --summary <json> --pins <json> --clone <dir> [--expect <n>]\n"); process.exit(2); };
if (expect !== null && !Number.isSafeInteger(expect)) usage();

const problems = [];
const COUNTS = ["tests", "pass", "fail", "cancelled", "skipped", "todo"];
/** A log's counts, and what is wrong with them. */
function readTap(f) {
  const text = readFileSync(f, "utf8");
  const count = (k) => {
    const all = [...text.matchAll(new RegExp(`^# ${k} ([0-9]+)\\s*$`, "gm"))];
    return all.length === 1 ? Number(all[0][1]) : null;
  };
  const c = Object.fromEntries(COUNTS.map((k) => [k, count(k)]));
  const notOk = (text.match(/^\s*not ok\b/gm) || []).length;
  const bad = [];
  if (Object.values(c).some((v) => v === null)) bad.push("a count is missing or repeated");
  if (!(c.tests > 0) || c.tests !== c.pass) bad.push(`tests ${c.tests}, pass ${c.pass}`);
  for (const k of ["fail", "cancelled", "skipped", "todo"]) if (c[k] !== 0) bad.push(`${k} ${c[k]}`);
  if (notOk) bad.push(`${notOk} not ok lines`);
  if (expect !== null && c.tests !== expect) bad.push(`tests ${c.tests}, expected ${expect}`);
  process.stdout.write(`${f}: tests ${c.tests}, pass ${c.pass}, fail ${c.fail}, cancelled ${c.cancelled}, skipped ${c.skipped}, todo ${c.todo}, not ok ${notOk}${bad.length ? ` PROBLEM ${bad.join("; ")}` : ""}\n`);
  if (bad.length) problems.push(`${f}: ${bad.join("; ")}`);
  return c;
}

if (opt("--replay")) {
  const dir = opt("--replay"), summaryFile = opt("--summary"), pinsFile = opt("--pins"), clone = opt("--clone");
  if (!summaryFile || !pinsFile || !clone) usage();
  const manifest = JSON.parse(execFileSync("git", ["-C", clone, "cat-file", "blob", `HEAD:${MANIFEST}`], { maxBuffer: 1 << 28 }).toString("utf8"));
  const recorded = { applied: manifest.migrations.filter((m) => m.productionVersion).map((m) => m.n), rollbackRecords: manifest.rollbackRecords.length };
  const sets = JSON.parse(readFileSync(pinsFile, "utf8")).replay?.sets ?? [];
  const found = sets.filter((s) => JSON.stringify(s.recorded) === JSON.stringify(recorded));
  let want = [];
  if (found.length !== 1) problems.push(`no one reviewed replay-state set for the recorded state ${JSON.stringify(recorded)}`);
  else want = found[0].states;
  process.stdout.write(`recorded state ${JSON.stringify(recorded)}: ${want.length} reviewed states\n`);
  const names = readdirSync(dir).filter((f) => /^state-[0-9]+\.tap$/.test(f)).sort();
  const wantNames = want.map((_, i) => `state-${String(i).padStart(2, "0")}.tap`);
  if (JSON.stringify(names) !== JSON.stringify(wantNames)) problems.push(`the state logs are [${names.join(", ")}], not the ${want.length} reviewed states'`);
  const summary = JSON.parse(readFileSync(summaryFile, "utf8"));
  const labels = Array.isArray(summary) ? summary.map((r) => r.label) : [];
  if (JSON.stringify(labels) !== JSON.stringify(want)) problems.push(`the replay's states are ${JSON.stringify(labels)}, not the reviewed set ${JSON.stringify(want)}`);
  names.forEach((f, i) => {
    const c = readTap(join(dir, f));
    const r = Array.isArray(summary) ? summary[i] : undefined;
    if (!r) { problems.push(`${f}: the summary has no state ${i}`); return; }
    if (r.code !== 0) problems.push(`${r.label}: the suite exited ${r.code}`);
    for (const k of COUNTS) if (r[k] !== c[k]) problems.push(`${r.label}: the summary says ${k} ${r[k]}, its log ${c[k]}`);
    process.stdout.write(`state ${String(i).padStart(2, "0")} ${r.label} ${r.sha}\n`);
  });
} else {
  const files = [];
  argv.forEach((a, i) => { if (a === "--file") files.push(argv[i + 1]); });
  if (!files.length) usage();
  for (const f of files) readTap(f);
}
for (const p of problems) process.stdout.write(`PROBLEM ${p}\n`);
process.exit(problems.length ? 1 : 0);
