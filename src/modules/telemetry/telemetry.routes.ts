import { Router } from "express";
import { asyncHandler } from "../../core/async-handler";
import { sendSuccess } from "../../core/api-response";
import { validate } from "../../core/validate";
import { pageViewSchema } from "./telemetry.validation";
import { recordTenantPageView } from "./telemetry.service";
import { forbidden } from "../../core/http-error";

export const telemetryRouter = Router();
telemetryRouter.post("/page-view", validate({ body: pageViewSchema }), asyncHandler(async (req, res) => {
  if (req.user!.isPlatformAdmin) throw forbidden("Tenant telemetry is required");
  return sendSuccess(res, "Page view recorded", await recordTenantPageView(req.user!.organizationId), { status: 201 });
}));
