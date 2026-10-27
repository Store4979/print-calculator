#!/usr/bin/env node
// scripts/manual/stage0-go.mjs — the preparing session's side of the guarded
// sender (Codex item 6; stage0-guard.mjs). Claude runs it. It never holds a
// token or a window's session value, and refuses to run where either is set.
//
//   node scripts/manual/stage0-go.mjs clock
//   node scripts/manual/stage0-go.mjs phase --workflow capture --phase <P> --go-text <file> --arrived <UTC> --deadline <UTC> [--reviewed <file>]
//   node scripts/manual/stage0-go.mjs issue --phase <phase id> --step <STEP>
//   node scripts/manual/stage0-go.mjs void --go <go id>
//   node scripts/manual/stage0-go.mjs dispose --target <t> --attempt <attempt id> --reviewed <file>
//   node scripts/manual/stage0-go.mjs status --target <t>
//
// clock    measures this machine's clock against time.windows.com with w32tm
//          (three samples, each within 2 s) and records the check. The guard
//          tools refuse when it is missing, older than 60 min, or later than
//          now, and when the clock has gone back.
// phase    records Ryan's go for one phase from the file holding his message's
//          exact text, with the time it arrived (UTC) and its deadline (UTC).
//          It prints the phase id and the window commands.
// issue    runs the phase's exact-step gate on the journal and, when it names
//          this step, writes the step's one go and prints the one send
//          command, which names the go by id. The deadline is the phase
//          deadline less 60 s. Whether the whole remaining path fits before
//          the reserve's end stays the runbook's human check.
// void     moves an unused go to gos/void/.
// dispose  records a reviewed disposition of one held or pending attempt;
//          the review file must name the attempt id.
// status   prints the holds, attempts, gos, markers and lock. Read-only.
//
// Exit status: 0 done; 2 refused. Only `clock` makes a network call (NTP, to
// the time server). None of this is a go: Ryan's go in chat is the authority.
import { readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as A from "./assemble-stage0.mjs";
import * as G from "./stage0-guard.mjs";
import { planSend } from "./stage0-send.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const GO_PATH = "scripts/manual/stage0-go.mjs";

function args(rest, names) {
  const o = {};
  for (let i = 0; i < rest.length; i++) {
    const k = rest[i].startsWith("--") ? rest[i].slice(2) : null;
    if (!k || !names.includes(k) || own(o, k) || i + 1 >= rest.length) throw new G.Refusal(`usage: --${names.join(" <…> --")} <…>`);
    o[k] = rest[++i];
  }
  return o;
}
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/** The command line. deps are for tests only. */
export function main(argv, env, deps = {}) {
  const out = deps.stdout || ((s) => process.stdout.write(s));
  const root = deps.root || ROOT;
  const paths = G.statePaths(deps.stateDir || G.DEFAULT_STATE);
  const now = deps.now || Date.now;
  const identity = deps.identity || G.shellIdentity;
  const [cmd, ...rest] = argv;
  if (env[G.TOKEN_ENV] || env[G.SESSION_ENV]) throw new G.Refusal(`the issuing session holds no token and no window session; ${G.TOKEN_ENV} or ${G.SESSION_ENV} is set here; refusing`);
  const pre = [...G.processProblems({ execArgv: deps.execArgv || process.execArgv, env }), ...G.plantedTools([root, process.cwd()])];
  if (pre.length) throw new G.Refusal(`${pre.join("; ")}; refusing`);
  const ctxCache = new Map();
  const ctxAt = deps.ctxAt || ((h) => { if (!ctxCache.has(h)) ctxCache.set(h, G.contextAt(h, root)); return ctxCache.get(h); });
  const manifestNow = () => deps.manifest || A.manifestAt("HEAD", root);
  const refOf = (manifest, target) => {
    const ref = manifest.send.targets[target];
    if (typeof ref !== "string") throw new G.Refusal("--target is production or staging; refusing");
    return ref;
  };

  if (cmd === "clock") {
    if (rest.length) throw new G.Refusal("usage: stage0-go.mjs clock");
    const t = now();
    const rec = G.recordClock(paths, (deps.measureClock || G.measureClock)(), t);
    out(`clock check ${rec.at}: offsets ${rec.offsetsMs.join(", ")} ms against ${rec.reference} (tolerance ${rec.toleranceMs} ms); w32tm source ${rec.source}; last sync ${rec.lastSync}\n`);
    return { clock: rec };
  }
  if (cmd === "void") {
    const o = args(rest, ["go"]);
    G.voidGo(paths, o.go);
    out(`go ${o.go} voided\n`);
    return { voided: o.go };
  }
  if (cmd === "status") {
    const o = args(rest, ["target"]);
    const manifest = manifestNow();
    const st = G.status({ paths, ref: refOf(manifest, o.target), ctxAt, now: now() });
    out(`${JSON.stringify(st, null, 2)}\n`);
    return { status: st };
  }

  const manifest = manifestNow();
  G.selfCheck(manifest, root, GO_PATH);
  const head = G.checkoutHead(deps.git || G.gitState, root);
  const t = now();
  G.checkClock(paths, t);

  if (cmd === "phase") {
    const o = args(rest, ["workflow", "phase", "go-text", "arrived", "deadline", "reviewed"]);
    for (const k of ["workflow", "phase", "go-text", "arrived", "deadline"]) if (!own(o, k)) throw new G.Refusal(`phase needs --${k}; refusing`);
    let goText;
    try { goText = readFileSync(o["go-text"], "utf8").replace(/\r?\n$/, ""); } catch { throw new G.Refusal("the go text file cannot be read; refusing"); }
    let reviewed = null;
    if (own(o, "reviewed")) {
      let b;
      try { b = readFileSync(o.reviewed); } catch { throw new G.Refusal("the reviewed decision file cannot be read; refusing"); }
      reviewed = { path: resolve(o.reviewed), sha256: G.sha256(b) };
    }
    const rec = G.recordPhase({ paths, manifest, workflows: deps.workflows, workflow: o.workflow, phase: o.phase, goText, arrivedAt: o.arrived, deadline: o.deadline, reviewed, head, checkout: root, now: t });
    out(`phase ${rec.phaseId}: ${rec.workflow} ${rec.phase} (${rec.steps.join(", ")}) on ${rec.target} ${rec.ref} at ${head.slice(0, 7)}, until ${rec.deadline}\n`);
    out(`In each window, after the token and STAGE0_SESSION: node scripts/manual/stage0-window.mjs open --role <R|W> --phase ${rec.phaseId}\n`);
    return { phase: rec };
  }
  if (cmd === "issue") {
    const o = args(rest, ["phase", "step"]);
    if (!own(o, "phase") || !own(o, "step")) throw new G.Refusal("issue needs --phase and --step; refusing");
    const go = G.issueGo({
      paths, manifest, phaseId: o.phase, step: o.step, head, checkout: root, now: t, identity, workflows: deps.workflows, ctxAt, readReceipt: deps.readReceipt,
      planFor: (text, target) => planSend(manifest, text, target, { cwd: root }),
    });
    out(`go ${go.goId}: ${go.step} (${go.text}) from the ${go.role} window, marker ${go.markerId.slice(0, 8)}…, before ${go.deadline}\n`);
    out(`Run once, in the ${go.role} window:\n`);
    out(`node scripts/manual/stage0-send.mjs ${go.text} --target ${go.target} --confirm-ref ${go.ref} --go ${go.goId}\n`);
    return { go };
  }
  if (cmd === "dispose") {
    const o = args(rest, ["target", "attempt", "reviewed"]);
    for (const k of ["target", "attempt", "reviewed"]) if (!own(o, k)) throw new G.Refusal(`dispose needs --${k}; refusing`);
    let b;
    try { b = readFileSync(o.reviewed); } catch { throw new G.Refusal("the review file cannot be read; refusing"); }
    const d = G.dispose({ paths, ref: refOf(manifest, o.target), attemptId: o.attempt, reviewedPath: resolve(o.reviewed), reviewedBytes: b, now: t });
    out(`attempt ${d.attemptId}: disposition recorded from ${d.reviewed.path} (sha256 ${d.reviewed.sha256})\n`);
    return { disposition: d };
  }
  throw new G.Refusal("usage: stage0-go.mjs clock | phase … | issue … | void … | dispose … | status …");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try { main(process.argv.slice(2), process.env); process.exit(0); } catch (e) {
    process.stderr.write(`stage0-go: ${e.message}\n`);
    process.exit(2);
  }
}
