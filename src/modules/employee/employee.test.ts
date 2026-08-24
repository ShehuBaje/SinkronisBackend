import assert from "node:assert/strict";
import test from "node:test";
import { actionItemPriority, buildEmployeeAttendanceCalendar, createPayslipPdf, dashboardAttendanceState, expectedWorkdaysThrough, inspectProfilePhoto, isEmployeeVisiblePayrollStatus, leaveCalendarDates, maskBankAccountNumber, payslipComponents } from "./employee.service";
import { bankUpdateRequestSchema, employeeAttendanceDisputeSchema, employeeAttendanceQuerySchema, employeeDashboardQuerySchema, employeeLeaveQuerySchema, employeeLeaveRequestSchema, employeePayslipParamsSchema, employeePayslipsQuerySchema, employeeRelieverQuerySchema, updateEmployeePersonalDetailsSchema } from "./employee.validation";
import { isMutablePayrollRunStatus } from "../payroll/payroll.service";

test("dashboard attendance exposes empty, clocked-in, and clocked-out states", () => {
  const now = new Date("2026-08-24T12:00:00.000Z");
  assert.deepEqual(dashboardAttendanceState(null, now), { status: "NOT_CLOCKED_IN", clockInAt: null, clockOutAt: null, workedMinutes: 0, canClockIn: true, canClockOut: false });
  const clockInAt = new Date("2026-08-24T08:00:00.000Z");
  assert.equal(dashboardAttendanceState({ clockInAt, clockOutAt: null }, now).workedMinutes, 240);
  assert.deepEqual(dashboardAttendanceState({ clockInAt, clockOutAt: new Date("2026-08-24T10:30:00.000Z") }, now), { status: "CLOCKED_OUT", clockInAt, clockOutAt: new Date("2026-08-24T10:30:00.000Z"), workedMinutes: 150, canClockIn: false, canClockOut: false });
});

test("expected working days use the configured schedule and exclude approved leave", () => {
  const schedule = { monday: true, tuesday: true, wednesday: true, thursday: true, friday: true, saturday: false, sunday: false, workStartTime: "09:00", workEndTime: "17:00", breakDurationMinutes: 60 };
  assert.equal(expectedWorkdaysThrough("2026-08", "2026-08-07", schedule, new Set(["2026-08-05"])), 4);
});

test("action-required dashboard items sort ahead of informational items", () => {
  const now = new Date("2026-08-24T12:00:00.000Z");
  assert.ok(actionItemPriority({ status: "ACTION_REQUIRED", dueDate: null }, now) < actionItemPriority({ status: "INFORMATIONAL", dueDate: null }, now));
  assert.equal(actionItemPriority({ status: "ACTION_REQUIRED", dueDate: new Date("2026-08-23T00:00:00.000Z") }, now), 0);
});

test("dashboard validation rejects employee identity manipulation", () => {
  assert.equal(employeeDashboardQuerySchema.safeParse({}).success, true);
  assert.equal(employeeDashboardQuerySchema.safeParse({ employeeId: "another-employee" }).success, false);
});

test("personal detail validation whitelists self-service fields and rejects managed fields", () => {
  assert.equal(updateEmployeePersonalDetailsSchema.safeParse({ phoneNumber: "+2348012345678", personalEmail: "person@example.com" }).success, true);
  assert.equal(updateEmployeePersonalDetailsSchema.safeParse({ departmentId: "dept", baseSalary: 500000 }).success, false);
  assert.equal(updateEmployeePersonalDetailsSchema.safeParse({ personalEmail: "invalid" }).success, false);
});

test("bank update requests are strict and account masking never exposes the full account", () => {
  assert.equal(bankUpdateRequestSchema.safeParse({ bankCode: "058", bankName: "Supported Bank", accountNumber: "0123456789", accountName: "Employee Name", accountType: "SAVINGS" }).success, true);
  assert.deepEqual(maskBankAccountNumber("0123456789"), { last4: "6789", masked: "******6789" });
  assert.equal(JSON.stringify(maskBankAccountNumber("0123456789")).includes("0123456789"), false);
});

test("profile photo inspection checks file signatures instead of trusting MIME metadata", () => {
  const validPng = { mimetype: "image/png", buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]) } as Express.Multer.File;
  assert.doesNotThrow(() => inspectProfilePhoto(validPng));
  assert.throws(() => inspectProfilePhoto({ mimetype: "image/png", buffer: Buffer.from("not an image") } as Express.Multer.File));
});

test("attendance month and dispute validation reject identity and authoritative date manipulation", () => {
  assert.equal(employeeAttendanceQuerySchema.safeParse({ month: "2026-08" }).success, true);
  assert.equal(employeeAttendanceQuerySchema.safeParse({ month: "2026-13" }).success, false);
  assert.equal(employeeAttendanceQuerySchema.safeParse({ employeeId: "another-employee" }).success, false);
  assert.equal(employeeAttendanceDisputeSchema.safeParse({ issueType: "WRONG_STATUS", description: "The persisted status is incorrect." }).success, true);
  assert.equal(employeeAttendanceDisputeSchema.safeParse({ issueType: "MADE_UP", description: "The persisted status is incorrect." }).success, false);
  assert.equal(employeeAttendanceDisputeSchema.safeParse({ issueType: "WRONG_STATUS", description: "The persisted status is incorrect.", attendanceDate: "2026-08-01" }).success, false);
});

test("attendance calendar does not classify weekends, leave, today, or future dates as absent", () => {
  const schedule = { monday: true, tuesday: true, wednesday: true, thursday: true, friday: true, saturday: false, sunday: false, workStartTime: "09:00", workEndTime: "17:00", breakDurationMinutes: 60 };
  const days = buildEmployeeAttendanceCalendar({ month: "2026-08", today: "2026-08-05", schedule, attendanceByDate: new Map([["2026-08-03", "PRESENT"]]), approvedLeaveDates: new Set(["2026-08-04"]) });
  assert.equal(days.find((day) => day.date === "2026-08-01")?.attendanceStatus, null);
  assert.equal(days.find((day) => day.date === "2026-08-04")?.attendanceStatus, "ON_LEAVE");
  assert.equal(days.find((day) => day.date === "2026-08-05")?.attendanceStatus, null);
  assert.equal(days.find((day) => day.date === "2026-08-06")?.attendanceStatus, null);
});

test("employee leave requests whitelist workflow fields and cannot force identity or status", () => {
  const valid = { leaveTypeId: "leave-type-id", startDate: "2026-08-24", endDate: "2026-08-28", reason: "Annual family commitment", relieverEmployeeId: "reliever-id" };
  assert.equal(employeeLeaveRequestSchema.safeParse(valid).success, true);
  assert.equal(employeeLeaveRequestSchema.safeParse({ ...valid, endDate: "2026-08-20" }).success, false);
  assert.equal(employeeLeaveRequestSchema.safeParse({ ...valid, employeeId: "another-employee" }).success, false);
  assert.equal(employeeLeaveRequestSchema.safeParse({ ...valid, status: "APPROVED" }).success, false);
});

test("leave page filters are bounded and reject employee identity manipulation", () => {
  assert.equal(employeeLeaveQuerySchema.safeParse({ month: "2026-08", page: 1, limit: 25 }).success, true);
  assert.equal(employeeLeaveQuerySchema.safeParse({ month: "2026-13" }).success, false);
  assert.equal(employeeLeaveQuerySchema.safeParse({ employeeId: "another-employee" }).success, false);
  assert.equal(employeeRelieverQuerySchema.safeParse({ search: "Ada", limit: 20 }).success, true);
  assert.equal(employeeRelieverQuerySchema.safeParse({ limit: 500 }).success, false);
});

test("leave calendar clips cross-month requests to the selected month", () => {
  assert.deepEqual(leaveCalendarDates("2026-07-30", "2026-08-03", "2026-08"), ["2026-08-01", "2026-08-02", "2026-08-03"]);
  assert.deepEqual(leaveCalendarDates("2026-08-30", "2026-09-03", "2026-08"), ["2026-08-30", "2026-08-31"]);
});

test("payslip filters reject identity manipulation and invalid years", () => {
  assert.equal(employeePayslipsQuerySchema.safeParse({ year: 2026 }).success, true);
  assert.equal(employeePayslipsQuerySchema.safeParse({ year: 1999 }).success, false);
  assert.equal(employeePayslipsQuerySchema.safeParse({ employeeId: "another-employee" }).success, false);
  assert.equal(employeePayslipParamsSchema.safeParse({ payslipId: "owned-payslip" }).success, true);
  assert.equal(employeePayslipParamsSchema.safeParse({ payslipId: "owned-payslip", employeeId: "another-employee" }).success, false);
});

test("employee payslip visibility excludes draft, processing, and cancelled runs", () => {
  assert.equal(isEmployeeVisiblePayrollStatus("APPROVED"), true);
  assert.equal(isEmployeeVisiblePayrollStatus("PAID"), true);
  assert.equal(isEmployeeVisiblePayrollStatus("DRAFT"), false);
  assert.equal(isEmployeeVisiblePayrollStatus("PROCESSING"), false);
  assert.equal(isEmployeeVisiblePayrollStatus("CANCELLED"), false);
});

test("finalized payroll runs are immutable while generation states remain mutable", () => {
  assert.equal(isMutablePayrollRunStatus("DRAFT"), true);
  assert.equal(isMutablePayrollRunStatus("PROCESSING"), true);
  assert.equal(isMutablePayrollRunStatus("APPROVED"), false);
  assert.equal(isMutablePayrollRunStatus("PAID"), false);
  assert.equal(isMutablePayrollRunStatus("CANCELLED"), false);
});

test("payslip components remain dynamic snapshot data and reject malformed amounts", () => {
  assert.deepEqual(payslipComponents([{ code: "SHIFT_PREMIUM", name: "Shift premium", amount: "12500.00" }, { code: "BAD", name: "Bad", amount: -1 }] as any), [{ code: "SHIFT_PREMIUM", name: "Shift premium", amount: 12500 }]);
});

test("on-demand payslip document is a PDF built only from supplied snapshot lines", () => {
  const pdf = createPayslipPdf(["EMPLOYEE PAYSLIP", "Net pay: NGN 100.00"]);
  assert.equal(pdf.subarray(0, 8).toString(), "%PDF-1.4");
  assert.equal(pdf.includes(Buffer.from("Net pay: NGN 100.00")), true);
});
