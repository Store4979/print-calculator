#!/usr/bin/env node
// scripts/manual/stage0-go.mjs — the preparing session's side of the guarded
// sender (Codex item 6; stage0-guard.mjs). Claude runs it. It never holds a
// token or a window's session value, and refuses to run where either is set.
//
//   node scripts/manual/stage0-go.mjs init [--restore --predecessor <store id> --reviewed <file>]
//   node scripts/manual/stage0-go.mjs clock
//   node scripts/manual/stage0-go.mjs draft --workflow capture --phase <P>
//   node scripts/manual/stage0-go.mjs phase --workflow capture --phase <P> --go-text <file> --arrived <UTC> --deadline <UTC> [--reviewed <file>]
//   node scripts/manual/stage0-go.mjs issue --phase <phase id> --step <STEP>
//   node scripts/manual/stage0-go.mjs void --go <go id>
//   node scripts/manual/stage0-go.mjs dispose --target <t> --attempt <attempt id> --reviewed <file>
//   node scripts/manual/stage0-go.mjs status --target <t>
//
// init     makes the guard store, once, where nothing exists, and prints the
//          anchor to commit at docs/security/stage0-guard-store.json. Every
//          other command refuses until that anchor is committed and names
//          this store. While the repository records an established store,
//          init refuses; a lost or damaged store is replaced only with
//          --restore, naming the lost store's id and a review file.
// clock    measures this machine's clock against time.windows.com with w32tm
//          (three samples, each within 2 s) and records the check. The guard
//          tools refuse when it is missing, older than 60 min, or later than
//          now, and when the clock has gone back.
// draft    allocates a fresh approval id for one phase. Ryan's go line must
//          carry `approval <id>`; one id registers at most one phase.
// phase    registers Ryan's go for one phase from the file holding his
//          message's exact text, with the time it arrived (UTC) and its
//          deadline (UTC). The same approval again returns the same phase,
//          with its progress. It prints the phase id, each step's ceiling and
//          the window commands.
// issue    runs the phase's exact-step gate on the journal and, when it names
//          this step, writes the step's one go and prints the one send
//          command, which names the go by id. The go's deadline is the
//          step's ceiling: the phase deadline less what the phase's
//          declaration reserves for the remaining path from that step, or
//          less 60 s where it declares none (the capture-phase admission
//          cutoff). The sender recomputes it. The production ceilings are
//          item 4(c)'s, in review.
// void     moves an unused go to gos/void/.
// dispose  records a reviewed disposition of one held or pending attempt;
//          the review file must name the attempt id.
// status   prints the holds, attempts, gos, markers and lock; on a damaged
//          store, the damage and no holds list. Read-only.
//
// Exit status: 0 done (status: intact and nothing held); 2 refused; 3
// status found damage, a hold or the lock. Only `clock` makes a network call
// (NTP, to the time server). None of this is a go: Ryan's go in chat is the
// authority.
import { readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as A from "./assemble-stage0.mjs";
import * as G from "./stage0-guard.mjs";
import { planSend } from "./stage0-send.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const GO_PATH = "scripts/manual/stage0-go.mjs";

const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
function args(rest, names, flags = []) {
  const o = {};
  for (let i = 0; i < rest.length; i++) {
    const k = rest[i].startsWith("--") ? rest[i].slice(2) : null;
    if (k && flags.includes(k) && !own(o, k)) { o[k] = true; continue; }
    if (!k || !names.includes(k) || own(o, k) || i + 1 >= rest.length) throw new G.Refusal(`usage: --${names.join(" <…> --")} <…>${flags.map((f) => ` [--${f}]`).join("")}`);
    o[k] = rest[++i];
  }
  return o;
}
const need = (o, keys, cmd) => { for (const k of keys) if (!own(o, k)) throw new G.Refusal(`${cmd} needs --${k}; refusing`); };
const readFile = (p, what) => { try { return readFileSync(p); } catch { throw new G.Refusal(`the ${what} cannot be read; refusing`); } };

/** The command line. deps are for tests only. */
export function main(argv, env, deps = {}) {
  const out = deps.stdout || ((s) => process.stdout.write(s));
  const root = deps.root || ROOT;
  const paths = G.statePaths(deps.stateDir || G.DEFAULT_STATE);
  const now = deps.now || Date.now;
  const identity = deps.identity || G.shellIdentity;
  const [cmd, ...rest] = argv;
  if (env[G.TOKEN_ENV] || env[G.SESSION_ENV]) throw new G.Refusal(`the issuing session holds no token and no window session; ${G.TOKEN_ENV} or ${G.SESSION_ENV} is set here; refusing`);
  G.preflight({ execArgv: deps.execArgv || process.execArgv, env, dirs: [root, process.cwd()] });
  const ctxCache = new Map();
  const ctxAt = deps.ctxAt || ((h) => { if (!ctxCache.has(h)) ctxCache.set(h, G.contextAt(h, root)); return ctxCache.get(h); });
  const manifest = deps.manifest || A.manifestAt("HEAD", root);
  const anchor = deps.anchor !== undefined ? deps.anchor : G.anchorAt(root);
  const refOf = (target) => {
    const ref = manifest.send.targets[target];
    if (typeof ref !== "string") throw new G.Refusal("--target is production or staging; refusing");
    return ref;
  };

  if (cmd === "status") {
    const o = args(rest, ["target"]);
    const st = G.status({ paths, anchor, manifest, ref: refOf(o.target), ctxAt, now: now() });
    out(`${JSON.stringify(st, null, 2)}\n`);
    if (!st.intact) out("DAMAGED: the store does not match its ledger or its anchor. Holds are unknown; nothing is registered, issued or sent until a reviewed restoration.\n");
    return { status: st, exit: st.intact && !st.holds.length && !st.lock ? 0 : 3 };
  }
  if (cmd === "void") {
    const o = args(rest, ["go"]);
    G.voidGo({ paths, anchor, manifest, goId: o.go, now: now() });
    out(`go ${o.go} voided\n`);
    return { voided: o.go };
  }

  G.selfCheck(manifest, root, GO_PATH);
  const t = now();

  if (cmd === "clock") {
    if (rest.length) throw new G.Refusal("usage: stage0-go.mjs clock");
    const rec = G.recordClock({ paths, anchor, manifest, measurement: (deps.measureClock || G.measureClock)(), now: t });
    out(`clock check ${rec.at}: offsets ${rec.offsetsMs.join(", ")} ms against ${rec.reference} (tolerance ${rec.toleranceMs} ms); w32tm source ${rec.source}; last sync ${rec.lastSync}; high-water record before: ${rec.hwmBefore}\n`);
    return { clock: rec };
  }

  const head = G.checkoutHead(deps.git || G.gitState, root);

  if (cmd === "init") {
    const o = args(rest, ["predecessor", "reviewed"], ["restore"]);
    let restore = null;
    if (o.restore) {
      need(o, ["predecessor", "reviewed"], "init --restore");
      restore = { predecessor: o.predecessor, reviewedPath: resolve(o.reviewed), reviewedBytes: readFile(o.reviewed, "review file") };
    } else if (own(o, "predecessor") || own(o, "reviewed")) throw new G.Refusal("--predecessor and --reviewed go only with --restore; refusing");
    const store = G.initStore({ paths, manifest, anchor, now: t, restore });
    out(`store ${store.storeId} made at ${paths.dir}${store.predecessor ? `, replacing ${store.predecessor.storeId}` : ""}.\n`);
    out(`Commit this, exactly, as ${G.ANCHOR_PATH}, in a reviewed commit; until it is at HEAD, every live command refuses:\n`);
    out(`${JSON.stringify(G.anchorFor(store), null, 2)}\n`);
    return { store };
  }
  if (cmd === "draft") {
    const o = args(rest, ["workflow", "phase"]);
    need(o, ["workflow", "phase"], "draft");
    const d = G.draftApproval({ paths, anchor, manifest, workflows: deps.workflows, workflow: o.workflow, phase: o.phase, head, now: t });
    out(`approval ${d.approvalId}: for ${d.workflow} ${d.phase} at ${d.head.slice(0, 7)} on ${d.ref}. Ryan's go line carries "approval ${d.approvalId}"; it registers one phase, once.\n`);
    return { draft: d };
  }
  if (cmd === "phase") {
    const o = args(rest, ["workflow", "phase", "go-text", "arrived", "deadline", "reviewed"]);
    need(o, ["workflow", "phase", "go-text", "arrived", "deadline"], "phase");
    const goText = readFile(o["go-text"], "go text file").toString("utf8").replace(/\r?\n$/, "");
    const reviewed = own(o, "reviewed") ? { path: resolve(o.reviewed), sha256: G.sha256(readFile(o.reviewed, "reviewed decision file")) } : null;
    const r = G.recordPhase({ paths, anchor, manifest, workflows: deps.workflows, workflow: o.workflow, phase: o.phase, goText, arrivedAt: o.arrived, deadline: o.deadline, reviewed, head, checkout: root, now: t });
    const p = r.phase;
    if (r.existing) out(`approval ${p.approvalId} is already registered as phase ${p.phaseId} (recorded ${p.recordedAt}): it is returned, and its progress is unchanged\n`);
    out(`phase ${p.phaseId}: ${p.workflow} ${p.phase} (${p.steps.join(", ")}) on ${p.target} ${p.ref} at ${head.slice(0, 7)}, until ${p.deadline}\n`);
    out(`ceilings (latest starts): ${p.steps.map((s) => `${s} before ${p.ceilings[s]}`).join("; ")}\n`);
    out(`In each window, after the token and STAGE0_SESSION: node scripts/manual/stage0-window.mjs open --role <R|W> --phase ${p.phaseId}\n`);
    return { phase: p, existing: r.existing };
  }
  if (cmd === "issue") {
    const o = args(rest, ["phase", "step"]);
    need(o, ["phase", "step"], "issue");
    const go = G.issueGo({
      paths, anchor, manifest, phaseId: o.phase, step: o.step, head, checkout: root, now: t, identity, workflows: deps.workflows, ctxAt, readReceipt: deps.readReceipt,
      planFor: (text, target) => planSend(manifest, text, target, { cwd: root }),
    });
    out(`go ${go.goId}: ${go.step} (${go.text}) from the ${go.role} window, marker ${go.markerId.slice(0, 8)}…, before ${go.deadline} (${go.step}'s ceiling ${go.ceiling})\n`);
    out(`Run once, in the ${go.role} window:\n`);
    out(`node scripts/manual/stage0-send.mjs ${go.text} --target ${go.target} --confirm-ref ${go.ref} --go ${go.goId}\n`);
    return { go };
  }
  if (cmd === "dispose") {
    const o = args(rest, ["target", "attempt", "reviewed"]);
    need(o, ["target", "attempt", "reviewed"], "dispose");
    const d = G.dispose({ paths, anchor, manifest, ref: refOf(o.target), attemptId: o.attempt, reviewedPath: resolve(o.reviewed), reviewedBytes: readFile(o.reviewed, "review file"), now: t });
    out(`attempt ${d.attemptId}: disposition recorded from ${d.reviewed.path} (sha256 ${d.reviewed.sha256})\n`);
    return { disposition: d };
  }
  throw new G.Refusal("usage: stage0-go.mjs init | clock | draft … | phase … | issue … | void … | dispose … | status …");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try { const r = main(process.argv.slice(2), process.env); process.exit(r && r.exit ? r.exit : 0); } catch (e) {
    process.stderr.write(`stage0-go: ${e.message}\n`);
    process.exit(2);
  }
}
