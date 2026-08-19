CREATE INDEX `User_email_idx` ON `User`(`email`);
CREATE INDEX `User_name_idx` ON `User`(`firstName`, `lastName`);
CREATE INDEX `User_status_lastActive_idx` ON `User`(`isActive`, `lastLoginAt`);
CREATE INDEX `User_createdAt_idx` ON `User`(`createdAt`);
ALTER TABLE `User` ADD COLUMN `passwordResetRequestedAt` DATETIME(3) NULL;
CREATE INDEX `User_passwordResetRequestedAt_idx` ON `User`(`passwordResetRequestedAt`);

INSERT IGNORE INTO `Permission` (`id`, `key`, `description`) VALUES
  (CONCAT('perm_', REPLACE(UUID(), '-', '')), 'platform:users:read', 'platform users read'),
  (CONCAT('perm_', REPLACE(UUID(), '-', '')), 'platform:users:deactivate', 'platform users deactivate'),
  (CONCAT('perm_', REPLACE(UUID(), '-', '')), 'platform:users:reset-password', 'platform users reset password'),
  (CONCAT('perm_', REPLACE(UUID(), '-', '')), 'platform:users:impersonate', 'platform users impersonate');

INSERT IGNORE INTO `RolePermission` (`roleId`, `permissionId`)
SELECT DISTINCT platform_user.`roleId`, permission_record.`id`
FROM `User` platform_user
CROSS JOIN `Permission` permission_record
WHERE platform_user.`isPlatformAdmin` = true
  AND permission_record.`key` IN ('platform:users:read', 'platform:users:deactivate', 'platform:users:reset-password', 'platform:users:impersonate');
