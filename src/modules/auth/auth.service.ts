import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { Prisma } from "@prisma/client";
import crypto from "crypto";
import { env } from "../../config/env";
import { badRequest, unauthorized } from "../../core/http-error";
import { prisma } from "../../core/prisma";
import { sendLoginOtpEmail, sendLoginSmsOtp, sendPasswordResetOtpEmail } from "./auth.mailer";
import { permissions } from "./permissions";
import type {
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
} from "./auth.schemas";
import type { z } from "zod";
import { getGlobalPasswordPolicy } from "../platform-admin/platform-admin.service";
import { billingModuleKeys, billingPlans } from "../billing/billing.catalog";
import { createAuditLog } from "../admin/admin.audit";

const prismaAny = prisma as any;
const loadOtpLibrary = () => import("otplib");

const RESET_OTP_TTL_MINUTES = 10;
const RESET_OTP_MAX_ATTEMPTS = 5;
const RESET_TOKEN_TTL = "15m";
const LOGIN_2FA_OTP_TTL_MINUTES = 10;
const LOGIN_2FA_MAX_ATTEMPTS = 5;
const LOGIN_2FA_TOKEN_TTL = "15m";
const AUTHENTICATOR_SETUP_TOKEN_TTL = "10m";

type TwoFactorMethod = "AUTHENTICATOR_APP" | "SMS_OTP" | "EMAIL_OTP";

const defaultSecurityPolicy = {
  minPasswordLength: 8,
  passwordExpiryDays: 90,
  lockoutMaxAttempts: 5,
  requireUppercase: true,
  requireLowercase: true,
  requireNumber: true,
  requireSpecialCharacter: true,
  ipAllowlistEnabled: false,
  twoFactorEnabled: false,
  enforceTwoFactorForAllUsers: false,
  allowAuthenticatorApp: true,
  allowSmsOtp: false,
  allowEmailOtp: true
};

const hashRefreshToken = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

const buildEncryptionKey = () => crypto.createHash("sha256").update(env.JWT_REFRESH_SECRET).digest();

const encryptSecret = (plainText: string): string => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", buildEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${iv.toString("base64")}.${authTag.toString("base64")}.${encrypted.toString("base64")}`;
};

const decryptSecret = (cipherText: string): string => {
  const [ivB64, tagB64, encryptedB64] = cipherText.split(".");
  if (!ivB64 || !tagB64 || !encryptedB64) {
    throw badRequest("Stored authenticator secret is invalid");
  }

  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(tagB64, "base64");
  const encrypted = Buffer.from(encryptedB64, "base64");

  const decipher = crypto.createDecipheriv("aes-256-gcm", buildEncryptionKey(), iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);

  return decrypted.toString("utf8");
};

const resolveDeviceName = (userAgent?: string | null): string => {
  if (!userAgent) return "Unknown device";

  const normalized = userAgent.toLowerCase();

  const browser = normalized.includes("edg/") || normalized.includes("edge/")
    ? "Edge"
    : normalized.includes("opr/") || normalized.includes("opera")
      ? "Opera"
      : normalized.includes("firefox/") || normalized.includes("fxios/")
        ? "Firefox"
        : normalized.includes("chrome/") || normalized.includes("crios/")
          ? "Chrome"
          : normalized.includes("safari/") && !normalized.includes("chrome/") && !normalized.includes("crios/")
            ? "Safari"
            : normalized.includes("postmanruntime")
              ? "Postman"
              : normalized.includes("insomnia")
                ? "Insomnia"
                : "Browser";

  const os = normalized.includes("windows")
    ? "Windows"
    : normalized.includes("mac os x") || normalized.includes("macintosh")
      ? "MacOS"
      : normalized.includes("android")
        ? "Android"
        : normalized.includes("iphone") || normalized.includes("ipad") || normalized.includes("ios")
          ? "iOS"
          : normalized.includes("linux")
            ? "Linux"
            : "OS";

  return `${browser} / ${os}`;
};

const extractClientIp = (requestMeta?: { headers?: Record<string, unknown>; ip?: string | null }): string | null => {
  const forwarded = requestMeta?.headers?.["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    return forwarded.split(",")[0]?.trim() ?? null;
  }

  const realIp = requestMeta?.headers?.["x-real-ip"];
  if (typeof realIp === "string" && realIp.length > 0) {
    return realIp.trim();
  }

  return requestMeta?.ip ?? null;
};

const isIpAllowed = (ip: string, allowlist: string[]): boolean => {
  if (!ip || allowlist.length === 0) return false;

  return allowlist.some((entry) => {
    const value = entry.trim();
    if (value === ip) return true;

    if (!value.includes("/")) return false;

    const [base, maskBitsRaw] = value.split("/");
    const maskBits = Number(maskBitsRaw);
    if (!base || Number.isNaN(maskBits) || maskBits < 0 || maskBits > 32) return false;

    const toInt = (part: string) => {
      const octets = part.split(".").map(Number);
      if (octets.length !== 4 || octets.some((octet) => Number.isNaN(octet) || octet < 0 || octet > 255)) {
        return null;
      }

      return ((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0;
    };

    const ipInt = toInt(ip);
    const baseInt = toInt(base);
    if (ipInt === null || baseInt === null) return false;

    const mask = maskBits === 0 ? 0 : (0xffffffff << (32 - maskBits)) >>> 0;
    return (ipInt & mask) === (baseInt & mask);
  });
};

const validatePasswordAgainstPolicy = (
  password: string,
  policy: {
    minPasswordLength: number;
    requireUppercase: boolean;
    requireLowercase: boolean;
    requireNumber: boolean;
    requireSpecialCharacter: boolean;
  }
) => {
  if (password.length < policy.minPasswordLength) {
    throw badRequest(`Password must be at least ${policy.minPasswordLength} characters long`);
  }

  if (policy.requireUppercase && !/[A-Z]/.test(password)) {
    throw badRequest("Password must include at least one uppercase letter");
  }

  if (policy.requireLowercase && !/[a-z]/.test(password)) {
    throw badRequest("Password must include at least one lowercase letter");
  }

  if (policy.requireNumber && !/[0-9]/.test(password)) {
    throw badRequest("Password must include at least one number");
  }

  if (policy.requireSpecialCharacter && !/[^A-Za-z0-9]/.test(password)) {
    throw badRequest("Password must include at least one special character");
  }
};

const getSecurityPolicyForOrganization = async (organizationId: string) => {
  const [policy, globalPolicy] = await Promise.all([
    prismaAny.securityPolicy.findUnique({ where: { organizationId } }),
    getGlobalPasswordPolicy()
  ]);
  if (!policy) return {
    ...defaultSecurityPolicy,
    minPasswordLength: globalPolicy.minimumLength,
    passwordExpiryDays: globalPolicy.passwordExpiryDays,
    lockoutMaxAttempts: globalPolicy.accountLockoutAttempts,
    requireUppercase: globalPolicy.requireUppercase,
    requireLowercase: globalPolicy.requireLowercase,
    requireNumber: globalPolicy.requireNumber,
    requireSpecialCharacter: globalPolicy.requireSpecialCharacter
  };

  return {
    minPasswordLength: globalPolicy.minimumLength,
    passwordExpiryDays: globalPolicy.passwordExpiryDays,
    lockoutMaxAttempts: globalPolicy.accountLockoutAttempts,
    requireUppercase: globalPolicy.requireUppercase,
    requireLowercase: globalPolicy.requireLowercase,
    requireNumber: globalPolicy.requireNumber,
    requireSpecialCharacter: globalPolicy.requireSpecialCharacter,
    ipAllowlistEnabled: policy.ipAllowlistEnabled,
    twoFactorEnabled: policy.twoFactorEnabled,
    enforceTwoFactorForAllUsers: policy.enforceTwoFactorForAllUsers,
    allowAuthenticatorApp: policy.allowAuthenticatorApp,
    allowSmsOtp: policy.allowSmsOtp,
    allowEmailOtp: policy.allowEmailOtp
  };
};

const logAuthEvent = async (input: {
  organizationId: string;
  userId?: string | null;
  emailAttempted?: string;
  eventType: string;
  status: string;
  reasonCode?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  deviceName?: string | null;
}) => {
  await prismaAny.authEvent.create({
    data: {
      organizationId: input.organizationId,
      userId: input.userId ?? null,
      emailAttempted: input.emailAttempted,
      eventType: input.eventType,
      status: input.status,
      reasonCode: input.reasonCode,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
      deviceName: input.deviceName ?? resolveDeviceName(input.userAgent)
    }
  });
};

const signTokens = (user: { id: string; organizationId: string }) => ({
  accessToken: jwt.sign({ organizationId: user.organizationId }, env.JWT_ACCESS_SECRET, {
    subject: user.id,
    expiresIn: env.JWT_ACCESS_EXPIRES_IN as jwt.SignOptions["expiresIn"]
  }),
  refreshToken: jwt.sign({ organizationId: user.organizationId }, env.JWT_REFRESH_SECRET, {
    subject: user.id,
    expiresIn: env.JWT_REFRESH_EXPIRES_IN as jwt.SignOptions["expiresIn"]
  })
});

const normalizeEmail = (email: string) => email.trim().toLowerCase();

const generateSixDigitOtp = () => String(Math.floor(100000 + Math.random() * 900000));

const slugify = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

const buildUniqueOrganizationSlug = async (
  tx: Prisma.TransactionClient,
  organizationName: string,
  providedSlug?: string
) => {
  const base = slugify(providedSlug && providedSlug.length > 0 ? providedSlug : organizationName) || "org";

  let candidate = base;
  let sequence = 1;

  while (await tx.organization.findUnique({ where: { slug: candidate } })) {
    sequence += 1;
    candidate = `${base}-${sequence}`;
  }

  return candidate;
};

const resolveUserByEmailAndOrganization = async (email: string, organizationSlug?: string) => {
  const normalizedEmail = normalizeEmail(email);

  if (organizationSlug) {
    const organization = await prisma.organization.findUnique({
      where: { slug: organizationSlug }
    });
    if (!organization) throw unauthorized("Invalid credentials");

    const user = await prisma.user.findUnique({
      where: {
        organizationId_email: {
          organizationId: organization.id,
          email: normalizedEmail
        }
      },
      include: {
        role: true,
        organization: true,
        employee: {
          select: {
            phone: true
          }
        },
        twoFactor: true
      }
    });

    return user;
  }

  const users = await prisma.user.findMany({
    where: { email: normalizedEmail },
    include: {
      role: true,
      organization: true,
      employee: {
        select: {
          phone: true
        }
      },
      twoFactor: true
    },
    take: 2
  });

  if (users.length > 1) {
    throw badRequest("Multiple organizations found for this email. Provide organizationSlug.");
  }

  return users[0] ?? null;
};

const signPasswordResetToken = (payload: { userId: string; otpId: string }) => {
  return jwt.sign({ purpose: "password-reset", otpId: payload.otpId }, env.JWT_REFRESH_SECRET, {
    subject: payload.userId,
    expiresIn: RESET_TOKEN_TTL
  });
};

const signLoginChallengeToken = (payload: { userId: string; challengeId: string }) => {
  return jwt.sign({ purpose: "login-2fa", challengeId: payload.challengeId }, env.JWT_REFRESH_SECRET, {
    subject: payload.userId,
    expiresIn: LOGIN_2FA_TOKEN_TTL
  });
};

const signAuthenticatorSetupToken = (payload: { userId: string; secret: string }) => {
  return jwt.sign({ purpose: "2fa-authenticator-setup", secret: payload.secret }, env.JWT_REFRESH_SECRET, {
    subject: payload.userId,
    expiresIn: AUTHENTICATOR_SETUP_TOKEN_TTL
  });
};

const resolveUserTwoFactorContact = (user: any): string | null => {
  if (user?.twoFactor?.phoneNumber) return user.twoFactor.phoneNumber;
  if (user?.employee?.phone) return user.employee.phone;
  return null;
};

const resolveEnabledMethods = (input: {
  policy: {
    allowAuthenticatorApp: boolean;
    allowSmsOtp: boolean;
    allowEmailOtp: boolean;
  };
  user: any;
}): TwoFactorMethod[] => {
  const enabled: TwoFactorMethod[] = [];

  if (
    input.policy.allowAuthenticatorApp &&
    Boolean(input.user?.twoFactor?.authenticatorEnabled && input.user?.twoFactor?.authenticatorSecretEnc)
  ) {
    enabled.push("AUTHENTICATOR_APP");
  }

  if (input.policy.allowSmsOtp && resolveUserTwoFactorContact(input.user)) {
    enabled.push("SMS_OTP");
  }

  if (input.policy.allowEmailOtp && input.user?.email) {
    enabled.push("EMAIL_OTP");
  }

  return enabled;
};

const completeLoginSuccess = async (
  user: {
    id: string;
    organizationId: string;
    email: string;
    firstName: string;
    lastName: string;
    role: { name: string };
  },
  requestMeta?: { headers?: Record<string, unknown>; ip?: string | null }
) => {
  const clientIp = extractClientIp(requestMeta);
  const clientUserAgent = typeof requestMeta?.headers?.["user-agent"] === "string" ? requestMeta.headers["user-agent"] : null;

  const tokens = signTokens(user);

  const updatedUser = await prismaAny.user.update({
    where: { id: user.id },
    data: {
      lastLoginAt: new Date(),
      failedLoginAttempts: 0,
      lockedUntil: null
    } as any
  });

  await prismaAny.$transaction([
    prismaAny.userSession.updateMany({
      where: {
        organizationId: user.organizationId,
        userId: user.id,
        revokedAt: null,
        isCurrent: true
      },
      data: {
        isCurrent: false
      }
    }),
    prismaAny.userSession.create({
      data: {
        organizationId: user.organizationId,
        userId: user.id,
        refreshTokenHash: hashRefreshToken(tokens.refreshToken),
        userAgent: clientUserAgent,
        deviceName: resolveDeviceName(clientUserAgent),
        ipAddress: clientIp,
        isCurrent: true,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      }
    })
  ]);

  await logAuthEvent({
    organizationId: user.organizationId,
    userId: user.id,
    emailAttempted: user.email,
    eventType: "LOGIN_SUCCESS",
    status: "SUCCESS",
    ipAddress: clientIp,
    userAgent: clientUserAgent
  });

  return {
    user: {
      id: user.id,
      organizationId: user.organizationId,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role.name,
      lastLoginAt: updatedUser.lastLoginAt
    },
    tokens
  };
};

export const registerOrganization = async (input: z.infer<typeof registerOrganizationSchema>) => {
  const globalPasswordPolicy = await getGlobalPasswordPolicy();
  validatePasswordAgainstPolicy(input.admin.password, {
    minPasswordLength: globalPasswordPolicy.minimumLength,
    requireUppercase: globalPasswordPolicy.requireUppercase,
    requireLowercase: globalPasswordPolicy.requireLowercase,
    requireNumber: globalPasswordPolicy.requireNumber,
    requireSpecialCharacter: globalPasswordPolicy.requireSpecialCharacter
  });
  const passwordHash = await bcrypt.hash(input.admin.password, 12);
  const adminFirstName = input.admin.firstName?.trim() || "Owner";
  const adminLastName = input.admin.lastName?.trim() || "Admin";
  const adminEmail = normalizeEmail(input.admin.email);

  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    if (env.AUTH_ENFORCE_UNIQUE_EMAIL) {
      const existingEmailUser = await tx.user.findFirst({ where: { email: adminEmail } });
      if (existingEmailUser) {
        throw badRequest("Email already exists. Use login or a different email.");
      }
    }

    const slug = await buildUniqueOrganizationSlug(tx, input.organization.name, input.organization.slug);

    const organization = await tx.organization.create({
      data: {
        ...input.organization,
        slug
      }
    });

    await tx.permission.createMany({
      data: permissions.map((key) => ({ key, description: key.replace(/:/g, " ") })),
      skipDuplicates: true
    });

    const allPermissions = await tx.permission.findMany({
      where: { key: { in: [...permissions] } }
    });

    const role = await tx.role.create({
      data: {
        organizationId: organization.id,
        name: "Owner",
        isSystem: true,
        permissions: {
          create: allPermissions.map((permission: { id: string }) => ({
            permissionId: permission.id
          }))
        }
      }
    });

    const user = await tx.user.create({
      data: {
        organizationId: organization.id,
        roleId: role.id,
        email: adminEmail,
        firstName: adminFirstName,
        lastName: adminLastName,
        profileImageUrl: input.organization.profileImageUrl,
        passwordHash
      }
    });

    const trialPlan = billingPlans[0];
    await tx.systemConfig.create({
      data: {
        organizationId: organization.id,
        key: "billing.subscription",
        value: {
          planKey: trialPlan.key,
          status: "TRIAL",
          billingCycle: "MONTHLY",
          currency: organization.currency,
          trialStartedAt: new Date().toISOString()
        }
      }
    });
    await tx.systemConfig.createMany({
      data: billingModuleKeys.map((moduleKey) => ({
        organizationId: organization.id,
        key: `module.${moduleKey}.status`,
        value: "INACTIVE"
      }))
    });

    return {
      organization,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName
      },
      subscription: {
        planKey: trialPlan.key,
        status: "TRIAL",
        activeModules: []
      },
      tokens: signTokens(user)
    };
  });
};

export const login = async (
  input: z.infer<typeof loginSchema>,
  requestMeta?: { headers?: Record<string, unknown>; ip?: string | null }
) => {
  const user = await resolveUserByEmailAndOrganization(input.email, input.organizationSlug);
  if (!user || !user.isActive) throw unauthorized("Invalid credentials");

  const clientIp = extractClientIp(requestMeta);
  const clientUserAgent = typeof requestMeta?.headers?.["user-agent"] === "string" ? requestMeta.headers["user-agent"] : null;

  const securityPolicy = await getSecurityPolicyForOrganization(user.organizationId);

  if (securityPolicy.ipAllowlistEnabled) {
    const allowedIps = await prismaAny.ipAllowlistEntry.findMany({
      where: { organizationId: user.organizationId },
      select: { value: true }
    });

    const allowed = clientIp ? isIpAllowed(clientIp, allowedIps.map((entry: any) => entry.value)) : false;
    if (!allowed) {
      await logAuthEvent({
        organizationId: user.organizationId,
        userId: user.id,
        emailAttempted: input.email,
        eventType: "LOGIN_FAILED",
        status: "BLOCKED",
        reasonCode: "IP_NOT_ALLOWED",
        ipAddress: clientIp,
        userAgent: clientUserAgent
      });
      throw unauthorized("Login blocked by organization IP allowlist policy");
    }
  }

  if ((user as any).lockedUntil && (user as any).lockedUntil > new Date()) {
    await logAuthEvent({
      organizationId: user.organizationId,
      userId: user.id,
      emailAttempted: input.email,
      eventType: "LOGIN_FAILED",
      status: "BLOCKED",
      reasonCode: "ACCOUNT_LOCKED",
      ipAddress: clientIp,
      userAgent: clientUserAgent
    });
    throw unauthorized("Account is temporarily locked due to too many failed login attempts");
  }

  const passwordOk = await bcrypt.compare(input.password, user.passwordHash);
  if (!passwordOk) {
    const nextAttempts = ((user as any).failedLoginAttempts ?? 0) + 1;
    const shouldLock = nextAttempts >= securityPolicy.lockoutMaxAttempts;

    await prismaAny.user.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts: shouldLock ? 0 : nextAttempts,
        lockedUntil: shouldLock ? new Date(Date.now() + 15 * 60 * 1000) : null
      } as any
    });

    await logAuthEvent({
      organizationId: user.organizationId,
      userId: user.id,
      emailAttempted: input.email,
      eventType: "LOGIN_FAILED",
      status: shouldLock ? "BLOCKED" : "FAILED",
      reasonCode: shouldLock ? "ACCOUNT_LOCKED" : "INVALID_PASSWORD",
      ipAddress: clientIp,
      userAgent: clientUserAgent
    });

    throw unauthorized("Invalid credentials");
  }
  if (user.organization.status !== "ACTIVE") throw badRequest("Organization is not active");

  const passwordAgeMs = Date.now() - new Date((user as any).passwordChangedAt).getTime();
  const passwordAgeDays = Math.floor(passwordAgeMs / (24 * 60 * 60 * 1000));
  if (securityPolicy.passwordExpiryDays !== null && passwordAgeDays >= securityPolicy.passwordExpiryDays) {
    await logAuthEvent({
      organizationId: user.organizationId,
      userId: user.id,
      emailAttempted: input.email,
      eventType: "LOGIN_FAILED",
      status: "BLOCKED",
      reasonCode: "PASSWORD_EXPIRED",
      ipAddress: clientIp,
      userAgent: clientUserAgent
    });
    throw unauthorized("Password has expired. Reset your password to continue.");
  }

  if (securityPolicy.twoFactorEnabled) {
    const enabledMethods = resolveEnabledMethods({
      policy: securityPolicy,
      user
    });
    const shouldRequireTwoFactor = securityPolicy.enforceTwoFactorForAllUsers || enabledMethods.length > 0;

    if (shouldRequireTwoFactor && enabledMethods.length === 0) {
      throw badRequest("Two-factor authentication is required but no usable method is configured for this account");
    }

    if (!shouldRequireTwoFactor) {
      return completeLoginSuccess(
        {
          id: user.id,
          organizationId: user.organizationId,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: { name: user.role.name }
        },
        requestMeta
      );
    }

    const requestedMethod = input.twoFactorMethod as TwoFactorMethod | undefined;
    const preferredMethod = ((user as any)?.twoFactor?.preferredMethod as TwoFactorMethod | null) ?? null;

    const selectedMethod = requestedMethod
      ? enabledMethods.includes(requestedMethod)
        ? requestedMethod
        : null
      : preferredMethod && enabledMethods.includes(preferredMethod)
        ? preferredMethod
        : enabledMethods[0];

    if (!selectedMethod) {
      throw badRequest("Requested 2FA method is not available for this account");
    }

    const expiresAt = new Date(Date.now() + LOGIN_2FA_OTP_TTL_MINUTES * 60 * 1000);
    const otp = generateSixDigitOtp();
    const codeHash = await bcrypt.hash(otp, 10);

    await prismaAny.authChallenge.updateMany({
      where: {
        organizationId: user.organizationId,
        userId: user.id,
        purpose: "LOGIN_2FA",
        consumedAt: null
      },
      data: {
        consumedAt: new Date()
      }
    });

    const challenge = await prismaAny.authChallenge.create({
      data: {
        organizationId: user.organizationId,
        userId: user.id,
        purpose: "LOGIN_2FA",
        method: selectedMethod,
        codeHash,
        maxAttempts: LOGIN_2FA_MAX_ATTEMPTS,
        expiresAt
      }
    });

    if (selectedMethod === "EMAIL_OTP") {
      await sendLoginOtpEmail({
        to: user.email,
        otp,
        expiresInMinutes: LOGIN_2FA_OTP_TTL_MINUTES,
        organizationName: user.organization.name
      });
    }

    if (selectedMethod === "SMS_OTP") {
      const phone = resolveUserTwoFactorContact(user);
      if (!phone) throw badRequest("No mobile number configured for SMS 2FA");

      await sendLoginSmsOtp({
        to: phone,
        otp,
        expiresInMinutes: LOGIN_2FA_OTP_TTL_MINUTES
      });
    }

    await logAuthEvent({
      organizationId: user.organizationId,
      userId: user.id,
      emailAttempted: input.email,
      eventType: "LOGIN_2FA_CHALLENGE",
      status: "SUCCESS",
      ipAddress: clientIp,
      userAgent: clientUserAgent
    });

    const challengeToken = signLoginChallengeToken({ userId: user.id, challengeId: challenge.id });

    if (env.NODE_ENV !== "production") {
      const otpLogPart = selectedMethod === "AUTHENTICATOR_APP" ? "" : ` otp=${otp}`;
      console.log(
        `[dev-auth] login-2fa user=${user.email} method=${selectedMethod} challengeToken=${challengeToken}${otpLogPart} expiresInSeconds=${LOGIN_2FA_OTP_TTL_MINUTES * 60}`
      );
    }

    return {
      requiresTwoFactor: true,
      method: selectedMethod,
      availableMethods: enabledMethods,
      challengeToken,
      expiresInSeconds: LOGIN_2FA_OTP_TTL_MINUTES * 60,
      ...(env.NODE_ENV !== "production" && selectedMethod === "EMAIL_OTP" && !env.SMTP_HOST
        ? { devOtp: otp }
        : {}),
      ...(env.NODE_ENV !== "production" && selectedMethod === "SMS_OTP" && !env.SMS_WEBHOOK_URL
        ? { devOtp: otp }
        : {})
    };
  }

  return completeLoginSuccess(
    {
      id: user.id,
      organizationId: user.organizationId,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: { name: user.role.name }
    },
    requestMeta
  );
};

export const forgotPassword = async (input: z.infer<typeof forgotPasswordSchema>) => {
  const user = await resolveUserByEmailAndOrganization(input.email, input.organizationSlug);
  if (!user || !user.isActive || user.organization.status !== "ACTIVE") {
    throw badRequest("No active account found for the supplied email");
  }

  const otp = generateSixDigitOtp();
  const codeHash = await bcrypt.hash(otp, 10);
  const expiresAt = new Date(Date.now() + RESET_OTP_TTL_MINUTES * 60 * 1000);

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.passwordResetOtp.updateMany({
      where: {
        userId: user.id,
        consumedAt: null
      },
      data: {
        consumedAt: new Date()
      }
    });

    await tx.passwordResetOtp.create({
      data: {
        userId: user.id,
        codeHash,
        expiresAt
      }
    });
  });

  await sendPasswordResetOtpEmail({
    to: user.email,
    otp,
    expiresInMinutes: RESET_OTP_TTL_MINUTES,
    organizationName: user.organization.name
  });

  return {
    message: "OTP sent successfully",
    expiresInSeconds: RESET_OTP_TTL_MINUTES * 60
  };
};

export const resendPasswordOtp = async (input: z.infer<typeof forgotPasswordSchema>) => {
  return forgotPassword(input);
};

export const verifyResetOtp = async (input: z.infer<typeof verifyResetOtpSchema>) => {
  const user = await resolveUserByEmailAndOrganization(input.email, input.organizationSlug);
  if (!user || !user.isActive || user.organization.status !== "ACTIVE") {
    throw badRequest("No active account found for the supplied email");
  }

  const otpRecord = await prisma.passwordResetOtp.findFirst({
    where: {
      userId: user.id,
      consumedAt: null
    },
    orderBy: { createdAt: "desc" }
  });

  if (!otpRecord || otpRecord.expiresAt < new Date()) {
    throw badRequest("OTP is invalid or has expired");
  }

  if (otpRecord.attempts >= RESET_OTP_MAX_ATTEMPTS) {
    throw badRequest("Maximum OTP attempts exceeded. Request a new OTP.");
  }

  const isMatch = await bcrypt.compare(input.otp, otpRecord.codeHash);
  if (!isMatch) {
    await prisma.passwordResetOtp.update({
      where: { id: otpRecord.id },
      data: { attempts: { increment: 1 } }
    });
    throw badRequest("OTP is invalid or has expired");
  }

  const verifiedOtp = await prisma.passwordResetOtp.update({
    where: { id: otpRecord.id },
    data: { verifiedAt: new Date() }
  });

  return {
    message: "OTP verified successfully",
    resetToken: signPasswordResetToken({ userId: user.id, otpId: verifiedOtp.id })
  };
};

export const resetPassword = async (input: z.infer<typeof resetPasswordSchema>) => {
  let decoded: jwt.JwtPayload;

  try {
    decoded = jwt.verify(input.resetToken, env.JWT_REFRESH_SECRET) as jwt.JwtPayload;
  } catch {
    throw badRequest("Reset token is invalid or expired");
  }

  const userId = decoded.sub;
  const otpId = typeof decoded.otpId === "string" ? decoded.otpId : null;
  if (!userId || decoded.purpose !== "password-reset" || !otpId) {
    throw badRequest("Reset token is invalid or expired");
  }

  const otpRecord = await prisma.passwordResetOtp.findFirst({
    where: {
      id: otpId,
      userId,
      consumedAt: null
    }
  });

  if (!otpRecord || !otpRecord.verifiedAt || otpRecord.expiresAt < new Date()) {
    throw badRequest("Reset token is invalid or expired");
  }

  const resetUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { organizationId: true }
  });

  if (!resetUser) {
    throw badRequest("Reset token is invalid or expired");
  }

  const securityPolicy = await getSecurityPolicyForOrganization(resetUser.organizationId);
  validatePasswordAgainstPolicy(input.password, securityPolicy);

  const passwordHash = await bcrypt.hash(input.password, 12);

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.user.update({
      where: { id: userId },
      data: { passwordHash, passwordChangedAt: new Date() }
    });

    await tx.passwordResetOtp.updateMany({
      where: {
        userId,
        consumedAt: null
      },
      data: {
        consumedAt: new Date()
      }
    });
  });

  return {
    message: "Password reset successful"
  };
};

export const acceptTenantAdminInvitation = async (input: z.infer<typeof acceptTenantInvitationSchema>) => {
  const invitation = await prisma.agentInvitation.findFirst({ where: { token: input.token, status: "PENDING", expiresAt: { gt: new Date() } }, include: { organization: { select: { id: true, name: true, slug: true, status: true } }, role: { select: { id: true, name: true } } } });
  if (!invitation || invitation.organization.status !== "ACTIVE") throw badRequest("Invitation is invalid or expired");
  const user = await prisma.user.findFirst({ where: { organizationId: invitation.organizationId, email: invitation.email, roleId: invitation.roleId ?? undefined, isActive: true }, select: { id: true } });
  if (!user) throw badRequest("Invitation is invalid or expired");
  const securityPolicy = await getSecurityPolicyForOrganization(invitation.organizationId);
  validatePasswordAgainstPolicy(input.password, securityPolicy);
  const passwordHash = await bcrypt.hash(input.password, 12); const acceptedAt = new Date();
  await prisma.$transaction(async (tx) => {
    const consumed = await tx.agentInvitation.updateMany({ where: { id: invitation.id, status: "PENDING", expiresAt: { gt: acceptedAt } }, data: { status: "ACCEPTED", acceptedAt } });
    if (consumed.count !== 1) throw badRequest("Invitation is invalid or expired");
    await tx.user.update({ where: { id: user.id }, data: { passwordHash, passwordChangedAt: acceptedAt } });
    await tx.userSession.updateMany({ where: { organizationId: invitation.organizationId, userId: user.id, revokedAt: null }, data: { revokedAt: acceptedAt, revokeReason: "Tenant invitation password established" } });
  });
  await createAuditLog({ organizationId: invitation.organizationId, actorUserId: user.id, action: "TENANT_ADMIN_INVITATION_ACCEPTED", resource: "INVITATION", resourceId: invitation.id, summary: "Tenant Admin accepted workspace invitation", metadata: { userId: user.id } });
  return { message: "Tenant Admin password created successfully", organization: { name: invitation.organization.name, slug: invitation.organization.slug }, email: invitation.email };
};

export const getTwoFactorStatus = async (userId?: string) => {
  if (!userId) throw unauthorized();

  const user = await prismaAny.user.findUnique({
    where: { id: userId },
    include: {
      twoFactor: true,
      employee: {
        select: {
          phone: true
        }
      }
    }
  });

  if (!user) throw unauthorized();

  return {
    authenticatorEnabled: Boolean(user.twoFactor?.authenticatorEnabled),
    preferredMethod: (user.twoFactor?.preferredMethod as TwoFactorMethod | null) ?? null,
    hasPhoneNumber: Boolean(resolveUserTwoFactorContact(user)),
    phoneNumber: resolveUserTwoFactorContact(user),
    hasEmail: Boolean(user.email)
  };
};

export const beginAuthenticatorSetup = async (
  userId: string | undefined,
  input: z.infer<typeof beginAuthenticatorSetupSchema>
) => {
  if (!userId) throw unauthorized();

  const user = await prismaAny.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      organization: {
        select: {
          slug: true,
          name: true
        }
      }
    }
  });

  if (!user) throw unauthorized();

  const { generateSecret, generateURI } = await loadOtpLibrary();
  const secret = generateSecret();
  const accountName = input.accountName ?? user.email;
  const issuer = `${env.APP_NAME} (${user.organization.slug})`;
  const otpauthUrl = generateURI({
    issuer,
    label: accountName,
    secret
  });

  return {
    setupToken: signAuthenticatorSetupToken({ userId, secret }),
    manualEntryKey: secret,
    otpauthUrl,
    message: "Scan the QR URL with your authenticator app and verify with a generated code"
  };
};

export const enableAuthenticator = async (
  userId: string | undefined,
  input: z.infer<typeof enableAuthenticatorSchema>
) => {
  if (!userId) throw unauthorized();

  let decoded: jwt.JwtPayload;

  try {
    decoded = jwt.verify(input.setupToken, env.JWT_REFRESH_SECRET) as jwt.JwtPayload;
  } catch {
    throw badRequest("Setup token is invalid or expired");
  }

  const setupUserId = decoded.sub;
  const secret = typeof decoded.secret === "string" ? decoded.secret : null;
  if (decoded.purpose !== "2fa-authenticator-setup" || !setupUserId || !secret || setupUserId !== userId) {
    throw badRequest("Setup token is invalid or expired");
  }

  const { verifySync } = await loadOtpLibrary();
  const verified = verifySync({ token: input.otp, secret }).valid;
  if (!verified) {
    throw badRequest("Invalid authenticator code");
  }

  const record = await prismaAny.userTwoFactor.upsert({
    where: { userId },
    create: {
      userId,
      authenticatorEnabled: true,
      authenticatorSecretEnc: encryptSecret(secret),
      preferredMethod: "AUTHENTICATOR_APP"
    },
    update: {
      authenticatorEnabled: true,
      authenticatorSecretEnc: encryptSecret(secret),
      preferredMethod: "AUTHENTICATOR_APP"
    }
  });

  return {
    message: "Authenticator app enabled",
    authenticatorEnabled: record.authenticatorEnabled,
    preferredMethod: record.preferredMethod
  };
};

export const disableAuthenticator = async (
  userId: string | undefined,
  input: z.infer<typeof disableAuthenticatorSchema>
) => {
  if (!userId) throw unauthorized();

  const record = await prismaAny.userTwoFactor.findUnique({
    where: { userId }
  });

  if (!record?.authenticatorEnabled || !record.authenticatorSecretEnc) {
    throw badRequest("Authenticator app is not enabled for this account");
  }

  const secret = decryptSecret(record.authenticatorSecretEnc);
  const { verifySync } = await loadOtpLibrary();
  const verified = verifySync({ token: input.otp, secret }).valid;
  if (!verified) {
    throw badRequest("Invalid authenticator code");
  }

  const updated = await prismaAny.userTwoFactor.update({
    where: { userId },
    data: {
      authenticatorEnabled: false,
      authenticatorSecretEnc: null,
      preferredMethod: record.preferredMethod === "AUTHENTICATOR_APP" ? null : record.preferredMethod
    }
  });

  return {
    message: "Authenticator app disabled",
    authenticatorEnabled: updated.authenticatorEnabled,
    preferredMethod: updated.preferredMethod
  };
};

export const updatePreferredTwoFactorMethod = async (
  userId: string | undefined,
  input: z.infer<typeof updatePreferredTwoFactorMethodSchema>
) => {
  if (!userId) throw unauthorized();

  const user = await prismaAny.user.findUnique({
    where: { id: userId },
    include: {
      twoFactor: true,
      employee: {
        select: {
          phone: true
        }
      },
      organization: {
        select: {
          id: true
        }
      }
    }
  });

  if (!user) throw unauthorized();

  const policy = await getSecurityPolicyForOrganization(user.organization.id);
  const virtualUser = {
    ...user,
    twoFactor: {
      ...(user.twoFactor ?? {}),
      phoneNumber: input.phoneNumber ?? user.twoFactor?.phoneNumber ?? null
    }
  };

  const enabledMethods = resolveEnabledMethods({
    policy,
    user: virtualUser
  });

  if (!enabledMethods.includes(input.method)) {
    throw badRequest("Requested preferred method is not available for this account");
  }

  const record = await prismaAny.userTwoFactor.upsert({
    where: { userId },
    create: {
      userId,
      phoneNumber: input.phoneNumber,
      preferredMethod: input.method
    },
    update: {
      ...(input.phoneNumber ? { phoneNumber: input.phoneNumber } : {}),
      preferredMethod: input.method
    }
  });

  return {
    message: "Preferred two-factor method updated",
    preferredMethod: record.preferredMethod,
    phoneNumber: record.phoneNumber
  };
};

export const verifyLoginTwoFactor = async (
  input: z.infer<typeof verifyLoginTwoFactorSchema>,
  requestMeta?: { headers?: Record<string, unknown>; ip?: string | null }
) => {
  let decoded: jwt.JwtPayload;

  try {
    decoded = jwt.verify(input.challengeToken, env.JWT_REFRESH_SECRET) as jwt.JwtPayload;
  } catch {
    throw badRequest("2FA challenge token is invalid or expired");
  }

  const userId = decoded.sub;
  const challengeId = typeof decoded.challengeId === "string" ? decoded.challengeId : null;
  if (!userId || decoded.purpose !== "login-2fa" || !challengeId) {
    throw badRequest("2FA challenge token is invalid or expired");
  }

  const challenge = await prismaAny.authChallenge.findFirst({
    where: {
      id: challengeId,
      userId,
      purpose: "LOGIN_2FA",
      consumedAt: null
    }
  });

  if (!challenge || challenge.expiresAt < new Date()) {
    throw badRequest("2FA challenge has expired");
  }

  if (challenge.attempts >= challenge.maxAttempts) {
    throw badRequest("Maximum 2FA attempts exceeded. Please login again.");
  }

  let valid = false;

  if (challenge.method === "AUTHENTICATOR_APP") {
    const twoFactor = await prismaAny.userTwoFactor.findUnique({
      where: { userId }
    });

    if (!twoFactor?.authenticatorEnabled || !twoFactor.authenticatorSecretEnc) {
      throw badRequest("Authenticator app is not configured for this account");
    }

    const secret = decryptSecret(twoFactor.authenticatorSecretEnc);
    const { verifySync } = await loadOtpLibrary();
    valid = verifySync({ token: input.otp, secret }).valid;
  } else {
    valid = await bcrypt.compare(input.otp, challenge.codeHash);
  }

  if (!valid) {
    await prismaAny.authChallenge.update({
      where: { id: challenge.id },
      data: { attempts: { increment: 1 } }
    });
    throw badRequest("Invalid verification code");
  }

  await prismaAny.authChallenge.update({
    where: { id: challenge.id },
    data: { consumedAt: new Date() }
  });

  const user = await prisma.user.findFirst({
    where: {
      id: userId,
      organizationId: challenge.organizationId,
      isActive: true
    },
    include: {
      role: true,
      organization: { select: { status: true } }
    }
  });

  if (!user) {
    throw unauthorized("Invalid credentials");
  }
  if (!user.isPlatformAdmin && user.organization.status !== "ACTIVE") {
    throw unauthorized("Organization access is suspended");
  }

  return completeLoginSuccess(
    {
      id: user.id,
      organizationId: user.organizationId,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: { name: user.role.name }
    },
    requestMeta
  );
};
