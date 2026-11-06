// scripts/verify/check-pins.mjs — the verification tooling's own pin set
// (verification-pins.json). It is separate from the sender's guard chain and gives
// these tools no operational authority: it says only which bytes a verification ran.
//
//   node check-pins.mjs required --root <dir>   prints the required step set
//   node check-pins.mjs check --root <dir>      the files under <dir> against the pin set
//   node check-pins.mjs generate --root <dir>   rewrites the pin set's tools from the files
//   node check-pins.mjs verify --repo <repo> --tooling <hash> --root <dir> --commit <hash> [--record <file>]
//       check, and: the pin set and each tool are the tooling commit's blobs; the tested
//       commit's scripts/verify is the tooling commit's. It appends the tested commit and
//       tree, the tooling commit and tree, and each tool's blob and sha256 to the record.
//
// The closure audit reads each tool's raw text: a module may import only node: builtins,
// and the driver and launcher may name only pinned tools. check-isolation.mjs is the one
// exception, and it imports exactly the file its --guard names, the tested commit's.
// Exit 0 when all of it holds, 1 when anything does not, 2 on bad usage.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const TOOL_DIR = "scripts/verify";
export const PINS = `${TOOL_DIR}/verification-pins.json`;

const sha256 = (b) => createHash("sha256").update(b).digest("hex");
/** Git's blob id of these bytes. */
export const blobId = (b) => createHash("sha1").update(Buffer.concat([Buffer.from(`blob ${b.length}\0`), b])).digest("hex");

const toolNames = (root) => readdirSync(join(root, TOOL_DIR)).sort();
export const readPins = (root) => JSON.parse(readFileSync(join(root, PINS), "utf8"));

/** Each file's pin, as the pin set holds it. */
export function pinsOf(root) {
  const tools = {};
  for (const name of toolNames(root)) {
    if (`${TOOL_DIR}/${name}` === PINS) continue;
    const b = readFileSync(join(root, TOOL_DIR, name));
    tools[`${TOOL_DIR}/${name}`] = { blob: blobId(b), sha256: sha256(b), bytes: b.length };
  }
  return tools;
}

/** What a tool's raw text may reach outside the pin set. */
export function closureProblems(root) {
  const problems = [];
  const pinned = new Set(Object.keys(readPins(root).tools ?? {}));
  for (const name of toolNames(root)) {
    const path = `${TOOL_DIR}/${name}`;
    if (!statSync(join(root, TOOL_DIR, name)).isFile()) { problems.push(`${path} is not a file`); continue; }
    const text = readFileSync(join(root, TOOL_DIR, name), "utf8");
    if (name.endsWith(".mjs")) {
      for (const m of text.matchAll(/^\s*(?:import|export)\b[^;\n]*\bfrom\s+"([^"]+)"/gm)) if (!m[1].startsWith("node:")) problems.push(`${path} imports ${m[1]}, which is not a node: builtin`);
      for (const m of text.matchAll(/^\s*import\s+"([^"]+)"/gm)) if (!m[1].startsWith("node:")) problems.push(`${path} imports ${m[1]}, which is not a node: builtin`);
      if (/\brequire\s*\(/.test(text)) problems.push(`${path} calls the CommonJS loader`);
      const dynamic = [...text.matchAll(/\bimport\s*\(/g)].length;
      if (name === "check-isolation.mjs") { if (dynamic !== 1) problems.push(`${path} must import only its --guard file`); }
      else if (dynamic) problems.push(`${path} has a dynamic import`);
    } else if (name.endsWith(".sh")) {
      for (const m of text.matchAll(/\$TOOLS\/([A-Za-z0-9_.-]+)/g)) if (!pinned.has(`${TOOL_DIR}/${m[1]}`) && `${TOOL_DIR}/${m[1]}` !== PINS) problems.push(`${path} names ${m[1]}, which is not pinned`);
      if (/\brm\s+-|\brmdir\b|\bmv\s/.test(text)) problems.push(`${path} deletes or moves files: a run's evidence stays`);
    }
  }
  return problems;
}

/** The files under root against the pin set: exactly the pinned files, each with its pin. */
export function checkProblems(root) {
  const problems = [];
  let pins;
  try { pins = readPins(root); } catch (e) { return [`the pin set does not read: ${e.message}`]; }
  const have = pinsOf(root), want = pins.tools ?? {};
  for (const p of Object.keys(want)) if (!Object.hasOwn(have, p)) problems.push(`${p} is pinned and not there`);
  for (const p of Object.keys(have)) {
    if (!Object.hasOwn(want, p)) { problems.push(`${p} is there and not pinned`); continue; }
    for (const k of ["blob", "sha256", "bytes"]) if (have[p][k] !== want[p][k]) problems.push(`${p}: its ${k} is ${have[p][k]}, pinned ${want[p][k]}`);
  }
  if (!Array.isArray(pins.requiredSteps) || !pins.requiredSteps.length || !pins.requiredSteps.every((s) => /^[a-z0-9-]+$/.test(s))) problems.push("the required step set is missing or malformed");
  return [...problems, ...closureProblems(root)];
}

function verify({ repo, tooling, root, commit, record }) {
  const problems = checkProblems(root);
  const say = (s) => { if (record) appendFileSync(record, `${s}\n`); process.stdout.write(`${s}\n`); };
  const git = (...a) => execFileSync("git", ["-C", repo, ...a], { maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "pipe"] });
  const rev = (r) => git("rev-parse", "--verify", "--quiet", r).toString("utf8").trim();
  try {
    for (const [what, h] of [["tooling", tooling], ["tested", commit]]) {
      if (!/^[0-9a-f]{40}$/.test(String(h))) problems.push(`the ${what} commit is not a full hash`);
      else if (rev(`${h}^{commit}`) !== h) problems.push(`the ${what} commit is not a commit here`);
    }
    if (!problems.length) {
      say(`tested commit ${commit} tree ${rev(`${commit}^{tree}`)}`);
      say(`tooling commit ${tooling} tree ${rev(`${tooling}^{tree}`)} scripts/verify ${rev(`${tooling}:${TOOL_DIR}`)}`);
      const onDisk = readFileSync(join(root, PINS));
      if (!git("cat-file", "blob", `${tooling}:${PINS}`).equals(onDisk)) problems.push("the pin set here is not the tooling commit's");
      say(`pin set ${PINS} blob ${blobId(onDisk)} sha256 ${sha256(onDisk)}`);
      for (const [path, pin] of Object.entries(readPins(root).tools)) {
        if (rev(`${tooling}:${path}`) !== pin.blob) problems.push(`${path} is not the tooling commit's blob`);
        say(`tool ${path} blob ${pin.blob} sha256 ${pin.sha256}`);
      }
      if (rev(`${commit}:${TOOL_DIR}`) !== rev(`${tooling}:${TOOL_DIR}`)) problems.push(`the tested commit's ${TOOL_DIR} is not the tooling commit's`);
    }
  } catch (e) { problems.push(`git did not read it: ${e.message}`); }
  for (const p of problems) say(`PROBLEM ${p}`);
  say(problems.length ? "pins: REFUSED" : "pins: verified");
  return problems.length ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const argv = process.argv.slice(2);
  const opt = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  const root = opt("--root");
  const usage = () => { process.stderr.write("usage: check-pins.mjs required|check|generate --root <dir> | verify --repo <repo> --tooling <hash> --root <dir> --commit <hash> [--record <file>]\n"); process.exit(2); };
  if (!root) usage();
  switch (argv[0]) {
    case "required": {
      const r = readPins(root).requiredSteps;
      if (!Array.isArray(r) || !r.length) process.exit(1);
      process.stdout.write(`${r.join(" ")}\n`);
      process.exit(0);
      break;
    }
    case "check": {
      const problems = checkProblems(root);
      for (const p of problems) process.stdout.write(`PROBLEM ${p}\n`);
      process.exit(problems.length ? 1 : 0);
      break;
    }
    case "generate": {
      const pins = readPins(root);
      writeFileSync(join(root, PINS), `${JSON.stringify({ ...pins, tools: pinsOf(root) }, null, 2)}\n`);
      process.exit(0);
      break;
    }
    case "verify": {
      if (!opt("--repo") || !opt("--tooling") || !opt("--commit")) usage();
      process.exit(verify({ repo: opt("--repo"), tooling: opt("--tooling"), root, commit: opt("--commit"), record: opt("--record") }));
      break;
    }
    default: usage();
  }
}
