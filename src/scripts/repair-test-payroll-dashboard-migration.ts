import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { assertSafeTestDatabase } from '../test-infrastructure/test-database';

const main = async () => {
  assertSafeTestDatabase({ databaseUrl: process.env.DATABASE_URL, testDatabaseUrl: process.env.TEST_DATABASE_URL, nodeEnv: 'test', destructive: true });
  const db = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL! } } });
  try {
    const columns = await db.$queryRaw<Array<{ TABLE_NAME: string; COLUMN_NAME: string }>>`SELECT TABLE_NAME,COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='sinkronis_test'`;
    const indexes = await db.$queryRaw<Array<{ TABLE_NAME: string; INDEX_NAME: string }>>`SELECT DISTINCT TABLE_NAME,INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA='sinkronis_test'`;
    const hasColumn = (table: string, column: string) => columns.some((row) => row.TABLE_NAME === table && row.COLUMN_NAME === column);
    const hasIndex = (table: string, index: string) => indexes.some((row) => row.TABLE_NAME === table && row.INDEX_NAME === index);
    if (!hasIndex('PayrollRun', 'PayrollRun_organizationId_periodEnd_idx')) await db.$executeRawUnsafe('CREATE INDEX `PayrollRun_organizationId_periodEnd_idx` ON `PayrollRun` (`organizationId`,`periodEnd`)');
    for (const [column, definition] of [['employerPension', 'DECIMAL(14,2) NOT NULL DEFAULT 0.00'], ['nhf', 'DECIMAL(14,2) NOT NULL DEFAULT 0.00'], ['nsitf', 'DECIMAL(14,2) NOT NULL DEFAULT 0.00'], ['departmentIdSnapshot', 'VARCHAR(191) NULL'], ['departmentNameSnapshot', 'VARCHAR(191) NULL']] as const) if (!hasColumn('Payslip', column)) await db.$executeRawUnsafe(`ALTER TABLE \`Payslip\` ADD COLUMN \`${column}\` ${definition}`);
    if (!hasIndex('Payslip', 'Payslip_organizationId_payrollRunId_idx')) await db.$executeRawUnsafe('CREATE INDEX `Payslip_organizationId_payrollRunId_idx` ON `Payslip` (`organizationId`,`payrollRunId`)');
    if (!hasColumn('TaxReport', 'dueDate')) await db.$executeRawUnsafe('ALTER TABLE `TaxReport` ADD COLUMN `dueDate` DATETIME(3) NULL');
    if (!hasIndex('TaxReport', 'TaxReport_org_period_due_idx')) await db.$executeRawUnsafe('CREATE INDEX `TaxReport_org_period_due_idx` ON `TaxReport` (`organizationId`,`periodEnd`,`dueDate`)');
  } finally { await db.$disconnect(); }
  const prismaCli = path.resolve('node_modules/prisma/build/index.js');
  const result = spawnSync(process.execPath, [prismaCli, 'migrate', 'resolve', '--applied', '20260827140000_payroll_dashboard_authoritative_fields'], { stdio: 'inherit', env: { ...process.env, NODE_ENV: 'test', DATABASE_URL: process.env.TEST_DATABASE_URL! } });
  if (result.status !== 0) process.exitCode = result.status ?? 1;
};

void main().catch((error: unknown) => { const safe = error as { code?: string; name?: string }; console.error(`TEST_MIGRATION_REPAIR_FAILED:${safe.code ?? safe.name ?? 'UNKNOWN'}`); process.exitCode = 1; });
