import { z } from "zod";
import {
  loanCreateSchema,
  loanUpdateSchema,
  payslipCreateSchema,
  payslipUpdateSchema,
  payrollRunCreateSchema,
  payrollRunUpdateSchema,
  salaryCreateSchema,
  salaryUpdateSchema,
  taxReportCreateSchema,
  taxReportUpdateSchema
} from "../common.schemas";

export const generatePayslipParamsSchema = z.object({ id: z.string().min(1) });

export {
  loanCreateSchema,
  loanUpdateSchema,
  payslipCreateSchema,
  payslipUpdateSchema,
  payrollRunCreateSchema,
  payrollRunUpdateSchema,
  salaryCreateSchema,
  salaryUpdateSchema,
  taxReportCreateSchema,
  taxReportUpdateSchema
};
