import type { RequestHandler } from "express";
import { forbidden } from "../core/http-error";

// Impersonation is intended for support and troubleshooting. Mutations to
// authentication, security, billing, bank/payment, subscription, payroll
// approval, export/deletion, and organization settings remain unavailable.
const sensitiveMutation = /\/(security|password|billing|payment|wallet|bank|subscription|payroll|settings|delete|export)(\/|$)/i;

export const restrictImpersonatedSensitiveActions: RequestHandler = (req, _res, next) => {
  if (req.user?.impersonation && req.method !== "GET" && sensitiveMutation.test(req.path)) {
    return next(forbidden("This sensitive action is unavailable during impersonation"));
  }
  return next();
};
