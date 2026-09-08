ALTER TABLE `Client`
  ADD COLUMN `reference` VARCHAR(191) NULL,
  ADD COLUMN `contactPerson` VARCHAR(191) NULL,
  ADD COLUMN `status` VARCHAR(191) NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN `archivedAt` DATETIME(3) NULL;

UPDATE `Client` SET `reference` = CONCAT('CLT-', UPPER(SUBSTRING(`id`, 1, 12))) WHERE `reference` IS NULL;
ALTER TABLE `Client` MODIFY `reference` VARCHAR(191) NOT NULL;
CREATE UNIQUE INDEX `Client_org_reference_key` ON `Client`(`organizationId`, `reference`);
CREATE INDEX `Client_org_status_created_idx` ON `Client`(`organizationId`, `status`, `createdAt`);

CREATE TABLE `AccountingCatalogueItem` (
  `id` VARCHAR(191) NOT NULL,
  `organizationId` VARCHAR(191) NOT NULL,
  `reference` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `type` VARCHAR(191) NOT NULL,
  `unitPrice` DECIMAL(14,2) NOT NULL,
  `unit` VARCHAR(191) NOT NULL,
  `description` TEXT NULL,
  `vatApplicable` BOOLEAN NOT NULL DEFAULT false,
  `status` VARCHAR(191) NOT NULL DEFAULT 'ACTIVE',
  `archivedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `AccountingItem_org_reference_key`(`organizationId`, `reference`),
  INDEX `AccountingItem_org_status_created_idx`(`organizationId`, `status`, `createdAt`),
  INDEX `AccountingItem_org_name_idx`(`organizationId`, `name`),
  CONSTRAINT `AccountingItem_org_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `AccountingProject` (
  `id` VARCHAR(191) NOT NULL,
  `organizationId` VARCHAR(191) NOT NULL,
  `reference` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `clientId` VARCHAR(191) NOT NULL,
  `assignedAgentId` VARCHAR(191) NULL,
  `value` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `startDate` DATETIME(3) NOT NULL,
  `endDate` DATETIME(3) NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'ACTIVE',
  `archivedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `AccountingProject_org_reference_key`(`organizationId`, `reference`),
  INDEX `AccountingProject_org_status_created_idx`(`organizationId`, `status`, `createdAt`),
  INDEX `AccountingProject_org_client_idx`(`organizationId`, `clientId`),
  INDEX `AccountingProject_agent_idx`(`assignedAgentId`),
  CONSTRAINT `AccountingProject_org_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `AccountingProject_client_fkey` FOREIGN KEY (`clientId`) REFERENCES `Client`(`id`) ON UPDATE CASCADE,
  CONSTRAINT `AccountingProject_agent_fkey` FOREIGN KEY (`assignedAgentId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `Invoice`
  ADD COLUMN `projectId` VARCHAR(191) NULL,
  ADD COLUMN `assignedAgentId` VARCHAR(191) NULL;
CREATE INDEX `Invoice_org_project_idx` ON `Invoice`(`organizationId`, `projectId`);
CREATE INDEX `Invoice_agent_idx` ON `Invoice`(`assignedAgentId`);
ALTER TABLE `Invoice` ADD CONSTRAINT `Invoice_project_fkey` FOREIGN KEY (`projectId`) REFERENCES `AccountingProject`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `Invoice` ADD CONSTRAINT `Invoice_agent_fkey` FOREIGN KEY (`assignedAgentId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `InvoiceItem` ADD COLUMN `catalogueItemId` VARCHAR(191) NULL;
CREATE INDEX `InvoiceItem_catalogue_idx` ON `InvoiceItem`(`catalogueItemId`);
ALTER TABLE `InvoiceItem` ADD CONSTRAINT `InvoiceItem_catalogue_fkey` FOREIGN KEY (`catalogueItemId`) REFERENCES `AccountingCatalogueItem`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `PaymentRequest`
  ADD COLUMN `invoiceId` VARCHAR(191) NULL,
  ADD COLUMN `projectId` VARCHAR(191) NULL;
CREATE INDEX `PaymentRequest_org_invoice_idx` ON `PaymentRequest`(`organizationId`, `invoiceId`);
CREATE INDEX `PaymentRequest_org_project_idx` ON `PaymentRequest`(`organizationId`, `projectId`);
ALTER TABLE `PaymentRequest` ADD CONSTRAINT `PaymentRequest_invoice_fkey` FOREIGN KEY (`invoiceId`) REFERENCES `Invoice`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `PaymentRequest` ADD CONSTRAINT `PaymentRequest_project_fkey` FOREIGN KEY (`projectId`) REFERENCES `AccountingProject`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
