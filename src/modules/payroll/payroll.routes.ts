import { Router } from "express";
import multer from "multer";
import { asyncHandler } from "../../core/async-handler";
import { createCrudRouter } from "../../core/crud-router";
import { validate } from "../../core/validate";
import { authorize } from "../../middleware/rbac.middleware";
import { createPayrollDeductionController, createPayrollEmployeeController, createPayrollLoanController, enrollPayrollEmployeeController, exportPayrollEmployeesController, exportPayrollHistoryController, generatePayslipsController, getPayrollBikController, getPayrollDashboardController, getPayrollEmployeeController, getPayrollHistoryController, importPayrollEmployeesController, listPayrollEmployeesController, payrollBulkTemplateController, removePayrollDeductionController, removePayrollEmployeeController, updatePayrollBikController, updatePayrollSalaryController, updatePayrollStatutoryController } from "./payroll.controller";
import {
  loansCrudOptions,
  payslipsCrudOptions,
  runsCrudOptions,
  salaryStructuresCrudOptions,
  statutoryCrudOptions
} from "./payroll.service";
import { generatePayslipParamsSchema, payrollBikSchema, payrollCreateEmployeeSchema, payrollDashboardQuerySchema, payrollDeductionSchema, payrollEmployeeDeductionParamsSchema, payrollEmployeeParamsSchema, payrollEmployeesQuerySchema, payrollEnrollmentRemoveSchema, payrollHistoryQuerySchema, payrollLoanSchema, payrollSalaryStructureSchema, payrollStatutoryProfileSchema } from "./payroll.validation";

export const payrollRouter = Router();
const payrollCsv = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 }, fileFilter: (_req, file, callback) => callback(null, ["text/csv", "application/vnd.ms-excel"].includes(file.mimetype)) });

payrollRouter.get(
  "/dashboard",
  authorize("payroll:runs:view"),
  validate({ query: payrollDashboardQuerySchema }),
  asyncHandler(getPayrollDashboardController)
);
payrollRouter.get("/employees/bulk-template", authorize("payroll:salary:view"), asyncHandler(payrollBulkTemplateController));
payrollRouter.post("/employees/bulk-upload", authorize("hris:employees:create", "payroll:salary:create"), payrollCsv.single("file"), asyncHandler(importPayrollEmployeesController));
payrollRouter.get("/employees/export", authorize("payroll:salary:view"), validate({ query: payrollEmployeesQuerySchema }), asyncHandler(exportPayrollEmployeesController));
payrollRouter.get("/employees", authorize("payroll:salary:view"), validate({ query: payrollEmployeesQuerySchema }), asyncHandler(listPayrollEmployeesController));
payrollRouter.post("/employees", authorize("hris:employees:create", "payroll:salary:create"), validate({ body: payrollCreateEmployeeSchema }), asyncHandler(createPayrollEmployeeController));
payrollRouter.get("/employees/:employeeId", authorize("payroll:salary:view"), validate({ params: payrollEmployeeParamsSchema }), asyncHandler(getPayrollEmployeeController));
payrollRouter.post("/employees/:employeeId/enroll", authorize("payroll:salary:update"), validate({ params: payrollEmployeeParamsSchema }), asyncHandler(enrollPayrollEmployeeController));
payrollRouter.delete("/employees/:employeeId/enrollment", authorize("payroll:salary:update"), validate({ params: payrollEmployeeParamsSchema, body: payrollEnrollmentRemoveSchema }), asyncHandler(removePayrollEmployeeController));
payrollRouter.put("/employees/:employeeId/salary-structure", authorize("payroll:salary:update"), validate({ params: payrollEmployeeParamsSchema, body: payrollSalaryStructureSchema }), asyncHandler(updatePayrollSalaryController));
payrollRouter.put("/employees/:employeeId/statutory-profile", authorize("payroll:statutory:update"), validate({ params: payrollEmployeeParamsSchema, body: payrollStatutoryProfileSchema }), asyncHandler(updatePayrollStatutoryController));
payrollRouter.post("/employees/:employeeId/deductions", authorize("payroll:salary:update"), validate({ params: payrollEmployeeParamsSchema, body: payrollDeductionSchema }), asyncHandler(createPayrollDeductionController));
payrollRouter.delete("/employees/:employeeId/deductions/:deductionId", authorize("payroll:salary:update"), validate({ params: payrollEmployeeDeductionParamsSchema }), asyncHandler(removePayrollDeductionController));
payrollRouter.post("/employees/:employeeId/loans", authorize("payroll:loans:create"), validate({ params: payrollEmployeeParamsSchema, body: payrollLoanSchema }), asyncHandler(createPayrollLoanController));
payrollRouter.get("/employees/:employeeId/bik", authorize("payroll:salary:view"), validate({ params: payrollEmployeeParamsSchema }), asyncHandler(getPayrollBikController));
payrollRouter.put("/employees/:employeeId/bik", authorize("payroll:salary:update"), validate({ params: payrollEmployeeParamsSchema, body: payrollBikSchema }), asyncHandler(updatePayrollBikController));
payrollRouter.get("/employees/:employeeId/payroll-history/export", authorize("payroll:payslips:view"), validate({ params: payrollEmployeeParamsSchema, query: payrollHistoryQuerySchema }), asyncHandler(exportPayrollHistoryController));
payrollRouter.get("/employees/:employeeId/payroll-history", authorize("payroll:payslips:view"), validate({ params: payrollEmployeeParamsSchema, query: payrollHistoryQuerySchema }), asyncHandler(getPayrollHistoryController));

payrollRouter.use(
  "/runs",
  createCrudRouter(runsCrudOptions)
);

payrollRouter.post(
  "/runs/:id/generate-payslips",
  authorize("payroll:runs:update", "payroll:payslips:create"),
  validate({ params: generatePayslipParamsSchema }),
  asyncHandler(generatePayslipsController)
);

payrollRouter.use(
  "/salary-structures",
  createCrudRouter(salaryStructuresCrudOptions)
);

payrollRouter.use(
  "/statutory",
  createCrudRouter(statutoryCrudOptions)
);

payrollRouter.use(
  "/payslips",
  createCrudRouter(payslipsCrudOptions)
);

payrollRouter.use(
  "/loans-advances",
  createCrudRouter(loansCrudOptions)
);
