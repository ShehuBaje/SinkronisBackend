import { z } from "zod";
import {
  appraisalCreateSchema,
  appraisalUpdateSchema,
  conductCreateSchema,
  conductUpdateSchema,
  employeeCreateSchema,
  employeeUpdateSchema,
  leaveCreateSchema,
  leaveUpdateSchema
} from "../common.schemas";

export const clockInSchema = z.object({
  employeeId: z.string().min(1),
  note: z.string().optional()
});

export const clockOutParamsSchema = z.object({ id: z.string().min(1) });

export const attendanceCreateSchema = z.object({
  employeeId: z.string().min(1),
  clockInAt: z.coerce.date(),
  clockOutAt: z.coerce.date().optional(),
  source: z.enum(["WEB", "MOBILE", "ADMIN"]).optional(),
  note: z.string().optional()
});

export const attendanceUpdateSchema = z.object({
  clockInAt: z.coerce.date().optional(),
  clockOutAt: z.coerce.date().optional(),
  source: z.enum(["WEB", "MOBILE", "ADMIN"]).optional(),
  note: z.string().optional()
});

export {
  appraisalCreateSchema,
  appraisalUpdateSchema,
  conductCreateSchema,
  conductUpdateSchema,
  employeeCreateSchema,
  employeeUpdateSchema,
  leaveCreateSchema,
  leaveUpdateSchema
};
