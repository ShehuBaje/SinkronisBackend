import { badRequest, notFound } from "../../core/http-error";
import { prisma } from "../../core/prisma";
import {
  appraisalCreateSchema,
  appraisalUpdateSchema,
  attendanceCreateSchema,
  attendanceUpdateSchema,
  conductCreateSchema,
  conductUpdateSchema,
  employeeCreateSchema,
  employeeUpdateSchema,
  leaveCreateSchema,
  leaveUpdateSchema
} from "./hris.validation";
import type { ClockInInput } from "./hris.interface";

export const clockIn = async (organizationId: string, input: ClockInInput) => {
  const open = await prisma.attendance.findFirst({
    where: { organizationId, employeeId: input.employeeId, clockOutAt: null }
  });

  if (open) throw badRequest("Employee already has an open attendance record");

  return prisma.attendance.create({
    data: {
      organizationId,
      employeeId: input.employeeId,
      clockInAt: new Date(),
      note: input.note
    }
  });
};

export const clockOut = async (organizationId: string, id: string) => {
  const existing = await prisma.attendance.findFirst({
    where: { id, organizationId }
  });

  if (!existing) throw notFound();
  if (existing.clockOutAt) throw badRequest("Attendance record is already closed");

  return prisma.attendance.update({
    where: { id },
    data: { clockOutAt: new Date() }
  });
};

export const employeesCrudOptions = {
  model: "employee" as const,
  createSchema: employeeCreateSchema,
  updateSchema: employeeUpdateSchema,
  permission: "hris:employees:view" as const,
  searchableFields: ["firstName", "lastName", "email", "employeeNo"],
  include: { department: true, team: true }
};

export const attendanceCrudOptions = {
  model: "attendance" as const,
  createSchema: attendanceCreateSchema,
  updateSchema: attendanceUpdateSchema,
  permission: "hris:attendance:view" as const,
  include: { employee: true }
};

export const leaveCrudOptions = {
  model: "leaveRequest" as const,
  createSchema: leaveCreateSchema,
  updateSchema: leaveUpdateSchema,
  permission: "hris:leave:view" as const,
  include: { employee: true }
};

export const appraisalsCrudOptions = {
  model: "appraisalCycle" as const,
  createSchema: appraisalCreateSchema,
  updateSchema: appraisalUpdateSchema,
  permission: "hris:appraisals:view" as const,
  searchableFields: ["title"]
};

export const conductCrudOptions = {
  model: "conductLog" as const,
  createSchema: conductCreateSchema,
  updateSchema: conductUpdateSchema,
  permission: "hris:conduct:view" as const,
  searchableFields: ["summary", "category"],
  include: { employee: true }
};
