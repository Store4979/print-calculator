// Harness that runs the REAL public/sw.js and hands back its real listeners.
//
// Rev 1's tests reached into the script's scope and called the helper
// predicates directly. That is how the navigation cache-poisoning bug
// survived review: the helper said "no", and the fetch listener never asked
// it. These tests dispatch events at the actual listeners instead, and assert
// on what actually lands in the cache.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

export const SW_SOURCE = readFileSync(
  fileURLToPath(new URL("../../public/sw.js", import.meta.url)), "utf8");

export const ORIGIN = "https://printcalculator2.netlify.app";
export const SB = "https://gmxyisjjaxtpycsmmzef.supabase.co";

/** Minimal but faithful CacheStorage: records exactly what was stored. */
export const makeCaches = () => {
  const stores = new Map();
  const cacheFor = (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const m = stores.get(name);
    const keyOf = (r) => (typeof r === "string" ? r : r.url);
    return {
      add: async (u) => { m.set(u, { body: "<added>", added: true }); },
      put: async (req, res) => { m.set(keyOf(req), res); },
      match: async (req) => m.get(keyOf(req)),
    };
  };
  return {
    _stores: stores,
    entries: (name) => [...(stores.get(name) || new Map()).entries()],
    keysOf: (name) => [...(stores.get(name) || new Map()).keys()],
    seed: (name, key, val) => { cacheFor(name); stores.get(name).set(key, val); },
    open: async (n) => cacheFor(n),
    keys: async () => [...stores.keys()],
    delete: async (n) => stores.delete(n),
    match: async (req, opts) => {
      const key = typeof req === "string" ? req : req.url;
      if (opts && opts.cacheName) {
        const m = stores.get(opts.cacheName);
        return m ? m.get(key) : undefined;
      }
      for (const m of stores.values()) if (m.has(key)) return m.get(key);
      return undefined;
    },
  };
};

export const mkRes = (o = {}) => ({
  ok: o.ok !== false,
  status: o.status ?? 200,
  type: o.type ?? "basic",
  redirected: !!o.redirected,
  body: o.body ?? "<body>",
  headers: { get: (h) => (h.toLowerCase() === "content-type" ? (o.contentType ?? "text/html; charset=utf-8") : null) },
  clone() { return { ...this, clone: this.clone }; },
});

export const mkReq = (url, o = {}) => ({
  url,
  method: o.method || "GET",
  mode: o.mode || "no-cors",
  cache: o.cache || "default",
  headers: { has: (h) => Object.prototype.hasOwnProperty.call(o.headers || {}, String(h).toLowerCase()) },
});

/**
 * Load sw.js into a sandbox.
 * `assets` mirrors what scripts/inject-sw-manifest.mjs writes at deploy time,
 * so the marker mechanism itself is under test too.
 */
export const loadSW = ({ assets = [], fetchImpl } = {}) => {
  const listeners = {};
  const caches = makeCaches();
  const waits = [];
  const source = SW_SOURCE.replace(
    "/*__BUILD_ASSETS__*/",
    assets.map((a) => `\n  ${JSON.stringify(a)},`).join("") + (assets.length ? "\n" : ""));

  const ctx = vm.createContext({
    self: {
      addEventListener: (k, fn) => { listeners[k] = fn; },
      location: { origin: ORIGIN },
      skipWaiting: () => {},
      clients: { claim: async () => {} },
    },
    caches,
    fetch: fetchImpl || (async () => mkRes()),
    Response: class {
      constructor(body, init = {}) { this.body = body; Object.assign(this, init); this.ok = false; }
      static error() { return { __networkError: true }; }
    },
    URL, console: { log() {}, warn() {}, error() {} },
  });
  vm.runInContext(source, ctx);

  const dispatchFetch = async (req) => {
    let promise = null;
    listeners.fetch({ request: req, respondWith: (p) => { promise = p; } });
    if (!promise) return { intercepted: false, response: null };
    return { intercepted: true, response: await promise };
  };

  const dispatchMessage = async (data, ports = [], source = null) => {
    const done = [];
    listeners.message({ data, ports, source, waitUntil: (p) => done.push(p) });
    await Promise.all(done);
  };

  const dispatchActivate = async () => {
    const done = [];
    listeners.activate({ waitUntil: (p) => done.push(p) });
    await Promise.all(done);
  };

  const dispatchInstall = async () => {
    const done = [];
    listeners.install({ waitUntil: (p) => done.push(p) });
    await Promise.all(done);
  };

  // Cache writes are fire-and-forget inside the listener; give them a turn.
  const settle = () => new Promise((r) => setTimeout(r, 0));

  return { listeners, caches, waits, dispatchFetch, dispatchMessage, dispatchActivate, dispatchInstall, settle, ctx };
};
