import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { assertSafeTestDatabase } from '../test-infrastructure/test-database';

const checked = assertSafeTestDatabase({ databaseUrl: process.env.DATABASE_URL, testDatabaseUrl: process.env.TEST_DATABASE_URL, nodeEnv: 'test', destructive: true });
const tsx = path.resolve('node_modules/tsx/dist/cli.mjs');
const args = [tsx, '--test', '--test-concurrency=1'];
if (process.env.FINANCIAL_TEST_PATTERN) args.push(`--test-name-pattern=${process.env.FINANCIAL_TEST_PATTERN}`);
args.push('src/financial-tests/**/*.test.ts');
const mockPaystackKey = ['sk', 'test', 'financialintegrationonly'].join('_');
const result = spawnSync(process.execPath, args, { stdio: 'inherit', env: { ...process.env, NODE_ENV: 'test', DATABASE_URL_ORIGINAL: process.env.DATABASE_URL!, DATABASE_URL: process.env.TEST_DATABASE_URL!, PAYSTACK_SECRET_KEY: mockPaystackKey, PAYSTACK_SUBSCRIPTION_CALLBACK_URL: 'http://localhost:3000/test/subscription/callback', PAYSTACK_TRANSFERS_ENABLED: 'false', TEST_DATABASE_GUARD: `${checked.test.host}:${checked.test.port}/${checked.test.database}` } });
process.exitCode = result.status ?? 1;
