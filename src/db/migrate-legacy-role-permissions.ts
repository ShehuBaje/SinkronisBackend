import { PrismaClient } from "@prisma/client";
import { permissions } from "../modules/auth/permissions";

const prisma = new PrismaClient();

const resolveReplacementKeys = (legacyKey: string) => {
  const [module, resource, action] = legacyKey.split(":");

  if (!module || !resource || !action) {
    return [] as string[];
  }

  if (action === "read") {
    const viewKey = `${module}:${resource}:view`;
    return permissions.includes(viewKey as (typeof permissions)[number]) ? [viewKey] : [];
  }

  if (action === "manage") {
    return permissions.filter((permission) => permission.startsWith(`${module}:${resource}:`));
  }

  return [] as string[];
};

async function main() {
  const canonicalPermissionSet = new Set(permissions);

  await prisma.permission.createMany({
    data: permissions.map((key) => ({ key, description: key.replace(/:/g, " ") })),
    skipDuplicates: true
  });

  const allPermissions = await prisma.permission.findMany({
    select: { id: true, key: true }
  });

  const canonicalPermissionIdByKey = new Map(
    allPermissions
      .filter((permission) => canonicalPermissionSet.has(permission.key as (typeof permissions)[number]))
      .map((permission) => [permission.key, permission.id])
  );

  const legacyPermissions = allPermissions.filter((permission) => {
    if (canonicalPermissionSet.has(permission.key as (typeof permissions)[number])) return false;
    return permission.key.endsWith(":manage") || permission.key.endsWith(":read");
  });

  const legacyPermissionIdToReplacementIds = new Map<string, string[]>();

  for (const legacyPermission of legacyPermissions) {
    const replacementKeys = resolveReplacementKeys(legacyPermission.key);
    const replacementIds = replacementKeys
      .map((replacementKey) => canonicalPermissionIdByKey.get(replacementKey))
      .filter((replacementId): replacementId is string => Boolean(replacementId));

    legacyPermissionIdToReplacementIds.set(legacyPermission.id, replacementIds);
  }

  const legacyPermissionIds = legacyPermissions.map((permission) => permission.id);

  if (legacyPermissionIds.length === 0) {
    console.log(
      JSON.stringify(
        {
          touchedRoles: 0,
          newAssignments: 0,
          removedLegacyAssignments: 0,
          status: "No legacy role permissions found"
        },
        null,
        2
      )
    );
    return;
  }

  const legacyRoleAssignments = await prisma.rolePermission.findMany({
    where: {
      permissionId: { in: legacyPermissionIds },
      role: { isSystem: false }
    },
    select: {
      roleId: true,
      permissionId: true,
      role: {
        select: {
          name: true,
          organization: {
            select: { slug: true }
          }
        }
      }
    }
  });

  let newAssignments = 0;

  for (const assignment of legacyRoleAssignments) {
    const replacementIds = legacyPermissionIdToReplacementIds.get(assignment.permissionId) ?? [];

    if (replacementIds.length === 0) continue;

    const createResult = await prisma.rolePermission.createMany({
      data: replacementIds.map((permissionId) => ({
        roleId: assignment.roleId,
        permissionId
      })),
      skipDuplicates: true
    });

    newAssignments += createResult.count;
  }

  const removed = await prisma.rolePermission.deleteMany({
    where: {
      permissionId: { in: legacyPermissionIds },
      role: { isSystem: false }
    }
  });

  const touchedRoleIds = new Set(legacyRoleAssignments.map((assignment) => assignment.roleId));

  console.log(
    JSON.stringify(
      {
        touchedRoles: touchedRoleIds.size,
        newAssignments,
        removedLegacyAssignments: removed.count,
        legacyPermissionKeys: legacyPermissions.map((permission) => permission.key).sort()
      },
      null,
      2
    )
  );
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
