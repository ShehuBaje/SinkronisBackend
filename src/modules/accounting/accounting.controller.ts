import type { Request as ExpressRequest, Response } from "express";
import { sendSuccess } from "../../core/api-response";
import {
  approvePaymentRequest,
  bulkInviteAccountingAgents,
  createAccountingCustomer,
  createAccountingProject,
  createCatalogueItem,
  createExpense,
  createInvoice,
  createPaymentRequest,
  declinePaymentRequest,
  deleteAccountingCustomer,
  deleteAccountingProject,
  deleteCatalogueItem,
  deleteInvoice,
  disbursePaymentRequest,
  exportExpenses,
  exportInvoices,
  downloadAccountingExport,
  getAccountingExportStatus,
  getAccountingCustomer,
  getAccountingDashboard,
  getAccountingProject,
  getCatalogueItem,
  getInvoiceById,
  getPaymentRequest,
  getReminderConfiguration,
  inviteAccountingAgent,
  listAccountingAgents,
  listAccountingCustomers,
  listAccountingProjects,
  listCatalogueItems,
  listExpenses,
  listInvoices,
  listPaymentRequests,
  listReminders,
  markAllRemindersRead,
  markReminderRead,
  recordInvoicePayment,
  requestAccountingExport,
  removeAccountingAgent,
  sendInvoice,
  updateAccountingAgent,
  updateAccountingCustomer,
  updateAccountingProject,
  updateCatalogueItem,
  updateExpense,
  updateInvoice,
  updateReminderConfiguration,
  voidExpense,
  getAccountingReport, getVatReport, getWhtReport, getWalletSummary, listWalletTransactions,
  fundWalletManually, getWalletReceipt, listInvoiceTemplates, createInvoiceTemplate,
  updateInvoiceTemplate, setDefaultInvoiceTemplate, deleteInvoiceTemplate,
  listExpenseCategories, createExpenseCategory, deleteExpenseCategory,
  getUiReminderSettings, updateUiReminderSettings,
  exportAccountingReportCsv, exportAccountingReportPdf, downloadAccountingInvoicePdf,
  initializePaystackWalletFunding, verifyPaystackWalletFunding, processPaystackWebhook,
} from "./accounting.service";
import type {
  AccountingListQuery,
  AgentBulkInviteInput,
  AgentInviteInput,
  AgentListQuery,
  AgentUpdateInput,
  CatalogueInput,
  CatalogueListQuery,
  CustomerInput,
  ExpenseInput,
  ExpenseListQuery,
  InvoiceCreateInput,
  InvoiceListQuery,
  InvoicePaymentInput,
  InvoiceUpdateInput,
  PaymentRequestCreateInput,
  PaymentRequestDecisionInput,
  PaymentRequestDisbursementInput,
  PaymentRequestListQuery,
  ProjectInput,
  ProjectListQuery,
  ReminderListQuery,
  ReminderConfigurationInput,
  AccountingReportQuery, WalletTransactionQuery, ManualWalletFundingInput,
  InvoiceTemplateInput, ExpenseCategoryInput, UiReminderSettingsInput, PaystackFundingInput,
} from "./accounting.interface";

type Request = ExpressRequest<any>;

export const getAccountingDashboardController = async (
  req: Request,
  res: Response,
) =>
  sendSuccess(
    res,
    "Accounting dashboard retrieved",
    await getAccountingDashboard(req.organizationId!),
  );
export const listAccountingCustomersController = async (
  req: Request,
  res: Response,
) =>
  sendSuccess(
    res,
    "Customers retrieved",
    await listAccountingCustomers(
      req.organizationId!,
      req.query as unknown as AccountingListQuery,
    ),
  );
export const createAccountingCustomerController = async (
  req: Request,
  res: Response,
) =>
  sendSuccess(
    res,
    "Customer created",
    await createAccountingCustomer(
      req.organizationId!,
      req.body as CustomerInput,
      req.user!,
    ),
    { status: 201 },
  );
export const getAccountingCustomerController = async (
  req: Request,
  res: Response,
) =>
  sendSuccess(
    res,
    "Customer retrieved",
    await getAccountingCustomer(req.organizationId!, req.params.id),
  );
export const updateAccountingCustomerController = async (
  req: Request,
  res: Response,
) =>
  sendSuccess(
    res,
    "Customer updated",
    await updateAccountingCustomer(
      req.organizationId!,
      req.params.id,
      req.body as Partial<CustomerInput>,
      req.user!,
    ),
  );
export const deleteAccountingCustomerController = async (
  req: Request,
  res: Response,
) =>
  sendSuccess(
    res,
    "Customer removed safely",
    await deleteAccountingCustomer(
      req.organizationId!,
      req.params.id,
      req.user!,
    ),
  );
export const listCatalogueItemsController = async (
  req: Request,
  res: Response,
) =>
  sendSuccess(
    res,
    "Items and services retrieved",
    await listCatalogueItems(
      req.organizationId!,
      req.query as unknown as CatalogueListQuery,
    ),
  );
export const createCatalogueItemController = async (
  req: Request,
  res: Response,
) =>
  sendSuccess(
    res,
    "Item or service created",
    await createCatalogueItem(
      req.organizationId!,
      req.body as CatalogueInput,
      req.user!,
    ),
    { status: 201 },
  );
export const getCatalogueItemController = async (req: Request, res: Response) =>
  sendSuccess(
    res,
    "Item or service retrieved",
    await getCatalogueItem(req.organizationId!, req.params.id),
  );
export const updateCatalogueItemController = async (
  req: Request,
  res: Response,
) =>
  sendSuccess(
    res,
    "Item or service updated",
    await updateCatalogueItem(
      req.organizationId!,
      req.params.id,
      req.body as Partial<CatalogueInput>,
      req.user!,
    ),
  );
export const deleteCatalogueItemController = async (
  req: Request,
  res: Response,
) =>
  sendSuccess(
    res,
    "Item or service removed safely",
    await deleteCatalogueItem(req.organizationId!, req.params.id, req.user!),
  );
export const listAccountingProjectsController = async (
  req: Request,
  res: Response,
) =>
  sendSuccess(
    res,
    "Projects retrieved",
    await listAccountingProjects(
      req.organizationId!,
      req.query as unknown as ProjectListQuery,
    ),
  );
export const createAccountingProjectController = async (
  req: Request,
  res: Response,
) =>
  sendSuccess(
    res,
    "Project created",
    await createAccountingProject(
      req.organizationId!,
      req.body as ProjectInput,
      req.user!,
    ),
    { status: 201 },
  );
export const getAccountingProjectController = async (
  req: Request,
  res: Response,
) =>
  sendSuccess(
    res,
    "Project retrieved",
    await getAccountingProject(req.organizationId!, req.params.id),
  );
export const updateAccountingProjectController = async (
  req: Request,
  res: Response,
) =>
  sendSuccess(
    res,
    "Project updated",
    await updateAccountingProject(
      req.organizationId!,
      req.params.id,
      req.body as Partial<ProjectInput>,
      req.user!,
    ),
  );
export const deleteAccountingProjectController = async (
  req: Request,
  res: Response,
) =>
  sendSuccess(
    res,
    "Project removed safely",
    await deleteAccountingProject(
      req.organizationId!,
      req.params.id,
      req.user!,
    ),
  );

export const listInvoicesController = async (req: Request, res: Response) =>
  sendSuccess(
    res,
    "Invoices retrieved",
    await listInvoices(
      req.organizationId!,
      req.query as unknown as InvoiceListQuery,
    ),
  );
export const createInvoiceController = async (req: Request, res: Response) =>
  sendSuccess(
    res,
    "Invoice created",
    await createInvoice(
      req.organizationId!,
      req.body as InvoiceCreateInput,
      req.user!,
    ),
    { status: 201 },
  );
export const getInvoiceByIdController = async (req: Request, res: Response) =>
  sendSuccess(
    res,
    "Invoice retrieved",
    await getInvoiceById(req.organizationId!, req.params.id),
  );
export const updateInvoiceController = async (req: Request, res: Response) =>
  sendSuccess(
    res,
    "Invoice updated",
    await updateInvoice(
      req.organizationId!,
      req.params.id,
      req.body as InvoiceUpdateInput,
      req.user!,
    ),
  );
export const sendInvoiceController = async (req: Request, res: Response) =>
  sendSuccess(
    res,
    "Invoice sent",
    await sendInvoice(req.organizationId!, req.params.id, req.user!),
  );
export const recordInvoicePaymentController = async (
  req: Request,
  res: Response,
) =>
  sendSuccess(
    res,
    "Invoice payment recorded",
    await recordInvoicePayment(
      req.organizationId!,
      req.params.id,
      req.body as InvoicePaymentInput,
      req.user!,
    ),
  );
export const deleteInvoiceController = async (req: Request, res: Response) => {
  await deleteInvoice(req.organizationId!, req.params.id, req.user!);
  return res.status(204).send();
};
export const exportInvoicesController = async (req: Request, res: Response) =>
  res
    .status(200)
    .type("text/csv; charset=utf-8")
    .attachment("accounting-invoices.csv")
    .send(
      await exportInvoices(
        req.organizationId!,
        req.query as unknown as InvoiceListQuery,
        req.user!,
      ),
    );

export const listAccountingAgentsController = async (
  req: Request,
  res: Response,
) =>
  sendSuccess(
    res,
    "Accounting agents retrieved",
    await listAccountingAgents(
      req.organizationId!,
      req.query as unknown as AgentListQuery,
    ),
  );
export const inviteAccountingAgentController = async (
  req: Request,
  res: Response,
) =>
  sendSuccess(
    res,
    "Accounting agent invited",
    await inviteAccountingAgent(
      req.organizationId!,
      req.body as AgentInviteInput,
      req.user!,
    ),
    { status: 201 },
  );
export const bulkInviteAccountingAgentsController = async (
  req: Request,
  res: Response,
) =>
  sendSuccess(
    res,
    "Accounting agent invitations processed",
    await bulkInviteAccountingAgents(
      req.organizationId!,
      req.body as AgentBulkInviteInput,
      req.user!,
    ),
  );
export const updateAccountingAgentController = async (
  req: Request,
  res: Response,
) =>
  sendSuccess(
    res,
    "Accounting agent updated",
    await updateAccountingAgent(
      req.organizationId!,
      req.params.id,
      req.body as AgentUpdateInput,
      req.user!,
    ),
  );
export const removeAccountingAgentController = async (
  req: Request,
  res: Response,
) =>
  sendSuccess(
    res,
    "Accounting agent deactivated",
    await removeAccountingAgent(req.organizationId!, req.params.id, req.user!),
  );

export const listPaymentRequestsController = async (
  req: Request,
  res: Response,
) =>
  sendSuccess(
    res,
    "Payment requests retrieved",
    await listPaymentRequests(
      req.organizationId!,
      req.query as unknown as PaymentRequestListQuery,
    ),
  );
export const createPaymentRequestController = async (
  req: Request,
  res: Response,
) =>
  sendSuccess(
    res,
    "Payment request created",
    await createPaymentRequest(
      req.organizationId!,
      req.body as PaymentRequestCreateInput,
      req.user!,
    ),
    { status: 201 },
  );
export const getPaymentRequestController = async (
  req: Request,
  res: Response,
) =>
  sendSuccess(
    res,
    "Payment request retrieved",
    await getPaymentRequest(req.organizationId!, req.params.id),
  );
export const approvePaymentRequestController = async (
  req: Request,
  res: Response,
) =>
  sendSuccess(
    res,
    "Payment request approved",
    await approvePaymentRequest(
      req.organizationId!,
      req.params.id,
      req.body as PaymentRequestDecisionInput,
      req.user!,
    ),
  );
export const declinePaymentRequestController = async (
  req: Request,
  res: Response,
) =>
  sendSuccess(
    res,
    "Payment request declined",
    await declinePaymentRequest(
      req.organizationId!,
      req.params.id,
      req.body as PaymentRequestDecisionInput,
      req.user!,
    ),
  );
export const disbursePaymentRequestController = async (
  req: Request,
  res: Response,
) =>
  sendSuccess(
    res,
    "Payment request disbursed",
    await disbursePaymentRequest(
      req.organizationId!,
      req.params.id,
      req.body as PaymentRequestDisbursementInput,
      req.user!,
    ),
  );

export const listExpensesController = async (req: Request, res: Response) =>
  sendSuccess(
    res,
    "Expenses retrieved",
    await listExpenses(
      req.organizationId!,
      req.query as unknown as ExpenseListQuery,
    ),
  );
export const createExpenseController = async (req: Request, res: Response) =>
  sendSuccess(
    res,
    "Expense logged",
    await createExpense(
      req.organizationId!,
      req.body as ExpenseInput,
      req.user!,
    ),
    { status: 201 },
  );
export const updateExpenseController = async (req: Request, res: Response) =>
  sendSuccess(
    res,
    "Expense updated",
    await updateExpense(
      req.organizationId!,
      req.params.id,
      req.body as Partial<ExpenseInput>,
      req.user!,
    ),
  );
export const voidExpenseController = async (req: Request, res: Response) =>
  sendSuccess(
    res,
    "Expense voided",
    await voidExpense(req.organizationId!, req.params.id, req.user!),
  );
export const exportExpensesController = async (req: Request, res: Response) =>
  res
    .status(200)
    .type("text/csv; charset=utf-8")
    .attachment("accounting-expenses.csv")
    .send(
      await exportExpenses(
        req.organizationId!,
        req.query as unknown as ExpenseListQuery,
        req.user!,
      ),
    );

export const listRemindersController = async (req: Request, res: Response) =>
  sendSuccess(
    res,
    "Reminders retrieved",
    await listReminders(
      req.organizationId!,
      req.query as unknown as ReminderListQuery,
      req.user!,
    ),
  );
export const markReminderReadController = async (req: Request, res: Response) =>
  sendSuccess(
    res,
    "Reminder marked read",
    await markReminderRead(req.organizationId!, req.params.id, req.user!),
  );
export const markAllRemindersReadController = async (
  req: Request,
  res: Response,
) =>
  sendSuccess(
    res,
    "All reminders marked read",
    await markAllRemindersRead(req.organizationId!, req.user!),
  );

export const getReminderConfigurationController = async (req: Request, res: Response) => sendSuccess(res, "Reminder configuration retrieved", await getReminderConfiguration(req.organizationId!));
export const updateReminderConfigurationController = async (req: Request, res: Response) => sendSuccess(res, "Reminder configuration updated", await updateReminderConfiguration(req.organizationId!, req.body as ReminderConfigurationInput, req.user!));
export const requestInvoiceExportController = async (req: Request, res: Response) => sendSuccess(res, "Invoice export queued", await requestAccountingExport(req.organizationId!, "INVOICES", req.query, req.user!), { status: 202 });
export const requestExpenseExportController = async (req: Request, res: Response) => sendSuccess(res, "Expense export queued", await requestAccountingExport(req.organizationId!, "EXPENSES", req.query, req.user!), { status: 202 });
export const getAccountingExportStatusController = async (req: Request, res: Response) => sendSuccess(res, "Accounting export status retrieved", await getAccountingExportStatus(req.organizationId!, req.params.id));
export const downloadAccountingExportController = async (req: Request, res: Response) => { const file = await downloadAccountingExport(req.organizationId!, req.params.id); return res.status(200).type("text/csv; charset=utf-8").attachment(file.fileName).send(file.buffer); };

export const getAccountingReportController = async (req: Request,res: Response) => sendSuccess(res,"Accounting report retrieved",await getAccountingReport(req.organizationId!,req.query as unknown as AccountingReportQuery));
export const getVatReportController = async (req: Request,res: Response) => sendSuccess(res,"VAT report retrieved",await getVatReport(req.organizationId!,req.query as unknown as AccountingReportQuery));
export const getWhtReportController = async (req: Request,res: Response) => sendSuccess(res,"WHT report retrieved",await getWhtReport(req.organizationId!,req.query as unknown as AccountingReportQuery));
export const getWalletSummaryController = async (req: Request,res: Response) => sendSuccess(res,"Wallet summary retrieved",await getWalletSummary(req.organizationId!));
export const listWalletTransactionsController = async (req: Request,res: Response) => sendSuccess(res,"Wallet transactions retrieved",await listWalletTransactions(req.organizationId!,req.query as unknown as WalletTransactionQuery));
export const fundWalletManuallyController = async (req: Request,res: Response) => sendSuccess(res,"Wallet funded",await fundWalletManually(req.organizationId!,req.body as ManualWalletFundingInput,req.user!),{ status: 201 });
export const getWalletReceiptController = async (req: Request,res: Response) => sendSuccess(res,"Wallet receipt retrieved",await getWalletReceipt(req.organizationId!,req.params.id));
export const initializePaystackWalletFundingController = async (req: Request,res: Response) => sendSuccess(res,"Paystack wallet funding initialized",await initializePaystackWalletFunding(req.organizationId!,req.body as PaystackFundingInput,req.user!),{ status: 201 });
export const verifyPaystackWalletFundingController = async (req: Request,res: Response) => sendSuccess(res,"Paystack wallet funding verified",await verifyPaystackWalletFunding(req.organizationId!,req.params.reference));
export const paystackWebhookController = async (req: Request,res: Response) => sendSuccess(res,"Paystack webhook received",await processPaystackWebhook(req.rawBody,req.header("x-paystack-signature") ?? undefined));
export const listInvoiceTemplatesController = async (req: Request,res: Response) => sendSuccess(res,"Invoice templates retrieved",await listInvoiceTemplates(req.organizationId!));
export const createInvoiceTemplateController = async (req: Request,res: Response) => sendSuccess(res,"Invoice template created",await createInvoiceTemplate(req.organizationId!,req.body as InvoiceTemplateInput,req.user!),{ status: 201 });
export const updateInvoiceTemplateController = async (req: Request,res: Response) => sendSuccess(res,"Invoice template updated",await updateInvoiceTemplate(req.organizationId!,req.params.id,req.body as Partial<InvoiceTemplateInput>,req.user!));
export const setDefaultInvoiceTemplateController = async (req: Request,res: Response) => sendSuccess(res,"Default invoice template updated",await setDefaultInvoiceTemplate(req.organizationId!,req.params.id,req.user!));
export const deleteInvoiceTemplateController = async (req: Request,res: Response) => { await deleteInvoiceTemplate(req.organizationId!,req.params.id,req.user!); return res.status(204).send(); };
export const listExpenseCategoriesController = async (req: Request,res: Response) => sendSuccess(res,"Expense categories retrieved",await listExpenseCategories(req.organizationId!));
export const createExpenseCategoryController = async (req: Request,res: Response) => sendSuccess(res,"Expense category created",await createExpenseCategory(req.organizationId!,req.body as ExpenseCategoryInput,req.user!),{ status: 201 });
export const deleteExpenseCategoryController = async (req: Request,res: Response) => { await deleteExpenseCategory(req.organizationId!,req.params.id,req.user!); return res.status(204).send(); };
export const getUiReminderSettingsController = async (req: Request,res: Response) => sendSuccess(res,"Reminder settings retrieved",await getUiReminderSettings(req.organizationId!));
export const updateUiReminderSettingsController = async (req: Request,res: Response) => sendSuccess(res,"Reminder settings updated",await updateUiReminderSettings(req.organizationId!,req.body as UiReminderSettingsInput,req.user!));
export const exportAccountingReportCsvController = async (req: Request,res: Response) => res.status(200).type("text/csv; charset=utf-8").attachment("accounting-report.csv").send(await exportAccountingReportCsv(req.organizationId!,req.query as unknown as AccountingReportQuery));
export const exportAccountingReportPdfController = async (req: Request,res: Response) => res.status(200).type("application/pdf").attachment("accounting-report.pdf").send(await exportAccountingReportPdf(req.organizationId!,req.query as unknown as AccountingReportQuery));
export const downloadAccountingInvoicePdfController = async (req: Request,res: Response) => { const file = await downloadAccountingInvoicePdf(req.organizationId!,req.params.id,req.user!); return res.status(200).type("application/pdf").attachment(file.filename).send(file.buffer); };
