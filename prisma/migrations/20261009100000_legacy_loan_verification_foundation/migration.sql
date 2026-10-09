-- R6A.3 Phase 4A: additive legacy-loan verification and prospective audit hash versioning.
-- This migration performs no historical backfill and no financial or LoanAdvance DML.
ALTER TABLE `AuditLog`
  ADD COLUMN `hashVersion` VARCHAR(16) NULL;

CREATE UNIQUE INDEX `PayeeDocument_org_id_key`
  ON `PayeeDocument`(`organizationId`, `id`);

CREATE UNIQUE INDEX `User_organizationId_id_key`
  ON `User`(`organizationId`, `id`);

CREATE TABLE `LegacyLoanVerification` (
  `id` VARCHAR(191) NOT NULL,
  `organizationId` VARCHAR(191) NOT NULL,
  `loanAdvanceId` VARCHAR(191) NOT NULL,
  `attemptNumber` INTEGER NOT NULL,
  `status` ENUM('PENDING_VERIFICATION','CONFIRMED','NEEDS_RECONCILIATION') NOT NULL DEFAULT 'PENDING_VERIFICATION',
  `recordedPrincipalSnapshot` DECIMAL(14,2) NOT NULL,
  `recordedOutstandingSnapshot` DECIMAL(14,2) NOT NULL,
  `assertedOriginalPrincipal` DECIMAL(14,2) NOT NULL,
  `assertedCutoverOutstanding` DECIMAL(14,2) NOT NULL,
  `currency` VARCHAR(3) NOT NULL,
  `externalDisbursementDate` DATETIME(3) NOT NULL,
  `proposedRecoveryStartDate` DATETIME(3) NOT NULL,
  `repaymentType` VARCHAR(32) NOT NULL,
  `proposedMonthlyRepayment` DECIMAL(14,2) NULL,
  `externalReference` VARCHAR(191) NULL,
  `evidenceDocumentId` VARCHAR(191) NULL,
  `evidenceNote` TEXT NULL,
  `evidenceFingerprint` CHAR(64) NOT NULL,
  `attestationVersion` VARCHAR(32) NOT NULL,
  `attestationAccepted` BOOLEAN NOT NULL DEFAULT false,
  `reason` TEXT NOT NULL,
  `submittedById` VARCHAR(191) NOT NULL,
  `submittedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `confirmedById` VARCHAR(191) NULL,
  `confirmedAt` DATETIME(3) NULL,
  `reconciliationReason` TEXT NULL,
  `decisionAt` DATETIME(3) NULL,
  `idempotencyKey` VARCHAR(191) NOT NULL,
  `pendingVerificationKey` VARCHAR(191) NULL,
  `confirmedVerificationKey` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `LegacyLoanVerification_org_id_key`(`organizationId`, `id`),
  UNIQUE INDEX `LegacyLoanVerification_org_loan_attempt_key`(`organizationId`, `loanAdvanceId`, `attemptNumber`),
  UNIQUE INDEX `LegacyLoanVerification_org_idempotency_key`(`organizationId`, `idempotencyKey`),
  UNIQUE INDEX `LegacyLoanVerification_pending_key`(`pendingVerificationKey`),
  UNIQUE INDEX `LegacyLoanVerification_confirmed_key`(`confirmedVerificationKey`),
  INDEX `LegacyLoanVerification_org_loan_status_idx`(`organizationId`, `loanAdvanceId`, `status`, `createdAt`),
  INDEX `LegacyLoanVerification_org_submitter_idx`(`organizationId`, `submittedById`, `submittedAt`),
  INDEX `LegacyLoanVerification_org_confirmer_idx`(`organizationId`, `confirmedById`, `decisionAt`),
  CONSTRAINT `LegacyLoanVerification_org_fkey`
    FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `LegacyLoanVerification_org_loan_fkey`
    FOREIGN KEY (`organizationId`, `loanAdvanceId`) REFERENCES `LoanAdvance`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `LegacyLoanVerification_org_document_fkey`
    FOREIGN KEY (`organizationId`, `evidenceDocumentId`) REFERENCES `PayeeDocument`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `LegacyLoanVerification_org_submitter_fkey`
    FOREIGN KEY (`organizationId`, `submittedById`) REFERENCES `User`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `LegacyLoanVerification_org_confirmer_fkey`
    FOREIGN KEY (`organizationId`, `confirmedById`) REFERENCES `User`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `Permission` (`id`, `key`, `description`)
SELECT CONCAT('perm_', REPLACE(UUID(), '-', '')), 'payroll:loans:confirm-legacy', 'payroll loans confirm legacy'
WHERE NOT EXISTS (
  SELECT 1 FROM `Permission` WHERE `key` = 'payroll:loans:confirm-legacy'
);
