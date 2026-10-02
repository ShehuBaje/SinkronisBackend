ALTER TABLE `PayrollRun`
  ADD COLUMN `membershipVersion` ENUM('LEGACY_EMPLOYEE', 'UNIFIED_PAYEE_V1') NOT NULL DEFAULT 'LEGACY_EMPLOYEE';

CREATE UNIQUE INDEX `PayrollRun_organizationId_id_key` ON `PayrollRun`(`organizationId`, `id`);
CREATE UNIQUE INDEX `Payee_organizationId_id_key` ON `Payee`(`organizationId`, `id`);

CREATE TABLE `PayrollRunParticipant` (
  `id` VARCHAR(191) NOT NULL,
  `organizationId` VARCHAR(191) NOT NULL,
  `payrollRunId` VARCHAR(191) NOT NULL,
  `payeeId` VARCHAR(191) NOT NULL,
  `employeeId` VARCHAR(191) NULL,
  `participantType` ENUM('PERMANENT', 'CONTRACT', 'CONSULTANT') NOT NULL,
  `selectionSource` ENUM('AUTO', 'MANUAL') NOT NULL,
  `selectedById` VARCHAR(191) NULL,
  `selectedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `frozenAt` DATETIME(3) NULL,
  `calculationSnapshot` JSON NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `PayrollRunParticipant_run_payee_key` (`payrollRunId`, `payeeId`),
  UNIQUE INDEX `PayrollRunParticipant_run_employee_key` (`payrollRunId`, `employeeId`),
  INDEX `PayrollRunParticipant_org_run_idx` (`organizationId`, `payrollRunId`),
  INDEX `PayrollRunParticipant_org_payee_idx` (`organizationId`, `payeeId`),
  INDEX `PayrollRunParticipant_org_type_idx` (`organizationId`, `participantType`),
  CONSTRAINT `PayrollRunParticipant_org_run_fkey` FOREIGN KEY (`organizationId`, `payrollRunId`) REFERENCES `PayrollRun` (`organizationId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `PayrollRunParticipant_org_payee_fkey` FOREIGN KEY (`organizationId`, `payeeId`) REFERENCES `Payee` (`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `PayrollRunParticipant_org_employee_fkey` FOREIGN KEY (`organizationId`, `employeeId`) REFERENCES `Employee` (`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
