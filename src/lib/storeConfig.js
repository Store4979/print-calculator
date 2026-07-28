// ============================================================
//  STORE CONFIG — Phase A (Supabase-backed store profile + price book)
//
//  This module is the bridge between the Supabase config tables
//  (stores, paper_types, sheet_prices, discounts, addons, settings)
//  and the exact `pricing.json`-shaped object App.jsx already knows
//  how to apply. It also carries the admin auth helpers and the
//  "Publish to Cloud" writer.
//
//  Design goals:
//   - LOSSLESS: fetchStoreConfig() reconstructs the same shape the
//     bundled pricing.json uses, so the existing load logic is reused
//     unchanged (the reconstruction is the inverse of the seed).
//   - SAFE: every read is best-effort. On any error we return null and
//     the caller falls back to /pricing.json + localStorage, so the
//     counter tool never depends on Supabase being reachable.
//   - Writes require an authenticated owner/manager (RLS enforces it).
//
//  NOTE: the Signs365 / outsourced-products catalog is NOT routed
//  through here yet — SpecialtyTab keeps reading its bundled defaults.
//  The outsourced_* tables are seeded and ready; wiring the editor to
//  them is a follow-up (needs category descriptions persisted first).
// ============================================================

import { supabase } from "./supabase.js";
import { assembleConfig, asNum } from "./storeConfigAssemble.js";

export { assembleConfig };

// Which store this deployment serves. Phase B makes this dynamic.
export const STORE_SLUG =
  (import.meta.env.VITE_STORE_SLUG || "store4979").trim();

// ── Read: fetch + reconstruct ──────────────────────────────
// Returns { pricing, storeProfile } or null on any failure (caller
// then falls back to /pricing.json). Never throws.
export async function fetchStoreConfig(slug = STORE_SLUG) {
  if (!supabase) return null;
  try {
    const { data: store, error: se } = await supabase
      .from("stores").select("*").eq("slug", slug).maybeSingle();
    if (se || !store) return null;
    const sid = store.id;

    const [pt, sp, disc, add, sets] = await Promise.all([
      supabase.from("paper_types").select("*").eq("store_id", sid).order("sort_order", { ascending: true }),
      supabase.from("sheet_prices").select("*").eq("store_id", sid),
      supabase.from("discounts").select("*").eq("store_id", sid),
      supabase.from("addons").select("*").eq("store_id", sid),
      supabase.from("settings").select("*").eq("store_id", sid),
    ]);
    // An error on ANY table means we can't trust the reconstruction — a
    // partial read (e.g. discounts errored but paper_types succeeded) would
    // otherwise overwrite good state with empty data. Bail to the fallback.
    if (pt.error || sp.error || disc.error || add.error || sets.error) return null;
    // Defensive: a populated paper list with zero prices means a malformed
    // read, not a real price book — fall back rather than zero out pricing.
    if ((pt.data || []).length && !(sp.data || []).length) return null;

    return assembleConfig({
      store,
      paperTypes:  pt.data   || [],
      sheetPrices: sp.data   || [],
      discounts:   disc.data || [],
      addons:      add.data  || [],
      settings:    sets.data || [],
    });
  } catch (e) {
    console.warn("fetchStoreConfig failed; falling back to pricing.json", e);
    return null;
  }
}

// ── Light profile-only read (for customer-facing pages) ────
// Just the store row → profile shape. Used where the full price book
// isn't needed (the upload page, the print-queue QR sheet). Returns
// null on any error so callers keep their hard-coded defaults.
export async function fetchStoreProfile(slug = STORE_SLUG) {
  if (!supabase) return null;
  try {
    const { data: store, error } = await supabase
      .from("stores").select("*").eq("slug", slug).maybeSingle();
    if (error || !store) return null;
    return {
      id: store.id, slug: store.slug, name: store.name, address: store.address,
      phone: store.phone, email: store.email, logo: store.logo_url,
      colors: store.colors || {}, timezone: store.timezone,
    };
  } catch { return null; }
}

// ── Auth (admin gate) ──────────────────────────────────────
export async function getSession() {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data?.session || null;
}

export function onAuthChange(cb) {
  if (!supabase) return () => {};
  const { data } = supabase.auth.onAuthStateChange((_e, session) => cb(session));
  return () => data?.subscription?.unsubscribe?.();
}

export async function signInWithPassword(email, password) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data, error } = await supabase.auth.signInWithPassword({
    email: String(email || "").trim(),
    password: String(password || ""),
  });
  if (error) throw error;
  return data.session;
}

export async function sendMagicLink(email) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { error } = await supabase.auth.signInWithOtp({
    email: String(email || "").trim(),
    options: { emailRedirectTo: window.location.origin },
  });
  if (error) throw error;
  return true;
}

export async function signOut() {
  if (!supabase) return;
  try { await supabase.auth.signOut(); } catch {}
}

// Resolve a user's role at a store from an ALREADY-KNOWN session — makes no
// auth call, so it is safe to run inside an onAuthStateChange callback (where
// calling supabase.auth.* can deadlock). Returns 'owner' | 'manager' |
// 'staff' | null (null = signed out or genuinely not a member). THROWS on a
// real query error so callers can tell "lookup failed" from "not a member".
export async function getRoleForSession(session, slug = STORE_SLUG) {
  if (!supabase || !session?.user) return null;
  const { data: store, error: se } = await supabase
    .from("stores").select("id").eq("slug", slug).maybeSingle();
  if (se) throw se;
  if (!store) return null;
  const { data: m, error: me } = await supabase
    .from("memberships").select("role")
    .eq("store_id", store.id).eq("user_id", session.user.id).maybeSingle();
  if (me) throw me;
  return m?.role || null;
}

// Convenience: resolve the CURRENT signed-in user's role. Reads the session
// first, so do NOT call this from inside onAuthStateChange — use
// getRoleForSession(session) there. Throws on a real query error.
export async function getStoreRole(slug = STORE_SLUG) {
  const session = await getSession();
  return getRoleForSession(session, slug);
}

export const isAdminRole = (role) => role === "owner" || role === "manager";

// ── Write: "Publish to Cloud" ──────────────────────────────
// Pushes the current in-memory price book (the same object the admin
// panel's "Export pricing.json" builds) + profile up to Supabase.
// RLS requires an authenticated owner/manager; a non-member's writes
// filter to zero rows and this throws a clear error. Idempotent.
export async function publishStoreConfig(cfg, profile, slug = STORE_SLUG) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const session = await getSession();
  if (!session?.user) throw new Error("You must be signed in to publish.");
  const role = await getStoreRole(slug);
  if (!isAdminRole(role)) throw new Error("Your account is not an owner/manager of this store.");

  const { data: store, error: se } = await supabase.from("stores").select("id").eq("slug", slug).maybeSingle();
  if (se || !store) throw new Error("Store not found.");
  const sid = store.id;

  // 1) store profile
  if (profile) {
    const patch = {};
    if (profile.name    != null) patch.name    = profile.name;
    if (profile.address != null) patch.address = profile.address;
    if (profile.phone   != null) patch.phone   = profile.phone;
    if (profile.email   != null) patch.email   = profile.email;
    if (profile.logo    != null) patch.logo_url = profile.logo;
    if (profile.colors  != null) patch.colors  = profile.colors;
    if (Object.keys(patch).length) {
      const { error } = await supabase.from("stores").update(patch).eq("id", sid);
      if (error) throw new Error(`Publishing store profile failed: ${error.message}`);
    }
  }

  // 2) paper_types (upsert present, delete removed)
  const sheetKeys = cfg.sheetKeysForPaper || {};
  const sheetMk   = cfg.sheetMarkupPerPaper || {};
  const lfMk      = cfg.lfMarkupPerPaper || {};
  const ptRows = [];
  (cfg.paperTypes || []).forEach((p, i) => ptRows.push({
    store_id: sid, kind: "sheet", key: p.key, label: p.label,
    sheet_keys: sheetKeys[p.key] || [], markup_percent: asNum(sheetMk[p.key] ?? 0), sort_order: i,
  }));
  (cfg.lfPaperTypes || []).forEach((p, i) => ptRows.push({
    store_id: sid, kind: "large_format", key: p.key, label: p.label,
    sheet_keys: [], markup_percent: asNum(lfMk[p.key] ?? 0), sort_order: i,
  }));
  if (ptRows.length) {
    const { error } = await supabase.from("paper_types")
      .upsert(ptRows, { onConflict: "store_id,kind,key" });
    if (error) throw new Error(`Publishing paper types failed: ${error.message}`);
  }
  // prune paper types no longer present (cascades to sheet_prices)
  const keepPairs = new Set(ptRows.map((r) => `${r.kind}:${r.key}`));
  const { data: existingPt } = await supabase.from("paper_types").select("id,kind,key").eq("store_id", sid);
  const stalePt = (existingPt || []).filter((r) => !keepPairs.has(`${r.kind}:${r.key}`)).map((r) => r.id);
  if (stalePt.length) await supabase.from("paper_types").delete().in("id", stalePt);

  // refetch to resolve paper_type_id for sheet_prices
  const { data: papers } = await supabase.from("paper_types").select("id,kind,key").eq("store_id", sid);
  const paperId = {};
  (papers || []).forEach((p) => { paperId[`${p.kind}:${p.key}`] = p.id; });

  // 3) sheet_prices (sheet sizes + LF per-sqft)
  const skuMap = cfg.skuMap || {};
  const spRows = [];
  const sheetPricing = cfg.sheetPricing || {};
  Object.entries(sheetPricing).forEach(([pk, sizes]) => {
    const pid = paperId[`sheet:${pk}`];
    if (!pid) return;
    Object.entries(sizes || {}).forEach(([sk, e]) => spRows.push({
      store_id: sid, paper_type_id: pid, sheet_key: sk,
      base_cost_color: asNum(e.baseCostColor || 0), base_cost_bw: asNum(e.baseCostBW || 0),
      price_color: asNum(e.priceColor || 0), price_bw: asNum(e.priceBW || 0),
      sku: skuMap[`${pk}:${sk}`] || null,
    }));
  });
  const lfPricing = cfg.lfPricing || {};
  Object.entries(lfPricing).forEach(([pk, e]) => {
    const pid = paperId[`large_format:${pk}`];
    if (!pid) return;
    spRows.push({
      store_id: sid, paper_type_id: pid, sheet_key: null,
      base_cost_color: asNum(e.baseCostColor || 0), base_cost_bw: asNum(e.baseCostBW || 0),
      price_color: asNum(e.priceColor || 0), price_bw: asNum(e.priceBW || 0), sku: null,
    });
  });
  if (spRows.length) {
    const { error } = await supabase.from("sheet_prices")
      .upsert(spRows, { onConflict: "store_id,paper_type_id,sheet_key" });
    if (error) throw new Error(`Publishing prices failed: ${error.message}`);
  }

  // 4) discounts — replace-all (delete then insert) is simplest + correct
  {
    const { error: delErr } = await supabase.from("discounts").delete().eq("store_id", sid);
    if (delErr) throw new Error(`Publishing discounts failed: ${delErr.message}`);
    const dRows = [];
    (cfg.sheetQtyDiscounts || []).forEach((d) => dRows.push({
      store_id: sid, kind: "sheet", min_qty: d.minSheets, discount_percent: asNum(d.discountPercent),
    }));
    // LF discounts are keyed on square footage (minSqFt), not sheet count.
    (cfg.lfQtyDiscounts || []).forEach((d) => {
      const threshold = d.minSqFt != null ? d.minSqFt : d.minSheets; // tolerate either
      if (threshold == null) return; // skip malformed rows rather than insert NULL min_qty
      dRows.push({ store_id: sid, kind: "large_format", min_qty: threshold, discount_percent: asNum(d.discountPercent) });
    });
    if (dRows.length) {
      const { error } = await supabase.from("discounts").insert(dRows);
      if (error) throw new Error(`Publishing discounts failed: ${error.message}`);
    }
  }

  // 5) addons — upsert each key from lfAddonPricing (preserve pricing_unit
  //    on the two live keys; unknown keys default to flat)
  const unitFor = (k) => (k === "grommetEach" ? "each" : k === "foamCore" ? "flat_per_print" : "flat");
  const labelFor = (k) => (k === "grommetEach" ? "Grommets" : k === "foamCore" ? "Foam Core" : k);
  const addonRows = Object.entries(cfg.lfAddonPricing || {}).map(([k, price], i) => ({
    store_id: sid, kind: "large_format", key: k, label: labelFor(k),
    price: asNum(price || 0), pricing_unit: unitFor(k),
    active: k === "grommetEach" || k === "foamCore", sort_order: i,
  }));
  if (addonRows.length) {
    const { error } = await supabase.from("addons")
      .upsert(addonRows, { onConflict: "store_id,kind,key" });
    if (error) throw new Error(`Publishing add-ons failed: ${error.message}`);
  }

  // 6) settings — the scalar/json knobs
  const setRows = [];
  const putSetting = (key, value) => { if (value !== undefined) setRows.push({ store_id: sid, key, value }); };
  putSetting("back_side_factor", cfg.backSideFactor);
  putSetting("preview_margin", cfg.previewMargin);
  putSetting("preview_spacing", cfg.previewSpacing);
  putSetting("blueprint_pricing", cfg.blueprintPricing);
  putSetting("upsell_defaults", cfg.upsellFlags);
  if (setRows.length) {
    const { error } = await supabase.from("settings").upsert(setRows, { onConflict: "store_id,key" });
    if (error) throw new Error(`Publishing settings failed: ${error.message}`);
  }

  return true;
}
