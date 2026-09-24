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
});

