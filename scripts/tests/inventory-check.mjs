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
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative, sep, basename } from "node:path";
import { Parser } from "acorn";
import jsx from "acorn-jsx";

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

function staticString(node, consts) {
  if (!node) return { ok: false, why: "no argument" };
  if (node.type === "Literal" && typeof node.value === "string") return { ok: true, value: node.value };
  if (node.type === "TemplateLiteral" && node.expressions.length === 0) {
    return { ok: true, value: node.quasis.map((q) => q.value.cooked).join("") };
  }
  if (node.type === "Identifier" && consts.has(node.name)) return { ok: true, value: consts.get(node.name), via: node.name };
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
  if (root) {
    const baseline = appliedBaselineVersion(root);
    if (!baseline) return { error: "no applied migration files under supabase/migrations/ to reconcile the snapshot against" };
    if (baseline !== j.ledgerVersion) {
      return { error: `${rel} ledgerVersion ${j.ledgerVersion} != newest applied migration file ${baseline}: the snapshot and the repo describe different schemas — recapture` };
    }
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
export function protectedNamesFromMigrations(root) {
  const names = new Set();
  const dirs = [join(root, "supabase", "migrations", "pending"), join(root, "supabase", "migrations")];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      if (!/(^|_)release2_.*\.sql$/i.test(f) || /\.rollback\.sql$/i.test(f)) continue;
      const sql = readFileSync(join(dir, f), "utf8");
      for (const m of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z_][a-z0-9_]*)/gi)) names.add(m[1].toLowerCase());
    }
  }
  return names;
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
export function runInventory({ root, retiredEver = [] }) {
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
    const src = readFileSync(p, "utf8");
    if (/^\s*import\s/m.test(src) || /require\(/.test(src)) errors.push(`tombstone netlify/functions/${name}.js imports something; a tombstone imports nothing`);
    if (!/410/.test(src)) errors.push(`tombstone netlify/functions/${name}.js does not answer 410`);
    if (!/export const TOMBSTONE = true/.test(src)) errors.push(`tombstone netlify/functions/${name}.js lacks the marker "export const TOMBSTONE = true"`);
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
      // A5: dynamic import of the gateway module.
      if (node.type === "ImportExpression") {
        const s = node.source;
        const staticSrc = s.type === "Literal" ? String(s.value) : s.type === "TemplateLiteral" && s.expressions.length === 0 ? s.quasis.map((q) => q.value.cooked).join("") : null;
        if (staticSrc === null) errors.push(`${file}:${node.loc.start.line}: dynamic import() with a non-literal specifier; the scan cannot see what it loads`);
        else if (isClientImportSource(staticSrc)) errors.push(`${file}:${node.loc.start.line}: dynamic import() of the gateway module hides the client from the scan`);
        return;
      }

      // Route builders (A5) and route/function-name literals.
      if (node.type === "TemplateLiteral" && node.expressions.length > 0) {
        if (node.quasis.some((q) => String(q.value.cooked).includes(ROUTE_PREFIX))) site(node.loc.start.line, "route-builder", "template");
        return;
      }
      if ((node.type === "Literal" && typeof node.value === "string") || (node.type === "TemplateLiteral" && node.expressions.length === 0)) {
        const v = node.type === "Literal" ? node.value : node.quasis.map((q) => q.value.cooked).join("");
        const line = node.loc.start.line;
        if (v.includes(ROUTE_PREFIX)) {
          const m = /^\/\.netlify\/functions\/([a-z0-9-]+)$/.exec(v);
          if (!m) errors.push(`${file}:${line}: route literal ${JSON.stringify(v)} is not exactly ${ROUTE_PREFIX}<name>`);
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
      // Truthiness guards are fine.
      if (parent && parent.type === "UnaryExpression" && parent.operator === "!") return;
      if (parent && parent.type === "IfStatement" && parent.test === node) return;
      if (parent && parent.type === "ConditionalExpression" && parent.test === node) return;
      if (parent && parent.type === "LogicalExpression") return;

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
        const arg = staticString(gp.arguments[0], consts);
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
        const arg = staticString(ggp.arguments[0], consts);
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
