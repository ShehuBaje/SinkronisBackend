import { Prisma } from "@prisma/client";
import { env } from "../../config/env";
import { prisma } from "../../core/prisma";
import { badRequest, conflict, forbidden, notFound } from "../../core/http-error";
import { createObjectKey, deleteObject, readObject, uploadObject } from "../../core/object-storage";
import { createAuditLog } from "../admin/admin.audit";
import { deliverUserNotification } from "../../core/notifications";
import type { AuthUser } from "../../types";
import { isOrganizationModuleEnabled } from "../billing/module-access.service";
import { applyForLeave, classifyAttendance, createAttendanceDispute, shiftDateKey, tenantDateKey, zonedDateTimeToUtc } from "../hris/hris.service";
import type { BankUpdateRequestInput, EmployeeActionItemStatus, EmployeeAttendanceDisputeInput, EmployeeDashboard, EmployeeDocumentMetadata, EmployeeLeaveRequestInput, PayslipComponent, UpdateEmployeePersonalDetailsInput } from "./employee.interface";

const DEFAULT_TIME_ZONE = "Africa/Lagos";
const defaultSchedule = { monday: true, tuesday: true, wednesday: true, thursday: true, friday: true, saturday: false, sunday: false, workStartTime: "09:00", workEndTime: "17:00", breakDurationMinutes: 60 };
type Schedule = typeof defaultSchedule;

const safeTimeZone = (value?: string | null) => { const candidate = value || DEFAULT_TIME_ZONE; try { new Intl.DateTimeFormat("en-US", { timeZone: candidate }).format(); return candidate; } catch { return DEFAULT_TIME_ZONE; } };
export const isDashboardWorkday = (dateKey: string, schedule: Schedule) => [schedule.sunday, schedule.monday, schedule.tuesday, schedule.wednesday, schedule.thursday, schedule.friday, schedule.saturday][new Date(`${dateKey}T00:00:00.000Z`).getUTCDay()] ?? false;
export const expectedWorkdaysThrough = (month: string, throughDate: string, schedule: Schedule, approvedLeaveDates: ReadonlySet<string>) => { let key = `${month}-01`; let count = 0; while (key <= throughDate && key.startsWith(month)) { if (isDashboardWorkday(key, schedule) && !approvedLeaveDates.has(key)) count += 1; key = shiftDateKey(key, 1); } return count; };
export const dashboardAttendanceState = (attendance: { clockInAt: Date; clockOutAt: Date | null } | null, now: Date) => { if (!attendance) return { status: "NOT_CLOCKED_IN" as const, clockInAt: null, clockOutAt: null, workedMinutes: 0, canClockIn: true, canClockOut: false }; const end = attendance.clockOutAt ?? now; const workedMinutes = Math.max(0, Math.floor((end.getTime() - attendance.clockInAt.getTime()) / 60_000)); return { status: attendance.clockOutAt ? "CLOCKED_OUT" as const : "CLOCKED_IN" as const, clockInAt: attendance.clockInAt, clockOutAt: attendance.clockOutAt, workedMinutes, canClockIn: false, canClockOut: !attendance.clockOutAt }; };

const metadataObject = (value: Prisma.JsonValue | null): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const notificationStatus = (type: string): EmployeeActionItemStatus => type.includes("REJECTED") ? "REJECTED" : type.includes("APPROVED") ? "APPROVED" : type.includes("OPENED") || type.includes("READY") || type.includes("PROPOSED") ? "ACTION_REQUIRED" : "INFORMATIONAL";
export const actionItemPriority = (item: { status: string; dueDate: Date | null }, now: Date) => item.status === "ACTION_REQUIRED" && item.dueDate && item.dueDate < now ? 0 : item.status === "ACTION_REQUIRED" ? 1 : item.status === "UPCOMING" ? 2 : 3;

export const getEmployeeDashboard = async (organizationId: string, user: AuthUser, now = new Date()): Promise<EmployeeDashboard> => {
  const employee = await prisma.employee.findFirst({ where: { organizationId, user: { id: user.id, organizationId } }, select: { id: true, employeeNo: true, firstName: true, lastName: true, jobTitle: true, department: { select: { id: true, name: true } } } });
  if (!employee) throw notFound("Authenticated user is not linked to an employee");
  const [settings, persistedSchedule, organization, payrollEnabled] = await Promise.all([
    prisma.organizationGeneralSettings.findUnique({ where: { organizationId }, select: { timeZone: true, currency: true } }), prisma.workSchedule.findUnique({ where: { organizationId } }),
    prisma.organization.findUnique({ where: { id: organizationId }, select: { currency: true } }), isOrganizationModuleEnabled(organizationId, "payroll")
  ]);
  const timeZone = safeTimeZone(settings?.timeZone); const currentDate = tenantDateKey(now, timeZone); const month = currentDate.slice(0, 7); const year = Number(currentDate.slice(0, 4)); const schedule: Schedule = persistedSchedule ?? defaultSchedule;
  const monthStart = zonedDateTimeToUtc(`${month}-01`, "00:00", timeZone); const tomorrowStart = zonedDateTimeToUtc(shiftDateKey(currentDate, 1), "00:00", timeZone); const todayStart = zonedDateTimeToUtc(currentDate, "00:00", timeZone);
  const [todayAttendance, monthAttendance, annualBalance, approvedLeaves, notifications, latestPayslip, nextPayrollRun] = await Promise.all([
    prisma.attendance.findFirst({ where: { organizationId, employeeId: employee.id, clockInAt: { gte: todayStart, lt: tomorrowStart } }, orderBy: { clockInAt: "desc" }, select: { clockInAt: true, clockOutAt: true } }),
    prisma.attendance.findMany({ where: { organizationId, employeeId: employee.id, clockInAt: { gte: monthStart, lt: tomorrowStart } }, select: { clockInAt: true } }),
    prisma.leaveBalance.findFirst({ where: { organizationId, employeeId: employee.id, leaveTypeCode: { in: ["ANNUAL", "ANNUAL_LEAVE"] }, year }, orderBy: { leaveTypeCode: "asc" } }),
    prisma.leaveRequest.findMany({ where: { organizationId, employeeId: employee.id, status: "APPROVED", startDate: { lt: tomorrowStart }, endDate: { gte: monthStart } }, select: { startDate: true, endDate: true } }),
    prisma.userNotification.findMany({ where: { organizationId, recipientUserId: user.id, category: { moduleKey: "hris" } }, orderBy: { createdAt: "desc" }, take: 20, select: { id: true, type: true, title: true, message: true, metadata: true, createdAt: true } }),
    payrollEnabled ? prisma.payslip.findFirst({ where: { organizationId, employeeId: employee.id, payrollrun: { status: { in: ["APPROVED", "PAID"] } } }, orderBy: [{ payrollrun: { periodEnd: "desc" } }, { createdAt: "desc" }], include: { payrollrun: true } }) : Promise.resolve(null),
    payrollEnabled ? prisma.payrollRun.findFirst({ where: { organizationId, payDate: { gte: now }, status: { not: "CANCELLED" } }, orderBy: { payDate: "asc" }, select: { payDate: true, periodStart: true } }) : Promise.resolve(null)
  ]);
  const approvedLeaveDates = new Set<string>(); for (const leave of approvedLeaves) { let key = tenantDateKey(leave.startDate, timeZone); const end = tenantDateKey(leave.endDate, timeZone); while (key <= end && key <= currentDate) { approvedLeaveDates.add(key); key = shiftDateKey(key, 1); } }
  const presentDays = new Set(monthAttendance.map((row) => tenantDateKey(row.clockInAt, timeZone))).size; const expectedWorkingDays = expectedWorkdaysThrough(month, currentDate, schedule, approvedLeaveDates); const baseAttendanceToday = dashboardAttendanceState(todayAttendance, now);
  const attendanceToday = !todayAttendance && approvedLeaveDates.has(currentDate) ? { ...baseAttendanceToday, status: "ON_LEAVE" as const, canClockIn: false } : !todayAttendance && !isDashboardWorkday(currentDate, schedule) ? { ...baseAttendanceToday, status: "NON_WORKING_DAY" as const, canClockIn: false } : baseAttendanceToday;
  const actionItems = notifications.map((notification) => { const metadata = metadataObject(notification.metadata); const status = notificationStatus(notification.type); const sourceRecordId = String(metadata.appraisalId ?? metadata.leaveRequestId ?? metadata.attendanceId ?? metadata.disputeId ?? "") || null; return { id: notification.id, type: notification.type, title: notification.title, description: notification.message, status, dueDate: null as Date | null, sourceModule: "HRIS" as const, sourceRecordId, actionRequired: status === "ACTION_REQUIRED", createdAt: notification.createdAt }; }).sort((a, b) => actionItemPriority(a, now) - actionItemPriority(b, now) || b.createdAt.getTime() - a.createdAt.getTime()).slice(0, 5);
  const entitlement = annualBalance ? Number(annualBalance.entitlement) : 0; const used = annualBalance ? Number(annualBalance.used) : 0; const pending = annualBalance ? Number(annualBalance.pending) : 0;
  return { currentDate, timeZone, employee: { id: employee.id, employeeId: employee.employeeNo, firstName: employee.firstName, fullName: `${employee.firstName} ${employee.lastName}`.trim(), role: employee.jobTitle ? { id: null, name: employee.jobTitle } : null, department: employee.department, branch: null }, attendanceToday: { ...attendanceToday, shift: { id: persistedSchedule?.id ?? null, name: "Default Work Schedule", startTime: schedule.workStartTime, endTime: schedule.workEndTime } }, summary: { annualLeaveRemaining: { leaveType: annualBalance?.leaveTypeCode ?? "ANNUAL", remainingDays: Math.max(0, entitlement - used - pending), usedDays: used, totalDays: entitlement }, nextPayday: nextPayrollRun?.payDate ? { date: tenantDateKey(nextPayrollRun.payDate, timeZone), period: tenantDateKey(nextPayrollRun.periodStart, timeZone).slice(0, 7) } : null, attendanceThisMonth: { presentDays, expectedWorkingDays, attendanceRate: expectedWorkingDays ? Number(((presentDays / expectedWorkingDays) * 100).toFixed(2)) : 0 } }, actionItems, recentPayslip: latestPayslip ? { id: latestPayslip.id, period: tenantDateKey(latestPayslip.payrollrun.periodStart, timeZone).slice(0, 7), grossPay: Number(latestPayslip.grossPay), totalDeductions: Number(latestPayslip.deductions), netPay: Number(latestPayslip.netPay), currency: latestPayslip.currency ?? settings?.currency ?? organization?.currency ?? "NGN", status: latestPayslip.payrollrun.status === "PAID" ? "PAID" : "APPROVED", availableForDownload: true } : null };
};

const authenticatedEmployee = async (organizationId: string, userId: string) => {
  const employee = await prisma.employee.findFirst({ where: { organizationId, user: { id: userId, organizationId } }, include: { department: true, manager: { select: { id: true, firstName: true, lastName: true } }, documents: { where: { employeeVisible: true }, orderBy: { createdAt: "desc" } }, bankUpdateRequests: { where: { status: "PENDING" }, orderBy: { submittedAt: "desc" }, take: 1 } } });
  if (!employee) throw notFound("Authenticated user is not linked to an employee");
  return employee;
};

const employeeAttendanceContext = async (organizationId: string, userId: string) => {
  const [employee, settings, persistedSchedule] = await Promise.all([
    prisma.employee.findFirst({ where: { organizationId, user: { id: userId, organizationId } }, select: { id: true, firstName: true, lastName: true, status: true, hireDate: true, managerId: true } }),
    prisma.organizationGeneralSettings.findUnique({ where: { organizationId }, select: { timeZone: true } }),
    prisma.workSchedule.findUnique({ where: { organizationId } })
  ]);
  if (!employee) throw notFound("Authenticated user is not linked to an employee");
  return { employee, timeZone: safeTimeZone(settings?.timeZone), schedule: persistedSchedule ?? { ...defaultSchedule, gracePeriodMinutes: 0, overtimeAfterMinutes: 0 } };
};

const workedMinutes = (clockInAt: Date, clockOutAt: Date | null, now: Date) => Math.max(0, Math.floor(((clockOutAt ?? now).getTime() - clockInAt.getTime()) / 60_000));
const monthEndExclusive = (month: string) => { const [year, value] = month.split("-").map(Number); return value === 12 ? `${year + 1}-01-01` : `${year}-${String(value + 1).padStart(2, "0")}-01`; };
export const leaveCalendarDates = (startDate: string, endDate: string, month: string) => { const monthStart = `${month}-01`; const nextMonth = monthEndExclusive(month); const dates: string[] = []; let date = startDate < monthStart ? monthStart : startDate; const clippedEnd = endDate >= nextMonth ? shiftDateKey(nextMonth, -1) : endDate; while (date <= clippedEnd && date < nextMonth) { dates.push(date); date = shiftDateKey(date, 1); } return dates; };
const employeeDayIsScheduled = (dateKey: string, schedule: Schedule) => isDashboardWorkday(dateKey, schedule);

export const buildEmployeeAttendanceCalendar = (input: { month: string; today: string; schedule: Schedule; attendanceByDate: ReadonlyMap<string, string>; approvedLeaveDates: ReadonlySet<string> }) => {
  const days = []; let date = `${input.month}-01`; const end = monthEndExclusive(input.month);
  while (date < end) {
    const scheduled = employeeDayIsScheduled(date, input.schedule); const onLeave = input.approvedLeaveDates.has(date); const future = date > input.today;
    const dayType = future ? "FUTURE" : onLeave ? "ON_LEAVE" : scheduled ? "WORKING_DAY" : "WEEKEND";
    const attendanceStatus = input.attendanceByDate.get(date) ?? (!future && onLeave ? "ON_LEAVE" : date < input.today && scheduled ? "ABSENT" : null);
    days.push({ date, dayType, attendanceStatus }); date = shiftDateKey(date, 1);
  }
  return days;
};

export const getEmployeeAttendance = async (organizationId: string, user: AuthUser, requestedMonth?: string, now = new Date()) => {
  const { employee, timeZone, schedule } = await employeeAttendanceContext(organizationId, user.id);
  const todayKey = tenantDateKey(now, timeZone); const month = requestedMonth ?? todayKey.slice(0, 7); const firstKey = `${month}-01`; const nextKey = monthEndExclusive(month);
  const start = zonedDateTimeToUtc(firstKey, "00:00", timeZone); const end = zonedDateTimeToUtc(nextKey, "00:00", timeZone);
  const todayStart = zonedDateTimeToUtc(todayKey, "00:00", timeZone); const tomorrowStart = zonedDateTimeToUtc(shiftDateKey(todayKey, 1), "00:00", timeZone);
  const [records, leaves, todayRecord, todayLeave] = await Promise.all([
    prisma.attendance.findMany({ where: { organizationId, employeeId: employee.id, clockInAt: { gte: start, lt: end } }, include: { disputes: { orderBy: { createdAt: "desc" }, take: 1 } }, orderBy: { clockInAt: "desc" } }),
    prisma.leaveRequest.findMany({ where: { organizationId, employeeId: employee.id, status: "APPROVED", startDate: { lt: end }, endDate: { gte: start } }, select: { startDate: true, endDate: true } }),
    prisma.attendance.findFirst({ where: { organizationId, employeeId: employee.id, clockInAt: { gte: todayStart, lt: tomorrowStart } }, orderBy: { clockInAt: "desc" } }),
    prisma.leaveRequest.findFirst({ where: { organizationId, employeeId: employee.id, status: "APPROVED", startDate: { lt: tomorrowStart }, endDate: { gte: todayStart } }, select: { id: true } })
  ]);
  const approvedLeaveDates = new Set<string>();
  for (const leave of leaves) { let key = tenantDateKey(leave.startDate, timeZone); const leaveEnd = tenantDateKey(leave.endDate, timeZone); while (key <= leaveEnd && key < nextKey) { if (key >= firstKey) approvedLeaveDates.add(key); key = shiftDateKey(key, 1); } }
  const classified = records.map((record) => ({ record, date: tenantDateKey(record.clockInAt, timeZone), classification: classifyAttendance(record, schedule, timeZone) }));
  const attendanceByDate = new Map(classified.map(({ date, classification }) => [date, classification.primaryStatus === "ON_TIME" ? "PRESENT" : classification.primaryStatus]));
  const days = buildEmployeeAttendanceCalendar({ month, today: todayKey, schedule, attendanceByDate, approvedLeaveDates });
  const presentDays = new Set(classified.filter(({ classification }) => ["ON_TIME", "LATE"].includes(classification.primaryStatus)).map(({ date }) => date)).size;
  const lateDays = new Set(classified.filter(({ classification }) => classification.primaryStatus === "LATE").map(({ date }) => date)).size;
  const absentDays = days.filter((day) => day.attendanceStatus === "ABSENT").length;
  const workingDays = days.filter((day) => day.dayType === "WORKING_DAY" && day.date <= todayKey).length;
  const todayClassification = todayRecord ? classifyAttendance(todayRecord, schedule, timeZone).primaryStatus : todayLeave ? "ON_LEAVE" : null;
  const todayClockState = todayRecord ? todayRecord.clockOutAt ? "CLOCKED_OUT" : "CLOCKED_IN" : "NOT_CLOCKED_IN";
  return {
    timeZone,
    today: { date: todayKey, clockState: todayClockState, attendanceStatus: todayClassification === "ON_TIME" ? "PRESENT" : todayClassification, clockInAt: todayRecord?.clockInAt ?? null, clockOutAt: todayRecord?.clockOutAt ?? null, workedMinutes: todayRecord ? workedMinutes(todayRecord.clockInAt, todayRecord.clockOutAt, now) : 0, canClockIn: !todayRecord && employee.status === "ACTIVE" && employeeDayIsScheduled(todayKey, schedule) && !todayLeave, canClockOut: Boolean(todayRecord && !todayRecord.clockOutAt), shift: { id: "id" in schedule ? schedule.id : null, name: "Default Work Schedule", startTime: schedule.workStartTime, endTime: schedule.workEndTime } },
    calendar: { month, holidayAvailability: "NOT_IMPLEMENTED" as const, days },
    summary: { presentDays, lateDays, absentDays, workingDays },
    attendanceLog: classified.map(({ record, date, classification }) => { const dispute = record.disputes[0]; return { id: record.id, date, clockInAt: record.clockInAt, clockOutAt: record.clockOutAt, active: !record.clockOutAt, workedMinutes: workedMinutes(record.clockInAt, record.clockOutAt, now), status: classification.primaryStatus === "ON_TIME" ? "PRESENT" : classification.primaryStatus, flags: classification.flags, canRaiseDispute: !dispute || dispute.status !== "PENDING", dispute: dispute ? { id: dispute.id, disputeNo: dispute.disputeNo, issueType: dispute.issueType, status: dispute.status, submittedAt: dispute.createdAt } : null }; })
  };
};

export const clockInEmployee = async (organizationId: string, user: AuthUser, now = new Date()) => {
  const { employee, timeZone, schedule } = await employeeAttendanceContext(organizationId, user.id); const date = tenantDateKey(now, timeZone);
  if (employee.status !== "ACTIVE") throw conflict("Employee is not eligible to clock in");
  if (!employeeDayIsScheduled(date, schedule)) throw conflict("Today is not a scheduled working day");
  if (employee.hireDate && tenantDateKey(employee.hireDate, timeZone) > date) throw conflict("Employment has not started");
  const start = zonedDateTimeToUtc(date, "00:00", timeZone); const end = zonedDateTimeToUtc(shiftDateKey(date, 1), "00:00", timeZone);
  if (await prisma.attendance.findFirst({ where: { organizationId, employeeId: employee.id, clockInAt: { gte: start, lt: end } }, select: { id: true } })) throw conflict("Employee has already clocked in today");
  if (await prisma.leaveRequest.findFirst({ where: { organizationId, employeeId: employee.id, status: "APPROVED", startDate: { lt: end }, endDate: { gte: start } }, select: { id: true } })) throw conflict("Cannot clock in during approved leave");
  let attendance;
  try { attendance = await prisma.attendance.create({ data: { organizationId, employeeId: employee.id, attendanceDate: date, clockInAt: now, source: "WEB" } }); }
  catch (error) { if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw conflict("Employee has already clocked in today"); throw error; }
  const classification = classifyAttendance(attendance, schedule, timeZone);
  await createAuditLog({ organizationId, actorUserId: user.id, action: "EMPLOYEE_ATTENDANCE_CLOCKED_IN", resource: "ATTENDANCE", resourceId: attendance.id, summary: "Employee clocked in", metadata: { employeeId: employee.id, attendanceDate: date, source: "WEB" } });
  return { id: attendance.id, date, clockState: "CLOCKED_IN" as const, attendanceStatus: classification.primaryStatus === "ON_TIME" ? "PRESENT" : classification.primaryStatus, clockInAt: attendance.clockInAt, clockOutAt: null, workedMinutes: 0, canClockIn: false, canClockOut: true };
};

export const clockOutEmployee = async (organizationId: string, user: AuthUser, now = new Date()) => {
  const { employee, timeZone, schedule } = await employeeAttendanceContext(organizationId, user.id);
  const attendance = await prisma.attendance.findFirst({ where: { organizationId, employeeId: employee.id, clockOutAt: null }, orderBy: { clockInAt: "desc" } });
  if (!attendance) throw conflict("Employee has no active attendance record"); if (now <= attendance.clockInAt) throw conflict("Clock-out must be later than clock-in");
  const result = await prisma.attendance.updateMany({ where: { id: attendance.id, organizationId, employeeId: employee.id, clockOutAt: null }, data: { clockOutAt: now } });
  if (result.count !== 1) throw conflict("Attendance record was already clocked out");
  const updated = { ...attendance, clockOutAt: now }; const classification = classifyAttendance(updated, schedule, timeZone); const date = tenantDateKey(attendance.clockInAt, timeZone);
  await createAuditLog({ organizationId, actorUserId: user.id, action: "EMPLOYEE_ATTENDANCE_CLOCKED_OUT", resource: "ATTENDANCE", resourceId: attendance.id, summary: "Employee clocked out", metadata: { employeeId: employee.id, attendanceDate: date, source: "WEB" } });
  return { id: attendance.id, date, clockState: "CLOCKED_OUT" as const, attendanceStatus: classification.primaryStatus === "ON_TIME" ? "PRESENT" : classification.primaryStatus, clockInAt: attendance.clockInAt, clockOutAt: now, workedMinutes: workedMinutes(attendance.clockInAt, now, now), canClockIn: false, canClockOut: false, flags: classification.flags };
};

export const raiseEmployeeAttendanceDispute = async (organizationId: string, user: AuthUser, attendanceId: string, input: EmployeeAttendanceDisputeInput) => {
  const { employee } = await employeeAttendanceContext(organizationId, user.id);
  const attendance = await prisma.attendance.findFirst({ where: { id: attendanceId, organizationId, employeeId: employee.id }, select: { id: true } });
  if (!attendance) throw notFound("Attendance record not found");
  const dispute = await createAttendanceDispute(organizationId, attendanceId, input, user);
  await createAuditLog({ organizationId, actorUserId: user.id, action: "EMPLOYEE_ATTENDANCE_DISPUTE_SUBMITTED", resource: "ATTENDANCE_DISPUTE", resourceId: dispute.id, summary: "Employee submitted an attendance dispute", metadata: { employeeId: employee.id, attendanceId, issueType: input.issueType } });
  const [approvers, managerUsers] = await Promise.all([
    prisma.user.findMany({ where: { organizationId, isActive: true, role: { permissions: { some: { permission: { key: "hris:attendance:update" } } } } }, select: { id: true } }),
    employee.managerId ? prisma.user.findMany({ where: { organizationId, employeeId: employee.managerId, isActive: true }, select: { id: true } }) : Promise.resolve([])
  ]);
  await Promise.all([...new Set([...approvers, ...managerUsers].map((recipient) => recipient.id))].map((recipientUserId) => deliverUserNotification({ organizationId, recipientUserId, moduleKey: "hris", categoryKey: "approvals-requests", eventKey: `attendance-dispute:${dispute.id}:submitted`, type: "ATTENDANCE_DISPUTE_SUBMITTED", title: "Attendance dispute awaiting review", message: `${employee.firstName} ${employee.lastName} submitted an attendance dispute.`, metadata: { disputeId: dispute.id, attendanceId, employeeId: employee.id } }).catch(() => null)));
  return { id: dispute.id, disputeNo: dispute.disputeNo, attendanceId: dispute.attendanceId, issueType: dispute.issueType, description: dispute.description, status: dispute.status, submittedAt: dispute.createdAt };
};

export const getEmployeeLeave = async (organizationId: string, user: AuthUser, query: { month?: string; page: number; limit: number; status: "ALL" | "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED"; leaveType?: string }, now = new Date()) => {
  const { employee, timeZone } = await employeeAttendanceContext(organizationId, user.id); const currentDate = tenantDateKey(now, timeZone); const month = query.month ?? currentDate.slice(0, 7);
  const monthStartKey = `${month}-01`; const monthEndKey = monthEndExclusive(month); const monthStart = zonedDateTimeToUtc(monthStartKey, "00:00", timeZone); const monthEnd = zonedDateTimeToUtc(monthEndKey, "00:00", timeZone); const entitlementYear = Number(currentDate.slice(0, 4));
  const historyWhere: Prisma.LeaveRequestWhereInput = { organizationId, employeeId: employee.id, ...(query.status !== "ALL" ? { status: query.status as any } : {}), ...(query.leaveType ? { type: query.leaveType.toUpperCase() } : {}) };
  const [balances, leaveTypes, pendingRequestsCount, history, historyTotal, calendarRequests] = await Promise.all([
    prisma.leaveBalance.findMany({ where: { organizationId, employeeId: employee.id, year: entitlementYear }, orderBy: { leaveTypeCode: "asc" } }),
    prisma.leaveType.findMany({ where: { organizationId, active: true }, select: { id: true, code: true, name: true } }),
    prisma.leaveRequest.count({ where: { organizationId, employeeId: employee.id, status: "PENDING" } }),
    prisma.leaveRequest.findMany({ where: historyWhere, include: { reliever: { select: { id: true, employeeNo: true, firstName: true, lastName: true } } }, orderBy: [{ submittedAt: "desc" }, { startDate: "desc" }], skip: (query.page - 1) * query.limit, take: query.limit }),
    prisma.leaveRequest.count({ where: historyWhere }),
    prisma.leaveRequest.findMany({ where: { organizationId, employeeId: employee.id, status: { in: ["PENDING", "APPROVED"] }, startDate: { lt: monthEnd }, endDate: { gte: monthStart } }, orderBy: { startDate: "asc" }, select: { id: true, type: true, status: true, startDate: true, endDate: true } })
  ]);
  const leaveTypeByCode = new Map(leaveTypes.map((type) => [type.code, type]));
  const balancesResponse = balances.map((balance) => { const type = leaveTypeByCode.get(balance.leaveTypeCode); const totalDays = Number(balance.entitlement); const usedDays = Number(balance.used); const pendingDays = Number(balance.pending); return { leaveTypeId: type?.id ?? null, code: balance.leaveTypeCode, name: type?.name ?? balance.leaveTypeCode, totalDays, usedDays, remainingDays: Math.max(0, totalDays - usedDays - pendingDays), pendingDays, entitlementYear }; });
  const historyResponse = history.map((request) => { const type = leaveTypeByCode.get(request.type); return { id: request.id, leaveType: { id: type?.id ?? null, code: request.type, name: type?.name ?? request.type }, startDate: tenantDateKey(request.startDate, timeZone), endDate: tenantDateKey(request.endDate, timeZone), days: Number(request.requestedDays ?? 0), status: request.status, managerComment: request.managerComment ?? request.rejectionReason, reliever: request.reliever ? { id: request.reliever.id, employeeId: request.reliever.employeeNo, name: `${request.reliever.firstName} ${request.reliever.lastName}`.trim() } : null, submittedAt: request.submittedAt } });
  const calendarEntries = calendarRequests.map((request) => { const startDate = tenantDateKey(request.startDate, timeZone); const endDate = tenantDateKey(request.endDate, timeZone); return { leaveRequestId: request.id, leaveType: request.type, status: request.status, startDate, endDate, dates: leaveCalendarDates(startDate, endDate, month) }; });
  return { entitlementPeriod: { type: "CALENDAR_YEAR" as const, year: entitlementYear }, dayCalculation: { source: "TENANT_WORK_SCHEDULE" as const, excludesNonWorkingWeekdays: true, holidayAvailability: "NOT_IMPLEMENTED" as const }, pendingRequestsCount, balances: balancesResponse, history: historyResponse, historyPagination: { currentPage: query.page, pageSize: query.limit, totalRecords: historyTotal, totalPages: Math.ceil(historyTotal / query.limit) }, calendar: { month, entries: calendarEntries } };
};

export const applyEmployeeLeave = async (organizationId: string, user: AuthUser, input: EmployeeLeaveRequestInput) => {
  const employee = await prisma.employee.findFirst({ where: { organizationId, user: { id: user.id, organizationId } }, select: { id: true } });
  if (!employee) throw notFound("Authenticated user is not linked to an employee");
  const leaveType = await prisma.leaveType.findFirst({ where: { id: input.leaveTypeId, organizationId, active: true }, select: { id: true, code: true, name: true } });
  if (!leaveType) throw notFound("Eligible leave type not found");
  const created = await applyForLeave(organizationId, { leaveType: leaveType.code, fromDate: input.startDate, toDate: input.endDate, reason: input.reason, relieverEmployeeId: input.relieverEmployeeId }, user);
  return { id: created.id, leaveType: { id: leaveType.id, code: leaveType.code, name: leaveType.name }, startDate: input.startDate, endDate: input.endDate, days: Number(created.requestedDays ?? 0), status: created.status, relieverEmployeeId: created.relieverEmployeeId, submittedAt: created.submittedAt };
};

export const listEmployeeRelievers = async (organizationId: string, user: AuthUser, query: { search?: string; limit: number }) => {
  const employee = await prisma.employee.findFirst({ where: { organizationId, user: { id: user.id, organizationId } }, select: { id: true } }); if (!employee) throw notFound("Authenticated user is not linked to an employee");
  const search = query.search; const rows = await prisma.employee.findMany({ where: { organizationId, id: { not: employee.id }, status: "ACTIVE", ...(search ? { OR: [{ firstName: { contains: search } }, { lastName: { contains: search } }, { employeeNo: { contains: search } }] } : {}) }, orderBy: [{ firstName: "asc" }, { lastName: "asc" }], take: query.limit, select: { id: true, employeeNo: true, firstName: true, lastName: true, jobTitle: true, department: { select: { id: true, name: true } } } });
  return rows.map((row) => ({ id: row.id, employeeId: row.employeeNo, name: `${row.firstName} ${row.lastName}`.trim(), role: row.jobTitle, department: row.department }));
};

const employeePayslipContext = async (organizationId: string, user: AuthUser) => {
  if (!await isOrganizationModuleEnabled(organizationId, "payroll")) throw forbidden("PAYROLL module access is disabled");
  const [employee, settings, organization] = await Promise.all([
    prisma.employee.findFirst({ where: { organizationId, user: { id: user.id, organizationId } }, select: { id: true, employeeNo: true, firstName: true, lastName: true } }),
    prisma.organizationGeneralSettings.findUnique({ where: { organizationId }, select: { timeZone: true, currency: true } }),
    prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true, currency: true } })
  ]);
  if (!employee) throw notFound("Authenticated user is not linked to an employee");
  return { employee, timeZone: safeTimeZone(settings?.timeZone), organizationName: organization?.name ?? env.APP_NAME, fallbackCurrency: settings?.currency ?? organization?.currency ?? "NGN" };
};

const finalizedPayrollStatuses = ["APPROVED", "PAID"] as const;
export const isEmployeeVisiblePayrollStatus = (status: string) => (finalizedPayrollStatuses as readonly string[]).includes(status);
const payslipPeriod = (date: Date, timeZone: string) => tenantDateKey(date, timeZone).slice(0, 7);
export const payslipComponents = (value: Prisma.JsonValue | null): PayslipComponent[] => Array.isArray(value) ? value.flatMap((item) => { if (!item || typeof item !== "object" || Array.isArray(item)) return []; const record = item as Record<string, unknown>; const amount = Number(record.amount); if (typeof record.code !== "string" || typeof record.name !== "string" || !Number.isFinite(amount) || amount < 0) return []; return [{ code: record.code, name: record.name, amount }]; }) : [];
const persistedPayslipBreakdown = (payslip: { earningsSnapshot: Prisma.JsonValue | null; deductionsSnapshot: Prisma.JsonValue | null; payeTax: Prisma.Decimal; pension: Prisma.Decimal }) => {
  const earnings = payslipComponents(payslip.earningsSnapshot); const capturedDeductions = payslipComponents(payslip.deductionsSnapshot);
  const deductions = capturedDeductions.length ? capturedDeductions : [{ code: "PAYE", name: "PAYE Tax", amount: Number(payslip.payeTax) }, { code: "PENSION", name: "Pension", amount: Number(payslip.pension) }].filter((item) => item.amount > 0);
  return { earnings, deductions, availability: earnings.length && capturedDeductions.length ? "FULL" as const : deductions.length ? "PARTIAL" as const : "TOTALS_ONLY" as const };
};

export const getEmployeePayslips = async (organizationId: string, user: AuthUser, requestedYear?: number, now = new Date()) => {
  const { employee, timeZone, fallbackCurrency } = await employeePayslipContext(organizationId, user);
  const baseWhere: Prisma.PayslipWhereInput = { organizationId, employeeId: employee.id, payrollrun: { status: { in: [...finalizedPayrollStatuses] } } };
  const [periodRows, trendRows] = await Promise.all([
    prisma.payslip.findMany({ where: baseWhere, select: { payrollrun: { select: { periodStart: true } } }, orderBy: { payrollrun: { periodStart: "desc" } } }),
    prisma.payslip.findMany({ where: baseWhere, select: { netPay: true, currency: true, payrollrun: { select: { periodStart: true } } }, orderBy: [{ payrollrun: { periodStart: "desc" } }, { createdAt: "desc" }], take: 6 })
  ]);
  const availableYears = [...new Set(periodRows.map((row) => Number(payslipPeriod(row.payrollrun.periodStart, timeZone).slice(0, 4))))].sort((a, b) => b - a);
  const currentYear = Number(tenantDateKey(now, timeZone).slice(0, 4)); const selectedYear = requestedYear ?? (availableYears.includes(currentYear) ? currentYear : availableYears[0] ?? null);
  let payslips: Array<{ id: string; period: string; year: number; month: number; grossPay: number; totalDeductions: number; netPay: number; currency: string; status: "APPROVED" | "PAID"; canDownload: boolean }> = [];
  if (selectedYear !== null) {
    const start = zonedDateTimeToUtc(`${selectedYear}-01-01`, "00:00", timeZone); const end = zonedDateTimeToUtc(`${selectedYear + 1}-01-01`, "00:00", timeZone);
    const rows = await prisma.payslip.findMany({ where: { ...baseWhere, payrollrun: { status: { in: [...finalizedPayrollStatuses] }, periodStart: { gte: start, lt: end } } }, include: { payrollrun: true }, orderBy: [{ payrollrun: { periodStart: "desc" } }, { createdAt: "desc" }] });
    payslips = rows.map((row) => { const period = payslipPeriod(row.payrollrun.periodStart, timeZone); return { id: row.id, period, year: Number(period.slice(0, 4)), month: Number(period.slice(5, 7)), grossPay: Number(row.grossPay), totalDeductions: Number(row.deductions), netPay: Number(row.netPay), currency: row.currency ?? fallbackCurrency, status: row.payrollrun.status as "APPROVED" | "PAID", canDownload: true }; });
  }
  const netPayTrend = trendRows.reverse().map((row) => { const period = payslipPeriod(row.payrollrun.periodStart, timeZone); return { period, year: Number(period.slice(0, 4)), month: Number(period.slice(5, 7)), netPay: Number(row.netPay), currency: row.currency ?? fallbackCurrency }; });
  return { selectedYear, availableYears, netPayTrend, payslips };
};

const ownedFinalizedPayslip = async (organizationId: string, employeeId: string, payslipId: string) => {
  const payslip = await prisma.payslip.findFirst({ where: { id: payslipId, organizationId, employeeId, payrollrun: { status: { in: [...finalizedPayrollStatuses] } } }, include: { payrollrun: true } });
  if (!payslip) throw notFound("Payslip not found"); return payslip;
};

export const getEmployeePayslip = async (organizationId: string, user: AuthUser, payslipId: string) => {
  const { employee, timeZone, fallbackCurrency } = await employeePayslipContext(organizationId, user); const payslip = await ownedFinalizedPayslip(organizationId, employee.id, payslipId); const period = payslipPeriod(payslip.payrollrun.periodStart, timeZone); const breakdown = persistedPayslipBreakdown(payslip);
  return { id: payslip.id, period, year: Number(period.slice(0, 4)), month: Number(period.slice(5, 7)), grossPay: Number(payslip.grossPay), totalDeductions: Number(payslip.deductions), netPay: Number(payslip.netPay), currency: payslip.currency ?? fallbackCurrency, status: payslip.payrollrun.status as "APPROVED" | "PAID", canDownload: true, breakdownAvailability: breakdown.availability, earnings: breakdown.earnings, deductions: breakdown.deductions };
};

const pdfText = (value: unknown) => String(value ?? "").replace(/[^\x20-\x7E]/g, " ").replace(/[\\()]/g, "\\$&");
export const createPayslipPdf = (lines: string[]) => { const stream = `BT /F1 11 Tf 45 790 Td ${lines.map((line, index) => `${index ? "0 -24 Td " : ""}(${pdfText(line)}) Tj`).join(" ")} ET`; const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>", `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"]; let pdf = "%PDF-1.4\n", offset = Buffer.byteLength(pdf); const offsets = [0]; objects.forEach((object, index) => { offsets.push(offset); const part = `${index + 1} 0 obj\n${object}\nendobj\n`; pdf += part; offset += Buffer.byteLength(part); }); const xref = offset; pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map((value) => `${String(value).padStart(10, "0")} 00000 n `).join("\n")}\ntrailer << /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`; return Buffer.from(pdf); };

export const downloadEmployeePayslip = async (organizationId: string, user: AuthUser, payslipId: string) => {
  const context = await employeePayslipContext(organizationId, user); const payslip = await ownedFinalizedPayslip(organizationId, context.employee.id, payslipId); const period = payslipPeriod(payslip.payrollrun.periodStart, context.timeZone); let buffer: Buffer;
  if (payslip.pdfFileReference) buffer = await readObject(payslip.pdfFileReference); else { const breakdown = persistedPayslipBreakdown(payslip); const currency = payslip.currency ?? context.fallbackCurrency; const lines = [env.APP_NAME, "EMPLOYEE PAYSLIP", `Employer: ${context.organizationName}`, `Employee: ${context.employee.firstName} ${context.employee.lastName}`, `Employee ID: ${context.employee.employeeNo}`, `Period: ${period}`, `Status: ${payslip.payrollrun.status}`, "EARNINGS", ...breakdown.earnings.map((item) => `${item.name}: ${currency} ${item.amount.toFixed(2)}`), `Gross pay: ${currency} ${Number(payslip.grossPay).toFixed(2)}`, "DEDUCTIONS", ...breakdown.deductions.map((item) => `${item.name}: ${currency} ${item.amount.toFixed(2)}`), `Total deductions: ${currency} ${Number(payslip.deductions).toFixed(2)}`, `Net pay: ${currency} ${Number(payslip.netPay).toFixed(2)}`]; buffer = createPayslipPdf(lines); }
  await createAuditLog({ organizationId, actorUserId: user.id, action: "EMPLOYEE_PAYSLIP_DOWNLOADED", resource: "PAYSLIP", resourceId: payslip.id, summary: "Employee downloaded own payslip", metadata: { employeeId: context.employee.id, period } });
  return { buffer, filename: `payslip-${period}-${payslip.id}.pdf` };
};

export const maskBankAccountNumber = (accountNumber: string | null) => accountNumber ? { last4: accountNumber.slice(-4), masked: `${"*".repeat(Math.max(0, accountNumber.length - 4))}${accountNumber.slice(-4)}` } : { last4: null, masked: null };
const documentMetadata = (document: { id: string; documentType: string; originalName: string; createdAt: Date; allowDownload: boolean }): EmployeeDocumentMetadata => ({ id: document.id, documentType: document.documentType, documentName: document.originalName, originalFileName: document.originalName, dateAdded: document.createdAt, downloadAvailable: document.allowDownload });

export const getEmployeeProfile = async (organizationId: string, user: AuthUser) => {
  const [employee, settings, salary] = await Promise.all([authenticatedEmployee(organizationId, user.id), prisma.organizationGeneralSettings.findUnique({ where: { organizationId }, select: { currency: true } }), prisma.salaryStructure.findFirst({ where: { organizationId, employee: { user: { id: user.id } } }, orderBy: { effectiveFrom: "desc" }, select: { basic: true, housing: true, transport: true, otherAllowance: true } })]);
  const fullName = `${employee.firstName} ${employee.lastName}`.trim(); const masked = maskBankAccountNumber(employee.bankAccountNumber); const pending = employee.bankUpdateRequests[0];
  return {
    header: { employeeId: employee.employeeNo, fullName, profileImage: employee.profileImageUrl, role: employee.jobTitle ? { id: null, name: employee.jobTitle } : null, department: employee.department ? { id: employee.department.id, name: employee.department.name } : null },
    personalDetails: { fullName, firstName: employee.firstName, lastName: employee.lastName, dateOfBirth: employee.dateOfBirth, gender: employee.gender, phoneNumber: employee.phone, personalEmail: employee.email, maritalStatus: employee.maritalStatus, address: employee.address, nationality: employee.nationality },
    workDetails: { employeeId: employee.employeeNo, pensionId: employee.pensionPin, taxId: employee.taxId, status: employee.status, department: employee.department ? { id: employee.department.id, name: employee.department.name } : null, position: employee.jobTitle ? { id: null, name: employee.jobTitle } : null, manager: employee.manager ? { id: employee.manager.id, name: `${employee.manager.firstName} ${employee.manager.lastName}`.trim() } : null, branch: null, startDate: employee.hireDate, employmentType: employee.employmentType, workMode: employee.workMode, earnings: salary ? { amount: Number(salary.basic) + Number(salary.housing) + Number(salary.transport) + Number(salary.otherAllowance), currency: settings?.currency ?? "NGN" } : employee.baseSalary != null ? { amount: Number(employee.baseSalary), currency: settings?.currency ?? "NGN" } : null },
    emergencyContact: employee.nextOfKinName || employee.nextOfKinPhone || employee.nextOfKinAddress ? { id: null, name: employee.nextOfKinName, relationship: employee.nextOfKinRelationship, phoneNumber: employee.nextOfKinPhone, address: employee.nextOfKinAddress } : null,
    documents: employee.documents.map(documentMetadata),
    bankDetails: employee.bankName || employee.bankAccountNumber || pending ? { accountName: employee.bankAccountName, accountNumberMasked: masked.masked, last4: masked.last4, bank: { code: employee.bankCode, name: employee.bankName }, accountType: employee.bankAccountType, pendingUpdateRequest: pending ? { id: pending.id, status: pending.status, submittedAt: pending.submittedAt } : null } : null
  };
};

export const updateEmployeePersonalDetails = async (organizationId: string, user: AuthUser, input: UpdateEmployeePersonalDetailsInput) => {
  const employee = await authenticatedEmployee(organizationId, user.id); const changedFields = Object.keys(input);
  const updated = await prisma.employee.update({ where: { id: employee.id }, data: { ...(input.phoneNumber !== undefined ? { phone: input.phoneNumber } : {}), ...(input.personalEmail !== undefined ? { email: input.personalEmail } : {}), ...(input.address !== undefined ? { address: input.address } : {}), ...(input.maritalStatus !== undefined ? { maritalStatus: input.maritalStatus } : {}), ...(input.nationality !== undefined ? { nationality: input.nationality } : {}) }, select: { phone: true, email: true, address: true, maritalStatus: true, nationality: true } });
  await createAuditLog({ organizationId, actorUserId: user.id, action: "EMPLOYEE_PROFILE_UPDATED", resource: "EMPLOYEE", resourceId: employee.id, summary: "Employee updated self-service personal details", metadata: { employeeId: employee.id, changedFields } });
  return { phoneNumber: updated.phone, personalEmail: updated.email, address: updated.address, maritalStatus: updated.maritalStatus, nationality: updated.nationality };
};

export const inspectProfilePhoto = (file: Express.Multer.File) => { const jpeg = file.buffer.length >= 3 && file.buffer[0] === 0xff && file.buffer[1] === 0xd8 && file.buffer[2] === 0xff; const png = file.buffer.length >= 8 && file.buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])); const webp = file.buffer.length >= 12 && file.buffer.subarray(0, 4).toString() === "RIFF" && file.buffer.subarray(8, 12).toString() === "WEBP"; if ((file.mimetype === "image/jpeg" && jpeg) || (file.mimetype === "image/png" && png) || (file.mimetype === "image/webp" && webp)) return; throw badRequest("Profile photo content does not match its declared image type"); };
export const updateEmployeeProfilePhoto = async (organizationId: string, user: AuthUser, file: Express.Multer.File | undefined, publicBaseUrl: string) => { if (!file) throw badRequest("Profile photo is required"); inspectProfilePhoto(file); const employee = await authenticatedEmployee(organizationId, user.id); const extension = file.mimetype === "image/png" ? ".png" : file.mimetype === "image/webp" ? ".webp" : ".jpg"; const key = createObjectKey(`employee-profile/${organizationId}/${employee.id}`, `profile${extension}`); const stored = await uploadObject({ key, body: file.buffer, contentType: file.mimetype, publicBaseUrl }); try { await prisma.employee.update({ where: { id: employee.id }, data: { profileImageUrl: stored.url } }); if (employee.profileImageUrl) { let oldReference = employee.profileImageUrl; try { const pathname = new URL(employee.profileImageUrl).pathname; const marker = `${env.UPLOAD_PUBLIC_BASE_PATH}/`; if (pathname.includes(marker)) oldReference = pathname.slice(pathname.indexOf(marker) + marker.length); } catch { /* relative storage reference */ } await deleteObject(oldReference).catch(() => undefined); } await createAuditLog({ organizationId, actorUserId: user.id, action: "EMPLOYEE_PROFILE_PHOTO_UPDATED", resource: "EMPLOYEE", resourceId: employee.id, summary: "Employee updated profile photo", metadata: { employeeId: employee.id, mimeType: file.mimetype, size: file.size } }); return { profileImage: stored.url }; } catch (error) { await deleteObject(stored.key).catch(() => undefined); throw error; } };

export const listEmployeeDocuments = async (organizationId: string, user: AuthUser) => (await authenticatedEmployee(organizationId, user.id)).documents.map(documentMetadata);
export const downloadEmployeeDocument = async (organizationId: string, user: AuthUser, documentId: string) => { const employee = await authenticatedEmployee(organizationId, user.id); const document = await prisma.employeeDocument.findFirst({ where: { id: documentId, organizationId, employeeId: employee.id, employeeVisible: true, allowDownload: true }, select: { id: true, fileReference: true, originalName: true, mimeType: true } }); if (!document) throw notFound("Employee document not found"); const buffer = await readObject(document.fileReference); await createAuditLog({ organizationId, actorUserId: user.id, action: "EMPLOYEE_DOCUMENT_DOWNLOADED", resource: "EMPLOYEE_DOCUMENT", resourceId: document.id, summary: "Employee downloaded own document", metadata: { employeeId: employee.id, documentId: document.id } }); return { buffer, filename: document.originalName.replace(/[\r\n"\\/]/g, "_"), mimeType: document.mimeType } as const; };

export const requestBankDetailsUpdate = async (organizationId: string, user: AuthUser, input: BankUpdateRequestInput) => { const employee = await authenticatedEmployee(organizationId, user.id); if (employee.bankUpdateRequests.length) throw conflict("A bank details update request is already pending"); if (employee.bankCode === input.bankCode && employee.bankAccountNumber === input.accountNumber && employee.bankAccountName === input.accountName && employee.bankAccountType === input.accountType) throw conflict("Proposed bank details match the current details"); const maskedCurrent = maskBankAccountNumber(employee.bankAccountNumber); const maskedProposed = maskBankAccountNumber(input.accountNumber); let request; try { request = await prisma.bankDetailsUpdateRequest.create({ data: { organizationId, employeeId: employee.id, pendingKey: `${organizationId}:${employee.id}`, currentBankSnapshot: { bankCode: employee.bankCode, bankName: employee.bankName, accountNumber: employee.bankAccountNumber, accountName: employee.bankAccountName, accountType: employee.bankAccountType }, proposedBankCode: input.bankCode, proposedBankName: input.bankName, proposedAccountNumber: input.accountNumber, proposedAccountName: input.accountName, proposedAccountType: input.accountType, reason: input.reason } }); } catch (error) { if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw conflict("A bank details update request is already pending"); throw error; } await createAuditLog({ organizationId, actorUserId: user.id, action: "EMPLOYEE_BANK_UPDATE_REQUESTED", resource: "BANK_DETAILS_UPDATE_REQUEST", resourceId: request.id, summary: "Employee requested a bank details update", metadata: { employeeId: employee.id, previousMaskedAccountNumber: maskedCurrent.masked, proposedMaskedAccountNumber: maskedProposed.masked, proposedBankCode: input.bankCode } }); const approvers = await prisma.user.findMany({ where: { organizationId, isActive: true, role: { permissions: { some: { permission: { key: { in: ["hris:employees:update", "payroll:salary:update"] } } } } } }, select: { id: true } }); await Promise.all([...approvers.map((approver) => deliverUserNotification({ organizationId, recipientUserId: approver.id, moduleKey: "hris" as const, categoryKey: "approvals-requests", eventKey: `bank-update:${request.id}:submitted`, type: "EMPLOYEE_BANK_UPDATE_REQUESTED", title: "Bank details update awaiting review", message: `${employee.firstName} ${employee.lastName} submitted a bank details update request.`, metadata: { requestId: request.id, employeeId: employee.id } })), deliverUserNotification({ organizationId, recipientUserId: user.id, moduleKey: "hris", categoryKey: "record-updates", eventKey: `bank-update:${request.id}:confirmation`, type: "EMPLOYEE_BANK_UPDATE_REQUEST_SUBMITTED", title: "Bank details update request submitted", message: "Your bank details update request is awaiting review.", metadata: { requestId: request.id, employeeId: employee.id } })]); return { id: request.id, status: request.status, submittedAt: request.submittedAt } as const; };
