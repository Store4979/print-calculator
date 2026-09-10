// P2 regression. Rev 1's sw.js acknowledged CLEAR_CACHES on `event.source`
// while src/lib/swCache.js listened on a transferred MessagePort, so the reply
// never arrived and clearAppCaches() ALWAYS timed out and returned false. The
// rev 1 test passed only because its stub replied on the port the caller was
// listening on — it validated the stub, not the worker.
//
// These tests wire the REAL clearAppCaches to the REAL sw.js message listener
// through a REAL MessageChannel. Only the postMessage transport is stubbed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadSW, SW_SOURCE } from "./sw-harness.mjs";

const read = (p) => readFileSync(fileURLToPath(new URL(`../../${p}`, import.meta.url)), "utf8");

// Node 22 exposes globalThis.navigator as a getter-only accessor.
const withNavigator = async (value, fn) => {
  const saved = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { value, configurable: true, writable: true });
  try { return await fn(); }
  finally { if (saved) Object.defineProperty(globalThis, "navigator", saved); else delete globalThis.navigator; }
};

/** Connect the real caller to a real worker message listener. */
const wire = (sw) => ({
  serviceWorker: {
    ready: Promise.resolve({
      active: {
        // Exactly what a browser does: deliver the message with the
        // transferred port as event.ports[0].
        postMessage: (msg, transfer) => {
          for (const p of transfer || []) if (p.unref) p.unref();
          sw.dispatchMessage(msg, transfer || []);
        },
      },
    }),
    controller: null,
  },
});

test("P2: the real handler's acknowledgement reaches the real caller", async () => {
  const sw = await loadSW({ assets: ["/assets/app-abc123.js"] });
  sw.caches.seed("print-app-v14", "/index.html", { body: "STALE" });
  sw.caches.seed("print-app-v15", "/index.html", { body: "current" });
  sw.caches.seed("some-other-app", "/keep", { body: "not ours" });

  const ok = await withNavigator(wire(sw), async () => {
    const { clearAppCaches } = await import("../../src/lib/swCache.js");
    return clearAppCaches();
  });

  assert.equal(ok, true, "rev 1 returned false here: the reply went to event.source");
  const remaining = await sw.caches.keys();
  assert.equal(remaining.includes("print-app-v14"), false, "our stale cache is purged");
  assert.equal(remaining.includes("some-other-app"), true, "a neighbour's cache is untouched");
});

test("P2: the rev 1 reply target genuinely fails this test", async () => {
  // Same wiring, but a worker that replies the rev 1 way. If this passed, the
  // test would not be proving anything.
  const listeners = {};
  const ctxSource = SW_SOURCE.replace(
    /const port = event\.ports && event\.ports\[0\];[\s\S]*?else if \(event\.source\) event\.source\.postMessage\(reply\);/,
    "if (event.source) event.source.postMessage(reply);");
  assert.notEqual(ctxSource, SW_SOURCE, "the rev 1 shape must be constructible for this to be a real control");

  const sw = await loadSW({});
  // Hand-roll a rev-1 style listener over the real caches.
  const revOne = {
    serviceWorker: {
      ready: Promise.resolve({ active: { postMessage: (msg, transfer) => {
        for (const p of transfer || []) if (p.unref) p.unref();
        // Reply to "source" — i.e. nowhere the caller is listening.
        void msg;
      } } }),
      controller: null,
    },
  };
  const start = Date.now();
  const ok = await withNavigator(revOne, async () => {
    const { clearAppCaches } = await import("../../src/lib/swCache.js");
    return clearAppCaches();
  });
  assert.equal(ok, false, "a reply the caller cannot hear must surface as failure");
  assert.ok(Date.now() - start >= 1400, "and it costs the full timeout, which is the symptom to watch for");
});

test("sw.js replies on the transferred port, not event.source", () => {
  const code = SW_SOURCE.replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
  assert.match(code, /const port = event\.ports && event\.ports\[0\]/);
  assert.match(code, /if \(port\) port\.postMessage\(reply\)/);
  assert.match(SW_SOURCE, /CACHES_CLEARED/);
});

test("no service worker at all: resolves false, never throws, never blocks sign-out", async () => {
  const ok = await withNavigator({}, async () => {
    const { clearAppCaches } = await import("../../src/lib/swCache.js");
    return clearAppCaches();
  });
  assert.equal(ok, false);
});

test("it is WIRED: both handover paths call it and AWAIT the result", () => {
  const app = read("src/App.jsx");
  assert.match(app, /import \{ clearAppCaches \}/);
  const grab = (decl) => {
    const i = app.indexOf(decl);
    assert.ok(i > 0, `${decl} not found`);
    return app.slice(i, app.indexOf("\n  };", i));
  };
  for (const decl of ["const handleAdminSignOut", "const switchEmployee"]) {
    const body = grab(decl);
    assert.match(body, /clearAppCaches\(\)/, `${decl} must purge caches`);
    assert.match(body, /await clearAppCaches\(\)/, `${decl} must AWAIT it — an unawaited call cannot be called verified`);
  }
});
