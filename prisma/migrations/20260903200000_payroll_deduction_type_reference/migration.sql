ALTER TABLE `EmployeeDeduction` ADD COLUMN `deductionTypeId` VARCHAR(191) NULL;
CREATE INDEX `EmployeeDeduction_org_type_idx` ON `EmployeeDeduction`(`organizationId`, `deductionTypeId`);
