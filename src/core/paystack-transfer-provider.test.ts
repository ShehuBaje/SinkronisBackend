import assert from "node:assert/strict";
import test from "node:test";
import { PaystackTransferProvider, mapPaystackTransferStatus } from "./paystack-transfer-provider";
import { PaystackProviderError } from "./paystack";
import { assertPaystackTransferCredentialMode } from "./settlement-provider";
import { env } from "../config/env";

// Unit tests use a mocked transport, but the outbound adapter still exercises
// the real fail-closed credential-mode boundary.
env.PAYSTACK_TRANSFERS_MODE = env.PAYSTACK_SECRET_KEY?.startsWith("sk_live_") ? "live" : "test";

test("Paystack transfer statuses map explicitly and unknown values fail closed", () => {
  for (const status of ["pending", "otp", "received"]) assert.equal(mapPaystackTransferStatus(status), "NON_CONCLUSIVE");
  assert.equal(mapPaystackTransferStatus("success"), "SUCCESS");
  assert.equal(mapPaystackTransferStatus("reversed"), "REVERSAL");
  for (const status of ["failed", "abandoned", "blocked", "rejected"]) assert.equal(mapPaystackTransferStatus(status), "FAILURE");
  assert.throws(() => mapPaystackTransferStatus("queued-unknown"), PaystackProviderError);
});

test("Paystack adapter resolves Nigerian account and creates nuban recipient", async () => {
  const original = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).includes("/bank/resolve")) return new Response(JSON.stringify({ status: true, message: "ok", data: { account_name: "Ada Example", account_number: "0123456789", bank_id: 9 } }), { status: 200 });
    return new Response(JSON.stringify({ status: true, message: "ok", data: { recipient_code: "RCP_safe", id: 123 } }), { status: 200 });
  };
  try {
    const provider = new PaystackTransferProvider();
    assert.deepEqual(await provider.resolveAccount({ accountNumber: "0123456789", bankCode: "044" }), { accountName: "Ada Example", accountNumber: "0123456789", bankId: 9 });
    assert.deepEqual(await provider.createRecipient({ accountNumber: "0123456789", bankCode: "044", accountName: "Ada Example", currency: "NGN" }), { recipientReference: "RCP_safe", providerRecipientId: "123" });
    assert.match(calls[0].url, /bank\/resolve\?account_number=0123456789&bank_code=044$/);
    assert.deepEqual(JSON.parse(String(calls[1].init?.body)), { type: "nuban", name: "Ada Example", account_number: "0123456789", bank_code: "044", currency: "NGN" });
  } finally { globalThis.fetch = original; }
});

test("Paystack adapter owns transfer reference and verifies the same reference", async () => {
  const original = globalThis.fetch;
  const calls: Array<{ url: string; body?: unknown }> = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return new Response(JSON.stringify({ status: true, message: "ok", data: { reference: "stl_1234567890123456", transfer_code: "TRF_safe", status: "pending", amount: 8000000, currency: "NGN", recipient: { recipient_code: "RCP_safe" } } }), { status: 200 });
  };
  try {
    const provider = new PaystackTransferProvider();
    const initiated = await provider.initiateTransfer({ recipientReference: "RCP_safe", amountMinor: 8000000, currency: "NGN", reference: "stl_1234567890123456", reason: "Approved obligation" });
    assert.equal(initiated.state, "NON_CONCLUSIVE");
    await provider.verifyTransfer("stl_1234567890123456");
    assert.deepEqual(calls[0].body, { source: "balance", amount: 8000000, recipient: "RCP_safe", reference: "stl_1234567890123456", reason: "Approved obligation", currency: "NGN" });
    assert.match(calls[1].url, /\/transfer\/verify\/stl_1234567890123456$/);
  } finally { globalThis.fetch = original; }
});

test("Paystack initiation status success remains non-conclusive until webhook or verification", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ status: true, message: "Transfer has been queued", data: { reference: "stl_1234567890123456", transfer_code: "TRF_safe", status: "success", amount: 10000, currency: "NGN", recipient: { recipient_code: "RCP_safe" } } }), { status: 200 });
  try {
    const result = await new PaystackTransferProvider().initiateTransfer({ recipientReference: "RCP_safe", amountMinor: 10000, currency: "NGN", reference: "stl_1234567890123456", reason: "Test" });
    assert.equal(result.providerStatus, "success");
    assert.equal(result.state, "NON_CONCLUSIVE");
  } finally { globalThis.fetch = original; }
});

test("Paystack OTP finalization sends only stored transfer code and OTP and remains non-conclusive", async () => {
  const original = globalThis.fetch;
  let requestBody: Record<string, unknown> | undefined;
  globalThis.fetch = async (_url, init) => {
    requestBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ status: true, message: "Transfer queued", data: { reference: "stl_1234567890123456", transfer_code: "TRF_safe", status: "success", amount: 10000, currency: "NGN", recipient: { recipient_code: "RCP_safe" } } }), { status: 200 });
  };
  try {
    const result = await new PaystackTransferProvider().finalizeTransferOtp({ transferCode: "TRF_safe", otp: "123456" });
    assert.deepEqual(requestBody, { transfer_code: "TRF_safe", otp: "123456" });
    assert.equal(result.state, "NON_CONCLUSIVE");
    assert.equal(result.providerStatus, "success");
  } finally { globalThis.fetch = original; }
});

test("Paystack network failure is classified as ambiguous", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("response lost"); };
  try {
    await assert.rejects(new PaystackTransferProvider().verifyTransfer("stl_1234567890123456"), (error: unknown) => error instanceof PaystackProviderError && error.ambiguous);
  } finally { globalThis.fetch = original; }
});

test("Paystack outbound transfer credentials fail closed across test and live modes", () => {
  const testKey = ["sk", "test", "fixture"].join("_");
  const liveKey = ["sk", "live", "fixture"].join("_");
  assert.doesNotThrow(() => assertPaystackTransferCredentialMode("test", testKey));
  assert.doesNotThrow(() => assertPaystackTransferCredentialMode("live", liveKey));
  assert.throws(() => assertPaystackTransferCredentialMode("test", liveKey), (error: any) => error?.statusCode === 503 && error?.details?.reasonCode === "PAYSTACK_TRANSFER_MODE_MISMATCH");
  assert.throws(() => assertPaystackTransferCredentialMode("live", testKey), (error: any) => error?.statusCode === 503 && error?.details?.reasonCode === "PAYSTACK_TRANSFER_MODE_MISMATCH");
  assert.throws(() => assertPaystackTransferCredentialMode("test", undefined), (error: any) => error?.statusCode === 503);
  assert.throws(() => assertPaystackTransferCredentialMode(undefined, testKey), (error: any) => error?.statusCode === 503 && error?.details?.reasonCode === "PAYSTACK_TRANSFER_MODE_MISSING");
});

test("credential mismatch blocks every outbound adapter operation before network access", async () => {
  const originalFetch = globalThis.fetch;
  const originalMode = env.PAYSTACK_TRANSFERS_MODE;
  const originalSecret = env.PAYSTACK_SECRET_KEY;
  let networkCalls = 0;
  globalThis.fetch = async () => { networkCalls += 1; throw new Error("network must not be reached"); };
  env.PAYSTACK_TRANSFERS_MODE = "test";
  env.PAYSTACK_SECRET_KEY = ["sk", "live", "fixture"].join("_");
  const provider = new PaystackTransferProvider();
  try {
    const operations = [
      () => provider.resolveAccount({ accountNumber: "0000000000", bankCode: "057" }),
      () => provider.createRecipient({ accountNumber: "0000000000", bankCode: "057", accountName: "Fixture", currency: "NGN" }),
      () => provider.initiateTransfer({ recipientReference: "RCP_fixture", amountMinor: 100, currency: "NGN", reference: "stl_fixture", reason: "Fixture" }),
      () => provider.finalizeTransferOtp({ transferCode: "TRF_fixture", otp: "000000" }),
      () => provider.verifyTransfer("stl_fixture"),
      () => provider.getBalance(),
    ];
    for (const operation of operations) await assert.rejects(operation(), (error: any) => error?.details?.reasonCode === "PAYSTACK_TRANSFER_MODE_MISMATCH");
    assert.equal(networkCalls, 0);
  } finally {
    env.PAYSTACK_TRANSFERS_MODE = originalMode;
    env.PAYSTACK_SECRET_KEY = originalSecret;
    globalThis.fetch = originalFetch;
  }
});
