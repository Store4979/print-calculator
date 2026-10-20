// scripts/tests/comment-lexing.test.js — the comment-stripping correction (CS).
// docs/security/stage0-comment-stripping-plan.md §4:
//   CS-1 Codex's reproductions at 41153b8, with their inputs verbatim;
//   CS-2 the JavaScript matrix for jsCode (source-util.mjs);
//   CS-3 the SQL matrix for lexSql/sqlCode (sql-lexer.mjs), and the
//        inventory's CREATE/DROP target forms;
//   CS-5 real-input preservation: only comments are removed, from every file
//        a consumer reads and every SQL text the inventory and M-6 read;
//   CS-6 no regex comment stripper is left in scripts/.
// The per-consumer CS-4 controls live in their consumers' test files.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { Parser } from "acorn";
import jsx from "acorn-jsx";
import { jsCode, jsTokens } from "./source-util.mjs";
import { lexSql, sqlCode, MAX_INPUT, MAX_COMMENT_DEPTH, MAX_BODY_DEPTH } from "./sql-lexer.mjs";
import { appliedReleaseState, readTablesSnapshot, protectedNamesByState, migrationView, ddlTargets, SNAPSHOT_PROJECT } from "./inventory-check.mjs";
import { readOnlyViolations, STATE_WRITE_WORDS, sizeProbeOutsideProblems, sqlView } from "./stage0-manifest-check.mjs";
import * as A from "../manual/assemble-stage0.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const rel = (p) => relative(ROOT, p).replace(/\\/g, "/");
const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const variants = (lf) => [["LF", lf], ["CRLF", lf.replace(/\n/g, "\r\n")], ["lone CR", lf.replace(/\n/g, "\r")]];

// ── CS-1: Codex's reproductions ────────────────────────────────────────────

test("CS-1a the getDocument call between two comment-like lines is visible", () => {
  const src = "// netlify/functions/*.js\nlib.getDocument({ data });\n// */\n";
  assert.match(jsCode(src, { label: "cs1a.js" }), /\bgetDocument\b/);
});

test("CS-1b the stamp probe keeps the required test AND shows the forbidden fetch", () => {
  const src = 'const PC = typeof __PC_BUILD__ !== "undefined";\n// netlify/functions/*.js\nfetch("/server-stamp");\n// */\n';
  const v = jsCode(src, { label: "cs1b.js" });
  assert.match(v, /typeof __PC_BUILD__ !== "undefined"/);
  assert.match(v, /fetch\s*\(/);
});

test("CS-1c the dist probe's read is visible", () => {
  // Assembled, so this file's own source never names a path into dist/
  // (build-stamp.test.js scans every test file for one).
  const path = ["..", "..", "dist", "assets", "main.js"].join("/");
  const v = jsCode(`// netlify/functions/*.js\nreadFileSync(${JSON.stringify(path)}, "utf8");\n// */\n`, { label: "cs1c.js" });
  assert.match(v, /["'`]\.\.\/\.\.\/dist(?:\/|["'`])/);
});

/** An isolated inventory root: migration files and a snapshot, nothing else. */
function sqlRoot({ applied = {}, pending = {}, rollbacks = {}, tables = ["stores"], ledgerVersion }) {
  const root = mkdtempSync(join(tmpdir(), "cs-sql-"));
  mkdirSync(join(root, "supabase", "migrations", "pending"), { recursive: true });
  mkdirSync(join(root, "supabase", "rollbacks"), { recursive: true });
  for (const [f, s] of Object.entries(applied)) writeFileSync(join(root, "supabase", "migrations", f), s);
  for (const [f, s] of Object.entries(pending)) writeFileSync(join(root, "supabase", "migrations", "pending", f), s);
  for (const [f, s] of Object.entries(rollbacks)) writeFileSync(join(root, "supabase", "rollbacks", f), s);
  const versions = Object.keys(applied).map((f) => f.slice(0, 14)).sort();
  writeFileSync(join(root, "supabase", "tables.json"), JSON.stringify({
    project: SNAPSHOT_PROJECT, capturedBy: "comment-lexing.test.js isolated fixture, not a live capture",
    query: "scripts/manual/tables-snapshot.sql", capturedAt: "2026-10-15T12:00:00Z", database: "postgres", role: "postgres",
    ledgerVersion: ledgerVersion ?? versions[versions.length - 1], tables, views: [], buckets: [],
  }));
  return root;
}
const withRoot = (opts, fn) => { const root = sqlRoot(opts); try { return fn(root); } finally { rmSync(root, { recursive: true, force: true }); } };
const snapshotOf = (root) => readTablesSnapshot(join(root, "supabase", "tables.json"), { root });

test("CS-1d a CREATE TABLE between `-- …/*` and `-- */` is applied state, and a snapshot without it is refused", () => {
  const sql = "-- netlify/functions/*.js\ncreate table public.audit_hidden (id int);\n-- */\n";
  withRoot({ applied: { "20261015120000_release2_99_audit.sql": sql } }, (root) => {
    const net = appliedReleaseState(root);
    assert.deepEqual(net.errors, []);
    assert.deepEqual([...net.present], ["audit_hidden"]);
    assert.match(snapshotOf(root).error || "", /lacks "audit_hidden"/);
  });
  withRoot({ applied: { "20261015120000_release2_99_audit.sql": sql }, tables: ["stores", "audit_hidden"] }, (root) => {
    assert.equal(snapshotOf(root).error, undefined, "the control: a snapshot that has it passes");
  });
});

test("CS-1e a DROP after a literal '--' is reported by the read-only predicate", () => {
  const p = readOnlyViolations("select '--'; drop table public.audit_hidden;", "cs1e", STATE_WRITE_WORDS);
  assert.equal(p.length, 1);
  assert.match(p[0], /not read-only: drop/);
  assert.deepEqual(readOnlyViolations("select '--';", "cs1e control", STATE_WRITE_WORDS), []);
});

// ── CS-2: the JavaScript matrix ────────────────────────────────────────────

test("CS-2 code next to comment-like text stays visible, on every line ending", () => {
  const cases = [
    ["a URL string, then a call on the same line", 'const u = "https://example.invalid/a"; call();\n', "x.js"],
    ["a regex literal holding /*", "const r = /[/*]/; call();\n/* x */\n", "x.js"],
    ["a regex literal ending \\//", "const r = /a\\//; call();\n", "x.js"],
    ["a template holding // and /*", "const t = `// /* ${x}`; call();\n/* x */\n", "x.js"],
    ["JSX text holding http:// and /*", "const t = <p>see http://x /* y</p>;\ncall();\n/* x */\n", "x.jsx"],
    ["accept=\"image/*,application/pdf\", code, then a real /* x */", 'const i = <input accept="image/*,application/pdf" />;\ncall();\n/* x */\n', "x.jsx"],
  ];
  for (const [name, lf, label] of cases) {
    for (const [ending, src] of variants(lf)) {
      assert.match(jsCode(src, { label }), /\bcall\(\);/, `${name} (${ending})`);
    }
  }
});

test("CS-2 real comments are blank, strings and templates kept, and a comment inside ${ } is blank", () => {
  for (const [ending, src] of variants("/* getDocument */ // getDocument\nconst t = `a ${x /* getDocument */} b`;\nconst s = \"// kept\";\n")) {
    const v = jsCode(src, { label: "x.js" });
    assert.doesNotMatch(v, /getDocument/, ending);
    assert.match(v, /`a \$\{x\s+\} b`/, `${ending}: the template is kept around the blanked comment`);
    assert.match(v, /"\/\/ kept"/, `${ending}: a string holding // is kept`);
  }
  const jsx = jsCode("const t = <p>{/* getDocument */}</p>;\n", { label: "x.jsx" });
  assert.doesNotMatch(jsx, /getDocument/);
  assert.match(jsx, /<p>\{\s+\}<\/p>/);
});

test("CS-2 the token boundary: let/**/x = 1; parses, and its view has the same tokens", () => {
  const src = "let/**/x = 1;";
  const v = jsCode(src, { label: "x.js" });
  assert.equal(v, "let    x = 1;");
  const a = jsTokens(src, { label: "x.js" }), b = jsTokens(v, { label: "x.js" });
  assert.equal(a.comments, 1);
  assert.equal(b.comments, 0);
  assert.deepEqual(b.tokens, a.tokens);
  assert.deepEqual(a.tokens.slice(0, 5).map((t) => t[1] ?? t[0]), ["let", "x", "=", "1", ";"], "two tokens, never `letx`");
});

test("CS-2 failure is explicit: a parse error throws with the label; an empty view throws unless allowed; no sourceType fallback", () => {
  assert.throws(() => jsCode("const = ;", { label: "bad.js" }), /bad\.js: does not parse as module/);
  assert.throws(() => jsCode("// only a comment\n", { label: "c.js" }), /c\.js: has no code outside its comments/);
  assert.match(jsCode("// only a comment\n", { label: "c.js", allowEmpty: true }), /^\s*$/);
  assert.throws(() => jsCode("with (o) { x(); }", { label: "w.js" }), /does not parse as module/, "a script-only form is not retried as a script");
  assert.match(jsCode("with (o) { x(); }", { label: "w.js", sourceType: "script" }), /with \(o\)/);
  assert.throws(() => jsCode("x();", {}), /a label is required/);
  assert.throws(() => jsCode("const t = <p/>;", { label: "x.js" }), /does not parse/, "JSX only under a .jsx label or jsx: true");
});

// ── CS-3: the SQL matrix ───────────────────────────────────────────────────

const code = (text, strings = "keep") => sqlCode(text, { label: "case", strings, bodies: "code" });
const kinds = (text) => lexSql(text, { label: "case" }).map((s) => s.kind);

test("CS-3 nested block comments are counted by depth, as PostgreSQL does", () => {
  const v = code("/* a /* b */ create table x (id int); */ create table y (id int);");
  assert.doesNotMatch(v, /create table x/);
  assert.match(v, /create table y/);
  assert.deepEqual(kinds("/* a /* b */ c */ select 1;"), ["block-comment", "code"]);
});

test("CS-3 dollar bodies: lexically strings; interpreted only by the consumer's role", () => {
  const fn = "create function f() returns void language plpgsql as $fn$ begin -- drop table z\n perform 1; drop table w; end $fn$;";
  const v = code(fn);
  assert.doesNotMatch(v, /drop table z/, "a comment inside an executable body is blank");
  assert.match(v, /drop table w/, "code inside an executable body is visible");
  assert.deepEqual(kinds(fn), ["code", "dollar", "code"], "the lexer itself never looks inside");
  // A data role is the consumer's decision: kept or blanked whole.
  const data = (s) => "data";
  assert.equal(sqlCode("select $d$ drop table q $d$;", { label: "case", strings: "keep", bodies: data }), "select $d$ drop table q $d$;");
  assert.equal(sqlCode("select $d$ drop table q $d$;", { label: "case", strings: "blank", bodies: data }), `select $d$${" ".repeat(" drop table q ".length)}$d$;`);
  assert.throws(() => sqlCode("select $d$ x $d$;", { label: "case", strings: "keep", bodies: () => "maybe" }), /not "code" or "data"/);
  assert.throws(() => sqlCode("select 1;", { label: "case", strings: "keep" }), /needs bodies/);
});

test("CS-3 a data literal that is not SQL lexes; interpreting it as code fails closed", () => {
  const text = "select $d$ it's $d$;";
  assert.deepEqual(kinds(text), ["code", "dollar", "code"]);
  assert.throws(() => code(text), /unterminated string/);
  assert.equal(sqlCode(text, { label: "case", strings: "keep", bodies: () => "data" }), text);
});

test("CS-3 '$$', $1 and a$b$ open no dollar quote", () => {
  assert.deepEqual(kinds("select '$$', $1, a$b$ from t;"), ["code", "string", "code"]);
});

test("CS-3 code after E-strings, backslashes and quoted identifiers stays visible", () => {
  for (const [name, text, hidden] of [
    ["an E-string with an escaped quote", "select E'it\\'s -- x'; drop table v;", "drop table v"],
    ["a standard string ending in a backslash", "select 'a\\'; drop table d; --'", "drop table d"],
    ["a quoted identifier holding --", 'select "a--b"; drop table c;', "drop table c"],
    ["a quoted identifier holding /*", 'select "a/*b"; drop table c2; select 1 */;', "drop table c2"],
    ["a U& quoted identifier", 'select U&"d--"; drop table c3;', "drop table c3"],
  ]) {
    for (const [ending, t] of variants(text)) assert.match(code(t), new RegExp(hidden), `${name} (${ending})`);
  }
  assert.deepEqual(kinds("select 'a\\'; drop table d; --'"), ["code", "string", "code", "line-comment"]);
});

test("CS-3 item 2's ENVELOPE-PROBE-2 shape: the executed text is visible with strings kept, blank with strings blanked", () => {
  const t = "do $$ begin execute E'select 1;\\n-- line two\\nselect 1/0;'; end $$;";
  assert.match(code(t, "keep"), /select 1\/0/);
  assert.doesNotMatch(code(t, "blank"), /select 1\/0/);
  assert.match(code(t, "blank"), /do \$\$ begin execute E'\s+'; end \$\$;/);
});

test("CS-3 unsupported or unterminated forms throw, with the label and offset", () => {
  for (const [name, text, re] of [
    ["a string", "select 'abc", /unterminated string at offset 7/],
    ["an E-string", "select E'abc\\'", /unterminated E-string/],
    ["a quoted identifier", 'select "abc', /unterminated quoted identifier/],
    ["a dollar quote", "select $x$ abc", /unterminated dollar quote \$x\$/],
    ["a block comment", "select 1 /* abc", /unterminated block comment/],
    ["a nested block comment", "select 1 /* /* */", /unterminated block comment/],
    ["a non-ASCII tag", "select $é$ x $é$", /neither a parameter nor a dollar quote/],
    ["a bare $x", "select $x from t", /neither a parameter nor a dollar quote/],
    ["the string mode", "set standard_conforming_strings = off;", /standard_conforming_strings/],
  ]) assert.throws(() => lexSql(text, { label: "case" }), re, name);
  assert.doesNotThrow(() => lexSql("-- standard_conforming_strings in a comment is fine\nselect 1;", { label: "case" }));
  assert.throws(() => lexSql("select 1;", {}), /a label is required/);
});

test("CS-3 bounds: comment nesting, body depth and input size", () => {
  const nest = (n) => "/*".repeat(n) + "*/".repeat(n) + " select 1;";
  assert.doesNotThrow(() => lexSql(nest(MAX_COMMENT_DEPTH), { label: "case" }));
  assert.throws(() => lexSql(nest(MAX_COMMENT_DEPTH + 1), { label: "case" }), /nested deeper than 64/);
  const bodies = (n) => { let s = "select 1;"; for (let i = 0; i < n; i++) s = `do $t${i}$ ${s} $t${i}$;`; return s; };
  assert.doesNotThrow(() => code(bodies(MAX_BODY_DEPTH)));
  assert.throws(() => code(bodies(MAX_BODY_DEPTH + 1)), /deeper than 8/);
  assert.throws(() => lexSql("x".repeat(MAX_INPUT + 1), { label: "case" }), /over the 4194304 limit/);
});

test("CS-3 the view keeps the length, and changes only comment characters", () => {
  const text = "select 'a -- b', \"c/*d\" /* e\n f */ from t -- g\r\nwhere x = $q$ -- h\n $q$;";
  const v = code(text);
  assert.equal(v.length, text.length);
  const mask = commentMask(text);
  for (let i = 0; i < text.length; i++) {
    if (mask[i]) assert.ok(v[i] === " " || ((text[i] === "\n" || text[i] === "\r") && v[i] === text[i]), `offset ${i} in a comment`);
    else assert.equal(v[i], text[i], `offset ${i} outside comments`);
  }
});

// The inventory's CREATE/DROP target forms (Codex Q5): one parser for the
// protected names, the applied state and the snapshot check.
const targets = (sql) => ddlTargets(migrationView(sql, "case"), "case");

test("CS-3 supported CREATE/DROP target forms give the full lower-case name", () => {
  assert.deepEqual(targets("CREATE TABLE IF NOT EXISTS Public.T (id int);"), { creates: ["t"], drops: [], errors: [] });
  assert.deepEqual(targets("create table public.device_enrollments (\n id uuid);"), { creates: ["device_enrollments"], drops: [], errors: [] });
  assert.deepEqual(targets("drop table if exists public.t cascade;\ndrop table u;"), { creates: [], drops: ["t", "u"], errors: [] });
  assert.deepEqual(targets("-- create table hidden (id int);\n/* drop table gone; */ select 1;"), { creates: [], drops: [], errors: [] });
});

test("CS-3 unsupported target forms are reported alike by the protected names, the applied state and the snapshot check, never as a partial name", () => {
  const forms = [
    ["a quoted name", 'create table "Audit" (id int);', /a quoted name/],
    ["another schema", "create table other.t (id int);", /the schema "other", not public/],
    ["a quoted schema", 'create table "public".t (id int);', /a quoted name/],
    ["more than one target", "drop table a, b;", /more than one target/],
    ["a modifier", "create unlogged table public.t (id int);", /unsupported DDL form "create unlogged table"/],
    ["a temporary table", "create temp table t (id int);", /unsupported DDL form/],
    ["CREATE … AS", "create table public.t as select 1;", /a CREATE not followed by \(/],
    ["a $ after the name", "create table foo$bar (id int);", /an identifier character after the name/],
    ["IF NOT EXISTS on a DROP", "drop table if not exists t;", /"if not exists" on a DROP/],
    ["IF EXISTS on a CREATE", "create table if exists t (id int);", /"if exists" on a CREATE/],
    ["a DROP not ended by ;", "drop table t\nselect 1;", /a DROP not ended by ;/],
  ];
  for (const [name, sql, re] of forms) {
    const direct = targets(sql);
    assert.ok(direct.errors.some((e) => re.test(e)), `${name}: ${JSON.stringify(direct.errors)}`);
    for (const n of [...direct.creates, ...direct.drops]) assert.ok(!["other", "foo", "public"].includes(n), `${name}: no partial name (${n})`);
    withRoot({ applied: { "20261015120000_release2_99_form.sql": `create table public.base (id int);\n${sql}\n` } }, (root) => {
      const names = protectedNamesByState(root);
      assert.ok(names.errors.some((e) => re.test(e)), `${name}: protected names report it`);
      assert.ok(![...names.all].some((n) => ["other", "foo", "audit"].includes(n)), `${name}: no partial protected name`);
      assert.ok(appliedReleaseState(root).errors.some((e) => re.test(e)), `${name}: the applied state reports it`);
      assert.match(snapshotOf(root).error || "", re, `${name}: the snapshot check refuses`);
    });
    withRoot({ applied: { "20261015120000_release2_99_base.sql": "create table public.base (id int);\n" }, pending: { "release2_98_form.sql": sql }, tables: ["stores", "base"] }, (root) => {
      assert.ok(protectedNamesByState(root).errors.some((e) => re.test(e)), `${name}: a pending file's form is reported too`);
    });
  }
});

// ── CS-R1…R3: Codex's review of 9333448 ────────────────────────────────────
// Each case below fails on 9333448's helpers and passes here (the review
// request's before-run). Line endings and separators are built from their
// code points, so no escape in this file can change on the way into it.
const CR = String.fromCharCode(13);
const LS = String.fromCharCode(0x2028), PS = String.fromCharCode(0x2029);
const endings = [["LF", "\n"], ["CRLF", CR + "\n"], ["lone CR", CR]];

test("CS-R1 a `--` comment ends at LF or CR, as in PostgreSQL: Codex's exact input, through the read-only predicate", () => {
  const exact = "select 1; -- comment" + CR + "drop table public.audit_hidden;";
  assert.deepEqual(readOnlyViolations(exact, "STATE", STATE_WRITE_WORDS), ["STATE is not read-only: drop"]);
  for (const [name, nl] of endings) {
    const text = `select 1; -- comment${nl}drop table public.audit_hidden;`;
    assert.deepEqual(readOnlyViolations(text, "STATE", STATE_WRITE_WORDS), ["STATE is not read-only: drop"], name);
    const segs = lexSql(text, { label: name });
    const comment = segs.find((s) => s.kind === "line-comment");
    assert.equal(text.slice(comment.start, comment.end), "-- comment", `${name}: the comment stops before the newline`);
    const view = code(text);
    assert.equal(view.slice(comment.end, comment.end + nl.length), nl, `${name}: the view keeps the newline characters`);
    assert.match(view, /drop table public\.audit_hidden;$/, name);
  }
  // Inside an executable dollar body too.
  assert.match(code("do $$ begin -- c" + CR + "drop table x; end $$;"), /drop table x;/);
});

test("CS-R1 the inventory/snapshot path: Codex's exact CREATE input, and each line ending", () => {
  const exact = "create table public.a (id int); -- comment" + CR + "create table public.audit_hidden (id int);";
  assert.deepEqual(targets(exact), { creates: ["a", "audit_hidden"], drops: [], errors: [] });
  for (const [name, nl] of endings) {
    const sql = `create table public.a (id int); -- comment${nl}create table public.audit_hidden (id int);${nl}`;
    withRoot({ applied: { "20261015120000_release2_99_cr.sql": sql }, tables: ["stores", "a"] }, (root) => {
      assert.deepEqual(appliedReleaseState(root).present.has("audit_hidden"), true, `${name}: applied state`);
      assert.ok(protectedNamesByState(root).all.has("audit_hidden"), `${name}: protected names`);
      assert.match(snapshotOf(root).error || "", /lacks "audit_hidden"/, `${name}: a snapshot without it is refused`);
    });
    withRoot({ applied: { "20261015120000_release2_99_cr.sql": sql }, tables: ["stores", "a", "audit_hidden"] }, (root) => {
      assert.equal(snapshotOf(root).error, undefined, `${name}: the control, a snapshot with both, passes`);
    });
  }
});

test("CS-R2 a continued E-string keeps its escape mode: Codex's exact input, through the read-only predicate", () => {
  const exact = "select E'a'\n'it\\'s -- x'; drop table public.audit_hidden;";
  assert.deepEqual(readOnlyViolations(exact, "STATE", STATE_WRITE_WORDS), ["STATE is not read-only: drop"]);
  const segs = lexSql(exact, { label: "exact" });
  assert.deepEqual(segs.filter((s) => s.kind !== "code").map((s) => [s.kind, !!s.continues, exact.slice(s.start, s.end)]),
    [["e-string", false, "E'a'"], ["e-string", true, "'it\\'s -- x'"]]);
  assert.equal(code(exact, "blank"), `select E' '\n'${" ".repeat("it\\'s -- x".length)}'; drop table public.audit_hidden;`, "the blank view keeps the delimiters of both segments");
});

test("CS-R2 continuation across each line ending, and across `--` comments, as scan.l's quotecontinue allows", () => {
  for (const [name, nl] of endings) {
    for (const [form, between] of [
      ["newline", nl],
      ["a comment on the first line", ` -- c${nl}`],
      ["a comment on its own line", `${nl}-- c${nl}`],
      ["blank lines", `${nl}  ${nl}${nl}`],
    ]) {
      const text = `select E'a'${between}'it\\'s -- x'; drop table public.audit_hidden;`;
      assert.deepEqual(readOnlyViolations(text, "STATE", STATE_WRITE_WORDS), ["STATE is not read-only: drop"], `${form} (${name})`);
      assert.ok(lexSql(text, { label: "c" }).some((s) => s.continues), `${form} (${name}) continues`);
    }
  }
  // Not continuation in PostgreSQL: on the same line, after a block comment,
  // or after a comment that runs to the end. The second string is then
  // ordinary, as scan.l lexes it.
  for (const [form, text] of [
    ["the same line", "select E'a' 'b';"],
    ["a block comment between", "select E'a' /* c */\n'b';"],
    ["a comment to the end", "select E'a' -- c"],
  ]) assert.ok(!lexSql(text, { label: "n" }).some((s) => s.continues), form);
  // An ordinary string's continuation (the real inputs' multi-line comments) is ordinary.
  const plain = "comment on table t is 'a\\'\n  'b'; drop table t;";
  assert.deepEqual(lexSql(plain, { label: "p" }).filter((s) => s.kind !== "code").map((s) => s.kind), ["string", "string"]);
  assert.match(code(plain), /drop table t;/);
});

// Codex's review of 1c4d8a4: the continuation recognizer must take its
// whitespace from scan.l. non_newline_space is [ \t\f\v]; vertical tab was
// missing before the first newline. Built from code points: SP, HT, FF, VT.
const NON_NEWLINE_SPACE = [["SP", String.fromCharCode(32)], ["HT", String.fromCharCode(9)], ["FF", String.fromCharCode(12)], ["VT", String.fromCharCode(11)]];
const VT = String.fromCharCode(11);
/** Both consumers on one continuation separator: read-only, and the inventory/snapshot path. */
function bothConsumersSeeTheWrite(sep, name) {
  const dropText = `select E'a'${sep}'it\\'s -- x'; drop table public.audit_hidden;`;
  assert.deepEqual(readOnlyViolations(dropText, "STATE", STATE_WRITE_WORDS), ["STATE is not read-only: drop"], `${name}: read-only`);
  assert.ok(lexSql(dropText, { label: name }).some((s) => s.continues), `${name}: it continues, as in PostgreSQL`);
  const sql = `create table public.a (id int);\ncomment on table public.a is E'x'${sep}'it\\'s -- y'; create table public.audit_hidden (id int);\n`;
  withRoot({ applied: { "20261015120000_release2_99_vt.sql": sql }, tables: ["stores", "a"] }, (root) => {
    assert.ok(appliedReleaseState(root).present.has("audit_hidden"), `${name}: applied state`);
    assert.ok(protectedNamesByState(root).all.has("audit_hidden"), `${name}: protected names`);
    assert.match(snapshotOf(root).error || "", /lacks "audit_hidden"/, `${name}: the snapshot without it is refused`);
  });
  withRoot({ applied: { "20261015120000_release2_99_vt.sql": sql }, tables: ["stores", "a", "audit_hidden"] }, (root) => {
    assert.equal(snapshotOf(root).error, undefined, `${name}: the control, a snapshot with it, passes`);
  });
}

test("CS-R2b Codex's exact vertical-tab input continues the E-string, through both consumers", () => {
  const exact = "select E'a'" + VT + "\n'it\\'s -- x'; drop table public.audit_hidden;";
  assert.deepEqual(readOnlyViolations(exact, "STATE", STATE_WRITE_WORDS), ["STATE is not read-only: drop"]);
  assert.deepEqual(lexSql(exact, { label: "exact" }).filter((s) => s.kind !== "code").map((s) => [s.kind, !!s.continues]), [["e-string", false], ["e-string", true]]);
  bothConsumersSeeTheWrite(VT + "\n", "VT LF");
});

test("CS-R2b each non_newline_space character, before and after LF, CRLF and CR, with and without a line comment, through both consumers", () => {
  for (const [wsName, ws] of NON_NEWLINE_SPACE) {
    for (const [nlName, nl] of endings) {
      for (const [form, sep] of [
        ["before", `${ws}${nl}`],
        ["before, then a comment", `${ws}-- c${nl}`],
        ["after", `${nl}${ws}`],
        ["after, then a comment", `${nl}${ws}-- c${nl}`],
      ]) bothConsumersSeeTheWrite(sep, `${wsName} ${form} ${nlName}`);
    }
  }
});

test("CS-R2 the inventory/snapshot path: a CREATE after a continued E-string is applied state", () => {
  const sql = "create table public.a (id int);\ncomment on table public.a is E'x'\n'it\\'s -- y'; create table public.audit_hidden (id int);\n";
  withRoot({ applied: { "20261015120000_release2_99_cont.sql": sql }, tables: ["stores", "a"] }, (root) => {
    assert.ok(appliedReleaseState(root).present.has("audit_hidden"));
    assert.ok(protectedNamesByState(root).all.has("audit_hidden"));
    assert.match(snapshotOf(root).error || "", /lacks "audit_hidden"/);
  });
});

test("CS-R3 a comment holding U+2028 or U+2029 still breaks the line: the AST and the result are unchanged", () => {
  for (const [name, sep] of [["U+2028", LS], ["U+2029", PS], ["LF (control)", "\n"]]) {
    const raw = `function f() { return /*${sep}*/ 1; } f();`;
    const view = jsCode(raw, { label: "asi.js" });
    assert.equal(view.length, raw.length);
    assert.equal(view[raw.indexOf(sep)], sep, `${name}: the separator is kept`);
    const returned = (src) => Parser.parse(src, { ecmaVersion: "latest", sourceType: "script" }).body[0].body.body[0].argument;
    assert.equal(returned(raw), null, `${name}: ASI ends the return in the source`);
    assert.equal(returned(view), null, `${name}: and in the view`);
    assert.equal(vm.runInNewContext(view), vm.runInNewContext(raw), `${name}: the view runs as the source does`);
    assert.equal(vm.runInNewContext(view), undefined, name);
  }
});

// ── CS-5: real-input preservation ──────────────────────────────────────────

/** Comment positions at every depth, dollar bodies read as code. */
function commentMask(text) {
  const mask = new Uint8Array(text.length);
  const mark = (t, base) => {
    for (const s of lexSql(t, { label: "mask" })) {
      if (s.kind === "line-comment" || s.kind === "block-comment") mask.fill(1, base + s.start, base + s.end);
      else if (s.kind === "dollar") mark(t.slice(s.bodyStart, s.bodyEnd), base + s.bodyStart);
    }
  };
  mark(text, 0);
  return mask;
}

/** Every file a jsCode consumer reads (comment-stripping plan §2.1), and how. */
function jsInputs() {
  const src = walk(join(ROOT, "src")).filter((f) => /\.jsx?$/.test(f)).map(rel);
  const tests = readdirSync(join(ROOT, "scripts", "tests")).filter((f) => /\.test\.js$/.test(f)).map((f) => `scripts/tests/${f}`);
  const named = [
    "vite.config.js", "scripts/inject-sw-manifest.mjs", "scripts/tests/inventory-check.mjs",
    "netlify/lib/deploy-context.js", "netlify/lib/release2.js", "netlify/lib/release2-auth.js", "netlify/functions/deploy-context.js",
    ...["staff-login", "enroll-redeem", "enroll-ticket-create", "csrf-bootstrap", "staff-logout", "staff-session-revoke-all", "enroll-revoke", "enroll-list"].map((n) => `netlify/functions/${n}.js`),
  ];
  return [...new Set([...src, ...tests, ...named])].sort().map((p) => ({ p, opts: { label: p } })).concat([{ p: "public/sw.js", opts: { label: "public/sw.js", sourceType: "script" } }]);
}

/**
 * The whole AST, positions included. Token equality alone does not prove the
 * view means what the source means: blanking a line terminator inside a
 * comment keeps every token and changes automatic semicolon insertion
 * (CS-R3). The AST shows that change.
 */
const JSX_PARSER = Parser.extend(jsx());
function astOf(src, opts) {
  const P = (opts.jsx ?? /\.jsx$/.test(opts.label)) ? JSX_PARSER : Parser;
  const ast = P.parse(src.replace(/\r\n?/g, "\n"), { ecmaVersion: "latest", sourceType: opts.sourceType ?? "module" });
  return JSON.stringify(ast, (k, v) => (typeof v === "bigint" ? `${v}n` : v instanceof RegExp ? String(v) : v));
}

test("CS-5 every file a JavaScript consumer reads parses, and its view has exactly its tokens and AST, and no comment", () => {
  const inputs = jsInputs();
  assert.ok(inputs.length >= 68, `the consumers' input set (${inputs.length})`);
  for (const { p, opts } of inputs) {
    const raw = readFileSync(join(ROOT, p), "utf8");
    const view = jsCode(raw, opts);
    const a = jsTokens(raw, opts), b = jsTokens(view, opts);
    assert.equal(b.comments, 0, `${p}: no comment survives`);
    assert.deepEqual(b.tokens, a.tokens, `${p}: the view's tokens are the source's`);
    assert.ok(astOf(view, opts) === astOf(raw, opts), `${p}: the view's AST is the source's`);
  }
});

/** Every SQL text the inventory or M-6 reads. */
function sqlInputs() {
  const dirs = [join(ROOT, "supabase", "migrations"), join(ROOT, "supabase", "migrations", "pending"), join(ROOT, "supabase", "rollbacks")];
  const files = dirs.filter(existsSync).flatMap((d) => readdirSync(d).filter((f) => /(^|_)release2_.*\.sql$/i.test(f)).map((f) => join(d, f)));
  // The bytes as they are, a Windows checkout's CRLF included (CS-R1).
  const out = files.map((f) => ({ label: rel(f), text: readFileSync(f, "utf8") }));
  const M = A.manifestAt("HEAD", ROOT);
  const texts = A.assembleAll(M, { cwd: ROOT });
  for (const k of ["STATE", "CANCEL-INSPECT", "CANCEL-STEP-TEMPLATE", ...Object.keys(texts).filter((x) => x.startsWith("LOCKPROBE-"))]) out.push({ label: k, text: texts[k] });
  return out;
}

test("CS-5 every SQL text the inventory and M-6 read lexes, and its view keeps code and strings, changing only comment characters", () => {
  const inputs = sqlInputs();
  assert.ok(inputs.length >= 20, `the SQL input set (${inputs.length})`);
  for (const { label, text } of inputs) {
    const v = sqlCode(text, { label, strings: "keep", bodies: "code" });
    const mask = commentMask(text);
    let changed = 0;
    for (let i = 0; i < text.length; i++) {
      if (mask[i]) { if (v[i] !== " " && !((text[i] === "\n" || text[i] === "\r") && v[i] === text[i])) assert.fail(`${label}: offset ${i} in a comment is not blank`); }
      else if (v[i] !== text[i]) { changed++; break; }
    }
    assert.equal(changed, 0, `${label}: a character outside comments changed`);
  }
  assert.deepEqual(sizeProbeOutsideProblems(A.SIZE_PROBE_HEAD, A.SIZE_PROBE_TAIL), [], "SIZE-PROBE's head and tail");
  assert.equal(sqlView(A.SIZE_PROBE_HEAD + A.SIZE_PROBE_TAIL, "SIZE-PROBE", "blank", () => "data").problem, undefined);
});

// ── CS-6: no regex comment stripper is left ────────────────────────────────

/** Regex literals passed first to .replace/.replaceAll whose source holds \/\*, \/\/ or --. */
function regexStrippers(src, label) {
  const found = [];
  const ast = Parser.parse(src.replace(/\r\n?/g, "\n"), { ecmaVersion: "latest", sourceType: "module", locations: true, allowHashBang: true });
  const walkAst = (n) => {
    if (!n || typeof n.type !== "string") return;
    if (n.type === "CallExpression" && n.callee.type === "MemberExpression" && !n.callee.computed
        && ["replace", "replaceAll"].includes(n.callee.property.name)) {
      const first = n.arguments[0];
      if (first && first.type === "Literal" && first.regex && /\\\/\\\*|\\\/\\\/|--/.test(first.regex.pattern)) found.push(`${label}:${n.loc.start.line}: .${n.callee.property.name}(/${first.regex.pattern}/${first.regex.flags})`);
    }
    for (const v of Object.values(n)) {
      if (Array.isArray(v)) v.forEach(walkAst);
      else if (v && typeof v.type === "string") walkAst(v);
    }
  };
  walkAst(ast);
  return found;
}

test("CS-6 the guard trips on each old implementation, verbatim", () => {
  const OLD = {
    "source-util.mjs stripComments": String.raw`export const stripComments = (src) =>
  src.replace(/\r\n?/g, "\n")
     .replace(/\/\*[\s\S]*?\*\//g, "")
     .split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");`,
    "sw-clear-caches.test.js inline copy": String.raw`const code = SW_SOURCE.replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");`,
    "inventory-check.mjs sqlWithoutComments": String.raw`const sqlWithoutComments = (sql) => sql.replace(/\r\n/g, "\n").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");`,
    "stage0-manifest-check.mjs STATE pass": String.raw`const stt = (out.STATE || "").replace(/--[^\n]*/g, " ");`,
  };
  for (const [name, src] of Object.entries(OLD)) assert.ok(regexStrippers(src, name).length > 0, `${name} must trip the guard`);
});

test("CS-6 no regex comment stripper is left anywhere in scripts/ (a regression check for the named regex-literal forms; new RegExp(…) is not covered)", () => {
  const files = walk(join(ROOT, "scripts")).filter((f) => /\.m?js$/.test(f) && !f.includes("node_modules"));
  for (const f of ["scripts/tests/source-util.mjs", "scripts/tests/sw-clear-caches.test.js", "scripts/tests/inventory-check.mjs", "scripts/tests/stage0-manifest-check.mjs"]) {
    assert.ok(files.map(rel).includes(f), `the walk covers ${f}, where the old strippers were`);
  }
  const found = files.flatMap((f) => regexStrippers(readFileSync(f, "utf8"), rel(f)));
  assert.deepEqual(found, [], "the exemption list is empty");
});
