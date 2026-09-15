ALTER TABLE `Employee`
  ADD COLUMN `payrollPreviewGross` DECIMAL(14,2) NULL,
  ADD COLUMN `payrollPreviewNet` DECIMAL(14,2) NULL,
  ADD COLUMN `payrollPreviewUpdatedAt` DATETIME(3) NULL;

CREATE INDEX `Employee_org_preview_gross_idx`
  ON `Employee`(`organizationId`, `payrollPreviewGross`, `id`);

CREATE INDEX `Employee_org_preview_net_idx`
  ON `Employee`(`organizationId`, `payrollPreviewNet`, `id`);
