import assert from 'node:assert/strict';
import test from 'node:test';
import { assertSafeTestDatabase, databaseIdentity } from './test-database';

const development = 'mysql://user:password@db.example.test:4000/sinkronis_db?sslaccept=strict';
const isolated = 'mysql://user:password@db.example.test:4000/sinkronis_test?sslaccept=strict';

test('normalizes database identity instead of comparing raw URL strings', () => {
  assert.deepEqual(databaseIdentity(isolated, 'TEST_DATABASE_URL'), { protocol: 'mysql:', host: 'db.example.test', port: '4000', database: 'sinkronis_test', username: 'user' });
});
test('accepts only the explicitly isolated database', () => assert.equal(assertSafeTestDatabase({ databaseUrl: development, testDatabaseUrl: isolated, nodeEnv: 'test', destructive: true }).test.database, 'sinkronis_test'));
test('fails closed when test configuration is missing or malformed', () => {
  assert.throws(() => assertSafeTestDatabase({ databaseUrl: development }), /required/);
  assert.throws(() => assertSafeTestDatabase({ databaseUrl: development, testDatabaseUrl: 'bad' }), /valid database URL/);
});
test('rejects the development schema despite different query parameters', () => assert.throws(() => assertSafeTestDatabase({ databaseUrl: development, testDatabaseUrl: `${development}&connection_limit=1` }), /development database/));
test('rejects unapproved names and destructive non-test execution', () => {
  assert.throws(() => assertSafeTestDatabase({ databaseUrl: development, testDatabaseUrl: development.replace('sinkronis_db', 'staging') }), /approved/);
  assert.throws(() => assertSafeTestDatabase({ databaseUrl: development, testDatabaseUrl: isolated, nodeEnv: 'development', destructive: true }), /NODE_ENV=test/);
});
