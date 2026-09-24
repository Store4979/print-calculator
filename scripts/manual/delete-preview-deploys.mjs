#!/usr/bin/env node
// scripts/manual/delete-preview-deploys.mjs — retire key-bearing deploy
// previews of the PRODUCTION site by deleting them through the Netlify API.
// Run by the operator, never by CI or a session. Approved 2026-09-23 for the
// 56 previews listed in docs/security/deploy-inventory.md.
//
// WHY: every Netlify deploy is an immutable bundle carrying the environment
// it captured at build. Previews built before the service-role key was
// cleared from the Deploy Previews context keep that key, and their legacy
// writers stay live on their permalinks (deploy-inventory.md). Deletion is one
// of the three retirement mechanisms in plan §4.2 step 3.
//
// WHAT THIS REFUSES, and where each refusal is enforced:
//  - any id not in the DELETE-LIST block of deploy-inventory.md. Ids are never
//    taken from the command line; an id-shaped argument is an error.
//  - any deploy whose site is not the production site, whose context is not
//    `deploy-preview`, or whose PR number or commit disagrees with the list
//    row (the list was built from those facts; a mismatch means the row is
//    not describing this deploy).
//  - the currently PUBLISHED deploy of the site, re-read from the API
//    immediately before EACH delete — not once at startup.
//
// DRY RUN BY DEFAULT: prints id, PR, commit, tier, permalink and the verdict of
// every check, and sends no DELETE. `--apply` deletes. `--tier 1|2|3|all`
// selects rows (default all, in tier order; tier 1 = missing the
// cleanup-stale-jobs fix, run it first).
//
// THE TOKEN: read only from NETLIFY_AUTH_TOKEN in the environment, sent only in
// the Authorization header, never printed — every output line passes through
// a redactor that replaces it if it ever appears. The dry run works without a
// token (the checks use public endpoints); --apply refuses to start without one.
//
// This script's own post-delete read-back is a convenience, NOT the proof of
// retirement. The proof is an independent probe of each permalink afterwards,
// recorded per URL in deploy-inventory.md.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const PRODUCTION_SITE_ID = "03ff880d-eb73-4035-8b71-3588b22a0b20";
export const PRODUCTION_SITE_NAME = "printcalculator2";
export const API = "https://api.netlify.com/api/v1";
export const INVENTORY = fileURLToPath(new URL("../../docs/security/deploy-inventory.md", import.meta.url));

const ID_RE = /^[0-9a-f]{24}$/;

/** Parse the DELETE-LIST block. Throws on anything malformed. */
export function readDeleteList(markdown) {
  const begin = markdown.indexOf("<!-- DELETE-LIST:BEGIN");
  const end = markdown.indexOf("<!-- DELETE-LIST:END -->");
  if (begin < 0 || end < 0 || end < begin) throw new Error("deploy-inventory.md has no DELETE-LIST:BEGIN/END block");
  if (markdown.indexOf("<!-- DELETE-LIST:BEGIN", begin + 1) >= 0) throw new Error("more than one DELETE-LIST block");
  const fence = markdown.slice(begin, end).match(/```delete-list\r?\n([\s\S]*?)```/);
  if (!fence) throw new Error("the DELETE-LIST block has no ```delete-list fence");
  const rows = [];
  const seen = new Set();
  for (const raw of fence[1].split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const cells = line.split("|").map((c) => c.trim());
    if (cells.length !== 4) throw new Error(`malformed row (need id | PR | commit | tier): ${line}`);
    const [id, pr, commit, tier] = cells;
    if (!ID_RE.test(id)) throw new Error(`not a deploy id: ${id}`);
    if (!/^\d+$/.test(pr)) throw new Error(`not a PR number: ${pr} (${id})`);
    if (!/^[0-9a-f]{7,40}$/.test(commit)) throw new Error(`not a commit: ${commit} (${id})`);
    if (!/^[123]$/.test(tier)) throw new Error(`tier must be 1, 2 or 3: ${tier} (${id})`);
    if (seen.has(id)) throw new Error(`duplicate id in the list: ${id}`);
    seen.add(id);
    rows.push({ id, pr: Number(pr), commit, tier: Number(tier) });
  }
  if (rows.length === 0) throw new Error("the DELETE-LIST block is empty");
  return rows;
}

/** Parse argv. Ids are never accepted here. Throws on anything unexpected. */
export function parseArgs(argv) {
  const out = { apply: false, tier: "all" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (ID_RE.test(a) || /[0-9a-f]{24}/.test(a)) throw new Error(`deploy ids are not taken from arguments (${a}); edit the DELETE-LIST in deploy-inventory.md in a reviewed commit`);
    if (a === "--apply") { out.apply = true; continue; }
    if (a === "--tier") {
      const v = argv[++i];
      if (!["1", "2", "3", "all"].includes(v)) throw new Error(`--tier takes 1, 2, 3 or all (got ${v})`);
      out.tier = v;
      continue;
    }
    throw new Error(`unknown argument: ${a}`);
  }
  return out;
}

export const permalink = (id) => `https://${id}--${PRODUCTION_SITE_NAME}.netlify.app`;

/** Checks one row against the live API. Returns { verdict: "delete"|"gone"|"refuse", reason }. */
export async function checkRow(row, http) {
  const d = await http("GET", `/deploys/${row.id}`);
  if (d.status === 404) return { verdict: "gone", reason: "the API has no such deploy (already deleted)" };
  if (d.status !== 200) return { verdict: "refuse", reason: `GET deploy answered ${d.status}` };
  const dep = d.body || {};
  if (dep.site_id !== PRODUCTION_SITE_ID) return { verdict: "refuse", reason: `site_id ${dep.site_id} is not the production site` };
  if (dep.context !== "deploy-preview") return { verdict: "refuse", reason: `context is ${JSON.stringify(dep.context)}, not deploy-preview` };
  if (Number(dep.review_id) !== row.pr) return { verdict: "refuse", reason: `review_id ${dep.review_id} != listed PR ${row.pr}` };
  if (!String(dep.commit_ref || "").startsWith(row.commit)) return { verdict: "refuse", reason: `commit ${String(dep.commit_ref).slice(0, 12)} != listed ${row.commit}` };
  // Re-read the published deploy NOW, immediately before any delete.
  const s = await http("GET", `/sites/${PRODUCTION_SITE_ID}`);
  if (s.status !== 200) return { verdict: "refuse", reason: `GET site answered ${s.status}; cannot confirm this is not the published deploy` };
  const published = s.body?.published_deploy?.id;
  if (!published) return { verdict: "refuse", reason: "the site reports no published deploy; refusing rather than guessing" };
  if (published === row.id) return { verdict: "refuse", reason: "this is the site's CURRENTLY PUBLISHED deploy" };
  return { verdict: "delete", reason: `preview of PR #${row.pr}; published deploy is ${published}` };
}

export async function run({ argv = process.argv.slice(2), env = process.env, fetchImpl = globalThis.fetch, out = console.log, markdown = null } = {}) {
  const token = String(env.NETLIFY_AUTH_TOKEN ?? "").trim();
  const say = (line) => out(token ? String(line).split(token).join("[REDACTED]") : String(line));

  let args, rows;
  try {
    args = parseArgs(argv);
    rows = readDeleteList(markdown ?? readFileSync(INVENTORY, "utf8"));
  } catch (e) {
    say(`REFUSED: ${e.message}`);
    return { code: 1, results: [] };
  }
  if (args.apply && !token) {
    say("REFUSED: --apply needs NETLIFY_AUTH_TOKEN in the environment. Nothing was sent.");
    return { code: 1, results: [] };
  }

  const http = async (method, path) => {
    const headers = { accept: "application/json" };
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await fetchImpl(`${API}${path}`, { method, headers });
    let body = null;
    try { body = await res.json(); } catch { /* DELETE answers 204 with no body */ }
    return { status: res.status, body };
  };

  const selected = rows
    .filter((r) => args.tier === "all" || r.tier === Number(args.tier))
    .sort((a, b) => a.tier - b.tier);
  say(`${args.apply ? "APPLY" : "DRY RUN (no DELETE will be sent; add --apply)"} — ${selected.length} of ${rows.length} listed deploys, tier ${args.tier}`);

  const results = [];
  let refused = 0;
  for (const row of selected) {
    const head = `${row.id}  PR #${row.pr}  ${row.commit}  tier ${row.tier}  ${permalink(row.id)}`;
    let check;
    try { check = await checkRow(row, http); } catch (e) { check = { verdict: "refuse", reason: `check failed: ${e.message}` }; }
    if (check.verdict !== "delete" || !args.apply) {
      if (check.verdict === "refuse") refused++;
      say(`${head}\n    ${check.verdict === "delete" ? "would delete" : check.verdict.toUpperCase()}: ${check.reason}`);
      results.push({ ...row, verdict: check.verdict === "delete" ? "would-delete" : check.verdict, reason: check.reason });
      continue;
    }
    const del = await http("DELETE", `/sites/${PRODUCTION_SITE_ID}/deploys/${row.id}`);
    const after = await http("GET", `/deploys/${row.id}`);
    const ok = (del.status === 200 || del.status === 204) && after.status === 404;
    if (!ok) refused++;
    say(`${head}\n    ${ok ? "DELETED" : "DELETE FAILED"}: DELETE answered ${del.status}; read-back GET answered ${after.status}`);
    results.push({ ...row, verdict: ok ? "deleted" : "delete-failed", reason: `DELETE ${del.status}, read-back ${after.status}` });
  }
  say(`done: ${results.filter((r) => r.verdict === "deleted").length} deleted, ${results.filter((r) => r.verdict === "would-delete").length} would delete, ${results.filter((r) => r.verdict === "gone").length} already gone, ${refused} refused or failed`);
  say("This read-back is not the proof of retirement; the permalinks are probed independently afterwards.");
  return { code: refused ? 1 : 0, results };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  run().then((r) => process.exit(r.code));
}
