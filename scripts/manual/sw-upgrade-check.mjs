#!/usr/bin/env node
// REAL-BROWSER service-worker upgrade check. Not part of `yarn test` (needs a
// browser and a built dist); run manually:
//     yarn build && node scripts/inject-sw-manifest.mjs && node scripts/manual/sw-upgrade-check.mjs
//
// It runs a GENUINE pre-audit v14 worker, seeds its cache with the exact thing
// the audit says leaked (a Supabase signed-URL file response), opens multiple
// tabs, then upgrades to v15 and checks what survives.
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW_PATH || "playwright");

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const DIST = join(ROOT, "dist");
const V14 = process.env.SW_V14 || "/tmp/sw-v14.js";
const LEAK_URL = "https://gmxyisjjaxtpycsmmzef.supabase.co/storage/v1/object/sign/customer-uploads/2026-09-10/resume.pdf";

if (!existsSync(join(DIST, "sw.js"))) { console.error("run yarn build + inject-sw-manifest first"); process.exit(1); }

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".webmanifest": "application/manifest+json" };
let swBody = readFileSync(V14, "utf8");            // start on the OLD worker
const HARNESS = `<!doctype html><meta charset="utf-8"><title>sw harness</title><body>ok</body>`;

const server = createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;
  const send = (code, body, type) => { res.writeHead(code, { "content-type": type, "cache-control": "no-store" }); res.end(body); };
  if (p === "/sw.js") return send(200, swBody, "text/javascript");
  if (p === "/harness.html") return send(200, HARNESS, "text/html");
  const file = join(DIST, p === "/" ? "index.html" : p.slice(1));
  if (existsSync(file) && !file.includes("..")) return send(200, readFileSync(file), MIME[extname(file)] || "application/octet-stream");
  return send(404, "nf", "text/plain");
});

const results = [];
const check = (name, pass, detail = "") => { results.push({ name, pass, detail }); console.log(`${pass ? "  PASS" : "  FAIL"}  ${name}${detail ? "  — " + detail : ""}`); };

await new Promise((r) => server.listen(0, "127.0.0.1", r));
const BASE = `http://127.0.0.1:${server.address().port}`;
console.log(`\nserving dist on ${BASE}\n`);

const browser = await chromium.launch({ executablePath: process.env.PW_EXEC || undefined });
const ctx = await browser.newContext({ baseURL: BASE });

// The ACTIVE worker's identity, taken from the cache it actually owns rather
// than from its source text. v14 writes the literal "print-app-v14"; v15
// composes CACHE_PREFIX + "v15", so a source regex for print-app-v\d+ finds
// only v14 and would mis-report a successful upgrade as a failure.
const activeVersion = (page) => page.evaluate(async () => {
  const r = await navigator.serviceWorker.ready;
  const keys = (await caches.keys()).filter((k) => k.startsWith("print-app-"));
  return (keys.sort().pop() || "none") + "|" + (r.active ? "active" : "none");
});
const cacheKeys = (page) => page.evaluate(() => caches.keys());
const leakPresent = (page, url) => page.evaluate((u) => caches.match(u).then((r) => !!r), url);

console.log("STEP 1 — install the genuine pre-audit v14 worker");
const tabA = await ctx.newPage();
await tabA.goto("/harness.html");
await tabA.evaluate(async () => { await navigator.serviceWorker.register("/sw.js"); await navigator.serviceWorker.ready; });
let keys = await cacheKeys(tabA);
check("v14 worker installs and creates its cache", keys.includes("print-app-v14"), keys.join(","));

console.log("\nSTEP 2 — seed it with the exact leak: a Supabase signed-URL file response");
await tabA.evaluate(async (u) => {
  const c = await caches.open("print-app-v14");
  await c.put(new Request(u), new Response("CUSTOMER RESUME BYTES", { headers: { "content-type": "application/pdf" } }));
}, LEAK_URL);
check("customer file response is cached under v14", await leakPresent(tabA, LEAK_URL));

console.log("\nSTEP 3 — open a SECOND tab under the same running worker");
const tabB = await ctx.newPage();
await tabB.goto("/harness.html");
await tabB.evaluate(() => navigator.serviceWorker.ready);
const ctrlB = await tabB.evaluate(() => !!navigator.serviceWorker.controller);
check("second tab is controlled by the same worker", ctrlB);
check("second tab can read the leaked file from cache (pre-upgrade)", await leakPresent(tabB, LEAK_URL));

console.log("\nSTEP 4 — deploy v15 and let the running worker upgrade");
swBody = readFileSync(join(DIST, "sw.js"), "utf8");
await tabA.evaluate(async () => {
  const r = await navigator.serviceWorker.getRegistration();
  await r.update();
  // v15 calls skipWaiting() in install and clients.claim() in activate.
  await new Promise((res) => setTimeout(res, 1200));
});
await tabA.reload();
await tabA.evaluate(() => navigator.serviceWorker.ready);
await new Promise((r) => setTimeout(r, 800));

console.log("\nSTEP 5 — what survived?");
const ver = await activeVersion(tabA);
check("the active worker owns the v15 cache (and only that)", ver.startsWith("print-app-v15|active"), ver);
keys = await cacheKeys(tabA);
check("print-app-v14 is purged", !keys.includes("print-app-v14"), keys.join(","));
check("print-app-v15 exists", keys.includes("print-app-v15"), keys.join(","));
check("TAB A: the leaked customer file is GONE from cache", !(await leakPresent(tabA, LEAK_URL)));

await tabB.reload();
await tabB.evaluate(() => navigator.serviceWorker.ready);
await new Promise((r) => setTimeout(r, 400));
check("TAB B: the leaked customer file is GONE there too", !(await leakPresent(tabB, LEAK_URL)));
const keysB = await cacheKeys(tabB);
check("TAB B: sees the same purged cache family", !keysB.includes("print-app-v14"), keysB.join(","));

console.log("\nSTEP 6 — v15 refuses to re-cache sensitive responses");
await tabA.evaluate((u) => fetch(u).catch(() => {}), LEAK_URL);
await new Promise((r) => setTimeout(r, 400));
check("a fresh Supabase fetch is NOT written to cache", !(await leakPresent(tabA, LEAK_URL)));

console.log("\nSTEP 7 — CLEAR_CACHES round-trip against the real worker");
const cleared = await tabA.evaluate(async () => {
  const r = await navigator.serviceWorker.ready;
  return await new Promise((resolve) => {
    const ch = new MessageChannel();
    const t = setTimeout(() => resolve("TIMEOUT"), 3000);
    ch.port1.onmessage = (e) => { clearTimeout(t); resolve(e.data && e.data.type); };
    r.active.postMessage({ type: "CLEAR_CACHES" }, [ch.port2]);
  });
});
check("real worker acknowledges on the transferred port", cleared === "CACHES_CLEARED", String(cleared));

await browser.close();
server.close();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
