import { Router } from "express";
import { asyncHandler } from "../../core/async-handler";
import { createCrudRouter } from "../../core/crud-router";
import { validate } from "../../core/validate";
import { authorize } from "../../middleware/rbac.middleware";
import * as controller from "./accounting.controller";
import {
  clientsCrudOptions,
  taxReportsCrudOptions,
  walletDisbursementsCrudOptions,
  walletsCrudOptions,
} from "./accounting.service";
import {
  accountingEntityParamsSchema,
  accountingListQuerySchema,
  agentBulkInviteSchema,
  agentInviteSchema,
  agentListQuerySchema,
  agentUpdateSchema,
  catalogueCreateSchema,
  catalogueListQuerySchema,
  catalogueParamsSchema,
  catalogueUpdateSchema,
  customerCreateSchema,
  customerParamsSchema,
  customerUpdateSchema,
  expenseCreateSchema,
  expenseListQuerySchema,
  expenseUpdateSchema,
  invoiceCreateSchema,
  invoiceIdParamsSchema,
  invoiceListQuerySchema,
  invoicePaymentSchema,
  invoiceUpdateSchema,
  paymentRequestCreateSchema,
  paymentRequestDecisionSchema,
  paymentRequestDisbursementSchema,
  paymentRequestListQuerySchema,
  projectCreateSchema,
  projectListQuerySchema,
  projectParamsSchema,
  projectUpdateSchema,
  reminderListQuerySchema,
  reminderConfigurationSchema,
  accountingReportQuerySchema, walletTransactionQuerySchema, manualWalletFundingSchema,
  invoiceTemplateCreateSchema, invoiceTemplateUpdateSchema, expenseCategoryCreateSchema,
  uiReminderSettingsSchema,
} from "./accounting.validation";

export const accountingRouter = Router();

accountingRouter.get(
  "/dashboard",
  authorize(
    "accounting:invoices:view",
    "accounting:payments:view",
    "accounting:wallets:view",
  ),
  asyncHandler(controller.getAccountingDashboardController),
);
accountingRouter.get(
  "/customers",
  authorize("accounting:clients:view"),
  validate({ query: accountingListQuerySchema }),
  asyncHandler(controller.listAccountingCustomersController),
);
accountingRouter.post(
  "/customers",
  authorize("accounting:clients:create"),
  validate({ body: customerCreateSchema }),
  asyncHandler(controller.createAccountingCustomerController),
);
accountingRouter.get(
  "/customers/:id",
  authorize("accounting:clients:view"),
  validate({ params: customerParamsSchema }),
  asyncHandler(controller.getAccountingCustomerController),
);
accountingRouter.patch(
  "/customers/:id",
  authorize("accounting:clients:update"),
  validate({ params: customerParamsSchema, body: customerUpdateSchema }),
  asyncHandler(controller.updateAccountingCustomerController),
);
accountingRouter.delete(
  "/customers/:id",
  authorize("accounting:clients:delete"),
  validate({ params: customerParamsSchema }),
  asyncHandler(controller.deleteAccountingCustomerController),
);
accountingRouter.get(
  "/items-services",
  authorize("accounting:items:view"),
  validate({ query: catalogueListQuerySchema }),
  asyncHandler(controller.listCatalogueItemsController),
);
accountingRouter.post(
  "/items-services",
  authorize("accounting:items:create"),
  validate({ body: catalogueCreateSchema }),
  asyncHandler(controller.createCatalogueItemController),
);
accountingRouter.get(
  "/items-services/:id",
  authorize("accounting:items:view"),
  validate({ params: catalogueParamsSchema }),
  asyncHandler(controller.getCatalogueItemController),
);
accountingRouter.patch(
  "/items-services/:id",
  authorize("accounting:items:update"),
  validate({ params: catalogueParamsSchema, body: catalogueUpdateSchema }),
  asyncHandler(controller.updateCatalogueItemController),
);
accountingRouter.delete(
  "/items-services/:id",
  authorize("accounting:items:delete"),
  validate({ params: catalogueParamsSchema }),
  asyncHandler(controller.deleteCatalogueItemController),
);
accountingRouter.get(
  "/projects",
  authorize("accounting:projects:view"),
  validate({ query: projectListQuerySchema }),
  asyncHandler(controller.listAccountingProjectsController),
);
accountingRouter.post(
  "/projects",
  authorize("accounting:projects:create"),
  validate({ body: projectCreateSchema }),
  asyncHandler(controller.createAccountingProjectController),
);
accountingRouter.get(
  "/projects/:id",
  authorize("accounting:projects:view"),
  validate({ params: projectParamsSchema }),
  asyncHandler(controller.getAccountingProjectController),
);
accountingRouter.patch(
  "/projects/:id",
  authorize("accounting:projects:update"),
  validate({ params: projectParamsSchema, body: projectUpdateSchema }),
  asyncHandler(controller.updateAccountingProjectController),
);
accountingRouter.delete(
  "/projects/:id",
  authorize("accounting:projects:delete"),
  validate({ params: projectParamsSchema }),
  asyncHandler(controller.deleteAccountingProjectController),
);

accountingRouter.get(
  "/invoices/export",
  authorize("accounting:invoices:view"),
  validate({ query: invoiceListQuerySchema }),
  asyncHandler(controller.exportInvoicesController),
);
accountingRouter.get(
  "/invoices",
  authorize("accounting:invoices:view"),
  validate({ query: invoiceListQuerySchema }),
  asyncHandler(controller.listInvoicesController),
);
accountingRouter.post(
  "/invoices",
  authorize("accounting:invoices:create"),
  validate({ body: invoiceCreateSchema }),
  asyncHandler(controller.createInvoiceController),
);
accountingRouter.get(
  "/invoices/:id",
  authorize("accounting:invoices:view"),
  validate({ params: invoiceIdParamsSchema }),
  asyncHandler(controller.getInvoiceByIdController),
);
accountingRouter.get(
  "/invoices/:id/download",
  authorize("accounting:invoices:view"),
  validate({ params: invoiceIdParamsSchema }),
  asyncHandler(controller.downloadAccountingInvoicePdfController),
);
accountingRouter.patch(
  "/invoices/:id",
  authorize("accounting:invoices:update"),
  validate({ params: invoiceIdParamsSchema, body: invoiceUpdateSchema }),
  asyncHandler(controller.updateInvoiceController),
);
accountingRouter.post(
  "/invoices/:id/send",
  authorize("accounting:invoices:update"),
  validate({ params: invoiceIdParamsSchema }),
  asyncHandler(controller.sendInvoiceController),
);
accountingRouter.post(
  "/invoices/:id/payment",
  authorize("accounting:payments:create"),
  validate({ params: invoiceIdParamsSchema, body: invoicePaymentSchema }),
  asyncHandler(controller.recordInvoicePaymentController),
);
accountingRouter.delete(
  "/invoices/:id",
  authorize("accounting:invoices:delete"),
  validate({ params: invoiceIdParamsSchema }),
  asyncHandler(controller.deleteInvoiceController),
);

accountingRouter.get(
  "/agents",
  authorize("accounting:agents:view"),
  validate({ query: agentListQuerySchema }),
  asyncHandler(controller.listAccountingAgentsController),
);
accountingRouter.post(
  "/agents/invite",
  authorize("accounting:agents:create"),
  validate({ body: agentInviteSchema }),
  asyncHandler(controller.inviteAccountingAgentController),
);
accountingRouter.post(
  "/agents/invite-bulk",
  authorize("accounting:agents:create"),
  validate({ body: agentBulkInviteSchema }),
  asyncHandler(controller.bulkInviteAccountingAgentsController),
);
accountingRouter.patch(
  "/agents/:id",
  authorize("accounting:agents:update"),
  validate({ params: accountingEntityParamsSchema, body: agentUpdateSchema }),
  asyncHandler(controller.updateAccountingAgentController),
);
accountingRouter.delete(
  "/agents/:id",
  authorize("accounting:agents:delete"),
  validate({ params: accountingEntityParamsSchema }),
  asyncHandler(controller.removeAccountingAgentController),
);

accountingRouter.get(
  "/payment-requests",
  authorize("accounting:payments:view"),
  validate({ query: paymentRequestListQuerySchema }),
  asyncHandler(controller.listPaymentRequestsController),
);
accountingRouter.post(
  "/payment-requests",
  authorize("accounting:payments:create"),
  validate({ body: paymentRequestCreateSchema }),
  asyncHandler(controller.createPaymentRequestController),
);
accountingRouter.get(
  "/payment-requests/:id",
  authorize("accounting:payments:view"),
  validate({ params: accountingEntityParamsSchema }),
  asyncHandler(controller.getPaymentRequestController),
);
accountingRouter.post(
  "/payment-requests/:id/approve",
  authorize("accounting:payments:approve"),
  validate({
    params: accountingEntityParamsSchema,
    body: paymentRequestDecisionSchema,
  }),
  asyncHandler(controller.approvePaymentRequestController),
);
accountingRouter.post(
  "/payment-requests/:id/decline",
  authorize("accounting:payments:approve"),
  validate({
    params: accountingEntityParamsSchema,
    body: paymentRequestDecisionSchema,
  }),
  asyncHandler(controller.declinePaymentRequestController),
);
accountingRouter.post(
  "/payment-requests/:id/disburse",
  authorize("accounting:payments:approve", "accounting:wallets:update"),
  validate({
    params: accountingEntityParamsSchema,
    body: paymentRequestDisbursementSchema,
  }),
  asyncHandler(controller.disbursePaymentRequestController),
);

accountingRouter.get(
  "/expenses/export",
  authorize("accounting:expenses:view"),
  validate({ query: expenseListQuerySchema }),
  asyncHandler(controller.exportExpensesController),
);
accountingRouter.get(
  "/expenses",
  authorize("accounting:expenses:view"),
  validate({ query: expenseListQuerySchema }),
  asyncHandler(controller.listExpensesController),
);
accountingRouter.post(
  "/expenses",
  authorize("accounting:expenses:create"),
  validate({ body: expenseCreateSchema }),
  asyncHandler(controller.createExpenseController),
);
accountingRouter.patch(
  "/expenses/:id",
  authorize("accounting:expenses:update"),
  validate({ params: accountingEntityParamsSchema, body: expenseUpdateSchema }),
  asyncHandler(controller.updateExpenseController),
);
accountingRouter.delete(
  "/expenses/:id",
  authorize("accounting:expenses:delete"),
  validate({ params: accountingEntityParamsSchema }),
  asyncHandler(controller.voidExpenseController),
);

accountingRouter.get(
  "/reminders",
  authorize("accounting:reminders:view"),
  validate({ query: reminderListQuerySchema }),
  asyncHandler(controller.listRemindersController),
);
accountingRouter.get(
  "/reminders/configuration",
  authorize("accounting:reminders:view"),
  asyncHandler(controller.getReminderConfigurationController),
);
accountingRouter.put(
  "/reminders/configuration",
  authorize("accounting:reminders:update"),
  validate({ body: reminderConfigurationSchema }),
  asyncHandler(controller.updateReminderConfigurationController),
);
accountingRouter.post(
  "/reminders/mark-all-read",
  authorize("accounting:reminders:view"),
  asyncHandler(controller.markAllRemindersReadController),
);
accountingRouter.post(
  "/reminders/:id/read",
  authorize("accounting:reminders:view"),
  validate({ params: accountingEntityParamsSchema }),
  asyncHandler(controller.markReminderReadController),
);

accountingRouter.post("/exports/invoices", authorize("accounting:exports:view", "accounting:invoices:view"), validate({ query: invoiceListQuerySchema }), asyncHandler(controller.requestInvoiceExportController));
accountingRouter.post("/exports/expenses", authorize("accounting:exports:view", "accounting:expenses:view"), validate({ query: expenseListQuerySchema }), asyncHandler(controller.requestExpenseExportController));
accountingRouter.get("/exports/:id", authorize("accounting:exports:view"), validate({ params: accountingEntityParamsSchema }), asyncHandler(controller.getAccountingExportStatusController));
accountingRouter.get("/exports/:id/download", authorize("accounting:exports:view"), validate({ params: accountingEntityParamsSchema }), asyncHandler(controller.downloadAccountingExportController));

accountingRouter.get("/reports", authorize("accounting:invoices:view"), validate({ query: accountingReportQuerySchema }), asyncHandler(controller.getAccountingReportController));
accountingRouter.get("/reports/export.csv", authorize("accounting:invoices:view"), validate({ query: accountingReportQuerySchema }), asyncHandler(controller.exportAccountingReportCsvController));
accountingRouter.get("/reports/export.pdf", authorize("accounting:invoices:view"), validate({ query: accountingReportQuerySchema }), asyncHandler(controller.exportAccountingReportPdfController));
accountingRouter.get("/reports/vat", authorize("accounting:tax:view"), validate({ query: accountingReportQuerySchema }), asyncHandler(controller.getVatReportController));
accountingRouter.get("/wallet/summary", authorize("accounting:wallets:view"), asyncHandler(controller.getWalletSummaryController));
accountingRouter.get("/wallet/transactions", authorize("accounting:wallets:view"), validate({ query: walletTransactionQuerySchema }), asyncHandler(controller.listWalletTransactionsController));
accountingRouter.post("/wallet/manual-funding", authorize("accounting:wallets:update"), validate({ body: manualWalletFundingSchema }), asyncHandler(controller.fundWalletManuallyController));
accountingRouter.get("/wallet/transactions/:id/receipt", authorize("accounting:wallets:view"), validate({ params: accountingEntityParamsSchema }), asyncHandler(controller.getWalletReceiptController));
accountingRouter.get("/settings/invoice-templates", authorize("accounting:invoices:view"), asyncHandler(controller.listInvoiceTemplatesController));
accountingRouter.post("/settings/invoice-templates", authorize("accounting:invoices:create"), validate({ body: invoiceTemplateCreateSchema }), asyncHandler(controller.createInvoiceTemplateController));
accountingRouter.patch("/settings/invoice-templates/:id", authorize("accounting:invoices:update"), validate({ params: accountingEntityParamsSchema, body: invoiceTemplateUpdateSchema }), asyncHandler(controller.updateInvoiceTemplateController));
accountingRouter.post("/settings/invoice-templates/:id/default", authorize("accounting:invoices:update"), validate({ params: accountingEntityParamsSchema }), asyncHandler(controller.setDefaultInvoiceTemplateController));
accountingRouter.delete("/settings/invoice-templates/:id", authorize("accounting:invoices:delete"), validate({ params: accountingEntityParamsSchema }), asyncHandler(controller.deleteInvoiceTemplateController));
accountingRouter.get("/settings/expense-categories", authorize("accounting:expenses:view"), asyncHandler(controller.listExpenseCategoriesController));
accountingRouter.post("/settings/expense-categories", authorize("accounting:expenses:create"), validate({ body: expenseCategoryCreateSchema }), asyncHandler(controller.createExpenseCategoryController));
accountingRouter.delete("/settings/expense-categories/:id", authorize("accounting:expenses:delete"), validate({ params: accountingEntityParamsSchema }), asyncHandler(controller.deleteExpenseCategoryController));
accountingRouter.get("/settings/reminders", authorize("accounting:reminders:view"), asyncHandler(controller.getUiReminderSettingsController));
accountingRouter.put("/settings/reminders", authorize("accounting:reminders:update"), validate({ body: uiReminderSettingsSchema }), asyncHandler(controller.updateUiReminderSettingsController));

accountingRouter.use("/clients", createCrudRouter(clientsCrudOptions));
accountingRouter.use("/tax-reports", createCrudRouter(taxReportsCrudOptions));
accountingRouter.use("/wallets", createCrudRouter(walletsCrudOptions));
accountingRouter.use(
  "/wallet-disbursements",
  createCrudRouter(walletDisbursementsCrudOptions),
);
