import crypto from "node:crypto";
import { Prisma, type FinancialSettlement } from "@prisma/client";
import { env } from "../config/env";
import { conflict, notFound } from "./http-error";
import { prisma } from "./prisma";
import { PaystackProviderError, paystackMinorUnits } from "./paystack";
import { PaystackTransferProvider } from "./paystack-transfer-provider";
import { assertProviderTransfersEnabled, type ProviderTransferResult, type SettlementProvider } from "./settlement-provider";
import { releaseSettlementReservation, reverseSucceededSettlement } from "./financial-settlement";
import { assertIncidentWalletMutationAllowed } from "./payroll-wallet-incident-pause";

const txOptions = { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 20_000, timeout: 60_000 } as const;
const activeStatuses = ["RESERVED", "PROVIDER_PROCESSING", "UNKNOWN"] as const;
type Beneficiary = { bankCode: string; accountNumber: string; accountName?: string; bankName?: string };

const beneficiary = (value: Prisma.JsonValue | null): Beneficiary => {
  if (!value || Array.isArray(value) || typeof value !== "object") throw conflict("Settlement beneficiary snapshot is missing");
  const row = value as Record<string, unknown>;
  if (typeof row.bankCode !== "string" || typeof row.accountNumber !== "string") throw conflict("Settlement beneficiary bank code or account number is missing");
  return { bankCode: row.bankCode, accountNumber: row.accountNumber, ...(typeof row.accountName === "string" ? { accountName: row.accountName } : {}), ...(typeof row.bankName === "string" ? { bankName: row.bankName } : {}) };
};
const normalizeName = (value: string) => value.normalize("NFKD").replace(/[^a-z0-9]/gi, "").toLowerCase();
const fingerprint = (organizationId: string, bankCode: string, accountNumber: string) => crypto.createHmac("sha256", env.JWT_ACCESS_SECRET).update(`${organizationId}:${bankCode}:${accountNumber}`).digest("hex");
const assertTenantProviderMode = async (organizationId: string) => {
  const tenant = await prisma.organization.findUnique({ where: { id: organizationId }, select: { classification: true } });
  if (!tenant) throw notFound("Organization not found");
  if (tenant.classification === "TEST_E2E" && env.PAYSTACK_TRANSFERS_MODE !== "test") throw conflict("TEST_E2E tenants can only use Paystack Test-mode transfers", { errorCode: "TEST_TENANT_LIVE_PROVIDER_BLOCKED" });
};

export const reserveAndClaimProviderSettlement = async (organizationId: string, settlementId: string) => prisma.$transaction(async (tx) => {
  let settlement = await tx.financialSettlement.findFirst({ where: { id: settlementId, organizationId } });
  if (!settlement) throw notFound("Settlement not found");
  assertIncidentWalletMutationAllowed(organizationId, settlement.walletAccountId);
  if (settlement.status === "SUCCEEDED" || settlement.status === "REVERSED" || settlement.status === "FAILED") return { settlement, shouldInitiate: false };
  if (settlement.status === "PREPARED") {
    const preparedClaim = await tx.financialSettlement.updateMany({ where: { id: settlement.id, organizationId, status: "PREPARED" }, data: { status: "RESERVED", reservedAt: new Date(), providerTransferReference: settlement.internalReference } });
    if (preparedClaim.count !== 1) return { settlement, shouldInitiate: false };
    const reserved = await tx.$executeRaw`UPDATE WalletAccount SET reservedBalance = reservedBalance + ${settlement.amount} WHERE id = ${settlement.walletAccountId} AND organizationId = ${organizationId} AND balance - reservedBalance >= ${settlement.amount}`;
    if (reserved !== 1) throw conflict("Insufficient spendable wallet balance");
    settlement = await tx.financialSettlement.findUniqueOrThrow({ where: { id: settlement.id } });
  }
  if (settlement.status !== "RESERVED" || settlement.initiationClaimedAt) return { settlement, shouldInitiate: false };
  const claim = await tx.financialSettlement.updateMany({ where: { id: settlement.id, organizationId, status: "RESERVED", initiationClaimedAt: null }, data: { status: "PROVIDER_PROCESSING", initiationClaimedAt: new Date(), providerProcessingAt: new Date(), providerTransferReference: settlement.internalReference } });
  if (claim.count !== 1) return { settlement: await tx.financialSettlement.findUniqueOrThrow({ where: { id: settlement.id } }), shouldInitiate: false };
  return { settlement: await tx.financialSettlement.findUniqueOrThrow({ where: { id: settlement.id } }), shouldInitiate: true };
}, txOptions);

const ensureRecipient = async (settlement: FinancialSettlement, provider: SettlementProvider) => {
  const destination = beneficiary(settlement.beneficiarySnapshot);
  const accountFingerprint = fingerprint(settlement.organizationId, destination.bankCode, destination.accountNumber);
  const payrollBeneficiary = settlement.sourceType === "PAYROLL_PAYSLIP" ? await prisma.payslip.findFirst({ where: { id: settlement.sourceId, organizationId: settlement.organizationId }, select: { employeeId: true } }) : null;
  const beneficiaryType = payrollBeneficiary ? "EMPLOYEE" : settlement.sourceType;
  const beneficiaryId = payrollBeneficiary?.employeeId ?? settlement.sourceId;
  const recipientIdentity = { organizationId: settlement.organizationId, provider: "PAYSTACK", beneficiaryType, beneficiaryId, currency: settlement.currency, bankCode: destination.bankCode, accountFingerprint, active: true } as const;
  const existing = await prisma.providerTransferRecipient.findFirst({ where: recipientIdentity });
  if (existing) return existing;
  const resolved = await provider.resolveAccount({ accountNumber: destination.accountNumber, bankCode: destination.bankCode });
  if (resolved.accountNumber !== destination.accountNumber) throw conflict("Resolved bank account does not match settlement beneficiary");
  if (destination.accountName && normalizeName(destination.accountName) !== normalizeName(resolved.accountName)) throw conflict("Resolved account name does not match settlement beneficiary");
  const created = await provider.createRecipient({ accountNumber: destination.accountNumber, bankCode: destination.bankCode, accountName: resolved.accountName, currency: settlement.currency });
  try {
    return await prisma.providerTransferRecipient.create({ data: { ...recipientIdentity, accountLast4: destination.accountNumber.slice(-4), resolvedAccountName: resolved.accountName, providerRecipientCode: created.recipientReference, providerRecipientId: created.providerRecipientId } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return prisma.providerTransferRecipient.findFirstOrThrow({ where: recipientIdentity });
    throw error;
  }
};

const assertResult = (settlement: FinancialSettlement, result: ProviderTransferResult) => {
  if (result.reference !== settlement.providerTransferReference || result.amountMinor !== paystackMinorUnits(settlement.amount) || result.currency !== settlement.currency) throw conflict("Provider transfer does not match settlement");
  if (result.recipientReference && settlement.providerRecipientReference && result.recipientReference !== settlement.providerRecipientReference) throw conflict("Provider transfer recipient does not match settlement");
};

const updatePayrollAggregate = async (tx: Prisma.TransactionClient, payslipId: string, successful: boolean) => {
  const slip = await tx.payslip.findUnique({ where: { id: payslipId }, select: { payrollRunId: true, organizationId: true } });
  if (!slip) return;
  if (!successful) {
    await tx.payrollRun.updateMany({ where: { id: slip.payrollRunId, organizationId: slip.organizationId, status: { notIn: ["CANCELLED"] } }, data: { status: "DISBURSING", disbursedAt: null } });
    return;
  }
  const remaining = await tx.payslip.count({ where: { payrollRunId: slip.payrollRunId, organizationId: slip.organizationId, paymentStatus: { not: "PAID" } } });
  await tx.payrollRun.update({ where: { id: slip.payrollRunId }, data: remaining ? { status: "DISBURSING", disbursedAt: null } : { status: "DISBURSED", disbursedAt: new Date() } });
};

export const finalizeProviderSettlementSuccess = async (settlementId: string, result: ProviderTransferResult) => prisma.$transaction(async (tx) => {
  const settlement = await tx.financialSettlement.findUnique({ where: { id: settlementId } });
  if (!settlement) throw notFound("Settlement not found");
  assertIncidentWalletMutationAllowed(settlement.organizationId, settlement.walletAccountId);
  if (settlement.status === "SUCCEEDED") return settlement;
  if (!activeStatuses.includes(settlement.status as typeof activeStatuses[number]) || !settlement.reservedAt || settlement.reservationReleasedAt) throw conflict("Settlement is not eligible for provider success");
  assertResult(settlement, result);
  const wallet = await tx.walletAccount.findFirst({ where: { id: settlement.walletAccountId, organizationId: settlement.organizationId } });
  if (!wallet) throw notFound("Wallet not found");
  const debited = await tx.$executeRaw`UPDATE WalletAccount SET balance = balance - ${settlement.amount}, reservedBalance = reservedBalance - ${settlement.amount} WHERE id = ${wallet.id} AND organizationId = ${settlement.organizationId} AND balance >= ${settlement.amount} AND reservedBalance >= ${settlement.amount}`;
  if (debited !== 1) throw conflict("Wallet reservation could not be finalized");
  await tx.walletTransaction.create({ data: { organizationId: settlement.organizationId, walletAccountId: wallet.id, type: `PROVIDER_${settlement.sourceType}`, direction: "DEBIT", amount: settlement.amount, balanceBefore: wallet.balance, balanceAfter: wallet.balance.sub(settlement.amount), reference: settlement.internalReference, transferReference: settlement.providerTransferReference, description: `Paystack settlement ${settlement.internalReference}`, sourceType: settlement.sourceType, sourceId: settlement.sourceId, createdById: settlement.createdById } });
  if (settlement.sourceType === "ACCOUNTING_PAYMENT_REQUEST") {
    const businessClaim = await tx.paymentRequest.updateMany({ where: { id: settlement.sourceId, organizationId: settlement.organizationId, status: "APPROVED" }, data: { status: "PAID", disbursementReference: settlement.internalReference, disbursedAt: new Date() } });
    if (businessClaim.count !== 1) throw conflict("Accounting obligation is not eligible for settlement finalization");
  }
  if (settlement.sourceType === "PAYROLL_PAYSLIP") {
    const businessClaim = await tx.payslip.updateMany({ where: { id: settlement.sourceId, organizationId: settlement.organizationId, paymentStatus: { not: "PAID" } }, data: { paymentStatus: "PAID" } });
    if (businessClaim.count !== 1) throw conflict("Payroll obligation is not eligible for settlement finalization");
    await updatePayrollAggregate(tx, settlement.sourceId, true);
  }
  return tx.financialSettlement.update({ where: { id: settlement.id }, data: { status: "SUCCEEDED", providerStatus: result.providerStatus, providerTransferCode: result.transferCode, lastVerifiedAt: new Date(), reservationReleasedAt: new Date(), settledAt: new Date(), failureReason: null } });
}, txOptions);

export const applyProviderTransferResult = async (settlement: FinancialSettlement, result: ProviderTransferResult) => {
  assertResult(settlement, result);
  if (["SUCCEEDED", "FAILED", "REVERSED"].includes(settlement.status)) {
    if ((settlement.status === "SUCCEEDED" && result.state === "SUCCESS") || (settlement.status === "FAILED" && result.state === "FAILURE") || (settlement.status === "REVERSED" && result.state === "REVERSAL") || result.state === "NON_CONCLUSIVE") return settlement;
    if (!(settlement.status === "SUCCEEDED" && result.state === "REVERSAL")) throw conflict("Provider result is incompatible with the terminal settlement state");
  }
  if (result.state === "SUCCESS") return finalizeProviderSettlementSuccess(settlement.id, result);
  if (result.state === "FAILURE") return releaseSettlementReservation(settlement.organizationId, settlement.id, `Paystack transfer ${result.providerStatus}`).then(() => prisma.financialSettlement.update({ where: { id: settlement.id }, data: { providerStatus: result.providerStatus, providerTransferCode: result.transferCode, lastVerifiedAt: new Date() } }));
  if (result.state === "REVERSAL") return reverseProviderSettlement(settlement, result);
  return prisma.financialSettlement.update({ where: { id: settlement.id }, data: { status: "PROVIDER_PROCESSING", providerStatus: result.providerStatus, providerTransferCode: result.transferCode, lastVerifiedAt: new Date() } });
};

export const reverseProviderSettlement = async (settlement: FinancialSettlement, result: ProviderTransferResult) => {
  assertResult(settlement, result);
  const reversed = await reverseSucceededSettlement(settlement.organizationId, settlement.id, `paystack-reversal-${result.reference}`);
  await prisma.$transaction(async (tx) => {
    if (settlement.sourceType === "ACCOUNTING_PAYMENT_REQUEST") await tx.paymentRequest.updateMany({ where: { id: settlement.sourceId, organizationId: settlement.organizationId, status: "PAID" }, data: { status: "APPROVED", disbursementReference: null, disbursedAt: null } });
    if (settlement.sourceType === "PAYROLL_PAYSLIP") {
      await tx.payslip.updateMany({ where: { id: settlement.sourceId, organizationId: settlement.organizationId, paymentStatus: "PAID" }, data: { paymentStatus: "REVERSED" } });
      await updatePayrollAggregate(tx, settlement.sourceId, false);
    }
    await tx.financialSettlement.update({ where: { id: reversed.id }, data: { providerStatus: result.providerStatus, lastVerifiedAt: new Date() } });
  }, txOptions);
  return prisma.financialSettlement.findUniqueOrThrow({ where: { id: reversed.id } });
};

export const initiateProviderSettlement = async (organizationId: string, settlementId: string, provider: SettlementProvider = new PaystackTransferProvider()) => {
  assertProviderTransfersEnabled();
  await assertTenantProviderMode(organizationId);
  const claimed = await reserveAndClaimProviderSettlement(organizationId, settlementId);
  if (!claimed.shouldInitiate) return claimed.settlement;
  try {
    const recipient = await ensureRecipient(claimed.settlement, provider);
    const settlement = await prisma.financialSettlement.update({ where: { id: claimed.settlement.id }, data: { providerRecipientId: recipient.id, providerRecipientReference: recipient.providerRecipientCode } });
    const result = await provider.initiateTransfer({ recipientReference: recipient.providerRecipientCode, amountMinor: paystackMinorUnits(settlement.amount), currency: settlement.currency, reference: settlement.providerTransferReference!, reason: `Sinkronis ${settlement.sourceType.toLowerCase().replaceAll("_", " ")}` });
    return applyProviderTransferResult(settlement, result);
  } catch (error) {
    if (error instanceof PaystackProviderError && error.ambiguous) return prisma.financialSettlement.update({ where: { id: claimed.settlement.id }, data: { status: "UNKNOWN", failureReason: error.message } });
    await releaseSettlementReservation(organizationId, claimed.settlement.id, error instanceof Error ? error.message : "Provider initiation failed");
    throw error;
  }
};

export const verifyAndReconcileProviderSettlement = async (settlementId: string, provider: SettlementProvider = new PaystackTransferProvider()) => {
  assertProviderTransfersEnabled();
  const settlement = await prisma.financialSettlement.findUnique({ where: { id: settlementId } });
  if (!settlement || settlement.provider !== "PAYSTACK" || !settlement.providerTransferReference) throw notFound("Provider settlement not found");
  await assertTenantProviderMode(settlement.organizationId);
  if (["SUCCEEDED", "FAILED", "REVERSED"].includes(settlement.status)) return settlement;
  try {
    const result = await provider.verifyTransfer(settlement.providerTransferReference);
    return applyProviderTransferResult(settlement, result);
  } catch (error) {
    if (error instanceof PaystackProviderError && error.statusCode === 404 && settlement.providerRecipientReference) {
      const result = await provider.initiateTransfer({ recipientReference: settlement.providerRecipientReference, amountMinor: paystackMinorUnits(settlement.amount), currency: settlement.currency, reference: settlement.providerTransferReference, reason: `Sinkronis ${settlement.sourceType.toLowerCase().replaceAll("_", " ")}` });
      return applyProviderTransferResult(settlement, result);
    }
    if (error instanceof PaystackProviderError && error.ambiguous) return prisma.financialSettlement.update({ where: { id: settlement.id }, data: { status: "UNKNOWN", failureReason: error.message, lastVerifiedAt: new Date() } });
    throw error;
  }
};

export const finalizeProviderSettlementOtp = async (
  organizationId: string,
  settlementId: string,
  otp: string,
  dependencies: { provider?: SettlementProvider; assertTransfersEnabled?: () => void } = {},
) => {
  const provider = dependencies.provider ?? new PaystackTransferProvider();
  (dependencies.assertTransfersEnabled ?? assertProviderTransfersEnabled)();
  await assertTenantProviderMode(organizationId);
  const settlement = await prisma.financialSettlement.findFirst({ where: { id: settlementId, organizationId } });
  if (!settlement) throw notFound("Settlement not found");
  if (settlement.method !== "PROVIDER" || settlement.provider !== "PAYSTACK") throw conflict("Settlement is not a Paystack provider settlement");
  if (settlement.status !== "PROVIDER_PROCESSING" || settlement.providerStatus !== "otp") throw conflict("Settlement is not awaiting OTP finalization");
  if (!settlement.reservedAt || settlement.reservationReleasedAt) throw conflict("Settlement does not have an active wallet reservation");
  if (!settlement.providerTransferCode || !settlement.providerTransferReference) throw conflict("Settlement provider transfer identity is incomplete");

  const claim = await prisma.financialSettlement.updateMany({
    where: { id: settlement.id, organizationId, status: "PROVIDER_PROCESSING", providerStatus: "otp", reservationReleasedAt: null },
    data: { providerStatus: "otp_finalizing", failureReason: null },
  });
  if (claim.count !== 1) throw conflict("OTP finalization is already in progress or no longer eligible");

  try {
    const result = await provider.finalizeTransferOtp({ transferCode: settlement.providerTransferCode, otp });
    assertResult(settlement, result);
    // Even if Paystack labels this response successful, the adapter downgrades it
    // to non-conclusive. Only webhook/verification is allowed to finalize money.
    if (result.state === "FAILURE") {
      await prisma.financialSettlement.update({ where: { id: settlement.id }, data: { providerStatus: "otp", failureReason: "OTP finalization was rejected" } });
      throw conflict("OTP finalization was rejected");
    }
    if (result.state !== "NON_CONCLUSIVE") {
      await prisma.financialSettlement.update({ where: { id: settlement.id }, data: { providerStatus: "otp", failureReason: "OTP finalization returned an unexpected terminal state" } });
      throw conflict("OTP finalization requires provider verification");
    }
    return prisma.financialSettlement.update({
      where: { id: settlement.id },
      data: { status: "PROVIDER_PROCESSING", providerStatus: result.providerStatus, providerTransferCode: settlement.providerTransferCode, lastVerifiedAt: new Date(), failureReason: null },
    });
  } catch (error) {
    if (error instanceof PaystackProviderError && error.ambiguous) {
      return prisma.financialSettlement.update({ where: { id: settlement.id }, data: { status: "UNKNOWN", providerStatus: "unknown", failureReason: "OTP finalization outcome requires verification", lastVerifiedAt: new Date() } });
    }
    await prisma.financialSettlement.updateMany({
      where: { id: settlement.id, organizationId, providerStatus: "otp_finalizing" },
      data: { providerStatus: "otp", failureReason: "OTP finalization was rejected" },
    });
    if (error instanceof PaystackProviderError) throw conflict("OTP finalization was rejected");
    throw error;
  }
};

export const validatePaystackTransferApproval = async (payload: Record<string, unknown>) => {
  const reference = typeof payload.reference === "string" ? payload.reference : undefined;
  const amount = typeof payload.amount === "number" ? payload.amount : undefined;
  const currency = typeof payload.currency === "string" ? payload.currency.toUpperCase() : undefined;
  const recipient = typeof payload.recipient === "string" ? payload.recipient : payload.recipient && typeof payload.recipient === "object" ? (payload.recipient as Record<string, unknown>).recipient_code : undefined;
  if (!reference || amount === undefined || !currency) return false;
  const settlement = await prisma.financialSettlement.findFirst({ where: { provider: "PAYSTACK", providerTransferReference: reference } });
  if (!settlement || !activeStatuses.includes(settlement.status as typeof activeStatuses[number]) || !settlement.reservedAt || settlement.reservationReleasedAt) return false;
  return amount === paystackMinorUnits(settlement.amount) && currency === settlement.currency && (!recipient || recipient === settlement.providerRecipientReference);
};

export const reconcileStaleProviderSettlements = async (provider: SettlementProvider = new PaystackTransferProvider()) => {
  if (!env.PAYSTACK_TRANSFERS_ENABLED) return { inspected: 0, reconciled: 0, disabled: true };
  const cutoff = new Date(Date.now() - env.PAYSTACK_TRANSFER_STALE_MS);
  const rows = await prisma.financialSettlement.findMany({ where: { provider: "PAYSTACK", status: { in: ["PROVIDER_PROCESSING", "UNKNOWN"] }, providerProcessingAt: { lte: cutoff } }, orderBy: { providerProcessingAt: "asc" }, take: env.PAYSTACK_TRANSFER_RECONCILIATION_BATCH_SIZE });
  let reconciled = 0;
  for (const row of rows) {
    try { await verifyAndReconcileProviderSettlement(row.id, provider); reconciled += 1; } catch (error) { console.error("[paystack-transfer-reconciliation] verification failed", { settlementId: row.id, providerReference: row.providerTransferReference, error: error instanceof Error ? error.message : "unknown" }); }
  }
  return { inspected: rows.length, reconciled, disabled: false };
};
