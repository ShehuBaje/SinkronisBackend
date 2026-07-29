import type { PermissionKey } from "./modules/auth/permissions";

export type AuthUser = {
  id: string;
  organizationId: string;
  email: string;
  roleId: string;
  isPlatformAdmin: boolean;
  impersonation?: {
    sessionId: string;
    platformAdminUserId: string;
  };
  permissions: PermissionKey[];
};

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      organizationId?: string;
    }
  }
}
