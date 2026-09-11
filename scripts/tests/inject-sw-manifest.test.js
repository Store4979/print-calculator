// The deploy-time manifest injector, driven through the REAL script as a
// subprocess against real fixture directories. Every case here is one the
// injector previously got wrong or was never asked.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const SCRIPT = fileURLToPath(new URL("../inject-sw-manifest.mjs", import.meta.url));
const MARKER = "/*__BUILD_ASSETS__*/";

const swWith = (body) => `const CACHE = "print-app-v16";\nconst BUILD_ASSETS = [${body}];\n`;
const html = (refs) => `<!doctype html><html><head>${refs.map((r) => `<script type="module" src="${r}"></script>`).join("")}</head><body></body></html>`;

/** Build a throwaway dist/ and run the real injector against it. */
const run = ({ sw, entry = {}, assets = [] }) => {
  const dist = mkdtempSync(join(tmpdir(), "swinj-"));
  mkdirSync(join(dist, "assets"), { recursive: true });
  writeFileSync(join(dist, "sw.js"), sw);
  for (const [name, refs] of Object.entries(entry)) writeFileSync(join(dist, name), html(refs));
  for (const a of assets) writeFileSync(join(dist, a.replace(/^\//, "")), "// built\n");
  let status = 0, out = "";
  try {
    out = execFileSync(process.execPath, [SCRIPT], { env: { ...process.env, SW_MANIFEST_DIST: dist }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    status = e.status ?? 1;
    out = (e.stdout || "") + (e.stderr || "");
  }
  const swAfter = readFileSync(join(dist, "sw.js"), "utf8");
  rmSync(dist, { recursive: true, force: true });
  return { status, out, swAfter };
};

// ── FIXTURE 1: query-bearing reference must be REJECTED, not normalised ──

test("FIXTURE 1: an entry reference carrying a query string is rejected", () => {
  const r = run({
    sw: swWith(MARKER),
    entry: { "index.html": ["/assets/app-abc123.js?v=2"] },
    assets: ["/assets/app-abc123.js"],
  });
  assert.equal(r.status, 1, "must fail — stripping the query would let this pass");
  assert.match(r.out, /query string/i);
  assert.match(r.out, /app-abc123\.js\?v=2/);
  assert.match(r.out, /never caches it|never cacheable/i, "must explain the sw.js mismatch");
});

test("FIXTURE 1 control: the same reference without a query passes", () => {
  const r = run({
    sw: swWith(MARKER),
    entry: { "index.html": ["/assets/app-abc123.js"] },
    assets: ["/assets/app-abc123.js"],
  });
  assert.equal(r.status, 0, r.out);
  assert.match(r.swAfter, /"\/assets\/app-abc123\.js"/);
});

// ── FIXTURE 2: the already-injected path must VALIDATE, not skip ──

test("FIXTURE 2: a repeat run with a missing asset fails instead of silently passing", () => {
  const r = run({
    // Already injected — the path that previously exited 0 before validating.
    sw: swWith('\n  "/assets/old-hash.js",\n'),
    entry: { "index.html": ["/assets/new-hash.js"] },
    assets: ["/assets/new-hash.js"],
  });
  assert.equal(r.status, 1, "a repeat run must still validate");
  assert.match(r.out, /already-injected/, "and must say which path it took");
  assert.match(r.out, /MISSING {2}\/assets\/new-hash\.js/);
});

test("FIXTURE 3: a valid unchanged repeat still succeeds — after validating", () => {
  const r = run({
    sw: swWith('\n  "/assets/app-abc123.js",\n'),
    entry: { "index.html": ["/assets/app-abc123.js"] },
    assets: ["/assets/app-abc123.js"],
  });
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /already-injected/);
  assert.match(r.out, /validated: 1 asset/, "success must come THROUGH validation, not around it");
  assert.match(r.swAfter, /"\/assets\/app-abc123\.js"/, "and must not be rewritten");
});

test("CASE C: a missing asset on a FRESH dist fails (control for the repeat-path case)", () => {
  // The counterpart to CASE B. Both must fail, for the same reason, by the
  // same check — which is the point of running one validation on both paths.
  // Without this control, B passing would not tell you whether the check works
  // or only whether the repeat path reaches it.
  const r = run({
    sw: swWith(MARKER),                                   // fresh: marker present
    entry: { "index.html": ["/assets/referenced.js"] },
    assets: [],                                           // nothing on disk to enumerate
  });
  assert.equal(r.status, 1, "a fresh build missing a referenced asset must fail");
  assert.match(r.out, /\(injected\)/, "and must report the FRESH path, not the repeat path");
  assert.match(r.out, /MISSING {2}\/assets\/referenced\.js/);
  assert.match(r.swAfter, /\/\*__BUILD_ASSETS__\*\//, "a failed run must not mutate dist/sw.js");
});

test("FIXTURE 2b: a query-bearing reference is caught on the repeat path too", () => {
  const r = run({
    sw: swWith('\n  "/assets/app-abc123.js",\n'),
    entry: { "index.html": ["/assets/app-abc123.js?v=2"] },
    assets: ["/assets/app-abc123.js"],
  });
  assert.equal(r.status, 1, "both paths run the same checks");
  assert.match(r.out, /query string/i);
});

// ── surrounding behaviour ──

test("a fresh injection lists every eligible asset on disk", () => {
  const r = run({
    sw: swWith(MARKER),
    entry: { "index.html": ["/assets/a.js"], "upload.html": ["/assets/b.css"] },
    assets: ["/assets/a.js", "/assets/b.css", "/assets/lazy.js"],
  });
  assert.equal(r.status, 0, r.out);
  for (const a of ["a.js", "b.css", "lazy.js"]) assert.match(r.swAfter, new RegExp(`"/assets/${a}"`));
  assert.match(r.out, /not-in-html.*lazy\.js/, "a lazy chunk is reported, not treated as an error");
});

test("neither marker nor manifest is a hard failure", () => {
  const r = run({ sw: "// this did not come from public/sw.js\n", entry: { "index.html": [] } });
  assert.equal(r.status, 1);
  assert.match(r.out, /neither the marker nor a manifest/);
});

test("the scope claim is stated precisely, not overclaimed", () => {
  const r = run({ sw: swWith(MARKER), entry: { "index.html": ["/assets/a.js"] }, assets: ["/assets/a.js"] });
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /entry-point HTML asset references only/, "must not claim to cover everything the app requests");
  assert.match(r.out, /JS imports, dynamically constructed URLs and runtime fetches are NOT covered/);
  assert.equal(/what the built app actually requests/i.test(r.out), false, "the overclaim must be gone");
});
