// scripts/tests/stage0-item3-fixture.mjs — the synthetic receipts and answers
// item 3's tests share (stage0-item3.test.js and its mutation companion
// stage0-item3.mutation.test.js). Nothing here touches a store or a network.
import * as I from "../manual/stage0-item3.mjs";
import { sha256 } from "../manual/stage0-guard.mjs";
import { M, ctx } from "./stage0-guard-fixture.mjs";

export const STAGING = "lboajqihpsfrokqvjgnl";
export const PRODUCTION = "gmxyisjjaxtpycsmmzef";

/** A receipt of the sender's shape for a text, bound to its pin in `manifest`. */
export function receiptFor(text, httpStatus, body, extra = {}, manifest = M, target = "staging") {
  const pin = manifest.outputs[text];
  const ref = manifest.send.targets[target];
  return JSON.stringify({
    tool: manifest.sender.path, text, target, ref, readOnly: manifest.send.texts[text].readOnly === true, requestMd5: pin.md5, requestBytes: pin.bytes,
    endpoint: manifest.send.endpoint.replace("{ref}", ref), startedAt: "2026-10-28T14:00:00.000Z", finishedAt: "2026-10-28T14:00:01.000Z",
    httpStatus, body, error: null, tokenRedactedFromResponse: false, ...extra,
  }, null, 2) + "\n";
}

export const BASE = [["open", "r"], ["open_pkey", "i"], ["owned", "r"], ["owned_pkey", "i"]];
export const row = (id, label, login = "postgres", ro = "off") => ({ id, label, login_role: login, session_role: login, tx_read_only: ro, written_at: "2026-10-28 14:00:00.123456+00" });
export const readbackValues = ({ owned = [], open = [], ddl = [] } = {}) => ({
  owned, open, objects: [...BASE, ...ddl.map((n) => [n, "r"])].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([name, kind]) => ({ name, kind, owner: "postgres" })),
});
export const readback = (o) => JSON.stringify([readbackValues(o)]);
export const FIXTURE = (over = {}) => JSON.stringify([{
  schema_owner: "postgres", schema_acl: "{postgres=UC/postgres,=UC/postgres}",
  tables: [
    { name: "open", owner: "postgres", acl: "{postgres=arwdDxtm/postgres,=ar/postgres}", rls: false, force_rls: false },
    { name: "owned", owner: "postgres", acl: "{postgres=arwdDxtm/postgres}", rls: false, force_rls: false },
  ],
  policies: 0, triggers: 0, rules: 0, objects: BASE.map(([name, kind]) => ({ name, kind })),
  default_acls: [{ role: "postgres", schema: "*", type: "r", acl: "{anon=arwdDxtm/postgres}" }], ...over,
}]);
export const WHO = (login, ro) => JSON.stringify([{ login_role: login, session_role: login, tx_read_only: ro ? "on" : "off", default_tx_read_only: "off", superuser: false, bypass_rls: false,
  write_all_data: false, read_all_data: true, schema_usage: true, schema_create: true, owned_insert: false, owned_select: true, open_insert: true, open_select: true }]);
export const R = I.REFUSALS;
export const REF = (r) => [400, I.refusalBody(r)];

/** E17's readback values on a branch (`wrote` names the measured steps that WROTE). */
export function finalValues(wrote = []) {
  const w = (s) => wrote.includes(s);
  return readbackValues({
    owned: [row(4, "I3-INS-OWNED-W-DEF"), ...(w("E15") ? [row(6, "I3-INS-OWNED-R-DEF", "supabase_read_only_user")] : [])],
    open: w("E14") ? [row(5, "I3-INS-OPEN-R-DEF", "supabase_read_only_user")] : [],
    ddl: ["ddl_w", ...(w("E16") ? ["ddl_r"] : [])],
  });
}

/**
 * Each step's declared answer on one branch: `wrote` names the measured steps
 * (E14, E15, E16) that WROTE; the others are REFUSED.
 */
export function answers(wrote = []) {
  const w = (s) => wrote.includes(s);
  return {
    E1: [201, '[{"setup":"stage0_item3 ready"}]'], E2: [201, FIXTURE()], E3: [201, readback()],
    E4: [201, WHO("supabase_read_only_user", true)], E5: [201, WHO("supabase_read_only_user", false)],
    E6: [201, WHO("supabase_read_only_user", true)], E7: [201, WHO("postgres", false)],
    E8: REF(R.insertReadOnly), E9: REF(R.insertReadOnly), E10: REF(R.insertReadOnly),
    E11: [201, '[{"id":4,"label":"I3-INS-OWNED-W-DEF"}]'], E12: [201, '[{"created":true}]'],
    E13: [201, readback({ owned: [row(4, "I3-INS-OWNED-W-DEF")], ddl: ["ddl_w"] })],
    E14: w("E14") ? [201, '[{"id":5,"label":"I3-INS-OPEN-R-DEF"}]'] : REF(R.insertReadOnly),
    E15: w("E15") ? [201, '[{"id":6,"label":"I3-INS-OWNED-R-DEF"}]'] : REF(R.ownedDenied),
    E16: w("E16") ? [201, '[{"created":true}]'] : REF(R.createReadOnly),
    E17: [201, JSON.stringify([finalValues(wrote)])],
    X1: [201, '[{"gone":true}]'], X2: [201, '[{"gone":true}]'],
  };
}

/** checkStep for one step's answer, with the module `mod` (the gate under test, or a mutant of it). */
export const check = (id, [status, body], mod = I) => mod.checkStep(id, receiptFor(mod.STEPS[id].text, status, body), ctx());

/** Every E result on a branch, with `over` replacing some steps' answers. */
export const eResults = (branch, over = {}, mod = I) => mod.PHASES.E.steps.map((id) => check(id, over[id] || answers(branch)[id], mod));

/** The rows the separate-credential read returns for E17's values `v`, as execute_sql gives them. */
export function corroborationRows(v) {
  const pick = (t, r) => ({ t, id: r.id, label: r.label, login_role: r.login_role, session_role: r.session_role, tx_read_only: r.tx_read_only });
  return [
    ...v.objects.map((o) => ({ t: "object", id: null, label: `${o.name}:${o.kind}`, login_role: o.owner, session_role: null, tx_read_only: null })),
    ...v.open.map((r) => pick("open", r)),
    ...v.owned.map((r) => pick("owned", r)),
  ];
}

/**
 * One journal entry whose receipt is a transport failure, bound to its claim
 * (the shape boundReceipt reads), for `text` under `manifest`. Returns the
 * entry and a readReceipt that serves its bytes: holdsOf on it is the
 * project's hold decision for that attempt.
 */
export function failedEntry(text, manifest, target = "staging") {
  const ref = manifest.send.targets[target];
  const pin = manifest.outputs[text];
  const readOnly = manifest.send.texts[text].readOnly === true;
  const endpoint = manifest.send.endpoint.replace("{ref}", ref);
  const claim = {
    schema: "stage0-claim/1", attemptId: "1".repeat(32), seq: 1, goId: "2".repeat(32), phaseId: "3".repeat(32), step: "E9", text, target, ref, role: "R",
    markerId: "4".repeat(32), shell: { pid: 1001, image: "powershell.exe", created: "2026-10-28T13:00:00.0000000Z" }, head: "0".repeat(40), checkout: "C:/synthetic",
    request: { md5: pin.md5, bytes: pin.bytes, readOnly, endpoint }, issuedAt: "2026-10-28T13:59:00.000Z", deadline: "2026-10-28T15:00:00.000Z", claimedAt: "2026-10-28T14:00:00.000Z",
  };
  const guard = { attemptId: claim.attemptId, goId: claim.goId, phaseId: claim.phaseId, step: claim.step, markerId: claim.markerId, role: claim.role, head: claim.head, issuedAt: claim.issuedAt, deadline: claim.deadline };
  const bytes = Buffer.from(receiptFor(text, null, null, { error: "TypeError: fetch failed", guard }, manifest, target));
  const entry = {
    attemptId: claim.attemptId, claim, disposition: null, problems: [],
    outcome: { schema: "stage0-outcome/1", attemptId: claim.attemptId, state: "DISPATCHED", at: "2026-10-28T14:00:01.000Z", receipt: { file: "synthetic-receipt.json", sha256: sha256(bytes), bytes: bytes.length }, httpStatus: null },
  };
  return { entry, bytes, readReceipt: () => bytes };
}

/** A context whose manifest is `manifest`, serving `aliases` (new name → existing text) as assembled texts. */
export function ctxWith(manifest, aliases = {}) {
  const base = ctx();
  const texts = { ...base.texts };
  for (const [name, of] of Object.entries(aliases)) texts[name] = base.texts[of];
  return { ...base, manifest, texts };
}
