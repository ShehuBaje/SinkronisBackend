ALTER TABLE `SystemConfig`
  ADD COLUMN `updatedByUserId` VARCHAR(191) NULL,
  ADD COLUMN `updateReason` TEXT NULL,
  ADD COLUMN `updateSource` VARCHAR(191) NULL,
  ADD COLUMN `rowVersion` INTEGER NOT NULL DEFAULT 1;
CREATE INDEX `SystemConfig_org_updated_idx` ON `SystemConfig`(`organizationId`, `updatedAt`);
INSERT IGNORE INTO `Permission` (`id`, `key`, `description`) VALUES
  (CONCAT('perm_', REPLACE(UUID(), '-', '')), 'platform:modules:read', 'platform modules read'),
  (CONCAT('perm_', REPLACE(UUID(), '-', '')), 'platform:modules:manage', 'platform modules manage');
INSERT IGNORE INTO `RolePermission` (`roleId`, `permissionId`)
SELECT DISTINCT platform_user.`roleId`, permission_record.`id`
FROM `User` platform_user CROSS JOIN `Permission` permission_record
WHERE platform_user.`isPlatformAdmin` = true
  AND permission_record.`key` IN ('platform:modules:read', 'platform:modules:manage');
