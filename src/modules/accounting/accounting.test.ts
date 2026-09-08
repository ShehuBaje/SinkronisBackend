import assert from "node:assert/strict";
import test from "node:test";
import { accountingRouter } from "./accounting.routes";
import { accountingInvoiceDisplayStatus, billedVsValuePercentage } from "./accounting.service";
import { createPayslipPdf } from "../employee/employee.service";
import { accountingListQuerySchema, agentBulkInviteSchema, agentInviteSchema, catalogueCreateSchema, catalogueListQuerySchema, customerCreateSchema, expenseCreateSchema, expenseListQuerySchema, invoiceCreateSchema, invoiceListQuerySchema, invoicePaymentSchema, paymentRequestDisbursementSchema, paymentRequestListQuerySchema, projectCreateSchema, projectListQuerySchema, reminderConfigurationSchema, reminderListQuerySchema, accountingReportQuerySchema, walletTransactionQuerySchema, manualWalletFundingSchema, invoiceTemplateCreateSchema, expenseCategoryCreateSchema, uiReminderSettingsSchema } from "./accounting.validation";

const routes = (accountingRouter as any).stack.filter((layer: any) => layer.route).flatMap((layer: any) => Object.keys(layer.route.methods).map((method) => `${method.toUpperCase()} ${layer.route.path}`));

test("Accounting UI endpoints remain in the existing Accounting router", () => {
  for (const route of ["GET /dashboard", "GET /customers", "POST /customers", "GET /customers/:id", "PATCH /customers/:id", "DELETE /customers/:id", "GET /items-services", "POST /items-services", "GET /items-services/:id", "PATCH /items-services/:id", "DELETE /items-services/:id", "GET /projects", "POST /projects", "GET /projects/:id", "PATCH /projects/:id", "DELETE /projects/:id"]) assert.ok(routes.includes(route), route);
});

test("continued Accounting workflows remain in the same router", () => {
  for (const route of ["GET /invoices", "POST /invoices", "POST /invoices/:id/send", "POST /invoices/:id/payment", "DELETE /invoices/:id", "GET /agents", "POST /agents/invite", "POST /agents/invite-bulk", "GET /payment-requests", "POST /payment-requests/:id/approve", "POST /payment-requests/:id/decline", "POST /payment-requests/:id/disburse", "GET /expenses", "GET /expenses/export", "GET /reminders", "GET /reminders/configuration", "PUT /reminders/configuration", "POST /reminders/mark-all-read", "POST /reminders/:id/read", "POST /exports/invoices", "POST /exports/expenses", "GET /exports/:id", "GET /exports/:id/download"]) assert.ok(routes.includes(route), route);
});

test("reports, wallet and Accounting settings routes remain in the existing router", () => {
  for (const route of ["GET /reports", "GET /reports/export.csv", "GET /reports/export.pdf", "GET /reports/vat", "GET /invoices/:id/download", "GET /wallet/summary", "GET /wallet/transactions", "POST /wallet/manual-funding", "GET /wallet/transactions/:id/receipt", "GET /settings/invoice-templates", "POST /settings/invoice-templates", "PATCH /settings/invoice-templates/:id", "POST /settings/invoice-templates/:id/default", "DELETE /settings/invoice-templates/:id", "GET /settings/expense-categories", "POST /settings/expense-categories", "DELETE /settings/expense-categories/:id", "GET /settings/reminders", "PUT /settings/reminders"]) assert.ok(routes.includes(route), route);
});

test("new Accounting DTOs reject tenant injection and unsafe financial/settings input", () => {
  assert.equal(accountingReportQuerySchema.safeParse({ clientId: "client", itemServiceId: "item", dateFrom: "2026-01-01" }).success, false);
  assert.equal(accountingReportQuerySchema.safeParse({ clientId: "client", itemServiceId: "item", fromDate: "2026-01-01" }).success, true);
  assert.equal(accountingReportQuerySchema.safeParse({ tenantId: "other" }).success, false);
  assert.equal(walletTransactionQuerySchema.safeParse({ direction: "INFLOW" }).success, true);
  assert.equal(manualWalletFundingSchema.safeParse({ walletAccountId: "w", amount: "100.00", description: "Bank deposit", externalReference: "TELLER-1" }).success, true);
  assert.equal(manualWalletFundingSchema.safeParse({ walletAccountId: "w", amount: 0, description: "Bank deposit", externalReference: "TELLER-1" }).success, false);
  assert.equal(invoiceTemplateCreateSchema.safeParse({ name: "Standard", paymentTerms: "Net 30" }).success, true);
  assert.equal(expenseCategoryCreateSchema.safeParse({ name: "Travel" }).success, true);
  assert.equal(uiReminderSettingsSchema.safeParse({ automaticRemindersEnabled: true, firstReminderDaysBeforeDue: 7, overdueReminderFrequency: "EVERY_3_DAYS", inAppEnabled: true, emailEnabled: false }).success, true);
  assert.equal(uiReminderSettingsSchema.safeParse({ automaticRemindersEnabled: true, firstReminderDaysBeforeDue: 2, overdueReminderFrequency: "NEVER", inAppEnabled: false, emailEnabled: false }).success, false);
});

test("invoice input is snapshot-oriented and rejects client-calculated totals", () => {
  const valid = { clientId: "client", dueDate: "2026-09-30", items: [{ catalogueItemId: "item", quantity: "2" }, { description: "Custom work", quantity: "1.5", unitPrice: "1000", vatApplicable: false }] };
  assert.equal(invoiceCreateSchema.safeParse(valid).success, true);
  assert.equal(invoiceCreateSchema.safeParse({ ...valid, total: 5000 }).success, false);
  assert.equal(invoiceCreateSchema.safeParse({ ...valid, items: [{ description: "Bad", quantity: 0, unitPrice: 1 }] }).success, false);
  assert.equal(invoiceListQuerySchema.safeParse({ tenantId: "other" }).success, false);
});

test("agent, payment, expense and reminder DTOs enforce workflow boundaries", () => {
  assert.equal(agentInviteSchema.safeParse({ fullName: "Ada Agent", email: "ada@example.com", phone: "+2348012345678", roleId: "role" }).success, true);
  assert.equal(agentBulkInviteSchema.safeParse({ entries: "a@example.com,\nb@example.com", roleId: "role" }).success, true);
  assert.equal(paymentRequestDisbursementSchema.safeParse({ walletAccountId: "wallet", idempotencyKey: "retry-key-123" }).success, true);
  assert.equal(paymentRequestDisbursementSchema.safeParse({ walletAccountId: "wallet", amount: 500, idempotencyKey: "short" }).success, false);
  assert.equal(paymentRequestListQuerySchema.safeParse({ status: "COMPLETED" }).success, true);
  assert.equal(expenseCreateSchema.safeParse({ expenseDate: "2026-09-08", category: "Travel", description: "Client visit", amount: "10.00", loggedBy: "other" }).success, false);
  assert.equal(expenseListQuerySchema.safeParse({ fromDate: "2026-09-10", toDate: "2026-09-01" }).success, false);
  assert.equal(reminderListQuerySchema.safeParse({ filter: "UNREAD" }).success, true);
  assert.equal(invoicePaymentSchema.safeParse({ reference: "PAY-001", amount: "25.50" }).success, true);
  assert.equal(invoicePaymentSchema.safeParse({ reference: "PAY-001", amount: 0 }).success, false);
  assert.equal(reminderConfigurationSchema.safeParse({ upcomingDays: [7, 3, 1], overdueIntervals: [1, 7, 30], inAppEnabled: true, emailEnabled: false }).success, true);
  assert.equal(reminderConfigurationSchema.safeParse({ upcomingDays: [], overdueIntervals: [], inAppEnabled: false, emailEnabled: false }).success, false);
});

test("Accounting list filters and sorting are closed and tenant identity is rejected", () => {
  assert.equal(accountingListQuerySchema.safeParse({ status: "ACTIVE", page: "1", limit: "20", sortBy: "name" }).success, true);
  assert.equal(accountingListQuerySchema.safeParse({ tenantId: "other" }).success, false);
  assert.equal(catalogueListQuerySchema.safeParse({ type: "SERVICE", sortBy: "unitPrice" }).success, true);
  assert.equal(projectListQuerySchema.safeParse({ status: "ON_HOLD", sortBy: "value" }).success, true);
  assert.equal(projectListQuerySchema.safeParse({ sortBy: "DROP TABLE" }).success, false);
});

test("Customer, catalogue and project payload validation follows UI business boundaries", () => {
  assert.equal(customerCreateSchema.safeParse({ companyName: "Example Customer", email: "billing@example.com", phone: "+2348012345678" }).success, true);
  assert.equal(customerCreateSchema.safeParse({ companyName: "X", email: "bad" }).success, false);
  assert.equal(catalogueCreateSchema.safeParse({ name: "Monthly support", type: "SERVICE", unitPrice: "10000.00", unit: "Month", vatApplicable: true }).success, true);
  assert.equal(catalogueCreateSchema.safeParse({ name: "Invalid", type: "SERVICE", unitPrice: "-1", unit: "Run" }).success, false);
  assert.equal(projectCreateSchema.safeParse({ name: "Implementation", clientId: "client", value: "0", startDate: "2026-09-01", endDate: "2026-08-31" }).success, false);
  assert.equal(projectCreateSchema.safeParse({ name: "Implementation", clientId: "client", value: "0", startDate: "2026-09-01", endDate: "2026-09-30" }).success, true);
});

test("Accounting status and percentage helpers handle overdue and zero-value projects", () => {
  assert.equal(accountingInvoiceDisplayStatus("SENT", new Date("2026-01-01"), new Date("2026-02-01")), "OVERDUE");
  assert.equal(accountingInvoiceDisplayStatus("PARTIALLY_PAID", new Date("2026-01-01"), new Date("2026-02-01")), "OVERDUE");
  assert.equal(accountingInvoiceDisplayStatus("PAID", new Date("2026-01-01"), new Date("2026-02-01")), "PAID");
  assert.equal(billedVsValuePercentage(500, 0), 0);
  assert.equal(billedVsValuePercentage(250, 1000), 25);
});

test("shared PDF renderer paginates long Accounting reports", () => {
  const pdf = createPayslipPdf(Array.from({ length: 60 }, (_, index) => `Invoice ${index + 1}`)).toString("latin1");
  assert.match(pdf, /^%PDF-1\.4/);
  assert.match(pdf, /\/Count 3/);
});
