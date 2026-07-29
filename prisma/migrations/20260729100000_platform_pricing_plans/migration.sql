CREATE TABLE `BillingProductPlan` (
  `id` VARCHAR(191) NOT NULL,
  `key` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `normalizedName` VARCHAR(191) NOT NULL,
  `description` TEXT NOT NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'ACTIVE',
  `pricingModel` VARCHAR(191) NOT NULL DEFAULT 'FLAT_MONTHLY',
  `isSystem` BOOLEAN NOT NULL DEFAULT false,
  `rowVersion` INTEGER NOT NULL DEFAULT 1,
  `createdByUserId` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `BillingProductPlan_key_key`(`key`),
  UNIQUE INDEX `BillingProductPlan_normalizedName_key`(`normalizedName`),
  INDEX `BillingProductPlan_status_updatedAt_idx`(`status`, `updatedAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `BillingFeature` (
  `id` VARCHAR(191) NOT NULL,
  `key` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `normalizedName` VARCHAR(191) NOT NULL,
  `description` TEXT NULL,
  `moduleKey` VARCHAR(191) NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'ACTIVE',
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `BillingFeature_key_key`(`key`),
  UNIQUE INDEX `BillingFeature_moduleKey_normalizedName_key`(`moduleKey`, `normalizedName`),
  INDEX `BillingFeature_moduleKey_status_idx`(`moduleKey`, `status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `BillingPlanFeature` (
  `planId` VARCHAR(191) NOT NULL,
  `featureId` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `BillingPlanFeature_featureId_idx`(`featureId`),
  PRIMARY KEY (`planId`, `featureId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `BillingPlanModule` (
  `planId` VARCHAR(191) NOT NULL,
  `moduleKey` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `BillingPlanModule_moduleKey_idx`(`moduleKey`),
  PRIMARY KEY (`planId`, `moduleKey`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `BillingPriceVersion` (
  `id` VARCHAR(191) NOT NULL,
  `planId` VARCHAR(191) NOT NULL,
  `monthlyPrice` DECIMAL(14,2) NOT NULL,
  `currency` VARCHAR(191) NOT NULL DEFAULT 'NGN',
  `effectiveAt` DATETIME(3) NOT NULL,
  `endsAt` DATETIME(3) NULL,
  `reason` TEXT NULL,
  `changedByUserId` VARCHAR(191) NULL,
  `version` INTEGER NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `BillingPriceVersion_planId_version_key`(`planId`, `version`),
  INDEX `BillingPriceVersion_planId_effectiveAt_idx`(`planId`, `effectiveAt`),
  INDEX `BillingPriceVersion_effectiveAt_endsAt_idx`(`effectiveAt`, `endsAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `SubscriptionPriceAgreement` (
  `id` VARCHAR(191) NOT NULL,
  `organizationId` VARCHAR(191) NOT NULL,
  `planId` VARCHAR(191) NOT NULL,
  `priceVersionId` VARCHAR(191) NULL,
  `source` VARCHAR(191) NOT NULL DEFAULT 'BASE_PLAN',
  `monthlyPrice` DECIMAL(14,2) NOT NULL,
  `currency` VARCHAR(191) NOT NULL DEFAULT 'NGN',
  `startsAt` DATETIME(3) NOT NULL,
  `endsAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `SubPriceAgreement_org_plan_source_start_key`(`organizationId`, `planId`, `source`, `startsAt`),
  INDEX `SubPriceAgreement_org_start_end_idx`(`organizationId`, `startsAt`, `endsAt`),
  INDEX `SubPriceAgreement_plan_start_end_idx`(`planId`, `startsAt`, `endsAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `BillingPlanFeature` ADD CONSTRAINT `BillingPlanFeature_planId_fkey` FOREIGN KEY (`planId`) REFERENCES `BillingProductPlan`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `BillingPlanFeature` ADD CONSTRAINT `BillingPlanFeature_featureId_fkey` FOREIGN KEY (`featureId`) REFERENCES `BillingFeature`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `BillingPlanModule` ADD CONSTRAINT `BillingPlanModule_planId_fkey` FOREIGN KEY (`planId`) REFERENCES `BillingProductPlan`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `BillingPriceVersion` ADD CONSTRAINT `BillingPriceVersion_planId_fkey` FOREIGN KEY (`planId`) REFERENCES `BillingProductPlan`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `SubscriptionPriceAgreement` ADD CONSTRAINT `SubscriptionPriceAgreement_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `SubscriptionPriceAgreement` ADD CONSTRAINT `SubscriptionPriceAgreement_planId_fkey` FOREIGN KEY (`planId`) REFERENCES `BillingProductPlan`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `SubscriptionPriceAgreement` ADD CONSTRAINT `SubscriptionPriceAgreement_priceVersionId_fkey` FOREIGN KEY (`priceVersionId`) REFERENCES `BillingPriceVersion`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO `BillingProductPlan` (`id`,`key`,`name`,`normalizedName`,`description`,`status`,`pricingModel`,`isSystem`,`rowVersion`,`updatedAt`) VALUES
('plan_hris','hris','HRIS','hris','Complete people operations and organisation management.','ACTIVE','FLAT_MONTHLY',true,1,CURRENT_TIMESTAMP(3)),
('plan_payroll','payroll','Payroll','payroll','Payroll, statutory compliance and salary disbursement.','ACTIVE','FLAT_MONTHLY',true,1,CURRENT_TIMESTAMP(3)),
('plan_accounting','accounting','Accounting','accounting','Billing, compliance, expenses and financial reporting.','ACTIVE','FLAT_MONTHLY',true,1,CURRENT_TIMESTAMP(3)),
('plan_all_in_one','all-in-one','All-in-One Suite','all in one suite','Every Sinkronis module in one unified suite.','ACTIVE','FLAT_MONTHLY',true,1,CURRENT_TIMESTAMP(3));

INSERT INTO `BillingPriceVersion` (`id`,`planId`,`monthlyPrice`,`currency`,`effectiveAt`,`version`) VALUES
('price_hris_v1','plan_hris',80000.00,'NGN','2020-01-01 00:00:00.000',1),
('price_payroll_v1','plan_payroll',10000.00,'NGN','2020-01-01 00:00:00.000',1),
('price_accounting_v1','plan_accounting',80000.00,'NGN','2020-01-01 00:00:00.000',1),
('price_all_in_one_v1','plan_all_in_one',150000.00,'NGN','2020-01-01 00:00:00.000',1);

INSERT INTO `BillingPlanModule` (`planId`,`moduleKey`) VALUES
('plan_hris','hris'),('plan_payroll','payroll'),('plan_accounting','accounting'),
('plan_all_in_one','hris'),('plan_all_in_one','payroll'),('plan_all_in_one','accounting');

INSERT INTO `BillingFeature` (`id`,`key`,`name`,`normalizedName`,`description`,`moduleKey`,`updatedAt`) VALUES
('feature_hris_employee','hris-employee-management','Employee Management','employee management','Employee profiles and records','hris',CURRENT_TIMESTAMP(3)),
('feature_hris_attendance','hris-attendance','Attendance','attendance','Attendance and biometric integration','hris',CURRENT_TIMESTAMP(3)),
('feature_hris_leave','hris-leave','Leave','leave','Leave management and approvals','hris',CURRENT_TIMESTAMP(3)),
('feature_hris_appraisal','hris-appraisal','Appraisal','appraisal','Appraisal and OKR reviews','hris',CURRENT_TIMESTAMP(3)),
('feature_hris_conduct','hris-conduct','Conduct','conduct','Conduct and disciplinary tracking','hris',CURRENT_TIMESTAMP(3)),
('feature_hris_departments','hris-departments','Departments','departments','Departments and branches','hris',CURRENT_TIMESTAMP(3)),
('feature_payroll_salary','payroll-salary-processing','Salary Processing','salary processing','Salary computation and pay runs','payroll',CURRENT_TIMESTAMP(3)),
('feature_payroll_tax','payroll-tax','PAYE and Withholding Tax','paye and withholding tax','Tax management','payroll',CURRENT_TIMESTAMP(3)),
('feature_payroll_pension','payroll-pension','Pension','pension','Pension and statutory remittances','payroll',CURRENT_TIMESTAMP(3)),
('feature_payroll_payslips','payroll-payslips','Payslips','payslips','Payslip generation','payroll',CURRENT_TIMESTAMP(3)),
('feature_payroll_loans','payroll-loans','Loans','loans','Deduction and loan management','payroll',CURRENT_TIMESTAMP(3)),
('feature_payroll_wallet','payroll-wallet','Wallet','wallet','Salary disbursement wallet','payroll',CURRENT_TIMESTAMP(3)),
('feature_accounting_clients','accounting-clients','Clients','clients','Client and invoice management','accounting',CURRENT_TIMESTAMP(3)),
('feature_accounting_tax','accounting-tax','VAT and Withholding Tax','vat and withholding tax','Tax compliance','accounting',CURRENT_TIMESTAMP(3)),
('feature_accounting_expenses','accounting-expenses','Expenses','expenses','Expense tracking','accounting',CURRENT_TIMESTAMP(3)),
('feature_accounting_agents','accounting-sales-agents','Sales Agents','sales agents','Sales agent management','accounting',CURRENT_TIMESTAMP(3)),
('feature_accounting_requests','accounting-payment-requests','Payment Requests','payment requests','Payment requests and approvals','accounting',CURRENT_TIMESTAMP(3)),
('feature_accounting_reports','accounting-financial-reports','Financial Reports','financial reports','Financial reporting and profit and loss','accounting',CURRENT_TIMESTAMP(3)),
('feature_suite_dashboard','suite-unified-dashboard','Unified Dashboard','unified dashboard','Single unified dashboard',NULL,CURRENT_TIMESTAMP(3)),
('feature_suite_reporting','suite-cross-module-reporting','Cross-module Reporting','cross module reporting','Cross-module reporting',NULL,CURRENT_TIMESTAMP(3)),
('feature_suite_support','suite-priority-support','Priority Support','priority support','Priority support',NULL,CURRENT_TIMESTAMP(3));

INSERT INTO `BillingPlanFeature` (`planId`,`featureId`)
SELECT 'plan_hris', `id` FROM `BillingFeature` WHERE `moduleKey`='hris';
INSERT INTO `BillingPlanFeature` (`planId`,`featureId`)
SELECT 'plan_payroll', `id` FROM `BillingFeature` WHERE `moduleKey`='payroll';
INSERT INTO `BillingPlanFeature` (`planId`,`featureId`)
SELECT 'plan_accounting', `id` FROM `BillingFeature` WHERE `moduleKey`='accounting';
INSERT INTO `BillingPlanFeature` (`planId`,`featureId`)
SELECT 'plan_all_in_one', `id` FROM `BillingFeature` WHERE `moduleKey` IS NULL;
