// scripts/tests/stage0-guard.shell.test.js — Codex item 6, SG-3, through real
// Windows processes: the window marker binds the PowerShell process that
// started node, as Windows itself reports it (pid, image, creation time), and
// not anything in the environment.
//
//   G-27 window A opens a marker and is issued a go. A child shell started
//        from A inherits A's STAGE0_SESSION value and (synthetic) token, and
//        is refused with no request; A itself is then admitted. A's own
//        command run through a node.cmd shim (as `yarn run` puts one first
//        on PATH) is refused: node's parent is then cmd.exe. After A exits,
//        a new window given the same session value and token is refused.
//   G-27b the identity query writes nothing to its caller's stderr, so no
//        PowerShell progress record reaches Ryan's window.
//
// The PowerShell processes, their parent links and Windows' report on them
// are real; the clock, HEAD, the guard state and fetch are the test's own
// (stage0-guard-fixture.mjs), so no real token and no network are involved.
// Windows only: elsewhere the guarded tools refuse to run at all.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { ROOT, TOKEN, nonce } from "./stage0-guard-fixture.mjs";

const PROBE = `
import { appendFileSync, readFileSync, existsSync, writeFileSync } from "node:fs";
const F = await import(process.env.S0_FIXTURE);
const G = await import(process.env.S0_GUARD);
const [mode, goId] = process.argv.slice(2);
const wf = { t: F.synthWorkflow("production", { X: [["S1", "STATE"], ["S2", "P0"]] }) };
const fx = F.fixture({ workflows: wf, t0: Date.now(), identity: G.shellIdentity, attach: { stateDir: process.env.S0_STATE, results: process.env.S0_RESULTS } });
const phaseFile = process.env.S0_STATE + "/phase-id.txt";
const say = (o) => process.stdout.write(JSON.stringify({ mode, ppid: process.ppid, ...o }) + "\\n");
try {
  if (mode === "setup") {
    fx.clock();
    const ph = fx.phase("t", "X");
    writeFileSync(phaseFile, ph.phaseId);
    const r = G.openMarker({ paths: fx.paths, manifest: F.M, phaseId: ph.phaseId, role: "R", env: process.env, head: F.HEAD, checkout: F.ROOT, now: fx.now(), identity: G.shellIdentity, ppid: process.ppid, selfStartMs: Date.now() - process.uptime() * 1000, workflows: { ...G.WORKFLOWS, ...wf } });
    say({ ok: true, marker: { pid: r.marker.shell.pid, image: r.marker.shell.image, created: r.marker.shell.created } });
  } else if (mode === "issue") {
    const g = fx.issue(readFileSync(phaseFile, "utf8"), process.argv[3]);
    say({ ok: true, goId: g.goId });
  } else {
    const fetchImpl = async () => { appendFileSync(process.env.S0_CALLS, "1\\n"); return new Response("[]", { status: 201 }); };
    const text = goId && JSON.parse(readFileSync(process.env.S0_STATE + "/gos/" + goId + ".json", "utf8")).text;
    const r = await fx.send(G, { text, target: "production", win: { env: process.env, pid: process.ppid }, goId, over: { fetchImpl } });
    say({ ok: true, step: r.record.guard.step });
  }
} catch (e) { say({ ok: false, name: e.constructor.name, message: e.message }); }
`;

const POWERSHELL = join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
const encoded = (s) => Buffer.from(s, "utf16le").toString("base64");

/** Run a PowerShell window with `env`; resolves to { pid, out, err, code }, its stdout and stderr kept apart. */
function window(script, env) {
  return new Promise((resolve) => {
    const p = spawn(POWERSHELL, ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded(script)], { env, windowsHide: true });
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => { out += d; });
    p.stderr.on("data", (d) => { err += d; });
    p.on("exit", (code) => resolve({ pid: p.pid, out, err, code }));
  });
}
const lines = (out) => out.split(/\r?\n/).filter((l) => l.startsWith('{"mode"')).map((l) => JSON.parse(l));
const shown = (w) => JSON.stringify({ out: w.out, err: w.err.slice(0, 2000), code: w.code });

test("G-27 SG-3, real windows: a child shell inheriting the session value and token is refused with no request; the window itself is admitted, but not through a node.cmd shim; a new window after it closes is refused", { skip: process.platform !== "win32" && "the guarded tools bind PowerShell windows and run only on Windows", timeout: 300000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "s0-shell-"));
  try {
    const probe = join(dir, "probe.mjs");
    writeFileSync(probe, PROBE);
    const calls = join(dir, "calls.txt");
    writeFileSync(calls, "");
    // A node.cmd shim, as `yarn run` puts first on PATH (%TEMP%\yarn--<id>\node.cmd):
    // through it, node's parent is cmd.exe, not the window.
    const shim = join(dir, "shim");
    mkdirSync(shim);
    writeFileSync(join(shim, "node.cmd"), `@"${process.execPath}" %*\r\n`);
    const env = {
      ...process.env,
      S0_NODE: process.execPath, S0_SHIM: shim,
      S0_PROBE: probe, S0_STATE: join(dir, "state"), S0_RESULTS: join(dir, "results"), S0_CALLS: calls,
      S0_FIXTURE: pathToFileURL(join(ROOT, "scripts", "tests", "stage0-guard-fixture.mjs")).href,
      S0_GUARD: pathToFileURL(join(ROOT, "scripts", "manual", "stage0-guard.mjs")).href,
      STAGE0_SESSION: nonce(42), SUPABASE_ACCESS_TOKEN: TOKEN,
    };
    delete env.NODE_OPTIONS;
    // node.exe itself is named, so the result does not depend on what PATH
    // holds when the suite runs (under `yarn test` it starts with yarn's shim).
    const A = await window([
      "$ProgressPreference = 'SilentlyContinue'",
      "& $env:S0_NODE $env:S0_PROBE setup",
      "$issued = & $env:S0_NODE $env:S0_PROBE issue S1",
      "$issued",
      "$go = ($issued | ConvertFrom-Json).goId",
      // A child shell started from this window inherits its environment.
      "powershell.exe -NoProfile -NonInteractive -Command \"`$ProgressPreference = 'SilentlyContinue'; & `$env:S0_NODE `$env:S0_PROBE send $go\"",
      "& $env:S0_NODE $env:S0_PROBE send $go",
      "$issued2 = & $env:S0_NODE $env:S0_PROBE issue S2",
      "$issued2",
      "$go2 = ($issued2 | ConvertFrom-Json).goId",
      // The same window, through a node.cmd shim.
      "$env:PATH = $env:S0_SHIM + ';' + $env:PATH",
      "node $env:S0_PROBE send $go2",
    ].join("\n"), env);
    const out = lines(A.out);
    const [setup, issued, child, self, issued2, shimmed] = out;
    assert.equal(out.length, 6, shown(A));
    assert.equal(setup.ok, true, shown(A));
    assert.equal(setup.marker.pid, A.pid, "the marker binds window A's own process");
    assert.equal(setup.marker.image, "powershell.exe");
    assert.match(setup.marker.created, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{7}Z$/);
    assert.equal(issued.ok, true, A.out);
    assert.equal(child.ok, false, "the child shell is refused");
    assert.notEqual(child.ppid, A.pid, "the child shell is its own process");
    assert.match(child.message, new RegExp(`belongs to another window \\(process ${A.pid}\\); this command runs in process ${child.ppid}`), "refused by the shell binding, so it did inherit the session value and token");
    assert.equal(self.ok, true, `window A is admitted: ${JSON.stringify(self)}`);
    assert.equal(self.ppid, A.pid);
    assert.equal(readFileSync(calls, "utf8"), "1\n", "one request in all: window A's");
    assert.equal(issued2.ok, true, A.out);
    assert.equal(shimmed.ok, false, "the window's own command, through a node.cmd shim, is refused");
    assert.match(shimmed.message, /node was started by cmd\.exe, not by a PowerShell window/);
    assert.equal(readFileSync(calls, "utf8"), "1\n", "no request through the shim");
    // Window A has exited. A new window with the same session value and token:
    const B = await window(`& $env:S0_NODE $env:S0_PROBE send ${issued2.goId}`, env);
    const [late] = lines(B.out);
    assert.equal(late && late.ok, false, shown(B));
    assert.match(late.message, new RegExp(`belongs to another window \\(process ${A.pid}\\)`), "a closed window's marker binds nothing else");
    assert.equal(readFileSync(calls, "utf8"), "1\n", "no further request");
    assert.ok(existsSync(join(dir, "state", "gos", `${issued2.goId}.json`)), "the go is not used up by a refused send");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("G-27b the identity query writes nothing to its caller's stderr: PowerShell's progress output stays inside it", { skip: process.platform !== "win32" && "Windows only", timeout: 120000 }, async () => {
  const script = `const G = await import(${JSON.stringify(pathToFileURL(join(ROOT, "scripts", "manual", "stage0-guard.mjs")).href)}); process.stdout.write(JSON.stringify(G.shellIdentity(process.ppid)));`;
  const r = await new Promise((resolve) => {
    const p = spawn(process.execPath, ["--input-type=module", "-e", script], { windowsHide: true });
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => { out += d; });
    p.stderr.on("data", (d) => { err += d; });
    p.on("exit", (code) => resolve({ out, err, code }));
  });
  assert.equal(r.code, 0, r.err);
  assert.equal(r.err, "", "nothing on stderr");
  const id = JSON.parse(r.out);
  assert.equal(id.pid > 0, true);
  assert.match(id.created, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{7}Z$/);
});
