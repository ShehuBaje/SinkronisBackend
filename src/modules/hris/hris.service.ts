import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { badRequest, conflict, forbidden, notFound } from "../../core/http-error";
import { prisma } from "../../core/prisma";
import { createAuditLog } from "../admin/admin.audit";
import { createObjectKey, deleteObject, uploadObject } from "../../core/object-storage";
import { deliverUserNotification } from "../../core/notifications";
import {
  appraisalCreateSchema,
  appraisalUpdateSchema,
  attendanceCreateSchema,
  attendanceUpdateSchema,
  conductCreateSchema,
  conductUpdateSchema,
  employeeCreateSchema,
  employeeUpdateSchema,
  tenantLeaveCreateSchema,
  tenantLeaveUpdateSchema
} from "./hris.validation";
import type { AuthUser } from "../../types";
import type { ClockInInput, HRISAttendanceMetric, HRISDashboardAttendanceCounts, HRISTrend, LeaveDecisionInput } from "./hris.interface";

const DAY_MS = 86_400_000;
const dashboardEmployeeStatuses = ["ACTIVE", "ON_LEAVE", "SUSPENDED"] as const;
const hrisAuditResources = ["EMPLOYEE", "ATTENDANCE", "LEAVE_REQUEST", "DEPARTMENT", "APPRAISAL", "CONDUCT"];

const tenantEmployeeExists = async (organizationId: string, employeeId: string) => {
  const employee = await prisma.employee.findFirst({ where: { id: employeeId, organizationId }, select: { id: true } });
  if (!employee) throw notFound("Employee not found");
};

const validateEmployeeOrganizationRelations = async (organizationId: string, data: Record<string, unknown>) => {
  const departmentId = typeof data.departmentId === "string" ? data.departmentId : undefined;
  const teamId = typeof data.teamId === "string" ? data.teamId : undefined;
  const managerId = typeof data.managerId === "string" ? data.managerId : undefined;
  const [department, team, manager] = await Promise.all([
    departmentId
      ? prisma.department.findFirst({ where: { id: departmentId, organizationId }, select: { id: true } })
      : Promise.resolve(undefined),
    teamId
      ? prisma.team.findFirst({ where: { id: teamId, organizationId }, select: { id: true, departmentId: true } })
      : Promise.resolve(undefined),
    managerId
      ? prisma.employee.findFirst({ where: { id: managerId, organizationId, status: { not: "TERMINATED" } }, select: { id: true } })
      : Promise.resolve(undefined)
  ]);
  if (departmentId && !department) throw notFound("Department not found");
  if (teamId && !team) throw notFound("Team not found");
  if (managerId && !manager) throw notFound("Manager not found");
  if (departmentId && team?.departmentId && team.departmentId !== departmentId) {
    throw badRequest("Team does not belong to the selected department");
  }
  return data;
};

export const trendForDifference = (difference: number): HRISTrend =>
  difference > 0 ? "UP" : difference < 0 ? "DOWN" : "UNCHANGED";

export const attendanceMetric = (count: number, previousDayCount: number): HRISAttendanceMetric => {
  const difference = count - previousDayCount;
  return { count, previousDayCount, difference, trend: trendForDifference(difference) };
};

export const tenantDateKey = (date: Date, timeZone: string) => {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(date)
    .reduce<Record<string, string>>((result, part) => {
      if (part.type !== "literal") result[part.type] = part.value;
      return result;
    }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
};

const parseDateKey = (key: string) => {
  const [year, month, day] = key.split("-").map(Number);
  return { year, month, day };
};

export const shiftDateKey = (key: string, days: number) => {
  const { year, month, day } = parseDateKey(key);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
};

export const zonedDateTimeToUtc = (dateKey: string, time: string, timeZone: string) => {
  const { year, month, day } = parseDateKey(dateKey);
  const [hour, minute] = time.split(":").map(Number);
  const desired = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  let candidate = desired;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone, hour12: false, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit"
  });
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const parts = formatter.formatToParts(new Date(candidate)).reduce<Record<string, number>>((result, part) => {
      if (part.type !== "literal") result[part.type] = Number(part.value);
      return result;
    }, {});
    const represented = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour === 24 ? 0 : parts.hour, parts.minute, parts.second);
    candidate += desired - represented;
  }
  return new Date(candidate);
};

const safeTimeZone = (value: string | null | undefined) => {
  const timeZone = value || "Africa/Lagos";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format();
    return timeZone;
  } catch {
    return "Africa/Lagos";
  }
};

const isScheduledWorkDay = (dateKey: string, schedule: {
  monday: boolean; tuesday: boolean; wednesday: boolean; thursday: boolean;
  friday: boolean; saturday: boolean; sunday: boolean;
}) => {
  const { year, month, day } = parseDateKey(dateKey);
  const key = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"][new Date(Date.UTC(year, month - 1, day)).getUTCDay()] as keyof typeof schedule;
  return schedule[key];
};

type AttendanceAggregateRow = {
  attended: bigint;
  onTime: Prisma.Decimal | bigint | null;
  lateClockIn: Prisma.Decimal | bigint | null;
  earlyClockIn: Prisma.Decimal | bigint | null;
  noClockOut: Prisma.Decimal | bigint | null;
};

const attendanceCountsForDate = async (
  organizationId: string,
  dateKey: string,
  timeZone: string,
  schedule: { workStartTime: string; workEndTime: string; gracePeriodMinutes: number; monday: boolean; tuesday: boolean; wednesday: boolean; thursday: boolean; friday: boolean; saturday: boolean; sunday: boolean },
  asOf: Date
): Promise<HRISDashboardAttendanceCounts> => {
  const start = zonedDateTimeToUtc(dateKey, "00:00", timeZone);
  const end = zonedDateTimeToUtc(shiftDateKey(dateKey, 1), "00:00", timeZone);
  const officialStart = zonedDateTimeToUtc(dateKey, schedule.workStartTime, timeZone);
  const lateAfter = new Date(officialStart.getTime() + schedule.gracePeriodMinutes * 60_000);
  const officialEnd = zonedDateTimeToUtc(dateKey, schedule.workEndTime, timeZone);
  const rowsPromise = prisma.$queryRawUnsafe<AttendanceAggregateRow[]>(
    "SELECT COUNT(*) AS attended, COALESCE(SUM(firstClockIn <= ?), 0) AS onTime, COALESCE(SUM(firstClockIn > ?), 0) AS lateClockIn, COALESCE(SUM(firstClockIn < ?), 0) AS earlyClockIn, COALESCE(SUM(hasOpen = 1 AND ? >= ?), 0) AS noClockOut FROM (SELECT employeeId, MIN(clockInAt) AS firstClockIn, MAX(CASE WHEN clockOutAt IS NULL THEN 1 ELSE 0 END) AS hasOpen FROM Attendance WHERE organizationId = ? AND clockInAt >= ? AND clockInAt < ? GROUP BY employeeId) dailyAttendance",
    lateAfter, lateAfter, officialStart, asOf, officialEnd, organizationId, start, end
  );
  const absentPromise = isScheduledWorkDay(dateKey, schedule)
    ? prisma.employee.count({
        where: {
          organizationId, status: "ACTIVE",
          OR: [{ hireDate: null }, { hireDate: { lt: end } }],
          attendance: { none: { organizationId, clockInAt: { gte: start, lt: end } } },
          leaverequest: { none: { organizationId, status: "APPROVED", startDate: { lt: end }, endDate: { gte: start } } }
        }
      })
    : Promise.resolve(0);
  const [rows, absent] = await Promise.all([rowsPromise, absentPromise]);
  const row = rows[0];
  return {
    onTime: Number(row?.onTime ?? 0),
    lateClockIn: Number(row?.lateClockIn ?? 0),
    earlyClockIn: Number(row?.earlyClockIn ?? 0),
    absent,
    noClockIn: 0,
    noClockOut: Number(row?.noClockOut ?? 0)
  };
};

export const clockIn = async (organizationId: string, input: ClockInInput) => {
  await tenantEmployeeExists(organizationId, input.employeeId);
  const settings = await prisma.organizationGeneralSettings.findUnique({ where: { organizationId }, select: { timeZone: true } });
  const attendanceDate = tenantDateKey(new Date(), safeTimeZone(settings?.timeZone));
  const open = await prisma.attendance.findFirst({
    where: { organizationId, employeeId: input.employeeId, clockOutAt: null }
  });

  if (open) throw badRequest("Employee already has an open attendance record");

  try {
    return await prisma.attendance.create({ data: { organizationId, employeeId: input.employeeId, attendanceDate, clockInAt: new Date(), note: input.note } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw conflict("Employee has already clocked in today");
    throw error;
  }
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
  include: { department: true, team: true },
  beforeCreate: async (data: Record<string, unknown>, req: any) =>
    validateEmployeeOrganizationRelations(req.organizationId!, data),
  beforeUpdate: async (data: Record<string, unknown>, req: any) =>
    validateEmployeeOrganizationRelations(req.organizationId!, data),
  afterCreate: async ({ req, created }: any) => {
    const employee = created as { id: string; firstName: string; lastName: string };
    await createAuditLog({ organizationId: req.organizationId!, actorUserId: req.user?.id, action: "HRIS_EMPLOYEE_CREATED", resource: "EMPLOYEE", resourceId: employee.id, summary: `Created employee ${employee.firstName} ${employee.lastName}` });
  },
  afterUpdate: async ({ req, updated }: any) => {
    const employee = updated as { id: string; firstName: string; lastName: string };
    await createAuditLog({ organizationId: req.organizationId!, actorUserId: req.user?.id, action: "HRIS_EMPLOYEE_UPDATED", resource: "EMPLOYEE", resourceId: employee.id, summary: `Updated employee ${employee.firstName} ${employee.lastName}` });
  }
};

export const attendanceCrudOptions = {
  model: "attendance" as const,
  createSchema: attendanceCreateSchema,
  updateSchema: attendanceUpdateSchema,
  permission: "hris:attendance:view" as const,
  include: { employee: true },
  beforeCreate: async (data: Record<string, unknown>, req: any) => {
    await tenantEmployeeExists(req.organizationId!, String(data.employeeId));
    return data;
  }
};

export const leaveCrudOptions = {
  model: "leaveRequest" as const,
  createSchema: tenantLeaveCreateSchema,
  updateSchema: tenantLeaveUpdateSchema,
  permission: "hris:leave:view" as const,
  include: { employee: { include: { department: true } } },
  beforeCreate: async (data: Record<string, unknown>, req: any) => {
    await tenantEmployeeExists(req.organizationId!, String(data.employeeId));
    return data;
  },
  beforeUpdate: async (data: Record<string, unknown>, req: any) => {
    if (data.employeeId) await tenantEmployeeExists(req.organizationId!, String(data.employeeId));
    return data;
  },
  afterCreate: async ({ req, created }: any) => {
    const leave = created as { id: string; employeeId: string };
    await createAuditLog({ organizationId: req.organizationId!, actorUserId: req.user?.id, action: "HRIS_LEAVE_REQUEST_SUBMITTED", resource: "LEAVE_REQUEST", resourceId: leave.id, summary: "Submitted a leave request", metadata: { employeeId: leave.employeeId } });
  }
};

export const reviewLeaveRequest = async (input: LeaveDecisionInput) => {
  return decideLeave(input.organizationId, input.leaveRequestId, input.decision, input.reason, { id: input.actorUserId } as AuthUser);
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

const auditMetadata = (value: Prisma.JsonValue | null): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

export const getHRISDashboard = async (organizationId: string, _user: AuthUser, asOf = new Date()) => {
  const [generalSettings, workSchedule] = await Promise.all([
    prisma.organizationGeneralSettings.findUnique({ where: { organizationId }, select: { timeZone: true } }),
    prisma.workSchedule.findUnique({ where: { organizationId } })
  ]);
  const timeZone = safeTimeZone(generalSettings?.timeZone);
  const schedule = workSchedule ?? {
    monday: true, tuesday: true, wednesday: true, thursday: true, friday: true,
    saturday: false, sunday: false, workStartTime: "09:00", workEndTime: "17:00",
    breakDurationMinutes: 60, gracePeriodMinutes: 0, overtimeAfterMinutes: 0
  };
  const currentDate = tenantDateKey(asOf, timeZone);
  const previousDate = shiftDateKey(currentDate, -1);
  const currentStart = zonedDateTimeToUtc(currentDate, "00:00", timeZone);
  const currentEnd = zonedDateTimeToUtc(shiftDateKey(currentDate, 1), "00:00", timeZone);
  const currentMonthStartKey = `${currentDate.slice(0, 8)}01`;
  const currentMonthStart = zonedDateTimeToUtc(currentMonthStartKey, "00:00", timeZone);
  const currentParts = parseDateKey(currentDate);
  const previousMonthAnchor = new Date(Date.UTC(currentParts.year, currentParts.month - 2, 1));
  const previousMonthStartKey = previousMonthAnchor.toISOString().slice(0, 7) + "-01";
  const previousMonthDays = new Date(Date.UTC(previousMonthAnchor.getUTCFullYear(), previousMonthAnchor.getUTCMonth() + 1, 0)).getUTCDate();
  const previousEquivalentEndKey = `${previousMonthStartKey.slice(0, 8)}${String(Math.min(currentParts.day, previousMonthDays)).padStart(2, "0")}`;
  const previousMonthStart = zonedDateTimeToUtc(previousMonthStartKey, "00:00", timeZone);
  const previousMonthEnd = zonedDateTimeToUtc(shiftDateKey(previousEquivalentEndKey, 1), "00:00", timeZone);

  const [
    employeeGroups, employeesOnLeaveRows, pendingLeaveApprovals, currentHires, previousHires,
    todayAttendance, previousAttendance, pendingLeaves, departmentRows, auditRows
  ] = await Promise.all([
    prisma.employee.groupBy({ by: ["status"], where: { organizationId, status: { in: [...dashboardEmployeeStatuses] } }, _count: { _all: true } }),
    prisma.leaveRequest.groupBy({ by: ["employeeId"], where: { organizationId, status: "APPROVED", startDate: { lt: currentEnd }, endDate: { gte: currentStart } } }),
    prisma.leaveRequest.count({ where: { organizationId, status: "PENDING" } }),
    prisma.employee.count({ where: { organizationId, status: { not: "TERMINATED" }, hireDate: { gte: currentMonthStart, lt: currentEnd } } }),
    prisma.employee.count({ where: { organizationId, status: { not: "TERMINATED" }, hireDate: { gte: previousMonthStart, lt: previousMonthEnd } } }),
    attendanceCountsForDate(organizationId, currentDate, timeZone, schedule, asOf),
    attendanceCountsForDate(organizationId, previousDate, timeZone, schedule, asOf),
    prisma.leaveRequest.findMany({
      where: { organizationId, status: "PENDING" }, orderBy: { createdAt: "desc" }, take: 10,
      include: { employee: { include: { department: true } } }
    }),
    prisma.$queryRawUnsafe<Array<{ departmentId: string; departmentName: string; headcount: bigint }>>(
      "SELECT d.id AS departmentId, d.name AS departmentName, COUNT(e.id) AS headcount FROM Department d LEFT JOIN Employee e ON e.departmentId = d.id AND e.organizationId = ? AND e.status <> 'TERMINATED' WHERE d.organizationId = ? GROUP BY d.id, d.name ORDER BY headcount DESC, d.name ASC",
      organizationId, organizationId
    ),
    prisma.auditLog.findMany({
      where: { organizationId, OR: [{ resource: { in: hrisAuditResources } }, { action: { startsWith: "HRIS_" } }] },
      orderBy: { createdAt: "desc" }, take: 10
    })
  ]);

  const statusCounts = new Map(employeeGroups.map((row) => [row.status, row._count._all]));
  const totalEmployees = employeeGroups.reduce((total, row) => total + row._count._all, 0);
  const activeEmployees = statusCounts.get("ACTIVE") ?? 0;
  const hireDifference = currentHires - previousHires;
  const targetEmployeeIds = [...new Set(auditRows.flatMap((log) => {
    const metadataEmployeeId = auditMetadata(log.metadata).employeeId;
    return [log.resource === "EMPLOYEE" ? log.resourceId : null, typeof metadataEmployeeId === "string" ? metadataEmployeeId : null].filter((value): value is string => Boolean(value));
  }))];
  const activityEmployees = targetEmployeeIds.length
    ? await prisma.employee.findMany({ where: { organizationId, id: { in: targetEmployeeIds } }, select: { id: true, firstName: true, lastName: true } })
    : [];
  const employeeNames = new Map(activityEmployees.map((employee) => [employee.id, `${employee.firstName} ${employee.lastName}`]));

  return {
    currentDate,
    timeZone,
    employeeOverview: {
      totalEmployees,
      activeEmployees,
      activeEmployeePercentage: totalEmployees === 0 ? 0 : Math.round((activeEmployees / totalEmployees) * 10_000) / 100,
      employeesOnLeave: employeesOnLeaveRows.length,
      pendingLeaveApprovals
    },
    newHires: { currentMonth: currentHires, previousMonth: previousHires, difference: hireDifference, trend: trendForDifference(hireDifference) },
    attendanceOverview: {
      onTime: attendanceMetric(todayAttendance.onTime, previousAttendance.onTime),
      lateClockIn: attendanceMetric(todayAttendance.lateClockIn, previousAttendance.lateClockIn),
      earlyClockIn: attendanceMetric(todayAttendance.earlyClockIn, previousAttendance.earlyClockIn),
      absent: attendanceMetric(todayAttendance.absent, previousAttendance.absent),
      noClockIn: attendanceMetric(todayAttendance.noClockIn, previousAttendance.noClockIn),
      noClockOut: attendanceMetric(todayAttendance.noClockOut, previousAttendance.noClockOut)
    },
    attendanceClassification: {
      workStartTime: schedule.workStartTime,
      workEndTime: schedule.workEndTime,
      gracePeriodMinutes: schedule.gracePeriodMinutes,
      onTimeIncludesEarlyClockIn: true,
      noClockInAvailability: "NOT_TRACKED",
      holidayExclusionAvailability: "NOT_TRACKED"
    },
    recentActivity: auditRows.map((log) => {
      const metadataEmployeeId = auditMetadata(log.metadata).employeeId;
      const employeeId = log.resource === "EMPLOYEE" ? log.resourceId : typeof metadataEmployeeId === "string" ? metadataEmployeeId : null;
      return { id: log.id, type: log.action, employeeId, employeeName: employeeId ? employeeNames.get(employeeId) ?? null : null, description: log.summary, createdAt: log.createdAt };
    }),
    pendingLeaveRequests: pendingLeaves.map((leave) => ({
      id: leave.id,
      employee: { id: leave.employee.id, name: `${leave.employee.firstName} ${leave.employee.lastName}` },
      department: leave.employee.department ? { id: leave.employee.department.id, name: leave.employee.department.name } : null,
      type: leave.type,
      days: Math.floor((Date.parse(tenantDateKey(leave.endDate, timeZone)) - Date.parse(tenantDateKey(leave.startDate, timeZone))) / DAY_MS) + 1,
      from: tenantDateKey(leave.startDate, timeZone),
      to: tenantDateKey(leave.endDate, timeZone),
      status: leave.status
    })),
    headcountByDepartment: departmentRows.map((row) => ({ ...row, headcount: Number(row.headcount) }))
  };
};

type PageInput = { page: number; limit: number };
const paginationResult = (page: number, limit: number, total: number) => ({
  page, limit, total, totalPages: Math.ceil(total / limit), hasNextPage: page * limit < total, hasPreviousPage: page > 1
});
const exposedEmployeeStatus = (employee: { status: string; lifecycleStatus: string }) =>
  employee.lifecycleStatus === "EXITED" ? "EXITED" : employee.lifecycleStatus === "CONFIRMED" ? "CONFIRMED" : employee.lifecycleStatus === "PROBATION" ? "PROBATION" : employee.status;
const employeeSearchWhere = (search?: string) => search ? { OR: [
  { employeeNo: { contains: search } }, { firstName: { contains: search } }, { lastName: { contains: search } },
  { email: { contains: search } }, { phone: { contains: search } },
  ...search.split(/\s+/).length > 1 ? [{ AND: [{ firstName: { contains: search.split(/\s+/)[0] } }, { lastName: { contains: search.split(/\s+/).slice(1).join(" ") } }] }] : []
] } : {};

export const listManagedEmployees = async (organizationId: string, query: any) => {
  if (query.departmentId) {
    const department = await prisma.department.findFirst({ where: { id: query.departmentId, organizationId }, select: { id: true } });
    if (!department) throw notFound("Department not found");
  }
  const lifecycle = ["PROBATION", "CONFIRMED", "EXITED"].includes(query.status) ? query.status : undefined;
  const operational = query.status === "INACTIVE" ? "TERMINATED" : ["ACTIVE", "ON_LEAVE", "SUSPENDED"].includes(query.status) ? query.status : undefined;
  const where: Prisma.EmployeeWhereInput = { organizationId, ...(query.departmentId ? { departmentId: query.departmentId } : {}), ...(lifecycle ? { lifecycleStatus: lifecycle as any } : {}), ...(operational ? { status: operational as any } : {}), ...employeeSearchWhere(query.search) };
  const orderBy: Prisma.EmployeeOrderByWithRelationInput = query.sortBy === "employeeId" ? { employeeNo: query.sortOrder } : query.sortBy === "joinedDate" ? { hireDate: query.sortOrder } : query.sortBy === "status" ? { lifecycleStatus: query.sortOrder } : query.sortBy === "department" ? { department: { name: query.sortOrder } } : { firstName: query.sortOrder };
  const [rows, total] = await Promise.all([
    prisma.employee.findMany({ where, skip: (query.page - 1) * query.limit, take: query.limit, orderBy, select: { id: true, employeeNo: true, firstName: true, lastName: true, jobTitle: true, department: { select: { id: true, name: true } }, status: true, lifecycleStatus: true, hireDate: true, phone: true, profileImageUrl: true } }),
    prisma.employee.count({ where })
  ]);
  return { employees: rows.map((row) => ({ id: row.id, employeeId: row.employeeNo, name: `${row.firstName} ${row.lastName}`, role: row.jobTitle, department: row.department, status: exposedEmployeeStatus(row), operationalStatus: row.status, lifecycleStatus: row.lifecycleStatus, joinedDate: row.hireDate, phoneNumber: row.phone, profileImage: row.profileImageUrl })), pagination: paginationResult(query.page, query.limit, total) };
};

const getTenantEmployee = async (organizationId: string, employeeId: string) => {
  const employee = await prisma.employee.findFirst({ where: { id: employeeId, organizationId }, include: { department: true, team: true, user: { select: { id: true, profileImageUrl: true } }, documents: true } });
  if (!employee) throw notFound("Employee not found");
  return employee;
};
const canViewSensitiveEmployeeData = (user: AuthUser) => user.permissions.some((permission) => ["payroll:salary:view", "payroll:payslips:view", "hris:employees:update"].includes(permission));
const maskAccount = (account: string | null) => account ? `${"*".repeat(Math.max(0, account.length - 4))}${account.slice(-4)}` : null;

const currentMonthBounds = async (organizationId: string, now = new Date()) => {
  const settings = await prisma.organizationGeneralSettings.findUnique({ where: { organizationId }, select: { timeZone: true } });
  const timeZone = safeTimeZone(settings?.timeZone);
  const current = tenantDateKey(now, timeZone);
  const [year, month] = current.split("-").map(Number);
  const startKey = `${year}-${String(month).padStart(2, "0")}-01`;
  const nextKey = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`;
  return { timeZone, start: zonedDateTimeToUtc(startKey, "00:00", timeZone), end: zonedDateTimeToUtc(nextKey, "00:00", timeZone), currentKey: current };
};

const durationHours = (clockInAt: Date, clockOutAt: Date | null) => clockOutAt ? Math.max(0, (clockOutAt.getTime() - clockInAt.getTime()) / 3_600_000) : 0;
export const classifyAttendance = (record: { clockInAt: Date; clockOutAt: Date | null; manualStatus?: string | null }, schedule: { workStartTime: string; workEndTime: string; gracePeriodMinutes: number; overtimeAfterMinutes: number }, timeZone: string) => {
  if (record.manualStatus) return { primaryStatus: record.manualStatus, flags: [] as string[] };
  const dateKey = tenantDateKey(record.clockInAt, timeZone);
  const start = zonedDateTimeToUtc(dateKey, schedule.workStartTime, timeZone);
  const end = zonedDateTimeToUtc(dateKey, schedule.workEndTime, timeZone);
  const lateAfter = new Date(start.getTime() + schedule.gracePeriodMinutes * 60_000);
  const flags: string[] = [];
  if (!record.clockOutAt) flags.push("NO_CLOCK_OUT");
  if (record.clockOutAt && record.clockOutAt < end) flags.push("EARLY_DEPARTURE");
  if (record.clockOutAt && record.clockOutAt.getTime() > end.getTime() + schedule.overtimeAfterMinutes * 60_000) flags.push("OVERTIME");
  return { primaryStatus: record.clockInAt > lateAfter ? "LATE" : "ON_TIME", flags };
};
const getSchedule = (organizationId: string) => prisma.workSchedule.findUnique({ where: { organizationId } }).then((schedule) => schedule ?? ({ workStartTime: "09:00", workEndTime: "17:00", breakDurationMinutes: 60, gracePeriodMinutes: 0, overtimeAfterMinutes: 0, monday: true, tuesday: true, wednesday: true, thursday: true, friday: true, saturday: false, sunday: false }));

export const getManagedEmployeeProfile = async (organizationId: string, employeeId: string, user: AuthUser) => {
  const [employee, bounds, schedule] = await Promise.all([getTenantEmployee(organizationId, employeeId), currentMonthBounds(organizationId), getSchedule(organizationId)]);
  const [attendance, leave, latestPayslip, salary, leaveBalances] = await Promise.all([
    prisma.attendance.findMany({ where: { organizationId, employeeId, clockInAt: { gte: bounds.start, lt: bounds.end } }, orderBy: { clockInAt: "asc" } }),
    prisma.leaveRequest.findMany({ where: { organizationId, employeeId }, orderBy: { startDate: "desc" }, take: 20 }),
    prisma.payslip.findFirst({ where: { organizationId, employeeId }, orderBy: { payrollrun: { periodEnd: "desc" } }, include: { payrollrun: true } }),
    prisma.salaryStructure.findFirst({ where: { organizationId, employeeId }, orderBy: { effectiveFrom: "desc" } }),
    prisma.leaveBalance.findMany({ where: { organizationId, employeeId, year: Number(bounds.currentKey.slice(0, 4)) }, orderBy: { leaveTypeCode: "asc" } })
  ]);
  const classified = attendance.map((row) => ({ row, classification: classifyAttendance(row, schedule, bounds.timeZone) }));
  const sensitive = canViewSensitiveEmployeeData(user);
  const approvedLeaveDays = leave.filter((row) => row.status === "APPROVED").reduce((sum, row) => sum + Math.floor((row.endDate.getTime() - row.startDate.getTime()) / DAY_MS) + 1, 0);
  return {
    header: { id: employee.id, name: `${employee.firstName} ${employee.lastName}`, role: employee.jobTitle, profileImage: employee.profileImageUrl ?? employee.user?.profileImageUrl, employeeId: employee.employeeNo, status: exposedEmployeeStatus(employee), operationalStatus: employee.status, lifecycleStatus: employee.lifecycleStatus, joinedDate: employee.hireDate },
    personalInformation: { fullName: `${employee.firstName} ${employee.lastName}`, gender: employee.gender, employmentType: employee.employmentType, emailAddress: employee.email, dateOfBirth: employee.dateOfBirth, department: employee.department && { id: employee.department.id, name: employee.department.name }, phoneNumber: employee.phone, address: employee.address, role: employee.jobTitle, city: employee.city, nationality: employee.nationality, state: employee.state, workMode: employee.workMode, maritalStatus: employee.maritalStatus },
    bankDetails: sensitive ? { bankName: employee.bankName, accountNumber: employee.bankAccountNumber, monthlySalary: employee.baseSalary } : { bankName: employee.bankName, accountNumber: maskAccount(employee.bankAccountNumber), monthlySalary: null, masked: true },
    attendanceOverview: { presentDays: new Set(attendance.map((row) => tenantDateKey(row.clockInAt, bounds.timeZone))).size, lateArrivals: classified.filter((item) => item.classification.primaryStatus === "LATE").length, absentDays: null, overtimeHours: Number(classified.filter((item) => item.classification.flags.includes("OVERTIME")).reduce((sum, item) => sum + Math.max(0, durationHours(item.row.clockInAt, item.row.clockOutAt) - 8), 0).toFixed(2)), availability: { absentDays: "Requires historical workday/holiday snapshots" } },
    leaveOverview: { usedApprovedDays: approvedLeaveDays, balances: leaveBalances.map((balance) => ({ type: balance.leaveTypeCode, used: Number(balance.used), pending: Number(balance.pending), total: Number(balance.entitlement), remaining: Math.max(0, Number(balance.entitlement) - Number(balance.used) - Number(balance.pending)) })), availability: leaveBalances.length ? "AVAILABLE" : "NOT_CONFIGURED" },
    payrollOverview: latestPayslip ? { grossSalary: latestPayslip.grossPay, totalDeductions: latestPayslip.deductions, netPay: latestPayslip.netPay, currency: "NGN", period: latestPayslip.payrollrun.periodEnd } : { available: false, salaryStructure: sensitive ? salary : null },
    nextOfKin: sensitive ? { name: employee.nextOfKinName, phoneNumber: employee.nextOfKinPhone, address: employee.nextOfKinAddress, relationship: employee.nextOfKinRelationship } : null,
    guarantor: sensitive ? { firstName: employee.guarantorFirstName, lastName: employee.guarantorLastName, relationship: employee.guarantorRelationship, phoneNumber: employee.guarantorPhone, address: employee.guarantorAddress } : null,
    documents: employee.documents.map((document) => ({ id: document.id, type: document.documentType, fileName: document.originalName, mimeType: document.mimeType, size: document.size, fileReference: document.fileReference, uploadedAt: document.createdAt }))
  };
};

const operationalStatuses = new Set(["ACTIVE", "ON_LEAVE", "SUSPENDED", "TERMINATED"]);
const lifecycleStatuses = new Set(["PROBATION", "CONFIRMED", "EXITED"]);
export const updateManagedEmployeeStatus = async (organizationId: string, employeeId: string, input: any, user: AuthUser) => {
  const employee = await getTenantEmployee(organizationId, employeeId);
  const nextOperational = input.status === "INACTIVE" || input.status === "EXITED" ? "TERMINATED" : operationalStatuses.has(input.status) ? input.status : undefined;
  const nextLifecycle = lifecycleStatuses.has(input.status) ? input.status : undefined;
  const allowed = nextLifecycle ? ({ PROBATION: ["CONFIRMED", "EXITED"], CONFIRMED: ["EXITED"], EXITED: [] } as Record<string, string[]>)[employee.lifecycleStatus].includes(nextLifecycle) || employee.lifecycleStatus === nextLifecycle : true;
  if (!allowed) throw conflict(`Invalid lifecycle transition from ${employee.lifecycleStatus} to ${nextLifecycle}`);
  const effectiveDate = new Date(`${input.effectiveDate}T00:00:00.000Z`);
  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.employee.update({ where: { id: employee.id }, data: { ...(nextOperational ? { status: nextOperational as any } : {}), ...(nextLifecycle ? { lifecycleStatus: nextLifecycle as any, lifecycleEffectiveAt: effectiveDate } : {}) } });
    await tx.employeeStatusHistory.create({ data: { organizationId, employeeId: employee.id, previousOperationalStatus: employee.status, newOperationalStatus: nextOperational as any, previousLifecycleStatus: employee.lifecycleStatus, newLifecycleStatus: nextLifecycle as any, effectiveDate, changedById: user.id } });
    if (nextOperational === "TERMINATED" && employee.user?.id) {
      await tx.user.update({ where: { id: employee.user.id }, data: { isActive: false } });
      await tx.userSession.updateMany({ where: { organizationId, userId: employee.user.id, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: "Employee exited or was deactivated" } });
    }
    return result;
  });
  await createAuditLog({ organizationId, actorUserId: user.id, action: "HRIS_EMPLOYEE_STATUS_CHANGED", resource: "EMPLOYEE", resourceId: employee.id, summary: `Changed employee status to ${input.status}`, metadata: { previousOperationalStatus: employee.status, previousLifecycleStatus: employee.lifecycleStatus, newStatus: input.status, effectiveDate: input.effectiveDate } });
  return updated;
};

const mapEmployeeInput = (input: any) => {
  let firstName = input.firstName; let lastName = input.lastName;
  if (input.fullName && (!firstName || !lastName)) { const names = input.fullName.trim().split(/\s+/); firstName ??= names.shift(); lastName ??= names.join(" ") || firstName; }
  return { employeeNo: input.employeeId ?? input.employeeNo, firstName, lastName, email: input.email, phone: input.phoneNumber, departmentId: input.departmentId, teamId: input.teamId, managerId: input.managerId, jobTitle: input.position ?? input.role, hireDate: input.joinedDate, status: input.operationalStatus, lifecycleStatus: input.lifecycleStatus, baseSalary: input.monthlySalary, bankName: input.bankName, bankCode: input.bankCode, bankAccountNumber: input.accountNumber, bankAccountName: input.accountName, bankAccountType: input.accountType, pensionPin: input.pensionId, taxId: input.taxId, gender: input.gender, employmentType: input.employmentType, dateOfBirth: input.dateOfBirth, address: input.address, city: input.city, nationality: input.nationality, state: input.state, workMode: input.workMode, maritalStatus: input.maritalStatus, profileImageUrl: input.profileImageUrl, nextOfKinName: input.nextOfKinName, nextOfKinPhone: input.nextOfKinPhone, nextOfKinAddress: input.nextOfKinAddress, nextOfKinRelationship: input.nextOfKinRelationship, guarantorFirstName: input.guarantorFirstName, guarantorLastName: input.guarantorLastName, guarantorRelationship: input.guarantorRelationship, guarantorPhone: input.guarantorPhone, guarantorAddress: input.guarantorAddress };
};
const withoutUndefined = (value: Record<string, unknown>) => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
export const createManagedEmployee = async (organizationId: string, input: any, user: AuthUser) => {
  const data = withoutUndefined(mapEmployeeInput(input));
  await validateEmployeeOrganizationRelations(organizationId, data);
  const created = await prisma.employee.create({ data: { ...(data as any), organizationId } });
  await createAuditLog({ organizationId, actorUserId: user.id, action: "HRIS_EMPLOYEE_CREATED", resource: "EMPLOYEE", resourceId: created.id, summary: `Created employee ${created.firstName} ${created.lastName}` });
  return created;
};
export const updateManagedEmployee = async (organizationId: string, employeeId: string, input: any, user: AuthUser) => {
  const existing = await getTenantEmployee(organizationId, employeeId);
  const data = withoutUndefined(mapEmployeeInput(input));
  await validateEmployeeOrganizationRelations(organizationId, data);
  const updated = await prisma.employee.update({ where: { id: existing.id }, data: data as any });
  await createAuditLog({ organizationId, actorUserId: user.id, action: "HRIS_EMPLOYEE_UPDATED", resource: "EMPLOYEE", resourceId: existing.id, summary: `Updated employee ${updated.firstName} ${updated.lastName}`, metadata: { changedFields: Object.keys(data) } });
  return updated;
};

export const getEmployeeAttendanceHistory = async (organizationId: string, employeeId: string, query: PageInput) => {
  await tenantEmployeeExists(organizationId, employeeId);
  const [bounds, schedule, rows, total] = await Promise.all([
    currentMonthBounds(organizationId), getSchedule(organizationId),
    prisma.attendance.findMany({ where: { organizationId, employeeId }, orderBy: { clockInAt: "desc" }, skip: (query.page - 1) * query.limit, take: query.limit }),
    prisma.attendance.count({ where: { organizationId, employeeId } })
  ]);
  return { records: rows.map((row) => { const classification = classifyAttendance(row, schedule, bounds.timeZone); return { id: row.id, date: tenantDateKey(row.clockInAt, bounds.timeZone), clockIn: row.clockInAt, clockOut: row.clockOutAt, workingHours: Number(durationHours(row.clockInAt, row.clockOutAt).toFixed(2)), taskCompleted: row.taskCompleted, status: classification.primaryStatus, flags: classification.flags }; }), pagination: paginationResult(query.page, query.limit, total) };
};
export const getEmployeeLeaveHistory = async (organizationId: string, employeeId: string, query: PageInput) => {
  await tenantEmployeeExists(organizationId, employeeId);
  const where = { organizationId, employeeId };
  const [rows, total] = await Promise.all([prisma.leaveRequest.findMany({ where, orderBy: { startDate: "desc" }, skip: (query.page - 1) * query.limit, take: query.limit }), prisma.leaveRequest.count({ where })]);
  return { records: rows.map((row) => ({ id: row.id, type: row.type, from: row.startDate, to: row.endDate, days: Math.floor((row.endDate.getTime() - row.startDate.getTime()) / DAY_MS) + 1, status: row.status })), pagination: paginationResult(query.page, query.limit, total) };
};
export const getEmployeePayrollHistory = async (organizationId: string, employeeId: string, query: PageInput, user: AuthUser) => {
  await tenantEmployeeExists(organizationId, employeeId);
  if (!canViewSensitiveEmployeeData(user)) throw forbidden("Payroll history requires payroll or employee-management permission");
  const where = { organizationId, employeeId };
  const [rows, total] = await Promise.all([prisma.payslip.findMany({ where, include: { payrollrun: true }, orderBy: { payrollrun: { periodEnd: "desc" } }, skip: (query.page - 1) * query.limit, take: query.limit }), prisma.payslip.count({ where })]);
  return { records: rows.map((row) => ({ id: row.id, month: row.payrollrun.periodEnd.toISOString().slice(0, 7), gross: row.grossPay, deductions: row.deductions, netPay: row.netPay, status: row.payrollrun.status, datePaid: row.payrollrun.payDate, currency: "NGN" })), pagination: paginationResult(query.page, query.limit, total) };
};
export const getEmployeeConductHistory = async (organizationId: string, employeeId: string, query: PageInput) => {
  await tenantEmployeeExists(organizationId, employeeId); const where = { organizationId, employeeId };
  const [rows, total] = await Promise.all([prisma.conductLog.findMany({ where, orderBy: { incidentDate: "desc" }, skip: (query.page - 1) * query.limit, take: query.limit }), prisma.conductLog.count({ where })]);
  return { records: rows.map((row) => ({ id: row.id, type: row.category, reason: row.summary, details: row.details, status: null, date: row.incidentDate })), availability: { status: "NOT_PERSISTED" }, pagination: paginationResult(query.page, query.limit, total) };
};
export const getEmployeeAppraisalHistory = async (organizationId: string, employeeId: string) => {
  await tenantEmployeeExists(organizationId, employeeId);
  const records = await prisma.employeeAppraisal.findMany({ where: { organizationId, employeeId }, include: { cycle: true, template: true }, orderBy: { updatedAt: "desc" } });
  return { records: records.map((record) => ({ id: record.id, cycle: record.cycle.title, template: record.template.name, stage: record.stage, status: record.status, finalScore: record.finalScore == null ? null : Number(record.finalScore), rating: record.rating, updatedAt: record.updatedAt })) };
};
export const getEmployeeActivity = async (organizationId: string, employeeId: string, query: PageInput) => {
  await tenantEmployeeExists(organizationId, employeeId);
  const where: Prisma.AuditLogWhereInput = { organizationId, OR: [{ resource: "EMPLOYEE", resourceId: employeeId }, { metadata: { path: "$.employeeId", equals: employeeId } as any }] };
  const [rows, total] = await Promise.all([prisma.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (query.page - 1) * query.limit, take: query.limit, select: { id: true, action: true, summary: true, createdAt: true, metadata: true, actorUserId: true } }), prisma.auditLog.count({ where })]);
  return { records: rows, pagination: paginationResult(query.page, query.limit, total) };
};

const attendanceRange = async (organizationId: string, query: any) => {
  const settings = await prisma.organizationGeneralSettings.findUnique({ where: { organizationId }, select: { timeZone: true } });
  const timeZone = safeTimeZone(settings?.timeZone); const today = tenantDateKey(new Date(), timeZone);
  const fromKey = query.from ?? query.date ?? today; const toKey = query.to ?? query.date ?? today;
  return { timeZone, fromKey, toKey, start: zonedDateTimeToUtc(fromKey, "00:00", timeZone), end: zonedDateTimeToUtc(shiftDateKey(toKey, 1), "00:00", timeZone) };
};
export const listAttendanceLogs = async (organizationId: string, query: any) => {
  if (query.departmentId && !(await prisma.department.findFirst({ where: { id: query.departmentId, organizationId }, select: { id: true } }))) throw notFound("Department not found");
  const [range, schedule] = await Promise.all([attendanceRange(organizationId, query), getSchedule(organizationId)]);
  const where: Prisma.AttendanceWhereInput = { organizationId, clockInAt: { gte: range.start, lt: range.end }, employee: { ...(query.departmentId ? { departmentId: query.departmentId } : {}), ...employeeSearchWhere(query.search) } };
  const candidates = await prisma.attendance.findMany({ where, include: { employee: { include: { department: true } } }, orderBy: { clockInAt: "desc" }, take: 10_000 });
  const mapped = candidates.map((row) => { const classification = classifyAttendance(row, schedule, range.timeZone); const hours = durationHours(row.clockInAt, row.clockOutAt); return { id: row.id, employeeRecordId: row.employee.id, employeeId: row.employee.employeeNo, name: `${row.employee.firstName} ${row.employee.lastName}`, department: row.employee.department?.name ?? null, shift: "Default Work Schedule", date: tenantDateKey(row.clockInAt, range.timeZone), clockIn: row.clockInAt, clockOut: row.clockOutAt, hours: Number(hours.toFixed(2)), overtime: Number(Math.max(0, hours - 8).toFixed(2)), status: classification.primaryStatus, flags: classification.flags }; });
  const filtered = query.status && query.status !== "ALL" ? mapped.filter((row) => row.status === query.status || row.flags.includes(query.status)) : mapped;
  const total = filtered.length; const records = filtered.slice((query.page - 1) * query.limit, query.page * query.limit);
  return { selectedRange: { from: range.fromKey, to: range.toKey, timeZone: range.timeZone }, records, pagination: paginationResult(query.page, query.limit, total) };
};
export const getDailyAttendance = async (organizationId: string, query: any) => {
  const normalized = { ...query, page: 1, limit: 10_000, status: "ALL" }; const range = await attendanceRange(organizationId, normalized); const schedule = await getSchedule(organizationId);
  const [logs, counts, employeeCount, onLeave] = await Promise.all([listAttendanceLogs(organizationId, normalized), attendanceCountsForDate(organizationId, range.fromKey, range.timeZone, schedule, new Date()), prisma.employee.count({ where: { organizationId, status: { not: "TERMINATED" } } }), prisma.employee.count({ where: { organizationId, status: { not: "TERMINATED" }, leaverequest: { some: { organizationId, status: "APPROVED", startDate: { lt: range.end }, endDate: { gte: range.start } } } } })]);
  const totalHours = logs.records.reduce((sum, row) => sum + row.hours, 0); const overtimeHours = logs.records.reduce((sum, row) => sum + row.overtime, 0);
  return { selectedDate: range.fromKey, employeeCount, analytics: { onTime: counts.onTime, late: counts.lateClockIn, absent: counts.absent, onLeave, noClockOut: counts.noClockOut, overtime: logs.records.filter((row) => row.flags.includes("OVERTIME")).length, totalHoursWorked: Number(totalHours.toFixed(2)), totalOvertimeHours: Number(overtimeHours.toFixed(2)), attendanceRate: employeeCount ? Number((((counts.onTime + counts.lateClockIn) / employeeCount) * 100).toFixed(2)) : 0, shiftsActive: 1, pendingDisputes: await prisma.attendanceDispute.count({ where: { organizationId, status: "PENDING" } }) }, records: logs.records.slice(0, 100) };
};
export const getMyAttendanceToday = async (organizationId: string, user: AuthUser) => {
  const employee = await prisma.employee.findFirst({ where: { organizationId, user: { id: user.id } }, select: { id: true } });
  if (!employee) throw notFound("Authenticated user is not linked to an employee");
  const [range, schedule] = await Promise.all([attendanceRange(organizationId, {}), getSchedule(organizationId)]);
  const attendance = await prisma.attendance.findFirst({ where: { organizationId, employeeId: employee.id, clockInAt: { gte: range.start, lt: range.end } }, orderBy: { clockInAt: "desc" } });
  return { currentTime: new Intl.DateTimeFormat("en-GB", { timeZone: range.timeZone, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date()), timeZone: range.timeZone, shift: { name: "Default Work Schedule", startTime: schedule.workStartTime, endTime: schedule.workEndTime }, attendance };
};

const timeOnAttendanceDate = (attendance: { clockInAt: Date }, time: string, timeZone: string) => zonedDateTimeToUtc(tenantDateKey(attendance.clockInAt, timeZone), time, timeZone);
export const overrideAttendance = async (organizationId: string, attendanceId: string, input: any, user: AuthUser, disputeId?: string) => {
  const existing = await prisma.attendance.findFirst({ where: { id: attendanceId, organizationId } });
  if (!existing) throw notFound("Attendance record not found");
  const range = await attendanceRange(organizationId, { date: existing.clockInAt.toISOString().slice(0, 10) });
  const clockInAt = input.clockIn ? timeOnAttendanceDate(existing, input.clockIn, range.timeZone) : existing.clockInAt;
  const clockOutAt = input.clockOut ? timeOnAttendanceDate(existing, input.clockOut, range.timeZone) : existing.clockOutAt;
  if (clockOutAt && clockOutAt <= clockInAt) throw badRequest("Clock-out must be later than clock-in");
  const updated = await prisma.attendance.update({ where: { id: existing.id }, data: { clockInAt, clockOutAt, ...(input.status ? { manualStatus: input.status } : {}), note: input.reason, overriddenAt: new Date(), overriddenById: user.id } });
  await createAuditLog({ organizationId, actorUserId: user.id, action: disputeId ? "HRIS_ATTENDANCE_DISPUTE_CORRECTION" : "HRIS_ATTENDANCE_OVERRIDDEN", resource: "ATTENDANCE", resourceId: existing.id, summary: "Manually updated attendance", metadata: { employeeId: existing.employeeId, disputeId: disputeId ?? null, reason: input.reason, previous: { clockInAt: existing.clockInAt, clockOutAt: existing.clockOutAt, manualStatus: existing.manualStatus }, current: { clockInAt: updated.clockInAt, clockOutAt: updated.clockOutAt, manualStatus: updated.manualStatus } } });
  return updated;
};
const disputeNumber = () => `DSP-${Date.now().toString(36).toUpperCase()}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
export const createAttendanceDispute = async (organizationId: string, attendanceId: string, input: any, user: AuthUser) => {
  const attendance = await prisma.attendance.findFirst({ where: { id: attendanceId, organizationId }, include: { employee: { include: { user: true } } } });
  if (!attendance) throw notFound("Attendance record not found");
  const mayManage = user.permissions.includes("hris:attendance:update");
  if (!mayManage && attendance.employee.user?.id !== user.id) throw notFound("Attendance record not found");
  if (await prisma.attendanceDispute.findFirst({ where: { organizationId, attendanceId, status: "PENDING" }, select: { id: true } })) throw conflict("A pending dispute already exists for this attendance record");
  const range = await attendanceRange(organizationId, { date: attendance.clockInAt.toISOString().slice(0, 10) });
  return prisma.attendanceDispute.create({ data: { disputeNo: disputeNumber(), organizationId, attendanceId, employeeId: attendance.employeeId, issueType: input.issueType, description: input.description, claimedClockIn: input.claimedClockIn ? timeOnAttendanceDate(attendance, input.claimedClockIn, range.timeZone) : undefined, claimedClockOut: input.claimedClockOut ? timeOnAttendanceDate(attendance, input.claimedClockOut, range.timeZone) : undefined } });
};
export const listAttendanceDisputes = async (organizationId: string, query: any) => {
  const where: Prisma.AttendanceDisputeWhereInput = { organizationId, ...(query.status !== "ALL" ? { status: query.status } : {}) };
  const [rows, total] = await Promise.all([prisma.attendanceDispute.findMany({ where, include: { employee: { include: { department: true } }, attendance: true }, orderBy: { createdAt: "desc" }, skip: (query.page - 1) * query.limit, take: query.limit }), prisma.attendanceDispute.count({ where })]);
  return { disputes: rows.map((row) => ({ disputeId: row.disputeNo, id: row.id, status: row.status, issueType: row.issueType, date: row.attendance.clockInAt, employee: { id: row.employee.id, employeeId: row.employee.employeeNo, name: `${row.employee.firstName} ${row.employee.lastName}`, department: row.employee.department?.name ?? null }, description: row.description, claimedClockIn: row.claimedClockIn, claimedClockOut: row.claimedClockOut, resolutionNote: row.resolutionNote })), pagination: paginationResult(query.page, query.limit, total) };
};
export const getAttendanceDispute = async (organizationId: string, disputeId: string) => {
  const dispute = await prisma.attendanceDispute.findFirst({ where: { organizationId, OR: [{ id: disputeId }, { disputeNo: disputeId }] }, include: { employee: { include: { department: true } }, attendance: true } });
  if (!dispute) throw notFound("Attendance dispute not found"); return dispute;
};
export const resolveAttendanceDispute = async (organizationId: string, disputeId: string, input: any, user: AuthUser) => {
  const dispute = await getAttendanceDispute(organizationId, disputeId);
  if (dispute.status !== "PENDING") throw conflict("Attendance dispute has already been resolved");
  const updated = await prisma.$transaction(async (tx) => {
    const changed = await tx.attendanceDispute.updateMany({ where: { id: dispute.id, organizationId, status: "PENDING" }, data: { status: input.status, resolutionNote: input.resolutionNote, resolvedById: user.id, resolvedAt: new Date() } });
    if (changed.count !== 1) throw conflict("Attendance dispute was resolved concurrently");
    return tx.attendanceDispute.findUniqueOrThrow({ where: { id: dispute.id } });
  });
  if (input.status === "APPROVED" && (dispute.claimedClockIn || dispute.claimedClockOut)) {
    const range = await attendanceRange(organizationId, { date: dispute.attendance.clockInAt.toISOString().slice(0, 10) });
    const formatTime = (date: Date | null) => date ? new Intl.DateTimeFormat("en-GB", { timeZone: range.timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).format(date) : undefined;
    await overrideAttendance(organizationId, dispute.attendanceId, { clockIn: formatTime(dispute.claimedClockIn), clockOut: formatTime(dispute.claimedClockOut), reason: input.resolutionNote }, user, dispute.id);
  }
  await createAuditLog({ organizationId, actorUserId: user.id, action: `HRIS_ATTENDANCE_DISPUTE_${input.status}`, resource: "ATTENDANCE_DISPUTE", resourceId: dispute.id, summary: `${input.status === "APPROVED" ? "Approved" : "Rejected"} attendance dispute`, metadata: { employeeId: dispute.employeeId, attendanceId: dispute.attendanceId, resolutionNote: input.resolutionNote } });
  const employeeUser = await prisma.user.findFirst({ where: { organizationId, employeeId: dispute.employeeId, isActive: true }, select: { id: true } });
  if (employeeUser) await deliverUserNotification({ organizationId, recipientUserId: employeeUser.id, moduleKey: "hris", categoryKey: "record-updates", eventKey: `attendance-dispute:${dispute.id}:${input.status.toLowerCase()}`, type: `ATTENDANCE_DISPUTE_${input.status}`, title: `Attendance dispute ${input.status.toLowerCase()}`, message: `Your attendance dispute has been ${input.status.toLowerCase()}.`, metadata: { disputeId: dispute.id, attendanceId: dispute.attendanceId, status: input.status } }).catch(() => null);
  return updated;
};

export const getAttendanceOverview = async (organizationId: string, query: any) => {
  const result = await listAttendanceLogs(organizationId, { ...query, page: 1, limit: 10_000 });
  const daysPresent = new Set(result.records.map((row) => `${row.employeeRecordId}:${row.date}`)).size;
  return { range: result.selectedRange, attendanceRate: result.pagination.total ? Number(((result.records.filter((row) => ["ON_TIME", "LATE"].includes(row.status)).length / result.pagination.total) * 100).toFixed(2)) : 0, daysPresent, daysAbsent: null, onLeave: null, lateClockIns: result.records.filter((row) => row.status === "LATE").length, totalHours: Number(result.records.reduce((sum, row) => sum + row.hours, 0).toFixed(2)), availability: { daysAbsent: "Requires historical workday/holiday snapshots", onLeave: "Use approved leave date-range aggregation" } };
};
export const getDepartmentAttendanceSummary = async (organizationId: string, query: any) => {
  const result = await listAttendanceLogs(organizationId, { ...query, page: 1, limit: 10_000 });
  const departments = await prisma.department.findMany({ where: { organizationId }, include: { _count: { select: { employees: { where: { status: { not: "TERMINATED" } } } } } }, orderBy: { name: "asc" } });
  return departments.map((department) => { const rows = result.records.filter((row) => row.department === department.name); const onTime = rows.filter((row) => row.status === "ON_TIME").length; const late = rows.filter((row) => row.status === "LATE").length; return { departmentId: department.id, department: department.name, employees: department._count.employees, onTime, late, absent: null, onLeave: null, hours: Number(rows.reduce((sum, row) => sum + row.hours, 0).toFixed(2)), rate: department._count.employees ? Number((((onTime + late) / department._count.employees) * 100).toFixed(2)) : 0 }; });
};
export const getMonthlyAttendance = async (organizationId: string, query: any) => {
  const [year, month] = query.month.split("-").map(Number); const from = `${query.month}-01`; const to = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  const logs = await listAttendanceLogs(organizationId, { page: 1, limit: 10_000, status: "ALL", from, to, departmentId: query.departmentId, search: query.search });
  const map = new Map<string, any>(); for (const row of logs.records) { const entry = map.get(row.employeeRecordId) ?? { employeeId: row.employeeId, employee: row.name, department: row.department, present: 0, absent: null, onLeave: null, late: 0, hours: 0, overtime: 0 }; entry.present += 1; if (row.status === "LATE") entry.late += 1; entry.hours += row.hours; entry.overtime += row.overtime; map.set(row.employeeRecordId, entry); }
  const all = [...map.values()].map((row) => ({ ...row, hours: Number(row.hours.toFixed(2)), overtime: Number(row.overtime.toFixed(2)), rate: null })); const records = all.slice((query.page - 1) * query.limit, query.page * query.limit);
  return { month: query.month, records, availability: { absent: "Requires historical workday/holiday snapshots", onLeave: "Deferred to Leave Tracking", rate: "Unavailable until expected workdays are persisted" }, pagination: paginationResult(query.page, query.limit, all.length) };
};
const sanitizeCsv = (value: unknown) => { let text = value == null ? "" : value instanceof Date ? value.toISOString() : String(value); if (/^[=+\-@]/.test(text)) text = `'${text}`; return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text; };
export const exportAttendanceCsv = async (organizationId: string, query: any) => {
  const logs = await listAttendanceLogs(organizationId, { ...query, page: 1, limit: 10_000 }); const header = ["Employee ID", "Name", "Department", "Date", "Clock In", "Clock Out", "Hours", "Overtime", "Status"];
  return { filename: `attendance-${logs.selectedRange.from}-${logs.selectedRange.to}.csv`, csv: `\uFEFF${[header, ...logs.records.map((row) => [row.employeeId, row.name, row.department, row.date, row.clockIn, row.clockOut, row.hours, row.overtime, [row.status, ...row.flags].join("|")])].map((row) => row.map(sanitizeCsv).join(",")).join("\r\n")}` };
};
export const employeeImportTemplate = () => `employeeId,firstName,lastName,phoneNumber,email,department,position,lifecycleStatus,workMode,dateJoined,monthlyEarning\r\n`;
const parseCsvLine = (line: string) => { const cells: string[] = []; let value = ""; let quoted = false; for (let index = 0; index < line.length; index += 1) { const char = line[index]; if (char === '"' && quoted && line[index + 1] === '"') { value += '"'; index += 1; } else if (char === '"') quoted = !quoted; else if (char === "," && !quoted) { cells.push(value.trim()); value = ""; } else value += char; } cells.push(value.trim()); return cells; };
export const importEmployeesCsv = async (organizationId: string, buffer: Buffer, user: AuthUser) => {
  const text = buffer.toString("utf8").replace(/^\uFEFF/, ""); const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) throw badRequest("CSV must contain a header and at least one employee row");
  if (lines.length > 5001) throw badRequest("CSV import is limited to 5,000 employees per request");
  const headers = parseCsvLine(lines[0]); const required = ["employeeId", "firstName", "lastName", "email"];
  if (required.some((field) => !headers.includes(field))) throw badRequest(`CSV requires columns: ${required.join(", ")}`);
  const departments = await prisma.department.findMany({ where: { organizationId }, select: { id: true, name: true } }); const departmentMap = new Map(departments.map((row) => [row.name.toLowerCase(), row.id]));
  const rows = lines.slice(1).map((line, rowIndex) => { const cells = parseCsvLine(line); const raw = Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""])); const departmentId = raw.department ? departmentMap.get(raw.department.toLowerCase()) : undefined; if (raw.department && !departmentId) throw badRequest(`Unknown department on CSV row ${rowIndex + 2}`); return { organizationId, employeeNo: raw.employeeId, firstName: raw.firstName, lastName: raw.lastName, phone: raw.phoneNumber || null, email: raw.email, departmentId, jobTitle: raw.position || null, lifecycleStatus: raw.lifecycleStatus || "PROBATION", workMode: raw.workMode || null, hireDate: raw.dateJoined ? new Date(`${raw.dateJoined}T00:00:00.000Z`) : null, baseSalary: raw.monthlyEarning || null }; });
  try { await prisma.$transaction(rows.map((data) => prisma.employee.create({ data: data as any }))); } catch { throw conflict("Employee import contains duplicate or invalid employee records"); }
  await createAuditLog({ organizationId, actorUserId: user.id, action: "HRIS_EMPLOYEES_IMPORTED", resource: "EMPLOYEE", summary: `Imported ${rows.length} employees from CSV`, metadata: { count: rows.length } });
  return { imported: rows.length, failed: 0 };
};

export const createManagedEmployeeWithFiles = async (organizationId: string, input: any, files: Express.Multer.File[], user: AuthUser, publicBaseUrl: string) => {
  const uploaded: Array<{ file: Express.Multer.File; key: string; url: string }> = [];
  try {
    for (const file of files) {
      const stored = await uploadObject({ key: createObjectKey(`hris/${organizationId}/employees`, file.originalname), body: file.buffer, contentType: file.mimetype, publicBaseUrl });
      uploaded.push({ file, key: stored.key, url: stored.url });
    }
    const profile = uploaded.find((item) => item.file.fieldname === "profileImage");
    const documents = uploaded.filter((item) => item.file.fieldname !== "profileImage");
    const data = withoutUndefined(mapEmployeeInput({ ...input, ...(profile ? { profileImageUrl: profile.url } : {}) }));
    await validateEmployeeOrganizationRelations(organizationId, data);
    const employee = await prisma.$transaction(async (tx) => {
      const created = await tx.employee.create({ data: { ...(data as any), organizationId } });
      if (documents.length) await tx.employeeDocument.createMany({ data: documents.map((item) => ({ organizationId, employeeId: created.id, documentType: item.file.fieldname === "appointmentLetter" ? "APPOINTMENT_LETTER" : String(input.documentType ?? "OTHER"), fileReference: item.key, originalName: item.file.originalname, mimeType: item.file.mimetype, size: item.file.size, uploadedById: user.id })) });
      return created;
    });
    await createAuditLog({ organizationId, actorUserId: user.id, action: "HRIS_EMPLOYEE_CREATED", resource: "EMPLOYEE", resourceId: employee.id, summary: `Created employee ${employee.firstName} ${employee.lastName}`, metadata: { documentCount: documents.length } });
    return { ...employee, documents: documents.map((item) => ({ originalName: item.file.originalname, mimeType: item.file.mimetype, size: item.file.size })) };
  } catch (error) {
    await Promise.allSettled(uploaded.map((item) => deleteObject(item.key)));
    throw error;
  }
};

const defaultLeaveTypeCodes = new Set(["ANNUAL_LEAVE", "SICK_LEAVE", "MATERNITY_LEAVE", "PATERNITY_LEAVE", "COMPASSIONATE_LEAVE"]);
const actorEmployee = async (organizationId: string, userId: string) => prisma.employee.findFirst({ where: { organizationId, user: { id: userId } }, select: { id: true, managerId: true } });
const userIdsForEmployees = async (organizationId: string, employeeIds: Array<string | null | undefined>) => {
  const ids = employeeIds.filter((id): id is string => Boolean(id));
  if (!ids.length) return [];
  const users = await prisma.user.findMany({ where: { organizationId, employeeId: { in: ids }, isActive: true }, select: { id: true } });
  return users.map((item) => item.id);
};
const hrisApproverUserIds = async (organizationId: string, permissionKeys: string[]) => {
  const users = await prisma.user.findMany({
    where: { organizationId, isActive: true, role: { permissions: { some: { permission: { key: { in: permissionKeys } } } } } },
    select: { id: true }
  });
  return users.map((item) => item.id);
};
const notifyHRISUsers = async (input: { organizationId: string; recipientUserIds: string[]; categoryKey: string; eventKey: string; type: string; title: string; message: string; metadata?: Prisma.InputJsonValue }) => {
  const recipients = [...new Set(input.recipientUserIds)];
  const results = await Promise.all(recipients.map((recipientUserId) => deliverUserNotification({ ...input, recipientUserId, moduleKey: "hris" }).catch(() => ({ status: "FAILED" as const }))));
  return { attempted: recipients.length, delivered: results.filter((result) => result.status === "DELIVERED" || result.status === "PARTIAL").length, failed: results.filter((result) => result.status === "FAILED").length };
};
const isScheduledDate = (dateKey: string, schedule: Awaited<ReturnType<typeof getSchedule>>) => isScheduledWorkDay(dateKey, schedule);
export const calculateLeaveDays = (fromDate: string, toDate: string, schedule: Awaited<ReturnType<typeof getSchedule>>) => {
  let cursor = fromDate; let days = 0;
  while (cursor <= toDate) { if (isScheduledDate(cursor, schedule)) days += 1; cursor = shiftDateKey(cursor, 1); }
  return days;
};
export const getLeaveOverview = async (organizationId: string) => {
  const rows = await prisma.leaveRequest.groupBy({ by: ["status"], where: { organizationId, status: { in: ["PENDING", "APPROVED", "REJECTED"] } }, _count: { _all: true } });
  const counts = new Map(rows.map((row) => [row.status, row._count._all]));
  return { pending: counts.get("PENDING") ?? 0, approved: counts.get("APPROVED") ?? 0, rejected: counts.get("REJECTED") ?? 0 };
};
export const listLeaves = async (organizationId: string, query: any, user: AuthUser) => {
  const self = await actorEmployee(organizationId, user.id);
  const where: Prisma.LeaveRequestWhereInput = { organizationId, ...(!user.permissions.includes("hris:leave:approve") ? { employeeId: self?.id ?? "__unlinked__" } : {}), ...(query.status !== "ALL" ? { status: query.status } : {}) };
  const [rows, total, settings] = await Promise.all([prisma.leaveRequest.findMany({ where, include: { employee: { include: { department: true } } }, orderBy: { submittedAt: "desc" }, skip: (query.page - 1) * query.limit, take: query.limit }), prisma.leaveRequest.count({ where }), prisma.organizationGeneralSettings.findUnique({ where: { organizationId }, select: { timeZone: true } })]);
  const timeZone = safeTimeZone(settings?.timeZone);
  return { leaves: rows.map((row) => ({ id: row.id, employee: { id: row.employee.id, employeeId: row.employee.employeeNo, name: `${row.employee.firstName} ${row.employee.lastName}` }, department: row.employee.department ? { id: row.employee.department.id, name: row.employee.department.name } : null, leaveType: row.type, from: tenantDateKey(row.startDate, timeZone), to: tenantDateKey(row.endDate, timeZone), days: Number(row.requestedDays ?? 0), status: row.status, reason: row.reason, submittedAt: row.submittedAt, rejectionReason: row.rejectionReason })), pagination: paginationResult(query.page, query.limit, total) };
};
export const applyForLeave = async (organizationId: string, input: any, user: AuthUser) => {
  const self = await actorEmployee(organizationId, user.id); const canCreateForOthers = user.permissions.includes("hris:leave:approve");
  const employeeId = input.employeeId && canCreateForOthers ? input.employeeId : self?.id;
  if (!employeeId) throw forbidden("Authenticated user is not linked to an employee");
  await tenantEmployeeExists(organizationId, employeeId);
  const [schedule, leaveType, reliever] = await Promise.all([
    getSchedule(organizationId),
    prisma.leaveType.findFirst({ where: { organizationId, code: input.leaveType, active: true } }),
    input.relieverEmployeeId ? prisma.employee.findFirst({ where: { id: input.relieverEmployeeId, organizationId, status: "ACTIVE" }, select: { id: true } }) : Promise.resolve(null)
  ]);
  if (!leaveType && !defaultLeaveTypeCodes.has(input.leaveType)) throw badRequest("Leave type is not supported");
  if (input.relieverEmployeeId && !reliever) throw notFound("Reliever employee not found");
  if (reliever?.id === employeeId) throw badRequest("Employee cannot be their own reliever");
  const days = calculateLeaveDays(input.fromDate, input.toDate, schedule);
  if (days <= 0) throw badRequest("Selected dates contain no scheduled workdays");
  const startDate = zonedDateTimeToUtc(input.fromDate, "00:00", safeTimeZone((await prisma.organizationGeneralSettings.findUnique({ where: { organizationId }, select: { timeZone: true } }))?.timeZone));
  const endDate = zonedDateTimeToUtc(input.toDate, "23:59", safeTimeZone((await prisma.organizationGeneralSettings.findUnique({ where: { organizationId }, select: { timeZone: true } }))?.timeZone));
  const overlap = await prisma.leaveRequest.findFirst({ where: { organizationId, employeeId, status: { in: ["PENDING", "APPROVED"] }, startDate: { lte: endDate }, endDate: { gte: startDate } }, select: { id: true } });
  if (overlap) throw conflict("Employee already has an overlapping pending or approved leave request");
  const year = Number(input.fromDate.slice(0, 4)); const balance = await prisma.leaveBalance.findUnique({ where: { organizationId_employeeId_leaveTypeCode_year: { organizationId, employeeId, leaveTypeCode: input.leaveType, year } } });
  if (balance && Number(balance.entitlement) - Number(balance.used) - Number(balance.pending) < days) throw conflict("Insufficient leave balance");
  const activeRequestKey = `${organizationId}:${employeeId}:${input.fromDate}:${input.toDate}`;
  let created;
  try {
    created = await prisma.$transaction(async (tx) => {
      if (balance) {
        const maximumPendingBeforeRequest = Number(balance.entitlement) - Number(balance.used) - days;
        const reserved = await tx.leaveBalance.updateMany({ where: { id: balance.id, pending: { lte: maximumPendingBeforeRequest } }, data: { pending: { increment: days } } });
        if (reserved.count !== 1) throw conflict("Leave balance changed concurrently; please retry");
      }
      return tx.leaveRequest.create({ data: { organizationId, employeeId, relieverEmployeeId: reliever?.id, type: input.leaveType, startDate, endDate, reason: input.reason, status: "PENDING", requestedDays: days, activeRequestKey } });
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw conflict("An active leave request already exists for this date range");
    throw error;
  }
  const employee = await prisma.employee.findFirst({ where: { id: employeeId, organizationId }, select: { firstName: true, lastName: true, managerId: true } });
  let recipients = await userIdsForEmployees(organizationId, [employee?.managerId]);
  if (!recipients.length) recipients = await hrisApproverUserIds(organizationId, ["hris:leave:approve"]);
  const notification = await notifyHRISUsers({ organizationId, recipientUserIds: recipients, categoryKey: "approvals-requests", eventKey: `leave:${created.id}:submitted`, type: "LEAVE_REQUEST_SUBMITTED", title: "Leave request awaiting approval", message: `${employee?.firstName ?? "An employee"} ${employee?.lastName ?? ""}`.trim() + ` submitted a ${input.leaveType} request for ${days} day${days === 1 ? "" : "s"}.`, metadata: { leaveRequestId: created.id, employeeId } });
  const relieverRecipients = await userIdsForEmployees(organizationId, [reliever?.id]);
  await notifyHRISUsers({ organizationId, recipientUserIds: relieverRecipients, categoryKey: "record-updates", eventKey: `leave:${created.id}:reliever`, type: "LEAVE_RELIEVER_ASSIGNED", title: "Leave cover assignment", message: `You were selected as reliever for an upcoming leave request.`, metadata: { leaveRequestId: created.id, employeeId } });
  await createAuditLog({ organizationId, actorUserId: user.id, action: "HRIS_LEAVE_REQUEST_SUBMITTED", resource: "LEAVE_REQUEST", resourceId: created.id, summary: "Submitted a leave request", metadata: { employeeId, leaveType: input.leaveType, days, notification } });
  return created;
};
export const decideLeave = async (organizationId: string, leaveId: string, decision: "APPROVED" | "REJECTED", reason: string | undefined, user: AuthUser) => {
  const existing = await prisma.leaveRequest.findFirst({ where: { id: leaveId, organizationId }, include: { employee: true } });
  if (!existing) throw notFound("Leave request not found"); if (existing.status !== "PENDING") throw conflict("Only a pending leave request can be reviewed");
  const settings = await prisma.organizationGeneralSettings.findUnique({ where: { organizationId }, select: { timeZone: true } });
  const days = Number(existing.requestedDays ?? 0); const year = Number(tenantDateKey(existing.startDate, safeTimeZone(settings?.timeZone)).slice(0, 4));
  const updated = await prisma.$transaction(async (tx) => {
    const changed = await tx.leaveRequest.updateMany({ where: { id: existing.id, organizationId, status: "PENDING" }, data: { status: decision, reviewedBy: user.id, reviewedAt: new Date(), managerComment: reason ?? null, rejectionReason: decision === "REJECTED" ? reason ?? null : null, ...(decision === "REJECTED" ? { activeRequestKey: null } : {}) } });
    if (changed.count !== 1) throw conflict("Leave request was reviewed concurrently");
    const balance = await tx.leaveBalance.findUnique({ where: { organizationId_employeeId_leaveTypeCode_year: { organizationId, employeeId: existing.employeeId, leaveTypeCode: existing.type, year } } });
    if (balance && days > 0) await tx.leaveBalance.update({ where: { id: balance.id }, data: decision === "APPROVED" ? { pending: { decrement: Math.min(days, Number(balance.pending)) }, used: { increment: days } } : { pending: { decrement: Math.min(days, Number(balance.pending)) } } });
    return tx.leaveRequest.findUniqueOrThrow({ where: { id: existing.id }, include: { employee: { include: { department: true } } } });
  });
  const recipients = await userIdsForEmployees(organizationId, [existing.employeeId]);
  const notification = await notifyHRISUsers({ organizationId, recipientUserIds: recipients, categoryKey: "record-updates", eventKey: `leave:${existing.id}:${decision.toLowerCase()}`, type: `LEAVE_REQUEST_${decision}`, title: `Leave request ${decision.toLowerCase()}`, message: `Your ${existing.type} request from ${existing.startDate.toISOString().slice(0, 10)} to ${existing.endDate.toISOString().slice(0, 10)} was ${decision.toLowerCase()}.`, metadata: { leaveRequestId: existing.id, employeeId: existing.employeeId, decision } });
  await createAuditLog({ organizationId, actorUserId: user.id, action: `HRIS_LEAVE_REQUEST_${decision}`, resource: "LEAVE_REQUEST", resourceId: existing.id, summary: `${decision === "APPROVED" ? "Approved" : "Rejected"} leave request for ${existing.employee.firstName} ${existing.employee.lastName}`, metadata: { employeeId: existing.employeeId, decision, reason: reason ?? null, notification } });
  return updated;
};

const ratingLabels = { 1: "Needs Significant Improvement", 2: "Needs Improvement", 3: "Meets Expectations", 4: "Exceeds Expectations", 5: "Outstanding" } as const;
export const performanceRatingForScore = (score: number) => score > 120 ? "OUTSTANDING" : score > 100 ? "ABOVE_EXPECTATION" : score >= 80 ? "MEETS_EXPECTATION" : score >= 60 ? "BELOW_EXPECTATION" : "POOR_PERFORMANCE";
export const performanceRatingValueForScore = (score: number) => score > 120 ? 5 : score > 100 ? 4 : score >= 80 ? 3 : score >= 60 ? 2 : 1;
export const calculateWeightedAssessmentScore = (sections: any[]) => {
  const totalSectionWeight = sections.reduce((sum, section) => sum + section.totalWeight, 0);
  if (Math.abs(totalSectionWeight - 100) > 0.001) throw badRequest("Appraisal section weights must total 100");
  let score = 0;
  const normalized = sections.map((section) => {
    const objectiveWeight = section.objectives.reduce((sum: number, objective: any) => sum + objective.weight, 0);
    if (Math.abs(objectiveWeight - section.totalWeight) > 0.001) throw badRequest(`${section.section} objective weights must equal its section weight`);
    return { ...section, objectives: section.objectives.map((objective: any) => {
      const kpiWeight = objective.keyResults.reduce((sum: number, keyResult: any) => sum + keyResult.kpiWeight, 0);
      if (Math.abs(kpiWeight - objective.weight) > 0.001) throw badRequest(`KPI weights for ${objective.title} must equal the objective weight`);
      return { ...objective, keyResults: objective.keyResults.map((keyResult: any) => {
        if (keyResult.target <= 0) throw badRequest("KPI target must be greater than zero");
        const achieved = typeof keyResult.achieved === "number" ? keyResult.achieved : Number(Object.values(keyResult.achieved).find((value) => value != null) ?? 0);
        const resultPercentage = Math.round(Math.max(achieved / keyResult.target, 0) * keyResult.kpiWeight * 100) / 100;
        score += resultPercentage; return { ...keyResult, resultPercentage };
      }) };
    }) };
  });
  return { sections: normalized, score: Math.round(score * 100) / 100 };
};
const canManageAppraisals = (user: AuthUser) => user.permissions.includes("hris:appraisals:update");
const canApproveAppraisals = (user: AuthUser) => user.permissions.includes("admin:staff:update") || user.permissions.includes("admin:organization:update");
const appraisalInclude = { employee: { include: { department: true, user: { select: { profileImageUrl: true } } } }, manager: true, cycle: true, template: true, goals: true, selfAssessment: true, managerReview: true, hrApproval: true, signOffs: true } as const;
const getTenantAppraisal = async (organizationId: string, appraisalId: string) => {
  const appraisal = await prisma.employeeAppraisal.findFirst({ where: { id: appraisalId, organizationId }, include: appraisalInclude });
  if (!appraisal) throw notFound("Appraisal not found"); return appraisal;
};
const assertAppraisalAccess = async (organizationId: string, appraisal: Awaited<ReturnType<typeof getTenantAppraisal>>, user: AuthUser, mode: "VIEW" | "EMPLOYEE" | "MANAGER" | "HR") => {
  const self = await actorEmployee(organizationId, user.id); const hr = canApproveAppraisals(user);
  const allowed = mode === "HR" ? hr : mode === "EMPLOYEE" ? self?.id === appraisal.employeeId : mode === "MANAGER" ? hr || (canManageAppraisals(user) && self?.id === appraisal.managerId) : hr || self?.id === appraisal.employeeId || self?.id === appraisal.managerId;
  if (!allowed) throw forbidden("Appraisal access is not permitted"); return { self, hr };
};
export const getAppraisalOverview = async (organizationId: string, user: AuthUser) => {
  if (!canApproveAppraisals(user)) throw forbidden("HR appraisal administration permission is required");
  const active = await prisma.appraisalCycle.findFirst({ where: { organizationId, status: "OPEN" }, orderBy: { periodStart: "desc" }, select: { id: true } });
  const where = { organizationId, ...(active ? { cycleId: active.id } : {}) };
  const [totalEmployees, completed, pendingHR, stageRows] = await Promise.all([prisma.employeeAppraisal.count({ where }), prisma.employeeAppraisal.count({ where: { ...where, status: "COMPLETED" } }), prisma.employeeAppraisal.count({ where: { ...where, stage: "HR_APPROVAL" } }), prisma.employeeAppraisal.groupBy({ by: ["stage"], where, _count: { _all: true } })]);
  let activeCycle = null; try { activeCycle = await getActiveAppraisalCycle(organizationId, user); } catch (error) { if (!(error instanceof Error) || !error.message.includes("No active appraisal cycle")) throw error; }
  return { analytics: { totalEmployees, completed, inProgress: Math.max(0, totalEmployees - completed), pendingHR }, activeCycle, workflow: Object.fromEntries(stageRows.map((row) => [row.stage, row._count._all])) };
};
export const getActiveAppraisalCycle = async (organizationId: string, user: AuthUser) => {
  if (!canApproveAppraisals(user)) throw forbidden("HR appraisal administration permission is required");
  const cycle = await prisma.appraisalCycle.findFirst({ where: { organizationId, status: "OPEN" }, orderBy: { periodStart: "desc" }, include: { template: true } });
  if (!cycle) throw notFound("No active appraisal cycle");
  const [total, acknowledged, stages] = await Promise.all([prisma.employeeAppraisal.count({ where: { organizationId, cycleId: cycle.id } }), prisma.employeeAppraisal.count({ where: { organizationId, cycleId: cycle.id, stage: "COMPLETED" } }), prisma.employeeAppraisal.groupBy({ by: ["stage"], where: { organizationId, cycleId: cycle.id }, _count: { _all: true } })]);
  const counts = new Map(stages.map((row) => [row.stage, row._count._all]));
  return { id: cycle.id, name: cycle.title, description: cycle.description, status: "ACTIVE", periodFrom: cycle.periodStart, periodTo: cycle.periodEnd, submissionDeadline: cycle.deadline ?? cycle.periodEnd, quarter: cycle.quarter, year: cycle.year, template: cycle.template && { id: cycle.template.id, name: cycle.template.name }, totalEmployees: total, acknowledgedEmployees: acknowledged, acknowledgedPercentage: total ? Math.round((acknowledged / total) * 10_000) / 100 : 0, progress: { acknowledged, totalEmployees: total, percentage: total ? Math.round((acknowledged / total) * 10_000) / 100 : 0 }, workflow: { goalsProposed: counts.get("GOAL_SETTING") ?? 0, selfAssessmentOpen: counts.get("SELF_ASSESSMENT") ?? 0, underManagerReview: counts.get("MANAGER_REVIEW") ?? 0, pendingHRApproval: counts.get("HR_APPROVAL") ?? 0, acknowledged } };
};
export const listAppraisals = async (organizationId: string, query: any, user: AuthUser) => {
  if (query.departmentId && !(await prisma.department.findFirst({ where: { id: query.departmentId, organizationId }, select: { id: true } }))) throw notFound("Department not found");
  if (query.cycleId && !(await prisma.appraisalCycle.findFirst({ where: { id: query.cycleId, organizationId }, select: { id: true } }))) throw notFound("Appraisal cycle not found");
  const self = await actorEmployee(organizationId, user.id);
  if (!canApproveAppraisals(user) && !self) throw forbidden("Authenticated user is not linked to an employee");
  const where: Prisma.EmployeeAppraisalWhereInput = { organizationId, ...(!canApproveAppraisals(user) ? { OR: [{ employeeId: self!.id }, { managerId: self!.id }] } : {}), ...(query.cycleId ? { cycleId: query.cycleId } : {}), ...(query.status ? { stage: query.status } : {}), employee: { ...(query.departmentId ? { departmentId: query.departmentId } : {}), ...employeeSearchWhere(query.search) }, cycle: { ...(query.quarter ? { quarter: query.quarter } : {}), ...(query.year ? { year: query.year } : {}) } };
  const [rows, total] = await Promise.all([prisma.employeeAppraisal.findMany({ where, include: { employee: { include: { department: true } }, manager: true, cycle: true, template: true }, orderBy: { updatedAt: "desc" }, skip: (query.page - 1) * query.limit, take: query.limit }), prisma.employeeAppraisal.count({ where })]);
  return { appraisals: rows.map((row) => ({ appraisalId: row.id, employee: { id: row.employee.id, employeeId: row.employee.employeeNo, name: `${row.employee.firstName} ${row.employee.lastName}`, role: row.employee.jobTitle }, department: row.employee.department && { id: row.employee.department.id, name: row.employee.department.name }, manager: row.manager && { id: row.manager.id, name: `${row.manager.firstName} ${row.manager.lastName}` }, cycle: { id: row.cycle.id, name: row.cycle.title }, template: { id: row.template.id, name: row.template.name }, stage: row.stage, status: row.status, score: row.finalScore == null ? null : Number(row.finalScore), ratingValue: row.ratingValue, rating: row.rating })), pagination: paginationResult(query.page, query.limit, total) };
};
export const getAppraisalDetail = async (organizationId: string, appraisalId: string, user: AuthUser) => {
  const appraisal = await getTenantAppraisal(organizationId, appraisalId); const access = await assertAppraisalAccess(organizationId, appraisal, user, "VIEW");
  return { appraisalId: appraisal.id, employee: { id: appraisal.employee.id, name: `${appraisal.employee.firstName} ${appraisal.employee.lastName}`, role: appraisal.employee.jobTitle, department: appraisal.employee.department?.name ?? null, manager: appraisal.manager ? { id: appraisal.manager.id, name: `${appraisal.manager.firstName} ${appraisal.manager.lastName}`, role: appraisal.manager.jobTitle } : null, startDate: appraisal.employee.hireDate, profileImage: appraisal.employee.profileImageUrl ?? appraisal.employee.user?.profileImageUrl }, cycle: { id: appraisal.cycle.id, name: appraisal.cycle.title }, template: { id: appraisal.template.id, name: appraisal.template.name }, stage: appraisal.stage, status: appraisal.status, finalScore: appraisal.finalScore == null ? null : Number(appraisal.finalScore), ratingValue: appraisal.ratingValue, rating: appraisal.rating, workflow: { goalSetting: appraisal.stage === "GOAL_SETTING" ? "IN_PROGRESS" : "LOCKED", selfAssessment: appraisal.selfAssessment?.status ?? "NOT_STARTED", managerReview: appraisal.managerReview?.status ?? "NOT_STARTED", hrApproval: appraisal.hrApproval?.decision ?? "NOT_STARTED", acknowledgment: appraisal.acknowledgedAt ? "ACKNOWLEDGED" : "NOT_STARTED" }, goals: appraisal.goals.map((goal) => ({ ...goal, employeeRatingLabel: goal.employeeRating ? ratingLabels[goal.employeeRating as keyof typeof ratingLabels] : null, managerRatingLabel: goal.managerRating ? ratingLabels[goal.managerRating as keyof typeof ratingLabels] : null })), selfAssessment: appraisal.selfAssessment, managerReview: appraisal.managerReview, hrApproval: access.hr ? appraisal.hrApproval : appraisal.hrApproval ? { decision: appraisal.hrApproval.decision, approvedAt: appraisal.hrApproval.approvedAt } : null, acknowledgedResponse: appraisal.acknowledgedResponse, signOffs: appraisal.signOffs };
};
export const createAppraisalGoal = async (organizationId: string, appraisalId: string, input: any, user: AuthUser) => {
  const appraisal = await getTenantAppraisal(organizationId, appraisalId); await assertAppraisalAccess(organizationId, appraisal, user, "MANAGER");
  if (appraisal.stage !== "GOAL_SETTING") throw conflict("Goal setting is locked for this appraisal");
  const targetDate = new Date(`${input.targetDate}T00:00:00.000Z`);
  if (targetDate < appraisal.cycle.periodStart || targetDate > (appraisal.cycle.deadline ?? appraisal.cycle.periodEnd)) throw badRequest("Goal target date must fall within the appraisal cycle");
  const goal = await prisma.appraisalGoal.create({ data: { organizationId, appraisalId, title: input.goalTitle, description: input.description, successCriteria: input.successCriteria, targetDate, createdById: user.id } });
  const recipients = await userIdsForEmployees(organizationId, [appraisal.employeeId]);
  const notification = await notifyHRISUsers({ organizationId, recipientUserIds: recipients, categoryKey: "record-updates", eventKey: `appraisal:${appraisal.id}:goal:${goal.id}:created`, type: "APPRAISAL_GOAL_PROPOSED", title: "New appraisal goal", message: `A new goal, “${goal.title}”, was added to your appraisal.`, metadata: { appraisalId: appraisal.id, goalId: goal.id } });
  await createAuditLog({ organizationId, actorUserId: user.id, action: "HRIS_APPRAISAL_GOAL_PROPOSED", resource: "APPRAISAL", resourceId: appraisal.id, summary: `Proposed appraisal goal: ${goal.title}`, metadata: { employeeId: appraisal.employeeId, goalId: goal.id, notification } }); return goal;
};
export const scoreAppraisalGoal = async (organizationId: string, appraisalId: string, goalId: string, input: any, user: AuthUser) => {
  const appraisal = await getTenantAppraisal(organizationId, appraisalId); const self = await actorEmployee(organizationId, user.id); const isEmployee = self?.id === appraisal.employeeId; const isManager = (self?.id === appraisal.managerId && canManageAppraisals(user)) || canApproveAppraisals(user);
  if (!isEmployee && !isManager) throw forbidden("Goal scoring is not permitted");
  const goal = await prisma.appraisalGoal.findFirst({ where: { id: goalId, appraisalId, organizationId } }); if (!goal) throw notFound("Appraisal goal not found");
  const structuralUpdate = [input.title, input.description, input.successCriteria, input.targetDate].some((value) => value !== undefined);
  if (structuralUpdate) { if (!isManager || appraisal.stage !== "GOAL_SETTING") throw conflict("Goal editing is locked"); if (input.targetDate) { const targetDate = appraisalDate(input.targetDate); if (targetDate < appraisal.cycle.periodStart || targetDate > (appraisal.cycle.deadline ?? appraisal.cycle.periodEnd)) throw badRequest("Goal target date must fall within the appraisal cycle"); } }
  else if (isEmployee && appraisal.stage !== "SELF_ASSESSMENT") throw conflict("Employee goal scoring is locked");
  else if (!isEmployee && appraisal.stage !== "MANAGER_REVIEW") throw conflict("Manager goal scoring is not open");
  const data = structuralUpdate ? { title: input.title, description: input.description, successCriteria: input.successCriteria, ...(input.targetDate ? { targetDate: appraisalDate(input.targetDate) } : {}) } : isEmployee ? { employeeRating: input.rating, employeeComment: input.comment, ...(input.status ? { status: input.status } : {}) } : { managerRating: input.rating, managerComment: input.comment };
  const updated = await prisma.appraisalGoal.update({ where: { id: goal.id }, data: data as any });
  await createAuditLog({ organizationId, actorUserId: user.id, action: structuralUpdate ? "HRIS_APPRAISAL_GOAL_UPDATED" : "HRIS_APPRAISAL_GOAL_SCORED", resource: "APPRAISAL", resourceId: appraisal.id, summary: structuralUpdate ? "Updated appraisal goal" : "Updated appraisal goal score", metadata: { employeeId: appraisal.employeeId, goalId, responder: isEmployee ? "EMPLOYEE" : "MANAGER", rating: input.rating, changedFields: structuralUpdate ? Object.keys(input) : undefined } }); return updated;
};
export const openAppraisalSelfAssessment = async (organizationId: string, appraisalId: string, user: AuthUser) => { const appraisal = await getTenantAppraisal(organizationId, appraisalId); await assertAppraisalAccess(organizationId, appraisal, user, "MANAGER"); if (appraisal.stage === "SELF_ASSESSMENT") return appraisal; if (appraisal.stage !== "GOAL_SETTING") throw conflict("Goal setting is already locked"); if (!appraisal.goals.length) throw conflict("At least one appraisal goal is required before opening self-assessment"); const updated = await prisma.employeeAppraisal.update({ where: { id: appraisal.id }, data: { stage: "SELF_ASSESSMENT" } }); const notification = await notifyHRISUsers({ organizationId, recipientUserIds: await userIdsForEmployees(organizationId, [appraisal.employeeId]), categoryKey: "approvals-requests", eventKey: `appraisal:${appraisal.id}:self-assessment:opened`, type: "APPRAISAL_SELF_ASSESSMENT_OPENED", title: "Self-assessment is open", message: `Your self-assessment for ${appraisal.cycle.title} is ready.`, metadata: { appraisalId: appraisal.id, employeeId: appraisal.employeeId } }); await createAuditLog({ organizationId, actorUserId: user.id, action: "HRIS_APPRAISAL_SELF_ASSESSMENT_OPENED", resource: "APPRAISAL", resourceId: appraisal.id, summary: "Opened employee self-assessment", metadata: { employeeId: appraisal.employeeId, notification } }); return updated; };
const templateQuestions = (configuration: Prisma.JsonValue) => { const config = configuration && typeof configuration === "object" && !Array.isArray(configuration) ? configuration as Record<string, unknown> : {}; return Array.isArray(config.reflectionQuestions) ? config.reflectionQuestions : []; };
const templateManagerQuestions = (configuration: Prisma.JsonValue) => { const config = configuration && typeof configuration === "object" && !Array.isArray(configuration) ? configuration as Record<string, unknown> : {}; return Array.isArray(config.managerReviewQuestions) ? config.managerReviewQuestions : []; };
export const getSelfAssessment = async (organizationId: string, appraisalId: string, user: AuthUser) => {
  const appraisal = await getTenantAppraisal(organizationId, appraisalId); await assertAppraisalAccess(organizationId, appraisal, user, "VIEW");
  const snapshot = appraisal.templateSnapshot ?? appraisal.cycle.templateSnapshot ?? appraisal.template.configuration;
  return { appraisalId, stage: appraisal.stage, quarter: appraisal.cycle.quarter, template: { id: appraisal.template.id, name: appraisal.template.name, configuration: snapshot }, reflectionQuestions: templateQuestions(snapshot), assessment: appraisal.selfAssessment, goals: appraisal.goals };
};
export const saveSelfAssessment = async (organizationId: string, appraisalId: string, input: any, user: AuthUser) => {
  const appraisal = await getTenantAppraisal(organizationId, appraisalId); await assertAppraisalAccess(organizationId, appraisal, user, "EMPLOYEE");
  if (appraisal.stage !== "SELF_ASSESSMENT") throw conflict("Self-assessment is not editable at the current stage");
  const snapshot = appraisal.templateSnapshot ?? appraisal.cycle.templateSnapshot ?? appraisal.template.configuration; const weighted = calculateWeightedAssessmentScore(input.sections); const validQuestionIds = new Set(templateQuestions(snapshot).map((question: any) => String(question.id)));
  if (validQuestionIds.size && input.reflections.some((response: any) => !validQuestionIds.has(response.questionId))) throw badRequest("Self-assessment contains an unsupported reflection question");
  const result = await prisma.$transaction(async (tx) => {
    const assessment = await tx.appraisalSelfAssessment.upsert({ where: { appraisalId }, create: { organizationId, appraisalId, status: input.submit ? "SUBMITTED" : "IN_PROGRESS", sections: weighted.sections, reflections: input.reflections, submittedAt: input.submit ? new Date() : null }, update: { status: input.submit ? "SUBMITTED" : "IN_PROGRESS", sections: weighted.sections, reflections: input.reflections, submittedAt: input.submit ? new Date() : null } });
    await tx.employeeAppraisal.update({ where: { id: appraisal.id }, data: { stage: input.submit ? "MANAGER_REVIEW" : "SELF_ASSESSMENT", finalScore: weighted.score, rating: performanceRatingForScore(weighted.score), ratingValue: performanceRatingValueForScore(weighted.score) } });
    if (input.submit) await tx.appraisalGoal.updateMany({ where: { organizationId, appraisalId }, data: { status: "LOCKED" } });
    return assessment;
  });
  const notification = input.submit ? await notifyHRISUsers({ organizationId, recipientUserIds: await userIdsForEmployees(organizationId, [appraisal.managerId]), categoryKey: "approvals-requests", eventKey: `appraisal:${appraisal.id}:self-assessment:submitted`, type: "APPRAISAL_SELF_ASSESSMENT_SUBMITTED", title: "Self-assessment ready for review", message: `${appraisal.employee.firstName} ${appraisal.employee.lastName} submitted a self-assessment for ${appraisal.cycle.title}.`, metadata: { appraisalId: appraisal.id, employeeId: appraisal.employeeId } }) : { attempted: 0, delivered: 0, failed: 0 };
  await createAuditLog({ organizationId, actorUserId: user.id, action: input.submit ? "HRIS_APPRAISAL_SELF_ASSESSMENT_SUBMITTED" : "HRIS_APPRAISAL_SELF_ASSESSMENT_SAVED", resource: "APPRAISAL", resourceId: appraisal.id, summary: input.submit ? "Submitted self-assessment" : "Saved self-assessment", metadata: { employeeId: appraisal.employeeId, score: weighted.score, notification } }); return { ...result, score: weighted.score, rating: performanceRatingForScore(weighted.score) };
};
export const getManagerReview = async (organizationId: string, appraisalId: string, user: AuthUser) => { const appraisal = await getTenantAppraisal(organizationId, appraisalId); await assertAppraisalAccess(organizationId, appraisal, user, "MANAGER"); if (!appraisal.selfAssessment) throw conflict("Employee self-assessment has not been submitted"); const snapshot = appraisal.templateSnapshot ?? appraisal.cycle.templateSnapshot ?? appraisal.template.configuration; return { appraisalId, stage: appraisal.stage, employeeAssessment: appraisal.selfAssessment, goals: appraisal.goals, reflectionQuestions: templateQuestions(snapshot), managerReviewQuestions: templateManagerQuestions(snapshot), review: appraisal.managerReview }; };
export const saveManagerReview = async (organizationId: string, appraisalId: string, input: any, user: AuthUser) => {
  const appraisal = await getTenantAppraisal(organizationId, appraisalId); const access = await assertAppraisalAccess(organizationId, appraisal, user, "MANAGER");
  if (appraisal.stage !== "MANAGER_REVIEW" || appraisal.selfAssessment?.status !== "SUBMITTED") throw conflict("Manager review is not open"); const managerId = access.self?.id ?? appraisal.managerId; if (!managerId) throw conflict("No manager is assigned to this appraisal");
  const goalIds = new Set(appraisal.goals.map((goal) => goal.id)); if (input.goalRatings.some((rating: any) => !goalIds.has(rating.goalId))) throw badRequest("Manager review contains an unsupported goal");
  const snapshot = appraisal.templateSnapshot ?? appraisal.cycle.templateSnapshot ?? appraisal.template.configuration; const managerQuestionIds = new Set(templateManagerQuestions(snapshot).map((question: any) => String(question.id))); if (managerQuestionIds.size && input.responses.some((response: any) => !managerQuestionIds.has(response.questionId))) throw badRequest("Manager review contains an unsupported question");
  const result = await prisma.$transaction(async (tx) => {
    for (const rating of input.goalRatings) await tx.appraisalGoal.update({ where: { id: rating.goalId }, data: { managerRating: rating.rating, managerComment: rating.comment } });
    const review = await tx.appraisalManagerReview.upsert({ where: { appraisalId }, create: { organizationId, appraisalId, managerId, status: input.submit ? "SUBMITTED" : "IN_PROGRESS", goalRatings: input.goalRatings, responses: input.responses, overallFeedback: input.overallFeedback, recommendation: input.recommendation, submittedAt: input.submit ? new Date() : null }, update: { managerId, status: input.submit ? "SUBMITTED" : "IN_PROGRESS", goalRatings: input.goalRatings, responses: input.responses, overallFeedback: input.overallFeedback, recommendation: input.recommendation, submittedAt: input.submit ? new Date() : null } });
    if (input.submit) { await tx.employeeAppraisal.update({ where: { id: appraisal.id }, data: { stage: "HR_APPROVAL" } }); await tx.appraisalSignOff.upsert({ where: { appraisalId_signOffType: { appraisalId: appraisal.id, signOffType: "MANAGER" } }, create: { organizationId, appraisalId: appraisal.id, signatoryUserId: user.id, signOffType: "MANAGER", signatoryRole: "MANAGER" }, update: {} }); } return review;
  });
  const notification = input.submit ? await notifyHRISUsers({ organizationId, recipientUserIds: await hrisApproverUserIds(organizationId, ["admin:staff:update", "admin:organization:update"]), categoryKey: "approvals-requests", eventKey: `appraisal:${appraisal.id}:manager-review:submitted`, type: "APPRAISAL_MANAGER_REVIEW_SUBMITTED", title: "Appraisal awaiting HR approval", message: `The manager review for ${appraisal.employee.firstName} ${appraisal.employee.lastName} in ${appraisal.cycle.title} is ready for HR approval.`, metadata: { appraisalId: appraisal.id, employeeId: appraisal.employeeId } }) : { attempted: 0, delivered: 0, failed: 0 };
  await createAuditLog({ organizationId, actorUserId: user.id, action: input.submit ? "HRIS_APPRAISAL_MANAGER_REVIEW_SUBMITTED" : "HRIS_APPRAISAL_MANAGER_REVIEW_SAVED", resource: "APPRAISAL", resourceId: appraisal.id, summary: input.submit ? "Submitted manager review" : "Saved manager review", metadata: { employeeId: appraisal.employeeId, recommendation: input.recommendation, notification } }); return result;
};
export const getHRApproval = async (organizationId: string, appraisalId: string, user: AuthUser) => { const appraisal = await getTenantAppraisal(organizationId, appraisalId); await assertAppraisalAccess(organizationId, appraisal, user, "HR"); if (!appraisal.managerReview) throw conflict("Manager review has not been submitted"); return { appraisalId, stage: appraisal.stage, employee: { id: appraisal.employee.id, name: `${appraisal.employee.firstName} ${appraisal.employee.lastName}` }, selfAssessment: appraisal.selfAssessment, managerReview: appraisal.managerReview, finalScore: appraisal.finalScore == null ? null : Number(appraisal.finalScore), rating: appraisal.rating, approval: appraisal.hrApproval }; };
export const approveAppraisalHR = async (organizationId: string, appraisalId: string, input: any, user: AuthUser) => {
  const appraisal = await getTenantAppraisal(organizationId, appraisalId); await assertAppraisalAccess(organizationId, appraisal, user, "HR");
  if (appraisal.stage !== "HR_APPROVAL" || appraisal.managerReview?.status !== "SUBMITTED") throw conflict("Appraisal is not awaiting HR approval");
  const nextStage = input.decision === "APPROVED" ? "ACKNOWLEDGMENT" : "MANAGER_REVIEW";
  const result = await prisma.$transaction(async (tx) => {
    const approval = await tx.appraisalHRApproval.upsert({ where: { appraisalId }, create: { organizationId, appraisalId, decision: input.decision, internalNotes: input.hrNotes, approvedById: user.id }, update: { decision: input.decision, internalNotes: input.hrNotes, approvedById: user.id, approvedAt: new Date() } });
    await tx.employeeAppraisal.update({ where: { id: appraisal.id }, data: { stage: nextStage } });
    if (input.decision === "APPROVED") await tx.appraisalSignOff.upsert({ where: { appraisalId_signOffType: { appraisalId: appraisal.id, signOffType: "HR" } }, create: { organizationId, appraisalId: appraisal.id, signatoryUserId: user.id, signOffType: "HR", signatoryRole: "HR" }, update: {} });
    if (input.decision === "RETURNED_FOR_REVIEW") await tx.appraisalManagerReview.update({ where: { appraisalId }, data: { status: "IN_PROGRESS", submittedAt: null } }); return approval;
  });
  const recipients = await userIdsForEmployees(organizationId, [input.decision === "APPROVED" ? appraisal.employeeId : appraisal.managerId]);
  const notification = await notifyHRISUsers({ organizationId, recipientUserIds: recipients, categoryKey: input.decision === "APPROVED" ? "record-updates" : "approvals-requests", eventKey: `appraisal:${appraisal.id}:hr:${input.decision.toLowerCase()}`, type: `APPRAISAL_HR_${input.decision}`, title: input.decision === "APPROVED" ? "Appraisal ready for acknowledgment" : "Appraisal returned for review", message: input.decision === "APPROVED" ? `Your ${appraisal.cycle.title} appraisal is ready for acknowledgment.` : `The ${appraisal.cycle.title} appraisal for ${appraisal.employee.firstName} ${appraisal.employee.lastName} was returned for manager review.`, metadata: { appraisalId: appraisal.id, employeeId: appraisal.employeeId, decision: input.decision } });
  await createAuditLog({ organizationId, actorUserId: user.id, action: input.decision === "APPROVED" ? "HRIS_APPRAISAL_HR_APPROVED" : "HRIS_APPRAISAL_HR_RETURNED", resource: "APPRAISAL", resourceId: appraisal.id, summary: input.decision === "APPROVED" ? "HR approved appraisal" : "HR returned appraisal for review", metadata: { employeeId: appraisal.employeeId, decision: input.decision, hasInternalNotes: Boolean(input.hrNotes), notification } }); return result;
};
export const acknowledgeAppraisal = async (organizationId: string, appraisalId: string, input: any, user: AuthUser) => {
  const appraisal = await getTenantAppraisal(organizationId, appraisalId); await assertAppraisalAccess(organizationId, appraisal, user, "EMPLOYEE");
  if (appraisal.stage === "COMPLETED" && appraisal.acknowledgedAt) return appraisal;
  if (appraisal.stage !== "ACKNOWLEDGMENT" || appraisal.hrApproval?.decision !== "APPROVED") throw conflict("Appraisal is not ready for employee acknowledgment");
  const changed = await prisma.$transaction(async (tx) => { const result = await tx.employeeAppraisal.updateMany({ where: { id: appraisal.id, organizationId, stage: "ACKNOWLEDGMENT", acknowledgedAt: null }, data: { stage: "COMPLETED", status: "COMPLETED", acknowledgedResponse: input.response, acknowledgedAt: new Date() } }); if (result.count === 1) await tx.appraisalSignOff.upsert({ where: { appraisalId_signOffType: { appraisalId: appraisal.id, signOffType: "EMPLOYEE" } }, create: { organizationId, appraisalId: appraisal.id, signatoryUserId: user.id, signOffType: "EMPLOYEE", signatoryRole: "EMPLOYEE" }, update: {} }); return result; });
  if (changed.count !== 1) throw conflict("Appraisal acknowledgment was completed concurrently");
  const updated = await getTenantAppraisal(organizationId, appraisal.id);
  const managerRecipients = await userIdsForEmployees(organizationId, [appraisal.managerId]);
  const notification = await notifyHRISUsers({ organizationId, recipientUserIds: managerRecipients, categoryKey: "record-updates", eventKey: `appraisal:${appraisal.id}:acknowledged`, type: "APPRAISAL_ACKNOWLEDGED", title: "Appraisal acknowledged", message: `${appraisal.employee.firstName} ${appraisal.employee.lastName} acknowledged the ${appraisal.cycle.title} appraisal.`, metadata: { appraisalId: appraisal.id, employeeId: appraisal.employeeId } });
  await createAuditLog({ organizationId, actorUserId: user.id, action: "HRIS_APPRAISAL_ACKNOWLEDGED", resource: "APPRAISAL", resourceId: appraisal.id, summary: "Employee acknowledged appraisal", metadata: { employeeId: appraisal.employeeId, notification } }); return updated;
};

const cycleApiStatus = (status: string) => status === "OPEN" ? "ACTIVE" : status === "CLOSED" || status === "ARCHIVED" ? "COMPLETED" : "DRAFT";
const cycleDbStatus = (status: string) => status === "ACTIVE" ? "OPEN" : status === "COMPLETED" ? "CLOSED" : "DRAFT";
const appraisalDate = (value: string) => new Date(`${value}T00:00:00.000Z`);
const quarterForDate = (date: Date) => `Q${Math.floor(date.getUTCMonth() / 3) + 1}`;

export const validateAppraisalTemplateConfiguration = (input: any) => {
  const sections = input.sections ?? [];
  if (sections.length !== 2 || new Set(sections.map((section: any) => section.section)).size !== 2) throw badRequest("Appraisal template requires one KRA and one BEHAVIOURAL section");
  const sectionWeight = sections.reduce((sum: number, section: any) => sum + section.weight, 0);
  if (Math.abs(sectionWeight - 100) > 0.001) throw badRequest("Appraisal template section weights must total 100");
  for (const section of sections) {
    const objectiveWeight = section.objectives.reduce((sum: number, objective: any) => sum + objective.weight, 0);
    if (Math.abs(objectiveWeight - section.weight) > 0.001) throw badRequest(`${section.section} objective weights must equal the section weight`);
    for (const objective of section.objectives) {
      const kpiWeight = objective.keyResults.reduce((sum: number, keyResult: any) => sum + keyResult.kpiWeight, 0);
      if (Math.abs(kpiWeight - objective.weight) > 0.001) throw badRequest(`KPI weights for ${objective.title} must equal the objective weight`);
    }
  }
  const withIds = sections.map((section: any) => ({ ...section, objectives: section.objectives.map((objective: any) => ({ ...objective, id: objective.id ?? crypto.randomUUID(), keyResults: objective.keyResults.map((keyResult: any) => ({ ...keyResult, id: keyResult.id ?? crypto.randomUUID() })) })) }));
  return { sections: withIds, reflectionQuestions: input.reflectionQuestions ?? [], managerReviewQuestions: input.managerReviewQuestions ?? [], quarterScoring: input.quarterScoring ?? true, signOffTypes: input.signOffTypes ?? ["EMPLOYEE", "MANAGER", "HR"], ratingScale: [{ value: 5, key: "OUTSTANDING", minimumExclusive: 120 }, { value: 4, key: "ABOVE_EXPECTATION", minimumExclusive: 100 }, { value: 3, key: "MEETS_EXPECTATION", minimum: 80 }, { value: 2, key: "BELOW_EXPECTATION", minimum: 60 }, { value: 1, key: "POOR_PERFORMANCE", minimum: 0 }] };
};

const assertAppraisalAdministrator = (user: AuthUser) => { if (!canApproveAppraisals(user) && !canManageAppraisals(user)) throw forbidden("Appraisal administration permission is required"); };
const templateSummary = (configuration: any) => {
  const sections = Array.isArray(configuration?.sections) ? configuration.sections : [];
  const section = (key: string) => sections.find((item: any) => item.section === key);
  const count = (item: any, field: "objectives" | "keyResults") => field === "objectives" ? (item?.objectives?.length ?? 0) : (item?.objectives ?? []).reduce((sum: number, objective: any) => sum + (objective.keyResults?.length ?? 0), 0);
  return { sectionAObjectives: count(section("KRA"), "objectives"), sectionAKeyResults: count(section("KRA"), "keyResults"), sectionBObjectives: count(section("BEHAVIOURAL"), "objectives"), sectionBKeyResults: count(section("BEHAVIOURAL"), "keyResults"), quarterScoring: configuration?.quarterScoring !== false };
};

export const listAppraisalTemplates = async (organizationId: string, query: any, user: AuthUser) => {
  assertAppraisalAdministrator(user);
  const where = { organizationId, ...(!query.includeArchived ? { archivedAt: null } : {}) };
  const [rows, total] = await Promise.all([prisma.appraisalTemplate.findMany({ where, orderBy: [{ isDefault: "desc" }, { name: "asc" }], skip: (query.page - 1) * query.limit, take: query.limit }), prisma.appraisalTemplate.count({ where })]);
  return { templates: rows.map((row) => ({ id: row.id, name: row.name, description: row.description, isDefault: row.isDefault, version: row.version, archivedAt: row.archivedAt, totalWeight: 100, summary: templateSummary(row.configuration) })), pagination: paginationResult(query.page, query.limit, total) };
};
export const getAppraisalTemplate = async (organizationId: string, templateId: string, user: AuthUser) => { assertAppraisalAdministrator(user); const row = await prisma.appraisalTemplate.findFirst({ where: { id: templateId, organizationId } }); if (!row) throw notFound("Appraisal template not found"); return row; };
export const createAppraisalTemplate = async (organizationId: string, input: any, user: AuthUser) => {
  assertAppraisalAdministrator(user); const configuration = validateAppraisalTemplateConfiguration(input);
  const row = await prisma.$transaction(async (tx) => { if (input.isDefault) await tx.appraisalTemplate.updateMany({ where: { organizationId, isDefault: true }, data: { isDefault: false } }); return tx.appraisalTemplate.create({ data: { organizationId, name: input.name, description: input.description, configuration, isDefault: input.isDefault } }); });
  await createAuditLog({ organizationId, actorUserId: user.id, action: "HRIS_APPRAISAL_TEMPLATE_CREATED", resource: "APPRAISAL_TEMPLATE", resourceId: row.id, summary: `Created appraisal template ${row.name}`, metadata: { isDefault: row.isDefault, version: row.version } }); return row;
};
export const updateAppraisalTemplate = async (organizationId: string, templateId: string, input: any, user: AuthUser) => {
  assertAppraisalAdministrator(user); const current = await prisma.appraisalTemplate.findFirst({ where: { id: templateId, organizationId, archivedAt: null } }); if (!current) throw notFound("Appraisal template not found");
  const currentConfig = current.configuration as any; const configuration = input.sections ? validateAppraisalTemplateConfiguration({ ...currentConfig, ...input }) : { ...currentConfig, reflectionQuestions: input.reflectionQuestions ?? currentConfig.reflectionQuestions, managerReviewQuestions: input.managerReviewQuestions ?? currentConfig.managerReviewQuestions, quarterScoring: input.quarterScoring ?? currentConfig.quarterScoring, signOffTypes: input.signOffTypes ?? currentConfig.signOffTypes };
  const updated = await prisma.$transaction(async (tx) => { if (input.isDefault) await tx.appraisalTemplate.updateMany({ where: { organizationId, isDefault: true, id: { not: current.id } }, data: { isDefault: false } }); return tx.appraisalTemplate.update({ where: { id: current.id }, data: { name: input.name, description: input.description, configuration, isDefault: input.isDefault, version: { increment: 1 } } }); });
  await createAuditLog({ organizationId, actorUserId: user.id, action: "HRIS_APPRAISAL_TEMPLATE_UPDATED", resource: "APPRAISAL_TEMPLATE", resourceId: updated.id, summary: `Updated appraisal template ${updated.name}`, metadata: { previousVersion: current.version, version: updated.version } }); return updated;
};
export const archiveAppraisalTemplate = async (organizationId: string, templateId: string, user: AuthUser) => { assertAppraisalAdministrator(user); const current = await prisma.appraisalTemplate.findFirst({ where: { id: templateId, organizationId, archivedAt: null } }); if (!current) throw notFound("Appraisal template not found"); const updated = await prisma.appraisalTemplate.update({ where: { id: current.id }, data: { archivedAt: new Date(), isDefault: false } }); await createAuditLog({ organizationId, actorUserId: user.id, action: "HRIS_APPRAISAL_TEMPLATE_ARCHIVED", resource: "APPRAISAL_TEMPLATE", resourceId: current.id, summary: `Archived appraisal template ${current.name}` }); return updated; };

const launchCycleTx = async (tx: Prisma.TransactionClient, organizationId: string, cycleId: string, templateId: string, templateSnapshot: Prisma.InputJsonValue, userId: string) => {
  const employees = await tx.employee.findMany({ where: { organizationId, status: { in: ["ACTIVE", "ON_LEAVE"] }, lifecycleStatus: { not: "EXITED" } }, select: { id: true, managerId: true } });
  if (employees.length) await tx.employeeAppraisal.createMany({ data: employees.map((employee) => ({ organizationId, employeeId: employee.id, managerId: employee.managerId, cycleId, templateId, templateSnapshot, stage: "GOAL_SETTING" as const, status: "IN_PROGRESS" as const })), skipDuplicates: true });
  await tx.appraisalCycle.update({ where: { id: cycleId }, data: { status: "OPEN", launchedAt: new Date(), launchedById: userId, templateSnapshot } });
  return employees.length;
};
export const createAppraisalCycle = async (organizationId: string, input: any, user: AuthUser) => {
  assertAppraisalAdministrator(user); const template = await prisma.appraisalTemplate.findFirst({ where: { id: input.templateId, organizationId, archivedAt: null } }); if (!template) throw notFound("Appraisal template not found");
  if (input.launchMode === "LAUNCH_AS_ACTIVE" && await prisma.appraisalCycle.findFirst({ where: { organizationId, status: "OPEN", periodStart: { lte: appraisalDate(input.periodTo) }, periodEnd: { gte: appraisalDate(input.periodFrom) } }, select: { id: true } })) throw conflict("An overlapping active appraisal cycle already exists");
  const snapshot = template.configuration as Prisma.InputJsonValue; let enrolled = 0;
  const cycle = await prisma.$transaction(async (tx) => { const created = await tx.appraisalCycle.create({ data: { organizationId, title: input.cycleName, description: input.description, periodStart: appraisalDate(input.periodFrom), periodEnd: appraisalDate(input.periodTo), deadline: appraisalDate(input.submissionDeadline), quarter: quarterForDate(appraisalDate(input.periodFrom)), year: appraisalDate(input.periodFrom).getUTCFullYear(), templateId: template.id, templateSnapshot: snapshot, status: input.launchMode === "LAUNCH_AS_ACTIVE" ? "OPEN" : "DRAFT" } }); if (input.launchMode === "LAUNCH_AS_ACTIVE") enrolled = await launchCycleTx(tx, organizationId, created.id, template.id, snapshot, user.id); return created; });
  await createAuditLog({ organizationId, actorUserId: user.id, action: input.launchMode === "LAUNCH_AS_ACTIVE" ? "HRIS_APPRAISAL_CYCLE_LAUNCHED" : "HRIS_APPRAISAL_CYCLE_CREATED", resource: "APPRAISAL_CYCLE", resourceId: cycle.id, summary: `${input.launchMode === "LAUNCH_AS_ACTIVE" ? "Launched" : "Created"} appraisal cycle ${cycle.title}`, metadata: { enrolledEmployees: enrolled, templateVersion: template.version } }); return { ...cycle, status: cycleApiStatus(cycle.status), enrolledEmployees: enrolled };
};
export const launchAppraisalCycle = async (organizationId: string, cycleId: string, user: AuthUser) => { assertAppraisalAdministrator(user); const cycle = await prisma.appraisalCycle.findFirst({ where: { id: cycleId, organizationId }, include: { template: true } }); if (!cycle) throw notFound("Appraisal cycle not found"); if (cycle.status === "OPEN") return { ...cycle, status: "ACTIVE", enrolledEmployees: await prisma.employeeAppraisal.count({ where: { organizationId, cycleId } }) }; if (cycle.status !== "DRAFT" || !cycle.template || cycle.template.archivedAt) throw conflict("Only a draft cycle with an active template can be launched"); if (await prisma.appraisalCycle.findFirst({ where: { organizationId, status: "OPEN", id: { not: cycle.id }, periodStart: { lte: cycle.periodEnd }, periodEnd: { gte: cycle.periodStart } }, select: { id: true } })) throw conflict("An overlapping active appraisal cycle already exists"); const snapshot = (cycle.templateSnapshot ?? cycle.template.configuration) as Prisma.InputJsonValue; const enrolledEmployees = await prisma.$transaction((tx) => launchCycleTx(tx, organizationId, cycle.id, cycle.template!.id, snapshot, user.id)); await createAuditLog({ organizationId, actorUserId: user.id, action: "HRIS_APPRAISAL_CYCLE_LAUNCHED", resource: "APPRAISAL_CYCLE", resourceId: cycle.id, summary: `Launched appraisal cycle ${cycle.title}`, metadata: { enrolledEmployees, templateVersion: cycle.template.version } }); return { ...cycle, status: "ACTIVE", enrolledEmployees };
};
export const completeAppraisalCycle = async (organizationId: string, cycleId: string, user: AuthUser) => { assertAppraisalAdministrator(user); const cycle = await prisma.appraisalCycle.findFirst({ where: { id: cycleId, organizationId } }); if (!cycle) throw notFound("Appraisal cycle not found"); if (cycle.status === "CLOSED") return { ...cycle, status: "COMPLETED" }; if (cycle.status !== "OPEN") throw conflict("Only an active appraisal cycle can be completed"); const [total, incomplete] = await Promise.all([prisma.employeeAppraisal.count({ where: { organizationId, cycleId } }), prisma.employeeAppraisal.count({ where: { organizationId, cycleId, status: { not: "COMPLETED" } } })]); if (!total || incomplete) throw conflict("Every appraisal must be acknowledged before the cycle can be completed"); const updated = await prisma.appraisalCycle.update({ where: { id: cycle.id }, data: { status: "CLOSED" } }); await createAuditLog({ organizationId, actorUserId: user.id, action: "HRIS_APPRAISAL_CYCLE_COMPLETED", resource: "APPRAISAL_CYCLE", resourceId: cycle.id, summary: `Completed appraisal cycle ${cycle.title}`, metadata: { totalAppraisals: total } }); return { ...updated, status: "COMPLETED" };
};
export const listAppraisalCycles = async (organizationId: string, query: any, user: AuthUser) => { assertAppraisalAdministrator(user); const where: Prisma.AppraisalCycleWhereInput = { organizationId, ...(query.status !== "ALL" ? { status: cycleDbStatus(query.status) as any } : {}) }; const [rows, total] = await Promise.all([prisma.appraisalCycle.findMany({ where, include: { template: { select: { id: true, name: true } } }, orderBy: { periodStart: "desc" }, skip: (query.page - 1) * query.limit, take: query.limit }), prisma.appraisalCycle.count({ where })]); const cycleIds = rows.map((row) => row.id); const [totals, completed] = await Promise.all([prisma.employeeAppraisal.groupBy({ by: ["cycleId"], where: { organizationId, cycleId: { in: cycleIds } }, _count: { _all: true } }), prisma.employeeAppraisal.groupBy({ by: ["cycleId"], where: { organizationId, cycleId: { in: cycleIds }, status: "COMPLETED" }, _count: { _all: true } })]); const totalMap = new Map(totals.map((row) => [row.cycleId, row._count._all])); const completedMap = new Map(completed.map((row) => [row.cycleId, row._count._all])); return { cycles: rows.map((row) => { const totalEmployees = totalMap.get(row.id) ?? 0; const acknowledged = completedMap.get(row.id) ?? 0; return { id: row.id, name: row.title, description: row.description, status: cycleApiStatus(row.status), template: row.template, periodFrom: row.periodStart, periodTo: row.periodEnd, submissionDeadline: row.deadline, progress: { acknowledged, totalEmployees, percentage: totalEmployees ? Math.round(acknowledged / totalEmployees * 10_000) / 100 : 0 } }; }), pagination: paginationResult(query.page, query.limit, total) }; };
export const deleteAppraisalCycle = async (organizationId: string, cycleId: string, user: AuthUser) => { assertAppraisalAdministrator(user); const cycle = await prisma.appraisalCycle.findFirst({ where: { id: cycleId, organizationId }, select: { id: true, title: true } }); if (!cycle) throw notFound("Appraisal cycle not found"); const deletedAppraisals = await prisma.employeeAppraisal.count({ where: { organizationId, cycleId } }); await prisma.appraisalCycle.delete({ where: { id: cycle.id } }); await createAuditLog({ organizationId, actorUserId: user.id, action: "HRIS_APPRAISAL_CYCLE_DELETED", resource: "APPRAISAL_CYCLE", resourceId: cycle.id, summary: `Permanently deleted appraisal cycle ${cycle.title}`, metadata: { deletedAppraisals } }); return { id: cycle.id, deleted: true, deletedAppraisals }; };
export const getAppraisalSettings = async (organizationId: string, user: AuthUser) => { assertAppraisalAdministrator(user); return (await prisma.appraisalSetting.findUnique({ where: { organizationId } })) ?? { organizationId, defaultReviewFrequency: "QUARTERLY" }; };
export const updateAppraisalSettings = async (organizationId: string, input: any, user: AuthUser) => { assertAppraisalAdministrator(user); const previous = await prisma.appraisalSetting.findUnique({ where: { organizationId } }); const updated = await prisma.appraisalSetting.upsert({ where: { organizationId }, create: { organizationId, defaultReviewFrequency: input.defaultReviewFrequency, updatedById: user.id }, update: { defaultReviewFrequency: input.defaultReviewFrequency, updatedById: user.id } }); await createAuditLog({ organizationId, actorUserId: user.id, action: "HRIS_APPRAISAL_SETTINGS_UPDATED", resource: "APPRAISAL_SETTING", resourceId: updated.id, summary: "Updated appraisal settings", metadata: { previousFrequency: previous?.defaultReviewFrequency ?? "QUARTERLY", defaultReviewFrequency: updated.defaultReviewFrequency } }); return updated; };
export const signOffAppraisal = async (organizationId: string, appraisalId: string, input: any, user: AuthUser) => { const appraisal = await getTenantAppraisal(organizationId, appraisalId); const self = await actorEmployee(organizationId, user.id); const hr = canApproveAppraisals(user); const permitted = input.signOffType === "EMPLOYEE" ? self?.id === appraisal.employeeId && appraisal.stage === "COMPLETED" : input.signOffType === "MANAGER" ? self?.id === appraisal.managerId && ["HR_APPROVAL", "ACKNOWLEDGMENT", "COMPLETED"].includes(appraisal.stage) : hr && ["ACKNOWLEDGMENT", "COMPLETED"].includes(appraisal.stage); if (!permitted) throw forbidden("Appraisal sign-off is not permitted at the current stage"); const signOff = await prisma.appraisalSignOff.upsert({ where: { appraisalId_signOffType: { appraisalId, signOffType: input.signOffType } }, create: { organizationId, appraisalId, signatoryUserId: user.id, signOffType: input.signOffType, signatoryRole: input.signOffType }, update: {} }); await createAuditLog({ organizationId, actorUserId: user.id, action: "HRIS_APPRAISAL_SIGNED_OFF", resource: "APPRAISAL", resourceId: appraisalId, summary: `${input.signOffType} signed off appraisal`, metadata: { signOffType: input.signOffType, employeeId: appraisal.employeeId } }); return signOff; };

const conductQueryStatuses = new Set(["IN_PROGRESS", "RESOLVED", "DISMISSED"]); const suspensionStatuses = new Set(["ACTIVE", "COMPLETED", "CANCELLED"]);
const assertConductManager = (user: AuthUser) => { if (!user.permissions.includes("hris:conduct:update") && !user.permissions.includes("admin:staff:update")) throw forbidden("Conduct management permission is required"); };
const conductDateRange = (date?: string) => date ? { gte: appraisalDate(date), lt: new Date(appraisalDate(date).getTime() + DAY_MS) } : undefined;
export const getConductOverview = async (organizationId: string, user: AuthUser) => { assertConductManager(user); const [totalQueries, activeSuspensions, inProgress] = await Promise.all([prisma.conductLog.count({ where: { organizationId, type: "QUERY" } }), prisma.conductLog.count({ where: { organizationId, type: "SUSPENSION", status: "ACTIVE" } }), prisma.conductLog.count({ where: { organizationId, status: "IN_PROGRESS" } })]); return { totalQueries, activeSuspensions, inProgress }; };
export const listConductRecords = async (organizationId: string, query: any, user: AuthUser) => { assertConductManager(user); if (query.departmentId && !await prisma.department.findFirst({ where: { id: query.departmentId, organizationId }, select: { id: true } })) throw notFound("Department not found"); const where: Prisma.ConductLogWhereInput = { organizationId, ...(query.type !== "ALL" ? { type: query.type } : {}), ...(query.employeeId ? { employeeId: query.employeeId } : {}), ...(query.status ? { status: query.status } : {}), ...(query.date ? { incidentDate: conductDateRange(query.date) } : {}), ...(query.departmentId ? { employee: { departmentId: query.departmentId } } : {}) }; const [rows, total] = await Promise.all([prisma.conductLog.findMany({ where, include: { employee: { include: { department: true } } }, orderBy: { incidentDate: "desc" }, skip: (query.page - 1) * query.limit, take: query.limit }), prisma.conductLog.count({ where })]); return { records: rows.map((row) => ({ id: row.id, type: row.type, employee: { id: row.employee.id, employeeId: row.employee.employeeNo, name: `${row.employee.firstName} ${row.employee.lastName}`, role: row.employee.jobTitle }, department: row.employee.department && { id: row.employee.department.id, name: row.employee.department.name }, queryType: row.category, status: row.status, date: row.incidentDate, duration: row.type === "SUSPENSION" ? { value: row.durationValue, unit: row.durationUnit, startDate: row.startDate, endDate: row.endDate } : null, notes: row.notes ?? row.details })), pagination: paginationResult(query.page, query.limit, total) }; };
export const getConductRecord = async (organizationId: string, conductId: string, user: AuthUser) => { assertConductManager(user); const row = await prisma.conductLog.findFirst({ where: { id: conductId, organizationId }, include: { employee: { include: { department: true } } } }); if (!row) throw notFound("Conduct record not found"); return row; };
export const createConductQuery = async (organizationId: string, input: any, user: AuthUser) => { assertConductManager(user); const employee = await prisma.employee.findFirst({ where: { id: input.employeeId, organizationId }, include: { user: { select: { id: true } } } }); if (!employee) throw notFound("Employee not found"); const row = await prisma.conductLog.create({ data: { organizationId, employeeId: employee.id, type: "QUERY", category: input.queryType, status: input.status, summary: `${input.queryType} query`, details: input.notes, notes: input.notes, incidentDate: new Date(), createdById: user.id, ...(input.status !== "IN_PROGRESS" ? { resolvedById: user.id, resolvedAt: new Date() } : {}) } }); const notification = await notifyHRISUsers({ organizationId, recipientUserIds: employee.user ? [employee.user.id] : [], categoryKey: "record-updates", eventKey: `conduct:${row.id}:issued`, type: "CONDUCT_QUERY_ISSUED", title: "Employee conduct query issued", message: `A ${input.queryType.toLowerCase().replaceAll("_", " ")} query has been added to your employee record.`, metadata: { conductId: row.id, employeeId: employee.id } }); await createAuditLog({ organizationId, actorUserId: user.id, action: "HRIS_CONDUCT_QUERY_CREATED", resource: "CONDUCT", resourceId: row.id, summary: `Created conduct query for ${employee.firstName} ${employee.lastName}`, metadata: { employeeId: employee.id, category: input.queryType, status: input.status, notification } }); return row; };
const durationEnd = (start: Date, value: number, unit: string) => { const end = new Date(start); if (unit === "DAY") end.setUTCDate(end.getUTCDate() + value); else if (unit === "WEEK") end.setUTCDate(end.getUTCDate() + value * 7); else end.setUTCMonth(end.getUTCMonth() + value); return end; };
export const createSuspension = async (organizationId: string, input: any, user: AuthUser) => { assertConductManager(user); const employee = await prisma.employee.findFirst({ where: { id: input.employeeId, organizationId }, include: { user: { select: { id: true } } } }); if (!employee) throw notFound("Employee not found"); if (input.status === "ACTIVE" && await prisma.conductLog.findFirst({ where: { organizationId, employeeId: employee.id, type: "SUSPENSION", status: "ACTIVE" }, select: { id: true } })) throw conflict("Employee already has an active suspension"); const startDate = input.startDate ? appraisalDate(input.startDate) : new Date(); const endDate = durationEnd(startDate, input.durationValue, input.durationUnit); const row = await prisma.$transaction(async (tx) => { const created = await tx.conductLog.create({ data: { organizationId, employeeId: employee.id, type: "SUSPENSION", category: input.queryType, status: input.status, summary: `${input.queryType} suspension`, details: input.notes, notes: input.notes, durationValue: input.durationValue, durationUnit: input.durationUnit, startDate, endDate, incidentDate: startDate, previousEmployeeStatus: input.status === "ACTIVE" ? employee.status : null, createdById: user.id } }); if (input.status === "ACTIVE") { await tx.employee.update({ where: { id: employee.id }, data: { status: "SUSPENDED" } }); await tx.employeeStatusHistory.create({ data: { organizationId, employeeId: employee.id, previousOperationalStatus: employee.status, newOperationalStatus: "SUSPENDED", previousLifecycleStatus: employee.lifecycleStatus, newLifecycleStatus: employee.lifecycleStatus, effectiveDate: startDate, changedById: user.id } }); } return created; }); const notification = await notifyHRISUsers({ organizationId, recipientUserIds: employee.user ? [employee.user.id] : [], categoryKey: "record-updates", eventKey: `conduct:${row.id}:suspension:${input.status.toLowerCase()}`, type: "SUSPENSION_ISSUED", title: "Employment suspension recorded", message: `A suspension related to ${input.queryType.toLowerCase().replaceAll("_", " ")} has been recorded from ${startDate.toISOString().slice(0, 10)}.`, metadata: { conductId: row.id, employeeId: employee.id, status: input.status } }); await createAuditLog({ organizationId, actorUserId: user.id, action: "HRIS_SUSPENSION_CREATED", resource: "CONDUCT", resourceId: row.id, summary: `Created suspension for ${employee.firstName} ${employee.lastName}`, metadata: { employeeId: employee.id, previousStatus: employee.status, status: input.status, notification } }); return row; };
export const updateConductStatus = async (organizationId: string, conductId: string, input: any, user: AuthUser) => { assertConductManager(user); const current = await prisma.conductLog.findFirst({ where: { id: conductId, organizationId }, include: { employee: { include: { user: { select: { id: true } } } } } }); if (!current) throw notFound("Conduct record not found"); const allowed = current.type === "QUERY" ? conductQueryStatuses : suspensionStatuses; if (!allowed.has(input.status)) throw badRequest(`Status is invalid for a ${current.type.toLowerCase()} record`); const validTransition = current.type === "QUERY" ? current.status === "IN_PROGRESS" && ["RESOLVED", "DISMISSED"].includes(input.status) : current.status === "ACTIVE" && ["COMPLETED", "CANCELLED"].includes(input.status); if (current.status === input.status) return current; if (!validTransition) throw conflict(`Cannot transition ${current.type.toLowerCase()} from ${current.status} to ${input.status}`); const updated = await prisma.$transaction(async (tx) => { const row = await tx.conductLog.update({ where: { id: current.id }, data: { status: input.status, resolvedById: user.id, resolvedAt: new Date(), ...(input.note ? { notes: input.note, details: input.note } : {}) } }); if (current.type === "SUSPENSION" && current.status === "ACTIVE") { const otherActive = await tx.conductLog.count({ where: { organizationId, employeeId: current.employeeId, type: "SUSPENSION", status: "ACTIVE", id: { not: current.id } } }); if (!otherActive && current.employee.status === "SUSPENDED") { const restore = current.previousEmployeeStatus && current.previousEmployeeStatus !== "SUSPENDED" ? current.previousEmployeeStatus : "ACTIVE"; await tx.employee.update({ where: { id: current.employeeId }, data: { status: restore } }); await tx.employeeStatusHistory.create({ data: { organizationId, employeeId: current.employeeId, previousOperationalStatus: current.employee.status, newOperationalStatus: restore, previousLifecycleStatus: current.employee.lifecycleStatus, newLifecycleStatus: current.employee.lifecycleStatus, effectiveDate: new Date(), changedById: user.id } }); } } return row; }); const notification = await notifyHRISUsers({ organizationId, recipientUserIds: current.employee.user ? [current.employee.user.id] : [], categoryKey: "record-updates", eventKey: `conduct:${current.id}:status:${input.status.toLowerCase()}`, type: "CONDUCT_STATUS_UPDATED", title: "Conduct record updated", message: `Your ${current.type.toLowerCase()} record is now ${input.status.toLowerCase().replaceAll("_", " ")}.`, metadata: { conductId: current.id, employeeId: current.employeeId, status: input.status } }); await createAuditLog({ organizationId, actorUserId: user.id, action: current.type === "SUSPENSION" ? "HRIS_SUSPENSION_STATUS_UPDATED" : "HRIS_CONDUCT_QUERY_STATUS_UPDATED", resource: "CONDUCT", resourceId: current.id, summary: `Updated ${current.type.toLowerCase()} status to ${input.status}`, metadata: { employeeId: current.employeeId, previousStatus: current.status, newStatus: input.status, notification } }); return updated; };

export const listBankDetailsUpdateRequests = async (organizationId: string, query: any) => {
  const where: Prisma.BankDetailsUpdateRequestWhereInput = { organizationId, ...(query.status !== "ALL" ? { status: query.status } : {}) };
  const [rows, total] = await Promise.all([prisma.bankDetailsUpdateRequest.findMany({ where, include: { employee: { select: { id: true, employeeNo: true, firstName: true, lastName: true, department: { select: { id: true, name: true } } } } }, orderBy: { submittedAt: "desc" }, skip: (query.page - 1) * query.limit, take: query.limit }), prisma.bankDetailsUpdateRequest.count({ where })]);
  return { records: rows.map((row) => { const current = auditMetadata(row.currentBankSnapshot); return { id: row.id, employee: { id: row.employee.id, employeeId: row.employee.employeeNo, name: `${row.employee.firstName} ${row.employee.lastName}`, department: row.employee.department }, currentBank: { bankCode: current.bankCode ?? null, bankName: current.bankName ?? null, accountName: current.accountName ?? null, accountType: current.accountType ?? null, accountNumberMasked: maskAccount(typeof current.accountNumber === "string" ? current.accountNumber : null) }, proposedBank: { bankCode: row.proposedBankCode, bankName: row.proposedBankName, accountName: row.proposedAccountName, accountType: row.proposedAccountType, accountNumberMasked: maskAccount(row.proposedAccountNumber) }, reason: row.reason, status: row.status, submittedAt: row.submittedAt, reviewedAt: row.reviewedAt }; }), pagination: paginationResult(query.page, query.limit, total) };
};

export const reviewBankDetailsUpdateRequest = async (organizationId: string, requestId: string, decision: "APPROVED" | "REJECTED", reviewNote: string | undefined, user: AuthUser) => {
  const existing = await prisma.bankDetailsUpdateRequest.findFirst({ where: { id: requestId, organizationId }, include: { employee: { include: { user: { select: { id: true } } } } } });
  if (!existing) throw notFound("Bank details update request not found");
  if (existing.status !== "PENDING") throw conflict("Bank details update request has already been reviewed");
  const reviewedAt = new Date();
  const updated = await prisma.$transaction(async (tx) => {
    const changed = await tx.bankDetailsUpdateRequest.updateMany({ where: { id: existing.id, organizationId, status: "PENDING" }, data: { status: decision, pendingKey: null, reviewedById: user.id, reviewedAt, reviewNote } });
    if (changed.count !== 1) throw conflict("Bank details update request was reviewed concurrently");
    if (decision === "APPROVED") await tx.employee.update({ where: { id: existing.employeeId }, data: { bankCode: existing.proposedBankCode, bankName: existing.proposedBankName, bankAccountNumber: existing.proposedAccountNumber, bankAccountName: existing.proposedAccountName, bankAccountType: existing.proposedAccountType } });
    return tx.bankDetailsUpdateRequest.findUniqueOrThrow({ where: { id: existing.id } });
  });
  const notification = await notifyHRISUsers({ organizationId, recipientUserIds: existing.employee.user ? [existing.employee.user.id] : [], categoryKey: "record-updates", eventKey: `bank-update:${existing.id}:${decision.toLowerCase()}`, type: `EMPLOYEE_BANK_UPDATE_${decision}`, title: `Bank details update request ${decision.toLowerCase()}`, message: decision === "APPROVED" ? "Your bank details update request was approved and your bank details were updated." : "Your bank details update request was rejected.", metadata: { requestId: existing.id, employeeId: existing.employeeId, decision } });
  await createAuditLog({ organizationId, actorUserId: user.id, action: `HRIS_BANK_UPDATE_REQUEST_${decision}`, resource: "BANK_DETAILS_UPDATE_REQUEST", resourceId: existing.id, summary: `${decision === "APPROVED" ? "Approved" : "Rejected"} employee bank details update request`, metadata: { employeeId: existing.employeeId, decision, previousMaskedAccountNumber: maskAccount(existing.employee.bankAccountNumber), proposedMaskedAccountNumber: maskAccount(existing.proposedAccountNumber), hasReviewNote: Boolean(reviewNote), notification } });
  return { id: updated.id, employeeId: updated.employeeId, status: updated.status, reviewedAt: updated.reviewedAt };
};
