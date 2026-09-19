import 'dotenv/config';
import { readFileSync, writeFileSync } from 'node:fs';
import mysql from 'mysql2/promise';
import { assertSafeTestDatabase, testDatabaseUrlWithSchema } from '../test-infrastructure/test-database';

const main = async () => {
  const developmentUrl = process.env.DATABASE_URL;
  if (!developmentUrl) throw new Error('DATABASE_URL is required');
  const testUrl = testDatabaseUrlWithSchema(developmentUrl);
  assertSafeTestDatabase({ databaseUrl: developmentUrl, testDatabaseUrl: testUrl });
  const parsed = new URL(developmentUrl);
  const connection = await mysql.createConnection({ host: parsed.hostname, port: Number(parsed.port || 3306), user: decodeURIComponent(parsed.username), password: decodeURIComponent(parsed.password), ssl: { minVersion: 'TLSv1.2', rejectUnauthorized: true } });
  let created = false;
  try {
    const [existing] = await connection.query("SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = 'sinkronis_test'") as [unknown[], unknown];
    if (!existing.length) { await connection.query('CREATE DATABASE `sinkronis_test` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'); created = true; }
  } finally { await connection.end(); }
  const envPath = '.env';
  const content = readFileSync(envPath, 'utf8');
  const line = `TEST_DATABASE_URL=${testUrl}`;
  const updated = /^TEST_DATABASE_URL=.*$/m.test(content) ? content.replace(/^TEST_DATABASE_URL=.*$/m, line) : `${content.replace(/\s*$/, '')}\n${line}\n`;
  writeFileSync(envPath, updated, { encoding: 'utf8', mode: 0o600 });
  console.log('testDatabase=sinkronis_test');
  console.log(`created=${created}`);
  console.log('TEST_DATABASE_URL configured=true');
};

void main().catch((error: unknown) => { const safe = error as { code?: string; name?: string }; console.error(`TEST_DATABASE_CONFIGURATION_FAILED:${safe.code ?? safe.name ?? 'UNKNOWN'}`); process.exitCode = 1; });
