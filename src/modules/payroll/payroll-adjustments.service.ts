import { Prisma } from "@prisma/client";
import { conflict, notFound } from "../../core/http-error";
import { prisma } from "../../core/prisma";
import type { AuthUser } from "../../types";
import { createAuditLog } from "../admin/admin.audit";

const utcStart = (value: string) => new Date(`${value}T00:00:00.000Z`);
const utcEnd = (value: string) => new Date(`${value}T23:59:59.999Z`);

const tenantPayee = async (organizationId: string, payeeId: string, client: Prisma.TransactionClient | typeof prisma = prisma) => {
  const payee = await client.payee.findFirst({ where: { id: payeeId, organizationId, deletedAt: null }, select: { id: true, type: true, employeeId: true } });
  if (!payee) throw notFound("Payee not found");
  return payee;
};

export const listPayrollPayeeGroups = (organizationId: string) => prisma.payrollPayeeGroup.findMany({ where: { organizationId, archivedAt: null }, orderBy: [{ active: "desc" }, { name: "asc" }] });

export const createPayrollPayeeGroup = (organizationId: string, input: any, user: AuthUser) => prisma.$transaction(async (tx) => {
  const row = await tx.payrollPayeeGroup.create({ data: { organizationId, name: input.name, description: input.description ?? null, displayColor: input.displayColor ?? null, createdById: user.id, updatedById: user.id } });
  await createAuditLog({ organizationId, actorUserId: user.id, action: "PAYROLL_PAYEE_GROUP_CREATED", resource: "PAYROLL_PAYEE_GROUP", resourceId: row.id, summary: "Created Payroll Payee group", metadata: { name: row.name } }, tx);
  return row;
});

export const updatePayrollPayeeGroup = (organizationId: string, groupId: string, input: any, user: AuthUser) => prisma.$transaction(async (tx) => {
  const row = await tx.payrollPayeeGroup.findFirst({ where: { id: groupId, organizationId, archivedAt: null } });
  if (!row) throw notFound("Payroll Payee group not found");
  const updated = await tx.payrollPayeeGroup.update({ where: { id: groupId }, data: { ...input, updatedById: user.id } });
  await createAuditLog({ organizationId, actorUserId: user.id, action: "PAYROLL_PAYEE_GROUP_UPDATED", resource: "PAYROLL_PAYEE_GROUP", resourceId: groupId, summary: "Updated Payroll Payee group", metadata: { changedFields: Object.keys(input) } }, tx);
  return updated;
});

export const assignPayrollPayeeGroup = (organizationId: string, payeeId: string, groupId: string | null, user: AuthUser) => prisma.$transaction(async (tx) => {
  await tenantPayee(organizationId, payeeId, tx);
  if (groupId && !await tx.payrollPayeeGroup.findFirst({ where: { id: groupId, organizationId, active: true, archivedAt: null }, select: { id: true } })) throw notFound("Active Payroll Payee group not found");
  const updated = await tx.payee.update({ where: { id: payeeId }, data: { payrollGroupId: groupId } });
  await createAuditLog({ organizationId, actorUserId: user.id, action: "PAYROLL_PAYEE_GROUP_ASSIGNED", resource: "PAYEE", resourceId: payeeId, summary: "Updated Payee group assignment", metadata: { groupId } }, tx);
  return { payeeId: updated.id, groupId: updated.payrollGroupId };
});

export const listPayrollBonuses = async (organizationId: string, payeeId: string) => {
  await tenantPayee(organizationId, payeeId);
  return prisma.payrollBonus.findMany({ where: { organizationId, payeeId, archivedAt: null }, orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }] });
};

export const createPayrollBonus = (organizationId: string, payeeId: string, input: any, user: AuthUser) => prisma.$transaction(async (tx) => {
  await tenantPayee(organizationId, payeeId, tx);
  const row = await tx.payrollBonus.create({ data: { organizationId, payeeId, amount: input.amount, frequency: input.frequency, justification: input.justification, effectiveFrom: utcStart(input.effectiveFrom), effectiveTo: input.effectiveTo ? utcEnd(input.effectiveTo) : null, createdById: user.id, updatedById: user.id } });
  await createAuditLog({ organizationId, actorUserId: user.id, action: "PAYROLL_BONUS_CREATED", resource: "PAYROLL_BONUS", resourceId: row.id, summary: "Created Payee bonus", metadata: { payeeId, frequency: row.frequency } }, tx);
  return row;
});

const mutableBonus = async (tx: Prisma.TransactionClient, organizationId: string, payeeId: string, bonusId: string) => {
  const row = await tx.payrollBonus.findFirst({ where: { id: bonusId, organizationId, payeeId, archivedAt: null }, include: { applications: { take: 1 } } });
  if (!row) throw notFound("Payroll bonus not found");
  if (row.applications.length) throw conflict("Frozen or applied bonus cannot be changed");
  return row;
};

export const updatePayrollBonus = (organizationId: string, payeeId: string, bonusId: string, input: any, user: AuthUser) => prisma.$transaction(async (tx) => {
  const current = await mutableBonus(tx, organizationId, payeeId, bonusId);
  const frequency = input.frequency ?? current.frequency;
  const effectiveFrom = input.effectiveFrom ? utcStart(input.effectiveFrom) : current.effectiveFrom;
  const effectiveTo = input.effectiveTo === null ? null : input.effectiveTo ? utcEnd(input.effectiveTo) : current.effectiveTo;
  if (frequency === "ONCE" && effectiveTo) throw conflict("ONCE bonus cannot have an end date");
  if (effectiveTo && effectiveTo < effectiveFrom) throw conflict("Bonus end date must not precede start date");
  const updated = await tx.payrollBonus.update({ where: { id: bonusId }, data: { ...input, effectiveFrom, effectiveTo, updatedById: user.id } });
  await createAuditLog({ organizationId, actorUserId: user.id, action: "PAYROLL_BONUS_UPDATED", resource: "PAYROLL_BONUS", resourceId: bonusId, summary: "Updated Payee bonus", metadata: { changedFields: Object.keys(input) } }, tx);
  return updated;
});

export const archivePayrollBonus = (organizationId: string, payeeId: string, bonusId: string, user: AuthUser) => prisma.$transaction(async (tx) => {
  await mutableBonus(tx, organizationId, payeeId, bonusId);
  const updated = await tx.payrollBonus.update({ where: { id: bonusId }, data: { active: false, archivedAt: new Date(), updatedById: user.id } });
  await createAuditLog({ organizationId, actorUserId: user.id, action: "PAYROLL_BONUS_ARCHIVED", resource: "PAYROLL_BONUS", resourceId: bonusId, summary: "Archived Payee bonus" }, tx);
  return updated;
});

export const listPayrollProrationOverrides = async (organizationId: string, payeeId: string) => {
  await tenantPayee(organizationId, payeeId);
  return prisma.payrollProrationOverride.findMany({ where: { organizationId, payeeId, archivedAt: null }, orderBy: { payFrom: "desc" } });
};

const assertNoOverrideOverlap = async (tx: Prisma.TransactionClient, organizationId: string, payeeId: string, from: Date, until: Date, excludeId?: string) => {
  if (await tx.payrollProrationOverride.count({ where: { organizationId, payeeId, active: true, archivedAt: null, ...(excludeId ? { id: { not: excludeId } } : {}), payFrom: { lte: until }, payUntil: { gte: from } } })) throw conflict("Proration override overlaps an existing active override");
};

export const createPayrollProrationOverride = (organizationId: string, payeeId: string, input: any, user: AuthUser) => prisma.$transaction(async (tx) => {
  const payee = await tenantPayee(organizationId, payeeId, tx);
  if (payee.type !== "PERMANENT" || !payee.employeeId) throw conflict("Proration overrides are supported only for linked Permanent Payees");
  const payFrom = utcStart(input.payFrom); const payUntil = utcEnd(input.payUntil);
  await assertNoOverrideOverlap(tx, organizationId, payeeId, payFrom, payUntil);
  const row = await tx.payrollProrationOverride.create({ data: { organizationId, payeeId, employeeId: payee.employeeId, payFrom, payUntil, basis: input.basis, justification: input.justification, createdById: user.id, updatedById: user.id } });
  await createAuditLog({ organizationId, actorUserId: user.id, action: "PAYROLL_PRORATION_OVERRIDE_CREATED", resource: "PAYROLL_PRORATION_OVERRIDE", resourceId: row.id, summary: "Created explicit payroll proration override", metadata: { payeeId, basis: row.basis } }, tx);
  return row;
});

const mutableOverride = async (tx: Prisma.TransactionClient, organizationId: string, payeeId: string, overrideId: string) => {
  const row = await tx.payrollProrationOverride.findFirst({ where: { id: overrideId, organizationId, payeeId, archivedAt: null } });
  if (!row) throw notFound("Payroll proration override not found");
  const frozen = await tx.payrollRunParticipant.count({ where: { organizationId, payeeId, frozenAt: { not: null }, calculationSnapshot: { path: "$.proration.overrideId", equals: overrideId } } });
  if (frozen) throw conflict("Proration override is already frozen into payroll history");
  return row;
};

export const updatePayrollProrationOverride = (organizationId: string, payeeId: string, overrideId: string, input: any, user: AuthUser) => prisma.$transaction(async (tx) => {
  const current = await mutableOverride(tx, organizationId, payeeId, overrideId);
  const payFrom = input.payFrom ? utcStart(input.payFrom) : current.payFrom; const payUntil = input.payUntil ? utcEnd(input.payUntil) : current.payUntil;
  if (payUntil < payFrom) throw conflict("Proration end date must not precede start date");
  await assertNoOverrideOverlap(tx, organizationId, payeeId, payFrom, payUntil, overrideId);
  const updated = await tx.payrollProrationOverride.update({ where: { id: overrideId }, data: { ...input, payFrom, payUntil, updatedById: user.id } });
  await createAuditLog({ organizationId, actorUserId: user.id, action: "PAYROLL_PRORATION_OVERRIDE_UPDATED", resource: "PAYROLL_PRORATION_OVERRIDE", resourceId: overrideId, summary: "Updated explicit payroll proration override", metadata: { changedFields: Object.keys(input) } }, tx);
  return updated;
});

export const archivePayrollProrationOverride = (organizationId: string, payeeId: string, overrideId: string, user: AuthUser) => prisma.$transaction(async (tx) => {
  await mutableOverride(tx, organizationId, payeeId, overrideId);
  const updated = await tx.payrollProrationOverride.update({ where: { id: overrideId }, data: { active: false, archivedAt: new Date(), updatedById: user.id } });
  await createAuditLog({ organizationId, actorUserId: user.id, action: "PAYROLL_PRORATION_OVERRIDE_ARCHIVED", resource: "PAYROLL_PRORATION_OVERRIDE", resourceId: overrideId, summary: "Archived explicit payroll proration override" }, tx);
  return updated;
});
