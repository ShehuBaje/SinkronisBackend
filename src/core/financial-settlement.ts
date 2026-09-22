import crypto from "node:crypto";
import { Prisma, type FinancialSettlement } from "@prisma/client";
import { prisma } from "./prisma";
import { conflict, notFound } from "./http-error";
import { assertFinancialCurrency, consumeWalletReservation, financialWallet, releaseWalletReservation, reserveWalletBalance } from "./wallet-integrity";

type Db = Prisma.TransactionClient;
const financialTransactionOptions = { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 20_000, timeout: 60_000 } as const;
export type ManualSettlementInput = { idempotencyKey: string; externalReference: string; settledAt: Date; note: string };
export type SettlementSource = { organizationId: string; walletAccountId: string; sourceType: string; sourceId: string; amount: Prisma.Decimal; currency: string; beneficiarySnapshot?: Prisma.InputJsonValue; createdById?: string };

const makeReference = () => `stl_${crypto.randomUUID().replaceAll("-", "").slice(0, 28)}`;
export const settlementDto = (row: FinancialSettlement) => ({ id: row.id, sourceType: row.sourceType, sourceId: row.sourceId, method: row.method, status: row.status, amount: Number(row.amount), currency: row.currency, internalReference: row.internalReference, externalReference: row.externalReference, provider: row.provider, providerStatus: row.providerStatus, failureReason: row.failureReason, reservedAt: row.reservedAt, settledAt: row.settledAt, reversedAt: row.reversedAt, createdAt: row.createdAt });

export const completeManualSettlement = async <T>(source: SettlementSource, input: ManualSettlementInput, finalize: (tx: Db, settlement: FinancialSettlement, ledgerId: string) => Promise<T>) => {
  try {
    return await prisma.$transaction(async (tx) => {
      const existing = await tx.financialSettlement.findFirst({ where: { organizationId: source.organizationId, sourceType: source.sourceType, sourceId: source.sourceId } });
      if (existing) {
        if (existing.method === "MANUAL" && existing.externalReference === input.externalReference && existing.status === "SUCCEEDED") return { settlement: existing, result: null as T | null, idempotentReplay: true };
        if (!(existing.method === "PROVIDER" && existing.status === "PREPARED")) throw conflict("This business obligation already has a settlement");
        assertFinancialCurrency(source.currency, existing.currency);
      }
      const currency = assertFinancialCurrency(source.currency, source.currency);
      await reserveWalletBalance(tx, { ...source, currency });
      const manualData = { method: "MANUAL" as const, status: "RESERVED" as const, idempotencyKey: input.idempotencyKey, externalReference: input.externalReference, evidence: { note: input.note, assertedExternalSettlementAt: input.settledAt.toISOString() }, reservedAt: new Date(), provider: null, providerRecipientReference: null, providerTransferReference: null };
      const settlement = existing
        ? await tx.financialSettlement.update({ where: { id: existing.id }, data: manualData })
        : await tx.financialSettlement.create({ data: { organizationId: source.organizationId, walletAccountId: source.walletAccountId, sourceType: source.sourceType, sourceId: source.sourceId, amount: source.amount, currency, internalReference: makeReference(), beneficiarySnapshot: source.beneficiarySnapshot, createdById: source.createdById, ...manualData } });
      const debit = await consumeWalletReservation(tx, { ...source, currency });
      const ledger = await tx.walletTransaction.create({ data: { organizationId: source.organizationId, walletAccountId: source.walletAccountId, type: `MANUAL_${source.sourceType}`, direction: "DEBIT", amount: source.amount, balanceBefore: debit.balanceBefore, balanceAfter: debit.balanceAfter, reference: settlement.internalReference, transferReference: input.externalReference, description: `Externally settled: ${input.note}`, sourceType: source.sourceType, sourceId: source.sourceId, createdById: source.createdById } });
      const completed = await tx.financialSettlement.update({ where: { id: settlement.id }, data: { status: "SUCCEEDED", reservationReleasedAt: new Date(), settledAt: input.settledAt } });
      return { settlement: completed, result: await finalize(tx, completed, ledger.id), idempotentReplay: false };
    }, financialTransactionOptions);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw conflict("Settlement identity or external reference has already been used");
    throw error;
  }
};

export const prepareProviderSettlement = async (source: SettlementSource, idempotencyKey: string) => {
  try {
    const existing = await prisma.financialSettlement.findFirst({ where: { organizationId: source.organizationId, sourceType: source.sourceType, sourceId: source.sourceId } });
    if (existing) return existing;
    const wallet = await prisma.walletAccount.findFirst({ where: { id: source.walletAccountId, organizationId: source.organizationId } });
    if (!wallet) throw notFound("Wallet not found");
    const currency = assertFinancialCurrency(source.currency, wallet.currency);
    return await prisma.financialSettlement.create({ data: { organizationId: source.organizationId, walletAccountId: source.walletAccountId, sourceType: source.sourceType, sourceId: source.sourceId, method: "PROVIDER", status: "PREPARED", amount: source.amount, currency, internalReference: makeReference(), idempotencyKey, beneficiarySnapshot: source.beneficiarySnapshot, provider: "PAYSTACK", createdById: source.createdById } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return prisma.financialSettlement.findFirstOrThrow({ where: { organizationId: source.organizationId, sourceType: source.sourceType, sourceId: source.sourceId } });
    throw error;
  }
};

export const releaseSettlementReservation = async (organizationId: string, settlementId: string, failureReason: string) => {
  return prisma.$transaction(async (tx) => {
    const settlement = await tx.financialSettlement.findFirst({ where: { id: settlementId, organizationId } });
    if (!settlement) throw notFound("Settlement not found");
    if (settlement.status === "FAILED" && settlement.reservationReleasedAt) return settlement;
    if (!["RESERVED", "PROVIDER_PROCESSING", "UNKNOWN"].includes(settlement.status) || !settlement.reservedAt || settlement.reservationReleasedAt) {
      throw conflict("Settlement does not hold a releasable reservation");
    }
    await releaseWalletReservation(tx, { organizationId, walletAccountId: settlement.walletAccountId, amount: settlement.amount, currency: settlement.currency });
    return tx.financialSettlement.update({
      where: { id: settlement.id },
      data: { status: "FAILED", failureReason: failureReason.slice(0, 2000), reservationReleasedAt: new Date() },
    });
  }, financialTransactionOptions);
};

export const reverseSucceededSettlement = async (
  organizationId: string,
  settlementId: string,
  reversalReference: string,
  testHooks?: { afterLedger?: () => Promise<void> },
) => {
  try {
    return await prisma.$transaction(async (tx) => {
      const settlement = await tx.financialSettlement.findFirst({ where: { id: settlementId, organizationId } });
      if (!settlement) throw notFound("Settlement not found");
      if (settlement.status === "REVERSED" && settlement.reversalReference === reversalReference) return settlement;
      if (settlement.status !== "SUCCEEDED") throw conflict("Only a successful settlement can be reversed");
      const original = await tx.walletTransaction.findFirst({
        where: { organizationId, walletAccountId: settlement.walletAccountId, sourceType: settlement.sourceType, sourceId: settlement.sourceId, direction: "DEBIT" },
        orderBy: { createdAt: "asc" },
      });
      if (!original) throw conflict("Settlement debit ledger entry is missing");
      const wallet = await financialWallet(tx, organizationId, settlement.walletAccountId, settlement.currency);
      const restored = await tx.walletAccount.update({ where: { id: wallet.id }, data: { balance: { increment: settlement.amount } } });
      const ledger = await tx.walletTransaction.create({
        data: {
          organizationId,
          walletAccountId: wallet.id,
          type: `REVERSAL_${settlement.sourceType}`,
          direction: "CREDIT",
          amount: settlement.amount,
          balanceBefore: wallet.balance,
          balanceAfter: restored.balance,
          reference: reversalReference,
          transferReference: reversalReference,
          description: `Reversal of ${settlement.internalReference}`,
          sourceType: settlement.sourceType,
          sourceId: settlement.sourceId,
          reversalOfId: original.id,
          createdById: settlement.createdById,
        },
      });
      await testHooks?.afterLedger?.();
      return tx.financialSettlement.update({
        where: { id: settlement.id },
        data: { status: "REVERSED", reversedAt: new Date(), reversalReference, reversalLedgerId: ledger.id },
      });
    }, financialTransactionOptions);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const existing = await prisma.financialSettlement.findFirst({ where: { id: settlementId, organizationId, status: "REVERSED", reversalReference } });
      if (existing) return existing;
      throw conflict("Reversal identity has already been used");
    }
    throw error;
  }
};
