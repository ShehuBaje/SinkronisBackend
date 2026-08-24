import { badRequest, conflict, notFound } from "../../core/http-error";
import { env } from "../../config/env";
import { prisma } from "../../core/prisma";
import { getQueueByName, isQueueBackendAvailable, PAYROLL_QUEUE_NAME } from "../../queues";
import { PAYROLL_GENERATE_PAYSLIPS_JOB } from "../../queues/workers";
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
} from "./payroll.validation";

export const generatePayslips = async (organizationId: string, id: string) => {
  const run = await prisma.payrollRun.findFirst({
    where: { id, organizationId }
  });

  if (!run) throw notFound("Payroll run not found");
  if (run.status !== "DRAFT" && run.status !== "PROCESSING") {
    throw badRequest("Payslips can only be generated for draft or processing payroll runs");
  }

  if (run.status === "DRAFT") {
    await prisma.payrollRun.update({
      where: { id: run.id },
      data: { status: "PROCESSING" }
    });
  }

  const [employees, settings, organization] = await Promise.all([
    prisma.employee.findMany({
      where: { organizationId, status: "ACTIVE" },
      include: {
        salaryStructures: {
          where: { effectiveFrom: { lte: run.periodEnd }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: run.periodStart } }] },
          orderBy: { effectiveFrom: "desc" }, take: 1
        },
        loans: true
      }
    }),
    prisma.organizationGeneralSettings.findUnique({ where: { organizationId }, select: { currency: true } }),
    prisma.organization.findUnique({ where: { id: organizationId }, select: { currency: true } })
  ]);
  const currency = settings?.currency ?? organization?.currency ?? "NGN";

  const payslips = await prisma.$transaction(
    employees
      .filter((employee) => employee.salaryStructures.length > 0)
      .map((employee) => {
        const salary = employee.salaryStructures[0]!;
        const grossPay =
          Number(salary.basic) + Number(salary.housing) + Number(salary.transport) + Number(salary.otherAllowance);
        const payeTax = grossPay * 0.1;
        const pension = grossPay * 0.08;
        const loanDeduction = employee.loans.reduce(
          (sum, loan) => sum + Math.min(Number(loan.outstanding), grossPay * 0.05),
          0
        );
        const deductions = payeTax + pension + loanDeduction;
        const earningsSnapshot = [
          { code: "BASIC", name: "Basic", amount: Number(salary.basic) },
          { code: "HOUSING", name: "Housing", amount: Number(salary.housing) },
          { code: "TRANSPORT", name: "Transport", amount: Number(salary.transport) },
          { code: "OTHER_ALLOWANCE", name: "Other allowance", amount: Number(salary.otherAllowance) }
        ].filter((item) => item.amount !== 0);
        const deductionsSnapshot = [
          { code: "PAYE", name: "PAYE Tax", amount: payeTax },
          { code: "PENSION", name: "Pension", amount: pension },
          { code: "LOAN", name: "Loan deduction", amount: loanDeduction }
        ].filter((item) => item.amount !== 0);

        return prisma.payslip.upsert({
          where: {
            payrollRunId_employeeId: {
              payrollRunId: run.id,
              employeeId: employee.id
            }
          },
          update: {
            grossPay,
            payeTax,
            pension,
            deductions,
            netPay: grossPay - deductions,
            currency,
            earningsSnapshot,
            deductionsSnapshot
          },
          create: {
            organizationId,
            payrollRunId: run.id,
            employeeId: employee.id,
            grossPay,
            payeTax,
            pension,
            deductions,
            netPay: grossPay - deductions,
            currency,
            earningsSnapshot,
            deductionsSnapshot
          }
        });
      })
  );

  return { count: payslips.length, data: payslips };
};

export const enqueuePayslipGeneration = async (organizationId: string, payrollRunId: string, requestedByUserId?: string) => {
  if (env.BACKGROUND_JOBS_MODE === "inline") {
    const result = await generatePayslips(organizationId, payrollRunId);
    return {
      queued: false,
      duplicate: false,
      executionMode: "inline" as const,
      payrollRunId,
      generatedCount: result.count
    };
  }

  if (!isQueueBackendAvailable()) {
    throw badRequest("Payslip generation queue is unavailable because Redis is not connected")
  }

  const run = await prisma.payrollRun.findFirst({
    where: { id: payrollRunId, organizationId },
    select: { id: true, status: true }
  });

  if (!run) throw notFound("Payroll run not found");
  if (run.status !== "DRAFT" && run.status !== "PROCESSING") {
    throw badRequest("Payslips can only be generated for draft or processing payroll runs");
  }

  const payrollQueue = getQueueByName(PAYROLL_QUEUE_NAME);
  const jobId = `${PAYROLL_GENERATE_PAYSLIPS_JOB}:${organizationId}:${payrollRunId}`;
  const existingJob = await payrollQueue.getJob(jobId);

  if (existingJob) {
    return {
      queued: true,
      duplicate: true,
      jobId: String(existingJob.id),
      state: await existingJob.getState()
    };
  }

  const job = await payrollQueue.add(
    PAYROLL_GENERATE_PAYSLIPS_JOB,
    { organizationId, payrollRunId, requestedByUserId },
    {
      jobId,
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 5000
      },
      removeOnComplete: 100,
      removeOnFail: 200
    }
  );

  return {
    queued: true,
    duplicate: false,
    executionMode: "queue" as const,
    jobId: String(job.id),
    state: await job.getState()
  };
};

export const runsCrudOptions = {
  model: "payrollRun" as const,
  createSchema: payrollRunCreateSchema,
  updateSchema: payrollRunUpdateSchema,
  permission: "payroll:runs:update" as const,
  searchableFields: ["name"],
  include: { payslips: true }
};

export const salaryStructuresCrudOptions = {
  model: "salaryStructure" as const,
  createSchema: salaryCreateSchema,
  updateSchema: salaryUpdateSchema,
  permission: "payroll:salary:update" as const,
  searchableFields: ["title"],
  include: { employee: true }
};

export const statutoryCrudOptions = {
  model: "taxReport" as const,
  createSchema: taxReportCreateSchema,
  updateSchema: taxReportUpdateSchema,
  permission: "payroll:statutory:update" as const,
  searchableFields: ["type", "reference"]
};

export const isMutablePayrollRunStatus = (status: string) => status === "DRAFT" || status === "PROCESSING";
const assertPayslipMutable = async (organizationId: string, payslipId: string) => {
  const payslip = await prisma.payslip.findFirst({ where: { id: payslipId, organizationId }, select: { payrollrun: { select: { status: true } } } });
  if (!payslip) throw notFound("Payslip not found");
  if (!isMutablePayrollRunStatus(payslip.payrollrun.status)) throw conflict("Finalized payslips are immutable");
};

export const payslipsCrudOptions = {
  model: "payslip" as const,
  createSchema: payslipCreateSchema,
  updateSchema: payslipUpdateSchema,
  permission: "payroll:payslips:update" as const,
  include: { employee: true, payrollrun: true },
  beforeCreate: async (data: Record<string, unknown>, req: any) => {
    const run = await prisma.payrollRun.findFirst({ where: { id: String(data.payrollRunId), organizationId: req.organizationId }, select: { status: true } });
    if (!run) throw notFound("Payroll run not found"); if (!isMutablePayrollRunStatus(run.status)) throw conflict("Finalized payroll runs cannot receive new payslips"); return data;
  },
  beforeUpdate: async (data: Record<string, unknown>, req: any) => { await assertPayslipMutable(req.organizationId, String(req.params.id)); return data; },
  beforeDelete: async ({ req }: any) => { await assertPayslipMutable(req.organizationId, String(req.params.id)); }
};

export const loansCrudOptions = {
  model: "loanAdvance" as const,
  createSchema: loanCreateSchema,
  updateSchema: loanUpdateSchema,
  permission: "payroll:loans:update" as const,
  include: { employee: true }
};
