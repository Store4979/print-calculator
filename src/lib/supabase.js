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

export const supabase = isSupabaseConfigured
  ? createClient(SUPABASE_URL, SUPABASE_ANON, {
      auth: { persistSession: false, autoRefreshToken: false },
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

export const listEmployees = async ({ includeInactive = false } = {}) => {
  if (!supabase) throw new Error("Supabase is not configured.");
  let q = supabase.from("employees").select("*").order("name", { ascending: true });
  if (!includeInactive) q = q.eq("active", true);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
};

export const createEmployee = async ({ name, pin }) => {
  if (!supabase) throw new Error("Supabase is not configured.");
  if (!name || !name.trim()) throw new Error("Name is required.");
  validatePin(pin);
  const { data, error } = await supabase
    .from("employees")
    .insert({ name: name.trim(), pin: String(pin) })
    .select("*")
    .single();
  if (error) {
    if (error.code === "23505") throw new Error("That PIN is already taken.");
    throw error;
  }
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
    if (error.code === "23505") throw new Error("That PIN is already taken.");
    throw error;
  }
  return data;
};

export const setEmployeeActive = async (id, active) =>
  updateEmployee(id, { active: !!active });

export const findEmployeeByPin = async (pin) => {
  if (!supabase) throw new Error("Supabase is not configured.");
  validatePin(pin);
  const { data, error } = await supabase
    .from("employees")
    .select("*")
    .eq("pin", String(pin))
    .eq("active", true)
    .maybeSingle();
  if (error) throw error;
  return data || null;
};

// ── Commission settings ────────────────────────────────────
// Singleton row. The migration seeds id=1 on first apply, but we
// tolerate a missing row defensively in case someone wipes it.

export const fetchCommissionSettings = async () => {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data, error } = await supabase
    .from("commission_settings")
    .select("*")
    .eq("id", 1)
    .maybeSingle();
  if (error) throw error;
  return data || {
    id: 1,
    base_rate: 0.02,
    upsell_rate: 0.08,
    monthly_bonus_threshold: 5000,
    monthly_bonus_amount: 50,
  };
};

export const saveCommissionSettings = async (patch) => {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data, error } = await supabase
    .from("commission_settings")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", 1)
    .select("*")
    .single();
  if (error) throw error;
  return data;
};

// ── Transactions ───────────────────────────────────────────
// One row per completed sale. Throws on failure so the caller
// can route the row through the offline queue.
export const insertTransaction = async (row) => {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data, error } = await supabase
    .from("transactions")
    .insert(row)
    .select("id, created_at")
    .single();
  if (error) throw error;
  return data;
};

export const fetchTransactions = async ({
  from = null, to = null, employeeId = null, limit = 1000,
} = {}) => {
  if (!supabase) throw new Error("Supabase is not configured.");
  let q = supabase.from("transactions").select("*").order("created_at", { ascending: false }).limit(limit);
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
