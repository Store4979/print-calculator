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
