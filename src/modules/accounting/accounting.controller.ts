import { createInvoice, getInvoiceById, listInvoices, updateInvoice } from "./accounting.service";

export const listInvoicesController = async (req: any, res: any) => {
  const invoices = await listInvoices(req.organizationId!);
  res.json(invoices);
};

export const createInvoiceController = async (req: any, res: any) => {
  const invoice = await createInvoice(req.organizationId!, req.body);
  res.status(201).json(invoice);
};

export const getInvoiceByIdController = async (req: any, res: any) => {
  const invoice = await getInvoiceById(req.organizationId!, String(req.params.id));
  res.json(invoice);
};

export const updateInvoiceController = async (req: any, res: any) => {
  const invoice = await updateInvoice(req.organizationId!, String(req.params.id), req.body);
  res.json(invoice);
};
