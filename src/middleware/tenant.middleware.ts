import type { RequestHandler } from "express";
import { forbidden } from "../core/http-error";

export const requireTenant: RequestHandler = (req, _res, next) => {
  if (!req.user?.organizationId) {
    return next(forbidden("Tenant context is required"));
  }
  req.organizationId = req.user.organizationId;
  return next();
};
