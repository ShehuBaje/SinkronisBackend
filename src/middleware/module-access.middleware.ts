import type { RequestHandler } from "express";
import { forbidden } from "../core/http-error";
import type { BillingModuleKey } from "../modules/billing/billing.catalog";
import { evaluateEffectiveModuleAccess, isOrganizationModuleEnabled } from "../modules/billing/module-access.service";

export const requireEffectiveModuleAccess = (module: BillingModuleKey): RequestHandler => async (req, _res, next) => {
  if (!req.user || req.user.isPlatformAdmin) return next(forbidden("Direct tenant module access is required"));
  try {
    const allowed = await evaluateEffectiveModuleAccess({ organizationId: req.user.organizationId, userIsActive: true, permissions: req.user.permissions, module });
    return allowed ? next() : next(forbidden(`${module.toUpperCase()} module access is disabled or not permitted`));
  } catch (error) { return next(error); }
};

/** Employee self-service access requires tenant entitlement, not administrative module permissions. */
export const requireModuleEntitlement = (module: BillingModuleKey): RequestHandler => async (req, _res, next) => {
  if (!req.user || req.user.isPlatformAdmin) return next(forbidden("Direct tenant module access is required"));
  try {
    return await isOrganizationModuleEnabled(req.user.organizationId, module) ? next() : next(forbidden(`${module.toUpperCase()} module access is disabled`));
  } catch (error) { return next(error); }
};
