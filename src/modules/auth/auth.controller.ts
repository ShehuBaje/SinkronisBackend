import {
  beginAuthenticatorSetup,
  acceptTenantAdminInvitation,
  disableAuthenticator,
  enableAuthenticator,
  forgotPassword,
  getTwoFactorStatus,
  login,
  registerOrganization,
  resendPasswordOtp,
  resetPassword,
  updatePreferredTwoFactorMethod,
  verifyLoginTwoFactor,
  verifyResetOtp
} from "./auth.service";

export const registerOrganizationController = async (req: any, res: any) => {
  const result = await registerOrganization(req.body);
  res.status(201).json(result);
};
export const acceptTenantAdminInvitationController = async (req: any, res: any) => res.json(await acceptTenantAdminInvitation(req.body));

export const loginController = async (req: any, res: any) => {
  const result = await login(req.body, {
    headers: req.headers,
    ip: req.ip
  });
  res.json(result);
};

export const verifyLoginTwoFactorController = async (req: any, res: any) => {
  const result = await verifyLoginTwoFactor(req.body, {
    headers: req.headers,
    ip: req.ip
  });
  res.json(result);
};

export const getTwoFactorStatusController = async (req: any, res: any) => {
  const result = await getTwoFactorStatus(req.user?.id);
  res.json(result);
};

export const beginAuthenticatorSetupController = async (req: any, res: any) => {
  const result = await beginAuthenticatorSetup(req.user?.id, req.body);
  res.json(result);
};

export const enableAuthenticatorController = async (req: any, res: any) => {
  const result = await enableAuthenticator(req.user?.id, req.body);
  res.json(result);
};

export const disableAuthenticatorController = async (req: any, res: any) => {
  const result = await disableAuthenticator(req.user?.id, req.body);
  res.json(result);
};

export const updatePreferredTwoFactorMethodController = async (req: any, res: any) => {
  const result = await updatePreferredTwoFactorMethod(req.user?.id, req.body);
  res.json(result);
};

export const forgotPasswordController = async (req: any, res: any) => {
  const result = await forgotPassword(req.body);
  res.json(result);
};

export const resendPasswordOtpController = async (req: any, res: any) => {
  const result = await resendPasswordOtp(req.body);
  res.json(result);
};

export const verifyResetOtpController = async (req: any, res: any) => {
  const result = await verifyResetOtp(req.body);
  res.json(result);
};

export const resetPasswordController = async (req: any, res: any) => {
  const result = await resetPassword(req.body);
  res.json(result);
};
