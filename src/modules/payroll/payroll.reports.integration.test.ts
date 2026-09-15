import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "../../core/prisma";
import { getPayrollBankScheduleReportPaged, getPayrollDepartmentCostReportPaged, getPayrollPensionOverviewPaged, getPayrollReportSummaryPaged, getPayrollTaxAnnualReturnsPaged, getPayrollTaxEmployeesByStatePaged, getPayrollTaxOverviewPaged, getPayrollVarianceReportPaged, getPayrollWallet, getPayrollYtdReportPaged, listPayrollEmployees, listPayrollLoans, listPayrollWalletObligations, synchronizePayeRemittances } from "./payroll.service";

const enabled = process.env.RUN_REPORT_DB_INTEGRATION === "true";
test("payroll report queries aggregate in the database and honor pagination", { skip: !enabled }, async () => {
  const organization = await prisma.organization.findFirst({ select: { id: true } }); assert.ok(organization);
  const base={page:1,limit:10};
  const [summary,department,variance,bank,ytd]=await Promise.all([
    getPayrollReportSummaryPaged(organization.id,{year:2026}),
    getPayrollDepartmentCostReportPaged(organization.id,{...base,period:"2026-09"}),
    getPayrollVarianceReportPaged(organization.id,{...base,previousPeriod:"2026-08",currentPeriod:"2026-09"}),
    getPayrollBankScheduleReportPaged(organization.id,{...base,period:"2026-09"}),
    getPayrollYtdReportPaged(organization.id,{...base,year:2026}),
  ]);
  assert.ok(summary.monthlyBreakdown.length<=12);
  for(const result of [department,variance,bank,ytd] as any[]) { assert.ok(result.pagination.limit===10); assert.ok((result.rows??result.departments).length<=10); }
  const [taxOverview,taxEmployees,taxAnnual,pension]=await Promise.all([getPayrollTaxOverviewPaged(organization.id,{year:2026}),getPayrollTaxEmployeesByStatePaged(organization.id,{...base,year:2026}),getPayrollTaxAnnualReturnsPaged(organization.id,{...base,year:2026}),getPayrollPensionOverviewPaged(organization.id,{period:"2026-09"})]);
  assert.equal(taxOverview.currency,"NGN"); assert.ok(taxEmployees.employees.length<=10); assert.ok(taxAnnual.rows.length<=10); assert.ok(pension.counts.employees>=0);
  const [wallet,obligations,loans,grossAsc,grossDesc,netSecondPage]=await Promise.all([
    getPayrollWallet(organization.id),
    listPayrollWalletObligations(organization.id,{page:1,limit:10}),
    listPayrollLoans(organization.id,{page:1,limit:10,sortBy:"startDate",sortOrder:"desc"}),
    listPayrollEmployees(organization.id,{page:1,limit:10,sortBy:"gross",sortOrder:"asc"}),
    listPayrollEmployees(organization.id,{page:1,limit:10,sortBy:"gross",sortOrder:"desc"}),
    listPayrollEmployees(organization.id,{page:2,limit:10,sortBy:"netPay",sortOrder:"asc"}),
  ]);
  assert.ok(wallet.summary.totalFunded>=0); assert.ok(obligations.obligations.length<=10); assert.equal(obligations.pagination.limit,10); assert.ok(loans.loans.length<=10); assert.ok(grossAsc.employees.every((row,index,all)=>index===0||all[index-1].grossPay<=row.grossPay)); assert.ok(grossDesc.employees.every((row,index,all)=>index===0||all[index-1].grossPay>=row.grossPay)); assert.equal(netSecondPage.pagination.page,2);
  const before=await prisma.payrollTaxRemittance.count({where:{organizationId:organization.id}}); await synchronizePayeRemittances(organization.id); await synchronizePayeRemittances(organization.id); const after=await prisma.payrollTaxRemittance.count({where:{organizationId:organization.id}}); assert.ok(after>=before);
  await prisma.$disconnect();
});
