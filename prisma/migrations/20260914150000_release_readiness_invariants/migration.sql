-- Preserve legacy wallets while giving Payroll one transaction-safe primary wallet.
ALTER TABLE `WalletAccount` ADD COLUMN `purpose` VARCHAR(191) NULL;
UPDATE `WalletAccount` SET `purpose` = CONCAT('LEGACY:', `id`);
UPDATE `WalletAccount` w
JOIN (
  SELECT `organizationId`, MIN(`id`) AS `id`
  FROM `WalletAccount`
  GROUP BY `organizationId`
) first_wallet ON first_wallet.`organizationId` = w.`organizationId` AND first_wallet.`id` = w.`id`
SET w.`purpose` = 'PRIMARY';
ALTER TABLE `WalletAccount` MODIFY `purpose` VARCHAR(191) NOT NULL DEFAULT 'PRIMARY';
CREATE UNIQUE INDEX `WalletAccount_org_purpose_key` ON `WalletAccount`(`organizationId`, `purpose`);

-- Nullable unique keys enforce at most one default while allowing many non-defaults.
ALTER TABLE `AppraisalTemplate` ADD COLUMN `defaultKey` VARCHAR(20) NULL;
UPDATE `AppraisalTemplate` a
JOIN (
  SELECT `organizationId`, MIN(`id`) AS `id`
  FROM `AppraisalTemplate`
  WHERE `isDefault` = 1 AND `archivedAt` IS NULL
  GROUP BY `organizationId`
) chosen ON chosen.`id` = a.`id`
SET a.`defaultKey` = 'DEFAULT';
UPDATE `AppraisalTemplate` SET `isDefault` = IF(`defaultKey` = 'DEFAULT', 1, 0) WHERE `isDefault` = 1;
CREATE UNIQUE INDEX `AppraisalTemplate_org_default_key` ON `AppraisalTemplate`(`organizationId`, `defaultKey`);

ALTER TABLE `AccountingInvoiceTemplate` ADD COLUMN `defaultKey` VARCHAR(20) NULL;
UPDATE `AccountingInvoiceTemplate` a
JOIN (
  SELECT `organizationId`, MIN(`id`) AS `id`
  FROM `AccountingInvoiceTemplate`
  WHERE `isDefault` = 1
  GROUP BY `organizationId`
) chosen ON chosen.`id` = a.`id`
SET a.`defaultKey` = 'DEFAULT';
UPDATE `AccountingInvoiceTemplate` SET `isDefault` = IF(`defaultKey` = 'DEFAULT', 1, 0) WHERE `isDefault` = 1;
CREATE UNIQUE INDEX `AccountingInvoiceTemplate_org_default_key` ON `AccountingInvoiceTemplate`(`organizationId`, `defaultKey`);

-- Resolve pre-existing duplicates deterministically, then enforce the invariant
-- with a generated nullable key (MySQL/TiDB unique indexes permit multiple NULLs).
UPDATE `ConductLog` c
JOIN (
  SELECT `organizationId`, `employeeId`, MIN(`id`) AS `id`
  FROM `ConductLog`
  WHERE `type` = 'SUSPENSION' AND `status` = 'ACTIVE'
  GROUP BY `organizationId`, `employeeId`
) chosen ON chosen.`organizationId` = c.`organizationId` AND chosen.`employeeId` = c.`employeeId` AND chosen.`id` <> c.`id`
SET c.`status` = 'CANCELLED', c.`resolvedAt` = COALESCE(c.`resolvedAt`, CURRENT_TIMESTAMP)
WHERE c.`type` = 'SUSPENSION' AND c.`status` = 'ACTIVE';
ALTER TABLE `ConductLog` ADD COLUMN `activeSuspensionKey` VARCHAR(20) NULL;
UPDATE `ConductLog`
SET `activeSuspensionKey` = 'ACTIVE'
WHERE `type` = 'SUSPENSION' AND `status` = 'ACTIVE';
CREATE UNIQUE INDEX `ConductLog_org_employee_active_suspension_key` ON `ConductLog`(`organizationId`, `employeeId`, `activeSuspensionKey`);
