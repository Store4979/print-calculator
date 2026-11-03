// scripts/tests/stage0-guard.launch.test.js — no test falls back to the real
// guard store (guarded-send procedure §7.2: Codex's review of 4037d12, and
// Ryan's ruling on ORD, 2026-11-03). stage0-guard-launch-check.mjs reads every
// .js and .mjs file under scripts/tests from its parsed source:
//   LN-1  the tree: no finding; every child-process launch is git, a launch
//         with env: syntheticHomeEnv(…), or one of EXCEPTIONS (each reviewed,
//         with what it starts, and each still present); only the READERS
//         (ORD, ORD-S) name the default store path, in their children's code
//   LN-2  the check finds each violating form, including each of this
//         round's fixes undone in its real file, and passes the allowed ones
//   LN-3  syntheticHomeEnv refuses a home outside the temporary directory
//         (making nothing) and this process's home, drops what it is told
//         to, and sets both home variables; the guard's default store path
//         is built from os.homedir(), which is what a synthetic home moves
// It is a regression gate over the tests' own code, not a sandbox.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync, mkdtempSync, rmSync, realpathSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join, relative, sep } from "node:path";
import { Parser } from "acorn";
import { launchFindings, CHILD_PROCESS as CP, DEFAULT_NAME as DS } from "./stage0-guard-launch-check.mjs";
import { ROOT, syntheticHomeEnv } from "./stage0-guard-fixture.mjs";

const rel = (p) => relative(ROOT, p).split(sep).join("/");
const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => { const p = join(d, e.name); return e.isDirectory() ? walk(p) : /\.m?js$/.test(e.name) ? [p] : []; });

/**
 * The reviewed launches that are neither git nor a synthetic home. Each is
 * keyed "<file> <test id or function> <launcher> <program>"; none may sit in a
 * test, or a file, that names a guard command line (the check refuses that).
 */
const EXCEPTIONS = [
  ["scripts/tests/build-env-bundle.test.js runGuard execFileSync process.execPath", "scripts/check-build-env.mjs, under a stated minimal environment; it loads no guard module"],
  ["scripts/tests/inject-sw-manifest.test.js run execFileSync process.execPath", "scripts/inject-sw-manifest.mjs on a scratch dist; it loads no guard module"],
  ["scripts/tests/release2-deploy-context.test.js runWriter execFileSync process.execPath", "scripts/write-deploy-context.mjs; it loads no guard module"],
  ["scripts/tests/release2-inventory.rollback.test.js realInventoryFile spawnSync process.execPath", "release2-inventory.test.js on a fixture root; it loads no guard module"],
  ["scripts/tests/replay/stage0-record-replay.test.js runSuite spawn process.execPath", "the whole suite in a replay clone; every launch and command-line call in that suite is under this check"],
  ["scripts/tests/stage0-classify.test.js CL-17 spawnSync process.execPath", "the classifier's and the capture checker's command lines; neither loads the guard module"],
  ["scripts/tests/stage0-classify.test.js CL-19 spawnSync process.execPath", "the classifier's and the capture checker's command lines; neither loads the guard module"],
  ["scripts/tests/stage0-classify.test.js CL-23 spawnSync process.execPath", "the capture checker's command line; it loads no guard module"],
  ["scripts/tests/stage0-guard.lock.test.js lifetime spawn process.execPath", "HL-1's probe: it calls the fixture's releaseTogether, whose workers get a synthetic home, on workers that touch no store"],
  ["scripts/tests/stage0-guard.shell.test.js window spawn POWERSHELL", "G-27's real PowerShell windows; the probe in them works on the fixture store named by S0_STATE and runs no command line"],
  ["scripts/tests/stage0-guard.shell.test.js G-27b spawn process.execPath", "shellIdentity alone; no store"],
  ["scripts/tests/stage0-guard.store.test.js ST-1b spawn process.execPath", "three concurrent initStore calls, each on the fixture's explicit S0_STATE"],
  ["scripts/tests/stage0-guard.target.test.js TG-6 spawn process.execPath", "the WRITER: addTarget on statePaths(c.stateDir), the fixture's store"],
  ["scripts/tests/stage0-manifest.lifecycle.test.js LC-5 execFileSync process.execPath", "stage0-manifest-generate.mjs in a scratch clone; it loads the guard module for its chain entries only, never a store"],
];

/**
 * The tests whose strings may name the default store path: ORD's child
 * reports it, and ORD-S's copied command lines read it, each under a
 * synthetic home (Codex's review of 7168fc0). Every launch in each must set
 * env: syntheticHomeEnv(…).
 */
const READERS = ["scripts/tests/stage0-guard.store.test.js ORD", "scripts/tests/stage0-guard.store.test.js ORD-S"];

/** The check over the real tree, optionally with one file's source replaced. */
function checkTree(replace = {}) {
  const exceptions = new Set(EXCEPTIONS.map(([k]) => k));
  const readers = new Set(READERS);
  const seen = new Set();
  const seenReaders = new Set();
  const findings = [];
  const launches = [];
  for (const p of walk(join(ROOT, "scripts", "tests"))) {
    const file = rel(p);
    const src = Object.hasOwn(replace, file) ? replace[file] : readFileSync(p, "utf8");
    const r = launchFindings(src, { file, exceptions, seen, readers, seenReaders });
    findings.push(...r.findings);
    launches.push(...r.launches);
  }
  return { findings, launches, unseen: [...exceptions].filter((k) => !seen.has(k)), unseenReaders: READERS.filter((k) => !seenReaders.has(k)) };
}

test("LN-1 no test falls back to the real store: every launch is git, a synthetic home or a reviewed exception, every command line's main() names a state directory, and only ORD and ORD-S name the default store path, in code their synthetic-home children run", () => {
  const { findings, launches, unseen, unseenReaders } = checkTree();
  assert.deepEqual(findings, [], "no finding");
  assert.deepEqual(unseen, [], "every exception is still a launch in the tree");
  assert.deepEqual(unseenReaders, [], "every reader test still names the default store path");
  for (const [k, why] of EXCEPTIONS) assert.ok(why.length > 20, `${k}: a reason`);
  const by = (kind) => launches.filter((l) => l.kind === kind);
  assert.ok(by("git").length >= 10, "the git launches are read");
  assert.deepEqual(by("synthetic home").map((l) => l.file).sort(), [
    "scripts/tests/stage0-guard-fixture.mjs", "scripts/tests/stage0-guard-fixture.mjs",
    "scripts/tests/stage0-guard.store.test.js", "scripts/tests/stage0-guard.store.test.js",
  ], "the fixture's releaseTogether and holder, and ORD's probe and command lines");
  assert.equal(launches.length, by("git").length + by("synthetic home").length + by("exception").length, "every launch is classified");
});

const FIX = "./stage0-guard-fixture.mjs";
/** One synthetic file per case: [label, file, source, finding pattern, exceptions]. */
const NEG = [
  ["a node launch with no env", "scripts/tests/n1.test.js", `import { spawnSync } from "node:${CP}";\nspawnSync(process.execPath, ["x.mjs"]);\n`, /neither git nor env: syntheticHomeEnv/],
  ["env: process.env", "scripts/tests/n2.test.js", `import { spawnSync } from "node:${CP}";\nspawnSync(process.execPath, ["x.mjs"], { env: process.env });\n`, /neither git nor env: syntheticHomeEnv/],
  ["a spread after the helper's env", "scripts/tests/n3.test.js", `import { spawnSync } from "node:${CP}";\nimport { syntheticHomeEnv } from "${FIX}";\nspawnSync(process.execPath, ["x.mjs"], { env: syntheticHomeEnv(h), ...o });\n`, /neither git nor env: syntheticHomeEnv/],
  ["a helper of the same name from elsewhere", "scripts/tests/n4.test.js", `import { spawnSync } from "node:${CP}";\nimport { syntheticHomeEnv } from "./elsewhere.mjs";\nspawnSync(process.execPath, ["x.mjs"], { env: syntheticHomeEnv(h) });\n`, /neither git nor env: syntheticHomeEnv/],
  ["an exception in a test that names a command line", "scripts/tests/n5.test.js", `import { spawnSync } from "node:${CP}";\ntest("ZZ-1 runs it", () => { spawnSync(process.execPath, [join("scripts", "manual", "stage0-go.mjs")]); });\n`, /test ZZ-1 names a guard command line/, ["scripts/tests/n5.test.js ZZ-1 spawnSync process.execPath"]],
  ["an exception outside a test, in a file that names one", "scripts/tests/n6.test.js", `import { spawnSync } from "node:${CP}";\nconst W = "stage0-window.mjs";\nfunction go() { return spawnSync(process.execPath, ["x.mjs"]); }\n`, /this file names a guard command line/, ["scripts/tests/n6.test.js go spawnSync process.execPath"]],
  ["a shared module's launcher of what its callers pass", "scripts/tests/n7-helper.mjs", `import { spawn } from "node:${CP}";\nexport function launch({ script }) { return spawn(process.execPath, [script]); }\n`, /launch starts what its callers pass \(script\)/],
  ["a namespace import", "scripts/tests/n8.test.js", `import * as cp from "node:${CP}";\n`, /is imported whole/],
  ["a dynamic import", "scripts/tests/n9.test.js", `const cp = await import("node:${CP}");\n`, /is imported dynamically/],
  ["an alias", "scripts/tests/n10.test.js", `import { spawnSync } from "node:${CP}";\nconst run = spawnSync;\n`, /spawnSync is used as a value/],
  ["code in a string that starts processes", "scripts/tests/n11.test.js", `writeFileSync(f, "import { spawn } from 'node:${CP}';");\n`, /a string names/],
  ["the default store path", "scripts/tests/n12.test.js", `import * as G from "../manual/stage0-guard.mjs";\nconst p = G.statePaths(G.${DS});\n`, /is the real store's path/],
  ["the default store path in embedded code", "scripts/tests/n13.test.js", `const W = \`const p = G.${DS};\`;\n`, /a string names .*outside a listed reader test/],
  ["the default store path in a reader test with a launch that is not a synthetic home", "scripts/tests/n13b.test.js", `import { spawnSync } from "node:${CP}";\ntest("ZZ-4 reads", () => { const W = "G.${DS}"; spawnSync(process.execPath, ["x.mjs"], { env: process.env }); });\n`, /in test ZZ-4, which starts a process without env: syntheticHomeEnv/, [], ["scripts/tests/n13b.test.js ZZ-4"]],
  ["the default store path in an unlisted test, though its launches are synthetic", "scripts/tests/n13c.test.js", `import { spawnSync } from "node:${CP}";\nimport { syntheticHomeEnv } from "${FIX}";\ntest("ZZ-5 reads", () => { const W = "G.${DS}"; spawnSync(process.execPath, ["x.mjs"], { env: syntheticHomeEnv(h) }); });\n`, /outside a listed reader test/],
  ["a command line's main() with no stateDir", "scripts/tests/n14.test.js", `import * as GO from "../manual/stage0-go.mjs";\nGO.main(["status", "--target", "production"], {}, { root: R });\n`, /main\(\) without a stateDir/],
  ["deps that resolve to an object with no stateDir", "scripts/tests/n15.test.js", `import * as WIN from "../manual/stage0-window.mjs";\nconst deps = { root: R };\nWIN.main(["close"], {}, { ...deps, ppid: 1 });\n`, /main\(\) without a stateDir/],
  ["--dry-run excuses only the sender", "scripts/tests/n16.test.js", `import { main } from "../manual/stage0-go.mjs";\nmain(["status", "--dry-run"], {}, {});\n`, /main\(\) without a stateDir/],
  ["the sender's live path with no stateDir", "scripts/tests/n17.test.js", `import { main } from "../manual/stage0-send.mjs";\nmain(["P0", "--target", "production"], {}, { stdout });\n`, /main\(\) without a stateDir/],
  ["guardedSend with no stateDir", "scripts/tests/n18.test.js", `import * as G from "../manual/stage0-guard.mjs";\nawait G.guardedSend({ plan, goId });\n`, /guardedSend without a stateDir/],
  ["a command line imported by default", "scripts/tests/n19.test.js", `import GO from "../manual/stage0-go.mjs";\n`, /imported by default/],
];
const POS = [
  ["git", "scripts/tests/p1.test.js", `import { execFileSync } from "node:${CP}";\nexecFileSync("git", ["status"], { cwd: d });\n`],
  ["the fixture's helper, with dropped variables", "scripts/tests/p2.test.js", `import { spawnSync } from "node:${CP}";\nimport { syntheticHomeEnv } from "${FIX}";\ntest("ZZ-2 runs stage0-send.mjs", () => { spawnSync(process.execPath, [join("scripts", "manual", "stage0-send.mjs")], { cwd: d, env: syntheticHomeEnv(h, { NODE_OPTIONS: undefined }) }); });\n`],
  ["a listed exception in a test that names no command line", "scripts/tests/p3.test.js", `import { spawnSync } from "node:${CP}";\ntest("ZZ-3 classifies", () => { spawnSync(process.execPath, ["stage0-classify.mjs"]); });\n`, ["scripts/tests/p3.test.js ZZ-3 spawnSync process.execPath"]],
  ["deps with a stateDir, directly and through a spread const", "scripts/tests/p4.test.js", `import * as GO from "../manual/stage0-go.mjs";\nconst base = { stateDir: s };\nGO.main(["status"], {}, { root: R, stateDir: s });\nGO.main(["status"], {}, { ...base, root: R });\n`],
  ["the sender's --dry-run, on both sides of a condition", "scripts/tests/p5.test.js", `import { main } from "../manual/stage0-send.mjs";\nconst argv = c ? ["P0", "--dry-run"] : ["P1", "--target", "staging", "--dry-run"];\nmain(argv, {}, { stdout });\n`],
  ["guardedSend with a stateDir", "scripts/tests/p6.test.js", `import * as G from "../manual/stage0-guard.mjs";\nawait G.guardedSend({ plan, stateDir, ...over });\n`],
  ["the default store path in a listed reader test whose launches are all synthetic", "scripts/tests/p8.test.js", `import { spawnSync } from "node:${CP}";\nimport { syntheticHomeEnv } from "${FIX}";\ntest("ZZ-6 reads", () => { spawnSync(process.execPath, ["-e", "const G = await import(u); process.stdout.write(G.${DS});"], { env: syntheticHomeEnv(h) }); });\n`, [], ["scripts/tests/p8.test.js ZZ-6"]],
  ["a violating launch in a comment, and names that are not calls", "scripts/tests/p7.test.js", `import { execFileSync } from "node:${CP}";\n// execFileSync(process.execPath, ["stage0-go.mjs"]);\n/* G.${DS} */\nconst m = /x/.exec(s);\nconst o = { execFileSync: 1 };\no.execFileSync = 2;\n`],
];

test("LN-2 the check finds each violating form, and each of this round's fixes undone in its real file; it passes the allowed forms", () => {
  for (const [label, file, src, re, exc = [], rd = []] of NEG) {
    const r = launchFindings(src, { file, exceptions: new Set(exc), readers: new Set(rd) });
    assert.ok(r.findings.some((f) => re.test(f)), `${label}: found (${JSON.stringify(r.findings)})`);
  }
  for (const [label, file, src, exc = [], rd = []] of POS) {
    const seen = new Set();
    const seenReaders = new Set();
    const r = launchFindings(src, { file, exceptions: new Set(exc), seen, readers: new Set(rd), seenReaders });
    assert.deepEqual(r.findings, [], `${label}: no finding`);
    assert.deepEqual([...seen], exc, `${label}: the exception is used`);
    assert.deepEqual([...seenReaders], rd, `${label}: the reader is used`);
  }
  // The real files, each with this round's fix undone.
  const real = (f) => readFileSync(join(ROOT, f), "utf8");
  const undo = [
    ["ORD's command lines without the synthetic home", "scripts/tests/stage0-guard.store.test.js", "env: syntheticHomeEnv(home, { ...ORD_CLEAN, ...extra })", "env: { ...process.env, ...extra }", /this file names a guard command line/],
    ["ORD's default-path probe without it", "scripts/tests/stage0-guard.store.test.js", "env: syntheticHomeEnv(home, ORD_CLEAN), encoding", "env: process.env, encoding", /in test ORD, which starts a process without env: syntheticHomeEnv/],
    ["the fixture's releaseTogether without it", "scripts/tests/stage0-guard-fixture.mjs", "windowsHide: true, env: syntheticHomeEnv(join(dir, \"home\")) });\n    const w = ", "windowsHide: true });\n    const w = ", /this file names a guard command line/],
    ["SEND-4 without its state directory", "scripts/tests/stage0-send.test.js", "{ fetchImpl: noFetch, stdout: () => {}, stateDir: NO_STORE }), /SUPABASE_ACCESS_TOKEN is not set", "{ fetchImpl: noFetch, stdout: () => {} }), /SUPABASE_ACCESS_TOKEN is not set", /main\(\) without a stateDir/],
  ];
  for (const [label, file, from, to, re] of undo) {
    const src = real(file).replace(/\r\n/g, "\n");
    assert.ok(src.includes(from), `${label}: the fix is in ${file}`);
    const { findings } = checkTree({ [file]: src.replace(from, to) });
    assert.ok(findings.some((f) => re.test(f)), `${label}: found (${JSON.stringify(findings)})`);
  }
});

test("LN-3 syntheticHomeEnv refuses a home outside the temporary directory (making nothing) and this process's home, drops what it is told to and sets both home variables; the guard's default store path is built from os.homedir()", () => {
  const outside = join(ROOT, `.s0-not-a-home-${process.pid}`);
  assert.throws(() => syntheticHomeEnv(outside), /a synthetic home lies inside/);
  assert.equal(existsSync(outside), false, "nothing made outside the temporary directory");
  assert.throws(() => syntheticHomeEnv(homedir()), /a synthetic home lies inside|neither this process's home/);
  const dir = mkdtempSync(join(tmpdir(), "s0-home-"));
  try {
    const home = join(dir, "home");
    const env = syntheticHomeEnv(home, { NODE_OPTIONS: undefined, S0_EXTRA: "1" });
    const h = realpathSync.native(home);
    assert.equal(env.USERPROFILE, h);
    assert.equal(env.HOME, h);
    assert.equal(Object.keys(env).filter((k) => /^(USERPROFILE|HOME)$/i.test(k)).length, 2, "one of each, whatever their case was");
    assert.ok(!("NODE_OPTIONS" in env), "dropped");
    assert.equal(env.S0_EXTRA, "1");
    assert.equal(env.PATH ?? env.Path, process.env.PATH ?? process.env.Path, "the rest is this process's");
    assert.notEqual(h.toLowerCase(), realpathSync.native(homedir()).toLowerCase());
  } finally { rmSync(dir, { recursive: true, force: true }); }
  // The guard's default store path: join(homedir(), ".stage0-guard"), exported. A synthetic home moves it.
  const ast = Parser.parse(readFileSync(join(ROOT, "scripts", "manual", "stage0-guard.mjs"), "utf8"), { ecmaVersion: "latest", sourceType: "module" });
  const decl = ast.body.filter((n) => n.type === "ExportNamedDeclaration" && n.declaration && n.declaration.type === "VariableDeclaration")
    .flatMap((n) => n.declaration.declarations).filter((d) => d.id.name === DS);
  assert.equal(decl.length, 1, "one exported declaration");
  const init = decl[0].init;
  assert.ok(init.type === "CallExpression" && init.callee.name === "join" && init.arguments.length === 2, "join(…, …)");
  assert.ok(init.arguments[0].type === "CallExpression" && init.arguments[0].callee.name === "homedir" && init.arguments[0].arguments.length === 0, "from os.homedir()");
  assert.equal(init.arguments[1].value, ".stage0-guard");
  const imports = ast.body.filter((n) => n.type === "ImportDeclaration" && n.source.value === "node:os").flatMap((n) => n.specifiers.map((s) => [s.imported.name, s.local.name]));
  assert.ok(imports.some(([a, b]) => a === "homedir" && b === "homedir"), "homedir is node:os's");
});
