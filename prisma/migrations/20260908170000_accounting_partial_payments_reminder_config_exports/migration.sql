ALTER TABLE `AgentInvitation`
  ADD COLUMN IF NOT EXISTS `purpose` VARCHAR(40) NOT NULL DEFAULT 'WORKSPACE';
CREATE INDEX IF NOT EXISTS `AgentInvitation_org_purpose_status_expires_idx`
  ON `AgentInvitation`(`organizationId`, `purpose`, `status`, `expiresAt`);
UPDATE `AgentInvitation`
SET `purpose` = 'ACCOUNTING_AGENT'
WHERE JSON_CONTAINS(`moduleAccess`, JSON_QUOTE('ACCOUNTING')) = 1
  AND `fullName` IS NOT NULL;

ALTER TABLE `Invoice`
  MODIFY COLUMN `status` ENUM('DRAFT','SENT','PARTIALLY_PAID','PAID','VOID','OVERDUE') NOT NULL DEFAULT 'DRAFT';
ALTER TABLE `AccountingInvoiceStatusHistory`
  MODIFY COLUMN `status` ENUM('DRAFT','SENT','PARTIALLY_PAID','PAID','VOID','OVERDUE') NOT NULL;

CREATE TABLE IF NOT EXISTS `AccountingInvoicePayment` (
  `id` VARCHAR(191) NOT NULL,
  `organizationId` VARCHAR(191) NOT NULL,
  `invoiceId` VARCHAR(191) NOT NULL,
  `reference` VARCHAR(191) NOT NULL,
  `amount` DECIMAL(14,2) NOT NULL,
  `paidAt` DATETIME(3) NOT NULL,
  `recordedById` VARCHAR(191) NULL,
  `notes` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `AccountingInvoicePayment_org_reference_key`(`organizationId`, `reference`),
  INDEX `AccountingInvoicePayment_org_invoice_paid_idx`(`organizationId`, `invoiceId`, `paidAt`),
  CONSTRAINT `AccountingInvoicePayment_invoice_fkey` FOREIGN KEY (`invoiceId`) REFERENCES `Invoice`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `AccountingInvoicePayment_org_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `AccountingInvoicePayment_user_fkey` FOREIGN KEY (`recordedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
INSERT IGNORE INTO `AccountingInvoicePayment` (`id`,`organizationId`,`invoiceId`,`reference`,`amount`,`paidAt`,`recordedById`,`notes`)
SELECT CONCAT('legacy-', `id`), `organizationId`, `id`, COALESCE(`paymentReference`, CONCAT('LEGACY-', `id`)), `total`, COALESCE(`paidAt`, `updatedAt`), NULL, 'Backfilled from settled invoice'
FROM `Invoice` WHERE `status` = 'PAID';

CREATE TABLE IF NOT EXISTS `AccountingReminderConfiguration` (
  `id` VARCHAR(191) NOT NULL,
  `organizationId` VARCHAR(191) NOT NULL,
  `upcomingDays` JSON NOT NULL,
  `overdueIntervals` JSON NOT NULL,
  `inAppEnabled` BOOLEAN NOT NULL DEFAULT true,
  `emailEnabled` BOOLEAN NOT NULL DEFAULT true,
  `updatedByUserId` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `AccountingReminderConfiguration_org_key`(`organizationId`),
  CONSTRAINT `AccountingReminderConfiguration_org_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `AccountingReminderConfiguration_user_fkey` FOREIGN KEY (`updatedByUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `AccountingExportJob` (
  `id` VARCHAR(191) NOT NULL,
  `organizationId` VARCHAR(191) NOT NULL,
  `requestedByUserId` VARCHAR(191) NOT NULL,
  `type` VARCHAR(191) NOT NULL,
  `filters` JSON NOT NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
  `fileName` VARCHAR(191) NULL,
  `fileReference` VARCHAR(191) NULL,
  `fileSize` INTEGER NULL,
  `requestedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `processingAt` DATETIME(3) NULL,
  `completedAt` DATETIME(3) NULL,
  `failedAt` DATETIME(3) NULL,
  `expiresAt` DATETIME(3) NULL,
  `errorMessage` TEXT NULL,
  PRIMARY KEY (`id`),
  INDEX `AccountingExportJob_status_requested_idx`(`status`, `requestedAt`),
  INDEX `AccountingExportJob_status_expires_idx`(`status`, `expiresAt`),
  INDEX `AccountingExportJob_org_requested_idx`(`organizationId`, `requestedAt`),
  CONSTRAINT `AccountingExportJob_org_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `AccountingExportJob_user_fkey` FOREIGN KEY (`requestedByUserId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
