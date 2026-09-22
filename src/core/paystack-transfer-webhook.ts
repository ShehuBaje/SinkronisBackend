import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { env } from "../config/env";
import { prisma } from "./prisma";
import type { ProviderTransferResult } from "./settlement-provider";
import { mapPaystackTransferStatus } from "./paystack-transfer-provider";
import { applyProviderTransferResult } from "./provider-settlement";

type TransferEvent = { event?: unknown; data?: unknown };
const string = (value: unknown) => typeof value === "string" ? value : undefined;
const number = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) ? value : undefined;
const retryDelayMs = (attempt: number) => Math.min(15 * 60_000, 30_000 * (2 ** Math.max(0, attempt - 1)));

export const claimPaystackTransferWebhook = async (inboxId: string, now = new Date(), claimToken: string = crypto.randomUUID()) => {
  const leaseExpiresAt = new Date(now.getTime() + env.FINANCIAL_WEBHOOK_PROCESSING_LEASE_MS);
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ provider: string; status: string; attempts: number; nextAttemptAt: Date | null; processingLeaseExpiresAt: Date | null }>>`SELECT provider, status, attempts, nextAttemptAt, processingLeaseExpiresAt FROM ProviderWebhookEvent WHERE id = ${inboxId} FOR UPDATE`;
    const row = rows[0];
    const eligible = row?.provider === "PAYSTACK" && (
      (row.status === "RECEIVED" && row.attempts < env.FINANCIAL_WEBHOOK_MAX_ATTEMPTS)
      || (row.status === "FAILED" && row.attempts < env.FINANCIAL_WEBHOOK_MAX_ATTEMPTS && (!row.nextAttemptAt || row.nextAttemptAt <= now))
      // A worker may die on its final configured attempt after the financial
      // effect commits but before the inbox row is completed. Exactly-once
      // finalizers make this mandatory crash-recovery pass safe.
      || (row.status === "PROCESSING" && !!row.processingLeaseExpiresAt && row.processingLeaseExpiresAt <= now)
    );
    if (!eligible) return null;
    await tx.providerWebhookEvent.update({ where: { id: inboxId }, data: {
      status: "PROCESSING",
      attempts: { increment: 1 },
      processingClaimToken: claimToken,
      processingClaimedAt: now,
      processingLeaseExpiresAt: leaseExpiresAt,
      failureReason: null,
      nextAttemptAt: null,
    } });
    return { claimToken, leaseExpiresAt };
  }, { isolationLevel: "RepeatableRead", maxWait: 20_000, timeout: 20_000 });
};

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
  const inserted = await prisma.$executeRaw`INSERT IGNORE INTO ProviderWebhookEvent (id, provider, eventFingerprint, eventType, providerReference, payload, status, attempts, deferredAttempts, receivedAt, updatedAt) VALUES (${inboxId}, 'PAYSTACK', ${fingerprint}, ${eventType}, ${reference}, ${JSON.stringify(safePayload)}, 'RECEIVED', 0, 0, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))`;
  if (inserted !== 1) return { received: true, processed: false, duplicate: true };
  return processStoredPaystackTransferWebhook(inboxId);
};

export const processStoredPaystackTransferWebhook = async (inboxId: string, suppliedClaimToken?: string) => {
  const initial = await prisma.providerWebhookEvent.findUniqueOrThrow({ where: { id: inboxId } });
  const ownedClaim = suppliedClaimToken ? null : await claimPaystackTransferWebhook(inboxId);
  const claimToken = suppliedClaimToken ?? ownedClaim?.claimToken;
  if (!claimToken) return { received: true, processed: false, duplicate: true };
  const inbox = await prisma.providerWebhookEvent.findFirst({ where: { id: inboxId, processingClaimToken: claimToken, processingLeaseExpiresAt: { gt: new Date() } } });
  if (!inbox) return { received: true, processed: false, duplicate: true };
  const data = inbox.payload && typeof inbox.payload === "object" && !Array.isArray(inbox.payload) ? inbox.payload as Record<string, unknown> : {};
  const reference = string(data.reference);
  const amountMinor = number(data.amount);
  const currency = string(data.currency)?.toUpperCase();
  const status = string(data.status);
  const recipientReference = string(data.recipientReference);
  if (!reference || amountMinor === undefined || !currency || !status) {
    await prisma.providerWebhookEvent.updateMany({ where: { id: inbox.id, processingClaimToken: claimToken }, data: { status: "DEAD_LETTER", deadLetteredAt: new Date(), failureReason: "Stored Paystack transfer event is malformed", processingClaimToken: null, processingClaimedAt: null, processingLeaseExpiresAt: null } });
    return { received: true, processed: false, deadLettered: true };
  }
  const settlement = await prisma.financialSettlement.findFirst({ where: { provider: "PAYSTACK", providerTransferReference: reference } });
  if (!settlement) {
    await prisma.providerWebhookEvent.updateMany({ where: { id: inbox.id, processingClaimToken: claimToken }, data: { status: "IGNORED", processedAt: new Date(), processingClaimToken: null, processingClaimedAt: null, processingLeaseExpiresAt: null } });
    return { received: true, processed: false };
  }
  const result: ProviderTransferResult = { reference, amountMinor, currency, providerStatus: status.toLowerCase(), state: mapPaystackTransferStatus(status), ...(string(data.transferCode) ? { transferCode: string(data.transferCode) } : {}), ...(recipientReference ? { recipientReference } : {}) };
  if (result.state === "REVERSAL" && !["SUCCEEDED", "REVERSED"].includes(settlement.status)) {
    await prisma.providerWebhookEvent.updateMany({
      where: { id: inbox.id, processingClaimToken: claimToken },
      data: { status: "FAILED", attempts: { decrement: 1 }, deferredAttempts: { increment: 1 }, failureReason: "Reversal is waiting for the original success state", nextAttemptAt: new Date(Date.now() + 60_000), processingClaimToken: null, processingClaimedAt: null, processingLeaseExpiresAt: null },
    });
    return { received: true, processed: false, deferred: true };
  }
  try {
    await applyProviderTransferResult(settlement, result);
    await prisma.providerWebhookEvent.updateMany({ where: { id: inbox.id, processingClaimToken: claimToken }, data: { status: "PROCESSED", processedAt: new Date(), failureReason: null, processingClaimToken: null, processingClaimedAt: null, processingLeaseExpiresAt: null, nextAttemptAt: null } });
    return { received: true, processed: true };
  } catch (error) {
    const exhausted = initial.attempts + 1 >= env.FINANCIAL_WEBHOOK_MAX_ATTEMPTS;
    await prisma.providerWebhookEvent.updateMany({
      where: { id: inbox.id, processingClaimToken: claimToken },
      data: { status: exhausted ? "DEAD_LETTER" : "FAILED", failureReason: (error instanceof Error ? error.message : "Webhook processing failed").slice(0, 2000), nextAttemptAt: exhausted ? null : new Date(Date.now() + retryDelayMs(initial.attempts + 1)), deadLetteredAt: exhausted ? new Date() : null, processingClaimToken: null, processingClaimedAt: null, processingLeaseExpiresAt: null },
    });
    throw error;
  }
};

export const retryPendingPaystackTransferWebhooks = async (limit = env.FINANCIAL_WEBHOOK_RECOVERY_BATCH_SIZE, now = new Date()) => {
  const events = await prisma.providerWebhookEvent.findMany({
    where: {
      provider: "PAYSTACK",
      eventType: { in: ["transfer.success", "transfer.failed", "transfer.reversed"] },
      OR: [
        { status: "RECEIVED", attempts: { lt: env.FINANCIAL_WEBHOOK_MAX_ATTEMPTS } },
        { status: "FAILED", attempts: { lt: env.FINANCIAL_WEBHOOK_MAX_ATTEMPTS }, OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
        { status: "PROCESSING", processingLeaseExpiresAt: { lte: now } },
      ],
    },
    orderBy: { receivedAt: "asc" },
    take: Math.min(limit, env.FINANCIAL_WEBHOOK_RECOVERY_BATCH_SIZE),
    select: { id: true },
  });
  let claimed = 0;
  let processed = 0;
  let deadLettered = 0;
  let errors = 0;
  for (const event of events) {
    const lease = await claimPaystackTransferWebhook(event.id, now);
    if (!lease) continue;
    claimed += 1;
    try {
      const result = await processStoredPaystackTransferWebhook(event.id, lease.claimToken);
      if (result.processed) processed += 1;
      if ("deadLettered" in result && result.deadLettered) deadLettered += 1;
    } catch (error) {
      errors += 1;
      const state = await prisma.providerWebhookEvent.findUnique({ where: { id: event.id }, select: { status: true } });
      if (state?.status === "DEAD_LETTER") deadLettered += 1;
      console.error("[paystack-transfer-webhook] retry failed", { eventId: event.id, error: error instanceof Error ? error.message : "unknown" });
    }
  }
  return { inspected: events.length, claimed, processed, deadLettered, errors };
};
