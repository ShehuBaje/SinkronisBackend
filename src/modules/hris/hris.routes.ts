import { Router } from "express";
import { asyncHandler } from "../../core/async-handler";
import { createCrudRouter } from "../../core/crud-router";
import { validate } from "../../core/validate";
import { authorize } from "../../middleware/rbac.middleware";
import { clockInController, clockOutController } from "./hris.controller";
import {
  appraisalsCrudOptions,
  attendanceCrudOptions,
  conductCrudOptions,
  employeesCrudOptions,
  leaveCrudOptions
} from "./hris.service";
import { clockInSchema, clockOutParamsSchema } from "./hris.validation";

export const hrisRouter = Router();

hrisRouter.use(
  "/employees",
  createCrudRouter(employeesCrudOptions)
);

hrisRouter.post(
  "/attendance/clock-in",
  authorize("hris:attendance:create"),
  validate({ body: clockInSchema }),
  asyncHandler(clockInController)
);

hrisRouter.post(
  "/attendance/:id/clock-out",
  authorize("hris:attendance:update"),
  validate({ params: clockOutParamsSchema }),
  asyncHandler(clockOutController)
);

hrisRouter.use(
  "/attendance",
  createCrudRouter(attendanceCrudOptions)
);

hrisRouter.use(
  "/leave",
  createCrudRouter(leaveCrudOptions)
);

hrisRouter.use(
  "/appraisals",
  createCrudRouter(appraisalsCrudOptions)
);

hrisRouter.use(
  "/conduct",
  createCrudRouter(conductCrudOptions)
);
