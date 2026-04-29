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
