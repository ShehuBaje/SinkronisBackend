import { z } from "zod";
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
} from "../common.schemas";

export const invoiceIdParamsSchema = z.object({ id: z.string().min(1) });

export {
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
};
