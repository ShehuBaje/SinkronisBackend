ALTER TABLE `Employee`
  ADD COLUMN `bankAccountName` VARCHAR(191) NULL,
  ADD COLUMN `bankAccountType` VARCHAR(191) NULL;

ALTER TABLE `EmployeeDocument`
  ADD COLUMN `employeeVisible` BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN `allowDownload` BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE `BankDetailsUpdateRequest` (
  `id` VARCHAR(191) NOT NULL,
  `organizationId` VARCHAR(191) NOT NULL,
  `employeeId` VARCHAR(191) NOT NULL,
  `currentBankSnapshot` JSON NOT NULL,
  `proposedBankCode` VARCHAR(191) NOT NULL,
  `proposedBankName` VARCHAR(191) NOT NULL,
  `proposedAccountNumber` VARCHAR(191) NOT NULL,
  `proposedAccountName` VARCHAR(191) NOT NULL,
  `proposedAccountType` VARCHAR(191) NOT NULL,
  `reason` TEXT NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
  `pendingKey` VARCHAR(191) NULL,
  `submittedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `reviewedById` VARCHAR(191) NULL,
  `reviewedAt` DATETIME(3) NULL,
  `reviewNote` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  INDEX `BankDetailsUpdateRequest_org_employee_status_idx`(`organizationId`, `employeeId`, `status`),
  INDEX `BankDetailsUpdateRequest_org_submitted_idx`(`organizationId`, `submittedAt`),
  UNIQUE INDEX `BankDetailsUpdateRequest_pendingKey_key`(`pendingKey`),
  PRIMARY KEY (`id`),
  CONSTRAINT `BankDetailsUpdateRequest_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `BankDetailsUpdateRequest_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
