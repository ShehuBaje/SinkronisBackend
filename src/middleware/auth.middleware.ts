import jwt from "jsonwebtoken";
import type { RequestHandler } from "express";
import { env } from "../config/env";
import { prisma } from "../core/prisma";
import { unauthorized } from "../core/http-error";
import { permissions as permissionCatalog } from "../modules/auth/permissions";
import type { AuthUser } from "../types";

type JwtPayload = {
  sub: string;
  organizationId: string;
  purpose?: string;
  impersonationSessionId?: string;
  platformAdminUserId?: string;
};

export const canAccessOrganization = (user: { isPlatformAdmin: boolean; organization: { status: string } }) =>
  user.isPlatformAdmin || user.organization.status === "ACTIVE";

export const authenticate: RequestHandler = async (req, _res, next) => {
  const header = req.header("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;

  if (!token) return next(unauthorized("Bearer token is required"));

  try {
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as JwtPayload;
    const user = await prisma.user.findFirst({
      where: {
        id: payload.sub,
        organizationId: payload.organizationId,
        isActive: true
      },
      include: {
        organization: {
          select: { status: true }
        },
        role: {
          include: {
            permissions: {
              include: { permission: true }
            }
          }
        }
      }
    });

    if (!user) return next(unauthorized());
    if (!canAccessOrganization(user)) {
      return next(unauthorized("Organization access is suspended"));
    }
    if (payload.purpose === "platform-impersonation") {
      if (!payload.impersonationSessionId || !payload.platformAdminUserId) return next(unauthorized("Invalid impersonation token"));
      const session = await prisma.platformImpersonationSession.findFirst({
        where: {
          id: payload.impersonationSessionId,
          platformAdminUserId: payload.platformAdminUserId,
          tenantAdminUserId: user.id,
          organizationId: user.organizationId,
          status: "ACTIVE",
          endedAt: null,
          expiresAt: { gt: new Date() }
        },
        select: { id: true }
      });
      if (!session) return next(unauthorized("Impersonation session is no longer active"));
    }

    const grantedPermissions = new Set(user.role.permissions.map((item) => item.permission.key));

    // Keep system Owner users forward-compatible with new permission keys.
    if (user.role.isSystem && user.role.name === "Owner") {
      for (const permission of permissionCatalog) {
        grantedPermissions.add(permission);
      }
    }

    req.user = {
      id: user.id,
      organizationId: user.organizationId,
      email: user.email,
      roleId: user.roleId,
      isPlatformAdmin: user.isPlatformAdmin,
      ...(payload.purpose === "platform-impersonation" && payload.impersonationSessionId && payload.platformAdminUserId
        ? { impersonation: { sessionId: payload.impersonationSessionId, platformAdminUserId: payload.platformAdminUserId } }
        : {}),
      permissions: [...grantedPermissions] as AuthUser["permissions"]
    };
    return next();
  } catch {
    return next(unauthorized("Invalid or expired token"));
  }
};
