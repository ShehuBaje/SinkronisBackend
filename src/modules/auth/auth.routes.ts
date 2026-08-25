import { Router } from "express";
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
  registerOrganizationSchema,
  resetPasswordSchema,
  updatePreferredTwoFactorMethodSchema,
  verifyLoginTwoFactorSchema,
  verifyResetOtpSchema
} from "./auth.validation";

export const authRouter = Router();

authRouter.post(
  "/register",
  validate({ body: registerOrganizationSchema }),
  asyncHandler(registerOrganizationController)
);

authRouter.get("/me", authenticate, asyncHandler(getCurrentAuthenticatedUserController));

authRouter.post("/tenant-invitations/accept", validate({ body: acceptTenantInvitationSchema }), asyncHandler(acceptTenantAdminInvitationController));

authRouter.post(
  "/login",
  validate({ body: loginSchema }),
  asyncHandler(loginController)
);

authRouter.post(
  "/login/2fa/verify",
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
  validate({ body: forgotPasswordSchema }),
  asyncHandler(forgotPasswordController)
);

authRouter.post(
  "/forgot-password/resend-otp",
  validate({ body: forgotPasswordSchema }),
  asyncHandler(resendPasswordOtpController)
);

authRouter.post(
  "/forgot-password/verify-otp",
  validate({ body: verifyResetOtpSchema }),
  asyncHandler(verifyResetOtpController)
);

authRouter.post(
  "/reset-password",
  validate({ body: resetPasswordSchema }),
  asyncHandler(resetPasswordController)
);
