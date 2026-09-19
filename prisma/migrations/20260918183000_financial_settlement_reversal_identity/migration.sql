ALTER TABLE `FinancialSettlement`
  ADD COLUMN `reversalReference` VARCHAR(191) NULL,
  ADD COLUMN `reversalLedgerId` VARCHAR(191) NULL;

CREATE UNIQUE INDEX `FinancialSettlement_reversal_ledger_key`
  ON `FinancialSettlement` (`reversalLedgerId`);

CREATE UNIQUE INDEX `FinancialSettlement_org_reversal_ref_key`
  ON `FinancialSettlement` (`organizationId`, `reversalReference`);
