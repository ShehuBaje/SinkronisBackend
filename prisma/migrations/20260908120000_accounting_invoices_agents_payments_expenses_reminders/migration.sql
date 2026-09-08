ALTER TABLE `AgentInvitation`
  ADD COLUMN `fullName` VARCHAR(191) NULL,
  ADD COLUMN `phone` VARCHAR(191) NULL;

ALTER TABLE `Invoice`
  ADD COLUMN `sentAt` DATETIME(3) NULL,
  ADD COLUMN `paidAt` DATETIME(3) NULL,
  ADD COLUMN `voidedAt` DATETIME(3) NULL,
  ADD COLUMN `paymentReference` VARCHAR(191) NULL;
CREATE UNIQUE INDEX `Invoice_org_payment_reference_key` ON `Invoice`(`organizationId`, `paymentReference`);

ALTER TABLE `InvoiceItem`
  ADD COLUMN `lineSubtotal` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  ADD COLUMN `vatApplicable` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `vatRate` DECIMAL(7,4) NOT NULL DEFAULT 0.00,
  ADD COLUMN `vatAmount` DECIMAL(14,2) NOT NULL DEFAULT 0.00;
UPDATE `InvoiceItem` SET `lineSubtotal` = `total` WHERE `lineSubtotal` = 0.00;

CREATE TABLE `AccountingInvoiceStatusHistory` (
  `id` VARCHAR(191) NOT NULL,
  `organizationId` VARCHAR(191) NOT NULL,
  `invoiceId` VARCHAR(191) NOT NULL,
  `status` ENUM('DRAFT','SENT','PAID','VOID','OVERDUE') NOT NULL,
  `description` VARCHAR(191) NULL,
  `actorUserId` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `AccountingInvoiceHistory_org_invoice_created_idx`(`organizationId`, `invoiceId`, `createdAt`),
  CONSTRAINT `AccountingInvoiceHistory_invoice_fkey` FOREIGN KEY (`invoiceId`) REFERENCES `Invoice`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `AccountingInvoiceHistory_actor_fkey` FOREIGN KEY (`actorUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `AccountingAgentProfile` (
  `id` VARCHAR(191) NOT NULL,
  `organizationId` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `reference` VARCHAR(191) NOT NULL,
  `phone` VARCHAR(191) NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'ACTIVE',
  `invitedAt` DATETIME(3) NULL,
  `deactivatedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `AccountingAgentProfile_user_key`(`userId`),
  UNIQUE INDEX `AccountingAgentProfile_org_user_key`(`organizationId`, `userId`),
  UNIQUE INDEX `AccountingAgentProfile_org_reference_key`(`organizationId`, `reference`),
  INDEX `AccountingAgentProfile_org_status_created_idx`(`organizationId`, `status`, `createdAt`),
  CONSTRAINT `AccountingAgentProfile_org_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `AccountingAgentProfile_user_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `AccountingExpense` (
  `id` VARCHAR(191) NOT NULL,
  `organizationId` VARCHAR(191) NOT NULL,
  `reference` VARCHAR(191) NOT NULL,
  `expenseDate` DATETIME(3) NOT NULL,
  `category` VARCHAR(191) NOT NULL,
  `description` TEXT NOT NULL,
  `amount` DECIMAL(14,2) NOT NULL,
  `receiptReference` VARCHAR(191) NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'ACTIVE',
  `loggedByUserId` VARCHAR(191) NOT NULL,
  `voidedAt` DATETIME(3) NULL,
  `voidedByUserId` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `AccountingExpense_org_reference_key`(`organizationId`, `reference`),
  INDEX `AccountingExpense_org_status_date_idx`(`organizationId`, `status`, `expenseDate`),
  INDEX `AccountingExpense_org_category_date_idx`(`organizationId`, `category`, `expenseDate`),
  CONSTRAINT `AccountingExpense_org_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `AccountingExpense_logger_fkey` FOREIGN KEY (`loggedByUserId`) REFERENCES `User`(`id`) ON UPDATE CASCADE,
  CONSTRAINT `AccountingExpense_voider_fkey` FOREIGN KEY (`voidedByUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `PaymentRequest`
  ADD COLUMN `clientId` VARCHAR(191) NULL,
  ADD COLUMN `requesterUserId` VARCHAR(191) NULL,
  ADD COLUMN `description` TEXT NULL,
  ADD COLUMN `bankName` VARCHAR(191) NULL,
  ADD COLUMN `accountNumber` VARCHAR(191) NULL,
  ADD COLUMN `accountName` VARCHAR(191) NULL,
  ADD COLUMN `decisionReason` TEXT NULL,
  ADD COLUMN `declinedBy` VARCHAR(191) NULL,
  ADD COLUMN `declinedAt` DATETIME(3) NULL,
  ADD COLUMN `disbursementReference` VARCHAR(191) NULL,
  ADD COLUMN `disbursedAt` DATETIME(3) NULL;
CREATE UNIQUE INDEX `PaymentRequest_org_disbursement_ref_key` ON `PaymentRequest`(`organizationId`, `disbursementReference`);
CREATE INDEX `PaymentRequest_org_client_idx` ON `PaymentRequest`(`organizationId`, `clientId`);
CREATE INDEX `PaymentRequest_requester_idx` ON `PaymentRequest`(`requesterUserId`);
ALTER TABLE `PaymentRequest` ADD CONSTRAINT `PaymentRequest_client_fkey` FOREIGN KEY (`clientId`) REFERENCES `Client`(`id`) ON UPDATE CASCADE;
ALTER TABLE `PaymentRequest` ADD CONSTRAINT `PaymentRequest_requester_fkey` FOREIGN KEY (`requesterUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
