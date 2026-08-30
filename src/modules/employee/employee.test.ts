import assert from "node:assert/strict";
import test from "node:test";
import { actionItemPriority, buildEmployeeAttendanceCalendar, createPayslipPdf, dashboardAttendanceState, expectedWorkdaysThrough, inspectProfilePhoto, isEmployeeVisiblePayrollStatus, leaveCalendarDates, maskBankAccountNumber, paginateEmployeeInboxItems, payslipComponents } from "./employee.service";
import { bankUpdateRequestSchema, employeeAppraisalAcknowledgmentSchema, employeeAppraisalGoalConfirmationSchema, employeeAppraisalGoalCreateSchema, employeeAppraisalGoalUpdateSchema, employeeAppraisalHistoryQuerySchema, employeeAttendanceDisputeSchema, employeeAttendanceQuerySchema, employeeDashboardQuerySchema, employeeInboxQuerySchema, employeeLeaveQuerySchema, employeeLeaveRequestSchema, employeePayslipParamsSchema, employeePayslipsQuerySchema, employeeRelieverQuerySchema, employeeSelfAssessmentDraftSchema, updateEmployeePersonalDetailsSchema } from "./employee.validation";
import { isMutablePayrollRunStatus } from "../payroll/payroll.service";
import { appraisalAssessmentFromTemplate, appraisalTemplateSnapshot, isAppraisalSubmissionDeadlineOpen } from "../hris/hris.service";
import { employeeRouter } from "./employee.routes";

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

const appraisalSections = [{ section: "KRA", totalWeight: 100, objectives: [{ title: "Configured objective", weight: 100, keyResults: [{ keyResult: "Configured result", kpiWeight: 100, target: 10, achieved: 8 }] }] }];
const appraisalTemplate = { sections: [{ section: "KRA", weight: 100, objectives: [{ title: "Configured objective", weight: 100, keyResults: [{ description: "Configured result", kpiWeight: 100, target: 10 }] }] }], quarterScoring: false };

test("employee appraisal inputs support goal setting but cannot force identity or workflow state", () => {
  assert.equal(employeeAppraisalGoalCreateSchema.safeParse({ title: "Improve delivery", description: "Improve delivery consistency", successCriteria: "Meet agreed delivery dates", targetDate: "2026-12-31" }).success, true);
  assert.equal(employeeAppraisalGoalUpdateSchema.safeParse({ title: "Changed objective" }).success, true);
  assert.equal(employeeAppraisalGoalConfirmationSchema.safeParse({}).success, true);
  assert.equal(employeeAppraisalGoalConfirmationSchema.safeParse({ employeeId: "another-employee" }).success, false);
  assert.equal(employeeSelfAssessmentDraftSchema.safeParse({ sections: appraisalSections, reflections: [] }).success, true);
  assert.equal(employeeSelfAssessmentDraftSchema.safeParse({ sections: appraisalSections, reflections: [], employeeId: "another-employee", submit: true }).success, false);
  assert.equal(employeeAppraisalAcknowledgmentSchema.safeParse({ response: "Acknowledged" }).success, true);
  assert.equal(employeeAppraisalHistoryQuerySchema.safeParse({ page: 1, limit: 100 }).success, false);
});

test("shared HRIS appraisal snapshot rejects employee changes to targets and weights", () => {
  assert.equal((appraisalAssessmentFromTemplate(appraisalTemplate as any, appraisalSections) as any[])[0].objectives[0].keyResults[0].target, 10);
  assert.throws(() => appraisalAssessmentFromTemplate(appraisalTemplate as any, [{ ...appraisalSections[0], objectives: [{ ...appraisalSections[0].objectives[0], keyResults: [{ ...appraisalSections[0].objectives[0].keyResults[0], target: 999 }] }] }]));
});

test("employee appraisal routes are registered in the shared employee module", () => {
  const routes = (employeeRouter as any).stack.filter((layer: any) => layer.route).flatMap((layer: any) => Object.keys(layer.route.methods).map((method) => `${method.toUpperCase()} ${layer.route.path}`));
  for (const route of ["GET /appraisal", "GET /appraisal/history", "POST /appraisal/:appraisalId/goals", "POST /appraisal/:appraisalId/goals/confirm", "GET /appraisal/:appraisalId/self-assessment", "PUT /appraisal/:appraisalId/self-assessment/draft", "POST /appraisal/:appraisalId/self-assessment/submit", "POST /appraisal/:appraisalId/acknowledge"]) assert.ok(routes.includes(route), route);
});

test("appraisal deadline is inclusive in tenant-local time", () => {
  const deadline = new Date("2026-08-27T00:00:00.000Z");
  assert.equal(isAppraisalSubmissionDeadlineOpen(deadline, new Date("2026-08-27T22:30:00.000Z"), "Africa/Lagos"), true);
  assert.equal(isAppraisalSubmissionDeadlineOpen(deadline, new Date("2026-08-27T23:30:00.000Z"), "Africa/Lagos"), false);
});

test("appraisal snapshot preserves template display metadata", () => {
  const snapshot = appraisalTemplateSnapshot(appraisalTemplate as any, { id: "template-id", name: "Configured Review", version: 3 }) as any;
  assert.deepEqual(snapshot.templateMetadata, { id: "template-id", name: "Configured Review", version: 3 });
  assert.equal(snapshot.sections[0].section, "KRA");
});

const inboxItem = (id: string, status: "PENDING" | "DONE", requiresAction: boolean, eventDate: string, dueDate: string | null = null, readAt: string | null = null) => ({ id, category: "APPRAISAL" as const, type: id, title: id, description: id, status, requiresAction, dueDate: dueDate ? new Date(dueDate) : null, eventDate: new Date(eventDate), readAt: readAt ? new Date(readAt) : null, source: { entityType: "EMPLOYEE_APPRAISAL", entityId: id }, navigation: { target: "MY_APPRAISAL" as const, resourceId: id, action: "VIEW", available: true }, createdAt: new Date(eventDate), completedAt: status === "DONE" ? new Date(eventDate) : null });

test("inbox validation is bounded and rejects employee identity manipulation", () => {
  assert.equal(employeeInboxQuerySchema.safeParse({ status: "pending", page: 1, limit: 20 }).success, true);
  assert.equal(employeeInboxQuerySchema.safeParse({ status: "unknown" }).success, false);
  assert.equal(employeeInboxQuerySchema.safeParse({ employeeId: "another-employee" }).success, false);
  assert.equal(employeeInboxQuerySchema.safeParse({ limit: 101 }).success, false);
});

test("inbox counts and filters use one projection while read state remains independent", () => {
  const items = [inboxItem("later", "PENDING", false, "2026-08-20T00:00:00.000Z", "2026-09-01T00:00:00.000Z", "2026-08-21T00:00:00.000Z"), inboxItem("urgent", "PENDING", true, "2026-08-21T00:00:00.000Z", "2026-08-28T00:00:00.000Z"), inboxItem("complete", "DONE", false, "2026-08-22T00:00:00.000Z")];
  const pending = paginateEmployeeInboxItems(items, { status: "pending", page: 1, limit: 20 });
  assert.deepEqual(pending.counts, { all: 3, pending: 2, done: 1 });
  assert.deepEqual(pending.items.map((item) => item.id), ["urgent", "later"]);
  assert.equal(pending.items[1].status, "PENDING");
  assert.ok(pending.items[1].readAt, "a read workflow item remains pending");
  assert.deepEqual(paginateEmployeeInboxItems(items, { status: "done", page: 1, limit: 20 }).items.map((item) => item.id), ["complete"]);
});

test("employee inbox route is registered in the shared employee module", () => {
  const routes = (employeeRouter as any).stack.filter((layer: any) => layer.route).flatMap((layer: any) => Object.keys(layer.route.methods).map((method) => `${method.toUpperCase()} ${layer.route.path}`));
  assert.ok(routes.includes("GET /inbox"));
});
