ALTER TABLE `Employee`
  ADD UNIQUE INDEX `Employee_organizationId_id_key`(`organizationId`, `id`);

ALTER TABLE `Payee`
  MODIFY `name` VARCHAR(191) NULL,
  MODIFY `monthlyAmount` DECIMAL(14, 2) NULL,
  ADD COLUMN `employeeId` VARCHAR(191) NULL,
  ADD COLUMN `taxRegime` ENUM('PAYE', 'WHT', 'EXEMPT', 'LEGACY_UNSPECIFIED') NOT NULL DEFAULT 'LEGACY_UNSPECIFIED',
  ADD COLUMN `externalRole` VARCHAR(191) NULL,
  ADD COLUMN `dateOnboarded` DATETIME(3) NULL,
  ADD COLUMN `externalOnPayroll` BOOLEAN NULL;

ALTER TABLE `Payee`
  ADD UNIQUE INDEX `Payee_employeeId_key`(`employeeId`),
  ADD UNIQUE INDEX `Payee_organizationId_employeeId_key`(`organizationId`, `employeeId`),
  ADD INDEX `Payee_org_tax_payroll_idx`(`organizationId`, `taxRegime`, `externalOnPayroll`);

ALTER TABLE `Payee`
  ADD CONSTRAINT `Payee_organizationId_employeeId_fkey`
    FOREIGN KEY (`organizationId`, `employeeId`)
    REFERENCES `Employee`(`organizationId`, `id`)
    ON DELETE RESTRICT
    ON UPDATE CASCADE;

INSERT INTO `Payee` (
  `id`,
  `organizationId`,
  `employeeId`,
  `name`,
  `type`,
  `status`,
  `taxRegime`,
  `externalOnPayroll`,
  `monthlyAmount`,
  `isTaxable`,
  `createdAt`,
  `updatedAt`
)
SELECT
  CONCAT('c', SUBSTRING(SHA2(CONCAT(enrollment.`organizationId`, ':', enrollment.`employeeId`), 256), 1, 24)),
  enrollment.`organizationId`,
  enrollment.`employeeId`,
  NULL,
  'PERMANENT',
  IF(enrollment.`isActive`, 'ACTIVE', 'INACTIVE'),
  'PAYE',
  NULL,
  NULL,
  TRUE,
  enrollment.`createdAt`,
  CURRENT_TIMESTAMP(3)
FROM `PayrollEnrollment` AS enrollment
INNER JOIN `Employee` AS employee
  ON employee.`id` = enrollment.`employeeId`
 AND employee.`organizationId` = enrollment.`organizationId`
ON DUPLICATE KEY UPDATE
  `employeeId` = VALUES(`employeeId`),
  `type` = VALUES(`type`),
  `taxRegime` = VALUES(`taxRegime`),
  `status` = VALUES(`status`),
  `updatedAt` = CURRENT_TIMESTAMP(3);
