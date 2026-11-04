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
import { readingRows, edited, json } from "./stage0-4c-fixture.mjs";

const SRC = readFileSync(join(ROOT, "scripts", "manual", "stage0-4c-compare.mjs"), "utf8");
const bump = (key, by) => (rows) => { const r = rows.find((x) => x.key === key); r.value = String(Number(r.value) + by); };
const otherRows = (K, base) => Object.fromEntries(["01", "02", "04", "05"].map((s) => [s, K.otherRoleRows(M, base, s)]));
const post = (K, o, step, base, previous, previousState, recordedOrders = 0) =>
  K.postFindings(M, o, { step, target: "rehearsal", baseline: base, previous, previousState, otherRows: otherRows(K, base), recordedOrders });
const ledgerOf = (rows) => rows.filter((r) => r.part === 1 && /^row\|/.test(r.key)).map((r) => r.key.slice(4)).sort();
const SAME_IMAGE = { production: "17.6.1.111", rehearsal: "17.6.1.111" };
const ALL_GENERIC = { "R-IMG": "generic", "R-VER": "generic", "R-EXT": "generic", "R-SET": "generic", "R-AUTHCFG": "generic" };
const cross = (K, a, b, records = ALL_GENERIC, images = SAME_IMAGE) => K.crossProject(a, b, { creator: "postgres", records, images });
const setRows = (name, values) => (K) => edited(K, name, (rows) => { for (const [k, v] of Object.entries(values)) rows.find((r) => r.key === k).value = v; });
const dropRows = (name, keys) => (K) => edited(K, name, (rows) => { for (const k of keys) rows.splice(rows.findIndex((r) => r.key === k), 1); });
const atVersion = (num, version) => setRows("c-01.json", { server_version_num: num, version });
const ledger = (name) => json(`l-${name}.json`).ordinary;
const withFact = (name, key, value) => ledger(name).map((r) => (r.key === key ? { ...r, value } : r));
const EMPTY_DOC_CHECK = "if (facts.status === \"empty\" && facts.rows !== LEDGER_EMPTY_DOCUMENT) out.push(";
const ABSENT_RELATION = "if (facts.relation !== \"\") out.push(";
const ABSENT_COLUMNS = "if (facts.columns !== \"\") out.push(";
const ABSENT_RELATION_FACT = "else if (want.absent) out.push(stop(\"ledger\", k,";
const SCHEMA_FACT = "if (facts.schema !== want.schema) out.push(";
const RELATION_FORM = "if (facts.relation !== LEDGER_RELATION) out.push(";

/**
 * [name, [exact text, replacement], scenario(K) → findings, the original's
 * reason]. A row naming a function runs the scenario's result through it (K's
 * own, on the mutant).
 */
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
  ["a residual's record", ["out.push(rec ? finding(", "out.push(true ? finding("],
    (K) => { const p = K.readObservation(readingRows("c-01.json")); return cross(K, p, edited(K, "c-01.json", (rows) => { rows.find((r) => r.key === "version").value += " (another build)"; }), { "R-AUTHCFG": "no owner sign-in claimed" }); },
    /R-VER: version\(\) differs at one server_version_num: a different build, with no record/],
  // R3
  ["the server_version_num comparison", ["if (num(prod) !== num(reh)) out.push(", "if (false) out.push("],
    (K) => cross(K, atVersion("170005", "same")(K), atVersion("170006", "same")(K)),
    /a major or minor server change is reviewed: 170005 and 170006/],
  ["the major change, the same check", ["if (num(prod) !== num(reh)) out.push(", "if (false) out.push("],
    (K) => cross(K, atVersion("170006", "same")(K), atVersion("180000", "same")(K)),
    /a major or minor server change is reviewed: 170006 and 180000/],
  ["a same-number build's record", ["else residual(9, \"version\", \"R-VER\", \"version() differs at one server_version_num: a different build\");", "else out.push(finding(\"MATCH\", 9, \"version\", \"equal\"));"],
    (K) => cross(K, atVersion("170005", "one build")(K), atVersion("170005", "another build")(K), { "R-AUTHCFG": "x" }),
    /R-VER: version\(\) differs at one server_version_num/],
  ["the image evidence", ["if (!image(\"production\") || !image(\"rehearsal\")) out.push(", "if (false) out.push("],
    (K) => { const p = K.readObservation(readingRows("c-01.json")); return K.crossProject(p, p, { creator: "postgres", records: ALL_GENERIC }); },
    /the two projects' image versions are not given/],
  ["an image difference's record", ["else residual(9, \"image\", \"R-IMG\", `the images differ: ${image(\"production\")} and ${image(\"rehearsal\")}`);", "else out.push(finding(\"MATCH\", 9, \"image\", \"equal\"));"],
    (K) => { const p = K.readObservation(readingRows("c-01.json")); return cross(K, p, p, { "R-AUTHCFG": "x" }, { production: "17.6.1.111", rehearsal: "17.6.1.166" }); },
    /R-IMG: the images differ/],
  ["the number's validity", ["need(9, \"server_version_num\", isServerNum, \"a PostgreSQL 17 or later server\");", ""],
    (K) => { const o = atVersion("160010", "same")(K); return cross(K, o, o); },
    /a required fact is not usable \(160010\)/],
  // R4
  ["an event trigger's own record", ["\"an event trigger on the path differs\", { ownOnly: true });", "\"an event trigger on the path differs\", { ownOnly: false });"],
    (K) => cross(K, K.readObservation(readingRows("c-01.json")), edited(K, "c-01.json", (rows) => rows.push({ part: 8, key: "evt|new", value: "ddl_command_end|O||f|postgres|plpgsql|0123|" }))),
    /with no record under R-IMG\|evt\|new/],
  // R5
  ["a required fact's presence", ["if (!Object.hasOwn(obs.parts[part], key)) out.push(stop(part, key, `a required fact is missing: ${what}`));", "if (!Object.hasOwn(obs.parts[part], key)) return;"],
    (K) => { const o = dropRows("c-01.json", ["fn|auth.uid()"])(K); return cross(K, o, o); },
    /fn\|auth\.uid\(\)|a required fact is missing/],
  ["a required fact's usability", ["else if (!ok(obs.parts[part][key])) out.push(", "else if (false) out.push("],
    (K) => { const o = setRows("c-01.json", { "fn|extensions.digest(text, text)": "<absent>" })(K); return cross(K, o, o); },
    /a required fact is not usable \(<absent>\)/],
  ["the same, at P0′", ["else if (!ok(obs.parts[part][key])) out.push(", "else if (false) out.push("],
    (K) => K.p0Findings(M, setRows("c-01.json", { "fn|extensions.digest(text, text)": "<absent>" })(K), { target: "production" }),
    /a required fact is not usable \(<absent>\)/],
  ["the fixed data-scope facts", ["for (const k of [...DATA_SCOPE.stop, ...Object.keys(DATA_SCOPE.recorded)]) need(10, k, (v) => usableDataFact(k, v), \"a fixed data-scope fact\");", ""],
    (K) => { const o = dropRows("c-01.json", ["count|public.employees"])(K); return K.dataScope(o, o); },
    /count\|public\.employees|a required fact is missing/],
  ["postgres's default for each type", ["if (row === implicit) out.push(", "if (false) out.push("],
    (K) => { const o = dropRows("c-01.json", ["implicit|postgres|f"])(K); return cross(K, o, o); },
    /this reading has neither/],
  ["P0′'s own check", ["const out = [...requiredFindings(obs), ...ledgerShapeFindings(manifest, obs)];", "const out = [...ledgerShapeFindings(manifest, obs)];"],
    (K) => K.p0Findings(M, dropRows("c-01.json", ["fn|auth.uid()"])(K), { target: "production" }),
    /a required fact is missing/],
  ["POST′'s own check", ["const out = [...requiredFindings(obs), ...requiredOf(\"the baseline\", baseline), ...(previous === baseline ? [] : requiredOf(\"the previous readback\", previous)), ...ledgerShapeFindings(manifest, obs)];", "const out = [...ledgerShapeFindings(manifest, obs)];"],
    (K) => { const b = dropRows("c-01.json", ["count|public.employees"])(K); return post(K, dropRows("c-P2-02.json", ["count|public.employees"])(K), "P2-02", b, b, "01"); },
    /a required fact is missing/],
  ["POST′'s check of the window start", ["out.push(...requiredOf(\"the window-start P0′\", windowStart));", ""],
    (K) => { const b = K.readObservation(readingRows("c-01.json")); return K.postFindings(M, K.readObservation(readingRows("c-P2-02.json")), { step: "P2-02", target: "production", baseline: b, previous: b, previousState: "01", otherRows: otherRows(K, b), windowStart: dropRows("c-01.json", ["fn|auth.uid()"])(K) }); },
    /the window-start P0′: a required fact is missing/],
  ["the comparison's own check of both sides", ["const out = [...requiredOf(\"production's baseline\", prod), ...requiredOf(\"the rehearsal's baseline\", reh)];", "const out = [];"],
    (K) => { const o = dropRows("c-01.json", ["fn|auth.uid()"])(K); return cross(K, o, o); },
    /production's baseline: a required fact is missing/],
  ["the data scope's own check of both sides", ["const out = [...requiredOf(\"the window-start P0′\", before), ...requiredOf(\"the P0′ after P1′\", after)];", "const out = [];"],
    (K) => { const o = dropRows("c-01.json", ["count|public.employees"])(K); return K.dataScope(o, o); },
    /the window-start P0′: a required fact is missing/],
  // BUILD-00's ledger read
  ["a status that stops", ["if (want.stops) out.push(", "if (false) out.push("],
    () => ledger("denied-read"),
    /may not read the ledger/, "build00LedgerFindings"],
  ["the same, a hidden read", ["if (want.stops) out.push(", "if (false) out.push("],
    () => ledger("hidden-read"),
    /rows may be hidden/, "build00LedgerFindings"],
  ["a result under a status that reads nothing", ["} else if (facts.rows !== LEDGER_NOT_READ) out.push(", "} else if (false) out.push("],
    () => withFact("absent-table", "rows", "<table x>\n</table>\n"),
    /a result under the status absent-table/, "build00LedgerFindings"],
  // B1: the empty document, Codex's three negatives and a cut-short one.
  ["the empty document: malformed XML", [EMPTY_DOC_CHECK, "if (false) out.push("],
    () => withFact("empty", "rows", "<table invalid>\n</table>\n"),
    /not the reviewed empty document/, "build00LedgerFindings"],
  ["the empty document: an unfamiliar child", [EMPTY_DOC_CHECK, "if (false) out.push("],
    () => withFact("empty", "rows", "<table xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\">\n<unexpected/>\n</table>\n"),
    /not the reviewed empty document/, "build00LedgerFindings"],
  ["the empty document: an empty row element", [EMPTY_DOC_CHECK, "if (false) out.push("],
    () => withFact("empty", "rows", "<table xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\">\n<row/>\n</table>\n"),
    /not the reviewed empty document/, "build00LedgerFindings"],
  ["the empty document: cut short", [EMPTY_DOC_CHECK, "if (false) out.push("],
    () => withFact("empty", "rows", "<table xmlns:xsi=\"x\">\n"),
    /not the reviewed empty document/, "build00LedgerFindings"],
  ["the empty document: a real row", [EMPTY_DOC_CHECK, "if (false) out.push("],
    () => withFact("empty", "rows", "<table x>\n<row>\n</row>\n</table>\n"),
    /not the reviewed empty document/, "build00LedgerFindings"],
  // B2: an absence status against the catalog, for both statuses.
  ["an absent table's relation", [ABSENT_RELATION, "if (false) out.push("],
    () => withFact("absent-table", "relation", "r|postgres|false|false"),
    /has no relation/, "build00LedgerFindings"],
  ["an absent schema's relation", [ABSENT_RELATION, "if (false) out.push("],
    () => withFact("absent-schema", "relation", "r|postgres|false|false"),
    /has no relation/, "build00LedgerFindings"],
  ["an absent table's columns", [ABSENT_COLUMNS, "if (false) out.push("],
    () => withFact("absent-table", "columns", C.LEDGER_COLUMNS),
    /a relation's columns/, "build00LedgerFindings"],
  ["an absent schema's columns", [ABSENT_COLUMNS, "if (false) out.push("],
    () => withFact("absent-schema", "columns", C.LEDGER_COLUMNS),
    /a relation's columns/, "build00LedgerFindings"],
  ["an absent table's constraint", [ABSENT_RELATION_FACT, "else if (false) out.push(stop(\"ledger\", k,"],
    () => [...ledger("absent-table"), { part: "ledger", key: "constraint|some_pkey", value: "p|PRIMARY KEY (version)" }],
    /a relation's fact/, "build00LedgerFindings"],
  ["an absent schema's trigger", [ABSENT_RELATION_FACT, "else if (false) out.push(stop(\"ledger\", k,"],
    () => [...ledger("absent-schema"), { part: "ledger", key: "trigger|t", value: "O|CREATE TRIGGER t" }],
    /a relation's fact/, "build00LedgerFindings"],
  ["an absent table's table fact", ["if (want.table !== null && facts.table !== want.table) out.push(", "if (false) out.push("],
    () => withFact("absent-table", "table", "true"),
    /true, under the status absent-table/, "build00LedgerFindings"],
  ["the schema's presence, absent-table", [SCHEMA_FACT, "if (false) out.push("],
    () => withFact("absent-table", "schema", "false"),
    /false, under the status absent-table/, "build00LedgerFindings"],
  ["the schema's presence, absent-schema", [SCHEMA_FACT, "if (false) out.push("],
    () => withFact("absent-schema", "schema", "true"),
    /true, under the status absent-schema/, "build00LedgerFindings"],
  // B2: the empty path's relation form, and what else may be there.
  ["the relation form: a view", [RELATION_FORM, "if (false) out.push("],
    () => withFact("empty", "relation", "v|postgres|false|false"),
    /not the one relation form reviewed/, "build00LedgerFindings"],
  ["the relation form: RLS on", [RELATION_FORM, "if (false) out.push("],
    () => withFact("empty", "relation", "r|postgres|true|false"),
    /not the one relation form reviewed/, "build00LedgerFindings"],
  ["the relation form: only its prefix", [RELATION_FORM, "if (false) out.push("],
    () => withFact("empty", "relation", "r|"),
    /not the one relation form reviewed/, "build00LedgerFindings"],
  ["the six columns on the empty path", ["if (facts.columns !== LEDGER_COLUMNS) out.push(", "if (false) out.push("],
    () => withFact("empty", "columns", "version:text:true:"),
    /without production's six columns/, "build00LedgerFindings"],
  ["an unknown fact", ["if (!/^(constraint|trigger)\\|/.test(k)) out.push(", "if (false) out.push("],
    () => [...ledger("empty"), { part: "ledger", key: "other", value: "x" }],
    /not a fact BUILD-00 reports/, "build00LedgerFindings"],
  ["a row that is not an object", ["if (!isObj(r)) return [stop(\"ledger\", null, \"a row is not an object\")];", "if (!isObj(r)) continue;"],
    () => [null, ...ledger("empty")],
    /a row is not an object/, "build00LedgerFindings"],
  ["a part's md5 check", ["else if (partMd5(parts[p]) !== md5s[p]) problems.push(", "else if (false) problems.push("],
    (K) => K.p0Findings(M, K.readObservation(readingRows("c-01.json").map((r) => (r.key === "count|public.orders" ? { ...r, value: "9" } : r))), { target: "production" }),
    /part 10's rows do not reproduce its md5/],
];

test("4C-M1 each named check of the comparator, removed, turns its negative into exactly an acceptance; the original refuses it with its reason", async () => {
  const dir = mkdtempSync(join(tmpdir(), "s0-4c-mutants-"));
  try {
    for (const [n, [name, [from, to], scenario, reason, fn]] of MUTANTS.entries()) {
      assert.equal(SRC.split(from).length, 2, `${name}: the edit names exactly one place`);
      const run = (K) => (fn ? K[fn](scenario(K)) : scenario(K));
      const orig = run(C);
      assert.match(C.blocking(orig).map((f) => f.reason).join(" | "), reason, `${name}: the original refuses with its reason`);
      const file = join(dir, `m${n}.mjs`);
      writeFileSync(file, SRC.replace(from, to));
      const K = await import(pathToFileURL(file).href);
      let out, err = null;
      try { out = run(K); } catch (e) { err = e; }
      assert.equal(err, null, `${name}: the mutant gave an exception, not an acceptance: ${err && err.message}`);
      assert.deepEqual(K.blocking(out).map((f) => f.reason), [], `${name}: the mutant accepts its negative`);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
