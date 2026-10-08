import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import { assertSafeTestDatabase } from '../test-infrastructure/test-database';

const checked = assertSafeTestDatabase({ databaseUrl: process.env.DATABASE_URL, testDatabaseUrl: process.env.TEST_DATABASE_URL, nodeEnv: 'test', destructive: true });
const tsx = require.resolve('tsx/cli');
const args = [tsx, '--test', '--test-concurrency=1'];
if (process.env.FINANCIAL_TEST_PATTERN) args.push(`--test-name-pattern=${process.env.FINANCIAL_TEST_PATTERN}`);
// Pass explicit files on Windows. The recursive glob caused tsx/node test
// discovery to stall before hooks ran, leaving stale fixtures untouched.
const files = [
  'src/financial-tests/financial-adversarial.integration.test.ts',
  'src/financial-tests/financial-integrity-certification.integration.test.ts',
  'src/financial-tests/financial-operations.integration.test.ts',
  'src/financial-tests/phase3f-release.integration.test.ts',
  'src/financial-tests/payroll-loan-repayment.integration.test.ts'
];
if (!process.env.FINANCIAL_TEST_PATTERN || /TEST_E2E/i.test(process.env.FINANCIAL_TEST_PATTERN)) files.push('src/financial-tests/test-e2e-infrastructure.integration.test.ts');
args.push(...files);
const mockPaystackKey = ['sk', 'test', 'financialintegrationonly'].join('_');
const result = spawnSync(process.execPath, args, { stdio: 'inherit', env: { ...process.env, NODE_ENV: 'test', DATABASE_URL_ORIGINAL: process.env.DATABASE_URL!, DATABASE_URL: process.env.TEST_DATABASE_URL!, PAYSTACK_SECRET_KEY: mockPaystackKey, PAYSTACK_SUBSCRIPTION_CALLBACK_URL: 'http://localhost:3000/test/subscription/callback', PAYSTACK_TRANSFERS_ENABLED: 'false', TEST_DATABASE_GUARD: `${checked.test.host}:${checked.test.port}/${checked.test.database}` } });
process.exitCode = result.status ?? 1;
