// Security: send-print-job mails FROM the store's SMTP identity with
// caller-supplied attachments. These tests are the contract that a caller
// can never choose the recipient and can never use it as an amplifier.
//
// NOTHING IS SENT. The transport is replaced with a fake that records the
// message. No trial abuse mail is ever put through the production relay.
import { test, afterEach } from "node:test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import {
  LIMITS, b64Bytes, enforceLimits, checkRate, resolveRecipient,
  __setTransportFactory, __resetTransportFactory, handler,
} from "../../netlify/functions/send-print-job.js";

const STORE_EMAIL = "store4979@theupsstore.com";
const ATTACKER = "exfiltrate@evil.example";

// A transport that records instead of sending. Nothing leaves the process.
const fakeTransport = () => {
  const sent = [];
  __setTransportFactory(() => ({
    sendMail: async (mail) => { sent.push(mail); return { messageId: "fake-1" }; },
  }));
  return sent;
};

const withSmtpEnv = (fn) => async () => {
  const saved = { ...process.env };
  Object.assign(process.env, {
    SMTP_HOST: "smtp.invalid", SMTP_PORT: "587", SMTP_USER: "u", SMTP_PASS: "p",
    SUPABASE_URL: "", SUPABASE_SERVICE_ROLE_KEY: "", VITE_SUPABASE_URL: "",
  });
  try { await fn(); } finally { for (const k of Object.keys(process.env)) delete process.env[k]; Object.assign(process.env, saved); }
};

const post = (body, headers = {}) => handler({ httpMethod: "POST", body: JSON.stringify(body), headers });

afterEach(() => __resetTransportFactory());

test("a caller-supplied `to` NEVER reaches the message", withSmtpEnv(async () => {
  const sent = fakeTransport();
  const res = await post({ to: ATTACKER, subject: "hi", details: {} }, { "x-nf-client-connection-ip": "1.1.1.1" });
  assert.equal(res.statusCode, 200);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, STORE_EMAIL, "recipient must come from the server, not the body");
  assert.equal(JSON.stringify(sent[0]).includes(ATTACKER), false, "attacker address must appear nowhere in the message");
}));

test("every recipient-shaped field a caller might try is ignored", withSmtpEnv(async () => {
  const sent = fakeTransport();
  await post({ to: ATTACKER, cc: ATTACKER, bcc: ATTACKER, replyTo: ATTACKER, from: ATTACKER, envelope: { to: ATTACKER }, details: {} },
             { "x-nf-client-connection-ip": "2.2.2.2" });
  const mail = sent[0];
  assert.equal(mail.to, STORE_EMAIL);
  for (const field of ["cc", "bcc", "replyTo", "envelope"]) assert.equal(mail[field], undefined, field);
  assert.notEqual(mail.from, ATTACKER, "from comes from SMTP env, never the body");
}));

test("resolveRecipient prefers the store record and falls back safely — never to the body", async () => {
  const ok = await resolveRecipient({
    supabase: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { email: "real@store.test" } }) }) }) }) },
    slug: "store4979", fallback: STORE_EMAIL,
  });
  assert.deepEqual(ok, { to: "real@store.test", source: "store:store4979" });

  const miss = await resolveRecipient({
    supabase: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: "x" } }) }) }) }) },
    slug: "store4979", fallback: STORE_EMAIL,
  });
  assert.equal(miss.to, STORE_EMAIL, "fallback is the compiled-in store address");

  const threw = await resolveRecipient({
    supabase: { from: () => { throw new Error("network"); } }, slug: "s", fallback: STORE_EMAIL,
  });
  assert.equal(threw.to, STORE_EMAIL, "a DB outage must not break counter email");

  const noDb = await resolveRecipient({ supabase: null, slug: "s", fallback: STORE_EMAIL });
  assert.equal(noDb.to, STORE_EMAIL);
});

test("attachment quotas: count, per-file bytes, and total bytes", () => {
  const b64 = (bytes) => "A".repeat(Math.ceil(bytes / 3) * 4);
  assert.equal(enforceLimits({ rawBodyLength: 10, pdfBase64: b64(1000) }), null, "a normal job passes");
  assert.equal(enforceLimits({ rawBodyLength: LIMITS.MAX_BODY_BYTES + 1 }).code, 413);
  assert.equal(enforceLimits({ rawBodyLength: 1, pdfBase64: b64(LIMITS.MAX_ATTACHMENT_BYTES + 4096) }).code, 413);
  assert.equal(
    enforceLimits({ rawBodyLength: 1, pdfBase64: b64(7 * 1024 * 1024), orderSheetPdfBase64: b64(7 * 1024 * 1024) }).code,
    413, "two individually-legal attachments can still bust the total");
  assert.equal(LIMITS.MAX_ATTACHMENTS, 2);
});

test("b64Bytes measures the decoded size, padding included", () => {
  assert.equal(b64Bytes(""), 0);
  assert.equal(b64Bytes("AAAA"), 3);
  assert.equal(b64Bytes("AAA="), 2);
  assert.equal(b64Bytes("AA=="), 1);
  assert.equal(b64Bytes("data:application/pdf;base64,AAAA"), 3, "data: prefix is stripped");
});

test("an oversized attachment is refused BEFORE any transport is constructed", withSmtpEnv(async () => {
  let built = false;
  __setTransportFactory(() => { built = true; return { sendMail: async () => ({}) }; });
  const huge = "A".repeat(Math.ceil((LIMITS.MAX_ATTACHMENT_BYTES + 65536) / 3) * 4);
  const res = await post({ details: {}, pdfBase64: huge }, { "x-nf-client-connection-ip": "3.3.3.3" });
  assert.equal(res.statusCode, 413);
  assert.equal(built, false, "no SMTP connection is opened for a rejected request");
}));

test("rate limiting caps a single IP and does not punish a different one", () => {
  const state = new Map();
  const now = Date.now();
  for (let i = 0; i < LIMITS.RATE_MAX; i++)
    assert.equal(checkRate("10.0.0.1", now, state), true, `send ${i + 1} within budget`);
  assert.equal(checkRate("10.0.0.1", now, state), false, "over budget");
  assert.equal(checkRate("10.0.0.2", now, state), true, "a different caller is unaffected");
  assert.equal(checkRate("10.0.0.1", now + LIMITS.RATE_WINDOW_MS + 1, state), true, "window rolls off");
});

test("a flood from one IP is refused by the handler, not just the helper", withSmtpEnv(async () => {
  const sent = fakeTransport();
  const ip = { "x-nf-client-connection-ip": "203.0.113.9" };
  const codes = [];
  for (let i = 0; i < LIMITS.RATE_MAX + 3; i++) codes.push((await post({ details: {} }, ip)).statusCode);
  assert.ok(codes.includes(429), "the flood is throttled");
  assert.ok(sent.length <= LIMITS.RATE_MAX, `sent ${sent.length}, cap ${LIMITS.RATE_MAX}`);
  assert.equal(sent.every((m) => m.to === STORE_EMAIL), true);
}));

test("non-POST is refused", async () => {
  assert.equal((await handler({ httpMethod: "GET", headers: {} })).statusCode, 405);
});

test("the client no longer sends a recipient at all", () => {
  const app = readFileSync(new URL("../../src/App.jsx", import.meta.url), "utf8");
  const i = app.indexOf("send-print-job");
  const payload = app.slice(app.lastIndexOf("const payload = {", i), i);
  assert.equal(/^\s*to:/m.test(payload), false, "payload must not carry a `to` field");
});