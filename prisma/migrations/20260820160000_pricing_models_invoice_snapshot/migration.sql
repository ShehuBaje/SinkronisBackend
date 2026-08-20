UPDATE `BillingProductPlan`
SET `pricingModel` = CASE WHEN `key` = 'all-in-one' THEN 'FIXED_BUNDLE' ELSE 'FIXED' END
WHERE `key` IN ('hris', 'payroll', 'accounting', 'all-in-one');

ALTER TABLE `PlatformInvoice`
  ADD COLUMN `pricingSnapshot` JSON NULL;
