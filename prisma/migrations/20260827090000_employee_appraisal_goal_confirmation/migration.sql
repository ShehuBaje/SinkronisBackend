ALTER TABLE `EmployeeAppraisal`
  ADD COLUMN `goalsConfirmedAt` DATETIME(3) NULL,
  ADD COLUMN `goalsConfirmedById` VARCHAR(191) NULL;

CREATE INDEX `EmployeeAppraisal_org_goals_confirmed_idx`
  ON `EmployeeAppraisal`(`organizationId`, `goalsConfirmedAt`);
