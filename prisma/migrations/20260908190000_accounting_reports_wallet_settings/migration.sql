ALTER TABLE `AccountingReminderConfiguration`
  ADD COLUMN `automaticRemindersEnabled` BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN `firstReminderDaysBeforeDue` INTEGER NOT NULL DEFAULT 7,
  ADD COLUMN `overdueReminderFrequency` VARCHAR(191) NOT NULL DEFAULT 'EVERY_7_DAYS';

CREATE TABLE `AccountingInvoiceTemplate` (
  `id` VARCHAR(191) NOT NULL,
  `organizationId` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `normalizedName` VARCHAR(191) NOT NULL,
  `paymentTerms` VARCHAR(191) NULL,
  `headerNote` TEXT NULL,
  `footerNote` TEXT NULL,
  `isDefault` BOOLEAN NOT NULL DEFAULT false,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `AccountingInvoiceTemplate_org_name_key`(`organizationId`, `normalizedName`),
  INDEX `AccountingInvoiceTemplate_org_default_idx`(`organizationId`, `isDefault`),
  PRIMARY KEY (`id`),
  CONSTRAINT `AccountingInvoiceTemplate_org_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `AccountingExpenseCategory` (
  `id` VARCHAR(191) NOT NULL,
  `organizationId` VARCHAR(191) NOT NULL,
  `reference` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `normalizedName` VARCHAR(191) NOT NULL,
  `description` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `AccountingExpenseCategory_org_reference_key`(`organizationId`, `reference`),
  UNIQUE INDEX `AccountingExpenseCategory_org_name_key`(`organizationId`, `normalizedName`),
  PRIMARY KEY (`id`),
  CONSTRAINT `AccountingExpenseCategory_org_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `AccountingExpense` ADD COLUMN `categoryId` VARCHAR(191) NULL;
CREATE INDEX `AccountingExpense_category_idx` ON `AccountingExpense`(`categoryId`);
ALTER TABLE `AccountingExpense` ADD CONSTRAINT `AccountingExpense_category_fkey` FOREIGN KEY (`categoryId`) REFERENCES `AccountingExpenseCategory`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
