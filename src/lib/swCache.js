// ============================================================
//  SERVICE-WORKER CACHE CONTROL
//
//  public/sw.js is allowlist-only, so the cache should never hold anything
//  user-specific. This is the belt-and-braces guarantee on top of that: when
//  an admin signs out or staff hand the counter iPad to the next person, we
//  ask the worker to drop every cache and re-prime the shell.
//
//  Never throws and never blocks sign-out. A worker that is missing, not yet
//  activated, or slow to answer resolves false after a short timeout — the
//  caller carries on either way.
// ============================================================

const REPLY_TIMEOUT_MS = 1500;

export const clearAppCaches = async () => {
  try {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return false;

    // ready resolves once a worker is active; without this, a freshly loaded
    // page can have a null controller and the message goes nowhere.
    const reg = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise((r) => setTimeout(() => r(null), REPLY_TIMEOUT_MS)),
    ]);
    const worker = reg?.active || navigator.serviceWorker.controller;
    if (!worker) return false;

    return await new Promise((resolve) => {
      const channel = new MessageChannel();
      const done = (v) => { clearTimeout(timer); channel.port1.onmessage = null; resolve(v); };
      const timer = setTimeout(() => done(false), REPLY_TIMEOUT_MS);
      channel.port1.onmessage = (e) => done(e.data?.type === "CACHES_CLEARED");
      worker.postMessage({ type: "CLEAR_CACHES" }, [channel.port2]);
    });
  } catch {
    return false;
  }
};
