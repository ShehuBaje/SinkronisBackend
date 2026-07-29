import type { z } from "zod";
import type {
  forgotPasswordSchema,
  loginSchema,
  registerOrganizationSchema,
  resetPasswordSchema,
  verifyResetOtpSchema
} from "./auth.schemas";

export type RegisterOrganizationInput = z.infer<typeof registerOrganizationSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type VerifyResetOtpInput = z.infer<typeof verifyResetOtpSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
