import { prisma } from "../../core/prisma";

export const recordTenantPageView = async (organizationId: string) => {
  const now = new Date(); const usageDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  await prisma.tenantUsageDaily.upsert({
    where: { organizationId_usageDate: { organizationId, usageDate } },
    create: { organizationId, usageDate, pageViews: 1, lastActivityAt: now },
    update: { pageViews: { increment: 1 }, lastActivityAt: now }
  });
  return { recorded: true, recordedAt: now };
};

export const snapshotTenantModuleUsage = async (now = new Date(), organizationId?: string) => {
  const snapshotDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const configurations = await prisma.systemConfig.findMany({ where: { ...(organizationId ? { organizationId } : {}), key: { in: ["billing.subscription", "module.hris.status", "module.payroll.status", "module.accounting.status"] }, organization: { status: "ACTIVE", users: { none: { isPlatformAdmin: true } }, deletionRequests: { none: { status: "PENDING_PLATFORM_APPROVAL" } } } }, select: { organizationId: true, key: true, value: true } });
  if (!configurations.length) return { snapshotDate, records: 0 };
  const subscriptionActive = new Map(configurations.filter((row) => row.key === "billing.subscription").map((row) => { const value = row.value && typeof row.value === "object" && !Array.isArray(row.value) ? row.value as Record<string, unknown> : {}; return [row.organizationId, String(value.status ?? "").toUpperCase() === "ACTIVE"]; }));
  const records = configurations.filter((row) => row.key.startsWith("module.")).map((row) => ({ organizationId: row.organizationId, moduleKey: row.key.split(".")[1], snapshotDate, enabled: subscriptionActive.get(row.organizationId) === true && typeof row.value === "string" && row.value.toUpperCase() === "ACTIVE" }));
  if (organizationId) {
    await prisma.$transaction(records.map((record) => prisma.tenantModuleDailySnapshot.upsert({ where: { organizationId_moduleKey_snapshotDate: { organizationId: record.organizationId, moduleKey: record.moduleKey, snapshotDate } }, create: record, update: { enabled: record.enabled } })));
    return { snapshotDate, records: records.length };
  }
  const result = await prisma.tenantModuleDailySnapshot.createMany({ data: records, skipDuplicates: true });
  return { snapshotDate, records: result.count };
};
