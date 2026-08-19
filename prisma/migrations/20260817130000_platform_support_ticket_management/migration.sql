ALTER TABLE `SupportTicket`
  ADD COLUMN `resolutionNotes` TEXT NULL,
  ADD COLUMN `openedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  ADD COLUMN `resolvedAt` DATETIME(3) NULL,
  ADD COLUMN `resolvedByUserId` VARCHAR(191) NULL,
  ADD COLUMN `createdByUserId` VARCHAR(191) NULL;

UPDATE `SupportTicket` SET `openedAt` = `createdAt`;
UPDATE `SupportTicket` SET `priority` = 'MEDIUM' WHERE `priority` NOT IN ('MEDIUM', 'HIGH', 'CRITICAL');
UPDATE `SupportTicket` SET `status` = 'OPEN' WHERE `status` = 'PENDING';
UPDATE `SupportTicket` SET `status` = 'RESOLVED', `resolvedAt` = COALESCE(`resolvedAt`, `updatedAt`) WHERE `status` = 'CLOSED';
UPDATE `SupportTicket` SET `status` = 'OPEN' WHERE `status` NOT IN ('OPEN', 'IN_PROGRESS', 'RESOLVED');

CREATE INDEX `SupportTicket_resolvedBy_fkey` ON `SupportTicket`(`resolvedByUserId`);
CREATE INDEX `SupportTicket_createdBy_fkey` ON `SupportTicket`(`createdByUserId`);
CREATE INDEX `SupportTicket_status_updated_idx` ON `SupportTicket`(`status`, `updatedAt`);
CREATE INDEX `SupportTicket_priority_updated_idx` ON `SupportTicket`(`priority`, `updatedAt`);

ALTER TABLE `SupportTicket`
  ADD CONSTRAINT `SupportTicket_resolvedBy_fkey` FOREIGN KEY (`resolvedByUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `SupportTicket_createdBy_fkey` FOREIGN KEY (`createdByUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

INSERT IGNORE INTO `Permission` (`id`, `key`, `description`) VALUES
  (CONCAT('perm_', REPLACE(UUID(), '-', '')), 'platform:support:read', 'View platform support tickets'),
  (CONCAT('perm_', REPLACE(UUID(), '-', '')), 'platform:support:manage', 'Manage platform support tickets');

INSERT IGNORE INTO `RolePermission` (`roleId`, `permissionId`)
SELECT DISTINCT platform_user.`roleId`, permission_record.`id`
FROM `User` platform_user
CROSS JOIN `Permission` permission_record
WHERE platform_user.`isPlatformAdmin` = TRUE
  AND permission_record.`key` IN ('platform:support:read', 'platform:support:manage');
