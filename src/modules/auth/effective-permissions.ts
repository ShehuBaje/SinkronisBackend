import { permissions as permissionCatalog, restrictedPermissions } from "./permissions";

const restrictedPermissionSet = new Set<string>(restrictedPermissions);

export const resolveEffectivePermissions = (role: { name: string; isSystem: boolean; permissions: string[] }) => {
  const grantedPermissions = new Set(role.permissions);
  if (role.isSystem && role.name === "Owner") {
    for (const permission of permissionCatalog) {
      if (!restrictedPermissionSet.has(permission)) grantedPermissions.add(permission);
    }
  }
  return [...grantedPermissions];
};
