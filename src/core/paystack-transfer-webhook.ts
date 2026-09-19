import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import type { ProviderTransferResult } from "./settlement-provider";
import { mapPaystackTransferStatus } from "./paystack-transfer-provider";
import { applyProviderTransferResult } from "./provider-settlement";

type TransferEvent = { event?: unknown; data?: unknown };
const string = (value: unknown) => typeof value === "string" ? value : undefined;
const number = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) ? value : undefined;

export const acceptAndProcessPaystackTransferWebhook = async (rawBody: Buffer, parsed: TransferEvent) => {
  const eventType = string(parsed.event);
  const data = parsed.data && typeof parsed.data === "object" && !Array.isArray(parsed.data) ? parsed.data as Record<string, unknown> : null;
  if (!eventType || !["transfer.success", "transfer.failed", "transfer.reversed"].includes(eventType) || !data) return { received: true, processed: false };
  const reference = string(data.reference);
  const amountMinor = number(data.amount);
  const currency = string(data.currency)?.toUpperCase();
  const status = string(data.status) ?? eventType.split(".")[1];
  const recipientValue = data.recipient;
  const recipientReference = typeof recipientValue === "string" ? recipientValue : recipientValue && typeof recipientValue === "object" ? string((recipientValue as Record<string, unknown>).recipient_code) : undefined;
  if (!reference || amountMinor === undefined || !currency || !status) return { received: true, processed: false };
  const safePayload = { reference, amount: amountMinor, currency, status, transferCode: string(data.transfer_code) ?? null, recipientReference: recipientReference ?? null } satisfies Prisma.InputJsonValue;
  const fingerprint = crypto.createHash("sha256").update(JSON.stringify({ eventType, ...safePayload })).digest("hex");
  const inboxId = crypto.randomUUID();
  const inserted = await prisma.$executeRaw`INSERT IGNORE INTO ProviderWebhookEvent (id, provider, eventFingerprint, eventType, providerReference, payload, status, attempts, receivedAt, updatedAt) VALUES (${inboxId}, 'PAYSTACK', ${fingerprint}, ${eventType}, ${reference}, ${JSON.stringify(safePayload)}, 'RECEIVED', 0, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))`;
  if (inserted !== 1) return { received: true, processed: false, duplicate: true };
  return processStoredPaystackTransferWebhook(inboxId);
};

export const processStoredPaystackTransferWebhook = async (inboxId: string) => {
  const inbox = await prisma.providerWebhookEvent.findUniqueOrThrow({ where: { id: inboxId } });
  const data = inbox.payload && typeof inbox.payload === "object" && !Array.isArray(inbox.payload) ? inbox.payload as Record<string, unknown> : {};
  const reference = string(data.reference);
  const amountMinor = number(data.amount);
  const currency = string(data.currency)?.toUpperCase();
  const status = string(data.status);
  const recipientReference = string(data.recipientReference);
  if (!reference || amountMinor === undefined || !currency || !status) throw new Error("Stored Paystack transfer event is malformed");
  const settlement = await prisma.financialSettlement.findFirst({ where: { provider: "PAYSTACK", providerTransferReference: reference } });
  if (!settlement) {
    await prisma.providerWebhookEvent.update({ where: { id: inbox.id }, data: { status: "IGNORED", processedAt: new Date() } });
    return { received: true, processed: false };
  }
  const claimed = await prisma.providerWebhookEvent.updateMany({ where: { id: inbox.id, status: { in: ["RECEIVED", "FAILED"] }, attempts: { lt: 5 } }, data: { status: "PROCESSING", attempts: { increment: 1 }, failureReason: null } });
  if (claimed.count !== 1) return { received: true, processed: false, duplicate: true };
  const result: ProviderTransferResult = { reference, amountMinor, currency, providerStatus: status.toLowerCase(), state: mapPaystackTransferStatus(status), ...(string(data.transferCode) ? { transferCode: string(data.transferCode) } : {}), ...(recipientReference ? { recipientReference } : {}) };
  try {
    await applyProviderTransferResult(settlement, result);
    await prisma.providerWebhookEvent.update({ where: { id: inbox.id }, data: { status: "PROCESSED", processedAt: new Date() } });
    return { received: true, processed: true };
  } catch (error) {
    await prisma.providerWebhookEvent.update({ where: { id: inbox.id }, data: { status: "FAILED", failureReason: (error instanceof Error ? error.message : "Webhook processing failed").slice(0, 2000) } });
    throw error;
  }
};

export const retryPendingPaystackTransferWebhooks = async (limit = 25) => {
  const events = await prisma.providerWebhookEvent.findMany({ where: { provider: "PAYSTACK", status: { in: ["RECEIVED", "FAILED"] }, attempts: { lt: 5 } }, orderBy: { receivedAt: "asc" }, take: limit });
  let processed = 0;
  for (const event of events) {
    try { const result = await processStoredPaystackTransferWebhook(event.id); if (result.processed) processed += 1; } catch (error) { console.error("[paystack-transfer-webhook] retry failed", { eventId: event.id, providerReference: event.providerReference, error: error instanceof Error ? error.message : "unknown" }); }
  }
  return { inspected: events.length, processed };
};
