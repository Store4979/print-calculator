// ============================================================
//  SUPABASE CLIENT + STAFF PASSWORD GATE
//  - Reads VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY from env.
//  - The password is a client-side gate only (this is a
//    staff-only tool). It is NOT real auth — anyone with the
//    anon key + table policy can read/write directly.
// ============================================================

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL  = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON);

// Phase A: real admin auth (owner/manager sign-in) needs the session to
// persist across reloads. This is safe for the counter tool — when no one
// is signed in, requests use the anon key exactly as before, and every
// existing table policy grants both `anon` and `authenticated`, so a
// logged-in admin session does not change job/order/employee access.
export const supabase = isSupabaseConfigured
  ? createClient(SUPABASE_URL, SUPABASE_ANON, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        storageKey: "printcalc_auth_v1",
      },
    })
  : null;

// ── Staff password gate (client-side only) ─────────────────
const DB_PASSWORD = "store4979!";
const SESSION_KEY = "printcalc_db_authed_v1";

export const isDbAuthenticated = () => {
  try { return sessionStorage.getItem(SESSION_KEY) === "1"; }
  catch { return false; }
};

const setDbAuthenticated = () => {
  try { sessionStorage.setItem(SESSION_KEY, "1"); } catch {}
};

// Prompts for the password if not yet authenticated this session.
// Returns true if the caller may proceed.
export const ensureDbAuthenticated = () => {
  if (isDbAuthenticated()) return true;
  const entered = window.prompt("Enter database password:");
  if (entered === null) return false;
  if (entered === DB_PASSWORD) { setDbAuthenticated(); return true; }
  alert("Incorrect password.");
  return false;
};

// ── Job persistence ────────────────────────────────────────
export const savePrintJob = async (jobRow) => {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data, error } = await supabase
    .from("print_jobs")
    .insert(jobRow)
    .select("id, created_at")
    .single();
  if (error) throw error;
  return data;
};

export const fetchPrintJobs = async ({ limit = 200 } = {}) => {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data, error } = await supabase
    .from("print_jobs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
};

// ── Job-files storage (bucket: job-files) ───────────────────
// Files are stored under jobs/{jobId}/{filename}. The bucket is
// private; reads happen via short-lived signed URLs. Filenames
// inside a job folder are de-duplicated with a numeric suffix.
const JOB_FILES_BUCKET = "job-files";
const SIGNED_URL_TTL_S = 3600;

const safeStorageName = (name) =>
  String(name || "file")
    // Supabase storage rejects keys with characters outside a fairly
    // narrow set. Strip anything weird; keep letters/numbers/.-_()
    .replace(/[^\w.\-()+ ]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 180);

const dedupeName = (name, taken) => {
  if (!taken.has(name)) { taken.add(name); return name; }
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext  = dot > 0 ? name.slice(dot)    : "";
  for (let i = 2; i < 999; i++) {
    const candidate = `${stem}_${i}${ext}`;
    if (!taken.has(candidate)) { taken.add(candidate); return candidate; }
  }
  // give up — append a timestamp
  const fallback = `${stem}_${Date.now()}${ext}`;
  taken.add(fallback);
  return fallback;
};

// Upload a list of files into jobs/{jobId}/. `items` is an array of
// { file: File|Blob, name: string, side: string, qty?: number, rotation?: number }.
// `onProgress(done, total, label)` is invoked after each upload.
// Returns an array of records (one per item, in the same order):
//   { name, path, size, type, side, qty, rotation, error? }
export const uploadJobFiles = async (jobId, items, onProgress) => {
  if (!supabase) throw new Error("Supabase is not configured.");
  if (!jobId) throw new Error("jobId is required.");

  const taken = new Set();
  const results = [];
  const total = items.length;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const original = safeStorageName(item.name || item.file?.name || `file-${i+1}`);
    const finalName = dedupeName(original, taken);
    const path = `jobs/${jobId}/${finalName}`;

    if (typeof onProgress === "function") {
      try { onProgress(i, total, finalName); } catch {}
    }

    const { data, error } = await supabase.storage
      .from(JOB_FILES_BUCKET)
      .upload(path, item.file, {
        cacheControl: "3600",
        upsert: false,
        contentType: item.file?.type || "application/octet-stream",
      });

    if (error) {
      console.error(`uploadJobFiles: failed on ${path}:`, error);
      results.push({
        name: finalName,
        path: null,
        size: item.file?.size || 0,
        type: item.file?.type || "",
        side: item.side || "front",
        qty: Number(item.qty) || 1,
        rotation: Number(item.rotation) || 0,
        error: error.message || String(error),
      });
    } else {
      results.push({
        name: finalName,
        path: data?.path || path,
        size: item.file?.size || 0,
        type: item.file?.type || "",
        side: item.side || "front",
        qty: Number(item.qty) || 1,
        rotation: Number(item.rotation) || 0,
      });
    }
  }

  if (typeof onProgress === "function") {
    try { onProgress(total, total, ""); } catch {}
  }

  return results;
};

// Save a print_jobs row with a pre-generated id so the storage path
// (jobs/{id}/...) is known before insert. Returns the saved row.
export const savePrintJobWithId = async (jobRow) => {
  if (!supabase) throw new Error("Supabase is not configured.");
  if (!jobRow?.id) throw new Error("jobRow.id is required.");
  const { data, error } = await supabase
    .from("print_jobs")
    .insert(jobRow)
    .select("id, created_at")
    .single();
  if (error) throw error;
  return data;
};

// Download a stored file as a Blob.
export const downloadJobFile = async (path) => {
  if (!supabase) throw new Error("Supabase is not configured.");
  if (!path) throw new Error("path is required.");
  const { data, error } = await supabase.storage
    .from(JOB_FILES_BUCKET)
    .download(path);
  if (error) throw error;
  return data; // Blob
};

// Mint a short-lived signed URL — used for thumbnail previews and
// download buttons that link out to the file directly.
export const getJobFileSignedUrl = async (path, ttlSeconds = SIGNED_URL_TTL_S) => {
  if (!supabase) throw new Error("Supabase is not configured.");
  if (!path) return null;
  const { data, error } = await supabase.storage
    .from(JOB_FILES_BUCKET)
    .createSignedUrl(path, ttlSeconds);
  if (error) {
    console.warn("getJobFileSignedUrl failed for", path, error);
    return null;
  }
  return data?.signedUrl || null;
};

// Best-effort cleanup. Returns the number of paths the API confirmed
// it removed; never throws — caller can log the result.
export const deleteJobFiles = async (paths) => {
  if (!supabase) throw new Error("Supabase is not configured.");
  const list = (paths || []).filter(Boolean);
  if (!list.length) return 0;
  const { data, error } = await supabase.storage
    .from(JOB_FILES_BUCKET)
    .remove(list);
  if (error) {
    console.warn("deleteJobFiles failed:", error);
    return 0;
  }
  return data?.length || 0;
};

// ── Employees ──────────────────────────────────────────────
// PINs are 4-digit station identifiers, not security credentials.
// The schema enforces format and uniqueness; we still validate here
// so a typo on the client surfaces as a clear message instead of a
// raw Postgres error code.

const validatePin = (pin) => {
  if (!/^\d{4}$/.test(String(pin || ""))) {
    throw new Error("PIN must be exactly 4 digits.");
  }
};

// ── Store-scope resolution ─────────────────────────────────
// employees is going tenant-scoped, so every employee call needs a
// store_id. storeProfile starts as the OFFLINE FALLBACK CONSTANT, which
// has no id, so callers cannot rely on it being present — we resolve from
// the stores table by slug and cache it. Read directly from import.meta.env
// rather than importing storeConfig.js, which would be a circular import
// (storeConfig imports this module).
let _storeScopeCache = null;

// Distinguishable so callers can tell "store unknown" (infrastructure) from
// "wrong PIN" (authentication). The kiosk exit path depends on this
// distinction to avoid locking staff out of the tablet.
export class StoreUnavailableError extends Error {
  // Copy matters operationally: staff PIN login now depends on store config
  // loading, which is a NEW open-of-day failure mode. If this reads like a
  // rejected PIN, staff will retype a correct PIN over and over. It must
  // name the real cause and point at the connection.
  constructor(msg = "Store configuration not loaded — check the connection and try again.") {
    super(msg);
    this.name = "StoreUnavailableError";
  }
}

export const resolveStoreScope = async (hint = null) => {
  if (hint?.storeId) return hint;
  if (_storeScopeCache) return _storeScopeCache;
  if (!supabase) throw new StoreUnavailableError("Supabase is not configured.");
  const slug = (import.meta.env.VITE_STORE_SLUG || "store4979").trim();
  const { data, error } = await supabase
    .from("stores").select("id, org_id").eq("slug", slug).maybeSingle();
  if (error || !data?.id) throw new StoreUnavailableError();
  _storeScopeCache = { storeId: data.id, orgId: data.org_id || null };
  return _storeScopeCache;
};

// After 03b, employee writes are RLS-scoped to an authenticated owner/manager.
// RLS does NOT raise on an UPDATE/DELETE that matches no rows — it filters
// them to zero (proven: anon UPDATE/DELETE => rows_affected=0, no error,
// while anon INSERT => 42501). So "no error" must never be read as "it saved".
//
// Every write below asks PostgREST to return the affected row and treats an
// empty result as failure. PGRST116 is what .single() yields when RLS filtered
// the row out; surfacing the raw code ("JSON object requested, multiple (or no)
// rows returned") tells staff nothing, so it is mapped to the likely cause.
const RLS_WRITE_FAILED =
  "Change didn't save — your admin session may have expired. Sign in again and retry.";

export const listEmployees = async ({ includeInactive = false } = {}) => {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { storeId } = await resolveStoreScope();
  let q = supabase.from("employees").select("*")
    .eq("store_id", storeId)
    .order("name", { ascending: true });
  if (!includeInactive) q = q.eq("active", true);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
};

export const createEmployee = async ({ name, pin }) => {
  if (!supabase) throw new Error("Supabase is not configured.");
  if (!name || !name.trim()) throw new Error("Name is required.");
  validatePin(pin);
  // Must stamp the tenant keys: once 03b lands, the INSERT policy is
  // has_store_role(store_id, …) and an unstamped row is rejected outright.
  const { storeId, orgId } = await resolveStoreScope();
  const { data, error } = await supabase
    .from("employees")
    .insert({ name: name.trim(), pin: String(pin), store_id: storeId, org_id: orgId })
    .select("*")
    .single();
  if (error) {
    if (error.code === "23505")   throw new Error("That PIN is already taken.");
    if (error.code === "PGRST116") throw new Error(RLS_WRITE_FAILED);
    if (error.code === "42501")    throw new Error(RLS_WRITE_FAILED);
    throw error;
  }
  // Belt-and-braces: no row back means nothing was written, regardless of
  // whether PostgREST chose to signal it as an error.
  if (!data) throw new Error(RLS_WRITE_FAILED);
  return data;
};

export const updateEmployee = async (id, patch) => {
  if (!supabase) throw new Error("Supabase is not configured.");
  if (patch.pin != null) validatePin(patch.pin);
  if (patch.name != null && !String(patch.name).trim()) throw new Error("Name is required.");
  const { data, error } = await supabase
    .from("employees")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();
  if (error) {
    if (error.code === "23505")   throw new Error("That PIN is already taken.");
    // RLS filtered the row out — the update matched nothing. Without this the
    // staffer sees a raw PostgREST code and cannot tell that the real problem
    // is an expired admin session.
    if (error.code === "PGRST116") throw new Error(RLS_WRITE_FAILED);
    if (error.code === "42501")    throw new Error(RLS_WRITE_FAILED);
    throw error;
  }
  if (!data) throw new Error(RLS_WRITE_FAILED);
  return data;
};

// Deactivate/reactivate routes through updateEmployee, so it inherits the
// affected-row verification above — a no-op deactivate can never present as
// success.
export const setEmployeeActive = async (id, active) =>
  updateEmployee(id, { active: !!active });

// Goes through the store-scoped SECURITY DEFINER RPC instead of reading the
// employees table, so the table can be closed to anon entirely (migration
// 03b). The RPC returns id/name/active only — the pin never leaves Postgres.
//
// Throws StoreUnavailableError when the store can't be resolved, so callers
// can distinguish infrastructure failure from a bad PIN.
export const findEmployeeByPin = async (pin, hint = null) => {
  if (!supabase) throw new StoreUnavailableError("Supabase is not configured.");
  validatePin(pin);
  const { storeId } = await resolveStoreScope(hint);
  const { data, error } = await supabase.rpc("verify_employee_pin", {
    p_store_id: storeId,
    p_pin: String(pin),
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row || null;
};

// ── Orders ─────────────────────────────────────────────────
// One row per saved order, in public.orders — formerly `transactions`,
// renamed in Phase D1 when the incentive layer was removed. Order history
// was never incentive data; only those columns went.
// Throws on failure so the caller can route the row through the offline
// queue (src/lib/orderQueue.js).
export const insertOrder = async (row) => {
  if (!supabase) throw new Error("Supabase is not configured.");
  // Stamp the tenant keys — the Phase B columns that were never populated
  // on this table. Best-effort on purpose: an order must never fail to save
  // because the store lookup did, so fall back to an unstamped row.
  let scope = null;
  try { scope = await resolveStoreScope(); } catch { scope = null; }
  const payload = { ...row };
  if (scope?.storeId && payload.store_id == null) payload.store_id = scope.storeId;
  if (scope?.orgId   && payload.org_id   == null) payload.org_id   = scope.orgId;
  const { data, error } = await supabase
    .from("orders")
    .insert(payload)
    .select("id, created_at")
    .single();
  if (error) throw error;
  return data;
};

export const fetchOrders = async ({
  from = null, to = null, employeeId = null, limit = 1000,
} = {}) => {
  if (!supabase) throw new Error("Supabase is not configured.");
  let q = supabase.from("orders").select("*").order("created_at", { ascending: false }).limit(limit);
  if (from)        q = q.gte("created_at", from);
  if (to)          q = q.lte("created_at", to);
  if (employeeId)  q = q.eq("employee_id", employeeId);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
};

// ── Logged-in employee (localStorage) ──────────────────────
// Stored alongside the rest of the app's localStorage state. Cleared
// when the user clicks "Switch User" or logs out.
const CURRENT_EMPLOYEE_KEY = "currentEmployee";

export const getStoredEmployee = () => {
  try {
    const raw = localStorage.getItem(CURRENT_EMPLOYEE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
};

export const setStoredEmployee = (emp) => {
  try {
    if (emp) localStorage.setItem(CURRENT_EMPLOYEE_KEY, JSON.stringify(emp));
    else     localStorage.removeItem(CURRENT_EMPLOYEE_KEY);
  } catch {}
};
