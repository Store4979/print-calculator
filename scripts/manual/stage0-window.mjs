#!/usr/bin/env node
// scripts/manual/stage0-window.mjs — a PowerShell window's marker for the
// guarded sender (Codex item 6; stage0-guard.mjs). Ryan runs it in each
// window, after the token is loaded and STAGE0_SESSION is set:
//
//   node scripts/manual/stage0-window.mjs open --role <R|W|C> --phase <phase id>
//   node scripts/manual/stage0-window.mjs status
//   node scripts/manual/stage0-window.mjs close
//
// open   refuses unless the pinned chain holds, the checkout is clean at the
//        phase's head, the clock check is fresh, and this window is a
//        PowerShell process with STAGE0_SESSION and a personal access token
//        set. It records the window's role, its shell process (as Windows
//        reports it) and an HMAC of its token. It prints the marker id, role,
//        head, ref and end; never the token, the session value or the HMAC.
// status prints this window's marker, and whether this window's process is
//        the one it binds.
// close  removes this window's marker and its unused gos, and nothing else.
//        It checks no pin, head or clock, so it works even when those fail.
//        The journal, used gos and receipts stay. The window's environment
//        is the shell's own: clear it and exit the window afterwards.
//
// Exit status: 0 done; 2 refused. It makes no network call.
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as A from "./assemble-stage0.mjs";
import * as G from "./stage0-guard.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const WINDOW_PATH = "scripts/manual/stage0-window.mjs";

/** The command line. deps are for tests only. */
export function main(argv, env, deps = {}) {
  const out = deps.stdout || ((s) => process.stdout.write(s));
  const root = deps.root || ROOT;
  const paths = G.statePaths(deps.stateDir || G.DEFAULT_STATE);
  const now = deps.now || Date.now;
  const identity = deps.identity || G.shellIdentity;
  const ppid = deps.ppid ?? process.ppid;
  const selfStartMs = deps.selfStartMs ?? Date.now() - process.uptime() * 1000;
  const [cmd, ...rest] = argv;
  if (cmd === "close") {
    const r = G.closeSession({ paths, env });
    out(r.markers.length ? `closed marker ${r.markers.join(", ")}; voided ${r.gos.length} unused go(s)\n` : "no marker for this window's session\n");
    out("Next, in this window: Remove-Item Env:SUPABASE_ACCESS_TOKEN; Remove-Item Env:STAGE0_SESSION; exit. Then delete the token in the dashboard.\n");
    return { closed: r };
  }
  if (cmd === "status") {
    const m = G.sessionMarkers(paths, env);
    if (m.length !== 1) { out(m.length ? "more than one marker for this window's session\n" : "no marker for this window's session\n"); return { marker: null }; }
    let here = false;
    try { const s = identity(ppid); here = Boolean(s) && s.pid === m[0].shell.pid && s.created === m[0].shell.created && s.image === m[0].shell.image; } catch { /* reported as not bound */ }
    out(`marker ${m[0].markerId}: role ${m[0].role}; phase ${m[0].phaseId}; head ${m[0].head.slice(0, 7)}; ${m[0].target} ${m[0].ref}; until ${m[0].until}; ${here ? "bound to this window" : "NOT bound to this window"}\n`);
    return { marker: m[0], here };
  }
  if (cmd !== "open") throw new G.Refusal("usage: stage0-window.mjs open --role <R|W|C> --phase <phase id> | status | close");
  const o = { role: null, phase: null };
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--role") o.role = rest[++i] ?? null;
    else if (rest[i] === "--phase") o.phase = rest[++i] ?? null;
    else throw new G.Refusal("usage: stage0-window.mjs open --role <R|W|C> --phase <phase id>");
  }
  const pre = [...G.processProblems({ execArgv: deps.execArgv || process.execArgv, env }), ...G.plantedTools([root, process.cwd()])];
  if (pre.length) throw new G.Refusal(`${pre.join("; ")}; refusing`);
  const manifest = deps.manifest || A.manifestAt("HEAD", root);
  G.selfCheck(manifest, root, WINDOW_PATH);
  const head = G.checkoutHead(deps.git || G.gitState, root);
  const t = now();
  G.checkClock(paths, t);
  const { marker, removed } = G.openMarker({ paths, manifest, phaseId: o.phase, role: o.role, env, head, checkout: root, now: t, identity, ppid, selfStartMs, workflows: deps.workflows });
  if (removed.length) out(`removed ${removed.length} marker(s) whose window is gone\n`);
  out(`marker ${marker.markerId}: role ${marker.role}; head ${head.slice(0, 7)}; ${marker.target} ${marker.ref}; until ${marker.until}\n`);
  return { marker };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try { main(process.argv.slice(2), process.env); process.exit(0); } catch (e) {
    process.stderr.write(`stage0-window: ${e.message}\n`);
    process.exit(2);
  }
}
