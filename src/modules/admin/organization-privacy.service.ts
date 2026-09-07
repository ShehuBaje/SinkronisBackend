import archiver from "archiver";
import { PassThrough } from "node:stream";
import { Prisma } from "@prisma/client";
import { prisma } from "../../core/prisma";
import { createObjectKey, deleteObject, uploadObject } from "../../core/object-storage";
import { sendTransactionalNotificationEmail } from "../auth/auth.mailer";
import { createAuditLog } from "./admin.audit";

const EXPORT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const json = (value: unknown) => JSON.stringify(value, (_key, item) => {
  if (item instanceof Prisma.Decimal) return item.toString();
  if (typeof item === "bigint") return item.toString();
  return item;
}, 2);

export const buildZipArchive = async (files: Array<{ name: string; value: unknown }>) => {
  const output = new PassThrough();
  const chunks: Buffer[] = [];
  output.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
  const completed = new Promise<Buffer>((resolve, reject) => {
    output.on("end", () => resolve(Buffer.concat(chunks)));
    output.on("error", reject);
  });
  const archive = archiver("zip", { zlib: { level: 9 } });
  archive.on("error", (error) => output.destroy(error));
  archive.pipe(output);
  for (const file of files) archive.append(json(file.value), { name: file.name });
  await archive.finalize();
  return completed;
};

export const buildOrganizationExportArchive = async (organizationId: string) => {
  const [organization, users, employees, attendance, invoices, paymentRequests, payrollRuns, auditLogs] = await Promise.all([
    prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { id: true, name: true, slug: true, email: true, phone: true, address: true, country: true, currency: true, taxId: true, status: true, industry: true, cacNumber: true, registrationAddress: true, website: true, fiscalYearStart: true, companySize: true, createdAt: true, updatedAt: true, generalSettings: true, departments: true, branches: true } }),
    prisma.user.findMany({ where: { organizationId }, select: { id: true, email: true, firstName: true, lastName: true, isActive: true, employeeId: true, moduleAccess: true, lastLoginAt: true, createdAt: true, role: { select: { id: true, name: true } } } }),
    prisma.employee.findMany({ where: { organizationId }, select: { id: true, employeeNo: true, firstName: true, lastName: true, email: true, phone: true, jobTitle: true, hireDate: true, status: true, lifecycleStatus: true, employmentType: true, departmentId: true, teamId: true, createdAt: true, updatedAt: true } }),
    prisma.attendance.findMany({ where: { organizationId }, select: { id: true, employeeId: true, attendanceDate: true, clockInAt: true, clockOutAt: true, source: true, manualStatus: true, createdAt: true, updatedAt: true } }),
    prisma.invoice.findMany({ where: { organizationId }, include: { items: true } }),
    prisma.paymentRequest.findMany({ where: { organizationId } }),
    prisma.payrollRun.findMany({ where: { organizationId } }),
    prisma.auditLog.findMany({ where: { organizationId }, select: { id: true, actorUserId: true, action: true, resource: true, resourceId: true, summary: true, createdAt: true }, orderBy: { createdAt: "asc" } })
  ]);
  return buildZipArchive([
    { name: "organization.json", value: organization }, { name: "users.json", value: users },
    { name: "employees.json", value: employees }, { name: "attendance.json", value: attendance },
    { name: "invoices.json", value: invoices }, { name: "expenses-payment-requests.json", value: paymentRequests },
    { name: "payroll-runs.json", value: payrollRuns }, { name: "audit-log.json", value: auditLogs },
    { name: "manifest.json", value: { formatVersion: 1, organizationId, generatedAt: new Date().toISOString(), datasets: ["organization", "users", "employees", "attendance", "invoices", "expenses-payment-requests", "payroll-runs", "audit-log"] } }
  ]);
};

export const fulfillOrganizationDataExport = async (exportId: string, publicBaseUrl?: string) => {
  const claimed = await prisma.organizationDataExport.updateMany({ where: { id: exportId, status: "PENDING_PLATFORM_FULFILLMENT" }, data: { status: "PROCESSING", processingStartedAt: new Date(), errorMessage: null } });
  if (!claimed.count) return prisma.organizationDataExport.findUnique({ where: { id: exportId } });
  const record = await prisma.organizationDataExport.findUniqueOrThrow({ where: { id: exportId }, include: { organization: { select: { name: true } } } });
  let stored: Awaited<ReturnType<typeof uploadObject>> | null = null;
  try {
    const archive = await buildOrganizationExportArchive(record.organizationId);
    const fileName = `sinkronis-${record.organizationId}-${record.id}.zip`;
    stored = await uploadObject({ key: createObjectKey(`organization-exports/${record.organizationId}`, fileName), body: archive, contentType: "application/zip", publicBaseUrl });
    const completedAt = new Date(); const expiresAt = new Date(completedAt.getTime() + EXPORT_TTL_MS);
    const completed = await prisma.organizationDataExport.update({ where: { id: record.id }, data: { status: "COMPLETED", fileName, fileReference: stored.key, fileSize: stored.size, completedAt, deliveredAt: completedAt, expiresAt, failedAt: null, errorMessage: null } });
    await prisma.systemAlert.upsert({ where: { organizationId_key: { organizationId: record.organizationId, key: `DATA_EXPORT_READY_${record.id}` } }, create: { organizationId: record.organizationId, key: `DATA_EXPORT_READY_${record.id}`, title: "Organization data export ready", message: `Your requested organization data export is ready and expires on ${expiresAt.toISOString()}.`, severity: "INFO" }, update: { isActive: true, status: "OPEN", message: `Your requested organization data export is ready and expires on ${expiresAt.toISOString()}.` } });
    await sendTransactionalNotificationEmail({ to: record.deliveryEmail, recipientName: record.organization.name, subject: "Your organization data export is ready", message: `Your organization data export is ready. Sign in to Sinkronis to download it before ${expiresAt.toISOString()}.` });
    await createAuditLog({ organizationId: record.organizationId, actorUserId: record.requestedByUserId, action: "ORGANIZATION_DATA_EXPORT_COMPLETED", resource: "ORGANIZATION_DATA_EXPORT", resourceId: record.id, summary: "Generated and delivered organization data export", metadata: { fileSize: stored.size, expiresAt } });
    return completed;
  } catch (error) {
    if (stored) await deleteObject(stored.key).catch(() => undefined);
    await prisma.organizationDataExport.update({ where: { id: record.id }, data: { status: "FAILED", failedAt: new Date(), errorMessage: error instanceof Error ? error.message.slice(0, 2000) : "Export fulfillment failed" } });
    throw error;
  }
};

export const processPendingOrganizationExports = async (publicBaseUrl?: string) => {
  const pending = await prisma.organizationDataExport.findMany({ where: { status: "PENDING_PLATFORM_FULFILLMENT" }, orderBy: { requestedAt: "asc" }, take: 10, select: { id: true } });
  const results = [];
  for (const item of pending) { try { results.push({ id: item.id, status: (await fulfillOrganizationDataExport(item.id, publicBaseUrl))?.status ?? "SKIPPED" }); } catch { results.push({ id: item.id, status: "FAILED" }); } }
  return results;
};

export const expireOrganizationExports = async (now = new Date()) => {
  const rows = await prisma.organizationDataExport.findMany({ where: { status: "COMPLETED", expiresAt: { lte: now } }, select: { id: true, fileReference: true } });
  for (const row of rows) { await deleteObject(row.fileReference).catch(() => undefined); await prisma.organizationDataExport.update({ where: { id: row.id }, data: { status: "EXPIRED", fileReference: null } }); }
  return { expired: rows.length };
};
