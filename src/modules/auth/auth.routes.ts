import { Router } from "express";
import rateLimit from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import { env } from "../../config/env";
import { redis } from "../../config/redis";
import { asyncHandler } from "../../core/async-handler";
import { validate } from "../../core/validate";
import { authenticate } from "../../middleware/auth.middleware";
import {
  beginAuthenticatorSetupController,
  acceptTenantAdminInvitationController,
  disableAuthenticatorController,
  enableAuthenticatorController,
  forgotPasswordController,
  loginController,
  refreshAuthenticationTokensController,
  registerOrganizationController,
  resendPasswordOtpController,
  resetPasswordController,
  getTwoFactorStatusController,
  getCurrentAuthenticatedUserController,
  updatePreferredTwoFactorMethodController,
  verifyLoginTwoFactorController,
  verifyResetOtpController
} from "./auth.controller";
import {
  beginAuthenticatorSetupSchema,
  acceptTenantInvitationSchema,
  disableAuthenticatorSchema,
  enableAuthenticatorSchema,
  forgotPasswordSchema,
  loginSchema,
  refreshTokenSchema,
  registerOrganizationSchema,
  resetPasswordSchema,
  updatePreferredTwoFactorMethodSchema,
  verifyLoginTwoFactorSchema,
  verifyResetOtpSchema
} from "./auth.validation";

export const authRouter = Router();

const limiterStore = (prefix: string) => env.RATE_LIMIT_STORE === "redis" ? new RedisStore({
  sendCommand: async (...args: string[]) => redis.call(args[0], ...args.slice(1)) as never,
  prefix
}) : undefined;
const authenticationAttemptLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false, store: limiterStore("sinkronis:auth-attempt:") });
const passwordRecoveryLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 5, standardHeaders: true, legacyHeaders: false, store: limiterStore("sinkronis:password-recovery:") });

authRouter.post(
  "/register",
  validate({ body: registerOrganizationSchema }),
  asyncHandler(registerOrganizationController)
);

authRouter.get("/me", authenticate, asyncHandler(getCurrentAuthenticatedUserController));

authRouter.post("/tenant-invitations/accept", validate({ body: acceptTenantInvitationSchema }), asyncHandler(acceptTenantAdminInvitationController));

authRouter.post(
  "/login",
  authenticationAttemptLimit,
  validate({ body: loginSchema }),
  asyncHandler(loginController)
);

authRouter.post(
  "/refresh",
  validate({ body: refreshTokenSchema }),
  asyncHandler(refreshAuthenticationTokensController)
);

authRouter.post(
  "/login/2fa/verify",
  authenticationAttemptLimit,
  validate({ body: verifyLoginTwoFactorSchema }),
  asyncHandler(verifyLoginTwoFactorController)
);

authRouter.get("/2fa/status", authenticate, asyncHandler(getTwoFactorStatusController));

authRouter.post(
  "/2fa/authenticator/setup",
  authenticate,
  validate({ body: beginAuthenticatorSetupSchema }),
  asyncHandler(beginAuthenticatorSetupController)
);

authRouter.post(
  "/2fa/authenticator/enable",
  authenticate,
  validate({ body: enableAuthenticatorSchema }),
  asyncHandler(enableAuthenticatorController)
);

authRouter.post(
  "/2fa/authenticator/disable",
  authenticate,
  validate({ body: disableAuthenticatorSchema }),
  asyncHandler(disableAuthenticatorController)
);

authRouter.put(
  "/2fa/preferred-method",
  authenticate,
  validate({ body: updatePreferredTwoFactorMethodSchema }),
  asyncHandler(updatePreferredTwoFactorMethodController)
);

authRouter.post(
  "/forgot-password",
  passwordRecoveryLimit,
  validate({ body: forgotPasswordSchema }),
  asyncHandler(forgotPasswordController)
);

authRouter.post(
  "/forgot-password/resend-otp",
  passwordRecoveryLimit,
  validate({ body: forgotPasswordSchema }),
  asyncHandler(resendPasswordOtpController)
);

authRouter.post(
  "/forgot-password/verify-otp",
  authenticationAttemptLimit,
  validate({ body: verifyResetOtpSchema }),
  asyncHandler(verifyResetOtpController)
);

authRouter.post(
  "/reset-password",
  authenticationAttemptLimit,
  validate({ body: resetPasswordSchema }),
  asyncHandler(resetPasswordController)
);
