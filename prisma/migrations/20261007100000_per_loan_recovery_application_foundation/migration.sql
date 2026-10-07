-- R6A.3 Phase 2: additive, prospective per-loan Payroll recovery attribution.
-- No historical Payroll result or loan balance is inferred or rewritten.
CREATE TABLE `LoanRecoveryApplication` (
  `id` VARCHAR(191) NOT NULL,
  `organizationId` VARCHAR(191) NOT NULL,
  `loanAdvanceId` VARCHAR(191) NOT NULL,
  `payrollRunId` VARCHAR(191) NOT NULL,
  `payrollRunParticipantId` VARCHAR(191) NOT NULL,
  `payslipId` VARCHAR(191) NOT NULL,
  `employeeId` VARCHAR(191) NOT NULL,
  `revisionRootRunId` VARCHAR(191) NOT NULL,
  `appliedAmount` DECIMAL(14,2) NOT NULL,
  `currency` VARCHAR(3) NOT NULL DEFAULT 'NGN',
  `state` ENUM('FROZEN','SUPERSEDED') NOT NULL DEFAULT 'FROZEN',
  `frozenSnapshot` JSON NOT NULL,
  `frozenAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `supersededAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `LoanRecoveryApplication_loan_payslip_key`(`loanAdvanceId`, `payslipId`),
  UNIQUE INDEX `LoanRecoveryApplication_run_participant_loan_key`(`payrollRunId`, `payrollRunParticipantId`, `loanAdvanceId`),
  INDEX `LoanRecoveryApplication_org_run_state_idx`(`organizationId`, `payrollRunId`, `state`),
  INDEX `LoanRecoveryApplication_org_loan_state_idx`(`organizationId`, `loanAdvanceId`, `state`),
  INDEX `LoanRecoveryApplication_org_revision_state_idx`(`organizationId`, `revisionRootRunId`, `state`),
  INDEX `LoanRecoveryApplication_org_payslip_idx`(`organizationId`, `payslipId`),
  INDEX `LoanRecoveryApplication_org_employee_idx`(`organizationId`, `employeeId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE UNIQUE INDEX `LoanAdvance_org_id_key` ON `LoanAdvance`(`organizationId`, `id`);
CREATE UNIQUE INDEX `Payslip_org_id_key` ON `Payslip`(`organizationId`, `id`);
CREATE UNIQUE INDEX `PayrollRunParticipant_org_id_key` ON `PayrollRunParticipant`(`organizationId`, `id`);

ALTER TABLE `LoanRecoveryApplication` ADD CONSTRAINT `LoanRecoveryApplication_org_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `LoanRecoveryApplication` ADD CONSTRAINT `LoanRecoveryApplication_org_loan_fkey` FOREIGN KEY (`organizationId`, `loanAdvanceId`) REFERENCES `LoanAdvance`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `LoanRecoveryApplication` ADD CONSTRAINT `LoanRecoveryApplication_org_run_fkey` FOREIGN KEY (`organizationId`, `payrollRunId`) REFERENCES `PayrollRun`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `LoanRecoveryApplication` ADD CONSTRAINT `LoanRecoveryApplication_org_participant_fkey` FOREIGN KEY (`organizationId`, `payrollRunParticipantId`) REFERENCES `PayrollRunParticipant`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `LoanRecoveryApplication` ADD CONSTRAINT `LoanRecoveryApplication_org_payslip_fkey` FOREIGN KEY (`organizationId`, `payslipId`) REFERENCES `Payslip`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `LoanRecoveryApplication` ADD CONSTRAINT `LoanRecoveryApplication_org_employee_fkey` FOREIGN KEY (`organizationId`, `employeeId`) REFERENCES `Employee`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;
