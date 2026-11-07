// scripts/tests/verify-tooling.test.js — the verification tooling (scripts/verify), Codex's
// review of 2d53bed §4 and §5.
//   VT-1, VT-2   the pin set, its raw-text regression check, and a parse of each module
//   VT-3 to VT-7 a child's failure reaches the caller through the driver and the launcher,
//                and a run takes new names and leaves earlier evidence alone
//   VT-17, VT-18 a refused isolation-before runs nothing after it; a passing one does, and an
//                ordinary failure still reaches the result
//   VT-8 to VT-13 compare-fixtures: DR-1's exact negative, the valid generated-timestamp
//                control, and each way a ledger can move outside the named entries
//   VT-14, VT-15 check-tap: a log's counts, and the reviewed replay-state set
//   VT-16        check-isolation before and after
//   VT-19 to VT-23 VT3: the per-user locations each set once (a driver without its unset is
//                refused), an unexpected write into the tested tree fails the run, PowerShell's
//                cache placement with the driver's locations and with the old ones, and the
//                tree check's cases; VT3b: a stand-in put on PATH is executable (VT-23)
// Everything runs on synthetic repositories, homes and fixture copies. No store, token,
// remote or database. The compare-fixtures cases read HEAD's committed fixtures.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parse } from "acorn";
import { jsCode } from "./source-util.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TOOL = (f) => join(ROOT, "scripts", "verify", f);
const P = await import(pathToFileURL(TOOL("check-pins.mjs")).href);
const C = await import(pathToFileURL(TOOL("compare-fixtures.mjs")).href);

const slash = (p) => p.replace(/\\/g, "/");
const newDir = (t) => {
  const d = slash(realpathSync.native(mkdtempSync(join(tmpdir(), "verify-tooling-"))));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  return d;
};
/** Git for Windows' own bash on win32, never the system's WSL launcher; bash elsewhere. */
const BASH = process.platform === "win32"
  ? join(execFileSync("git", ["--exec-path"]).toString("utf8").trim(), "..", "..", "..", "bin", "bash.exe")
  : "bash";
const childEnv = (home, extra = {}) => {
  const env = { ...process.env, HOME: home, USERPROFILE: home, ...extra };
  env.PATH = `${dirname(process.execPath)}${process.platform === "win32" ? ";" : ":"}${env.PATH ?? env.Path ?? ""}`;
  delete env.NODE_TEST_CONTEXT; delete env.NODE_OPTIONS; delete env.SUPABASE_ACCESS_TOKEN; delete env.STAGE0_SESSION; delete env.STAGE0_MANIFEST;
  return env;
};
const ID = ["-c", "user.name=verify-tooling", "-c", "user.email=verify-tooling@example.invalid", "-c", "commit.gpgsign=false", "-c", "core.autocrlf=false"];
const git = (dir, ...a) => execFileSync("git", [...ID, "-C", dir, ...a], { maxBuffer: 1 << 30, stdio: ["ignore", "pipe", "pipe"] }).toString("utf8").trim();
const toolNames = () => readdirSync(join(ROOT, "scripts", "verify"));

/** A repository holding exactly this tree's scripts/verify, committed. */
function toolRepo(t) {
  const repo = newDir(t);
  git(repo, "init", "--quiet");
  mkdirSync(join(repo, "scripts", "verify"), { recursive: true });
  for (const f of toolNames()) cpSync(TOOL(f), join(repo, "scripts", "verify", f));
  git(repo, "add", "-A");
  git(repo, "commit", "--quiet", "-m", "the tools");
  return { repo, head: git(repo, "rev-parse", "HEAD") };
}
/** The launcher, as this checkout holds it unless `launcher` names another. */
function launch(repo, tooling, out, label, args, { launcher = TOOL("verify-launch.sh"), home } = {}) {
  return spawnSync(BASH, [slash(launcher), "--repo", repo, "--tooling", tooling, "--out", out, "--label", label, "--", ...args], { encoding: "utf8", env: childEnv(home ?? out), windowsHide: true });
}
const summaryOf = (out, label) => readFileSync(join(out, `verify-${label}-summary.txt`), "utf8");
const WIN = process.platform === "win32";
const samePath = (a, b) => { const n = (p) => { const r = resolve(String(p)); return WIN ? r.toLowerCase() : r; }; return n(a) === n(b); };
/** The `variable NAME=value` lines a summary records. */
const variablesOf = (s) => Object.fromEntries([...s.matchAll(/^variable ([A-Za-z]+)=(.*)$/gm)].map((m) => [m[1], m[2]]));
const LOCATIONS = /^(HOME|USERPROFILE|LOCALAPPDATA|APPDATA|PSModuleAnalysisCachePath)$/i;
/** The per-user locations the driver sets, for a home and a cache file of the test's own; their directories are made. */
function isolatedEnv(home, pscache, extra = {}) {
  for (const d of [join(home, "AppData", "Local"), join(home, "AppData", "Roaming"), dirname(pscache)]) mkdirSync(d, { recursive: true });
  const env = childEnv(home);
  for (const k of Object.keys(env)) if (LOCATIONS.test(k)) delete env[k];
  return { ...env, HOME: home, USERPROFILE: home, LOCALAPPDATA: join(home, "AppData", "Local"), APPDATA: join(home, "AppData", "Roaming"), PSModuleAnalysisCachePath: pscache, ...extra };
}
/** A committed, clean checkout: one tracked file and, with `ignore`, the ignore rules of the real repository's driver outputs and *.log. */
function cleanTree(t, { ignore = false } = {}) {
  const d = newDir(t);
  git(d, "init", "--quiet");
  writeFileSync(join(d, "a.txt"), "a\n");
  if (ignore) writeFileSync(join(d, ".gitignore"), "node_modules/\ndist/\n.stage0-replay/\n.stage0-replay-summary.json\n*.log\n");
  git(d, "add", "-A");
  git(d, "commit", "--quiet", "-m", "a clean tree");
  return d;
}

test("VT-1 the pin set is current, its raw-text check finds nothing, and its required steps are the driver's", () => {
  assert.deepEqual(P.checkProblems(ROOT), []);
  const pins = P.readPins(ROOT);
  const driver = readFileSync(TOOL("verify-driver.sh"), "utf8");
  const verifyMode = driver.slice(driver.indexOf("\n  verify)\n"), driver.indexOf("\n  selftest)\n"));
  assert.deepEqual([...verifyMode.matchAll(/^\s*step ([a-z0-9-]+) /gm)].map((m) => m[1]), pins.requiredSteps);
});

/** What a module's text loads, read from its syntax tree: every static form, and each dynamic form or loader call. */
function loadsOf(text) {
  const out = { fixed: [], dynamic: 0, loaderCalls: 0 };
  const visit = (n) => {
    if (n === null || typeof n !== "object") return;
    if (Array.isArray(n)) { n.forEach(visit); return; }
    if (typeof n.type === "string") {
      if (["ImportDeclaration", "ExportAllDeclaration", "ExportNamedDeclaration"].includes(n.type) && n.source) out.fixed.push(n.source.value);
      if (n.type === "ImportExpression") out.dynamic++;
      if (n.type === "CallExpression" && n.callee.type === "Identifier" && ["require", "createRequire"].includes(n.callee.name)) out.loaderCalls++;
    }
    for (const k of Object.keys(n)) if (k !== "loc") visit(n[k]);
  };
  visit(parse(text, { ecmaVersion: "latest", sourceType: "module", allowHashBang: true }));
  return out;
}

test("VT-2b each module's loads, read from its syntax tree: only node: builtins, and check-isolation's one named exception. The forms the run-time regular expressions miss are seen here", () => {
  // Codex's VT-N1 forms, each read as what it is.
  for (const [text, want] of [
    ["import '../untracked.mjs';\n", ["../untracked.mjs"]],
    ["const a = 1; import b from \"../x.mjs\";\n", ["../x.mjs"]],
    ["import {\n  a,\n  b,\n} from \"../y.mjs\";\n", ["../y.mjs"]],
    ["export { a } from \"../z.mjs\";\n", ["../z.mjs"]],
    ["export * from '../w.mjs';\n", ["../w.mjs"]],
    ["import \"node:fs\";\n", ["node:fs"]],
    ["const s = \"import q from 'not-this.mjs'\"; // import r from \"nor-this.mjs\"\n", []],
  ]) assert.deepEqual(loadsOf(text).fixed, want, text);
  assert.equal(loadsOf("const m = await import(\"./y.mjs\");\n").dynamic, 1);
  assert.equal(loadsOf("const m = require(\"./y.cjs\");\n").loaderCalls, 1);
  // Those same forms pass the run-time check, which says so: it is a regression check only.
  const modules = toolNames().filter((f) => f.endsWith(".mjs"));
  assert.ok(modules.length >= 4);
  for (const f of modules) {
    const l = loadsOf(readFileSync(TOOL(f), "utf8"));
    assert.deepEqual(l.fixed.filter((s) => !s.startsWith("node:")), [], `${f}: a static load that is not a node: builtin`);
    assert.equal(l.loaderCalls, 0, `${f}: a loader call`);
    assert.equal(l.dynamic, f === "check-isolation.mjs" ? 1 : 0, `${f}: its dynamic loads`);
  }
});

test("VT-2 the audit refuses a changed, missing or unpinned tool, and the forms its raw-text check reads", (t) => {
  const copy = () => { const { repo } = toolRepo(t); return repo; };
  const tool = (r, f) => join(r, "scripts", "verify", f);
  const a = copy();
  appendFileSync(tool(a, "check-tap.mjs"), "// one more line\n");
  assert.match(P.checkProblems(a).join("\n"), /check-tap\.mjs: its blob/);
  const b = copy();
  rmSync(tool(b, "check-tap.mjs"));
  assert.match(P.checkProblems(b).join("\n"), /check-tap\.mjs is pinned and not there/);
  const c = copy();
  writeFileSync(tool(c, "helper.mjs"), "export const x = 1;\n");
  assert.match(P.checkProblems(c).join("\n"), /helper\.mjs is there and not pinned/);
  const d = copy();
  appendFileSync(tool(d, "compare-fixtures.mjs"), 'import { x } from "./helper.mjs";\n');
  assert.match(P.rawTextProblems(d).join("\n"), /imports \.\/helper\.mjs, which is not a node: builtin/);
  const e = copy();
  appendFileSync(tool(e, "check-tap.mjs"), 'const y = await import("./helper.mjs");\n');
  assert.match(P.rawTextProblems(e).join("\n"), /check-tap\.mjs has a dynamic import/);
  const f = copy();
  appendFileSync(tool(f, "verify-driver.sh"), 'node "$TOOLS/helper.mjs"\n');
  assert.match(P.rawTextProblems(f).join("\n"), /names helper\.mjs, which is not pinned/);
  const g = copy();
  appendFileSync(tool(g, "verify-driver.sh"), 'rm -rf "$OUT"\n');
  assert.match(P.rawTextProblems(g).join("\n"), /deletes or moves files/);
});

test("VT-3 a failing middle step fails the run though the last step passes; a passing control exits 0", (t) => {
  const { repo, head } = toolRepo(t);
  const out = newDir(t);
  const pass = launch(repo, head, out, "pass", ["selftest", "--codes", "0 0 0"]);
  assert.equal(pass.status, 0, pass.stdout + pass.stderr);
  assert.match(summaryOf(out, "pass"), /^RESULT PASSED/m);
  const fail = launch(repo, head, out, "fail", ["selftest", "--codes", "0 3 0"]);
  assert.equal(fail.status, 1, fail.stdout + fail.stderr);
  const s = summaryOf(out, "fail");
  assert.match(s, /^s2 exit 3 /m);
  assert.match(s, /^s3 exit 0 /m);
  assert.match(s, /^RESULT FAILED: required steps failed: s2;/m);
  const last = launch(repo, head, out, "last", ["selftest", "--codes", "0 0 5"]);
  assert.equal(last.status, 1);
  const first = launch(repo, head, out, "first", ["selftest", "--codes", "9 0 0"]);
  assert.equal(first.status, 1);
  assert.match(summaryOf(out, "first"), /required steps failed: s1;/);
});

test("VT-4 a required step that never ran fails the run", (t) => {
  const { repo, head } = toolRepo(t);
  const out = newDir(t);
  const r = launch(repo, head, out, "skip", ["selftest", "--codes", "0 0 0", "--skip-last"]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(summaryOf(out, "skip"), /^RESULT FAILED: required steps failed: none; not run: s3/m);
});

test("VT-5 each run records its commits, hashes, step set, exits and result, and pins come first", (t) => {
  const { repo, head } = toolRepo(t);
  const out = newDir(t);
  const r = launch(repo, head, out, "record", ["selftest", "--codes", "0"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const s = summaryOf(out, "record");
  const tree = git(repo, "rev-parse", "HEAD^{tree}");
  assert.ok(s.includes(`tested commit ${head} tree ${tree}`), s);
  assert.ok(s.includes(`tooling commit ${head} tree ${tree} scripts/verify ${git(repo, "rev-parse", "HEAD:scripts/verify")}`), s);
  const pins = JSON.parse(git(repo, "show", "HEAD:scripts/verify/verification-pins.json"));
  for (const [path, pin] of Object.entries(pins.tools)) assert.ok(s.includes(`tool ${path} blob ${pin.blob} sha256 ${pin.sha256}`), path);
  assert.match(s, /^pin set scripts\/verify\/verification-pins\.json blob [0-9a-f]{40} sha256 [0-9a-f]{64}$/m);
  assert.match(s, /^required steps: pins s1$/m);
  // The per-user locations it set (VT3), and the temporary directory's variables.
  const v = variablesOf(s), home = join(out, "verify-record-home");
  for (const [k, want] of [["HOME", home], ["USERPROFILE", home], ["LOCALAPPDATA", join(home, "AppData", "Local")], ["APPDATA", join(home, "AppData", "Roaming")], ["PSModuleAnalysisCachePath", join(out, "verify-record-pscache", "ModuleAnalysisCache")]]) assert.ok(samePath(v[k], want), `${k}=${v[k]}, not ${want}`);
  assert.ok(Object.hasOwn(v, "TEMP") && Object.hasOwn(v, "TMP"), s);
  assert.match(s, /^pins exit 0 /m);
  assert.match(s, /^s1 exit 0 /m);
  assert.ok(s.indexOf("pins exit") < s.indexOf("s1 exit"));
  assert.ok(s.trimEnd().split("\n").at(-1).startsWith("RESULT PASSED"));
  // The tools it ran are the commit's bytes, in the run's own directory.
  const ran = join(out, "verify-record-tooling", "scripts", "verify");
  for (const f of readdirSync(ran)) assert.equal(readFileSync(join(ran, f)).toString("hex"), execFileSync("git", ["-C", repo, "cat-file", "blob", `${head}:scripts/verify/${f}`], { maxBuffer: 1 << 28 }).toString("hex"), f);
  assert.deepEqual(readdirSync(ran).sort(), toolNames().sort());
});

test("VT-6 failed pins stop the run before anything else; the launcher refuses a copy of itself that is not the commit's", (t) => {
  const { repo, head } = toolRepo(t);
  appendFileSync(join(repo, "scripts", "verify", "check-tap.mjs"), "// not pinned\n");
  git(repo, "add", "-A");
  git(repo, "commit", "--quiet", "-m", "a tool changed, the pins not");
  const stale = git(repo, "rev-parse", "HEAD");
  const out = newDir(t);
  const r = launch(repo, stale, out, "stale", ["selftest", "--codes", "0 0"]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  const s = summaryOf(out, "stale");
  assert.match(s, /^pins exit 1 /m);
  assert.match(s, /^RESULT FAILED: required steps failed: pins; not run: s1 s2/m);
  assert.equal(existsSync(join(out, "verify-stale-s1.txt")), false);
  // check-pins verify: the tested commit must carry the tooling commit's tools.
  const log = join(out, "tested-other.txt");
  const other = spawnSync(process.execPath, [TOOL("check-pins.mjs"), "verify", "--repo", repo, "--tooling", head, "--root", ROOT, "--commit", stale, "--record", log], { encoding: "utf8", env: childEnv(out), windowsHide: true });
  assert.equal(other.status, 1);
  assert.match(readFileSync(log, "utf8"), /the tested commit's scripts\/verify is not the tooling commit's/);
  // The launcher itself.
  const mine = join(out, "other-launcher.sh");
  writeFileSync(mine, `${readFileSync(TOOL("verify-launch.sh"), "utf8")}# one more line\n`);
  const refused = launch(repo, head, out, "launcher", ["selftest", "--codes", "0"], { launcher: mine });
  assert.equal(refused.status, 1, refused.stdout + refused.stderr);
  assert.match(refused.stdout, /this launcher is not the tooling commit's/);
  assert.equal(existsSync(join(out, "verify-launcher-summary.txt")), false);
});

test("VT-7 the launcher passes on the driver's exit, a killed driver included; a run refuses names that exist and leaves their evidence", (t) => {
  const { repo } = toolRepo(t);
  const out = newDir(t);
  const driverFile = join(repo, "scripts", "verify", "verify-driver.sh");
  writeFileSync(driverFile, "#!/usr/bin/env bash\nexit 7\n");
  git(repo, "add", "-A");
  git(repo, "commit", "--quiet", "-m", "a driver that exits 7");
  const seven = launch(repo, git(repo, "rev-parse", "HEAD"), out, "seven", ["selftest", "--codes", "0"]);
  assert.equal(seven.status, 7, seven.stdout + seven.stderr);
  writeFileSync(driverFile, '#!/usr/bin/env bash\nkill -9 "$$"\n');
  git(repo, "add", "-A");
  git(repo, "commit", "--quiet", "-m", "a driver that is killed");
  const killed = launch(repo, git(repo, "rev-parse", "HEAD"), out, "killed", ["selftest", "--codes", "0"]);
  assert.notEqual(killed.status, 0, killed.stdout + killed.stderr);
  assert.notEqual(killed.status, null);
  // Names in use.
  const fresh = toolRepo(t);
  const first = launch(fresh.repo, fresh.head, out, "once", ["selftest", "--codes", "0 4"]);
  assert.equal(first.status, 1);
  const before = summaryOf(out, "once");
  const again = launch(fresh.repo, fresh.head, out, "once", ["selftest", "--codes", "0"]);
  assert.equal(again.status, 2, again.stdout + again.stderr);
  assert.match(again.stdout, /exists: every run gets a new directory/);
  assert.equal(summaryOf(out, "once"), before);
  assert.ok(existsSync(join(out, "verify-once-s2.txt")));
  // The driver's own refusals, past the launcher: a summary, a home or a clone in use.
  const tools = join(out, "verify-once-tooling", "scripts", "verify", "verify-driver.sh");
  const run = (label, args) => spawnSync(BASH, [slash(tools), ...args, "--label", label, "--out", out, "--repo", fresh.repo, "--tooling", fresh.head], { encoding: "utf8", env: childEnv(out), windowsHide: true });
  const summaryInUse = run("once", ["selftest", "--codes", "0"]);
  assert.equal(summaryInUse.status, 2);
  assert.match(summaryInUse.stdout, /exists: every run gets new logs/);
  mkdirSync(join(out, "taken"));
  const cloneInUse = run("clonetaken", ["verify", "--commit", fresh.head, "--pglite", out, "--expect-tests", "1", "--clone-name", "taken"]);
  assert.equal(cloneInUse.status, 2);
  assert.match(cloneInUse.stdout, /exists: every run gets a new directory/);
  assert.equal(summaryInUse.stdout.includes("RESULT"), false);
  mkdirSync(join(out, "verify-cachetaken-pscache"));
  const cacheInUse = run("cachetaken", ["selftest", "--codes", "0"]);
  assert.equal(cacheInUse.status, 2);
  assert.match(cacheInUse.stdout, /exists: every run gets a new cache directory/);
  assert.equal(existsSync(join(out, "verify-cachetaken-summary.txt")), false);
});

/**
 * A stand-in program for a test to put on PATH, written executable. Bash's PATH search on Linux
 * passes over a file without the execute bit and runs the next one it finds; Git for Windows'
 * bash runs a `#!` file without it. VT-18's stand-in yarn had no bit, so on Netlify's Linux the
 * build's own yarn ran and VT-18 failed (staging deploy 6aef4d4a of 0acf9ca).
 */
function pathStub(dir, name, body) {
  const p = join(dir, name);
  writeFileSync(p, body, { mode: 0o755 });
  chmodSync(p, 0o755);
  return p;
}
/**
 * `env` with `dir` first on its PATH. On POSIX it refuses a directory holding a file that is
 * not executable by everyone, so a stand-in written without its bit fails here, by name, and
 * never falls through to a real program. Every stand-in this file puts on PATH goes through it;
 * a stand-in put on PATH some other way is a review item, which no check here finds.
 */
function stubsOnPath(env, dir) {
  if (!WIN) {
    for (const n of readdirSync(dir)) {
      const s = statSync(join(dir, n));
      if (s.isFile() && (s.mode & 0o111) !== 0o111) throw new Error(`${n} in ${dir} is not executable (mode ${(s.mode & 0o777).toString(8)}): a POSIX PATH search would pass over it`);
    }
  }
  return { ...env, PATH: `${dir}${WIN ? ";" : ":"}${env.PATH ?? env.Path ?? ""}` };
}
/**
 * A synthetic tested repository for the driver's real verify mode: the tools, and a guard module
 * whose default path `guardBody` decides. A stub yarn on PATH leaves a marker for each command it
 * is asked to run, so the marker shows what the driver started. No node_modules, harness or replay
 * exists there, so the steps that need them fail on their own.
 */
function verifyRig(t, guardBody, { yarn = "", driver = null } = {}) {
  const { repo } = toolRepo(t);
  mkdirSync(join(repo, "scripts", "manual"), { recursive: true });
  writeFileSync(join(repo, "scripts", "manual", "stage0-guard.mjs"), guardBody);
  // A driver of the test's own, with the pins brought up to it.
  if (driver) {
    writeFileSync(join(repo, "scripts", "verify", "verify-driver.sh"), driver(readFileSync(TOOL("verify-driver.sh"), "utf8")));
    execFileSync(process.execPath, [TOOL("check-pins.mjs"), "generate", "--root", repo]);
  }
  git(repo, "add", "-A");
  git(repo, "commit", "--quiet", "-m", "a guard module");
  const stubs = newDir(t);
  const marker = join(newDir(t), "yarn-called.txt");
  pathStub(stubs, "yarn", `#!/usr/bin/env bash\necho "yarn $*" >> "${marker}"\n${yarn}exit 0\n`);
  const out = newDir(t);
  const pg = newDir(t);
  const head = git(repo, "rev-parse", "HEAD");
  const run = (label, change = (env) => env) => {
    const env = stubsOnPath(childEnv(out), stubs);
    return spawnSync(BASH, [slash(TOOL("verify-launch.sh")), "--repo", repo, "--tooling", head, "--out", out, "--label", label, "--", "verify", "--commit", head, "--pglite", pg, "--expect-tests", "1"], { encoding: "utf8", env: change(env), windowsHide: true });
  };
  return { repo, head, out, marker, run };
}
const AFTER_ISOLATION = ["powershell-before", "install", "test", "test-counts", "build", "manifest", "m13", "targeted", "targeted-counts", "harness", "writing", "fixtures", "replay", "replay-counts", "isolation-after", "tree-after"];
const OWN_GUARD = `import { homedir } from "node:os";\nimport { join } from "node:path";\nexport const DEFAULT_STATE = join(homedir(), ".stage0-guard");\n`;
/** Stale per-user values under lower-case spellings only, each naming a place inside `repo`, as a parent might pass them. */
const staleSpellings = (repo) => (env) => {
  for (const k of Object.keys(env)) if (/^(LOCALAPPDATA|APPDATA|PSModuleAnalysisCachePath)$/i.test(k)) delete env[k];
  return { ...env, localappdata: join(repo, "stale-local"), appdata: join(repo, "stale-roaming"), psmoduleanalysiscachepath: join(repo, "stale-cache") };
};

test("VT-17 VT-R1: a refused isolation-before stops the run at once. No install, test, harness, build or replay command starts, and the summary names each as not run", (t) => {
  // The guard's default store lies outside the synthetic home.
  const { out, marker, run } = verifyRig(t, `export const DEFAULT_STATE = ${JSON.stringify(join(tmpdir(), "elsewhere", ".stage0-guard"))};\n`);
  const r = run("refused");
  assert.equal(r.status, 1, r.stdout + r.stderr);
  const s = summaryOf(out, "refused");
  assert.match(s, /^isolation-before exit 1 /m);
  assert.match(s, new RegExp(`^RESULT FAILED: required steps failed: isolation-before; not run: ${AFTER_ISOLATION.join(" ")} `, "m"));
  for (const step of AFTER_ISOLATION) {
    assert.equal(existsSync(join(out, `verify-refused-${step}.txt`)), false, `${step} left a log`);
    assert.equal(new RegExp(`^${step} exit `, "m").test(s), false, `${step} has an exit line`);
  }
  assert.equal(existsSync(marker), false, "yarn was never started");
  assert.match(readFileSync(join(out, "verify-refused-isolation-before.txt"), "utf8"), /not under the synthetic home/, "the refusal's own evidence stays");
  assert.ok(s.trimEnd().split("\n").at(-1).startsWith("RESULT FAILED"), "the failed summary is kept and final");
});

test("VT-18 a passing isolation-before goes on to every step, and an ordinary failure in them still reaches the result. The per-user locations are the synthetic ones though the parent passed stale lower-case spellings, PowerShell's cache is at the synthetic file, and tree-after passes", { timeout: 180000 }, (t) => {
  const { repo, out, marker, run } = verifyRig(t, OWN_GUARD);
  const r = run("control", staleSpellings(repo));
  assert.equal(r.status, 1, r.stdout + r.stderr);
  const s = summaryOf(out, "control");
  assert.match(s, /^isolation-before exit 0 /m, readFileSync(join(out, "verify-control-isolation-before.txt"), "utf8"));
  assert.match(s, /^powershell-before exit 0 /m, readFileSync(join(out, "verify-control-powershell-before.txt"), "utf8"));
  for (const step of AFTER_ISOLATION) assert.match(s, new RegExp(`^${step} exit [0-9]+ `, "m"), `${step} ran`);
  const called = readFileSync(marker, "utf8");
  for (const c of ["yarn install --frozen-lockfile", "yarn test", "yarn build"]) assert.ok(called.includes(c), c);
  // The stubbed yarn exits 0, and test-counts fails on its empty log, so the failure is a later step's.
  assert.match(s, /^install exit 0 /m);
  assert.match(s, /^test exit 0 /m);
  assert.match(s, /^test-counts exit 1 /m);
  assert.match(s, /^isolation-after exit 0 /m);
  assert.match(s, /^tree-after exit 0 /m, readFileSync(join(out, "verify-control-tree-after.txt"), "utf8"));
  assert.match(s, /^RESULT FAILED: required steps failed: test-counts .*; not run: none /m);
  // Each location the synthetic one, under one spelling, whatever the parent passed.
  const v = variablesOf(s), home = join(out, "verify-control-home"), cache = join(out, "verify-control-pscache", "ModuleAnalysisCache");
  assert.ok(samePath(v.LOCALAPPDATA, join(home, "AppData", "Local")) && samePath(v.APPDATA, join(home, "AppData", "Roaming")) && samePath(v.PSModuleAnalysisCachePath, cache), s);
  const iso = readFileSync(join(out, "verify-control-isolation-before.txt"), "utf8");
  for (const n of ["LOCALAPPDATA", "APPDATA", "PSModuleAnalysisCachePath"]) assert.equal([...iso.matchAll(new RegExp(`^${n}=`, "gmi"))].length, 1, iso);
  const clone = readdirSync(out).find((n) => /^verify-[0-9a-f]{7}$/.test(n));
  assert.equal(existsSync(join(out, clone, "Microsoft")), false, "nothing of PowerShell's in the clone");
  if (WIN) {
    assert.ok(existsSync(cache), "PowerShell's cache is at the synthetic file");
    assert.match(readFileSync(join(out, "verify-control-powershell-before.txt"), "utf8"), /its cache location .*verify-control-pscache.ModuleAnalysisCache;/i);
  } else assert.match(readFileSync(join(out, "verify-control-powershell-before.txt"), "utf8"), /not Windows, so none is started/);
});

test("VT-19 a driver that sets the per-user locations without first unsetting their other spellings is refused at isolation-before, which names the second spelling, and nothing after it runs", (t) => {
  const { repo, out, marker, run } = verifyRig(t, OWN_GUARD, { driver: (d) => {
    const unset = '  for n in $ISOLATED; do unset_spellings "$n"; done\n';
    assert.equal(d.split(unset).length, 2, "the driver unsets each name once");
    return d.split(unset).join("");
  } });
  const r = run("twice", staleSpellings(repo));
  assert.equal(r.status, 1, r.stdout + r.stderr);
  const s = summaryOf(out, "twice");
  assert.match(s, /^isolation-before exit 1 /m);
  const iso = readFileSync(join(out, "verify-twice-isolation-before.txt"), "utf8");
  for (const n of ["LOCALAPPDATA", "APPDATA", "PSModuleAnalysisCachePath"]) assert.match(iso, new RegExp(`PROBLEM ${n} is set under 2 spellings`), iso);
  assert.match(s, new RegExp(`^RESULT FAILED: required steps failed: isolation-before; not run: ${AFTER_ISOLATION.join(" ")} `, "m"));
  assert.equal(existsSync(marker), false, "yarn was never started");
});

test("VT-20 an unexpected write into the tested tree fails the run at tree-after, which names it, though every other step's result is unchanged", { timeout: 180000 }, (t) => {
  // The stub's `yarn test` leaves what PowerShell left before VT3, in its working directory, the clone.
  const yarn = 'if [ "$1" = test ]; then mkdir -p Microsoft/Windows/PowerShell && echo cache > Microsoft/Windows/PowerShell/ModuleAnalysisCache; fi\n';
  const { out, run } = verifyRig(t, OWN_GUARD, { yarn });
  const r = run("written");
  assert.equal(r.status, 1, r.stdout + r.stderr);
  const s = summaryOf(out, "written");
  assert.match(s, /^tree-after exit 1 /m);
  assert.match(s, /^RESULT FAILED: required steps failed: test-counts .* tree-after; not run: none /m);
  const log = readFileSync(join(out, "verify-written-tree-after.txt"), "utf8");
  assert.match(log, /PROBLEM the tested tree changed: \?\? Microsoft\/Windows\/PowerShell\/ModuleAnalysisCache/);
  assert.match(log, /PROBLEM a PowerShell per-user file is in the tested tree: .*ModuleAnalysisCache/);
});

// ── compare-fixtures ─────────────────────────────────────────────────────────────────
const WRITING = "scripts/tests/fixtures/stage0-4c-writing", X2 = "scripts/tests/fixtures/stage0-4c";
const blobBytes = (rel) => execFileSync("git", ["-C", ROOT, "cat-file", "blob", `HEAD:${rel}`], { maxBuffer: 1 << 28 });
function exportFixtures(dir, target) {
  mkdirSync(target, { recursive: true });
  const names = execFileSync("git", ["-C", ROOT, "ls-tree", "--name-only", "HEAD", `${dir}/`], { maxBuffer: 1 << 28 }).toString("utf8").trim().split("\n");
  const raw = execFileSync("git", ["-C", ROOT, "cat-file", "--batch"], { input: names.map((n) => `HEAD:${n}\n`).join(""), maxBuffer: 1 << 30 });
  let at = 0;
  for (const n of names) {
    const nl = raw.indexOf(10, at);
    const size = Number(/ ([0-9]+)$/.exec(raw.subarray(at, nl).toString("utf8"))[1]);
    writeFileSync(join(target, n.slice(dir.length + 1)), raw.subarray(nl + 1, nl + 1 + size));
    at = nl + 1 + size + 1;
  }
}
const md5 = (s) => createHash("md5").update(Buffer.from(s, "utf8")).digest("hex");
const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const byBytes = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b));

/** A private copy of HEAD's fixtures, as if a harness run had written them. */
function fixtureRun(t) {
  const base = newDir(t);
  const writing = join(base, "writing"), x2 = join(base, "x2");
  exportFixtures(WRITING, writing);
  exportFixtures(X2, x2);
  return { base, writing, x2 };
}
const expand = (dir, f) => {
  const j = JSON.parse(readFileSync(join(dir, f), "utf8"));
  if (Array.isArray(j)) return j;
  if (j.base) return j.rows.map(([part, key, value]) => ({ part, key, value }));
  const m = new Map(expand(dir, j.from).map((r) => [`${r.part}|${r.key}`, r]));
  for (const [p, k] of j.drop) m.delete(`${p}|${k}`);
  for (const [part, key, value] of j.set) m.set(`${part}|${key}`, { part, key, value });
  return [...m.values()];
};
/** Every md5 recomputed from the rows, as a reading's own digests must be. */
function redigest(rows) {
  const partMd5 = (p) => md5(rows.filter((r) => r.part === p && r.key !== "#md5").sort((a, b) => byBytes(a.key, b.key)).map((r) => `${r.key}=${r.value}`).join("\n"));
  for (let p = 1; p <= 10; p++) rows.find((r) => r.part === p && r.key === "#md5").value = partMd5(p);
  rows.find((r) => r.part === 0 && r.key === "#md5").value = md5(Array.from({ length: 10 }, (_, i) => `${i + 1}=${rows.find((r) => r.part === i + 1 && r.key === "#md5").value}`).join("\n"));
  return rows;
}
const reindex = (dir, ...files) => {
  const idx = JSON.parse(readFileSync(join(dir, "index.json"), "utf8"));
  for (const f of files) idx.files[f] = sha256(readFileSync(join(dir, f)));
  writeFileSync(join(dir, "index.json"), `${JSON.stringify(idx, null, 2)}\n`);
};
/** A reading edited as rows, written whole, with valid digests and a valid index. */
function editReading(dir, f, change) {
  const rows = expand(dir, f);
  change(rows);
  redigest(rows);
  writeFileSync(join(dir, f), `${JSON.stringify(rows)}\n`);
  reindex(dir, f);
}
const compare = (run) => C.compareAll({ clone: ROOT, commit: "HEAD", writingOut: run.writing, x2Out: run.x2 });
const row = (rows, part, key) => rows.find((r) => r.part === part && r.key === key);
const ledgerRows = (rows) => rows.filter((r) => r.part === 1 && r.key.startsWith("row|"));
const FIXED_FIRST = "20260427173246", FIXED_FIRST_MOVED = "20260427173247";
const GEN_02 = (rows) => ledgerRows(rows).find((r) => r.value.startsWith("release2_02_auth_attempts_fn|"));

test("VT-8 the fixtures at HEAD pass as they are, and the CLI's exits say so", (t) => {
  const run = fixtureRun(t);
  const out = compare(run);
  assert.deepEqual(out.problems, []);
  assert.equal(out.fixedVersions, 21);
  const report = join(run.base, "report.json");
  const cli = (w, x) => spawnSync(process.execPath, [TOOL("compare-fixtures.mjs"), "--clone", ROOT, "--commit", "HEAD", "--writing-out", w, "--x2-out", x, "--report", report], { encoding: "utf8", windowsHide: true });
  const pass = cli(run.writing, run.x2);
  assert.equal(pass.status, 0, pass.stdout + pass.stderr);
  assert.equal(spawnSync(process.execPath, [TOOL("compare-fixtures.mjs"), "--clone", ROOT], { encoding: "utf8", windowsHide: true }).status, 2);
});

test("VT-9 DR-1's exact negative: create_print_jobs at another version, every digest and the index valid, FAILS", (t) => {
  const run = fixtureRun(t);
  editReading(run.x2, "c-P2-02.json", (rows) => {
    const r = row(rows, 1, `row|${FIXED_FIRST}`);
    assert.match(r.value, /^create_print_jobs\|/);
    r.key = `row|${FIXED_FIRST_MOVED}`;
  });
  // Every digest and index line is valid, so only the ledger rule can refuse it.
  assert.deepEqual(C.digestProblems(expand(run.x2, "c-P2-02.json")), []);
  const idx = JSON.parse(readFileSync(join(run.x2, "index.json"), "utf8"));
  assert.equal(idx.files["c-P2-02.json"], sha256(readFileSync(join(run.x2, "c-P2-02.json"))));
  const out = compare(run);
  assert.equal(out.ok, false);
  assert.match(out.problems.join("\n"), /c-P2-02\.json \(run\): the fixed ledger version 20260427173246 \(create_print_jobs\) is not there/);
  const cli = spawnSync(process.execPath, [TOOL("compare-fixtures.mjs"), "--clone", ROOT, "--commit", "HEAD", "--writing-out", run.writing, "--x2-out", run.x2, "--report", join(run.base, "r.json")], { encoding: "utf8", windowsHide: true });
  assert.equal(cli.status, 1, cli.stdout);
});

test("VT-10 the valid control: a run's generated timestamps differ, with its STATE fixture following", (t) => {
  const run = fixtureRun(t);
  const later = "20270102030405";
  editReading(run.x2, "c-P2-02.json", (rows) => {
    const r = GEN_02(rows);
    r.key = `row|${later}`;
    row(rows, 1, "head").value = later;
  });
  const state = JSON.parse(readFileSync(join(run.x2, "c-P2-02-state.json"), "utf8"));
  state[0].ledger_rows.find((x) => x.n === "02").forward = later;
  writeFileSync(join(run.x2, "c-P2-02-state.json"), `${JSON.stringify(state)}\n`);
  reindex(run.x2, "c-P2-02-state.json");
  const out = compare(run);
  assert.deepEqual(out.problems, []);
  const moved = out.results.find((r) => r.name === "x2").generated.map((g) => g.f);
  assert.ok(moved.includes("c-P2-02.json") && moved.includes("c-P2-02-state.json"), moved.join());
  // A data digest may change too, with its md5s.
  editReading(run.x2, "c-01.json", (rows) => { row(rows, 10, "digest|public.stores").value = md5("another build"); });
  assert.deepEqual(compare(run).problems.filter((p) => p.includes("c-01.json")), []);
});

test("VT-11 each other way a fixed row can move fails", async (t) => {
  const cases = [
    ["a fixed row's contents", (rows) => { const r = row(rows, 1, `row|${FIXED_FIRST}`); r.value = r.value.replace(/\|[0-9a-f]{32}\|/, `|${md5("x")}|`); }, /the fixed ledger row 20260427173246 is create_print_jobs\|/],
    ["a fixed row's name", (rows) => { const r = row(rows, 1, `row|${FIXED_FIRST}`); r.value = r.value.replace("create_print_jobs", "another_name"); }, /the fixed ledger row 20260427173246 is another_name\|/],
    ["recorded 01 at another version", (rows) => { const r = row(rows, 1, "row|20261009151706"); r.key = "row|20261009151707"; }, /the fixed ledger version 20261009151706 \(release2_01_identity_schema\) is not there/],
    ["a fixed row removed", (rows) => { rows.splice(rows.indexOf(row(rows, 1, `row|${FIXED_FIRST}`)), 1); }, /the fixed ledger version 20260427173246 .* is not there/],
  ];
  for (const [name, change, want] of cases) {
    await t.test(name, (tt) => {
      const run = fixtureRun(tt);
      editReading(run.x2, "c-P2-02.json", change);
      assert.match(compare(run).problems.join("\n"), want);
    });
  }
  await t.test("the same move stored as a difference from c-01", (tt) => {
    const run = fixtureRun(tt);
    const f = join(run.x2, "c-P2-02.json");
    const j = JSON.parse(readFileSync(f, "utf8"));
    const value = row(expand(run.x2, "c-01.json"), 1, `row|${FIXED_FIRST}`).value;
    j.drop.push([1, `row|${FIXED_FIRST}`]);
    j.set.push([1, `row|${FIXED_FIRST_MOVED}`, value]);
    const rows = expand(run.x2, "c-P2-02.json");
    writeFileSync(f, `${JSON.stringify(j)}\n`);
    const again = redigest(expand(run.x2, "c-P2-02.json"));
    for (const k of [[0, "#md5"], [1, "#md5"]]) j.set.find((s) => s[0] === k[0] && s[1] === k[1])[2] = row(again, k[0], k[1]).value;
    writeFileSync(f, `${JSON.stringify(j)}\n`);
    reindex(run.x2, "c-P2-02.json");
    assert.ok(rows.length > 0);
    assert.deepEqual(C.digestProblems(expand(run.x2, "c-P2-02.json")), []);
    assert.match(compare(run).problems.join("\n"), /the fixed ledger version 20260427173246 \(create_print_jobs\) is not there/);
  });
});

test("VT-12 a generated entry keeps its identity, chronology, count, head and contents", async (t) => {
  const P04 = "c-P2-0304.json";
  const versionOf = (rows, prefix) => ledgerRows(rows).find((r) => r.value.startsWith(prefix));
  const cases = [
    ["renamed", "c-P2-02.json", (rows) => { const r = GEN_02(rows); r.value = r.value.replace("release2_02_auth_attempts_fn", "release2_09_other"); }, /its generated ledger entries are \[release2_09_other\], not the named \[release2_02_auth_attempts_fn\]/],
    ["its contents changed", "c-P2-02.json", (rows) => { const r = GEN_02(rows); r.value = r.value.replace(/\|[0-9]+\|1\|/, "|1|1|"); }, /the generated entry 02's contents moved/],
    ["its md5 not the manifest's", "c-P2-02.json", (rows) => { const r = GEN_02(rows); r.value = r.value.replace(/\|[0-9a-f]{32}\|/, `|${md5("y")}|`); }, /has md5 [0-9a-f]{32}, not the manifest's/],
    ["two entries' order swapped", P04, (rows) => { const a = versionOf(rows, "release2_03_"), b = versionOf(rows, "release2_04_"); [a.key, b.key] = [b.key, a.key]; }, /its generated ledger entries are \[release2_02_auth_attempts_fn, release2_04_staff_session_qualify_columns, release2_03_bind_and_atomicity\]/],
    ["an unnamed extra entry", "c-P2-02.json", (rows) => { rows.push({ part: 1, key: "row|20270101000000", value: "something_else|00000000000000000000000000000000|1|1|x|true|true|true" }); row(rows, 1, "count").value = "23"; row(rows, 1, "head").value = "20270101000000"; }, /its generated ledger entries are \[release2_02_auth_attempts_fn, something_else\]/],
    ["a named entry dropped", P04, (rows) => { rows.splice(rows.indexOf(versionOf(rows, "release2_04_")), 1); row(rows, 1, "count").value = "23"; }, /its generated ledger entries are \[release2_02_auth_attempts_fn, release2_03_bind_and_atomicity\], not the named/],
    ["a count that does not follow", "c-P2-02.json", (rows) => { row(rows, 1, "count").value = "99"; }, /its ledger count is 99, not 22/],
    ["a head that is not the newest", "c-P2-02.json", (rows) => { row(rows, 1, "head").value = "20261009151706"; }, /its ledger head is 20261009151706, not its newest row/],
    ["a timestamp that is not after every fixed one", "c-P2-02.json", (rows) => { const r = GEN_02(rows); r.key = "row|20260101000000"; row(rows, 1, "head").value = "20261009151706"; }, /the generated version 20260101000000 is not after every fixed one/],
    ["a timestamp that is no date", "c-P2-02.json", (rows) => { const r = GEN_02(rows); r.key = "row|20279999999999"; row(rows, 1, "head").value = "20279999999999"; }, /the ledger key row\|20279999999999 is not a version/],
    ["another part 1 row", "c-P2-02.json", (rows) => { row(rows, 1, "columns").value = "version:text"; }, /moved outside the permitted rows: .*1\|columns/],
    ["a reading with no generated entries gains one", "c-01.json", (rows) => { rows.push({ part: 1, key: "row|20270101000000", value: "release2_02_auth_attempts_fn|734e0db7312b79081a769ca366c5b99a|6406|1|x|true|true|true" }); row(rows, 1, "count").value = "22"; row(rows, 1, "head").value = "20270101000000"; }, /its generated ledger entries are \[release2_02_auth_attempts_fn\], not the named \[\]/],
  ];
  for (const [name, f, change, want] of cases) {
    await t.test(name, (tt) => {
      const run = fixtureRun(tt);
      editReading(run.x2, f, change);
      assert.match(compare(run).problems.join("\n"), want);
    });
  }
  await t.test("a STATE fixture that does not follow its reading", (tt) => {
    const run = fixtureRun(tt);
    editReading(run.x2, "c-P2-02.json", (rows) => { const r = GEN_02(rows); r.key = "row|20270102030405"; row(rows, 1, "head").value = "20270102030405"; });
    assert.match(compare(run).problems.join("\n"), /c-P2-02-state\.json \(run\): 02's versions 20261103231448, null are not its reading's 20270102030405, null/);
  });
  await t.test("a STATE fixture naming a rollback its reading does not hold", (tt) => {
    const run = fixtureRun(tt);
    const state = JSON.parse(readFileSync(join(run.x2, "c-P2-02-state.json"), "utf8"));
    state[0].ledger_rows.find((x) => x.n === "02").rollback = "20270102030405";
    writeFileSync(join(run.x2, "c-P2-02-state.json"), `${JSON.stringify(state)}\n`);
    reindex(run.x2, "c-P2-02-state.json");
    assert.match(compare(run).problems.join("\n"), /02's versions 20261103231448, 20270102030405 are not its reading's 20261103231448, null/);
  });
  await t.test("a STATE fixture whose other fields moved", (tt) => {
    const run = fixtureRun(tt);
    const state = JSON.parse(readFileSync(join(run.x2, "c-P2-02-state.json"), "utf8"));
    state[0].catalog_state = "03";
    writeFileSync(join(run.x2, "c-P2-02-state.json"), `${JSON.stringify(state)}\n`);
    reindex(run.x2, "c-P2-02-state.json");
    assert.match(compare(run).problems.join("\n"), /c-P2-02-state\.json moved outside its ledger versions/);
  });
  await t.test("every named reading and state is in the committed set, and every generated reading is named", (tt) => {
    const run = fixtureRun(tt);
    const names = readdirSync(run.x2);
    for (const f of [...Object.keys(C.LEDGER_PATHS), ...Object.keys(C.STATE_READINGS)]) assert.ok(names.includes(f), f);
    for (const r of Object.values(C.STATE_READINGS)) assert.ok(Object.hasOwn(C.LEDGER_PATHS, r), r);
  });
});

test("VT-13 the file-level rules: bytes, digests, indexes and file sets", async (t) => {
  const edit = (dir, f, from, to) => { const p = join(dir, f); const s = readFileSync(p, "utf8"); assert.ok(s.includes(from), from); writeFileSync(p, s.split(from).join(to)); };
  const cases = [
    ["a deterministic fixture changed, its index refreshed", (run) => { edit(run.writing, "w-stop-deferrable-key.json", "buckets-arbiter", "buckets-arbitex"); reindex(run.writing, "w-stop-deferrable-key.json"); }, /writing: w-stop-deferrable-key\.json is not byte-identical to its blob, and is not a generated reading/],
    ["a reading's md5s left stale", (run) => { const rows = expand(run.x2, "c-01.json"); row(rows, 10, "digest|public.stores").value = md5("z"); writeFileSync(join(run.x2, "c-01.json"), `${JSON.stringify(rows)}\n`); reindex(run.x2, "c-01.json"); }, /c-01\.json \(run\): part 10's rows do not reproduce its md5/],
    ["a state reading moved outside its permitted rows", (run) => { const rows = expand(run.writing, "w-old-state.json"); const r = rows.find((x) => x.key === "fingerprint"); r.value = md5("q"); redigest(rows); writeFileSync(join(run.writing, "w-old-state.json"), `${JSON.stringify(rows)}\n`); reindex(run.writing, "w-old-state.json"); }, /w-old-state\.json moved outside the permitted rows/],
    ["the run's index does not match a file", (run) => { const idx = JSON.parse(readFileSync(join(run.writing, "index.json"), "utf8")); const f = Object.keys(idx.files)[0]; idx.files[f] = "0".repeat(64); writeFileSync(join(run.writing, "index.json"), JSON.stringify(idx)); }, /the run's index's sha256 of .* is not its bytes/],
    ["a file missing, its index line gone too", (run) => { rmSync(join(run.writing, "w-stop-name-varchar-1.json")); const idx = JSON.parse(readFileSync(join(run.writing, "index.json"), "utf8")); delete idx.files["w-stop-name-varchar-1.json"]; writeFileSync(join(run.writing, "index.json"), JSON.stringify(idx)); }, /only in the commit \[w-stop-name-varchar-1\.json\]/],
    ["a file the commit does not have", (run) => { writeFileSync(join(run.x2, "stray.json"), "[]\n"); }, /only in the run \[stray\.json\]/],
    ["the index's note changed", (run) => { const idx = JSON.parse(readFileSync(join(run.x2, "index.json"), "utf8")); idx.note = "another note"; writeFileSync(join(run.x2, "index.json"), JSON.stringify(idx)); }, /the two indexes' notes differ/],
  ];
  for (const [name, change, want] of cases) {
    await t.test(name, (tt) => {
      const run = fixtureRun(tt);
      change(run);
      assert.match(compare(run).problems.join("\n"), want);
    });
  }
});

// ── check-tap ────────────────────────────────────────────────────────────────────────
const TAP_COUNTS = (o = {}) => Object.entries({ tests: 3, pass: 3, fail: 0, cancelled: 0, skipped: 0, todo: 0, ...o }).map(([k, v]) => `# ${k} ${v}`).join("\n");
const tapOf = (o) => `TAP version 13\nok 1 - a\nok 2 - b\nok 3 - c\n1..3\n${TAP_COUNTS(o)}\n`;
const checkTap = (args, home) => spawnSync(process.execPath, [TOOL("check-tap.mjs"), ...args], { encoding: "utf8", env: childEnv(home), windowsHide: true });

test("VT-14 check-tap: a log passes only with every test passing", (t) => {
  const d = newDir(t);
  const file = (name, text) => { const f = join(d, name); writeFileSync(f, text); return f; };
  assert.equal(checkTap(["--file", file("good.tap", tapOf()), "--expect", "3"], d).status, 0);
  assert.equal(checkTap(["--file", file("wrong-count.tap", tapOf()), "--expect", "4"], d).status, 1);
  for (const [name, text] of [
    ["skipped", tapOf({ skipped: 1 })],
    ["todo", tapOf({ todo: 1 })],
    ["cancelled", tapOf({ cancelled: 1 })],
    ["failed", tapOf({ fail: 1, pass: 2 })],
    ["no-tests", tapOf({ tests: 0, pass: 0 })],
    ["not-ok", tapOf().replace("ok 2 - b", "not ok 2 - b")],
    ["nested-not-ok", tapOf().replace("ok 2 - b", "    not ok 1 - inner\nok 2 - b")],
    ["no-counts", "TAP version 13\nok 1 - a\n"],
    ["two-summaries", `${tapOf()}${TAP_COUNTS()}\n`],
  ]) assert.equal(checkTap(["--file", file(`${name}.tap`, text)], d).status, 1, name);
  assert.equal(checkTap([], d).status, 2);
});

test("VT-15 check-tap: the replay's states are exactly the reviewed set for the recorded state", (t) => {
  const pins = P.readPins(ROOT);
  const set = pins.replay.sets[0];
  // A synthetic tested clone: only its manifest's recorded state is read.
  const makeClone = (recorded = set.recorded) => {
    const clone = newDir(t);
    git(clone, "init", "--quiet");
    mkdirSync(join(clone, "docs", "security"), { recursive: true });
    const migrations = ["01", "02", "03", "04", "05"].map((n) => ({ n, productionVersion: recorded.applied.includes(n) ? "20261009151706" : null }));
    writeFileSync(join(clone, "docs", "security", "stage0-production-manifest.json"), JSON.stringify({ migrations, rollbackRecords: Array.from({ length: recorded.rollbackRecords }, () => ({})) }));
    git(clone, "add", "-A");
    git(clone, "commit", "--quiet", "-m", "manifest");
    return clone;
  };
  const makeReplay = (labels) => {
    const d = newDir(t);
    labels.forEach((_, i) => writeFileSync(join(d, `state-${String(i).padStart(2, "0")}.tap`), tapOf()));
    const summary = join(d, "summary.json");
    writeFileSync(summary, JSON.stringify(labels.map((label) => ({ label, sha: "0".repeat(40), code: 0, seconds: 1, tests: 3, pass: 3, fail: 0, cancelled: 0, skipped: 0, todo: 0, failed: [] }))));
    return { d, summary };
  };
  const run = (replay, clone, extra = []) => checkTap(["--replay", replay.d, "--summary", replay.summary, "--pins", TOOL("verification-pins.json"), "--clone", clone, ...extra], replay.d);
  const clone = makeClone();
  const good = makeReplay(set.states);
  const pass = run(good, clone, ["--expect", "3"]);
  assert.equal(pass.status, 0, pass.stdout + pass.stderr);
  assert.equal(run(good, clone, ["--expect", "4"]).status, 1);

  const dropped = makeReplay(set.states.slice(0, -1));
  const r1 = run(dropped, clone);
  assert.equal(r1.status, 1);
  assert.match(r1.stdout, /not the 14 reviewed states'/);
  const swapped = makeReplay([set.states[1], set.states[0], ...set.states.slice(2)]);
  const r2 = run(swapped, clone);
  assert.equal(r2.status, 1);
  assert.match(r2.stdout, /the replay's states are .* not the reviewed set/);
  const renamed = makeReplay([...set.states.slice(0, -1), "another state"]);
  assert.equal(run(renamed, clone).status, 1);

  const other = run(makeReplay(set.states), makeClone({ applied: ["01", "02"], rollbackRecords: 0 }));
  assert.equal(other.status, 1);
  assert.match(other.stdout, /no one reviewed replay-state set for the recorded state \{"applied":\["01","02"\],"rollbackRecords":0\}/);

  const failedInLog = makeReplay(set.states);
  writeFileSync(join(failedInLog.d, "state-03.tap"), tapOf({ skipped: 1 }));
  assert.equal(run(failedInLog, clone).status, 1);
  const codeInSummary = makeReplay(set.states);
  const s = JSON.parse(readFileSync(codeInSummary.summary, "utf8"));
  s[5].code = 1;
  writeFileSync(codeInSummary.summary, JSON.stringify(s));
  assert.match(run(codeInSummary, clone).stdout, /after RB-43: the suite exited 1/);
  const disagree = makeReplay(set.states);
  const s2 = JSON.parse(readFileSync(disagree.summary, "utf8"));
  s2[2].tests = 99;
  writeFileSync(disagree.summary, JSON.stringify(s2));
  assert.match(run(disagree, clone).stdout, /P2-0304: the summary says tests 99, its log 3/);
});

test("VT-16 check-isolation before and after: the per-user locations, each once, absolute and outside the tested tree; the home and cache directory as the driver makes them; the default store's path, and nothing created there", (t) => {
  const d = newDir(t);
  const home = join(d, "home"), pscache = join(d, "pscache", "ModuleAnalysisCache");
  mkdirSync(home);
  const tree = cleanTree(t);
  const guardFor = (where, name) => { const f = join(d, name); writeFileSync(f, `export const DEFAULT_STATE = ${JSON.stringify(where)};\n`); return f; };
  const iso = (args, env) => spawnSync(process.execPath, [TOOL("check-isolation.mjs"), ...args], { encoding: "utf8", env, windowsHide: true });
  const good = guardFor(join(home, ".stage0-guard"), "good.mjs");
  const before = (env, { h = home, c = pscache, g = good } = {}) => iso(["before", "--home", h, "--pscache", c, "--tree", tree, "--guard", g], env);
  const env = isolatedEnv(home, pscache);
  const pass = before(env);
  assert.equal(pass.status, 0, pass.stdout + pass.stderr);
  assert.equal(iso(["after", "--home", home], env).status, 0);
  // The default path elsewhere.
  const elsewhere = guardFor(join(d, "elsewhere", ".stage0-guard"), "elsewhere.mjs");
  assert.match(before(env, { g: elsewhere }).stdout, /not under the synthetic home/);
  // Another home.
  const other = join(d, "other");
  mkdirSync(other);
  assert.equal(iso(["after", "--home", home], childEnv(other)).status, 1);
  assert.match(before({ ...env, HOME: other, USERPROFILE: other }).stdout, /PROBLEM HOME is .*, not /);
  // A token or a session in the environment.
  for (const k of ["SUPABASE_ACCESS_TOKEN", "STAGE0_SESSION"]) assert.match(before({ ...env, [k]: "set" }).stdout, new RegExp(`${k} is set`));
  // A location elsewhere, relative, or absent.
  assert.match(before({ ...env, LOCALAPPDATA: join(d, "elsewhere") }).stdout, /PROBLEM LOCALAPPDATA is .*, not /);
  assert.match(before({ ...env, APPDATA: "AppData" }).stdout, /PROBLEM APPDATA is not absolute: AppData/);
  const noCache = { ...env };
  delete noCache.PSModuleAnalysisCachePath;
  assert.match(before(noCache).stdout, /PROBLEM PSModuleAnalysisCachePath is set under 0 spellings \(none\), not once/);
  // Two spellings of one name: Node's spawn passes one, so they arrive through bash, which keeps a
  // lower-case spelling beside the one it exports.
  const stale = { ...env, localappdata: join(tree, "stale") };
  delete stale.LOCALAPPDATA;
  const twice = spawnSync(BASH, ["-c", 'export LOCALAPPDATA="$1"; shift; exec "$@"', "bash", join(home, "AppData", "Local"), slash(process.execPath), TOOL("check-isolation.mjs"), "before", "--home", home, "--pscache", pscache, "--tree", tree, "--guard", good], { encoding: "utf8", env: stale, windowsHide: true });
  assert.match(twice.stdout, /PROBLEM LOCALAPPDATA is set under 2 spellings/, twice.stdout + twice.stderr);
  // The home or the cache file inside the tested tree, or the tested tree inside the home; the temporary directory inside it.
  const inTree = join(tree, "home");
  assert.match(before(isolatedEnv(inTree, pscache), { h: inTree }).stdout, /PROBLEM the home .* and the tested tree .* overlap/);
  const cacheInTree = join(tree, "pscache", "ModuleAnalysisCache");
  assert.match(before(isolatedEnv(home, cacheInTree), { c: cacheInTree }).stdout, /PROBLEM the cache file .* and the tested tree .* overlap/);
  const tmpInTree = join(tree, "tmp");
  assert.match(before({ ...env, TEMP: tmpInTree, TMP: tmpInTree, TMPDIR: tmpInTree }).stdout, /PROBLEM the temporary directory .* is inside the tested tree/);
  // The home or the cache directory not as the driver makes them.
  writeFileSync(join(home, "AppData", "Local", "left.txt"), "");
  assert.match(before(env).stdout, /PROBLEM .*Local holds left\.txt, not nothing/);
  rmSync(join(home, "AppData", "Local", "left.txt"));
  writeFileSync(pscache, "");
  assert.match(before(env).stdout, /PROBLEM .*pscache holds ModuleAnalysisCache, not nothing/);
  rmSync(pscache);
  assert.equal(before(env).status, 0, "the control again");
  // A guard module that will not load.
  assert.match(before(env, { g: join(d, "absent.mjs") }).stdout, /the guard module did not load/);
  // A store created during the run.
  mkdirSync(join(home, ".stage0-guard"));
  assert.match(iso(["after", "--home", home], env).stdout, /a default guard store exists/);
  assert.equal(before(env).status, 1);
  assert.equal(iso([], env).status, 2);
  assert.equal(iso(["before", "--home", home, "--guard", good], env).status, 2, "before names its cache file and tree");
});

test("VT-21 powershell-before: with the driver's locations, a PowerShell in the tested tree puts its cache at the synthetic file and nothing in the tree; with the locations before VT3 it writes the cache into the tree, as the old clones show, and is refused", { skip: !WIN && "Windows only: elsewhere no PowerShell is started", timeout: 180000 }, async (t) => {
  const d = newDir(t);
  const run = (env, tree, pscache) => new Promise((done) => {
    const p = spawn(process.execPath, [TOOL("check-isolation.mjs"), "powershell", "--pscache", pscache, "--tree", tree], { env, windowsHide: true });
    let out = "";
    p.stdout.on("data", (x) => { out += x; });
    p.stderr.on("data", (x) => { out += x; });
    p.on("exit", (code) => done({ code, out }));
  });
  // The driver's locations.
  const homeA = join(d, "a-home"), cacheA = join(d, "a-pscache", "ModuleAnalysisCache"), treeA = cleanTree(t);
  // Before VT3: a synthetic home with no AppData\Local, the parent's LOCALAPPDATA and APPDATA, no cache path.
  const homeB = join(d, "b-home"), cacheB = join(d, "b-pscache", "ModuleAnalysisCache"), treeB = cleanTree(t);
  mkdirSync(homeB);
  mkdirSync(dirname(cacheB));
  const old = childEnv(homeB);
  for (const k of Object.keys(old)) if (/^PSModuleAnalysisCachePath$/i.test(k)) delete old[k];
  const [a, b] = await Promise.all([run(isolatedEnv(homeA, cacheA), treeA, cacheA), run(old, treeB, cacheB)]);
  assert.equal(a.code, 0, a.out);
  assert.ok(existsSync(cacheA), a.out);
  assert.match(a.out, /its cache location .*a-pscache.ModuleAnalysisCache;/i, a.out);
  assert.equal(git(treeA, "status", "--porcelain", "--untracked-files=all", "--ignored=matching"), "", "nothing in the tree");
  assert.equal(b.code, 1, b.out);
  assert.match(b.out, /PROBLEM PowerShell's cache location is relative \(Microsoft\\Windows\\PowerShell\\ModuleAnalysisCache\)/, b.out);
  assert.match(b.out, /PROBLEM PowerShell wrote no cache at /);
  assert.match(b.out, /PROBLEM PowerShell left the tested tree changed: \?\? Microsoft\/Windows\/PowerShell\/ModuleAnalysisCache/);
  assert.ok(existsSync(join(treeB, "Microsoft", "Windows", "PowerShell", "ModuleAnalysisCache")), "the old placement, reproduced");
});

test("VT-22 tree-after: the tested tree and the replay's checkouts as checked out, but for the driver's own ignored outputs, and no PowerShell per-user file anywhere, ignored directories included", (t) => {
  const tree = cleanTree(t, { ignore: true });
  const home = newDir(t);
  const check = () => spawnSync(process.execPath, [TOOL("check-isolation.mjs"), "tree", "--tree", tree], { encoding: "utf8", env: childEnv(home), windowsHide: true });
  const passes = () => { const r = check(); assert.equal(r.status, 0, r.stdout + r.stderr); return r.stdout; };
  const fails = (re) => { const r = check(); assert.equal(r.status, 1, r.stdout + r.stderr); assert.match(r.stdout, re); };
  assert.match(passes(), /0 replay checkout\(s\) read/);
  // The driver's own outputs, and a replay checkout as checked out.
  for (const f of ["node_modules/pkg/index.js", "dist/index.html", ".stage0-replay/state-00.tap", ".stage0-replay-summary.json"]) { mkdirSync(dirname(join(tree, f)), { recursive: true }); writeFileSync(join(tree, f), "x"); }
  const state = join(tree, ".stage0-replay", "state-00");
  mkdirSync(state);
  git(state, "init", "--quiet");
  writeFileSync(join(state, "b.txt"), "b\n");
  git(state, "add", "-A");
  git(state, "commit", "--quiet", "-m", "a replay state");
  assert.match(passes(), /1 replay checkout\(s\) read/);
  const ps = ["Microsoft", "Windows", "PowerShell"];
  // What PowerShell left before VT3, at the top: untracked, and a per-user file.
  mkdirSync(join(tree, ...ps), { recursive: true });
  writeFileSync(join(tree, ...ps, "ModuleAnalysisCache"), "x");
  fails(/PROBLEM the tested tree changed: \?\? Microsoft\/Windows\/PowerShell\/ModuleAnalysisCache/);
  fails(/PROBLEM a PowerShell per-user file is in the tested tree: .*ModuleAnalysisCache/);
  rmSync(join(tree, "Microsoft"), { recursive: true });
  // The same in a replay checkout, which the tested tree's own status cannot see.
  mkdirSync(join(state, ...ps), { recursive: true });
  writeFileSync(join(state, ...ps, "ModuleAnalysisCache"), "x");
  fails(/PROBLEM the replay checkout state-00 changed: \?\? Microsoft\/Windows\/PowerShell\/ModuleAnalysisCache/);
  rmSync(join(state, "Microsoft"), { recursive: true });
  // A per-user file in an ignored directory, which no status shows.
  writeFileSync(join(tree, "node_modules", "StartupProfileData-NonInteractive"), "x");
  fails(/PROBLEM a PowerShell per-user file is in the tested tree: .*node_modules.StartupProfileData-NonInteractive/);
  rmSync(join(tree, "node_modules", "StartupProfileData-NonInteractive"));
  // A tracked file changed, and an ignored entry the driver does not make.
  writeFileSync(join(tree, "a.txt"), "changed\n");
  fails(/PROBLEM the tested tree changed:  M a\.txt/);
  git(tree, "checkout", "--", "a.txt");
  writeFileSync(join(tree, "run.log"), "x");
  fails(/PROBLEM the tested tree holds an ignored entry the driver does not make: run\.log/);
  rmSync(join(tree, "run.log"));
  assert.match(passes(), /1 replay checkout\(s\) read/, "the control again");
  // Not a checkout.
  const r = spawnSync(process.execPath, [TOOL("check-isolation.mjs"), "tree", "--tree", newDir(t)], { encoding: "utf8", env: childEnv(home), windowsHide: true });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /PROBLEM git did not read the tested tree/);
});

test("VT-23 a stand-in put on PATH is executable and is what a PATH search runs; on POSIX a stand-in without its execute bit is passed over, as on Netlify, and stubsOnPath refuses it by name", (t) => {
  const dir = newDir(t), mark = join(newDir(t), "called.txt");
  const stub = pathStub(dir, "vt23stub", `#!/usr/bin/env bash\necho "ran $*" >> "${mark}"\n`);
  if (!WIN) assert.equal(statSync(stub).mode & 0o777, 0o755, "written executable");
  const env = stubsOnPath(childEnv(newDir(t)), dir);
  const r = spawnSync(BASH, ["-c", "vt23stub probe"], { encoding: "utf8", env, windowsHide: true });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(readFileSync(mark, "utf8"), "ran probe\n", "bash's PATH search ran the stand-in");
  // The rig every driver test uses puts its stand-in on PATH through the same two helpers.
  const src = jsCode(readFileSync(join(ROOT, "scripts", "tests", "verify-tooling.test.js"), "utf8"), { label: "verify-tooling.test.js" });
  const rig = src.slice(src.indexOf("function verifyRig("), src.indexOf("const AFTER_ISOLATION"));
  assert.ok(rig.includes("pathStub(stubs, \"yarn\"") && rig.includes("stubsOnPath(childEnv(out), stubs)"), "verifyRig writes and places its stand-in through the helpers");
  if (WIN) { t.diagnostic("Windows: Git for Windows' bash runs a #! file without an execute bit, so the POSIX half is not observable here"); return; }
  // POSIX: the same stand-in written as VT-18 wrote it before VT3, with no execute bit.
  const bare = newDir(t), mark2 = join(newDir(t), "called.txt");
  writeFileSync(join(bare, "vt23stub"), `#!/usr/bin/env bash\necho "ran" >> "${mark2}"\n`, { mode: 0o644 });
  chmodSync(join(bare, "vt23stub"), 0o644);
  const raw = { ...childEnv(newDir(t)), PATH: `${bare}:${process.env.PATH}` };
  const r2 = spawnSync(BASH, ["-c", "vt23stub probe"], { encoding: "utf8", env: raw, windowsHide: true });
  assert.notEqual(r2.status, 0, "the PATH search passed over it");
  assert.equal(existsSync(mark2), false, "and it never ran");
  assert.throws(() => stubsOnPath(childEnv(newDir(t)), bare), /vt23stub in .* is not executable \(mode 644\): a POSIX PATH search would pass over it/);
});
