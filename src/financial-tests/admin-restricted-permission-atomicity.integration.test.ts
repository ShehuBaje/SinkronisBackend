import "dotenv/config";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { Prisma, PrismaClient } from "@prisma/client";
import { cloneRole, createRole, deleteRole, updateRole } from "../modules/admin/admin.service.js";
import { replayAuditHash } from "../modules/admin/admin.audit.js";
import { assertSafeTestDatabase } from "../test-infrastructure/test-database.js";

const enabled = Boolean(process.env.TEST_DATABASE_GUARD);
if (enabled) assertSafeTestDatabase({ databaseUrl: process.env.DATABASE_URL_ORIGINAL, testDatabaseUrl: process.env.DATABASE_URL, nodeEnv: process.env.NODE_ENV, destructive: true });
const it = enabled ? test : test.skip;
const prisma = new PrismaClient();
const restricted = "payroll:loans:confirm-legacy";
const uid = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;

const fixture = async () => {
  const organization = await prisma.organization.create({ data: { name: uid("role-audit"), slug: uid("role-audit"), currency: "NGN" } });
  const operatorRole = await prisma.role.create({ data: { organizationId: organization.id, name: uid("operator") } });
  const operator = await prisma.user.create({ data: { organizationId: organization.id, roleId: operatorRole.id, email: `${uid("operator")}@example.test`, passwordHash: "test", firstName: "Role", lastName: "Manager" } });
  const request = (body: unknown, params: Record<string, string> = {}, actorId = operator.id) => ({ organizationId: organization.id, body, params, user: { id: actorId, organizationId: organization.id, roleId: operatorRole.id, email: operator.email, permissions: ["admin:roles:create", "admin:roles:update"], isPlatformAdmin: false } }) as any;
  return { organization, operatorRole, operator, request };
};

const cleanup = async (organizationId: string) => {
  await prisma.auditLog.deleteMany({ where: { organizationId } });
  await prisma.auditLogChain.deleteMany({ where: { organizationId } });
  await prisma.user.deleteMany({ where: { organizationId } });
  await prisma.rolePermission.deleteMany({ where: { role: { organizationId } } });
  await prisma.role.deleteMany({ where: { organizationId } });
  await prisma.organization.delete({ where: { id: organizationId } });
};

it("creates, assigns, and removes the restricted permission with replayable V2 audit evidence", async () => {
  const fx = await fixture();
  try {
    const created: any = await createRole(fx.request({ name: uid("legacy-checker"), permissionKeys: [] }));
    await updateRole(fx.request({ permissionKeys: [restricted] }, { id: created.id }));
    assert.equal(await prisma.rolePermission.count({ where: { roleId: created.id, permission: { key: restricted } } }), 1);
    await updateRole(fx.request({ permissionKeys: [] }, { id: created.id }));
    assert.equal(await prisma.rolePermission.count({ where: { roleId: created.id, permission: { key: restricted } } }), 0);
    const audits = await prisma.auditLog.findMany({ where: { organizationId: fx.organization.id, resourceId: created.id }, orderBy: { sequence: "asc" } });
    assert.deepEqual(audits.map((row) => row.action), ["ROLE_CREATED", "ROLE_UPDATED", "ROLE_UPDATED"]);
    for (const row of audits) {
      assert.equal(row.hashVersion, "V2");
      assert.equal(replayAuditHash({ organizationId: row.organizationId, actorUserId: row.actorUserId ?? undefined, action: row.action, resource: row.resource, resourceId: row.resourceId ?? undefined, summary: row.summary, metadata: row.metadata as Prisma.InputJsonValue, sequence: row.sequence!, previousHash: row.previousHash, createdAt: row.createdAt, hashVersion: row.hashVersion }), row.hash);
    }
  } finally { await cleanup(fx.organization.id); }
});

it("audit persistence failure rolls back role creation, assignment, and removal", async () => {
  const fx = await fixture();
  try {
    const invalidActorId = `missing-${crypto.randomUUID()}`;
    const failedName = uid("must-rollback");
    await assert.rejects(() => createRole(fx.request({ name: failedName, permissionKeys: [restricted] }, {}, invalidActorId)));
    assert.equal(await prisma.role.count({ where: { organizationId: fx.organization.id, name: failedName } }), 0);

    const created: any = await createRole(fx.request({ name: uid("atomic-checker"), permissionKeys: [] }));
    await assert.rejects(() => updateRole(fx.request({ permissionKeys: [restricted] }, { id: created.id }, invalidActorId)));
    assert.equal(await prisma.rolePermission.count({ where: { roleId: created.id, permission: { key: restricted } } }), 0);

    await updateRole(fx.request({ permissionKeys: [restricted] }, { id: created.id }));
    await assert.rejects(() => updateRole(fx.request({ permissionKeys: [] }, { id: created.id }, invalidActorId)));
    assert.equal(await prisma.rolePermission.count({ where: { roleId: created.id, permission: { key: restricted } } }), 1);
    await assert.rejects(() => deleteRole(fx.request({}, { id: created.id }, invalidActorId)));
    assert.equal(await prisma.role.count({ where: { id: created.id, organizationId: fx.organization.id } }), 1);
    assert.equal(await prisma.rolePermission.count({ where: { roleId: created.id, permission: { key: restricted } } }), 1);
  } finally { await cleanup(fx.organization.id); }
});

it("serializes concurrent permission replacements and audits every committed state", async () => {
  const fx = await fixture();
  try {
    const created: any = await createRole(fx.request({ name: uid("concurrent-checker"), permissionKeys: [] }));
    const outcomes = await Promise.allSettled([
      updateRole(fx.request({ permissionKeys: [restricted] }, { id: created.id })),
      updateRole(fx.request({ permissionKeys: ["payroll:loans:view"] }, { id: created.id }))
    ]);
    const committed = outcomes.filter((result) => result.status === "fulfilled").length;
    assert.ok(committed >= 1);
    const permissionKeys = (await prisma.rolePermission.findMany({ where: { roleId: created.id }, include: { permission: true } })).map((row) => row.permission.key);
    assert.ok(permissionKeys.length === 1 && [restricted, "payroll:loans:view"].includes(permissionKeys[0]));
    assert.equal(await prisma.auditLog.count({ where: { organizationId: fx.organization.id, resourceId: created.id, action: "ROLE_UPDATED" } }), committed);
  } finally { await cleanup(fx.organization.id); }
});

it("clones permission links and V2 audit evidence atomically", async () => {
  const fx = await fixture();
  try {
    const source: any = await createRole(fx.request({ name: uid("clone-source"), permissionKeys: [restricted] }));
    const cloneName = uid("clone-target");
    const cloned: any = await cloneRole(fx.request({ name: cloneName }, { id: source.id }));
    assert.equal(await prisma.rolePermission.count({ where: { roleId: cloned.id, permission: { key: restricted } } }), 1);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { organizationId: fx.organization.id, resourceId: cloned.id, action: "ROLE_CLONED" } });
    assert.equal(audit.hashVersion, "V2");
    assert.equal(replayAuditHash({ organizationId: audit.organizationId, actorUserId: audit.actorUserId ?? undefined, action: audit.action, resource: audit.resource, resourceId: audit.resourceId ?? undefined, summary: audit.summary, metadata: audit.metadata as Prisma.InputJsonValue, sequence: audit.sequence!, previousHash: audit.previousHash, createdAt: audit.createdAt, hashVersion: audit.hashVersion }), audit.hash);
  } finally { await cleanup(fx.organization.id); }
});

it("rolls back cloned role and permissions when audit persistence fails", async () => {
  const fx = await fixture();
  try {
    const source: any = await createRole(fx.request({ name: uid("rollback-source"), permissionKeys: [restricted] }));
    const cloneName = uid("must-not-survive");
    await assert.rejects(() => cloneRole(fx.request({ name: cloneName }, { id: source.id }, `missing-${crypto.randomUUID()}`)));
    assert.equal(await prisma.role.count({ where: { organizationId: fx.organization.id, name: cloneName } }), 0);
    assert.equal(await prisma.rolePermission.count({ where: { role: { organizationId: fx.organization.id, name: cloneName } } }), 0);
  } finally { await cleanup(fx.organization.id); }
});

it("rejects cross-tenant cloning and never commits an unaudited concurrent clone", async () => {
  const fx = await fixture();
  const other = await fixture();
  try {
    const source: any = await createRole(fx.request({ name: uid("concurrent-source"), permissionKeys: [restricted] }));
    await assert.rejects(() => cloneRole(other.request({}, { id: source.id })));
    const outcomes = await Promise.allSettled([
      cloneRole(fx.request({}, { id: source.id })),
      cloneRole(fx.request({}, { id: source.id }))
    ]);
    const committed = outcomes.filter((result) => result.status === "fulfilled").length;
    assert.ok(committed >= 1);
    const clones = await prisma.role.findMany({ where: { organizationId: fx.organization.id, name: { startsWith: `${source.name} Copy` } } });
    assert.equal(clones.length, committed);
    assert.equal(await prisma.auditLog.count({ where: { organizationId: fx.organization.id, action: "ROLE_CLONED", resourceId: { in: clones.map((role) => role.id) } } }), committed);
  } finally { await cleanup(fx.organization.id); await cleanup(other.organization.id); }
});

test.after(async () => prisma.$disconnect());
