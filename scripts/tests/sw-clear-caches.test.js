// The CLEAR_CACHES handler in sw.js is only worth having if something calls
// it. This asserts the wiring, not just the implementation.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

test("sw.js implements the CLEAR_CACHES message handler", () => {
  const sw = read("public/sw.js");
  assert.match(sw, /addEventListener\("message"/);
  assert.match(sw, /CLEAR_CACHES/);
  assert.match(sw, /CACHES_CLEARED/, "must acknowledge so the caller can await it");
});

test("clearAppCaches posts exactly that message and never throws", async () => {
  const { clearAppCaches } = await import("../../src/lib/swCache.js");
  const posted = [];
  const realNav = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const setNav = (v) => Object.defineProperty(globalThis, "navigator", { value: v, configurable: true, writable: true });
  setNav({
    serviceWorker: {
      // The worker receives [port2] and replies on it; the stubbed
      // MessageChannel routes that back to port1.onmessage, which is what
      // clearAppCaches() is listening on.
      ready: Promise.resolve({ active: { postMessage: (msg, ports) => {
        posted.push(msg);
        setTimeout(() => ports[0].postMessage({ type: "CACHES_CLEARED" }), 0);
      } } }),
      controller: null,
    },
  });
  globalThis.MessageChannel = class {
    constructor() {
      const p1 = { onmessage: null };
      const p2 = { postMessage: (d) => p1.onmessage && p1.onmessage({ data: d }) };
      this.port1 = p1; this.port2 = p2;
    }
  };
  const ok = await clearAppCaches();
  assert.deepEqual(posted, [{ type: "CLEAR_CACHES" }]);
  assert.equal(ok, true);

  // No service worker at all: resolves false, does not throw, never blocks sign-out.
  setNav({});
  assert.equal(await clearAppCaches(), false);
  if (realNav) Object.defineProperty(globalThis, "navigator", realNav); else delete globalThis.navigator;
  delete globalThis.MessageChannel;
});

test("it is WIRED: both handover paths call it", () => {
  const app = read("src/App.jsx");
  assert.match(app, /import \{ clearAppCaches \}/, "imported");

  const grab = (decl) => {
    const i = app.indexOf(decl);
    assert.ok(i > 0, `${decl} not found`);
    return app.slice(i, app.indexOf("\n  };", i));
  };
  assert.match(grab("const handleAdminSignOut"), /clearAppCaches\(\)/, "admin sign-out must purge caches");
  assert.match(grab("const switchEmployee"), /clearAppCaches\(\)/, "counter handover must purge caches");
});
