ALTER TABLE `PayrollRun`
  ADD COLUMN `participantsFrozenAt` DATETIME(3) NULL,
  ADD COLUMN `participantCount` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `permanentEmployeeCount` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `externalPayeeCount` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `processedParticipantCount` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `failedParticipantCount` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `totalWht` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  ADD COLUMN `totalPermanentNetPay` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  ADD COLUMN `totalExternalNetPay` DECIMAL(14,2) NOT NULL DEFAULT 0.00;

UPDATE `PayrollRun`
SET `permanentEmployeeCount` = `employeeCount`,
    `participantCount` = `employeeCount`,
    `processedParticipantCount` = `processedEmployeeCount`,
    `failedParticipantCount` = `failedEmployeeCount`,
    `totalPermanentNetPay` = `totalNetPay`
WHERE `membershipVersion` = 'LEGACY_EMPLOYEE';

ALTER TABLE `PayrollCalculationBatch`
  ADD COLUMN `participantIds` JSON NULL;

ALTER TABLE `Payslip`
  ADD COLUMN `calculationInputSnapshot` JSON NULL;

ALTER TABLE `PayeePayment`
  ADD COLUMN `payrollRunParticipantId` VARCHAR(191) NULL,
  ADD COLUMN `whtRateSnapshot` DECIMAL(8,6) NOT NULL DEFAULT 0.000000,
  ADD COLUMN `whtAmount` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  ADD COLUMN `taxRegimeSnapshot` ENUM('PAYE','WHT','EXEMPT','LEGACY_UNSPECIFIED') NOT NULL DEFAULT 'LEGACY_UNSPECIFIED',
  ADD COLUMN `externalRoleSnapshot` VARCHAR(191) NULL,
  ADD COLUMN `tinSnapshot` VARCHAR(191) NULL,
  ADD COLUMN `dateOnboardedSnapshot` DATETIME(3) NULL,
  ADD COLUMN `taxRuleSnapshot` JSON NULL,
  ADD COLUMN `compensationSnapshot` JSON NULL;

CREATE UNIQUE INDEX `PayeePayment_participantId_key` ON `PayeePayment`(`payrollRunParticipantId`);
ALTER TABLE `PayeePayment`
  ADD CONSTRAINT `PayeePayment_participant_fkey` FOREIGN KEY (`payrollRunParticipantId`) REFERENCES `PayrollRunParticipant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
