ALTER TABLE `Payslip`
  ADD COLUMN `currency` VARCHAR(191) NULL,
  ADD COLUMN `earningsSnapshot` JSON NULL,
  ADD COLUMN `deductionsSnapshot` JSON NULL,
  ADD COLUMN `pdfFileReference` VARCHAR(191) NULL;
