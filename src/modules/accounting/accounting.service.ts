import crypto from "crypto";
import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import type { AuthUser } from "../../types";
import { conflict, notFound, serviceUnavailable, unauthorized } from "../../core/http-error";
import { env } from "../../config/env";
import { prisma } from "../../core/prisma";
import { createObjectKey, deleteObject, readObject, uploadObject } from "../../core/object-storage";
import { deliverUserNotification } from "../../core/notifications";
import { createAuditLog } from "../admin/admin.audit";
import {
  sendWorkspaceInvitationEmail,
  workspaceInvitationSetupUrl,
  sendTransactionalNotificationEmail,
} from "../auth/auth.mailer";
import { getPlatformConfigurationValue } from "../platform-admin/platform-admin.service";
import { createPayslipPdf } from "../employee/employee.service";
import type {
  AccountingListQuery,
  AgentBulkInviteInput,
  AgentInviteInput,
  AgentListQuery,
  AgentUpdateInput,
  ExpenseInput,
  ExpenseListQuery,
  InvoiceCreateInput,
  InvoiceItemInput,
  InvoiceListQuery,
  InvoicePaymentInput,
  InvoiceUpdateInput,
  PaymentRequestCreateInput,
  PaymentRequestDecisionInput,
  PaymentRequestDisbursementInput,
  PaymentRequestListQuery,
  ReminderConfigurationInput,
  ReminderListQuery,
  AccountingReportQuery,
  WalletTransactionQuery,
  ManualWalletFundingInput,
  InvoiceTemplateInput,
  ExpenseCategoryInput,
  UiReminderSettingsInput,
  PaystackFundingInput,
} from "./accounting.interface";
import {
  clientCreateSchema,
  clientUpdateSchema,
  disbursementCreateSchema,
  disbursementUpdateSchema,
  invitationCreateSchema,
  invitationUpdateSchema,
  taxReportCreateSchema,
  taxReportUpdateSchema,
  walletCreateSchema,
  walletUpdateSchema,
  invoiceListQuerySchema,
  expenseListQuerySchema,
} from "./accounting.validation";

export const clientsCrudOptions = {
  model: "client" as const,
  createSchema: clientCreateSchema,
  updateSchema: clientUpdateSchema,
  permission: "accounting:clients:view" as const,
  createPermission: "accounting:clients:create" as const,
  updatePermission: "accounting:clients:update" as const,
  deletePermission: "accounting:clients:delete" as const,
  searchableFields: ["name", "email"],
  beforeCreate: (data: Record<string, unknown>) => ({
    ...data,
    reference: `CLT-${crypto.randomBytes(6).toString("hex").toUpperCase()}`,
  }),
  beforeDelete: async ({ req, existing }: { req: any; existing: any }) => {
    const [invoices, projects] = await Promise.all([
      prisma.invoice.count({
        where: { organizationId: req.organizationId, clientId: existing.id },
      }),
      prisma.accountingProject.count({
        where: { organizationId: req.organizationId, clientId: existing.id },
      }),
    ]);
    if (invoices || projects)
      throw conflict(
        "Customer has accounting history and cannot be permanently deleted",
      );
  },
};

export const taxReportsCrudOptions = {
  model: "taxReport" as const,
  createSchema: taxReportCreateSchema,
  updateSchema: taxReportUpdateSchema,
  permission: "accounting:tax:view" as const,
  searchableFields: ["type", "reference"],
};

export const walletsCrudOptions = {
  model: "walletAccount" as const,
  createSchema: walletCreateSchema,
  updateSchema: walletUpdateSchema,
  permission: "accounting:wallets:view" as const,
  searchableFields: ["name"],
  include: { disbursements: true },
};

export const walletDisbursementsCrudOptions = {
  model: "walletDisbursement" as const,
  createSchema: disbursementCreateSchema,
  updateSchema: disbursementUpdateSchema,
  permission: "accounting:wallets:update" as const,
};

export const agentInvitationsCrudOptions = {
  model: "agentInvitation" as const,
  createSchema: invitationCreateSchema,
  updateSchema: invitationUpdateSchema,
  permission: "accounting:agents:view" as const,
  searchableFields: ["email"],
  beforeCreate: (data: Record<string, unknown>) => ({
    ...data,
    token: crypto.randomBytes(32).toString("hex"),
  }),
};

const zero = () => new Prisma.Decimal(0);
const amount = (value: Prisma.Decimal | null | undefined) => Number(value ?? 0);
const invoiceReceivable = (invoice: { total: Prisma.Decimal; whtAmount?: Prisma.Decimal | null; amountPayable?: Prisma.Decimal | null }) =>
  invoice.amountPayable && invoice.amountPayable.gt(0)
    ? invoice.amountPayable
    : invoice.total.sub(invoice.whtAmount ?? zero());
export const calculateInvoiceWht = (subtotal: Prisma.Decimal.Value, applicable: boolean, rate?: 5 | 10) => {
  if (!applicable) return { rate: null, amount: zero() };
  if (rate !== 5 && rate !== 10) throw conflict("WHT rate must be 5 or 10 percent");
  const decimalRate = new Prisma.Decimal(rate).div(100);
  return { rate: decimalRate, amount: new Prisma.Decimal(subtotal).mul(decimalRate).toDecimalPlaces(2) };
};
const pagination = (page: number, limit: number, total: number) => ({
  page,
  limit,
  total,
  totalPages: Math.ceil(total / limit),
  hasNextPage: page * limit < total,
  hasPreviousPage: page > 1,
});
const reference = (prefix: string) =>
  `${prefix}-${crypto.randomBytes(6).toString("hex").toUpperCase()}`;
const percentage = (part: Prisma.Decimal, whole: Prisma.Decimal) =>
  whole.gt(0) ? Number(part.div(whole).mul(100).toDecimalPlaces(2)) : 0;
export const billedVsValuePercentage = (
  billed: string | number,
  value: string | number,
) => percentage(new Prisma.Decimal(billed), new Prisma.Decimal(value));
export const accountingInvoiceDisplayStatus = (
  status: string,
  dueDate: Date | null,
  now = new Date(),
) => (["SENT", "PARTIALLY_PAID"].includes(status) && dueDate && dueDate < now ? "OVERDUE" : status);

const audit = (
  organizationId: string,
  user: AuthUser,
  action: string,
  resource: string,
  resourceId: string,
  summary: string,
  metadata?: Prisma.InputJsonValue,
) =>
  createAuditLog({
    organizationId,
    actorUserId: user.id,
    action,
    resource,
    resourceId,
    summary,
    metadata,
  });

export const getAccountingDashboard = async (
  organizationId: string,
  now = new Date(),
) => {
  const overdueWhere: Prisma.InvoiceWhereInput = {
    organizationId,
    OR: [{ status: "OVERDUE" }, { status: { in: ["SENT", "PARTIALLY_PAID"] }, dueDate: { lt: now } }],
  };
  const [
    invoiceGroups,
    overdueCount,
    wallet,
    pendingApprovals,
    recentInvoices,
    recentWalletActivity,
    paymentRequests,
    overdueAlerts,
    receivedPayments,
    unsettledInvoices,
  ] = await Promise.all([
    prisma.invoice.groupBy({
      by: ["status"],
      where: { organizationId },
      _sum: { total: true, taxAmount: true },
      _count: { _all: true },
    }),
    prisma.invoice.count({ where: overdueWhere }),
    prisma.walletAccount.aggregate({
      where: { organizationId },
      _sum: { balance: true },
    }),
    prisma.paymentRequest.count({
      where: { organizationId, status: "PENDING" },
    }),
    prisma.invoice.findMany({
      where: { organizationId },
      orderBy: [{ issueDate: "desc" }, { createdAt: "desc" }],
      take: 5,
      include: {
        client: { select: { id: true, reference: true, name: true } },
      },
    }),
    prisma.walletTransaction.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: {
        id: true,
        reference: true,
        description: true,
        amount: true,
        direction: true,
        type: true,
        createdAt: true,
      },
    }),
    prisma.paymentRequest.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
      take: 5,
      include: {
        invoice: { select: { id: true, invoiceNo: true } },
        project: { select: { id: true, reference: true, name: true } },
      },
    }),
    prisma.invoice.findMany({
      where: overdueWhere,
      orderBy: { dueDate: "asc" },
      take: 5,
      include: { client: { select: { name: true } } },
    }),
    prisma.accountingInvoicePayment.aggregate({ where: { organizationId }, _sum: { amount: true } }),
    prisma.invoice.findMany({ where: { organizationId, status: { in: ["SENT", "PARTIALLY_PAID", "OVERDUE"] } }, select: { id: true, total: true, amountPayable: true, whtAmount: true, taxAmount: true, dueDate: true, payments: { select: { amount: true } } } }),
  ]);
  const grouped = new Map(invoiceGroups.map((row) => [row.status, row]));
  const paid = grouped.get("PAID");
  const sent = grouped.get("SENT");
  const explicitOverdue = grouped.get("OVERDUE");
  const outstandingBalances = unsettledInvoices.map((invoice) => Prisma.Decimal.max(zero(), invoiceReceivable(invoice).sub(invoice.payments.reduce((sum, payment) => sum.add(payment.amount), zero()))));
  const actualOutstanding = outstandingBalances.reduce((sum, balance) => sum.add(balance), zero());
  const actualOverdue = unsettledInvoices.filter((invoice) => invoice.dueDate && invoice.dueDate < now).reduce((sum, invoice) => sum.add(Prisma.Decimal.max(zero(), invoiceReceivable(invoice).sub(invoice.payments.reduce((paidSum, payment) => paidSum.add(payment.amount), zero())))), zero());
  const sentCount = Math.max(
    0,
    (sent?._count._all ?? 0) -
      overdueCount +
      (explicitOverdue?._count._all ?? 0),
  );
  const alerts = [
    ...overdueAlerts.map((invoice) => ({
      type: "OVERDUE_INVOICE",
      entityId: invoice.id,
      entityReference: invoice.invoiceNo,
      title: "Overdue invoice",
      message: `${invoice.invoiceNo} for ${invoice.client.name} is overdue`,
      amount: amount(invoice.total),
      customerName: invoice.client.name,
      status: "OVERDUE",
      dueDate: invoice.dueDate,
      actionTarget: `/accounting/invoices/${invoice.id}`,
    })),
    ...paymentRequests
      .filter((request) => request.status === "PENDING")
      .map((request) => ({
        type: "PAYMENT_REQUEST_PENDING_APPROVAL",
        entityId: request.id,
        entityReference: request.id,
        title: "Payment request awaiting approval",
        message: request.title,
        amount: amount(request.amount),
        customerName: null,
        status: request.status,
        dueDate: null,
        actionTarget: `/accounting/payment-requests/${request.id}`,
      })),
  ];
  return {
    summary: {
      totalRevenue: amount(receivedPayments._sum.amount),
      outstanding: amount(actualOutstanding),
      overdueAmount: amount(actualOverdue),
      walletBalance: amount(wallet._sum.balance),
      pendingApprovals,
      vatCollected: amount(paid?._sum.taxAmount),
    },
    alerts,
    invoiceStatus: {
      paid: paid?._count._all ?? 0,
      sent: sentCount,
      overdue: overdueCount,
      draft: grouped.get("DRAFT")?._count._all ?? 0,
    },
    recentInvoices: recentInvoices.map((row) => ({
      id: row.id,
      reference: row.invoiceNo,
      customer: row.client,
      amount: amount(row.total),
      dueDate: row.dueDate,
      status: accountingInvoiceDisplayStatus(row.status, row.dueDate, now),
    })),
    recentWalletActivity: recentWalletActivity.map((row) => ({
      ...row,
      amount: amount(row.amount),
      transactionType: row.type,
    })),
    paymentRequests: paymentRequests.map((row) => ({
      id: row.id,
      reference: row.id,
      requester: row.requestedBy,
      invoice: row.invoice,
      project: row.project,
      amount: amount(row.amount),
      status: row.status,
      createdAt: row.createdAt,
    })),
  };
};

export const listAccountingCustomers = async (
  organizationId: string,
  query: AccountingListQuery,
) => {
  const where: Prisma.ClientWhereInput = {
    organizationId,
    ...(query.status !== "ALL" ? { status: query.status } : {}),
    ...(query.search
      ? {
          OR: ["name", "reference", "taxId", "contactPerson", "email"].map(
            (field) => ({ [field]: { contains: query.search } }),
          ),
        }
      : {}),
  };
  const [rows, total, all, active] = await Promise.all([
    prisma.client.findMany({
      where,
      orderBy: { [query.sortBy]: query.sortOrder },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      include: { _count: { select: { invoice: true, projects: true } } },
    }),
    prisma.client.count({ where }),
    prisma.client.count({ where: { organizationId } }),
    prisma.client.count({ where: { organizationId, status: "ACTIVE" } }),
  ]);
  return {
    summary: { totalCustomers: all, activeCustomers: active },
    customers: rows.map((row) => ({
      id: row.id,
      customerId: row.reference,
      companyName: row.name,
      taxId: row.taxId,
      contactPerson: row.contactPerson,
      email: row.email,
      phone: row.phone,
      address: row.address,
      status: row.status,
      since: row.createdAt,
      invoiceCount: row._count.invoice,
      projectCount: row._count.projects,
    })),
    pagination: pagination(query.page, query.limit, total),
  };
};

const customerOwned = async (organizationId: string, id: string) => {
  const row = await prisma.client.findFirst({ where: { id, organizationId } });
  if (!row) throw notFound("Customer not found");
  return row;
};
export const createAccountingCustomer = async (
  organizationId: string,
  input: any,
  user: AuthUser,
) => {
  const row = await prisma.client.create({
    data: {
      organizationId,
      reference: reference("CLT"),
      name: input.companyName,
      taxId: input.taxId,
      contactPerson: input.contactPerson,
      email: input.email,
      phone: input.phone,
      address: input.address,
    },
  });
  await audit(
    organizationId,
    user,
    "ACCOUNTING_CUSTOMER_CREATED",
    "CLIENT",
    row.id,
    `Created customer ${row.name}`,
  );
  return row;
};
export const updateAccountingCustomer = async (
  organizationId: string,
  id: string,
  input: any,
  user: AuthUser,
) => {
  await customerOwned(organizationId, id);
  const row = await prisma.client.update({
    where: { id },
    data: {
      name: input.companyName,
      taxId: input.taxId,
      contactPerson: input.contactPerson,
      email: input.email,
      phone: input.phone,
      address: input.address,
      status: input.status,
      archivedAt:
        input.status === "INACTIVE"
          ? new Date()
          : input.status === "ACTIVE"
            ? null
            : undefined,
    },
  });
  await audit(
    organizationId,
    user,
    "ACCOUNTING_CUSTOMER_UPDATED",
    "CLIENT",
    id,
    `Updated customer ${row.name}`,
  );
  return row;
};
export const deleteAccountingCustomer = async (
  organizationId: string,
  id: string,
  user: AuthUser,
) => {
  const current = await customerOwned(organizationId, id);
  const [invoices, projects] = await Promise.all([
    prisma.invoice.count({ where: { organizationId, clientId: id } }),
    prisma.accountingProject.count({ where: { organizationId, clientId: id } }),
  ]);
  if (invoices || projects) {
    const row = await prisma.client.update({
      where: { id },
      data: { status: "INACTIVE", archivedAt: new Date() },
    });
    await audit(
      organizationId,
      user,
      "ACCOUNTING_CUSTOMER_ARCHIVED",
      "CLIENT",
      id,
      `Archived customer ${current.name}`,
      { invoices, projects },
    );
    return { disposition: "ARCHIVED", customer: row };
  }
  await prisma.client.delete({ where: { id } });
  await audit(
    organizationId,
    user,
    "ACCOUNTING_CUSTOMER_DELETED",
    "CLIENT",
    id,
    `Deleted unused customer ${current.name}`,
  );
  return { disposition: "DELETED" };
};

export const getAccountingCustomer = async (
  organizationId: string,
  id: string,
) => {
  const customer = await prisma.client.findFirst({
    where: { id, organizationId },
    include: {
      invoice: {
        orderBy: { issueDate: "desc" },
        include: {
          project: { select: { id: true, reference: true, name: true } },
          assignedAgent: {
            select: { id: true, firstName: true, lastName: true },
          },
          payments: { select: { amount: true } },
        },
      },
      projects: {
        orderBy: { createdAt: "desc" },
        include: {
          assignedAgent: {
            select: { id: true, firstName: true, lastName: true },
          },
        },
      },
    },
  });
  if (!customer) throw notFound("Customer not found");
  const paymentHistory = await prisma.paymentRequest.findMany({
    where: {
      organizationId,
      OR: [{ invoice: { clientId: id } }, { project: { clientId: id } }],
    },
    orderBy: { createdAt: "desc" },
    include: {
      invoice: { select: { id: true, invoiceNo: true } },
      project: { select: { id: true, reference: true } },
    },
  });
  const billed = customer.invoice.reduce(
    (sum, row) => sum.add(row.total),
    zero(),
  );
  const paid = customer.invoice.reduce((sum, row) => sum.add(row.payments.reduce((paymentSum,payment) => paymentSum.add(payment.amount),zero())), zero());
  return {
    id: customer.id,
    customerId: customer.reference,
    companyName: customer.name,
    status: customer.status,
    email: customer.email,
    taxId: customer.taxId,
    customerSince: customer.createdAt,
    contactPerson: customer.contactPerson,
    phone: customer.phone,
    address: customer.address,
    financialSummary: {
      totalBilled: amount(billed),
      totalPaid: amount(paid),
      invoiceCount: customer.invoice.length,
      overdueCount: customer.invoice.filter(
        (row) =>
          accountingInvoiceDisplayStatus(row.status, row.dueDate) === "OVERDUE",
      ).length,
      projectCount: customer.projects.length,
    },
    invoices: customer.invoice.map((row) => ({
      ...row,
      subtotal: amount(row.subtotal),
      taxAmount: amount(row.taxAmount),
      total: amount(row.total),
      whtRate: row.whtRate ? amount(row.whtRate.mul(100)) : null,
      whtAmount: amount(row.whtAmount),
      amountPayable: amount(invoiceReceivable(row)),
      status: accountingInvoiceDisplayStatus(row.status, row.dueDate),
    })),
    projects: customer.projects.map((row) => ({
      ...row,
      value: amount(row.value),
    })),
    paymentHistory: paymentHistory.map((row) => ({
      ...row,
      amount: amount(row.amount),
    })),
  };
};

export const listCatalogueItems = async (
  organizationId: string,
  query: any,
) => {
  const where: Prisma.AccountingCatalogueItemWhereInput = {
    organizationId,
    ...(query.type !== "ALL" ? { type: query.type } : {}),
    ...(query.status !== "ALL" ? { status: query.status } : {}),
    ...(query.search
      ? {
          OR: [
            { name: { contains: query.search } },
            { reference: { contains: query.search } },
            { description: { contains: query.search } },
          ],
        }
      : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.accountingCatalogueItem.findMany({
      where,
      orderBy: { [query.sortBy]: query.sortOrder },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      include: { _count: { select: { invoiceItems: true } } },
    }),
    prisma.accountingCatalogueItem.count({ where }),
  ]);
  return {
    items: rows.map((row) => ({
      ...row,
      unitPrice: amount(row.unitPrice),
      referencedByInvoices: row._count.invoiceItems,
    })),
    pagination: pagination(query.page, query.limit, total),
  };
};
const itemOwned = async (organizationId: string, id: string) => {
  const row = await prisma.accountingCatalogueItem.findFirst({
    where: { id, organizationId },
    include: { _count: { select: { invoiceItems: true } } },
  });
  if (!row) throw notFound("Item or service not found");
  return row;
};
export const getCatalogueItem = itemOwned;
export const createCatalogueItem = async (
  organizationId: string,
  input: any,
  user: AuthUser,
) => {
  const row = await prisma.accountingCatalogueItem.create({
    data: {
      organizationId,
      reference: reference(input.type === "SERVICE" ? "SRV" : "ITM"),
      ...input,
      unitPrice: new Prisma.Decimal(input.unitPrice),
    },
  });
  await audit(
    organizationId,
    user,
    "ACCOUNTING_ITEM_CREATED",
    "ACCOUNTING_CATALOGUE_ITEM",
    row.id,
    `Created ${row.type.toLowerCase()} ${row.name}`,
  );
  return { ...row, unitPrice: amount(row.unitPrice) };
};
export const updateCatalogueItem = async (
  organizationId: string,
  id: string,
  input: any,
  user: AuthUser,
) => {
  await itemOwned(organizationId, id);
  const row = await prisma.accountingCatalogueItem.update({
    where: { id },
    data: {
      ...input,
      ...(input.unitPrice !== undefined
        ? { unitPrice: new Prisma.Decimal(input.unitPrice) }
        : {}),
      archivedAt:
        input.status === "INACTIVE"
          ? new Date()
          : input.status === "ACTIVE"
            ? null
            : undefined,
    },
  });
  await audit(
    organizationId,
    user,
    "ACCOUNTING_ITEM_UPDATED",
    "ACCOUNTING_CATALOGUE_ITEM",
    id,
    `Updated ${row.type.toLowerCase()} ${row.name}`,
  );
  return { ...row, unitPrice: amount(row.unitPrice) };
};
export const deleteCatalogueItem = async (
  organizationId: string,
  id: string,
  user: AuthUser,
) => {
  const row = await itemOwned(organizationId, id);
  if (row._count.invoiceItems) {
    const archived = await prisma.accountingCatalogueItem.update({
      where: { id },
      data: { status: "INACTIVE", archivedAt: new Date() },
    });
    await audit(
      organizationId,
      user,
      "ACCOUNTING_ITEM_ARCHIVED",
      "ACCOUNTING_CATALOGUE_ITEM",
      id,
      `Archived referenced item ${row.name}`,
    );
    return { disposition: "ARCHIVED", item: archived };
  }
  await prisma.accountingCatalogueItem.delete({ where: { id } });
  await audit(
    organizationId,
    user,
    "ACCOUNTING_ITEM_DELETED",
    "ACCOUNTING_CATALOGUE_ITEM",
    id,
    `Deleted unused item ${row.name}`,
  );
  return { disposition: "DELETED" };
};

const assertProjectRelations = async (
  organizationId: string,
  clientId: string,
  assignedAgentId?: string | null,
) => {
  const client = await prisma.client.findFirst({
    where: { id: clientId, organizationId, status: "ACTIVE" },
    select: { id: true },
  });
  if (!client) throw notFound("Active customer not found");
  if (!assignedAgentId) return;
  const agent = await prisma.user.findFirst({
    where: { id: assignedAgentId, organizationId, isActive: true },
    include: {
      role: { include: { permissions: { include: { permission: true } } } },
    },
  });
  const permission = agent?.role.permissions.some((entry) =>
    entry.permission.key.startsWith("accounting:"),
  );
  const moduleAccess = Array.isArray(agent?.moduleAccess)
    ? agent.moduleAccess.includes("ACCOUNTING")
    : true;
  if (!agent || !permission || !moduleAccess)
    throw notFound("Accounting agent not found");
};
const projectOwned = async (organizationId: string, id: string) => {
  const row = await prisma.accountingProject.findFirst({
    where: { id, organizationId },
  });
  if (!row) throw notFound("Project not found");
  return row;
};
export const listAccountingProjects = async (
  organizationId: string,
  query: any,
) => {
  const where: Prisma.AccountingProjectWhereInput = {
    organizationId,
    ...(query.status !== "ALL" ? { status: query.status } : {}),
    ...(query.search
      ? {
          OR: [
            { name: { contains: query.search } },
            { reference: { contains: query.search } },
            { client: { name: { contains: query.search } } },
          ],
        }
      : {}),
  };
  const [rows, total, active, all] = await Promise.all([
    prisma.accountingProject.findMany({
      where,
      orderBy: { [query.sortBy]: query.sortOrder },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      include: {
        client: { select: { id: true, reference: true, name: true } },
        assignedAgent: {
          select: { id: true, firstName: true, lastName: true },
        },
        _count: { select: { invoices: true } },
      },
    }),
    prisma.accountingProject.count({ where }),
    prisma.accountingProject.count({
      where: { organizationId, status: "ACTIVE" },
    }),
    prisma.accountingProject.count({ where: { organizationId } }),
  ]);
  return {
    summary: { totalProjects: all, activeProjects: active },
    projects: rows.map((row) => ({ ...row, value: amount(row.value) })),
    pagination: pagination(query.page, query.limit, total),
  };
};
export const createAccountingProject = async (
  organizationId: string,
  input: any,
  user: AuthUser,
) => {
  await assertProjectRelations(
    organizationId,
    input.clientId,
    input.assignedAgentId,
  );
  const row = await prisma.accountingProject.create({
    data: {
      ...input,
      organizationId,
      reference: reference("PRJ"),
      value: new Prisma.Decimal(input.value),
    },
  });
  await audit(
    organizationId,
    user,
    "ACCOUNTING_PROJECT_CREATED",
    "ACCOUNTING_PROJECT",
    row.id,
    `Created project ${row.name}`,
  );
  return { ...row, value: amount(row.value) };
};
export const updateAccountingProject = async (
  organizationId: string,
  id: string,
  input: any,
  user: AuthUser,
) => {
  const current = await projectOwned(organizationId, id);
  const startDate = input.startDate ?? current.startDate;
  const endDate = input.endDate === undefined ? current.endDate : input.endDate;
  if (endDate && endDate < startDate)
    throw conflict("End date cannot precede start date");
  await assertProjectRelations(
    organizationId,
    input.clientId ?? current.clientId,
    input.assignedAgentId === undefined
      ? current.assignedAgentId
      : input.assignedAgentId,
  );
  const row = await prisma.accountingProject.update({
    where: { id },
    data: {
      ...input,
      ...(input.value !== undefined
        ? { value: new Prisma.Decimal(input.value) }
        : {}),
    },
  });
  await audit(
    organizationId,
    user,
    "ACCOUNTING_PROJECT_UPDATED",
    "ACCOUNTING_PROJECT",
    id,
    `Updated project ${row.name}`,
  );
  return { ...row, value: amount(row.value) };
};
export const deleteAccountingProject = async (
  organizationId: string,
  id: string,
  user: AuthUser,
) => {
  const row = await projectOwned(organizationId, id);
  const [invoices, requests] = await Promise.all([
    prisma.invoice.count({ where: { organizationId, projectId: id } }),
    prisma.paymentRequest.count({ where: { organizationId, projectId: id } }),
  ]);
  if (invoices || requests) {
    const archived = await prisma.accountingProject.update({
      where: { id },
      data: { status: "COMPLETED", archivedAt: new Date() },
    });
    await audit(
      organizationId,
      user,
      "ACCOUNTING_PROJECT_ARCHIVED",
      "ACCOUNTING_PROJECT",
      id,
      `Archived referenced project ${row.name}`,
      { invoices, requests },
    );
    return { disposition: "ARCHIVED", project: archived };
  }
  await prisma.accountingProject.delete({ where: { id } });
  await audit(
    organizationId,
    user,
    "ACCOUNTING_PROJECT_DELETED",
    "ACCOUNTING_PROJECT",
    id,
    `Deleted unused project ${row.name}`,
  );
  return { disposition: "DELETED" };
};
export const getAccountingProject = async (
  organizationId: string,
  id: string,
) => {
  const row = await prisma.accountingProject.findFirst({
    where: { id, organizationId },
    include: {
      client: { select: { id: true, reference: true, name: true } },
      assignedAgent: { select: { id: true, firstName: true, lastName: true } },
      invoices: {
        orderBy: { issueDate: "desc" },
        include: {
          assignedAgent: {
            select: { id: true, firstName: true, lastName: true },
          },
          payments: { select: { amount: true } },
        },
      },
    },
  });
  if (!row) throw notFound("Project not found");
  const billed = row.invoices.reduce(
    (sum, invoice) => sum.add(invoice.total),
    zero(),
  );
  const paid = row.invoices.reduce((sum, invoice) => sum.add(invoice.payments.reduce((paymentSum,payment) => paymentSum.add(payment.amount),zero())), zero());
  return {
    ...row,
    value: amount(row.value),
    financialSummary: {
      projectValue: amount(row.value),
      totalBilled: amount(billed),
      totalPaid: amount(paid),
      invoiceCount: row.invoices.length,
      billedVsValuePercentage: percentage(billed, row.value),
    },
    invoices: row.invoices.map((invoice) => ({
      ...invoice,
      subtotal: amount(invoice.subtotal),
      vat: amount(invoice.taxAmount),
      total: amount(invoice.total),
      whtRate: invoice.whtRate ? amount(invoice.whtRate.mul(100)) : null,
      whtAmount: amount(invoice.whtAmount),
      amountPayable: amount(invoiceReceivable(invoice)),
      status: accountingInvoiceDisplayStatus(invoice.status, invoice.dueDate),
    })),
  };
};

const invoiceInclude = {
  client: {
    select: { id: true, reference: true, name: true, email: true, taxId: true },
  },
  project: {
    select: { id: true, reference: true, name: true, clientId: true },
  },
  assignedAgent: {
    select: { id: true, firstName: true, lastName: true, email: true },
  },
  items: {
    include: {
      catalogueItem: { select: { reference: true, name: true, unit: true } },
    },
  },
  payments: {
    orderBy: { paidAt: "asc" as const },
    include: {
      recordedBy: { select: { id: true, firstName: true, lastName: true } },
    },
  },
  paymentRequests: { select: { id: true } },
  statusHistory: {
    orderBy: { createdAt: "asc" as const },
    include: {
      actor: { select: { id: true, firstName: true, lastName: true } },
    },
  },
};
const invoiceView = (row: any, now = new Date()) => {
  const paidAmount = (row.payments ?? []).reduce(
    (sum: Prisma.Decimal, payment: any) => sum.add(payment.amount),
    zero(),
  );
  const balanceDue = Prisma.Decimal.max(
    zero(),
    invoiceReceivable(row).sub(paidAmount),
  );
  const displayStatus = accountingInvoiceDisplayStatus(
    row.status,
    row.dueDate,
    now,
  );
  return {
    ...row,
    status: displayStatus,
    subtotal: amount(row.subtotal),
    vat: amount(row.taxAmount),
    total: amount(row.total),
    whtApplicable: row.whtApplicable,
    whtRate: row.whtRate ? amount(row.whtRate.mul(100)) : null,
    whtAmount: amount(row.whtAmount),
    amountPayable: amount(invoiceReceivable(row)),
    paidAmount: amount(paidAmount),
    balanceDue: amount(balanceDue),
    payments: (row.payments ?? []).map((payment: any) => ({
      ...payment,
      amount: amount(payment.amount),
    })),
    items: row.items.map((item: any) => ({
      ...item,
      quantity: amount(item.quantity),
      unitPrice: amount(item.unitPrice),
      lineSubtotal: amount(item.lineSubtotal),
      vatRate: amount(item.vatRate),
      vatAmount: amount(item.vatAmount),
      total: amount(item.total),
    })),
    allowedActions: {
      edit: row.status === "DRAFT",
      send: row.status === "DRAFT",
      recordPayment:
        ["SENT", "PARTIALLY_PAID", "OVERDUE"].includes(displayStatus) &&
        balanceDue.gt(0),
      delete: row.status === "DRAFT",
    },
  };
};
const invoiceOwned = async (organizationId: string, id: string) => {
  const row = await prisma.invoice.findFirst({
    where: { id, organizationId },
    include: invoiceInclude,
  });
  if (!row) throw notFound("Invoice not found");
  return row;
};
const assertClientOwnership = async (
  organizationId: string,
  clientId: string,
) => {
  const client = await prisma.client.findFirst({
    where: { id: clientId, organizationId, archivedAt: null },
    select: { id: true },
  });
  if (!client) throw notFound("Customer not found");
};
const assertInvoiceRelations = async (
  organizationId: string,
  clientId: string,
  projectId?: string | null,
  agentId?: string | null,
) => {
  await assertClientOwnership(organizationId, clientId);
  if (projectId) {
    const project = await prisma.accountingProject.findFirst({
      where: { id: projectId, organizationId, clientId, archivedAt: null },
      select: { id: true },
    });
    if (!project) throw notFound("Project not found for selected customer");
  }
  if (agentId) await assertProjectRelations(organizationId, clientId, agentId);
};
const resolveInvoiceLines = async (
  organizationId: string,
  lines: InvoiceItemInput[],
) => {
  const ids = [
    ...new Set(
      lines.flatMap((line) =>
        line.catalogueItemId ? [line.catalogueItemId] : [],
      ),
    ),
  ];
  const catalogue = ids.length
    ? await prisma.accountingCatalogueItem.findMany({
        where: { organizationId, id: { in: ids }, status: "ACTIVE" },
      })
    : [];
  if (catalogue.length !== ids.length)
    throw notFound("One or more catalogue items were not found");
  const byId = new Map(catalogue.map((item) => [item.id, item]));
  const config = await getPlatformConfigurationValue();
  const vatRate = new Prisma.Decimal(config.vatRate).div(100);
  return lines.map((line) => {
    const item = line.catalogueItemId
      ? byId.get(line.catalogueItemId)
      : undefined;
    const unitPrice = new Prisma.Decimal(line.unitPrice ?? item!.unitPrice);
    const quantity = new Prisma.Decimal(line.quantity);
    const lineSubtotal = unitPrice.mul(quantity).toDecimalPlaces(2);
    const vatApplicable = line.vatApplicable ?? item?.vatApplicable ?? false;
    const lineVatRate = vatApplicable ? vatRate : zero();
    const vatAmount = lineSubtotal.mul(lineVatRate).toDecimalPlaces(2);
    return {
      catalogueItemId: item?.id,
      description: line.description ?? item!.name,
      quantity,
      unitPrice,
      lineSubtotal,
      vatApplicable,
      vatRate: lineVatRate,
      vatAmount,
      total: lineSubtotal.add(vatAmount),
    };
  });
};

export const listInvoices = async (
  organizationId: string,
  query: InvoiceListQuery,
) => {
  const where: Prisma.InvoiceWhereInput = {
    organizationId,
    ...(query.clientId ? { clientId: query.clientId } : {}),
    ...(query.agentId ? { assignedAgentId: query.agentId } : {}),
    ...(query.projectId ? { projectId: query.projectId } : {}),
    ...(query.status && query.status !== "ALL"
      ? query.status === "OVERDUE"
        ? {
            OR: [
              { status: "OVERDUE" },
              { status: { in: ["SENT", "PARTIALLY_PAID"] }, dueDate: { lt: new Date() } },
            ],
          }
        : { status: query.status }
      : {}),
    ...(query.fromDate || query.toDate
      ? {
          issueDate: {
            ...(query.fromDate ? { gte: query.fromDate } : {}),
            ...(query.toDate ? { lte: query.toDate } : {}),
          },
        }
      : {}),
    ...(query.search
      ? {
          OR: [
            { invoiceNo: { contains: query.search } },
            { client: { name: { contains: query.search } } },
          ],
        }
      : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.invoice.findMany({
      where,
      orderBy: { [query.sortBy]: query.sortOrder },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      include: invoiceInclude,
    }),
    prisma.invoice.count({ where }),
  ]);
  return {
    invoices: rows.map((row) => invoiceView(row)),
    pagination: pagination(query.page, query.limit, total),
  };
};
export const getInvoiceById = async (organizationId: string, id: string) =>
  invoiceView(await invoiceOwned(organizationId, id));
export const createInvoice = async (
  organizationId: string,
  input: InvoiceCreateInput,
  user: AuthUser,
) => {
  await assertInvoiceRelations(
    organizationId,
    input.clientId,
    input.projectId,
    input.assignedAgentId,
  );
  const lines = await resolveInvoiceLines(organizationId, input.items);
  const subtotal = lines.reduce(
    (sum, line) => sum.add(line.lineSubtotal),
    zero(),
  );
  const taxAmount = lines.reduce(
    (sum, line) => sum.add(line.vatAmount),
    zero(),
  );
  const defaultTemplate = await prisma.accountingInvoiceTemplate.findFirst({
    where: { organizationId, isDefault: true },
    select: { id: true, name: true, paymentTerms: true, headerNote: true, footerNote: true },
  });
  const wht = calculateInvoiceWht(subtotal, input.whtApplicable ?? false, input.whtRate);
  const total = subtotal.add(taxAmount);
  const invoice = await prisma.$transaction(async (tx) => {
    const row = await tx.invoice.create({
      data: {
        organizationId,
        clientId: input.clientId,
        assignedAgentId: input.assignedAgentId,
        projectId: input.projectId,
        invoiceNo: reference("INV"),
        issueDate: input.issueDate ?? new Date(),
        dueDate: input.dueDate,
        status: "DRAFT",
        subtotal,
        taxAmount,
        total,
        whtApplicable: input.whtApplicable ?? false,
        whtRate: wht.rate,
        whtAmount: wht.amount,
        amountPayable: total.sub(wht.amount),
        notes: input.notes,
        templateSnapshot: defaultTemplate ?? Prisma.JsonNull,
        items: { create: lines },
      },
    });
    await tx.accountingInvoiceStatusHistory.create({
      data: {
        organizationId,
        invoiceId: row.id,
        status: "DRAFT",
        actorUserId: user.id,
        description: "Invoice created",
      },
    });
    return row;
  });
  await audit(
    organizationId,
    user,
    "ACCOUNTING_INVOICE_CREATED",
    "INVOICE",
    invoice.id,
    `Created invoice ${invoice.invoiceNo}`,
  );
  return getInvoiceById(organizationId, invoice.id);
};
export const updateInvoice = async (
  organizationId: string,
  id: string,
  input: InvoiceUpdateInput,
  user: AuthUser,
) => {
  const current = await invoiceOwned(organizationId, id);
  if (current.status !== "DRAFT")
    throw conflict("Only draft invoices can be edited");
  const clientId = input.clientId ?? current.clientId;
  await assertInvoiceRelations(
    organizationId,
    clientId,
    input.projectId === undefined ? current.projectId : input.projectId,
    input.assignedAgentId === undefined
      ? current.assignedAgentId
      : input.assignedAgentId,
  );
  const lines = input.items
    ? await resolveInvoiceLines(organizationId, input.items)
    : undefined;
  const subtotal = lines?.reduce(
    (sum, line) => sum.add(line.lineSubtotal),
    zero(),
  );
  const taxAmount = lines?.reduce(
    (sum, line) => sum.add(line.vatAmount),
    zero(),
  );
  const finalSubtotal = subtotal ?? current.subtotal;
  const finalTaxAmount = taxAmount ?? current.taxAmount;
  const whtApplicable = input.whtApplicable ?? current.whtApplicable;
  const requestedRate = input.whtRate ?? (current.whtRate ? Number(current.whtRate.mul(100)) as 5 | 10 : undefined);
  if (!whtApplicable && input.whtRate !== undefined)
    throw conflict("WHT rate requires WHT to be enabled");
  const wht = calculateInvoiceWht(finalSubtotal, whtApplicable, requestedRate);
  const finalTotal = finalSubtotal.add(finalTaxAmount);
  await prisma.invoice.update({
    where: { id },
    data: {
      clientId: input.clientId,
      assignedAgentId: input.assignedAgentId,
      projectId: input.projectId,
      issueDate: input.issueDate,
      dueDate: input.dueDate,
      notes: input.notes,
      whtApplicable,
      whtRate: wht.rate,
      whtAmount: wht.amount,
      amountPayable: finalTotal.sub(wht.amount),
      ...(lines
        ? {
            subtotal,
            taxAmount,
            total: finalTotal,
            items: { deleteMany: {}, create: lines },
          }
        : {}),
    },
  });
  await audit(
    organizationId,
    user,
    "ACCOUNTING_INVOICE_UPDATED",
    "INVOICE",
    id,
    `Updated invoice ${current.invoiceNo}`,
  );
  return getInvoiceById(organizationId, id);
};
export const sendInvoice = async (
  organizationId: string,
  id: string,
  user: AuthUser,
) => {
  const current = await invoiceOwned(organizationId, id);
  if (current.status !== "DRAFT")
    throw conflict("Only draft invoices can be sent");
  if (!current.client.email)
    throw conflict("Customer email is required before sending an invoice");
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { name: true },
  });
  await sendTransactionalNotificationEmail({
    to: current.client.email,
    recipientName: current.client.name,
    subject: `Invoice ${current.invoiceNo} from ${organization?.name ?? "Sinkronis"}`,
    message: `Invoice ${current.invoiceNo} for ${invoiceReceivable(current).toFixed(2)} is due ${current.dueDate?.toISOString().slice(0, 10) ?? "on receipt"}.`,
  });
  const now = new Date();
  await prisma.$transaction([
    prisma.invoice.update({
      where: { id },
      data: { status: "SENT", sentAt: now },
    }),
    prisma.accountingInvoiceStatusHistory.create({
      data: {
        organizationId,
        invoiceId: id,
        status: "SENT",
        actorUserId: user.id,
        description: "Invoice sent to customer",
      },
    }),
  ]);
  await audit(
    organizationId,
    user,
    "ACCOUNTING_INVOICE_SENT",
    "INVOICE",
    id,
    `Sent invoice ${current.invoiceNo}`,
  );
  return getInvoiceById(organizationId, id);
};
export const recordInvoicePayment = async (
  organizationId: string,
  id: string,
  input: InvoicePaymentInput,
  user: AuthUser,
) => {
  const current = await invoiceOwned(organizationId, id);
  const existing = await prisma.accountingInvoicePayment.findFirst({
    where: { organizationId, reference: input.reference },
  });
  if (existing) {
    if (existing.invoiceId === id) return getInvoiceById(organizationId, id);
    throw conflict("Payment reference has already been used");
  }
  if (
    !["SENT", "PARTIALLY_PAID", "OVERDUE"].includes(
      accountingInvoiceDisplayStatus(current.status, current.dueDate),
    )
  )
    throw conflict(
      "Only sent, partially paid, or overdue invoices can receive payment",
    );
  const alreadyPaid = current.payments.reduce(
    (sum, payment) => sum.add(payment.amount),
    zero(),
  );
  const paymentAmount = new Prisma.Decimal(input.amount);
  const balance = invoiceReceivable(current).sub(alreadyPaid);
  if (paymentAmount.gt(balance))
    throw conflict("Payment amount cannot exceed the invoice balance");
  const paidAt = input.paidAt ?? new Date();
  const nextStatus = paymentAmount.equals(balance)
    ? ("PAID" as const)
    : ("PARTIALLY_PAID" as const);
  try {
    await prisma.$transaction([
      prisma.accountingInvoicePayment.create({
        data: {
          organizationId,
          invoiceId: id,
          reference: input.reference,
          amount: paymentAmount,
          paidAt,
          notes: input.notes,
          recordedById: user.id,
        },
      }),
      prisma.invoice.update({
        where: { id },
        data: {
          status: nextStatus,
          paidAt: nextStatus === "PAID" ? paidAt : null,
          paymentReference: nextStatus === "PAID" ? input.reference : null,
        },
      }),
      prisma.accountingInvoiceStatusHistory.create({
        data: {
          organizationId,
          invoiceId: id,
          status: nextStatus,
          actorUserId: user.id,
          description: `${nextStatus === "PAID" ? "Final" : "Partial"} payment ${input.reference} recorded`,
        },
      }),
    ]);
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    )
      throw conflict("Payment reference has already been used");
    throw error;
  }
  await audit(
    organizationId,
    user,
    "ACCOUNTING_INVOICE_PAYMENT_RECORDED",
    "INVOICE",
    id,
    `Recorded ${nextStatus === "PAID" ? "final" : "partial"} payment for ${current.invoiceNo}`,
    {
      paymentReference: input.reference,
      amount: input.amount,
      status: nextStatus,
    },
  );
  return getInvoiceById(organizationId, id);
};
export const deleteInvoice = async (
  organizationId: string,
  id: string,
  user: AuthUser,
) => {
  const current = await invoiceOwned(organizationId, id);
  if (current.status !== "DRAFT" || current.paymentRequests.length)
    throw conflict(
      "Only draft invoices without financial activity can be deleted",
    );
  await prisma.invoice.delete({ where: { id } });
  await audit(
    organizationId,
    user,
    "ACCOUNTING_INVOICE_DELETED",
    "INVOICE",
    id,
    `Deleted draft invoice ${current.invoiceNo}`,
  );
};
const csvCell = (value: unknown) => {
  const safe = String(value ?? "")
    .replace(/^([=+\-@])/, "'$1")
    .replace(/"/g, '""');
  return `"${safe}"`;
};
export const exportInvoices = async (
  organizationId: string,
  query: InvoiceListQuery,
  user: AuthUser,
) => {
  const invoices: any[] = [];
  for (let pageNumber = 1; ; pageNumber += 1) {
    const pageResult = await listInvoices(organizationId, { ...query, page: pageNumber, limit: 100 });
    invoices.push(...pageResult.invoices);
    if (pageNumber >= pageResult.pagination.totalPages) break;
  }
  const csv = `\uFEFF${[["Invoice", "Customer", "Agent", "Project", "Subtotal", "VAT", "Total", "WHT Rate", "WHT Amount", "Amount Payable", "Paid", "Balance", "Issue Date", "Due Date", "Status"], ...invoices.map((row: any) => [row.invoiceNo, row.client.name, row.assignedAgent ? `${row.assignedAgent.firstName} ${row.assignedAgent.lastName}` : "", row.project?.name ?? "", row.subtotal, row.vat, row.total, row.whtRate ?? "", row.whtAmount, row.amountPayable, row.paidAmount, row.balanceDue, row.issueDate.toISOString(), row.dueDate?.toISOString() ?? "", row.status])].map((line) => line.map(csvCell).join(",")).join("\r\n")}\r\n`;
  await audit(
    organizationId,
    user,
    "ACCOUNTING_INVOICES_EXPORTED",
    "INVOICE",
    "export",
    "Exported filtered invoices",
  );
  return csv;
};

const splitName = (fullName: string) => {
  const parts = fullName.trim().split(/\s+/);
  return { firstName: parts.shift()!, lastName: parts.join(" ") || "Agent" };
};
const assertAccountingRole = async (organizationId: string, roleId: string) => {
  const role = await prisma.role.findFirst({
    where: {
      id: roleId,
      organizationId,
      permissions: {
        some: { permission: { key: { startsWith: "accounting:" } } },
      },
    },
    select: { id: true, name: true },
  });
  if (!role) throw notFound("Accounting role not found");
  return role;
};
export const listAccountingAgents = async (
  organizationId: string,
  query: AgentListQuery,
) => {
  const userWhere: Prisma.AccountingAgentProfileWhereInput = {
    organizationId,
    ...(query.status !== "ALL" && query.status !== "PENDING"
      ? { status: query.status }
      : {}),
    ...(query.search
      ? {
          OR: [
            { reference: { contains: query.search } },
            {
              user: {
                OR: [
                  { email: { contains: query.search } },
                  { firstName: { contains: query.search } },
                  { lastName: { contains: query.search } },
                ],
              },
            },
          ],
        }
      : {}),
  };
  const inviteWhere: Prisma.AgentInvitationWhereInput = {
    organizationId,
    purpose: "ACCOUNTING_AGENT",
    status: "PENDING",
    expiresAt: { gt: new Date() },
    ...(query.search
      ? {
          OR: [
            { email: { contains: query.search } },
            { fullName: { contains: query.search } },
          ],
        }
      : {}),
  };
  const includeProfiles = query.status !== "PENDING";
  const includeInvites = ["ALL", "PENDING"].includes(query.status);
  const [profiles, invites, active, inactive, pending] = await Promise.all([
    includeProfiles
      ? prisma.accountingAgentProfile.findMany({
          where: userWhere,
          include: {
            user: {
              include: {
                role: { select: { id: true, name: true } },
                employee: { select: { phone: true } },
                _count: {
                  select: {
                    assignedAccountingInvoices: true,
                    assignedAccountingProjects: true,
                  },
                },
              },
            },
          },
          orderBy: { createdAt: "desc" },
        })
      : [],
    includeInvites
      ? prisma.agentInvitation.findMany({
          where: inviteWhere,
          include: { role: { select: { id: true, name: true } } },
          orderBy: { createdAt: "desc" },
        })
      : [],
    prisma.accountingAgentProfile.count({
      where: { organizationId, status: "ACTIVE" },
    }),
    prisma.accountingAgentProfile.count({
      where: { organizationId, status: "INACTIVE" },
    }),
    prisma.agentInvitation.count({
      where: {
        organizationId,
        purpose: "ACCOUNTING_AGENT",
        status: "PENDING",
        expiresAt: { gt: new Date() },
      },
    }),
  ]);
  const rows = [
    ...profiles.map((profile) => ({
      id: profile.id,
      agentId: profile.reference,
      userId: profile.userId,
      name: `${profile.user.firstName} ${profile.user.lastName}`,
      email: profile.user.email,
      phone: profile.phone ?? profile.user.employee?.phone ?? null,
      role: profile.user.role,
      invoiceCount: profile.user._count.assignedAccountingInvoices,
      projectCount: profile.user._count.assignedAccountingProjects,
      status: profile.status,
      invitedAt: profile.invitedAt,
      createdAt: profile.createdAt,
    })),
    ...invites.map((invite) => ({
      id: invite.id,
      agentId: null,
      userId: null,
      name: invite.fullName,
      email: invite.email,
      phone: invite.phone,
      role: invite.role,
      invoiceCount: 0,
      projectCount: 0,
      status: "PENDING",
      invitedAt: invite.createdAt,
      createdAt: invite.createdAt,
    })),
  ];
  const start = (query.page - 1) * query.limit;
  return {
    summary: {
      totalAgents: active + inactive + pending,
      active,
      pendingInvites: pending,
      inactive,
    },
    agents: rows.slice(start, start + query.limit),
    pagination: pagination(query.page, query.limit, rows.length),
  };
};
export const inviteAccountingAgent = async (
  organizationId: string,
  input: AgentInviteInput,
  user: AuthUser,
) => {
  const email = input.email.toLowerCase();
  const role = await assertAccountingRole(organizationId, input.roleId);
  const activeInvite = await prisma.agentInvitation.findFirst({
    where: {
      organizationId,
      email,
      purpose: "ACCOUNTING_AGENT",
      status: "PENDING",
      expiresAt: { gt: new Date() },
    },
    select: { id: true },
  });
  if (activeInvite)
    throw conflict("An active invitation already exists for this email");
  const existing = await prisma.user.findFirst({
    where: { organizationId, email },
    include: { accountingAgentProfile: true },
  });
  if (existing?.accountingAgentProfile)
    throw conflict("User is already an Accounting agent");
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 7 * 86400000);
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { name: true },
  });
  const names = splitName(input.fullName);
  const created = await prisma.$transaction(async (tx) => {
    const invitee =
      existing ??
      (await tx.user.create({
        data: {
          organizationId,
          roleId: role.id,
          email,
          ...names,
          passwordHash: await bcrypt.hash(
            crypto.randomBytes(32).toString("hex"),
            12,
          ),
          isActive: false,
          moduleAccess: ["ACCOUNTING"],
        },
      }));
    if (
      existing &&
      (!existing.moduleAccess ||
        !Array.isArray(existing.moduleAccess) ||
        !existing.moduleAccess
          .map(String)
          .some((value) => value.toLowerCase() === "accounting"))
    )
      await tx.user.update({
        where: { id: existing.id },
        data: {
          moduleAccess: [
            ...(Array.isArray(existing.moduleAccess)
              ? existing.moduleAccess.map(String)
              : []),
            "ACCOUNTING",
          ],
        },
      });
    const invitation = await tx.agentInvitation.create({
      data: {
        organizationId,
        email,
        token,
        expiresAt,
        roleId: role.id,
        invitedByUserId: user.id,
        moduleAccess: ["ACCOUNTING"],
        purpose: "ACCOUNTING_AGENT",
        fullName: input.fullName,
        phone: input.phone,
      },
    });
    const profile = await tx.accountingAgentProfile.create({
      data: {
        organizationId,
        userId: invitee.id,
        reference: reference("AGT"),
        phone: input.phone,
        status: existing?.isActive ? "ACTIVE" : "INACTIVE",
        invitedAt: new Date(),
      },
    });
    return { invitation, profile };
  });
  try {
    const delivery = await sendWorkspaceInvitationEmail({
      to: email,
      organizationName: organization?.name ?? "Sinkronis",
      roleName: role.name,
      setupUrl: workspaceInvitationSetupUrl(token),
      expiresAt,
    });
    await prisma.agentInvitation.update({
      where: { id: created.invitation.id },
      data: {
        deliveryStatus: "SENT",
        deliveryAttemptedAt: new Date(),
        deliveredAt: new Date(),
        deliveryProvider: "SMTP",
        providerMessageId: delivery.messageId,
      },
    });
  } catch (error) {
    await prisma.agentInvitation.update({
      where: { id: created.invitation.id },
      data: {
        deliveryStatus: "FAILED",
        deliveryAttemptedAt: new Date(),
        deliveryErrorCode: "EMAIL_DELIVERY_FAILED",
        deliveryErrorMessage:
          error instanceof Error
            ? error.message.slice(0, 500)
            : "Email delivery failed",
      },
    });
    throw error;
  }
  await audit(
    organizationId,
    user,
    "ACCOUNTING_AGENT_INVITED",
    "ACCOUNTING_AGENT",
    created.profile.id,
    `Invited Accounting agent ${email}`,
  );
  return {
    id: created.invitation.id,
    agentId: created.profile.reference,
    email,
    expiresAt,
    deliveryStatus: "SENT",
  };
};
export const bulkInviteAccountingAgents = async (
  organizationId: string,
  input: AgentBulkInviteInput,
  user: AuthUser,
) => {
  const normalized = [
    ...new Set(
      input.entries
        .split(/[\n,]+/)
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
  const invited: unknown[] = [],
    skipped: unknown[] = [],
    failed: unknown[] = [];
  for (const email of normalized) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      failed.push({ email, reason: "INVALID_EMAIL" });
      continue;
    }
    try {
      invited.push(
        await inviteAccountingAgent(
          organizationId,
          {
            fullName: email.split("@")[0].replace(/[._-]+/g, " "),
            email,
            roleId: input.roleId,
          },
          user,
        ),
      );
    } catch (error) {
      const reason =
        error instanceof Error ? error.message : "INVITATION_FAILED";
      (reason.includes("already") ? skipped : failed).push({ email, reason });
    }
  }
  return { invited, skipped, failed };
};
export const updateAccountingAgent = async (
  organizationId: string,
  id: string,
  input: AgentUpdateInput,
  user: AuthUser,
) => {
  const profile = await prisma.accountingAgentProfile.findFirst({
    where: { id, organizationId },
    include: { user: true },
  });
  if (!profile) throw notFound("Accounting agent not found");
  if (input.roleId) await assertAccountingRole(organizationId, input.roleId);
  const names = input.fullName ? splitName(input.fullName) : {};
  const updated = await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: profile.userId },
      data: { ...names, roleId: input.roleId },
    });
    return tx.accountingAgentProfile.update({
      where: { id },
      data: {
        phone: input.phone,
        status: input.status,
        deactivatedAt:
          input.status === "INACTIVE"
            ? new Date()
            : input.status === "ACTIVE"
              ? null
              : undefined,
      },
    });
  });
  await audit(
    organizationId,
    user,
    "ACCOUNTING_AGENT_UPDATED",
    "ACCOUNTING_AGENT",
    id,
    `Updated Accounting agent ${profile.user.email}`,
  );
  return updated;
};
export const removeAccountingAgent = async (
  organizationId: string,
  id: string,
  user: AuthUser,
) => {
  const profile = await prisma.accountingAgentProfile.findFirst({
    where: { id, organizationId },
    include: { user: { select: { email: true } } },
  });
  if (!profile) throw notFound("Accounting agent not found");
  const row = await prisma.accountingAgentProfile.update({
    where: { id },
    data: { status: "INACTIVE", deactivatedAt: new Date() },
  });
  await audit(
    organizationId,
    user,
    "ACCOUNTING_AGENT_DEACTIVATED",
    "ACCOUNTING_AGENT",
    id,
    `Deactivated Accounting agent ${profile.user.email}`,
  );
  return row;
};

const paymentRequestInclude = {
  requester: {
    select: { id: true, firstName: true, lastName: true, email: true },
  },
  client: { select: { id: true, reference: true, name: true } },
  invoice: {
    select: {
      id: true,
      invoiceNo: true,
      total: true,
      status: true,
      clientId: true,
    },
  },
  project: {
    select: { id: true, reference: true, name: true, clientId: true },
  },
};
const paymentRequestOwned = async (organizationId: string, id: string) => {
  const row = await prisma.paymentRequest.findFirst({
    where: { id, organizationId },
    include: paymentRequestInclude,
  });
  if (!row) throw notFound("Payment request not found");
  return row;
};
export const listPaymentRequests = async (
  organizationId: string,
  query: PaymentRequestListQuery,
) => {
  const where: Prisma.PaymentRequestWhereInput = {
    organizationId,
    ...(query.status !== "ALL" ? { status: query.status } : {}),
    ...(query.fromDate || query.toDate
      ? {
          createdAt: {
            ...(query.fromDate ? { gte: query.fromDate } : {}),
            ...(query.toDate ? { lte: query.toDate } : {}),
          },
        }
      : {}),
    ...(query.search
      ? {
          OR: [
            { title: { contains: query.search } },
            { description: { contains: query.search } },
            { invoice: { invoiceNo: { contains: query.search } } },
          ],
        }
      : {}),
  };
  const [rows, total, pending, declined, completed] = await Promise.all([
    prisma.paymentRequest.findMany({
      where,
      include: paymentRequestInclude,
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    prisma.paymentRequest.count({ where }),
    prisma.paymentRequest.count({
      where: { organizationId, status: "PENDING" },
    }),
    prisma.paymentRequest.count({
      where: { organizationId, status: "REJECTED" },
    }),
    prisma.paymentRequest.aggregate({
      where: { organizationId, status: "PAID" },
      _sum: { amount: true },
    }),
  ]);
  return {
    summary: {
      pendingApproval: pending,
      totalCompleted: amount(completed._sum.amount),
      declined,
    },
    requests: rows.map((row) => ({
      ...row,
      amount: amount(row.amount),
      bankDetails: {
        bankName: row.bankName,
        accountName: row.accountName,
        accountNumber: row.accountNumber
          ? `****${row.accountNumber.slice(-4)}`
          : null,
      },
      status:
        row.status === "PAID"
          ? "COMPLETED"
          : row.status === "REJECTED"
            ? "DECLINED"
            : row.status,
    })),
    pagination: pagination(query.page, query.limit, total),
  };
};
export const createPaymentRequest = async (
  organizationId: string,
  input: PaymentRequestCreateInput,
  user: AuthUser,
) => {
  let invoice: any = null,
    project: any = null,
    clientId = input.clientId;
  if (input.invoiceId) {
    invoice = await prisma.invoice.findFirst({
      where: { id: input.invoiceId, organizationId },
      select: {
        id: true,
        clientId: true,
        projectId: true,
        total: true,
        status: true,
      },
    });
    if (!invoice) throw notFound("Invoice not found");
    if (
      invoice.status === "PAID" ||
      new Prisma.Decimal(input.amount).gt(invoice.total)
    )
      throw conflict(
        "Payment request amount exceeds the payable invoice amount",
      );
    clientId = invoice.clientId;
  }
  if (input.projectId) {
    project = await prisma.accountingProject.findFirst({
      where: { id: input.projectId, organizationId },
      select: { id: true, clientId: true },
    });
    if (!project) throw notFound("Project not found");
    if (clientId && project.clientId !== clientId)
      throw conflict("Project, invoice and customer do not match");
    clientId = project.clientId;
  }
  if (clientId) await assertClientOwnership(organizationId, clientId);
  const requester = await prisma.user.findFirst({
    where: { id: user.id, organizationId },
    include: {
      employee: {
        select: {
          bankName: true,
          bankAccountNumber: true,
          bankAccountName: true,
        },
      },
    },
  });
  const row = await prisma.paymentRequest.create({
    data: {
      organizationId,
      title: input.title,
      description: input.description,
      amount: new Prisma.Decimal(input.amount),
      status: "PENDING",
      requestedBy: requester
        ? `${requester.firstName} ${requester.lastName}`
        : user.email,
      requesterUserId: user.id,
      invoiceId: invoice?.id,
      projectId: project?.id ?? invoice?.projectId,
      clientId,
      bankName: requester?.employee?.bankName,
      accountNumber: requester?.employee?.bankAccountNumber,
      accountName: requester?.employee?.bankAccountName,
    },
  });
  await audit(
    organizationId,
    user,
    "ACCOUNTING_PAYMENT_REQUEST_CREATED",
    "PAYMENT_REQUEST",
    row.id,
    `Created payment request ${row.title}`,
  );
  return paymentRequestOwned(organizationId, row.id);
};
export const getPaymentRequest = paymentRequestOwned;
export const approvePaymentRequest = async (
  organizationId: string,
  id: string,
  _input: PaymentRequestDecisionInput,
  user: AuthUser,
) => {
  const row = await paymentRequestOwned(organizationId, id);
  if (row.status !== "PENDING")
    throw conflict("Only pending payment requests can be approved");
  const updated = await prisma.paymentRequest.update({
    where: { id },
    data: { status: "APPROVED", approvedBy: user.id, approvedAt: new Date() },
  });
  await audit(
    organizationId,
    user,
    "ACCOUNTING_PAYMENT_REQUEST_APPROVED",
    "PAYMENT_REQUEST",
    id,
    `Approved payment request ${row.title}`,
  );
  return updated;
};
export const declinePaymentRequest = async (
  organizationId: string,
  id: string,
  input: PaymentRequestDecisionInput,
  user: AuthUser,
) => {
  const row = await paymentRequestOwned(organizationId, id);
  if (row.status !== "PENDING")
    throw conflict("Only pending payment requests can be declined");
  const updated = await prisma.paymentRequest.update({
    where: { id },
    data: {
      status: "REJECTED",
      declinedBy: user.id,
      declinedAt: new Date(),
      decisionReason: input.reason,
    },
  });
  await audit(
    organizationId,
    user,
    "ACCOUNTING_PAYMENT_REQUEST_DECLINED",
    "PAYMENT_REQUEST",
    id,
    `Declined payment request ${row.title}`,
    { reason: input.reason ?? null },
  );
  return updated;
};
export const disbursePaymentRequest = async (
  organizationId: string,
  id: string,
  input: PaymentRequestDisbursementInput,
  user: AuthUser,
) => {
  const current = await paymentRequestOwned(organizationId, id);
  if (
    current.status === "PAID" &&
    current.disbursementReference === input.idempotencyKey
  ) {
    const transaction = await prisma.walletTransaction.findFirst({
      where: {
        organizationId,
        sourceType: "ACCOUNTING_PAYMENT_REQUEST",
        sourceId: id,
        type: "ACCOUNTING_DISBURSEMENT",
      },
    });
    return { request: current, transaction };
  }
  if (current.status !== "APPROVED")
    throw conflict("Only approved payment requests can be disbursed");
  if (!current.bankName || !current.accountNumber || !current.accountName)
    throw conflict("Approved bank destination is incomplete");
  const transaction = await prisma.$transaction(async (tx) => {
    const wallet = await tx.walletAccount.findFirst({
      where: { id: input.walletAccountId, organizationId },
    });
    if (!wallet) throw notFound("Wallet not found");
    const debit = await tx.walletAccount.updateMany({
      where: {
        id: wallet.id,
        organizationId,
        balance: { gte: current.amount },
      },
      data: { balance: { decrement: current.amount } },
    });
    if (debit.count !== 1) throw conflict("Insufficient wallet balance");
    const ledger = await tx.walletTransaction.create({
      data: {
        organizationId,
        walletAccountId: wallet.id,
        type: "ACCOUNTING_DISBURSEMENT",
        direction: "DEBIT",
        amount: current.amount,
        balanceBefore: wallet.balance,
        balanceAfter: wallet.balance.sub(current.amount),
        reference: reference("TXN"),
        transferReference: input.idempotencyKey,
        description: `Payment request ${current.id} disbursement`,
        sourceType: "ACCOUNTING_PAYMENT_REQUEST",
        sourceId: current.id,
        createdById: user.id,
      },
    });
    await tx.paymentRequest.update({
      where: { id },
      data: {
        status: "PAID",
        disbursementReference: input.idempotencyKey,
        disbursedAt: new Date(),
      },
    });
    return ledger;
  });
  await audit(
    organizationId,
    user,
    "ACCOUNTING_PAYMENT_REQUEST_DISBURSED",
    "PAYMENT_REQUEST",
    id,
    `Disbursed payment request ${current.title}`,
    { transactionId: transaction.id },
  );
  return {
    request: await paymentRequestOwned(organizationId, id),
    transaction: {
      ...transaction,
      amount: amount(transaction.amount),
      balanceBefore: amount(transaction.balanceBefore),
      balanceAfter: amount(transaction.balanceAfter),
      accountNumber: `****${current.accountNumber.slice(-4)}`,
    },
  };
};

export const listExpenses = async (
  organizationId: string,
  query: ExpenseListQuery,
) => {
  const where: Prisma.AccountingExpenseWhereInput = {
    organizationId,
    ...(query.category ? { category: query.category } : {}),
    ...(query.fromDate || query.toDate
      ? {
          expenseDate: {
            ...(query.fromDate ? { gte: query.fromDate } : {}),
            ...(query.toDate ? { lte: query.toDate } : {}),
          },
        }
      : {}),
    ...(query.search
      ? {
          OR: [
            { description: { contains: query.search } },
            { reference: { contains: query.search } },
            { receiptReference: { contains: query.search } },
          ],
        }
      : {}),
  };
  const month = new Date();
  const monthStart = new Date(
    Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), 1),
  );
  const [rows, total, totalAmount, thisMonth, categories] = await Promise.all([
    prisma.accountingExpense.findMany({
      where,
      include: {
        loggedBy: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { [query.sortBy]: query.sortOrder },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    prisma.accountingExpense.count({ where }),
    prisma.accountingExpense.aggregate({
      where: { organizationId, status: "ACTIVE" },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    prisma.accountingExpense.aggregate({
      where: {
        organizationId,
        status: "ACTIVE",
        expenseDate: { gte: monthStart },
      },
      _sum: { amount: true },
    }),
    prisma.accountingExpense.groupBy({
      by: ["category"],
      where: { organizationId, status: "ACTIVE" },
      _sum: { amount: true },
    }),
  ]);
  const top = categories.sort(
    (a, b) => Number(b._sum.amount ?? 0) - Number(a._sum.amount ?? 0),
  )[0];
  return {
    summary: {
      totalExpenses: amount(totalAmount._sum.amount),
      thisMonth: amount(thisMonth._sum.amount),
      totalEntries: totalAmount._count._all,
      topCategory: top
        ? { category: top.category, amount: amount(top._sum.amount) }
        : null,
    },
    expenses: rows.map((row) => ({ ...row, amount: amount(row.amount) })),
    pagination: pagination(query.page, query.limit, total),
  };
};
const expenseOwned = async (organizationId: string, id: string) => {
  const row = await prisma.accountingExpense.findFirst({
    where: { id, organizationId },
    include: {
      loggedBy: { select: { id: true, firstName: true, lastName: true } },
    },
  });
  if (!row) throw notFound("Expense not found");
  return row;
};
export const createExpense = async (
  organizationId: string,
  input: ExpenseInput,
  user: AuthUser,
) => {
  const expenseCategory = input.categoryId
    ? await prisma.accountingExpenseCategory.findFirst({ where: { id: input.categoryId, organizationId } })
    : null;
  if (input.categoryId && !expenseCategory) throw notFound("Expense category not found");
  const row = await prisma.accountingExpense.create({
    data: {
      organizationId,
      reference: reference("EXP"),
      expenseDate: input.expenseDate,
      category: expenseCategory?.name ?? input.category!,
      categoryId: expenseCategory?.id,
      description: input.description,
      amount: new Prisma.Decimal(input.amount),
      receiptReference: input.receiptReference,
      loggedByUserId: user.id,
    },
  });
  await audit(
    organizationId,
    user,
    "ACCOUNTING_EXPENSE_CREATED",
    "ACCOUNTING_EXPENSE",
    row.id,
    `Logged expense ${row.reference}`,
  );
  return row;
};
export const updateExpense = async (
  organizationId: string,
  id: string,
  input: Partial<ExpenseInput>,
  user: AuthUser,
) => {
  const current = await expenseOwned(organizationId, id);
  if (current.status !== "ACTIVE")
    throw conflict("Voided expenses cannot be edited");
  const expenseCategory = input.categoryId ? await prisma.accountingExpenseCategory.findFirst({ where: { id: input.categoryId, organizationId } }) : null;
  if (input.categoryId && !expenseCategory) throw notFound("Expense category not found");
  const row = await prisma.accountingExpense.update({
    where: { id },
    data: {
      ...input,
      ...(expenseCategory ? { category: expenseCategory.name, categoryId: expenseCategory.id } : {}),
      ...(input.amount !== undefined
        ? { amount: new Prisma.Decimal(input.amount) }
        : {}),
    },
  });
  await audit(
    organizationId,
    user,
    "ACCOUNTING_EXPENSE_UPDATED",
    "ACCOUNTING_EXPENSE",
    id,
    `Updated expense ${current.reference}`,
  );
  return row;
};
export const voidExpense = async (
  organizationId: string,
  id: string,
  user: AuthUser,
) => {
  const current = await expenseOwned(organizationId, id);
  if (current.status === "VOID") return current;
  const row = await prisma.accountingExpense.update({
    where: { id },
    data: { status: "VOID", voidedAt: new Date(), voidedByUserId: user.id },
  });
  await audit(
    organizationId,
    user,
    "ACCOUNTING_EXPENSE_VOIDED",
    "ACCOUNTING_EXPENSE",
    id,
    `Voided expense ${current.reference}`,
  );
  return row;
};
export const exportExpenses = async (
  organizationId: string,
  query: ExpenseListQuery,
  user: AuthUser,
) => {
  const expenses: any[] = [];
  for (let pageNumber = 1; ; pageNumber += 1) {
    const pageResult = await listExpenses(organizationId, { ...query, page: pageNumber, limit: 100 });
    expenses.push(...pageResult.expenses);
    if (pageNumber >= pageResult.pagination.totalPages) break;
  }
  const csv = `\uFEFF${[["ID", "Date", "Category", "Description", "Amount", "Receipt Reference", "Logged By", "Status"], ...expenses.map((row: any) => [row.reference, row.expenseDate.toISOString(), row.category, row.description, row.amount, row.receiptReference, `${row.loggedBy.firstName} ${row.loggedBy.lastName}`, row.status])].map((line) => line.map(csvCell).join(",")).join("\r\n")}\r\n`;
  await audit(
    organizationId,
    user,
    "ACCOUNTING_EXPENSES_EXPORTED",
    "ACCOUNTING_EXPENSE",
    "export",
    "Exported filtered expenses",
  );
  return csv;
};

const reminderMetadata = (value: Prisma.JsonValue | null) =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const reminderConfiguration = async (organizationId: string) =>
  prisma.accountingReminderConfiguration
    .findUnique({ where: { organizationId } })
    .then(
      (row) =>
        row ?? {
          upcomingDays: [7, 3, 1, 0],
          overdueIntervals: [1, 3, 7, 14, 30],
          inAppEnabled: true,
          emailEnabled: true,
          automaticRemindersEnabled: true,
          firstReminderDaysBeforeDue: 7,
          overdueReminderFrequency: "EVERY_7_DAYS",
        },
    );
const generateInvoiceReminders = async (
  organizationId: string,
  user: AuthUser,
) => {
  const [invoices, config] = await Promise.all([
    prisma.invoice.findMany({
      where: {
        organizationId,
        status: { in: ["SENT", "PARTIALLY_PAID", "OVERDUE"] },
        dueDate: { not: null },
      },
      include: {
        client: { select: { name: true } },
        payments: { select: { amount: true } },
      },
    }),
    reminderConfiguration(organizationId),
  ]);
  const upcomingDays = new Set((config.upcomingDays as number[]).map(Number));
  const overdueIntervals = new Set(
    (config.overdueIntervals as number[]).map(Number),
  );
  const today = new Date();
  if (!config.automaticRemindersEnabled) return;
  today.setUTCHours(0, 0, 0, 0);
  await Promise.all(
    invoices.flatMap((invoice) => {
      const due = new Date(invoice.dueDate!);
      due.setUTCHours(0, 0, 0, 0);
      const signedDays = Math.round(
        (due.getTime() - today.getTime()) / 86400000,
      );
      const overdue = signedDays < 0;
      const days = Math.abs(signedDays);
      if (overdue ? !overdueIntervals.has(days) : !upcomingDays.has(days))
        return [];
      const paid = invoice.payments.reduce(
        (sum, payment) => sum.add(payment.amount),
        zero(),
      );
      const balance = Prisma.Decimal.max(zero(), invoiceReceivable(invoice).sub(paid));
      if (balance.lte(0)) return [];
      return [
        deliverUserNotification({
          organizationId,
          recipientUserId: user.id,
          moduleKey: "accounting",
          categoryKey: "reminders",
          eventKey: `invoice-reminder:${invoice.id}:${overdue ? "overdue" : "upcoming"}:${days}`,
          type: overdue ? "INVOICE_OVERDUE" : "INVOICE_UPCOMING",
          title: overdue ? "Invoice overdue" : "Invoice payment upcoming",
          message: `${invoice.invoiceNo} for ${invoice.client.name} is ${overdue ? `${days} day(s) overdue` : `due in ${days} day(s)`}.`,
          metadata: {
            invoiceId: invoice.id,
            invoiceReference: invoice.invoiceNo,
            customer: invoice.client.name,
            amount: amount(balance),
            dueDate: invoice.dueDate!.toISOString(),
            reminderType: overdue ? "OVERDUE" : "UPCOMING",
            intervalDays: days,
          },
          channelOverrides: {
            inApp: config.inAppEnabled,
            email: config.emailEnabled,
          },
        }),
      ];
    }),
  );
};
export const getReminderConfiguration = async (organizationId: string) =>
  reminderConfiguration(organizationId);
export const updateReminderConfiguration = async (
  organizationId: string,
  input: ReminderConfigurationInput,
  user: AuthUser,
) => {
  const row = await prisma.accountingReminderConfiguration.upsert({
    where: { organizationId },
    create: { organizationId, ...input, updatedByUserId: user.id },
    update: { ...input, updatedByUserId: user.id },
  });
  await audit(
    organizationId,
    user,
    "ACCOUNTING_REMINDER_CONFIGURATION_UPDATED",
    "ACCOUNTING_REMINDER_CONFIGURATION",
    row.id,
    "Updated Accounting reminder schedule and channels",
  );
  return row;
};
export const listReminders = async (
  organizationId: string,
  query: ReminderListQuery,
  user: AuthUser,
) => {
  await generateInvoiceReminders(organizationId, user);
  const where: Prisma.UserNotificationWhereInput = {
    organizationId,
    recipientUserId: user.id,
    category: { moduleKey: "accounting", key: "reminders" },
    ...(query.filter === "UNREAD"
      ? { readAt: null }
      : query.filter === "UPCOMING"
        ? { type: "INVOICE_UPCOMING" }
        : query.filter === "OVERDUE"
          ? { type: "INVOICE_OVERDUE" }
          : {}),
  };
  const [rows, total, unread, overdue, upcoming] = await Promise.all([
    prisma.userNotification.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    prisma.userNotification.count({ where }),
    prisma.userNotification.count({
      where: {
        organizationId,
        recipientUserId: user.id,
        category: { moduleKey: "accounting", key: "reminders" },
        readAt: null,
      },
    }),
    prisma.userNotification.count({
      where: {
        organizationId,
        recipientUserId: user.id,
        type: "INVOICE_OVERDUE",
      },
    }),
    prisma.userNotification.count({
      where: {
        organizationId,
        recipientUserId: user.id,
        type: "INVOICE_UPCOMING",
      },
    }),
  ]);
  return {
    summary: { unread, overdue, upcoming },
    reminders: rows.map((row) => ({
      ...row,
      metadata: reminderMetadata(row.metadata),
      reminderType: row.type === "INVOICE_OVERDUE" ? "OVERDUE" : "UPCOMING",
      unread: row.readAt === null,
      channel:
        row.inAppStatus === "DELIVERED" && row.emailStatus === "SENT"
          ? "IN_APP_EMAIL"
          : row.emailStatus === "SENT"
            ? "EMAIL"
            : "IN_APP",
    })),
    pagination: pagination(query.page, query.limit, total),
  };
};
export const markReminderRead = async (
  organizationId: string,
  id: string,
  user: AuthUser,
) => {
  const row = await prisma.userNotification.findFirst({
    where: {
      id,
      organizationId,
      recipientUserId: user.id,
      category: { moduleKey: "accounting", key: "reminders" },
    },
  });
  if (!row) throw notFound("Reminder not found");
  if (row.readAt) return row;
  return prisma.userNotification.update({
    where: { id },
    data: { readAt: new Date() },
  });
};
export const markAllRemindersRead = async (
  organizationId: string,
  user: AuthUser,
) => {
  const result = await prisma.userNotification.updateMany({
    where: {
      organizationId,
      recipientUserId: user.id,
      category: { moduleKey: "accounting", key: "reminders" },
      readAt: null,
    },
    data: { readAt: new Date() },
  });
  return { markedRead: result.count };
};

const ACCOUNTING_EXPORT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const requestAccountingExport = async (organizationId: string, type: "INVOICES" | "EXPENSES", filters: unknown, user: AuthUser) => {
  const normalized = type === "INVOICES" ? invoiceListQuerySchema.parse(filters) : expenseListQuerySchema.parse(filters);
  const duplicate = await prisma.accountingExportJob.findFirst({ where: { organizationId, requestedByUserId: user.id, type, status: { in: ["PENDING", "PROCESSING"] } } });
  if (duplicate) throw conflict(`A ${type.toLowerCase()} export is already being processed`);
  const job = await prisma.accountingExportJob.create({ data: { organizationId, requestedByUserId: user.id, type, filters: JSON.parse(JSON.stringify(normalized)) } });
  await audit(organizationId, user, "ACCOUNTING_EXPORT_REQUESTED", "ACCOUNTING_EXPORT", job.id, `Requested ${type.toLowerCase()} CSV export`);
  return { id: job.id, type: job.type, status: job.status, requestedAt: job.requestedAt };
};
export const getAccountingExportStatus = async (organizationId: string, id: string) => { const job = await prisma.accountingExportJob.findFirst({ where: { id, organizationId }, select: { id: true, type: true, status: true, fileName: true, fileSize: true, requestedAt: true, processingAt: true, completedAt: true, failedAt: true, expiresAt: true, errorMessage: true } }); if (!job) throw notFound("Accounting export not found"); return { ...job, downloadPath: job.status === "COMPLETED" && job.expiresAt && job.expiresAt > new Date() ? `/api/v1/accounting/exports/${job.id}/download` : null }; };
export const downloadAccountingExport = async (organizationId: string, id: string) => { const job = await prisma.accountingExportJob.findFirst({ where: { id, organizationId, status: "COMPLETED", expiresAt: { gt: new Date() } } }); if (!job?.fileReference || !job.fileName) throw notFound("Completed Accounting export not found or has expired"); return { buffer: await readObject(job.fileReference), fileName: job.fileName }; };
export const fulfillAccountingExport = async (id: string, publicBaseUrl?: string) => { const claimed = await prisma.accountingExportJob.updateMany({ where: { id, status: "PENDING" }, data: { status: "PROCESSING", processingAt: new Date(), errorMessage: null } }); if (!claimed.count) return prisma.accountingExportJob.findUnique({ where: { id } }); const job = await prisma.accountingExportJob.findUniqueOrThrow({ where: { id }, include: { requestedBy: { select: { id: true, organizationId: true, email: true, roleId: true, isPlatformAdmin: true } } } }); let stored: Awaited<ReturnType<typeof uploadObject>> | undefined; try { const user: AuthUser = { ...job.requestedBy, permissions: [] }; const filters = job.filters as Record<string, unknown>; const csv = job.type === "INVOICES" ? await exportInvoices(job.organizationId, invoiceListQuerySchema.parse(filters), user) : await exportExpenses(job.organizationId, expenseListQuerySchema.parse(filters), user); const fileName = `accounting-${job.type.toLowerCase()}-${job.id}.csv`; stored = await uploadObject({ key: createObjectKey(`accounting-exports/${job.organizationId}`, fileName), body: Buffer.from(csv, "utf8"), contentType: "text/csv; charset=utf-8", publicBaseUrl }); const completedAt = new Date(); const expiresAt = new Date(completedAt.getTime() + ACCOUNTING_EXPORT_TTL_MS); const completed = await prisma.accountingExportJob.update({ where: { id }, data: { status: "COMPLETED", fileName, fileReference: stored.key, fileSize: stored.size, completedAt, expiresAt } }); await deliverUserNotification({ organizationId: job.organizationId, recipientUserId: job.requestedByUserId, moduleKey: "accounting", categoryKey: "record-updates", eventKey: `accounting-export:${job.id}:ready`, type: "ACCOUNTING_EXPORT_READY", title: "Accounting export ready", message: `Your ${job.type.toLowerCase()} export is ready and expires in seven days.`, metadata: { exportId: job.id, type: job.type, expiresAt: expiresAt.toISOString() } }); return completed; } catch (error) { if (stored) await deleteObject(stored.key).catch(() => undefined); await prisma.accountingExportJob.update({ where: { id }, data: { status: "FAILED", failedAt: new Date(), errorMessage: error instanceof Error ? error.message.slice(0, 2000) : "Export failed" } }); throw error; } };
export const processPendingAccountingExports = async (publicBaseUrl?: string) => { const jobs = await prisma.accountingExportJob.findMany({ where: { status: "PENDING" }, orderBy: { requestedAt: "asc" }, take: 10, select: { id: true } }); const results = []; for (const job of jobs) { try { results.push({ id: job.id, status: (await fulfillAccountingExport(job.id, publicBaseUrl))?.status }); } catch { results.push({ id: job.id, status: "FAILED" }); } } return results; };
export const expireAccountingExports = async (now = new Date()) => { const jobs = await prisma.accountingExportJob.findMany({ where: { status: "COMPLETED", expiresAt: { lte: now } }, select: { id: true, fileReference: true } }); for (const job of jobs) { await deleteObject(job.fileReference).catch(() => undefined); await prisma.accountingExportJob.update({ where: { id: job.id }, data: { status: "EXPIRED", fileReference: null } }); } return { expired: jobs.length }; };

const reportInvoiceWhere = (organizationId: string, query: AccountingReportQuery): Prisma.InvoiceWhereInput => ({
  organizationId,
  ...(query.clientId ? { clientId: query.clientId } : {}),
  ...(query.agentId ? { assignedAgentId: query.agentId } : {}),
  ...(query.projectId ? { projectId: query.projectId } : {}),
  ...(query.itemServiceId ? { items: { some: { catalogueItemId: query.itemServiceId } } } : {}),
  ...(query.status && query.status !== "ALL" ? query.status === "OVERDUE"
    ? { status: { in: ["SENT", "PARTIALLY_PAID", "OVERDUE"] }, dueDate: { lt: new Date() } }
    : { status: query.status } : {}),
  ...(query.fromDate || query.toDate ? { issueDate: {
    ...(query.fromDate ? { gte: query.fromDate } : {}), ...(query.toDate ? { lte: query.toDate } : {}),
  } } : {}),
  ...(query.search ? { OR: [{ invoiceNo: { contains: query.search } }, { client: { name: { contains: query.search } } }] } : {}),
});

const reportRows = (organizationId: string, query: AccountingReportQuery) => prisma.invoice.findMany({
  where: reportInvoiceWhere(organizationId, query), orderBy: { [query.sortBy]: query.sortOrder }, include: invoiceInclude,
});
const reportFinancialRows = async (organizationId: string, query: AccountingReportQuery) => {
  const invoices = await prisma.invoice.findMany({
    where: reportInvoiceWhere(organizationId, query),
    select: { id: true, clientId: true, assignedAgentId: true, projectId: true, status: true, dueDate: true, total: true, taxAmount: true, whtAmount: true, amountPayable: true },
  });
  const payments = invoices.length ? await prisma.accountingInvoicePayment.groupBy({
    by: ["invoiceId"], where: { organizationId, invoiceId: { in: invoices.map(row => row.id) } }, _sum: { amount: true },
  }) : [];
  const paidByInvoice = new Map(payments.map(row => [row.invoiceId, row._sum.amount ?? zero()]));
  return invoices.map(row => ({ ...row, payments: [{ amount: paidByInvoice.get(row.id) ?? zero() }] }));
};
const reportSqlWhere = (organizationId: string, query: AccountingReportQuery) => {
  const clauses: Prisma.Sql[] = [Prisma.sql`i.organizationId = ${organizationId}`];
  if (query.clientId) clauses.push(Prisma.sql`i.clientId = ${query.clientId}`);
  if (query.agentId) clauses.push(Prisma.sql`i.assignedAgentId = ${query.agentId}`);
  if (query.projectId) clauses.push(Prisma.sql`i.projectId = ${query.projectId}`);
  if (query.itemServiceId) clauses.push(Prisma.sql`EXISTS (SELECT 1 FROM InvoiceItem ii WHERE ii.invoiceId = i.id AND ii.catalogueItemId = ${query.itemServiceId})`);
  if (query.fromDate) clauses.push(Prisma.sql`i.issueDate >= ${query.fromDate}`);
  if (query.toDate) clauses.push(Prisma.sql`i.issueDate <= ${query.toDate}`);
  if (query.search) { const search = `%${query.search}%`; clauses.push(Prisma.sql`(i.invoiceNo LIKE ${search} OR c.name LIKE ${search})`); }
  if (query.status && query.status !== "ALL") clauses.push(query.status === "OVERDUE"
    ? Prisma.sql`i.status IN ('SENT','PARTIALLY_PAID','OVERDUE') AND i.dueDate < CURRENT_TIMESTAMP(3)`
    : Prisma.sql`i.status = ${query.status}`);
  return Prisma.sql`${Prisma.join(clauses, " AND ")}`;
};
const databaseReportSummary = async (organizationId: string, query: AccountingReportQuery) => {
  const rows = await prisma.$queryRaw<Array<{ totalRevenue: Prisma.Decimal; outstanding: Prisma.Decimal; overdue: Prisma.Decimal; vatCollected: Prisma.Decimal }>>(Prisma.sql`
    SELECT
      COALESCE(SUM(COALESCE(p.paidAmount, 0)), 0) AS totalRevenue,
      COALESCE(SUM(CASE WHEN i.status NOT IN ('DRAFT','VOID') AND GREATEST(i.amountPayable - COALESCE(p.paidAmount,0),0) > 0 AND (i.dueDate IS NULL OR i.dueDate >= CURRENT_TIMESTAMP(3)) THEN GREATEST(i.amountPayable - COALESCE(p.paidAmount,0),0) ELSE 0 END),0) AS outstanding,
      COALESCE(SUM(CASE WHEN i.status NOT IN ('DRAFT','VOID') AND GREATEST(i.amountPayable - COALESCE(p.paidAmount,0),0) > 0 AND i.dueDate < CURRENT_TIMESTAMP(3) THEN GREATEST(i.amountPayable - COALESCE(p.paidAmount,0),0) ELSE 0 END),0) AS overdue,
      COALESCE(SUM(CASE WHEN i.amountPayable > 0 THEN i.taxAmount * LEAST(COALESCE(p.paidAmount,0),i.amountPayable) / i.amountPayable ELSE 0 END),0) AS vatCollected
    FROM Invoice i
    JOIN Client c ON c.id = i.clientId AND c.organizationId = i.organizationId
    LEFT JOIN (SELECT invoiceId, SUM(amount) AS paidAmount FROM AccountingInvoicePayment WHERE organizationId = ${organizationId} GROUP BY invoiceId) p ON p.invoiceId = i.id
    WHERE ${reportSqlWhere(organizationId,query)}
  `);
  const hasUnattributableInvoiceFilter = Boolean(query.clientId || query.agentId || query.projectId || query.itemServiceId || (query.status && query.status !== "ALL"));
  const expense = hasUnattributableInvoiceFilter ? null : await prisma.accountingExpense.aggregate({ where: { organizationId, status: "ACTIVE", ...(query.fromDate || query.toDate ? { expenseDate: { ...(query.fromDate ? { gte: query.fromDate } : {}), ...(query.toDate ? { lte: query.toDate } : {}) } } : {}) }, _sum: { amount: true } });
  const financial = rows[0] ?? { totalRevenue: zero(), outstanding: zero(), overdue: zero(), vatCollected: zero() };
  const expenses = expense?._sum.amount ?? zero();
  return { totalRevenue: amount(financial.totalRevenue), outstanding: amount(financial.outstanding), overdue: amount(financial.overdue), vatCollected: amount(new Prisma.Decimal(financial.vatCollected).toDecimalPlaces(2)), totalExpenses: amount(expenses), netProfit: amount(new Prisma.Decimal(financial.totalRevenue).sub(expenses)) };
};
export const getAccountingReport = async (organizationId: string, query: AccountingReportQuery) => {
  const where = reportInvoiceWhere(organizationId, query);
  const [summary, pageRows, total] = await Promise.all([
    databaseReportSummary(organizationId, query),
    prisma.invoice.findMany({ where, orderBy: { [query.sortBy]: query.sortOrder }, skip: (query.page - 1) * query.limit, take: query.limit, include: invoiceInclude }),
    prisma.invoice.count({ where }),
  ]);
  const financialRows = query.groupBy ? await reportFinancialRows(organizationId,query) : [];
  const groupIds = query.groupBy ? [...new Set(financialRows.map(row => query.groupBy === "CLIENT" ? row.clientId : query.groupBy === "AGENT" ? row.assignedAgentId : row.projectId).filter(Boolean) as string[])] : [];
  const namedGroups = !query.groupBy ? [] : query.groupBy === "CLIENT"
    ? await prisma.client.findMany({ where: { organizationId, id: { in: groupIds } }, select: { id: true, name: true } })
    : query.groupBy === "AGENT"
      ? (await prisma.user.findMany({ where: { organizationId, id: { in: groupIds } }, select: { id: true, firstName: true, lastName: true } })).map(row => ({ id: row.id, name: `${row.firstName} ${row.lastName}`.trim() }))
      : await prisma.accountingProject.findMany({ where: { organizationId, id: { in: groupIds } }, select: { id: true, name: true } });
  const groupNames = new Map(namedGroups.map(row => [row.id,row.name]));
  const groups = query.groupBy ? Array.from(financialRows.reduce((map: Map<string, any>, row: any) => {
    const id = (query.groupBy === "CLIENT" ? row.clientId : query.groupBy === "AGENT" ? row.assignedAgentId : row.projectId) ?? "UNASSIGNED";
    const name = groupNames.get(id) ?? "Unassigned";
    const current = map.get(id) ?? { id, name, invoiceCount: 0, invoiceValue: zero(), revenuePaid: zero(), outstanding: zero(), vatCharged: zero() };
    const paid = row.payments.reduce((s: Prisma.Decimal, p: any) => s.add(p.amount), zero()); current.invoiceCount++; current.invoiceValue = current.invoiceValue.add(row.total); current.revenuePaid = current.revenuePaid.add(paid); current.outstanding = current.outstanding.add(Prisma.Decimal.max(zero(), invoiceReceivable(row).sub(paid))); current.vatCharged = current.vatCharged.add(row.taxAmount); map.set(id, current); return map;
  }, new Map()).values()).map((g: any) => ({ ...g, invoiceValue: amount(g.invoiceValue), revenuePaid: amount(g.revenuePaid), outstanding: amount(g.outstanding), vatCharged: amount(g.vatCharged) })) : undefined;
  return { appliedFilters: query, summary, invoices: pageRows.map(r => invoiceView(r)), ...(groups ? { groups } : {}), pagination: pagination(query.page, query.limit, total) };
};
export const getVatReport = async (organizationId: string, query: AccountingReportQuery) => {
  const where = { ...reportInvoiceWhere(organizationId, query), taxAmount: { gt: zero() } };
  const [aggregate, grouped, rows, total] = await Promise.all([
    prisma.invoice.aggregate({ where, _sum: { taxAmount: true } }),
    prisma.invoice.groupBy({ by: ["clientId"], where, _count: { _all: true }, _sum: { total: true, taxAmount: true } }),
    prisma.invoice.findMany({ where, orderBy: { [query.sortBy]: query.sortOrder }, skip: (query.page - 1) * query.limit, take: query.limit, include: { client: { select: { id: true, name: true, taxId: true } } } }),
    prisma.invoice.count({ where }),
  ]);
  const clients = await prisma.client.findMany({ where: { organizationId, id: { in: grouped.map(row => row.clientId) } }, select: { id: true, name: true, taxId: true } });
  const clientById = new Map(clients.map(client => [client.id, client]));
  const byCompany = grouped.map(row => ({ clientId: row.clientId, companyName: clientById.get(row.clientId)?.name ?? null, taxId: clientById.get(row.clientId)?.taxId ?? null, invoices: row._count._all, totalInvoiceValue: amount(row._sum.total), vatAmount: amount(row._sum.taxAmount) }));
  const config = await getPlatformConfigurationValue();
  return { summary: { totalVat: amount(aggregate._sum.taxAmount), vatPayers: byCompany.length, configuredRate: config.vatRate }, byCompany, invoices: rows.map(r => ({ id: r.id, invoiceReference: r.invoiceNo, client: r.client, issueDate: r.issueDate, subtotal: amount(r.subtotal), vat: amount(r.taxAmount), total: amount(r.total) })), pagination: pagination(query.page,query.limit,total) };
};
export const getWhtReport = async (organizationId: string, query: AccountingReportQuery) => {
  const where: Prisma.InvoiceWhereInput = { ...reportInvoiceWhere(organizationId, query), whtApplicable: true, whtAmount: { gt: zero() } };
  const [configured, deducted, grouped, rows, total] = await Promise.all([
    prisma.invoice.aggregate({ where, _sum: { whtAmount: true }, _count: { _all: true } }),
    prisma.invoice.aggregate({ where: { ...where, status: "PAID" }, _sum: { whtAmount: true } }),
    prisma.invoice.groupBy({ by: ["whtRate"], where, _count: { _all: true }, _sum: { whtAmount: true } }),
    prisma.invoice.findMany({ where, orderBy: { [query.sortBy]: query.sortOrder }, skip: (query.page - 1) * query.limit, take: query.limit, include: { client: { select: { id: true, name: true, taxId: true } } } }),
    prisma.invoice.count({ where }),
  ]);
  return {
    summary: {
      totalWhtConfigured: amount(configured._sum.whtAmount),
      totalWhtDeducted: amount(deducted._sum.whtAmount),
      whtInvoices: configured._count._all,
      rates: grouped.map(group => ({ rate: group.whtRate ? amount(group.whtRate.mul(100)) : null, invoiceCount: group._count._all, amount: amount(group._sum.whtAmount) })),
    },
    invoices: rows.map(row => ({ id: row.id, invoiceReference: row.invoiceNo, client: row.client, issueDate: row.issueDate, subtotal: amount(row.subtotal), vat: amount(row.taxAmount), total: amount(row.total), whtRate: row.whtRate ? amount(row.whtRate.mul(100)) : null, whtAmount: amount(row.whtAmount), amountPayable: amount(invoiceReceivable(row)), status: accountingInvoiceDisplayStatus(row.status,row.dueDate) })),
    pagination: pagination(query.page,query.limit,total),
  };
};
export const exportAccountingReportCsv = async (organizationId: string, query: AccountingReportQuery) => {
  const rows = await reportRows(organizationId, query);
  const summary = await databaseReportSummary(organizationId, query);
  const table = [
    ["Invoice", "Client", "Agent", "Project", "Subtotal", "VAT", "Total", "WHT Rate", "WHT Amount", "Amount Payable", "Paid", "Outstanding", "Status", "Issue Date", "Due Date"],
    ...rows.map((row: any) => { const view = invoiceView(row); return [view.invoiceNo, view.client.name, view.assignedAgent ? `${view.assignedAgent.firstName} ${view.assignedAgent.lastName}` : "", view.project?.name ?? "", view.subtotal, view.vat, view.total, view.whtRate ?? "", view.whtAmount, view.amountPayable, view.paidAmount, view.balanceDue, view.status, view.issueDate.toISOString(), view.dueDate?.toISOString() ?? ""]; }),
    [], ["Total Revenue", summary.totalRevenue], ["Outstanding", summary.outstanding], ["Overdue", summary.overdue], ["VAT Collected", summary.vatCollected], ["Expenses", summary.totalExpenses], ["Net Profit", summary.netProfit],
  ];
  return `\uFEFF${table.map(line => line.map(csvCell).join(",")).join("\r\n")}\r\n`;
};
export const exportAccountingReportPdf = async (organizationId: string, query: AccountingReportQuery) => {
  const rows = await reportRows(organizationId, query);
  const summary = await databaseReportSummary(organizationId, query);
  return createPayslipPdf(["SINKRONIS ACCOUNTING REPORT", `Total revenue: ${summary.totalRevenue}`, `Outstanding: ${summary.outstanding}`, `Overdue: ${summary.overdue}`, `VAT collected: ${summary.vatCollected}`, `Expenses: ${summary.totalExpenses}`, `Net profit: ${summary.netProfit}`, "INVOICES", ...rows.map((row: any) => `${row.invoiceNo} | ${row.client.name} | Total ${amount(row.total)} | WHT ${amount(row.whtAmount)} | Payable ${amount(invoiceReceivable(row))} | ${accountingInvoiceDisplayStatus(row.status,row.dueDate)}`)]);
};
export const downloadAccountingInvoicePdf = async (organizationId: string, id: string, user: AuthUser) => {
  const invoice = await getInvoiceById(organizationId,id) as any;
  const organization = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { name: true, email: true, taxId: true, currency: true } });
  const template = invoice.templateSnapshot && typeof invoice.templateSnapshot === "object" ? invoice.templateSnapshot as Record<string,unknown> : {};
  const buffer = createPayslipPdf([organization.name, String(template.headerNote ?? "INVOICE"), `Invoice: ${invoice.invoiceNo}`, `Customer: ${invoice.client.name}`, `Issue date: ${invoice.issueDate.toISOString().slice(0,10)}`, `Due date: ${invoice.dueDate?.toISOString().slice(0,10) ?? ""}`, ...invoice.items.map((item: any) => `${item.description} x ${item.quantity} @ ${item.unitPrice} = ${item.total}`), `Subtotal: ${invoice.subtotal} ${organization.currency}`, `VAT: ${invoice.vat} ${organization.currency}`, `Invoice total: ${invoice.total} ${organization.currency}`, ...(invoice.whtApplicable ? [`WHT (${invoice.whtRate}% of subtotal): -${invoice.whtAmount} ${organization.currency}`] : []), `Amount payable: ${invoice.amountPayable} ${organization.currency}`, `Paid: ${invoice.paidAmount} ${organization.currency}`, `Balance: ${invoice.balanceDue} ${organization.currency}`, String(template.paymentTerms ?? ""), String(template.footerNote ?? "")].filter(Boolean));
  await audit(organizationId,user,"ACCOUNTING_INVOICE_DOWNLOADED","INVOICE",id,`Downloaded invoice ${invoice.invoiceNo}`);
  return { buffer, filename: `${invoice.invoiceNo}.pdf` };
};

export const getWalletSummary = async (organizationId: string) => {
  const [wallets, totals, count] = await Promise.all([prisma.walletAccount.findMany({ where: { organizationId }, select: { id: true, name: true, currency: true, balance: true } }), prisma.walletTransaction.groupBy({ by: ["direction"], where: { organizationId }, _sum: { amount: true } }), prisma.walletTransaction.count({ where: { organizationId } })]);
  const directionalTotal = (directions: string[]) => totals.filter(t => directions.includes(t.direction)).reduce((sum,t) => sum.add(t._sum.amount ?? zero()),zero());
  return { availableBalance: wallets.reduce((s, w) => s + amount(w.balance), 0), totalInflow: amount(directionalTotal(["CREDIT","INFLOW"])), totalOutflow: amount(directionalTotal(["DEBIT","OUTFLOW"])), transactionCount: count, wallets: wallets.map(w => ({ ...w, balance: amount(w.balance) })) };
};
export const listWalletTransactions = async (organizationId: string, query: WalletTransactionQuery) => { const where = { organizationId, ...(query.direction === "ALL" ? {} : { direction: query.direction === "INFLOW" ? { in: ["CREDIT", "INFLOW"] } : { in: ["DEBIT", "OUTFLOW"] } }) }; const [rows,total] = await Promise.all([prisma.walletTransaction.findMany({ where, orderBy: { createdAt: "desc" }, skip: (query.page-1)*query.limit, take: query.limit }), prisma.walletTransaction.count({ where })]); return { transactions: rows.map(r => ({ ...r, amount: amount(r.amount), balanceBefore: amount(r.balanceBefore), balanceAfter: amount(r.balanceAfter) })), pagination: pagination(query.page,query.limit,total) }; };
export const fundWalletManually = async (organizationId: string, input: ManualWalletFundingInput, user: AuthUser) => {
  const existing = await prisma.walletTransaction.findFirst({ where: { organizationId, transferReference: input.externalReference } });
  if (existing) {
    if (existing.walletAccountId !== input.walletAccountId || !existing.amount.equals(new Prisma.Decimal(input.amount)) || existing.type !== "MANUAL_FUNDING") throw conflict("External funding reference is already in use");
    return { ...existing, amount: amount(existing.amount), idempotentReplay: true };
  }
  const value = new Prisma.Decimal(input.amount); const tx = await prisma.$transaction(async db => { const wallet = await db.walletAccount.findFirst({ where: { id: input.walletAccountId, organizationId } }); if (!wallet) throw notFound("Wallet not found"); const updated = await db.walletAccount.update({ where: { id: wallet.id }, data: { balance: { increment: value } } }); return db.walletTransaction.create({ data: { organizationId, walletAccountId: wallet.id, type: "MANUAL_FUNDING", direction: "CREDIT", amount: value, balanceBefore: wallet.balance, balanceAfter: updated.balance, reference: reference("WLT"), transferReference: input.externalReference, description: input.description, sourceType: "MANUAL_FUNDING", sourceId: input.externalReference, createdById: user.id } }); });
  await audit(organizationId,user,"ACCOUNTING_WALLET_FUNDED","WALLET_TRANSACTION",tx.id,"Manually funded Accounting wallet",{ amount: input.amount, reference: tx.reference }); return { ...tx, amount: amount(tx.amount), balanceBefore: amount(tx.balanceBefore), balanceAfter: amount(tx.balanceAfter) };
};
export const getWalletReceipt = async (organizationId: string, id: string) => { const row = await prisma.walletTransaction.findFirst({ where: { id, organizationId }, include: { wallet: { select: { name: true, currency: true } } } }); if (!row) throw notFound("Wallet transaction not found"); return { ...row, amount: amount(row.amount), balanceBefore: amount(row.balanceBefore), balanceAfter: amount(row.balanceAfter) }; };

type PaystackResponse<T> = { status: boolean; message: string; data?: T };
type PaystackInitializeData = { authorization_url: string; access_code: string; reference: string };
type PaystackVerifyData = { status: string; reference: string; amount: number; currency: string; paid_at?: string; gateway_response?: string };

const paystackSecret = () => {
  if (!env.PAYSTACK_SECRET_KEY) throw serviceUnavailable("Paystack funding is not configured");
  return env.PAYSTACK_SECRET_KEY;
};

const paystackRequest = async <T>(path: string, init?: RequestInit): Promise<PaystackResponse<T>> => {
  let response: globalThis.Response;
  try {
    response = await fetch(`https://api.paystack.co${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${paystackSecret()}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw serviceUnavailable("Paystack is temporarily unavailable");
  }
  const payload = await response.json().catch(() => null) as PaystackResponse<T> | null;
  if (!response.ok || !payload?.status || !payload.data) throw serviceUnavailable(payload?.message || "Paystack request failed");
  return payload;
};

const paystackMinorUnits = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value).mul(100).toDecimalPlaces(0).toNumber();

export const initializePaystackWalletFunding = async (organizationId: string, input: PaystackFundingInput, user: AuthUser) => {
  if (!env.PAYSTACK_CALLBACK_URL) throw serviceUnavailable("Paystack callback URL is not configured");
  const wallet = await prisma.walletAccount.findFirst({ where: { id: input.walletAccountId, organizationId } });
  if (!wallet) throw notFound("Wallet not found");
  if (wallet.currency !== "NGN") throw conflict("Paystack wallet funding currently supports NGN wallets only");
  const fundingAmount = new Prisma.Decimal(input.amount);
  const referenceValue = reference("PSK");
  const attempt = await prisma.walletFundingAttempt.create({ data: { organizationId, walletAccountId: wallet.id, reference: referenceValue, amount: fundingAmount, currency: wallet.currency, createdById: user.id } });
  try {
    const response = await paystackRequest<PaystackInitializeData>("/transaction/initialize", { method: "POST", body: JSON.stringify({ email: user.email, amount: paystackMinorUnits(fundingAmount), currency: wallet.currency, reference: referenceValue, callback_url: env.PAYSTACK_CALLBACK_URL, metadata: { fundingAttemptId: attempt.id, organizationId, walletAccountId: wallet.id } }) });
    const updated = await prisma.walletFundingAttempt.update({ where: { id: attempt.id }, data: { authorizationUrl: response.data!.authorization_url, accessCode: response.data!.access_code, providerReference: response.data!.reference, providerPayload: response.data as unknown as Prisma.InputJsonValue } });
    await audit(organizationId, user, "ACCOUNTING_WALLET_FUNDING_INITIALIZED", "WALLET_FUNDING", updated.id, `Initialized Paystack wallet funding ${updated.reference}`);
    return { id: updated.id, provider: updated.provider, reference: updated.reference, amount: amount(updated.amount), currency: updated.currency, status: updated.status, authorizationUrl: updated.authorizationUrl, accessCode: updated.accessCode };
  } catch (error) {
    await prisma.walletFundingAttempt.update({ where: { id: attempt.id }, data: { status: "FAILED", failureReason: error instanceof Error ? error.message.slice(0, 500) : "Initialization failed" } });
    throw error;
  }
};

const finalizeVerifiedPaystackFunding = async (attemptId: string, verification: PaystackVerifyData) => {
  const result = await prisma.$transaction(async db => {
    const attempt = await db.walletFundingAttempt.findUnique({ where: { id: attemptId } });
    if (!attempt) throw notFound("Wallet funding attempt not found");
    if (attempt.status === "COMPLETED") {
      const existing = await db.walletTransaction.findFirst({ where: { walletAccountId: attempt.walletAccountId, sourceType: "PAYSTACK_FUNDING", sourceId: attempt.id, type: "WALLET_FUNDING" } });
      return { attempt, transaction: existing, idempotentReplay: true };
    }
    if (verification.status !== "success" || verification.reference !== attempt.reference || verification.amount !== paystackMinorUnits(attempt.amount) || verification.currency !== attempt.currency) throw conflict("Paystack payment verification does not match the funding request");
    const claimed = await db.walletFundingAttempt.updateMany({ where: { id: attempt.id, status: { in: ["PENDING", "FAILED"] } }, data: { status: "PROCESSING", providerPayload: verification as unknown as Prisma.InputJsonValue } });
    if (claimed.count !== 1) throw conflict("Wallet funding is already being processed");
    const wallet = await db.walletAccount.findFirst({ where: { id: attempt.walletAccountId, organizationId: attempt.organizationId } });
    if (!wallet) throw notFound("Wallet not found");
    const updatedWallet = await db.walletAccount.update({ where: { id: wallet.id }, data: { balance: { increment: attempt.amount } } });
    const transaction = await db.walletTransaction.create({ data: { organizationId: attempt.organizationId, walletAccountId: wallet.id, type: "WALLET_FUNDING", direction: "CREDIT", amount: attempt.amount, balanceBefore: wallet.balance, balanceAfter: updatedWallet.balance, reference: reference("WLT"), transferReference: attempt.reference, description: "Paystack wallet funding", sourceType: "PAYSTACK_FUNDING", sourceId: attempt.id, createdById: attempt.createdById } });
    const completed = await db.walletFundingAttempt.update({ where: { id: attempt.id }, data: { status: "COMPLETED", verifiedAt: verification.paid_at ? new Date(verification.paid_at) : new Date(), providerReference: verification.reference, failureReason: null } });
    return { attempt: completed, transaction, idempotentReplay: false };
  });
  if (!result.idempotentReplay) await createAuditLog({ organizationId: result.attempt.organizationId, actorUserId: result.attempt.createdById ?? undefined, action: "ACCOUNTING_WALLET_FUNDING_COMPLETED", resource: "WALLET_FUNDING", resourceId: result.attempt.id, summary: `Verified Paystack wallet funding ${result.attempt.reference}` });
  return { reference: result.attempt.reference, status: result.attempt.status, amount: amount(result.attempt.amount), currency: result.attempt.currency, transactionId: result.transaction?.id ?? null, idempotentReplay: result.idempotentReplay };
};

const verifyPaystackReference = async (referenceValue: string) => {
  const response = await paystackRequest<PaystackVerifyData>(`/transaction/verify/${encodeURIComponent(referenceValue)}`);
  return response.data!;
};

export const verifyPaystackWalletFunding = async (organizationId: string, referenceValue: string) => {
  const attempt = await prisma.walletFundingAttempt.findFirst({ where: { reference: referenceValue, organizationId } });
  if (!attempt) throw notFound("Wallet funding attempt not found");
  if (attempt.status === "COMPLETED") return finalizeVerifiedPaystackFunding(attempt.id, { status: "success", reference: attempt.reference, amount: paystackMinorUnits(attempt.amount), currency: attempt.currency });
  const verification = await verifyPaystackReference(referenceValue);
  return finalizeVerifiedPaystackFunding(attempt.id, verification);
};

export const processPaystackWebhook = async (rawBody: Buffer | undefined, signature: string | undefined) => {
  if (!rawBody || !signature) throw unauthorized("Invalid Paystack webhook signature");
  const expected = crypto.createHmac("sha512", paystackSecret()).update(rawBody).digest("hex");
  const supplied = Buffer.from(signature, "utf8");
  const calculated = Buffer.from(expected, "utf8");
  if (supplied.length !== calculated.length || !crypto.timingSafeEqual(supplied, calculated)) throw unauthorized("Invalid Paystack webhook signature");
  const event = JSON.parse(rawBody.toString("utf8")) as { event?: string; data?: { reference?: string } };
  if (event.event !== "charge.success" || !event.data?.reference) return { received: true, processed: false };
  const attempt = await prisma.walletFundingAttempt.findUnique({ where: { reference: event.data.reference } });
  if (!attempt) return { received: true, processed: false };
  const verification = await verifyPaystackReference(attempt.reference);
  const result = await finalizeVerifiedPaystackFunding(attempt.id, verification);
  return { received: true, processed: true, ...result };
};

export const listInvoiceTemplates = (organizationId: string) => prisma.accountingInvoiceTemplate.findMany({ where: { organizationId }, orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }] });
export const createInvoiceTemplate = async (organizationId: string, input: InvoiceTemplateInput, user: AuthUser) => { const count = await prisma.accountingInvoiceTemplate.count({ where: { organizationId } }); const row = await prisma.accountingInvoiceTemplate.create({ data: { organizationId, ...input, normalizedName: input.name.trim().toLowerCase(), isDefault: count === 0 } }); await audit(organizationId,user,"ACCOUNTING_INVOICE_TEMPLATE_CREATED","ACCOUNTING_INVOICE_TEMPLATE",row.id,"Created invoice template"); return row; };
export const updateInvoiceTemplate = async (organizationId: string, id: string, input: Partial<InvoiceTemplateInput>, user: AuthUser) => { const found = await prisma.accountingInvoiceTemplate.findFirst({ where: { id, organizationId } }); if (!found) throw notFound("Invoice template not found"); const row = await prisma.accountingInvoiceTemplate.update({ where: { id }, data: { ...input, ...(input.name ? { normalizedName: input.name.trim().toLowerCase() } : {}) } }); await audit(organizationId,user,"ACCOUNTING_INVOICE_TEMPLATE_UPDATED","ACCOUNTING_INVOICE_TEMPLATE",id,"Updated invoice template"); return row; };
export const setDefaultInvoiceTemplate = async (organizationId: string, id: string, user: AuthUser) => { const found = await prisma.accountingInvoiceTemplate.findFirst({ where: { id, organizationId } }); if (!found) throw notFound("Invoice template not found"); await prisma.$transaction([prisma.accountingInvoiceTemplate.updateMany({ where: { organizationId, isDefault: true }, data: { isDefault: false } }), prisma.accountingInvoiceTemplate.update({ where: { id }, data: { isDefault: true } })]); await audit(organizationId,user,"ACCOUNTING_INVOICE_TEMPLATE_DEFAULTED","ACCOUNTING_INVOICE_TEMPLATE",id,"Set default invoice template"); return prisma.accountingInvoiceTemplate.findUniqueOrThrow({ where: { id } }); };
export const deleteInvoiceTemplate = async (organizationId: string, id: string, user: AuthUser) => { const found = await prisma.accountingInvoiceTemplate.findFirst({ where: { id, organizationId } }); if (!found) throw notFound("Invoice template not found"); if (found.isDefault) throw conflict("Set another template as default before deleting this template"); await prisma.accountingInvoiceTemplate.delete({ where: { id } }); await audit(organizationId,user,"ACCOUNTING_INVOICE_TEMPLATE_DELETED","ACCOUNTING_INVOICE_TEMPLATE",id,"Deleted invoice template"); };
export const listExpenseCategories = (organizationId: string) => prisma.accountingExpenseCategory.findMany({ where: { organizationId }, orderBy: { name: "asc" } });
export const createExpenseCategory = async (organizationId: string, input: ExpenseCategoryInput, user: AuthUser) => { const row = await prisma.accountingExpenseCategory.create({ data: { organizationId, reference: reference("EXC"), name: input.name, normalizedName: input.name.trim().toLowerCase(), description: input.description } }); await audit(organizationId,user,"ACCOUNTING_EXPENSE_CATEGORY_CREATED","ACCOUNTING_EXPENSE_CATEGORY",row.id,"Created expense category"); return row; };
export const deleteExpenseCategory = async (organizationId: string, id: string, user: AuthUser) => { const found = await prisma.accountingExpenseCategory.findFirst({ where: { id, organizationId } }); if (!found) throw notFound("Expense category not found"); if (await prisma.accountingExpense.count({ where: { organizationId, categoryId: id } })) throw conflict("Expense category cannot be deleted because it is used by existing expenses."); await prisma.accountingExpenseCategory.delete({ where: { id } }); await audit(organizationId,user,"ACCOUNTING_EXPENSE_CATEGORY_DELETED","ACCOUNTING_EXPENSE_CATEGORY",id,"Deleted expense category"); };
export const getUiReminderSettings = async (organizationId: string) => { const c = await reminderConfiguration(organizationId); return { automaticRemindersEnabled: c.automaticRemindersEnabled, firstReminderDaysBeforeDue: c.firstReminderDaysBeforeDue, overdueReminderFrequency: c.overdueReminderFrequency, inAppEnabled: c.inAppEnabled, emailEnabled: c.emailEnabled }; };
export const updateUiReminderSettings = async (organizationId: string, input: UiReminderSettingsInput, user: AuthUser) => { const overdueIntervals = input.overdueReminderFrequency === "NEVER" ? [] : input.overdueReminderFrequency === "ONCE" ? [1] : Array.from({ length: 365 }, (_,i) => i+1).filter(d => d % (input.overdueReminderFrequency === "EVERY_3_DAYS" ? 3 : 7) === 0); const row = await prisma.accountingReminderConfiguration.upsert({ where: { organizationId }, create: { organizationId, ...input, upcomingDays: [input.firstReminderDaysBeforeDue], overdueIntervals, updatedByUserId: user.id }, update: { ...input, upcomingDays: [input.firstReminderDaysBeforeDue], overdueIntervals, updatedByUserId: user.id } }); await audit(organizationId,user,"ACCOUNTING_REMINDER_CONFIGURATION_UPDATED","ACCOUNTING_REMINDER_CONFIGURATION",row.id,"Updated UI reminder settings"); return getUiReminderSettings(organizationId); };
