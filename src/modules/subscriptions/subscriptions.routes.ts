import { Router } from "express";
import { asyncHandler } from "../../core/async-handler";
import { authorize } from "../../middleware/rbac.middleware";
import {
  getCurrentSubscriptionController
} from "./subscriptions.controller";

export const subscriptionsRouter = Router();

subscriptionsRouter.get(
  "/current",
  authorize("admin:organization:view"),
  asyncHandler(getCurrentSubscriptionController)
);
