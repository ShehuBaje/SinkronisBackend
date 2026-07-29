import { Router } from "express";
import { asyncHandler } from "../../core/async-handler";
import { validate } from "../../core/validate";
import { authorize } from "../../middleware/rbac.middleware";
import {
  getCurrentSubscriptionController,
  updateSubscriptionSeatsController
} from "./subscriptions.controller";
import { subscriptionSeatsUpdateSchema } from "./subscriptions.validation";

export const subscriptionsRouter = Router();

subscriptionsRouter.get(
  "/current",
  authorize("admin:organization:view"),
  asyncHandler(getCurrentSubscriptionController)
);

subscriptionsRouter.patch(
  "/current/seats",
  authorize("admin:organization:update"),
  validate({ body: subscriptionSeatsUpdateSchema }),
  asyncHandler(updateSubscriptionSeatsController)
);
