ALTER TABLE `PayrollRun`
  MODIFY `status` ENUM('DRAFT','PROCESSING','PENDING_APPROVAL','APPROVED','PENDING_DISBURSEMENT','DISBURSING','DISBURSED','FAILED','PAID','CANCELLED') NOT NULL DEFAULT 'DRAFT',
  ADD INDEX `PayrollRun_organizationId_periodEnd_idx`(`organizationId`, `periodEnd`);

ALTER TABLE `Payslip`
  ADD COLUMN `employerPension` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  ADD COLUMN `nhf` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  ADD COLUMN `nsitf` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  ADD COLUMN `departmentIdSnapshot` VARCHAR(191) NULL,
  ADD COLUMN `departmentNameSnapshot` VARCHAR(191) NULL,
  ADD INDEX `Payslip_organizationId_payrollRunId_idx`(`organizationId`, `payrollRunId`);

ALTER TABLE `TaxReport`
  ADD COLUMN `dueDate` DATETIME(3) NULL,
  ADD INDEX `TaxReport_org_period_due_idx`(`organizationId`, `periodEnd`, `dueDate`);
