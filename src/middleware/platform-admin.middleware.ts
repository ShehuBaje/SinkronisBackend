import type { RequestHandler } from "express";
import { forbidden } from "../core/http-error";

export const requirePlatformAdmin: RequestHandler = (req, _res, next) => {
  if (!req.user?.isPlatformAdmin) {
    return next(forbidden("Platform Admin access is required"));
  }
  return next();
};
