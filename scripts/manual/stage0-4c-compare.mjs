// scripts/manual/stage0-4c-compare.mjs — the item 4(c) comparator (plan
// §2.2 and §6.4; the implementation outline's X2). PURE: it reads its
// arguments only, writes nothing and reads no clock. Its one dependency is
// node:crypto, for md5.
//
// It reads the rows of the checked-state text (P0-4C and POST-4C, from
// supabase/rehearsals/release2_stage0_4c_checked_state.sql): one row per fact,
// { part, key, value }, with an md5 per part and of the whole. In reviewed
// tables, it decides what a reading may show:
//   readObservation  the rows as parts; each part's md5 recomputed;
//   bindReceipt      the md5 of each part and of the whole, which a binding
//                    commit pins once Codex has reviewed a first receipt;
//   catalogState     A1a's state of the Release 2 functions (the manifest's
//                    `functions` and `stateAfter`);
//   p0Findings       P0′: state 01 and only 01 (§6.4's baseline-only
//                    preconditions);
//   postFindings     POST′: one intended state (STEP_STATES), against the
//                    project's bound baseline and the previous accepted
//                    readback;
//   otherRoleRows    the rule the other roles' Release 2 EXECUTE rows follow,
//                    from a bound baseline (for the test that the literal
//                    rows a binding commit adds agree with it);
//   crossProject     the tier table (TIERS) between two projects' baselines;
//   dataScope        §6.4's data facts around P1′ on production.
// A finding is { verdict, part, key, reason }. STOP stops for review;
// RESIDUAL is a named residual, accepted only with its record; RECORDED is
// reported. An empty list of STOP and unrecorded RESIDUAL findings is
// acceptance of what was compared, and nothing more. Nothing here sends: the
// 4(c) gate (X4) will use it.
import { createHash } from "node:crypto";

/** The roles whose Release 2 EXECUTE rows V-2 fixes literally (plan §6.4). */
export const V2_ROLES = Object.freeze(["anon", "authenticated", "service_role"]);

/**
 * V-2: the reviewed Release 2 EXECUTE rows for anon, authenticated and
 * service_role at each catalog state, as the plan's table gives them
 * (Codex's local probe; A1a's grantee sets). "FFT" is anon false,
 * authenticated false, service_role true. 3, 9, 15 and 18 rows.
 */
export const V2_EXEC = Object.freeze({
  "01": Object.freeze({
    "redeem_enrollment_ticket(bytea, bytea, bytea, text)": "FFT",
  }),
  "02": Object.freeze({
    "redeem_enrollment_ticket(bytea, bytea, bytea, text)": "FFT",
    "release2_record_attempt(text, text, integer, integer, integer)": "FFT",
    "release2_clear_lockout(text, text, uuid)": "FTT",
  }),
  "04": Object.freeze({
    "redeem_enrollment_ticket(bytea, bytea, bytea, text)": "FFT",
    "release2_record_attempt(text, text, integer, integer, integer)": "FFT",
    "release2_clear_lockout(text, text, uuid, uuid)": "FTT",
    "release2_create_staff_session(uuid, uuid, bytea, bytea, timestamp with time zone, timestamp with time zone)": "FFT",
    "release2_prune_auth_attempts(integer)": "FFT",
  }),
  "05": Object.freeze({
    "redeem_enrollment_ticket(bytea, bytea, bytea, text)": "FFT",
    "release2_record_attempt(text, text, integer, integer, integer)": "FFT",
    "release2_clear_lockout(text, text, uuid, uuid)": "FTT",
    "release2_create_staff_session(uuid, uuid, bytea, bytea, timestamp with time zone, timestamp with time zone)": "FFT",
    "release2_prune_auth_attempts(integer)": "FFT",
    "release2_revoke_enrollment(uuid, uuid, text)": "FFT",
  }),
});

/**
 * Each Release 2 function's catalog facts beyond A1a's md5 and ACL, by A1a's
 * key: security definer, volatility, its settings, its result type and the
 * md5 of its comment. The migration bytes fix them; the local run read them
 * (X2's run C) and they are reviewed here.
 */
export const FUNCTION_FACTS = Object.freeze({
  redeem: "true|v|search_path=public|TABLE(enrollment_id uuid, store_id uuid)|f6cc9d21a5cd10db09a77122d4cd96be",
  rec02: "true|v|search_path=public|TABLE(allowed boolean, attempts integer, locked_until timestamp with time zone)|94b58423d0479dae7c2a3eb7bbab5274",
  clr02: "true|v|search_path=public|integer|2851378bfd16678fb29f8514b34d35c0",
  clr03: "true|v|search_path=public|integer|3dbada81128e98b239c802a841d56033",
  rec03: "true|v|search_path=public|TABLE(allowed boolean, attempts integer, locked_until timestamp with time zone)|86d0307b0232b7140a9ad0458519c2af",
  prune: "true|v|search_path=public|integer|4918a49ea0104a7e98d5e53b7dc4c6f7",
  css04: "true|v|search_path=public|TABLE(session_id uuid, store_id uuid, employee_role text)|91daa6a5569c99d38175b3fce7c290ca",
  revoke: "true|v|search_path=public|TABLE(o_enrollment_id uuid, o_store_id uuid, o_sessions_revoked integer)|8fb70f00e6c5658d52bc7d24995f8894",
});

/**
 * The intended state each step leaves (§6.4's table): the catalog state, and
 * the ledger rows the step adds after the previous accepted readback's, in
 * order, as [migration n, "forward" | "rollback"]. A planned refusal adds
 * nothing and leaves the previous state (REFUSAL).
 */
export const STEP_STATES = Object.freeze({
  "P2-02": Object.freeze({ catalog: "02", adds: [["02", "forward"]] }),
  "P2-0304": Object.freeze({ catalog: "04", adds: [["03", "forward"], ["04", "forward"]] }),
  "P2-05": Object.freeze({ catalog: "05", adds: [["05", "forward"]] }),
  "RB-5": Object.freeze({ catalog: "04", adds: [["05", "rollback"]] }),
  "RB-43": Object.freeze({ catalog: "02", adds: [["04", "rollback"], ["03", "rollback"]] }),
  "RB-2": Object.freeze({ catalog: "01", adds: [["02", "rollback"]] }),
});
export const REFUSAL = "refusal";

/** The Release 2 tables, which every reading requires present and empty. */
export const R2_TABLES = Object.freeze(["device_enrollments", "enrollment_tickets", "staff_sessions", "upload_capabilities", "upload_capability_files", "auth_attempts"]);

/**
 * §6.4's data scope around P1′ on production (part 10): what must stay
 * equal, else STOP; and what is recorded only, with its possible writers.
 */
export const DATA_SCOPE = Object.freeze({
  stop: Object.freeze([
    ...R2_TABLES.map((t) => `count|public.${t}`),
    "probe_slug_absent", "nil_job_absent", "rehearsal_marker",
    "count|public.employees", "count|public.stores", "count|public.organizations", "count|public.memberships", "count|auth.users",
    "digest|public.employees", "digest|public.stores", "digest|public.organizations", "digest|public.memberships", "digest|auth.users",
    "free_pins", "stores_without_org",
    "count|public.orders", "count|public.settings", "count|public.addons", "count|public.discounts",
    "count|public.outsourced_products", "count|public.paper_types", "count|public.print_jobs", "count|public.sheet_prices",
  ]),
  recorded: Object.freeze({ "count|public.pending_jobs": "the customer upload functions and cleanup-stale-jobs stay live; a change is never attributed to one without evidence" }),
});

/** The named residuals of §2.2; each is accepted only with its record. */
export const RESIDUALS = Object.freeze(["R-IMG", "R-VER", "R-EXT", "R-SET", "R-AUTHCFG"]);

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const md5Hex = /^[0-9a-f]{32}$/;
const finding = (verdict, part, key, reason) => ({ verdict, part, key, reason });
const stop = (part, key, reason) => finding("STOP", part, key, reason);

/** md5 over UTF-8, as the checked-state text computes its own digests. */
export const md5 = (text) => createHash("md5").update(Buffer.from(String(text), "utf8")).digest("hex");

/** Byte order of the UTF-8 encoding, as the text's `collate "C"` orders keys. */
const byteOrder = (x, y) => {
  const a = new TextEncoder().encode(x), b = new TextEncoder().encode(y);
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i];
  return a.length - b.length;
};
const partMd5 = (facts) => md5(Object.keys(facts).sort(byteOrder).map((k) => `${k}=${facts[k]}`).join("\n"));

/**
 * The rows as { parts: {1..10: {key: value}}, md5: {1..10: md5}, whole,
 * problems }. A row of the wrong shape, a duplicate key, a part outside 1..10,
 * a missing '#md5', or an md5 that the rows do not reproduce is a problem: the
 * reading is not self-consistent, and every comparison of it is a STOP.
 */
export function readObservation(rows) {
  const problems = [];
  const parts = {};
  const md5s = {};
  let whole = null;
  for (let p = 1; p <= 10; p++) parts[p] = {};
  if (!Array.isArray(rows)) return { parts, md5: md5s, whole, problems: ["the reading is not a list of rows"] };
  for (const [i, r] of rows.entries()) {
    const part = isObj(r) ? Number(r.part) : NaN;
    if (!isObj(r) || !Number.isInteger(part) || typeof r.key !== "string" || typeof r.value !== "string") { problems.push(`row ${i + 1} is not { part, key, value } with text key and value`); continue; }
    if (r.key === "#md5") {
      if (!md5Hex.test(r.value)) { problems.push(`part ${part}'s md5 is not an md5`); continue; }
      if (part === 0) { if (whole !== null) problems.push("two md5 rows for the whole"); whole = r.value; continue; }
      if (part < 1 || part > 10) { problems.push(`an md5 for part ${part}, which does not exist`); continue; }
      if (Object.hasOwn(md5s, part)) problems.push(`two md5 rows for part ${part}`);
      md5s[part] = r.value;
      continue;
    }
    if (part < 1 || part > 10) { problems.push(`row ${i + 1} is in part ${part}, which does not exist`); continue; }
    if (Object.hasOwn(parts[part], r.key)) problems.push(`part ${part} holds key ${r.key} twice`);
    parts[part][r.key] = r.value;
  }
  for (let p = 1; p <= 10; p++) {
    if (!Object.hasOwn(md5s, p)) problems.push(`part ${p} has no md5 row`);
    else if (partMd5(parts[p]) !== md5s[p]) problems.push(`part ${p}'s rows do not reproduce its md5`);
  }
  if (whole === null) problems.push("the whole has no md5 row");
  else if (Object.keys(md5s).length === 10 && md5(Array.from({ length: 10 }, (_, i) => `${i + 1}=${md5s[i + 1]}`).join("\n")) !== whole) problems.push("the parts' md5s do not reproduce the whole's");
  return { parts, md5: md5s, whole, problems };
}

/** The binding a reviewed first receipt is pinned by: its parts' md5s and the whole's. */
export function bindReceipt(obs) {
  if (obs.problems.length) throw new Error(`a reading with problems cannot be bound: ${obs.problems.join("; ")}`);
  return { parts: { ...obs.md5 }, whole: obs.whole };
}

/** STOP findings unless `obs` is exactly the bound receipt. */
export function bindingFindings(obs, binding) {
  if (obs.problems.length) return obs.problems.map((p) => stop(0, null, p));
  if (!isObj(binding) || !isObj(binding.parts)) return [stop(0, null, "no bound receipt")];
  const out = [];
  for (let p = 1; p <= 10; p++) if (obs.md5[p] !== binding.parts[p]) out.push(stop(p, null, `part ${p} is not the bound receipt's`));
  if (obs.whole !== binding.whole) out.push(stop(0, null, "the whole is not the bound receipt's"));
  return out;
}

// ── the Release 2 functions ────────────────────────────────────────────────

const R2_FN = /^function\|(release2_[a-z0-9_]+|redeem_enrollment_ticket)\(/;
const R2_OWNER = /^owner\|function\|(release2_[a-z0-9_]+|redeem_enrollment_ticket)\(/;
const R2_EXEC = /^exec-r2\|/;

/**
 * The Release 2 function rows a catalog state must hold, keyed as part 2
 * keys them: { key: fact }, from the manifest's A1a table and FUNCTION_FACTS.
 */
export function stateFunctions(manifest, state) {
  const keys = manifest && manifest.stateAfter && manifest.stateAfter[state];
  if (!Array.isArray(keys)) throw new Error(`no catalog state ${state}`);
  const out = {};
  for (const k of keys) {
    const f = manifest.functions[k];
    if (!f || !Object.hasOwn(FUNCTION_FACTS, k)) throw new Error(`no reviewed facts for ${k}`);
    const [secdef, vol, config, result, comment] = FUNCTION_FACTS[k].split("|");
    out[`function|${f.signature}`] = [f.prosrcMd5, secdef, vol, config, result, f.execute.join(","), comment].join("|");
  }
  return out;
}

/** The catalog state A1a names for part 2's Release 2 function rows, or "unrecognized". */
export function catalogState(manifest, obs) {
  const have = Object.fromEntries(Object.entries(obs.parts[2]).filter(([k]) => R2_FN.test(k)));
  for (const s of ["01", "02", "04", "05"]) {
    const want = stateFunctions(manifest, s);
    if (JSON.stringify(Object.keys(want).sort()) === JSON.stringify(Object.keys(have).sort()) && Object.keys(want).every((k) => want[k] === have[k])) return s;
  }
  return "unrecognized";
}

/** STOP findings unless part 4's exec-r2 rows for V2_ROLES are exactly V2_EXEC[state]. */
function v2Findings(obs, state) {
  const out = [];
  const want = {};
  for (const [sig, tft] of Object.entries(V2_EXEC[state] || {})) V2_ROLES.forEach((r, i) => { want[`exec-r2|${r}|public.${sig}`] = tft[i] === "T" ? "true" : "false"; });
  const have = Object.fromEntries(Object.entries(obs.parts[4]).filter(([k]) => R2_EXEC.test(k) && V2_ROLES.includes(k.split("|")[1])));
  for (const [k, v] of Object.entries(want)) {
    if (!Object.hasOwn(have, k)) out.push(stop(4, k, `V-2: the reviewed row is missing (state ${state})`));
    else if (have[k] !== v) out.push(stop(4, k, `V-2: EXECUTE is ${have[k]}; state ${state}'s reviewed row says ${v}`));
  }
  for (const k of Object.keys(have)) if (!Object.hasOwn(want, k)) out.push(stop(4, k, `V-2: an unexplained extra row at state ${state}`));
  return out;
}

/**
 * The rule the other roles' Release 2 EXECUTE rows follow (§6.4): true when
 * the role is a superuser, owns the function, is in A1a's grantee set for it
 * (PUBLIC included), or inherits a grantee's privileges through the bound
 * baseline's memberships; otherwise false. Returns { key: "true" | "false" }
 * for each role of the baseline's part 4 outside V2_ROLES and each function
 * of `state`. POST′ never uses it: it compares the literal rows a binding
 * commit adds, and a test checks them against this rule.
 */
export function otherRoleRows(manifest, baseline, state) {
  const p4 = baseline.parts[4];
  const roles = Object.keys(p4).filter((k) => k.startsWith("attr|") && p4[k] !== "<absent>").map((k) => k.slice(5)).filter((r) => !V2_ROLES.includes(r));
  const inheritsFrom = new Map();
  for (const k of Object.keys(p4).filter((x) => x.startsWith("member|"))) {
    const [, role, member] = k.split("|");
    const inherit = p4[k].split("|")[1] === "true";
    if (!inherit) continue;
    if (!inheritsFrom.has(member)) inheritsFrom.set(member, new Set());
    inheritsFrom.get(member).add(role);
  }
  const reach = (role) => {
    const seen = new Set([role]);
    const todo = [role];
    while (todo.length) for (const r of inheritsFrom.get(todo.pop()) || []) if (!seen.has(r)) { seen.add(r); todo.push(r); }
    return seen;
  };
  const owner = baseline.parts[2]["owner|function|redeem_enrollment_ticket(bytea, bytea, bytea, text)"];
  const out = {};
  for (const k of manifest.stateAfter[state]) {
    const f = manifest.functions[k];
    const grantees = new Set(f.execute.map((e) => e.split("=")[0]));
    for (const role of roles) {
      const superuser = p4[`attr|${role}`].split("|")[0] === "true";
      const held = superuser || role === owner || grantees.has("PUBLIC") || [...reach(role)].some((r) => grantees.has(r));
      out[`exec-r2|${role}|public.${f.signature}`] = held ? "true" : "false";
    }
  }
  return out;
}

// ── the ledger ─────────────────────────────────────────────────────────────

const ROW = /^row\|([0-9]{14})$/;
const ledgerRows = (obs) => Object.entries(obs.parts[1]).filter(([k]) => ROW.test(k)).map(([k, v]) => ({ version: ROW.exec(k)[1], value: v })).sort((x, y) => (x.version < y.version ? -1 : 1));
const asRow = (name, md5v, bytes, createdBy) => [name, md5v, String(bytes), "1", createdBy, "true", "true", "true"].join("|");
const plusSeconds = (v, s) => {
  const d = new Date(Date.UTC(+v.slice(0, 4), +v.slice(4, 6) - 1, +v.slice(6, 8), +v.slice(8, 10), +v.slice(10, 12), +v.slice(12, 14)) + s * 1000);
  return d.toISOString().replace(/[-:T]/g, "").slice(0, 14);
};

/** The 21 rows P0′ requires: the 20 baseline rows and 01 at its production version. */
export function baselineLedger(manifest) {
  const one = manifest.migrations.find((m) => m.n === "01");
  const createdBy = manifest.ledgerRow.createdBy;
  return [
    ...manifest.baselineLedger.map((r) => ({ version: r.version, name: r.name, md5: r.md5, bytes: null })),
    { version: one.productionVersion, name: one.name, md5: one.md5, bytes: one.bytes },
  ].map((r) => ({ ...r, createdBy }));
}

function ledgerShapeFindings(manifest, obs) {
  const out = [];
  if (obs.parts[1].columns !== manifest.ledgerRow.columns) out.push(stop(1, "columns", "the ledger's columns are not the pinned six"));
  // The final LF is 01's identity fact (and the step rows', compared whole):
  // most of the 20 older files end without one.
  for (const r of ledgerRows(obs)) {
    const f = r.value.split("|");
    if (f.length !== 8 || f[3] !== "1" || f[4] !== manifest.ledgerRow.createdBy || f[5] !== "true" || f[6] !== "true") {
      out.push(stop(1, `row|${r.version}`, "not one element, created_by, and null idempotency_key and rollback"));
    }
  }
  const rows = ledgerRows(obs);
  if (obs.parts[1].count !== String(rows.length)) out.push(stop(1, "count", "the count is not the rows'"));
  if (rows.length && obs.parts[1].head !== rows[rows.length - 1].version) out.push(stop(1, "head", "the head is not the last row's version"));
  return out;
}

// ── P0′: state 01, and only 01 ─────────────────────────────────────────────

/**
 * P0′'s baseline-only preconditions (§6.1, §6.4), on the reading `obs`, for
 * `target` "production" or "rehearsal". Each failure is a STOP.
 */
export function p0Findings(manifest, obs, { target } = {}) {
  if (obs.problems.length) return obs.problems.map((p) => stop(0, null, p));
  if (target !== "production" && target !== "rehearsal") return [stop(0, null, "P0′ names its target, production or rehearsal")];
  const out = [...ledgerShapeFindings(manifest, obs)];
  const want = baselineLedger(manifest);
  const have = ledgerRows(obs);
  if (have.length !== want.length) out.push(stop(1, "count", `the ledger has ${have.length} rows; P0′ requires exactly ${want.length}, head 01`));
  for (const w of want) {
    const h = have.find((r) => r.version === w.version);
    const f = h ? h.value.split("|") : [];
    if (!h || f[0] !== w.name || f[1] !== w.md5 || (w.bytes !== null && f[2] !== String(w.bytes))) out.push(stop(1, `row|${w.version}`, `not ${w.name} with its pinned md5${w.bytes !== null ? " and bytes" : ""}`));
  }
  const one = want[want.length - 1];
  if (obs.parts[1].head !== one.version) out.push(stop(1, "head", `the head is not 01's row, ${one.version}`));
  if (obs.parts[1][`row|${one.version}`] !== asRow(one.name, one.md5, one.bytes, one.createdBy)) out.push(stop(1, `row|${one.version}`, "01's identity: not its name, md5, bytes, one element, created_by, null idempotency_key and rollback, and a final LF"));
  const state = catalogState(manifest, obs);
  if (state !== "01") out.push(stop(2, null, `the Release 2 functions are state ${state}, not 01 (A1a)`));
  for (const t of R2_TABLES) {
    if (!Object.hasOwn(obs.parts[2], `relation|${t}`)) out.push(stop(2, `relation|${t}`, "a Release 2 table is absent"));
    if (obs.parts[10][`count|public.${t}`] !== "0") out.push(stop(10, `count|public.${t}`, "a Release 2 table is not empty"));
  }
  const c = manifest.constraint;
  if (obs.parts[2][`constraint|${c.table}.${c.name}`] !== c.definition) out.push(stop(2, `constraint|${c.table}.${c.name}`, `${c.name} is not present as ${c.definition}`));
  out.push(...v2Findings(obs, "01"));
  for (const k of Object.keys(obs.parts[4])) if (R2_EXEC.test(k) && !Object.keys(V2_EXEC["01"]).some((sig) => k.endsWith(`|public.${sig}`))) out.push(stop(4, k, "a Release 2 row beyond 01's"));
  if (!(Number(obs.parts[9].server_version_num) >= 170000)) out.push(stop(9, "server_version_num", "the server is older than PostgreSQL 17"));
  const p10 = obs.parts[10];
  if (p10.probe_slug_absent !== "true") out.push(stop(10, "probe_slug_absent", "the probe identity is present"));
  if (p10.nil_job_absent !== "true") out.push(stop(10, "nil_job_absent", "the nil job identity is present"));
  if (obs.parts[6]["authusers-user-triggers"] !== "0") out.push(stop(6, "authusers-user-triggers", "auth.users has a user trigger"));
  if (!(Number(p10.free_pins) >= 3)) out.push(stop(10, "free_pins", "fewer than three free PINs"));
  if (p10.stores_without_org !== "0") out.push(stop(10, "stores_without_org", "a store has no organization"));
  const marker = target === "rehearsal" ? "true" : "false";
  if (p10.rehearsal_marker !== marker) out.push(stop(10, "rehearsal_marker", `the rehearsal marker is ${p10.rehearsal_marker} on ${target}`));
  if (!Object.hasOwn(obs.parts[2], "fingerprint")) out.push(stop(2, "fingerprint", "no catalog_fingerprint"));
  return out;
}

// ── POST′: one intended state ──────────────────────────────────────────────

const without = (facts, drop) => Object.fromEntries(Object.entries(facts).filter(([k]) => !drop(k)));
/** STOP findings for every key where `have` (the reading) and `want` (the reference, named `label`) differ. */
function sameFacts(part, have, want, label) {
  const out = [];
  for (const k of new Set([...Object.keys(have), ...Object.keys(want)])) {
    if (!Object.hasOwn(have, k)) out.push(stop(part, k, `missing; ${label} has it`));
    else if (!Object.hasOwn(want, k)) out.push(stop(part, k, `not in ${label}`));
    else if (have[k] !== want[k]) out.push(stop(part, k, `differs from ${label}`));
  }
  return out;
}

/**
 * POST′'s acceptance of `obs` after `step` (a STEP_STATES key, or REFUSAL),
 * on `target`:
 *   - baseline: the project's bound baseline reading (P0′ at 01);
 *   - previous: the previous accepted readback (the baseline itself for the
 *     first step), and previousState: its catalog state;
 *   - otherRows: the literal Release 2 EXECUTE rows of the roles outside
 *     V2_ROLES for each catalog state, which a binding commit adds; none
 *     bound is a STOP;
 *   - windowStart: on production, the window-start P0′, for part 10's data
 *     scope; recordedOrders: on the rehearsal, the orders the app checks
 *     saved since `previous`.
 */
export function postFindings(manifest, obs, { step, target, baseline, previous, previousState, otherRows, windowStart, recordedOrders } = {}) {
  if (obs.problems.length) return obs.problems.map((p) => stop(0, null, p));
  for (const [label, r] of [["the baseline", baseline], ["the previous readback", previous]]) if (!r || r.problems.length) return [stop(0, null, `${label} is missing or not self-consistent`)];
  if (target !== "production" && target !== "rehearsal") return [stop(0, null, "POST′ names its target, production or rehearsal")];
  const s = step === REFUSAL ? { catalog: previousState, adds: [] } : STEP_STATES[step];
  if (!s || !["01", "02", "04", "05"].includes(s.catalog)) return [stop(0, null, `POST′ takes one intended state; ${String(step)} is none`)];
  const out = [...ledgerShapeFindings(manifest, obs)];

  // Part 1: the previous rows unchanged, then exactly the step's rows.
  const prev = ledgerRows(previous);
  const now = ledgerRows(obs);
  prev.forEach((r, i) => { if (!now[i] || now[i].version !== r.version || now[i].value !== r.value) out.push(stop(1, `row|${r.version}`, "a previous ledger row is changed or missing")); });
  const added = now.slice(prev.length);
  if (added.length !== s.adds.length) out.push(stop(1, "count", `the step added ${added.length} ledger rows; ${step} adds ${s.adds.length}`));
  s.adds.forEach(([n, kind], i) => {
    const r = added[i];
    if (!r) return;
    const mig = manifest.migrations.find((m) => m.n === n);
    const file = kind === "forward" ? mig : manifest.rollbacks.find((m) => m.n === n);
    const name = kind === "forward" ? mig.name : `${mig.name}_rollback`;
    if (r.value !== asRow(name, file.md5, file.bytes, manifest.ledgerRow.createdBy)) out.push(stop(1, `row|${r.version}`, `not ${name} with its pinned md5 and bytes`));
    const before = i === 0 ? (prev.length ? prev[prev.length - 1].version : "") : added[i - 1].version;
    if (i === 0 && !(r.version > before)) out.push(stop(1, `row|${r.version}`, "not after the previous head"));
    if (i > 0 && r.version !== plusSeconds(before, 1)) out.push(stop(1, `row|${r.version}`, "not one second after the row before it"));
  });
  const one = baselineLedger(manifest).at(-1);
  if (!now.some((r) => r.version === one.version && r.value === ledgerRows(baseline).find((b) => b.version === one.version)?.value)) out.push(stop(1, `row|${one.version}`, "01's identity changed"));

  // Part 2: exactly the state's Release 2 functions; the rest as the baseline.
  const want = stateFunctions(manifest, s.catalog);
  const have = without(obs.parts[2], (k) => !R2_FN.test(k));
  out.push(...sameFacts(2, have, want, `state ${s.catalog}'s reviewed Release 2 functions`));
  const owner = baseline.parts[2]["owner|function|redeem_enrollment_ticket(bytea, bytea, bytea, text)"];
  for (const [k, v] of Object.entries(obs.parts[2])) if (R2_OWNER.test(k) && v !== owner) out.push(stop(2, k, `owned by ${v}, not ${owner}`));
  for (const k of Object.keys(want)) if (!Object.hasOwn(obs.parts[2], `owner|${k}`)) out.push(stop(2, `owner|${k}`, "no owner row"));
  const rest = (p) => without(p, (k) => R2_FN.test(k) || R2_OWNER.test(k) || k === "fingerprint");
  out.push(...sameFacts(2, rest(obs.parts[2]), rest(baseline.parts[2]), "the bound baseline"));
  for (const t of R2_TABLES) if (obs.parts[10][`count|public.${t}`] !== "0") out.push(stop(10, `count|public.${t}`, "a Release 2 table is not empty"));

  // Part 4: V-2's rows, the other roles' bound rows, the rest as the baseline.
  out.push(...v2Findings(obs, s.catalog));
  const others = without(obs.parts[4], (k) => !R2_EXEC.test(k) || V2_ROLES.includes(k.split("|")[1]));
  if (!isObj(otherRows) || !isObj(otherRows[s.catalog])) out.push(stop(4, null, `no bound literal rows for the other roles at state ${s.catalog}`));
  else out.push(...sameFacts(4, others, otherRows[s.catalog], `the bound rows for the other roles at state ${s.catalog}`));
  out.push(...sameFacts(4, without(obs.parts[4], (k) => R2_EXEC.test(k)), without(baseline.parts[4], (k) => R2_EXEC.test(k)), "the bound baseline"));

  // Parts 3 and 5 to 9: as the bound baseline.
  for (const p of [3, 5, 6, 7, 8, 9]) out.push(...sameFacts(p, obs.parts[p], baseline.parts[p], "the bound baseline"));

  // Part 10: the data scope.
  if (target === "production") {
    if (!windowStart || windowStart.problems.length) out.push(stop(10, null, "no window-start P0′ to compare the data with"));
    else for (const k of DATA_SCOPE.stop) if (obs.parts[10][k] !== windowStart.parts[10][k]) out.push(stop(10, k, "differs from the window-start P0′"));
    for (const [k, why] of Object.entries(DATA_SCOPE.recorded)) out.push(finding("RECORDED", 10, k, `${obs.parts[10][k]} (window start ${windowStart ? windowStart.parts[10][k] : "?"}): ${why}`));
  } else {
    if (!Number.isInteger(recordedOrders) || recordedOrders < 0) out.push(stop(10, "count|public.orders", "the recorded app-check orders are not given"));
    for (const k of new Set([...Object.keys(obs.parts[10]), ...Object.keys(previous.parts[10])])) {
      if (k === "count|public.orders") {
        if (Number.isInteger(recordedOrders) && Number(obs.parts[10][k]) !== Number(previous.parts[10][k]) + recordedOrders) out.push(stop(10, k, `orders did not grow by exactly the ${recordedOrders} recorded`));
      } else if (obs.parts[10][k] !== previous.parts[10][k]) out.push(stop(10, k, "differs from the previous accepted readback"));
    }
  }
  return out;
}

// ── between two projects: the tier table ───────────────────────────────────

/**
 * §2.2's tiers, by part: MATCH (else STOP), a named residual (accepted only
 * with its record), or RECORDED. `creator` is the object-creating role WHO
 * names; `records` maps a residual's name, or "R-IMG|evt|<trigger>", to its
 * record. Every fact of either reading gets one finding.
 */
export function crossProject(prod, reh, { creator, records = {} } = {}) {
  for (const [label, o] of [["production's baseline", prod], ["the rehearsal's baseline", reh]]) if (!o || o.problems.length) return [stop(0, null, `${label} is missing or not self-consistent`)];
  const out = [];
  const residual = (part, key, name, why) => {
    const rec = records[`${name}|${key}`] ?? records[name];
    out.push(typeof rec === "string" && rec.trim() ? finding("RESIDUAL", part, key, `${name}: ${why}; recorded: ${rec}`) : stop(part, key, `${name}: ${why}, with no record`));
  };
  const both = (p) => [...new Set([...Object.keys(prod.parts[p]), ...Object.keys(reh.parts[p])])];
  const eq = (p, k) => prod.parts[p][k] === reh.parts[p][k];
  for (const p of [1, 2, 4, 6]) for (const k of both(p)) out.push(eq(p, k) ? finding("MATCH", p, k, "equal") : stop(p, k, "a MATCH fact differs"));
  for (const k of both(3)) {
    const [, role, scope] = k.split("|");
    const tier = role === creator && (scope === "*" || scope === "public" || k.startsWith("implicit|"));
    out.push(eq(3, k) ? finding("MATCH", 3, k, "equal") : stop(3, k, tier ? "the object-creating role's default ACL differs" : "a default ACL row differs; not a named residual"));
  }
  for (const k of both(5)) {
    const nameOnly = prod.parts[5][k] === "<name only>" || reh.parts[5][k] === "<name only>";
    if (eq(5, k)) out.push(finding("MATCH", 5, k, "equal"));
    else if (nameOnly && (!Object.hasOwn(prod.parts[5], k) || !Object.hasOwn(reh.parts[5], k))) residual(5, k, "R-SET", "an unlisted setting on one side only, known by name only");
    else out.push(stop(5, k, "an allowlisted setting differs"));
  }
  for (const k of both(7)) {
    if (eq(7, k)) out.push(finding("MATCH", 7, k, "equal"));
    else if (k === "ext|pgcrypto") out.push(stop(7, k, "pgcrypto is in part 6's closure"));
    else residual(7, k, "R-EXT", "an extension outside part 6's closure differs");
  }
  for (const k of both(8)) {
    if (eq(8, k)) out.push(finding("MATCH", 8, k, "equal"));
    else residual(8, k, "R-IMG", "an event trigger on the path differs");
  }
  const minor = (o) => Math.floor(Number(o.parts[9].server_version_num) / 100);
  if (minor(prod) !== minor(reh)) out.push(stop(9, "server_version_num", "a major or minor server change is reviewed"));
  else if (prod.parts[9].server_version_num !== reh.parts[9].server_version_num) residual(9, "server_version_num", "R-VER", "a different build within the same minor version");
  else out.push(finding("MATCH", 9, "server_version_num", "equal"));
  if (eq(9, "version")) out.push(finding("MATCH", 9, "version", "equal"));
  else residual(9, "version", "R-IMG", "the image's version string differs");
  for (const k of both(10)) out.push(finding("RECORDED", 10, k, `production ${prod.parts[10][k]}, rehearsal ${reh.parts[10][k]}`));
  residual(0, "auth-config", "R-AUTHCFG", "the Auth service's configuration is not readable by SQL");
  return out;
}

/**
 * §6.4's data scope around production P1′: `before` is the window-start P0′,
 * `after` the P0′ after P1′. The ledger and every MATCH fact of parts 1 to 9
 * equal, the STOP data rows equal, pending_jobs recorded.
 */
export function dataScope(before, after) {
  for (const [label, o] of [["the window-start P0′", before], ["the P0′ after P1′", after]]) if (!o || o.problems.length) return [stop(0, null, `${label} is missing or not self-consistent`)];
  const out = [];
  for (let p = 1; p <= 9; p++) out.push(...sameFacts(p, after.parts[p], before.parts[p], "the window-start P0′"));
  for (const k of DATA_SCOPE.stop) if (after.parts[10][k] !== before.parts[10][k]) out.push(stop(10, k, "differs from the window-start P0′; not read as proof that P1′ committed"));
  for (const [k, why] of Object.entries(DATA_SCOPE.recorded)) out.push(finding("RECORDED", 10, k, `${before.parts[10][k]} -> ${after.parts[10][k]}: ${why}`));
  return out;
}

/** The findings that block: every STOP. */
export const blocking = (findings) => findings.filter((f) => f.verdict === "STOP");
