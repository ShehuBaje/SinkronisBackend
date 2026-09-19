import assert from 'node:assert/strict';
import test from 'node:test';

test('financial integration process is connected only to sinkronis_test', { skip: !process.env.TEST_DATABASE_GUARD }, async () => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.ok(process.env.TEST_DATABASE_GUARD);
  assert.equal(process.env.PAYSTACK_TRANSFERS_ENABLED, 'false');
  const { prisma } = await import('../core/prisma.js');
  const rows = await prisma.$queryRaw<Array<{ databaseName: string }>>`SELECT DATABASE() databaseName`;
  assert.equal(rows[0]?.databaseName, 'sinkronis_test');
  await prisma.$disconnect();
});
