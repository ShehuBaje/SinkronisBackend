import type { RequestHandler } from "express";
import { getMaintenanceModeValue } from "../modules/platform-admin/platform-admin.service";

export const enforcePlatformMaintenance: RequestHandler = async (req, res, next) => {
  try {
    if (req.user?.isPlatformAdmin && !req.user.impersonation) return next();
    const maintenance = await getMaintenanceModeValue();
    if (!maintenance.enabled) return next();
    res.setHeader("Retry-After", "300");
    return res.status(503).json({
      success: false,
      code: "MAINTENANCE_MODE",
      errorCode: "MAINTENANCE_MODE",
      message: maintenance.message,
      data: null
    });
  } catch (error) {
    return next(error);
  }
};
