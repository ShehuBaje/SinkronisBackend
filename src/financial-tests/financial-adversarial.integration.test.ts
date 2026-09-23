import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, test } from 'node:test';
import { Prisma } from '@prisma/client';
import { prisma } from '../core/prisma.js';
import { completeManualSettlement, prepareProviderSettlement, releaseSettlementReservation, reverseSucceededSettlement } from '../core/financial-settlement.js';
import { applyProviderTransferResult, finalizeProviderSettlementOtp, reserveAndClaimProviderSettlement, validatePaystackTransferApproval } from '../core/provider-settlement.js';
import { retryPendingPaystackTransferWebhooks } from '../core/paystack-transfer-webhook.js';
import { assertProviderTransfersEnabled } from '../core/settlement-provider.js';
import type { SettlementProvider } from '../core/settlement-provider.js';
import { financialSubscriptionTestHooks } from '../modules/admin/admin.service.js';
import { fundPayrollWallet, settlePayrollRun } from '../modules/payroll/payroll.service.js';
import { disbursePaymentRequest, fundWalletManually, processPaystackWebhook, recordInvoicePayment } from '../modules/accounting/accounting.service.js';
import { errorMiddleware } from '../middleware/error.middleware.js';
import { assertSafeTestDatabase } from '../test-infrastructure/test-database.js';
import { authorize } from '../middleware/rbac.middleware.js';
import { executePayrollWalletIncidentRepair, expectedEvidenceDigest, inspectPayrollWalletIncident, type IncidentProfile } from '../core/payroll-wallet-incident-repair.js';

const enabled = Boolean(process.env.TEST_DATABASE_GUARD);
if (enabled) {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(process.env.PAYSTACK_TRANSFERS_ENABLED, 'false');
  assertSafeTestDatabase({ databaseUrl: process.env.DATABASE_URL_ORIGINAL, testDatabaseUrl: process.env.DATABASE_URL, nodeEnv: process.env.NODE_ENV, destructive: true });
}
const financialTest = enabled ? test : test.skip;

const PREFIX = 'financial-adversarial-';
let sequence = 0;
const uid = (label: string) => `${PREFIX}${label}-${Date.now()}-${sequence++}`;
const money = (value: number | string) => new Prisma.Decimal(value);

const clean = async () => {
  await prisma.providerWebhookEvent.deleteMany();
  const organizations = await prisma.organization.findMany({ where: { slug: { startsWith: PREFIX } }, select: { id: true } });
  // Remote TiDB made stale-fixture cleanup exceed the suite timeout when old
  // organizations were removed strictly one at a time. Keep concurrency bounded
  // to avoid lock pressure while ensuring interrupted runs recover promptly.
  for (let index = 0; index < organizations.length; index += 4) {
    await Promise.all(organizations.slice(index, index + 4).map(async (organization) => {
      await prisma.accountingInvoiceStatusHistory.deleteMany({ where: { organizationId: organization.id } });
      await prisma.accountingInvoicePayment.deleteMany({ where: { organizationId: organization.id } });
      await prisma.invoice.deleteMany({ where: { organizationId: organization.id } });
      await prisma.client.deleteMany({ where: { organizationId: organization.id } });
      await prisma.payslip.deleteMany({ where: { organizationId: organization.id } });
      await prisma.employee.deleteMany({ where: { organizationId: organization.id } });
      await prisma.auditLog.deleteMany({ where: { organizationId: organization.id } });
      await prisma.auditLogChain.deleteMany({ where: { organizationId: organization.id } });
      await prisma.user.deleteMany({ where: { organizationId: organization.id } });
      await prisma.role.deleteMany({ where: { organizationId: organization.id } });
      await prisma.organization.delete({ where: { id: organization.id } });
    }));
  }
};

const fixture = async (balance = 100_000) => {
  const slug = uid('tenant');
  const organization = await prisma.organization.create({ data: { name: slug, slug, currency: 'NGN' } });
  const role = await prisma.role.create({ data: { organizationId: organization.id, name: 'Financial Test Admin', isSystem: true } });
  const user = await prisma.user.create({ data: { organizationId: organization.id, roleId: role.id, email: `${slug}@example.test`, passwordHash: 'not-a-real-password-hash', firstName: 'Financial', lastName: 'Tester' } });
  const wallet = await prisma.walletAccount.create({ data: { organizationId: organization.id, name: 'Test Wallet', purpose: 'PRIMARY', balance: money(balance), currency: 'NGN' } });
  return {
    organization,
    user,
    wallet,
    authUser: { id: user.id, organizationId: organization.id, email: user.email, roleId: role.id, isPlatformAdmin: false, permissions: ['payroll:runs:approve'] as never[] },
  };
};

const source = (fx: Awaited<ReturnType<typeof fixture>>, sourceId: string, amount: number, snapshot: Prisma.InputJsonValue = { accountNumber: '0000000001', bankCode: 'TEST' }) => ({
  organizationId: fx.organization.id,
  walletAccountId: fx.wallet.id,
  sourceType: 'ADVERSARIAL_OBLIGATION',
  sourceId,
  amount: money(amount),
  currency: 'NGN',
  beneficiarySnapshot: snapshot,
  createdById: fx.user.id,
});
const manual = (fx: Awaited<ReturnType<typeof fixture>>, sourceId: string, amount: number, reference: string, finalize: Parameters<typeof completeManualSettlement>[2] = async (_tx, _settlement, _ledgerId) => null) =>
  completeManualSettlement(source(fx, sourceId, amount), { idempotencyKey: `idem:${reference}`, externalReference: reference, settledAt: new Date(), note: 'Adversarial integration fixture' }, finalize);

const repairFixture = async () => {
  const fx = await fixture(1_545_000);
  const updatedAt = new Date('2026-09-23T05:59:05.249Z');
  await prisma.walletAccount.update({ where: { id: fx.wallet.id }, data: { updatedAt } });
  const values = [
    ['2026-09-22T21:49:45.499Z','250000.00','0.00','250000.00'], ['2026-09-22T21:51:24.612Z','1000.00','250000.00','251000.00'],
    ['2026-09-23T05:46:24.237Z','300000.00','251000.00','551000.00'], ['2026-09-23T05:47:20.488Z','300000.00','851000.00','1151000.00'],
    ['2026-09-23T05:48:58.498Z','300000.00','1151000.00','1451000.00'], ['2026-09-23T05:55:41.810Z','30000.00','1481000.00','1511000.00'],
    ['2026-09-23T05:58:51.492Z','2000.00','1541000.00','1543000.00'],
  ];
  const entries: IncidentProfile['entries'] = [];
  for (const [createdAt, amount, before, after] of values) {
    const transferReference = uid('repair-funding');
    await prisma.walletTransaction.create({ data: { organizationId: fx.organization.id, walletAccountId: fx.wallet.id, type: 'FUNDING', direction: 'CREDIT', amount: money(amount), balanceBefore: money(before), balanceAfter: money(after), reference: uid('repair-ledger'), transferReference, description: 'Payroll wallet funding', createdById: fx.user.id, createdAt: new Date(createdAt) } });
    entries.push({ createdAt, amount, before, after, referenceHash: crypto.createHash('sha256').update(transferReference).digest('hex').slice(0,12) });
  }
  const profile: IncidentProfile = { identityHash: crypto.createHash('sha256').update(`${fx.organization.id}:${fx.wallet.id}`).digest('hex').slice(0,12), currency: 'NGN', purpose: 'PRIMARY', balance: '1545000.00', reserved: '0.00', legitimateCredits: '1183000.00', legitimateDebits: '0.00', unsupported: '362000.00', correctedBalance: '1183000.00', walletUpdatedAt: updatedAt.toISOString(), entries };
  return { ...fx, profile };
};

if (enabled) before(clean);
if (enabled) after(async () => { await clean(); await prisma.$disconnect(); });

financialTest('incident dry-run is SELECT-only and fails closed on changed state', async () => {
  const fx = await repairFixture();
  const before = { wallet: await prisma.walletAccount.findUniqueOrThrow({ where: { id: fx.wallet.id } }), rows: await prisma.walletTransaction.count({ where: { walletAccountId: fx.wallet.id } }), audits: await prisma.auditLog.count({ where: { organizationId: fx.organization.id } }) };
  const result = await inspectPayrollWalletIncident(prisma, fx.profile);
  assert.equal(result.status, 'SAFE_TO_EXECUTE');
  assert.equal((await prisma.walletAccount.findUniqueOrThrow({ where: { id: fx.wallet.id } })).balance.toString(), before.wallet.balance.toString());
  assert.equal(await prisma.walletTransaction.count({ where: { walletAccountId: fx.wallet.id } }), before.rows);
  assert.equal(await prisma.auditLog.count({ where: { organizationId: fx.organization.id } }), before.audits);
  await prisma.walletAccount.update({ where: { id: fx.wallet.id }, data: { reservedBalance: money(1) } });
  const changed = await inspectPayrollWalletIncident(prisma, fx.profile);
  assert.equal(changed.status, 'NOT_SAFE_TO_EXECUTE');
  assert.ok(changed.reasons.includes('RESERVED_BALANCE_CHANGED'));
  await prisma.walletAccount.update({ where: { id: fx.wallet.id }, data: { reservedBalance: money(0), balance: money('1545000'), updatedAt: new Date(fx.profile.walletUpdatedAt) } });
  const original = await prisma.walletTransaction.findFirstOrThrow({ where: { walletAccountId: fx.wallet.id }, orderBy: { createdAt: 'asc' } });
  await prisma.walletTransaction.update({ where: { id: original.id }, data: { amount: money('250000.01') } });
  assert.equal((await inspectPayrollWalletIncident(prisma, fx.profile)).status, 'NOT_SAFE_TO_EXECUTE');
  await prisma.walletTransaction.update({ where: { id: original.id }, data: { amount: original.amount } });
  const extra = await prisma.walletTransaction.create({ data: { organizationId: fx.organization.id, walletAccountId: fx.wallet.id, type: 'FUNDING', direction: 'CREDIT', amount: money(1), balanceBefore: money(0), balanceAfter: money(1), reference: uid('extra-ledger'), transferReference: uid('extra-transfer'), description: 'Unexpected row', createdById: fx.user.id } });
  assert.equal((await inspectPayrollWalletIncident(prisma, fx.profile)).status, 'NOT_SAFE_TO_EXECUTE');
  await prisma.walletTransaction.delete({ where: { id: extra.id } });
  const settlement = await prisma.financialSettlement.create({ data: { organizationId: fx.organization.id, walletAccountId: fx.wallet.id, sourceType: 'TEST', sourceId: uid('settlement-source'), method: 'MANUAL', status: 'PREPARED', amount: money(1), currency: 'NGN', internalReference: uid('internal-ref'), idempotencyKey: uid('idem'), createdById: fx.user.id } });
  assert.equal((await inspectPayrollWalletIncident(prisma, fx.profile)).status, 'NOT_SAFE_TO_EXECUTE');
  await prisma.financialSettlement.delete({ where: { id: settlement.id } });
  assert.equal((await inspectPayrollWalletIncident(prisma, fx.profile)).status, 'SAFE_TO_EXECUTE');
});

financialTest('incident repair commits balance, unique evidence and audit exactly once', async () => {
  const fx = await repairFixture(); const digest = expectedEvidenceDigest(fx.profile);
  const result = await executePayrollWalletIncidentRepair(prisma, fx.user.id, 'PAYROLL-WALLET-ATOMICITY-2026-09-23-001', digest, fx.profile);
  assert.equal(result.status, 'APPLIED');
  const wallet = await prisma.walletAccount.findUniqueOrThrow({ where: { id: fx.wallet.id } });
  assert.equal(wallet.balance.toString(), '1183000'); assert.equal(wallet.reservedBalance.toString(), '0');
  assert.equal(await prisma.walletTransaction.count({ where: { walletAccountId: fx.wallet.id, type: 'FINANCIAL_INTEGRITY_CORRECTION', direction: 'ADJUSTMENT' } }), 1);
  assert.equal(await prisma.auditLog.count({ where: { organizationId: fx.organization.id, action: 'FINANCIAL_INTEGRITY_WALLET_CORRECTION' } }), 1);
  const replay = await executePayrollWalletIncidentRepair(prisma, fx.user.id, 'PAYROLL-WALLET-ATOMICITY-2026-09-23-001', digest, fx.profile);
  assert.equal(replay.status, 'ALREADY_APPLIED');
  assert.equal(await prisma.walletTransaction.count({ where: { walletAccountId: fx.wallet.id, type: 'FINANCIAL_INTEGRITY_CORRECTION' } }), 1);
});

financialTest('incident repair audit failure rolls back and retry succeeds', async () => {
  const fx = await repairFixture(); const digest = expectedEvidenceDigest(fx.profile);
  await prisma.auditLogChain.create({ data: { organizationId: fx.organization.id, sequence: 2_147_483_647 } });
  await assert.rejects(executePayrollWalletIncidentRepair(prisma, fx.user.id, 'PAYROLL-WALLET-ATOMICITY-2026-09-23-001', digest, fx.profile));
  assert.equal((await prisma.walletAccount.findUniqueOrThrow({ where: { id: fx.wallet.id } })).balance.toString(), '1545000');
  assert.equal(await prisma.walletTransaction.count({ where: { walletAccountId: fx.wallet.id, type: 'FINANCIAL_INTEGRITY_CORRECTION' } }), 0);
  await prisma.auditLogChain.update({ where: { organizationId: fx.organization.id }, data: { sequence: 0, lastHash: null } });
  assert.equal((await executePayrollWalletIncidentRepair(prisma, fx.user.id, 'PAYROLL-WALLET-ATOMICITY-2026-09-23-001', digest, fx.profile)).status, 'APPLIED');
});

financialTest('concurrent incident repair executions produce one correction', async () => {
  const fx = await repairFixture(); const digest = expectedEvidenceDigest(fx.profile);
  const results = await Promise.all([executePayrollWalletIncidentRepair(prisma, fx.user.id, 'PAYROLL-WALLET-ATOMICITY-2026-09-23-001', digest, fx.profile), executePayrollWalletIncidentRepair(prisma, fx.user.id, 'PAYROLL-WALLET-ATOMICITY-2026-09-23-001', digest, fx.profile)]);
  assert.deepEqual(new Set(results.map((row) => row.status)), new Set(['APPLIED','ALREADY_APPLIED']));
  assert.equal(await prisma.walletTransaction.count({ where: { walletAccountId: fx.wallet.id, type: 'FINANCIAL_INTEGRITY_CORRECTION' } }), 1);
});

financialTest('wallet reservation race never overspends 100k with two concurrent 80k obligations', async () => {
  for (let iteration = 0; iteration < 5; iteration++) {
    const fx = await fixture();
    const results = await Promise.allSettled([
      manual(fx, uid('race-a'), 80_000, uid('bank-a')),
      manual(fx, uid('race-b'), 80_000, uid('bank-b')),
    ]);
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    const wallet = await prisma.walletAccount.findUniqueOrThrow({ where: { id: fx.wallet.id } });
    assert.equal(wallet.balance.toNumber(), 20_000);
    assert.equal(wallet.reservedBalance.toNumber(), 0);
    assert.equal(await prisma.financialSettlement.count({ where: { walletAccountId: fx.wallet.id, status: 'SUCCEEDED' } }), 1);
    assert.equal(await prisma.walletTransaction.count({ where: { walletAccountId: fx.wallet.id, direction: 'DEBIT' } }), 1);
  }
});

financialTest('Payroll wallet funding rolls back required audit failure and retries exactly once', async () => {
  const fx = await fixture(0);
  const transferReference = uid('post-commit-funding');
  await prisma.auditLogChain.create({ data: { organizationId: fx.organization.id, sequence: 2_147_483_647 } });
  let thrown: unknown;
  try { await fundPayrollWallet(fx.organization.id, { amount: '125.50', transferReference }, fx.authUser); } catch (error) { thrown = error; }
  assert.ok(thrown);
  let httpStatus = 0;
  errorMiddleware(thrown, {} as any, { status(value: number) { httpStatus = value; return this; }, json() { return this; } } as any, (() => undefined) as any);
  assert.equal(httpStatus, 500);
  assert.equal((await prisma.walletAccount.findUniqueOrThrow({ where: { id: fx.wallet.id } })).balance.toString(), '0');
  assert.equal(await prisma.walletTransaction.count({ where: { organizationId: fx.organization.id, transferReference } }), 0);
  assert.equal(await prisma.auditLog.count({ where: { organizationId: fx.organization.id, action: 'PAYROLL_WALLET_FUNDED' } }), 0);
  await prisma.auditLogChain.update({ where: { organizationId: fx.organization.id }, data: { sequence: 0, lastHash: null } });
  await fundPayrollWallet(fx.organization.id, { amount: '125.50', transferReference }, fx.authUser);
  assert.equal((await prisma.walletAccount.findUniqueOrThrow({ where: { id: fx.wallet.id } })).balance.toString(), '125.5');
  assert.equal(await prisma.walletTransaction.count({ where: { organizationId: fx.organization.id, transferReference } }), 1);
  assert.equal(await prisma.auditLog.count({ where: { organizationId: fx.organization.id, action: 'PAYROLL_WALLET_FUNDED' } }), 1);
});

financialTest('Payroll wallet funding is idempotent for sequential, concurrent and response-loss replay', async () => {
  const fx = await fixture(0);
  const sequentialReference = uid('funding-sequential');
  const first = await fundPayrollWallet(fx.organization.id, { amount: '10.10', transferReference: sequentialReference }, fx.authUser);
  const replay = await fundPayrollWallet(fx.organization.id, { amount: '10.10', transferReference: sequentialReference }, fx.authUser);
  assert.equal(replay.id, first.id);
  const concurrentReference = uid('funding-concurrent');
  const concurrent = await Promise.all([
    fundPayrollWallet(fx.organization.id, { amount: '20.20', transferReference: concurrentReference }, fx.authUser),
    fundPayrollWallet(fx.organization.id, { amount: '20.20', transferReference: concurrentReference }, fx.authUser),
  ]);
  assert.equal(concurrent[0].id, concurrent[1].id);
  assert.equal((await prisma.walletAccount.findUniqueOrThrow({ where: { id: fx.wallet.id } })).balance.toString(), '30.3');
  assert.equal(await prisma.walletTransaction.count({ where: { organizationId: fx.organization.id, transferReference: { in: [sequentialReference, concurrentReference] } } }), 2);
  assert.equal(await prisma.auditLog.count({ where: { organizationId: fx.organization.id, action: 'PAYROLL_WALLET_FUNDED' } }), 2);
});

financialTest('Payroll wallet funding conflicting reference reuse never changes value', async () => {
  const fx = await fixture(0);
  const transferReference = uid('funding-conflict');
  const settled = await Promise.allSettled([
    fundPayrollWallet(fx.organization.id, { amount: '30.00', transferReference }, fx.authUser),
    fundPayrollWallet(fx.organization.id, { amount: '31.00', transferReference }, fx.authUser),
  ]);
  assert.equal(settled.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(settled.filter((result) => result.status === 'rejected').length, 1);
  const transaction = await prisma.walletTransaction.findFirstOrThrow({ where: { organizationId: fx.organization.id, transferReference } });
  assert.equal((await prisma.walletAccount.findUniqueOrThrow({ where: { id: fx.wallet.id } })).balance.toString(), transaction.amount.toString());
  assert.equal(await prisma.walletTransaction.count({ where: { organizationId: fx.organization.id, transferReference } }), 1);
});

financialTest('Accounting manual funding is atomic and idempotent under replay and concurrency', async () => {
  const fx = await fixture(0);
  const reference = uid('accounting-funding');
  const input = { walletAccountId: fx.wallet.id, amount: '42.42', externalReference: reference, description: 'Atomic funding test' };
  const first = await fundWalletManually(fx.organization.id, input, fx.authUser);
  const replay = await fundWalletManually(fx.organization.id, input, fx.authUser);
  assert.equal(replay.id, first.id);
  const concurrentReference = uid('accounting-funding-concurrent');
  const concurrentInput = { ...input, amount: '7.58', externalReference: concurrentReference };
  const concurrent = await Promise.all([fundWalletManually(fx.organization.id, concurrentInput, fx.authUser), fundWalletManually(fx.organization.id, concurrentInput, fx.authUser)]);
  assert.equal(concurrent[0].id, concurrent[1].id);
  assert.equal((await prisma.walletAccount.findUniqueOrThrow({ where: { id: fx.wallet.id } })).balance.toString(), '50');
  assert.equal(await prisma.walletTransaction.count({ where: { organizationId: fx.organization.id, type: 'MANUAL_FUNDING' } }), 2);
  assert.equal(await prisma.auditLog.count({ where: { organizationId: fx.organization.id, action: 'ACCOUNTING_WALLET_FUNDED' } }), 2);
  await assert.rejects(() => fundWalletManually(fx.organization.id, { ...input, amount: '99.99' }, fx.authUser), /already in use/i);
  assert.equal((await prisma.walletAccount.findUniqueOrThrow({ where: { id: fx.wallet.id } })).balance.toString(), '50');
});

financialTest('Accounting manual funding required audit failure rolls back all economic writes', async () => {
  const fx = await fixture(0);
  const reference = uid('accounting-audit-rollback');
  await prisma.auditLogChain.create({ data: { organizationId: fx.organization.id, sequence: 2_147_483_647 } });
  await assert.rejects(() => fundWalletManually(fx.organization.id, { walletAccountId: fx.wallet.id, amount: '15.25', externalReference: reference, description: 'Rollback test' }, fx.authUser));
  assert.equal((await prisma.walletAccount.findUniqueOrThrow({ where: { id: fx.wallet.id } })).balance.toString(), '0');
  assert.equal(await prisma.walletTransaction.count({ where: { organizationId: fx.organization.id, transferReference: reference } }), 0);
  assert.equal(await prisma.auditLog.count({ where: { organizationId: fx.organization.id, action: 'ACCOUNTING_WALLET_FUNDED' } }), 0);
});

financialTest('Invoice payment recording is atomic, idempotent, and rejects conflicting concurrency', async () => {
  const fx = await fixture(0);
  const client = await prisma.client.create({ data: { organizationId: fx.organization.id, name: 'Atomic Invoice Client', reference: uid('client') } });
  const createInvoice = (suffix: string) => prisma.invoice.create({ data: { organizationId: fx.organization.id, clientId: client.id, invoiceNo: uid(`invoice-${suffix}`), issueDate: new Date(), dueDate: new Date(Date.now() + 86_400_000), status: 'SENT', subtotal: money(100), total: money(100), amountPayable: money(100) } });
  const invoice = await createInvoice('idempotent');
  const reference = uid('invoice-payment');
  const input = { amount: '40.00', reference, paidAt: new Date(), notes: 'Atomic payment test' };
  await recordInvoicePayment(fx.organization.id, invoice.id, input, fx.authUser);
  await recordInvoicePayment(fx.organization.id, invoice.id, input, fx.authUser);
  assert.equal(await prisma.accountingInvoicePayment.count({ where: { organizationId: fx.organization.id, reference } }), 1);
  assert.equal(await prisma.accountingInvoiceStatusHistory.count({ where: { organizationId: fx.organization.id, invoiceId: invoice.id, status: 'PARTIALLY_PAID' } }), 1);
  assert.equal(await prisma.auditLog.count({ where: { organizationId: fx.organization.id, action: 'ACCOUNTING_INVOICE_PAYMENT_RECORDED', resourceId: invoice.id } }), 1);
  const conflictInvoice = await createInvoice('conflict');
  const conflictReference = uid('invoice-conflict');
  const results = await Promise.allSettled([
    recordInvoicePayment(fx.organization.id, conflictInvoice.id, { amount: '35.00', reference: conflictReference, paidAt: new Date() }, fx.authUser),
    recordInvoicePayment(fx.organization.id, conflictInvoice.id, { amount: '36.00', reference: conflictReference, paidAt: new Date() }, fx.authUser),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
  assert.equal(await prisma.accountingInvoicePayment.count({ where: { organizationId: fx.organization.id, reference: conflictReference } }), 1);
});

financialTest('Invoice required audit failure rolls payment and invoice state back', async () => {
  const fx = await fixture(0);
  const client = await prisma.client.create({ data: { organizationId: fx.organization.id, name: 'Rollback Invoice Client', reference: uid('client-rollback') } });
  const invoice = await prisma.invoice.create({ data: { organizationId: fx.organization.id, clientId: client.id, invoiceNo: uid('invoice-rollback'), issueDate: new Date(), status: 'SENT', subtotal: money(25), total: money(25), amountPayable: money(25) } });
  await prisma.auditLogChain.create({ data: { organizationId: fx.organization.id, sequence: 2_147_483_647 } });
  await assert.rejects(() => recordInvoicePayment(fx.organization.id, invoice.id, { amount: '25.00', reference: uid('invoice-rollback-payment'), paidAt: new Date() }, fx.authUser));
  assert.equal(await prisma.accountingInvoicePayment.count({ where: { invoiceId: invoice.id } }), 0);
  assert.equal((await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).status, 'SENT');
  assert.equal(await prisma.accountingInvoiceStatusHistory.count({ where: { invoiceId: invoice.id } }), 0);
  assert.equal(await prisma.auditLog.count({ where: { organizationId: fx.organization.id, resourceId: invoice.id } }), 0);
});

financialTest('high contention permits at most ten 10k debits from a 100k wallet and reconciles', async () => {
  const fx = await fixture();
  const results = await Promise.allSettled(Array.from({ length: 20 }, (_, index) => manual(fx, uid(`contention-${index}`), 10_000, uid(`contention-ref-${index}`))));
  const succeeded = results.filter((result) => result.status === 'fulfilled').length;
  assert.ok(succeeded <= 10);
  const wallet = await prisma.walletAccount.findUniqueOrThrow({ where: { id: fx.wallet.id } });
  const ledger = await prisma.walletTransaction.aggregate({ where: { walletAccountId: fx.wallet.id, direction: 'DEBIT' }, _sum: { amount: true }, _count: true });
  assert.equal(ledger._count, succeeded);
  assert.equal(Number(ledger._sum.amount ?? 0), succeeded * 10_000);
  assert.equal(wallet.balance.toNumber(), 100_000 - succeeded * 10_000);
  assert.equal(wallet.reservedBalance.toNumber(), 0);
  assert.ok(wallet.balance.gte(0));
});

financialTest('twenty duplicate settlement deliveries create one debit and one settlement', async () => {
  const fx = await fixture();
  const sourceId = uid('duplicate-source');
  const reference = uid('duplicate-ref');
  await Promise.allSettled(Array.from({ length: 20 }, () => manual(fx, sourceId, 12_500, reference)));
  assert.equal(await prisma.financialSettlement.count({ where: { organizationId: fx.organization.id, sourceId } }), 1);
  assert.equal(await prisma.walletTransaction.count({ where: { organizationId: fx.organization.id, sourceId, direction: 'DEBIT' } }), 1);
  const wallet = await prisma.walletAccount.findUniqueOrThrow({ where: { id: fx.wallet.id } });
  assert.equal(wallet.balance.toNumber(), 87_500);
});

financialTest('manual external references are unique per tenant but independent across tenants', async () => {
  const tenantA = await fixture();
  const tenantB = await fixture();
  const sharedReference = uid('shared-bank-ref');
  const sameTenant = await Promise.allSettled([
    manual(tenantA, uid('manual-a'), 1_000, sharedReference),
    manual(tenantA, uid('manual-b'), 1_000, sharedReference),
  ]);
  assert.equal(sameTenant.filter((result) => result.status === 'fulfilled').length, 1);
  await manual(tenantB, uid('manual-c'), 1_000, sharedReference);
  assert.equal(await prisma.financialSettlement.count({ where: { externalReference: sharedReference, status: 'SUCCEEDED' } }), 2);
});

financialTest('manual settlement callback failure rolls back reservation, debit, ledger and settlement', async () => {
  const fx = await fixture();
  const sourceId = uid('rollback');
  await assert.rejects(manual(fx, sourceId, 20_000, uid('rollback-ref'), async () => { throw new Error('INJECTED_FINALIZE_FAILURE'); }));
  const wallet = await prisma.walletAccount.findUniqueOrThrow({ where: { id: fx.wallet.id } });
  assert.equal(wallet.balance.toNumber(), 100_000);
  assert.equal(wallet.reservedBalance.toNumber(), 0);
  assert.equal(await prisma.financialSettlement.count({ where: { organizationId: fx.organization.id, sourceId } }), 0);
  assert.equal(await prisma.walletTransaction.count({ where: { organizationId: fx.organization.id, sourceId } }), 0);
  await manual(fx, sourceId, 20_000, uid('rollback-retry'));
  assert.equal(await prisma.walletTransaction.count({ where: { organizationId: fx.organization.id, sourceId } }), 1);
});

financialTest('tenant cannot settle against another tenant wallet', async () => {
  const tenantA = await fixture();
  const tenantB = await fixture();
  await assert.rejects(completeManualSettlement({ ...source(tenantA, uid('cross-tenant'), 1_000), walletAccountId: tenantB.wallet.id }, { idempotencyKey: uid('cross-idem'), externalReference: uid('cross-ref'), settledAt: new Date(), note: 'Attack' }, async () => null));
  const wallet = await prisma.walletAccount.findUniqueOrThrow({ where: { id: tenantB.wallet.id } });
  assert.equal(wallet.balance.toNumber(), 100_000);
});

financialTest('financial RBAC denies users missing Accounting and Payroll settlement permissions', () => {
  for (const required of [['accounting:payments:approve', 'accounting:wallets:update'], ['payroll:statutory:update']] as const) {
    let received: unknown;
    authorize(...required)({ user: { permissions: [] } } as never, {} as never, (error?: unknown) => { received = error; });
    assert.equal((received as { statusCode?: number })?.statusCode, 403);
  }
});

financialTest('beneficiary snapshot is immutable after source details change', async () => {
  const fx = await fixture();
  const sourceId = uid('snapshot');
  await manual(fx, sourceId, 1_000, uid('snapshot-ref'));
  const settlement = await prisma.financialSettlement.findFirstOrThrow({ where: { organizationId: fx.organization.id, sourceId } });
  assert.deepEqual(settlement.beneficiarySnapshot, { accountNumber: '0000000001', bankCode: 'TEST' });
});

financialTest('reservation release is idempotent under concurrent retry', async () => {
  const fx = await fixture();
  const settlement = await prisma.$transaction(async (tx) => {
    await tx.walletAccount.update({ where: { id: fx.wallet.id }, data: { reservedBalance: money(30_000) } });
    return tx.financialSettlement.create({ data: { ...source(fx, uid('release'), 30_000), method: 'PROVIDER', status: 'RESERVED', internalReference: uid('internal'), idempotencyKey: uid('release-idem'), provider: 'PAYSTACK', reservedAt: new Date() } });
  });
  await Promise.allSettled(Array.from({ length: 10 }, () => releaseSettlementReservation(fx.organization.id, settlement.id, 'Definitive provider failure')));
  const wallet = await prisma.walletAccount.findUniqueOrThrow({ where: { id: fx.wallet.id } });
  const released = await prisma.financialSettlement.findUniqueOrThrow({ where: { id: settlement.id } });
  assert.equal(wallet.balance.toNumber(), 100_000);
  assert.equal(wallet.reservedBalance.toNumber(), 0);
  assert.equal(released.status, 'FAILED');
});

financialTest('concurrent reversal creates one compensating credit and preserves original debit', async () => {
  const fx = await fixture();
  const sourceId = uid('reverse');
  const completed = await manual(fx, sourceId, 25_000, uid('reverse-debit'));
  const reversalReference = uid('reversal');
  await Promise.allSettled(Array.from({ length: 10 }, () => reverseSucceededSettlement(fx.organization.id, completed.settlement.id, reversalReference)));
  const wallet = await prisma.walletAccount.findUniqueOrThrow({ where: { id: fx.wallet.id } });
  assert.equal(wallet.balance.toNumber(), 100_000);
  assert.equal(await prisma.walletTransaction.count({ where: { walletAccountId: fx.wallet.id, sourceId, direction: 'DEBIT' } }), 1);
  assert.equal(await prisma.walletTransaction.count({ where: { walletAccountId: fx.wallet.id, sourceId, direction: 'CREDIT' } }), 1);
  assert.equal((await prisma.financialSettlement.findUniqueOrThrow({ where: { id: completed.settlement.id } })).status, 'REVERSED');
});

financialTest('reversal failure rolls back compensation and retry completes once', async () => {
  const fx = await fixture();
  const completed = await manual(fx, uid('reverse-rollback'), 15_000, uid('reverse-rollback-debit'));
  await assert.rejects(reverseSucceededSettlement(fx.organization.id, completed.settlement.id, uid('reversal-failed'), { afterLedger: async () => { throw new Error('INJECTED_REVERSAL_FAILURE'); } }));
  let wallet = await prisma.walletAccount.findUniqueOrThrow({ where: { id: fx.wallet.id } });
  assert.equal(wallet.balance.toNumber(), 85_000);
  assert.equal(await prisma.walletTransaction.count({ where: { walletAccountId: fx.wallet.id, direction: 'CREDIT' } }), 0);
  await reverseSucceededSettlement(fx.organization.id, completed.settlement.id, uid('reversal-retry'));
  wallet = await prisma.walletAccount.findUniqueOrThrow({ where: { id: fx.wallet.id } });
  assert.equal(wallet.balance.toNumber(), 100_000);
});

financialTest('provider-disabled preparation is idempotent and cannot mark the obligation paid', async () => {
  const fx = await fixture();
  const sourceId = uid('provider-disabled');
  const attempts = await Promise.all(Array.from({ length: 10 }, () => prepareProviderSettlement(source(fx, sourceId, 5_000), uid('provider-idem'))));
  assert.equal(new Set(attempts.map((row) => row.id)).size, 1);
  assert.throws(assertProviderTransfersEnabled);
  const settlement = await prisma.financialSettlement.findFirstOrThrow({ where: { organizationId: fx.organization.id, sourceId } });
  assert.equal(settlement.status, 'PREPARED');
  assert.equal(await prisma.walletTransaction.count({ where: { organizationId: fx.organization.id, sourceId } }), 0);
});

financialTest('concurrent provider pre-initiation claims reserve once and yield one initiator', async () => {
  const fx = await fixture();
  const prepared = await prepareProviderSettlement(source(fx, uid('provider-claim'), 20_000), uid('provider-claim-idem'));
  const claims = await Promise.allSettled(Array.from({ length: 10 }, () => reserveAndClaimProviderSettlement(fx.organization.id, prepared.id)));
  const fulfilled = claims.filter((claim): claim is PromiseFulfilledResult<Awaited<ReturnType<typeof reserveAndClaimProviderSettlement>>> => claim.status === 'fulfilled');
  assert.equal(fulfilled.filter((claim) => claim.value.shouldInitiate).length, 1);
  const wallet = await prisma.walletAccount.findUniqueOrThrow({ where: { id: fx.wallet.id } });
  assert.equal(wallet.balance.toNumber(), 100_000);
  assert.equal(wallet.reservedBalance.toNumber(), 20_000);
  assert.equal((await prisma.financialSettlement.findUniqueOrThrow({ where: { id: prepared.id } })).status, 'PROVIDER_PROCESSING');
});

financialTest('Paystack OTP remains non-conclusive and cannot mark the Accounting obligation paid', async () => {
  const fx = await fixture();
  const request = await prisma.paymentRequest.create({ data: { organizationId: fx.organization.id, title: 'OTP payment request', amount: money(8_000), currency: 'NGN', status: 'APPROVED', bankName: 'Test Bank', bankCode: '057', accountNumber: '0000000000', accountName: 'Test Beneficiary' } });
  const prepared = await prepareProviderSettlement({ ...source(fx, request.id, 8_000), sourceType: 'ACCOUNTING_PAYMENT_REQUEST' }, uid('otp-idem'));
  const claimed = await reserveAndClaimProviderSettlement(fx.organization.id, prepared.id);
  const settlement = await prisma.financialSettlement.update({ where: { id: claimed.settlement.id }, data: { providerRecipientReference: 'RCP_OTP_TEST' } });
  await applyProviderTransferResult(settlement, { reference: settlement.providerTransferReference!, transferCode: 'TRF_OTP_TEST', recipientReference: 'RCP_OTP_TEST', providerStatus: 'otp', state: 'NON_CONCLUSIVE', amountMinor: 800_000, currency: 'NGN' });
  const current = await prisma.financialSettlement.findUniqueOrThrow({ where: { id: settlement.id } });
  const wallet = await prisma.walletAccount.findUniqueOrThrow({ where: { id: fx.wallet.id } });
  assert.equal(current.status, 'PROVIDER_PROCESSING');
  assert.equal(current.providerStatus, 'otp');
  assert.equal(current.providerTransferReference, settlement.providerTransferReference);
  assert.equal(wallet.balance.toNumber(), 100_000);
  assert.equal(wallet.reservedBalance.toNumber(), 8_000);
  assert.equal(await prisma.walletTransaction.count({ where: { sourceId: request.id } }), 0);
  assert.equal((await prisma.paymentRequest.findUniqueOrThrow({ where: { id: request.id } })).status, 'APPROVED');
});

financialTest('OTP finalization is tenant-scoped, concurrency-claimed, non-conclusive and preserves financial state', async () => {
  const fx = await fixture();
  const other = await fixture();
  const request = await prisma.paymentRequest.create({ data: { organizationId: fx.organization.id, title: 'OTP controlled finalization', amount: money(8_000), currency: 'NGN', status: 'APPROVED', bankName: 'Test Bank', bankCode: '057', accountNumber: '0000000000', accountName: 'Test Beneficiary' } });
  const prepared = await prepareProviderSettlement({ ...source(fx, request.id, 8_000), sourceType: 'ACCOUNTING_PAYMENT_REQUEST' }, uid('otp-finalize-idem'));
  const claimed = await reserveAndClaimProviderSettlement(fx.organization.id, prepared.id);
  const awaitingOtp = await prisma.financialSettlement.update({ where: { id: claimed.settlement.id }, data: { providerRecipientReference: 'RCP_OTP_FINALIZE', providerTransferCode: 'TRF_OTP_FINALIZE', providerStatus: 'otp' } });
  let calls = 0;
  let supplied: { transferCode: string; otp: string } | undefined;
  const provider: SettlementProvider = {
    resolveAccount: async () => { throw new Error('not expected'); },
    createRecipient: async () => { throw new Error('not expected'); },
    initiateTransfer: async () => { throw new Error('not expected'); },
    verifyTransfer: async () => { throw new Error('not expected'); },
    getBalance: async () => { throw new Error('not expected'); },
    finalizeTransferOtp: async (input) => {
      calls += 1;
      supplied = input;
      await new Promise((resolve) => setTimeout(resolve, 25));
      return { reference: awaitingOtp.providerTransferReference!, transferCode: awaitingOtp.providerTransferCode!, recipientReference: awaitingOtp.providerRecipientReference!, providerStatus: 'pending', state: 'NON_CONCLUSIVE', amountMinor: 800_000, currency: 'NGN' };
    },
  };
  const dependencies = { provider, assertTransfersEnabled: () => undefined };
  await assert.rejects(finalizeProviderSettlementOtp(other.organization.id, awaitingOtp.id, '123456', dependencies));
  assert.equal(calls, 0);
  const attempts = await Promise.allSettled(Array.from({ length: 5 }, () => finalizeProviderSettlementOtp(fx.organization.id, awaitingOtp.id, '123456', dependencies)));
  assert.equal(attempts.filter((attempt) => attempt.status === 'fulfilled').length, 1);
  assert.equal(calls, 1);
  assert.deepEqual(supplied, { transferCode: 'TRF_OTP_FINALIZE', otp: '123456' });
  const current = await prisma.financialSettlement.findUniqueOrThrow({ where: { id: awaitingOtp.id } });
  const wallet = await prisma.walletAccount.findUniqueOrThrow({ where: { id: fx.wallet.id } });
  assert.equal(current.status, 'PROVIDER_PROCESSING');
  assert.equal(current.providerStatus, 'pending');
  assert.equal(current.providerTransferReference, awaitingOtp.providerTransferReference);
  assert.equal(current.providerTransferCode, 'TRF_OTP_FINALIZE');
  assert.doesNotMatch(JSON.stringify(current), /123456/);
  assert.equal(wallet.balance.toNumber(), 100_000);
  assert.equal(wallet.reservedBalance.toNumber(), 8_000);
  assert.equal(await prisma.walletTransaction.count({ where: { sourceId: request.id } }), 0);
  assert.equal((await prisma.paymentRequest.findUniqueOrThrow({ where: { id: request.id } })).status, 'APPROVED');
});

financialTest('rejected OTP restores the same retryable settlement without releasing reservation or changing reference', async () => {
  const fx = await fixture();
  const prepared = await prepareProviderSettlement(source(fx, uid('otp-rejected'), 4_000), uid('otp-rejected-idem'));
  const claimed = await reserveAndClaimProviderSettlement(fx.organization.id, prepared.id);
  const awaitingOtp = await prisma.financialSettlement.update({ where: { id: claimed.settlement.id }, data: { providerTransferCode: 'TRF_REJECTED_OTP', providerStatus: 'otp' } });
  const provider = {
    resolveAccount: async () => { throw new Error('not expected'); }, createRecipient: async () => { throw new Error('not expected'); }, initiateTransfer: async () => { throw new Error('not expected'); }, verifyTransfer: async () => { throw new Error('not expected'); }, getBalance: async () => [],
    finalizeTransferOtp: async () => { throw new (await import('../core/paystack.js')).PaystackProviderError('OTP rejected', 400, false); },
  } satisfies SettlementProvider;
  await assert.rejects(finalizeProviderSettlementOtp(fx.organization.id, awaitingOtp.id, '999999', { provider, assertTransfersEnabled: () => undefined }));
  const current = await prisma.financialSettlement.findUniqueOrThrow({ where: { id: awaitingOtp.id } });
  assert.equal(current.providerStatus, 'otp');
  assert.equal(current.providerTransferReference, awaitingOtp.providerTransferReference);
  assert.equal(current.providerTransferCode, 'TRF_REJECTED_OTP');
  assert.equal(current.reservationReleasedAt, null);
  assert.equal((await prisma.walletAccount.findUniqueOrThrow({ where: { id: fx.wallet.id } })).reservedBalance.toNumber(), 4_000);
});

const signedTransferWebhook = async (event: string, settlement: Awaited<ReturnType<typeof prepareProviderSettlement>>, status: string) => {
  const body = Buffer.from(JSON.stringify({ event, data: { reference: settlement.providerTransferReference, amount: settlement.amount.mul(100).toNumber(), currency: settlement.currency, status, transfer_code: `TRF_${settlement.id}`, recipient: { recipient_code: settlement.providerRecipientReference } } }));
  const signature = crypto.createHmac('sha512', process.env.PAYSTACK_SECRET_KEY!).update(body).digest('hex');
  return processPaystackWebhook(body, signature);
};

financialTest('Paystack approval validates durable reference, amount, currency, recipient and reservation without finalizing', async () => {
  const fx = await fixture();
  const prepared = await prepareProviderSettlement(source(fx, uid('approval'), 8_000), uid('approval-idem'));
  const claimed = await reserveAndClaimProviderSettlement(fx.organization.id, prepared.id);
  const settlement = await prisma.financialSettlement.update({ where: { id: claimed.settlement.id }, data: { providerRecipientReference: 'RCP_APPROVED_TEST' } });
  const valid = { reference: settlement.providerTransferReference, amount: 800_000, currency: 'NGN', recipient: { recipient_code: 'RCP_APPROVED_TEST' } };
  assert.equal(await validatePaystackTransferApproval(valid), true);
  assert.equal(await validatePaystackTransferApproval({ ...valid, reference: uid('unknown') }), false);
  assert.equal(await validatePaystackTransferApproval({ ...valid, amount: 799_999 }), false);
  assert.equal(await validatePaystackTransferApproval({ ...valid, currency: 'USD' }), false);
  assert.equal(await validatePaystackTransferApproval({ ...valid, recipient: { recipient_code: 'RCP_WRONG' } }), false);
  assert.equal((await prisma.financialSettlement.findUniqueOrThrow({ where: { id: settlement.id } })).status, 'PROVIDER_PROCESSING');
});

financialTest('concurrent authenticated transfer success finalizes one debit and duplicate webhook is durable', async () => {
  const fx = await fixture();
  const prepared = await prepareProviderSettlement(source(fx, uid('transfer-success'), 12_000), uid('transfer-success-idem'));
  const claimed = await reserveAndClaimProviderSettlement(fx.organization.id, prepared.id);
  const settlement = await prisma.financialSettlement.update({ where: { id: claimed.settlement.id }, data: { providerRecipientReference: 'RCP_SUCCESS_TEST' } });
  const deliveries = await Promise.allSettled(Array.from({ length: 10 }, () => signedTransferWebhook('transfer.success', settlement, 'success')));
  assert.ok(deliveries.some((delivery) => delivery.status === 'fulfilled'));
  assert.equal((await prisma.financialSettlement.findUniqueOrThrow({ where: { id: settlement.id } })).status, 'SUCCEEDED');
  assert.equal(await prisma.walletTransaction.count({ where: { sourceId: settlement.sourceId, direction: 'DEBIT' } }), 1);
  const wallet = await prisma.walletAccount.findUniqueOrThrow({ where: { id: fx.wallet.id } });
  assert.equal(wallet.balance.toNumber(), 88_000);
  assert.equal(wallet.reservedBalance.toNumber(), 0);
  assert.equal(await prisma.providerWebhookEvent.count({ where: { providerReference: settlement.providerTransferReference } }), 1);
});

financialTest('missing, invalid and tampered Paystack webhook signatures cannot mutate settlement state', async () => {
  const fx = await fixture();
  const prepared = await prepareProviderSettlement(source(fx, uid('webhook-security'), 7_000), uid('webhook-security-idem'));
  const claimed = await reserveAndClaimProviderSettlement(fx.organization.id, prepared.id);
  const settlement = await prisma.financialSettlement.update({ where: { id: claimed.settlement.id }, data: { providerRecipientReference: 'RCP_SECURITY_TEST' } });
  const body = Buffer.from(JSON.stringify({ event: 'transfer.success', data: { reference: settlement.providerTransferReference, amount: 700_000, currency: 'NGN', status: 'success', recipient: { recipient_code: 'RCP_SECURITY_TEST' } } }));
  await assert.rejects(processPaystackWebhook(body, undefined));
  await assert.rejects(processPaystackWebhook(body, 'invalid-signature'));
  const validForOriginal = crypto.createHmac('sha512', process.env.PAYSTACK_SECRET_KEY!).update(body).digest('hex');
  await assert.rejects(processPaystackWebhook(Buffer.concat([body, Buffer.from(' ')]), validForOriginal));
  assert.equal((await prisma.financialSettlement.findUniqueOrThrow({ where: { id: settlement.id } })).status, 'PROVIDER_PROCESSING');
  assert.equal(await prisma.walletTransaction.count({ where: { sourceId: settlement.sourceId } }), 0);
  assert.equal(await prisma.providerWebhookEvent.count({ where: { providerReference: settlement.providerTransferReference } }), 0);
});

financialTest('durably accepted transfer webhook resumes after a processing crash boundary', async () => {
  const fx = await fixture();
  const prepared = await prepareProviderSettlement(source(fx, uid('webhook-resume'), 9_000), uid('webhook-resume-idem'));
  const claimed = await reserveAndClaimProviderSettlement(fx.organization.id, prepared.id);
  const settlement = await prisma.financialSettlement.update({ where: { id: claimed.settlement.id }, data: { providerRecipientReference: 'RCP_RESUME_TEST' } });
  await prisma.providerWebhookEvent.create({ data: { provider: 'PAYSTACK', eventFingerprint: uid('webhook-fingerprint'), eventType: 'transfer.success', providerReference: settlement.providerTransferReference, payload: { reference: settlement.providerTransferReference!, amount: 900_000, currency: 'NGN', status: 'success', transferCode: 'TRF_RESUME_TEST', recipientReference: 'RCP_RESUME_TEST' }, status: 'RECEIVED' } });
  const recovered = await retryPendingPaystackTransferWebhooks();
  assert.equal(recovered.processed, 1);
  assert.equal((await prisma.financialSettlement.findUniqueOrThrow({ where: { id: settlement.id } })).status, 'SUCCEEDED');
  assert.equal(await prisma.walletTransaction.count({ where: { sourceId: settlement.sourceId, direction: 'DEBIT' } }), 1);
});

financialTest('transfer failure releases once and reversal compensates once under duplicate delivery', async () => {
  const failedFx = await fixture();
  const failedPrepared = await prepareProviderSettlement(source(failedFx, uid('transfer-failed'), 10_000), uid('transfer-failed-idem'));
  const failedClaim = await reserveAndClaimProviderSettlement(failedFx.organization.id, failedPrepared.id);
  const failed = await prisma.financialSettlement.update({ where: { id: failedClaim.settlement.id }, data: { providerRecipientReference: 'RCP_FAILED_TEST' } });
  await Promise.allSettled(Array.from({ length: 5 }, () => signedTransferWebhook('transfer.failed', failed, 'failed')));
  assert.equal((await prisma.financialSettlement.findUniqueOrThrow({ where: { id: failed.id } })).status, 'FAILED');
  assert.equal((await prisma.walletAccount.findUniqueOrThrow({ where: { id: failedFx.wallet.id } })).reservedBalance.toNumber(), 0);
  assert.equal(await prisma.walletTransaction.count({ where: { sourceId: failed.sourceId } }), 0);

  const reversedFx = await fixture();
  const reversedPrepared = await prepareProviderSettlement(source(reversedFx, uid('transfer-reversed'), 15_000), uid('transfer-reversed-idem'));
  const reversedClaim = await reserveAndClaimProviderSettlement(reversedFx.organization.id, reversedPrepared.id);
  const pending = await prisma.financialSettlement.update({ where: { id: reversedClaim.settlement.id }, data: { providerRecipientReference: 'RCP_REVERSED_TEST' } });
  await signedTransferWebhook('transfer.success', pending, 'success');
  const successful = await prisma.financialSettlement.findUniqueOrThrow({ where: { id: pending.id } });
  await Promise.allSettled(Array.from({ length: 5 }, () => signedTransferWebhook('transfer.reversed', successful, 'reversed')));
  assert.equal((await prisma.financialSettlement.findUniqueOrThrow({ where: { id: pending.id } })).status, 'REVERSED');
  assert.equal(await prisma.walletTransaction.count({ where: { sourceId: pending.sourceId, direction: 'CREDIT' } }), 1);
  assert.equal((await prisma.walletAccount.findUniqueOrThrow({ where: { id: reversedFx.wallet.id } })).balance.toNumber(), 100_000);
});

financialTest('Accounting payment request concurrent delivery and response-loss retry produce one debit', async () => {
  const fx = await fixture();
  const request = await prisma.paymentRequest.create({ data: { organizationId: fx.organization.id, title: 'Adversarial payment request', amount: money(25_000), currency: 'NGN', status: 'APPROVED', bankName: 'Test Bank', accountNumber: '0000000001', accountName: 'Test Beneficiary' } });
  const input = { walletAccountId: fx.wallet.id, settlementMethod: 'MANUAL' as const, idempotencyKey: uid('accounting-idem'), externalReference: uid('accounting-bank-ref'), settledAt: new Date(), note: 'Paid outside Sinkronis' };
  await Promise.allSettled(Array.from({ length: 10 }, () => disbursePaymentRequest(fx.organization.id, request.id, input, fx.authUser)));
  const replay = await disbursePaymentRequest(fx.organization.id, request.id, input, fx.authUser);
  assert.equal('idempotentReplay' in replay && replay.idempotentReplay, true);
  assert.equal(await prisma.financialSettlement.count({ where: { organizationId: fx.organization.id, sourceType: 'ACCOUNTING_PAYMENT_REQUEST', sourceId: request.id, status: 'SUCCEEDED' } }), 1);
  assert.equal(await prisma.walletTransaction.count({ where: { organizationId: fx.organization.id, sourceType: 'ACCOUNTING_PAYMENT_REQUEST', sourceId: request.id, direction: 'DEBIT' } }), 1);
  assert.equal((await prisma.paymentRequest.findUniqueOrThrow({ where: { id: request.id } })).status, 'PAID');
  const other = await fixture();
  await assert.rejects(disbursePaymentRequest(other.organization.id, request.id, { ...input, walletAccountId: other.wallet.id }, other.authUser));
});

financialTest('concurrent subscription initialization makes one mocked provider request', async () => {
  const fx = await fixture();
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (_input, init) => {
    calls++;
    const body = JSON.parse(String(init?.body)) as { reference: string };
    return new Response(JSON.stringify({ status: true, message: 'ok', data: { authorization_url: 'https://checkout.invalid/test', access_code: 'test-access', reference: body.reference } }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const input = { organizationId: fx.organization.id, operationType: 'PURCHASE' as const, planKey: 'payroll' as const, billingCycle: 'MONTHLY' as const, amount: 10_000, currency: 'NGN', effectiveAt: new Date('2026-01-01T00:00:00.000Z'), automaticRenewal: true, idempotencyKey: uid('subscription-init'), userId: fx.user.id, email: fx.user.email };
    await Promise.all(Array.from({ length: 20 }, () => financialSubscriptionTestHooks.initializeSubscriptionPayment(input)));
    assert.equal(calls, 1);
    assert.equal(await prisma.subscriptionPaymentAttempt.count({ where: { organizationId: fx.organization.id } }), 1);
  } finally { globalThis.fetch = originalFetch; }
});

financialTest('subscription idempotency conflicts by intent and remains tenant scoped', async () => {
  const tenantA = await fixture();
  const tenantB = await fixture();
  const key = uid('subscription-key');
  const base = { operationType: 'PURCHASE' as const, planKey: 'payroll' as const, billingCycle: 'MONTHLY' as const, amount: 10_000, currency: 'NGN', effectiveAt: new Date(), automaticRenewal: true, idempotencyKey: key };
  await prisma.subscriptionPaymentAttempt.create({ data: { ...base, organizationId: tenantA.organization.id, reference: uid('sub-ref-a'), status: 'UNKNOWN', activeKey: `${tenantA.organization.id}:PURCHASE`, createdByUserId: tenantA.user.id } });
  await assert.rejects(financialSubscriptionTestHooks.initializeSubscriptionPayment({ ...base, organizationId: tenantA.organization.id, planKey: 'accounting', amount: 80_000, userId: tenantA.user.id, email: tenantA.user.email }));
  await prisma.subscriptionPaymentAttempt.create({ data: { ...base, organizationId: tenantB.organization.id, reference: uid('sub-ref-b'), status: 'UNKNOWN', activeKey: `${tenantB.organization.id}:PURCHASE`, createdByUserId: tenantB.user.id } });
  assert.equal(await prisma.subscriptionPaymentAttempt.count({ where: { idempotencyKey: key } }), 2);
});

financialTest('concurrent subscription finalization produces one billing and entitlement outcome', async () => {
  const fx = await fixture();
  const attempt = await prisma.subscriptionPaymentAttempt.create({ data: { organizationId: fx.organization.id, operationType: 'PURCHASE', planKey: 'payroll', billingCycle: 'MONTHLY', amount: money(10_000), currency: 'NGN', reference: uid('verified-sub'), idempotencyKey: uid('verified-idem'), activeKey: `${fx.organization.id}:PURCHASE`, status: 'INITIALIZED', effectiveAt: new Date(), createdByUserId: fx.user.id } });
  const verification = { status: 'success', reference: attempt.reference, amount: 1_000_000, currency: 'NGN', paid_at: new Date().toISOString(), metadata: { paymentDomain: 'SUBSCRIPTION', subscriptionPaymentAttemptId: attempt.id, organizationId: fx.organization.id } };
  await Promise.allSettled(Array.from({ length: 10 }, () => financialSubscriptionTestHooks.finalizeSubscriptionPayment(attempt.id, verification)));
  const replay = await financialSubscriptionTestHooks.finalizeSubscriptionPayment(attempt.id, verification);
  assert.equal(replay.status, 'COMPLETED');
  assert.equal((await prisma.subscriptionPaymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } })).status, 'COMPLETED');
  assert.equal(await prisma.billingHistory.count({ where: { subscriptionPaymentAttemptId: attempt.id, status: 'paid' } }), 1);
  assert.equal(await prisma.systemConfig.count({ where: { organizationId: fx.organization.id, key: 'billing.subscription' } }), 1);
});

financialTest('subscription finalization failure rolls back verification claim and billing', async () => {
  const fx = await fixture();
  await prisma.systemConfig.create({ data: { organizationId: fx.organization.id, key: 'billing.subscription', value: { planKey: 'payroll', status: 'ACTIVE', billingCycle: 'MONTHLY', currency: 'NGN', renewalDate: new Date(Date.now() + 86_400_000).toISOString() } } });
  await prisma.subscriptionPlanChange.create({ data: { organizationId: fx.organization.id, fromPlanKey: 'payroll', toPlanKey: 'hris', billingCycle: 'MONTHLY', currentMonthlyCost: money(10_000), selectedMonthlyCost: money(80_000), billingImpact: money(70_000), currency: 'NGN', effectiveAt: new Date(), status: 'PENDING', paymentAuthorized: true, pendingKey: `PENDING:${fx.organization.id}` } });
  const attempt = await prisma.subscriptionPaymentAttempt.create({ data: { organizationId: fx.organization.id, operationType: 'PLAN_CHANGE', planKey: 'accounting', fromPlanKey: 'payroll', billingCycle: 'MONTHLY', amount: money(80_000), currency: 'NGN', reference: uid('rollback-sub'), idempotencyKey: uid('rollback-sub-idem'), activeKey: `${fx.organization.id}:PLAN_CHANGE`, status: 'INITIALIZED', effectiveAt: new Date(), createdByUserId: fx.user.id } });
  const verification = { status: 'success', reference: attempt.reference, amount: 8_000_000, currency: 'NGN', metadata: { paymentDomain: 'SUBSCRIPTION', subscriptionPaymentAttemptId: attempt.id, organizationId: fx.organization.id } };
  await assert.rejects(financialSubscriptionTestHooks.finalizeSubscriptionPayment(attempt.id, verification));
  assert.equal((await prisma.subscriptionPaymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } })).status, 'INITIALIZED');
  assert.equal(await prisma.billingHistory.count({ where: { subscriptionPaymentAttemptId: attempt.id } }), 0);
});

const payrollFixture = async (count: number) => {
  const fx = await fixture(count * 1_000 + 10_000);
  const run = await prisma.payrollRun.create({ data: { organizationId: fx.organization.id, name: uid('payroll'), periodStart: new Date('2026-01-01'), periodEnd: new Date('2026-01-31'), status: 'APPROVED', employeeCount: count, totalNetPay: money(count * 1_000) } });
  for (let index = 0; index < count; index++) {
    const employee = await prisma.employee.create({ data: { organizationId: fx.organization.id, employeeNo: `EMP-${sequence}-${index}`, firstName: 'Employee', lastName: `${index}`, email: `${uid('employee')}@example.test` } });
    await prisma.payslip.create({ data: { organizationId: fx.organization.id, payrollRunId: run.id, employeeId: employee.id, grossPay: money(1_000), netPay: money(1_000), currency: 'NGN', employeeNameSnapshot: `Employee ${index}`, bankSnapshot: { bankName: 'Test Bank', accountNumber: `00000${String(index).padStart(5, '0')}`, bankCode: 'TEST' } } });
  }
  return { ...fx, run };
};

financialTest('provider-confirmed success truthfully finalizes Accounting and Payroll business objects', async () => {
  const accounting = await fixture();
  const request = await prisma.paymentRequest.create({ data: { organizationId: accounting.organization.id, title: 'Provider payment request', amount: money(11_000), currency: 'NGN', status: 'APPROVED', bankName: 'Test Bank', bankCode: '044', accountNumber: '0000000001', accountName: 'Provider Beneficiary' } });
  const accountingPrepared = await prepareProviderSettlement({ organizationId: accounting.organization.id, walletAccountId: accounting.wallet.id, sourceType: 'ACCOUNTING_PAYMENT_REQUEST', sourceId: request.id, amount: request.amount, currency: request.currency, beneficiarySnapshot: { bankName: 'Test Bank', bankCode: '044', accountNumber: '0000000001', accountName: 'Provider Beneficiary' }, createdById: accounting.user.id }, uid('accounting-provider-idem'));
  const accountingClaim = await reserveAndClaimProviderSettlement(accounting.organization.id, accountingPrepared.id);
  const accountingSettlement = await prisma.financialSettlement.update({ where: { id: accountingClaim.settlement.id }, data: { providerRecipientReference: 'RCP_ACCOUNTING_TEST' } });
  await signedTransferWebhook('transfer.success', accountingSettlement, 'success');
  assert.equal((await prisma.paymentRequest.findUniqueOrThrow({ where: { id: request.id } })).status, 'PAID');

  const payroll = await payrollFixture(1);
  const slip = await prisma.payslip.findFirstOrThrow({ where: { payrollRunId: payroll.run.id } });
  await prisma.payrollRun.update({ where: { id: payroll.run.id }, data: { status: 'DISBURSING' } });
  const payrollPrepared = await prepareProviderSettlement({ organizationId: payroll.organization.id, walletAccountId: payroll.wallet.id, sourceType: 'PAYROLL_PAYSLIP', sourceId: slip.id, amount: slip.netPay, currency: slip.currency!, beneficiarySnapshot: slip.bankSnapshot as Prisma.InputJsonValue, createdById: payroll.user.id }, uid('payroll-provider-idem'));
  const payrollClaim = await reserveAndClaimProviderSettlement(payroll.organization.id, payrollPrepared.id);
  const payrollSettlement = await prisma.financialSettlement.update({ where: { id: payrollClaim.settlement.id }, data: { providerRecipientReference: 'RCP_PAYROLL_TEST' } });
  await signedTransferWebhook('transfer.success', payrollSettlement, 'success');
  assert.equal((await prisma.payslip.findUniqueOrThrow({ where: { id: slip.id } })).paymentStatus, 'PAID');
  assert.equal((await prisma.payrollRun.findUniqueOrThrow({ where: { id: payroll.run.id } })).status, 'DISBURSED');
  await signedTransferWebhook('transfer.reversed', await prisma.financialSettlement.findUniqueOrThrow({ where: { id: accountingSettlement.id } }), 'reversed');
  await signedTransferWebhook('transfer.reversed', await prisma.financialSettlement.findUniqueOrThrow({ where: { id: payrollSettlement.id } }), 'reversed');
  assert.equal((await prisma.paymentRequest.findUniqueOrThrow({ where: { id: request.id } })).status, 'APPROVED');
  assert.equal((await prisma.payslip.findUniqueOrThrow({ where: { id: slip.id } })).paymentStatus, 'REVERSED');
  assert.equal((await prisma.payrollRun.findUniqueOrThrow({ where: { id: payroll.run.id } })).status, 'DISBURSING');
});

financialTest('payroll partial completion resumes without duplicating settled payslips', async () => {
  const fx = await payrollFixture(12);
  const slips = await prisma.payslip.findMany({ where: { payrollRunId: fx.run.id }, orderBy: { id: 'asc' } });
  const batchReference = uid('payroll-batch');
  for (const slip of slips.slice(0, 7)) {
    await completeManualSettlement(
      { organizationId: fx.organization.id, walletAccountId: fx.wallet.id, sourceType: 'PAYROLL_PAYSLIP', sourceId: slip.id, amount: slip.netPay, currency: 'NGN', beneficiarySnapshot: slip.bankSnapshot as Prisma.InputJsonValue, createdById: fx.user.id },
      { idempotencyKey: `${batchReference}:${slip.id}`, externalReference: `${batchReference}:${slip.id}`, settledAt: new Date(), note: 'Partial payroll' },
      (tx) => tx.payslip.update({ where: { id: slip.id }, data: { paymentStatus: 'PAID' } }),
    );
  }
  await prisma.payrollRun.update({ where: { id: fx.run.id }, data: { status: 'DISBURSING' } });
  assert.equal((await prisma.payrollRun.findUniqueOrThrow({ where: { id: fx.run.id } })).status, 'DISBURSING');
  const result = await settlePayrollRun(fx.organization.id, fx.run.id, { settlementMethod: 'MANUAL', idempotencyKey: batchReference, externalReference: batchReference, settledAt: new Date(), note: 'Resume payroll' }, fx.authUser);
  assert.equal(result.status, 'DISBURSED');
  assert.equal(await prisma.financialSettlement.count({ where: { organizationId: fx.organization.id, sourceType: 'PAYROLL_PAYSLIP' } }), 12);
  assert.equal(await prisma.walletTransaction.count({ where: { organizationId: fx.organization.id, sourceType: 'PAYROLL_PAYSLIP', direction: 'DEBIT' } }), 12);
});

financialTest('two concurrent payroll processors cannot duplicate payslip settlement', async () => {
  const fx = await payrollFixture(6);
  const batchReference = uid('concurrent-payroll');
  await Promise.allSettled(Array.from({ length: 2 }, () => settlePayrollRun(fx.organization.id, fx.run.id, { settlementMethod: 'MANUAL', idempotencyKey: batchReference, externalReference: batchReference, settledAt: new Date(), note: 'Concurrent payroll' }, fx.authUser)));
  assert.equal(await prisma.financialSettlement.count({ where: { organizationId: fx.organization.id, sourceType: 'PAYROLL_PAYSLIP', status: 'SUCCEEDED' } }), 6);
  assert.equal(await prisma.walletTransaction.count({ where: { organizationId: fx.organization.id, sourceType: 'PAYROLL_PAYSLIP', direction: 'DEBIT' } }), 6);
  assert.equal((await prisma.payrollRun.findUniqueOrThrow({ where: { id: fx.run.id } })).status, 'DISBURSED');
});

financialTest('orphan scan finds no impossible financial states in adversarial fixtures', async () => {
  const organizationIds = (await prisma.organization.findMany({ where: { slug: { startsWith: PREFIX } }, select: { id: true } })).map((row) => row.id);
  const succeeded = await prisma.financialSettlement.findMany({ where: { organizationId: { in: organizationIds }, status: 'SUCCEEDED' }, select: { id: true, organizationId: true, walletAccountId: true, sourceType: true, sourceId: true } });
  for (const settlement of succeeded) assert.equal(await prisma.walletTransaction.count({ where: { organizationId: settlement.organizationId, walletAccountId: settlement.walletAccountId, sourceType: settlement.sourceType, sourceId: settlement.sourceId, direction: 'DEBIT' } }), 1);
  const wallets = await prisma.walletAccount.findMany({ where: { organizationId: { in: organizationIds } } });
  for (const wallet of wallets) {
    assert.ok(wallet.balance.gte(0));
    assert.ok(wallet.reservedBalance.gte(0));
    assert.ok(wallet.reservedBalance.lte(wallet.balance));
  }
  const completedAttempts = await prisma.subscriptionPaymentAttempt.findMany({ where: { organizationId: { in: organizationIds }, status: 'COMPLETED' }, select: { id: true } });
  for (const attempt of completedAttempts) assert.equal(await prisma.billingHistory.count({ where: { subscriptionPaymentAttemptId: attempt.id, status: 'paid' } }), 1);
  const paidPayslips = await prisma.payslip.findMany({ where: { organizationId: { in: organizationIds }, paymentStatus: 'PAID' }, select: { id: true, organizationId: true } });
  for (const slip of paidPayslips) assert.equal(await prisma.financialSettlement.count({ where: { organizationId: slip.organizationId, sourceType: 'PAYROLL_PAYSLIP', sourceId: slip.id, status: 'SUCCEEDED' } }), 1);
});
