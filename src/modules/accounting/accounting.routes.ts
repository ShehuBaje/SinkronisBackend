import { Router } from "express";
import { asyncHandler } from "../../core/async-handler";
import { createCrudRouter } from "../../core/crud-router";
import { validate } from "../../core/validate";
import { authorize } from "../../middleware/rbac.middleware";
import {
  createInvoiceController,
  getInvoiceByIdController,
  listInvoicesController,
  updateInvoiceController
} from "./accounting.controller";
import {
  agentInvitationsCrudOptions,
  clientsCrudOptions,
  paymentRequestsCrudOptions,
  taxReportsCrudOptions,
  walletDisbursementsCrudOptions,
  walletsCrudOptions
} from "./accounting.service";
import {
  invoiceCreateSchema,
  invoiceUpdateSchema,
  invoiceIdParamsSchema
} from "./accounting.validation";

export const accountingRouter = Router();

adminClients();
invoices();
paymentRequests();
taxReports();
wallets();
agentInvitations();

function adminClients() {
  accountingRouter.use("/clients", createCrudRouter(clientsCrudOptions));
}

function invoices() {
  accountingRouter.get(
    "/invoices",
    authorize("accounting:invoices:view"),
    asyncHandler(listInvoicesController)
  );

  accountingRouter.post(
    "/invoices",
    authorize("accounting:invoices:create"),
    validate({ body: invoiceCreateSchema }),
    asyncHandler(createInvoiceController)
  );

  accountingRouter.get(
    "/invoices/:id",
    authorize("accounting:invoices:view"),
    validate({ params: invoiceIdParamsSchema }),
    asyncHandler(getInvoiceByIdController)
  );

  accountingRouter.patch(
    "/invoices/:id",
    authorize("accounting:invoices:update"),
    validate({ params: invoiceIdParamsSchema, body: invoiceUpdateSchema }),
    asyncHandler(updateInvoiceController)
  );
}

function paymentRequests() {
  accountingRouter.use("/payment-requests", createCrudRouter(paymentRequestsCrudOptions));
}

function taxReports() {
  accountingRouter.use("/tax-reports", createCrudRouter(taxReportsCrudOptions));
}

function wallets() {
  accountingRouter.use("/wallets", createCrudRouter(walletsCrudOptions));
  accountingRouter.use("/wallet-disbursements", createCrudRouter(walletDisbursementsCrudOptions));
}

function agentInvitations() {
  accountingRouter.use("/agent-invitations", createCrudRouter(agentInvitationsCrudOptions));
}
