import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { env } from "../config/env";

export type PaystackInitializeData = {
  authorization_url: string;
  access_code: string;
  reference: string;
};

export type PaystackVerifyData = {
  status: string;
  reference: string;
  amount: number;
  currency: string;
  paid_at?: string;
  gateway_response?: string;
  metadata?: Record<string, unknown>;
};

type PaystackResponse<T> = { status: boolean; message: string; data?: T };

export class PaystackProviderError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly ambiguous = false,
  ) {
    super(message);
    this.name = "PaystackProviderError";
  }
}

const secret = () => {
  if (!env.PAYSTACK_SECRET_KEY) {
    throw new PaystackProviderError("Paystack is not configured", undefined, false);
  }
  return env.PAYSTACK_SECRET_KEY;
};

export const paystackRequest = async <T>(path: string, init?: RequestInit): Promise<T> => {
  let response: globalThis.Response;
  try {
    response = await fetch(`https://api.paystack.co${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${secret()}`,
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new PaystackProviderError("Paystack is temporarily unavailable", undefined, true);
  }

  const payload = (await response.json().catch(() => null)) as PaystackResponse<T> | null;
  if (!response.ok || !payload?.status || !payload.data) {
    const ambiguous = response.status === 429 || response.status >= 500;
    throw new PaystackProviderError(
      payload?.message || "Paystack request failed",
      response.status,
      ambiguous,
    );
  }
  return payload.data;
};

export const initializePaystackTransaction = (input: {
  email: string;
  amount: number;
  currency: string;
  reference: string;
  callbackUrl: string;
  metadata: Record<string, unknown>;
}) => paystackRequest<PaystackInitializeData>("/transaction/initialize", {
  method: "POST",
  body: JSON.stringify({
    email: input.email,
    amount: input.amount,
    currency: input.currency,
    reference: input.reference,
    callback_url: input.callbackUrl,
    metadata: input.metadata,
  }),
});

export const verifyPaystackTransaction = (reference: string) =>
  paystackRequest<PaystackVerifyData>(`/transaction/verify/${encodeURIComponent(reference)}`);

export const verifyPaystackWebhookSignature = (
  rawBody: Buffer | undefined,
  signature: string | undefined,
) => {
  if (!rawBody || !signature) return false;
  const expected = crypto.createHmac("sha512", secret()).update(rawBody).digest("hex");
  const supplied = Buffer.from(signature, "utf8");
  const calculated = Buffer.from(expected, "utf8");
  return supplied.length === calculated.length && crypto.timingSafeEqual(supplied, calculated);
};

export const paystackMinorUnits = (value: Prisma.Decimal.Value) =>
  new Prisma.Decimal(value).mul(100).toDecimalPlaces(0).toNumber();
