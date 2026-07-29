CREATE TABLE `PlatformImpersonationSession` (
  `id` VARCHAR(191) NOT NULL, `organizationId` VARCHAR(191) NOT NULL,
  `platformAdminUserId` VARCHAR(191) NOT NULL, `tenantAdminUserId` VARCHAR(191) NOT NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'ACTIVE', `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `expiresAt` DATETIME(3) NOT NULL, `endedAt` DATETIME(3) NULL, `ipAddress` VARCHAR(191) NULL, `userAgent` TEXT NULL,
  INDEX `Impersonation_admin_status_expiry_idx`(`platformAdminUserId`, `status`, `expiresAt`),
  INDEX `Impersonation_org_started_idx`(`organizationId`, `startedAt`), PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `SupportTicket` (
  `id` VARCHAR(191) NOT NULL, `organizationId` VARCHAR(191) NOT NULL, `ticketNumber` VARCHAR(191) NOT NULL,
  `subject` VARCHAR(191) NOT NULL, `description` TEXT NULL, `priority` VARCHAR(191) NOT NULL, `status` VARCHAR(191) NOT NULL,
  `assignedToUserId` VARCHAR(191) NULL, `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `SupportTicket_ticketNumber_key`(`ticketNumber`),
  INDEX `SupportTicket_org_updated_idx`(`organizationId`, `updatedAt`),
  INDEX `SupportTicket_org_status_priority_idx`(`organizationId`, `status`, `priority`), PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `PlatformImpersonationSession` ADD CONSTRAINT `Impersonation_org_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `PlatformImpersonationSession` ADD CONSTRAINT `Impersonation_actor_fkey` FOREIGN KEY (`platformAdminUserId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `PlatformImpersonationSession` ADD CONSTRAINT `Impersonation_target_fkey` FOREIGN KEY (`tenantAdminUserId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `SupportTicket` ADD CONSTRAINT `SupportTicket_org_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `SupportTicket` ADD CONSTRAINT `SupportTicket_assignee_fkey` FOREIGN KEY (`assignedToUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
