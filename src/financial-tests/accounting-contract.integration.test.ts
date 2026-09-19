import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { prisma } from "../core/prisma.js";
import {
  createAccountingProject,
  createCatalogueItem,
  createInvoice,
  listCatalogueItems,
} from "../modules/accounting/accounting.service.js";
import { assertSafeTestDatabase } from "../test-infrastructure/test-database.js";

const enabled = Boolean(process.env.TEST_DATABASE_GUARD);
if (enabled) {
  assert.equal(process.env.NODE_ENV, "test");
  assertSafeTestDatabase({
    databaseUrl: process.env.DATABASE_URL_ORIGINAL,
    testDatabaseUrl: process.env.DATABASE_URL,
    nodeEnv: process.env.NODE_ENV,
    destructive: true,
  });
}
const integrationTest = enabled ? test : test.skip;
const PREFIX = "accounting-contract-";
let sequence = 0;
const uid = (label: string) => `${PREFIX}${label}-${Date.now()}-${sequence++}`;

const cleanup = async () => {
  const organizations = await prisma.organization.findMany({
    where: { slug: { startsWith: PREFIX } },
    select: { id: true },
  });
  for (const organization of organizations) {
    await prisma.invoice.deleteMany({ where: { organizationId: organization.id } });
    await prisma.accountingProject.deleteMany({ where: { organizationId: organization.id } });
    await prisma.accountingCatalogueItem.deleteMany({ where: { organizationId: organization.id } });
    await prisma.client.deleteMany({ where: { organizationId: organization.id } });
    await prisma.auditLog.deleteMany({ where: { organizationId: organization.id } });
    await prisma.auditLogChain.deleteMany({ where: { organizationId: organization.id } });
    await prisma.user.deleteMany({ where: { organizationId: organization.id } });
    await prisma.role.deleteMany({ where: { organizationId: organization.id } });
    await prisma.organization.delete({ where: { id: organization.id } });
  }
};

const fixture = async () => {
  const slug = uid("tenant");
  const organization = await prisma.organization.create({ data: { name: slug, slug, currency: "NGN" } });
  const role = await prisma.role.create({ data: { organizationId: organization.id, name: "Accounting Contract Admin", isSystem: true } });
  const user = await prisma.user.create({
    data: {
      organizationId: organization.id,
      roleId: role.id,
      email: `${slug}@example.test`,
      passwordHash: "not-a-real-password-hash",
      firstName: "Accounting",
      lastName: "Tester",
    },
  });
  const client = await prisma.client.create({
    data: { organizationId: organization.id, name: "Example Customer", reference: uid("client") },
  });
  return {
    organization,
    client,
    authUser: {
      id: user.id,
      organizationId: organization.id,
      email: user.email,
      roleId: role.id,
      isPlatformAdmin: false,
      permissions: [],
    } as never,
  };
};

if (enabled) before(cleanup);
if (enabled) after(async () => { await cleanup(); await prisma.$disconnect(); });

integrationTest("Accounting contract creates a catalogue item, project, and invoice with the returned tenant-owned item id", async () => {
  const tenantA = await fixture();
  const tenantB = await fixture();

  const item = await createCatalogueItem(tenantA.organization.id, {
    name: "Monthly bookkeeping",
    type: "SERVICE",
    unitPrice: "75000.00",
    unit: "Month",
    description: "Monthly bookkeeping and account reconciliation",
    vatApplicable: true,
  }, tenantA.authUser);
  assert.ok(item.id);
  assert.equal(item.organizationId, tenantA.organization.id);

  const catalogue = await listCatalogueItems(tenantA.organization.id, {
    type: "ALL", status: "ALL", page: 1, limit: 20, sortBy: "createdAt", sortOrder: "desc",
  });
  assert.ok(catalogue.items.some((entry) => entry.id === item.id));

  const project = await createAccountingProject(tenantA.organization.id, {
    name: "ERP implementation",
    clientId: tenantA.client.id,
    value: "2500000.00",
    startDate: new Date("2026-10-01T00:00:00.000Z"),
    endDate: new Date("2027-01-31T00:00:00.000Z"),
    status: "ACTIVE",
  }, tenantA.authUser);
  assert.equal(project.organizationId, tenantA.organization.id);

  const invoice = await createInvoice(tenantA.organization.id, {
    clientId: tenantA.client.id,
    projectId: project.id,
    dueDate: new Date("2027-02-28T00:00:00.000Z"),
    items: [{ catalogueItemId: item.id, quantity: "1" }],
  }, tenantA.authUser);
  const persisted = await prisma.invoice.findUniqueOrThrow({
    where: { id: invoice.id },
    include: { items: true },
  });
  assert.equal(persisted.items.length, 1);
  assert.equal(persisted.items[0].catalogueItemId, item.id);

  await assert.rejects(
    createInvoice(tenantB.organization.id, {
      clientId: tenantB.client.id,
      dueDate: new Date("2027-02-28T00:00:00.000Z"),
      items: [{ catalogueItemId: item.id, quantity: "1" }],
    }, tenantB.authUser),
    (error: any) => error?.statusCode === 404,
  );
  await assert.rejects(
    createAccountingProject(tenantA.organization.id, {
      name: "Cross-tenant project",
      clientId: tenantB.client.id,
      value: "1000.00",
      startDate: new Date("2026-10-01T00:00:00.000Z"),
    }, tenantA.authUser),
    (error: any) => error?.statusCode === 404,
  );
});
