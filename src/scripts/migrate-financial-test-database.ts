import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { assertSafeTestDatabase } from '../test-infrastructure/test-database';

assertSafeTestDatabase({ databaseUrl: process.env.DATABASE_URL, testDatabaseUrl: process.env.TEST_DATABASE_URL, nodeEnv: 'test', destructive: true });
const prismaCli = path.resolve('node_modules/prisma/build/index.js');
for (const args of [['migrate', 'deploy'], ['migrate', 'status']] as const) {
  const result = spawnSync(process.execPath, [prismaCli, ...args], { stdio: 'inherit', env: { ...process.env, NODE_ENV: 'test', DATABASE_URL: process.env.TEST_DATABASE_URL!, PAYSTACK_TRANSFERS_ENABLED: 'false' } });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
