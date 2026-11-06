// scripts/verify/check-isolation.mjs — required steps of the verification driver: the
// run's home is the synthetic one, the default guard store resolves under it, and nothing
// is created there.
//
//   node check-isolation.mjs before --home <dir> --guard <the tested commit's stage0-guard.mjs>
//   node check-isolation.mjs after --home <dir>
//
// It reads the default path from the tested commit's module, under the synthetic home,
// and calls nothing in it. It shows where the default path lies and whether anything
// exists there. It cannot show that a test did not name another path: review is that
// control. Exit 0 when it holds, 1 when it does not, 2 on bad usage.
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const argv = process.argv.slice(2);
const opt = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
const when = argv[0], home = opt("--home"), guard = opt("--guard");
if (!["before", "after"].includes(when) || !home || (when === "before" && !guard)) {
  process.stderr.write("usage: check-isolation.mjs before --home <dir> --guard <file> | after --home <dir>\n");
  process.exit(2);
}
const problems = [];
const store = join(home, ".stage0-guard");
if (resolve(homedir()) !== resolve(home)) problems.push(`the home is ${homedir()}, not the synthetic ${home}`);
if (when === "before") {
  for (const k of ["SUPABASE_ACCESS_TOKEN", "STAGE0_SESSION", "NODE_OPTIONS"]) if (process.env[k] !== undefined) problems.push(`${k} is set`);
  try {
    const G = await import(pathToFileURL(guard).href);
    if (resolve(String(G.DEFAULT_STATE)) !== resolve(store)) problems.push(`the default guard store is ${G.DEFAULT_STATE}, not under the synthetic home`);
    process.stdout.write(`the default guard store resolves to ${G.DEFAULT_STATE}\n`);
  } catch (e) { problems.push(`the guard module did not load: ${e.message}`); }
}
if (existsSync(store)) problems.push(`a default guard store exists at ${store}`);
process.stdout.write(`the synthetic home holds: ${readdirSync(home).join(", ") || "nothing"}\n`);
for (const p of problems) process.stdout.write(`PROBLEM ${p}\n`);
process.exit(problems.length ? 1 : 0);
