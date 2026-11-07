// scripts/verify/check-isolation.mjs — required steps of the verification driver.
//
//   node check-isolation.mjs before --home <dir> --pscache <file> --tree <dir> --guard <the tested commit's stage0-guard.mjs>
//   node check-isolation.mjs powershell --pscache <file> --tree <dir>
//   node check-isolation.mjs after --home <dir>
//   node check-isolation.mjs tree --tree <dir>
//
// before      The run's per-user locations are the synthetic ones the driver set: HOME and
//             USERPROFILE the home, LOCALAPPDATA and APPDATA its AppData\Local and
//             AppData\Roaming, PSModuleAnalysisCachePath the cache file. Each is absolute and set
//             under exactly one spelling, since Windows reads names without regard to case and a
//             block may carry two. Neither the home nor the cache file overlaps the tested tree,
//             and the temporary directory is not inside it. The home and the cache directory are
//             as the driver made them, empty. The default guard store resolves under the home,
//             and nothing exists there.
// powershell  On Windows, a PowerShell started as the tests start one (inherited variables, the
//             tested tree as its working directory) runs a command from a module not yet loaded,
//             which queues its module analysis cache to be saved, and stays alive until the save,
//             about 10 s later on a background thread, has happened. Its own cache location
//             (read from PowerShell 5.1's AnalysisCacheData) must be the synthetic file, the file
//             must exist, and the tested tree must hold nothing before or after. Elsewhere it
//             starts nothing and says so.
// after       Nothing was created at the default guard store.
// tree        The tested tree, and each checkout the replay left inside it, is as checked out,
//             but for the driver's own ignored outputs (EXPECTED_IGNORED), and nowhere in it,
//             ignored directories included, is a PowerShell per-user file.
//
// It reads the default path from the tested commit's module, under the synthetic home, and
// calls nothing in it. What none of this shows: that a test did not name another path, or that
// nothing was written into the tree and removed again during the run, since `tree` reads only
// the final state. Review is that control. Exit 0 when it holds, 1 when it does not, 2 on bad
// usage.
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readdirSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const argv = process.argv.slice(2);
const opt = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
const when = argv[0], home = opt("--home"), guard = opt("--guard"), pscache = opt("--pscache"), tree = opt("--tree");
const NEEDS = { before: [home, guard, pscache, tree], powershell: [pscache, tree], after: [home], tree: [tree] };
if (!Object.hasOwn(NEEDS, when) || NEEDS[when].some((v) => !v)) {
  process.stderr.write("usage: check-isolation.mjs before --home <dir> --pscache <file> --tree <dir> --guard <file> | powershell --pscache <file> --tree <dir> | after --home <dir> | tree --tree <dir>\n");
  process.exit(2);
}

const WIN = process.platform === "win32";
const norm = (p) => { const r = resolve(p); return WIN ? r.toLowerCase() : r; };
const same = (a, b) => norm(a) === norm(b);
const inside = (p, dir) => { const a = norm(p), d = norm(dir); return a === d || a.startsWith(d.endsWith(sep) ? d : d + sep); };
const problems = [];
const say = (s) => process.stdout.write(`${s}\n`);

/** The names the driver sets, in its spelling. */
const ISOLATED = Object.freeze(["HOME", "USERPROFILE", "LOCALAPPDATA", "APPDATA", "PSModuleAnalysisCachePath"]);
/** What the driver's own steps leave in the tested tree, ignored: install, build and the replay. */
const EXPECTED_IGNORED = Object.freeze(["node_modules/", "dist/", ".stage0-replay/", ".stage0-replay-summary.json"]);
/** The files Windows PowerShell keeps per user: its module analysis cache and its startup profile data. */
const POWERSHELL_FILE = /^(?:ModuleAnalysisCache|StartupProfileData-.*)$/;

/**
 * git status of a checkout, every entry: tracked changes, untracked and ignored. null when git
 * cannot read it, or when `dir` is not the top of its own checkout (git would read an enclosing one).
 */
function entries(dir) {
  const top = spawnSync("git", ["--no-optional-locks", "-C", dir, "rev-parse", "--show-toplevel"], { encoding: "utf8", windowsHide: true });
  if (top.status !== 0 || !same(top.stdout.trim(), dir)) return null;
  const r = spawnSync("git", ["--no-optional-locks", "-C", dir, "status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignored=matching"], { encoding: "utf8", windowsHide: true, maxBuffer: 1 << 26 });
  if (r.status !== 0) return null;
  return r.stdout.split("\0").filter(Boolean).map((e) => ({ xy: e.slice(0, 2), path: e.slice(3) }));
}
const shown = (es) => es.map((e) => `${e.xy} ${e.path}`).join("; ");

if (when === "before") {
  for (const k of ["SUPABASE_ACCESS_TOKEN", "STAGE0_SESSION", "NODE_OPTIONS"]) if (process.env[k] !== undefined) problems.push(`${k} is set`);
  const want = { HOME: home, USERPROFILE: home, LOCALAPPDATA: join(home, "AppData", "Local"), APPDATA: join(home, "AppData", "Roaming"), PSModuleAnalysisCachePath: pscache };
  for (const name of ISOLATED) {
    const spellings = Object.keys(process.env).filter((k) => k.toLowerCase() === name.toLowerCase());
    if (spellings.length !== 1) { problems.push(`${name} is set under ${spellings.length} spellings (${spellings.join(", ") || "none"}), not once`); continue; }
    const value = process.env[spellings[0]];
    say(`${spellings[0]}=${value}`);
    if (!isAbsolute(value)) problems.push(`${name} is not absolute: ${value}`);
    else if (!same(value, want[name])) problems.push(`${name} is ${value}, not ${want[name]}`);
  }
  if (!same(homedir(), home)) problems.push(`the home is ${homedir()}, not the synthetic ${home}`);
  for (const [what, p] of [["the home", home], ["the cache file", pscache]]) if (inside(p, tree) || inside(tree, p)) problems.push(`${what} (${p}) and the tested tree (${tree}) overlap`);
  if (inside(tmpdir(), tree)) problems.push(`the temporary directory (${tmpdir()}) is inside the tested tree`);
  say(`the temporary directory is ${tmpdir()}`);
  const holds = (d) => (existsSync(d) && statSync(d).isDirectory() ? readdirSync(d).sort() : null);
  for (const [d, names] of [[home, ["AppData"]], [join(home, "AppData"), ["Local", "Roaming"]], [join(home, "AppData", "Local"), []], [join(home, "AppData", "Roaming"), []], [dirname(pscache), []]]) {
    const h = holds(d);
    if (h === null) problems.push(`${d} is not a directory`);
    else if (h.join("|") !== names.join("|")) problems.push(`${d} holds ${h.join(", ") || "nothing"}, not ${names.join(", ") || "nothing"}`);
  }
  const store = join(home, ".stage0-guard");
  try {
    const G = await import(pathToFileURL(guard).href);
    if (!same(String(G.DEFAULT_STATE), store)) problems.push(`the default guard store is ${G.DEFAULT_STATE}, not under the synthetic home`);
    say(`the default guard store resolves to ${G.DEFAULT_STATE}`);
  } catch (e) { problems.push(`the guard module did not load: ${e.message}`); }
  if (existsSync(store)) problems.push(`a default guard store exists at ${store}`);
  say(`the synthetic home holds: ${(holds(home) ?? []).join(", ") || "nothing"}`);
}

if (when === "powershell") {
  const before = entries(tree);
  if (before === null) problems.push("git did not read the tested tree");
  else if (before.length) problems.push(`the tested tree is not as checked out before PowerShell starts: ${shown(before)}`);
  if (!WIN) say("PowerShell: not Windows, so none is started");
  else {
    const POWERSHELL = join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    const script = [
      "$ProgressPreference = 'SilentlyContinue'",
      // A command from a module not loaded yet: resolving it analyses modules and queues the save.
      "$null = '{\"a\":1}' | ConvertFrom-Json",
      "$t = [System.Management.Automation.PSObject].Assembly.GetType('System.Management.Automation.AnalysisCacheData')",
      "$f = if ($t) { $t.GetField('cacheStoreLocation', [Reflection.BindingFlags]'Static,NonPublic') } else { $null }",
      "$loc = if ($f) { [string]$f.GetValue($null) } else { '' }",
      "$target = if (-not $loc) { '' } elseif ([IO.Path]::IsPathRooted($loc)) { $loc } else { [IO.Path]::Combine([Environment]::CurrentDirectory, $loc) }",
      // The save runs on a background thread inside this process: stay alive until it has.
      "$until = [DateTime]::UtcNow.AddSeconds(60)",
      "while ($target -and -not [IO.File]::Exists($target) -and [DateTime]::UtcNow -lt $until) { Start-Sleep -Milliseconds 250 }",
      "Start-Sleep -Seconds 2",
      "[pscustomobject]@{ cacheStoreLocation = $loc; localApplicationData = [Environment]::GetFolderPath('LocalApplicationData'); written = [bool]($target -and [IO.File]::Exists($target)) } | ConvertTo-Json -Compress",
    ].join("\n");
    const t0 = Date.now();
    const r = spawnSync(POWERSHELL, ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], { cwd: tree, env: process.env, encoding: "utf8", windowsHide: true, timeout: 120000 });
    let report = null;
    try { report = JSON.parse(String(r.stdout).trim().split(/\r?\n/).pop()); } catch { report = null; }
    if (r.status !== 0 || !report) problems.push(`PowerShell did not report (exit ${r.status}${r.error ? `, ${r.error.message}` : ""}): ${String(r.stderr).trim().slice(0, 300)}`);
    else {
      say(`PowerShell ran ${Date.now() - t0} ms in ${tree}: its cache location ${report.cacheStoreLocation || "<not read>"}; LocalApplicationData ${report.localApplicationData || "<empty>"}`);
      if (!report.cacheStoreLocation) problems.push("PowerShell's cache location could not be read");
      else if (!isAbsolute(report.cacheStoreLocation)) problems.push(`PowerShell's cache location is relative (${report.cacheStoreLocation}), so it writes into its working directory`);
      else if (!same(report.cacheStoreLocation, pscache)) problems.push(`PowerShell's cache location is ${report.cacheStoreLocation}, not the synthetic ${pscache}`);
    }
    if (existsSync(pscache)) say(`the cache file ${pscache}: ${statSync(pscache).size} bytes`);
    else problems.push(`PowerShell wrote no cache at ${pscache}`);
    const after = entries(tree);
    if (after === null) problems.push("git did not read the tested tree");
    else if (after.length) problems.push(`PowerShell left the tested tree changed: ${shown(after)}`);
  }
}

if (when === "after") {
  const store = join(home, ".stage0-guard");
  if (!same(homedir(), home)) problems.push(`the home is ${homedir()}, not the synthetic ${home}`);
  if (existsSync(store)) problems.push(`a default guard store exists at ${store}`);
  say(`the synthetic home holds: ${readdirSync(home).join(", ") || "nothing"}`);
}

if (when === "tree") {
  const judge = (dir, what) => {
    const es = entries(dir);
    if (es === null) { problems.push(`git did not read ${what}`); return; }
    for (const e of es) {
      if (e.xy !== "!!") problems.push(`${what} changed: ${e.xy} ${e.path}`);
      else if (!EXPECTED_IGNORED.includes(e.path)) problems.push(`${what} holds an ignored entry the driver does not make: ${e.path}`);
    }
  };
  judge(tree, "the tested tree");
  const replay = join(tree, ".stage0-replay");
  const checkouts = existsSync(replay) ? readdirSync(replay).sort().filter((n) => lstatSync(join(replay, n)).isDirectory() && existsSync(join(replay, n, ".git"))) : [];
  for (const n of checkouts) judge(join(replay, n), `the replay checkout ${n}`);
  // Every directory, ignored ones included; links are not followed and .git is not read.
  const found = [];
  let files = 0;
  const walk = (d) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n), s = lstatSync(p);
      if (s.isSymbolicLink()) continue;
      if (s.isDirectory()) { if (n !== ".git") walk(p); } else { files += 1; if (POWERSHELL_FILE.test(n)) found.push(p); }
    }
  };
  walk(tree);
  for (const p of found) problems.push(`a PowerShell per-user file is in the tested tree: ${p}`);
  say(`the tested tree and ${checkouts.length} replay checkout(s) read; ${files} files walked, ${found.length} PowerShell per-user file(s)`);
}

for (const p of problems) say(`PROBLEM ${p}`);
process.exit(problems.length ? 1 : 0);
