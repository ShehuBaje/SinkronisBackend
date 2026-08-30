import { createPayrollDeduction, createPayrollEmployee, createPayrollLoan, enrollPayrollEmployee, exportPayrollEmployees, exportPayrollHistory, getPayrollBik, getPayrollDashboard, getPayrollEmployeeDetail, getPayrollEmployeeHistory, importPayrollEmployees, listPayrollEmployees, payrollBulkTemplate, removePayrollDeduction, removePayrollEmployee, updatePayrollBik, updatePayrollSalaryStructure, updatePayrollStatutoryProfile, enqueuePayslipGeneration } from "./payroll.service";
import { sendSuccess } from "../../core/api-response";
import { badRequest } from "../../core/http-error";

export const getPayrollDashboardController = async (req: any, res: any) => sendSuccess(res, "Payroll dashboard retrieved successfully", await getPayrollDashboard(req.organizationId!, req.user!));
export const listPayrollEmployeesController = async (req: any, res: any) => { const result = await listPayrollEmployees(req.organizationId!, req.query); return sendSuccess(res, "Payroll employees retrieved successfully", result.employees, { pagination: result.pagination }); };
export const getPayrollEmployeeController = async (req: any, res: any) => sendSuccess(res, "Payroll employee retrieved successfully", await getPayrollEmployeeDetail(req.organizationId!, req.params.employeeId));
export const createPayrollEmployeeController = async (req: any, res: any) => sendSuccess(res, "Payroll employee created successfully", await createPayrollEmployee(req.organizationId!, req.body, req.user!), { status: 201 });
export const enrollPayrollEmployeeController = async (req: any, res: any) => sendSuccess(res, "Employee added to payroll successfully", await enrollPayrollEmployee(req.organizationId!, req.params.employeeId, req.user!));
export const removePayrollEmployeeController = async (req: any, res: any) => sendSuccess(res, "Employee removed from payroll successfully", await removePayrollEmployee(req.organizationId!, req.params.employeeId, req.body.reason, req.user!));
export const updatePayrollSalaryController = async (req: any, res: any) => sendSuccess(res, "Salary structure updated successfully", await updatePayrollSalaryStructure(req.organizationId!, req.params.employeeId, req.body, req.user!));
export const updatePayrollStatutoryController = async (req: any, res: any) => sendSuccess(res, "Statutory profile updated successfully", await updatePayrollStatutoryProfile(req.organizationId!, req.params.employeeId, req.body, req.user!));
export const createPayrollDeductionController = async (req: any, res: any) => sendSuccess(res, "Custom deduction created successfully", await createPayrollDeduction(req.organizationId!, req.params.employeeId, req.body, req.user!), { status: 201 });
export const removePayrollDeductionController = async (req: any, res: any) => sendSuccess(res, "Custom deduction removed successfully", await removePayrollDeduction(req.organizationId!, req.params.employeeId, req.params.deductionId, req.user!));
export const createPayrollLoanController = async (req: any, res: any) => sendSuccess(res, "Loan or advance created successfully", await createPayrollLoan(req.organizationId!, req.params.employeeId, req.body, req.user!), { status: 201 });
export const getPayrollBikController = async (req: any, res: any) => sendSuccess(res, "Benefit in kind retrieved successfully", await getPayrollBik(req.organizationId!, req.params.employeeId));
export const updatePayrollBikController = async (req: any, res: any) => sendSuccess(res, "Benefit in kind updated successfully", await updatePayrollBik(req.organizationId!, req.params.employeeId, req.body, req.user!));
export const getPayrollHistoryController = async (req: any, res: any) => { const result = await getPayrollEmployeeHistory(req.organizationId!, req.params.employeeId, req.query); return sendSuccess(res, "Payroll history retrieved successfully", result.history, { pagination: result.pagination }); };
export const exportPayrollEmployeesController = async (req: any, res: any) => res.status(200).type("text/csv").attachment("payroll-employees.csv").send(await exportPayrollEmployees(req.organizationId!, req.query));
export const exportPayrollHistoryController = async (req: any, res: any) => res.status(200).type("text/csv").attachment("employee-payroll-history.csv").send(await exportPayrollHistory(req.organizationId!, req.params.employeeId, req.query));
export const payrollBulkTemplateController = async (_req: any, res: any) => res.status(200).type("text/csv").attachment("payroll-employees-template.csv").send(payrollBulkTemplate());
export const importPayrollEmployeesController = async (req: any, res: any) => { if (!req.file?.buffer) throw badRequest("CSV file is required"); return sendSuccess(res, "Payroll employee import processed", await importPayrollEmployees(req.organizationId!, req.file.buffer, req.user!)); };

export const generatePayslipsController = async (req: any, res: any) => {
  const result = await enqueuePayslipGeneration(req.organizationId!, String(req.params.id), req.user?.id);
  res.status(result.queued ? 202 : 200).json(result);
};
