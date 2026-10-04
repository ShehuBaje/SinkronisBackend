CREATE TABLE `PayrollPayeeGroup` (
  `id` VARCHAR(191) NOT NULL,
  `organizationId` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `description` TEXT NULL,
  `displayColor` VARCHAR(24) NULL,
  `active` BOOLEAN NOT NULL DEFAULT true,
  `archivedAt` DATETIME(3) NULL,
  `createdById` VARCHAR(191) NULL,
  `updatedById` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE UNIQUE INDEX `PayrollPayeeGroup_org_id_key` ON `PayrollPayeeGroup`(`organizationId`, `id`);
CREATE UNIQUE INDEX `PayrollPayeeGroup_org_name_key` ON `PayrollPayeeGroup`(`organizationId`, `name`);
CREATE INDEX `PayrollPayeeGroup_org_active_idx` ON `PayrollPayeeGroup`(`organizationId`, `active`, `archivedAt`);

ALTER TABLE `PayrollPayeeGroup`
  ADD CONSTRAINT `PayrollPayeeGroup_org_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `Payee`
  ADD COLUMN `payrollGroupId` VARCHAR(191) NULL;

CREATE INDEX `Payee_org_group_idx` ON `Payee`(`organizationId`, `payrollGroupId`);

ALTER TABLE `Payee`
  ADD CONSTRAINT `Payee_org_group_fkey` FOREIGN KEY (`organizationId`, `payrollGroupId`) REFERENCES `PayrollPayeeGroup`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE `PayrollBonus` (
  `id` VARCHAR(191) NOT NULL,
  `organizationId` VARCHAR(191) NOT NULL,
  `payeeId` VARCHAR(191) NOT NULL,
  `amount` DECIMAL(14,2) NOT NULL,
  `frequency` ENUM('ONCE','MULTIPLE') NOT NULL,
  `justification` VARCHAR(500) NOT NULL,
  `effectiveFrom` DATETIME(3) NOT NULL,
  `effectiveTo` DATETIME(3) NULL,
  `active` BOOLEAN NOT NULL DEFAULT true,
  `archivedAt` DATETIME(3) NULL,
  `createdById` VARCHAR(191) NULL,
  `updatedById` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE UNIQUE INDEX `PayrollBonus_org_id_key` ON `PayrollBonus`(`organizationId`, `id`);
CREATE INDEX `PayrollBonus_org_payee_effective_idx` ON `PayrollBonus`(`organizationId`, `payeeId`, `active`, `effectiveFrom`, `effectiveTo`);

ALTER TABLE `PayrollBonus`
  ADD CONSTRAINT `PayrollBonus_org_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `PayrollBonus`
  ADD CONSTRAINT `PayrollBonus_org_payee_fkey` FOREIGN KEY (`organizationId`, `payeeId`) REFERENCES `Payee`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE `PayrollProrationOverride` (
  `id` VARCHAR(191) NOT NULL,
  `organizationId` VARCHAR(191) NOT NULL,
  `payeeId` VARCHAR(191) NOT NULL,
  `employeeId` VARCHAR(191) NOT NULL,
  `payFrom` DATETIME(3) NOT NULL,
  `payUntil` DATETIME(3) NOT NULL,
  `basis` ENUM('WORKING_DAYS','CALENDAR_DAYS') NOT NULL,
  `justification` VARCHAR(500) NOT NULL,
  `active` BOOLEAN NOT NULL DEFAULT true,
  `archivedAt` DATETIME(3) NULL,
  `createdById` VARCHAR(191) NULL,
  `updatedById` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE UNIQUE INDEX `PayrollProrationOverride_org_id_key` ON `PayrollProrationOverride`(`organizationId`, `id`);
CREATE INDEX `PayrollProrationOverride_org_payee_dates_idx` ON `PayrollProrationOverride`(`organizationId`, `payeeId`, `active`, `payFrom`, `payUntil`);
CREATE INDEX `PayrollProrationOverride_org_employee_idx` ON `PayrollProrationOverride`(`organizationId`, `employeeId`, `active`);

ALTER TABLE `PayrollProrationOverride`
  ADD CONSTRAINT `PayrollProrationOverride_org_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `PayrollProrationOverride`
  ADD CONSTRAINT `PayrollProrationOverride_org_payee_fkey` FOREIGN KEY (`organizationId`, `payeeId`) REFERENCES `Payee`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `PayrollProrationOverride`
  ADD CONSTRAINT `PayrollProrationOverride_org_employee_fkey` FOREIGN KEY (`organizationId`, `employeeId`) REFERENCES `Employee`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE `PayrollAdjustmentApplication` (
  `id` VARCHAR(191) NOT NULL,
  `organizationId` VARCHAR(191) NOT NULL,
  `payrollRunId` VARCHAR(191) NOT NULL,
  `participantId` VARCHAR(191) NOT NULL,
  `adjustmentType` ENUM('BONUS','CUSTOM_DEDUCTION') NOT NULL,
  `bonusId` VARCHAR(191) NULL,
  `employeeDeductionId` VARCHAR(191) NULL,
  `status` ENUM('FROZEN','APPLIED') NOT NULL DEFAULT 'FROZEN',
  `amountSnapshot` DECIMAL(14,2) NOT NULL,
  `frozenAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `appliedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE UNIQUE INDEX `PayrollAdjustmentApplication_bonus_key` ON `PayrollAdjustmentApplication`(`bonusId`);
CREATE UNIQUE INDEX `PayrollAdjustmentApplication_deduction_key` ON `PayrollAdjustmentApplication`(`employeeDeductionId`);
CREATE INDEX `PayrollAdjustmentApplication_org_run_status_idx` ON `PayrollAdjustmentApplication`(`organizationId`, `payrollRunId`, `status`);
CREATE INDEX `PayrollAdjustmentApplication_participant_type_idx` ON `PayrollAdjustmentApplication`(`participantId`, `adjustmentType`);

ALTER TABLE `PayrollAdjustmentApplication`
  ADD CONSTRAINT `PayrollAdjustmentApplication_org_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `PayrollAdjustmentApplication`
  ADD CONSTRAINT `PayrollAdjustmentApplication_org_run_fkey` FOREIGN KEY (`organizationId`, `payrollRunId`) REFERENCES `PayrollRun`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `PayrollAdjustmentApplication`
  ADD CONSTRAINT `PayrollAdjustmentApplication_participant_fkey` FOREIGN KEY (`participantId`) REFERENCES `PayrollRunParticipant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `PayrollAdjustmentApplication`
  ADD CONSTRAINT `PayrollAdjustmentApplication_bonus_fkey` FOREIGN KEY (`bonusId`) REFERENCES `PayrollBonus`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `PayrollAdjustmentApplication`
  ADD CONSTRAINT `PayrollAdjustmentApplication_deduction_fkey` FOREIGN KEY (`employeeDeductionId`) REFERENCES `EmployeeDeduction`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
