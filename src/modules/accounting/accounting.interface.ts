export type MoneyInput = string | number;
export type SortOrder = "asc" | "desc";
export type InvoiceStatus =
  | "DRAFT"
  | "SENT"
  | "PARTIALLY_PAID"
  | "PAID"
  | "VOID"
  | "OVERDUE";
export type PaymentRequestStatus =
  | "DRAFT"
  | "PENDING"
  | "APPROVED"
  | "REJECTED"
  | "PAID";

export interface PaginationQuery {
  page: number;
  limit: number;
}
export interface AccountingListQuery extends PaginationQuery {
  search?: string;
  status: "ALL" | "ACTIVE" | "INACTIVE";
  sortBy: "createdAt" | "name" | "status";
  sortOrder: SortOrder;
}
export interface CatalogueListQuery extends PaginationQuery {
  search?: string;
  type: "ALL" | "ITEM" | "PRODUCT" | "SERVICE";
  status: "ALL" | "ACTIVE" | "INACTIVE";
  sortBy: "createdAt" | "name" | "unitPrice" | "type";
  sortOrder: SortOrder;
}
export interface ProjectListQuery extends PaginationQuery {
  search?: string;
  status: "ALL" | "ACTIVE" | "ON_HOLD" | "COMPLETED";
  sortBy: "createdAt" | "name" | "value" | "startDate" | "endDate" | "status";
  sortOrder: SortOrder;
}

export interface CustomerInput {
  companyName: string;
  taxId?: string;
  contactPerson?: string;
  email?: string;
  phone?: string;
  address?: string;
  status?: "ACTIVE" | "INACTIVE";
}
export interface CatalogueInput {
  name: string;
  type: "ITEM" | "PRODUCT" | "SERVICE";
  unitPrice: MoneyInput;
  unit: string;
  description?: string;
  vatApplicable?: boolean;
  status?: "ACTIVE" | "INACTIVE";
}
export interface ProjectInput {
  name: string;
  clientId: string;
  assignedAgentId?: string | null;
  value: MoneyInput;
  startDate: Date;
  endDate?: Date | null;
  status?: "ACTIVE" | "ON_HOLD" | "COMPLETED";
}

export interface InvoiceItemInput {
  catalogueItemId?: string;
  description?: string;
  quantity: MoneyInput;
  unitPrice?: MoneyInput;
  vatApplicable?: boolean;
}

export interface InvoiceCreateInput {
  clientId: string;
  assignedAgentId?: string | null;
  projectId?: string | null;
  issueDate?: Date;
  dueDate: Date;
  notes?: string;
  items: InvoiceItemInput[];
}

export type InvoiceUpdateInput = Partial<InvoiceCreateInput>;
export interface InvoiceListQuery extends PaginationQuery {
  search?: string;
  clientId?: string;
  agentId?: string;
  projectId?: string;
  status?: "ALL" | InvoiceStatus;
  fromDate?: Date;
  toDate?: Date;
  sortBy: "issueDate" | "dueDate" | "total" | "createdAt" | "status";
  sortOrder: SortOrder;
}
export interface InvoicePaymentInput {
  reference: string;
  amount: MoneyInput;
  paidAt?: Date;
  notes?: string;
}

export interface AgentListQuery extends PaginationQuery {
  search?: string;
  status: "ALL" | "ACTIVE" | "PENDING" | "INACTIVE";
}
export interface AgentInviteInput {
  fullName: string;
  email: string;
  phone?: string;
  roleId: string;
}
export interface AgentBulkInviteInput {
  entries: string;
  roleId: string;
}
export interface AgentUpdateInput {
  fullName?: string;
  phone?: string;
  roleId?: string;
  status?: "ACTIVE" | "INACTIVE";
}

export interface PaymentRequestCreateInput {
  title: string;
  description?: string;
  invoiceId?: string;
  projectId?: string;
  clientId?: string;
  amount: MoneyInput;
}
export interface PaymentRequestListQuery extends PaginationQuery {
  search?: string;
  status: "ALL" | PaymentRequestStatus;
  fromDate?: Date;
  toDate?: Date;
}
export interface PaymentRequestDecisionInput {
  reason?: string;
}
export interface PaymentRequestDisbursementInput {
  walletAccountId: string;
  idempotencyKey: string;
}

export interface ExpenseInput {
  expenseDate: Date;
  category?: string;
  categoryId?: string;
  description: string;
  amount: MoneyInput;
  receiptReference?: string;
}

export interface AccountingReportQuery extends InvoiceListQuery {
  itemServiceId?: string;
  groupBy?: "CLIENT" | "AGENT" | "PROJECT";
}
export interface WalletTransactionQuery extends PaginationQuery {
  direction: "ALL" | "INFLOW" | "OUTFLOW";
}
export interface ManualWalletFundingInput {
  walletAccountId: string;
  amount: MoneyInput;
  description: string;
  externalReference: string;
}
export interface InvoiceTemplateInput {
  name: string;
  paymentTerms?: string;
  headerNote?: string;
  footerNote?: string;
}
export interface ExpenseCategoryInput {
  name: string;
  description?: string;
}
export interface UiReminderSettingsInput {
  automaticRemindersEnabled: boolean;
  firstReminderDaysBeforeDue: 1 | 3 | 5 | 7 | 14;
  overdueReminderFrequency: "NEVER" | "ONCE" | "EVERY_3_DAYS" | "EVERY_7_DAYS";
  inAppEnabled: boolean;
  emailEnabled: boolean;
}
export interface ExpenseListQuery extends PaginationQuery {
  search?: string;
  category?: string;
  fromDate?: Date;
  toDate?: Date;
  sortBy: "expenseDate" | "amount" | "createdAt" | "category";
  sortOrder: SortOrder;
}

export interface ReminderListQuery extends PaginationQuery {
  filter: "ALL" | "UNREAD" | "UPCOMING" | "OVERDUE";
}
export interface ReminderConfigurationInput {
  upcomingDays: number[];
  overdueIntervals: number[];
  inAppEnabled: boolean;
  emailEnabled: boolean;
}
export interface AccountingExportQuery {
  type: "INVOICES" | "EXPENSES";
  filters: InvoiceListQuery | ExpenseListQuery;
}
