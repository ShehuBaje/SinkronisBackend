import type { z } from "zod";
import type { clockInSchema, clockOutParamsSchema } from "./hris.validation";

export type ClockInInput = z.infer<typeof clockInSchema>;
export type ClockOutParams = z.infer<typeof clockOutParamsSchema>;
