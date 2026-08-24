import { Router } from "express";
import multer from "multer";
import { asyncHandler } from "../../core/async-handler";
import { createCrudRouter } from "../../core/crud-router";
import { validate } from "../../core/validate";
import { authorize } from "../../middleware/rbac.middleware";
import { acknowledgeAppraisalController, applyLeaveController, approveAppraisalHRController, approveBankDetailsUpdateRequestController, approveLeaveController, approveLeaveRequestController, clockInController, clockOutController, createAppraisalGoalController, createAttendanceDisputeController, createEmployeeController, downloadEmployeeTemplateController, exportAttendanceController, getActiveAppraisalCycleController, getAppraisalController, getAppraisalOverviewController, getAttendanceController, getAttendanceDisputeController, getAttendanceOverviewController, getDailyAttendanceController, getDepartmentAttendanceController, getEmployeeActivityController, getEmployeeAppraisalsController, getEmployeeAttendanceController, getEmployeeConductController, getEmployeeController, getEmployeeLeaveController, getEmployeePayrollController, getHRApprovalController, getHRISDashboardController, getLeaveOverviewController, getManagerReviewController, getMonthlyAttendanceController, getMyAttendanceTodayController, getSelfAssessmentController, importEmployeesController, inviteEmployeeController, listAppraisalsController, listAttendanceDisputesController, listAttendanceLogsController, listBankDetailsUpdateRequestsController, listEmployeesController, listLeavesController, listLifecycleEmployeesController, overrideAttendanceController, rejectBankDetailsUpdateRequestController, rejectLeaveController, rejectLeaveRequestController, resolveAttendanceDisputeController, saveManagerReviewController, saveSelfAssessmentController, scoreAppraisalGoalController, updateEmployeeController, updateEmployeeStatusController } from "./hris.controller";
import { userManagementInviteSchema } from "../admin/admin.validation";
import {
  attendanceCrudOptions,
  employeesCrudOptions,
  leaveCrudOptions
} from "./hris.service";
import { acknowledgeAppraisalSchema, appraisalGoalParamsSchema, appraisalListQuerySchema, appraisalParamsSchema, applyLeaveSchema, approveBankUpdateRequestSchema, attendanceDateQuerySchema, attendanceLogsQuerySchema, attendanceOverrideSchema, attendanceParamsSchema, bankUpdateRequestParamsSchema, bankUpdateRequestsQuerySchema, clockInSchema, clockOutParamsSchema, createAppraisalGoalSchema, createAttendanceDisputeSchema, createManagedEmployeeSchema, disputeListQuerySchema, disputeParamsSchema, employeeHistoryQuerySchema, employeeListQuerySchema, employeeParamsSchema, hrApprovalSchema, leaveDecisionParamsSchema, leaveListQuerySchema, leaveParamsSchema, leaveRejectSchema, lifecycleQuerySchema, managerReviewSchema, monthlyAttendanceQuerySchema, rejectBankUpdateRequestSchema, rejectLeaveSchema, resolveAttendanceDisputeSchema, scoreAppraisalGoalSchema, submitSelfAssessmentSchema, updateEmployeeStatusSchema, updateManagedEmployeeSchema } from "./hris.validation";
import { badRequest } from "../../core/http-error";
import { completeAppraisalCycleController, createAppraisalCycleController, createAppraisalTemplateController, createConductQueryController, createSuspensionController, deleteAppraisalCycleController, deleteAppraisalTemplateController, getAppraisalSettingsController, getAppraisalTemplateController, getConductController, getConductOverviewController, launchAppraisalCycleController, listAppraisalCyclesController, listAppraisalTemplatesController, listConductController, listCycleReviewsController, signOffAppraisalController, updateAppraisalSettingsController, updateAppraisalTemplateController, updateConductStatusController } from "./hris.controller";
import { openAppraisalSelfAssessmentController } from "./hris.controller";
import { appraisalCycleParamsSchema, appraisalCyclesQuerySchema, appraisalSettingsSchema, appraisalSignOffSchema, appraisalTemplateBodySchema, appraisalTemplateParamsSchema, appraisalTemplatesQuerySchema, appraisalTemplateUpdateSchema, conductListQuerySchema, conductParamsSchema, createAppraisalCycleSchema, createConductQuerySchema, createSuspensionSchema, deleteAppraisalCycleSchema, launchAppraisalCycleSchema, updateConductStatusSchema } from "./hris.validation";

export const hrisRouter = Router();
const csvUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 }, fileFilter: (_req, file, callback) => {
  if (file.mimetype !== "text/csv" && file.mimetype !== "application/vnd.ms-excel") return callback(badRequest("Bulk employee import requires a CSV file") as any);
  return callback(null, true);
} });
const employeeUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 11 }, fileFilter: (_req, file, callback) => {
  const images = ["image/png", "image/jpeg"]; const documents = [...images, "application/pdf"];
  const accepted = file.fieldname === "profileImage" ? images.includes(file.mimetype) : documents.includes(file.mimetype);
  return accepted ? callback(null, true) : callback(badRequest("Unsupported employee file MIME type") as any);
} }).fields([{ name: "profileImage", maxCount: 1 }, { name: "appointmentLetter", maxCount: 1 }, { name: "documents", maxCount: 9 }]);
const normalizeEmployeeMultipart = (req: any, _res: any, next: any) => {
  try { if (typeof req.body.data === "string") req.body = JSON.parse(req.body.data); next(); } catch { next(badRequest("Employee multipart data must be valid JSON")); }
};

hrisRouter.get(
  "/dashboard",
  authorize("hris:employees:view", "hris:attendance:view", "hris:leave:view"),
  asyncHandler(getHRISDashboardController)
);
hrisRouter.patch(
  "/leave-requests/:id/approve",
  authorize("hris:leave:approve"),
  validate({ params: leaveDecisionParamsSchema }),
  asyncHandler(approveLeaveRequestController)
);

hrisRouter.patch(
  "/leave-requests/:id/reject",
  authorize("hris:leave:approve"),
  validate({ params: leaveDecisionParamsSchema, body: rejectLeaveSchema }),
  asyncHandler(rejectLeaveRequestController)
);

hrisRouter.get("/bank-details-update-requests", authorize("hris:employees:update"), validate({ query: bankUpdateRequestsQuerySchema }), asyncHandler(listBankDetailsUpdateRequestsController));
hrisRouter.patch("/bank-details-update-requests/:requestId/approve", authorize("hris:employees:update"), validate({ params: bankUpdateRequestParamsSchema, body: approveBankUpdateRequestSchema }), asyncHandler(approveBankDetailsUpdateRequestController));
hrisRouter.patch("/bank-details-update-requests/:requestId/reject", authorize("hris:employees:update"), validate({ params: bankUpdateRequestParamsSchema, body: rejectBankUpdateRequestSchema }), asyncHandler(rejectBankDetailsUpdateRequestController));

hrisRouter.get("/leaves/overview", authorize("hris:leave:approve"), asyncHandler(getLeaveOverviewController));
hrisRouter.get("/leaves", authorize("hris:leave:view"), validate({ query: leaveListQuerySchema }), asyncHandler(listLeavesController));
hrisRouter.post("/leaves", authorize("hris:leave:create"), validate({ body: applyLeaveSchema }), asyncHandler(applyLeaveController));
hrisRouter.patch("/leaves/:leaveId/approve", authorize("hris:leave:approve"), validate({ params: leaveParamsSchema }), asyncHandler(approveLeaveController));
hrisRouter.patch("/leaves/:leaveId/reject", authorize("hris:leave:approve"), validate({ params: leaveParamsSchema, body: leaveRejectSchema }), asyncHandler(rejectLeaveController));

hrisRouter.get("/appraisals/overview", authorize("hris:appraisals:update"), asyncHandler(getAppraisalOverviewController));
hrisRouter.get("/appraisals/cycles/active", authorize("hris:appraisals:update"), asyncHandler(getActiveAppraisalCycleController));
hrisRouter.get("/appraisals/settings", authorize("hris:appraisals:update"), asyncHandler(getAppraisalSettingsController));
hrisRouter.patch("/appraisals/settings", authorize("hris:appraisals:update"), validate({ body: appraisalSettingsSchema }), asyncHandler(updateAppraisalSettingsController));
hrisRouter.get("/appraisals/templates", authorize("hris:appraisals:update"), validate({ query: appraisalTemplatesQuerySchema }), asyncHandler(listAppraisalTemplatesController));
hrisRouter.post("/appraisals/templates", authorize("hris:appraisals:update"), validate({ body: appraisalTemplateBodySchema }), asyncHandler(createAppraisalTemplateController));
hrisRouter.get("/appraisals/templates/:templateId", authorize("hris:appraisals:update"), validate({ params: appraisalTemplateParamsSchema }), asyncHandler(getAppraisalTemplateController));
hrisRouter.patch("/appraisals/templates/:templateId", authorize("hris:appraisals:update"), validate({ params: appraisalTemplateParamsSchema, body: appraisalTemplateUpdateSchema }), asyncHandler(updateAppraisalTemplateController));
hrisRouter.delete("/appraisals/templates/:templateId", authorize("hris:appraisals:update"), validate({ params: appraisalTemplateParamsSchema }), asyncHandler(deleteAppraisalTemplateController));
hrisRouter.get("/appraisals/cycles", authorize("hris:appraisals:update"), validate({ query: appraisalCyclesQuerySchema }), asyncHandler(listAppraisalCyclesController));
hrisRouter.post("/appraisals/cycles", authorize("hris:appraisals:update"), validate({ body: createAppraisalCycleSchema }), asyncHandler(createAppraisalCycleController));
hrisRouter.post("/appraisals/cycles/:cycleId/launch", authorize("hris:appraisals:update"), validate({ params: appraisalCycleParamsSchema, body: launchAppraisalCycleSchema }), asyncHandler(launchAppraisalCycleController));
hrisRouter.post("/appraisals/cycles/:cycleId/complete", authorize("hris:appraisals:update"), validate({ params: appraisalCycleParamsSchema, body: launchAppraisalCycleSchema }), asyncHandler(completeAppraisalCycleController));
hrisRouter.get("/appraisals/cycles/:cycleId/reviews", authorize("hris:appraisals:view"), validate({ params: appraisalCycleParamsSchema, query: appraisalListQuerySchema }), (req, _res, next) => { req.query.cycleId = String(req.params.cycleId); next(); }, asyncHandler(listCycleReviewsController));
hrisRouter.delete("/appraisals/cycles/:cycleId", authorize("hris:appraisals:update"), validate({ params: appraisalCycleParamsSchema, body: deleteAppraisalCycleSchema }), asyncHandler(deleteAppraisalCycleController));
hrisRouter.get("/appraisals/reviews", authorize("hris:appraisals:view"), validate({ query: appraisalListQuerySchema }), asyncHandler(listAppraisalsController));
hrisRouter.get("/appraisals", authorize("hris:appraisals:view"), validate({ query: appraisalListQuerySchema }), asyncHandler(listAppraisalsController));
hrisRouter.get("/appraisals/:appraisalId", authorize("hris:appraisals:view"), validate({ params: appraisalParamsSchema }), asyncHandler(getAppraisalController));
hrisRouter.post("/appraisals/:appraisalId/goals", authorize("hris:appraisals:update"), validate({ params: appraisalParamsSchema, body: createAppraisalGoalSchema }), asyncHandler(createAppraisalGoalController));
hrisRouter.patch("/appraisals/:appraisalId/goals/:goalId", authorize("hris:appraisals:view"), validate({ params: appraisalGoalParamsSchema, body: scoreAppraisalGoalSchema }), asyncHandler(scoreAppraisalGoalController));
hrisRouter.post("/appraisals/:appraisalId/goals/complete", authorize("hris:appraisals:update"), validate({ params: appraisalParamsSchema, body: launchAppraisalCycleSchema }), asyncHandler(openAppraisalSelfAssessmentController));
hrisRouter.get("/appraisals/:appraisalId/self-assessment", authorize("hris:appraisals:view"), validate({ params: appraisalParamsSchema }), asyncHandler(getSelfAssessmentController));
hrisRouter.post("/appraisals/:appraisalId/self-assessment", authorize("hris:appraisals:view"), validate({ params: appraisalParamsSchema, body: submitSelfAssessmentSchema }), asyncHandler(saveSelfAssessmentController));
hrisRouter.get("/appraisals/:appraisalId/manager-review", authorize("hris:appraisals:view"), validate({ params: appraisalParamsSchema }), asyncHandler(getManagerReviewController));
hrisRouter.post("/appraisals/:appraisalId/manager-review", authorize("hris:appraisals:update"), validate({ params: appraisalParamsSchema, body: managerReviewSchema }), asyncHandler(saveManagerReviewController));
hrisRouter.get("/appraisals/:appraisalId/hr-approval", authorize("hris:appraisals:update"), validate({ params: appraisalParamsSchema }), asyncHandler(getHRApprovalController));
hrisRouter.post("/appraisals/:appraisalId/hr-approval", authorize("hris:appraisals:update"), validate({ params: appraisalParamsSchema, body: hrApprovalSchema }), asyncHandler(approveAppraisalHRController));
hrisRouter.post("/appraisals/:appraisalId/acknowledge", authorize("hris:appraisals:view"), validate({ params: appraisalParamsSchema, body: acknowledgeAppraisalSchema }), asyncHandler(acknowledgeAppraisalController));
hrisRouter.post("/appraisals/:appraisalId/sign-off", authorize("hris:appraisals:view"), validate({ params: appraisalParamsSchema, body: appraisalSignOffSchema }), asyncHandler(signOffAppraisalController));

hrisRouter.get("/conduct/overview", authorize("hris:conduct:view"), asyncHandler(getConductOverviewController));
hrisRouter.get("/conduct", authorize("hris:conduct:view"), validate({ query: conductListQuerySchema }), asyncHandler(listConductController));
hrisRouter.post("/conduct/queries", authorize("hris:conduct:update"), validate({ body: createConductQuerySchema }), asyncHandler(createConductQueryController));
hrisRouter.post("/conduct/suspensions", authorize("hris:conduct:update"), validate({ body: createSuspensionSchema }), asyncHandler(createSuspensionController));
hrisRouter.get("/conduct/:conductId", authorize("hris:conduct:view"), validate({ params: conductParamsSchema }), asyncHandler(getConductController));
hrisRouter.patch("/conduct/:conductId/status", authorize("hris:conduct:update"), validate({ params: conductParamsSchema, body: updateConductStatusSchema }), asyncHandler(updateConductStatusController));

hrisRouter.get("/employees/lifecycle", authorize("hris:employees:view"), validate({ query: lifecycleQuerySchema }), asyncHandler(listLifecycleEmployeesController));
hrisRouter.get("/employees/import/template", authorize("hris:employees:create"), asyncHandler(downloadEmployeeTemplateController));
hrisRouter.post("/employees/import", authorize("hris:employees:create"), csvUpload.single("file"), asyncHandler(importEmployeesController));
hrisRouter.post("/employees/invite", authorize("hris:employees:create"), validate({ body: userManagementInviteSchema }), asyncHandler(inviteEmployeeController));
hrisRouter.get("/employees", authorize("hris:employees:view"), validate({ query: employeeListQuerySchema }), asyncHandler(listEmployeesController));
hrisRouter.post("/employees", authorize("hris:employees:create"), employeeUpload, normalizeEmployeeMultipart, validate({ body: createManagedEmployeeSchema }), asyncHandler(createEmployeeController));
hrisRouter.patch("/employees/:employeeId/status", authorize("hris:employees:update"), validate({ params: employeeParamsSchema, body: updateEmployeeStatusSchema }), asyncHandler(updateEmployeeStatusController));
hrisRouter.get("/employees/:employeeId/attendance", authorize("hris:employees:view", "hris:attendance:view"), validate({ params: employeeParamsSchema, query: employeeHistoryQuerySchema }), asyncHandler(getEmployeeAttendanceController));
hrisRouter.get("/employees/:employeeId/leave-history", authorize("hris:employees:view", "hris:leave:view"), validate({ params: employeeParamsSchema, query: employeeHistoryQuerySchema }), asyncHandler(getEmployeeLeaveController));
hrisRouter.get("/employees/:employeeId/payroll-history", authorize("hris:employees:view", "payroll:payslips:view"), validate({ params: employeeParamsSchema, query: employeeHistoryQuerySchema }), asyncHandler(getEmployeePayrollController));
hrisRouter.get("/employees/:employeeId/appraisals", authorize("hris:employees:view", "hris:appraisals:view"), validate({ params: employeeParamsSchema, query: employeeHistoryQuerySchema }), asyncHandler(getEmployeeAppraisalsController));
hrisRouter.get("/employees/:employeeId/conduct", authorize("hris:employees:view", "hris:conduct:view"), validate({ params: employeeParamsSchema, query: employeeHistoryQuerySchema }), asyncHandler(getEmployeeConductController));
hrisRouter.get("/employees/:employeeId/activity", authorize("hris:employees:view"), validate({ params: employeeParamsSchema, query: employeeHistoryQuerySchema }), asyncHandler(getEmployeeActivityController));
hrisRouter.get("/employees/:employeeId", authorize("hris:employees:view"), validate({ params: employeeParamsSchema }), asyncHandler(getEmployeeController));
hrisRouter.patch("/employees/:employeeId", authorize("hris:employees:update"), validate({ params: employeeParamsSchema, body: updateManagedEmployeeSchema }), asyncHandler(updateEmployeeController));

hrisRouter.use(
  "/employees",
  createCrudRouter(employeesCrudOptions)
);

hrisRouter.post(
  "/attendance/clock-in",
  authorize("hris:attendance:create"),
  validate({ body: clockInSchema }),
  asyncHandler(clockInController)
);

hrisRouter.get("/attendance/daily", authorize("hris:attendance:view"), validate({ query: attendanceDateQuerySchema }), asyncHandler(getDailyAttendanceController));
hrisRouter.get("/attendance/me/today", authorize("hris:attendance:view"), asyncHandler(getMyAttendanceTodayController));
hrisRouter.get("/attendance/logs", authorize("hris:attendance:view"), validate({ query: attendanceLogsQuerySchema }), asyncHandler(listAttendanceLogsController));
hrisRouter.get("/attendance/overview", authorize("hris:attendance:view"), validate({ query: attendanceLogsQuerySchema }), asyncHandler(getAttendanceOverviewController));
hrisRouter.get("/attendance/export", authorize("hris:attendance:view"), validate({ query: attendanceLogsQuerySchema }), asyncHandler(exportAttendanceController));
hrisRouter.get("/attendance/departments/summary", authorize("hris:attendance:view"), validate({ query: attendanceLogsQuerySchema }), asyncHandler(getDepartmentAttendanceController));
hrisRouter.get("/attendance/monthly", authorize("hris:attendance:view"), validate({ query: monthlyAttendanceQuerySchema }), asyncHandler(getMonthlyAttendanceController));
hrisRouter.get("/attendance/disputes", authorize("hris:attendance:view"), validate({ query: disputeListQuerySchema }), asyncHandler(listAttendanceDisputesController));
hrisRouter.get("/attendance/disputes/:disputeId", authorize("hris:attendance:view"), validate({ params: disputeParamsSchema }), asyncHandler(getAttendanceDisputeController));
hrisRouter.patch("/attendance/disputes/:disputeId", authorize("hris:attendance:update"), validate({ params: disputeParamsSchema, body: resolveAttendanceDisputeSchema }), asyncHandler(resolveAttendanceDisputeController));
hrisRouter.patch("/attendance/:attendanceId/override", authorize("hris:attendance:update"), validate({ params: attendanceParamsSchema, body: attendanceOverrideSchema }), asyncHandler(overrideAttendanceController));
hrisRouter.post("/attendance/:attendanceId/disputes", authorize("hris:attendance:view"), validate({ params: attendanceParamsSchema, body: createAttendanceDisputeSchema }), asyncHandler(createAttendanceDisputeController));
hrisRouter.get("/attendance", authorize("hris:attendance:view"), validate({ query: attendanceDateQuerySchema }), asyncHandler(getAttendanceController));

hrisRouter.post(
  "/attendance/:id/clock-out",
  authorize("hris:attendance:update"),
  validate({ params: clockOutParamsSchema }),
  asyncHandler(clockOutController)
);

hrisRouter.use(
  "/attendance",
  createCrudRouter(attendanceCrudOptions)
);

hrisRouter.use(
  "/leave",
  createCrudRouter(leaveCrudOptions)
);
