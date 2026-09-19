import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { assertSafeTestDatabase } from '../test-infrastructure/test-database';

type NameRow = { name: string };
type CountRow = { count: bigint };

const main = async () => {
  const identities = assertSafeTestDatabase({
    databaseUrl: process.env.DATABASE_URL,
    testDatabaseUrl: process.env.TEST_DATABASE_URL,
    nodeEnv: 'test',
  });
  const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL! } } });

  try {
    const selected = await prisma.$queryRaw<NameRow[]>`SELECT DATABASE() AS name`;
    const tables = await prisma.$queryRaw<NameRow[]>`
      SELECT TABLE_NAME AS name
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = 'sinkronis_test'
        AND TABLE_NAME IN ('SubscriptionPaymentAttempt', 'FinancialSettlement', 'WalletAccount', 'ProviderTransferRecipient', 'ProviderWebhookEvent')
    `;
    const reservation = await prisma.$queryRaw<CountRow[]>`
      SELECT COUNT(*) AS count
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = 'sinkronis_test'
        AND TABLE_NAME = 'WalletAccount'
        AND COLUMN_NAME = 'reservedBalance'
    `;
    const constraints = await prisma.$queryRaw<NameRow[]>`
      SELECT DISTINCT INDEX_NAME AS name
      FROM INFORMATION_SCHEMA.STATISTICS
      WHERE TABLE_SCHEMA = 'sinkronis_test'
        AND TABLE_NAME = 'FinancialSettlement'
        AND NON_UNIQUE = 0
    `;
    const migrationFailures = await prisma.$queryRaw<CountRow[]>`
      SELECT COUNT(*) AS count
      FROM _prisma_migrations
      WHERE finished_at IS NULL AND rolled_back_at IS NULL
    `;
    const organizations = await prisma.$queryRaw<CountRow[]>`SELECT COUNT(*) AS count FROM Organization`;

    const requiredTables = new Set(tables.map((row) => row.name));
    const requiredConstraints = new Set([
      'FinancialSettlement_org_source_key',
      'FinancialSettlement_org_idempotency_key',
      'FinancialSettlement_org_internal_ref_key',
      'FinancialSettlement_org_external_ref_key',
      'FinancialSettlement_provider_transfer_key',
      'FinancialSettlement_org_reversal_ref_key',
    ]);
    const actualConstraints = new Set(constraints.map((row) => row.name));
    const result = {
      connected: selected[0]?.name === identities.test.database,
      database: identities.test.database,
      isolatedFromDevelopment: identities.development.database !== identities.test.database,
      subscriptionPaymentAttempt: requiredTables.has('SubscriptionPaymentAttempt'),
      financialSettlement: requiredTables.has('FinancialSettlement'),
      providerTransferRecipient: requiredTables.has('ProviderTransferRecipient'),
      providerWebhookEvent: requiredTables.has('ProviderWebhookEvent'),
      walletReservationField: Number(reservation[0]?.count ?? 0n) === 1,
      financialUniqueConstraints: [...requiredConstraints].every((name) => actualConstraints.has(name)),
      migrationFailures: Number(migrationFailures[0]?.count ?? 0n),
      organizationFixtures: Number(organizations[0]?.count ?? 0n),
    };
    console.log(JSON.stringify(result, null, 2));
    if (Object.entries(result).some(([key, value]) => key !== 'database' && key !== 'organizationFixtures' && value !== true && value !== 0)) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
};

void main().catch((error: unknown) => {
  const safe = error as { code?: string; name?: string };
  console.error(`TEST_DATABASE_VERIFICATION_FAILED:${safe.code ?? safe.name ?? 'UNKNOWN'}`);
  process.exitCode = 1;
});
