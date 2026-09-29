// scripts/tests/inventory-check.mjs — THE inventory: every place the client
// bundle can reach a table, a bucket, an RPC, a realtime channel or a Netlify
// function, found by parsing, not by grepping. Pure: takes a root directory,
// returns { errors, sites }. release2-inventory.test.js runs it on the real
// tree; release2-inventory.mutation.test.js runs it on mutated copies and
// asserts it FAILS — a gate that has never been seen to fail gates nothing.
//
// Design, from docs/security/release-2-data-path-plan.md §0.2 and the review
// of its first version (six additions, marked A1–A6 below):
//
//  - Tables and views come from supabase/tables.json, a committed snapshot of
//    information_schema captured by scripts/manual/tables-snapshot.sql. The
//    scanner does not enumerate tables to look for; it classifies every name
//    the client uses. A name the snapshot does not know is a FAILURE. The
//    snapshot itself is validated (A6): project, role, shape, duplicates, the
//    RECORDED BY HAND placeholder, and its ledger version must equal the
//    newest applied migration file in supabase/migrations/.
//  - Netlify function names come from netlify/functions/*.js PLUS
//    netlify/functions/_retired.json. A retired route keeps a tombstone file
//    and its list entry, so the name never leaves discovery; a client literal
//    naming a retired route is a failure. Retirement also survives BOTH being
//    deleted (A2): the caller passes `retiredEver`, a reviewed list in the
//    test, and every name on it must still have its entry and its tombstone.
//  - The Release 2 tables PROTECTED from src/ are discovered from the
//    migration files in BOTH lifecycle locations (A1): pending/release2_*.sql
//    and the applied <version>_release2_*.sql. Never from tables.json — once
//    stage 0 applies them to production a refreshed snapshot contains them,
//    and a prohibition derived from the snapshot would vanish at exactly the
//    moment it starts mattering. An empty protected set is a failure.
//  - Reach detection is AST-level and follows bindings, failing closed (A5).
//    The client identifier may appear only as the object of an allowed member
//    chain (.from/.rpc/.channel as a callee, .storage.from as a callee,
//    .removeChannel as a callee, .auth inside the gateway) or in a truthiness
//    guard. Aliasing, destructuring, computed access, optional chaining,
//    passing it as a value, a member that is not called, a namespace or
//    dynamic import of the gateway module, a re-export: failure. A file that
//    does not parse is a failure. New files are discovered by walking src/.
//  - Kinds stay distinct (A4): a bucket name in .from(), a table name in
//    storage.from(), .schema() at all, and an RPC not on the approved list
//    are failures.
//  - The first argument of .from/.rpc/.channel must be a string literal, a
//    static template literal, or an identifier bound by a TOP-LEVEL `const`
//    to a string literal in the same file. Nothing wider: `let`, a reassigned
//    binding, an imported binding, an inner const, a parameter, a template
//    with expressions — failure, not unknown. (Accepted deviation from §0.2's
//    "a variable fails": the three bucket constants are this exact shape.)
//  - Route construction (A5): a template literal containing
//    "/.netlify/functions/" with expressions is a route builder. It is a site
//    of kind `route-builder`, so the allowlist decides where one may exist.
//  - Allowances are per occurrence with expected cardinality (A3):
//    compareToAllowlist() fails a second reach in an allowlisted file, a
//    removed allowance with the caller present, and a stale unused allowance.
//
// Review of b294791 (I1–I4, INV-6):
//  - I1 a boolean-only use of the client is a guard; anything that lets the
//    VALUE escape (`supabase || null` stored, returned or exported) fails.
//    `import("@supabase/supabase-js")` is the package import and follows its
//    policy. A route built piecewise ("/.netlify/" + "functions/" + name)
//    fails: the only route construction allowed is a full literal or an
//    allowlisted template dispatcher.
//  - I2 a candidate constant is resolved against the ACTUAL lexical binding
//    at the use site: a parameter, local, catch or destructuring binding of
//    the same name in any enclosing scope shadows it and the use fails.
//  - I3 a tombstone is a parsed form: no imports, exactly the marker and a
//    zero-parameter handler whose whole body returns a literal object with
//    statusCode 410 and no request-dependent branch. A 200 with a "410"
//    comment is not a tombstone.
//  - I4 the snapshot must record capturedAt (a real timestamp), capturedBy,
//    database and the query path.
//  - INV-6 the snapshot's Release 2 table presence is tied to applied
//    migration state: names from APPLIED release2 files must be present,
//    names still only in pending/ must be absent. The browser prohibition on
//    those names is independent of both.
//  - INV-6, rolled-back state (review of 8913a69, B3): presence is the NET of
//    the applied release2 files in version order. A table an applied forward
//    file creates is expected unless a LATER applied file drops it, and a
//    drop counts only when that file's bytes are identical to a committed
//    release2 `.rollback.sql` companion (a reviewed rollback, whose md5 the
//    stage-0 manifest also pins). An unreviewed drop, or a drop of a table no
//    earlier applied file created (a rollback older than its forward, or of
//    a migration whose file was deleted from history), fails. SQL comments
//    are stripped before matching, so a comment that mentions a DROP drops
//    nothing.
//
// Review of ff677d6 (INV-R1..R3):
//  - R1 a route may be written in exactly two forms: the full literal
//    "/.netlify/functions/<name>", or the dispatcher template
//    `/.netlify/functions/${x}` (one expression, nothing after it), which is an
//    allowlisted route-builder site. ANY other string piece or template quasi
//    shaped like a route (".netlify", "netlify/", "/functions/") fails. BOUND,
//    stated: detection is lexical on those three shapes; a route assembled from
//    pieces none of which contains one of them (e.g. "/.net" + "lify" + "/fun" +
//    "ctions/" + name) is not detected.
//    CLOSED at the boundary (review of 8913a69): the lexical check keeps that
//    bound, but it is no longer the gate. Every raw request API (fetch,
//    XMLHttpRequest, navigator.sendBeacon, EventSource, WebSocket, request
//    libraries, remote dynamic import) is a SITE identified by file, enclosing
//    named function, API and first-argument shape, and only allowlisted sites
//    may exist; dispatchers (DISPATCHERS in inventory-allowlist.mjs) may be
//    called only with a statically approved route-name literal or from
//    reviewed internal forwarding, and never referenced as a value.
//    Review of d01b74a (N1) closed two escapes:
//    - Global aliases (`const w = window; w.fetch(…)`): request APIs are
//      resolved through what an expression IS (globalKind: window, globalThis,
//      self, top, parent, frames, opener, navigator, document.defaultView,
//      and chains of them). The global object may only be read through, as
//      the object of a member access, `typeof` or `in`. Holding it in any other
//      way fails. So do eval, Function, a .constructor call and string timers,
//      which reach globals by name from a string. Worker and SharedWorker are
//      request APIs.
//    - The dynamic asset exception: asset requests live only in
//      src/lib/assetTransport.js (ASSET_TRANSPORT). Each is fetch(<listed
//      const = a same-origin path, never /.netlify/functions/>, { method:
//      "GET", credentials: "omit", redirect: "error" }) as literals.
//    BOUND, stated: requests an element makes by loading a URL (an image src,
//    navigation, a link, the service-worker registration of /sw.js) are not
//    API calls and are not sites. They are GET-only and cannot set headers or
//    a body. The only function routes that answer GET are deploy-context and
//    register-job's diagnostic (read-only), enroll-list (needs a Bearer header
//    such a load cannot send) and csrf-bootstrap (writes nothing; its response
//    is not readable by an element). public/sw.js is outside src/ and has its
//    own tests.
//  - R2 re-exporting the package in any form — `export {…} from`, `export * from`,
//    `export * as x from`, aliases — fails in every file, the gateway included.
//  - R3 a `var` anywhere in an enclosing function body (any nested block, a
//    for-head), hoisted to the whole function, shadows the constant; a `var` in a
//    NESTED function does not.
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, relative, sep, basename } from "node:path";
import { Parser } from "acorn";
import jsx from "acorn-jsx";
import { DISPATCHERS, INTERNAL_FORWARDING, ASSET_TRANSPORT } from "./inventory-allowlist.mjs";

const JSXParser = Parser.extend(jsx());

/** The two files that may hold the raw client permanently (§0.2). */
export const GATEWAY = Object.freeze(["src/lib/supabase.js", "src/lib/storeConfig.js"]);
/** Where `@supabase/supabase-js` may be imported. Exactly one file. */
export const CLIENT_INIT = "src/lib/supabase.js";
/** The exported identifier for the raw client. */
export const CLIENT_ID = "supabase";
/** The production project the snapshot must describe. */
export const SNAPSHOT_PROJECT = "gmxyisjjaxtpycsmmzef";
/** Roles the snapshot may have been captured as (information_schema is role-filtered). */
export const SNAPSHOT_ROLES = Object.freeze(["postgres"]);
/** RPCs the client may call, each with the slice that moves it. Anything else fails. */
export const APPROVED_RPC = Object.freeze({ verify_employee_pin: "4" });

const REACH_PROPS = new Set(["from", "rpc", "channel"]);
const CALLED_PROPS = new Set(["from", "rpc", "channel", "removeChannel"]);
const ROUTE_PREFIX = "/.netlify/functions/";
// A string piece shaped like part of a Netlify function route (R1). Path
// shapes only: the word "Netlify" in prose (the build-stamp message) is fine.
const ROUTE_SHAPE = /\.netlify|netlify\/|\/functions\//i;

const posix = (p) => p.split(sep).join("/");

function walkFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walkFiles(p, out);
    else if (/\.(js|jsx|mjs|cjs|ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

// Generic AST walk with parent pointers.
function walk(node, visit, parent = null) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) { for (const n of node) walk(n, visit, parent); return; }
  if (typeof node.type !== "string") return;
  visit(node, parent);
  for (const key of Object.keys(node)) {
    if (key === "type" || key === "loc" || key === "start" || key === "end") continue;
    const v = node[key];
    if (v && typeof v === "object") walk(v, visit, node);
  }
}

// Top-level `const NAME = "literal"` only. A `let`, a reassignment anywhere in
// the file, or an import binding of the same name disqualifies it.
function topLevelStringConsts(ast) {
  const m = new Map();
  const disqualified = new Set();
  for (const st of ast.body) {
    if (st.type === "VariableDeclaration") {
      for (const d of st.declarations) {
        if (d.id.type !== "Identifier") continue;
        if (st.kind === "const" && d.init && d.init.type === "Literal" && typeof d.init.value === "string") m.set(d.id.name, d.init.value);
        else disqualified.add(d.id.name);
      }
    }
    if (st.type === "ImportDeclaration") for (const sp of st.specifiers) disqualified.add(sp.local.name);
  }
  walk(ast, (n) => {
    if (n.type === "AssignmentExpression" && n.left.type === "Identifier") disqualified.add(n.left.name);
    if (n.type === "UpdateExpression" && n.argument.type === "Identifier") disqualified.add(n.argument.name);
  });
  for (const d of disqualified) m.delete(d);
  return m;
}

// Every name a pattern binds (Identifier, {a, b: c}, [d], e = 1, ...rest).
function patternNames(p, out = []) {
  if (!p) return out;
  switch (p.type) {
    case "Identifier": out.push(p.name); break;
    case "ObjectPattern": for (const q of p.properties) patternNames(q.type === "RestElement" ? q.argument : q.value, out); break;
    case "ArrayPattern": for (const e of p.elements) patternNames(e, out); break;
    case "AssignmentPattern": patternNames(p.left, out); break;
    case "RestElement": patternNames(p.argument, out); break;
    default: break;
  }
  return out;
}
// I2: is `name` re-bound by any scope enclosing `node` (below the top level)?
// Every `var` binding anywhere in a function's body, stopping at nested
// functions (their vars are theirs). `var` hoists to the whole function, so a
// declaration in a sibling block still binds the name at the use site.
function functionVarNames(fn) {
  const names = [];
  const visit = (n) => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) { n.forEach(visit); return; }
    if (typeof n.type !== "string") return;
    if (n !== fn && /^(FunctionDeclaration|FunctionExpression|ArrowFunctionExpression)$/.test(n.type)) return;
    if (n.type === "VariableDeclaration" && n.kind === "var") for (const d of n.declarations) names.push(...patternNames(d.id));
    for (const k of Object.keys(n)) if (k !== "type" && k !== "loc" && n[k] && typeof n[k] === "object") visit(n[k]);
  };
  visit(fn.body);
  return names;
}

function shadowedBy(name, node, parentOf) {
  for (let cur = parentOf(node); cur; cur = parentOf(cur)) {
    if (/^(FunctionDeclaration|FunctionExpression|ArrowFunctionExpression)$/.test(cur.type)) {
      for (const p of cur.params) if (patternNames(p).includes(name)) return `parameter of the enclosing ${cur.type}`;
      if (cur.id && cur.id.name === name) return "the enclosing function's own name";
      if (functionVarNames(cur).includes(name)) return "var hoisted to the enclosing function";
    }
    if (cur.type === "CatchClause" && cur.param && patternNames(cur.param).includes(name)) return "catch binding";
    if (cur.type === "BlockStatement" || cur.type === "ForStatement" || cur.type === "ForInStatement" || cur.type === "ForOfStatement" || cur.type === "SwitchStatement") {
      const stmts = cur.type === "BlockStatement" ? cur.body : cur.type === "SwitchStatement" ? cur.cases.flatMap((c) => c.consequent) : [cur.init || cur.left].filter(Boolean);
      for (const st of stmts) {
        if (st && st.type === "VariableDeclaration") for (const d of st.declarations) if (patternNames(d.id).includes(name)) return `${st.kind} in an enclosing block`;
        if (st && (st.type === "FunctionDeclaration" || st.type === "ClassDeclaration") && st.id?.name === name) return "declaration in an enclosing block";
      }
    }
  }
  return null;
}

function staticString(node, consts, parentOf = null) {
  if (!node) return { ok: false, why: "no argument" };
  if (node.type === "Literal" && typeof node.value === "string") return { ok: true, value: node.value };
  if (node.type === "TemplateLiteral" && node.expressions.length === 0) {
    return { ok: true, value: node.quasis.map((q) => q.value.cooked).join("") };
  }
  if (node.type === "Identifier" && consts.has(node.name)) {
    const shadow = parentOf ? shadowedBy(node.name, node, parentOf) : null;
    if (shadow) return { ok: false, why: `identifier ${node.name} is shadowed here by a ${shadow}; the top-level const does not apply` };
    return { ok: true, value: consts.get(node.name), via: node.name };
  }
  if (node.type === "Identifier") return { ok: false, why: `identifier ${node.name} is not a same-file top-level const string` };
  if (node.type === "TemplateLiteral") return { ok: false, why: "template literal with expressions" };
  return { ok: false, why: `${node.type} is not a string literal` };
}

function isClientImportSource(src) {
  return /(^|\/)supabase\.js$/.test(String(src));
}

function dupes(arr) {
  const seen = new Set(), d = new Set();
  for (const x of arr) (seen.has(x) ? d : seen).add(x);
  return [...d];
}

// The newest applied migration file in supabase/migrations/ — the version
// the snapshot must have been captured at.
export function appliedBaselineVersion(root) {
  const dir = join(root, "supabase", "migrations");
  if (!existsSync(dir)) return null;
  const versions = readdirSync(dir)
    .filter((f) => /^\d{14}_.*\.sql$/.test(f) && !/\.rollback\.sql$/.test(f))
    .map((f) => f.slice(0, 14))
    .sort();
  return versions.length ? versions[versions.length - 1] : null;
}

export function readTablesSnapshot(path, { root } = {}) {
  const rel = "supabase/tables.json";
  if (!existsSync(path)) return { error: `${rel} is absent: run scripts/manual/tables-snapshot.sql and commit its output` };
  const raw = readFileSync(path, "utf8");
  if (raw.includes("RECORDED BY HAND")) return { error: `${rel} still contains a "RECORDED BY HAND" placeholder: the capture was not completed` };
  let j;
  try { j = JSON.parse(raw); } catch { return { error: `${rel} is not valid JSON` }; }
  if (!j || typeof j !== "object" || Array.isArray(j)) return { error: `${rel} is not a JSON object` };
  for (const k of ["tables", "views", "buckets"]) {
    if (!Array.isArray(j[k])) return { error: `${rel} has no ${k} array` };
    if (!j[k].every((x) => typeof x === "string" && x)) return { error: `${rel}.${k} holds a non-string` };
    const d = dupes(j[k]);
    if (d.length) return { error: `${rel}.${k} has duplicates: ${d.join(", ")}` };
  }
  if (j.tables.length === 0) return { error: `${rel} lists no tables: an empty snapshot cannot be a capture of this project` };
  if (j.project !== SNAPSHOT_PROJECT) return { error: `${rel} project is ${JSON.stringify(j.project)}, expected ${SNAPSHOT_PROJECT} (production)` };
  if (!SNAPSHOT_ROLES.includes(j.role)) return { error: `${rel} was captured as role ${JSON.stringify(j.role)}; approved: ${SNAPSHOT_ROLES.join(", ")}` };
  if (typeof j.ledgerVersion !== "string" || !/^\d{14}$/.test(j.ledgerVersion)) return { error: `${rel} records no ledgerVersion` };
  // I4: provenance fields.
  if (typeof j.capturedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(j.capturedAt) || Number.isNaN(Date.parse(j.capturedAt))) {
    return { error: `${rel} capturedAt is missing or not a UTC timestamp (YYYY-MM-DDTHH:MM:SSZ)` };
  }
  if (typeof j.capturedBy !== "string" || !j.capturedBy.trim()) return { error: `${rel} capturedBy is missing or empty` };
  if (typeof j.database !== "string" || !j.database.trim()) return { error: `${rel} database is missing or empty` };
  if (j.query !== "scripts/manual/tables-snapshot.sql") return { error: `${rel} query must name scripts/manual/tables-snapshot.sql` };
  if (root) {
    const baseline = appliedBaselineVersion(root);
    if (!baseline) return { error: "no applied migration files under supabase/migrations/ to reconcile the snapshot against" };
    if (baseline !== j.ledgerVersion) {
      return { error: `${rel} ledgerVersion ${j.ledgerVersion} != newest applied migration file ${baseline}: the snapshot and the repo describe different schemas — recapture` };
    }
    // INV-6: Release 2 table presence follows applied migration state, net of
    // applied reviewed rollbacks.
    const { pendingOnly } = protectedNamesByState(root);
    const net = appliedReleaseState(root);
    if (net.errors.length) return { error: net.errors[0] };
    const have = new Set(j.tables);
    for (const t of net.present) if (!have.has(t)) return { error: `${rel} lacks "${t}", which an APPLIED release2 migration creates: the snapshot predates the apply — recapture` };
    for (const [t, by] of net.dropped) if (have.has(t)) return { error: `${rel} contains "${t}", which the applied reviewed rollback ${by} dropped: the snapshot predates the rollback — recapture` };
    for (const t of pendingOnly) if (have.has(t)) return { error: `${rel} contains "${t}", which no applied migration creates (still in pending/): either the apply is unrecorded or the snapshot is not production's` };
  }
  return { snapshot: j };
}

export function readRetired(path) {
  if (!existsSync(path)) return { error: `netlify/functions/_retired.json is absent` };
  let j;
  try { j = JSON.parse(readFileSync(path, "utf8")); } catch { return { error: `netlify/functions/_retired.json is not valid JSON` }; }
  if (!j || !Array.isArray(j.retired) || !j.retired.every((x) => typeof x === "string")) return { error: `netlify/functions/_retired.json has no "retired" string array` };
  return { retired: j.retired };
}

// A1: both lifecycle locations. pending/release2_*.sql before stage 0,
// <version>_release2_*.sql after.
function createdTables(dir) {
  const names = new Set();
  if (!existsSync(dir)) return names;
  for (const f of readdirSync(dir)) {
    if (!/(^|_)release2_.*\.sql$/i.test(f) || /\.rollback\.sql$/i.test(f)) continue;
    const sql = readFileSync(join(dir, f), "utf8");
    for (const m of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z_][a-z0-9_]*)/gi)) names.add(m[1].toLowerCase());
  }
  return names;
}
const sqlWithoutComments = (sql) => sql.replace(/\r\n/g, "\n").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
const TABLE_NAME = String.raw`(?:if\s+(?:not\s+)?exists\s+)?(?:public\.)?([a-z_][a-z0-9_]*)`;
const DROP_TABLE = new RegExp(String.raw`drop\s+table\s+` + TABLE_NAME, "gi");
const CREATE_TABLE = new RegExp(String.raw`create\s+table\s+` + TABLE_NAME, "gi");
const lfMd5 = (buf) => createHash("md5").update(buf.toString("utf8").replace(/\r\n/g, "\n"), "utf8").digest("hex");

/**
 * INV-6, net state: walk the APPLIED release2 files in version order. Returns
 * the tables that must be present, the tables a reviewed rollback dropped
 * (with the file that dropped them), and any violation.
 */
export function appliedReleaseState(root) {
  const dir = join(root, "supabase", "migrations");
  const out = { present: new Set(), dropped: new Map(), errors: [] };
  if (!existsSync(dir)) return out;
  // Reviewed rollbacks: the committed release2 .rollback.sql companions,
  // wherever they sit (pending/ before P2, beside the forward file after).
  const reviewed = new Set();
  for (const d of [dir, join(dir, "pending")]) {
    if (!existsSync(d)) continue;
    for (const f of readdirSync(d)) if (/(^|_)release2_.*\.rollback\.sql$/i.test(f)) reviewed.add(lfMd5(readFileSync(join(d, f))));
  }
  const applied = readdirSync(dir)
    .filter((f) => /^\d{14}_.*\.sql$/.test(f) && !/\.rollback\.sql$/i.test(f) && /(^|_)release2_/i.test(f))
    .sort();
  for (const f of applied) {
    const raw = readFileSync(join(dir, f));
    const sql = sqlWithoutComments(raw.toString("utf8"));
    const drops = [...sql.matchAll(DROP_TABLE)].map((m) => m[1].toLowerCase());
    const creates = [...sql.matchAll(CREATE_TABLE)].map((m) => m[1].toLowerCase());
    if (drops.length && !reviewed.has(lfMd5(raw))) {
      out.errors.push(`supabase/migrations/${f} drops ${drops.join(", ")} but is not byte-identical to any committed release2 .rollback.sql companion: an unreviewed drop`);
      continue;
    }
    for (const t of drops) {
      if (!out.present.has(t)) {
        out.errors.push(`supabase/migrations/${f} drops "${t}", which no EARLIER applied migration creates: a rollback older than its forward, or of a migration missing from history`);
        continue;
      }
      out.present.delete(t);
      out.dropped.set(t, f);
    }
    for (const t of creates) { out.present.add(t); out.dropped.delete(t); }
  }
  return out;
}

/** Names by lifecycle state: created by an APPLIED file, or only by a pending one. */
export function protectedNamesByState(root) {
  const applied = createdTables(join(root, "supabase", "migrations"));
  const pending = createdTables(join(root, "supabase", "migrations", "pending"));
  const pendingOnly = new Set([...pending].filter((n) => !applied.has(n)));
  return { applied, pendingOnly, all: new Set([...applied, ...pending]) };
}
export function protectedNamesFromMigrations(root) {
  return protectedNamesByState(root).all;
}

// ── Request boundary helpers (review of 8913a69, Part 1) ─────────────────────
// The raw request APIs a browser bundle can use to reach the network. Detection
// is by API, never by the URL's spelling: a route assembled at runtime from any
// pieces is still a call to one of these, and every such call must be an
// allowlisted site.
const REQUEST_GLOBALS = new Set(["fetch", "XMLHttpRequest", "EventSource", "WebSocket", "Worker", "SharedWorker"]);
const REQUEST_LIBRARIES = new Set(["axios", "ky", "ky-universal", "superagent", "node-fetch", "cross-fetch", "isomorphic-fetch", "undici", "got"]);

// ── Global-object resolution (review of d01b74a, N1) ─────────────────────────
// `const w = window; w.fetch(...)` used to escape: the scan knew `window.fetch`
// but not an alias of `window`. The fix is to resolve what an expression IS
// rather than what it is spelled like:
//   - a free identifier window / globalThis / self / top / parent / frames /
//     opener is the GLOBAL object (free: not declared in the module and not
//     shadowed by a parameter, local or catch binding);
//   - a free `navigator` is the navigator object, a free `document` the document;
//   - `<global>.window|self|globalThis|top|parent|frames|opener` is the global
//     object again, `<global>.navigator` the navigator, `<global>.document`
//     the document, and `<document>.defaultView` the global object.
// A resolved global (or navigator) may appear in exactly three positions: as
// the object of a member access, as the operand of `typeof`, and as the right
// side of `in`. Any other use (a binding, an argument, a spread, a
// destructuring source, a return value) is an alias and FAILS, because
// nothing after it can be followed. `<global>.fetch` and the other request
// APIs, and `<navigator>.sendBeacon`, are request sites wherever the global
// was reached from.
const GLOBAL_NAMES = new Set(["window", "globalThis", "self", "top", "parent", "frames", "opener"]);
const GLOBAL_PROPS = new Set(["window", "self", "globalThis", "top", "parent", "frames", "opener"]);
const unwrapChain = (n) => (n && n.type === "ChainExpression" ? n.expression : n);
const memberKey = (m) => (!m.computed ? m.property.name : (m.property.type === "Literal" && typeof m.property.value === "string" ? m.property.value : null));
/** The source spelling of an identifier/member chain, for messages. */
function spell(n) {
  n = unwrapChain(n);
  if (!n) return "?";
  if (n.type === "Identifier") return n.name;
  if (n.type === "MemberExpression") { const k = memberKey(n); return `${spell(n.object)}${k === null ? "[…]" : "." + k}`; }
  return "(expression)";
}

/** "global" | "navigator" | "document" | null — what this expression resolves to. */
function globalKind(node, isFree) {
  node = unwrapChain(node);
  if (!node) return null;
  if (node.type === "Identifier") {
    if (!GLOBAL_NAMES.has(node.name) && node.name !== "navigator" && node.name !== "document") return null;
    if (!isFree(node)) return null;
    if (GLOBAL_NAMES.has(node.name)) return "global";
    if (node.name === "navigator") return "navigator";
    if (node.name === "document") return "document";
    return null;
  }
  if (node.type === "MemberExpression") {
    const obj = globalKind(node.object, isFree);
    const key = memberKey(node);
    if (!obj || key === null) return null;
    if (obj === "global" && GLOBAL_PROPS.has(key)) return "global";
    if (obj === "global" && key === "navigator") return "navigator";
    if (obj === "global" && key === "document") return "document";
    if (obj === "document" && key === "defaultView") return "global";
  }
  return null;
}

function requestApiOf(callee, isFree) {
  callee = unwrapChain(callee);
  if (callee.type === "Identifier" && REQUEST_GLOBALS.has(callee.name)) return callee.name;
  if (callee.type === "MemberExpression") {
    const key = memberKey(callee);
    const obj = globalKind(callee.object, isFree);
    if (obj === "global" && key !== null && REQUEST_GLOBALS.has(key)) return key;
    if (obj === "navigator" && key === "sendBeacon") return "sendBeacon";
  }
  return null;
}

/** Names declared at module level: imports, top-level var/let/const, functions, classes. */
function moduleBindings(ast) {
  const names = new Set();
  for (const st of ast.body) {
    const decl = st.type === "ExportNamedDeclaration" || st.type === "ExportDefaultDeclaration" ? st.declaration : st;
    if (!decl) continue;
    if (decl.type === "ImportDeclaration") for (const sp of decl.specifiers) names.add(sp.local.name);
    if (decl.type === "VariableDeclaration") for (const d of decl.declarations) for (const n of patternNames(d.id)) names.add(n);
    if ((decl.type === "FunctionDeclaration" || decl.type === "ClassDeclaration") && decl.id) names.add(decl.id.name);
  }
  return names;
}

// ── The asset transport rule (review of d01b74a, N1) ─────────────────────────
// Permanent asset exceptions live ONLY in the reviewed transport module, and
// each of its request sites must be: fetch(<a listed same-file string const
// holding a same-origin absolute path>, { method: "GET", credentials: "omit",
// redirect: "error" [, cache: "<literal>"] }) — a literal options object, no
// body, no headers, nothing computed or spread.
const ASSET_OPTION_KEYS = new Set(["method", "credentials", "redirect", "cache"]);
function assetSiteProblem(call, consts, allowedConsts) {
  if (unwrapChain(call.callee).type !== "Identifier" || call.callee.name !== "fetch") return "an asset transport site must be a direct fetch() call";
  const [url, opts, ...rest] = call.arguments;
  if (rest.length) return "fetch() takes exactly (url, options) here";
  if (!url || url.type !== "Identifier" || !allowedConsts.includes(url.name) || !consts.has(url.name)) {
    return `the URL must be one of the listed string constants (${allowedConsts.join(", ")})`;
  }
  const path = consts.get(url.name);
  if (!/^\/(?!\/)[^?#\\]*$/.test(path) || /\/\.netlify\/functions(\/|$)/i.test(path) || /:/.test(path)) {
    return `${url.name} = ${JSON.stringify(path)} is not a same-origin asset path (absolute, no scheme, no //, never /.netlify/functions/)`;
  }
  if (!opts || opts.type !== "ObjectExpression") return "the options must be a literal object";
  const seen = new Map();
  for (const p of opts.properties) {
    if (p.type !== "Property" || p.computed || p.kind !== "init" || p.method || p.key.type !== "Identifier") return "the options may hold only plain literal properties (no spread, computed key or method)";
    if (!ASSET_OPTION_KEYS.has(p.key.name)) return `option "${p.key.name}" is not allowed on an asset request (allowed: ${[...ASSET_OPTION_KEYS].join(", ")})`;
    if (p.value.type !== "Literal" || typeof p.value.value !== "string") return `option "${p.key.name}" must be a string literal`;
    seen.set(p.key.name, p.value.value);
  }
  if (seen.get("method") !== "GET") return 'method must be the literal "GET"';
  if (seen.get("credentials") !== "omit") return 'credentials must be the literal "omit"';
  if (seen.get("redirect") !== "error") return 'redirect must be the literal "error"';
  return null;
}

// Is this identifier a reference to a binding (as opposed to a property name,
// an import/export specifier, a JSX name or a label)?
function isValueReference(node, parent) {
  if (!parent) return true;
  if (parent.type === "MemberExpression" && parent.property === node && !parent.computed) return false;
  if ((parent.type === "Property" || parent.type === "MethodDefinition" || parent.type === "PropertyDefinition") && parent.key === node && !parent.computed && parent.value !== node) return false;
  if (/^(ImportSpecifier|ImportDefaultSpecifier|ImportNamespaceSpecifier|ExportSpecifier|LabeledStatement|BreakStatement|ContinueStatement)$/.test(parent.type)) return false;
  if (parent.type.startsWith("JSX")) return false;
  return true;
}

// The nearest NAMED enclosing function: a declaration's id, or the binding a
// function expression is assigned to. Anonymous callbacks climb to their
// named container. "<module>" at top level.
function enclosingName(node, parentOf) {
  for (let cur = parentOf(node); cur; cur = parentOf(cur)) {
    if (cur.type === "FunctionDeclaration" && cur.id) return cur.id.name;
    if (cur.type === "FunctionExpression" || cur.type === "ArrowFunctionExpression") {
      if (cur.id) return cur.id.name;
      const p = parentOf(cur);
      if (p && p.type === "VariableDeclarator" && p.id.type === "Identifier") return p.id.name;
      if (p && (p.type === "Property" || p.type === "MethodDefinition") && !p.computed && p.key.type === "Identifier") return p.key.name;
      if (p && p.type === "AssignmentExpression" && p.left.type === "Identifier") return p.left.name;
    }
  }
  return "<module>";
}

// The static shape of a request's first argument: a literal, a same-file
// top-level const, or "dynamic". Part of the site's identity, so changing a
// reviewed literal's target changes the site.
function argShape(arg, consts, parentOf) {
  if (!arg) return "none";
  if (arg.type === "Literal" && typeof arg.value === "string") return "lit=" + arg.value;
  if (arg.type === "TemplateLiteral" && arg.expressions.length === 0) return "lit=" + arg.quasis.map((q) => q.value.cooked).join("");
  if (arg.type === "Identifier" && consts.has(arg.name) && !shadowedBy(arg.name, arg, parentOf)) return "const=" + arg.name;
  return "dynamic";
}

/**
 * I3: is this source a tombstone, in the one form allowed?
 *   export const TOMBSTONE = true;
 *   export const handler = async () => ({ statusCode: 410, ... literals ... });
 * No imports, no other statements, zero handler parameters, no branch of any
 * kind, statusCode a literal 410. Returns null when it is, else the reason.
 */
export function tombstoneProblem(src) {
  let ast;
  try { ast = JSXParser.parse(src, { ecmaVersion: "latest", sourceType: "module", locations: true }); }
  catch (e) { return `does not parse (${e.message})`; }
  const body = ast.body;
  if (body.some((st) => st.type === "ImportDeclaration" || st.type === "ImportExpression")) return "imports something; a tombstone imports nothing";
  if (body.length !== 2) return `has ${body.length} top-level statements; a tombstone has exactly two`;
  const [a, b] = body;
  const isExportConst = (st, name) => st.type === "ExportNamedDeclaration" && st.declaration?.type === "VariableDeclaration" && st.declaration.kind === "const" && st.declaration.declarations.length === 1 && st.declaration.declarations[0].id.type === "Identifier" && st.declaration.declarations[0].id.name === name;
  if (!isExportConst(a, "TOMBSTONE") || a.declaration.declarations[0].init?.type !== "Literal" || a.declaration.declarations[0].init.value !== true) return 'first statement must be `export const TOMBSTONE = true;`';
  if (!isExportConst(b, "handler")) return "second statement must be `export const handler = ...`";
  const fn = b.declaration.declarations[0].init;
  if (!fn || !/^(ArrowFunctionExpression|FunctionExpression)$/.test(fn.type)) return "handler must be a function expression";
  if (fn.params.length !== 0) return "handler must take no parameters; a tombstone does not read the request";
  let ret;
  if (fn.expression) ret = fn.body;
  else if (fn.body.type === "BlockStatement" && fn.body.body.length === 1 && fn.body.body[0].type === "ReturnStatement") ret = fn.body.body[0].argument;
  else return "handler body must be a single return of a literal object";
  if (!ret || ret.type !== "ObjectExpression") return "handler must return an object literal";
  let status = null;
  for (const p of ret.properties) {
    if (p.type !== "Property" || p.computed || p.key.type !== "Identifier") return "handler object has a non-plain property";
    if (p.value.type === "Literal") { if (p.key.name === "statusCode") status = p.value.value; continue; }
    if (p.value.type === "ObjectExpression" && p.value.properties.every((q) => q.type === "Property" && !q.computed && q.value.type === "Literal")) continue;
    return `handler property "${p.key.name}" is not a literal`;
  }
  if (status !== 410) return `handler statusCode is ${JSON.stringify(status)}, not the literal 410`;
  let branchy = null;
  walk(fn, (n, p) => {
    if (branchy || n === fn) return;
    if (n.type === "Identifier" && p && p.type === "Property" && p.key === n && !p.computed) return;   // a plain key, not a reference
    if (/^(IfStatement|ConditionalExpression|LogicalExpression|SwitchStatement|TryStatement|CallExpression|MemberExpression|Identifier|AwaitExpression)$/.test(n.type)) branchy = n.type;
  });
  if (branchy) return `handler contains a ${branchy}; a tombstone has no branch, call or reference`;
  return null;
}

/**
 * A3: the allowlist is per occurrence with expected cardinality.
 * @param sites   from runInventory
 * @param allow   { "file|kind|name": { count, slice } }
 * @returns string[] problems (empty = exact match)
 */
export function compareToAllowlist(sites, allow) {
  const found = new Map();
  for (const s of sites) { const k = `${s.file}|${s.kind}|${s.name}`; found.set(k, (found.get(k) || 0) + 1); }
  const problems = [];
  for (const [k, n] of found) {
    const a = allow[k];
    if (!a) problems.push(`NOT ALLOWLISTED: ${k} ×${n} — a new reach site; it needs a slice tag or it does not ship`);
    else if (a.count !== n) problems.push(`COUNT: ${k} found ×${n}, allowlist says ×${a.count}`);
  }
  for (const k of Object.keys(allow)) {
    if (!found.has(k)) problems.push(`STALE: ${k} is allowlisted but no longer in the code — remove the entry (its slice's stage D) or restore the site`);
  }
  return problems;
}

/**
 * @param {object} o
 * @param {string}   o.root         repo root (or a mutated copy of it)
 * @param {string[]} [o.retiredEver] reviewed list of routes that were ever retired (A2)
 * @returns {{errors: string[], sites: Array<{file:string,line:number,kind:string,name:string}>}}
 */
export function runInventory({ root, retiredEver = [], dispatchersFor = DISPATCHERS, forwarding = INTERNAL_FORWARDING, assetTransport = ASSET_TRANSPORT }) {
  const errors = [];
  const sites = [];
  const srcDir = join(root, "src");
  const fnDir = join(root, "netlify", "functions");
  const retiredPath = join(fnDir, "_retired.json");
  const tablesPath = join(root, "supabase", "tables.json");

  // ── inputs ────────────────────────────────────────────────────────────
  const snap = readTablesSnapshot(tablesPath, { root });
  if (snap.error) errors.push(snap.error);
  const tables = new Set(snap.snapshot?.tables ?? []);
  const views = new Set(snap.snapshot?.views ?? []);
  const buckets = new Set(snap.snapshot?.buckets ?? []);

  const ret = readRetired(retiredPath);
  if (ret.error) errors.push(ret.error);
  const retired = new Set(ret.retired ?? []);
  const fnFiles = existsSync(fnDir)
    ? readdirSync(fnDir).filter((f) => /\.js$/.test(f) && !f.startsWith("_")).map((f) => basename(f, ".js"))
    : [];
  const fnNames = new Set([...fnFiles, ...retired, ...retiredEver]);

  // A2: retirement is permanent. Every ever-retired name must still be listed
  // and still have its tombstone, whatever happened to the files.
  for (const name of retiredEver) {
    if (!retired.has(name)) errors.push(`${name} was retired and is no longer listed in _retired.json; retirement is not undone by deleting the entry`);
    if (!existsSync(join(fnDir, `${name}.js`))) errors.push(`${name} was retired and its tombstone file is gone; retirement is not undone by deleting the file`);
  }
  for (const name of retired) {
    const p = join(fnDir, `${name}.js`);
    if (!existsSync(p)) { errors.push(`retired route ${name} has no tombstone file netlify/functions/${name}.js`); continue; }
    const problem = tombstoneProblem(readFileSync(p, "utf8"));
    if (problem) errors.push(`tombstone netlify/functions/${name}.js is not in the tombstone form: ${problem}`);
  }
  // The other direction: a file that IS a tombstone but is not listed.
  for (const name of fnFiles) {
    if (retired.has(name)) continue;
    const src = readFileSync(join(fnDir, `${name}.js`), "utf8");
    if (/export const TOMBSTONE = true/.test(src)) errors.push(`netlify/functions/${name}.js is a tombstone but is not listed in _retired.json`);
  }

  const protectedNames = protectedNamesFromMigrations(root);
  if (protectedNames.size === 0) errors.push("no Release 2 table names discovered in supabase/migrations/pending/release2_*.sql or supabase/migrations/*_release2_*.sql: the protected set is empty");

  // ── the scan ──────────────────────────────────────────────────────────
  const files = existsSync(srcDir) ? walkFiles(srcDir) : [];
  const holders = new Map();
  for (const abs of files) {
    const file = posix(relative(root, abs));
    const code = readFileSync(abs, "utf8");
    if (/\.tsx?$/.test(abs)) { errors.push(`${file}: TypeScript is not scanned; the inventory has no parser for it`); continue; }
    let ast;
    try {
      ast = JSXParser.parse(code, { ecmaVersion: "latest", sourceType: "module", locations: true });
    } catch (e) {
      errors.push(`${file}: does not parse (${e.message}); an unparsed file is an unscanned file`);
      continue;
    }
    const consts = topLevelStringConsts(ast);
    const inGateway = GATEWAY.includes(file);
    const site = (line, kind, name) => sites.push({ file, line, kind, name });
    const parents = new WeakMap();
    walk(ast, (n, p) => { if (p) parents.set(n, p); });
    const parentOf = (n) => parents.get(n) || null;
    // A free identifier: a value reference not bound anywhere in this module.
    const moduleNames = moduleBindings(ast);
    const isFree = (n) => n.type === "Identifier" && !moduleNames.has(n.name)
      && isValueReference(n, parentOf(n)) && !shadowedBy(n.name, n, parentOf);

    // imports / exports of the client and of the package
    for (const st of ast.body) {
      if (st.type === "ImportDeclaration") {
        const src = String(st.source.value);
        if (src === "@supabase/supabase-js" && file !== CLIENT_INIT) {
          errors.push(`${file}:${st.loc.start.line}: imports @supabase/supabase-js; only ${CLIENT_INIT} may`);
        }
        if (isClientImportSource(src)) {
          for (const sp of st.specifiers) {
            if (sp.type === "ImportNamespaceSpecifier") {
              errors.push(`${file}:${st.loc.start.line}: namespace import of the gateway module (${sp.local.name}.${CLIENT_ID} would hide the client from the scan)`);
              continue;
            }
            if (sp.type === "ImportDefaultSpecifier") continue;
            const imported = sp.imported.name;
            if (imported !== CLIENT_ID) continue;
            holders.set(file, "import supabase");
            if (sp.local.name !== CLIENT_ID) {
              errors.push(`${file}:${st.loc.start.line}: imports the client under another name (${sp.local.name}); it must be named ${CLIENT_ID} so the scan can see it`);
            }
          }
        }
      }
      if ((st.type === "ExportNamedDeclaration" || st.type === "ExportAllDeclaration") && st.source && String(st.source.value) === "@supabase/supabase-js") {
        errors.push(`${file}:${st.loc.start.line}: re-exports @supabase/supabase-js (${st.type === "ExportAllDeclaration" ? (st.exported ? "export * as " + (st.exported.name ?? st.exported.value) : "export *") : "export {…} from"}); the package is re-exported by no file, the gateway included`);
      }
      if (st.type === "ExportNamedDeclaration") {
        if (st.declaration && st.declaration.type === "VariableDeclaration") {
          for (const d of st.declaration.declarations) {
            if (d.id.type === "Identifier" && d.id.name === CLIENT_ID) {
              if (file !== CLIENT_INIT) errors.push(`${file}:${st.loc.start.line}: defines and exports a "${CLIENT_ID}"; only ${CLIENT_INIT} may`);
              else holders.set(file, "defines the client");
            }
          }
        }
        for (const sp of st.specifiers || []) {
          if (sp.local.name === CLIENT_ID || sp.exported.name === CLIENT_ID) errors.push(`${file}:${st.loc.start.line}: re-exports the client; a second gateway`);
        }
      }
      if (st.type === "ExportAllDeclaration" && isClientImportSource(st.source.value)) {
        errors.push(`${file}:${st.loc.start.line}: export * from the client module; a second gateway`);
      }
    }

    walk(ast, (node, parent) => {
      // ── Request boundary (review of 8913a69, Part 1) ──────────────────────
      // Every raw request API is a SITE, whatever its URL looks like. A site is
      // identified by file, enclosing named function, API and the static shape
      // of its first argument; only allowlisted sites may exist. Dispatchers
      // (the reviewed functions that turn a route NAME into a request) may be
      // called only with a statically approved route-name literal, or from a
      // reviewed internal-forwarding site, and may never be referenced as a
      // value (alias, re-export, argument).
      if (node.type === "ImportDeclaration" && REQUEST_LIBRARIES.has(String(node.source.value))) {
        errors.push(`${file}:${node.loc.start.line}: imports the request library "${node.source.value}"; requests go only through reviewed transport sites`);
      }
      const ln = node.loc ? node.loc.start.line : 0;
      // The position an expression is USED in, looking through `?.` wrappers.
      const useOf = (n) => { let u = n, p = parentOf(u); while (p && p.type === "ChainExpression") { u = p; p = parentOf(p); } return { u, p }; };
      if (node.type === "CallExpression" || node.type === "NewExpression") {
        const api = requestApiOf(node.callee, isFree);
        if (api) {
          const encl = enclosingName(node, parentOf);
          site(ln, "request", `${encl}:${api}:${argShape(node.arguments[0], consts, parentOf)}`);
          // N1: the asset transport's sites are held to GET / omit / error.
          if (file === assetTransport.file) {
            const allowed = assetTransport.sites[encl];
            const problem = allowed ? assetSiteProblem(node, consts, allowed) : `a request in ${encl}, which is not a listed asset-transport function`;
            if (problem) errors.push(`${file}:${ln}: asset transport: ${problem}`);
          }
        }
        // Code from a string can reach any global by name, past every rule here.
        const callee = unwrapChain(node.callee);
        if (callee.type === "Identifier" && (callee.name === "setTimeout" || callee.name === "setInterval") && isFree(callee)) {
          const a = node.arguments[0];
          if (a && (a.type === "Literal" || a.type === "TemplateLiteral" || a.type === "BinaryExpression")) {
            errors.push(`${file}:${ln}: ${callee.name} with a string evaluates code from a string; pass a function`);
          }
        }
        if (callee.type === "MemberExpression" && memberKey(callee) === "constructor") {
          errors.push(`${file}:${ln}: calls a .constructor; a function's constructor evaluates code from a string`);
        }
      }
      if (node.type === "Identifier" && (node.name === "eval" || node.name === "Function") && isFree(node)) {
        errors.push(`${file}:${ln}: ${node.name} evaluates code from a string; not allowed in the client`);
      }
      if (node.type === "Identifier" && REQUEST_GLOBALS.has(node.name) && isValueReference(node, parent)) {
        const asCallee = parent && (parent.type === "CallExpression" || parent.type === "NewExpression") && parent.callee === node;
        if (!asCallee) errors.push(`${file}:${ln}: the request API ${node.name} is referenced as a value (alias, argument or member use); only a direct call is a reviewable site`);
      }
      // N1: the global object (and navigator, and document) may only be read
      // through, never held. See globalKind().
      if (node.type === "Identifier" || node.type === "MemberExpression") {
        const kind = globalKind(node, isFree);
        if (kind) {
          const { u, p } = useOf(node);
          const ok = p && ((p.type === "MemberExpression" && p.object === u)
            || (p.type === "UnaryExpression" && p.operator === "typeof")
            || (p.type === "BinaryExpression" && p.operator === "in" && p.right === u));
          if (!ok) errors.push(`${file}:${ln}: ${spell(node)} (the ${kind} object) is used as a value (${p ? p.type : "top level"}); an alias of it hides every request made through it — read through it directly`);
        }
      }
      if (node.type === "MemberExpression") {
        const obj = globalKind(node.object, isFree);
        const key = memberKey(node);
        if ((obj === "global" || obj === "navigator" || obj === "document") && node.computed && (key === null || REQUEST_GLOBALS.has(key) || key === "sendBeacon" || GLOBAL_PROPS.has(key) || key === "defaultView")) {
          errors.push(`${file}:${ln}: computed access on ${spell(node.object)} can reach a request API; not allowed`);
        } else if ((obj === "global" && key && REQUEST_GLOBALS.has(key)) || (obj === "navigator" && key === "sendBeacon")) {
          const { u, p } = useOf(node);
          const asCallee = p && (p.type === "CallExpression" || p.type === "NewExpression") && p.callee === u;
          if (!asCallee) errors.push(`${file}:${ln}: ${spell(node)} is referenced without being called; only a direct call is a reviewable site`);
        }
        if (key === "defaultView" && obj !== "document") {
          errors.push(`${file}:${ln}: .defaultView on something that is not the free \`document\` reaches the global object unseen; not allowed`);
        }
      }
      const dispatchers = dispatchersFor[file];
      if (dispatchers && node.type === "Identifier" && dispatchers.includes(node.name) && isValueReference(node, parent)) {
        const isDecl = parent && ((parent.type === "FunctionDeclaration" && parent.id === node) || (parent.type === "VariableDeclarator" && parent.id === node));
        if (!isDecl) {
          const isCall = parent && parent.type === "CallExpression" && parent.callee === node;
          if (!isCall) {
            errors.push(`${file}:${node.loc.start.line}: dispatcher ${node.name} is referenced as a value (${parent ? parent.type : "top level"}); a dispatcher may only be called with an approved route name`);
          } else {
            const arg = staticString(parent.arguments[0], consts, parentOf);
            const caller = enclosingName(node, parentOf);
            if (arg.ok) {
              if (!fnNames.has(arg.value)) errors.push(`${file}:${node.loc.start.line}: ${node.name}("${arg.value}") names no function in netlify/functions/`);
              else if (retired.has(arg.value) || retiredEver.includes(arg.value)) errors.push(`${file}:${node.loc.start.line}: ${node.name}("${arg.value}") names a retired route`);
            } else if (!forwarding.includes(`${file}|${caller}|${node.name}`)) {
              errors.push(`${file}:${node.loc.start.line}: dispatcher ${node.name} called from ${caller} with a non-literal route name (${arg.why}); only a statically approved route-name literal, or reviewed internal forwarding, may reach a dispatcher`);
            }
          }
        }
      }
      if (node.type === "ExportSpecifier" && dispatchers && dispatchers.includes(node.local.name)) {
        errors.push(`${file}:${node.loc.start.line}: dispatcher ${node.local.name} is re-exported${node.exported.name !== node.local.name ? " as " + node.exported.name : ""}; dispatchers stay module-private`);
      }

      // A5: dynamic import of the gateway module.
      if (node.type === "ImportExpression") {
        const s = node.source;
        const staticSrc = s.type === "Literal" ? String(s.value) : s.type === "TemplateLiteral" && s.expressions.length === 0 ? s.quasis.map((q) => q.value.cooked).join("") : null;
        if (staticSrc === null) errors.push(`${file}:${node.loc.start.line}: dynamic import() with a non-literal specifier; the scan cannot see what it loads`);
        else if (isClientImportSource(staticSrc)) errors.push(`${file}:${node.loc.start.line}: dynamic import() of the gateway module hides the client from the scan`);
        else if (staticSrc === "@supabase/supabase-js" && file !== CLIENT_INIT) errors.push(`${file}:${node.loc.start.line}: dynamic import() of @supabase/supabase-js; only ${CLIENT_INIT} may import the package`);
        else if (/^(https?:)?\/\//i.test(staticSrc)) errors.push(`${file}:${node.loc.start.line}: dynamic import() of a remote URL is a network request; not allowed`);
        else if (REQUEST_LIBRARIES.has(staticSrc)) errors.push(`${file}:${node.loc.start.line}: dynamic import() of the request library "${staticSrc}"`);
        return;
      }

      // Route builders (A5, R1) and route/function-name literals.
      if (node.type === "TemplateLiteral" && node.expressions.length > 0) {
        const qs = node.quasis.map((q) => String(q.value.cooked ?? ""));
        if (qs.some((q) => ROUTE_SHAPE.test(q))) {
          const dispatcher = qs.length === 2 && qs[0] === ROUTE_PREFIX && qs[1] === "";
          if (dispatcher) site(node.loc.start.line, "route-builder", "template");
          else errors.push(`${file}:${node.loc.start.line}: route template \`${qs.join("${…}")}\` is not the dispatcher form \`${ROUTE_PREFIX}\${name}\`; routes are not built from fragments`);
        }
        return;
      }
      if ((node.type === "Literal" && typeof node.value === "string") || (node.type === "TemplateLiteral" && node.expressions.length === 0)) {
        const v = node.type === "Literal" ? node.value : node.quasis.map((q) => q.value.cooked).join("");
        const line = node.loc.start.line;
        if (ROUTE_SHAPE.test(v)) {
          const m = /^\/\.netlify\/functions\/([a-z0-9-]+)$/.exec(v);
          if (!m) errors.push(`${file}:${line}: route piece ${JSON.stringify(v)} is not a full ${ROUTE_PREFIX}<name> literal; routes are not built piecewise — use a full literal or the allowlisted dispatcher`);
          else if (!fnNames.has(m[1])) errors.push(`${file}:${line}: route literal names "${m[1]}", which is not a function in netlify/functions/`);
          else { if (retired.has(m[1]) || retiredEver.includes(m[1])) errors.push(`${file}:${line}: names the retired route "${m[1]}"`); site(line, "fn", m[1]); }
        } else if (fnNames.has(v)) {
          if (retired.has(v) || retiredEver.includes(v)) errors.push(`${file}:${line}: names the retired route "${v}"`);
          site(line, "fn", v);
        }
        if (protectedNames.has(v.toLowerCase())) errors.push(`${file}:${line}: names the Release 2 table "${v}", which the client must never reach`);
        return;
      }

      if (node.type !== "Identifier" || node.name !== CLIENT_ID) return;
      // Not a reference: property names, import/export bindings, the definer.
      if (parent && parent.type === "MemberExpression" && parent.property === node && !parent.computed) return;
      if (parent && parent.type === "Property" && parent.key === node && !parent.computed && parent.value !== node) return;
      if (parent && /^(ImportSpecifier|ImportDefaultSpecifier|ImportNamespaceSpecifier|ExportSpecifier)$/.test(parent.type)) return;
      if (parent && parent.type === "VariableDeclarator" && parent.id === node && file === CLIENT_INIT) return;

      const line = node.loc.start.line;
      if (parent && parent.type === "Property" && parent.shorthand && parent.value === node) {
        errors.push(`${file}:${line}: the client is placed in an object literal`);
        return;
      }
      // Truthiness guards are fine — but only where the VALUE cannot escape.
      // `if (!supabase)`, `supabase ? a : b`, `supabase && doThing()` as a
      // statement are guards; `const c = supabase || null`, `return supabase
      // && x`, `export const c = supabase || fallback` let the client out.
      if (parent && parent.type === "UnaryExpression" && parent.operator === "!") return;
      if (parent && /^(IfStatement|ConditionalExpression|WhileStatement|DoWhileStatement|ForStatement)$/.test(parent.type) && parent.test === node) return;
      if (parent && parent.type === "LogicalExpression") {
        let top = parent, above = parentOf(top);
        while (above && above.type === "LogicalExpression") { top = above; above = parentOf(top); }
        const guardPosition =
          (above && /^(IfStatement|ConditionalExpression|WhileStatement|DoWhileStatement|ForStatement)$/.test(above.type) && above.test === top) ||
          (above && above.type === "UnaryExpression" && above.operator === "!") ||
          (above && above.type === "ExpressionStatement");
        if (guardPosition) return;
        errors.push(`${file}:${line}: the client escapes as a value through a logical expression (${above ? above.type : "top level"}); only a boolean guard may hold it`);
        return;
      }

      if (!parent || parent.type !== "MemberExpression" || parent.object !== node) {
        errors.push(`${file}:${line}: the client is used as a value (${parent ? parent.type : "top level"}); it may only be the object of an allowed member chain`);
        return;
      }
      if (parent.computed) { errors.push(`${file}:${line}: computed access on the client (supabase[...]) hides the member from the scan`); return; }
      if (parent.optional) { errors.push(`${file}:${line}: optional chaining on the client (supabase?.${parent.property.name}); guard with if (!supabase) instead`); return; }
      const prop = parent.property.name;
      const gp = parentOf(parent);
      const isCallee = gp && gp.type === "CallExpression" && gp.callee === parent && !gp.optional;

      if (CALLED_PROPS.has(prop)) {
        if (!isCallee) { errors.push(`${file}:${line}: supabase.${prop} is referenced without being called (aliasing)`); return; }
        if (!REACH_PROPS.has(prop)) return;
        const arg = staticString(gp.arguments[0], consts, parentOf);
        if (!arg.ok) { errors.push(`${file}:${line}: supabase.${prop}(${arg.why}); the name must be knowable at parse time`); return; }
        if (prop === "from") {
          if (tables.has(arg.value)) site(line, "table", arg.value);
          else if (views.has(arg.value)) site(line, "view", arg.value);
          else if (buckets.has(arg.value)) errors.push(`${file}:${line}: .from("${arg.value}") names a BUCKET, not a table — kinds do not mix`);
          else if (snap.snapshot) errors.push(`${file}:${line}: .from("${arg.value}") names no table or view in supabase/tables.json`);
          else site(line, "table?", arg.value);
        } else if (prop === "rpc") {
          if (!(arg.value in APPROVED_RPC)) errors.push(`${file}:${line}: .rpc("${arg.value}") is not an approved RPC (approved: ${Object.keys(APPROVED_RPC).join(", ")})`);
          site(line, "rpc", arg.value);
        } else {
          site(line, "channel", arg.value);
        }
        return;
      }
      if (prop === "storage") {
        if (!gp || gp.type !== "MemberExpression" || gp.object !== parent || gp.computed || gp.optional || gp.property.name !== "from") {
          errors.push(`${file}:${line}: supabase.storage used other than as supabase.storage.from(...)`);
          return;
        }
        const ggp = parentOf(gp);
        if (!ggp || ggp.type !== "CallExpression" || ggp.callee !== gp || ggp.optional) {
          errors.push(`${file}:${line}: supabase.storage.from is referenced without being called`);
          return;
        }
        const arg = staticString(ggp.arguments[0], consts, parentOf);
        if (!arg.ok) { errors.push(`${file}:${line}: supabase.storage.from(${arg.why})`); return; }
        if (buckets.has(arg.value)) site(line, "bucket", arg.value);
        else if (tables.has(arg.value) || views.has(arg.value)) errors.push(`${file}:${line}: storage.from("${arg.value}") names a TABLE, not a bucket — kinds do not mix`);
        else if (snap.snapshot) errors.push(`${file}:${line}: storage.from("${arg.value}") names no bucket in supabase/tables.json`);
        else site(line, "bucket?", arg.value);
        return;
      }
      if (prop === "auth") {
        if (!inGateway) errors.push(`${file}:${line}: supabase.auth outside the gateway files`);
        return;
      }
      if (prop === "schema") { errors.push(`${file}:${line}: supabase.schema(...) selects a schema other than public; not allowed`); return; }
      errors.push(`${file}:${line}: supabase.${prop} is not an allowed member`);
    });
  }

  for (const [file, how] of holders) sites.push({ file, line: 0, kind: "holds-client", name: how });

  return { errors, sites };
}
