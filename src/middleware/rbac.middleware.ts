import type { RequestHandler } from "express";
import { forbidden } from "../core/http-error";
import type { PermissionKey } from "../modules/auth/permissions";

export const authorize =
  (...required: PermissionKey[]): RequestHandler =>
  (req, _res, next) => {
    const granted = new Set(req.user?.permissions ?? []);
    const hasAccess = required.every((permission) => granted.has(permission));

    if (!hasAccess) {
      return next(forbidden("You do not have permission to perform this action"));
    }

    return next();
  };
