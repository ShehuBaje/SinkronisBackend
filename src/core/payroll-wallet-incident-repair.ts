import crypto from "crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { createAuditLog } from "../modules/admin/admin.audit";

export const INCIDENT_ID = "PAYROLL-WALLET-ATOMICITY-2026-09-23-001";
export const CORRECTION_TYPE = "FINANCIAL_INTEGRITY_CORRECTION";
export const CORRECTION_DIRECTION = "ADJUSTMENT";
export const CORRECTION_SOURCE = "FINANCIAL_INTEGRITY_REPAIR";
export const PREVENTIVE_HOTFIX = "e6dfe2daf5a4a1ed0c37ddba68ff8fe2256c050e";

type Db = PrismaClient | Prisma.TransactionClient;
type ExpectedEntry = { createdAt: string; amount: string; before: string; after: string; referenceHash: string };
export type IncidentProfile = {
  identityHash: string; currency: string; purpose: string; balance: string; reserved: string;
  legitimateCredits: string; legitimateDebits: string; unsupported: string; correctedBalance: string;
  walletUpdatedAt: string; entries: ExpectedEntry[];
};

export const productionIncidentProfile: IncidentProfile = {
  identityHash: "fcefcb648dfd", currency: "NGN", purpose: "PRIMARY", balance: "1546000.00", reserved: "0.00",
  legitimateCredits: "1184000.00", legitimateDebits: "0.00", unsupported: "362000.00", correctedBalance: "1184000.00",
  walletUpdatedAt: "2026-09-23T15:15:09.724Z",
  entries: [
    { createdAt: "2026-09-22T21:49:45.499Z", amount: "250000.00", before: "0.00", after: "250000.00", referenceHash: "e66080bc14af" },
    { createdAt: "2026-09-22T21:51:24.612Z", amount: "1000.00", before: "250000.00", after: "251000.00", referenceHash: "081d769f6b80" },
    { createdAt: "2026-09-23T05:46:24.237Z", amount: "300000.00", before: "251000.00", after: "551000.00", referenceHash: "228bb0c1277a" },
    { createdAt: "2026-09-23T05:47:20.488Z", amount: "300000.00", before: "851000.00", after: "1151000.00", referenceHash: "25e011813a7d" },
    { createdAt: "2026-09-23T05:48:58.498Z", amount: "300000.00", before: "1151000.00", after: "1451000.00", referenceHash: "b621b19693d4" },
    { createdAt: "2026-09-23T05:55:41.810Z", amount: "30000.00", before: "1481000.00", after: "1511000.00", referenceHash: "154dc9ac6a9e" },
    { createdAt: "2026-09-23T05:58:51.492Z", amount: "2000.00", before: "1541000.00", after: "1543000.00", referenceHash: "186335bc65ec" },
    { createdAt: "2026-09-23T15:15:10.206Z", amount: "1000.00", before: "1545000.00", after: "1546000.00", referenceHash: "bf56acf6ceb5" },
  ],
};

const hash = (value: string) => crypto.createHash("sha256").update(value).digest("hex");
const shortHash = (value: string) => hash(value).slice(0, 12);
const money = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value).toFixed(2);
const evidenceFor = (rows: Array<{ createdAt: Date; type: string; direction: string; amount: Prisma.Decimal; balanceBefore: Prisma.Decimal; balanceAfter: Prisma.Decimal; transferReference: string | null }>) =>
  rows.map((row) => ({ createdAt: row.createdAt.toISOString(), amount: money(row.amount), before: money(row.balanceBefore), after: money(row.balanceAfter), referenceHash: shortHash(row.transferReference ?? ""), type: row.type, direction: row.direction }));
export const expectedEvidenceDigest = (profile: IncidentProfile) => hash(JSON.stringify(profile.entries.map((entry) => ({ ...entry, type: "FUNDING", direction: "CREDIT" }))));

const locateWallet = async (db: Db, profile: IncidentProfile) => {
  const wallets = await db.walletAccount.findMany({ select: { id: true, organizationId: true } });
  const match = wallets.find((row) => shortHash(`${row.organizationId}:${row.id}`) === profile.identityHash);
  return match ?? null;
};

export const inspectPayrollWalletIncident = async (db: Db, profile: IncidentProfile = productionIncidentProfile) => {
  const identity = await locateWallet(db, profile);
  const reasons: string[] = [];
  if (!identity) return { status: "NOT_SAFE_TO_EXECUTE" as const, reasons: ["INCIDENT_WALLET_NOT_FOUND"] };
  const wallet = await db.walletAccount.findFirst({ where: identity, include: { transactions: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } } });
  if (!wallet) return { status: "NOT_SAFE_TO_EXECUTE" as const, reasons: ["INCIDENT_WALLET_NOT_FOUND"] };
  const correction = wallet.transactions.find((row) => row.type === CORRECTION_TYPE && row.sourceType === CORRECTION_SOURCE && row.sourceId === INCIDENT_ID);
  const correctionAudit = correction ? await db.auditLog.count({ where: { organizationId: wallet.organizationId, action: "FINANCIAL_INTEGRITY_WALLET_CORRECTION", resourceId: correction.id } }) : 0;
  if (correction) {
    const valid = correction.direction === CORRECTION_DIRECTION && correction.amount.equals(profile.unsupported) && wallet.balance.equals(profile.correctedBalance) && wallet.reservedBalance.equals(profile.reserved) && correctionAudit === 1;
    return { status: valid ? "ALREADY_APPLIED" as const : "NOT_SAFE_TO_EXECUTE" as const, reasons: valid ? [] : ["CONFLICTING_REPAIR_EVIDENCE"], incidentId: INCIDENT_ID, walletFingerprint: profile.identityHash };
  }
  const rows = wallet.transactions;
  const credits = rows.filter((row) => row.type === "FUNDING" && row.direction === "CREDIT");
  const debitTotal = rows.filter((row) => row.direction === "DEBIT").reduce((sum, row) => sum.add(row.amount), new Prisma.Decimal(0));
  const creditTotal = credits.reduce((sum, row) => sum.add(row.amount), new Prisma.Decimal(0));
  const digest = hash(JSON.stringify(evidenceFor(rows)));
  const expectedDigest = expectedEvidenceDigest(profile);
  const [settlements, disbursements, fundingAttempts] = await Promise.all([
    db.financialSettlement.count({ where: { walletAccountId: wallet.id } }), db.walletDisbursement.count({ where: { walletAccountId: wallet.id } }), db.walletFundingAttempt.count({ where: { walletAccountId: wallet.id } }),
  ]);
  if (wallet.currency !== profile.currency) reasons.push("CURRENCY_CHANGED");
  if (wallet.purpose !== profile.purpose) reasons.push("WALLET_PURPOSE_CHANGED");
  if (!wallet.balance.equals(profile.balance)) reasons.push("BALANCE_CHANGED");
  if (!wallet.reservedBalance.equals(profile.reserved)) reasons.push("RESERVED_BALANCE_CHANGED");
  if (wallet.updatedAt.toISOString() !== profile.walletUpdatedAt) reasons.push("WALLET_UPDATED");
  if (rows.length !== profile.entries.length || credits.length !== profile.entries.length) reasons.push("LEDGER_COUNT_CHANGED");
  if (!creditTotal.equals(profile.legitimateCredits)) reasons.push("CREDIT_TOTAL_CHANGED");
  if (!debitTotal.equals(profile.legitimateDebits)) reasons.push("DEBIT_TOTAL_CHANGED");
  if (!rows[0]?.balanceBefore.equals(0)) reasons.push("OPENING_BALANCE_CHANGED");
  if (digest !== expectedDigest) reasons.push("EVIDENCE_FINGERPRINT_CHANGED");
  if (settlements) reasons.push("SETTLEMENT_PRESENT");
  if (disbursements) reasons.push("DISBURSEMENT_PRESENT");
  if (fundingAttempts) reasons.push("FUNDING_ATTEMPT_PRESENT");
  const corrected = creditTotal.sub(debitTotal);
  if (!wallet.balance.sub(corrected).equals(profile.unsupported)) reasons.push("UNSUPPORTED_AMOUNT_CHANGED");
  return {
    status: reasons.length ? "NOT_SAFE_TO_EXECUTE" as const : "SAFE_TO_EXECUTE" as const, reasons, incidentId: INCIDENT_ID,
    walletFingerprint: profile.identityHash, currency: wallet.currency, storedBalance: money(wallet.balance), reservedBalance: money(wallet.reservedBalance),
    ledgerCount: rows.length, legitimateCreditTotal: money(creditTotal), legitimateDebitTotal: money(debitTotal), evidenceFingerprint: digest,
    evidenceFingerprintMatched: digest === expectedDigest, settlements, disbursements, fundingAttempts, previousRepair: false,
    reconstructedBalance: money(corrected), correctedSpendableBalance: money(corrected.sub(wallet.reservedBalance)), unsupportedAmount: money(wallet.balance.sub(corrected)),
    proposedBalance: profile.correctedBalance, proposedReservedBalance: profile.reserved,
  };
};

export const executePayrollWalletIncidentRepair = async (client: PrismaClient, actorUserId: string, incidentId: string, evidenceDigest: string, profile: IncidentProfile = productionIncidentProfile) => {
  if (incidentId !== INCIDENT_ID || evidenceDigest !== expectedEvidenceDigest(profile)) throw new Error("REPAIR_CONFIRMATION_MISMATCH");
  const identity = await locateWallet(client, profile); if (!identity) throw new Error("INCIDENT_WALLET_NOT_FOUND");
  try { return await client.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM WalletAccount WHERE id=${identity.id} AND organizationId=${identity.organizationId} FOR UPDATE`;
    const inspection = await inspectPayrollWalletIncident(tx, profile);
    if (inspection.status === "ALREADY_APPLIED") return inspection;
    if (inspection.status !== "SAFE_TO_EXECUTE") throw new Error(`REPAIR_PRECONDITION_FAILED:${inspection.reasons.join(",")}`);
    const changed = await tx.walletAccount.updateMany({ where: { ...identity, currency: profile.currency, balance: new Prisma.Decimal(profile.balance), reservedBalance: new Prisma.Decimal(profile.reserved), updatedAt: new Date(profile.walletUpdatedAt) }, data: { balance: new Prisma.Decimal(profile.correctedBalance) } });
    if (changed.count !== 1) throw new Error("REPAIR_CONDITIONAL_UPDATE_FAILED");
    const correction = await tx.walletTransaction.create({ data: { organizationId: identity.organizationId, walletAccountId: identity.id, type: CORRECTION_TYPE, direction: CORRECTION_DIRECTION, amount: new Prisma.Decimal(profile.unsupported), balanceBefore: new Prisma.Decimal(profile.balance), balanceAfter: new Prisma.Decimal(profile.correctedBalance), reference: `FIX-${INCIDENT_ID}`, description: "Correction of unsupported internal wallet value caused by historical transaction atomicity defect", sourceType: CORRECTION_SOURCE, sourceId: INCIDENT_ID, createdById: actorUserId } });
    await createAuditLog({ organizationId: identity.organizationId, actorUserId, action: "FINANCIAL_INTEGRITY_WALLET_CORRECTION", resource: "WALLET_TRANSACTION", resourceId: correction.id, summary: "Corrected unsupported payroll wallet value from historical transaction atomicity defect", metadata: { incidentId: INCIDENT_ID, walletFingerprint: profile.identityHash, currency: profile.currency, correctionAmount: profile.unsupported, beforeBalance: profile.balance, afterBalance: profile.correctedBalance, beforeReservedBalance: profile.reserved, afterReservedBalance: profile.reserved, evidenceFingerprint: evidenceDigest, reason: "historical Prisma/TiDB unsupported-isolation atomicity defect", preventiveHotfix: PREVENTIVE_HOTFIX } }, tx);
    return { status: "APPLIED" as const, incidentId: INCIDENT_ID, walletFingerprint: profile.identityHash, correctionId: correction.id };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 20_000, timeout: 60_000 }); }
  catch (error) {
    if (error instanceof Error && error.message === "REPAIR_CONDITIONAL_UPDATE_FAILED") {
      const afterRace = await inspectPayrollWalletIncident(client, profile);
      if (afterRace.status === "ALREADY_APPLIED") return afterRace;
    }
    throw error;
  }
};
