// scripts/tests/stage0-send.test.js — the pinned sender
// (scripts/manual/stage0-send.mjs; plan §E1 "The transport", review of
// 07574c1). No test here reaches the network: live sends go only to a local
// mock server on 127.0.0.1.
//
//   SEND-1 every text in the manifest's send policy, on every target it
//          allows, passes --dry-run: md5 and bytes equal the manifest, the
//          ref is the target's, and no request is made
//   SEND-2 a manifest whose pinned md5 or byte count is wrong is refused
//   SEND-3 a target the policy does not allow, or an unknown one, is refused
//   SEND-4 a live send without the token, with a token that is not a
//          personal access token, or without --confirm-ref is refused before
//          any request; the token is never taken from argv
//   SEND-5 against a mock server: the request is POST to
//          /v1/projects/<ref>/database/query; its JSON body carries exactly the
//          manifest's bytes (and read_only only where the policy says); the
//          token appears only in the Authorization header — never in the URL,
//          another header, the body, the results file or the console
//   SEND-6 a response that echoes the token is redacted before it is written
//          or printed; a network failure is recorded, never thrown
//   SEND-7 --cancel instantiates the pinned template only, for a stage-0 step
//          and an exact backend_start
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { main, planSend, send, TOKEN_ENV } from "../manual/stage0-send.mjs";
import { manifestAt, md5 } from "../manual/assemble-stage0.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const M = manifestAt("HEAD", ROOT);
const TOKEN = "sbp_" + "0123456789abcdef".repeat(2) + "c3test";
const noFetch = () => { throw new Error("a network call was made"); };
const capture = () => { const lines = []; return { out: (s) => lines.push(s), text: () => lines.join("") }; };
const clone = (x) => JSON.parse(JSON.stringify(x));

test("SEND-1 every policy text on every allowed target passes --dry-run with the manifest's md5 and bytes, and makes no request", async () => {
  const entries = Object.entries(M.send.texts);
  assert.ok(entries.length >= 20, "the policy covers every output");
  for (const [name, policy] of entries) {
    for (const target of policy.targets) {
      const c = capture();
      const argv = policy.instantiate === "cancel"
        ? ["--cancel", "P2-0304", "2026-10-01T12:00:00.123456Z", "--target", target, "--dry-run"]
        : [name, "--target", target, "--dry-run"];
      const r = await main(argv, {}, { stdout: c.out, fetchImpl: noFetch, manifest: M });
      assert.equal(r.dryRun, true);
      assert.equal(r.plan.ref, M.send.targets[target], `${name} → ${target}`);
      if (policy.instantiate !== "cancel") {
        assert.equal(r.plan.md5, M.outputs[name].md5, `${name} md5`);
        assert.equal(r.plan.bytes, M.outputs[name].bytes, `${name} bytes`);
      } else {
        assert.equal(r.plan.template.md5, M.outputs[name].md5, "the template is the pinned one");
      }
      assert.equal(r.plan.readOnly, policy.readOnly === true);
      assert.match(c.text(), /dry run: verified against the manifest; no network call made/);
    }
  }
});

test("SEND-2 a wrong pinned md5 or byte count is refused", () => {
  const bad = clone(M); bad.outputs.P0.md5 = "0".repeat(32);
  assert.throws(() => planSend(bad, "P0", "production"), /but the manifest pins 0{32}.*refusing/);
  const bad2 = clone(M); bad2.outputs["SIZE-PROBE"].bytes += 1;
  assert.throws(() => planSend(bad2, "SIZE-PROBE", "staging"), /refusing/);
  const bad3 = clone(M); bad3.outputs["CANCEL-STEP-TEMPLATE"].md5 = "f".repeat(32);
  assert.throws(() => planSend(bad3, "CANCEL-STEP-TEMPLATE", "production", { cancel: { step: "P1", backendStart: "2026-10-01T12:00:00.123456Z" } }), /refusing/);
});

test("SEND-3 a target the policy does not allow, an unknown target or an unknown text is refused", () => {
  assert.throws(() => planSend(M, "P1", "staging"), /P1 may not be sent to staging; the manifest allows production/);
  assert.throws(() => planSend(M, "P2-0304", "staging"), /may not be sent to staging/);
  assert.throws(() => planSend(M, "STATE", "staging"), /may not be sent to staging/);
  assert.throws(() => planSend(M, "RB-43", "staging"), /may not be sent to staging/);
  assert.throws(() => planSend(M, "LOCKPROBE-B-POSITIVE", "production"), /may not be sent to production; the manifest allows staging/);
  assert.throws(() => planSend(M, "SIZE-PROBE", "production"), /may not be sent to production/);
  assert.throws(() => planSend(M, "P0", "gmxyisjjaxtpycsmmzef"), /unknown target/);
  assert.throws(() => planSend(M, "P0", "prod"), /unknown target "prod"/);
  assert.throws(() => planSend(M, "NOT-A-TEXT", "production"), /is not a sendable text/);
  const widened = clone(M); widened.send.targets.production = "lboajqihpsfrokqvjgnl";
  assert.equal(planSend(widened, "P0", "production").ref, "lboajqihpsfrokqvjgnl", "planSend trusts the manifest it is given…");
  // …which is why main() reads the manifest from git HEAD, and M-12 fixes the
  // targets' refs: stage0-manifest.test.js fails on this manifest.
});

test("SEND-4 no request without the token, a personal access token and --confirm-ref; argv never carries the token", async () => {
  const base = ["SIZE-PROBE", "--target", "staging", "--confirm-ref", "lboajqihpsfrokqvjgnl"];
  await assert.rejects(main(base, {}, { fetchImpl: noFetch, stdout: () => {} }), /SUPABASE_ACCESS_TOKEN is not set; refusing/);
  await assert.rejects(main(base, { [TOKEN_ENV]: "" }, { fetchImpl: noFetch, stdout: () => {} }), /is not set/);
  await assert.rejects(main(base, { [TOKEN_ENV]: "sb_secret_notapat" }, { fetchImpl: noFetch, stdout: () => {} }), /not a Supabase personal access token/);
  await assert.rejects(main(["SIZE-PROBE", "--target", "staging"], { [TOKEN_ENV]: TOKEN }, { fetchImpl: noFetch, stdout: () => {} }), /--confirm-ref must repeat the target's project ref lboajqihpsfrokqvjgnl/);
  await assert.rejects(main(["P1", "--target", "production", "--confirm-ref", "lboajqihpsfrokqvjgnl"], { [TOKEN_ENV]: TOKEN }, { fetchImpl: noFetch, stdout: () => {} }), /--confirm-ref must repeat/);
  for (const flag of ["--token", "--access-token", "--header"]) {
    const err = await main([...base, flag, TOKEN], {}, { fetchImpl: noFetch, stdout: () => {} }).catch((e) => e);
    assert.match(err.message, /unknown option|unexpected argument/, flag);
    assert.ok(!err.message.includes(TOKEN), "a token passed on argv is never echoed");
  }
  const err = await main([TOKEN, "--target", "staging", "--dry-run"], {}, { fetchImpl: noFetch, stdout: () => {} }).catch((e) => e);
  assert.ok(!err.message.includes(TOKEN), "an unknown text name is not echoed when it has a token's shape");
});

function mockServer(respond) {
  const seen = [];
  const server = createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks);
      seen.push({ method: req.method, url: req.url, headers: req.headers, rawHeaders: req.rawHeaders, body: raw });
      const { status, body } = respond(raw);
      res.writeHead(status, { "content-type": "application/json" });
      res.end(body);
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, seen, base: `http://127.0.0.1:${server.address().port}` })));
}

test("SEND-5 against a mock server: exact manifest bytes in the body, read_only only where the policy says, the token only in Authorization", async () => {
  const mock = await mockServer(() => ({ status: 201, body: JSON.stringify([{ ok: 1 }]) }));
  const dir = mkdtempSync(join(tmpdir(), "s0-send-"));
  try {
    const cases = [
      ["SIZE-PROBE", "staging", "lboajqihpsfrokqvjgnl", true],
      ["P2-0304", "production", "gmxyisjjaxtpycsmmzef", false],
      ["STATE", "production", "gmxyisjjaxtpycsmmzef", true],
    ];
    for (const [name, target, ref, ro] of cases) {
      const c = capture();
      const r = await main([name, "--target", target, "--confirm-ref", ref], { [TOKEN_ENV]: TOKEN },
        { apiBase: mock.base, resultsDir: dir, stdout: c.out });
      const req = mock.seen.at(-1);
      assert.equal(req.method, "POST");
      assert.equal(req.url, `/v1/projects/${ref}/database/query`);
      assert.equal(req.headers["content-type"], "application/json");
      assert.equal(req.headers.authorization, `Bearer ${TOKEN}`);
      const body = JSON.parse(req.body.toString("utf8"));
      assert.deepEqual(Object.keys(body).sort(), ro ? ["query", "read_only"] : ["query"], `${name}: body keys`);
      if (ro) assert.equal(body.read_only, true);
      assert.equal(md5(body.query), M.outputs[name].md5, `${name}: the query's md5 is the manifest's`);
      assert.equal(Buffer.byteLength(body.query), M.outputs[name].bytes, `${name}: the query's bytes are the manifest's`);
      // The token: in the Authorization header, and nowhere else.
      const others = req.rawHeaders.filter((_, i) => i % 2 === 1 && req.rawHeaders[i - 1].toLowerCase() !== "authorization");
      assert.ok(!others.join("\n").includes(TOKEN), "not in another header");
      assert.ok(!req.url.includes(TOKEN), "not in the URL");
      assert.ok(!req.body.toString("utf8").includes(TOKEN), "not in the body");
      const file = readFileSync(r.file, "utf8");
      assert.ok(!file.includes(TOKEN), "not in the results file");
      assert.ok(!c.text().includes(TOKEN), "not on the console");
      const rec = JSON.parse(file);
      assert.equal(rec.httpStatus, 201);
      assert.equal(rec.requestMd5, M.outputs[name].md5);
      assert.equal(rec.requestBytes, M.outputs[name].bytes);
      assert.equal(rec.ref, ref);
      assert.ok(rec.startedAt && rec.finishedAt);
      assert.equal(rec.body, JSON.stringify([{ ok: 1 }]));
    }
    assert.equal(readdirSync(dir).length, cases.length, "one results file per send");
  } finally { mock.server.closeAllConnections(); mock.server.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("SEND-6 a response that echoes the token is redacted; a network failure is recorded, not thrown", async () => {
  const mock = await mockServer(() => ({ status: 400, body: JSON.stringify({ message: "bad request from " + TOKEN }) }));
  const dir = mkdtempSync(join(tmpdir(), "s0-send-"));
  try {
    const c = capture();
    const r = await main(["P0", "--target", "production", "--confirm-ref", "gmxyisjjaxtpycsmmzef"], { [TOKEN_ENV]: TOKEN },
      { apiBase: mock.base, resultsDir: dir, stdout: c.out });
    const file = readFileSync(r.file, "utf8");
    assert.ok(!file.includes(TOKEN) && !c.text().includes(TOKEN));
    assert.match(file, /REDACTED: the access token/);
    assert.equal(JSON.parse(file).tokenRedactedFromResponse, true);
  } finally { mock.server.closeAllConnections(); mock.server.close(); rmSync(dir, { recursive: true, force: true }); }
  const plan = planSend(M, "SIZE-PROBE", "staging");
  const rec = await send(plan, { token: TOKEN, fetchImpl: async () => { throw new TypeError("fetch failed"); } });
  assert.equal(rec.httpStatus, null);
  assert.equal(rec.error, "TypeError: fetch failed");
});

test("SEND-7 --cancel instantiates only the pinned template, only for a stage-0 step and an exact backend_start", async () => {
  const ok = planSend(M, "CANCEL-STEP-TEMPLATE", "production", { cancel: { step: "P2-0304", backendStart: "2026-10-01T12:00:00.123456Z" } });
  assert.match(ok.text, /v_app\s+constant text := 'release2-stage0-P2-0304';/);
  assert.equal(ok.template.md5, M.outputs["CANCEL-STEP-TEMPLATE"].md5);
  assert.throws(() => planSend(M, "CANCEL-STEP-TEMPLATE", "production"), /is a template/);
  assert.throws(() => planSend(M, "CANCEL-STEP-TEMPLATE", "production", { cancel: { step: "P2-03", backendStart: "2026-10-01T12:00:00.123456Z" } }), /not a stage-0 step/);
  assert.throws(() => planSend(M, "CANCEL-STEP-TEMPLATE", "production", { cancel: { step: "P1", backendStart: "2026-10-01 12:00:00" } }), /backend_start/);
  assert.throws(() => planSend(M, "P0", "production", { cancel: { step: "P1", backendStart: "2026-10-01T12:00:00.123456Z" } }), /applies only to CANCEL-STEP-TEMPLATE/);
  assert.throws(() => planSend(M, "CANCEL-STEP-TEMPLATE", "staging", { cancel: { step: "P1", backendStart: "2026-10-01T12:00:00.123456Z" } }), /may not be sent to staging/);
});
