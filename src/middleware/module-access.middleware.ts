import type { RequestHandler } from "express";
import { forbidden } from "../core/http-error";
import type { BillingModuleKey } from "../modules/billing/billing.catalog";
import { evaluateEffectiveModuleAccess } from "../modules/billing/module-access.service";

export const requireEffectiveModuleAccess = (module: BillingModuleKey): RequestHandler => async (req, _res, next) => {
  if (!req.user || req.user.isPlatformAdmin) return next(forbidden("Direct tenant module access is required"));
  try {
    const allowed = await evaluateEffectiveModuleAccess({ organizationId: req.user.organizationId, userIsActive: true, permissions: req.user.permissions, module });
    return allowed ? next() : next(forbidden(`${module.toUpperCase()} module access is disabled or not permitted`));
  } catch (error) { return next(error); }
};
