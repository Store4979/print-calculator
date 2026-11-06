// scripts/tests/stage0-classify.lockstates.test.js — the fail-closed policy for lock
// timeouts and deadlocks (X3c; Codex's review of 1a7aff1, §1): after the receipt has
// bound and the envelope has parsed, a reported 55P03 or 40P01 is R4 before any profile
// can return R3, under every text and profile. Envelopes here are rendered, not
// receipts, except where a test names a real one; the executed helper-level cases are
// 4W-15's, from the harness.
//   LS-1  both states, with arbitrary words, on every route of every text: R4
//   LS-2  each was R3 under the old policy wherever the frames fit a profile, and no
//         receipt the old policy did not accept is accepted now
//   LS-3  the receipt checks and R1 keep their precedence; other R4 reasons keep theirs
//   LS-4  the controls: an unrelated state with those words, and 57014, are unchanged
//   LS-5  the real receipts classify as they did; the one history message that moves
//   LS-6  the rule, removed, makes its real negatives R3
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import * as C from "../manual/stage0-classify.mjs";
import { M, ROOT, ctx as ctxOf } from "./stage0-guard-fixture.mjs";

const ctx = ctxOf();
const STATES = ["55P03", "40P01"];
const WORDS = ["canceling statement due to lock timeout", "deadlock detected", "some other words", "x"];
const FRAME_RAISE = "PL/pgSQL function inline_code_block line 12 at RAISE";

/** The old policy: this module with the rule's one line removed, every relative import made absolute. */
const CLASSIFY = join(ROOT, "scripts", "manual", "stage0-classify.mjs");
const RULE = "    if (NEVER_RESOLVED_SQLSTATES.includes(env.sqlError.sqlstate)) return { class: \"R4\", outcome: \"UNRESOLVED\", reasons: [`the envelope reports SQLSTATE ${env.sqlError.sqlstate}, which rule 3′ never resolves, under any text or profile`], ...base };\n";
async function withOldPolicy(fn) {
  const dir = mkdtempSync(join(tmpdir(), "s0-lockstates-"));
  try {
    let s = readFileSync(CLASSIFY, "utf8").replace(/\r\n/g, "\n");
    assert.equal(s.split(RULE).length, 2, "the rule is one line, in one place");
    s = s.split(RULE).join("").replace(/from "(\.\.?\/[^"]+)"/g, (_, spec) => `from ${JSON.stringify(pathToFileURL(resolve(dirname(CLASSIFY), spec)).href)}`);
    const p = join(dir, "old-policy.mjs");
    writeFileSync(p, s);
    return await fn(await import(pathToFileURL(p).href));
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

/** A sender receipt of `text` for an envelope, bound as the sender binds it. */
function receipt(text, target, message, over = {}) {
  const pin = M.outputs[text];
  const ref = M.send.targets[target];
  return JSON.stringify({ tool: M.sender.path, text, target, ref, readOnly: M.send.texts[text].readOnly === true, requestMd5: pin.md5, requestBytes: pin.bytes, endpoint: M.send.endpoint.replace("{ref}", ref), startedAt: "2026-11-05T12:00:00.000Z", finishedAt: "2026-11-05T12:00:01.000Z", httpStatus: 400, body: JSON.stringify({ message }), error: null, tokenRedactedFromResponse: false, ...over });
}
const head = (state, words, sev = "ERROR") => `Failed to run sql query: ${sev}:  ${state}: ${words}\n`;
/** Each route a text has, as a message: the four ERROR profiles' frames, the last where the text executes an input. */
function routesOf(text, state, words) {
  const out = {
    "field-less": head(state, words),
    "re-raised": `${head(state, words)}CONTEXT:  ${FRAME_RAISE}\n`,
    "detail/hint re-raised": `${head(state, words)}DETAIL:  d\nHINT:  h\nCONTEXT:  ${FRAME_RAISE}\n`,
  };
  const input = (ctx.inputs[text] || [])[0];
  if (input !== undefined) out["executed input"] = `${head(state, words)}CONTEXT:  SQL statement "${input}"\nPL/pgSQL function inline_code_block line 7 at EXECUTE\n`;
  return out;
}
/** Every text with a send policy and an instantiated form, with the first target its policy names. */
const TEXTS = Object.entries(M.send.texts).filter(([k, p]) => p.targets.length && k !== "CANCEL-STEP-TEMPLATE").map(([k, p]) => [k, p.targets[0]]);

test("LS-1 both states, with arbitrary words, on every route of every text with a target: R4, naming the state, before any profile", () => {
  assert.deepEqual([...C.NEVER_RESOLVED_SQLSTATES], STATES);
  assert.ok(TEXTS.length >= 50);
  assert.ok(TEXTS.some(([k]) => (ctx.inputs[k] || []).length), "some text executes an input");
  let n = 0;
  for (const [text, target] of TEXTS) {
    for (const state of STATES) for (const words of WORDS) for (const [route, m] of Object.entries(routesOf(text, state, words))) {
      const c = C.classifyText(receipt(text, target, m), ctx);
      assert.equal(c.class, "R4", `${text} ${state} ${route}`);
      assert.equal(c.outcome, "UNRESOLVED");
      assert.equal(c.reasons[0], `the envelope reports SQLSTATE ${state}, which rule 3′ never resolves, under any text or profile`, `${text} ${route}`);
      n++;
    }
  }
  assert.ok(n > 800, `${n} cases`);
  // FATAL too, with T2's own bound PERFORM frames.
  for (const state of STATES) {
    const m = `${head(state, "x", "FATAL")}CONTEXT:  SQL statement "SELECT pg_sleep(30)"\nPL/pgSQL function inline_code_block line 3 at PERFORM\n`;
    assert.equal(C.classifyText(receipt("LOCKPROBE-B-TXTIMEOUT", "staging", m), ctx).class, "R4", state);
  }
});

test("LS-2 R3 to R4 wherever it was accepted, and nothing newly accepted: under the old policy each frame that fits a profile was R3; every other outcome is the same under both", async () => {
  await withOldPolicy(async (Old) => {
    let flipped = 0;
    const bodies = [];
    for (const [text, target] of TEXTS) {
      for (const state of [...STATES, "42501", "P0001", "57014", "23505", "42P01", "25P04", "XX000"]) for (const words of WORDS) for (const [route, m] of Object.entries(routesOf(text, state, words))) bodies.push({ text, target, state, route, m });
      // Forms no profile admits, and a FATAL with the wrong state.
      bodies.push({ text, target, state: "55P03", route: "two frames", m: `${head("55P03", "x")}CONTEXT:  ${FRAME_RAISE}\n${FRAME_RAISE}\n` });
      bodies.push({ text, target, state: "40P01", route: "FATAL field-less", m: head("40P01", "x", "FATAL") });
    }
    for (const b of bodies) {
      const was = Old.classifyText(receipt(b.text, b.target, b.m), ctx);
      const now = C.classifyText(receipt(b.text, b.target, b.m), ctx);
      const label = `${b.text} ${b.state} ${b.route}`;
      if (["R2", "R3"].includes(now.class)) assert.equal(was.class, now.class, `${label}: nothing is newly accepted`);
      if (STATES.includes(b.state) && was.class === "R3") {
        assert.equal(now.class, "R4", label);
        flipped++;
      } else {
        assert.equal(now.class, was.class, label);
        assert.equal(now.profile, was.profile, label);
      }
      if (STATES.includes(b.state)) assert.equal(now.class, "R4", label);
    }
    assert.ok(flipped > 800, `${flipped} formerly accepted`);
  });
});

test("LS-3 the receipt checks and R1 keep their precedence: a receipt that does not bind is R1 whatever it reports; other R4 reasons keep theirs; a 201 is judged by its predicate", () => {
  const m = head("55P03", "x");
  for (const [label, over, re] of [
    ["the request's md5", { requestMd5: "0".repeat(32) }, /md5|pin/i],
    ["another ref", { ref: "abcdefghijklmnopqrst" }, /ref/i],
    ["a sender error", { error: "TypeError: reset", body: null }, /error|body/i],
    ["no body", { body: null }, /body/i],
  ]) {
    const c = C.classifyText(receipt("P2-02", "production", m, over), ctx);
    assert.equal(c.class, "R1", label);
    assert.match(c.reasons.join("; "), re, label);
  }
  const leak = C.classifyText(receipt("P2-02", "production", m, { tokenRedactedFromResponse: true }), ctx);
  assert.equal(leak.class, "R1");
  assert.equal(leak.tokenExposed, true);
  // Not an envelope the parser accepts: the parser's reason, R4.
  const line = C.classifyText(receipt("P2-02", "production", `${head("55P03", "x")}LINE 1: y\n`), ctx);
  assert.equal(line.class, "R4");
  assert.match(line.reasons[0], /^not a supported SQL-error envelope/);
  // An unobserved status is its own R4, and a 201 quoting the state is judged by its predicate.
  const status = C.classifyText(receipt("P2-02", "production", m, { httpStatus: 500 }), ctx);
  assert.equal(status.class, "R4");
  assert.match(status.reasons[0], /neither a success nor an observed SQL-error status/);
  const quoted = C.classifyText(receipt("P2-02", "production", m, { httpStatus: 201, body: JSON.stringify([{ note: "55P03" }]) }), ctx);
  assert.equal(quoted.class, "R4");
  assert.match(quoted.reasons[0], /a 201 that is not P2-02's contracted success/);
  assert.equal(C.classifyText(receipt("P2-02", "production", m, { httpStatus: 201, body: '[{"set_config":"45s"}]' }), ctx).class, "R2");
  // A body beside its message is the body's reason, not the state's.
  const extra = C.classifyText(receipt("P2-02", "production", m, { body: JSON.stringify({ message: m, more: 1 }) }), ctx);
  assert.equal(extra.class, "R4");
  assert.match(extra.reasons[0], /exactly \{"message"/);
});

test("LS-4 the controls: an unrelated SQLSTATE whose words say deadlock or lock timeout stays under the profiles; 57014 and 25P04 stay under their existing rules", () => {
  for (const words of ["deadlock detected", "canceling statement due to lock timeout", "55P03", "40P01", "ERROR:  40P01: deadlock detected"]) {
    for (const [route, m] of Object.entries(routesOf("P2-02", "42P01", words))) {
      const c = C.classifyText(receipt("P2-02", "production", m), ctx);
      assert.deepEqual([c.class, c.profile], ["R3", route], `${words}: ${route}`);
    }
  }
  for (const [route, m] of Object.entries(routesOf("P2-02", "57014", "canceling statement due to statement timeout"))) {
    const c = C.classifyText(receipt("P2-02", "production", m), ctx);
    assert.deepEqual([c.class, c.profile], ["R3", route], `57014: ${route}`);
  }
  const t2 = `${head("25P04", "terminating connection due to transaction timeout", "FATAL")}CONTEXT:  SQL statement "SELECT pg_sleep(30)"\nPL/pgSQL function inline_code_block line 3 at PERFORM\n`;
  const fatal = C.classifyText(receipt("LOCKPROBE-B-TXTIMEOUT", "staging", t2), ctx);
  assert.deepEqual([fatal.class, fatal.profile], ["R3", "transaction-timeout PERFORM"]);
  assert.equal(C.PROFILES.length, 5, "no profile was added or removed");
});

/** Every sender receipt the repository holds: the classifier's fixtures and item 3's evidence. */
function realReceipts() {
  const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
  const dirs = [join(ROOT, "scripts", "tests", "fixtures", "stage0-classify", "real"), join(ROOT, "docs", "security", "evidence", "stage0-item3", "item3-E-receipts"), join(ROOT, "docs", "security", "evidence", "stage0-item3", "item3-X-receipts")];
  return dirs.flatMap(walk).filter((p) => p.endsWith(".json")).map((p) => ({ p, text: readFileSync(p, "utf8") }));
}

test("LS-5 no real receipt reports either state, so each classifies exactly as under the old policy, the lock-probe witness A2 included; the one execute_sql history message that reported 55P03 is what moves", async () => {
  await withOldPolicy(async (Old) => {
    const real = realReceipts();
    assert.ok(real.length >= 40, `${real.length} receipts`);
    const counts = {};
    for (const { p, text } of real) {
      assert.doesNotMatch(text, /ERROR: {2}(55P03|40P01):/, p);
      const was = Old.classifyText(text, ctx), now = C.classifyText(text, ctx);
      assert.equal(now.class, was.class, p);
      assert.equal(now.profile, was.profile, p);
      counts[now.class] = (counts[now.class] ?? 0) + 1;
    }
    assert.ok(counts.R3 >= 1 && counts.R2 >= 1, JSON.stringify(counts));
    // A2, the witness of "re-raised" that the lock probe gave: P0001 in its own words, and still R3.
    const a2 = real.find(({ p }) => p.includes("LOCKPROBE-B-LOCKTIMEOUT"));
    assert.match(C.strictJson(a2.text).body, /ERROR: {2}P0001: lockprobe B-LOCKTIMEOUT/);
    assert.deepEqual([C.classifyText(a2.text, ctx).class, C.classifyText(a2.text, ctx).profile], ["R3", "re-raised"]);
    // N5 scenario 1, the real lock timeout the lock probe's handler re-raised, seen through execute_sql and never a sender receipt: R3 before, R4 now.
    const hist = JSON.parse(readFileSync(join(ROOT, "scripts", "tests", "fixtures", "stage0-classify", "execute-sql-history.json"), "utf8"));
    const entries = hist.messages.filter((x) => /ERROR: {2}(55P03|40P01):/.test(x.message));
    assert.equal(entries.length, 1);
    assert.match(entries[0].what, /^N5 scenario 1: 55P03 lock timeout, re-raised by the probe handler/);
    const body = (m) => receipt("LOCKPROBE-B-LOCKTIMEOUT", "staging", m);
    assert.equal(Old.classifyText(body(entries[0].message), ctx).class, "R3");
    assert.equal(C.classifyText(body(entries[0].message), ctx).class, "R4");
  });
});

test("LS-6 the rule, removed, makes the real negatives R3: it is what closes both routes", async () => {
  await withOldPolicy(async (Old) => {
    for (const state of STATES) for (const route of ["field-less", "re-raised", "detail/hint re-raised", "executed input"]) {
      const m = routesOf("P2-02", state, "any words")[route];
      const was = Old.classifyText(receipt("P2-02", "production", m), ctx);
      assert.deepEqual([was.class, was.profile], ["R3", route], `${state}: ${route}`);
      assert.equal(C.classifyText(receipt("P2-02", "production", m), ctx).class, "R4", `${state}: ${route}`);
    }
  });
});
