import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { env } from "../src/config/env";
import { permissions } from "../src/modules/auth/permissions";

const prisma = new PrismaClient();

async function main() {
  await prisma.permission.createMany({
    data: permissions.map((key) => ({ key, description: key.replace(/:/g, " ") })),
    skipDuplicates: true
  });

  const organization = await prisma.organization.upsert({
    where: { slug: "default" },
    update: {},
    create: {
      name: "Default Organization",
      slug: "default",
      email: env.DEFAULT_SUPER_ADMIN_EMAIL,
      currency: "NGN"
    }
  });

  const ownerRole = await prisma.role.upsert({
    where: {
      organizationId_name: {
        organizationId: organization.id,
        name: "Owner"
      }
    },
    update: {},
    create: {
      organizationId: organization.id,
      name: "Owner",
      isSystem: true
    }
  });

  const allPermissions = await prisma.permission.findMany();
  await prisma.rolePermission.createMany({
    data: allPermissions.map((permission) => ({
      roleId: ownerRole.id,
      permissionId: permission.id
    })),
    skipDuplicates: true
  });

  const passwordHash = await bcrypt.hash(env.DEFAULT_SUPER_ADMIN_PASSWORD, 12);
  await prisma.user.upsert({
    where: {
      organizationId_email: {
        organizationId: organization.id,
        email: env.DEFAULT_SUPER_ADMIN_EMAIL
      }
    },
    update: { isPlatformAdmin: true },
    create: {
      organizationId: organization.id,
      roleId: ownerRole.id,
      email: env.DEFAULT_SUPER_ADMIN_EMAIL,
      firstName: "System",
      lastName: "Admin",
      passwordHash,
      isPlatformAdmin: true
    }
  });
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
