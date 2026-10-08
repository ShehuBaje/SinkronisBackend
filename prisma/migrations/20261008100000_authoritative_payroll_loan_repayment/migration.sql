-- R6A.3 Phase 3: additive authoritative repayment evidence and lifecycle.
-- No historical repayment/application is inferred and no monetary balance is changed.
ALTER TABLE `LoanAdvance`
  ADD COLUMN `completedAt` DATETIME(3) NULL;

ALTER TABLE `LoanRecoveryApplication`
  MODIFY `state` ENUM('FROZEN','SUPERSEDED','COMMITTED','REVERSED') NOT NULL DEFAULT 'FROZEN',
  ADD COLUMN `committedAt` DATETIME(3) NULL,
  ADD COLUMN `reversedAt` DATETIME(3) NULL;

CREATE UNIQUE INDEX `LoanRecoveryApplication_org_id_key`
  ON `LoanRecoveryApplication`(`organizationId`, `id`);

CREATE UNIQUE INDEX `FinancialSettlement_org_id_key`
  ON `FinancialSettlement`(`organizationId`, `id`);

ALTER TABLE `LoanRepayment`
  ADD COLUMN `loanRecoveryApplicationId` VARCHAR(191) NULL,
  ADD COLUMN `payrollRunParticipantId` VARCHAR(191) NULL,
  ADD COLUMN `payslipId` VARCHAR(191) NULL,
  ADD COLUMN `financialSettlementId` VARCHAR(191) NULL,
  ADD COLUMN `source` VARCHAR(32) NOT NULL DEFAULT 'LEGACY',
  ADD COLUMN `currency` VARCHAR(3) NULL,
  ADD COLUMN `outstandingBefore` DECIMAL(14,2) NULL,
  ADD COLUMN `outstandingAfter` DECIMAL(14,2) NULL,
  ADD COLUMN `statusBeforeCommit` VARCHAR(32) NULL,
  ADD COLUMN `completedLoan` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `committedAt` DATETIME(3) NULL,
  ADD COLUMN `reversedAt` DATETIME(3) NULL,
  ADD COLUMN `reversalReference` VARCHAR(191) NULL,
  ADD COLUMN `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3);

ALTER TABLE `LoanRepayment`
  DROP FOREIGN KEY `LoanRepayment_loanId_fkey`,
  DROP FOREIGN KEY `LoanRepayment_payrollRunId_fkey`;

CREATE UNIQUE INDEX `LoanRepayment_org_application_key`
  ON `LoanRepayment`(`organizationId`, `loanRecoveryApplicationId`);
CREATE UNIQUE INDEX `LoanRepayment_org_id_key`
  ON `LoanRepayment`(`organizationId`, `id`);
CREATE INDEX `LoanRepayment_org_settlement_status_idx`
  ON `LoanRepayment`(`organizationId`, `financialSettlementId`, `status`);
CREATE INDEX `LoanRepayment_org_payslip_status_idx`
  ON `LoanRepayment`(`organizationId`, `payslipId`, `status`);

ALTER TABLE `LoanRepayment`
  ADD CONSTRAINT `LoanRepayment_org_loan_fkey`
    FOREIGN KEY (`organizationId`, `loanId`) REFERENCES `LoanAdvance`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `LoanRepayment_org_application_fkey`
    FOREIGN KEY (`organizationId`, `loanRecoveryApplicationId`) REFERENCES `LoanRecoveryApplication`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `LoanRepayment_org_run_fkey`
    FOREIGN KEY (`organizationId`, `payrollRunId`) REFERENCES `PayrollRun`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `LoanRepayment_org_participant_fkey`
    FOREIGN KEY (`organizationId`, `payrollRunParticipantId`) REFERENCES `PayrollRunParticipant`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `LoanRepayment_org_payslip_fkey`
    FOREIGN KEY (`organizationId`, `payslipId`) REFERENCES `Payslip`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `LoanRepayment_org_settlement_fkey`
    FOREIGN KEY (`organizationId`, `financialSettlementId`) REFERENCES `FinancialSettlement`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;
