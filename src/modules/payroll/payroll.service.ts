import { badRequest, notFound, serviceUnavailable } from "../../core/http-error";
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

  const employees = await prisma.employee.findMany({
    where: { organizationId, status: "ACTIVE" },
    include: {
      salaryStructures: {
        where: {
          effectiveFrom: { lte: run.periodEnd },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: run.periodStart } }]
        },
        orderBy: { effectiveFrom: "desc" },
        take: 1
      },
      loans: true
    }
  });

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
            netPay: grossPay - deductions
          },
          create: {
            organizationId,
            payrollRunId: run.id,
            employeeId: employee.id,
            grossPay,
            payeTax,
            pension,
            deductions,
            netPay: grossPay - deductions
          }
        });
      })
  );

  return { count: payslips.length, data: payslips };
};

export const enqueuePayslipGeneration = async (organizationId: string, payrollRunId: string, requestedByUserId?: string) => {
  if (!isQueueBackendAvailable()) {
    throw serviceUnavailable("Payslip generation queue is unavailable because Redis is not connected")
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

export const payslipsCrudOptions = {
  model: "payslip" as const,
  createSchema: payslipCreateSchema,
  updateSchema: payslipUpdateSchema,
  permission: "payroll:payslips:update" as const,
  include: { employee: true, payrollRun: true }
};

export const loansCrudOptions = {
  model: "loanAdvance" as const,
  createSchema: loanCreateSchema,
  updateSchema: loanUpdateSchema,
  permission: "payroll:loans:update" as const,
  include: { employee: true }
};
