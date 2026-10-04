ALTER TABLE `PayrollRun`
  MODIFY `status` ENUM('DRAFT','PROCESSING','PENDING_APPROVAL','APPROVED','REJECTED_FOR_REWORK','PENDING_DISBURSEMENT','DISBURSING','DISBURSED','FAILED','PAID','CANCELLED') NOT NULL DEFAULT 'DRAFT';

ALTER TABLE `PayrollRun` ADD COLUMN `rejectedAt` DATETIME(3) NULL;
ALTER TABLE `PayrollRun` ADD COLUMN `rejectedById` VARCHAR(191) NULL;
ALTER TABLE `PayrollRun` ADD COLUMN `rejectionReason` TEXT NULL;
ALTER TABLE `PayrollRun` ADD COLUMN `replacesPayrollRunId` VARCHAR(191) NULL;
ALTER TABLE `PayrollRun` ADD COLUMN `revisionRootRunId` VARCHAR(191) NULL;
ALTER TABLE `PayrollRun` ADD COLUMN `revisionNumber` INTEGER NOT NULL DEFAULT 1;

CREATE UNIQUE INDEX `PayrollRun_org_replaces_key` ON `PayrollRun`(`organizationId`, `replacesPayrollRunId`);
CREATE INDEX `PayrollRun_org_revision_idx` ON `PayrollRun`(`organizationId`, `revisionRootRunId`, `revisionNumber`);
ALTER TABLE `PayrollRun`
  ADD CONSTRAINT `PayrollRun_org_replaces_fkey` FOREIGN KEY (`organizationId`, `replacesPayrollRunId`) REFERENCES `PayrollRun`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `PayrollAdjustmentApplication`
  MODIFY `status` ENUM('FROZEN','APPLIED','SUPERSEDED','ACCEPTED') NOT NULL DEFAULT 'FROZEN';
ALTER TABLE `PayrollAdjustmentApplication` ADD COLUMN `revisionRootRunId` VARCHAR(191) NULL;
UPDATE `PayrollAdjustmentApplication` SET `revisionRootRunId` = `payrollRunId` WHERE `revisionRootRunId` IS NULL;
ALTER TABLE `PayrollAdjustmentApplication` MODIFY `revisionRootRunId` VARCHAR(191) NOT NULL;

CREATE INDEX `PayrollAdjustmentApplication_bonus_fkey_idx` ON `PayrollAdjustmentApplication`(`bonusId`);
CREATE INDEX `PayrollAdjustmentApplication_deduction_fkey_idx` ON `PayrollAdjustmentApplication`(`employeeDeductionId`);
DROP INDEX `PayrollAdjustmentApplication_bonus_key` ON `PayrollAdjustmentApplication`;
DROP INDEX `PayrollAdjustmentApplication_deduction_key` ON `PayrollAdjustmentApplication`;
CREATE UNIQUE INDEX `PayrollAdjustmentApplication_run_bonus_key` ON `PayrollAdjustmentApplication`(`payrollRunId`, `bonusId`);
CREATE UNIQUE INDEX `PayrollAdjustmentApplication_run_deduction_key` ON `PayrollAdjustmentApplication`(`payrollRunId`, `employeeDeductionId`);
CREATE INDEX `PayrollAdjustmentApplication_org_revision_status_idx` ON `PayrollAdjustmentApplication`(`organizationId`, `revisionRootRunId`, `status`);
