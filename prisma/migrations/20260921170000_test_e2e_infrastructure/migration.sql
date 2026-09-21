-- Existing organizations remain ordinary customer tenants. Test classification
-- must be granted explicitly through the Platform Admin operation.
ALTER TABLE `Organization`
  ADD COLUMN `classification` ENUM('CUSTOMER', 'TEST_E2E', 'DEMO') NOT NULL DEFAULT 'CUSTOMER';

CREATE TABLE `TestModuleEntitlement` (
  `id` VARCHAR(191) NOT NULL,
  `organizationId` VARCHAR(191) NOT NULL,
  `moduleKey` VARCHAR(32) NOT NULL,
  `active` BOOLEAN NOT NULL DEFAULT true,
  `reason` TEXT NOT NULL,
  `grantedByUserId` VARCHAR(191) NOT NULL,
  `grantedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `expiresAt` DATETIME(3) NULL,
  `revokedByUserId` VARCHAR(191) NULL,
  `revokedAt` DATETIME(3) NULL,
  `revocationReason` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `TestModuleEntitlement_org_module_key`(`organizationId`, `moduleKey`),
  INDEX `TestModuleEntitlement_org_active_expiry_idx`(`organizationId`, `active`, `expiresAt`),
  PRIMARY KEY (`id`),
  CONSTRAINT `TestModuleEntitlement_org_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
