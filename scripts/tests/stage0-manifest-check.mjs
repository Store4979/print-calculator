// scripts/tests/stage0-manifest-check.mjs — THE checks behind
// docs/security/stage0-production-manifest.json, as one function over a
// repository directory (review of d01b74a, N3). stage0-manifest.test.js runs
// it on this repository; stage0-manifest.lifecycle.test.js runs the SAME
// function on a scratch clone walked through every repository state stage 0
// produces: pending, after each apply, fully applied, committed rollback.
//
// Byte checking stays strict in every state. Each pinned input is identified
// by its git blob id, and in every state the file must exist, at the path that
// state puts it, with exactly that blob. What changes between states is only
// WHERE a file must be, and that is derived from the manifest's recorded state
// (migrations[].productionVersion, rollbackRecords), never guessed from the
// directory.
//
// Returns { "M-1": [problems…], … }; an empty array means that check passed.
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, posix } from "node:path";
import { createRequire } from "node:module";
import * as A from "../manual/assemble-stage0.mjs";
import * as S from "../manual/stage0-send.mjs";
import * as G from "../manual/stage0-guard.mjs";
import * as C from "../manual/stage0-classify.mjs";
import { MIGRATIONS_DIR, ROLLBACKS_DIR, eligibleMigrations, duplicateVersions } from "./supabase-migration-discovery.mjs";
import { sqlCode, lexSql } from "./sql-lexer.mjs";

export const MANIFEST_PATH = "docs/security/stage0-production-manifest.json";
const md5 = (b) => createHash("md5").update(b).digest("hex");

export function gitIn(repo) {
  const out = (...args) => execFileSync("git", args, { cwd: repo, maxBuffer: 1 << 26 });
  const txt = (...args) => out(...args).toString("utf8").trim();
  const tryTxt = (...args) => { try { return txt(...args); } catch { return null; } };
  // One `ls-tree -r -t` per revision, cached: path → object id (blobs and trees).
  const trees = new Map();
  const treeOf = (rev) => {
    if (!trees.has(rev)) {
      const m = new Map();
      const raw = tryTxt("ls-tree", "-r", "-t", "--full-tree", rev) || "";
      for (const line of raw.split("\n")) {
        const t = line.indexOf("\t");
        if (t < 0) continue;
        const [, type, id] = line.slice(0, t).split(" ");
        m.set(line.slice(t + 1), { type, id });
      }
      trees.set(rev, m);
    }
    return trees.get(rev);
  };
  return {
    out, txt, tryTxt,
    hasCommit: (rev) => { try { out("cat-file", "-e", `${rev}^{commit}`); return true; } catch { return false; } },
    shallow: () => txt("rev-parse", "--is-shallow-repository") === "true",
    lastChange: (p) => txt("log", "-1", "--format=%H", "--", p),
    objAt: (rev, p) => treeOf(rev).get(p)?.id ?? null,
    blob: (id) => out("cat-file", "blob", id),
    lsTree: (rev, dir) => [...treeOf(rev)].filter(([p, o]) => o.type === "blob" && p.startsWith(dir + "/")).map(([p]) => p),
    /** The entries directly inside `dir` at `rev`, files and directories alike. */
    lsTop: (rev, dir) => [...treeOf(rev)]
      .filter(([p]) => p.startsWith(dir + "/") && !p.slice(dir.length + 1).includes("/"))
      .map(([p, o]) => ({ name: p.slice(dir.length + 1), isDirectory: o.type === "tree" })),
  };
}

// ── the inventory's own code, for M-7b ───────────────────────────────────────
export const INVENTORY = "scripts/tests/inventory-check.mjs";
/**
 * `entry` and every module it imports by a relative path, transitively, as
 * read from HEAD. Each module is PARSED (acorn, the inventory's own parser),
 * so comments and strings cannot hide or fake an import: a text scan
 * missed both of inventory-check.mjs's local imports, because a `/*` inside
 * a line comment swallowed them. Static imports, re-exports and literal
 * import() count. A module that does not parse, or a non-literal import(),
 * is returned in `unbound`. acorn is loaded only when this runs, so the
 * tools that import this module for its path helpers need no node_modules.
 * `external` lists the specifiers that are not relative paths; `specsOf`
 * each module's own.
 */
export function localImportClosure(g, entry) {
  const { Parser } = createRequire(import.meta.url)("acorn");
  const seen = new Set(), unbound = [], queue = [entry], external = new Set(), specsOf = {};
  while (queue.length) {
    const p = queue.shift();
    if (seen.has(p)) continue;
    seen.add(p);
    const src = g.tryTxt("show", `HEAD:${p}`);
    if (src === null) continue;
    let ast;
    try { ast = Parser.parse(src, { ecmaVersion: "latest", sourceType: "module" }); } catch (e) { unbound.push(`${p} does not parse (${e.message})`); continue; }
    const specs = [];
    const visit = (n) => {
      if (!n || typeof n.type !== "string") return;
      if ((n.type === "ImportDeclaration" || n.type === "ExportAllDeclaration" || n.type === "ExportNamedDeclaration") && n.source) specs.push(n.source.value);
      if (n.type === "ImportExpression") {
        if (n.source.type === "Literal" && typeof n.source.value === "string") specs.push(n.source.value);
        else unbound.push(`${p} has an import() whose source is not a string literal`);
      }
      for (const k of Object.keys(n)) {
        const v = n[k];
        if (Array.isArray(v)) v.forEach(visit);
        else if (v && typeof v.type === "string") visit(v);
      }
    };
    visit(ast);
    specsOf[p] = [...new Set(specs)].sort();
    for (const s of specs) {
      if (/^\.\.?\//.test(s)) queue.push(posix.normalize(posix.join(posix.dirname(p), s)));
      else external.add(s);
    }
  }
  return { modules: [...seen], unbound, external: [...external].sort(), specsOf };
}

// ── where each file must be in the recorded state ────────────────────────────
// An applied forward file sits at its ledger version in supabase/migrations/.
// Its UNEXECUTED rollback companion sits in supabase/rollbacks/, outside the
// directory the Supabase CLI discovers migrations in (Codex's review of
// 76883c6, item 1). An EXECUTED rollback has its own ledger version and is a
// migration file like any other (recordPath).
const MIG = MIGRATIONS_DIR;
export const forwardPath = (m) => (m.productionVersion ? `${MIG}/${m.productionVersion}_${m.name}.sql` : m.pendingPath);
export const companionPath = (m, r) => (m.productionVersion ? `${ROLLBACKS_DIR}/${m.productionVersion}_${m.name}.rollback.sql` : r.pendingPath);
export const recordPath = (m, rec) => `${MIG}/${rec.version}_${m.name}_rollback.sql`;

// ── M-6/M-6b's SQL predicates (comment-stripping plan §3.5) ─────────────────
// Each reads a sql-lexer.mjs view and returns its problems; M-6 says each one,
// and the CS-4 controls run the same functions on mutants. A text that does
// not lex is a problem. These are heuristic checks next to the byte bindings
// (embedded blobs, md5/bytes gates, output pins, send policy), which they do
// not replace.
export const STATE_WRITE_WORDS = /\b(insert|update|delete|create|alter|drop|truncate|begin|commit|grant|revoke|lock)\b/gi;
export const INSPECT_WRITE_WORDS = /\b(insert|update|delete|create|alter|drop|truncate|begin|commit|grant|revoke|do|lock)\b|pg_cancel_backend|pg_terminate_backend/gi;
export const SIZE_PROBE_WRITE_WORDS = /\b(insert|update|delete|create|drop|alter|grant|revoke|truncate|begin|commit|call|do)\b/gi;

/** A view of a whole stage-0 text: every dollar body in these texts is a DO body or an executed input. */
export function sqlView(text, label, strings, bodies = "code") {
  try { return { view: sqlCode(text, { label, strings, bodies }) }; }
  catch (e) { return { problem: `${label} does not lex: ${e.message}` }; }
}

/** The write keywords in `text` outside comments and strings; an empty text is a problem too. */
export function readOnlyViolations(text, label, words) {
  const r = sqlView(text, label, "blank");
  if (r.problem) return [r.problem];
  if (!/\S/.test(r.view)) return [`${label} is empty`];
  const found = [...new Set([...r.view.matchAll(words)].map((m) => m[0].toLowerCase()))];
  return found.length ? [`${label} is not read-only: ${found.join(", ")}`] : [];
}

/** CANCEL-STEP: one pg_cancel_backend, no pg_terminate_backend, its exact filters, refusals before the signal. */
export function cancelStepProblems(text) {
  const r = sqlView(text, "CANCEL-STEP-TEMPLATE", "keep");
  if (r.problem) return [r.problem];
  const cs = r.view, out = [];
  if ((cs.match(/pg_cancel_backend\(/g) || []).length !== 1 || /pg_terminate_backend/.test(cs)) out.push("CANCEL-STEP must call pg_cancel_backend exactly once and never pg_terminate_backend");
  for (const [what, re] of [
    ["matches the exact application_name", /where a\.application_name = v_app\s/],
    ["matches the exact backend_start", /backend_start at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS\.US"Z"'\) = v_start\s/],
    ["excludes the caller", /and a\.pid <> pg_backend_pid\(\);/],
    ["refuses zero matches", /if v_n = 0 then\s+raise exception/],
    ["refuses more than one match", /if v_n > 1 then\s+raise exception/],
    ["accepts only the stage-0 step names", new RegExp(`if v_app not in \\(${A.CANCEL_TARGETS.map((x) => `'${x}'`).join(", ")}\\) then\\s+raise exception`)],
  ]) if (!re.test(cs)) out.push(`CANCEL-STEP ${what}`);
  const sig = cs.indexOf("pg_cancel_backend(");
  if (!(cs.indexOf("if v_n = 0") < sig && cs.indexOf("if v_n > 1") < sig)) out.push("CANCEL-STEP signals before its refusals");
  return out;
}

/** The item 2 envelope probes (classifier plan §6 B): staging only, read_only. */
export const ENVELOPE_PROBES = ["ENVELOPE-PROBE-1", "ENVELOPE-PROBE-2", "ENVELOPE-PROBE-3", "ENVELOPE-PROBE-4", "ENVELOPE-PROBE-5"];
/**
 * Item 3's texts (docs/security/stage0-item3-read-token-plan.md): staging
 * only, each with its window, its request mode and its EFFECT. The effect is
 * what the SQL may do, declared apart from read_only, the mode under test
 * (Codex, item 3 plan review I3-1).
 */
export const I3_POLICY = Object.freeze({
  "I3-SETUP": { window: "W", readOnly: false, effect: "write" },
  "I3-FIXTURE": { window: "R", readOnly: true, effect: "read" },
  "I3-READBACK": { window: "W", readOnly: false, effect: "read" },
  "I3-WHO-R-RO": { window: "R", readOnly: true, effect: "read" },
  "I3-WHO-R-DEF": { window: "R", readOnly: false, effect: "read" },
  "I3-WHO-W-RO": { window: "W", readOnly: true, effect: "read" },
  "I3-WHO-W-DEF": { window: "W", readOnly: false, effect: "read" },
  "I3-INS-OWNED-W-RO": { window: "W", readOnly: true, effect: "write" },
  "I3-INS-OWNED-R-RO": { window: "R", readOnly: true, effect: "write" },
  "I3-INS-OPEN-R-RO": { window: "R", readOnly: true, effect: "write" },
  "I3-INS-OWNED-W-DEF": { window: "W", readOnly: false, effect: "write" },
  "I3-INS-OPEN-R-DEF": { window: "R", readOnly: false, effect: "write" },
  "I3-INS-OWNED-R-DEF": { window: "R", readOnly: false, effect: "write" },
  "I3-DDL-W-DEF": { window: "W", readOnly: false, effect: "write" },
  "I3-DDL-R-DEF": { window: "R", readOnly: false, effect: "write" },
  "I3-CLEANUP": { window: "W", readOnly: false, effect: "write" },
  "I3-ABSENT": { window: "R", readOnly: true, effect: "read" },
});
/**
 * The texts that predate item 3 and may leave `effect` out: the classifier
 * then takes their effect from read_only, as before (I3-1: no broad
 * reclassification). Every other text declares its effect.
 */
export const LEGACY_EFFECT_TEXTS = Object.freeze(["P0", "P1", "SIZE-PROBE", "P2-01", "P2-02", "P2-0304", "P2-05", "STATE", "CANCEL-INSPECT", "CANCEL-STEP-TEMPLATE",
  "LOCKPROBE-SETUP", "LOCKPROBE-HOLD", "LOCKPROBE-B-LOCKTIMEOUT", "LOCKPROBE-B-STMTTIMEOUT", "LOCKPROBE-B-TXTIMEOUT", "LOCKPROBE-B-CANCEL", "LOCKPROBE-C-CANCEL",
  "LOCKPROBE-B-POSITIVE", "LOCKPROBE-READBACK", "LOCKPROBE-CLEANUP", "RB-5", "RB-43", "RB-2", "RB-1", ...ENVELOPE_PROBES]);
/**
 * The window each sendable text goes from (Codex item 6, Q2), listed, not
 * derived from readOnly: LOCKPROBE-READBACK and CANCEL-INSPECT are not
 * read_only and write nothing. R reads; W writes, or reads back inside a
 * writing phase; C is the second caller that cancels.
 */
export const windowFor = (k) => (Object.hasOwn(I3_POLICY, k) ? I3_POLICY[k].window : ["P0", "STATE", "SIZE-PROBE", ...ENVELOPE_PROBES].includes(k) ? "R" : ["CANCEL-INSPECT", "CANCEL-STEP-TEMPLATE"].includes(k) ? "C" : "W");
export const PROBE_WRITE_WORDS = /\b(insert|update|delete|merge|create|alter|drop|truncate|grant|revoke|lock|commit|rollback|savepoint|call|copy|set|reset|perform|notify|listen|vacuum|analyze|cluster|reindex|refresh|comment|security|import|load|prepare)\b|\bpg_\w+\s*\(/gi;

const BACKSLASH = String.fromCharCode(92);
/** JSON with every object's keys sorted, so two policies compare by content. */
const canonicalJson = (v) => JSON.stringify(v, (k, x) => (x !== null && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((y) => [y, x[y]])) : x));

/**
 * An E-string's characters with PostgreSQL's backslash escapes decoded
 * (\b \f \n \r \t as a space; octal, \x, \u and \U as their character; any
 * other \c as c), so that a word an escape runs into is still a word.
 */
export function decodeEString(raw) {
  let out = "";
  const take = (from, max, ok) => { let s = ""; while (s.length < max && ok(raw[from + s.length] ?? "")) s += raw[from + s.length]; return s; };
  const isOct = (c) => c >= "0" && c <= "7";
  const isHex = (c) => /^[0-9A-Fa-f]$/.test(c);
  const ch = (cp) => (cp <= 0x10ffff ? String.fromCodePoint(cp) : " ");
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] !== BACKSLASH) { out += raw[i]; continue; }
    const n = raw[i + 1] ?? "";
    if (n && "bfnrt".includes(n)) { out += " "; i += 1; }
    else if (isOct(n)) { const s = take(i + 1, 3, isOct); out += ch(parseInt(s, 8)); i += s.length; }
    else if (n === "x") { const s = take(i + 2, 2, isHex); out += s ? ch(parseInt(s, 16)) : "x"; i += 1 + s.length; }
    else if (n === "u" || n === "U") { const want = n === "u" ? 4 : 8; const s = take(i + 2, want, isHex); out += s.length === want ? ch(parseInt(s, 16)) : n; i += 1 + s.length; }
    else { out += n; i += 1; }
  }
  return out;
}

/** A lexed text with every E-string decoded, inside dollar bodies too (to the lexer's body depth). */
function eStringsDecoded(text, label, depth = 0) {
  return lexSql(text, { label }).map((s) => {
    if (s.kind === "e-string") return ` ${decodeEString(text.slice(s.start, s.end))} `;
    if (s.kind === "dollar" && depth < 8) return text.slice(s.start, s.bodyStart) + eStringsDecoded(text.slice(s.bodyStart, s.bodyEnd), label, depth + 1) + text.slice(s.bodyEnd, s.end);
    return text.slice(s.start, s.end);
  }).join("");
}

/**
 * M-6d: the write words of an envelope probe, read with its strings KEPT,
 * because what probe 2 EXECUTEs is a string, and with every E-string's
 * escapes decoded. A U& literal, whose escapes are not decoded here, is a
 * problem; so is an empty text. A write assembled at run time (string
 * concatenation, format()) is not seen: the md5 pin (M-6) and review are the
 * control for that.
 */
export function probeWriteViolations(text, label) {
  const r = sqlView(text, label, "keep");
  if (r.problem) return [r.problem];
  if (!/\S/.test(r.view)) return [`${label} is empty`];
  let decoded;
  try { decoded = eStringsDecoded(r.view, label); } catch (e) { return [`${label} does not lex: ${e.message}`]; }
  const out = [];
  if (/\bu&\s*['"]/i.test(decoded)) out.push(`${label} holds a U& literal or identifier, whose escapes M-6d does not decode`);
  const found = [...new Set([...decoded.matchAll(PROBE_WRITE_WORDS)].map((m) => m[0].toLowerCase()))];
  if (found.length) out.push(`${label} is not read-only: ${found.join(", ")}`);
  return out;
}

const I3_READ_WORDS = /\b(insert|update|delete|merge|create|alter|drop|truncate|grant|revoke|lock|commit|rollback|savepoint|call|copy|set|reset|perform|notify|listen|vacuum|analyze|cluster|reindex|refresh|comment|security|import|load|prepare|execute|do|into)\b/gi;
/** Every name a read text may put before "(": its functions, and the two keywords the real texts parenthesize after. */
const I3_READ_CALLS = ["and", "select", "coalesce", "count", "current_setting", "has_schema_privilege", "has_table_privilege", "json_agg", "json_build_object", "pg_get_userbyid", "pg_has_role", "to_regnamespace"];
const I3_WRITE_FORBIDDEN = /\b(set|reset|copy|call|security|perform|execute|update|delete|merge|truncate|lock|commit|rollback|savepoint|vacuum|comment|import|load|prepare)\b/gi;

// M-6e's grammar of the item 3 write texts (Codex, review of ba1a0bd, R-R2).
// Each statement, with its comments removed and the whitespace of its code
// collapsed (strings are kept exactly), must be one of these forms. The
// schema is exactly stage0_item3, never a prefix; an unquoted identifier is
// the only kind there is, so a quoted identifier, an E-string or a dollar
// body (but the guard's own) is outside the grammar.
const RAISE = "then raise exception '[^']*' using errcode = 'P0001'; end if;";
const GUARD_STORE = `if not exists \\(select 1 from public\\.stores s where s\\.id = '5ee41000-0000-4000-8000-0000000000a1'\\) ${RAISE}`;
const GUARD_LEDGER = `if exists \\(select 1 from supabase_migrations\\.schema_migrations m where m\\.version = '20260909232836' and m\\.name = 'phase_e_03_order_margin_snapshot' and md5\\(m\\.statements\\[1\\]\\) = 'b7a8e54c99432c5e0ddb60be4c46505f'\\) ${RAISE}`;
const GUARD_ABSENT = `if to_regnamespace\\('stage0_item3'\\) is not null ${RAISE}`;
const I3_GUARDS = {
  "guard-setup": new RegExp(`^begin ${GUARD_STORE} ${GUARD_LEDGER} ${GUARD_ABSENT} end$`),
  "guard-cleanup": new RegExp(`^begin ${GUARD_STORE} ${GUARD_LEDGER} end$`),
};
const I3_FORMS = {
  "create-schema": /^create schema stage0_item3$/,
  "create-fixture-table": /^create table stage0_item3\.(owned|open) \( id int primary key, label text not null, login_role text not null default current_user, session_role text not null default session_user, tx_read_only text not null default current_setting\('transaction_read_only'\), written_at timestamptz not null default clock_timestamp\(\) \)$/,
  "revoke-schema": /^revoke all on schema stage0_item3 from public, anon, authenticated, service_role$/,
  "grant-schema": /^grant usage, create on schema stage0_item3 to public$/,
  "revoke-table": /^revoke all on table stage0_item3\.(owned|open) from public, anon, authenticated, service_role$/,
  "grant-table": /^grant select, insert on table stage0_item3\.open to public$/,
  "select-ready": /^select 'stage0_item3 ready' as setup$/,
  "insert": /^insert into stage0_item3\.(owned|open) \(id, label\) values \([0-9]+, 'I3-[A-Z0-9-]+'\) returning id, label$/,
  "create-probe-table": /^create table stage0_item3\.(ddl_w|ddl_r) \(id int\)$/,
  "created": /^select to_regclass\('stage0_item3\.(ddl_w|ddl_r)'\) is not null as created$/,
  "drop-schema": /^drop schema stage0_item3 cascade$/,
  "gone": /^select to_regnamespace\('stage0_item3'\) is null as gone$/,
};
/** Each write text's exact sequence of forms, by its name. */
const I3_SEQUENCES = [
  [/^I3-SETUP$/, ["guard-setup", "create-schema", "create-fixture-table", "create-fixture-table", "revoke-schema", "grant-schema", "revoke-table", "revoke-table", "grant-table", "select-ready"]],
  [/^I3-CLEANUP$/, ["guard-cleanup", "drop-schema", "gone"]],
  [/^I3-INS-/, ["insert"]],
  [/^I3-DDL-/, ["create-probe-table", "created"]],
];

/**
 * The statements of `text` for the grammar: split at each semicolon in code,
 * comments as one space, code whitespace collapsed, every other segment kept
 * exactly. `body` is a lone dollar body's text (a DO block's), else null.
 */
function i3Statements(text, label) {
  const stmts = [];
  let cur = [];
  const end = () => {
    const norm = cur.map((p) => p.text).join("").replace(/ +/g, " ").trim();
    const parts = cur.filter((p) => p.kind !== "space" && (p.kind !== "code" || p.text.trim()));
    if (norm) stmts.push({ norm, body: parts.length === 2 && /^do$/i.test(parts[0].text.trim()) && parts[1].kind === "dollar" ? parts[1].body : null });
    cur = [];
  };
  for (const s of lexSql(text, { label })) {
    const raw = text.slice(s.start, s.end);
    if (s.kind === "code") {
      const pieces = raw.split(";");
      pieces.forEach((piece, i) => { if (i) end(); cur.push({ kind: "code", text: piece.replace(/\s+/g, " ") }); });
    } else if (s.kind === "line-comment" || s.kind === "block-comment") cur.push({ kind: "space", text: " " });
    else cur.push({ kind: s.kind, text: raw, body: s.kind === "dollar" ? text.slice(s.bodyStart, s.bodyEnd) : null });
  }
  end();
  return stmts;
}

/** The form a write statement is, or null: a guard only as a DO block whose whole body is that guard. */
function i3FormOf(stmt, label) {
  if (stmt.body !== null) {
    let body;
    try {
      body = lexSql(stmt.body, { label }).map((s) => {
        const raw = stmt.body.slice(s.start, s.end);
        if (s.kind === "code") return raw.replace(/\s+/g, " ");
        if (s.kind === "line-comment" || s.kind === "block-comment") return " ";
        return s.kind === "string" ? raw : " [not in the guard's grammar] ";
      }).join("").replace(/ +/g, " ").trim();
    } catch { return null; }
    return Object.keys(I3_GUARDS).find((k) => I3_GUARDS[k].test(body)) || null;
  }
  return Object.keys(I3_FORMS).find((k) => I3_FORMS[k].test(stmt.norm)) || null;
}

/**
 * M-6e: an item 3 text, read with its strings KEPT and every E-string
 * decoded (Codex, item 3 plan review I3-1 to I3-3, and review of ba1a0bd,
 * R-R2):
 *   - it is marked STAGING ONLY, and holds no quoted identifier;
 *   - a "read" text holds no dollar-quoted body and no E-string, and, read
 *     with its strings blanked (its privilege names are strings), no write
 *     word (INTO included: SELECT INTO creates a table) and no call but
 *     I3_READ_CALLS;
 *   - a "write" text is, statement by statement, exactly its family's
 *     sequence of I3_FORMS (I3_SEQUENCES): the schema is exactly
 *     stage0_item3, every target and every call is spelled out, and any
 *     other statement, the DO guard included, is a finding. It also holds
 *     none of the other write words;
 *   - a probe (I3-INS-*, I3-DDL-*) has no DO block and no RAISE: nothing
 *     runs ahead of its statement;
 *   - SETUP and CLEANUP carry the staging guard.
 * A write assembled at run time is not seen: the md5 pin and review are the
 * control for that. The grammar is a regression check of these fixed texts,
 * not a SQL sandbox.
 */
export function item3Problems(text, name, effect) {
  const r = sqlView(text, name, "keep");
  if (r.problem) return [r.problem];
  if (!/\S/.test(r.view)) return [`${name} is empty`];
  let decoded;
  try { decoded = eStringsDecoded(r.view, name); } catch (e) { return [`${name} does not lex: ${e.message}`]; }
  const out = [];
  if (!/STAGING ONLY/.test(text)) out.push(`${name} is not marked STAGING ONLY`);
  if (/\bu&\s*['"]/i.test(decoded)) out.push(`${name} holds a U& literal or identifier, whose escapes M-6e does not decode`);
  const quoted = lexSql(text, { label: name }).filter((s) => s.kind === "quoted-ident").map((s) => text.slice(s.start, s.end));
  if (quoted.length) out.push(`${name} holds the quoted identifier${quoted.length > 1 ? "s" : ""} ${[...new Set(quoted)].join(", ")}, outside M-6e's grammar`);
  const words = (re) => [...new Set([...decoded.matchAll(re)].map((m) => m[0].toLowerCase()))];
  if (effect === "read") {
    if (lexSql(text, { label: name }).some((s) => s.kind === "dollar" || s.kind === "e-string")) out.push(`${name} is declared read but holds a dollar-quoted body or an E-string`);
    const b = sqlView(text, name, "blank");
    if (b.problem) return [...out, b.problem];
    const inView = (re) => [...new Set([...b.view.matchAll(re)].map((m) => m[0].toLowerCase()))];
    const calls = [...new Set([...b.view.matchAll(/\b([a-z_][a-z0-9_$]*)\s*\(/gi)].map((m) => m[1].toLowerCase()))].filter((f) => !I3_READ_CALLS.includes(f));
    const found = [...inView(I3_READ_WORDS), ...calls];
    if (found.length) out.push(`${name} is declared read but holds ${found.join(", ")}`);
  } else if (effect === "write") {
    const family = I3_SEQUENCES.find(([re]) => re.test(name));
    let stmts;
    try { stmts = i3Statements(text, name); } catch (e) { return [...out, `${name} does not lex: ${e.message}`]; }
    const forms = stmts.map((s) => i3FormOf(s, name));
    stmts.forEach((s, i) => { if (!forms[i]) out.push(`${name} statement ${i + 1} is not a form M-6e admits: ${s.norm.slice(0, 120)}`); });
    if (!family) out.push(`${name} has no write grammar`);
    else if (JSON.stringify(forms) !== JSON.stringify(family[1])) out.push(`${name}'s statements are [${forms.map((f) => f || "?").join(", ")}]; its grammar is [${family[1].join(", ")}]`);
    const other = words(I3_WRITE_FORBIDDEN);
    if (other.length) out.push(`${name} holds ${other.join(", ")}`);
  } else out.push(`${name} has no declared effect`);
  if (/^I3-(INS|DDL)-/.test(name) && /\bdo\s*\$|\braise\b/i.test(decoded)) out.push(`${name} runs something ahead of its probe statement`);
  if (["I3-SETUP", "I3-CLEANUP"].includes(name) && !(text.includes("the staging seed store is absent") && text.includes("the production ledger marker is present"))) out.push(`${name} lacks the staging guard`);
  return out;
}

/** M-6c: the DDL/DML targets of a LOCKPROBE text outside its own stage0_lockprobe schema. */
export function lockprobeOutside(text, label) {
  const r = sqlView(text, label, "keep");
  if (r.problem) return [r.problem];
  const ddl = [...r.view.matchAll(/\b(create|alter|drop|truncate|insert\s+into|update|delete\s+from|lock\s+table)\s+(?:table\s+|schema\s+|constraint\s+)?([a-z_][a-z0-9_.]*)/gi)]
    .map((x) => x[2].toLowerCase()).filter((t) => !t.startsWith("stage0_lockprobe") && !["if", "exception", "pg_temp"].includes(t));
  return ddl.length ? [`${label} writes outside stage0_lockprobe: ${[...new Set(ddl)].join(", ")}`] : [];
}

/**
 * M-6b: SIZE-PROBE outside its literal is one read-only statement. The only
 * data body is the one dollar quote that starts exactly where the reviewed
 * head ends its opening $probe$ and is closed at once by the tail; that role
 * comes from this position, not from the tag. Any other dollar body is read
 * as code, so nothing can hide in one.
 */
export function sizeProbeOutsideProblems(head, tail) {
  const junction = head.length - "$probe$".length;
  let data = 0;
  const role = (s, { depth }) => {
    if (depth === 0 && s.start === junction && s.tag === "probe" && s.bodyStart === s.bodyEnd) { data++; return "data"; }
    return "code";
  };
  const r = sqlView(head + tail, "SIZE-PROBE (outside its literal)", "blank", role);
  if (r.problem) return [r.problem];
  const out = [];
  if (data !== 1) out.push("SIZE-PROBE's head and tail do not meet at its $probe$ literal");
  if ((r.view.match(/;/g) || []).length !== 1 || [...r.view.matchAll(SIZE_PROBE_WRITE_WORDS)].length) out.push("SIZE-PROBE is not one read-only statement");
  return out;
}

/** Every pinned file with the path the recorded state puts it at. */
export function pinnedFiles(M) {
  const files = [];
  for (const m of M.migrations) files.push({ label: m.name, entry: m, path: forwardPath(m), frozenPath: m.pendingPath });
  for (const r of M.rollbacks) {
    const m = M.migrations.find((x) => x.n === r.n);
    files.push({ label: `${m.name}.rollback.sql`, entry: r, path: companionPath(m, r), frozenPath: r.pendingPath });
  }
  for (const rec of M.rollbackRecords) {
    const m = M.migrations.find((x) => x.n === rec.n);
    const r = M.rollbacks.find((x) => x.n === rec.n);
    files.push({ label: `applied rollback ${m.name} @${rec.version}`, entry: { ...r, pinnedAt: null }, path: recordPath(m, rec), frozenPath: null });
  }
  files.push({ label: "proofs", entry: M.proofs, path: M.proofs.path, frozenPath: M.proofs.path });
  files.push({ label: "assembler", entry: M.assembler, path: M.assembler.path, frozenPath: M.assembler.path });
  if (M.sender) files.push({ label: "sender", entry: M.sender, path: M.sender.path, frozenPath: M.sender.path });
  const named = new Set(files.map((f) => f.path));
  for (const f of (M.guard && Array.isArray(M.guard.files) ? M.guard.files : [])) {
    if (!named.has(f.path)) files.push({ label: `guard chain ${f.path}`, entry: f, path: f.path, frozenPath: f.path });
  }
  return files;
}

export function checkManifest(repo, M) {
  const g = gitIn(repo);
  const P = { "M-0": [], "M-1": [], "M-2": [], "M-3": [], "M-4": [], "M-5": [], "M-6": [], "M-6b": [], "M-7": [], "M-7b": [], "M-8": [], "M-10": [], "M-12": [], "M-13": [] };
  const say = (k, s) => P[k].push(s);
  if (g.tryTxt("rev-parse", "--is-inside-work-tree") !== "true") { say("M-0", `${repo} is not a git checkout`); return P; }
  const manifestCommit = g.lastChange(MANIFEST_PATH);
  if (!manifestCommit) say("M-0", `${MANIFEST_PATH} has no commit`);
  const resolve = (pin) => (pin === "manifest-commit" ? manifestCommit : pin);
  const files = pinnedFiles(M);

  // M-1 the blob at the state's path, at HEAD: id, md5, bytes, no CR.
  for (const f of files) {
    const id = g.objAt("HEAD", f.path);
    if (id !== f.entry.blob) { say("M-1", `${f.label}: HEAD:${f.path} is ${id ?? "absent"}, pinned ${f.entry.blob}`); continue; }
    const b = g.blob(id);
    if (md5(b) !== f.entry.md5) say("M-1", `${f.label}: md5 ${md5(b)} != ${f.entry.md5}`);
    if (b.length !== f.entry.bytes) say("M-1", `${f.label}: ${b.length} bytes != ${f.entry.bytes}`);
    if (b.includes(0x0d)) say("M-1", `${f.label}: the blob holds a CR`);
  }

  // M-2 no uncommitted edit (line endings aside).
  for (const f of files) {
    const p = join(repo, f.path);
    if (!existsSync(p)) { say("M-2", `${f.label}: ${f.path} is missing from the working tree`); continue; }
    const wt = Buffer.from(readFileSync(p).toString("utf8").replace(/\r\n/g, "\n"), "utf8");
    if (md5(wt) !== f.entry.md5) say("M-2", `${f.label}: the working tree differs from the pinned bytes beyond line endings`);
  }

  // M-3 each pin resolves: a SHA holds the blob at its frozen path; "manifest-commit"
  // (a file changed in the same commit as the manifest, which cannot name its
  // own SHA) resolves to the commit that last changed the manifest, which must
  // hold the blob at the state's path. A record-only manifest update keeps
  // that true, because it changes the manifest and not the file.
  for (const f of files) {
    const pin = f.entry.pinnedAt;
    if (pin === null) continue; // an applied rollback record: its bytes are the companion's (M-1)
    if (pin !== "manifest-commit" && !/^[0-9a-f]{40}$/.test(pin)) { say("M-3", `${f.label}: pinnedAt ${JSON.stringify(pin)} is neither a full SHA nor "manifest-commit"`); continue; }
    const commit = resolve(pin);
    const at = pin === "manifest-commit" ? f.path : f.frozenPath;
    if (!g.hasCommit(commit)) { if (!g.shallow()) say("M-3", `${f.label}: commit ${commit} is missing and the clone is not shallow`); continue; }
    const id = g.objAt(commit, at);
    if (id !== f.entry.blob) say("M-3", `${f.label}: ${commit.slice(0, 7)}:${at} is ${id ?? "absent"}, pinned ${f.entry.blob}`);
  }

  // M-4 md5(prosrc) re-derived from the committed forward and rollback bodies, by blob.
  const BODY = /create\s+(?:or\s+replace\s+)?function\s+public\.(\w+)\s*\([\s\S]*?\bas\s+\$fn\$([\s\S]*?)\$fn\$/gi;
  for (const { file, functions } of M.bodies) {
    const rb = file.endsWith("rb");
    const e = (rb ? M.rollbacks : M.migrations).find((x) => x.n === file.slice(0, 2));
    let text;
    try { text = g.blob(e.blob).toString("utf8"); } catch { say("M-4", `${file}: blob ${e.blob} unreadable`); continue; }
    const got = {};
    for (const m of text.matchAll(BODY)) got[m[1]] = createHash("md5").update(m[2], "utf8").digest("hex");
    if (JSON.stringify(Object.entries(got).sort()) !== JSON.stringify(Object.entries(functions).sort())) say("M-4", `${file}: bodies ${JSON.stringify(got)} != ${JSON.stringify(functions)}`);
  }
  const produced = new Set(M.bodies.flatMap((b) => Object.values(b.functions)));
  for (const [k, f] of Object.entries(M.functions)) if (!produced.has(f.prosrcMd5)) say("M-4", `${k}: ${f.prosrcMd5} is derived from no committed body`);

  // M-5 the assembler's constants are the manifest's.
  const same = (a, b, what) => { if (JSON.stringify(a) !== JSON.stringify(b)) say("M-5", `${what} differ`); };
  same(A.MIGRATIONS.map((x) => [x.n, x.name, x.md5, x.bytes]), M.migrations.map((x) => [x.n, x.name, x.md5, x.bytes]), "migrations");
  same(Object.fromEntries(Object.entries(A.FUNCTIONS).map(([k, [s, h, acl]]) => [k, { signature: s, prosrcMd5: h, execute: acl.split(",") }])), M.functions, "functions");
  same(A.STATE_AFTER, M.stateAfter, "stateAfter");
  same(A.TABLES, M.tables.names, "tables");
  same(A.ROLLBACK_OPS, M.rollbackOperations, "rollbackOperations");
  same([A.PRODUCTION_REF, A.STAGING_SEED_STORE, A.PROBE_SLUG], [M.productionRef, M.identity.stagingSeedStore, M.identity.probeSlug], "identity markers");
  for (const m of M.migrations) if (m.pendingPath !== A.migrationPath(m)) say("M-5", `${m.name}: frozen path ${m.pendingPath}`);
  same([A.LEDGER_COLUMNS, A.LEDGER_CREATED_BY], [M.ledgerRow?.columns, M.ledgerRow?.createdBy], "the ledger row shape (N6)");

  // M-12 the send policy (review of 07574c1, decision A): pinned texts reach a
  // database only through scripts/manual/stage0-send.mjs, which sends a text
  // only where this policy allows. Every assembled output has exactly one
  // entry; the policy's shape is fixed here, so widening it is a test failure.
  const SP = M.send || {};
  if (!M.sender || M.sender.path !== S.SENDER_PATH) say("M-12", "the manifest does not pin the sender at " + S.SENDER_PATH);
  if (SP.endpoint !== S.API_BASE + S.ENDPOINT || SP.endpoint !== "https://api.supabase.com/v1/projects/{ref}/database/query") say("M-12", "the endpoint is not the Management API database/query endpoint the sender posts to");
  if (JSON.stringify(SP.targets) !== JSON.stringify({ production: A.PRODUCTION_REF, staging: A.STAGING_REF })) say("M-12", "the targets are not exactly production and staging, by ref");
  const texts = SP.texts || {};
  const outs = Object.keys(M.outputs || {});
  for (const k of outs) if (!texts[k]) say("M-12", `${k} has no send-policy entry`);
  for (const k of Object.keys(texts)) if (!outs.includes(k)) say("M-12", `the send policy names ${k}, which is not an output`);
  const READ_ONLY = ["P0", "STATE", "SIZE-PROBE", ...ENVELOPE_PROBES, ...Object.keys(I3_POLICY).filter((k) => I3_POLICY[k].readOnly)];
  for (const [k, e] of Object.entries(texts)) {
    const want = k.startsWith("LOCKPROBE-") || ENVELOPE_PROBES.includes(k) || Object.hasOwn(I3_POLICY, k) ? ["staging"] : k === "SIZE-PROBE" ? null : ["production"];
    // The effect (Codex, item 3 plan review I3-1): declared by every text but
    // the ones before item 3; for an item 3 text, exactly its declared effect.
    if (LEGACY_EFFECT_TEXTS.includes(k)) { if (Object.hasOwn(e, "effect")) say("M-12", `${k}: a text before item 3 keeps its read_only-derived effect; it declares none`); }
    else if (e.effect !== "read" && e.effect !== "write") say("M-12", `${k}: effect must be "read" or "write"; the policy says ${JSON.stringify(e.effect)}`);
    // The runtime side (Codex, review of ba1a0bd, R-R1): the classifier keeps
    // the read_only-derived effect only for a text in its LEGACY_EFFECT table
    // with exactly the pin and policy listed there.
    if (Object.hasOwn(C.LEGACY_EFFECT, k) && !Object.hasOwn(e, "effect") && (M.outputs[k]?.md5 !== C.LEGACY_EFFECT[k][0] || canonicalJson(e) !== canonicalJson(C.LEGACY_EFFECT[k][1]))) {
      say("M-12", `${k}: its pin or policy is not the one the classifier's LEGACY_EFFECT lists; declare its effect, or review the change`);
    }
    else if (Object.hasOwn(I3_POLICY, k) && e.effect !== I3_POLICY[k].effect) say("M-12", `${k}: effect must be ${I3_POLICY[k].effect}`);
    if (want && JSON.stringify(e.targets) !== JSON.stringify(want)) say("M-12", `${k} must go to ${want.join(", ")} only; the policy says ${JSON.stringify(e.targets)}`);
    if (k === "SIZE-PROBE" && (!Array.isArray(e.targets) || !e.targets.includes("staging") || e.targets.some((t) => !["staging", "production"].includes(t)))) say("M-12", "SIZE-PROBE must include staging and name no other target than production");
    if ((e.readOnly === true) !== READ_ONLY.includes(k)) say("M-12", `${k}: readOnly must be ${READ_ONLY.includes(k)}`);
    if ((e.instantiate === "cancel") !== (k === "CANCEL-STEP-TEMPLATE") || (e.instantiate !== undefined && e.instantiate !== "cancel")) say("M-12", `${k}: only CANCEL-STEP-TEMPLATE is instantiated, and only by --cancel`);
    if (e.window !== windowFor(k)) say("M-12", `${k}: window must be ${windowFor(k)} (Codex item 6, Q2); the policy says ${JSON.stringify(e.window)}`);
    const extra = Object.keys(e).filter((x) => !["targets", "readOnly", "instantiate", "window", "effect"].includes(x));
    if (extra.length) say("M-12", `${k}: unknown policy fields ${extra.join(", ")}`);
  }
  if (JSON.stringify(Object.keys(C.LEGACY_EFFECT).sort()) !== JSON.stringify([...LEGACY_EFFECT_TEXTS].sort())) say("M-12", "the classifier's LEGACY_EFFECT does not name exactly the texts before item 3");

  // M-13 the guard chain (Codex item 6, SG-6): the manifest pins exactly the
  // repository files the three guarded entry points load, transitively, as
  // acorn reads them at HEAD; they load nothing but those files and the
  // allowed node: modules; the parser-free audit the tools run before any
  // go or request (stage0-guard.mjs importAudit) finds exactly acorn's
  // specifiers in every pinned file; and the sender and assembler pins are
  // the chain's.
  const GC = M.guard;
  if (!GC || JSON.stringify(GC.entries) !== JSON.stringify(G.CHAIN_ENTRIES)) say("M-13", "guard.entries is not stage0-guard.mjs's CHAIN_ENTRIES");
  else {
    const pinned = Array.isArray(GC.files) ? GC.files.map((f) => f && f.path) : [];
    if (!pinned.length || JSON.stringify(pinned) !== JSON.stringify([...pinned].sort()) || new Set(pinned).size !== pinned.length) say("M-13", "guard.files is not a sorted list of distinct paths");
    const closure = new Set();
    for (const e of GC.entries) {
      const c = localImportClosure(g, e);
      for (const u of c.unbound) say("M-13", u);
      for (const x of c.external) if (!G.BUILTINS.includes(x)) say("M-13", `${e} loads ${x}, which is not an allowed node: module`);
      for (const p of c.modules) closure.add(p);
      for (const [p, specs] of Object.entries(c.specsOf)) {
        const a = G.importAudit(g.tryTxt("show", `HEAD:${p}`) ?? "", p);
        for (const x of a.problems) say("M-13", x);
        if (JSON.stringify([...new Set(a.specs)].sort()) !== JSON.stringify(specs)) say("M-13", `${p}: the audit's specifiers ${JSON.stringify(a.specs)} are not acorn's ${JSON.stringify(specs)}`);
      }
    }
    for (const p of closure) if (!pinned.includes(p)) say("M-13", `${p} is loaded by the guard chain but not pinned in guard.files`);
    for (const p of pinned) if (!closure.has(p)) say("M-13", `${p} is pinned in guard.files but no entry loads it`);
    for (const [label, pin] of [["sender", M.sender], ["assembler", M.assembler]]) {
      const f = (GC.files || []).find((x) => x && pin && x.path === pin.path);
      if (!f || f.blob !== pin.blob) say("M-13", `the ${label} pin is not its guard-chain pin`);
    }
  }

  // M-6 every output re-assembled from the frozen inputs has its pinned md5.
  let out = null;
  try { out = A.assembleAll(M, { cwd: repo }); } catch (e) { say("M-6", `assembly failed: ${e.message}`); }
  if (out) {
    const keys = Object.keys(out).sort();
    if (JSON.stringify(keys) !== JSON.stringify(Object.keys(M.outputs).sort())) say("M-6", `outputs ${keys} != pinned ${Object.keys(M.outputs).sort()}`);
    for (const [k, v] of Object.entries(out)) {
      if (!M.outputs[k]) continue;
      if (A.md5(v) !== M.outputs[k].md5) say("M-6", `${k}: md5 ${A.md5(v)} != ${M.outputs[k].md5}`);
      if (Buffer.byteLength(v) !== M.outputs[k].bytes) say("M-6", `${k}: bytes`);
    }
    // The P2 steps (N7: 03 and 04 are ONE step, P2-0304). Each embeds every
    // file of its step verbatim, gates each on md5/bytes before any EXECUTE,
    // and writes one ledger row per file from the checked literal.
    if (JSON.stringify(A.P2_STEPS.map((x) => x.step)) !== JSON.stringify(["P2-01", "P2-02", "P2-0304", "P2-05"])) say("M-6", "the P2 steps are not P2-01, P2-02, P2-0304, P2-05");
    for (const k of ["P2-03", "P2-04"]) if (out[k] !== undefined) say("M-6", `${k} exists: 03 must never be applied on its own (N7)`);
    for (const stp of A.P2_STEPS) {
      const w = out[stp.step] || "";
      const multi = stp.files.length > 1;
      stp.files.forEach((n, i) => {
        const m = M.migrations.find((x) => x.n === n);
        const v = multi ? `f${i + 1}` : "f";
        if (!w.includes(`$stage0_file$${g.blob(m.blob).toString("utf8")}$stage0_file$`)) say("M-6", `${stp.step} does not embed ${m.name}'s pinned blob verbatim`);
        if (!w.includes(`if md5(${v}) <> '${m.md5}' or octet_length(${v}) <> ${m.bytes} then`)) say("M-6", `${stp.step} lacks ${m.name}'s md5/bytes gate before EXECUTE`);
        if (!w.includes(`values (v_version, '${m.name}', array[${v}], '${M.ledgerRow.createdBy}');`)) say("M-6", `${stp.step} does not write ${m.name}'s statements[1] from the checked literal with apply_migration's created_by`);
      });
      if (multi) {
        const gates = stp.files.map((_, i) => w.indexOf(`if md5(f${i + 1}) <>`));
        const firstExec = w.indexOf("execute f1;");
        if (gates.some((x) => x < 0 || x > firstExec)) say("M-6", `${stp.step} does not check every file before executing any`);
        if (!(w.indexOf("execute f1;") < w.indexOf("execute f2;"))) say("M-6", `${stp.step} does not execute 03 before 04`);
      }
      if (!w.includes("the ledger row does not have apply_migration''s shape")) say("M-6", `${stp.step} does not assert its ledger rows' shape`);
    }
    // STATE is read-only and names exactly the reviewed recovery sequences.
    // The SQL checks below read sql-lexer.mjs's views, never a regex-stripped
    // text (comment-stripping plan §3.5); each is a pure predicate exported
    // below, and a text that does not lex is reported, never passed.
    for (const p of readOnlyViolations(out.STATE || "", "STATE", STATE_WRITE_WORDS)) say("M-6", p);
    const stt = sqlView(out.STATE || "", "STATE", "keep");
    if (stt.problem) say("M-6", stt.problem);
    else for (const r of A.RECOVERY) if (r.ops.length && !stt.view.includes(`'${r.ops.join(", ")}'`)) say("M-6", `STATE does not name the recovery ${r.ops.join(", ")}`);
    // The second-caller cancel procedure (plan §E8): INSPECT only reads; the
    // STEP template cancels (never terminates) ONE backend matched by exact
    // application_name AND backend_start, never the caller, refusing 0 or >1
    // matches before it signals.
    for (const p of readOnlyViolations(out["CANCEL-INSPECT"] || "", "CANCEL-INSPECT", INSPECT_WRITE_WORDS)) say("M-6", p);
    for (const p of cancelStepProblems(out["CANCEL-STEP-TEMPLATE"] || "")) say("M-6", p);
    const stepNames = ["P1", ...A.P2_STEPS.map((x) => x.step), ...A.ROLLBACK_OPS.map((x) => x.op)];
    for (const n of stepNames) if (!(out[n] || "").includes(`set_config('application_name', 'release2-stage0-${n}', true)`)) say("M-6", `${n} does not run under the application_name CANCEL-STEP targets`);
    if (!/^begin isolation level repeatable read;$/m.test(out.P1 || "") || !/\nrollback;\n$/.test(out.P1 || "") || /^commit;$/m.test(out.P1 || "")) say("M-6", "P1 must begin repeatable read, end in ROLLBACK and never commit");
    // M-6c the staging lock rehearsal (N5) cannot touch anything but its own schema.
    const lp = Object.entries(out).filter(([k]) => k.startsWith("LOCKPROBE-"));
    if (lp.length !== 10) say("M-6", `expected 10 LOCKPROBE texts, found ${lp.length}`);
    for (const [k, v] of lp) {
      if (!/STAGING ONLY/.test(v)) say("M-6", `${k} is not marked STAGING ONLY`);
      for (const p of lockprobeOutside(v, k)) say("M-6", p);
      if (/^B-/.test(k.slice(10)) && !v.includes("the staging seed store is absent")) say("M-6", `${k} lacks the staging-only guard`);
      if (/'b7a8e54c99432c5e0ddb60be4c46505f'\) then\s+raise exception '[^']*production's ledger rows/.test(v)) say("M-6", `${k} carries the production identity guard`);
    }
    // M-6d the item 2 envelope probes: exactly the five, marked STAGING ONLY
    // (M-12 sends them to staging only, read_only), with no write word even
    // inside a string.
    const ep = Object.keys(out).filter((k) => k.startsWith("ENVELOPE-PROBE-")).sort();
    if (JSON.stringify(ep) !== JSON.stringify(ENVELOPE_PROBES)) say("M-6", `the envelope probes are ${ep.join(", ") || "none"}, not ${ENVELOPE_PROBES.join(", ")}`);
    for (const k of ep) {
      if (!/STAGING ONLY/.test(out[k])) say("M-6", `${k} is not marked STAGING ONLY`);
      for (const p of probeWriteViolations(out[k], k)) say("M-6", p);
    }
    // M-6e item 3 (Codex, item 3 plan review I3-1 to I3-3): exactly its texts,
    // each confined to stage0_item3 as its declared effect allows.
    const i3 = Object.keys(out).filter((k) => k.startsWith("I3-")).sort();
    if (JSON.stringify(i3) !== JSON.stringify(Object.keys(I3_POLICY).sort())) say("M-6", `the item 3 texts are ${i3.join(", ") || "none"}, not ${Object.keys(I3_POLICY).sort().join(", ")}`);
    for (const k of i3) for (const p of item3Problems(out[k], k, Object.hasOwn(I3_POLICY, k) ? I3_POLICY[k].effect : null)) say("M-6", p);
    // M-6b SIZE-PROBE: one read-only SELECT, larger than P1, with its pinned answer.
    const probe = out["SIZE-PROBE"] || "";
    if (!(Buffer.byteLength(probe) > Buffer.byteLength(out.P1)) || Buffer.byteLength(probe) - Buffer.byteLength(out.P1) !== M.sizeProbe.exceedsP1By) say("M-6b", "SIZE-PROBE size");
    if (!probe.startsWith(A.SIZE_PROBE_HEAD) || !probe.endsWith(A.SIZE_PROBE_TAIL)) say("M-6b", "SIZE-PROBE shape");
    else {
      const literal = probe.slice(A.SIZE_PROBE_HEAD.length, probe.length - A.SIZE_PROBE_TAIL.length);
      if (!A.SIZE_PROBE_LINE.repeat(Math.ceil(literal.length / A.SIZE_PROBE_LINE.length)).startsWith(literal) || literal.includes("$probe$")) say("M-6b", "SIZE-PROBE literal is not filler only");
      for (const p of sizeProbeOutsideProblems(A.SIZE_PROBE_HEAD, A.SIZE_PROBE_TAIL)) say("M-6b", p);
      if (JSON.stringify({ probe_bytes: Buffer.byteLength(literal), probe_md5: A.md5(literal) }) !== JSON.stringify(M.sizeProbe.expect)) say("M-6b", "SIZE-PROBE expected answer");
    }
  }

  // M-7 A3: the pinned commit (or the manifest's own commit) holds the pinned
  // trees and blobs; so does HEAD while enforced.
  const revs = [resolve(M.a3.commit)];
  if (M.a3.enforceAtHead) revs.push("HEAD");
  for (const rev of revs) {
    if (rev !== "HEAD" && !g.hasCommit(rev)) { if (!g.shallow()) say("M-7", `A3 commit ${rev} is missing and the clone is not shallow`); continue; }
    for (const [p, id] of [...Object.entries(M.a3.trees), ...Object.entries(M.a3.blobs)]) {
      const got = g.objAt(rev, p);
      if (got !== id) say("M-7", `A3 drift at ${rev === "HEAD" ? "HEAD" : rev.slice(0, 7)}: ${p} is ${got}, pinned ${id} — re-pin in the manifest (a reviewed change) or revert`);
    }
  }
  // M-7b the build-input binding: every script the build command runs is pinned,
  // and the tracked .env holds exactly the two public values.
  const toml = g.tryTxt("show", "HEAD:netlify.toml") || "";
  const cmd = (/^\s*command\s*=\s*"([^"]*)"/m.exec(toml) || [])[1] || "";
  const ran = [...cmd.matchAll(/node\s+(\S+\.m?js)/g)].map((x) => x[1]);
  if (!ran.length) say("M-7b", "no build command scripts found in netlify.toml");
  for (const s of ran) if (!(s in M.a3.blobs)) say("M-7b", `the build runs ${s}, which A3 does not pin`);
  for (const p of ["netlify.toml", "package.json", ".npmrc", ".nvmrc", ".env", "vite.config.js", "postcss.config.js", "tailwind.config.js", "index.html", "upload.html"]) {
    if (!(p in M.a3.blobs)) say("M-7b", `build input ${p} is not pinned`);
  }
  for (const t of ["netlify", "src", "public"]) if (!(t in M.a3.trees)) say("M-7b", `tree ${t} is not pinned`);
  // The inventory is a build input (Netlify runs `yarn test`, and the
  // inventory gates src/). inventory-check.mjs and every LOCAL module it
  // imports, transitively, read from HEAD, must be pinned in A3, so an
  // unreviewed edit to any of them is A3 drift under M-7 (Codex's review of
  // 799cc2e, item 3).
  const closure = localImportClosure(g, INVENTORY);
  for (const p of closure.modules) if (!(p in M.a3.blobs)) say("M-7b", `the inventory's ${p} is a build input that A3 does not pin`);
  for (const u of closure.unbound) say("M-7b", `the inventory's imports cannot be bound: ${u}`);
  const env = (g.tryTxt("show", "HEAD:.env") || "").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  const keys = env.map((l) => l.split("=")[0]);
  if (JSON.stringify(keys) !== JSON.stringify(["VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY"])) say("M-7b", `.env keys ${JSON.stringify(keys)}: only VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY may be tracked`);
  const val = (k) => (env.find((l) => l.startsWith(k + "=")) || "").slice(k.length + 1);
  if (val("VITE_SUPABASE_URL") !== `https://${M.productionRef}.supabase.co`) say("M-7b", ".env URL is not the production project");
  if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(val("VITE_SUPABASE_ANON_KEY"))) say("M-7b", ".env key is not a publishable key");

  // M-10 fresh-build rollback targets (review of d01b74a, N4): every approved
  // target carries the queue fix (the orderQueue.js blob 9937728 shipped), so a
  // recovery never reinstates the drain that lost orders queued during its
  // awaits. Commits that predate the fix stay retained URLs only.
  const RT = M.rollbackTargets;
  if (!RT || !RT.requiredBlob || !Array.isArray(RT.approved) || !RT.approved.length) {
    P["M-10"] = ["the manifest has no rollbackTargets with a requiredBlob and an approved list"];
  } else {
    const k = "M-10";
    P[k] = [];
    const req = RT.requiredBlob;
    for (const t of RT.approved) {
      const commit = t.commit === "a3" ? resolve(M.a3.commit) : t.commit;
      if (!g.hasCommit(commit)) { if (!g.shallow()) P[k].push(`approved target ${t.commit} is missing and the clone is not shallow`); continue; }
      const got = g.objAt(commit, req.path);
      if (got !== req.blob) P[k].push(`approved target ${t.commit} (${t.role}) has ${req.path} ${got}, not the fixed ${req.blob}`);
    }
    for (const r of RT.retainedNotRebuildable || []) {
      if (RT.approved.some((t) => t.commit === r.commit)) P[k].push(`${r.commit} is both approved and retained-only`);
      if (g.hasCommit(r.commit) && g.objAt(r.commit, req.path) === req.blob) P[k].push(`${r.commit} carries the fix; it needs no retained-only listing`);
    }
  }

  // M-8 the repository state the manifest records.
  const L = M.baselineLedger || [];
  if (L.length !== M.ledgerBaseline.rows || L.length !== 20) say("M-8", `baseline ledger has ${L.length} rows; the manifest says ${M.ledgerBaseline.rows}`);
  if (L.length && L[L.length - 1].version !== M.ledgerBaseline.head) say("M-8", "baseline head");
  const mk = L.find((r) => r.version === M.ledgerBaseline.marker.version);
  if (!mk || mk.name !== M.ledgerBaseline.marker.name || mk.md5 !== M.ledgerBaseline.marker.md5) say("M-8", "the production ledger marker is not in the baseline");
  for (const r of L) {
    const p = `${MIG}/${r.version}_${r.name}.sql`;
    if (g.objAt("HEAD", p) !== r.blob) say("M-8", `baseline ${p} is not the pinned blob at HEAD`);
  }
  // forwards apply in order, each after the one before and after the baseline
  let prev = M.ledgerBaseline.head, gap = false;
  for (const m of M.migrations) {
    if (!m.productionVersion) { gap = true; continue; }
    if (gap) say("M-8", `${m.name} is recorded applied after an unapplied predecessor`);
    if (!/^\d{14}$/.test(m.productionVersion) || !(m.productionVersion > prev)) say("M-8", `${m.name}: version ${m.productionVersion} is not after ${prev}`);
    prev = m.productionVersion;
  }
  // N7: 03 and 04 are one transaction — recorded applied together, rolled back together.
  const pv = (n) => M.migrations.find((x) => x.n === n).productionVersion;
  if (Boolean(pv("03")) !== Boolean(pv("04"))) say("M-8", "03 and 04 are recorded in different states; P2-0304 applies them in one transaction");
  const rec = (n) => M.rollbackRecords.some((r) => r.n === n);
  if (rec("03") !== rec("04")) say("M-8", "03 and 04 have different rollback records; RB-43 rolls them back in one transaction");
  // rollback records follow the RB order over what was applied, each after the last forward
  const applied = M.migrations.filter((m) => m.productionVersion).map((m) => m.n);
  const rbOrder = M.rollbackOperations.flatMap((o) => o.files).filter((n) => applied.includes(n));
  M.rollbackRecords.forEach((rec, i) => {
    if (rec.n !== rbOrder[i]) say("M-8", `rollback record ${i + 1} is ${rec.n}; the RB order over the applied set expects ${rbOrder[i]}`);
    if (!/^\d{14}$/.test(rec.version) || !(rec.version > prev)) say("M-8", `rollback record ${rec.n}: version ${rec.version} is not after ${prev}`);
    prev = rec.version;
  });
  // exactly the migration files this state implies — no more, no fewer. The
  // set compared is the one the Supabase CLI would discover, with no file
  // exempted (supabase-migration-discovery.mjs).
  const eligible = eligibleMigrations(g.lsTop("HEAD", MIG));
  for (const d of duplicateVersions(eligible)) say("M-8", `version ${d.version} is carried by more than one discoverable migration file: ${d.files.join(", ")}`);
  const top = eligible.map((e) => `${MIG}/${e.file}`);
  const expect = new Set([
    ...L.map((r) => `${MIG}/${r.version}_${r.name}.sql`),
    ...M.migrations.filter((m) => m.productionVersion).map((m) => forwardPath(m)),
    ...M.rollbackRecords.map((rec) => recordPath(M.migrations.find((x) => x.n === rec.n), rec)),
  ]);
  for (const p of top) if (!expect.has(p)) say("M-8", `unexpected applied migration file ${p}`);
  for (const p of expect) if (!top.includes(p)) say("M-8", `missing applied migration file ${p}`);
  // every release2 file sits exactly where the state puts it
  const r2 = [...g.lsTree("HEAD", MIG), ...g.lsTree("HEAD", ROLLBACKS_DIR)].filter((p) => /release2_0[1-5]_/.test(p));
  const expectR2 = new Set(files.filter((f) => /release2_0[1-5]_/.test(f.path)).map((f) => f.path));
  for (const p of r2) if (!expectR2.has(p)) say("M-8", `release2 file ${p} is not where the recorded state puts it`);
  for (const p of expectR2) if (!r2.includes(p)) say("M-8", `release2 file ${p} is missing`);
  return P;
}
