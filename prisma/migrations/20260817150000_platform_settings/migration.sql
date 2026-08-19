CREATE TABLE `PlatformSetting` (
  `id` VARCHAR(191) NOT NULL,
  `key` VARCHAR(191) NOT NULL,
  `category` VARCHAR(64) NOT NULL,
  `value` JSON NOT NULL,
  `updatedByUserId` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `PlatformSetting_key_key`(`key`),
  INDEX `PlatformSetting_category_updated_idx`(`category`, `updatedAt`),
  INDEX `PlatformSetting_updatedBy_fkey`(`updatedByUserId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `PlatformSetting`
  ADD CONSTRAINT `PlatformSetting_updatedBy_fkey`
  FOREIGN KEY (`updatedByUserId`) REFERENCES `User`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;

INSERT IGNORE INTO `Permission` (`id`, `key`, `description`) VALUES
  (CONCAT('perm_', REPLACE(UUID(), '-', '')), 'platform:settings:read', 'View global platform settings'),
  (CONCAT('perm_', REPLACE(UUID(), '-', '')), 'platform:settings:manage', 'Manage global platform settings');

INSERT IGNORE INTO `RolePermission` (`roleId`, `permissionId`)
SELECT DISTINCT platform_user.`roleId`, permission_record.`id`
FROM `User` platform_user
CROSS JOIN `Permission` permission_record
WHERE platform_user.`isPlatformAdmin` = TRUE
  AND permission_record.`key` IN ('platform:settings:read', 'platform:settings:manage');
