export const billingPlanKeys = ["hris", "payroll", "accounting", "all-in-one"] as const;
export const billingModuleKeys = ["hris", "accounting", "payroll"] as const;

export type BillingPlanKey = (typeof billingPlanKeys)[number];
export type BillingModuleKey = (typeof billingModuleKeys)[number];
export type BillingCycle = "MONTHLY" | "YEARLY";

export type BillingPlanDefinition = {
  key: BillingPlanKey;
  name: string;
  monthlyCost: number;
  yearlyCost: number;
  includedModules: BillingModuleKey[];
  description: string;
  features: string[];
};

export const billingPlans: readonly BillingPlanDefinition[] = [
  {
    key: "hris", name: "HRIS", monthlyCost: 80000, yearlyCost: 960000, includedModules: ["hris"],
    description: "Complete people operations and organisation management.",
    features: ["Employee Management & Profiles", "Attendance & Biometric Integration", "Leave Management & Approvals", "Appraisal & OKR-Based Reviews", "Conduct & Disciplinary Tracking", "Organisation Setup (Departments & Branches)"]
  },
  {
    key: "payroll", name: "Payroll", monthlyCost: 10000, yearlyCost: 120000, includedModules: ["payroll"],
    description: "Payroll, statutory compliance and salary disbursement.",
    features: ["Salary Computation & Pay Runs", "PAYE & WHT Tax Management", "Pension & Statutory Remittances", "Payslip Generation", "Deduction & Loan Management", "Wallet for Salary Disbursements"]
  },
  {
    key: "accounting", name: "Accounting", monthlyCost: 80000, yearlyCost: 960000, includedModules: ["accounting"],
    description: "Billing, compliance, expenses and financial reporting.",
    features: ["Client & Invoice Management", "VAT & WHT Tax Compliance", "Expense Tracking", "Sales Agent Management", "Payment Requests & Approvals", "Financial Reports & Profit & Loss"]
  },
  {
    key: "all-in-one", name: "All-in-One Suite", monthlyCost: 150000, yearlyCost: 1800000, includedModules: ["hris", "payroll", "accounting"],
    description: "Every Sinkronis module in one unified suite.",
    features: ["Everything in HRIS", "Everything in Payroll", "Everything in Accounting", "Single Unified Dashboard", "Cross-Module Reporting", "Priority Support"]
  }
];

export const modulePrices: Readonly<Record<BillingModuleKey, number>> = { hris: 80000, accounting: 80000, payroll: 10000 };
export const moduleLabels: Readonly<Record<BillingModuleKey, string>> = { hris: "HRIS", accounting: "Accounting", payroll: "Payroll" };

export const getBillingPlanDefinition = (key: BillingPlanKey) => billingPlans.find((plan) => plan.key === key);

export const calculateMonthlyPricing = (plan: BillingPlanDefinition, paidAddOns: readonly BillingModuleKey[]) => {
  const uniqueAddOns = [...new Set(paidAddOns)].filter((key) => !plan.includedModules.includes(key));
  const activeModuleTotal = uniqueAddOns.reduce((sum, key) => sum + modulePrices[key], 0);
  return {
    basePlanCost: plan.monthlyCost,
    activeModuleTotal,
    grandMonthlyTotal: plan.monthlyCost + activeModuleTotal,
    addOns: uniqueAddOns.map((key) => ({ key, name: moduleLabels[key], monthlyCost: modulePrices[key] }))
  };
};

export const calculateBillingAmount = (monthlyAmount: number, cycle: BillingCycle) => cycle === "YEARLY" ? monthlyAmount * 12 : monthlyAmount;
