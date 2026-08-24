import type { Request, Response } from "express";
import { sendSuccess } from "../../core/api-response";
import { badRequest } from "../../core/http-error";
import { inviteUser } from "../admin/admin.service";
import { acknowledgeAppraisal, applyForLeave, approveAppraisalHR, archiveAppraisalTemplate, clockIn, clockOut, completeAppraisalCycle, createAppraisalCycle, createAppraisalGoal, createAppraisalTemplate, createAttendanceDispute, createConductQuery, createManagedEmployee, createManagedEmployeeWithFiles, createSuspension, decideLeave, deleteAppraisalCycle, employeeImportTemplate, exportAttendanceCsv, getActiveAppraisalCycle, getAppraisalDetail, getAppraisalOverview, getAppraisalSettings, getAppraisalTemplate, getAttendanceDispute, getAttendanceOverview, getConductOverview, getConductRecord, getDailyAttendance, getDepartmentAttendanceSummary, getEmployeeActivity, getEmployeeAppraisalHistory, getEmployeeAttendanceHistory, getEmployeeConductHistory, getEmployeeLeaveHistory, getEmployeePayrollHistory, getHRApproval, getHRISDashboard, getLeaveOverview, getManagedEmployeeProfile, getManagerReview, getMonthlyAttendance, getMyAttendanceToday, getSelfAssessment, importEmployeesCsv, launchAppraisalCycle, listAppraisalCycles, listAppraisals, listAppraisalTemplates, listAttendanceDisputes, listAttendanceLogs, listBankDetailsUpdateRequests, listConductRecords, listLeaves, listManagedEmployees, overrideAttendance, resolveAttendanceDispute, reviewBankDetailsUpdateRequest, reviewLeaveRequest, saveManagerReview, saveSelfAssessment, scoreAppraisalGoal, signOffAppraisal, updateAppraisalSettings, updateAppraisalTemplate, updateConductStatus, updateManagedEmployee, updateManagedEmployeeStatus } from "./hris.service";
import { openAppraisalSelfAssessment } from "./hris.service";

export const clockInController = async (req: any, res: any) => {
  const attendance = await clockIn(req.organizationId!, req.body);
  res.status(201).json(attendance);
};

export const clockOutController = async (req: any, res: any) => {
  const attendance = await clockOut(req.organizationId!, String(req.params.id));
  res.json(attendance);
};

export const getHRISDashboardController = async (req: Request, res: Response) =>
  sendSuccess(res, "HRIS dashboard retrieved successfully", await getHRISDashboard(req.organizationId!, req.user!));
export const listBankDetailsUpdateRequestsController = async (req: Request, res: Response) => { const result = await listBankDetailsUpdateRequests(req.organizationId!, req.query); return sendSuccess(res, "Bank details update requests retrieved successfully", result.records, { pagination: result.pagination }); };
export const approveBankDetailsUpdateRequestController = async (req: Request, res: Response) => sendSuccess(res, "Bank details update request approved successfully", await reviewBankDetailsUpdateRequest(req.organizationId!, String(req.params.requestId), "APPROVED", req.body.reviewNote, req.user!));
export const rejectBankDetailsUpdateRequestController = async (req: Request, res: Response) => sendSuccess(res, "Bank details update request rejected successfully", await reviewBankDetailsUpdateRequest(req.organizationId!, String(req.params.requestId), "REJECTED", req.body.reviewNote, req.user!));

export const approveLeaveRequestController = async (req: Request, res: Response) =>
  sendSuccess(res, "Leave request approved successfully", await reviewLeaveRequest({
    leaveRequestId: String(req.params.id), organizationId: req.organizationId!,
    actorUserId: req.user!.id, decision: "APPROVED", reason: req.body.comment
  }));

export const rejectLeaveRequestController = async (req: Request, res: Response) =>
  sendSuccess(res, "Leave request rejected successfully", await reviewLeaveRequest({
    leaveRequestId: String(req.params.id), organizationId: req.organizationId!,
    actorUserId: req.user!.id, decision: "REJECTED", reason: req.body.reason
  }));

export const listEmployeesController = async (req: Request, res: Response) => { const result = await listManagedEmployees(req.organizationId!, req.query); return sendSuccess(res, "Employees retrieved successfully", result.employees, { pagination: result.pagination }); };
export const listLifecycleEmployeesController = listEmployeesController;
export const getEmployeeController = async (req: Request, res: Response) => sendSuccess(res, "Employee retrieved successfully", await getManagedEmployeeProfile(req.organizationId!, String(req.params.employeeId), req.user!));
export const createEmployeeController = async (req: Request, res: Response) => sendSuccess(res, "Employee created successfully", req.files ? await createManagedEmployeeWithFiles(req.organizationId!, req.body, Object.values(req.files as Record<string, Express.Multer.File[]>).flat(), req.user!, `${req.protocol}://${req.get("host")}`) : await createManagedEmployee(req.organizationId!, req.body, req.user!), { status: 201 });
export const updateEmployeeController = async (req: Request, res: Response) => sendSuccess(res, "Employee updated successfully", await updateManagedEmployee(req.organizationId!, String(req.params.employeeId), req.body, req.user!));
export const updateEmployeeStatusController = async (req: Request, res: Response) => sendSuccess(res, "Employee status updated successfully", await updateManagedEmployeeStatus(req.organizationId!, String(req.params.employeeId), req.body, req.user!));
const historyController = (service: (organizationId: string, employeeId: string, query: any, user: any) => Promise<any>, message: string) => async (req: Request, res: Response) => { const result = await service(req.organizationId!, String(req.params.employeeId), req.query, req.user!); return sendSuccess(res, message, result.records ?? result, result.pagination ? { pagination: result.pagination, metadata: result.availability ? { availability: result.availability } : undefined } : undefined); };
export const getEmployeeAttendanceController = historyController(getEmployeeAttendanceHistory as any, "Employee attendance retrieved successfully");
export const getEmployeeLeaveController = historyController(getEmployeeLeaveHistory as any, "Employee leave history retrieved successfully");
export const getEmployeePayrollController = historyController(getEmployeePayrollHistory as any, "Employee payroll history retrieved successfully");
export const getEmployeeConductController = historyController(getEmployeeConductHistory as any, "Employee conduct history retrieved successfully");
export const getEmployeeAppraisalsController = historyController(getEmployeeAppraisalHistory as any, "Employee appraisal history retrieved successfully");
export const getEmployeeActivityController = historyController(getEmployeeActivity as any, "Employee activity retrieved successfully");
export const downloadEmployeeTemplateController = async (_req: Request, res: Response) => res.status(200).type("text/csv; charset=utf-8").attachment("employee-import-template.csv").send(employeeImportTemplate());
export const importEmployeesController = async (req: Request, res: Response) => { if (!req.file) throw badRequest("CSV file is required"); return sendSuccess(res, "Employees imported successfully", await importEmployeesCsv(req.organizationId!, req.file.buffer, req.user!), { status: 201 }); };
export const inviteEmployeeController = async (req: Request, res: Response) => sendSuccess(res, "Employee invitation created successfully", await inviteUser(req), { status: 201 });

export const getAttendanceController = async (req: Request, res: Response) => sendSuccess(res, "Attendance retrieved successfully", await getDailyAttendance(req.organizationId!, req.query));
export const getDailyAttendanceController = getAttendanceController;
export const getMyAttendanceTodayController = async (req: Request, res: Response) => sendSuccess(res, "Current attendance retrieved successfully", await getMyAttendanceToday(req.organizationId!, req.user!));
export const listAttendanceLogsController = async (req: Request, res: Response) => { const result = await listAttendanceLogs(req.organizationId!, req.query); return sendSuccess(res, "Attendance logs retrieved successfully", result.records, { pagination: result.pagination, metadata: { selectedRange: result.selectedRange } }); };
export const getAttendanceOverviewController = async (req: Request, res: Response) => sendSuccess(res, "Attendance overview retrieved successfully", await getAttendanceOverview(req.organizationId!, req.query));
export const getDepartmentAttendanceController = async (req: Request, res: Response) => sendSuccess(res, "Department attendance summary retrieved successfully", await getDepartmentAttendanceSummary(req.organizationId!, req.query));
export const getMonthlyAttendanceController = async (req: Request, res: Response) => { const result = await getMonthlyAttendance(req.organizationId!, req.query); return sendSuccess(res, "Monthly attendance retrieved successfully", result.records, { pagination: result.pagination, metadata: { month: result.month, availability: result.availability } }); };
export const overrideAttendanceController = async (req: Request, res: Response) => sendSuccess(res, "Attendance overridden successfully", await overrideAttendance(req.organizationId!, String(req.params.attendanceId), req.body, req.user!));
export const createAttendanceDisputeController = async (req: Request, res: Response) => sendSuccess(res, "Attendance dispute created successfully", await createAttendanceDispute(req.organizationId!, String(req.params.attendanceId), req.body, req.user!), { status: 201 });
export const listAttendanceDisputesController = async (req: Request, res: Response) => { const result = await listAttendanceDisputes(req.organizationId!, req.query); return sendSuccess(res, "Attendance disputes retrieved successfully", result.disputes, { pagination: result.pagination }); };
export const getAttendanceDisputeController = async (req: Request, res: Response) => sendSuccess(res, "Attendance dispute retrieved successfully", await getAttendanceDispute(req.organizationId!, String(req.params.disputeId)));
export const resolveAttendanceDisputeController = async (req: Request, res: Response) => sendSuccess(res, "Attendance dispute resolved successfully", await resolveAttendanceDispute(req.organizationId!, String(req.params.disputeId), req.body, req.user!));
export const exportAttendanceController = async (req: Request, res: Response) => { const result = await exportAttendanceCsv(req.organizationId!, req.query); return res.status(200).type("text/csv; charset=utf-8").attachment(result.filename).send(result.csv); };

export const getLeaveOverviewController = async (req: Request, res: Response) => sendSuccess(res, "Leave overview retrieved successfully", await getLeaveOverview(req.organizationId!));
export const listLeavesController = async (req: Request, res: Response) => { const result = await listLeaves(req.organizationId!, req.query, req.user!); return sendSuccess(res, "Leave requests retrieved successfully", result.leaves, { pagination: result.pagination }); };
export const applyLeaveController = async (req: Request, res: Response) => sendSuccess(res, "Leave request submitted successfully", await applyForLeave(req.organizationId!, req.body, req.user!), { status: 201 });
export const approveLeaveController = async (req: Request, res: Response) => sendSuccess(res, "Leave request approved successfully", await decideLeave(req.organizationId!, String(req.params.leaveId), "APPROVED", req.body.comment, req.user!));
export const rejectLeaveController = async (req: Request, res: Response) => sendSuccess(res, "Leave request rejected successfully", await decideLeave(req.organizationId!, String(req.params.leaveId), "REJECTED", req.body.reason, req.user!));

export const getAppraisalOverviewController = async (req: Request, res: Response) => sendSuccess(res, "Appraisal overview retrieved successfully", await getAppraisalOverview(req.organizationId!, req.user!));
export const getActiveAppraisalCycleController = async (req: Request, res: Response) => sendSuccess(res, "Active appraisal cycle retrieved successfully", await getActiveAppraisalCycle(req.organizationId!, req.user!));
export const listAppraisalsController = async (req: Request, res: Response) => { const result = await listAppraisals(req.organizationId!, req.query, req.user!); return sendSuccess(res, "Appraisals retrieved successfully", result.appraisals, { pagination: result.pagination }); };
export const getAppraisalController = async (req: Request, res: Response) => sendSuccess(res, "Appraisal retrieved successfully", await getAppraisalDetail(req.organizationId!, String(req.params.appraisalId), req.user!));
export const createAppraisalGoalController = async (req: Request, res: Response) => sendSuccess(res, "Appraisal goal created successfully", await createAppraisalGoal(req.organizationId!, String(req.params.appraisalId), req.body, req.user!), { status: 201 });
export const scoreAppraisalGoalController = async (req: Request, res: Response) => sendSuccess(res, "Appraisal goal updated successfully", await scoreAppraisalGoal(req.organizationId!, String(req.params.appraisalId), String(req.params.goalId), req.body, req.user!));
export const openAppraisalSelfAssessmentController = async (req: Request, res: Response) => sendSuccess(res, "Appraisal self-assessment opened successfully", await openAppraisalSelfAssessment(req.organizationId!, String(req.params.appraisalId), req.user!));
export const getSelfAssessmentController = async (req: Request, res: Response) => sendSuccess(res, "Self-assessment retrieved successfully", await getSelfAssessment(req.organizationId!, String(req.params.appraisalId), req.user!));
export const saveSelfAssessmentController = async (req: Request, res: Response) => sendSuccess(res, "Self-assessment saved successfully", await saveSelfAssessment(req.organizationId!, String(req.params.appraisalId), req.body, req.user!));
export const getManagerReviewController = async (req: Request, res: Response) => sendSuccess(res, "Manager review retrieved successfully", await getManagerReview(req.organizationId!, String(req.params.appraisalId), req.user!));
export const saveManagerReviewController = async (req: Request, res: Response) => sendSuccess(res, "Manager review saved successfully", await saveManagerReview(req.organizationId!, String(req.params.appraisalId), req.body, req.user!));
export const getHRApprovalController = async (req: Request, res: Response) => sendSuccess(res, "HR approval retrieved successfully", await getHRApproval(req.organizationId!, String(req.params.appraisalId), req.user!));
export const approveAppraisalHRController = async (req: Request, res: Response) => sendSuccess(res, "HR appraisal decision recorded successfully", await approveAppraisalHR(req.organizationId!, String(req.params.appraisalId), req.body, req.user!));
export const acknowledgeAppraisalController = async (req: Request, res: Response) => sendSuccess(res, "Appraisal acknowledged successfully", await acknowledgeAppraisal(req.organizationId!, String(req.params.appraisalId), req.body, req.user!));
export const listAppraisalTemplatesController = async (req: Request, res: Response) => { const result = await listAppraisalTemplates(req.organizationId!, req.query, req.user!); return sendSuccess(res, "Appraisal templates retrieved successfully", result.templates, { pagination: result.pagination }); };
export const getAppraisalTemplateController = async (req: Request, res: Response) => sendSuccess(res, "Appraisal template retrieved successfully", await getAppraisalTemplate(req.organizationId!, String(req.params.templateId), req.user!));
export const createAppraisalTemplateController = async (req: Request, res: Response) => sendSuccess(res, "Appraisal template created successfully", await createAppraisalTemplate(req.organizationId!, req.body, req.user!), { status: 201 });
export const updateAppraisalTemplateController = async (req: Request, res: Response) => sendSuccess(res, "Appraisal template updated successfully", await updateAppraisalTemplate(req.organizationId!, String(req.params.templateId), req.body, req.user!));
export const deleteAppraisalTemplateController = async (req: Request, res: Response) => sendSuccess(res, "Appraisal template archived successfully", await archiveAppraisalTemplate(req.organizationId!, String(req.params.templateId), req.user!));
export const listAppraisalCyclesController = async (req: Request, res: Response) => { const result = await listAppraisalCycles(req.organizationId!, req.query, req.user!); return sendSuccess(res, "Appraisal cycles retrieved successfully", result.cycles, { pagination: result.pagination }); };
export const createAppraisalCycleController = async (req: Request, res: Response) => sendSuccess(res, "Appraisal cycle created successfully", await createAppraisalCycle(req.organizationId!, req.body, req.user!), { status: 201 });
export const launchAppraisalCycleController = async (req: Request, res: Response) => sendSuccess(res, "Appraisal cycle launched successfully", await launchAppraisalCycle(req.organizationId!, String(req.params.cycleId), req.user!));
export const completeAppraisalCycleController = async (req: Request, res: Response) => sendSuccess(res, "Appraisal cycle completed successfully", await completeAppraisalCycle(req.organizationId!, String(req.params.cycleId), req.user!));
export const listCycleReviewsController = listAppraisalsController;
export const deleteAppraisalCycleController = async (req: Request, res: Response) => sendSuccess(res, "Appraisal cycle permanently deleted", await deleteAppraisalCycle(req.organizationId!, String(req.params.cycleId), req.user!));
export const getAppraisalSettingsController = async (req: Request, res: Response) => sendSuccess(res, "Appraisal settings retrieved successfully", await getAppraisalSettings(req.organizationId!, req.user!));
export const updateAppraisalSettingsController = async (req: Request, res: Response) => sendSuccess(res, "Appraisal settings updated successfully", await updateAppraisalSettings(req.organizationId!, req.body, req.user!));
export const signOffAppraisalController = async (req: Request, res: Response) => sendSuccess(res, "Appraisal sign-off recorded successfully", await signOffAppraisal(req.organizationId!, String(req.params.appraisalId), req.body, req.user!));

export const getConductOverviewController = async (req: Request, res: Response) => sendSuccess(res, "Conduct overview retrieved successfully", await getConductOverview(req.organizationId!, req.user!));
export const listConductController = async (req: Request, res: Response) => { const result = await listConductRecords(req.organizationId!, req.query, req.user!); return sendSuccess(res, "Conduct records retrieved successfully", result.records, { pagination: result.pagination }); };
export const getConductController = async (req: Request, res: Response) => sendSuccess(res, "Conduct record retrieved successfully", await getConductRecord(req.organizationId!, String(req.params.conductId), req.user!));
export const createConductQueryController = async (req: Request, res: Response) => sendSuccess(res, "Conduct query created successfully", await createConductQuery(req.organizationId!, req.body, req.user!), { status: 201 });
export const createSuspensionController = async (req: Request, res: Response) => sendSuccess(res, "Suspension created successfully", await createSuspension(req.organizationId!, req.body, req.user!), { status: 201 });
export const updateConductStatusController = async (req: Request, res: Response) => sendSuccess(res, "Conduct status updated successfully", await updateConductStatus(req.organizationId!, String(req.params.conductId), req.body, req.user!));
