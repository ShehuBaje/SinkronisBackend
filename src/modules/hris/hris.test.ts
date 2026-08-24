import test from "node:test";
import assert from "node:assert/strict";
import { attendanceMetric, calculateLeaveDays, calculateWeightedAssessmentScore, classifyAttendance, performanceRatingForScore, performanceRatingValueForScore, shiftDateKey, tenantDateKey, trendForDifference, validateAppraisalTemplateConfiguration, zonedDateTimeToUtc } from "./hris.service";
import { hrisRouter } from "./hris.routes";
import { appraisalTemplateBodySchema, applyLeaveSchema, approveBankUpdateRequestSchema, attendanceLogsQuerySchema, attendanceOverrideSchema, bankUpdateRequestParamsSchema, bankUpdateRequestsQuerySchema, createAppraisalCycleSchema, createAttendanceDisputeSchema, createConductQuerySchema, createSuspensionSchema, employeeListQuerySchema, hrApprovalSchema, leaveApproveSchema, leaveDecisionParamsSchema, leaveListQuerySchema, managerReviewSchema, rejectBankUpdateRequestSchema, rejectLeaveSchema, submitSelfAssessmentSchema, updateConductStatusSchema, updateEmployeeStatusSchema } from "./hris.validation";

test("HRIS dashboard trends return raw differences and normalized direction", () => {
  assert.deepEqual(attendanceMetric(12, 9), { count: 12, previousDayCount: 9, difference: 3, trend: "UP" });
  assert.deepEqual(attendanceMetric(2, 5), { count: 2, previousDayCount: 5, difference: -3, trend: "DOWN" });
  assert.equal(trendForDifference(0), "UNCHANGED");
});

test("tenant date calculations respect timezone boundaries and calendar shifts", () => {
  const instant = new Date("2026-08-17T23:30:00.000Z");
  assert.equal(tenantDateKey(instant, "Africa/Lagos"), "2026-08-18");
  assert.equal(tenantDateKey(instant, "America/New_York"), "2026-08-17");
  assert.equal(shiftDateKey("2026-03-01", -1), "2026-02-28");
  assert.equal(zonedDateTimeToUtc("2026-08-18", "09:00", "Africa/Lagos").toISOString(), "2026-08-18T08:00:00.000Z");
});

test("HRIS dashboard and tenant-scoped leave decision routes are registered", () => {
  const routes = (hrisRouter as any).stack.filter((layer: any) => layer.route).map((layer: any) => layer.route.path);
  assert.deepEqual(routes.slice(0, 3), ["/dashboard", "/leave-requests/:id/approve", "/leave-requests/:id/reject"]);
});

test("appraisal administration and conduct workflow routes are registered centrally", () => {
  const routes = (hrisRouter as any).stack.filter((layer: any) => layer.route).map((layer: any) => layer.route.path);
  for (const path of ["/appraisals/templates", "/appraisals/cycles", "/appraisals/reviews", "/appraisals/:appraisalId/sign-off", "/conduct/overview", "/conduct/queries", "/conduct/suspensions", "/conduct/:conductId/status"]) assert.equal(routes.includes(path), true, `${path} route missing`);
});

test("bank update review routes and decisions are strictly registered and validated", () => {
  const routes = (hrisRouter as any).stack.filter((layer: any) => layer.route).map((layer: any) => layer.route.path);
  for (const path of ["/bank-details-update-requests", "/bank-details-update-requests/:requestId/approve", "/bank-details-update-requests/:requestId/reject"]) assert.equal(routes.includes(path), true, `${path} route missing`);
  assert.equal(bankUpdateRequestParamsSchema.safeParse({ requestId: "request-id" }).success, true);
  assert.equal(bankUpdateRequestsQuerySchema.safeParse({ page: 1, limit: 20, status: "PENDING" }).success, true);
  assert.equal(approveBankUpdateRequestSchema.safeParse({}).success, true);
  assert.equal(rejectBankUpdateRequestSchema.safeParse({ reviewNote: "Account could not be verified" }).success, true);
  assert.equal(rejectBankUpdateRequestSchema.safeParse({}).success, false);
});

test("leave decision inputs reject invalid identifiers and short rejection reasons", () => {
  assert.equal(leaveDecisionParamsSchema.safeParse({ id: "leave-id" }).success, true);
  assert.equal(leaveDecisionParamsSchema.safeParse({ id: "" }).success, false);
  assert.equal(rejectLeaveSchema.safeParse({ reason: "Insufficient coverage" }).success, true);
  assert.equal(rejectLeaveSchema.safeParse({ reason: "x" }).success, false);
});

test("employee filters and lifecycle status updates reject arbitrary input", () => {
  assert.equal(employeeListQuerySchema.safeParse({ page: 1, limit: 20, status: "PROBATION", sortBy: "name", sortOrder: "asc" }).success, true);
  assert.equal(employeeListQuerySchema.safeParse({ status: "OWNER", sortBy: "passwordHash" }).success, false);
  assert.equal(updateEmployeeStatusSchema.safeParse({ status: "CONFIRMED", effectiveDate: "2026-08-18" }).success, true);
  assert.equal(updateEmployeeStatusSchema.safeParse({ status: "CONFIRMED", effectiveDate: "18/08/2026" }).success, false);
});

test("attendance filters, overrides, and disputes are strictly validated", () => {
  assert.equal(attendanceLogsQuerySchema.safeParse({ from: "2026-08-01", to: "2026-08-18", status: "LATE" }).success, true);
  assert.equal(attendanceLogsQuerySchema.safeParse({ from: "2026-08-19", to: "2026-08-18" }).success, false);
  assert.equal(attendanceOverrideSchema.safeParse({ clockIn: "07:45", reason: "Biometric scanner failed" }).success, true);
  assert.equal(attendanceOverrideSchema.safeParse({ clockIn: "25:45", reason: "x" }).success, false);
  assert.equal(createAttendanceDisputeSchema.safeParse({ issueType: "MISSING_CLOCK_IN", description: "The biometric scanner failed to record entry." }).success, true);
});

test("attendance classification uses persisted grace and overtime thresholds", () => {
  const schedule = { workStartTime: "09:00", workEndTime: "17:00", gracePeriodMinutes: 15, overtimeAfterMinutes: 30 };
  const late = classifyAttendance({ clockInAt: new Date("2026-08-18T08:16:00.000Z"), clockOutAt: new Date("2026-08-18T17:00:00.000Z") }, schedule, "Africa/Lagos");
  assert.equal(late.primaryStatus, "LATE");
  assert.equal(late.flags.includes("OVERTIME"), true);
});

test("leave dates, filters, and scheduled-day calculation are validated centrally", () => {
  assert.equal(applyLeaveSchema.safeParse({ leaveType: "annual_leave", fromDate: "2026-08-20", toDate: "2026-08-24", reason: "Personal leave" }).success, true);
  assert.equal(applyLeaveSchema.safeParse({ leaveType: "ANNUAL_LEAVE", fromDate: "2026-08-25", toDate: "2026-08-24", reason: "Personal leave" }).success, false);
  assert.equal(leaveListQuerySchema.safeParse({ status: "PENDING", page: 1, limit: 20 }).success, true);
  const schedule = { monday: true, tuesday: true, wednesday: true, thursday: true, friday: true, saturday: false, sunday: false } as any;
  assert.equal(calculateLeaveDays("2026-08-20", "2026-08-24", schedule), 3);
});

test("leave approval accepts only an optional employee-visible manager comment", () => {
  assert.equal(leaveApproveSchema.safeParse({ comment: "Approved with handover completed." }).success, true);
  assert.equal(leaveApproveSchema.safeParse({}).success, true);
  assert.equal(leaveApproveSchema.safeParse({ internalNotes: "Do not expose" }).success, false);
});

test("weighted appraisal scoring recalculates numeric KPI results and rating bands", () => {
  const result = calculateWeightedAssessmentScore([
    { section: "KRA", totalWeight: 80, objectives: [{ title: "Growth", weight: 80, keyResults: [{ keyResult: "Target", kpiWeight: 80, target: 100, achieved: 88 }] }] },
    { section: "BEHAVIOURAL", totalWeight: 20, objectives: [{ title: "Leadership", weight: 20, keyResults: [{ keyResult: "Feedback", kpiWeight: 20, target: 100, achieved: 78 }] }] }
  ]);
  assert.equal(result.score, 86);
  assert.equal(performanceRatingForScore(result.score), "MEETS_EXPECTATION");
  assert.equal(result.sections[0].objectives[0].keyResults[0].resultPercentage, 70.4);
});

test("appraisal workflow payloads reject invalid scores, recommendations, and decisions", () => {
  const assessment = { sections: [{ section: "KRA", totalWeight: 100, objectives: [{ title: "Goal", weight: 100, keyResults: [{ keyResult: "Result", kpiWeight: 100, target: 100, achieved: 80 }] }] }], reflections: [], submit: true };
  assert.equal(submitSelfAssessmentSchema.safeParse(assessment).success, true);
  assert.equal(managerReviewSchema.safeParse({ goalRatings: [{ goalId: "goal", rating: 6 }], responses: [], overallFeedback: "Good progress", recommendation: "ON_TRACK" }).success, false);
  assert.equal(hrApprovalSchema.safeParse({ decision: "APPROVED", hrNotes: "Approved" }).success, true);
  assert.equal(hrApprovalSchema.safeParse({ decision: "REJECTED" }).success, false);
});

test("appraisal templates enforce nested 100 percent weighting and the UI rating scale", () => {
  const template = { name: "Standard Review", sections: [{ section: "KRA", weight: 80, objectives: [{ title: "Growth", weight: 80, keyResults: [{ description: "Target", kpiWeight: 80, target: 100 }] }] }, { section: "BEHAVIOURAL", weight: 20, objectives: [{ title: "Leadership", weight: 20, keyResults: [{ description: "Feedback", kpiWeight: 20, target: 100 }] }] }] };
  assert.equal(appraisalTemplateBodySchema.safeParse(template).success, true);
  assert.doesNotThrow(() => validateAppraisalTemplateConfiguration(template));
  assert.throws(() => validateAppraisalTemplateConfiguration({ ...template, sections: [template.sections[0]] }));
  assert.equal(performanceRatingForScore(121), "OUTSTANDING");
  assert.equal(performanceRatingValueForScore(110), 4);
  assert.equal(performanceRatingForScore(79), "BELOW_EXPECTATION");
});

test("appraisal cycles and conduct workflows reject invalid dates, types, and transitions", () => {
  assert.equal(createAppraisalCycleSchema.safeParse({ cycleName: "Q3 Review", templateId: "template", periodFrom: "2026-07-01", periodTo: "2026-09-30", submissionDeadline: "2026-10-15", launchMode: "LAUNCH_AS_ACTIVE" }).success, true);
  assert.equal(createAppraisalCycleSchema.safeParse({ cycleName: "Q3 Review", templateId: "template", periodFrom: "2026-09-30", periodTo: "2026-07-01", submissionDeadline: "2026-10-15", launchMode: "SAVE_AS_DRAFT" }).success, false);
  assert.equal(createConductQuerySchema.safeParse({ employeeId: "employee", queryType: "INSUBORDINATION", notes: "Refused a manager directive" }).success, true);
  assert.equal(createSuspensionSchema.safeParse({ employeeId: "employee", queryType: "GROSS_MISCONDUCT", durationValue: 2, durationUnit: "WEEK", notes: "Suspension pending investigation" }).success, true);
  assert.equal(updateConductStatusSchema.safeParse({ status: "UNKNOWN" }).success, false);
});
