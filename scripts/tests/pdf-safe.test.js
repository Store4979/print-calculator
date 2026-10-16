// Security: PDF.js runs on untrusted input at every call site. These tests
// are the contract that the eval path stays disabled and that nobody
// re-introduces a raw getDocument( call.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { PDFJS_HARDENED, openPdf } from "../../src/lib/pdfSafe.js";
import { jsCode, negativeControlFailures } from "./source-util.mjs";

// fileURLToPath, not URL.pathname: on Windows the latter yields "/C:/..."
// which is not a usable filesystem path.
const SRC = fileURLToPath(new URL("../../src/", import.meta.url));
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const label = (f) => relative(ROOT, f).replace(/\\/g, "/");

// The negative predicate (comment-stripping plan §3.2): the token itself is
// the tripwire, read in jsCode's view, where comments are blank and strings,
// templates and regex literals are intact, so `lib["getDocument"]` still trips.
const GET_DOCUMENT = /\bgetDocument\b/;
const refsGetDocument = (src, lbl) => GET_DOCUMENT.test(jsCode(src, { label: lbl }));
const walk = (dir) => readdirSync(dir).flatMap((e) => {
  const p = join(dir, e);
  return statSync(p).isDirectory() ? walk(p) : [p];
});

test("the hardened option set disables eval and XFA", () => {
  assert.equal(PDFJS_HARDENED.isEvalSupported, false);
  assert.equal(PDFJS_HARDENED.enableXfa, false, "pdf.js spells it enableXfa; isXfaEnabled is not a parameter");
  assert.equal("isXfaEnabled" in PDFJS_HARDENED, false, "the invented key must not come back");
  assert.equal(Object.isFrozen(PDFJS_HARDENED), true);
});

test("openPdf forwards the hardened options to getDocument", () => {
  let seen = null;
  const fakeLib = { getDocument: (opts) => { seen = opts; return { promise: Promise.resolve("doc") }; } };
  openPdf(fakeLib, "BYTES");
  assert.equal(seen.data, "BYTES");
  assert.equal(seen.isEvalSupported, false);
  assert.equal(seen.enableXfa, false);
});

test("openPdf refuses to run when the CDN global is missing", () => {
  assert.throws(() => openPdf(null, "x"), /pdf\.js not loaded/);
});

test("NO reference to getDocument survives anywhere in src/ — call, bracket, alias or destructure", () => {
  // The previous guard only matched `getDocument(`, so every one of these
  // walked straight past it:
  //     lib["getDocument"]({ data })      bracket access
  //     const g = lib.getDocument; g(...)  alias
  //     const { getDocument } = lib        destructure
  // The token itself is now the tripwire, read in jsCode's view: comments
  // blank (CRLF normalised), so prose about pdf.js cannot trip it, and every
  // file must PARSE, so none can drop out of the scan unseen.
  const scanned = walk(SRC).filter((f) => /\.jsx?$/.test(f) && !f.endsWith("pdfSafe.js"));
  assert.ok(scanned.length > 0, "the walk found the sources this guard covers");
  const offenders = scanned.filter((f) => refsGetDocument(readFileSync(f, "utf8"), label(f)));
  assert.deepEqual(offenders.map(label), [], `route these through openPdf(): ${offenders.map(label).join(", ")}`);
});

test("the guard actually catches every evasion it claims to", () => {
  // A guard nobody has seen fail is a guard nobody has tested.
  const evasions = {
    "plain call":   'const d = await lib.getDocument({ data });',
    "bracket":      'const d = await lib["getDocument"]({ data });',
    "bracket sq":   "const d = await lib['getDocument']({ data });",
    "alias":        'const g = lib.getDocument; const d = await g({ data });',
    "destructure":  'const { getDocument } = lib; const d = await getDocument({ data });',
    "computed":     'const k = "getDocument"; const d = await lib[k]({ data });',
    // Codex's reproduction at 41153b8: the old stripper deleted the call.
    "between comment-like lines": '// netlify/functions/*.js\nlib.getDocument({ data });\n// */\n',
    "after a URL":  'const u = "https://example.invalid/x"; lib.getDocument({ data });',
    "after image/*": 'const a = "image/*";\nlib.getDocument({ data });\n/* x */',
    "after a regex literal": 'const r = /a\\//; lib.getDocument({ data });',
  };
  const trips = (src) => refsGetDocument(src, "fixture.js");
  for (const [name, src] of Object.entries(evasions)) {
    assert.equal(trips(src), true, `${name} must be caught`);
  }
  assert.equal(refsGetDocument('const t = <p>see http://x /* y</p>; lib.getDocument({ data });', "fixture.jsx"), true, "JSX text holding // and /* hides nothing");
  // And prose must NOT trip it, on either line ending, in a line, block or JSX comment.
  const prose = '// we deliberately never call getDocument directly\nconst x = 1;';
  assert.equal(trips(prose), false, "LF comment must not trip");
  assert.equal(trips(prose.replace(/\n/g, "\r\n")), false, "CRLF comment must not trip");
  assert.equal(trips("/* getDocument */ const x = 1;"), false, "a block comment must not trip");
  assert.equal(refsGetDocument("const t = <p>{/* getDocument */}</p>;", "fixture.jsx"), false, "a JSX comment must not trip");
});

test("CS-4 pdf-safe: the getDocument predicate catches a call hidden behind every comment-like wrapper, appended to a real source", () => {
  const app = fileURLToPath(new URL("../../src/App.jsx", import.meta.url));
  const failures = negativeControlFailures([{
    id: "getDocument",
    raw: () => readFileSync(app, "utf8"),
    opts: { label: "src/App.jsx" },
    violates: (view) => GET_DOCUMENT.test(view),
    hit: "lib.getDocument({ data });",
  }]);
  assert.deepEqual(failures, []);
});

test("every entry point that loads pdf.js pins the same version", () => {
  const pins = ["index.html", "upload.html"].flatMap((f) =>
    [...readFileSync(fileURLToPath(new URL(`../../${f}`, import.meta.url)), "utf8")
      .matchAll(/pdf\.js\/([\d.]+)\//g)].map((m) => m[1]));
  assert.ok(pins.length >= 2);
  assert.equal(new Set(pins).size, 1, `mismatched pdf.js pins: ${pins.join(", ")}`);
});
