CREATE TABLE `PlatformInvoice` (
  `id` VARCHAR(191) NOT NULL, `invoiceNumber` VARCHAR(191) NOT NULL, `organizationId` VARCHAR(191) NOT NULL,
  `billingPeriod` CHAR(7) NOT NULL, `planKey` VARCHAR(191) NOT NULL, `amount` DECIMAL(14,2) NOT NULL,
  `currency` CHAR(3) NOT NULL DEFAULT 'NGN', `status` ENUM('DRAFT','OVERDUE','PAID') NOT NULL DEFAULT 'DRAFT',
  `invoiceDate` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `dueDate` DATETIME(3) NOT NULL,
  `paidAt` DATETIME(3) NULL, `createdByUserId` VARCHAR(191) NOT NULL, `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `PlatformInvoice_invoiceNumber_key`(`invoiceNumber`), UNIQUE INDEX `PlatformInvoice_org_period_key`(`organizationId`, `billingPeriod`),
  INDEX `PlatformInvoice_status_due_idx`(`status`, `dueDate`), INDEX `PlatformInvoice_period_plan_idx`(`billingPeriod`, `planKey`), INDEX `PlatformInvoice_org_created_idx`(`organizationId`, `createdAt`), PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE `PlatformInvoiceReminder` (
  `id` VARCHAR(191) NOT NULL, `invoiceId` VARCHAR(191) NOT NULL, `triggeredByUserId` VARCHAR(191) NOT NULL,
  `status` VARCHAR(191) NOT NULL, `errorMessage` TEXT NULL, `attemptedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `deliveredAt` DATETIME(3) NULL,
  INDEX `PlatformInvoiceReminder_invoice_attempted_idx`(`invoiceId`, `attemptedAt`), PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `PlatformInvoice` ADD CONSTRAINT `PlatformInvoice_org_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `PlatformInvoiceReminder` ADD CONSTRAINT `PlatformInvoiceReminder_invoice_fkey` FOREIGN KEY (`invoiceId`) REFERENCES `PlatformInvoice`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
