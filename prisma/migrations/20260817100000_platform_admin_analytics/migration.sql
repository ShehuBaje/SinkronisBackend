CREATE TABLE `TenantUsageDaily` (
  `id` VARCHAR(191) NOT NULL, `organizationId` VARCHAR(191) NOT NULL, `usageDate` DATE NOT NULL,
  `pageViews` INTEGER NOT NULL DEFAULT 0, `lastActivityAt` DATETIME(3) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `TenantUsageDaily_org_date_key`(`organizationId`, `usageDate`),
  INDEX `TenantUsageDaily_date_org_idx`(`usageDate`, `organizationId`),
  INDEX `TenantUsageDaily_org_activity_idx`(`organizationId`, `lastActivityAt`), PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE `TenantCheckIn` (
  `id` VARCHAR(191) NOT NULL, `organizationId` VARCHAR(191) NOT NULL, `checkInDate` DATE NOT NULL,
  `triggeredByUserId` VARCHAR(191) NOT NULL, `recipientEmail` VARCHAR(191) NOT NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING', `attemptedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `deliveredAt` DATETIME(3) NULL, `failedAt` DATETIME(3) NULL, `errorMessage` TEXT NULL,
  UNIQUE INDEX `TenantCheckIn_org_date_key`(`organizationId`, `checkInDate`),
  INDEX `TenantCheckIn_status_attempt_idx`(`status`, `attemptedAt`), PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `TenantUsageDaily` ADD CONSTRAINT `TenantUsageDaily_org_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `TenantCheckIn` ADD CONSTRAINT `TenantCheckIn_org_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
CREATE TABLE `TenantModuleDailySnapshot` (
  `id` VARCHAR(191) NOT NULL, `organizationId` VARCHAR(191) NOT NULL, `moduleKey` VARCHAR(191) NOT NULL,
  `snapshotDate` DATE NOT NULL, `enabled` BOOLEAN NOT NULL, `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `TenantModuleSnapshot_org_module_date_key`(`organizationId`,`moduleKey`,`snapshotDate`),
  INDEX `TenantModuleSnapshot_date_module_enabled_idx`(`snapshotDate`,`moduleKey`,`enabled`), PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `TenantModuleDailySnapshot` ADD CONSTRAINT `TenantModuleSnapshot_org_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
INSERT IGNORE INTO `TenantModuleDailySnapshot` (`id`,`organizationId`,`moduleKey`,`snapshotDate`,`enabled`,`createdAt`)
SELECT CONCAT('tms_',REPLACE(UUID(),'-','')), sc.organizationId, SUBSTRING_INDEX(SUBSTRING_INDEX(sc.`key`,'.',2),'.',-1), UTC_DATE(), UPPER(JSON_UNQUOTE(sc.value))='ACTIVE' AND UPPER(JSON_UNQUOTE(JSON_EXTRACT(sub.value,'$.status')))='ACTIVE', CURRENT_TIMESTAMP(3)
FROM SystemConfig sc JOIN Organization o ON o.id=sc.organizationId JOIN SystemConfig sub ON sub.organizationId=o.id AND sub.`key`='billing.subscription'
WHERE sc.`key` IN ('module.hris.status','module.payroll.status','module.accounting.status') AND o.status='ACTIVE'
  AND NOT EXISTS (SELECT 1 FROM User pa WHERE pa.organizationId=o.id AND pa.isPlatformAdmin=true)
  AND NOT EXISTS (SELECT 1 FROM OrganizationDeletionRequest odr WHERE odr.organizationId=o.id AND odr.status='PENDING_PLATFORM_APPROVAL');
INSERT IGNORE INTO `Permission` (`id`, `key`, `description`) VALUES
  (CONCAT('perm_', REPLACE(UUID(), '-', '')), 'platform:analytics:read', 'platform analytics read'),
  (CONCAT('perm_', REPLACE(UUID(), '-', '')), 'platform:analytics:check-in', 'platform analytics check in');
INSERT IGNORE INTO `RolePermission` (`roleId`, `permissionId`)
SELECT DISTINCT platform_user.`roleId`, permission_record.`id` FROM `User` platform_user CROSS JOIN `Permission` permission_record
WHERE platform_user.`isPlatformAdmin` = true AND permission_record.`key` IN ('platform:analytics:read', 'platform:analytics:check-in');
