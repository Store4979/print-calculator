// Security: PDF.js runs on untrusted input at every call site. These tests
// are the contract that the eval path stays disabled and that nobody
// re-introduces a raw getDocument( call.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PDFJS_HARDENED, openPdf } from "../../src/lib/pdfSafe.js";

// fileURLToPath, not URL.pathname: on Windows the latter yields "/C:/..."
// which is not a usable filesystem path.
const SRC = fileURLToPath(new URL("../../src/", import.meta.url));
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

test("no raw getDocument( call survives anywhere in src/", () => {
  const offenders = walk(SRC)
    .filter((f) => /\.jsx?$/.test(f) && !f.endsWith("pdfSafe.js"))
    .filter((f) => /getDocument\s*\(/.test(readFileSync(f, "utf8")));
  assert.deepEqual(offenders, [], `route these through openPdf(): ${offenders.join(", ")}`);
});

test("every entry point that loads pdf.js pins the same version", () => {
  const pins = ["index.html", "upload.html"].flatMap((f) =>
    [...readFileSync(fileURLToPath(new URL(`../../${f}`, import.meta.url)), "utf8")
      .matchAll(/pdf\.js\/([\d.]+)\//g)].map((m) => m[1]));
  assert.ok(pins.length >= 2);
  assert.equal(new Set(pins).size, 1, `mismatched pdf.js pins: ${pins.join(", ")}`);
});
