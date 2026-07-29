import { z } from "zod";

const e164Phone = z.string().regex(/^\+[1-9]\d{7,14}$/, "Phone must be a valid E.164 number");

export const registerOrganizationSchema = z.object({
  organization: z.object({
    name: z.string().min(2),
    slug: z.string().min(2).regex(/^[a-z0-9-]+$/).optional(),
    profileImageUrl: z.string().url().optional(),
    email: z.string().email().optional(),
    phone: e164Phone.optional(),
    industry: z.string().min(2).optional(),
    address: z.string().min(2).optional(),
    taxId: z.string().min(2).optional(),
    cacNumber: z.string().min(2).optional(),
    country: z.string().optional(),
    currency: z.string().default("NGN")
  }),
  admin: z.object({
    firstName: z.string().min(1).optional(),
    lastName: z.string().min(1).optional(),
    email: z.string().email(),
    password: z.string().min(8)
  })
});

export const loginSchema = z.object({
  organizationSlug: z.string().min(2).optional(),
  email: z.string().email(),
  password: z.string().min(8),
  twoFactorMethod: z.enum(["AUTHENTICATOR_APP", "SMS_OTP", "EMAIL_OTP"]).optional()
});

export const forgotPasswordSchema = z.object({
  email: z.string().email(),
  organizationSlug: z.string().min(2).optional()
});

export const verifyResetOtpSchema = z.object({
  email: z.string().email(),
  otp: z.string().regex(/^\d{6}$/),
  organizationSlug: z.string().min(2).optional()
});

export const resetPasswordSchema = z
  .object({
    resetToken: z.string().min(1),
    password: z.string().min(8),
    confirmPassword: z.string().min(8)
  })
  .refine((value) => value.password === value.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"]
  });

export const verifyLoginTwoFactorSchema = z.object({
  challengeToken: z.string().min(1),
  otp: z.string().regex(/^\d{6}$/)
});

export const beginAuthenticatorSetupSchema = z.object({
  accountName: z.string().min(1).max(80).optional()
});

export const enableAuthenticatorSchema = z.object({
  setupToken: z.string().min(1),
  otp: z.string().regex(/^\d{6}$/)
});

export const disableAuthenticatorSchema = z.object({
  otp: z.string().regex(/^\d{6}$/)
});

export const updatePreferredTwoFactorMethodSchema = z.object({
  method: z.enum(["AUTHENTICATOR_APP", "SMS_OTP", "EMAIL_OTP"]),
  phoneNumber: e164Phone.optional()
});
