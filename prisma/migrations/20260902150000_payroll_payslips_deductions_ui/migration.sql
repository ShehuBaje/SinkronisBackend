ALTER TABLE `LoanAdvance`
  ADD COLUMN `pausedAt` DATETIME(3) NULL,
  ADD COLUMN `adjustedAt` DATETIME(3) NULL,
  ADD COLUMN `closedAt` DATETIME(3) NULL,
  ADD COLUMN `closedById` VARCHAR(191) NULL,
  ADD COLUMN `closeReason` TEXT NULL;

CREATE TABLE `LoanRepayment` (
  `id` VARCHAR(191) NOT NULL,
  `organizationId` VARCHAR(191) NOT NULL,
  `loanId` VARCHAR(191) NOT NULL,
  `payrollRunId` VARCHAR(191) NULL,
  `amount` DECIMAL(14,2) NOT NULL,
  `repaymentDate` DATETIME(3) NOT NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'POSTED',
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `LoanRepayment_loan_run_key`(`loanId`, `payrollRunId`),
  INDEX `LoanRepayment_org_loan_date_idx`(`organizationId`, `loanId`, `repaymentDate`),
  CONSTRAINT `LoanRepayment_loanId_fkey` FOREIGN KEY (`loanId`) REFERENCES `LoanAdvance`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `LoanRepayment_payrollRunId_fkey` FOREIGN KEY (`payrollRunId`) REFERENCES `PayrollRun`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `LoanRepayment_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
