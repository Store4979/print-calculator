// scripts/tests/stage0-4c.mutation.test.js — the comparator's mutation
// companion (the implementation outline's X2; I3-M1's form). Each named check
// of scripts/manual/stage0-4c-compare.mjs is removed, by an exact edit of a
// copy of the module, and its negative, which only that check catches, must
// turn into exactly an acceptance (no STOP), never an exception. The original
// refuses each one with its reason.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as C from "../manual/stage0-4c-compare.mjs";
import { M, ROOT } from "./stage0-guard-fixture.mjs";
import { readingRows, edited } from "./stage0-4c-fixture.mjs";

const SRC = readFileSync(join(ROOT, "scripts", "manual", "stage0-4c-compare.mjs"), "utf8");
const bump = (key, by) => (rows) => { const r = rows.find((x) => x.key === key); r.value = String(Number(r.value) + by); };
const otherRows = (K, base) => Object.fromEntries(["01", "02", "04", "05"].map((s) => [s, K.otherRoleRows(M, base, s)]));
const post = (K, o, step, base, previous, previousState, recordedOrders = 0) =>
  K.postFindings(M, o, { step, target: "rehearsal", baseline: base, previous, previousState, otherRows: otherRows(K, base), recordedOrders });
const ledgerOf = (rows) => rows.filter((r) => r.part === 1 && /^row\|/.test(r.key)).map((r) => r.key.slice(4)).sort();

/** [name, [exact text, replacement], scenario(K) → findings, the original's reason]. */
const MUTANTS = [
  ["V-2's value check", ["else if (have[k] !== v) out.push(", "else if (false) out.push("],
    (K) => { const b = K.readObservation(readingRows("c-01.json")); return post(K, edited(K, "c-P2-02.json", (rows) => { rows.find((r) => r.key === "exec-r2|anon|public.release2_clear_lockout(text, text, uuid)").value = "true"; }), "P2-02", b, b, "01"); },
    /V-2: EXECUTE is true/],
  // Removed, a missing row passes: the value check after it is skipped too.
  ["V-2's missing-row check", ["if (!Object.hasOwn(have, k)) out.push(stop(4, k, `V-2: the reviewed row is missing (state ${state})`));", "if (!Object.hasOwn(have, k)) continue;"],
    (K) => { const b = K.readObservation(readingRows("c-01.json")); return post(K, edited(K, "c-P2-05.json", (rows) => rows.splice(rows.findIndex((r) => r.key === "exec-r2|service_role|public.release2_revoke_enrollment(uuid, uuid, text)"), 1)), "P2-05", b, K.readObservation(readingRows("c-P2-0304.json")), "04"); },
    /V-2: the reviewed row is missing/],
  ["V-2's extra-row check", ["for (const k of Object.keys(have)) if (!Object.hasOwn(want, k)) out.push(stop(4, k, `V-2: an unexplained", "for (const k of Object.keys(have)) if (false) out.push(stop(4, k, `V-2: an unexplained"],
    (K) => { const b = K.readObservation(readingRows("c-01.json")); return post(K, edited(K, "c-P2-0304.json", (rows) => rows.push({ part: 4, key: "exec-r2|anon|public.release2_clear_lockout(text, text, uuid)", value: "false" })), "P2-0304", b, K.readObservation(readingRows("c-P2-02.json")), "02"); },
    /V-2: an unexplained extra row/],
  ["the other roles' bound rows", ["else out.push(...sameFacts(4, others, otherRows[s.catalog]", "else out.push(...[].slice(4, others, otherRows[s.catalog]"],
    (K) => { const b = K.readObservation(readingRows("c-01.json")); return post(K, edited(K, "c-P2-02.json", (rows) => rows.push({ part: 4, key: "exec-r2|stranger|public.release2_clear_lockout(text, text, uuid)", value: "true" })), "P2-02", b, b, "01"); },
    /not in the bound rows for the other roles/],
  ["the step's ledger-row count", ["if (added.length !== s.adds.length) out.push(", "if (false) out.push("],
    (K) => {
      const b = K.readObservation(readingRows("c-01.json"));
      const one = ledgerOf(readingRows("c-01.json")).at(-1);
      return post(K, edited(K, "c-P2-02.json", (rows) => {
        const v = ledgerOf(rows).at(-1);
        rows.splice(rows.findIndex((r) => r.key === `row|${v}`), 1);
        rows.find((r) => r.key === "count").value = "21";
        rows.find((r) => r.key === "head").value = one;
      }), "P2-02", b, b, "01");
    },
    /the step added 0 ledger rows; P2-02 adds 1/],
  ["the step's ledger-row identity", ["if (r.value !== asRow(name, file.md5, file.bytes, manifest.ledgerRow.createdBy)) out.push(", "if (false) out.push("],
    (K) => { const b = K.readObservation(readingRows("c-01.json")); return post(K, edited(K, "c-P2-02.json", (rows) => { const v = ledgerOf(rows).at(-1); const r = rows.find((x) => x.key === `row|${v}`); r.value = r.value.replace(/\|[0-9a-f]{32}\|/, "|00000000000000000000000000000000|"); }), "P2-02", b, b, "01"); },
    /not release2_02_auth_attempts_fn with its pinned md5 and bytes/],
  ["P0′'s beyond-01 check", ["if (R2_EXEC.test(k) && !Object.keys(V2_EXEC[\"01\"]).some((sig) => k.endsWith(`|public.${sig}`))) out.push(", "if (false) out.push("],
    (K) => K.p0Findings(M, edited(K, "c-01.json", (rows) => rows.push({ part: 4, key: "exec-r2|postgres|public.release2_prune_auth_attempts(integer)", value: "true" })), { target: "production" }),
    /a Release 2 row beyond 01's/],
  ["P0′'s rehearsal-marker check", ["if (p10.rehearsal_marker !== marker) out.push(", "if (false) out.push("],
    (K) => K.p0Findings(M, K.readObservation(readingRows("c-01.json")), { target: "rehearsal" }),
    /the rehearsal marker is false on rehearsal/],
  ["the rehearsal's orders check", ["if (Number.isInteger(recordedOrders) && Number(obs.parts[10][k]) !== Number(previous.parts[10][k]) + recordedOrders) out.push(", "if (false) out.push("],
    (K) => { const b = K.readObservation(readingRows("c-01.json")); return post(K, edited(K, "c-P2-02.json", bump("count|public.orders", 1)), "P2-02", b, b, "01", 0); },
    /orders did not grow by exactly the 0 recorded/],
  ["the data scope's STOP rows", ["for (const k of DATA_SCOPE.stop) if (after.parts[10][k] !== before.parts[10][k]) out.push(", "for (const k of DATA_SCOPE.stop) if (false) out.push("],
    (K) => K.dataScope(K.readObservation(readingRows("c-01.json")), edited(K, "c-01.json", bump("count|public.employees", 1))),
    /differs from the window-start P0′; not read as proof that P1′ committed/],
  ["a residual's record", ["out.push(typeof rec === \"string\" && rec.trim() ?", "out.push(true ?"],
    (K) => { const p = K.readObservation(readingRows("c-01.json")); return K.crossProject(p, edited(K, "c-01.json", (rows) => { rows.find((r) => r.key === "version").value += " (another build)"; }), { creator: "postgres", records: { "R-AUTHCFG": "no owner sign-in claimed" } }); },
    /R-IMG: the image's version string differs, with no record/],
  ["a part's md5 check", ["else if (partMd5(parts[p]) !== md5s[p]) problems.push(", "else if (false) problems.push("],
    (K) => K.p0Findings(M, K.readObservation(readingRows("c-01.json").map((r) => (r.key === "count|public.orders" ? { ...r, value: "9" } : r))), { target: "production" }),
    /part 10's rows do not reproduce its md5/],
];

test("4C-M1 each named check of the comparator, removed, turns its negative into exactly an acceptance; the original refuses it with its reason", async () => {
  const dir = mkdtempSync(join(tmpdir(), "s0-4c-mutants-"));
  try {
    for (const [n, [name, [from, to], scenario, reason]] of MUTANTS.entries()) {
      assert.equal(SRC.split(from).length, 2, `${name}: the edit names exactly one place`);
      const orig = scenario(C);
      assert.match(C.blocking(orig).map((f) => f.reason).join(" | "), reason, `${name}: the original refuses with its reason`);
      const file = join(dir, `m${n}.mjs`);
      writeFileSync(file, SRC.replace(from, to));
      const K = await import(pathToFileURL(file).href);
      let out, err = null;
      try { out = scenario(K); } catch (e) { err = e; }
      assert.equal(err, null, `${name}: the mutant gave an exception, not an acceptance: ${err && err.message}`);
      assert.deepEqual(K.blocking(out).map((f) => f.reason), [], `${name}: the mutant accepts its negative`);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
