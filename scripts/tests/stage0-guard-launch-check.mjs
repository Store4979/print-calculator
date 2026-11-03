// scripts/tests/stage0-guard-launch-check.mjs — how the tests reach a guard
// store, read from their PARSED source (acorn; comments are not code). The
// guarded-send procedure §7.2 (Codex's review of 4037d12, and Ryan's ruling
// on ORD) says no test may fall back to the real per-user store,
// ~/.stage0-guard. stage0-go.mjs, stage0-window.mjs and guardedSend fall
// back to it (DEFAULT_STATE) when they are given no state directory, and a
// child process resolves it from its own home directory. launchFindings()
// reports, for one test file:
//   - a child_process function reached other than as a named static import
//     from node:child_process, or used as a value (an alias);
//   - a string naming child_process (code embedded in a string, which this
//     check cannot read), and any DEFAULT_STATE reference in code;
//   - a string naming DEFAULT_STATE, unless it sits in a test the caller
//     lists as a reader (ORD and ORD-S, whose child processes report or
//     read their default path) and every launch in that test sets
//     env: syntheticHomeEnv(…);
//   - a launch that is not `git` and whose options do not set
//     `env: syntheticHomeEnv(…)` (the fixture's helper), unless the caller
//     lists it as a reviewed exception. An exception is refused when:
//       - it sits inside a test whose strings name a guard command line;
//       - it sits outside any test in a file whose strings name one;
//       - outside a test, its program or arguments come from a parameter
//         of its function, so its callers decide what it starts;
//   - an in-process call of a guard command line's main() whose deps carry
//     no stateDir (the sender's --dry-run, which reads no store, excepted),
//     and a guardedSend call whose options carry none.
// It is a regression gate over the tests' own code, not a sandbox: a name
// built at run time is not seen. Review is that control.
import { Parser } from "acorn";

/** The child_process functions that start a process. */
export const LAUNCHERS = ["spawn", "spawnSync", "execFile", "execFileSync", "exec", "execSync", "fork"];
/** The guard command lines: each falls back to the real store without a state directory. */
export const COMMAND_LINES = ["stage0-go", "stage0-window", "stage0-send"];
/** The two names this check reads strings for, built so that this file's own strings hold neither. */
export const CHILD_PROCESS = ["child", "process"].join("_");
export const DEFAULT_NAME = ["DEFAULT", "STATE"].join("_");
const CP = CHILD_PROCESS;
const DEFAULT = DEFAULT_NAME;
const COMMAND_MODULE = /(^|\/)stage0-(go|window|send)\.mjs$/;
const FIXTURE_MODULE = /(^|\/)stage0-guard-fixture\.mjs$/;

const isNode = (v) => v !== null && typeof v === "object" && typeof v.type === "string";

/** Visit every node with its ancestors (innermost last). */
function visit(node, fn, stack = []) {
  fn(node, stack);
  stack.push(node);
  for (const k of Object.keys(node)) {
    const v = node[k];
    if (Array.isArray(v)) { for (const c of v) if (isNode(c)) visit(c, fn, stack); } else if (isNode(v)) visit(v, fn, stack);
  }
  stack.pop();
}

/** Every string value in a subtree: literals and template parts. */
function strings(node) {
  const out = [];
  visit(node, (n) => {
    if (n.type === "Literal" && typeof n.value === "string") out.push(n.value);
    else if (n.type === "TemplateElement") out.push(n.value.cooked ?? n.value.raw);
  });
  return out;
}
const namesCommandLine = (node) => strings(node).some((s) => COMMAND_LINES.some((c) => s.includes(c)));

/** The innermost enclosing test(…) call, as { id, node }, or null. */
function enclosingTest(stack) {
  for (let i = stack.length - 1; i >= 0; i--) {
    const n = stack[i];
    if (n.type !== "CallExpression") continue;
    const c = n.callee;
    const isTest = (c.type === "Identifier" && c.name === "test") || (c.type === "MemberExpression" && !c.computed && c.property.name === "test");
    const a = n.arguments[0];
    const title = a && a.type === "Literal" && typeof a.value === "string" ? a.value : a && a.type === "TemplateLiteral" ? a.quasis.map((q) => q.value.cooked).join("…") : null;
    if (isTest && title !== null) return { id: title.split(/\s+/)[0], node: n };
  }
  return null;
}

/** The enclosing functions, innermost first, each with its name (null when anonymous). */
function enclosingFunctions(stack) {
  const out = [];
  for (let i = stack.length - 1; i >= 0; i--) {
    const n = stack[i];
    if (!/Function/.test(n.type)) continue;
    const p = stack[i - 1];
    const name = n.id ? n.id.name
      : p && p.type === "VariableDeclarator" && p.id.type === "Identifier" ? p.id.name
      : p && (p.type === "Property" || p.type === "MethodDefinition") && !p.computed && p.key.type === "Identifier" ? p.key.name
      : null;
    out.push({ node: n, name });
  }
  return out;
}

/** Every identifier a function's parameters bind. */
function paramNames(fn) {
  const out = new Set();
  for (const p of fn.params) visit(p, (n, st) => { const up = st[st.length - 1]; if (n.type === "Identifier" && !(up && up.type === "Property" && up.key === n && !up.shorthand) && !(up && up.type === "AssignmentPattern" && up.right === n)) out.add(n.name); });
  return out;
}

const keyName = (p) => (p.type === "Property" && !p.computed ? (p.key.type === "Identifier" ? p.key.name : p.key.value) : null);

/**
 * The findings for one file's source. `file` is its path for messages;
 * `exceptions` is the set of reviewed exception keys
 * ("<file> <scope> <launcher> <program>"); `seen` collects the keys of the
 * exceptions used. `readers` is the set of tests ("<file> <test id>") whose
 * strings may name DEFAULT_STATE; `seenReaders` collects those used.
 * Returns { findings, launches }.
 */
export function launchFindings(src, { file, exceptions = new Set(), seen = new Set(), readers = new Set(), seenReaders = new Set() }) {
  const ast = Parser.parse(src, { ecmaVersion: "latest", sourceType: "module", allowHashBang: true, locations: true });
  const findings = [];
  const launches = [];
  const at = (n) => `${file}:${n.loc.start.line}`;
  const text = (n) => src.slice(n.start, n.end).replace(/\s+/g, " ");
  const bound = new Map(); // local name → child_process function
  const commandNs = new Set(); // namespaces of a guard command line's module
  const commandMain = new Set(); // its main(), imported by name
  const senderNs = new Set(); // the same, for the sender alone (its --dry-run reads no store)
  const senderMain = new Set();
  let helper = null; // where syntheticHomeEnv comes from in this file
  const consts = new Map(); // const name → [init]

  visit(ast, (n) => {
    if (n.type === "ImportDeclaration") {
      const from = n.source.value;
      if (from === CP || from === `node:${CP}`) {
        for (const s of n.specifiers) {
          if (s.type === "ImportSpecifier" && LAUNCHERS.includes(s.imported.name)) bound.set(s.local.name, s.imported.name);
          else if (s.type !== "ImportSpecifier") findings.push(`${at(n)}: ${CP} is imported whole; import the functions by name`);
        }
      }
      if (COMMAND_MODULE.test(from)) {
        const send = /stage0-send\.mjs$/.test(from);
        for (const s of n.specifiers) {
          if (s.type === "ImportNamespaceSpecifier") { commandNs.add(s.local.name); if (send) senderNs.add(s.local.name); }
          else if (s.type === "ImportSpecifier" && s.imported.name === "main") { commandMain.add(s.local.name); if (send) senderMain.add(s.local.name); }
          else if (s.type === "ImportDefaultSpecifier") findings.push(`${at(n)}: a command line's module is imported by default; import it whole or by name`);
        }
      }
      if (FIXTURE_MODULE.test(from)) for (const s of n.specifiers) if (s.type === "ImportSpecifier" && s.imported.name === "syntheticHomeEnv") helper = s.local.name;
    }
    if (n.type === "FunctionDeclaration" && n.id && n.id.name === "syntheticHomeEnv" && FIXTURE_MODULE.test(file)) helper = "syntheticHomeEnv";
    if (n.type === "VariableDeclaration" && n.kind === "const") for (const d of n.declarations) if (d.id.type === "Identifier" && d.init) consts.set(d.id.name, [...(consts.get(d.id.name) || []), d.init]);
  });

  /** Whether an expression is, or resolves through consts and spreads to, an object with a stateDir property. */
  const carriesStateDir = (e, depth = 0) => {
    if (!e || depth > 4) return false;
    if (e.type === "Identifier") { const inits = consts.get(e.name) || []; return inits.length > 0 && inits.every((i) => carriesStateDir(i, depth + 1)); }
    if (e.type !== "ObjectExpression") return false;
    return e.properties.some((p) => keyName(p) === "stateDir" || (p.type === "SpreadElement" && carriesStateDir(p.argument, depth + 1)));
  };
  /** Whether an argv is an array literal holding "--dry-run", directly, through consts, or on both sides of a condition. */
  const dryRun = (e, depth = 0) => {
    if (!e || depth > 4) return false;
    if (e.type === "Identifier") { const inits = consts.get(e.name) || []; return inits.length > 0 && inits.every((i) => dryRun(i, depth + 1)); }
    if (e.type === "ConditionalExpression") return dryRun(e.consequent, depth + 1) && dryRun(e.alternate, depth + 1);
    return e.type === "ArrayExpression" && e.elements.some((x) => x && x.type === "Literal" && x.value === "--dry-run");
  };
  /** Every call of a child_process function inside a subtree. */
  const launchesIn = (node) => {
    const out = [];
    visit(node, (x) => { if (x.type === "CallExpression" && x.callee.type === "Identifier" && bound.has(x.callee.name)) out.push(x); });
    return out;
  };
  /** Whether a launch's options set env to a direct call of the fixture's helper, with nothing spread after it. */
  const syntheticEnv = (call) => {
    const opts = [...call.arguments].reverse().find((a) => a.type === "ObjectExpression");
    if (!opts) return false;
    const i = opts.properties.findIndex((p) => keyName(p) === "env");
    if (i < 0 || opts.properties.slice(i + 1).some((p) => p.type === "SpreadElement")) return false;
    const v = opts.properties[i].value;
    return helper !== null && v.type === "CallExpression" && v.callee.type === "Identifier" && v.callee.name === helper;
  };

  visit(ast, (n, stack) => {
    const up = stack[stack.length - 1];
    if (n.type === "ImportExpression" && n.source.type === "Literal" && String(n.source.value).includes(CP)) findings.push(`${at(n)}: ${CP} is imported dynamically`);
    if ((n.type === "Literal" && typeof n.value === "string") || n.type === "TemplateElement") {
      const s = n.type === "Literal" ? n.value : n.value.cooked ?? n.value.raw;
      const inImport = up && (up.type === "ImportDeclaration" || up.type === "ExportNamedDeclaration" || up.type === "ExportAllDeclaration");
      if (!inImport && s.includes(CP)) findings.push(`${at(n)}: a string names ${CP}: code embedded in a string is not checked`);
      if (s.includes(DEFAULT)) {
        const t = enclosingTest(stack);
        const key = t ? `${file} ${t.id}` : null;
        if (!key || !readers.has(key)) findings.push(`${at(n)}: a string names ${DEFAULT}, outside a listed reader test`);
        else if (!launchesIn(t.node).every(syntheticEnv)) findings.push(`${at(n)}: a string names ${DEFAULT} in test ${t.id}, which starts a process without env: syntheticHomeEnv(…)`);
        else seenReaders.add(key);
      }
    }
    if (n.type === "Identifier" && n.name === DEFAULT) findings.push(`${at(n)}: ${DEFAULT} is the real store's path; a test passes an explicit state directory`);

    // child_process functions: a call is a launch; any other use is an alias.
    const nameOnly = up && ((up.type === "ImportSpecifier") || (up.type === "MemberExpression" && up.property === n && !up.computed) || ((up.type === "Property" || up.type === "MethodDefinition") && up.key === n && !up.computed && !up.shorthand));
    if (n.type === "Identifier" && bound.has(n.name) && !nameOnly) {
      if (!(up && up.type === "CallExpression" && up.callee === n)) { findings.push(`${at(n)}: ${n.name} is used as a value; call it directly`); return; }
      const call = up;
      const program = call.arguments[0];
      const launch = { file, line: n.loc.start.line, launcher: bound.get(n.name), program: program ? text(program) : "" };
      launches.push(launch);
      if (program && program.type === "Literal" && program.value === "git") { launch.kind = "git"; return; }
      if (syntheticEnv(call)) { launch.kind = "synthetic home"; return; }
      const t = enclosingTest(stack);
      const fns = enclosingFunctions(stack);
      const named = fns.find((x) => x.name);
      launch.scope = t ? t.id : named ? named.name : "(module)";
      const key = `${file} ${launch.scope} ${launch.launcher} ${launch.program}`;
      launch.key = key;
      if (t && namesCommandLine(t.node)) { findings.push(`${at(n)}: test ${t.id} names a guard command line, so this launch sets env: syntheticHomeEnv(…)`); return; }
      if (!t && namesCommandLine(ast)) { findings.push(`${at(n)}: this file names a guard command line, so a launch outside a test sets env: syntheticHomeEnv(…)`); return; }
      // A shared helper module's launcher is called from other files, whose
      // strings this check does not read with it: what its parameters carry
      // decides what it starts.
      if (!t && !/\.test\.js$/.test(file)) {
        const params = new Set(fns.flatMap((x) => [...paramNames(x.node)]));
        const uses = [];
        for (const a of call.arguments.slice(0, 2)) if (a.type !== "ObjectExpression") visit(a, (x) => { if (x.type === "Identifier" && params.has(x.name)) uses.push(x.name); });
        if (uses.length) { findings.push(`${at(n)}: ${launch.scope} starts what its callers pass (${[...new Set(uses)].join(", ")}), so it sets env: syntheticHomeEnv(…)`); return; }
      }
      if (!exceptions.has(key)) { findings.push(`${at(n)}: a launch that is neither git nor env: syntheticHomeEnv(…), and not a reviewed exception: ${key}`); return; }
      seen.add(key);
      launch.kind = "exception";
    }

    // In-process: a guard command line's main(), and guardedSend.
    if (n.type === "CallExpression") {
      const c = n.callee;
      const isMain = (c.type === "MemberExpression" && !c.computed && c.object.type === "Identifier" && commandNs.has(c.object.name) && c.property.name === "main") || (c.type === "Identifier" && commandMain.has(c.name));
      if (isMain) {
        const sender = (c.type === "MemberExpression" ? senderNs : senderMain).has(c.type === "MemberExpression" ? c.object.name : c.name);
        if (!(sender && dryRun(n.arguments[0])) && !carriesStateDir(n.arguments[2])) findings.push(`${at(n)}: a command line's main() without a stateDir in its deps falls back to the real store`);
      }
      const gs = (c.type === "MemberExpression" && !c.computed && c.property.name === "guardedSend") || (c.type === "Identifier" && c.name === "guardedSend");
      if (gs && !carriesStateDir(n.arguments[0])) findings.push(`${at(n)}: guardedSend without a stateDir falls back to the real store`);
    }
  });
  return { findings, launches };
}
