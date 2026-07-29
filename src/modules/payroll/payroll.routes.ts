import { Router } from "express";
import { asyncHandler } from "../../core/async-handler";
import { createCrudRouter } from "../../core/crud-router";
import { validate } from "../../core/validate";
import { authorize } from "../../middleware/rbac.middleware";
import { generatePayslipsController } from "./payroll.controller";
import {
  loansCrudOptions,
  payslipsCrudOptions,
  runsCrudOptions,
  salaryStructuresCrudOptions,
  statutoryCrudOptions
} from "./payroll.service";
import { generatePayslipParamsSchema } from "./payroll.validation";

export const payrollRouter = Router();

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
