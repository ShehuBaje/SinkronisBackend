import assert from "node:assert/strict";
import test from "node:test";
import crypto from "node:crypto";
import { env } from "../config/env";
import {
  initializePaystackTransaction,
  PaystackProviderError,
  verifyPaystackTransaction,
  verifyPaystackWebhookSignature,
} from "./paystack";

test("Paystack initialization sends one server-side request with the intended correlation metadata", async () => {
  const original = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ status: true, message: "ok", data: { authorization_url: "https://checkout.paystack.com/safe", access_code: "access", reference: "SUB-ONE" } }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    const result = await initializePaystackTransaction({ email: "billing@example.com", amount: 10000, currency: "NGN", reference: "SUB-ONE", callbackUrl: "https://app.example.com/payment", metadata: { paymentDomain: "SUBSCRIPTION", subscriptionPaymentAttemptId: "attempt-1", organizationId: "tenant-1" } });
    assert.equal(result.reference, "SUB-ONE");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://api.paystack.co/transaction/initialize");
    const body = JSON.parse(String(calls[0].init?.body));
    assert.equal(body.amount, 10000);
    assert.equal(body.metadata.subscriptionPaymentAttemptId, "attempt-1");
    assert.equal(String((calls[0].init?.headers as Record<string, string>).Authorization).startsWith("Bearer "), true);
  } finally {
    globalThis.fetch = original;
  }
});

test("Paystack verification uses the original reference and tolerates additional provider fields", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async (url: string | URL | Request) => {
    calls += 1;
    assert.equal(String(url), "https://api.paystack.co/transaction/verify/SUB-ONE");
    return new Response(JSON.stringify({ status: true, message: "ok", data: { status: "success", reference: "SUB-ONE", amount: 10000, currency: "NGN", metadata: { paymentDomain: "SUBSCRIPTION" }, extra: "ignored" } }), { status: 200 });
  }) as typeof fetch;
  try {
    assert.equal((await verifyPaystackTransaction("SUB-ONE")).status, "success");
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = original;
  }
});

test("network loss is classified as an ambiguous provider outcome and is never retried", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => { calls += 1; throw new Error("connection lost"); }) as typeof fetch;
  try {
    await assert.rejects(
      initializePaystackTransaction({ email: "billing@example.com", amount: 10000, currency: "NGN", reference: "SUB-TIMEOUT", callbackUrl: "https://app.example.com/payment", metadata: {} }),
      (error: unknown) => error instanceof PaystackProviderError && error.ambiguous,
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = original;
  }
});

test("webhook signature is checked against the unchanged raw bytes", () => {
  assert.ok(env.PAYSTACK_SECRET_KEY);
  const raw = Buffer.from('{"event":"charge.success","data":{"reference":"SUB-ONE"}}');
  const signature = crypto.createHmac("sha512", env.PAYSTACK_SECRET_KEY!).update(raw).digest("hex");
  assert.equal(verifyPaystackWebhookSignature(raw, signature), true);
  assert.equal(verifyPaystackWebhookSignature(Buffer.from(`${raw.toString()} `), signature), false);
});
