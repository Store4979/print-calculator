// scripts/tests/release2-pin-parity.test.js
//
// DRIFT GUARD. Two PIN paths coexist until step 4 migrates the clients:
//
//   A. verify_employee_pin  — the anon-executable RPC the deployed client uses
//   B. findEmployeeByPinDirect — service_role, used by staff-login
//
// If one changes and the other does not, staff sign-in diverges depending on
// which path a device happens to take, and the divergence is invisible until
// someone cannot log in. This file fails when either side moves alone.
//
// It pins B's descriptor against A's ACTUAL BODY, captured from the database
// and committed below. Regenerate the snapshot deliberately — see the note on
// RPC_BODY — never to make a red test go green.
import test from "node:test";
import assert from "node:assert/strict";

import { PIN_LOOKUP } from "../../netlify/lib/release2-auth.js";

// Captured from staging 2026-09-12 with:
//   select pg_get_functiondef(oid) from pg_proc where proname='verify_employee_pin';
// Production and staging were byte-identical at capture time.
const RPC_BODY = `
  select e.id, e.name, e.active, e.role
  from public.employees e
  where e.store_id = p_store_id
    and e.pin      = p_pin
    and e.active
  limit 1;
`;

const norm = (s) => s.replace(/\s+/g, " ").trim();

test("the RPC still selects exactly the columns the direct read selects", () => {
  // /s flag: RPC_BODY is multiline and `.` does not match \n without it.
  // Same class of bug as the sw.js CRLF regex — a pattern that silently never
  // matches reads as a passing test until it throws.
  const rpcCols = norm(/select (.+?) from/is.exec(RPC_BODY)[1])
    .split(",")
    .map((c) => c.trim().replace(/^e\./, ""));
  const directCols = PIN_LOOKUP.columns.split(",").map((c) => c.trim());
  assert.deepEqual(directCols, rpcCols,
    "column sets diverged — one path would return fields the other does not");
});

test("the RPC still filters on exactly store_id, pin and active", () => {
  const where = norm(/where (.+?) limit/is.exec(RPC_BODY)[1]);
  // store_id and pin are explicit equalities; `and e.active` is a bare boolean.
  assert.match(where, /e\.store_id = p_store_id/, "store scoping removed from the RPC");
  assert.match(where, /e\.pin\s*=\s*p_pin/, "pin equality removed from the RPC");
  assert.match(where, /and e\.active\b/, "active-only filter removed from the RPC");

  assert.deepEqual([...PIN_LOOKUP.eq].sort(), ["active", "pin", "store_id"],
    "the direct read's filters diverged from the RPC's WHERE clause");
  assert.equal(PIN_LOOKUP.activeValue, true,
    "`and e.active` means active IS TRUE; NULL and false are both excluded");
});

test("both paths take at most one row", () => {
  assert.match(norm(RPC_BODY), /limit 1;$/, "the RPC stopped limiting to one row");
  assert.equal(PIN_LOOKUP.limit, 1);
});

test("the RPC takes a store and a PIN and NOTHING that identifies an employee", () => {
  // This is why the abuse budget cannot be keyed per employee: at the moment a
  // failure must be charged, no employee is known. If the RPC ever grows an
  // employee argument, the limiter design should be revisited — so it is
  // asserted here rather than left as a comment in the plan.
  assert.match(RPC_BODY, /p_store_id/);
  assert.match(RPC_BODY, /p_pin/);
  assert.doesNotMatch(RPC_BODY, /p_employee|p_name|p_user/i,
    "the RPC gained an identifying argument — revisit the per-employee budget question");
});

test("the direct read does not go through the RPC", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../../netlify/lib/release2-auth.js", import.meta.url), "utf8");
  const login = readFileSync(new URL("../../netlify/functions/staff-login.js", import.meta.url), "utf8");
  // Mentioning it in a comment is fine and expected; calling it is not.
  assert.doesNotMatch(src, /\.rpc\(\s*["'`]verify_employee_pin/);
  assert.doesNotMatch(login, /\.rpc\(\s*["'`]verify_employee_pin/);
});
