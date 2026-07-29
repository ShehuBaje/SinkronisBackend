import crypto from "crypto";
import { notFound } from "../../core/http-error";
import { prisma } from "../../core/prisma";
import type { InvoiceCreateInput, InvoiceItemInput, InvoiceUpdateInput } from "./accounting.interface";
import {
  clientCreateSchema,
  clientUpdateSchema,
  disbursementCreateSchema,
  disbursementUpdateSchema,
  invitationCreateSchema,
  invitationUpdateSchema,
  invoiceCreateSchema,
  invoiceUpdateSchema,
  paymentRequestCreateSchema,
  paymentRequestUpdateSchema,
  taxReportCreateSchema,
  taxReportUpdateSchema,
  walletCreateSchema,
  walletUpdateSchema
} from "./accounting.validation";

const subtotalFromItems = (items: InvoiceItemInput[]) =>
  items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);

export const listInvoices = async (organizationId: string) => {
  return prisma.invoice.findMany({
    where: { organizationId },
    include: { client: true, items: true },
    orderBy: { createdAt: "desc" }
  });
};

export const getInvoiceById = async (organizationId: string, id: string) => {
  const invoice = await prisma.invoice.findFirst({
    where: { id, organizationId },
    include: { client: true, items: true }
  });

  if (!invoice) throw notFound();
  return invoice;
};

export const createInvoice = async (organizationId: string, input: InvoiceCreateInput) => {
  const subtotal = subtotalFromItems(input.items);
  const total = subtotal + input.taxAmount;

  return prisma.invoice.create({
    data: {
      organizationId,
      clientId: input.clientId,
      invoiceNo: input.invoiceNo,
      issueDate: input.issueDate,
      dueDate: input.dueDate,
      status: input.status,
      subtotal,
      taxAmount: input.taxAmount,
      total,
      notes: input.notes,
      items: {
        create: input.items.map((item) => ({
          ...item,
          total: item.quantity * item.unitPrice
        }))
      }
    },
    include: { client: true, items: true }
  });
};

export const updateInvoice = async (organizationId: string, id: string, input: InvoiceUpdateInput) => {
  const existing = await prisma.invoice.findFirst({
    where: { id, organizationId }
  });

  if (!existing) throw notFound();

  const itemUpdate = input.items
    ? {
        deleteMany: {},
        create: input.items.map((item) => ({
          ...item,
          total: item.quantity * item.unitPrice
        }))
      }
    : undefined;

  const subtotal = input.items ? subtotalFromItems(input.items) : undefined;
  const taxAmount = input.taxAmount ?? Number(existing.taxAmount);
  const total = subtotal !== undefined ? subtotal + taxAmount : undefined;

  return prisma.invoice.update({
    where: { id },
    data: {
      clientId: input.clientId,
      invoiceNo: input.invoiceNo,
      issueDate: input.issueDate,
      dueDate: input.dueDate,
      status: input.status,
      subtotal,
      taxAmount: input.taxAmount,
      total,
      notes: input.notes,
      items: itemUpdate
    },
    include: { client: true, items: true }
  });
};

export const clientsCrudOptions = {
  model: "client" as const,
  createSchema: clientCreateSchema,
  updateSchema: clientUpdateSchema,
  permission: "accounting:clients:view" as const,
  searchableFields: ["name", "email"]
};

export const paymentRequestsCrudOptions = {
  model: "paymentRequest" as const,
  createSchema: paymentRequestCreateSchema,
  updateSchema: paymentRequestUpdateSchema,
  permission: "accounting:payments:view" as const,
  searchableFields: ["title", "vendorName"]
};

export const taxReportsCrudOptions = {
  model: "taxReport" as const,
  createSchema: taxReportCreateSchema,
  updateSchema: taxReportUpdateSchema,
  permission: "accounting:tax:view" as const,
  searchableFields: ["type", "reference"]
};

export const walletsCrudOptions = {
  model: "walletAccount" as const,
  createSchema: walletCreateSchema,
  updateSchema: walletUpdateSchema,
  permission: "accounting:wallets:view" as const,
  searchableFields: ["name"],
  include: { disbursements: true }
};

export const walletDisbursementsCrudOptions = {
  model: "walletDisbursement" as const,
  createSchema: disbursementCreateSchema,
  updateSchema: disbursementUpdateSchema,
  permission: "accounting:wallets:update" as const
};

export const agentInvitationsCrudOptions = {
  model: "agentInvitation" as const,
  createSchema: invitationCreateSchema,
  updateSchema: invitationUpdateSchema,
  permission: "accounting:agents:view" as const,
  searchableFields: ["email"],
  beforeCreate: (data: Record<string, unknown>) => ({
    ...data,
    token: crypto.randomBytes(32).toString("hex")
  })
};

export { invoiceCreateSchema, invoiceUpdateSchema };
