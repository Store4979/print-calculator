// Shared source-reading helpers for the test suite.
// docs/security/stage0-comment-stripping-plan.md §3.1–§3.2.
//
// jsCode() PARSES the source with acorn (acorn-jsx for JSX) and blanks exactly
// the comments acorn reports: every comment character becomes a space, except
// a line terminator (LF, U+2028, U+2029), which is kept. Strings, template
// literals, regex literals and JSX text are kept verbatim; lengths, lines and
// columns are unchanged; a comment between two tokens leaves whitespace, so
// tokens never join, and a comment that held a line break still holds it.
//
// It replaces stripComments: two regexes that deleted from any "/*" to the
// next "*/", and from any "//" to the end of its line, wherever they appeared,
// inside strings ("image/*", every URL), regex literals and line comments
// included. That deleted real code from the tests' view of 22 of the 68 files
// they read (Codex's audit at 41153b8).
//
// Failure is explicit. A source that does not parse throws, naming its label:
// no regex fallback, and no retry under the other sourceType. A view with no
// code at all throws unless the caller passes allowEmpty (only comment-only
// controls do). So an unparsed or empty input cannot satisfy a negative check.
//
// CRLF and lone CR become LF first: a Windows checkout is CRLF, and `.` in a
// pattern does not match \r.
import { Parser } from "acorn";
import jsx from "acorn-jsx";

const JSXParser = Parser.extend(jsx());

// The JavaScript line terminators a comment may contain once CR and CRLF are
// normalised to LF: LF, LINE SEPARATOR (U+2028) and PARAGRAPH SEPARATOR
// (U+2029). Blanking keeps every one of them, because a multi-line comment
// holding one is a line break to automatic semicolon insertion: `return
// /*<U+2028>*/ 1` returns undefined (Codex's review of 9333448, CS-R3).
const LINE_SEPARATOR = String.fromCharCode(0x2028);
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029);
const isLineTerminator = (ch) => ch === "\n" || ch === LINE_SEPARATOR || ch === PARAGRAPH_SEPARATOR;

function parseWithComments(text, { label, jsx: withJsx, sourceType }) {
  const comments = [];
  const tokens = [];
  const P = withJsx ? JSXParser : Parser;
  try {
    P.parse(text, {
      ecmaVersion: "latest",
      sourceType,
      onComment: (block, value, start, end) => comments.push({ start, end }),
      onToken: tokens,
    });
  } catch (e) {
    throw new Error(`${label}: does not parse as ${sourceType}${withJsx ? "+jsx" : ""}: ${e.message}`);
  }
  return { comments, tokens };
}

function options(label, o) {
  if (typeof label !== "string" || !label) throw new Error("jsCode: a label is required");
  const sourceType = o.sourceType ?? "module";
  if (sourceType !== "module" && sourceType !== "script") throw new Error(`${label}: sourceType must be "module" or "script"`);
  return { label, jsx: o.jsx ?? /\.jsx$/.test(label), sourceType };
}

/** The code-only view of a JavaScript/JSX source. Throws on a parse failure, and on an empty view unless allowEmpty. */
export function jsCode(src, { label, jsx: useJsx, sourceType, allowEmpty = false } = {}) {
  const o = options(label, { jsx: useJsx, sourceType });
  if (typeof src !== "string") throw new Error(`${label}: jsCode takes a string`);
  const text = src.replace(/\r\n?/g, "\n");
  const { comments } = parseWithComments(text, o);
  const out = text.split("");
  for (const { start, end } of comments) for (let i = start; i < end; i++) if (!isLineTerminator(out[i])) out[i] = " ";
  const view = out.join("");
  if (!allowEmpty && !/\S/.test(view)) throw new Error(`${label}: has no code outside its comments`);
  return view;
}

/** CS-5: the tokens and the comment count of a source, for the preservation check. */
export function jsTokens(src, { label, jsx: useJsx, sourceType } = {}) {
  const o = options(label, { jsx: useJsx, sourceType });
  const { comments, tokens } = parseWithComments(src.replace(/\r\n?/g, "\n"), o);
  return { comments: comments.length, tokens: tokens.map((t) => [t.type.label, t.value === undefined ? null : String(t.value), t.start, t.end]) };
}

// ── CS-4: negative source predicates and their controls ─────────────────────
//
// A negative source predicate passes when the view does NOT contain something.
// Its control plants a violating `hit` behind each wrapper below, appended to
// the real source, and requires the predicate to catch it in jsCode's view.
// Each wrapper is a form the old regex stripper could not see past. The
// sameLine wrappers put the hit after other code on the same line, so a
// predicate anchored at the start of a line (lineAnchored) SKIPS them: those
// combinations are not exercised. Two predicates are line-anchored, build-stamp's
// stampImport and deploy-context's dc20Imports, so six combinations (3 × 2) are
// skipped. Their same-line gap is a matching defect, tracked as its own item.
export const HIDING_WRAPPERS = [
  { id: "a /* inside a line comment, closed by // */", sameLine: false, wrap: (hit) => `\n// netlify/functions/*.js\n${hit}\n// */\n` },
  { id: "an \"image/*\" string, closed by a real /* */", sameLine: false, wrap: (hit) => `\nconst __cs4_s = "image/*";\n${hit}\n/* x */\n` },
  { id: "a URL string, then the hit on the same line", sameLine: true, wrap: (hit) => `\nconst __cs4_u = "https://example.invalid/a"; ${hit}\n` },
  { id: "a regex literal ending \\//, then the hit", sameLine: true, wrap: (hit) => `\nconst __cs4_r = /a\\//; ${hit}\n` },
  { id: "a template holding // and /*", sameLine: true, wrap: (hit) => `\nconst __cs4_t = \`// /*\`; ${hit}\n/* */\n` },
];

/**
 * Runs the CS-4 control for registered negative predicates. Each entry:
 *   { id, raw: () => source, opts: jsCode options, violates: (view) => bool,
 *     hit: a valid top-level statement that violates it, lineAnchored?,
 *     plant?: (raw, wrapped) => mutant source (default: appended) }
 * Returns the failures: a real view that already violates, a mutant that does
 * not parse, or a hidden hit the predicate misses.
 */
export function negativeControlFailures(entries) {
  const failures = [];
  for (const e of entries) {
    const raw = e.raw();
    if (e.violates(jsCode(raw, e.opts))) failures.push(`${e.id}: the real ${e.opts.label} already violates it`);
    for (const w of HIDING_WRAPPERS) {
      if (w.sameLine && e.lineAnchored) continue;
      const mutant = e.plant ? e.plant(raw, w.wrap(e.hit)) : raw + w.wrap(e.hit);
      let view;
      try { view = jsCode(mutant, e.opts); } catch (err) { failures.push(`${e.id} / ${w.id}: the mutant does not parse: ${err.message}`); continue; }
      if (!e.violates(view)) failures.push(`${e.id} / ${w.id}: the hidden hit is not caught`);
    }
  }
  return failures;
}

/**
 * CS-4 coverage: in a test file's own source, every assert.doesNotMatch whose
 * first argument is one of `viewNames` must take its pattern from the registry
 * object `registry` (`<registry>.<id>.re`), and every id in `regexIds` (the
 * registry's regex entries) must be used by one. Returns the problems.
 */
export function unregisteredNegatives(testSrc, { label, viewNames, registry, regexIds }) {
  const problems = [];
  const used = new Set();
  const ast = Parser.parse(testSrc.replace(/\r\n?/g, "\n"), { ecmaVersion: "latest", sourceType: "module", locations: true });
  const walk = (n) => {
    if (!n || typeof n.type !== "string") return;
    if (n.type === "CallExpression" && n.callee.type === "MemberExpression" && !n.callee.computed
        && n.callee.object.type === "Identifier" && n.callee.object.name === "assert"
        && n.callee.property.name === "doesNotMatch") {
      const [subject, pattern] = n.arguments;
      if (subject && subject.type === "Identifier" && viewNames.includes(subject.name)) {
        const ok = pattern && pattern.type === "MemberExpression" && !pattern.computed && pattern.property.name === "re"
          && pattern.object.type === "MemberExpression" && !pattern.object.computed
          && pattern.object.object.type === "Identifier" && pattern.object.object.name === registry;
        if (ok) used.add(pattern.object.property.name);
        else problems.push(`${label}:${n.loc.start.line}: assert.doesNotMatch(${subject.name}, …) does not take its pattern from ${registry}`);
      }
    }
    for (const v of Object.values(n)) {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v.type === "string") walk(v);
    }
  };
  walk(ast);
  for (const id of regexIds) if (!used.has(id)) problems.push(`${label}: ${registry}.${id} is registered but no assertion uses it`);
  return problems;
}
