#!/usr/bin/env node
// Local rehearsal of item 3's phase E and its separate-credential read in a
// REAL Postgres (PGlite, PG 17 compiled to WASM): a pre-review check, NOT
// evidence about Supabase's roles, tokens or the Management API
// (docs/security/stage0-item3-runbook.md §6; Codex, review of ba1a0bd, R-R3).
//
// For each branch it runs the pinned texts of E1 to E17, in order, in a fresh
// database, with SYNTHETIC roles:
//   - the W window is postgres; the R window is the role i3_reader;
//   - a read_only request is BEGIN READ ONLY;
//   - "wrote": i3_reader's requests without read_only run as they are, so
//     E14 (open) and E16 (CREATE) write, and E15 (owned) is refused 42501;
//   - "refused": every i3_reader request runs read-only, the model of a read
//     token the server forces read-only, so E14 to E16 are refused 25006.
// Each result becomes a receipt of the sender's shape: HTTP 201 with the last
// row-returning statement's rows as JSON, or HTTP 400 with the Management
// API's message format (stage0-item3.mjs refusalBody) for an error. That
// shape is a MODEL of the API. Each receipt goes through the gate (checkStep,
// then nextStep), which must reach the branch's terminal outcome.
//
// Then, as the MCP execute_sql would, it runs CORROBORATION_SQL exactly, as
// postgres, and compares its rows (through a JSON round trip) with E17's
// readback using corroborationProblems(), as `stage0-go.mjs corroborate`
// does. Controls: the uncast form of the query (42725), and each branch's
// rows against the other branch's E17 (a disagreement).
//
// PGlite is NOT a dependency of this repository. Install it outside the repo:
//   npm install --prefix <scratch dir> @electric-sql/pglite@0.4.6
//   PGLITE_DIR=<scratch dir>/node_modules/@electric-sql/pglite node scripts/manual/stage0-item3-local-pglite.mjs [rev]
// The texts and their pins come from the manifest committed at [rev] (default
// HEAD); the gate is this checkout's stage0-item3.mjs. It prints one JSON
// document and exits 0 only if every expectation holds.
import { pathToFileURL, fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const REV = process.argv[2] || "HEAD";
if (!process.env.PGLITE_DIR) {
  process.stderr.write("set PGLITE_DIR to an installed @electric-sql/pglite package directory (see the header)\n");
  process.exit(2);
}
const { PGlite } = await import(pathToFileURL(join(process.env.PGLITE_DIR, "dist", "index.js")).href);
const C = await import(pathToFileURL(join(REPO, "scripts", "manual", "stage0-classify.mjs")).href);
const I = await import(pathToFileURL(join(REPO, "scripts", "manual", "stage0-item3.mjs")).href);
const A = await import(pathToFileURL(join(REPO, "scripts", "manual", "assemble-stage0.mjs")).href);

const ctx = C.contextAt(REV, REPO);
const M = ctx.manifest;
const STAGING = M.send.targets.staging;

/** A receipt of the sender's shape for `text` (the model of a Management API answer). */
function receipt(text, httpStatus, body) {
  const pin = M.outputs[text];
  return JSON.stringify({
    tool: M.sender.path, text, target: "staging", ref: STAGING, readOnly: M.send.texts[text].readOnly === true, requestMd5: pin.md5, requestBytes: pin.bytes,
    endpoint: M.send.endpoint.replace("{ref}", STAGING), startedAt: "2026-10-29T14:00:00.000Z", finishedAt: "2026-10-29T14:00:01.000Z",
    httpStatus, body, error: null, tokenRedactedFromResponse: false,
  }, null, 2) + "\n";
}

/** Run one text as its window's role, in its request mode; return [status, body]. */
async function request(pg, text, { readOnlyR }) {
  const p = M.send.texts[text];
  const asR = p.window === "R";
  const readOnly = p.readOnly === true || (asR && readOnlyR);
  try {
    await pg.exec(`begin${readOnly ? " read only" : ""};${asR ? " set local role i3_reader;" : ""}`);
    const res = await pg.exec(ctx.texts[text]);
    await pg.exec("commit;");
    const last = [...res].reverse().find((r) => r.fields && r.fields.length);
    return [201, JSON.stringify(last ? last.rows : [])];
  } catch (e) {
    await pg.exec("rollback;").catch(() => {});
    return [400, I.refusalBody({ code: e.code, message: e.message })];
  }
}

async function branch(name, readOnlyR) {
  const pg = new PGlite();
  const out = { branch: name, model: readOnlyR ? "every i3_reader request read-only" : "i3_reader's requests as sent", steps: [] };
  try {
    await pg.exec(`create role anon; create role authenticated; create role service_role; create role i3_reader;
      create table public.stores (id uuid primary key); insert into public.stores values ('${A.STAGING_SEED_STORE}');
      create schema supabase_migrations; create table supabase_migrations.schema_migrations (version text, name text, statements text[]);`);
    const results = [];
    for (const id of I.PHASES.E.steps) {
      const text = I.STEPS[id].text;
      const [status, body] = await request(pg, text, { readOnlyR });
      const r = I.checkStep(id, receipt(text, status, body), ctx);
      results.push(r);
      out.steps.push({ step: id, text, httpStatus: status, verdict: r.verdict, ...(r.outcome ? { outcome: r.outcome } : {}), ...(r.refusal ? { refusal: r.refusal } : {}), ...(r.verdict === "MATCH" ? {} : { reasons: r.reasons, body }) });
      const ns = I.nextStep("E", results);
      if (ns.stop) { out.gate = ns; break; }
      if (ns.next === null) out.gate = ns;
    }
    out.e17 = results.length === 17 && results[16].verdict === "MATCH" ? results[16].values : null;
    // The separate-credential read, exactly, as postgres.
    const read = await pg.query(I.CORROBORATION_SQL);
    out.corroboration = { rows: JSON.parse(JSON.stringify(read.rows)) };
    out.corroboration.problems = I.corroborationProblems(out.corroboration.rows, out.e17);
    // The uncast form, for its error.
    const uncast = I.CORROBORATION_SQL.replace("c.relkind::text", "c.relkind");
    try { await pg.query(uncast); out.uncast = "ran"; } catch (e) { out.uncast = { code: e.code, message: e.message }; }
  } finally { await pg.close(); }
  return out;
}

const version = await (async () => { const pg = new PGlite(); try { return (await pg.query("select version() as v")).rows[0].v; } finally { await pg.close(); } })();
const wrote = await branch("wrote", false);
const refused = await branch("refused", true);
const cross = {
  wroteRowsAgainstRefusedE17: I.corroborationProblems(wrote.corroboration.rows, refused.e17),
  refusedRowsAgainstWroteE17: I.corroborationProblems(refused.corroboration.rows, wrote.e17),
};
const expect = {
  "wrote: every step MATCHes": wrote.steps.length === 17 && wrote.steps.every((s) => s.verdict === "MATCH"),
  "wrote: E14 and E16 WROTE, E15 REFUSED": JSON.stringify(wrote.steps.filter((s) => s.outcome).map((s) => [s.step, s.outcome])) === JSON.stringify([["E14", "WROTE"], ["E15", "REFUSED"], ["E16", "WROTE"]]),
  "wrote: the terminal outcome is COMPLETE-WROTE, permitting the read": Boolean(wrote.gate && wrote.gate.stop === false && wrote.gate.terminal && wrote.gate.terminal.outcome === "COMPLETE-WROTE" && wrote.gate.terminal.corroborate === true),
  "wrote: the read agrees with E17": wrote.corroboration.problems.length === 0 && wrote.corroboration.rows.length > 0,
  "refused: every step MATCHes": refused.steps.length === 17 && refused.steps.every((s) => s.verdict === "MATCH"),
  "refused: E14 to E16 REFUSED": refused.steps.filter((s) => s.outcome).every((s) => s.outcome === "REFUSED"),
  "refused: the terminal outcome is COMPLETE-REFUSED, permitting the read": Boolean(refused.gate && refused.gate.stop === false && refused.gate.terminal && refused.gate.terminal.outcome === "COMPLETE-REFUSED" && refused.gate.terminal.corroborate === true),
  "refused: the read agrees with E17": refused.corroboration.problems.length === 0 && refused.corroboration.rows.length > 0,
  "the uncast query fails 42725 on both branches": [wrote, refused].every((b) => b.uncast && b.uncast.code === "42725"),
  "each branch's read disagrees with the other's E17": cross.wroteRowsAgainstRefusedE17.length > 0 && cross.refusedRowsAgainstWroteE17.length > 0,
};
const ok = Object.values(expect).every(Boolean);
process.stdout.write(JSON.stringify({ localOnly: true, rev: REV, version, synthetic: "roles i3_reader (the R window) and postgres (the W window and the separate credential); read_only as BEGIN READ ONLY; Management API bodies modelled", query: I.CORROBORATION_SQL, expect, ok, wrote, refused, cross }, null, 2) + "\n");
process.exit(ok ? 0 : 1);
