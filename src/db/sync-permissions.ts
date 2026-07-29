import { PrismaClient } from "@prisma/client";
import { permissions } from "../modules/auth/permissions";

const prisma = new PrismaClient();

async function main() {
  const canonicalPermissionSet = new Set(permissions);

  await prisma.permission.createMany({
    data: permissions.map((key) => ({ key, description: key.replace(/:/g, " ") })),
    skipDuplicates: true
  });

  const permissionRows = await prisma.permission.findMany({
    where: { key: { in: [...permissions] } },
    select: { id: true, key: true }
  });

  const systemRoles = await prisma.role.findMany({
    where: { isSystem: true },
    select: { id: true, name: true, organizationId: true }
  });

  let assignmentsCreated = 0;
  let legacyAssignmentsRemoved = 0;

  for (const role of systemRoles) {
    const existingRolePermissions = await prisma.rolePermission.findMany({
      where: { roleId: role.id },
      select: {
        roleId: true,
        permissionId: true,
        permission: {
          select: {
            key: true
          }
        }
      }
    });

    const legacyPermissionIds = existingRolePermissions
      .filter((row) => !canonicalPermissionSet.has(row.permission.key as (typeof permissions)[number]))
      .map((row) => row.permissionId);

    if (legacyPermissionIds.length > 0) {
      const removed = await prisma.rolePermission.deleteMany({
        where: {
          roleId: role.id,
          permissionId: {
            in: legacyPermissionIds
          }
        }
      });

      legacyAssignmentsRemoved += removed.count;
    }

    const result = await prisma.rolePermission.createMany({
      data: permissionRows.map((permission) => ({
        roleId: role.id,
        permissionId: permission.id
      })),
      skipDuplicates: true
    });

    assignmentsCreated += result.count;
  }

  console.log(
    JSON.stringify(
      {
        syncedPermissionKeys: permissionRows.length,
        syncedSystemRoles: systemRoles.length,
        newRolePermissionAssignments: assignmentsCreated,
        removedLegacySystemRoleAssignments: legacyAssignmentsRemoved
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
