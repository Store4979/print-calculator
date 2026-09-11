#!/usr/bin/env node
// REAL-BROWSER service-worker upgrade check. Not part of `yarn test` (needs a
// browser and a built dist); run manually:
//   yarn build && node scripts/inject-sw-manifest.mjs && node scripts/manual/sw-upgrade-check.mjs
//
// Two scenarios, both with a GENUINELY RUNNING old worker and two tabs:
//   A. pre-audit v14      -> corrected   (what production will do)
//   B. FLAWED rev-1 v15   -> corrected   (what a preview browser will do)
//
// Scenario B exists because the first corrected worker reused the name v15, so
// activate() preserved the very cache the flawed worker had poisoned. Only a
// generation bump evicts it, and that is only provable by running it.
//
// The "sensitive responses are not cached" check uses endpoints this server
// returns a REAL 200 for. An earlier revision fetched a Supabase URL that could
// not resolve and swallowed the error — cache-absence then proved nothing,
// because a request that never succeeded was never a candidate for caching.
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW_PATH || "playwright");

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const DIST = join(ROOT, "dist");
const LEAK_PATH = "/leaked-customer-file.pdf";   // stands in for a signed-URL file response

if (!existsSync(join(DIST, "sw.js"))) { console.error("run yarn build + inject-sw-manifest first"); process.exit(1); }
const V16 = readFileSync(join(DIST, "sw.js"), "utf8");
const gen = (src) => (src.match(/CACHE_PREFIX \+ "(v\d+)"/) || src.match(/CACHE = "print-app-(v\d+)"/) || ["", "?"])[1];

// The two old workers come straight out of git, so this always tests the real
// historical code rather than a hand-written approximation.
const fromGit = (rev) => execFileSync("git", ["show", `${rev}:public/sw.js`], { cwd: ROOT, encoding: "utf8" });
const OLD = {
  A: { label: "pre-audit v14 (production)", src: fromGit("main") },
  B: { label: "FLAWED rev-1 v15 (preview)", src: fromGit("7a7ac41") },
};

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".webmanifest": "application/manifest+json" };
let swBody = "";
const HARNESS = `<!doctype html><meta charset="utf-8"><title>sw harness</title><body>ok</body>`;

const server = createServer((req, res) => {
  const p = new URL(req.url, "http://x").pathname;
  const send = (code, body, type) => { res.writeHead(code, { "content-type": type, "cache-control": "no-store" }); res.end(body); };
  if (p === "/sw.js") return send(200, swBody, "text/javascript");
  if (p === "/harness.html") return send(200, HARNESS, "text/html");
  // Sensitive-shaped endpoints that genuinely return 200, so "not cached" is a
  // real result rather than an artefact of a failed request.
  if (p === "/pricing.json") return send(200, '{"sheetPricing":{"28lb":{}}}', "application/json");
  if (p.startsWith("/.netlify/functions/")) return send(200, '{"ok":true,"fn":"probe"}', "application/json");
  if (p === LEAK_PATH) return send(200, "CUSTOMER RESUME BYTES", "application/pdf");
  const file = join(DIST, p === "/" ? "index.html" : p.slice(1));
  if (existsSync(file) && !file.includes("..")) return send(200, readFileSync(file), MIME[extname(file)] || "application/octet-stream");
  return send(404, "nf", "text/plain");
});

const results = [];
const check = (name, pass, detail = "") => { results.push({ name, pass }); console.log(`${pass ? "  PASS" : "  FAIL"}  ${name}${detail ? "  — " + detail : ""}`); };

await new Promise((r) => server.listen(0, "127.0.0.1", r));
const BASE = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.PW_EXEC || undefined });

const ourCaches = (page) => page.evaluate(() => caches.keys().then((k) => k.filter((n) => n.startsWith("print-app-"))));
const cached = (page, url) => page.evaluate((u) => caches.match(u).then((r) => !!r), url);

async function runScenario(key) {
  const old = OLD[key];
  const oldGen = gen(old.src);
  console.log(`\n${"=".repeat(72)}\nSCENARIO ${key}: ${old.label}  ${oldGen} -> ${gen(V16)}\n${"=".repeat(72)}`);

  swBody = old.src;
  const ctx = await browser.newContext({ baseURL: BASE });   // fresh origin storage
  const tabA = await ctx.newPage();
  await tabA.goto("/harness.html");
  await tabA.evaluate(async () => { await navigator.serviceWorker.register("/sw.js"); await navigator.serviceWorker.ready; });
  check(`[${key}] ${oldGen} worker installs`, (await ourCaches(tabA)).includes(`print-app-${oldGen}`), (await ourCaches(tabA)).join(","));

  // Poison exactly the way each old worker could: A cached a customer file
  // response; B additionally stored a JSON body as the app shell.
  await tabA.evaluate(async ([g, leak]) => {
    const c = await caches.open(`print-app-${g}`);
    await c.put(new Request(leak), new Response("CUSTOMER RESUME BYTES", { headers: { "content-type": "application/pdf" } }));
    await c.put("/index.html", new Response('{"sheetPricing":{}}', { headers: { "content-type": "application/json" } }));
  }, [oldGen, LEAK_PATH]);
  check(`[${key}] customer file cached under ${oldGen}`, await cached(tabA, LEAK_PATH));
  const poisoned = await tabA.evaluate(() => caches.match("/index.html").then((r) => r && r.text()));
  check(`[${key}] app shell is poisoned with JSON`, /sheetPricing/.test(poisoned || ""), (poisoned || "").slice(0, 30));

  const tabB = await ctx.newPage();
  await tabB.goto("/harness.html");
  await tabB.evaluate(() => navigator.serviceWorker.ready);
  check(`[${key}] second tab shares the running worker`, await tabB.evaluate(() => !!navigator.serviceWorker.controller));
  check(`[${key}] second tab can read the leak pre-upgrade`, await cached(tabB, LEAK_PATH));

  // ── upgrade ──
  swBody = V16;
  await tabA.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); await r.update(); });
  await new Promise((r) => setTimeout(r, 1200));
  await tabA.reload();
  await tabA.evaluate(() => navigator.serviceWorker.ready);
  await new Promise((r) => setTimeout(r, 800));

  const after = await ourCaches(tabA);
  check(`[${key}] ${oldGen} is evicted`, !after.includes(`print-app-${oldGen}`), after.join(","));
  check(`[${key}] ${gen(V16)} is the only generation`, after.length === 1 && after[0] === `print-app-${gen(V16)}`, after.join(","));
  check(`[${key}] TAB A: leaked file gone`, !(await cached(tabA, LEAK_PATH)));
  const shellAfter = await tabA.evaluate(() => caches.match("/index.html").then((r) => (r ? r.text() : "(absent)")));
  check(`[${key}] TAB A: poisoned shell gone`, !/sheetPricing/.test(shellAfter || ""), (shellAfter || "").slice(0, 30));

  await tabB.reload();
  await tabB.evaluate(() => navigator.serviceWorker.ready);
  await new Promise((r) => setTimeout(r, 400));
  check(`[${key}] TAB B: leaked file gone there too`, !(await cached(tabB, LEAK_PATH)));
  check(`[${key}] TAB B: sees the same single generation`, (await ourCaches(tabB)).join(",") === `print-app-${gen(V16)}`);

  // ── sensitive responses that genuinely return 200 must still not be cached ──
  for (const [label, path] of [["store config", "/pricing.json"], ["function output", "/.netlify/functions/probe"]]) {
    const status = await tabA.evaluate(async (u) => { const r = await fetch(u); await r.text(); return r.status; }, path);
    check(`[${key}] ${label} returns a REAL 200 (so the next check means something)`, status === 200, "status " + status);
    check(`[${key}] ${label} 200 is NOT written to cache`, !(await cached(tabA, path)));
  }

  const ack = await tabA.evaluate(async () => {
    const r = await navigator.serviceWorker.ready;
    return await new Promise((resolve) => {
      const ch = new MessageChannel();
      const t = setTimeout(() => resolve("TIMEOUT"), 3000);
      ch.port1.onmessage = (e) => { clearTimeout(t); resolve(e.data && e.data.type); };
      r.active.postMessage({ type: "CLEAR_CACHES" }, [ch.port2]);
    });
  });
  check(`[${key}] worker acknowledges CLEAR_CACHES on the transferred port`, ack === "CACHES_CLEARED", String(ack));

  await ctx.close();
}

await runScenario("A");
await runScenario("B");

await browser.close();
server.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
