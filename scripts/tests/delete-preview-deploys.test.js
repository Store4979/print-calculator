// scripts/tests/delete-preview-deploys.test.js — the operator's deletion
// script, driven against a FAKE Netlify API. No request here reaches Netlify.
// Each refusal the script claims is exercised, and the token is shown never to
// leave the Authorization header.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  run, readDeleteList, readProductionLists, parseArgs, permalink, checkRow,
  PRODUCTION_SITE_ID, INVENTORY,
} from "../manual/delete-preview-deploys.mjs";

const TOKEN = "nfp_MARKER_TOKEN_0123456789abcdef";
const PUBLISHED = "6ab020c50a788b0008d430c9";
const ROW = (id, pr, commit, tier) => `${id} | ${pr} | ${commit} | ${tier}`;
// Every mode reads the keep list, so every fixture carries one (the published deploy).
const KEEP_BLOCK = (rows = ["6ab020c50a788b0008d430c9 | 7ec5af4 | published"]) =>
  `<!-- PRODUCTION-KEEP:BEGIN -->\n\`\`\`production-keep\n${rows.join("\n")}\n\`\`\`\n<!-- PRODUCTION-KEEP:END -->\n`;
const MD = (rows, keep) => `x\n${KEEP_BLOCK(keep)}<!-- DELETE-LIST:BEGIN -->\n\`\`\`delete-list\n${rows.join("\n")}\n\`\`\`\n<!-- DELETE-LIST:END -->\n`;
const AMD = (rows, keep) => `x\n${KEEP_BLOCK(keep)}<!-- PREVIEW-ADDENDUM-DELETE-LIST:BEGIN -->\n\`\`\`preview-addendum-delete-list\n${rows.join("\n")}\n\`\`\`\n<!-- PREVIEW-ADDENDUM-DELETE-LIST:END -->\n`;
const A = "aaaaaaaaaaaaaaaaaaaaaaaa", B = "bbbbbbbbbbbbbbbbbbbbbbbb", C = "cccccccccccccccccccccccc";

/** Fake API: deploys by id, a published id (optionally changing), a request log. */
function fakeApi({ deploys = {}, published = PUBLISHED, publishedSeq = null } = {}) {
  const calls = [];
  const gone = new Set();
  let siteReads = 0;
  const fetchImpl = async (url, opts) => {
    calls.push({ url, method: opts.method, auth: opts.headers.authorization || null });
    const json = (status, body) => ({ status, json: async () => body });
    let m;
    if ((m = url.match(/\/deploys\/([0-9a-f]{24})$/)) && opts.method === "GET" && !url.includes("/sites/")) {
      const d = deploys[m[1]];
      return d && !gone.has(m[1]) ? json(200, d) : json(404, { message: "Not Found" });
    }
    if (url.endsWith(`/sites/${PRODUCTION_SITE_ID}`) && opts.method === "GET") {
      const pub = publishedSeq ? publishedSeq[Math.min(siteReads, publishedSeq.length - 1)] : published;
      siteReads++;
      return json(200, { id: PRODUCTION_SITE_ID, published_deploy: { id: pub } });
    }
    if ((m = url.match(/\/sites\/[^/]+\/deploys\/([0-9a-f]{24})$/)) && opts.method === "DELETE") {
      gone.add(m[1]);
      return { status: 204, json: async () => { throw new Error("no body"); } };
    }
    return json(500, {});
  };
  return { fetchImpl, calls };
}
const preview = (pr, commit) => ({ site_id: PRODUCTION_SITE_ID, context: "deploy-preview", review_id: pr, commit_ref: commit + "0".repeat(40 - commit.length) });

async function go(opts) {
  const lines = [];
  const r = await run({ out: (l) => lines.push(l), ...opts });
  return { ...r, text: lines.join("\n") };
}

test("DL-1 the committed list is the approved one: 56 unique ids, tiers 42/2/12, every row well-formed", () => {
  const rows = readDeleteList(readFileSync(INVENTORY, "utf8"));
  assert.equal(rows.length, 56);
  assert.equal(new Set(rows.map((r) => r.id)).size, 56);
  const t = (n) => rows.filter((r) => r.tier === n).length;
  assert.deepEqual([t(1), t(2), t(3)], [42, 2, 12]);
  assert.ok(!rows.some((r) => r.id === PUBLISHED), "the published production deploy is not on the list");
});

test("DL-2 ids are never taken from arguments; unknown flags and bad tiers refuse; nothing is sent", async () => {
  assert.throws(() => parseArgs([A]), /not taken from arguments/);
  assert.throws(() => parseArgs(["--id=" + A]), /not taken from arguments/);
  assert.throws(() => parseArgs(["--force"]), /unknown argument/);
  assert.throws(() => parseArgs(["--tier", "4"]), /--tier takes/);
  const api = fakeApi();
  const r = await go({ argv: ["--apply", A], env: { NETLIFY_AUTH_TOKEN: TOKEN }, fetchImpl: api.fetchImpl, markdown: MD([ROW(A, 29, "abcdef1", 1)]) });
  assert.equal(r.code, 1);
  assert.equal(api.calls.length, 0);
});

test("DL-3 the list parser refuses: no block, duplicate id, malformed row, bad tier, empty block", () => {
  assert.throws(() => readDeleteList("nothing here"), /no DELETE-LIST/);
  assert.throws(() => readDeleteList(MD([ROW(A, 29, "abcdef1", 1), ROW(A, 30, "abcdef2", 1)])), /duplicate id/);
  assert.throws(() => readDeleteList(MD([`${A} | 29 | abcdef1`])), /malformed row/);
  assert.throws(() => readDeleteList(MD([ROW(A, 29, "abcdef1", 4)])), /tier must be/);
  assert.throws(() => readDeleteList(MD([])), /empty/);
});

test("DL-4 dry run is the default: prints id, PR, commit and permalink for each row and sends no DELETE, even with a token", async () => {
  const api = fakeApi({ deploys: { [A]: preview(29, "abcdef1") } });
  const r = await go({ argv: [], env: { NETLIFY_AUTH_TOKEN: TOKEN }, fetchImpl: api.fetchImpl, markdown: MD([ROW(A, 29, "abcdef1", 1)]) });
  assert.equal(r.code, 0);
  assert.match(r.text, /DRY RUN/);
  assert.ok(r.text.includes(A) && r.text.includes("PR #29") && r.text.includes("abcdef1") && r.text.includes(permalink(A)));
  assert.match(r.text, /would delete/);
  assert.equal(api.calls.filter((c) => c.method === "DELETE").length, 0);
});

test("DL-5 --apply without NETLIFY_AUTH_TOKEN refuses before any request", async () => {
  const api = fakeApi({ deploys: { [A]: preview(29, "abcdef1") } });
  const r = await go({ argv: ["--apply"], env: {}, fetchImpl: api.fetchImpl, markdown: MD([ROW(A, 29, "abcdef1", 1)]) });
  assert.equal(r.code, 1);
  assert.match(r.text, /needs NETLIFY_AUTH_TOKEN/);
  assert.equal(api.calls.length, 0);
});

test("DL-6 refusals: not a preview, wrong site, PR mismatch, commit mismatch — each refused, none deleted", async () => {
  const cases = [
    [{ ...preview(29, "abcdef1"), context: "production" }, /not deploy-preview/],
    [{ ...preview(29, "abcdef1"), context: "branch-deploy" }, /not deploy-preview/],
    [{ ...preview(29, "abcdef1"), site_id: "3106189d-9053-46a3-bfc7-22ba6b52511a" }, /is not the production site/],
    [preview(30, "abcdef1"), /review_id 30 != listed PR 29/],
    [preview(29, "1234567"), /!= listed abcdef1/],
  ];
  for (const [dep, re] of cases) {
    const api = fakeApi({ deploys: { [A]: dep } });
    const r = await go({ argv: ["--apply"], env: { NETLIFY_AUTH_TOKEN: TOKEN }, fetchImpl: api.fetchImpl, markdown: MD([ROW(A, 29, "abcdef1", 1)]) });
    assert.match(r.text, re);
    assert.equal(r.code, 1);
    assert.equal(api.calls.filter((c) => c.method === "DELETE").length, 0, `no DELETE for ${re}`);
  }
});

test("DL-7 the published deploy is re-read before EACH delete: a deploy that becomes published mid-run is refused", async () => {
  // Site reads: before A -> PUBLISHED (A deletable); before B -> B (B is now published).
  const api = fakeApi({ deploys: { [A]: preview(29, "abcdef1"), [B]: preview(30, "abcdef2") }, publishedSeq: [PUBLISHED, B] });
  const r = await go({ argv: ["--apply"], env: { NETLIFY_AUTH_TOKEN: TOKEN }, fetchImpl: api.fetchImpl,
    markdown: MD([ROW(A, 29, "abcdef1", 1), ROW(B, 30, "abcdef2", 1)]) });
  assert.match(r.text, new RegExp(`${A}[\\s\\S]*?DELETED`));
  assert.match(r.text, /CURRENTLY PUBLISHED deploy/);
  const deletes = api.calls.filter((c) => c.method === "DELETE").map((c) => c.url);
  assert.equal(deletes.length, 1);
  assert.ok(deletes[0].endsWith(A));
  assert.equal(api.calls.filter((c) => c.method === "GET" && c.url.endsWith(`/sites/${PRODUCTION_SITE_ID}`)).length, 2, "one site read per row");
});

test("DL-8 --tier selects rows; order is tier 1 first; an already-deleted deploy is reported as gone, not an error", async () => {
  const api = fakeApi({ deploys: { [B]: preview(45, "abcdef2"), [C]: preview(46, "abcdef3") } });
  const md = MD([ROW(C, 46, "abcdef3", 3), ROW(A, 29, "abcdef1", 1), ROW(B, 45, "abcdef2", 2)]);
  const r1 = await go({ argv: ["--tier", "1"], env: {}, fetchImpl: api.fetchImpl, markdown: md });
  assert.match(r1.text, /1 of 3 listed deploys, tier 1/);
  assert.match(r1.text, /GONE: the API reports this deploy deleted/);
  assert.equal(r1.code, 0);
  const rAll = await go({ argv: [], env: {}, fetchImpl: api.fetchImpl, markdown: md });
  const order = [A, B, C].map((id) => rAll.text.indexOf(id));
  assert.ok(order[0] < order[1] && order[1] < order[2], "tier order, not list order");
});

test("DL-9 the token never appears in output, and is sent only as the Authorization header", async () => {
  const api = fakeApi({ deploys: { [A]: preview(29, "abcdef1") } });
  const r = await go({ argv: ["--apply"], env: { NETLIFY_AUTH_TOKEN: `  ${TOKEN}\n` }, fetchImpl: api.fetchImpl, markdown: MD([ROW(A, 29, "abcdef1", 1)]) });
  assert.ok(!r.text.includes(TOKEN), "not in any printed line");
  for (const c of api.calls) {
    assert.equal(c.auth, `Bearer ${TOKEN}`, "trimmed, and in the header");
    assert.ok(!c.url.includes(TOKEN), "never in a URL");
  }
  // The redactor itself: a line that somehow contained the token is masked.
  const lines = [];
  await run({ argv: ["--tier", "9"], env: { NETLIFY_AUTH_TOKEN: TOKEN }, fetchImpl: api.fetchImpl, out: (l) => lines.push(l), markdown: MD([ROW(A, 29, "abcdef1", 1)]) });
  assert.ok(!lines.join("\n").includes(TOKEN));
});

// ── --list production: old production-context deploys ──────────────────────

const PMD = (rows, keep) => `x\n<!-- PRODUCTION-KEEP:BEGIN -->\n\`\`\`production-keep\n${keep.join("\n")}\n\`\`\`\n<!-- PRODUCTION-KEEP:END -->\n` +
  `<!-- PRODUCTION-DELETE-LIST:BEGIN -->\n\`\`\`production-delete-list\n${rows.join("\n")}\n\`\`\`\n<!-- PRODUCTION-DELETE-LIST:END -->\n`;
const PROW = (id, commit, tier) => `${id} | ${commit} | ${tier}`;
const KROW = (id, commit, why) => `${id} | ${commit} | ${why}`;
const prodDep = (commit) => ({ site_id: PRODUCTION_SITE_ID, context: "production", review_id: null, commit_ref: commit + "0".repeat(40 - commit.length) });
const K = "dddddddddddddddddddddddd";
const KEEP = [KROW(PUBLISHED, "7ec5af4", "published"), KROW(K, "9937728", "rollback-target")];

test("DL-10 the committed production lists: 28 to delete, 4 kept, disjoint, the published deploy kept", () => {
  const { rows, keep } = readProductionLists(readFileSync(INVENTORY, "utf8"));
  assert.equal(rows.length, 28);
  assert.equal(keep.size, 4);
  assert.equal(keep.get(PUBLISHED), "published");
  assert.ok(!rows.some((r) => keep.has(r.id)));
  assert.equal(new Set(rows.map((r) => r.id)).size, 28);
});

test("DL-11 production mode: a production deploy on the list is deletable; dry run sends no DELETE", async () => {
  const api = fakeApi({ deploys: { [A]: prodDep("abcdef1") } });
  const r = await go({ argv: ["--list", "production"], env: {}, fetchImpl: api.fetchImpl, markdown: PMD([PROW(A, "abcdef1", 1)], KEEP) });
  assert.equal(r.code, 0);
  assert.match(r.text, /list production: 1 of 1 listed deploys/);
  assert.match(r.text, /would delete: old production deploy/);
  assert.equal(api.calls.filter((c) => c.method === "DELETE").length, 0);
});

test("DL-12 production mode refuses a deploy-preview; preview mode refuses a production deploy", async () => {
  const a = fakeApi({ deploys: { [A]: preview(29, "abcdef1") } });
  const r1 = await go({ argv: ["--list", "production", "--apply"], env: { NETLIFY_AUTH_TOKEN: TOKEN }, fetchImpl: a.fetchImpl, markdown: PMD([PROW(A, "abcdef1", 1)], KEEP) });
  assert.match(r1.text, /context is "deploy-preview", not production/);
  const b = fakeApi({ deploys: { [A]: prodDep("abcdef1") } });
  const r2 = await go({ argv: ["--apply"], env: { NETLIFY_AUTH_TOKEN: TOKEN }, fetchImpl: b.fetchImpl, markdown: MD([ROW(A, 29, "abcdef1", 1)]) });
  assert.match(r2.text, /context is "production", not deploy-preview/);
  assert.equal([...a.calls, ...b.calls].filter((c) => c.method === "DELETE").length, 0);
});

test("DL-13 a kept id is refused even when listed; a list overlapping the keep block is refused whole before any request", async () => {
  assert.throws(() => readProductionLists(PMD([PROW(K, "9937728", 1)], KEEP)), /in BOTH the production delete list and the keep list/);
  const api = fakeApi({ deploys: { [K]: prodDep("9937728") } });
  const r = await go({ argv: ["--list", "production", "--apply"], env: { NETLIFY_AUTH_TOKEN: TOKEN }, fetchImpl: api.fetchImpl, markdown: PMD([PROW(A, "abcdef1", 1), PROW(K, "9937728", 1)], KEEP) });
  assert.equal(r.code, 1);
  assert.equal(api.calls.length, 0, "refused at parse, nothing sent");
  assert.throws(() => readProductionLists(PMD([PROW(A, "abcdef1", 1)], [])), /PRODUCTION-KEEP block is empty/);
});

test("DL-14 production mode: the published deploy is re-read before EACH delete and refused when it matches", async () => {
  const api = fakeApi({ deploys: { [A]: prodDep("abcdef1"), [B]: prodDep("abcdef2") }, publishedSeq: [PUBLISHED, B] });
  const r = await go({ argv: ["--list", "production", "--apply"], env: { NETLIFY_AUTH_TOKEN: TOKEN }, fetchImpl: api.fetchImpl,
    markdown: PMD([PROW(A, "abcdef1", 1), PROW(B, "abcdef2", 1)], KEEP) });
  assert.match(r.text, /CURRENTLY PUBLISHED deploy/);
  const deletes = api.calls.filter((c) => c.method === "DELETE");
  assert.equal(deletes.length, 1);
  assert.ok(deletes[0].url.endsWith(A));
});

test("DL-15 an API record with state \"deleted\" is gone, not a candidate — and the read-back accepts it", async () => {
  const api = fakeApi({ deploys: { [A]: { ...prodDep("abcdef1"), state: "deleted" } } });
  const r = await go({ argv: ["--list", "production", "--apply"], env: { NETLIFY_AUTH_TOKEN: TOKEN }, fetchImpl: api.fetchImpl, markdown: PMD([PROW(A, "abcdef1", 1)], KEEP) });
  assert.match(r.text, /GONE: the API reports this deploy deleted/);
  assert.equal(api.calls.filter((c) => c.method === "DELETE").length, 0);
});

test("DL-16 --list takes only preview or production; the production parser refuses malformed rows", () => {
  assert.throws(() => parseArgs(["--list", "branch"]), /--list takes preview, preview-addendum or production/);
  assert.throws(() => readProductionLists(PMD([`${A} | abcdef1`], KEEP)), /malformed row/);
  assert.throws(() => readProductionLists(PMD([PROW(A, "abcdef1", 1), PROW(A, "abcdef1", 1)], KEEP)), /duplicate id/);
  assert.throws(() => readProductionLists("no blocks"), /no PRODUCTION-KEEP/);
});

test("DL-17 defence in depth: checkRow refuses a kept id before sending any request (the parse-time overlap check is the first line)", async () => {
  const api = fakeApi({ deploys: { [K]: prodDep("9937728") } });
  const http = async (method, path) => { const res = await api.fetchImpl(`https://x${path}`, { method, headers: {} }); return { status: res.status, body: await res.json().catch(() => null) }; };
  const v = await checkRow({ id: K, pr: null, commit: "9937728", tier: 1 }, http, { list: "production", keep: new Map([[K, "rollback-target"]]) });
  assert.equal(v.verdict, "refuse");
  assert.match(v.reason, /PRODUCTION-KEEP list \(rollback-target\)/);
  assert.equal(api.calls.length, 0);
});

// ── --list preview-addendum: the six #24–#28 previews ────────────────────────

test("DL-18 the committed addendum list: 6 ids, PRs 24–28, disjoint from the executed list, the production list and the keep list", () => {
  const md = readFileSync(INVENTORY, "utf8");
  const add = readDeleteList(md, { name: "PREVIEW-ADDENDUM-DELETE-LIST", fence: "preview-addendum-delete-list" });
  assert.equal(add.length, 6);
  assert.deepEqual([...new Set(add.map((r) => r.pr))].sort(), [24, 25, 26, 27, 28]);
  const executed = new Set(readDeleteList(md).map((r) => r.id));
  const { rows: prod, keep } = readProductionLists(md);
  const prodIds = new Set(prod.map((r) => r.id));
  for (const r of add) {
    assert.ok(!executed.has(r.id) && !prodIds.has(r.id) && !keep.has(r.id), r.id);
  }
  assert.equal(readDeleteList(md).length, 56, "the executed list is unchanged");
});

test("DL-19 addendum mode: a listed preview is deletable (dry run sends no DELETE); a production deploy on it is refused", async () => {
  const api = fakeApi({ deploys: { [A]: preview(24, "abcdef1"), [B]: prodDep("abcdef2") } });
  const r = await go({ argv: ["--list", "preview-addendum"], env: {}, fetchImpl: api.fetchImpl,
    markdown: AMD([ROW(A, 24, "abcdef1", 1), ROW(B, 25, "abcdef2", 1)]) });
  assert.match(r.text, /list preview-addendum: 2 of 2 listed deploys/);
  assert.match(r.text, /would delete: preview of PR #24/);
  assert.match(r.text, /context is "production", not deploy-preview/);
  assert.equal(api.calls.filter((c) => c.method === "DELETE").length, 0);
});

test("DL-20 every mode enforces the keep list: a preview list naming a kept id is refused whole, and a missing keep block refuses", async () => {
  const api = fakeApi({ deploys: { [A]: preview(24, "abcdef1") } });
  for (const [argv, md] of [
    [["--list", "preview-addendum", "--apply"], AMD([ROW(A, 24, "abcdef1", 1), ROW(PUBLISHED, 99, "7ec5af4", 1)])],
    [["--apply"], MD([ROW(A, 24, "abcdef1", 1), ROW(PUBLISHED, 99, "7ec5af4", 1)])],
  ]) {
    const r = await go({ argv, env: { NETLIFY_AUTH_TOKEN: TOKEN }, fetchImpl: api.fetchImpl, markdown: md });
    assert.equal(r.code, 1);
    assert.match(r.text, /is on the PRODUCTION-KEEP list; refusing the whole/);
  }
  assert.equal(api.calls.length, 0, "refused before any request");
  const noKeep = await go({ argv: ["--list", "preview-addendum"], env: {}, fetchImpl: api.fetchImpl,
    markdown: `<!-- PREVIEW-ADDENDUM-DELETE-LIST:BEGIN -->\n\`\`\`preview-addendum-delete-list\n${ROW(A, 24, "abcdef1", 1)}\n\`\`\`\n<!-- PREVIEW-ADDENDUM-DELETE-LIST:END -->\n` });
  assert.equal(noKeep.code, 1);
  assert.match(noKeep.text, /no PRODUCTION-KEEP/);
});

test("DL-21 addendum mode re-reads the published deploy before each delete", async () => {
  const api = fakeApi({ deploys: { [A]: preview(24, "abcdef1"), [B]: preview(25, "abcdef2") }, publishedSeq: [PUBLISHED, B] });
  const r = await go({ argv: ["--list", "preview-addendum", "--apply"], env: { NETLIFY_AUTH_TOKEN: TOKEN }, fetchImpl: api.fetchImpl,
    markdown: AMD([ROW(A, 24, "abcdef1", 1), ROW(B, 25, "abcdef2", 1)]) });
  assert.match(r.text, /CURRENTLY PUBLISHED deploy/);
  assert.deepEqual(api.calls.filter((c) => c.method === "DELETE").map((c) => c.url.slice(-24)), [A]);
});

test("DL-22 addendum mode checks the PR number and the commit against the row", async () => {
  const api = fakeApi({ deploys: { [A]: preview(25, "abcdef1"), [B]: preview(24, "1234567") } });
  const r = await go({ argv: ["--list", "preview-addendum", "--apply"], env: { NETLIFY_AUTH_TOKEN: TOKEN }, fetchImpl: api.fetchImpl,
    markdown: AMD([ROW(A, 24, "abcdef1", 1), ROW(B, 24, "abcdef2", 1)]) });
  assert.match(r.text, /review_id 25 != listed PR 24/);
  assert.match(r.text, /!= listed abcdef2/);
  assert.equal(api.calls.filter((c) => c.method === "DELETE").length, 0);
});
