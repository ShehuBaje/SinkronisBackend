import path from "node:path";
import { prisma } from "./prisma";
import { assertLegacyMigrationCapabilities, deleteMigrationDestination, deleteMigrationSource, deleteObject, readMigrationSource, validateMigrationDestination, validateMigrationSource, writeMigrationDestination } from "./object-storage";

type Candidate = { organizationId: string; resourceType: string; resourceId: string; sourceReference: string };
type MigrationOptions = { dryRun?: boolean; batchSize?: number; organizationId?: string };

export const isLegacyPublicBlobReference = (reference: string) => {
  try {
    return new URL(reference).hostname.endsWith(".public.blob.vercel-storage.com");
  } catch {
    return false;
  }
};

const privateReferences = [
  { resourceType: "EMPLOYEE_DOCUMENT", load: (take: number, organizationId?: string) => prisma.employeeDocument.findMany({ where: { ...(organizationId ? { organizationId } : {}), fileReference: { startsWith: "http" } }, orderBy: { id: "asc" }, take, select: { id: true, organizationId: true, fileReference: true } }) },
  { resourceType: "PAYEE_DOCUMENT", load: (take: number, organizationId?: string) => prisma.payeeDocument.findMany({ where: { ...(organizationId ? { organizationId } : {}), fileReference: { startsWith: "http" } }, orderBy: { id: "asc" }, take, select: { id: true, organizationId: true, fileReference: true } }) },
  { resourceType: "PAYSLIP", load: (take: number, organizationId?: string) => prisma.payslip.findMany({ where: { ...(organizationId ? { organizationId } : {}), pdfFileReference: { startsWith: "http" } }, orderBy: { id: "asc" }, take, select: { id: true, organizationId: true, pdfFileReference: true } }) },
  { resourceType: "ORGANIZATION_EXPORT", load: (take: number, organizationId?: string) => prisma.organizationDataExport.findMany({ where: { ...(organizationId ? { organizationId } : {}), fileReference: { startsWith: "http" } }, orderBy: { id: "asc" }, take, select: { id: true, organizationId: true, fileReference: true } }) },
  { resourceType: "ACCOUNTING_EXPORT", load: (take: number, organizationId?: string) => prisma.accountingExportJob.findMany({ where: { ...(organizationId ? { organizationId } : {}), fileReference: { startsWith: "http" } }, orderBy: { id: "asc" }, take, select: { id: true, organizationId: true, fileReference: true } }) }
] as const;

const candidates = async (take: number, organizationId?: string): Promise<Candidate[]> => {
  const rows: Candidate[] = [];
  for (const source of privateReferences) {
    const loaded = await source.load(take, organizationId) as Array<{ id: string; organizationId: string; fileReference?: string | null; pdfFileReference?: string | null }>;
    for (const row of loaded) {
      const reference = row.fileReference ?? row.pdfFileReference;
      if (reference && isLegacyPublicBlobReference(reference)) rows.push({ organizationId: row.organizationId, resourceType: source.resourceType, resourceId: row.id, sourceReference: reference });
    }
  }
  return rows.slice(0, take);
};

const extensionFor = (reference: string) => { try { return path.extname(new URL(reference).pathname).slice(0, 20); } catch { return path.extname(reference).slice(0, 20); } };
const destinationFor = (row: Candidate) => `private-migrated/${row.organizationId}/${row.resourceType.toLowerCase()}/${row.resourceId}${extensionFor(row.sourceReference)}`;

const updateReference = async (row: Candidate, destinationReference: string) => {
  const ownership = { id: row.resourceId, organizationId: row.organizationId };
  switch (row.resourceType) {
    case "EMPLOYEE_DOCUMENT": return prisma.employeeDocument.updateMany({ where: { ...ownership, fileReference: { in: [row.sourceReference, destinationReference] } }, data: { fileReference: destinationReference } });
    case "PAYEE_DOCUMENT": return prisma.payeeDocument.updateMany({ where: { ...ownership, fileReference: { in: [row.sourceReference, destinationReference] } }, data: { fileReference: destinationReference } });
    case "PAYSLIP": return prisma.payslip.updateMany({ where: { ...ownership, pdfFileReference: { in: [row.sourceReference, destinationReference] } }, data: { pdfFileReference: destinationReference } });
    case "ORGANIZATION_EXPORT": return prisma.organizationDataExport.updateMany({ where: { ...ownership, fileReference: { in: [row.sourceReference, destinationReference] } }, data: { fileReference: destinationReference } });
    case "ACCOUNTING_EXPORT": return prisma.accountingExportJob.updateMany({ where: { ...ownership, fileReference: { in: [row.sourceReference, destinationReference] } }, data: { fileReference: destinationReference } });
    default: throw new Error(`Unsupported private-file resource ${row.resourceType}`);
  }
};

export const migratePrivateFiles = async ({ dryRun = false, batchSize = 25, organizationId }: MigrationOptions = {}) => {
  const safeBatchSize = Math.max(1, Math.min(batchSize, 100));
  const staleBefore = new Date(Date.now() - 15 * 60_000);
  if (!dryRun) await prisma.privateFileMigration.updateMany({
    where: { ...(organizationId ? { organizationId } : {}), status: "PROCESSING", startedAt: { lt: staleBefore } },
    data: { status: "PENDING", errorMessage: "Recovered after an interrupted migration attempt" },
  });
  const discovered = await candidates(safeBatchSize, organizationId);
  assertLegacyMigrationCapabilities(discovered.map(row => row.sourceReference));
  await validateMigrationDestination();
  for (const row of discovered) await validateMigrationSource(row.sourceReference);
  if (dryRun) return { dryRun: true, sourceConfigurationValid: true, destinationConfigurationValid: true, sourceStoreAccessValid: true, destinationPrivateCapabilityValid: true, discovered: discovered.length, processed: 0, completed: 0, failed: 0, candidates: discovered };

  for (const row of discovered) await prisma.privateFileMigration.upsert({ where: { resourceType_resourceId: { resourceType: row.resourceType, resourceId: row.resourceId } }, create: row, update: {} });
  const pending = await prisma.privateFileMigration.findMany({ where: { ...(organizationId ? { organizationId } : {}), status: { in: ["PENDING", "FAILED"] } }, orderBy: { updatedAt: "asc" }, take: safeBatchSize });
  let completed = 0; let failed = 0;
  for (const migration of pending) {
    const claimed = await prisma.privateFileMigration.updateMany({ where: { id: migration.id, status: { in: ["PENDING", "FAILED"] } }, data: { status: "PROCESSING", attempts: { increment: 1 }, startedAt: new Date(), errorMessage: null } });
    if (!claimed.count) continue;
    const row: Candidate = { organizationId: migration.organizationId, resourceType: migration.resourceType, resourceId: migration.resourceId, sourceReference: migration.sourceReference };
    const destination = migration.destinationReference ?? destinationFor(row);
    try {
      if (!migration.destinationReference) {
        const stored = await writeMigrationDestination(destination, await readMigrationSource(row.sourceReference));
        await prisma.privateFileMigration.update({ where: { id: migration.id }, data: { destinationReference: stored.key } });
      }
      const actualDestination = (await prisma.privateFileMigration.findUniqueOrThrow({ where: { id: migration.id } })).destinationReference!;
      const updated = await updateReference(row, actualDestination);
      if (!updated.count) throw new Error("Owning record was not found in its tenant or its reference changed concurrently");
      try { await deleteMigrationSource(row.sourceReference); } catch (error) { await prisma.privateFileMigration.update({ where: { id: migration.id }, data: { status: "CLEANUP_REQUIRED", errorMessage: error instanceof Error ? error.message.slice(0, 2000) : "Source cleanup required" } }); failed += 1; continue; }
      await prisma.privateFileMigration.update({ where: { id: migration.id }, data: { status: "COMPLETED", completedAt: new Date(), errorMessage: null } });
      completed += 1;
    } catch (error) {
      const created = await prisma.privateFileMigration.findUnique({ where: { id: migration.id }, select: { destinationReference: true } });
      if (created?.destinationReference) { await deleteMigrationDestination(created.destinationReference).catch(() => undefined); await prisma.privateFileMigration.update({ where: { id: migration.id }, data: { destinationReference: null } }); }
      await prisma.privateFileMigration.update({ where: { id: migration.id }, data: { status: "FAILED", errorMessage: error instanceof Error ? error.message.slice(0, 2000) : "Private-file migration failed" } });
      failed += 1;
    }
  }
  const cleanup = await prisma.privateFileMigration.findMany({ where: { ...(organizationId ? { organizationId } : {}), status: "CLEANUP_REQUIRED" }, take: safeBatchSize });
  for (const migration of cleanup) { try { await deleteMigrationSource(migration.sourceReference); await prisma.privateFileMigration.update({ where: { id: migration.id }, data: { status: "COMPLETED", completedAt: new Date(), errorMessage: null } }); completed += 1; failed = Math.max(0, failed - 1); } catch { /* remains retryable without re-upload */ } }
  return { dryRun: false, discovered: discovered.length, processed: pending.length, completed, failed };
};

export const rollbackUnsafeLocalPrivateFileMigrations = async () => {
  const rows = await prisma.privateFileMigration.findMany({ where: { status: "COMPLETED", destinationReference: { not: null } }, take: 100 });
  let restored = 0;
  for (const migration of rows) {
    if (!migration.destinationReference || migration.destinationReference.startsWith("http")) continue;
    const row: Candidate = { organizationId: migration.organizationId, resourceType: migration.resourceType, resourceId: migration.resourceId, sourceReference: migration.destinationReference };
    const updated = await updateReference(row, migration.sourceReference);
    if (!updated.count) continue;
    await deleteObject(migration.destinationReference).catch(() => undefined);
    await prisma.privateFileMigration.update({ where: { id: migration.id }, data: { status: "FAILED", destinationReference: null, completedAt: null, errorMessage: "Rolled back: private destination was local to a non-production host" } });
    restored += 1;
  }
  return { restored };
};
