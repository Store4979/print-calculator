// scripts/tests/stage0-4c-fixture.mjs — the readings
// scripts/manual/stage0-item4c-local-pglite.mjs recorded (fixtures/stage0-4c/),
// for stage0-4c.test.js and its mutation companion. A reading is stored whole
// (c-01.json) or as its difference from that one.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./stage0-guard-fixture.mjs";

export const FIX = join(ROOT, "scripts", "tests", "fixtures", "stage0-4c");
/** A fixture's text with LF line ends, as the harness wrote it and its index hashed it (this checkout may be CRLF). */
export const raw = (name) => readFileSync(join(FIX, name), "utf8").replace(/\r\n/g, "\n");
export const json = (name) => JSON.parse(raw(name));
const asRows = (t) => t.map(([part, key, value]) => ({ part, key, value }));

/** A checked-state reading's rows: the base whole, a difference applied to it. */
export function readingRows(name) {
  const f = json(name);
  if (f.base) return asRows(f.rows);
  const base = new Map(json(f.from).rows.map((x) => [`${x[0]}|${x[1]}`, x]));
  for (const [p, k] of f.drop) base.delete(`${p}|${k}`);
  for (const x of f.set) base.set(`${x[0]}|${x[1]}`, x);
  return asRows([...base.values()]);
}

/**
 * A reading with its rows changed by `change`, its part md5s and the whole's
 * recomputed as the text computes them, as a database would report it; read
 * with `C`, a comparator module (the real one, or a mutant).
 */
export function edited(C, name, change) {
  const rows = readingRows(name).filter((r) => r.key !== "#md5");
  change(rows);
  const parts = {};
  for (let p = 1; p <= 10; p++) parts[p] = {};
  for (const r of rows) parts[r.part][r.key] = r.value;
  const order = (x, y) => Buffer.compare(Buffer.from(x), Buffer.from(y));
  const md5s = {};
  for (let p = 1; p <= 10; p++) md5s[p] = C.md5(Object.keys(parts[p]).sort(order).map((k) => `${k}=${parts[p][k]}`).join("\n"));
  const whole = C.md5(Array.from({ length: 10 }, (_, i) => `${i + 1}=${md5s[i + 1]}`).join("\n"));
  return C.readObservation([...rows, ...Object.entries(md5s).map(([p, m]) => ({ part: Number(p), key: "#md5", value: m })), { part: 0, key: "#md5", value: whole }]);
}
