import type { AuthUser } from "../../types";
import { prisma } from "../../core/prisma";
import { conflict, notFound } from "../../core/http-error";
import { createAuditLog } from "../admin/admin.audit";
import { sendTransactionalNotificationEmail } from "../auth/auth.mailer";

const terminal = ["REJECTED", "CANCELLED", "COMPLETED"];

export const listOrganizationDeletionRequests = async (query: { status?: string; page: number; limit: number }) => {
  const where = query.status ? { status: query.status } : {};
  const [rows, total] = await Promise.all([
    prisma.organizationDeletionRequest.findMany({ where, include: { organization: { select: { id: true, name: true, email: true, status: true } } }, orderBy: { requestedAt: "desc" }, skip: (query.page - 1) * query.limit, take: query.limit }),
    prisma.organizationDeletionRequest.count({ where })
  ]);
  return { data: rows, pagination: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) } };
};

export const getOrganizationDeletionRequest = async (id: string) => {
  const row = await prisma.organizationDeletionRequest.findUnique({ where: { id }, include: { organization: { select: { id: true, name: true, email: true, status: true, createdAt: true } } } });
  if (!row) throw notFound("Organization deletion request not found");
  return row;
};

export const decideOrganizationDeletionRequest = async (id: string, input: { decision: "APPROVE" | "REJECT"; notes: string; scheduledFor?: Date }, actor: AuthUser) => {
  const current = await getOrganizationDeletionRequest(id);
  if (current.status !== "PENDING_PLATFORM_APPROVAL") throw conflict("Deletion request has already been reviewed", { status: current.status });
  const now = new Date();
  const status = input.decision === "APPROVE" ? "APPROVED" : "REJECTED";
  const scheduledFor = status === "APPROVED" ? (input.scheduledFor ?? now) : null;
  const changed = await prisma.organizationDeletionRequest.updateMany({ where: { id, status: "PENDING_PLATFORM_APPROVAL" }, data: { status, reviewedAt: now, reviewedByUserId: actor.id, reviewNotes: input.notes, scheduledFor } });
  if (!changed.count) throw conflict("Deletion request was reviewed concurrently");
  await createAuditLog({ organizationId: current.organizationId, actorUserId: actor.id, action: `ORGANIZATION_DELETION_${status}`, resource: "ORGANIZATION_DELETION_REQUEST", resourceId: id, summary: `${status === "APPROVED" ? "Approved" : "Rejected"} organization deletion request`, metadata: { notes: input.notes, scheduledFor } });
  if (current.organization.email) await sendTransactionalNotificationEmail({ to: current.organization.email, recipientName: current.organization.name, subject: `Organization deletion request ${status.toLowerCase()}`, message: status === "APPROVED" ? `Your deletion request was approved and is scheduled for ${scheduledFor!.toISOString()}. Access will be revoked when processing completes.` : `Your deletion request was rejected. Review notes: ${input.notes}` });
  return getOrganizationDeletionRequest(id);
};

export const completeOrganizationDeletionRequest = async (id: string, input: { notes: string }, actor: AuthUser) => {
  const current = await getOrganizationDeletionRequest(id);
  if (terminal.includes(current.status)) throw conflict("Deletion request is already terminal", { status: current.status });
  if (current.status !== "APPROVED" && current.status !== "PROCESSING") throw conflict("Deletion request must be approved before processing", { status: current.status });
  if (current.scheduledFor && current.scheduledFor > new Date()) throw conflict("Deletion request is not scheduled for processing yet", { scheduledFor: current.scheduledFor });
  await prisma.organizationDeletionRequest.updateMany({ where: { id, status: "APPROVED" }, data: { status: "PROCESSING", processingStartedAt: new Date() } });
  const completedAt = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.userSession.deleteMany({ where: { organizationId: current.organizationId } });
    await tx.user.updateMany({ where: { organizationId: current.organizationId }, data: { isActive: false } });
    await tx.organization.update({ where: { id: current.organizationId }, data: { status: "ARCHIVED" } });
    await tx.organizationDeletionRequest.update({ where: { id }, data: { status: "COMPLETED", completedAt, reviewNotes: `${current.reviewNotes ?? ""}\nCompletion: ${input.notes}`.trim(), failureReason: null } });
  });
  await createAuditLog({ organizationId: current.organizationId, actorUserId: actor.id, action: "ORGANIZATION_DELETION_COMPLETED", resource: "ORGANIZATION_DELETION_REQUEST", resourceId: id, summary: "Completed organization deletion workflow and revoked workspace access", metadata: { completedAt, dataDisposition: "ARCHIVED_PENDING_CONTROLLED_PURGE" } });
  if (current.organization.email) await sendTransactionalNotificationEmail({ to: current.organization.email, recipientName: current.organization.name, subject: "Organization account deletion completed", message: "Your organization workspace has been archived and all user sessions and access have been revoked. Data is now pending controlled purge under the platform retention policy." });
  return getOrganizationDeletionRequest(id);
};
