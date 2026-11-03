// scripts/tests/stage0-guard.launch.test.js — the synthetic home that the
// tests give a child process which could run a guard command line
// (guarded-send procedure §7.2: Codex's reviews of 7168fc0 and d160c6e, and
// Ryan's ruling on ORD, 2026-11-03).
//   LN-3  syntheticHomeEnv refuses a home outside the temporary directory
//         (making nothing) and this process's home, drops what it is told
//         to, and sets both home variables; the guard's default store path
//         is built from os.homedir(), which is what a synthetic home moves
// ORD and ORD-S (stage0-guard.store.test.js) show the effect in real child
// processes. LN-1 and LN-2, a whole-tree static launch check, were removed
// in X1c: Ryan deferred that check to separate work (Codex's LN-R1 and
// LN-R2, review of d160c6e; the item 4(c) plan's open items).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, mkdtempSync, rmSync, realpathSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { Parser } from "acorn";
import { ROOT, syntheticHomeEnv } from "./stage0-guard-fixture.mjs";

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
    .flatMap((n) => n.declaration.declarations).filter((d) => d.id.name === "DEFAULT_STATE");
  assert.equal(decl.length, 1, "one exported declaration");
  const init = decl[0].init;
  assert.ok(init.type === "CallExpression" && init.callee.name === "join" && init.arguments.length === 2, "join(…, …)");
  assert.ok(init.arguments[0].type === "CallExpression" && init.arguments[0].callee.name === "homedir" && init.arguments[0].arguments.length === 0, "from os.homedir()");
  assert.equal(init.arguments[1].value, ".stage0-guard");
  const imports = ast.body.filter((n) => n.type === "ImportDeclaration" && n.source.value === "node:os").flatMap((n) => n.specifiers.map((s) => [s.imported.name, s.local.name]));
  assert.ok(imports.some(([a, b]) => a === "homedir" && b === "homedir"), "homedir is node:os's");
});
