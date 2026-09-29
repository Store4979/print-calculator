// scripts/tests/inventory-allowlist.mjs — the reviewed allowlist and the
// ever-retired list, shared by release2-inventory.test.js (the gate on the
// real tree) and release2-inventory.mutation.test.js (the same gate on mutated
// copies, so a mutant is judged by scanner PLUS allowlist, never by the
// scanner alone). Not a test file.
// Routes that have EVER been retired (a slice's stage D adds here and never
// removes). Retirement survives the deletion of both the tombstone file and
// the _retired.json entry because this list is a third, reviewed record.
export const RETIRED_EVER = Object.freeze([]);

// file | kind | name  ->  { count, slice }
// kind: table | view | bucket | rpc | channel | fn | route-builder | holds-client
export const ALLOWLIST = Object.freeze({
  // ── App.jsx: queue badge (slice 5), kiosk upload (slice 8), email (slice 6)
  "src/App.jsx|table|pending_jobs":            { count: 1, slice: "5" },
  "src/App.jsx|channel|pending_jobs_badge":    { count: 1, slice: "5" },
  "src/App.jsx|bucket|customer-uploads":       { count: 1, slice: "8" },
  "src/App.jsx|fn|start-upload":               { count: 1, slice: "8" },   // kiosk caller Part 6 missed
  "src/App.jsx|fn|register-job":               { count: 1, slice: "8" },   // kiosk caller Part 6 missed
  "src/App.jsx|fn|send-print-job":             { count: 1, slice: "6" },
  "src/App.jsx|route-builder|template":        { count: 1, slice: "8" },   // callQueueFn
  "src/App.jsx|holds-client|import supabase":  { count: 1, slice: "8" },   // last use is the kiosk upload
  // ── PrintQueue.jsx: the staff queue (slice 5)
  "src/components/PrintQueue.jsx|table|pending_jobs":           { count: 1, slice: "5" },
  "src/components/PrintQueue.jsx|channel|pending_jobs":         { count: 1, slice: "5" },
  "src/components/PrintQueue.jsx|fn|get-download-url":          { count: 2, slice: "5" },   // legacy signer
  "src/components/PrintQueue.jsx|fn|complete-job":              { count: 1, slice: "5" },   // legacy deleter
  "src/components/PrintQueue.jsx|route-builder|template":       { count: 1, slice: "5" },   // FN()
  "src/components/PrintQueue.jsx|holds-client|import supabase": { count: 1, slice: "5" },
  // ── UploadApp.jsx: the customer page (slice 8)
  "src/UploadApp.jsx|bucket|customer-uploads":      { count: 1, slice: "8" },
  "src/UploadApp.jsx|fn|start-upload":              { count: 1, slice: "8" },
  "src/UploadApp.jsx|fn|register-job":              { count: 1, slice: "8" },
  "src/UploadApp.jsx|fn|fetch-link-job":            { count: 1, slice: "8" },
  "src/UploadApp.jsx|route-builder|template":       { count: 1, slice: "8" },   // FN()
  "src/UploadApp.jsx|holds-client|import supabase": { count: 1, slice: "8" },
  // ── storeConfig.js: owner-JWT price book and store config (stays)
  "src/lib/storeConfig.js|table|stores":        { count: 5, slice: "auth-jwt" },
  "src/lib/storeConfig.js|table|paper_types":   { count: 5, slice: "auth-jwt" },
  "src/lib/storeConfig.js|table|sheet_prices":  { count: 2, slice: "auth-jwt" },
  "src/lib/storeConfig.js|table|discounts":     { count: 3, slice: "auth-jwt" },
  "src/lib/storeConfig.js|table|addons":        { count: 2, slice: "auth-jwt" },
  "src/lib/storeConfig.js|table|settings":      { count: 2, slice: "auth-jwt" },
  "src/lib/storeConfig.js|table|memberships":   { count: 1, slice: "auth-jwt" },
  "src/lib/storeConfig.js|holds-client|import supabase": { count: 1, slice: "auth-jwt" },
  // ── supabase.js: the gateway itself
  "src/lib/supabase.js|holds-client|defines the client": { count: 1, slice: "auth-jwt" },
  "src/lib/supabase.js|table|print_jobs":       { count: 3, slice: "7" },
  "src/lib/supabase.js|bucket|job-files":       { count: 4, slice: "7" },   // upload/download/signed-url/delete
  "src/lib/supabase.js|table|orders":           { count: 2, slice: "6" },   // rows 2 and 3 share the insert
  "src/lib/supabase.js|rpc|verify_employee_pin": { count: 1, slice: "4" },  // path 15, S1
  "src/lib/supabase.js|table|employees":        { count: 3, slice: "auth-jwt" },
  "src/lib/supabase.js|table|stores":           { count: 1, slice: "auth-jwt" },
  // ── raw request sites: <enclosing function>:<api>:<first-argument shape> ──
  // Every network request the bundle makes starts at one of these. Transport
  // sites carry a slice tag (the slice whose stage D removes or replaces them);
  // "asset" marks the narrow, reviewed, permanent GET exceptions.
  "src/App.jsx|request|callQueueFn:fetch:dynamic":            { count: 1, slice: "8" },   // dispatcher (kiosk upload)
  "src/App.jsx|request|sendOrderEmail:fetch:lit=/.netlify/functions/send-print-job": { count: 1, slice: "6" },
  "src/components/PrintQueue.jsx|request|callFn:fetch:dynamic":           { count: 1, slice: "5" },   // dispatcher
  "src/components/PrintQueue.jsx|request|sendToCalculator:fetch:dynamic": { count: 1, slice: "5" },   // download of a signed URL from get-download-url
  "src/UploadApp.jsx|request|callFn:fetch:dynamic":           { count: 1, slice: "8" },   // dispatcher
  // The ONLY asset exceptions, both in the asset transport (ASSET_TRANSPORT
  // below): fixed bundled paths, GET, credentials omit, redirect error —
  // enforced by the scanner, not by this comment.
  "src/lib/assetTransport.js|request|fetchBundledLogo:fetch:const=BUNDLED_LOGO":       { count: 1, slice: "asset" },
  "src/lib/assetTransport.js|request|fetchBundledPricing:fetch:const=BUNDLED_PRICING": { count: 1, slice: "asset" },
});

// ── The asset transport (review of d01b74a, N1) ─────────────────────────────
// The one file allowed to hold "asset" request sites, and for each of its
// fetching functions the string constants its URL may be. inventory-check.mjs
// holds every request site in this file to: fetch(<listed const = a same-
// origin absolute path, never /.netlify/functions/>, { method: "GET",
// credentials: "omit", redirect: "error" [, cache] }) as literals.
export const ASSET_TRANSPORT = Object.freeze({
  file: "src/lib/assetTransport.js",
  sites: Object.freeze({
    fetchBundledLogo: ["BUNDLED_LOGO"],
    fetchBundledPricing: ["BUNDLED_PRICING"],
  }),
});


// ── Request boundary (review of 8913a69, Part 1) ─────────────────────────────
// Dispatchers: the reviewed functions that turn a route NAME into a request.
// Module-private; every call must pass a statically approved route-name literal
// unless the call is listed in INTERNAL_FORWARDING (file|caller|dispatcher).
export const DISPATCHERS = Object.freeze({
  "src/App.jsx": ["callQueueFn"],
  "src/components/PrintQueue.jsx": ["callFn", "FN"],
  "src/UploadApp.jsx": ["callFn", "FN"],
});
export const INTERNAL_FORWARDING = Object.freeze([
  "src/components/PrintQueue.jsx|callFn|FN",   // callFn(name) builds its own URL
  "src/UploadApp.jsx|callFn|FN",
]);
