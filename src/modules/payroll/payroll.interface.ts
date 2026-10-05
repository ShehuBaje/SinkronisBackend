export type GeneratePayslipResult = {
  count: number;
  data: unknown[];
};

export type PayrollDashboardStatus = "DRAFT" | "PROCESSING" | "PENDING_APPROVAL" | "APPROVED" | "PENDING_DISBURSEMENT" | "DISBURSING" | "DISBURSED" | "FAILED" | "PAID" | "CANCELLED";
export interface PayrollDashboardRunTotals { employees: number; gross: number; netPay: number; paye: number; pension: number; employerPension: number; nhf: number; nsitf: number }
export interface PayrollMixedRunTotals extends PayrollDashboardRunTotals { participants: number; permanentEmployees: number; externalPayees: number; wht: number; permanentNetPay: number; externalNetPay: number; loans: number; otherDeductions: number }
