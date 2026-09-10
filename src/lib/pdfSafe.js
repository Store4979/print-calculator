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
//  `isEvalSupported: false` removes that path. It costs a small
//  amount of font-rendering fidelity on some PDFs and nothing else;
//  page counts, rasterisation and imposition are unaffected.
//  `isXfaEnabled: false` drops the XFA parser, which this app never
//  uses and which is a second, larger attack surface.
//
//  This is MITIGATION, not the fix. The fix is upgrading past
//  4.2.67 — tracked separately, because 4.x changes the worker
//  bootstrap and the render() signature and needs its own visual
//  regression pass on all five call sites.
//
//  Pure module: no imports, no DOM, no side effects, so `yarn test`
//  can assert the options object without a browser.
// ============================================================

export const PDFJS_HARDENED = Object.freeze({
  isEvalSupported: false,
  isXfaEnabled: false,
});

// The ONLY sanctioned way to open a PDF in this codebase.
// scripts/tests/pdf-safe.test.js fails the build if a raw
// getDocument( call reappears anywhere in src/.
export const openPdf = (lib, data) => {
  if (!lib) throw new Error("pdf.js not loaded");
  return lib.getDocument({ data, ...PDFJS_HARDENED }).promise;
};
