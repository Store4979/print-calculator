// scripts/tests/stage0-4c-writing.mutation.test.js — the mutation companion of
// stage0-4c-writing.test.js (the implementation outline's X3; I3-M1's form). Each
// named check is removed by an exact edit of a copy of its module, and its negative,
// which only that check catches, must turn into exactly an acceptance, never an
// exception. The original refuses each one.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import * as A from "../manual/assemble-stage0.mjs";
import * as C from "../manual/stage0-4c-compare.mjs";
import * as CL from "../manual/stage0-classify.mjs";
import * as MC from "./stage0-manifest-check.mjs";
import { M, ROOT } from "./stage0-guard-fixture.mjs";

const FIX = join(ROOT, "scripts", "tests", "fixtures", "stage0-4c-writing");
const json = (f) => JSON.parse(readFileSync(join(FIX, f), "utf8"));
const oldJson = (f) => JSON.parse(readFileSync(join(ROOT, "scripts", "tests", "fixtures", "stage0-4c", f), "utf8"));
const RESULT = json("b-p1.json");
const OUT = A.assembleAll(M, { cwd: ROOT });
const src = A.sourceFromManifest(M, { cwd: ROOT });

/** A copy of a module with every relative specifier made absolute, and the edit made at its one place. */
function copyOf(path, [from, to]) {
  let s = readFileSync(path, "utf8").replace(/\r\n/g, "\n");
  assert.equal(s.split(from).length, 2, `the edit names exactly one place: ${from.slice(0, 80)}`);
  s = s.split(from).join(to);
  return s.replace(/from "(\.\.?\/[^"]+)"/g, (_, spec) => `from ${JSON.stringify(pathToFileURL(resolve(dirname(path), spec)).href)}`);
}
async function load(path, edit, dir, n) {
  const p = join(dir, `m${n}.mjs`);
  writeFileSync(p, copyOf(path, edit));
  return import(pathToFileURL(p).href);
}
const CLASSIFY = join(ROOT, "scripts", "manual", "stage0-classify.mjs");
const COMPARE = join(ROOT, "scripts", "manual", "stage0-4c-compare.mjs");
const CHECK = join(ROOT, "scripts", "tests", "stage0-manifest-check.mjs");
const renumber = (rows) => rows.map((r, i) => ({ ...r, n: i + 1 }));
const proofs = RESULT.filter((r) => r.kind === "proof"), locks = RESULT.filter((r) => r.kind === "lock");

test("4W-M1 each check of P1-4C's predicate, removed, turns its negative into exactly an acceptance", async () => {
  const dir = mkdtempSync(join(tmpdir(), "s0-4w-p1-"));
  const filler = Array.from({ length: CL.P1_4C_RESULT.maxRows - RESULT.length + 1 }, () => ({ kind: "lock", at: "after-section-4", fact: "relation|AccessShareLock|true|public.x" }));
  const CASES = [
    ["the cap", "if (p.v.length > P1_4C_RESULT.maxRows) return no(", "if (false) return no(", renumber([...RESULT, ...filler]), /over the cap/],
    ["the numbering", "if (r.n !== i + 1) return no(", "if (false) return no(", RESULT.map((r) => ({ ...r, n: r.n + 1 })), /not numbered/],
    ["the kind", "if (![\"proof\", \"lock\"].includes(r.kind) || typeof r.at !== \"string\" || typeof r.fact !== \"string\") return no(", "if (false) return no(", RESULT.map((r) => (r.n === 100 ? { ...r, kind: "note" } : r)), /wrong form/],
    ["the order of the kinds", "if (p.v.slice(0, proofs.length).some((r) => r.kind !== \"proof\")) return no(", "if (false) return no(", renumber([locks[0], ...proofs, ...locks.slice(1)]), /before the last proof/],
    ["the proofs' md5", "if (A.md5(lines) !== P1_4C_RESULT.proofMd5) return no(", "if (false) return no(", RESULT.map((r) => (r.at === "E1" ? { ...r, fact: "another fact" } : r)), /do not have md5/],
    ["the lock fact's form", "if (!P1_4C_LOCK_FACT.test(r.fact)) return no(", "if (false) return no(", RESULT.map((r) => (r.n === 60 ? { ...r, fact: "relation" } : r)), /not locktype/],
    ["the boundaries: one inside the savepoint", "if (!same(seen, A.P1_4C_BOUNDARIES)) {", "if (false) {", json("b-p1-inside-savepoint.json"), /missing before-savepoint/],
    ["the boundaries: two swapped", "if (!same(seen, A.P1_4C_BOUNDARIES)) {", "if (false) {", renumber([...proofs, ...locks.filter((r) => r.at === "after-P2-02"), ...locks.filter((r) => r.at === "after-section-0"), ...locks.filter((r) => !["after-P2-02", "after-section-0"].includes(r.at))]), /not exactly the declared ones/],
  ];
  try {
    for (const [n, [name, from, to, rows, why]] of CASES.entries()) {
      assert.match(CL.SUCCESS["P1-4C"].check(JSON.stringify(rows)).why ?? "", why, `${name}: the original refuses`);
      const K = await load(CLASSIFY, [from, to], dir, n);
      const r = K.SUCCESS["P1-4C"].check(JSON.stringify(rows));
      assert.equal(r.ok, true, `${name}: the mutant accepts: ${r.why}`);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("4W-M2 each preflight predicate, removed, turns its own negative into exactly an acceptance", async () => {
  const b = oldJson("a-build00.json"), w = oldJson("a-build00w.json");
  const set = (rows, part, key, value) => rows.map((r) => (r.part === part && r.key === key ? { ...r, value } : r));
  const drop = (rows, part, key) => rows.filter((r) => !(r.part === part && r.key === key));
  const add = (rows, part, key, value) => [...rows, { part, key, value }];
  const NEG = {
    "public-empty": [add(b, "public", "relation|x", "r|postgres"), w],
    ledger: [set(b, "ledger", "status", "empty"), w],
    "buckets-present": [set(b, "buckets", "present", "false"), w],
    "buckets-columns": [set(b, "buckets", "column|id", "integer|true|||"), w],
    "buckets-notnull": [add(b, "buckets", "column|tenant", "text|true|||"), w],
    "buckets-generated": [set(b, "buckets", "column|updated_at", "timestamp with time zone|false||a|"), w],
    "buckets-arbiter": [b.filter((r) => !r.key.startsWith("arbiter|")), w],
    "buckets-authority": [b, set(w, "buckets", "update|updated_at", "false")],
    "buckets-rls": [b, set(w, "buckets", "rls_applies", "true")],
    "buckets-rows": [b, set(w, "buckets", "row|customer-uploads", "true")],
    "buckets-reviewed": [add(b, "buckets", "trigger|x", "O|a definition|postgres"), w],
    "authusers-reviewed": [add(b, "authusers", "check|x", "CHECK (true)"), w],
    "objects-table": [set(b, "objects", "table", "v|postgres|false|false"), w],
    "objects-policies": [add(b, "objects", "policy|job_files_anon_delete", "d"), w],
    "objects-authority": [b, set(w, "objects", "owner_privileges", "false")],
    "publication-present": [set(b, "publication", "pub|supabase_realtime", "postgres|true|true|true|true|true|false"), w],
    "publication-member": [add(b, "publication", "member|public.pending_jobs", "supabase_realtime"), w],
    "publication-authority": [b, set(w, "publication", "owner_privileges", "<absent>")],
    "authusers-columns": [drop(b, "authusers", "column|email"), w],
    "authusers-notnull": [set(b, "authusers", "notnull-nodefault", "id,tenant"), w],
    "authusers-authority": [b, set(w, "authusers", "references|id", "false")],
    "authusers-rls": [b, set(w, "authusers", "rls_applies", "true")],
    "authusers-triggers": [set(b, "authusers", "user-triggers", "1"), w],
    "marker-absent": [set(b, "schemas", "schema|stage0_rehearsal", "postgres"), w],
    "database-create": [b, set(w, "database", "create", "false")],
    creator: [b, set(set(w, "role", "name", "someone"), "role", "attr", "false|true|false|false|true|false|false")],
    "writer-identity": [b, set(w, "role", "attr", "true|true")],
  };
  // X3e's rows are in the reviewed set too: each of these asks with its own reading's set.
  const OWN_SET = new Set();
  for (const p of ["buckets", "authusers"]) {
    const add = (part, key, value) => [...b, { part, key, value }];
    for (const [name, x] of [
      [`${p}-relation`, set(b, p, "relation", "r|false|true|0")],
      [`${p}-expression-calls`, add(p, "default|x", "query_to_xml('select 1'::text, true, false, ''::text)")],
      [`${p}-sequence-calls`, add(p, "default|x", "nextval(('s'::text)::regclass)")],
      [`${p}-routes`, add(p, "route|default|x|function|storage.f()", "storage|plpgsql|postgres|false|v||a|b\ndefinition")],
      [`${p}-rules`, add(p, "rule|x", "3|O|false|CREATE RULE x")],
      [`${p}-expression-nodes`, add(p, "node|default|x", "{ROWCOMPAREEXPR :rctype 1 }")],
      [`${p}-foreign-keys`, add(p, "fk|out|t|x", "o|s|true|false|FOREIGN KEY (a) REFERENCES o(b)")],
    ]) { NEG[name] = [x, w]; OWN_SET.add(name); }
  }
  assert.deepEqual(Object.keys(NEG).sort(), [...C.BUILD_PREDICATE_NAMES].sort());
  const dir = mkdtempSync(join(tmpdir(), "s0-4w-pred-"));
  try {
    for (const [n, [name, [x, y]]] of Object.entries(NEG).entries()) {
      const opts = { creator: "postgres", ledger: "absent-table", reviewed: C.reviewedSetOf(OWN_SET.has(name) ? x : b) };
      assert.deepEqual(C.buildPredicateFindings(x, y, opts).map((f) => f.key), [name], `${name}: the original refuses`);
      const K = await load(COMPARE, [".filter(([, ok]) => ok(b, w, { creator, ledger, reviewed }) !== true)", `.filter(([name, ok]) => name !== ${JSON.stringify(name)} && ok(b, w, { creator, ledger, reviewed }) !== true)`], dir, n);
      assert.deepEqual(K.buildPredicateFindings(x, y, opts), [], `${name}: the mutant accepts`);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("4W-M4 X3-R2 and X3-R3: each part of the arbiter's and the text columns' rules, removed, turns its real shape's readings into exactly an acceptance", async () => {
  const reads = (name) => { const r = json(`w-stop-${name}.json`); return [r.build00, r.build00w]; };
  const optsOf = (x) => ({ creator: "postgres", ledger: "absent-table", reviewed: C.reviewedSetOf(x) });
  const CASES = [
    ["the arbiter's form: Codex's deferrable key", "return onId.length === 1 && onId[0] === BUILD_ARBITER;", "return onId.length === 1;", "deferrable-key", "buckets-arbiter"],
    ["one index on id: a second, deferrable one", "return onId.length === 1 && onId[0] === BUILD_ARBITER;", "return onId.includes(BUILD_ARBITER);", "second-deferrable-unique", "buckets-arbiter"],
    ["the declared length: Codex's varchar(1)", "return m !== null && Number(m[1]) >= longest;", "return m !== null;", "name-varchar-1", "buckets-columns"],
    ["the declared length: a user column one short", "return m !== null && Number(m[1]) >= longest;", "return m !== null;", "email-one-short", "authusers-columns"],
    ["a form the rule does not name", "return m !== null && Number(m[1]) >= longest;", "return true;", "name-char-20", "buckets-columns"],
  ];
  const dir = mkdtempSync(join(tmpdir(), "s0-4w-fit-"));
  try {
    for (const [n, [name, from, to, shape, want]] of CASES.entries()) {
      const [x, y] = reads(shape);
      assert.deepEqual(C.buildPredicateFindings(x, y, optsOf(x)).map((f) => f.key), [want], `${name}: the original refuses`);
      const K = await load(COMPARE, [from, to], dir, `fit${n}`);
      assert.deepEqual(K.buildPredicateFindings(x, y, optsOf(x)), [], `${name}: the mutant accepts`);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("4W-M5 X3d: each part of the exact-set rule, removed, turns its real shape into exactly an acceptance", async () => {
  const CASES = [
    ["the digests: Codex's replaced body", "return keys(have) === keys(want) && Object.keys(have).every((k) => have[k] === want[k]);", "return keys(have) === keys(want);", "function-body-replaced", "buckets-reviewed"],
    ["the digests: a CHECK changed", "return keys(have) === keys(want) && Object.keys(have).every((k) => have[k] === want[k]);", "return keys(have) === keys(want);", "check-changed", "buckets-reviewed"],
    ["the digests: a CHECK on auth.users changed", "return keys(have) === keys(want) && Object.keys(have).every((k) => have[k] === want[k]);", "return keys(have) === keys(want);", "users-check-changed", "authusers-reviewed"],
    ["the keys: a trigger removed", "return keys(have) === keys(want) && Object.keys(have).every((k) => have[k] === want[k]);", "return Object.keys(have).every((k) => have[k] === want[k]);", "trigger-removed", "buckets-reviewed"],
    ["the keys: a CHECK on auth.users removed", "return keys(have) === keys(want) && Object.keys(have).every((k) => have[k] === want[k]);", "return Object.keys(have).every((k) => have[k] === want[k]);", "users-check-removed", "authusers-reviewed"],
    ["which rows are in the set: a trigger added", "const REVIEWED_KEY = /^(?:(?:trigger|trigger-function|check|check-function|", "const REVIEWED_KEY = /^(?:(?:check|check-function|", "trigger-added", "buckets-reviewed"],
    ["which rows are in the set: a CHECK added", "const REVIEWED_KEY = /^(?:(?:trigger|trigger-function|check|check-function|", "const REVIEWED_KEY = /^(?:(?:trigger|trigger-function|", "check-added", "buckets-reviewed"],
  ];
  const dir = mkdtempSync(join(tmpdir(), "s0-4w-rev-"));
  try {
    for (const [n, [name, from, to, shape, want]] of CASES.entries()) {
      const r = json(`w-reviewed-stop-${shape}.json`);
      const opts = { creator: "postgres", ledger: "absent-table", reviewed: r.reviewed };
      assert.deepEqual(C.buildPredicateFindings(r.build00, r.build00w, opts).map((f) => f.key), [want], `${name}: the original refuses`);
      const K = await load(COMPARE, [from, to], dir, `rev${n}`);
      // A mutant that narrows the set reads the review's digests through its own filter, so it takes the review's rows as they were.
      assert.deepEqual(K.buildPredicateFindings(r.build00, r.build00w, { ...opts, reviewed: /REVIEWED_KEY/.test(from) ? K.reviewedSetOf(r.build00) : r.reviewed }), [], `${name}: the mutant accepts`);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("4W-M6 X3e and X3f: each part of the stored-expression rules, removed, takes exactly its own stop off its real shape", async () => {
  const base = json("w-expr-base.json");
  const applyDelta = (rows, { set, drop }) => {
    const k = (r) => JSON.stringify([r.part, r.key]);
    const m = new Map(rows.map((r) => [k(r), r]));
    for (const [part, key] of drop) m.delete(k({ part, key }));
    for (const r of set) m.set(k(r), r);
    return [...m.values()];
  };
  const fixture = (f) => { const r = json(f); return { ...r, build00: applyDelta(base.build00, r.b00), build00w: applyDelta(base.build00w, r.b00w) }; };
  // Both of the layers that read a sequence call: its text, and its resolved identity. 4W-11 and 4W-24 show each catching it alone.
  const SEQ_TEXT = [
    "const sequenceFree = (part) => scannedOf(part).every(({ s }) => !callsOf(s).some((c) => SEQUENCE_CALLS.includes(c)))\n  && Object.entries(part ?? {}).every(([k, v]) => !(k.startsWith(\"column-type|\") && v.split(\"|\")[0] !== \"\") && !NAMES_SEQUENCE_CALL.test(k) && !/^route\\|[^|]*\\|[^|]*\\|sequence\\|/.test(k) && !(k.startsWith(\"node-function|\") && SEQUENCE_CALLS.includes(v.split(\"|\")[4])));",
    "const sequenceFree = (part) => Object.entries(part ?? {}).every(([k, v]) => !(k.startsWith(\"column-type|\") && v.split(\"|\")[0] !== \"\") && !NAMES_SEQUENCE_CALL.test(k) && !/^route\\|[^|]*\\|[^|]*\\|sequence\\|/.test(k));",
  ];
  const CASES = [
    ["a sequence call with no dependency: a default", ...SEQ_TEXT, "w-expr-stop-buckets-default-nextval-no-constant-dependency.json", "buckets-sequence-calls"],
    ["a sequence call with no dependency: a CHECK on auth.users", ...SEQ_TEXT, "w-expr-stop-authusers-check-dynamic-nextval.json", "authusers-sequence-calls"],
    ["a sequence call with no dependency: a trigger's WHEN", ...SEQ_TEXT, "w-expr-stop-buckets-trigger-when-dynamic-nextval.json", "buckets-sequence-calls"],
    ["a sequence call with no dependency: a domain's CHECK", ...SEQ_TEXT, "w-expr-stop-authusers-domain-check-dynamic-nextval.json", "authusers-sequence-calls"],
    ["an identity column", "!(k.startsWith(\"column-type|\") && v.split(\"|\")[0] !== \"\") && ", "", "w-expr-stop-buckets-identity-column.json", "buckets-sequence-calls"],
    ["nextval reached through an operator from a CHECK", "!NAMES_SEQUENCE_CALL.test(k) && ", "", "w-expr-stop-buckets-check-custom-operator-over-nextval.json", "buckets-sequence-calls"],
    ["a built-in off the list: one running a query", "callsOf(s).every((c) => SEQUENCE_CALLS.includes(c) || BUILD_EXPRESSION_CALLS.includes(c) || reportedCalls(part, key).includes(c))", "true", "w-expr-stop-buckets-builtin-running-a-query.json", "buckets-expression-calls"],
    ["a built-in off the list: one with a side effect", "callsOf(s).every((c) => SEQUENCE_CALLS.includes(c) || BUILD_EXPRESSION_CALLS.includes(c) || reportedCalls(part, key).includes(c))", "true", "w-expr-stop-authusers-builtin-with-a-side-effect.json", "authusers-expression-calls"],
    ["a function on a strict route: an operator over an unlisted built-in", "return schema === \"pg_catalog\" && BUILD_EXPRESSION_CALLS.includes(/^pg_catalog\\.([^(]*)\\(/.exec(key.split(\"|\")[4] ?? \"\")?.[1]);", "return schema === \"pg_catalog\";", "w-expr-stop-buckets-default-operator-over-unlisted-builtin.json", "buckets-routes"],
    ["a function on a strict route: a custom operator's", "return schema === \"pg_catalog\" && BUILD_EXPRESSION_CALLS.includes(/^pg_catalog\\.([^(]*)\\(/.exec(key.split(\"|\")[4] ?? \"\")?.[1]);", "return true;", "w-expr-stop-authusers-default-custom-operator.json", "authusers-routes"],
    ["a composite type", "if (kind === \"type\") return /^[ed]/.test(detail) || (detail.startsWith(\"b\") && (schema === \"pg_catalog\" || detail[1] === \"A\"));\n  return false;", "return true;", "w-expr-stop-buckets-composite-type.json", "buckets-routes"],
    ["a custom collation", "if (kind === \"collation\") return schema === \"pg_catalog\";", "if (kind === \"collation\") return true;", "w-expr-stop-buckets-custom-collation.json", "buckets-routes"],
    ["an operator class", "if (kind === \"type\") return /^[ed]/.test(detail) || (detail.startsWith(\"b\") && (schema === \"pg_catalog\" || detail[1] === \"A\"));\n  return false;", "return true;", "w-expr-stop-authusers-custom-operator-class.json", "authusers-routes"],
    ["an INSERT rule", "!k.startsWith(\"rule|\") || v.startsWith(\"4|\")", "true", "w-expr-stop-authusers-rule-on-insert.json", "authusers-rules"],
    ["an UPDATE rule", "!k.startsWith(\"rule|\") || v.startsWith(\"4|\")", "true", "w-expr-stop-buckets-rule-on-update.json", "buckets-rules"],
    ["a child table", "\"buckets-relation\": (b) => relationHolds(b.buckets),", "\"buckets-relation\": () => true,", "w-expr-stop-buckets-inherited-by-a-child.json", "buckets-relation"],
    // X3f.
    ["a type-dependent node over an enum", "if (dependent && !typeFactReviewed(fact)) return false;", "", "w-expr-stop-buckets-least-enum.json", "buckets-expression-nodes"],
    ["the same, over a domain", "if (dependent && !typeFactReviewed(fact)) return false;", "", "w-expr-stop-authusers-least-domain.json", "authusers-expression-nodes"],
    ["the same, CoerceViaIO to an unreviewed built-in", "if (dependent && !typeFactReviewed(fact)) return false;", "", "w-expr-stop-buckets-coerceviaio-unreviewed-builtin.json", "buckets-expression-nodes"],
    ["a tag that is type-dependent", "let dependent = tags.some((t) => TYPE_DEPENDENT_TAGS.includes(t));", "let dependent = false;", "w-expr-stop-authusers-greatest-enum.json", "authusers-expression-nodes"],
    ["a pseudo-type function", "if (pseudo === \"true\") dependent = true;", "", "w-expr-stop-buckets-pseudo-type-function-over-enum.json", "buckets-expression-nodes"],
    ["a pseudo-type operator", "if (f[5] === \"true\" && !(equality && tag === \"OPEXPR\")) dependent = true;", "", "w-expr-stop-authusers-enum-distinct-in-check.json", "authusers-expression-nodes"],
    // X3g (Codex XF-R1): the blanket rule put back takes the stop off Codex's @@, a required-failing mutant.
    ["the reviewed operator list replaced by X3f's blanket rule", "if (!reviewedOperator(oid, fact) && !equality && !reviewedHere(f[8])) return false;", "if (!/^pg_catalog\\|true\\|pg_catalog\\|true\\|[is]\\|/.test(fact) && !reviewedHere(f[8])) return false;", "w-expr-codex-text-search.json", "buckets-expression-nodes"],
    ["the same, on the stored @@ shape of auth.users", "if (!reviewedOperator(oid, fact) && !equality && !reviewedHere(f[8])) return false;", "if (!/^pg_catalog\\|true\\|pg_catalog\\|true\\|[is]\\|/.test(fact) && !reviewedHere(f[8])) return false;", "w-expr-stop-authusers-text-search-operator.json", "authusers-expression-nodes"],
    // The enum exception: only under an OPEXPR, and only by identity.
    ["the enum exception under DISTINCTEXPR", "if (f[5] === \"true\" && !(equality && tag === \"OPEXPR\")) dependent = true;", "if (f[5] === \"true\" && !equality) dependent = true;", "w-expr-stop-buckets-enum-distinct-in-check.json", "buckets-expression-nodes"],
    ["the enum exception under NULLIFEXPR", "if (f[5] === \"true\" && !(equality && tag === \"OPEXPR\")) dependent = true;", "if (f[5] === \"true\" && !equality) dependent = true;", "w-expr-stop-authusers-enum-nullif-default.json", "authusers-expression-nodes"],
    ["the enum exception under SCALARARRAYOPEXPR", "if (f[5] === \"true\" && !(equality && tag === \"OPEXPR\")) dependent = true;", "if (f[5] === \"true\" && !equality) dependent = true;", "w-expr-stop-buckets-enum-any-in-check.json", "buckets-expression-nodes"],
    ["the enum equality by its implementation's name", "const equality = enumEquality(oid, fact);", "const equality = f[7] === \"enum_eq\" || f[7] === \"enum_ne\";", "w-expr-stop-buckets-enum-lookalike-operator-default.json", "buckets-expression-nodes"],
    ["a node off the list", "if (!tags.every((t) => BUILD_NODE_TAGS.includes(t))) return false;", "", "w-expr-stop-buckets-row-comparison.json", "buckets-expression-nodes"],
    ["another node off the list", "if (!tags.every((t) => BUILD_NODE_TAGS.includes(t))) return false;", "", "w-expr-stop-authusers-subscripting.json", "authusers-expression-nodes"],
    ["a function off the list, which only its identity shows", "(BUILD_NODE_FUNCTIONS.includes(fname) || SEQUENCE_CALLS.includes(fname))", "true", "w-expr-stop-buckets-unlisted-cast-function.json", "buckets-expression-nodes"],
    // An enum key is refused twice over, by its types and by enum_eq's pseudo-type arguments.
    ["a foreign key's custom type", "return typeFactReviewed(part[`node-type|${fkType}`]) && typeFactReviewed(part[`node-type|${pkType}`]) && [pf, pp, ff].every((o) => foreignKeyOperator(part, o));", "return true;", "w-expr-stop-buckets-fk-out-custom-type.json", "buckets-foreign-keys"],
    ["a foreign key's custom operator and class", "if (k.startsWith(\"fk-index|\")) return OPERATOR_CLASSES.test(v);\n  if (!k.startsWith(\"fk-column|\")) return true;", "if (k.startsWith(\"fk-index|\")) return true;\n  if (k.startsWith(\"fk-column|\")) return true;\n  if (!k.startsWith(\"fk-column|\")) return true;", "w-expr-stop-authusers-fk-out-custom-opclass.json", "authusers-foreign-keys"],
    ["a referencing domain", "return typeFactReviewed(part[`node-type|${fkType}`]) && typeFactReviewed(part[`node-type|${pkType}`]) && ", "return ", "w-expr-stop-authusers-fk-in-domain.json", "authusers-foreign-keys"],
  ];
  const dir = mkdtempSync(join(tmpdir(), "s0-4w-expr-"));
  try {
    for (const [n, [name, from, to, shape, want]] of CASES.entries()) {
      const r = fixture(shape);
      const opts = { creator: "postgres", ledger: "absent-table", reviewed: C.reviewedSetOf(r.build00) };
      // A shape can stop under two rules, by its text and by its node tree. Removing one removes exactly that stop.
      const names = C.buildPredicateFindings(r.build00, r.build00w, opts).map((f) => f.key);
      assert.ok(names.includes(want), `${name}: the original refuses: ${names.join(", ")}`);
      const K = await load(COMPARE, [from, to], dir, `expr${n}`);
      assert.deepEqual(K.buildPredicateFindings(r.build00, r.build00w, opts).map((f) => f.key), names.filter((x) => x !== want), `${name}: the mutant removes exactly that stop`);
    }
    // A custom base type's own row. In the real shape its input function stops too, so this reading holds the row alone.
    {
      const x = [...base.build00, { part: "buckets", key: "route|column|c|type|storage.t", value: "storage|bU" }];
      const opts = { creator: "postgres", ledger: "absent-table", reviewed: C.reviewedSetOf(x) };
      assert.deepEqual(C.buildPredicateFindings(x, base.build00w, opts).map((f) => f.key), ["buckets-routes"], "a custom base type: the original refuses");
      const K = await load(COMPARE, ["(detail.startsWith(\"b\") && (schema === \"pg_catalog\" || detail[1] === \"A\"))", "detail.startsWith(\"b\")"], dir, "basetype");
      assert.deepEqual(K.buildPredicateFindings(x, base.build00w, opts), [], "a custom base type: the mutant accepts");
    }
    // After the review: the rows X3e added to the set are what stops each of these.
    for (const [m, [name, from, to, shape, want]] of [
      ["a rule's row", "|index-pred|rule|domain-check|", "|index-pred|domain-check|", "w-expr-after-buckets-delete-rule-changed.json", "buckets-reviewed"],
      ["a function reached through a CHECK's operator", "(?:trigger|trigger-function|check|check-function|", "(?:trigger|trigger-function|check|", "w-expr-after-authusers-check-operator-function-replaced.json", "authusers-reviewed"],
    ].map((c, i) => [i, c])) {
      const r = fixture(shape);
      assert.deepEqual(C.buildPredicateFindings(r.build00, r.build00w, { creator: "postgres", ledger: "absent-table", reviewed: r.reviewed }).map((f) => f.key), [want], `${name}: the original refuses`);
      const K = await load(COMPARE, [from, to], dir, `after${m}`);
      // The mutant reads the review through its own filter, as the set it would have bound.
      const narrowed = Object.fromEntries(Object.entries(r.reviewed).map(([p, rows]) => [p, Object.fromEntries(Object.entries(rows).filter(([k]) => Object.hasOwn(K.reviewedSetOf(r.build00)[p], k)))]));
      assert.deepEqual(K.buildPredicateFindings(r.build00, r.build00w, { creator: "postgres", ledger: "absent-table", reviewed: narrowed }), [], `${name}: the mutant accepts`);
    }
    // B1's disposition.
    const bodies = fixture("w-expr-commit-buckets-reviewed-helper-in-a-parsed-body.json");
    const input = { build00: bodies.build00, build00w: bodies.build00w, ref: "abcdefghijklmnopqrst", finalFrom: json("w-old-state.json"), reviewed: bodies.reviewed };
    assert.equal(C.build01Facts(input).facts, null, "the original refuses no disposition");
    const K = await load(COMPARE, ["...bodyReviewFindings(build00, bodyReview)];", "];"], dir, "body");
    assert.notEqual(K.build01Facts(input).facts, null, "the mutant binds");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("4W-M3 each check of P1-4C's shape and of M-6g, removed, turns its negative into exactly no finding", async () => {
  const P1P = OUT["P1-4C"];
  const facts = json("w-old-facts.json").facts;
  const BUILD = A.build01Text(src, M, facts);
  const one = M.migrations.find((m) => m.n === "01");
  const files = [...M.baselineLedger.map((r) => ({ version: r.version, name: r.name, md5: r.md5, blob: r.blob })), { version: one.productionVersion, name: one.name, md5: one.md5, blob: one.blob }].map((f) => {
    const t = A.gitBlob(f.blob, ROOT);
    return { ...f, bytes: t.length, text: t.toString("utf8") };
  });
  const reads = { build00: src.item4c("build00").slice(0, -2), build00w: src.item4c("build00w").slice(0, -2) };
  const opts = { files, facts, createdBy: M.ledgerRow.createdBy, ...reads };
  const swapIn = (text, from, to) => { assert.equal(text.split(from).length, 2, from.slice(0, 80)); return text.split(from).join(to); };
  const inside = (t) => { const b = `do $stage0_locks$\nbegin\n  perform pg_temp.stage0_locks(3, 'before-savepoint');\n${A.RERAISE}$stage0_locks$;\n`; return swapIn(swapIn(t, b, ""), "\nsavepoint stage0_03_alone;\n", `\nsavepoint stage0_03_alone;\n${b}`); };
  const P1 = (K, text) => K.p1PrimeProblems(text, OUT);
  const B1 = (K, text) => K.build01Problems(text, opts);
  const CASES = [
    ["a boundary inside the savepoint", P1, inside(P1P), "if (at > opened && at < closed) problems.push(", "if (false) problems.push("],
    ["a commit for the rollback", P1, swapIn(P1P, "\nrollback;\n", "\ncommit;\n"), "if (!/^begin isolation level repeatable read;$/m.test(text) || !text.endsWith(\"\\nrollback;\\n\") || /^commit;$/m.test(text)) problems.push(", "if (false) problems.push("],
    ["a wrapper's bytes", P1, swapIn(P1P, "stage0 P2-05: store4979 is absent", "stage0 P2-05: store4979 is gone"), "if (text.split(body).length !== 2) { problems.push(`P1-4C does not hold ${k}'s body exactly once, byte for byte`); continue; }", "if (text.split(body).length !== 2) { continue; }"],
    ["RB-1's body", P1, swapIn(P1P, "\n-- ===== proofs section 4 =====", `\n${MC.stepBody(OUT["RB-1"], "RB-1")}\n-- ===== proofs section 4 =====`), "if (text.includes(stepBody(out[k], k))) problems.push(", "if (false) problems.push("],
    ["the catalog query", P1, swapIn(P1P, "-- @@catalog-rows end", "union all select 'x', 'y', 'z'\n-- @@catalog-rows end"), "if (!cat(text) || !out.P1 || cat(text) !== cat(out.P1)) problems.push(", "if (false) problems.push("],
    ["the helper's handler", P1, swapIn(P1P, "  exception\n    when lock_not_available or deadlock_detected then raise;\n    when others then\n", "  exception\n    when lock_not_available then raise;\n    when others then\n"), "if (!/^exception\\s+when\\s+lock_not_available\\s+or\\s+deadlock_detected\\s+then\\s+raise\\s*;/i.test(view.slice(m.index, m.index + 120))) out.push(", "if (false) out.push("],
    ["a proof expecting 40P01", P1, swapIn(P1P, "perform pg_temp.stage0_expect_error('E2', null,", "perform pg_temp.stage0_expect_error('E0', null, 'select 1', '40P01', 'x', 'select 1');\n  perform pg_temp.stage0_expect_error('E2', null,"), "if (/stage0_expect_error\\([^;]*'(55P03|40P01)'/.test(text)) out.push(", "if (false) out.push("],
    ["BUILD-01's read embedded", B1, swapIn(BUILD, reads.build00w, "select 'role' as part, 'name' as key, 'postgres' as value"), "if (rest.split(read).length !== 2) say(", "if (false) say("],
    ["a write in the re-assertion", B1, swapIn(BUILD, "  with f(src, part, key, value) as (", "  delete from public.stores;\n  with f(src, part, key, value) as ("), "if (into !== 1 || other.length) say(", "if (false) say("],
    ["a call off the list", B1, swapIn(BUILD, "  with f(src, part, key, value) as (", "  if pg_sleep(1) is null then null; end if;\n  with f(src, part, key, value) as ("), "if (calls.length) say(", "if (false) say("],
    ["the bound digests", B1, swapIn(BUILD, facts.digests.build00.buckets, "0".repeat(32)), "if (!body.includes(`bound(src, part, digest) as (values ${want})`)) say(", "if (false) say("],
    ["the bound reviewed set", B1, swapIn(BUILD, "reviewed(part, key, digest) as (values ", `reviewed(part, key, digest) as (values ('buckets', 'trigger|x', '${"0".repeat(32)}'), `), "if (!body.includes(`reviewed(part, key, digest) as (${accepted ? `values ${accepted}` : \"select null::text, null::text, null::text where false\"})`)) say(", "if (false) say("],
    ["the refusal of the bound acceptance", B1, swapIn(BUILD, "raise exception 'stage0 BUILD-01: the bound acceptance does not hold: %', v_bad using errcode = 'P0001';", "null;"), "if (!/select string_agg\\(distinct x\\.name, ', ' order by x\\.name\\) into v_bad from bad x;\\s+if v_bad is not null then\\s+raise exception 'stage0 BUILD-01: the bound acceptance does not hold: %'/.test(body)) say(", "if (false) say("],
    // The text has two default steps; String.replace takes the first, and these replacements hold no dollar.
    ["a form outside the default step's grammar", B1, BUILD.replace("  if (with have as (", "  alter default privileges for role postgres grant all on tables to anon;\n  if (with have as ("), "if (!B1_ALTER.test(s)) say(", "if (false) say("],
    ["another role's defaults", B1, BUILD.replace("  if (with have as (", "  alter default privileges for role anon grant select on tables to public;\n  if (with have as ("), "else if (!s.startsWith(`alter default privileges for role ${creator} `) && !s.startsWith(`alter default privileges for role ${creator}\\n`)) say(", "else if (false) say("],
  ];
  const dir = mkdtempSync(join(tmpdir(), "s0-4w-m6g-"));
  try {
    for (const [n, [name, run, text, from, to]] of CASES.entries()) {
      assert.notDeepEqual(run(MC, text), [], `${name}: the original refuses`);
      const K = await load(CHECK, [from, to], dir, n);
      let out = null, err = null;
      try { out = run(K, text); } catch (e) { err = e; }
      assert.equal(err, null, `${name}: the mutant gave an exception: ${err && err.message}`);
      assert.deepEqual(out, [], `${name}: the mutant finds nothing`);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
