// ============================================================
//  PDF.js HARDENING — one place, every call site
//
//  The app pins pdf.js 3.11.174 as a CDN global (index.html /
//  upload.html). That version predates the fix for CVE-2024-4367:
//  a crafted font's `FontMatrix` reaches an eval()-like path and
//  runs attacker JavaScript in the page origin. Fixed upstream in
//  4.2.67.
//
//  Every PDF this app opens is UNTRUSTED input:
//    - staff drag a customer's file onto the counter iPad,
//    - a walk-in uploads one from their phone at /upload,
//    - a Google Doc is fetched and stored by fetch-link-job.
//  So the exposure is reachable by anyone who can hand the store a
//  file — which is the entire point of a print shop.
//
//  `isEvalSupported: false` removes that path: pdf.js stops compiling glyph
//  outlines through `Function`/eval and uses its interpreted fallback.
//
//  What that costs is NOT characterised here. It is a different rendering
//  path, and the only honest way to know whether any given PDF looks the
//  same is to look at it — which is why the PR asks for a human render check
//  across all five call sites rather than asserting the change is free.
//
//  `enableXfa: false` keeps XFA forms from being rendered. Note the spelling:
//  the pdf.js option is `enableXfa`. An earlier revision of this file passed
//  `isXfaEnabled`, which is not a pdf.js parameter at all — it was silently
//  ignored, and the test asserting it only proved the object we built
//  contained a key we had invented. `enableXfa` already defaults to false in
//  3.11.174, so this is defence against a future default flipping, not a
//  change in current behaviour.
//
//  This is MITIGATION, not the fix. The fix is upgrading past 4.2.67 —
//  tracked separately, because 4.x changes the worker bootstrap and the
//  render() signature and needs its own visual regression pass.
//
//  Pure module: no imports, no DOM, no side effects, so `yarn test` can
//  assert the options object without a browser.
// ============================================================

export const PDFJS_HARDENED = Object.freeze({
  isEvalSupported: false,
  enableXfa: false,
});

// The ONLY sanctioned way to open a PDF in this codebase.
// scripts/tests/pdf-safe.test.js fails the build if a raw
// getDocument( call reappears anywhere in src/.
export const openPdf = (lib, data) => {
  if (!lib) throw new Error("pdf.js not loaded");
  return lib.getDocument({ data, ...PDFJS_HARDENED }).promise;
};
