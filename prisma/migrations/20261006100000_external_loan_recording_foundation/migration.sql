ALTER TABLE `LoanAdvance`
  ADD COLUMN `openingOutstanding` DECIMAL(14,2) NULL,
  ADD COLUMN `currency` VARCHAR(3) NULL,
  ADD COLUMN `notes` TEXT NULL,
  ADD COLUMN `externalDisbursementDate` DATETIME(3) NULL,
  ADD COLUMN `recoveryStartDate` DATETIME(3) NULL,
  ADD COLUMN `origin` VARCHAR(32) NOT NULL DEFAULT 'LEGACY_UNCONFIRMED',
  ADD COLUMN `confirmationStatus` VARCHAR(32) NOT NULL DEFAULT 'LEGACY_UNCONFIRMED',
  ADD COLUMN `externalReference` VARCHAR(191) NULL,
  ADD COLUMN `evidenceDocumentId` VARCHAR(191) NULL,
  ADD COLUMN `recordedById` VARCHAR(191) NULL,
  ADD COLUMN `recordedAt` DATETIME(3) NULL,
  ADD COLUMN `attestedById` VARCHAR(191) NULL,
  ADD COLUMN `attestedAt` DATETIME(3) NULL;

CREATE UNIQUE INDEX `LoanAdvance_org_externalReference_key`
  ON `LoanAdvance`(`organizationId`, `externalReference`);

CREATE INDEX `LoanAdvance_org_confirmation_status_idx`
  ON `LoanAdvance`(`organizationId`, `confirmationStatus`, `status`);

CREATE INDEX `LoanAdvance_org_employee_recovery_idx`
  ON `LoanAdvance`(`organizationId`, `employeeId`, `recoveryStartDate`);

CREATE INDEX `LoanAdvance_evidenceDocumentId_idx`
  ON `LoanAdvance`(`evidenceDocumentId`);

ALTER TABLE `LoanAdvance`
  ADD CONSTRAINT `LoanAdvance_evidenceDocumentId_fkey`
  FOREIGN KEY (`evidenceDocumentId`) REFERENCES `PayeeDocument`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;
