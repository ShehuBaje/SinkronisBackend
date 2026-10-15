-- Add a durable, tenant-safe creator identity for prospective Payroll runs.
-- Historical rows remain nullable; no creator identity is inferred or backfilled.
ALTER TABLE `PayrollRun`
  ADD COLUMN `createdById` VARCHAR(191) NULL;

ALTER TABLE `PayrollRun`
  ADD INDEX `PayrollRun_org_createdBy_idx` (`organizationId`, `createdById`);

ALTER TABLE `PayrollRun`
  ADD CONSTRAINT `PayrollRun_org_createdBy_fkey`
    FOREIGN KEY (`organizationId`, `createdById`)
    REFERENCES `User` (`organizationId`, `id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;
