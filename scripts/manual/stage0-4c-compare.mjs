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
//   requiredFindings the facts every reading must hold, present and usable,
//                    whatever the other side of a comparison shows;
//   p0Findings       P0′: state 01 and only 01 (§6.4's baseline-only
//                    preconditions);
//   postFindings     POST′: one intended state (STEP_STATES), against the
//                    project's bound baseline and the previous accepted
//                    readback;
//   otherRoleRows    the rule the other roles' Release 2 EXECUTE rows follow,
//                    from a bound baseline (for the test that the literal
//                    rows a binding commit adds agree with it);
//   crossProject     the tier table (TIERS) between two projects' baselines;
//   dataScope        §6.4's data facts around P1′ on production;
//   build00LedgerFindings  what BUILD-00's guarded ledger read leaves for
//                    BUILD-01 (§2.1);
//   buildPredicateFindings  the preflight table's predicates (§2.1);
//   build01Facts     what BUILD-01 binds, from the two accepted readings.
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

/** The binding a reviewed first receipt is pinned by: its parts' md5s and the whole's. It holds requiredFindings' facts, or it is not bound. */
export function bindReceipt(obs) {
  if (obs.problems.length) throw new Error(`a reading with problems cannot be bound: ${obs.problems.join("; ")}`);
  const unusable = requiredFindings(obs);
  if (unusable.length) throw new Error(`a reading without its required facts cannot be bound: ${unusable.map((f) => `${f.key}: ${f.reason}`).join("; ")}`);
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

// ── the facts every reading must hold ──────────────────────────────────────

/** The four dependency functions of part 6, by signature (plan §2.2). */
export const REQUIRED_FUNCTIONS = Object.freeze(["extensions.gen_random_bytes(integer)", "extensions.digest(bytea, text)", "extensions.digest(text, text)", "auth.uid()"]);
const TEXT_TYPE = /^(character varying(\([0-9]+\))?|text)$/;
/** The auth.users columns P1′'s fixtures write, with the types their literals assign to. */
export const REQUIRED_AUTH_COLUMNS = Object.freeze({ instance_id: /^uuid$/, id: /^uuid$/, aud: TEXT_TYPE, role: TEXT_TYPE, email: TEXT_TYPE });
/** The roles whose attributes and dependency EXECUTE rows every reading holds. */
export const REQUIRED_ROLES = Object.freeze(["postgres", ...V2_ROLES]);
/** The object types of pg_default_acl, each of which a reading covers for `postgres` by a global row or an implicit one. */
const DEFAULT_ACL_TYPES = Object.freeze(["r", "S", "f", "T", "n"]);

const isCount = (v) => typeof v === "string" && /^(0|[1-9][0-9]*)$/.test(v);
const isBool = (v) => v === "true" || v === "false";
/** A PostgreSQL 17 or later server_version_num: major × 10000 + minor. */
const isServerNum = (v) => typeof v === "string" && /^[1-9][0-9]{5}$/.test(v) && Number(v) >= 170000;
const usableDataFact = (k, v) => (k.startsWith("digest|") ? typeof v === "string" && md5Hex.test(v) : k.startsWith("count|") || k === "free_pins" || k === "stores_without_org" ? isCount(v) : isBool(v));

/**
 * STOP findings for each fact the reviewed contract needs and `obs` does not
 * hold in a usable form: absent, the `<absent>` sentinel, or the wrong shape.
 * It reads one reading, so a fact two readings both lack still stops. An
 * optional setting (part 5) and an empty part 8 are not in it.
 */
export function requiredFindings(obs) {
  const out = [];
  const need = (part, key, ok, what) => {
    if (!Object.hasOwn(obs.parts[part], key)) out.push(stop(part, key, `a required fact is missing: ${what}`));
    else if (!ok(obs.parts[part][key])) out.push(stop(part, key, `a required fact is not usable (${obs.parts[part][key]}): ${what}`));
  };
  need(1, "columns", (v) => v !== "", "the ledger's columns");
  need(1, "count", isCount, "the ledger's row count");
  need(1, "head", (v) => /^[0-9]{14}$/.test(v), "the ledger's head");
  need(2, "fingerprint", (v) => md5Hex.test(v), "P0's catalog_fingerprint");
  need(2, "schema|public", (v) => /^[^|]+\|/.test(v), "public's owner and ACL");
  for (const t of DEFAULT_ACL_TYPES) {
    const row = Object.hasOwn(obs.parts[3], `row|postgres|*|${t}`), implicit = Object.hasOwn(obs.parts[3], `implicit|postgres|${t}`);
    if (row === implicit) out.push(stop(3, `postgres|${t}`, `a required fact: postgres's default for ${t} is exactly one of a global row and an implicit default; this reading has ${row ? "both" : "neither"}`));
  }
  for (const r of REQUIRED_ROLES) {
    need(4, `attr|${r}`, (v) => /^((true|false)\|){7}-?[0-9]+$/.test(v), `${r}'s attributes`);
    for (const sig of REQUIRED_FUNCTIONS) need(4, `exec|${r}|${sig}`, isBool, `${r}'s EXECUTE on ${sig}`);
  }
  need(6, "pgcrypto", (v) => /^[^|<]+\|extensions$/.test(v), "pgcrypto, in the extensions schema");
  for (const sig of REQUIRED_FUNCTIONS) need(6, `fn|${sig}`, (v) => /^[^|<]+\|[ivs]\|[0-9a-f]{32}$/.test(v), `${sig}: its owner, volatility and definition's md5`);
  for (const [c, type] of Object.entries(REQUIRED_AUTH_COLUMNS)) need(6, `authusers-col|${c}`, (v) => { const f = v.split("|"); return f.length >= 3 && type.test(f[0]) && isBool(f[1]); }, `auth.users.${c}, which P1′'s fixtures write`);
  need(6, "authusers-notnull-nodefault", (v) => v === "" || v.split(",").every((c) => Object.hasOwn(REQUIRED_AUTH_COLUMNS, c)), "no NOT NULL column without a default beyond those P1′'s fixtures write");
  need(6, "authusers-user-triggers", (v) => v === "0", "auth.users has no user trigger");
  need(7, "ext|pgcrypto", (v) => v === obs.parts[6].pgcrypto, "pgcrypto's extension row, as part 6 reads it");
  need(9, "server_version_num", isServerNum, "a PostgreSQL 17 or later server");
  need(9, "version", (v) => v !== "", "the server's version string");
  for (const k of [...DATA_SCOPE.stop, ...Object.keys(DATA_SCOPE.recorded)]) need(10, k, (v) => usableDataFact(k, v), "a fixed data-scope fact");
  return out;
}
const requiredOf = (label, o) => requiredFindings(o).map((f) => ({ ...f, reason: `${label}: ${f.reason}` }));

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
  const out = [...requiredFindings(obs), ...ledgerShapeFindings(manifest, obs)];
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
  const p10 = obs.parts[10];
  if (p10.probe_slug_absent !== "true") out.push(stop(10, "probe_slug_absent", "the probe identity is present"));
  if (p10.nil_job_absent !== "true") out.push(stop(10, "nil_job_absent", "the nil job identity is present"));
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
  const out = [...requiredFindings(obs), ...requiredOf("the baseline", baseline), ...(previous === baseline ? [] : requiredOf("the previous readback", previous)), ...ledgerShapeFindings(manifest, obs)];

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
    else {
      out.push(...requiredOf("the window-start P0′", windowStart));
      for (const k of DATA_SCOPE.stop) if (obs.parts[10][k] !== windowStart.parts[10][k]) out.push(stop(10, k, "differs from the window-start P0′"));
    }
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
 * names. `records` maps a residual's name, or "<name>|<key>", to its record;
 * an event trigger's difference takes only its own "R-IMG|evt|<trigger>", so
 * a generic R-IMG record never covers one. Whether a record says enough is
 * review's; this checks that the one it needs is there. `images` is the two
 * projects' image versions, { production, rehearsal }, as the Management API's
 * project list reports them: no SQL read shows them. This compares only the
 * two strings it is given and enforces nothing about where they came from. X4's
 * gate, which does not exist yet, must bind each to its project's ref, its
 * observation's source and time and a reviewed evidence record (plan §0.4), and
 * must never default one from a SQL version or reuse an older observation. Equal
 * strings show equal metadata, not equal Auth, Storage, route or platform
 * behaviour. Part 2's `schema|public` compares the schema's owner and its
 * grantee, privilege and grant-option entries, not who granted them: complete
 * grant provenance, and what a cascading REVOKE would later remove, are outside
 * it. Each reading must first hold requiredFindings' facts. Every fact of either
 * reading gets one finding.
 */
export function crossProject(prod, reh, { creator, records = {}, images } = {}) {
  for (const [label, o] of [["production's baseline", prod], ["the rehearsal's baseline", reh]]) if (!o || o.problems.length) return [stop(0, null, `${label} is missing or not self-consistent`)];
  const out = [...requiredOf("production's baseline", prod), ...requiredOf("the rehearsal's baseline", reh)];
  const recordFor = (k) => (isObj(records) && Object.hasOwn(records, k) && typeof records[k] === "string" && records[k].trim() ? records[k] : null);
  const residual = (part, key, name, why, { ownOnly = false } = {}) => {
    const rec = recordFor(`${name}|${key}`) ?? (ownOnly ? null : recordFor(name));
    out.push(rec ? finding("RESIDUAL", part, key, `${name}: ${why}; recorded: ${rec}`) : stop(part, key, `${name}: ${why}, with no record${ownOnly ? ` under ${name}|${key}` : ""}`));
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
    else residual(8, k, "R-IMG", "an event trigger on the path differs", { ownOnly: true });
  }
  // From PostgreSQL 10 the number is major × 10000 + minor, so it holds no
  // build: any difference is a major or minor change. A build or an image
  // shows only in its own evidence, below.
  const num = (o) => o.parts[9].server_version_num;
  if (num(prod) !== num(reh)) out.push(stop(9, "server_version_num", `a major or minor server change is reviewed: ${num(prod)} and ${num(reh)}`));
  else out.push(finding("MATCH", 9, "server_version_num", "equal"));
  if (eq(9, "version")) out.push(finding("MATCH", 9, "version", "equal"));
  else residual(9, "version", "R-VER", "version() differs at one server_version_num: a different build");
  const image = (k) => (isObj(images) && typeof images[k] === "string" && images[k].trim() ? images[k] : null);
  if (!image("production") || !image("rehearsal")) out.push(stop(9, "image", "the two projects' image versions are not given; no SQL read shows them"));
  else if (image("production") === image("rehearsal")) out.push(finding("MATCH", 9, "image", "equal"));
  else residual(9, "image", "R-IMG", `the images differ: ${image("production")} and ${image("rehearsal")}`);
  for (const k of both(10)) out.push(finding("RECORDED", 10, k, `production ${prod.parts[10][k]}, rehearsal ${reh.parts[10][k]}`));
  residual(0, "auth-config", "R-AUTHCFG", "the Auth service's configuration is not readable by SQL");
  return out;
}

/**
 * §6.4's data scope around production P1′: `before` is the window-start P0′,
 * `after` the P0′ after P1′. Each must hold requiredFindings' facts, so two
 * missing values are never equal. The ledger and every MATCH fact of parts 1
 * to 9 equal, the STOP data rows equal, pending_jobs recorded.
 */
export function dataScope(before, after) {
  for (const [label, o] of [["the window-start P0′", before], ["the P0′ after P1′", after]]) if (!o || o.problems.length) return [stop(0, null, `${label} is missing or not self-consistent`)];
  const out = [...requiredOf("the window-start P0′", before), ...requiredOf("the P0′ after P1′", after)];
  for (let p = 1; p <= 9; p++) out.push(...sameFacts(p, after.parts[p], before.parts[p], "the window-start P0′"));
  for (const k of DATA_SCOPE.stop) if (after.parts[10][k] !== before.parts[10][k]) out.push(stop(10, k, "differs from the window-start P0′; not read as proof that P1′ committed"));
  for (const [k, why] of Object.entries(DATA_SCOPE.recorded)) out.push(finding("RECORDED", 10, k, `${before.parts[10][k]} -> ${after.parts[10][k]}: ${why}`));
  return out;
}

// ── BUILD-00's guarded ledger read ─────────────────────────────────────────

/** Production's six ledger columns as BUILD-00 reads them from pg_attribute: name, type, NOT NULL, default. */
export const LEDGER_COLUMNS = "version:text:true:, statements:text[]:false:, name:text:false:, created_by:text:false:, idempotency_key:text:false:, rollback:text[]:false:";
const LEDGER_NOT_READ = "<not read>";
/** The one-row-each facts BUILD-00 always reports; a relation may add constraint| and trigger| facts. */
const LEDGER_FACTS = Object.freeze(["schema", "table", "relation", "columns", "status", "rows"]);
/**
 * The one relation form the read may have come from, as relkind|owner|rls|force:
 * an ordinary table owned by postgres, RLS off and not forced. Any other owner
 * or flag stops for review, including a table with RLS on whose reader is
 * exempt, which the text itself reports as readable.
 */
const LEDGER_RELATION = "r|postgres|false|false";
/**
 * The one result an empty ledger may show: query_to_xml's document for no row,
 * as PostgreSQL 17.5 serialized it (run L). It is compared byte for byte, with
 * no XML parser, so a result in any other form stops, even a well-formed one
 * that holds no row.
 */
const LEDGER_EMPTY_DOCUMENT = `<table xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">\n\n</table>\n`;
/**
 * Each status the text reports: the schema and table facts it implies (null,
 * either), whether its query_to_xml ran, whether it says no relation is there,
 * and, unless BUILD-01 may go on, why it stops. A denied or hidden read is
 * never an empty ledger.
 */
const LEDGER_STATUS = Object.freeze({
  "absent-schema": { schema: "false", table: "false", read: false, absent: true },
  "absent-table": { schema: "true", table: "false", read: false, absent: true },
  empty: { schema: "true", table: "true", read: true },
  "denied-schema": { schema: "true", table: null, read: false, stops: "the reader has no USAGE on the ledger's schema: its contents are unknown" },
  "unsupported-shape": { schema: "true", table: "true", read: false, stops: "the ledger is not an ordinary table with production's six columns" },
  "denied-read": { schema: "true", table: "true", read: false, stops: "the reader may not read the ledger: its rows are unknown" },
  "hidden-read": { schema: "true", table: "true", read: false, stops: "row security is active for the reader: its rows may be hidden" },
  populated: { schema: "true", table: "true", read: true, stops: "the ledger already holds rows: a pre-existing ledger needs its own review before BUILD-01" },
});

/**
 * Whether BUILD-00's rows (its `ledger` part is read) leave BUILD-01 free to
 * go on. Two results can:
 *   nothing there   absent-schema or absent-table, with the matching schema
 *                   and table facts, an empty relation and columns, no
 *                   constraint or trigger fact, and nothing read;
 *   no row          empty, with the exact relation form, the six columns and
 *                   the exact empty document.
 * Anything else is a STOP, malformed input and an unknown fact included. An
 * empty ledger's constraints and triggers are reported, not judged here:
 * binding a pre-existing shape is the binding commit's (plan §2.1 and §10).
 * `populated` stops whatever its document holds, so its rows are not parsed.
 */
export function build00LedgerFindings(rows) {
  if (!Array.isArray(rows)) return [stop("ledger", null, "BUILD-00's reading is not a list of rows")];
  const facts = Object.create(null);
  for (const r of rows) {
    if (!isObj(r)) return [stop("ledger", null, "a row is not an object")];
    if (r.part !== "ledger") continue;
    if (typeof r.key !== "string" || typeof r.value !== "string") return [stop("ledger", null, "a ledger row is not text")];
    if (Object.hasOwn(facts, r.key)) return [stop("ledger", r.key, "the key appears twice")];
    facts[r.key] = r.value;
  }
  const missing = LEDGER_FACTS.filter((k) => !Object.hasOwn(facts, k));
  if (missing.length) return missing.map((k) => stop("ledger", k, "BUILD-00 did not report it"));
  if (!Object.hasOwn(LEDGER_STATUS, facts.status)) return [stop("ledger", "status", `not a status BUILD-00 reports: ${facts.status}`)];
  const want = LEDGER_STATUS[facts.status];
  const out = [finding("RECORDED", "ledger", "status", facts.status)];
  if (want.stops) out.push(stop("ledger", "status", `${facts.status}: ${want.stops}`));
  if (facts.schema !== want.schema) out.push(stop("ledger", "schema", `${facts.schema}, under the status ${facts.status}`));
  if (want.table !== null && facts.table !== want.table) out.push(stop("ledger", "table", `${facts.table}, under the status ${facts.status}`));
  for (const k of Object.keys(facts)) {
    if (LEDGER_FACTS.includes(k)) continue;
    if (!/^(constraint|trigger)\|/.test(k)) out.push(stop("ledger", k, "not a fact BUILD-00 reports"));
    else if (want.absent) out.push(stop("ledger", k, `a relation's fact, under the status ${facts.status}, which has no relation`));
  }
  if (want.absent) {
    if (facts.relation !== "") out.push(stop("ledger", "relation", `${facts.relation}, under the status ${facts.status}, which has no relation`));
    if (facts.columns !== "") out.push(stop("ledger", "columns", `a relation's columns, under the status ${facts.status}, which has no relation`));
  }
  if (want.read) {
    if (facts.columns !== LEDGER_COLUMNS) out.push(stop("ledger", "columns", "the rows were read from a table without production's six columns"));
    if (facts.relation !== LEDGER_RELATION) out.push(stop("ledger", "relation", `${facts.relation}: not the one relation form reviewed, ${LEDGER_RELATION}`));
    if (facts.status === "empty" && facts.rows !== LEDGER_EMPTY_DOCUMENT) out.push(stop("ledger", "rows", "not the reviewed empty document, byte for byte"));
  } else if (facts.rows !== LEDGER_NOT_READ) out.push(stop("ledger", "rows", `a result under the status ${facts.status}, which reads nothing`));
  return out;
}

// ── BUILD-00's and BUILD-00W's preflight, and the facts BUILD-01 binds ─────

/** The rows of a reading by part and key, or null when one is not a row of text, or a key appears twice. */
function factsByPart(rows) {
  if (!Array.isArray(rows)) return null;
  const out = Object.create(null);
  for (const r of rows) {
    if (!isObj(r) || typeof r.part !== "string" || typeof r.key !== "string" || typeof r.value !== "string") return null;
    out[r.part] ??= Object.create(null);
    if (Object.hasOwn(out[r.part], r.key)) return null;
    out[r.part][r.key] = r.value;
  }
  return out;
}
const TEXT_LIKE = /^(text|character varying(\([0-9]+\))?)\|/;
/**
 * The preflight table's predicates (plan §2.1), each a name and what it asks of
 * the two readings, b (BUILD-00) and w (BUILD-00W, read as the role BUILD-01 will
 * run as). BUILD-01 asks the same again in SQL, under the same names
 * (assemble-stage0.mjs); the local run shows the two agree on each shape it tries
 * (stage0-4c-writing.test.js). A missing fact fails its predicate.
 */
const BUILD_PREDICATES = Object.freeze({
  "public-empty": (b) => !b.public,
  ledger: (b, w, f) => b.ledger?.status === f.ledger,
  "buckets-present": (b) => b.buckets?.present === "true",
  "buckets-columns": (b) => {
    const c = (n) => b.buckets?.[`column|${n}`] ?? "";
    return TEXT_LIKE.test(c("id")) && TEXT_LIKE.test(c("name")) && /^boolean\|/.test(c("public")) && /^(bigint|integer)\|/.test(c("file_size_limit")) && /^text\[\]\|/.test(c("allowed_mime_types")) && /^timestamp with time zone\|/.test(c("updated_at"));
  },
  "buckets-notnull": (b) => !Object.entries(b.buckets ?? {}).some(([k, v]) => k.startsWith("column|") && /^[^|]*\|true\|\|\|$/.test(v) && !["column|id", "column|name", "column|public"].includes(k)),
  "buckets-generated": (b) => ["id", "name", "public", "file_size_limit", "allowed_mime_types", "updated_at"].every((n) => { const v = b.buckets?.[`column|${n}`]; return v === undefined || /\|d?\|$/.test(v); }),
  "buckets-arbiter": (b) => Object.entries(b.buckets ?? {}).some(([k, v]) => k.startsWith("unique-index|") && / ON storage\.buckets USING btree \(id\)$/.test(v)),
  "buckets-authority": (b, w) => ["schema_usage", "insert|id", "insert|name", "insert|public", "insert|file_size_limit", "insert|allowed_mime_types", "update|public", "update|file_size_limit", "update|allowed_mime_types", "update|updated_at", "select"].every((k) => w.buckets?.[k] === "true"),
  "buckets-rls": (b, w) => w.buckets?.rls_applies === "false",
  "buckets-rows": (b, w) => w.buckets?.["row|job-files"] === "false" && w.buckets?.["row|customer-uploads"] === "false",
  "objects-table": (b) => (b.objects?.table ?? "").startsWith("r|") && b.objects?.["column|bucket_id"] === "text",
  "objects-policies": (b) => !["policy|job_files_anon_insert", "policy|job_files_anon_select", "policy|job_files_anon_delete"].some((k) => Object.hasOwn(b.objects ?? {}, k)),
  "objects-authority": (b, w) => w.objects?.owner_privileges === "true",
  "publication-present": (b) => /^[^|]*\|false\|/.test(b.publication?.["pub|supabase_realtime"] ?? ""),
  "publication-member": (b) => !Object.hasOwn(b.publication ?? {}, "member|public.pending_jobs"),
  "publication-authority": (b, w) => w.publication?.owner_privileges === "true",
  "authusers-columns": (b) => {
    const c = (n) => b.authusers?.[`column|${n}`] ?? "";
    return /^uuid\|/.test(c("instance_id")) && /^uuid\|/.test(c("id")) && TEXT_LIKE.test(c("aud")) && TEXT_LIKE.test(c("role")) && TEXT_LIKE.test(c("email"));
  },
  "authusers-notnull": (b) => {
    const v = b.authusers?.["notnull-nodefault"];
    return typeof v === "string" && (v === "" || v.split(",").every((c) => ["instance_id", "id", "aud", "role", "email"].includes(c)));
  },
  "authusers-authority": (b, w) => ["insert", "select", "references|id"].every((k) => w.authusers?.[k] === "true"),
  "authusers-rls": (b, w) => w.authusers?.rls_applies === "false",
  "authusers-triggers": (b) => b.authusers?.["user-triggers"] === "0",
  "marker-absent": (b) => b.schemas?.["schema|stage0_rehearsal"] === "<absent>",
  "database-create": (b, w) => w.database?.create === "true",
  creator: (b, w, f) => w.role?.name === f.creator || Object.hasOwn(w.role ?? {}, `member|${f.creator}`) || (w.role?.attr ?? "").split("|")[0] === "true",
});
export const BUILD_PREDICATE_NAMES = Object.freeze(Object.keys(BUILD_PREDICATES));

/**
 * Each predicate that does not hold, as a STOP under its name. `ledger` is the
 * status BUILD-00 reported, for the predicate of that name; `creator` is the
 * object-creating role. A reading that is not rows of text is a STOP.
 */
export function buildPredicateFindings(build00, build00w, { creator, ledger } = {}) {
  const b = factsByPart(build00), w = factsByPart(build00w);
  if (!b || !w) return [stop("build", null, "BUILD-00's or BUILD-00W's reading is not rows of text, each key once")];
  return Object.entries(BUILD_PREDICATES).filter(([, ok]) => ok(b, w, { creator, ledger }) !== true).map(([name]) => stop("build", name, "the preflight predicate does not hold"));
}

/** Each part's digest: md5 over key TAB value LF, keys in byte order, as BUILD-01 computes it in SQL. */
export function partDigests(rows) {
  const by = factsByPart(rows);
  if (!by) throw new TypeError("not rows of text, each key once");
  const cmp = (a, c) => Buffer.compare(Buffer.from(a), Buffer.from(c));
  return Object.fromEntries(Object.keys(by).sort(cmp).map((part) => [part, md5(Object.keys(by[part]).sort(cmp).map((k) => `${k}\t${by[part][k]}\n`).join(""))]));
}

/**
 * The default ACL rows of `reading`'s part for one role at the two scopes, as
 * `<scope>|<type>` to ACL. `part` is "defaults" in BUILD-00 and 3 in the checked
 * state. A global row, or else its implicit row, gives each type's set; the public
 * scope has only its rows. A type with neither at the global scope is an error.
 */
export function defaultsOf(rows, part, role) {
  const out = {};
  const of = (key) => rows.find((r) => isObj(r) && r.part === part && r.key === key)?.value;
  for (const t of ["r", "S", "f", "T", "n"]) {
    const v = of(`row|${role}|*|${t}`) ?? of(`implicit|${role}|${t}`);
    if (typeof v !== "string") throw new TypeError(`no default ACL for ${role} on ${t}`);
    out[`*|${t}`] = v;
  }
  for (const t of ["r", "S", "f", "T"]) out[`public|${t}`] = of(`row|${role}|public|${t}`) ?? "";
  return out;
}

/**
 * What BUILD-01 binds, from BUILD-00's and BUILD-00W's accepted readings: a STOP
 * from the ledger's rule or any predicate gives no facts. `creator` is the role
 * BUILD-00W reports. `finalFrom` is production's bound checked state, whose part 3
 * gives the target after the files. Review of the receipts is what accepts them;
 * this only refuses what cannot be bound.
 */
export function build01Facts({ build00, build00w, ref, finalFrom, employees = 2 }) {
  const ledgerRows = build00LedgerFindings(build00);
  const b = factsByPart(build00), w = factsByPart(build00w);
  const creator = w?.role?.name;
  const ledger = b?.ledger?.status;
  const findings = [...ledgerRows, ...buildPredicateFindings(build00, build00w, { creator, ledger })];
  if (blocking(findings).length) return { findings, facts: null };
  if (!Array.isArray(finalFrom)) return { findings: [...findings, stop("build", "finalFrom", "production's checked state is not given")], facts: null };
  try {
    return {
      findings,
      facts: { ref, creator, ledger, employees, digests: { build00: partDigests(build00), build00w: partDigests(build00w) }, defaultsNow: defaultsOf(build00, "defaults", creator), defaultsFinal: defaultsOf(finalFrom, 3, creator) },
    };
  } catch (e) {
    return { findings: [...findings, stop("build", "defaults", e.message)], facts: null };
  }
}

/** The findings that block: every STOP. */
export const blocking = (findings) => findings.filter((f) => f.verdict === "STOP");
