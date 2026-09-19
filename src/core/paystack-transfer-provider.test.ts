import assert from "node:assert/strict";
import test from "node:test";
import { PaystackTransferProvider, mapPaystackTransferStatus } from "./paystack-transfer-provider";
import { PaystackProviderError } from "./paystack";

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

test("Paystack network failure is classified as ambiguous", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("response lost"); };
  try {
    await assert.rejects(new PaystackTransferProvider().verifyTransfer("stl_1234567890123456"), (error: unknown) => error instanceof PaystackProviderError && error.ambiguous);
  } finally { globalThis.fetch = original; }
});
