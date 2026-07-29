export type InvoiceItemInput = {
  description: string;
  quantity: number;
  unitPrice: number;
};

export type InvoiceCreateInput = {
  clientId: string;
  invoiceNo: string;
  issueDate: Date;
  dueDate?: Date;
  status?: "DRAFT" | "SENT" | "PAID" | "VOID" | "OVERDUE";
  taxAmount: number;
  notes?: string;
  items: InvoiceItemInput[];
};

export type InvoiceUpdateInput = Partial<InvoiceCreateInput>;
