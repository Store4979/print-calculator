// scripts/tests/sql-lexer.mjs — a bounded lexer for the PostgreSQL text this
// repository's checks read (the release2 migrations and their rollbacks, and
// the stage-0 texts M-6/M-6b inspect), and the views built from it.
// docs/security/stage0-comment-stripping-plan.md §3.3–§3.4.
//
// It replaces two regex strippers that read text as comments without knowing
// what a string was: inventory-check.mjs's sqlWithoutComments (block regex,
// then `--` regex) and the manifest checker's `--[^\n]*` passes. A `--` inside
// '…' cut the rest of the line, and a `/*` inside a line comment deleted
// everything up to the next `*/` (Codex's audit at 41153b8).
//
// lexSql() is SEGMENTATION ONLY. To it, a dollar-quoted value is a string: it
// never looks inside one, so a data literal is never reported as malformed
// SQL. sqlCode() is the INTERPRETATION. Its caller says whether each dollar
// body is executable SQL/PL/pgSQL (lexed again, recursively) or data, from the
// input's reviewed role and position. The tag in the input decides nothing.
//
// String mode: standard_conforming_strings = on, PostgreSQL's default, so a
// backslash inside '…' is literal and only E'…' takes backslash escapes. A
// code segment that names that setting is refused, because it could change
// the rule. Every unsupported form THROWS with the label and the offset;
// nothing returns a partial result.

export const MAX_INPUT = 4 * 1024 * 1024;  // characters; SIZE-PROBE, the largest real input, is ~241 KB
export const MAX_COMMENT_DEPTH = 64;       // nested /* … */
export const MAX_BODY_DEPTH = 8;           // dollar bodies interpreted as code inside each other

const IDENT_START = /[A-Za-z_\u0080-￿]/;
const IDENT_PART = /[A-Za-z0-9_$\u0080-￿]/;
const TAG_START = /[A-Za-z_]/;
const TAG_PART = /[A-Za-z0-9_]/;
const DIGIT = /[0-9]/;

export class SqlLexError extends Error {}

function fail(label, offset, what) {
  throw new SqlLexError(`${label}: ${what} at offset ${offset}`);
}

/** The index just past the closing quote of the quoted run opening at `open`. */
function quotedEnd(text, open, q, backslashEscapes, label, what) {
  let j = open + 1;
  for (;;) {
    if (j >= text.length) fail(label, open, `an unterminated ${what}`);
    const ch = text[j];
    if (backslashEscapes && ch === "\\") { j += 2; continue; }
    if (ch === q) {
      if (text[j + 1] === q) { j += 2; continue; }
      return j + 1;
    }
    j++;
  }
}

/**
 * Segments covering `text` exactly, in order. Kinds: code, line-comment,
 * block-comment, string, e-string, quoted-ident, dollar (with tag, bodyStart,
 * bodyEnd). Each character is visited a bounded number of times; a dollar
 * quote's end is found with one indexOf.
 */
export function lexSql(text, { label } = {}) {
  if (typeof label !== "string" || !label) throw new Error("lexSql: a label is required");
  if (typeof text !== "string") throw new Error(`${label}: lexSql takes a string`);
  if (text.length > MAX_INPUT) fail(label, 0, `an input of ${text.length} characters, over the ${MAX_INPUT} limit`);
  const n = text.length;
  const segs = [];
  let i = 0, codeStart = 0;
  const push = (seg) => {
    if (seg.start > codeStart) segs.push({ kind: "code", start: codeStart, end: seg.start });
    segs.push(seg);
    codeStart = i = seg.end;
  };
  while (i < n) {
    const c = text[i], d = text[i + 1];
    if (c === "-" && d === "-") {
      const nl = text.indexOf("\n", i + 2);
      push({ kind: "line-comment", start: i, end: nl === -1 ? n : nl });
    } else if (c === "/" && d === "*") {
      let depth = 1, j = i + 2;
      while (depth > 0) {
        if (j >= n) fail(label, i, "an unterminated block comment");
        if (text[j] === "/" && text[j + 1] === "*") {
          if (++depth > MAX_COMMENT_DEPTH) fail(label, j, `block comments nested deeper than ${MAX_COMMENT_DEPTH}`);
          j += 2;
        } else if (text[j] === "*" && text[j + 1] === "/") { depth--; j += 2; }
        else j++;
      }
      push({ kind: "block-comment", start: i, end: j });
    } else if (c === "'") {
      push({ kind: "string", start: i, end: quotedEnd(text, i, "'", false, label, "string") });
    } else if (c === '"') {
      push({ kind: "quoted-ident", start: i, end: quotedEnd(text, i, '"', false, label, "quoted identifier") });
    } else if (c === "$") {
      if (d !== undefined && DIGIT.test(d)) {            // $1: a parameter, part of the code
        i += 2;
        while (i < n && DIGIT.test(text[i])) i++;
        continue;
      }
      let j = i + 1;                                    // j ends on the tag's closing $
      if (d !== "$") {
        if (d === undefined || !TAG_START.test(d)) fail(label, i, "a $ that opens neither a parameter nor a dollar quote");
        j = i + 2;
        while (j < n && TAG_PART.test(text[j])) j++;
        if (text[j] !== "$") fail(label, i, "a $ that opens neither a parameter nor a dollar quote");
      }
      const delim = text.slice(i, j + 1);
      const close = text.indexOf(delim, j + 1);
      if (close === -1) fail(label, i, `an unterminated dollar quote ${delim}`);
      push({ kind: "dollar", start: i, end: close + delim.length, tag: delim.slice(1, -1), bodyStart: j + 1, bodyEnd: close });
    } else if (IDENT_START.test(c)) {
      // A whole identifier, `$` included after its first character: the `$` in
      // a$b$ belongs to the identifier and opens nothing.
      let j = i + 1;
      while (j < n && IDENT_PART.test(text[j])) j++;
      if (j === i + 1 && (c === "E" || c === "e") && text[j] === "'") {
        push({ kind: "e-string", start: i, end: quotedEnd(text, j, "'", true, label, "E-string") });
      } else i = j;
    } else i++;
  }
  if (n > codeStart) segs.push({ kind: "code", start: codeStart, end: n });
  // The coverage invariant. Necessary, not sufficient: lexical correctness is
  // what the CS-3 matrix tests.
  let at = 0;
  for (const s of segs) {
    if (s.start !== at || s.end <= s.start) throw new Error(`${label}: lexSql's segments do not cover the input at offset ${at}`);
    at = s.end;
  }
  if (at !== n) throw new Error(`${label}: lexSql's segments end at ${at}, not ${n}`);
  for (const s of segs) {
    if (s.kind === "code" && /standard_conforming_strings/i.test(text.slice(s.start, s.end))) {
      fail(label, s.start, "standard_conforming_strings named in code, which this lexer does not support (it assumes on)");
    }
  }
  return segs;
}

const blank = (t) => t.replace(/[^\n]/g, " ");

/**
 * A view of `text` with the same length: comments blanked to spaces (newlines
 * kept) at every depth; strings, E-strings and quoted identifiers kept or
 * blanked between their delimiters, as the caller says; dollar bodies either
 * interpreted as code (recursively, same options) or treated as data, as the
 * caller's `bodies` says. With strings "keep", every character outside a
 * comment is unchanged.
 *
 * bodies: "code" (every dollar body in this text is executable), or a function
 * (segment, { text, depth }) → "code" | "data" that decides from the input's
 * reviewed role and position. Any other answer throws.
 */
export function sqlCode(text, { label, strings, bodies, depth = 0 } = {}) {
  if (strings !== "keep" && strings !== "blank") throw new Error(`${label}: sqlCode needs strings: "keep" or "blank"`);
  if (bodies !== "code" && typeof bodies !== "function") throw new Error(`${label}: sqlCode needs bodies: "code" or a role function`);
  if (depth > MAX_BODY_DEPTH) fail(label, 0, `dollar bodies interpreted as code deeper than ${MAX_BODY_DEPTH}`);
  const segs = lexSql(text, { label });
  let out = "";
  for (const s of segs) {
    const t = text.slice(s.start, s.end);
    if (s.kind === "code") out += t;
    else if (s.kind === "line-comment" || s.kind === "block-comment") out += blank(t);
    else if (s.kind === "string" || s.kind === "quoted-ident") out += strings === "keep" ? t : t[0] + blank(t.slice(1, -1)) + t.slice(-1);
    else if (s.kind === "e-string") out += strings === "keep" ? t : t.slice(0, 2) + blank(t.slice(2, -1)) + t.slice(-1);
    else if (s.kind === "dollar") {
      const open = text.slice(s.start, s.bodyStart);
      const body = text.slice(s.bodyStart, s.bodyEnd);
      const close = text.slice(s.bodyEnd, s.end);
      const role = bodies === "code" ? "code" : bodies(s, { text, depth });
      if (role === "code") {
        out += open + sqlCode(body, { label: `${label} > ${open} at offset ${s.start}`, strings, bodies, depth: depth + 1 }) + close;
      } else if (role === "data") {
        out += open + (strings === "keep" ? body : blank(body)) + close;
      } else {
        throw new Error(`${label}: the role given for ${open} at offset ${s.start} is ${JSON.stringify(role)}, not "code" or "data"`);
      }
    } else throw new Error(`${label}: unknown segment kind ${s.kind}`);
  }
  if (out.length !== text.length) throw new Error(`${label}: sqlCode changed the length (${text.length} → ${out.length})`);
  return out;
}
